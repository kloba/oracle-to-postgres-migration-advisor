// Builds the prerequisite plan from the advisor's output, the stated profile and, when there is one, the schema scan.
// The catalogue is reference/prerequisite-catalog.json. The same items feed the plan document and the report.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
export const CATALOG = readJson('reference/prerequisite-catalog.json');
const SOURCES = new Map(readJson('reference/sources.json').sources.map(s => [s.id, s]));

/** Atomic conditions of one `when`. `always` is a condition on its own. */
function conditions(when, ctx) {
  const c = [];
  const sel = ctx.out.selectedMethods || {};
  if (when.always) c.push(true);
  if (when.targets) c.push(Boolean(ctx.out.recommendation) && when.targets.includes(ctx.out.recommendation.target));
  if (when.schemaConversion) c.push(Boolean(sel.schemaConversion) && when.schemaConversion.includes(sel.schemaConversion));
  if (when.dataMovement) c.push(Boolean(sel.dataMovement) && when.dataMovement.includes(sel.dataMovement));
  if (when.gap) c.push((ctx.out.methodGaps || []).some(g => when.gap.includes(g.id)));
  if (when.dataFamily) c.push(Boolean(sel.dataFamily) && when.dataFamily.includes(sel.dataFamily));
  for (const [field, values] of Object.entries(when.profile || {})) c.push(values.includes(ctx.out.normalizedProfile[field]));
  for (const [key, min] of Object.entries(when.scan || {})) c.push(Boolean(ctx.scan) && (ctx.scan[key] || 0) >= min);
  return c;
}

export function applies(item, ctx) {
  const c = conditions(item.when, ctx);
  if (!c.length) return false;
  return item.when.mode === 'any' ? c.some(Boolean) : c.every(Boolean);
}

/**
 * @param {{out: object, assessment?: object}} input  the engine's output and, optionally, the schema scan
 * @returns the plan: phases with the steps that apply, plus one application step per feature the target carries by workaround or redesign
 */
export function buildPlan({ out, assessment = null }) {
  const ctx = { out, scan: assessment ? assessment.dataMovement : null };
  const phases = CATALOG.phases.map(ph => ({ ...ph, items: [] }));
  const byId = new Map(phases.map(p => [p.id, p]));
  for (const item of CATALOG.items) if (applies(item, ctx)) byId.get(item.phase).items.push({ ...item, sourceLinks: (item.sources || []).map(id => SOURCES.get(id)).filter(Boolean) });

  const rem = out.recommendation?.remediation;
  if (rem) {
    for (const state of ['redesign', 'workaround', 'unknown']) {
      for (const r of rem[state]) {
        byId.get('prepare').items.push({
          id: `APP-${r.feature}`, phase: 'prepare', area: 'Application', owner: 'Application owner',
          title: `${r.label}: ${state === 'unknown' ? 'ask the vendor' : state}`,
          detail: r.note || 'The vendor documentation does not say how this target carries the feature. Confirm with the vendor before relying on it.',
          sourceLinks: (r.sources || []).map(id => SOURCES.get(id)).filter(Boolean),
        });
      }
    }
  }
  return {
    target: out.recommendation ? { id: out.recommendation.target, label: out.recommendation.label } : null,
    status: out.metadata.recommendationStatus,
    selectedMethods: out.selectedMethods,
    phases,
    scanUsed: Boolean(assessment),
  };
}

const link = s => `[${s.title}](${s.url})`;

export function renderPlan(plan, { name = 'Oracle estate' } = {}) {
  const lines = [];
  lines.push(`# Prerequisite plan: ${name}`, '');
  lines.push(`> **Preliminary.** This plan follows a ${plan.status} recommendation${plan.target ? ` for **${plan.target.label}**` : ''} and changes if the recommendation does. Each step cites the page it rests on; a step marked *judgement* does not.`);
  if (plan.selectedMethods) lines.push(`> Schema and code: ${plan.selectedMethods.schemaConversion ? `\`${plan.selectedMethods.schemaConversion}\`` : 'no Microsoft route (gap)'} · Data: ${plan.selectedMethods.dataMovement ? `\`${plan.selectedMethods.dataMovement}\`` : 'no Microsoft route (gap)'} (${plan.selectedMethods.dataFamily}).`);
  if (!plan.scanUsed) lines.push('> No schema scan was supplied, so steps that depend on the shape of the data (large objects, partitions, LONG columns) are absent. Run `oracle-assess-schema` and rebuild.');
  lines.push('');
  let n = 0;
  for (const ph of plan.phases) {
    if (!ph.items.length) continue;
    lines.push(`## ${ph.title}`, '', `*${ph.note}*`, '');
    for (const it of ph.items) {
      n++;
      lines.push(`- [ ] **${it.area}: ${it.title}** (${it.owner})`);
      lines.push(`  ${it.detail}`);
      const tail = it.sourceLinks.length ? `Sources: ${it.sourceLinks.map(link).join('; ')}` : `*Judgement${it.basis ? `: ${it.basis.replace(/^judgement:\s*/, '')}` : ''}*`;
      lines.push(`  ${tail}`);
    }
    lines.push('');
  }
  lines.push(`${n} steps. Owners are suggestions, not assignments. Nothing here is a cost estimate: the advisor does not size a target.`);
  return lines.join('\n') + '\n';
}
