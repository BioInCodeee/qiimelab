// tests/stats/phylobootstrap.mjs — soporte bootstrap del árbol (Felsenstein 1985).
//
// Lo que hay que garantizar: que el soporte se calcule sobre PARTICIONES y no
// sobre posiciones de nodo (si no, una réplica enraizada de otra forma daría
// soportes falsos), que sea REPRODUCIBLE con la misma semilla, y que distinga
// una rama real de una que los datos no sostienen.
//
//   node tests/stats/phylobootstrap.mjs

import {
  mulberry32, resampleColumns, splitKey, treeSplits,
  bootstrapSplits, annotateSupport, toNewickWithSupport,
  supportClass, SUPPORT_WEAK, SUPPORT_STRONG,
} from '../../js/lib/phyloBootstrap.js';
import { buildDistanceMatrix } from '../../js/lib/phyloDistance.js';
import { neighborJoining, escapeNewickLabel } from '../../js/lib/neighborJoining.js';

let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

// --- generador reproducible -------------------------------------------------
console.log('generador reproducible');

const r1 = mulberry32(42);
const r2 = mulberry32(42);
check('misma semilla, misma secuencia', [0, 1, 2, 3, 4].every(() => r1() === r2()));
check('semillas distintas, secuencias distintas', mulberry32(1)() !== mulberry32(2)());
const rr = mulberry32(7);
const draws = Array.from({ length: 500 }, () => rr());
check('uniforme en [0,1)', draws.every((v) => v >= 0 && v < 1));
check('media cercana a 0,5', Math.abs(draws.reduce((a, b) => a + b, 0) / draws.length - 0.5) < 0.05,
  (draws.reduce((a, b) => a + b, 0) / draws.length).toFixed(3));

// --- remuestreo de columnas -------------------------------------------------
console.log('\nremuestreo de columnas');

const ALN = ['ACGTACGT', 'ACGTACGA', 'TTTTCCCC'];
const rep = resampleColumns(ALN, mulberry32(3));
check('conserva el número de secuencias y la longitud',
  rep.length === 3 && rep.every((s) => s.length === 8));
check('remuestrea COLUMNAS, no caracteres sueltos (se mantiene la correspondencia)', (() => {
  // cada posición de la réplica tiene que venir de UNA columna del original:
  // la columna (rep[0][k], rep[1][k], rep[2][k]) debe existir en el original
  const cols = new Set();
  for (let k = 0; k < 8; k++) cols.add(ALN.map((s) => s[k]).join(''));
  for (let k = 0; k < 8; k++) {
    if (!cols.has(rep.map((s) => s[k]).join(''))) return false;
  }
  return true;
})());
check('es determinista con la misma semilla',
  resampleColumns(ALN, mulberry32(9)).join('|') === resampleColumns(ALN, mulberry32(9)).join('|'));
check('alineamiento vacío no rompe', resampleColumns([], mulberry32(1)).length === 0);

// --- particiones ------------------------------------------------------------
console.log('\nparticiones (bipartitions)');

check('un conjunto y su complementario son LA MISMA rama',
  splitKey([0, 1], 4) === splitKey([2, 3], 4), splitKey([0, 1], 4) + ' / ' + splitKey([2, 3], 4));
check('la clave canónica excluye el taxón 0', splitKey([0, 1], 4) === '2,3');
check('una sola hoja es trivial', splitKey([2], 4) === '');
check('todos los taxones es trivial', splitKey([0, 1, 2, 3], 4) === '');
check('n-1 taxones es trivial', splitKey([1, 2, 3], 4) === '');
check('el orden de los índices no cambia la clave', splitKey([3, 2], 5) === splitKey([2, 3], 5));

// árbol de 4 taxones con una sola rama interna
const D4 = [
  [0, 0.05, 0.40, 0.42],
  [0.05, 0, 0.41, 0.43],
  [0.40, 0.41, 0, 0.06],
  [0.42, 0.43, 0.06, 0],
];
const t4 = neighborJoining(D4, ['0', '1', '2', '3']);
const s4 = treeSplits(t4, 4);
check('un árbol de 4 taxones tiene 1 partición informativa', s4.size === 1, [...s4].join(' '));
check('y es la que separa los dos pares', s4.has('2,3'), [...s4].join(' '));

// --- bootstrap sobre datos con estructura clara -----------------------------
console.log('\nbootstrap con estructura clara');

// Dos clados de 3 taxones. Dentro de un clado las secuencias difieren en 1-2
// sitios; entre clados difieren en muchos. El bootstrap debería sostener la
// rama que separa los clados prácticamente siempre.
const base = 'ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT';
const other = 'TGCATGCATGCATGCATGCATGCATGCATGCATGCATGCA';
const mut = (s, pos, ch) => s.slice(0, pos) + ch + s.slice(pos + 1);
const CLEAR = [
  base,
  mut(base, 5, 'G'),
  mut(base, 11, 'T'),
  other,
  mut(other, 7, 'A'),
  mut(other, 17, 'C'),
];
const labels6 = CLEAR.map((_, i) => String(i));
const { matrix: dmClear } = buildDistanceMatrix(CLEAR, { correction: 'p' });
const refClear = neighborJoining(dmClear, labels6);
const bootClear = bootstrapSplits(CLEAR, { replicates: 200, seed: 11, correction: 'p' });

check('ninguna réplica falla con datos sanos', bootClear.failed === 0, 'fallidas=' + bootClear.failed);
check('la rama que separa los dos clados tiene soporte alto', (() => {
  const key = splitKey([3, 4, 5], 6);
  const pct = ((bootClear.counts.get(key) || 0) / bootClear.replicates) * 100;
  return pct >= 95;
})(), (() => {
  const key = splitKey([3, 4, 5], 6);
  return (((bootClear.counts.get(key) || 0) / bootClear.replicates) * 100).toFixed(1) + '%';
})());

const annClear = annotateSupport(refClear, bootClear, 6);
check('se anotan los nodos internos', annClear.annotated >= 1, 'anotados=' + annClear.annotated);
check('el soporte queda entre 0 y 100', (() => {
  let ok = true;
  const walk = (n) => {
    if (Number.isFinite(n.support) && (n.support < 0 || n.support > 100)) ok = false;
    (n.children || []).forEach((c) => walk(c.node));
  };
  walk(refClear);
  return ok;
})());
check('la mediana del soporte es alta con datos claros', annClear.median >= 70,
  'mediana=' + annClear.median.toFixed(1));

// --- bootstrap sobre datos sin estructura -----------------------------------
console.log('\nbootstrap sin estructura (control negativo)');

// Seis secuencias equidistantes: no hay agrupación real que sostener, así que
// ninguna partición debería salir con soporte fuerte. Si saliera, el método
// estaría inflando el soporte, que es el error grave en esta dirección.
const rndSeq = (() => {
  const g = mulberry32(99);
  return (len) => Array.from({ length: len }, () => 'ACGT'[Math.floor(g() * 4)]).join('');
})();
const NOISE = Array.from({ length: 6 }, () => rndSeq(60));
const bootNoise = bootstrapSplits(NOISE, { replicates: 200, seed: 5, correction: 'p' });
const maxNoise = Math.max(0, ...[...bootNoise.counts.values()]) / bootNoise.replicates * 100;
check('sin estructura, ninguna rama llega a soporte fuerte', maxNoise < SUPPORT_STRONG,
  'máximo=' + maxNoise.toFixed(1) + '% (umbral fuerte ' + SUPPORT_STRONG + ')');
check('y el soporte máximo del ruido es menor que el de los datos claros', (() => {
  const key = splitKey([3, 4, 5], 6);
  const clearPct = ((bootClear.counts.get(key) || 0) / bootClear.replicates) * 100;
  return maxNoise < clearPct;
})(), 'ruido=' + maxNoise.toFixed(1) + '% vs claro');

// --- reproducibilidad -------------------------------------------------------
console.log('\nreproducibilidad');

const a = bootstrapSplits(CLEAR, { replicates: 50, seed: 123, correction: 'p' });
const b = bootstrapSplits(CLEAR, { replicates: 50, seed: 123, correction: 'p' });
const asStr = (x) => [...x.counts.entries()].sort().map(([k, v]) => k + '=' + v).join(';');
check('misma semilla → soportes idénticos', asStr(a) === asStr(b));
const c = bootstrapSplits(CLEAR, { replicates: 50, seed: 124, correction: 'p' });
check('semilla distinta → remuestreo distinto', asStr(a) !== asStr(c));
check('se respeta el número de réplicas', a.replicates === 50);
check('la corrección Jukes-Cantor también funciona', (() => {
  const j = bootstrapSplits(CLEAR, { replicates: 30, seed: 1, correction: 'jc' });
  return j.failed === 0 && j.counts.size > 0;
})());
check('el progreso se informa hasta el final', (() => {
  let last = 0;
  bootstrapSplits(CLEAR, { replicates: 10, seed: 1, onProgress: (d, tt) => { last = d === tt ? tt : last; } });
  return last === 10;
})());

// --- Newick con soporte -----------------------------------------------------
console.log('\nNewick con soporte');

const nwk = toNewickWithSupport(refClear, escapeNewickLabel);
check('termina en punto y coma', nwk.endsWith(';'));
check('paréntesis balanceados', (() => {
  let d = 0;
  for (const ch of nwk) { if (ch === '(') d++; if (ch === ')') d--; if (d < 0) return false; }
  return d === 0;
})());
check('lleva al menos un valor de soporte tras un paréntesis de cierre', /\)\d+/.test(nwk), nwk.slice(0, 70) + '…');
check('aparecen todas las hojas', labels6.every((l) => nwk.includes(l)));

// --- umbrales de lectura ----------------------------------------------------
console.log('\numbrales de lectura');

check('>= 95 es soporte fuerte', supportClass(95) === 'strong' && supportClass(100) === 'strong');
check('entre 70 y 95 es moderado', supportClass(70) === 'moderate' && supportClass(94.9) === 'moderate');
check('< 70 es débil', supportClass(69.9) === 'weak' && supportClass(0) === 'weak');
check('sin dato → none', supportClass(NaN) === 'none' && supportClass(undefined) === 'none');
check('los umbrales son los de la literatura', SUPPORT_WEAK === 70 && SUPPORT_STRONG === 95);

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
