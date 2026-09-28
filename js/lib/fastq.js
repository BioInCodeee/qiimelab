// Lector y analizador de FASTQ en el navegador, en streaming.
//
// - `readFastq(file, opts)` — generador asíncrono que emite lecturas una a
//   una. Para `.gz` usa `DecompressionStream('gzip')` en streaming real: NO
//   materializa el buffer descomprimido completo.
// - `analyzeFastq(file, opts)` — recorre las lecturas UNA sola vez y calcula
//   todas las métricas de calidad (estilo FastQC). Devuelve un objeto plano
//   (serializable) con los datos de cada gráfico. Sin DOM: lo usan tanto el
//   Web Worker como el hilo principal.
//
// FASTQ = registros de 4 líneas: @cabecera / secuencia / + / calidad.
// Calidad Phred+33: valor = code(char) - 33.

import { ZIP_LIMITS } from './decompressLimits.js';

const QMAX = 50;                 // Phred máximo que cabe en el histograma
const DUP_CAP = 300000;          // nº máximo de secuencias distintas que rastreamos
const DEFAULT_MAX_READS = 200000;

// k-mers de adaptadores Illumina comunes (primeros ~12 nt).
// Es una BÚSQUEDA HEURÍSTICA por k-mer, no el algoritmo exacto de FastQC.
export const ADAPTERS = [
  { name: 'Illumina Universal / TruSeq', kmer: 'AGATCGGAAGAG' },
  { name: 'Nextera (transposasa)', kmer: 'CTGTCTCTTATA' },
  { name: 'Illumina Small RNA 3′', kmer: 'TGGAATTCTCGG' },
  { name: 'poli-G (química de 2 colores)', kmer: 'GGGGGGGGGGGG' },
];

// Núcleo muy conservado del primer 16S V3 (341F: CCTACGGGNGGCWGCAG). Si
// aparece cerca del inicio de la mayoría de las lecturas, es que todavía
// llevan el primer pegado (hay que recortarlo antes de DADA2).
const PRIMER_16S_CORE = 'TACGGG';
const PRIMER_16S_WINDOW = 12;

function isGzName(name) { return /\.(gz)$/i.test(String(name || '')); }
export function isFastqName(name) {
  return /\.(fastq|fq)(\.gz)?$/i.test(String(name || ''));
}

/** Lee los 4 últimos bytes de un gzip = tamaño descomprimido mód 2^32 (ISIZE). */
async function gzipISize(file) {
  try {
    const buf = new Uint8Array(await file.slice(file.size - 4).arrayBuffer());
    return buf[0] + buf[1] * 256 + buf[2] * 65536 + buf[3] * 16777216;
  } catch (e) { return null; }
}

/**
 * Error de límite anti bomba de descompresión / archivo patológico. Lleva un
 * `code` ('ratio' | 'line') y `params` para que el hilo principal lo traduzca
 * (el worker no tiene el idioma del usuario). `message` es un respaldo en es.
 */
export class FastqLimitError extends Error {
  constructor(code, params, message) { super(message); this.name = 'FastqLimitError'; this.code = code; this.params = params; }
}

/**
 * Generador asíncrono de lecturas FASTQ: cede `{ header, seq, qual }` (seq y
 * qual como cadenas). Se detiene tras `maxReads`.
 * Mismas defensas que el lector de ZIP (decompressLimits.js): con .gz, se
 * corta si lo descomprimido supera MAX_COMPRESSION_RATIO veces el tamaño del
 * archivo (una vez pasado RATIO_MIN_BYTES) — maxReads no basta, porque un
 * contenido que no forma registros válidos nunca suma lecturas —; y, con o
 * sin .gz, si una línea supera MAX_FASTQ_LINE sin salto de línea.
 */
export async function* readFastq(file, { maxReads = Infinity, limits = ZIP_LIMITS } = {}) {
  let stream = file.stream();
  const gz = isGzName(file.name);
  const compressedSize = Math.max(1, file.size || 0);
  let outBytes = 0;
  if (gz) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Este navegador no soporta descompresión gzip en streaming (falta DecompressionStream). Prueba con una versión reciente de Chrome, Edge o Firefox, o descomprime el .fastq.gz antes de subirlo.');
    }
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let pending = [];
  let count = 0;

  function drainRecord() {
    // pending tiene >= 4 líneas
    const header = pending[0], seq = pending[1], qual = pending[3];
    pending = pending.slice(4);
    if (!header || header[0] !== '@') return null;
    let s = seq || '', q = qual || '';
    if (s.length !== q.length) { const m = Math.min(s.length, q.length); s = s.slice(0, m); q = q.slice(0, m); }
    return { header: header.slice(1), seq: s, qual: q };
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (gz) {
        outBytes += value.length;
        const ratio = outBytes / compressedSize;
        if (outBytes > limits.RATIO_MIN_BYTES && ratio > limits.MAX_COMPRESSION_RATIO) {
          try { await reader.cancel(); } catch (e) { /* noop */ }
          throw new FastqLimitError('ratio', { name: file.name, ratio: Math.round(ratio), max: limits.MAX_COMPRESSION_RATIO },
            '"' + file.name + '" se expandiría más de ' + limits.MAX_COMPRESSION_RATIO + '× al descomprimir: se detiene la lectura.');
        }
      }
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        let line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        pending.push(line);
        if (pending.length >= 4) {
          const rec = drainRecord();
          if (rec) {
            yield rec;
            if (++count >= maxReads) { try { await reader.cancel(); } catch (e) { /* noop */ } return; }
          }
        }
      }
      if (buf.length > limits.MAX_FASTQ_LINE) {
        try { await reader.cancel(); } catch (e) { /* noop */ }
        const mb = Math.round(limits.MAX_FASTQ_LINE / (1024 * 1024));
        throw new FastqLimitError('line', { name: file.name, max: mb + ' MB' },
          '"' + file.name + '": una línea de más de ' + mb + ' MB sin salto de línea; no parece un FASTQ.');
      }
    }
    buf += decoder.decode();
    if (buf.length) { pending.push(buf.endsWith('\r') ? buf.slice(0, -1) : buf); }
    while (pending.length >= 4 && count < maxReads) {
      const rec = drainRecord();
      if (rec) { yield rec; count++; }
    }
  } finally {
    try { reader.releaseLock(); } catch (e) { /* noop */ }
  }
}

function normPdf(x, mu, sd) {
  if (sd <= 0) return 0;
  const z = (x - mu) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

function percentileFromHist(hist, total, frac) {
  if (total === 0) return 0;
  const target = frac * total;
  let acc = 0;
  for (let q = 0; q < hist.length; q++) {
    acc += hist[q];
    if (acc >= target) return q;
  }
  return hist.length - 1;
}

/**
 * Analiza un File FASTQ en un solo recorrido. Devuelve el informe completo.
 * `onProgress(count)` se llama periódicamente; `onYield()` (si se pasa) se
 * espera con `await` cada cierto nº de lecturas — úsalo en el hilo principal
 * para no congelar la UI.
 */
export async function analyzeFastq(file, { maxReads = DEFAULT_MAX_READS, onProgress, onYield } = {}) {
  const PROGRESS_EVERY = 5000;
  const YIELD_EVERY = 20000;

  let nReads = 0;
  let L = 0;
  let sumLen = 0, minLen = Infinity, maxLen = 0;
  let gcBases = 0, atBases = 0, nBases = 0, totalBases = 0;
  let basesQ20 = 0, basesQ30 = 0; // para el resumen: % de bases con Phred ≥ 20 / 30

  const lengthHist = new Map();
  const seqQualHist = new Uint32Array(QMAX + 1);
  const gcHist = new Uint32Array(101);
  let gcSum = 0, gcSumSq = 0;

  const posCount = [];   // nº de lecturas que cubren la posición p
  const posQSum = [];    // suma de Phred en la posición p (para la media)
  const posQHist = [];   // Uint32Array(QMAX+1) por posición (para percentiles)
  const posBase = [];    // Uint32Array(5) por posición: A C G T N

  const adapterStart = ADAPTERS.map(() => []); // adapterStart[a][p] = nº lecturas con el k-mer empezando en p
  let primerHits = 0;

  const dupMap = new Map();
  let dupCapped = false;

  function ensureLen(len) {
    for (let p = L; p < len; p++) {
      posCount[p] = 0; posQSum[p] = 0;
      posQHist[p] = new Uint32Array(QMAX + 1);
      posBase[p] = new Uint32Array(5);
      for (let a = 0; a < adapterStart.length; a++) adapterStart[a][p] = 0;
    }
    if (len > L) L = len;
  }

  const BASE_IDX = { A: 0, C: 1, G: 2, T: 3, N: 4 };

  // pedimos una lectura de más: si llega, es que el archivo tenía más y el
  // análisis se basa en una submuestra.
  let subsampled = false;
  for await (const rec of readFastq(file, { maxReads: maxReads + 1 })) {
    if (nReads >= maxReads) { subsampled = true; break; }
    const { seq, qual } = rec;
    const len = seq.length;
    if (len === 0) continue;
    nReads++;
    ensureLen(len);

    sumLen += len;
    if (len < minLen) minLen = len;
    if (len > maxLen) maxLen = len;
    lengthHist.set(len, (lengthHist.get(len) || 0) + 1);

    let readGC = 0, readQSum = 0;
    for (let i = 0; i < len; i++) {
      const c = seq[i];
      const bi = BASE_IDX[c] !== undefined ? BASE_IDX[c] : (c === 'a' ? 0 : c === 'c' ? 1 : c === 'g' ? 2 : c === 't' ? 3 : 4);
      posBase[i][bi]++;
      if (bi === 1 || bi === 2) { gcBases++; readGC++; }
      else if (bi === 0 || bi === 3) { atBases++; }
      else { nBases++; }
      totalBases++;

      let q = qual.charCodeAt(i) - 33;
      if (q < 0) q = 0; else if (q > QMAX) q = QMAX;
      posQHist[i][q]++;
      posQSum[i] += q;
      posCount[i]++;
      readQSum += q;
      if (q >= 20) { basesQ20++; if (q >= 30) basesQ30++; }
    }

    const meanQ = readQSum / len;
    seqQualHist[Math.min(QMAX, Math.max(0, Math.round(meanQ)))]++;

    const gcPct = (readGC / len) * 100;
    gcHist[Math.min(100, Math.max(0, Math.round(gcPct)))]++;
    gcSum += gcPct; gcSumSq += gcPct * gcPct;

    // adaptadores
    for (let a = 0; a < ADAPTERS.length; a++) {
      const idx = seq.indexOf(ADAPTERS[a].kmer);
      if (idx >= 0 && idx < L) adapterStart[a][idx]++;
    }
    // primer 16S al inicio (núcleo conservado dentro de los primeros nt)
    if (seq.slice(0, PRIMER_16S_WINDOW).indexOf(PRIMER_16S_CORE) !== -1) primerHits++;

    // duplicación (secuencia exacta)
    if (dupMap.has(seq)) dupMap.set(seq, dupMap.get(seq) + 1);
    else if (dupMap.size < DUP_CAP) dupMap.set(seq, 1);
    else dupCapped = true;

    if (onProgress && nReads % PROGRESS_EVERY === 0) onProgress(nReads);
    if (onYield && nReads % YIELD_EVERY === 0) await onYield();
  }

  const isGz = isGzName(file.name);
  let estTotalReads = null;
  if (!subsampled) {
    estTotalReads = nReads; // procesamos el archivo entero
  } else if (nReads > 0) {
    const avgBytesPerRead = (sumLen * 2 + 120 * nReads) / nReads; // aprox: seq + qual + cabeceras
    if (isGz) {
      const isize = await gzipISize(file);
      if (isize && avgBytesPerRead) estTotalReads = Math.max(nReads, Math.round(isize / avgBytesPerRead));
    } else if (avgBytesPerRead) {
      estTotalReads = Math.max(nReads, Math.round(file.size / avgBytesPerRead));
    }
  }

  // ---- construir el informe ----
  const positions = [];
  const perPos = { position: [], count: [], p10: [], p25: [], median: [], p75: [], p90: [], min: [], max: [], mean: [], baseA: [], baseC: [], baseG: [], baseT: [], baseN: [] };
  for (let p = 0; p < L; p++) {
    const h = posQHist[p], tot = posCount[p];
    positions.push(p + 1);
    perPos.position.push(p + 1);
    perPos.count.push(tot);
    perPos.p10.push(percentileFromHist(h, tot, 0.10));
    perPos.p25.push(percentileFromHist(h, tot, 0.25));
    perPos.median.push(percentileFromHist(h, tot, 0.50));
    perPos.p75.push(percentileFromHist(h, tot, 0.75));
    perPos.p90.push(percentileFromHist(h, tot, 0.90));
    perPos.min.push(percentileFromHist(h, tot, 0.02));
    perPos.max.push(percentileFromHist(h, tot, 0.98));
    perPos.mean.push(tot ? posQSum[p] / tot : 0);
    const b = posBase[p];
    perPos.baseA.push(tot ? b[0] / tot : 0);
    perPos.baseC.push(tot ? b[1] / tot : 0);
    perPos.baseG.push(tot ? b[2] / tot : 0);
    perPos.baseT.push(tot ? b[3] / tot : 0);
    perPos.baseN.push(tot ? b[4] / tot : 0);
  }

  let qWeightedSum = 0, qWeightedN = 0;
  for (let p = 0; p < L; p++) { qWeightedSum += posQSum[p]; qWeightedN += posCount[p]; }
  const meanQuality = qWeightedN ? qWeightedSum / qWeightedN : 0;

  const seqQual = [];
  for (let q = 0; q <= QMAX; q++) if (seqQualHist[q] > 0 || (q >= 2 && q <= 40)) seqQual.push({ q, count: seqQualHist[q] });

  const gcMean = nReads ? gcSum / nReads : 0;
  const gcVar = nReads > 1 ? Math.max(0, gcSumSq / nReads - gcMean * gcMean) : 0;
  const gcSd = Math.sqrt(gcVar) || 1;
  const gc = [];
  let theoTotal = 0;
  const theoRaw = [];
  for (let g = 0; g <= 100; g++) { const d = normPdf(g, gcMean, gcSd); theoRaw.push(d); theoTotal += d; }
  for (let g = 0; g <= 100; g++) {
    gc.push({
      gc: g,
      count: gcHist[g],
      theoretical: theoTotal > 0 ? (theoRaw[g] / theoTotal) * nReads : 0,
    });
  }
  // desviación GC observada vs teórica (fracción de lecturas "fuera de sitio")
  let gcDeviation = 0;
  for (let g = 0; g <= 100; g++) gcDeviation += Math.abs(gcHist[g] - gc[g].theoretical);
  gcDeviation = nReads ? gcDeviation / (2 * nReads) : 0;

  // longitud
  const lengthDist = Array.from(lengthHist.entries()).map(([len, count]) => ({ len, count })).sort((a, b) => a.len - b.len);

  // duplicación
  const dupCounts = Array.from(dupMap.values());
  const trackedReads = dupCounts.reduce((a, b) => a + b, 0);
  const distinctSeqs = dupMap.size;
  const DUP_BUCKETS = [
    { label: '1', lo: 1, hi: 1 }, { label: '2', lo: 2, hi: 2 }, { label: '3', lo: 3, hi: 3 },
    { label: '4', lo: 4, hi: 4 }, { label: '5–9', lo: 5, hi: 9 }, { label: '10–49', lo: 10, hi: 49 },
    { label: '50–99', lo: 50, hi: 99 }, { label: '100–499', lo: 100, hi: 499 },
    { label: '500–999', lo: 500, hi: 999 }, { label: '≥ 1000', lo: 1000, hi: Infinity },
  ];
  const dupLevels = DUP_BUCKETS.map((bk) => {
    let reads = 0, seqs = 0;
    for (const c of dupCounts) if (c >= bk.lo && c <= bk.hi) { reads += c; seqs++; }
    return { label: bk.label, reads, seqs, pctReads: trackedReads ? (reads / trackedReads) * 100 : 0 };
  });
  const uniqueReads = dupCounts.filter((c) => c === 1).length;
  const pctDistinctIfDedup = trackedReads ? (distinctSeqs / trackedReads) * 100 : 100;
  const pctDuplicated = trackedReads ? ((trackedReads - distinctSeqs) / trackedReads) * 100 : 0;

  // sobrerrepresentadas (> 0.1 % de las lecturas rastreadas)
  const OVERREP_MIN = 0.001;
  const overrep = Array.from(dupMap.entries())
    .filter(([, c]) => trackedReads && c / trackedReads >= OVERREP_MIN)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([seq, count]) => ({
      seqPreview: seq.length > 60 ? seq.slice(0, 57) + '…' : seq,
      seqLen: seq.length,
      count,
      pct: (count / trackedReads) * 100,
    }));

  // adaptadores: curva acumulada
  const adapter = {
    position: positions.slice(),
    series: ADAPTERS.map((ad, a) => {
      const values = [];
      let cum = 0;
      for (let p = 0; p < L; p++) {
        cum += adapterStart[a][p] || 0;
        values.push(posCount[p] ? (cum / posCount[p]) * 100 : 0);
      }
      return { name: ad.name, kmer: ad.kmer, values, max: values.length ? Math.max(...values) : 0 };
    }),
  };
  adapter.maxPct = adapter.series.reduce((m, s) => Math.max(m, s.max), 0);

  const primer16S = nReads > 0
    ? { pct: (primerHits / nReads) * 100, detected: (primerHits / nReads) >= 0.4, name: '16S V3 (341F, CCTACGGGNGGCWGCAG)' }
    : null;

  return {
    file: { name: file.name, sizeBytes: file.size, isGz },
    encoding: 'Phred+33 (Sanger / Illumina 1.8+)',
    nReads,
    maxReads,
    subsampled,
    estTotalReads,
    lenMin: isFinite(minLen) ? minLen : 0,
    lenMax: maxLen,
    lenMean: nReads ? sumLen / nReads : 0,
    meanQuality,
    pctQ20: totalBases ? (basesQ20 / totalBases) * 100 : 0,
    pctQ30: totalBases ? (basesQ30 / totalBases) * 100 : 0,
    gcPercent: totalBases ? (gcBases / (gcBases + atBases || 1)) * 100 : 0,
    nContentPct: totalBases ? (nBases / totalBases) * 100 : 0,
    totalBases,
    perPos,
    seqQual,
    seqQualMode: seqQual.reduce((best, x) => (x.count > (best?.count ?? -1) ? x : best), null),
    gc,
    gcMean,
    gcSd,
    gcDeviation,
    lengthDist,
    duplication: {
      distinctSeqs, trackedReads, uniqueReads, capped: dupCapped,
      pctDuplicated, pctDistinctIfDedup, levels: dupLevels,
    },
    overrep,
    adapter,
    primer16S,
  };
}
