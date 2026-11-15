// Cuantificación de qPCR: curva estándar, eficiencia, ΔΔCt con propagación de
// error, Pfaffl y cuantificación absoluta.
//
// Solo aritmética, sin DOM. El control de calidad vive en qpcrData.js y va
// antes que todo esto.
//
// La decisión de fondo: 2^-ΔΔCt da por hecho que las dos dianas amplifican al
// 100 % de eficiencia, y dos ensayos que corren a veinte ciclos de distancia
// rara vez lo hacen. Ruiz-Villalba, Ruijter y van den Hoff (Life, 2021)
// desarrollan que interpretar Cq suponiendo eficiencia perfecta puede desviar
// el cociente en dos órdenes de magnitud, y recomiendan trabajar con
// concentraciones iniciales corregidas por eficiencia. Por eso aquí conviven
// los dos métodos: 2^-ΔΔCt para quien no tenga curvas, y Pfaffl —o la
// cuantificación absoluta— en cuanto haya eficiencias medidas. El resultado
// dice siempre con cuál se ha calculado.

/** Eficiencia aceptable de un ensayo, en tanto por uno. */
export const EFFICIENCY_RANGE = [0.9, 1.1];
/** R² mínimo razonable de una curva estándar. */
export const MIN_R2 = 0.98;

export const QUANT_WARN = {
  EFFICIENCY_OUT: 'efficiencyOut',   // fuera del 90-110 %
  LOW_R2: 'lowR2',                   // la recta no ajusta
  FEW_POINTS: 'fewPoints',           // menos de 5 puntos de curva
  ASSUMED_EFFICIENCY: 'assumedEfficiency', // 2^-ΔΔCt sin eficiencias medidas
  NO_SD: 'noSd',                     // sin réplicas no hay incertidumbre
  CALIBRATOR_MATRIX: 'calibratorMatrix',   // cambio de escala sospechoso
};

/**
 * Cambio de expresión por encima del cual conviene sospechar del calibrador.
 * Un "19.878 veces" casi nunca es biología: suele ser que el calibrador es
 * otra matriz, u otro experimento, y entonces el cociente no es un cambio de
 * expresión sino la razón entre dos sistemas distintos.
 */
export const FOLD_SANITY = 1000;

/**
 * Copias del gen por microlitro de un amplicón purificado.
 *
 *   copias/µL = (ng/µL × 1e-9 × N_A) / (pb × 660)
 *
 * 660 g/mol es la masa media de un par de bases de ADN de doble cadena.
 * @param {number} ngPerUl Concentración medida (Qubit o similar).
 * @param {number} ampliconBp Longitud del amplicón, en pares de bases.
 */
export function geneCopies(ngPerUl, ampliconBp) {
  const ng = Number(ngPerUl);
  const bp = Number(ampliconBp);
  if (!(ng > 0) || !(bp > 0)) return NaN;
  return (ng * 1e-9 * 6.022e23) / (bp * 660);
}

/** Serie de diluciones decimales a partir de una concentración madre. */
export function decimalSeries(start, points = 10) {
  const s = Number(start);
  if (!(s > 0)) return [];
  return Array.from({ length: Math.max(1, Math.floor(points)) }, (_, i) => s / (10 ** i));
}

/**
 * Curva estándar: regresión de Cq frente a log10 de la cantidad inicial.
 *
 *   Cq = pendiente · log10(N0) + intersección
 *   E  = 10^(-1/pendiente) - 1
 *
 * Con eficiencia perfecta la pendiente vale -3,3219 y E = 1 (100 %).
 *
 * @param {Array<{quantity:number, cq:number}>} points
 * @returns {{slope:number, intercept:number, r2:number, efficiency:number,
 *            efficiencyPct:number, n:number, warnings:string[]}|null}
 */
export function standardCurve(points = []) {
  const pts = points
    .map((p) => ({ x: Math.log10(Number(p.quantity)), y: Number(p.cq) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 2) return null;

  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  const efficiency = slope < 0 ? (10 ** (-1 / slope)) - 1 : NaN;

  const warnings = [];
  if (!(efficiency >= EFFICIENCY_RANGE[0] && efficiency <= EFFICIENCY_RANGE[1])) {
    warnings.push(QUANT_WARN.EFFICIENCY_OUT);
  }
  if (r2 < MIN_R2) warnings.push(QUANT_WARN.LOW_R2);
  if (n < 5) warnings.push(QUANT_WARN.FEW_POINTS);

  return {
    slope, intercept, r2, efficiency,
    efficiencyPct: efficiency * 100,
    n, warnings,
  };
}

/**
 * Cuantificación absoluta: cantidad inicial de un pocillo a partir de la
 * curva de su diana.
 *
 *   N0 = 10^((Cq - intersección) / pendiente)
 *
 * Devuelve null si el pocillo no amplificó: un Cq ausente no es un cero, y
 * convertirlo daría una cantidad enorme en vez de "por debajo del límite".
 */
export function absoluteQuantity(cq, curve) {
  if (cq == null || !curve || !Number.isFinite(curve.slope) || curve.slope === 0) return null;
  const v = Number(cq);
  if (!Number.isFinite(v)) return null;
  return 10 ** ((v - curve.intercept) / curve.slope);
}

/** Media y SD de una lista. */
function stats(xs) {
  const v = xs.filter((x) => Number.isFinite(x));
  if (!v.length) return { mean: NaN, sd: NaN, n: 0 };
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const s = v.length > 1
    ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) : NaN;
  return { mean: m, sd: s, n: v.length };
}

/**
 * ΔCt de una muestra: diana menos referencia, con su incertidumbre.
 *
 * La SD se propaga como raíz de la suma de cuadrados, que es lo que
 * corresponde a una resta de dos medias independientes. Sin esto el cambio de
 * expresión sale como un número pelado y aparenta una precisión que no tiene.
 *
 * @param {{mean:number, sd:number, n:number}} target
 * @param {{mean:number, sd:number, n:number}} reference
 */
export function deltaCt(target, reference) {
  const d = target.mean - reference.mean;
  const sd = Math.sqrt((Number.isFinite(target.sd) ? target.sd ** 2 : 0)
    + (Number.isFinite(reference.sd) ? reference.sd ** 2 : 0));
  return {
    value: d,
    sd: (Number.isFinite(target.sd) || Number.isFinite(reference.sd)) ? sd : NaN,
  };
}

/**
 * Método comparativo 2^-ΔΔCt (Livak).
 *
 * El calibrador es un argumento explícito y sale siempre en el resultado: la
 * confusión más cara de este método es comparar contra una muestra de otra
 * matriz sin darse cuenta, y entonces el "cambio de expresión" es el cociente
 * entre dos sistemas distintos, no un cambio.
 *
 * @param {{value:number, sd:number}} sampleDct ΔCt de la muestra.
 * @param {{value:number, sd:number}} calibratorDct ΔCt del calibrador.
 * @param {{calibratorName?:string, efficienciesKnown?:boolean}} [opts]
 * @returns {{ddct:number, sd:number, fold:number, foldLow:number,
 *            foldHigh:number, method:string, calibrator:string,
 *            warnings:string[]}}
 */
export function deltaDeltaCt(sampleDct, calibratorDct, opts = {}) {
  const ddct = sampleDct.value - calibratorDct.value;
  const sd = Math.sqrt((Number.isFinite(sampleDct.sd) ? sampleDct.sd ** 2 : 0)
    + (Number.isFinite(calibratorDct.sd) ? calibratorDct.sd ** 2 : 0));
  const haveSd = Number.isFinite(sampleDct.sd) || Number.isFinite(calibratorDct.sd);
  const fold = 2 ** (-ddct);

  const warnings = [];
  if (!opts.efficienciesKnown) warnings.push(QUANT_WARN.ASSUMED_EFFICIENCY);
  if (!haveSd) warnings.push(QUANT_WARN.NO_SD);
  if (Number.isFinite(fold) && (fold > FOLD_SANITY || fold < 1 / FOLD_SANITY)) {
    warnings.push(QUANT_WARN.CALIBRATOR_MATRIX);
  }

  return {
    ddct,
    sd: haveSd ? sd : NaN,
    fold,
    foldLow: haveSd ? 2 ** (-(ddct + sd)) : NaN,
    foldHigh: haveSd ? 2 ** (-(ddct - sd)) : NaN,
    method: 'livak',
    calibrator: opts.calibratorName || '',
    warnings,
  };
}

/**
 * Método de Pfaffl: el mismo cociente, pero con la eficiencia real de cada
 * ensayo en lugar de suponer 2 para los dos.
 *
 *   ratio = E_diana^(Cq_cal,diana - Cq_muestra,diana)
 *         / E_ref^(Cq_cal,ref   - Cq_muestra,ref)
 *
 * `E` es el factor de amplificación por ciclo (2 = 100 % de eficiencia), es
 * decir 1 + eficiencia.
 *
 * @param {{sample:number, calibrator:number}} targetCq Medias de Cq.
 * @param {{sample:number, calibrator:number}} referenceCq
 * @param {{target:number, reference:number}} efficiency Eficiencias (0-1).
 */
export function pfaffl(targetCq, referenceCq, efficiency) {
  const et = 1 + Number(efficiency.target);
  const er = 1 + Number(efficiency.reference);
  if (!(et > 1) || !(er > 1)) return null;
  const num = et ** (targetCq.calibrator - targetCq.sample);
  const den = er ** (referenceCq.calibrator - referenceCq.sample);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;

  const warnings = [];
  const ratio = num / den;
  if (ratio > FOLD_SANITY || ratio < 1 / FOLD_SANITY) warnings.push(QUANT_WARN.CALIBRATOR_MATRIX);
  for (const e of [efficiency.target, efficiency.reference]) {
    if (!(e >= EFFICIENCY_RANGE[0] && e <= EFFICIENCY_RANGE[1])) {
      warnings.push(QUANT_WARN.EFFICIENCY_OUT);
      break;
    }
  }
  return { ratio, method: 'pfaffl', warnings };
}

/**
 * Expresión relativa de una tanda entera, a partir de los grupos de réplicas.
 *
 * @param {Array} groups Salida de `groupReplicates`.
 * @param {{target:string, reference:string, calibrator:string,
 *          efficiency?:{target:number, reference:number}}} cfg
 * @returns {{rows:Array, calibrator:string, method:string, warnings:string[]}}
 */
export function relativeExpression(groups = [], cfg = {}) {
  const by = new Map();
  groups.forEach((g) => by.set(g.sample + '\u0000' + g.target, g));
  const get = (sample, target) => by.get(sample + '\u0000' + target) || null;

  const calT = get(cfg.calibrator, cfg.target);
  const calR = get(cfg.calibrator, cfg.reference);
  if (!calT || !calR) return { rows: [], calibrator: cfg.calibrator || '', method: '', warnings: [] };

  const calDct = deltaCt(calT, calR);
  const haveEff = !!(cfg.efficiency
    && Number.isFinite(cfg.efficiency.target) && Number.isFinite(cfg.efficiency.reference));

  const samples = [...new Set(groups.map((g) => g.sample))];
  const rows = [];
  for (const sample of samples) {
    const tg = get(sample, cfg.target);
    const rg = get(sample, cfg.reference);
    if (!tg || !rg || !tg.n || !rg.n) {
      rows.push({ sample, dct: NaN, ddct: NaN, fold: NaN, usable: false, warnings: [] });
      continue;
    }
    const dct = deltaCt(tg, rg);
    const livak = deltaDeltaCt(dct, calDct, {
      calibratorName: cfg.calibrator, efficienciesKnown: haveEff,
    });
    const row = {
      sample,
      cqTarget: tg.mean, cqReference: rg.mean,
      sdTarget: tg.sd, sdReference: rg.sd,
      dct: dct.value, dctSd: dct.sd,
      ddct: livak.ddct, ddctSd: livak.sd,
      fold: livak.fold, foldLow: livak.foldLow, foldHigh: livak.foldHigh,
      method: livak.method,
      usable: true,
      warnings: livak.warnings,
    };
    if (haveEff) {
      const p = pfaffl(
        { sample: tg.mean, calibrator: calT.mean },
        { sample: rg.mean, calibrator: calR.mean },
        cfg.efficiency,
      );
      if (p) {
        row.ratioPfaffl = p.ratio;
        row.method = 'pfaffl';
        row.warnings = [...new Set([...row.warnings.filter(
          (w) => w !== QUANT_WARN.ASSUMED_EFFICIENCY,
        ), ...p.warnings])];
      }
    }
    rows.push(row);
  }

  return {
    rows,
    calibrator: cfg.calibrator,
    method: haveEff ? 'pfaffl' : 'livak',
    warnings: [...new Set(rows.flatMap((r) => r.warnings || []))],
  };
}

export { stats as replicateStats };
