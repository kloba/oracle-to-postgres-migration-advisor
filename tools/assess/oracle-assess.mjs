#!/usr/bin/env node
// Static Oracle schema assessment.
//
//   node tools/assess/oracle-assess.mjs <file-or-dir>... [--name "Contoso Store"] [--schema CONTOSO]
//                                       [--out out/assessment.json] [--summary]
//
// Reads .sql, .pls, .pks, .pkb, .plb, .tps, .tpb, .trg, .vw and .ddl files. Writes the JSON assessment
// the report builder consumes and, with --summary, prints a short text summary.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiAssistedEstimate } from './lib/ai-effort.mjs';
import { analyse } from './lib/analyze.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = new Set(['.sql', '.pls', '.pks', '.pkb', '.plb', '.tps', '.tpb', '.trg', '.vw', '.ddl', '.prc', '.fnc']);

function parseArgs(argv) {
  const args = { inputs: [], name: null, schema: null, out: null, summary: false, catalog: path.join(root, 'reference', 'compat-catalog.json') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') args.name = argv[++i];
    else if (a === '--schema') args.schema = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--catalog') args.catalog = argv[++i];
    else if (a === '--summary') args.summary = true;
    else if (a === '-h' || a === '--help') { args.help = true; }
    else args.inputs.push(a);
  }
  return args;
}

function collect(input) {
  const stat = fs.statSync(input);
  if (stat.isFile()) return [input];
  const out = [];
  for (const entry of fs.readdirSync(input, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(input, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.inputs.length) {
  console.log('usage: oracle-assess.mjs <file-or-dir>... [--name NAME] [--schema OWNER] [--out FILE] [--summary]');
  process.exit(args.help ? 0 : 2);
}

const files = args.inputs.flatMap(collect);
if (!files.length) {
  console.error('no Oracle source files found');
  process.exit(2);
}
const catalog = JSON.parse(fs.readFileSync(args.catalog, 'utf8'));
const sources = files.map(f => ({ path: path.relative(process.cwd(), f), content: fs.readFileSync(f, 'utf8') }));
const result = analyse(sources, { catalog, name: args.name, schema: args.schema });

if (args.out) {
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(result, null, 2) + '\n');
  console.error(`wrote ${args.out}`);
}
if (args.summary || !args.out) {
  const t = result.totals;
  console.log(`${result.name}: ${t.objects} objects, ${t.loc} lines of code (${t.plsqlLoc} PL/SQL)`);
  console.log(`Ora2Pg-style level ${t.level}, ${t.units} units, about ${t.personDaysOra2PgStyle} person-days at ${result.scoring.unitMinutes} min/unit`);
  const ai = aiAssistedEstimate(result, { converter: 'available' });
  if (ai.available) console.log(`With the AI-assisted converter doing the first pass: about ${ai.days.ai.low} to ${ai.days.ai.high} person-days (a model with assumed rates; the report builder uses a measured run when you supply one)`);
  console.log(`Classes: ${Object.entries(result.byClass).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log('Top constructs by effort:');
  for (const c of result.constructs.filter(c => c.affectsClass).slice(0, 12)) {
    console.log(`  ${c.id.padEnd(28)} ${String(c.objects).padStart(4)} objects ${String(c.hits).padStart(5)} hits ${String(Math.round(c.units)).padStart(5)} units  ${c.classification}`);
  }
  if (result.blockers.length) console.log(`Blockers: ${result.blockers.map(b => b.id).join(', ')}`);
}
