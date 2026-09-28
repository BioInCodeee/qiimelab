// Taxones compartidos y exclusivos entre grupos de metadatos.
// Entrada: tabla de conteos taxón × muestra (slot `taxaCounts`) + metadatos
// con la columna de grupo. Presencia = conteo por encima de un umbral en al
// menos N muestras del grupo. Hasta 4 grupos → diagrama de Venn dibujado a
// mano; 5+ → vista tipo UpSet (barras de intersección).

import { state, subscribe } from '../state.js';
import { t, getLang } from '../lib/i18n.js';
import { makeGroupResolver } from '../lib/sampleMatch.js';
import { drawVenn, drawUpset, popcount } from '../lib/setDiagram.js';
import { loadRealCounts, loadExampleCounts, loadExampleCounts10Sets, mountExampleButtons } from '../lib/exampleData.js';
import { attachChartEditor } from '../lib/chartEditor.js';
import { escapeHtml } from '../lib/dom.js';

function emptyState(container) {
  const card = document.createElement('div');
  card.className = 'ql-card ql-panel';
  card.innerHTML =
    '<div class="ql-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">' +
    '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>' +
    '<h3>' + t('venn.emptyTitle') + '</h3>' +
    '<p>' + t('venn.emptyDesc') + '</p>' +
    '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">' +
    '<a href="#/cargar" class="ql-btn">' + t('ui.goLoadData') + '</a></div></div>';
  mountExampleButtons(card.querySelector('.ql-empty'), {
    real: loadRealCounts,
    synthetic: loadExampleCounts,
    syntheticLabel: t('venn.exSynthLabel'),
    download: ['counts', 'metadata'],
  });
  card.querySelector('.ql-empty').appendChild(tenSetsButton());
  container.appendChild(card);
}

/** Botón del ejemplo sintético con 10 grupos (Fase 3, C1). */
function tenSetsButton() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ql-btn ql-btn-ghost ql-venn-ten';
  b.style.marginTop = '8px';
  b.textContent = t('venn.exTenLabel');
  b.addEventListener('click', () => loadExampleCounts10Sets());
  return b;
}

export function render(container) {
  let taxonCol = null;
  let transposed = false;
  let groupCol = null;
  let minCount = 0;
  let minSamples = 1;
  let viewMode = 'auto'; // 'auto' | 'venn' | 'upset'
  let setCount = null;    // cuántos conjuntos representar (null = todos) — Fase 3, C1
  let vennShapeChoice = null; // 'circles' | 'rect' elegido a mano; null = por defecto (rect con 4 conjuntos, circles con 2-3) — solo aplica a un Venn, no a UpSet
  let openMask = null;    // región seleccionada en la tabla
  let editor = null;

  function paint() {
    if (editor) { editor.destroy(); editor = null; }
    container.innerHTML = '';
    const header = document.createElement('header');
    header.className = 'ql-page-header';
    header.innerHTML =
      '<p class="ql-eyebrow">' + t('venn.eyebrow') + '</p>' +
      '<h1 class="ql-page-title">' + t('venn.title') + '</h1>' +
      '<p class="ql-page-sub">' + t('venn.subtitle') + '</p>';
    container.appendChild(header);

    if (!state.taxaCounts || !state.metadata) { emptyState(container); return; }

    const tc = state.taxaCounts;
    const meta = state.metadata;

    // --- mapeo de columnas ---
    if (taxonCol === null) taxonCol = tc.taxonKey && tc.headers.includes(tc.taxonKey) ? tc.taxonKey : tc.headers[0];
    const groupOptions = meta.headers.filter((h) => h !== meta.sampleIdKey);
    if (!groupCol || !groupOptions.includes(groupCol)) {
      // por defecto: la primera columna con exactamente 2 valores distintos
      // (Venn de 2 círculos, lo que se entiende más rápido); si no hay, la de
      // menos valores distintos.
      const distinct = (h) => new Set(meta.rows.map((r) => String(r[h] ?? '').trim()).filter(Boolean)).size;
      const two = groupOptions.filter((h) => distinct(h) === 2);
      const multi = groupOptions.filter((h) => distinct(h) >= 2).sort((a, b) => distinct(a) - distinct(b));
      groupCol = two[0] || multi[0] || groupOptions[0];
    }

    const mapCard = document.createElement('section');
    mapCard.className = 'ql-card ql-panel';
    mapCard.style.marginBottom = '20px';
    mapCard.innerHTML = '<h2>' + t('venn.mapTitle') + '</h2><p class="ql-panel-note">' + t('venn.mapNote') + '</p>';
    const mapGrid = document.createElement('div');
    mapGrid.className = 'ql-mapping-grid';

    const fTaxon = document.createElement('div');
    fTaxon.className = 'ql-field';
    fTaxon.innerHTML = '<label>' + t('venn.taxonColumn') + '</label>';
    const selTaxon = document.createElement('select');
    tc.headers.forEach((h, i) => {
      const o = document.createElement('option');
      o.value = h; o.textContent = h || t('ui.columnN', { n: i + 1 });
      if (h === taxonCol) o.selected = true;
      selTaxon.appendChild(o);
    });
    selTaxon.addEventListener('change', () => { taxonCol = selTaxon.value; openMask = null; paint(); });
    fTaxon.appendChild(selTaxon);
    mapGrid.appendChild(fTaxon);

    const fT = document.createElement('div');
    fT.className = 'ql-field';
    fT.innerHTML = '<label>' + t('venn.orientation') + '</label>';
    const tWrap = document.createElement('label');
    tWrap.style.cssText = 'display:flex;align-items:center;gap:8px;font-weight:400;font-size:13px;';
    const tChk = document.createElement('input');
    tChk.type = 'checkbox'; tChk.checked = transposed; tChk.style.width = 'auto';
    tChk.addEventListener('change', () => { transposed = tChk.checked; openMask = null; paint(); });
    tWrap.appendChild(tChk);
    tWrap.appendChild(document.createTextNode(t('venn.transposed')));
    fT.appendChild(tWrap);
    mapGrid.appendChild(fT);
    mapCard.appendChild(mapGrid);
    container.appendChild(mapCard);

    // --- matriz (respetando traspuesta) ---
    const matrix = buildMatrix(tc, taxonCol, transposed);
    if (!matrix || matrix.taxa.length === 0 || matrix.samples.length === 0) {
      const warn = document.createElement('div');
      warn.className = 'ql-card ql-panel';
      warn.innerHTML = '<p class="ql-field-help">' + t('venn.cannotRead') + '</p>';
      container.appendChild(warn);
      return;
    }

    // --- muestra → grupo (emparejado tolerante a sufijos: A-1 ↔ A-1-16S-…) ---
    const resolveGroup = makeGroupResolver(meta, groupCol);

    const groupOf = {};
    let matched = 0;
    matrix.samples.forEach((s) => { const g = resolveGroup(s); if (g) { groupOf[s] = g; matched++; } });
    const allGroups = Array.from(new Set(matrix.samples.map((s) => groupOf[s]).filter(Boolean))).sort();
    // "Conjuntos a mostrar": los K primeros (orden alfabético). Las regiones
    // se recalculan SOLO con esos K conjuntos, así que cada una sigue siendo
    // la intersección exacta que representa.
    const K = setCount ? Math.max(Math.min(2, allGroups.length), Math.min(setCount, allGroups.length)) : allGroups.length;
    const groups = allGroups.slice(0, K);

    // --- conjuntos de presencia por grupo ---
    const groupSamples = {};
    groups.forEach((g) => { groupSamples[g] = matrix.samples.filter((s) => groupOf[s] === g); });
    const presence = new Map(); // grupo -> Set(taxon)
    groups.forEach((g) => {
      const set = new Set();
      matrix.taxa.forEach((t, ti) => {
        let hits = 0;
        for (const s of groupSamples[g]) { if (matrix.value(ti, s) > minCount) hits++; }
        if (hits >= minSamples) set.add(t);
      });
      presence.set(g, set);
    });

    // --- partición: taxón → máscara de grupos en los que está ---
    const byMask = new Map(); // mask -> [taxa]
    matrix.taxa.forEach((t) => {
      let mask = 0;
      groups.forEach((g, gi) => { if (presence.get(g).has(t)) mask |= (1 << gi); });
      if (mask === 0) return;
      if (!byMask.has(mask)) byMask.set(mask, []);
      byMask.get(mask).push(t);
    });

    const useUpset = viewMode === 'upset' || (viewMode === 'auto' && groups.length >= 5);
    // con 4 conjuntos, rectángulos por defecto (Fase 3, C1: lo acordado para 4+);
    // las 4 elipses siguen disponibles — también son un Venn correcto
    const vennShape = vennShapeChoice || (groups.length === 4 ? 'rect' : 'circles');

    // ---- controles (tira horizontal, ancho completo) ----
    const controls = document.createElement('section');
    controls.className = 'ql-card ql-panel';
    controls.style.marginBottom = '20px';
    controls.innerHTML = '<h2>' + t('ui.controls') + '</h2>';
    const cGrid = document.createElement('div');
    cGrid.className = 'ql-mapping-grid';

    const fGroup = document.createElement('div');
    fGroup.className = 'ql-field';
    fGroup.innerHTML = '<label>' + t('venn.groupBy') + '</label>';
    const selGroup = document.createElement('select');
    groupOptions.forEach((h) => {
      const n = new Set(meta.rows.map((r) => String(r[h] ?? '').trim()).filter(Boolean)).size;
      const o = document.createElement('option');
      o.value = h; o.textContent = t('venn.groupOption', { name: h, n });
      if (h === groupCol) o.selected = true;
      selGroup.appendChild(o);
    });
    selGroup.addEventListener('change', () => { groupCol = selGroup.value; openMask = null; setCount = null; paint(); });
    fGroup.appendChild(selGroup);
    fGroup.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('venn.groupHelp') + '</p>');
    cGrid.appendChild(fGroup);

    const fCount = document.createElement('div');
    fCount.className = 'ql-field';
    fCount.innerHTML = '<label>' + t('venn.countLabel') + '</label>' +
      '<input type="number" min="0" step="1" value="' + minCount + '" id="vnCount" />' +
      '<p class="ql-field-help">' + t('venn.countHelp') + '</p>';
    cGrid.appendChild(fCount);

    const fSamp = document.createElement('div');
    fSamp.className = 'ql-field';
    fSamp.innerHTML = '<label>' + t('venn.sampLabel') + '</label>' +
      '<input type="number" min="1" step="1" value="' + minSamples + '" id="vnSamp" />' +
      '<p class="ql-field-help">' + t('venn.sampHelp') + '</p>';
    cGrid.appendChild(fSamp);

    if (allGroups.length > 2) {
      const fN = document.createElement('div');
      fN.className = 'ql-field';
      fN.innerHTML = '<label for="vnSets">' + t('venn.setCountLabel') + '</label>' +
        '<input type="number" id="vnSets" min="2" max="' + allGroups.length + '" step="1" value="' + K + '" />' +
        '<p class="ql-field-help">' + t('venn.setCountHelp', { n: allGroups.length }) + '</p>';
      fN.querySelector('#vnSets').addEventListener('change', (e) => {
        const v = parseInt(e.target.value, 10);
        setCount = Number.isFinite(v) ? Math.max(2, Math.min(allGroups.length, v)) : null;
        openMask = null; paint();
      });
      cGrid.appendChild(fN);
    }
    if (allGroups.length < 10 && state.metadata && state.metadata.synthetic) {
      const fTen = document.createElement('div');
      fTen.className = 'ql-field';
      fTen.appendChild(tenSetsButton());
      cGrid.appendChild(fTen);
    }

    if (groups.length >= 3 && groups.length <= 4) {
      const fView = document.createElement('div');
      fView.className = 'ql-field';
      fView.innerHTML = '<label>' + t('venn.viewLabel') + '</label>';
      const selView = document.createElement('select');
      [['auto', t('venn.viewAuto')], ['upset', t('venn.viewUpset')]].forEach(([v, lbl]) => {
        const o = document.createElement('option'); o.value = v; o.textContent = lbl;
        if ((viewMode === 'venn' ? 'auto' : viewMode) === v) o.selected = true;
        selView.appendChild(o);
      });
      selView.addEventListener('change', () => { viewMode = selView.value; paint(); });
      fView.appendChild(selView);
      cGrid.appendChild(fView);
    }
    if (!useUpset && groups.length >= 2 && groups.length <= 4) {
      const fShape = document.createElement('div');
      fShape.className = 'ql-field';
      fShape.innerHTML = '<label>' + t('venn.shapeLabel') + '</label>';
      const shapeSeg = document.createElement('div');
      shapeSeg.className = 'ql-segmented';
      [['circles', t('venn.shapeCircles')], ['rect', t('venn.shapeRect')]].forEach(([v, lbl]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ql-seg-btn' + (vennShape === v ? ' is-on' : '');
        b.textContent = lbl;
        b.addEventListener('click', () => { if (vennShape !== v) { vennShapeChoice = v; paint(); } });
        shapeSeg.appendChild(b);
      });
      fShape.appendChild(shapeSeg);
      if (groups.length === 4) {
        fShape.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('venn.shapeHelp4') + '</p>');
      }
      cGrid.appendChild(fShape);
    }
    controls.appendChild(cGrid);

    const totalPresent = new Set();
    byMask.forEach((arr) => arr.forEach((t) => totalPresent.add(t)));
    const coreMask = groups.length ? (1 << groups.length) - 1 : 0;
    const stats = document.createElement('div');
    stats.className = 'ql-stats';
    stats.style.marginTop = '16px';
    stats.innerHTML =
      '<div class="ql-stat"><div class="ql-stat-label">' + t('venn.statGroups') + '</div><div class="ql-stat-value" style="font-size:20px;">' + groups.length + '</div></div>' +
      '<div class="ql-stat"><div class="ql-stat-label">' + t('venn.statTotal') + '</div><div class="ql-stat-value" style="font-size:20px;">' + totalPresent.size + '</div></div>' +
      '<div class="ql-stat"><div class="ql-stat-label">' + t('venn.statCore') + '</div><div class="ql-stat-value" style="font-size:20px;">' + ((byMask.get(coreMask) || []).length) + '</div></div>' +
      '<div class="ql-stat"><div class="ql-stat-label">' + t('venn.statExclusive') + '</div><div class="ql-stat-value" style="font-size:20px;">' +
        groups.reduce((a, _, gi) => a + ((byMask.get(1 << gi) || []).length), 0) + '</div></div>';
    controls.appendChild(stats);

    if (matched < matrix.samples.length) {
      const w = document.createElement('p');
      w.className = 'ql-field-help';
      w.style.color = 'var(--warning)';
      w.textContent = t('venn.unmatched', { n: matrix.samples.length - matched, total: matrix.samples.length });
      controls.appendChild(w);
    }
    container.appendChild(controls);

    controls.querySelector('#vnCount').addEventListener('change', (e) => { minCount = Math.max(0, parseInt(e.target.value, 10) || 0); openMask = null; paint(); });
    controls.querySelector('#vnSamp').addEventListener('change', (e) => { minSamples = Math.max(1, parseInt(e.target.value, 10) || 1); openMask = null; paint(); });

    // ---- gráfico (ancho completo) ----
    const chartPanel = document.createElement('section');
    chartPanel.className = 'ql-card ql-panel';
    chartPanel.innerHTML = '<p class="ql-panel-note" style="margin-bottom:4px;">' + (useUpset ? t('venn.chartNoteUpset') + (groups.length > 7 ? ' ' + t('venn.upsetManyNote') : '') : t('venn.chartNoteVenn')) + '</p>';
    const chartWrap = document.createElement('div');
    chartWrap.className = 'ql-chartwrap scroll-x';
    if (!useUpset) { chartWrap.style.maxWidth = '620px'; chartWrap.style.margin = '0 auto'; }
    chartPanel.appendChild(chartWrap);
    container.appendChild(chartPanel);

    let chartSvg = null;
    if (groups.length < 2) {
      chartWrap.innerHTML = '<p class="ql-field-help">' + t('venn.need2') + '</p>';
    } else if (useUpset) {
      chartSvg = drawUpset(chartWrap, groups, byMask, presence, (mask) => { openMask = mask; renderTable(); });
    } else {
      chartSvg = drawVenn(chartWrap, groups, byMask, (mask) => { openMask = mask; renderTable(); }, { shape: vennShape });
    }

    if (chartSvg) {
      const vb = chartSvg.viewBox.baseVal;
      const labelIds = groups.map((_, gi) => ({ id: (useUpset ? 'set' : 'grp') + gi, selector: '[data-ce="' + (useUpset ? 'set' : 'grp') + gi + '"]' }));
      // 'venn' se mantiene para UpSet y para el Venn de círculos (comportamiento
      // previo, para no perder estilos ya guardados); el rectángulos es modo
      // nuevo -> clave propia, como '-lollipop'/'-heatmap' en differentialAbundance.js.
      const chartKey = (!useUpset && vennShape === 'rect') ? 'venn-rect' : 'venn';
      editor = attachChartEditor({
        key: chartKey, svg: chartSvg, mount: chartPanel, filename: (useUpset ? 'upset' : 'venn') + '-' + groupCol, lang: getLang(),
        elements: [
          { id: 'title', create: { text: useUpset ? t('venn.chartUpset') : t('venn.chartVenn'), x: vb.x + vb.width / 2, y: vb.y + 16, anchor: 'middle', cls: 'ce-title' } },
          ...labelIds,
        ],
        paletteSeries: groups.map((g, i) => ({ id: 's' + i, label: g })),
        paletteType: 'categorical',
        onReset: () => paint(),
      });
    }

    // ---- tabla de regiones ----
    const tableCard = document.createElement('section');
    tableCard.className = 'ql-card ql-panel';
    tableCard.style.marginTop = '20px';
    tableCard.innerHTML = '<h2>' + t('venn.tableTitle') + '</h2><p class="ql-panel-note">' + t('venn.tableNote') + '</p>';
    const tableHost = document.createElement('div');
    tableCard.appendChild(tableHost);
    container.appendChild(tableCard);

    function renderTable() {
      // re-pinta solo la parte visual seleccionada + la tabla
      container.querySelectorAll('.vn-region').forEach((el) => {
        el.classList.toggle('is-active', String(el.dataset.mask) === String(openMask));
      });
      const entries = Array.from(byMask.entries())
        .sort((a, b) => (popcount(a[0]) - popcount(b[0])) || (b[1].length - a[1].length));
      tableHost.innerHTML = '';
      const scroll = document.createElement('div');
      scroll.className = 'ql-table-scroll';
      const tbl = document.createElement('table');
      tbl.className = 'ql-table';
      tbl.innerHTML = '<thead><tr><th>' + t('venn.colGroups') + '</th><th>' + t('venn.colType') + '</th><th>' + t('venn.colCount') + '</th></tr></thead>';
      const tbody = document.createElement('tbody');
      entries.forEach(([mask, taxa]) => {
        const inGroups = groups.filter((_, gi) => (mask >> gi) & 1);
        const type = inGroups.length === 1 ? t('venn.typeExclusive') : inGroups.length === groups.length ? t('venn.typeCore') : t('venn.typeShared', { n: inGroups.length });
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        if (String(mask) === String(openMask)) tr.style.background = 'color-mix(in srgb, var(--accent) 12%, transparent)';
        tr.innerHTML = '<td>' + inGroups.map(escapeHtml).join(' ∩ ') + '</td><td>' + type + '</td><td class="ql-num tabular">' + taxa.length + '</td>';
        tr.addEventListener('click', () => { openMask = (openMask === mask ? null : mask); renderTable(); });
        tbody.appendChild(tr);
        if (String(mask) === String(openMask)) {
          const tr2 = document.createElement('tr');
          const td = document.createElement('td');
          td.colSpan = 3;
          td.style.cssText = 'background:var(--page);font-size:12px;line-height:1.8;';
          td.innerHTML = taxa.slice().sort().map((t) => '<span class="mono" style="display:inline-block;margin:2px 8px 2px 0;">' + escapeHtml(t) + '</span>').join('');
          tr2.appendChild(td);
          tbody.appendChild(tr2);
        }
      });
      tbl.appendChild(tbody);
      scroll.appendChild(tbl);
      tableHost.appendChild(scroll);
    }
    renderTable();
  }

  paint();
  const stop = subscribe(paint);
  return () => { stop(); if (editor) { editor.destroy(); editor = null; } };
}

// ---- construir la matriz taxón × muestra ----
function buildMatrix(tc, taxonCol, transposed) {
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  if (!transposed) {
    const sampleCols = tc.headers.filter((h) => h !== taxonCol);
    const taxa = tc.rows.map((r) => String(r[taxonCol] ?? '').trim()).filter(Boolean);
    const rowByTaxon = new Map();
    tc.rows.forEach((r) => rowByTaxon.set(String(r[taxonCol] ?? '').trim(), r));
    return {
      taxa, samples: sampleCols,
      value: (ti, sample) => num((rowByTaxon.get(taxa[ti]) || {})[sample]),
    };
  }
  // traspuesta: filas = muestras, columnas (menos taxonCol) = taxones
  const taxa = tc.headers.filter((h) => h !== taxonCol);
  const samples = tc.rows.map((r) => String(r[taxonCol] ?? '').trim()).filter(Boolean);
  const rowBySample = new Map();
  tc.rows.forEach((r) => rowBySample.set(String(r[taxonCol] ?? '').trim(), r));
  return {
    taxa, samples,
    value: (ti, sample) => num((rowBySample.get(sample) || {})[taxa[ti]]),
  };
}
