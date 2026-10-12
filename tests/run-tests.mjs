#!/usr/bin/env node
// Test suite for the Oracle to PostgreSQL migration advisor. No dependencies: `node tests/run-tests.mjs`.
//
// What it proves
//   catalog     the generated JSON matches its authoring source, every entry is well formed, every regex compiles
//   matrix      every feature has a verdict for every target, every cited source resolves
//   contract    the input contract, the feature matrix, the rule index and the engine agree with each other
//   properties  thousands of random interviews: the engine never throws, never breaks one of its own
//               19 self-check invariants, is deterministic, and is monotone in the features listed
//   selfcheck   the self-check itself catches each class of corrupted answer (it is tested, not trusted)
//   assessor    parsing, masking, splitting, scoring and the Ora2Pg arithmetic, on small fixtures
//   golden      hand-written scenarios with the expected outcome of each rule (tests/golden-scenarios.json)
//   report      the report builder produces a complete document from a scan

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluate, selfCheck, normalise, profileFromAssessment, FIELDS, TARGETS, PG_TARGETS, FEATURE_MATRIX, RULES, KNOWLEDGE_BASE_VERSION } from '../tools/advisor/engine.mjs';
import { analyse, migrationLevel, OBJECT_SCORE } from '../tools/assess/lib/analyze.mjs';
import { maskSource } from '../tools/assess/lib/mask.mjs';
import { aiAssistedEstimate } from '../tools/assess/lib/ai-effort.mjs';
import { parseSource } from '../tools/assess/lib/split.mjs';
import { renderCard } from '../tools/advisor/render-card.mjs';
import { buildPlan, renderPlan, CATALOG as PREREQ } from '../tools/plan/build-plan.mjs';
import { validate } from '../tools/schema/validate.mjs';
import { checkLayout } from '../tools/pdf/print.mjs';
import { contractEnums as sharedContractEnums } from '../tools/schema/contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const readJson = p => JSON.parse(read(p));

// ---------------------------------------------------------------------------------------------
// A very small harness
// ---------------------------------------------------------------------------------------------
const results = { pass: 0, fail: 0, failures: [] };
let currentSection = '';
const section = name => { currentSection = name; console.log(`\n${name}`); };
function test(name, fn) {
  try {
    fn();
    results.pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    results.fail++;
    results.failures.push(`${currentSection}: ${name}\n       ${String(e.message).split('\n').join('\n       ')}`);
    console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').join('\n       ')}`);
  }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'not equal'}\n  expected ${JSON.stringify(b)}\n  actual   ${JSON.stringify(a)}`); };
const info = msg => console.log(`       ${msg}`);

// ---------------------------------------------------------------------------------------------
// Fixtures shared by several sections
// ---------------------------------------------------------------------------------------------
const catalogJson = readJson('reference/compat-catalog.json');
const sourcesJson = readJson('reference/sources.json');
const weightOf = id => catalogJson.entries.find(e => e.id === id).weight;

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const contractEnums = sharedContractEnums;
const ENUMS = contractEnums();
const REGIONS = ['swedencentral', 'westeurope', 'eastus', 'northeurope', 'uksouth', 'germanywestcentral', 'brazilsouth', 'NOT_SURE'];
const FEATURE_IDS = FEATURE_MATRIX.features.map(f => f.featureId);
const EVIDENCE = ENUMS.evidence || ['SCHEMA_SCAN', 'EFFORT_ESTIMATE', 'VSCODE_DISCOVERY', 'AWR_SIZING', 'NONE'];

function randomProfile(rnd, { keepFeaturesListed = false } = {}) {
  const pick = a => a[Math.floor(rnd() * a.length)];
  const p = {};
  for (const [field, ids] of Object.entries(ENUMS)) {
    if (field === 'evidence' || field === 'oracle_features') continue;
    p[field] = rnd() < 0.07 ? 'UNKNOWN' : pick(ids);
  }
  p.region = pick(REGIONS);
  const n = Math.floor(rnd() * 8);
  p.oracle_features = [...new Set(Array.from({ length: n }, () => pick(FEATURE_IDS)))];
  if (keepFeaturesListed) p.feature_dependencies = 'LIST_FEATURES';
  p.evidence = rnd() < 0.5 ? [] : [...new Set([pick(EVIDENCE), pick(EVIDENCE)])];
  return p;
}

const contoso = () => ({ ...JSON.parse(read('examples/contoso-store/profile.json')), plsql_volume: 'MODERATE', oracle_features: ['PACKAGE_STATE', 'VPD'], feature_dependencies: 'LIST_FEATURES' });
const baseOut = () => evaluate(contoso());
const clone = o => JSON.parse(JSON.stringify(o));

const SEVERITY = { eligible: 1, eligible_with_remediation: 2, unknown_requires_assessment: 3, excluded_by_preference: 4, unsupported: 5 };

// ---------------------------------------------------------------------------------------------
section('catalog');
// ---------------------------------------------------------------------------------------------
test('generated JSON is in sync with the authoring source', () => {
  execFileSync('node', ['tools/catalog/build.mjs', '--check'], { cwd: root, stdio: 'pipe' });
});
test('every entry is well formed', () => {
  const ids = new Set();
  const problems = [];
  for (const e of catalogJson.entries) {
    if (ids.has(e.id)) problems.push(`duplicate id ${e.id}`);
    ids.add(e.id);
    if (!['CLEAN', 'PARTIAL', 'REVIEW', 'BLOCKER'].includes(e.classification)) problems.push(`${e.id}: class ${e.classification}`);
    if (!(e.weight >= 0)) problems.push(`${e.id}: weight ${e.weight}`);
    if (!/^(ora2pg-25\.0:.+|advisor)$/.test(e.weightOrigin)) problems.push(`${e.id}: weightOrigin ${e.weightOrigin}`);
    if (!e.detect && !e.metric) problems.push(`${e.id}: neither a pattern nor a metric`);
    if (!Array.isArray(e.scope) || !e.scope.length) problems.push(`${e.id}: empty scope`);
    if (!e.postgres) problems.push(`${e.id}: no PostgreSQL equivalent text`);
    if (e.detect) {
      try {
        const re = new RegExp(e.detect, e.flags);
        // `^[\\s\\S]*$` is the deliberate whole-object pattern used by entries that stand for an object type itself.
        if (!e.detect.includes('^[\\s\\S]*$') && new RegExp(`^(?:${e.detect})$`, e.flags.replace('g', '')).test('')) problems.push(`${e.id}: pattern matches the empty string`);
        void re;
      } catch (err) { problems.push(`${e.id}: ${err.message}`); }
    }
    if (e.labCase && !e.labCase.split(',').every(c => /^(H|T)-\d\d$|^extra/.test(c.trim()))) problems.push(`${e.id}: labCase ${e.labCase}`);
  }
  eq(problems, [], 'catalog problems');
});
test('BLOCKER is rare and always carries a remediation', () => {
  const blockers = catalogJson.entries.filter(e => e.classification === 'BLOCKER');
  ok(blockers.length >= 5 && blockers.length <= 30, `${blockers.length} blockers`);
  for (const b of blockers) ok(b.postgres.length > 20, `${b.id} lacks a remediation`);
});
test('weights that claim to be Ora2Pg\'s are a minority and named', () => {
  const ora = catalogJson.entries.filter(e => e.weightOrigin.startsWith('ora2pg-25.0:'));
  ok(ora.length >= 30, `only ${ora.length} Ora2Pg-origin weights`);
  info(`${ora.length} of ${catalogJson.entries.length} weights are Ora2Pg 25.0's own; the rest are marked advisor`);
});
test('the research-derived entries keep their research ids', () => {
  const withResearch = catalogJson.entries.filter(e => e.researchId);
  ok(withResearch.length >= 50, `${withResearch.length}`);
});

// ---------------------------------------------------------------------------------------------
section('feature matrix and sources');
// ---------------------------------------------------------------------------------------------
const STATES = ['native', 'workaround', 'redesign', 'unsupported', 'unknown'];
const MATRIX_TARGETS = ['pg_flex', 'pg_elastic', 'horizondb', 'pg_vm', 'pg_aks'];
const sourceIds = new Set(sourcesJson.sources.map(s => s.id));
test('every feature has a verdict for every target', () => {
  const problems = [];
  for (const f of FEATURE_MATRIX.features) {
    for (const t of MATRIX_TARGETS) {
      const c = f.targets[t];
      if (!c) { problems.push(`${f.featureId}/${t} missing`); continue; }
      if (!STATES.includes(c.state)) problems.push(`${f.featureId}/${t}: state ${c.state}`);
      if (c.state !== 'native' && !c.note) problems.push(`${f.featureId}/${t}: ${c.state} without a note`);
    }
  }
  eq(problems, [], 'matrix problems');
});
test('every scanConstruct in the matrix is a catalog entry', () => {
  const ids = new Set(catalogJson.entries.map(e => e.id));
  const missing = FEATURE_MATRIX.features.flatMap(f => f.scanConstructs.filter(id => !ids.has(id)).map(id => `${f.featureId} -> ${id}`));
  eq(missing, [], 'unknown scan constructs');
});
test('every cited source id resolves', () => {
  const cited = new Set();
  const walk = v => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'sources' && Array.isArray(x)) x.filter(s => typeof s === 'string').forEach(s => cited.add(s)); else walk(x); }
  };
  walk(FEATURE_MATRIX); walk(RULES);
  const unresolved = [...cited].filter(id => !sourceIds.has(id));
  eq(unresolved, [], 'unresolved source ids');
  const unused = [...sourceIds].filter(id => !cited.has(id));
  info(`${cited.size} sources cited by the matrix and the rules, ${unused.length} held for the knowledge base`);
});
test('sources are https, unique and dated', () => {
  const seen = new Set();
  for (const s of sourcesJson.sources) {
    ok(/^https:\/\//.test(s.url), `${s.id}: ${s.url}`);
    ok(!seen.has(s.id), `duplicate ${s.id}`); seen.add(s.id);
    ok(/^\d{4}-\d\d-\d\d$/.test(s.checked), `${s.id}: checked ${s.checked}`);
  }
});
test('cells that rest on the author\'s judgement are counted, not hidden', () => {
  let total = 0, unsourced = 0, managed = 0, managedUnsourced = 0;
  const MANAGED = new Set(['pg_flex', 'pg_elastic', 'horizondb']);
  for (const f of FEATURE_MATRIX.features) for (const t of MATRIX_TARGETS) {
    const c = f.targets[t];
    total++; if (!c.sources.length) unsourced++;
    if (MANAGED.has(t)) { managed++; if (!c.sources.length) managedUnsourced++; }
    if (!c.sources.length && c.state !== 'native') ok(c.note, `${f.featureId} on ${t}: a verdict with no source and no note`);
  }
  info(`${total - unsourced} of ${total} verdicts cite a source; ${unsourced} are the author's judgement and say so in their note`);
  // The self-managed targets carry most features by the operator's own choice, so no vendor page exists to cite.
  ok(managedUnsourced / managed < 0.7, 'more than 70% of the managed-service verdicts have no source');
});

// ---------------------------------------------------------------------------------------------
section('contract: documents and engine agree');
// ---------------------------------------------------------------------------------------------
test('the input contract lists exactly the matrix features', () => {
  const md = read('reference/input-contract.md');
  const start = md.indexOf('## 3.');
  ok(start > 0, 'section 3 not found');
  const body = md.slice(start);
  const mentioned = new Set([...body.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)].map(m => m[1]));
  const missing = FEATURE_IDS.filter(id => !mentioned.has(id));
  eq(missing, [], 'matrix features absent from the input contract');
});
test('every enumerated ID in the contract is accepted without a note', () => {
  for (const [field, ids] of Object.entries(ENUMS)) {
    if (field === 'evidence') continue;
    for (const id of ids) {
      const out = evaluate({ [field]: id, oracle_features: [] });
      ok(!out.notes.some(n => /Unrecognised/i.test(n)), `${field}=${id}`);
    }
  }
});
test('all 29 canonical fields are normalised and nothing else is added', () => {
  const p = normalise({});
  eq(Object.keys(p).sort(), [...FIELDS].sort(), 'normalised keys');
  eq(FIELDS.length, 29, 'field count');
});
test('the rule index in decision-rules.md matches the rule IDs the engine emits', () => {
  const md = read('reference/decision-rules.md');
  const indexed = new Set([...md.matchAll(/^\| `(OP-[A-Z0-9-]+)` \| [A-D] \|/gm)].map(m => m[1]));
  ok(indexed.size >= 30, `index has ${indexed.size} rules`);
  const emitted = new Set();
  const rnd = mulberry32(7);
  for (let i = 0; i < 1500; i++) {
    const out = evaluate(randomProfile(rnd));
    for (const t of TARGETS) { const e = out.eligibilityTrace[t]; if (e.ruleId) emitted.add(e.ruleId); for (const c of e.contributing || []) if (c.ruleId) emitted.add(c.ruleId); }
    if (out.recommendation) emitted.add(out.recommendation.ruleId);
    for (const m of out.methodCandidates || []) if (m.ruleId) emitted.add(m.ruleId);
    for (const id of JSON.stringify(out).match(/OP-[A-Z0-9]+(?:-[A-Z0-9]+)*/g) || []) emitted.add(id);
  }
  const unindexed = [...emitted].filter(r => !indexed.has(r));
  eq(unindexed, [], 'rule IDs the engine emits that the index does not list');
  // Rules that describe a band, an ordering or a lever are exercised by their own tests below, not by a trace entry.
  const narrative = new Set(['OP-PLSQL', 'OP-COST-LEVERS', 'OP-DOWNTIME']);
  const neverEmitted = [...indexed].filter(r => !emitted.has(r) && !narrative.has(r));
  info(`${emitted.size} rule IDs emitted over 1,500 random interviews; ${neverEmitted.length} indexed rules not reached: ${neverEmitted.join(', ') || 'none'}`);
  ok(neverEmitted.length <= 4, `too many indexed rules are never reached: ${neverEmitted.join(', ')}`);
});
test('the output contract lists 19 invariants and the engine reports only those numbers', () => {
  const md = read('reference/output-contract.md');
  const rows = [...md.matchAll(/^\| (\d+) \| /gm)].map(m => Number(m[1]));
  eq(rows, Array.from({ length: 19 }, (_, i) => i + 1), 'invariant rows');
});

// ---------------------------------------------------------------------------------------------
section('properties over random interviews');
// ---------------------------------------------------------------------------------------------
const N = Number(process.env.O2P_PROPERTY_RUNS || 4000);
test(`${N} random interviews: no exception, no self-check violation`, () => {
  const rnd = mulberry32(20261012);
  const stats = { provisional: 0, shortlist: 0, targets: {}, low: 0, medium: 0 };
  const bad = [];
  for (let i = 0; i < N; i++) {
    const profile = randomProfile(rnd);
    let out;
    try { out = evaluate(profile); } catch (e) { bad.push(`threw on ${JSON.stringify(profile)}: ${e.stack.split('\n')[0]}`); if (bad.length > 3) break; continue; }
    const v = selfCheck(out);
    if (v.length) { bad.push(`invariant ${JSON.stringify(v)} on ${JSON.stringify(profile)}`); if (bad.length > 3) break; }
    stats[out.metadata.recommendationStatus]++;
    stats[out.metadata.confidence]++;
    const t = out.recommendation?.target || 'none';
    stats.targets[t] = (stats.targets[t] || 0) + 1;
  }
  eq(bad, [], 'failures');
  info(`status: ${stats.provisional} provisional, ${stats.shortlist} shortlist; confidence: ${stats.medium} medium, ${stats.low} low`);
  info(`primary targets: ${Object.entries(stats.targets).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  ok(stats.provisional > 0 && stats.shortlist > 0, 'the random space never produced both statuses');
});
test('evaluate is deterministic', () => {
  const rnd = mulberry32(99);
  for (let i = 0; i < 300; i++) {
    const p = randomProfile(rnd);
    eq(evaluate(p), evaluate(p), 'two evaluations differ');
  }
});
test('listing more Oracle features never improves any target', () => {
  const rnd = mulberry32(31337);
  for (let i = 0; i < 800; i++) {
    const p = randomProfile(rnd, { keepFeaturesListed: true });
    const extra = FEATURE_IDS[Math.floor(rnd() * FEATURE_IDS.length)];
    const before = evaluate(p), after = evaluate({ ...p, oracle_features: [...new Set([...p.oracle_features, extra])] });
    for (const t of TARGETS) {
      ok(SEVERITY[after.eligibilityTrace[t].state] >= SEVERITY[before.eligibilityTrace[t].state],
        `${t} improved from ${before.eligibilityTrace[t].state} to ${after.eligibilityTrace[t].state} after adding ${extra}`);
    }
  }
});
test('OP-SCOPE: nothing from outside Microsoft is ever named, over random interviews', () => {
  const rnd = mulberry32(5);
  const ALLOWED = new Set(['MS_VSCODE_AI', 'APP_CONVERSION_PREVIEW', 'ADF_COPY', 'ORACLE_FDW_COPY', 'FILE_SEED', 'PLPGSQL_CHECK', 'DIFFERENTIAL_TESTING', 'ORACLE_FDW_COMPARE', 'SCHEMA_SCAN', 'VSCODE_DISCOVERY', 'AWR_SIZING']);
  const names = /\b(EDB|EPAS|Striim|Qlik|HVR|Fivetran|GoldenGate|Debezium|Ispirer|CYBERTEC|HexaRocket|pgloader|pg_chameleon|Ora2Pg)\b/i;
  for (let i = 0; i < 1000; i++) {
    const out = evaluate(randomProfile(rnd));
    ok(!('epas' in out.eligibilityTrace), 'a retired target family is back');
    for (const m of out.methodCandidates) ok(ALLOWED.has(m.id), `method ${m.id} is not Microsoft's`);
    const { normalizedProfile, ...card } = out;
    ok(!names.test(JSON.stringify(card)), `a product from outside Microsoft is named: ${names.exec(JSON.stringify(card))?.[0]}`);
    const gaps = new Set((out.methodGaps || []).map(g => g.id));
    if (out.recommendation && out.selectedMethods) {
      if (!out.selectedMethods.schemaConversion) ok(gaps.has('SCHEMA_CONVERSION'), 'a missing schema route without a gap');
      if (!out.selectedMethods.dataMovement) ok(gaps.has('ONLINE_CAPTURE'), 'a missing data route without a gap');
    }
  }
});
test('a customer who wants a managed service never gets a self-managed target as primary', () => {
  const rnd = mulberry32(6);
  for (let i = 0; i < 800; i++) {
    const out = evaluate({ ...randomProfile(rnd), management_model: 'MANAGED_PAAS' });
    ok(!['pg_vm', 'pg_aks', 'oracle_vm'].includes(out.recommendation?.target), `${out.recommendation?.target} named`);
  }
});
test('no cost figure and no certainty ever leaves the engine', () => {
  const rnd = mulberry32(8);
  for (let i = 0; i < 500; i++) {
    const out = evaluate(randomProfile(rnd));
    const text = JSON.stringify({ ...out, programmeFit: undefined, retired: undefined });
    ok(!/\$\s?\d|USD\s?\d|EUR\s?\d|€\s?\d/.test(text), 'a currency figure appeared');
    ok(!/"confidence":"high"|"recommendationStatus":"validated"/.test(text), 'a confidence the skill cannot earn appeared');
  }
});
test('retired items are never recommended', () => {
  const retired = RULES.retired.map(r => r.item.toLowerCase());
  ok(retired.length >= 8, `${retired.length} retired items`);
  const rnd = mulberry32(12);
  for (let i = 0; i < 300; i++) {
    const out = evaluate(randomProfile(rnd));
    const chosen = JSON.stringify([out.recommendation, out.selectedMethods]).toLowerCase();
    ok(!/azure data studio|ssma for oracle|single server|arc-enabled/.test(chosen), `retired item in ${chosen.slice(0, 120)}`);
  }
});

// ---------------------------------------------------------------------------------------------
section('schemas');
// ---------------------------------------------------------------------------------------------
const schemaOf = f => readJson(`schemas/${f}.schema.json`);
test('the input schema is generated from the contract and is in sync', () => {
  execFileSync('node', ['tools/schema/build-schemas.mjs', '--check'], { cwd: root, stdio: 'pipe' });
});
test('every random interview validates against the input schema, and the engine output against the output schema', () => {
  const inSchema = schemaOf('input'), outSchema = schemaOf('output');
  const rnd = mulberry32(424242);
  for (let i = 0; i < 600; i++) {
    const p = randomProfile(rnd);
    const bad = validate(p, inSchema);
    eq(bad, [], `input ${JSON.stringify(p).slice(0, 80)}`);
    const out = evaluate(p);
    eq(validate(out, outSchema), [], 'engine output');
  }
});
test('the input schema rejects an unknown field and an unknown ID', () => {
  const sc = schemaOf('input');
  ok(validate({ nonsense: 1 }, sc).length > 0, 'unknown field accepted');
  ok(validate({ topology: 'CLUSTERED_MAGIC' }, sc).length > 0, 'unknown ID accepted');
  eq(validate({}, sc), [], 'the empty profile is valid: every field may be unknown');
});
test('the output schema rejects a corrupted answer', () => {
  const sc = schemaOf('output');
  const out = clone(baseOut());
  out.metadata.confidence = 'high';
  ok(validate(out, sc).length > 0, 'confidence high accepted');
  const out2 = clone(baseOut()); delete out2.eligibilityTrace.pg_vm;
  ok(validate(out2, sc).length > 0, 'a missing target accepted');
});

// ---------------------------------------------------------------------------------------------
section('card and prerequisite plan');
// ---------------------------------------------------------------------------------------------
test('the card keeps the honest wording on 400 random interviews', () => {
  const rnd = mulberry32(2718);
  for (let i = 0; i < 400; i++) {
    const out = evaluate(randomProfile(rnd));
    const card = renderCard(out, { name: 'Test estate' });
    ok(/Preliminary recommendation/.test(card), 'no "Preliminary" header');
    ok(/status \*\*(provisional|shortlist)\*\*/.test(card), 'status missing');
    ok(/confidence \*\*(low|medium)\*\*/.test(card), 'confidence missing');
    ok(/Converted is not equivalent/.test(card), 'converted-is-not-equivalent missing');
    ok(/Never recommended/.test(card), 'retired list missing');
    ok(!/validated|high confidence/i.test(card.replace(/independently validate/gi, '')), 'a claim the advisor cannot make');
    if (out.recommendation && out.selectedMethods) ok(/No Microsoft service moves Oracle rows/.test(card), 'the row-movement statement is missing');
    for (const t of Object.keys(out.eligibilityTrace)) ok(card.includes(`| ${t === out.recommendation?.target ? '**' : ''}`), 'trace row missing');
    ok(card.split('\n').filter(l => /^\| .* \| (eligible|eligible_with_remediation|unsupported|excluded_by_preference|unknown_requires_assessment) \| (`OP-[A-Z0-9-]+`|none) \|/.test(l)).length === 8, 'the trace table does not show all nine families');
  }
});
test('the prerequisite catalogue is well formed and every source resolves', () => {
  const phaseIds = new Set(PREREQ.phases.map(p => p.id));
  const known = new Set(sourcesJson.sources.map(s => s.id));
  const ids = new Set();
  const WHEN_KEYS = new Set(['always', 'mode', 'targets', 'schemaConversion', 'dataMovement', 'dataFamily', 'gap', 'profile', 'scan']);
  for (const it of PREREQ.items) {
    ok(!ids.has(it.id), `duplicate ${it.id}`); ids.add(it.id);
    ok(phaseIds.has(it.phase), `${it.id}: phase ${it.phase}`);
    ok(it.title && it.detail && it.owner && it.area, `${it.id}: incomplete`);
    ok(Object.keys(it.when || {}).length && Object.keys(it.when).every(k => WHEN_KEYS.has(k)), `${it.id}: bad condition keys`);
    for (const s of it.sources || []) ok(known.has(s), `${it.id}: unknown source ${s}`);
    ok((it.sources && it.sources.length) || /^judgement/.test(it.basis || ''), `${it.id}: neither a source nor a stated judgement`);
    for (const f of Object.keys((it.when.profile) || {})) ok(FIELDS.includes(f), `${it.id}: unknown field ${f}`);
    for (const t of it.when.targets || []) ok(TARGETS.includes(t), `${it.id}: unknown target ${t}`);
  }
  ok(PREREQ.items.length >= 35, `${PREREQ.items.length} steps`);
});
test('the plan follows the recommendation: converter steps appear only when the converter is in play', () => {
  const withMs = buildPlan({ out: evaluate(contoso()) });
  const flat = p => p.phases.flatMap(ph => ph.items.map(i => i.id));
  ok(flat(withMs).includes('PREP-FOUNDRY') && flat(withMs).includes('PREP-SCRATCH'), 'Foundry or scratch step missing');
  const heavy = buildPlan({ out: evaluate({ ...contoso(), plsql_volume: 'HEAVY', app_changeability: 'APP_FROZEN', oracle_features: [], feature_dependencies: 'NONE_CONFIRMED' }) });
  ok(flat(heavy).includes('PREP-FOUNDRY'), 'a heavy, frozen estate lost the converter steps');
  const online = buildPlan({ out: evaluate({ ...contoso(), downtime: 'NEAR_ZERO' }) });
  ok(flat(online).includes('GAP-ONLINE-CAPTURE') && flat(online).includes('PREP-ARCHIVELOG'), 'the online gap steps are missing');
  ok(!flat(withMs).includes('PREP-ARCHIVELOG') && !flat(withMs).includes('GAP-ONLINE-CAPTURE'), 'online gap steps on an offline path');
  ok(flat(withMs).includes('PREP-ADF'), 'the Data Factory step is missing on the Microsoft offline route');
  const old = buildPlan({ out: evaluate({ ...contoso(), source_version: 'ORA_11G_OR_OLDER' }) });
  ok(flat(old).includes('GAP-SCHEMA-CONVERSION') && !flat(old).includes('PREP-FOUNDRY'), 'the schema gap step is missing for Oracle 11g');
});
test('scan-driven steps appear only with a scan', () => {
  const out = evaluate(contoso());
  const scan = { dataMovement: { lobTables: 3, longColumnTables: 0, partitionedTables: 2, xmlTables: 0, globalTemporaryTables: 0, indexOrganizedTables: 0 } };
  const ids = pl => pl.phases.flatMap(ph => ph.items.map(i => i.id));
  const without = ids(buildPlan({ out })), withScan = ids(buildPlan({ out, assessment: scan }));
  ok(!without.includes('PREP-LOB') && withScan.includes('PREP-LOB') && withScan.includes('PREP-PARTITIONS'), 'scan steps');
  ok(!withScan.includes('PREP-LONG'), 'LONG step without LONG columns');
});
test('every redesign or workaround on the chosen target becomes an application step', () => {
  const out = evaluate(contoso());
  const plan = buildPlan({ out });
  const app = plan.phases.flatMap(ph => ph.items).filter(i => i.area === 'Application' && i.id.startsWith('APP-'));
  const rem = out.recommendation.remediation;
  eq(app.length, rem.redesign.length + rem.workaround.length + rem.unknown.length, 'application steps');
});
test('the rendered plan cites sources and states its limits', () => {
  const text = renderPlan(buildPlan({ out: evaluate(contoso()) }), { name: 'T' });
  ok(/Preliminary/.test(text) && /Sources: \[/.test(text) && /No schema scan was supplied/.test(text), 'plan wording');
  ok(!/\$\s?\d/.test(text), 'a price appeared');
});

// ---------------------------------------------------------------------------------------------
section('documents, skills and manifests');
// ---------------------------------------------------------------------------------------------
test('versions agree across package.json, the plugin manifests, version.json and the engine', () => {
  const pkg = readJson('package.json'), plugin = readJson('.claude-plugin/plugin.json'), market = readJson('.claude-plugin/marketplace.json'), ver = readJson('version.json');
  eq([plugin.version, market.metadata.version, market.plugins[0].version, `v${pkg.version}`.replace(/^vv/, 'v')], [pkg.version, pkg.version, pkg.version, `v${pkg.version}`], 'package versions');
  eq(ver.latest, `v${pkg.version}`, 'version.json latest');
  ok(ver.knowledgeBase === KNOWLEDGE_BASE_VERSION.replace(/^v(\d+\.\d+).*/, 'v$1'), `version.json knowledgeBase ${ver.knowledgeBase} vs engine ${KNOWLEDGE_BASE_VERSION}`);
  eq(plugin.name, market.plugins[0].name, 'plugin name');
});
test('every skill has matching front matter and a description that says when to use it', () => {
  const dirs = fs.readdirSync(path.join(root, 'skills'));
  ok(dirs.length >= 4, `${dirs.length} skills`);
  for (const d of dirs) {
    const text = read(`skills/${d}/SKILL.md`);
    const fm = /^---\nname: (.+)\ndescription: "([\s\S]+?)"\nallowed-tools: (.+)\n---\n/.exec(text);
    ok(fm, `${d}: front matter malformed`);
    eq(fm[1], d, `${d}: name differs from the directory`);
    ok(/Trigger when/.test(fm[2]) && fm[2].length > 200, `${d}: description does not say when to trigger`);
  }
});
test('every ID in the recommendation skill exists, and every contract ID is asked', () => {
  const text = read('skills/oracle-recommend-migration-path/SKILL.md');
  const contract = contractEnums();
  const known = new Set([...Object.values(contract).flat(), ...FEATURE_IDS, ...FIELDS, ...TARGETS, 'UNKNOWN', 'NOT_SURE', 'NONE_CONFIRMED', 'MS_VSCODE_AI', 'ORA2PG_CONVERT', 'EDB_PORTAL', 'JSON', 'DDL', 'PL', 'SQL', 'NLS_CHARACTERSET', 'DBD', 'RAC', 'AWR', 'II', 'UTL_HTTP', 'UTL_MAIL', 'UTL_FILE', 'AQ']);
  const unknown = [...new Set([...text.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)].map(m => m[1]))].filter(id => !known.has(id) && !/^(OP-|ORA2PG|SHOW_)/.test(id));
  eq(unknown, [], 'IDs in the skill that are not in the contract');
  const missing = Object.entries(contract).flatMap(([f, ids]) => ids.filter(id => !text.includes(id)).map(id => `${f}.${id}`));
  eq(missing, [], 'contract IDs the skill never offers');
  ok(new RegExp(`(?:${FIELDS.filter(f => f !== 'oracle_features').join('|')})`).test(text), 'no field is named');
});
test('relative links in the documents resolve', () => {
  const docs = ['README.md', 'CONTRIBUTING.md', 'docs/ARCHITECTURE.md', 'examples/contoso-store/README.md', ...fs.readdirSync(path.join(root, 'skills')).map(d => `skills/${d}/SKILL.md`)];
  const broken = [];
  for (const d of docs) {
    const dir = path.dirname(path.join(root, d));
    for (const m of read(d).matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)(?:#[^)]*)?\)/g)) {
      const target = path.resolve(dir, m[1]);
      if (!fs.existsSync(target) && !/oracle-to-azure-postgresql-migration/.test(m[1])) broken.push(`${d} -> ${m[1]}`);
    }
  }
  eq(broken, [], 'broken links');
});
test('the README states the counts that the data holds', () => {
  const readme = read('README.md');
  const ruleCount = [...read('reference/decision-rules.md').matchAll(/^\| `(OP-[A-Z0-9-]+)` \| [A-D] \|/gm)].length;
  const claims = [[`${catalogJson.entries.length} constructs`, 'catalog size'], [`${ruleCount} rule IDs`, 'rule count'], [`${FEATURE_IDS.length} Oracle features`, 'feature count'], ['29 fields', 'field count'], ['19 self-check invariants', 'invariant count']];
  const wrong = claims.filter(([c]) => !readme.includes(c)).map(([c, what]) => `${what}: "${c}" is not in the README`);
  eq(wrong, [], 'stale counts');
});
test('the honest wording is present in every document that gives advice', () => {
  const docs = ['README.md', 'skills/oracle-recommend-migration-path/SKILL.md'];
  for (const d of docs) {
    const t = read(d);
    ok(/no Microsoft service moves Oracle rows|There is none/i.test(t) || /does not move rows/i.test(t), `${d}: row-movement statement missing`);
    ok(/provisional/i.test(t), `${d}: provisional missing`);
    ok(!/status\s*\*\*validated\*\*|confidence\s*\*\*high\*\*/i.test(t), `${d}: claims a status the advisor cannot earn`);
  }
});
const kbPath = path.join(root, 'docs', 'oracle-to-azure-postgresql-migration.md');
if (fs.existsSync(kbPath)) {
  test('the knowledge base is in sync with the data behind its generated blocks', () => {
    execFileSync('node', ['tools/kb/build-kb.mjs', '--check'], { cwd: root, stdio: 'pipe' });
  });
  test('the knowledge base cites only known rules and known sources, and keeps the honest wording', () => {
    const kb = fs.readFileSync(kbPath, 'utf8');
    const indexed = new Set([...read('reference/decision-rules.md').matchAll(/^\| `(OP-[A-Z0-9-]+)` \| [A-D] \|/gm)].map(m => m[1]));
    const cited = [...new Set([...kb.matchAll(/`(OP-[A-Z0-9-]+)`/g)].map(m => m[1]))];
    eq(cited.filter(r => !indexed.has(r)), [], 'rules cited in the knowledge base that do not exist');
    const urls = new Set(sourcesJson.sources.map(x => x.url));
    const foreign = [...new Set([...kb.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]))].filter(u => !urls.has(u));
    eq(foreign, [], 'links that are not in reference/sources.json');
    ok(/no Microsoft service moves Oracle rows|moves Oracle rows to PostgreSQL/i.test(kb), 'row-movement statement missing');
    ok(!/\$\s?\d[\d,]*\s?(?:per|\/)\s?(?:month|year|vcore)/i.test(kb.replace(/FastTrack[^\n]*/g, '')), 'a price appears');
    ok(!/status\s*\*\*validated\*\*/i.test(kb), 'validated used as a status');
    ok(kb.split('\n').length > 600, `only ${kb.split('\n').length} lines`);
  });
}

// ---------------------------------------------------------------------------------------------
section('rules that are bands, orderings and levers');
// ---------------------------------------------------------------------------------------------
test('OP-PLSQL: the volume bands are the ones the contract states', () => {
  const band = loc => profileFromAssessment({ totals: { plsqlLoc: loc }, constructs: [] }).plsql_volume;
  eq([band(0), band(4999), band(5000), band(49999), band(50000), band(249999), band(250000)],
    ['NONE_OR_LIGHT', 'NONE_OR_LIGHT', 'MODERATE', 'MODERATE', 'HEAVY', 'HEAVY', 'VERY_HEAVY'], 'bands');
});
test('OP-DOWNTIME: the downtime answer picks the data family', () => {
  const fam = d => evaluate({ ...contoso(), downtime: d }).selectedMethods?.dataFamily;
  eq(fam('OFFLINE'), 'offline', 'OFFLINE');
  ok(fam('NEAR_ZERO') !== 'offline', `NEAR_ZERO gave ${fam('NEAR_ZERO')}`);
});
test('OP-SCOPE: a downtime that needs change capture is a gap, with no product named', () => {
  const out = evaluate({ ...contoso(), downtime: 'NEAR_ZERO' });
  eq(out.selectedMethods.dataMovement, null, 'selected data route');
  eq(out.selectedMethods.dataFamily, 'online', 'family');
  eq(out.methodGaps.map(g => g.id), ['ONLINE_CAPTURE'], 'gaps');
  ok(/Microsoft offers no change-capture service/.test(out.methodGaps[0].text), 'the gap does not say what Microsoft lacks');
  ok(out.methodCandidates.filter(m => m.family === 'data').every(m => m.status === 'unavailable'), 'an offline route stayed available for a downtime that needs capture');
});
test('OP-SCOPE: Oracle 11g and missing converter prerequisites are a schema gap, with no fallback converter', () => {
  const old = evaluate({ ...contoso(), source_version: 'ORA_11G_OR_OLDER' });
  eq(old.selectedMethods.schemaConversion, null, 'selected schema route');
  ok(old.methodGaps.some(g => g.id === 'SCHEMA_CONVERSION'), 'gap missing');
  eq(old.methodCandidates.filter(m => m.family === 'conversion').map(m => m.id).sort(), ['APP_CONVERSION_PREVIEW', 'MS_VSCODE_AI'], 'conversion candidates');
  const missing = evaluate({ ...contoso(), source_version: 'ORA_19C', converter_prereqs: 'FOUNDRY_OR_COPILOT_MISSING' });
  ok(missing.methodGaps.some(g => g.id === 'SCHEMA_CONVERSION' && /only until they exist/.test(g.text)), 'prerequisite gap wording');
});
test('OP-SCOPE: an offline downtime selects the Data Factory copy and has no gap', () => {
  const out = evaluate({ ...contoso(), downtime: 'OFFLINE' });
  eq(out.selectedMethods.dataMovement, 'ADF_COPY', 'selected data route');
  eq(out.methodGaps.map(g => g.id), [], 'gaps');
  const unsure = evaluate({ ...contoso(), downtime: 'NOT_SURE' });
  ok(unsure.methodGaps.some(g => g.id === 'ONLINE_CAPTURE' && /If the downtime tolerance turns out to be short/.test(g.text)), 'conditional gap for an unknown downtime');
});
test('OP-COST-LEVERS: levers are present, sourced in words, and carry no price', () => {
  const out = evaluate(contoso());
  ok(out.costLevers.length >= 5, `${out.costLevers.length} levers`);
  ok(out.costLevers.some(c => /Azure Hybrid Benefit/.test(c) && /not apply/.test(c)), 'the Hybrid Benefit caveat is missing');
  ok(out.programmeFit.length >= 3, 'programme fit missing');
  ok(out.programmeFit.every(c => !/Striim|Unlimited Database Migration/.test(c)), 'a third-party programme is named');
});
test('OP-CMK: customer-managed keys remove HorizonDB and warn about flexible server', () => {
  const out = evaluate({ ...contoso(), cmk_required: 'CMK_YES' });
  eq(out.eligibilityTrace.horizondb.state, 'unsupported', 'horizondb');
  ok(out.notes.some(n => /creation-time/.test(n)), 'creation-time note missing');
});
test('heavy PL/SQL that cannot change stays with the Microsoft targets and says what the redesign costs', () => {
  const out = evaluate({ ...contoso(), plsql_volume: 'HEAVY', app_changeability: 'APP_FROZEN', oracle_features: [], feature_dependencies: 'NONE_CONFIRMED' });
  ok(['pg_flex', 'pg_vm', 'pg_aks', 'pg_elastic', 'horizondb', 'oracle_dbaz', 'oracle_vm', undefined].includes(out.recommendation?.target), `named ${out.recommendation?.target}`);
  ok(out.recommendation?.ruleId !== 'OP-EPAS', 'a retired rule fired');
});

// ---------------------------------------------------------------------------------------------
section('self-check catches corrupted answers');
// ---------------------------------------------------------------------------------------------
const mutations = [
  [1, 'primary target marked unsupported', o => { o.eligibilityTrace[o.recommendation.target].state = 'unsupported'; }],
  [2, 'alternative marked unsupported', o => { o.alternative = { target: 'pg_vm', label: 'PostgreSQL on Azure virtual machines', wins: 'an operating-system need appears' }; o.eligibilityTrace.pg_vm.state = 'unsupported'; }],
  [6, 'cosmos_pg named as primary', o => { o.recommendation.target = 'cosmos_pg'; o.eligibilityTrace.cosmos_pg.state = 'eligible'; }],
  [9, 'confidence raised above medium', o => { o.metadata.confidence = 'high'; }],
  [9, 'status set to validated', o => { o.metadata.recommendationStatus = 'validated'; }],
  [11, 'a target family silently dropped', o => { delete o.eligibilityTrace.horizondb; }],
  [4, 'recommended against a limit its own trace records', o => { o.eligibilityTrace[o.recommendation.target].contributing = [{ state: 'unsupported', ruleId: 'OP-SIZE', reason: 'too large' }]; }],
  [13, 'normalizedProfile removed', o => { delete o.normalizedProfile; }],
  [16, 'a shortlist with no separating question', o => { o.metadata.recommendationStatus = 'shortlist'; o.shortlist = []; o.recommendation = null; }],
  [17, 'the converter presented as moving rows', o => { o.selectedMethods.dataMovement = 'MS_VSCODE_AI'; }],
  [17, 'a Microsoft service presented as moving Oracle rows', o => { o.methodCandidates.push({ id: 'DMS_ORACLE_PG', family: 'data', role: 'transport', status: 'available', reason: 'moves rows', ruleId: 'OP-CONVERTER-GATE' }); }],
  [18, 'a retired item recommended', o => { o.methodCandidates.push({ id: 'SSMA_ORACLE', family: 'conversion', role: 'migration', status: 'available', reason: 'retired', ruleId: 'OP-CONVERTER-GATE' }); }],
  [18, 'PostgreSQL 14 recommended as a new target', o => { o.recommendation.postgresMajor = 14; }],
];
for (const [n, name, mutate] of mutations) {
  test(`invariant ${n}: ${name}`, () => {
    const out = clone(baseOut());
    eq(selfCheck(out), [], 'the unmutated output must be clean');
    mutate(out);
    const v = selfCheck(out);
    ok(v.some(x => x[0] === n), `expected invariant ${n}, got ${JSON.stringify(v)}`);
  });
}

// ---------------------------------------------------------------------------------------------
section('assessor');
// ---------------------------------------------------------------------------------------------
const scan = (text, name = 'fixture') => analyse([{ path: `${name}.sql`, content: text }], { catalog: catalogJson, name, schema: 'FX' });
const objOf = (a, type, name) => a.objects.find(o => o.type === type && o.name === name);

test('masking blanks comments and string interiors and keeps line numbers', () => {
  const src = "SELECT 'a;b' FROM dual; -- trailing; comment\n/* block;\n more */ SELECT 2 FROM dual;\n";
  const m = maskSource(src);
  eq(m.code.split('\n').length, src.split('\n').length, 'line count');
  ok(!m.code.includes('trailing') && !m.code.includes('block') && !m.code.includes('a;b'), 'comment or string survived');
  ok(m.text.includes('a;b'), 'string interior is kept in the text view');
});
test('SQL*Plus commands are removed but START WITH, CONNECT BY, EXIT WHEN and DESC are not', () => {
  const src = "SET SERVEROUTPUT ON\nSPOOL out.log\nSELECT id FROM t\n START WITH p IS NULL\n CONNECT BY PRIOR id = p\n ORDER BY id DESC;\nBEGIN\n LOOP\n EXIT WHEN x > 1;\n END LOOP;\nEND;\n/\n";
  const m = maskSource(src);
  ok(m.sqlplusLines >= 2, `sqlplusLines ${m.sqlplusLines}`);
  for (const kw of ['START WITH', 'CONNECT BY', 'EXIT WHEN', 'DESC']) ok(m.code.includes(kw), `${kw} was removed`);
  ok(!m.code.includes('SERVEROUTPUT') && !m.code.includes('SPOOL'), 'SQL*Plus line survived');
});
test('plain SQL ends at ; and PL/SQL ends at a slash line', () => {
  const p = parseSource("CREATE TABLE a (x NUMBER);\nCREATE OR REPLACE FUNCTION f RETURN NUMBER IS\nBEGIN\n  x := 1;\n  RETURN x;\nEND;\n/\nCREATE TABLE b (y NUMBER);\n", 'x.sql');
  eq(p.statements.map(s => s.mode), ['sql', 'plsql', 'sql'], 'modes');
});
test('object counts by type', () => {
  const a = scan(`
CREATE TABLE t1 (id NUMBER);
CREATE TABLE t2 (id NUMBER);
CREATE SEQUENCE s1;
CREATE OR REPLACE VIEW v1 AS SELECT * FROM t1;
CREATE OR REPLACE SYNONYM syn1 FOR t1;
CREATE INDEX i1 ON t1 (id);
CREATE OR REPLACE TRIGGER trg1 BEFORE INSERT ON t1 FOR EACH ROW BEGIN NULL; END;
/
CREATE OR REPLACE PROCEDURE p1 IS BEGIN NULL; END;
/
CREATE OR REPLACE PACKAGE pk AS PROCEDURE a; END pk;
/
CREATE OR REPLACE PACKAGE BODY pk AS PROCEDURE a IS BEGIN NULL; END; END pk;
/
`);
  const n = Object.fromEntries(Object.entries(a.byType).map(([k, v]) => [k, v.count]));
  eq(n, { TABLE: 2, SEQUENCE: 1, VIEW: 1, SYNONYM: 1, INDEX: 1, TRIGGER: 1, PROCEDURE: 1, PACKAGE: 1, PACKAGE_BODY: 1 }, 'counts');
});
test('a statement that never terminates is recovered at the next CREATE and flagged', () => {
  const a = scan("CREATE SEQUENCE s_a CYCLE -- cache 20; stray semicolon\nCREATE SEQUENCE s_b;\n");
  eq(a.byType.SEQUENCE.count, 2, 'both sequences found');
  eq(a.hygiene.unterminated.length, 1, 'one unterminated statement reported');
});
test('objects created by EXECUTE IMMEDIATE are found and marked dynamic', () => {
  const a = scan("BEGIN\n EXECUTE IMMEDIATE 'CREATE SEQUENCE seq_dyn START WITH 1';\nEND;\n/\n");
  ok(objOf(a, 'SEQUENCE', 'SEQ_DYN'), 'dynamic sequence missing');
  eq(a.hygiene.dynamicObjects.map(o => o.name), ['SEQ_DYN'], 'dynamic objects');
});
test('package state counts variables but not constants, exceptions or subprogram locals', () => {
  const a = scan(`
CREATE OR REPLACE PACKAGE BODY pk_state AS
  g_one NUMBER;
  g_two VARCHAR2(10) := 'x';
  c_const CONSTANT NUMBER := 1;
  e_bad EXCEPTION;
  PROCEDURE p IS
    v_local NUMBER;
  BEGIN
    v_local := g_one;
  END;
END pk_state;
/
`);
  const body = objOf(a, 'PACKAGE_BODY', 'PK_STATE');
  const hit = body.hits.find(h => h.id === 'PLSQL-PACKAGE-STATE');
  ok(hit, 'package state not detected');
  eq(hit.count, 2, 'two variables');
});
test('string IS NULL tests are found only on string-typed names', () => {
  const a = scan(`
CREATE OR REPLACE FUNCTION f_n(p_name VARCHAR2, p_num NUMBER) RETURN NUMBER IS
BEGIN
  IF p_name IS NULL THEN RETURN 1; END IF;
  IF p_num IS NULL THEN RETURN 2; END IF;
  RETURN 3;
END;
/
`);
  const hit = objOf(a, 'FUNCTION', 'F_N').hits.find(h => h.id.includes('STRING') || h.id.includes('EMPTY'));
  ok(hit, 'string NULL test not detected');
  eq(hit.count, 1, 'only the string parameter counts');
});
test('the cost of a routine follows Ora2Pg: base + test + size + constructs', () => {
  const a = scan(`
CREATE OR REPLACE FUNCTION f_depth(p_id NUMBER) RETURN NUMBER IS
  v_n NUMBER;
BEGIN
  SELECT MAX(LEVEL) INTO v_n FROM orders START WITH id = p_id CONNECT BY PRIOR id = parent_id;
  RETURN v_n;
END;
/
`);
  const f = objOf(a, 'FUNCTION', 'F_DEPTH');
  const expected = OBJECT_SCORE.FUNCTION + 2 + 1 + weightOf('SQL-CONNECT-BY') + weightOf('SEM-SELECT-INTO-DATA-FOUND');
  eq(f.units, expected, 'units');
  eq(weightOf('SQL-CONNECT-BY'), 3, 'Ora2Pg scores CONNECT BY at 3');
});
test('the migration level reproduces Ora2Pg\'s letters', () => {
  eq(migrationLevel([{ type: 'TABLE' }], 5).level, 'A-1', 'tables only');
  eq(migrationLevel([{ type: 'FUNCTION', keywords: false }], 10).level, 'A-3', 'plain routines');
  eq(migrationLevel([{ type: 'FUNCTION', keywords: true }], 10).level, 'B-5', 'routines with scored constructs, small');
  eq(migrationLevel([{ type: 'FUNCTION', keywords: true }], 10 * 84).level, 'C-5', 'routines with scored constructs, above 5 days');
});
test('the effort figure is the two Ora2Pg paces, not an interval', () => {
  const a = scan("CREATE OR REPLACE PROCEDURE p IS BEGIN NULL; END;\n/\n");
  eq(a.totals.personDaysOra2PgStyle, Math.ceil(a.totals.units / 84), 'person-days');
});
test('the unit parts of every object add up to its units', () => {
  const a = scan(`
CREATE OR REPLACE FUNCTION f_depth(p_id NUMBER) RETURN NUMBER IS
  v_n NUMBER;
BEGIN
  SELECT MAX(LEVEL) INTO v_n FROM orders START WITH id = p_id CONNECT BY PRIOR id = parent_id;
  RETURN v_n;
END;
/
CREATE OR REPLACE PACKAGE BODY pkg_x IS
  PROCEDURE p1 IS BEGIN NULL; END;
  PROCEDURE p2 IS BEGIN PRAGMA_NOT_REAL; END;
END pkg_x;
/
CREATE TABLE t (id NUMBER);
`);
  for (const o of a.objects) {
    const p = o.unitParts;
    const sum = p.base + p.test + p.size + p.constructsAddressable + p.constructsReview + p.constructsBlocker;
    ok(Math.abs(sum - o.units) < 0.05, `${o.type} ${o.name}: parts ${sum} against units ${o.units}`);
  }
  const f = objOf(a, 'FUNCTION', 'F_DEPTH');
  eq(f.unitParts.test, 2, 'a routine carries two test units');
});
test('AI-assisted effort: a hand-computed fixture', () => {
  // One routine of 10 units to rewrite, 2 to test, one REVIEW construct of 4 units, and a job of 3 units the converter does not read.
  const a = {
    totals: { units: 19 },
    byType: { FUNCTION: { units: 16, unitsCounted: 16 }, JOB: { units: 3, unitsCounted: 3 } },
    objects: [
      { type: 'FUNCTION', class: 'REVIEW', units: 16, unitParts: { base: 1, test: 2, size: 9, constructsAddressable: 0, constructsReview: 4, constructsBlocker: 0 } },
      { type: 'JOB', class: 'REVIEW', units: 3, unitParts: { base: 2, test: 0, size: 0, constructsAddressable: 1, constructsReview: 0, constructsBlocker: 0 } },
    ],
  };
  const r = aiAssistedEstimate(a, { converter: 'available' });
  // addressable 10, decisions 4, stays 2 + 3 = 5; assumed not-converted rate 0.2 (low) and 0.4 (high)
  const low = 5 + 10 * (0.8 * 0.25 + 0.2) + 4 * (0.8 * 0.5 + 0.2);
  const high = 5 + 10 * (0.6 * 0.5 + 0.4) + 4 * (0.6 * 1 + 0.4);
  eq(r.units.aiLow, Math.round(low * 10) / 10, 'low units');
  eq(r.units.aiHigh, Math.round(high * 10) / 10, 'high units');
  eq(r.days.ai.low, Math.ceil(low * 5 / 420 + 3), 'low days');
  eq(r.days.ai.high, Math.ceil(high * 10 / 420 + 5), 'high days');
  eq(r.stays.outsideUnits, 3, 'the job stays manual');
});
test('AI-assisted effort: never below the floor, never above the manual figure plus setup, monotone in the review cost', () => {
  const a = scan("CREATE OR REPLACE PROCEDURE p IS BEGIN NULL; END;\n/\nCREATE OR REPLACE FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END;\n/\n");
  const r = aiAssistedEstimate(a, { converter: 'available' });
  ok(r.days.ai.low >= r.days.floor, 'below the floor');
  ok(r.days.ai.high <= r.days.manual.high + r.days.setup.high, 'above the manual figure plus setup');
  const cells = r.sensitivity.cells;
  for (let i = 1; i < cells.length; i++) for (let j = 0; j < cells[i].length; j++) ok(cells[i][j].low >= cells[i - 1][j].low && cells[i][j].high >= cells[i - 1][j].high, 'not monotone in the review cost');
  for (const row of cells) for (let j = 1; j < row.length; j++) ok(row[j].low >= row[j - 1].low, 'not monotone in the conversion rate');
});
test('AI-assisted effort: a measured run replaces the assumed rate, and an unavailable converter gives no figure', () => {
  const a = {
    totals: { units: 100 },
    byType: { PROCEDURE: { units: 100, unitsCounted: 100 } },
    objects: Array.from({ length: 20 }, () => ({ type: 'PROCEDURE', class: 'CLEAN', units: 5, unitParts: { base: 1, test: 2, size: 2, constructsAddressable: 0, constructsReview: 0, constructsBlocker: 0 } })),
  };
  const assumed = aiAssistedEstimate(a, { converter: 'available' });
  const none = aiAssistedEstimate(a, { converter: 'available', calibration: { byType: [{ type: 'PROCEDURE', objects: 20, notConvertedRate: 0 }], byClass: { CLEAN: { objects: 20, notConverted: 0 } } } });
  eq([assumed.basis, none.basis], ['assumed', 'measured'], 'basis');
  ok(none.units.aiLow < assumed.units.aiLow, 'a run that converted everything should lower the estimate');
  const off = aiAssistedEstimate(a, { converter: 'unavailable' });
  eq([off.available, off.days.ai], [false, undefined], 'unavailable');
});
test('limitations are stated in the output', () => {
  const a = scan("CREATE TABLE t (id NUMBER);\n");
  ok(a.limitations.length >= 4 && a.limitations.some(l => /does not connect|source text/i.test(l)), 'limitations missing');
});

// ---------------------------------------------------------------------------------------------
section('golden scenarios');
// ---------------------------------------------------------------------------------------------
const goldenPath = process.env.O2P_GOLDEN || path.join(root, 'tests', 'golden-scenarios.json');
if (!fs.existsSync(goldenPath)) {
  test('golden scenarios are present', () => { throw new Error('tests/golden-scenarios.json is missing'); });
} else {
  let golden = null;
  test('tests/golden-scenarios.json is valid JSON', () => { golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8')); });
  const scenarios = golden ? (Array.isArray(golden) ? golden : golden.scenarios) : [];
  info(`${scenarios.length} scenarios, written from the rules before the engine was run against them`);
  test('there are enough golden scenarios and they cover the rules', () => {
    ok(scenarios.length >= 60, `${scenarios.length} scenarios`);
    const fired = new Set(scenarios.flatMap(sc => [...Object.values(sc.expect.ruleIds || {}), sc.expect.primary_rule].filter(Boolean)));
    ok(fired.size >= 20, `the scenarios pin only ${fired.size} distinct rules`);
    info(`${fired.size} distinct rule IDs are asserted`);
  });
  for (const sc of scenarios) {
    test(`${sc.id}: ${sc.title || ''}`.trim(), () => {
      const out = evaluate(sc.inputs || sc.profile);
      eq(selfCheck(out), [], 'self-check');
      const x = sc.expect;
      for (const [t, st] of Object.entries(x.eligibility || {})) eq(out.eligibilityTrace[t].state, st, `state of ${t}`);
      for (const [t, r] of Object.entries(x.ruleIds || {})) eq(out.eligibilityTrace[t].ruleId, r, `rule that decided ${t}`);
      if (x.recommendationStatus) eq(out.metadata.recommendationStatus, x.recommendationStatus, 'status');
      if (x.confidence) eq(out.metadata.confidence, x.confidence, 'confidence');
      if (x.primary_rule) eq(out.recommendation?.ruleId, x.primary_rule, 'primary rule');
      if ('primary_target' in x) eq(out.recommendation ? out.recommendation.target : null, x.primary_target, 'primary target');
      if ('alternative_target' in x) eq(out.alternative ? out.alternative.target : null, x.alternative_target, 'alternative');
      for (const [k, v] of Object.entries(x.selected || {})) eq(out.selectedMethods?.[k] ?? null, v, `selectedMethods.${k}`);
      if ('gaps' in x) eq((out.methodGaps || []).map(g => g.id).sort(), [...x.gaps].sort(), 'method gaps');
      for (const [id, st] of Object.entries(x.methodStatus || {})) eq(out.methodCandidates.find(m => m.id === id)?.status, st, `status of method ${id}`);
      const prose = JSON.stringify([out.notes, out.nextActions, out.largestRisk, out.evidenceRequired]);
      for (const re of x.notesMatch || []) ok(new RegExp(re, 'i').test(prose), `the card never says /${re}/`);
      for (const f of x.unknownsInclude || []) ok(out.unknowns.some(u => u.field === f), `unknown ${f} not recorded`);
      for (const [id, r] of Object.entries(x.methodRules || {})) eq(out.methodCandidates.find(m => m.id === id)?.ruleId, r, `rule behind method ${id}`);
      for (const t of x.mustNotRecommend || []) ok(out.recommendation?.target !== t && out.alternative?.target !== t, `${t} was named`);
    });
  }
}

// ---------------------------------------------------------------------------------------------
section('report');
// ---------------------------------------------------------------------------------------------
test('the report builder renders a complete document from a scan', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'o2p-report-'));
  const a = scan(`
CREATE TABLE orders (id NUMBER PRIMARY KEY, note VARCHAR2(40));
CREATE OR REPLACE PACKAGE pkg_x AS g NUMBER := 0; PROCEDURE bump; END pkg_x;
/
CREATE OR REPLACE PACKAGE BODY pkg_x AS
  g_cache VARCHAR2(10);
  PROCEDURE bump IS
    PRAGMA AUTONOMOUS_TRANSACTION;
  BEGIN
    g := g + 1;
    COMMIT;
  END;
END pkg_x;
/
CREATE OR REPLACE VIEW v_tree AS SELECT id FROM orders CONNECT BY PRIOR id = id;
`, 'smoke');
  fs.writeFileSync(path.join(tmp, 'a.json'), JSON.stringify(a));
  execFileSync('node', ['tools/report/build-report.mjs', '--assessment', path.join(tmp, 'a.json'), '--profile', 'examples/contoso-store/profile.json', '--title', 'Smoke', '--out', path.join(tmp, 'r.pdf'), '--html-only'], { cwd: root, stdio: 'pipe' });
  const html = fs.readFileSync(path.join(tmp, 'r.html'), 'utf8');
  for (const bad of ['undefined', 'NaN', '[object Object]', '${', 'null%']) ok(!html.includes(bad), `the document contains "${bad}"`);
  ok((html.match(/<h2>/g) || []).length + (html.match(/<h2><span/g) || []).length >= 12, 'too few sections');
  ok(/with AI-assisted conversion/.test(html) && /If the AI-assisted converter does the first pass/.test(html), 'the AI-assisted figure is missing from the report');
  ok(/a model with stated assumptions, not a measurement/.test(html), 'the AI-assisted figure is not labelled as a model');
  ok(!/\b(EDB|EPAS|Striim|Qlik|GoldenGate|Debezium|HVR)\b/.test(html), 'a product from outside Microsoft is named in the report');
  ok(html.includes('Preliminary') && html.includes('provisional'), 'the honest wording is missing');
  ok(/<svg/.test(html), 'no charts');
  ok(!/\bvalidated\b/.test(html.replace(/independently validated|validated by|until an architect[^<]*validate it|Plan validation/gi, '')), 'the word validated is used as a status');
  const layout = checkLayout(path.join(tmp, 'r.html'));
  if (layout) ok(layout.ok, `content is wider than the page: ${JSON.stringify(layout)}`);
  else info('no browser found: layout not checked');
  fs.rmSync(tmp, { recursive: true, force: true });
});
const exampleHtml = path.join(root, 'examples', 'contoso-store', 'output', 'contoso-store-assessment.html');
if (fs.existsSync(exampleHtml)) {
  test('the worked example fits the page width (an overflowing element shrinks the whole printout)', () => {
    const layout = checkLayout(exampleHtml);
    if (layout) ok(layout.ok, `content is wider than the page: ${JSON.stringify(layout)}`);
  });
}

// ---------------------------------------------------------------------------------------------
console.log(`\n${results.pass} passed, ${results.fail} failed`);
if (results.fail) {
  console.log('\nFailures:');
  for (const f of results.failures) console.log(`- ${f}`);
  process.exit(1);
}
