// tests/server-smoke.mjs — humo de infraestructura: ¿llega el Chrome
// controlado por CDP al servidor de test? No basta con que Node pueda hacer
// fetch (lo que comprueba ensureServer): si Chrome no llega, la navegación
// acaba en chrome-error://chromewebdata/ y cada suite falla después con un
// críptico "Failed to fetch dynamically imported module: chrome-error://…".
// Aquí se comprueba en orden /index.html, /js/app.js y un import() dinámico,
// y si algo falla sale con 1 y el código SERVER_REACHABILITY_FROM_CHROME.
// tests/run.mjs lo corre antes de las suites de navegador y, si falla, no
// las lanza (evita decenas de fallos en cascada que no son del código).
//
//   node tests/server-smoke.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'server-smoke' });
const fail = (what, detail) => {
  console.log(`  ✗ SERVER_REACHABILITY_FROM_CHROME: Chrome cannot reach ${server.url} — ${what}${detail ? ' (' + detail + ')' : ''}`);
  console.log('\nRESULTADO: FAIL');
  c.kill();
  if (server.started) server.stop();
  process.exit(1);
};
// espera a que la página cargue en un origen http (no chrome-error://)
const settled = async () => {
  for (let i = 0; i < 40; i++) {
    const s = await c.ev(`({ href: location.href, ready: document.readyState, ct: document.contentType })`).catch(() => null);
    if (s && s.ready === 'complete') return s;
    await sleep(150);
  }
  return c.ev(`({ href: location.href, ready: document.readyState, ct: document.contentType })`);
};

try {
  console.log('servidor: ' + server.url + (server.started ? ' (arrancado por este test)' : ' (reutilizado)'));

  await c.goto(server.url + '/index.html').catch((e) => fail('/index.html', e.message));
  let s = await settled();
  if (!/^https?:/.test(s.href)) fail('/index.html', 'la navegación acabó en ' + s.href);
  console.log('  ✓ /index.html carga en ' + s.href);

  await c.goto(server.url + '/js/app.js').catch((e) => fail('/js/app.js', e.message));
  s = await settled();
  const js = await c.ev(`document.body ? document.body.innerText.slice(0, 2000) : ''`);
  if (!/^https?:/.test(s.href) || !/\bimport\b/.test(js)) fail('/js/app.js', 'no se sirvió el módulo: ' + s.href + ' ' + s.ct);
  console.log('  ✓ /js/app.js se sirve (' + s.ct + ')');

  await c.goto(server.url + '/index.html').catch((e) => fail('/index.html (2ª vez)', e.message));
  await settled();
  const imp = await c.ev(`import('/js/lib/exampleData.js').then((m) => typeof m.loadRealCommunityData, (e) => 'ERROR: ' + e.message)`);
  if (imp !== 'function') fail('import() dinámico de /js/lib/exampleData.js', imp);
  console.log('  ✓ import() dinámico de /js/lib/exampleData.js resuelve');

  console.log('\nRESULTADO: PASS');
} finally {
  c.kill();
  if (server.started) server.stop();
}
process.exit(0);
