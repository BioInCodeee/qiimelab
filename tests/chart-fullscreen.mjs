// El botón "Pantalla completa" del editor de gráficos (js/lib/chartEditor.js)
// mueve el <svg> real (no una copia) y su barra de herramientas a un modal
// ancho, reutilizable en TODOS los módulos que llaman a attachChartEditor —
// aquí se comprueba en dos módulos distintos (barplots y diversidad alfa)
// que: el mismo nodo <svg> pasa a vivir dentro del modal, sigue siendo
// editable/descargable desde ahí, y al cerrar vuelve exactamente a su sitio.
//
//   node tests/chart-fullscreen.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'chart-fullscreen' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

async function testModule(route, svgSelector) {
  await c.ev(`location.hash = ${JSON.stringify('#/' + route)}`);
  await sleep(1500);

  const before = await c.ev(`(() => {
    const svg = document.querySelector(${JSON.stringify(svgSelector)});
    if (!svg) return { err: 'no hay svg' };
    window.__svg = svg;
    svg.dataset.qlTestTag = 'tag-' + Math.random().toString(36).slice(2);
    window.__homeParent = svg.parentNode;
    return { tag: svg.dataset.qlTestTag, vb: svg.getAttribute('viewBox') };
  })()`);
  if (before.err) { check(route + ': encuentra el <svg>', false, before.err); return; }

  const clicked = await c.ev(`(() => {
    const btn = [...document.querySelectorAll('.ce-toolbar button')]
      .find((b) => /Pantalla completa|Full screen/.test(b.textContent));
    if (!btn) return { err: 'no hay botón de pantalla completa' };
    btn.click();
    return { ok: true };
  })()`);
  await sleep(500);
  check(route + ': el botón de pantalla completa existe y se puede pulsar', clicked.ok === true, JSON.stringify(clicked));

  const opened = await c.ev(`(() => {
    const dlg = document.querySelector('.ql-modal-wide[role="dialog"]');
    if (!dlg) return { err: 'no hay modal' };
    const svgInModal = dlg.querySelector('svg[data-ql-test-tag="' + window.__svg.dataset.qlTestTag + '"]');
    return {
      hasModal: true,
      ariaModal: dlg.getAttribute('aria-modal'),
      sameSvgNode: svgInModal === window.__svg,
      hasToolbarInside: !!dlg.querySelector('.ce-toolbar'),
      homeNowEmpty: !window.__homeParent.contains(window.__svg),
    };
  })()`);
  check(route + ': se abre un modal ancho accesible (role=dialog, aria-modal)',
    opened.hasModal === true && opened.ariaModal === 'true', JSON.stringify(opened));
  check(route + ': el modal contiene el MISMO nodo <svg> (no una copia)', opened.sameSvgNode === true, JSON.stringify(opened));
  check(route + ': la barra de herramientas del editor viaja con él', opened.hasToolbarInside === true, JSON.stringify(opened));
  check(route + ': el hueco original ya no lo contiene mientras está a pantalla completa', opened.homeNowEmpty === true, JSON.stringify(opened));

  // la descarga de SVG sigue funcionando desde dentro del modal
  const dl = await c.ev(`(async () => {
    const dlg = document.querySelector('.ql-modal-wide');
    // formato SVG en el desplegable + botón Descargar (Fase 1)
    const sel = dlg.querySelector('.ce-toolbar .ce-export-format');
    const btn = dlg.querySelector('.ce-toolbar .ce-download-btn');
    if (!sel || !btn) return { err: 'no hay desplegable/botón de descarga en el modal' };
    sel.value = 'svg';
    let captured = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (blob) => { captured = blob; return orig.call(URL, blob); };
    btn.click();
    await new Promise((r) => setTimeout(r, 150));
    URL.createObjectURL = orig;
    if (!captured) return { err: 'no se llamó a createObjectURL' };
    const text = await captured.text();
    return { type: captured.type, size: captured.size, looksLikeSvg: /<svg[\\s>]/.test(text) };
  })()`);
  check(route + ': descargar en SVG sigue funcionando desde el modal (produce un .svg real)',
    dl.looksLikeSvg === true && dl.size > 0, JSON.stringify(dl));

  // cerrar con Escape y comprobar que vuelve exactamente a su sitio
  await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(400);
  const closed = await c.ev(`(() => ({
    modalGone: !document.querySelector('.ql-modal-wide'),
    backHome: window.__homeParent.contains(window.__svg),
    stillHasTag: window.__svg.dataset.qlTestTag ? true : false,
  }))()`);
  check(route + ': Escape cierra el modal', closed.modalGone === true, JSON.stringify(closed));
  check(route + ': el <svg> vuelve exactamente a su sitio original', closed.backHome === true, JSON.stringify(closed));
}

try {
  await c.goto();
  await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); })()`);
  await sleep(2500);

  await testModule('barplots', '.ql-svg');
  await testModule('alfa', '.ql-svg');

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
