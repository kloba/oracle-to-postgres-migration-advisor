// SVG chart primitives for the assessment report.
//
// Built to the dataviz skill's method: one axis, thin marks with 4px rounded data-ends anchored to the
// baseline, a 2px surface gap between stacked fills, recessive grid and axes, direct value labels, and
// text in ink tokens rather than in the series color. Class severity uses the fixed status palette, which
// is never enough on its own: every use carries a label, a glyph, and (for print) a 45 or 135 degree texture.

export const INK = '#0b0b0b';
export const INK2 = '#52514e';
export const MUTED = '#898781';
export const GRID = '#e1e0d9';
export const AXIS = '#c3c2b7';
export const SURFACE = '#fcfcfb';

// Sequential blue, light to dark.
export const BLUE = { 100: '#cde2fb', 150: '#b7d3f6', 200: '#9ec5f4', 250: '#86b6ef', 300: '#6da7ec', 350: '#5598e7', 400: '#3987e5', 450: '#2a78d6', 500: '#256abf', 550: '#1c5cab', 600: '#184f95', 650: '#104281', 700: '#0d366b' };

// Fixed status palette. Warning and serious sit under 3:1 on a light surface by design.
export const STATUS = { CLEAN: '#0ca30c', PARTIAL: '#fab219', REVIEW: '#ec835a', BLOCKER: '#d03b3b' };
export const STATUS_TINT = { CLEAN: '#e3f5e3', PARTIAL: '#fff2d1', REVIEW: '#fde5da', BLOCKER: '#f7d9d9' };
export const GLYPH = { CLEAN: '●', PARTIAL: '▲', REVIEW: '◆', BLOCKER: '■' };
export const CLASSES = ['CLEAN', 'PARTIAL', 'REVIEW', 'BLOCKER'];

export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const fmt = n => (typeof n === 'number' ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(n));
export const fmt1 = n => n.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** SVG pattern defs for the class textures: none, 45, 135, dense 45. Tone-on-tone, drawn once per chart. */
export function patternDefs(id) {
  const line = (angle, gap, color) => `<pattern id="${id}-${angle}-${gap}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})"><line x1="0" y1="0" x2="0" y2="${gap}" stroke="${color}" stroke-width="1.6" stroke-opacity=".55"/></pattern>`;
  return `<defs>${line(45, 5, '#0b0b0b')}${line(135, 5, '#0b0b0b')}${line(45, 3, '#0b0b0b')}</defs>`;
}
const TEXTURE = { CLEAN: null, PARTIAL: [45, 5], REVIEW: [135, 5], BLOCKER: [45, 3] };

function rect(x, y, w, h, fill, extra = '', r = 0) {
  if (w <= 0) return '';
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${r}" fill="${fill}" ${extra}/>`;
}

/** A bar whose data-end (right side) is rounded 4px and whose base sits square on the baseline. */
function barPath(x, y, w, h, fill) {
  if (w <= 0) return '';
  const r = Math.min(4, w, h / 2);
  return `<path d="M${x.toFixed(1)} ${y.toFixed(1)}h${(w - r).toFixed(1)}a${r} ${r} 0 0 1 ${r} ${r}v${(h - 2 * r).toFixed(1)}a${r} ${r} 0 0 1 -${r} ${r}h-${(w - r).toFixed(1)}z" fill="${fill}"/>`;
}

/**
 * Horizontal bars, one series. Emphasis through one hue; values labelled directly.
 * items: [{label, value, sub?}]
 */
export function hbar(items, { width = 640, labelWidth = 190, rowH = 22, gap = 8, color = BLUE[450], valueFmt = fmt, max, emphasis = null } = {}) {
  const m = max ?? Math.max(...items.map(i => i.value), 1);
  const plotW = width - labelWidth - 96;
  const h = items.length * (rowH + gap) + 6;
  let out = `<svg viewBox="0 0 ${width} ${h}" width="100%" role="img" aria-label="Bar chart" style="font-size:11px">`;
  out += `<line x1="${labelWidth}" y1="0" x2="${labelWidth}" y2="${h - 4}" stroke="${AXIS}" stroke-width="1"/>`;
  items.forEach((it, i) => {
    const y = i * (rowH + gap) + 3;
    const w = (it.value / m) * plotW;
    const fill = emphasis && !emphasis(it) ? '#b9b8b1' : color;
    out += `<text x="${labelWidth - 8}" y="${y + rowH / 2 + 4}" text-anchor="end" fill="${INK2}">${esc(it.label)}</text>`;
    out += barPath(labelWidth, y, w, rowH, fill);
    const valText = esc(valueFmt(it.value));
    out += `<text x="${labelWidth + w + 6}" y="${y + rowH / 2 + 4}" fill="${INK}" font-weight="600">${valText}</text>`;
    if (it.sub) out += `<text x="${labelWidth + w + 6 + valText.length * 6.8 + 8}" y="${y + rowH / 2 + 4}" fill="${MUTED}">${esc(it.sub)}</text>`;
  });
  return out + '</svg>';
}

/**
 * Horizontal stacked bars over the four severity classes. A 2px surface gap separates fills, each class has a
 * texture for print, and the count is written inside a segment only when the segment is wide enough to hold it.
 * rows: [{label, counts: {CLEAN, PARTIAL, REVIEW, BLOCKER}}]
 */
export function stackedClassBars(rows, { width = 640, labelWidth = 150, rowH = 22, gap = 9, normalise = false, uid = 'sc' } = {}) {
  const plotW = width - labelWidth - 56;
  const totals = rows.map(r => CLASSES.reduce((a, c) => a + (r.counts[c] || 0), 0));
  const maxT = Math.max(...totals, 1);
  const h = rows.length * (rowH + gap) + 6;
  let out = `<svg viewBox="0 0 ${width} ${h}" width="100%" role="img" aria-label="Stacked bar chart by severity class" style="font-size:11px">${patternDefs(uid)}`;
  out += `<line x1="${labelWidth}" y1="0" x2="${labelWidth}" y2="${h - 4}" stroke="${AXIS}" stroke-width="1"/>`;
  rows.forEach((r, i) => {
    const y = i * (rowH + gap) + 3;
    const scale = normalise ? plotW / (totals[i] || 1) : plotW / maxT;
    let x = labelWidth;
    out += `<text x="${labelWidth - 8}" y="${y + rowH / 2 + 4}" text-anchor="end" fill="${INK2}">${esc(r.label)}</text>`;
    CLASSES.forEach((c, k) => {
      const v = r.counts[c] || 0;
      if (!v) return;
      const w = Math.max(v * scale - 2, 0);
      const last = !CLASSES.slice(k + 1).some(cc => r.counts[cc]);
      const t = TEXTURE[c];
      out += last ? barPath(x, y, w, rowH, STATUS[c]) : rect(x, y, w, rowH, STATUS[c]);
      if (t) out += last ? barPath(x, y, w, rowH, `url(#${uid}-${t[0]}-${t[1]})`) : rect(x, y, w, rowH, `url(#${uid}-${t[0]}-${t[1]})`);
      if (w > 24) out += `<text x="${x + w / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" fill="${INK}" font-weight="700" style="paint-order:stroke;stroke:${STATUS[c]};stroke-width:3px;stroke-linejoin:round">${v}</text>`;
      x += w + 2;
    });
    out += `<text x="${x + 4}" y="${y + rowH / 2 + 4}" fill="${MUTED}">${fmt(totals[i])}</text>`;
  });
  return out + '</svg>';
}

/** Legend for the four classes: glyph, texture swatch and word, so nothing relies on color alone. */
export function classLegend(uid = 'lg') {
  const sw = c => {
    const t = TEXTURE[c];
    return `<svg width="22" height="12" viewBox="0 0 22 12" style="vertical-align:-2px">${patternDefs(uid + c)}<rect width="22" height="12" rx="2" fill="${STATUS[c]}"/>${t ? `<rect width="22" height="12" rx="2" fill="url(#${uid + c}-${t[0]}-${t[1]})"/>` : ''}</svg>`;
  };
  return `<div class="legend">${CLASSES.map(c => `<span>${sw(c)} <b>${GLYPH[c]} ${c}</b></span>`).join('')}</div>`;
}

/** Heat grid: counts shaded on the sequential blue ramp, the number always printed. */
export function heatGrid(rowLabels, colLabels, matrix, { cellW = 74, cellH = 26, labelW = 150, headH = 34 } = {}) {
  const w = labelW + colLabels.length * cellW + 4;
  const h = headH + rowLabels.length * cellH + 4;
  const maxV = Math.max(...matrix.flat(), 1);
  const ramp = [BLUE[100], BLUE[150], BLUE[200], BLUE[250], BLUE[300], BLUE[350], BLUE[400], BLUE[450], BLUE[500], BLUE[550], BLUE[600]];
  let out = `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Heat grid" style="font-size:11px">`;
  colLabels.forEach((c, j) => { out += `<text x="${labelW + j * cellW + cellW / 2}" y="${headH - 10}" text-anchor="middle" fill="${INK2}" font-weight="600">${esc(c)}</text>`; });
  rowLabels.forEach((r, i) => {
    const y = headH + i * cellH;
    out += `<text x="${labelW - 8}" y="${y + cellH / 2 + 4}" text-anchor="end" fill="${INK2}">${esc(r)}</text>`;
    colLabels.forEach((_, j) => {
      const v = matrix[i][j];
      const x = labelW + j * cellW;
      if (!v) { out += rect(x + 1, y + 1, cellW - 2, cellH - 2, '#f3f2ee', '', 3); out += `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 4}" text-anchor="middle" fill="${MUTED}">·</text>`; return; }
      const idx = Math.min(ramp.length - 1, Math.floor((Math.log1p(v) / Math.log1p(maxV)) * (ramp.length - 1)));
      const dark = idx >= 6;
      out += rect(x + 1, y + 1, cellW - 2, cellH - 2, ramp[idx], '', 3);
      out += `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 4}" text-anchor="middle" fill="${dark ? '#ffffff' : INK}" font-weight="600">${fmt(v)}</text>`;
    });
  });
  return out + '</svg>';
}

/** A single ratio against a limit, as a meter on a same-ramp track. */
export function meter(value, { width = 220, label = '', color = BLUE[450] } = {}) {
  const w = Math.max(0, Math.min(1, value)) * (width - 4);
  return `<svg viewBox="0 0 ${width} 14" width="${width}" height="14" role="img" aria-label="${esc(label)} ${(value * 100).toFixed(0)}%"><rect x="0" y="3" width="${width}" height="8" rx="4" fill="${BLUE[100]}"/>${w > 0 ? `<rect x="0" y="3" width="${w.toFixed(1)}" height="8" rx="4" fill="${color}"/>` : ''}</svg>`;
}

/** Stat tile: one headline number, a label and a caveat. */
export function statTile(value, label, sub = '') {
  return `<div class="tile"><div class="tile-v">${esc(value)}</div><div class="tile-l">${esc(label)}</div>${sub ? `<div class="tile-s">${esc(sub)}</div>` : ''}</div>`;
}

export function chip(cls) {
  return `<span class="chip chip-${cls}"><i>${GLYPH[cls]}</i>${cls}</span>`;
}

/** Eligibility state chip. Never color alone: the state is written out. */
export const STATE_STYLE = {
  eligible: ['#e3f5e3', '#006300', '✓ eligible'],
  eligible_with_remediation: ['#fff2d1', '#6b4a00', '◐ eligible with remediation'],
  unknown_requires_assessment: ['#e8eef9', '#184f95', '? unknown, needs assessment'],
  excluded_by_preference: ['#ece9f7', '#4a3aa7', '⊘ excluded by preference'],
  unsupported: ['#f7d9d9', '#8f1f1f', '✕ unsupported'],
};
export function stateChip(state) {
  const [bg, fg, text] = STATE_STYLE[state] || ['#eee', INK, state];
  return `<span class="state" style="background:${bg};color:${fg}">${esc(text)}</span>`;
}
