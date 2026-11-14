// fileHash.js — huella SHA-256 de los archivos que entran en un análisis.
//
// Para qué: la procedencia (js/lib/provenance.js) cuenta de dónde viene un
// .qza porque QIIME 2 lo escribe dentro. Pero un TSV de abundancias o un
// archivo de metadatos no traen nada: entran sin ninguna forma de saber, tres
// meses después, si el "feature-table.tsv" de la carpeta es el mismo con el
// que se hicieron las figuras. El hash es eso: una huella corta que se puede
// pegar en la sección de métodos y volver a calcular para comprobarlo.
//
// Se usa `crypto.subtle` del propio navegador — nada de dependencias. Dos
// límites reales, y los dos se informan en vez de fallar en silencio:
//
//   1. `crypto.subtle` SOLO existe en contexto seguro (https o localhost). Si
//      alguien abre la app con doble clic sobre index.html (file://), no está.
//      No es un caso raro: es justo cómo se usaría un paquete offline.
//   2. `digest()` no tiene API de streaming: necesita el archivo entero en
//      memoria. Un FASTQ de varios GB no puede pasar por aquí — y de hecho el
//      módulo de control de calidad lo lee en streaming precisamente para no
//      cargarlo. Por eso hay un tope, y por encima se dice que no se calculó.

/** Tope por archivo. Por encima, no se calcula (ver nota 2 arriba). */
export const HASH_MAX_BYTES = 256 * 1024 * 1024;

/** `true` si este navegador y este contexto permiten calcular el hash. */
export function hashAvailable() {
  return typeof crypto !== 'undefined'
    && !!crypto.subtle
    && typeof crypto.subtle.digest === 'function';
}

/** Los 12 primeros caracteres, que es lo que se muestra: suficiente para
 *  distinguir archivos a ojo, y el completo queda en el título y en el informe. */
export function shortHash(hex) {
  return typeof hex === 'string' ? hex.slice(0, 12) : '';
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/**
 * Calcula el SHA-256 de un File/Blob/ArrayBuffer.
 *
 * Nunca lanza: devuelve `skipped` con el motivo. Un hash es información
 * añadida sobre el archivo, así que no poder calcularlo no debe impedir que
 * el archivo se analice.
 *
 * @param {File|Blob|ArrayBuffer|Uint8Array} input
 * @param {{maxBytes?:number}} [opt]
 * @returns {Promise<{hex:string, algorithm:'SHA-256', bytes:number}
 *   | {skipped:'unavailable'|'too-large'|'error', bytes:number|null, message?:string}>}
 */
export async function sha256Hex(input, opt = {}) {
  const maxBytes = opt.maxBytes != null ? opt.maxBytes : HASH_MAX_BYTES;
  const size = input == null ? null
    : (typeof input.size === 'number' ? input.size
      : (typeof input.byteLength === 'number' ? input.byteLength : null));

  if (!hashAvailable()) return { skipped: 'unavailable', bytes: size };
  if (size != null && size > maxBytes) return { skipped: 'too-large', bytes: size };

  try {
    let buffer;
    if (input instanceof ArrayBuffer) buffer = input;
    else if (input && typeof input.arrayBuffer === 'function') buffer = await input.arrayBuffer();
    else if (input && input.buffer instanceof ArrayBuffer) {
      buffer = input.buffer.slice(input.byteOffset || 0, (input.byteOffset || 0) + input.byteLength);
    } else return { skipped: 'error', bytes: size, message: 'Tipo de entrada no soportado.' };

    if (buffer.byteLength > maxBytes) return { skipped: 'too-large', bytes: buffer.byteLength };
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return { hex: toHex(digest), algorithm: 'SHA-256', bytes: buffer.byteLength };
  } catch (e) {
    return { skipped: 'error', bytes: size, message: e && e.message ? e.message : String(e) };
  }
}
