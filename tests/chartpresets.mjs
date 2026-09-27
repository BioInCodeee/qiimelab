// Presets del editor de gráficos (Fase 6 Paso 1 de
// qiimelab-prompt-editor-fase-6-presets-style-match-export-revista.md):
// un preset es "una foto del store" -- guardarlo clona `store` +
// `paletteSeries.map(s=>s.id)` (para poder remapear por posición al
// aplicar sobre OTRO gráfico con un nº de series distinto); aplicarlo
// sobreescribe `store` y llama a sync(). Se guardan en
// localStorage['smart-175.chartPresets'], compartida entre TODAS las
// gráficas (no por `key`). Desde la Fase 1 no hay presets de revista
// (Nature/Cell): se comprueba que no aparecen y que los propios persisten
// tras recargar la página.
//
//   node tests/chartpresets.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'chartpresets' });
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

  // ================= Paso 1: guardar un preset en #/alfa (pocas series) =================
  console.log('-- Paso 1: guardar un preset personalizado en #/alfa --');
  await c.ev(`location.hash = '#/alfa'`);
  await sleep(1500);
  await openEditor();

  // personalizar algo primero, para que el preset tenga contenido real que verificar luego
  const customize = await c.ev(`(() => {
    const blocks = [...document.querySelectorAll('.ce-pal-row-block')];
    if (!blocks.length) return { err: 'sin series en #/alfa' };
    const inp = blocks[0].querySelector('.ce-pal-row-fill input[type=color]');
    inp.value = '#3355ff'; inp.dispatchEvent(new Event('change', { bubbles: true }));
    return { n: blocks.length };
  })()`);
  check('#/alfa tiene series de paleta que personalizar antes de guardar el preset', customize.n > 0, JSON.stringify(customize));

  const saved = await c.ev(`(() => {
    const wrap = document.querySelector('.ce-presets');
    if (!wrap) return { err: 'no se encontró la sección de presets' };
    const nameInp = wrap.querySelector('input[type=text]');
    const saveBtn = [...wrap.querySelectorAll('button')].find((b) => /Guardar$/.test(b.textContent.trim()));
    nameInp.value = 'Mi estilo azul';
    saveBtn.click();
    return { hasWrap: true };
  })()`);
  check('la sección "Presets" existe con un campo de nombre + botón Guardar', saved.hasWrap, JSON.stringify(saved));
  await sleep(300);

  const persisted = await c.ev(`(() => {
    const raw = localStorage.getItem('smart-175.chartPresets');
    const all = raw ? JSON.parse(raw) : {};
    const entries = Object.values(all);
    return { n: entries.length, names: entries.map((p) => p.name), hasSeriesOrder: entries.length > 0 && Array.isArray(entries[0].seriesOrder) };
  })()`);
  check('el preset se persiste en localStorage[smart-175.chartPresets] con seriesOrder (para el remapeo por posición)',
    persisted.n === 1 && persisted.names.includes('Mi estilo azul') && persisted.hasSeriesOrder, JSON.stringify(persisted));

  // ================= aplicar ese MISMO preset en OTRO tipo de gráfico, con OTRO nº de series =================
  console.log('\n-- aplicar el preset guardado en #/barplots (distinto nº de series, no debe romper) --');
  await c.ev(`location.hash = '#/barplots'`);
  await sleep(1800);
  await openEditor();

  const beforeApply = await c.ev(`(() => {
    const blocks = [...document.querySelectorAll('.ce-pal-row-block')];
    return { nSeries: blocks.length };
  })()`);
  check('#/barplots tiene un nº de series distinto al de #/alfa (escenario real de remapeo por posición)', beforeApply.nSeries > 0, JSON.stringify(beforeApply));

  const applied = await c.ev(`(() => {
    const wrap = document.querySelector('.ce-presets');
    const applyBtn = [...wrap.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Aplicar');
    if (!applyBtn) return { err: 'no se encontró el botón Aplicar del preset' };
    applyBtn.click();
    return { clicked: true };
  })()`);
  check('el botón "Aplicar" del preset guardado aparece en #/barplots y se puede pulsar', applied.clicked, JSON.stringify(applied));
  await sleep(400);

  const afterApply = await c.ev(`(() => {
    const first = document.querySelector('[data-ce-series-fill^="s"]');
    return { firstFill: first ? getComputedStyle(first).fill : null, consoleOk: true };
  })()`);
  check('aplicar un preset de OTRO gráfico con distinto nº de series no lanza excepción (primera serie recolorada)',
    afterApply.firstFill === 'rgb(51, 85, 255)', JSON.stringify(afterApply));

  // ================= borrar el preset =================
  console.log('\n-- borrar un preset guardado --');
  const deleted = await c.ev(`(() => {
    const wrap = document.querySelector('.ce-presets');
    const delBtn = [...wrap.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Borrar');
    if (!delBtn) return { err: 'no se encontró el botón Borrar' };
    delBtn.click();
    const raw = localStorage.getItem('smart-175.chartPresets');
    const all = raw ? JSON.parse(raw) : {};
    return { nAfter: Object.keys(all).length };
  })()`);
  check('"Borrar" quita el preset de localStorage', deleted.nAfter === 0, JSON.stringify(deleted));

  // ================= Fase 1: sin presets de revista; los propios persisten al recargar =================
  console.log('\n-- ningún preset de revista en ninguna vista --');
  const journalLeft = [];
  for (const route of ['#/alfa', '#/barplots', '#/beta', '#/venn', '#/correlograma']) {
    await c.ev(`location.hash = '#/cargar'`); await sleep(300);
    await c.ev(`location.hash = ${JSON.stringify(route)}`); await sleep(1500);
    await openEditor();
    const txt = await c.ev(`(() => { const tb = document.querySelector('.ce-toolbar'); return tb ? tb.textContent : null; })()`);
    if (txt === null || /Nature|Cell \(|revista|Journal/.test(txt)) journalLeft.push(route + (txt === null ? ' (sin editor)' : ''));
  }
  const api = await c.ev(`import('/js/lib/chartEditor.js').then((m) => ({ journal: 'JOURNAL_PRESETS' in m, readPresets: typeof m.readPresets }))`);
  check('ninguna vista muestra presets de revista (Nature/Cell)', journalLeft.length === 0, journalLeft.join(', '));
  check('la API pública ya no exporta JOURNAL_PRESETS (readPresets sigue)', !api.journal && api.readPresets === 'function', JSON.stringify(api));

  console.log('\n-- un preset propio persiste tras recargar la página --');
  await c.ev(`location.hash = '#/alfa'`); await sleep(1500);
  await openEditor();
  await c.ev(`(() => {
    const inp = document.querySelector('.ce-pal-row-block .ce-pal-row-fill input[type=color]');
    inp.value = '#aa2266'; inp.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(400);
  await c.ev(`(() => {
    const wrap = document.querySelector('.ce-presets');
    wrap.querySelector('input[type=text]').value = 'Persistente';
    [...wrap.querySelectorAll('button')].find((b) => /Guardar$/.test(b.textContent.trim())).click();
  })()`);
  await sleep(300);
  // restablecer la figura para que aplicar el preset tenga un efecto medible
  await c.ev(`[...document.querySelectorAll('.ce-toolbar button')].find((b) => /Restablecer/.test(b.textContent))?.click()`);
  await sleep(600);
  await c.goto(); await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); })()`);
  await sleep(1500);
  await c.ev(`location.hash = '#/alfa'`); await sleep(1500);
  await openEditor();
  const afterReload = await c.ev(`(() => {
    const wrap = document.querySelector('.ce-presets');
    const names = wrap ? [...wrap.querySelectorAll('.ce-cs-row span')].map((x) => x.textContent) : [];
    const before = getComputedStyle(document.querySelector('[data-ce-series-fill="s0"]')).fill;
    const row = wrap && [...wrap.querySelectorAll('.ce-cs-row')].find((r) => r.textContent.includes('Persistente'));
    const apply = row && [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Aplicar');
    if (apply) apply.click();
    return { names, before };
  })()`);
  await sleep(500);
  const appliedFill = await c.ev(`getComputedStyle(document.querySelector('[data-ce-series-fill="s0"]')).fill`);
  check('tras recargar, el preset "Persistente" sigue listado', afterReload.names.includes('Persistente'), JSON.stringify(afterReload));
  check('...y aplicarlo recolorea la figura con su color guardado', afterReload.before !== 'rgb(170, 34, 102)' && appliedFill === 'rgb(170, 34, 102)', JSON.stringify({ before: afterReload.before, appliedFill }));
  await c.ev(`(() => { const wrap = document.querySelector('.ce-presets'); const row = [...wrap.querySelectorAll('.ce-cs-row')].find((r) => r.textContent.includes('Persistente')); [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Borrar').click(); })()`);
  await sleep(300);
  check('...y se puede borrar después', await c.ev(`!Object.values(JSON.parse(localStorage.getItem('smart-175.chartPresets') || '{}')).some((p) => p.name === 'Persistente')`));

  // ================= ancho de exportación manual (sin preset) =================
  console.log('\n-- ancho de exportación manual (sección Exportación) --');
  await c.ev(`location.hash = '#/alfa'`); await sleep(1200);
  await openEditor();
  const manualWidth = await c.ev(`(() => {
    const wrap = document.querySelector('.ce-export');
    const inp = wrap.querySelector('input[type=number]');
    inp.value = '120'; inp.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`);
  await sleep(400); // writeStoreDebounced() -- 300ms
  const manualWidthPersisted = await c.ev(`(() => {
    const raw = localStorage.getItem('smart-175.chartStyle.alphaDiversity');
    const store = raw ? JSON.parse(raw) : null;
    return { stored: store && store.__export };
  })()`);
  check('fijar el ancho de exportación a mano (sin preset) persiste en store.__export.widthMm (tras el debounce de 300ms)',
    manualWidthPersisted.stored && manualWidthPersisted.stored.widthMm === 120, JSON.stringify(manualWidthPersisted));

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
