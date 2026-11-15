// tests/qpcr-plan.mjs — planificación de una tanda de qPCR (qpcrPlan.js):
// recuento de reacciones con sus controles, reparto por la placa y programa
// térmico.
//
// Lo que se vigila aquí es justo lo que se cuenta mal al planificar: que los
// triplicados técnicos multiplican, que el control sin molde es por pareja de
// primers y no por placa, y que en RT-qPCR hace falta el control sin
// retrotranscriptasa.
//
//   node tests/qpcr-plan.mjs

import {
  REACTION, DEFAULT_QPCR_PLAN, reactionPlan, reactionLabel, qpcrLayout,
  thermalProgram, thermalProgramText, estimateRuntime, PLAN_WARN,
} from '../js/lib/qpcrPlan.js';
import { allWells, plateGrid, parseWellId } from '../js/lib/plateMap.js';
import { calculateMasterMix, getDefaultCommercialMix } from '../js/modules/labcalc.js';

let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed = true;
};

const SAMPLES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
const TARGETS = ['DIANA', '16S'];

// =============================================================================
console.log('\nrecuento de reacciones');
// =============================================================================

check('por defecto, triplicados técnicos', DEFAULT_QPCR_PLAN.technicalReplicates === 3);
check('y dos controles sin molde por diana', DEFAULT_QPCR_PLAN.ntcPerTarget === 2);

{
  const p = reactionPlan({ samples: SAMPLES, targets: TARGETS });
  check('6 muestras × 3 réplicas = 18 reacciones de muestra por diana',
    p.perTarget.every((t) => t.samples === 18));
  check('más 2 controles sin molde por diana',
    p.perTarget.every((t) => t.ntc === 2));
  check('total: 2 dianas × 20 = 40 reacciones', p.total === 40, String(p.total));
  check('el control sin molde es POR DIANA, no por placa',
    p.reactions.filter((r) => r.kind === REACTION.NTC).length === 4);
  check('sin RT− se avisa, porque en RT-qPCR es el que delata el ADN genómico',
    p.warnings.includes(PLAN_WARN.NO_RT_MINUS));
  check('y sin curva estándar también', p.warnings.includes(PLAN_WARN.NO_STANDARD));
}

{
  const p = reactionPlan({
    samples: SAMPLES, targets: TARGETS,
    plan: { rtMinus: true, standardCurve: true },
  });
  check('con RT−: un control por muestra y diana',
    p.perTarget.every((t) => t.rtMinus === 6));
  check('con curva: 5 puntos × 3 réplicas por diana',
    p.perTarget.every((t) => t.standards === 15));
  check('total con todo: 2 × (18 + 6 + 15 + 2) = 82', p.total === 82, String(p.total));
  check('y ya no se avisa de que falten',
    !p.warnings.includes(PLAN_WARN.NO_RT_MINUS)
    && !p.warnings.includes(PLAN_WARN.NO_STANDARD));
}

check('sin réplicas técnicas se avisa',
  reactionPlan({ samples: SAMPLES, targets: TARGETS, plan: { technicalReplicates: 1 } })
    .warnings.includes(PLAN_WARN.SINGLE_REPLICATE));
check('sin controles sin molde se avisa',
  reactionPlan({ samples: SAMPLES, targets: TARGETS, plan: { ntcPerTarget: 0 } })
    .warnings.includes(PLAN_WARN.NO_NTC));
check('sin muestras no hay reacciones de muestra',
  reactionPlan({ samples: [], targets: TARGETS }).perTarget.every((t) => t.samples === 0));

check('las etiquetas distinguen los controles',
  reactionLabel({ kind: REACTION.NTC, target: 'DIANA' }) === 'NTC DIANA'
  && reactionLabel({ kind: REACTION.RT_MINUS, sample: 'M1' }) === 'RT− M1'
  && reactionLabel({ kind: REACTION.SAMPLE, sample: 'M1' }) === 'M1');

// =============================================================================
console.log('\nreparto por la placa');
// =============================================================================

{
  const p = reactionPlan({ samples: SAMPLES, targets: TARGETS });
  const lay = qpcrLayout(p.reactions, { format: 96, allWells, plateGrid });
  check('las 40 reacciones caben en una placa de 96',
    lay.placed === 40 && lay.overflow === 0);
  check('sin repetir pocillo', new Set(Object.keys(lay.assignments)).size === 40);

  // cada diana empieza en fila nueva: con 20 reacciones por diana y 12
  // columnas, la segunda diana no puede arrancar a media fila
  const wells = Object.keys(lay.assignments);
  const segunda = wells.find((w) => lay.assignments[w].contenido === '16S');
  check('cada diana empieza en una fila nueva',
    parseWellId(segunda).col === 0, segunda);

  check('los triplicados de una muestra van seguidos',
    ['A1', 'A2', 'A3'].every((w) => lay.assignments[w].etiqueta === 'M1'),
    ['A1', 'A2', 'A3'].map((w) => lay.assignments[w].etiqueta).join(','));
  check('los controles sin molde llevan su propio grupo',
    Object.values(lay.assignments).filter((c) => c.grupo === REACTION.NTC).length === 4);
}

{
  const p = reactionPlan({
    samples: SAMPLES, targets: TARGETS, plan: { rtMinus: true, standardCurve: true },
  });
  const lay = qpcrLayout(p.reactions, { format: 96, allWells, plateGrid });
  check('82 reacciones con salto de fila todavía caben en 96',
    lay.overflow === 0 && lay.placed === 82, `colocadas ${lay.placed}`);

  // con 20 muestras ya no: son 97 reacciones por diana
  const grande = reactionPlan({
    samples: Array.from({ length: 20 }, (_, i) => 'M' + (i + 1)),
    targets: TARGETS, plan: { rtMinus: true, standardCurve: true },
  });
  const apretada = qpcrLayout(grande.reactions, { format: 96, allWells, plateGrid });
  check('194 reacciones no caben en una placa de 96 y se dice cuántas quedan fuera',
    apretada.overflow > 0 && apretada.warnings.includes(PLAN_WARN.OVERFLOW),
    `colocadas ${apretada.placed}, fuera ${apretada.overflow}`);
  const lay384 = qpcrLayout(grande.reactions, { format: 384, allWells, plateGrid });
  check('en una de 384 caben de sobra', lay384.overflow === 0);
}

check('sin las utilidades de rejilla no se inventa un reparto',
  qpcrLayout([{ target: 'X', kind: REACTION.SAMPLE, sample: 'a' }], {}).placed === 0);

// =============================================================================
console.log('\nmezcla de reacción: se reutiliza la calculadora que ya existe');
// =============================================================================

{
  const p = reactionPlan({ samples: SAMPLES, targets: TARGETS });
  // Receta de 10 µL: lo que va a la mezcla madre lleva inMix, el molde no.
  const base = [
    { id: 'mix', name: '2X mix', unitVol: 5, inMix: true },
    { id: 'fwd', name: 'Primer F', unitVol: 0.4, inMix: true },
    { id: 'rev', name: 'Primer R', unitVol: 0.4, inMix: true },
    { id: 'h2o', name: 'Agua', unitVol: 2.2, inMix: true },
    { id: 'template', name: 'ADN', unitVol: 2, inMix: false },
  ];
  const mm = calculateMasterMix(base, p.total, 10);
  check('la calculadora del repo acepta el número de reacciones del plan',
    mm.numReactions === 40 && mm.effectiveReactions === 44,
    `${mm.numReactions} → ${mm.effectiveReactions}`);
  const mix = mm.reagents.find((r) => r.id === 'mix');
  check('40 reacciones + 10 % de exceso → 220 µL del mix de 5 µL',
    Math.abs(mix.totalVol - 220) < 1e-9, String(mix.totalVol));
  check('el molde no entra en la mezcla madre',
    mm.reagents.find((r) => r.id === 'template').totalVol === 0
    && mm.templatePerWell === 2);
  check('y el volumen final por reacción sigue siendo 10 µL',
    Math.abs(mm.totalPerRxn - 10) < 1e-9, String(mm.totalPerRxn));
  check('no se ha reimplementado la mezcla: se usa la del repo',
    typeof calculateMasterMix === 'function' && typeof getDefaultCommercialMix === 'function');
}

// =============================================================================
console.log('\nprograma térmico');
// =============================================================================

{
  const prog = thermalProgram();
  check('tres bloques: activación, ciclado y curva de fusión',
    prog.steps.length === 3 && prog.steps[0].kind === 'hold'
    && prog.steps[1].kind === 'cycling' && prog.steps[2].kind === 'melt');
  check('40 ciclos de dos pasos', prog.steps[1].cycles === 40 && prog.steps[1].steps.length === 2);
  check('la lectura va en la hibridación', prog.steps[1].steps[1].read === true);
  check('la curva de fusión no es opcional con SYBR y está siempre',
    prog.steps[2].fromC === 65 && prog.steps[2].toC === 95);
  check('da una duración aproximada en minutos',
    prog.estimatedMinutes > 60 && prog.estimatedMinutes < 180, `${prog.estimatedMinutes} min`);

  const texto = thermalProgramText(prog);
  check('el programa se puede pegar en Métodos',
    texto.includes('95 °C') && texto.includes('40 ×') && texto.includes('lectura'),
    texto.split('\n')[1]);

  const rapido = thermalProgram({ cycles: 35, annealS: 30, activationS: 60 });
  check('los parámetros son editables y la duración los sigue',
    rapido.estimatedMinutes < prog.estimatedMinutes,
    `${rapido.estimatedMinutes} < ${prog.estimatedMinutes}`);
  check('estimateRuntime es coherente consigo mismo',
    estimateRuntime(rapido.settings) === rapido.estimatedMinutes);
}

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
