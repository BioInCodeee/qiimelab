// Límites anti "bomba de descompresión" compartidos por TODO lo que
// descomprime un archivo del usuario: minizip.js (.qza/.qzv y .gz sueltos de
// PICRUSt2) y fastq.js (.fastq.gz en streaming, también dentro del worker).
// Módulo sin dependencias a propósito, para que el worker de FASTQ lo pueda
// importar sin arrastrar i18n. Calibrado sobre 650 .qza/.qzv reales (máx. 244
// entradas, ratio máx. 32×); un FASTQ.gz real comprime ~3–6×.

const MB = 1024 * 1024;
export const ZIP_LIMITS = Object.freeze({
  MAX_ZIP_ENTRY_UNCOMPRESSED: 250 * MB,
  MAX_TOTAL_UNCOMPRESSED: 500 * MB,
  MAX_ZIP_ENTRIES: 2000,
  MAX_COMPRESSION_RATIO: 100,
  // el ratio solo se exige por encima de este tamaño: un texto diminuto muy
  // repetitivo puede comprimir >100× sin ser ningún peligro
  RATIO_MIN_BYTES: 1 * MB,
  // FASTQ: ninguna línea legítima (cabecera, secuencia o calidad) se acerca
  // a esto — ni lecturas largas de Nanopore típicas; sin él, un contenido sin
  // saltos de línea haría crecer el búfer hasta colgar la pestaña/worker
  MAX_FASTQ_LINE: 4 * MB,
});
