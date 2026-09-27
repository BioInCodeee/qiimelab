// Panel "Escala de color" del editor de gráficos (Fase 3, Pasos 2-3 de
// qiimelab-prompt-editor-fase-3-heatmaps-escalas-continuas.md), en Chrome
// real, sobre los 3 heatmaps que comparten js/lib/colorScale.js:
// betaDiversity.js (mapa de distancias), correlogram.js (matriz de r, con
// la diagonal gris fuera de la escala), differentialAbundance.js (heatmap
// de log2FC).
//
//   node tests/colorscalepanel.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'colorscalepanel' });
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

  // ================= betaDiversity.js (secuencial, sin punto medio) =================
  console.log('-- betaDiversity.js (secuencial) --');
  await c.ev(`location.hash = '#/beta'`);
  await sleep(1800);
  await openEditor();

  const setup = await c.ev(`(() => {
    const sec = [...document.querySelectorAll('.ce-colorscale')].find((s) => /Escala de color|Colour scale/i.test(s.querySelector('h5').textContent));
    return sec ? { present: true, hasMidpoint: !!sec.querySelector('.ce-cs-row:nth-child(3) input[type=number]') && /medio|midpoint/i.test(sec.textContent) } : { present: false };
  })()`);
  check('la sección "Escala de color" aparece para el heatmap de beta', setup.present);

  const noColorMix = await c.ev(`(() => {
    const rects = [...document.querySelectorAll('rect[data-ri]')];
    return { n: rects.length, anyColorMix: rects.some((r) => (r.getAttribute('fill') || '').includes('color-mix')), sampleFill: rects[0] && rects[0].getAttribute('fill') };
  })()`);
  check('las celdas ya NO usan color-mix() — fill resuelto directo a #rrggbb', noColorMix.n > 0 && !noColorMix.anyColorMix && /^#[0-9a-f]{6}$/i.test(noColorMix.sampleFill || ''),
    JSON.stringify(noColorMix));

  const beforeAfterPalette = await c.ev(`(() => {
    const before = document.querySelector('rect[data-ri="0"][data-ci="1"]').getAttribute('fill');
    const sel = [...document.querySelectorAll('.ce-cs-row select')][0];
    sel.value = 'viridis';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const after = document.querySelector('rect[data-ri="0"][data-ci="1"]').getAttribute('fill');
    return { before, after };
  })()`);
  check('cambiar la paleta de la escala recolorea las celdas de verdad (cambia el fill)',
    beforeAfterPalette.before !== beforeAfterPalette.after, JSON.stringify(beforeAfterPalette));

  const domainEdit = await c.ev(`(() => {
    const nums = [...document.querySelectorAll('.ce-cs-domain input[type=number]')];
    nums[1].value = '0.1'; // recortar el máximo del dominio a un valor muy bajo
    nums[1].dispatchEvent(new Event('change', { bubbles: true }));
    const rects = [...document.querySelectorAll('rect[data-ri]')];
    // con un dominio recortado, MUCHAS celdas deberían saturar al color del
    // extremo alto (clamp) -> muchos fills idénticos, a diferencia de antes
    const fills = rects.map((r) => r.getAttribute('fill'));
    const distinct = new Set(fills).size;
    return { totalCells: fills.length, distinctColors: distinct };
  })()`);
  check('recortar el máximo del dominio hace que muchas celdas saturen al mismo color (clamp visible)',
    domainEdit.distinctColors < domainEdit.totalCells * 0.5, JSON.stringify(domainEdit));

  const resetDomain = await c.ev(`(() => {
    const btn = [...document.querySelectorAll('.ce-cs-domain button')][0];
    btn.click();
    const nums = [...document.querySelectorAll('.ce-cs-domain input[type=number]')];
    return { maxAfterReset: nums[1].value };
  })()`);
  check('"Restablecer" del dominio vuelve al rango real de los datos (ya no 0.1)', resetDomain.maxAfterReset !== '0.1', JSON.stringify(resetDomain));

  const stepsCheck = await c.ev(`(() => {
    const stepsInp = [...document.querySelectorAll('.ce-colorscale input[type=number]')].find((i) => +i.max === 20);
    stepsInp.value = '3';
    stepsInp.dispatchEvent(new Event('change', { bubbles: true }));
    const fills = [...document.querySelectorAll('rect[data-ri]')].map((r) => r.getAttribute('fill'));
    return { distinct: new Set(fills).size };
  })()`);
  check('discretizar en 3 pasos deja como mucho 3 colores en todo el mapa de calor', stepsCheck.distinct <= 3, JSON.stringify(stepsCheck));

  const persisted = await c.ev(`(() => {
    const raw = localStorage.getItem('smart-175.chartStyle.betaDiversity');
    return JSON.parse(raw).__colorScale;
  })()`);
  check('la escala persiste en store.__colorScale (paletteId=viridis, steps=3, sin domainMax residual tras el reset)',
    persisted && persisted.paletteId === 'viridis' && persisted.steps === 3 && persisted.domainMax === undefined,
    JSON.stringify(persisted));

  // volver a continuo para el export
  await c.ev(`(() => {
    const stepsInp = [...document.querySelectorAll('.ce-colorscale input[type=number]')].find((i) => +i.max === 20);
    stepsInp.value = '0';
    stepsInp.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(200);

  const exportCheck = await c.ev(`(async () => {
    const mod = await import('/js/lib/figureExport.js');
    const svg = document.querySelector('rect[data-ri]').closest('svg');
    const out = mod.serializeForExport(svg, { scheme: 'light', background: 'white' });
    return { noColorMix: !/color-mix\\(/.test(out.svg), noVar: !/var\\(--/.test(out.svg), hasGradient: /<linearGradient[^>]*id="ql-cscale-betaDiversity"/.test(out.svg) };
  })()`);
  check('el SVG exportado de beta no tiene color-mix()/var() residual y conserva el <linearGradient> de leyenda',
    exportCheck.noColorMix && exportCheck.noVar && exportCheck.hasGradient, JSON.stringify(exportCheck));

  // ---- Paso 4: controles de celda ----
  // orden de checkboxes en .ce-colorscale (tipo secuencial, sin fila de
  // punto medio): [0]=invertir, [1]=valor en celda, [2]=borde de celda.
  const betaShowVal = await c.ev(`(() => {
    const before = document.querySelectorAll('text.ql-cell-value').length;
    const chks = [...document.querySelectorAll('.ce-colorscale input[type=checkbox]')];
    const showValChk = chks[1];
    showValChk.checked = true;
    showValChk.dispatchEvent(new Event('change', { bubbles: true }));
    const after = document.querySelectorAll('text.ql-cell-value').length;
    return { before, after };
  })()`);
  check('beta: activar "valor en celda" dibuja el número de distancia (no existía antes de la Fase 3)',
    betaShowVal.before === 0 && betaShowVal.after > 0, JSON.stringify(betaShowVal));

  const betaBorder = await c.ev(`(() => {
    const chks = [...document.querySelectorAll('.ce-colorscale input[type=checkbox]')];
    const borderChk = chks[2];
    borderChk.checked = true;
    borderChk.dispatchEvent(new Event('change', { bubbles: true }));
    const colorInp = document.querySelector('.ce-colorscale input[type=color]');
    colorInp.value = '#00ff00';
    colorInp.dispatchEvent(new Event('change', { bubbles: true }));
    const rect = document.querySelector('rect[data-ri="0"][data-ci="0"]');
    return { stroke: getComputedStyle(rect).stroke };
  })()`);
  check('beta: activar "borde de celda" pinta un stroke visible en las celdas', betaBorder.stroke === 'rgb(0, 255, 0)', JSON.stringify(betaBorder));

  check('sin errores de consola tras beta', c.problems.length === 0, c.problems.join('; '));

  // ================= correlogram.js (divergente, diagonal fuera de la escala) =================
  console.log('\n-- correlogram.js (divergente + diagonal especial) --');
  await c.ev(`location.hash = '#/correlograma'`);
  await sleep(1800);
  await openEditor();

  const corrSetup = await c.ev(`(() => {
    const sec = [...document.querySelectorAll('.ce-colorscale')].find((s) => /Escala de color|Colour scale/i.test(s.querySelector('h5').textContent));
    return { present: !!sec, hasMidpointRow: sec ? /medio|midpoint/i.test(sec.textContent) : false };
  })()`);
  check('la sección "Escala de color" aparece para la matriz de correlación, CON punto medio (tipo divergente)',
    corrSetup.present && corrSetup.hasMidpointRow, JSON.stringify(corrSetup));

  const diagCheck = await c.ev(`(() => {
    const rects = [...document.querySelectorAll('svg rect[rx="2"]')].filter((r) => r.closest('[data-ce]') == null || true);
    // celdas de la matriz: tienen data-i/data-j (fuera de diagonal) o ninguno de los 2 (diagonal)
    const withData = document.querySelectorAll('rect[data-i]');
    const w = withData[0];
    // encontrar una celda diagonal real: mismo padre <svg>, sin data-i, tamaño de celda similar
    const svg = w.closest('svg');
    const allCellRects = [...svg.querySelectorAll('rect')].filter((r) => r.getAttribute('width') === w.getAttribute('width'));
    const diagRect = allCellRects.find((r) => !r.hasAttribute('data-i'));
    return {
      anyColorMix: [...svg.querySelectorAll('rect')].some((r) => (r.getAttribute('fill') || '').includes('color-mix')),
      diagFill: diagRect ? getComputedStyle(diagRect).fill : null,
      offDiagFill: getComputedStyle(w).fill,
    };
  })()`);
  check('ninguna celda (ni la diagonal) usa color-mix() ya en el fill', !diagCheck.anyColorMix, JSON.stringify(diagCheck));
  check('la diagonal tiene un color distinto de las celdas de datos (var(--corr-diag), fuera de la escala)',
    diagCheck.diagFill && diagCheck.diagFill !== diagCheck.offDiagFill, JSON.stringify(diagCheck));

  const midpointShift = await c.ev(`(() => {
    const w = document.querySelector('rect[data-i]');
    const before = getComputedStyle(w).fill;
    const midInp = [...document.querySelectorAll('.ce-colorscale input[type=number]')].find((i) => i.step === 'any' && i.closest('.ce-cs-row').textContent.match(/medio|midpoint/i));
    midInp.value = '0.5';
    midInp.dispatchEvent(new Event('change', { bubbles: true }));
    const w2 = document.querySelector('rect[data-i]');
    const after = getComputedStyle(w2).fill;
    return { before, after, changed: before !== after };
  })()`);
  check('cambiar el punto medio recolorea las celdas de datos', midpointShift.changed, JSON.stringify(midpointShift));

  // volver el midpoint a 0 y comprobar la diagonal SIGUE igual (no sigue la escala de r)
  const diagStable = await c.ev(`(() => {
    const midInp = [...document.querySelectorAll('.ce-colorscale input[type=number]')].find((i) => i.step === 'any' && i.closest('.ce-cs-row').textContent.match(/medio|midpoint/i));
    midInp.value = '0';
    midInp.dispatchEvent(new Event('change', { bubbles: true }));
    const w = document.querySelector('rect[data-i]');
    const svg = w.closest('svg');
    const allCellRects = [...svg.querySelectorAll('rect')].filter((r) => r.getAttribute('width') === w.getAttribute('width'));
    const diagRect = allCellRects.find((r) => !r.hasAttribute('data-i'));
    return { diagFill: diagRect ? getComputedStyle(diagRect).fill : null };
  })()`);
  check('la diagonal es idéntica antes y después de mover el punto medio (nunca sigue la escala de datos)',
    diagStable.diagFill === diagCheck.diagFill, JSON.stringify({ before: diagCheck.diagFill, after: diagStable.diagFill }));

  const corrExport = await c.ev(`(async () => {
    const mod = await import('/js/lib/figureExport.js');
    const svg = document.querySelector('rect[data-i]').closest('svg');
    const out = mod.serializeForExport(svg, { scheme: 'light', background: 'white' });
    return { noColorMix: !/color-mix\\(/.test(out.svg), noVar: !/var\\(--/.test(out.svg), hasGradient: /<linearGradient[^>]*id="ql-cscale-correlogram"/.test(out.svg) };
  })()`);
  check('el SVG exportado de correlograma no tiene color-mix()/var() residual (incl. --corr-diag resuelto) y conserva el <linearGradient> de leyenda',
    corrExport.noColorMix && corrExport.noVar && corrExport.hasGradient, JSON.stringify(corrExport));

  // ---- Paso 4: controles de celda (orden de checkboxes: [0]=invertir,
  // [1]=valor en celda, [2]=borde — mismo orden que beta, ver arriba) ----
  const corrShowVal = await c.ev(`(() => {
    const before = document.querySelectorAll('text.ql-cell-value').length;
    const chks = [...document.querySelectorAll('.ce-colorscale input[type=checkbox]')];
    chks[1].checked = false;
    chks[1].dispatchEvent(new Event('change', { bubbles: true }));
    const after = document.querySelectorAll('text.ql-cell-value').length;
    return { before, after };
  })()`);
  check('correlograma: desactivar "valor en celda" oculta las estrellas/p que antes eran incondicionales',
    corrShowVal.after === 0, JSON.stringify(corrShowVal));

  const corrBorder = await c.ev(`(() => {
    const chks = [...document.querySelectorAll('.ce-colorscale input[type=checkbox]')];
    chks[2].checked = true;
    chks[2].dispatchEvent(new Event('change', { bubbles: true }));
    const colorInp = document.querySelector('.ce-colorscale input[type=color]');
    colorInp.value = '#00ff00';
    colorInp.dispatchEvent(new Event('change', { bubbles: true }));
    const rect = document.querySelector('rect[data-i][data-j]');
    return { stroke: getComputedStyle(rect).stroke };
  })()`);
  check('correlograma: activar "borde de celda" pinta un stroke visible en las celdas de datos', corrBorder.stroke === 'rgb(0, 255, 0)', JSON.stringify(corrBorder));

  check('sin errores de consola tras correlograma', c.problems.length === 0, c.problems.join('; '));

  // ================= differentialAbundance.js (divergente, invert-por-defecto) =================
  console.log('\n-- differentialAbundance.js (heatmap log2FC) --');
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealDifferentialAbundance(); })()`);
  await sleep(1500);
  await c.ev(`location.hash = '#/diferencial'`);
  await sleep(1800);
  await c.ev(`(() => { const b = [...document.querySelectorAll('.ql-tab')].find((x) => /mapa de calor|heatmap/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(500);
  await openEditor();

  const daSetup = await c.ev(`(() => {
    const sec = [...document.querySelectorAll('.ce-colorscale')].find((s) => /Escala de color|Colour scale/i.test(s.querySelector('h5').textContent));
    const cells = [...document.querySelectorAll('rect[data-tt]')];
    return {
      present: !!sec,
      nCells: cells.length,
      anyColorMix: cells.some((r) => (r.getAttribute('fill') || '').includes('color-mix')),
      sampleFill: cells[0] && cells[0].getAttribute('fill'),
    };
  })()`);
  check('la sección "Escala de color" aparece para el heatmap de log2FC y las celdas ya no usan color-mix()',
    daSetup.present && daSetup.nCells > 0 && !daSetup.anyColorMix, JSON.stringify(daSetup));

  const daPaletteChange = await c.ev(`(() => {
    const before = document.querySelector('rect[data-tt]').getAttribute('fill');
    const sel = [...document.querySelectorAll('.ce-cs-row select')][0];
    sel.value = 'coolwarm';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const after = document.querySelector('rect[data-tt]').getAttribute('fill');
    return { before, after };
  })()`);
  check('cambiar la paleta de la escala recolorea el heatmap de diferencial', daPaletteChange.before !== daPaletteChange.after, JSON.stringify(daPaletteChange));

  const daExport = await c.ev(`(async () => {
    const mod = await import('/js/lib/figureExport.js');
    const svg = document.querySelector('rect[data-tt]').closest('svg');
    const out = mod.serializeForExport(svg, { scheme: 'light', background: 'white' });
    return { noColorMix: !/color-mix\\(/.test(out.svg), noVar: !/var\\(--/.test(out.svg), hasGradient: /<linearGradient[^>]*id="ql-cscale-differentialAbundance-heatmap"/.test(out.svg) };
  })()`);
  check('el SVG exportado de diferencial no tiene color-mix()/var() residual y conserva el <linearGradient> de leyenda',
    daExport.noColorMix && daExport.noVar && daExport.hasGradient, JSON.stringify(daExport));

  // el bug de "cierra el panel en cada repintado" (arreglado con
  // cfg.startEditing) — comprobación directa: el editor DEBE seguir
  // abierto tras el cambio de paleta de arriba, que disparó un paint()
  // completo vía onColorScaleChange.
  const stillEditing = await c.ev(`(() => !!document.querySelector('.ce-colorscale'))()`);
  check('el panel "Personalizar" sigue abierto tras un cambio de escala (no se cierra solo — bug arreglado en Fase 3)', stillEditing);

  // ---- Paso 4: controles de celda ----
  const daShowVal = await c.ev(`(() => {
    const before = document.querySelectorAll('text.ql-cell-value').length;
    const chks = [...document.querySelectorAll('.ce-colorscale input[type=checkbox]')];
    chks[1].checked = false;
    chks[1].dispatchEvent(new Event('change', { bubbles: true }));
    const after = document.querySelectorAll('text.ql-cell-value').length;
    return { before, after };
  })()`);
  check('diferencial: desactivar "valor en celda" oculta el número de log2FC que antes era incondicional',
    daShowVal.before > 0 && daShowVal.after === 0, JSON.stringify(daShowVal));

  const daBorder = await c.ev(`(() => {
    const chks = [...document.querySelectorAll('.ce-colorscale input[type=checkbox]')];
    chks[2].checked = true;
    chks[2].dispatchEvent(new Event('change', { bubbles: true }));
    const colorInp = document.querySelector('.ce-colorscale input[type=color]');
    colorInp.value = '#00ff00';
    colorInp.dispatchEvent(new Event('change', { bubbles: true }));
    const rect = document.querySelector('rect[data-tt]');
    return { stroke: getComputedStyle(rect).stroke };
  })()`);
  check('diferencial: activar "borde de celda" pinta un stroke visible en las celdas', daBorder.stroke === 'rgb(0, 255, 0)', JSON.stringify(daBorder));

  check('sin errores de consola tras diferencial', c.problems.length === 0, c.problems.join('; '));
} catch (e) {
  console.error('EXCEPCIÓN:', e.message);
  failed = true;
} finally {
  c.kill();
  if (server.started) server.stop();
}
console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
