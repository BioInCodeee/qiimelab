// Etiquetas de las unidades experimentales y orden de colocación.
//
// Dos cosas que parecen menores y no lo son:
//
//   - Una etiqueta tiene que CABER en un tubo. Por eso cada nivel puede llevar
//     una abreviatura ("Bacteria antagonista 1" → "B1") y la plantilla la usa
//     en lugar del nombre largo.
//   - Dos unidades distintas NO pueden compartir etiqueta. Si la plantilla del
//     usuario genera duplicados, se señalan y se deja que los arregle él: no
//     se le añade un sufijo por detrás, porque entonces la etiqueta del tubo
//     deja de coincidir con la que él tiene en la cabeza.

import { mulberry32 } from './phyloBootstrap.js';

/** Plantilla por defecto: los factores en orden, el tiempo y la réplica. */
export const DEFAULT_TEMPLATE_TOKENS = ['{tiempo}', '{replica}', '{n}'];

/**
 * Fichas disponibles para la plantilla, dado un diseño expandido.
 * @returns {string[]} p. ej. ['{Cepa}', '{Temperatura}', '{tiempo}', '{replica}', '{n}']
 */
export function availableTokens(effectiveFactors = [], hasTimepoints = false) {
  const tokens = effectiveFactors.map((f) => `{${f.name}}`);
  if (hasTimepoints) tokens.push('{tiempo}');
  tokens.push('{replica}', '{n}');
  return tokens;
}

/** Plantilla por defecto para un diseño dado. */
export function defaultTemplate(effectiveFactors = [], hasTimepoints = false) {
  const parts = effectiveFactors.map((f) => `{${f.name}}`);
  if (hasTimepoints) parts.push('{tiempo}');
  parts.push('R{replica}');
  return parts.join('-');
}

/**
 * Sustituye las fichas de la plantilla con los valores de una unidad.
 * @param {string} template
 * @param {Object} unit Unidad de `expandDesign`.
 * @param {{abbrev?:Object, ordinal?:number}} [opts]
 *   abbrev: {NombreFactor: {nivel: 'abreviatura'}}
 *   ordinal: valor de `{n}`; si falta se usa unit.index + 1.
 * @returns {string}
 */
export function renderLabel(template, unit, opts = {}) {
  const abbrev = opts.abbrev || {};
  const ordinal = Number.isFinite(opts.ordinal) ? opts.ordinal : (unit.index ?? 0) + 1;
  return String(template).replace(/\{([^{}]+)\}/g, (match, rawName) => {
    const name = rawName.trim();
    if (name === 'replica') return String(unit.replicate ?? '');
    if (name === 'n') return String(ordinal);
    if (name === 'tiempo') {
      const t = unit.timepoint;
      if (t == null) return '';
      return String(abbrev.tiempo?.[t] ?? t);
    }
    if (unit.levels && Object.prototype.hasOwnProperty.call(unit.levels, name)) {
      const level = unit.levels[name];
      return String(abbrev[name]?.[level] ?? level);
    }
    return match; // ficha desconocida: se deja tal cual para que se vea el fallo
  });
}

/**
 * Etiquetas de todas las unidades, con detección de duplicados.
 * @returns {{labels:string[], duplicates:Array<{label:string, indices:number[]}>,
 *            unique:boolean}}
 */
export function buildLabels(units = [], template = '', opts = {}) {
  const labels = units.map((u, i) => renderLabel(template, u, { ...opts, ordinal: i + 1 }));
  const seen = new Map();
  labels.forEach((l, i) => {
    if (!seen.has(l)) seen.set(l, []);
    seen.get(l).push(i);
  });
  const duplicates = [...seen.entries()]
    .filter(([, idx]) => idx.length > 1)
    .map(([label, indices]) => ({ label, indices }));
  return { labels, duplicates, unique: duplicates.length === 0 };
}

/**
 * Orden de colocación aleatorizado, reproducible por semilla.
 *
 * Aleatorizar la posición en la estufa no es un capricho estadístico: una
 * estufa tiene gradientes térmicos reales entre balda y balda y entre fondo y
 * puerta, y colocar todos los controles juntos en la misma esquina confunde el
 * tratamiento con la posición. La semilla se guarda y se exporta para que el
 * orden pueda escribirse en Métodos y reproducirse.
 *
 * Fisher-Yates con `mulberry32`, que ya está en el repo y es reproducible.
 *
 * @returns {{order:number[], seed:number}} order[k] = índice de la unidad que
 *   va en la posición k.
 */
export function randomizeOrder(units = [], seed = 1) {
  const s = Math.floor(Number(seed)) || 1;
  const rnd = mulberry32(s);
  const order = units.map((u, i) => (Number.isFinite(u?.index) ? u.index : i));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { order, seed: s };
}

/** Semilla al azar para ofrecer una por defecto en la interfaz. */
export function randomSeed() {
  return Math.floor(Math.random() * 1e9) + 1;
}
