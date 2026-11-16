// Auditoría móvil/tablet — COMPROBACIÓN REAL. Recorre las 19 rutas a 375px
// (móvil) y 768px (tablet) y clasifica lo que encuentra:
//   ROMPE     la página se ensancha más allá del viewport (scroll-x del body /
//             zoom-out), o un control queda fuera de alcance  → FALLA (exit 1)
//   APRETADO  entra pero muy justo  → informativo, no falla
//
//   node tests/mobile-audit.mjs
//
// El criterio de fallo es claro: ancho de layout > viewport (ratio > 1.04).
//
// En la misma pasada por ruta × ancho se audita el menú lateral, que a ≤ 860px
// es un cajón tras un botón "Menú" (js/lib/navDrawer.js): contenido visible sin
// scroll al cargar, botón con nombre accesible + aria-expanded + aria-controls,
// panel superpuesto (no empuja), foco que entra y queda atrapado, controles del
// panel alcanzables, y cierre con Escape / tocando fuera / al navegar. Al final,
// escritorio (> 860px) sin cambios y cierre al agrandar la ventana.
//
// Sale 1 si alguna ruta ROMPE, 0 si todo cabe, 2 si no hay navegador.

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { ROUTES, LOAD_ALL, walkRoute, waitQC, sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

// `EXP` = ancho de viewport que pedimos. En móvil el navegador ensancha el
// layout hasta el contenido más ancho, así que scrollWidth/EXP > 1 ⇒ desborda.
const PROBE = (exp) => `(() => {
  const EXP = ${exp};
  const de = document.documentElement;
  const layoutW = de.scrollWidth;
  const scrollableUp = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 2) return true;
    }
    return false;
  };
  const out = { EXP, layoutW, ratio: +(layoutW / EXP).toFixed(2), widest: [], controlsOut: [] };
  if (layoutW <= EXP + 4) return out;

  const seen = new Set();
  document.querySelectorAll('main *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height === 0) return;
    if (r.width <= EXP + 4) return;              // cabe en el viewport pedido
    if (scrollableUp(el)) return;                 // va dentro de un contenedor con scroll-x → ok
    const tag = el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '');
    if (seen.has(tag)) return;
    seen.add(tag);
    out.widest.push({ tag, w: Math.round(r.width) });
    const ctl = /^(input|select|button|textarea|a)$/.test(el.tagName.toLowerCase());
    if (ctl && r.left > EXP) out.controlsOut.push(tag);
  });
  out.widest.sort((a, b) => b.w - a.w);
  out.widest = out.widest.slice(0, 4);
  return out;
})()`;

// ── Menú lateral como cajón (≤ 860px) ───────────────────────────────────────
const DRAWER_STATE = `(() => {
  const s = document.getElementById('sidebar'), b = document.getElementById('nav-toggle'), m = document.getElementById('app-view');
  const vis = (el) => { const r = el.getBoundingClientRect(), st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
  const sr = s.getBoundingClientRect(), h = m.querySelector('h1, h2');
  return {
    hasToggle: !!b, toggleVisible: !!b && vis(b),
    name: b ? (b.getAttribute('aria-label') || b.textContent || '').trim() : '',
    expanded: b && b.getAttribute('aria-expanded'),
    controlsResolves: !!(b && document.getElementById(b.getAttribute('aria-controls'))),
    panelHidden: getComputedStyle(s).visibility === 'hidden',
    panelInViewport: vis(s) && sr.left >= -1 && sr.right <= innerWidth + 1,
    mainTop: Math.round(m.getBoundingClientRect().top),
    headingBottom: h ? Math.round(h.getBoundingClientRect().bottom) : 0, innerH: innerHeight,
    focusIn: s.contains(document.activeElement), focusOnToggle: document.activeElement === b,
    mainInert: document.querySelector('.ql-main-col').inert,
  };
})()`;
const IS_OPEN = `(() => { const s = document.getElementById('sidebar'); return document.getElementById('nav-toggle').getAttribute('aria-expanded') === 'true' && getComputedStyle(s).visibility === 'visible' && s.getBoundingClientRect().left > -1; })()`; // left > -1: ya terminó de deslizarse
const IS_CLOSED = `(() => { const s = document.getElementById('sidebar'); return document.getElementById('nav-toggle').getAttribute('aria-expanded') === 'false' && getComputedStyle(s).visibility === 'hidden'; })()`;
// el foco de cada control del panel: se puede enfocar (= alcanzable por teclado) y cae dentro del viewport
const PANEL_REACH = `(() => {
  const bad = [];
  const one = (el, name) => { if (!el) { bad.push(name + ' ausente'); return; } el.focus(); const r = el.getBoundingClientRect();
    if (document.activeElement !== el) bad.push(name + ' no recibe foco'); else if (r.left < 0 || r.right > innerWidth + 1) bad.push(name + ' fuera del viewport'); };
  one(document.getElementById('ql-lang-select'), 'selector de idioma');
  const th = [...document.querySelectorAll('#sidebar [data-seg="theme"] button')];
  if (th.length !== 3) bad.push('selector de tema: ' + th.length + ' botones'); th.forEach((b, i) => one(b, 'tema ' + (i + 1)));
  one(document.getElementById('ql-profile-name'), 'nombre local');
  return bad;
})()`;

async function press(c, key, code, vk, modifiers = 0) {
  const p = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  await c.rpc('Input.dispatchKeyEvent', { type: 'keyDown', ...p }, c.sessionId);
  await c.rpc('Input.dispatchKeyEvent', { type: 'keyUp', ...p }, c.sessionId);
}
async function clickAt(c, x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) await c.rpc('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, c.sessionId);
}
// espera (sondeando) a que se cumpla `expr`: cubre los 220ms de la transición sin dormir a ciegas
async function until(c, expr, ms = 900) {
  const t0 = Date.now();
  for (;;) { if (await c.ev(expr)) return true; if (Date.now() - t0 > ms) return false; await sleep(30); }
}

/** Devuelve la lista de fallos del menú a este ancho estrecho (vacía = ok). */
async function drawerAudit(c, route) {
  const bad = [];
  const fail = (m) => bad.push(m);
  const open = async () => { await c.ev(`document.getElementById('nav-toggle').click()`); return until(c, IS_OPEN); };

  await c.ev(`window.scrollTo(0, 0); if (document.activeElement && document.activeElement.blur) document.activeElement.blur()`);
  const s0 = await c.ev(DRAWER_STATE);
  if (!s0.hasToggle || !s0.toggleVisible) return ['no hay botón «Menú» visible'];
  if (!s0.name) fail('el botón de menú no tiene nombre accesible');
  if (s0.expanded !== 'false') fail('aria-expanded inicial = ' + s0.expanded + ' (esperaba "false")');
  if (!s0.controlsResolves) fail('aria-controls no apunta a ningún elemento');
  if (!s0.panelHidden) fail('el menú está visible al cargar (debería estar plegado)');
  if (s0.mainTop > 80) fail('el contenido empieza a ' + s0.mainTop + 'px: no es lo primero visible');
  if (s0.headingBottom > s0.innerH) fail('el título de la página cae fuera de la primera pantalla');

  // abrir con el botón
  if (!(await open())) return bad.concat('el botón no abre el panel');
  const s1 = await c.ev(DRAWER_STATE);
  if (s1.expanded !== 'true') fail('aria-expanded abierto = ' + s1.expanded);
  if (!s1.panelInViewport) fail('el panel abierto no cabe en el viewport');
  if (!s1.focusIn) fail('al abrir, el foco no entra en el panel');
  if (s1.mainTop !== s0.mainTop) fail('abrir el menú empuja el contenido (' + s0.mainTop + 'px → ' + s1.mainTop + 'px)');
  if (!s1.mainInert) fail('el contenido queda accesible detrás del panel (no inert)');
  (await c.ev(PANEL_REACH)).forEach((m) => fail('panel: ' + m));

  // Foco atrapado entre botón y panel: Tab desde el último control vuelve al
  // botón, y Shift+Tab desde el botón va al último control.
  //
  // El último control se calcula, no se da por supuesto. Antes se usaba
  // `ql-profile-name` como si fuera el último, y dejó de serlo en cuanto se
  // añadió el enlace del pie del panel: el atrapador seguía funcionando bien y
  // el test fallaba igual. Lo que se comprueba es la propiedad (el foco da la
  // vuelta), no qué elemento concreto hay al final.
  // Misma regla que `trapFocus`: solo cuentan los controles que de verdad se
  // renderizan en este ancho.
  const FOCUSABLES = `const FOCUSABLES = () => {
    const sel = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    return [...document.getElementById('sidebar').querySelectorAll(sel)].filter((e) => !e.disabled
      && e.getAttribute('tabindex') !== '-1'
      && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
  };`;
  const LAST_IN_PANEL = `(() => {
    ${FOCUSABLES}
    const f = FOCUSABLES();
    const el = f[f.length - 1];
    return el ? (el.id || el.tagName + '.' + String(el.className || '').split(' ')[0]) : null;
  })()`;
  const lastId = await c.ev(LAST_IN_PANEL);
  const focusLast = `(() => {
    ${FOCUSABLES}
    const f = FOCUSABLES();
    const el = f[f.length - 1];
    if (!el) return false;
    el.focus();
    return document.activeElement === el;
  })()`;
  const isLast = `(() => {
    ${FOCUSABLES}
    const f = FOCUSABLES();
    return document.activeElement === f[f.length - 1];
  })()`;
  if (!(await c.ev(focusLast))) fail('el último control del panel no recibe foco' + (lastId ? ' (' + lastId + ')' : ''));
  await press(c, 'Tab', 'Tab', 9);
  if (!(await c.ev(`document.activeElement === document.getElementById('nav-toggle')`))) fail('Tab desde el último control no vuelve al botón (foco no atrapado)');
  await press(c, 'Tab', 'Tab', 9, 8);
  if (!(await c.ev(isLast))) fail('Shift+Tab desde el botón no llega al último control del panel' + (lastId ? ' (' + lastId + ')' : ''));

  // Escape
  await press(c, 'Escape', 'Escape', 27);
  if (!(await until(c, IS_CLOSED))) fail('Escape no cierra el panel');
  else if (!(await c.ev(`document.activeElement === document.getElementById('nav-toggle')`))) fail('al cerrar con Escape el foco no vuelve al botón');
  if (await c.ev(`document.querySelector('.ql-main-col').inert`)) fail('el contenido sigue inert tras cerrar');

  // tocar fuera (el fondo queda a la derecha del panel de ≤ 320px)
  if (!(await open())) return bad.concat('no reabre tras Escape');
  await clickAt(c, (await c.ev('innerWidth')) - 6, 400);
  if (!(await until(c, IS_CLOSED))) fail('tocar fuera no cierra el panel');

  // navegar: a la misma ruta (sin hashchange) y a otra distinta
  if (!(await open())) return bad.concat('no reabre tras tocar fuera');
  await c.ev(`document.querySelector('#sidebar a[aria-current="page"]').click()`);
  if (!(await until(c, IS_CLOSED))) fail('elegir la ruta actual no cierra el panel');
  if (!(await open())) return bad.concat('no reabre tras elegir la ruta actual');
  const other = route === '#/glosario' ? '#/validacion' : '#/glosario';
  await c.ev(`document.querySelector('#sidebar a[href=${JSON.stringify(other)}]').click()`);
  if (!(await until(c, IS_CLOSED))) fail('navegar a otra ruta no cierra el panel');
  if ((await c.ev('location.hash')) !== other) fail('el clic en el menú no navegó a ' + other);
  await c.ev(`location.hash = ${JSON.stringify(route)}`);
  await sleep(150);
  return bad;
}

/** Por encima del breakpoint: el sidebar es el de siempre y no hay botón. */
async function desktopAudit(c, w) {
  const bad = [];
  await c.setViewport(w, 1000);
  await c.ev(`location.hash = '#/'`);
  await sleep(700);
  const st = await c.ev(`(() => { const s = document.getElementById('sidebar'), cs = getComputedStyle(s), r = s.getBoundingClientRect(), b = document.getElementById('nav-toggle'), bd = document.querySelector('.ql-nav-backdrop');
    return { pos: cs.position, w: Math.round(r.width), vis: cs.visibility, tf: cs.transform, toggle: b && b.getClientRects().length ? 'se pinta' : 'none', bar: getComputedStyle(document.querySelector('.ql-navbar')).display, backdrop: bd ? getComputedStyle(bd).display : 'none', inert: document.querySelector('.ql-main-col').inert }; })()`);
  if (st.pos !== 'sticky' || st.w !== 240 || st.vis !== 'visible' || st.tf !== 'none') bad.push('sidebar cambiado: ' + JSON.stringify(st));
  if (st.toggle !== 'none' || st.bar !== 'none' || st.backdrop !== 'none') bad.push('botón/barra/fondo visibles en escritorio: ' + JSON.stringify(st));
  if (st.inert) bad.push('el contenido está inert en escritorio');
  return bad;
}

const c = await connect({ url: server.url + '/index.html', label: 'mobile-audit' });
try {
  await c.goto();
  await sleep(1600);
  await c.ev(LOAD_ALL);
  await sleep(2500);
  await waitQC(c);

  const summary = { rompe: [], apretado: [] };
  for (const [w, tag] of [[375, 'MÓVIL 375px'], [768, 'TABLET 768px']]) {
    await c.setViewport(w, 1600);
    console.log('\n════════ ' + tag + ' ════════');
    for (const route of ROUTES) {
      c.setLabel(route + ' @' + w);
      await walkRoute(c, route, { report: route === '#/informe' });
      await sleep(150);
      const r = await c.ev(PROBE(w));
      const menuBad = await drawerAudit(c, route);
      const menuTag = menuBad.length ? `  ✗ menú: ${menuBad.join('; ')}` : '  · menú ok';
      if (menuBad.length) summary.rompe.push(`${route} @${w}px menú: ${menuBad.join('; ')}`);
      if (r.ratio > 1.04) {
        const worst = r.widest.map((x) => `${x.tag}=${x.w}px`).join(', ');
        const ctl = r.controlsOut.length ? `  ⚠ controles fuera: ${r.controlsOut.join(', ')}` : '';
        console.log(`  ✗ ${route.padEnd(15)} desborda ×${r.ratio}  (layout ${r.layoutW}px)  ${worst}${ctl}${menuTag}`);
        summary.rompe.push(`${route} @${w}px ×${r.ratio}${ctl ? ' + control inalcanzable' : ''}`);
      } else if (r.ratio > 1.0) {
        console.log(`  ~ ${route.padEnd(15)} justo ×${r.ratio}${menuTag}`);
        summary.apretado.push(`${route} @${w}px ×${r.ratio}`);
      } else {
        console.log(`  ✓ ${route.padEnd(15)} ok${menuTag}`);
      }
    }
  }

  // escritorio: por encima del breakpoint no debe haber cambiado nada, y un panel
  // abierto en estrecho se cierra solo al agrandar la ventana
  console.log('\n════════ ESCRITORIO (> 860px) ════════');
  for (const w of [861, 1280]) {
    c.setLabel('desktop @' + w);
    const bad = await desktopAudit(c, w);
    console.log(`  ${bad.length ? '✗' : '✓'} ${String(w).padEnd(5)} sidebar fijo de 240px, sin botón de menú${bad.length ? '  ' + bad.join('; ') : ''}`);
    bad.forEach((m) => summary.rompe.push(`escritorio @${w}px: ${m}`));
  }
  {
    c.setLabel('resize');
    await c.setViewport(375, 1000);
    await sleep(300);
    await c.ev(`document.getElementById('nav-toggle').click()`);
    const opened = await until(c, IS_OPEN);
    await c.setViewport(1280, 1000);
    const closed = opened && await until(c, `!document.querySelector('.ql-main-col').inert && !document.documentElement.classList.contains('ql-nav-open')`);
    console.log(`  ${closed ? '✓' : '✗'} panel abierto a 375px → se cierra al pasar a 1280px`);
    if (!closed) summary.rompe.push('resize: el panel no se cierra (o no abre) al cambiar de estrecho a escritorio');
  }

  console.log('\n──────── RESUMEN ────────');
  console.log('ROMPE (' + summary.rompe.length + '):');
  summary.rompe.forEach((s) => console.log('  · ' + s));
  console.log('APRETADO (' + summary.apretado.length + '):');
  summary.apretado.forEach((s) => console.log('  · ' + s));

  c.kill();
  if (server.started) server.stop();
  if (summary.rompe.length) {
    console.log('\n✗ ' + summary.rompe.length + ' problema(s): desborde del viewport o menú lateral roto');
    process.exit(1);
  }
  console.log('\n✓ ninguna ruta desborda a 375px ni 768px, y el menú lateral (cajón ≤ 860px) se comporta');
  process.exit(0);
} catch (e) {
  console.error('EXCEPCIÓN:', e.message);
  c.kill();
  if (server.started) server.stop();
  process.exit(1);
}
