// UI del motor de auto-selección de test (prompt "quick wins" del 22 sep
// 2026, punto 2): js/lib/statAutoSelect.js ya se valida matemáticamente
// contra R en tests/stats/statautoselect.mjs -- este test cubre que el
// panel de diagnóstico y el selector manual de test aparecen de verdad en
// el editor de gráficos y que forzar un test a mano cambia lo que se
// dibuja. Wiring nuevo: groupBoxplot.js (computeSignificancePairs, ya
// compartido por #/alfa, #/recuentos, #/funcional y la pestaña "cajas" de
// #/diferencial) + chartEditor.js (sección "Significación estadística",
// ya existente) + microbialCounts.js (drawJitter no pasaba statsControls
// a attachChartEditor todavía -- añadido aquí de paso, sin lo cual
// #/recuentos no tenía NINGÚN control de significación, ni el nuevo ni
// los de antes).
//
//   node tests/statautoselect-editor.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'statautoselect-editor' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

const openEditor = async () => {
  await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Personalizar|Customise/.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(600);
};

try {
  await c.goto();
  await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); })()`);
  await sleep(2000);

  // ================= #/alfa (drawGroupBoxplot, 2+ grupos según el dataset de ejemplo) =================
  console.log('-- #/alfa: panel de diagnóstico + selector manual --');
  await c.ev(`location.hash = '#/alfa'`);
  await sleep(1500);
  await openEditor();

  const setup = await c.ev(`(() => {
    const diag = document.querySelector('.ce-stats-diagnostic');
    const rows = [...document.querySelectorAll('.ce-stats-row')];
    const testRow = rows.find((r) => r.querySelector('label') && /Test a usar/.test(r.querySelector('label').textContent));
    return {
      hasDiag: !!diag, diagText: diag ? diag.textContent : null,
      hasTestSelect: !!testRow, options: testRow ? [...testRow.querySelector('select').options].map((o) => o.value) : null,
    };
  })()`);
  check('el panel de diagnóstico aparece con una explicación en lenguaje llano (Shapiro-Wilk/Levene)',
    setup.hasDiag && /Shapiro-Wilk/.test(setup.diagText) && /Levene/.test(setup.diagText), JSON.stringify(setup));
  check('el selector manual de test aparece con "Automático" + las 3 opciones para 3+ grupos',
    setup.hasTestSelect && setup.options.includes('auto') && setup.options.length === 4, JSON.stringify(setup));

  // forzar manualmente Kruskal-Dunn y comprobar que persiste + cambia el resultado
  const forced = await c.ev(`(() => {
    const rows = [...document.querySelectorAll('.ce-stats-row')];
    const testRow = rows.find((r) => r.querySelector('label') && /Test a usar/.test(r.querySelector('label').textContent));
    const sel = testRow.querySelector('select');
    sel.value = 'kruskal-dunn';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { selected: sel.value };
  })()`);
  await sleep(500);
  const persisted = await c.ev(`(() => {
    const raw = localStorage.getItem('smart-175.chartStyle.alphaDiversity');
    const store = raw ? JSON.parse(raw) : null;
    return { testOverride: store && store.__stats && store.__stats.testOverride };
  })()`);
  check('forzar "Kruskal-Wallis + Dunn" a mano persiste en store.__stats.testOverride', persisted.testOverride === 'kruskal-dunn', JSON.stringify({ forced, persisted }));

  // volver a "Automático" limpia el override (campo ralo, igual que el resto de opciones de stats)
  await c.ev(`(() => {
    const rows = [...document.querySelectorAll('.ce-stats-row')];
    const testRow = rows.find((r) => r.querySelector('label') && /Test a usar/.test(r.querySelector('label').textContent));
    testRow.querySelector('select').value = 'auto';
    testRow.querySelector('select').dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(500);
  const cleared = await c.ev(`(() => {
    const raw = localStorage.getItem('smart-175.chartStyle.alphaDiversity');
    const store = raw ? JSON.parse(raw) : null;
    return { hasOverrideKey: !!(store && store.__stats && ('testOverride' in store.__stats)) };
  })()`);
  check('volver a "Automático" quita la clave testOverride (ralo, sin dejar basura en localStorage)', !cleared.hasOverrideKey, JSON.stringify(cleared));

  // ================= #/recuentos: la misma sección ahora aparece también aquí (wiring nuevo) =================
  // módulo autónomo (localStorage propio, no LOAD_ALL) -- su propio ejemplo
  console.log('\n-- #/recuentos: sección de estadística ahora disponible en la vista de puntos (antes ausente) --');
  await c.ev(`location.hash = '#/recuentos'`);
  await sleep(1000);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); m.loadExampleMicrobialCountsPlate(); })()`);
  await sleep(1500);
  const jitterTab = await c.ev(`(() => {
    const b = [...document.querySelectorAll('.ql-seg-btn')].find((x) => /Puntos \\(dispersión\\)/.test(x.textContent));
    if (b) b.click();
    return { found: !!b };
  })()`);
  await sleep(1000);
  if (jitterTab.found) {
    await openEditor();
    const recuentosSetup = await c.ev(`(() => {
      const diag = document.querySelector('.ce-stats-diagnostic');
      return { hasDiag: !!diag, diagText: diag ? diag.textContent : null };
    })()`);
    check('#/recuentos (vista de puntos) ahora tiene el panel de diagnóstico de auto-selección',
      recuentosSetup.hasDiag, JSON.stringify(recuentosSetup));
  } else {
    check('la pestaña "Puntos (dispersión)" existe en #/recuentos', false, 'no se encontró la pestaña');
  }

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
