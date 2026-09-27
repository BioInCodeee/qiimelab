// Coherencia entre gráficas (23 sep 2026; panel único desde la Fase 1, 27 sep):
// TODAS las figuras llevan el mismo botón Personalizar, y su panel trae
// "Estructura" (márgenes del lienzo, rangos de eje, orden) y "Geometría"
// (tamaño de puntos, grosor de línea, anchura de barras/cajas, tamaño de
// celda) junto a Títulos/Estilo. Además comprueba que esos ajustes
// funcionan de verdad (no solo que existan), que no queda la antigua rueda
// Ajustes ni secciones repetidas, y que el panel abierto sobrevive a un
// repintado del módulo.
//
//   node tests/chart-consistency.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'chart-consistency' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

const goto = async (route, parts = []) => {
  await c.ev(`location.hash = '#/cargar'`); await sleep(350);
  await c.ev(`location.hash = ${JSON.stringify(route)}`); await sleep(1200);
  await c.ev(`(() => { if (!document.querySelector('#app-view .ql-empty')) return; const b = [...document.querySelectorAll('#app-view button')].find((x) => /ejemplo|example/i.test(x.textContent)); if (b) b.click(); })()`); await sleep(1500);
  for (const part of parts) {
    await c.ev(`(() => { const b = [...document.querySelectorAll('#app-view .ql-tab, #app-view .ql-seg-btn, #app-view button')].find((x) => x.textContent.trim().indexOf(${JSON.stringify(part)}) === 0); if (b) b.click(); })()`);
    await sleep(900);
  }
};
const clickBtn = (re) => c.ev(`(() => { const b = [...document.querySelectorAll('#app-view .ce-toolbar button')].find((x) => ${re}.test(x.textContent)); if (b) b.click(); return !!b; })()`);
const sections = () => c.ev(`[...document.querySelectorAll('#app-view .ce-toolbar h5')].map((h) => h.textContent.trim())`);
// pone un slider de geometría (por parte del texto de su etiqueta) a un valor
const setGeo = (labelRe, v) => c.ev(`(() => {
  const row = [...document.querySelectorAll('.ce-geom-row')].find((r) => ${labelRe}.test(r.querySelector('label').textContent));
  if (!row) return false;
  const n = row.querySelector('input[type=number]'); n.value = ${JSON.stringify(String(v))}; n.dispatchEvent(new Event('change', { bubbles: true })); return true;
})()`);

try {
  await c.goto(); await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); await m.loadRealDifferentialAbundance(); await m.loadRealFunctionalWithMeta(); if (m.loadRealDiffComparisons) await m.loadRealDiffComparisons(); if (m.loadExampleMicrobialCountsPlate) await m.loadExampleMicrobialCountsPlate(); })()`);
  await sleep(2500);

  console.log('-- todas las gráficas: Personalizar + Estructura + Geometría --');
  const CASES = [
    ['#/barplots', ['Barras']], ['#/barplots', ['Flujos']], ['#/barplots', ['Sunburst']], ['#/barplots', ['Taxa candidatos']], ['#/barplots', ['Burbujas']],
    ['#/alfa', ['Boxplot']], ['#/alfa', ['Curvas']], ['#/alfa', ['Violín']],
    ['#/beta', ['Mapa de calor']], ['#/beta', ['PCoA']], ['#/beta', ['RDA']],
    ['#/diferencial', ['Individual', 'Volcano']], ['#/diferencial', ['Individual', 'Lollipop']], ['#/diferencial', ['Individual', 'Mapa de calor']], ['#/diferencial', ['Individual', 'Cajas']], ['#/diferencial', ['Comparar']],
    ['#/recuentos', []], ['#/correlograma', ['Matriz']], ['#/correlograma', ['Red']], ['#/funcional', []],
    ['#/inferencia', ['Gráfico de Barras']], ['#/inferencia', ['Lollipop']],
    ['#/temporal', []], ['#/venn', []], ['#/arbol', []],
  ];
  const missing = [];
  for (const [route, parts] of CASES) {
    await goto(route, parts);
    const info = await c.ev(`(() => { const tb = document.querySelector('#app-view .ce-toolbar'); return { tb: !!tb, gear: !!(tb && tb.querySelector('.ce-settings-btn')) || (!!tb && [...tb.querySelectorAll('button')].some((b) => /Ajustes/.test(b.textContent))), pers: !!tb && [...tb.querySelectorAll('button')].some((b) => /Personalizar/.test(b.textContent)) }; })()`);
    await clickBtn('/Personalizar/');
    await sleep(350);
    const secs = await sections();
    const ok = info.tb && !info.gear && info.pers && secs.includes('Estructura') && secs.includes('Geometría') && secs.some((x) => /Títulos/.test(x));
    if (!ok) missing.push(route + ' ' + parts.join('>') + ' ' + JSON.stringify({ ...info, secs }));
  }
  check('las ' + CASES.length + ' vistas tienen Personalizar (sin rueda Ajustes) con Estructura + Geometría + Títulos en el mismo panel', missing.length === 0, missing.join(' | '));

  console.log('\n-- los ajustes universales funcionan --');
  // puntos (PCoA)
  await goto('#/beta', ['PCoA']);
  await clickBtn('/Personalizar/'); await sleep(300);
  const r0 = await c.ev(`(() => +document.querySelector('#app-view svg circle[data-ce-role="marker"]').getAttribute('r'))()`);
  await setGeo('/puntos|Point/i', 2); await sleep(400);
  const r1 = await c.ev(`(() => +document.querySelector('#app-view svg circle[data-ce-role="marker"]').getAttribute('r'))()`);
  check('"Tamaño de los puntos ×2" duplica el radio (PCoA)', Math.abs(r1 - 2 * r0) < 0.05, JSON.stringify({ r0, r1 }));
  check('el panel sigue abierto tras el cambio', (await sections()).includes('Geometría'));

  // anchura de barras (Barplots apiladas)
  await goto('#/barplots', ['Barras']);
  await clickBtn('/Personalizar/'); await sleep(300);
  const w0 = await c.ev(`(() => +document.querySelector('#app-view svg rect[data-ce-role="bar"]').getAttribute('width'))()`);
  await setGeo('/barras|Bar/i', 0.5); await sleep(400);
  const w1 = await c.ev(`(() => +document.querySelector('#app-view svg rect[data-ce-role="bar"]').getAttribute('width'))()`);
  check('"Anchura de barras ×0.5" reduce el ancho a la mitad', Math.abs(w1 - w0 / 2) < 0.1, JSON.stringify({ w0, w1 }));

  // grosor de línea (temporal)
  await goto('#/temporal');
  await clickBtn('/Personalizar/'); await sleep(300);
  await setGeo('/líneas|Line/i', 2); await sleep(400);
  const sw = await c.ev(`(() => parseFloat(getComputedStyle(document.querySelector('#app-view svg polyline[data-ce-role="line"]')).strokeWidth))()`);
  check('"Grosor de las líneas ×2" dobla el trazo (temporal: 2 → 4)', Math.abs(sw - 4) < 0.1, JSON.stringify({ sw }));

  // tamaño de celdas (heatmap beta)
  await goto('#/beta', ['Mapa de calor']);
  await clickBtn('/Personalizar/'); await sleep(300);
  const cw0 = await c.ev(`(() => +document.querySelector('#app-view svg rect[data-ce-role="cell"]').getAttribute('width'))()`);
  await setGeo('/celdas|Cell/i', 0.5); await sleep(400);
  const cw1 = await c.ev(`(() => +document.querySelector('#app-view svg rect[data-ce-role="cell"]').getAttribute('width'))()`);
  check('"Tamaño de las celdas ×0.5" encoge las celdas del mapa de calor', Math.abs(cw1 - cw0 / 2) < 0.1, JSON.stringify({ cw0, cw1 }));

  // márgenes del lienzo (genérico) + rango de eje (temporal)
  await goto('#/temporal');
  const vb0 = await c.ev(`document.querySelector('#app-view svg.ql-svg').getAttribute('viewBox')`);
  await clickBtn('/Personalizar/'); await sleep(300);
  await c.ev(`(() => { const row = [...document.querySelectorAll('.ce-cs-row')].find((r) => /Margen|margin/i.test(r.querySelector('label').textContent)); const i = row.querySelectorAll('input[type=number]')[0]; i.value = '40'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(400);
  const vb1 = await c.ev(`document.querySelector('#app-view svg.ql-svg').getAttribute('viewBox')`);
  check('el margen extra arriba amplía el lienzo (viewBox) sin repintar el módulo', vb1 !== vb0 && vb1.split(' ')[1] === '-40', JSON.stringify({ vb0, vb1 }));
  await c.ev(`(() => { const row = [...document.querySelectorAll('.ce-cs-row')].find((r) => /eje X|X axis/.test(r.querySelector('label').textContent)); const i = row.querySelectorAll('input[type=number]')[1]; i.value = '10'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(600);
  const ticks = await c.ev(`[...document.querySelectorAll('#app-view svg .ql-tick-label')].map((t) => t.textContent)`);
  check('el rango manual del eje X recorta el eje a 10 (temporal)', ticks.includes('10'), JSON.stringify(ticks.slice(-6)));
  check('tras cambiar el rango el panel sigue abierto (sobrevive al repintado)', (await sections()).includes('Estructura'));

  console.log('\n-- panel único: dos bloques, nada repetido --');
  await goto('#/alfa', ['Boxplot']);
  await clickBtn('/Personalizar/'); await sleep(300);
  const allSecs = await sections();
  const groups = await c.ev(`[...document.querySelectorAll('#app-view .ce-toolbar .ce-group')].map((g) => ({ title: g.querySelector('.ce-group-title').textContent, secs: [...g.querySelectorAll('h5')].map((h) => h.textContent) }))`);
  const data = groups.find((g) => /Datos/.test(g.title)), look = groups.find((g) => /Apariencia/.test(g.title));
  check('el panel tiene los bloques "Datos y estructura" y "Apariencia"', groups.length === 2 && !!data && !!look, JSON.stringify(groups));
  check('Estructura/Geometría/Significación van en "Datos y estructura"', !!data && ['Estructura', 'Geometría'].every((x) => data.secs.includes(x)) && data.secs.some((x) => /Significaci/.test(x)), JSON.stringify(data));
  check('Títulos/Estilo/Paleta/Presets van en "Apariencia"', !!look && look.secs.some((x) => /Títulos/.test(x)) && look.secs.some((x) => /Estilo/.test(x)) && look.secs.includes('Presets'), JSON.stringify(look));
  check('ninguna sección aparece dos veces', new Set(allSecs).size === allSecs.length, JSON.stringify(allSecs));

  console.log('\n-- lo que antes faltaba --');
  await goto('#/diferencial', ['Comparar']);
  const cmp = await c.ev(`(() => { const tb = document.querySelector('#app-view .ce-toolbar'); return { tb: !!tb, n: tb ? tb.querySelectorAll('button').length : 0, fmt: !!(tb && tb.querySelector('.ce-export-format')) }; })()`);
  check('el Venn de "Comparar varias" ya tiene la barra del editor (Personalizar, pantalla completa, formato + Descargar)', cmp.tb && cmp.n >= 3 && cmp.fmt, JSON.stringify(cmp));

  // el aluvial de Inferencia se retiró en la Fase 2 (B3: no funcionaba)
  await goto('#/inferencia', ['Gráfico de Barras']);
  const infViews = await c.ev(`[...document.querySelectorAll('#app-view .ql-seg-btn, #app-view .ql-tab')].map((b) => b.textContent.trim())`);
  check('Inferencia ya no ofrece la vista Aluvial (Barras / Lollipop / Tabla)', !infViews.some((x) => /Aluvial|Alluvial/.test(x)) && infViews.some((x) => /Lollipop/.test(x)), JSON.stringify(infViews));

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
