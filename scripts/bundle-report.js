// Bundle analysis: the size of every file the page downloads from this app
// (raw and gzipped, which is what travels), largest first, against a budget
// per kind. Run after the stylesheet is built:
//   npm run analyze            # builds public/tailwind.css, then reports
//   npm run analyze -- --check # also exits 1 when a budget is exceeded
// The platform's hosted files (/usernode-*) are not counted: they are shared
// by every app and cached by the browser.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PUBLIC = path.resolve(__dirname, '..', 'public');

// Gzipped bytes per kind. A Lighthouse mobile score of 90+ needs the first
// load small: keep scripts and the stylesheet well under these.
const BUDGETS = { js: 40 * 1024, css: 20 * 1024, html: 10 * 1024, other: 10 * 1024 };

function kind(file) {
  const ext = path.extname(file);
  if (ext === '.js') return 'js';
  if (ext === '.css') return 'css';
  if (ext === '.html') return 'html';
  return 'other';
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

function kb(n) {
  return (n / 1024).toFixed(1).padStart(7) + ' KB';
}

const files = walk(PUBLIC)
  .filter((f) => /\.(js|css|html|webmanifest)$/.test(f))
  .map((f) => {
    const buf = fs.readFileSync(f);
    return { file: path.relative(PUBLIC, f), kind: kind(f), raw: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length };
  })
  .sort((a, b) => b.gzip - a.gzip);

if (!files.some((f) => f.file === 'tailwind.css')) {
  console.warn('public/tailwind.css is missing: run npm run build:css first (npm run analyze does).');
}

console.log('File'.padEnd(32) + 'Raw'.padStart(10) + 'Gzip'.padStart(10));
for (const f of files) console.log(f.file.padEnd(32) + kb(f.raw) + kb(f.gzip));

let over = false;
console.log('\nBy kind (gzip, budget)');
for (const k of Object.keys(BUDGETS)) {
  const total = files.filter((f) => f.kind === k).reduce((n, f) => n + f.gzip, 0);
  const ok = total <= BUDGETS[k];
  if (!ok) over = true;
  console.log(k.padEnd(32) + kb(total) + kb(BUDGETS[k]) + (ok ? '' : '  OVER BUDGET'));
}

if (over && process.argv.includes('--check')) process.exit(1);
