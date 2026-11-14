// tests/heattree.mjs — heat-tree con topología compartida (js/lib/heatTree.js).
//
// Lo que de verdad hay que garantizar aquí es la COMPARABILIDAD: si dos
// paneles no comparten exactamente la misma topología y las mismas posiciones,
// la figura miente aunque los números estén bien. De ahí que buena parte de
// estas comprobaciones sean de determinismo e invariantes de la disposición,
// no solo de aritmética.
//
//   node tests/heattree.mjs

import {
  parseTaxonPath, buildReferenceTree, abundanceByNode, compareTwoGroups,
  leafOrder, layoutDendrogram, layoutRadial, cullLabels, topContrastRows,
} from '../js/lib/heatTree.js';
import { kruskalWallis, benjaminiHochberg } from '../js/lib/stats.js';

let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

// --- parseo de la cadena taxonómica -----------------------------------------
console.log('parseo de la cadena taxonómica');

check('prefijos de rango fuera', JSON.stringify(parseTaxonPath('k__Bacteria;p__Firmicutes;c__Bacilli')) ===
  JSON.stringify(['Bacteria', 'Firmicutes', 'Bacilli']));
check('tolera espacios tras el punto y coma',
  JSON.stringify(parseTaxonPath('k__Bacteria; p__Firmicutes')) === JSON.stringify(['Bacteria', 'Firmicutes']));
check('sin prefijos también vale',
  JSON.stringify(parseTaxonPath('Bacteria;Firmicutes')) === JSON.stringify(['Bacteria', 'Firmicutes']));
check('un rango vacío corta el camino',
  JSON.stringify(parseTaxonPath('k__Bacteria;p__Firmicutes;c__;o__Lactobacillales')) ===
  JSON.stringify(['Bacteria', 'Firmicutes']),
  JSON.stringify(parseTaxonPath('k__Bacteria;p__Firmicutes;c__;o__Lactobacillales')));
check('«unclassified» corta el camino',
  JSON.stringify(parseTaxonPath('k__Bacteria;p__unclassified;c__Bacilli')) === JSON.stringify(['Bacteria']));
check('cadena vacía o nula → camino vacío',
  parseTaxonPath('').length === 0 && parseTaxonPath(null).length === 0 && parseTaxonPath(undefined).length === 0);

// --- árbol de referencia ----------------------------------------------------
console.log('\nárbol de referencia');

const TAXA = [
  'k__Bacteria;p__Firmicutes;g__Bacillus',
  'k__Bacteria;p__Firmicutes;g__Lactobacillus',
  'k__Bacteria;p__Actinobacteria;g__Streptomyces',
  'k__Bacteria;p__Proteobacteria;g__Pseudomonas',
];
const tree = buildReferenceTree(TAXA);

check('un nodo por rango distinto, más la raíz', tree.nodes.length === 1 + 1 + 3 + 4,
  'nodos=' + tree.nodes.length);
check('profundidad máxima correcta', tree.depth === 3, 'depth=' + tree.depth);
check('los filos están en orden alfabético, no de aparición',
  tree.byId.get('Bacteria').children.map((c) => c.name).join(',') === 'Actinobacteria,Firmicutes,Proteobacteria',
  tree.byId.get('Bacteria').children.map((c) => c.name).join(','));
check('un nodo conoce todos los taxones que cuelgan de él',
  tree.byId.get('Bacteria;Firmicutes').taxa.length === 2);
check('cada taxón apunta a su nodo hoja',
  tree.leavesByTaxon.get(TAXA[0]).id === 'Bacteria;Firmicutes;Bacillus');

// DETERMINISMO: el mismo dataset en otro orden da el mismo árbol
const shuffled = [TAXA[2], TAXA[0], TAXA[3], TAXA[1]];
const tree2 = buildReferenceTree(shuffled);
check('el orden de entrada no cambia la topología',
  tree.nodes.map((n) => n.id).join('|') === tree2.nodes.map((n) => n.id).join('|'));

// Un taxón que solo llega a filo no inventa género
const treeShort = buildReferenceTree(TAXA.concat(['k__Bacteria;p__Firmicutes']));
check('un taxón que solo llega a filo no crea nodos nuevos',
  treeShort.nodes.length === tree.nodes.length, 'nodos=' + treeShort.nodes.length);
check('pero sí cuenta como taxón de ese filo',
  treeShort.byId.get('Bacteria;Firmicutes').taxa.length === 3);

// --- agregación de abundancia -----------------------------------------------
console.log('\nagregación de abundancia');

const TABLE = {
  headers: ['muestra'].concat(TAXA),
  rows: [
    { muestra: 'S1', [TAXA[0]]: 10, [TAXA[1]]: 5, [TAXA[2]]: 1, [TAXA[3]]: 0 },
    { muestra: 'S2', [TAXA[0]]: 20, [TAXA[1]]: 0, [TAXA[2]]: 2, [TAXA[3]]: 8 },
  ],
};
const ab = abundanceByNode(tree, TABLE, 'muestra');

check('una fila por muestra, en orden', ab.bySample.join(',') === 'S1,S2');
check('la hoja lleva su propio valor', ab.values.get('Bacteria;Firmicutes;Bacillus').join(',') === '10,20');
check('el nodo interno suma sus descendientes',
  ab.values.get('Bacteria;Firmicutes').join(',') === '15,20',
  ab.values.get('Bacteria;Firmicutes').join(','));
check('la raíz del reino suma todo',
  ab.values.get('Bacteria').join(',') === '16,30', ab.values.get('Bacteria').join(','));
check('un taxón ausente en una muestra no rompe nada',
  ab.values.get('Bacteria;Proteobacteria;Pseudomonas').join(',') === '0,8');
check('una columna que no es taxón se ignora', (() => {
  const t2 = { headers: TABLE.headers.concat(['pH']), rows: TABLE.rows.map((r) => ({ ...r, pH: 7 })) };
  const a2 = abundanceByNode(tree, t2, 'muestra');
  return a2.values.get('Bacteria').join(',') === '16,30';
})());
check('la suma por muestra del nivel de filo = total de la muestra', (() => {
  const phyla = ['Bacteria;Actinobacteria', 'Bacteria;Firmicutes', 'Bacteria;Proteobacteria'];
  const s0 = phyla.reduce((a, id) => a + ab.values.get(id)[0], 0);
  const s1 = phyla.reduce((a, id) => a + ab.values.get(id)[1], 0);
  return s0 === 16 && s1 === 30;
})());

// --- contraste de dos grupos ------------------------------------------------
console.log('\ncontraste de dos grupos');

// dataset con una señal clara en un género y ninguna en otro
const GT = ['k__B;p__P1;g__Sube', 'k__B;p__P2;g__Plano'];
const gtree = buildReferenceTree(GT);
const gtable = {
  headers: ['muestra'].concat(GT),
  rows: [
    { muestra: 'A1', [GT[0]]: 1, [GT[1]]: 50 },
    { muestra: 'A2', [GT[0]]: 2, [GT[1]]: 52 },
    { muestra: 'A3', [GT[0]]: 1, [GT[1]]: 48 },
    { muestra: 'B1', [GT[0]]: 40, [GT[1]]: 51 },
    { muestra: 'B2', [GT[0]]: 44, [GT[1]]: 49 },
    { muestra: 'B3', [GT[0]]: 38, [GT[1]]: 50 },
  ],
};
const gab = abundanceByNode(gtree, gtable, 'muestra');
const cmp = compareTwoGroups(gab, ['A1', 'A2', 'A3'], ['B1', 'B2', 'B3']);

const up = cmp.results.get('B;P1;Sube');
const flat = cmp.results.get('B;P2;Plano');
check('el género con señal sale con p pequeña', up && up.p < 0.05, 'p=' + (up ? up.p.toFixed(4) : '—'));
check('el género plano no sale significativo', flat && flat.p > 0.05, 'p=' + (flat ? flat.p.toFixed(4) : '—'));
check('el signo del log2FC apunta al grupo correcto', up && up.log2fc < 0,
  'log2fc=' + (up ? up.log2fc.toFixed(2) : '—'));
// El log2FC verdadero es log2(1.333/40.667) = -4.93. El pseudoconteo lo encoge
// algo, inevitablemente, pero no debe comerse la mitad de la señal: con el
// valor mínimo de la tabla (1 -> pseudoconteo 0,5) se queda muy cerca.
check('el pseudoconteo no encoge el log2FC a la mitad',
  up && Math.abs(up.log2fc) > 4.3, 'log2fc=' + (up ? up.log2fc.toFixed(2) : '—') + ' (real -4.93)');
check('el log2FC del género plano es ~0', flat && Math.abs(flat.log2fc) < 0.1,
  'log2fc=' + (flat ? flat.log2fc.toFixed(3) : '—'));

check('la p coincide exactamente con kruskalWallis de dos grupos', (() => {
  const a = [1, 2, 1]; const b = [40, 44, 38];
  return Math.abs(up.p - kruskalWallis([a, b]).p) < 1e-12;
})());

check('la corrección BH se aplica sobre todos los nodos probados a la vez', (() => {
  const ps = [];
  cmp.results.forEach((r) => { if (Number.isFinite(r.p)) ps.push(r.p); });
  const expected = benjaminiHochberg(ps);
  const got = [];
  cmp.results.forEach((r) => { if (Number.isFinite(r.p)) got.push(r.q); });
  // mismo multiconjunto de valores q
  return ps.length === cmp.tested &&
    expected.slice().sort().join(',') === got.slice().sort().join(',');
})(), 'probados=' + cmp.tested);

check('q >= p siempre', (() => {
  let ok = true;
  cmp.results.forEach((r) => { if (Number.isFinite(r.p) && Number.isFinite(r.q) && r.q < r.p - 1e-12) ok = false; });
  return ok;
})());

check('el pseudoconteo se declara en la salida y es del orden del minimo',
  Number.isFinite(cmp.pseudocount) && cmp.pseudocount === 0.5,
  'pseudocount=' + cmp.pseudocount);

check('un grupo con una sola muestra no se prueba', (() => {
  const c = compareTwoGroups(gab, ['A1'], ['B1', 'B2', 'B3']);
  return c.tested === 0;
})());

check('abundancia 0 en un grupo no produce log2FC infinito', (() => {
  const zt = ['k__B;p__P;g__Solo'];
  const ztree = buildReferenceTree(zt);
  const ztable = {
    headers: ['muestra', zt[0]],
    rows: [
      { muestra: 'A1', [zt[0]]: 0 }, { muestra: 'A2', [zt[0]]: 0 }, { muestra: 'A3', [zt[0]]: 0 },
      { muestra: 'B1', [zt[0]]: 10 }, { muestra: 'B2', [zt[0]]: 12 }, { muestra: 'B3', [zt[0]]: 11 },
    ],
  };
  const zab = abundanceByNode(ztree, ztable, 'muestra');
  const zc = compareTwoGroups(zab, ['A1', 'A2', 'A3'], ['B1', 'B2', 'B3']);
  const r = zc.results.get('B;P;Solo');
  return r && Number.isFinite(r.log2fc) && r.log2fc < 0;
})());

// --- disposición ------------------------------------------------------------
console.log('\ndisposición');

const pos = layoutDendrogram(tree);
check('todas las hojas y nodos internos tienen posición', pos.size === tree.nodes.length,
  pos.size + ' vs ' + tree.nodes.length);
check('x crece con la profundidad', (() => {
  let ok = true;
  tree.nodes.forEach((n) => { if (n.depth > 0 && pos.get(n.id).x !== n.depth / tree.depth) ok = false; });
  return ok;
})());
check('un nodo interno está centrado sobre sus hijos', (() => {
  const f = tree.byId.get('Bacteria;Firmicutes');
  const ys = f.children.map((c) => pos.get(c.id).y);
  return Math.abs(pos.get(f.id).y - (Math.min(...ys) + Math.max(...ys)) / 2) < 1e-12;
})());
check('las hojas reparten el eje y entre 0 y 1', (() => {
  const ys = leafOrder(tree).map((n) => pos.get(n.id).y);
  return Math.min(...ys) === 0 && Math.max(...ys) === 1 && ys.length === 4;
})());

// TOPOLOGÍA COMPARTIDA: la posición de un clado no depende de los datos
check('las posiciones no dependen de la abundancia (son del árbol, no del panel)', (() => {
  const p2 = layoutDendrogram(tree2);
  let same = true;
  pos.forEach((p, id) => {
    const o = p2.get(id);
    if (!o || Math.abs(o.x - p.x) > 1e-12 || Math.abs(o.y - p.y) > 1e-12) same = false;
  });
  return same;
})());

const rad = layoutRadial(tree);
check('la radial cae dentro del círculo unidad', (() => {
  let ok = true;
  rad.forEach((p) => { if (Math.sqrt(p.x * p.x + p.y * p.y) > 1 + 1e-9) ok = false; });
  return ok;
})());
check('la raíz radial está en el centro', (() => {
  const r = rad.get('');
  return Math.abs(r.x) < 1e-12 && Math.abs(r.y) < 1e-12;
})());
check('el radio radial es la profundidad normalizada', (() => {
  const g = rad.get('Bacteria;Firmicutes;Bacillus');
  return Math.abs(g.radius - 1) < 1e-12;
})());
check('la radial conserva el orden de hojas de la dendrograma', (() => {
  const leaves = leafOrder(tree);
  const angles = leaves.map((n) => rad.get(n.id).angle);
  for (let i = 1; i < angles.length; i++) if (angles[i] <= angles[i - 1]) return false;
  return true;
})());

// --- etiquetas --------------------------------------------------------------
console.log('\nselección de etiquetas');

const weight = new Map();
tree.nodes.forEach((n, i) => { if (n.depth > 0) weight.set(n.id, i); });

check('respeta el máximo de etiquetas',
  cullLabels(tree.nodes, pos, weight, { maxLabels: 3, minSeparation: 0 }).size === 3);
check('no etiqueta la raíz',
  !cullLabels(tree.nodes, pos, weight, { maxLabels: 99, minSeparation: 0 }).has(''));
check('respeta el límite de profundidad', (() => {
  const keep = cullLabels(tree.nodes, pos, weight, { maxDepth: 2, maxLabels: 99, minSeparation: 0 });
  let ok = true;
  keep.forEach((id) => { if (tree.byId.get(id).depth > 2) ok = false; });
  return ok;
})());
check('descarta las que caen demasiado cerca', (() => {
  const todas = cullLabels(tree.nodes, pos, weight, { maxLabels: 99, minSeparation: 0 }).size;
  const pocas = cullLabels(tree.nodes, pos, weight, { maxLabels: 99, minSeparation: 2 }).size;
  return pocas < todas && pocas >= 1;
})());
check('gana la de más peso cuando dos compiten', (() => {
  const w = new Map([['Bacteria', 1], ['Bacteria;Firmicutes', 100]]);
  const keep = cullLabels(tree.nodes, pos, w, { maxLabels: 1, minSeparation: 0 });
  return keep.has('Bacteria;Firmicutes');
})());
check('es determinista con pesos empatados', (() => {
  const w = new Map(tree.nodes.filter((n) => n.depth > 0).map((n) => [n.id, 1]));
  const a = [...cullLabels(tree.nodes, pos, w, { maxLabels: 3, minSeparation: 0 })].join(',');
  const b = [...cullLabels(tree.nodes, pos, w, { maxLabels: 3, minSeparation: 0 })].join(',');
  return a === b;
})());

// --- vista en tabla ---------------------------------------------------------
console.log('\nvista en tabla del contraste');

const rows = topContrastRows(cmp, gtree, { limit: 25, maxQ: 1 });
check('devuelve una fila por nodo probado', rows.length === cmp.tested,
  rows.length + ' vs ' + cmp.tested);
check('ordenadas por q ascendente', (() => {
  for (let i = 1; i < rows.length; i++) if (rows[i].q < rows[i - 1].q - 1e-12) return false;
  return true;
})());
check('cada fila trae nombre, camino y rango',
  rows.every((r) => r.name && r.path.includes('›') === (r.depth > 1) && Number.isFinite(r.depth)));
check('el filtro por q descarta lo no significativo',
  topContrastRows(cmp, gtree, { maxQ: 0.0001 }).length < rows.length);
check('respeta el limite de filas', topContrastRows(cmp, gtree, { limit: 2, maxQ: 1 }).length === 2);
// El genero con senal sale primero por q. Ojo: con n=3 por grupo y 5 nodos
// probados, BH sube su q de 0,046 a 0,23, asi que con maxQ=0,05 la tabla sale
// VACIA. Es estadistica correcta y no un fallo: ese es el precio de corregir
// por comparaciones multiples con pocas muestras, y la tabla debe decirlo en
// vez de ensenar un hallazgo que no aguanta la correccion.
// La primera fila es del linaje con senal. Sale el FILO, no el genero,
// porque ese filo solo tiene ese genero debajo: su abundancia es identica y
// empata en q. Eso es correcto -- la senal esta en toda la rama -- y es justo
// lo que un heat-tree deja ver de un vistazo y una tabla de generos esconde.
check('la primera fila por q pertenece al linaje con senal',
  rows[0] && rows[0].path.includes('P1'),
  rows[0] ? rows[0].path + ' q=' + rows[0].q.toFixed(3) : 'sin filas');
check('el genero con senal tambien esta entre las primeras',
  rows.slice(0, 2).some((r) => r.name === 'Sube'),
  rows.slice(0, 2).map((r) => r.name).join(','));
check('con pocas muestras, el umbral del 5 % deja la tabla vacia',
  topContrastRows(cmp, gtree, { maxQ: 0.05 }).length === 0);
check('un nodo sin q no aparece', (() => {
  const fake = { results: new Map([['X', { q: NaN, p: NaN, log2fc: 0 }]]) };
  return topContrastRows(fake, gtree, { maxQ: 1 }).length === 0;
})());

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
