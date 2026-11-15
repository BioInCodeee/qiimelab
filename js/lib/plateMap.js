// Mapas de microplaca: direccionamiento de pocillos, relleno y conversión a
// tabla. Solo lógica, sin DOM: el dibujo de la rejilla va en el módulo.
//
// La nomenclatura es la estándar de laboratorio: letra de fila y número de
// columna, empezando en A1 arriba a la izquierda. Con 384 pocillos hacen falta
// 16 filas (A–P), que siguen cabiendo en una letra; por encima de 26 filas
// haría falta notación de dos letras, y como no existe ese formato comercial,
// aquí se rechaza en vez de inventarse una.

/** Formatos comerciales: pocillos → rejilla. */
export const PLATE_FORMATS = {
  6: { rows: 2, cols: 3 },
  12: { rows: 3, cols: 4 },
  24: { rows: 4, cols: 6 },
  48: { rows: 6, cols: 8 },
  96: { rows: 8, cols: 12 },
  384: { rows: 16, cols: 24 },
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Rejilla de un formato. Lanza si el formato no existe. */
export function plateGrid(format) {
  const g = PLATE_FORMATS[Number(format)];
  if (!g) throw new Error(`Formato de placa no soportado: ${format}`);
  return g;
}

/**
 * Identificador de un pocillo a partir de fila y columna (ambas base 0).
 * @returns {string} p. ej. (0,0) → "A1", (7,11) → "H12"
 */
export function wellId(row, col) {
  if (!(row >= 0) || !(col >= 0) || row >= LETTERS.length) return null;
  return LETTERS[row] + String(col + 1);
}

/**
 * Fila y columna (base 0) de un identificador.
 * @returns {{row:number, col:number}|null}
 */
export function parseWellId(id) {
  const m = /^([A-Za-z])(\d+)$/.exec(String(id || '').trim());
  if (!m) return null;
  const row = LETTERS.indexOf(m[1].toUpperCase());
  const col = Number(m[2]) - 1;
  if (row < 0 || col < 0) return null;
  return { row, col };
}

/**
 * Todos los pocillos del formato, en orden de lectura (por filas).
 * @returns {string[]}
 */
export function allWells(format) {
  const { rows, cols } = plateGrid(format);
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(wellId(r, c));
  return out;
}

/**
 * Pocillos de un bloque rectangular definido por dos esquinas, en cualquier
 * orden. Es lo que produce arrastrar el ratón sobre la rejilla.
 * @param {number|string} format
 * @param {string} cornerA p. ej. "B2"
 * @param {string} cornerB p. ej. "D5"
 * @param {{direction?:'row'|'column'}} [opts] Orden en que se devuelven.
 * @returns {string[]}
 */
export function wellsInBlock(format, cornerA, cornerB, opts = {}) {
  const { rows, cols } = plateGrid(format);
  const a = parseWellId(cornerA);
  const b = parseWellId(cornerB);
  if (!a || !b) return [];
  const r0 = Math.max(0, Math.min(a.row, b.row));
  const r1 = Math.min(rows - 1, Math.max(a.row, b.row));
  const c0 = Math.max(0, Math.min(a.col, b.col));
  const c1 = Math.min(cols - 1, Math.max(a.col, b.col));
  const out = [];
  if (opts.direction === 'column') {
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) out.push(wellId(r, c));
  } else {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(wellId(r, c));
  }
  return out;
}

/**
 * Serie numerada sobre una lista de pocillos: "STD 1", "STD 2"…
 *
 * La dirección importa de verdad: una curva patrón se carga por columnas y una
 * serie de muestras por filas, y equivocarse ahí significa tener la placa bien
 * dibujada en la pantalla y mal cargada en la poyata.
 *
 * @param {string[]} wells Pocillos ya en el orden deseado.
 * @param {{prefix?:string, start?:number, step?:number, pad?:number}} [opts]
 * @returns {Object} {pocillo: etiqueta}
 */
export function fillSeries(wells, opts = {}) {
  const prefix = opts.prefix ?? '';
  const start = Number.isFinite(opts.start) ? opts.start : 1;
  const step = Number.isFinite(opts.step) ? opts.step : 1;
  const pad = Number.isFinite(opts.pad) ? opts.pad : 0;
  const out = {};
  wells.forEach((w, i) => {
    const n = start + i * step;
    out[w] = prefix + String(n).padStart(pad, '0');
  });
  return out;
}

/**
 * Mismo valor en todos los pocillos dados. Para "todo esto es Control".
 * @returns {Object} {pocillo: etiqueta}
 */
export function fillConstant(wells, label) {
  const out = {};
  wells.forEach((w) => { out[w] = label; });
  return out;
}

/**
 * Reparte las unidades de un diseño por la placa.
 *
 * Respeta el orden que se le pase (normalmente el aleatorizado de
 * `randomizeOrder`), porque colocar los controles siempre en la columna 1
 * confunde el tratamiento con la posición igual que en la estufa: los bordes
 * de una microplaca se evaporan más que el centro.
 *
 * @param {number|string} format
 * @param {string[]} labels Etiquetas de las unidades, en orden de unidad.
 * @param {{order?:number[], wells?:string[]}} [opts]
 *   order: order[k] = índice de la unidad que va en la posición k.
 *   wells: subconjunto de pocillos utilizables (p. ej. excluyendo el borde).
 * @returns {{assignments:Object, placed:number, overflow:number}}
 *   assignments: {pocillo: etiqueta}. overflow: unidades que no caben.
 */
export function autofillFromDesign(format, labels = [], opts = {}) {
  const wells = opts.wells && opts.wells.length ? opts.wells : allWells(format);
  const order = Array.isArray(opts.order) && opts.order.length
    ? opts.order
    : labels.map((_, i) => i);
  const assignments = {};
  let placed = 0;
  order.forEach((unitIndex, k) => {
    if (k >= wells.length) return;
    const label = labels[unitIndex];
    if (label == null) return;
    assignments[wells[k]] = label;
    placed++;
  });
  return { assignments, placed, overflow: Math.max(0, order.length - wells.length) };
}

/**
 * Pocillos del borde de la placa. Se excluyen a menudo en ensayos largos
 * porque se evaporan más que el resto, y entonces la placa "de 96" tiene 60
 * pocillos útiles.
 */
export function edgeWells(format) {
  const { rows, cols } = plateGrid(format);
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) out.push(wellId(r, c));
    }
  }
  return out;
}

/** Pocillos interiores: todos menos el borde. */
export function innerWells(format) {
  const edge = new Set(edgeWells(format));
  return allWells(format).filter((w) => !edge.has(w));
}

/** Cabeceras de la tabla de un mapa de placa. */
export const PLATE_TABLE_HEADERS = ['pocillo', 'fila', 'columna', 'etiqueta', 'contenido', 'grupo', 'color'];

/**
 * Mapa → tabla. Solo salen los pocillos con algo puesto: una placa de 384 con
 * 12 pocillos usados no debe exportar 372 filas vacías.
 * @param {Object} map {pocillo: {etiqueta, contenido, grupo, color}}
 * @returns {{headers:string[], rows:Array<Object>}}
 */
export function mapToTable(map, format) {
  const rows = [];
  for (const well of allWells(format)) {
    const cell = map?.[well];
    if (!cell) continue;
    const hasContent = ['etiqueta', 'contenido', 'grupo', 'color']
      .some((k) => String(cell[k] ?? '') !== '');
    if (!hasContent) continue;
    const { row, col } = parseWellId(well);
    rows.push({
      pocillo: well,
      fila: LETTERS[row],
      columna: col + 1,
      etiqueta: cell.etiqueta ?? '',
      contenido: cell.contenido ?? '',
      grupo: cell.grupo ?? '',
      color: cell.color ?? '',
    });
  }
  return { headers: [...PLATE_TABLE_HEADERS], rows };
}

/**
 * Tabla → mapa. Las filas con un pocillo que no existe en el formato se
 * ignoran y se cuentan, en vez de colarse en un mapa imposible.
 * @returns {{map:Object, ignored:number}}
 */
export function tableToMap(rows, format) {
  const { rows: nRows, cols: nCols } = plateGrid(format);
  const map = {};
  let ignored = 0;
  for (const r of rows || []) {
    const well = String(r.pocillo ?? '').trim();
    const pos = parseWellId(well);
    if (!pos || pos.row >= nRows || pos.col >= nCols) { ignored++; continue; }
    map[well] = {
      etiqueta: r.etiqueta ?? '',
      contenido: r.contenido ?? '',
      grupo: r.grupo ?? '',
      color: r.color ?? '',
    };
  }
  return { map, ignored };
}
