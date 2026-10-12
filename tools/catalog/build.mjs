#!/usr/bin/env node
// Writes reference/compat-catalog.json from tools/catalog/catalog-source.mjs.
// `--check` exits non-zero when the checked-in JSON differs, so the two cannot drift.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG, GROUPS } from './catalog-source.mjs';
import { FEATURES, FEATURE_TARGETS } from './feature-matrix-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(root, 'reference', 'compat-catalog.json');
const outFeatures = path.join(root, 'reference', 'feature-matrix.json');

const ids = new Set();
for (const entry of CATALOG) {
  if (ids.has(entry.id)) throw new Error(`duplicate catalog id ${entry.id}`);
  ids.add(entry.id);
  if (entry.detect) new RegExp(entry.detect, entry.flags); // fail early on a bad pattern
  else if (!entry.metric) throw new Error(`${entry.id}: needs detect or metric`);
  if (!['CLEAN', 'PARTIAL', 'REVIEW', 'BLOCKER'].includes(entry.classification)) throw new Error(`${entry.id}: bad class`);
  if (!Array.isArray(entry.scope)) throw new Error(`${entry.id}: scope must be an array`);
}

const doc = {
  schema: 'oracle-to-postgres-migration-advisor.compat-catalog/v1',
  description: 'Oracle constructs the assessor looks for, with the PostgreSQL / Azure equivalent, a class, and a weight in Ora2Pg-style cost units (5 minutes each, 84 per person-day).',
  classes: {
    CLEAN: 'Mechanical. A converter handles it and a reviewer skims it.',
    PARTIAL: 'Converts, but behaviour or performance can drift in an edge case. A human checks each use.',
    REVIEW: 'A design decision or a hand rewrite on any PostgreSQL target.',
    BLOCKER: 'No supported equivalent on Azure Database for PostgreSQL flexible server. Needs a redesign, an external service, or a different target.',
  },
  groups: GROUPS,
  entries: CATALOG,
};
const text = JSON.stringify(doc, null, 2) + '\n';

const catalogIds = new Set(CATALOG.map(e => e.id));
for (const row of FEATURES) {
  for (const id of row.scanConstructs) if (!catalogIds.has(id)) throw new Error(`feature ${row.featureId} names unknown construct ${id}`);
  for (const t of FEATURE_TARGETS) if (!row.targets[t]) throw new Error(`feature ${row.featureId} has no cell for ${t}`);
}
const featureDoc = {
  schema: 'oracle-to-postgres-migration-advisor.feature-matrix/v1',
  description: 'How each PostgreSQL target carries each Oracle feature. native, workaround, redesign, unsupported, unknown. Oracle targets carry every feature and are not listed.',
  states: {
    native: 'The target carries it with the same behaviour.',
    workaround: 'Carried through an extension or a pattern, with caveats a person checks.',
    redesign: 'No equivalent. The application or the data model changes.',
    unsupported: 'The target cannot carry it at all, even with a redesign.',
    unknown: 'The vendor documentation does not say. Never read as native.',
  },
  targets: FEATURE_TARGETS,
  features: FEATURES,
};
const featureText = JSON.stringify(featureDoc, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  const currentFeatures = fs.existsSync(outFeatures) ? fs.readFileSync(outFeatures, 'utf8') : '';
  if (current !== text || currentFeatures !== featureText) {
    console.error('reference/compat-catalog.json or reference/feature-matrix.json is out of date. Run: node tools/catalog/build.mjs');
    process.exit(1);
  }
  console.log(`catalog in sync (${CATALOG.length} entries, ${FEATURES.length} features)`);
} else {
  fs.writeFileSync(out, text);
  fs.writeFileSync(outFeatures, featureText);
  console.log(`wrote ${path.relative(root, out)} (${CATALOG.length} entries) and ${path.relative(root, outFeatures)} (${FEATURES.length} features)`);
}
