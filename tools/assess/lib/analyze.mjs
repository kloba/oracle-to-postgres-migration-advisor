// The assessor: turns Oracle source files into an inventory, a per-object classification and an
// effort estimate in Ora2Pg-compatible cost units.
//
// What this is, and is not. It reads source text. It never connects to a database, so it cannot see
// row counts, runtime behaviour, dynamic SQL built from data, or objects that exist only in the
// catalog. A scan finds what the text contains; the report states the limits (see LIMITATIONS).
//
// Scoring follows Ora2Pg 25.0 (lib/Ora2Pg/PLSQL.pm and lib/Ora2Pg.pm), reimplemented:
//   routine cost  = object score + TEST (2) + SIZE (chars / 1000, at least 1) + sum of construct scores
//   view cost     = object score + sum of construct scores
//   1 unit        = 5 minutes;  84 units = one person-day (7 hours)
// Constructs Ora2Pg does not score carry an `advisor` weight in the catalog and are marked as such.

import { parseSource } from './split.mjs';
import { codeLines } from './mask.mjs';

export const UNIT_MINUTES = 5;
export const UNITS_PER_DAY = 84;

// lib/Ora2Pg/PLSQL.pm %OBJECT_SCORE. DATABASE_LINK is 0 here because the catalog entry carries the 3.
export const OBJECT_SCORE = {
  TABLE: 0.1, INDEX: 0.1, SEQUENCE: 0.1, SYNONYM: 0.1, VIEW: 1, MATERIALIZED_VIEW: 3, TYPE: 1, TYPE_BODY: 10,
  FUNCTION: 1, PROCEDURE: 1, TRIGGER: 1, PACKAGE_BODY: 3, JOB: 2, PROGRAM: 1, SCHEDULE: 1, CHAIN: 2, JOB_CLASS: 1, WINDOW: 1,
  LEGACY_JOB: 2, DATABASE_LINK: 0,
};
// %MAX_SCORE: the most a single object type may add to the total, in units.
export const MAX_SCORE = { INDEX: 288, SEQUENCE: 288, TABLE: 672, SYNONYM: 192 };
const TEST_SCORE = 2;
const SIZE_DIVISOR = 1000;
const ROUTINE_TYPES = new Set(['FUNCTION', 'PROCEDURE', 'TRIGGER', 'PACKAGE_BODY', 'TYPE_BODY']);

const CLASS_RANK = { CLEAN: 0, PARTIAL: 1, REVIEW: 2, BLOCKER: 3 };
const RANK_CLASS = ['CLEAN', 'PARTIAL', 'REVIEW', 'BLOCKER'];

export const LIMITATIONS = [
  'Static analysis reads source text only. It does not connect to Oracle, so it cannot see row counts, data volumes, runtime behaviour, workload, or objects that exist only in the data dictionary.',
  'SQL built at run time from data (for example concatenated identifiers inside EXECUTE IMMEDIATE) is invisible. Dynamic DDL in installer blocks is found; dynamic DML in routines is not analysed.',
  'The cost units are Ora2Pg\'s convention reimplemented here. They estimate reading and rewriting time. They do not include data movement, performance tuning, application changes, testing at scale, or cutover.',
  'A construct is counted where its text appears. It is not proof that the construct runs, and absence of a construct is not proof the code is safe.',
  'Effort bands are a heuristic range, not a quote. Calibrate them against a pilot of 10 to 15 objects converted and reviewed by the team that will do the work.',
];

/** Compile catalog entries once: regexes, scope sets and the metric table. */
export function compileCatalog(catalog) {
  return catalog.entries.map(entry => ({
    ...entry,
    re: entry.detect ? new RegExp(entry.detect, entry.flags.includes('g') ? entry.flags : entry.flags + 'g') : null,
    scopeSet: new Set(entry.scope),
  }));
}

function compactChars(code) {
  let n = 0;
  for (const line of code.split('\n')) {
    const t = line.replace(/\s+$/, '');
    if (t !== '') n += t.length + 1;
  }
  return n;
}

function lineAt(src, idx, startLine) {
  let nl = 0;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) nl++;
  return startLine + nl;
}

const HEADER_RE = /^([ \t]*)(?:(?:MEMBER|STATIC|CONSTRUCTOR|FINAL|OVERRIDING|INSTANTIABLE)\s+|(?:MAP|ORDER)\s+MEMBER\s+)*(PROCEDURE|FUNCTION)\s+("[^"]+"|[A-Za-z_][\w$#]*)/gim;

/**
 * Members of a package body or type body: the subprograms that have an implementation. A forward
 * declaration ends at `;` before any IS/AS, and nested subprograms sit deeper than the members, so the
 * members are the implemented headers at the shallowest indentation.
 */
export function scanMembers(code) {
  const heads = [];
  HEADER_RE.lastIndex = 0;
  let m;
  while ((m = HEADER_RE.exec(code)) !== null) {
    const tail = code.slice(m.index, m.index + 3000);
    const implemented = /^[^;]*?\b(?:IS|AS)\b/i.test(tail);
    heads.push({
      index: m.index,
      indent: m[1].replace(/\t/g, '    ').length,
      kind: m[2].toUpperCase(),
      name: m[3].replace(/"/g, '').toUpperCase(),
      implemented,
    });
  }
  const impl = heads.filter(h => h.implemented);
  if (!impl.length) return { members: [], declared: heads.length };
  const minIndent = Math.min(...impl.map(h => h.indent));
  const top = impl.filter(h => h.indent === minIndent);
  const members = top.map((h, i) => {
    const end = i + 1 < top.length ? top[i + 1].index : code.length;
    return { name: h.name, kind: h.kind, start: h.index, end, code: code.slice(h.index, end) };
  });
  return { members, declared: heads.length - impl.length };
}

/**
 * Package-level variables: the objects that carry session state in Oracle and have no home in
 * PostgreSQL. Constants are counted separately; they hold no state but still need somewhere to live.
 */
export function packageState(obj) {
  const code = obj.code;
  const head = /\b(?:IS|AS)\b/i.exec(code);
  if (!head) return { variables: [], constants: [] };
  let region = code.slice(head.index + head[0].length);
  if (obj.type === 'PACKAGE_BODY') {
    const first = scanMembers(region).members[0];
    if (first) region = region.slice(0, first.start);
  }
  const variables = [];
  const constants = [];
  let depth = 0;
  let stmt = '';
  const SKIP = /^(?:PROCEDURE|FUNCTION|TYPE|SUBTYPE|CURSOR|PRAGMA|END|BEGIN|EXCEPTION|PACKAGE|IS|AS)\b/i;
  const flush = () => {
    const s = stmt.trim();
    stmt = '';
    if (!s || SKIP.test(s)) return;
    const m = /^([A-Za-z_][\w$#]*)\s+(CONSTANT\s+)?([A-Za-z_][\w$#.]*(?:%\s*(?:ROWTYPE|TYPE))?)/i.exec(s);
    if (!m) return;
    // An exception is a name, not a value: it holds no state.
    if (/^EXCEPTION$/i.test(m[3])) return;
    (m[2] ? constants : variables).push(m[1].toUpperCase());
  };
  let inDecl = false;
  for (const line of region.split('\n')) {
    if (depth === 0 && /^\s*(?:PROCEDURE|FUNCTION|TYPE|SUBTYPE|CURSOR|PRAGMA)\b/i.test(line)) inDecl = true;
    for (const ch of line) {
      if (ch === '(') depth++;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ';' && depth === 0) {
        if (!inDecl) { flush(); }
        stmt = '';
        inDecl = false;
        continue;
      }
      if (!inDecl) stmt += ch;
    }
    stmt += ' ';
  }
  return { variables, constants };
}

const STRING_TYPES = '(?:VARCHAR2|VARCHAR|NVARCHAR2|CHAR|NCHAR|CLOB|NCLOB|LONG)';

/** Names declared as string parameters or variables in a routine. */
function stringNames(code) {
  const names = new Set();
  const re = new RegExp(`\\b([A-Za-z_][\\w$#]*)\\s+(?:IN\\s+OUT\\s+|IN\\s+|OUT\\s+)?(?:NOCOPY\\s+)?${STRING_TYPES}\\b`, 'gi');
  let m;
  while ((m = re.exec(code)) !== null) names.add(m[1].toUpperCase());
  return names;
}

const METRICS = {
  packageState(obj) {
    const { variables } = packageState(obj);
    return variables.length ? { count: variables.length, detail: variables.slice(0, 8) } : null;
  },
  // Routine names that appear more than once in one package or type body.
  overloads(obj) {
    const { members } = scanMembers(obj.code);
    const seen = new Map();
    for (const m of members) seen.set(m.name, (seen.get(m.name) || 0) + 1);
    const names = [...seen].filter(([, n]) => n > 1).map(([name, n]) => `${name}(${n})`);
    return names.length ? { count: names.length, detail: names.slice(0, 8) } : null;
  },
  // A column or attribute typed with a VARRAY or an object type. The construct is in the type, not in the table.
  usesVarray(obj, ctx) { return usesType(obj, ctx.varray); },
  usesObjectType(obj, ctx) { return usesType(obj, ctx.object); },
  // `x IS NULL` on a string. Oracle stores '' as NULL, so the test also catches the empty string. In PostgreSQL it does not.
  stringNullTests(obj) {
    const names = stringNames(obj.code);
    let count = 0;
    for (const n of names) {
      const re = new RegExp(`(?<![\\w.$#])${n}\\s+IS\\s+(?:NOT\\s+)?NULL\\b`, 'gi');
      count += (obj.code.match(re) || []).length;
    }
    return count ? { count, detail: [...names].slice(0, 6) } : null;
  },
};

function usesType(obj, names) {
  if (!names || !names.size) return null;
  const used = [];
  for (const n of names) if (n !== String(obj.name).toUpperCase() && new RegExp(`(?<![\\w$#])${n}(?![\\w$#])`, 'i').test(obj.code)) used.push(n);
  return used.length ? { count: used.length, detail: used.slice(0, 6) } : null;
}

function typeContext(objects) {
  const ctx = { varray: new Set(), nested: new Set(), object: new Set() };
  for (const o of objects) {
    if (o.type !== 'TYPE') continue;
    if (/\b(?:AS|IS)\s+VARRAY\b|\bVARYING\s+ARRAY\b/i.test(o.code)) ctx.varray.add(o.name);
    else if (/\b(?:AS|IS)\s+TABLE\s+OF\b/i.test(o.code)) ctx.nested.add(o.name);
    else if (/\b(?:AS|IS)\s+OBJECT\b/i.test(o.code)) ctx.object.add(o.name);
  }
  return ctx;
}

function detect(obj, compiled, ctx = {}) {
  const hits = [];
  for (const entry of compiled) {
    if (!entry.scopeSet.has(obj.type)) continue;
    if (entry.metric) {
      const r = METRICS[entry.metric](obj, ctx);
      if (r) hits.push({ id: entry.id, count: r.count, lines: [obj.startLine], detail: r.detail });
      continue;
    }
    const src = obj[entry.view] ?? obj.code;
    entry.re.lastIndex = 0;
    let count = 0;
    const lines = [];
    let m;
    while ((m = entry.re.exec(src)) !== null) {
      if (m[0].length === 0) { entry.re.lastIndex++; continue; }
      count++;
      if (lines.length < 3) lines.push(lineAt(src, m.index, obj.startLine));
    }
    if (count) hits.push({ id: entry.id, count, lines });
  }
  return hits;
}

function worst(hits, byId) {
  let rank = 0;
  for (const h of hits) {
    const e = byId.get(h.id);
    if (!e.affectsClass || e.weight <= 0) continue;
    rank = Math.max(rank, CLASS_RANK[e.classification]);
  }
  return RANK_CLASS[rank];
}

function constructUnits(hits, byId) {
  let u = 0;
  for (const h of hits) { const e = byId.get(h.id); u += e.weight * (e.once ? 1 : h.count); }
  return u;
}

/** The construct units of one object by class: CLEAN and PARTIAL a converter can rewrite, REVIEW needs a person's decision, BLOCKER has no supported equivalent. */
function constructSplit(hits, byId) {
  const u = { addressable: 0, review: 0, blocker: 0 };
  for (const h of hits) {
    const e = byId.get(h.id);
    const v = e.weight * (e.once ? 1 : h.count);
    if (e.classification === 'BLOCKER') u.blocker += v;
    else if (e.classification === 'REVIEW') u.review += v;
    else u.addressable += v;
  }
  return u;
}

function analyseObject(obj, compiled, byId, ctx) {
  const loc = codeLines(obj.code);
  const chars = compactChars(obj.code);
  const hits = detect(obj, compiled, ctx);
  const out = {
    type: obj.type,
    name: obj.name,
    owner: obj.owner,
    file: obj.file,
    line: obj.startLine,
    loc,
    chars,
    links: obj.links || [],
    dynamic: Boolean(obj.dynamic),
    unterminated: Boolean(obj.flags && obj.flags.unterminated),
    hits,
  };

  let units = OBJECT_SCORE[obj.type] ?? 0;
  const constructs = constructUnits(hits, byId);
  const split = constructSplit(hits, byId);
  // base + size are reading and rewriting; test is the per-routine test allowance; constructs split by class (CLEAN and PARTIAL, REVIEW, BLOCKER). They sum to `units`.
  const parts = { base: units, test: 0, size: 0, constructsAddressable: split.addressable, constructsReview: split.review, constructsBlocker: split.blocker };

  if (obj.type === 'PACKAGE_BODY' || obj.type === 'TYPE_BODY') {
    const { members, declared } = scanMembers(obj.code);
    out.members = members.length;
    out.declared = declared;
    if (members.length) {
      const memberRows = members.map(mem => {
        const mHits = detect({ ...obj, type: 'PROCEDURE', code: mem.code, text: mem.code, raw: mem.code }, compiled)
          .filter(h => !byId.get(h.id).metric);
        const mChars = compactChars(mem.code);
        const mUnits = OBJECT_SCORE.FUNCTION + TEST_SCORE + Math.max(1, Math.floor(mChars / SIZE_DIVISOR)) + constructUnits(mHits, byId);
        return { name: mem.name, kind: mem.kind, loc: codeLines(mem.code), chars: mChars, units: round(mUnits), hits: mHits.map(h => h.id) };
      });
      out.memberRows = memberRows;
      units += members.reduce((a, _, i) => a + OBJECT_SCORE.FUNCTION + TEST_SCORE + Math.max(1, Math.floor(memberRows[i].chars / SIZE_DIVISOR)), 0);
      parts.base += members.length * OBJECT_SCORE.FUNCTION;
      parts.test += members.length * TEST_SCORE;
      parts.size += memberRows.reduce((a, m) => a + Math.max(1, Math.floor(m.chars / SIZE_DIVISOR)), 0);
    } else {
      units += TEST_SCORE + Math.max(1, Math.floor(chars / SIZE_DIVISOR));
      parts.test += TEST_SCORE;
      parts.size += Math.max(1, Math.floor(chars / SIZE_DIVISOR));
    }
    units += constructs;
  } else if (ROUTINE_TYPES.has(obj.type)) {
    units += TEST_SCORE + Math.max(1, Math.floor(chars / SIZE_DIVISOR)) + constructs;
    parts.test += TEST_SCORE;
    parts.size += Math.max(1, Math.floor(chars / SIZE_DIVISOR));
  } else {
    units += constructs;
  }

  out.units = round(units);
  out.unitParts = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round(v)]));
  out.class = worst(hits, byId);
  out.keywords = hits.some(h => {
    const e = byId.get(h.id);
    return e.weightOrigin.startsWith('ora2pg') && e.weight > 0;
  });
  return out;
}

const round = n => Math.round(n * 100) / 100;

/** Ora2Pg's difficulty_assessment, reproduced so the level reads the same as an `ora2pg --estimate_cost` report. */
export function migrationLevel(objects, totalUnits, humanDaysLimit = 5) {
  const has = types => objects.some(o => types.includes(o.type));
  const withKeywords = types => objects.some(o => types.includes(o.type) && o.keywords);
  let difficulty = 1;
  if (has(['FUNCTION', 'PACKAGE_BODY', 'PROCEDURE'])) difficulty = 3;
  if (difficulty < 3 && has(['TRIGGER'])) difficulty += 1;
  if (difficulty < 3 && withKeywords(['TRIGGER'])) difficulty = 4;
  if (difficulty <= 3 && withKeywords(['VIEW', 'MATERIALIZED_VIEW'])) difficulty = 4;
  if (difficulty >= 3 && withKeywords(['FUNCTION', 'PROCEDURE', 'PACKAGE_BODY'])) difficulty = 5;
  const days = Math.ceil(totalUnits / UNITS_PER_DAY);
  let level = 'A';
  if (difficulty > 3) level = 'B';
  if (difficulty > 3 && days > humanDaysLimit) level = 'C';
  return { level: `${level}-${difficulty}`, difficulty, personDays: days };
}

/**
 * Analyse a set of scripts.
 * @param {{path: string, content: string}[]} sources
 * @param {{catalog: object, name?: string, schema?: string}} opts
 */
export function analyse(sources, opts) {
  const compiled = compileCatalog(opts.catalog);
  const byId = new Map(compiled.map(e => [e.id, e]));

  const objects = [];
  const others = [];
  const files = [];
  let sqlplusLines = 0;
  for (const src of sources) {
    const parsed = parseSource(src.content, src.path);
    sqlplusLines += parsed.masked.sqlplusLines;
    files.push({ path: src.path, bytes: Buffer.byteLength(src.content), loc: parsed.loc, objects: parsed.objects.length });
    for (const o of parsed.objects) objects.push(o);
    for (const o of parsed.others) others.push(o);
  }

  // The same object defined twice is one object. The later CREATE OR REPLACE wins, as it would in Oracle.
  const seen = new Map();
  const duplicates = [];
  for (const o of objects) {
    const key = `${o.type}:${o.owner || ''}:${o.name}`;
    if (seen.has(key)) duplicates.push({ type: o.type, name: o.name, file: o.file, line: o.startLine });
    seen.set(key, o);
  }
  const unique = [...seen.values()];

  const ctx = typeContext(unique);
  const analysed = unique.map(o => analyseObject(o, compiled, byId, ctx));

  // Inventory
  const byType = {};
  for (const a of analysed) {
    const t = (byType[a.type] ||= { count: 0, loc: 0, units: 0, classes: { CLEAN: 0, PARTIAL: 0, REVIEW: 0, BLOCKER: 0 } });
    t.count++;
    t.loc += a.loc;
    t.units += a.units;
    t.classes[a.class]++;
  }
  let totalUnits = 0;
  const capped = [];
  for (const [type, t] of Object.entries(byType)) {
    t.units = round(t.units);
    let u = t.units;
    if (MAX_SCORE[type] !== undefined && u > MAX_SCORE[type]) {
      capped.push({ type, units: u, cap: MAX_SCORE[type] });
      u = MAX_SCORE[type];
    }
    t.unitsCounted = round(u);
    totalUnits += u;
  }
  totalUnits = round(totalUnits);

  // Constructs
  const constructs = new Map();
  for (const a of analysed) {
    for (const h of a.hits) {
      const e = byId.get(h.id);
      let c = constructs.get(h.id);
      if (!c) {
        c = {
          id: e.id, name: e.name, category: e.category, classification: e.classification, weight: e.weight,
          weightOrigin: e.weightOrigin, tag: e.tag, labCase: e.labCase, postgres: e.postgres, extension: e.extension,
          why: e.why, affectsClass: e.affectsClass, objects: 0, hits: 0, units: 0, samples: [],
        };
        constructs.set(h.id, c);
      }
      c.objects++;
      c.hits += h.count;
      c.units += e.weight * h.count;
      if (c.samples.length < 5) c.samples.push({ type: a.type, name: a.name, count: h.count, line: h.lines[0], file: a.file });
    }
  }
  const constructList = [...constructs.values()].map(c => ({ ...c, units: round(c.units) })).sort((x, y) => y.units - x.units);

  // Class counts and hotspots
  const byClass = { CLEAN: 0, PARTIAL: 0, REVIEW: 0, BLOCKER: 0 };
  for (const a of analysed) byClass[a.class]++;
  const hotspots = [...analysed].sort((a, b) => b.units - a.units).slice(0, 30).map(a => ({
    type: a.type, name: a.name, file: a.file, line: a.line, loc: a.loc, units: a.units, class: a.class,
    members: a.members ?? null,
    topConstructs: [...a.hits].map(h => ({ id: h.id, count: h.count, units: round(byId.get(h.id).weight * h.count) }))
      .sort((x, y) => y.units - x.units).slice(0, 4),
  }));

  // Extensions the target must allow-list. Objects are counted once per extension, not once per construct.
  const extMap = new Map();
  for (const a of analysed) {
    for (const h of a.hits) {
      const name = byId.get(h.id).extension;
      if (!name) continue;
      const x = extMap.get(name) || { name, constructs: new Set(), objectSet: new Set() };
      x.constructs.add(h.id);
      x.objectSet.add(`${a.type}:${a.name}`);
      extMap.set(name, x);
    }
  }
  const extensions = [...extMap.values()].map(x => ({ name: x.name, constructs: [...x.constructs], objects: x.objectSet.size })).sort((a, b) => b.objects - a.objects);

  const blockers = constructList.filter(c => c.classification === 'BLOCKER' && c.affectsClass);
  const semantic = constructList.filter(c => c.tag === 'semantic');

  const level = migrationLevel(analysed, totalUnits);

  // Packages
  const packages = analysed.filter(a => a.type === 'PACKAGE_BODY').map(a => ({
    name: a.name, members: a.members ?? 0, loc: a.loc, chars: a.chars, units: a.units, class: a.class, file: a.file, line: a.line,
    state: a.hits.find(h => h.id === 'PLSQL-PACKAGE-STATE')?.count ?? 0,
    memberRows: a.memberRows || [],
  })).sort((x, y) => y.units - x.units);

  const unterminated = analysed.filter(a => a.unterminated).map(a => ({ type: a.type, name: a.name, file: a.file, line: a.line }));
  const dynamicObjects = analysed.filter(a => a.dynamic).map(a => ({ type: a.type, name: a.name, file: a.file, line: a.line }));

  // Data movement signals: what a row-copy has to deal with.
  const dm = { tables: byType.TABLE?.count ?? 0 };
  const hitObjects = id => analysed.filter(a => a.hits.some(h => h.id === id));
  for (const [key, id] of [['lobTables', 'TYPE-CLOB'], ['blobTables', 'TYPE-BLOB'], ['longColumnTables', 'TYPE-LONG'], ['xmlTables', 'TYPE-XMLTYPE'],
    ['partitionedTables', 'DDL-PARTITION'], ['intervalPartitioned', 'DDL-PARTITION-INTERVAL'], ['globalTemporaryTables', 'DDL-GTT'],
    ['indexOrganizedTables', 'DDL-IOT'], ['nestedTableStorage', 'DDL-NESTED-TABLE-STORAGE'], ['externalTables', 'DDL-EXTERNAL-TABLE'],
    ['bfileColumns', 'TYPE-BFILE'], ['compressedObjects', 'DDL-COMPRESS'], ['encryptedColumnTables', 'SEC-ENCRYPT-COLUMN']]) {
    dm[key] = hitObjects(id).filter(a => a.type === 'TABLE' || a.type === 'TYPE').length;
  }

  const totalLoc = analysed.reduce((a, o) => a + o.loc, 0);
  const plsqlLoc = analysed.filter(o => ROUTINE_TYPES.has(o.type) || o.type === 'PACKAGE').reduce((a, o) => a + o.loc, 0);

  return {
    schema: 'oracle-to-postgres-migration-advisor.assessment/v1',
    name: opts.name || 'Oracle schema',
    ownerSchema: opts.schema || null,
    scoring: {
      model: 'ora2pg-25.0-compatible',
      unitMinutes: UNIT_MINUTES,
      unitsPerPersonDay: UNITS_PER_DAY,
      catalogEntries: compiled.length,
      note: 'Reimplemented from Ora2Pg 25.0 cost tables. Constructs Ora2Pg does not score carry an advisor weight.',
    },
    sources: files,
    totals: {
      objects: analysed.length,
      loc: totalLoc,
      plsqlLoc,
      units: totalUnits,
      personDaysOra2PgStyle: level.personDays,
      level: level.level,
      difficulty: level.difficulty,
      sqlplusLines,
    },
    byType,
    byClass,
    cappedTypes: capped,
    constructs: constructList,
    hotspots,
    packages,
    extensions,
    blockers,
    semanticTraps: semantic,
    dataMovement: dm,
    hygiene: { unterminated, dynamicObjects, duplicates, nonObjectStatements: others.length },
    objects: analysed.map(a => ({
      type: a.type, name: a.name, file: a.file, line: a.line, loc: a.loc, units: a.units, unitParts: a.unitParts, class: a.class, links: a.links,
      members: a.members ?? null, hits: a.hits.map(h => ({ id: h.id, count: h.count })),
    })),
    limitations: LIMITATIONS,
  };
}
