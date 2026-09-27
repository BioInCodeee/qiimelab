// Tests de tests/README.md "Qué NO cubre": la ruta de ingesta de .qza/.qzv
// (minizip.js + ingest.js) nunca se había ejercitado con un ZIP de verdad —
// solo de forma indirecta al cargar los CSV/TSV ya desempaquetados de
// datos-ejemplo/. Aquí se construye un ZIP válido a mano (STORED y DEFLATE,
// con la MISMA estructura que un .qza/.qzv real de QIIME2:
// "<uuid>/data/<archivo>") y se pasa por listZipEntries/readZipText/
// ingestFile de verdad, en Node (File/Blob/DecompressionStream son globales
// desde Node 18-20, no hace falta Chrome).
//
//   node tests/ingest.mjs

import { deflateRawSync, gzipSync } from 'node:zlib';
import { APP_ROOT } from './lib/env.mjs';

const { listZipEntries, readZipEntry, readZipText, listQiimeDataFiles, gunzipBytes, gunzipText } =
  await import(APP_ROOT + '/js/lib/minizip.js');
const { ingestFile } = await import(APP_ROOT + '/js/lib/ingest.js');

let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed = true;
};

import { buildZip, qzaFile, enc } from './lib/zip.mjs';

// =======================================================================
console.log('--- 1. minizip.js: lectura de ZIP de bajo nivel ---');
// =======================================================================
{
  const buf = buildZip([
    { name: 'stored.txt', data: 'hola mundo sin comprimir', method: 'stored' },
    { name: 'deflate.txt', data: 'á é í ó ú ñ — texto UTF-8 comprimido con DEFLATE. '.repeat(20), method: 'deflate' },
  ]);
  const entries = listZipEntries(buf);
  check('listZipEntries encuentra las 2 entradas', entries.length === 2, `encontradas ${entries.length}`);
  check('primera entrada method=0 (STORED)', entries[0].method === 0);
  check('segunda entrada method=8 (DEFLATE)', entries[1].method === 8);

  const t0 = await readZipText(buf, entries[0]);
  check('readZipText decodifica STORED sin cambios', t0 === 'hola mundo sin comprimir');

  const t1 = await readZipText(buf, entries[1]);
  check('readZipText descomprime DEFLATE y conserva UTF-8 (acentos/ñ)',
    t1 === 'á é í ó ú ñ — texto UTF-8 comprimido con DEFLATE. '.repeat(20));

  const raw1 = await readZipEntry(buf, entries[1]);
  check('readZipEntry devuelve un Uint8Array', raw1 instanceof Uint8Array);
}

{
  // corrupto: ni siquiera tiene un End Of Central Directory
  const garbage = enc.encode('esto no es un zip, es texto plano de relleno').buffer;
  let threw = null;
  try { listZipEntries(garbage); } catch (e) { threw = e; }
  check('ZIP corrupto (sin EOCD) lanza error legible', threw && /End Of Central Directory/.test(threw.message), threw && threw.message);
}

{
  const uuid = 'b2c3d4e5-0000-0000-0000-000000000002';
  const buf = buildZip([
    { name: `${uuid}/data/taxonomy.tsv`, data: 'Feature ID\tTaxon\n', method: 'stored' },
    { name: `${uuid}/data/`, data: '', method: 'stored' },
    { name: `${uuid}/metadata.yaml`, data: 'uuid: x\n', method: 'stored' },
    { name: `${uuid}/provenance/action/action.yaml`, data: 'action: {type: pipeline}\n', method: 'stored' },
  ]);
  const dataFiles = await listQiimeDataFiles(buf);
  check('listQiimeDataFiles solo trae ficheros bajo .../data/ (no metadata.yaml ni provenance/)',
    dataFiles.length === 1 && dataFiles[0].name.endsWith('taxonomy.tsv'),
    JSON.stringify(dataFiles.map((e) => e.name)));
}

{
  const original = 'linea1\nlinea2 con ñ\n'.repeat(50);
  const gz = gzipSync(Buffer.from(original, 'utf-8'));
  const bytes = await gunzipBytes(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.length));
  check('gunzipBytes descomprime un .gz plano (no-zip) byte a byte', Buffer.from(bytes).toString('utf-8') === original);
  const text = await gunzipText(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.length));
  check('gunzipText descomprime y decodifica UTF-8', text === original);
}

// =======================================================================
console.log('\n--- 2. ingestFile(): .qza/.qzv end-to-end, tal como los sube el usuario ---');
// =======================================================================
{
  // taxonomy.qza real: data/taxonomy.tsv con Feature ID + Taxon + Confidence
  const tsv = 'Feature ID\tTaxon\tConfidence\n'
    + 'ASV1\td__Bacteria;p__Firmicutes;c__Bacilli;o__Lactobacillales\t0.99\n'
    + 'ASV2\td__Bacteria;p__Proteobacteria;c__Gammaproteobacteria\t0.87\n';
  const file = qzaFile('taxonomy.qza', [{ name: 'taxonomy.tsv', data: tsv }]);
  const { results, warnings } = await ingestFile(file);
  check('taxonomy.qza: sin warnings', warnings.length === 0, JSON.stringify(warnings));
  check('taxonomy.qza: 1 resultado de tipo taxonomy', results.length === 1 && results[0].kind === 'taxonomy');
  check('taxonomy.qza: filas correctas', results[0]?.rows?.length === 2);
}

{
  // matriz de distancias con nombre interno GENÉRICO (distance-matrix.tsv):
  // ingestFile debe usar el nombre del .qza EXTERIOR para nombrar la métrica.
  const tsv = '\tM1\tM2\tM3\n'
    + 'M1\t0.0\t0.4\t0.6\n'
    + 'M2\t0.4\t0.0\t0.5\n'
    + 'M3\t0.6\t0.5\t0.0\n';
  const file = qzaFile('bray_curtis.qza', [{ name: 'distance-matrix.tsv', data: tsv }]);
  const { results, warnings } = await ingestFile(file);
  check('bray_curtis.qza: sin warnings', warnings.length === 0, JSON.stringify(warnings));
  check('bray_curtis.qza: 1 resultado betaDiversity', results.length === 1 && results[0].kind === 'betaDiversity');
  check('bray_curtis.qza: metricName usa el nombre EXTERIOR (no "distance-matrix")',
    results[0]?.metricName === 'bray_curtis', results[0]?.metricName);
  check('bray_curtis.qza: matriz 3×3 correcta', results[0]?.matrix?.[0]?.[1] === 0.4);
}

{
  // ordination.txt (skbio) dentro de un .qza con nombre interno genérico
  const ord = 'Eigvals\t2\n0.5\t0.3\n\n'
    + 'Proportion explained\t2\n0.55\t0.30\n\n'
    + 'Species\t0\t0\n\n'
    + 'Site\t3\t2\n'
    + 'S1\t0.1\t0.2\n'
    + 'S2\t-0.1\t0.3\n'
    + 'S3\t0.05\t-0.4\n\n'
    + 'Biplot\t0\t0\n\n'
    + 'Site constraints\t0\t0\n';
  const file = qzaFile('unweighted_unifrac.qza', [{ name: 'ordination.txt', data: ord }]);
  const { results, warnings } = await ingestFile(file);
  check('unweighted_unifrac.qza: sin warnings', warnings.length === 0, JSON.stringify(warnings));
  check('unweighted_unifrac.qza: 1 resultado ordination', results.length === 1 && results[0].kind === 'ordination');
  check('unweighted_unifrac.qza: metricName usa el nombre EXTERIOR',
    results[0]?.metricName === 'unweighted_unifrac', results[0]?.metricName);
  check('unweighted_unifrac.qza: 3 muestras con coordenadas', results[0]?.sampleIds?.length === 3);
}

{
  // taxa-bar-plots.qzv real: varios data/level-N.csv → varios resultados.
  // La heurística de "cadena de linaje" exige ≥2 ';' por cabecera en ≥3
  // cabeceras — con datos reales eso solo se cumple a partir de familia/
  // género (linajes cortos tipo phylum quedan por debajo del umbral y se
  // recogen luego por columnMapping manual, fuera del alcance de este test).
  const level5 = 'index,d__Bacteria;p__Firmicutes;c__Bacilli;o__Lactobacillales;f__Lactobacillaceae,'
    + 'd__Bacteria;p__Proteobacteria;c__Gammaproteobacteria;o__Enterobacterales;f__Enterobacteriaceae,'
    + 'd__Bacteria;p__Bacteroidetes;c__Bacteroidia;o__Bacteroidales;f__Bacteroidaceae\n'
    + 'S1,120,80,40\nS2,90,110,30\n';
  const level7 = 'index,d__Bacteria;p__Firmicutes;c__Bacilli;o__Lactobacillales;f__Lactobacillaceae;g__Lactobacillus;s__,'
    + 'd__Bacteria;p__Proteobacteria;c__Gammaproteobacteria;o__Enterobacterales;f__Enterobacteriaceae;g__Escherichia;s__coli,'
    + 'd__Bacteria;p__Bacteroidetes;c__Bacteroidia;o__Bacteroidales;f__Bacteroidaceae;g__Bacteroides;s__\n'
    + 'S1,60,50,30\nS2,70,40,20\n';
  const file = qzaFile('taxa-bar-plots.qzv', [
    { name: 'level-5.csv', data: level5 },
    { name: 'level-7.csv', data: level7 },
  ]);
  const { results, warnings } = await ingestFile(file);
  check('taxa-bar-plots.qzv: sin warnings', warnings.length === 0, JSON.stringify(warnings));
  check('taxa-bar-plots.qzv: 2 resultados taxaBarplotLevel', results.length === 2 && results.every((r) => r.kind === 'taxaBarplotLevel'));
  const levels = results.map((r) => r.level).sort();
  check('taxa-bar-plots.qzv: niveles 5 y 7 detectados desde el nombre interno', levels[0] === 5 && levels[1] === 7, JSON.stringify(levels));
}

{
  // feature-table.qza con SOLO un .biom (binario): debe avisar con el comando
  // biom convert exacto, sin resultados, sin reventar.
  const file = qzaFile('feature-table.qza', [{ name: 'feature-table.biom', data: new Uint8Array([0x89, 0x48, 0x44, 0x46, 1, 2, 3]) }]);
  const { results, warnings } = await ingestFile(file);
  check('feature-table.qza (solo BIOM): 0 resultados', results.length === 0);
  check('feature-table.qza (solo BIOM): avisa con "biom convert" y el formato --to-tsv',
    warnings.some((w) => w.includes('biom convert') && w.includes('--to-tsv')), JSON.stringify(warnings));
}

{
  // artefacto sin ningún archivo bajo data/ (zip válido, pero vacío de datos)
  const uuid = 'c3d4e5f6-0000-0000-0000-000000000003';
  const file = new File([buildZip([{ name: `${uuid}/metadata.yaml`, data: 'uuid: x\n', method: 'stored' }])], 'vacio.qza');
  const { results, warnings } = await ingestFile(file);
  check('.qza sin carpeta data/: 0 resultados + aviso claro', results.length === 0 && warnings.length === 1 && /no se encontró contenido reconocible/.test(warnings[0]));
}

{
  // .qza corrupto (no es un ZIP de verdad)
  const file = new File([enc.encode('esto no es un qza')], 'roto.qza');
  const { results, warnings } = await ingestFile(file);
  check('.qza corrupto: 0 resultados + aviso con el nombre del archivo', results.length === 0 && warnings.length === 1 && warnings[0].startsWith('"roto.qza"'));
  check('.qza corrupto: el aviso menciona que quizá no sea un artefacto QIIME2 válido',
    /QIIME2/i.test(warnings[0]), warnings[0]);
}

{
  // una entrada con método de compresión NO soportado (p.ej. BZIP2=12) no debe
  // tirar abajo el resto del artefacto: se avisa de ESA entrada y se procesan
  // las demás con normalidad.
  const uuid = 'd4e5f6a7-0000-0000-0000-000000000004';
  const good = 'Feature ID\tTaxon\n ASV1\td__Bacteria\n';
  const file = qzaFile('mixto.qza', [
    { name: 'raro.tsv', data: 'no importa el contenido', method: 'stored', rawMethod: 12 },
    { name: 'taxonomy.tsv', data: good },
  ], uuid);
  const { results, warnings } = await ingestFile(file);
  check('entrada con método no soportado: 1 warning específico de esa entrada',
    warnings.length === 1 && /raro\.tsv/.test(warnings[0]) && /no soportado/.test(warnings[0]), JSON.stringify(warnings));
  check('entrada con método no soportado: el resto del artefacto SÍ se procesa (taxonomy.tsv)',
    results.length === 1 && results[0].kind === 'taxonomy');
}

if (failed) {
  console.error('\n❌ Algunos tests de ingesta de .qza/.qzv fallaron.');
  process.exit(1);
} else {
  console.log('\n✅ TODOS LOS TESTS DE INGESTA DE .qza/.qzv PASARON (ZIP real, sin dependencias, verificado end-to-end).');
  process.exit(0);
}
