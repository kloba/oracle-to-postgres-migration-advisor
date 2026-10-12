// Reads the enumerations out of reference/input-contract.md, so the schema and the tests follow the document.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIELDS, FEATURE_MATRIX } from '../advisor/engine.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function contractEnums() {
  const md = fs.readFileSync(path.join(root, 'reference', 'input-contract.md'), 'utf8');
  const enums = {};
  for (const line of md.split('\n')) {
    const m = /^\| `([a-z_]+)` \| (.+?) \| (.*) \|\s*$/.exec(line);
    if (!m || !FIELDS.includes(m[1])) continue;
    const ids = [...m[2].matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map(x => x[1]);
    if (ids.length >= 2) enums[m[1]] = ids;
  }
  return enums;
}

export const featureIds = () => FEATURE_MATRIX.features.map(f => f.featureId);
