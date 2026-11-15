// De la lista de unidades experimentales a la logística: cuánto medio hay que
// preparar de cada tipo, en qué matraz cabe cada cultivo y cómo se reparte el
// medio en botellas para el autoclave.
//
// Todo son volúmenes en mililitros. Sin DOM.

/** Códigos de aviso. Claves i18n, no texto. */
export const MEDIA_WARN = {
  AERATION: 'aeration',       // volumen de trabajo por encima del límite del matraz
  NO_FLASK: 'noFlask',        // no hay matraz del catálogo que sirva
  NO_BOTTLE: 'noBottle',      // no hay botella del catálogo que sirva
};

/** Matraces Erlenmeyer habituales, en mL de capacidad nominal. */
export const FLASK_SIZES = [25, 50, 100, 125, 250, 500, 1000, 2000, 5000];

/** Botellas de medio habituales, en mL. Sin la de 2 L: no está en todos los
 *  laboratorios y una botella enorme es incómoda de manejar en el autoclave.
 *  El usuario puede añadirla desde la interfaz. */
export const BOTTLE_SIZES = [100, 250, 500, 1000];

/**
 * Fracción máxima del nominal que puede ocupar un cultivo agitado aerobio.
 * Por encima de ~20 % la transferencia de oxígeno cae y el cultivo deja de
 * comportarse como aerobio, por mucho que el matraz "quepa". Es ajustable
 * porque un cultivo estático o anaerobio se llena mucho más.
 */
export const DEFAULT_AERATION_FRACTION = 0.2;

/**
 * Fracción máxima de llenado de una botella que va al autoclave. Un medio
 * lleno hasta arriba rebosa al hervir y ensucia la cámara.
 */
export const DEFAULT_AUTOCLAVE_FILL = 0.7;

/**
 * Volumen de agar por placa de Petri según diámetro, en mL. Son los órdenes
 * de magnitud de uso corriente, pensados como valores por defecto editables:
 * el espesor real depende de cuánto quiera cada uno que dure la placa.
 */
export const PLATE_AGAR_VOLUME = { 55: 8, 60: 10, 90: 20, 100: 25, 150: 60 };

/**
 * Volumen total de cada medio a partir de las capas de cada unidad.
 *
 * `unitLayers` lleva una entrada por unidad experimental, y cada entrada es la
 * lista de capas de esa unidad. Así sale gratis el caso de la bicapa (una
 * placa con agua-agar debajo y PDA encima son dos capas, y cada medio suma por
 * su cuenta) y el caso de que el medio sea uno de los factores del diseño, en
 * el que cada unidad lleva el suyo.
 *
 * @param {Array<Array<{medium:string, volume:number}>>} unitLayers
 * @param {{excessFraction?:number}} [opts] Exceso por pérdidas de pipeteo, lo
 *   que queda en la botella y las placas que salen mal. 10 % por defecto.
 * @returns {Array<{medium:string, units:number, baseVolume:number,
 *                  excessVolume:number, totalVolume:number}>}
 *   Ordenado de mayor a menor volumen.
 */
export function planMedia(unitLayers, opts = {}) {
  const excess = Number.isFinite(opts.excessFraction) ? opts.excessFraction : 0.1;
  const acc = new Map();
  for (const layers of unitLayers || []) {
    for (const layer of layers || []) {
      const name = String(layer.medium);
      const v = Number(layer.volume) || 0;
      const cur = acc.get(name) || { medium: name, units: 0, baseVolume: 0 };
      cur.units += 1;
      cur.baseVolume += v;
      acc.set(name, cur);
    }
  }
  return [...acc.values()]
    .map((m) => ({
      ...m,
      excessVolume: m.baseVolume * excess,
      totalVolume: m.baseVolume * (1 + excess),
    }))
    .sort((a, b) => b.totalVolume - a.totalVolume);
}

/**
 * ¿Es razonable este volumen de trabajo en este matraz?
 * @returns {{ok:boolean, fraction:number, warnings:string[]}}
 */
export function aerationCheck(workingVolume, nominalVolume, maxFraction = DEFAULT_AERATION_FRACTION) {
  const w = Number(workingVolume);
  const n = Number(nominalVolume);
  if (!(w > 0) || !(n > 0)) return { ok: false, fraction: NaN, warnings: [MEDIA_WARN.NO_FLASK] };
  const fraction = w / n;
  // El límite es inclusivo: 50 mL en un matraz de 250 mL es exactamente el
  // 20 % y es la recomendación de manual, no una infracción.
  const ok = fraction <= maxFraction + 1e-9;
  return { ok, fraction, warnings: ok ? [] : [MEDIA_WARN.AERATION] };
}

/**
 * Matraz más pequeño del catálogo que admite este volumen de trabajo sin
 * pasarse del límite de aireación.
 * @returns {number|null} Capacidad nominal en mL, o null si ninguno sirve.
 */
export function suggestFlask(workingVolume, opts = {}) {
  const sizes = (opts.sizes || FLASK_SIZES).slice().sort((a, b) => a - b);
  const maxFraction = Number.isFinite(opts.maxFraction) ? opts.maxFraction : DEFAULT_AERATION_FRACTION;
  const w = Number(workingVolume);
  if (!(w > 0)) return null;
  return sizes.find((s) => w <= s * maxFraction + 1e-9) ?? null;
}

/**
 * Reparto de un volumen de medio en botellas para autoclavar.
 *
 * Heurística, no óptimo, y dicho a propósito: se busca el menor número de
 * botellas, prefiriendo una botella grande a medias antes que varias pequeñas
 * llenas, porque manejar menos botellas es menos trabajo y menos riesgo de
 * contaminación. Lo que NO es negociable es el tope de llenado: ninguna
 * botella puede salir por encima de él.
 *
 * Cuando todas las botellas elegidas son del mismo tamaño, el volumen se
 * reparte a partes iguales entre ellas en vez de llenar unas al tope y dejar
 * la última con un resto: dos botellas de 1 L con 600 mL cada una se manejan
 * mejor que una con 700 y otra con 500, y pesan lo mismo.
 *
 * @returns {{bottles:Array<{size:number, fill:number}>, total:number,
 *            warnings:string[]}}
 */
export function packBottles(volume, opts = {}) {
  const sizes = (opts.sizes || BOTTLE_SIZES).slice().sort((a, b) => a - b);
  const maxFill = Number.isFinite(opts.maxFill) ? opts.maxFill : DEFAULT_AUTOCLAVE_FILL;
  const v = Number(volume);
  if (!(v > 0) || !sizes.length) return { bottles: [], total: 0, warnings: [] };

  const cap = (s) => s * maxFill;
  const chosen = [];
  let rem = v;
  let guard = 0;
  while (rem > 1e-9) {
    if (++guard > 1000) break; // red de seguridad: nunca debería hacer falta
    // ¿hay una botella que lo termine de una vez? la más pequeña que pueda
    const finisher = sizes.find((s) => cap(s) >= rem - 1e-9);
    if (finisher !== undefined) { chosen.push(finisher); rem = 0; break; }
    // si no, la más grande disponible y seguimos
    const biggest = sizes[sizes.length - 1];
    chosen.push(biggest);
    rem -= cap(biggest);
  }
  if (!chosen.length) return { bottles: [], total: 0, warnings: [MEDIA_WARN.NO_BOTTLE] };

  const allSame = chosen.every((s) => s === chosen[0]);
  let bottles;
  if (allSame) {
    const each = v / chosen.length;
    bottles = chosen.map((s) => ({ size: s, fill: each }));
  } else {
    bottles = [];
    let left = v;
    chosen.sort((a, b) => b - a);
    chosen.forEach((s, i) => {
      const fill = i === chosen.length - 1 ? left : Math.min(left, cap(s));
      bottles.push({ size: s, fill });
      left -= fill;
    });
  }

  const warnings = bottles.some((b) => b.fill > cap(b.size) + 1e-6)
    ? [MEDIA_WARN.NO_BOTTLE] : [];
  return {
    bottles,
    total: bottles.reduce((s, b) => s + b.fill, 0),
    warnings,
  };
}
