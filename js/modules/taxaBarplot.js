import { state, subscribe } from '../state.js';
import { t, getLang } from '../lib/i18n.js';
import { loadExampleCommunityData, loadRealCommunityData, mountExampleButtons } from '../lib/exampleData.js';
import { attachChartEditor, getFigureGeometry, getFigureOptions } from '../lib/chartEditor.js';
import { makeGroupResolver } from '../lib/sampleMatch.js';
import { groupColor } from '../lib/groupBoxplot.js';
import { kruskalWallis, benjaminiHochberg, cliffsDelta, quartiles, formatP, lefseLdaScore, studentTwoTailedP } from '../lib/stats.js';
import { ancomBC } from '../lib/ancomBC.js';
import { glossaryLinkHtml } from '../lib/glossaryLink.js';
import { randomForest } from '../lib/randomForest.js';
import { computeGroupTaxaMatrix, computeAlluvialLayout } from '../lib/alluvial.js';
import { svgEl, escapeHtml, delegateHover, moreDetailsHtml, plotClip } from '../lib/dom.js';
import { orderCategories } from '../lib/categoryOrder.js';
import { showTooltip as showTooltipCentral, hideTooltip } from '../lib/tooltip.js';
import { chartTypeField } from '../lib/chartTypeSelector.js';
import { normalizeHeader } from '../lib/csv.js';
import { methodNotice } from '../lib/methodEquivalence.js';
import { paletteColorAt } from '../lib/palettes.js';
import {
  createSunburstRoot, insertTaxon, buildLineageIndex, lineageToPath,
  computeSunburstLayout, arcPath, polarPoint, findNodeByPath, treeMaxDepth,
} from '../lib/sunburst.js';

export const CAT_VARS = ['--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5', '--cat-6', '--cat-7'];
export const OTHER_VAR = '--cat-8';
export const TOP_N_DEFAULT = 15, TOP_N_MIN = 5, TOP_N_MAX = 50;
export const MIN_ABUND_DEFAULT = 1, MIN_ABUND_MIN = 0, MIN_ABUND_MAX = 10;
export const OTHER_COLOR = '#d3d3d3';
export const OTHER_COL_RE = /^(others?|otros?|resto)$/i;
const ALLUVIAL_CE_KEY = 'taxaBarplot-alluvial'; // misma key que usa attachChartEditor más abajo

export function shortTaxonName(fullTax) {
  if (!fullTax) return t('barplots.unclassified') || 'Sin clasificar';
  const parts = String(fullTax).split(';').map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || fullTax;
  const cleaned = String(last).replace(/^[a-z]__/i, '');
  return cleaned || t('barplots.unclassified') || 'Sin clasificar';
}

/**
 * Agrupa los taxones minoritarios bajo la categoría "Otros" según su abundancia relativa
 * dataset-wide y el límite topN.
 *
 * @param {Object|Array} data - Objeto { headers, rows } o Array de filas (objetos de muestra)
 * @param {number|Object} [minAbundanceOrOpts=1] - Umbral de abundancia mínima (ej. 1 para 1%, o 0.01) u objeto de opciones
 * @param {number} [topNParam=15] - Cantidad máxima de taxones principales a conservar (5-50)
 * @param {Object} [options={}] - Opciones adicionales ({ minPrev, sampleKey, isPercentage })
 * @returns {{
 *   headers: string[],
 *   rows: Object[],
 *   topTaxa: string[],
 *   otherTaxa: string[],
 *   preAggOtherHeaders: string[],
 *   means: Array<{ header: string, mean: number, prev: number }>,
 *   series: Array<{ key: string, label: string, colorVar?: string, color?: string, isOther?: boolean }>,
 *   sampleKey: string,
 *   hasOther: boolean,
 *   minAbundance: number,
 *   topN: number,
 *   minPrev: number
 * }}
 */
export function groupTaxaByAbundance(data, minAbundanceOrOpts = 1, topNParam = 15, options = {}) {
  let minAbundance = 1;
  let topN = 15;
  let opts = {};

  if (typeof minAbundanceOrOpts === 'object' && minAbundanceOrOpts !== null) {
    opts = { ...minAbundanceOrOpts };
    minAbundance = opts.minAbundance !== undefined ? opts.minAbundance : 1;
    topN = opts.topN !== undefined ? opts.topN : (topNParam !== undefined ? topNParam : 15);
  } else {
    opts = { ...options };
    minAbundance = minAbundanceOrOpts !== undefined ? minAbundanceOrOpts : 1;
    topN = topNParam !== undefined ? topNParam : 15;
  }

  // Convertir minAbundance a fracción decimal (ej: 1 o 1% -> 0.01, 5 -> 0.05, 0.01 -> 0.01)
  let minAbundFrac = 0;
  if (typeof minAbundance === 'number' && !isNaN(minAbundance)) {
    if (opts.isPercentage) {
      minAbundFrac = minAbundance / 100;
    } else if (minAbundance > 1) {
      minAbundFrac = minAbundance / 100;
    } else if (minAbundance === 1 && !opts.isFraction) {
      minAbundFrac = 0.01;
    } else {
      minAbundFrac = Math.max(0, minAbundance);
    }
  }

  const minPrev = typeof opts.minPrev === 'number' ? opts.minPrev : 0;

  let headers = [];
  let rows = [];
  let sampleKey = opts.sampleKey || null;

  if (data && Array.isArray(data.rows) && Array.isArray(data.headers)) {
    headers = data.headers.slice();
    rows = data.rows;
    sampleKey = sampleKey || headers[0] || 'SampleID';
  } else if (Array.isArray(data)) {
    rows = data;
    if (rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) {
      headers = Object.keys(rows[0]);
      sampleKey = sampleKey || headers[0] || 'SampleID';
    }
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.rows)) rows = data.rows;
    if (Array.isArray(data.headers)) headers = data.headers.slice();
    sampleKey = sampleKey || (headers.length > 0 ? headers[0] : 'SampleID');
  }

  const taxonHeaders = headers.filter((h, i) => h !== sampleKey && !OTHER_COL_RE.test(String(h).trim()));
  const preAggOtherHeaders = headers.filter((h, i) => h !== sampleKey && OTHER_COL_RE.test(String(h).trim()));

  const rowSum = (row) => {
    let sum = 0;
    for (let i = 0; i < taxonHeaders.length; i++) {
      sum += parseFloat(row[taxonHeaders[i]]) || 0;
    }
    for (let i = 0; i < preAggOtherHeaders.length; i++) {
      sum += parseFloat(row[preAggOtherHeaders[i]]) || 0;
    }
    return sum;
  };

  const nRows = rows.length || 1;
  const means = taxonHeaders.map((h) => {
    let present = 0;
    let sumFrac = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const t = rowSum(r);
      const val = parseFloat(r[h]) || 0;
      if (val > 0) present++;
      if (t > 0) sumFrac += (val / t);
    }
    return {
      header: h,
      mean: sumFrac / nRows,
      prev: present / nRows,
    };
  }).sort((a, b) => b.mean - a.mean);

  // Filtro de elegibilidad: cumple umbral de abundancia mínima y prevalencia mínima
  const eligible = means.filter((m) => {
    const meetsAbund = m.mean >= (minAbundFrac - 1e-9);
    const meetsPrev = (m.prev * 100) >= (minPrev - 1e-9);
    return meetsAbund && meetsPrev;
  });

  const targetTopN = Math.max(1, topN);
  const topEligible = eligible.slice(0, targetTopN);
  const topSet = new Set(topEligible.map((m) => m.header));

  const topTaxa = means.filter((m) => topSet.has(m.header)).map((m) => m.header);
  const otherTaxa = means.filter((m) => !topSet.has(m.header)).map((m) => m.header);
  const hasOther = otherTaxa.length > 0 || preAggOtherHeaders.length > 0;

  // Orden de categorías (Paso 2/G4 de qiimelab-prompt-editor-fase-4-ejes-
  // rejilla-leyenda-lienzo.md) — SOLO cambia el orden de apilado/filas
  // dentro de los ya elegidos como "top N por abundancia" (topSet arriba no
  // se toca): "original" mantiene el criterio de siempre (abundancia
  // descendente, ya es el orden natural de `means`). 'Otros' nunca entra
  // aquí, se añade aparte siempre al final (ver más abajo).
  if (opts.categoryOrder && opts.categoryOrder !== 'original' && opts.categoryOrder !== 'value-desc') {
    const byMean = new Map(means.map((m) => [m.header, m.mean]));
    const cmp = {
      'alpha-asc': (a, b) => shortTaxonName(a).localeCompare(shortTaxonName(b)),
      'alpha-desc': (a, b) => shortTaxonName(b).localeCompare(shortTaxonName(a)),
      'value-asc': (a, b) => byMean.get(a) - byMean.get(b),
    }[opts.categoryOrder];
    if (cmp) topTaxa.sort(cmp);
  }

  // Suma de abundancias de taxones minoritarios muestra por muestra asignadas a 'Otros'
  const groupedRows = rows.map((row) => {
    const newRow = {};
    if (sampleKey) newRow[sampleKey] = row[sampleKey];
    const total = rowSum(row) || 1;

    topTaxa.forEach((th) => {
      newRow[th] = row[th] !== undefined ? row[th] : 0;
    });

    let otherSum = 0;
    otherTaxa.forEach((th) => {
      otherSum += parseFloat(row[th]) || 0;
    });
    preAggOtherHeaders.forEach((poh) => {
      otherSum += parseFloat(row[poh]) || 0;
    });

    newRow['Otros'] = otherSum;
    newRow['__other__'] = otherSum;
    newRow['Other'] = otherSum;

    newRow['_relative'] = {};
    topTaxa.forEach((th) => {
      newRow['_relative'][th] = (parseFloat(row[th]) || 0) / total;
    });
    newRow['_relative']['Otros'] = otherSum / total;
    newRow['_relative']['__other__'] = otherSum / total;

    return newRow;
  });

  const groupedHeaders = [
    sampleKey,
    ...topTaxa,
    ...(hasOther ? ['Otros'] : [])
  ];

  // Configuración visual: series. "Otros" siempre al final de la pila con color gris neutro fijo #d3d3d3
  const series = topTaxa.map((h, i) => ({
    key: h,
    label: shortTaxonName(h),
    colorVar: CAT_VARS[i % CAT_VARS.length],
  }));

  if (hasOther) {
    const otherLabel = preAggOtherHeaders.length
      ? (t('barplots.othersNplus', { n: otherTaxa.length }) || 'Otros')
      : (otherTaxa.length ? (t('barplots.othersN', { n: otherTaxa.length }) || 'Otros') : (t('barplots.others') || 'Otros'));
    series.push({
      key: '__other__',
      label: otherLabel,
      colorVar: null,
      color: OTHER_COLOR,
      isOther: true,
    });
  }

  return {
    headers: groupedHeaders,
    rows: groupedRows,
    topTaxa,
    otherTaxa,
    preAggOtherHeaders,
    means,
    series,
    sampleKey,
    hasOther,
    minAbundance: minAbundFrac,
    topN: targetTopN,
    minPrev,
  };
}

function emptyState(container, title, desc) {
  container.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'ql-empty';
  box.innerHTML =
    '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>' +
    '<h3>' + title + '</h3><p>' + desc + '</p>';
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;';
  const goUpload = document.createElement('a');
  goUpload.href = '#/cargar';
  goUpload.className = 'ql-btn';
  goUpload.textContent = t('ui.goLoadData');
  btnRow.appendChild(goUpload);
  box.appendChild(btnRow);
  mountExampleButtons(box, {
    real: loadRealCommunityData,
    synthetic: loadExampleCommunityData,
    download: ['barplot', 'taxonomy', 'metadata'],
  });
  container.appendChild(box);
}

/**
 * Calcula el conjunto de taxones significativos/importantes para UN método
 * de biomarcadores, sin el resto del detalle (grupo enriquecido, δ, LDA...)
 * que sí construye renderBiomarkers() para la vista de un solo método.
 * Extraído para poder correr los 3 métodos a la vez en el panel de
 * consenso (renderBiomarkerConsensus) sin duplicar la lógica de
 * significancia de cada uno.
 * @param {'kw'|'ancombc'|'rf'} method
 * @param {{table:object, sampleKey:string, taxonHeaders:string[], rowSum:(row:object)=>number, resolveGroup:(sid:string)=>string|null, groups:string[], relByTaxon:object, qThresh:number}} ctx
 * @returns {{ sig:Set<string>, tested:number, error?:string, oobAccuracy?:number }}
 */
function computeSigSet(method, ctx) {
  const { table, sampleKey, taxonHeaders, rowSum, resolveGroup, groups, relByTaxon, qThresh } = ctx;
  if (method === 'rf') {
    const sampleRows = table.rows.filter((row) => resolveGroup(String(row[sampleKey]).trim()));
    const sampleGroupsArr = sampleRows.map((row) => resolveGroup(String(row[sampleKey]).trim()));
    const relMatrix = sampleRows.map((row) => {
      const total = rowSum(row) || 1;
      return taxonHeaders.map((h) => (parseFloat(row[h]) || 0) / total * 100);
    });
    let rfRes;
    try {
      rfRes = randomForest(relMatrix, sampleGroupsArr, { nTree: 300, seed: 42, shadows: true });
    } catch (e) {
      return { sig: new Set(), tested: 0, error: e.message };
    }
    const sig = new Set();
    taxonHeaders.forEach((h, i) => { if (rfRes.importance[i] > rfRes.shadowMax) sig.add(h); });
    return { sig, tested: taxonHeaders.length, oobAccuracy: rfRes.oobAccuracy };
  }

  let tested = [];
  if (method === 'ancombc') {
    const sampleRows = table.rows.filter((row) => resolveGroup(String(row[sampleKey]).trim()));
    const sampleGroupsArr = sampleRows.map((row) => resolveGroup(String(row[sampleKey]).trim()));
    const countMatrix = taxonHeaders.map((h) => sampleRows.map((row) => parseFloat(row[h]) || 0));
    const ancomRes = ancomBC(countMatrix, sampleGroupsArr, {}, studentTwoTailedP);
    taxonHeaders.forEach((h, i) => {
      const r = ancomRes[i];
      if (r && isFinite(r.p)) tested.push({ taxon: h, p: r.p });
    });
  } else {
    taxonHeaders.forEach((h) => {
      const perGroup = groups.map((g) => relByTaxon[h][g] || []);
      if (perGroup.some((arr) => arr.length === 0)) return;
      const kw = kruskalWallis(perGroup);
      if (isFinite(kw.p)) tested.push({ taxon: h, p: kw.p });
    });
  }
  const q = benjaminiHochberg(tested.map((x) => x.p));
  const sig = new Set();
  tested.forEach((x, i) => { if (q[i] < qThresh) sig.add(x.taxon); });
  return { sig, tested: tested.length };
}

export function render(container) {
  let level = null;
  let sortByGroup = true;
  let groupCol = null;
  let topN = TOP_N_DEFAULT;
  let minAbundance = MIN_ABUND_DEFAULT;
  let minPrev = 0;             // prevalencia mínima (% de muestras con el taxón presente)
  let orientation = 'vertical'; // 'vertical' | 'horizontal' (barras apiladas)
  let plotStyle = 'stacked';   // 'stacked' | 'bubbles' — solo aplica dentro de view === 'barplot'
  let view = 'barplot';        // 'barplot' | 'alluvial' | 'sunburst' | 'biomarkers'
  let sbFocusPath = [];        // ruta (nombres) del nodo centrado en el sunburst — [] = raíz (sin zoom)
  let sbMaxRings = 4;          // anillos visibles a la vez desde el foco (rendimiento con datasets grandes)
  let qThresh = 0.05;          // umbral q (BH) de la vista de biomarcadores
  let bmMethod = 'kw';         // 'kw' (Kruskal-Wallis, de siempre) | 'ancombc' (composicional) | 'rf' (Random Forest) — decide de dónde sale la significancia (p/q, o el umbral de las variables sombra en 'rf')
  let bmScore = 'cliffs';      // 'cliffs' | 'lda' | 'ancom' — qué score manda en el gráfico y el orden por defecto
  let bmSort = { key: 'delta', dir: 'desc' };
  let bmView = 'single';       // 'single' (un método, el de siempre) | 'consensus' (panel taxón × método)
  let bmConsSort = { key: 'count', dir: 'desc' };
  let editor = null;
  let wasEditing = false; // ver cfg.startEditing en chartEditor.js — capturado al principio de
                           // paint()/renderBiomarkers/renderBiomarkerConsensus antes de destruir
                           // el editor anterior, para no cerrar el panel "Personalizar" en cada
                           // repintado disparado desde dentro del propio editor
  // Geometría del aluvial: persistida vía attachChartEditor (cfg.geometrySliders,
  // key ALLUVIAL_CE_KEY) desde el 22 sep 2026 — antes vivía solo en memoria en el
  // modal openChartEditor (ya retirado, ver nota de arquitectura en chartEditor.js),
  // así que se perdía al salir de la vista. Se siembra aquí con lo último guardado.
  const savedAlluvialGeom = getFigureGeometry(ALLUVIAL_CE_KEY);
  let alluvialNodeWidth = savedAlluvialGeom.nodeWidth ?? 20;
  let alluvialNodeGap = savedAlluvialGeom.nodeGap ?? 2;
  let alluvialLinkOpacity = savedAlluvialGeom.linkOpacity ?? 0.4;
  // chartFontFamily/Is Bold/IsItalic/FontSize, seriesColorOverrides y
  // customChartTitle/X/YTitle: quedaron sin escritor tras retirar el modal
  // openChartEditor del aluvial (22 sep 2026) — se leen más abajo pero ya
  // nunca cambian de su valor por defecto. El control de fuente global de la
  // figura vuelve con el motor de variables CSS --fig-* (Fase 0, Paso 2);
  // el de título/color por serie ya lo cubre el attachChartEditor estándar
  // de esta misma vista (Títulos de la figura / Paleta). No se borran estas
  // variables en este commit para no tocar cada punto de lectura de golpe.
  let chartFontFamily = 'var(--font-body)';
  let chartIsBold = false;
  let chartIsItalic = false;
  let chartFontSize = 13;
  let seriesColorOverrides = {};

  function paint() {
    wasEditing = editor && editor.isEditing ? editor.isEditing() : false;
    if (editor) { editor.destroy(); editor = null; }
    container.innerHTML = '';
    const header = document.createElement('header');
    header.className = 'ql-page-header';
    header.innerHTML =
      '<p class="ql-eyebrow">' + t('barplots.eyebrow') + '</p>' +
      '<h1 class="ql-page-title">' + t('barplots.title') + '</h1>' +
      '<p class="ql-page-sub">' + t('barplots.subtitle', { n: topN }) + '</p>';
    container.appendChild(header);

    if (!state.taxaBarplot) {
      const card = document.createElement('div');
      card.className = 'ql-card ql-panel';
      emptyState(card, t('barplots.emptyTitle'), t('barplots.emptyDesc'));
      container.appendChild(card);
      return;
    }

    // pestañas: Barplot (Barras clásicas) | Flujos (Aluvial) | Biomarcadores
    const tabs = document.createElement('div');
    tabs.className = 'ql-tabs';
    [['barplot', t('barplots.tabBarplot')], ['alluvial', t('barplots.tabAlluvial')], ['sunburst', t('barplots.tabSunburst')], ['biomarkers', t('barplots.tabBiomarkers')]].forEach(([v, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-tab' + (view === v ? ' is-active' : '');
      b.textContent = label;
      b.addEventListener('click', () => { if (view !== v) { view = v; paint(); } });
      tabs.appendChild(b);
    });
    container.appendChild(tabs);

    const levels = Object.keys(state.taxaBarplot.levels).sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(b));
    if (level === null || !levels.includes(String(level))) level = levels[levels.length - 1];
    const table = state.taxaBarplot.levels[level];

    // detectar columna de grupo en metadatos, si hay
    let groupOptions = [];
    if (state.metadata) {
      groupOptions = state.metadata.headers.filter((h) => h !== state.metadata.sampleIdKey);
      if (!groupCol && groupOptions.length > 0) groupCol = groupOptions[0];
    }

    if (view === 'sunburst') { renderSunburstView(table, levels); return; }
    if (view === 'biomarkers') { renderBiomarkers(table, levels, groupOptions); return; }

    const grid = document.createElement('div');
    grid.className = 'ql-grid-2';

    // ---- panel principal: gráfico ----
    const chartPanel = document.createElement('section');
    chartPanel.className = 'ql-card ql-panel';

    const chartHeader = document.createElement('div');
    chartHeader.className = 'ql-chart-header';
    const noteP = document.createElement('p');
    noteP.className = 'ql-panel-note';
    noteP.style.margin = '0';
    noteP.textContent = (view === 'alluvial' ? t('barplots.alluvialNote') :
      (view === 'barplot' && plotStyle === 'bubbles') ? t('barplots.bubbleNote') : t('barplots.chartNote'));
    chartHeader.appendChild(noteP);

    // Antes había aquí un botón "⚙ Ajustes" propio del aluvial que abría el
    // modal openChartEditor (geometría/tipografía/colores). Retirado el 22
    // sep 2026: el aluvial usa ahora el mismo botón "Personalizar" del
    // attachChartEditor estándar de esta vista (más abajo), con una sección
    // "Geometría" nueva — ver nota de arquitectura en chartEditor.js.
    chartPanel.appendChild(chartHeader);

    const chartWrap = document.createElement('div');
    chartWrap.className = 'ql-chartwrap scroll-x';
    const svg = svgEl('svg', { class: 'ql-svg', role: 'img', 'aria-label': view === 'alluvial' ? t('barplots.alluvialFigTitle') : t('a11y.chartBarplot') });
    const tooltip = document.createElement('div');
    tooltip.className = 'ql-tooltip';
    chartWrap.appendChild(svg);
    chartWrap.appendChild(tooltip);
    chartPanel.appendChild(chartWrap);

    grid.appendChild(chartPanel);

    // ---- panel lateral: controles ----
    const controls = document.createElement('aside');
    controls.className = 'ql-card ql-panel';
    controls.innerHTML = '<h2>' + t('ui.controls') + '</h2>';

    // El cambio Barplot/Aluvial ya vive en las pestañas de arriba (junto a
    // Sunburst/Biomarcadores) — antes había AQUÍ un segundo selector
    // duplicado (solo Barras/Aluvial) que hacía exactamente lo mismo con
    // otro control, en otro sitio de la página. Quitado, no fusionado con
    // las pestañas de arriba, para no tener el mismo interruptor en dos
    // sitios a la vez.
    const levelField = document.createElement('div');
    levelField.className = 'ql-field';
    levelField.innerHTML = '<label>' + t('barplots.levelLabel') + '</label>';
    const levelSelect = document.createElement('select');
    levels.forEach((lv) => {
      const opt = document.createElement('option');
      opt.value = lv;
      opt.textContent = t('barplots.level', { n: lv }) + (Number(lv) === 6 ? t('barplots.levelGenus') : Number(lv) === 2 ? t('barplots.levelPhylum') : '');
      if (String(level) === lv) opt.selected = true;
      levelSelect.appendChild(opt);
    });
    levelField.appendChild(levelSelect);
    controls.appendChild(levelField);

    const topField = document.createElement('div');
    topField.className = 'ql-field';
    topField.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
      '<label for="qlTopNr" style="margin:0;">' + t('barplots.topNLabel') + '</label>' +
      '<span id="qlTopNVal" class="ql-badge">' + topN + '</span>' +
      '</div>' +
      '<div class="ql-inputrow">' +
      '<input type="range" id="qlTopNr" min="' + TOP_N_MIN + '" max="' + TOP_N_MAX + '" step="1" value="' + topN + '" style="flex:1;" />' +
      '<input type="number" id="qlTopN" class="ql-num-small tabular" min="' + TOP_N_MIN + '" max="' + TOP_N_MAX + '" step="1" value="' + topN + '" /></div>' +
      '<p class="ql-field-help">' + t('barplots.topNHelp') + '</p>';
    controls.appendChild(topField);

    const minAbundField = document.createElement('div');
    minAbundField.className = 'ql-field';
    minAbundField.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
      '<label for="qlMinAbundR" style="margin:0;">' + t('barplots.minAbundLabel') + '</label>' +
      '<span id="qlMinAbundVal" class="ql-badge">' + minAbundance + '%</span>' +
      '</div>' +
      '<div class="ql-inputrow">' +
      '<input type="range" id="qlMinAbundR" min="' + MIN_ABUND_MIN + '" max="' + MIN_ABUND_MAX + '" step="0.5" value="' + minAbundance + '" style="flex:1;" />' +
      '<input type="number" id="qlMinAbund" class="ql-num-small tabular" min="' + MIN_ABUND_MIN + '" max="' + MIN_ABUND_MAX + '" step="0.5" value="' + minAbundance + '" /></div>' +
      '<p class="ql-field-help">' + t('barplots.minAbundHelp') + '</p>';
    controls.appendChild(minAbundField);

    const prevField = document.createElement('div');
    prevField.className = 'ql-field';
    prevField.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
      '<label for="qlPrevR" style="margin:0;">' + t('barplots.prevLabel') + '</label>' +
      '<span id="qlPrevVal" class="ql-badge">' + minPrev + '%</span>' +
      '</div>' +
      '<div class="ql-inputrow">' +
      '<input type="range" id="qlPrevR" min="0" max="100" step="5" value="' + minPrev + '" style="flex:1;" />' +
      '<input type="number" id="qlPrev" class="ql-num-small tabular" min="0" max="100" step="5" value="' + minPrev + '" /></div>' +
      '<p class="ql-field-help">' + t('barplots.prevHelp') + '</p>';
    controls.appendChild(prevField);

    if (view === 'barplot') {
      controls.appendChild(chartTypeField({
        labelKey: 'barplots.plotStyleLabel',
        options: [
          { value: 'stacked', labelKey: 'barplots.plotStyleStacked' },
          { value: 'bubbles', labelKey: 'barplots.plotStyleBubbles' },
        ],
        active: plotStyle,
        onChange: (v) => { plotStyle = v; paint(); },
        helpKey: 'barplots.plotStyleHelp',
      }));

      if (plotStyle === 'stacked') {
        const orientField = document.createElement('div');
        orientField.className = 'ql-field';
        orientField.innerHTML = '<label>' + t('barplots.orientLabel') + '</label>';
        const orientSeg = document.createElement('div');
        orientSeg.className = 'ql-segmented';
        [['vertical', t('barplots.orientVertical')], ['horizontal', t('barplots.orientHorizontal')]].forEach(([v, lbl]) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'ql-seg-btn' + (orientation === v ? ' is-on' : '');
          b.textContent = lbl;
          b.addEventListener('click', () => { if (orientation !== v) { orientation = v; paint(); } });
          orientSeg.appendChild(b);
        });
        orientField.appendChild(orientSeg);
        orientField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('barplots.orientHelp') + '</p>');
        controls.appendChild(orientField);
      }
    }

    if (groupOptions.length > 0) {
      const groupField = document.createElement('div');
      groupField.className = 'ql-field';
      groupField.innerHTML = '<label>' + t('barplots.groupLabel') + '</label>';
      const groupSelect = document.createElement('select');
      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = t('barplots.groupNone');
      groupSelect.appendChild(noneOpt);
      groupOptions.forEach((g) => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        if (sortByGroup && groupCol === g) opt.selected = true;
        groupSelect.appendChild(opt);
      });
      if (!sortByGroup) noneOpt.selected = true;
      groupField.appendChild(groupSelect);
      controls.appendChild(groupField);
      groupSelect.addEventListener('change', () => {
        sortByGroup = groupSelect.value !== '';
        groupCol = groupSelect.value || groupCol;
        paint();
      });
    } else {
      const note = document.createElement('p');
      note.className = 'ql-field-help';
      note.textContent = t('barplots.groupHint');
      controls.appendChild(note);
    }

    const privacy = document.createElement('p');
    privacy.className = 'ql-privacy';
    privacy.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5l-8-3Z"/></svg>' + t('barplots.localCalc');
    controls.appendChild(privacy);

    grid.appendChild(controls);
    container.appendChild(grid);

    // ---- tabla ----
    const tableCard = document.createElement('section');
    tableCard.className = 'ql-card ql-panel';
    tableCard.style.marginTop = '20px';
    container.appendChild(tableCard);

    levelSelect.addEventListener('change', () => { level = levelSelect.value; paint(); });

    let rafId = null;
    function scheduleRender() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        renderChartAndTable();
      });
    }

    {
      const nInput = topField.querySelector('#qlTopN');
      const rInput = topField.querySelector('#qlTopNr');
      const valBadge = topField.querySelector('#qlTopNVal');
      const sync = (v, full) => {
        const nv = Math.max(TOP_N_MIN, Math.min(TOP_N_MAX, parseInt(v, 10) || TOP_N_DEFAULT));
        topN = nv;
        nInput.value = nv;
        rInput.value = nv;
        if (valBadge) valBadge.textContent = nv;
        if (full) {
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
          renderChartAndTable();
        } else {
          scheduleRender();
        }
      };
      rInput.addEventListener('input', () => sync(rInput.value, false));
      rInput.addEventListener('change', () => sync(rInput.value, true));
      nInput.addEventListener('input', () => sync(nInput.value, false));
      nInput.addEventListener('change', () => sync(nInput.value, true));
    }

    {
      const nInput = minAbundField.querySelector('#qlMinAbund');
      const rInput = minAbundField.querySelector('#qlMinAbundR');
      const valBadge = minAbundField.querySelector('#qlMinAbundVal');
      const sync = (v, full) => {
        const nv = Math.max(MIN_ABUND_MIN, Math.min(MIN_ABUND_MAX, parseFloat(v) || 0));
        minAbundance = nv;
        nInput.value = nv;
        rInput.value = nv;
        if (valBadge) valBadge.textContent = nv + '%';
        if (full) {
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
          renderChartAndTable();
        } else {
          scheduleRender();
        }
      };
      rInput.addEventListener('input', () => sync(rInput.value, false));
      rInput.addEventListener('change', () => sync(rInput.value, true));
      nInput.addEventListener('input', () => sync(nInput.value, false));
      nInput.addEventListener('change', () => sync(nInput.value, true));
    }

    {
      const nInput = prevField.querySelector('#qlPrev');
      const rInput = prevField.querySelector('#qlPrevR');
      const valBadge = prevField.querySelector('#qlPrevVal');
      const sync = (v, full) => {
        const nv = Math.max(0, Math.min(100, parseInt(v, 10) || 0));
        minPrev = nv;
        nInput.value = nv;
        rInput.value = nv;
        if (valBadge) valBadge.textContent = nv + '%';
        if (full) {
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
          renderChartAndTable();
        } else {
          scheduleRender();
        }
      };
      rInput.addEventListener('input', () => sync(rInput.value, false));
      rInput.addEventListener('change', () => sync(rInput.value, true));
      nInput.addEventListener('input', () => sync(nInput.value, false));
      nInput.addEventListener('change', () => sync(nInput.value, true));
    }

    function renderChartAndTable() {
      if (editor) { editor.destroy(); editor = null; }
      // Paso 2/G4: orden de taxones leído SIEMPRE de la clave 'taxaBarplot'
      // (la vista vertical apilada, por defecto) con independencia de qué
      // variante esté activa ahora mismo (burbujas/horizontal) — esas 2 no
      // tienen su propia sección "Estructura" todavía (evita guardar la
      // preferencia en 2-3 sitios inconsistentes a la vez).
      // Ahora cada vista (vertical, horizontal, burbujas) tiene su propia
      // sección Estructura y lee el orden de SU clave — el panel siempre
      // muestra lo que de verdad se aplica en esa vista.
      const barplotStructOpts = getFigureOptions(plotStyle === 'bubbles' ? 'taxaBarplot-bubbles' : (orientation === 'horizontal' ? 'taxaBarplot-horizontal' : 'taxaBarplot'));
      const grouped = groupTaxaByAbundance(table, minAbundance, topN, { minPrev, isPercentage: true, categoryOrder: barplotStructOpts.categoryOrder });
      const { topTaxa, otherTaxa, preAggOtherHeaders, series, means, hasOther } = grouped;
      const colorsRepeat = topTaxa.length > CAT_VARS.length;

      const pageSub = header.querySelector('.ql-page-sub');
      if (pageSub) {
        pageSub.textContent = t('barplots.subtitle', { n: topTaxa.length });
      }

      tableCard.innerHTML = '<h2>' + (view === 'alluvial' ? t('barplots.tableAlluvialTitle') : t('barplots.tableTitle')) + '</h2>';
      if (minPrev > 0) {
        const eligible = means.filter((m) => m.prev * 100 >= minPrev);
        const belowPrev = means.length - eligible.length;
        tableCard.insertAdjacentHTML('beforeend',
          '<p class="ql-field-help" style="margin-top:0">' +
          t('barplots.prevApplied', { pct: minPrev, n: belowPrev, total: means.length }) + '</p>');
      }

      const sampleKey = table.headers[0];
      const OTHER_COL_RE = /^(others?|otros?|resto)$/i;
      const taxonHeaders = table.headers.filter((h, i) => i !== 0 && !OTHER_COL_RE.test(String(h).trim()));

      const rowSum = (row) =>
        taxonHeaders.reduce((a, h) => a + (parseFloat(row[h]) || 0), 0) +
        preAggOtherHeaders.reduce((a, h) => a + (parseFloat(row[h]) || 0), 0);
      const otherRaw = (row) =>
        otherTaxa.reduce((a, h) => a + (parseFloat(row[h]) || 0), 0) +
        preAggOtherHeaders.reduce((a, h) => a + (parseFloat(row[h]) || 0), 0);

      let sampleOrder = table.rows.map((r) => r[sampleKey]);
      let groupBySample = {};
      if (state.metadata && groupCol) {
        const metaByKey = {};
        state.metadata.rows.forEach((r) => { metaByKey[r[state.metadata.sampleIdKey]] = r[groupCol]; });
        groupBySample = metaByKey;
        if (sortByGroup) {
          sampleOrder = sampleOrder.slice().sort((a, b) => {
            const ga = metaByKey[a] || '', gb = metaByKey[b] || '';
            return ga === gb ? String(a).localeCompare(String(b)) : String(ga).localeCompare(String(gb));
          });
        }
      }

      const rowsBySample = {};
      table.rows.forEach((r) => { rowsBySample[r[sampleKey]] = r; });

    if (view === 'alluvial') {
      const resolveGroup = (sortByGroup && groupCol && state.metadata)
        ? (sampleId) => groupBySample[sampleId]
        : null;

      const groupMatrixData = computeGroupTaxaMatrix(
        table.rows,
        sampleKey,
        taxonHeaders,
        resolveGroup,
        { preAggOtherHeaders, otherTaxa }
      );

      if (groupMatrixData.groups.length < 2) {
        const msg = document.createElement('p');
        msg.className = 'ql-field-help';
        msg.style.padding = '36px 16px';
        msg.style.textAlign = 'center';
        msg.textContent = t('barplots.alluvialNeedGroups');
        chartWrap.appendChild(msg);
        return;
      }

      let W = 680;
      let H = 450;
      let customChartTitle = null;
      let customXTitle = null;
      let customYTitle = null;

      function drawAlluvialSvg() {
        const legCols = series.length > 13 ? 3 : series.length > 6 ? 2 : 1;
        const legRows = Math.ceil(series.length / legCols);
        const colorsRepeat = topTaxa.length > CAT_VARS.length;

        const marginL = 56, marginR = 36, marginT = 44;
        const usableH = 340;
        const numG = groupMatrixData.groups.length;
        const colStep = Math.max(120, Math.min(240, 800 / Math.max(numG - 1, 1)));
        W = Math.max(680, marginL + marginR + (numG - 1) * colStep + 30);
        const axisGap = 54;
        const marginB = axisGap + 16 + legRows * 15 + (colorsRepeat ? 20 : 4);
        H = marginT + usableH + marginB;

        const layout = computeAlluvialLayout(
          {
            // orden de las columnas (Ajustes > Estructura); 'original' = el de siempre
            groups: orderCategories(groupMatrixData.groups, null, getFigureOptions(ALLUVIAL_CE_KEY).categoryOrder),
            taxa: series,
            matrix: groupMatrixData.matrix,
            sampleCounts: groupMatrixData.sampleCounts,
          },
          {
            width: W,
            height: marginT + usableH + 30,
            margin: { top: marginT, right: marginR, bottom: 30, left: marginL },
            nodeWidth: alluvialNodeWidth,
            nodeGap: alluvialNodeGap,
          }
        );

        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        svg.style.width = W + 'px';
        svg.style.maxWidth = 'none';
        svg.style.fontFamily = chartFontFamily;
        if (chartIsBold) svg.style.fontWeight = 'bold';
        else svg.style.removeProperty('font-weight');
        if (chartIsItalic) svg.style.fontStyle = 'italic';
        else svg.style.removeProperty('font-style');
        if (chartFontSize) svg.style.fontSize = chartFontSize + 'px';
        else svg.style.removeProperty('font-size');

        const existingTitle = svg.querySelector('.ce-title');
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        // Líneas de referencia del eje Y (0%, 25%, 50%, 75%, 100%)
        [0, 0.25, 0.5, 0.75, 1].forEach((frac) => {
          const y = marginT + usableH - frac * usableH;
          svg.appendChild(svgEl('line', { x1: marginL, x2: W - marginR, y1: y, y2: y, class: 'ql-gridline' }));
          const tk = svgEl('text', { x: marginL - 8, y: y + 3, class: 'ql-tick-label', 'text-anchor': 'end' });
          tk.textContent = Math.round(frac * 100) + '%';
          svg.appendChild(tk);
        });
        svg.appendChild(svgEl('line', { x1: marginL, x2: marginL, y1: marginT, y2: marginT + usableH, class: 'ql-baseline-line' }));

        // Título eje Y
        const yTitle = svgEl('text', {
          x: 15, y: marginT + usableH / 2, class: 'ql-axis-label ql-chart-y-title', 'text-anchor': 'middle',
          transform: 'rotate(-90 15 ' + (marginT + usableH / 2) + ')', 'data-ce': 'ytitle',
        });
        yTitle.textContent = customYTitle !== null ? customYTitle : t('barplots.axisPct');
        svg.appendChild(yTitle);

        // Resaltado interactivo de linaje (hover: 100% activo, 10% el resto)
        const highlightTaxon = (taxonKey) => {
          svg.classList.add('is-highlighting');
          svg.querySelectorAll('[data-taxon-key]').forEach((el) => {
            el.classList.toggle('is-highlighted', el.getAttribute('data-taxon-key') === taxonKey);
          });
        };

        const clearHighlight = () => {
          svg.classList.remove('is-highlighting');
          svg.querySelectorAll('.is-highlighted').forEach((el) => el.classList.remove('is-highlighted'));
          tooltip.classList.remove('is-show');
        };

        // Enlaces (flujos aluviales Bézier)
        const linksG = svgEl('g', { class: 'ql-alluvial-links' });
        layout.links.forEach((link) => {
          const fillCol = (link.taxonKey === '__other__') ? OTHER_COLOR : (seriesColorOverrides[link.taxonKey] || (link.colorVar ? 'var(' + link.colorVar + ')' : '#2a78d6'));
          const path = svgEl('path', {
            d: link.d,
            class: 'ql-alluvial-link',
            fill: fillCol,
            style: 'fill-opacity: ' + alluvialLinkOpacity + ';',
            'data-taxon-key': link.taxonKey,
            ...(link.taxonKey === '__other__' ? {} : { 'data-ce-series-fill': 's' + CAT_VARS.indexOf(link.colorVar) }),
          });
          path.addEventListener('mouseenter', () => {
            highlightTaxon(link.taxonKey);
            const midY = (link.y0 + link.h0 / 2 + link.y1 + link.h1 / 2) / 2;
            const detail = '<strong>' + escapeHtml(link.taxonLabel) + '</strong><br>' +
              escapeHtml(link.sourceGroup) + ': ' + (link.sourceFraction * 100).toFixed(1) + '% &rarr; ' +
              escapeHtml(link.targetGroup) + ': ' + (link.targetFraction * 100).toFixed(1) + '%';
            showAlluvialTooltip(link.taxonLabel, detail, link.cx, midY, chartWrap, svg, W, H, tooltip);
          });
          path.addEventListener('mouseleave', clearHighlight);
          linksG.appendChild(path);
        });
        svg.appendChild(linksG);

        // Nodos (bloques apilados en cada columna)
        const nodesG = svgEl('g', { class: 'ql-alluvial-nodes' });
        layout.nodes.forEach((node) => {
          if (node.height <= 0) return;
          const fillCol = (node.taxonKey === '__other__') ? OTHER_COLOR : (seriesColorOverrides[node.taxonKey] || (node.colorVar ? 'var(' + node.colorVar + ')' : '#2a78d6'));
          const rect = svgEl('rect', {
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            rx: 2,
            class: 'ql-alluvial-node',
            fill: fillCol,
            'data-taxon-key': node.taxonKey,
            ...(node.taxonKey === '__other__' ? {} : { 'data-ce-series-fill': 's' + CAT_VARS.indexOf(node.colorVar) }),
          });
          rect.addEventListener('mouseenter', () => {
            highlightTaxon(node.taxonKey);
            const detail = '<strong>' + escapeHtml(node.taxonLabel) + '</strong><br>' +
              escapeHtml(node.group) + ': ' + (node.fraction * 100).toFixed(1) + '%';
            showAlluvialTooltip(node.taxonLabel, detail, node.x + node.width / 2, node.y, chartWrap, svg, W, H, tooltip);
          });
          rect.addEventListener('mouseleave', clearHighlight);
          nodesG.appendChild(rect);
        });
        svg.appendChild(nodesG);

        // Etiquetas de columnas (grupos) y tamaño muestral (n)
        layout.columns.forEach((col) => {
          const cx = col.x + col.width / 2;
          const gt = svgEl('text', {
            x: cx,
            y: marginT + usableH + 18,
            class: 'ql-tick-label',
            'text-anchor': 'middle',
            'font-weight': '600',
          });
          gt.textContent = col.group;
          svg.appendChild(gt);

          if (col.sampleCount > 0) {
            const nt = svgEl('text', {
              x: cx,
              y: marginT + usableH + 32,
              class: 'ql-tick-label',
              'text-anchor': 'middle',
              fill: 'var(--ink-muted)',
            });
            nt.textContent = 'n = ' + col.sampleCount;
            svg.appendChild(nt);
          }
        });

        // Título eje X
        const xLabelBase = marginT + usableH + 48;
        const xTitle = svgEl('text', {
          x: marginL + (W - marginL - marginR) / 2,
          y: xLabelBase,
          class: 'ql-axis-label ql-chart-x-title',
          'text-anchor': 'middle',
          'data-ce': 'xtitle',
        });
        xTitle.textContent = customXTitle !== null ? customXTitle : ((sortByGroup && groupCol) ? t('barplots.axisSamplesBy', { col: groupCol }) : t('barplots.alluvialAxisGroups'));
        svg.appendChild(xTitle);

        if (customChartTitle !== null) {
          const mainTitle = svg.querySelector('.ql-chart-main-title, .ce-title, [data-ce="title"]');
          if (mainTitle) mainTitle.textContent = customChartTitle;
        }

        // Leyenda integrada en SVG
        const legTranslateX = marginL;
        const legTranslateY = xLabelBase + 18;
        const legG = svgEl('g', { 'data-ce': 'legend' });
        const colW = Math.min(260, Math.max(150, (W - legTranslateX - 12) / legCols));
        series.forEach((s, i) => {
          const col = Math.floor(i / legRows), rw = i % legRows;
          const xx = col * colW, yy = rw * 15;
          const itemG = svgEl('g', { class: 'ql-alluvial-leg-item', style: 'cursor:pointer;', 'data-taxon-key': s.key });
          const fillCol = (s.key === '__other__') ? OTHER_COLOR : (seriesColorOverrides[s.key] || (s.colorVar ? 'var(' + s.colorVar + ')' : '#2a78d6'));
          itemG.appendChild(svgEl('rect', {
            x: xx, y: yy - 8, width: 10, height: 10, rx: 2, fill: fillCol,
            ...(s.key === '__other__' ? {} : { 'data-ce-series-fill': 's' + CAT_VARS.indexOf(s.colorVar) }),
          }));
          const lt = svgEl('text', { x: xx + 15, y: yy, class: 'ql-tick-label' });
          lt.textContent = s.label;
          itemG.appendChild(lt);
          itemG.addEventListener('mouseenter', () => highlightTaxon(s.key));
          itemG.addEventListener('mouseleave', clearHighlight);
          legG.appendChild(itemG);
        });
        if (colorsRepeat) {
          const nt = svgEl('text', { x: 0, y: legRows * 15 + 4, class: 'ql-tick-label' });
          nt.setAttribute('fill', 'var(--ink-muted)');
          nt.textContent = t('barplots.colorsRepeat');
          legG.appendChild(nt);
        }
        legG.setAttribute('transform', 'translate(' + legTranslateX + ', ' + legTranslateY + ')');
        svg.appendChild(legG);

        if (existingTitle) {
          svg.appendChild(existingTitle);
        }

        // Si el editor ya existía, sincronizar cambios en caliente
        if (editor && editor.sync) {
          editor.sync();
        }
      }

      drawAlluvialSvg();

      // Editor de gráfico — mismo attachChartEditor estándar que el resto de
      // vistas (título/ejes/leyenda arrastrables, paleta por serie), más una
      // sección "Geometría" para lo que aquí sí necesita recalcular el layout
      // del flujo (ancho de nodo, separación, opacidad). Antes esto último
      // vivía en un modal aparte (openChartEditor, retirado 22 sep 2026 — ver
      // nota de arquitectura en chartEditor.js); unificarlo aquí también lo
      // hace persistente entre sesiones, cosa que el modal no hacía.
      if (editor) editor.destroy();
      editor = attachChartEditor({
        key: ALLUVIAL_CE_KEY, svg, mount: chartPanel, filename: t('barplots.alluvialFigTitle'), lang: getLang(),
        elements: [
          { id: 'title', create: { text: t('barplots.alluvialFigTitle'), x: W / 2, y: 24, anchor: 'middle', cls: 'ce-title ql-chart-main-title' } },
          { id: 'xtitle', selector: '[data-ce="xtitle"]' },
          { id: 'ytitle', selector: '[data-ce="ytitle"]' },
          { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
        ],
        paletteSeries: CAT_VARS.map((cv, i) => ({
          id: 's' + i,
          label: (series.find((s) => s.colorVar === cv) || {}).label || t('barplots.paletteSlotN', { n: i + 1 }),
        })),
        paletteType: 'categorical',
        geometrySliders: [
          { id: 'nodeWidth', label: t('chartEditor.nodeWidth') || 'Ancho de los nodos/barras', min: 6, max: 60, step: 2, value: alluvialNodeWidth, unit: 'px' },
          { id: 'nodeGap', label: t('chartEditor.nodeGap') || 'Separación entre nodos', min: 0, max: 15, step: 1, value: alluvialNodeGap, unit: 'px' },
          { id: 'linkOpacity', label: t('chartEditor.linkOpacity') || 'Opacidad de los flujos', min: 0.1, max: 0.95, step: 0.05, value: alluvialLinkOpacity, isPercent: true },
        ],
        figureOptions: { categoryOrder: ['original', 'alpha-asc', 'alpha-desc'] },
        onFigureOptionsChange: () => paint(),
        onGeometryChange: (id, val) => {
          if (id === 'nodeWidth') alluvialNodeWidth = Number(val);
          else if (id === 'nodeGap') alluvialNodeGap = Number(val);
          else if (id === 'linkOpacity') alluvialLinkOpacity = Number(val);
          drawAlluvialSvg();
        },
        onReset: () => {
          alluvialNodeWidth = 20;
          alluvialNodeGap = 2;
          alluvialLinkOpacity = 0.4;
          paint();
        },
        startEditing: wasEditing,
      });

      // Tabla de abundancia relativa media por grupo
      const scrollDiv = document.createElement('div');
      scrollDiv.className = 'ql-table-scroll scroll-x';
      const tbl = document.createElement('table');
      tbl.className = 'ql-table';
      const thead = document.createElement('thead');
      const groupColLabel = (sortByGroup && groupCol) ? groupCol : t('barplots.axisSamples');
      thead.innerHTML = '<tr><th><button type="button">' + escapeHtml(groupColLabel) + '</button></th>' +
        '<th><button type="button">' + t('barplots.colSamplesCount') + '</button></th>' +
        series.map((s) => '<th><button type="button">' + escapeHtml(s.label) + '</button></th>').join('') + '</tr>';
      tbl.appendChild(thead);
      const tbody = document.createElement('tbody');
      groupMatrixData.groups.forEach((g) => {
        const gVals = groupMatrixData.matrix[g] || {};
        const count = groupMatrixData.sampleCounts[g] || 0;
        const tr = document.createElement('tr');
        let cells = '<td><strong>' + escapeHtml(g) + '</strong></td>' +
          '<td class="ql-num tabular">' + count + '</td>';
        series.forEach((s) => {
          const val = gVals[s.key] || 0;
          cells += '<td class="ql-num tabular">' + (val * 100).toFixed(1) + '%</td>';
        });
        tr.innerHTML = cells;
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      scrollDiv.appendChild(tbl);
      tableCard.appendChild(scrollDiv);
    } else {
      // chart
      const legCols = series.length > 13 ? 3 : series.length > 6 ? 2 : 1;
      const legRows = Math.ceil(series.length / legCols);
      const horizontal = orientation === 'horizontal';
    const gap = 2; // separador entre segmentos apilados
    let W, H, xLabelBase, legTranslateX, legTranslateY;

    if (plotStyle === 'bubbles') {
      // fila por taxón (series), columna por muestra — tamaño del punto = abundancia relativa
      const maxLabelChars = series.reduce((m, s) => Math.max(m, String(s.label).length), 0);
      const rowLabelW = Math.min(220, maxLabelChars * 6.3);
      const marginL = 14 + rowLabelW + 10, marginR = 16, marginT = 46;
      const showEvery = sampleOrder.length > 24 ? Math.ceil(sampleOrder.length / 24) : 1;
      const maxSampleChars = sampleOrder.reduce((m, s, si) => (si % showEvery === 0 ? Math.max(m, String(s).length) : m), 0);
      const labelDrop = 14 + Math.min(104, Math.round(maxSampleChars * 6.4 * 0.82));
      const xTitleGap = labelDrop + 14;
      const marginB = xTitleGap + 20 + legRows * 15 + (colorsRepeat ? 20 : 4);
      const colW = Math.max(20, Math.min(46, 900 / Math.max(sampleOrder.length, 1)));
      const rowH = Math.max(20, Math.min(38, 420 / Math.max(series.length, 1)));
      const innerW = colW * sampleOrder.length;
      const innerH = rowH * series.length;
      W = Math.max(marginL + innerW + marginR, 420);
      H = marginT + innerH + marginB;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.style.width = W + 'px';
      svg.style.maxWidth = 'none';
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      // filas guía por taxón + su etiqueta a la izquierda
      series.forEach((s, si) => {
        const cy = marginT + si * rowH + rowH / 2;
        svg.appendChild(svgEl('line', { x1: marginL, x2: marginL + innerW, y1: cy, y2: cy, class: 'ql-gridline' }));
        const lbl = svgEl('text', { x: marginL - 8, y: cy + 4, class: 'ql-tick-label', 'text-anchor': 'end' });
        lbl.textContent = s.label;
        svg.appendChild(lbl);
      });
      svg.appendChild(svgEl('line', { x1: marginL, x2: marginL, y1: marginT, y2: marginT + innerH, class: 'ql-baseline-line' }));

      // radio máximo: que quepa en su celda sin tocar a los vecinos
      const maxR = Math.min(colW, rowH) * 0.42;
      let maxVal = 0;
      sampleOrder.forEach((sampleId) => {
        const row = rowsBySample[sampleId];
        if (!row) return;
        const total = rowSum(row) || 1;
        series.forEach((s) => {
          const val = (s.key === '__other__' ? otherRaw(row) : (parseFloat(row[s.key]) || 0)) / total;
          if (val > maxVal) maxVal = val;
        });
      });
      if (maxVal <= 0) maxVal = 1;

      sampleOrder.forEach((sampleId, si) => {
        const row = rowsBySample[sampleId];
        if (!row) return;
        const cx = marginL + si * colW + colW / 2;
        const total = rowSum(row) || 1;
        series.forEach((s, gi) => {
          const val = (s.key === '__other__' ? otherRaw(row) : (parseFloat(row[s.key]) || 0)) / total;
          if (val <= 0) return;
          const cy = marginT + gi * rowH + rowH / 2;
          const r = Math.max(2, maxR * Math.sqrt(val / maxVal));
          const fillCol = (s.key === '__other__') ? OTHER_COLOR : (seriesColorOverrides[s.key] || (s.colorVar ? 'var(' + s.colorVar + ')' : '#2a78d6'));
          const circle = svgEl('circle', {
            cx, cy, r, fill: fillCol, 'fill-opacity': 0.78, stroke: 'var(--surface)', 'stroke-width': 1, 'data-ce-role': 'marker',
            'data-sample': sampleId,
            'data-tax': s.label,
            'data-val': val,
            'data-cx': cx,
            'data-cy': cy,
            ...(s.key === '__other__' ? {} : { 'data-ce-series-fill': 's' + CAT_VARS.indexOf(s.colorVar) }),
          });
          svg.appendChild(circle);
        });
      });

      // etiquetas eje X (rotadas), igual que en vertical
      sampleOrder.forEach((sampleId, si) => {
        if (si % showEvery !== 0) return;
        const cx = marginL + si * colW + colW / 2;
        const tx = svgEl('text', {
          x: cx, y: marginT + innerH + 16, class: 'ql-tick-label', 'text-anchor': 'end',
          transform: 'rotate(-55 ' + cx + ' ' + (marginT + innerH + 16) + ')',
        });
        tx.textContent = sampleId;
        svg.appendChild(tx);
      });

      xLabelBase = marginT + innerH + xTitleGap;
      const xTitle = svgEl('text', { x: marginL + innerW / 2, y: xLabelBase, class: 'ql-axis-label ql-chart-x-title', 'text-anchor': 'middle', 'data-ce': 'xtitle' });
      xTitle.textContent = groupCol ? t('barplots.axisSamplesBy', { col: groupCol }) : t('barplots.axisSamples');
      svg.appendChild(xTitle);
      const yTitleB = svgEl('text', {
        x: 14, y: marginT + innerH / 2, class: 'ql-axis-label ql-chart-y-title', 'text-anchor': 'middle',
        transform: 'rotate(-90 14 ' + (marginT + innerH / 2) + ')', 'data-ce': 'ytitle',
      });
      yTitleB.textContent = t('barplots.axisTaxa');
      svg.appendChild(yTitleB);

      // leyenda de tamaños: 3 círculos de referencia (estática, no editable).
      // Va pegada al margen izquierdo (no al derecho): con muchas muestras el
      // gráfico hace scroll horizontal y el borde derecho no está visible al
      // entrar a la vista, a diferencia de la leyenda de color de abajo.
      const refVals = [maxVal, maxVal * 0.35, maxVal * 0.1].filter((v, i, arr) => v > 0 && arr.indexOf(v) === i);
      const sizeLeg = svgEl('g');
      let refX = 0;
      refVals.forEach((v) => {
        const r = Math.max(2, maxR * Math.sqrt(v / maxVal));
        sizeLeg.appendChild(svgEl('circle', { cx: refX + maxR, cy: maxR, r, fill: 'none', stroke: 'var(--ink-muted)', 'stroke-width': 1.2 }));
        const lbl = svgEl('text', { x: refX + maxR, y: maxR * 2 + 13, class: 'ql-tick-label', 'text-anchor': 'middle' });
        lbl.textContent = (v * 100).toFixed(v * 100 < 1 ? 1 : 0) + '%';
        sizeLeg.appendChild(lbl);
        refX += maxR * 2 + 18;
      });
      sizeLeg.setAttribute('transform', 'translate(' + marginL + ',6)');
      svg.appendChild(sizeLeg);

      legTranslateX = marginL; legTranslateY = xLabelBase + 18;
    } else if (!horizontal) {
      const marginL = 56, marginR = 12, marginT = 42;
      // Las etiquetas de muestra van rotadas -55°: cuánto bajan depende de su
      // longitud. Reservamos hueco real para que el título del eje X no se
      // solape con ellas (bug de maquetado que se veía con IDs largos).
      const showEvery = sampleOrder.length > 24 ? Math.ceil(sampleOrder.length / 24) : 1;
      const maxLabelChars = sampleOrder.reduce((m, s, si) => (si % showEvery === 0 ? Math.max(m, String(s).length) : m), 0);
      const labelDrop = 14 + Math.min(104, Math.round(maxLabelChars * 6.4 * 0.82)); // 0.82 ≈ sin(55°)
      const xTitleGap = labelDrop + 14;
      const marginB = xTitleGap + 20 + legRows * 15 + (colorsRepeat ? 20 : 4);
      const slotW = Math.max(18, Math.min(46, 900 / Math.max(sampleOrder.length, 1)));
      const barW = Math.min(24, slotW * 0.7);
      const innerH = 380;
      W = Math.max(marginL + marginR + slotW * sampleOrder.length, 420);
      H = marginT + innerH + marginB;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.style.width = W + 'px'; // ancho real en px: si no caben todas las muestras, el contenedor hace scroll horizontal en vez de aplastar las barras
      svg.style.maxWidth = 'none';
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      // rango manual del eje de porcentaje (Ajustes > Estructura); 0-100 por defecto
      const vso = getFigureOptions('taxaBarplot');
      const fLo = (vso.axisMin != null ? vso.axisMin : 0) / 100, fHi = (vso.axisMax != null ? vso.axisMax : 100) / 100;
      const fSpan = (fHi - fLo) || 1;
      const yF = (f) => marginT + innerH - ((f - fLo) / fSpan) * innerH;
      const pctLabel = (p) => (Math.abs(p - Math.round(p)) < 0.05 ? String(Math.round(p)) : p.toFixed(1)) + '%';
      // gridlines y-axis (5 marcas entre el mínimo y el máximo del rango)
      [0, 0.25, 0.5, 0.75, 1].forEach((frac) => {
        const f = fLo + frac * fSpan;
        const y = yF(f);
        svg.appendChild(svgEl('line', { x1: marginL, x2: W - marginR, y1: y, y2: y, class: 'ql-gridline' }));
        const tk = svgEl('text', { x: marginL - 8, y: y + 3, class: 'ql-tick-label', 'text-anchor': 'end' });
        tk.textContent = pctLabel(f * 100);
        svg.appendChild(tk);
      });
      svg.appendChild(svgEl('line', { x1: marginL, x2: marginL, y1: marginT, y2: marginT + innerH, class: 'ql-baseline-line' }));

      const barsLayer = svgEl('g', { 'clip-path': plotClip(svg, 'ql-clip-barplot', marginL, marginT, W - marginL - marginR, innerH) });
      svg.appendChild(barsLayer);
      sampleOrder.forEach((sampleId, si) => {
        const row = rowsBySample[sampleId];
        if (!row) return;
        const cx = marginL + si * slotW + slotW / 2;
        const total = rowSum(row) || 1;
        let cumulative = 0;
        series.forEach((s) => {
          let val;
          if (s.key === '__other__') val = otherRaw(row) / total;
          else val = (parseFloat(row[s.key]) || 0) / total;
          if (val <= 0) return;
          const yTop = yF(cumulative + val);
          const yBot = yF(cumulative);
          const h = Math.max(0, yBot - yTop - gap);
          const fillCol = (s.key === '__other__') ? OTHER_COLOR : (seriesColorOverrides[s.key] || (s.colorVar ? 'var(' + s.colorVar + ')' : '#2a78d6'));
          const rect = svgEl('rect', {
            x: cx - barW / 2, y: yTop, width: barW, height: Math.max(h, 0), 'data-ce-role': 'bar',
            fill: fillCol,
            'data-sample': sampleId,
            'data-tax': s.label,
            'data-val': val,
            'data-cx': cx,
            'data-cy': yTop,
            ...(s.key === '__other__' ? {} : { 'data-ce-series-fill': 's' + CAT_VARS.indexOf(s.colorVar) }),
          });
          barsLayer.appendChild(rect);
          cumulative += val;
        });
      });

      // etiquetas eje X (rotadas si hay muchas muestras)
      sampleOrder.forEach((sampleId, si) => {
        if (si % showEvery !== 0) return;
        const cx = marginL + si * slotW + slotW / 2;
        const tx = svgEl('text', {
          x: cx, y: marginT + innerH + 16, class: 'ql-tick-label', 'text-anchor': 'end',
          transform: 'rotate(-55 ' + cx + ' ' + (marginT + innerH + 16) + ')',
        });
        tx.textContent = sampleId;
        svg.appendChild(tx);
      });

      xLabelBase = marginT + innerH + xTitleGap; // bajo las etiquetas de muestra rotadas
      const xTitle = svgEl('text', { x: marginL + (W - marginL - marginR) / 2, y: xLabelBase, class: 'ql-axis-label ql-chart-x-title', 'text-anchor': 'middle', 'data-ce': 'xtitle' });
      xTitle.textContent = groupCol ? t('barplots.axisSamplesBy', { col: groupCol }) : t('barplots.axisSamples');
      svg.appendChild(xTitle);

      const yTitle = svgEl('text', {
        x: 15, y: marginT + innerH / 2, class: 'ql-axis-label ql-chart-y-title', 'text-anchor': 'middle',
        transform: 'rotate(-90 15 ' + (marginT + innerH / 2) + ')', 'data-ce': 'ytitle',
      });
      yTitle.textContent = t('barplots.axisPct');
      svg.appendChild(yTitle);

      legTranslateX = marginL; legTranslateY = xLabelBase + 18;
    } else {
      // ---- orientación horizontal: una fila por muestra, sin rotar
      // etiquetas — pensada para muchas muestras con nombres largos, que en
      // vertical solo cabían rotadas -55°. ----
      const maxLabelChars = sampleOrder.reduce((m, s) => Math.max(m, String(s).length), 0);
      const labelW = Math.min(200, maxLabelChars * 6.3);
      const axisTitleGap = 26;
      const marginL = axisTitleGap + labelW + 14, marginR = 16, marginT = 42;
      const rowH = Math.max(16, Math.min(34, 480 / Math.max(sampleOrder.length, 1)));
      const barH = Math.min(22, rowH * 0.72);
      const innerW = 420;
      const innerCat = rowH * sampleOrder.length;
      const marginB = 14 + 22 + legRows * 15 + (colorsRepeat ? 20 : 4);
      W = Math.max(marginL + innerW + marginR, 420);
      H = marginT + innerCat + marginB;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.style.width = ''; // el ancho es fijo (el eje de valor); solo la altura crece con el nº de muestras
      svg.style.maxWidth = '';
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      // rango manual del eje de porcentaje (Ajustes > Estructura); 0-100 por defecto
      const hso = getFigureOptions('taxaBarplot-horizontal');
      const fLo = (hso.axisMin != null ? hso.axisMin : 0) / 100, fHi = (hso.axisMax != null ? hso.axisMax : 100) / 100;
      const fSpan = (fHi - fLo) || 1;
      const xF = (f) => marginL + ((f - fLo) / fSpan) * innerW;
      const pctLabel = (p) => (Math.abs(p - Math.round(p)) < 0.05 ? String(Math.round(p)) : p.toFixed(1)) + '%';
      // gridlines eje de valor (5 marcas entre mínimo y máximo), arriba de las barras
      [0, 0.25, 0.5, 0.75, 1].forEach((frac) => {
        const x = marginL + frac * innerW;
        svg.appendChild(svgEl('line', { x1: x, x2: x, y1: marginT, y2: marginT + innerCat, class: 'ql-gridline' }));
        const tk = svgEl('text', { x, y: marginT - 8, class: 'ql-tick-label', 'text-anchor': 'middle' });
        tk.textContent = pctLabel((fLo + frac * fSpan) * 100);
        svg.appendChild(tk);
      });
      svg.appendChild(svgEl('line', { x1: marginL, x2: marginL, y1: marginT, y2: marginT + innerCat, class: 'ql-baseline-line' }));

      const barsLayerH = svgEl('g', { 'clip-path': plotClip(svg, 'ql-clip-barplot-h', marginL, marginT, innerW, innerCat) });
      svg.appendChild(barsLayerH);
      sampleOrder.forEach((sampleId, si) => {
        const row = rowsBySample[sampleId];
        if (!row) return;
        const cy = marginT + si * rowH + rowH / 2;
        const total = rowSum(row) || 1;
        let cumulative = 0;
        series.forEach((s) => {
          let val;
          if (s.key === '__other__') val = otherRaw(row) / total;
          else val = (parseFloat(row[s.key]) || 0) / total;
          if (val <= 0) return;
          const xL = xF(cumulative);
          const xR = xF(cumulative + val);
          const w = Math.max(0, xR - xL - gap);
          const fillCol = (s.key === '__other__') ? OTHER_COLOR : (seriesColorOverrides[s.key] || (s.colorVar ? 'var(' + s.colorVar + ')' : '#2a78d6'));
          const rect = svgEl('rect', {
            x: xL, y: cy - barH / 2, width: Math.max(w, 0), height: barH, 'data-ce-role': 'barh',
            fill: fillCol,
            'data-sample': sampleId,
            'data-tax': s.label,
            'data-val': val,
            'data-cx': xR,
            'data-cy': cy,
            ...(s.key === '__other__' ? {} : { 'data-ce-series-fill': 's' + CAT_VARS.indexOf(s.colorVar) }),
          });
          barsLayerH.appendChild(rect);
          cumulative += val;
        });
      });

      // etiquetas de muestra: normales, a la izquierda — el motivo del modo horizontal
      sampleOrder.forEach((sampleId, si) => {
        const cy = marginT + si * rowH + rowH / 2;
        const tx = svgEl('text', { x: marginL - 8, y: cy + 4, class: 'ql-tick-label', 'text-anchor': 'end' });
        tx.textContent = sampleId;
        svg.appendChild(tx);
      });

      xLabelBase = marginT + innerCat + 34;
      const xTitle = svgEl('text', { x: marginL + innerW / 2, y: xLabelBase, class: 'ql-axis-label ql-chart-x-title', 'text-anchor': 'middle', 'data-ce': 'xtitle' });
      xTitle.textContent = t('barplots.axisPct');
      svg.appendChild(xTitle);

      const yTitle = svgEl('text', {
        x: 15, y: marginT + innerCat / 2, class: 'ql-axis-label ql-chart-y-title', 'text-anchor': 'middle',
        transform: 'rotate(-90 15 ' + (marginT + innerCat / 2) + ')', 'data-ce': 'ytitle',
      });
      yTitle.textContent = groupCol ? t('barplots.axisSamplesBy', { col: groupCol }) : t('barplots.axisSamples');
      svg.appendChild(yTitle);

      legTranslateX = marginL; legTranslateY = xLabelBase + 18;
    }

    // leyenda dentro del SVG (editable + exportable), 1-3 columnas — común a las dos orientaciones
    const legG = svgEl('g', { 'data-ce': 'legend' });
    const colW = Math.min(260, Math.max(150, (W - legTranslateX - 12) / legCols));
    series.forEach((s, i) => {
      const col = Math.floor(i / legRows), rw = i % legRows;
      const xx = col * colW, yy = rw * 15;
      const fillCol = (s.key === '__other__') ? OTHER_COLOR : (seriesColorOverrides[s.key] || (s.colorVar ? 'var(' + s.colorVar + ')' : '#2a78d6'));
      legG.appendChild(svgEl('rect', {
        x: xx, y: yy - 8, width: 10, height: 10, rx: 2, fill: fillCol,
        ...(s.key === '__other__' ? {} : { 'data-ce-series-fill': 's' + CAT_VARS.indexOf(s.colorVar) }),
      }));
      const lt = svgEl('text', { x: xx + 15, y: yy, class: 'ql-tick-label' });
      lt.textContent = s.label;
      legG.appendChild(lt);
    });
    if (colorsRepeat) {
      const nt = svgEl('text', { x: 0, y: legRows * 15 + 4, class: 'ql-tick-label' });
      nt.setAttribute('fill', 'var(--ink-muted)');
      nt.textContent = t('barplots.colorsRepeat');
      legG.appendChild(nt);
    }
    legG.setAttribute('transform', 'translate(' + legTranslateX + ',' + legTranslateY + ')');
    svg.appendChild(legG);

    svg.addEventListener('pointerover', (e) => {
      const target = e.target;
      if (!target || !target.getAttribute) return;
      const sample = target.getAttribute('data-sample');
      const tax = target.getAttribute('data-tax');
      if (!sample || !tax) return;
      const val = parseFloat(target.getAttribute('data-val')) || 0;
      const cx = parseFloat(target.getAttribute('data-cx')) || 0;
      const cy = parseFloat(target.getAttribute('data-cy')) || 0;
      showTooltip(sample, tax, val, cx, cy, chartWrap, svg, W, H, tooltip);
    });
    svg.addEventListener('pointerout', (e) => {
      const target = e.target;
      if (!target || !target.getAttribute || !target.getAttribute('data-sample')) return;
      const rel = e.relatedTarget;
      if (rel && rel.getAttribute && rel.getAttribute('data-sample')) return;
      tooltip.classList.remove('is-show');
    });

    if (editor) editor.destroy();
    editor = attachChartEditor({
      key: plotStyle === 'bubbles' ? 'taxaBarplot-bubbles' : (horizontal ? 'taxaBarplot-horizontal' : 'taxaBarplot'),
      svg, mount: chartPanel, filename: t('barplots.title'), lang: getLang(),
      elements: [
        { id: 'title', create: { text: t('barplots.chartFigTitle'), x: W / 2, y: 24, anchor: 'middle', cls: 'ce-title ql-chart-main-title' } },
        { id: 'xtitle', selector: '[data-ce="xtitle"]' },
        { id: 'ytitle', selector: '[data-ce="ytitle"]' },
        { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
      ],
      paletteSeries: CAT_VARS.map((cv, i) => ({
        id: 's' + i,
        label: (series.find((s) => s.colorVar === cv) || {}).label || t('barplots.paletteSlotN', { n: i + 1 }),
      })),
      paletteType: 'categorical',
      // Paso 2/G4 (qiimelab-prompt-editor-fase-4-ejes-rejilla-leyenda-
      // lienzo.md) — orden de taxones. Solo en la vista vertical apilada
      // (clave 'taxaBarplot'): groupTaxaByAbundance() ya lee esta MISMA
      // clave con independencia de la vista activa (ver arriba), así que
      // mostrar el control en 2-3 vistas a la vez guardaría en cubos
      // separados y desincronizaría el panel de lo que de verdad se aplica.
      // (actualizado: ahora cada vista lee el orden de SU clave, ver más arriba)
      figureOptions: plotStyle === 'bubbles' ? { categoryOrder: true } : { categoryOrder: true, axis: { domain: [0, 100] } },
      onFigureOptionsChange: () => paint(),
      onReset: () => paint(),
      startEditing: wasEditing,
    });

    // tabla
    const scrollDiv = document.createElement('div');
    scrollDiv.className = 'ql-table-scroll scroll-x';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th><button type="button">' + t('barplots.colSample') + '</button></th>' +
      (groupCol ? '<th><button type="button">' + escapeHtml(groupCol) + '</button></th>' : '') +
      series.map((s) => '<th><button type="button">' + escapeHtml(s.label) + '</button></th>').join('') + '</tr>';
    tbl.appendChild(thead);
    const tbody = document.createElement('tbody');
    sampleOrder.forEach((sampleId) => {
      const row = rowsBySample[sampleId];
      if (!row) return;
      const tr = document.createElement('tr');
      let cells = '<td>' + escapeHtml(sampleId) + '</td>';
      if (groupCol) cells += '<td>' + escapeHtml(groupBySample[sampleId] || '—') + '</td>';
      const total = rowSum(row) || 1;
      series.forEach((s) => {
        const val = (s.key === '__other__' ? otherRaw(row) : (parseFloat(row[s.key]) || 0)) / total;
        cells += '<td class="ql-num tabular">' + (val * 100).toFixed(1) + '%</td>';
      });
      tr.innerHTML = cells;
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    scrollDiv.appendChild(tbl);
    tableCard.appendChild(scrollDiv);
      }
    }

    renderChartAndTable();
  }

  // =========================================================================
  //  VISTA SUNBURST — jerarquía taxonómica en anillos concéntricos, estilo
  //  Krona (Ondov, Bergman & Phillippy, BMC Bioinformatics 2011). Geometría
  //  y árbol en js/lib/sunburst.js (sin dependencias); aquí solo se dibuja
  //  (svgEl), se colorea (por filo, heredado por los descendientes) y se
  //  conecta el zoom/breadcrumb/tooltip.
  //
  //  Misma fuente de datos que el resto del panel (`table`, la tabla del
  //  nivel taxonómico elegido) — sin pipeline paralelo. Dos formatos posibles
  //  de columna según lo que se haya cargado (ver ingest.js):
  //   - "nativo" QIIME2: la cabecera YA es el linaje completo con ';'
  //     (p. ej. exampleData.js genera así el ejemplo sintético) -> se parte
  //     directamente.
  //   - "ancho, nombres cortos" (TOP14 + Others, el formato del dataset real
  //     de ejemplo): la cabecera es solo el género -> se cruza por nombre
  //     con state.taxonomy (Feature ID + Taxon), si está cargado. Sin
  //     ninguna de las dos cosas, el taxón se queda en un único anillo plano
  //     — mejor eso que no mostrar nada.
  // =========================================================================
  const SB_SIZE = 620;
  const SB_HOLE_R = 42;

  function sbRankName(depth) {
    const names = [
      t('barplots.rankPhylum'), t('barplots.rankClass'), t('barplots.rankOrder'),
      t('barplots.rankFamily'), t('barplots.rankGenus'), t('barplots.rankSpecies'),
    ];
    return names[depth - 1] || t('barplots.sunburstRankGeneric', { n: depth });
  }

  function sbIsOther(node) {
    return !!(node.isOther || (node.meta && node.meta.isOther));
  }

  // nombre corto -> ruta completa (sin dominio), a partir de la taxonomía
  // cargada aparte (si la hay) — ver cabecera de la sección.
  function buildTaxonomyLineageIndex() {
    if (!state.taxonomy) return new Map();
    const taxonCol = state.taxonomy.headers.find((h) => {
      const n = normalizeHeader(h);
      return n === 'taxon' || n === 'taxonomy';
    });
    if (!taxonCol) return new Map();
    return buildLineageIndex(state.taxonomy.rows, taxonCol);
  }

  // color base por filo (profundidad 1 desde la RAÍZ VERDADERA, no desde el
  // foco del zoom — así el color de un taxón no cambia al hacer zoom),
  // heredado por todos sus descendientes; "Otros" siempre gris fijo.
  function assignPhylumColors(root) {
    const topKids = root.children.slice().sort((a, b) => b.value - a.value);
    topKids.forEach((child, i) => {
      const color = sbIsOther(child) ? OTHER_COLOR : paletteColorAt('categorical', i);
      (function propagate(node) {
        node.phylumColor = color;
        node.children.forEach(propagate);
      })(child);
    });
  }

  function drawSunburstBreadcrumb(el, path) {
    el.innerHTML = '';
    const rootBtn = document.createElement('button');
    rootBtn.type = 'button';
    rootBtn.className = 'ql-sb-crumb';
    rootBtn.textContent = t('barplots.sunburstRoot');
    if (!path.length) rootBtn.disabled = true;
    else rootBtn.addEventListener('click', () => { sbFocusPath = []; paint(); });
    el.appendChild(rootBtn);
    let acc = [];
    path.forEach((name, i) => {
      acc = acc.concat([name]);
      const target = acc.slice();
      const sep = svgSepSpan();
      el.appendChild(sep);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ql-sb-crumb';
      btn.textContent = name;
      if (i === path.length - 1) btn.disabled = true;
      else btn.addEventListener('click', () => { sbFocusPath = target; paint(); });
      el.appendChild(btn);
    });
  }
  function svgSepSpan() {
    const sep = document.createElement('span');
    sep.className = 'ql-sb-sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = '›';
    return sep;
  }

  function drawSunburst(svg, chartPanel, chartWrap, tooltip, root, focusNode) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', '0 0 ' + SB_SIZE + ' ' + SB_SIZE);
    const cx = SB_SIZE / 2, cy = SB_SIZE / 2;
    const maxR = SB_SIZE / 2 - 56; // margen para etiquetas exteriores
    const ringW = Math.max(18, (maxR - SB_HOLE_R) / sbMaxRings);

    const arcs = computeSunburstLayout(focusNode, { maxDepth: sbMaxRings, maxChildren: 24, otherLabel: t('barplots.others') });

    const g = svgEl('g', {});
    svg.appendChild(g);

    // agujero central: "volver un nivel" cuando hay zoom; decorativo en la raíz
    const zoomed = sbFocusPath.length > 0;
    const hole = svgEl('circle', {
      cx, cy, r: SB_HOLE_R, class: 'ql-sb-hole',
      ...(zoomed ? { 'data-sb-back': '1' } : {}),
    });
    if (zoomed) hole.style.cursor = 'pointer';
    g.appendChild(hole);
    const holeLabel = svgEl('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', class: 'ql-tick-label' });
    holeLabel.textContent = zoomed ? '‹ ' + t('barplots.sunburstBack') : t('barplots.sunburstRootShort');
    if (zoomed) { holeLabel.style.cursor = 'pointer'; holeLabel.setAttribute('data-sb-back', '1'); }
    g.appendChild(holeLabel);

    const arcsG = svgEl('g', {});
    g.appendChild(arcsG);
    const labelsG = svgEl('g', {});
    g.appendChild(labelsG);

    arcs.forEach((a, i) => {
      const r0 = SB_HOLE_R + (a.depth - 1) * ringW;
      const r1 = r0 + ringW - 1.5;
      const isOther = sbIsOther(a.node);
      const mixPct = Math.max(35, 100 - (a.depth - 1) * 16);
      const fill = isOther ? OTHER_COLOR : 'color-mix(in srgb, ' + (a.node.phylumColor || OTHER_COLOR) + ' ' + mixPct + '%, var(--surface))';
      const clickable = a.node.children && a.node.children.length > 0;
      const seg = svgEl('path', {
        d: arcPath(cx, cy, r0, r1, a.a0, a.a1),
        fill, stroke: 'var(--surface)', 'stroke-width': 1, 'data-ce-role': 'line',
        'data-tt': i, 'data-sb-idx': i,
      });
      if (clickable) seg.style.cursor = 'pointer';
      arcsG.appendChild(seg);

      // etiqueta recta solo si el arco es lo bastante ancho (evita amontonar texto)
      const span = a.a1 - a.a0;
      if (span > 0.16 && ringW > 14) {
        const midA = (a.a0 + a.a1) / 2;
        const midR = (r0 + r1) / 2;
        const p = polarPoint(cx, cy, midR, midA);
        const angleDeg = (midA * 180) / Math.PI;
        const flip = angleDeg > 90 && angleDeg < 270;
        // mismo criterio que el mapa de calor de differentialAbundance.js:
        // texto claro sobre relleno fuerte/saturado, oscuro sobre relleno claro
        const lblFill = isOther ? 'var(--ink)' : (mixPct > 55 ? 'var(--surface)' : 'var(--ink)');
        const lbl = svgEl('text', {
          x: p.x, y: p.y, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          class: 'ql-sb-label', fill: lblFill,
          transform: 'rotate(' + (angleDeg - 90 + (flip ? 180 : 0)) + ' ' + p.x + ' ' + p.y + ')',
        });
        const maxChars = Math.max(3, Math.floor((span * midR) / 7));
        const name = a.node.name;
        lbl.textContent = name.length > maxChars ? name.slice(0, Math.max(1, maxChars - 1)) + '…' : name;
        labelsG.appendChild(lbl);
      }
    });

    // tooltip: un único listener delegado en el svg, no uno por arco (con
    // datasets grandes serían cientos de segmentos — mismo patrón que
    // differentialAbundance.js/dom.js delegateHover).
    delegateHover(svg, '[data-tt]', {
      onEnter: (el) => {
        const a = arcs[+el.dataset.sbIdx];
        const n = a.node;
        const pctTotal = root.value > 0 ? (n.value / root.value) * 100 : 0;
        const pctParent = a.parentValue > 0 ? (n.value / a.parentValue) * 100 : 0;
        const parentName = n.path.length > 1 ? n.path[n.path.length - 2]
          : (sbFocusPath.length ? sbFocusPath[sbFocusPath.length - 1] : t('barplots.sunburstRoot'));
        const rank = sbIsOther(n) ? t('barplots.others') : sbRankName(n.depth);
        const midA = (a.a0 + a.a1) / 2;
        const midR = SB_HOLE_R + (a.depth - 0.5) * ringW;
        const p = polarPoint(cx, cy, midR, midA);
        showTooltipCentral(chartWrap, p.x, p.y, n.name, [
          rank,
          t('barplots.sunburstTooltipOfTotal', { pct: pctTotal.toFixed(2) }),
          t('barplots.sunburstTooltipOfParent', { pct: pctParent.toFixed(2), parent: parentName }),
        ], { svg, W: SB_SIZE, H: SB_SIZE, tooltip });
      },
      onLeave: () => hideTooltip(tooltip),
    });

    // click: zoom en un segmento con hijos, o "volver" desde el agujero
    // central — un único listener (se sustituye entero en cada paint()
    // junto con el resto del DOM, no se acumula).
    svg.addEventListener('click', (e) => {
      if (e.target.closest('[data-sb-back]')) {
        sbFocusPath = sbFocusPath.slice(0, -1);
        paint();
        return;
      }
      const el = e.target.closest('[data-sb-idx]');
      if (!el) return;
      const a = arcs[+el.dataset.sbIdx];
      if (!a.node.children || !a.node.children.length) return;
      sbFocusPath = a.node.path;
      paint();
    });

    if (editor) { editor.destroy(); editor = null; }
    const titleName = sbFocusPath.length ? sbFocusPath[sbFocusPath.length - 1] : t('barplots.sunburstRoot');
    editor = attachChartEditor({
      key: 'taxaSunburst', svg, mount: chartPanel,
      filename: t('barplots.sunburstTitle') + (sbFocusPath.length ? '-' + sbFocusPath.join('-') : ''),
      lang: getLang(),
      elements: [
        { id: 'title', create: { text: t('barplots.sunburstTitle') + ' — ' + titleName, x: cx, y: 24, anchor: 'middle', cls: 'ce-title' } },
      ],
      onReset: () => paint(),
      startEditing: wasEditing,
    });
  }

  function renderSunburstView(table, levels) {
    const grid = document.createElement('div');
    grid.className = 'ql-grid-2';

    const chartPanel = document.createElement('section');
    chartPanel.className = 'ql-card ql-panel';
    chartPanel.innerHTML = '<p class="ql-panel-note" style="margin-bottom:4px;">' + t('barplots.sunburstNote') + '</p>';

    const breadcrumb = document.createElement('nav');
    breadcrumb.className = 'ql-sb-breadcrumb';
    breadcrumb.setAttribute('aria-label', t('barplots.sunburstBreadcrumbAria'));
    chartPanel.appendChild(breadcrumb);

    const chartWrap = document.createElement('div');
    chartWrap.className = 'ql-chartwrap';
    const svg = svgEl('svg', { class: 'ql-svg', viewBox: '0 0 ' + SB_SIZE + ' ' + SB_SIZE, role: 'img', 'aria-label': t('a11y.chartSunburst') });
    const tooltip = document.createElement('div');
    tooltip.className = 'ql-tooltip';
    chartWrap.appendChild(svg);
    chartWrap.appendChild(tooltip);
    chartPanel.appendChild(chartWrap);
    grid.appendChild(chartPanel);

    const controls = document.createElement('aside');
    controls.className = 'ql-card ql-panel';
    controls.innerHTML = '<h2>' + t('ui.controls') + '</h2>';

    // nivel taxonómico (compartido con el barplot/biomarcadores) — solo si
    // hay más de un nivel cargado (p. ej. filo Y género como archivos
    // separados); con uno solo, el sunburst ya construye la jerarquía
    // completa desde ese único nivel.
    if (levels.length > 1) {
      const lf = document.createElement('div');
      lf.className = 'ql-field';
      lf.innerHTML = '<label>' + t('barplots.levelLabel') + '</label>';
      const sel = document.createElement('select');
      levels.forEach((lv) => {
        const o = document.createElement('option');
        o.value = lv;
        o.textContent = t('barplots.level', { n: lv }) + (Number(lv) === 6 ? t('barplots.levelGenus') : Number(lv) === 2 ? t('barplots.levelPhylum') : '');
        if (String(level) === lv) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => { level = sel.value; sbFocusPath = []; paint(); });
      lf.appendChild(sel);
      controls.appendChild(lf);
    }

    const ringsField = document.createElement('div');
    ringsField.className = 'ql-field';
    ringsField.innerHTML = '<label for="sbRings">' + t('barplots.sunburstRingsLabel') + '</label>' +
      '<input type="number" id="sbRings" min="1" max="6" step="1" value="' + sbMaxRings + '" />' +
      '<p class="ql-field-help">' + t('barplots.sunburstRingsHelp') + '</p>';
    controls.appendChild(ringsField);
    ringsField.querySelector('#sbRings').addEventListener('change', (e) => {
      const v = Math.max(1, Math.min(6, parseInt(e.target.value, 10) || 4));
      if (v !== sbMaxRings) { sbMaxRings = v; paint(); }
    });

    grid.appendChild(controls);
    container.appendChild(grid);

    // ---- construir el árbol a partir de la MISMA tabla que el resto del panel ----
    const taxonHeaders = table.headers.filter((h, i) => i !== 0 && !OTHER_COL_RE.test(String(h).trim()));
    const otherHeaders = table.headers.filter((h, i) => i !== 0 && OTHER_COL_RE.test(String(h).trim()));
    const rowSum = (row) => taxonHeaders.concat(otherHeaders).reduce((a, h) => a + (parseFloat(row[h]) || 0), 0);
    const nRows = table.rows.length || 1;
    const means = {};
    taxonHeaders.forEach((h) => { means[h] = 0; });
    let otherMean = 0;
    table.rows.forEach((row) => {
      const total = rowSum(row) || 1;
      taxonHeaders.forEach((h) => { means[h] += (parseFloat(row[h]) || 0) / total / nRows; });
      otherHeaders.forEach((h) => { otherMean += (parseFloat(row[h]) || 0) / total / nRows; });
    });

    const lineageIndex = buildTaxonomyLineageIndex();
    const unclassified = [t('barplots.unclassified')];
    function resolvePath(h) {
      if (String(h).includes(';')) {
        const p = lineageToPath(h);
        return p.length ? p : null;
      }
      const shortName = shortTaxonName(h);
      const viaIndex = shortName && lineageIndex.get(shortName);
      if (viaIndex) return viaIndex;
      return shortName ? [shortName] : null;
    }

    const root = createSunburstRoot();
    taxonHeaders.forEach((h) => {
      insertTaxon(root, resolvePath(h) || unclassified, means[h], { header: h });
    });
    if (otherMean > 0) {
      insertTaxon(root, [t('barplots.others')], otherMean, { isOther: true });
    }
    assignPhylumColors(root);

    if (!(root.value > 0)) {
      chartPanel.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('barplots.sunburstEmpty') + '</p>');
      return;
    }
    if (treeMaxDepth(root) <= 1) {
      chartPanel.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('barplots.sunburstFlatNote') + '</p>');
    }

    // el foco de un zoom anterior puede no existir ya (cambio de nivel/grupo
    // desde el selector de arriba) — si no resuelve, se vuelve a la raíz sin
    // avisar (mismo criterio que ya usa el resto del módulo al recargar tabla)
    let focusNode = sbFocusPath.length ? findNodeByPath(root, sbFocusPath) : root;
    if (!focusNode) { sbFocusPath = []; focusNode = root; }

    drawSunburstBreadcrumb(breadcrumb, sbFocusPath);
    drawSunburst(svg, chartPanel, chartWrap, tooltip, root, focusNode);
  }

  // =========================================================================
  //  VISTA BIOMARCADORES — inspirada en LEfSe, variante propia
  //  Significancia por taxón, a elegir (bmMethod): Kruskal-Wallis (de
  //  siempre, sobre abundancia relativa) o ANCOM-BC (composicional, sobre
  //  conteos crudos — js/lib/ancomBC.js) → BH (FDR), igual en ambos casos →
  //  grupo enriquecido one-vs-rest → tamaño de efecto a elegir para la
  //  barra (bmScore): delta de Cliff, LDA bootstrapeado al estilo LEfSe, o
  //  — solo con ANCOM-BC — su propio log2FC corregido de sesgo.
  //  Toda la estadística está ya verificada en stats.js / ancomBC.js.
  // =========================================================================
  function renderBiomarkers(table, levels, groupOptions) {
    // aviso de equivalencia (Nivel C, js/lib/methodEquivalence.js): ninguno
    // de los tres métodos reproduce la herramienta de la que toma la idea;
    // la vista de consenso los junta, así que avisa de los tres
    const bmMethodId = { kw: 'lefse-like', ancombc: 'ancombc-like', rf: 'rf-biomarkers' };
    container.appendChild(methodNotice(bmView === 'consensus' ? Object.values(bmMethodId) : bmMethodId[bmMethod]));
    container.insertAdjacentHTML('beforeend', glossaryLinkHtml('biomarkers'));

    container.appendChild(chartTypeField({
      labelKey: 'barplots.bmViewLabel',
      options: [{ value: 'single', labelKey: 'barplots.bmViewSingle' }, { value: 'consensus', labelKey: 'barplots.bmViewConsensus' }],
      active: bmView,
      onChange: (v) => { bmView = v; paint(); },
      helpKey: bmView === 'consensus' ? 'barplots.bmViewConsensusHelp' : undefined,
    }));

    if (bmView === 'consensus') { renderBiomarkerConsensus(table, levels, groupOptions); return; }

    const grid = document.createElement('div');
    grid.className = 'ql-grid-2';

    const chartPanel = document.createElement('section');
    chartPanel.className = 'ql-card ql-panel';
    chartPanel.innerHTML = '<p class="ql-panel-note" style="margin-bottom:4px;">' + t('barplots.bmChartNote') + '</p>';
    const chartWrap = document.createElement('div');
    chartWrap.className = 'ql-chartwrap';
    const svg = svgEl('svg', { class: 'ql-svg', role: 'img', 'aria-label': t('a11y.chartBiomarkers') });
    const tooltip = document.createElement('div');
    tooltip.className = 'ql-tooltip';
    chartWrap.appendChild(svg); chartWrap.appendChild(tooltip);
    chartPanel.appendChild(chartWrap);
    grid.appendChild(chartPanel);

    const controls = document.createElement('aside');
    controls.className = 'ql-card ql-panel';
    controls.innerHTML = '<h2>' + t('ui.controls') + '</h2>';

    // nivel taxonómico (compartido con el barplot)
    if (levels.length > 1) {
      const lf = document.createElement('div');
      lf.className = 'ql-field';
      lf.innerHTML = '<label>' + t('barplots.levelLabel') + '</label>';
      const sel = document.createElement('select');
      levels.forEach((lv) => {
        const o = document.createElement('option');
        o.value = lv;
        o.textContent = t('barplots.level', { n: lv }) + (Number(lv) === 6 ? t('barplots.levelGenus') : Number(lv) === 2 ? t('barplots.levelPhylum') : '');
        if (String(level) === lv) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => { level = sel.value; paint(); });
      lf.appendChild(sel);
      controls.appendChild(lf);
    }

    // columna de grupo
    if (groupOptions.length > 0) {
      const gf = document.createElement('div');
      gf.className = 'ql-field';
      gf.innerHTML = '<label>' + t('barplots.groupLabel') + '</label>';
      const sel = document.createElement('select');
      groupOptions.forEach((g) => {
        const o = document.createElement('option'); o.value = g; o.textContent = g;
        if (g === groupCol) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => { groupCol = sel.value; paint(); });
      gf.appendChild(sel);
      controls.appendChild(gf);
    }

    // método de significancia: Kruskal-Wallis (de toda la vida, sobre la
    // abundancia relativa) o ANCOM-BC (composicional — corrige el sesgo de
    // muestreo por muestra antes de comparar, ver js/lib/ancomBC.js). Cambia
    // de dónde sale el p/q de la tabla; δ de Cliff y LDA se calculan igual
    // pase lo que pase aquí (son scores de efecto, no de significancia).
    const methodField = document.createElement('div');
    methodField.className = 'ql-field';
    methodField.innerHTML = '<label>' + t('barplots.bmMethodLabel') + '</label>';
    const methodSeg = document.createElement('div');
    methodSeg.className = 'ql-segmented';
    [['kw', t('barplots.bmMethodKw')], ['ancombc', t('barplots.bmMethodAncombc')], ['rf', t('barplots.bmMethodRf')]].forEach(([v, lbl]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-seg-btn' + (bmMethod === v ? ' is-on' : '');
      b.textContent = lbl;
      b.title = t(v === 'ancombc' ? 'barplots.bmMethodAncombcHelp' : v === 'rf' ? 'barplots.bmMethodRfHelp' : 'barplots.bmMethodKwHelp');
      b.addEventListener('click', () => {
        if (bmMethod === v) return;
        bmMethod = v;
        if (v === 'rf') { bmScore = 'rf'; bmSort = { key: 'rfImportance', dir: 'desc' }; }
        else if (bmScore === 'ancom' && v !== 'ancombc') { bmScore = 'cliffs'; bmSort = { key: 'delta', dir: 'desc' }; }
        else if (bmScore === 'rf') { bmScore = 'cliffs'; bmSort = { key: 'delta', dir: 'desc' }; }
        paint();
      });
      methodSeg.appendChild(b);
    });
    methodField.appendChild(methodSeg);
    const methodHelpKey = bmMethod === 'ancombc' ? 'barplots.bmMethodAncombcHelp' : bmMethod === 'rf' ? 'barplots.bmMethodRfHelp' : 'barplots.bmMethodKwHelp';
    methodField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t(methodHelpKey) + '</p>');
    const methodGlosId = bmMethod === 'ancombc' ? 'ancombc' : bmMethod === 'rf' ? 'randomforest' : bmMethod === 'kw' ? 'kruskal' : null;
    if (methodGlosId) {
      methodField.insertAdjacentHTML('beforeend', glossaryLinkHtml(methodGlosId));
    }
    // el title= de cada botón no se ve en táctil ni con teclado, y la ayuda de
    // arriba solo describe el método elegido: las tres, plegadas y a la vista
    methodField.insertAdjacentHTML('beforeend', moreDetailsHtml(t('barplots.bmMethodCompare'),
      [['bmMethodKw', 'bmMethodKwHelp'], ['bmMethodAncombc', 'bmMethodAncombcHelp'], ['bmMethodRf', 'bmMethodRfHelp']]
        .map(([n, h]) => '<p><b>' + t('barplots.' + n) + '</b> — ' + t('barplots.' + h) + '</p>').join('')));
    controls.appendChild(methodField);

    // umbral q — no aplica a Random Forest (ahí la significancia sale de
    // comparar contra variables "sombra" barajadas, no de un p-valor)
    if (bmMethod !== 'rf') {
      const qf = document.createElement('div');
      qf.className = 'ql-field';
      qf.innerHTML = '<label for="bmQ">' + t('barplots.bmQLabel') + '</label>' +
        '<div class="ql-inputrow">' +
        '<input type="range" aria-label="' + escapeHtml(t('barplots.bmQLabel')) + '" id="bmQr" min="0.001" max="0.25" step="0.001" value="' + qThresh + '" />' +
        '<input type="number" id="bmQ" class="ql-num-small tabular" min="0.0001" max="1" step="0.001" value="' + qThresh + '" /></div>' +
        '<p class="ql-field-help">' + t('barplots.bmQHelp') + '</p>';
      controls.appendChild(qf);
      const qR = qf.querySelector('#bmQr'), qN = qf.querySelector('#bmQ');
      const applyQ = (v) => { const nv = Math.max(0.0001, Math.min(1, Number(v))); if (isFinite(nv) && nv !== qThresh) { qThresh = nv; paint(); } };
      qR.addEventListener('input', () => { qN.value = qR.value; });
      qR.addEventListener('change', () => applyQ(qR.value));
      qN.addEventListener('change', () => applyQ(qN.value));
    } else {
      const rfNote = document.createElement('p');
      rfNote.className = 'ql-field-help';
      rfNote.textContent = t('barplots.bmRfSigNote');
      controls.appendChild(rfNote);
    }

    // score del gráfico: δ de Cliff (no asume normalidad), LDA bootstrapeado
    // (el nombre que la gente espera de "LEfSe"), y — solo con ANCOM-BC — su
    // propio log2FC corregido de sesgo. Los tres quedan siempre visibles en
    // la tabla cuando aplican; este selector solo decide cuál manda en la
    // longitud de las barras y el orden por defecto.
    const scoreField = document.createElement('div');
    scoreField.className = 'ql-field';
    scoreField.innerHTML = '<label>' + t('barplots.bmScoreLabel') + '</label>';
    const scoreSeg = document.createElement('div');
    scoreSeg.className = 'ql-segmented';
    const scoreOptions = [['cliffs', t('barplots.bmScoreCliffs')], ['lda', t('barplots.bmScoreLda')]];
    if (bmMethod === 'ancombc') scoreOptions.push(['ancom', t('barplots.bmScoreAncom')]);
    if (bmMethod === 'rf') scoreOptions.push(['rf', t('barplots.bmScoreRf')]);
    const scoreSortKey = { lda: 'ldaScore', ancom: 'ancomLog2FC', cliffs: 'delta', rf: 'rfImportance' };
    scoreOptions.forEach(([v, lbl]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-seg-btn' + (bmScore === v ? ' is-on' : '');
      b.textContent = lbl;
      b.addEventListener('click', () => { if (bmScore !== v) { bmScore = v; bmSort = { key: scoreSortKey[v], dir: 'desc' }; paint(); } });
      scoreSeg.appendChild(b);
    });
    scoreField.appendChild(scoreSeg);
    const scoreHelpKey = bmScore === 'lda' ? 'barplots.bmScoreLdaHelp' : bmScore === 'ancom' ? 'barplots.bmScoreAncomHelp' : bmScore === 'rf' ? 'barplots.bmScoreRfHelp' : 'barplots.bmScoreCliffsHelp';
    scoreField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t(scoreHelpKey) + '</p>');
    controls.appendChild(scoreField);

    const method = document.createElement('p');
    method.className = 'ql-field-help';
    method.style.marginTop = '14px';
    method.textContent = t(bmMethod === 'ancombc' ? 'barplots.bmMethodAncombcDesc' : bmMethod === 'rf' ? 'barplots.bmMethodRfDesc' : 'barplots.bmMethod');
    controls.appendChild(method);

    grid.appendChild(controls);
    container.appendChild(grid);

    const tableCard = document.createElement('section');
    tableCard.className = 'ql-card ql-panel';
    tableCard.style.marginTop = '20px';
    tableCard.innerHTML = '<h2>' + t('barplots.bmTableTitle') + '</h2>';
    container.appendChild(tableCard);

    // --- necesitamos metadatos + ≥2 grupos ---
    if (!state.metadata || !groupCol) {
      chartPanel.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('barplots.bmNeedGroup') + '</p>');
      return;
    }

    // --- abundancia relativa (%) por taxón y muestra, agrupada ---
    const sampleKey = table.headers[0];
    const abundHeaders = table.headers.filter((h, i) => i !== 0); // taxones + posible "Otros"
    const taxonHeaders = abundHeaders.filter((h) => !OTHER_COL_RE.test(String(h).trim()));
    const rowSum = (row) => abundHeaders.reduce((a, h) => a + (parseFloat(row[h]) || 0), 0);
    const resolveGroup = makeGroupResolver(state.metadata, groupCol);

    const relByTaxon = {}; // taxon -> { group -> number[] }
    const groupSet = new Set();
    table.rows.forEach((row) => {
      const g = resolveGroup(String(row[sampleKey]).trim());
      if (!g) return;
      groupSet.add(g);
      const total = rowSum(row) || 1;
      taxonHeaders.forEach((h) => {
        const rel = (parseFloat(row[h]) || 0) / total * 100;
        const byG = (relByTaxon[h] = relByTaxon[h] || {});
        (byG[g] = byG[g] || []).push(rel);
      });
    });
    const groups = [...groupSet].sort();

    if (groups.length < 2) {
      chartPanel.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('barplots.bmNeed2Groups') + '</p>');
      return;
    }

    // --- significancia por taxón: Kruskal-Wallis (de siempre, sobre la
    // abundancia relativa), ANCOM-BC (composicional, sobre los conteos
    // crudos — ver js/lib/ancomBC.js), o Random Forest (js/lib/randomForest.js). ---
    let tested = [];
    let rfShadowMax = null, rfOobAccuracy = null;
    if (bmMethod === 'rf') {
      // UN solo bosque multiclase (todos los grupos a la vez) sobre la
      // abundancia relativa de TODOS los taxones testados, con una copia
      // "sombra" de cada uno (valores barajados al azar entre muestras —
      // rompe cualquier relación con el grupo por construcción). Un taxón
      // es relevante si su importancia supera a la sombra más fuerte de
      // todas (criterio de Kursa & Rudnicki 2010, "Boruta"), en vez de un
      // p-valor + BH como en los otros dos métodos.
      const sampleRows = table.rows.filter((row) => resolveGroup(String(row[sampleKey]).trim()));
      const sampleGroupsArr = sampleRows.map((row) => resolveGroup(String(row[sampleKey]).trim()));
      const relMatrix = sampleRows.map((row) => {
        const total = rowSum(row) || 1;
        return taxonHeaders.map((h) => (parseFloat(row[h]) || 0) / total * 100);
      });
      let rfRes;
      try {
        rfRes = randomForest(relMatrix, sampleGroupsArr, { nTree: 300, seed: 42, shadows: true });
      } catch (e) {
        chartPanel.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + escapeHtml(e.message) + '</p>');
        return;
      }
      rfShadowMax = rfRes.shadowMax;
      rfOobAccuracy = rfRes.oobAccuracy;
      taxonHeaders.forEach((h, i) => {
        tested.push({
          taxon: h, label: shortTaxonName(h), p: null,
          perGroup: groups.map((g) => relByTaxon[h][g] || []),
          rfImportance: rfRes.importance[i],
        });
      });
    } else if (bmMethod === 'ancombc') {
      // ANCOM-BC necesita los conteos CRUDOS (no el % de relByTaxon) para
      // poder estimar el sesgo de muestra; no exige presencia en todos los
      // grupos (el pseudo-conteo se encarga de los ceros estructurales).
      const sampleRows = table.rows.filter((row) => resolveGroup(String(row[sampleKey]).trim()));
      const sampleGroupsArr = sampleRows.map((row) => resolveGroup(String(row[sampleKey]).trim()));
      const countMatrix = taxonHeaders.map((h) => sampleRows.map((row) => parseFloat(row[h]) || 0));
      const ancomRes = ancomBC(countMatrix, sampleGroupsArr, {}, studentTwoTailedP);
      taxonHeaders.forEach((h, i) => {
        const r = ancomRes[i];
        if (!r || !isFinite(r.p)) return;
        tested.push({
          taxon: h, label: shortTaxonName(h), p: r.p,
          perGroup: groups.map((g) => relByTaxon[h][g] || []),
          ancomGroupIdx: r.groupIdx, ancomLog2FC: r.log2FC, ancomSE: r.se, ancomW: r.W,
        });
      });
    } else {
      // Kruskal-Wallis por taxón (solo los presentes en TODOS los grupos)
      taxonHeaders.forEach((h) => {
        const perGroup = groups.map((g) => relByTaxon[h][g] || []);
        if (perGroup.some((arr) => arr.length === 0)) return;
        const kw = kruskalWallis(perGroup);
        if (!isFinite(kw.p)) return;
        tested.push({ taxon: h, label: shortTaxonName(h), p: kw.p, perGroup });
      });
    }

    // --- BH sobre TODOS los p testados (misma corrección, sea cual sea el
    // método) — no aplica a Random Forest, que no produce un p-valor ---
    if (bmMethod !== 'rf') {
      const q = benjaminiHochberg(tested.map((x) => x.p));
      tested.forEach((x, i) => { x.q = q[i]; });
    }

    // --- significativos: grupo enriquecido + tres scores de tamaño de
    // efecto, calculados siempre que aplique (no uno u otro): delta de
    // Cliff (one-vs-rest, no asume normalidad), el LDA univariante
    // bootstrapeado al estilo LEfSe (one-vs-rest, mismo split), y — solo
    // con ANCOM-BC — su propio log2FC corregido de sesgo (ya viene de esa
    // misma partición: ancomGroupIdx). Con Kruskal-Wallis, el grupo
    // enriquecido es el de mediana más alta (one-vs-rest); con ANCOM-BC es
    // el que su propio modelo ya identificó como tal, para que toda la fila
    // (grupo, δ, LDA, log2FC, q) hable del mismo contraste. ---
    const sig = tested.filter((x) => (bmMethod === 'rf' ? x.rfImportance > rfShadowMax : x.q < qThresh)).map((x) => {
      let bi;
      if (x.ancomGroupIdx != null) {
        bi = x.ancomGroupIdx;
      } else {
        const medians = x.perGroup.map((arr) => quartiles(arr.slice().sort((a, b) => a - b)).median);
        bi = 0;
        for (let i = 1; i < medians.length; i++) if (medians[i] > medians[bi]) bi = i;
      }
      const inGroup = x.perGroup[bi];
      const rest = x.perGroup.filter((_, i) => i !== bi).flat();
      const lda = lefseLdaScore(inGroup, rest);
      return {
        ...x, enrichedGroup: groups[bi], enrichedIdx: bi,
        delta: cliffsDelta(inGroup, rest),
        ldaScore: lda.error ? null : lda.score,
      };
    });
    const scoreOf = (x) => (bmScore === 'lda' ? x.ldaScore : bmScore === 'ancom' ? x.ancomLog2FC : bmScore === 'rf' ? x.rfImportance : x.delta);
    sig.sort((a, b) => Math.abs(scoreOf(b) ?? -Infinity) - Math.abs(scoreOf(a) ?? -Infinity));
    const ldaMissing = sig.filter((x) => x.ldaScore == null).length;

    chartPanel.insertAdjacentHTML('beforeend',
      '<p class="ql-field-help" style="margin-top:6px;">' +
      (bmMethod === 'rf' ? t('barplots.bmCountRf', { n: sig.length, total: tested.length }) : t('barplots.bmCount', { n: sig.length, total: tested.length, q: qThresh })) + '</p>');
    if (bmMethod === 'rf' && rfOobAccuracy != null) {
      chartPanel.insertAdjacentHTML('beforeend',
        '<p class="ql-field-help">' + t('barplots.bmRfOob', { pct: (rfOobAccuracy * 100).toFixed(1) }) + '</p>');
    }
    if (bmScore === 'lda' && ldaMissing > 0) {
      chartPanel.insertAdjacentHTML('beforeend',
        '<p class="ql-field-help">' + t('barplots.bmLdaMissing', { n: ldaMissing }) + '</p>');
    }

    // --- gráfico: barras horizontales tipo LEfSe ---
    const sigForChart = bmScore === 'lda' ? sig.filter((x) => x.ldaScore != null)
      : bmScore === 'ancom' ? sig.filter((x) => x.ancomLog2FC != null) : sig;
    drawBiomarkerBars(svg, chartPanel, chartWrap, tooltip, sigForChart, groups, bmScore);

    // --- tabla ordenable ---
    const scrollDiv = document.createElement('div');
    scrollDiv.className = 'ql-table-scroll';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table';
    const cols = [
      ['label', t('barplots.bmColTaxon')],
      ['enrichedGroup', t('barplots.bmColGroup')],
      ['delta', t('barplots.bmColDelta')],
      ['ldaScore', t('barplots.bmColLda')],
    ];
    if (bmMethod === 'ancombc') cols.push(['ancomLog2FC', t('barplots.bmColAncomLfc')]);
    if (bmMethod === 'rf') cols.push(['rfImportance', t('barplots.bmColRf')]);
    if (bmMethod !== 'rf') cols.push(['q', t('barplots.bmColQ')]);
    let thead = '<thead><tr>';
    cols.forEach(([key, lbl]) => {
      const on = bmSort.key === key;
      thead += '<th aria-sort="' + (on ? (bmSort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '">' +
        '<button type="button" data-sort="' + key + '">' + escapeHtml(lbl) +
        (on ? ' <span aria-hidden="true">' + (bmSort.dir === 'asc' ? '▲' : '▼') + '</span>' : '') + '</button></th>';
    });
    tbl.innerHTML = thead + '</tr></thead>';
    const tb = document.createElement('tbody');
    if (sig.length === 0) {
      tb.innerHTML = '<tr><td colspan="' + cols.length + '" style="text-align:center;color:var(--ink-muted);padding:20px;">' + t('barplots.bmNone') + '</td></tr>';
    } else {
      const dir = bmSort.dir === 'asc' ? 1 : -1;
      const absSortKeys = new Set(['delta', 'ldaScore', 'ancomLog2FC', 'rfImportance']);
      const rows = sig.slice().sort((a, b) => {
        const av = a[bmSort.key], bv = b[bmSort.key];
        if (absSortKeys.has(bmSort.key)) return ((Math.abs(av) || -Infinity) - (Math.abs(bv) || -Infinity)) * dir;
        if (typeof av === 'string') return av.localeCompare(bv) * dir;
        return (av - bv) * dir;
      });
      rows.forEach((r) => {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + escapeHtml(r.label) + '</td>' +
          '<td><span class="ql-bm-swatch" style="background:' + groupColor(r.enrichedIdx) + '"></span>' + escapeHtml(r.enrichedGroup) + '</td>' +
          '<td class="ql-num tabular">' + r.delta.toFixed(3) + '</td>' +
          '<td class="ql-num tabular">' + (r.ldaScore == null ? '—' : r.ldaScore.toFixed(3)) + '</td>' +
          (bmMethod === 'ancombc' ? '<td class="ql-num tabular">' + r.ancomLog2FC.toFixed(3) + '</td>' : '') +
          (bmMethod === 'rf' ? '<td class="ql-num tabular">' + r.rfImportance.toFixed(4) + '</td>' : '') +
          (bmMethod !== 'rf' ? '<td class="ql-num tabular">' + formatP(r.q) + '</td>' : '');
        tb.appendChild(tr);
      });
    }
    tbl.appendChild(tb);
    scrollDiv.appendChild(tbl);
    tableCard.appendChild(scrollDiv);
    tbl.querySelectorAll('th button[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sort');
        if (bmSort.key === key) bmSort = { key, dir: bmSort.dir === 'asc' ? 'desc' : 'asc' };
        // por defecto: nombres y q ascendente; scores de efecto (δ, LDA, ANCOM-BC, RF) descendente
        else bmSort = { key, dir: (key === 'delta' || key === 'ldaScore' || key === 'ancomLog2FC' || key === 'rfImportance') ? 'desc' : 'asc' };
        paint();
      });
    });
  }

  // =========================================================================
  //  PANEL DE CONSENSO — taxón × método (Kruskal-Wallis / ANCOM-BC / Random
  //  Forest), corridos los 3 a la vez sobre la MISMA columna de grupo. Cada
  //  método decide su propia significancia con su propio criterio (q < umbral
  //  BH para KW/ANCOM-BC, importancia > sombra para RF) — este panel solo
  //  junta los 3 resultados en una tabla, sin gráfico (no hay una única
  //  "unidad" de tamaño de efecto comparable entre los tres).
  // =========================================================================
  function renderBiomarkerConsensus(table, levels, groupOptions) {
    const controls = document.createElement('section');
    controls.className = 'ql-card ql-panel';
    controls.style.marginBottom = '18px';
    controls.innerHTML = '<h2>' + t('ui.controls') + '</h2>';
    const row = document.createElement('div');
    row.className = 'ql-inputrow';
    row.style.cssText = 'flex-wrap:wrap;gap:14px;';

    if (levels.length > 1) {
      const lf = document.createElement('div');
      lf.className = 'ql-field'; lf.style.cssText = 'flex:1 1 160px;margin:0;';
      lf.innerHTML = '<label>' + t('barplots.levelLabel') + '</label>';
      const sel = document.createElement('select');
      levels.forEach((lv) => {
        const o = document.createElement('option'); o.value = lv;
        o.textContent = t('barplots.level', { n: lv }) + (Number(lv) === 6 ? t('barplots.levelGenus') : Number(lv) === 2 ? t('barplots.levelPhylum') : '');
        if (String(level) === lv) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => { level = sel.value; paint(); });
      lf.appendChild(sel); row.appendChild(lf);
    }

    if (groupOptions.length > 0) {
      const gf = document.createElement('div');
      gf.className = 'ql-field'; gf.style.cssText = 'flex:1 1 160px;margin:0;';
      gf.innerHTML = '<label>' + t('barplots.groupLabel') + '</label>';
      const sel = document.createElement('select');
      groupOptions.forEach((g) => {
        const o = document.createElement('option'); o.value = g; o.textContent = g;
        if (g === groupCol) o.selected = true; sel.appendChild(o);
      });
      sel.addEventListener('change', () => { groupCol = sel.value; paint(); });
      gf.appendChild(sel); row.appendChild(gf);
    }

    const qf = document.createElement('div');
    qf.className = 'ql-field'; qf.style.cssText = 'flex:0 0 auto;margin:0;';
    qf.innerHTML = '<label for="bmConsQ">' + t('barplots.bmQLabel') + '</label>' +
      '<div class="ql-inputrow">' +
      '<input type="range" aria-label="' + escapeHtml(t('barplots.bmQLabel')) + '" id="bmConsQr" min="0.001" max="0.25" step="0.001" value="' + qThresh + '" />' +
      '<input type="number" id="bmConsQ" class="ql-num-small tabular" min="0.0001" max="1" step="0.001" value="' + qThresh + '" /></div>';
    row.appendChild(qf);
    controls.appendChild(row);
    const qR = qf.querySelector('#bmConsQr'), qN = qf.querySelector('#bmConsQ');
    const applyQ = (v) => { const nv = Math.max(0.0001, Math.min(1, Number(v))); if (isFinite(nv) && nv !== qThresh) { qThresh = nv; paint(); } };
    qR.addEventListener('input', () => { qN.value = qR.value; });
    qR.addEventListener('change', () => applyQ(qR.value));
    qN.addEventListener('change', () => applyQ(qN.value));
    controls.insertAdjacentHTML('beforeend', '<p class="ql-field-help" style="margin-top:8px;">' + t('barplots.bmConsQHelp') + '</p>');
    container.appendChild(controls);

    if (!state.metadata || !groupCol) {
      container.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('barplots.bmNeedGroup') + '</p>');
      return;
    }

    const sampleKey = table.headers[0];
    const abundHeaders = table.headers.filter((h, i) => i !== 0);
    const taxonHeaders = abundHeaders.filter((h) => !OTHER_COL_RE.test(String(h).trim()));
    const rowSum = (r) => abundHeaders.reduce((a, h) => a + (parseFloat(r[h]) || 0), 0);
    const resolveGroup = makeGroupResolver(state.metadata, groupCol);

    const relByTaxon = {};
    const groupSet = new Set();
    table.rows.forEach((r) => {
      const g = resolveGroup(String(r[sampleKey]).trim());
      if (!g) return;
      groupSet.add(g);
      const total = rowSum(r) || 1;
      taxonHeaders.forEach((h) => {
        const rel = (parseFloat(r[h]) || 0) / total * 100;
        const byG = (relByTaxon[h] = relByTaxon[h] || {});
        (byG[g] = byG[g] || []).push(rel);
      });
    });
    const groups = [...groupSet].sort();
    if (groups.length < 2) {
      container.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('barplots.bmNeed2Groups') + '</p>');
      return;
    }

    const ctx = { table, sampleKey, taxonHeaders, rowSum, resolveGroup, groups, relByTaxon, qThresh };
    const METHODS = [['kw', t('barplots.bmMethodKw')], ['ancombc', t('barplots.bmMethodAncombc')], ['rf', t('barplots.bmMethodRf')]];
    const results = METHODS.map(([m]) => computeSigSet(m, ctx));

    const failed = results.find((r) => r.error);
    if (failed) {
      container.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + escapeHtml(failed.error) + '</p>');
      return;
    }

    const allTaxa = new Set();
    results.forEach((r) => r.sig.forEach((tx) => allTaxa.add(tx)));

    const tableCard = document.createElement('section');
    tableCard.className = 'ql-card ql-panel';
    tableCard.innerHTML = '<h2>' + t('barplots.bmConsTableTitle') + '</h2>' +
      '<p class="ql-panel-note">' + t('barplots.bmConsNote', { n: allTaxa.size }) + '</p>';
    container.appendChild(tableCard);

    if (allTaxa.size === 0) {
      tableCard.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('barplots.bmNone') + '</p>');
      return;
    }

    const rows = [...allTaxa].map((tx) => {
      const flags = results.map((r) => r.sig.has(tx));
      return { taxon: tx, label: shortTaxonName(tx), flags, count: flags.filter(Boolean).length };
    });

    const scrollDiv = document.createElement('div');
    scrollDiv.className = 'ql-table-scroll';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table';
    const cols = [['label', t('barplots.bmColTaxon')], ...METHODS.map(([m, lbl]) => [m, lbl]), ['count', t('barplots.bmConsColCount')]];
    let thead = '<thead><tr>';
    cols.forEach(([key, lbl]) => {
      const on = bmConsSort.key === key;
      thead += '<th aria-sort="' + (on ? (bmConsSort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '">' +
        '<button type="button" data-sort="' + key + '">' + escapeHtml(lbl) +
        (on ? ' <span aria-hidden="true">' + (bmConsSort.dir === 'asc' ? '▲' : '▼') + '</span>' : '') + '</button></th>';
    });
    tbl.innerHTML = thead + '</tr></thead>';

    const dir = bmConsSort.dir === 'asc' ? 1 : -1;
    const sorted = rows.slice().sort((a, b) => {
      if (bmConsSort.key === 'label') return a.label.localeCompare(b.label) * dir;
      if (bmConsSort.key === 'count') return (a.count - b.count) * dir || a.label.localeCompare(b.label);
      const mi = METHODS.findIndex(([m]) => m === bmConsSort.key);
      return ((a.flags[mi] ? 1 : 0) - (b.flags[mi] ? 1 : 0)) * dir || a.label.localeCompare(b.label);
    });

    const tb = document.createElement('tbody');
    sorted.forEach((r) => {
      const tr = document.createElement('tr');
      let html = '<td>' + escapeHtml(r.label) + '</td>';
      r.flags.forEach((f) => { html += '<td class="ql-num tabular">' + (f ? '<span class="ql-cons-ok">✓</span>' : '<span class="ql-cell-muted">—</span>') + '</td>'; });
      html += '<td class="ql-num tabular"><strong>' + r.count + '</strong> / ' + METHODS.length + '</td>';
      tr.innerHTML = html;
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    scrollDiv.appendChild(tbl);
    tableCard.appendChild(scrollDiv);
    tbl.querySelectorAll('th button[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sort');
        if (bmConsSort.key === key) bmConsSort = { key, dir: bmConsSort.dir === 'asc' ? 'desc' : 'asc' };
        else bmConsSort = { key, dir: key === 'label' ? 'asc' : 'desc' };
        paint();
      });
    });

    const rfR = results[2];
    if (rfR.oobAccuracy != null) {
      tableCard.insertAdjacentHTML('beforeend', '<p class="ql-field-help" style="margin-top:10px;">' + t('barplots.bmRfOob', { pct: (rfR.oobAccuracy * 100).toFixed(1) }) + '</p>');
    }
    const fullConsensus = rows.filter((r) => r.count === METHODS.length).length;
    tableCard.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('barplots.bmConsFull', { n: fullConsensus, m: METHODS.length }) + '</p>');
  }

  function drawBiomarkerBars(svg, mount, chartWrap, tooltip, sig, groups, bmScore) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (sig.length === 0) {
      svg.setAttribute('viewBox', '0 0 400 80');
      const tx = svgEl('text', { x: 200, y: 44, 'text-anchor': 'middle', class: 'ql-axis-label', fill: 'var(--ink-muted)' });
      tx.textContent = t('barplots.bmNone');
      svg.appendChild(tx);
      wasEditing = editor && editor.isEditing ? editor.isEditing() : false;
      if (editor) { editor.destroy(); editor = null; }
      editor = attachChartEditor({ key: 'taxaBiomarkers', svg, mount, filename: t('barplots.bmTitle'), lang: getLang(), elements: [], onReset: () => paint(), startEditing: wasEditing });
      return;
    }
    const labelChars = Math.max(...sig.map((s) => s.label.length), 8);
    const marginL = Math.min(240, 26 + Math.min(labelChars, 34) * 6.3);
    const marginR = 52, marginT = 40;
    const rowH = 24;
    const innerW = 380;
    const barsBottom = marginT + sig.length * rowH;

    // leyenda al pie, envolviendo por filas si no cabe
    const shown = [...new Set(sig.map((s) => s.enrichedIdx))].sort((a, b) => a - b);
    const legItems = shown.map((gi) => ({ gi, text: t('barplots.bmEnrichedIn', { group: groups[gi] }) }));
    const legItemW = (it) => 15 + it.text.length * 6 + 18;
    let legRows = 1, lx = 0;
    legItems.forEach((it) => {
      const w = legItemW(it);
      if (lx + w > innerW + marginR && lx > 0) { legRows++; lx = 0; }
      it._x = lx; it._row = legRows - 1; lx += w;
    });

    const tickY = barsBottom + 15;
    const axisY = tickY + 16;
    const legY = axisY + 12;
    const marginB = (legY - barsBottom) + legRows * 15 + 6;
    const W = marginL + innerW + marginR;
    const H = marginT + sig.length * rowH + marginB;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.style.width = '';
    svg.style.maxWidth = '';

    const scoreOf = (s) => (bmScore === 'lda' ? s.ldaScore : bmScore === 'ancom' ? s.ancomLog2FC : bmScore === 'rf' ? s.rfImportance : s.delta);
    const maxAbs = Math.max(...sig.map((s) => Math.abs(scoreOf(s))), 0.2);
    // orden de las filas y rango del eje (Ajustes > Estructura); 'original' =
    // el orden ya calculado (score descendente), rango por defecto 0..máximo
    const bmso = getFigureOptions('taxaBiomarkers');
    {
      const byLabel = new Map(sig.map((s) => [s.label, s]));
      sig = orderCategories(sig.map((s) => s.label), (k) => Math.abs(scoreOf(byLabel.get(k))), bmso.categoryOrder).map((k) => byLabel.get(k));
    }
    const xLo = bmso.axisXMin != null ? bmso.axisXMin : 0, xHi = bmso.axisXMax != null ? bmso.axisXMax : maxAbs;
    const x = (d) => marginL + ((Math.abs(d) - xLo) / ((xHi - xLo) || 1)) * innerW;
    const bmClip = plotClip(svg, 'ql-clip-bm', marginL, marginT - 6, innerW, barsBottom - marginT + 6);

    // rejilla vertical + eje
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const dv = xLo + (i / ticks) * (xHi - xLo);
      const xx = marginL + (i / ticks) * innerW;
      svg.appendChild(svgEl('line', { x1: xx, x2: xx, y1: marginT - 6, y2: barsBottom, class: 'ql-gridline' }));
      const tk = svgEl('text', { x: xx, y: tickY, class: 'ql-tick-label', 'text-anchor': 'middle' });
      tk.textContent = dv.toFixed(2);
      svg.appendChild(tk);
    }
    svg.appendChild(svgEl('line', { x1: marginL, x2: marginL, y1: marginT - 6, y2: barsBottom, class: 'ql-baseline-line' }));

    const axT = svgEl('text', { x: marginL + innerW / 2, y: axisY, class: 'ql-axis-label', 'text-anchor': 'middle', 'data-ce': 'xtitle' });
    axT.textContent = bmScore === 'lda' ? t('barplots.bmAxisLda') : bmScore === 'ancom' ? t('barplots.bmAxisAncom') : bmScore === 'rf' ? t('barplots.bmAxisRf') : t('barplots.bmAxisDelta');
    svg.appendChild(axT);
    const yTb = svgEl('text', {
      x: 14, y: marginT + (barsBottom - marginT) / 2, class: 'ql-axis-label', 'text-anchor': 'middle',
      transform: 'rotate(-90 14 ' + (marginT + (barsBottom - marginT) / 2) + ')', 'data-ce': 'ytitle',
    });
    yTb.textContent = t('barplots.axisTaxa');
    svg.appendChild(yTb);

    const barsG = svgEl('g', { 'data-ce': 'bars' });
    const labelsG = svgEl('g', { 'data-ce': 'labels' });
    sig.forEach((s, i) => {
      const y = marginT + i * rowH;
      const bh = rowH - 8;
      const sv = scoreOf(s);
      const w = Math.max(1.5, x(sv) - marginL);
      const rect = svgEl('rect', {
        x: marginL, y: y + 3, width: w, height: bh, rx: 2, 'data-ce-role': 'barh', 'clip-path': bmClip,
        fill: groupColor(s.enrichedIdx), 'fill-opacity': 0.85,
        'data-ce-series-fill': 's' + s.enrichedIdx,
      });
      rect.addEventListener('mouseenter', () => {
        showTooltipCentral(chartWrap, marginL + w, y + rowH / 2, s.label, [
          t('barplots.bmEnrichedIn', { group: s.enrichedGroup }) +
          ' · δ = ' + s.delta.toFixed(3) + (s.ldaScore == null ? '' : ' · LDA = ' + s.ldaScore.toFixed(3)) +
          (s.ancomLog2FC == null ? '' : ' · log2FC = ' + s.ancomLog2FC.toFixed(3)) +
          (s.rfImportance == null ? '' : ' · importancia = ' + s.rfImportance.toFixed(4)) +
          (s.q == null ? '' : ' · q = ' + formatP(s.q)),
        ], { svg, W, H, tooltip });
      });
      rect.addEventListener('mouseleave', () => hideTooltip(tooltip));
      barsG.appendChild(rect);

      const lt = svgEl('text', { x: marginL - 8, y: y + rowH / 2 + 3, class: 'ql-tick-label', 'text-anchor': 'end' });
      lt.textContent = s.label.length > 34 ? s.label.slice(0, 33) + '…' : s.label;
      labelsG.appendChild(lt);

      const vt = svgEl('text', { x: marginL + w + 5, y: y + rowH / 2 + 3, class: 'ql-tick-label' });
      vt.textContent = sv.toFixed(2);
      barsG.appendChild(vt);
    });
    svg.appendChild(barsG);
    svg.appendChild(labelsG);

    // leyenda al pie: grupos que aparecen como "enriquecido"
    const legG = svgEl('g', { 'data-ce': 'legend' });
    legItems.forEach((it) => {
      const xx = it._x, yy = it._row * 15;
      legG.appendChild(svgEl('rect', { x: xx, y: yy - 8, width: 10, height: 10, rx: 2, fill: groupColor(it.gi), 'data-ce-series-fill': 's' + it.gi }));
      const lt = svgEl('text', { x: xx + 15, y: yy, class: 'ql-tick-label' });
      lt.textContent = it.text;
      legG.appendChild(lt);
    });
    legG.setAttribute('transform', 'translate(' + marginL + ',' + legY + ')');
    svg.appendChild(legG);

    wasEditing = editor && editor.isEditing ? editor.isEditing() : false;
    if (editor) { editor.destroy(); editor = null; }
    editor = attachChartEditor({
      key: 'taxaBiomarkers', svg, mount, filename: t('barplots.bmTitle'), lang: getLang(),
      elements: [
        { id: 'title', create: { text: t('barplots.bmTitle'), x: W / 2, y: 22, anchor: 'middle', cls: 'ce-title' } },
        { id: 'xtitle', selector: '[data-ce="xtitle"]' },
        { id: 'ytitle', selector: '[data-ce="ytitle"]' },
        { id: 'labels', selector: '[data-ce="labels"]', kind: 'group' },
        { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
      ],
      paletteSeries: groups.map((g, i) => ({ id: 's' + i, label: g })),
      paletteType: 'categorical',
      figureOptions: { axisX: { domain: [0, maxAbs] }, categoryOrder: true },
      onFigureOptionsChange: () => paint(),
      onReset: () => paint(),
      startEditing: wasEditing,
    });
  }

  function showTooltip(sampleId, taxonLabel, val, cx, cy, wrap, svgEl_, W, H, tooltipEl) {
    showTooltipCentral(wrap, cx, cy, sampleId, taxonLabel + ' · ' + (val * 100).toFixed(2) + '%', {
      svg: svgEl_, W, H, tooltip: tooltipEl,
    });
  }

  function showAlluvialTooltip(taxonLabel, detailHtml, cx, cy, wrap, svgEl_, W, H, tooltipEl) {
    showTooltipCentral(wrap, cx, cy, taxonLabel, detailHtml, {
      svg: svgEl_, W, H, tooltip: tooltipEl, rawHtml: true,
    });
  }

  paint();
  const stop = subscribe(paint);
  return () => { stop(); if (editor) { editor.destroy(); editor = null; } };
}
