// Motor de auto-selección de test estadístico (prompt "quick wins" del
// 22 sep 2026, punto 2): diagnostica normalidad (Shapiro-Wilk por grupo) y
// homogeneidad de varianzas (Levene centrado en la mediana = Brown-Forsythe),
// y a partir de ahí recomienda un test por un árbol de decisión fijo -- el
// usuario siempre puede forzar otro test a mano, esto solo decide qué
// opción viene PRESELECCIONADA.
//
// Nuevo módulo (no ampliar stats.js): stats.js ya tiene oneWayAnova/
// kruskalWallis/fisherLSD (para el panel de biomarcadores, que NO se toca
// aquí) y pairwiseStats.js ya tiene mannWhitneyU/studentT/welchT/pairedT/
// wilcoxonSignedRank/dunnTest -- este módulo los REUTILIZA como motor de
// cálculo y solo añade lo que faltaba: Shapiro-Wilk, Levene/Brown-Forsythe,
// ANOVA de Welch, Tukey HSD y Games-Howell (los 2 últimos vía la
// distribución del rango studentizado, integración numérica).

import { mean, studentTwoTailedP, fDistPValue } from './stats.js';
import { mannWhitneyU, studentT, welchT, pairedT, wilcoxonSignedRank, dunnTest } from './pairwiseStats.js';

// ---------------------------------------------------------------- qnorm --
/** Inversa de la CDF normal estándar -- aproximación racional de Acklam
 *  (error relativo máx. ~1.15e-9), la misma familia de algoritmo que usan
 *  la mayoría de librerías estadísticas ligeras (sin depender de una serie
 *  o integración numérica cara, y con precisión de sobra para Shapiro-
 *  Wilk, que solo la usa para los "scores" normales esperados). */
export function qnorm(p) {
  if (!(p > 0) || !(p < 1)) return p === 0.5 ? 0 : NaN;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// ------------------------------------------------------------ Shapiro-Wilk --
function polyval(coeffs, x) {
  // coeffs[0] + coeffs[1]*x + coeffs[2]*x^2 + ...
  let r = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) r = r * x + coeffs[i];
  return r;
}

/**
 * Test de Shapiro-Wilk (Royston 1995, AS R94 -- el mismo que `shapiro.test`
 * en R). Válido para 3 <= n <= 5000; fuera de ese rango no se calcula.
 * @param {number[]} x
 * @returns {{W:number, p:number, n:number} | {W:NaN, p:NaN, n:number, note:string}}
 */
export function shapiroWilk(x) {
  const n = x.length;
  if (n < 3) return { W: NaN, p: NaN, n, note: 'n<3: normalidad sin verificar' };
  if (n > 5000) return { W: NaN, p: NaN, n, note: 'n>5000: fuera del rango válido de Shapiro-Wilk' };
  const sorted = x.slice().sort((a, b) => a - b);
  if (sorted[0] === sorted[n - 1]) return { W: NaN, p: NaN, n, note: 'todos los valores idénticos' };

  const mtab = new Array(n);
  for (let i = 0; i < n; i++) mtab[i] = qnorm((i + 1 - 0.375) / (n + 0.25));
  const ssumm2 = mtab.reduce((s, v) => s + v * v, 0);
  const rsn = 1 / Math.sqrt(n);
  const c1 = [0, 0.221157, -0.147981, -2.071190, 4.434685, -2.706056];
  const c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];

  const a = new Array(n).fill(0);
  let i1;
  if (n === 3) {
    a[n - 1] = Math.SQRT1_2; // 1/sqrt(2)
    i1 = 2;
  } else {
    const an = mtab[n - 1] / Math.sqrt(ssumm2) + polyval(c1, rsn);
    a[n - 1] = an;
    if (n > 5) {
      const an1 = mtab[n - 2] / Math.sqrt(ssumm2) + polyval(c2, rsn);
      a[n - 2] = an1;
      i1 = 3;
      const fac = Math.sqrt((ssumm2 - 2 * mtab[n - 1] ** 2 - 2 * mtab[n - 2] ** 2) / (1 - 2 * an * an - 2 * an1 * an1));
      for (let i = i1 - 1; i < n - i1 + 1; i++) a[i] = mtab[i] / fac;
    } else {
      i1 = 2;
      const fac = Math.sqrt((ssumm2 - 2 * mtab[n - 1] ** 2) / (1 - 2 * an * an));
      for (let i = i1 - 1; i < n - i1 + 1; i++) a[i] = mtab[i] / fac;
    }
  }
  // antisimetría: a_i = -a_{n+1-i}
  for (let i = 0; i < i1 - 1; i++) a[i] = -a[n - 1 - i];

  const xmean = mean(sorted);
  let ssq = 0, sa = 0;
  for (let i = 0; i < n; i++) { ssq += (sorted[i] - xmean) ** 2; sa += a[i] * sorted[i]; }
  const W = Math.min(1, (sa * sa) / ssq);

  // p-valor: n=3 tiene una distribución EXACTA conocida (Shapiro & Wilk
  // 1965) -- la aproximación general de Royston (gamma/mu/sigma) da un
  // resultado sistemáticamente distinto de shapiro.test() en R para n=3
  // (verificado con 200 muestras aleatorias vs R real antes de fijar esta
  // fórmula, no es una suposición). Para n>=4 sí se usa la aproximación
  // general (verificado idéntico a R hasta el redondeo para n=4..100).
  const p = n === 3
    ? 1 - (6 / Math.PI) * Math.asin(Math.sqrt(Math.max(0, 1 - W)))
    : shapiroPValueGeneral(n, W);
  return { W, p, n };
}

function shapiroPValueGeneral(n, W) {
  const logn = Math.log(n);
  let mu, sigma, gamma, w1;
  if (n <= 11) {
    gamma = -2.273 + 0.459 * n;
    w1 = -Math.log(gamma - Math.log(1 - W));
    mu = 0.5440 - 0.39978 * n + 0.025054 * n * n - 0.0006714 * n * n * n;
    sigma = Math.exp(1.3822 - 0.77857 * n + 0.062767 * n * n - 0.0020322 * n * n * n);
  } else {
    w1 = Math.log(1 - W);
    mu = -1.5861 - 0.31082 * logn - 0.083751 * logn * logn + 0.0038915 * logn * logn * logn;
    sigma = Math.exp(-0.4803 - 0.082676 * logn + 0.0030302 * logn * logn);
  }
  const z = (w1 - mu) / sigma;
  return 1 - stdNormalCdfLocal(z);
}
function stdNormalCdfLocal(z) {
  // Φ(z) vía erf -- misma forma que stdNormalCdf de stats.js, duplicada
  // aquí como función interna (privada) para no crear una dependencia
  // circular de conveniencia; stats.js ya expone la pública si algún día
  // hace falta reutilizarla desde fuera.
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
  return z >= 0 ? 0.5 + 0.5 * y : 0.5 - 0.5 * y;
}

// ----------------------------------------------------- Levene / Brown-Forsythe --
/**
 * Test de homogeneidad de varianzas de Levene, variante centrada en la
 * MEDIANA (Brown-Forsythe 1974) -- más robusta que la clásica centrada en
 * la media cuando hay dudas de normalidad. Equivalente a
 * `car::leveneTest(y, g, center=median)` en R: un ANOVA de un factor sobre
 * los valores absolutos de la desviación a la mediana de cada grupo.
 * @param {number[][]} groups
 * @returns {{F:number, dfBetween:number, dfWithin:number, p:number} | {error:string}}
 */
export function leveneTest(groups) {
  const k = groups.length;
  if (k < 2) return { error: 'Hacen falta al menos 2 grupos.' };
  const medians = groups.map((g) => median(g));
  const z = groups.map((g, i) => g.map((v) => Math.abs(v - medians[i])));
  return oneWayF(z);
}
function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
/** ANOVA de un factor "desnudo" (sin depender de stats.js) reutilizado por
 *  leveneTest -- misma fórmula que oneWayAnova, duplicada deliberadamente
 *  como función privada de una línea de responsabilidad porque Levene
 *  necesita aplicarla a los |x-mediana|, no a los datos originales, y
 *  stats.js no expone sus piezas internas por separado. */
function oneWayF(groups) {
  const k = groups.length;
  const ns = groups.map((g) => g.length);
  const N = ns.reduce((a, b) => a + b, 0);
  if (N - k <= 0) return { error: 'No hay grados de libertad suficientes.' };
  const means = groups.map(mean);
  const grandMean = mean(groups.flat());
  let ssBetween = 0, ssWithin = 0;
  groups.forEach((g, i) => {
    ssBetween += ns[i] * (means[i] - grandMean) ** 2;
    g.forEach((v) => { ssWithin += (v - means[i]) ** 2; });
  });
  const dfBetween = k - 1, dfWithin = N - k;
  const msBetween = ssBetween / dfBetween, msWithin = ssWithin / dfWithin;
  const F = msWithin > 0 ? msBetween / msWithin : (msBetween > 0 ? Infinity : NaN);
  const p = isFinite(F) ? fDistPValue(F, dfBetween, dfWithin) : (isNaN(F) ? NaN : 0);
  return { F, dfBetween, dfWithin, p };
}

// ------------------------------------------------------------- Welch ANOVA --
/**
 * ANOVA de Welch (varianzas heterogéneas) -- equivalente a
 * `oneway.test(y ~ g, var.equal = FALSE)` en R.
 * @param {number[][]} groups
 * @returns {{F:number, dfBetween:number, dfWithin:number, p:number} | {error:string}}
 */
export function welchAnova(groups) {
  const k = groups.length;
  if (k < 2) return { error: 'Hacen falta al menos 2 grupos.' };
  const ns = groups.map((g) => g.length);
  if (ns.some((n) => n < 2)) return { error: 'Cada grupo necesita al menos 2 valores.' };
  const means = groups.map(mean);
  const vars = groups.map((g, i) => g.reduce((s, v) => s + (v - means[i]) ** 2, 0) / (ns[i] - 1));
  const w = ns.map((n, i) => n / (vars[i] || 1e-300));
  const sumW = w.reduce((a, b) => a + b, 0);
  const xBarW = w.reduce((s, wi, i) => s + wi * means[i], 0) / sumW;
  const dfBetween = k - 1;
  const numerator = w.reduce((s, wi, i) => s + wi * (means[i] - xBarW) ** 2, 0) / dfBetween;
  const term = w.reduce((s, wi, i) => s + (1 - wi / sumW) ** 2 / (ns[i] - 1), 0);
  const denomAdj = 1 + (2 * (k - 2) / (k * k - 1)) * term;
  const F = numerator / denomAdj;
  const dfWithin = (k * k - 1) / (3 * term);
  const p = isFinite(F) && isFinite(dfWithin) && dfWithin > 0 ? fDistPValue(F, dfBetween, dfWithin) : NaN;
  return { F, dfBetween, dfWithin, p };
}

// ------------------------------------------------ rango studentizado (ptukey) --
// CDF del rango studentizado Q(k, ν) vía integración numérica (Gauss-
// Legendre) de la representación integral estándar (misma fórmula que usa
// R internamente en ptukey.c, aunque con un esquema de cuadratura más
// simple): se integra primero sobre el rango de k variables normales
// estándar dado un "ancho" qu (integral interna, cerrada en z), y luego
// sobre la densidad de la varianza estimada con ν grados de libertad
// (integral externa, en u). Suficiente precisión (verificada contra tablas
// de rango studentizado publicadas y contra qtukey de R) para uso como
// post-hoc informativo -- no se persigue igualar el algoritmo exacto de
// Gleason que usa R bit a bit.
function stdNormalPdf(z) { return Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI); }

function gaussLegendreNodes(n) {
  // nodos/pesos de Gauss-Legendre en [-1,1] vía Newton sobre los polinomios
  // de Legendre -- calculado una vez, cacheado por n.
  const x = new Array(n), w = new Array(n);
  const m = Math.floor((n + 1) / 2);
  for (let i = 0; i < m; i++) {
    let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5));
    let z1, pp;
    for (let iter = 0; iter < 100; iter++) {
      let p1 = 1, p2 = 0;
      for (let j = 0; j < n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j + 1) * z * p2 - j * p3) / (j + 1); }
      pp = n * (z * p1 - p2) / (z * z - 1);
      z1 = z; z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-14) break;
    }
    x[i] = -z; x[n - 1 - i] = z;
    w[i] = 2 / ((1 - z * z) * pp * pp); w[n - 1 - i] = w[i];
  }
  return { x, w };
}
const GL32 = gaussLegendreNodes(32);
const GL64 = gaussLegendreNodes(64);

/** ∫ φ(z) [Φ(z) - Φ(z - q)]^{k-1} dz, integrado en z sobre (-∞,∞)
 *  (sustitución a un intervalo finito vía z = tan(θ) truncado a ±8, donde
 *  φ ya es despreciable). */
function rangeIntegral(q, k) {
  const LIM = 8;
  let sum = 0;
  for (let i = 0; i < GL64.x.length; i++) {
    const z = LIM * GL64.x[i];
    const phi = stdNormalPdf(z);
    const inner = stdNormalCdfLocal(z) - stdNormalCdfLocal(z - q);
    sum += GL64.w[i] * phi * Math.pow(Math.max(0, inner), k - 1);
  }
  return k * LIM * sum;
}

/** CDF del rango studentizado, P(Q <= q; k, ν). */
export function ptukey(q, k, nu) {
  if (!(q > 0)) return 0;
  if (k < 2 || nu < 1) return NaN;
  if (nu > 5000) return rangeIntegral(q, k); // la densidad de u colapsa en 1 -- caso límite normal
  // integral en u de f_nu(u) * rangeIntegral(q*u, k), u = s/sigma con
  // densidad chi escalada; se integra en un cambio de variable u=exp(t)
  // para cubrir (0,∞) con nodos finitos, recortando donde la densidad ya
  // es despreciable (chi con ν gl se concentra cerca de u=1).
  // densidad de u=s/sigma (s² ~ sigma²·χ²_ν/ν): si V=u² ~ χ²_ν/ν tiene
  // densidad (ν/2)^(ν/2)/Γ(ν/2) · v^(ν/2-1) · exp(-νv/2), el cambio de
  // variable v=u² (dv=2u·du) da f_u(u) = 2·(ν/2)^(ν/2)/Γ(ν/2) · u^(ν-1) ·
  // exp(-νu²/2) -- y como se integra en t=log(u) (du=u·dt), el integrando
  // en t lleva un factor u de más: u^ν en vez de u^(ν-1).
  const halfNu = nu / 2;
  const logConst = Math.log(2) + halfNu * Math.log(halfNu) - lnGamma(halfNu);
  // Rango y cuadratura de la integral en t=log(u), ajustados a ν (antes era
  // un rango fijo de ±2.2 con 32 nodos, que perdía la cola izquierda con ν
  // pequeño -- los gl fraccionarios de Games-Howell, error ~1e-3 en p -- y
  // no resolvía el pico con ν grande: error de hasta 0.37 con ν=4000;
  // detectado al comparar con stats::ptukey de R el script de "Descargar
  // script R"). El log-integrando ν·t − ν·e^{2t}/2 tiene su máximo en t=0:
  //  · cerca del pico cae como −ν·t² → anchura ~1/sqrt(2ν);
  //  · a la izquierda, como ν·t → hace falta |t| > 40/ν para e^-40;
  //  · a la derecha, como −ν·e^{2t}/2.
  // Se integra con Gauss-Legendre compuesto (12 tramos × 32 nodos).
  const sdT = 1 / Math.sqrt(2 * nu);
  const tLo = -Math.min(12, Math.max(9 * sdT, 40 / nu));
  const tHi = Math.max(9 * sdT, 0.5 * Math.log((80 + nu) / nu));
  const PANELS = 12;
  const h = (tHi - tLo) / PANELS;
  let sum = 0;
  for (let pnl = 0; pnl < PANELS; pnl++) {
    const a = tLo + pnl * h;
    for (let i = 0; i < GL32.x.length; i++) {
      const t = a + h * (GL32.x[i] + 1) / 2;
      const u = Math.exp(t);
      const logIntegrandT = logConst + nu * t - nu * u * u / 2; // = log(f_u(u)) + log(u)
      const fu = Math.exp(logIntegrandT);
      if (fu < 1e-300) continue;
      sum += GL32.w[i] * fu * rangeIntegral(q * u, k) * h / 2;
    }
  }
  return Math.min(1, Math.max(0, sum));
}
function lnGamma(x) {
  // aproximación de Lanczos (g=7, 9 coeficientes) -- precisión ~1e-15
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
/** p-valor (cola superior) del rango studentizado -- P(Q >= q). */
export function ptukeyUpper(q, k, nu) { return Math.max(0, 1 - ptukey(q, k, nu)); }

// ----------------------------------------------------------------- Tukey HSD --
/**
 * Post-hoc de Tukey HSD tras un ANOVA de un factor (varianzas homogéneas)
 * -- equivalente a `TukeyHSD(aov(y~g))` en R. Usa MSwithin y dfWithin del
 * propio ANOVA, como fisherLSD, pero con el rango studentizado en vez de
 * un t por pares (por eso SÍ corrige por comparaciones múltiples, a
 * diferencia de LSD).
 * @param {number[][]} groups
 * @returns {{ means:number[], ns:number[], dfWithin:number, msWithin:number,
 *   pairwise: {i:number,j:number,diff:number,q:number,p:number}[] } | {error:string}}
 */
export function tukeyHSD(groups) {
  const k = groups.length;
  if (k < 2) return { error: 'Hacen falta al menos 2 grupos.' };
  const ns = groups.map((g) => g.length);
  const N = ns.reduce((a, b) => a + b, 0);
  const dfWithin = N - k;
  if (dfWithin <= 0) return { error: 'No hay grados de libertad suficientes.' };
  const means = groups.map(mean);
  let ssWithin = 0;
  groups.forEach((g, i) => { g.forEach((v) => { ssWithin += (v - means[i]) ** 2; }); });
  const msWithin = ssWithin / dfWithin;
  const pairwise = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const diff = means[i] - means[j];
      const se = Math.sqrt(msWithin / 2 * (1 / ns[i] + 1 / ns[j]));
      const q = se > 0 ? Math.abs(diff) / se : (diff === 0 ? 0 : Infinity);
      const p = isFinite(q) ? ptukeyUpper(q, k, dfWithin) : 0;
      pairwise.push({ i, j, diff, q, p });
    }
  }
  return { means, ns, dfWithin, msWithin, pairwise };
}

// -------------------------------------------------------------- Games-Howell --
/**
 * Post-hoc de Games-Howell (varianzas heterogéneas) -- equivalente a
 * `rstatix::games_howell_test()`/`PMCMRplus::gamesHowellTest()` en R: como
 * Tukey HSD pero con el error estándar y los grados de libertad de cada
 * PAR calculados a la Welch-Satterthwaite (sin asumir una varianza común).
 * @param {number[][]} groups
 */
export function gamesHowell(groups) {
  const k = groups.length;
  if (k < 2) return { error: 'Hacen falta al menos 2 grupos.' };
  const ns = groups.map((g) => g.length);
  if (ns.some((n) => n < 2)) return { error: 'Cada grupo necesita al menos 2 valores.' };
  const means = groups.map(mean);
  const vars = groups.map((g, i) => g.reduce((s, v) => s + (v - means[i]) ** 2, 0) / (ns[i] - 1));
  const pairwise = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const diff = means[i] - means[j];
      const seSq = vars[i] / ns[i] + vars[j] / ns[j];
      const se = Math.sqrt(seSq / 2); // Games-Howell usa SE/sqrt(2) igual que Tukey, con la varianza combinada de Welch
      const dfNum = seSq * seSq;
      const dfDen = (vars[i] / ns[i]) ** 2 / (ns[i] - 1) + (vars[j] / ns[j]) ** 2 / (ns[j] - 1);
      const df = dfDen > 0 ? dfNum / dfDen : NaN;
      const q = se > 0 ? Math.abs(diff) / se : (diff === 0 ? 0 : Infinity);
      const p = isFinite(q) && isFinite(df) ? ptukeyUpper(q, k, df) : (diff === 0 ? 1 : 0);
      pairwise.push({ i, j, diff, q, df, p });
    }
  }
  return { means, ns, pairwise };
}

// -------------------------------------------------------- árbol de decisión --
/**
 * Diagnostica normalidad/homogeneidad de varianzas y recomienda un test,
 * siguiendo el árbol de decisión del prompt. NO decide nada por sí mismo
 * si `groups` no tiene datos suficientes -- deja siempre la posibilidad de
 * forzar otro test a mano (esto solo decide la opción PRESELECCIONADA).
 * @param {number[][]} groups  valores por grupo, en el mismo orden que `groupNames`
 * @param {{alpha?:number, paired?:boolean}} [opt]
 * @returns {{
 *   normality: {perGroup: {W:number,p:number,n:number,normal:(boolean|null)}[], overallNormal: boolean},
 *   variance: {F:number, p:number, homogeneous: boolean} | null,
 *   recommended: string,   // 'student'|'welch'|'mannwhitney'|'paired-t'|'wilcoxon-signed'|'anova-tukey'|'welch-anova-gh'|'kruskal-dunn'
 *   reason: string,        // explicación en lenguaje llano, lista para mostrar en el panel
 * }}
 */
export function recommendTest(groups, opt = {}) {
  const alpha = opt.alpha ?? 0.05;
  const k = groups.length;
  const perGroup = groups.map((g) => {
    const sw = shapiroWilk(g);
    return { ...sw, normal: Number.isFinite(sw.p) ? sw.p > alpha : null };
  });
  // "sin verificar" (n<3) cuenta como NO confirmado normal, por precaución
  // (el prompt pide defaultear a no-paramétrico en ese caso)
  const anyUnverified = perGroup.some((g) => g.normal === null);
  const overallNormal = !anyUnverified && perGroup.every((g) => g.normal === true);

  let varianceInfo = null;
  if (k >= 2 && groups.every((g) => g.length >= 2)) {
    const lev = leveneTest(groups);
    if (!lev.error) varianceInfo = { F: lev.F, p: lev.p, homogeneous: lev.p > alpha };
  }

  let recommended, reason;
  if (k === 2) {
    if (opt.paired) {
      recommended = overallNormal ? 'paired-t' : 'wilcoxon-signed';
      reason = overallNormal
        ? 'Datos pareados y normales (Shapiro-Wilk, ambos grupos p>' + alpha + ') → t-test pareado.'
        : 'Datos pareados' + (anyUnverified ? ', normalidad sin verificar (n<3 en algún grupo)' : ' pero no normales (Shapiro-Wilk)') + ' → Wilcoxon con signo (no paramétrico).';
    } else if (!overallNormal) {
      recommended = 'mannwhitney';
      reason = anyUnverified
        ? 'n insuficiente para comprobar normalidad en algún grupo → Mann-Whitney U (no paramétrico), por precaución.'
        : 'Al menos un grupo no pasa Shapiro-Wilk (p≤' + alpha + ') → Mann-Whitney U (no paramétrico).';
    } else if (varianceInfo && !varianceInfo.homogeneous) {
      recommended = 'welch';
      reason = 'Ambos grupos normales (Shapiro-Wilk, p>' + alpha + ') pero varianzas heterogéneas (Levene, p=' + varianceInfo.p.toFixed(4) + '≤' + alpha + ') → t-test de Welch.';
    } else {
      recommended = 'student';
      reason = 'Ambos grupos normales (Shapiro-Wilk, p>' + alpha + ') y varianzas homogéneas (Levene, p=' + (varianceInfo ? varianceInfo.p.toFixed(4) : '—') + '>' + alpha + ') → t-test de Student.';
    }
  } else if (k > 2) {
    if (!overallNormal) {
      recommended = 'kruskal-dunn';
      reason = anyUnverified
        ? 'n insuficiente para comprobar normalidad en algún grupo → Kruskal-Wallis + post-hoc de Dunn, por precaución.'
        : 'Al menos un grupo no pasa Shapiro-Wilk (p≤' + alpha + ') → Kruskal-Wallis + post-hoc de Dunn (Benjamini-Hochberg).';
    } else if (varianceInfo && !varianceInfo.homogeneous) {
      recommended = 'welch-anova-gh';
      reason = 'Todos los grupos normales (Shapiro-Wilk, p>' + alpha + ') pero varianzas heterogéneas (Levene, p=' + varianceInfo.p.toFixed(4) + '≤' + alpha + ') → ANOVA de Welch + post-hoc de Games-Howell.';
    } else {
      recommended = 'anova-tukey';
      reason = 'Todos los grupos normales (Shapiro-Wilk, p>' + alpha + ') y varianzas homogéneas (Levene, p=' + (varianceInfo ? varianceInfo.p.toFixed(4) : '—') + '>' + alpha + ') → ANOVA de un factor + post-hoc de Tukey HSD.';
    }
  } else {
    recommended = null;
    reason = 'Hace falta al menos 2 grupos.';
  }

  return { normality: { perGroup, overallNormal, anyUnverified }, variance: varianceInfo, recommended, reason };
}
