// Estadística mínima, sin dependencias, para los módulos de diversidad.
// Cada función se verificó contra valores de referencia conocidos antes de
// integrarla (ver README, sección "Notas de desarrollo").

export function mean(arr) {
  if (arr.length === 0) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1);
  return Math.sqrt(v);
}

/** Error estándar de la media = desviación típica muestral / √n. 0 si n < 2.
 *  (idéntico a `sd(x)/sqrt(length(x))` en R.) */
export function standardError(arr) {
  if (arr.length < 2) return 0;
  return stdDev(arr) / Math.sqrt(arr.length);
}

export function quartiles(sortedArr) {
  // método "exclusivo" de percentiles (el habitual en boxplots de ggplot2/Tukey)
  const n = sortedArr.length;
  function pct(p) {
    const idx = (n - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sortedArr[lo];
    return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
  }
  return { q1: pct(0.25), median: pct(0.5), q3: pct(0.75) };
}

/**
 * Densidad por kernel gaussiano (KDE) -- para el gráfico de violín (prompt
 * "quick wins" del 22 sep 2026, punto 4). Ancho de banda por la regla de
 * Silverman, h = 0.9·min(SD, IQR/1.34)·n^(-1/5) -- la misma aproximación
 * que usa `bw.nrd0()` de R (el ancho de banda por defecto de `density()`).
 * Evalúa la densidad en `nPoints` puntos equiespaciados entre min(x)-3h y
 * max(x)+3h (margen de 3h para que la curva llegue suave a 0 en los
 * extremos en vez de cortarse en seco justo en el dato más extremo).
 * @param {number[]} x
 * @param {number} [nPoints=100]
 * @returns {{ x:number[], density:number[], bandwidth:number, n:number } | null}  null si n<2
 */
export function gaussianKDE(x, nPoints = 100) {
  const n = x.length;
  if (n < 2) return null;
  const sd = stdDev(x);
  const q = quartiles(x.slice().sort((a, b) => a - b));
  const iqr = q.q3 - q.q1;
  const spread = iqr > 0 ? Math.min(sd, iqr / 1.34) : sd;
  const h = spread > 0 ? 0.9 * spread * Math.pow(n, -0.2) : (Math.max(...x) - Math.min(...x)) / 4 || 1;
  const xMin = Math.min(...x) - 3 * h, xMax = Math.max(...x) + 3 * h;
  const xs = [], density = [];
  const norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
  for (let i = 0; i < nPoints; i++) {
    const xi = xMin + ((xMax - xMin) * i) / (nPoints - 1);
    let d = 0;
    for (let j = 0; j < n; j++) { const z = (xi - x[j]) / h; d += Math.exp(-0.5 * z * z); }
    xs.push(xi); density.push(d * norm);
  }
  return { x: xs, density, bandwidth: h, n };
}

// ---------- diversidad alfa (índices por muestra) ----------
// Verificados contra vegan::diversity() / vegan::estimateR() (ver README,
// "Notas de desarrollo"). Todos toman un vector de CONTEOS (o abundancias) por
// taxón; los ceros y negativos se ignoran.

/** Proporciones que suman 1 sobre las entradas > 0. Devuelve [] si no hay ninguna. */
function toProportions(counts) {
  let sum = 0;
  for (let i = 0; i < counts.length; i++) if (counts[i] > 0) sum += counts[i];
  if (!(sum > 0)) return [];
  const p = [];
  for (let i = 0; i < counts.length; i++) if (counts[i] > 0) p.push(counts[i] / sum);
  return p;
}

/** Riqueza observada: nº de taxones con conteo > 0. */
export function observedRichness(counts) {
  let s = 0;
  for (let i = 0; i < counts.length; i++) if (counts[i] > 0) s++;
  return s;
}

/** Índice de Shannon H' con logaritmo natural — como vegan::diversity(x, "shannon"). */
export function shannonIndex(counts) {
  const p = toProportions(counts);
  let h = 0;
  for (let i = 0; i < p.length; i++) h -= p[i] * Math.log(p[i]);
  return h;
}

/** Simpson 1 − D (Gini-Simpson) — como vegan::diversity(x, "simpson"). */
export function simpsonIndex(counts) {
  const p = toProportions(counts);
  if (p.length === 0) return NaN;
  let d = 0;
  for (let i = 0; i < p.length; i++) d += p[i] * p[i];
  return 1 - d;
}

/**
 * Equidad de Pielou J' = H' / ln(S), con S = riqueza observada.
 * No está definida con S < 2 (ln 1 = 0) → NaN, igual que vegan.
 * Se puede pasar (shannon, richness) ya calculados o un vector de conteos.
 */
export function pielouEvenness(a, richness) {
  let h, s;
  if (Array.isArray(a)) { h = shannonIndex(a); s = observedRichness(a); }
  else { h = a; s = richness; }
  if (!(s >= 2)) return NaN;
  return h / Math.log(s);
}

/**
 * Chao1 corregido por sesgo (Chao 1987) — como vegan::estimateR(x)["S.chao1"]:
 *   Sobs + F1·(F1−1) / (2·(F2+1))
 * F1 / F2 = nº de taxones con exactamente 1 / 2 lecturas (singletons/doubletons).
 * El +1 del denominador lo hace estable cuando F2 = 0. Necesita conteos
 * ENTEROS (redondea por si el archivo trae "9.0").
 */
export function chao1(counts) {
  let sObs = 0, f1 = 0, f2 = 0;
  for (let i = 0; i < counts.length; i++) {
    const v = Math.round(counts[i]);
    if (v <= 0) continue;
    sObs++;
    if (v === 1) f1++;
    else if (v === 2) f2++;
  }
  return sObs + (f1 * (f1 - 1)) / (2 * (f2 + 1));
}

/**
 * Curva de rarefacción ANALÍTICA (esperanza de riqueza, Hurlbert 1971) — sin
 * remuestreo aleatorio. Para una submuestra de `n` lecturas sin reemplazo:
 *
 *   S(n) = Sobs − Σ_i  C(N − Nᵢ, n) / C(N, n)     (solo taxones con Nᵢ > 0)
 *
 * El término es la probabilidad de NO ver el taxón i en la submuestra. Los
 * combinatorios se hacen con logGamma para no desbordar el factorial. Es la
 * misma fórmula que `vegan::rarefy()` / `rarecurve()`.
 *
 * @param {number[]} counts       conteos por taxón de UNA muestra (se redondean; ceros/negativos se ignoran)
 * @param {number}   [nPoints=50] nº de profundidades donde evaluar (incluye 0 y N)
 * @returns {{ N:number, sObs:number, depths:number[], richness:number[] }}
 */
export function rarefactionCurve(counts, nPoints = 50) {
  const ni = [];
  let N = 0;
  for (let k = 0; k < counts.length; k++) {
    const c = Math.round(counts[k]);
    if (c > 0) { ni.push(c); N += c; }
  }
  const sObs = ni.length;
  if (N === 0) return { N: 0, sObs: 0, depths: [0], richness: [0] };

  // profundidades: 0, N, y ~nPoints puntos repartidos uniformemente (enteros, sin duplicados)
  const m = Math.max(2, Math.floor(nPoints));
  const set = new Set([0, N]);
  for (let j = 1; j < m; j++) set.add(Math.round((j / m) * N));
  const depths = [...set].filter((d) => d >= 0 && d <= N).sort((a, b) => a - b);

  const lgN1 = logGamma(N + 1);
  const richness = depths.map((n) => {
    if (n <= 0) return 0;
    if (n >= N) return sObs;
    const lgNn1 = logGamma(N - n + 1);
    let notSeen = 0;
    for (let i = 0; i < ni.length; i++) {
      const rem = N - ni[i];        // lecturas de los OTROS taxones
      if (rem < n) continue;        // imposible no muestrear el taxón i → término 0
      notSeen += Math.exp(logGamma(rem + 1) - logGamma(rem - n + 1) - lgN1 + lgNn1);
    }
    return sObs - notSeen;
  });

  return { N, sObs, depths, richness };
}

// ---------- estimadores de riqueza por INCIDENCIA (por grupo de muestras) ----------
// Reproducen vegan::specpool() con su valor por defecto smallsample = TRUE, que
// aplica el factor de muestra pequeña ssc = (n−1)/n. Verificados número a número
// contra la salida real de specpool() (ver README, "Notas de desarrollo").

/**
 * @param {number[][]} siteBySpecies  matriz muestra × taxón: n filas (muestras
 *   del grupo) × S columnas (taxones). Solo importa si cada celda es > 0.
 * @returns {{n:number, sObs:number, chao2:number, chao2SE:number,
 *   jack1:number, jack1SE:number, jack2:number, boot:number, bootSE:number}}
 */
export function incidenceRichnessEstimators(siteBySpecies) {
  const n = siteBySpecies.length;
  const empty = { n, sObs: 0, chao2: NaN, chao2SE: NaN, jack1: NaN, jack1SE: NaN, jack2: NaN, boot: NaN, bootSE: NaN };
  if (n === 0) return empty;
  const S = siteBySpecies[0].length;

  // frecuencia de incidencia (en cuántas muestras del grupo aparece cada taxón)
  const freq = new Array(S).fill(0);
  for (let si = 0; si < n; si++) {
    const row = siteBySpecies[si];
    for (let j = 0; j < S; j++) if (row[j] > 0) freq[j]++;
  }

  const ssc = (n - 1) / n;
  let sObs = 0, a1 = 0, a2 = 0;
  for (let j = 0; j < S; j++) {
    if (freq[j] > 0) sObs++;
    if (freq[j] === 1) a1++;
    else if (freq[j] === 2) a2++;
  }
  if (sObs === 0) return { ...empty, sObs: 0 };

  // Chao2: vegan usa a1²/(2·a2) si a2 > 0; si no, a1·(a1−1)/2. Ambos × ssc.
  const chao2 = a2 > 0
    ? sObs + ssc * a1 * a1 / 2 / a2
    : sObs + ssc * a1 * (a1 - 1) / 2;

  const jack1 = sObs + a1 * (n - 1) / n;
  const jack2 = n > 1
    ? sObs + a1 * (2 * n - 3) / n - a2 * (n - 2) * (n - 2) / n / (n - 1)
    : sObs;

  // Bootstrap: Sobs + Σ (1 − p_j)^n sobre los taxones observados, p_j = freq_j/n
  let boot = sObs;
  for (let j = 0; j < S; j++) if (freq[j] > 0) boot += Math.pow(1 - freq[j] / n, n);

  // --- varianzas (idénticas a specpool) ---
  let varChao;
  if (a2 > 0) {
    const aa = a1 / a2;
    varChao = a1 * ssc * (0.5 + ssc * (1 + aa / 4) * aa) * aa;
  } else {
    varChao = ssc * (ssc * (a1 * (2 * a1 - 1) * (2 * a1 - 1) / 4 - a1 * a1 * a1 * a1 / chao2 / 4) + a1 * (a1 - 1) / 2);
  }

  let varJack1 = 0;
  if (a1 > 0) {
    const uniqueCols = [];
    for (let j = 0; j < S; j++) if (freq[j] === 1) uniqueCols.push(j);
    let sumSq = 0;
    for (let si = 0; si < n; si++) {
      let cnt = 0;
      for (let u = 0; u < uniqueCols.length; u++) if (siteBySpecies[si][uniqueCols[u]] > 0) cnt++;
      sumSq += cnt * cnt;
    }
    varJack1 = (sumSq - a1 / n) * (n - 1) / n;
  }

  // Bootstrap SE: Σ pn(1−pn) + 2·Σ_{j<k} [ (co-ausencias_jk / n)^n − pn_j·pn_k ]
  const obs = [];
  for (let j = 0; j < S; j++) if (freq[j] > 0) obs.push(j);
  const m = obs.length;
  const pn = obs.map((j) => Math.pow(1 - freq[j] / n, n));
  let varBoot = 0;
  for (let x = 0; x < m; x++) varBoot += pn[x] * (1 - pn[x]);
  for (let x = 0; x < m; x++) {
    for (let y = 0; y < x; y++) {
      let bothAbsent = 0;
      for (let si = 0; si < n; si++) {
        if (!(siteBySpecies[si][obs[x]] > 0) && !(siteBySpecies[si][obs[y]] > 0)) bothAbsent++;
      }
      varBoot += 2 * (Math.pow(bothAbsent / n, n) - pn[x] * pn[y]);
    }
  }

  return {
    n, sObs,
    chao2, chao2SE: Math.sqrt(Math.max(0, varChao)),
    jack1, jack1SE: Math.sqrt(Math.max(0, varJack1)),
    jack2,
    boot, bootSE: Math.sqrt(Math.max(0, varBoot)),
  };
}

// ---------- función gamma (para el p-valor de chi-cuadrado) ----------

function logGamma(x) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function gammaP(a, x) {
  let sum = 1 / a, term = 1 / a, ap = a;
  for (let n = 1; n < 500; n++) {
    ap += 1;
    term *= x / ap;
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

function gammaQcf(a, x) {
  const FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/**
 * Φ(z): CDF de la normal estándar, vía la gamma incompleta regularizada
 * (erf(x) = P(½, x²) para x≥0) — mismo enfoque numéricamente estable que
 * chiSquarePValue (serie o fracción continua según el régimen), en vez de
 * una aproximación racional de precisión fija: hace falta para p-valores
 * pequeños de mannWhitneyU/dunnTest/wilcoxonSignedRank en pairwiseStats.js.
 */
export function stdNormalCdf(z) {
  if (!isFinite(z)) return z > 0 ? 1 : 0;
  const x2 = (z * z) / 2;
  const erf = x2 < 1.5 ? gammaP(0.5, x2) : 1 - gammaQcf(0.5, x2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** p-valor de la cola superior de una chi-cuadrado con `df` grados de libertad. */
export function chiSquarePValue(x, df) {
  if (x <= 0) return 1;
  const a = df / 2, xx = x / 2;
  return xx < a + 1 ? 1 - gammaP(a, xx) : gammaQcf(a, xx);
}

// ---------- función beta incompleta (para el p-valor de correlación) ----------
// Mismo enfoque que la gamma incompleta de arriba (Numerical Recipes): fracción
// continua de Lentz + logGamma de Lanczos. Verificado contra valores de
// pbeta() de R y pt() de Student (ver README, "Notas de desarrollo").

function betacf(a, b, x) {
  const FPMIN = 1e-300, EPS = 1e-15;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Beta incompleta regularizada I_x(a, b). Devuelve un valor en [0, 1]. */
export function incompleteBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lfront =
    logGamma(a + b) - logGamma(a) - logGamma(b) +
    a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lfront);
  return x < (a + 1) / (a + b + 2)
    ? (front * betacf(a, b, x)) / a
    : 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** p-valor a dos colas de un estadístico t de Student con `df` grados de libertad. */
export function studentTwoTailedP(tval, df) {
  if (!(df > 0) || !isFinite(tval)) return NaN;
  const x = df / (df + tval * tval);
  return incompleteBeta(df / 2, 0.5, x);
}

// ---------- rangos (para Spearman y demás) ----------

/** Rangos 1..n con media en los empates. `arr` = array numérico. */
export function averageRanks(arr) {
  const order = arr.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v);
  const ranks = new Array(arr.length);
  let k = 0;
  while (k < order.length) {
    let j = k;
    while (j + 1 < order.length && order[j + 1].v === order[k].v) j++;
    const r = (k + j) / 2 + 1;
    for (let m = k; m <= j; m++) ranks[order[m].i] = r;
    k = j + 1;
  }
  return ranks;
}

// ---------- correlación de Pearson / Spearman con p-valor ----------

/**
 * Correlación de Pearson entre dos arrays numéricos ALINEADOS (misma longitud,
 * el llamador ya ha filtrado los pares con datos completos).
 * p-valor a dos colas vía t = r·sqrt((n-2)/(1-r²)) y la beta incompleta.
 * Devuelve { r, p, n }.
 */
export function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return { r: NaN, p: NaN, n };
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n, my = sy / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return { r: NaN, p: NaN, n };
  let r = sxy / Math.sqrt(sxx * syy);
  r = Math.max(-1, Math.min(1, r));
  const df = n - 2;
  let p;
  if (df <= 0) p = NaN;
  else if (r === 1 || r === -1) p = 0;
  else p = studentTwoTailedP(r * Math.sqrt(df / (1 - r * r)), df);
  return { r, p, n };
}

/**
 * Elipse de confianza normal bivariante alrededor de (xs,ys) -- equivalente
 * a `car::dataEllipse(x, y, levels=confidence)` / `vegan::ordiellipse` /
 * `ggplot2::stat_ellipse(type="norm")`: autovectores/autovalores de la
 * matriz de covarianza 2×2, escalados por la raíz de la cuantila chi-
 * cuadrado con 2 grados de libertad (que tiene forma cerrada:
 * -2·ln(1-confianza), no hace falta invertir la CDF numéricamente).
 * Con n < 4 la elipse es numéricamente inestable (covarianza mal
 * determinada) -- se devuelve null, y quien llama decide cómo avisarlo en
 * vez de dibujar algo engañoso.
 * @param {number[]} xs
 * @param {number[]} ys
 * @param {number} [confidence=0.95]
 * @param {number} [nPoints=72]  vértices del polígono cerrado que aproxima la elipse
 * @returns {{ center:[number,number], points:[number,number][], semiMajor:number, semiMinor:number, angle:number } | null}
 */
export function confidenceEllipsePoints(xs, ys, confidence = 0.95, nPoints = 72) {
  const n = Math.min(xs.length, ys.length);
  if (n < 4) return null;
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const denom = n - 1;
  sxx /= denom; syy /= denom; sxy /= denom;

  // autovalores/autovectores de la matriz de covarianza 2x2 [[sxx,sxy],[sxy,syy]]
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc); // autovalores, l1>=l2>=0
  let vx, vy;
  if (Math.abs(sxy) > 1e-12) { vx = l1 - syy; vy = sxy; } else { vx = sxx >= syy ? 1 : 0; vy = sxx >= syy ? 0 : 1; }
  const vlen = Math.hypot(vx, vy) || 1;
  vx /= vlen; vy /= vlen;

  const q = -2 * Math.log(1 - confidence); // cuantila chi-cuadrado, 2 g.l., forma cerrada
  const a = Math.sqrt(Math.max(0, l1) * q); // semieje mayor
  const b = Math.sqrt(Math.max(0, l2) * q); // semieje menor
  const angle = Math.atan2(vy, vx);

  const points = [];
  for (let i = 0; i < nPoints; i++) {
    const theta = (2 * Math.PI * i) / nPoints;
    const ex = a * Math.cos(theta), ey = b * Math.sin(theta);
    points.push([mx + ex * vx - ey * vy, my + ex * vy + ey * vx]);
  }
  return { center: [mx, my], points, semiMajor: a, semiMinor: b, angle };
}

/**
 * Correlación de Spearman (rho): Pearson sobre los rangos de cada variable.
 * Mismo p-valor aproximado que Pearson sobre los rangos.
 */
export function spearman(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return { r: NaN, p: NaN, n };
  return pearson(averageRanks(x.slice(0, n)), averageRanks(y.slice(0, n)));
}

// ---------- Kruskal-Wallis ----------

/**
 * Test de Kruskal-Wallis (alternativa no paramétrica a ANOVA de un factor),
 * con corrección por empates. `groups` es un array de arrays numéricos
 * (uno por grupo). Devuelve { H, df, p }.
 */
export function kruskalWallis(groups) {
  const valid = groups.filter((g) => g.length > 0);
  const all = [];
  valid.forEach((g, gi) => g.forEach((v) => all.push({ v, gi })));
  all.sort((a, b) => a.v - b.v);
  const N = all.length;
  const ranks = new Array(N);
  let i = 0;
  while (i < N) {
    let j = i;
    while (j + 1 < N && all[j + 1].v === all[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = avgRank;
    i = j + 1;
  }
  const rankSums = valid.map(() => 0);
  for (let k = 0; k < N; k++) rankSums[all[k].gi] += ranks[k];
  let H = 0;
  valid.forEach((g, gi) => { H += (rankSums[gi] * rankSums[gi]) / g.length; });
  H = (12 / (N * (N + 1))) * H - 3 * (N + 1);

  let tieSum = 0, i2 = 0;
  while (i2 < N) {
    let j2 = i2;
    while (j2 + 1 < N && all[j2 + 1].v === all[i2].v) j2++;
    const t = j2 - i2 + 1;
    tieSum += t * t * t - t;
    i2 = j2 + 1;
  }
  const C = N > 1 ? 1 - tieSum / (N * N * N - N) : 1;
  const Hc = C > 0 ? H / C : H;
  const df = valid.length - 1;
  const p = df > 0 ? chiSquarePValue(Hc, df) : NaN;
  return { H: Hc, df, p };
}

/**
 * Corrección de Benjamini-Hochberg (FDR) de un vector de p-valores.
 * Equivalente a `p.adjust(p, method = "BH")` de R: ordena los p descendentes,
 * aplica m/i·p con i = m, m-1, …, 1, toma el mínimo acumulado y lo recorta a 1.
 * Asume p-valores finitos (quien llama filtra los NaN antes).
 * @param {number[]} pvals
 * @returns {number[]} q-valores en el orden original
 */
export function benjaminiHochberg(pvals) {
  const m = pvals.length;
  if (m === 0) return [];
  const idx = pvals.map((_, i) => i).sort((a, b) => pvals[b] - pvals[a]); // p descendente
  const adj = new Array(m);
  let running = Infinity;
  for (let k = 0; k < m; k++) {
    const i = idx[k];
    const rank = m - k; // m, m-1, …, 1
    running = Math.min(running, (m / rank) * pvals[i]);
    adj[i] = Math.min(1, running);
  }
  return adj;
}

/**
 * Delta de Cliff entre dos muestras: δ = (#{x>y} − #{x<y}) / (n_x · n_y).
 * Rango [−1, 1]; δ > 0 ⇒ `x` tiende a ser mayor que `y`. Es la misma
 * definición que `effsize::cliff.delta(x, y)` de R (no paramétrico, sin
 * supuestos de distribución).
 * @param {number[]} x @param {number[]} y
 * @returns {number} NaN si algún grupo está vacío
 */
export function cliffsDelta(x, y) {
  const nx = x.length, ny = y.length;
  if (nx === 0 || ny === 0) return NaN;
  let gt = 0, lt = 0;
  for (let i = 0; i < nx; i++) {
    const xi = x[i];
    for (let j = 0; j < ny; j++) {
      if (xi > y[j]) gt++;
      else if (xi < y[j]) lt++;
    }
  }
  return (gt - lt) / (nx * ny);
}

// ---------- UPGMA (clustering jerárquico para el mapa de calor beta) ----------

/**
 * Clustering jerárquico UPGMA (average linkage) sobre una matriz de
 * distancias cuadrada. Devuelve el nodo raíz de un árbol binario:
 * hojas = { label, height: 0, size: 1 }; nodos internos = { height, size, left, right }.
 */
export function upgma(distMatrix, labels) {
  const n = labels.length;
  const nodes = new Map();
  for (let i = 0; i < n; i++) nodes.set(i, { id: i, label: labels[i], height: 0, size: 1, left: null, right: null });
  const dist = new Map();
  for (let i = 0; i < n; i++) {
    dist.set(i, new Map());
    for (let j = 0; j < n; j++) if (i !== j) dist.get(i).set(j, distMatrix[i][j]);
  }
  let nextId = n;
  let activeIds = Array.from({ length: n }, (_, i) => i);

  while (activeIds.length > 1) {
    let bestI = -1, bestJ = -1, bestD = Infinity;
    for (let a = 0; a < activeIds.length; a++) {
      for (let b = a + 1; b < activeIds.length; b++) {
        const ii = activeIds[a], jj = activeIds[b];
        const d = dist.get(ii).get(jj);
        if (d < bestD) { bestD = d; bestI = ii; bestJ = jj; }
      }
    }
    const ni = nodes.get(bestI), nj = nodes.get(bestJ);
    const newNode = { id: nextId, label: null, height: bestD, size: ni.size + nj.size, left: ni, right: nj };
    nodes.set(nextId, newNode);
    const newDist = new Map();
    for (const k of activeIds) {
      if (k === bestI || k === bestJ) continue;
      const dik = dist.get(bestI).get(k);
      const djk = dist.get(bestJ).get(k);
      const dnew = (ni.size * dik + nj.size * djk) / (ni.size + nj.size);
      newDist.set(k, dnew);
      dist.get(k).set(nextId, dnew);
    }
    dist.set(nextId, newDist);
    activeIds = activeIds.filter((x) => x !== bestI && x !== bestJ);
    activeIds.push(nextId);
    nextId++;
  }
  return nodes.get(nextId - 1);
}

/** Recorre el árbol UPGMA en orden y devuelve las etiquetas de las hojas en el orden de clustering. */
export function leafOrder(node, out) {
  out = out || [];
  if (!node.left && !node.right) { out.push(node.label); return out; }
  if (node.left) leafOrder(node.left, out);
  if (node.right) leafOrder(node.right, out);
  return out;
}

export function formatP(p) {
  if (!isFinite(p)) return '—';
  if (p < 0.0001) return '< 0.0001';
  return p.toFixed(4);
}

// ---------- PERMANOVA de un factor (Anderson 2001) ----------
// PRNG local para que las permutaciones sean deterministas con la misma semilla
// (no arrastra dependencias: stats.js es puro). Se exporta para que las otras
// pruebas por permutación del proyecto (p. ej. `permdisp.js`) usen exactamente
// la misma secuencia y no cada una la suya.
export function mulberry32s(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Suma de cuadrados "within" a partir de la matriz de distancias, para una
// asignación de grupos dada (Anderson 2001, ec. de la partición geométrica):
//   SS_W = Σ_g [ (1/n_g) · Σ_{i<j ∈ g} d²_ij ]
function ssWithin(d2, labelIdx, nGroups) {
  const n = labelIdx.length;
  const sums = new Float64Array(nGroups);
  const counts = new Float64Array(nGroups);
  for (let g = 0; g < nGroups; g++) counts[g] = 0;
  for (let i = 0; i < n; i++) counts[labelIdx[i]]++;
  for (let i = 0; i < n; i++) {
    const gi = labelIdx[i];
    const row = d2[i];
    for (let j = i + 1; j < n; j++) {
      if (labelIdx[j] === gi) sums[gi] += row[j];
    }
  }
  let ssw = 0;
  for (let g = 0; g < nGroups; g++) if (counts[g] > 0) ssw += sums[g] / counts[g];
  return ssw;
}

/**
 * PERMANOVA de un factor sobre una matriz de distancias (equivalente a
 * `vegan::adonis2(D ~ grupo)` con un solo término). Pseudo-F por permutación
 * de las etiquetas de grupo.
 *
 * @param {number[][]} distMatrix  matriz de distancias n×n (simétrica, 0 en la diagonal)
 * @param {(string|number)[]} groups  etiqueta de grupo de cada muestra, en el
 *   mismo orden que las filas/columnas de la matriz
 * @param {object} [opt]
 * @param {number} [opt.permutations=999]
 * @param {number} [opt.seed=0x51M2]  semilla del PRNG (determinista)
 * @returns {{
 *   n:number, groups:string[], groupSizes:number[],
 *   df1:number, df2:number, SSa:number, SSw:number, SSt:number,
 *   MSa:number, MSw:number, F:number, R2:number, p:number, permutations:number
 * } | { error:string }}
 */
export function permanova(distMatrix, groups, opt = {}) {
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
  if (a >= n) return { error: 'Cada muestra está en su propio grupo; no hay réplicas.' };

  // distancias al cuadrado
  const d2 = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(n);
    for (let j = 0; j < n; j++) { const v = +distMatrix[i][j] || 0; row[j] = v * v; }
    d2.push(row);
  }

  let sst = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) sst += d2[i][j];
  sst /= n;

  const groupSizes = gName.map((_, g) => {
    let c = 0; for (let i = 0; i < n; i++) if (labelIdx[i] === g) c++; return c;
  });

  const ssw0 = ssWithin(d2, labelIdx, a);
  const ssa0 = sst - ssw0;
  const df1 = a - 1, df2 = n - a;
  const Fobs = (ssa0 / df1) / (ssw0 / df2);
  const R2 = sst > 0 ? ssa0 / sst : NaN;

  let pval = NaN;
  if (perms > 0 && isFinite(Fobs)) {
    const rnd = mulberry32s(opt.seed != null ? opt.seed : 0x5152);
    const perm = Int32Array.from(labelIdx);
    let ge = 0;
    for (let k = 0; k < perms; k++) {
      // Fisher-Yates sobre `perm`
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
      }
      const sswP = ssWithin(d2, perm, a);
      const Fp = ((sst - sswP) / df1) / (sswP / df2);
      if (Fp >= Fobs - 1e-12) ge++;
    }
    pval = (ge + 1) / (perms + 1);
  }

  return {
    n, groups: gName, groupSizes,
    df1, df2, SSa: ssa0, SSw: ssw0, SSt: sst,
    MSa: ssa0 / df1, MSw: ssw0 / df2,
    F: Fobs, R2, p: pval, permutations: perms,
  };
}

// ---------- ANOVA de un factor + LSD de Fisher + letras de grupo homogéneo ----------

/** p-valor de cola superior de la F de Fisher, vía la relación con la beta
 *  incompleta regularizada: P(F(d1,d2) > f) = I_{d2/(d2+d1·f)}(d2/2, d1/2). */
export function fDistPValue(f, d1, d2) {
  if (!(d1 > 0) || !(d2 > 0)) return NaN;
  if (!(f > 0)) return f === 0 ? 1 : NaN;
  if (!isFinite(f)) return 0;
  const x = d2 / (d2 + d1 * f);
  return incompleteBeta(d2 / 2, d1 / 2, x);
}

/**
 * ANOVA de un factor (equivalente a `summary(aov(y ~ grupo))` en R).
 * @param {number[][]} groups  un array de valores por grupo
 * @returns {{dfBetween:number, dfWithin:number, ssBetween:number, ssWithin:number,
 *   msBetween:number, msWithin:number, F:number, p:number} | {error:string}}
 */
export function oneWayAnova(groups) {
  const k = groups.length;
  if (k < 2) return { error: 'Hacen falta al menos 2 grupos.' };
  const ns = groups.map((g) => g.length);
  const N = ns.reduce((a, b) => a + b, 0);
  if (N - k <= 0) return { error: 'No hay grados de libertad dentro de grupos (faltan réplicas).' };
  const means = groups.map(mean);
  const grandMean = mean(groups.flat());
  let ssBetween = 0, ssWithin = 0;
  groups.forEach((g, i) => {
    ssBetween += ns[i] * (means[i] - grandMean) ** 2;
    g.forEach((v) => { ssWithin += (v - means[i]) ** 2; });
  });
  const dfBetween = k - 1, dfWithin = N - k;
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  const F = msWithin > 0 ? msBetween / msWithin : (msBetween > 0 ? Infinity : NaN);
  const p = isFinite(F) ? fDistPValue(F, dfBetween, dfWithin) : (isNaN(F) ? NaN : 0);
  return { dfBetween, dfWithin, ssBetween, ssWithin, msBetween, msWithin, F, p };
}

/**
 * Test LSD de Fisher (least significant difference) por pares, usando la
 * varianza combinada (MSwithin) y los grados de libertad del ANOVA — el
 * mismo test que `agricolae::LSD.test(mod, "grupo", p.adj="none")` en R: un
 * t-test por pareja con la varianza combinada, SIN corregir por comparaciones
 * múltiples (de ahí "least significant" — es deliberadamente permisivo,
 * pensado para usarse solo tras un ANOVA ya significativo).
 * @param {number[][]} groups
 * @param {number} [alpha=0.05]
 * @returns {{ anova:object, means:number[], ns:number[],
 *   pairwise: {i:number,j:number,diff:number,t:number,p:number,significant:boolean}[] } | {error:string}}
 */
export function fisherLSD(groups, alpha = 0.05) {
  const anova = oneWayAnova(groups);
  if (anova.error) return anova;
  const means = groups.map(mean);
  const ns = groups.map((g) => g.length);
  const pairwise = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const se = Math.sqrt(anova.msWithin * (1 / ns[i] + 1 / ns[j]));
      const diff = means[i] - means[j];
      let t, p;
      if (se > 0) { t = diff / se; p = studentTwoTailedP(t, anova.dfWithin); }
      else { t = diff === 0 ? 0 : (diff > 0 ? Infinity : -Infinity); p = diff === 0 ? 1 : 0; }
      pairwise.push({ i, j, diff, t, p, significant: p < alpha });
    }
  }
  return { anova, means, ns, pairwise };
}

/**
 * Letras de grupo homogéneo (compact letter display) a partir de los
 * resultados por pares de `fisherLSD()`: dos grupos comparten letra si NO
 * difieren significativamente. Las letras son exactamente las CLIQUES
 * MAXIMALES del grafo "no difieren" (Bron-Kerbosch) — la misma
 * caracterización que usa `multcompView::multcompLetters()` en R — así que
 * funciona igual de bien si el patrón de significación no es "monótono" con
 * la media (algo que puede pasar con tamaños de muestra muy desiguales entre
 * grupos, un caso que este módulo ya trata como habitual).
 * @param {number} k  nº de grupos
 * @param {{i:number,j:number,significant:boolean}[]} pairwise
 * @param {number[]} [meansForOrder]  medias para ordenar las letras (mayor primero); opcional
 * @returns {string[]}  una letra (o varias, ej. "ab") por grupo, en el orden 0..k-1
 */
export function compactLetterDisplay(k, pairwise, meansForOrder) {
  const adj = Array.from({ length: k }, () => new Set());
  pairwise.forEach(({ i, j, significant }) => { if (!significant) { adj[i].add(j); adj[j].add(i); } });

  const cliques = [];
  function bronKerbosch(R, P, X) {
    if (P.size === 0 && X.size === 0) { cliques.push([...R].sort((a, b) => a - b)); return; }
    for (const v of [...P]) {
      bronKerbosch(new Set([...R, v]), new Set([...P].filter((u) => adj[v].has(u))), new Set([...X].filter((u) => adj[v].has(u))));
      P.delete(v);
      X.add(v);
    }
  }
  bronKerbosch(new Set(), new Set(Array.from({ length: k }, (_, i) => i)), new Set());

  // orden de letras: por la media más alta del clique primero (convención habitual, "a" = el grupo más alto)
  const cliqueMean = (c) => Math.max(...c.map((i) => (meansForOrder ? meansForOrder[i] : -i)));
  cliques.sort((a, b) => cliqueMean(b) - cliqueMean(a));

  const letters = Array.from({ length: k }, () => '');
  cliques.forEach((clique, idx) => {
    const letter = String.fromCharCode(97 + (idx % 26)) + (idx >= 26 ? String(Math.floor(idx / 26)) : '');
    clique.forEach((i) => { letters[i] += letter; });
  });
  return letters;
}

// ---------- LDA univariante estabilizada con bootstrap (variante propia, inspirada en LEfSe) ----------
// El LDA de LEfSe (Segata et al. 2011) NO es un LDA multivariante sobre toda
// la matriz: es univariante, por característica, entre dos clases (aquí:
// "grupo enriquecido" vs "el resto", el mismo one-vs-rest que ya usa
// cliffsDelta en el panel de biomarcadores) — estabilizado remuestreando
// repetidamente. Aquí, punto por punto:
//   1. coeficiente discriminante de Fisher (LDA 1D, 2 clases): (media_A −
//      media_B) / varianza combinada. Es la fórmula clásica de Fisher 1936
//      (NO el `$scaling` que da `MASS::lda()` en R, que normaliza a varianza
//      unitaria y por tanto NO depende de qué clase tiene la media más
//      alta — se comprobó y se descartó antes de escribir esto). Se conecta
//      de forma exacta con el t de Student de varianzas iguales:
//      w = t · sqrt((1/n_A+1/n_B) / varianza_combinada) — así se verifica
//      contra `t.test(..., var.equal=TRUE)` sin depender de ningún paquete
//      de LDA.
//   2. bootstrap: 30 remuestreos SIN reemplazo al ~66% de cada clase (por
//      separado, no del conjunto combinado — variante propia, más simple
//      que remuestrear la tabla completa y re-separar clases después).
//   3. mediana de los 30 coeficientes (no la media: más robusta a alguna
//      iteración degenerada), y el score final es log10(|mediana|).
// Al operar sobre el mismo % de abundancia relativa que usa el resto del
// panel de biomarcadores (no la normalización a escala fija ×10⁶ del LEfSe
// original), la escala numérica del score NO es directamente comparable a
// los LDA scores publicados con la herramienta LEfSe — se avisa en la UI.

function sampleWithoutReplacement(arr, k, rnd) {
  const a = arr.slice();
  const n = a.length;
  const kk = Math.min(k, n);
  for (let i = 0; i < kk; i++) {
    const j = i + Math.floor(rnd() * (n - i));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a.slice(0, kk);
}

/** Coeficiente discriminante de Fisher (LDA 1D, 2 clases): (mediaA−mediaB)/varianza combinada. */
export function fisherDiscriminantCoefficient(a, b) {
  const na = a.length, nb = b.length;
  if (na < 2 || nb < 2) return NaN;
  const pooled = ((na - 1) * stdDev(a) ** 2 + (nb - 1) * stdDev(b) ** 2) / (na + nb - 2);
  if (!(pooled > 0)) return NaN;
  return (mean(a) - mean(b)) / pooled;
}

/**
 * LDA score al estilo LEfSe: coeficiente discriminante de Fisher entre dos
 * clases, estabilizado con bootstrap (remuestreo sin reemplazo al 66% de
 * cada clase, `iterations` veces, mediana de los coeficientes).
 * @param {number[]} a  clase "enriquecida"
 * @param {number[]} b  clase "resto"
 * @param {{iterations?:number, fraction?:number, seed?:number}} [opt]
 * @returns {{coefficient:number, score:number, iterations:number} | {error:string}}
 */
export function lefseLdaScore(a, b, opt = {}) {
  const iterations = opt.iterations != null ? opt.iterations : 30;
  const fraction = opt.fraction != null ? opt.fraction : 2 / 3;
  if (a.length < 2 || b.length < 2) return { error: 'Hacen falta al menos 2 valores en cada clase.' };
  const rnd = mulberry32s(opt.seed != null ? opt.seed : 0x1D5A);
  const na = Math.max(2, Math.min(a.length, Math.round(a.length * fraction)));
  const nb = Math.max(2, Math.min(b.length, Math.round(b.length * fraction)));
  const coefs = [];
  for (let k = 0; k < iterations; k++) {
    const w = fisherDiscriminantCoefficient(sampleWithoutReplacement(a, na, rnd), sampleWithoutReplacement(b, nb, rnd));
    if (Number.isFinite(w)) coefs.push(w);
  }
  if (!coefs.length) return { error: 'Ninguna iteración del bootstrap dio un coeficiente válido (varianza combinada nula en todas).' };
  const med = quartiles(coefs.slice().sort((x, y) => x - y)).median;
  return { coefficient: med, score: Math.log10(Math.abs(med)), iterations: coefs.length };
}
