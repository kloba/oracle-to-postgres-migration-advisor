// An assumption-based estimate of the effort when the Microsoft AI-assisted schema converter does the first pass.
//
// The manual estimate counts reading and rewriting every object in Ora2Pg's published cost units. This module asks
// what is left of those units when a converter does the first pass and people review its output. It is a model
// with stated assumptions, not a measurement, and no vendor publishes a productivity figure to anchor it.
//
// Per object, the units are split (see `unitParts` in analyze.mjs):
//   addressable   reading and rewriting (base + size) and the CLEAN and PARTIAL constructs: the converter can do a first
//                 pass, and a person reviews it, which costs `reviewFraction` of the manual cost. If the converter does not
//                 convert the object, the whole manual cost stays.
//   decisions     the REVIEW constructs need a person's design decision: the converter proposes, a person decides, so the
//                 review costs `decisionMultiplier` times the review fraction, never more than the manual cost.
//   stays manual  the per-routine test allowance (converted is not equivalent: testing is not reduced), the BLOCKER
//                 constructs (no supported equivalent), and every object of a type the converter does not convert (jobs,
//                 VPD policies, users, ...).
//   setup         a fixed allowance for the prerequisites, the pilot and the conversion runs.
// Nothing here models data movement, application changes, performance tuning or cutover, which the manual estimate leaves
// out too.

export const AI_ASSUMPTIONS = {
  // Share of the manual reading-and-rewriting cost that remains for an object the converter did convert.
  reviewFraction: { low: 0.25, high: 0.5 },
  // A construct that needs a design decision costs this many times the review fraction (capped at the manual cost).
  decisionMultiplier: 2,
  // Share of objects the converter does not convert, used when no measured run is supplied. The one measured run (a
  // 1,167-object lab schema) did not convert 32%, much of it timeouts and lock contention rather than translation limits.
  defaultNotConverted: { low: 0.2, high: 0.4 },
  // Person-days for the prerequisites, the 10 to 15 object pilot and the conversion runs.
  setupDays: { low: 3, high: 5 },
  minutesPerUnit: { low: 5, high: 10 },
  minutesPerDay: 420,
};

// Object types the Microsoft converter reads (from its documented object list).
export const CONVERTER_TYPES = new Set(['TABLE', 'CONSTRAINT', 'INDEX', 'SEQUENCE', 'SYNONYM', 'VIEW', 'MATERIALIZED_VIEW', 'TRIGGER',
  'PACKAGE', 'PACKAGE_BODY', 'FUNCTION', 'PROCEDURE', 'TYPE', 'TYPE_BODY']);

const MIN_OBJECTS_FOR_A_TYPE_RATE = 10;
const round1 = n => Math.round(n * 10) / 10;

/** Rate of objects not converted, from a measured run: per type when it has enough objects, else per class, else overall. */
function measuredRates(calibration) {
  const byType = new Map((calibration.byType || []).filter(t => t.objects >= MIN_OBJECTS_FOR_A_TYPE_RATE).map(t => [t.type, t.notConvertedRate]));
  const classes = Object.entries(calibration.byClass || {}).filter(([, c]) => c.objects > 0);
  const byClass = new Map(classes.map(([k, c]) => [k, c.notConverted / c.objects]));
  const objects = classes.reduce((a, [, c]) => a + c.objects, 0);
  const overall = objects ? classes.reduce((a, [, c]) => a + c.notConverted, 0) / objects : 0;
  return { byType, byClass, overall };
}

/**
 * @param assessment  the scan (objects[].unitParts, byType, totals)
 * @param opts.calibration  optional measured run of the converter on the same schema (not-converted rates)
 * @param opts.converter    'available' | 'unknown' | 'unavailable': what the advisor says about the Microsoft converter
 * @param opts.groups       optional [[name, [types]]] for a breakdown by workstream
 */
export function aiAssistedEstimate(assessment, { calibration = null, converter = 'available', groups = [] } = {}) {
  const A = AI_ASSUMPTIONS;
  const perDay = A.minutesPerDay;
  const manualUnits = assessment.totals.units;
  const manual = { low: Math.ceil(manualUnits * A.minutesPerUnit.low / perDay), high: Math.ceil(manualUnits * A.minutesPerUnit.high / perDay) };
  if (converter === 'unavailable') {
    return { available: false, reason: 'The Microsoft converter cannot be used on this estate as it stands, so there is no AI-assisted figure. Microsoft publishes no other converter.', days: { manual } };
  }

  const rates = calibration ? measuredRates(calibration) : null;
  const rateFor = (o, which) => {
    if (!rates) return A.defaultNotConverted[which];
    return rates.byType.get(o.type) ?? rates.byClass.get(o.class) ?? rates.overall;
  };
  // Types with a cap in the scan count for less than the sum of their objects.
  const capFactor = Object.fromEntries(Object.entries(assessment.byType).map(([t, v]) => [t, v.units > 0 ? v.unitsCounted / v.units : 1]));

  const rows = [];
  for (const o of assessment.objects) {
    const f = capFactor[o.type] ?? 1;
    const p = o.unitParts || { base: o.units, test: 0, size: 0, constructsAddressable: 0, constructsReview: 0, constructsBlocker: 0 };
    const covered = CONVERTER_TYPES.has(o.type);
    const all = (p.base + p.test + p.size + p.constructsAddressable + p.constructsReview + p.constructsBlocker) * f;
    rows.push({
      type: o.type,
      addressable: covered ? (p.base + p.size + p.constructsAddressable) * f : 0,
      decisions: covered ? p.constructsReview * f : 0,
      stays: covered ? (p.test + p.constructsBlocker) * f : all,
      testing: covered ? p.test * f : 0,
      blockers: covered ? p.constructsBlocker * f : 0,
      outside: covered ? 0 : all,
      rateLow: rateFor(o, 'low'), rateHigh: rateFor(o, 'high'),
    });
  }
  const sum = (arr, fn) => arr.reduce((a, r) => a + fn(r), 0);
  const dm = A.decisionMultiplier;
  const aiUnits = (rs, rf, which) => sum(rs, r => r.stays + r.addressable * ((1 - r[which]) * rf + r[which]) + r.decisions * ((1 - r[which]) * Math.min(1, dm * rf) + r[which]));
  const stay = sum(rows, r => r.stays);
  const addressable = sum(rows, r => r.addressable);
  const decisions = sum(rows, r => r.decisions);
  const setup = A.setupDays;
  const unitsLow = aiUnits(rows, A.reviewFraction.low, 'rateLow');
  const unitsHigh = aiUnits(rows, A.reviewFraction.high, 'rateHigh');
  const ai = {
    low: Math.ceil(unitsLow * A.minutesPerUnit.low / perDay + setup.low),
    high: Math.ceil(unitsHigh * A.minutesPerUnit.high / perDay + setup.high),
  };
  // The floor: the work the converter cannot do, plus testing, plus setup. The model cannot go below it.
  const floor = Math.ceil(stay * A.minutesPerUnit.low / perDay + setup.low);

  const flat = (rf, rate, minutes, setupDays) => Math.ceil((stay + addressable * ((1 - rate) * rf + rate) + decisions * ((1 - rate) * Math.min(1, dm * rf) + rate)) * minutes / perDay + setupDays);
  const overallRate = rates ? rates.overall : (A.defaultNotConverted.low + A.defaultNotConverted.high) / 2;
  const sensitivityRates = [0, Math.round(overallRate * 100) / 100, 0.5];
  const sensitivityFractions = [0.15, 0.25, 0.5, 0.75];
  const cells = sensitivityFractions.map(rf => sensitivityRates.map(rate => ({
    low: flat(rf, rate, A.minutesPerUnit.low, setup.low),
    high: flat(rf, rate, A.minutesPerUnit.high, setup.high),
  })));

  const workstreams = groups.map(([name, types]) => {
    const t = new Set(types);
    const rs = rows.filter(r => t.has(r.type));
    const m = sum(rs, r => r.addressable + r.decisions + r.stays);
    return {
      name,
      manual: { low: round1(m * A.minutesPerUnit.low / perDay), high: round1(m * A.minutesPerUnit.high / perDay) },
      ai: {
        low: round1(aiUnits(rs, A.reviewFraction.low, 'rateLow') * A.minutesPerUnit.low / perDay),
        high: round1(aiUnits(rs, A.reviewFraction.high, 'rateHigh') * A.minutesPerUnit.high / perDay),
      },
    };
  });

  return {
    available: true,
    status: converter,
    basis: rates ? 'measured' : 'assumed',
    assumptions: { ...A, notConvertedRate: rates ? { overall: round1(rates.overall * 1000) / 1000 } : A.defaultNotConverted },
    units: { manual: round1(manualUnits), addressable: round1(addressable), decisions: round1(decisions), stayManual: round1(stay), aiLow: round1(unitsLow), aiHigh: round1(unitsHigh) },
    days: { manual, ai, setup, floor },
    remaining: { low: ai.low / manual.low, high: ai.high / manual.high },
    stays: {
      testingUnits: round1(sum(rows, r => r.testing)),
      decisionUnits: round1(decisions),
      blockerUnits: round1(sum(rows, r => r.blockers)),
      outsideUnits: round1(sum(rows, r => r.outside)),
    },
    sensitivity: { reviewFractions: sensitivityFractions, notConvertedRates: sensitivityRates, cells },
    workstreams,
  };
}
