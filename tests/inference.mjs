// tests/inference.mjs
// Suite de pruebas unitarias para el motor de inferencia funcional taxonómica
// y su integración con barplots y diagramas aluviales.
//
// Ejecución: node tests/inference.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed = true;
};

console.log('--- 1. Importación y API de inferencia funcional ---');
const inference = await import('../js/modules/inference.js');
const faprotax = await import('../js/lib/faprotax.js');
const taxaBarplot = await import('../js/modules/taxaBarplot.js');
const shell = await import('../js/modules/shell.js');
const i18n = await import('../js/lib/i18n.js');

check('inference.js exporta mapTaxonomyToFunction', typeof inference.mapTaxonomyToFunction === 'function');
check('inference.js exporta buildDatabaseIndex', typeof inference.buildDatabaseIndex === 'function');
check('inference.js exporta findFunctionsForTaxon', typeof inference.findFunctionsForTaxon === 'function');
check('inference.js exporta parseTaxaMatrix', typeof inference.parseTaxaMatrix === 'function');
check('inference.js exporta render', typeof inference.render === 'function');
check('faprotax.js exporta DEFAULT_FAPROTAX', typeof faprotax.DEFAULT_FAPROTAX === 'object' && faprotax.DEFAULT_FAPROTAX !== null);
check('DEFAULT_FAPROTAX contiene al menos 20 funciones metabólicas', Object.keys(faprotax.DEFAULT_FAPROTAX).length >= 20, `encontradas ${Object.keys(faprotax.DEFAULT_FAPROTAX).length}`);

console.log('\n--- 2. Mapeo estricto de taxones a múltiples funciones metabólicas ---');
const dbCustom = {
  nitrification: ['g__Nitrosomonas', 'Nitrospira'],
  denitrification: ['g__Pseudomonas', 'Paracoccus'],
  hydrocarbon_degradation: ['g__Pseudomonas', 'Acinetobacter'],
  chemoheterotrophy: ['g__Pseudomonas', 'g__Bacillus', 'Escherichia'],
  fermentation: ['Lactobacillus', 'Bifidobacterium']
};

const dbIndex = inference.buildDatabaseIndex(dbCustom);

// Mapeo múltiple: Pseudomonas pertenece a 3 funciones
const fnsPseudomonas = inference.findFunctionsForTaxon('g__Pseudomonas', dbIndex);
check('g__Pseudomonas se mapea a múltiples funciones', fnsPseudomonas.size === 3, `obtenido ${fnsPseudomonas.size}`);
check('g__Pseudomonas contiene denitrification', fnsPseudomonas.has('denitrification'));
check('g__Pseudomonas contiene hydrocarbon_degradation', fnsPseudomonas.has('hydrocarbon_degradation'));
check('g__Pseudomonas contiene chemoheterotrophy', fnsPseudomonas.has('chemoheterotrophy'));
check('g__Pseudomonas NO contiene nitrification', !fnsPseudomonas.has('nitrification'));

// Linaje completo de QIIME2 con prefijos
const fullLineagePseudo = 'k__Bacteria; p__Proteobacteria; c__Gammaproteobacteria; o__Pseudomonadales; f__Pseudomonadaceae; g__Pseudomonas';
const fnsFullLineage = inference.findFunctionsForTaxon(fullLineagePseudo, dbIndex);
check('Linaje completo de QIIME2 reconoce g__Pseudomonas', fnsFullLineage.size === 3);
check('Linaje completo de QIIME2 contiene denitrification', fnsFullLineage.has('denitrification'));

// Nombre sin prefijo 'g__'
const fnsNitrospira = inference.findFunctionsForTaxon('Nitrospira', dbIndex);
check('Nombre limpio sin prefijo (Nitrospira) se reconoce correctamente', fnsNitrospira.has('nitrification'));

// Linaje con prefijo que coincide con nombre limpio en DB
const fnsLacto = inference.findFunctionsForTaxon('g__Lactobacillus', dbIndex);
check('g__Lactobacillus coincide con entrada limpia en DB (Lactobacillus)', fnsLacto.has('fermentation'));

// Aislamiento estricto de taxones: género no mapea a especie diferente
const fnsNonExistent = inference.findFunctionsForTaxon('g__Streptomyces', dbIndex);
check('Taxón no registrado en DB retorna conjunto vacío', fnsNonExistent.size === 0);

console.log('\n--- 3. Agregación matemática exacta de abundancias relativas ---');
// Muestra 1: 1000 lecturas totales
// - g__Pseudomonas: 400 (40%) -> mapea a denitrification, hydrocarbon_degradation, chemoheterotrophy
// - g__Nitrosomonas: 300 (30%) -> mapea a nitrification
// - g__UnknownGenus: 300 (30%) -> sin función asignada
// Muestra 2: 500 lecturas totales
// - g__Pseudomonas: 100 (20%)
// - g__Nitrosomonas: 250 (50%)
// - g__UnknownGenus: 150 (30%)
const mockTaxaData = {
  headers: ['SampleID', 'g__Pseudomonas', 'g__Nitrosomonas', 'g__UnknownGenus'],
  rows: [
    { SampleID: 'Muestra_1', 'g__Pseudomonas': 400, 'g__Nitrosomonas': 300, 'g__UnknownGenus': 300 },
    { SampleID: 'Muestra_2', 'g__Pseudomonas': 100, 'g__Nitrosomonas': 250, 'g__UnknownGenus': 150 },
  ]
};

const result = inference.mapTaxonomyToFunction(mockTaxaData, dbCustom, {
  includeUnassigned: true,
  asPercentage: true,
  unassignedLabel: 'Sin función asignada'
});

check('Devuelve headers con SampleID y funciones', Array.isArray(result.headers) && result.headers[0] === 'SampleID');
check('Devuelve 2 filas de muestras', result.rows.length === 2);

const r1 = result.rows[0];
const r2 = result.rows[1];

// Verificación Muestra 1 (Normalización Funcional a 100%)
// Suma total funcional = 40(denit) + 40(hydroc) + 40(chemo) + 30(nitrif) + 30(unass) = 180%
// Relativo: nitrif = 30/180 = 16.6667%, otros = 40/180 = 22.2222%
check('Muestra 1 - Nitrificación normalizada es ~16.67%', Math.abs(r1.nitrification - (30/180*100)) < 0.01, `got ${r1.nitrification}`);
check('Muestra 1 - Desnitrificación normalizada es ~22.22%', Math.abs(r1.denitrification - (40/180*100)) < 0.01, `got ${r1.denitrification}`);
check('Muestra 1 - Degradación de hidrocarburos normalizada es ~22.22%', Math.abs(r1.hydrocarbon_degradation - (40/180*100)) < 0.01, `got ${r1.hydrocarbon_degradation}`);
check('Muestra 1 - Quimioheterotrofia normalizada es ~22.22%', Math.abs(r1.chemoheterotrophy - (40/180*100)) < 0.01, `got ${r1.chemoheterotrophy}`);
check('Muestra 1 - Sin función asignada normalizada es ~16.67%', Math.abs(r1['Sin función asignada'] - (30/180*100)) < 0.01, `got ${r1['Sin función asignada']}`);

const sumR1 = r1.nitrification + r1.denitrification + r1.hydrocarbon_degradation + r1.chemoheterotrophy + r1['Sin función asignada'];
check('Muestra 1 - La suma exacta de abundancias relativas funcionales es 100.0%', Math.abs(sumR1 - 100.0) < 1e-2, `suma = ${sumR1}`);

// Verificación Muestra 2 (Normalización Funcional a 100%)
// Suma total funcional = 50(nitrif) + 20(denit) + 20(hydroc) + 20(chemo) + 30(unass) = 140%
check('Muestra 2 - Nitrificación normalizada es ~35.71%', Math.abs(r2.nitrification - (50/140*100)) < 0.01, `got ${r2.nitrification}`);
check('Muestra 2 - Desnitrificación normalizada es ~14.29%', Math.abs(r2.denitrification - (20/140*100)) < 0.01, `got ${r2.denitrification}`);
check('Muestra 2 - Sin función asignada normalizada es ~21.43%', Math.abs(r2['Sin función asignada'] - (30/140*100)) < 0.01, `got ${r2['Sin función asignada']}`);

const sumR2 = r2.nitrification + r2.denitrification + r2.hydrocarbon_degradation + r2.chemoheterotrophy + r2['Sin función asignada'];
check('Muestra 2 - La suma exacta de abundancias relativas funcionales es 100.0%', Math.abs(sumR2 - 100.0) < 1e-2, `suma = ${sumR2}`);

// Comprobación de modo crudo sin normalizar (normalizeFunctional: false)
const rawResult = inference.mapTaxonomyToFunction(mockTaxaData, dbCustom, {
  includeUnassigned: true,
  asPercentage: true,
  normalizeFunctional: false
});
check('Modo crudo sin normalizar conserva abundancia original (30.0%)', Math.abs(rawResult.rows[0].nitrification - 30.0) < 1e-4);

console.log('\n--- 4. Manejo estricto de taxones desconocidos (includeUnassigned) ---');
// Opción includeUnassigned: false
const resultNoUnassigned = inference.mapTaxonomyToFunction(mockTaxaData, dbCustom, {
  includeUnassigned: false,
  asPercentage: true
});

check('Cuando includeUnassigned es false, no incluye columna "Sin función asignada"', !resultNoUnassigned.headers.includes('Sin función asignada'));
check('Las filas no contienen la clave unassigned', resultNoUnassigned.rows[0]['Sin función asignada'] === undefined);
// Muestra 1 sin unassigned: suma = 40 + 40 + 40 + 30 = 150% -> nitrif = 30/150*100 = 20.0%
check('Las abundancias normalizadas sin unassigned suman 100% (nitrif=20.0%)', Math.abs(resultNoUnassigned.rows[0].nitrification - 20.0) < 1e-4);
const sumNoUnass = resultNoUnassigned.rows[0].nitrification + resultNoUnassigned.rows[0].denitrification + resultNoUnassigned.rows[0].hydrocarbon_degradation + resultNoUnassigned.rows[0].chemoheterotrophy;
check('Muestra 1 sin unassigned suma exactamente 100.0%', Math.abs(sumNoUnass - 100.0) < 1e-2, `suma = ${sumNoUnass}`);

// Taxones clasificados y no clasificados registrados en el objeto
check('Registra mappedTaxa correctamente', result.mappedTaxa.includes('g__Pseudomonas') && result.mappedTaxa.includes('g__Nitrosomonas'));
check('Registra unassignedTaxa correctamente', result.unassignedTaxa.includes('g__UnknownGenus') && result.unassignedTaxa.length === 1);
check('Estadística totalTaxa es 3', result.mappingStats.totalTaxa === 3);
check('Estadística mappedTaxaCount es 2', result.mappingStats.mappedTaxaCount === 2);
check('Estadística coveragePercent es 66.67%', Math.abs(result.mappingStats.coveragePercent - 66.67) < 0.1);

console.log('\n--- 5. Soporte para formatos inversos de diccionarios JSON ---');
// Formato Taxón -> [Funciones]
const dbInverted = {
  'g__Pseudomonas': ['denitrification', 'hydrocarbon_degradation'],
  'g__Nitrosomonas': ['nitrification']
};

const resultInverted = inference.mapTaxonomyToFunction(mockTaxaData, dbInverted, { asPercentage: true });
// Total funcional = 40 + 40 + 30 + 30(unassigned) = 140%
// denitrification = 40/140*100 = 28.5714%
check('Diccionario invertido (Taxón -> [Funciones]) mapea y normaliza correctamente (~28.57%)', Math.abs(resultInverted.rows[0].denitrification - (40/140*100)) < 0.01);
check('Diccionario invertido mapea nitrificación normalizada (~21.43%)', Math.abs(resultInverted.rows[0].nitrification - (30/140*100)) < 0.01);

const resultInvertedRaw = inference.mapTaxonomyToFunction(mockTaxaData, dbInverted, { asPercentage: true, normalizeFunctional: false });
check('Diccionario invertido modo crudo mapea 40.0% exacto', Math.abs(resultInvertedRaw.rows[0].denitrification - 40.0) < 1e-4);

// Formato Array de anotaciones
const dbArray = [
  { taxon: 'g__Pseudomonas', functions: ['denitrification', 'aromatic_degradation'] },
  { taxon: 'g__Nitrosomonas', functions: ['nitrification'] }
];

const resultArr = inference.mapTaxonomyToFunction(mockTaxaData, dbArray, { asPercentage: true });
check('Diccionario como Array de objetos [{ taxon, functions }] mapea correctamente (~28.57%)', Math.abs(resultArr.rows[0].aromatic_degradation - (40/140*100)) < 0.01);

const resultArrRaw = inference.mapTaxonomyToFunction(mockTaxaData, dbArray, { asPercentage: true, normalizeFunctional: false });
check('Diccionario como Array de objetos en modo crudo mapea 40.0%', Math.abs(resultArrRaw.rows[0].aromatic_degradation - 40.0) < 1e-4);

console.log('\n--- 6. Formato compatible con groupTaxaByAbundance (Barplot apilado) ---');
// La matriz generada debe pasar directamente por groupTaxaByAbundance
const grouped = taxaBarplot.groupTaxaByAbundance(result, 1, 15, { isPercentage: true, sampleKey: result.sampleKey });

check('groupTaxaByAbundance procesa la matriz funcional sin errores', grouped && typeof grouped === 'object');
check('grouped.headers contiene sampleKey', grouped.headers.includes('SampleID'));
check('grouped.rows tiene la misma cantidad de muestras', grouped.rows.length === 2);
check('grouped.series contiene entradas de funciones', grouped.series.length > 0);

// Prueba de agrupamiento en "Otros" con umbral estricto
const groupedWithOthers = taxaBarplot.groupTaxaByAbundance(result, 35, 1, { isPercentage: true, sampleKey: result.sampleKey });
check('Funciones minoritarias por debajo del umbral se agrupan en "Otros"', groupedWithOthers.hasOther === true);
check('groupedWithOthers.series contiene entrada para otros (__other__)', groupedWithOthers.series.some(s => s.isOther && s.key === '__other__'));
check('"Otros" tiene color fijo neutro #d3d3d3', groupedWithOthers.series.find(s => s.isOther).color === '#d3d3d3');

console.log('\n--- 7. Integración con el Enrutador y Shell de la aplicación ---');
check('shell.js ROUTES contiene inferencia', shell.ROUTES.some(r => r.id === 'inferencia'));
const inferRoute = shell.ROUTES.find(r => r.id === 'inferencia');
check('Ruta inferencia tiene icono inferencia', inferRoute && inferRoute.icon === 'inferencia');
check('Ruta inferencia pertenece al grupo stats', inferRoute && inferRoute.group === 'stats');

const esNav = i18n.t('nav.inference');
check('Traducción de nav.inference existe en ES', typeof esNav === 'string' && esNav.length > 0, esNav);
const esTitle = i18n.t('inference.title');
check('Traducción de inference.title existe en ES', typeof esTitle === 'string' && esTitle.length > 0, esTitle);
const esWarn = i18n.t('inference.warningText');
check('Aviso metodológico permanente presente en i18n', typeof esWarn === 'string' && esWarn.includes('predictiva'), esWarn);

console.log('\n--- 8. Base de datos fenotípica y ecológica (BacDive / metaTraits) ---');
const phenotypes = await import('../js/lib/phenotypes.js');

check('phenotypes.js exporta DEFAULT_PHENOTYPES', typeof phenotypes.DEFAULT_PHENOTYPES === 'object' && phenotypes.DEFAULT_PHENOTYPES !== null);
check('phenotypes.js exporta PHENOTYPES_METADATA', typeof phenotypes.PHENOTYPES_METADATA === 'object' && phenotypes.PHENOTYPES_METADATA !== null);
check('phenotypes.js exporta PHENOTYPE_CATEGORIES', typeof phenotypes.PHENOTYPE_CATEGORIES === 'object');
check('phenotypes.js exporta PHENOTYPE_NAMES', typeof phenotypes.PHENOTYPE_NAMES === 'object');

const expectedCats = [
  'gram_stain', 'cell_morphology', 'motility', 'sporulation', 'oxygen_requirement',
  'temperature_range', 'ph_range', 'key_enzymes', 'ecology', 'salinity'
];
expectedCats.forEach((cat) => {
  check(`DEFAULT_PHENOTYPES contiene categoría ${cat}`, Boolean(phenotypes.DEFAULT_PHENOTYPES[cat]));
});

const phenoIndex = inference.buildDatabaseIndex(phenotypes.DEFAULT_PHENOTYPES);

// 1. Pseudomonas
const pseudoTraits = inference.findFunctionsForTaxon('g__Pseudomonas', phenoIndex);
check('Pseudomonas se anota con múltiples rasgos', pseudoTraits.size >= 8, `obtenidos ${pseudoTraits.size}`);
check('Pseudomonas es Gram negativo', pseudoTraits.has('gram_negative'));
check('Pseudomonas es bacilo', pseudoTraits.has('bacillus'));
check('Pseudomonas es móvil', pseudoTraits.has('motile'));
check('Pseudomonas es aerobio', pseudoTraits.has('aerobe'));
check('Pseudomonas es mesófilo', pseudoTraits.has('mesophile'));
check('Pseudomonas es catalasa positiva', pseudoTraits.has('catalase_positive'));
check('Pseudomonas es oxidasa positiva', pseudoTraits.has('oxidase_positive'));
check('Pseudomonas es formador de biopelícula', pseudoTraits.has('biofilm_forming'));
check('Pseudomonas tiene potencial patógeno', pseudoTraits.has('pathogenic'));

// 2. Clostridium
const clostTraits = inference.findFunctionsForTaxon('g__Clostridium', phenoIndex);
check('Clostridium es Gram positivo', clostTraits.has('gram_positive'));
check('Clostridium es formador de esporas', clostTraits.has('spore_forming'));
check('Clostridium es anaerobio estricto', clostTraits.has('anaerobe'));
check('Clostridium es mesófilo', clostTraits.has('mesophile'));
check('Clostridium es catalasa negativa', clostTraits.has('catalase_negative'));

// 3. Lactobacillus & Streptococcus (acidófilos / fermentadores lácticos)
const lactoTraits = inference.findFunctionsForTaxon('g__Lactobacillus', phenoIndex);
check('Lactobacillus es Gram positivo', lactoTraits.has('gram_positive'));
check('Lactobacillus es acidófilo', lactoTraits.has('acidophile'));
check('Lactobacillus es catalasa negativa', lactoTraits.has('catalase_negative'));
check('Lactobacillus es anaerobio facultativo', lactoTraits.has('facultative_anaerobe'));

// 4. Extremófilos: Temperatura, Salinidad, Psicrófilos
const thermusTraits = inference.findFunctionsForTaxon('g__Thermus', phenoIndex);
check('Thermus es termófilo', thermusTraits.has('thermophile'));
check('Thermus es extremófilo', thermusTraits.has('extremophile'));

const psychroTraits = inference.findFunctionsForTaxon('g__Psychrobacter', phenoIndex);
check('Psychrobacter es psicrófilo', psychroTraits.has('psychrophile'));
check('Psychrobacter es extremófilo', psychroTraits.has('extremophile'));

const haloTraits = inference.findFunctionsForTaxon('g__Halomonas', phenoIndex);
// Resolución manual de conflicto MD2 (2026-09-16, ver
// scripts/md2-conflicts-report.md y qiimelab-prompt-resolver-conflictos-md2.md):
// Halomonas es EL ejemplo de tolerancia salina de rango amplísimo en
// microbiología ambiental, no de halofilia obligada — pasó de halophile
// (curación manual original) a halotolerant.
check('Halomonas no es halófilo (resuelto: halotolerante, no halofilia obligada)', !haloTraits.has('halophile'));
check('Halomonas es halotolerante', haloTraits.has('halotolerant'));

// 5. Traducciones y formato de nombres
check('formatFunctionName traduce biofilm_forming a español', inference.formatFunctionName('biofilm_forming', 'es').includes('biopelícula'));
check('formatFunctionName traduce thermophile a español', inference.formatFunctionName('thermophile', 'es').includes('Termófilo'));
check('formatFunctionName traduce acidophile a español', inference.formatFunctionName('acidophile', 'es').includes('Acidófilo'));
check('formatFunctionName traduce catalase_positive a español', inference.formatFunctionName('catalase_positive', 'es').includes('Catalasa positiva'));

// 6. Traducciones en i18n
check('i18n inference.dbMetabolism existe', i18n.t('inference.dbMetabolism') === 'Metabolismo (FAPROTAX)');
check('i18n inference.dbPhenotypes existe', i18n.t('inference.dbPhenotypes') === 'Fenotipo y Morfología (BacDive/metaTraits)');
check('i18n inference.dbCustom existe', i18n.t('inference.dbCustom') === 'Cargar JSON Personalizado');

// 7. Ejecución de mapTaxonomyToFunction con DEFAULT_PHENOTYPES
const phenoMatrix = inference.mapTaxonomyToFunction(mockTaxaData, phenotypes.DEFAULT_PHENOTYPES, {
  includeUnassigned: true,
  asPercentage: true
});
check('mapTaxonomyToFunction procesa DEFAULT_PHENOTYPES', phenoMatrix && phenoMatrix.rows.length === 2);
check('phenoMatrix detecta rasgos activos', phenoMatrix.functions.length > 5);
check('phenoMatrix Muestra 1 detecta biofilm_forming', typeof phenoMatrix.rows[0].biofilm_forming === 'number' && phenoMatrix.rows[0].biofilm_forming > 0);
// 8. Base de datos fenotípica y ecológica (BacDive / metaTraits)
// (pruebas existentes arriba)

console.log('\n--- 9. Verificación de scope isPhenotypes y traducciones i18n del selector de grupos ---');
check('i18n barplots.groupCol existe en español', i18n.t('barplots.groupCol') === 'Agrupar por metadato');
check('i18n barplots.noGroup existe en español', i18n.t('barplots.noGroup') === '(Sin agrupar / Muestras individuales)');

i18n.setLang('en');
check('i18n barplots.groupCol existe en inglés', i18n.t('barplots.groupCol') === 'Group by metadata');
check('i18n barplots.noGroup existe en inglés', i18n.t('barplots.noGroup') === '(No grouping / Individual samples)');
i18n.setLang('es');

// Auditoría estricta de código de js/modules/inference.js
const inferenceJsContent = readFileSync(join(DIR, '../js/modules/inference.js'), 'utf8');

// Comprobar renderStackedBarplot
const barplotFnMatch = inferenceJsContent.match(/function renderStackedBarplot\([^)]*\)\s*\{([^}]*?(?:\{[^}]*?\}[^}]*?)*)\}/);
check('renderStackedBarplot declara isPhenotypes evaluando el estado del diccionario',
  barplotFnMatch && barplotFnMatch[0].includes('const isPhenotypes = selectedDbType === \'phenotypes\';'));

// La vista Aluvial se retiró en la Fase 2 (B3: no funcionaba)
check('inference.js ya no tiene la vista Aluvial (ni renderAlluvialDiagram ni la opción del selector)',
  !inferenceJsContent.includes('function renderAlluvialDiagram') && !inferenceJsContent.includes("value: 'alluvial'"));

// Comprobar selector de grupos i18n
check('selector de grupos usa t(\'barplots.groupCol\')',
  inferenceJsContent.includes('t(\'barplots.groupCol\')'));
check('selector de grupos usa t(\'barplots.noGroup\') en la opción por defecto',
  inferenceJsContent.includes('t(\'barplots.noGroup\')'));

if (failed) {
  console.error('\n❌ Algunos tests de inferencia funcional fallaron.');
  process.exit(1);
} else {
  console.log('\n✅ TODOS LOS TESTS DE INFERENCIA FUNCIONAL Y FENOTÍPICA PASARON EXITOSAMENTE (100%).');
  process.exit(0);
}
