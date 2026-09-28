// Editor de gráficos en #/venn (Fase 5.4 de qiimelab-prompt-editor-fase-5-
// especificos-por-tipo.md). Hallazgo de esta fase: a diferencia de las
// otras 5 sub-fases, aquí NO hubo que escribir código nuevo -- venn.js ya
// llamaba a attachChartEditor con paletteSeries (data-ce-series-fill en
// cada forma) y ya tenía su propio selector de forma círculos/rectángulo
// (shapeSeg, línea ~210), así que el control de opacidad de la Fase 2 y
// el selector de forma ya funcionaban de fábrica -- este test existe para
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

  console.log('\n-- selector de forma (círculos vs rectángulo Venn) --');
  const shapeSetup = await c.ev(`(() => {
    const buttons = [...document.querySelectorAll('.ql-segmented .ql-seg-btn')];
    const circlesBtn = buttons.find((b) => /círculos|circles/i.test(b.textContent));
    const rectBtn = buttons.find((b) => /rectángulo|rectangle/i.test(b.textContent));
    return { hasCircles: !!circlesBtn, hasRect: !!rectBtn, circlesOn: circlesBtn && circlesBtn.classList.contains('is-on') };
  })()`);
  check('el selector círculos/rectángulo existe y "círculos" está activo por defecto',
    shapeSetup.hasCircles && shapeSetup.hasRect && shapeSetup.circlesOn, JSON.stringify(shapeSetup));

  const beforeShapes = await c.ev(`(() => ({ circles: document.querySelectorAll('svg.ql-svg circle[data-ce-series-fill]').length, rects: document.querySelectorAll('svg.ql-svg rect[data-ce-series-fill]').length }))()`);
  await c.ev(`(() => { [...document.querySelectorAll('.ql-segmented .ql-seg-btn')].find((b) => /rectángulo|rectangle/i.test(b.textContent)).click(); })()`);
  await sleep(500);
  const afterShapes = await c.ev(`(() => ({ circles: document.querySelectorAll('svg.ql-svg circle[data-ce-series-fill]').length, rects: document.querySelectorAll('svg.ql-svg rect[data-ce-series-fill]').length }))()`);
  check('cambiar a "rectángulo" redibuja con <rect> en vez de <circle> (buildRectVennLayout)',
    beforeShapes.circles > 0 && afterShapes.circles === 0 && afterShapes.rects > 0, JSON.stringify({ beforeShapes, afterShapes }));

  // reabrir editor (el redibujado cerró el anterior) y tocar algo para que
  // la clave 'venn-rect' se escriba de verdad en localStorage
  await openEditor();
  const rectOpacityDefault = await c.ev(`(() => {
    const region = document.querySelector('svg.ql-svg rect[data-ce-series-fill]');
    return region ? getComputedStyle(region).fillOpacity : null;
  })()`);
  check('la variante rectángulo arranca con su propia opacidad por defecto (0.3), no el 60% aplicado antes en círculos',
    rectOpacityDefault === '0.3', rectOpacityDefault);

  await c.ev(`(() => {
    const ctl = document.querySelector('.ce-pal-opacity input[type=range]');
    ctl.value = '45'; ctl.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(200);
  const rectKey = await c.ev(`(() => { const raw = localStorage.getItem('smart-175.chartStyle.venn-rect'); return raw ? Object.keys(JSON.parse(raw)) : null; })()`);
  check('la variante "rectángulo" persiste bajo su propia clave venn-rect, sin pisar los estilos ya guardados del Venn de círculos',
    Array.isArray(rectKey) && rectKey.includes('__palette'), JSON.stringify(rectKey));
  const circlesKeyIntact = await c.ev(`(() => { const raw = localStorage.getItem('smart-175.chartStyle.venn'); return raw ? JSON.parse(raw).__palette : null; })()`);
  check('la clave "venn" (círculos) conserva el 60% aplicado antes, sin que el 45% de rectángulo la haya pisado',
    !!circlesKeyIntact && JSON.stringify(circlesKeyIntact).includes('0.6'), JSON.stringify(circlesKeyIntact));

  // ================= escenario B: recarga -> 4 grupos sintéticos, elipses + UpSet =================
  console.log('\n-- recarga con datos sintéticos de 4 grupos (rectángulos/elipses + UpSet) --');
  await c.goto();
  await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); m.loadExampleCounts(); })()`);
  await sleep(1500);
  await c.ev(`location.hash = '#/venn'`);
  await sleep(1500);

  const fourGroupDefault = await c.ev(`(() => ({
    rects: document.querySelectorAll('svg.ql-svg rect[data-ce-series-fill]').length,
    hasUpsetSelect: [...document.querySelectorAll('select')].some((s) => [...s.options].some((o) => /UpSet/i.test(o.textContent))),
  }))()`);
  // Fase 3 (C1): con 4 conjuntos, rectángulos por defecto; las 4 elipses
  // (VENN_LAYOUTS[4], también un Venn correcto) siguen a un clic
  check('con 4 grupos (columna "grupo" sintética) el Venn por defecto usa 4 rectángulos',
    fourGroupDefault.rects === 4, JSON.stringify(fourGroupDefault));
  await c.ev(`(() => { [...document.querySelectorAll('.ql-segmented .ql-seg-btn')].find((b) => /círculos|circles/i.test(b.textContent)).click(); })()`);
  await sleep(600);
  const fourEllipses = await c.ev(`document.querySelectorAll('svg.ql-svg ellipse[data-ce-series-fill]').length`);
  check('...y "Círculos" sigue dibujando las 4 <ellipse> de VENN_LAYOUTS[4]', fourEllipses === 4, String(fourEllipses));
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
