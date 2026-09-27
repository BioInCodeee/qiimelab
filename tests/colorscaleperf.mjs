// Rendimiento del repintado disparado por el panel "Escala de color" (Paso
// 5 de qiimelab-prompt-editor-fase-3-heatmaps-escalas-continuas.md) —
// MEDICIÓN, no adivinación, mismo método que tests/perf-stress.mjs
// (performance.now() + jank = hueco máximo entre frames de rAF), pero
// perf-stress.mjs mide solo el CÓMPUTO puro (upgma()/leafOrder() llamados
// directamente); este test pasa por el pintado real de la app — un dataset
// grande inyectado en state.betaDiversity vía addBetaMetric(), navegación a
// #/beta, y el evento 'change' real del selector de paleta del panel.
//
// El caso relevante para el Paso 5 no es "cuánto tarda el primer pintado"
// (eso ya lo cubre perf-stress.mjs para el UPGMA) sino "cuánto tarda
// RECOLOREAR tras el primero" — betaDiversity.js cachea el árbol UPGMA por
// clave de dataset (heatCache), así que un cambio de paleta/dominio/pasos NO
// debería recalcular el clustering, solo el color+<rect> de cada celda.
//
//   node tests/colorscaleperf.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

// ms — mismo margen que perf-stress.mjs (JANK_MAX=150) para el ruido de un
// runner de CI compartido; el prompt pide "no bloquear de forma
// perceptible", que sitúa en 200-300ms.
const JANK_MAX = 250;
const N_SAMPLES = 200; // "100+ muestras" que pide el prompt, con margen

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'colorscaleperf' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

try {
  await c.goto();
  await sleep(1200);

  const setup = await c.ev(`(async () => {
    const stateMod = await import('/js/state.js');
    const { mulberry32 } = await import('/js/lib/groupBoxplot.js');
    const S = ${N_SAMPLES};
    const rnd = mulberry32(0x5eed);
    const sampleIds = Array.from({ length: S }, (_, i) => 'S' + i);
    const M = [];
    for (let i = 0; i < S; i++) M.push(new Array(S).fill(0));
    for (let i = 0; i < S; i++) {
      for (let j = i + 1; j < S; j++) {
        const v = rnd();
        M[i][j] = v; M[j][i] = v;
      }
    }
    stateMod.addBetaMetric('synthetic-perf', 'perf-test', sampleIds, M);
    return { samples: S };
  })()`);
  check('dataset sintético de ' + N_SAMPLES + ' muestras inyectado en state.betaDiversity', setup.samples === N_SAMPLES, JSON.stringify(setup));

  await c.ev(`location.hash = '#/beta'`);
  // primer pintado: puede pasar por el worker de UPGMA (heavyStats.js, umbral
  // >=180 muestras) — esperar de sobra a que termine y el heatCache quede
  // poblado antes de medir el repintado por color, que es lo que interesa aquí.
  await sleep(4000);

  const firstPaintOk = await c.ev(`(() => ({ nCells: document.querySelectorAll('rect[data-ri]').length }))()`);
  check('el mapa de calor sintético llegó a pintarse (primer pintado, incl. posible paso por worker)',
    firstPaintOk.nCells === N_SAMPLES * N_SAMPLES, JSON.stringify(firstPaintOk));

  await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Personalizar|Customise/.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(500);

  const result = await c.ev(`(async () => {
    function jankMeter() {
      let last = performance.now(); let max = 0, running = true;
      const tick = () => { const now = performance.now(); if (now - last > max) max = now - last; last = now; if (running) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      return () => { running = false; return max; };
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const stop = jankMeter();
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    const sel = document.querySelector('.ce-cs-row select');
    sel.value = 'viridis';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 80));
    const jankMs = stop();
    const nCells = document.querySelectorAll('rect[data-ri]').length;
    return { ms: +ms.toFixed(1), jankMs: +jankMs.toFixed(1), nCells };
  })()`);
  console.log('  recolorear ' + result.nCells + ' celdas (cambio de paleta): ' + result.ms + ' ms (jank ' + result.jankMs + ' ms)');
  check('recolorear el heatmap completo (' + N_SAMPLES + '×' + N_SAMPLES + ' celdas) por un cambio de paleta no bloquea de forma perceptible (< ' + JANK_MAX + ' ms)',
    result.jankMs < JANK_MAX, JSON.stringify(result));
  check('el repintado no perdió/duplicó celdas (sigue siendo N×N tras recolorear)', result.nCells === N_SAMPLES * N_SAMPLES, JSON.stringify(result));

  // discretizar en pasos: mismo camino de código (colorAt con banda) sobre
  // el mismo nº de celdas — comprobación de que tampoco introduce un coste
  // extra perceptible frente al modo continuo medido arriba.
  const stepsResult = await c.ev(`(async () => {
    function jankMeter() {
      let last = performance.now(); let max = 0, running = true;
      const tick = () => { const now = performance.now(); if (now - last > max) max = now - last; last = now; if (running) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      return () => { running = false; return max; };
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const stop = jankMeter();
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    const stepsInp = [...document.querySelectorAll('.ce-colorscale input[type=number]')].find((i) => +i.max === 20);
    stepsInp.value = '5';
    stepsInp.dispatchEvent(new Event('change', { bubbles: true }));
    const ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 80));
    return { ms: +ms.toFixed(1), jankMs: +stop().toFixed(1) };
  })()`);
  console.log('  discretizar en 5 bandas: ' + stepsResult.ms + ' ms (jank ' + stepsResult.jankMs + ' ms)');
  check('discretizar en bandas tampoco bloquea de forma perceptible', stepsResult.jankMs < JANK_MAX, JSON.stringify(stepsResult));

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
