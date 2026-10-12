// Statement splitting and object recognition for Oracle scripts.
//
// An Oracle script ends a plain SQL statement with `;` and a PL/SQL unit (package, procedure,
// function, trigger, type body, anonymous block) with a `/` on a line of its own, because a `;`
// belongs to the unit's body. Getting that wrong either splits a package at its first statement or
// glues the whole file into one object, so the mode of each statement is decided from its first
// tokens and only then is the terminator chosen.

import { maskSource, codeLines } from './mask.mjs';

const PLSQL_HEAD = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:NO\s*FORCE\s+|FORCE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:DEFINER\s*=\s*\S+\s+)?(PACKAGE\s+BODY|PACKAGE|PROCEDURE|FUNCTION|TRIGGER|TYPE\s+BODY|TYPE|LIBRARY|OPERATOR|JAVA\s+(?:SOURCE|CLASS))\b/i;
const ANON_HEAD = /^\s*(DECLARE|BEGIN)\b/i;
const COLLECTION_TYPE = /\b(?:AS|IS)\s+(?:TABLE\s+OF|VARRAY\s*\(|VARYING\s+ARRAY)/i;

/** Object types the recognizer understands. Order matters: longest keyword first. */
const OBJECT_KEYWORDS = [
  ['PACKAGE BODY', 'PACKAGE_BODY'],
  ['PACKAGE', 'PACKAGE'],
  ['TYPE BODY', 'TYPE_BODY'],
  ['TYPE', 'TYPE'],
  ['PROCEDURE', 'PROCEDURE'],
  ['FUNCTION', 'FUNCTION'],
  ['TRIGGER', 'TRIGGER'],
  ['MATERIALIZED VIEW LOG', 'MATERIALIZED_VIEW_LOG'],
  ['MATERIALIZED VIEW', 'MATERIALIZED_VIEW'],
  ['VIEW', 'VIEW'],
  ['TABLE', 'TABLE'],
  ['INDEX', 'INDEX'],
  ['SEQUENCE', 'SEQUENCE'],
  ['SYNONYM', 'SYNONYM'],
  ['DATABASE LINK', 'DATABASE_LINK'],
  ['CONTEXT', 'CONTEXT'],
  ['DIRECTORY', 'DIRECTORY'],
  ['LIBRARY', 'LIBRARY'],
  ['OPERATOR', 'OPERATOR'],
  ['INDEXTYPE', 'INDEXTYPE'],
  ['DIMENSION', 'DIMENSION'],
  ['CLUSTER', 'CLUSTER'],
  ['PROFILE', 'PROFILE'],
  ['ROLE', 'ROLE'],
  ['USER', 'USER'],
  ['TABLESPACE', 'TABLESPACE'],
  ['JAVA SOURCE', 'JAVA_SOURCE'],
  ['EDITION', 'EDITION'],
  ['PLUGGABLE DATABASE', 'PDB'],
];

const CREATE_RE = new RegExp(
  '^\\s*CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:NO\\s*FORCE\\s+|FORCE\\s+)?(?:EDITIONABLE\\s+|NONEDITIONABLE\\s+)?' +
  '(?:DEFINER\\s*=\\s*\\S+\\s+)?(?:PUBLIC\\s+)?(?:SHARED\\s+)?' +
  '(?:GLOBAL\\s+TEMPORARY\\s+|PRIVATE\\s+TEMPORARY\\s+|IMMUTABLE\\s+|BLOCKCHAIN\\s+|SHARDED\\s+|DUPLICATED\\s+)?' +
  '(?:UNIQUE\\s+|BITMAP\\s+|MULTIVALUE\\s+)?(?:MATERIALIZED\\s+VIEW\\s+LOG|MATERIALIZED\\s+VIEW|DATABASE\\s+LINK|PACKAGE\\s+BODY|TYPE\\s+BODY|JAVA\\s+SOURCE|PLUGGABLE\\s+DATABASE|' +
  OBJECT_KEYWORDS.map(([k]) => k.replace(/ /g, '\\s+')).join('|') + ')\\b',
  'i',
);

const NAME_RE = '((?:"[^"]+"|[A-Za-z_][\\w$#]*)(?:\\s*\\.\\s*(?:"[^"]+"|[A-Za-z_][\\w$#]*))?)';

function normName(raw) {
  if (!raw) return { owner: null, name: null };
  const parts = raw.split(/\s*\.\s*/).map(p => p.replace(/^"|"$/g, '').toUpperCase());
  if (parts.length >= 2) return { owner: parts[parts.length - 2], name: parts[parts.length - 1] };
  return { owner: null, name: parts[0] };
}

function normKeyword(s) {
  return s.replace(/\s+/g, ' ').toUpperCase();
}

/** Decide whether a statement is PL/SQL (terminated by `/`) or SQL (terminated by `;`). */
function modeOf(head) {
  if (PLSQL_HEAD.test(head)) return 'plsql';
  if (ANON_HEAD.test(head)) return 'plsql';
  return 'sql';
}

/**
 * Split masked source into statements.
 * Each statement keeps its line range and both views of the text.
 */
export function splitStatements(masked) {
  const codeLinesArr = masked.code.split('\n');
  const textLinesArr = masked.text.split('\n');
  const rawLinesArr = (masked.raw || masked.text).split('\n');
  const out = [];
  let buf = null;

  const flush = (endLine, extra = {}) => {
    if (!buf) return;
    const code = buf.code.join('\n');
    if (code.trim() !== '') {
      out.push({
        startLine: buf.start + 1,
        endLine: endLine + 1,
        mode: buf.mode,
        code,
        text: buf.text.join('\n'),
        raw: buf.raw.join('\n'),
        ...extra,
      });
    }
    buf = null;
  };

  for (let ln = 0; ln < codeLinesArr.length; ln++) {
    const line = codeLinesArr[ln];
    const textLine = textLinesArr[ln];
    const rawLine = rawLinesArr[ln];
    const trimmed = line.trim();

    if (trimmed === '/') { flush(ln - 1); continue; }
    if (!buf && trimmed === '') continue;

    // Scripts that omit the `/` still end a PL/SQL unit before the next CREATE.
    if (buf && buf.mode === 'plsql' && /^\s*CREATE\s/i.test(line) && buf.sawSemicolon) {
      flush(ln - 1);
    }

    // A plain SQL statement that reaches the next CREATE without a terminator was never ended. The
    // usual cause is a `;` typed inside a trailing `--` comment, which an Oracle client ignores.
    // Recover the object, and say so: the script would not have run as written.
    if (buf && buf.mode === 'sql' && /^\s*CREATE\s/i.test(line) && /^\s*CREATE\s/i.test(buf.code[0] || '')) {
      flush(ln - 1, { unterminated: true });
    }

    if (!buf) {
      buf = { start: ln, code: [], text: [], raw: [], mode: null, sawSemicolon: false };
    }

    if (buf.mode === null) {
      buf.mode = modeOf(line + ' ' + (codeLinesArr[ln + 1] || ''));
    }

    if (buf.mode === 'sql') {
      let rest = line;
      let restText = textLine;
      let restRaw = rawLine;
      while (true) {
        const semi = rest.indexOf(';');
        if (semi === -1) { buf.code.push(rest); buf.text.push(restText); buf.raw.push(restRaw); break; }
        buf.code.push(rest.slice(0, semi + 1));
        buf.text.push(restText.slice(0, semi + 1));
        buf.raw.push(restRaw.slice(0, semi + 1));
        flush(ln);
        rest = rest.slice(semi + 1);
        restText = restText.slice(semi + 1);
        restRaw = restRaw.slice(semi + 1);
        if (rest.trim() === '') break;
        buf = { start: ln, code: [], text: [], raw: [], mode: modeOf(rest), sawSemicolon: false };
        if (buf.mode === 'plsql') { buf.code.push(rest); buf.text.push(restText); buf.raw.push(restRaw); break; }
      }
      continue;
    }

    buf.code.push(line);
    buf.text.push(textLine);
    buf.raw.push(rawLine);
    if (line.includes(';')) buf.sawSemicolon = true;

    // A collection type is PL/SQL by keyword but SQL by terminator: `CREATE TYPE t AS TABLE OF x;`.
    // Only a statement whose own kind is TYPE qualifies. A package body that happens to open with a
    // local `TYPE x IS TABLE OF ...;` contains the same words and must run on to its closing slash.
    if (buf.sawSemicolon) {
      const joined = buf.code.join('\n');
      const head = PLSQL_HEAD.exec(joined);
      if (head && /^TYPE$/i.test(head[1].replace(/\s+/g, ' '))) {
        const m = COLLECTION_TYPE.exec(joined);
        if (m && joined.indexOf(';', m.index) !== -1) flush(ln);
      }
    }
  }
  flush(codeLinesArr.length - 1);
  return out;
}

/** First significant words of a statement, used for classification of non-CREATE statements. */
function leadingKeywords(code) {
  const m = /^\s*([A-Za-z]+)(?:\s+([A-Za-z]+))?(?:\s+([A-Za-z]+))?/.exec(code);
  return m ? m.slice(1).filter(Boolean).map(s => s.toUpperCase()) : [];
}

const SCHEDULER_CALLS = [
  ['DBMS_SCHEDULER\\s*\\.\\s*CREATE_JOB\\b', 'JOB', 'job_name'],
  ['DBMS_SCHEDULER\\s*\\.\\s*CREATE_PROGRAM\\b', 'PROGRAM', 'program_name'],
  ['DBMS_SCHEDULER\\s*\\.\\s*CREATE_SCHEDULE\\b', 'SCHEDULE', 'schedule_name'],
  ['DBMS_SCHEDULER\\s*\\.\\s*CREATE_CHAIN\\b', 'CHAIN', 'chain_name'],
  ['DBMS_SCHEDULER\\s*\\.\\s*CREATE_WINDOW\\b', 'WINDOW', 'window_name'],
  ['DBMS_SCHEDULER\\s*\\.\\s*CREATE_JOB_CLASS\\b', 'JOB_CLASS', 'job_class_name'],
  ['DBMS_JOB\\s*\\.\\s*SUBMIT\\b', 'LEGACY_JOB', null],
  ['DBMS_RLS\\s*\\.\\s*ADD_POLICY\\b', 'VPD_POLICY', 'policy_name'],
  ['DBMS_FGA\\s*\\.\\s*ADD_POLICY\\b', 'FGA_POLICY', 'policy_name'],
  ['DBMS_REFRESH\\s*\\.\\s*MAKE\\b', 'REFRESH_GROUP', 'name'],
  ['DBMS_AQADM\\s*\\.\\s*CREATE_QUEUE(?:_TABLE)?\\b', 'QUEUE', 'queue_name'],
  ['DBMS_NETWORK_ACL_ADMIN\\s*\\.\\s*CREATE_ACL\\b', 'NETWORK_ACL', 'acl'],
];

/** The text of a call from its name to the matching close paren, so detectors see only that call. */
function callRegion(text, startIdx) {
  const open = text.indexOf('(', startIdx);
  if (open === -1) return text.slice(startIdx, startIdx + 400);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return text.slice(startIdx, i + 1); }
  }
  return text.slice(startIdx);
}

/**
 * Pull scheduler, VPD and refresh-group registrations out of anonymous blocks. They are not
 * CREATE statements, but each is a schema object a migration has to carry.
 */
function objectsFromBlock(stmt) {
  const found = [];
  for (const [callPattern, type, nameArg] of SCHEDULER_CALLS) {
    const re = new RegExp(callPattern, 'ig');
    let m;
    while ((m = re.exec(stmt.code)) !== null) {
      const region = callRegion(stmt.text, m.index);
      const regionCode = callRegion(stmt.code, m.index);
      let name = null;
      if (nameArg) {
        const nm = new RegExp(`\\b${nameArg}\\s*=>\\s*'([^']+)'`, 'i').exec(region);
        if (nm) name = nm[1].toUpperCase();
      }
      if (!name) {
        const first = /\(\s*'([^']+)'/.exec(region);
        if (first) name = first[1].toUpperCase();
      }
      found.push({
        type,
        owner: null,
        name: name || `${type}@L${stmt.startLine}`,
        code: regionCode,
        text: region,
      });
    }
  }
  return found;
}

/**
 * Objects created by `EXECUTE IMMEDIATE 'CREATE ...'` inside an installer block. A scanner that reads
 * only top-level CREATE statements never sees them, so an estate that builds its materialized views
 * this way would be reported as having none. They are marked `dynamic` so the report can say how
 * they were found.
 */
const DYNAMIC_DDL = new RegExp(
  "\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(MATERIALIZED\\s+VIEW\\s+LOG\\s+ON|MATERIALIZED\\s+VIEW|GLOBAL\\s+TEMPORARY\\s+TABLE|TABLE|UNIQUE\\s+INDEX|BITMAP\\s+INDEX|INDEX|SEQUENCE|SYNONYM|VIEW)\\s+" + NAME_RE,
  'ig',
);
const DYNAMIC_TYPE = {
  'MATERIALIZED VIEW LOG ON': 'MATERIALIZED_VIEW_LOG',
  'MATERIALIZED VIEW': 'MATERIALIZED_VIEW',
  'GLOBAL TEMPORARY TABLE': 'TABLE',
  TABLE: 'TABLE',
  'UNIQUE INDEX': 'INDEX',
  'BITMAP INDEX': 'INDEX',
  INDEX: 'INDEX',
  SEQUENCE: 'SEQUENCE',
  SYNONYM: 'SYNONYM',
  VIEW: 'VIEW',
};

function dynamicDdlObjects(stmt) {
  const found = [];
  const seen = new Set();
  let m;
  DYNAMIC_DDL.lastIndex = 0;
  while ((m = DYNAMIC_DDL.exec(stmt.text)) !== null) {
    const type = DYNAMIC_TYPE[normKeyword(m[1])];
    const { owner, name } = normName(m[2]);
    if (!type || !name) continue;
    const key = `${type}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // The statement runs to the `;` that ends the EXECUTE IMMEDIATE, found in the code view where
    // string interiors are blank so a `;` inside the SQL text cannot end it early.
    let end = stmt.code.indexOf(';', m.index);
    if (end === -1) end = Math.min(stmt.text.length, m.index + 4000);
    const region = stmt.text.slice(m.index, end);
    found.push({ type, owner, name, code: region, text: region, dynamic: true });
  }
  // A materialized view whose refresh clause is assembled from variables carries it elsewhere in the same
  // block. When the block creates exactly one such view, its whole text is the view's definition.
  const mvs = found.filter(f => f.type === 'MATERIALIZED_VIEW');
  if (mvs.length === 1) { mvs[0].code = mvs[0].code + '\n' + stmt.text; mvs[0].text = mvs[0].code; }
  return found;
}

/**
 * Turn statements into schema objects. A statement that is not a recognised object definition is
 * kept as a plain statement so constraint and grant lines still count toward the inventory.
 */
export function recognise(statements, file) {
  const objects = [];
  const others = [];

  for (const st of statements) {
    const head = st.code;
    const create = CREATE_RE.exec(head);

    if (create) {
      const kw = normKeyword(create[0].replace(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?/i, ''));
      let kind = null;
      for (const [k, v] of OBJECT_KEYWORDS) {
        if (new RegExp(`(?:^|\\s)${k.replace(/ /g, '\\s+')}$`, 'i').test(kw.replace(/^(?:NO\s*FORCE\s+|FORCE\s+|EDITIONABLE\s+|NONEDITIONABLE\s+|DEFINER\s*=\s*\S+\s+|PUBLIC\s+|SHARED\s+|GLOBAL\s+TEMPORARY\s+|PRIVATE\s+TEMPORARY\s+|IMMUTABLE\s+|BLOCKCHAIN\s+|SHARDED\s+|DUPLICATED\s+|UNIQUE\s+|BITMAP\s+|MULTIVALUE\s+)+/i, ''))) { kind = v; break; }
      }
      const after = head.slice(create.index + create[0].length);
      let nameMatch;
      if (kind === 'MATERIALIZED_VIEW_LOG') {
        nameMatch = new RegExp(`^\\s*ON\\s+${NAME_RE}`, 'i').exec(after);
      } else {
        nameMatch = new RegExp(`^\\s*(?:IF\\s+NOT\\s+EXISTS\\s+)?${NAME_RE}`, 'i').exec(after);
      }
      const { owner, name } = normName(nameMatch && nameMatch[1]);
      const flags = {
        public: /\bPUBLIC\b/i.test(create[0]),
        globalTemporary: /GLOBAL\s+TEMPORARY/i.test(create[0]),
        unique: /\bUNIQUE\b/i.test(create[0]),
        bitmap: /\bBITMAP\b/i.test(create[0]),
        orReplace: /OR\s+REPLACE/i.test(create[0]),
        unterminated: Boolean(st.unterminated),
      };
      objects.push({
        type: kind || 'OTHER',
        owner,
        name: name || `ANON@L${st.startLine}`,
        file,
        startLine: st.startLine,
        endLine: st.endLine,
        code: st.code,
        text: st.text,
        raw: st.raw,
        flags,
      });
      continue;
    }

    if (ANON_HEAD.test(head)) {
      const found = [...objectsFromBlock(st), ...dynamicDdlObjects(st)];
      if (found.length) {
        for (const f of found) {
          objects.push({ ...f, raw: f.raw || f.text, file, startLine: st.startLine, endLine: st.endLine, flags: {} });
        }
        continue;
      }
      others.push({ kind: 'ANONYMOUS_BLOCK', file, startLine: st.startLine, endLine: st.endLine, code: st.code, text: st.text });
      continue;
    }


    const kw = leadingKeywords(head);
    if (kw[0] === 'ALTER' && kw[1] === 'TABLE') {
      const tm = new RegExp(`^\\s*ALTER\\s+TABLE\\s+${NAME_RE}`, 'i').exec(head);
      const { owner, name } = normName(tm && tm[1]);
      const cn = /\bCONSTRAINT\s+("[^"]+"|[A-Za-z_][\w$#]*)/i.exec(head);
      if (/\bADD\b[\s\S]*\b(CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK)\b/i.test(head)) {
        objects.push({
          type: 'CONSTRAINT',
          owner,
          name: cn ? cn[1].replace(/"/g, '').toUpperCase() : `${name}@L${st.startLine}`,
          table: name,
          file, startLine: st.startLine, endLine: st.endLine, code: st.code, text: st.text, raw: st.raw,
          flags: {},
        });
        continue;
      }
    }
    others.push({ kind: kw.slice(0, 2).join(' ') || 'UNKNOWN', file, startLine: st.startLine, endLine: st.endLine, code: st.code, text: st.text });
  }
  return { objects, others };
}


/** Names an object is attached to: the table behind a trigger, the target of a policy, the routine a job runs. */
function linksOf(obj) {
  const out = new Set();
  const base = raw => {
    if (!raw) return;
    const first = String(raw).replace(/"/g, '').split('.');
    out.add((first.length > 1 && obj.type !== 'JOB' ? first[first.length - 1] : first[0]).toUpperCase());
  };
  const code = obj.code || '';
  const text = obj.text || '';
  if (obj.type === 'TRIGGER') {
    const m = /\b(?:BEFORE|AFTER|INSTEAD\s+OF)\b[\s\S]{0,300}?\bON\s+(?:NESTED\s+TABLE\s+\S+\s+OF\s+)?("[^"]+"|[A-Za-z_][\w$#.]*)/i.exec(code);
    if (m) base(m[1]);
  } else if (obj.type === 'VPD_POLICY' || obj.type === 'FGA_POLICY') {
    for (const key of ['object_name', 'policy_function']) {
      const m = new RegExp(`\\b${key}\\s*=>\\s*'([^']+)'`, 'i').exec(text);
      if (m) base(m[1]);
    }
  } else if (obj.type === 'SYNONYM') {
    const m = /\bFOR\s+("[^"]+"|[A-Za-z_][\w$#.]*)/i.exec(code);
    if (m) base(m[1]);
  } else if (obj.type === 'INDEX') {
    const m = /\bON\s+("[^"]+"|[A-Za-z_][\w$#.]*)/i.exec(code);
    if (m) base(m[1]);
  } else if (obj.type === 'CONSTRAINT' && obj.table) {
    out.add(obj.table);
  } else if (obj.type === 'JOB') {
    const m = /\bjob_action\s*=>\s*'([^']+)'/i.exec(text);
    if (m) base(m[1].split('(')[0]);
    const pg = /\bprogram_name\s*=>\s*'([^']+)'/i.exec(text);
    if (pg) base(pg[1]);
  }
  out.delete(String(obj.name).toUpperCase());
  return [...out];
}

export function parseSource(src, file) {
  const masked = maskSource(src);
  const statements = splitStatements(masked);
  const { objects, others } = recognise(statements, file);
  for (const o of objects) o.links = linksOf(o);
  return { masked, statements, objects, others, loc: codeLines(masked.code) };
}
