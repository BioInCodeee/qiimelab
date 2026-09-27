// tests/zipbomb.mjs — límites anti zip-bomb del lector de .qza/.qzv
// (js/lib/minizip.js). Se fabrican ZIP de verdad (tests/lib/zip.mjs) que
// superan cada límite y se comprueba que se rechazan con ZipLimitError y un
// mensaje claro, y que los rechazos "previos" ocurren ANTES de llamar a
// DecompressionStream (se cuentan sus construcciones). También que una
// cabecera que miente (declara poco, infla mucho) se corta a mitad de flujo,
// que un .gz suelto enorme se corta igual, y que ingestFile() lo convierte en
// un aviso legible sin romper el resto del artefacto. Sin Chrome.
//
//   node tests/zipbomb.mjs

import { deflateRawSync, gzipSync } from 'node:zlib';
import { APP_ROOT } from './lib/env.mjs';
import { buildZip, qzaFile } from './lib/zip.mjs';

const { listZipEntries, readZipEntry, gunzipBytes, ZIP_LIMITS, ZipLimitError } = await import(APP_ROOT + '/js/lib/minizip.js');
const { ingestFile } = await import(APP_ROOT + '/js/lib/ingest.js');

let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed = true;
};

// contador de DecompressionStream: los límites "previos" no deben llegar a crearlo
const RealDS = globalThis.DecompressionStream;
let dsCount = 0;
globalThis.DecompressionStream = class extends RealDS { constructor(f) { super(f); dsCount++; } };

const MB = 1024 * 1024;
const rejects = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const isLimit = (e, code) => e instanceof ZipLimitError && e.code === code && typeof e.message === 'string' && e.message.length > 20;

console.log('--- 0. límites por defecto ---');
check('MAX_ZIP_ENTRY_UNCOMPRESSED = 250 MB, MAX_TOTAL_UNCOMPRESSED = 500 MB, MAX_ZIP_ENTRIES = 2000, ratio máx. 100×',
  ZIP_LIMITS.MAX_ZIP_ENTRY_UNCOMPRESSED === 250 * MB && ZIP_LIMITS.MAX_TOTAL_UNCOMPRESSED === 500 * MB
  && ZIP_LIMITS.MAX_ZIP_ENTRIES === 2000 && ZIP_LIMITS.MAX_COMPRESSION_RATIO === 100, JSON.stringify(ZIP_LIMITS));

console.log('\n--- 1. bomba real: 64 MB de ceros deflate (~1000×) ---');
{
  const zeros = new Uint8Array(64 * MB);
  const buf = buildZip([{ name: 'u/data/bomba.tsv', data: zeros, method: 'deflate' }]);
  const [e] = listZipEntries(buf);
  console.log(`    (archivo de ${(buf.byteLength / 1024).toFixed(0)} KB, declara ${e.uncompSize / MB} MB → ratio ${Math.round(e.uncompSize / e.compSize)}×)`);
  dsCount = 0;
  const err = await rejects(() => readZipEntry(buf, e));
  check('se rechaza por ratio de compresión', isLimit(err, 'ratio'), err && err.message);
  check('...ANTES de descomprimir (DecompressionStream no llega a crearse)', dsCount === 0, 'creados: ' + dsCount);
}

console.log('\n--- 2. entrada que declara más de 250 MB ---');
{
  const buf = buildZip([{ name: 'u/data/grande.tsv', data: 'a\tb\n', method: 'stored', declaredSize: 300 * MB }]);
  const [e] = listZipEntries(buf);
  dsCount = 0;
  const err = await rejects(() => readZipEntry(buf, e));
  check('se rechaza por tamaño de entrada, antes de descomprimir', isLimit(err, 'entrySize') && dsCount === 0, err && err.message);
}

console.log('\n--- 3. cabecera que miente (declara 1 KB, infla 5 MB con ratio "normal") ---');
{
  const real = new Uint8Array(5 * MB);
  for (let i = 0; i < real.length; i++) real[i] = (i * 2654435761) >>> 24; // poco compresible: ratio declarado ≈ 1000/5MB
  const comp = deflateRawSync(Buffer.from(real));
  const buf = buildZip([{ name: 'u/data/miente.tsv', data: new Uint8Array(1024), compData: comp, method: 'deflate', declaredSize: 1024 }]);
  const [e] = listZipEntries(buf);
  const err = await rejects(() => readZipEntry(buf, e));
  check('el flujo se corta en cuanto supera lo declarado (sizeMismatch)', isLimit(err, 'sizeMismatch'), err && err.message);
}

console.log('\n--- 4. presupuesto acumulado por archivo (límites reducidos para no gastar memoria) ---');
{
  const small = { ...ZIP_LIMITS, MAX_TOTAL_UNCOMPRESSED: 1500 };
  const buf = buildZip([
    { name: 'u/data/a.tsv', data: 'x'.repeat(1000), method: 'stored' },
    { name: 'u/data/b.tsv', data: 'y'.repeat(1000), method: 'deflate' },
  ]);
  const [a, b] = listZipEntries(buf);
  const okA = await rejects(() => readZipEntry(buf, a, small));
  dsCount = 0;
  const errB = await rejects(() => readZipEntry(buf, b, small));
  check('la 1ª entrada (1000 B) cabe en un presupuesto de 1500 B', okA === null, okA && okA.message);
  check('la 2ª (otros 1000 B) supera el total acumulado y se rechaza antes de descomprimir', isLimit(errB, 'total') && dsCount === 0, errB && errB.message);
}

console.log('\n--- 5. demasiadas entradas ---');
{
  const files = Array.from({ length: 2001 }, (_, i) => ({ name: `u/data/f${i}.txt`, data: '', method: 'stored' }));
  const buf = buildZip(files);
  const err = await rejects(() => listZipEntries(buf));
  check('un ZIP con 2001 entradas se rechaza al listarlo', isLimit(err, 'entries'), err && err.message);
  const ok = await rejects(() => listZipEntries(buildZip(files.slice(0, 2000))));
  check('...y uno con 2000 (el máximo) se lista sin problema', ok === null, ok && ok.message);
}

console.log('\n--- 6. .gz suelto que se expande de más ---');
{
  const gz = gzipSync(Buffer.alloc(3 * MB));
  const err = await rejects(() => gunzipBytes(gz, { ...ZIP_LIMITS, MAX_ZIP_ENTRY_UNCOMPRESSED: 1 * MB }));
  check('gunzip se corta al pasar del límite por entrada', isLimit(err, 'entrySize'), err && err.message);
  const ok = await gunzipBytes(gzipSync(Buffer.from('a\tb\n1\t2\n')));
  check('...y un .gz normal se sigue descomprimiendo', new TextDecoder().decode(ok) === 'a\tb\n1\t2\n');
}

console.log('\n--- 7. extremo a extremo: ingestFile() con un .qza bomba ---');
{
  const tax = 'Feature ID\tTaxon\tConfidence\nabc\td__Bacteria; p__Firmicutes\t0.99\n';
  const file = qzaFile('bomba.qza', [
    { name: 'taxonomy.tsv', data: tax },
    { name: 'relleno.tsv', data: new Uint8Array(64 * MB) },
  ]);
  const { results, warnings } = await ingestFile(file);
  const w = warnings.find((x) => /relleno\.tsv/.test(x));
  check('la entrada bomba se convierte en un aviso legible para la UI (no una excepción)', !!w && /bomba zip|zip bomb/i.test(w), w);
  check('...y el resto del artefacto (taxonomy.tsv) se procesa igualmente', results.some((r) => r.kind === 'taxonomy'), JSON.stringify(results.map((r) => r.kind)));
}

console.log('\n--- 8. un artefacto normal no se ve afectado ---');
{
  const buf = buildZip([{ name: 'u/data/feature-table.tsv', data: '#OTU ID\tS1\tS2\nA\t1\t2\n'.repeat(2000), method: 'deflate' }]);
  const [e] = listZipEntries(buf);
  const out = await readZipEntry(buf, e);
  check('una tabla normal (deflate) se lee entera', out.length === e.uncompSize, `${out.length} B`);
}

globalThis.DecompressionStream = RealDS;
console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
