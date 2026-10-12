#!/usr/bin/env node
// Ground-truth recall for the assessor.
//
//   node tools/calibrate/hard-case-recall.mjs <assessment.json> <design.md> [--out recall.json]
//
// The Contoso Store lab declares, for each of its 43 hard cases, which objects carry it (the "Where:" line
// of docs/design.md section 9). That is a ground truth the assessor did not write. For every declared
// object this checks that the assessor flagged at least one construct mapped to the same hard case.
//
// What it measures is recall: of the places the lab says a case lives, how many did the scan find. It
// says nothing about precision, and it only covers names it can resolve to an object.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function parseHardCases(md) {
  const cases = [];
  const sections = md.split(/\n(?=### H-\d+ ·)/);
  for (const sec of sections) {
    const head = /^### (H-\d+) · (.+)/.exec(sec);
    if (!head) continue;
    const where = /- \*\*Where:\*\*([\s\S]*?)(?=\n- \*\*(?:PostgreSQL|Prediction):\*\*)/.exec(sec);
    const prediction = /- \*\*Prediction:\*\* \*\*([^*]+)\*\*/.exec(sec);
    const tokens = where ? [...where[1].matchAll(/`([^`]+)`/g)].map(m => m[1]) : [];
    cases.push({ id: head[1], title: head[2].replace(/`/g, ''), tokens, prediction: prediction ? prediction[1].trim() : null });
  }
  return cases;
}

export function recall(assessment, catalog, cases) {
  const labOf = new Map(catalog.entries.map(e => [e.id, (e.labCase || '').split(',').map(s => s.trim()).filter(Boolean)]));
  const byName = new Map();
  for (const o of assessment.objects) {
    const k = o.name.toUpperCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(o);
  }
  const byLink = new Map();
  for (const o of assessment.objects) for (const l of o.links || []) {
    if (!byLink.has(l)) byLink.set(l, []);
    byLink.get(l).push(o);
  }
  const out = [];
  for (const c of cases) {
    const expected = new Map();
    const unresolved = [];
    for (const raw of c.tokens) {
      if (/NNN|\*|\s/.test(raw)) { unresolved.push(raw); continue; }
      const first = raw.split('.')[0].toUpperCase();
      const family = [...(byName.get(first) || []), ...(byLink.get(first) || [])];
      if (!family.length) { unresolved.push(raw); continue; }
      expected.set(first, family);
    }
    // A declared name is a family: the spec and body of a package, the table and its log, the view and the
    // trigger that attaches to it. The case is covered when any member of the family carries it.
    const covered = [];
    const missing = [];
    for (const [key, family] of expected) {
      const hit = family.some(o => o.hits.some(h => (labOf.get(h.id) || []).includes(c.id)));
      (hit ? covered : missing).push(key);
    }
    out.push({
      id: c.id, title: c.title, prediction: c.prediction,
      declaredObjects: expected.size, covered: covered.length, missing,
      unresolvedTokens: unresolved.length,
      recall: expected.size ? covered.length / expected.size : null,
      mapped: [...labOf.values()].some(l => l.includes(c.id)),
    });
  }
  const withObjects = out.filter(c => c.declaredObjects > 0);
  const totalDeclared = withObjects.reduce((a, c) => a + c.declaredObjects, 0);
  const totalCovered = withObjects.reduce((a, c) => a + c.covered, 0);
  return {
    schema: 'oracle-to-postgres-migration-advisor.hard-case-recall/v1',
    cases: out,
    summary: {
      hardCases: out.length,
      casesWithResolvableObjects: withObjects.length,
      casesFullyCovered: withObjects.filter(c => c.recall === 1).length,
      casesWithCatalogMapping: out.filter(c => c.mapped).length,
      declaredObjects: totalDeclared,
      coveredObjects: totalCovered,
      objectRecall: totalDeclared ? totalCovered / totalDeclared : null,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [assessmentPath, designPath, ...rest] = process.argv.slice(2);
  if (!assessmentPath || !designPath) { console.error('usage: hard-case-recall.mjs <assessment.json> <design.md> [--out FILE]'); process.exit(2); }
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'reference', 'compat-catalog.json'), 'utf8'));
  const result = recall(JSON.parse(fs.readFileSync(assessmentPath, 'utf8')), catalog, parseHardCases(fs.readFileSync(designPath, 'utf8')));
  const outIdx = rest.indexOf('--out');
  if (outIdx !== -1) { fs.writeFileSync(rest[outIdx + 1], JSON.stringify(result, null, 2) + '\n'); console.error(`wrote ${rest[outIdx + 1]}`); }
  const s = result.summary;
  console.log(`${s.hardCases} hard cases, ${s.casesWithCatalogMapping} mapped in the catalog, ${s.casesFullyCovered}/${s.casesWithResolvableObjects} fully covered; object recall ${s.coveredObjects}/${s.declaredObjects} = ${(s.objectRecall * 100).toFixed(1)}%`);
  for (const c of result.cases) {
    const r = c.recall === null ? 'n/a ' : `${c.covered}/${c.declaredObjects}`.padEnd(5);
    console.log(`  ${c.id.padEnd(5)} ${r} ${c.mapped ? ' ' : '!'} ${c.title.slice(0, 54).padEnd(54)} ${c.missing.length ? 'missing: ' + c.missing.slice(0, 4).join(', ') : ''}`);
  }
}
