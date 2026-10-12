// Source masking for Oracle SQL / PL/SQL.
//
// Detection must never fire on text that is not code. A comment that says "TODO: replace CONNECT BY"
// or a string literal that holds an error message must not count as a construct, and a line such as
// `PROMPT it's loading` must not open a string that swallows the next hundred lines. So every
// detector runs on a masked copy of the source in which comments and string interiors are blanked.
//
// The masked copy has exactly the same length and the same line breaks as the original. That is
// what lets a caller find a hit in the masked text and read the real name out of the unmasked text
// at the same offset, and what keeps reported line numbers honest.

// SQL*Plus client commands are not SQL. Only whole-line commands are handled: they are the only form
// the lab and real deployment scripts use. SET is whitelisted by option because `SET col = value`
// at the start of a line is the SET clause of an UPDATE.
// Every pattern here is a form that cannot be SQL or PL/SQL. A pattern that merely *can* be a
// SQL*Plus command is left alone, because blanking a line of real code is worse than keeping a
// line of script noise: `START WITH 1000` is a sequence clause, `CONNECT BY` is a hierarchical
// query, `EXIT WHEN` is a loop, `DESC NULLS LAST` is a sort. The first draft of this filter used
// bare `START`, `CONN(ECT)?`, `EXIT` and `DESC` and silently deleted all four.
const SQLPLUS_SET_OPTIONS = [
  'SERVEROUTPUT', 'DEFINE', 'FEEDBACK', 'SQLBLANKLINES', 'LINESIZE', 'LINES', 'PAGESIZE', 'PAGES',
  'ECHO', 'VERIFY', 'VER', 'TIMING', 'TERMOUT', 'TRIMSPOOL', 'TRIMS', 'HEADING', 'HEAD',
  'LONG', 'LONGCHUNKSIZE', 'AUTOCOMMIT', 'SQLPROMPT', 'SQLTERMINATOR', 'SQLT', 'SCAN', 'ESCAPE',
  'NEWPAGE', 'NUMWIDTH', 'COLSEP', 'ARRAYSIZE', 'WRAP', 'SHOWMODE', 'AUTOTRACE',
  'EDITFILE', 'SQLCASE', 'SQLNUMBER', 'CONCAT', 'ENCODING', 'EXITCOMMIT',
  'ERRORLOGGING', 'TRIMOUT', 'UNDERLINE', 'XMLOPTIMIZATIONCHECK', 'APPINFO', 'CMDSEP',
  'COMPATIBILITY', 'COPYCOMMIT', 'COPYTYPECHECK', 'EMBEDDED', 'HISTORY',
  'LOBOFFSET', 'LOBPREFETCH', 'LOGSOURCE', 'MARKUP', 'PNO', 'RECSEP', 'RECSEPCHAR', 'SHIFTINOUT',
  'SQLPLUSCOMPATIBILITY', 'STATEMENTCACHE', 'TRUNCATE', 'WORKAREA',
];
const SQLPLUS_LINE = new RegExp(
  '^\\s*(?:' +
    'PROMPT\\b|PRO\\s|PRO$|' +
    'REM(?:ARK)?(?:\\s|$)(?!\\s*(?::=|\\(|\\.|,|;))|' +
    'SPOOL\\s+\\S|WHENEVER\\s+(?:SQLERROR|OSERROR)\\b|UNDEFINE\\s+\\S|' +
    'DEFINE\\s+[\\w$#]+\\s*=|' +
    'COL(?:UMN)?\\s+\\S+\\s+(?:FORMAT|FOR|HEADING|HEA|NEW_VALUE|NOPRINT|JUSTIFY|CLEAR|ON\\b|OFF\\b|NOPRI)\\b|' +
    'TTITLE\\b|BTITLE\\b|CLEAR\\s+(?:SCREEN|BUFFER|COLUMNS|BREAKS|COMPUTES)\\b|' +
    '@@?\\s*\\S|START\\s+\\S+\\.sql\\b|' +
    '(?:EXIT|QUIT)(?:\\s+(?:SUCCESS|FAILURE|WARNING|\\d+|SQL\\.SQLCODE)(?:\\s+(?:COMMIT|ROLLBACK))?)?\\s*$|' +
    'CONN(?:ECT)?\\s+(?!BY\\b)[\\w$#"]+(?:\\s*/|@|\\s+AS\\s+SYSDBA)|' +
    'DISCONNECT\\s*$|VAR(?:IABLE)?\\s+[\\w$#]+\\s+(?:NUMBER|VARCHAR2|CHAR|CLOB|REFCURSOR|BINARY_DOUBLE|BINARY_FLOAT)\\b|' +
    'STORE\\s+SET\\b|SET\\s+(?:' + SQLPLUS_SET_OPTIONS.join('|') + ')\\b(?!\\s*=)' +
  ')',
  'i',
);

const Q_CLOSE = { '[': ']', '{': '}', '(': ')', '<': '>' };

/**
 * Mask an Oracle script.
 *
 * @returns {{ code: string, text: string, raw: string, sqlplusLines: number }}
 *   `code`  comments, string interiors and SQL*Plus commands blanked. Use for detection.
 *   `raw`   the original source. Optimizer hints live in comments, so the only way to count them.
 *   `text`  comments and SQL*Plus commands blanked, strings kept. Use to read names out of
 *           `job_name => 'X'`-style arguments.
 */
export function maskSource(src) {
  const n = src.length;
  const code = new Array(n);
  const text = new Array(n);
  let i = 0;
  let sqlplusLines = 0;
  let lineStart = true;

  const put = (idx, ch, keepInText, keepInCode) => {
    const blank = ch === '\n' || ch === '\r' ? ch : ' ';
    text[idx] = keepInText ? ch : blank;
    code[idx] = keepInCode ? ch : blank;
  };

  while (i < n) {
    if (lineStart) {
      // A SQL*Plus command can only start a line that is not inside a comment or string. Because this
      // loop returns to `lineStart` only from the normal state, that condition holds here.
      let eol = src.indexOf('\n', i);
      if (eol === -1) eol = n;
      const line = src.slice(i, eol);
      if (SQLPLUS_LINE.test(line)) {
        for (let k = i; k < eol; k++) put(k, src[k], false, false);
        sqlplusLines++;
        i = eol;
        lineStart = false;
        continue;
      }
      lineStart = false;
    }

    const ch = src[i];
    const next = src[i + 1];

    if (ch === '\n') {
      put(i, ch, true, true);
      i++;
      lineStart = true;
      continue;
    }

    // -- line comment
    if (ch === '-' && next === '-') {
      while (i < n && src[i] !== '\n') { put(i, src[i], false, false); i++; }
      continue;
    }

    // /* block comment */
    if (ch === '/' && next === '*') {
      put(i, ch, false, false); put(i + 1, next, false, false);
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { put(i, src[i], false, false); i++; }
      if (i < n) { put(i, src[i], false, false); put(i + 1, src[i + 1], false, false); i += 2; }
      continue;
    }

    // q'[ ... ]' alternative quoting (also nq'...')
    if ((ch === 'q' || ch === 'Q' || ((ch === 'n' || ch === 'N') && (next === 'q' || next === 'Q'))) &&
        (ch === 'q' || ch === 'Q' ? next === "'" : src[i + 2] === "'")) {
      const qpos = ch === 'q' || ch === 'Q' ? i : i + 1;
      const delimOpen = src[qpos + 2];
      if (delimOpen && !/\s/.test(delimOpen)) {
        const delimClose = Q_CLOSE[delimOpen] || delimOpen;
        const closeSeq = delimClose + "'";
        const bodyStart = qpos + 3;
        const end = src.indexOf(closeSeq, bodyStart);
        const stop = end === -1 ? n : end + 2;
        for (let k = i; k < stop; k++) {
          const keepQuote = k <= qpos + 2 || k >= stop - 2;
          put(k, src[k], true, keepQuote && src[k] !== '\n');
          if (src[k] === '\n') lineStart = true;
        }
        i = stop;
        continue;
      }
    }

    // 'string' with '' escape
    if (ch === "'") {
      put(i, ch, true, true);
      i++;
      while (i < n) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") { put(i, src[i], true, false); put(i + 1, src[i + 1], true, false); i += 2; continue; }
          put(i, src[i], true, true);
          i++;
          break;
        }
        put(i, src[i], true, false);
        if (src[i] === '\n') lineStart = true;
        i++;
      }
      continue;
    }

    // "quoted identifier" is code: Oracle objects with quoted names must stay visible.
    if (ch === '"') {
      put(i, ch, true, true);
      i++;
      while (i < n && src[i] !== '"' && src[i] !== '\n') { put(i, src[i], true, true); i++; }
      if (i < n && src[i] === '"') { put(i, src[i], true, true); i++; }
      continue;
    }

    put(i, ch, true, true);
    i++;
  }

  return { code: code.join(''), text: text.join(''), raw: src, sqlplusLines };
}

export function countLines(s) {
  if (!s) return 0;
  let c = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) c++;
  return c;
}

/** Non-blank lines of masked code: the "lines of code" figure. Comments and SQL*Plus lines are blank by then. */
export function codeLines(maskedCode) {
  let c = 0;
  for (const line of maskedCode.split('\n')) if (line.trim() !== '') c++;
  return c;
}
