// Construcción del árbol por Neighbor-Joining (Saitou & Nei 1987) a partir
// de una matriz de distancias — NO UPGMA (UPGMA asume reloj molecular
// constante, poco apropiado para secuencias de estudios/orígenes distintos).
//
// `neighborJoining()` es una función PURA (matriz de distancias + etiquetas
// -> árbol), aislada a propósito: así, si en el futuro se añade soporte
// bootstrap, basta con remuestrear columnas del alineamiento, recalcular la
// matriz de distancias y volver a llamar a esta misma función N veces — no
// hace falta tocar nada de aquí ni construir esa infraestructura ahora.
//
// Verificado frente a `ape::nj()` con el ejemplo de 5 taxones publicado en
// la entrada de Wikipedia "Neighbor joining" (mismos topología y longitudes
// de rama exactas) — ver tests/stats/neighborjoining.mjs.
//
// Forma del árbol: nodo = { id, label (string|null; null en internos),
// children: [{ node, length }, ...] }. Un árbol NJ es propiamente NO
// enraizado; aquí se representa con una trifurcación en la raíz (3 hijos)
// cuando hay >= 3 taxones — es la convención estándar (la usa por ejemplo
// `ape::nj()`), no una raíz artificial partiendo en dos la última rama.

/**
 * @param {number[][]} distMatrix matriz de distancias cuadrada
 * @param {string[]} labels
 * @returns {object} nodo raíz del árbol
 */
export function neighborJoining(distMatrix, labels) {
  const n = labels.length;
  if (n < 2) throw new Error('se necesitan al menos 2 secuencias para construir un árbol');

  const nodesById = new Map();
  labels.forEach((label, i) => nodesById.set(i, { id: i, label, children: [] }));
  let nextId = n;

  if (n === 2) {
    const d = distMatrix[0][1];
    return {
      id: nextId, label: null,
      children: [
        { node: nodesById.get(0), length: d / 2 },
        { node: nodesById.get(1), length: d / 2 },
      ],
    };
  }

  const dist = new Map();
  for (let i = 0; i < n; i++) {
    dist.set(i, new Map());
    for (let j = 0; j < n; j++) if (i !== j) dist.get(i).set(j, distMatrix[i][j]);
  }
  let activeIds = Array.from({ length: n }, (_, i) => i);

  while (activeIds.length > 3) {
    const r = activeIds.length;
    const rowSum = new Map();
    for (const i of activeIds) {
      let s = 0;
      for (const j of activeIds) if (j !== i) s += dist.get(i).get(j);
      rowSum.set(i, s);
    }
    let bestI = -1, bestJ = -1, bestQ = Infinity;
    for (let a = 0; a < activeIds.length; a++) {
      for (let b = a + 1; b < activeIds.length; b++) {
        const i = activeIds[a], j = activeIds[b];
        const q = (r - 2) * dist.get(i).get(j) - rowSum.get(i) - rowSum.get(j);
        if (q < bestQ) { bestQ = q; bestI = i; bestJ = j; }
      }
    }
    const dij = dist.get(bestI).get(bestJ);
    const li = 0.5 * dij + (rowSum.get(bestI) - rowSum.get(bestJ)) / (2 * (r - 2));
    const lj = dij - li;
    const newId = nextId++;
    nodesById.set(newId, {
      id: newId, label: null,
      children: [
        { node: nodesById.get(bestI), length: li },
        { node: nodesById.get(bestJ), length: lj },
      ],
    });
    const newDist = new Map();
    for (const k of activeIds) {
      if (k === bestI || k === bestJ) continue;
      const dk = 0.5 * (dist.get(bestI).get(k) + dist.get(bestJ).get(k) - dij);
      newDist.set(k, dk);
      dist.get(k).set(newId, dk);
    }
    dist.set(newId, newDist);
    activeIds = activeIds.filter((x) => x !== bestI && x !== bestJ);
    activeIds.push(newId);
  }

  const [p, q, rId] = activeIds;
  const dpq = dist.get(p).get(q), dpr = dist.get(p).get(rId), dqr = dist.get(q).get(rId);
  const lp = (dpq + dpr - dqr) / 2, lq = (dpq + dqr - dpr) / 2, lr = (dpr + dqr - dpq) / 2;
  return {
    id: nextId, label: null,
    children: [
      { node: nodesById.get(p), length: lp },
      { node: nodesById.get(q), length: lq },
      { node: nodesById.get(rId), length: lr },
    ],
  };
}

/** Hojas del árbol en orden de recorrido (izquierda a derecha) — orden de dibujo. */
export function collectLeaves(node, out) {
  out = out || [];
  if (!node.children.length) { out.push(node); return out; }
  for (const ch of node.children) collectLeaves(ch.node, out);
  return out;
}

function leafIdsUnder(node) { return collectLeaves(node, []).map((l) => l.id); }

function avgDist(distMatrix, idsA, idsB) {
  let sum = 0, n = 0;
  for (const i of idsA) for (const j of idsB) { sum += distMatrix[i][j]; n++; }
  return n ? sum / n : 0;
}

/**
 * Longitudes de rama "de 4 puntos" para una topología con X,Y a un lado de
 * la rama interna y Z,W al otro (fórmula aditiva estándar, la misma familia
 * que la reestimación de longitudes al fusionar dos clústeres en NJ — aquí
 * para 4 clústeres en vez de 2). `e` es la rama interna (entre los dos
 * lados); lenX/lenY/lenZ/lenW las 4 ramas "pendientes" hacia cada clúster.
 */
function fourPointBranchLengths(distMatrix, X, Y, Z, W) {
  const dXY = avgDist(distMatrix, X, Y), dZW = avgDist(distMatrix, Z, W);
  const dXZ = avgDist(distMatrix, X, Z), dYW = avgDist(distMatrix, Y, W);
  const dXW = avgDist(distMatrix, X, W), dYZ = avgDist(distMatrix, Y, Z);
  const e = ((dXZ + dYW) + (dXW + dYZ) - 2 * (dXY + dZW)) / 4;
  return {
    e,
    lenX: (dXZ + dXW - dZW) / 2 - e,
    lenY: (dYZ + dYW - dZW) / 2 - e,
    lenZ: (dXZ + dYZ - dXY) / 2 - e,
    lenW: (dXW + dYW - dXY) / 2 - e,
  };
}

/**
 * NNI (Nearest-Neighbor Interchange) de refinamiento tras Neighbor-Joining,
 * por el criterio de "evolución mínima": para cada rama INTERNA (entre dos
 * nodos que no son hojas), hay 3 formas de repartir los 4 subárboles vecinos
 * en dos grupos de dos — la actual y otras dos. Con una propiedad conocida
 * de los árboles aditivos, la longitud TOTAL del árbol para cada reparto es
 * (S + 2·P) / 4, donde P es la suma de las dos distancias del reparto
 * (promedio entre hojas de cada clúster, sobre la matriz de distancias
 * original) y S la suma de las otras 4 — así que minimizar la longitud
 * total equivale a minimizar P. Si un reparto distinto del actual da una P
 * menor, se aplica ese intercambio (y se recalculan las 5 ramas locales con
 * la misma fórmula de 4 puntos) y se repite hasta que ninguna rama interna
 * mejore, o se llegue al tope de pasadas.
 *
 * Es un refinamiento LOCAL, no una búsqueda de máxima verosimilitud ni un
 * reajuste global de todas las longitudes de rama: la rama de entrada de un
 * nodo (hacia su propio padre) no se toca al evaluar sus ramas internas
 * salientes — es justo el "lado B" implícito en la fórmula, no hace falta
 * un nodo concreto para él, así que nunca se reescribe directamente. Por
 * eso mismo, el criterio de P (basado en distancias MEDIAS, no en las
 * longitudes de rama reales que ya hay) es una guía muy buena pero no
 * perfecta en datos ruidosos/no aditivos — así que al final se comprueba la
 * longitud total REAL antes y después de todas las pasadas; si por lo que
 * sea saliera peor, se descartan todos los cambios y se devuelve el árbol
 * de entrada tal cual (con swaps:0) en vez de arriesgarse a empeorarlo.
 *
 * Trabaja sobre una COPIA del árbol (nunca muta el que se le pasa): así, si
 * al final hay que descartar los cambios, basta con devolver el original.
 * @param {object} root
 * @param {number[][]} distMatrix
 * @param {{ maxPasses?: number, eps?: number }} [opts]
 * @returns {{ root: object, swaps: number, passes: number }}
 */
function cloneTree(node) {
  return { id: node.id, label: node.label, children: node.children.map((c) => ({ node: cloneTree(c.node), length: c.length })) };
}
function totalLength(node) {
  let sum = 0;
  for (const { node: child, length } of node.children) { sum += length; sum += totalLength(child); }
  return sum;
}
export function nniRefine(originalRoot, distMatrix, opts = {}) {
  const maxPasses = opts.maxPasses ?? 50;
  const eps = opts.eps ?? 1e-9;
  const root = cloneTree(originalRoot);
  const allIds = leafIdsUnder(root);

  function swapAt(U, V) {
    const others = U.children.filter((c) => c.node !== V);
    const Aentry = others[0];
    const Bentry = others.length === 2 ? others[1] : null;
    const Aids = leafIdsUnder(Aentry.node);
    const Bids = Bentry ? leafIdsUnder(Bentry.node) : (() => {
      const used = new Set([...Aids, ...leafIdsUnder(V)]);
      return allIds.filter((x) => !used.has(x));
    })();
    const vEntry = U.children.find((c) => c.node === V);
    const vIdx = U.children.indexOf(vEntry);
    const [Centry, Dentry] = V.children;
    const Cids = leafIdsUnder(Centry.node), Dids = leafIdsUnder(Dentry.node);
    const aIdx = U.children.indexOf(Aentry);

    // Las 3 reparticiones posibles de los 4 clústeres, por el criterio de
    // "evolución mínima" (ver comentario de nniRefine): P = suma de las dos
    // distancias MEDIAS del reparto — la que tenga P menor tiene la longitud
    // total menor. No hace falta el término del lado B virtual aquí: al ser
    // el mismo en los tres repartos (su arista no cambia de sitio, tal como
    // se explica más abajo), no afecta a CUÁL es menor.
    const P = {
      false: avgDist(distMatrix, Aids, Bids) + avgDist(distMatrix, Cids, Dids), // sin cambios: {A,B}|{C,D}
      AC: avgDist(distMatrix, Bids, Cids) + avgDist(distMatrix, Aids, Dids), // -> {B,C}|{A,D}
      AD: avgDist(distMatrix, Bids, Dids) + avgDist(distMatrix, Aids, Cids), // -> {B,D}|{A,C}
    };
    const candidates = [
      { key: false, swapped: false, uSide: ['A', 'B'], vSide: ['C', 'D'] },
      { key: 'AC', swapped: true, uSide: ['B', 'C'], vSide: ['A', 'D'] },
      { key: 'AD', swapped: true, uSide: ['B', 'D'], vSide: ['A', 'C'] },
    ];
    const winner = candidates.reduce((best, c) => (P[c.key] < P[best.key] ? c : best));
    if (!(P[winner.key] < P[false] - eps)) return false; // ningún reparto distinto mejora de verdad: no se toca nada

    // Se reajustan las 5 longitudes locales a la topología ganadora SIEMPRE
    // (incluso si formalmente "gana" la actual, lo que aquí ya no puede
    // pasar porque el `if` de arriba corta antes) para que el árbol quede
    // consistente con el mismo criterio en toda su extensión.
    const { e, lenX, lenY, lenZ, lenW } = winner.key === false
      ? fourPointBranchLengths(distMatrix, Aids, Bids, Cids, Dids)
      : winner.key === 'AC'
        ? fourPointBranchLengths(distMatrix, Bids, Cids, Aids, Dids)
        : fourPointBranchLengths(distMatrix, Bids, Dids, Aids, Cids);
    const lenOf = { [winner.uSide[0]]: lenX, [winner.uSide[1]]: lenY, [winner.vSide[0]]: lenZ, [winner.vSide[1]]: lenW };
    winner.lenOf = lenOf; winner.e = e;

    // B nunca aparece en `vSide` en ninguno de los 3 repartos (el lado que
    // queda "hacia el padre de U" no puede pasar a ser hijo de V) — así que
    // solo hace falta colocar sitio a sitio los miembros CONCRETOS de
    // `uSide`: si B es virtual, uSide trae un único concreto (va al hueco
    // de A); si B es un hijo real (U es la raíz), trae dos, uno para cada
    // hueco. B en sí nunca se coloca en ningún sitio — sigue "donde estaba"
    // (vía el padre de U), tal cual explica el comentario de más arriba.
    const nodeOf = { A: Aentry.node, B: Bentry ? Bentry.node : null, C: Centry.node, D: Dentry.node };
    const uConcreteSlots = [aIdx, ...(Bentry ? [U.children.indexOf(Bentry)] : [])];
    const uConcreteLabels = winner.uSide.filter((label) => label !== 'B' || Bentry);
    uConcreteSlots.forEach((slot, i) => {
      const label = uConcreteLabels[i];
      U.children[slot] = { node: nodeOf[label], length: winner.lenOf[label] };
    });
    U.children[vIdx] = { node: V, length: winner.e };
    V.children = [
      { node: nodeOf[winner.vSide[0]], length: winner.lenOf[winner.vSide[0]] },
      { node: nodeOf[winner.vSide[1]], length: winner.lenOf[winner.vSide[1]] },
    ];
    return winner.swapped;
  }

  // Lista de todas las ramas internas (parejas padre-hijo con el hijo no
  // hoja) tal como están AL EMPEZAR la pasada. Un intercambio en una rama
  // mueve nodos de sitio, así que antes de aplicar cada uno se comprueba
  // que la pareja siga siendo una rama real del árbol EN ESE MOMENTO — si
  // ya no lo es (un intercambio anterior en esta misma pasada movió alguno
  // de los dos), se salta en vez de mutar con referencias obsoletas.
  function collectInternalEdges(node, out) {
    out = out || [];
    for (const { node: child } of node.children) {
      if (child.children.length) { out.push([node, child]); collectInternalEdges(child, out); }
    }
    return out;
  }

  let swaps = 0, passes = 0;
  for (; passes < maxPasses; passes++) {
    const edges = collectInternalEdges(root);
    let didThisPass = false;
    for (const [U, V] of edges) {
      if (!U.children.some((c) => c.node === V)) continue; // ya no es una rama real (movida antes en esta pasada)
      if (swapAt(U, V)) { swaps++; didThisPass = true; }
    }
    if (!didThisPass) break;
  }

  // salvaguarda final: el criterio de P (distancias medias) es una guía, no
  // una garantía exacta fuera de árboles perfectamente aditivos — si el
  // resultado real saliera peor que el original, se descarta entero.
  if (totalLength(root) > totalLength(originalRoot) + eps) return { root: originalRoot, swaps: 0, passes: 0 };
  return { root, swaps, passes };
}

/**
 * Profundidad acumulada (suma de longitudes de rama desde la raíz) de cada
 * nodo. Las longitudes negativas (artefacto conocido de NJ con datos
 * ruidosos) se recortan a 0 SOLO para esta profundidad de dibujo — el valor
 * real se conserva en el árbol y en el Newick exportado.
 * @returns {{ depths: Map<number,number>, clipped: number, maxDepth: number }}
 */
export function computeDrawDepths(root) {
  const depths = new Map();
  let clipped = 0, maxDepth = 0;
  depths.set(root.id, 0);
  function recurse(node, depth) {
    for (const { node: child, length } of node.children) {
      const len = length < 0 ? (clipped++, 0) : length;
      const d = depth + len;
      depths.set(child.id, d);
      maxDepth = Math.max(maxDepth, d);
      recurse(child, d);
    }
  }
  recurse(root, 0);
  return { depths, clipped, maxDepth };
}

function buildEdges(root) {
  const edges = []; // {a,b,length} — no dirigidas
  const nodesById = new Map();
  function record(node) {
    nodesById.set(node.id, node);
    for (const { node: child, length } of node.children) {
      edges.push({ a: node.id, b: child.id, length });
      record(child);
    }
  }
  record(root);
  return { edges, nodesById };
}

function buildAdjacency(edges) {
  const adj = new Map();
  const add = (u, v, length) => { if (!adj.has(u)) adj.set(u, []); adj.get(u).push({ to: v, length }); };
  edges.forEach(({ a, b, length }) => { add(a, b, length); add(b, a, length); });
  return adj;
}

/** Distancias (suma de longitudes de rama) desde `startId` a todos los
 *  demás nodos alcanzables, más el nodo "padre" de cada uno en ese
 *  recorrido — un árbol solo tiene un camino entre cada par, así que un
 *  recorrido simple (sin Dijkstra) ya da la distancia correcta. */
function pathDistancesFrom(startId, adj) {
  const dist = new Map([[startId, 0]]);
  const parent = new Map([[startId, null]]);
  const stack = [startId];
  while (stack.length) {
    const u = stack.pop();
    for (const { to, length } of adj.get(u) || []) {
      if (!dist.has(to)) { dist.set(to, dist.get(u) + length); parent.set(to, u); stack.push(to); }
    }
  }
  return { dist, parent };
}

/**
 * Reenraiza el árbol en su PUNTO MEDIO: el punto (posiblemente a mitad de
 * una rama, no necesariamente en un nodo existente) equidistante de las dos
 * hojas más separadas del árbol (su "diámetro") — el criterio estándar
 * cuando no se tiene o no se quiere elegir un outgroup a mano.
 *
 * Doble barrido (algoritmo estándar del diámetro de un árbol): desde una
 * hoja cualquiera, la hoja más lejana es un extremo del diámetro; desde esa,
 * la más lejana es el otro extremo. El punto medio de ese camino pasa a ser
 * la nueva raíz (con 2 hijos, a diferencia de la trifurcación sin raíz que
 * da Neighbor-Joining) — se reconstruye el árbol entero a partir de la
 * lista de aristas no dirigidas, sin mutar el original.
 * @param {object} root
 * @returns {{ root: object, diameter: number }}
 */
export function midpointRoot(root) {
  const { edges, nodesById } = buildEdges(root);
  const leaves = leafIdsUnder(root);
  if (leaves.length < 2) return { root, diameter: 0 };
  const adj = buildAdjacency(edges);

  const { dist: d0 } = pathDistancesFrom(leaves[0], adj);
  let P = leaves[0], bestD = -1;
  for (const id of leaves) if (d0.get(id) > bestD) { bestD = d0.get(id); P = id; }
  const { dist: d1, parent: parentFromP } = pathDistancesFrom(P, adj);
  let Q = P; bestD = -1;
  for (const id of leaves) if (d1.get(id) > bestD) { bestD = d1.get(id); Q = id; }
  const diameter = d1.get(Q);

  const path = [];
  for (let u = Q; u !== null; u = parentFromP.get(u)) path.push(u);
  path.reverse(); // path[0] = P … path[last] = Q

  const half = diameter / 2;
  let acc = 0, edgeA = null, edgeB = null, edgeLen = 0, into = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const len = adj.get(a).find((e) => e.to === b).length;
    if (acc + len >= half - 1e-9) { edgeA = a; edgeB = b; edgeLen = len; into = half - acc; break; }
    acc += len;
  }
  if (edgeA == null) { // por redondeo, el propio Q
    edgeA = path[path.length - 2]; edgeB = path[path.length - 1];
    edgeLen = adj.get(edgeA).find((e) => e.to === edgeB).length; into = edgeLen;
  }
  into = Math.max(0, Math.min(edgeLen, into));

  return { root: rebuildRootedAtSplit(edges, nodesById, edgeA, edgeB, into, edgeLen), diameter };
}

/** Reconstruye el árbol con una nueva raíz insertada a `into` unidades de
 *  `edgeA` sobre la arista (edgeA,edgeB) — mismo paso final que ya usaba
 *  `midpointRoot` (partir la arista en dos, DFS desde el nuevo nodo), ahora
 *  compartido con `rerootAtLeaf` para que ambos acepten CUALQUIER arista, no
 *  solo la del punto medio global. */
function rebuildRootedAtSplit(edges, nodesById, edgeA, edgeB, into, edgeLen) {
  const midId = Math.max(...nodesById.keys()) + 1;
  const newEdges = edges.filter((e) => !((e.a === edgeA && e.b === edgeB) || (e.a === edgeB && e.b === edgeA)));
  newEdges.push({ a: edgeA, b: midId, length: into });
  newEdges.push({ a: midId, b: edgeB, length: edgeLen - into });
  const newAdj = buildAdjacency(newEdges);

  function dfs(id, cameFrom) {
    const orig = nodesById.get(id);
    const node = { id, label: orig ? orig.label : null, children: [] };
    for (const { to, length } of newAdj.get(id) || []) {
      if (to === cameFrom) continue;
      node.children.push({ node: dfs(to, id), length });
    }
    return node;
  }
  return dfs(midId, null);
}

/**
 * Reenraiza el árbol en el PUNTO MEDIO de la rama terminal que lleva a la
 * hoja `leafId` (reenraizado por outgroup/cepa de referencia): la hoja
 * elegida queda dibujada como grupo externo/hermana del resto, convención
 * habitual. Generaliza `midpointRoot` (que solo reenraizaba en el punto
 * medio del DIÁMETRO global) para aceptar cualquier hoja como referencia.
 * @param {object} root
 * @param {number} leafId  id de una hoja de `root` (no de un nodo interno)
 * @returns {{ root: object } | null}  null si leafId no es una hoja de este árbol
 */
export function rerootAtLeaf(root, leafId) {
  const { edges, nodesById } = buildEdges(root);
  if (!leafIdsUnder(root).includes(leafId)) return null;
  const adj = buildAdjacency(edges);
  const neighbors = adj.get(leafId) || [];
  if (neighbors.length !== 1) return null; // una hoja tiene exactamente 1 arista
  const { to: parentId, length: edgeLen } = neighbors[0];
  const into = edgeLen / 2;
  return { root: rebuildRootedAtSplit(edges, nodesById, leafId, parentId, into, edgeLen) };
}

export function escapeNewickLabel(label) {
  return String(label).replace(/[\s():,;]+/g, '_');
}

function fmtLen(n) {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1e6) / 1e6;
  return String(r);
}

function newickRecurse(node) {
  if (!node.children.length) return escapeNewickLabel(node.label);
  const inner = node.children.map((ch) => newickRecurse(ch.node) + ':' + fmtLen(ch.length)).join(',');
  return '(' + inner + ')';
}

/** Exporta el árbol a formato Newick (para iTOL, MEGA, etc). */
export function toNewick(root) {
  return newickRecurse(root) + ';';
}
