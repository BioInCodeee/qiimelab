// Editor de gráficos en #/venn (Fase 5.4 de qiimelab-prompt-editor-fase-5-
// especificos-por-tipo.md). Hallazgo de esta fase: a diferencia de las
// otras 5 sub-fases, aquí NO hubo que escribir código nuevo -- venn.js ya
// llamaba a attachChartEditor con paletteSeries (data-ce-series-fill en
// cada forma) -- el selector de forma círculos/rectángulo que tenía entonces se retiró;
// hoy el Venn son solo círculos/elipses, así que el control de opacidad de la Fase 2 y
// el resto ya funcionaban de fábrica -- este test existe para
// VERIFICARLO de forma empírica (no solo por lectura de código) y dejar
// constancia de que 5.4 no requirió cambios de producción, solo esta
// prueba. Cubre también UpSet (comparte el mismo attachChartEditor).
//
// Dos escenarios con recarga de página entre medias (loadExampleCounts
// solo siembra sus metadatos SINTÉTICOS si state.metadata está vacío --
// cargarlo después de loadRealCounts heredaría los metadatos reales de 14
// columnas en vez de la columna "grupo" de 4 dietas que este test necesita
// para el Venn de 4 conjuntos/UpSet):
//   A. loadRealCounts()    -> agrupa por defecto en 2 grupos -> círculos
//   B. loadExampleCounts() -> "grupo" con 4 valores -> elipses + UpSet
//
//   node tests/venn-editor.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'venn-editor' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

const openEditor = async () => {
  await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Personalizar|Customise/.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(600);
};

try {
  // ================= escenario A: 2 grupos, círculos =================
  await c.goto();
  await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCounts(); })()`);
  await sleep(1500);
  await c.ev(`location.hash = '#/venn'`);
  await sleep(1500);

  console.log('-- Venn círculos (2 grupos): opacidad de relleno (Fase 2, genérica) --');
  await openEditor();
  const opacitySetup = await c.ev(`(() => {
    const ctl = document.querySelector('.ce-pal-opacity input[type=range]');
    const region = document.querySelector('[data-ce-series-fill^="s"]');
    return { present: !!ctl, defaultVal: ctl ? ctl.value : null, fillOpacityBefore: region ? getComputedStyle(region).fillOpacity : null };
  })()`);
  check('el control de opacidad de la Fase 2 aparece para las regiones del Venn (data-ce-series-fill ya estaba en setDiagram.js)',
    opacitySetup.present && opacitySetup.defaultVal === '100', JSON.stringify(opacitySetup));
  check('la opacidad por defecto del módulo (0.3 con 2-3 grupos) se respeta hasta que el usuario la cambia',
    opacitySetup.fillOpacityBefore === '0.3', opacitySetup.fillOpacityBefore);

  const opacityApplied = await c.ev(`(() => {
    const ctl = document.querySelector('.ce-pal-opacity input[type=range]');
    ctl.value = '60'; ctl.dispatchEvent(new Event('change', { bubbles: true }));
    const region = document.querySelector('[data-ce-series-fill^="s"]');
    return { fillOpacity: getComputedStyle(region).fillOpacity };
  })()`);
  check('mover el slider a 60% sobreescribe la opacidad fija del módulo (fill-opacity:0.6 inline)',
    opacityApplied.fillOpacity === '0.6', JSON.stringify(opacityApplied));

  console.log('\n-- sin rectángulos: el Venn son solo círculos/elipses y etiquetas --');
  const noRects = await c.ev(`(() => ({
    shapeSelector: [...document.querySelectorAll('.ql-segmented .ql-seg-btn')].some((b) => /rectángulo|rectangle/i.test(b.textContent)),
    rects: document.querySelectorAll('svg.ql-svg rect[data-ce-series-fill]').length,
    circles: document.querySelectorAll('svg.ql-svg circle[data-ce-series-fill]').length,
  }))()`);
  check('ya no hay selector de forma con "Rectángulos" y el Venn dibuja círculos, ningún <rect>',
    !noRects.shapeSelector && noRects.rects === 0 && noRects.circles > 0, JSON.stringify(noRects));
  const venn2Key = await c.ev(`(() => Object.keys(localStorage).filter((k) => k.startsWith('smart-175.chartStyle.venn')))()`);
  check('los estilos guardados usan solo la clave "venn" (la clave venn-rect ya no existe)', !venn2Key.includes('smart-175.chartStyle.venn-rect'), JSON.stringify(venn2Key));

  // ================= escenario B: recarga -> 4 grupos sintéticos, elipses + UpSet =================
  console.log('\n-- recarga con datos sintéticos de 4 grupos (elipses + UpSet) --');
  await c.goto();
  await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); m.loadExampleCounts(); })()`);
  await sleep(1500);
  await c.ev(`location.hash = '#/venn'`);
  await sleep(1500);

  const fourGroupDefault = await c.ev(`(() => ({
    ellipses: document.querySelectorAll('svg.ql-svg ellipse[data-ce-series-fill]').length,
    rects: document.querySelectorAll('svg.ql-svg rect[data-ce-series-fill]').length,
    hasUpsetSelect: [...document.querySelectorAll('select')].some((s) => [...s.options].some((o) => /UpSet/i.test(o.textContent))),
  }))()`);
  // con 4 conjuntos el Venn son las 4 elipses de VENN_LAYOUTS[4]; sin rectángulos
  check('con 4 grupos (columna "grupo" sintética) el Venn dibuja 4 <ellipse> y ningún <rect>',
    fourGroupDefault.ellipses === 4 && fourGroupDefault.rects === 0, JSON.stringify(fourGroupDefault));
  check('con 3-4 grupos aparece el desplegable auto/UpSet', fourGroupDefault.hasUpsetSelect, JSON.stringify(fourGroupDefault));

  if (fourGroupDefault.hasUpsetSelect) {
    await c.ev(`(() => {
      const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /UpSet/i.test(o.textContent)));
      sel.value = 'upset'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(600);
    await openEditor();
    const upsetSetup = await c.ev(`(() => {
      const bar = document.querySelector('svg.ql-svg [data-ce-series-fill]');
      const opacityCtl = document.querySelector('.ce-pal-opacity input[type=range]');
      return {
        setBarPresent: !!bar, tag: bar ? bar.tagName.toLowerCase() : null,
        hasOpacityCtl: !!opacityCtl,
      };
    })()`);
    check('la vista UpSet dibuja las barras de tamaño de conjunto con data-ce-series-fill (mismo mecanismo que el Venn)',
      upsetSetup.setBarPresent && upsetSetup.tag === 'rect', JSON.stringify(upsetSetup));
    check('el control de opacidad de la Fase 2 también aparece en UpSet (mismo attachChartEditor, sin código nuevo)',
      upsetSetup.hasOpacityCtl, JSON.stringify(upsetSetup));

    const upsetOpacityApplied = await c.ev(`(() => {
      const ctl = document.querySelector('.ce-pal-opacity input[type=range]');
      ctl.value = '40'; ctl.dispatchEvent(new Event('change', { bubbles: true }));
      const bar = document.querySelector('svg.ql-svg [data-ce-series-fill]');
      return { fillOpacity: getComputedStyle(bar).fillOpacity };
    })()`);
    check('mover el slider en UpSet recolorea de verdad la barra de tamaño de conjunto',
      upsetOpacityApplied.fillOpacity === '0.4', JSON.stringify(upsetOpacityApplied));

    const upsetKey = await c.ev(`(() => Object.keys(localStorage).filter((k) => k.startsWith('smart-175.chartStyle.venn')))()`);
    check('UpSet reutiliza la clave "venn" (no una clave "upset" aparte) -- por diseño, ver comentario en venn.js',
      upsetKey.includes('smart-175.chartStyle.venn'), JSON.stringify(upsetKey));
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
