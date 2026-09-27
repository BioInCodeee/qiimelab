// tests/globalfont.mjs — tipografía global del editor de figuras (Fase 1):
// la casilla "Usar tipografía global" + su fuente, en "Estilo de la figura",
// cambia de golpe TODOS los textos de la figura (títulos, ejes, leyenda),
// incluso los que tienen una fuente propia puesta elemento a elemento; se
// exporta, persiste al recargar y al desactivarla cada texto vuelve a la suya.
//
//   node tests/globalfont.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'globalfont' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

const SERIF = 'Georgia, "Times New Roman", serif';
const MONO = 'ui-monospace, Menlo, monospace';
// fuentes computadas de todos los <text> visibles de la figura del editor
const FONTS_NOW = `(() => {
  const svg = document.querySelector('.ce-toolbar').parentElement.querySelector('svg.ql-svg') || document.querySelector('#app-view svg.ql-svg');
  const texts = [...svg.querySelectorAll('text')].filter((t) => t.textContent.trim() && !t.closest('.ce-hit'));
  return { n: texts.length, fams: [...new Set(texts.map((t) => getComputedStyle(t).fontFamily))], title: (() => { const t = svg.querySelector('[data-ce-id="title"] text, .ql-chart-main-title'); return t ? getComputedStyle(t).fontFamily : null; })() };
})()`;
const openEditor = () => c.ev(`(() => { const b = [...document.querySelectorAll('.ce-toolbar button')].find((x) => /Personalizar|Customise/.test(x.textContent)); if (b) b.click(); })()`);
const setGlobal = (on, font) => c.ev(`(() => {
  const chk = document.querySelector('.ce-globalfont-row input[type=checkbox]');
  const sel = document.querySelector('.ce-globalfont-row select');
  if (!chk || !sel) return false;
  ${font ? `sel.disabled = false; sel.value = ${JSON.stringify(font)};` : ''}
  if (chk.checked !== ${on}) { chk.checked = ${on}; chk.dispatchEvent(new Event('change', { bubbles: true })); }
  return true;
})()`);

const VIEWS = [['#/alfa', 'alphaDiversity', 'Boxplot'], ['#/barplots', 'taxaBarplot', null], ['#/beta', null, 'PCoA']];

try {
  await c.goto();
  await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); })()`);
  await sleep(1500);
  // el título de alfa arranca con una fuente PROPIA (monoespaciada), puesta
  // elemento a elemento: la global debe poder con ella
  await c.ev(`localStorage.setItem('smart-175.chartStyle.alphaDiversity', JSON.stringify({ title: { font: ${JSON.stringify(MONO)} } }))`);

  for (const [route, , tab] of VIEWS) {
    console.log(`\n-- ${route} --`);
    await c.ev(`location.hash = '#/cargar'`); await sleep(300);
    await c.ev(`location.hash = ${JSON.stringify(route)}`); await sleep(1800);
    if (tab) { await c.ev(`[...document.querySelectorAll('.ql-tab, .ql-seg-btn')].find((x) => x.textContent.includes(${JSON.stringify(tab)}))?.click()`); await sleep(1200); }
    await openEditor(); await sleep(500);
    const before = await c.ev(FONTS_NOW);
    const hasRow = await setGlobal(true, SERIF);
    check('la sección "Estilo de la figura" tiene la casilla + fuente de tipografía global', hasRow);
    await sleep(500);
    const on = await c.ev(FONTS_NOW);
    check(`al activarla, los ${on.n} textos de la figura pasan a la misma fuente (serif) de golpe`,
      on.n > 3 && on.fams.length === 1 && /Georgia/.test(on.fams[0]), JSON.stringify({ before: before.fams, after: on.fams }));
    if (route === '#/alfa') {
      check('...incluido el título, que tenía su propia fuente monoespaciada', /ui-monospace|Menlo/.test(before.title || '') && /Georgia/.test(on.title || ''), JSON.stringify({ before: before.title, after: on.title }));
      const axisSel = await c.ev(`(() => { const r = [...document.querySelectorAll('.ce-figstyle-row')].find((x) => /ejes y marcas/.test(x.textContent)); return r ? r.querySelector('select').disabled : null; })()`);
      check('con la global activa, "Fuente de ejes y marcas" queda desactivada (no tendría efecto)', axisSel === true, String(axisSel));
      const exp = await c.ev(`(async () => {
        const svg = document.querySelector('#app-view svg.ql-svg');
        const { serializeForExport } = await import('/js/lib/figureExport.js');
        const s = serializeForExport(svg, { scheme: 'light', background: 'white' }).svg;
        const fams = [...s.matchAll(/<text[^>]*font-family="([^"]*)"/g)].map((m) => m[1]);
        return { n: fams.length, allSerif: fams.length > 0 && fams.every((f) => /Georgia/.test(f)) };
      })()`);
      check('el SVG exportado lleva la fuente global en todos sus <text>', exp.allSerif, JSON.stringify(exp));
      const stored = await c.ev(`JSON.parse(localStorage.getItem('smart-175.chartStyle.alphaDiversity') || '{}').__figureStyle`);
      check('se guarda en store.__figureStyle.globalFont (viaja con presets, se borra con Restablecer)', stored && stored.globalFont === SERIF, JSON.stringify(stored));
    }
  }

  console.log('\n-- persiste al recargar y se desactiva limpiamente --');
  await c.goto(); await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); })()`);
  await sleep(1200);
  await c.ev(`location.hash = '#/alfa'`); await sleep(1800);
  await c.ev(`[...document.querySelectorAll('.ql-tab, .ql-seg-btn')].find((x) => x.textContent.includes('Boxplot'))?.click()`); await sleep(1200);
  const reloaded = await c.ev(FONTS_NOW);
  check('tras recargar, la figura sigue con la tipografía global', reloaded.fams.length === 1 && /Georgia/.test(reloaded.fams[0]), JSON.stringify(reloaded.fams));
  await openEditor(); await sleep(500);
  await setGlobal(false);
  await sleep(500);
  const off = await c.ev(FONTS_NOW);
  check('al desactivarla, cada texto vuelve a su fuente (el título a la suya propia)', /ui-monospace|Menlo/.test(off.title || '') && off.fams.length > 1, JSON.stringify(off));

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
