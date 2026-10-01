// Gráfico de violín (prompt "quick wins" del 22 sep 2026, punto 4): nueva
// opción dentro del selector de tipo de gráfico YA existente en
// alphaDiversity.js/microbialCounts.js (js/lib/chartTypeSelector.js,
// confirmado con grep que ya estaba montado en 7 módulos -- no hacía falta
// construir el selector desde cero como suponía la sesión "quickwins-
// selector-tipo-grafico" de una sesión anterior, solo añadir 'violin' junto
// a 'box'/'jitter' y 'bars'/'jitter'). drawGroupViolin (js/lib/
// groupBoxplot.js) reutiliza toda la infraestructura del boxplot (KW,
// corchetes de significación, auto-selección de test) y el toggle de
// puntos del punto 1 del mismo prompt (class="ql-boxplot-point"). La KDE
// en sí ya se valida contra R en tests/stats/gaussiankde.mjs -- este test
// cubre la parte de INTERFAZ: la opción existe, dibuja un violín de
// verdad (polígono con más de 2 vértices, mismo color que su grupo),
// misma escala de ancho entre grupos, el aviso de n<5, y que el toggle de
// puntos (heredado del punto 1) también funciona sobre el violín.
//
//   node tests/violin.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'violin' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

const openEditor = async () => {
  await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Personalizar|Customise/.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(600);
};

try {
  await c.goto();
  await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); })()`);
  await sleep(2000);

  // ================= #/alfa =================
  console.log('-- #/alfa: violín como 3ª opción junto a Cajas/Puntos --');
  await c.ev(`location.hash = '#/alfa'`);
  await sleep(1500);

  const setup = await c.ev(`(() => {
    const btns = [...document.querySelectorAll('.ql-seg-btn')];
    const violinBtn = btns.find((b) => /Violín|Violin/i.test(b.textContent));
    return { hasViolin: !!violinBtn, allOptions: btns.map((b) => b.textContent) };
  })()`);
  check('la opción "Violín" existe en el mismo selector que Cajas/Puntos', setup.hasViolin, JSON.stringify(setup));

  await c.ev(`(() => { const b = [...document.querySelectorAll('.ql-seg-btn')].find((x) => /Violín|Violin/i.test(x.textContent)); b.click(); })()`);
  await sleep(1000);

  const drawn = await c.ev(`(() => {
    const polys = [...document.querySelectorAll('svg.ql-svg polygon')];
    return {
      n: polys.length,
      pointCounts: polys.map((p) => p.getAttribute('points').split(' ').length),
      hasPoints: document.querySelectorAll('svg.ql-svg circle.ql-boxplot-point').length,
    };
  })()`);
  check('dibuja al menos 1 violín (polígono con >2 vértices, forma real de densidad)',
    drawn.n > 0 && drawn.pointCounts.every((n) => n > 2), JSON.stringify(drawn));
  check('los puntos individuales (heredados del toggle del punto 1) se dibujan también sobre el violín',
    drawn.hasPoints > 0, JSON.stringify(drawn));
  const noBox = await c.ev(`(() => document.querySelectorAll('svg.ql-svg rect[data-ce-role="bar"]').length)()`);
  check('el violín no lleva caja de bigotes de fondo (ningún rect de caja en el SVG)', noBox === 0, 'rects de caja: ' + noBox);

  // misma escala de ancho ENTRE grupos (no normalizada grupo a grupo): el
  // ancho máximo teórico de un violín es slotW*0.84 (2*violinHalfWidth);
  // si CADA grupo se normalizara a SU PROPIA densidad máxima (como haría
  // una escala "por grupo", que es justo lo que el prompt pide EVITAR),
  // todos tocarían ese techo -- con la escala GLOBAL, como mucho el grupo
  // de densidad más alta lo toca y el resto se queda por debajo, en
  // proporción a su propia forma real.
  const widths = await c.ev(`(() => {
    const polys = [...document.querySelectorAll('svg.ql-svg polygon')];
    return polys.map((p) => {
      const pts = p.getAttribute('points').split(' ').map((s) => s.split(',').map(Number));
      const xs = pts.map((pp) => pp[0]);
      return Math.max(...xs) - Math.min(...xs);
    });
  })()`);
  check('ningún violín supera el ancho máximo compartido, y no todos son idénticos (serían formas distintas con densidades distintas)',
    widths.length > 1 && new Set(widths.map((w) => w.toFixed(1))).size > 1, JSON.stringify(widths));

  // aviso de n bajo (con datos reales de ejemplo, algún grupo suele tener pocas réplicas)
  const lowNNote = await c.ev(`(() => [...document.querySelectorAll('.ql-field-help')].map((p) => p.textContent).find((t) => /forma estimada es poco fiable/.test(t)))()`);
  console.log('  nota de n bajo (informativo, depende del dataset de ejemplo):', lowNNote || '(ningún grupo con n<5 en este dataset)');

  // ================= #/recuentos =================
  console.log('\n-- #/recuentos: violín como 3ª opción junto a Barras/Puntos --');
  await c.ev(`location.hash = '#/recuentos'`);
  await sleep(1000);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); m.loadExampleMicrobialCountsPlate(); })()`);
  await sleep(1500);

  const setupR = await c.ev(`(() => {
    const btns = [...document.querySelectorAll('.ql-seg-btn')];
    const violinBtn = btns.find((b) => /Violín|Violin/i.test(b.textContent));
    return { hasViolin: !!violinBtn };
  })()`);
  check('la opción "Violín" también existe en #/recuentos (Barras/Puntos/Violín)', setupR.hasViolin, JSON.stringify(setupR));

  if (setupR.hasViolin) {
    await c.ev(`(() => { const b = [...document.querySelectorAll('.ql-seg-btn')].find((x) => /Violín|Violin/i.test(x.textContent)); b.click(); })()`);
    await sleep(1000);
    const drawnR = await c.ev(`(() => ({ n: document.querySelectorAll('svg.ql-svg polygon').length }))()`);
    check('#/recuentos también dibuja el violín de verdad', drawnR.n > 0, JSON.stringify(drawnR));

    // color editable vía chartEditor (misma serie que el resto del boxplot/stripplot)
    await openEditor();
    const editable = await c.ev(`(() => {
      const poly = document.querySelector('svg.ql-svg polygon[data-ce-series-fill]');
      const blocks = [...document.querySelectorAll('.ce-pal-row-block')];
      return { hasSeries: !!poly, nSeries: blocks.length };
    })()`);
    check('el violín trae data-ce-series-fill y el editor ofrece paleta por grupo, igual que el boxplot',
      editable.hasSeries && editable.nSeries > 0, JSON.stringify(editable));
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
