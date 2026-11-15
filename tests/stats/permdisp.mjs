// permdisp(distMatrix, groups) → PERMDISP (Anderson 2006), contra
// vegan::betadisper(D, grupo, type = "centroid") + anova().
//
// Los términos ANALÍTICOS (gl, sumas de cuadrados, F, distancia media al
// centroide de cada grupo) se comparan exactos; el p-valor es estocástico
// (PRNG distinto en JS y en R) y se comprueba aparte por cordura.
//
// PROCEDENCIA DEL GOLDEN: calculado con una implementación independiente en
// NumPy de la formulación de Anderson 2006 (doble centrado de Gower → eigh →
// centroide aritmético → corrección de ejes imaginarios → ANOVA), NO con R.
// El `rScript` de abajo es el equivalente exacto en vegan, así que en
// cualquier máquina con R + vegan el runner lo verifica en vivo y detectaría
// cualquier discrepancia. Al confirmarlo contra R, basta cambiar esta nota —
// los números no deberían moverse.
//
// OJO con `type`: el valor por defecto de vegan es "median" (mediana
// espacial); Smart-175 implementa el centroide aritmético, así que el script
// R pide type = "centroid" explícitamente.

import { APP_ROOT, verify, tmp, done, hasR, hasRPackage } from './_shared.mjs';

const { permdisp } = await import(APP_ROOT + '/js/lib/permdisp.js');

// ---------------------------------------------------------------------------
// Caso A — 21 muestras, 3 grupos en un espacio euclídeo 4D con dispersión
// DELIBERADAMENTE distinta por grupo (0.4 / 1.0 / 2.2), para que el test
// tenga señal que detectar. Matriz euclídea ⇒ sin ejes imaginarios.
// ---------------------------------------------------------------------------
function mb(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mb(20261115);
const N = 21;
const GRP = Array.from({ length: N }, (_, i) => 'G' + (Math.floor(i / 7) + 1));
const SPREAD = { G1: 0.4, G2: 1.0, G3: 2.2 };
const CEN = { G1: [0, 0, 0, 0], G2: [1.2, 0.3, 0, 0], G3: [0.2, 1.4, 0.5, 0] };
const P = GRP.map((g) => CEN[g].map((x) => x + (rnd() - 0.5) * SPREAD[g]));
const D = [];
for (let i = 0; i < N; i++) {
  D.push([]);
  for (let j = 0; j < N; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += (P[i][k] - P[j][k]) ** 2;
    D[i].push(Math.sqrt(s));
  }
}

const rA = permdisp(D, GRP, { permutations: 999, seed: 0x5152 });
const jsA = [rA.df1, rA.df2, rA.ssB, rA.ssW, rA.F, ...rA.groupMeans];

const GOLDEN_A = [
  2, 18,
  2.3893077948329209, 0.98063959052907834, 21.92831123807116,
  0.25895134653397173, 0.44222664209838136, 1.0483010781953588,
];

let ok = verify({
  name: 'PERMDISP gl / SS / F / distancia media al centroide vs betadisper',
  js: jsA, golden: GOLDEN_A, tol: 1e-9, rPkg: 'vegan',
  rScript: () => {
    const f = tmp('permdispD.json', JSON.stringify({ D, grp: GRP }));
    return `suppressMessages(library(vegan)); library(jsonlite)
d <- jsonlite::fromJSON("${f}")
bd <- vegan::betadisper(as.dist(d$D), factor(d$grp), type = "centroid")
av <- anova(bd)
m  <- tapply(bd$distances, bd$group, mean)
o  <- c(av$Df[1], av$Df[2], av[["Sum Sq"]][1], av[["Sum Sq"]][2], av$F[1], as.numeric(m[order(names(m))]))
cat(jsonlite::toJSON(o, digits = 16))`;
  },
});

// ---------------------------------------------------------------------------
// Caso B — Bray-Curtis sobre una tabla de conteos: métrica NO euclídea, así
// que la ordenación tiene autovalores negativos y se ejerce la corrección
// z = √|d²_real − d²_imag| (el punto donde una implementación ingenua falla).
// ---------------------------------------------------------------------------
const COUNTS = [
  [50, 10, 5, 2, 1, 0], [45, 12, 6, 1, 2, 1], [60, 8, 3, 4, 0, 1],
  [10, 40, 15, 5, 3, 2], [8, 50, 9, 2, 6, 0], [20, 30, 25, 10, 1, 4],
  [2, 5, 30, 40, 10, 8], [1, 9, 25, 35, 20, 3], [5, 3, 40, 20, 5, 22],
];
const GRP_B = ['A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'C'];
const nB = COUNTS.length;
const DB = [];
for (let i = 0; i < nB; i++) {
  DB.push([]);
  for (let j = 0; j < nB; j++) {
    let num = 0, den = 0;
    for (let k = 0; k < COUNTS[i].length; k++) {
      num += Math.abs(COUNTS[i][k] - COUNTS[j][k]);
      den += COUNTS[i][k] + COUNTS[j][k];
    }
    DB[i].push(num / den);
  }
}

const rB = permdisp(DB, GRP_B, { permutations: 999, seed: 0x5152 });
const jsB = [rB.F, ...rB.distances];
const GOLDEN_B = [
  1.2857876507160135,
  0.031409125759066063, 0.087529546560272856, 0.10323118511174148,
  0.042993772135087815, 0.18696333939171711, 0.20871766813896711,
  0.079961733089456574, 0.17639007194848044, 0.22259977901308559,
];

ok = verify({
  name: 'PERMDISP con ejes imaginarios (Bray-Curtis) vs betadisper',
  js: jsB, golden: GOLDEN_B, tol: 1e-8, rPkg: 'vegan',
  rScript: () => {
    const f = tmp('permdispBC.json', JSON.stringify({ D: DB, grp: GRP_B }));
    return `suppressMessages(library(vegan)); library(jsonlite)
d <- jsonlite::fromJSON("${f}")
bd <- vegan::betadisper(as.dist(d$D), factor(d$grp), type = "centroid")
o  <- c(anova(bd)$F[1], as.numeric(bd$distances))
cat(jsonlite::toJSON(o, digits = 16))`;
  },
}) && ok;

// ---------------------------------------------------------------------------
// Cordura: p, determinismo, ejes negativos y errores
// ---------------------------------------------------------------------------
const checks = [];
const note = (m, pass) => { checks.push(pass); console.log('  ' + (pass ? 'OK  ' : 'FALLA ') + m); };

note('caso A: p en (0, 1]', rA.p > 0 && rA.p <= 1);
note('caso A: dispersiones muy distintas → p < 0.05', rA.p < 0.05);
note('caso A: matriz euclídea → 0 ejes imaginarios', rA.nNegAxes === 0 && rA.negShare === 0);
note('caso A: medias crecientes según la dispersión simulada (G1 < G2 < G3)',
  rA.groupMeans[0] < rA.groupMeans[1] && rA.groupMeans[1] < rA.groupMeans[2]);
note('caso A: ningún par sin comparar (3 grupos → 3 pares)', rA.pairwise.length === 3);
note('caso A: p ajustado ≥ p sin ajustar', rA.pairwise.every((x) => x.pAdj >= x.p - 1e-12));

note('caso B: Bray-Curtis → al menos 1 eje imaginario', rB.nNegAxes >= 1);
note('caso B: la parte imaginaria es una fracción pequeña', rB.negShare > 0 && rB.negShare < 0.05);
note('caso B: dispersiones parecidas → p no significativo (> 0.1)', rB.p > 0.1);

// caso nulo: misma matriz, grupos repartidos de forma que no capturen nada
const nullGroups = Array.from({ length: N }, (_, i) => 'X' + (i % 3));
const rNull = permdisp(D, nullGroups, { permutations: 999, seed: 7 });
note('grupos aleatorios → p no significativo (> 0.1)', rNull.p > 0.1);
note('grupos aleatorios → F mucho menor que el del caso real', rNull.F < rA.F * 0.5);

const rA2 = permdisp(D, GRP, { permutations: 999, seed: 0x5152 });
note('misma semilla → mismo p (determinista)', rA2.p === rA.p);
note('permutations: 0 → p = NaN pero F finito', (() => {
  const r0 = permdisp(D, GRP, { permutations: 0 });
  return Number.isNaN(r0.p) && Number.isFinite(r0.F);
})());
note('p paramétrico coherente con el de permutación (mismo lado de 0.05)',
  (rA.pParam < 0.05) === (rA.p < 0.05));

note('matriz y etiquetas de distinto tamaño → error "size"', permdisp(D, GRP.slice(1), {}).code === 'size');
note('un solo grupo → error "groups"', permdisp(D, GRP.map(() => 'A'), {}).code === 'groups');
note('una muestra por grupo → error "replicates"',
  permdisp(D, GRP.map((_, i) => 'S' + i), {}).code === 'replicates');
note('un grupo con una sola muestra → error "singleton"',
  permdisp(D, GRP.map((g, i) => (i === 0 ? 'SOLO' : g)), {}).code === 'singleton');

if (!hasR() || !hasRPackage('vegan')) {
  console.log('  (R/vegan no disponible: solo modo GOLDEN para la parte analítica)');
}

done('permdisp', ok && checks.every(Boolean));
