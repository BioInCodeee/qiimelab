// Reenraizado del árbol por cepa de referencia (#/arbol): una tercera
// opción junto a "Sin enraizar"/"Enraizado (punto medio)" que despliega un
// selector con las hojas del árbol y reenraiza por outgroup en la elegida
// -- generaliza `midpointRoot` (js/lib/neighborJoining.js) vía la nueva
// `rerootAtLeaf`, que ya se valida matemáticamente en tests/phylonni.mjs
// (longitud total conservada, hoja de referencia equidistante a mitad de
// su propia rama, funciona directamente sobre un árbol SIN enraizar antes
// -- este test cubre la parte de INTERFAZ: el selector aparece, reenraiza
// de verdad el árbol dibujado, y la exportación a Newick refleja la nueva
// raíz.
//
//   node tests/phylo-reroot.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'phylo-reroot' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };
// espera activa (no un sleep fijo) a que `expr` sea verdadera; si no llega,
// para con un mensaje de precondición en vez de seguir y reventar con
// "Cannot set properties of null" más abajo (fallo de la auditoría del
// 27 sep: el síntoma encaja con una pestaña en chrome-error:// o con un
// servidor ajeno en :8931 sirviendo un checkout viejo — ver server-smoke)
const waitFor = async (expr, what, ms = 20000) => {
  for (let t = 0; t < ms; t += 200) {
    if (await c.ev(expr).catch(() => false)) return;
    await sleep(200);
  }
  const where = await c.ev('location.href').catch(() => '?');
  throw new Error(`PRECONDICIÓN: ${what} no apareció en ${ms / 1000}s (página: ${where})`);
};

try {
  await c.goto();
  await sleep(1500);
  await c.ev(`location.hash = '#/arbol'`);
  await sleep(1000);
  await waitFor(`[...document.querySelectorAll('button')].some((x) => /Cargar ejemplo|Load example/.test(x.textContent))`, 'el botón "Cargar ejemplo" de #/arbol');
  await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Cargar ejemplo|Load example/.test(x.textContent)); if (b) b.click(); })()`);
  // el alineamiento corre en un worker: esperar al árbol dibujado y a los controles de enraizado
  await waitFor(`document.querySelectorAll('svg.ql-svg text.ql-phylo-leaflabel').length === 16 && [...document.querySelectorAll('.ql-seg-btn')].some((b) => /Sin enraizar|Unrooted/.test(b.textContent))`, 'el árbol de ejemplo (16 hojas) con los controles de enraizado');

  // ================= "sin enraizar" es el estado inicial por defecto =================
  console.log('-- estado inicial: árbol sin enraizar --');
  const initial = await c.ev(`(() => {
    const on = [...document.querySelectorAll('.ql-seg-btn')].find((b) => b.classList.contains('is-on') && /Sin enraizar|Unrooted/.test(b.textContent));
    return { unrootedActive: !!on };
  })()`);
  check('el árbol de ejemplo arranca "Sin enraizar" (comportamiento por defecto, sin cambios)', initial.unrootedActive, JSON.stringify(initial));

  // ================= elegir "Enraizado (cepa de referencia)" despliega el selector =================
  console.log('\n-- elegir "cepa de referencia" despliega el selector de hojas --');
  await c.ev(`(() => { const b = [...document.querySelectorAll('.ql-seg-btn')].find((x) => /cepa de referencia|reference strain/i.test(x.textContent)); if (b) b.click(); })()`);
  await waitFor(`!!document.querySelector('#phylo-reference-leaf')`, 'el selector de hoja de referencia', 8000).catch((e) => console.log('  · ' + e.message));
  const selectorSetup = await c.ev(`(() => {
    const sel = document.querySelector('#phylo-reference-leaf');
    if (!sel) return { err: 'no apareció el selector de hoja de referencia' };
    return { n: sel.options.length, hasActinomyces: [...sel.options].some((o) => o.value === 'Actinomyces') };
  })()`);
  check('el selector de hoja de referencia aparece con las 16 hojas del árbol de ejemplo (+ opción vacía)',
    selectorSetup.n === 17 && selectorSetup.hasActinomyces, JSON.stringify(selectorSetup));

  // ================= elegir una hoja reenraiza de verdad (directamente, sin pasar por punto medio) =================
  console.log('\n-- elegir "Actinomyces" como referencia reenraiza el árbol (sin enraizar -> referencia, directo) --');
  await c.ev(`(() => {
    const sel = document.querySelector('#phylo-reference-leaf');
    sel.value = 'Actinomyces';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(800);

  const newick = await c.ev(`(() => {
    const pre = document.querySelector('.ql-code');
    return pre ? pre.textContent.trim() : null;
  })()`);
  check('el Newick exportado arranca con la cepa de referencia como primer hijo directo de la raíz (grupo externo)',
    !!newick && /^\(Actinomyces:-?[\d.]+,/.test(newick), newick ? newick.slice(0, 60) : null);

  const svgRootCheck = await c.ev(`(() => {
    // con la raíz reenraizada, el árbol dibujado sigue teniendo las 16 hojas
    // (ninguna se pierde ni se duplica al reconstruir la topología)
    const labels = [...document.querySelectorAll('svg.ql-svg text.ql-phylo-leaflabel')].map((t) => t.textContent);
    return { n: labels.length, hasActinomyces: labels.includes('Actinomyces') };
  })()`);
  check('el árbol dibujado sigue teniendo las 16 hojas tras reenraizar (ninguna se pierde)',
    svgRootCheck.n === 16 && svgRootCheck.hasActinomyces, JSON.stringify(svgRootCheck));

  // ================= volver a "sin referencia elegida" no rompe nada =================
  console.log('\n-- quitar la referencia elegida vuelve al árbol sin reenraizar por outgroup --');
  const cleared = await c.ev(`(() => {
    const sel = document.querySelector('#phylo-reference-leaf');
    sel.value = '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`);
  await sleep(500);
  const afterClear = await c.ev(`(() => {
    const labels = [...document.querySelectorAll('svg.ql-svg text.ql-phylo-leaflabel')].map((t) => t.textContent);
    return { n: labels.length };
  })()`);
  check('quitar la hoja de referencia (selector vacío) sigue dibujando las 16 hojas sin errores', afterClear.n === 16, JSON.stringify({ cleared, afterClear }));

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
