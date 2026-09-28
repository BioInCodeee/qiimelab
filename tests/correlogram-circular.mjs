// tests/correlogram-circular.mjs — #/correlograma, mapa de calor en
// disposición "Circular": es una reproyección de la MISMA matriz (cada
// sector anular (i,j) tiene exactamente el color de la celda (i,j) de la
// vista rectangular y su tooltip cuadra con la tabla), la matriz partida se
// conserva (dentro de la diagonal = método elegido, fuera = el otro), la
// vista rectangular sigue igual al volver, y la figura exporta SVG/PNG/TIFF/PDF.
//
//   node tests/correlogram-circular.mjs
//   SHOT_DIR=/ruta node tests/correlogram-circular.mjs   → además guarda capturas

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep, LOAD_ALL } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'correlogram-circular' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };
const click = (re) => c.ev(`(() => { const b = [...document.querySelectorAll('#app-view .ql-seg-btn, #app-view .ql-tab')].find((x) => ${re}.test(x.textContent)); if (b) b.click(); return !!b; })()`);
const fills = (sel) => c.ev(`(() => { const o = {}; document.querySelectorAll('#app-view svg.ql-svg ${sel}[data-i]').forEach((e) => { o[e.dataset.i + ',' + e.dataset.j] = e.getAttribute('fill'); }); return o; })()`);
const TIP = `async (el) => { el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); await new Promise((r) => setTimeout(r, 100)); const t = document.querySelector('#app-view .ql-tooltip'); const s = t ? t.textContent : ''; el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })); return s; }`;

try {
  await c.setViewport(1400, 1800);
  await c.goto(); await sleep(1500);
  await c.ev(LOAD_ALL); await sleep(1000);
  await c.ev(`location.hash = '#/correlograma'`); await sleep(2500);
  await click('/^Matriz/'); await sleep(1200);
  await click('/^Mapa de calor$/'); await sleep(1200);
  const rect = await fills('rect');
  check('"Disposición" ofrece "Circular"', await click('/^Circular$/'));
  await sleep(1500);
  const circ = await fills('path');
  const keys = Object.keys(rect);
  const diff = keys.filter((k) => rect[k] !== circ[k]);
  check(`mismas celdas y mismos colores que la rectangular (${keys.length} celdas)`, keys.length > 10 && Object.keys(circ).length === keys.length && diff.length === 0, diff.slice(0, 3).join(' '));

  const tipCheck = await c.ev(`(async () => {
    const svg = document.querySelector('#app-view svg.ql-svg');
    const labels = [...svg.querySelectorAll('[data-ce="collabels"] text')].map((t) => t.textContent.replace(/^\\d+ · /, ''));
    const td = document.querySelector('#app-view .ql-table tbody tr').children;
    const ia = labels.indexOf(td[0].textContent), ib = labels.indexOf(td[1].textContent);
    const tip = ${TIP};
    return { r: td[2].textContent.trim().split(' ')[0], t1: await tip(svg.querySelector('path[data-i="' + ia + '"][data-j="' + ib + '"]')), t2: await tip(svg.querySelector('path[data-i="' + ib + '"][data-j="' + ia + '"]')), rings: svg.querySelectorAll('[data-ce="rowlabels"] text').length, n: labels.length };
  })()`);
  check('tooltip del sector (i,j) y del simétrico = r de la tabla', tipCheck.t1.includes('r = ' + tipCheck.r) && tipCheck.t2.includes('r = ' + tipCheck.r), JSON.stringify(tipCheck));
  check('un anillo numerado por variable', tipCheck.rings === tipCheck.n && tipCheck.n > 3);
  if (process.env.SHOT_DIR) { await c.ev(`document.querySelector('#app-view .ql-chartwrap').scrollIntoView()`); await sleep(300); await c.screenshot(process.env.SHOT_DIR + '/circular.png'); }

  const EXPORT = `(async () => {
    const svg = document.querySelector('#app-view .ql-chartwrap svg');
    const { exportFigure } = await import('/js/lib/figureExport.js');
    const r = await exportFigure(svg, { formats: ['svg', 'png', 'tiff', 'pdf'], dpi: 150 });
    const sig = (u8) => [...u8.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const out = { svg: r.svg.length, png: sig(r.png), tiff: sig(r.tiff), pdf: sig(r.pdf) };
    out.ok = out.svg > 2000 && out.png === '89504e47' && /^(49492a00|4d4d002a)$/.test(out.tiff) && out.pdf === '25504446';
    return out;
  })()`;
  const exp = await c.ev(EXPORT);
  check('exporta SVG/PNG/TIFF/PDF (firmas de archivo correctas)', exp.ok, JSON.stringify(exp));

  // matriz partida en circular: misma regla que la rectangular (i<j = elegido, i>j = el otro)
  check('"Partida" sigue disponible en circular', await click('/^Partida/'));
  await sleep(1500);
  const split = await c.ev(`(async () => {
    const svg = document.querySelector('#app-view svg.ql-svg');
    const labels = [...svg.querySelectorAll('[data-ce="collabels"] text')].map((t) => t.textContent.replace(/^\\d+ · /, ''));
    const td = document.querySelector('#app-view .ql-table tbody tr').children;
    const ia = labels.indexOf(td[0].textContent), ib = labels.indexOf(td[1].textContent);
    const tip = ${TIP};
    return { circular: !!svg.querySelector('path[data-i]'), rA: td[2].textContent.trim().split(' ')[0], rB: td[5].textContent.trim(),
      inner: await tip(svg.querySelector('path[data-i="' + Math.min(ia, ib) + '"][data-j="' + Math.max(ia, ib) + '"]')),
      outer: await tip(svg.querySelector('path[data-i="' + Math.max(ia, ib) + '"][data-j="' + Math.min(ia, ib) + '"]')),
      legend: (svg.querySelector('[data-ce="splitlegend"]') || {}).textContent || '' };
  })()`);
  check('partida: por dentro de la diagonal = Pearson (r de la tabla)', split.circular && split.inner.includes('Pearson: r = ' + split.rA), split.inner);
  check('partida: por fuera = Spearman (r de la tabla)', split.outer.includes('Spearman: r = ' + split.rB), split.outer);
  check('la figura rotula qué método va dentro/fuera', /dentro.*Pearson.*fuera.*Spearman/.test(split.legend), split.legend);
  if (process.env.SHOT_DIR) { await c.ev(`document.querySelector('#app-view .ql-chartwrap').scrollIntoView()`); await sleep(300); await c.screenshot(process.env.SHOT_DIR + '/circular-split.png'); }

  await click('/^Rectangular$/'); await sleep(1500);
  const back = await c.ev(`(() => { const svg = document.querySelector('#app-view svg.ql-svg'); return { rects: svg.querySelectorAll('rect[data-i]').length, paths: svg.querySelectorAll('path[data-i]').length, legend: (svg.querySelector('[data-ce="splitlegend"]') || {}).textContent || '' }; })()`);
  check('vuelta a Rectangular: celdas cuadradas y partición ▲/▼ intactas', back.rects === keys.length && back.paths === 0 && /▲.*Pearson.*▼.*Spearman/.test(back.legend), JSON.stringify(back));
  await click('/^Burbujas$/'); await sleep(1200);
  check('Burbujas no ofrece disposición circular', !(await c.ev(`[...document.querySelectorAll('#app-view .ql-seg-btn')].some((b) => /^Circular$/.test(b.textContent))`)));
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
