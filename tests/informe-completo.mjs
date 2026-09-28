// tests/informe-completo.mjs
// Informe completo (#/informe, js/modules/informe.js + js/lib/reportLog.js):
//   1. sin haber abierto ningún análisis → estado vacío (no una plantilla)
//   2. se ejecutan alfa, beta (PERMANOVA) y correlograma; desde el
//      correlograma se pulsa «Generar informe completo» de la barra lateral
//   3. el informe contiene EXACTAMENTE esos 3 módulos (no barplots, venn…
//      aunque tengan datos), la sección de Métodos es la salida de
//      methodsText() tal cual, las figuras son <img> que cargan y no están en
//      blanco, y los avisos de equivalencia son el mismo texto que el módulo
//   4. impresión emulada: nada de la interfaz visible, un salto de página
//      por sección, texto negro también con el tema oscuro; PDF A4 real
//   5. mismo informe en inglés (cambio de idioma con el informe abierto)
//   6. BLAST de Sanger lanzado → sección de datos enviados a NCBI
//
//   REPORT_PDF_OUT=/ruta/informe.pdf node tests/informe-completo.mjs  → guarda el PDF

import { writeFileSync } from 'node:fs';
import { findChrome, skip } from './lib/env.mjs';

if (!findChrome()) skip('sin Chrome');

const { ensureServer } = await import('./lib/server.mjs');
const { connect } = await import('./lib/cdp.mjs');
const { sleep, LOAD_ALL } = await import('./lib/app.mjs');

let failed = 0;
function check(name, ok, detail = '') {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (!ok && detail ? '  → ' + detail : ''));
  if (!ok) failed++;
}

const server = await ensureServer();
const c = await connect({ url: server.url + '/index.html', label: 'informe-completo' });

async function waitFor(expr, ms = 15000) {
  for (let t = 0; t < ms; t += 250) { if (await c.ev(expr)) return true; await sleep(250); }
  return false;
}
const visit = async (hash) => {
  await c.ev(`location.hash = '${hash}'`);
  return waitFor(`document.querySelectorAll('#app-view svg.ql-svg').length > 0 && !document.querySelector('#app-view .ql-skel')`);
};
const reportReady = () => waitFor(`!!document.querySelector('.ql-report') && [...document.querySelectorAll('.ql-report-img')].every((i) => i.complete)`, 30000);

try {
  await c.goto(); await sleep(1500);
  await c.ev(LOAD_ALL); await sleep(1500);

  console.log('\n--- 1. sin análisis ejecutados ---');
  await c.ev(`location.hash = '#/informe'`); await sleep(1200);
  const empty = await c.ev(`({ report: !!document.querySelector('.ql-report'), empty: !!document.querySelector('#app-view .ql-empty'), links: document.querySelectorAll('.ql-report-links a').length })`);
  check('estado vacío con enlaces a los módulos con datos, sin informe', !empty.report && empty.empty && empty.links > 0, JSON.stringify(empty));

  console.log('\n--- 2. alfa + beta (PERMANOVA) + correlograma ---');
  check('#/alfa pinta su figura', await visit('#/alfa'));
  await sleep(1500);
  check('#/beta pinta su figura', await visit('#/beta'));
  await c.ev(`[...document.querySelectorAll('#app-view .ql-tab')].find((x) => /PCoA/.test(x.textContent))?.click()`);
  await waitFor(`!!document.querySelector('#app-view .ql-method-notice[data-method-level="B"]')`);
  await sleep(800);
  const betaNotice = await c.ev(`(document.querySelector('#app-view .ql-method-notice[data-method-level="B"]') || {}).textContent || ''`);
  check('beta muestra la nota Nivel B de PERMANOVA', /adonis2/.test(betaNotice), betaNotice);
  check('#/correlograma pinta su figura', await visit('#/correlograma'));
  await sleep(1200);

  const cta = await c.ev(`(() => { const a = document.querySelector('#sidebar a.ql-report-cta'); return a ? { href: a.getAttribute('href'), text: a.textContent.trim() } : null; })()`);
  check('la barra lateral tiene «Generar informe completo»', !!cta && /Generar informe completo/.test(cta.text) && cta.href === '#/informe?generar', JSON.stringify(cta));
  await c.ev(`document.querySelector('#sidebar a.ql-report-cta').click()`);
  check('el botón monta el informe directamente', await reportReady());
  await sleep(500);

  console.log('\n--- 3. contenido ---');
  const r = await c.ev(`(async () => {
    const { methodsText } = await import('/js/lib/methodsText.js');
    const secs = [...document.querySelectorAll('.ql-report-section[data-module]')];
    const imgs = [...document.querySelectorAll('.ql-report-img')];
    const blank = imgs.map((img) => {
      const cv = document.createElement('canvas'); cv.width = 300; cv.height = Math.max(1, Math.round(300 * img.naturalHeight / img.naturalWidth));
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0, cv.width, cv.height);
      const d = g.getImageData(0, 0, cv.width, cv.height).data; let ink = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) ink++;
      return ink / (d.length / 4);
    });
    const paras = [...document.querySelectorAll('.ql-report-methods .ql-report-para')].map((p) => p.textContent);
    return {
      modules: secs.map((s) => s.dataset.module),
      figsPer: secs.map((s) => s.querySelectorAll('.ql-report-img').length),
      tablesPer: secs.map((s) => s.querySelectorAll('.ql-table').length),
      natural: imgs.map((i) => i.naturalWidth),
      blank,
      methodsSame: JSON.stringify(paras) === JSON.stringify(methodsText(['alfa', 'beta', 'correlograma']).paragraphs),
      nParas: paras.length,
      cover: document.querySelector('.ql-report-cover')?.textContent || '',
      betaNotices: [...document.querySelectorAll('.ql-report-section[data-module="beta"] .ql-method-notice')].map((n) => n.getAttribute('data-method-level') + ':' + n.textContent),
      corrNotices: [...document.querySelectorAll('.ql-report-section[data-module="correlograma"] .ql-method-notice')].map((n) => n.getAttribute('data-method-level') + ':' + n.textContent),
      leftovers: document.querySelectorAll('.ql-report .ce-hit, .ql-report .ce-outline, .ql-report svg.ql-svg').length,
    };
  })()`);
  check('solo los 3 módulos ejecutados, en orden', JSON.stringify(r.modules) === '["alfa","beta","correlograma"]', JSON.stringify(r.modules));
  check('cada sección trae al menos una figura', r.figsPer.every((n) => n >= 1), JSON.stringify(r.figsPer));
  check('alfa y beta traen su tabla de resultados', r.tablesPer[0] >= 1 && r.tablesPer[1] >= 1, JSON.stringify(r.tablesPer));
  check('todas las figuras cargan (no rotas)', r.natural.length >= 3 && r.natural.every((w) => w > 0), JSON.stringify(r.natural));
  check('ninguna figura en blanco (>1% de píxeles con tinta)', r.blank.every((f) => f > 0.01), JSON.stringify(r.blank.map((f) => f.toFixed(3))));
  check('las figuras son el SVG exportado, sin restos del editor', r.leftovers === 0, String(r.leftovers));
  check('Métodos = methodsText() tal cual', r.methodsSame && r.nParas >= 3, 'paras=' + r.nParas);
  check('portada: datos, fecha y versión', /Datos/.test(r.cover) && /\d{4}-\d{2}-\d{2}/.test(r.cover) && /Smart-175 \d{4}\.\d{2}\.\d{2}/.test(r.cover), r.cover.slice(0, 200));
  check('beta: la misma nota Nivel B que en el módulo', r.betaNotices.some((n) => n === 'B:' + betaNotice), JSON.stringify(r.betaNotices));
  check('beta: pseudo-F de PERMANOVA como Nivel A', r.betaNotices.some((n) => /^A:.*adonis2 \(pseudo-F\)/.test(n)), JSON.stringify(r.betaNotices));
  check('correlograma: Pearson → Nivel A (stats::cor)', r.corrNotices.some((n) => /^A:.*stats::cor/.test(n)), JSON.stringify(r.corrNotices));

  console.log('\n--- 4. impresión ---');
  await c.ev(`document.documentElement.setAttribute('data-theme', 'dark')`);
  await c.rpc('Emulation.setEmulatedMedia', { media: 'print' }, c.sessionId);
  await sleep(300);
  const p = await c.ev(`(() => {
    const shown = (sel) => [...document.querySelectorAll(sel)].filter((n) => n.getClientRects().length > 0).length;
    const secs = [...document.querySelectorAll('.ql-report-section')];
    return {
      ui: shown('#sidebar') + shown('#app-footer') + shown('.ql-report-screen') + shown('.ql-report-actions') + shown('#app-view button') + shown('.ql-skip-link'),
      breaks: secs.map((s) => getComputedStyle(s).breakBefore),
      figAvoid: [...document.querySelectorAll('.ql-report-fig')].every((f) => getComputedStyle(f).breakInside === 'avoid'),
      tblAvoid: [...document.querySelectorAll('.ql-report .ql-table tr')].every((f) => getComputedStyle(f).breakInside === 'avoid'),
      ink: getComputedStyle(document.querySelector('.ql-report-para')).color,
      h2: getComputedStyle(document.querySelector('.ql-report-section h2')).color,
      bg: getComputedStyle(document.body).backgroundColor,
      htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    };
  })()`);
  check('ningún elemento de la interfaz visible al imprimir', p.ui === 0, String(p.ui));
  check('salto de página antes de cada sección', p.breaks.length >= 4 && p.breaks.every((b) => b === 'page'), JSON.stringify(p.breaks));
  check('figuras y filas de tabla sin partir', p.figAvoid && p.tblAvoid);
  check('negro sobre blanco aunque el tema sea oscuro', p.ink === 'rgb(0, 0, 0)' && p.h2 === 'rgb(0, 0, 0)' && p.bg === 'rgb(255, 255, 255)' && p.htmlBg === 'rgb(255, 255, 255)', JSON.stringify(p));
  await c.rpc('Emulation.setEmulatedMedia', { media: '' }, c.sessionId);
  await c.ev(`document.documentElement.setAttribute('data-theme', 'light')`);
  const pdf = await c.rpc('Page.printToPDF', { preferCSSPageSize: true, printBackground: true }, c.sessionId);
  const buf = Buffer.from(pdf.data, 'base64');
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  const mb = buf.toString('latin1').match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\]/);
  check('PDF generado, A4 (595×842 pt), ≥ 5 páginas (portada + métodos + 3 módulos)', !!mb && Math.abs(+mb[1] - 595.3) < 2 && Math.abs(+mb[2] - 841.9) < 2 && pages >= 5, `pages=${pages} box=${mb && mb.slice(1)}`);
  if (process.env.REPORT_PDF_OUT) { writeFileSync(process.env.REPORT_PDF_OUT, buf); console.log('  (PDF guardado en ' + process.env.REPORT_PDF_OUT + ')'); }

  console.log('\n--- 5. en inglés ---');
  await c.ev(`(async () => { const { setLang } = await import('/js/lib/i18n.js'); setLang('en'); })()`);
  await sleep(600);
  check('el informe se regenera al cambiar de idioma', await reportReady());
  await sleep(500);
  const en = await c.ev(`({
    modules: [...document.querySelectorAll('.ql-report-section[data-module]')].map((s) => s.dataset.module),
    titles: [...document.querySelectorAll('.ql-report-section > h2')].map((h) => h.textContent),
    doc: document.querySelector('.ql-report-title')?.textContent,
    cta: document.querySelector('#sidebar a.ql-report-cta')?.textContent.trim(),
    btn: [...document.querySelectorAll('.ql-report-actions button')].map((b) => b.textContent),
    notice: [...document.querySelectorAll('.ql-report-section[data-module="beta"] .ql-method-notice')].map((n) => n.textContent).join(' | '),
    imgs: [...document.querySelectorAll('.ql-report-img')].filter((i) => i.naturalWidth > 0).length,
  })`);
  check('mismos 3 módulos', JSON.stringify(en.modules) === '["alfa","beta","correlograma"]', JSON.stringify(en.modules));
  check('títulos en inglés', en.doc === 'Analysis report — Smart-175' && en.titles.includes('Methods') && en.titles.includes('Alpha diversity') && en.titles.includes('Beta diversity'), JSON.stringify(en));
  check('botón global e impresión en inglés', en.cta === 'Generate full report' && en.btn.includes('Print / Save as PDF'), JSON.stringify([en.cta, en.btn]));
  check('avisos de equivalencia en inglés', /Level B/.test(en.notice) && !/Nivel/.test(en.notice), en.notice.slice(0, 160));
  check('figuras regeneradas cargan', en.imgs >= 3, String(en.imgs));
  await c.ev(`(async () => { const { setLang } = await import('/js/lib/i18n.js'); setLang('es'); })()`);
  await reportReady();

  console.log('\n--- 6. BLAST de Sanger ---');
  const before = await c.ev(`!!document.querySelector('.ql-report-external')`);
  check('sin BLAST no hay sección de datos enviados', !before);
  await c.ev(`(async () => { const m = await import('/js/lib/reportLog.js'); m.markExternal('ncbi-blast'); })()`);
  await c.ev(`[...document.querySelectorAll('#app-view button')].find((b) => /^Generar informe$/.test(b.textContent.trim()))?.click()`);
  await sleep(400); await reportReady(); await sleep(300);
  const ext = await c.ev(`(async () => { const { t } = await import('/js/lib/i18n.js'); const s = document.querySelector('.ql-report-external'); return { txt: s ? s.textContent : '', want: t('sanger.blastNote') }; })()`);
  check('con BLAST: el aviso de NCBI de Sanger, mismo texto', ext.txt.includes(ext.want), ext.txt.slice(0, 120));

  check('0 errores de consola', c.problems.length === 0, c.problems.slice(0, 3).join(' | '));
} catch (e) {
  check('sin excepciones', false, e.stack || String(e));
} finally {
  c.kill();
  if (server.stop) server.stop();
}

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
