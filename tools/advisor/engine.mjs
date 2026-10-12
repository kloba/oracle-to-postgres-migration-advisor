// Executable mirror of reference/decision-rules.md.
//
// In a session the skill applies the markdown rules itself. This file is the same policy as code. It is
// the test oracle for tests/golden-scenarios.json, and it lets the report builder turn a profile (or a
// schema scan) into the exact recommendation card without a model in the loop. It reads every constant
// and every Oracle-feature verdict from reference/*.json, so it cannot drift from them on a value.
//
// Rule IDs reported here are the IDs in the rule index at the end of decision-rules.md. A test fails
// when the two lists disagree.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
export const RULES = readJson('reference/decision-rules.data.json');
export const FEATURE_MATRIX = readJson('reference/feature-matrix.json');
export const COMPAT = readJson('reference/compat-catalog.json');
const FS = RULES.flexibleServer;

// When several rules give a target the same most-severe state, the trace reports the one listed first in the rule
// index of decision-rules.md. The order is read from the document, so it cannot drift from it.
const RULE_ORDER = new Map([...fs.readFileSync(path.join(root, 'reference', 'decision-rules.md'), 'utf8').matchAll(/^\| `(OP-[A-Z0-9-]+)` \| [A-D] \|/gm)].map((m, i) => [m[1], i]));

export const KNOWLEDGE_BASE_VERSION = 'v1.0';
export const RULES_VERSION = 'v1.0';

export const TARGETS = ['pg_flex', 'pg_elastic', 'horizondb', 'pg_vm', 'pg_aks', 'cosmos_pg', 'oracle_dbaz', 'oracle_vm'];
export const PG_TARGETS = ['pg_flex', 'pg_elastic', 'horizondb', 'pg_vm', 'pg_aks', 'cosmos_pg'];
const MATRIX_TARGETS = FEATURE_MATRIX.targets; // the five that have feature cells
const ORACLE_TARGETS = ['oracle_dbaz', 'oracle_vm'];
const LABEL = Object.fromEntries(Object.entries(RULES.targets).map(([k, v]) => [k, v.label]));

const SEVERITY = { eligible: 1, eligible_with_remediation: 2, unknown_requires_assessment: 3, excluded_by_preference: 4, unsupported: 5 };
const SURVIVES = new Set(['eligible', 'eligible_with_remediation']);
const MATURITY_PENALTY = { pg_flex: 0, pg_elastic: 1, horizondb: 3, pg_vm: 4, pg_aks: 5 };

export const FIELDS = [
  'scope', 'source_location', 'source_version', 'topology', 'edition', 'character_set',
  'intent', 'driver', 'management_model', 'app_changeability', 'isv_supports_postgres',
  'compliance', 'region', 'preview_acceptable', 'cmk_required',
  'largest_db_size', 'peak_io', 'peak_compute', 'availability_target', 'dr_requirement',
  'feature_dependencies', 'oracle_features', 'plsql_volume', 'app_tier_oracle',
  'downtime', 'network_bandwidth', 'private_connectivity', 'converter_prereqs',
  'evidence',
];

const UNKNOWN_VALUES = new Set(['UNKNOWN', 'NOT_SURE', undefined, null, '']);
const isUnknown = v => UNKNOWN_VALUES.has(v);

export const slugRegion = r => (isUnknown(r) ? 'UNKNOWN' : String(r).toLowerCase().replace(/[^a-z0-9]/g, ''));

/** Map a schema assessment onto the interview fields it can supply: plsql_volume and oracle_features. */
export function profileFromAssessment(assessment) {
  const loc = assessment.totals.plsqlLoc;
  const t = RULES.plsqlVolumeLinesOfCode;
  const plsql_volume = loc < t.NONE_OR_LIGHT ? 'NONE_OR_LIGHT' : loc < t.MODERATE ? 'MODERATE' : loc < t.HEAVY ? 'HEAVY' : 'VERY_HEAVY';
  const present = new Set(assessment.constructs.map(c => c.id));
  const features = FEATURE_MATRIX.features.filter(f => f.scanConstructs.some(id => present.has(id))).map(f => f.featureId);
  return { plsql_volume, oracle_features: features, feature_dependencies: 'LIST_FEATURES', evidence: ['SCHEMA_SCAN'] };
}

export function normalise(input) {
  const p = {};
  for (const f of FIELDS) p[f] = input[f] === undefined ? 'UNKNOWN' : input[f];
  if (!Array.isArray(p.oracle_features)) p.oracle_features = isUnknown(p.oracle_features) ? [] : [p.oracle_features];
  if (!Array.isArray(p.evidence)) p.evidence = isUnknown(p.evidence) ? [] : [p.evidence];
  p.region = slugRegion(input.region);
  // A list answered NONE_CONFIRMED is an empty list; answered NOT_SURE it is unknown, not empty.
  if (p.feature_dependencies === 'NONE_CONFIRMED') p.oracle_features = [];
  // Features supplied without saying so still count as a stated list.
  if (isUnknown(p.feature_dependencies) && p.oracle_features.length) p.feature_dependencies = 'LIST_FEATURES';
  return p;
}

/** Collects what each rule says about each target, then reduces to the most severe state. */
class Trace {
  constructor() {
    this.entries = Object.fromEntries(TARGETS.map(t => [t, []]));
    this.remediation = Object.fromEntries(TARGETS.map(t => [t, { redesign: [], workaround: [], unknown: [] }]));
  }
  add(target, state, ruleId, reason, meta = {}) { this.entries[target].push({ state, ruleId, reason, ...meta }); }
  addAll(targets, state, ruleId, reason) { for (const t of targets) this.add(t, state, ruleId, reason); }
  reduce(target) {
    const list = this.entries[target];
    if (!list.length) return { state: 'eligible', ruleId: null, reason: 'Nothing consumed rules it out.', contributing: [] };
    const order = r => RULE_ORDER.get(r.ruleId) ?? 999;
    const top = [...list].sort((a, b) => SEVERITY[b.state] - SEVERITY[a.state] || order(a) - order(b))[0];
    return { state: top.state, ruleId: top.ruleId, reason: top.reason, contributing: list.filter(e => e !== top).map(({ state, ruleId, reason }) => ({ state, ruleId, reason })) };
  }
}

const CAPACITY_ASSUMPTIONS = [];

export function evaluate(rawInput, options = {}) {
  const p = normalise(rawInput);
  const tr = new Trace();
  const unknowns = [];
  const assumptions = [];
  const notes = [];
  const evidenceRequired = [];
  const nextActions = [];
  const blockers = [];
  const addUnknown = (field, why, rules) => {
    if (!unknowns.some(u => u.field === field)) unknowns.push({ field, why, rules });
    if (!evidenceRequired.some(e => e.field === field)) evidenceRequired.push({ field, evidence: why });
  };

  const OTHER_PG = ['pg_flex', 'pg_elastic', 'horizondb', 'pg_vm', 'pg_aks'];
  const MANAGED_MS = ['pg_flex', 'pg_elastic', 'horizondb'];

  // ---- OP-COSMOS
  tr.add('cosmos_pg', 'unsupported', 'OP-COSMOS', 'New deployments are blocked and the service retires 2029-03-31. Existing customers move to elastic clusters.');

  // ---- OP-ISV
  if (p.app_changeability === 'PACKAGED_ISV') {
    if (p.isv_supports_postgres === 'NO') tr.addAll(PG_TARGETS, 'unsupported', 'OP-ISV', 'A packaged vendor application that is certified only on Oracle Database. Moving the database does not move the application.');
    else if (isUnknown(p.isv_supports_postgres)) {
      tr.addAll(PG_TARGETS, 'unknown_requires_assessment', 'OP-ISV', 'A packaged vendor application. Whether the vendor supports PostgreSQL is not known.');
      addUnknown('isv_supports_postgres', 'Ask the application vendor whether the product is supported on PostgreSQL.', ['OP-ISV']);
    }
  }

  // ---- OP-FEATURE-GATE and OP-FEATURE-MATRIX
  if (isUnknown(p.feature_dependencies)) {
    tr.addAll(['pg_flex', 'pg_elastic', 'horizondb', 'pg_aks'], 'unknown_requires_assessment', 'OP-FEATURE-GATE', 'The Oracle features in use have not been checked. A scan decides whether this target can carry them.');
    tr.add('pg_vm', 'eligible_with_remediation', 'OP-FEATURE-GATE', 'The Oracle features in use have not been checked. This target is broad enough to stay eligible with the unknown recorded.');
    addUnknown('feature_dependencies', 'Run the schema scan or list the Oracle features the application uses.', ['OP-FEATURE-GATE', 'OP-FEATURE-MATRIX']);
  }
  const knownFeatures = new Set(FEATURE_MATRIX.features.map(f => f.featureId));
  const needsWork = Object.fromEntries(MATRIX_TARGETS.map(t => [t, []]));
  for (const id of p.oracle_features) {
    if (!knownFeatures.has(id)) { notes.push(`Unrecognised feature ID ${id} was ignored.`); continue; }
    const row = FEATURE_MATRIX.features.find(f => f.featureId === id);
    for (const t of MATRIX_TARGETS) {
      const cell = row.targets[t];
      if (cell.state === 'native') continue;
      tr.remediation[t][cell.state === 'unsupported' ? 'redesign' : cell.state]?.push({ feature: id, label: row.label, note: cell.note, sources: cell.sources });
      if (cell.state === 'unsupported') tr.add(t, 'unsupported', 'OP-FEATURE-MATRIX', `${row.label}: ${cell.note || 'not carried'}.`);
      else if (cell.state === 'redesign' && p.app_changeability === 'APP_FROZEN') tr.add(t, 'unsupported', 'OP-FROZEN-REDESIGN', `${row.label} needs a redesign (${cell.note}) and the application cannot change.`);
      else needsWork[t].push({ label: row.label, state: cell.state });
    }
  }
  // One entry per target: a long feature list is one finding about the target, not many.
  for (const t of MATRIX_TARGETS) {
    const list = needsWork[t];
    if (!list.length) continue;
    const parts = ['redesign', 'workaround', 'unknown'].map(st => [st, list.filter(x => x.state === st)]).filter(([, l]) => l.length);
    tr.add(t, 'eligible_with_remediation', 'OP-FEATURE-MATRIX', `${list.length} listed Oracle feature(s) are carried by a workaround, a redesign, or in a way the vendor does not document: ${parts.map(([st, l]) => `${st} (${l.length})`).join(', ')}.`);
  }

  // ---- OP-SIZE (capacity fields answered NOT_SURE record an assumption, not a hold)
  const size = p.largest_db_size;
  if (isUnknown(size)) {
    assumptions.push('Assumes the largest database stays within the flexible server ceiling of 32 TiB. Not stated.');
    addUnknown('largest_db_size', 'Planned size at the end of the planning horizon, from Oracle segment sizes plus growth.', ['OP-SIZE']);
  }
  const bigRank = { UNDER_1_TB: 1, FROM_1_TO_8_TB: 2, FROM_8_TO_32_TB: 3, FROM_32_TO_64_TB: 4, FROM_64_TO_128_TB: 5, OVER_128_TB: 6 }[size] || 0;
  tr.add('pg_elastic', bigRank === 5 ? 'eligible_with_remediation' : 'unknown_requires_assessment', 'OP-SIZE',
    bigRank === 5 ? 'Shardable workloads only: needs a distribution key and a data-model change.' : 'An elastic cluster needs a distribution key. The advisor cannot know the workload shards cleanly.', { inherent: bigRank !== 5 });
  if (bigRank === 4) tr.add('pg_flex', 'eligible_with_remediation', 'OP-SIZE', 'Between 32 and 64 TiB needs Premium SSD v2, which has no storage autogrow, no long-term retention backups and no on-demand backups.');
  if (bigRank >= 5) {
    tr.add('pg_flex', 'unsupported', 'OP-SIZE', 'Above 64 TiB: the largest flexible server storage is 64 TiB on Premium SSD v2.');
    for (const t of ['pg_vm', 'pg_aks']) tr.add(t, 'unknown_requires_assessment', 'OP-SIZE', 'Above 64 TiB: striping across disks is possible but Microsoft publishes nothing to confirm it.');
  }
  if (bigRank === 5) tr.add('horizondb', 'eligible_with_remediation', 'OP-SIZE', 'Up to 128 TB, in public preview.');
  if (bigRank === 6) tr.add('horizondb', 'unsupported', 'OP-SIZE', 'Above 128 TB: beyond HorizonDB storage.');

  // ---- OP-IO
  if (p.peak_io === 'OVER_80K_IOPS') {
    tr.add('pg_flex', 'unsupported', 'OP-IO', 'Above 80,000 IOPS or 1,200 MiB/s, the Premium SSD v2 ceiling.');
    for (const t of ['horizondb', 'pg_vm', 'pg_aks']) tr.add(t, 'unknown_requires_assessment', 'OP-IO', 'Striping may reach it. Microsoft publishes nothing to confirm.');
  } else if (p.peak_io === 'FROM_20K_TO_80K_IOPS') {
    tr.add('pg_flex', 'eligible_with_remediation', 'OP-IO', 'Above 20,000 IOPS needs Premium SSD v2, which has no storage autogrow, no long-term retention backups and no on-demand backups.');
  } else if (isUnknown(p.peak_io)) {
    assumptions.push('Assumes peak IOPS stays under the Premium SSD ceiling of 20,000. Not stated.');
    addUnknown('peak_io', 'Peak IOPS and throughput from AWR or ASH.', ['OP-IO']);
  }

  // ---- OP-COMPUTE and OP-V6
  if (p.peak_compute === 'FROM_97_TO_192_VCORES') {
    const v6 = 'Above 96 vCores only the V6 SKUs reach it, and V6 is in public preview without VNet integration.';
    if (p.preview_acceptable === 'PREVIEW_ACCEPTED') tr.add('pg_flex', 'eligible_with_remediation', 'OP-V6', v6);
    else if (p.preview_acceptable === 'PREVIEW_REFUSED') tr.add('pg_flex', 'excluded_by_preference', 'OP-V6', v6 + ' The customer refuses preview services.');
    else { tr.add('pg_flex', 'unknown_requires_assessment', 'OP-V6', v6 + ' Whether preview is acceptable is not known.'); addUnknown('preview_acceptable', 'Whether a preview service is acceptable.', ['OP-V6', 'OP-PREVIEW']); }
    for (const t of ['pg_vm', 'pg_aks']) tr.add(t, 'eligible_with_remediation', 'OP-COMPUTE', 'Large VM sizes exist. Sizing is the operator\'s.');
  } else if (p.peak_compute === 'OVER_192_VCORES') {
    tr.addAll(['pg_flex', 'horizondb'], 'unsupported', 'OP-COMPUTE', 'Above 192 vCores.');
    tr.addAll(['pg_elastic', 'pg_vm', 'pg_aks'], 'unknown_requires_assessment', 'OP-COMPUTE', 'Above 192 vCores: scale-out or a very large VM is needed and Microsoft publishes nothing to confirm either.');
  } else if (isUnknown(p.peak_compute)) {
    assumptions.push('Assumes peak compute stays within 96 vCores, the generally available flexible server ceiling. Not stated.');
    addUnknown('peak_compute', 'Peak vCores and memory from AWR or ASH.', ['OP-COMPUTE']);
  }

  // ---- OP-AVAILABILITY and OP-REGION-HA
  const avail = p.availability_target;
  if (avail === 'HIGH_99_95' || avail === 'HIGHEST_99_99') {
    tr.add('horizondb', 'unsupported', 'OP-AVAILABILITY', 'HorizonDB publishes no SLA percentage.');
    tr.addAll(['pg_vm', 'pg_aks'], 'eligible_with_remediation', 'OP-AVAILABILITY', 'The customer builds and tests HA. There is no managed-service SLA.');
    if (avail === 'HIGHEST_99_99') {
      const blocked = FS.zoneRedundantHa.blockedForNewDeployments;
      const missing = FS.zoneRedundantHa.unavailable;
      if (p.region !== 'UNKNOWN' && (blocked.includes(p.region) || missing.includes(p.region))) {
        tr.add('pg_flex', 'eligible_with_remediation', 'OP-REGION-HA', blocked.includes(p.region)
          ? 'New zone-redundant HA deployments are temporarily blocked in this region. Use a sibling region, or accept 99.95% with same-zone HA.'
          : 'Zone-redundant HA is not available in this region. Use a sibling region, or accept 99.95% with same-zone HA.');
      } else if (p.region === 'UNKNOWN') {
        addUnknown('region', 'The Azure region, because zone-redundant HA is blocked or absent in several.', ['OP-REGION-HA']);
      }
    }
  } else if (isUnknown(avail)) {
    addUnknown('availability_target', 'The availability target the business needs.', ['OP-AVAILABILITY']);
  }

  // ---- OP-DR
  if (p.dr_requirement === 'ZERO_RPO_CROSS_REGION') {
    tr.addAll(['pg_flex', 'pg_elastic', 'horizondb'], 'unsupported', 'OP-DR', 'Cross-region replication is asynchronous and forced promotion can lose data.');
    tr.addAll(['pg_vm', 'pg_aks'], 'eligible_with_remediation', 'OP-DR', 'Synchronous cross-region replication is possible. The customer owns the latency cost.');
  } else if (p.dr_requirement === 'ASYNC_CROSS_REGION') {
    tr.add('horizondb', 'unsupported', 'OP-DR', 'No cross-region read replicas in public preview.');
    tr.add('pg_elastic', 'unsupported', 'OP-DR', 'An elastic cluster offers a single read replica and no documented cross-region path.');
  } else if (isUnknown(p.dr_requirement)) addUnknown('dr_requirement', 'The recovery point the business needs across regions.', ['OP-DR']);

  // ---- OP-CMK
  if (p.cmk_required === 'CMK_YES') {
    tr.add('horizondb', 'unsupported', 'OP-CMK', 'Customer-managed keys are not supported in the preview. HorizonDB offers service-managed keys only.');
    notes.push('Customer-managed keys on flexible server are a creation-time choice and cannot be added or removed later.');
  }

  // ---- OP-PREVIEW, OP-HZ-GATE, OP-HZ-REGION
  if (p.preview_acceptable === 'PREVIEW_REFUSED') tr.add('horizondb', 'excluded_by_preference', 'OP-PREVIEW', 'Public preview with no published SLA. The customer refuses preview services.');
  else if (isUnknown(p.preview_acceptable)) {
    tr.add('horizondb', 'unknown_requires_assessment', 'OP-PREVIEW', 'Public preview with no published SLA. Whether preview is acceptable is not known.');
    if (!unknowns.some(u => u.field === 'preview_acceptable')) addUnknown('preview_acceptable', 'Whether a preview service is acceptable.', ['OP-PREVIEW']);
  }
  if (p.region !== 'UNKNOWN' && !RULES.horizonDb.regions.includes(p.region)) tr.add('horizondb', 'unsupported', 'OP-HZ-REGION', 'The region is not in the HorizonDB preview region list.');
  else if (p.region === 'UNKNOWN') tr.add('horizondb', 'unknown_requires_assessment', 'OP-HZ-REGION', 'The region is not known, and HorizonDB is available in nine.');

  // ---- OP-MANAGEMENT, OP-VENDOR, OP-REGION
  if (p.management_model === 'MANAGED_PAAS') {
    tr.addAll(['pg_vm', 'pg_aks', 'oracle_vm'], 'excluded_by_preference', 'OP-MANAGEMENT', 'The customer prefers a fully managed service.');
  } else if (p.management_model === 'OS_CONTROL') {
    tr.addAll(MANAGED_MS, 'unsupported', 'OP-MANAGEMENT', 'The customer needs OS, file-system or engine control. A managed service gives no superuser, no file system and no custom extensions.');
    tr.add('oracle_dbaz', 'excluded_by_preference', 'OP-MANAGEMENT', 'Oracle operates the infrastructure, so the customer has no operating-system control of the database servers.');
  } else if (p.management_model === 'KUBERNETES') {
    tr.addAll([...OTHER_PG.filter(t => t !== 'pg_aks'), ...ORACLE_TARGETS], 'excluded_by_preference', 'OP-MANAGEMENT', 'The customer wants to run on Kubernetes.');
  }
  if (p.compliance === 'GOVERNMENT_SOVEREIGN') {
    tr.addAll(MANAGED_MS, 'unknown_requires_assessment', 'OP-REGION', 'Sovereign-region availability of this service is not established.');
    tr.add('oracle_dbaz', 'unsupported', 'OP-STAY-REGION', 'Oracle AI Database@Azure is not offered in sovereign clouds.');
  } else if (p.compliance === 'EDGE_AIR_GAPPED') {
    tr.addAll(MANAGED_MS, 'unsupported', 'OP-REGION', 'An air-gapped or edge site cannot reach a managed cloud service.');
    tr.addAll(ORACLE_TARGETS, 'unsupported', 'OP-STAY-REGION', 'An air-gapped or edge site is not an Azure region.');
  }

  // ---- Oracle on Azure
  if (p.region !== 'UNKNOWN') {
    if (!RULES.oracleStay.dbAtAzureRegions.includes(p.region)) tr.add('oracle_dbaz', 'unsupported', 'OP-STAY-REGION', 'The region is not one of the 33 regions where Oracle AI Database@Azure is offered.');
  } else tr.add('oracle_dbaz', 'unknown_requires_assessment', 'OP-STAY-REGION', 'The region is not known. Oracle AI Database@Azure is offered in 33 regions and needs an OCI tenancy.');
  if (p.topology === 'RAC') tr.add('oracle_vm', 'unknown_requires_assessment', 'OP-STAY-ORACLE', 'Microsoft says RAC is unsupported on Azure Bare Metal and says nothing about RAC on standard virtual machines.');
  if (p.source_location === 'ORACLE_DB_AT_AZURE') tr.add('oracle_dbaz', 'unsupported', 'OP-STAY-ORACLE', 'The source already runs on Oracle AI Database@Azure.');

  // ---- OP-RAC, OP-ESTATE, OP-LICENSE-NOTE
  if (p.topology === 'RAC' && p.oracle_features.includes('RAC_WRITE_SCALE')) notes.push('RAC write scale-out has no PostgreSQL equivalent. PostgreSQL has one writer, so the workload must fit one node (OP-RAC).');
  if (p.scope === 'LARGE_ESTATE') nextActions.push('Run the schema scan across the estate first and group databases by result. One profile cannot stand for many (OP-ESTATE).');
  if (p.edition === 'SE2' || p.topology === 'EXADATA' || p.topology === 'RAC') notes.push('Confirm Oracle entitlements with Oracle contract and licence management. Standard Edition 2 has a vCPU cap on Azure virtual machines (OP-LICENSE-NOTE).');

  // ---- reduce Phase A
  const eligibilityTrace = Object.fromEntries(TARGETS.map(t => [t, { label: LABEL[t], ...tr.reduce(t) }]));
  const survivors = TARGETS.filter(t => SURVIVES.has(eligibilityTrace[t].state));
  const held = TARGETS.filter(t => eligibilityTrace[t].state === 'unknown_requires_assessment');
  // A hold the target carries by its nature (an elastic cluster needs a distribution key, whatever the answers) is not
  // an unanswered question. It keeps the target out of the primary choice and does not make a shortlist.
  const heldOpen = held.filter(t => tr.entries[t].some(e => e.state === 'unknown_requires_assessment' && !e.inherent));

  // ---- Phase B: score and choose
  const rigid = p.app_changeability === 'APP_LIMITED' ? 3 : 1;
  const scoreOf = t => {
    const r = tr.remediation[t];
    return round(r.redesign.length * rigid + r.workaround.length * 0.25 + r.unknown.length * 1.5 + (MATURITY_PENALTY[t] ?? 99));
  };
  const scores = Object.fromEntries(OTHER_PG.map(t => [t, scoreOf(t)]));
  const pgSurvivors = OTHER_PG.filter(t => SURVIVES.has(eligibilityTrace[t].state));
  const byScore = ts => [...ts].sort((a, b) => scores[a] - scores[b] || MATURITY_PENALTY[a] - MATURITY_PENALTY[b]);

  const stayPrimary = () => {
    const dbaz = SURVIVES.has(eligibilityTrace.oracle_dbaz.state);
    const vm = SURVIVES.has(eligibilityTrace.oracle_vm.state);
    const preferDbaz = p.topology === 'RAC' || p.topology === 'EXADATA' || p.edition === 'EE';
    if (dbaz && (preferDbaz || !vm)) return 'oracle_dbaz';
    if (vm) return 'oracle_vm';
    return dbaz ? 'oracle_dbaz' : null;
  };

  let primary = null;
  let primaryRule = null;
  let primaryWhy = '';
  if (p.intent === 'REHOST_FIRST' && stayPrimary()) {
    primary = stayPrimary(); primaryRule = 'OP-INTENT';
    primaryWhy = 'The customer wants to move Oracle to Azure first and modernise later.';
  } else if (!pgSurvivors.length && stayPrimary() && !heldOpen.some(t => PG_TARGETS.includes(t) && t !== 'cosmos_pg')) {
    primary = stayPrimary();
    primaryRule = p.app_changeability === 'PACKAGED_ISV' && p.isv_supports_postgres === 'NO' ? 'OP-ISV' : 'OP-STAY-ORACLE';
    primaryWhy = 'No PostgreSQL target survives. Moving Oracle as it is to Azure is the honest answer.';
  } else if (p.management_model === 'KUBERNETES' && pgSurvivors.includes('pg_aks')) {
    primary = 'pg_aks'; primaryRule = 'OP-MANAGEMENT'; primaryWhy = 'The customer wants to run on Kubernetes.';
  } else if (p.management_model === 'OS_CONTROL' && pgSurvivors.includes('pg_vm')) {
    primary = 'pg_vm'; primaryRule = 'OP-MANAGEMENT'; primaryWhy = 'The customer needs OS and engine control, which a managed service does not give.';
    } else if (pgSurvivors.length) {
    primary = byScore(pgSurvivors)[0]; primaryRule = 'OP-RANK';
    primaryWhy = `Lowest score among the surviving targets (${scores[primary]}).`;
  }

  // A held, better-ranked target could overturn a default ranking: that is a shortlist, not a recommendation.
  let status = 'provisional';
  let shortlist = null;
  const heldBetter = primary && primaryRule === 'OP-RANK'
    ? heldOpen.filter(t => OTHER_PG.includes(t) && MATURITY_PENALTY[t] < MATURITY_PENALTY[primary]) : [];
  if (!primary || heldBetter.length) {
    status = 'shortlist';
    const names = new Set([...heldBetter, ...(primary && primaryRule === 'OP-RANK' ? [primary] : []), ...pgSurvivors.slice(0, 2)]);
    if (!names.size) for (const t of heldOpen.slice(0, 3)) names.add(t);
    // A shortlist names at least two families (decision-rules.md, B3). Fill from the Oracle targets that survive
    // (staying on Oracle is the honest fallback), then from the families that come closest to standing.
    const closeness = [...TARGETS].filter(x => x !== 'cosmos_pg').sort((x, y) => SEVERITY[eligibilityTrace[x].state] - SEVERITY[eligibilityTrace[y].state]);
    for (const t of [...ORACLE_TARGETS.filter(x => SURVIVES.has(eligibilityTrace[x].state)), ...closeness]) { if (names.size >= 2) break; names.add(t); }
    shortlist = [...names].slice(0, 4).map(t => {
      const e = eligibilityTrace[t];
      const stands = SURVIVES.has(e.state);
      return {
        target: t, label: LABEL[t], state: e.state,
        why: stands ? 'Survives Phase A.' : e.reason,
        separatedBy: stands || e.state === 'unknown_requires_assessment' ? separator(t, p) : `Revisit the answer behind ${e.ruleId}. ${separator(t, p)}`,
      };
    });
    primary = null; primaryRule = null;
  }

  // alternative
  let alternative = null;
  if (primary) {
    const pool = (PG_TARGETS.includes(primary) ? pgSurvivors : survivors).filter(t => t !== primary && t !== 'cosmos_pg');
    const alt = (PG_TARGETS.includes(primary) ? byScore(pool.filter(t => OTHER_PG.includes(t)))[0] : byScore(pool.filter(t => OTHER_PG.includes(t)))[0]);
    const keepsWhatTheyLeave = ['ORACLE_LICENSE_COST', 'OPEN_SOURCE_STRATEGY'].includes(p.driver);
    const altOracle = !PG_TARGETS.includes(primary) || keepsWhatTheyLeave ? null : ORACLE_TARGETS.find(t => SURVIVES.has(eligibilityTrace[t].state));
    const chosen = alt || (primary !== 'oracle_dbaz' && primary !== 'oracle_vm' ? altOracle : null);
    if (chosen) alternative = { target: chosen, label: LABEL[chosen], wins: wins(chosen, p, tr) };
  }

  const recommendation = primary ? {
    target: primary,
    label: LABEL[primary],
    ruleId: primaryRule,
    why: primaryWhy,
    postgresMajor: PG_TARGETS.includes(primary) ? 17 : null,
    postgresVersionNote: PG_TARGETS.includes(primary) ? 'PostgreSQL 17 or 18. PostgreSQL 18 lacks some extensions, so check the allow-list first. Never PostgreSQL 14 or older.' : null,
    remediation: PG_TARGETS.includes(primary) ? tr.remediation[primary] : null,
  } : null;

  if (primary === 'oracle_dbaz' && p.edition === 'SE2') evidenceRequired.push({ field: 'oracle_edition_on_dbaz', evidence: 'Confirm with Oracle whether Standard Edition 2 licences can be used on Oracle Database@Azure. The sources read do not say.' });
  // ---- Step C: methods
  const methods = recommendation && PG_TARGETS.includes(primary) ? methodsFor(primary, p, eligibilityTrace) : { candidates: [], selected: null, gate: null, gaps: [] };
  const methodCandidates = methods.candidates;

  // ---- Unanswered fields that a rule consumed to reach this answer (input-contract.md, section 1)
  const hardFields = new Set();
  const need = (field, why, rules, hard = false) => {
    if (!isUnknown(p[field])) return;
    addUnknown(field, why, rules);
    if (hard) hardFields.add(field);
  };
  need('source_version', 'The Oracle release decides whether the Microsoft converter applies.', ['OP-SOURCE-VERSION', 'OP-CONVERTER-GATE'], true);
  need('app_changeability', 'Whether the application can change decides how a redesign is weighed.', ['OP-FROZEN-REDESIGN', 'OP-RANK'], true);
  need('management_model', 'How much control the customer needs over the operating system and the engine.', ['OP-MANAGEMENT']);
  need('compliance', 'Data residency, sovereign or air-gapped constraints.', ['OP-REGION', 'OP-STAY-REGION']);
  need('intent', 'Whether the customer wants to move now, assess only, or rehost first.', ['OP-INTENT']);
  need('plsql_volume', 'Lines of PL/SQL, from a schema scan or an estimate.', ['OP-PLSQL', 'OP-RANK']);
  need('cmk_required', 'Whether customer-managed keys are required.', ['OP-CMK']);
  need('app_tier_oracle', 'Oracle components around the database (Forms, Reports, APEX, OBIEE, ODI, WebLogic, mod_plsql).', ['OP-APP-TIER']);
  need('topology', 'Single instance, RAC or Exadata.', ['OP-RAC', 'OP-STAY-ORACLE']);
  const sel = methods.selected;
  if (sel) {
    need('downtime', 'The cutover downtime the business accepts picks the data-movement family.', ['OP-METHOD-DATA', 'OP-DOWNTIME'], true);
    if (sel.schemaConversion === 'MS_VSCODE_AI') need('converter_prereqs', 'Whether a Microsoft Foundry gpt-5.2 deployment with quota above 1,000,000 tokens per minute and a GitHub Copilot seat exist.', ['OP-CONVERTER-GATE'], true);
    const online = sel.dataFamily === 'online';
    need('private_connectivity', 'Whether a private path exists from Azure to the Oracle listener.', ['OP-ORACLE-FDW-PATH']);
    if (online || p.downtime === 'MINIMAL') need('network_bandwidth', 'The network path to Azure.', ['OP-METHOD-DATA', 'OP-SEED']);
    if (sel.schemaConversion === 'MS_VSCODE_AI' && p.source_version === 'ORA_23AI_26AI') evidenceRequired.push({ field: 'converter_pilot', evidence: 'A pilot of 10 to 15 representative objects settles whether the Microsoft converter handles Oracle 23ai and 26ai, which Microsoft does not list.' });
  }

  // ---- Step D
  if (['eligible', 'eligible_with_remediation', 'unknown_requires_assessment'].includes(eligibilityTrace.horizondb.state)) notes.push(`HorizonDB is a public preview and does not yet carry: ${RULES.horizonDb.notSupportedInPreview.join('; ')} (OP-HZ-GATE).`);
  if (p.source_version === 'ORA_23AI_26AI') notes.push('Microsoft lists Oracle 12.1 to 21c for its converter and does not list 23ai or 26ai. Run a pilot before relying on it (OP-CONVERTER-GATE).');
  if (['ORA_11G_OR_OLDER', 'ORA_12C', 'ORA_18C'].includes(p.source_version)) notes.push('This Oracle release is in Sustaining Support: no new fixes or security updates. That raises urgency, not the choice of target (OP-LIFECYCLE).');
  if (p.app_tier_oracle === 'LIST_APP_TIER') notes.push('Oracle components around the database (Forms, Reports, APEX, OBIEE, ODI, WebLogic, mod_plsql) are application work and do not migrate with the database (OP-APP-TIER).');
  if (p.character_set && !['AL32UTF8', 'UNKNOWN', 'NOT_SURE'].includes(p.character_set)) notes.push('A non-UTF-8 Oracle character set needs conversion during load. Characters that do not map are a data-quality finding (OP-CHARSET).');
  if (isUnknown(p.character_set)) addUnknown('character_set', 'The Oracle database character set (NLS_CHARACTERSET).', ['OP-CHARSET']);
  if (p.evidence.length && !p.evidence.includes('NONE')) notes.push(`Stated evidence (${p.evidence.join(', ')}) is recorded as a claim to verify elsewhere. It does not raise confidence (OP-EVIDENCE).`);

  if (primary && PG_TARGETS.includes(primary)) {
    const rem = tr.remediation[primary];
    if (rem.redesign.length) blockers.push(...rem.redesign.map(r => ({ feature: r.feature, label: r.label, why: r.note })));
  }
  const largestRisk = largestRiskOf(primary, tr, p, unknowns);

  if (!p.evidence.includes('SCHEMA_SCAN')) nextActions.push('Run the schema scan (oracle-assess-schema) on the DDL and PL/SQL export. It needs no database connection.');
    if (primary && PG_TARGETS.includes(primary) && !['ORA_11G_OR_OLDER'].includes(p.source_version)) nextActions.push('Run the discovery step of the Microsoft converter for the object inventory and invalid objects.');
  if (isUnknown(p.peak_io) || isUnknown(p.peak_compute) || isUnknown(p.largest_db_size)) nextActions.push('Collect AWR or ASH reports over a representative month to size the target. This advisor does not size.');
  nextActions.push('Pilot 10 to 15 representative objects end to end before committing to an estimate.');
  if (primary && ['pg_flex', 'pg_elastic'].includes(primary)) nextActions.push('Allow-list the extensions the schema needs through azure.extensions, and preload plpgsql_check and pg_cron, before the first conversion run.');
  for (const u of unknowns) nextActions.push(`Settle ${u.field}: ${u.why}`);

  const confidence = status === 'shortlist' || unknowns.some(u => HARD_UNKNOWN.has(u.field) || hardFields.has(u.field)) || assumptions.length ? 'low' : 'medium';

  return {
    metadata: {
      knowledgeBaseVersion: KNOWLEDGE_BASE_VERSION,
      decisionRulesVersion: RULES_VERSION,
      recommendationStatus: status,
      confidence,
    },
    normalizedProfile: p,
    eligibilityTrace,
    recommendation,
    alternative,
    shortlist,
    scores,
    methodCandidates,
    selectedMethods: methods.selected,
    methodGateTrace: methods.gate,
    methodGaps: methods.gaps,
    blockers,
    unknowns,
    assumptions,
    evidenceRequired,
    largestRisk,
    notes,
    nextActions: [...new Set(nextActions)],
    costLevers: costLevers(),
    programmeFit: programmeFit(p),
    retired: RULES.retired.map(r => ({ item: r.item, use: r.use })),
  };
}

const HARD_UNKNOWN = new Set(['feature_dependencies', 'isv_supports_postgres', 'app_changeability', 'downtime', 'source_version']);
const round = n => Math.round(n * 100) / 100;

function separator(target, p) {
  switch (target) {
    case 'pg_flex': return 'Run the schema scan. If the features in use are carried by flexible server, it is the default.';
    case 'pg_vm': return 'Whether an extension, language or OS-level need falls outside the flexible server allow-list.';
    case 'horizondb': return 'Whether preview is acceptable and whether the database passes 64 TiB.';
    case 'pg_aks': return 'Whether the platform team standardises on Kubernetes.';
    case 'pg_elastic': return 'Whether the workload shards cleanly on one key.';
    case 'oracle_dbaz': return 'Whether the application is certified only on Oracle, or the rewrite budget is zero.';
    case 'oracle_vm': return 'The lowest-change rehost, if the PostgreSQL rewrite is not funded.';
    default: return 'More evidence.';
  }
}

function wins(target, p, tr) {
  switch (target) {
    case 'pg_flex': return 'wins if the team accepts moving the redesign items out of the database and wants a Microsoft first-party service';
    case 'pg_vm': return 'wins if an extension, procedural language or OS-level need appears that the flexible server allow-list does not cover';
    case 'pg_aks': return 'wins if the platform team standardises on Kubernetes';
    case 'horizondb': return 'wins if the database passes 64 TiB or read scale-out is needed, and preview is acceptable';
    case 'pg_elastic': return 'wins only if the workload shards cleanly on a distribution key';
    case 'oracle_dbaz': return 'wins if the PostgreSQL rewrite is not funded, or the application is certified only on Oracle';
    case 'oracle_vm': return 'wins as the lowest-change rehost if the PostgreSQL rewrite is not funded';
    default: return 'wins when the stated condition changes';
  }
}

function largestRiskOf(primary, tr, p, unknowns) {
  if (!primary) return 'No target can be named until the held questions are answered.';
  if (!PG_TARGETS.includes(primary)) return 'Oracle licensing and support cost stay. The modernisation question is deferred, not answered.';
  const rem = tr.remediation[primary];
  if (rem.redesign.length) return `${rem.redesign.length} Oracle feature(s) have no equivalent on this target and need an application or data-model change: ${rem.redesign.map(r => r.label).join('; ')}.`;
  if (rem.unknown.length) return `The vendor documentation does not say whether this target carries ${rem.unknown.map(r => r.label).join('; ')}. Confirm with the vendor before relying on it.`;
  if (unknowns.some(u => u.field === 'feature_dependencies')) return 'The Oracle features in use have not been checked, so a blocker may be hiding.';
  if (p.source_version === 'ORA_11G_OR_OLDER') return 'Oracle 11g is below the Microsoft converter\'s supported range, and Microsoft publishes no other converter. Schema conversion is a gap (OP-SCOPE).';
  if (p.source_version === 'ORA_23AI_26AI') return 'Oracle 23ai and 26ai are not in the Microsoft converter\'s documented range.';
  if (['HEAVY', 'VERY_HEAVY'].includes(p.plsql_volume)) return 'The volume of PL/SQL: converted code is not equivalent code, and every object needs independent testing.';
  return 'Converted is not equivalent. Silent semantic differences (empty strings, NULL in concatenation, ROWNUM, date types) pass compilation and fail in production.';
}

// ---------------------------------------------------------------------------------------------
// Step C
// ---------------------------------------------------------------------------------------------
function methodsFor(target, p, trace) {
  const candidates = [];
  const add = (id, family, role, status, reason, ruleId) => candidates.push({ id, family, role, status, reason, ruleId });
  const wantsOnline = ['NEAR_ZERO'].includes(p.downtime)
    || (p.downtime === 'MINIMAL' && !(p.largest_db_size === 'UNDER_1_TB' && p.network_bandwidth === 'GOOD_BANDWIDTH'));
  const offlineOnly = p.downtime === 'OFFLINE';
  const downtimeUnknown = isUnknown(p.downtime);

  // C1: schema and code conversion
  const v = p.source_version;
  let ms;
  if (v === 'ORA_11G_OR_OLDER') ms = ['unavailable', 'Oracle 11g and older are not in the converter\'s supported range of 12.1 to 21c.', 'OP-SOURCE-VERSION'];
  else if (v === 'ORA_23AI_26AI') ms = ['unknown_requires_assessment', 'Oracle 23ai and 26ai are not listed. A pilot decides.', 'OP-SOURCE-VERSION'];
  else if (isUnknown(v)) ms = ['unknown_requires_assessment', 'The Oracle version is not known. The converter supports 12.1 to 21c.', 'OP-SOURCE-VERSION'];
  else if (p.converter_prereqs === 'FOUNDRY_OR_COPILOT_MISSING') ms = ['unavailable', 'It needs a Foundry gpt-5.2 deployment with more than 1,000,000 tokens per minute and a GitHub Copilot seat. Neither exists yet.', 'OP-CONVERTER-GATE'];
  else if (isUnknown(p.converter_prereqs)) ms = ['unknown_requires_assessment', 'Whether the Foundry quota and the Copilot seat exist is not known.', 'OP-CONVERTER-GATE'];
  else ms = ['available', 'Generally available since v1.23.0 (2026-05-26). Converts schema and PL/SQL, not rows. Output is reviewed and tested.', 'OP-CONVERTER-GATE'];
  if (target === 'horizondb' && ms[0] === 'available') ms[1] += ' A flexible server is still needed as the scratch database.';
  add('MS_VSCODE_AI', 'conversion', 'migration', ...ms);
  add('APP_CONVERSION_PREVIEW', 'conversion', 'overlay', p.preview_acceptable === 'PREVIEW_REFUSED' ? 'refused' : isUnknown(p.preview_acceptable) ? 'unknown_requires_assessment' : 'available',
    p.preview_acceptable === 'PREVIEW_REFUSED' ? 'Application-code conversion is in preview and the customer refuses preview services.' : 'Application-code conversion is in preview. It never replaces schema conversion.', 'OP-PREVIEW');

  // C2: data movement. Microsoft publishes no change-capture service, so only the offline routes are candidates.
  const fdwPath = target === 'pg_flex' || target === 'pg_vm' || target === 'pg_aks';
  const offlineBase = wantsOnline && !downtimeUnknown ? 'unavailable' : downtimeUnknown ? 'unknown_requires_assessment' : 'available';
  const offReason = wantsOnline ? 'The downtime tolerance needs change capture. A bulk copy alone would exceed it.' : downtimeUnknown ? 'The downtime tolerance is not known.' : '';
  add('ADF_COPY', 'data', 'transport', offlineBase, `Data Factory Oracle connector v2.0. Moves rows. No DDL and no change capture. ${offReason}`.trim(), 'OP-METHOD-DATA');
  let fdwStatus = offlineBase; let fdwReason = 'INSERT SELECT over oracle_fdw. Needs a network path from the PostgreSQL server to Oracle.';
  if (!fdwPath) { fdwStatus = 'unavailable'; fdwReason = target === 'horizondb' ? 'oracle_fdw is absent from the HorizonDB extension list.' : 'Microsoft does not document oracle_fdw for this target.'; }
  else if (p.private_connectivity === 'PUBLIC_ONLY') { fdwStatus = 'unavailable'; fdwReason += ' Only public connectivity exists.'; }
  else if (isUnknown(p.private_connectivity) && fdwStatus === 'available') { fdwStatus = 'unknown_requires_assessment'; fdwReason += ' Whether a private path exists is not known.'; }
  add('ORACLE_FDW_COPY', 'data', 'transport', fdwStatus, `${fdwReason} ${offReason}`.trim(), 'OP-ORACLE-FDW-PATH');
  if (['LIMITED_WAN', 'VERY_LARGE_MULTI_TB'].includes(p.network_bandwidth)) add('FILE_SEED', 'data', 'transport', 'available', 'The wire is the limit. Export to files, ship them (Azure Data Box or Storage Mover), load with COPY, then close the gap with change capture, which Microsoft does not offer. A transport, not a method: it has no cutover of its own.', 'OP-SEED');

  // C3: validation
  add('PLPGSQL_CHECK', 'validation', 'validation', target === 'horizondb' ? 'unavailable' : 'available', target === 'horizondb' ? 'plpgsql_check is absent from the HorizonDB extension list.' : 'Allow-list it and preload it, then restart. If the extension is missing the check silently does not run.', 'OP-CONVERTER-GATE');
  add('DIFFERENTIAL_TESTING', 'validation', 'validation', 'available', 'The same queries and workloads on both sides, result sets diffed. The only route that catches a converted query that is wrong and quiet.', 'OP-EVIDENCE');
  add('ORACLE_FDW_COMPARE', 'validation', 'validation', fdwPath ? 'available' : 'unavailable', fdwPath ? 'Row-level comparison through foreign tables. Needs primary keys, and collation C or ordering differs.' : 'oracle_fdw is absent on this target.', 'OP-ORACLE-FDW-PATH');

  // C4: assessment
  for (const [id, note] of [['SCHEMA_SCAN', 'This repository\'s static scan. Reads source text only.'], ['VSCODE_DISCOVERY', 'Object inventory, dependent schemas and invalid objects. No effort estimate.'], ['AWR_SIZING', 'The only honest source for sizing a target.']]) {
    add(id, 'assessment', 'assessment', 'available', note, 'OP-EVIDENCE');
  }

  // selected methods (OP-SCOPE). The Microsoft converter is the only schema route Microsoft publishes. It is named while it is
  // merely unproven, with the pilot that settles it. There is no online data route: that is a gap, not a product.
  const conv = candidates.find(c => c.id === 'MS_VSCODE_AI');
  const selectedConv = conv.status === 'available' || conv.status === 'unknown_requires_assessment' ? conv : null;
  const dataPool = ['ADF_COPY', 'ORACLE_FDW_COPY'].map(id => candidates.find(c => c.id === id));
  const selectedData = dataPool.find(c => c.status === 'available') || dataPool.find(c => c.status === 'unknown_requires_assessment') || null;
  const selected = { schemaConversion: selectedConv?.id ?? null, dataMovement: selectedData?.id ?? null, dataFamily: wantsOnline ? 'online' : downtimeUnknown ? 'unknown' : 'offline' };

  const gateOf = (c) => ({ method: c.id, result: c.status === 'available' ? 'passed' : c.status, gates: [{ rule: c.ruleId, result: c.status === 'available' ? 'passed' : 'unknown_requires_assessment', reason: c.reason }] });
  const gate = { schemaConversion: selectedConv ? gateOf(selectedConv) : null, dataMovement: selectedData ? gateOf(selectedData) : null };

  const gaps = [];
  if (!selectedConv) {
    const prereqs = p.converter_prereqs === 'FOUNDRY_OR_COPILOT_MISSING' && v !== 'ORA_11G_OR_OLDER';
    gaps.push({
      id: 'SCHEMA_CONVERSION', ruleId: 'OP-SCOPE',
      text: prereqs
        ? `${conv.reason} This is a gap only until they exist: the prerequisite plan lists the lead times. Microsoft publishes no other schema converter for Oracle to PostgreSQL.`
        : `${conv.reason} Microsoft publishes no other schema converter for Oracle to PostgreSQL. Convert by hand to Microsoft's guidance, or with a partner chosen with the Microsoft account team; this advisor recommends no product. Upgrading the source to a release the converter lists is the other path.`,
    });
  }
  if (wantsOnline || downtimeUnknown) {
    gaps.push({
      id: 'ONLINE_CAPTURE', ruleId: 'OP-SCOPE',
      text: `${wantsOnline ? 'The downtime tolerance needs change data capture.' : 'If the downtime tolerance turns out to be short, the move needs change data capture.'} Microsoft offers no change-capture service from Oracle to PostgreSQL, so this needs a product from outside Microsoft. This advisor recommends none; the Microsoft account team can say what options exist. Whatever is chosen needs ARCHIVELOG mode with supplemental logging on the source, a private network path and a primary or unique key on every table. The Microsoft routes move rows offline, and their downtime is the full load time plus validation, which the rehearsal measures.`,
    });
  }
  selected.cutoverDowntime = wantsOnline ? 'minutes with change capture from outside Microsoft; without it, the full load time plus validation' : offlineOnly ? 'the full load time plus validation' : downtimeUnknown ? 'not stated' : 'minutes to a couple of hours, if the load fits';
  return { candidates, selected, gate, gaps };
}

function costLevers() {
  const out = [
    'Retiring Oracle licences and annual support: the saving depends on the customer\'s Oracle contract. Confirm with Oracle contract and licence management.',
    'Azure Hybrid Benefit does not apply to Azure Database for PostgreSQL, so there is no licence to bring.',
    'Reserved capacity (one or three years) covers compute only. Microsoft pages quote different maxima, so use the pricing calculator for the region and SKU.',
    'High availability doubles compute and storage cost. Use zone-redundant HA only where the availability target needs it.',
    'Burstable plus stop and start suits dev and test only. It is not for production and has no HA.',
    'Storage can only grow, never shrink. Premium SSD v2 sets capacity, IOPS and throughput separately.',
  ];
  out.push('Keeping Oracle on Azure virtual machines is the benchmark: two Azure vCPUs are one Oracle processor licence with multithreading on, with no core factor discount. Confirm with Oracle.');
  return out;
}

function programmeFit() {
  return [
    'Frontier Accelerate for Azure and for Databases (formerly Azure Accelerate): partner-nominated delivery funding and credits, advertised at 50% of year-one usage, subject to application and approval. A May 2026 Partner Center notice names Oracle to Azure PostgreSQL. Engage through the account team or a specialised partner.',
    'Cloud Accelerate Factory: zero-cost Microsoft delivery assistance alongside a partner. Oracle to PostgreSQL is not named. Nomination is required and the value is not guaranteed.',
    'FastTrack for Azure: free remote guidance for nominated projects above $5,000 a month. Database scope is not stated.',
  ];
}

// ---------------------------------------------------------------------------------------------
// Self-check: the invariants in reference/output-contract.md, section 3.
// ---------------------------------------------------------------------------------------------
const RETIRED_METHOD_IDS = new Set(['ADS_SQL_MIGRATION', 'ADS_ORACLE_ASSESSMENT', 'DMS_ORACLE_TO_PG', 'SSMA_ORACLE', 'ARC_POSTGRES', 'PGLOADER', 'PG_CHAMELEON', 'DMAO']);

export function selfCheck(out) {
  const v = [];
  const t = out.eligibilityTrace;
  const rec = out.recommendation;
  const OK = s => SURVIVES.has(s);
  if (rec && t[rec.target] && (t[rec.target].contributing || []).some(c => c.state === 'unsupported' || c.state === 'excluded_by_preference')) v.push([4, `${rec.target} is recommended against a limit its own trace records`]);
  if (rec && !OK(t[rec.target].state)) v.push([1, `primary ${rec.target} is ${t[rec.target].state}`]);
  if (out.alternative && !OK(t[out.alternative.target].state)) v.push([2, `alternative ${out.alternative.target} is ${t[out.alternative.target].state}`]);
  if (rec && out.selectedMethods) {
    for (const id of [out.selectedMethods.schemaConversion, out.selectedMethods.dataMovement]) {
      const c = out.methodCandidates.find(m => m.id === id);
      if (id && (!c || c.status === 'unavailable' || c.status === 'refused')) v.push([3, `selected method ${id} is not available`]);
    }
  }
  if (rec && PG_TARGETS.includes(rec.target) && rec.target === 'cosmos_pg') v.push([6, 'cosmos_pg recommended']);
  for (const k of [rec?.target, out.alternative?.target]) if (k && t[k].state === 'unsupported') v.push([6, `${k} is unsupported but named`]);
  if (!['provisional', 'shortlist'].includes(out.metadata.recommendationStatus)) v.push([9, 'status must be provisional or shortlist']);
  if (!['low', 'medium'].includes(out.metadata.confidence)) v.push([9, 'confidence must be low or medium']);
  for (const u of out.unknowns) if (!out.evidenceRequired.some(e => e.field === u.field)) v.push([5, `unknown ${u.field} missing from evidenceRequired`]);
  for (const id of TARGETS) if (!t[id]) v.push([11, `target ${id} missing from the Phase A trace`]);
  for (const id of TARGETS) if (t[id] && t[id].state === 'unsupported' && /prefer/i.test(t[id].reason) && !/cannot|refuse/i.test(t[id].reason)) v.push([12, `${id} unsupported for a preference`]);
  if (!out.normalizedProfile) v.push([13, 'normalizedProfile absent']);
  // 19: nothing from outside Microsoft is recommended (OP-SCOPE), and a null route is explained by a gap
  const { normalizedProfile: _p, ...card } = out;
  const outside = /\b(EDB|EPAS|Striim|Qlik|HVR|Fivetran|GoldenGate|Debezium|Ispirer|CYBERTEC|HexaRocket|pgloader|pg_chameleon|Ora2Pg)\b/i.exec(JSON.stringify(card));
  if (outside) v.push([19, `a product from outside Microsoft is named: ${outside[0]}`]);
  if (rec && PG_TARGETS.includes(rec.target) && out.selectedMethods) {
    const gaps = new Set((out.methodGaps || []).map(g => g.id));
    if (!out.selectedMethods.schemaConversion && !gaps.has('SCHEMA_CONVERSION')) v.push([19, 'no schema route and no gap that explains it']);
    if (!out.selectedMethods.dataMovement && !gaps.has('ONLINE_CAPTURE')) v.push([19, 'no data route and no gap that explains it']);
  }
  if (out.metadata.recommendationStatus === 'shortlist') {
    if (out.recommendation) v.push([16, 'shortlist must not carry a recommendation']);
    if (!out.shortlist || out.shortlist.length < 2) v.push([16, 'a shortlist names at least two families']);
  } else if (!out.recommendation) v.push([16, 'provisional status without a recommendation']);
  if (rec && PG_TARGETS.includes(rec.target)) {
    for (const id of ['MS_VSCODE_AI', 'ADF_COPY', 'DIFFERENTIAL_TESTING']) if (!out.methodCandidates.some(m => m.id === id)) v.push([14, `method ${id} never enumerated`]);
    for (const family of ['schemaConversion', 'dataMovement']) {
      const g = out.methodGateTrace?.[family];
      const sel = out.methodCandidates.find(m => m.id === out.selectedMethods?.[family]);
      if (g && sel) {
        const expect = sel.status === 'available' ? 'passed' : sel.status;
        if (g.result !== expect) v.push([15, `${family} gate ${g.result} disagrees with status ${sel.status}`]);
        if (g.result === 'passed' && g.gates.some(x => x.result === 'unknown_requires_assessment')) v.push([10, `a ${family} gate reports passed while a field it consumes is unknown`]);
      }
    }
  }
  const CONVERTERS = new Set(['MS_VSCODE_AI', 'APP_CONVERSION_PREVIEW']);
  for (const m of out.methodCandidates || []) {
    if (m.family === 'data' && CONVERTERS.has(m.id)) v.push([17, `${m.id} is a schema and code converter and is listed as moving rows`]);
    if (/^(?:AZURE_)?DMS(?:_|$)|^ADS_/.test(m.id) && m.status !== 'refused' && m.status !== 'unavailable') v.push([17, `${m.id} is presented as a Microsoft path for Oracle rows`]);
    if (RETIRED_METHOD_IDS.has(m.id) && m.status !== 'refused' && m.status !== 'unavailable') v.push([18, `${m.id} is on the retired list`]);
  }
  if (out.selectedMethods && CONVERTERS.has(out.selectedMethods.dataMovement)) v.push([17, `${out.selectedMethods.dataMovement} selected to move rows`]);
  if (out.selectedMethods && RETIRED_METHOD_IDS.has(out.selectedMethods.schemaConversion)) v.push([18, `${out.selectedMethods.schemaConversion} selected but retired`]);
  if (rec && rec.postgresMajor !== null && rec.postgresMajor <= 14) v.push([18, `PostgreSQL ${rec.postgresMajor} recommended as a new target`]);
  for (const id of TARGETS) if (t[id] && t[id].state === 'unsupported' && id !== 'cosmos_pg' && /APP_CONVERSION_PREVIEW|preview (?:app|conversion) tool/i.test(t[id].reason)) v.push([7, `${id} was removed because a preview method was refused`]);
  if ((out.costLevers || []).some(c => /\$\s?\d|\d+\s?%\s+saving/i.test(c) && !/5,000|35|50/.test(c))) v.push([8, 'a cost figure appears without measured sizing']);
  return v;
}
