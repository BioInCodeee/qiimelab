// ANCOM-BC (Analysis of Compositions of Microbiomes with Bias Correction)
// Lin H, Peddada SD. "Analysis of compositions of microbiomes with bias
// correction." Nature Communications 11, 3514 (2020).
// https://doi.org/10.1038/s41467-020-17041-7
//
// Idea central: un recuento observado O_ij (taxón i, muestra j) no es la
// abundancia absoluta real — está escalado por una "fracción de muestreo"
// a_j propia de cada muestra (profundidad de secuenciación, eficiencia de
// extracción…), desconocida y distinta en cada muestra. En escala log:
//   log(O_ij) = log(abundancia_absoluta_ij) + d_j ,  d_j = log(a_j)
// Comparar proporciones directamente (lo que hacen los métodos NO
// composicionales) confunde ese sesgo d_j con el efecto biológico real —
// sobre todo cuando un taxón muy dominante cambia de abundancia entre
// grupos y arrastra consigo la proporción de todos los demás. ANCOM-BC
// estima d_j y lo resta ANTES de comparar grupos.
//
// SIMPLIFICACIONES respecto al paper / al paquete ANCOMBC de R-Bioconductor
// (ver tests/stats/ancombc.mjs para el nivel de validación alcanzado):
//  1. Pseudo-conteo fijo (`pseudoCount`, por defecto 1) en TODAS las celdas
//     antes del log, no solo en los ceros. El paper (y el paquete R) usan un
//     procedimiento de "ceros estructurales" más elaborado (test de
//     sensibilidad por grupo, distinto pseudo-conteo según el patrón de
//     ceros). Un pseudo-conteo uniforme es más simple de razonar y evita
//     log(0) sin tener que decidir qué ceros son "estructurales", a costa de
//     sesgar ligeramente hacia 0 el fold-change de taxones muy dispersos.
//  2. El sesgo de muestra d_j se estima con un M-estimador robusto: mediana,
//     taxón a taxón, del residuo de esa muestra frente a una referencia
//     GLOBAL por taxón (la media de ese taxón en TODAS las muestras, de
//     cualquier grupo, iterada hasta converger) — no el EM ponderado por la
//     varianza específica de cada taxón que usa el paquete de R. Ambos
//     apuntan a la misma cantidad: el desplazamiento típico de una muestra
//     frente al nivel habitual del experimento, robusto a que unos pocos
//     taxones sí cambien de verdad entre grupos (por eso mediana, no media).
//     La referencia tiene que ser global y no por grupo — si se calculara
//     por grupo, la corrección sería un no-op (ver comentario junto al
//     bucle más abajo).
//  3. El contraste es siempre "grupo con la media corregida más alta" frente
//     al resto agrupado (one-vs-rest), igual que el resto del panel de
//     biomarcadores de Smart-175 (δ de Cliff, LDA bootstrapeado) — no un
//     modelo con todos los grupos como covariables simultáneas de una tabla
//     ANOVA, que es lo que hace ANCOMBC con >2 grupos.
//  4. El p-valor usa una t de Student (grados de libertad = n1+n2−2) sobre el
//     estadístico W = log2FC / EE, en vez de la normal asintótica (con
//     corrección de Satterthwaite opcional) del paquete R — más conservador
//     con pocas réplicas, que es el caso habitual en estos datasets.
//
// Validación: tests/stats/ancombc.mjs compara esta implementación contra un
// caso de referencia con valores calculados a mano / con una reimplementación
// independiente del mismo algoritmo (ver comentarios en ese test). NO se ha
// podido contrastar en esta sesión contra la salida real del paquete ANCOMBC
// de R/Bioconductor: su instalación requiere compilar 'clarabel' (dependencia
// de CVXR), que a su vez necesita un compilador de Rust (rustc/cargo) no
// disponible en este entorno — ver el intento fallido documentado en el
// commit. Tratar los resultados de este método como una aproximación
// razonada, no como un sustituto certificado del paquete R.

const DEFAULT_OPTS = { pseudoCount: 1, maxIter: 30, tol: 1e-10 };

function mean(arr) {
  if (arr.length === 0) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function sampleStdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) * (v - m), 0) / (arr.length - 1));
}
function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
// I_x(1, b) = 1 − (1−x)^b — caso cerrado de la beta incompleta regularizada
// con a=1, usado por studentTwoTailedP cuando df=2 (a = df/2 = 1). Para el
// resto de df's delegamos en la implementación general de stats.js.
function studentTwoTailedPDf2(t) {
  const x = 2 / (2 + t * t);
  return 1 - Math.sqrt(1 - x);
}

/**
 * ANCOM-BC simplificado: sesgo de muestra global (una sola vez, con todos
 * los taxones) + contraste one-vs-rest por taxón sobre la escala corregida.
 *
 * @param {number[][]} matrix        conteos crudos, taxón × muestra: matrix[i][j]
 * @param {string[]} sampleGroups    grupo de cada muestra (mismo orden que las columnas de `matrix`)
 * @param {{pseudoCount?:number, maxIter?:number, tol?:number}} [opts]
 * @param {(t:number, df:number) => number} [studentP]  p-valor t de dos colas
 *   (por defecto: caso cerrado para df=2; para más de 2 muestras por lado hay
 *   que pasar `studentTwoTailedP` de stats.js — ver integración en taxaBarplot.js)
 * @returns {Array<{taxonIndex:number, groupIdx:number, group:string, log2FC:number, se:number, W:number, p:number}>}
 *   uno por taxón, mismo orden que las filas de `matrix`. Campos a NaN si no
 *   se pudo estimar (menos de 2 muestras en el grupo enriquecido o en el resto).
 */
export function ancomBC(matrix, sampleGroups, opts = {}, studentP) {
  const { pseudoCount, maxIter, tol } = { ...DEFAULT_OPTS, ...opts };
  const pFn = studentP || ((t, df) => (df === 2 ? studentTwoTailedPDf2(t) : NaN));
  const nTaxa = matrix.length;
  const nSamples = sampleGroups.length;
  const groups = [...new Set(sampleGroups)].sort();
  const groupOf = sampleGroups.map((g) => groups.indexOf(g));

  // log(conteo + pseudo-conteo) — ver nota de cabecera sobre el manejo de ceros
  const y = matrix.map((row) => row.map((v) => Math.log((Number(v) || 0) + pseudoCount)));

  // ---- 1. sesgo de muestra d_j: iterativo, robusto (mediana de residuos), UNA sola vez para todos los taxones ----
  // Importante: la referencia por taxón (`ref[i]`) se calcula sobre TODAS
  // las muestras a la vez, sin distinguir grupo. Si se calculara por grupo
  // (la media del propio grupo de cada muestra), la corrección sería un
  // no-op: mean_{j∈grupo}(y_ij − d_j) es por construcción exactamente
  // igual a la media de grupo ya usada más abajo para el contraste, así que
  // cualquier sesgo — real o un taxón dominante que "ahoga" en proporción a
  // los demás — quedaría absorbido en esa media de grupo sin corregirse
  // (se comprobó con un caso de saturación composicional antes de fijar
  // esta versión — ver tests/stats/ancombc.mjs). Con la referencia GLOBAL,
  // una muestra cuya mayoría de taxones cae por debajo de su nivel típico
  // en todo el experimento (p. ej. porque un taxón dominante le comió sitio
  // en esa muestra) recibe una d_j que lo compensa, sin dejarse arrastrar
  // por el taxón minoritario que sí cambió de verdad (por eso la mediana,
  // no la media, de los residuos: robusta a que unos pocos taxones no sigan
  // el patrón típico de la muestra).
  let d = new Array(nSamples).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const ref = y.map((row) => mean(row.map((v, j) => v - d[j]))); // referencia global por taxón
    const newD = new Array(nSamples).fill(0);
    for (let j = 0; j < nSamples; j++) {
      const residuals = [];
      for (let i = 0; i < nTaxa; i++) residuals.push(y[i][j] - ref[i]);
      newD[j] = median(residuals);
    }
    // recentra (media de d_j = 0) para que d sea identificable — el
    // contraste entre grupos es invariante a un desplazamiento uniforme, así
    // que esto no cambia ningún resultado, solo hace interpretable d_j en sí
    const shift = mean(newD);
    for (let j = 0; j < nSamples; j++) newD[j] -= shift;
    let maxDelta = 0;
    for (let j = 0; j < nSamples; j++) maxDelta = Math.max(maxDelta, Math.abs(newD[j] - d[j]));
    d = newD;
    if (maxDelta < tol) break;
  }

  // ---- 2. por taxón: contraste one-vs-rest sobre la escala corregida de sesgo ----
  const LN2 = Math.log(2);
  return matrix.map((row, i) => {
    const z = row.map((_, j) => y[i][j] - d[j]); // log-abundancia corregida de sesgo de muestra
    const groupMeans = groups.map((_, gi) => {
      const vals = [];
      for (let j = 0; j < nSamples; j++) if (groupOf[j] === gi) vals.push(z[j]);
      return mean(vals);
    });
    let bi = 0;
    for (let gi = 1; gi < groupMeans.length; gi++) if (groupMeans[gi] > groupMeans[bi]) bi = gi;
    const inVals = [], restVals = [];
    for (let j = 0; j < nSamples; j++) (groupOf[j] === bi ? inVals : restVals).push(z[j]);
    const n1 = inVals.length, n2 = restVals.length;
    if (n1 < 2 || n2 < 2) {
      return { taxonIndex: i, groupIdx: bi, group: groups[bi], log2FC: NaN, se: NaN, W: NaN, p: NaN };
    }
    const betaNat = mean(inVals) - mean(restVals); // log fold-change natural, corregido de sesgo
    const seNat = Math.sqrt((sampleStdDev(inVals) ** 2) / n1 + (sampleStdDev(restVals) ** 2) / n2);
    const log2FC = betaNat / LN2;
    const se = seNat / LN2;
    const df = n1 + n2 - 2;
    const W = seNat > 0 ? betaNat / seNat : (betaNat === 0 ? 0 : Infinity);
    const p = seNat > 0 ? pFn(W, df) : (betaNat === 0 ? 1 : 0);
    return { taxonIndex: i, groupIdx: bi, group: groups[bi], log2FC, se, W, p };
  });
}
