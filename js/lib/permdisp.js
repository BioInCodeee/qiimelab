// PERMDISP — homogeneidad de las dispersiones multivariantes (Anderson 2006).
//
// Es el complemento obligado del PERMANOVA: adonis2 pregunta "¿están los
// CENTROS de los grupos en sitios distintos?" y PERMDISP "¿se dispersan los
// grupos por igual alrededor de su propio centro?". Sin el segundo, un
// PERMANOVA significativo es ambiguo, porque la heterogeneidad de varianzas
// multivariantes también lo dispara (Anderson & Walsh 2013).
//
// Equivale a `anova(vegan::betadisper(D, grupo, type = "centroid"))` más
// `permutest()` para el p por permutaciones. OJO: el `type` por defecto de
// vegan es "median" (mediana espacial, que resuelve por optimización
// iterativa); aquí se implementa SOLO el centroide aritmético, que es la
// formulación original de Anderson 2006 y la que se puede reproducir en R con
// `type = "centroid"`. La UI lo dice explícitamente.
//
// Procedimiento:
//   1. PCoA de la matriz de distancias (doble centrado de Gower + Jacobi).
//   2. Centroide de cada grupo en ese espacio.
//   3. Distancia de cada muestra al centroide de SU grupo, corrigiendo los
//      ejes imaginarios (autovalores negativos, que aparecen con Bray-Curtis
//      y UniFrac): z = √|d²_real − d²_imag|.
//   4. ANOVA de un factor sobre esas distancias → F.
//   5. p por permutación de las distancias entre grupos (permutest.betadisper).
//
// La estadística se valida contra valores de referencia en
// `js/lib/statsValidation.js` (clave `permdisp`), igual que el resto.

import { jacobiEigenSymmetric } from './linalg.js';
import { fDistPValue } from './stats.js';
import { pAdjust } from './pairwiseStats.js';

// PRNG local determinista: las permutaciones deben repetirse con la misma
// semilla (mismo criterio que el PERMANOVA de stats.js).
function mulberry32p(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Coordenadas principales (PCoA) de una matriz de distancias, separando los
 * ejes reales (autovalor > 0) de los imaginarios (autovalor < 0).
 *
 * @param {number[][]} distMatrix matriz n×n simétrica, 0 en la diagonal
 * @returns {{ pos:number[][], neg:number[][], eigPos:number[], eigNeg:number[] }}
 *   `pos[i]` / `neg[i]` = coordenadas de la muestra i en los ejes reales /
 *   imaginarios (arrays vacíos si no hay ejes de ese tipo).
 */
export function pcoaAxes(distMatrix) {
  const n = distMatrix.length;

  // d² y doble centrado de Gower: G = −½ · (I − 11'/n) D² (I − 11'/n)
  const d2 = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(n);
    for (let j = 0; j < n; j++) { const v = +distMatrix[i][j] || 0; row[j] = v * v; }
    d2.push(row);
  }
  const rowMean = new Float64Array(n);
  let grand = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += d2[i][j];
    rowMean[i] = s / n;
    grand += s;
  }
  grand /= n * n;
  // la matriz es simétrica, así que la media de la columna j es rowMean[j]
  const G = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(n);
    for (let j = 0; j < n; j++) row[j] = -0.5 * (d2[i][j] - rowMean[i] - rowMean[j] + grand);
    G.push(row);
  }

  const { values, vectors } = jacobiEigenSymmetric(G);

  // umbral RELATIVO: el doble centrado deja al menos un autovalor nulo (y
  // más si hay muestras duplicadas); por debajo de esto el eje es ruido
  // numérico, no una dimensión real de la ordenación.
  let maxAbs = 0;
  for (let k = 0; k < values.length; k++) maxAbs = Math.max(maxAbs, Math.abs(values[k]));
  const tol = maxAbs * 1e-9;

  const idxPos = [], idxNeg = [];
  for (let k = 0; k < values.length; k++) {
    if (values[k] > tol) idxPos.push(k);
    else if (values[k] < -tol) idxNeg.push(k);
  }

  const build = (idx) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const row = new Float64Array(idx.length);
      for (let c = 0; c < idx.length; c++) {
        const k = idx[c];
        row[c] = vectors[k][i] * Math.sqrt(Math.abs(values[k]));
      }
      out.push(row);
    }
    return out;
  };

  return {
    pos: build(idxPos), neg: build(idxNeg),
    eigPos: idxPos.map((k) => values[k]),
    eigNeg: idxNeg.map((k) => values[k]),
  };
}

/** ANOVA de un factor sobre el vector plano `z`, con `labelIdx[i]` ∈ [0, a). */
function anovaOnDistances(z, labelIdx, a) {
  const n = z.length;
  const sums = new Float64Array(a);
  const counts = new Float64Array(a);
  let grand = 0;
  for (let i = 0; i < n; i++) {
    sums[labelIdx[i]] += z[i];
    counts[labelIdx[i]]++;
    grand += z[i];
  }
  const gm = grand / n;
  let ssB = 0;
  for (let g = 0; g < a; g++) {
    if (counts[g] > 0) { const m = sums[g] / counts[g]; ssB += counts[g] * (m - gm) * (m - gm); }
  }
  let ssW = 0;
  for (let i = 0; i < n; i++) {
    const m = sums[labelIdx[i]] / counts[labelIdx[i]];
    ssW += (z[i] - m) * (z[i] - m);
  }
  const df1 = a - 1, df2 = n - a;
  return { ssB, ssW, df1, df2, F: (ssB / df1) / (ssW / df2) };
}

/** p por permutación de las etiquetas sobre un vector de distancias ya calculado
 *  (es lo que hace `permutest.betadisper`: NO recalcula los centroides). */
function permuteF(z, labelIdx, a, perms, rnd, Fobs) {
  if (!(perms > 0) || !isFinite(Fobs)) return NaN;
  const n = z.length;
  const perm = Int32Array.from(labelIdx);
  let ge = 0;
  for (let k = 0; k < perms; k++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
    }
    const Fp = anovaOnDistances(z, perm, a).F;
    if (isFinite(Fp) && Fp >= Fobs - 1e-12) ge++;
  }
  return (ge + 1) / (perms + 1);
}

/**
 * PERMDISP de un factor sobre una matriz de distancias.
 *
 * @param {number[][]} distMatrix matriz n×n (simétrica, 0 en la diagonal)
 * @param {(string|number)[]} groups etiqueta de grupo de cada muestra, en el
 *   mismo orden que las filas/columnas de la matriz
 * @param {object} [opt]
 * @param {number} [opt.permutations=999]
 * @param {number} [opt.seed=0x5152] semilla del PRNG (determinista)
 * @param {boolean} [opt.pairwise=true] comparaciones por pares con BH
 * @returns {{
 *   n:number, groups:string[], groupSizes:number[],
 *   distances:number[], groupOf:number[],
 *   groupMeans:number[], groupSds:number[],
 *   df1:number, df2:number, ssB:number, ssW:number, msB:number, msW:number,
 *   F:number, p:number, pParam:number, permutations:number,
 *   nNegAxes:number, negShare:number,
 *   pairwise:{a:string, b:string, F:number, p:number, pAdj:number}[]
 * } | { code:string, error:string }}
 */
export function permdisp(distMatrix, groups, opt = {}) {
  const perms = Math.max(0, Math.floor(opt.permutations != null ? opt.permutations : 999));
  const n = distMatrix.length;
  if (!n || groups.length !== n) return { code: 'size', error: 'La matriz y las etiquetas no tienen el mismo tamaño.' };

  const gName = [];
  const gIndex = new Map();
  const labelIdx = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const key = String(groups[i]);
    let idx = gIndex.get(key);
    if (idx === undefined) { idx = gName.length; gIndex.set(key, idx); gName.push(key); }
    labelIdx[i] = idx;
  }
  const a = gName.length;
  if (a < 2) return { code: 'groups', error: 'Hacen falta al menos 2 grupos.' };
  if (a >= n) return { code: 'replicates', error: 'Cada muestra está en su propio grupo; no hay réplicas.' };

  const groupSizes = gName.map((_, g) => {
    let c = 0; for (let i = 0; i < n; i++) if (labelIdx[i] === g) c++; return c;
  });
  // con un solo miembro la distancia al centroide es 0 por construcción y
  // hunde la dispersión del grupo: mejor avisar que devolver un F engañoso.
  if (groupSizes.some((c) => c < 2)) return { code: 'singleton', error: 'Algún grupo tiene una sola muestra; no se puede estimar su dispersión.' };

  const { pos, neg, eigPos, eigNeg } = pcoaAxes(distMatrix);
  const kPos = eigPos.length, kNeg = eigNeg.length;
  if (!kPos) return { code: 'noreal', error: 'La matriz de distancias no tiene ningún eje real; no se puede calcular la dispersión.' };

  // centroides por grupo, en ejes reales e imaginarios
  const cPos = Array.from({ length: a }, () => new Float64Array(kPos));
  const cNeg = Array.from({ length: a }, () => new Float64Array(kNeg));
  for (let i = 0; i < n; i++) {
    const g = labelIdx[i];
    for (let c = 0; c < kPos; c++) cPos[g][c] += pos[i][c];
    for (let c = 0; c < kNeg; c++) cNeg[g][c] += neg[i][c];
  }
  for (let g = 0; g < a; g++) {
    for (let c = 0; c < kPos; c++) cPos[g][c] /= groupSizes[g];
    for (let c = 0; c < kNeg; c++) cNeg[g][c] /= groupSizes[g];
  }

  // z_i = √| d²(ejes reales) − d²(ejes imaginarios) |
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const g = labelIdx[i];
    let sPos = 0, sNeg = 0;
    for (let c = 0; c < kPos; c++) { const d = pos[i][c] - cPos[g][c]; sPos += d * d; }
    for (let c = 0; c < kNeg; c++) { const d = neg[i][c] - cNeg[g][c]; sNeg += d * d; }
    z[i] = Math.sqrt(Math.abs(sPos - sNeg));
  }

  const { ssB, ssW, df1, df2, F } = anovaOnDistances(z, labelIdx, a);
  const rnd = mulberry32p(opt.seed != null ? opt.seed : 0x5152);
  const p = permuteF(z, labelIdx, a, perms, rnd, F);

  // medias y desviaciones de la distancia al centroide, por grupo
  const groupMeans = new Array(a).fill(0);
  const groupSds = new Array(a).fill(0);
  for (let g = 0; g < a; g++) {
    const vals = [];
    for (let i = 0; i < n; i++) if (labelIdx[i] === g) vals.push(z[i]);
    const m = vals.reduce((x, y) => x + y, 0) / vals.length;
    groupMeans[g] = m;
    groupSds[g] = vals.length > 1
      ? Math.sqrt(vals.reduce((s, v) => s + (v - m) * (v - m), 0) / (vals.length - 1))
      : 0;
  }

  // comparaciones por pares: mismo F sobre el subconjunto de dos grupos, con
  // su propia permutación, y BH al final (la misma corrección que usa el
  // resto de la app para familias de contrastes)
  const pairwise = [];
  if (opt.pairwise !== false && a > 2) {
    for (let g1 = 0; g1 < a; g1++) {
      for (let g2 = g1 + 1; g2 < a; g2++) {
        const sub = [], subLab = [];
        for (let i = 0; i < n; i++) {
          if (labelIdx[i] === g1) { sub.push(z[i]); subLab.push(0); }
          else if (labelIdx[i] === g2) { sub.push(z[i]); subLab.push(1); }
        }
        const subZ = Float64Array.from(sub);
        const subIdx = Int32Array.from(subLab);
        const r2 = anovaOnDistances(subZ, subIdx, 2);
        const p2 = permuteF(subZ, subIdx, 2, perms, mulberry32p((opt.seed != null ? opt.seed : 0x5152) + g1 * 31 + g2), r2.F);
        pairwise.push({ a: gName[g1], b: gName[g2], F: r2.F, p: p2, pAdj: NaN });
      }
    }
    const adj = pAdjust(pairwise.map((x) => x.p), 'BH');
    pairwise.forEach((x, i) => { x.pAdj = adj[i]; });
  }

  // cuánta "varianza" vive en los ejes imaginarios: si es mucha, la métrica
  // no es euclídea y la corrección de arriba pesa, así que conviene decirlo.
  let sumPos = 0, sumNeg = 0;
  for (let k = 0; k < kPos; k++) sumPos += eigPos[k];
  for (let k = 0; k < kNeg; k++) sumNeg += Math.abs(eigNeg[k]);

  return {
    n, groups: gName, groupSizes,
    distances: Array.from(z), groupOf: Array.from(labelIdx),
    groupMeans, groupSds,
    df1, df2, ssB, ssW, msB: ssB / df1, msW: ssW / df2,
    F, p, pParam: fDistPValue(F, df1, df2), permutations: perms,
    nNegAxes: kNeg, negShare: (sumPos + sumNeg) > 0 ? sumNeg / (sumPos + sumNeg) : 0,
    pairwise,
  };
}
