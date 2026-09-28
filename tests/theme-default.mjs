// tests/theme-default.mjs
// Tema por defecto (28 sep 2026): quien entra sin nada guardado ve la app en
// OSCURO aunque su sistema operativo pida claro; quien ya tenía 'light' o
// 'dark' guardado lo conserva; «Automático» sigue existiendo como elección
// explícita y ahora se guarda ('auto'), porque sin nada guardado ya no
// significaría «seguir al sistema». Se prueba en Chrome con el arranque
// virgen (connect({ theme: null })), tanto con el SO en claro como en oscuro.

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

const probe = `(() => ({
  attr: document.documentElement.getAttribute('data-theme'),
  stored: localStorage.getItem('smart-175.theme'),
  page: getComputedStyle(document.body).backgroundColor,
  pressed: [...document.querySelectorAll('.ql-segmented .ql-seg-btn[aria-pressed="true"]')].map((b) => b.textContent),
}))()`;
// fondo oscuro = luminancia baja
const isDark = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (r + g + b) / 3 < 80; };

for (const osDark of [false, true]) {
  const os = osDark ? 'SO en oscuro' : 'SO en claro';
  console.log(`\n--- ${os} ---`);
  const c = await connect({ dark: osDark, theme: null, url: server.url + '/index.html', label: 'theme-' + os });
  try {
    await c.goto(); await sleep(1200);
    await c.ev(`localStorage.clear()`);
    await c.goto(); await sleep(1500);
    let p = await c.ev(probe);
    check(`${os} · sin nada guardado → oscuro (data-theme="dark")`, p.attr === 'dark' && isDark(p.page), JSON.stringify(p));
    check(`${os} · sin nada guardado no se escribe nada en localStorage`, p.stored === null, String(p.stored));
    check(`${os} · el selector marca «Oscuro»`, p.pressed.length === 1 && /oscuro/i.test(p.pressed[0]), JSON.stringify(p.pressed));

    for (const saved of ['light', 'dark']) {
      await c.ev(`localStorage.clear(); localStorage.setItem('smart-175.theme', '${saved}')`);
      await c.goto(); await sleep(1300);
      p = await c.ev(probe);
      check(`${os} · guardado '${saved}' → se respeta tal cual`, p.attr === saved && isDark(p.page) === (saved === 'dark') && p.stored === saved, JSON.stringify(p));
    }

    // «Automático» desde el selector: se guarda y sigue al sistema
    await c.ev(`localStorage.clear()`);
    await c.goto(); await sleep(1300);
    await c.ev(`[...document.querySelectorAll('.ql-segmented .ql-seg-btn')].find((b) => /auto/i.test(b.textContent)).click()`);
    await sleep(300);
    p = await c.ev(probe);
    check(`${os} · «Automático» se guarda ('auto') y quita data-theme`, p.stored === 'auto' && p.attr === null, JSON.stringify(p));
    await c.goto(); await sleep(1300);
    p = await c.ev(probe);
    check(`${os} · tras recargar, «Automático» sigue al sistema`, p.attr === null && isDark(p.page) === osDark && p.stored === 'auto', JSON.stringify(p));

    // la clave antigua (qiimelab.theme) también cuenta como preferencia guardada
    await c.ev(`localStorage.clear(); localStorage.setItem('qiimelab.theme', 'light')`);
    await c.goto(); await sleep(1500);
    p = await c.ev(probe);
    check(`${os} · preferencia heredada qiimelab.theme='light' → claro`, p.attr === 'light' && !isDark(p.page), JSON.stringify(p));
    check(`${os} · 0 errores de consola`, c.problems.length === 0, c.problems.slice(0, 3).join(' | '));
  } catch (e) {
    check('sin excepciones', false, e.stack || String(e));
  } finally {
    c.kill();
  }
}
if (server.started) server.stop();

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
