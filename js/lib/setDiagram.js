// Diagramas de conjuntos compartidos: partición por máscara de bits + los
// dibujos de Venn (2-4) y UpSet (5+). Los usa el módulo Venn/UpSet y la vista
// "Comparar varias" de abundancia diferencial (allí los "conjuntos" son
// comparaciones y los "miembros" son entidades significativas).

import { t } from './i18n.js';
import { CAT_VARS } from './groupBoxplot.js';
import { svgEl } from './dom.js';

export function popcount(n) { let c = 0; while (n) { c += n & 1; n >>= 1; } return c; }

/**
 * Parte una colección de conjuntos en regiones por máscara de bits de
 * pertenencia. `memberSets[i]` = miembros del conjunto `setNames[i]`.
 * @returns {{ byMask: Map<number,string[]>, presence: Map<string,Set> }}
 */
export function partitionByMask(setNames, memberSets) {
  const presence = new Map();
  setNames.forEach((name, i) => presence.set(name, new Set(memberSets[i] || [])));
  const universe = new Set();
  presence.forEach((s) => s.forEach((m) => universe.add(m)));
  const byMask = new Map();
  universe.forEach((m) => {
    let mask = 0;
    setNames.forEach((name, i) => { if (presence.get(name).has(m)) mask |= (1 << i); });
    if (mask === 0) return;
    if (!byMask.has(mask)) byMask.set(mask, []);
    byMask.get(mask).push(m);
  });
  return { byMask, presence };
}

// ---- geometría fija de los diagramas de Venn (2, 3 y 4 conjuntos) ----
// Cada layout: viewBox, shapes (círculos/elipses con su color) y la posición
// de la etiqueta de cada región (clave = máscara de bits de los grupos).
export const VENN_LAYOUTS = {
  2: {
    vb: [0, 0, 520, 340],
    shapes: [
      { type: 'circle', cx: 205, cy: 170, r: 120, ci: 0 },
      { type: 'circle', cx: 315, cy: 170, r: 120, ci: 1 },
    ],
    labels: { 1: [140, 175], 2: [380, 175], 3: [260, 175] },
    nameAt: { 0: [120, 45], 1: [400, 45] },
  },
  3: {
    vb: [0, 0, 520, 460],
    shapes: [
      { type: 'circle', cx: 200, cy: 175, r: 130, ci: 0 },
      { type: 'circle', cx: 320, cy: 175, r: 130, ci: 1 },
      { type: 'circle', cx: 260, cy: 285, r: 130, ci: 2 },
    ],
    labels: {
      1: [140, 135], 2: [380, 135], 4: [260, 370],
      3: [260, 120], 5: [180, 250], 6: [340, 250],
      7: [260, 215],
    },
    nameAt: { 0: [110, 40], 1: [410, 40], 2: [260, 440] },
  },
  4: {
    vb: [0, 0, 660, 470],
    shapes: [
      { type: 'ellipse', cx: 250, cy: 280, rx: 230, ry: 140, rot: -40, ci: 0 },
      { type: 'ellipse', cx: 315, cy: 245, rx: 230, ry: 140, rot: -40, ci: 1 },
      { type: 'ellipse', cx: 335, cy: 245, rx: 230, ry: 140, rot: 40, ci: 2 },
      { type: 'ellipse', cx: 400, cy: 280, rx: 230, ry: 140, rot: 40, ci: 3 },
    ],
    labels: {
      1: [95, 245], 2: [225, 90], 4: [430, 90], 8: [560, 245],
      3: [180, 180], 12: [475, 180], 6: [330, 140],
      5: [235, 385], 10: [420, 385], 9: [330, 410],
      7: [250, 300], 14: [405, 300], 11: [288, 362], 13: [370, 362],
      15: [330, 255],
    },
    nameAt: { 0: [70, 155], 1: [210, 45], 2: [450, 45], 3: [590, 155] },
  },
};

/**
 * Diagrama de Venn de 2-4 conjuntos.
 * @param {HTMLElement} host  se vacía y recibe el <svg>
 * @param {string[]} groups
 * @param {Map<number,string[]>} byMask
 * @param {(mask:number)=>void} onRegion  clic en una región
 * @param {{ ariaLabel?: string }} [opts]
 */
export function drawVenn(host, groups, byMask, onRegion, opts = {}) {
  const layout = VENN_LAYOUTS[groups.length];
  host.innerHTML = '';
  const vb = [layout.vb[0], layout.vb[1] - 34, layout.vb[2], layout.vb[3] + 34];
  const svg = svgEl('svg', { class: 'ql-svg', viewBox: vb.join(' '), role: 'img', 'aria-label': opts.ariaLabel || t('a11y.chartVenn') });

  const fillAlpha = groups.length >= 4 ? 0.22 : 0.3;
  layout.shapes.forEach((sh) => {
    const col = 'var(' + CAT_VARS[sh.ci % CAT_VARS.length] + ')';
    const common = {
      fill: col, 'fill-opacity': fillAlpha, stroke: col, 'stroke-opacity': 0.55, 'stroke-width': 1, 'data-ce-role': 'line',
      'data-ce-series-fill': 's' + sh.ci, 'data-ce-series-stroke': 's' + sh.ci,
    };
    if (sh.type === 'circle') svg.appendChild(svgEl('circle', { cx: sh.cx, cy: sh.cy, r: sh.r, ...common }));
    else svg.appendChild(svgEl('ellipse', { cx: sh.cx, cy: sh.cy, rx: sh.rx, ry: sh.ry, transform: 'rotate(' + sh.rot + ' ' + sh.cx + ' ' + sh.cy + ')', ...common }));
  });

  groups.forEach((g, gi) => {
    const at = layout.nameAt[gi];
    if (!at) return;
    const tx = svgEl('text', {
      x: at[0], y: at[1], class: 'ql-axis-label', 'text-anchor': at[2] || 'middle',
      'font-weight': 700, 'font-size': 14, fill: 'var(' + CAT_VARS[gi % CAT_VARS.length] + ')',
      'data-ce': 'grp' + gi, 'data-ce-series-fill': 's' + gi,
    });
    tx.textContent = g.length > 18 ? g.slice(0, 17) + '…' : g;
    svg.appendChild(tx);
  });

  Object.keys(layout.labels).forEach((maskStr) => {
    const mask = parseInt(maskStr, 10);
    const [x, y] = layout.labels[mask];
    const n = (byMask.get(mask) || []).length;
    const g = svgEl('g', { class: 'vn-region', 'data-mask': mask, style: 'cursor:pointer;' });
    g.appendChild(svgEl('circle', { cx: x, cy: y, r: 20, fill: 'transparent' }));
    const tEl = svgEl('text', {
      x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-family': 'var(--font-display)', 'font-size': n ? 23 : 17, 'font-weight': 600,
      fill: n ? 'var(--ink)' : 'var(--ink-muted)',
    });
    tEl.textContent = n;
    g.appendChild(tEl);
    g.addEventListener('click', () => onRegion(mask));
    svg.appendChild(g);
  });

  host.appendChild(svg);
  return svg;
}

/**
 * Diagrama UpSet (barras de intersección + matriz de puntos) para 5+ conjuntos
 * (o cuando se prefiera a un Venn).
 * @param {{ ariaLabel?: string, hiddenNote?: (max:number, hidden:number)=>string }} [opts]
 */
export function drawUpset(host, groups, byMask, presence, onRegion, opts = {}) {
  host.innerHTML = '';
  const MAX_COMBOS = 26;
  const allCombos = Array.from(byMask.entries()).map(([mask, taxa]) => ({ mask, n: taxa.length }));
  const combos = allCombos.sort((a, b) => b.n - a.n || popcount(a.mask) - popcount(b.mask)).slice(0, MAX_COMBOS);
  const hidden = allCombos.length - combos.length;

  const setSizes = groups.map((g) => presence.get(g).size);
  const maxSet = Math.max(1, ...setSizes);
  const maxCombo = Math.max(1, ...combos.map((c) => c.n));

  const leftW = 170, barMaxW = 130, colW = 30, rowH = 26;
  const topH = 190, dotR = 7;
  const matrixX0 = leftW + barMaxW + 14;
  const matrixY0 = topH + 28;
  const W = matrixX0 + combos.length * colW + 16;
  const H = matrixY0 + groups.length * rowH + 14;
  const svg = svgEl('svg', { class: 'ql-svg', viewBox: '0 -34 ' + W + ' ' + (H + 34), role: 'img', 'aria-label': opts.ariaLabel || t('a11y.chartUpset') });
  svg.style.width = Math.max(W, 680) + 'px';
  svg.style.maxWidth = 'none';

  groups.forEach((_, gi) => {
    if (gi % 2 === 0) svg.appendChild(svgEl('rect', { x: matrixX0 - 6, y: matrixY0 + gi * rowH, width: combos.length * colW + 6, height: rowH, fill: 'var(--page)' }));
  });

  combos.forEach((c, ci) => {
    const x = matrixX0 + ci * colW;
    const h = (c.n / maxCombo) * (topH - 24);
    const g = svgEl('g', { class: 'vn-region', 'data-mask': c.mask, style: 'cursor:pointer;' });
    g.appendChild(svgEl('rect', { x, y: 0, width: colW, height: H, fill: 'transparent' }));
    g.appendChild(svgEl('rect', { x: x + 4, y: topH - h, width: colW - 8, height: Math.max(h, 1), fill: 'var(--ink-2)', rx: 2, 'data-ce-role': 'bar' }));
    const tEl = svgEl('text', { x: x + colW / 2, y: topH - h - 6, 'text-anchor': 'middle', class: 'ql-tick-label' });
    tEl.textContent = c.n;
    g.appendChild(tEl);
    g.addEventListener('click', () => onRegion(c.mask));
    svg.appendChild(g);
  });

  // con más conjuntos que tonos de la paleta categórica (7), los colores se
  // repetirían y dos conjuntos parecerían el mismo: color neutro para todos
  // (en UpSet cada conjunto ya se identifica por su fila y su etiqueta;
  // sigue pudiendo recolorearse desde el editor)
  const manySets = groups.length > CAT_VARS.length;
  groups.forEach((g, gi) => {
    const y = matrixY0 + gi * rowH;
    const w = (setSizes[gi] / maxSet) * barMaxW;
    const col = manySets ? 'var(--ink-2)' : 'var(' + CAT_VARS[gi % CAT_VARS.length] + ')';
    svg.appendChild(svgEl('rect', { x: leftW + (barMaxW - w), y: y + 4, width: Math.max(w, 1), height: rowH - 9, fill: col, 'fill-opacity': 0.85, rx: 2, 'data-ce-role': 'barh', 'data-ce-series-fill': 's' + gi }));
    const lbl = svgEl('text', { x: leftW - 10, y: y + rowH / 2 + 4, 'text-anchor': 'end', class: 'ql-tick-label', fill: col, 'font-weight': 600, 'data-ce': 'set' + gi, 'data-ce-series-fill': 's' + gi });
    lbl.textContent = (g.length > 20 ? g.slice(0, 19) + '…' : g) + ' · ' + setSizes[gi];
    svg.appendChild(lbl);
  });

  combos.forEach((c, ci) => {
    const cx = matrixX0 + ci * colW + colW / 2;
    const rowsIn = [];
    groups.forEach((_, gi) => {
      const cy = matrixY0 + gi * rowH + rowH / 2;
      const on = (c.mask >> gi) & 1;
      svg.appendChild(svgEl('circle', { cx, cy, r: dotR, fill: on ? 'var(--ink)' : 'var(--gridline)', 'data-ce-role': 'marker' }));
      if (on) rowsIn.push(cy);
    });
    if (rowsIn.length > 1) svg.appendChild(svgEl('line', { x1: cx, x2: cx, y1: Math.min(...rowsIn), y2: Math.max(...rowsIn), stroke: 'var(--ink)', 'stroke-width': 2.5, 'data-ce-role': 'line' }));
  });

  host.appendChild(svg);
  if (hidden > 0) {
    const note = document.createElement('p');
    note.className = 'ql-field-help';
    note.textContent = opts.hiddenNote ? opts.hiddenNote(MAX_COMBOS, hidden) : t('venn.hiddenNote', { max: MAX_COMBOS, hidden });
    host.appendChild(note);
  }
  return svg;
}
