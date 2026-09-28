// tests/phylo-sunburst.mjs — #/arbol, vista "Sunburst" (Fase 3, C3): sobre el
// árbol NJ de ejemplo, 16 sectores hoja + 16 etiquetas + un sector por clado
// interno; los ángulos de las hojas suman 360° y cada clado abarca EXACTAMENTE
// las hojas que dice su título (coherencia jerárquica); nota propia (no la del
// rectangular). Rectangular y Circular siguen dibujando las 16 hojas.
//
//   node tests/phylo-sunburst.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'phylo-sunburst' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };
const click = (re) => c.ev(`(() => { const b = [...document.querySelectorAll('#app-view .ql-seg-btn')].find((x) => ${re}.test(x.textContent)); if (b) b.click(); return !!b; })()`);

try {
  await c.goto(server.url + '/index.html#/arbol'); await sleep(1500);
  await c.ev(`[...document.querySelectorAll('button')].find((x) => /Cargar ejemplo|Load example/.test(x.textContent))?.click()`);
  for (let i = 0; i < 80; i++) { if (await c.ev(`document.querySelectorAll('svg.ql-svg text.ql-phylo-leaflabel').length === 16`)) break; await sleep(250); }
  check('"Disposición del árbol" ofrece "Sunburst"', await click('/^Sunburst$/'));
  await sleep(1500);
  const r = await c.ev(`(() => {
    const svg = document.querySelector('#app-view svg.ql-svg');
    const vb = svg.viewBox.baseVal, cx = vb.width / 2, cy = vb.height / 2;
    const ang = (x, y) => { let a = Math.atan2(x - cx, cy - y); if (a < 0) a += 2 * Math.PI; return a; };
    // arcPath: 'M pi0 L po0 A r r 0 large 1 po1 …' → po0 = [2,3], po1 = [9,10]
    const arc = (p) => { const n = p.getAttribute('d').match(/-?[\\d.]+/g).map(Number); const a0 = ang(n[2], n[3]); let s = ang(n[9], n[10]) - a0; if (s <= 0) s += 2 * Math.PI; return { a0, s }; };
    const leaves = [...svg.querySelectorAll('path.ql-phylo-sb-leaf')];
    const clades = [...svg.querySelectorAll('path.ql-phylo-sb-clade')];
    const mids = leaves.map((p) => { const a = arc(p); return a.a0 + a.s / 2; });
    let bad = 0;
    clades.forEach((p) => {
      const n = +p.querySelector('title').textContent.match(/(\\d+)/)[1];
      const { a0, s } = arc(p);
      if (mids.filter((m) => { let d = m - a0; if (d < 0) d += 2 * Math.PI; return d < s; }).length !== n) bad++;
    });
    return {
      leaves: leaves.length, clades: clades.length,
      labels: svg.querySelectorAll('text.ql-phylo-leaflabel').length,
      sumDeg: leaves.reduce((a, p) => a + arc(p).s, 0) * 180 / Math.PI, bad,
      note: [...document.querySelectorAll('#app-view .ql-panel-note')].map((x) => x.textContent).join(' | '),
    };
  })()`);
  check('16 sectores hoja y 16 etiquetas', r.leaves === 16 && r.labels === 16, JSON.stringify(r));
  check('un sector por clado interno (13 = 14 nodos internos − la raíz)', r.clades === 13, String(r.clades));
  check('los ángulos de las hojas suman 360°', Math.abs(r.sumDeg - 360) < 0.5, r.sumDeg.toFixed(2));
  check('cada clado abarca exactamente las hojas que declara', r.bad === 0, String(r.bad));
  check('nota propia del sunburst (no la del rectangular)', /Sunburst/.test(r.note) && !/Cladograma rectangular/.test(r.note), r.note.slice(0, 120));
  for (const re of ['/^Circular$/', '/^Rectangular$/']) {
    await click(re); await sleep(1200);
    check(re + ' sigue dibujando las 16 hojas', (await c.ev(`document.querySelectorAll('svg.ql-svg text.ql-phylo-leaflabel').length`)) === 16);
  }
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
