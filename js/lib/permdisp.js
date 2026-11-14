// permdisp.js — PERMDISP (Anderson 2006): prueba permutacional de la
// homogeneidad de las dispersiones multivariantes.
//
// Por qué existe este archivo: PERMANOVA responde "¿los grupos están en
// sitios distintos?", pero su p también se vuelve pequeño cuando los grupos
// difieren en lo DISPERSOS que están, no en su centro. Sin PERMDISP no se
// pueden separar las dos causas, y hasta ahora la app mandaba al usuario a
// hacerlo en R (`anova(betadisper(...))`). Esto lo calcula en el navegador.
//
// El cálculo, paso a paso:
//   1. coordenadas principales de la matriz de distancias (Gower: A = -½d²
//      doblemente centrada, luego autovectores) — la nube de puntos que esa
//      matriz representa;
//   2. centroide de cada grupo en ese espacio;
//   3. z_i = distancia de cada muestra al centroide de SU grupo;
//   4. F de un factor sobre los z, y p por permutación de las etiquetas.
//
// Dos detalles que importan para que los números cuadren con vegan:
//   - Las matrices no euclídeas (Bray-Curtis, Jaccard…) producen autovalores
//     NEGATIVOS, es decir ejes imaginarios. Anderson los resta en lugar de
//     ignorarlos: z = √|Σ_real(x−c)² − Σ_imag(x−c)²|. Descartarlos sin más
//     infla las dispersiones de forma distinta en cada grupo.
//   - Se usa el CENTROIDE, no la mediana espacial. `vegan::betadisper` usa la
//     mediana por defecto, así que la comparación válida es
//     `betadisper(D, grupo, type = "centroid")`. Se eligió el centroide
//     porque es exactamente reproducible (la mediana espacial es iterativa y
//     su resultado depende del optimizador).
//
// Referencia: Anderson, M.J. (2006) Distance-based tests for homogeneity of
// multivariate dispersions. Biometrics 62:245-253.

import { jacobiEigenSymmetric } from './linalg.js';
import { fDistPValue, mulberry32s } from './stats.js';
import { pAdjust } from './pairwiseStats.js';

/** Semilla por defecto, distinta de la del PERMANOVA para que las dos pruebas
 *  no compartan la misma secuencia de permutaciones. */
export const PERMDISP_SEED = 0x7D15;

/**
 * Coordenadas principales (PCoA) de una matriz de distancias, separando los
 * ejes reales (autovalor > 0) de los imaginarios (autovalor < 0).
 * @param {number[][]} distMatrix
 * @param {number} [tolFactor=1e-8] ejes con |λ| ≤ max|λ|·tolFactor se descartan
 * @returns {{pos:number[][], neg:number[][], values:number[]}}
 *   `pos[k][i]` = coordenada de la muestra i en el eje real k.
 */
export function principalCoordinates(distMatrix, tolFactor = 1e-8) {
  const n = distMatrix.length;

  // A = -½·d², y su doble centrado de Gower. A es simétrica, así que la media
  // de la columna j coincide con la de la fila j: basta un vector de medias.
  const A = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const d = +distMatrix[i][j] || 0;
      row[j] = -0.5 * d * d;
    }
    A.push(row);
  }
  const means = new Float64Array(n);
  let grand = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += A[i][j];
    means[i] = s / n;
    grand += s;
  }
  grand /= n * n;

  const G = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(n);
    for (let j = 0; j < n; j++) row[j] = A[i][j] - means[i] - means[j] + grand;
    G.push(row);
  }

  const { values, vectors } = jacobiEigenSymmetric(G, { maxSweeps: 200 });
  let maxAbs = 0;
  values.forEach((v) => { if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v); });
  const tol = (maxAbs || 1) * tolFactor;

  const pos = [], neg = [];
  values.forEach((lam, k) => {
    if (Math.abs(lam) <= tol) return; // eje nulo (siempre hay al menos uno: el centrado)
    const scale = Math.sqrt(Math.abs(lam));
    const coord = vectors[k].map((v) => v * scale);
    (lam > 0 ? pos : neg).push(coord);
  });
  return { pos, neg, values };
}

/** F de un factor sobre `vals` según las etiquetas `lab` (0..a-1). */
function fRatio(vals, lab, a, n) {
  const sums = new Float64Array(a);
  const counts = new Float64Array(a);
  let grand = 0;
  for (let i = 0; i < n; i++) {
    sums[lab[i]] += vals[i];
    counts[lab[i]]++;
    grand += vals[i];
  }
  grand /= n;
  let ssb = 0;
  for (let g = 0; g < a; g++) {
    if (!counts[g]) continue;
    const m = sums[g] / counts[g];
    ssb += counts[g] * (m - grand) * (m - grand);
  }
  let ssw = 0;
  for (let i = 0; i < n; i++) {
    const g = lab[i];
    const m = sums[g] / counts[g];
    ssw += (vals[i] - m) * (vals[i] - m);
  }
  if (!(ssw > 0)) return ssb > 0 ? Infinity : NaN;
  return (ssb / (a - 1)) / (ssw / (n - a));
}

/** Baraja `arr` in situ (Fisher-Yates) con el PRNG `rnd`. */
function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
}

/**
 * PERMDISP de un factor sobre una matriz de distancias. Equivale a
 * `anova(vegan::betadisper(as.dist(D), grupo, type = "centroid"))` para el
 * p paramétrico y a `permutest(...)` para el p por permutación.
 *
 * @param {number[][]} distMatrix  matriz n×n simétrica, 0 en la diagonal
 * @param {(string|number)[]} groups  grupo de cada muestra, en el orden de la matriz
 * @param {object} [opt]
 * @param {number} [opt.permutations=999]
 * @param {number} [opt.seed=PERMDISP_SEED]
 * @param {boolean} [opt.pairwise=true]  comparaciones por pares entre grupos
 * @param {'none'|'bonferroni'|'holm'|'hochberg'|'BH'|'BY'} [opt.adjust='holm']
 * @returns {{
 *   n:number, groups:string[], groupSizes:number[], singletons:string[],
 *   distances:number[], groupMeans:number[], groupSDs:number[], groupSEs:number[],
 *   df1:number, df2:number, F:number, p:number, pParametric:number,
 *   permutations:number, nNegativeAxes:number, nPositiveAxes:number,
 *   type:'centroid',
 *   pairwise:{a:string, b:string, meanA:number, meanB:number, diff:number, p:number, pAdj:number}[]
 * } | { error:string }}
 */
export function permdisp(distMatrix, groups, opt = {}) {
  const perms = Math.max(0, Math.floor(opt.permutations != null ? opt.permutations : 999));
  const n = distMatrix.length;
  if (!n || groups.length !== n) return { error: 'La matriz y las etiquetas no tienen el mismo tamaño.' };

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
  if (a < 2) return { error: 'Hacen falta al menos 2 grupos.' };
  if (n - a < 1) return { error: 'Cada muestra está en su propio grupo; no hay dispersión que medir.' };

  const groupSizes = gName.map((_, g) => {
    let c = 0;
    for (let i = 0; i < n; i++) if (labelIdx[i] === g) c++;
    return c;
  });

  const { pos, neg } = principalCoordinates(distMatrix);

  // centroide de cada grupo, eje a eje
  const centroidsOf = (axes) => axes.map((coord) => {
    const sums = new Float64Array(a);
    for (let i = 0; i < n; i++) sums[labelIdx[i]] += coord[i];
    return Array.from(sums, (s, g) => (groupSizes[g] ? s / groupSizes[g] : 0));
  });
  const cPos = centroidsOf(pos);
  const cNeg = centroidsOf(neg);

  // z_i = √|Σ_real (x−c)² − Σ_imag (x−c)²|  (Anderson 2006)
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const g = labelIdx[i];
    let dp = 0, dn = 0;
    for (let k = 0; k < pos.length; k++) { const e = pos[k][i] - cPos[k][g]; dp += e * e; }
    for (let k = 0; k < neg.length; k++) { const e = neg[k][i] - cNeg[k][g]; dn += e * e; }
    z[i] = Math.sqrt(Math.abs(dp - dn));
  }

  const df1 = a - 1, df2 = n - a;
  const Fobs = fRatio(z, labelIdx, a, n);
  const pParametric = fDistPValue(Fobs, df1, df2);

  const rnd = mulberry32s(opt.seed != null ? opt.seed : PERMDISP_SEED);

  // p por permutación: se barajan las etiquetas y se recalcula la F sobre los
  // MISMOS z (igual que `permutest.betadisper`, que no recalcula centroides).
  let p = NaN;
  if (perms > 0 && isFinite(Fobs)) {
    const perm = Int32Array.from(labelIdx);
    let ge = 0;
    for (let k = 0; k < perms; k++) {
      shuffle(perm, rnd);
      const Fp = fRatio(z, perm, a, n);
      if (isFinite(Fp) && Fp >= Fobs - 1e-12) ge++;
    }
    p = (ge + 1) / (perms + 1);
  }

  // medias, desviaciones y errores típicos de los z por grupo
  const groupMeans = [], groupSDs = [], groupSEs = [];
  for (let g = 0; g < a; g++) {
    const vals = [];
    for (let i = 0; i < n; i++) if (labelIdx[i] === g) vals.push(z[i]);
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sd = vals.length > 1
      ? Math.sqrt(vals.reduce((s, v) => s + (v - m) * (v - m), 0) / (vals.length - 1))
      : NaN;
    groupMeans.push(m);
    groupSDs.push(sd);
    groupSEs.push(vals.length > 1 ? sd / Math.sqrt(vals.length) : NaN);
  }

  // comparaciones por pares: misma F permutacional, restringida a los dos grupos
  const pairwise = [];
  if (opt.pairwise !== false && perms > 0) {
    for (let g = 0; g < a; g++) {
      for (let h = g + 1; h < a; h++) {
        const sub = [], subLab = [];
        for (let i = 0; i < n; i++) {
          if (labelIdx[i] === g) { sub.push(z[i]); subLab.push(0); }
          else if (labelIdx[i] === h) { sub.push(z[i]); subLab.push(1); }
        }
        const m = sub.length;
        const lab0 = Int32Array.from(subLab);
        const F0 = fRatio(sub, lab0, 2, m);
        let pp = NaN;
        if (isFinite(F0) && m > 2) {
          const permLab = Int32Array.from(subLab);
          let ge = 0;
          for (let k = 0; k < perms; k++) {
            shuffle(permLab, rnd);
            const Fp = fRatio(sub, permLab, 2, m);
            if (isFinite(Fp) && Fp >= F0 - 1e-12) ge++;
          }
          pp = (ge + 1) / (perms + 1);
        }
        pairwise.push({
          a: gName[g], b: gName[h],
          meanA: groupMeans[g], meanB: groupMeans[h],
          diff: groupMeans[g] - groupMeans[h],
          p: pp, pAdj: NaN,
        });
      }
    }
    const adj = pAdjust(pairwise.map((r) => r.p), opt.adjust || 'holm');
    pairwise.forEach((r, i) => { r.pAdj = adj[i]; });
  }

  return {
    n, groups: gName, groupSizes,
    singletons: gName.filter((_, g) => groupSizes[g] < 2),
    distances: Array.from(z),
    groupMeans, groupSDs, groupSEs,
    df1, df2, F: Fobs, p, pParametric,
    permutations: perms,
    nPositiveAxes: pos.length, nNegativeAxes: neg.length,
    type: 'centroid',
    pairwise,
  };
}

/**
 * Lectura conjunta de PERMANOVA + PERMDISP. Es el motivo de todo esto: el
 * mismo p de PERMANOVA se interpreta de forma distinta según si las
 * dispersiones son homogéneas o no.
 *
 * @param {{p:number}} perm      resultado de permanova()
 * @param {{p:number}} disp      resultado de permdisp()
 * @param {number} [alpha=0.05]
 * @returns {{key:'locationOnly'|'dispersionOnly'|'both'|'neither'|'unknown', permSig:boolean, dispSig:boolean}}
 *   `key` es la clave i18n del veredicto (beta.pdVerdict<Key>).
 */
export function jointVerdict(perm, disp, alpha = 0.05) {
  const permSig = !!perm && isFinite(perm.p) && perm.p < alpha;
  const dispSig = !!disp && isFinite(disp.p) && disp.p < alpha;
  if (!perm || !disp || !isFinite(perm.p) || !isFinite(disp.p)) {
    return { key: 'unknown', permSig, dispSig };
  }
  if (permSig && !dispSig) return { key: 'locationOnly', permSig, dispSig };
  if (permSig && dispSig) return { key: 'both', permSig, dispSig };
  if (!permSig && dispSig) return { key: 'dispersionOnly', permSig, dispSig };
  return { key: 'neither', permSig, dispSig };
}
