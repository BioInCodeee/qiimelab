// Web Worker (módulo ES) que corre el análisis FASTQ fuera del hilo de la UI.
// El módulo de QC lo intenta usar; si la creación del worker falla, cae a
// procesar en el hilo principal con yields periódicos.

import { analyzeFastq } from '../lib/fastq.js';

self.onmessage = async (e) => {
  const { file, maxReads } = e.data || {};
  try {
    const report = await analyzeFastq(file, {
      maxReads,
      onProgress: (n) => { self.postMessage({ type: 'progress', n }); },
    });
    self.postMessage({ type: 'done', report });
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err), code: err && err.code, params: err && err.params });
  }
};
