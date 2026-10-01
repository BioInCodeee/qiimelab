// tests/alluvial-opacity.mjs — #/barplots, vista Flujos (aluvial): el control
// «Opacidad de los flujos» del editor debe aplicarse a TODOS los flujos, no
// solo a los de «Otros». Causa del bug original: la opacidad iba como
// style="fill-opacity:…" inline y applyPalette() (chartColors.js) reescribe
// style.fillOpacity de todo nodo con data-ce-series-fill (los taxones
// nombrados) → solo «Otros», sin esa marca, conservaba el valor. Ahora va como
// variable CSS en el grupo de flujos.
//
// Se verifica con el dataset real de ejemplo (varios taxones nombrados + Otros)
// y a dos valores, comprobando el fill-opacity CALCULADO de cada flujo.
//
//   node tests/alluvial-opacity.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'alluvial-opacity' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

const linkOpacities = () => c.ev(`(() => {
  const links = [...document.querySelectorAll('svg.ql-svg path.ql-alluvial-link')];
  const byTaxon = {};
  links.forEach((p) => { (byTaxon[p.getAttribute('data-taxon-key')] = byTaxon[p.getAttribute('data-taxon-key')] || new Set()).add(getComputedStyle(p).fillOpacity); });
  return { n: links.length, byTaxon: Object.fromEntries(Object.entries(byTaxon).map(([k, v]) => [k, [...v]])) };
})()`);

try {
  await c.goto();
  await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); })()`);
  await sleep(2000);
  await c.ev(`location.hash = '#/barplots'`);
  await sleep(1800);
  await c.ev(`(() => { const b = [...document.querySelectorAll('.ql-tab')].find((x) => /Flujos|Alluvial/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(1200);
  await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Personalizar|Customise/.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(700);

  const before = await linkOpacities();
  const keys = Object.keys(before.byTaxon);
  const named = keys.filter((k) => k !== '__other__');
  check('el dataset de ejemplo dibuja flujos de varios taxones nombrados (≥3) además de «Otros»',
    named.length >= 3 && keys.includes('__other__'), JSON.stringify(keys));
  check('opacidad por defecto uniforme (0.4) en nombrados y en «Otros»',
    keys.every((k) => before.byTaxon[k].length === 1 && Math.abs(parseFloat(before.byTaxon[k][0]) - 0.4) < 1e-6), JSON.stringify(before.byTaxon));

  for (const pct of [80, 25]) {
    const ok = await c.ev(`(() => {
      const row = [...document.querySelectorAll('.ce-geom-row')].find((r) => /Opacidad|opacity/i.test(r.querySelector('label').textContent));
      if (!row) return false;
      const r = row.querySelector('input[type=range]');
      r.value = ${pct}; r.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(500);
    const after = await linkOpacities();
    check('control de opacidad presente', ok);
    check('al fijar ' + pct + '%: TODOS los flujos (nombrados y «Otros») quedan a ' + pct / 100,
      after.n > 0 && Object.keys(after.byTaxon).every((k) => after.byTaxon[k].length === 1 && Math.abs(parseFloat(after.byTaxon[k][0]) - pct / 100) < 1e-6),
      JSON.stringify(after.byTaxon));
  }
  // Camino real del bug: la opacidad ya está guardada y la vista se REPINTA con el
  // editor enganchado (applyPalette corre tras el dibujo). Se sale y se vuelve.
  await sleep(800); // el editor persiste con debounce
  await c.ev(`location.hash = '#/alfa'`);
  await sleep(1200);
  await c.ev(`location.hash = '#/barplots'`);
  await sleep(1800);
  await c.ev(`(() => { const b = [...document.querySelectorAll('.ql-tab')].find((x) => /Flujos|Alluvial/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(1200);
  const reopened = await linkOpacities();
  check('al reabrir la vista con la opacidad guardada (25%), TODOS los flujos la conservan',
    reopened.n > 0 && Object.keys(reopened.byTaxon).every((k) => reopened.byTaxon[k].length === 1 && Math.abs(parseFloat(reopened.byTaxon[k][0]) - 0.25) < 1e-6),
    JSON.stringify(reopened.byTaxon));

  // y tras cambiar el color de una serie (applyPalette se ejecuta de nuevo)
  await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Personalizar|Customise/.test(x.textContent)); if (b && !document.querySelector('.ce-geometry')) b.click(); })()`);
  await sleep(700);
  await c.ev(`(() => { const i = document.querySelector('.ce-pal-row input[type=color], .ce-series-row input[type=color], input[type=color]'); if (i) { i.value = '#ff00aa'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
  await sleep(600);
  const afterColor = await linkOpacities();
  check('tras cambiar el color de una serie, la opacidad sigue uniforme en todos los flujos',
    afterColor.n > 0 && Object.keys(afterColor.byTaxon).every((k) => afterColor.byTaxon[k].length === 1 && Math.abs(parseFloat(afterColor.byTaxon[k][0]) - 0.25) < 1e-6),
    JSON.stringify(afterColor.byTaxon));
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
