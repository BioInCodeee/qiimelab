// tests/alpha-boxstats.mjs — #/alfa (Fase 2, B2): modo "Cajas sin puntos"
// (mismo boxplot, sin los puntos de cada muestra, con su propia nota) y el
// selector "Test a usar" nombrando el test que se aplica DE VERDAD y por qué
// — "Automático → <test>" + recuadro "Test aplicado: … Por qué: …", y al
// forzar otro a mano, "(elegido a mano)" + lo que habría elegido el
// automático.
//
//   node tests/alpha-boxstats.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'alpha-boxstats' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };
const count = () => c.ev(`({ points: document.querySelectorAll('#app-view svg .ql-boxplot-point').length, boxes: document.querySelectorAll('#app-view svg rect[data-ce-role="bar"]').length, note: (document.querySelector('#app-view .ql-panel-note') || {}).textContent || '' })`);
const stats = () => c.ev(`(() => { const box = document.querySelector('.ce-stats-diagnostic'); const row = [...document.querySelectorAll('.ce-stats-row')].find((r) => /Test a usar/.test(r.textContent)); const sel = row && row.querySelector('select'); return { box: box ? box.innerText : '', selected: sel ? sel.options[sel.selectedIndex].textContent : '' }; })()`);

try {
  await c.goto(); await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); })()`);
  await sleep(1500);
  await c.ev(`location.hash = '#/alfa'`); await sleep(2000);

  console.log('-- Cajas sin puntos --');
  const withPts = await count();
  check('"Cajas con puntos" (por defecto) dibuja cajas y los puntos de cada muestra', withPts.boxes > 1 && withPts.points > withPts.boxes, JSON.stringify(withPts));
  const clicked = await c.ev(`(() => { const b = [...document.querySelectorAll('#app-view .ql-seg-btn')].find((x) => /sin puntos/.test(x.textContent)); if (b) b.click(); return !!b; })()`);
  check('el selector "Forma del gráfico" ofrece "Cajas sin puntos"', clicked);
  await sleep(1500);
  const noPts = await count();
  check('...que dibuja las mismas cajas y ningún punto', noPts.boxes === withPts.boxes && noPts.points === 0, JSON.stringify(noPts));
  check('...con una nota que no habla de puntos por muestra', /sin los puntos/.test(noPts.note) && !/^Cada punto/.test(noPts.note), noPts.note);

  console.log('\n-- Test aplicado y por qué --');
  await c.ev(`[...document.querySelectorAll('#app-view .ce-toolbar button')].find((b) => /Personalizar/.test(b.textContent)).click()`); await sleep(600);
  const auto = await stats();
  const name = (auto.selected.match(/^Automático → (.+)$/) || [])[1];
  check('la opción automática nombra el test que aplica ("Automático → …")', !!name, auto.selected);
  check('el recuadro dice "Test aplicado: <ese test> (elegido automáticamente)"', !!name && auto.box.includes('Test aplicado: ' + name) && /elegido automáticamente/.test(auto.box), auto.box.slice(0, 120));
  check('...y justifica con las comprobaciones hechas (Shapiro-Wilk / Levene)', /Por qué:/.test(auto.box) && /Shapiro-Wilk/.test(auto.box), auto.box.slice(0, 200));
  await c.ev(`(() => { const row = [...document.querySelectorAll('.ce-stats-row')].find((r) => /Test a usar/.test(r.textContent)); const sel = row.querySelector('select'); sel.value = 'kruskal-dunn'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(1500);
  const forced = await stats();
  check('al forzar otro test: "Test aplicado: Kruskal-Wallis + Dunn (elegido a mano)"', /Test aplicado: Kruskal-Wallis \+ Dunn/.test(forced.box) && /elegido a mano/.test(forced.box), forced.box.slice(0, 120));
  check('...y sigue visible lo que habría elegido el automático', !!name && forced.box.includes('El automático habría elegido ' + name), forced.box.slice(0, 200));

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
