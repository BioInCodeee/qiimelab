// Regresiones de UI (sesión del 23 sep 2026): foco del editor tras un cambio
// que reconstruye la barra "Personalizar", selector Barplot/Aluvial
// duplicado en #/barplots, aluvial de #/inferencia que no dibujaba nada, y
// solape de etiquetas en la leyenda del heatmap de #/beta.
//
//   node tests/ui-fixes-editor-alluvial.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'ui-fixes' });
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

  console.log('-- foco tras cambiar "Mostrar" (estadística) en #/alfa --');
  await c.ev(`location.hash = '#/alfa'`);
  await sleep(1500);
  await openEditor();
  await c.ev(`(() => {
    const row = [...document.querySelectorAll('.ce-stats-row')].find((r) => r.querySelector('label') && /Mostrar/.test(r.querySelector('label').textContent));
    const sel = row.querySelector('select');
    sel.focus(); sel.value = 'exact';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(700);
  const afterStats = await c.ev(`(() => {
    const row = [...document.querySelectorAll('.ce-stats-row')].find((r) => r.querySelector('label') && /Mostrar/.test(r.querySelector('label').textContent));
    const sel = row && row.querySelector('select');
    const sig = [...document.querySelectorAll('svg [data-ce="sig"] text')].map((t) => t.textContent);
    return { focusOnSelect: !!sel && document.activeElement === sel, value: sel && sel.value, toolbarOpen: !!document.querySelector('.ce-stats'), sig };
  })()`);
  check('el panel sigue abierto y el foco vuelve al desplegable "Mostrar"', afterStats.toolbarOpen && afterStats.focusOnSelect && afterStats.value === 'exact', JSON.stringify(afterStats));
  check('con "solo p exacto" los corchetes muestran p sin asteriscos', afterStats.sig.length > 0 && afterStats.sig.every((s) => !/\*/.test(s)), JSON.stringify(afterStats.sig));

  console.log('\n-- foco tras cambiar la escala de color en #/beta (sin repintado completo) --');
  await c.ev(`location.hash = '#/beta'`);
  await sleep(1500);
  await openEditor();
  await c.ev(`(() => {
    const inp = document.querySelector('.ce-colorscale input[type=number]');
    inp.focus(); inp.value = '0.9';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(700);
  const afterScale = await c.ev(`(() => ({ tag: document.activeElement.tagName, type: document.activeElement.type, inColorscale: !!document.activeElement.closest('.ce-colorscale') }))()`);
  check('el foco vuelve al campo de dominio de la escala de color', afterScale.tag === 'INPUT' && afterScale.inColorscale, JSON.stringify(afterScale));

  console.log('\n-- leyenda del heatmap de #/beta: etiquetas sin solaparse --');
  await c.ev(`location.hash = '#/beta'`);
  await sleep(1500);
  const legend = await c.ev(`(() => {
    const g = document.querySelector('[data-ce="legend"]');
    const t = [...g.querySelectorAll('text')].map((x) => x.getBBox());
    return { leftRight: t[0].x + t[0].width, rightLeft: t[1].x };
  })()`);
  check('la etiqueta izquierda termina antes de que empiece la derecha', legend.leftRight < legend.rightLeft, JSON.stringify(legend));

  console.log('\n-- #/barplots: un solo interruptor Barplot/Aluvial --');
  await c.ev(`location.hash = '#/barplots'`);
  await sleep(1500);
  const bar = await c.ev(`(() => ({
    tabs: [...document.querySelectorAll('.ql-tab')].filter((b) => /[Aa]luvial/.test(b.textContent)).length,
    segs: [...document.querySelectorAll('.ql-seg-btn')].filter((b) => /[Aa]luvial/.test(b.textContent)).length,
  }))()`);
  check('"Aluvial" aparece solo en las pestañas de arriba, no también en el lateral', bar.tabs === 1 && bar.segs === 0, JSON.stringify(bar));

  console.log('\n-- #/inferencia: el aluvial dibuja flujos y leyenda --');
  await c.ev(`location.hash = '#/inferencia'`);
  await sleep(1500);
  await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Aluvial/.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(1200);
  const inf = await c.ev(`(() => ({
    nodes: document.querySelectorAll('.ql-alluvial-nodes rect').length,
    links: document.querySelectorAll('.ql-alluvial-links path').length,
    legendItems: document.querySelectorAll('g[data-legend-key]').length,
  }))()`);
  check('dibuja nodos y enlaces (antes: 0)', inf.nodes > 0 && inf.links > 0, JSON.stringify(inf));
  check('tiene leyenda con una entrada por función', inf.legendItems > 0, JSON.stringify(inf));

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
