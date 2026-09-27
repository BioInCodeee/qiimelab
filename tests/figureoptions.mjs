// getFigureOptions(key) + sección "Estructura" del editor (Fase 4 de
// qiimelab-prompt-editor-fase-4-ejes-rejilla-leyenda-lienzo.md): orden de
// categorías (G4), rango de eje manual (G4), rejilla menor (G5), mostrar/
// ocultar rejilla y leyenda (G5/G6, motor --fig-*), posiciones predefinidas
// de leyenda (G6). Piloto: js/lib/groupBoxplot.js (drawGroupBoxplot/
// drawGroupStripPlot), consumido por #/alfa, #/recuentos, #/funcional,
// #/diferencial (pestaña cajas).
//
//   node tests/figureoptions.mjs

import { APP_ROOT } from './lib/env.mjs';
import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

// ---- 1. getFigureOptions: robustez pura (mismo nivel que getPaletteOverrides) ----
console.log('-- getFigureOptions(key): robustez --');
globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
})();
{
  const { getFigureOptions } = await import(APP_ROOT + '/js/lib/chartEditor.js');
  check('localStorage vacío -> {} sin lanzar', JSON.stringify(getFigureOptions('nope')) === '{}');
  localStorage.setItem('smart-175.chartStyle.foo', 'esto no es JSON{{{');
  check('localStorage corrupto -> {} sin lanzar', JSON.stringify(getFigureOptions('foo')) === '{}');
  localStorage.setItem('smart-175.chartStyle.bar', JSON.stringify({ __structure: { categoryOrder: 'alpha-asc' } }));
  check('lee __structure ya guardado', getFigureOptions('bar').categoryOrder === 'alpha-asc');
}

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'figureoptions' });
const openEditor = async () => {
  await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Personalizar|Customise/.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(600);
};

try {
  await c.goto();
  await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); })()`);
  await sleep(2000);

  // ================= #/alfa (drawGroupBoxplot) =================
  console.log('\n-- #/alfa: boxplot (drawGroupBoxplot) --');
  await c.ev(`location.hash = '#/alfa'`);
  await sleep(1500);
  await openEditor();

  const setup = await c.ev(`(() => ({ present: !!document.querySelector('.ce-colorscale h5') && /Estructura|Structure/.test(document.querySelector('.ce-colorscale h5').textContent) }))()`);
  // la sección "Estructura" reutiliza la clase .ce-colorscale para el estilo — puede haber más de una en la página (Escala de color no aplica aquí, boxplot no es un heatmap)
  const setup2 = await c.ev(`(() => ({ n: [...document.querySelectorAll('.ce-colorscale h5')].map((h) => h.textContent) }))()`);
  check('la sección "Estructura" aparece en el boxplot de alfa', setup2.n.some((h) => /Estructura|Structure/.test(h)), JSON.stringify(setup2));

  const orderTest = await c.ev(`(() => {
    const before = [...document.querySelectorAll('.ql-tick-label')].map((t) => t.textContent).filter((s) => s && !/^[-\\d.]+$/.test(s));
    const sel = [...document.querySelectorAll('.ce-cs-row select')].find((s) => [...s.options].some((o) => /alfabético|alphabetical/i.test(o.textContent)));
    sel.value = 'alpha-desc';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { hadSelect: !!sel };
  })()`);
  check('el selector de orden de categorías existe y acepta "alfabético Z-A"', orderTest.hadSelect);
  await sleep(300);

  const afterOrder = await c.ev(`(() => {
    // las etiquetas de grupo están bajo el eje X, con la forma "<x cx> <label>" en un <text class=ql-tick-label>
    const svg = document.querySelector('svg.ql-svg');
    const texts = [...svg.querySelectorAll('text.ql-tick-label')].filter((t) => {
      const x = parseFloat(t.getAttribute('x'));
      const y = parseFloat(t.getAttribute('y'));
      return !/^[-\\d.]+$/.test(t.textContent.trim()) && y > 300; // etiquetas de grupo, no de eje Y (números)
    }).map((t) => t.textContent);
    return { labels: texts };
  })()`);
  const sorted = afterOrder.labels.slice().sort().reverse();
  check('tras "alfabético Z-A" las etiquetas de grupo quedan en orden Z-A real',
    JSON.stringify(afterOrder.labels) === JSON.stringify(sorted), JSON.stringify(afterOrder));

  const gridMinorTest = await c.ev(`(() => {
    const before = document.querySelectorAll('svg.ql-svg .ql-gridline').length;
    const chk = [...document.querySelectorAll('.ce-cs-row input[type=checkbox]')][0];
    chk.checked = true;
    chk.dispatchEvent(new Event('change', { bubbles: true }));
    const after = document.querySelectorAll('svg.ql-svg .ql-gridline').length;
    return { before, after };
  })()`);
  check('activar "rejilla menor" añade líneas de rejilla nuevas', gridMinorTest.after > gridMinorTest.before, JSON.stringify(gridMinorTest));

  const axisTest = await c.ev(`(() => {
    const nums = [...document.querySelectorAll('.ce-cs-domain input[type=number]')];
    nums[1].value = '999'; // máximo del eje muy alto -> el rango de valores visible cambia
    nums[1].dispatchEvent(new Event('change', { bubbles: true }));
    const raw = localStorage.getItem('smart-175.chartStyle.alphaDiversity');
    return JSON.parse(raw).__structure;
  })()`);
  check('el rango de eje manual persiste en store.__structure', axisTest && axisTest.axisMax === 999, JSON.stringify(axisTest));

  // ---- G5/G6 vía el motor --fig-* (mostrar/ocultar rejilla y leyenda) ----
  // panel único (Fase 1): Estructura y "Estilo de la figura" ya están en el mismo panel abierto
  await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Personalizar|Customise/.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(500);
  const toggleTest = await c.ev(`(() => {
    const rows = [...document.querySelectorAll('.ce-figstyle-row')];
    const gridRow = rows.find((r) => /rejilla|gridline/i.test(r.querySelector('label').textContent) && r.querySelector('input[type=checkbox]'));
    const legRow = rows.find((r) => /leyenda|legend/i.test(r.querySelector('label').textContent) && r.querySelector('input[type=checkbox]'));
    const gridChk = gridRow.querySelector('input[type=checkbox]');
    const legChk = legRow.querySelector('input[type=checkbox]');
    gridChk.checked = false; gridChk.dispatchEvent(new Event('change', { bubbles: true }));
    legChk.checked = false; legChk.dispatchEvent(new Event('change', { bubbles: true }));
    const svg = document.querySelector('svg.ql-svg');
    return {
      gridOpacity: getComputedStyle(svg.querySelector('.ql-gridline')).opacity,
      legendOpacity: getComputedStyle(svg.querySelector('[data-ce="legend"]')).opacity,
    };
  })()`);
  check('"mostrar rejilla" desmarcado pone opacity:0 en las líneas de rejilla (motor --fig-*, sin repintar)',
    toggleTest.gridOpacity === '0', JSON.stringify(toggleTest));
  check('"mostrar leyenda" desmarcado pone opacity:0 en el grupo de leyenda',
    toggleTest.legendOpacity === '0', JSON.stringify(toggleTest));

  // ---- puntos individuales del boxplot (prompt "quick wins" 22 sep): toggle
  // universal --fig-points-opacity, reutiliza el mismo motor que rejilla/leyenda ----
  const pointsToggleTest = await c.ev(`(() => {
    const rows = [...document.querySelectorAll('.ce-figstyle-row')];
    const ptRow = rows.find((r) => /puntos individuales|individual points/i.test(r.querySelector('label').textContent) && r.querySelector('input[type=checkbox]'));
    if (!ptRow) return { err: 'no se encontró la fila de puntos individuales' };
    const chk = ptRow.querySelector('input[type=checkbox]');
    const svg = document.querySelector('svg.ql-svg');
    const before = { checked: chk.checked, opacity: getComputedStyle(svg.querySelector('.ql-boxplot-point')).opacity };
    chk.checked = false; chk.dispatchEvent(new Event('change', { bubbles: true }));
    const after = { opacity: getComputedStyle(svg.querySelector('.ql-boxplot-point')).opacity };
    chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true }));
    const restored = { opacity: getComputedStyle(svg.querySelector('.ql-boxplot-point')).opacity };
    return { before, after, restored };
  })()`);
  check('"Mostrar puntos individuales" viene marcado por defecto y los puntos arrancan con su opacidad habitual (0.75)',
    pointsToggleTest.before && pointsToggleTest.before.checked && pointsToggleTest.before.opacity === '0.75', JSON.stringify(pointsToggleTest));
  check('desmarcarlo pone opacity:0 en los puntos del boxplot (sin repintar, motor --fig-*)',
    pointsToggleTest.after && pointsToggleTest.after.opacity === '0', JSON.stringify(pointsToggleTest));
  check('volver a marcarlo restaura la opacidad 0.75 de siempre',
    pointsToggleTest.restored && pointsToggleTest.restored.opacity === '0.75', JSON.stringify(pointsToggleTest));

  // ---- G6: posiciones predefinidas de leyenda ----
  const legendPosTest = await c.ev(`(() => {
    // re-marcar leyenda visible para poder verla/seleccionarla
    const rows = [...document.querySelectorAll('.ce-figstyle-row')];
    const legRow = rows.find((r) => /leyenda|legend/i.test(r.querySelector('label').textContent) && r.querySelector('input[type=checkbox]'));
    const legChk = legRow.querySelector('input[type=checkbox]');
    legChk.checked = true; legChk.dispatchEvent(new Event('change', { bubbles: true }));
    const hit = document.querySelector('[data-ce-id="legend"] .ce-hit');
    hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
    hit.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 100, clientY: 100 }));
    const panel = document.querySelector('.ce-panel');
    const btns = panel ? [...panel.querySelectorAll('.ce-toggles button')] : [];
    return { hasPanel: !!panel, posButtons: btns.map((b) => b.textContent) };
  })()`);
  check('el panel del elemento "leyenda" ofrece botones de posición predefinida (Arriba/Abajo/Derecha)',
    legendPosTest.hasPanel && legendPosTest.posButtons.length >= 3, JSON.stringify(legendPosTest));

  const legendMoveTest = await c.ev(`(() => {
    const panel = document.querySelector('.ce-panel');
    const btns = [...panel.querySelectorAll('.ce-toggles button')];
    const topBtn = btns.find((b) => /arriba|top/i.test(b.textContent));
    const before = document.querySelector('[data-ce-id="legend"]').getAttribute('transform');
    topBtn.click();
    const after = document.querySelector('[data-ce-id="legend"]').getAttribute('transform');
    return { before, after };
  })()`);
  check('pulsar "Arriba" mueve de verdad la leyenda (transform distinto)', legendMoveTest.before !== legendMoveTest.after, JSON.stringify(legendMoveTest));

  check('sin errores de consola tras #/alfa', c.problems.length === 0, c.problems.join('; '));

  // ================= #/recuentos (drawGroupStripPlot) — comprobación ligera =================
  console.log('\n-- #/recuentos: stripplot (drawGroupStripPlot) — comprobación ligera --');
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadExampleMicrobialCountsPlate(); })()`);
  await sleep(800);
  await c.ev(`location.hash = '#/recuentos'`);
  await sleep(1500);
  await c.ev(`(() => { const b = [...document.querySelectorAll('button, .ql-seg-btn')].find((x) => /Puntos \\(dispersión\\)|dispersión/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(500);
  await openEditor();
  const recuentosCheck = await c.ev(`(() => ({ n: [...document.querySelectorAll('.ce-colorscale h5')].map((h) => h.textContent) }))()`);
  check('la sección "Estructura" también aparece en #/recuentos (mismo componente compartido)',
    recuentosCheck.n.some((h) => /Estructura|Structure/.test(h)), JSON.stringify(recuentosCheck));
  check('sin errores de consola tras #/recuentos', c.problems.length === 0, c.problems.join('; '));

  // ================= #/barplots (groupTaxaByAbundance + taxa order) =================
  console.log('\n-- #/barplots: orden de taxones (groupTaxaByAbundance) --');
  await c.ev(`location.hash = '#/barplots'`);
  await sleep(1800);
  await openEditor();

  const barplotsSetup = await c.ev(`(() => ({ n: [...document.querySelectorAll('.ce-colorscale h5')].map((h) => h.textContent) }))()`);
  check('la sección "Estructura" aparece en la vista vertical apilada de barplots',
    barplotsSetup.n.some((h) => /Estructura|Structure/.test(h)), JSON.stringify(barplotsSetup));

  const taxaOrderTest = await c.ev(`(() => {
    // etiquetas de taxón: <text class="ql-tick-label" text-anchor="end"> a la izquierda del área de trazado
    const legendLabels = () => [...document.querySelectorAll('[data-ce="legend"] text.ql-tick-label')].map((t) => t.textContent);
    const before = legendLabels();
    const sel = [...document.querySelectorAll('.ce-cs-row select')].find((s) => [...s.options].some((o) => /alfabético|alphabetical/i.test(o.textContent)));
    sel.value = 'alpha-asc';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const after = legendLabels();
    return { before, after, hadSelect: !!sel };
  })()`);
  check('el selector de orden de taxones existe en barplots', taxaOrderTest.hadSelect);
  check('cambiar a "alfabético A-Z" reordena la leyenda de taxones (cambia el orden real)',
    JSON.stringify(taxaOrderTest.before) !== JSON.stringify(taxaOrderTest.after), JSON.stringify(taxaOrderTest));

  // el editor sigue abierto tras el repintado disparado por el cambio de orden
  const stillOpenBarplots = await c.ev(`(() => !!document.querySelector('.ce-colorscale'))()`);
  check('el panel "Personalizar" de barplots sigue abierto tras reordenar taxones (startEditing)', stillOpenBarplots);

  check('sin errores de consola tras #/barplots', c.problems.length === 0, c.problems.join('; '));

} catch (e) {
  console.error('EXCEPCIÓN:', e.message);
  failed = true;
} finally {
  c.kill();
  if (server.started) server.stop();
}
console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
