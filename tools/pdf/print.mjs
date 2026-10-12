// Prints an HTML file to PDF with headless Chrome or Edge, using a dedicated profile directory so a running
// browser, and any tool that shares its profile, is never touched.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
];

export const findBrowser = () => CHROMES.find(p => fs.existsSync(p)) || null;

export function printToPdf(htmlPath, pdfPath, { profileDir = '/tmp/o2p-report-chrome' } = {}) {
  const chrome = findBrowser();
  if (!chrome) return false;
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer', `--user-data-dir=${profileDir}`, `--print-to-pdf=${path.resolve(pdfPath)}`, '--virtual-time-budget=20000', 'file://' + path.resolve(htmlPath)], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 180000 });
  return true;
}

/**
 * Lays the HTML out in headless Chrome at A4 width and reports any element that sticks out to the right.
 * An overflowing element makes Chrome shrink the whole printout, which shows up as a cover that no longer
 * reaches the edge of the page. Returns null when no browser is available.
 */
export function checkLayout(htmlPath, { profileDir = '/tmp/o2p-layout-chrome' } = {}) {
  const chrome = findBrowser();
  if (!chrome) return null;
  const probe = `<script>window.addEventListener('load',()=>{const W=window.innerWidth;const bad=[];document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect();if(r.width>0&&r.right>W+2)bad.push(e.tagName+'.'+(e.className||'')+' right='+Math.round(r.right)+' of '+W);});const d=document.createElement('pre');d.id='layout-probe';d.textContent=JSON.stringify({W,scrollW:document.documentElement.scrollWidth,bad:bad.slice(0,6)});document.body.appendChild(d);});</script>`;
  const tmp = path.join(path.dirname(path.resolve(htmlPath)), `.layout-probe-${process.pid}.html`);
  fs.writeFileSync(tmp, fs.readFileSync(htmlPath, 'utf8').replace('</body>', probe + '</body>'));
  try {
    const dom = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${profileDir}`, '--virtual-time-budget=8000', '--window-size=794,1123', '--dump-dom', 'file://' + tmp], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000, maxBuffer: 64 * 1024 * 1024 }).toString();
    const m = /<pre id="layout-probe">([^<]*)<\/pre>/.exec(dom);
    if (!m) return null;
    const r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    return { ok: r.scrollW <= r.W + 2 && r.bad.length === 0, ...r };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
