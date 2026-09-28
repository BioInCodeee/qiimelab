// Generadores de los scripts de R de "Descargar script R" (ver rScript.js),
// uno por análisis de Nivel A/B: diversidad alfa (índice + test automático),
// PERMANOVA, RDA/CCA, correlograma y árbol NJ. Funciones PURAS: reciben los
// datos y parámetros que el módulo ya tiene calculados (nada de leer el
// estado aquí) y devuelven { filename, text, dataFiles }.
//
// Cada script deja sus resultados en objetos con nombre fijo (`kw`,
// `comparaciones`, `resultado`, `sitios`…): así se leen en la consola y los
// tests (tests/rscript-export.mjs) los comparan con lo que muestra la app.

import {
  rStr, rNum, rVec, rComment, rTable, rHeader, rPackages, rSection, assembleScript,
} from './rScript.js';

const safeName = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'datos';

// --------------------------------------------------------------------------
//  DIVERSIDAD ALFA — índice por muestra + prueba global + test por pares
// --------------------------------------------------------------------------

const ALPHA_INDEX = {
  shannon: { label: 'Shannon (H\', logaritmo natural)', fn: 'vegan::diversity(index = "shannon")', code: 'indice <- diversity(muestras_en_filas, index = "shannon")', method: 'shannon' },
  simpson: { label: 'Simpson (1 − D, Gini-Simpson)', fn: 'vegan::diversity(index = "simpson")', code: 'indice <- diversity(muestras_en_filas, index = "simpson")', method: 'simpson' },
  observed: { label: 'riqueza observada (nº de taxones con alguna lectura)', fn: 'vegan::specnumber', code: 'indice <- specnumber(muestras_en_filas)' },
  pielou: { label: 'equidad de Pielou (J\' = H\' / ln S)', fn: 'vegan::diversity + vegan::specnumber', code: 'indice <- diversity(muestras_en_filas, index = "shannon") / log(specnumber(muestras_en_filas))', method: 'shannon' },
  chao1: { label: 'Chao1 corregido por sesgo', fn: 'vegan::estimateR (fila "S.chao1")', code: '# Chao1 necesita conteos enteros: se redondean (por si el archivo trae "9.0")\nindice <- estimateR(round(muestras_en_filas))["S.chao1", ]' },
};

// nombre corto que usa el script de R para cada test (legible, sin los ids internos de la app)
const TEST_R = {
  student: 't de Student', welch: 't de Welch', mannwhitney: 'Mann-Whitney',
  'anova-tukey': 'ANOVA + Tukey', 'welch-anova-gh': 'ANOVA de Welch + Games-Howell', 'kruskal-dunn': 'Kruskal-Wallis + Dunn',
};

// prueba global (con 3+ grupos) del cuadro de estadística de la app
const GLOBAL_R = {
  'kruskal-dunn': 'global <- kruskal.test(valor ~ grupo, data = datos)',
  'anova-tukey': '# ANOVA de un factor (el mismo F que summary(aov(...)))\nglobal <- oneway.test(valor ~ grupo, data = datos, var.equal = TRUE)',
  'welch-anova-gh': 'global <- oneway.test(valor ~ grupo, data = datos, var.equal = FALSE)',
};

const TEST_NAME = {
  student: 't de Student (varianzas iguales)',
  welch: 't de Welch (varianzas distintas)',
  mannwhitney: 'U de Mann-Whitney (no paramétrico)',
  'anova-tukey': 'ANOVA de un factor + post-hoc de Tukey HSD',
  'welch-anova-gh': 'ANOVA de Welch + post-hoc de Games-Howell',
  'kruskal-dunn': 'Kruskal-Wallis + post-hoc de Dunn',
};

/** El test que de verdad se aplica según el nº de grupos (mismo criterio
 *  que groupBoxplot.js: con 2 grupos cualquier cosa que no sea Student/
 *  Welch acaba en Mann-Whitney; con 3+, en Dunn). */
function effectiveTest(choice, k) {
  if (k === 2) return (choice === 'student' || choice === 'welch') ? choice : 'mannwhitney';
  return (choice === 'anova-tukey' || choice === 'welch-anova-gh') ? choice : 'kruskal-dunn';
}

/**
 * @param {object} o
 * @param {string} o.metricName   nombre de la métrica en la app
 * @param {string|null} o.kind    'shannon'|'simpson'|'observed'|'pielou'|'chao1' si se calcula de la tabla de conteos
 * @param {boolean} o.computed    true = calculada en la app a partir de la tabla de conteos
 * @param {string} o.groupCol
 * @param {string[]} o.groupOrder orden de los grupos en la app
 * @param {{sampleId:string, group:string, value:number}[]} o.rows  muestras usadas
 * @param {{taxa:string[], sampleIds:string[], vectors:Object.<string,number[]>}|null} o.counts
 * @param {string} o.testChoice   test aplicado (automático o forzado)
 * @param {boolean} o.overridden  true si se eligió a mano en la app
 * @param {string} o.adjust       método de ajuste de p (nombres de p.adjust)
 * @param {number} o.threshold    nivel de significancia
 */
/**
 * Ids de methodEquivalence.js que cubre el análisis alfa con estas opciones
 * (el mismo criterio que la nota de validación del script). Lo usa también el
 * informe completo, vía alphaDiversity.js.
 * @param {{kind:string|null, computed:boolean, k:number, testChoice:string, adjust:string}} o
 */
export function alphaMethodIds(o) {
  const idx = o.computed && o.kind ? ALPHA_INDEX[o.kind] : null;
  const ids = [];
  if (idx && idx.method) ids.push(idx.method);
  if (effectiveTest(o.testChoice, o.k) === 'kruskal-dunn' && o.adjust === 'BH') ids.push('bh');
  return ids;
}

export function alphaScript(o) {
  const k = o.groupOrder.length;
  const test = effectiveTest(o.testChoice, k);
  const idx = o.computed && o.kind ? ALPHA_INDEX[o.kind] : null;
  const pkgs = idx ? ['vegan'] : [];
  const methodIds = alphaMethodIds({ kind: o.kind, computed: o.computed, k, testChoice: o.testChoice, adjust: o.adjust });

  const functions = [];
  if (idx) functions.push(idx.fn + ' — índice por muestra a partir de la tabla de conteos');
  functions.push('stats::shapiro.test y ANOVA de |valor − mediana| (Levene/Brown-Forsythe, igual que car::leveneTest(center = median)) — para elegir el test por pares');
  if (test === 'kruskal-dunn') functions.push('stats::kruskal.test — Kruskal-Wallis (prueba global)');
  if (test === 'anova-tukey') functions.push('stats::oneway.test(var.equal = TRUE) — ANOVA de un factor (prueba global)');
  if (test === 'student' || test === 'welch') functions.push('stats::t.test');
  if (test === 'mannwhitney') functions.push('stats::wilcox.test');
  if (test === 'anova-tukey') functions.push('stats::aov + stats::TukeyHSD');
  if (test === 'welch-anova-gh') functions.push('stats::oneway.test(var.equal = FALSE) (prueba global) + Games-Howell escrito en R base con stats::ptukey (mismo cálculo que rstatix::games_howell_test)');
  if (test === 'kruskal-dunn') functions.push('prueba de Dunn (1964) escrita en R base (mismo cálculo que dunn.test::dunn.test o FSA::dunnTest) + stats::p.adjust');

  const params = [
    ['Métrica', o.metricName + (idx ? ' (' + idx.label + ', calculada a partir de la tabla de conteos)' : ' (valores tal como vienen en el archivo cargado)')],
    ['Agrupación', 'columna "' + o.groupCol + '" de los metadatos (' + k + ' grupos, ' + o.rows.length + ' muestras)'],
    ['Test por pares', TEST_NAME[test] + (o.overridden ? ' — elegido a mano en Smart-175' : ' — elegido automáticamente')],
  ];
  if (test === 'kruskal-dunn') params.push(['Ajuste por comparaciones múltiples', o.adjust]);
  params.push(['Nivel de significancia', String(o.threshold)]);

  const header = rHeader({
    title: 'Diversidad alfa: ' + o.metricName + ' por "' + o.groupCol + '"',
    what: (idx ? 'Calcula el índice ' + idx.label + ' de cada muestra a partir de la tabla de conteos y compara sus valores'
      : 'Compara los valores de "' + o.metricName + '"') + ' entre los grupos de "' + o.groupCol + '": elige el test como Smart-175 (según la normalidad, Shapiro-Wilk, y la homogeneidad de varianzas, ' +
      'Levene), hace la prueba global que Smart-175 muestra en el cuadro de estadística y después las comparaciones ' +
      'por pares de los corchetes del gráfico.',
    functions, methodIds, params,
  });

  const parts = [header, rPackages(pkgs), rSection('1. Datos')];
  if (idx) {
    const c = o.counts;
    parts.push(rTable('conteos', [
      { name: 'taxon', values: c.taxa, type: 'str' },
      ...c.sampleIds.map((s) => ({ name: s, values: c.vectors[s], type: 'num' })),
    ], { file: 'conteos_' + safeName(o.metricName) + '.tsv', what: 'Tabla de conteos: una fila por taxón y una columna por muestra' }));
    parts.push('tabla <- as.matrix(conteos[, -1])\nrownames(tabla) <- conteos$taxon\n' +
      '# vegan espera las muestras en FILAS: se traspone la tabla\nmuestras_en_filas <- t(tabla)\n\n' +
      '# Índice por muestra\n' + idx.code);
    parts.push(rTable('grupos', [
      { name: 'muestra', values: o.rows.map((r) => r.sampleId), type: 'str' },
      { name: 'grupo', values: o.rows.map((r) => r.group), type: 'str' },
    ], { file: 'grupos_' + safeName(o.groupCol) + '.tsv', what: 'Grupo de cada muestra (columna "' + o.groupCol + '" de los metadatos)' }));
    parts.push('datos <- data.frame(muestra = grupos$muestra, grupo = grupos$grupo,\n' +
      '                    valor = unname(indice[grupos$muestra]), stringsAsFactors = FALSE)\n' +
      '# Las muestras donde el índice no está definido (p. ej. Pielou con un solo taxón) se descartan\n' +
      'datos <- datos[is.finite(datos$valor), ]');
  } else {
    parts.push(rComment('Los valores de "' + o.metricName + '" vienen tal cual del archivo que cargaste en Smart-175 ' +
      '(p. ej. la salida de QIIME 2), así que aquí no se recalculan: el script solo repite la estadística.'));
    parts.push(rTable('datos', [
      { name: 'muestra', values: o.rows.map((r) => r.sampleId), type: 'str' },
      { name: 'grupo', values: o.rows.map((r) => r.group), type: 'str' },
      { name: 'valor', values: o.rows.map((r) => r.value), type: 'num' },
    ], { file: 'alfa_' + safeName(o.metricName) + '.tsv', what: 'Valor de "' + o.metricName + '" y grupo de cada muestra' }));
  }
  parts.push('\n# Mismo orden de grupos que en el gráfico de Smart-175\n' +
    'datos$grupo <- factor(datos$grupo, levels = ' + rVec(o.groupOrder, 'str') + ')\n' +
    'nivel_significancia <- ' + rNum(o.threshold) + '\n' +
    'print(table(datos$grupo))');

  parts.push(rSection('2. Elección automática del test'));
  parts.push(rComment('Mismo árbol de decisión que Smart-175: si algún grupo no es normal (Shapiro-Wilk, p ≤ 0,05) ' +
    'o no tiene al menos 3 valores para comprobarlo → test no paramétrico; si todos son normales pero las varianzas ' +
    'difieren (Levene/Brown-Forsythe, p ≤ 0,05) → versión de Welch; si no → test paramétrico clásico.'));
  parts.push([
    'por_grupo <- split(datos$valor, datos$grupo)',
    'shapiro_p <- sapply(por_grupo, function(x) {',
    '  if (length(x) >= 3 && length(x) <= 5000 && length(unique(x)) > 1) shapiro.test(x)$p.value else NA',
    '})',
    'todos_normales <- all(!is.na(shapiro_p) & shapiro_p > 0.05)',
    'levene_p <- NA',
    'if (all(lengths(por_grupo) >= 2)) {',
    '  # Levene centrado en la mediana (Brown-Forsythe) = ANOVA de las desviaciones absolutas',
    '  desviaciones <- abs(datos$valor - ave(datos$valor, datos$grupo, FUN = median))',
    '  levene_p <- anova(lm(desviaciones ~ datos$grupo))[["Pr(>F)"]][1]',
    '}',
    'varianzas_homogeneas <- is.na(levene_p) || levene_p > 0.05',
    'k <- nlevels(datos$grupo)',
    'test_recomendado <- if (k == 2) {',
    '  if (!todos_normales) "Mann-Whitney" else if (!varianzas_homogeneas) "t de Welch" else "t de Student"',
    '} else {',
    '  if (!todos_normales) "Kruskal-Wallis + Dunn" else if (!varianzas_homogeneas) "ANOVA de Welch + Games-Howell" else "ANOVA + Tukey"',
    '}',
    'print(round(shapiro_p, 4))',
    'cat("Levene (Brown-Forsythe) p =", signif(levene_p, 4), "\\n")',
    'cat("Test recomendado:", test_recomendado, "\\n")',
    'test_usado <- ' + rStr(TEST_R[test]) + (o.overridden
      ? '  # elegido a mano en Smart-175 (puede no coincidir con el recomendado)'
      : '  # el que eligió Smart-175 automáticamente'),
    o.overridden ? '' : 'if (test_recomendado != test_usado) warning("El test recomendado en R no coincide con el que eligió Smart-175")',
  ].filter(Boolean).join('\n'));

  parts.push(rSection('3. Prueba global: ¿hay alguna diferencia entre grupos?'));
  if (k === 2) {
    const call = test === 'student' ? 't.test(x, y, var.equal = TRUE)' : test === 'welch' ? 't.test(x, y)' : 'wilcox.test(x, y)';
    parts.push([
      '# con 2 grupos la prueba global y la comparación por pares son la misma',
      'x <- por_grupo[[1]]',
      'y <- por_grupo[[2]]',
      test === 'mannwhitney' ? '# con pocos datos y sin empates R usa el p exacto; si no, la aproximación normal (igual que Smart-175)' : '',
      'global <- ' + call,
      'print(global)',
    ].filter(Boolean).join('\n'));
  } else {
    parts.push(GLOBAL_R[test] + '\nprint(global)');
  }

  parts.push(rSection('4. Comparaciones por pares: ' + TEST_NAME[test]));
  if (k === 2) {
    parts.push([
      'prueba <- global',
      '# con 2 grupos solo hay una comparación: no hay nada que ajustar',
      'comparaciones <- data.frame(grupo1 = levels(datos$grupo)[1], grupo2 = levels(datos$grupo)[2],',
      '                            p_ajustado = prueba$p.value)',
    ].filter(Boolean).join('\n'));
  } else {
    parts.push('pares <- combn(levels(datos$grupo), 2)\ncomparaciones <- data.frame(grupo1 = pares[1, ], grupo2 = pares[2, ])');
    if (test === 'anova-tukey') {
      parts.push([
        'modelo <- aov(valor ~ grupo, data = datos)',
        'print(summary(modelo))',
        'tukey <- TukeyHSD(modelo)$grupo',
        '# TukeyHSD da las parejas en el mismo orden que combn()',
        'comparaciones$diferencia <- -tukey[, "diff"]',
        'comparaciones$p_ajustado <- tukey[, "p adj"]',
      ].join('\n'));
    } else if (test === 'welch-anova-gh') {
      parts.push([
        '# Games-Howell: como Tukey, pero con el error estándar y los grados de libertad',
        '# de cada pareja calculados a la Welch (sin suponer una varianza común)',
        'medias <- tapply(datos$valor, datos$grupo, mean)',
        'varianzas <- tapply(datos$valor, datos$grupo, var)',
        'n <- tapply(datos$valor, datos$grupo, length)',
        'a <- pares[1, ]; b <- pares[2, ]',
        'ee2 <- varianzas[a] / n[a] + varianzas[b] / n[b]',
        'q <- abs(medias[a] - medias[b]) / sqrt(ee2 / 2)',
        'gl <- ee2^2 / ((varianzas[a] / n[a])^2 / (n[a] - 1) + (varianzas[b] / n[b])^2 / (n[b] - 1))',
        'comparaciones$diferencia <- as.numeric(medias[a] - medias[b])',
        'comparaciones$p_ajustado <- as.numeric(ptukey(q, nmeans = k, df = gl, lower.tail = FALSE))',
      ].join('\n'));
    } else {
      parts.push([
        '# Dunn (1964): diferencia de rangos medios entre cada pareja, con la',
        '# corrección por empates de Kruskal-Wallis, y p bilateral de la normal',
        'rangos <- rank(datos$valor)  # rangos medios si hay empates',
        'N <- length(rangos)',
        'rango_medio <- tapply(rangos, datos$grupo, mean)',
        'n <- tapply(rangos, datos$grupo, length)',
        'empates <- rle(sort(datos$valor))$lengths',
        'varianza <- N * (N + 1) / 12 - sum(empates^3 - empates) / (12 * (N - 1))',
        'a <- pares[1, ]; b <- pares[2, ]',
        'comparaciones$z <- as.numeric((rango_medio[a] - rango_medio[b]) / sqrt(varianza * (1 / n[a] + 1 / n[b])))',
        'comparaciones$p <- 2 * pnorm(-abs(comparaciones$z))',
        'comparaciones$p_ajustado <- p.adjust(comparaciones$p, method = ' + rStr(o.adjust) + ')',
      ].join('\n'));
    }
  }
  parts.push('comparaciones$significativa <- comparaciones$p_ajustado <= nivel_significancia\n' +
    'print(comparaciones, digits = 4)\n' +
    'cat("\\nParejas significativas (p ajustado <=", nivel_significancia, "):", sum(comparaciones$significativa), "\\n")\n' +
    'print(comparaciones[comparaciones$significativa, c("grupo1", "grupo2", "p_ajustado")], digits = 4)');
  parts.push(rSection('5. Gráfico rápido (opcional)'));
  parts.push('boxplot(valor ~ grupo, data = datos, las = 2, xlab = "", ylab = ' + rStr(o.metricName) + ',\n' +
    '        main = ' + rStr(o.metricName + ' por ' + o.groupCol) + ')\nstripchart(valor ~ grupo, data = datos, vertical = TRUE, add = TRUE, pch = 16, method = "jitter")');
  return assembleScript('smart175_alfa_' + safeName(o.metricName) + '.R', parts);
}

// --------------------------------------------------------------------------
//  PERMANOVA (vegan::adonis2)
// --------------------------------------------------------------------------

/**
 * @param {{ metricName:string, groupCol:string, sampleIds:string[], groups:string[],
 *           matrix:number[][], permutations:number, seed:number, nDropped:number }} o
 */
export function permanovaScript(o) {
  const n = o.sampleIds.length;
  const header = rHeader({
    title: 'PERMANOVA: ' + o.metricName + ' ~ "' + o.groupCol + '"',
    what: 'Comprueba si la composición de las comunidades (resumida en la matriz de distancias "' + o.metricName +
      '") difiere entre los grupos de "' + o.groupCol + '". Es la tabla PERMANOVA de la página de diversidad beta ' +
      'de Smart-175: grados de libertad, sumas de cuadrados, R², pseudo-F y p por permutaciones.',
    functions: ['vegan::adonis2 — PERMANOVA (Anderson 2001) sobre la matriz de distancias'],
    methodIds: ['permanova'],
    params: [
      ['Matriz de distancias', o.metricName + ' (' + n + ' muestras)'],
      ['Agrupación', 'columna "' + o.groupCol + '" de los metadatos' + (o.nDropped ? ' (' + o.nDropped + ' muestras sin valor en esa columna se han quitado, igual que en la app)' : '')],
      ['Permutaciones', String(o.permutations)],
      ['Semilla', String(o.seed) + ' (la misma que usa Smart-175)'],
    ],
    notes: ['Sobre el p-valor: sale de permutaciones al azar. La semilla fija hace que R dé siempre el mismo p, ' +
      'pero el generador de números aleatorios de R no es el del navegador, así que el p puede diferir ligeramente ' +
      'del de Smart-175 (es el error propio de estimar un p por permutaciones, que se reduce al usar más). Los grados ' +
      'de libertad, las sumas de cuadrados, R² y el pseudo-F no dependen del azar y deben coincidir exactamente.'],
  });
  const parts = [header, rPackages(['vegan']), rSection('1. Datos')];
  parts.push(rTable('distancias', [
    { name: 'muestra', values: o.sampleIds, type: 'str' },
    ...o.sampleIds.map((s, j) => ({ name: s, values: o.matrix.map((row) => row[j]), type: 'num' })),
  ], { file: 'distancias_' + safeName(o.metricName) + '.tsv', what: 'Matriz de distancias ' + o.metricName + ': primera columna = muestra, después una columna por muestra' }));
  parts.push(rTable('metadatos', [
    { name: 'muestra', values: o.sampleIds, type: 'str' },
    { name: 'grupo', values: o.groups, type: 'str' },
  ], { file: 'grupos_' + safeName(o.groupCol) + '.tsv', what: 'Grupo de cada muestra (columna "' + o.groupCol + '"), en el mismo orden que la matriz' }));
  parts.push('\nD <- as.matrix(distancias[, -1])\nrownames(D) <- distancias$muestra\n' +
    '# comprobación: la matriz es cuadrada y las muestras están en el mismo orden que los grupos\n' +
    'stopifnot(identical(rownames(D), colnames(D)), identical(metadatos$muestra, rownames(D)))\n' +
    'metadatos$grupo <- factor(metadatos$grupo)\nprint(table(metadatos$grupo))');
  parts.push(rSection('2. PERMANOVA'));
  parts.push('set.seed(' + o.seed + ')\n' +
    'resultado <- adonis2(as.dist(D) ~ grupo, data = metadatos, permutations = ' + o.permutations + ')\n' +
    'print(resultado)\n\n' +
    'cat(sprintf("\\nR² = %.4f: la agrupación explica el %.1f%% de la variación entre muestras (p = %.4g, %d permutaciones)\\n",\n' +
    '            resultado$R2[1], 100 * resultado$R2[1], resultado$`Pr(>F)`[1], ' + o.permutations + '))');
  parts.push(rSection('Recordatorio'));
  parts.push(rComment('PERMANOVA es sensible a la dispersión: si los grupos difieren mucho en su variabilidad ' +
    'interna, un p significativo puede deberse a eso y no a un cambio de "centro". Para comprobarlo:') +
    '\n# anova(betadisper(as.dist(D), metadatos$grupo))');
  return assembleScript('smart175_permanova_' + safeName(o.metricName) + '.R', parts);
}

// --------------------------------------------------------------------------
//  RDA / CCA (vegan::rda / vegan::cca)
// --------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {'rda'|'cca'} o.method
 * @param {boolean} o.hellinger
 * @param {number} o.topN
 * @param {string[]} o.taxa           nombres de las columnas de Y (top-N taxones)
 * @param {string[]} o.sampleIds      muestras con dato en todas las variables
 * @param {number[][]} o.Y            abundancia relativa (%), muestras × taxones (antes de Hellinger)
 * @param {{name:string, type:'num'|'cat', values:Array, levels?:string[]}[]} o.vars  en el orden de la app
 * @param {string[]} o.varNames       nombres de las columnas del diseño (dummies "col=nivel")
 * @param {number} o.nAxes
 * @param {number} o.nDropped
 */
export function constrainedScript(o) {
  const M = o.method === 'cca' ? 'CCA' : 'RDA';
  const fn = o.method === 'cca' ? 'cca' : 'rda';
  const cats = o.vars.filter((v) => v.type === 'cat');
  const functions = [
    'vegan::' + fn + ' — ' + (o.method === 'cca' ? 'análisis de correspondencias canónico (ter Braak 1986)' : 'análisis de redundancia (Legendre & Legendre, §11.1)'),
  ];
  if (o.method === 'rda' && o.hellinger) functions.push('vegan::decostand(method = "hellinger") — transformación de Hellinger');
  functions.push('stats::cor — correlación de cada variable explicativa con los ejes (las flechas del biplot de Smart-175)');
  const header = rHeader({
    title: M + ' (ordenación restringida)',
    what: 'Ordenación restringida de la abundancia relativa de los ' + o.taxa.length + ' taxones más abundantes por las ' +
      'variables de metadatos elegidas: cuánta variación explican (autovalores y % de cada eje), las coordenadas de ' +
      'cada muestra y la correlación de cada variable con los ejes, tal como las muestra Smart-175 en la pestaña RDA/CCA.',
    functions,
    methodIds: [o.method],
    params: [
      ['Método', M + (o.method === 'rda' ? (o.hellinger ? ', con transformación de Hellinger' : ', sin transformación') : '')],
      ['Taxones (matriz respuesta)', 'los ' + o.taxa.length + ' más abundantes de media (control "top N" = ' + o.topN + ')'],
      ['Variables explicativas', o.vars.map((v) => v.name + (v.type === 'cat' ? ' (categórica)' : ' (numérica)')).join(', ')],
      ['Muestras', o.sampleIds.length + (o.nDropped ? ' (' + o.nDropped + ' sin dato en alguna variable se han quitado, igual que en la app)' : '')],
    ],
    notes: ['Sobre las coordenadas: el signo de cada eje es arbitrario en cualquier ordenación (R y Smart-175 pueden ' +
      'devolver el mismo eje "dado la vuelta"; es la misma solución reflejada). Smart-175 dibuja la proyección directa de ' +
      'los datos sobre cada eje y las flechas como correlaciones; plot() de vegan usa otro escalado ("scaling = 2"), ' +
      'así que su dibujo tiene otras proporciones pero los ejes y los autovalores son los mismos.'],
  });
  const parts = [header, rPackages(['vegan']), rSection('1. Datos')];
  parts.push(rTable('abundancias', [
    { name: 'muestra', values: o.sampleIds, type: 'str' },
    ...o.taxa.map((tx, j) => ({ name: tx, values: o.Y.map((row) => row[j]), type: 'num' })),
  ], { file: 'abundancias_top' + o.taxa.length + '.tsv', what: 'Abundancia relativa (%) de cada taxón en cada muestra, sobre el total de lecturas de la muestra' }));
  parts.push(rTable('explicativas', [
    { name: 'muestra', values: o.sampleIds, type: 'str' },
    ...o.vars.map((v) => ({ name: v.name, values: v.values, type: v.type === 'cat' ? 'str' : 'num' })),
  ], { file: 'variables_explicativas.tsv', what: 'Variables explicativas de cada muestra (columnas de los metadatos)' }));
  const lines = ['', 'Y <- as.matrix(abundancias[, -1])', 'rownames(Y) <- abundancias$muestra'];
  if (o.method === 'rda' && o.hellinger) {
    lines.push('# Hellinger: raíz cuadrada de la proporción de cada taxón dentro de la muestra', 'Y <- decostand(Y, method = "hellinger")');
  }
  lines.push('X <- explicativas[, -1, drop = FALSE]');
  cats.forEach((v) => {
    lines.push('# categórica: el primer nivel es la referencia (igual que en Smart-175)',
      'X[[' + rStr(v.name) + ']] <- factor(X[[' + rStr(v.name) + ']], levels = ' + rVec(v.levels, 'str') + ')');
  });
  parts.push(lines.join('\n'));
  parts.push(rSection('2. ' + M));
  parts.push('modelo <- ' + fn + '(Y ~ ., data = X)\nprint(modelo)\n\n' +
    'n_ejes <- ' + o.nAxes + '\n' +
    'autovalores <- modelo$CCA$eig[1:n_ejes]\n' +
    'porcentaje_eje <- 100 * autovalores / modelo$tot.chi\n' +
    'porcentaje_restringido <- 100 * modelo$CCA$tot.chi / modelo$tot.chi\n' +
    'print(round(porcentaje_eje, 2))\n' +
    'cat(sprintf("Las variables explican en conjunto el %.1f%% de la %s total\\n", porcentaje_restringido, ' +
    rStr(o.method === 'cca' ? 'inercia' : 'varianza') + '))');
  parts.push(rSection('3. Coordenadas de las muestras y flechas de las variables'));
  parts.push(o.method === 'cca'
    ? '# Proyección de la tabla de residuos de chi-cuadrado sobre cada eje (autovectores\n' +
      '# normalizados a longitud 1): las mismas coordenadas que la tabla de Smart-175\n' +
      'ejes <- sweep(modelo$CCA$v[, 1:n_ejes, drop = FALSE], 1, sqrt(modelo$colsum), "*")\n' +
      'sitios <- ordiYbar(modelo, "initial") %*% ejes'
    : '# Proyección de los datos centrados sobre cada eje: las mismas coordenadas que la\n' +
      '# tabla de Smart-175\n' +
      'sitios <- scale(Y, center = TRUE, scale = FALSE) %*% modelo$CCA$v[, 1:n_ejes, drop = FALSE]');
  parts.push('print(round(sitios, 4))\n\n' +
    '# Flechas: correlación de Pearson de cada variable (las categóricas como 0/1 por nivel,\n' +
    '# sin el nivel de referencia) con las coordenadas de las muestras en cada eje\n' +
    'Xd <- model.matrix(~ ., data = X)[, -1, drop = FALSE]\n' +
    'colnames(Xd) <- ' + rVec(o.varNames, 'str') + '\n' +
    'correlaciones <- cor(Xd, sitios)\nprint(round(correlaciones, 3))');
  parts.push(rSection('4. Biplot de vegan (opcional)'));
  parts.push('plot(modelo, scaling = 2, display = c("sites", "bp"), main = ' + rStr(M) + ')');
  return assembleScript('smart175_' + o.method + '.R', parts);
}

// --------------------------------------------------------------------------
//  CORRELOGRAMA (stats::cor.test)
// --------------------------------------------------------------------------

/**
 * @param {{ methods:string[], sampleIds:string[], vars:{label:string, values:number[]}[], threshold:number, rMin?:number|null }} o
 *   methods[0] = el método elegido; methods[1] (opcional) = el de la mitad inferior en la matriz partida
 */
export function correlogramScript(o) {
  const NAME = { pearson: 'Pearson', spearman: 'Spearman' };
  const methodIds = o.methods.slice();
  const header = rHeader({
    title: 'Correlograma (' + o.methods.map((m) => NAME[m]).join(' + ') + ')',
    what: 'Correlación entre cada pareja de las ' + o.vars.length + ' variables elegidas en el correlograma de Smart-175 ' +
      '(r, p y nº de muestras con dato en las dos variables), ordenadas de mayor a menor |r| como la tabla de la app.',
    functions: ['stats::cor.test — correlación y su p-valor para cada pareja de variables'],
    methodIds,
    params: [
      ['Método', o.methods.map((m) => NAME[m]).join(' (mitad superior de la matriz) + ') + (o.methods.length > 1 ? ' (mitad inferior)' : '')],
      ['Variables', o.vars.map((v) => v.label).join(', ')],
      ['Muestras', String(o.sampleIds.length) + ' (en cada pareja solo cuentan las que tienen dato en las dos variables)'],
      ...(o.rMin != null
        ? [['Aristas de la red', '|r| ≥ ' + o.rMin + ' y p ≤ ' + o.threshold]]
        : [['Nivel de significancia (asteriscos de la matriz)', String(o.threshold)]]),
    ],
    notes: o.methods.includes('spearman') ? ['Spearman: Smart-175 calcula el p con la aproximación t (Pearson sobre los rangos), ' +
      'que es lo que hace cor.test(..., method = "spearman", exact = FALSE). Con exact = TRUE, R usaría el p exacto ' +
      'para muestras pequeñas sin empates y podría diferir un poco.'] : [],
  });
  const parts = [header, rPackages([]), rSection('1. Datos')];
  parts.push(rTable('datos', [
    { name: 'muestra', values: o.sampleIds, type: 'str' },
    ...o.vars.map((v) => ({ name: v.label, values: v.values, type: 'num' })),
  ], { file: 'variables_correlograma.tsv', what: 'Una fila por muestra y una columna por variable (NA = sin dato)' }));
  parts.push('variables <- datos[, -1, drop = FALSE]\nnivel_significancia <- ' + rNum(o.threshold));
  parts.push(rSection('2. Correlación de cada pareja'));
  parts.push([
    'correlacion_por_pares <- function(variables, metodo) {',
    '  pares <- combn(ncol(variables), 2)',
    '  res <- data.frame(variable_a = names(variables)[pares[1, ]], variable_b = names(variables)[pares[2, ]],',
    '                    r = NA_real_, p = NA_real_, n = NA_integer_, stringsAsFactors = FALSE)',
    '  for (i in seq_len(ncol(pares))) {',
    '    x <- variables[[pares[1, i]]]',
    '    y <- variables[[pares[2, i]]]',
    '    ok <- is.finite(x) & is.finite(y)  # solo muestras con dato en las dos',
    '    res$n[i] <- sum(ok)',
    '    if (sum(ok) >= 3) {',
    '      prueba <- suppressWarnings(cor.test(x[ok], y[ok], method = metodo, exact = FALSE))',
    '      res$r[i] <- unname(prueba$estimate)',
    '      res$p[i] <- prueba$p.value',
    '    }',
    '  }',
    '  res',
    '}',
    '',
    'resultados <- correlacion_por_pares(variables, ' + rStr(o.methods[0]) + ')',
    o.methods[1] ? 'resultados$r_' + o.methods[1] + ' <- correlacion_por_pares(variables, ' + rStr(o.methods[1]) + ')$r' : '',
    'resultados$significativa <- !is.na(resultados$p) & resultados$p <= nivel_significancia',
    o.rMin != null ? '# aristas de la vista "Red" de Smart-175: |r| mínimo y p máximo\nr_minimo <- ' + rNum(o.rMin) +
      '\nresultados$arista_en_red <- resultados$significativa & abs(resultados$r) >= r_minimo' : '',
    '# mismo orden que la tabla de Smart-175: de mayor a menor |r|',
    'resultados <- resultados[order(-abs(resultados$r)), ]',
    'print(resultados, digits = 4, row.names = FALSE)',
  ].filter(Boolean).join('\n'));
  parts.push(rSection('3. Matriz de r (opcional)'));
  parts.push('matriz_r <- diag(1, ncol(variables))\ndimnames(matriz_r) <- list(names(variables), names(variables))\n' +
    'for (i in seq_len(nrow(resultados))) {\n' +
    '  a <- match(resultados$variable_a[i], names(variables)); b <- match(resultados$variable_b[i], names(variables))\n' +
    '  matriz_r[a, b] <- matriz_r[b, a] <- resultados$r[i]\n}\nprint(round(matriz_r, 3))');
  return assembleScript('smart175_correlograma_' + o.methods[0] + '.R', parts);
}

// --------------------------------------------------------------------------
//  ÁRBOL FILOGENÉTICO — distancias + Neighbor-Joining (ape)
// --------------------------------------------------------------------------

/**
 * @param {{ names:string[], aligned:string[], correction:'p'|'jc', nni:boolean,
 *           rooting:'none'|'midpoint'|'reference', referenceLeaf:string,
 *           newickNJ:string }} o   newickNJ = árbol NJ de la app ANTES de NNI/enraizado
 */
export function phyloScript(o) {
  const jc = o.correction === 'jc';
  const functions = [
    'ape::dist.dna(model = "' + (jc ? 'JC69' : 'raw') + '", pairwise.deletion = TRUE) — matriz de distancias',
    'ape::nj — árbol por Neighbor-Joining (Saitou & Nei 1987)',
    'ape::dist.topo y ape::cophenetic.phylo — comparación con el árbol de Smart-175',
  ];
  if (o.rooting === 'reference') functions.push('ape::root — enraizado en la secuencia de referencia');
  if (o.rooting === 'midpoint') functions.push('phangorn::midpoint — enraizado en el punto medio (opcional: solo si tienes phangorn)');
  const header = rHeader({
    title: 'Árbol filogenético (Neighbor-Joining)',
    what: 'Parte del alineamiento múltiple que hizo Smart-175, calcula la matriz de distancias ' +
      (jc ? 'con la corrección de Jukes-Cantor (JC69)' : 'p (proporción de sitios distintos)') +
      ' y construye el árbol por Neighbor-Joining con ape. Al final lo compara con el árbol que dibuja Smart-175.',
    functions,
    methodIds: ['nj', 'msa-progressive'],
    params: [
      ['Secuencias', String(o.names.length)],
      ['Distancia', jc ? 'Jukes-Cantor (JC69)' : 'p-distance (sin corrección)'],
      ['Huecos', 'se excluyen por parejas (pairwise deletion)'],
      ['Mejora NNI', o.nni ? 'activada en Smart-175 (no se reproduce aquí, ver nota)' : 'desactivada'],
      ['Enraizado', o.rooting === 'midpoint' ? 'punto medio' : o.rooting === 'reference' ? 'en "' + o.referenceLeaf + '"' : 'sin enraizar'],
    ],
    notes: ['El alineamiento NO se rehace en R: es el de Smart-175 (Nivel C, ver la nota de arriba), incluido tal cual en ' +
      'el script. Lo que se reproduce con las funciones de referencia es lo de Nivel B: distancias + Neighbor-Joining. ' +
      'Si prefieres alinear con MAFFT o MUSCLE, sustituye el bloque de datos por tu alineamiento en FASTA ' +
      '(ape::read.dna("archivo.fasta", format = "fasta")).']
      .concat(o.nni ? ['NNI: la mejora por intercambio de vecinos de Smart-175 es un paso propio sin equivalente directo en ape, ' +
        'así que este script compara con el árbol NJ de Smart-175 antes de aplicar NNI.'] : []),
  });
  const parts = [header, rPackages(['ape']), rSection('1. Alineamiento de Smart-175')];
  parts.push(rTable('alineamiento', [
    { name: 'nombre', values: o.names, type: 'str' },
    { name: 'secuencia', values: o.aligned, type: 'str' },
  ], { file: 'alineamiento_smart175.tsv', what: 'Secuencias alineadas ("-" = hueco)' }));
  parts.push('adn <- as.DNAbin(setNames(strsplit(tolower(alineamiento$secuencia), ""), alineamiento$nombre))\nprint(adn)');
  parts.push(rSection('2. Matriz de distancias'));
  parts.push('distancias <- dist.dna(adn, model = ' + rStr(jc ? 'JC69' : 'raw') + ', pairwise.deletion = TRUE, as.matrix = TRUE)\n' +
    (jc
      ? '# JC69 no está definida si p >= 0,75 (secuencias "saturadas") o si no queda ningún sitio\n' +
        '# comparable: Smart-175 usa 3 como distancia de reserva en esos casos; aquí se hace lo mismo\n' +
        'print(sum(!is.finite(distancias[upper.tri(distancias)])))  # nº de parejas saturadas\n' +
        'distancias[!is.finite(distancias)] <- 3'
      : '# si una pareja no comparte ningún sitio sin hueco, Smart-175 usa distancia 0\n' +
        'distancias[!is.finite(distancias)] <- 0') +
    '\nprint(round(distancias, 4))');
  parts.push(rSection('3. Neighbor-Joining'));
  parts.push('arbol <- nj(distancias)\nprint(arbol)');
  parts.push(rSection('4. Comparación con el árbol de Smart-175'));
  parts.push(rComment('Árbol NJ que calculó Smart-175 (formato Newick, longitudes redondeadas a 6 decimales). ' +
    'Un árbol NJ no tiene raíz: se comparan la topología (distancia de Robinson-Foulds, 0 = idéntica) y las ' +
    'distancias entre cada par de hojas a lo largo del árbol.') + '\n' +
    'arbol_smart175 <- read.tree(text = ' + rStr(o.newickNJ) + ')\n' +
    'hojas <- sort(arbol$tip.label)\n' +
    'diferencia_topologia <- as.numeric(dist.topo(unroot(arbol), unroot(arbol_smart175)))\n' +
    'diferencia_longitudes <- max(abs(cophenetic(arbol)[hojas, hojas] - cophenetic(arbol_smart175)[hojas, hojas]))\n' +
    'cat("Diferencia de topología (0 = misma):", diferencia_topologia, "\\n")\n' +
    'cat("Máxima diferencia entre distancias por el árbol:", signif(diferencia_longitudes, 3), "\\n")');
  const rootLines = [];
  if (o.rooting === 'reference') {
    rootLines.push('arbol <- root(arbol, outgroup = ' + rStr(o.referenceLeaf) + ', resolve.root = TRUE)');
  } else if (o.rooting === 'midpoint') {
    rootLines.push('if (requireNamespace("phangorn", quietly = TRUE)) {', '  arbol <- phangorn::midpoint(arbol)',
      '} else {', '  message("Para enraizar en el punto medio instala phangorn: install.packages(\\"phangorn\\")")', '}');
  }
  parts.push(rSection('5. Dibujo y exportación'));
  parts.push((rootLines.length ? rootLines.join('\n') + '\n' : '') +
    'plot(arbol, cex = 0.8)\nadd.scale.bar()\nwrite.tree(arbol)  # Newick en la consola; write.tree(arbol, "arbol.nwk") lo guarda en un archivo');
  return assembleScript('smart175_arbol_nj.R', parts);
}
