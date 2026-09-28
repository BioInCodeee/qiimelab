// tests/biomarker-volcano.mjs — vista "Volcano" del panel de taxa candidatos
// (js/modules/taxaBarplot.js, drawBiomarkerVolcano): con los datos de
// ejemplo reales, los puntos de color del volcano son EXACTAMENTE los taxones
// de la tabla de significativos (mismo método, mismo umbral q), con KW y con
// ANCOM-BC; Random Forest queda deshabilitado (no da p-valor); el aviso de
// Nivel C del método sigue visible; el tooltip da taxón + δ + q; y el
// editor de figuras exporta SVG/PNG como en el resto de gráficas.
//
//   node tests/biomarker-volcano.mjs
//   SHOT_DIR=/ruta node tests/biomarker-volcano.mjs   → además guarda capturas

import { findChrome } from './lib/env.mjs';

let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

if (!findChrome()) { console.log('(sin Chrome: se salta)'); process.exit(2); }

const { ensureServer } = await import('./lib/server.mjs');
const { connect } = await import('./lib/cdp.mjs');
const { sleep } = await import('./lib/app.mjs');
const server = await ensureServer();
const c = await connect({ url: server.url + '/index.html', label: 'biomarker-volcano' });
const EXPORT_PROBE = `(async () => {
  const svg = document.querySelector('#app-view .ql-chartwrap svg');
  const { exportFigure } = await import('/js/lib/figureExport.js');
  const r = await exportFigure(svg, { formats: ['svg', 'png', 'tiff', 'pdf'], dpi: 150 });
  const sig = (u8) => [...u8.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const out = { svg: r.svg.length, png: sig(r.png), tiff: sig(r.tiff), pdf: sig(r.pdf), circles: (r.svg.match(/<circle/g) || []).length };
  out.ok = out.svg > 2000 && out.png === '89504e47' && /^(49492a00|4d4d002a)$/.test(out.tiff) && out.pdf === '25504446';
  return out;
})()`;
const click = (sel, re) => c.ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => ${re}.test(x.textContent)); if (b) b.click(); return !!b; })()`);
const tableTaxa = () => c.ev(`[...document.querySelectorAll('#app-view .ql-table tbody tr')].map((tr) => tr.cells.length > 1 ? tr.cells[0].textContent : null).filter(Boolean).sort()`);
// taxón de cada punto de color, leído del tooltip real (hover delegado)
const volcanoSig = () => c.ev(`(async () => {
  const svg = document.querySelector('#app-view .ql-chartwrap svg');
  const out = [];
  for (const el of svg.querySelectorAll('circle[data-pi][data-ce-series-fill]')) {
    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    const tt = document.querySelector('#app-view .ql-tooltip');
    out.push(tt ? tt.querySelector('.ql-tt-name')?.textContent || '' : '');
    el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
  }
  return out;
})()`);

try {
  await c.setViewport(1400, 1600);
  await c.goto(); await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); })()`);
  await sleep(1500);
  await c.ev(`location.hash = '#/barplots'`); await sleep(1800);
  check('pestaña de taxa candidatos', await click('#app-view .ql-tab', '/Taxa candidatos/'));
  await sleep(2500);

  for (const [methodRe, name] of [['/Kruskal/', 'Kruskal-Wallis'], ['/ANCOM/', 'ANCOM-BC']]) {
    await click('#app-view .ql-seg-btn', methodRe); await sleep(2500);
    await click('#app-view .ql-seg-btn', '/^Un método$/'); await sleep(2500);
    const single = await tableTaxa();
    await click('#app-view .ql-seg-btn', '/^Volcano$/'); await sleep(2500);
    const table = await tableTaxa();
    const info = await c.ev(`(() => {
      const svg = document.querySelector('#app-view .ql-chartwrap svg');
      return {
        total: svg.querySelectorAll('circle[data-pi]').length,
        sig: svg.querySelectorAll('circle[data-pi][data-ce-series-fill]').length,
        refs: svg.querySelectorAll('[data-ce="refs"] line').length,
        notice: [...document.querySelectorAll('#app-view [data-method-level="C"]')].map((n) => n.textContent).join(' | '),
        count: document.querySelector('#app-view .ql-chartwrap')?.parentElement.textContent.match(/(\\d+) de (\\d+) taxones/)?.slice(1).map(Number),
        rfDisabled: [...document.querySelectorAll('#app-view .ql-seg-btn')].find((b) => /Random Forest/.test(b.textContent))?.disabled,
      };
    })()`);
    const names = await volcanoSig();
    const tip = names[0] || '';
    const volcanoTaxa = names.map((s) => s.trim()).sort();
    check(`${name}: la tabla del volcano es la misma que la de "Un método"`, JSON.stringify(single) === JSON.stringify(table), single.length + ' vs ' + table.length);
    check(`${name}: puntos de color = taxones significativos del panel (${table.length})`, info.sig === table.length && JSON.stringify(volcanoTaxa) === JSON.stringify(table), JSON.stringify(volcanoTaxa.filter((x) => !table.includes(x))));
    check(`${name}: un punto por taxón testado (${info.total})`, info.count && info.total === info.count[1] && info.sig === info.count[0], JSON.stringify(info.count));
    check(`${name}: umbral q + 3 umbrales |δ| dibujados`, info.refs >= 4, 'líneas: ' + info.refs);
    check(`${name}: aviso de Nivel C del método`, new RegExp(name === 'ANCOM-BC' ? 'ANCOM-BC' : 'LEfSe').test(info.notice), info.notice.slice(0, 100));
    check(`${name}: Random Forest deshabilitado en el volcano`, info.rfDisabled === true);
    check(`${name}: tooltip con nombre de taxón`, tip.length > 0 && table.includes(tip.trim()), tip);
    if (process.env.SHOT_DIR) {
      await c.ev(`document.querySelector('#app-view .ql-chartwrap').scrollIntoView()`); await sleep(300);
      await c.screenshot(process.env.SHOT_DIR + '/volcano-' + name.replace(/\W/g, '') + '.png');
    }
  }

  // exportación: el mismo pipeline que usa el botón "Descargar" del editor
  const exp = await c.ev(EXPORT_PROBE);
  check('exporta SVG/PNG/TIFF/PDF (firmas de archivo correctas)', exp.ok, JSON.stringify(exp));
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
