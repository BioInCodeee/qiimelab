// Aritmética del recuento en placa, compartida por la calculadora de UFC/mL
// (#/recuentos?tab=calc) y por el contador de colonias sobre foto
// (#/recuentos?tab=foto). Vive aquí para que la fórmula exista UNA sola vez:
//
//   UFC/mL = colonias contadas / (volumen sembrado en mL × factor de dilución)
//
// El factor de dilución es la fracción de muestra original que queda en lo
// sembrado (10⁻³ = 0,001), así que dividir por él multiplica por 1000 — es la
// forma en la que se escribe en los protocolos de microbiología.

/** Modos en los que el usuario puede escribir la dilución de cada placa:
 *   exp    -> 10^(-n)          (n = 3     →  10⁻³)
 *   factor -> el número tal cual (0.001)
 *   ratio  -> 1 : X            (X = 1000  →  1/1000)
 */
export const DIL_MODES = ['exp', 'factor', 'ratio'];

/** Número tolerante con la coma decimal; NaN si no hay nada utilizable. */
export function num(v) {
  const s = String(v == null ? '' : v).trim().replace(',', '.');
  if (s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Factor de dilución (fracción de muestra original en lo sembrado).
 * @param {string} mode Uno de DIL_MODES.
 * @param {string|number} raw Lo que escribió el usuario.
 * @returns {number} NaN si no es interpretable.
 */
export function dilutionFactor(mode, raw) {
  const v = num(raw);
  if (!Number.isFinite(v)) return NaN;
  if (mode === 'exp') return Math.pow(10, -Math.abs(v));
  if (mode === 'ratio') return v > 0 ? 1 / v : NaN;
  return v > 0 ? v : NaN; // factor directo
}

/** Unidades admitidas para el volumen sembrado, con su equivalencia en mL. */
export const VOLUME_UNITS = { ul: 0.001, ml: 1, l: 1000 };

/**
 * Volumen sembrado en mL a partir del valor y su unidad.
 * @param {string|number} value
 * @param {'ul'|'ml'|'l'} unit
 * @returns {number} NaN si el valor no es un volumen positivo.
 */
export function volumeInMl(value, unit = 'ml') {
  const v = num(value);
  const k = VOLUME_UNITS[unit];
  if (!Number.isFinite(v) || v <= 0 || !k) return NaN;
  return v * k;
}

/**
 * UFC/mL de una placa.
 * @param {number} colonies Colonias contadas (entero ≥ 0).
 * @param {number} volumeMl Volumen sembrado, en mL.
 * @param {number} factor Factor de dilución (p. ej. 0.001 para 10⁻³).
 * @returns {number} NaN si falta algún dato o no es válido.
 */
export function cfuPerMl(colonies, volumeMl, factor) {
  const n = num(colonies);
  if (!Number.isFinite(n) || n < 0) return NaN;
  if (!Number.isFinite(volumeMl) || volumeMl <= 0) return NaN;
  if (!Number.isFinite(factor) || factor <= 0) return NaN;
  return n / (volumeMl * factor);
}

// Rango recomendado de colonias por placa para que el recuento sea fiable.
// Por debajo el error de Poisson domina, por encima la competencia entre
// colonias y el solapamiento hacen que se cuente de menos (criterio clásico
// del recuento en placa estándar: 25-250 / 30-300 según la norma).
export const PLATE_MIN_RELIABLE = 25;
export const PLATE_MAX_RELIABLE = 250;

/**
 * Aviso sobre la fiabilidad del recuento según el nº de colonias de la placa.
 * @param {number} colonies
 * @returns {'ok'|'low'|'high'|'none'}
 */
export function plateReliability(colonies) {
  const n = num(colonies);
  if (!Number.isFinite(n)) return 'none';
  if (n < PLATE_MIN_RELIABLE) return 'low';
  if (n > PLATE_MAX_RELIABLE) return 'high';
  return 'ok';
}
