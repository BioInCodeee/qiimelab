// Heat-tree: árbol taxonómico con topología COMPARTIDA entre paneles.
//
// Por qué existe, y qué problema resuelve de verdad: los barplots apilados
// obligan a agregar a un rango taxonómico grueso (género, familia) para que el
// número de colores sea manejable, y con eso se pierde justo lo que suele ser
// informativo — el nivel profundo. Los heatmaps con clustering separan el
// dendrograma de la matriz, así que el lector tiene que unir mentalmente las
// dos cosas. El heat-tree pinta la jerarquía completa una vez y codifica la
// abundancia en el color y el tamaño de cada nodo.
//
// La clave es la topología compartida: TODOS los paneles (una muestra, un
// grupo, un contraste) usan el mismo árbol de referencia, con correspondencia
// uno a uno de nodos. Así un clado está siempre en la misma posición y las
// comparaciones son visuales, no un ejercicio de memoria. Si cada panel
// calculara su propio árbol con sus propios taxones presentes, las posiciones
// se moverían entre paneles y la comparación sería engañosa.
//
// Todo aquí es puro: construir, agregar, comparar y colocar. El dibujo y los
// controles viven en el módulo.

import { kruskalWallis, benjaminiHochberg, mean } from './stats.js';

/** Rangos taxonómicos estándar de Greengenes/SILVA, por su prefijo. */
export const RANK_PREFIX = ['k', 'p', 'c', 'o', 'f', 'g', 's'];

/**
 * Parte una cadena taxonómica en sus rangos, limpia y sin huecos finales.
 *
 * Tolera lo que de verdad aparece en los archivos: separadores `;` con o sin
 * espacios, prefijos `k__`/`p__`, rangos vacíos (`g__`), y etiquetas de
 * secuencia no clasificada. Un rango vacío CORTA el camino: si el género está
 * vacío no se puede saber la especie, y colgar "s__algo" de un género
 * desconocido inventaría una posición en el árbol.
 *
 * @param {string} name
 * @returns {string[]} Rangos de más general a más específico; vacío si no hay nada.
 */
export function parseTaxonPath(name) {
  const raw = String(name == null ? '' : name).trim();
  if (!raw) return [];
  const parts = raw.split(';').map((p) => p.trim());
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i];
    if (!p) break;
    p = p.replace(/^[a-z]__/i, '').trim();
    // marcas habituales de "aquí ya no se sabe": cortan el camino
    if (!p || /^(unassigned|unclassified|unknown|sin\s*clasificar|na|none|__)$/i.test(p)) break;
    out.push(p);
  }
  return out;
}

/**
 * Árbol de referencia a partir de TODOS los nombres taxonómicos del dataset.
 *
 * El orden de los hijos es alfabético, no el de aparición: la topología tiene
 * que ser idéntica pase lo que pase con el orden de las columnas del archivo,
 * porque es lo que garantiza que dos paneles sean comparables.
 *
 * @param {string[]} taxonNames
 * @returns {{root:Object, nodes:Object[], byId:Map, leavesByTaxon:Map, depth:number}}
 *   Cada nodo: { id, name, path, depth, children, taxa } donde `taxa` son los
 *   nombres originales que caen en ese nodo o por debajo.
 */
export function buildReferenceTree(taxonNames) {
  const root = { id: '', name: '', path: [], depth: 0, children: [], taxa: [] };
  const byId = new Map([['', root]]);
  const leavesByTaxon = new Map();
  let maxDepth = 0;

  (taxonNames || []).forEach((taxon) => {
    const path = parseTaxonPath(taxon);
    if (!path.length) return;
    let node = root;
    root.taxa.push(taxon);
    for (let d = 0; d < path.length; d++) {
      const id = path.slice(0, d + 1).join(';');
      let child = byId.get(id);
      if (!child) {
        child = { id, name: path[d], path: path.slice(0, d + 1), depth: d + 1, children: [], taxa: [] };
        byId.set(id, child);
        node.children.push(child);
      }
      child.taxa.push(taxon);
      node = child;
      if (child.depth > maxDepth) maxDepth = child.depth;
    }
    leavesByTaxon.set(taxon, node);
  });

  const sortRec = (n) => {
    n.children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    n.children.forEach(sortRec);
  };
  sortRec(root);

  const nodes = [];
  const walk = (n) => { nodes.push(n); n.children.forEach(walk); };
  walk(root);

  return { root, nodes, byId, leavesByTaxon, depth: maxDepth };
}

/**
 * Abundancia por nodo y por muestra: la de un nodo es la suma de los taxones
 * que cuelgan de él. Se suma sobre los nombres originales, no sobre los hijos,
 * para que un taxón que solo llega a familia cuente en su familia aunque no
 * tenga descendientes en el árbol.
 *
 * @param {Object} tree Salida de buildReferenceTree.
 * @param {{headers:string[],rows:Object[]}} table Tabla ancha: una fila por
 *   muestra, los taxones como columnas (la forma de state.taxaBarplot.levels).
 * @param {string} sampleKey Columna con el identificador de muestra.
 * @returns {{bySample:string[], values:Map<string, number[]>}} values: id de
 *   nodo -> abundancia en el orden de bySample.
 */
export function abundanceByNode(tree, table, sampleKey) {
  const rows = (table && table.rows) || [];
  const headers = (table && table.headers) || [];
  const taxonCols = headers.filter((h) => h !== sampleKey && tree.leavesByTaxon.has(h));
  const bySample = rows.map((r) => String(r[sampleKey]));

  const values = new Map();
  tree.nodes.forEach((n) => { if (n.depth > 0) values.set(n.id, new Array(bySample.length).fill(0)); });

  taxonCols.forEach((col) => {
    const path = parseTaxonPath(col);
    if (!path.length) return;
    // ids de todos los ancestros del taxón, incluido él mismo
    const ids = [];
    for (let d = 0; d < path.length; d++) ids.push(path.slice(0, d + 1).join(';'));
    rows.forEach((r, i) => {
      const v = Number(r[col]);
      if (!Number.isFinite(v) || v === 0) return;
      ids.forEach((id) => {
        const arr = values.get(id);
        if (arr) arr[i] += v;
      });
    });
  });

  return { bySample, values };
}

/**
 * Contraste de dos grupos nodo a nodo.
 *
 * Test: Wilcoxon de suma de rangos, que para dos grupos es exactamente lo que
 * calcula `kruskalWallis` (ya validado contra R en la suite) — no se
 * reimplementa aquí. Corrección de comparaciones múltiples: Benjamini-Hochberg
 * sobre TODOS los nodos probados a la vez, que es lo correcto: un heat-tree
 * prueba cientos de nodos y sin corregir el panel se llena de falsos
 * positivos.
 *
 * El log2 fold-change necesita un pseudoconteo porque un grupo puede tener
 * abundancia 0; se toma, por defecto, la mitad de la media positiva más
 * pequeña del dataset, y se declara en la salida para que la figura pueda
 * decirlo.
 *
 * @param {{bySample:string[], values:Map}} abundance
 * @param {string[]} groupA Ids de muestra.
 * @param {string[]} groupB
 * @param {Object} [opts] { pseudocount, minPresence }
 * @returns {{results:Map<string,Object>, pseudocount:number, tested:number}}
 */
export function compareTwoGroups(abundance, groupA, groupB, opts = {}) {
  const idx = new Map(abundance.bySample.map((s, i) => [s, i]));
  const ia = groupA.map((s) => idx.get(s)).filter((i) => i != null);
  const ib = groupB.map((s) => idx.get(s)).filter((i) => i != null);
  const minPresence = Number.isFinite(opts.minPresence) ? opts.minPresence : 1;

  // Pseudoconteo: la mitad del VALOR positivo más pequeño de la tabla, no de
  // la media más pequeña por nodo. La diferencia no es cosmética: con medias
  // el pseudoconteo sale del orden de la abundancia típica y encoge los
  // fold-changes reales a la mitad. Con el valor mínimo queda en la escala del
  // límite de detección, que es lo que un pseudoconteo debe representar.
  let smallest = Infinity;
  abundance.values.forEach((arr) => {
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v > 0 && v < smallest) smallest = v;
    }
  });
  const pseudocount = Number.isFinite(opts.pseudocount)
    ? opts.pseudocount
    : (Number.isFinite(smallest) && smallest > 0 ? smallest / 2 : 1e-9);

  const entries = [];
  abundance.values.forEach((arr, id) => {
    const a = ia.map((i) => arr[i]);
    const b = ib.map((i) => arr[i]);
    const present = a.concat(b).filter((v) => v > 0).length;
    if (a.length < 2 || b.length < 2 || present < minPresence) return;
    const mA = mean(a);
    const mB = mean(b);
    let p = NaN;
    try {
      const kw = kruskalWallis([a, b]);
      p = kw && Number.isFinite(kw.p) ? kw.p : NaN;
    } catch (e) { p = NaN; }
    entries.push({
      id, meanA: mA, meanB: mB,
      log2fc: Math.log2((mA + pseudocount) / (mB + pseudocount)),
      p,
    });
  });

  const withP = entries.filter((e) => Number.isFinite(e.p));
  const q = benjaminiHochberg(withP.map((e) => e.p));
  withP.forEach((e, i) => { e.q = q[i]; });
  entries.forEach((e) => { if (!Number.isFinite(e.q)) e.q = NaN; });

  const results = new Map(entries.map((e) => [e.id, e]));
  return { results, pseudocount, tested: withP.length };
}

/** Hojas del árbol en orden, que es lo que fija el eje de la disposición. */
export function leafOrder(tree) {
  const out = [];
  const walk = (n) => {
    if (!n.children.length) { if (n.depth > 0) out.push(n); return; }
    n.children.forEach(walk);
  };
  walk(tree.root);
  return out;
}

/**
 * Disposición en dendrograma: profundidad en x, hojas repartidas en y, y cada
 * nodo interno centrado sobre sus hijos (como un dendrograma clásico). Las
 * coordenadas salen normalizadas en [0, 1] para que el módulo las escale al
 * tamaño del panel sin recalcular nada.
 *
 * @returns {Map<string,{x:number,y:number}>}
 */
export function layoutDendrogram(tree) {
  const pos = new Map();
  const leaves = leafOrder(tree);
  const denom = Math.max(1, leaves.length - 1);
  const depthDenom = Math.max(1, tree.depth);
  leaves.forEach((n, i) => {
    pos.set(n.id, { x: n.depth / depthDenom, y: leaves.length === 1 ? 0.5 : i / denom });
  });
  const place = (n) => {
    if (!n.children.length) return pos.get(n.id);
    const ys = n.children.map((c) => place(c).y);
    const y = (Math.min(...ys) + Math.max(...ys)) / 2;
    const p = { x: n.depth / depthDenom, y };
    pos.set(n.id, p);
    return p;
  };
  place(tree.root);
  return pos;
}

/**
 * Disposición radial: el mismo orden de hojas, pero el eje y se convierte en
 * ángulo y la profundidad en radio. Coordenadas en [-1, 1] con el centro en
 * (0, 0).
 *
 * @param {Object} tree
 * @param {Object} [opts] { startAngle, sweep } en radianes.
 * @returns {Map<string,{x:number,y:number,angle:number,radius:number}>}
 */
export function layoutRadial(tree, opts = {}) {
  const start = Number.isFinite(opts.startAngle) ? opts.startAngle : -Math.PI / 2;
  const sweep = Number.isFinite(opts.sweep) ? opts.sweep : Math.PI * 2;
  const dend = layoutDendrogram(tree);
  const pos = new Map();
  dend.forEach((p, id) => {
    const angle = start + p.y * sweep;
    const radius = p.x;
    pos.set(id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle), angle, radius });
  });
  return pos;
}

/**
 * Qué etiquetas se dibujan.
 *
 * Es la diferencia entre un heat-tree legible y una maraña: a partir de
 * familia hay cientos de nodos y sus nombres se solapan. Se eligen por
 * importancia (abundancia) y se descarta cualquiera que caiga demasiado cerca
 * de otra ya aceptada, en el espacio de la propia disposición.
 *
 * @param {Array<{id:string,depth:number}>} nodes
 * @param {Map<string,{x:number,y:number}>} pos
 * @param {Map<string,number>} weight id -> importancia (p. ej. abundancia media).
 * @param {Object} [opts] { maxDepth, maxLabels, minSeparation }
 * @returns {Set<string>} Ids cuya etiqueta se dibuja.
 */
export function cullLabels(nodes, pos, weight, opts = {}) {
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : Infinity;
  const maxLabels = Number.isFinite(opts.maxLabels) ? opts.maxLabels : 40;
  const sep = Number.isFinite(opts.minSeparation) ? opts.minSeparation : 0.02;

  const cand = nodes
    .filter((n) => n.depth > 0 && n.depth <= maxDepth && pos.has(n.id))
    .map((n) => ({ id: n.id, w: Number(weight && weight.get(n.id)) || 0, p: pos.get(n.id) }))
    .sort((a, b) => b.w - a.w || (a.id < b.id ? -1 : 1));

  const kept = [];
  for (let i = 0; i < cand.length && kept.length < maxLabels; i++) {
    const c = cand[i];
    let ok = true;
    for (let j = 0; j < kept.length; j++) {
      const k = kept[j];
      if ((c.p.x - k.p.x) ** 2 + (c.p.y - k.p.y) ** 2 < sep * sep) { ok = false; break; }
    }
    if (ok) kept.push(c);
  }
  return new Set(kept.map((c) => c.id));
}

/**
 * Las filas de la tabla de resultados del contraste: los nodos con señal, de
 * más a menos significativos.
 *
 * Existe por una razón de accesibilidad, no de adorno: una figura cuyo dato
 * vive en el color necesita una vista en tabla para quien no distingue esos
 * colores, para quien la imprime en gris y para quien quiere el número exacto
 * en vez de estimarlo de una rampa.
 *
 * @param {{results:Map<string,Object>}} cmp Salida de compareTwoGroups.
 * @param {Object} tree Árbol de referencia (para el nombre y el camino).
 * @param {Object} [opts] { limit = 25, maxQ = 0.05 }
 * @returns {Array<{id:string,name:string,path:string,log2fc:number,p:number,q:number,depth:number}>}
 */
export function topContrastRows(cmp, tree, opts = {}) {
  const limit = Number.isFinite(opts.limit) ? opts.limit : 25;
  const maxQ = Number.isFinite(opts.maxQ) ? opts.maxQ : 0.05;
  const rows = [];
  cmp.results.forEach((r, id) => {
    if (!Number.isFinite(r.q) || r.q > maxQ) return;
    const n = tree.byId.get(id);
    if (!n) return;
    rows.push({
      id, name: n.name, path: n.path.join(' › '), depth: n.depth,
      log2fc: r.log2fc, p: r.p, q: r.q,
    });
  });
  // por q, y a igualdad de q por magnitud del cambio: el orden que un lector
  // espera de una tabla de resultados
  rows.sort((a, b) => a.q - b.q || Math.abs(b.log2fc) - Math.abs(a.log2fc) ||
    (a.id < b.id ? -1 : 1));
  return rows.slice(0, limit);
}
