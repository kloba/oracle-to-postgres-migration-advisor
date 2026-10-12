#!/usr/bin/env node
// Prints a Markdown document from this repository as a PDF: cover, contents, body.
//
//   node tools/pdf/build-doc.mjs docs/oracle-to-azure-postgresql-migration.md --out docs/oracle-to-azure-postgresql-migration.pdf \
//        --title "Oracle to Azure PostgreSQL migration" --subtitle "Knowledge base" [--date 2026-10-12] [--html-only]

import fs from 'node:fs';
import path from 'node:path';
import { markdownToHtml } from './markdown.mjs';
import { printToPdf, checkLayout } from './print.mjs';
import { BLUE, INK, INK2, MUTED, GRID } from '../report/charts.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const input = argv.find(a => !a.startsWith('--') && !['--out', '--title', '--subtitle', '--date'].includes(argv[argv.indexOf(a) - 1]));
if (!input) { console.error('usage: node tools/pdf/build-doc.mjs file.md --out file.pdf [--title T] [--subtitle S] [--date D] [--html-only]'); process.exit(1); }

const md = fs.readFileSync(input, 'utf8');
const firstH1 = /^#\s+(.*)$/m.exec(md)?.[1] || path.basename(input);
const title = opt('title', firstH1.replace(/`/g, ''));
const subtitle = opt('subtitle', 'Knowledge base');
const date = opt('date', new Date().toISOString().slice(0, 10));
const out = opt('out', input.replace(/\.md$/, '.pdf'));
const body = markdownToHtml(md.replace(/^#\s+.*\n/, ''));

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const CSS = `
:root{--ink:${INK};--ink2:${INK2};--muted:${MUTED};--grid:${GRID};--blue:${BLUE[450]};--navy:${BLUE[700]}}
*{box-sizing:border-box}
html{font:9.6pt/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0}
@page{size:A4;margin:19mm 16mm 17mm 16mm;@bottom-left{content:"${esc(title)}";font:7.5pt -apple-system,Helvetica,Arial,sans-serif;color:${MUTED}}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:7.5pt -apple-system,Helvetica,Arial,sans-serif;color:${MUTED}}}
@page cover{margin:0;@bottom-left{content:none}@bottom-right{content:none}}
.cover{page:cover;height:296.6mm;width:210mm;overflow:hidden;break-after:page;display:flex;flex-direction:column}
.cover-band{background:linear-gradient(135deg,${BLUE[700]} 0%,${BLUE[550]} 100%);color:#fff;padding:40mm 22mm 24mm}
.cover-kicker{font-size:11pt;letter-spacing:.08em;text-transform:uppercase;opacity:.85}
.cover h1{font-size:34pt;line-height:1.08;margin:6mm 0 4mm;font-weight:700;border:0;padding:0}
.cover-sub{font-size:16pt;font-weight:300;opacity:.95}
.cover-body{padding:14mm 22mm;font-size:10pt;color:var(--ink2);line-height:1.6}
.toc{break-after:page}
.toc h2{border:0}
.toc ol{columns:2;column-gap:10mm;padding-left:0;list-style:none;font-size:10pt}
.toc li{margin:0 0 1.6mm}
h1{font-size:20pt;margin:0 0 5mm}
h2{font-size:16pt;margin:9mm 0 4mm;font-weight:700;border-bottom:2px solid var(--navy);padding-bottom:2mm;break-after:avoid}
h3{font-size:12pt;margin:6.5mm 0 2mm;color:var(--navy);break-after:avoid}
h4{font-size:10.4pt;margin:5mm 0 1.5mm;color:var(--ink2);break-after:avoid}
p{margin:0 0 3mm}
a{color:var(--blue);text-decoration:none}
code{font:8.4pt ui-monospace,"SF Mono",Menlo,Consolas,monospace;background:#f1f0ec;border-radius:3px;padding:0 3px}
pre{background:#f6f5f1;border:1px solid var(--grid);border-radius:5px;padding:3mm 4mm;overflow:hidden;break-inside:avoid;margin:0 0 3mm}
pre code{background:none;padding:0;font-size:8pt;line-height:1.45;white-space:pre-wrap}
blockquote{border-left:4px solid var(--blue);background:#eef4fc;margin:0 0 3mm;padding:2.5mm 4mm;border-radius:0 6px 6px 0}
ul,ol{margin:0 0 3mm;padding-left:5.5mm}li{margin:0 0 1.4mm}
li.task{list-style:none;margin-left:-5mm}.box{font-size:10pt}
table{width:100%;border-collapse:collapse;margin:0 0 4mm;font-size:8.3pt}
th{text-align:left;font-weight:600;color:var(--ink2);border-bottom:1.5px solid var(--navy);padding:1.5mm 2mm;font-size:7.8pt}
td{padding:1.3mm 2mm;border-bottom:1px solid var(--grid);vertical-align:top}
tr{break-inside:avoid}thead{display:table-header-group}
hr{border:0;border-top:1px solid var(--grid);margin:5mm 0}
`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>
<section class="cover"><div class="cover-band"><div class="cover-kicker">${esc(subtitle)}</div><h1>${esc(title)}</h1><div class="cover-sub">Oracle Database to Azure Database for PostgreSQL</div></div>
<div class="cover-body"><p><b>Preliminary.</b> Everything in this document supports a provisional recommendation. It was read from vendor documentation on the date below and can change.</p><p>Generated ${esc(date)} from <code>${esc(path.relative(process.cwd(), input))}</code>.</p></div></section>
<section class="toc"><h2>Contents</h2><ol>${body.toc.map(t => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ol></section>
${body.html}</body></html>`;

const htmlPath = out.replace(/\.pdf$/, '.html');
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(htmlPath, html);
if (process.argv.includes('--html-only')) { console.log(`wrote ${htmlPath}`); process.exit(0); }
const layout = checkLayout(htmlPath);
if (layout && !layout.ok) console.error(`layout warning: content is wider than the page (${layout.scrollW}px against ${layout.W}px): ${layout.bad.join('; ')}`);
if (!printToPdf(htmlPath, out)) { console.error('No Chrome or Edge found; the HTML is written.'); process.exit(3); }
fs.rmSync(htmlPath, { force: true });
console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
