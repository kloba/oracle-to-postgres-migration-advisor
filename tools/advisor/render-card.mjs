// Renders the recommendation card in Markdown, as described in reference/output-contract.md section 4.
// The card is a faithful rendering of the engine's output object: it adds no field that object does not have.

const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const list = items => items.map(i => `- ${i}`).join('\n');

const REDESIGN_LABELS = { redesign: 'redesign', workaround: 'workaround' };

function clip(text, n) {
  if (text.length <= n) return text;
  const cut = text.slice(0, n);
  const sentence = cut.lastIndexOf('. ');
  if (sentence > n * 0.55) return cut.slice(0, sentence + 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:(]$/, '') + '…';
}

export function renderCard(out, { name = 'Oracle estate', evaluatedAt = null } = {}) {
  const m = out.metadata;
  const rec = out.recommendation;
  const lines = [];
  const stamp = evaluatedAt ? ` · evaluated **${evaluatedAt}**` : '';

  lines.push(`> **Preliminary recommendation: ${name}**`);
  if (rec) {
    const base = 'PostgreSQL';
    lines.push(`> **${rec.label.toUpperCase()}** on ${base} ${rec.postgresMajor} · status **${m.recommendationStatus}** · confidence **${m.confidence}**`);
  } else {
    lines.push(`> **No single target can be named yet** · status **${m.recommendationStatus}** · confidence **${m.confidence}**`);
  }
  lines.push(`> KB **${m.knowledgeBaseVersion}** · rules **${m.decisionRulesVersion}**${stamp}`);
  lines.push('');

  if (rec) {
    lines.push(`${rec.why} Rule \`${rec.ruleId}\`.`);
    if (rec.postgresVersionNote) lines.push('', `*Version:* ${rec.postgresVersionNote}`);
    lines.push('');
    const s = out.selectedMethods;
    if (s) {
      const route = id => (id ? `\`${id}\`` : 'no Microsoft route (see Gaps)');
      lines.push(`**Schema and code:** ${route(s.schemaConversion)} · **Data:** ${route(s.dataMovement)} (${s.dataFamily}) · **Cutover downtime:** ${s.cutoverDowntime}`);
      lines.push('');
      lines.push('*No Microsoft service moves Oracle rows to PostgreSQL by change capture, and the Microsoft converter converts schema and code only. The routes named here are Microsoft\'s own; where there is none, the card says so and names no product.*');
      lines.push('');
    }
  } else if (out.shortlist) {
    lines.push('No rule separates the candidates below, or a better-ranked candidate is held on an unanswered question, so the advisor does not invent a winner.', '');
    lines.push('| Family | State | Why it stands or does not | What would separate it |', '|---|---|---|---|');
    for (const s of out.shortlist) lines.push(`| ${cell(s.label)} | ${s.state} | ${cell(clip(s.why, 200))} | ${cell(s.separatedBy)} |`);
    lines.push('');
  }

  lines.push('| Target | State | Rule | Why |', '|---|---|---|---|');
  for (const [target, e] of Object.entries(out.eligibilityTrace)) {
    const label = out.recommendation && out.recommendation.target === target ? `**${cell(labelOf(out, target))}**` : cell(labelOf(out, target));
    lines.push(`| ${label} | ${e.state} | ${e.ruleId ? `\`${e.ruleId}\`` : 'none'} | ${cell(clip(e.reason, 220))} |`);
  }
  lines.push('');

  if (!out.alternative && rec) lines.push('**Alternative:** none named. No other family survives the rules, and the advisor does not reach for a product from outside Microsoft.', '');
  if (out.alternative) lines.push(`**Alternative:** ${out.alternative.label}, which ${out.alternative.wins.replace(/^wins /, 'wins ')}.`, '');

  const rem = rec?.remediation;
  if (rem && (rem.redesign.length || rem.workaround.length || rem.unknown.length)) {
    lines.push('**What the chosen target needs from the application.**', '');
    lines.push('| Oracle feature | Carried as | How |', '|---|---|---|');
    for (const state of ['redesign', 'workaround', 'unknown']) for (const r of rem[state]) lines.push(`| ${cell(r.label)} | ${REDESIGN_LABELS[state] || state} | ${cell(r.note || 'not documented by the vendor')} |`);
    lines.push('');
  }

  if (out.methodGaps?.length) lines.push('**Gaps: what Microsoft has no product for.** No substitute is named.', '', list(out.methodGaps.map(g => `\`${g.id}\` (\`${g.ruleId}\`): ${g.text}`)), '');
  if (out.blockers.length) lines.push('**Blockers.** ' + out.blockers.map(b => `${b.label} (${b.why})`).join('; ') + '.', '');
  if (out.unknowns.length) {
    lines.push('**Unknowns and the evidence that would settle them.**', '');
    lines.push(list(out.unknowns.map(u => `\`${u.field}\`: ${u.why}`)), '');
  }
  if (out.evidenceRequired.length) {
    const extra = out.evidenceRequired.filter(e => !out.unknowns.some(u => u.field === e.field));
    if (extra.length) lines.push('**Evidence to collect.**', '', list(extra.map(e => `\`${e.field}\`: ${e.evidence}`)), '');
  }
  if (out.assumptions.length) lines.push('**Assumed because a capacity answer was missing.** ' + out.assumptions.join(' '), '');
  lines.push(`**Largest risk.** ${out.largestRisk} Converted is not equivalent: every converted object needs independent testing.`, '');
  if (out.notes.length) lines.push('**Notes.**', '', list(out.notes), '');
  lines.push('**Next actions.**', '', out.nextActions.map((a, i) => `${i + 1}. ${a}`).join('\n'), '');
  lines.push('**Cost levers.** No cost figure is given: a figure needs measured sizing and stated pricing assumptions.', '', list(out.costLevers), '');
  lines.push('**Programme fit.** Quote both programme names where they differ, and confirm eligibility with the programme owner.', '', list(out.programmeFit), '');
  lines.push(`**Never recommended.** ${out.retired.map(r => `${r.item} (use ${r.use})`).join('; ')}.`, '');
  lines.push('*Volatile facts on this card (regions where zone-redundant HA is blocked, HorizonDB status, programme names and funding) were read on the date in the knowledge base. Confirm them before promising any of them.*');
  return lines.join('\n') + '\n';
}

import { RULES } from './engine.mjs';
const LABELS = Object.fromEntries(Object.entries(RULES.targets).map(([k, v]) => [k, v.label]));
function labelOf(out, target) {
  return LABELS[target] || target;
}
