// Rendimiento con datasets grandes — MEDICIÓN, no adivinación.
//
//   node tests/perf-stress.mjs
//
// Genera en el navegador un dataset sintético de estrés (cientos de muestras ×
// miles de taxones, mulberry32 con semilla fija — NO vive en datos-ejemplo/) y
// cronometra con performance.now() las 4 operaciones que el prompt señala:
//
//   1. matriz de distancias beta + UPGMA        (js/lib/stats.js: upgma/leafOrder)
//   2. correlaciones del correlograma + force-layout
//   3. curvas de rarefacción                     (js/lib/stats.js: rarefactionCurve)
//   4. render de la tabla de abundancia diferencial
//
// Para cada una mide el "jank": el hueco máximo entre callbacks de
// requestAnimationFrame mientras corre el cálculo. Hueco grande = el hilo
// principal estuvo bloqueado ese tiempo. Hueco ~16-32 ms = libre.
//
// Además, para las dos que se migraron a Web Worker (js/lib/heavyStats.js),
// vuelve a medir por la ruta asíncrona: ahí el jank DEBE bajar de JANK_MAX o el
// test FALLA. El resto solo se informa.
//
// Resultado medido (Chrome del sistema, dataset de abajo):
//   operación                                  sync ms   sync jank   worker jank
//   Bray-Curtis S×S (260)                        ~93        ~105        (no migrada)
//   UPGMA + leafOrder (560×560)                 ~210       ~220         ~30
//   correlaciones + force-layout (k=34)          ~35        ~48         (no migrada, rápida)
//   curvas de rarefacción (260 muestras)        ~530       ~545         ~20
//   render tabla diferencial (4200 filas)       ~146       ~160        (DOM: un worker no puede)

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

// ms — por encima de esto el bloqueo del hilo principal se nota. Con margen
// para el ruido de un runner de CI compartido: la ruta con worker mide
// ~20-40 ms, la síncrona que vigila ~210 ms (UPGMA) / ~540 ms (rarefacción).
const JANK_MAX = 150;

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

// Parámetros del dataset de estrés (cientos × miles). N_DIST se elige para que
// el UPGMA SÍNCRONO (O(n³)) bloquee de sobra: si el worker se rompe y cae al
// hilo principal, el test lo pilla.
const S_SAMPLES = 260;
const T_TAXA = 2800;
const DENSITY = 0.34;
const N_DIST = 560;
const N_DIFF = 4200;

const HARNESS = `(async () => {
  const stats = await import('/js/lib/stats.js');
  const heavy = await import('/js/lib/heavyStats.js');
  const { forceLayout } = await import('/js/lib/forceLayout.js');
  const { mulberry32 } = await import('/js/lib/groupBoxplot.js');

  const S = ${S_SAMPLES}, T = ${T_TAXA}, DENS = ${DENSITY};
  const NDIST = ${N_DIST}, NDIFF = ${N_DIFF};
  const rnd = mulberry32(0xB1017 ^ 175); // semilla fija

  // ---- tabla de conteos S×T dispersa (lognormal), estilo microbioma ----
  const counts = [];
  for (let s = 0; s < S; s++) {
    const row = new Float64Array(T);
    for (let k = 0; k < T; k++) {
      if (rnd() < DENS) row[k] = Math.max(1, Math.round(Math.exp(rnd() * 6)));
    }
    counts.push(row);
  }
  const vectors = {};
  for (let s = 0; s < S; s++) vectors['M' + s] = Array.from(counts[s]);

  // ---- matriz de distancias NDIST×NDIST simétrica en [0,1] ----
  const D = [];
  for (let i = 0; i < NDIST; i++) D.push(new Float64Array(NDIST));
  for (let i = 0; i < NDIST; i++) {
    for (let j = i + 1; j < NDIST; j++) {
      const v = 0.05 + rnd() * 0.9;
      D[i][j] = v; D[j][i] = v;
    }
  }
  const distLabels = Array.from({ length: NDIST }, (_, i) => 'M' + (i + 1));

  // ---- filas de abundancia diferencial ----
  const diffRows = [];
  for (let i = 0; i < NDIFF; i++) {
    const lfc = (rnd() - 0.5) * 12;
    const padj = Math.pow(10, -rnd() * 10);
    diffRows.push({
      taxon: 'd__Bacteria;p__P' + (i % 30) + ';g__Genus_' + i,
      lfc, padj,
      neglog: -Math.log10(Math.max(padj, 1e-10)),
      status: padj < 0.05 ? (lfc >= 1 ? 'up' : lfc <= -1 ? 'down' : 'ns') : 'ns',
      capped: padj < 1e-10,
    });
  }

  // ---- medidor de jank: hueco máximo entre frames de rAF ----
  function jankMeter() {
    let last = performance.now();
    let max = 0, running = true;
    const tick = () => {
      const now = performance.now();
      if (now - last > max) max = now - last;
      last = now;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { running = false; return max; };
  }

  async function measure(fn) {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const stop = jankMeter();
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    const extra = await fn();
    const ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 80));
    return { ms: +ms.toFixed(1), jankMs: +stop().toFixed(1), ...(extra || {}) };
  }

  // abundancias relativas para Bray-Curtis
  const rel = counts.map((row) => {
    let sum = 0; for (let k = 0; k < T; k++) sum += row[k];
    const r = new Float64Array(T);
    if (sum > 0) for (let k = 0; k < T; k++) r[k] = row[k] / sum;
    return r;
  });

  const out = { sync: {}, worker: {} };

  // ===== BASELINE (todo en el hilo principal) =====

  out.sync['beta:bray'] = await measure(() => {
    const M = [];
    for (let i = 0; i < S; i++) {
      M.push(new Array(S));
      for (let j = 0; j < S; j++) {
        if (j < i) { M[i][j] = M[j][i]; continue; }
        if (j === i) { M[i][j] = 0; continue; }
        let num = 0, den = 0;
        const a = rel[i], b = rel[j];
        for (let k = 0; k < T; k++) { num += Math.abs(a[k] - b[k]); den += a[k] + b[k]; }
        M[i][j] = den === 0 ? 0 : num / den;
      }
    }
    return { size: S };
  });

  out.sync['beta:upgma'] = await measure(() => {
    const tree = stats.upgma(D, distLabels);
    const order = stats.leafOrder(tree);
    return { size: NDIST, leaves: order.length };
  });

  const K = 34;
  const vars = [];
  for (let v = 0; v < K; v++) {
    const col = new Float64Array(S);
    for (let s = 0; s < S; s++) col[s] = rnd() * 100;
    vars.push(col);
  }
  out.sync['correlogram'] = await measure(() => {
    const res = Array.from({ length: K }, () => new Array(K).fill(null));
    for (let i = 0; i < K; i++) {
      for (let j = i; j < K; j++) {
        if (i === j) { res[i][j] = { r: 1, p: NaN, n: S }; continue; }
        const x = [], y = [];
        for (let s = 0; s < S; s++) { x.push(vars[i][s]); y.push(vars[j][s]); }
        stats.pearson(x, y); stats.spearman(x, y);
        res[i][j] = res[j][i] = { r: 0.4 };
      }
    }
    const edges = [];
    for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) edges.push({ source: 'v' + i, target: 'v' + j, weight: 0.4 });
    const pos = forceLayout(vars.map((_, i) => 'v' + i), edges, { width: 640, height: 480, iterations: 300 });
    return { k: K, nodes: Object.keys(pos).length };
  });

  out.sync['rarefaction'] = await measure(() => {
    let pts = 0;
    for (let s = 0; s < S; s++) pts += stats.rarefactionCurve(vectors['M' + s], 50).depths.length;
    return { samples: S, points: pts };
  });

  out.sync['difftable'] = await measure(() => renderDiffTable(diffRows));

  // ===== RUTA MIGRADA (Web Worker) =====

  out.worker['beta:upgma'] = await measure(async () => {
    const { order } = await heavy.upgmaOrderAsync(D, distLabels);
    return { size: NDIST, leaves: order.length };
  });

  out.worker['rarefaction'] = await measure(async () => {
    const curves = await heavy.rarefactionBatchAsync(vectors, 50);
    return { samples: Object.keys(curves).length };
  });

  function renderDiffTable(rows) {
    const host = document.createElement('table');
    const tbody = document.createElement('tbody');
    host.appendChild(tbody);
    host.style.cssText = 'position:absolute;left:-99999px';
    document.body.appendChild(host);
    const sorted = rows.slice().sort((a, b) => a.padj - b.padj);
    const frag = document.createDocumentFragment();
    sorted.forEach((d) => {
      const tr = document.createElement('tr');
      const pill = d.status === 'up' ? 'ql-pill-up' : d.status === 'down' ? 'ql-pill-down' : 'ql-pill-ns';
      tr.innerHTML = '<td>' + d.taxon + '</td>' +
        '<td class="ql-num tabular">' + d.lfc.toFixed(2) + '</td>' +
        '<td class="ql-num tabular">' + (d.capped ? '&lt; 1e-10' : d.padj.toExponential(2)) + '</td>' +
        '<td class="ql-num tabular">' + d.neglog.toFixed(2) + '</td>' +
        '<td><span class="ql-pill ' + pill + '">x</span></td>';
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
    void host.offsetHeight;
    const n = tbody.querySelectorAll('tr').length;
    host.remove();
    return { rows: n };
  }

  return out;
})()`;

const c = await connect({ url: server.url + '/index.html', label: 'perf-stress' });
let failed = false;
try {
  await c.goto();
  await sleep(1500);

  console.log(`dataset de estrés: ${S_SAMPLES} muestras × ${T_TAXA} taxones (densidad ${DENSITY}), ` +
    `matriz de distancias ${N_DIST}×${N_DIST}, tabla diferencial ${N_DIFF} filas\n`);

  const r = await c.ev(HARNESS);

  const ROWS = [
    ['beta:bray', 'Bray-Curtis S×S (matriz de distancias)', false, 'solo para el ejemplo sintético (20 muestras fijas): nunca a escala'],
    ['beta:upgma', 'UPGMA + leafOrder (mapa de calor beta)', true, ''],
    ['correlogram', 'correlaciones (Pearson+Spearman) + force-layout', false, 'acotada por diseño: k ≤ ~40 variables'],
    ['rarefaction', 'curvas de rarefacción (todas las muestras)', true, ''],
    ['difftable', 'render de la tabla de abundancia diferencial', false, 'trabajo de DOM: un worker no puede; virtualizar sería el arreglo'],
  ];

  console.log('operación'.padEnd(46) + 'sync'.padStart(9) + 'jank'.padStart(9) + '  worker'.padStart(10) + '   estado');
  console.log('─'.repeat(96));
  for (const [key, label, migrated, note] of ROWS) {
    const s = r.sync[key];
    const w = r.worker[key];
    if (!s) continue;
    let estado;
    if (migrated) {
      const ok = w && w.jankMs <= JANK_MAX;
      estado = ok
        ? `✓ worker libera el hilo (${s.jankMs}ms → ${w.jankMs}ms)`
        : `✗ el worker NO libera el hilo (${w ? w.jankMs : '—'}ms)`;
      if (!ok) failed = true;
    } else {
      estado = (s.jankMs > JANK_MAX ? '· bloquea pero no se migra — ' : '· rápido — ') + note;
    }
    console.log(
      label.padEnd(46) +
      (s.ms + 'ms').padStart(9) +
      (s.jankMs + 'ms').padStart(9) +
      ((w ? w.jankMs + 'ms' : '—')).padStart(10) +
      '   ' + estado
    );
  }
  console.log('─'.repeat(96));
  console.log('detalle:', JSON.stringify(r));

  if (c.problems.length) { failed = true; c.problems.forEach((p) => console.log('  ✗ ' + p)); }
} catch (e) {
  console.error('EXCEPCIÓN:', e.message);
  failed = true;
} finally {
  c.kill();
  if (server.started) server.stop();
}

console.log('\nRESULTADO perf-stress: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
