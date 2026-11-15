// Expansión de un diseño experimental a la lista de unidades que hay que
// montar en la poyata. Solo aritmética y combinatoria: sin DOM, sin imágenes.
//
// Las dos distinciones que hace este archivo son la razón de que exista, y
// las dos son errores de diseño habituales, no sutilezas:
//
//   1. Réplica BIOLÓGICA frente a TÉCNICA. La biológica es otra unidad
//      experimental independiente y multiplica los matraces que hay que
//      montar. La técnica son varias medidas sobre la MISMA unidad: multiplica
//      medidas, no unidades, y no aporta grados de libertad al contraste entre
//      tratamientos. Contar técnicas como n es pseudorreplicación.
//
//   2. Muestreo DESTRUCTIVO frente a NO DESTRUCTIVO en el tiempo. Si en cada
//      tiempo se sacrifica la unidad (lo normal en microbiología), cada tiempo
//      multiplica las unidades. Si se toma alícuota estéril de la misma
//      unidad, no las multiplica: es una medida repetida. La diferencia entre
//      las dos lecturas de un mismo diseño puede ser de 72 a 216 matraces.

/** Códigos de aviso. Son claves i18n, no texto. */
export const DESIGN_WARN = {
  SINGLE_LEVEL: 'singleLevel',          // un factor con un solo nivel no es un factor
  FEW_BIOLOGICAL: 'fewBiological',      // menos de 3 réplicas biológicas
  PSEUDOREPLICATION: 'pseudoreplication', // técnicas sin biológicas
  NO_FACTORS: 'noFactors',              // nada que cruzar
  REPEATED_MEASURES: 'repeatedMeasures', // muestreo no destructivo: el análisis debe tenerlo en cuenta
};

/** Mínimo de réplicas biológicas por debajo del cual se avisa. */
export const MIN_BIOLOGICAL = 3;

/**
 * Producto cartesiano de los niveles de varios factores.
 * @param {Array<{name:string, levels:string[]}>} factors
 * @returns {Array<Object>} Un objeto {nombreFactor: nivel} por combinación.
 */
export function crossFactors(factors) {
  let combos = [{}];
  for (const f of factors) {
    const next = [];
    for (const combo of combos) {
      for (const level of f.levels) next.push({ ...combo, [f.name]: level });
    }
    combos = next;
  }
  return combos;
}

/**
 * Expande el diseño a la lista de unidades experimentales.
 *
 * @param {Object} design
 * @param {Array<{name:string, levels:string[]}>} design.factors
 * @param {number} [design.biologicalReplicates=3]
 * @param {number} [design.technicalReplicates=1]
 * @param {string[]} [design.timepoints=[]] Etiquetas de los tiempos de muestreo.
 * @param {boolean} [design.destructiveSampling=true] Por defecto destructivo:
 *   es la lectura que más unidades da, y pasarse de medio sale mucho más
 *   barato que quedarse corto y tener que repetir el ensayo.
 * @returns {{units:Array<Object>, unitCount:number, measurementCount:number,
 *            measurementsPerUnit:number, effectiveFactors:Array, ignoredFactors:string[],
 *            breakdown:Array<{label:string, count:number}>, warnings:string[]}}
 */
export function expandDesign(design = {}) {
  const {
    factors = [],
    biologicalReplicates = 3,
    technicalReplicates = 1,
    timepoints = [],
    destructiveSampling = true,
  } = design;

  const warnings = [];

  const effectiveFactors = [];
  const ignoredFactors = [];
  for (const f of factors) {
    const levels = (f.levels || []).filter((l) => String(l).trim() !== '');
    if (levels.length >= 2) effectiveFactors.push({ name: f.name, levels });
    else ignoredFactors.push(f.name);
  }
  if (ignoredFactors.length) warnings.push(DESIGN_WARN.SINGLE_LEVEL);
  if (!effectiveFactors.length) warnings.push(DESIGN_WARN.NO_FACTORS);

  const bio = Math.max(1, Math.floor(Number(biologicalReplicates) || 1));
  const tech = Math.max(1, Math.floor(Number(technicalReplicates) || 1));
  const times = timepoints.filter((t) => String(t).trim() !== '');

  if (bio < MIN_BIOLOGICAL) warnings.push(DESIGN_WARN.FEW_BIOLOGICAL);
  if (tech > 1 && bio === 1) warnings.push(DESIGN_WARN.PSEUDOREPLICATION);
  if (times.length && !destructiveSampling) warnings.push(DESIGN_WARN.REPEATED_MEASURES);

  const combos = crossFactors(effectiveFactors);

  // Con muestreo destructivo el tiempo entra en la identidad de la unidad: una
  // unidad por tiempo. Sin él, el tiempo es una medida sobre la misma unidad.
  const timeAxis = (destructiveSampling && times.length) ? times : [null];

  const units = [];
  let index = 0;
  for (const combo of combos) {
    for (const time of timeAxis) {
      for (let r = 1; r <= bio; r++) {
        units.push({
          index: index++,
          levels: { ...combo },
          replicate: r,
          timepoint: time,
        });
      }
    }
  }

  // Medidas por unidad: sin muestreo destructivo cada unidad se mide en todos
  // los tiempos; con él, cada unidad se mide una sola vez, en el suyo.
  const measurementsPerUnit = tech * ((!destructiveSampling && times.length) ? times.length : 1);

  const breakdown = [
    ...effectiveFactors.map((f) => ({ label: f.name, count: f.levels.length })),
    { label: 'biological', count: bio },
  ];
  if (destructiveSampling && times.length) {
    breakdown.push({ label: 'timepoints', count: times.length });
  }

  return {
    units,
    unitCount: units.length,
    // se devuelven para que quien calcule ocasiones de medida (assayPlan.js)
    // no tenga que volver a deducirlas del diseño original
    destructiveSampling: !!destructiveSampling,
    timepointCount: times.length,
    measurementsPerUnit,
    measurementCount: units.length * measurementsPerUnit,
    effectiveFactors,
    ignoredFactors,
    breakdown,
    warnings,
  };
}

/**
 * ¿Caben las unidades en la capacidad declarada (estufa, agitador,
 * centrífuga)? Si no caben, el ensayo va por bloques, y el bloque deja de ser
 * un detalle logístico para convertirse en un factor que el análisis tiene que
 * incluir: dos tandas en días distintos no son intercambiables.
 * @returns {{fits:boolean, blocks:number, perBlock:number}|null}
 *   null si no se ha declarado capacidad.
 */
export function blockPlan(unitCount, capacity) {
  const cap = Number(capacity);
  if (!(cap > 0)) return null;
  const blocks = Math.ceil(unitCount / cap);
  return {
    fits: blocks <= 1,
    blocks,
    perBlock: Math.ceil(unitCount / blocks),
  };
}
