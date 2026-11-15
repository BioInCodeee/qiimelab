// tests/qpcr.mjs — lectura, control de calidad y cuantificación de qPCR
// (qpcrData.js, qpcrQuant.js).
//
// Los VALORES de Cq no son sintéticos: salen de una tanda real (Bio-Rad CFX,
// SYBR, una diana y 16S como referencia, triplicados técnicos) y de la hoja de
// ΔΔCt con la que se analizó. Los nombres de muestra y de la diana SÍ están
// genericizados (M1, M4, CAL, T0, DIANA), como exige la regla del repo para
// los datos de un estudio no publicado: los números pueden ser públicos, los
// nombres que revelan la metodología no. Usar números reales permite dos cosas
// que un caso inventado no da:
//
//   - comprobar que el módulo reproduce EXACTAMENTE los números que él
//     obtiene a mano, hasta el último decimal; si algún día alguien "mejora"
//     una fórmula, este test lo nota.
//   - comprobar que el control de calidad señala los problemas reales de esa
//     tanda, que están ahí de verdad: réplicas dispersas, pocillos sin
//     amplificar, una diana sin control sin molde y un calibrador de otra
//     matriz que infla el cambio de expresión hasta las cinco cifras.
//
//   node tests/qpcr.mjs

import {
  readRun, parseCq, isNtc, groupReplicates, qcReport, suggestOutlier,
  sdWithout, QC, QC_DEFAULTS,
} from '../js/lib/qpcrData.js';
import {
  geneCopies, decimalSeries, standardCurve, absoluteQuantity, deltaCt,
  deltaDeltaCt, pfaffl, relativeExpression, replicateStats,
  QUANT_WARN, EFFICIENCY_RANGE,
} from '../js/lib/qpcrQuant.js';
import { parseTable, toDelimitedText } from '../js/lib/csv.js';

let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed = true;
};
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------
// Tanda real: RUN 14-09-23. Pocillos tal y como los exporta el equipo, con los
// pocillos sin amplificación escritos como celda vacía (que es como salen).
// ---------------------------------------------------------------------------
const RUN = [
  ['A07', '16S', 'Unkn', 'M1', '11.4049430892884'],
  ['A08', '16S', 'Unkn', 'M1', '11.164040754031'],
  ['A09', '16S', 'Unkn', 'M1', '12.0168332729922'],
  ['A10', 'DIANA', 'Unkn', 'M1', ''],
  ['A11', 'DIANA', 'Unkn', 'M1', ''],
  ['A12', 'DIANA', 'Unkn', 'M1', '34.582185184143'],
  ['B07', '16S', 'Unkn', 'M2', '11.8288973796815'],
  ['B08', '16S', 'Unkn', 'M2', '11.4254545996941'],
  ['B09', '16S', 'Unkn', 'M2', '10.8456204215682'],
  ['B10', 'DIANA', 'Unkn', 'M2', '31.0466793506634'],
  ['B11', 'DIANA', 'Unkn', 'M2', '31.9663024552195'],
  ['B12', 'DIANA', 'Unkn', 'M2', '32.3923142011473'],
  ['G07', '16S', 'Unkn', 'M3', '17.87'],
  ['G08', '16S', 'Unkn', 'M3', '14.47'],
  ['G09', '16S', 'Unkn', 'M3', '13.96'],
  ['G10', 'DIANA', 'Unkn', 'M3', '34.25'],
  ['G11', 'DIANA', 'Unkn', 'M3', '28.46'],
  ['G12', 'DIANA', 'Neg Ctrl', '', ''],
  ['H12', 'DIANA', 'Neg Ctrl', '', ''],
];
const RUN_TABLE = {
  headers: ['Well', 'Target', 'Content', 'Sample', 'Cq'],
  rows: RUN.map(([well, target, content, sample, cq]) => ({
    Well: well, Target: target, Content: content, Sample: sample, Cq: cq,
  })),
};

// =============================================================================
console.log('\nlectura del export del equipo');
// =============================================================================

check('un pocillo sin amplificación se lee como null, NUNCA como 0',
  parseCq('') === null && parseCq('N/A') === null && parseCq('Undetermined') === null);
check('y un Cq de verdad se lee como número', parseCq('31,0466') === 31.0466);
check('el cero sigue siendo un número válido, no una marca de ausencia',
  parseCq('0') === 0);

check('reconoce los controles sin molde',
  isNtc('Neg Ctrl') && isNtc('NTC') && isNtc('Negative Control') && !isNtc('Unkn'));

{
  const run = readRun(RUN_TABLE);
  check('empareja las cabeceras del equipo sin configurar nada',
    run.missing.length === 0 && run.mapping.target === 'Target');
  check('lee los 19 pocillos', run.wells.length === 19);
  check('cuatro pocillos sin Cq', run.wells.filter((w) => w.cq === null).length === 4);
  const cols = readRun({ headers: ['Well', 'Target Name', 'Sample Name', 'Cт'], rows: [] });
  check('también acepta la nomenclatura con "Target Name" y "Cт"',
    cols.missing.length === 0);
}

// =============================================================================
console.log('\ncontrol de calidad de la tanda real');
// =============================================================================

const { wells } = readRun(RUN_TABLE);
const qc = qcReport(wells);
const has = (code, sample, target) => qc.issues.some(
  (i) => i.code === code && (!sample || i.sample === sample) && (!target || i.target === target),
);

check('la tanda NO pasa el control de calidad', !qc.ok);
check('los controles sin molde no se cuentan como muestras',
  !qc.groups.some((g) => g.sample === ''));

check('M1/DIANA: dos de tres pocillos sin amplificar, señalado',
  has(QC.UNDETERMINED, 'M1', 'DIANA'));
check('y además señalado como "casi todo sin amplificar"',
  has(QC.MOSTLY_UNDETERMINED, 'M1', 'DIANA'));
check('con un solo pocillo válido, se avisa de que no hay réplicas',
  has(QC.SINGLE_REPLICATE, 'M1', 'DIANA'));
// 34,58 queda JUSTO por debajo del corte habitual de 35, así que no salta el
// aviso de Cq tardío: lo que inutiliza ese dato no es el ciclo, son los dos
// pocillos que no amplificaron. Conviene que el test fije esa frontera, para
// que nadie baje el umbral "porque ese caso debería saltar".
check('un Cq de 34,58 NO dispara el aviso de Cq tardío: el corte es 35',
  !has(QC.LATE_CQ, 'M1', 'DIANA') && QC_DEFAULTS.maxCq === 35);
check('pero un Cq de 36 sí lo dispara',
  qcReport(readRun({
    headers: RUN_TABLE.headers,
    rows: [...RUN_TABLE.rows, { Well: 'F01', Target: 'DIANA', Content: 'Unkn', Sample: 'TARDIA', Cq: '36.2' }],
  }).wells).issues.some((i) => i.code === QC.LATE_CQ && i.sample === 'TARDIA'));

{
  const g = qc.groups.find((x) => x.sample === 'M3' && x.target === 'DIANA');
  check('M3/DIANA: SD de 4,09 ciclos entre dos réplicas',
    near(g.sd, 4.095, 0.01), `SD=${g.sd.toFixed(2)}`);
  check('y queda marcado por dispersión', has(QC.HIGH_SD, 'M3', 'DIANA'));
}

{
  const g = qc.groups.find((x) => x.sample === 'M3' && x.target === '16S');
  const out = suggestOutlier(g);
  check('M3/16S: propone la réplica descolgada (17,87 frente a 14,47 y 13,96)',
    out && out.well === 'G07', out ? `${out.well} Cq=${out.cq}` : 'ninguna');
  check('y enseña en cuánto bajaría la SD al quitarla',
    near(sdWithout(g, 'G07'), 0.36, 0.01), `${sdWithout(g, 'G07').toFixed(2)}`);
  check('pero no la quita sola: con n=3 eso lo decide una persona',
    g.n === 3 && g.cqs.includes(17.87));
}

check('16S en Cq 11 es demasiado temprano para fiarse de la línea base',
  has(QC.EARLY_CQ, 'M1', '16S'));
check('falta el control sin molde de 16S',
  qc.issues.some((i) => i.code === QC.NO_NTC && i.target === '16S'));
check('el control sin molde de DIANA existe y está limpio',
  !qc.issues.some((i) => i.code === QC.NO_NTC && i.target === 'DIANA')
  && !has(QC.NTC_AMPLIFIED));

{
  // Si el NTC amplificara, hay que verlo.
  const sucio = qcReport(readRun({
    headers: RUN_TABLE.headers,
    rows: [...RUN_TABLE.rows, { Well: 'H11', Target: '16S', Content: 'Neg Ctrl', Sample: '', Cq: '33.1' }],
  }).wells);
  check('un control sin molde que amplifica se señala',
    sucio.issues.some((i) => i.code === QC.NTC_AMPLIFIED && i.target === '16S'));
}

{
  // La trampa del equipo: la columna "Cq Mean" trae 0 en los pocillos sin
  // amplificar. Si se usara esa columna, M1/DIANA daría media 0.
  const g = qc.groups.find((x) => x.sample === 'M1' && x.target === 'DIANA');
  check('la media se recalcula solo con lo que amplificó, ignorando el 0 del equipo',
    near(g.mean, 34.582185184143, 1e-9), `${g.mean}`);
}

// =============================================================================
console.log('\nΔΔCt: reproducir la hoja del usuario al decimal');
// =============================================================================
// Bloques de su hoja "Analyses results", con los Cq tal cual.

const BLOQUES = {
  CAL: {
    '16S': [11.5912136023691, 11.5678875659939, 11.5873977206921],
    DIANA: [30.8220233355963, 31.1514198352284, 31.0177459348954],
  },
  M4: {
    '16S': [27.0661930695187, 26.7074104333356, 26.4316609683506],
    DIANA: [31.7720344884711, 31.6364498331699, 32.2047855063527],
  },
  T0: {
    '16S': [22.307112241749, 21.6611535568359, 21.606595961934],
    DIANA: [25.3545666575658, 25.7164564646609, 25.6650569677473],
  },
};
const grupos = Object.entries(BLOQUES).flatMap(([sample, targets]) =>
  Object.entries(targets).map(([target, cqs]) => {
    const st = replicateStats(cqs);
    return { sample, target, cqs, n: st.n, undetermined: 0, mean: st.mean, sd: st.sd };
  }));
const g = (s, t) => grupos.find((x) => x.sample === s && x.target === t);

check('media de 16S en "CAL" igual a la suya',
  near(g('CAL', '16S').mean, 11.582166296351701, 1e-12));
check('media de DIANA en "CAL" igual a la suya',
  near(g('CAL', 'DIANA').mean, 30.997063035240032, 1e-12));

{
  const d = deltaCt(g('CAL', 'DIANA'), g('CAL', '16S'));
  check('ΔCt de "CAL" = 19,41489673888833, como en su hoja',
    near(d.value, 19.41489673888833, 1e-11), `${d.value}`);
  check('y ahora además lleva SD, que en su hoja faltaba',
    Number.isFinite(d.sd) && near(d.sd, Math.sqrt(g('CAL', 'DIANA').sd ** 2 + g('CAL', '16S').sd ** 2), 1e-12),
    `SD=${d.sd.toFixed(3)}`);
}

{
  const dM4 = deltaCt(g('M4', 'DIANA'), g('M4', '16S'));
  check('ΔCt de M4 = 5,136001785596264',
    near(dM4.value, 5.136001785596264, 1e-11), `${dM4.value}`);

  const vsCal = deltaDeltaCt(dM4, deltaCt(g('CAL', 'DIANA'), g('CAL', '16S')),
    { calibratorName: 'CAL' });
  check('ΔΔCt contra "CAL" = -14,278894953292067',
    near(vsCal.ddct, -14.278894953292067, 1e-11), `${vsCal.ddct}`);
  check('2^-ΔΔCt = 19878,137294998993, exactamente su número',
    near(vsCal.fold, 19878.137294998993, 1e-6), `${vsCal.fold}`);
  check('pero se marca que 19.878 veces huele a calibrador de otra matriz',
    vsCal.warnings.includes(QUANT_WARN.CALIBRATOR_MATRIX));
  check('y que se ha supuesto eficiencia del 100 % en las dos dianas',
    vsCal.warnings.includes(QUANT_WARN.ASSUMED_EFFICIENCY));
  check('el calibrador viaja con el resultado, no se pierde',
    vsCal.calibrator === 'CAL');

  const vsT0 = deltaDeltaCt(dM4, deltaCt(g('T0', 'DIANA'), g('T0', '16S')),
    { calibratorName: 'T0' });
  check('cambiando el calibrador a t0: ΔΔCt = 1,4155956757778938',
    near(vsT0.ddct, 1.4155956757778938, 1e-11), `${vsT0.ddct}`);
  check('y el cambio de expresión = 0,37485494113837087, su otro número',
    near(vsT0.fold, 0.37485494113837087, 1e-12), `${vsT0.fold}`);
  check('ese sí es un valor creíble y no lleva el aviso de calibrador',
    !vsT0.warnings.includes(QUANT_WARN.CALIBRATOR_MATRIX));
  check('y ahora el cambio de expresión lleva intervalo, que antes no tenía',
    Number.isFinite(vsT0.foldLow) && Number.isFinite(vsT0.foldHigh)
    && vsT0.foldLow < vsT0.fold && vsT0.fold < vsT0.foldHigh,
    `${vsT0.foldLow.toFixed(2)} – ${vsT0.foldHigh.toFixed(2)}`);
}

{
  const sin = deltaDeltaCt({ value: 5, sd: NaN }, { value: 4, sd: NaN }, {});
  check('sin réplicas se avisa de que no hay incertidumbre',
    sin.warnings.includes(QUANT_WARN.NO_SD) && !Number.isFinite(sin.foldLow));
}

{
  const rel = relativeExpression(grupos, { target: 'DIANA', reference: '16S', calibrator: 'T0' });
  check('la tanda entera se resuelve de una vez', rel.rows.length === 3);
  check('el calibrador sale consigo mismo en 1',
    near(rel.rows.find((r) => r.sample === 'T0').fold, 1, 1e-12));
  check('y el método usado se declara', rel.method === 'livak');
}

// =============================================================================
console.log('\ncurva estándar y eficiencia');
// =============================================================================

check('copias del gen: 1,25 ng/µL de un amplicón de 150 pb → 7,6035e9 copias/µL',
  near(geneCopies(1.25, 150), 7603535353.535354, 1), `${geneCopies(1.25, 150).toExponential(4)}`);
check('la serie decimal arranca en la madre y baja de diez en diez',
  near(decimalSeries(7603535353.535354, 4)[3], 7603535.353535354, 1e-6));
check('datos imposibles → NaN', Number.isNaN(geneCopies(0, 150)));

{
  // Curva perfecta: pendiente -3,3219 es exactamente el 100 % de eficiencia.
  const pts = [3, 4, 5, 6, 7].map((e) => ({ quantity: 10 ** e, cq: 40 - 3.321928094887362 * e }));
  const c = standardCurve(pts);
  check('pendiente -3,3219 → eficiencia del 100 %',
    near(c.efficiencyPct, 100, 1e-6), `${c.efficiencyPct.toFixed(3)} %`);
  check('R² = 1 en una recta perfecta', near(c.r2, 1, 1e-12));
  check('y sin avisos', c.warnings.length === 0);
}

{
  const floja = standardCurve([3, 4, 5, 6, 7].map((e) => ({ quantity: 10 ** e, cq: 40 - 3.9 * e })));
  check('pendiente -3,9 → eficiencia del 80 %, fuera de rango',
    near(floja.efficiencyPct, 80.4, 0.2)
    && floja.warnings.includes(QUANT_WARN.EFFICIENCY_OUT), `${floja.efficiencyPct.toFixed(1)} %`);
  const pocos = standardCurve([{ quantity: 1e3, cq: 30 }, { quantity: 1e4, cq: 26.7 }]);
  check('menos de cinco puntos → aviso', pocos.warnings.includes(QUANT_WARN.FEW_POINTS));
  check('el rango aceptable es el 90-110 %',
    EFFICIENCY_RANGE[0] === 0.9 && EFFICIENCY_RANGE[1] === 1.1);
}

{
  const pts = [3, 4, 5, 6, 7].map((e) => ({ quantity: 10 ** e, cq: 40 - 3.321928094887362 * e }));
  const c = standardCurve(pts);
  check('cuantificación absoluta: un Cq de la curva devuelve su cantidad',
    near(absoluteQuantity(40 - 3.321928094887362 * 5, c), 1e5, 1),
    `${absoluteQuantity(40 - 3.321928094887362 * 5, c).toExponential(3)}`);
  check('un pocillo sin amplificación no se convierte en una cantidad enorme',
    absoluteQuantity(null, c) === null);
}

// =============================================================================
console.log('\nPfaffl: la corrección que falta en su hoja');
// =============================================================================

{
  // Con las dos dianas al 100 %, Pfaffl y 2^-ΔΔCt tienen que coincidir.
  const t = { sample: g('M4', 'DIANA').mean, calibrator: g('T0', 'DIANA').mean };
  const r = { sample: g('M4', '16S').mean, calibrator: g('T0', '16S').mean };
  const p = pfaffl(t, r, { target: 1, reference: 1 });
  check('con ambas al 100 %, Pfaffl reproduce 2^-ΔΔCt',
    near(p.ratio, 0.37485494113837087, 1e-9), `${p.ratio}`);

  // Con eficiencias reales distintas, el resultado cambia de verdad.
  const real = pfaffl(t, r, { target: 0.92, reference: 1.05 });
  check('con eficiencias reales distintas el cociente se mueve',
    Math.abs(real.ratio - p.ratio) / p.ratio > 0.1,
    `${p.ratio.toFixed(4)} → ${real.ratio.toFixed(4)}`);
  check('y una eficiencia fuera de rango se señala',
    pfaffl(t, r, { target: 0.7, reference: 1 }).warnings.includes(QUANT_WARN.EFFICIENCY_OUT));
  check('una eficiencia imposible → null', pfaffl(t, r, { target: -2, reference: 1 }) === null);
}

{
  const rel = relativeExpression(grupos, {
    target: 'DIANA', reference: '16S', calibrator: 'T0',
    efficiency: { target: 0.92, reference: 1.05 },
  });
  check('con eficiencias medidas, la tanda pasa a Pfaffl', rel.method === 'pfaffl');
  check('y desaparece el aviso de eficiencia supuesta',
    !rel.warnings.includes(QUANT_WARN.ASSUMED_EFFICIENCY));
  check('las dos cifras conviven, para poder compararlas',
    rel.rows.every((r) => Number.isFinite(r.fold) && Number.isFinite(r.ratioPfaffl)));
}

// =============================================================================
console.log('\nida y vuelta por CSV');
// =============================================================================

{
  const text = toDelimitedText(RUN_TABLE.headers, RUN_TABLE.rows, ',');
  const back = readRun(parseTable(text, ','));
  check('el export del equipo pasa por CSV sin perder nada',
    back.wells.length === 19 && back.wells.filter((w) => w.cq === null).length === 4);
  check('y los pocillos vacíos siguen siendo null después del viaje',
    back.wells.find((w) => w.well === 'A10').cq === null);
}

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
