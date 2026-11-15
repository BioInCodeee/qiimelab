// Del diseño expandido a la tabla de metadatos que el resto de Smart-175 ya
// sabe leer.
//
// Esta es la pieza que une las dos puntas de la app: el usuario planifica el
// ensayo en #/diseno, y meses después el MISMO archivo es el que #/alpha,
// #/beta, #/recuentos o #/antagonismo cargan para agrupar las muestras. Sin
// teclear nada dos veces.
//
// Por eso aquí NO se inventa un formato: se produce exactamente lo que
// `classifyTable` de ingest.js reconoce como metadatos, que es
// `{headers, rows, sampleIdKey}` con la primera columna haciendo de id.
//
// Dos restricciones del lector que condicionan lo que se escribe, y que no son
// obvias leyendo solo este archivo:
//
//   1. La primera cabecera tiene que normalizar a "sampleid", "id" o "sample"
//      (`normalizeHeader` quita todo lo que no sea letra o número). Por eso la
//      columna se llama `sample-id`, igual que en los datos de ejemplo y que
//      en la convención de QIIME2. Cambiarle el nombre rompe la detección.
//
//   2. `classifyTable` prueba "tabla de conteos taxón × muestra" ANTES que
//      "metadatos", y esa rama se queda con cualquier tabla cuya primera
//      columna sea texto y cuyo resto sea numérico en más del 90 %. Un diseño
//      con factores numéricos (temperatura, pH, concentración) más réplica y
//      posición podría caer ahí. Se evita emitiendo SIEMPRE columnas de texto
//      (`unidad`, `medio`, `recipiente`), que bajan esa fracción muy por
//      debajo del umbral. No quites esas columnas sin volver a mirar esto; hay
//      un test que lo vigila.

import { toDelimitedText } from './csv.js';

/** Nombre de la columna identificadora. No cambiar sin leer la nota de arriba. */
export const SAMPLE_ID_HEADER = 'sample-id';

/** Columnas que escribe este módulo además de las de los factores. */
export const RESERVED_HEADERS = [
  'replica', 'tiempo', 'unidad', 'medio', 'recipiente', 'posicion', 'bloque', 'pocillo',
];

export const METADATA_WARN = {
  DUPLICATE_IDS: 'duplicateIds',   // dos unidades con la misma etiqueta
  RENAMED_HEADERS: 'renamedHeaders', // un factor chocaba con una columna reservada
};

/**
 * Deja un nombre de factor utilizable como cabecera: sin delimitadores, sin
 * comillas y sin espacios de sobra. No se transcribe a ASCII — los acentos no
 * molestan al lector y el usuario reconoce mejor su propia columna.
 */
export function sanitizeHeader(name) {
  return String(name ?? '')
    .replace(/[\t\r\n",]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cabeceras únicas: si dos factores se llaman igual tras sanearlos, o si uno
 * choca con una columna reservada, se desambigua con un sufijo numérico.
 * @returns {{headers:string[], renamed:boolean}}
 */
export function uniqueHeaders(names, taken = []) {
  const used = new Set(taken);
  const out = [];
  let renamed = false;
  for (const raw of names) {
    const base = sanitizeHeader(raw) || 'factor';
    let name = base;
    let k = 2;
    while (used.has(name)) { name = `${base}_${k++}`; renamed = true; }
    used.add(name);
    out.push(name);
  }
  return { headers: out, renamed };
}

/**
 * Construye la tabla de metadatos.
 *
 * @param {Object} expansion Salida de `expandDesign`.
 * @param {Object} opts
 * @param {string[]} opts.labels Etiquetas por unidad, de `buildLabels`. Son los
 *   identificadores de muestra, así que tienen que ser únicas.
 * @param {number[]} [opts.order] Orden aleatorizado de `randomizeOrder`:
 *   order[k] = índice de la unidad que va en la posición k. Si falta, la
 *   posición es el orden natural.
 * @param {string} [opts.unitType='unidad'] Tipo de unidad experimental
 *   (matraz, placa, tubo, pocillo). Columna de texto SIEMPRE presente.
 * @param {Array<Array<{medium:string}>>} [opts.unitLayers] Capas de cada
 *   unidad; se escriben unidas por "+" (una bicapa queda "Agua-agar+PDA").
 * @param {string|string[]} [opts.container] Recipiente, uno para todas o uno
 *   por unidad (p. ej. "Erlenmeyer 250 mL").
 * @param {string[]} [opts.wells] Pocillo de cada unidad, si el ensayo va en
 *   microplaca (de `autofillFromDesign`). Añade la columna `pocillo`.
 * @param {{blocks:number, perBlock:number}} [opts.blockPlan] Si el ensayo va
 *   por tandas, el bloque entra como columna: dos tandas en días distintos no
 *   son intercambiables y el análisis tiene que poder incluirlo como factor.
 * @returns {{headers:string[], rows:Array<Object>, sampleIdKey:string,
 *            warnings:string[]}}
 */
export function buildMetadata(expansion, opts = {}) {
  const units = expansion?.units || [];
  const factors = expansion?.effectiveFactors || [];
  const labels = opts.labels || units.map((u, i) => `U${i + 1}`);
  const warnings = [];

  const hasTime = units.some((u) => u.timepoint != null);
  const hasBlocks = !!(opts.blockPlan && opts.blockPlan.blocks > 1);

  const hasWells = Array.isArray(opts.wells) && opts.wells.length > 0;

  const reserved = ['replica', 'unidad', 'medio', 'recipiente', 'posicion'];
  if (hasTime) reserved.splice(1, 0, 'tiempo');
  if (hasBlocks) reserved.push('bloque');
  if (hasWells) reserved.push('pocillo');

  const { headers: factorHeaders, renamed } = uniqueHeaders(
    factors.map((f) => f.name),
    [SAMPLE_ID_HEADER, ...reserved],
  );
  if (renamed) warnings.push(METADATA_WARN.RENAMED_HEADERS);

  const headers = [SAMPLE_ID_HEADER, ...factorHeaders, ...reserved];

  // posición de cada unidad en el orden aleatorizado
  const position = new Map();
  if (Array.isArray(opts.order) && opts.order.length) {
    opts.order.forEach((unitIndex, k) => position.set(unitIndex, k + 1));
  }

  const containerOf = (i) => (Array.isArray(opts.container)
    ? opts.container[i] : opts.container) ?? '';

  const rows = units.map((u, i) => {
    const row = { [SAMPLE_ID_HEADER]: labels[i] ?? `U${i + 1}` };
    factors.forEach((f, k) => { row[factorHeaders[k]] = u.levels?.[f.name] ?? ''; });
    row.replica = u.replicate ?? '';
    if (hasTime) row.tiempo = u.timepoint ?? '';
    row.unidad = opts.unitType || 'unidad';
    const layers = opts.unitLayers?.[i] || [];
    row.medio = layers.map((l) => l.medium).join('+');
    row.recipiente = containerOf(i);
    const pos = position.has(u.index) ? position.get(u.index) : i + 1;
    row.posicion = pos;
    if (hasBlocks) row.bloque = Math.ceil(pos / opts.blockPlan.perBlock);
    if (hasWells) row.pocillo = opts.wells[i] ?? '';
    return row;
  });

  const ids = rows.map((r) => r[SAMPLE_ID_HEADER]);
  if (new Set(ids).size !== ids.length) warnings.push(METADATA_WARN.DUPLICATE_IDS);

  return { headers, rows, sampleIdKey: SAMPLE_ID_HEADER, warnings };
}

/**
 * Texto del archivo de metadatos, listo para descargar o para volver a cargar
 * en la propia app. TSV por defecto, que es lo que usa QIIME2.
 */
export function metadataText(meta, delimiter = '\t') {
  return toDelimitedText(meta.headers, meta.rows, delimiter);
}
