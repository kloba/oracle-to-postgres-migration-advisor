#!/usr/bin/env node
// Generates schemas/input.schema.json from the enumerations in reference/input-contract.md and the feature matrix.
// `--check` fails when the committed file differs, so the contract and the schema cannot drift.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIELDS } from '../advisor/engine.mjs';
import { contractEnums, featureIds } from './contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const enums = contractEnums();
const properties = {};
for (const f of FIELDS) {
  if (f === 'evidence') properties[f] = { type: 'array', items: { enum: enums.evidence }, description: 'Artefacts already in hand. A claim to verify elsewhere, never proof.' };
  else if (f === 'oracle_features') properties[f] = { type: 'array', items: { enum: featureIds() }, description: 'Read only when feature_dependencies is LIST_FEATURES.' };
  else if (f === 'region') properties[f] = { type: 'string', description: 'An Azure region name such as swedencentral, or NOT_SURE.' };
  else properties[f] = { enum: [...new Set([...enums[f], 'UNKNOWN'])] };
}
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/kloba/oracle-to-postgres-migration-advisor/schemas/input.schema.json',
  title: 'Oracle to PostgreSQL advisor: interview profile',
  description: 'Generated from reference/input-contract.md. Every field is optional; an absent field is UNKNOWN and is never read as "none".',
  type: 'object',
  properties,
  additionalProperties: false,
};
const text = JSON.stringify(schema, null, 2) + '\n';
const file = path.join(root, 'schemas', 'input.schema.json');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error('schemas/input.schema.json is out of date: run node tools/schema/build-schemas.mjs'); process.exit(1); }
  console.log('input schema in sync');
} else {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`wrote ${path.relative(root, file)} (${FIELDS.length} fields)`);
}
