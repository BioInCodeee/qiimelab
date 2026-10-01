
// tests/phylo-layouts.mjs — #/arbol: el selector "Disposición del árbol" ofrece
// solo Rectangular y Circular (la vista Sunburst se retiró a propósito, igual
// que la radial antes), y ambas dibujan las 16 hojas del árbol NJ de ejemplo.
//
//   node tests/phylo-layouts.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'phylo-layouts' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };
const click = (re) => c.ev(`(() => { const b = [...document.querySelectorAll('#app-view .ql-seg-btn')].find((x) => ${re}.test(x.textContent)); if (b) b.click(); return !!b; })()`);

try {
  await c.goto(server.url + '/index.html#/arbol'); await sleep(1500);
  await c.ev(`[...document.querySelectorAll('button')].find((x) => /Cargar ejemplo|Load example/.test(x.textContent))?.click()`);
  for (let i = 0; i < 80; i++) { if (await c.ev(`document.querySelectorAll('svg.ql-svg text.ql-phylo-leaflabel').length === 16`)) break; await sleep(250); }
  check('"Disposición del árbol" ya no ofrece "Sunburst"', !(await c.ev(`[...document.querySelectorAll('#app-view .ql-seg-btn')].some((x) => /Sunburst/i.test(x.textContent))`)));
  check('ofrece Rectangular y Circular', (await click('/^Rectangular$/')) && (await click('/^Circular$/')));
  for (const re of ['/^Circular$/', '/^Rectangular$/']) {
    await click(re); await sleep(1200);
    check(re + ' dibuja las 16 hojas', (await c.ev(`document.querySelectorAll('svg.ql-svg text.ql-phylo-leaflabel').length`)) === 16);
  }
  check('sin elementos del sunburst en el SVG', (await c.ev(`document.querySelectorAll('svg.ql-svg .ql-phylo-sunburst, svg.ql-svg path.ql-phylo-sb-leaf').length`)) === 0);
  check('sin errores de consola', c.problems.length === 0, c.problems.join('; '));
} catch (e) {
  console.error('EXCEPCIÓN:', e.message);
  failed = true;
} finally {
  c.kill();
  if (server.started) server.stop();
}
console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
