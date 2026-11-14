// Web Worker (módulo ES) para el soporte bootstrap del árbol filogenético.
//
// Vive fuera del hilo principal porque el coste real es serio: cada réplica
// recalcula la matriz de distancias y reconstruye el árbol por Neighbor-Joining,
// que es O(n³) en el número de taxones. Con 1000 réplicas —lo que se suele
// publicar— y unas decenas de secuencias, hacerlo en el hilo de la interfaz
// dejaría la pestaña congelada durante minutos.

import { bootstrapSplits } from '../lib/phyloBootstrap.js';

const ctx = typeof self !== 'undefined' ? self : globalThis;

ctx.onmessage = (e) => {
  const data = (e && e.data) || {};
  const id = data.id;
  const { alignedSeqs, replicates, correction, seed } = data.payload || {};
  try {
    if (!Array.isArray(alignedSeqs) || alignedSeqs.length < 3) {
      throw new TypeError('se necesitan al menos 3 secuencias alineadas para el bootstrap');
    }
    let lastSent = 0;
    const res = bootstrapSplits(alignedSeqs, {
      replicates, correction, seed,
      onProgress: (done, total) => {
        // El progreso se envía como mucho 100 veces: un postMessage por
        // réplica saturaría el canal y ralentizaría el propio cálculo.
        const step = Math.max(1, Math.floor(total / 100));
        if (done === total || done - lastSent >= step) {
          lastSent = done;
          ctx.postMessage({ id, type: 'progress', done, total });
        }
      },
    });
    ctx.postMessage({
      id, ok: true, type: 'done',
      result: {
        counts: [...res.counts.entries()],
        replicates: res.replicates,
        failed: res.failed,
      },
    });
  } catch (err) {
    ctx.postMessage({ id, ok: false, type: 'error', error: (err && err.message) || String(err) });
  }
};
