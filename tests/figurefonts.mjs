// tests/figurefonts.mjs — Liberation Sans / Serif (SIL OFL, autoalojadas en
// fonts/) en el selector de tipografía del editor de figuras, compatibles en
// métricas con Arial / Times New Roman:
//
//   · aparecen en el selector con su etiqueta "compatible con …";
//   · se aplican en pantalla y el navegador las carga desde fonts/ (no CDN);
//   · la exportación SVG/PNG/TIFF/PDF las lleva INCRUSTADAS (@font-face con
//     data:), y el raster se dibuja de verdad con la fuente incrustada: se
//     renombra la familia a una que no existe en el sistema (aquí Liberation
//     también está instalada, así que sin esto el test no probaría nada) y el
//     resultado es idéntico píxel a píxel al original, mientras que sin el
//     @font-face incrustado sale distinto.
//
//   node tests/figurefonts.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'figurefonts' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

const CASES = [
  ['Liberation Sans', '"Liberation Sans", Arial, Helvetica, sans-serif', 'Liberation Sans (compatible con Arial)'],
  ['Liberation Serif', '"Liberation Serif", "Times New Roman", Times, serif', 'Liberation Serif (compatible con Times New Roman)'],
];

try {
  await c.goto(); await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); })()`);
  await c.ev(`location.hash = '#/alfa'`); await sleep(2000);
  await c.ev(`[...document.querySelectorAll('.ce-toolbar button')].find((x) => /Personalizar/.test(x.textContent))?.click()`); await sleep(600);

  const opts = await c.ev(`[...document.querySelectorAll('.ce-globalfont-row select option')].map((o) => o.textContent)`);
  CASES.forEach(([, , label]) => check(`el selector de tipografía ofrece "${label}"`, opts.includes(label), JSON.stringify(opts)));
  const elOpts = await c.ev(`[...document.querySelectorAll('.ce-figstyle-row select option')].map((o) => o.textContent)`);
  check('también en "Fuente de ejes y marcas"', CASES.every(([, , l]) => elOpts.includes(l)));

  for (const [family, stack] of CASES) {
    console.log('\n-- ' + family + ' --');
    await c.ev(`(() => {
      const chk = document.querySelector('.ce-globalfont-row input[type=checkbox]');
      const sel = document.querySelector('.ce-globalfont-row select');
      sel.disabled = false; sel.value = ${JSON.stringify(stack)}; sel.dispatchEvent(new Event('change', { bubbles: true }));
      if (!chk.checked) { chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true })); }
    })()`);
    await sleep(800);
    const screen = await c.ev(`(async () => {
      await document.fonts.ready;
      const svg = document.querySelector('#app-view svg.ql-svg');
      const fams = [...new Set([...svg.querySelectorAll('text')].filter((t) => t.textContent.trim()).map((t) => getComputedStyle(t).fontFamily))];
      const loaded = [...document.fonts].filter((f) => f.family.replace(/"/g, '') === ${JSON.stringify(family)} && f.status === 'loaded').length;
      const res = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => /Liberation/.test(u));
      return { fams, loaded, res };
    })()`);
    check('en pantalla, todos los textos de la figura en ' + family, screen.fams.length === 1 && screen.fams[0].includes(family), JSON.stringify(screen.fams));
    check('el navegador la ha cargado desde fonts/ del propio sitio (sin CDN)',
      screen.loaded > 0 && screen.res.length > 0 && screen.res.every((u) => u.startsWith(server.url + '/fonts/Liberation')), JSON.stringify(screen.res.map((u) => u.replace(/^.*\/fonts\//, 'fonts/'))));

    const exp = await c.ev(`(async () => {
      const svg = document.querySelector('#app-view svg.ql-svg');
      const fx = await import('/js/lib/figureExport.js');
      const r = await fx.exportFigure(svg, { formats: ['svg', 'png', 'tiff', 'pdf'], dpi: 120 });
      const sig = (u8) => [...u8.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
      const faces = [...r.svg.matchAll(/@font-face\\{font-family:'([^']+)';font-style:(\\w+);font-weight:(\\w+);src:url\\(data:font\\/woff2;base64,/g)].map((m) => m[1] + ' ' + m[2] + ' ' + m[3]);
      const attrs = [...r.svg.matchAll(/<text[^>]*font-family="([^"]*)"/g)].map((m) => m[1]);
      // raster "a pelo" de un SVG a 300×… px, reducido a una firma
      const px = async (s) => { const cv = await fx.rasterize(s, 600, Math.round(600 * r.heightPx / r.widthPx)); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let h = 0; for (let i = 0; i < d.length; i += 3) h = (h * 31 + d[i]) >>> 0; return h; };
      const esc = ${JSON.stringify(family)};
      const probeStack = "'SmartProbeFont', monospace";
      const withEmbedded = r.svg.split("font-family:'" + esc + "'").join("font-family:'SmartProbeFont'").replace(/font-family="[^"]*"/g, 'font-family="' + probeStack + '"');
      const withoutEmbedded = withEmbedded.replace(/<defs><style type="text\\/css"><!\\[CDATA\\[[\\s\\S]*?\\]\\]><\\/style><\\/defs>/, '');
      return {
        sizeKb: Math.round(r.svg.length / 1024), faces, attrsOk: attrs.length > 0 && attrs.every((a) => a.includes(esc)),
        png: sig(r.png), tiff: sig(r.tiff), pdf: sig(r.pdf),
        hOrig: await px(r.svg), hRenamed: await px(withEmbedded), hNoFont: await px(withoutEmbedded),
      };
    })()`);
    check('SVG exportado: todos los <text> con la pila "' + family + ', …"', exp.attrsOk);
    check(`SVG exportado: @font-face de ${family} incrustado (${exp.faces.join(' · ')}; ${exp.sizeKb} KB)`, exp.faces.length > 0 && exp.faces.every((f) => f.startsWith(family)));
    check('PNG/TIFF/PDF exportados (firmas de archivo correctas)', exp.png === '89504e47' && /^(49492a00|4d4d002a)$/.test(exp.tiff) && exp.pdf === '25504446', JSON.stringify({ png: exp.png, tiff: exp.tiff, pdf: exp.pdf }));
    check('el raster usa la fuente INCRUSTADA: con la familia renombrada a una inexistente sale idéntico píxel a píxel', exp.hRenamed === exp.hOrig, JSON.stringify(exp));
    check('...y sin el @font-face incrustado sale distinto (no era la fuente del sistema)', exp.hNoFont !== exp.hOrig);
  }
  check('\nsin errores de consola', c.problems.length === 0, c.problems.join('; '));
} catch (e) {
  console.error('EXCEPCIÓN:', e.message);
  failed = true;
} finally {
  c.kill();
  if (server.started) server.stop();
}
console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
