// tests/button-hover.mjs — micro-interacción de los botones .ql-btn (pulido
// visual): con el ratón REAL encima (Input.dispatchMouseEvent, que activa
// :hover de verdad) el botón crece a scale(1.04) y proyecta sombra, en 7
// módulos distintos; con prefers-reduced-motion: reduce emulado NO se
// transforma; en un dispositivo sin hover (táctil) tampoco; y un botón
// deshabilitado no reacciona.
//
//   node tests/button-hover.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep, LOAD_ALL } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

// Chrome headless no tiene dispositivo apuntador (hover: none, y la
// característica "hover" no se puede emular con setEmulatedMedia): se lanza
// declarando un ratón de escritorio, que es donde aplica la micro-interacción
const DESKTOP_POINTER = '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4';
const c = await connect({ url: server.url + '/index.html', label: 'button-hover', chromeArgs: [DESKTOP_POINTER] });
await c.setViewport(1280, 900);
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

// primer .ql-btn visible y habilitado de la vista (o el que cumpla `pick`)
// (el que de verdad queda bajo el puntero: no tapado por una cabecera fija)
const FIND = (pick = 'true') => `(() => {
  for (const x of document.querySelectorAll('#app-view .ql-btn')) { // "x" = el botón (lo usan las condiciones pick)
    const r0 = x.getBoundingClientRect();
    if (!(r0.width > 20 && r0.height > 10 && getComputedStyle(x).visibility !== 'hidden' && (${pick}))) continue;
    x.scrollIntoView({ block: 'center' });
    const r = x.getBoundingClientRect();
    const px = r.x + r.width / 2, py = r.y + r.height / 2;
    const hit = document.elementFromPoint(px, py);
    if (!hit || !(hit === x || x.contains(hit))) continue;
    x.setAttribute('data-hover-probe', '1');
    return { x: px, y: py, text: x.textContent.trim().slice(0, 30) };
  }
  return null;
})()`;
const moveTo = (x, y) => c.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, c.sessionId);
const probe = () => c.ev(`(() => { const b = document.querySelector('[data-hover-probe]'); const cs = getComputedStyle(b); b.removeAttribute('data-hover-probe'); return { t: cs.transform, s: cs.boxShadow, hover: b.matches(':hover') }; })()`);
async function hoverFirst(pick) {
  const at = await c.ev(FIND(pick));
  if (!at) return null;
  await moveTo(5, 5); await sleep(150);
  await moveTo(at.x, at.y); await sleep(450); // > --dur (0.14s)
  return { ...at, ...(await probe()) };
}
const scaled = (t) => /^matrix\(1\.04, 0, 0, 1\.04,/.test(t);

try {
  await c.goto(); await sleep(1500);
  await c.ev(LOAD_ALL); await sleep(1200);
  check('Chrome declara un ratón de escritorio (media hover: hover)', await c.ev(`matchMedia('(hover: hover)').matches`));

  console.log('\n-- hover en 7 módulos (movimiento normal) --');
  const ROUTES = ['#/', '#/barplots', '#/alfa', '#/recuentos', '#/primers', '#/arbol', '#/calculadora'];
  let okCount = 0;
  for (const r of ROUTES) {
    await c.ev(`location.hash = '#/cargar'`); await sleep(300);
    await c.ev(`location.hash = ${JSON.stringify(r)}`); await sleep(1500);
    const h = await hoverFirst('!x.disabled');
    const ok = !!h && h.hover && scaled(h.t) && h.s !== 'none';
    if (ok) okCount++;
    check(`${r}: "${h ? h.text : '—'}" crece a 1.04 y proyecta sombra`, ok, h ? JSON.stringify({ t: h.t, s: h.s.slice(0, 40) }) : 'sin botón');
  }
  check('consistente: la misma micro-interacción en los 7 módulos', okCount === ROUTES.length, okCount + '/' + ROUTES.length);

  console.log('\n-- botón deshabilitado --');
  await c.ev(`location.hash = '#/sanger'`); await sleep(1500);
  await c.ev(`(() => { const b = document.createElement('button'); b.className = 'ql-btn'; b.disabled = true; b.textContent = 'deshabilitado'; b.id = 'probeDisabled'; document.querySelector('#app-view').prepend(b); })()`);
  const d = await hoverFirst("x.id === 'probeDisabled'");
  check('un .ql-btn deshabilitado no escala', !!d && d.t === 'none', d && d.t);

  console.log('\n-- prefers-reduced-motion: reduce --');
  await c.rpc('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, c.sessionId);
  await c.ev(`location.hash = '#/barplots'`); await sleep(1500);
  const rm = await hoverFirst('!x.disabled');
  check('con movimiento reducido el botón NO se transforma al pasar el ratón', !!rm && rm.hover && !scaled(rm.t), rm && rm.t);
  check('...ni tiene transición (base.css corta todas)', await c.ev(`parseFloat(getComputedStyle(document.querySelector('#app-view .ql-btn')).transitionDuration) < 0.01`));
  await c.rpc('Emulation.setEmulatedMedia', { media: '', features: [] }, c.sessionId);

  check('sin errores de consola', c.problems.length === 0, c.problems.join('; '));

  console.log('\n-- sin puntero con hover (táctil) --');
  // un Chrome SIN --blink-settings es justo un dispositivo sin hover
  const c2 = await connect({ url: server.url + '/index.html', label: 'button-hover-touch' });
  try {
    await c2.goto(); await sleep(1200);
    const r = await c2.ev(`(() => { const b = document.querySelector('.ql-btn'); b.scrollIntoView({ block: 'center' }); const x = b.getBoundingClientRect(); b.id = 'probeTouch'; return { x: x.x + x.width / 2, y: x.y + x.height / 2, hover: matchMedia('(hover: hover)').matches }; })()`);
    await c2.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y }, c2.sessionId); await sleep(450);
    const t = await c2.ev(`getComputedStyle(document.getElementById('probeTouch')).transform`);
    check('sin hover (táctil) el botón no escala aunque reciba el puntero — nada de hover "pegado"', !r.hover && !scaled(t), JSON.stringify({ hoverMedia: r.hover, t }));
  } finally { c2.kill(); }
} catch (e) {
  console.error('EXCEPCIÓN:', e.message);
  failed = true;
} finally {
  c.kill();
  if (server.started) server.stop();
}
console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);

