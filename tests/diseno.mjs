// tests/diseno.mjs — #/diseno: expansión del diseño experimental
// (designExpand.js), logística de medios y recipientes (mediaPlan.js) y
// etiquetado y aleatorización (labelScheme.js).
//
// Todo es aritmética y combinatoria, así que la verdad de referencia se
// calcula a mano en los propios casos.
//
// Los casos cubren lo que de verdad se hace mal al planificar un ensayo:
//   - confundir réplica técnica con biológica (pseudorreplicación)
//   - olvidar que el muestreo destructivo multiplica las unidades por tiempo
//   - llenar el matraz por encima del límite de aireación
//   - llenar la botella del autoclave hasta arriba
//   - etiquetas que se repiten entre dos unidades distintas
//
//   node tests/diseno.mjs

import {
  crossFactors, expandDesign, blockPlan, DESIGN_WARN,
} from '../js/lib/designExpand.js';
import {
  planMedia, aerationCheck, suggestFlask, packBottles,
  FLASK_SIZES, BOTTLE_SIZES, PLATE_AGAR_VOLUME, MEDIA_WARN,
} from '../js/lib/mediaPlan.js';
import {
  renderLabel, buildLabels, randomizeOrder, defaultTemplate, availableTokens,
} from '../js/lib/labelScheme.js';
import {
  buildMetadata, metadataText, sanitizeHeader, uniqueHeaders,
  SAMPLE_ID_HEADER, METADATA_WARN,
} from '../js/lib/designMetadata.js';
import { parseTable, toDelimitedText } from '../js/lib/csv.js';
import { classifyTable } from '../js/lib/ingest.js';
import { makeGroupResolver } from '../js/lib/sampleMatch.js';

let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed = true;
};
const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// Diseño de referencia: 4 cepas × 2 temperaturas × 3 medios, 3 réplicas
// biológicas, 3 tiempos de muestreo.
const FACTORS = [
  { name: 'Cepa', levels: ['Control', 'B1', 'B2', 'B3'] },
  { name: 'Temperatura', levels: ['25', '30'] },
  { name: 'Medio', levels: ['PDA', 'AA', 'LB'] },
];
const TIMES = ['24h', '48h', '72h'];

// =============================================================================
console.log('\nexpansión factorial');
// =============================================================================

check('producto cartesiano de 4 × 2 × 3', crossFactors(FACTORS).length === 24);
check('cada combinación lleva un nivel de cada factor',
  crossFactors(FACTORS).every((c) => Object.keys(c).length === 3));

{
  const d = expandDesign({
    factors: FACTORS, biologicalReplicates: 3, timepoints: TIMES,
    destructiveSampling: true,
  });
  check('muestreo destructivo: 24 × 3 réplicas × 3 tiempos = 216 unidades',
    d.unitCount === 216, `${d.unitCount}`);
  check('el desglose explica de dónde sale el número',
    d.breakdown.reduce((p, b) => p * b.count, 1) === 216);
  check('cada unidad lleva su tiempo', d.units.every((u) => TIMES.includes(u.timepoint)));
}

{
  const d = expandDesign({
    factors: FACTORS, biologicalReplicates: 3, timepoints: TIMES,
    destructiveSampling: false,
  });
  check('muestreo no destructivo: el tiempo NO multiplica → 72 unidades',
    d.unitCount === 72, `${d.unitCount}`);
  check('y se avisa de que son medidas repetidas',
    d.warnings.includes(DESIGN_WARN.REPEATED_MEASURES));
  check('cada unidad se mide en los 3 tiempos', d.measurementsPerUnit === 3);
  check('medidas totales = 72 × 3', d.measurementCount === 216);
}

// =============================================================================
console.log('\nréplicas biológicas frente a técnicas');
// =============================================================================

{
  const base = { factors: FACTORS, biologicalReplicates: 3 };
  const sinTec = expandDesign(base);
  const conTec = expandDesign({ ...base, technicalReplicates: 3 });
  check('las técnicas NO cambian el número de unidades',
    sinTec.unitCount === conTec.unitCount && conTec.unitCount === 72);
  check('las técnicas SÍ multiplican las medidas',
    conTec.measurementCount === 216 && sinTec.measurementCount === 72);
}

{
  const d = expandDesign({
    factors: FACTORS, biologicalReplicates: 1, technicalReplicates: 5,
  });
  check('técnicas con una sola biológica → pseudorreplicación, con ese nombre',
    d.warnings.includes(DESIGN_WARN.PSEUDOREPLICATION));
}

check('menos de 3 réplicas biológicas → aviso',
  expandDesign({ factors: FACTORS, biologicalReplicates: 2 })
    .warnings.includes(DESIGN_WARN.FEW_BIOLOGICAL));
check('3 réplicas biológicas → sin ese aviso',
  !expandDesign({ factors: FACTORS, biologicalReplicates: 3 })
    .warnings.includes(DESIGN_WARN.FEW_BIOLOGICAL));

// =============================================================================
console.log('\nfactores degenerados y bloques');
// =============================================================================

{
  const d = expandDesign({
    factors: [...FACTORS, { name: 'Agitación', levels: ['150 rpm'] }],
    biologicalReplicates: 3,
  });
  check('un factor de un solo nivel no multiplica', d.unitCount === 72);
  check('y se avisa, nombrándolo',
    d.warnings.includes(DESIGN_WARN.SINGLE_LEVEL) && d.ignoredFactors.includes('Agitación'));
  check('no entra en los factores efectivos', d.effectiveFactors.length === 3);
}

check('sin factores utilizables → aviso',
  expandDesign({ factors: [], biologicalReplicates: 3 })
    .warnings.includes(DESIGN_WARN.NO_FACTORS));

check('sin capacidad declarada no se propone bloqueo', blockPlan(216, 0) === null);
{
  const bp = blockPlan(216, 80);
  check('216 unidades en una estufa de 80 → 3 bloques equilibrados',
    bp.blocks === 3 && bp.perBlock === 72 && !bp.fits);
  check('si caben, un solo bloque', blockPlan(50, 80).fits === true);
}

// =============================================================================
console.log('\nmedio a preparar');
// =============================================================================

{
  // 10 placas de 90 mm en bicapa: 10 mL de agua-agar debajo, 20 de PDA encima
  const unitLayers = Array.from({ length: 10 }, () => ([
    { medium: 'Agua-agar', volume: 10 },
    { medium: 'PDA', volume: PLATE_AGAR_VOLUME[90] },
  ]));
  const plan = planMedia(unitLayers, { excessFraction: 0.1 });
  check('la bicapa cuenta como dos medios distintos', plan.length === 2);
  const pda = plan.find((m) => m.medium === 'PDA');
  const aa = plan.find((m) => m.medium === 'Agua-agar');
  check('PDA: 10 × 20 mL = 200 mL de base', near(pda.baseVolume, 200));
  check('con 10 % de exceso → 220 mL', near(pda.totalVolume, 220));
  check('y el exceso se ve aparte', near(pda.excessVolume, 20));
  check('agua-agar: 10 × 10 mL + 10 % = 110 mL', near(aa.totalVolume, 110));
  check('se ordena de mayor a menor volumen', plan[0].medium === 'PDA');
}

{
  // el medio como factor: cada unidad lleva el suyo
  const d = expandDesign({ factors: FACTORS, biologicalReplicates: 3 });
  const unitLayers = d.units.map((u) => ([{ medium: u.levels.Medio, volume: 50 }]));
  const plan = planMedia(unitLayers, { excessFraction: 0 });
  check('medio como factor: tres medios, 24 unidades cada uno',
    plan.length === 3 && plan.every((m) => m.units === 24));
  check('y 24 × 50 mL por medio', plan.every((m) => near(m.baseVolume, 1200)));
}

check('sin exceso declarado se aplica el 10 % por defecto',
  near(planMedia([[{ medium: 'LB', volume: 100 }]])[0].totalVolume, 110));

// =============================================================================
console.log('\naireación del matraz');
// =============================================================================

check('60 mL en un matraz de 250 mL → aviso de aireación',
  !aerationCheck(60, 250).ok && aerationCheck(60, 250).warnings.includes(MEDIA_WARN.AERATION));
check('50 mL en 250 mL es exactamente el 20 % → correcto',
  aerationCheck(50, 250).ok);
check('la fracción se reporta', near(aerationCheck(60, 250).fraction, 0.24, 1e-9));
check('cultivo estático al 50 % permitido si se sube el límite',
  aerationCheck(125, 250, 0.5).ok);

check('50 mL de trabajo → matraz de 250 mL', suggestFlask(50) === 250);
check('10 mL de trabajo → matraz de 50 mL', suggestFlask(10) === 50);
check('se elige el más pequeño que sirva, no el primero que quepa',
  suggestFlask(20) === 100);
check('volumen sin matraz posible → null',
  suggestFlask(10000, { sizes: FLASK_SIZES }) === null);

// =============================================================================
console.log('\nreparto en botellas para autoclavar');
// =============================================================================

const capOf = (b, maxFill = 0.7) => b.size * maxFill;

{
  const p = packBottles(1200);
  check('1200 mL → dos botellas de 1 L', p.bottles.length === 2
    && p.bottles.every((b) => b.size === 1000));
  check('repartidas a partes iguales, 600 mL cada una',
    p.bottles.every((b) => near(b.fill, 600, 1e-6)),
    p.bottles.map((b) => `${b.fill}/${b.size}`).join(' + '));
  check('ninguna por encima del 70 %', p.bottles.every((b) => b.fill <= capOf(b) + 1e-6));
  check('el reparto cubre el volumen pedido', near(p.total, 1200, 1e-6));
}

{
  const p = packBottles(350);
  check('350 mL caben justos en una de 500 y no se parten en dos',
    p.bottles.length === 1 && p.bottles[0].size === 500 && near(p.bottles[0].fill, 350, 1e-6));
}

{
  const p = packBottles(700);
  check('700 mL = tope exacto de la de 1 L → una sola botella',
    p.bottles.length === 1 && p.bottles[0].size === 1000);
}

{
  const p = packBottles(60);
  check('un volumen pequeño va a la botella más pequeña que lo admita',
    p.bottles.length === 1 && p.bottles[0].size === 100);
}

{
  const p = packBottles(5000);
  check('un volumen grande se reparte sin pasar del tope en ninguna',
    p.bottles.every((b) => b.fill <= capOf(b) + 1e-6) && near(p.total, 5000, 1e-6),
    `${p.bottles.length} botellas`);
}

{
  const p = packBottles(1200, { sizes: [...BOTTLE_SIZES, 2000] });
  check('con botella de 2 L disponible, 1200 mL caben en una sola',
    p.bottles.length === 1 && p.bottles[0].size === 2000);
}

check('volumen cero → sin botellas', packBottles(0).bottles.length === 0);

// =============================================================================
console.log('\netiquetas');
// =============================================================================

{
  const d = expandDesign({ factors: FACTORS, biologicalReplicates: 3 });
  const tpl = defaultTemplate(d.effectiveFactors, false);
  check('plantilla por defecto con los factores y la réplica',
    tpl === '{Cepa}-{Temperatura}-{Medio}-R{replica}', tpl);

  const tokens = availableTokens(d.effectiveFactors, true);
  check('las fichas disponibles incluyen tiempo, réplica y correlativo',
    tokens.includes('{tiempo}') && tokens.includes('{replica}') && tokens.includes('{n}'));

  const { labels, unique } = buildLabels(d.units, tpl);
  check('72 etiquetas, todas distintas', labels.length === 72 && unique);
  check('la primera es la esperada', labels[0] === 'Control-25-PDA-R1', labels[0]);

  const abbrev = { Cepa: { Control: 'C', B1: 'B1' }, Temperatura: { 25: '25C', 30: '30C' } };
  check('las abreviaturas sustituyen al nombre largo',
    renderLabel(tpl, d.units[0], { abbrev }) === 'C-25C-PDA-R1',
    renderLabel(tpl, d.units[0], { abbrev }));
}

{
  const d = expandDesign({ factors: FACTORS, biologicalReplicates: 3 });
  // plantilla incompleta: omite el medio, así que tres unidades comparten etiqueta
  const { duplicates, unique } = buildLabels(d.units, '{Cepa}-{Temperatura}-R{replica}');
  check('una plantilla que omite un factor genera duplicados y se detecta',
    !unique && duplicates.length === 24);
  check('se señala cuáles, sin arreglarlos por detrás',
    duplicates[0].indices.length === 3);
}

{
  const d = expandDesign({
    factors: [FACTORS[0]], biologicalReplicates: 2, timepoints: TIMES,
    destructiveSampling: true,
  });
  const { labels, unique } = buildLabels(d.units, '{Cepa}-{tiempo}-R{replica}');
  check('con tiempo en la plantilla las etiquetas vuelven a ser únicas', unique);
  check('y el tiempo aparece', labels[0].includes('24h'), labels[0]);
}

check('una ficha desconocida se deja visible para que se note el fallo',
  renderLabel('{NoExiste}-R{replica}', { levels: {}, replicate: 1, index: 0 })
    === '{NoExiste}-R1');
check('el correlativo {n} empieza en 1',
  buildLabels([{ levels: {}, replicate: 1, index: 0 }], 'U{n}').labels[0] === 'U1');

// =============================================================================
console.log('\naleatorización de la colocación');
// =============================================================================

{
  const d = expandDesign({ factors: FACTORS, biologicalReplicates: 3 });
  const a = randomizeOrder(d.units, 42);
  const b = randomizeOrder(d.units, 42);
  const c = randomizeOrder(d.units, 43);
  check('misma semilla, mismo orden', a.order.join(',') === b.order.join(','));
  check('semilla distinta, orden distinto', a.order.join(',') !== c.order.join(','));
  check('la semilla se devuelve para poder escribirla en Métodos', a.seed === 42);
  check('es una permutación: están todas las unidades y ninguna repetida',
    new Set(a.order).size === 72
    && a.order.slice().sort((x, y) => x - y).join(',') === d.units.map((u) => u.index).join(','));
  check('de verdad baraja, no devuelve el orden de entrada',
    a.order.join(',') !== d.units.map((u) => u.index).join(','));
}


// =============================================================================
console.log('\nmetadatos: ida y vuelta con el lector que ya existe');
// =============================================================================
// Este bloque es el que sostiene la idea del módulo. Si deja de pasar, el
// calculador es una calculadora suelta y ya no encadena con el análisis.

check('las cabeceras se sanean sin perder los acentos',
  sanitizeHeader('  Concentración\tde sal  ') === 'Concentración de sal');
check('un factor que choca con una columna reservada se desambigua',
  uniqueHeaders(['replica'], ['sample-id', 'replica']).headers[0] === 'replica_2');
check('dos factores con el mismo nombre no colisionan',
  uniqueHeaders(['Medio', 'Medio']).headers.join(',') === 'Medio,Medio_2');

{
  const d = expandDesign({
    factors: FACTORS, biologicalReplicates: 3, timepoints: TIMES,
    destructiveSampling: true,
  });
  const tpl = defaultTemplate(d.effectiveFactors, true);
  const { labels, unique } = buildLabels(d.units, tpl);
  check('las etiquetas del diseño completo son únicas', unique);

  const { order, seed } = randomizeOrder(d.units, 7);
  const unitLayers = d.units.map(() => ([
    { medium: 'Agua-agar', volume: 10 }, { medium: 'PDA', volume: 20 },
  ]));
  const bp = blockPlan(d.unitCount, 80);

  const meta = buildMetadata(d, {
    labels, order, unitType: 'placa', unitLayers,
    container: 'Placa 90 mm', blockPlan: bp,
  });

  check('una fila por unidad experimental', meta.rows.length === 216);
  check('la primera columna es sample-id', meta.headers[0] === SAMPLE_ID_HEADER);
  check('están los tres factores como columnas',
    ['Cepa', 'Temperatura', 'Medio'].every((h) => meta.headers.includes(h)));
  check('y las columnas logísticas',
    ['replica', 'tiempo', 'unidad', 'medio', 'recipiente', 'posicion', 'bloque']
      .every((h) => meta.headers.includes(h)));
  check('sin avisos en un diseño limpio', meta.warnings.length === 0, meta.warnings.join(','));
  check('la bicapa se escribe unida', meta.rows[0].medio === 'Agua-agar+PDA');
  check('las posiciones son una permutación completa de 1..216',
    new Set(meta.rows.map((r) => r.posicion)).size === 216
    && Math.max(...meta.rows.map((r) => r.posicion)) === 216);
  check('el bloque sale de la posición, no del orden de montaje',
    meta.rows.every((r) => r.bloque === Math.ceil(r.posicion / bp.perBlock)));
  check('3 bloques, como dijo blockPlan',
    new Set(meta.rows.map((r) => r.bloque)).size === 3);
  check('la semilla usada es la pedida', seed === 7);

  // --- la vuelta: serializar, parsear y pasárselo al detector del repo ---
  const text = metadataText(meta);
  const parsed = parseTable(text);
  check('ida y vuelta sin pérdida de filas', parsed.rows.length === 216);
  check('ida y vuelta sin pérdida de columnas',
    parsed.headers.join('|') === meta.headers.join('|'));

  const kind = classifyTable(parsed.headers, parsed.rows, 'metadatos.tsv');
  check('el detector del repo lo reconoce como METADATOS',
    kind && kind.kind === 'metadata', kind ? kind.kind : 'null');
  check('y elige sample-id como columna de id',
    kind && kind.sampleIdKey === SAMPLE_ID_HEADER);

  // --- y que de verdad sirva para agrupar, que es para lo que se exporta ---
  const resolver = makeGroupResolver(
    { rows: kind.rows, sampleIdKey: kind.sampleIdKey }, 'Cepa',
  );
  const first = meta.rows[0];
  check('el resolutor de grupos recupera el nivel correcto',
    resolver(first[SAMPLE_ID_HEADER]) === first.Cepa,
    `${first[SAMPLE_ID_HEADER]} → ${resolver(first[SAMPLE_ID_HEADER])}`);
  const levels = new Set(kind.rows.map((r) => r.Cepa));
  check('los cuatro niveles de Cepa sobreviven al viaje',
    levels.size === 4 && ['Control', 'B1', 'B2', 'B3'].every((l) => levels.has(l)));
  const temps = new Set(kind.rows.map((r) => r.Temperatura));
  check('y los dos de Temperatura, aunque sean numéricos', temps.size === 2);
}

{
  // El caso peligroso: TODOS los factores numéricos. Sin columnas de texto, el
  // detector se lo quedaría como tabla de conteos taxón × muestra, porque esa
  // rama se prueba antes y solo pide que el resto sea numérico en >90 %.
  const d = expandDesign({
    factors: [
      { name: 'Temperatura', levels: ['25', '30', '37'] },
      { name: 'pH', levels: ['5', '7'] },
      { name: 'NaCl', levels: ['0', '5'] },
    ],
    biologicalReplicates: 3,
  });
  const { labels } = buildLabels(d.units, '{Temperatura}-{pH}-{NaCl}-R{replica}');
  const meta = buildMetadata(d, {
    labels, unitType: 'matraz',
    unitLayers: d.units.map(() => ([{ medium: 'LB', volume: 50 }])),
    container: 'Erlenmeyer 250 mL',
  });
  const kind = classifyTable(parseTable(metadataText(meta)).headers,
    parseTable(metadataText(meta)).rows, 'metadatos.tsv');
  check('diseño con TODOS los factores numéricos: sigue siendo metadatos',
    kind && kind.kind === 'metadata', kind ? kind.kind : 'null');
}

{
  // Valores con el delimitador dentro: el serializador tiene que entrecomillar.
  const d = expandDesign({
    factors: [{ name: 'Tratamiento', levels: ['Control, sin nada', 'Con "comillas"'] }],
    biologicalReplicates: 3,
  });
  const { labels } = buildLabels(d.units, 'U{n}');
  const meta = buildMetadata(d, { labels, unitType: 'tubo' });
  const back = parseTable(metadataText(meta, ','), ',');
  check('un valor con coma y comillas sobrevive a la ida y vuelta en CSV',
    back.rows[0].Tratamiento === 'Control, sin nada'
    && back.rows.some((r) => r.Tratamiento === 'Con "comillas"'),
    back.rows[0].Tratamiento);
}

{
  // Etiquetas duplicadas: el archivo saldría con dos muestras con el mismo id.
  const d = expandDesign({ factors: FACTORS, biologicalReplicates: 3 });
  const { labels } = buildLabels(d.units, '{Cepa}-R{replica}');
  const meta = buildMetadata(d, { labels, unitType: 'matraz' });
  check('ids repetidos → aviso, no un archivo roto en silencio',
    meta.warnings.includes(METADATA_WARN.DUPLICATE_IDS));
}

{
  // Un factor llamado como una columna reservada.
  const d = expandDesign({
    factors: [{ name: 'replica', levels: ['A', 'B'] }, { name: 'Cepa', levels: ['C', 'B1'] }],
    biologicalReplicates: 3,
  });
  const { labels } = buildLabels(d.units, 'U{n}');
  const meta = buildMetadata(d, { labels, unitType: 'matraz' });
  check('un factor llamado "replica" no pisa la columna reservada',
    meta.headers.includes('replica') && meta.headers.includes('replica_2')
    && meta.warnings.includes(METADATA_WARN.RENAMED_HEADERS));
  check('y los dos valores conviven en la fila',
    meta.rows[0].replica_2 !== undefined && meta.rows[0].replica === 1);
}

check('el serializador entrecomilla solo lo que hace falta',
  toDelimitedText(['a', 'b'], [{ a: 'x', b: 'y,z' }], ',') === 'a,b\nx,"y,z"\n');

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
