// tests/variables.mjs — variables de respuesta: carga de siembra de los
// recuentos, hojas de toma de datos y el puente de colonias a UFC/mL
// (assayPlan.js).
//
// Los casos cubren lo que se subestima al planificar:
//   - que un recuento no es una medida, es una siembra que multiplica
//   - que el agar de los recuentos tiene que entrar en el cálculo de medios
//   - que promediar una placa de 4 colonias con otra de 600 no da un recuento
//   - que una muestra sin ninguna placa contable no se rellena con un número
//
//   node tests/variables.mjs

import { expandDesign } from '../js/lib/designExpand.js';
import { buildLabels, defaultTemplate } from '../js/lib/labelScheme.js';
import { buildMetadata } from '../js/lib/designMetadata.js';
import { planMedia, packBottles } from '../js/lib/mediaPlan.js';
import {
  VARIABLE_KIND, DEFAULT_COUNT_PLAN, DEFAULT_COUNTABLE_RANGE, platingBurden,
  countMediaLayers, buildDirectSheet, buildCountSheet, collapseCounts,
  measurementOccasions, ASSAY_WARN,
} from '../js/lib/assayPlan.js';

let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed = true;
};
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// Ensayo de referencia: 4 tratamientos × 2 tiempos × 3 réplicas = 24 unidades,
// a las que se les mide CE y pH, y se les cuentan tres grupos microbianos.
const DESIGN = expandDesign({
  factors: [
    { name: 'Tratamiento', levels: ['Control', 'T1', 'T2', 'T3'] },
    { name: 'Fase', levels: ['Inicial', 'Final'] },
  ],
  biologicalReplicates: 3,
});

const VARIABLES = [
  { name: 'CE', kind: VARIABLE_KIND.DIRECT, unit: 'dS/m' },
  { name: 'pH', kind: VARIABLE_KIND.DIRECT, unit: '' },
  { name: 'Bacterias totales', kind: VARIABLE_KIND.COUNT, medium: 'PCA' },
  { name: 'Hongos', kind: VARIABLE_KIND.COUNT, medium: 'Rosa de Bengala' },
  { name: 'Levaduras', kind: VARIABLE_KIND.COUNT, medium: 'YPD' },
];

// =============================================================================
console.log('\nocasiones de medida');
// =============================================================================

check('24 unidades', DESIGN.unitCount === 24);
check('sin tiempos, una ocasión por unidad', measurementOccasions(DESIGN) === 24);

{
  const destr = expandDesign({
    factors: [{ name: 'T', levels: ['A', 'B'] }], biologicalReplicates: 3,
    timepoints: ['24h', '48h'], destructiveSampling: true,
  });
  check('destructivo: el tiempo ya está dentro de las unidades',
    destr.unitCount === 12 && measurementOccasions(destr) === 12);

  const noDestr = expandDesign({
    factors: [{ name: 'T', levels: ['A', 'B'] }], biologicalReplicates: 3,
    timepoints: ['24h', '48h'], destructiveSampling: false,
  });
  check('no destructivo: 6 unidades medidas en 2 tiempos = 12 ocasiones',
    noDestr.unitCount === 6 && measurementOccasions(noDestr) === 12);
}

// =============================================================================
console.log('\ncarga de siembra');
// =============================================================================

check('por defecto, 3 diluciones y 3 placas por dilución',
  DEFAULT_COUNT_PLAN.dilutions === 3 && DEFAULT_COUNT_PLAN.platesPerDilution === 3);

{
  const b = platingBurden(DESIGN, VARIABLES);
  check('solo los recuentos generan siembra', b.perVariable.length === 3);
  check('9 placas por muestra y grupo', b.perVariable[0].platesPerOccasion === 9);
  check('24 muestras × 9 placas = 216 por grupo',
    b.perVariable.every((v) => v.totalPlates === 216));
  check('648 placas en total', b.totalPlates === 648, `${b.totalPlates}`);
  check('con 648 placas salta el aviso de siembra disparada',
    b.warnings.includes(ASSAY_WARN.HEAVY_PLATING));
  check('cada grupo arrastra su agar: 216 × 20 mL',
    b.perVariable.every((v) => near(v.agarVolume, 4320, 1e-9)));
}

{
  // El caso grande, el que de verdad asusta: 72 unidades.
  const big = expandDesign({
    factors: [
      { name: 'Tratamiento', levels: ['Control', 'T1', 'T2', 'T3'] },
      { name: 'Dosis', levels: ['Baja', 'Alta'] },
      { name: 'Sustrato', levels: ['S1', 'S2', 'S3'] },
    ],
    biologicalReplicates: 3,
  });
  const b = platingBurden(big, VARIABLES);
  check('72 unidades × 3 grupos × 9 placas = 1944 placas',
    big.unitCount === 72 && b.totalPlates === 1944, `${b.totalPlates}`);
  const layers = countMediaLayers(b);
  const plan = planMedia(layers, { excessFraction: 0.1 });
  check('son casi 39 L de agar en total',
    near(plan.reduce((s, m) => s + m.baseVolume, 0), 38880, 1e-6),
    `${plan.reduce((s, m) => s + m.baseVolume, 0) / 1000} L`);
  check('repartidos en tres medios distintos', plan.length === 3);
  check('cada medio: 216 × 3 × 20 mL + 10 % = 14 256 mL',
    plan.every((m) => near(m.totalVolume, 14256, 1e-6)),
    `${plan[0].totalVolume} mL`);
  const bottles = packBottles(plan[0].totalVolume);
  check('y el reparto en botellas sigue respetando el tope',
    bottles.bottles.every((x) => x.fill <= x.size * 0.7 + 1e-6),
    `${bottles.bottles.length} botellas de ${bottles.bottles[0].size} mL`);
}

check('una siembra más austera reduce la carga en proporción',
  platingBurden(DESIGN, [{
    name: 'Bacterias', kind: VARIABLE_KIND.COUNT, medium: 'PCA',
    dilutions: 2, platesPerDilution: 1,
  }]).totalPlates === 48);

check('un recuento sin medio declarado → aviso',
  platingBurden(DESIGN, [{ name: 'X', kind: VARIABLE_KIND.COUNT }])
    .warnings.includes(ASSAY_WARN.MISSING_MEDIUM));
check('un ensayo sin variables → aviso',
  platingBurden(DESIGN, []).warnings.includes(ASSAY_WARN.NO_VARIABLES));

// =============================================================================
console.log('\nhojas de toma de datos');
// =============================================================================

const META = (() => {
  const tpl = defaultTemplate(DESIGN.effectiveFactors, false);
  const { labels } = buildLabels(DESIGN.units, tpl);
  return buildMetadata(DESIGN, { labels, unitType: 'bolsa', container: 'Bolsa 1 kg' });
})();

{
  const sheet = buildDirectSheet(META, VARIABLES);
  check('una fila por unidad', sheet.rows.length === 24);
  check('las columnas de las variables llevan su unidad',
    sheet.headers.includes('CE (dS/m)') && sheet.headers.includes('pH'));
  check('y vienen vacías para rellenar',
    sheet.rows.every((r) => r['CE (dS/m)'] === '' && r.pH === ''));
  check('los identificadores ya están escritos',
    sheet.rows[0]['sample-id'] === META.rows[0]['sample-id']);
  check('mantiene sample-id en cabeza, así que sigue siendo cargable',
    sheet.headers[0] === 'sample-id');
  check('los recuentos NO van en esta hoja',
    !sheet.headers.some((h) => h.startsWith('Bacterias')));
}

{
  const sheet = buildCountSheet(META, VARIABLES, { dilutionExponents: [-3, -4, -5] });
  check('una fila por placa sembrada: 24 × 3 grupos × 9 = 648',
    sheet.rows.length === 648, `${sheet.rows.length}`);
  check('con la columna de colonias vacía',
    sheet.rows.every((r) => r.colonias === ''));
  check('las diluciones salen como exponentes',
    new Set(sheet.rows.map((r) => r.dilucion)).size === 3
    && sheet.rows[0].dilucion === '1e-3');
  check('las tres placas de cada dilución están numeradas',
    sheet.rows.slice(0, 3).map((r) => r.placa).join(',') === '1,2,3');
  check('cada grupo lleva su medio',
    sheet.rows.find((r) => r.grupo === 'Hongos').medio === 'Rosa de Bengala');
}

// =============================================================================
console.log('\nde colonias a UFC/mL');
// =============================================================================

{
  // Una muestra, un grupo: 1e-3 incontable por exceso, 1e-4 en rango,
  // 1e-5 por debajo del mínimo contable. Solo cuenta la de 1e-4.
  const rows = [
    ...[600, 580, 620].map((c, i) => ({ 'sample-id': 'M1', grupo: 'Bacterias', dilucion: '1e-3', placa: i + 1, colonias: c })),
    ...[100, 110, 90].map((c, i) => ({ 'sample-id': 'M1', grupo: 'Bacterias', dilucion: '1e-4', placa: i + 1, colonias: c })),
    ...[10, 8, 12].map((c, i) => ({ 'sample-id': 'M1', grupo: 'Bacterias', dilucion: '1e-5', placa: i + 1, colonias: c })),
  ];
  const out = collapseCounts(rows, { volumePlated: 100, volumeUnit: 'ul' });
  check('el rango contable por defecto es 30-300',
    DEFAULT_COUNTABLE_RANGE[0] === 30 && DEFAULT_COUNTABLE_RANGE[1] === 300);
  check('solo se promedian las placas en rango', out.skipped === 6, `descartadas ${out.skipped}`);
  check('UFC/mL = media de las tres placas de 1e-4',
    near(out.rows[0]['Bacterias (UFC/mL)'], 1e7, 1), `${out.rows[0]['Bacterias (UFC/mL)']}`);
  check('y no se marca como estimación', out.estimated.length === 0);
  check('la tabla sale ancha: una fila por muestra',
    out.rows.length === 1 && out.headers[0] === 'sample-id');
}

{
  // Una placa incontable entre las réplicas: se promedian las otras dos.
  const rows = [
    { 'sample-id': 'M1', grupo: 'Bacterias', dilucion: '1e-4', placa: 1, colonias: 100 },
    { 'sample-id': 'M1', grupo: 'Bacterias', dilucion: '1e-4', placa: 2, colonias: 'incontable' },
    { 'sample-id': 'M1', grupo: 'Bacterias', dilucion: '1e-4', placa: 3, colonias: 120 },
  ];
  const out = collapseCounts(rows, { volumePlated: 100, volumeUnit: 'ul' });
  check('una placa incontable no anula la muestra: se promedian las otras',
    near(out.rows[0]['Bacterias (UFC/mL)'], 1.1e7, 1),
    `${out.rows[0]['Bacterias (UFC/mL)']}`);
  check('y no cuenta como estimación, porque las usadas sí estaban en rango',
    out.estimated.length === 0);
}

{
  // El rango es configurable: con 25-250 una placa de 28 sí cuenta.
  const rows = [1, 2, 3].map((p) => ({ 'sample-id': 'M1', grupo: 'B', dilucion: '1e-4', placa: p, colonias: 28 }));
  const conDefecto = collapseCounts(rows, { volumePlated: 100, volumeUnit: 'ul' });
  const con25 = collapseCounts(rows, { volumePlated: 100, volumeUnit: 'ul', range: [25, 250] });
  check('con 30-300, una placa de 28 queda fuera y el valor es estimado',
    conDefecto.estimated.length === 1);
  check('con 25-250, la misma placa entra y el valor no es estimado',
    con25.estimated.length === 0);
  check('el número es el mismo en los dos casos, cambia solo la etiqueta',
    near(conDefecto.rows[0]['B (UFC/mL)'], con25.rows[0]['B (UFC/mL)'], 1));
}

{
  // Ninguna placa en rango: se da la dilución menos mala, marcada.
  const rows = [
    ...[2, 3, 1].map((c, i) => ({ 'sample-id': 'M2', grupo: 'Hongos', dilucion: '1e-5', placa: i + 1, colonias: c })),
    ...[20, 22, 18].map((c, i) => ({ 'sample-id': 'M2', grupo: 'Hongos', dilucion: '1e-4', placa: i + 1, colonias: c })),
  ];
  const out = collapseCounts(rows, { volumePlated: 100, volumeUnit: 'ul' });
  check('la muestra NO desaparece de la tabla', out.rows.length === 1);
  check('se usa la dilución más cercana al rango (1e-4, media 20)',
    near(out.rows[0]['Hongos (UFC/mL)'], 2e6, 1), `${out.rows[0]['Hongos (UFC/mL)']}`);
  check('y el valor queda marcado como estimación',
    out.estimated.length === 1 && out.estimated[0].grupo === 'Hongos');
  check('no se lista como inutilizable, porque sí hay un número',
    out.unusable.length === 0);
}

{
  // Sin ninguna placa con número: ahí sí no hay nada que promediar.
  const rows = [1, 2, 3].map((p) => ({ 'sample-id': 'M3', grupo: 'Levaduras', dilucion: '1e-4', placa: p, colonias: '' }));
  const out = collapseCounts(rows, { volumePlated: 100, volumeUnit: 'ul' });
  check('sin ningún recuento anotado, la celda queda vacía',
    out.rows[0]['Levaduras (UFC/mL)'] === '');
  check('y la muestra se lista como inutilizable',
    out.unusable.length === 1 && out.unusable[0].grupo === 'Levaduras');
}

{
  // Varias muestras y varios grupos: tabla ancha de verdad.
  const rows = [];
  for (const id of ['M1', 'M2']) {
    for (const grupo of ['Bacterias', 'Hongos']) {
      for (let p = 1; p <= 3; p++) {
        rows.push({ 'sample-id': id, grupo, dilucion: '1e-4', placa: p, colonias: 100 });
      }
    }
  }
  const out = collapseCounts(rows, { volumePlated: 100, volumeUnit: 'ul' });
  check('dos muestras, dos columnas de grupo',
    out.rows.length === 2 && out.headers.length === 3);
  check('las cabeceras llevan las unidades',
    out.headers[1] === 'Bacterias (UFC/mL)' && out.headers[2] === 'Hongos (UFC/mL)');
  check('mismo recuento en las dos muestras',
    near(out.rows[0]['Bacterias (UFC/mL)'], 1e7, 1)
    && near(out.rows[1]['Hongos (UFC/mL)'], 1e7, 1));
}

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
