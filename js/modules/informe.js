// Informe completo exportable (#/informe; #/informe?generar lo monta directamente).
//
// NO reimplementa ningún gráfico ni ningún cálculo, y solo contiene lo que el
// usuario ha ejecutado de verdad en esta sesión: cada vez que sale de un
// módulo de análisis, app.js guarda una instantánea de lo que había en
// pantalla (js/lib/reportLog.js). El informe ensambla esas instantáneas:
//   · portada: datos cargados, fecha, versión de Smart-175
//   · Métodos: methodsText() (js/lib/methodsText.js) tal cual, para los
//     módulos incluidos
//   · Resultados: por módulo, sus avisos de equivalencia (methodNoticeHtml de
//     js/lib/methodEquivalence.js, el mismo texto que en el módulo), sus
//     figuras tal como estaban configuradas — serializadas con el mismo
//     serializeForExport() + embedFonts() que usa el editor de figuras para
//     exportar SVG — y sus tablas visibles
//   · el aviso de NCBI si se lanzó un BLAST desde Sanger
// Un módulo sin instantánea no aparece (nada de secciones vacías).
//
// Salida sin dependencias: window.print() con css/print.css (A4, sin la
// interfaz de la app, saltos de página por sección) o "Descargar HTML"
// autocontenido.

import { state } from '../state.js';
import { t, getLang, LANGS } from '../lib/i18n.js';
import { getProfileName } from '../lib/profile.js';
import { methodsText } from '../lib/methodsText.js';
import { METHODS, methodNoticeHtml } from '../lib/methodEquivalence.js';
import { serializeForExport, embedFonts } from '../lib/figureExport.js';
import { getSnapshots, harvest, takeNotedMethods, hasExternal, MAX_TABLE_ROWS } from '../lib/reportLog.js';
import { APP_VERSION } from '../lib/version.js';
import { escapeHtml } from '../lib/dom.js';
import { slotFilled } from './shell.js';

// ruta → archivo del módulo y título (clave nav.*)
const MODULES = {
  qc: { file: 'sequenceQC.js', navKey: 'nav.qc' },
  barplots: { file: 'taxaBarplot.js', navKey: 'nav.barplots' },
  alfa: { file: 'alphaDiversity.js', navKey: 'nav.alpha' },
  beta: { file: 'betaDiversity.js', navKey: 'nav.beta' },
  temporal: { file: 'temporal.js', navKey: 'nav.temporal' },
  venn: { file: 'venn.js', navKey: 'nav.venn' },
  correlograma: { file: 'correlogram.js', navKey: 'nav.correlograma' },
  diferencial: { file: 'differentialAbundance.js', navKey: 'nav.differential' },
  funcional: { file: 'functional.js', navKey: 'nav.funcional' },
  inferencia: { file: 'inference.js', navKey: 'nav.inference' },
  recuentos: { file: 'microbialCounts.js', navKey: 'nav.recuentos' },
  primers: { file: 'primers.js', navKey: 'nav.primers' },
  arbol: { file: 'phylo.js', navKey: 'nav.arbol' },
  sanger: { file: 'sanger.js', navKey: 'nav.sanger' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Instantánea tomada en otro idioma (el usuario cambió de idioma después):
// se vuelve a montar el módulo fuera de pantalla para que figuras y tablas
// salgan en el idioma del informe. Si no produce nada (p. ej. un módulo que
// necesita un clic para calcular), se queda la instantánea original.
async function reharvest(snap) {
  const off = document.createElement('div');
  off.setAttribute('aria-hidden', 'true');
  off.style.cssText = 'position:absolute;left:-9999px;top:0;width:1080px;pointer-events:none;';
  document.body.appendChild(off);
  let cleanup = null;
  try {
    const mod = await import('./' + MODULES[snap.id].file);
    cleanup = mod.render(off) || null;
    await sleep(120); // deja asentar layout / getBBox del editor de figuras
    const h = harvest(off);
    if (h.figures.length || h.tables.length) {
      return { ...snap, ...h, methodIds: [...new Set([...snap.methodIds, ...h.methodIds, ...takeNotedMethods(snap.id)])], regenerated: true };
    }
  } catch (e) { /* se usa la instantánea original */ } finally {
    if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { /* noop */ } }
    off.remove();
    takeNotedMethods(snap.id); // lo declarado fuera de pantalla no cuenta como visita
  }
  return snap;
}

// clon de figura → <img> con el SVG exportado (colores resueltos en claro,
// fondo blanco, fuentes incrustadas): idéntico a "Descargar SVG" del editor
async function figureImage(svgClone, host, alt) {
  host.appendChild(svgClone); // serializeForExport necesita el nodo en el documento (getComputedStyle)
  let str;
  try {
    str = serializeForExport(svgClone, { scheme: 'light', background: 'white' }).svg;
  } finally {
    svgClone.remove();
  }
  str = await embedFonts(str);
  const img = document.createElement('img');
  img.className = 'ql-report-img';
  img.alt = alt;
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  return img;
}

// Inlinea css/fonts.css con cada woff2 como data URI, para que el HTML
// autocontenido no dependa de ninguna petición de red.
async function inlineFontsCss() {
  let css;
  try { css = await (await fetch('css/fonts.css')).text(); }
  catch (e) { return ''; }
  const urls = [...new Set([...css.matchAll(/url\((\.\.\/fonts\/[^)]+\.woff2)\)/g)].map((m) => m[1]))];
  for (const rel of urls) {
    try {
      const buf = await (await fetch(rel.replace('../', ''))).arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const dataUri = 'data:font/woff2;base64,' + btoa(bin);
      css = css.split('url(' + rel + ')').join('url(' + dataUri + ')');
    } catch (e) { /* deja la url relativa; degradará a la fuente del sistema */ }
  }
  return css;
}

async function buildStandaloneHtml(reportEl, lang) {
  const cssFiles = ['css/tokens.css', 'css/base.css', 'css/components.css', 'css/print.css'];
  const [styles, fontsCss] = await Promise.all([
    Promise.all(cssFiles.map(async (f) => {
      try { return await (await fetch(f)).text(); } catch (e) { return ''; }
    })),
    inlineFontsCss(),
  ]);
  const clone = reportEl.cloneNode(true);
  clone.querySelectorAll('.ql-report-actions, button').forEach((n) => n.remove());
  const extra = 'body.ql-standalone{margin:0;background:var(--surface);color:var(--ink);'
    + 'font-family:var(--font-body);padding:32px 20px;}'
    + '.ql-standalone .ql-report{margin:0 auto;}'
    + '@media print{body.ql-standalone{padding:0;}}';
  return '<!doctype html><html lang="' + escapeHtml(lang) + '" data-theme="light"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + escapeHtml(t('informe.docTitle')) + '</title>'
    + '<style>' + fontsCss + '</style>'
    + styles.map((s) => '<style>' + s + '</style>').join('')
    + '<style>' + extra + '</style>'
    + '</head><body class="ql-standalone">' + clone.outerHTML + '</body></html>';
}

function download(name, text, mime) {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) { /* entorno sin descargas */ }
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

// nombres de los archivos cargados (la "identidad" del dataset)
function datasetLabel() {
  const names = state.files.map((f) => f.name).filter(Boolean);
  if (!names.length) return '';
  const MAX = 6;
  return names.slice(0, MAX).join(', ') + (names.length > MAX ? ' ' + t('informe.coverMoreFiles', { n: names.length - MAX }) : '');
}

/** Monta el documento del informe (sin los controles de la página). */
async function buildReport(snaps, includeMethods) {
  const report = el('article', 'ql-report');
  report.setAttribute('lang', getLang());
  const dateStr = new Date().toISOString().slice(0, 10);

  // instantáneas en otro idioma → se regeneran en el idioma actual
  const lang = getLang();
  const sections = [];
  for (const s of snaps) sections.push(s.lang === lang ? s : await reharvest(s));

  // ---- portada ----
  const cover = el('section', 'ql-report-cover');
  cover.appendChild(el('p', 'ql-report-brand', 'Smart-175'));
  cover.appendChild(el('h1', 'ql-report-title', t('informe.docTitle')));
  const meta = el('dl', 'ql-report-meta');
  const addMeta = (k, v) => { if (!v) return; meta.appendChild(el('dt', null, k)); meta.appendChild(el('dd', null, v)); };
  addMeta(t('informe.coverDataset'), datasetLabel());
  addMeta(t('informe.coverAuthor'), getProfileName());
  addMeta(t('informe.coverDate'), dateStr);
  addMeta(t('informe.coverVersion'), 'Smart-175 ' + APP_VERSION);
  addMeta(t('informe.coverLang'), (LANGS.find((l) => l.code === lang) || {}).label || lang);
  cover.appendChild(meta);
  cover.appendChild(el('h2', 'ql-report-toc-title', t('informe.coverContents')));
  const toc = el('ol', 'ql-report-toc');
  if (includeMethods) toc.appendChild(el('li', null, t('informe.methodsHeading')));
  sections.forEach((s) => toc.appendChild(el('li', null, t(MODULES[s.id].navKey))));
  if (hasExternal('ncbi-blast')) toc.appendChild(el('li', null, t('informe.externalHeading')));
  cover.appendChild(toc);
  cover.appendChild(el('p', 'ql-report-note', t('informe.coverNote')));
  report.appendChild(cover);

  // ---- métodos: el generador existente, tal cual ----
  if (includeMethods) {
    const mt = methodsText(sections.map((s) => s.id));
    if (mt.paragraphs.length) {
      const sec = el('section', 'ql-report-section ql-report-methods');
      sec.appendChild(el('h2', null, mt.heading));
      sec.appendChild(el('p', 'ql-report-disclaimer', mt.disclaimer));
      mt.paragraphs.forEach((p) => sec.appendChild(el('p', 'ql-report-para', p)));
      report.appendChild(sec);
    } else {
      toc.firstChild.remove();
    }
  }

  // ---- resultados, módulo a módulo ----
  const host = document.createElement('div'); // nodo temporal para serializar figuras
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;width:1080px;pointer-events:none;';
  document.body.appendChild(host);
  let figN = 0;
  try {
    for (const s of sections) {
      const title = t(MODULES[s.id].navKey);
      const sec = el('section', 'ql-report-section');
      sec.dataset.module = s.id;
      sec.appendChild(el('h2', null, title));
      // un aviso por análisis (el mismo que muestra el módulo), de más a
      // menos grave; los idénticos (Pearson/Spearman → stats::cor) una vez
      const notices = [...new Set(['C', 'B', 'A']
        .flatMap((lv) => s.methodIds.filter((id) => METHODS[id] && METHODS[id].level === lv))
        .map((id) => methodNoticeHtml(id, { withA: true })))].join('');
      if (notices) {
        const box = el('div', 'ql-method-notices ql-report-notices');
        box.innerHTML = notices;
        sec.appendChild(box);
      }
      if (s.regenerated) sec.appendChild(el('p', 'ql-field-help', t('informe.regenerated')));
      for (const svg of s.figures) {
        figN++;
        const fig = el('figure', 'ql-report-fig');
        try {
          fig.appendChild(await figureImage(svg.cloneNode(true), host, t('informe.figAlt', { n: figN, module: title })));
        } catch (e) {
          fig.appendChild(el('p', 'ql-field-help', t('informe.figError')));
        }
        fig.appendChild(el('figcaption', null, t('informe.figCaption', { n: figN, module: title })));
        sec.appendChild(fig);
      }
      s.tables.forEach((tbl) => {
        const wrap = el('div', 'ql-table-scroll ql-report-table');
        wrap.appendChild(tbl.cloneNode(true));
        sec.appendChild(wrap);
      });
      if (s.truncated) sec.appendChild(el('p', 'ql-field-help', t('informe.tableTrunc', { n: MAX_TABLE_ROWS })));
      report.appendChild(sec);
    }
  } finally {
    host.remove();
  }

  // ---- datos que salieron del navegador (BLAST de Sanger) ----
  if (hasExternal('ncbi-blast')) {
    const sec = el('section', 'ql-report-section ql-report-external');
    sec.appendChild(el('h2', null, t('informe.externalHeading')));
    sec.appendChild(el('p', 'ql-method-notice ql-method-c', t('sanger.blastNote')));
    report.appendChild(sec);
  }
  return { report, dateStr };
}

export function render(container) {
  let includeMethods = true;
  let alive = true;
  const autoGenerate = /[?&]generar\b/.test(location.hash);

  // el informe se imprime siempre en claro, sea cual sea el tema activo
  // (mismo criterio que serializeForExport para las figuras)
  const root = document.documentElement;
  let prevTheme;
  const beforePrint = () => { prevTheme = root.getAttribute('data-theme'); root.setAttribute('data-theme', 'light'); };
  const afterPrint = () => {
    if (prevTheme === undefined) return;
    if (prevTheme == null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', prevTheme);
    prevTheme = undefined;
  };
  window.addEventListener('beforeprint', beforePrint);
  window.addEventListener('afterprint', afterPrint);

  const header = el('header', 'ql-page-header ql-report-screen');
  header.innerHTML =
    '<p class="ql-eyebrow">' + t('informe.eyebrow') + '</p>' +
    '<h1 class="ql-page-title">' + t('informe.title') + '</h1>' +
    '<p class="ql-page-sub">' + t('informe.subtitle') + '</p>';
  container.appendChild(header);

  const snaps = getSnapshots();

  if (snaps.length === 0) {
    const card = el('div', 'ql-card ql-panel ql-report-screen');
    const ready = Object.keys(MODULES).filter((id) => slotFilled(id) && id !== 'primers' && id !== 'arbol' && id !== 'sanger');
    card.innerHTML = '<div class="ql-empty">' +
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M7 3h8l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>' +
      '<h3>' + t('informe.emptyTitle') + '</h3><p>' + t('informe.emptyDesc') + '</p>' +
      (ready.length
        ? '<p class="ql-field-help">' + t('informe.emptyReady') + '</p><div class="ql-report-links">' +
          ready.map((id) => '<a class="ql-btn" href="#/' + id + '">' + escapeHtml(t(MODULES[id].navKey)) + '</a>').join('') + '</div>'
        : '<a href="#/cargar" class="ql-btn">' + t('ui.goLoadData') + '</a>') +
      '</div>';
    container.appendChild(card);
    return () => { alive = false; window.removeEventListener('beforeprint', beforePrint); window.removeEventListener('afterprint', afterPrint); };
  }

  // ---- panel: qué se incluye (solo lo ejecutado en esta sesión) ----
  const selected = new Set(snaps.map((s) => s.id));
  const controls = el('section', 'ql-card ql-panel ql-report-controls ql-report-screen');
  controls.innerHTML = '<h2>' + t('informe.pickTitle') + '</h2><p class="ql-panel-note">' + t('informe.pickNote') + '</p>';
  const list = el('div', 'ql-checklist');
  list.style.marginBottom = '16px';
  const genBtn = el('button', 'ql-btn ql-btn-primary', t('informe.generate'));
  genBtn.type = 'button';
  snaps.forEach((s) => {
    const row = el('label', 'ql-checkrow');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => { cb.checked ? selected.add(s.id) : selected.delete(s.id); genBtn.disabled = selected.size === 0; });
    row.appendChild(cb);
    row.appendChild(document.createTextNode(' ' + t(MODULES[s.id].navKey)));
    list.appendChild(row);
  });
  controls.appendChild(list);

  const methodsRow = el('label', 'ql-checkrow');
  methodsRow.style.marginBottom = '14px';
  const mcb = document.createElement('input');
  mcb.type = 'checkbox';
  mcb.checked = includeMethods;
  mcb.addEventListener('change', () => { includeMethods = mcb.checked; });
  methodsRow.appendChild(mcb);
  methodsRow.appendChild(document.createTextNode(' ' + t('informe.includeMethods')));
  controls.appendChild(methodsRow);
  controls.appendChild(genBtn);
  container.appendChild(controls);

  const out = el('div', 'ql-report-host');
  container.appendChild(out);

  async function generate() {
    genBtn.disabled = true;
    const prevLabel = genBtn.textContent;
    genBtn.textContent = t('informe.generating');
    out.innerHTML = '<p class="ql-field-help ql-report-screen" role="status" style="margin-top:16px;">' + t('informe.generating') + '</p>';

    const { report, dateStr } = await buildReport(snaps.filter((s) => selected.has(s.id)), includeMethods);
    if (!alive) return;

    const actions = el('div', 'ql-report-actions ql-report-screen');
    const printBtn = el('button', 'ql-btn ql-btn-primary', t('informe.print'));
    printBtn.type = 'button';
    printBtn.addEventListener('click', () => window.print());
    const htmlBtn = el('button', 'ql-btn', t('informe.downloadHtml'));
    htmlBtn.type = 'button';
    htmlBtn.addEventListener('click', async () => {
      htmlBtn.disabled = true;
      const html = await buildStandaloneHtml(report, getLang());
      download('informe-smart-175-' + dateStr + '.html', html, 'text/html;charset=utf-8');
      htmlBtn.disabled = false;
    });
    actions.appendChild(printBtn);
    actions.appendChild(htmlBtn);
    actions.appendChild(el('p', 'ql-field-help', t('informe.printHint')));

    out.innerHTML = '';
    out.appendChild(actions);
    out.appendChild(report);
    genBtn.textContent = prevLabel;
    genBtn.disabled = selected.size === 0;
    const smooth = !window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    actions.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }
  genBtn.addEventListener('click', generate);
  if (autoGenerate) generate();

  return () => { alive = false; window.removeEventListener('beforeprint', beforePrint); window.removeEventListener('afterprint', afterPrint); };
}
