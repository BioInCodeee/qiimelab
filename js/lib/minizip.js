// Lector mínimo de ZIP (sin dependencias) para abrir artefactos QIIME2
// (.qza / .qzv), que internamente son ficheros ZIP estándar.
//
// Solo implementa lo necesario: recorrer el directorio central y
// descomprimir una entrada (STORED o DEFLATE, usando la DecompressionStream
// nativa del navegador — no hace falta ninguna librería externa).
//
// Verificado contra un ZIP construido a mano (entradas STORED y DEFLATE)
// antes de integrarlo aquí; ver notas de desarrollo en el README.
//
// Anti zip-bomb (28 sep 2026): un archivo pequeño podría expandirse a varios
// GB y colgar la pestaña. Antes de llamar a DecompressionStream se comprueban
// el nº de entradas, el tamaño declarado de la entrada, el ratio de
// compresión y un presupuesto acumulado por archivo; y como un ZIP malicioso
// puede mentir en su cabecera, el flujo se corta además en cuanto lo
// descomprimido supera lo declarado. Los límites se aplican a lo que de
// verdad se descomprime (ingest.js solo lee los .tsv/.csv/.txt de data/),
// no al total declarado: un clasificador SILVA real declara ~1,4 GB dentro y
// se sigue pudiendo abrir sin tocar esa entrada. Calibrado sobre 650
// .qza/.qzv reales: máx. 244 entradas y ratio máx. 32×.

import { t } from './i18n.js';
import { ZIP_LIMITS } from './decompressLimits.js';

// los límites viven en decompressLimits.js (compartidos con fastq.js)
export { ZIP_LIMITS };
const MB = 1024 * 1024;

/** Error de límite anti zip-bomb; `code` identifica cuál se superó. */
export class ZipLimitError extends Error {
  constructor(code, message) { super(message); this.name = 'ZipLimitError'; this.code = code; }
}

const mb = (n) => (n < MB ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / MB).toFixed(n < 10 * MB ? 1 : 0) + ' MB');
// bytes ya descomprimidos por archivo (el propio ArrayBuffer como clave)
const decompressedSoFar = new WeakMap();

/**
 * Descomprime `input` con DecompressionStream(`format`) leyendo el flujo a
 * trozos y cancelándolo en cuanto pasa de `maxBytes` (lanza `onTooBig()`).
 */
async function inflateLimited(input, format, maxBytes, onTooBig) {
  const reader = new Blob([input]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch (e) { /* noop */ }
      throw onTooBig();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEOCD(view) {
  const maxCommentLen = 65535;
  const minPos = Math.max(0, view.byteLength - 22 - maxCommentLen);
  for (let i = view.byteLength - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  throw new Error('No es un ZIP válido: no se encontró el End Of Central Directory. ¿Seguro que este archivo es un .qza/.qzv de QIIME2?');
}

/**
 * Lista las entradas del ZIP: [{ name, method, compSize, uncompSize, localHeaderOffset }]
 * No descomprime nada todavía — es barato de llamar sobre archivos grandes.
 */
export function listZipEntries(buffer, limits = ZIP_LIMITS) {
  const view = new DataView(buffer);
  const eocdPos = findEOCD(view);
  const entryCount = view.getUint16(eocdPos + 10, true);
  if (entryCount > limits.MAX_ZIP_ENTRIES) {
    throw new ZipLimitError('entries', t('zip.tooManyEntries', { n: entryCount, max: limits.MAX_ZIP_ENTRIES }));
  }
  let cdOffset = view.getUint32(eocdPos + 16, true);
  const entries = [];
  const decoder = new TextDecoder('utf-8');
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(cdOffset, true) !== CEN_SIG) break;
    const method = view.getUint16(cdOffset + 10, true);
    const compSize = view.getUint32(cdOffset + 20, true);
    const uncompSize = view.getUint32(cdOffset + 24, true);
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);
    const nameBytes = new Uint8Array(buffer, cdOffset + 46, nameLen);
    const name = decoder.decode(nameBytes);
    entries.push({ name, method, compSize, uncompSize, localHeaderOffset });
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Comprueba una entrada contra los límites ANTES de descomprimirla (tamaño
 * declarado, ratio, presupuesto acumulado del archivo). Lanza ZipLimitError.
 */
export function checkZipEntry(buffer, entry, limits = ZIP_LIMITS) {
  const name = entry.name.split('/').pop();
  if (entry.uncompSize === 0xFFFFFFFF || entry.compSize === 0xFFFFFFFF) {
    throw new ZipLimitError('zip64', t('zip.zip64', { name }));
  }
  if (entry.uncompSize > limits.MAX_ZIP_ENTRY_UNCOMPRESSED) {
    throw new ZipLimitError('entrySize', t('zip.entryTooBig', { name, size: mb(entry.uncompSize), max: mb(limits.MAX_ZIP_ENTRY_UNCOMPRESSED) }));
  }
  if (entry.method !== 0 && entry.uncompSize > limits.RATIO_MIN_BYTES) {
    const ratio = entry.uncompSize / Math.max(1, entry.compSize);
    if (ratio > limits.MAX_COMPRESSION_RATIO) {
      throw new ZipLimitError('ratio', t('zip.ratioTooHigh', { name, ratio: Math.round(ratio), max: limits.MAX_COMPRESSION_RATIO }));
    }
  }
  const used = decompressedSoFar.get(buffer) || 0;
  if (used + entry.uncompSize > limits.MAX_TOTAL_UNCOMPRESSED) {
    throw new ZipLimitError('total', t('zip.totalTooBig', { max: mb(limits.MAX_TOTAL_UNCOMPRESSED) }));
  }
}

/** Descomprime una entrada y devuelve un Uint8Array con su contenido. */
export async function readZipEntry(buffer, entry, limits = ZIP_LIMITS) {
  checkZipEntry(buffer, entry, limits);
  const view = new DataView(buffer);
  const lh = entry.localHeaderOffset;
  if (view.getUint32(lh, true) !== LOC_SIG) {
    throw new Error('Cabecera local de ZIP inválida para "' + entry.name + '".');
  }
  const nameLen = view.getUint16(lh + 26, true);
  const extraLen = view.getUint16(lh + 28, true);
  const dataStart = lh + 30 + nameLen + extraLen;
  const raw = new Uint8Array(buffer, dataStart, entry.compSize);

  const account = (bytes) => { decompressedSoFar.set(buffer, (decompressedSoFar.get(buffer) || 0) + bytes.length); return bytes; };

  if (entry.method === 0) return account(raw.slice());

  if (entry.method === 8) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Este navegador no soporta descompresión ZIP en el cliente (falta DecompressionStream). Prueba con una versión reciente de Chrome, Edge o Firefox.');
    }
    // nunca más de lo declarado (ya validado arriba): si la cabecera miente,
    // se corta el flujo en vez de seguir inflando
    const name = entry.name.split('/').pop();
    const out = await inflateLimited(raw, 'deflate-raw', entry.uncompSize,
      () => new ZipLimitError('sizeMismatch', t('zip.sizeMismatch', { name, size: mb(entry.uncompSize) })));
    return account(out);
  }

  throw new Error('Método de compresión ZIP no soportado (' + entry.method + ') para "' + entry.name + '".');
}

export async function readZipText(buffer, entry) {
  const bytes = await readZipEntry(buffer, entry);
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Abre un artefacto .qza/.qzv y devuelve las entradas que viven bajo
 * cualquier carpeta "<uuid>/data/..." (así es como QIIME2 empaqueta el
 * contenido real, envuelto en una carpeta con el UUID del artefacto).
 */
export async function listQiimeDataFiles(buffer) {
  const entries = listZipEntries(buffer);
  return entries.filter((e) => /\/data\//.test(e.name) && !e.name.endsWith('/'));
}

// ---------- gzip suelto (.gz) ----------
//
// Los TSV de PICRUSt2 (p. ej. pred_metagenome_unstrat.tsv.gz) NO vienen en un
// ZIP: son gzip plano. Se descomprimen con la MISMA DecompressionStream nativa
// que usa el lector de ZIP, solo que con el formato 'gzip' en vez de
// 'deflate-raw' — no hace falta ninguna librería extra.

/** Descomprime un buffer gzip (.gz) y devuelve un Uint8Array con su contenido. */
export async function gunzipBytes(buffer, limits = ZIP_LIMITS) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador no soporta descompresión gzip en el cliente (falta DecompressionStream). Prueba con una versión reciente de Chrome, Edge o Firefox.');
  }
  const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  // un .gz no declara su tamaño de forma fiable (ISIZE es módulo 2^32): se
  // corta el flujo al pasar del límite por entrada
  return inflateLimited(input, 'gzip', limits.MAX_ZIP_ENTRY_UNCOMPRESSED,
    () => new ZipLimitError('entrySize', t('zip.gzTooBig', { max: mb(limits.MAX_ZIP_ENTRY_UNCOMPRESSED) })));
}

/** Descomprime un .gz y lo decodifica como texto UTF-8. */
export async function gunzipText(buffer) {
  return new TextDecoder('utf-8').decode(await gunzipBytes(buffer));
}
