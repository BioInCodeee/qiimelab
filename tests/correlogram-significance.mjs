// tests/correlogram-significance.mjs — #/correlograma, vista Matriz: los
// asteriscos de significancia salen en las tres formas (Mapa de calor,
// Burbujas, Sectores) con el MISMO criterio (el de la tabla de parejas: cada
// pareja significativa aparece dos veces en la matriz simétrica), y el control
// «Significancia» Mostrar/Ocultar es UN solo estado compartido entre formas.
//
//   node tests/correlogram-significance.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep, LOAD_ALL } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'correlogram-significance' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };
const click = (re) => c.ev(`(() => { const b = [...document.querySelectorAll('#app-view .ql-seg-btn, #app-view .ql-tab')].find((x) => ${re}.test(x.textContent)); if (b) b.click(); return !!b; })()`);
const stars = () => c.ev(`(() => ({
  n: document.querySelectorAll('#app-view svg.ql-svg text.ql-cell-value').length,
  tablePairs: [...document.querySelectorAll('#app-view .ql-table tbody tr')].filter((tr) => tr.children[2] && /[*∗]/.test((tr.children[2].querySelector('.mono') || {}).textContent || '')).length,
}))()`);

try {
  await c.goto(); await sleep(1500);
  await c.ev(LOAD_ALL); await sleep(1000);
  await c.ev(`location.hash = '#/correlograma'`); await sleep(2500);
  await click('/^Matriz/'); await sleep(1200);

  const heat = await stars();
  check('mapa de calor: asteriscos = 2 × parejas significativas de la tabla (matriz simétrica)', heat.tablePairs > 0 && heat.n === 2 * heat.tablePairs, JSON.stringify(heat));
  for (const [re, name] of [['/^Burbujas$/', 'burbujas'], ['/^Sectores$/', 'sectores']]) {
    check('"' + name + '" disponible', await click(re)); await sleep(1300);
    const s = await stars();
    check(name + ': mismos asteriscos que el mapa de calor (mismo criterio de umbrales)', s.n === heat.n && s.n > 0, JSON.stringify({ s, heat }));
  }

  // un único estado: ocultar desde Sectores y comprobarlo en las tres formas
  check('"Significancia" ofrece Ocultar', await click('/^Ocultar$/')); await sleep(1200);
  check('sectores: sin asteriscos con "Ocultar"', (await stars()).n === 0);
  await click('/^Burbujas$/'); await sleep(1300);
  check('burbujas: sigue oculto (estado compartido, no uno por vista)', (await stars()).n === 0);
  await click('/^Mapa de calor$/'); await sleep(1300);
  check('mapa de calor: sigue oculto', (await stars()).n === 0);
  check('layout circular: sin asteriscos con "Ocultar"', (await click('/^Circular$/')) && (await sleep(1300), (await stars()).n === 0));

  // y volver a mostrarlos
  await click('/^Mostrar$/'); await sleep(1300);
  await click('/^Rectangular$/'); await sleep(1300);
  check('con "Mostrar" vuelven en el mapa de calor', (await stars()).n === heat.n);
  await click('/^Sectores$/'); await sleep(1300);
  check('...y en sectores', (await stars()).n === heat.n);

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
