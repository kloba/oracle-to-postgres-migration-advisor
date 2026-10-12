#!/usr/bin/env node
// Build the prerequisite plan for an interview profile.
//
//   node tools/plan/cli.mjs profile.json [--scan assessment.json] [--name "Contoso Store"] [--out plan.md] [--json]

import fs from 'node:fs';
import { evaluate, selfCheck, profileFromAssessment } from '../advisor/engine.mjs';
import { buildPlan, renderPlan } from './build-plan.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const input = argv.find(a => !a.startsWith('--') && !['--scan', '--name', '--out'].includes(argv[argv.indexOf(a) - 1]));
if (!input) { console.error('usage: node tools/plan/cli.mjs profile.json [--scan assessment.json] [--name "Estate"] [--out plan.md] [--json]'); process.exit(1); }

let profile = JSON.parse(fs.readFileSync(input, 'utf8'));
const assessment = opt('scan') ? JSON.parse(fs.readFileSync(opt('scan'), 'utf8')) : null;
if (assessment) { const d = profileFromAssessment(assessment); profile = { ...profile, ...d, evidence: [...new Set([...(profile.evidence || []), ...d.evidence])] }; }
const out = evaluate(profile);
const v = selfCheck(out);
if (v.length) { console.error('The self-check failed:', JSON.stringify(v)); process.exit(2); }
const plan = buildPlan({ out, assessment });
const text = argv.includes('--json') ? JSON.stringify(plan, null, 2) + '\n' : renderPlan(plan, { name: opt('name', 'Oracle estate') });
if (opt('out')) fs.writeFileSync(opt('out'), text); else process.stdout.write(text);
