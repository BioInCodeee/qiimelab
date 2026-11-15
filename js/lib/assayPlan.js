// Variables de respuesta: qué se le mide a cada unidad experimental, qué
// siembra implica eso, y las hojas de toma de datos.
//
// El planificador sabía cuántas unidades montas; esto sabe qué les haces.
// Y la diferencia entre una variable y otra no es cosmética:
//
//   - Una variable DIRECTA (CE, pH, humedad, peso) es una medida por unidad.
//     Cuesta una casilla en una hoja.
//   - Un RECUENTO (bacterias totales, hongos, levaduras) no es una medida: es
//     una siembra. Cada grupo microbiano lleva su medio selectivo, su serie de
//     diluciones y sus placas por dilución, y eso multiplica. Con 72 unidades,
//     tres grupos, tres diluciones y tres placas por dilución salen 1.944
//     placas y casi 39 L de agar. Esa cuenta es la razón de ser de este
//     archivo: se hace antes de montar el ensayo, no cuando ya no hay medio.
//
// Dos hojas distintas, porque son dos momentos distintos:
//
//   - La hoja de SIEMBRA lleva una fila por placa, con la columna de colonias
//     vacía. Es la que se rellena en la poyata o con el contador de colonias.
//   - La tabla ANCHA lleva una fila por unidad y una columna por grupo
//     microbiano con las UFC/mL ya calculadas. Es la que come #/recuentos.
//
// `collapseCounts` convierte la primera en la segunda. Sin ese puente, la hoja
// de siembra sería un archivo muerto.

import { cfuPerMl, dilutionFactor, volumeInMl } from './cfu.js';
import { PLATE_AGAR_VOLUME } from './mediaPlan.js';

export const VARIABLE_KIND = { DIRECT: 'direct', COUNT: 'count' };

/**
 * Siembra por defecto de un recuento: 3 diluciones y 3 placas por dilución.
 * Es lo habitual cuando no se sabe de antemano en qué dilución va a caer el
 * recuento contable.
 */
export const DEFAULT_COUNT_PLAN = { dilutions: 3, platesPerDilution: 3 };

/** Umbral a partir del cual conviene avisar de que la siembra se ha disparado. */
export const PLATE_WARN_THRESHOLD = 500;

/**
 * Rango de colonias por placa que se considera contable.
 *
 * `cfu.js` trae 25-250, que es el criterio del recuento en placa estándar.
 * Aquí el valor por defecto es 30-300, que es el otro criterio de norma y el
 * que usa este laboratorio. Se deja configurable por llamada en vez de tocar
 * las constantes de `cfu.js`, que las comparten el contador de colonias y
 * #/recuentos y no deben moverse desde aquí.
 */
export const DEFAULT_COUNTABLE_RANGE = [30, 300];

export const ASSAY_WARN = {
  HEAVY_PLATING: 'heavyPlating',   // muchísimas placas
  NO_VARIABLES: 'noVariables',     // ensayo sin nada que medir
  MISSING_MEDIUM: 'missingMedium', // un recuento sin medio declarado
};

/**
 * Ocasiones de medida: cuántas veces se mide, en total, a lo largo del ensayo.
 *
 * Con muestreo destructivo cada unidad ya lleva su tiempo dentro, así que se
 * mide una vez. Sin él, la misma unidad se mide en todos los tiempos.
 */
export function measurementOccasions(expansion) {
  const units = expansion?.unitCount ?? 0;
  const perUnit = (expansion?.destructiveSampling === false && expansion?.timepointCount > 0)
    ? expansion.timepointCount : 1;
  return units * perUnit;
}

/**
 * Carga de siembra de los recuentos declarados.
 *
 * @param {Object} expansion Salida de `expandDesign`.
 * @param {Array<{name:string, kind:string, medium?:string, plateDiameter?:number,
 *                dilutions?:number, platesPerDilution?:number}>} variables
 * @returns {{perVariable:Array, totalPlates:number, warnings:string[]}}
 */
export function platingBurden(expansion, variables = []) {
  const occasions = measurementOccasions(expansion);
  const warnings = [];
  const counts = variables.filter((v) => v.kind === VARIABLE_KIND.COUNT);

  const perVariable = counts.map((v) => {
    const dilutions = Math.max(1, Math.floor(v.dilutions ?? DEFAULT_COUNT_PLAN.dilutions));
    const plates = Math.max(1, Math.floor(v.platesPerDilution ?? DEFAULT_COUNT_PLAN.platesPerDilution));
    const diameter = v.plateDiameter ?? 90;
    const perOccasion = dilutions * plates;
    const totalPlates = occasions * perOccasion;
    const volumePerPlate = PLATE_AGAR_VOLUME[diameter] ?? PLATE_AGAR_VOLUME[90];
    if (!v.medium) warnings.push(ASSAY_WARN.MISSING_MEDIUM);
    return {
      name: v.name,
      medium: v.medium || '',
      dilutions,
      platesPerDilution: plates,
      platesPerOccasion: perOccasion,
      totalPlates,
      plateDiameter: diameter,
      agarVolume: totalPlates * volumePerPlate,
    };
  });

  const totalPlates = perVariable.reduce((s, v) => s + v.totalPlates, 0);
  if (totalPlates > PLATE_WARN_THRESHOLD) warnings.push(ASSAY_WARN.HEAVY_PLATING);
  if (!variables.length) warnings.push(ASSAY_WARN.NO_VARIABLES);

  return { perVariable, totalPlates, occasions, warnings };
}

/**
 * Capas de medio que generan los recuentos, en el formato que come
 * `planMedia`: una entrada por placa. Así el agar de los recuentos entra en el
 * mismo cálculo de volúmenes y reparto en botellas que el resto del ensayo, en
 * vez de quedarse fuera y aparecer por sorpresa el día de preparar medios.
 */
export function countMediaLayers(burden) {
  const layers = [];
  for (const v of burden.perVariable) {
    const volume = PLATE_AGAR_VOLUME[v.plateDiameter] ?? PLATE_AGAR_VOLUME[90];
    for (let i = 0; i < v.totalPlates; i++) layers.push([{ medium: v.medium || v.name, volume }]);
  }
  return layers;
}

/**
 * Hoja de toma de datos de las variables directas: una fila por ocasión de
 * medida, con los identificadores ya escritos y una columna vacía por
 * variable. Se imprime o se abre en el móvil y solo se rellenan números.
 *
 * Lleva la columna `sample-id` por delante, así que el archivo relleno sigue
 * siendo cargable como metadatos y empalma con el análisis.
 */
export function buildDirectSheet(meta, variables = []) {
  const direct = variables.filter((v) => v.kind === VARIABLE_KIND.DIRECT);
  const idHeaders = meta.headers;
  const varHeaders = direct.map((v) => (v.unit ? `${v.name} (${v.unit})` : v.name));
  const headers = [...idHeaders, ...varHeaders];
  const rows = meta.rows.map((r) => {
    const row = { ...r };
    varHeaders.forEach((h) => { row[h] = ''; });
    return row;
  });
  return { headers, rows };
}

/**
 * Hoja de siembra: una fila por placa sembrada, con `colonias` vacía.
 *
 * Se incluyen TODAS las diluciones sembradas aunque luego solo se cuente la
 * que cae en rango: el que siembra no sabe de antemano cuál será, y una hoja a
 * la que le falten filas se rellena a mano en el margen.
 *
 * @param {Object} meta Salida de `buildMetadata`.
 * @param {Array} variables
 * @param {{dilutionExponents?:number[]}} [opts] Exponentes de las diluciones
 *   sembradas, p. ej. [-3, -4, -5]. Si faltan, se numeran 1..n.
 */
export function buildCountSheet(meta, variables = [], opts = {}) {
  const counts = variables.filter((v) => v.kind === VARIABLE_KIND.COUNT);
  const idKey = meta.sampleIdKey;
  const headers = [idKey, 'grupo', 'medio', 'dilucion', 'placa', 'colonias'];
  const rows = [];
  for (const r of meta.rows) {
    for (const v of counts) {
      const dil = Math.max(1, Math.floor(v.dilutions ?? DEFAULT_COUNT_PLAN.dilutions));
      const plates = Math.max(1, Math.floor(v.platesPerDilution ?? DEFAULT_COUNT_PLAN.platesPerDilution));
      const exps = opts.dilutionExponents;
      for (let d = 0; d < dil; d++) {
        for (let p = 1; p <= plates; p++) {
          rows.push({
            [idKey]: r[idKey],
            grupo: v.name,
            medio: v.medium || '',
            dilucion: exps && exps[d] != null ? `1e${exps[d]}` : String(d + 1),
            placa: p,
            colonias: '',
          });
        }
      }
    }
  }
  return { headers, rows };
}

/**
 * Hoja de siembra rellena → tabla ancha de UFC/mL, que es lo que carga
 * #/recuentos: una fila por muestra y una columna por grupo microbiano.
 *
 * El criterio, en dos escalones:
 *
 *   1. Si hay placas en rango contable (30-300 por defecto, configurable),
 *      se promedian ESAS y nada más. Promediar una placa de 4 colonias con
 *      otra de 600 no da un recuento, da un número sin significado.
 *   2. Si NINGUNA placa de esa muestra y grupo cae en rango, no se descarta la
 *      muestra: se promedia igualmente la dilución cuyo recuento queda más
 *      cerca del rango, y el valor sale marcado como ESTIMADO. Es lo que se
 *      hace en la poyata y lo que recogen las normas de recuento en placa, que
 *      piden dar una estimación señalada en vez de un hueco. Borrar la muestra
 *      sería peor: desaparece sin que nadie se entere.
 *
 * La lista `estimated` dice qué valores son del escalón 2, para que la
 * interfaz los marque y el generador de métodos lo pueda decir.
 *
 * @param {Array<Object>} countRows Filas de `buildCountSheet` con `colonias`.
 * @param {{volumePlated?:number, volumeUnit?:string, dilutionMode?:string,
 *          sampleIdKey?:string, range?:[number,number]}} [opts]
 *   range: rango contable, por defecto `DEFAULT_COUNTABLE_RANGE` (30-300).
 * @returns {{headers:string[], rows:Array<Object>, skipped:number,
 *            estimated:Array<{id:string, grupo:string}>,
 *            unusable:Array<{id:string, grupo:string}>}}
 */
export function collapseCounts(countRows = [], opts = {}) {
  const idKey = opts.sampleIdKey || 'sample-id';
  const volumeMl = volumeInMl(opts.volumePlated ?? 100, opts.volumeUnit ?? 'ul');
  const mode = opts.dilutionMode || 'exp';
  const [rangeMin, rangeMax] = opts.range || DEFAULT_COUNTABLE_RANGE;
  const inCountableRange = (c) => c >= rangeMin && c <= rangeMax;

  // id -> grupo -> dilución -> [{colonies, cfu}]
  const bySample = new Map();
  const groups = [];
  let skipped = 0;

  for (const r of countRows) {
    const group = String(r.grupo ?? '');
    if (group && !groups.includes(group)) groups.push(group);

    // La muestra se registra ANTES de mirar si la placa sirve: la fila tiene
    // que existir aunque todas sus placas estén fuera de rango.
    const id = String(r[idKey] ?? '');
    if (!bySample.has(id)) bySample.set(id, {});
    const g = bySample.get(id);
    if (!g[group]) g[group] = new Map();

    // Ojo con el hueco: `Number('')` es 0, no NaN. Sin este guardia, una
    // casilla sin rellenar se leería como "cero colonias" y entraría en la
    // media como un recuento real. Un hueco es ausencia de dato, no un cero.
    const rawColonies = String(r.colonias ?? '').trim().replace(',', '.');
    const colonies = rawColonies === '' ? NaN : Number(rawColonies);
    if (!Number.isFinite(colonies)) { skipped++; continue; }

    const rawDil = String(r.dilucion ?? '').replace(/^1e/i, '');
    const factor = dilutionFactor(mode, rawDil);
    const cfu = cfuPerMl(colonies, volumeMl, factor);
    if (!Number.isFinite(cfu)) { skipped++; continue; }

    const key = String(r.dilucion ?? '');
    if (!g[group].has(key)) g[group].set(key, []);
    g[group].get(key).push({ colonies, cfu });
  }

  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  /** Distancia del recuento medio de una dilución al rango contable. */
  const distanceToRange = (c) => (c < rangeMin ? rangeMin - c
    : (c > rangeMax ? c - rangeMax : 0));

  const estimated = [];
  const unusable = [];
  const rows = [];

  for (const [id, byGroup] of bySample.entries()) {
    const row = { [idKey]: id };
    for (const grp of groups) {
      const byDil = byGroup[grp];
      const header = `${grp} (UFC/mL)`;
      if (!byDil || byDil.size === 0) { row[header] = ''; unusable.push({ id, grupo: grp }); continue; }

      const inRange = [];
      byDil.forEach((plates) => {
        plates.forEach((pl) => {
          if (inCountableRange(pl.colonies)) inRange.push(pl.cfu);
        });
      });

      if (inRange.length) {
        row[header] = mean(inRange);
        skipped += [...byDil.values()].reduce((n, p) => n + p.length, 0) - inRange.length;
        continue;
      }

      // Ninguna en rango: la dilución menos mala, promediada y marcada.
      let best = null;
      let bestDist = Infinity;
      byDil.forEach((plates) => {
        const d = distanceToRange(mean(plates.map((p) => p.colonies)));
        if (d < bestDist) { bestDist = d; best = plates; }
      });
      if (!best || !best.length) { row[header] = ''; unusable.push({ id, grupo: grp }); continue; }
      row[header] = mean(best.map((p) => p.cfu));
      estimated.push({ id, grupo: grp });
      skipped += [...byDil.values()].reduce((n, p) => n + p.length, 0) - best.length;
    }
    rows.push(row);
  }

  return {
    headers: [idKey, ...groups.map((g) => `${g} (UFC/mL)`)],
    rows,
    skipped,
    estimated,
    unusable,
  };
}
