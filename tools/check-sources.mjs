#!/usr/bin/env node
// Checks that every page in reference/sources.json still resolves, and that the register has been read recently.
//
//   node tools/check-sources.mjs [--max-age-days 45] [--concurrency 8] [--json report.json]
//
// Exit codes: 0 all pages resolve; 1 at least one page is gone (404, 410, DNS failure) or the register is stale.
// A 401, 403 or 429 is reported as "blocked", not as a failure: some vendors refuse automated clients, and a
// transient refusal should not fail a build. Blocked pages are listed so a person can open them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const maxAge = Number(opt('max-age-days', 45));
const concurrency = Number(opt('concurrency', 8));

const register = JSON.parse(fs.readFileSync(path.join(root, 'reference', 'sources.json'), 'utf8'));
const UA = 'Mozilla/5.0 (compatible; oracle-to-postgres-migration-advisor source check; +https://github.com/kloba/oracle-to-postgres-migration-advisor)';

async function probe(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20000);
      const res = await fetch(url, { method, redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA, accept: 'text/html,*/*' } });
      clearTimeout(timer);
      if (method === 'HEAD' && (res.status === 405 || res.status === 403 || res.status === 400)) continue;
      return { status: res.status, finalUrl: res.url };
    } catch (e) {
      if (method === 'GET') return { status: 0, error: String(e.cause?.code || e.name || e.message) };
    }
  }
  return { status: 0, error: 'unreachable' };
}

const results = [];
let next = 0;
async function worker() {
  while (next < register.sources.length) {
    const s = register.sources[next++];
    const r = await probe(s.url);
    results.push({ id: s.id, url: s.url, ...r });
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
results.sort((a, b) => a.id.localeCompare(b.id));

const gone = results.filter(r => r.status === 404 || r.status === 410 || (r.status === 0 && /ENOTFOUND/.test(r.error || '')));
const blocked = results.filter(r => [401, 403, 429].includes(r.status));
const flaky = results.filter(r => !gone.includes(r) && !blocked.includes(r) && (r.status === 0 || r.status >= 400));
const ok = results.length - gone.length - blocked.length - flaky.length;

const ageDays = Math.floor((Date.now() - Date.parse(register.checked)) / 86400000);
const stale = ageDays > maxAge;

console.log(`${results.length} sources: ${ok} resolve, ${blocked.length} blocked to automated clients, ${flaky.length} unreachable or erroring, ${gone.length} gone.`);
console.log(`Register last read ${register.checked} (${ageDays} days ago, limit ${maxAge})${stale ? ': STALE' : ''}.`);
for (const [label, list] of [['Gone', gone], ['Unreachable or erroring', flaky], ['Blocked (open by hand)', blocked]]) {
  if (!list.length) continue;
  console.log(`\n${label}:`);
  for (const r of list) console.log(`  ${r.id}  ${r.status || r.error}  ${r.url}`);
}
if (opt('json', null)) fs.writeFileSync(opt('json'), JSON.stringify({ checkedAt: new Date().toISOString(), register: register.checked, results }, null, 2));
process.exit(gone.length || stale ? 1 : 0);
