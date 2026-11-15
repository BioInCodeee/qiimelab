// Planificación de una tanda de qPCR: cuántas reacciones salen, qué controles
// hacen falta, cómo se reparten por la placa y con qué programa térmico.
//
// La mezcla de reacción NO se calcula aquí: eso ya lo hace
// `calculateMasterMix` de js/modules/labcalc.js, con su modo comercial y su
// `balanceWaterToVolume`. Este archivo solo produce el NÚMERO de reacciones
// que hay que preparar, que es el dato que a esa calculadora le falta y el que
// todo el mundo cuenta mal.
//
// Lo que se cuenta mal, en concreto: se piensa en "muestras × genes" y se
// olvidan los triplicados técnicos, los controles sin molde —uno por pareja de
// primers, no uno por placa— y, en RT-qPCR, los controles sin retrotranscriptasa,
// que son los únicos que distinguen amplificar ADN genómico de amplificar ADNc.

/** Tipos de reacción que van a la placa. */
export const REACTION = {
  SAMPLE: 'sample',
  NTC: 'ntc',          // sin molde
  RT_MINUS: 'rtMinus', // sin retrotranscriptasa
  STANDARD: 'standard',
};

/**
 * Valores por defecto. Los triplicados técnicos son la práctica habitual y la
 * curva de cinco puntos por triplicado es lo que pide una eficiencia creíble.
 */
export const DEFAULT_QPCR_PLAN = {
  technicalReplicates: 3,
  ntcPerTarget: 2,
  rtMinus: false,          // ponlo a true en RT-qPCR
  rtMinusPerSample: 1,
  standardCurve: false,
  standardPoints: 5,
  standardReplicates: 3,
};

export const PLAN_WARN = {
  NO_NTC: 'planNoNtc',
  NO_RT_MINUS: 'planNoRtMinus',
  NO_STANDARD: 'planNoStandard',
  SINGLE_REPLICATE: 'planSingleReplicate',
  OVERFLOW: 'planOverflow',
};

/**
 * Reacciones de una tanda, desglosadas por diana.
 *
 * @param {Object} cfg
 * @param {string[]} cfg.samples
 * @param {string[]} cfg.targets Dianas, incluidos los genes de referencia.
 * @param {Object} [cfg.plan] Mezclado con `DEFAULT_QPCR_PLAN`.
 * @returns {{perTarget:Array, reactions:Array, total:number, warnings:string[]}}
 */
export function reactionPlan(cfg = {}) {
  const p = { ...DEFAULT_QPCR_PLAN, ...(cfg.plan || {}) };
  const samples = (cfg.samples || []).filter((s) => String(s).trim() !== '');
  const targets = (cfg.targets || []).filter((t) => String(t).trim() !== '');
  const reps = Math.max(1, Math.floor(p.technicalReplicates));

  const reactions = [];
  const perTarget = targets.map((target) => {
    const start = reactions.length;
    for (const sample of samples) {
      for (let r = 1; r <= reps; r++) {
        reactions.push({ kind: REACTION.SAMPLE, target, sample, replicate: r });
      }
    }
    if (p.rtMinus) {
      for (const sample of samples) {
        for (let r = 1; r <= Math.max(1, Math.floor(p.rtMinusPerSample)); r++) {
          reactions.push({ kind: REACTION.RT_MINUS, target, sample, replicate: r });
        }
      }
    }
    if (p.standardCurve) {
      for (let pt = 1; pt <= Math.max(2, Math.floor(p.standardPoints)); pt++) {
        for (let r = 1; r <= Math.max(1, Math.floor(p.standardReplicates)); r++) {
          reactions.push({ kind: REACTION.STANDARD, target, sample: `Std ${pt}`, point: pt, replicate: r });
        }
      }
    }
    for (let r = 1; r <= Math.max(0, Math.floor(p.ntcPerTarget)); r++) {
      reactions.push({ kind: REACTION.NTC, target, sample: '', replicate: r });
    }
    const own = reactions.slice(start);
    const count = (kind) => own.filter((x) => x.kind === kind).length;
    return {
      target,
      samples: count(REACTION.SAMPLE),
      rtMinus: count(REACTION.RT_MINUS),
      standards: count(REACTION.STANDARD),
      ntc: count(REACTION.NTC),
      total: own.length,
    };
  });

  const warnings = [];
  if (!(p.ntcPerTarget > 0)) warnings.push(PLAN_WARN.NO_NTC);
  if (!p.rtMinus) warnings.push(PLAN_WARN.NO_RT_MINUS);
  if (!p.standardCurve) warnings.push(PLAN_WARN.NO_STANDARD);
  if (reps < 2) warnings.push(PLAN_WARN.SINGLE_REPLICATE);

  return { perTarget, reactions, total: reactions.length, warnings };
}

/** Etiqueta corta de una reacción, para el pocillo. */
export function reactionLabel(r) {
  if (r.kind === REACTION.NTC) return `NTC ${r.target}`;
  if (r.kind === REACTION.RT_MINUS) return `RT− ${r.sample}`;
  if (r.kind === REACTION.STANDARD) return `${r.sample}`;
  return r.sample;
}

/**
 * Reparto de las reacciones por la placa.
 *
 * Por defecto cada diana empieza en una fila nueva (`rowPerTarget`), que es
 * como se carga una placa de qPCR a mano: una banda por gen, y dentro los
 * triplicados de cada muestra seguidos. Cargar en zigzag ahorra pocillos y
 * cuesta errores de pipeteo.
 *
 * @param {Array} reactions Salida de `reactionPlan().reactions`.
 * @param {{format?:number, rowPerTarget?:boolean, allWells:Function,
 *          plateGrid:Function}} deps Se inyectan `allWells` y `plateGrid` de
 *   plateMap.js para no duplicar el direccionamiento de pocillos.
 * @returns {{assignments:Object, placed:number, overflow:number,
 *            warnings:string[]}}
 */
export function qpcrLayout(reactions = [], deps = {}) {
  const { allWells, plateGrid } = deps;
  const format = Number(deps.format) || 96;
  const rowPerTarget = deps.rowPerTarget !== false;
  if (typeof allWells !== 'function' || typeof plateGrid !== 'function') {
    return { assignments: {}, placed: 0, overflow: reactions.length, warnings: [] };
  }

  const { cols } = plateGrid(format);
  const wells = allWells(format);
  const assignments = {};
  let i = 0;
  let placed = 0;

  const byTarget = new Map();
  for (const r of reactions) {
    if (!byTarget.has(r.target)) byTarget.set(r.target, []);
    byTarget.get(r.target).push(r);
  }

  for (const [, group] of byTarget) {
    if (rowPerTarget && i % cols !== 0) i += cols - (i % cols); // saltar a fila nueva
    for (const r of group) {
      if (i >= wells.length) break;
      assignments[wells[i]] = {
        etiqueta: reactionLabel(r),
        contenido: r.target,
        grupo: r.kind === REACTION.SAMPLE ? r.target : r.kind,
        color: '',
      };
      i++;
      placed++;
    }
  }

  const overflow = reactions.length - placed;
  return {
    assignments, placed, overflow,
    warnings: overflow > 0 ? [PLAN_WARN.OVERFLOW] : [],
  };
}

/**
 * Programa térmico de dos pasos con curva de fusión, que es el de un SYBR
 * corriente.
 *
 * Los valores son un punto de partida editable, NO el protocolo de ningún kit:
 * la polimerasa que se use manda sobre esto, y su ficha es la que fija el
 * tiempo de activación y la temperatura de hibridación. La curva de fusión no
 * es opcional con SYBR: es lo único que distingue el amplicón de un dímero de
 * primers, y sin ella un Cq tardío no significa nada.
 */
export function thermalProgram(opts = {}) {
  const o = {
    activationC: 95, activationS: 120,
    denatureC: 95, denatureS: 15,
    annealC: 60, annealS: 60,
    cycles: 40,
    meltFromC: 65, meltToC: 95, meltStepC: 0.5,
    ...opts,
  };
  const steps = [
    { kind: 'hold', label: 'activation', tempC: o.activationC, seconds: o.activationS },
    {
      kind: 'cycling',
      cycles: o.cycles,
      steps: [
        { label: 'denature', tempC: o.denatureC, seconds: o.denatureS },
        { label: 'anneal', tempC: o.annealC, seconds: o.annealS, read: true },
      ],
    },
    { kind: 'melt', fromC: o.meltFromC, toC: o.meltToC, stepC: o.meltStepC },
  ];
  return { steps, settings: o, estimatedMinutes: estimateRuntime(o) };
}

/** Duración aproximada, para saber si la tanda cabe en la tarde. */
export function estimateRuntime(o) {
  const ramp = 10; // segundos por rampa, aproximación grosera pero útil
  const cycling = o.cycles * (o.denatureS + o.annealS + 2 * ramp);
  const melt = ((o.meltToC - o.meltFromC) / o.meltStepC) * 5;
  return Math.round((o.activationS + cycling + melt + 60) / 60);
}

/** Programa térmico como texto, para pegarlo en el cuaderno o en Métodos. */
export function thermalProgramText(program) {
  const o = program.settings;
  return [
    `${o.activationC} °C — ${o.activationS} s`,
    `${o.cycles} × [ ${o.denatureC} °C — ${o.denatureS} s | ${o.annealC} °C — ${o.annealS} s (lectura) ]`,
    `Curva de fusión ${o.meltFromC}–${o.meltToC} °C, pasos de ${o.meltStepC} °C`,
  ].join('\n');
}
