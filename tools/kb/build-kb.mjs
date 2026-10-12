#!/usr/bin/env node
// Fills the generated blocks in the knowledge base from the JSON the rules and the assessor use, so a table in
// the document cannot disagree with the data behind it.
//
//   node tools/kb/build-kb.mjs [--check]
//
// A block looks like:   <!-- GENERATED:name -->  ...  <!-- /GENERATED -->
// Everything between the markers is replaced. --check fails when the document differs from what would be written.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const DOC = path.join(root, 'docs', 'oracle-to-azure-postgresql-migration.md');

const rules = readJson('reference/decision-rules.data.json');
const matrix = readJson('reference/feature-matrix.json');
const catalog = readJson('reference/compat-catalog.json');
const sources = readJson('reference/sources.json');
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const n = v => (typeof v === 'number' ? v.toLocaleString('en-US') : v);

const TARGET_COLS = [['pg_flex', 'Flexible server'], ['pg_elastic', 'Elastic cluster'], ['horizondb', 'HorizonDB'], ['pg_vm', 'PostgreSQL on VMs'], ['pg_aks', 'PostgreSQL on AKS']];

const generators = {
  'feature-matrix'() {
    const rows = matrix.features.map(f => `| ${cell(f.label)} | ${TARGET_COLS.map(([t]) => f.targets[t].state).join(' | ')} |`);
    let sourced = 0, total = 0;
    for (const f of matrix.features) for (const [t] of TARGET_COLS) { total++; if (f.targets[t].sources.length) sourced++; }
    return [
      `| Oracle feature | ${TARGET_COLS.map(([, l]) => l).join(' | ')} |`,
      `|---|${TARGET_COLS.map(() => '---').join('|')}|`,
      ...rows,
      '',
      `*native* the target carries it with the same behaviour. *workaround* an extension or pattern carries it and a person checks the caveats. *redesign* no equivalent: the application or the data model changes. *unsupported* the target cannot carry it at all. *unknown* the vendor documentation does not say, and it is never read as native. ${sourced} of ${total} verdicts cite a source; the rest are the author's judgement and say so in \`reference/feature-matrix.json\`.`,
    ].join('\n');
  },

  'catalog-summary'() {
    const cats = [...new Set(catalog.entries.map(e => e.category))];
    const classes = ['CLEAN', 'PARTIAL', 'REVIEW', 'BLOCKER'];
    const count = (c, k) => catalog.entries.filter(e => e.category === c && e.classification === k).length;
    const rows = cats.map(c => `| ${c} | ${classes.map(k => count(c, k)).join(' | ')} | ${catalog.entries.filter(e => e.category === c).length} |`);
    const tot = classes.map(k => catalog.entries.filter(e => e.classification === k).length);
    const ora = catalog.entries.filter(e => e.weightOrigin.startsWith('ora2pg')).length;
    return [
      `| Category | ${classes.join(' | ')} | Total |`,
      `|---|${classes.map(() => '---').join('|')}|---|`,
      ...rows,
      `| **All** | ${tot.map(x => `**${x}**`).join(' | ')} | **${catalog.entries.length}** |`,
      '',
      `${ora} of ${catalog.entries.length} weights are Ora2Pg 25.0's own; the others are this project's, marked \`advisor\`. A weight is in cost units: one unit is five minutes and 84 units are a person-day.`,
    ].join('\n');
  },

  'catalog-blockers'() {
    const rows = catalog.entries.filter(e => e.classification === 'BLOCKER').map(e => `| \`${e.id}\` | ${cell(e.name)} | ${cell(e.postgres)} |`);
    return ['| ID | Construct | What to do instead |', '|---|---|---|', ...rows].join('\n');
  },

  limits() {
    const fs_ = rules.flexibleServer, hz = rules.horizonDb, ec = rules.elasticClusters;
    const rows = [
      ['Status', 'Generally available', ec.status, hz.status],
      ['PostgreSQL majors', `${[...fs_.supportedMajors.acceptable, ...fs_.supportedMajors.recommended].sort().join(', ')} (16 to 18 recommended; 14 is avoided)`, ec.postgresMajors.join(', '), hz.postgresMajors.join(', ')],
      ['Largest storage', `${fs_.storageTiB.premiumSsd} TiB on Premium SSD; ${fs_.storageTiB.premiumSsdV2} TiB on Premium SSD v2`, 'per node; storage does not autogrow', `${hz.maxStorageTB} TB`],
      ['Peak IOPS', `${n(fs_.maxIops.premiumSsd)} (Premium SSD); ${n(fs_.maxIops.premiumSsdV2)} (Premium SSD v2)`, 'not stated here', 'not published'],
      ['Peak throughput', `${fs_.maxMibPerSecond.premiumSsd} MiB/s; ${n(fs_.maxMibPerSecond.premiumSsdV2)} MiB/s`, 'not stated here', 'not published'],
      ['Compute', `up to ${fs_.vcores.generallyAvailableMax} vCores GA; ${fs_.vcores.v6PreviewMax} on V6 (preview)`, `scale out, up to ${ec.maxNodesSelfService} nodes self-service`, `up to ${hz.maxVcoresPerReplica} vCores per replica`],
      ['Memory', `up to ${n(fs_.ramGiB.generallyAvailableMax)} GiB GA; ${n(fs_.ramGiB.v6PreviewMax)} GiB on V6`, 'per node', 'not published'],
      ['Read replicas', `${fs_.readReplicas.direct} direct, ${fs_.readReplicas.cascadingTotal} with cascading`, 'one', `up to ${hz.maxReplicas}`],
      ['Availability SLA', `${fs_.sla.zoneRedundantHa}% zone-redundant HA; ${fs_.sla.sameZoneHa}% same-zone HA; ${fs_.sla.noHa}% without HA`, 'per-node HA', 'none published'],
      ['Backup', `point-in-time restore ${fs_.backup.pitrDaysMin} to ${fs_.backup.pitrDaysMax} days; long-term retention up to ${fs_.backup.longTermRetentionYears} years for databases up to ${fs_.backup.longTermRetentionMaxDbTiB} TiB`, 'see Microsoft documentation', `fixed ${hz.backupRetentionDaysFixed} days`],
      ['Default maximum connections', `${n(fs_.maxConnectionsDefaultFrom16Vcores)} from 16 vCores`, 'not stated here', 'not published'],
      ['Not supported', fs_.pssdV2Limits.join('; ') + ' (Premium SSD v2)', ec.limits.join('; '), hz.notSupportedInPreview.join('; ')],
    ].map(r => `| ${r.map(cell).join(' | ')} |`);
    const ends = Object.entries(fs_.standardSupportEnds).map(([v, d]) => `PostgreSQL ${v}: ${d}`).join('; ');
    return [
      '| | Flexible server | Elastic cluster | HorizonDB |', '|---|---|---|---|', ...rows,
      '', `Flexible server standard support ends: ${ends}. HorizonDB regions in the preview: ${hz.regions.join(', ')}.`,
    ].join('\n');
  },

  retired() {
    return ['| Do not recommend | Use instead, or why not |', '|---|---|', ...rules.retired.map(r => `| ${cell(r.item)} | ${cell(r.use)} |`)].join('\n');
  },

  'rule-index'() {
    const md = fs.readFileSync(path.join(root, 'reference', 'decision-rules.md'), 'utf8');
    const rows = [...md.matchAll(/^\| `(OP-[A-Z0-9-]+)` \| ([A-D]) \| (.+?) \|$/gm)].map(m => `| \`${m[1]}\` | ${m[2]} | ${m[3]} |`);
    return ['| Rule | Step | One line |', '|---|---|---|', ...rows].join('\n');
  },

  sources() {
    const group = u => /learn\.microsoft\.com|techcommunity\.microsoft|azure\.microsoft|download\.microsoft|github\.com\/microsoft|microsoft\.com/.test(u) ? 'Microsoft' : /oracle\.com/.test(u) ? 'Oracle' : 'Open source and others';
    const out = [];
    for (const g of ['Microsoft', 'Oracle', 'Open source and others']) {
      const list = sources.sources.filter(s => group(s.url) === g);
      if (!list.length) continue;
      out.push(`#### ${g} (${list.length})`, '', ...list.map(s => `- [${s.title}](${s.url})`), '');
    }
    return `Read on ${sources.checked}.\n\n${out.join('\n').trim()}`;
  },
};

const text = fs.existsSync(DOC) ? fs.readFileSync(DOC, 'utf8') : null;
if (text === null) { console.error(`${path.relative(root, DOC)} does not exist`); process.exit(1); }

let missing = [];
const re = /<!-- GENERATED:([a-z-]+) -->[\s\S]*?<!-- \/GENERATED -->/g;
const next = text.replace(re, (all, name) => {
  if (!generators[name]) { missing.push(name); return all; }
  return `<!-- GENERATED:${name} -->\n${generators[name]()}\n<!-- /GENERATED -->`;
});
if (missing.length) { console.error(`unknown generated block(s): ${missing.join(', ')}`); process.exit(1); }

if (process.argv.includes('--check')) {
  if (next !== text) { console.error('The knowledge base is out of date with its data: run node tools/kb/build-kb.mjs'); process.exit(1); }
  console.log(`knowledge base in sync (${(text.match(re) || []).length} generated blocks)`);
} else {
  fs.writeFileSync(DOC, next);
  console.log(`updated ${(text.match(re) || []).length} generated blocks in ${path.relative(root, DOC)}`);
}
