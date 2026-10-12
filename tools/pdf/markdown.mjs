// A small Markdown to HTML converter for the documents in this repository: headings, paragraphs, emphasis, code,
// links, ordered and unordered lists (nested), task lists, tables, block quotes, fenced code and rules. It is not
// a general Markdown engine and does not try to be one.

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const slug = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function inline(src) {
  const codes = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${esc(c)}</code>`); return `@@C${codes.length - 1}@@`; });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u.replace(/"/g, '&quot;')}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  return s.replace(/@@C(\d+)@@/g, (_, i) => codes[Number(i)]);
}

function parseTable(lines, i) {
  const row = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
  const head = row(lines[i]);
  let j = i + 2;
  const body = [];
  while (j < lines.length && /^\s*\|/.test(lines[j])) body.push(row(lines[j++]));
  const html = `<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return [html, j];
}

const LIST_ITEM = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;

function parseList(lines, i) {
  const items = [];
  const base = lines[i].match(/^(\s*)/)[1].length;
  const ordered = /^\s*\d+[.)]\s/.test(lines[i]);
  let j = i;
  while (j < lines.length) {
    const m = LIST_ITEM.exec(lines[j]);
    if (!m || m[1].length < base) break;
    if (m[1].length > base) {
      const [sub, next] = parseList(lines, j);
      items[items.length - 1].sub += sub;
      j = next;
      continue;
    }
    const item = { text: m[3], sub: '' };
    j++;
    while (j < lines.length && lines[j].trim() && !LIST_ITEM.test(lines[j]) && /^\s+\S/.test(lines[j])) item.text += ' ' + lines[j++].trim();
    items.push(item);
    while (j < lines.length && !lines[j].trim() && j + 1 < lines.length && LIST_ITEM.test(lines[j + 1]) && lines[j + 1].match(/^(\s*)/)[1].length >= base) j++;
  }
  const tag = ordered ? 'ol' : 'ul';
  const li = it => {
    const task = /^\[( |x)\]\s+(.*)$/.exec(it.text);
    const body = task ? `<span class="box">${task[1] === 'x' ? '&#9745;' : '&#9744;'}</span> ${inline(task[2])}` : inline(it.text);
    return `<li${task ? ' class="task"' : ''}>${body}${it.sub}</li>`;
  };
  return [`<${tag}>${items.map(li).join('')}</${tag}>`, j];
}

export function markdownToHtml(md) {
  const lines = md.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out = [];
  const toc = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code class="lang-${fence[1]}">${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const id = slug(h[2]);
      if (level === 2) toc.push({ id, text: h[2].replace(/`/g, '') });
      out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) { const [html, j] = parseTable(lines, i); out.push(html); i = j; continue; }
    if (LIST_ITEM.test(line)) { const [html, j] = parseList(lines, i); out.push(html); i = j; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { out.push('<hr>'); i++; continue; }
    const buf = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*\|)/.test(lines[i]) && !LIST_ITEM.test(lines[i])) buf.push(lines[i++].trim());
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return { html: out.join('\n'), toc };
}
