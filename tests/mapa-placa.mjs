// tests/mapa-placa.mjs — #/mapa-placa: direccionamiento de pocillos, relleno,
// autorrelleno desde el diseño y conversión a tabla (plateMap.js).
//
// Todo es combinatoria de rejilla, así que la verdad de referencia se escribe
// a mano. Los casos cubren lo que rompe un mapa de placa de verdad:
//   - confundir el orden por filas con el orden por columnas al cargar series
//   - exportar 372 filas vacías de una placa de 384 con 12 pocillos usados
//   - cargar un CSV con pocillos que no existen en el formato elegido
//   - colocar siempre los controles en la primera columna
//
//   node tests/mapa-placa.mjs

import {
  PLATE_FORMATS, plateGrid, wellId, parseWellId, allWells, wellsInBlock,
  fillSeries, fillConstant, autofillFromDesign, edgeWells, innerWells,
  mapToTable, tableToMap, PLATE_TABLE_HEADERS,
} from '../js/lib/plateMap.js';
import { expandDesign } from '../js/lib/designExpand.js';
import { buildLabels, randomizeOrder } from '../js/lib/labelScheme.js';
import { buildMetadata, metadataText } from '../js/lib/designMetadata.js';
import { parseTable } from '../js/lib/csv.js';
import { classifyTable } from '../js/lib/ingest.js';

let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed = true;
};

// =============================================================================
console.log('\ndireccionamiento de pocillos');
// =============================================================================

check('los seis formatos comerciales están',
  [6, 12, 24, 48, 96, 384].every((f) => PLATE_FORMATS[f]));
check('cada formato cuadra filas × columnas',
  Object.entries(PLATE_FORMATS).every(([n, g]) => g.rows * g.cols === Number(n)));

check('(0,0) → A1', wellId(0, 0) === 'A1');
check('96: el último es H12', wellId(7, 11) === 'H12'
  && allWells(96).at(-1) === 'H12');
check('384: 16 filas, el último es P24', wellId(15, 23) === 'P24'
  && allWells(384).at(-1) === 'P24');
check('6 pocillos: el último es B3', allWells(6).at(-1) === 'B3');
check('24 pocillos: el último es D6', allWells(24).at(-1) === 'D6');
check('48 pocillos: el último es F8', allWells(48).at(-1) === 'F8');
check('12 pocillos: el último es C4', allWells(12).at(-1) === 'C4');

check('cada formato devuelve tantos pocillos como dice su nombre',
  [6, 12, 24, 48, 96, 384].every((f) => allWells(f).length === f));

check('A1 vuelve a (0,0)', JSON.stringify(parseWellId('A1')) === '{"row":0,"col":0}');
check('H12 vuelve a (7,11)', JSON.stringify(parseWellId('h12')) === '{"row":7,"col":11}');
check('un identificador inventado → null',
  parseWellId('Z') === null && parseWellId('12A') === null && parseWellId('') === null);
check('un formato inexistente lanza', (() => {
  try { plateGrid(100); return false; } catch { return true; }
})());

check('el orden natural es por filas (A1, A2, A3…)',
  allWells(96).slice(0, 3).join(',') === 'A1,A2,A3');

// =============================================================================
console.log('\nbloques y dirección de relleno');
// =============================================================================

{
  const block = wellsInBlock(96, 'B2', 'D4');
  check('un bloque de 3 × 3 tiene 9 pocillos', block.length === 9);
  check('por filas: B2, B3, B4, C2…',
    block.slice(0, 4).join(',') === 'B2,B3,B4,C2', block.slice(0, 4).join(','));

  const byCol = wellsInBlock(96, 'B2', 'D4', { direction: 'column' });
  check('por columnas: B2, C2, D2, B3…',
    byCol.slice(0, 4).join(',') === 'B2,C2,D2,B3', byCol.slice(0, 4).join(','));
  check('los dos órdenes contienen los mismos pocillos',
    [...block].sort().join(',') === [...byCol].sort().join(','));
}

check('las esquinas valen en cualquier orden',
  wellsInBlock(96, 'D4', 'B2').join(',') === wellsInBlock(96, 'B2', 'D4').join(','));
check('un bloque que se sale se recorta al formato',
  wellsInBlock(24, 'A1', 'H12').length === 24);

// =============================================================================
console.log('\nseries y relleno constante');
// =============================================================================

{
  const col1 = wellsInBlock(96, 'A1', 'H1', { direction: 'column' });
  const serie = fillSeries(col1, { prefix: 'STD ' });
  check('la curva patrón se numera por columnas, A1 → STD 1',
    serie.A1 === 'STD 1' && serie.H1 === 'STD 8');

  const fila = wellsInBlock(96, 'A1', 'A12');
  const muestras = fillSeries(fila, { prefix: 'Muestra ' });
  check('una serie por filas numera A1…A12',
    muestras.A1 === 'Muestra 1' && muestras.A12 === 'Muestra 12');

  check('el paso y el inicio son configurables',
    fillSeries(['A1', 'A2'], { prefix: 'D', start: 10, step: 10 }).A2 === 'D20');
  check('el relleno con ceros a la izquierda',
    fillSeries(['A1'], { prefix: 'S', pad: 3 }).A1 === 'S001');

  const ctrl = fillConstant(['A1', 'B1'], 'Control');
  check('relleno constante', ctrl.A1 === 'Control' && ctrl.B1 === 'Control');
}

// =============================================================================
console.log('\nborde e interior');
// =============================================================================

check('96 pocillos: 36 en el borde, 60 dentro',
  edgeWells(96).length === 36 && innerWells(96).length === 60);
check('el borde incluye las cuatro esquinas',
  ['A1', 'A12', 'H1', 'H12'].every((w) => edgeWells(96).includes(w)));
check('el interior empieza en B2', innerWells(96)[0] === 'B2');
check('borde + interior = la placa entera',
  edgeWells(96).length + innerWells(96).length === 96);

// =============================================================================
console.log('\nautorrelleno desde el diseño');
// =============================================================================

{
  const d = expandDesign({
    factors: [
      { name: 'Cepa', levels: ['Control', 'B1', 'B2', 'B3'] },
      { name: 'Dosis', levels: ['0', '1', '10'] },
    ],
    biologicalReplicates: 3,
  });
  check('36 unidades', d.unitCount === 36);
  const { labels } = buildLabels(d.units, '{Cepa}-{Dosis}-R{replica}');
  const { order } = randomizeOrder(d.units, 11);

  const fill = autofillFromDesign(96, labels, { order });
  check('las 36 unidades caben y se colocan', fill.placed === 36 && fill.overflow === 0);
  check('ninguna etiqueta se repite en la placa',
    new Set(Object.values(fill.assignments)).size === 36);
  check('están todas las unidades del diseño',
    new Set(Object.values(fill.assignments)).size === new Set(labels).size);
  check('no coloca los controles todos en la primera columna',
    !['A1', 'B1', 'C1', 'D1'].every((w) => String(fill.assignments[w] || '').startsWith('Control')));

  const inner = autofillFromDesign(96, labels, { order, wells: innerWells(96) });
  check('se puede excluir el borde y siguen cabiendo',
    inner.placed === 36 && Object.keys(inner.assignments).every((w) => !edgeWells(96).includes(w)));

  const small = autofillFromDesign(24, labels, { order });
  check('en una placa de 24 sobran 12 unidades y se dice',
    small.placed === 24 && small.overflow === 12);
}

// =============================================================================
console.log('\ntabla: ida y vuelta');
// =============================================================================

{
  const map = {
    A1: { etiqueta: 'Control', contenido: '0,1 % DMSO', grupo: 'Vehículo', color: '#1E40AF' },
    B2: { etiqueta: 'Fármaco X', contenido: '10 µM', grupo: 'Tratamiento', color: '#D97706' },
    H12: { etiqueta: 'Blanco', contenido: '', grupo: '', color: '' },
  };
  const { headers, rows } = mapToTable(map, 96);
  check('las cabeceras son las esperadas', headers.join(',') === PLATE_TABLE_HEADERS.join(','));
  check('solo salen los pocillos con algo puesto', rows.length === 3);
  check('en orden de lectura', rows.map((r) => r.pocillo).join(',') === 'A1,B2,H12');
  check('fila y columna se desglosan',
    rows[1].fila === 'B' && rows[1].columna === 2);

  const back = tableToMap(rows, 96);
  check('ida y vuelta sin pérdida',
    back.map.A1.contenido === '0,1 % DMSO'
    && back.map.B2.color === '#D97706'
    && back.map.H12.etiqueta === 'Blanco');
  check('y sin inventarse pocillos', Object.keys(back.map).length === 3);
}

{
  // Una placa de 384 con 12 pocillos usados no debe exportar 372 filas vacías.
  const map = {};
  allWells(384).slice(0, 12).forEach((w) => { map[w] = { etiqueta: 'X' }; });
  allWells(384).slice(12, 40).forEach((w) => { map[w] = { etiqueta: '', contenido: '' }; });
  check('los pocillos vacíos no se exportan', mapToTable(map, 384).rows.length === 12);
}

{
  // Un CSV de una placa de 96 cargado sobre un formato de 24.
  const rows = [{ pocillo: 'A1', etiqueta: 'ok' }, { pocillo: 'H12', etiqueta: 'fuera' },
    { pocillo: 'ZZ9', etiqueta: 'inválido' }];
  const res = tableToMap(rows, 24);
  check('los pocillos que no existen en el formato se descartan y se cuentan',
    Object.keys(res.map).length === 1 && res.ignored === 2);
}

// =============================================================================
console.log('\nenlace con los metadatos');
// =============================================================================

{
  const d = expandDesign({
    factors: [
      { name: 'Cepa', levels: ['Control', 'B1', 'B2', 'B3'] },
      { name: 'Dosis', levels: ['0', '1', '10'] },
    ],
    biologicalReplicates: 3,
  });
  const { labels } = buildLabels(d.units, '{Cepa}-{Dosis}-R{replica}');
  const { order } = randomizeOrder(d.units, 11);
  const fill = autofillFromDesign(96, labels, { order, wells: innerWells(96) });

  // pocillo de cada unidad, en orden de unidad
  const wellOfUnit = [];
  Object.entries(fill.assignments).forEach(([well, label]) => {
    wellOfUnit[labels.indexOf(label)] = well;
  });

  const meta = buildMetadata(d, {
    labels, order, unitType: 'pocillo', wells: wellOfUnit,
    unitLayers: d.units.map(() => ([{ medium: 'LB', volume: 0.2 }])),
    container: 'Placa de 96',
  });
  check('los metadatos ganan la columna pocillo', meta.headers.includes('pocillo'));
  check('cada unidad lleva el suyo y ninguno se repite',
    new Set(meta.rows.map((r) => r.pocillo)).size === 36);
  check('y ninguno cae en el borde',
    meta.rows.every((r) => !edgeWells(96).includes(r.pocillo)));

  const parsed = parseTable(metadataText(meta));
  const kind = classifyTable(parsed.headers, parsed.rows, 'metadatos.tsv');
  check('el lector del repo sigue reconociéndolos como metadatos',
    kind && kind.kind === 'metadata', kind ? kind.kind : 'null');
}

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
