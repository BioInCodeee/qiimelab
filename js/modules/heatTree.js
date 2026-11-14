// Heat-tree (#/arbolcalor): el árbol taxonómico completo, con la abundancia
// codificada en el color y el tamaño de cada nodo, y la MISMA topología en
// todos los paneles.
//
// Todos los paneles van en UN solo <svg>, no en uno por panel: así el editor
// de figuras trabaja sobre la figura entera (que es lo que se exporta a una
// revista) y la comparación entre paneles no depende de que dos SVG
// independientes hayan quedado alineados.
//
// La lógica —árbol, agregación, contraste, disposición y etiquetas— vive en
// js/lib/heatTree.js y está cubierta por tests. Aquí solo hay interfaz.

import { state, subscribe } from '../state.js';
import { t, getLang } from '../lib/i18n.js';
import { svgEl, escapeHtml, delegateHover } from '../lib/dom.js';
import { attachChartEditor, getColorScaleOptions } from '../lib/chartEditor.js';
import { makeColorScale } from '../lib/colorScale.js';
import { createTooltip, showTooltip, hideTooltip } from '../lib/tooltip.js';
import { glossaryLinkHtml } from '../lib/glossaryLink.js';
import { mountExampleButtons, loadExampleCommunityData, loadRealCommunityData } from '../lib/exampleData.js';
import {
  parseTaxonPath, buildReferenceTree, abundanceByNode, compareTwoGroups,
  layoutDendrogram, layoutRadial, cullLabels, topContrastRows,
} from '../lib/heatTree.js';
import { mean } from '../lib/stats.js';

const PANEL_W = 300;
const PANEL_H = 420;
const PANEL_GAP = 26;
const LABEL_COL = 170;   // ancho reservado a la columna de etiquetas compartida
const MARGIN = { top: 54, right: 16, bottom: 58, left: 16 };

/** La columna de muestra de la tabla ancha: la única cabecera que no es un taxón. */
function detectSampleKey(table) {
  const headers = (table && table.headers) || [];
  const metaKey = state.metadata && state.metadata.sampleIdKey;
  if (metaKey && headers.includes(metaKey)) return metaKey;
  const notTaxon = headers.filter((h) => parseTaxonPath(h).length === 0);
  return notTaxon[0] || headers[0];
}

/** Columnas categóricas de los metadatos utilizables para agrupar. */
function groupingColumns() {
  if (!state.metadata) return [];
  const idKey = state.metadata.sampleIdKey;
  const out = [];
  state.metadata.headers.filter((h) => h !== idKey).forEach((col) => {
    const levels = new Map();
    state.metadata.rows.forEach((r) => {
      const v = String(r[col] == null ? '' : r[col]).trim();
      if (!v) return;
      levels.set(v, (levels.get(v) || 0) + 1);
    });
    // categórica utilizable: entre 2 y 12 niveles y al menos 2 muestras por nivel
    const usable = [...levels.values()].filter((n) => n >= 2).length;
    if (levels.size >= 2 && levels.size <= 12 && usable >= 2) {
      out.push({ col, levels: [...levels.keys()].sort() });
    }
  });
  return out;
}

function samplesOfLevel(col, level) {
  if (!state.metadata) return [];
  const idKey = state.metadata.sampleIdKey;
  return state.metadata.rows
    .filter((r) => String(r[col] == null ? '' : r[col]).trim() === level)
    .map((r) => String(r[idKey]));
}

export function render(container) {
  let mode = 'groups';       // 'samples' | 'groups' | 'contrast'
  let layoutKind = 'dendro'; // 'dendro' | 'radial'
  let groupCol = null;
  let contrastA = null;
  let contrastB = null;
  let maxDepth = 6;
  let maxLabels = 28;
  let logColor = true;
  let editor = null;
  let tip = null;

  function paint() {
    if (editor) { editor.destroy(); editor = null; }
    container.innerHTML = '';

    const header = document.createElement('header');
    header.className = 'ql-page-header';
    header.innerHTML =
      '<p class="ql-eyebrow">' + t('heattree.eyebrow') + '</p>' +
      '<h1 class="ql-page-title">' + t('heattree.title') + '</h1>' +
      '<p class="ql-page-sub">' + t('heattree.subtitle') + '</p>';
    container.appendChild(header);

    const levels = state.taxaBarplot && state.taxaBarplot.levels;
    const levelKeys = levels ? Object.keys(levels).sort((a, b) => Number(a) - Number(b)) : [];
    if (!levelKeys.length) {
      const card = document.createElement('div');
      card.className = 'ql-card ql-panel';
      card.innerHTML =
        '<div class="ql-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 3v6M12 9 7 15M12 9l5 6M7 15v6M17 15v6"/><circle cx="12" cy="3" r="1.6"/><circle cx="7" cy="15" r="1.6"/><circle cx="17" cy="15" r="1.6"/></svg>' +
        '<h3>' + t('heattree.emptyTitle') + '</h3><p>' + t('heattree.emptyDesc') + '</p>' +
        '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;"><a href="#/cargar" class="ql-btn">' + t('ui.goLoadData') + '</a></div></div>';
      container.appendChild(card);
      mountExampleButtons(card.querySelector('.ql-empty'), {
        real: loadRealCommunityData,
        synthetic: loadExampleCommunityData,
        download: ['barplot', 'metadata'],
      });
      return;
    }

    // El árbol se construye con el nivel MÁS PROFUNDO disponible: es el que
    // contiene la jerarquía completa, y agregar a un rango grueso es
    // justamente lo que el heat-tree viene a evitar.
    const table = levels[levelKeys[levelKeys.length - 1]];
    const sampleKey = detectSampleKey(table);
    const taxonCols = (table.headers || []).filter((h) => h !== sampleKey && parseTaxonPath(h).length > 0);
    const tree = buildReferenceTree(taxonCols);
    const abundance = abundanceByNode(tree, table, sampleKey);

    const groups = groupingColumns();
    if (groupCol === null) groupCol = groups.length ? groups[0].col : '';
    const activeGroup = groups.find((g) => g.col === groupCol) || null;
    if (mode !== 'samples' && !activeGroup) mode = 'samples';
    if (activeGroup) {
      if (!contrastA || !activeGroup.levels.includes(contrastA)) contrastA = activeGroup.levels[0];
      if (!contrastB || !activeGroup.levels.includes(contrastB) || contrastB === contrastA) {
        contrastB = activeGroup.levels.find((l) => l !== contrastA) || activeGroup.levels[0];
      }
    }

    // ---- controles ----
    const ctrl = document.createElement('div');
    ctrl.className = 'ql-card ql-panel';
    ctrl.innerHTML = '<h2>' + t('ui.controls') + '</h2>';

    const modeField = document.createElement('div');
    modeField.className = 'ql-field';
    modeField.innerHTML = '<label>' + t('heattree.modeLabel') + '</label>';
    const seg = document.createElement('div');
    seg.className = 'ql-segmented';
    const modes = [['samples', t('heattree.modeSamples')]];
    if (activeGroup) modes.push(['groups', t('heattree.modeGroups')], ['contrast', t('heattree.modeContrast')]);
    modes.forEach(([id, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-seg-btn' + (mode === id ? ' is-on' : '');
      b.textContent = label;
      b.addEventListener('click', () => { if (mode !== id) { mode = id; paint(); } });
      seg.appendChild(b);
    });
    modeField.appendChild(seg);
    modeField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('heattree.modeHelp') + '</p>');
    ctrl.appendChild(modeField);

    if (activeGroup && mode !== 'samples') {
      const gf = document.createElement('div');
      gf.className = 'ql-field';
      gf.innerHTML = '<label for="ht-group">' + t('heattree.groupBy') + '</label>';
      const sel = document.createElement('select');
      sel.id = 'ht-group';
      groups.forEach((g) => {
        const o = document.createElement('option');
        o.value = g.col; o.textContent = g.col; o.selected = g.col === groupCol;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => { groupCol = sel.value; contrastA = null; contrastB = null; paint(); });
      gf.appendChild(sel);
      ctrl.appendChild(gf);
    }

    if (mode === 'contrast' && activeGroup) {
      const cf = document.createElement('div');
      cf.className = 'ql-field';
      cf.innerHTML = '<label>' + t('heattree.contrastLabel') + '</label>';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
      [['A', () => contrastA, (v) => { contrastA = v; }], ['B', () => contrastB, (v) => { contrastB = v; }]]
        .forEach(([, get, set]) => {
          const sel = document.createElement('select');
          activeGroup.levels.forEach((l) => {
            const o = document.createElement('option');
            o.value = l; o.textContent = l; o.selected = get() === l;
            sel.appendChild(o);
          });
          sel.addEventListener('change', () => { set(sel.value); paint(); });
          row.appendChild(sel);
          const vs = document.createElement('span');
          vs.className = 'ql-field-help';
          vs.style.margin = '0';
          vs.textContent = t('heattree.vs');
          row.appendChild(vs);
        });
      row.removeChild(row.lastChild);
      cf.appendChild(row);
      cf.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('heattree.contrastHelp') + '</p>');
      ctrl.appendChild(cf);
    }

    const grid = document.createElement('div');
    grid.className = 'ql-plate-controls';

    const layoutF = document.createElement('div');
    layoutF.className = 'ql-field';
    layoutF.innerHTML = '<label for="ht-layout">' + t('heattree.layout') + '</label>';
    const lsel = document.createElement('select');
    lsel.id = 'ht-layout';
    [['dendro', t('heattree.layoutDendro')], ['radial', t('heattree.layoutRadial')]].forEach(([v, l]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = l; o.selected = layoutKind === v;
      lsel.appendChild(o);
    });
    lsel.addEventListener('change', () => { layoutKind = lsel.value; paint(); });
    layoutF.appendChild(lsel);
    grid.appendChild(layoutF);

    const depthF = document.createElement('div');
    depthF.className = 'ql-field';
    depthF.innerHTML = '<label for="ht-depth">' + t('heattree.maxDepth') + '</label>';
    const din = document.createElement('input');
    din.type = 'range'; din.id = 'ht-depth'; din.className = 'ql-range';
    din.min = '1'; din.max = String(Math.max(1, tree.depth)); din.step = '1';
    din.value = String(Math.min(maxDepth, tree.depth));
    const dout = document.createElement('output');
    dout.textContent = din.value;
    din.addEventListener('input', () => { dout.textContent = din.value; });
    din.addEventListener('change', () => { maxDepth = Number(din.value); paint(); });
    depthF.appendChild(din); depthF.appendChild(dout);
    depthF.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('heattree.maxDepthHelp') + '</p>');
    grid.appendChild(depthF);

    const labF = document.createElement('div');
    labF.className = 'ql-field';
    labF.innerHTML = '<label for="ht-labels">' + t('heattree.maxLabels') + '</label>';
    const lin = document.createElement('input');
    lin.type = 'range'; lin.id = 'ht-labels'; lin.className = 'ql-range';
    lin.min = '0'; lin.max = '60'; lin.step = '2';
    lin.value = String(maxLabels);
    const lout = document.createElement('output');
    lout.textContent = lin.value;
    lin.addEventListener('input', () => { lout.textContent = lin.value; });
    lin.addEventListener('change', () => { maxLabels = Number(lin.value); paint(); });
    labF.appendChild(lin); labF.appendChild(lout);
    labF.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('heattree.maxLabelsHelp') + '</p>');
    grid.appendChild(labF);

    if (mode !== 'contrast') {
      const logF = document.createElement('div');
      logF.className = 'ql-field';
      const lab = document.createElement('label');
      lab.style.cssText = 'display:flex;gap:8px;align-items:center;';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = logColor;
      cb.addEventListener('change', () => { logColor = cb.checked; paint(); });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(t('heattree.logColor')));
      logF.appendChild(lab);
      logF.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('heattree.logColorHelp') + '</p>');
      grid.appendChild(logF);
    }

    ctrl.appendChild(grid);
    container.appendChild(ctrl);

    // ---- paneles ----
    const panels = [];
    let contrast = null;
    if (mode === 'samples') {
      abundance.bySample.forEach((s, i) => {
        panels.push({ label: s, valueOf: (id) => abundance.values.get(id)[i] });
      });
    } else if (mode === 'groups') {
      activeGroup.levels.forEach((lv) => {
        const ids = samplesOfLevel(groupCol, lv)
          .map((s) => abundance.bySample.indexOf(s))
          .filter((i) => i >= 0);
        if (!ids.length) return;
        panels.push({
          label: lv + ' (n=' + ids.length + ')',
          valueOf: (id) => mean(ids.map((i) => abundance.values.get(id)[i])),
        });
      });
    } else {
      contrast = compareTwoGroups(
        abundance,
        samplesOfLevel(groupCol, contrastA),
        samplesOfLevel(groupCol, contrastB),
      );
      panels.push({
        label: contrastA + ' ' + t('heattree.vs') + ' ' + contrastB,
        valueOf: (id) => {
          const r = contrast.results.get(id);
          return r && Number.isFinite(r.log2fc) ? r.log2fc : NaN;
        },
      });
    }

    if (!panels.length) {
      container.insertAdjacentHTML('beforeend',
        '<div class="ql-card ql-panel"><p class="ql-panel-note">' + t('heattree.noPanels') + '</p></div>');
      return;
    }

    // Nodos visibles: hasta la profundidad elegida. La topología NO cambia con
    // el panel; solo se recorta por profundidad, y se recorta igual en todos.
    const visible = tree.nodes.filter((n) => n.depth > 0 && n.depth <= maxDepth);
    const pos = layoutKind === 'radial' ? layoutRadial(tree) : layoutDendrogram(tree);

    // Peso para elegir etiquetas: abundancia media global del nodo.
    const weight = new Map();
    visible.forEach((n) => {
      const arr = abundance.values.get(n.id);
      weight.set(n.id, arr ? mean(arr) : 0);
    });
    const labelled = cullLabels(visible, pos, weight, {
      maxDepth, maxLabels, minSeparation: layoutKind === 'radial' ? 0.08 : 0.03,
    });

    // Escala de color: secuencial para abundancia, divergente para el log2FC.
    const allValues = [];
    panels.forEach((p) => visible.forEach((n) => {
      const v = p.valueOf(n.id);
      if (Number.isFinite(v)) allValues.push(v);
    }));
    const csOv = getColorScaleOptions('heattree');
    let domain;
    if (mode === 'contrast') {
      const m = Math.max(1, ...allValues.map((v) => Math.abs(v)));
      domain = [-m, m];
    } else if (logColor) {
      const pos0 = allValues.filter((v) => v > 0);
      domain = [0, Math.log10(1 + (pos0.length ? Math.max(...pos0) : 1))];
    } else {
      domain = [0, Math.max(1, ...allValues)];
    }
    const colorScale = makeColorScale({
      type: mode === 'contrast' ? 'divergent' : 'sequential',
      domain,
      midpoint: mode === 'contrast' ? 0 : undefined,
      ...csOv,
    });
    const colorFor = (v) => {
      if (!Number.isFinite(v)) return 'var(--surface-2)';
      if (mode !== 'contrast' && logColor) return colorScale.scale(Math.log10(1 + Math.max(0, v))) || 'var(--surface-2)';
      return colorScale.scale(v) || 'var(--surface-2)';
    };

    // Tamaño: abundancia en los modos descriptivos, significación en contraste.
    const maxAbs = Math.max(1, ...allValues.map((v) => Math.abs(v)));
    const radiusFor = (panel, n) => {
      if (mode === 'contrast') {
        const r = contrast.results.get(n.id);
        if (!r || !Number.isFinite(r.q)) return 2.5;
        return 2.5 + 4.5 * Math.min(1, -Math.log10(Math.max(r.q, 1e-6)) / 4);
      }
      const v = panel.valueOf(n.id);
      if (!Number.isFinite(v) || v <= 0) return 1.8;
      return 2 + 5 * Math.sqrt(Math.min(1, Math.abs(v) / maxAbs));
    };

    const needsLabelCol = layoutKind === 'dendro' && labelled.size > 0;
    const W = MARGIN.left + panels.length * PANEL_W + (panels.length - 1) * PANEL_GAP +
      (needsLabelCol ? LABEL_COL : 0) + MARGIN.right;
    const H = MARGIN.top + PANEL_H + MARGIN.bottom;

    const chartCard = document.createElement('div');
    chartCard.className = 'ql-card ql-panel';
    container.appendChild(chartCard);

    const svg = svgEl('svg', {
      class: 'ql-svg', viewBox: '0 0 ' + W + ' ' + H,
      width: '100%', role: 'img', 'aria-label': t('heattree.figAria'),
    });
    chartCard.appendChild(svg);

    svg.appendChild(svgEl('text', {
      'data-ce': 'title', x: W / 2, y: 26, 'text-anchor': 'middle', class: 'ce-title',
    }, t('heattree.figTitle')));

    tip = createTooltip(chartCard);

    panels.forEach((panel, pi) => {
      const ox = MARGIN.left + pi * (PANEL_W + PANEL_GAP);
      const g = svgEl('g', { transform: 'translate(' + ox + ',' + MARGIN.top + ')', 'data-panel': String(pi) });
      svg.appendChild(g);

      g.appendChild(svgEl('text', {
        x: PANEL_W / 2, y: -12, 'text-anchor': 'middle', class: 'ce-axis-title',
      }, panel.label));

      const X = (p) => (layoutKind === 'radial' ? (p.x + 1) / 2 : p.x) * PANEL_W;
      const Y = (p) => (layoutKind === 'radial' ? (p.y + 1) / 2 : p.y) * PANEL_H;

      // ramas primero, para que los nodos queden encima
      const edges = svgEl('g', { 'data-ce': 'branches', stroke: 'var(--border)', fill: 'none' });
      g.appendChild(edges);
      visible.forEach((n) => {
        const parentId = n.path.slice(0, -1).join(';');
        const pp = pos.get(parentId);
        const np = pos.get(n.id);
        if (!pp || !np) return;
        if (parentId && !visible.some((v) => v.id === parentId)) return;
        edges.appendChild(svgEl('line', {
          x1: X(pp), y1: Y(pp), x2: X(np), y2: Y(np), 'stroke-width': 1,
        }));
      });

      const nodesG = svgEl('g', { 'data-ce': 'nodes' });
      g.appendChild(nodesG);
      // Capa de impacto aparte: en un arbol denso los nodos de poca abundancia
      // son de 2-3 px y nadie acierta a senalarlos. El circulo visible lleva
      // el dato y el transparente, mas grande, recoge el puntero.
      const hitG = svgEl('g', { 'data-hit': 'nodes', fill: 'transparent' });
      visible.forEach((n) => {
        const p = pos.get(n.id);
        if (!p) return;
        const v = panel.valueOf(n.id);
        const r = radiusFor(panel, n);
        nodesG.appendChild(svgEl('circle', {
          cx: X(p), cy: Y(p), r,
          fill: colorFor(v),
          // anillo del color de la superficie, no un borde de color: es lo que
          // mantiene legible un nodo que se solapa con otro o con una rama
          stroke: 'var(--surface)', 'stroke-width': 1.2,
          'pointer-events': 'none',
        }));
        hitG.appendChild(svgEl('circle', {
          cx: X(p), cy: Y(p), r: Math.max(r + 2, 6), 'data-node': n.id,
        }));
      });
      g.appendChild(hitG);

      // Delegación de eventos, no un listener por nodo: un heat-tree profundo
      // tiene cientos de nodos por panel (es el caso que el helper
      // delegateHover() de dom.js existe para evitar).
      delegateHover(hitG, 'circle[data-node]', {
        onEnter: (el) => {
          const id = el.getAttribute('data-node');
          const n = tree.byId.get(id);
          if (!n) return;
          const p = pos.get(id);
          const v = panel.valueOf(id);
          let body = escapeHtml(n.path.join(' › ')) + '<br>';
          if (mode === 'contrast') {
            const r = contrast.results.get(id);
            body += r
              ? t('heattree.tipLog2fc') + ': ' + r.log2fc.toFixed(2) + ' · q = ' +
                (Number.isFinite(r.q) ? r.q.toExponential(2) : '—')
              : t('heattree.tipNotTested');
          } else {
            body += t('heattree.tipAbundance') + ': ' + (Number.isFinite(v) ? v.toFixed(3) : '—');
          }
          showTooltip(chartCard, ox + X(p), MARGIN.top + Y(p), escapeHtml(n.name), body,
            { svg, W, H, tooltip: tip, rawHtml: true });
        },
        onLeave: () => hideTooltip(tip),
      });
    });

    // Columna de etiquetas COMPARTIDA: en dendrograma la posición vertical de
    // un clado es idéntica en todos los paneles, así que una sola columna de
    // nombres sirve para toda la figura. Es la ventaja directa de la topología
    // compartida, y ahorra repetir cientos de nombres por panel.
    if (needsLabelCol) {
      const lx = MARGIN.left + panels.length * PANEL_W + (panels.length - 1) * PANEL_GAP + 10;
      const lg = svgEl('g', { 'data-ce': 'labels', transform: 'translate(' + lx + ',' + MARGIN.top + ')' });
      svg.appendChild(lg);
      visible.forEach((n) => {
        if (!labelled.has(n.id)) return;
        const p = pos.get(n.id);
        lg.appendChild(svgEl('text', {
          x: 0, y: p.y * PANEL_H + 3, class: 'ce-tick', 'font-size': 10,
        }, n.name));
      });
    } else if (labelled.size) {
      const g0 = svg.querySelector('[data-panel="0"]');
      const lg = svgEl('g', { 'data-ce': 'labels' });
      g0.appendChild(lg);
      visible.forEach((n) => {
        if (!labelled.has(n.id)) return;
        const p = pos.get(n.id);
        lg.appendChild(svgEl('text', {
          x: (p.x + 1) / 2 * PANEL_W + 6, y: (p.y + 1) / 2 * PANEL_H + 3,
          class: 'ce-tick', 'font-size': 9,
        }, n.name));
      });
    }

    // leyenda de la escala
    const legend = svgEl('g', { 'data-ce': 'legend', transform: 'translate(' + MARGIN.left + ',' + (H - 34) + ')' });
    svg.appendChild(legend);
    const gradId = 'ht-grad-' + Math.random().toString(36).slice(2, 8);
    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id: gradId, x1: '0', x2: '1', y1: '0', y2: '0' });
    colorScale.legendStops.forEach((st) => {
      grad.appendChild(svgEl('stop', { offset: st.offset + '%', 'stop-color': st.color }));
    });
    defs.appendChild(grad);
    svg.appendChild(defs);
    legend.appendChild(svgEl('rect', { x: 0, y: 0, width: 200, height: 10, rx: 2, fill: 'url(#' + gradId + ')' }));
    const fmt = (v) => (Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.01) ? v.toExponential(1) : v.toFixed(2));
    legend.appendChild(svgEl('text', { x: 0, y: 23, 'font-size': 10, class: 'ce-tick' }, fmt(domain[0])));
    legend.appendChild(svgEl('text', { x: 200, y: 23, 'font-size': 10, 'text-anchor': 'end', class: 'ce-tick' }, fmt(domain[1])));
    legend.appendChild(svgEl('text', { x: 212, y: 9, 'font-size': 10, class: 'ce-tick' },
      mode === 'contrast' ? t('heattree.legendLog2fc')
        : (logColor ? t('heattree.legendLogAbundance') : t('heattree.legendAbundance'))));

    editor = attachChartEditor({
      key: 'heattree', svg, mount: chartCard, lang: getLang(),
      filename: t('heattree.title'),
      elements: [
        { id: 'title', selector: '[data-ce="title"]' },
        { id: 'labels', selector: '[data-ce="labels"]', kind: 'group' },
        { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
      ],
      colorScale: mode === 'contrast'
        ? { type: 'divergent', domain, defaultMidpoint: 0 }
        : { type: 'sequential', domain },
      onColorScaleChange: () => paint(),
    });

    // ---- vista en tabla (contraste) ----
    // No es un extra: la figura pone el dato en el color, asi que hace falta
    // una tabla para quien no distingue esos colores, para quien la imprime en
    // gris, y para quien necesita el numero exacto en vez de estimarlo de una
    // rampa. Ademas es lo que se pega en el material suplementario.
    if (mode === 'contrast') {
      const rows = topContrastRows(contrast, tree, { limit: 25, maxQ: 0.05 });
      const tableCard = document.createElement('section');
      tableCard.className = 'ql-card ql-panel';
      tableCard.innerHTML = '<h2>' + t('heattree.tableTitle') + '</h2>' +
        '<p class="ql-panel-note">' + t('heattree.tableNote') + '</p>';
      if (!rows.length) {
        tableCard.insertAdjacentHTML('beforeend',
          '<p class="ql-field-help">' + t('heattree.tableEmpty') + '</p>');
      } else {
        const tbl = document.createElement('table');
        tbl.className = 'ql-table';
        tbl.innerHTML = '<thead><tr>' +
          '<th>' + t('heattree.colTaxon') + '</th>' +
          '<th>' + t('heattree.colRank') + '</th>' +
          '<th>' + t('heattree.colLog2fc') + '</th>' +
          '<th>p</th><th>q</th></tr></thead>';
        const tb = document.createElement('tbody');
        rows.forEach((r) => {
          const tr = document.createElement('tr');
          tr.innerHTML =
            '<td><strong>' + escapeHtml(r.name) + '</strong><br>' +
            '<span class="ql-field-help" style="margin:0;">' + escapeHtml(r.path) + '</span></td>' +
            '<td class="tabular">' + r.depth + '</td>' +
            '<td class="tabular">' + r.log2fc.toFixed(2) + '</td>' +
            '<td class="tabular">' + r.p.toExponential(2) + '</td>' +
            '<td class="tabular">' + r.q.toExponential(2) + '</td>';
          tb.appendChild(tr);
        });
        tbl.appendChild(tb);
        tableCard.appendChild(tbl);
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'ql-btn';
        copyBtn.style.marginTop = '10px';
        copyBtn.textContent = t('heattree.copyTable');
        copyBtn.addEventListener('click', () => {
          const tsv = [[t('heattree.colTaxon'), t('heattree.colRank'), 'log2FC', 'p', 'q'].join('\t')]
            .concat(rows.map((r) => [r.path, r.depth, r.log2fc.toFixed(4), r.p, r.q].join('\t')))
            .join('\n');
          try {
            navigator.clipboard.writeText(tsv);
            copyBtn.textContent = t('heattree.copiedTable');
            setTimeout(() => { copyBtn.textContent = t('heattree.copyTable'); }, 1600);
          } catch (e) { /* el portapapeles puede fallar sin permiso */ }
        });
        tableCard.appendChild(copyBtn);
      }
      container.appendChild(tableCard);
    }

    // ---- notas metodológicas ----
    const note = document.createElement('div');
    note.className = 'ql-card ql-panel';
    note.innerHTML = '<h2>' + t('heattree.notesTitle') + '</h2>' +
      '<p class="ql-panel-note">' + t('heattree.noteShared') + '</p>' +
      '<p class="ql-panel-note">' + t('heattree.noteDepth', { n: maxDepth, total: tree.depth }) + '</p>';
    if (mode === 'contrast') {
      note.insertAdjacentHTML('beforeend',
        '<p class="ql-panel-note">' + t('heattree.noteContrast', {
          tested: contrast.tested,
          pseudo: contrast.pseudocount.toExponential(2),
        }) + ' ' + glossaryLinkHtml('fdr') + '</p>');
    }
    container.appendChild(note);
  }

  paint();
  const unsub = subscribe(() => paint());
  return function cleanup() {
    if (editor) { editor.destroy(); editor = null; }
    if (tip) { hideTooltip(tip); tip = null; }
    unsub();
    container.innerHTML = '';
  };
}
