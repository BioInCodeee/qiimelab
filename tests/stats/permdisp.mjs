// permdisp(distMatrix, groups) → PERMDISP (Anderson 2006), contra
// vegan::betadisper(type = "centroid") + anova()/permutest().
//
// La validación tiene dos patas, y la primera es la que de verdad demuestra
// que el algoritmo es correcto:
//
//   1. CASO EUCLÍDEO, comprobación ANALÍTICA. Si la matriz de distancias se
//      construye como distancias euclídeas de una nube de puntos conocida, el
//      PCoA recupera esa nube salvo rotación y traslación, y la distancia de
//      cada punto al centroide de su grupo es invariante a ambas. Es decir:
//      z_i tiene que coincidir EXACTAMENTE con ||P_i − centroide(grupo_i)||
//      calculado sobre las coordenadas originales. Eso contrasta de una vez el
//      doble centrado de Gower, la descomposición en autovectores y el cálculo
//      de centroides, sin depender de ninguna otra implementación.
//
//   2. CASO NO EUCLÍDEO (Bray-Curtis), donde aparecen autovalores negativos y
//      entra la corrección de ejes imaginarios. Ahí no hay referencia cerrada,
//      así que se comprueban invariantes (z finitos, orden de dispersión
//      recuperado, caso nulo no significativo) y se deja el contraste exacto a
//      la comparación en vivo con vegan.
//
// El GOLDEN embebido es el resultado del caso euclídeo, que es el mismo número
// que devuelve R. Los p-valores por permutación son estocásticos (PRNG
// distinto en JS y en R) y se comprueban aparte por rango, igual que en
// permanova.mjs.

import { verify, tmp, done, hasR, hasRPackage, APP_ROOT } from './_shared.mjs';

const { permdisp } = await import(APP_ROOT + '/js/lib/permdisp.js');

function mb(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- caso euclídeo
// 24 muestras, 3 grupos de 8, MISMO centro y dispersión deliberadamente
// distinta (0.4 / 1.0 / 2.2): es el escenario que PERMDISP debe detectar y
// PERMANOVA no.
const rnd = mb(20261114);
const N = 24, K = 4;
const GRP = Array.from({ length: N }, (_, i) => 'G' + (Math.floor(i / 8) + 1));
const SPREAD = { G1: 0.4, G2: 1.0, G3: 2.2 };
const P = GRP.map((g) => Array.from({ length: K }, () => (rnd() - 0.5) * SPREAD[g]));
const D = P.map((pi) => P.map((pj) => Math.sqrt(pi.reduce((s, v, k) => s + (v - pj[k]) ** 2, 0))));

const r = permdisp(D, GRP, { permutations: 999, seed: 0x7D15 });
const js = [r.df1, r.df2, r.F, ...r.groupMeans, ...r.groupSDs];

// GOLDEN: caso euclídeo (analítico; vegan::betadisper(type="centroid") da lo mismo)
const GOLDEN = [
  2, 21, 31.17308713571551,
  0.20095888894567376, 0.5254401763540887, 1.1323040067124484,
  0.0409796654563917, 0.21410951513802626, 0.35291096426940727,
];

let ok = verify({
  name: 'PERMDISP Df / F / medias y SD de las distancias al centroide vs betadisper',
  js, golden: GOLDEN, tol: 1e-9, rPkg: 'vegan',
  rScript: () => {
    const f = tmp('permdispD.json', JSON.stringify({ D, grp: GRP }));
    return `suppressMessages(library(vegan)); library(jsonlite)
d <- jsonlite::fromJSON("${f}")
g <- factor(d$grp)
disp <- vegan::betadisper(as.dist(d$D), g, type = "centroid")
a <- anova(disp)
m <- tapply(disp$distances, g, mean)
s <- tapply(disp$distances, g, sd)
o <- c(a$Df[1], a$Df[2], a$"F value"[1], as.numeric(m), as.numeric(s))
cat(jsonlite::toJSON(o, digits = 16))`;
  },
});

const checks = [];
const note = (m, pass) => { checks.push(pass); console.log('  ' + (pass ? 'OK  ' : 'FALLA ') + m); };

// --- pata 1: la comprobación analítica
const centroid = {};
['G1', 'G2', 'G3'].forEach((g) => {
  const idx = GRP.map((x, i) => [x, i]).filter(([x]) => x === g).map(([, i]) => i);
  centroid[g] = Array.from({ length: K }, (_, k) => idx.reduce((s, i) => s + P[i][k], 0) / idx.length);
});
const zAnalytic = P.map((p, i) => Math.sqrt(p.reduce((s, v, k) => s + (v - centroid[GRP[i]][k]) ** 2, 0)));
const maxErr = Math.max(...r.distances.map((v, i) => Math.abs(v - zAnalytic[i])));
note('z_i = ||P_i − centroide|| exacto en el caso euclídeo (error < 1e-12): ' + maxErr.toExponential(2), maxErr < 1e-12);
note('matriz euclídea → 0 ejes imaginarios', r.nNegativeAxes === 0);
note('ejes reales = dimensión de la nube (4)', r.nPositiveAxes === K);

// --- p-valores y cordura
note('p en (0, 1]', r.p > 0 && r.p <= 1);
note('dispersiones muy distintas → p < 0.05', r.p < 0.05);
note('orden de dispersión recuperado (G1 < G2 < G3)',
  r.groupMeans[0] < r.groupMeans[1] && r.groupMeans[1] < r.groupMeans[2]);
note('misma semilla → mismo p (determinista)', permdisp(D, GRP, { permutations: 999, seed: 0x7D15 }).p === r.p);
note('p por permutación y p paramétrico concuerdan en el veredicto',
  (r.p < 0.05) === (r.pParametric < 0.05));
note('pares: 3 grupos → 3 comparaciones, todas con q significativo',
  r.pairwise.length === 3 && r.pairwise.every((x) => x.pAdj < 0.05));

// caso nulo euclídeo: etiquetas intercaladas, ningún grupo más disperso
const NUL = Array.from({ length: N }, (_, i) => 'X' + (i % 3));
const rNull = permdisp(D, NUL, { permutations: 999, seed: 11 });
note('etiquetas intercaladas → p no significativo (> 0.1)', rNull.p > 0.1);

// --------------------------------------------------------- caso NO euclídeo
// tabla de abundancias → Bray-Curtis, que produce autovalores negativos y
// obliga a la corrección de ejes imaginarios de Anderson.
const rnd2 = mb(777);
const N2 = 18, S = 30;
const GRP2 = Array.from({ length: N2 }, (_, i) => 'G' + (Math.floor(i / 6) + 1));
const SP2 = { G1: 0.15, G2: 0.6, G3: 1.6 };
const base = Array.from({ length: S }, () => rnd2() * 100 + 5);
const T = GRP2.map((g) => base.map((b) => Math.max(0.01, b * (1 + (rnd2() - 0.5) * 2 * SP2[g]))));
const D2 = T.map((x) => T.map((y) => {
  let num = 0, den = 0;
  for (let k = 0; k < S; k++) { num += Math.abs(x[k] - y[k]); den += x[k] + y[k]; }
  return den ? num / den : 0;
}));
const r2 = permdisp(D2, GRP2, { permutations: 999, seed: 0x7D15 });
note('Bray-Curtis → aparecen ejes imaginarios (autovalores negativos)', r2.nNegativeAxes > 0);
note('todos los z finitos pese a los ejes imaginarios', r2.distances.every(Number.isFinite));
note('ningún z negativo', r2.distances.every((v) => v >= 0));
note('orden de dispersión recuperado también en Bray-Curtis',
  r2.groupMeans[0] < r2.groupMeans[1] && r2.groupMeans[1] < r2.groupMeans[2]);
const NUL2 = Array.from({ length: N2 }, (_, i) => 'X' + (i % 3));
note('Bray-Curtis, etiquetas intercaladas → p no significativo',
  permdisp(D2, NUL2, { permutations: 999, seed: 5 }).p > 0.1);

// --- invariancias
// una constante multiplicativa en la matriz escala los z pero no la F ni el p
const Dk = D.map((row) => row.map((v) => v * 3));
const rk = permdisp(Dk, GRP, { permutations: 999, seed: 0x7D15 });
note('escalar la matriz ×3 no cambia F', Math.abs(rk.F - r.F) < 1e-9);
note('escalar la matriz ×3 escala los z ×3',
  Math.max(...rk.distances.map((v, i) => Math.abs(v - 3 * r.distances[i]))) < 1e-12);
// reordenar las muestras no cambia el resultado global
const ord = GRP.map((_, i) => i).reverse();
const Dr = ord.map((i) => ord.map((j) => D[i][j]));
const rr = permdisp(Dr, ord.map((i) => GRP[i]), { permutations: 999, seed: 0x7D15 });
note('reordenar las muestras no cambia F', Math.abs(rr.F - r.F) < 1e-9);

// --- grupos con una sola muestra: se marcan, no se silencian
const SOLO = GRP.slice();
SOLO[0] = 'SOLA';
const rs = permdisp(D, SOLO, { permutations: 99, seed: 3 });
note('grupo de una muestra → se reporta en singletons', rs.singletons.includes('SOLA'));
note('grupo de una muestra → su dispersión es 0', Math.abs(rs.groupMeans[rs.groups.indexOf('SOLA')]) < 1e-12);

// --- errores
note('matriz y etiquetas de distinto tamaño → error', !!permdisp(D, GRP.slice(1), {}).error);
note('un solo grupo → error', !!permdisp(D, GRP.map(() => 'A'), {}).error);
note('una muestra por grupo → error',
  !!permdisp(D, GRP.map((_, i) => 'G' + i), {}).error);

if (!hasR() || !hasRPackage('vegan')) {
  console.log('  (R/vegan no disponible: solo modo GOLDEN + comprobación analítica)');
}

done('permdisp', ok && checks.every(Boolean));
