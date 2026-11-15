// tests/mapa-placa-ui.mjs — #/mapa-placa en Chrome de verdad.
//
// Lo que se prueba aquí no se puede comprobar leyendo el código: que el
// ARRASTRE selecciona. Es el requisito del módulo — seleccionar pocillos
// arrastrando en vez de teclear sus nombres — y depende de cosas que solo
// existen en un navegador: eventos de puntero, `elementFromPoint`, captura de
// puntero y que la rejilla no se coma el gesto para desplazar la página.
//
// El arrastre se simula con eventos de puntero reales despachados sobre las
// coordenadas que devuelve getBoundingClientRect de cada pocillo, no llamando
// a las funciones internas: si la rejilla cambiara de maquetación y los
// pocillos dejaran de estar donde se cree, este test lo vería.
//
//   node tests/mapa-placa-ui.mjs

import { findChrome } from './lib/env.mjs';

let failed = 0;
function check(name, ok, detail = '') {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (!ok && detail ? '  → ' + detail : ''));
  if (!ok) failed++;
}

if (!findChrome()) {
  console.log('SKIP: sin Chrome');
  process.exit(2);
}

const { ensureServer } = await import('./lib/server.mjs');
const { connect } = await import('./lib/cdp.mjs');
const { sleep } = await import('./lib/app.mjs');
const server = await ensureServer();

/** Despacha un arrastre de puntero del pocillo `from` al pocillo `to`. */
const dragJs = (from, to, opts = {}) => `(() => {
  const grid = document.querySelector('.ql-pm-grid');
  const a = document.querySelector('[data-well="${from}"]');
  const b = document.querySelector('[data-well="${to}"]');
  if (!grid || !a || !b) return { error: 'faltan elementos' };
  const mid = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const pa = mid(a); const pb = mid(b);
  const base = { pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true,
    shiftKey: ${!!opts.shift}, ctrlKey: ${!!opts.ctrl} };
  a.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: pa.x, clientY: pa.y }));
  // un par de pasos intermedios, como haría un dedo de verdad
  for (let i = 1; i <= 3; i++) {
    const x = pa.x + (pb.x - pa.x) * (i / 3);
    const y = pa.y + (pb.y - pa.y) * (i / 3);
    grid.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: x, clientY: y }));
  }
  grid.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: pb.x, clientY: pb.y }));
  return { ok: true };
})()`;

const selectedJs = `[...document.querySelectorAll('.ql-pm-well.is-sel')].map((e) => e.dataset.well)`;

const c = await connect({ url: server.url + '/index.html#/mapa-placa', label: 'mapa-placa' });
try {
  await c.goto();
  await sleep(1500);
  await c.ev(`localStorage.removeItem('smart-175.mapaPlaca')`);
  await c.goto();
  await sleep(1500);

  // --- la rejilla existe y tiene los pocillos que debe ---
  const wells = await c.ev(`document.querySelectorAll('.ql-pm-well').length`);
  check('la placa de 96 dibuja 96 pocillos', wells === 96, String(wells));
  check('la rejilla desactiva el gesto de desplazar, o el arrastre no llegaría',
    (await c.ev(`getComputedStyle(document.querySelector('.ql-pm-grid')).touchAction`)) === 'none');

  // --- el arrastre, que es el requisito del módulo ---
  const d = await c.ev(dragJs('B2', 'D5'));
  check('el arrastre se despacha sobre elementos reales', d && d.ok === true, JSON.stringify(d));
  let sel = await c.ev(selectedJs);
  check('arrastrar de B2 a D5 selecciona el rectángulo de 12 pocillos',
    sel.length === 12, `${sel.length}: ${sel.slice(0, 5).join(',')}`);
  check('y son exactamente los del rectángulo',
    ['B2', 'B5', 'D2', 'D5', 'C3'].every((w) => sel.includes(w))
    && !sel.includes('A1') && !sel.includes('E2'), sel.join(','));

  // --- arrastre hacia atrás: las esquinas valen en cualquier orden ---
  await c.ev(dragJs('D5', 'B2'));
  sel = await c.ev(selectedJs);
  check('arrastrar en sentido contrario da el mismo rectángulo', sel.length === 12);

  // --- un arrastre nuevo sustituye la selección anterior ---
  await c.ev(dragJs('G1', 'G3'));
  sel = await c.ev(selectedJs);
  check('un arrastre nuevo sustituye a la selección anterior',
    sel.length === 3 && sel.every((w) => w.startsWith('G')), sel.join(','));

  // --- mayúsculas suma ---
  await c.ev(dragJs('A1', 'A2', { shift: true }));
  sel = await c.ev(selectedJs);
  check('con mayúsculas se suma a lo ya seleccionado', sel.length === 5, sel.join(','));

  // --- control quita ---
  await c.ev(dragJs('G1', 'G1', { ctrl: true }));
  sel = await c.ev(selectedJs);
  check('con Control se quita de la selección',
    sel.length === 4 && !sel.includes('G1'), sel.join(','));

  // --- cabeceras de fila y columna, y la esquina ---
  await c.ev(`[...document.querySelectorAll('.ql-pm-head')].find((e) => e.textContent === 'C').click()`);
  sel = await c.ev(selectedJs);
  check('tocar la letra de una fila selecciona la fila entera',
    sel.length === 12 && sel.every((w) => w.startsWith('C')), sel.join(','));

  await c.ev(`[...document.querySelectorAll('.ql-pm-head')].find((e) => e.textContent === '4').click()`);
  sel = await c.ev(selectedJs);
  check('tocar el número de una columna selecciona la columna entera',
    sel.length === 8 && sel.every((w) => w.endsWith('4')), sel.join(','));

  await c.ev(`document.querySelector('.ql-pm-head').click()`);
  sel = await c.ev(selectedJs);
  check('la esquina selecciona la placa entera', sel.length === 96, String(sel.length));

  // --- aplicar una etiqueta a lo seleccionado ---
  await c.ev(dragJs('A1', 'A3'));
  await c.ev(`(() => {
    const panel = document.querySelector('.ql-panel:last-of-type');
    const inp = panel.querySelector('input[type="text"]');
    inp.value = 'Control';
    const btn = [...panel.querySelectorAll('button')].find((b) => b.classList.contains('ql-btn-primary'));
    btn.click();
  })()`);
  await sleep(300);
  const labelled = await c.ev(`[...document.querySelectorAll('.ql-pm-well')]
    .filter((e) => e.textContent.trim() === 'Control').map((e) => e.dataset.well)`);
  check('aplicar una etiqueta la escribe en los tres pocillos arrastrados',
    labelled.length === 3 && labelled.join(',') === 'A1,A2,A3', labelled.join(','));

  const stored = await c.ev(`JSON.parse(localStorage.getItem('smart-175.mapaPlaca') || '{}').map || {}`);
  check('y queda guardado en localStorage', stored.A1 && stored.A1.etiqueta === 'Control',
    JSON.stringify(stored).slice(0, 120));

  // --- cambiar de formato no deja pocillos huérfanos en pantalla ---
  await c.ev(`(() => { const s = [...document.querySelectorAll('select')]
    .find((x) => [...x.options].some((o) => o.value === '384'));
    s.value = '384'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(400);
  const n384 = await c.ev(`document.querySelectorAll('.ql-pm-well').length`);
  check('cambiar a 384 redibuja la rejilla entera', n384 === 384, String(n384));
  check('y no deja nada seleccionado del formato anterior',
    (await c.ev(selectedJs)).length === 0);

  // --- pulido: Escape, deshacer, leyenda y preset de qPCR ---
  await c.ev(dragJs('A1', 'A3'));
  await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(200);
  check('Escape quita la selección', (await c.ev(selectedJs)).length === 0);

  await c.ev(dragJs('B1', 'B3'));
  await c.ev(`(() => { const p = document.querySelector('.ql-panel:last-of-type');
    [...p.querySelectorAll('button')].find((b) => b.textContent === 'Vaciar').click(); })()`);
  await sleep(300);
  await c.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Deshacer').click()`);
  await sleep(300);
  const tras = await c.ev(`[...document.querySelectorAll('.ql-pm-well')]
    .filter((e) => e.textContent.trim() === 'Control').length`);
  check('deshacer devuelve lo que se acababa de vaciar', tras === 3, String(tras));

  check('la leyenda enseña los grupos que hay en la placa',
    (await c.ev(`document.querySelectorAll('.ql-pm-chip').length`)) >= 1);

  await c.ev(`(() => {
    const d = document.querySelector('.ql-pm-preset');
    d.open = true;
    const ins = d.querySelectorAll('input');
    ins[0].value = 'M1, M2'; ins[1].value = '16S, DIANA'; ins[2].value = '3';
    [...d.querySelectorAll('button')].find((b) => b.textContent === 'Repartir').click();
  })()`);
  await sleep(500);
  const qp = await c.ev(`[...document.querySelectorAll('.ql-pm-well')]
    .filter((e) => e.textContent.trim().startsWith('NTC')).length`);
  check('el preset de qPCR reparte y deja los controles sin molde', qp === 4, String(qp));
  const banda = await c.ev(`document.querySelector('[data-well="A1"]').textContent.trim()`);
  check('y la primera banda arranca en A1 con la primera muestra', banda === 'M1', banda);

  check('0 errores de consola', c.problems.length === 0, c.problems.slice(0, 3).join(' | '));
} catch (e) {
  check('sin excepciones', false, e.stack || String(e));
} finally {
  c.kill();
}
if (server.started) server.stop();

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
