// PWA: manifest válido + el service worker registra, toma el control y sirve
// el shell de la app sin red.
//
//   node tests/pwa.mjs
//
// 1) manifest.json es JSON válido con los campos obligatorios y sus iconos
//    existen en disco.
// 2) tras la primera carga el SW queda activo y controlando la página
//    (nuestro sw.js hace clients.claim() en activate).
// 3) con la red simulada como offline vía CDP, una segunda navegación sigue
//    pintando el shell (sidebar + main + footer) desde caché, y aparece el
//    banner "sin conexión".

import { readFileSync, existsSync } from 'node:fs';
import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip, APP_ROOT } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed = true;
};

// ---------- 1) manifest.json (estático, no necesita navegador) ----------
console.log('manifest.json');
let manifest = null;
try {
  manifest = JSON.parse(readFileSync(APP_ROOT + '/manifest.json', 'utf8'));
  check('es JSON válido', true);
} catch (e) {
  check('es JSON válido', false, e.message);
}
if (manifest) {
  for (const field of ['name', 'start_url', 'scope', 'display', 'theme_color', 'background_color', 'icons']) {
    check('campo obligatorio: ' + field, manifest[field] != null && manifest[field] !== '');
  }
  check('display = standalone|fullscreen|minimal-ui', ['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display), manifest.display);
  check('start_url / scope relativos', !/^https?:\/\//.test(manifest.start_url || '') && !/^https?:\/\//.test(manifest.scope || ''));
  check('theme_color es un color', /^#[0-9a-f]{3,8}$/i.test(manifest.theme_color || ''), manifest.theme_color);
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  check('≥ 1 icono con src', icons.length > 0 && icons.every((i) => i.src));
  check('los archivos de icono existen', icons.every((i) => existsSync(APP_ROOT + '/' + i.src)),
    icons.map((i) => i.src).join(', '));
  check('hay un icono maskable', icons.some((i) => (i.purpose || '').includes('maskable')));
}

// index.html enlaza el manifest
const html = readFileSync(APP_ROOT + '/index.html', 'utf8');
check('index.html tiene <link rel="manifest">', /<link[^>]+rel=["']manifest["']/.test(html));

// ---------- 2) + 3) service worker (necesita navegador) ----------
if (!findChrome()) skip('no se encontró Chrome/Chromium (checks de manifest ya ejecutados)');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'pwa' });
try {
  console.log('\nservice worker');
  await c.goto();
  await sleep(1500);

  // esperar a que el SW registre, active y tome el control (clients.claim)
  let sw = { controlled: false, active: false, scope: '' };
  for (let i = 0; i < 40; i++) {
    sw = await c.ev(`(async () => {
      if (!('serviceWorker' in navigator)) return { unsupported: true };
      const reg = await navigator.serviceWorker.getRegistration();
      return {
        active: !!(reg && reg.active),
        controlled: !!navigator.serviceWorker.controller,
        scope: reg ? reg.scope : '',
      };
    })()`);
    if (sw.unsupported) break;
    if (sw.active && sw.controlled) break;
    await sleep(400);
  }
  check('el SW no reporta "unsupported"', !sw.unsupported);
  check('el SW queda activo', !!sw.active);
  check('el SW controla la página tras la 1ª carga', !!sw.controlled, sw.scope);

  // caché poblada con el shell
  const cached = await c.ev(`(async () => {
    const names = await caches.keys();
    const c = await caches.open(names.find((n) => n.startsWith('smart-175-') || n.startsWith('qiimelab-')) || names[0]);
    const keys = await c.keys();
    return keys.map((r) => new URL(r.url).pathname);
  })()`);
  check('la caché contiene index.html / la raíz', cached.some((p) => /\/(index\.html)?$/.test(p)), cached.length + ' entradas');
  check('la caché contiene js/app.js', cached.some((p) => p.endsWith('/js/app.js')));

  // ---------- offline ----------
  console.log('\noffline (red simulada por CDP)');
  await c.rpc('Network.enable', {}, c.sessionId);
  await c.rpc('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  }, c.sessionId);

  c.setLabel('pwa-offline');
  const problemsBefore = c.problems.length;
  await c.goto(); // segunda navegación, ya sin red
  await sleep(2500);

  const shell = await c.ev(`(() => ({
    sidebar: document.querySelectorAll('#sidebar a, #sidebar .ql-nav-item').length,
    mainKids: document.getElementById('app-view').childElementCount,
    footer: !!document.querySelector('.ql-footer-inner'),
    title: document.title,
  }))()`);
  check('el shell se sirve sin red: sidebar con enlaces', shell.sidebar >= 5, shell.sidebar + ' enlaces');
  check('el shell se sirve sin red: #app-view con contenido', shell.mainKids > 0);
  check('el shell se sirve sin red: footer presente', shell.footer);
  check('document.title correcto', /Smart-175/.test(shell.title || ''), shell.title);

  const newProblems = c.problems.slice(problemsBefore)
    .filter((p) => !/Failed to load resource|net::ERR|fonts\.(googleapis|gstatic)/.test(p));
  check('sin errores de consola nuevos en la carga offline', newProblems.length === 0, newProblems.join('; '));

  // El banner "sin conexión" reacciona al evento 'offline' del navegador. La
  // emulación de red de CDP no siempre lo dispara (ni actualiza
  // navigator.onLine) en headless, así que lo lanzamos a mano y comprobamos
  // que js/lib/pwa.js reacciona — que es lo que de verdad se quiere verificar.
  const banner = await c.ev(`(() => {
    window.dispatchEvent(new Event('offline'));
    const el = document.querySelector('#ql-pwa-bar.is-offline');
    return { shown: !!(el && !el.hidden), text: el ? el.textContent : '' };
  })()`);
  check('el evento "offline" muestra el banner "sin conexión"', banner.shown, JSON.stringify(banner.text.slice(0, 40)));
  const hidden = await c.ev(`(() => {
    window.dispatchEvent(new Event('online'));
    const el = document.querySelector('#ql-pwa-bar');
    return !el || el.hidden || !el.classList.contains('is-offline');
  })()`);
  check('el evento "online" oculta el banner', hidden);
} catch (e) {
  console.error('EXCEPCIÓN:', e.message);
  failed = true;
} finally {
  c.kill();
  if (server.started) server.stop();
}

console.log('\nRESULTADO pwa: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
