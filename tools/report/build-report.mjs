#!/usr/bin/env node
// Builds the assessment report: HTML first, then a PDF printed by headless Chrome.
//
//   node tools/report/build-report.mjs --assessment out/assessment.json --profile examples/contoso-store/profile.json
//        [--calibration out/calibration.json] [--recall out/recall.json] [--title "Contoso Store"] [--out out/report.pdf] [--html-only]
//
// The recommendation is computed by the same engine the tests use, from the stated interview answers plus
// what the schema scan can supply (PL/SQL volume and Oracle features). Nothing in the report is typed by hand
// except the explanatory prose; every number comes from the assessment, the rules or the sources register.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan } from '../plan/build-plan.mjs';
import { printToPdf, checkLayout } from '../pdf/print.mjs';
import { aiAssistedEstimate } from '../assess/lib/ai-effort.mjs';
import { evaluate, selfCheck, profileFromAssessment, RULES, FEATURE_MATRIX, FIELDS, TARGETS, KNOWLEDGE_BASE_VERSION, RULES_VERSION } from '../advisor/engine.mjs';
import { INK, INK2, MUTED, GRID, BLUE, STATUS, STATUS_TINT, GLYPH, CLASSES, esc, fmt, fmt1, hbar, stackedClassBars, classLegend, heatGrid, meter, statTile, chip, stateChip } from './charts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (name, def = null) => { const i = argv.indexOf(`--${name}`); return i === -1 ? def : argv[i + 1]; };
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

const assessment = readJson(arg('assessment'));
const stated = readJson(arg('profile'));
const calibration = arg('calibration') ? readJson(arg('calibration')) : null;
const recall = arg('recall') ? readJson(arg('recall')) : null;
const catalog = readJson(path.join(root, 'reference', 'compat-catalog.json'));
const sources = readJson(path.join(root, 'reference', 'sources.json'));
const title = arg('title', assessment.name);
const outPdf = arg('out', 'out/assessment.pdf');
const today = arg('date', new Date().toISOString().slice(0, 10));

const derived = profileFromAssessment(assessment);
const profile = { ...stated, ...derived, evidence: [...new Set([...(stated.evidence || []), ...derived.evidence])] };
const card = evaluate(profile);
const violations = selfCheck(card);
if (violations.length) { console.error('self-check failed', violations); process.exit(1); }

const T = assessment.totals;
const person = u => Math.ceil(u / assessment.scoring.unitsPerPersonDay);
const days = T.personDaysOra2PgStyle;
const catById = new Map(catalog.entries.map(e => [e.id, e]));
const LABEL = Object.fromEntries(Object.entries(RULES.targets).map(([k, v]) => [k, v.label]));

// ------------------------------------------------------------------------------------------------------
// Derived figures
// ------------------------------------------------------------------------------------------------------
const TYPE_LABEL = { TABLE: 'Tables', VIEW: 'Views', SYNONYM: 'Synonyms', INDEX: 'Indexes', FUNCTION: 'Functions', PROCEDURE: 'Procedures', TRIGGER: 'Triggers', PACKAGE: 'Package specs', PACKAGE_BODY: 'Package bodies', SEQUENCE: 'Sequences', TYPE: 'Types', TYPE_BODY: 'Type bodies', CONSTRAINT: 'Constraints', MATERIALIZED_VIEW: 'Materialized views', MATERIALIZED_VIEW_LOG: 'MV logs', JOB: 'Scheduler jobs', SCHEDULE: 'Schedules', PROGRAM: 'Programs', CHAIN: 'Chains', JOB_CLASS: 'Job classes', VPD_POLICY: 'VPD policies', REFRESH_GROUP: 'Refresh groups', USER: 'Users' };
const typeRows = Object.entries(assessment.byType).sort((a, b) => b[1].count - a[1].count);
const WORKSTREAMS = [
  ['Packages, procedures and functions', ['PACKAGE_BODY', 'PACKAGE', 'PROCEDURE', 'FUNCTION', 'TYPE_BODY']],
  ['Views and materialized views', ['VIEW', 'MATERIALIZED_VIEW']],
  ['Triggers', ['TRIGGER']],
  ['Tables, types and constraints', ['TABLE', 'TYPE', 'CONSTRAINT', 'MATERIALIZED_VIEW_LOG']],
  ['Indexes, sequences and synonyms', ['INDEX', 'SEQUENCE', 'SYNONYM']],
  ['Scheduler, VPD and policies', ['JOB', 'SCHEDULE', 'PROGRAM', 'CHAIN', 'JOB_CLASS', 'VPD_POLICY', 'REFRESH_GROUP', 'FGA_POLICY', 'LEGACY_JOB', 'WINDOW', 'USER']],
];
const wsUnits = WORKSTREAMS.map(([name, types]) => ({ name, objects: types.reduce((a, t) => a + (assessment.byType[t]?.count || 0), 0), units: types.reduce((a, t) => a + (assessment.byType[t]?.unitsCounted || 0), 0) }));
const effortLow = days;
const effortHigh = Math.ceil((T.units * 10) / 420);
const convCandidate = card.methodCandidates.find(m => m.id === 'MS_VSCODE_AI');
const converterState = !card.selectedMethods?.schemaConversion ? 'unavailable' : convCandidate?.status === 'available' ? 'available' : 'unknown';
const ai = aiAssistedEstimate(assessment, { calibration, converter: converterState, groups: WORKSTREAMS });
const constructsAffecting = assessment.constructs.filter(c => c.affectsClass);
const present = new Set(assessment.constructs.map(c => c.id));
const objectsOf = id => assessment.constructs.find(c => c.id === id)?.objects || 0;

// ------------------------------------------------------------------------------------------------------
// HTML helpers
// ------------------------------------------------------------------------------------------------------
const h2 = (n, t) => `<h2><span class="num">${n}</span>${esc(t)}</h2>`;
const table = (head, rows, { cls = '', widths = null } = {}) => `<table class="${cls}">${widths ? `<colgroup>${widths.map(w => `<col style="width:${w}">`).join('')}</colgroup>` : ''}<thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const code = s => `<code>${esc(s)}</code>`;
const effortTile = () => {
  const aiCol = ai.available ? `<div class="tile-col"><div class="tile-v">${fmt(ai.days.ai.low)}–${fmt(ai.days.ai.high)}</div><div class="tile-l">with AI-assisted conversion</div></div>` : '';
  const sub = ai.available
    ? `5 and 10 min per unit. The AI figure is a model${ai.status === 'unknown' ? ' and needs the converter pilot' : ''}.`
    : '5 and 10 min per unit. No AI figure: the Microsoft converter does not apply.';
  return `<div class="tile wide"><div class="tile-row"><div class="tile-col"><div class="tile-v">${fmt(days)}–${fmt(effortHigh)}</div><div class="tile-l">person-days by hand</div></div>${aiCol}</div><div class="tile-s">${esc(sub)}</div></div>`;
};
const route = s => (s ? code(s) : '<span class="muted">no Microsoft route (gap)</span>');
// Cut at a sentence end when one fits, otherwise at a word, so a clipped reason never stops mid-word.
const clip = (str, n) => {
  if (str.length <= n) return str;
  const cut = str.slice(0, n);
  const sentence = cut.lastIndexOf('. ');
  if (sentence > n * 0.55) return cut.slice(0, sentence + 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:(]$/, '') + '…';
};
const HA_LABEL = { STANDARD_99_9: '99.9%', HIGH_99_95: '99.95% (same-zone HA)', HIGHEST_99_99: '99.99% (zone-redundant HA)', NOT_SURE: 'not stated' };
const firstSentence = t => { const m = /^(.{40,170}?[.;])(\s|$)/.exec(String(t).trim()); return m ? m[1] : String(t).trim(); };
const callout = (kind, html) => `<div class="callout ${kind}">${html}</div>`;
const srcLink = id => { const s = sources.sources.find(x => x.id === id); return s ? `<a href="${esc(s.url)}">${esc(s.title)}</a>` : esc(id); };

const FIELD_LABEL = {
  scope: 'Scope', source_location: 'Source location', source_version: 'Oracle version', topology: 'Topology', edition: 'Edition', character_set: 'Character set',
  intent: 'Intent', driver: 'Main driver', management_model: 'Management model', app_changeability: 'Application changeability',
  isv_supports_postgres: 'ISV supports PostgreSQL', compliance: 'Compliance', region: 'Azure region', preview_acceptable: 'Preview services', cmk_required: 'Customer-managed keys',
  largest_db_size: 'Largest database (planned)', peak_io: 'Peak IOPS', peak_compute: 'Peak compute', availability_target: 'Availability target', dr_requirement: 'Cross-region recovery',
  feature_dependencies: 'Feature dependencies (stated)', oracle_features: 'Oracle features found', plsql_volume: 'PL/SQL volume', app_tier_oracle: 'Oracle app tier', downtime: 'Cutover downtime',
  network_bandwidth: 'Bandwidth', private_connectivity: 'Private connectivity',
  converter_prereqs: 'Converter prerequisites', evidence: 'Evidence in hand',
};

// ------------------------------------------------------------------------------------------------------
// Sections
// ------------------------------------------------------------------------------------------------------
function cover() {
  return `<section class="cover">
    <div class="cover-band"><div class="cover-kicker">Oracle to Azure Database for PostgreSQL</div><h1>Migration assessment</h1><div class="cover-sub">${esc(title)}</div></div>
    <div class="cover-body">
      <p class="cover-lead">A preliminary, evidence-backed disposition: which Azure PostgreSQL target to assess first, how to convert and move the schema, what the converter will not do, and how much of the work the source code says is there.</p>
      <div class="tiles cover-tiles">
        ${statTile(fmt(T.objects), 'schema objects scanned')}
        ${statTile(fmt(T.plsqlLoc), 'lines of PL/SQL')}
        ${effortTile()}
      </div>
      <div class="cover-meta">
        <div><b>Status</b><span>Preliminary. Provisional until an architect and an assessment tool validate it.</span></div>
        <div><b>Evaluated</b><span>${esc(today)}</span></div>
        <div><b>Versions</b><span>Knowledge base ${KNOWLEDGE_BASE_VERSION} · rules ${RULES_VERSION} · sources checked ${esc(sources.checked)}</span></div>
        <div><b>Produced by</b><span>oracle-to-postgres-migration-advisor, built on the design of fredgis/sql-migration-advisor</span></div>
      </div>
    </div>
  </section>`;
}

function executive() {
  const rec = card.recommendation;
  const alt = card.alternative;
  const topRisks = constructsAffecting.filter(c => c.classification === 'REVIEW' || c.classification === 'BLOCKER').slice(0, 5);
  const sel = card.selectedMethods;
  return `<section class="page exec">
    ${h2('1', 'Executive summary')}
    <p class="lead"><b>${esc(rec.label)}</b> on PostgreSQL ${rec.postgresMajor} is the target to assess first. Status <b>${esc(card.metadata.recommendationStatus)}</b>, confidence <b>${esc(card.metadata.confidence)}</b>. It is a preliminary disposition, not a verdict.</p>
    <div class="tiles">
      ${statTile(fmt(T.objects), 'objects', `${fmt(T.loc)} lines of code`)}
      ${statTile(`${assessment.byClass.CLEAN}`, 'clean', `${Math.round(100 * assessment.byClass.CLEAN / T.objects)}% of objects`)}
      ${statTile(`${assessment.byClass.PARTIAL + assessment.byClass.REVIEW + assessment.byClass.BLOCKER}`, 'need human attention', `${assessment.byClass.PARTIAL} partial, ${assessment.byClass.REVIEW} review, ${assessment.byClass.BLOCKER} blocker`)}
      ${effortTile()}
    </div>
    <h3>What the scan found</h3>
    <ul class="tight">
      <li><b>${fmt(T.objects)} objects and ${fmt(T.loc)} lines of code</b>, of which ${fmt(T.plsqlLoc)} are PL/SQL, across ${assessment.sources.length} script files. ${assessment.byType.PACKAGE_BODY?.count ?? 0} package bodies hold ${fmt(assessment.packages.reduce((a, p) => a + p.members, 0))} routines.</li>
      <li><b>${objectsOf('PLSQL-PACKAGE-STATE')} objects carry package-level session state, ${objectsOf('PLSQL-AUTONOMOUS-TXN')} use autonomous transactions, and ${objectsOf('PKG-UTL-FILE')} touch the file system.</b> None has a direct PostgreSQL equivalent.</li>
      <li><b>${assessment.hygiene.dynamicObjects.length} objects are created by dynamic DDL</b> and ${assessment.hygiene.unterminated.length} statements are never terminated in the source (a stray <code>;</code> inside a comment). A scan that reads only top-level <code>CREATE</code> statements would have missed the first and mis-split the second.</li>
      <li>${assessment.blockers.length ? `<b>${assessment.blockers.length} construct has no supported equivalent on flexible server:</b> ${esc(assessment.blockers.map(b => b.name).join('; '))}.` : 'No construct without a supported equivalent was found.'}</li>
    </ul>
    <h3>What the advisor recommends</h3>
    <ul class="tight">
      <li><b>Target:</b> ${esc(rec.label)}, PostgreSQL ${rec.postgresMajor}. Rule <code>${esc(rec.ruleId)}</code>: ${esc(rec.why)}</li>
      <li><b>Alternative:</b> ${alt ? `${esc(alt.label)}, which ${esc(alt.wins)}` : 'none named. No other family survives the rules'}.</li>
      <li><b>Schema and code:</b> ${route(sel.schemaConversion)}.${stated.source_version === 'ORA_23AI_26AI' ? ' The Microsoft converter does not list Oracle 23ai or 26ai, so a pilot on 10 to 15 objects decides it.' : ''}${sel.schemaConversion ? '' : ' Microsoft publishes no other converter.'}</li>
      <li><b>Effort:</b> ${fmt(days)} to ${fmt(effortHigh)} person-days by hand${ai.available ? `; about ${fmt(ai.days.ai.low)} to ${fmt(ai.days.ai.high)} if the AI-assisted converter drafts the code (a model, section 9)` : '. The AI-assisted converter does not apply as things stand, so there is no second figure'}.</li>
      <li><b>Data:</b> ${route(sel.dataMovement)}, ${esc(sel.dataFamily)}. <b>No Microsoft service moves Oracle rows to PostgreSQL by change capture.</b> The converter does not move a row either.</li>
    </ul>
    <h3>The five things most likely to hurt</h3>
    <ol class="tight">${topRisks.map(c => `<li><b>${esc(c.name)}</b> (${c.objects} objects, ${c.hits} uses): ${esc(firstSentence(c.why || c.postgres))}</li>`).join('')}</ol>
    ${callout('warn', `<b>What this report is not.</b> It reads source text only: no row counts, workload, performance or application. Effort covers reading, rewriting and a basic test per routine. Data movement, tuning, application changes and cutover are separate workstreams (section 9).`)}
  </section>`;
}

function recommendation() {
  const rows = TARGETS.map(t => {
    const e = card.eligibilityTrace[t];
    return [`<b>${esc(LABEL[t])}</b>`, stateChip(e.state), e.ruleId ? code(e.ruleId) : '<span class="muted">none</span>', esc(clip(e.reason, 240))];
  });
  const rem = card.recommendation.remediation;
  const redesignRows = rem.redesign.map(r => [esc(r.label), '<span class="state" style="background:#f7d9d9;color:#8f1f1f">redesign</span>', esc(r.note)]);
  const workRows = rem.workaround.map(r => [esc(r.label), '<span class="state" style="background:#fff2d1;color:#6b4a00">workaround</span>', esc(r.note)]);
  return `<section class="page">
    ${h2('2', 'Recommendation')}
    <div class="card">
      <div class="card-head"><div><div class="card-k">Preliminary recommendation</div><div class="card-t">${esc(card.recommendation.label)}</div><div class="card-s">PostgreSQL ${card.recommendation.postgresMajor} · status <b>${esc(card.metadata.recommendationStatus)}</b> · confidence <b>${esc(card.metadata.confidence)}</b></div></div><div class="card-r"><code>${esc(card.recommendation.ruleId)}</code></div></div>
      <div class="card-grid">
        <div><div class="k">Schema and code</div><div class="v">${route(card.selectedMethods.schemaConversion)}</div><div class="s">Microsoft converter</div></div>
        <div><div class="k">Data movement</div><div class="v">${route(card.selectedMethods.dataMovement)}</div><div class="s">${esc(card.selectedMethods.dataFamily)}</div></div>
        <div><div class="k">Cutover downtime</div><div class="v">${esc(card.selectedMethods.cutoverDowntime.split(',')[0])}</div><div class="s">+ validation</div></div>
        <div><div class="k">Alternative</div><div class="v">${card.alternative ? esc(card.alternative.label.replace(/\s*\(.*\)$/, '')) : 'none named'}</div><div class="s">${card.alternative ? esc(card.alternative.wins) : 'no other family survives'}</div></div>
      </div>
    </div>
    <h3>Phase A: all eight target families</h3>
    ${table(['Target', 'State', 'Rule', 'Why'], rows, { cls: 'compact', widths: ['27%', '19%', '15%', '39%'] })}
    <p class="note">The state that wins is the most severe one any rule produced. <b>Unsupported</b> is a technical incompatibility. <b>Excluded by preference</b> names an answer the customer can change. Rule IDs are defined in <code>reference/decision-rules.md</code>.</p>
    <h3>What the chosen target needs from the application</h3>
    ${redesignRows.length || workRows.length ? table(['Oracle feature in the schema', 'Carried as', 'How'], [...redesignRows, ...workRows], { cls: 'compact', widths: ['30%', '14%', '56%'] }) : '<p>Nothing beyond conversion.</p>'}
    <p class="note"><b>Largest risk.</b> ${esc(card.largestRisk)}</p>
  </section>`;
}

function profileSection() {
  const sourceOf = f => {
    if (['plsql_volume', 'oracle_features'].includes(f) || (f === 'feature_dependencies')) return '<span class="src scan">derived from scan</span>';
    if (f === 'evidence') return '<span class="src scan">scan + stated</span>';
    const v = stated[f];
    return v === undefined || v === 'NOT_SURE' || v === 'UNKNOWN' ? '<span class="src unk">not stated</span>' : '<span class="src stated">stated</span>';
  };
  const srcShort = f => sourceOf(f).replace(/derived from scan|scan \+ stated/, 'scan').replace('not stated', 'unknown');
  const shortRows = [], listRows = [];
  for (const f of FIELDS) {
    const v = card.normalizedProfile[f];
    if (Array.isArray(v)) { listRows.push([esc(FIELD_LABEL[f] || f), `<span class="mono">${esc(v.length ? v.join(', ') : 'none')}</span>`, srcShort(f)]); continue; }
    const text = f === 'availability_target' ? `${v} (${HA_LABEL[v] || v})` : v;
    shortRows.push([esc(FIELD_LABEL[f] || f), `<span class="mono">${esc(text)}</span>`, srcShort(f)]);
  }
  const half = Math.ceil(shortRows.length / 2);
  const unanswered = FIELDS.filter(f => ['UNKNOWN', 'NOT_SURE'].includes(card.normalizedProfile[f])).map(f => FIELD_LABEL[f] || f);
  return `<section class="page">
    ${h2('3', 'Estate profile')}
    <p>The interview answers the recommendation rests on. <b>Stated</b> answers are assumptions written for this example from what the lab's documentation says; a real engagement replaces them. <b>Scan</b> values come from the source code and win over a stated value. PL/SQL volume bands are under 5,000, under 50,000, under 250,000 and above lines of code; this schema has ${fmt(T.plsqlLoc)}. A field never answered is <span class="mono">UNKNOWN</span> and is never read as "none".</p>
    ${table(['Field', 'Value', 'From', 'Field', 'Value', 'From'], Array.from({ length: half }, (_, i) => [...shortRows[i], ...(shortRows[i + half] || ['', '', ''])]), { cls: 'compact', widths: ['17%', '23%', '8%', '19%', '25%', '8%'] })}
    ${table(['Field', 'Values', 'From'], listRows, { cls: 'compact', widths: ['18%', '70%', '12%'] })}
    ${card.assumptions.length ? callout('warn', `<b>Assumptions.</b> ${card.assumptions.map(esc).join(' ')}`) : ''}
    ${card.unknowns.length ? callout('info', `<b>Unknowns.</b> ${card.unknowns.map(u => `${esc(FIELD_LABEL[u.field] || u.field)}: ${esc(u.why)}`).join(' ')}`) : callout('ok', `<b>No decision-driving unknown remains.</b> ${unanswered.length ? `${unanswered.length} fields are unanswered (${unanswered.join(', ')}); under the current rules none of them changes the target. ` : ''}Confidence is capped at medium because the skill reads no artefact from the estate.`)}
  </section>`;
}

function inventory() {
  const big = typeRows.filter(([, v]) => v.count >= 20), small = typeRows.filter(([, v]) => v.count < 20);
  const rows = big.map(([t, v]) => ({ label: TYPE_LABEL[t] || t, counts: v.classes }));
  if (small.length) rows.push({ label: `Other (${small.length} types)`, counts: Object.fromEntries(CLASSES.map(c => [c, small.reduce((a, [, v]) => a + v.classes[c], 0)])) });
  const tableRows = typeRows.map(([t, v]) => [esc(TYPE_LABEL[t] || t), fmt(v.count), fmt(Math.round(v.unitsCounted)), v.classes.CLEAN, v.classes.PARTIAL, v.classes.REVIEW, v.classes.BLOCKER]);
  const split = Math.ceil(tableRows.length / 2);
  const head = ['Type', 'Objects', 'Units', 'Clean', 'Part.', 'Rev.', 'Block.'];
  const W = ['26%', '13.5%', '16%', '10.5%', '10.5%', '10.5%', '13%'];
  const bc = assessment.byClass;
  const inventoryTables = `<div class="two">${table(head, tableRows.slice(0, split), { cls: 'compact num fixed', widths: W })}${table(head, [...tableRows.slice(split), ['<b>Total</b>', `<b>${fmt(T.objects)}</b>`, `<b>${fmt(Math.round(T.units))}</b>`, `<b>${bc.CLEAN}</b>`, `<b>${bc.PARTIAL}</b>`, `<b>${bc.REVIEW}</b>`, `<b>${bc.BLOCKER}</b>`]], { cls: 'compact num fixed', widths: W })}</div>`;
  return `<section class="page">
    ${h2('4', 'Inventory and complexity')}
    <p>${fmt(T.objects)} objects in ${assessment.sources.length} script files. Each object is scored against ${assessment.scoring.catalogEntries} catalogued Oracle constructs and put in the worst class any of them gives it.</p>
    <h3>Objects by type, split by class</h3>
    ${classLegend('inv')}
    ${stackedClassBars(rows, { uid: 'inv', width: 700, labelWidth: 150, rowH: 16, gap: 6 })}
    <p class="note"><b>Clean</b> is mechanical. <b>Partial</b> converts but can drift in an edge case. <b>Review</b> needs a design decision or a hand rewrite on any PostgreSQL target. <b>Blocker</b> has no supported equivalent on flexible server. Class is a property of constructs, not of size. Types with fewer than 20 objects are folded into Other in the chart only. Units are the effort score of section 9.</p>
    <h3>All types, with the numbers behind the chart</h3>
    ${inventoryTables}
  </section>`;
}

function drivers() {
  const top = constructsAffecting.slice(0, 12).map(c => ({ label: c.name.length > 42 ? c.name.slice(0, 40) + '…' : c.name, value: Math.round(c.units), sub: `${c.objects} obj` }));
  const traps = assessment.semanticTraps.filter(c => c.classification !== 'CLEAN' || c.id === 'TYPE-SYSDATE').slice(0, 8);
  // heat grid: construct category x class
  const cats = [...new Set(constructsAffecting.map(c => c.category))];
  const matrix = cats.map(cat => CLASSES.map(cl => constructsAffecting.filter(c => c.category === cat && c.classification === cl).reduce((a, c) => a + c.objects, 0)));
  const CAT = { 'sql-dialect': 'SQL dialect', plsql: 'PL/SQL language', 'supplied-package': 'Supplied packages', datatype: 'Data types and semantics', storage: 'Storage and DDL', security: 'Security', integration: 'Integration' };
  return `<section class="page">
    ${h2('5', 'What drives the effort')}
    <h3>Constructs by estimated effort (units)</h3>
    ${hbar(top, { width: 700, labelWidth: 290, rowH: 18, gap: 7, color: BLUE[450] })}
    <p class="note">One unit is five minutes of a PostgreSQL expert (Ora2Pg's convention); 84 units are a person-day. Weights are Ora2Pg 25.0's own where it scores a construct, and marked <i>advisor</i> in the catalog where it does not.</p>
    <h3>Where the constructs sit: objects affected, by category and class</h3>
    ${classLegend('drv')}
    ${heatGrid(cats.map(c => CAT[c] || c), CLASSES.map(c => `${GLYPH[c]} ${c}`), matrix, { cellW: 100, labelW: 170, cellH: 24 })}
    <h3>Silent semantic traps present in this schema</h3>
    <p>These compile, run, and return different answers. A converter that reports "converted" has not seen them.</p>
    ${table(['Construct', 'Objects', 'Why it bites'], traps.map(c => [`<b>${esc(c.name)}</b>${c.labCase ? ` <span class="muted">(${esc(c.labCase)})</span>` : ''}`, fmt(c.objects), esc(c.why || c.postgres)]), { cls: 'compact', widths: ['32%', '9%', '59%'] })}
  </section>`;
}

function hotspots() {
  const pk = assessment.packages.slice(0, 12);
  const hs = assessment.objects.filter(o => o.type !== 'PACKAGE_BODY' && o.type !== 'PACKAGE').sort((a, b) => b.units - a.units).slice(0, 12)
    .map(o => ({ ...o, topConstructs: [...(o.hits || [])].sort((x, y) => (catById.get(y.id)?.weight ?? 0) * y.count - (catById.get(x.id)?.weight ?? 0) * x.count).slice(0, 3) }));
  return `<section class="flow">
    ${h2('6', 'Where to start: hotspots')}
    <h3>The 12 heaviest package bodies</h3>
    <p>Package bodies are where the work and the risk concentrate: ${assessment.byType.PACKAGE_BODY.count} of them hold ${fmt(Math.round(assessment.byType.PACKAGE_BODY.unitsCounted))} of ${fmt(Math.round(T.units))} units (${Math.round(100 * assessment.byType.PACKAGE_BODY.unitsCounted / T.units)}%). The Microsoft converter converted 27 of 90 in the lab's measured run, the weakest of any object type.</p>
    ${table(['Package body', 'Routines', 'Lines', 'State vars', 'Units', 'Class'], pk.map(p => [`<span class="mono">${esc(p.name)}</span>`, p.members, fmt(p.loc), p.state || '·', fmt1(p.units), chip(p.class)]), { cls: 'compact num' })}
    <h3>The 12 heaviest other objects</h3>
    ${table(['Object', 'Type', 'Lines', 'Units', 'Main constructs'], hs.map(h => [`<span class="mono">${esc(h.name)}</span>`, esc((TYPE_LABEL[h.type] || h.type).replace(/ies$/, 'y').replace(/s$/, '')), fmt(h.loc), fmt1(h.units), esc(h.topConstructs.map(c => `${(catById.get(c.id)?.name || c.id)}${c.count > 1 ? ` ×${c.count}` : ''}`).join('; '))]), { cls: 'compact num' })}
  </section>`;
}

function targetConfig() {
  const ext = assessment.extensions;
  const exts = RULES.flexibleServer.oracleCompatExtensions;
  const contrib = new Set(RULES.flexibleServer.otherAllowListedExtensions.names);
  const rows = ext.map(x => {
    const known = exts[x.name];
    const status = known || contrib.has(x.name) ? '<span class="state" style="background:#e3f5e3;color:#006300">✓ on the allow-list</span>' : '<span class="state" style="background:#fff2d1;color:#6b4a00">verify on the allow-list</span>';
    return [`<span class="mono">${esc(x.name)}</span>`, status, known?.preload ? 'yes, restart' : 'no', fmt(x.objects), esc(x.constructs.slice(0, 3).join(', ') + (x.constructs.length > 3 ? ` +${x.constructs.length - 3}` : ''))];
  });
  return `<section class="flow">
    ${h2('7', 'Target configuration')}
    <p>Flexible server has no superuser and no custom extensions. Each extension is allow-listed through the <code>azure.extensions</code> parameter, then created per database; those that load a library must also be in <code>shared_preload_libraries</code>, which restarts the server. Do this <b>before</b> the first conversion run: if <code>plpgsql_check</code> is missing the converter silently skips deep validation.</p>
    ${table(['Extension', 'Status', 'Preload', 'Objects', 'Needed by'], rows, { cls: 'compact', widths: ['17%', '27%', '12%', '9%', '35%'] })}
    <h3>Settings and choices that cannot be changed later</h3>
    <ul class="tight">
      <li><b>${esc(card.recommendation.postgresVersionNote)}</b> The converter needs a scratch database on PostgreSQL 15 or later.</li>
      <li><b>High availability:</b> target ${esc(HA_LABEL[stated.availability_target] || stated.availability_target)}. Zone-redundant gives 99.99%, same-zone 99.95%, doubling compute and storage cost. ${stated.region} ${RULES.flexibleServer.zoneRedundantHa.blockedForNewDeployments.includes(stated.region) ? 'is one of the regions where new zone-redundant deployments are blocked.' : 'is not in the blocked or unavailable lists, which are volatile; confirm in the portal.'}</li>
      <li><b>Network mode</b> (private access or public with private endpoint) is fixed at creation. So are customer-managed keys and geo-redundant backup.</li>
      <li><b>Collation and character set:</b> source is ${esc(stated.character_set)}; create the database as UTF8. Use collation <code>C</code> on a comparison copy or ordering differs from Oracle.</li>
      <li><b>No tablespaces.</b> Oracle tablespace placement is flattened. ${objectsOf('DDL-PHYSICAL-CLAUSES')} objects carry physical storage clauses that are dropped.</li>
    </ul>
    ${callout('info', `<b>Sizing is not done here.</b> Compute and storage depend on AWR or ASH data this tool does not read. Collect a representative month of AWR before choosing a SKU. The Learn module and the Microsoft converter size nothing either.`)}
  </section>`;
}

function outsideConverter() {
  const known = [
    ['Scheduler jobs, chains and programs', ['PKG-DBMS-SCHEDULER'], ['JOB', 'SCHEDULE', 'PROGRAM', 'CHAIN', 'JOB_CLASS'], 'Rebuild on pg_cron; chains and events need an orchestrator (Logic Apps, Functions, Automation).'],
    ['VPD policies (DBMS_RLS)', ['SEC-VPD', 'SEC-VPD-CALL'], ['VPD_POLICY'], 'Recreate as row level security policies and set the session context they read.'],
    ['Application contexts', ['SEC-SYS-CONTEXT-APP'], ['CONTEXT'], 'Replace with a custom setting namespace. The guarantee that only a trusted package writes it has to be rebuilt.'],
    ['Materialized view logs', [], ['MATERIALIZED_VIEW_LOG'], 'Drop. They exist only to support fast refresh.'],
    ['Bitmap, global-partitioned and domain indexes', ['DDL-BITMAP-INDEX', 'DDL-GLOBAL-INDEX', 'DDL-DOMAIN-INDEX'], [], 'Redesign the access path: btree, GIN or BRIN, local indexes.'],
    ['Users, roles and privileges', [], ['USER', 'ROLE', 'PROFILE'], 'Script roles and grants by hand; move authentication to Microsoft Entra ID.'],
    ['Database links', ['DDL-DB-LINK', 'DDL-DB-LINK-OBJECT'], ['DATABASE_LINK'], 'oracle_fdw or postgres_fdw, one foreign table per remote object.'],
    ['Advanced Queuing', ['PKG-DBMS-AQ'], [], 'Azure Service Bus, or a queue table read with SKIP LOCKED.'],
    ['External tables', ['DDL-EXTERNAL-TABLE'], [], 'azure_storage reads blobs. file_fdw is not on the allow-list.'],
    ['System-event triggers', ['PLSQL-TRIGGER-EVENT'], [], 'login_hook for logon logic, event triggers for DDL.'],
    ['Java and external C procedures', ['PKG-JAVA', 'PKG-EXTPROC'], [], 'Move the logic to the application tier.'],
  ];
  const rows = known.map(([name, ids, types, how]) => {
    const n = Math.max(0, ...ids.map(objectsOf), types.reduce((a, t) => a + (assessment.byType[t]?.count || 0), 0));
    return [`<b>${esc(name)}</b>`, n ? `<b>${fmt(n)}</b>` : '<span class="muted">none found</span>', esc(how)];
  });
  return `<section class="flow">
    ${h2('8', 'Outside the converter')}
    <p>The Microsoft converter converts schema and PL/SQL. It does <b>not</b> move rows, and it does not convert the objects below. Each one the scan found is a manual workstream with an owner.</p>
    ${table(['Not converted by the Microsoft tool', 'Found in this schema', 'What to do instead'], rows, { cls: 'compact', widths: ['30%', '15%', '55%'] })}
    <p class="note">Source: ${srcLink('ms-oracle-schema-limitations')}. The converter also never converts system schemas (SYS, SYSTEM, XDB, MDSYS, CTXSYS, WMSYS), and "Converted" does not guarantee the code compiles, is complete, or behaves the same.</p>
    <h3>Oracle components around the database</h3>
    <p>Forms, Reports, APEX, OBIEE, ODI, WebLogic and mod_plsql do not migrate with the database. They are application work. ${stated.app_tier_oracle === 'NONE_CONFIRMED' ? 'The profile confirms there are none.' : 'The profile does not confirm there are none, so this stays open.'}</p>
  </section>`;
}


function aiBlock() {
  if (!ai.available) {
    return `<h3>If the AI-assisted converter does the first pass</h3>
    ${callout('warn', `<b>No AI-assisted figure.</b> ${esc(ai.reason)}`)}`;
  }
  const A = ai.assumptions;
  const pct = x => `${Math.round(x * 100)}%`;
  const rate = ai.basis === 'measured' ? `${pct(A.notConvertedRate.overall)} measured on the lab's converter run, by object type` : `${pct(A.defaultNotConverted.low)} to ${pct(A.defaultNotConverted.high)}, an assumption (no measured run supplied)`;
  const u = ai.units;
  const wsRows = ai.workstreams.map(w => [esc(w.name), `${fmt1(w.manual.low)} to ${fmt1(w.manual.high)}`, `${fmt1(w.ai.low)} to ${fmt1(w.ai.high)}`]);
  const grid = ai.sensitivity.cells.map((row, i) => [`<b>${pct(ai.sensitivity.reviewFractions[i])}</b>`, ...row.map(c => `${fmt(c.low)} to ${fmt(c.high)}`)]);
  const head = ['Review cost', ...ai.sensitivity.notConvertedRates.map(r => `${pct(r)} not converted`)];
  const pilot = ai.status === 'unknown' ? callout('warn', `<b>The converter does not list this Oracle release${stated.source_version === 'ORA_23AI_26AI' ? ' (23ai and 26ai)' : ''}.</b> The figure above holds only if the 10 to 15 object pilot shows the converter works on it. If it does not, the manual figure stands.`) : '';
  return `<h3>If the AI-assisted converter does the first pass</h3>
    <p>The Microsoft converter (PostgreSQL extension for VS Code, a Foundry <code>gpt-5.2</code> deployment, a Copilot seat) writes the first version of each object, and people review it. The figure below counts the same cost units after that change. It is <b>a model with stated assumptions, not a measurement</b>: no vendor publishes a productivity figure to anchor it, and the real number comes from the pilot.</p>
    <div class="tiles">
      ${statTile(`${fmt(days)}–${fmt(effortHigh)}`, 'person-days by hand', 'the figure above')}
      ${statTile(`${fmt(ai.days.ai.low)}–${fmt(ai.days.ai.high)}`, 'with the AI-assisted converter', `${ai.basis === 'measured' ? 'converter run measured on this schema' : 'assumed conversion rate'}`)}
      ${statTile(`${pct(ai.remaining.low)}–${pct(ai.remaining.high)}`, 'of the manual effort remains', 'testing, decisions, review')}
      ${statTile(`${fmt(ai.days.floor)}`, 'person-day floor', 'what the converter cannot touch')}
    </div>
    ${table(['Where the units go', 'Units', 'What the model assumes'], [
      ['Reading and rewriting the converter can draft', fmt(Math.round(u.addressable)), `A person reviews the draft at ${pct(A.reviewFraction.low)} to ${pct(A.reviewFraction.high)} of the manual cost. An object the converter does not convert costs the full manual amount.`],
      ['Constructs that need a design decision', fmt(Math.round(u.decisions)), `The converter proposes, a person decides: ${A.decisionMultiplier} times the review cost, never above the manual cost.`],
      ['The testing allowance', fmt(Math.round(ai.stays.testingUnits)), 'Not reduced. Converted is not equivalent, and the same model that converted an object cannot be the only check on it.'],
      ['Blockers and objects the converter does not read', fmt(Math.round(ai.stays.blockerUnits + ai.stays.outsideUnits)), 'Not reduced: jobs, VPD policies, users, and constructs with no supported equivalent.'],
      ['Setup, pilot and conversion runs', `${A.setupDays.low} to ${A.setupDays.high} days`, 'A fixed allowance: Foundry quota, Copilot seats, the scratch server, the pilot and the batch runs.'],
    ], { cls: 'compact', widths: ['32%', '12%', '56%'] })}
    <p class="note">Objects not converted: ${rate}. The low end uses the ${pct(A.reviewFraction.low)} review cost and 5 minutes a unit, the high end ${pct(A.reviewFraction.high)} and 10 minutes, the same two paces as the manual figure. The converter's own failures in the lab run were mostly timeouts and lock contention in the scratch database, so a healthy run may convert more than this.</p>
    ${pilot}
    <h3>Where the AI-assisted figure falls, by workstream (person-days)</h3>
    ${table(['Workstream', 'By hand', 'With AI-assisted conversion'], wsRows, { cls: 'compact num', widths: ['46%', '27%', '27%'] })}
    <h3>How sensitive it is</h3>
    <p>Person-days, low to high, for other review costs and conversion rates. The pilot replaces these guesses with numbers for this estate.</p>
    ${table(head, grid, { cls: 'compact num', widths: ['22%', '26%', '26%', '26%'] })}
    ${callout('info', '<b>What the AI does not change.</b> Every converted object is still read and tested. The design decisions (scheduler chains, object types with inheritance, fast-refresh views) stay with people. Data movement, application changes, performance tuning, cutover and rollback are outside both figures. The Foundry tokens and Copilot seats are real costs, and this report states no cost.')}`;
}

function effort() {
  const wsRows = wsUnits.map(w => ({ label: w.name, value: Math.round(w.units), sub: `${person(w.units)} d` }));
  return `<section class="flow">
    ${h2('9', 'Effort and risk')}
    <div class="tiles">
      ${statTile(fmt(Math.round(T.units)), 'cost units', '5 minutes each')}
      ${statTile(`${fmt(effortLow)}`, 'person-days at 5 min/unit', 'an expert, per Ora2Pg')}
      ${statTile(`${fmt(effortHigh)}`, 'person-days at 10 min/unit', "Ora2Pg's suggestion for a first migration")}
      ${statTile(T.level, 'Ora2Pg level', 'C: above the 5-day limit')}
    </div>
    <p>The figure is Ora2Pg's convention reimplemented, not a quote. Each routine costs 2 units to test, 1 unit per 1,000 characters to read, and the sum of its construct scores. A cost of ${fmt(Math.round(T.units))} units is about ${fmt(effortLow)} person-days at an expert's pace and ${fmt(effortHigh)} at the pace Ora2Pg suggests for a first migration. <b>The range is the two paces, not a statistical interval.</b> AI-assisted conversion shifts the mix between machine and human time, and the lab recorded the machine time (2 h 56 min for 1,185 objects) but not the human review time.</p>
    <h3>Units by workstream</h3>
    ${hbar(wsRows, { width: 700, labelWidth: 230, color: BLUE[450] })}
    ${aiBlock()}
    <h3>Not estimated by a source scan</h3>
    ${table(['Workstream', 'Why a scan cannot size it', 'What would'], [
      ['Data movement and rehearsals', 'Row counts, LOB sizes and change rate are not in the DDL.', 'Table sizes from the data dictionary; a timed rehearsal load.'],
      ['Performance tuning', 'Plans and workload are not in the source. Hints are ignored by PostgreSQL.', 'AWR or ASH and a representative query set.'],
      ['Application changes', 'Callers of refcursors, error codes and package state live outside the database.', 'An application dependency review; the preview app-conversion tool as a first pass.'],
      ['Testing at scale', 'Differential testing needs data and queries.', 'The ten most important differential questions run on both sides.'],
      ['Cutover and fallback', 'Depends on downtime tolerance. Microsoft offers no change-capture service, so a short window is a gap.', 'A rehearsed cutover; a retained, read-only Oracle copy as the way back.'],
    ], { cls: 'compact', widths: ['24%', '41%', '35%'] })}
    <h3>Largest risk</h3>
    <p>${esc(card.largestRisk)}</p>
  </section>`;
}

function dataMovement() {
  const dm = assessment.dataMovement;
  const cand = card.methodCandidates.filter(m => m.family === 'data');
  const st = s => ({ available: '<span class="state" style="background:#e3f5e3;color:#006300">✓ available</span>', unavailable: '<span class="state" style="background:#f7d9d9;color:#8f1f1f">✕ unavailable</span>', unknown_requires_assessment: '<span class="state" style="background:#e8eef9;color:#184f95">? needs assessment</span>', refused: '<span class="state" style="background:#ece9f7;color:#4a3aa7">⊘ refused</span>' }[s] || s);
  return `<section class="flow">
    ${h2('10', 'Data movement')}
    ${callout('warn', '<b>No Microsoft migration service moves Oracle rows to PostgreSQL.</b> Azure Database Migration Service has no Oracle to PostgreSQL scenario, the PostgreSQL migration service accepts PostgreSQL sources only, and the Microsoft converter converts schema and code only. The routes below move rows offline. Microsoft offers no change-capture service for Oracle, so this advisor names no product for it.')}
    <p>Downtime tolerance <b>${esc(stated.downtime)}</b> with a database under 1 TiB and good bandwidth allows an offline bulk load with a Microsoft route. If the window shrinks until it needs change capture, that is a gap in what Microsoft offers: the account team can say what options exist. Whatever is chosen then needs ARCHIVELOG mode with supplemental logging on the source, which the plan lists.</p>
    ${table(['Route', 'Role', 'Status', 'Notes'], cand.map(m => [`<span class="mono">${esc(m.id)}</span>`, esc(m.role), st(m.status), esc(clip(m.reason, 260))]), { cls: 'compact', widths: ['19%', '10%', '17%', '54%'] })}
    ${(card.methodGaps || []).map(g => callout('info', `<b>Gap: <span class="mono">${esc(g.id)}</span>.</b> ${esc(g.text)}`)).join('')}
    <h3>What the schema says the load must handle</h3>
    ${table(['Signal', 'Tables', 'Why it matters'], [
      ['Tables in the schema', fmt(dm.tables), 'Parallelism is by table, partition and key range.'],
      ['Partitioned tables', fmt(dm.partitionedTables), 'Partitions load in parallel; the target partition keys must include the primary key.'],
      ['CLOB or BLOB columns', fmt(dm.lobTables + dm.blobTables), 'Large values dominate load time. Test the largest LOB table first and size the batches by the largest value.'],
      ['LONG columns', fmt(dm.longColumnTables), 'LONG cannot be read by most change-capture products and needs a special initial load.'],
      ['XMLType columns', fmt(dm.xmlTables), 'Stored as xml; check the content parses on load.'],
      ['Global temporary tables', fmt(dm.globalTemporaryTables), 'Hold no rows to move; the definition must exist in every session.'],
      ['Index-organized tables', fmt(dm.indexOrganizedTables), 'Load in key order into a heap table, then CLUSTER.'],
    ], { cls: 'compact', widths: ['27%', '10%', '63%'] })}
  </section>`;
}

function validation() {
  return `<section class="flow">
    ${h2('11', 'Validation and prerequisites')}
    <p><b>"Converted" is not "equivalent".</b> Microsoft's own documentation says converted code must be independently validated, and the same model that converted it can also review it. Plan validation as its own workstream; the steps are in section 12.</p>
    ${table(['Check', 'What it catches', 'Notes'], [
      ['<b>plpgsql_check</b>', 'Static errors in PL/pgSQL, bad references, type mismatches', 'Allow-list and preload it, restart, and keep it for production. Absent on HorizonDB.'],
      ['<b>Differential testing</b>', 'A converted query that is wrong and quiet', 'The same queries on both sides, result sets diffed. Start with ROWNUM, (+) joins and empty-string tests.'],
      ['<b>Row comparison</b>', 'Rows that were truncated, rounded or re-encoded in the copy', 'oracle_fdw foreign tables, or hashed row queries run on both sides. Needs primary keys. Collation C or ordering differs.'],
      ['<b>Plan comparison</b>', 'Queries that were fast through a hint or Exadata offload', 'Hints are comments to PostgreSQL. pg_hint_plan is available.'],
    ], { cls: 'compact', widths: ['26%', '34%', '40%'] })}
  </section>`;
}

function planSection() {
  const plan = buildPlan({ out: card, assessment });
  const phaseTable = ph => table(['Area', 'Step', 'Owner'], ph.items.map(it => [
    `<span class="muted">${esc(it.area)}</span>`,
    `<b>${esc(it.title)}</b><br>${esc(it.detail)}<br><span class="srcline">${it.sourceLinks.length ? `Sources: ${it.sourceLinks.map(x => esc(x.title)).join('; ')}` : `Judgement${it.basis ? `: ${esc(it.basis.replace(/^judgement:\s*/, ''))}` : ''}`}</span>`,
    esc(it.owner),
  ]), { cls: 'compact plan', widths: ['13%', '70%', '17%'] });
  const total = plan.phases.reduce((a, ph) => a + ph.items.length, 0);
  return `<section class="flow">
    ${h2('12', 'Prerequisite plan')}
    <p>${total} steps follow from the recommendation and the scan: ${plan.phases.filter(ph => ph.items.length).map(ph => `${ph.items.length} ${ph.title.toLowerCase()}`).join(', ')}. The plan is generated from <code>reference/prerequisite-catalog.json</code>, so it changes when the recommendation does. Application steps come from the features the chosen target carries by workaround or redesign. Owners are suggestions.</p>
    ${plan.phases.filter(ph => ph.items.length).map(ph => `<h3>${esc(ph.title)}</h3><p class="note">${esc(ph.note)}</p>${phaseTable(ph)}`).join('')}
  </section>`;
}

function levers() {
  return `<section class="flow">
    ${h2('13', 'Cost levers, programmes and next steps')}
    <h3>Cost levers</h3>
    <ul class="tight">${card.costLevers.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
    <p class="note">No cost figure appears here on purpose. A figure needs measured sizing and stated pricing assumptions, and this scan has neither. Use the Azure pricing calculator after sizing.</p>
    <h3>Microsoft programmes</h3>
    <p>Quote both names: Microsoft is renaming the programme, and its pages disagree.</p>
    <ul class="tight">${card.programmeFit.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
    <h3>Next actions</h3>
    <ol class="tight">${card.nextActions.map(a => `<li>${esc(a)}</li>`).join('')}</ol>
    <h3>Never recommended</h3>
    ${table(['Item', 'Use instead'], card.retired.map(r => [esc(r.item), esc(r.use)]), { cls: 'compact', widths: ['58%', '42%'] })}
  </section>`;
}

function hardCaseAppendix() {
  if (!recall) return '';
  const predMap = { clean: 'CLEAN', partial: 'PARTIAL', 'review task': 'REVIEW' };
  const rank = { CLEAN: 0, PARTIAL: 1, REVIEW: 2, BLOCKER: 3 };
  const worstOf = id => {
    let w = null;
    for (const e of catalog.entries) if ((e.labCase || '').split(',').map(s => s.trim()).includes(id) && e.affectsClass !== false) w = w === null || rank[e.classification] > rank[w] ? e.classification : w;
    if (w === null) for (const e of catalog.entries) if ((e.labCase || '').split(',').map(s => s.trim()).includes(id)) w = w === null || rank[e.classification] > rank[w] ? e.classification : w;
    return w;
  };
  let agree = 0, compared = 0, moreCautious = 0, lessCautious = 0;
  const rows = recall.cases.map(c => {
    const lab = predMap[c.prediction] ?? null;
    const ours = worstOf(c.id);
    const ok = lab && ours && (rank[ours] >= 2 ? lab === 'REVIEW' : lab === ours);
    if (lab && ours) { compared++; if (ok) agree++; else if (Math.min(rank[ours], 2) > rank[lab]) moreCautious++; else lessCautious++; }
    const rec = c.recall === null ? '<span class="muted">no object resolved</span>' : `${c.covered}/${c.declaredObjects}`;
    return [`<span class="mono">${esc(c.id)}</span>`, esc(c.title.replace(/`/g, '')), c.prediction ? esc(c.prediction) : '·', ours ? chip(ours) : '·', lab && ours ? (ok ? '✓' : '≠') : '·', rec];
  });
  const s = recall.summary;
  return `<section class="page">
    <h2><span class="num">A</span>Appendix A. The scan against the lab's declared hard cases</h2>
    <p>The Contoso Store lab declares which objects carry each of its 43 hard cases. That is a ground truth the scanner did not write. For every declared object, the check is whether the scan flagged a construct mapped to the same case.</p>
    <div class="tiles">
      ${statTile(`${(s.objectRecall * 100).toFixed(0)}%`, 'object recall', `${s.coveredObjects} of ${s.declaredObjects} declared objects`)}
      ${statTile(`${s.casesFullyCovered}/${s.casesWithResolvableObjects}`, 'cases fully covered', 'every declared object found')}
      ${statTile(`${agree}/${compared}`, "class agrees with lab's prediction", `${moreCautious} more cautious, ${lessCautious} less`)}
    </div>
    <h3>What the misses are</h3>
    <ul class="tight">
      <li><b>Recursive PL/SQL that is not CONNECT BY</b> (<code>fn_manager_chain</code>, <code>fn_location_depth</code>). The lab lists them under H-06 as the alternative to the construct. They contain none.</li>
      <li><b>Indirect uses</b>: a scheduler job that only calls a routine that uses UTL_FILE; the empty-string-is-NULL cases (H-38) where the code tests <code>IS NULL</code> on a column whose type is declared in another file.</li>
      <li><b>The lab's own documentation ahead of its code</b>: two objects named under a case whose source does not contain the construct (comments only).</li>
    </ul>
    <p class="note">This measures recall of the declared locations, not precision. Precision was checked separately by reading matched lines for every high-weight construct.</p>
    <h3>Where this catalog disagrees with the lab's own predictions</h3>
    <p>An independent research pass checked the lab's predictions against vendor documentation and the lab's measured conversion run. It agreed on 84 constructs, extended 11, and disagreed on nine.</p>
    ${table(['Case', 'Lab says', 'This catalog says', 'Evidence'], [
      ['<span class="mono">T-03</span> byte-sized lengths', 'multibyte names overflow after conversion', 'clean', 'PostgreSQL <code>varchar(n)</code> counts characters, so limits loosen. The real risks are index row size and downstream Oracle consumers.'],
      ['<span class="mono">T-14</span> <code>||</code> and NULL', 'both databases return NULL', 'partial, high impact', 'Oracle treats NULL as empty in concatenation: <code>\'a\' || NULL</code> is <code>\'a\'</code>. PostgreSQL returns NULL. Silent.'],
      ['<span class="mono">T-13</span> NULL sort order', 'a difference', 'clean', 'Both put NULLs last ascending and first descending. No work.'],
      ['<span class="mono">H-08</span> KEEP / NTH_VALUE FROM LAST', 'clean', 'partial', 'The lab\'s own run left <code>v_product_price_rank</code> not converted with a best-effort flag. Plain analytics stay clean.'],
      ['<span class="mono">H-31</span> DECODE', 'clean', 'partial', 'Oracle treats two NULLs as equal in DECODE. The lab documents three such sites itself, and two views were not converted.'],
      ['<span class="mono">H-10</span> SAVE EXCEPTIONS', 'partial', 'review', 'Per-row failure handling is a behaviour decision. <code>pkg_receiving</code> stayed not converted in the lab run.'],
      ['<span class="mono">H-15</span> fast-refresh views', 'no analogue', 'review, partial analogue', '<code>pg_ivm</code> is on the Azure allow-list. It does not help here because the base tables are partitioned, so the lab\'s conclusion stands.'],
      ['<span class="mono">H-19</span> primary key without the partition key', 'partial', 'review', 'The lab calls it the most disruptive item. It forces a key redesign across foreign keys.'],
      ['<span class="mono">H-34</span> DBMS_LOB', 'clean', 'partial', 'orafce does not ship DBMS_LOB. The lab\'s search path names a schema that does not exist.'],
    ], { cls: 'compact', widths: ['20%', '20%', '16%', '44%'] })}
    <p class="note">Where a claim could not be verified (for example whether orafce\'s <code>decode</code> treats NULL as equal) the research marked it unverified, and the catalog does not rely on it.</p>
    ${table(['Case', 'Hard case', 'Lab predicted', 'Scan class', '', 'Objects found'], rows, { cls: 'compact tiny', widths: ['7%', '40%', '14%', '14%', '4%', '21%'] })}
  </section>`;
}

function calibrationAppendix() {
  if (!calibration) return '';
  const cls = CLASSES.map(c => [chip(c), fmt(calibration.byClass[c].objects), fmt(calibration.byClass[c].notConverted), calibration.byClass[c].objects ? `${(100 * calibration.byClass[c].notConverted / calibration.byClass[c].objects).toFixed(0)}%` : '·']);
  const types = calibration.byType.filter(t => t.objects > 5 && t.notConverted > 0).map(t => [esc(TYPE_LABEL[t.type] || t.type), fmt(t.objects), fmt(t.notConverted), t.aucUnits === null ? '·' : t.aucUnits.toFixed(2), t.aucLoc === null ? '·' : t.aucLoc.toFixed(2)]);
  const c = calibration.failureCauses;
  return `<section class="page">
    <h2><span class="num">B</span>Appendix B. Does the score predict what the converter did?</h2>
    <p>The lab ran the Microsoft converter on this schema (2026-09-04, Oracle 23.26, extension 1.30.1, gpt-5.2) and published a per-object result. This joins each scored object to its outcome (<b>${fmt(calibration.joinedObjects)}</b> objects matched by name) and asks whether higher scores went with more failures. The measure is AUC: the chance that a randomly chosen failed object outscored a randomly chosen converted one. 0.5 is a coin flip.</p>
    <div class="tiles">${statTile(calibration.overallAucProgrammable.toFixed(2), 'overall AUC', 'programmable objects')}${statTile(fmt(c.dependency + c.reviewBestEffort), 'failures that are dependency or best-effort flags', `of ${fmt(c.dependency + c.reviewBestEffort + c.other + c.timeoutOrLock)} not converted`)}</div>
    ${callout('warn', `<b>The score does not predict the converter's failures, and it should not be read as if it did.</b> In this run, failures follow dependency cascades (an object waits on a package that did not convert) and best-effort flags more than they follow construct difficulty. The lab's own analysis attributes 95% of stated failure reasons to timeouts and lock contention in the scratch database. The cost units are an estimate of <i>human</i> reading and rewriting time. They were not designed to predict a tool's success, and this appendix shows they do not.`)}
    <div class="two">
      <div><h3>Outcome by scan class</h3>${table(['Class', 'Objects', 'Not converted', 'Rate'], cls, { cls: 'compact num' })}</div>
      <div><h3>Ranking power by object type</h3>${table(['Type', 'Objects', 'Failed', 'AUC units', 'AUC lines'], types, { cls: 'compact num' })}</div>
    </div>
    <p class="note">AUC above 0.5 means larger or costlier objects failed more. Package bodies are the lab's weakest type (27 of 90 converted) for a reason size does explain: one failing member fails the whole body. The result also says the lab's 79.92% is <i>a lower bound</i>, as the lab states.</p>
  </section>`;
}

function methodAppendix() {
  const withOrigin = o => catalog.entries.filter(e => e.weightOrigin.startsWith(o)).length;
  return `<section class="flow">
    <h2><span class="num">C</span>Appendix C. Method, scoring and limits</h2>
    <h3>How the scan works</h3>
    <ol class="tight">
      <li><b>Mask.</b> Comments, string interiors and SQL*Plus commands are blanked while offsets and line breaks are kept, so a hit is never found in a comment. Only unambiguous SQL*Plus forms are removed: an earlier draft deleted <code>START WITH</code>, <code>CONNECT BY</code>, <code>EXIT WHEN</code> and <code>DESC</code> lines.</li>
      <li><b>Split.</b> Plain SQL ends at <code>;</code>. PL/SQL units end at a <code>/</code> line. A statement that reaches the next <code>CREATE</code> unterminated is recovered and flagged. Objects built by <code>EXECUTE IMMEDIATE</code> in installer blocks are found and marked dynamic.</li>
      <li><b>Detect.</b> ${assessment.scoring.catalogEntries} catalogued constructs run as patterns or as computed metrics (package state, overloads, string null tests, columns typed with VARRAY or object types).</li>
      <li><b>Score.</b> Ora2Pg 25.0's model: routine = 1 + 2 test + 1 per 1,000 characters + constructs; view = 1 + constructs. ${withOrigin('ora2pg')} catalog weights are Ora2Pg's own; ${withOrigin('advisor')} are this project's, and marked.</li>
      <li><b>Level.</b> A to C and 1 to 5 as Ora2Pg defines them. The person-day limit that turns B into C is 5 in Ora2Pg's command-line help and 10 in its configuration text; the scan uses 5. At this size the level is C under either limit.</li>
      <li><b>Class.</b> The worst class of any construct with a weight. Notes that are true of nearly every object (for example <code>||</code> and NULL) are counted but do not move an object out of Clean.</li>
    </ol>
    <h3>Limits</h3>
    <ul class="tight">${assessment.limitations.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <h3>Script hygiene found in the source</h3>
    <ul class="tight">
      <li><b>${assessment.hygiene.unterminated.length} statements are unterminated</b> (for example <code>${esc(assessment.hygiene.unterminated[0]?.name || '')}</code>): a <code>;</code> typed inside a trailing <code>--</code> comment is ignored by Oracle clients, so the statement runs into the next one. The scan recovered the objects; the script should be fixed.</li>
      <li><b>${assessment.hygiene.dynamicObjects.length} objects are created by dynamic DDL</b>, invisible to a scan of top-level statements.</li>
      ${assessment.hygiene.duplicates.length ? `<li>${assessment.hygiene.duplicates.length} object definitions appear more than once; the later one wins, as in Oracle.</li>` : ''}
    </ul>
  </section>`;
}

function sourcesAppendix() {
  const groupOf = u => /learn\.microsoft\.com|techcommunity\.microsoft|azure\.microsoft|download\.microsoft|github\.com\/microsoft/.test(u) ? 'Microsoft' : /oracle\.com|docs\.oracle/.test(u) ? 'Oracle' : 'Open source and others';
  const groups = ['Microsoft', 'Oracle', 'Open source and others'];
  const by = Object.fromEntries(groups.map(g => [g, sources.sources.filter(x => groupOf(x.url) === g)]));
  return `<section class="flow">
    <h2><span class="num">D</span>Appendix D. Sources</h2>
    <p>Every limit, date and status in this report was read on <b>${esc(sources.checked)}</b> from the ${sources.sources.length} pages below. Pages with a volatile answer (regions where zone-redundant HA is blocked, programme names and funding percentages) say so where they are used. Confirm before promising any of them.</p>
    ${groups.filter(g => by[g].length).map(g => `<h3>${esc(g)} (${by[g].length})</h3><div class="srcs">${by[g].map(x => `<div><b>${esc(x.title)}</b><br><span class="url">${esc(x.url)}</span></div>`).join('')}</div>`).join('')}
  </section>`;
}

// ------------------------------------------------------------------------------------------------------
// Document
// ------------------------------------------------------------------------------------------------------
const CSS = `
:root{--ink:${INK};--ink2:${INK2};--muted:${MUTED};--grid:${GRID};--blue:${BLUE[450]};--navy:${BLUE[700]};--surface:#fcfcfb}
*{box-sizing:border-box}
html{font:9.3pt/1.48 -apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0}
@page{size:A4;margin:16mm 15mm 15mm 15mm;@bottom-left{content:"${esc(title)} · Oracle to PostgreSQL assessment";font:7.5pt -apple-system,Helvetica,Arial,sans-serif;color:${MUTED}}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:7.5pt -apple-system,Helvetica,Arial,sans-serif;color:${MUTED}}}
@page cover{margin:0;@bottom-left{content:none}@bottom-right{content:none}}
.cover{page:cover;height:296.6mm;width:210mm;overflow:hidden;page-break-after:always;display:flex;flex-direction:column}
.cover-band{background:linear-gradient(135deg,${BLUE[700]} 0%,${BLUE[550]} 100%);color:#fff;padding:34mm 22mm 20mm}
.cover-kicker{font-size:11pt;letter-spacing:.08em;text-transform:uppercase;opacity:.85}
.cover h1{font-size:40pt;line-height:1.05;margin:6mm 0 4mm;font-weight:700;letter-spacing:-.01em}
.cover-sub{font-size:20pt;font-weight:300;opacity:.95}
.cover-body{padding:14mm 22mm;flex:1}
.cover-lead{font-size:12pt;line-height:1.55;color:var(--ink2);max-width:150mm;margin:0 0 10mm}
.cover-tiles{margin-bottom:12mm}
.cover-meta{font-size:9pt;color:var(--ink2);border-top:1px solid var(--grid);padding-top:6mm;line-height:1.9}
.cover-meta div{display:flex;gap:4mm}.cover-meta b{flex:0 0 30mm;color:var(--ink)}
.page{break-before:page}.flow{margin-top:9mm}h2,h3{break-after:avoid}table,.callout,.card,.tiles{break-inside:auto}thead{display:table-header-group}.tiles,.callout,.card,svg{break-inside:avoid}
h2{font-size:17pt;margin:0 0 4mm;font-weight:700;letter-spacing:-.005em;display:flex;align-items:baseline;gap:3mm;border-bottom:2px solid var(--navy);padding-bottom:2mm}
h2 .num{color:#fff;background:var(--navy);border-radius:3px;padding:0 6px;font-size:11pt;line-height:1.5;min-width:7mm;text-align:center}
h3{font-size:11pt;margin:6mm 0 2mm;color:var(--navy)}
p{margin:0 0 3mm}
.lead{font-size:11pt;line-height:1.45}
.note{font-size:8.6pt;color:var(--ink2)}
.muted{color:var(--muted)}
.mono,code{font:8.4pt ui-monospace,"SF Mono",Menlo,Consolas,monospace}
code{background:#f1f0ec;border-radius:3px;padding:0 3px}
a{color:var(--blue);text-decoration:none}
ul.tight,ol.tight{margin:0 0 3mm;padding-left:5mm}ul.tight li,ol.tight li{margin:0 0 1.2mm}
table{width:100%;border-collapse:collapse;margin:0 0 3mm;font-size:8.6pt;break-inside:auto}
th{text-align:left;font-weight:600;color:var(--ink2);border-bottom:1.5px solid var(--navy);padding:1.6mm 2mm;font-size:8pt;text-transform:uppercase;letter-spacing:.03em}
td{padding:1.5mm 2mm;border-bottom:1px solid var(--grid);vertical-align:top}
tr{break-inside:avoid}
table.compact td{padding:.9mm 1.6mm}.src{font-size:7pt;padding:.2mm 1.4mm}
table.tiny{font-size:7.8pt}table.tiny td{padding:.8mm 1.6mm}
table.num td:nth-child(n+2){font-variant-numeric:tabular-nums}
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6mm;align-items:start}.two table{font-size:8pt}.two table.fixed{table-layout:fixed}.two th{letter-spacing:0;padding:1.2mm 1.2mm;font-size:7pt;text-transform:none}.two td{padding:1.1mm 1.2mm}.two table.fixed td{overflow-wrap:anywhere}.two table.fixed td:not(:first-child){white-space:nowrap}.two .chip{white-space:nowrap}
.tiles{display:flex;gap:4mm;margin:0 0 4mm}
.tile{flex:1;min-width:0;border:1px solid var(--grid);border-radius:6px;padding:3mm 3.4mm;background:var(--surface)}
.exec h3{margin-top:4.2mm}.exec ul.tight li,.exec ol.tight li{margin-bottom:.8mm}.tile.wide{flex:2.3}.tile-row{display:flex;gap:4mm}.tile-col{flex:1;min-width:0}.tile-col+.tile-col{border-left:1px solid var(--grid);padding-left:4mm}.tile-v{white-space:nowrap;font-size:20pt;font-weight:700;line-height:1.1;color:var(--navy);letter-spacing:-.01em}
.tile-l{font-size:8.6pt;color:var(--ink);margin-top:1mm;font-weight:600}
.tile-s{font-size:7.6pt;color:var(--muted);margin-top:.6mm}
.card{border:1.5px solid var(--navy);border-radius:8px;overflow:hidden;margin:0 0 4mm}
.card-head{background:var(--navy);color:#fff;padding:4mm 5mm;display:flex;justify-content:space-between;align-items:flex-start}
.card-k{font-size:8pt;text-transform:uppercase;letter-spacing:.08em;opacity:.8}
.card-t{font-size:15pt;font-weight:700;margin:1mm 0}
.card-s{font-size:9pt;opacity:.92}
.card-r code{background:rgba(255,255,255,.16);color:#fff}
.card-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0}
.card-grid>div{padding:3mm 4mm;border-right:1px solid var(--grid)}.card-grid>div:last-child{border-right:0}
.card-grid .k{font-size:7.6pt;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.card-grid .v{font-size:9.6pt;font-weight:600;margin-top:1mm;word-break:break-word}
.card-grid .s{font-size:7.8pt;color:var(--ink2);margin-top:.6mm}
.state{display:inline-block;border-radius:10px;padding:.4mm 2.2mm;font-size:7.8pt;font-weight:600;white-space:nowrap}
.chip{display:inline-flex;align-items:center;gap:1.4mm;border-radius:3px;padding:.3mm 1.8mm;font-size:7.6pt;font-weight:700;letter-spacing:.03em;color:var(--ink)}
.chip i{font-style:normal;font-size:7pt}
.chip-CLEAN{background:${STATUS_TINT.CLEAN};border-left:3px solid ${STATUS.CLEAN}}.chip-PARTIAL{background:${STATUS_TINT.PARTIAL};border-left:3px solid ${STATUS.PARTIAL}}
.chip-REVIEW{background:${STATUS_TINT.REVIEW};border-left:3px solid ${STATUS.REVIEW}}.chip-BLOCKER{background:${STATUS_TINT.BLOCKER};border-left:3px solid ${STATUS.BLOCKER}}
.legend{display:flex;gap:5mm;font-size:8.4pt;margin:0 0 2mm}.legend span{display:inline-flex;align-items:center;gap:1.4mm}
.callout{border-left:4px solid var(--blue);background:#eef4fc;border-radius:0 6px 6px 0;padding:3mm 4mm;margin:3mm 0;font-size:9pt}
.callout.warn{border-color:${STATUS.PARTIAL};background:#fff8e6}.callout.ok{border-color:${STATUS.CLEAN};background:#edf8ed}
.src{font-size:7.4pt;border-radius:9px;padding:.2mm 1.8mm;white-space:nowrap}.src.stated{background:#e8eef9;color:#184f95}.src.scan{background:#e3f5e3;color:#006300}.src.unk{background:#eeedea;color:#52514e}
h3+p.note{break-after:avoid}.srcline{font-size:7.2pt;color:var(--muted)}table.plan td{padding:1.4mm 2mm}
.srcs{font-size:8pt;columns:2;column-gap:7mm}.srcs div{break-inside:avoid;margin:0 0 2.6mm}.url{color:var(--muted);word-break:break-all;font:7pt ui-monospace,Menlo,monospace}
`;

const body = [cover(), executive(), recommendation(), profileSection(), inventory(), drivers(), hotspots(), targetConfig(), outsideConverter(), effort(), dataMovement(), validation(), planSection(), levers(), hardCaseAppendix(), calibrationAppendix(), methodAppendix(), sourcesAppendix()].join('\n');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}: Oracle to PostgreSQL assessment</title><style>${CSS}</style></head><body>${body}</body></html>`;

const htmlPath = outPdf.replace(/\.pdf$/, '.html');
fs.mkdirSync(path.dirname(path.resolve(outPdf)), { recursive: true });
fs.writeFileSync(htmlPath, html);
console.error(`wrote ${htmlPath}`);
if (argv.includes('--html-only')) process.exit(0);

const layout = checkLayout(htmlPath);
if (layout && !layout.ok) console.error(`layout warning: content is wider than the page (${layout.scrollW}px against ${layout.W}px): ${layout.bad.join('; ')}. Chrome will shrink the printout.`);
if (!printToPdf(htmlPath, outPdf)) { console.error('No Chrome or Edge found. The HTML is written; print it to PDF from a browser.'); process.exit(3); }
console.error(`wrote ${outPdf} (${(fs.statSync(outPdf).size / 1024).toFixed(0)} KB)`);
