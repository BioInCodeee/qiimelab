import { state, subscribe } from '../state.js';
import { t, getLang } from '../lib/i18n.js';
import { formatP, rarefactionCurve } from '../lib/stats.js';
import { rarefactionBatchAsync } from '../lib/heavyStats.js';
import { drawGroupBoxplot, drawGroupStripPlot, drawGroupViolin, groupColor, legendPositionLabel } from '../lib/groupBoxplot.js';
import { matchSampleId, makeGroupResolver } from '../lib/sampleMatch.js';
import {
  collectAlphaMetrics, groupRichnessEstimators, RICHNESS_ESTIMATORS, countVectors,
} from '../lib/alphaMetrics.js';
import { loadExampleCommunityData, loadRealCommunityData, mountExampleButtons } from '../lib/exampleData.js';
import { attachChartEditor, getFigureOptions } from '../lib/chartEditor.js';
import { svgEl, escapeHtml, plotClip } from '../lib/dom.js';
import { showTooltip, hideTooltip } from '../lib/tooltip.js';
import { chartTypeField } from '../lib/chartTypeSelector.js';

function fmt(v, d) {
  return (typeof v === 'number' && isFinite(v)) ? v.toFixed(d) : '—';
}

// enteros grandes con separador de millares neutro (espacio fino, estilo SI):
// "27 700" no se confunde con un decimal en ningún idioma
function fmtN(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function render(container) {
  let metric = null;
  let groupCol = null;
  let view = 'boxplot'; // 'boxplot' | 'rarefaction'
  let plotStyle = 'box'; // 'box' | 'box-nopoints' | 'jitter' | 'violin' — solo dentro de view === 'boxplot'
  let editor = null;
  let wasEditing = false; // ver cfg.startEditing en chartEditor.js — capturado en paint() antes de
                           // destruir el editor, leído por renderRarefaction/drawChart (funciones
                           // hermanas de paint(), no anidadas) al recrearlo
  // Las curvas de rarefacción de muchas muestras corren en un Web Worker
  // (js/lib/heavyStats.js); cacheamos el resultado para que ni el repaint tras
  // el worker ni un cambio de columna de agrupación las recalculen.
  let rareCache = null; // { key, curves: { [sid]: {N,sObs,depths,richness} } }
  let rareGen = 0;
  let rareDepth = null; // profundidad de submuestreo elegida a mano; null hasta que el usuario la toque o cambie el dataset

  function paint() {
    // ver cfg.startEditing en chartEditor.js: sin esto, cualquier repintado
    // disparado DESDE DENTRO del propio editor (Estructura, Estadística…)
    // cerraría el panel "Personalizar" de golpe.
    wasEditing = editor && editor.isEditing ? editor.isEditing() : false;
    if (editor) { editor.destroy(); editor = null; }
    container.innerHTML = '';
    const header = document.createElement('header');
    header.className = 'ql-page-header';
    header.innerHTML =
      '<p class="ql-eyebrow">' + t('alpha.eyebrow') + '</p>' +
      '<h1 class="ql-page-title">' + t('alpha.title') + '</h1>' +
      '<p class="ql-page-sub">' + t('alpha.subtitle') + '</p>';
    container.appendChild(header);

    const allMetrics = collectAlphaMetrics();
    const haveData = allMetrics.length > 0;

    if (!haveData || !state.metadata) {
      const card = document.createElement('div');
      card.className = 'ql-card ql-panel';
      const missing = [];
      if (!haveData) missing.push(t('alpha.needMetric'));
      if (!state.metadata) missing.push(t('alpha.needMeta'));
      card.innerHTML =
        '<div class="ql-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4" y="9" width="4" height="11"/><rect x="10" y="4" width="4" height="16"/><rect x="16" y="12" width="4" height="8"/></svg>' +
        '<h3>' + t('alpha.emptyTitle') + '</h3><p>' + t('alpha.emptyNeed', { list: missing.join(t('ui.needAnd')) }) + '</p>' +
        '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">' +
        '<a href="#/cargar" class="ql-btn">' + t('ui.goLoadData') + '</a></div></div>';
      container.appendChild(card);
      mountExampleButtons(card.querySelector('.ql-empty'), {
        real: loadRealCommunityData,
        synthetic: loadExampleCommunityData,
        download: ['shannon', 'observed', 'counts', 'metadata'],
      });
      return;
    }

    // pestañas: Boxplot | Curvas de rarefacción (mismo patrón que diversidad beta)
    const tabs = document.createElement('div');
    tabs.className = 'ql-tabs';
    [['boxplot', t('alpha.tabBoxplot')], ['rarefaction', t('alpha.tabRarefaction')]].forEach(([v, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-tab' + (view === v ? ' is-active' : '');
      b.textContent = label;
      b.addEventListener('click', () => { view = v; paint(); });
      tabs.appendChild(b);
    });
    container.appendChild(tabs);

    if (view === 'rarefaction') { renderRarefaction(); return; }

    const metricNames = allMetrics.map((m) => m.name);
    if (!metric || !metricNames.includes(metric)) metric = metricNames[0];
    const curMetric = allMetrics.find((m) => m.name === metric);
    const groupOptions = state.metadata.headers.filter((h) => h !== state.metadata.sampleIdKey);
    if (!groupCol || !groupOptions.includes(groupCol)) groupCol = groupOptions[0] || null;

    const grid = document.createElement('div');
    grid.className = 'ql-grid-2';

    const chartPanel = document.createElement('section');
    chartPanel.className = 'ql-card ql-panel';
    chartPanel.innerHTML = '<p class="ql-panel-note" style="margin-bottom:4px;">' +
      t(plotStyle === 'jitter' ? 'alpha.jitterNote' : plotStyle === 'violin' ? 'alpha.violinNote' : plotStyle === 'box-nopoints' ? 'alpha.chartNoteNoPoints' : 'alpha.chartNote') + '</p>';
    const chartWrap = document.createElement('div');
    chartWrap.className = 'ql-chartwrap';
    const svg = svgEl('svg', { class: 'ql-svg', role: 'img', 'aria-label': t('a11y.chartBoxplotAlpha') });
    const tooltip = document.createElement('div');
    tooltip.className = 'ql-tooltip';
    chartWrap.appendChild(svg);
    chartWrap.appendChild(tooltip);
    chartPanel.appendChild(chartWrap);
    grid.appendChild(chartPanel);

    const controls = document.createElement('aside');
    controls.className = 'ql-card ql-panel';
    controls.innerHTML = '<h2>' + t('ui.controls') + '</h2>';

    if (allMetrics.length > 1) {
      const f = document.createElement('div');
      f.className = 'ql-field';
      f.innerHTML = '<label>' + t('alpha.metricLabel') + '</label>';
      const sel = document.createElement('select');
      allMetrics.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = m.label + (m.computed ? ' · ' + t('alpha.computedTag') : '');
        if (m.name === metric) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => { metric = sel.value; paint(); });
      f.appendChild(sel);
      controls.appendChild(f);
    }

    // explicación de una frase de la métrica elegida (mismo patrón en beta)
    if (curMetric && curMetric.explain) {
      const ex = document.createElement('p');
      ex.className = 'ql-metric-explain';
      ex.innerHTML = '<strong>' + escapeHtml(curMetric.label) + '.</strong> ' + escapeHtml(curMetric.explain);
      controls.appendChild(ex);
    }

    if (groupOptions.length > 0) {
      const f = document.createElement('div');
      f.className = 'ql-field';
      f.innerHTML = '<label>' + t('alpha.groupLabel') + '</label>';
      const sel = document.createElement('select');
      groupOptions.forEach((g) => {
        const opt = document.createElement('option');
        opt.value = g; opt.textContent = g;
        if (g === groupCol) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => { groupCol = sel.value; paint(); });
      f.appendChild(sel);
      controls.appendChild(f);
    }

    controls.appendChild(chartTypeField({
      labelKey: 'alpha.plotStyleLabel',
      options: [
        { value: 'box', labelKey: 'alpha.plotStyleBox' },
        { value: 'box-nopoints', labelKey: 'alpha.plotStyleBoxNoPoints' },
        { value: 'jitter', labelKey: 'alpha.plotStyleJitter' },
        { value: 'violin', labelKey: 'alpha.plotStyleViolin' },
      ],
      active: plotStyle,
      onChange: (v) => { plotStyle = v; paint(); },
      helpKey: 'alpha.plotStyleHelp',
    }));

    // aviso si se mezclan métricas de archivo (posible nivel ASV) con calculadas
    if (allMetrics.some((m) => m.computed) && allMetrics.some((m) => !m.computed)) {
      const mix = document.createElement('p');
      mix.className = 'ql-field-help';
      mix.textContent = t('alpha.computedNote');
      controls.appendChild(mix);
    }

    const statsBox = document.createElement('div');
    statsBox.style.marginTop = '18px';
    controls.appendChild(statsBox);

    grid.appendChild(controls);
    container.appendChild(grid);

    // tabla por muestra
    const tableCard = document.createElement('section');
    tableCard.className = 'ql-card ql-panel';
    tableCard.style.marginTop = '20px';
    tableCard.innerHTML = '<h2>' + t('alpha.tableTitle') + '</h2>';
    container.appendChild(tableCard);

    if (!groupCol) return;

    // ---- construir grupos ----
    const values = curMetric.values;
    const metaByKey = {};
    state.metadata.rows.forEach((r) => { metaByKey[r[state.metadata.sampleIdKey]] = r; });
    // resolutor tolerante a sufijos (A-1 ↔ A-1-16S-…)
    const metaKeys = Object.keys(metaByKey);
    const resolveMeta = (sid) => {
      const k = matchSampleId(metaKeys, sid);
      return k == null ? undefined : metaByKey[k];
    };

    const groupNames = [];
    const groupData = {};
    const perSampleRows = [];
    Object.keys(values).forEach((sampleId) => {
      const v = values[sampleId];
      if (typeof v !== 'number' || !isFinite(v)) return;
      const meta = resolveMeta(sampleId);
      const g = meta ? meta[groupCol] : undefined;
      if (g === undefined || g === '') return;
      if (!groupData[g]) { groupData[g] = []; groupNames.push(g); }
      groupData[g].push(v);
      perSampleRows.push({ sampleId, group: g, value: v });
    });
    groupNames.sort();

    if (groupNames.length === 0) {
      statsBox.innerHTML = '<p class="ql-field-help">' + t('alpha.noMatch') + '</p>';
      renderGroupEstimators(groupCol);
      return;
    }

    const decimals = /^(chao1|observed)$/.test(metric) ? 2 : 3;
    const drawFn = plotStyle === 'jitter' ? drawGroupStripPlot : plotStyle === 'violin' ? drawGroupViolin : drawGroupBoxplot;
    const ceKey = plotStyle === 'jitter' ? 'alphaDiversity-jitter' : plotStyle === 'violin' ? 'alphaDiversity-violin' : 'alphaDiversity';
    const { kw, ceElements, paletteSeries, statsControls, figureOptions, legendPositions, lowN } = drawFn({
      svg, chartWrap, tooltip, groupNames, groupData, key: ceKey,
      title: t('alpha.title'), xTitle: groupCol, yTitle: curMetric.label, valueLabel: curMetric.label,
      valueDecimals: decimals,
      // "Cajas sin puntos": el mismo boxplot (misma clave de editor) sin los
      // puntos de cada muestra encima
      showPoints: plotStyle !== 'box-nopoints',
    });

    statsBox.innerHTML =
      '<div class="ql-stats">' +
      '<div class="ql-stat"><div class="ql-stat-label">' + t('alpha.statGroups') + '</div><div class="ql-stat-value" style="font-size:20px;">' + groupNames.length + '</div></div>' +
      '<div class="ql-stat"><div class="ql-stat-label">' + t('alpha.statSamples') + '</div><div class="ql-stat-value" style="font-size:20px;">' + perSampleRows.length + '</div></div>' +
      '</div>' +
      (kw ? '<div style="margin-top:14px;padding:12px;border-radius:var(--radius-md);background:var(--page);border:1px solid var(--border);">' +
        '<div style="font-size:11px;color:var(--ink-muted);margin-bottom:4px;">Kruskal-Wallis</div>' +
        '<div class="mono tabular" style="font-size:13px;">H = ' + kw.H.toFixed(3) + ', df = ' + kw.df + '</div>' +
        '<div class="mono tabular" style="font-size:13px;">p = ' + formatP(kw.p) + (kw.p < 0.05 ? ' <span class="ql-badge ql-badge-good" style="margin-left:6px;">' + t('alpha.kwSignificant') + '</span>' : '') + '</div>' +
        '</div>' +
        '<p class="ql-field-help">' + t('alpha.kwHelp') + '</p>'
        : '<p class="ql-field-help">' + t('alpha.kwOneGroup') + '</p>') +
      (plotStyle === 'violin' && lowN && lowN.length ? '<p class="ql-field-help">' + t('alpha.violinLowN', { groups: lowN.join(', ') }) + '</p>' : '');

    editor = attachChartEditor({
      key: ceKey, svg, mount: chartPanel, filename: t('alpha.title') + '-' + metric, lang: getLang(),
      elements: ceElements,
      paletteSeries, paletteType: 'categorical',
      statsControls, onStatsChange: () => paint(),
      figureOptions, onFigureOptionsChange: () => paint(),
      legendPositions: (legendPositions || []).map((p) => ({ ...p, label: legendPositionLabel(p.id, getLang()) })),
      onReset: () => paint(),
      startEditing: wasEditing,
    });

    // tabla
    const scrollDiv = document.createElement('div');
    scrollDiv.className = 'ql-table-scroll';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table';
    tbl.innerHTML = '<thead><tr><th><button type="button">' + t('alpha.colSample') + '</button></th><th><button type="button">' +
      escapeHtml(groupCol) + '</button></th><th><button type="button">' + escapeHtml(curMetric.label) + '</button></th></tr></thead>';
    const tbody = document.createElement('tbody');
    perSampleRows.sort((a, b) => a.group === b.group ? a.value - b.value : String(a.group).localeCompare(String(b.group)))
      .forEach((r) => {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + escapeHtml(r.sampleId) + '</td><td>' + escapeHtml(String(r.group)) + '</td><td class="ql-num tabular">' + r.value.toFixed(4) + '</td>';
        tbody.appendChild(tr);
      });
    tbl.appendChild(tbody);
    scrollDiv.appendChild(tbl);
    tableCard.appendChild(scrollDiv);

    renderGroupEstimators(groupCol);
  }

  // Tabla comparativa por grupo: Chao2, jackknife 1º/2º orden, bootstrap — todos
  // por INCIDENCIA (en cuántas muestras del grupo aparece cada taxón). No son de
  // una muestra suelta, por eso van en su propia tabla y no en el boxplot.
  function renderGroupEstimators(groupCol) {
    const rows = groupRichnessEstimators(groupCol);
    if (!rows || rows.length === 0) return;

    const card = document.createElement('section');
    card.className = 'ql-card ql-panel';
    card.style.marginTop = '20px';
    card.innerHTML =
      '<h2>' + t('alpha.groupRichTitle') + '</h2>' +
      '<p class="ql-panel-note">' + t('alpha.groupRichNote') + '</p>';

    const scrollDiv = document.createElement('div');
    scrollDiv.className = 'ql-table-scroll';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table';
    let head = '<thead><tr><th>' + escapeHtml(groupCol) + '</th><th>n</th>';
    RICHNESS_ESTIMATORS.forEach((e) => { head += '<th>' + escapeHtml(e.label) + '</th>'; });
    tbl.innerHTML = head + '</tr></thead>';
    const tbody = document.createElement('tbody');
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      let cells = '<td>' + escapeHtml(String(r.group)) + '</td><td class="ql-num tabular">' + r.n + '</td>';
      RICHNESS_ESTIMATORS.forEach((e) => {
        const se = e.se && isFinite(r[e.se]) ? ' <span class="ql-se">± ' + r[e.se].toFixed(1) + '</span>' : '';
        cells += '<td class="ql-num tabular">' + fmt(r[e.key], 1) + se + '</td>';
      });
      tr.innerHTML = cells;
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    scrollDiv.appendChild(tbl);
    card.appendChild(scrollDiv);

    const dl = document.createElement('dl');
    dl.className = 'ql-metric-defs';
    RICHNESS_ESTIMATORS.forEach((e) => {
      const dt = document.createElement('dt');
      dt.textContent = e.label;
      const dd = document.createElement('dd');
      dd.textContent = t(e.ex);
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    card.appendChild(dl);
    container.appendChild(card);
  }

  // ======================================================================
  //  Curvas de rarefacción — riqueza esperada (Hurlbert) según profundidad
  // ======================================================================
  function renderRarefaction() {
    if (!state.taxaCounts) {
      const card = document.createElement('section');
      card.className = 'ql-card ql-panel';
      card.innerHTML = '<div class="ql-empty" style="padding:32px 20px;">' +
        '<h3>' + t('alpha.rareNeedCountsTitle') + '</h3>' +
        '<p>' + t('alpha.rareNeedCounts') + '</p></div>';
      mountExampleButtons(card.querySelector('.ql-empty'), {
        real: loadRealCommunityData, synthetic: loadExampleCommunityData,
        download: ['counts', 'metadata'],
      });
      container.appendChild(card);
      return;
    }

    const groupOptions = state.metadata
      ? state.metadata.headers.filter((h) => h !== state.metadata.sampleIdKey) : [];
    if (state.metadata && (!groupCol || !groupOptions.includes(groupCol))) groupCol = groupOptions[0] || null;

    // muestra → grupo (tolerante a sufijos)
    const resolveGroup = (state.metadata && groupCol)
      ? makeGroupResolver(state.metadata, groupCol)
      : () => null;

    const { sampleIds, vectors } = countVectors(state.taxaCounts);

    // rarefactionCurve por muestra es O(50 · taxones no nulos · logGamma):
    // ~530 ms para 260 muestras × ~2800 taxones. Pequeño → hilo principal;
    // grande → Web Worker con aviso y repaint al terminar.
    const rk = (state.taxaCounts.sourceFileId ?? '?') + '|' + sampleIds.length + '|' +
      (state.taxaCounts.rows ? state.taxaCounts.rows.length : 0);
    let raw;
    if (rareCache && rareCache.key === rk) {
      raw = rareCache.curves;
    } else {
      let work = 0;
      for (const sid of sampleIds) {
        const v = vectors[sid];
        for (let i = 0; i < v.length; i++) if (v[i] > 0) work++;
      }
      if (work < 120000) {
        raw = {};
        sampleIds.forEach((sid) => { raw[sid] = rarefactionCurve(vectors[sid], 50); });
        rareCache = { key: rk, curves: raw };
      } else {
        const wait = document.createElement('section');
        wait.className = 'ql-card ql-panel';
        wait.innerHTML = '<p class="ql-panel-note">' + t('alpha.rareWait') + '</p>';
        container.appendChild(wait);
        const gen = ++rareGen;
        rarefactionBatchAsync(vectors, 50).then((curves) => {
          if (gen !== rareGen) return; // el usuario cambió de pestaña / de ruta
          rareCache = { key: rk, curves };
          paint();
        });
        return;
      }
    }

    const curves = sampleIds
      .map((sid) => ({ sid, group: resolveGroup(sid), ...raw[sid] }))
      .filter((c) => c.N > 0);

    if (curves.length === 0) {
      const card = document.createElement('section');
      card.className = 'ql-card ql-panel';
      card.innerHTML = '<p class="ql-field-help">' + t('alpha.rareNoSamples') + '</p>';
      container.appendChild(card);
      return;
    }

    const groupNames = Array.from(new Set(curves.map((c) => c.group).filter(Boolean))).sort();
    const colorFor = (g) => (g == null || !groupNames.length ? 'var(--ink-muted)' : groupColor(groupNames.indexOf(g)));
    const minDepth = Math.min(...curves.map((c) => c.N));
    const maxN = Math.max(...curves.map((c) => c.N));
    const maxS = Math.max(...curves.map((c) => c.sObs));
    // profundidad elegida: arranca en la mínima automática; se conserva entre
    // repintados (cambio de columna de grupo, etc.) mientras siga cayendo
    // dentro del rango del dataset actual
    if (rareDepth == null || rareDepth < 1 || rareDepth > maxN) rareDepth = minDepth;

    // ---- layout ----
    const grid = document.createElement('div');
    grid.className = 'ql-grid-2';

    const chartPanel = document.createElement('section');
    chartPanel.className = 'ql-card ql-panel';
    chartPanel.innerHTML = '<p class="ql-panel-note" style="margin-bottom:4px;">' + t('alpha.rareNote') + '</p>';
    const chartWrap = document.createElement('div');
    chartWrap.className = 'ql-chartwrap';
    const svg = svgEl('svg', { class: 'ql-svg', role: 'img', 'aria-label': t('a11y.chartRarefaction') });
    const tooltip = document.createElement('div');
    tooltip.className = 'ql-tooltip';
    chartWrap.appendChild(svg);
    chartWrap.appendChild(tooltip);
    chartPanel.appendChild(chartWrap);
    grid.appendChild(chartPanel);

    const controls = document.createElement('aside');
    controls.className = 'ql-card ql-panel';
    controls.innerHTML = '<h2>' + t('ui.controls') + '</h2>';
    if (groupOptions.length > 0) {
      const f = document.createElement('div');
      f.className = 'ql-field';
      f.innerHTML = '<label>' + t('alpha.groupLabel') + '</label>';
      const sel = document.createElement('select');
      groupOptions.forEach((g) => {
        const opt = document.createElement('option');
        opt.value = g; opt.textContent = g;
        if (g === groupCol) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => { groupCol = sel.value; paint(); });
      f.appendChild(sel);
      controls.appendChild(f);
    }

    const depthField = document.createElement('div');
    depthField.className = 'ql-field';
    depthField.innerHTML = '<label for="rareDepthR">' + t('alpha.rareDepthLabel') + '</label>' +
      '<div class="ql-inputrow">' +
      '<input type="range" id="rareDepthR" min="1" max="' + maxN + '" step="1" value="' + rareDepth + '" />' +
      '<input type="number" id="rareDepthN" class="ql-num-small tabular" min="1" max="' + maxN + '" step="1" value="' + rareDepth + '" /></div>' +
      '<p class="ql-field-help">' + t('alpha.rareDepthHelp') + '</p>';
    controls.appendChild(depthField);
    const depthRangeEl = depthField.querySelector('#rareDepthR');
    const depthNumEl = depthField.querySelector('#rareDepthN');
    const applyDepth = (v) => {
      if (v === '') return;
      const nv = Math.max(1, Math.min(maxN, Math.round(Number(v))));
      if (isFinite(nv) && nv !== rareDepth) { rareDepth = nv; redraw(); }
    };
    depthRangeEl.addEventListener('input', () => { depthNumEl.value = depthRangeEl.value; applyDepth(depthRangeEl.value); });
    depthNumEl.addEventListener('input', () => { depthRangeEl.value = depthNumEl.value || depthRangeEl.value; applyDepth(depthNumEl.value); });

    controls.insertAdjacentHTML('beforeend',
      '<div class="ql-stats" style="margin-top:6px;">' +
      '<div class="ql-stat"><div class="ql-stat-label">' + t('alpha.statSamples') + '</div><div class="ql-stat-value" style="font-size:20px;">' + curves.length + '</div></div>' +
      '<div class="ql-stat"><div class="ql-stat-label">' + t('alpha.rareStatMinDepth') + '</div><div class="ql-stat-value" style="font-size:20px;">' + fmtN(minDepth) + '</div></div>' +
      '<div class="ql-stat"><div class="ql-stat-label">' + t('alpha.rareKeptStat') + '</div><div class="ql-stat-value" id="rareKeptValue" style="font-size:20px;"></div></div>' +
      '</div>' +
      '<p class="ql-field-help">' + t('alpha.rareMinDepthHelp') + '</p>');
    const excludedBox = document.createElement('div');
    excludedBox.id = 'rareExcludedBox';
    controls.appendChild(excludedBox);
    grid.appendChild(controls);
    container.appendChild(grid);

    // ---- dibujar el line chart ----
    const W = 760, H = 460;
    const mL = 58, mR = 22, mT = 42, mB = 92;
    const innerW = W - mL - mR, innerH = H - mT - mB;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    // rangos de eje manuales (Ajustes > Estructura); por defecto 0..máximo de los datos
    const so = getFigureOptions('alphaRarefaction');
    const xLo = so.axisXMin != null ? so.axisXMin : 0, xHi = so.axisXMax != null ? so.axisXMax : (maxN || 1);
    const yLo = so.axisMin != null ? so.axisMin : 0, yHi = so.axisMax != null ? so.axisMax : (maxS || 1);
    const sx = (v) => mL + ((v - xLo) / ((xHi - xLo) || 1)) * innerW;
    const sy = (v) => mT + innerH - ((v - yLo) / ((yHi - yLo) || 1)) * innerH;

    // reconstruye SOLO el contenido del <svg> — se puede llamar de nuevo al
    // mover el slider de profundidad sin recrear chartWrap/tooltip/controles
    function drawChart() {
      svg.replaceChildren();
      const clip = plotClip(svg, 'ql-clip-rare', mL, mT, innerW, innerH);
      const g = svgEl('g', {});
      svg.appendChild(g);

      // gridlines + ticks
      for (let i = 0; i <= 4; i++) {
        const yv = yLo + (i / 4) * (yHi - yLo), y = sy(yv);
        g.appendChild(svgEl('line', { x1: mL, x2: mL + innerW, y1: y, y2: y, class: 'ql-gridline' }));
        const tk = svgEl('text', { x: mL - 8, y: y + 3, class: 'ql-tick-label', 'text-anchor': 'end' });
        tk.textContent = (yHi - yLo) < 10 ? yv.toFixed(1) : String(Math.round(yv));
        g.appendChild(tk);
      }
      for (let i = 0; i <= 4; i++) {
        const xv = xLo + (i / 4) * (xHi - xLo), x = sx(xv);
        g.appendChild(svgEl('line', { x1: x, x2: x, y1: mT, y2: mT + innerH, class: 'ql-gridline' }));
        const tk = svgEl('text', { x, y: mT + innerH + 18, class: 'ql-tick-label', 'text-anchor': 'middle' });
        tk.textContent = xv >= 1000 ? (xv / 1000).toFixed(xv >= 10000 ? 0 : 1) + 'k' : String(Math.round(xv));
        g.appendChild(tk);
      }
      g.appendChild(svgEl('line', { x1: mL, x2: mL + innerW, y1: mT + innerH, y2: mT + innerH, class: 'ql-baseline-line' }));
      g.appendChild(svgEl('line', { x1: mL, x2: mL, y1: mT, y2: mT + innerH, class: 'ql-baseline-line' }));

      // línea de referencia: profundidad mínima automática (todas las muestras
      // caben). Si coincide con la elegida, se pinta ya en acento (son el
      // mismo punto); si no, se deja tenue y la elegida se dibuja aparte.
      const depthDiffers = rareDepth !== minDepth;
      if (minDepth > 0 && minDepth < maxN) {
        const xd = sx(minDepth);
        g.appendChild(svgEl('line', {
          x1: xd, x2: xd, y1: mT, y2: mT + innerH,
          class: depthDiffers ? 'ql-threshold-line' : 'ql-threshold-line-accent',
        }));
        const lab = svgEl('text', {
          x: xd, y: mT - 6, class: 'ql-tick-label', 'text-anchor': 'middle',
          fill: depthDiffers ? 'var(--ink-2)' : 'var(--accent)',
        });
        lab.textContent = depthDiffers
          ? t('alpha.rareMinDepthMark', { n: fmtN(minDepth) })
          : t('alpha.rareDepthMark', { n: fmtN(rareDepth) });
        g.appendChild(lab);
      }
      // línea de la profundidad elegida a mano (solo si difiere de la automática)
      if (depthDiffers && rareDepth > 0 && rareDepth < maxN) {
        const xc = sx(rareDepth);
        g.appendChild(svgEl('line', { x1: xc, x2: xc, y1: mT, y2: mT + innerH, class: 'ql-threshold-line-accent' }));
        const labC = svgEl('text', { x: xc, y: mT + 14, class: 'ql-tick-label', 'text-anchor': 'middle', fill: 'var(--accent)' });
        labC.textContent = t('alpha.rareDepthMark', { n: fmtN(rareDepth) });
        g.appendChild(labC);
      }

      // una polilínea por muestra — atenuada si quedaría excluida a la
      // profundidad elegida (mismo criterio que richAt(): N < profundidad)
      const lines = svgEl('g', {});
      g.appendChild(lines);
      curves.forEach((c) => {
        const excluded = c.N < rareDepth;
        const pts = c.depths.map((d, i) => sx(d) + ',' + sy(c.richness[i])).join(' ');
        const pl = svgEl('polyline', {
          points: pts, fill: 'none', stroke: colorFor(c.group), 'data-ce-role': 'line', 'clip-path': clip,
          'stroke-width': excluded ? 1.1 : 1.6, 'stroke-opacity': excluded ? 0.28 : 0.8, 'stroke-linejoin': 'round',
          ...(c.group ? { 'data-ce-series-stroke': 's' + groupNames.indexOf(c.group) } : {}),
        });
        pl.addEventListener('mouseenter', () => {
          pl.setAttribute('stroke-width', '3'); pl.setAttribute('stroke-opacity', '1');
          showTooltip(chartWrap, sx(c.N), sy(c.sObs),
            escapeHtml(c.sid) + (c.group ? ' · ' + escapeHtml(c.group) : ''),
            t('alpha.rareColReads') + ' ' + fmtN(c.N) + ' · ' + t('alpha.rareColSobs') + ' ' + c.sObs,
            { svg, W, H, tooltip, rawHtml: true });
        });
        pl.addEventListener('mouseleave', () => {
          pl.setAttribute('stroke-width', excluded ? '1.1' : '1.6'); pl.setAttribute('stroke-opacity', excluded ? '0.28' : '0.8');
          hideTooltip(tooltip);
        });
        lines.appendChild(pl);
      });

      // títulos de eje
      const xT = svgEl('text', { x: mL + innerW / 2, y: H - 44, class: 'ql-axis-label', 'text-anchor': 'middle', 'data-ce': 'xtitle' });
      xT.textContent = t('alpha.rareXAxis');
      g.appendChild(xT);
      const yT = svgEl('text', {
        x: 15, y: mT + innerH / 2, class: 'ql-axis-label', 'text-anchor': 'middle',
        transform: 'rotate(-90 15 ' + (mT + innerH / 2) + ')', 'data-ce': 'ytitle',
      });
      yT.textContent = t('alpha.rareYAxis');
      g.appendChild(yT);

      // leyenda por grupo
      if (groupNames.length) {
        const legG = svgEl('g', { 'data-ce': 'legend' });
        const perRow = Math.max(1, Math.floor(innerW / 150));
        groupNames.forEach((gn, i) => {
          const col = i % perRow, rw = Math.floor(i / perRow);
          const xx = col * 150, yy = rw * 16;
          legG.appendChild(svgEl('line', { x1: xx, x2: xx + 16, y1: yy, y2: yy, stroke: colorFor(gn), 'stroke-width': 2.4, 'data-ce-series-stroke': 's' + i }));
          const lt = svgEl('text', { x: xx + 22, y: yy + 3.5, class: 'ql-tick-label' });
          lt.textContent = gn.length > 16 ? gn.slice(0, 15) + '…' : gn;
          legG.appendChild(lt);
        });
        legG.setAttribute('transform', 'translate(' + mL + ',' + (H - 22) + ')');
        svg.appendChild(legG);
      } else {
        const nt = svgEl('text', { x: mL, y: H - 20, class: 'ql-tick-label', fill: 'var(--ink-muted)' });
        nt.textContent = t('alpha.rareNoGroups');
        svg.appendChild(nt);
      }
    }

    drawChart();

    editor = attachChartEditor({
      key: 'alphaRarefaction', svg, mount: chartPanel,
      filename: t('alpha.rareFigTitle'), lang: getLang(),
      elements: [
        { id: 'title', create: { text: t('alpha.rareFigTitle'), x: W / 2, y: 22, anchor: 'middle', cls: 'ce-title' } },
        { id: 'xtitle', selector: '[data-ce="xtitle"]' },
        { id: 'ytitle', selector: '[data-ce="ytitle"]' },
        { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
      ],
      paletteSeries: groupNames.map((g, i) => ({ id: 's' + i, label: g })),
      paletteType: 'categorical',
      figureOptions: { axis: { domain: [0, maxS || 1] }, axisX: { domain: [0, maxN || 1] } },
      onFigureOptionsChange: () => paint(),
      onReset: () => paint(),
      startEditing: wasEditing,
    });

    // ---- panel de muestras excluidas a la profundidad elegida ----
    function drawExcluded() {
      const kept = curves.filter((c) => c.N >= rareDepth);
      const excluded = curves.filter((c) => c.N < rareDepth).sort((a, b) => a.N - b.N);
      const keptStat = controls.querySelector('#rareKeptValue');
      if (keptStat) keptStat.textContent = t('alpha.rareKeptValue', { kept: kept.length, total: curves.length });
      if (excluded.length === 0) {
        excludedBox.innerHTML = '<p class="ql-field-help" style="margin-top:10px;">' + t('alpha.rareExcludedNone', { n: fmtN(rareDepth) }) + '</p>';
        return;
      }
      let html = '<h3 style="margin-top:14px;font-size:14px;">' + t('alpha.rareExcludedTitle') + '</h3>' +
        '<p class="ql-field-help">' + t('alpha.rareExcludedNote', { n: fmtN(rareDepth) }) + '</p>' +
        '<div class="ql-table-scroll" style="max-height:200px;"><table class="ql-table"><thead><tr>' +
        '<th>' + t('alpha.colSample') + '</th><th>' + t('alpha.rareColReads') + '</th></tr></thead><tbody>';
      excluded.forEach((c) => {
        html += '<tr><td>' + escapeHtml(c.sid) + '</td><td class="ql-num tabular">' + fmtN(c.N) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      excludedBox.innerHTML = html;
    }
    drawExcluded();

    // ---- tabla (alternativa al gráfico) ----
    const tableCard = document.createElement('section');
    tableCard.className = 'ql-card ql-panel';
    tableCard.style.marginTop = '20px';
    container.appendChild(tableCard);
    // S a la profundidad elegida: la curva pasa por ahí exactamente si esa
    // profundidad es el N de esa muestra; para el resto interpolamos
    // linealmente entre puntos (mismo criterio de igualdad que "conservada":
    // N >= profundidad no extrapola, usa la riqueza observada tal cual).
    const richAt = (c, n) => {
      if (n >= c.N) return c.sObs;
      for (let i = 1; i < c.depths.length; i++) {
        if (c.depths[i] >= n) {
          const t0 = c.depths[i - 1], t1 = c.depths[i];
          const f = t1 === t0 ? 0 : (n - t0) / (t1 - t0);
          return c.richness[i - 1] + f * (c.richness[i] - c.richness[i - 1]);
        }
      }
      return c.sObs;
    };
    function drawTable() {
      tableCard.innerHTML = '<h2>' + t('alpha.rareTableTitle') + '</h2>' +
        '<p class="ql-panel-note">' + t('alpha.rareTableNote', { n: fmtN(rareDepth) }) + '</p>';
      const scrollDiv = document.createElement('div');
      scrollDiv.className = 'ql-table-scroll';
      const tbl = document.createElement('table');
      tbl.className = 'ql-table';
      tbl.innerHTML = '<thead><tr><th>' + t('alpha.colSample') + '</th>' +
        (groupNames.length ? '<th>' + escapeHtml(groupCol) + '</th>' : '') +
        '<th>' + t('alpha.rareColReads') + '</th><th>' + t('alpha.rareColSobs') + '</th>' +
        '<th>' + t('alpha.rareColRarefied', { n: fmtN(rareDepth) }) + '</th></tr></thead>';
      const tbody = document.createElement('tbody');
      curves.slice()
        .sort((a, b) => (a.group === b.group ? a.N - b.N : String(a.group).localeCompare(String(b.group))))
        .forEach((c) => {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td>' + escapeHtml(c.sid) + '</td>' +
            (groupNames.length ? '<td>' + escapeHtml(c.group || '—') + '</td>' : '') +
            '<td class="ql-num tabular">' + fmtN(c.N) + '</td>' +
            '<td class="ql-num tabular">' + c.sObs + '</td>' +
            '<td class="ql-num tabular">' + richAt(c, rareDepth).toFixed(1) + '</td>';
          tbody.appendChild(tr);
        });
      tbl.appendChild(tbody);
      scrollDiv.appendChild(tbl);
      tableCard.appendChild(scrollDiv);
    }
    drawTable();

    // ---- repintado ligero al mover el slider de profundidad: solo el
    // gráfico + el panel de excluidas + la tabla, sin tocar el resto de
    // controles (mismo patrón que differentialAbundance.js refresh()) ----
    function redraw() {
      drawChart();
      drawExcluded();
      drawTable();
      if (editor) editor.sync();
    }
  }

  paint();
  const stop = subscribe(paint);
  return () => { stop(); rareGen++; if (editor) { editor.destroy(); editor = null; } };
}
