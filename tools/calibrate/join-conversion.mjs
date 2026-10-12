#!/usr/bin/env node
// Calibrate an assessment against a measured conversion run.
//
//   node tools/calibrate/join-conversion.mjs <assessment.json> <object_mapping_summary.csv> [--out calibration.json]
//
// The CSV is the per-object output of the Microsoft VS Code PostgreSQL extension's Oracle conversion
// (Source_Object_Type, Source_Object, Status, Action_Required, Error_Message). For each object the
// assessor scored and the converter also reported, this records whether higher scores really went with
// worse outcomes, using AUC (the chance that a randomly chosen failed object outscored a randomly
// chosen converted one; 0.5 is a coin flip).
//
// What this can and cannot say. The converter's "Not-Converted" mixes translation failures with
// infrastructure failures such as timeouts. A score cannot predict a timeout caused by a locked scratch
// database, so a weak AUC is partly the run's noise, and the report must say so.

import fs from 'node:fs';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/** Mann-Whitney AUC: P(score of a failed object > score of a converted one), ties count half. */
export function auc(failScores, okScores) {
  if (!failScores.length || !okScores.length) return null;
  let wins = 0;
  for (const f of failScores) for (const o of okScores) wins += f > o ? 1 : f === o ? 0.5 : 0;
  return wins / (failScores.length * okScores.length);
}

const TYPE_MAP = {
  FUNCTION: 'FUNCTION', PROCEDURE: 'PROCEDURE', TRIGGER: 'TRIGGER', VIEW: 'VIEW', PACKAGE_BODY: 'PACKAGE_BODY',
  SYNONYM: 'SYNONYM', TYPE: 'TYPE', TABLE: 'TABLE', INDEX: 'INDEX', SEQUENCE: 'SEQUENCE', MATERIALIZED_VIEW: 'MATERIALIZED_VIEW',
};

export function calibrate(assessment, csvText) {
  const rows = parseCsv(csvText).filter(r => TYPE_MAP[r.Source_Object_Type]);
  // Only OWNER.NAME rows are standalone objects. OWNER.PACKAGE.MEMBER rows are package members mapped
  // to functions, and joining them by their last segment would collide with unrelated objects. An
  // object that appears in several rows (a trigger maps to a function and a trigger) failed if any row failed.
  const measured = new Map();
  for (const r of rows) {
    const parts = r.Source_Object.split('.');
    if (parts.length !== 2) continue;
    const key = `${TYPE_MAP[r.Source_Object_Type]}:${parts[1].replace(/"/g, '').toUpperCase()}`;
    const prev = measured.get(key) || { converted: true, actionRequired: false, error: '' };
    measured.set(key, {
      converted: prev.converted && r.Status === 'Converted',
      actionRequired: prev.actionRequired || r.Action_Required === 'yes',
      error: prev.error || r.Error_Message || '',
    });
  }

  const joined = [];
  for (const o of assessment.objects) {
    const m = measured.get(`${o.type}:${o.name}`);
    if (m) joined.push({ ...o, ...m });
  }

  const classes = ['CLEAN', 'PARTIAL', 'REVIEW', 'BLOCKER'];
  const byClass = Object.fromEntries(classes.map(c => [c, { objects: 0, notConverted: 0, actionRequired: 0 }]));
  const byType = {};
  for (const j of joined) {
    const c = byClass[j.class];
    c.objects++;
    if (!j.converted) c.notConverted++;
    if (j.actionRequired) c.actionRequired++;
    const t = (byType[j.type] ||= { objects: 0, notConverted: 0, scores: { fail: [], ok: [] }, loc: { fail: [], ok: [] }, act: { yes: [], no: [] } });
    (j.actionRequired ? t.act.yes : t.act.no).push(j.units);
    t.objects++;
    if (!j.converted) { t.notConverted++; t.scores.fail.push(j.units); t.loc.fail.push(j.loc); } else { t.scores.ok.push(j.units); t.loc.ok.push(j.loc); }
  }
  for (const c of Object.values(byClass)) {
    c.notConvertedRate = c.objects ? c.notConverted / c.objects : null;
    c.actionRequiredRate = c.objects ? c.actionRequired / c.objects : null;
  }
  const typeRows = Object.entries(byType).map(([type, t]) => ({
    type,
    objects: t.objects,
    notConverted: t.notConverted,
    notConvertedRate: t.objects ? t.notConverted / t.objects : null,
    aucUnits: auc(t.scores.fail, t.scores.ok),
    aucLoc: auc(t.loc.fail, t.loc.ok),
    aucUnitsActionRequired: auc(t.act.yes, t.act.no),
  })).sort((a, b) => b.objects - a.objects);

  // Failure causes: how much of the measured failure is infrastructure, not translation.
  const causes = { timeoutOrLock: 0, dependency: 0, reviewBestEffort: 0, other: 0 };
  for (const j of joined) {
    if (j.converted) continue;
    const e = j.error;
    if (/CVT-366|CVT-186|CVT-364|CVT-224/.test(e)) causes.reviewBestEffort++;
    else if (/CVT-24[0-9]|CVT-14[0-9]|CVT-38[0-9]|dependency/i.test(e)) causes.dependency++;
    else if (/timeout|lock/i.test(e)) causes.timeoutOrLock++;
    else causes.other++;
  }

  const strictRank = joined.filter(j => j.type !== 'TABLE' && j.type !== 'SEQUENCE' && j.type !== 'INDEX' && j.type !== 'TYPE');
  const overallAuc = auc(strictRank.filter(j => !j.converted).map(j => j.units), strictRank.filter(j => j.converted).map(j => j.units));

  return {
    schema: 'oracle-to-postgres-migration-advisor.calibration/v1',
    measuredRows: rows.length,
    joinedObjects: joined.length,
    unmatchedAssessed: assessment.objects.length - joined.length,
    byClass,
    byType: typeRows,
    failureCauses: causes,
    overallAucProgrammable: overallAuc,
    note: 'Not-Converted mixes translation failures with infrastructure failures (timeouts, lock contention). A weak AUC is partly that noise.',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [assessmentPath, csvPath, ...rest] = process.argv.slice(2);
  if (!assessmentPath || !csvPath) { console.error('usage: join-conversion.mjs <assessment.json> <mapping.csv> [--out FILE]'); process.exit(2); }
  const out = rest[rest.indexOf('--out') + 1];
  const result = calibrate(JSON.parse(fs.readFileSync(assessmentPath, 'utf8')), fs.readFileSync(csvPath, 'utf8'));
  if (out && rest.includes('--out')) { fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n'); console.error(`wrote ${out}`); }
  console.log(`joined ${result.joinedObjects} of ${result.measuredRows} measured rows; overall AUC (programmable) ${result.overallAucProgrammable?.toFixed(3)}`);
  for (const [k, v] of Object.entries(result.byClass)) console.log(`  ${k.padEnd(8)} ${String(v.objects).padStart(4)} objects  not converted ${v.notConverted} (${v.notConvertedRate === null ? 'n/a' : (v.notConvertedRate * 100).toFixed(1) + '%'})`);
  for (const t of result.byType) console.log(`  ${t.type.padEnd(18)} n=${String(t.objects).padStart(3)} failed=${String(t.notConverted).padStart(3)} AUC(units)=${t.aucUnits === null ? 'n/a' : t.aucUnits.toFixed(2)} AUC(loc)=${t.aucLoc === null ? 'n/a' : t.aucLoc.toFixed(2)}`);
  console.log('  causes', JSON.stringify(result.failureCauses));
}
