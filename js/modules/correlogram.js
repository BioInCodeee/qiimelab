// Correlograma: matriz de correlación (Pearson o Spearman) entre las
// variables numéricas que ya haya cargadas — columnas numéricas de los
// metadatos, abundancia relativa de los taxones más abundantes (mismo
// criterio "top N" que el barplot) y métricas de diversidad alfa.
//
// Dos vistas sobre el MISMO cálculo (una sola pasada de pearson/spearman):
//   · «Matriz»: mapa de calor divergente + tabla de todas las parejas.
//   · «Red»:    grafo de co-ocurrencia — nodos = variables, aristas = parejas
//               que superan los umbrales |r| y p, disposición por fuerzas
//               determinista (js/lib/forceLayout.js, semilla fija).
//
// Entrada: state.metadata + state.taxaBarplot|state.taxaCounts +
//          state.alphaDiversity (cualquier combinación; mínimo 2 variables).
// No consume datos propios: reutiliza lo que cargan los demás módulos.

import { state, subscribe } from '../state.js';
import { t, getLang } from '../lib/i18n.js';
import { pearson, spearman, formatP, upgma, leafOrder } from '../lib/stats.js';
import { orderCategories } from '../lib/categoryOrder.js';
import { matchSampleId } from '../lib/sampleMatch.js';
import { taxaRelativeAbundance } from '../lib/taxaAbundance.js';
import { attachChartEditor, getColorScaleOptions, getStatsOptions, getFigureOptions } from '../lib/chartEditor.js';
import { formatPStyled } from '../lib/pFormat.js';
import { makeColorScale } from '../lib/colorScale.js';
import { paletteColorsOf } from '../lib/palettes.js';
import { forceLayout } from '../lib/forceLayout.js';
import { loadExampleCommunityData, loadRealCommunityData, mountExampleButtons } from '../lib/exampleData.js';
import { svgEl, escapeHtml, delegateHover } from '../lib/dom.js';
import { showTooltip, hideTooltip } from '../lib/tooltip.js';
import { chartTypeField } from '../lib/chartTypeSelector.js';
import { arcPath, polarPoint } from '../lib/sunburst.js';
import { correlogramScript } from '../lib/rScriptBuilders.js';
import { R_EMBED_MAX_ROWS } from '../lib/rScript.js';
import { noteMethods } from '../lib/reportLog.js';

const NET_SEED = 0x9E3779B9; // semilla fija → layout de fuerzas determinista

const TOP_N_DEFAULT = 7, TOP_N_MIN = 3, TOP_N_MAX = 20;
const NUM_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function shortTaxon(full) {
  const parts = String(full).split(';').map((p) => p.trim()).filter(Boolean);
  return (parts[parts.length - 1] || String(full)).replace(/^[a-z]__/i, '') || String(full);
}

// muestra → valor, tolerante a sufijos en los IDs (A-1 ↔ A-1-16S-…)
function resolve(vmap, sid) {
  const k = matchSampleId(vmap.keys(), sid);
  return k == null ? undefined : vmap.get(k);
}

// --- recolectar variables numéricas de lo que haya en el estado ---
function collectVariables(topN) {
  const vars = [];

  // 1. columnas numéricas de los metadatos
  if (state.metadata) {
    const idKey = state.metadata.sampleIdKey;
    state.metadata.headers.filter((h) => h !== idKey).forEach((col) => {
      const vals = new Map();
      let seen = 0;
      state.metadata.rows.forEach((r) => {
        const raw = r[col];
        if (raw == null || String(raw).trim() === '') return;
        seen++;
        const s = String(raw).trim();
        if (NUM_RE.test(s)) vals.set(String(r[idKey]).trim(), parseFloat(s));
      });
      if (vals.size >= 3 && vals.size >= seen * 0.6) {
        vars.push({ id: 'meta:' + col, label: col, group: 'meta', values: vals });
      }
    });
  }

  // 2. abundancia relativa de los taxones top-N (criterio del barplot)
  const relByTaxon = taxaRelativeAbundance();
  if (relByTaxon) {
    relByTaxon.ranked.slice(0, topN).forEach((taxon) => {
      vars.push({
        id: 'taxon:' + taxon, label: shortTaxon(taxon), group: 'taxon',
        values: relByTaxon.bySample[taxon],
      });
    });
  }

  // 3. métricas de diversidad alfa
  if (state.alphaDiversity) {
    Object.entries(state.alphaDiversity.metrics).forEach(([name, m]) => {
      const vals = new Map();
      Object.entries(m.values).forEach(([sid, v]) => {
        if (typeof v === 'number' && isFinite(v)) vals.set(String(sid).trim(), v);
      });
      if (vals.size >= 3) vars.push({ id: 'alpha:' + name, label: name, group: 'alpha', values: vals });
    });
  }

  return vars;
}

// Estrellas para las TABLAS (matriz y red) — siempre estrellas, sin badge
// "ns" para las no significativas (silencioso como antes). Delega en el
// formateador de p de la Fase 0 en vez de reimplementar el mapeo de
// umbrales (Paso 5 de qiimelab-prompt-editor-fase-1-anotaciones-
// estadisticas.md): cambia el carácter '∗'→'*' y el umbral '<'→'≤'
// respecto a la versión anterior, alineado con el resto de la app
// (mannWhitneyU/dunnTest en groupBoxplot.js ya usan este mismo umbral).
function stars(p) {
  return formatPStyled(p, { style: 'gp', mode: 'stars', ns: '' });
}

/** Anotación de la CELDA del mapa de calor — configurable (asteriscos/p
 *  exacto/ambos, estilo Prism, umbral) vía las opciones persistidas del
 *  editor de gráficos (mismo store.__stats que groupBoxplot.js). Por
 *  defecto (nada personalizado) el umbral 0.05 ya oculta las no
 *  significativas, así que "ns" nunca se ve salvo que el usuario suba el
 *  umbral a propósito. */
function cellAnnotation(p, statsOpts) {
  const threshold = statsOpts.threshold != null ? statsOpts.threshold : 0.05;
  if (!isFinite(p) || p > threshold) return '';
  return formatPStyled(p, { style: statsOpts.style || 'gp', mode: statsOpts.mode || 'stars' });
}

export function render(container) {
  let method = 'pearson';        // 'pearson' | 'spearman' — compartido por las dos vistas
  let topN = TOP_N_DEFAULT;
  let selected = null;           // Set de ids de variable; null = aún sin inicializar
  let view = 'matrix';           // 'matrix' | 'network'
  let matrixStyle = 'heatmap';   // 'heatmap' | 'bubbles' | 'pie' — solo aplica dentro de view === 'matrix'
  let matrixLayout = 'rect';     // 'rect' | 'circular' — solo para el mapa de calor (reproyección polar de la misma matriz)
  let splitHalves = false;       // matriz partida: ▲ superior = método elegido, ▼ inferior = el otro (Fase 3, C2)
  let rThresh = 0.3;             // |r| mínimo para dibujar una arista (solo vista red)
  let pThresh = 0.05;            // p máximo (solo vista red)
  let netSort = { key: 'r', dir: 'desc' };
  let rScriptCfg = null;         // "Descargar script R" — mismo cálculo para las tres figuras (ver paint())
  let editor = null;
  let wasEditing = false; // ver cfg.startEditing en chartEditor.js — capturado en paint() antes de
                           // destruir el editor, leído por renderMatrix/renderNetwork (funciones
                           // hermanas de paint(), no anidadas) al recrearlo

  function paint() {
    // ver cfg.startEditing en chartEditor.js: sin esto, cada repintado
    // disparado DESDE DENTRO del propio editor (escala de color,
    // "Restablecer"…) cerraría el panel "Personalizar" de golpe.
    wasEditing = editor && editor.isEditing ? editor.isEditing() : false;
    if (editor) { editor.destroy(); editor = null; }
    container.innerHTML = '';

    const header = document.createElement('header');
    header.className = 'ql-page-header';
    header.innerHTML =
      '<p class="ql-eyebrow">' + t('correlogram.eyebrow') + '</p>' +
      '<h1 class="ql-page-title">' + t('correlogram.title') + '</h1>' +
      '<p class="ql-page-sub">' + t('correlogram.subtitle') + '</p>';
    container.appendChild(header);

    const available = collectVariables(topN);

    if (available.length < 2) {
      const card = document.createElement('div');
      card.className = 'ql-card ql-panel';
      card.innerHTML =
        '<div class="ql-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' +
        '<h3>' + t('correlogram.emptyTitle') + '</h3><p>' + t('correlogram.emptyDesc') + '</p>' +
        '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;"><a href="#/cargar" class="ql-btn">' + t('ui.goLoadData') + '</a></div></div>';
      container.appendChild(card);
      mountExampleButtons(card.querySelector('.ql-empty'), {
        real: loadRealCommunityData,
        synthetic: loadExampleCommunityData,
        download: ['metadata', 'barplot', 'shannon'],
      });
      return;
    }

    const availIds = available.map((v) => v.id);
    if (selected === null) {
      // primera vez: metadatos + alfa + hasta 5 taxones, para no arrancar gigante
      selected = new Set();
      let taxaAdded = 0;
      available.forEach((v) => {
        if (v.group === 'taxon') { if (taxaAdded < 5) { selected.add(v.id); taxaAdded++; } }
        else selected.add(v.id);
      });
    } else {
      // limpiar ids que ya no existen (p. ej. bajó el top-N)
      [...selected].forEach((id) => { if (!availIds.includes(id)) selected.delete(id); });
    }

    // ---- pestañas: Matriz | Red ----
    const tabs = document.createElement('div');
    tabs.className = 'ql-tabs';
    [['matrix', t('correlogram.tabMatrix')], ['network', t('correlogram.tabNetwork')]].forEach(([v, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-tab' + (view === v ? ' is-active' : '');
      b.textContent = label;
      b.addEventListener('click', () => { if (view !== v) { view = v; paint(); } });
      tabs.appendChild(b);
    });
    container.appendChild(tabs);

    const grid = document.createElement('div');
    grid.className = 'ql-grid-2';

    // ---- panel del gráfico ----
    const chartPanel = document.createElement('section');
    chartPanel.className = 'ql-card ql-panel';
    chartPanel.innerHTML = '<p class="ql-panel-note" style="margin-bottom:4px;">' +
      t(view === 'network' ? 'correlogram.netNote' : (matrixStyle === 'bubbles' ? 'correlogram.bubbleNote' : matrixStyle === 'pie' ? 'correlogram.pieNote' : 'correlogram.chartNote')) + '</p>';
    const chartWrap = document.createElement('div');
    chartWrap.className = 'ql-chartwrap' + (view === 'matrix' ? ' scroll-x' : '');
    const svg = svgEl('svg', {
      class: 'ql-svg', role: 'img',
      'aria-label': t(view === 'network' ? 'a11y.chartNetwork' : 'a11y.chartCorrelogram'),
    });
    const tooltip = document.createElement('div');
    tooltip.className = 'ql-tooltip';
    chartWrap.appendChild(svg); chartWrap.appendChild(tooltip);
    chartPanel.appendChild(chartWrap);
    grid.appendChild(chartPanel);

    // ---- panel de controles ----
    const controls = document.createElement('aside');
    controls.className = 'ql-card ql-panel';
    controls.innerHTML = '<h2>' + t('ui.controls') + '</h2>';

    // método (compartido por las dos vistas)
    const mField = document.createElement('div');
    mField.className = 'ql-field';
    mField.innerHTML = '<label>' + t('correlogram.methodLabel') + '</label>';
    const seg = document.createElement('div');
    seg.className = 'ql-segmented';
    [['pearson', t('correlogram.pearson')], ['spearman', t('correlogram.spearman')]].forEach(([val, lbl]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-seg-btn' + (method === val ? ' is-on' : '');
      b.textContent = lbl;
      b.addEventListener('click', () => { if (method !== val) { method = val; paint(); } });
      seg.appendChild(b);
    });
    mField.appendChild(seg);
    mField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('correlogram.methodHelp') + '</p>');
    controls.appendChild(mField);

    if (view === 'matrix') {
      controls.appendChild(chartTypeField({
        labelKey: 'correlogram.matrixStyleLabel',
        options: [
          { value: 'heatmap', labelKey: 'correlogram.matrixStyleHeatmap' },
          { value: 'bubbles', labelKey: 'correlogram.matrixStyleBubbles' },
          { value: 'pie', labelKey: 'correlogram.matrixStylePie' },
        ],
        active: matrixStyle,
        onChange: (v) => { matrixStyle = v; paint(); },
        helpKey: 'correlogram.matrixStyleHelp',
      }));
      // disposición: solo el mapa de calor (burbujas/sectores ya son glifos
      // dentro de una celda cuadrada; en un sector anular no se leerían)
      if (matrixStyle === 'heatmap') {
        controls.appendChild(chartTypeField({
          labelKey: 'correlogram.layoutLabel',
          options: [
            { value: 'rect', labelKey: 'correlogram.layoutRect' },
            { value: 'circular', labelKey: 'correlogram.layoutCircular' },
          ],
          active: matrixLayout,
          onChange: (v) => { matrixLayout = v; paint(); },
          helpKey: matrixLayout === 'circular' ? 'correlogram.layoutCircularHelp' : undefined,
        }));
      }
      const other = method === 'pearson' ? 'spearman' : 'pearson';
      const nameOf = (m) => t(m === 'pearson' ? 'correlogram.pearson' : 'correlogram.spearman');
      controls.appendChild(chartTypeField({
        labelKey: 'correlogram.splitLabel',
        options: [
          { value: 'off', label: t('correlogram.splitOff') },
          { value: 'on', label: t('correlogram.splitOn', { a: nameOf(method), b: nameOf(other) }) },
        ],
        active: splitHalves ? 'on' : 'off',
        onChange: (v) => { splitHalves = v === 'on'; paint(); },
        helpKey: 'correlogram.splitHelp',
      }));
    }

    // umbrales de la red (solo en la vista de red)
    if (view === 'network') {
      const thr = document.createElement('div');
      thr.className = 'ql-field';
      thr.innerHTML = '<label for="clR">' + t('correlogram.rThreshLabel') + '</label>' +
        '<div class="ql-inputrow">' +
        '<input type="range" aria-label="' + escapeHtml(t('correlogram.rThreshLabel')) + '" id="clRr" min="0" max="0.95" step="0.05" value="' + rThresh + '" />' +
        '<input type="number" id="clR" class="ql-num-small tabular" min="0" max="1" step="0.05" value="' + rThresh + '" /></div>' +
        '<label for="clP" style="margin-top:10px;">' + t('correlogram.pThreshLabel') + '</label>' +
        '<div class="ql-inputrow">' +
        '<input type="range" aria-label="' + escapeHtml(t('correlogram.pThreshLabel')) + '" id="clPr" min="0.001" max="1" step="0.001" value="' + pThresh + '" />' +
        '<input type="number" id="clP" class="ql-num-small tabular" min="0.0001" max="1" step="0.001" value="' + pThresh + '" /></div>' +
        '<p class="ql-field-help">' + t('correlogram.netThreshHelp') + '</p>';
      controls.appendChild(thr);
      const rR = thr.querySelector('#clRr'), rN = thr.querySelector('#clR');
      const pR = thr.querySelector('#clPr'), pN = thr.querySelector('#clP');
      const applyR = (val) => {
        const nv = Math.max(0, Math.min(1, Number(val)));
        if (isFinite(nv) && nv !== rThresh) { rThresh = nv; paint(); }
      };
      const applyP = (val) => {
        const nv = Math.max(0.0001, Math.min(1, Number(val)));
        if (isFinite(nv) && nv !== pThresh) { pThresh = nv; paint(); }
      };
      rR.addEventListener('input', () => { rN.value = rR.value; });
      rR.addEventListener('change', () => applyR(rR.value));
      rN.addEventListener('change', () => applyR(rN.value));
      pR.addEventListener('input', () => { pN.value = pR.value; });
      pR.addEventListener('change', () => applyP(pR.value));
      pN.addEventListener('change', () => applyP(pN.value));
    }

    // top-N de taxones (solo si hay taxones disponibles)
    if (available.some((v) => v.group === 'taxon')) {
      const tField = document.createElement('div');
      tField.className = 'ql-field';
      tField.innerHTML = '<label for="clTopN">' + t('correlogram.topNLabel') + '</label>' +
        '<div class="ql-inputrow">' +
        '<input type="range" aria-label="' + escapeHtml(t('correlogram.topNLabel')) + '" id="clTopNr" min="' + TOP_N_MIN + '" max="' + TOP_N_MAX + '" step="1" value="' + topN + '" />' +
        '<input type="number" id="clTopN" class="ql-num-small tabular" min="' + TOP_N_MIN + '" max="' + TOP_N_MAX + '" step="1" value="' + topN + '" /></div>' +
        '<p class="ql-field-help">' + t('correlogram.topNHelp') + '</p>';
      controls.appendChild(tField);
      const apply = (v) => {
        const nv = Math.max(TOP_N_MIN, Math.min(TOP_N_MAX, Math.round(Number(v) || TOP_N_DEFAULT)));
        if (nv !== topN) { topN = nv; paint(); }
      };
      const rEl = tField.querySelector('#clTopNr'), nEl = tField.querySelector('#clTopN');
      rEl.addEventListener('input', () => { nEl.value = rEl.value; });
      rEl.addEventListener('change', () => apply(rEl.value));
      nEl.addEventListener('change', () => apply(nEl.value));
    }

    // checklist de variables, agrupada
    const vField = document.createElement('div');
    vField.className = 'ql-field';
    vField.innerHTML = '<label>' + t('correlogram.varsLabel') + ' (' + selected.size + ')</label>';
    const groups = [['meta', t('correlogram.grpMeta')], ['taxon', t('correlogram.grpTaxa')], ['alpha', t('correlogram.grpAlpha')]];
    groups.forEach(([g, glabel]) => {
      const inGroup = available.filter((v) => v.group === g);
      if (inGroup.length === 0) return;
      const gh = document.createElement('div');
      gh.className = 'ql-checkgroup-h';
      gh.textContent = glabel;
      vField.appendChild(gh);
      inGroup.forEach((v) => {
        const row = document.createElement('label');
        row.className = 'ql-checkrow';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selected.has(v.id);
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(v.id); else selected.delete(v.id);
          paint();
        });
        row.appendChild(cb);
        row.appendChild(document.createTextNode(' ' + v.label));
        vField.appendChild(row);
      });
    });
    controls.appendChild(vField);

    // enlace discreto al script de R
    const rNote = document.createElement('p');
    rNote.className = 'ql-field-help';
    rNote.style.marginTop = '14px';
    rNote.innerHTML = t('correlogram.rNote') + ' <a href="#/recursos">' + t('correlogram.rLink') + '</a>.';
    controls.appendChild(rNote);

    grid.appendChild(controls);
    container.appendChild(grid);

    // ---- tabla ----
    const tableCard = document.createElement('section');
    tableCard.className = 'ql-card ql-panel';
    tableCard.style.marginTop = '20px';
    tableCard.innerHTML = '<h2>' + t(view === 'network' ? 'correlogram.netTableTitle' : 'correlogram.tableTitle') + '</h2>';
    container.appendChild(tableCard);

    const chosen = available.filter((v) => selected.has(v.id));
    if (chosen.length < 2) {
      chartPanel.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('correlogram.pickTwo') + '</p>');
      return;
    }

    // ---- universo de muestras + arrays alineados (compartido por las dos vistas) ----
    let universe;
    if (state.metadata) {
      universe = state.metadata.rows.map((r) => String(r[state.metadata.sampleIdKey]).trim()).filter(Boolean);
    } else {
      const set = new Set();
      chosen.forEach((v) => v.values.forEach((_, k) => set.add(k)));
      universe = [...set];
    }
    const aligned = chosen.map((v) => universe.map((sid) => {
      const val = resolve(v.values, sid);
      return (typeof val === 'number' && isFinite(val)) ? val : NaN;
    }));

    // ---- UNA sola pasada de correlación (idéntica a la que ya rellenaba la matriz) ----
    const k = chosen.length;
    const results = Array.from({ length: k }, () => new Array(k).fill(null));
    // matriz partida (Fase 3, C2): el OTRO método se calcula en la misma
    // pasada, sobre exactamente las mismas parejas de muestras
    const split = view === 'matrix' && splitHalves;
    const method2 = method === 'pearson' ? 'spearman' : 'pearson';
    const results2 = split ? Array.from({ length: k }, () => new Array(k).fill(null)) : null;
    noteMethods('correlograma', split ? [method, method2] : [method]); // informe completo
    let nMin = Infinity, nMax = 0;
    for (let i = 0; i < k; i++) {
      for (let j = i; j < k; j++) {
        if (i === j) {
          results[i][j] = { r: 1, p: NaN, n: aligned[i].filter(isFinite).length };
          if (split) results2[i][j] = results[i][j];
          continue;
        }
        const x = [], y = [];
        for (let s = 0; s < universe.length; s++) {
          if (isFinite(aligned[i][s]) && isFinite(aligned[j][s])) { x.push(aligned[i][s]); y.push(aligned[j][s]); }
        }
        const res = x.length >= 3 ? (method === 'pearson' ? pearson(x, y) : spearman(x, y)) : { r: NaN, p: NaN, n: x.length };
        results[i][j] = res; results[j][i] = res;
        if (split) {
          const res2 = x.length >= 3 ? (method2 === 'pearson' ? pearson(x, y) : spearman(x, y)) : { r: NaN, p: NaN, n: x.length };
          results2[i][j] = res2; results2[j][i] = res2;
        }
        if (isFinite(res.r)) { nMin = Math.min(nMin, res.n); nMax = Math.max(nMax, res.n); }
      }
    }
    const nLabel = nMin === Infinity ? '—' : (nMin === nMax ? String(nMin) : nMin + '–' + nMax);

    // "Descargar script R": las mismas variables alineadas sobre el mismo
    // universo de muestras y el mismo método (o los dos, en la matriz partida)
    rScriptCfg = {
      build: () => {
        const so = getStatsOptions('correlogram');
        return correlogramScript({
          methods: split ? [method, method2] : [method],
          sampleIds: universe,
          vars: chosen.map((v, i) => ({ label: v.label, values: aligned[i] })),
          threshold: view === 'network' ? pThresh : (so.threshold != null ? so.threshold : 0.05),
          rMin: view === 'network' ? rThresh : null,
        });
      },
      hasDataFiles: universe.length > R_EMBED_MAX_ROWS,
    };

    const ctx = { svg, chartPanel, chartWrap, tooltip, tableCard, chosen, results, results2, method2, k, nLabel };
    if (view === 'network') renderNetwork(ctx);
    else renderMatrix(ctx);
  }

  // =====================================================================
  //  VISTA MATRIZ — mapa de calor divergente + tabla de todas las parejas
  // =====================================================================
  function renderMatrix(ctx) {
    const { svg, chartPanel, chartWrap, tooltip, tableCard, k, nLabel } = ctx;
    let { chosen, results, results2 } = ctx;
    const { method2 } = ctx;
    const nameOf = (m) => t(m === 'pearson' ? 'correlogram.pearson' : 'correlogram.spearman');
    // celda (i,j): con la matriz partida, el triángulo inferior (i>j) sale
    // del segundo método; el superior y la diagonal, del elegido
    const resAt = (i, j) => (results2 && i > j ? results2[i][j] : results[i][j]);
    const isCircular = matrixStyle === 'heatmap' && matrixLayout === 'circular';
    const ceKey = matrixStyle === 'bubbles' ? 'correlogram-bubbles' : matrixStyle === 'pie' ? 'correlogram-pie' : isCircular ? 'correlogram-circular' : 'correlogram';

    // orden de las variables (Ajustes > Estructura). Se permutan a la vez la
    // lista y la matriz de resultados, así todo lo de abajo (celdas, etiquetas,
    // tooltips) sigue siendo coherente. 'cluster' = clustering jerárquico UPGMA
    // con distancia 1-|r| (el orden 'hclust' habitual de corrplot).
    {
      const mode = getFigureOptions(ceKey).categoryOrder;
      if (mode && mode !== 'original' && k > 1) {
        const SEP = '\u0001';
        const names = chosen.map((v, i) => v.label + SEP + i);
        const idxOf = (nm) => +nm.split(SEP).pop();
        const meanAbs = (nm) => {
          const i = idxOf(nm); let sum = 0, cnt = 0;
          for (let j = 0; j < k; j++) if (j !== i && isFinite(results[i][j].r)) { sum += Math.abs(results[i][j].r); cnt++; }
          return cnt ? sum / cnt : NaN;
        };
        let clusterOrder = null;
        if (mode === 'cluster' && k > 2) {
          const D = results.map((row, i) => row.map((r, j) => (i === j ? 0 : (isFinite(r.r) ? 1 - Math.abs(r.r) : 1))));
          clusterOrder = leafOrder(upgma(D, names));
          noteMethods('correlograma', 'upgma');
        }
        const perm = orderCategories(names, meanAbs, mode, clusterOrder).map(idxOf);
        const oldChosen = chosen, oldResults = results;
        chosen = perm.map((i) => oldChosen[i]);
        results = perm.map((i) => perm.map((j) => oldResults[i][j]));
        if (results2) { const old2 = results2; results2 = perm.map((i) => perm.map((j) => old2[i][j])); }
      }
    }

    if (isCircular) {
      drawCircular({ svg, chartPanel, chartWrap, tooltip, k, chosen, resAt, method, method2, nameOf, split: !!results2, ceKey });
      chartPanel.insertAdjacentHTML('beforeend',
        '<p class="ql-field-help" style="margin-top:6px;">' +
        t('correlogram.figMeta', { method: nameOf(method), k, n: nLabel }) + '</p>');
      renderPairsTable();
      return;
    }

    const cell = Math.max(16, Math.min(34, 560 / k));
    const labelChars = Math.max(...chosen.map((v) => v.label.length));
    const marginL = Math.min(200, 30 + labelChars * 6.2);
    const marginR = 16;
    const marginT = 44;
    const marginB = Math.min(180, 30 + labelChars * 6.2 * 0.72) + 54 + 18; // etiquetas rotadas + título X + leyenda
    const gridS = cell * k;
    const W = Math.max(marginL + gridS + marginR, 420);
    const H = marginT + gridS + marginB;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.style.width = W + 'px';
    svg.style.maxWidth = 'none';
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const isBubbles = matrixStyle === 'bubbles';
    const isPie = matrixStyle === 'pie';
    // burbujas y sectores son "glifos": color por signo + tamaño/ángulo =
    // magnitud, sin escala continua ni anotación de p en la celda
    const isGlyph = isBubbles || isPie;
    const statsOpts = getStatsOptions('correlogram');
    // escala de color continua compartida (Paso 2 de qiimelab-prompt-
    // editor-fase-3-heatmaps-escalas-continuas.md) — dominio FIJO [-1,1]
    // (r no puede salirse de ahí por definición, a diferencia del dominio
    // de beta que depende de los datos), editable igualmente desde el
    // panel. La diagonal (r=1 fijo, "no aplica") se queda FUERA de la
    // escala a propósito — usa --corr-diag, un token CSS propio (no la
    // escala de datos, que no tiene sentido fijada en r=1 siempre).
    const csOv = getColorScaleOptions('correlogram');
    const colorScale = isGlyph ? null : makeColorScale({
      type: 'divergent',
      domain: [csOv.domainMin != null ? csOv.domainMin : -1, csOv.domainMax != null ? csOv.domainMax : 1],
      midpoint: csOv.midpoint != null ? csOv.midpoint : 0,
      range: paletteColorsOf(csOv.paletteId || 'app:divergent'),
      steps: csOv.steps, invert: csOv.invert,
    });
    // controles de celda (Paso 4): "valor en celda" hace toggle de la
    // anotación de estrellas/p que antes era incondicional (por defecto
    // sigue apareciendo, ver defaultShowValue ausente = true). "Borde de
    // celda": nuevo, solo aplica al modo mapa de calor (bubbles ya tiene su
    // propio borde fijo var(--gridline) entre celdas).
    const showValue = csOv.showValue !== false;
    const cellBorder = !isGlyph ? (csOv.cellBorder || null) : null;
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        const res = resAt(i, j);
        const isDiag = i === j;
        const x = marginL + j * cell, y = marginT + i * cell;
        const rect = svgEl('rect', {
          x, y, width: cell - 1.5, height: cell - 1.5, rx: 2, 'data-ce-role': 'cell',
          fill: isDiag ? 'var(--corr-diag)' : (isGlyph ? 'var(--surface)' : (colorScale.scale(res.r) || 'var(--corr-zero)')),
          stroke: (isGlyph && !isDiag) ? 'var(--gridline)' : (cellBorder ? cellBorder.color : undefined),
          'stroke-width': cellBorder ? cellBorder.width : undefined,
          ...(isDiag ? {} : { 'data-i': i, 'data-j': j }),
        });
        svg.appendChild(rect);

        if (!isDiag && isPie) {
          // sector (tipo "pie" de corrplot): ángulo = |r|·360° desde las 12,
          // en sentido horario si r>0 y antihorario si r<0, sobre un círculo
          // guía; color por signo (mismos pos/neg que las burbujas)
          if (isFinite(res.r)) {
            const R = (cell - 1.5) / 2 - 1.5;
            const cx = x + (cell - 1.5) / 2, cy = y + (cell - 1.5) / 2;
            const col = res.r >= 0 ? 'var(--corr-pos)' : 'var(--corr-neg)';
            const sid = res.r >= 0 ? 'pos' : 'neg';
            svg.appendChild(svgEl('circle', { cx, cy, r: R, fill: 'none', stroke: 'var(--gridline)', 'stroke-width': 1, 'pointer-events': 'none' }));
            const a = Math.min(1, Math.abs(res.r)) * 2 * Math.PI;
            if (a >= 2 * Math.PI - 1e-6) {
              svg.appendChild(svgEl('circle', { cx, cy, r: R, fill: col, 'fill-opacity': 0.82, 'data-ce-series-fill': sid, 'data-ce-role': 'marker', 'pointer-events': 'none' }));
            } else if (a > 1e-3) {
              const dir = res.r >= 0 ? 1 : -1;
              const ex = cx + dir * R * Math.sin(a), ey = cy - R * Math.cos(a);
              const d = 'M' + cx + ',' + cy + ' L' + cx + ',' + (cy - R) +
                ' A' + R + ',' + R + ' 0 ' + (a > Math.PI ? 1 : 0) + ' ' + (dir > 0 ? 1 : 0) + ' ' + ex.toFixed(2) + ',' + ey.toFixed(2) + ' Z';
              svg.appendChild(svgEl('path', { d, fill: col, 'fill-opacity': 0.82, 'data-ce-series-fill': sid, 'data-ce-role': 'marker', 'pointer-events': 'none', class: 'ql-corr-pie' }));
            }
          }
        } else if (!isDiag && isBubbles) {
          if (isFinite(res.r)) {
            const cMax = (cell - 1.5) / 2 - 1.5;
            const r = Math.max(1.5, cMax * Math.sqrt(Math.min(1, Math.abs(res.r))));
            svg.appendChild(svgEl('circle', {
              cx: x + (cell - 1.5) / 2, cy: y + (cell - 1.5) / 2, r,
              fill: res.r >= 0 ? 'var(--corr-pos)' : 'var(--corr-neg)', 'fill-opacity': 0.82,
              'data-ce-series-fill': res.r >= 0 ? 'pos' : 'neg', 'data-ce-role': 'marker', 'pointer-events': 'none',
            }));
          }
        } else if (!isDiag && showValue) {
          const ann = cellAnnotation(res.p, statsOpts);
          if (ann) {
            const strong = isFinite(res.r) && Math.abs(res.r) > 0.5;
            // modo p-exacto/ambos da un texto más largo que solo estrellas —
            // encoge la fuente en vez de desbordar la celda.
            const fontSize = Math.min(13, cell * 0.42, ann.length > 4 ? (cell * 2.6) / ann.length : Infinity);
            const tx = svgEl('text', {
              x: x + (cell - 1.5) / 2, y: y + (cell - 1.5) / 2 + 3.5,
              class: 'ql-cell-value',
              'text-anchor': 'middle', 'font-size': fontSize,
              'font-weight': 700, fill: strong ? 'var(--surface)' : 'var(--ink)',
              'font-family': 'var(--font-mono)', 'pointer-events': 'none',
            });
            tx.textContent = ann;
            svg.appendChild(tx);
          }
        }
      }
    }
    delegateHover(svg, 'rect[data-i]', {
      onEnter: (el) => {
        const i = +el.dataset.i, j = +el.dataset.j;
        const res = resAt(i, j);
        const x = marginL + j * cell, y = marginT + i * cell;
        showTooltip(chartWrap, x + cell / 2, y + cell / 2,
          escapeHtml(chosen[i].label) + ' × ' + escapeHtml(chosen[j].label),
          (results2 ? escapeHtml(nameOf(i > j ? method2 : method)) + ': ' : '') +
          'r = ' + (isFinite(res.r) ? res.r.toFixed(3) : '—') +
          ' · p = ' + formatP(res.p) + ' · n = ' + res.n,
          { svg, W, H, tooltip, rawHtml: true });
      },
      onLeave: () => hideTooltip(tooltip),
    });

    // etiquetas de fila (izquierda) y columna (abajo, rotadas)
    const rowLabels = svgEl('g', { 'data-ce': 'rowlabels' });
    const colLabels = svgEl('g', { 'data-ce': 'collabels' });
    chosen.forEach((v, i) => {
      const yr = marginT + i * cell + cell / 2 + 3;
      const rt = svgEl('text', { x: marginL - 8, y: yr, class: 'ql-tick-label', 'text-anchor': 'end' });
      rt.textContent = v.label;
      rowLabels.appendChild(rt);
      const xc = marginL + i * cell + cell / 2;
      const yc = marginT + gridS + 12;
      const ct = svgEl('text', {
        x: xc, y: yc, class: 'ql-tick-label', 'text-anchor': 'end',
        transform: 'rotate(-45 ' + xc + ' ' + yc + ')',
      });
      ct.textContent = v.label;
      colLabels.appendChild(ct);
    });
    svg.appendChild(rowLabels);
    svg.appendChild(colLabels);

    // títulos de eje: filas y columnas son las mismas variables
    const xTc = svgEl('text', { x: marginL + gridS / 2, y: marginT + gridS + Math.min(180, 30 + labelChars * 6.2 * 0.72) + 10, class: 'ql-axis-label', 'text-anchor': 'middle', 'data-ce': 'xtitle' });
    xTc.textContent = t('correlogram.axisVariables');
    svg.appendChild(xTc);
    const yTc = svgEl('text', { x: 10, y: marginT + gridS / 2, class: 'ql-axis-label', 'text-anchor': 'middle', transform: 'rotate(-90 10 ' + (marginT + gridS / 2) + ')', 'data-ce': 'ytitle' });
    yTc.textContent = t('correlogram.axisVariables');
    svg.appendChild(yTc);

    // leyenda: barra divergente -1…0…+1 (mapa de calor) o 2 colores de signo
    // + referencia de tamaño |r| (burbujas — el tamaño ya es la magnitud)
    // matriz partida: qué método lleva cada triángulo, encima de la cuadrícula
    if (results2) {
      const sl = svgEl('text', { x: marginL, y: marginT - 8, class: 'ql-tick-label', 'data-ce': 'splitlegend' });
      sl.textContent = t('correlogram.splitLegend', { a: nameOf(method), b: nameOf(method2) });
      svg.appendChild(sl);
    }

    const legG = svgEl('g', { 'data-ce': 'legend' });
    if (isGlyph) {
      const cMaxLeg = (cell - 1.5) / 2 - 1.5;
      [[t('correlogram.legendPos'), 'var(--corr-pos)', 'pos'], [t('correlogram.legendNeg'), 'var(--corr-neg)', 'neg']].forEach(([lab, col, id], i) => {
        const yy = i * 15;
        legG.appendChild(svgEl('rect', { x: 0, y: yy - 8, width: 10, height: 10, rx: 2, fill: col, 'data-ce-series-fill': id }));
        const lt = svgEl('text', { x: 15, y: yy, class: 'ql-tick-label' });
        lt.textContent = lab;
        legG.appendChild(lt);
      });
      let rx = 90;
      [0.25, 0.5, 1].forEach((v) => {
        const r = Math.max(1.5, cMaxLeg * Math.sqrt(v));
        if (isPie) {
          // referencia de sectores: mismo radio, ángulo = |r|·360°
          const R = cMaxLeg, cx = rx + cMaxLeg, cy = cMaxLeg, a = v * 2 * Math.PI;
          legG.appendChild(svgEl('circle', { cx, cy, r: R, fill: 'none', stroke: 'var(--ink-muted)', 'stroke-width': 1.1 }));
          if (v < 1) {
            legG.appendChild(svgEl('path', { d: 'M' + cx + ',' + cy + ' L' + cx + ',' + (cy - R) + ' A' + R + ',' + R + ' 0 ' + (a > Math.PI ? 1 : 0) + ' 1 ' + (cx + R * Math.sin(a)).toFixed(2) + ',' + (cy - R * Math.cos(a)).toFixed(2) + ' Z', fill: 'var(--ink-muted)', 'fill-opacity': 0.5 }));
          } else {
            legG.appendChild(svgEl('circle', { cx, cy, r: R, fill: 'var(--ink-muted)', 'fill-opacity': 0.5 }));
          }
          const lt = svgEl('text', { x: cx, y: cMaxLeg * 2 + 13, class: 'ql-tick-label', 'text-anchor': 'middle' });
          lt.textContent = '|r|=' + v;
          legG.appendChild(lt);
          rx += Math.max(cMaxLeg * 2 + 16, 50); // la etiqueta "|r|=0.25" es más ancha que el sector
          return;
        }
        legG.appendChild(svgEl('circle', { cx: rx + cMaxLeg, cy: cMaxLeg, r, fill: 'none', stroke: 'var(--ink-muted)', 'stroke-width': 1.1 }));
        const lt = svgEl('text', { x: rx + cMaxLeg, y: cMaxLeg * 2 + 13, class: 'ql-tick-label', 'text-anchor': 'middle' });
        lt.textContent = '|r|=' + v;
        legG.appendChild(lt);
        rx += cMaxLeg * 2 + 16;
      });
    } else {
      const defs = svgEl('defs', {});
      const legendGradId = 'ql-cscale-correlogram';
      const grad = svgEl('linearGradient', { id: legendGradId, x1: '0', y1: '0', x2: '1', y2: '0' });
      colorScale.legendStops.forEach((st) => {
        grad.appendChild(svgEl('stop', { offset: st.offset + '%', 'stop-color': st.color }));
      });
      defs.appendChild(grad);
      svg.appendChild(defs);
      const barW = Math.min(180, gridS * 0.7);
      legG.appendChild(svgEl('rect', { x: 0, y: 0, width: barW, height: 11, rx: 2, fill: 'url(#' + legendGradId + ')', stroke: 'var(--baseline)' }));
      const midT = colorScale.domain[1] === colorScale.domain[0] ? 0.5
        : (colorScale.midpoint - colorScale.domain[0]) / (colorScale.domain[1] - colorScale.domain[0]);
      const fmt = (v) => (Math.round(v * 100) / 100).toString();
      [[fmt(colorScale.domain[0]), 0, 'start'], [fmt(colorScale.midpoint), Math.max(0, Math.min(barW, midT * barW)), 'middle'], [fmt(colorScale.domain[1]), barW, 'end']]
        .forEach(([lab, xx, anchor]) => {
          const lt = svgEl('text', { x: xx, y: 25, class: 'ql-tick-label', 'text-anchor': anchor });
          lt.textContent = lab;
          legG.appendChild(lt);
        });
      const legNote = svgEl('text', { x: 0, y: 42, class: 'ql-tick-label', fill: 'var(--ink-muted)' });
      legNote.textContent = t('correlogram.legendStars');
      legG.appendChild(legNote);
    }
    legG.setAttribute('transform', 'translate(' + marginL + ',' + (marginT + gridS + marginB - 50) + ')');
    svg.appendChild(legG);

    editor = attachChartEditor({
      key: isBubbles ? 'correlogram-bubbles' : isPie ? 'correlogram-pie' : 'correlogram', svg, mount: chartPanel, lang: getLang(),
      filename: t('correlogram.title') + '-' + method,
      rScript: rScriptCfg,
      elements: [
        { id: 'title', create: { text: t('correlogram.figTitle', { method: method === 'pearson' ? t('correlogram.pearson') : t('correlogram.spearman') }), x: W / 2, y: 22, anchor: 'middle', cls: 'ce-title' } },
        { id: 'xtitle', selector: '[data-ce="xtitle"]' },
        { id: 'ytitle', selector: '[data-ce="ytitle"]' },
        { id: 'rowlabels', selector: '[data-ce="rowlabels"]', kind: 'group' },
        { id: 'collabels', selector: '[data-ce="collabels"]', kind: 'group' },
        { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
      ],
      // burbujas: 2 colores planos por signo, recoloreados en vivo sin
      // repintar — igual que el resto de gráficos categóricos. El mapa de
      // calor usa la escala de color continua compartida (Paso 3 de
      // qiimelab-prompt-editor-fase-3-heatmaps-escalas-continuas.md) en vez
      // del mecanismo de paleta por serie.
      ...(isGlyph ? {
        paletteSeries: [
          { id: 'neg', label: t('correlogram.legendNeg') },
          { id: 'pos', label: t('correlogram.legendPos') },
        ],
        paletteType: 'categorical',
      } : {
        colorScale: { type: 'divergent', domain: [-1, 1], defaultMidpoint: 0 },
        onColorScaleChange: () => paint(),
      }),
      // solo el mapa de calor anota la celda con p (las burbujas usan
      // tamaño+color, sin texto) — mismo panel de significación que
      // groupBoxplot.js, sin el selector de método de ajuste (aquí cada
      // celda es una correlación independiente, no hay comparación múltiple
      // que corregir).
      ...(isGlyph ? {} : { statsControls: { hasMultiGroup: false }, onStatsChange: () => paint() }),
      figureOptions: { categoryOrder: ['original', 'alpha-asc', 'alpha-desc', 'value-asc', 'value-desc', 'cluster'] },
      onFigureOptionsChange: () => paint(),
      onReset: () => paint(),
      startEditing: wasEditing,
    });

    // subtítulo informativo (fuera de la figura)
    chartPanel.insertAdjacentHTML('beforeend',
      '<p class="ql-field-help" style="margin-top:6px;">' +
      t('correlogram.figMeta', { method: method === 'pearson' ? t('correlogram.pearson') : t('correlogram.spearman'), k, n: nLabel }) +
      '</p>');

    renderPairsTable();

    // ---- tabla de todas las parejas (la misma en las dos disposiciones) ----
    function renderPairsTable() {
    const scrollDiv = document.createElement('div');
    scrollDiv.className = 'ql-table-scroll';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table';
    tbl.innerHTML = '<thead><tr><th>' + t('correlogram.colPairA') + '</th><th>' + t('correlogram.colPairB') +
      '</th><th>r' + (results2 ? ' (' + escapeHtml(nameOf(method)) + ')' : '') + '</th><th>p</th><th>n</th>' +
      (results2 ? '<th>r (' + escapeHtml(nameOf(method2)) + ')</th>' : '') + '</tr></thead>';
    const tbody = document.createElement('tbody');
    const flat = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) flat.push({ i, j, res: results[i][j] });
    flat.sort((a, b) => (Math.abs(b.res.r) || 0) - (Math.abs(a.res.r) || 0));
    flat.forEach(({ i, j, res }) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(chosen[i].label) + '</td>' +
        '<td>' + escapeHtml(chosen[j].label) + '</td>' +
        '<td class="ql-num tabular">' + (isFinite(res.r) ? res.r.toFixed(3) : '—') +
        (stars(res.p) ? ' <span class="mono">' + stars(res.p) + '</span>' : '') + '</td>' +
        '<td class="ql-num tabular">' + formatP(res.p) + '</td>' +
        '<td class="ql-num tabular">' + res.n + '</td>' +
        (results2 ? '<td class="ql-num tabular">' + (isFinite(results2[i][j].r) ? results2[i][j].r.toFixed(3) : '—') + '</td>' : '');
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    scrollDiv.appendChild(tbl);
    tableCard.appendChild(scrollDiv);
    }
  }

  // =====================================================================
  //  MAPA DE CALOR CIRCULAR — reproyección polar de la MISMA matriz (mismo
  //  orden de variables, misma escala de color, mismos resultados): la
  //  columna j es un sector alrededor del círculo (en sentido horario desde
  //  el hueco de arriba) y la fila i un anillo (0 = el más interior). La
  //  celda (i,j) es el sector anular donde se cruzan. Con la matriz partida
  //  vale la misma regla que en la rectangular (i>j → segundo método): en
  //  polar eso cae POR FUERA de la escalera que forma la diagonal, y el
  //  triángulo superior (el método elegido) por dentro.
  // =====================================================================
  function drawCircular({ svg, chartPanel, chartWrap, tooltip, k, chosen, resAt, method, method2, nameOf, split, ceKey }) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const th = Math.max(6, Math.min(16, 200 / k));            // grosor de anillo
    const R0 = Math.max(30, k * th * 0.3);                     // hueco central
    const R = R0 + k * th;
    const labelChars = Math.max(...chosen.map((v) => v.label.length));
    const labelPad = Math.min(230, 16 + (labelChars + 4) * 7); // +4: prefijo «n · »; ~7 px/carácter en la fuente mono
    const GAP = (28 * Math.PI) / 180;                          // hueco arriba para numerar los anillos
    const dA = (2 * Math.PI - GAP) / k;
    const angle = (j) => GAP / 2 + j * dA;                     // 0 = las 12, sentido horario
    const marginT = 44 + (split ? 18 : 0);
    const cx = labelPad + R + 24, cy = marginT + labelPad + R;
    const W = 2 * cx, legendTop = cy + R + labelPad + 8;
    const H = legendTop + 56;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    // a diferencia de la rectangular (que crece con k y hace scroll), el
    // círculo se escala al ancho del panel: recortado no se lee
    svg.style.width = '';
    svg.style.maxWidth = '';

    const csOv = getColorScaleOptions(ceKey);
    const colorScale = makeColorScale({
      type: 'divergent',
      domain: [csOv.domainMin != null ? csOv.domainMin : -1, csOv.domainMax != null ? csOv.domainMax : 1],
      midpoint: csOv.midpoint != null ? csOv.midpoint : 0,
      range: paletteColorsOf(csOv.paletteId || 'app:divergent'),
      steps: csOv.steps, invert: csOv.invert,
    });
    const cellBorder = csOv.cellBorder || null;
    const PAD_A = Math.min(0.012, dA * 0.08), PAD_R = Math.min(0.9, th * 0.08);
    const cellsG = svgEl('g', {});
    for (let i = 0; i < k; i++) {
      const r0 = R0 + i * th + PAD_R, r1 = R0 + (i + 1) * th - PAD_R;
      for (let j = 0; j < k; j++) {
        const res = resAt(i, j);
        const isDiag = i === j;
        cellsG.appendChild(svgEl('path', {
          d: arcPath(cx, cy, r0, r1, angle(j) + PAD_A, angle(j + 1) - PAD_A),
          'data-ce-role': 'cell',
          fill: isDiag ? 'var(--corr-diag)' : (colorScale.scale(res.r) || 'var(--corr-zero)'),
          // la diagonal, perfilada: en polar es una escalera en espiral (y la
          // frontera de la matriz partida) y su gris se confunde con r ≈ 0
          stroke: isDiag ? 'var(--ink-2)' : (cellBorder ? cellBorder.color : undefined),
          'stroke-width': isDiag ? 1 : (cellBorder ? cellBorder.width : undefined),
          ...(isDiag ? {} : { 'data-i': i, 'data-j': j }),
        }));
      }
    }
    svg.appendChild(cellsG);
    delegateHover(svg, 'path[data-i]', {
      onEnter: (el) => {
        const i = +el.dataset.i, j = +el.dataset.j;
        const res = resAt(i, j);
        const p = polarPoint(cx, cy, R0 + (i + 0.5) * th, angle(j) + dA / 2);
        showTooltip(chartWrap, p.x, p.y,
          escapeHtml(chosen[i].label) + ' × ' + escapeHtml(chosen[j].label),
          (split ? escapeHtml(nameOf(i > j ? method2 : method)) + ': ' : '') +
          'r = ' + (isFinite(res.r) ? res.r.toFixed(3) : '—') +
          ' · p = ' + formatP(res.p) + ' · n = ' + res.n,
          { svg, W, H, tooltip, rawHtml: true });
      },
      onLeave: () => hideTooltip(tooltip),
    });

    // etiquetas de columna: radiales por fuera del círculo, legibles en las
    // dos mitades (la izquierda se gira 180° para no quedar boca abajo)
    const colLabels = svgEl('g', { 'data-ce': 'collabels' });
    chosen.forEach((v, j) => {
      const a = angle(j) + dA / 2;
      const p = polarPoint(cx, cy, R + 8, a);
      const deg = (a * 180) / Math.PI - 90;
      const flip = a > Math.PI;
      const tx = svgEl('text', {
        x: p.x, y: p.y, class: 'ql-tick-label', 'dominant-baseline': 'middle',
        'text-anchor': flip ? 'end' : 'start',
        transform: 'rotate(' + (flip ? deg + 180 : deg).toFixed(2) + ' ' + p.x.toFixed(2) + ' ' + p.y.toFixed(2) + ')',
      });
      tx.textContent = (j + 1) + ' · ' + v.label;
      colLabels.appendChild(tx);
    });
    svg.appendChild(colLabels);
    // anillos: numerados en el hueco de arriba (anillo n = variable n)
    const rowLabels = svgEl('g', { 'data-ce': 'rowlabels' });
    const ringFont = Math.max(7, Math.min(11, th * 0.75));
    chosen.forEach((v, i) => {
      const tx = svgEl('text', { x: cx, y: cy - (R0 + (i + 0.5) * th), class: 'ql-tick-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': ringFont });
      tx.textContent = String(i + 1);
      rowLabels.appendChild(tx);
    });
    svg.appendChild(rowLabels);
    const note = svgEl('text', { x: cx, y: cy + 4, class: 'ql-tick-label', 'text-anchor': 'middle', fill: 'var(--ink-muted)', 'data-ce': 'xtitle' });
    note.textContent = t('correlogram.circularCenter');
    if (R0 >= 40) svg.appendChild(note);

    if (split) {
      const sl = svgEl('text', { x: W / 2, y: 44 + 4, class: 'ql-tick-label', 'text-anchor': 'middle', 'data-ce': 'splitlegend' });
      sl.textContent = t('correlogram.splitLegendCircular', { a: nameOf(method), b: nameOf(method2) });
      svg.appendChild(sl);
    }

    // leyenda: la misma barra divergente que la vista rectangular
    const legG = svgEl('g', { 'data-ce': 'legend' });
    const defs = svgEl('defs', {});
    const legendGradId = 'ql-cscale-correlogram-circular';
    const grad = svgEl('linearGradient', { id: legendGradId, x1: '0', y1: '0', x2: '1', y2: '0' });
    colorScale.legendStops.forEach((st) => grad.appendChild(svgEl('stop', { offset: st.offset + '%', 'stop-color': st.color })));
    defs.appendChild(grad);
    svg.appendChild(defs);
    const barW = 180;
    legG.appendChild(svgEl('rect', { x: 0, y: 0, width: barW, height: 11, rx: 2, fill: 'url(#' + legendGradId + ')', stroke: 'var(--baseline)' }));
    const midT = colorScale.domain[1] === colorScale.domain[0] ? 0.5
      : (colorScale.midpoint - colorScale.domain[0]) / (colorScale.domain[1] - colorScale.domain[0]);
    const fmt = (v) => (Math.round(v * 100) / 100).toString();
    [[fmt(colorScale.domain[0]), 0, 'start'], [fmt(colorScale.midpoint), Math.max(0, Math.min(barW, midT * barW)), 'middle'], [fmt(colorScale.domain[1]), barW, 'end']]
      .forEach(([lab, xx, anchor]) => {
        const lt = svgEl('text', { x: xx, y: 25, class: 'ql-tick-label', 'text-anchor': anchor });
        lt.textContent = lab;
        legG.appendChild(lt);
      });
    const legNote = svgEl('text', { x: barW / 2, y: 42, class: 'ql-tick-label', 'text-anchor': 'middle', fill: 'var(--ink-muted)' });
    legNote.textContent = t('correlogram.circularLegendNote');
    legG.appendChild(legNote);
    legG.setAttribute('transform', 'translate(' + (W / 2 - barW / 2) + ',' + legendTop + ')');
    svg.appendChild(legG);

    editor = attachChartEditor({
      key: ceKey, svg, mount: chartPanel, lang: getLang(),
      filename: t('correlogram.title') + '-' + method + '-circular',
      rScript: rScriptCfg,
      elements: [
        { id: 'title', create: { text: t('correlogram.figTitle', { method: nameOf(method) }), x: W / 2, y: 22, anchor: 'middle', cls: 'ce-title' } },
        { id: 'rowlabels', selector: '[data-ce="rowlabels"]', kind: 'group' },
        { id: 'collabels', selector: '[data-ce="collabels"]', kind: 'group' },
        { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
      ],
      colorScale: { type: 'divergent', domain: [-1, 1], defaultMidpoint: 0 },
      onColorScaleChange: () => paint(),
      figureOptions: { categoryOrder: ['original', 'alpha-asc', 'alpha-desc', 'value-asc', 'value-desc', 'cluster'] },
      onFigureOptionsChange: () => paint(),
      onReset: () => paint(),
      startEditing: wasEditing,
    });
  }

  // =====================================================================
  //  VISTA RED de co-ocurrencia — layout de fuerzas determinista
  // =====================================================================
  function renderNetwork(ctx) {
    const { svg, chartPanel, chartWrap, tooltip, tableCard, chosen, results, k } = ctx;

    // aristas: parejas del triángulo superior que superan AMBOS umbrales
    const edges = [];
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const res = results[i][j];
        if (isFinite(res.r) && Math.abs(res.r) >= rThresh && isFinite(res.p) && res.p <= pThresh) {
          edges.push({
            i, j, r: res.r, p: res.p, n: res.n,
            source: chosen[i].id, target: chosen[j].id, weight: Math.abs(res.r),
          });
        }
      }
    }
    const degree = new Array(k).fill(0);
    edges.forEach((e) => { degree[e.i]++; degree[e.j]++; });

    const W = 640, H = 480;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.style.width = '';
    svg.style.maxWidth = '';
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const pos = forceLayout(chosen.map((v) => v.id), edges, { width: W, height: H, seed: NET_SEED, iterations: 300 });
    const P = chosen.map((v) => pos[v.id] || { x: W / 2, y: H / 2 });
    const edgeColor = (r) => (r >= 0 ? 'var(--corr-pos)' : 'var(--corr-neg)');

    // aristas primero (debajo de los nodos)
    const edgeLayer = svgEl('g', {});
    svg.appendChild(edgeLayer);
    const edgeEls = [];
    edges.forEach((e, idx) => {
      const a = P[e.i], b = P[e.j];
      const w = Math.abs(e.r);
      const baseOpacity = (0.22 + w * 0.6).toFixed(2);
      const ln = svgEl('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: edgeColor(e.r), 'stroke-width': (1 + w * 4.5).toFixed(2),
        'stroke-opacity': baseOpacity, 'stroke-linecap': 'round',
        'data-ce-series-stroke': e.r >= 0 ? 'pos' : 'neg', 'data-ce-role': 'line',
        'data-ei': idx,
      });
      edgeLayer.appendChild(ln);
      edgeEls.push({ el: ln, e, baseOpacity });
    });

    // nodos + etiquetas
    const nodeLayer = svgEl('g', {});
    const labelLayer = svgEl('g', { 'data-ce': 'labels' });
    svg.appendChild(nodeLayer); svg.appendChild(labelLayer);
    chosen.forEach((v, i) => {
      const p = P[i];
      const rad = 5 + Math.min(6, degree[i] * 1.1);
      const c = svgEl('circle', {
        cx: p.x, cy: p.y, r: rad,
        // nodo = variable (dato): neutro, sin el azul de marca — las aristas
        // ya codifican el signo en azul/rojo (--corr-pos/--corr-neg)
        fill: 'color-mix(in srgb, var(--ink-2) 14%, var(--surface))', stroke: 'var(--ink-2)', 'stroke-width': 1.5, 'data-ce-role': 'marker',
        'data-ni': i,
      });
      nodeLayer.appendChild(c);

      const anchor = p.x > W * 0.66 ? 'end' : (p.x < W * 0.34 ? 'start' : 'middle');
      const dx = anchor === 'end' ? -(rad + 4) : anchor === 'start' ? (rad + 4) : 0;
      const dy = anchor === 'middle' ? -(rad + 5) : 3.5;
      const lbl = svgEl('text', { x: p.x + dx, y: p.y + dy, 'text-anchor': anchor, class: 'ql-tick-label' });
      lbl.textContent = v.label.length > 22 ? v.label.slice(0, 21) + '…' : v.label;
      labelLayer.appendChild(lbl);
    });

    delegateHover(svg, 'line[data-ei], circle[data-ni]', {
      onEnter: (el) => {
        if (el.dataset.ei != null) {
          const { el: ln, e } = edgeEls[+el.dataset.ei];
          ln.setAttribute('stroke-opacity', '1');
          showTip(tooltip, chartWrap, svg, W, H, (P[e.i].x + P[e.j].x) / 2, (P[e.i].y + P[e.j].y) / 2,
            '<div class="ql-tt-name">' + escapeHtml(chosen[e.i].label) + ' × ' + escapeHtml(chosen[e.j].label) + '</div>' +
            '<div class="ql-tt-row">r = ' + e.r.toFixed(3) + ' · p = ' + formatP(e.p) + ' · n = ' + e.n + '</div>');
        } else {
          const i = +el.dataset.ni;
          edgeEls.forEach(({ el: ln, e }) => { if (e.i === i || e.j === i) ln.setAttribute('stroke-opacity', '1'); });
          showTip(tooltip, chartWrap, svg, W, H, P[i].x, P[i].y,
            '<div class="ql-tt-name">' + escapeHtml(chosen[i].label) + '</div>' +
            '<div class="ql-tt-row">' + t('correlogram.netNodeDegree', { n: degree[i] }) + '</div>');
        }
      },
      onLeave: (el) => {
        if (el.dataset.ei != null) {
          const { el: ln, baseOpacity } = edgeEls[+el.dataset.ei];
          ln.setAttribute('stroke-opacity', baseOpacity);
        } else {
          edgeEls.forEach(({ el: ln, baseOpacity }) => ln.setAttribute('stroke-opacity', baseOpacity));
        }
        tooltip.classList.remove('is-show');
      },
    });

    // leyenda: signo + grosor por |r|
    const legG = svgEl('g', { 'data-ce': 'legend' });
    legG.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 26, y2: 0, stroke: 'var(--corr-pos)', 'stroke-width': 3.5, 'stroke-linecap': 'round', 'data-ce-series-stroke': 'pos' }));
    const lt1 = svgEl('text', { x: 32, y: 3.5, class: 'ql-tick-label' }); lt1.textContent = t('correlogram.netLegendPos');
    legG.appendChild(lt1);
    legG.appendChild(svgEl('line', { x1: 0, y1: 16, x2: 26, y2: 16, stroke: 'var(--corr-neg)', 'stroke-width': 3.5, 'stroke-linecap': 'round', 'data-ce-series-stroke': 'neg' }));
    const lt2 = svgEl('text', { x: 32, y: 19.5, class: 'ql-tick-label' }); lt2.textContent = t('correlogram.netLegendNeg');
    legG.appendChild(lt2);
    const lt3 = svgEl('text', { x: 0, y: 34, class: 'ql-tick-label', fill: 'var(--ink-muted)' });
    lt3.textContent = t('correlogram.netLegendWidth');
    legG.appendChild(lt3);
    legG.setAttribute('transform', 'translate(14,' + (H - 42) + ')');
    svg.appendChild(legG);

    if (edges.length === 0) {
      const tx = svgEl('text', { x: W / 2, y: 26, 'text-anchor': 'middle', class: 'ql-axis-label', fill: 'var(--ink-muted)' });
      tx.textContent = t('correlogram.netNoEdges');
      svg.appendChild(tx);
    }

    editor = attachChartEditor({
      key: 'correlogramNetwork', svg, mount: chartPanel, lang: getLang(),
      filename: t('correlogram.title') + '-red-' + method,
      rScript: rScriptCfg,
      elements: [
        { id: 'title', create: { text: t('correlogram.netFigTitle', { method: method === 'pearson' ? t('correlogram.pearson') : t('correlogram.spearman') }), x: W / 2, y: 20, anchor: 'middle', cls: 'ce-title' } },
        { id: 'labels', selector: '[data-ce="labels"]', kind: 'group' },
        { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
      ],
      // orden alineado con DIVERGENT_POLES = [neg=rojo, pos=azul]
      paletteSeries: [
        { id: 'neg', label: t('correlogram.netLegendNeg') },
        { id: 'pos', label: t('correlogram.netLegendPos') },
      ],
      paletteType: 'divergentPoles',
      onReset: () => paint(),
      startEditing: wasEditing,
    });

    chartPanel.insertAdjacentHTML('beforeend',
      '<p class="ql-field-help" style="margin-top:6px;">' +
      t('correlogram.netMeta', {
        edges: edges.length, k,
        r: rThresh.toFixed(2), p: formatP(pThresh),
      }) + '</p>');

    // ---- tabla de conexiones (ordenable) ----
    const scrollDiv = document.createElement('div');
    scrollDiv.className = 'ql-table-scroll';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table';
    const cols = [
      ['a', t('correlogram.colPairA')], ['b', t('correlogram.colPairB')],
      ['r', 'r'], ['p', 'p'], ['n', 'n'],
    ];
    let thead = '<thead><tr>';
    cols.forEach(([key, lbl]) => {
      const on = netSort.key === key;
      thead += '<th aria-sort="' + (on ? (netSort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '">' +
        '<button type="button" data-sort="' + key + '">' + escapeHtml(lbl) +
        (on ? ' <span aria-hidden="true">' + (netSort.dir === 'asc' ? '▲' : '▼') + '</span>' : '') + '</button></th>';
    });
    tbl.innerHTML = thead + '</tr></thead>';
    const tb = document.createElement('tbody');
    const rows = edges.map((e) => ({ a: chosen[e.i].label, b: chosen[e.j].label, r: e.r, p: e.p, n: e.n }));
    const dir = netSort.dir === 'asc' ? 1 : -1;
    rows.sort((x, y) => {
      const xv = x[netSort.key], yv = y[netSort.key];
      if (typeof xv === 'string') return xv.localeCompare(yv) * dir;
      return ((xv || 0) - (yv || 0)) * dir;
    });
    if (rows.length === 0) {
      tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-muted);padding:20px;">' +
        t('correlogram.netNoEdges') + '</td></tr>';
    } else {
      rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + escapeHtml(row.a) + '</td>' +
          '<td>' + escapeHtml(row.b) + '</td>' +
          '<td class="ql-num tabular">' + row.r.toFixed(3) + (stars(row.p) ? ' <span class="mono">' + stars(row.p) + '</span>' : '') + '</td>' +
          '<td class="ql-num tabular">' + formatP(row.p) + '</td>' +
          '<td class="ql-num tabular">' + row.n + '</td>';
        tb.appendChild(tr);
      });
    }
    tbl.appendChild(tb);
    scrollDiv.appendChild(tbl);
    tableCard.appendChild(scrollDiv);
    tbl.querySelectorAll('th button[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sort');
        if (netSort.key === key) netSort = { key, dir: netSort.dir === 'asc' ? 'desc' : 'asc' };
        // por defecto: nombres y p ascendente (más útil), r y n descendente
        else netSort = { key, dir: (key === 'a' || key === 'b' || key === 'p') ? 'asc' : 'desc' };
        paint();
      });
    });
  }

  // tooltip a partir de coordenadas del viewBox (compartido por nodos y aristas)
  function showTip(tip, wrap, svgNode, W, H, cx, cy, html) {
    showTooltip(wrap, cx, cy, null, null, { svg: svgNode, W, H, tooltip: tip, html });
  }

  paint();
  const stop = subscribe(paint);
  return () => { stop(); if (editor) { editor.destroy(); editor = null; } };
}
