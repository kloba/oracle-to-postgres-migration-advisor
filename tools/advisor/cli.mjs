#!/usr/bin/env node
// Evaluate an interview profile and print the recommendation card.
//
//   node tools/advisor/cli.mjs profile.json [--scan assessment.json] [--name "Contoso Store"] [--json] [--out card.md]
//
// With --scan, the PL/SQL volume and the Oracle features come from the schema scan and win over the stated
// profile, as in the report builder. The self-check runs before anything is shown. When an invariant fails the
// card is not printed: the failure is, with the invariant number, and the exit code is 2.

import fs from 'node:fs';
import { evaluate, selfCheck, profileFromAssessment } from './engine.mjs';
import { renderCard } from './render-card.mjs';

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const input = argv.find((a, i) => !a.startsWith('--') && (i === 0 || !argv[i - 1].startsWith('--') || ['--json'].includes(argv[i - 1])));

if (!input || flag('help')) {
  console.error('usage: node tools/advisor/cli.mjs profile.json [--scan assessment.json] [--name "Estate name"] [--json] [--out file]');
  process.exit(input ? 0 : 1);
}

let profile = JSON.parse(fs.readFileSync(input, 'utf8'));
if (opt('scan')) {
  const derived = profileFromAssessment(JSON.parse(fs.readFileSync(opt('scan'), 'utf8')));
  profile = { ...profile, ...derived, evidence: [...new Set([...(profile.evidence || []), ...derived.evidence])] };
}

const out = evaluate(profile);
const violations = selfCheck(out);
if (violations.length) {
  console.error('The self-check failed, so no card is shown. Invariants broken:');
  for (const [n, why] of violations) console.error(`  ${n}: ${why}`);
  process.exit(2);
}

out.metadata.evaluatedAt = new Date().toISOString();
const text = flag('json') ? JSON.stringify(out, null, 2) + '\n' : renderCard(out, { name: opt('name', 'Oracle estate'), evaluatedAt: out.metadata.evaluatedAt.slice(0, 16) + 'Z' });
if (opt('out')) fs.writeFileSync(opt('out'), text);
else process.stdout.write(text);
