// Soporte bootstrap del árbol filogenético (Felsenstein 1985).
//
// Un árbol sin valores de soporte afirma una topología sin decir cuánta de
// ella aguanta los datos, y eso es lo primero que pregunta un revisor. El
// bootstrap no paramétrico responde a eso: se remuestrean CON REEMPLAZO las
// columnas del alineamiento, se reconstruye el árbol con cada réplica, y para
// cada rama del árbol original se cuenta en qué fracción de las réplicas
// aparece. Ese porcentaje es el soporte.
//
// Dos cosas que se hacen bien aquí y que es fácil hacer mal:
//
// 1. El soporte se define sobre PARTICIONES (bipartitions/splits), no sobre
//    nodos. Un árbol de Neighbor-Joining es no enraizado, así que lo que una
//    réplica puede confirmar o no es "este conjunto de taxones queda separado
//    del resto por una rama", no "este nodo cuelga de aquel". Comparar nodos
//    por posición daría soportes falsos en cuanto la réplica enraizara
//    distinto.
// 2. El remuestreo es REPRODUCIBLE: generador con semilla explícita. Un
//    soporte que cambia cada vez que se recarga la página no se puede poner
//    en un artículo ni comprobar.
//
// Se reutiliza tal cual la tubería ya validada: buildDistanceMatrix() y
// neighborJoining() (verificado contra ape::nj()). Esto es exactamente lo que
// anticipaba el comentario de cabecera de neighborJoining.js.

import { buildDistanceMatrix } from './phyloDistance.js';
import { neighborJoining } from './neighborJoining.js';

/**
 * Generador congruencial de 32 bits (mulberry32): rápido, sin dependencias y
 * con la propiedad que aquí importa — la misma semilla da exactamente la
 * misma secuencia, así que el soporte es reproducible.
 * @param {number} seed
 * @returns {() => number} Uniforme en [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6D2B79F5) >>> 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Una réplica bootstrap del alineamiento: se eligen L columnas al azar con
 * reemplazo, siendo L el número de columnas del original. Columnas, no
 * caracteres sueltos: la columna es la unidad de observación independiente de
 * un alineamiento, y remuestrear por carácter rompería la correspondencia
 * entre secuencias.
 *
 * @param {string[]} alignedSeqs Secuencias ya alineadas, todas de igual longitud.
 * @param {() => number} rnd
 * @returns {string[]}
 */
export function resampleColumns(alignedSeqs, rnd) {
  const n = alignedSeqs.length;
  if (!n) return [];
  const L = alignedSeqs[0].length;
  const pick = new Array(L);
  for (let k = 0; k < L; k++) pick[k] = Math.floor(rnd() * L) % Math.max(1, L);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const src = alignedSeqs[i];
    let s = '';
    for (let k = 0; k < L; k++) s += src[pick[k]];
    out[i] = s;
  }
  return out;
}

/** Hojas (índices de taxón) que cuelgan de un nodo. */
function leafIndices(node, out = []) {
  if (!node.children || !node.children.length) {
    if (node.label != null) out.push(node.id);
    return out;
  }
  node.children.forEach((c) => leafIndices(c.node, out));
  return out;
}

/**
 * Clave canónica de una partición. Como el árbol es no enraizado, un conjunto
 * y su complementario describen LA MISMA rama: se canonicaliza quedándose con
 * el lado que no contiene el taxón 0. Sin esto, la misma rama contaría como
 * dos particiones distintas según cómo quedara enraizada cada réplica.
 *
 * @param {number[]} indices
 * @param {number} total Número total de taxones.
 * @returns {string} Vacío si la partición es trivial (un solo taxón, o todos).
 */
export function splitKey(indices, total) {
  const set = new Set(indices);
  let side = [...set];
  if (set.has(0)) {
    side = [];
    for (let i = 0; i < total; i++) if (!set.has(i)) side.push(i);
  }
  // triviales: no informan de nada, toda topología las contiene
  if (side.length < 2 || side.length > total - 2) return '';
  side.sort((a, b) => a - b);
  return side.join(',');
}

/**
 * Todas las particiones informativas de un árbol.
 * @param {Object} root
 * @param {number} total
 * @returns {Set<string>}
 */
export function treeSplits(root, total) {
  const splits = new Set();
  const walk = (node) => {
    if (!node.children || !node.children.length) return;
    node.children.forEach((c) => {
      const key = splitKey(leafIndices(c.node), total);
      if (key) splits.add(key);
      walk(c.node);
    });
  };
  walk(root);
  return splits;
}

/**
 * Soporte bootstrap de cada partición.
 *
 * @param {string[]} alignedSeqs
 * @param {Object} [opts]
 * @param {number} [opts.replicates=100] Réplicas. 100 es el mínimo habitual;
 *   1000 es lo que se suele publicar.
 * @param {'p'|'jc'} [opts.correction='p'] La misma corrección que el árbol original.
 * @param {number} [opts.seed=1] Semilla, para que el resultado sea repetible.
 * @param {(done:number,total:number)=>void} [opts.onProgress]
 * @returns {{counts:Map<string,number>, replicates:number, failed:number}}
 */
export function bootstrapSplits(alignedSeqs, opts = {}) {
  const replicates = Math.max(1, Math.round(Number(opts.replicates) || 100));
  const correction = opts.correction === 'jc' ? 'jc' : 'p';
  const rnd = mulberry32(Number.isFinite(opts.seed) ? opts.seed : 1);
  const total = alignedSeqs.length;
  const counts = new Map();
  let failed = 0;

  for (let r = 0; r < replicates; r++) {
    const rep = resampleColumns(alignedSeqs, rnd);
    try {
      const { matrix } = buildDistanceMatrix(rep, { correction });
      const labels = rep.map((_, i) => String(i));
      const tree = neighborJoining(matrix, labels);
      treeSplits(tree, total).forEach((k) => counts.set(k, (counts.get(k) || 0) + 1));
    } catch (e) {
      // Una réplica degenerada (p. ej. todas las columnas elegidas iguales,
      // distancias todas 0) no invalida el análisis: se cuenta como fallida y
      // se informa, en vez de abortar o de inflar el soporte silenciosamente.
      failed++;
    }
    if (opts.onProgress) opts.onProgress(r + 1, replicates);
  }
  return { counts, replicates, failed };
}

/**
 * Escribe el soporte en los nodos internos del árbol de referencia.
 *
 * El soporte se anota en el NODO que define la partición (el extremo de la
 * rama que la separa), que es la convención de Newick y la que leen FigTree,
 * iTOL o ape.
 *
 * @param {Object} root Árbol de referencia (se modifica en el sitio).
 * @param {{counts:Map<string,number>, replicates:number}} boot
 * @param {number} total Número de taxones.
 * @returns {{annotated:number, median:number}}
 */
export function annotateSupport(root, boot, total) {
  const vals = [];
  const walk = (node) => {
    if (!node.children || !node.children.length) return;
    node.children.forEach((c) => {
      const key = splitKey(leafIndices(c.node), total);
      if (key) {
        const pct = ((boot.counts.get(key) || 0) / boot.replicates) * 100;
        c.node.support = pct;
        vals.push(pct);
      } else {
        c.node.support = null;
      }
      walk(c.node);
    });
  };
  walk(root);
  vals.sort((a, b) => a - b);
  const m = vals.length
    ? (vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2)
    : NaN;
  return { annotated: vals.length, median: m };
}

/**
 * Newick con el soporte como etiqueta de nodo interno, que es cómo lo esperan
 * las herramientas de visualización de árboles.
 *
 * @param {Object} root Árbol ya anotado por annotateSupport().
 * @param {(label:string)=>string} escapeLabel
 * @returns {string}
 */
export function toNewickWithSupport(root, escapeLabel) {
  const esc = typeof escapeLabel === 'function' ? escapeLabel : (x) => x;
  const rec = (node) => {
    if (!node.children || !node.children.length) return esc(String(node.label));
    const inner = node.children
      .map((c) => rec(c.node) + ':' + (Number.isFinite(c.length) ? c.length.toFixed(6) : '0'))
      .join(',');
    const sup = Number.isFinite(node.support) ? String(Math.round(node.support)) : '';
    return '(' + inner + ')' + sup;
  };
  return rec(root) + ';';
}

// Umbrales de lectura habituales en la literatura: por debajo de 70 la rama no
// se considera sostenida, y por encima de 95 se considera fuerte. Se exponen
// aquí para que la interfaz y el informe usen los mismos y no se inventen otros.
export const SUPPORT_WEAK = 70;
export const SUPPORT_STRONG = 95;

/**
 * @param {number} pct
 * @returns {'strong'|'moderate'|'weak'|'none'}
 */
export function supportClass(pct) {
  if (!Number.isFinite(pct)) return 'none';
  if (pct >= SUPPORT_STRONG) return 'strong';
  if (pct >= SUPPORT_WEAK) return 'moderate';
  return 'weak';
}

/**
 * El bootstrap en un Web Worker, con el cálculo síncrono como reserva si el
 * navegador no tiene workers o falla instanciarlo (mismo patrón que
 * alignWithWorker en aligner.js).
 *
 * @param {string[]} alignedSeqs
 * @param {Object} [opts] { replicates, correction, seed, onProgress }
 * @returns {Promise<{counts:Map<string,number>, replicates:number, failed:number}>}
 */
export function bootstrapWithWorker(alignedSeqs, opts = {}) {
  const { replicates, correction, seed, onProgress } = opts;
  const runHere = () => bootstrapSplits(alignedSeqs, { replicates, correction, seed, onProgress });

  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      try { resolve(runHere()); } catch (err) { reject(err); }
      return;
    }
    let worker;
    try {
      worker = new Worker(new URL('../workers/bootstrapWorker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      try { resolve(runHere()); } catch (err) { reject(err); }
      return;
    }
    const id = 'boot-' + Math.random().toString(36).slice(2);
    worker.onmessage = (ev) => {
      const d = (ev && ev.data) || {};
      if (d.id !== id) return;
      if (d.type === 'progress') { if (onProgress) onProgress(d.done, d.total); return; }
      worker.terminate();
      if (d.ok && d.result) {
        resolve({
          counts: new Map(d.result.counts),
          replicates: d.result.replicates,
          failed: d.result.failed,
        });
      } else {
        reject(new Error(d.error || 'el bootstrap falló en el worker'));
      }
    };
    worker.onerror = () => {
      worker.terminate();
      // Un fallo del worker no debe perder el análisis: se recalcula aquí.
      try { resolve(runHere()); } catch (err) { reject(err); }
    };
    worker.postMessage({ id, payload: { alignedSeqs, replicates, correction, seed } });
  });
}
