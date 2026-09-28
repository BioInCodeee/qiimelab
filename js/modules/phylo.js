// Árbol filogenético (#/arbol): a partir de secuencias FASTA (16S/ITS),
// alineamiento progresivo simplificado + Neighbor-Joining. Autónomo como
// #/primers/#/ufc: no lee ni escribe el estado global (no es una salida de
// QIIME2 en sí — el usuario pega sus propias secuencias), persiste en
// localStorage, no entra en la sesión guardable ni en el informe combinado.
//
// Pipeline (ver js/lib/phyloAlign.js, phyloDistance.js, neighborJoining.js):
//   1. distancias por pares (Needleman-Wunsch) entre las secuencias crudas
//   2. árbol guía RÁPIDO — reutiliza upgma()/leafOrder() de stats.js, el
//      mismo clustering que ordena el mapa de calor de diversidad beta
//   3. fusión progresiva de perfiles siguiendo ese árbol guía
//   4. matriz de distancias (p-distance / Jukes-Cantor) sobre el alineamiento
//   5. árbol por Neighbor-Joining sobre esa matriz
// El paso 1-3 (caro, O(n²) alineamientos) se cachea aparte del 4-5 (barato):
// cambiar el modelo de corrección no repite el alineamiento.

import { t, getLang } from '../lib/i18n.js';
import { parseFasta } from '../lib/primerTemplate.js';
import { needlemanWunsch, buildProgressiveAlignment } from '../lib/phyloAlign.js';
import { pDistance, buildDistanceMatrix } from '../lib/phyloDistance.js';
import { neighborJoining, toNewick, escapeNewickLabel, collectLeaves, computeDrawDepths, nniRefine, midpointRoot, rerootAtLeaf } from '../lib/neighborJoining.js';
import { upgma } from '../lib/stats.js';
import { attachChartEditor } from '../lib/chartEditor.js';
import { getSlot, subscribe } from '../state.js';
import { CATEGORICAL } from '../lib/palettes.js';
import { makeGroupResolver } from '../lib/sampleMatch.js';
import { svgEl, escapeHtml } from '../lib/dom.js';
import { arcPath, polarPoint } from '../lib/sunburst.js';
import { glossaryLinkHtml } from '../lib/glossaryLink.js';
import { methodNoticeHtml } from '../lib/methodEquivalence.js';
import { noteMethods } from '../lib/reportLog.js';
import { phyloScript } from '../lib/rScriptBuilders.js';
import { R_EMBED_MAX_ROWS } from '../lib/rScript.js';

const STORE_KEY = 'smart-175.phylo';
const LEGACY_STORE_KEY = 'qiimelab.phylo';
const EXAMPLE_URL = 'datos-ejemplo/phylo/secuencias_ejemplo.fasta';
const MIN_SEQUENCES = 3;
const MIN_SEQ_LEN = 20;
const RECOMMENDED_MAX = 150;
const PROGRESS_EVERY = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function defaultState() { return { fastaText: '', correction: 'p', layout: 'rect', nni: false, rooting: 'none', referenceLeaf: '', colorCol: '' }; }
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_STORE_KEY) || 'null');
    if (raw && typeof raw.fastaText === 'string') {
      return {
        fastaText: raw.fastaText,
        correction: raw.correction === 'jc' ? 'jc' : 'p',
        layout: ['circular', 'sunburst'].includes(raw.layout) ? raw.layout : 'rect',
        nni: !!raw.nni,
        rooting: raw.rooting === 'midpoint' ? 'midpoint' : (raw.rooting === 'reference' ? 'reference' : 'none'),
        referenceLeaf: typeof raw.referenceLeaf === 'string' ? raw.referenceLeaf : '',
        colorCol: typeof raw.colorCol === 'string' ? raw.colorCol : '',
      };
    }
  } catch (e) { /* localStorage puede fallar */ }
  return defaultState();
}

function createMetadataResolver(meta, groupCol) {
  if (!meta || !Array.isArray(meta.rows) || !groupCol) return null;
  const idKey = meta.sampleIdKey || (meta.headers && meta.headers[0]);
  if (!idKey) return null;
  const metaWithKey = meta.sampleIdKey ? meta : { ...meta, sampleIdKey: idKey };
  const standardResolver = makeGroupResolver(metaWithKey, groupCol);

  const lowerMap = new Map();
  meta.rows.forEach((r) => {
    const id = String(r[idKey] ?? '').trim();
    const val = String(r[groupCol] ?? '').trim();
    if (id && val) lowerMap.set(id.toLowerCase(), val);
  });

  return (leafLabel) => {
    if (!leafLabel) return null;
    const direct = standardResolver(leafLabel);
    if (direct != null) return direct;

    const cleanLabel = leafLabel.split(';')[0].trim();
    if (cleanLabel && cleanLabel !== leafLabel) {
      const fromClean = standardResolver(cleanLabel);
      if (fromClean != null) return fromClean;
    }

    const lower = leafLabel.toLowerCase();
    if (lowerMap.has(lower)) return lowerMap.get(lower);
    if (cleanLabel && lowerMap.has(cleanLabel.toLowerCase())) return lowerMap.get(cleanLabel.toLowerCase());

    return null;
  };
}
function save(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* noop */ }
}

function parseAbundance(id) {
  const m = /(?:^|[;_\s])(?:size|abundance)=(\d+)/i.exec(id || '');
  return m ? parseInt(m[1], 10) : null;
}

/** FASTA cruda -> registros usables {name, seq, abundance}. Quita huecos
 *  preexistentes (este módulo espera secuencias SIN alinear), pasa a
 *  mayúsculas, normaliza U->T, y desambigua nombres repetidos. */
function recordsFromFasta(text) {
  const parsed = parseFasta(text);
  let strippedGaps = false;
  const seen = new Map();
  const out = [];
  parsed.forEach((r, i) => {
    let seq = r.seq;
    if (seq.includes('-')) { strippedGaps = true; seq = seq.replace(/-/g, ''); }
    seq = seq.toUpperCase().replace(/U/g, 'T');
    if (seq.length < MIN_SEQ_LEN) return;
    let name = r.id || ('seq' + (i + 1));
    const base = name;
    let k = 1;
    while (seen.has(name)) name = base + '_' + (++k);
    seen.set(name, true);
    out.push({ name, seq, abundance: parseAbundance(r.id || '') });
  });
  return { records: out, strippedGaps };
}

function serializeFasta(records) {
  return records.map((r) => '>' + r.name + '\n' + r.seq).join('\n');
}

function recordsKey(records) {
  return records.map((r) => r.name + ':' + r.seq).join('|');
}

function download(name, text, mime) {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) { /* entorno sin descargas */ }
}

function niceScaleValue(maxDepth) {
  if (!(maxDepth > 0)) return 0;
  const target = maxDepth / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
  const candidates = [1, 2, 5, 10].map((m) => m * magnitude);
  let best = candidates[0];
  for (const c of candidates) if (c <= target) best = c;
  return best;
}

/** Cladograma rectangular: x = distancia acumulada desde la raíz, y = orden
 *  de hojas (los internos, en el punto medio de sus hijos). */
function drawCladogramRect(svg, tree, { colorForLeaf = () => null, matchedCategories = [], categoryColorMap = new Map(), colorCol = '', resolveCat = () => null } = {}) {
  const leaves = collectLeaves(tree);
  const nLeaves = leaves.length;
  const { depths, maxDepth } = computeDrawDepths(tree);
  const rowH = 22;
  const marginL = 16, marginR = 190, marginT = 26;
  const plotW = 480;

  const perRow = Math.max(1, Math.floor(plotW / 140));
  const legRows = matchedCategories.length > 0 ? Math.ceil(matchedCategories.length / perRow) : 0;
  const legendH = matchedCategories.length > 0 ? (24 + legRows * 18 + 8) : 0;
  const marginB = 40 + legendH;

  const H = marginT + nLeaves * rowH + marginB;
  const W = marginL + plotW + marginR;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const xScale = maxDepth > 0 ? plotW / maxDepth : 0;
  const xOf = (id) => marginL + (depths.get(id) || 0) * xScale;

  const yLeaf = new Map();
  leaves.forEach((leaf, i) => yLeaf.set(leaf.id, marginT + i * rowH + rowH / 2));
  const yMemo = new Map();
  function yOf(node) {
    if (yMemo.has(node.id)) return yMemo.get(node.id);
    const y = !node.children.length
      ? yLeaf.get(node.id)
      : node.children.reduce((sum, ch) => sum + yOf(ch.node), 0) / node.children.length;
    yMemo.set(node.id, y);
    return y;
  }
  yOf(tree);

  const linesG = svgEl('g', {});
  const labelsG = svgEl('g', { 'data-ce': 'leaflabels' });
  const rightX = marginL + plotW;

  // índice de clado (para data-ce-series-*) de una hoja, o -1 si no hay
  // colorCol o su categoría no calzó con ninguna de matchedCategories
  function catIdxOf(label) {
    const cat = resolveCat(label);
    return cat ? matchedCategories.indexOf(cat) : -1;
  }

  function drawNode(node) {
    const px = xOf(node.id);
    if (node.children.length) {
      const childYs = node.children.map((ch) => yOf(ch.node));
      linesG.appendChild(svgEl('line', { x1: px, y1: Math.min(...childYs), x2: px, y2: Math.max(...childYs), class: 'ql-baseline-line', 'data-ce-series-stroke': 'branch' }));
      node.children.forEach((ch) => {
        const cy = yOf(ch.node);
        const isLeaf = !ch.node.children.length;
        const catIdx = isLeaf ? catIdxOf(ch.node.label) : -1;
        const leafColor = catIdx >= 0 ? categoryColorMap.get(matchedCategories[catIdx]) : null;
        const lineAttrs = { x1: px, y1: cy, x2: xOf(ch.node.id), y2: cy, class: 'ql-baseline-line', 'data-ce-role': 'line', 'data-ce-series-stroke': catIdx >= 0 ? 's' + catIdx : 'branch' };
        if (leafColor) {
          lineAttrs.stroke = leafColor;
          lineAttrs.style = 'stroke:' + leafColor + ';stroke-width:1.6;';
        }
        linesG.appendChild(svgEl('line', lineAttrs));
        drawNode(ch.node);
      });
    } else {
      const py = yOf(node);
      const catIdx = catIdxOf(node.label);
      const leafColor = catIdx >= 0 ? categoryColorMap.get(matchedCategories[catIdx]) : null;

      if (rightX - px > 2) {
        const guideAttrs = { x1: px, y1: py, x2: rightX, y2: py, class: 'ql-threshold-line', 'data-ce-series-stroke': catIdx >= 0 ? 's' + catIdx : 'branch' };
        if (leafColor) {
          guideAttrs.stroke = leafColor;
          guideAttrs.style = 'stroke:' + leafColor + ';opacity:0.75;';
        }
        linesG.appendChild(svgEl('line', guideAttrs));
      }

      const dotAttrs = {
        cx: px, cy: py, r: 2.6, class: 'ql-phylo-leafdot', 'data-ce-role': 'marker',
        'data-ce-series-fill': catIdx >= 0 ? 's' + catIdx : 'branch',
        'data-ce-series-stroke': catIdx >= 0 ? 's' + catIdx : 'branch',
      };
      if (leafColor) {
        dotAttrs.fill = leafColor;
        dotAttrs.stroke = leafColor;
        dotAttrs.style = 'fill:' + leafColor + ';stroke:' + leafColor + ';';
      }
      linesG.appendChild(svgEl('circle', dotAttrs));

      const labAttrs = { x: rightX + 6, y: py + 4, class: 'ql-phylo-leaflabel' };
      if (catIdx >= 0) labAttrs['data-ce-series-fill'] = 's' + catIdx;
      if (leafColor) {
        labAttrs.fill = leafColor;
        labAttrs.style = 'fill:' + leafColor + ';';
      }
      const lab = svgEl('text', labAttrs);
      lab.textContent = node.label;
      labelsG.appendChild(lab);
    }
  }
  const rootY = yOf(tree);
  linesG.appendChild(svgEl('line', { x1: marginL - 10, y1: rootY, x2: marginL, y2: rootY, class: 'ql-baseline-line', 'data-ce-series-stroke': 'branch' }));
  drawNode(tree);
  svg.appendChild(linesG);
  svg.appendChild(labelsG);

  // barra de escala -- data-ce="scalebar" para que sea un elemento
  // arrastrable/ocultable propio (Fase 5.2), no solo unas líneas sueltas
  const scaleVal = niceScaleValue(maxDepth);
  if (scaleVal > 0) {
    const x0 = marginL, y0 = H - 14 - legendH, w = scaleVal * xScale;
    const g = svgEl('g', { 'data-ce': 'scalebar' });
    g.appendChild(svgEl('line', { x1: x0, y1: y0, x2: x0 + w, y2: y0, class: 'ql-baseline-line' }));
    g.appendChild(svgEl('line', { x1: x0, y1: y0 - 4, x2: x0, y2: y0 + 4, class: 'ql-baseline-line' }));
    g.appendChild(svgEl('line', { x1: x0 + w, y1: y0 - 4, x2: x0 + w, y2: y0 + 4, class: 'ql-baseline-line' }));
    const lab = svgEl('text', { x: x0, y: y0 + 14, class: 'ql-tick-label' });
    lab.textContent = scaleVal + ' (' + t('phylo.scaleCaption') + ')';
    g.appendChild(lab);
    svg.appendChild(g);
  }

  // Leyenda en SVG (recuadro)
  if (matchedCategories.length > 0) {
    const legG = svgEl('g', { 'data-ce': 'legend', class: 'ql-legend' });
    const legBoxX = marginL;
    const legBoxY = H - legendH + 6;
    const legBoxW = plotW;
    const legBoxH = legendH - 12;

    const bgRect = svgEl('rect', {
      x: legBoxX, y: legBoxY, width: legBoxW, height: legBoxH,
      rx: 6, fill: 'var(--surface-2)', stroke: 'var(--border)',
      'stroke-width': 1, class: 'ql-legend-box',
    });
    legG.appendChild(bgRect);

    const titleText = svgEl('text', {
      x: legBoxX + 10, y: legBoxY + 16,
      class: 'ql-tick-label',
      style: 'font-weight:600;fill:var(--ink);font-size:11.5px;',
    });
    titleText.textContent = (colorCol || t('phylo.legendTitle')) + ':';
    legG.appendChild(titleText);

    const colW = Math.max(120, Math.floor((legBoxW - 20) / perRow));
    matchedCategories.forEach((cat, i) => {
      const col = i % perRow;
      const rw = Math.floor(i / perRow);
      const xx = legBoxX + 10 + col * colW;
      const yy = legBoxY + 34 + rw * 18;
      const c = categoryColorMap.get(cat);

      legG.appendChild(svgEl('rect', {
        x: xx, y: yy - 9, width: 10, height: 10, rx: 2,
        fill: c, style: 'fill:' + c + ';',
        'data-ce-series-fill': 's' + i,
      }));

      const lt = svgEl('text', {
        x: xx + 15, y: yy,
        class: 'ql-tick-label',
        style: 'fill:var(--ink-2);font-size:11.5px;',
      });
      lt.textContent = cat.length > 18 ? cat.slice(0, 17) + '…' : cat;
      legG.appendChild(lt);
    });

    svg.appendChild(legG);
  }
}

/** Cladograma circular/radial: MISMO árbol y MISMAS coordenadas (x=distancia
 *  acumulada, y=orden de hojas) que drawCladogramRect — solo cambia la
 *  proyección final a coordenadas polares (x->radio, y->ángulo). Las hojas
 *  se reparten a ángulos iguales alrededor del círculo (en el mismo orden
 *  que collectLeaves, así que los hijos de un nodo caen siempre en un arco
 *  contiguo, sin envolver el punto 0°/360°); los internos van al ángulo
 *  medio de sus hijos, igual que en el rectangular. */
function drawCladogramCircular(svg, tree, { colorForLeaf = () => null, matchedCategories = [], categoryColorMap = new Map(), colorCol = '', resolveCat = () => null } = {}) {
  const leaves = collectLeaves(tree);
  const n = leaves.length;
  const { depths, maxDepth } = computeDrawDepths(tree);
  // radio mínimo por hoja ~ misma densidad que rowH=22 del rectangular
  const plotR = Math.max(160, (n * 22) / (2 * Math.PI));
  const marginLabels = 170;
  const cx = plotR + marginLabels, cy = plotR + marginLabels;
  const W = 2 * (plotR + marginLabels), H = W;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const rScale = maxDepth > 0 ? plotR / maxDepth : 0;
  const rOf = (id) => (depths.get(id) || 0) * rScale;
  const angleStep = (2 * Math.PI) / n;
  const leafAngle = new Map();
  leaves.forEach((leaf, i) => leafAngle.set(leaf.id, i * angleStep));
  const angleMemo = new Map();
  function angleOf(node) {
    if (angleMemo.has(node.id)) return angleMemo.get(node.id);
    const a = !node.children.length
      ? leafAngle.get(node.id)
      : node.children.reduce((sum, ch) => sum + angleOf(ch.node), 0) / node.children.length;
    angleMemo.set(node.id, a);
    return a;
  }
  angleOf(tree);
  const point = (angle, r) => ({ x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) });

  const linesG = svgEl('g', {});
  const labelsG = svgEl('g', { 'data-ce': 'leaflabels' });

  function catIdxOf(label) {
    const cat = resolveCat(label);
    return cat ? matchedCategories.indexOf(cat) : -1;
  }

  function drawNode(node) {
    const r = rOf(node.id);
    if (node.children.length) {
      const a0 = angleOf(node.children[0].node);
      const a1 = angleOf(node.children[node.children.length - 1].node);
      const p0 = point(a0, r), p1 = point(a1, r);
      const sweep = a1 - a0;
      const largeArc = sweep > Math.PI ? 1 : 0;
      if (sweep > 1e-9) {
        linesG.appendChild(svgEl('path', {
          d: 'M ' + p0.x + ' ' + p0.y + ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + p1.x + ' ' + p1.y,
          fill: 'none', class: 'ql-baseline-line', 'data-ce-role': 'line', 'data-ce-series-stroke': 'branch',
        }));
      }
      node.children.forEach((ch) => {
        const a = angleOf(ch.node);
        const pIn = point(a, r), pOut = point(a, rOf(ch.node.id));
        const isLeaf = !ch.node.children.length;
        const catIdx = isLeaf ? catIdxOf(ch.node.label) : -1;
        const leafColor = catIdx >= 0 ? categoryColorMap.get(matchedCategories[catIdx]) : null;
        const lineAttrs = { x1: pIn.x, y1: pIn.y, x2: pOut.x, y2: pOut.y, class: 'ql-baseline-line', 'data-ce-role': 'line', 'data-ce-series-stroke': catIdx >= 0 ? 's' + catIdx : 'branch' };
        if (leafColor) {
          lineAttrs.stroke = leafColor;
          lineAttrs.style = 'stroke:' + leafColor + ';stroke-width:1.6;';
        }
        linesG.appendChild(svgEl('line', lineAttrs));
        drawNode(ch.node);
      });
    } else {
      const a = angleOf(node);
      const pLeaf = point(a, r), pOuter = point(a, plotR);
      const catIdx = catIdxOf(node.label);
      const leafColor = catIdx >= 0 ? categoryColorMap.get(matchedCategories[catIdx]) : null;

      if (plotR - r > 2) {
        const guideAttrs = { x1: pLeaf.x, y1: pLeaf.y, x2: pOuter.x, y2: pOuter.y, class: 'ql-threshold-line', 'data-ce-series-stroke': catIdx >= 0 ? 's' + catIdx : 'branch' };
        if (leafColor) {
          guideAttrs.stroke = leafColor;
          guideAttrs.style = 'stroke:' + leafColor + ';opacity:0.75;';
        }
        linesG.appendChild(svgEl('line', guideAttrs));
      }

      const dotAttrs = {
        cx: pLeaf.x, cy: pLeaf.y, r: 2.6, class: 'ql-phylo-leafdot', 'data-ce-role': 'marker',
        'data-ce-series-fill': catIdx >= 0 ? 's' + catIdx : 'branch',
        'data-ce-series-stroke': catIdx >= 0 ? 's' + catIdx : 'branch',
      };
      if (leafColor) {
        dotAttrs.fill = leafColor;
        dotAttrs.stroke = leafColor;
        dotAttrs.style = 'fill:' + leafColor + ';stroke:' + leafColor + ';';
      }
      linesG.appendChild(svgEl('circle', dotAttrs));

      const pLab = point(a, plotR + 6);
      const angleDeg = (a * 180) / Math.PI;
      const flip = angleDeg > 180;
      const labAttrs = {
        x: pLab.x, y: pLab.y, class: 'ql-phylo-leaflabel',
        'text-anchor': flip ? 'end' : 'start',
        'dominant-baseline': 'middle',
        transform: 'rotate(' + (angleDeg - 90 + (flip ? 180 : 0)) + ' ' + pLab.x + ' ' + pLab.y + ')',
      };
      if (catIdx >= 0) labAttrs['data-ce-series-fill'] = 's' + catIdx;
      if (leafColor) {
        labAttrs.fill = leafColor;
        labAttrs.style = 'fill:' + leafColor + ';';
      }
      const lab = svgEl('text', labAttrs);
      lab.textContent = node.label;
      labelsG.appendChild(lab);
    }
  }
  drawNode(tree);
  svg.appendChild(linesG);
  svg.appendChild(labelsG);

  // barra de escala: segmento recto en la esquina, no radia desde el centro
  // -- data-ce="scalebar" para que sea un elemento arrastrable/ocultable
  // propio (Fase 5.2), no solo unas líneas sueltas
  const scaleVal = niceScaleValue(maxDepth);
  if (scaleVal > 0) {
    const x0 = 8, y0 = H - 14, w = scaleVal * rScale;
    const g = svgEl('g', { 'data-ce': 'scalebar' });
    g.appendChild(svgEl('line', { x1: x0, y1: y0, x2: x0 + w, y2: y0, class: 'ql-baseline-line' }));
    g.appendChild(svgEl('line', { x1: x0, y1: y0 - 4, x2: x0, y2: y0 + 4, class: 'ql-baseline-line' }));
    g.appendChild(svgEl('line', { x1: x0 + w, y1: y0 - 4, x2: x0 + w, y2: y0 + 4, class: 'ql-baseline-line' }));
    const lab = svgEl('text', { x: x0, y: y0 + 14, class: 'ql-tick-label' });
    lab.textContent = scaleVal + ' (' + t('phylo.scaleCaption') + ')';
    g.appendChild(lab);
    svg.appendChild(g);
  }

  // Leyenda en SVG (recuadro)
  appendBoxLegend(svg, matchedCategories, categoryColorMap, colorCol);
}

/** Leyenda de categorías en un recuadro en columna (arriba a la izquierda),
 *  compartida por el cladograma circular y el sunburst. */
function appendBoxLegend(svg, matchedCategories, categoryColorMap, colorCol) {
  if (matchedCategories.length > 0) {
    const legG = svgEl('g', { 'data-ce': 'legend', class: 'ql-legend' });
    const legBoxX = 20;
    const legBoxY = 20;
    const legBoxW = 160;
    const legBoxH = 26 + matchedCategories.length * 18 + 8;

    const bgRect = svgEl('rect', {
      x: legBoxX, y: legBoxY, width: legBoxW, height: legBoxH,
      rx: 6, fill: 'var(--surface-2)', stroke: 'var(--border)',
      'stroke-width': 1, class: 'ql-legend-box',
    });
    legG.appendChild(bgRect);

    const titleText = svgEl('text', {
      x: legBoxX + 10, y: legBoxY + 16,
      class: 'ql-tick-label',
      style: 'font-weight:600;fill:var(--ink);font-size:11.5px;',
    });
    titleText.textContent = (colorCol || t('phylo.legendTitle')) + ':';
    legG.appendChild(titleText);

    matchedCategories.forEach((cat, i) => {
      const yy = legBoxY + 34 + i * 18;
      const c = categoryColorMap.get(cat);

      legG.appendChild(svgEl('rect', {
        x: legBoxX + 10, y: yy - 9, width: 10, height: 10, rx: 2,
        fill: c, style: 'fill:' + c + ';',
        'data-ce-series-fill': 's' + i,
      }));

      const lt = svgEl('text', {
        x: legBoxX + 25, y: yy,
        class: 'ql-tick-label',
        style: 'fill:var(--ink-2);font-size:11.5px;',
      });
      lt.textContent = cat.length > 18 ? cat.slice(0, 17) + '…' : cat;
      legG.appendChild(lt);
    });

    svg.appendChild(legG);
  }
}

/**
 * Vista sunburst del MISMO árbol NJ (Fase 3, C3): capas concéntricas, una por
 * nivel topológico desde la raíz (centro). Cada nodo es un sector de anillo
 * cuyo ángulo es proporcional a su nº de hojas, en el mismo orden que
 * collectLeaves (así un clado es siempre un arco contiguo, como en el
 * cladograma circular). Las hojas se prolongan hasta el anillo exterior para
 * que todos los nombres queden alineados fuera. OJO: las longitudes de rama
 * NO se representan (es una vista de la jerarquía, no de la distancia) —
 * para las distancias, el rectangular o el circular.
 * Color: por la columna de metadatos elegida si la hay (hojas con su
 * categoría; un clado interno toma el color solo si todas sus hojas
 * comparten categoría); si no, por clado de primer nivel, más tenue cuanto
 * más interno. Devuelve las series de clado para la paleta del editor.
 */
function drawTreeSunburst(svg, tree, { matchedCategories = [], categoryColorMap = new Map(), colorCol = '', resolveCat = () => null } = {}) {
  const leaves = collectLeaves(tree);
  const n = leaves.length;
  // profundidad topológica y nº de hojas por nodo
  const depth = new Map(), nLeaves = new Map();
  let maxD = 0;
  (function walk(node, d) {
    depth.set(node.id, d); maxD = Math.max(maxD, d);
    if (!node.children.length) { nLeaves.set(node.id, 1); return 1; }
    const c = node.children.reduce((a, ch) => a + walk(ch.node, d + 1), 0);
    nLeaves.set(node.id, c);
    return c;
  })(tree, 0);

  const ring = Math.max(22, Math.min(46, 300 / Math.max(1, maxD)));
  const r0 = 18; // disco de la raíz
  const R = r0 + ring * maxD;
  const marginLabels = 170;
  const cx = R + marginLabels, cy = R + marginLabels;
  const W = 2 * (R + marginLabels), H = W;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const catIdxOf = (label) => { const cat = resolveCat(label); return cat ? matchedCategories.indexOf(cat) : -1; };
  const useCats = matchedCategories.length > 0;
  // categoría común de un clado (índice) o -1 si mezcla / sin categoría
  const cladeCat = new Map();
  (function cat(node) {
    if (!node.children.length) { const c = catIdxOf(node.label); cladeCat.set(node.id, c); return c; }
    const cs = node.children.map((ch) => cat(ch.node));
    const c = cs.every((x) => x === cs[0]) ? cs[0] : -1;
    cladeCat.set(node.id, c);
    return c;
  })(tree);
  // sin columna de color: un color por clado de primer nivel (hijos de la raíz)
  const topClade = new Map();
  tree.children.forEach((ch, i) => { (function mark(node) { topClade.set(node.id, i); node.children.forEach((c) => mark(c.node)); })(ch.node); });
  const cladeSeries = useCats ? [] : tree.children.map((_, i) => ({ id: 'clade' + i, label: t('phylo.sunburstClade', { n: i + 1 }) }));

  const arcsG = svgEl('g', { class: 'ql-phylo-sunburst' });
  const labelsG = svgEl('g', { 'data-ce': 'leaflabels' });
  arcsG.appendChild(svgEl('circle', { cx, cy, r: r0 - 2, fill: 'var(--ink-muted)', 'fill-opacity': 0.35, 'data-ce-series-fill': 'branch' }));

  (function draw(node, a0) {
    const span = (nLeaves.get(node.id) / n) * 2 * Math.PI;
    const d = depth.get(node.id);
    const isLeaf = !node.children.length;
    if (d > 0) {
      const inner = r0 + ring * (d - 1), outer = isLeaf ? R : r0 + ring * d;
      let fill, sid, op;
      if (useCats) {
        const ci = cladeCat.get(node.id);
        fill = ci >= 0 ? categoryColorMap.get(matchedCategories[ci]) : 'var(--ink-muted)';
        sid = ci >= 0 ? 's' + ci : 'branch';
        op = isLeaf ? 0.9 : (ci >= 0 ? 0.35 + 0.35 * (d / maxD) : 0.18);
      } else {
        const ti = topClade.get(node.id);
        fill = 'var(' + ['--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5', '--cat-6', '--cat-7'][ti % 7] + ')';
        sid = 'clade' + ti;
        op = isLeaf ? 0.9 : 0.3 + 0.4 * (d / maxD);
      }
      const path = svgEl('path', {
        d: arcPath(cx, cy, inner, outer, a0, a0 + span), fill, 'fill-opacity': op,
        stroke: 'var(--surface)', 'stroke-width': 1, 'data-ce-series-fill': sid, 'data-ce-role': 'cell',
        class: isLeaf ? 'ql-phylo-sb-leaf' : 'ql-phylo-sb-clade',
      });
      const tip = svgEl('title', {});
      tip.textContent = isLeaf ? node.label : t('phylo.sunburstCladeTip', { n: nLeaves.get(node.id), d });
      path.appendChild(tip);
      arcsG.appendChild(path);
    }
    if (isLeaf) {
      const a = a0 + span / 2;
      const pLab = polarPoint(cx, cy, R + 6, a);
      const angleDeg = (a * 180) / Math.PI;
      const flip = angleDeg > 180;
      const ci = catIdxOf(node.label);
      const lab = svgEl('text', {
        x: pLab.x, y: pLab.y, class: 'ql-phylo-leaflabel',
        'text-anchor': flip ? 'end' : 'start', 'dominant-baseline': 'middle',
        transform: 'rotate(' + (angleDeg - 90 + (flip ? 180 : 0)) + ' ' + pLab.x + ' ' + pLab.y + ')',
        ...(ci >= 0 ? { 'data-ce-series-fill': 's' + ci } : {}),
      });
      lab.textContent = node.label;
      labelsG.appendChild(lab);
      return;
    }
    let a = a0;
    node.children.forEach((ch) => { draw(ch.node, a); a += (nLeaves.get(ch.node.id) / n) * 2 * Math.PI; });
  })(tree, 0);

  svg.appendChild(arcsG);
  svg.appendChild(labelsG);
  appendBoxLegend(svg, matchedCategories, categoryColorMap, colorCol);
  return { cladeSeries };
}

export function render(container) {
  const s = load();
  let alignCache = null;   // { key, alignedOrdered }
  let alignProgress = null; // { key, done, total }
  let editor = null;
  let keepN = null;

  function recordsNow() { return recordsFromFasta(s.fastaText); }

  function removeAt(records, idx) {
    const next = records.slice();
    next.splice(idx, 1);
    s.fastaText = serializeFasta(next);
    paint();
  }

  function applyKeepTop(records, n) {
    const withAb = records.filter((r) => r.abundance != null);
    const sorted = withAb.length === records.length ? records.slice().sort((a, b) => b.abundance - a.abundance) : records;
    s.fastaText = serializeFasta(sorted.slice(0, n));
    paint();
  }

  async function runAlignment(records, key) {
    const seqs = records.map((r) => r.seq);
    const n = seqs.length;
    const gd = Array.from({ length: n }, () => new Array(n).fill(0));
    let done = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const { alignedA, alignedB } = needlemanWunsch(seqs[i], seqs[j], {});
        const p = pDistance(alignedA, alignedB);
        const d = Number.isFinite(p) ? p : 1;
        gd[i][j] = d; gd[j][i] = d;
        done++;
        if (done % PROGRESS_EVERY === 0) {
          if (!alignProgress || alignProgress.key !== key) return;
          alignProgress.done = done;
          paint();
          await sleep(0);
        }
      }
    }
    if (!alignProgress || alignProgress.key !== key) return;
    const guideTree = n > 1 ? upgma(gd, seqs.map((_, i) => String(i))) : null;
    const alignedMap = buildProgressiveAlignment(seqs, guideTree, {});
    const alignedOrdered = seqs.map((_, i) => alignedMap.get(i));
    if (!alignProgress || alignProgress.key !== key) return;
    alignCache = { key, alignedOrdered };
    alignProgress = null;
    paint();
  }

  function paint() {
    if (editor) { editor.destroy(); editor = null; }
    container.innerHTML = '';
    save(s);

    const header = document.createElement('header');
    header.className = 'ql-page-header';
    header.innerHTML =
      '<p class="ql-eyebrow">' + t('phylo.eyebrow') + '</p>' +
      '<h1 class="ql-page-title">' + t('phylo.title') + '</h1>' +
      '<p class="ql-page-sub">' + t('phylo.subtitle') + '</p>';
    container.appendChild(header);

    const honestyCard = document.createElement('section');
    honestyCard.className = 'ql-card ql-panel';
    honestyCard.innerHTML =
      '<h2>' + t('phylo.honestyTitle') + '</h2>' + methodNoticeHtml(['msa-progressive', 'nj']) +
      glossaryLinkHtml('msa') +
      '<p class="ql-field-help" style="margin-top:10px;"><strong>' + t('phylo.scopeTitle') + '</strong> — ' + t('phylo.scopeNote') + '</p>' +
      glossaryLinkHtml('neighborJoiningTerm');
    container.appendChild(honestyCard);

    // ---- entrada ----
    const inputCard = document.createElement('section');
    inputCard.className = 'ql-card ql-panel';
    inputCard.innerHTML = '<h2>' + t('phylo.inputTitle') + '</h2><p class="ql-panel-note">' + t('phylo.inputNote') + '</p>';

    const dz = document.createElement('div');
    dz.className = 'ql-dropzone';
    dz.tabIndex = 0;
    dz.setAttribute('role', 'button');
    dz.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>' +
      '<div><div class="ql-dz-text"><b>' + t('phylo.dropLabel') + '</b></div><div class="ql-dz-sub">' + t('phylo.dropSub') + '</div></div>';
    const fileIn = document.createElement('input');
    fileIn.type = 'file'; fileIn.accept = '.fasta,.fa,.fna,.txt';
    dz.appendChild(fileIn);
    inputCard.appendChild(dz);
    const applyFile = async (file) => { if (file) { s.fastaText = await file.text(); paint(); } };
    dz.addEventListener('click', () => fileIn.click());
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('is-drag'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('is-drag'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('is-drag'); applyFile(e.dataTransfer.files[0]); });
    fileIn.addEventListener('change', () => applyFile(fileIn.files[0]));

    const pasteField = document.createElement('div');
    pasteField.className = 'ql-field';
    pasteField.style.marginTop = '14px';
    pasteField.innerHTML = '<label for="phylo-paste">' + t('phylo.pasteLabel') + '</label>';
    const pasteTa = document.createElement('textarea');
    pasteTa.id = 'phylo-paste'; pasteTa.rows = 5; pasteTa.className = 'mono'; pasteTa.spellcheck = false;
    pasteTa.placeholder = t('phylo.pastePh');
    pasteTa.value = s.fastaText;
    pasteTa.addEventListener('change', () => { s.fastaText = pasteTa.value; paint(); });
    pasteField.appendChild(pasteTa);
    inputCard.appendChild(pasteField);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;';
    const exBtn = document.createElement('button');
    exBtn.type = 'button'; exBtn.className = 'ql-btn';
    exBtn.textContent = t('phylo.loadExample');
    exBtn.addEventListener('click', async () => {
      exBtn.disabled = true;
      try { s.fastaText = await (await fetch(EXAMPLE_URL)).text(); } catch (e) { /* si falla, no cambia nada */ }
      exBtn.disabled = false;
      paint();
    });
    btnRow.appendChild(exBtn);
    if (s.fastaText) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button'; clearBtn.className = 'ql-btn';
      clearBtn.textContent = t('phylo.clear');
      clearBtn.addEventListener('click', () => { s.fastaText = ''; alignCache = null; alignProgress = null; paint(); });
      btnRow.appendChild(clearBtn);
    }
    inputCard.appendChild(btnRow);
    container.appendChild(inputCard);

    const { records, strippedGaps } = recordsNow();

    if (!s.fastaText.trim()) {
      const empty = document.createElement('div');
      empty.className = 'ql-card ql-panel';
      empty.innerHTML = '<div class="ql-empty"><h3>' + t('phylo.emptyTitle') + '</h3><p>' + t('phylo.emptyNote') + '</p></div>';
      container.appendChild(empty);
      return;
    }
    if (records.length < MIN_SEQUENCES) {
      const few = document.createElement('div');
      few.className = 'ql-card ql-panel';
      few.innerHTML = '<div class="ql-empty"><h3>' + t('phylo.tooFewTitle', { n: MIN_SEQUENCES }) + '</h3><p>' + t('phylo.tooFewNote') + '</p></div>';
      container.appendChild(few);
      return;
    }

    if (strippedGaps) {
      const note = document.createElement('p');
      note.className = 'ql-field-help';
      note.textContent = t('phylo.gapsStrippedNote');
      container.appendChild(note);
    }

    if (records.length > RECOMMENDED_MAX) {
      const warn = document.createElement('section');
      warn.className = 'ql-card ql-panel';
      warn.innerHTML = '<h2>' + t('phylo.limitWarnTitle', { n: records.length }) + '</h2><p class="ql-panel-note">' + t('phylo.limitWarn') + '</p>';
      const withAb = records.filter((r) => r.abundance != null);
      if (withAb.length >= records.length * 0.5) {
        warn.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('phylo.keepTopHelp') + '</p>');
        const row = document.createElement('div');
        row.className = 'ql-field';
        row.style.cssText = 'display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:8px;';
        if (keepN == null) keepN = Math.min(100, records.length);
        row.innerHTML = '<label for="phylo-keepn">' + t('phylo.keepTopLabel') + '</label>';
        const nIn = document.createElement('input');
        nIn.type = 'number'; nIn.id = 'phylo-keepn'; nIn.className = 'tabular';
        nIn.min = String(MIN_SEQUENCES); nIn.max = String(records.length); nIn.value = String(keepN);
        nIn.addEventListener('change', () => { const v = parseInt(nIn.value, 10); if (Number.isFinite(v)) keepN = v; });
        row.appendChild(nIn);
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button'; applyBtn.className = 'ql-btn';
        applyBtn.textContent = t('phylo.keepTopBtn');
        applyBtn.addEventListener('click', () => applyKeepTop(records, Math.max(MIN_SEQUENCES, Math.min(records.length, keepN))));
        row.appendChild(applyBtn);
        warn.appendChild(row);
      } else {
        warn.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('phylo.noAbundanceNote') + '</p>');
      }
      container.appendChild(warn);
    }

    // ---- lista de secuencias ----
    const listCard = document.createElement('section');
    listCard.className = 'ql-card ql-panel';
    const hasAbundanceCol = records.some((r) => r.abundance != null);
    listCard.innerHTML = '<h2>' + t('phylo.listTitle', { n: records.length }) + '</h2>';
    const scrollDiv = document.createElement('div');
    scrollDiv.className = 'ql-table-scroll';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table';
    tbl.innerHTML = '<thead><tr><th>' + t('phylo.colName') + '</th><th>' + t('phylo.colLength') + '</th>' +
      (hasAbundanceCol ? '<th>' + t('phylo.colAbundance') + '</th>' : '') + '<th></th></tr></thead>';
    const tbody = document.createElement('tbody');
    records.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="mono">' + escapeHtml(r.name) + '</td><td class="tabular">' + r.seq.length + '</td>' +
        (hasAbundanceCol ? '<td class="tabular">' + (r.abundance != null ? r.abundance : '—') + '</td>' : '');
      const td = document.createElement('td');
      const rmBtn = document.createElement('button');
      rmBtn.type = 'button'; rmBtn.className = 'ql-cmp-rm'; rmBtn.textContent = '✕';
      rmBtn.title = t('ui.remove');
      rmBtn.setAttribute('aria-label', t('phylo.removeAria', { name: r.name }));
      rmBtn.disabled = records.length <= MIN_SEQUENCES;
      rmBtn.addEventListener('click', () => removeAt(records, i));
      td.appendChild(rmBtn);
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    scrollDiv.appendChild(tbl);
    listCard.appendChild(scrollDiv);
    container.appendChild(listCard);

    // ---- árbol: figura + controles ----
    const key = recordsKey(records);
    const grid = document.createElement('div');
    grid.className = 'ql-grid-2';

    const chartPanel = document.createElement('section');
    chartPanel.className = 'ql-card ql-panel';
    chartPanel.innerHTML = '<p class="ql-panel-note">' + t(s.layout === 'sunburst' ? 'phylo.sunburstNote' : s.layout === 'circular' ? 'phylo.circularNote' : 'phylo.treeNote') + '</p>';
    const chartWrap = document.createElement('div');
    chartWrap.className = 'ql-chartwrap';
    const svg = svgEl('svg', { class: 'ql-svg', role: 'img', 'aria-label': t(s.layout === 'circular' ? 'a11y.chartPhyloCircular' : s.layout === 'sunburst' ? 'a11y.chartPhyloSunburst' : 'a11y.chartPhylo') });
    chartWrap.appendChild(svg);
    chartPanel.appendChild(chartWrap);
    grid.appendChild(chartPanel);

    const meta = getSlot('metadata');
    const idKey = (meta && meta.sampleIdKey) || (meta && meta.headers && meta.headers[0]) || '';
    let metaCols = (meta && Array.isArray(meta.headers))
      ? meta.headers.filter((h) => h !== idKey)
      : [];
    if (!metaCols.length && meta && Array.isArray(meta.headers) && meta.headers.length > 0) {
      metaCols = meta.headers.slice();
    }
    if (s.colorCol && !metaCols.includes(s.colorCol)) {
      s.colorCol = '';
    }
    const resolveGroup = createMetadataResolver(meta, s.colorCol);

    const ctrl = document.createElement('aside');
    ctrl.className = 'ql-card ql-panel ql-tree-toolbar';
    ctrl.innerHTML = '<h2>' + t('phylo.modelTitle') + '</h2>';

    const layoutField = document.createElement('div');
    layoutField.className = 'ql-field';
    layoutField.innerHTML = '<label>' + t('phylo.layoutLabel') + '</label>';
    const layoutSeg = document.createElement('div');
    layoutSeg.className = 'ql-segmented';
    [['rect', t('phylo.layoutRect')], ['circular', t('phylo.layoutCircular')], ['sunburst', t('phylo.layoutSunburst')]].forEach(([v, lbl]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-seg-btn' + (s.layout === v ? ' is-on' : '');
      b.textContent = lbl;
      b.addEventListener('click', () => { if (s.layout !== v) { s.layout = v; paint(); } });
      layoutSeg.appendChild(b);
    });
    layoutField.appendChild(layoutSeg);
    ctrl.appendChild(layoutField);

    const colorField = document.createElement('div');
    colorField.className = 'ql-field ql-toolbar toolbar';
    colorField.innerHTML = '<label for="phylo-color-col">' + t('phylo.colorByLabel') + '</label>';
    const colorSel = document.createElement('select');
    colorSel.id = 'phylo-color-col';
    colorSel.name = 'metadata-column';
    colorSel.className = 'ql-select';
    colorSel.setAttribute('aria-label', t('phylo.colorByLabel'));
    const defOpt = document.createElement('option');
    defOpt.value = '';
    defOpt.textContent = t('phylo.colorNone');
    if (!s.colorCol) defOpt.selected = true;
    colorSel.appendChild(defOpt);
    metaCols.forEach((col) => {
      const o = document.createElement('option');
      o.value = col;
      o.textContent = col;
      if (col === s.colorCol) o.selected = true;
      colorSel.appendChild(o);
    });
    colorSel.addEventListener('change', () => {
      s.colorCol = colorSel.value;
      paint();
    });
    colorField.appendChild(colorSel);
    if (!metaCols.length) {
      colorField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('phylo.noMetaHelp') + '</p>');
    }
    ctrl.appendChild(colorField);

    const corrField = document.createElement('div');
    corrField.className = 'ql-field';
    corrField.innerHTML = '<label for="phylo-correction">' + t('phylo.correctionLabel') + '</label>';
    const corrSel = document.createElement('select');
    corrSel.id = 'phylo-correction';
    [['p', t('phylo.correctionP')], ['jc', t('phylo.correctionJC')]].forEach(([v, lbl]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = lbl;
      if (v === s.correction) o.selected = true;
      corrSel.appendChild(o);
    });
    corrSel.addEventListener('change', () => { s.correction = corrSel.value; paint(); });
    corrField.appendChild(corrSel);
    corrField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('phylo.correctionHelp') + '</p>');
    ctrl.appendChild(corrField);

    const rootField = document.createElement('div');
    rootField.className = 'ql-field';
    rootField.innerHTML = '<label>' + t('phylo.rootingLabel') + '</label>';
    const rootSeg = document.createElement('div');
    rootSeg.className = 'ql-segmented';
    [['none', t('phylo.rootingNone')], ['midpoint', t('phylo.rootingMidpoint')], ['reference', t('phylo.rootingReference')]].forEach(([v, lbl]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-seg-btn' + (s.rooting === v ? ' is-on' : '');
      b.textContent = lbl;
      b.addEventListener('click', () => { if (s.rooting !== v) { s.rooting = v; paint(); } });
      rootSeg.appendChild(b);
    });
    rootField.appendChild(rootSeg);
    rootField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('phylo.rootingHelp') + '</p>');
    ctrl.appendChild(rootField);

    if (s.rooting === 'reference') {
      const refField = document.createElement('div');
      refField.className = 'ql-field';
      refField.innerHTML = '<label for="phylo-reference-leaf">' + t('phylo.referenceLeafLabel') + '</label>';
      const refSel = document.createElement('select');
      refSel.id = 'phylo-reference-leaf';
      refSel.className = 'ql-select';
      refSel.setAttribute('aria-label', t('phylo.referenceLeafLabel'));
      const refDefOpt = document.createElement('option');
      refDefOpt.value = '';
      refDefOpt.textContent = t('phylo.referenceLeafNone');
      if (!s.referenceLeaf) refDefOpt.selected = true;
      refSel.appendChild(refDefOpt);
      records.forEach((r) => {
        const o = document.createElement('option');
        o.value = r.name;
        o.textContent = r.name;
        if (r.name === s.referenceLeaf) o.selected = true;
        refSel.appendChild(o);
      });
      refSel.addEventListener('change', () => { s.referenceLeaf = refSel.value; paint(); });
      refField.appendChild(refSel);
      refField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('phylo.referenceLeafHelp') + '</p>');
      ctrl.appendChild(refField);
    }

    const nniField = document.createElement('div');
    nniField.className = 'ql-field';
    const nniRow = document.createElement('label');
    nniRow.className = 'ql-checkrow';
    const nniCb = document.createElement('input');
    nniCb.type = 'checkbox'; nniCb.checked = s.nni;
    nniCb.addEventListener('change', () => { s.nni = nniCb.checked; paint(); });
    nniRow.appendChild(nniCb);
    nniRow.appendChild(document.createTextNode(' ' + t('phylo.nniLabel')));
    nniField.appendChild(nniRow);
    nniField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('phylo.nniHelp') + '</p>');
    ctrl.appendChild(nniField);

    const statsBox = document.createElement('div');
    statsBox.className = 'ql-stats';
    statsBox.innerHTML = '<div class="ql-stat"><div class="ql-stat-label">' + t('phylo.statSeqs') + '</div><div class="ql-stat-value" style="font-size:20px;">' + records.length + '</div></div>';
    ctrl.appendChild(statsBox);

    const privacy = document.createElement('p');
    privacy.className = 'ql-privacy';
    privacy.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5l-8-3Z"/></svg>' + t('phylo.localNote');
    ctrl.appendChild(privacy);
    grid.appendChild(ctrl);
    container.appendChild(grid);

    if (alignCache && alignCache.key === key) {
      const alignedOrdered = alignCache.alignedOrdered;
      const { matrix, saturated } = buildDistanceMatrix(alignedOrdered, { correction: s.correction });
      let tree = neighborJoining(matrix, records.map((r) => r.name));
      noteMethods('arbol', ['msa-progressive', 'nj']); // informe completo
      const newickNJ = toNewick(tree); // antes de NNI/enraizado: lo que reproduce ape::nj en el script de R
      let nniInfo = null;
      if (s.nni) { const res = nniRefine(tree, matrix, {}); tree = res.root; nniInfo = res; }
      let rootInfo = null;
      if (s.rooting === 'midpoint') { const res = midpointRoot(tree); tree = res.root; rootInfo = res; }
      else if (s.rooting === 'reference' && s.referenceLeaf) {
        // reenraiza DIRECTAMENTE sobre el árbol tal cual llega (trifurcación
        // sin enraizar de NJ, o ya con NNI aplicado) -- nunca pasa antes por
        // midpointRoot, tal y como pide el prompt para este caso.
        const targetLeaf = collectLeaves(tree).find((l) => l.label === s.referenceLeaf);
        if (targetLeaf) { const res = rerootAtLeaf(tree, targetLeaf.id); if (res) tree = res.root; }
      }

      statsBox.insertAdjacentHTML('beforeend',
        '<div class="ql-stat"><div class="ql-stat-label">' + t('phylo.statWidth') + '</div><div class="ql-stat-value" style="font-size:20px;">' + alignedOrdered[0].length + '</div></div>');
      if (s.correction === 'jc' && saturated.length > 0) {
        statsBox.insertAdjacentHTML('beforeend',
          '<div class="ql-stat"><div class="ql-stat-label">' + t('phylo.statSaturated') + '</div><div class="ql-stat-value" style="font-size:20px;color:var(--warning);">' + saturated.length + '</div></div>');
      }
      if (nniInfo) {
        statsBox.insertAdjacentHTML('beforeend',
          '<div class="ql-stat"><div class="ql-stat-label">' + t('phylo.statNniSwaps') + '</div><div class="ql-stat-value" style="font-size:20px;">' + nniInfo.swaps + '</div></div>');
      }
      if (rootInfo) {
        statsBox.insertAdjacentHTML('beforeend',
          '<div class="ql-stat"><div class="ql-stat-label">' + t('phylo.statDiameter') + '</div><div class="ql-stat-value" style="font-size:20px;">' + rootInfo.diameter.toFixed(3) + '</div></div>');
      }

      const leaves = collectLeaves(tree);
      const matchedCategories = s.colorCol ? Array.from(new Set(
        leaves.map((l) => (resolveGroup ? resolveGroup(l.label) : null)).filter(Boolean)
      )).sort() : [];

      const categoryColorMap = new Map();
      matchedCategories.forEach((cat, idx) => {
        categoryColorMap.set(cat, CATEGORICAL[idx % CATEGORICAL.length]);
      });

      function colorForLeaf(label) {
        if (!resolveGroup) return null;
        const group = resolveGroup(label);
        if (!group) return null;
        return categoryColorMap.get(group) || null;
      }

      const colorOpts = {
        colorForLeaf,
        matchedCategories,
        categoryColorMap,
        colorCol: s.colorCol,
        resolveCat: (label) => (resolveGroup ? resolveGroup(label) : null),
      };

      const isCircular = s.layout === 'circular';
      const isSunburst = s.layout === 'sunburst';
      let cladeSeries = [];
      if (isSunburst) ({ cladeSeries } = drawTreeSunburst(svg, tree, colorOpts));
      else if (isCircular) drawCladogramCircular(svg, tree, colorOpts); else drawCladogramRect(svg, tree, colorOpts);
      // la leyenda de categorías ya se dibuja DENTRO del <svg> (data-ce="legend",
      // con data-ce-series-fill por clado -> editable vía paletteSeries más
      // abajo); no duplicarla en un bloque HTML aparte debajo del gráfico.

      editor = attachChartEditor({
        key: isSunburst ? 'phylo-sunburst' : isCircular ? 'phylo-circular' : 'phylo', svg, mount: chartPanel, lang: getLang(),
        filename: t('phylo.figTitle') + (isCircular ? '-' + t('phylo.layoutCircular') : isSunburst ? '-' + t('phylo.layoutSunburst') : ''),
        elements: [
          { id: 'title', create: { text: t('phylo.figTitle'), x: 8, y: 14, anchor: 'start', cls: 'ce-title' } },
          { id: 'leaflabels', selector: '[data-ce="leaflabels"]', kind: 'group' },
          ...(matchedCategories.length > 0 ? [{ id: 'legend', selector: '[data-ce="legend"]', kind: 'group' }] : []),
          ...(isSunburst ? [] : [{ id: 'scalebar', selector: '[data-ce="scalebar"]', kind: 'group' }]),
        ],
        paletteSeries: [
          { id: 'branch', label: t('phylo.branchLabel') },
          ...matchedCategories.map((cat, i) => ({ id: 's' + i, label: cat })),
          ...cladeSeries,
        ],
        paletteType: 'categorical',
        onReset: () => paint(),
        rScript: {
          build: () => phyloScript({
            names: records.map((r) => escapeNewickLabel(r.name)), aligned: alignedOrdered,
            correction: s.correction, nni: s.nni, rooting: s.rooting,
            referenceLeaf: escapeNewickLabel(s.referenceLeaf || ''), newickNJ,
          }),
          hasDataFiles: records.length > R_EMBED_MAX_ROWS,
        },
      });

      const newickCard = document.createElement('section');
      newickCard.className = 'ql-card ql-panel';
      newickCard.style.marginTop = '20px';
      newickCard.innerHTML = '<h2>' + t('phylo.newickTitle') + '</h2><p class="ql-panel-note">' + t('phylo.newickNote') + '</p>';
      const nwk = toNewick(tree);
      const code = document.createElement('pre');
      code.className = 'ql-code';
      code.textContent = nwk;
      newickCard.appendChild(code);
      const nwkBtnRow = document.createElement('div');
      nwkBtnRow.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;';
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button'; copyBtn.className = 'ql-btn';
      copyBtn.textContent = t('phylo.copyBtn');
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(nwk);
          copyBtn.textContent = t('phylo.copiedBtn');
          setTimeout(() => { copyBtn.textContent = t('phylo.copyBtn'); }, 1800);
        } catch (e) { /* portapapeles puede fallar; el texto ya está visible para seleccionar */ }
      });
      nwkBtnRow.appendChild(copyBtn);
      const dlBtn = document.createElement('button');
      dlBtn.type = 'button'; dlBtn.className = 'ql-btn';
      dlBtn.textContent = t('phylo.downloadBtn');
      dlBtn.addEventListener('click', () => download('arbol-smart-175.nwk', nwk, 'text/plain;charset=utf-8'));
      nwkBtnRow.appendChild(dlBtn);
      newickCard.appendChild(nwkBtnRow);
      container.appendChild(newickCard);
    } else if (alignProgress && alignProgress.key === key) {
      const wait = document.createElement('p');
      wait.className = 'ql-panel-note';
      wait.textContent = t('phylo.computing', { done: alignProgress.done, total: alignProgress.total });
      chartWrap.appendChild(wait);
    } else {
      alignProgress = { key, done: 0, total: (records.length * (records.length - 1)) / 2 };
      const wait = document.createElement('p');
      wait.className = 'ql-panel-note';
      wait.textContent = t('phylo.computing', { done: 0, total: alignProgress.total });
      chartWrap.appendChild(wait);
      runAlignment(records, key);
    }
  }

  const stopSub = subscribe(paint);
  paint();
  return () => { stopSub(); alignProgress = null; if (editor) editor.destroy(); };
}
