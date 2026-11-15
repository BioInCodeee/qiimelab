// Métricas de los dos ensayos de #/antagonismo. Solo aritmética y
// validaciones: no toca imágenes ni DOM, y por eso se puede testear entera
// contra números a mano.
//
// La geometría (mm/px, elipses, detección de bordes) está en
// plateMetrology.js.
//
// Lo que este archivo NO hace, y es deliberado: no interpreta sensible /
// intermedio / resistente. No hay aquí, ni debe añadirse, ninguna tabla de
// puntos de corte CLSI, EUCAST ni equivalente. Son tablas propietarias, se
// revisan cada año, dependen de especie, agente y método, y exigen
// condiciones estandarizadas (medio, densidad de siembra, temperatura, tiempo) que una
// foto no puede verificar. Rotular «Sensible» a partir de una foto de móvil
// invitaría a un uso clínico que esta app no puede respaldar. El usuario
// puede teclear SUS propios puntos de corte, y entonces se usan solo para
// colorear la tabla, nunca para emitir una conclusión.

/** Códigos de aviso. Son claves i18n, no texto. */
export const WARN = {
  EDGE_CENSORED: 'edgeCensored',       // el micelio llegó a la pared de la placa
  REACHED_SOURCE: 'reachedSource',     // el micelio alcanzó el cilindro: no hay zona libre
  CONTROL_ASYMMETRIC: 'controlAsym',   // el control creció elíptico: simetría dudosa
  NO_GROWTH: 'noGrowth',               // no hay crecimiento medible
  GROWTH_STIMULATED: 'stimulated',     // PICR negativo: creció MÁS hacia el antagonista
  PICR_DISCREPANCY: 'picrDiscrepancy', // misma placa y control discrepan mucho
  OVERLAP: 'overlap',                  // halos solapados
  NO_INHIBITION: 'noInhibition',       // halo <= objeto de referencia
};

/**
 * Porcentaje de inhibición del crecimiento radial.
 *
 *   PICR = (rRef - rFacing) / rRef * 100
 *
 * El valor NO se recorta a cero. Un PICR negativo significa que el hongo
 * creció más hacia el antagonista que en la dirección de referencia, y eso es
 * estímulo del crecimiento: un resultado real, que se da en antagonismo y que
 * hay que poder reportar. Recortarlo sería inventarse el dato.
 *
 * @returns {number|null} null si el radio de referencia no es utilizable.
 */
export function picr(rRef, rFacing) {
  const ref = Number(rRef);
  const facing = Number(rFacing);
  if (!(ref > 0) || !Number.isFinite(facing) || facing < 0) return null;
  return ((ref - facing) / ref) * 100;
}

/**
 * Anchura de la zona de inhibición: hueco entre el borde del micelio y el
 * borde del objeto de referencia (cilindro, pocillo o disco), en mm.
 *
 * Se reporta aparte del PICR porque es otra cosa: el PICR dice cuánto se ha
 * frenado el hongo, el hueco dice si queda zona limpia entre los dos. Un
 * hueco de cero con PICR alto es un resultado perfectamente posible.
 *
 * @param {number} rFacingMm Radio del micelio hacia el antagonista.
 * @param {number} centerToSourceMm Distancia del punto de siembra al centro
 *   del objeto de referencia.
 * @param {number} sourceRadiusMm Radio del objeto de referencia.
 * @returns {number|null} Puede ser negativo si el micelio ha invadido el
 *   objeto; el llamante lo interpreta como «sin zona de inhibición».
 */
export function inhibitionGap(rFacingMm, centerToSourceMm, sourceRadiusMm) {
  const r = Number(rFacingMm);
  const d = Number(centerToSourceMm);
  const s = Number(sourceRadiusMm);
  if (![r, d, s].every(Number.isFinite)) return null;
  return d - s - r;
}

/**
 * Un enfrentamiento completo: un antagonista contra un hongo en una placa.
 *
 * Todas las longitudes en mm. `rControlMm` es opcional: si se pasa, viene de
 * una placa marcada como control (hongo solo) y es la referencia preferible,
 * porque el modo «misma placa» asume que sin antagonista el crecimiento
 * habría sido simétrico, y eso no siempre es verdad.
 *
 * @param {Object} p
 * @param {number} p.rFacingMm Radio del micelio hacia el antagonista.
 * @param {number} p.rFreeMm Radio del micelio en la dirección libre.
 * @param {number} [p.rControlMm] Radio medio del micelio en la placa control.
 * @param {number} p.centerToSourceMm Siembra → centro del objeto.
 * @param {number} p.sourceRadiusMm Radio del objeto de referencia.
 * @param {number} p.plateRadiusMm Radio útil de la placa.
 * @param {number} [p.controlAxisRatio] Relación de semiejes del micelio
 *   control (1 = redondo).
 * @param {boolean} [p.freeCensored] El rayo libre llegó al límite de la ROI.
 * @param {boolean} [p.noGrowth] El campo no tenía contraste utilizable.
 * @returns {{picrSamePlate:number|null, picrVsControl:number|null,
 *            picrPreferred:number|null, preferredSource:'control'|'samePlate'|null,
 *            gapMm:number|null, measurable:boolean, warnings:string[]}}
 */
export function confrontation(p = {}) {
  const warnings = [];
  const {
    rFacingMm, rFreeMm, rControlMm, centerToSourceMm, sourceRadiusMm,
    plateRadiusMm, controlAxisRatio, freeCensored = false, noGrowth = false,
    edgeMarginMm = 2, asymmetryTolerance = 0.1, discrepancyPoints = 15,
  } = p;

  if (noGrowth) {
    return {
      picrSamePlate: null, picrVsControl: null, picrPreferred: null,
      preferredSource: null, gapMm: null, measurable: false,
      warnings: [WARN.NO_GROWTH],
    };
  }

  // El micelio ha llegado a la pared: rLibre está cortado por el plástico, no
  // por la biología. El PICR saldría infravalorado y la placa no es medible.
  // Es el fallo más fácil de pasar por alto de todo el ensayo, así que aquí no
  // se devuelve un número: se bloquea.
  const nearEdge = Number.isFinite(rFreeMm) && Number.isFinite(plateRadiusMm)
    && rFreeMm >= plateRadiusMm - edgeMarginMm;
  if (freeCensored || nearEdge) warnings.push(WARN.EDGE_CENSORED);

  const samePlate = picr(rFreeMm, rFacingMm);
  const vsControl = Number.isFinite(rControlMm) ? picr(rControlMm, rFacingMm) : null;

  const gapMm = inhibitionGap(rFacingMm, centerToSourceMm, sourceRadiusMm);
  if (gapMm != null && gapMm <= 0) warnings.push(WARN.REACHED_SOURCE);

  if (Number.isFinite(controlAxisRatio) && (1 - controlAxisRatio) > asymmetryTolerance) {
    warnings.push(WARN.CONTROL_ASYMMETRIC);
  }

  if (samePlate != null && vsControl != null
      && Math.abs(samePlate - vsControl) > discrepancyPoints) {
    // No es un error: significa que el hongo no crecía simétrico. Es
    // información sobre el ensayo y hay que mostrarla, no esconderla.
    warnings.push(WARN.PICR_DISCREPANCY);
  }

  const preferredSource = vsControl != null ? 'control' : (samePlate != null ? 'samePlate' : null);
  const picrPreferred = vsControl != null ? vsControl : samePlate;

  if (picrPreferred != null && picrPreferred < 0) warnings.push(WARN.GROWTH_STIMULATED);

  const measurable = picrPreferred != null
    && !warnings.includes(WARN.EDGE_CENSORED)
    && !warnings.includes(WARN.NO_GROWTH);

  return {
    picrSamePlate: samePlate,
    picrVsControl: vsControl,
    picrPreferred,
    preferredSource,
    gapMm,
    measurable,
    warnings,
  };
}

/**
 * Un halo de difusión, medido con los dos diámetros perpendiculares que se
 * toman en el laboratorio.
 *
 * El diámetro del halo INCLUYE el disco o cilindro, que es la convención
 * estándar. Por eso un halo igual o menor que el objeto de referencia no es
 * un halo pequeño: es ausencia de inhibición, y se marca como tal en vez de
 * devolver un número que se confundiría con una medida real.
 *
 * `deltaMm` (la diferencia entre los dos diámetros) es el indicador de que el
 * halo no era redondo o de que se midió mal, y se reporta siempre.
 *
 * @returns {{meanMm:number|null, deltaMm:number|null, inhibition:boolean,
 *            warnings:string[]}}
 */
export function halo({ d1Mm, d2Mm, referenceDiameterMm } = {}) {
  const warnings = [];
  const d1 = Number(d1Mm);
  const d2 = Number(d2Mm);
  const haveBoth = Number.isFinite(d1) && Number.isFinite(d2);
  const mean = haveBoth ? (d1 + d2) / 2 : (Number.isFinite(d1) ? d1 : (Number.isFinite(d2) ? d2 : null));
  const delta = haveBoth ? Math.abs(d1 - d2) : null;

  const ref = Number(referenceDiameterMm);
  let inhibition = mean != null;
  if (mean != null && Number.isFinite(ref) && mean <= ref) {
    inhibition = false;
    warnings.push(WARN.NO_INHIBITION);
  }

  return { meanMm: mean, deltaMm: delta, inhibition, warnings };
}

/**
 * Halos que se solapan entre sí. Cuando dos zonas se tocan, ninguna de las
 * dos es medible por ningún método: el borde que se ve es la intersección de
 * dos gradientes de difusión, no el límite de inhibición de cada agente.
 *
 * @param {Array<{x:number, y:number, radiusMm:number, mmPerPx?:number}>} halos
 *   Posiciones en mm (si se pasan en px, conviértelas antes).
 * @returns {Array<[number, number]>} Pares de índices que solapan.
 */
export function overlappingHalos(halos) {
  const list = halos || [];
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (!a || !b) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < (Number(a.radiusMm) || 0) + (Number(b.radiusMm) || 0)) pairs.push([i, j]);
    }
  }
  return pairs;
}

/**
 * Redondeo de presentación. La precisión real de una medida de halo sobre
 * foto es de unos ±0,5 mm, así que imprimir «23,47 mm» es fingir una
 * exactitud que no existe: una cifra decimal es el máximo honesto.
 */
export function formatMm(value, decimals = 1) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}
