// Control de calidad de FASTQ estilo FastQC, 100 % en el navegador.
// Lee el archivo en streaming (js/lib/fastq.js), en un Web Worker si se puede
// y si no en el hilo principal con yields. Cada métrica trae su gráfico SVG,
// su texto explicativo y un veredicto tipo semáforo (--good/--warning/--critical).

import { state, subscribe, registerFile, addSequenceQC, removeFile } from '../state.js';
import { t, getLang } from '../lib/i18n.js';
import { analyzeFastq } from '../lib/fastq.js';
import { loadRealSequenceQC, exampleDownloadBlock } from '../lib/exampleData.js';
import { svgEl, escapeHtml } from '../lib/dom.js';
import { attachChartEditor } from '../lib/chartEditor.js';

const CAT = ['--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5', '--cat-6', '--cat-7'];
const FASTQ_RE = /\.(fastq|fq)(\.gz)?$/i;

// estado local del módulo (no del store)
const running = new Set();     // nombres de archivo en análisis
const progressN = new Map();   // nombre -> nº de lecturas procesadas
const errors = new Map();      // nombre -> mensaje de error
let maxReads = 200000;
let selected = null;           // nombre del archivo cuyo informe se muestra

const QC_PRESETS = [50000, 200000, 500000, Infinity];

// Estimación tosca del nº de lecturas de un archivo por su tamaño (una lectura
// 16S ≈ 250 nt + calidad + cabecera ≈ 620 B; un .gz comprime ~3,5×).
function estReadsFromSize(file) {
  if (!file || !file.size) return null;
  const perRead = 620;
  const factor = /\.gz$/i.test(file.name || '') ? 3.5 : 1;
  return Math.round((file.size * factor) / perRead);
}

/** Aviso (texto) si el límite elegido va a costar tiempo/memoria; '' si no. */
function estimateCost(entries, limit) {
  const pending = (entries || []).filter((e) => !e.report);
  const sizes = pending.map((e) => estReadsFromSize(e.file)).filter((n) => n != null);
  const biggest = sizes.length ? Math.max(...sizes) : null;
  const eff = limit === Infinity ? (biggest || Infinity) : Math.min(limit, biggest || limit);

  if (limit === Infinity) {
    return biggest
      ? t('qc.costAllFile', { n: fmtInt(biggest), secs: Math.max(1, Math.round(biggest / 90000)) })
      : t('qc.costAll');
  }
  if (eff >= 400000) {
    return t('qc.costBig', { n: fmtInt(eff), secs: Math.max(1, Math.round(eff / 90000)) });
  }
  return '';
}

function safeId(name) { return 'qc_' + String(name).replace(/[^a-z0-9]/gi, '_'); }
function fmtInt(n) { return (n == null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString('es-ES'); }
function fmtBytes(b) {
  if (b == null) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

// ---------------------------------------------------------------------------
//  veredictos (umbrales tipo FastQC, con matices para amplicón)
// ---------------------------------------------------------------------------
function worst(...vs) {
  if (vs.includes('critical')) return 'critical';
  if (vs.includes('warning')) return 'warning';
  return 'good';
}
function vPerPosQ(r) {
  let v = 'good';
  r.perPos.median.forEach((m) => { if (m < 20) v = worst(v, 'critical'); else if (m < 25) v = worst(v, 'warning'); });
  r.perPos.p25.forEach((q) => { if (q < 5) v = worst(v, 'critical'); else if (q < 10) v = worst(v, 'warning'); });
  return v;
}
function vSeqQ(r) {
  const mode = r.seqQualMode ? r.seqQualMode.q : 0;
  return mode < 20 ? 'critical' : mode < 27 ? 'warning' : 'good';
}
function vBaseContent(r) {
  let maxDev = 0;
  for (let i = 0; i < r.perPos.position.length; i++) {
    const at = Math.abs(r.perPos.baseA[i] - r.perPos.baseT[i]);
    const gc = Math.abs(r.perPos.baseG[i] - r.perPos.baseC[i]);
    maxDev = Math.max(maxDev, at, gc);
  }
  return maxDev > 0.20 ? 'critical' : maxDev > 0.10 ? 'warning' : 'good';
}
function vNContent(r) {
  const mx = Math.max(0, ...r.perPos.baseN);
  return mx > 0.20 ? 'critical' : mx > 0.05 ? 'warning' : 'good';
}
function vGC(r) {
  return r.gcDeviation > 0.30 ? 'critical' : r.gcDeviation > 0.15 ? 'warning' : 'good';
}
function vLength(r) {
  return r.lengthDist.length > 1 ? 'warning' : 'good';
}
function vDup(r) {
  const p = r.duplication.pctDuplicated;
  return p > 50 ? 'critical' : p > 20 ? 'warning' : 'good';
}
function vOverrep(r) {
  const mx = r.overrep.length ? r.overrep[0].pct : 0;
  return mx > 1 ? 'critical' : mx > 0.1 ? 'warning' : 'good';
}
function vAdapter(r) {
  const mx = r.adapter.maxPct || 0;
  return mx > 10 ? 'critical' : mx > 5 ? 'warning' : 'good';
}

// sufijo de clave i18n para el texto de veredicto de cada nivel
const VK = { good: 'Good', warning: 'Warn', critical: 'Crit' };

function verdictColor(level) {
  return level === 'good' ? 'var(--good)' : level === 'warning' ? 'var(--warning)' : level === 'critical' ? 'var(--critical)' : 'var(--ink-muted)';
}
// el mismo estado como color de TEXTO: --good/--warning dan 3,2:1 / 1,8:1
// sobre claro; su tono -ink (css/tokens.css) queda ≥ 4,5:1 en los dos temas
function verdictInk(level) {
  return level === 'good' ? 'var(--good-ink)' : level === 'warning' ? 'var(--warning-ink)' : verdictColor(level);
}
function verdictBadge(level) {
  const c = verdictColor(level);
  return '<span class="ql-badge" style="flex:none;background:color-mix(in srgb, ' + c + ' 16%, transparent);color:' + verdictInk(level) + ';">' + t('qc.verdict.' + level) + '</span>';
}

// ---------------------------------------------------------------------------
//  ejecución del análisis (worker con fallback a hilo principal)
// ---------------------------------------------------------------------------
function runAnalysis(file, limit, onProgress) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn) => (x) => { if (!settled) { settled = true; fn(x); } };
    const ok = done(resolve), bad = done(reject);
    const mainThread = () => analyzeFastq(file, {
      maxReads: limit, onProgress,
      onYield: () => new Promise((r) => setTimeout(r, 0)),
    }).then(ok, bad);

    let worker = null;
    try {
      worker = new Worker(new URL('../workers/fastqWorker.js', import.meta.url), { type: 'module' });
    } catch (e) { worker = null; }

    if (!worker) { mainThread(); return; }

    worker.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.type === 'progress') onProgress(m.n);
      else if (m.type === 'done') { worker.terminate(); ok(m.report); }
      else if (m.type === 'error') { worker.terminate(); bad(Object.assign(new Error(m.message), { code: m.code, params: m.params })); }
    };
    worker.onerror = () => { try { worker.terminate(); } catch (e) {} if (!settled) mainThread(); };
    try { worker.postMessage({ file, maxReads: limit }); }
    catch (e) { try { worker.terminate(); } catch (_) {} mainThread(); }
  });
}

async function analyze(entry, repaint) {
  if (running.has(entry.name) || entry.report) return;
  running.add(entry.name);
  errors.delete(entry.name);
  progressN.set(entry.name, 0);
  updateProgress(entry.name);
  try {
    const report = await runAnalysis(entry.file, maxReads, (n) => {
      progressN.set(entry.name, n);
      updateProgress(entry.name);
    });
    running.delete(entry.name);
    addSequenceQC({ ...entry, report }); // notify -> repaint
  } catch (e) {
    running.delete(entry.name);
    // límites anti bomba (fastq.js): se traducen aquí, en el idioma del
    // usuario — el worker no lo conoce y solo manda el código
    const LIMIT_KEYS = { ratio: 'zip.ratioTooHigh', line: 'qc.lineTooLong' };
    errors.set(entry.name, e && LIMIT_KEYS[e.code] ? t(LIMIT_KEYS[e.code], e.params) : ((e && e.message) ? e.message : String(e)));
    repaint();
  }
}

function updateProgress(name) {
  const el = document.getElementById(safeId(name) + '_prog');
  if (el) el.textContent = t('qc.analyzing') + ' ' + fmtInt(progressN.get(name) || 0);
}

// ---------------------------------------------------------------------------
//  gráficos SVG
// ---------------------------------------------------------------------------
function chartHost(parent, w, h) {
  const wrap = document.createElement('div');
  wrap.className = 'ql-chartwrap scroll-x';
  const svg = svgEl('svg', { class: 'ql-svg', viewBox: '0 0 ' + w + ' ' + h, preserveAspectRatio: 'xMidYMid meet' });
  if (w > 720) { svg.style.width = w + 'px'; svg.style.maxWidth = 'none'; }
  wrap.appendChild(svg);
  parent.appendChild(wrap);
  return svg;
}

// Editor de gráficos (5.1 de qiimelab-prompt-editor-fase-5-especificos-por-
// tipo.md) — las 3 vistas ya usaban `svgEl` y las clases de rol compartidas
// (ql-gridline/ql-tick-label/ql-axis-label), solo faltaba enganchar
// attachChartEditor; sin `onReset` explícito: estos gráficos no tienen
// elementos arrastrables propios ni estado de redibujado externo, así que
// el fallback interno de chartEditor.js (limpiar `store` + `sync()`, que ya
// revierte data-ce-series-fill a su color por defecto) es suficiente — no
// hay un paint() de módulo al que volver a llamar desde aquí (estas 3
// funciones viven fuera de render(), son puro dibujo sin estado).
function attachQcEditor(svg, mount, key, xtitleEl) {
  attachChartEditor({
    key, svg, mount, filename: key, lang: getLang(),
    elements: xtitleEl ? [{ id: 'xtitle', selector: '[data-ce="xtitle"]' }] : [],
  });
}

function drawPerPosQuality(parent, r, key) {
  const n = r.perPos.position.length;
  const step = Math.max(2.2, Math.min(9, 820 / n));
  const mL = 46, mR = 16, mT = 14, mB = 34;
  const W = mL + mR + n * step, H = 300;
  const innerH = H - mT - mB;
  const yMax = 42;
  const svg = chartHost(parent, W, H);
  const yOf = (q) => mT + innerH - (Math.min(q, yMax) / yMax) * innerH;

  // bandas de fondo
  [[28, yMax, '--good'], [20, 28, '--warning'], [0, 20, '--critical']].forEach(([lo, hi, col]) => {
    svg.appendChild(svgEl('rect', { x: mL, y: yOf(hi), width: n * step, height: yOf(lo) - yOf(hi), fill: 'var(' + col + ')', opacity: 0.08 }));
  });
  for (let q = 0; q <= 40; q += 10) {
    const y = yOf(q);
    svg.appendChild(svgEl('line', { x1: mL, x2: mL + n * step, y1: y, y2: y, class: 'ql-gridline' }));
    const tk = svgEl('text', { x: mL - 6, y: y + 3, class: 'ql-tick-label', 'text-anchor': 'end' });
    tk.textContent = q; svg.appendChild(tk);
  }

  const meanPts = [];
  for (let i = 0; i < n; i++) {
    const x = mL + i * step + step / 2;
    const med = r.perPos.median[i];
    const bandCol = med >= 28 ? '--good' : med >= 20 ? '--warning' : '--critical';
    if (step >= 3.5) {
      svg.appendChild(svgEl('line', { x1: x, x2: x, y1: yOf(r.perPos.p90[i]), y2: yOf(r.perPos.p10[i]), stroke: 'var(--baseline)', 'stroke-width': 1 }));
      svg.appendChild(svgEl('rect', {
        x: x - step * 0.32, y: yOf(r.perPos.p75[i]), width: step * 0.64,
        height: Math.max(1, yOf(r.perPos.p25[i]) - yOf(r.perPos.p75[i])),
        fill: 'var(' + bandCol + ')', opacity: 0.35, stroke: 'var(' + bandCol + ')', 'stroke-width': 0.8, 'data-ce-role': 'bar',
      }));
      svg.appendChild(svgEl('line', { x1: x - step * 0.32, x2: x + step * 0.32, y1: yOf(med), y2: yOf(med), stroke: 'var(--ink)', 'stroke-width': 1.2 }));
    } else {
      svg.appendChild(svgEl('line', { x1: x, x2: x, y1: yOf(r.perPos.p75[i]), y2: yOf(r.perPos.p25[i]), stroke: 'var(' + bandCol + ')', 'stroke-width': Math.max(1, step * 0.7), opacity: 0.55 }));
      svg.appendChild(svgEl('circle', { cx: x, cy: yOf(med), r: Math.max(0.7, step * 0.28), fill: 'var(--ink)', 'data-ce-role': 'marker' }));
    }
    meanPts.push((mL + i * step + step / 2) + ',' + yOf(r.perPos.mean[i]));
  }
  svg.appendChild(svgEl('polyline', { points: meanPts.join(' '), fill: 'none', stroke: 'var(--cat-2)', 'stroke-width': 1.6, opacity: 0.9, 'data-ce-role': 'line' }));

  const every = Math.ceil(n / 14);
  for (let i = 0; i < n; i += every) {
    const x = mL + i * step + step / 2;
    const tk = svgEl('text', { x, y: H - 12, class: 'ql-tick-label', 'text-anchor': 'middle' });
    tk.textContent = r.perPos.position[i]; svg.appendChild(tk);
  }
  const legend = document.createElement('div');
  legend.className = 'ql-legend';
  legend.style.marginTop = '10px';
  legend.innerHTML =
    '<span class="ql-legend-item"><span class="ql-legend-swatch ql-sq" style="background:var(--good);opacity:.3"></span>' + t('qc.perPosQ.bandGood') + '</span>' +
    '<span class="ql-legend-item"><span class="ql-legend-swatch ql-sq" style="background:var(--warning);opacity:.3"></span>' + t('qc.perPosQ.bandMid') + '</span>' +
    '<span class="ql-legend-item"><span class="ql-legend-swatch ql-sq" style="background:var(--critical);opacity:.3"></span>' + t('qc.perPosQ.bandBad') + '</span>' +
    '<span class="ql-legend-item"><span class="ql-legend-swatch" style="background:var(--cat-2)"></span>' + t('qc.perPosQ.colMean') + '</span>';
  parent.appendChild(legend);
  attachQcEditor(svg, parent, key, false);
}

function drawLines(parent, { n, xValues, series, yMax, yLabel, xLabel, pct }, key) {
  const step = Math.max(1.6, Math.min(9, 820 / n));
  const mL = 48, mR = 16, mT = 14, mB = 34;
  const W = mL + mR + n * step, H = 240;
  const innerH = H - mT - mB;
  const svg = chartHost(parent, W, H);
  const yOf = (v) => mT + innerH - (Math.min(v, yMax) / yMax) * innerH;
  const ticks = 4;
  for (let k = 0; k <= ticks; k++) {
    const v = (k / ticks) * yMax;
    const y = yOf(v);
    svg.appendChild(svgEl('line', { x1: mL, x2: mL + n * step, y1: y, y2: y, class: 'ql-gridline' }));
    const tk = svgEl('text', { x: mL - 6, y: y + 3, class: 'ql-tick-label', 'text-anchor': 'end' });
    tk.textContent = pct ? v.toFixed(0) + '%' : v.toFixed(0); svg.appendChild(tk);
  }
  series.forEach((s, i) => {
    const pts = s.values.map((v, j) => (mL + j * step + step / 2) + ',' + yOf(v)).join(' ');
    svg.appendChild(svgEl('polyline', {
      points: pts, fill: 'none', stroke: 'var(' + s.colorVar + ')', 'stroke-width': 1.7, opacity: 0.95, 'data-ce-role': 'line',
      'data-ce-series-stroke': 's' + i,
    }));
  });
  const every = Math.ceil(n / 12);
  for (let i = 0; i < n; i += every) {
    const x = mL + i * step + step / 2;
    const tk = svgEl('text', { x, y: H - 12, class: 'ql-tick-label', 'text-anchor': 'middle' });
    tk.textContent = xValues ? xValues[i] : (i + 1); svg.appendChild(tk);
  }
  let hasXtitle = false;
  if (xLabel) {
    const xt = svgEl('text', { x: mL + n * step / 2, y: H - 1, class: 'ql-axis-label', 'text-anchor': 'middle', 'data-ce': 'xtitle' });
    xt.textContent = xLabel; svg.appendChild(xt);
    hasXtitle = true;
  }
  const legend = document.createElement('div');
  legend.className = 'ql-legend';
  legend.style.marginTop = '10px';
  legend.innerHTML = series.map((s) => '<span class="ql-legend-item"><span class="ql-legend-swatch" style="background:var(' + s.colorVar + ')"></span>' + escapeHtml(s.name) + '</span>').join('');
  parent.appendChild(legend);
  attachChartEditor({
    key, svg, mount: parent, filename: key, lang: getLang(),
    elements: hasXtitle ? [{ id: 'xtitle', selector: '[data-ce="xtitle"]' }] : [],
    ...(series.length > 1 ? {
      paletteSeries: series.map((s, i) => ({ id: 's' + i, label: s.name })),
      paletteType: 'categorical',
    } : {}),
  });
}

function drawBars(parent, { bars, yLabel, xLabel, colorVar, overlay, rotate }, key) {
  const nb = bars.length;
  const W = Math.max(520, Math.min(920, 40 + nb * 46)), H = 250;
  const mL = 48, mR = 16, mT = 14, mB = rotate ? 56 : 34;
  const innerW = W - mL - mR, innerH = H - mT - mB;
  const bw = innerW / nb;
  let yMax = Math.max(1, ...bars.map((b) => b.value), ...(overlay ? overlay.map((o) => o.value) : []));
  yMax *= 1.12;
  const svg = chartHost(parent, W, H);
  const yOf = (v) => mT + innerH - (v / yMax) * innerH;
  for (let k = 0; k <= 4; k++) {
    const v = (k / 4) * yMax, y = yOf(v);
    svg.appendChild(svgEl('line', { x1: mL, x2: mL + innerW, y1: y, y2: y, class: 'ql-gridline' }));
    const tk = svgEl('text', { x: mL - 6, y: y + 3, class: 'ql-tick-label', 'text-anchor': 'end' });
    tk.textContent = yMax > 12 ? v.toFixed(0) : v.toFixed(1); svg.appendChild(tk);
  }
  bars.forEach((b, i) => {
    const x = mL + i * bw;
    svg.appendChild(svgEl('rect', {
      x: x + bw * 0.15, y: yOf(b.value), width: bw * 0.7, height: Math.max(0, yOf(0) - yOf(b.value)),
      fill: 'var(' + (b.colorVar || colorVar || '--cat-1') + ')', rx: 2, 'data-ce-series-fill': 's0', 'data-ce-role': 'bar',
    }));
    const tk = svgEl('text', { x: x + bw / 2, y: H - (rotate ? 40 : 12), class: 'ql-tick-label', 'text-anchor': rotate ? 'end' : 'middle' });
    tk.textContent = b.label;
    if (rotate) tk.setAttribute('transform', 'rotate(-45 ' + (x + bw / 2) + ' ' + (H - 40) + ')');
    svg.appendChild(tk);
  });
  if (overlay) {
    const pts = overlay.map((o, i) => (mL + i * bw + bw / 2) + ',' + yOf(o.value)).join(' ');
    svg.appendChild(svgEl('polyline', { points: pts, fill: 'none', stroke: 'var(--ink-muted)', 'stroke-width': 1.5, 'stroke-dasharray': '3 3', 'data-ce-role': 'line' }));
  }
  let hasXtitle = false;
  if (xLabel) {
    const xt = svgEl('text', { x: mL + innerW / 2, y: H - 1, class: 'ql-axis-label', 'text-anchor': 'middle', 'data-ce': 'xtitle' });
    xt.textContent = xLabel; svg.appendChild(xt);
    hasXtitle = true;
  }
  attachChartEditor({
    key, svg, mount: parent, filename: key, lang: getLang(),
    elements: hasXtitle ? [{ id: 'xtitle', selector: '[data-ce="xtitle"]' }] : [],
    paletteSeries: [{ id: 's0', label: t('qc.chartBarColor') }],
    paletteType: 'categorical',
  });
}

function detailsTable(parent, headerCells, rows) {
  const d = document.createElement('details');
  d.style.marginTop = '10px';
  const s = document.createElement('summary');
  s.style.cssText = 'cursor:pointer;font-size:12px;color:var(--ink-muted);';
  s.textContent = t('qc.showTable');
  d.appendChild(s);
  const scroll = document.createElement('div');
  scroll.className = 'ql-table-scroll';
  scroll.style.marginTop = '8px';
  const tbl = document.createElement('table');
  tbl.className = 'ql-table';
  tbl.innerHTML = '<thead><tr>' + headerCells.map((h) => '<th>' + escapeHtml(h) + '</th>').join('') + '</tr></thead>';
  const tb = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = row.map((c, i) => '<td' + (i === 0 ? '' : ' class="ql-num tabular"') + '>' + escapeHtml(String(c)) + '</td>').join('');
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  scroll.appendChild(tbl);
  d.appendChild(scroll);
  parent.appendChild(d);
}

function metricCard(container, { titleKey, verdict, explainKey, interpretKey, verdictTextKey, verdictParams, noteKey }) {
  const card = document.createElement('section');
  card.className = 'ql-card ql-panel';
  card.style.marginTop = '18px';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:4px;';
  head.innerHTML = '<h2 style="margin:0;">' + t(titleKey) + '</h2>' + (verdict ? verdictBadge(verdict) : '');
  card.appendChild(head);
  const body = document.createElement('div');
  card.appendChild(body);
  const texts = document.createElement('div');
  texts.style.marginTop = '12px';
  if (explainKey) texts.innerHTML += '<p class="ql-panel-note" style="margin-bottom:6px;">' + t(explainKey) + '</p>';
  if (interpretKey) texts.innerHTML += '<p class="ql-field-help" style="margin:0 0 6px;">' + t(interpretKey) + '</p>';
  if (verdictTextKey) texts.innerHTML += '<p style="font-size:12.5px;margin:6px 0 0;"><strong style="color:' + verdictInk(verdict) + ';">' + t('qc.verdict.' + verdict) + ':</strong> ' + t(verdictTextKey, verdictParams || {}) + '</p>';
  if (noteKey) texts.innerHTML += '<p class="ql-field-help" style="margin:6px 0 0;font-style:italic;">' + t(noteKey) + '</p>';
  card.appendChild(texts);
  container.appendChild(card);
  return body;
}

// ---------------------------------------------------------------------------
//  informe completo de un archivo
// ---------------------------------------------------------------------------
function renderReport(container, r, fileName) {
  const overall = worst(vPerPosQ(r), vSeqQ(r), vNContent(r), vGC(r), vDup(r), vAdapter(r), vOverrep(r));
  const qk = (metric) => 'qc-' + safeId(fileName || 'file') + '-' + metric; // clave de attachChartEditor por archivo+métrica

  // aviso de submuestra
  const note = document.createElement('div');
  note.className = 'ql-card ql-panel';
  note.style.cssText = 'margin-top:18px;border-left:3px solid var(--border-strong);';
  note.innerHTML = '<p style="margin:0;font-size:13px;">' +
    (r.subsampled
      ? t('qc.subsampleNote', { n: fmtInt(r.nReads), total: fmtInt(r.estTotalReads) })
      : t('qc.wholeFileNote', { n: fmtInt(r.nReads) })) + '</p>';
  container.appendChild(note);

  // resumen semáforo
  const sum = document.createElement('section');
  sum.className = 'ql-card ql-panel';
  sum.style.marginTop = '18px';
  sum.innerHTML = '<h2 style="margin-bottom:4px;">' + t('qc.overall.title') + '</h2><p class="ql-panel-note">' + t('qc.overall.note') + '</p>';
  const chips = document.createElement('div');
  chips.className = 'ql-legend';
  [
    ['qc.perPosQ.title', vPerPosQ(r)], ['qc.seqQ.title', vSeqQ(r)], ['qc.baseContent.title', vBaseContent(r)],
    ['qc.nContent.title', vNContent(r)], ['qc.gcDist.title', vGC(r)], ['qc.lengthDist.title', vLength(r)],
    ['qc.duplication.title', vDup(r)], ['qc.overrep.title', vOverrep(r)], ['qc.adapter.title', vAdapter(r)],
  ].forEach(([k, v]) => {
    const s = document.createElement('span');
    s.className = 'ql-legend-item';
    s.innerHTML = '<span class="ql-legend-swatch" style="background:' + verdictColor(v) + '"></span>' + t(k);
    chips.appendChild(s);
  });
  sum.appendChild(chips);
  container.appendChild(sum);

  // 1. estadísticas básicas
  const statsCard = document.createElement('section');
  statsCard.className = 'ql-card ql-panel';
  statsCard.style.marginTop = '18px';
  statsCard.innerHTML = '<h2>' + t('qc.stats.title') + '</h2>';
  const grid = document.createElement('div');
  grid.className = 'ql-stats';
  const rows = [
    [t('qc.stats.reads'), fmtInt(r.nReads)],
    [t('qc.stats.readsEst'), r.subsampled ? '≈ ' + fmtInt(r.estTotalReads) : fmtInt(r.nReads)],
    [t('qc.stats.length'), r.lenMin + ' / ' + r.lenMean.toFixed(0) + ' / ' + r.lenMax],
    [t('qc.stats.gc'), r.gcPercent.toFixed(1) + ' %'],
    [t('qc.stats.meanQ'), r.meanQuality.toFixed(1)],
    [t('qc.stats.q30'), r.pctQ30 != null ? r.pctQ30.toFixed(1) + ' %' : '—'],
    [t('qc.stats.nContent'), r.nContentPct.toFixed(3) + ' %'],
    [t('qc.stats.encoding'), r.encoding],
    [t('qc.stats.totalBases'), fmtInt(r.totalBases)],
  ];
  rows.forEach(([lbl, val]) => {
    const tile = document.createElement('div');
    tile.className = 'ql-stat';
    tile.innerHTML = '<div class="ql-stat-label">' + lbl + '</div><div class="ql-stat-value" style="font-size:15px;">' + escapeHtml(String(val)) + '</div>';
    grid.appendChild(tile);
  });
  statsCard.appendChild(grid);
  if (r.primer16S) {
    const p = document.createElement('p');
    p.className = 'ql-field-help';
    p.style.marginTop = '12px';
    p.innerHTML = r.primer16S.detected
      ? '⚠ ' + t('qc.primer16S.detected', { pct: r.primer16S.pct.toFixed(0), name: r.primer16S.name })
      : t('qc.primer16S.notDetected');
    statsCard.appendChild(p);
  }
  container.appendChild(statsCard);

  // 2. calidad por posición
  {
    const body = metricCard(container, {
      titleKey: 'qc.perPosQ.title', verdict: vPerPosQ(r),
      explainKey: 'qc.perPosQ.explain', interpretKey: 'qc.perPosQ.interpret',
      verdictTextKey: 'qc.perPosQ.verdict' + VK[vPerPosQ(r)],
    });
    drawPerPosQuality(body, r, qk('perpos'));
    detailsTable(body,
      [t('qc.perPosQ.colPos'), t('qc.perPosQ.colQ25'), t('qc.perPosQ.colMedian'), t('qc.perPosQ.colQ75'), t('qc.perPosQ.colMean')],
      r.perPos.position.map((p, i) => [p, r.perPos.p25[i], r.perPos.median[i], r.perPos.p75[i], r.perPos.mean[i].toFixed(1)]));
  }

  // 3. calidad media por lectura
  {
    const body = metricCard(container, {
      titleKey: 'qc.seqQ.title', verdict: vSeqQ(r),
      explainKey: 'qc.seqQ.explain', interpretKey: 'qc.seqQ.interpret',
      verdictTextKey: 'qc.seqQ.verdict' + VK[vSeqQ(r)],
    });
    const bars = r.seqQual.filter((x) => x.q >= 2).map((x) => ({ label: String(x.q), value: x.count }));
    drawBars(body, { bars, colorVar: '--cat-1', xLabel: t('qc.seqQ.colQ') }, qk('seqq'));
    detailsTable(body, [t('qc.seqQ.colQ'), t('qc.seqQ.colCount')], r.seqQual.map((x) => [x.q, fmtInt(x.count)]));
  }

  // 4. composición de bases por posición
  {
    const body = metricCard(container, {
      titleKey: 'qc.baseContent.title', verdict: vBaseContent(r),
      explainKey: 'qc.baseContent.explain', interpretKey: 'qc.baseContent.interpret',
      verdictTextKey: 'qc.baseContent.verdict' + VK[vBaseContent(r)], noteKey: 'qc.baseContent.ampliconNote',
    });
    drawLines(body, {
      n: r.perPos.position.length, xValues: r.perPos.position, yMax: 60, pct: true, xLabel: t('qc.baseContent.colPos'),
      series: [
        { name: 'A', colorVar: '--cat-1', values: r.perPos.baseA.map((v) => v * 100) },
        { name: 'C', colorVar: '--cat-2', values: r.perPos.baseC.map((v) => v * 100) },
        { name: 'G', colorVar: '--cat-3', values: r.perPos.baseG.map((v) => v * 100) },
        { name: 'T', colorVar: '--cat-4', values: r.perPos.baseT.map((v) => v * 100) },
      ],
    }, qk('basecontent'));
    detailsTable(body, [t('qc.baseContent.colPos'), '%A', '%C', '%G', '%T'],
      r.perPos.position.map((p, i) => [p, (r.perPos.baseA[i] * 100).toFixed(1), (r.perPos.baseC[i] * 100).toFixed(1), (r.perPos.baseG[i] * 100).toFixed(1), (r.perPos.baseT[i] * 100).toFixed(1)]));
  }

  // 5. contenido de N por posición
  {
    const body = metricCard(container, {
      titleKey: 'qc.nContent.title', verdict: vNContent(r),
      explainKey: 'qc.nContent.explain', interpretKey: 'qc.nContent.interpret',
      verdictTextKey: 'qc.nContent.verdict' + VK[vNContent(r)],
    });
    const nMax = Math.max(2, Math.ceil(Math.max(...r.perPos.baseN) * 100) + 1);
    drawLines(body, {
      n: r.perPos.position.length, xValues: r.perPos.position, yMax: nMax, pct: true, xLabel: t('qc.nContent.title'),
      series: [{ name: '%N', colorVar: '--cat-5', values: r.perPos.baseN.map((v) => v * 100) }],
    }, qk('ncontent'));
  }

  // 6. distribución de %GC
  {
    const body = metricCard(container, {
      titleKey: 'qc.gcDist.title', verdict: vGC(r),
      explainKey: 'qc.gcDist.explain', interpretKey: 'qc.gcDist.interpret',
      verdictTextKey: 'qc.gcDist.verdict' + VK[vGC(r)],
    });
    const bars = r.gc.map((x) => ({ label: x.gc % 10 === 0 ? String(x.gc) : '', value: x.count }));
    drawBars(body, { bars, colorVar: '--cat-3', overlay: r.gc.map((x) => ({ value: x.theoretical })), xLabel: t('qc.gcDist.colGC') }, qk('gcdist'));
    detailsTable(body, [t('qc.gcDist.colGC'), t('qc.gcDist.colObs'), t('qc.gcDist.colTheo')],
      r.gc.filter((x) => x.count > 0 || x.theoretical > 0.5).map((x) => [x.gc, fmtInt(x.count), x.theoretical.toFixed(0)]));
  }

  // 7. distribución de longitud
  {
    const body = metricCard(container, {
      titleKey: 'qc.lengthDist.title', verdict: vLength(r),
      explainKey: 'qc.lengthDist.explain', interpretKey: 'qc.lengthDist.interpret',
      verdictTextKey: 'qc.lengthDist.verdict' + VK[vLength(r)],
    });
    drawBars(body, { bars: r.lengthDist.map((x) => ({ label: String(x.len), value: x.count })), colorVar: '--cat-6', xLabel: t('qc.lengthDist.colLen') }, qk('lengthdist'));
    detailsTable(body, [t('qc.lengthDist.colLen'), t('qc.lengthDist.colCount')], r.lengthDist.map((x) => [x.len, fmtInt(x.count)]));
  }

  // 8. niveles de duplicación
  {
    const dv = vDup(r);
    const body = metricCard(container, {
      titleKey: 'qc.duplication.title', verdict: dv,
      explainKey: 'qc.duplication.explain', interpretKey: 'qc.duplication.interpret',
      verdictTextKey: 'qc.duplication.verdict' + VK[dv], verdictParams: { pct: r.duplication.pctDuplicated.toFixed(1) },
      noteKey: 'qc.duplication.ampliconNote',
    });
    drawBars(body, { bars: r.duplication.levels.map((x) => ({ label: x.label, value: x.pctReads })), colorVar: '--cat-7', xLabel: t('qc.duplication.colLevel'), rotate: true }, qk('duplication'));
    const rem = document.createElement('p');
    rem.className = 'ql-field-help';
    rem.style.marginTop = '8px';
    rem.textContent = t('qc.duplication.remaining', { pct: r.duplication.pctDistinctIfDedup.toFixed(1) });
    body.appendChild(rem);
    if (r.duplication.capped) {
      const cp = document.createElement('p');
      cp.className = 'ql-field-help';
      cp.textContent = t('qc.duplication.cappedNote', { n: fmtInt(r.duplication.distinctSeqs) });
      body.appendChild(cp);
    }
    detailsTable(body, [t('qc.duplication.colLevel'), t('qc.duplication.colReads'), t('qc.duplication.colSeqs')],
      r.duplication.levels.map((x) => [x.label, x.pctReads.toFixed(2) + ' %', fmtInt(x.seqs)]));
  }

  // 9. secuencias sobrerrepresentadas
  {
    const ov = vOverrep(r);
    const body = metricCard(container, {
      titleKey: 'qc.overrep.title', verdict: ov,
      explainKey: 'qc.overrep.explain', interpretKey: 'qc.overrep.interpret',
      verdictTextKey: 'qc.overrep.verdict' + VK[ov],
    });
    if (r.overrep.length === 0) {
      const p = document.createElement('p');
      p.className = 'ql-field-help';
      p.textContent = t('qc.overrep.none');
      body.appendChild(p);
    } else {
      const scroll = document.createElement('div');
      scroll.className = 'ql-table-scroll';
      scroll.style.marginTop = '8px';
      const tbl = document.createElement('table');
      tbl.className = 'ql-table';
      tbl.innerHTML = '<thead><tr><th>' + t('qc.overrep.colSeq') + '</th><th>' + t('qc.overrep.colLen') + '</th><th>' + t('qc.overrep.colCount') + '</th><th>' + t('qc.overrep.colPct') + '</th></tr></thead>';
      const tb = document.createElement('tbody');
      r.overrep.forEach((o) => {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td><span class="mono" style="font-size:11px;">' + escapeHtml(o.seqPreview) + '</span></td>' +
          '<td class="ql-num tabular">' + o.seqLen + '</td><td class="ql-num tabular">' + fmtInt(o.count) + '</td><td class="ql-num tabular">' + o.pct.toFixed(2) + ' %</td>';
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      scroll.appendChild(tbl);
      body.appendChild(scroll);
    }
  }

  // 10. contenido de adaptadores
  {
    const av = vAdapter(r);
    const body = metricCard(container, {
      titleKey: 'qc.adapter.title', verdict: av,
      explainKey: 'qc.adapter.explain', interpretKey: 'qc.adapter.interpret',
      verdictTextKey: 'qc.adapter.verdict' + VK[av], verdictParams: { pct: (r.adapter.maxPct || 0).toFixed(1) },
    });
    if ((r.adapter.maxPct || 0) < 0.05) {
      const p = document.createElement('p');
      p.className = 'ql-field-help';
      p.textContent = t('qc.adapter.none');
      body.appendChild(p);
    } else {
      drawLines(body, {
        n: r.adapter.position.length, xValues: r.adapter.position, yMax: Math.max(2, Math.ceil(r.adapter.maxPct * 1.2)), pct: true, xLabel: t('qc.adapter.colPos'),
        series: r.adapter.series.map((s, i) => ({ name: s.name, colorVar: CAT[i % CAT.length], values: s.values })),
      }, qk('adapter'));
    }
  }
}

// ---------------------------------------------------------------------------
//  resumen numérico global + veredicto en lenguaje llano
// ---------------------------------------------------------------------------
function overallQualityVerdict({ q30, meanQ, dup }) {
  const q = q30 != null ? q30 : (meanQ >= 32 ? 88 : meanQ >= 28 ? 78 : meanQ >= 22 ? 58 : 35);
  if (q >= 80 && meanQ >= 28 && dup <= 25) return 'good';
  if (q >= 55 && meanQ >= 20 && dup <= 55) return 'warning';
  return 'critical';
}

function renderGlobalSummary(container, entries) {
  const done = entries.filter((e) => e.report && e.report.nReads > 0);
  if (done.length === 0) return;

  let reads = 0, readsEst = 0, anySub = false;
  let lenW = 0, gcW = 0, qW = 0, q30W = 0, dupW = 0;
  let wReads = 0, wBases = 0, wDup = 0, anyQ30 = false;
  done.forEach((e) => {
    const r = e.report;
    reads += r.nReads;
    readsEst += (r.subsampled && r.estTotalReads) ? r.estTotalReads : r.nReads;
    if (r.subsampled) anySub = true;
    lenW += (r.lenMean || 0) * r.nReads;
    gcW += (r.gcPercent || 0) * r.nReads;
    wReads += r.nReads;
    const tb = r.totalBases || (r.nReads * (r.lenMean || 1));
    qW += (r.meanQuality || 0) * tb;
    if (r.pctQ30 != null) { q30W += r.pctQ30 * tb; anyQ30 = true; }
    wBases += tb;
    const tr = (r.duplication && r.duplication.trackedReads) || r.nReads;
    dupW += ((r.duplication && r.duplication.pctDuplicated) || 0) * tr;
    wDup += tr;
  });
  const meanLen = wReads ? lenW / wReads : 0;
  const meanGC = wReads ? gcW / wReads : 0;
  const meanQ = wBases ? qW / wBases : 0;
  const q30 = anyQ30 && wBases ? q30W / wBases : null;
  const dup = wDup ? dupW / wDup : 0;
  const verdict = overallQualityVerdict({ q30, meanQ, dup });

  const card = document.createElement('section');
  card.className = 'ql-card ql-panel';
  card.style.marginTop = '18px';
  card.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:start;gap:10px;">' +
    '<h2 style="margin:0 0 4px;">' + t('qc.summary.title') + '</h2>' + verdictBadge(verdict) + '</div>' +
    '<p class="ql-panel-note">' + t('qc.summary.note') + '</p>';

  const grid = document.createElement('div');
  grid.className = 'ql-stats';
  const rows = [
    [t('qc.summary.samples'), fmtInt(done.length)],
    [anySub ? t('qc.summary.readsEst') : t('qc.summary.reads'), (anySub ? '≈ ' : '') + fmtInt(anySub ? readsEst : reads)],
    [t('qc.summary.length'), meanLen.toFixed(0) + ' bp'],
    [t('qc.summary.gc'), meanGC.toFixed(1) + ' %'],
    [t('qc.summary.q30'), q30 != null ? q30.toFixed(1) + ' %' : '—'],
    [t('qc.summary.meanQ'), meanQ.toFixed(1)],
    [t('qc.summary.dup'), dup.toFixed(1) + ' %'],
  ];
  rows.forEach(([lbl, val]) => {
    const tile = document.createElement('div');
    tile.className = 'ql-stat';
    tile.innerHTML = '<div class="ql-stat-label">' + lbl + '</div><div class="ql-stat-value" style="font-size:16px;">' + escapeHtml(String(val)) + '</div>';
    grid.appendChild(tile);
  });
  card.appendChild(grid);

  const line = document.createElement('p');
  line.style.cssText = 'margin:12px 0 0;font-size:13.5px;';
  line.innerHTML = '<strong style="color:' + verdictInk(verdict) + ';">' +
    t('qc.summary.verdictLabel') + ':</strong> ' + t('qc.summary.verdict' + VK[verdict]);
  card.appendChild(line);

  container.appendChild(card);
}

// ---------------------------------------------------------------------------
//  comparativa multi-muestra
// ---------------------------------------------------------------------------
function renderComparison(container, entries, onPick) {
  const done = entries.filter((e) => e.report);
  if (done.length < 2) return;
  const card = document.createElement('section');
  card.className = 'ql-card ql-panel';
  card.style.marginTop = '18px';
  card.innerHTML = '<h2>' + t('qc.compare.title') + '</h2><p class="ql-panel-note">' + t('qc.compare.note') + '</p>';
  const scroll = document.createElement('div');
  scroll.className = 'ql-table-scroll';
  const tbl = document.createElement('table');
  tbl.className = 'ql-table';
  tbl.innerHTML = '<thead><tr><th>' + [
    t('qc.compare.colFile'), t('qc.compare.colReads'), t('qc.compare.colLen'),
    t('qc.compare.colGC'), t('qc.compare.colQual'), t('qc.compare.colDup'), t('qc.compare.colAdapter'),
  ].join('</th><th>') + '</th></tr></thead>';
  const tb = document.createElement('tbody');
  done.forEach((e) => {
    const r = e.report;
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    if (e.name === selected) tr.style.background = 'color-mix(in srgb, var(--accent) 12%, transparent)';
    tr.innerHTML = '<td>' + escapeHtml(e.name) + (r.subsampled ? ' <span class="ql-badge ql-badge-muted">sub</span>' : '') + '</td>' +
      '<td class="ql-num tabular">' + fmtInt(r.nReads) + '</td>' +
      '<td class="ql-num tabular">' + r.lenMean.toFixed(0) + '</td>' +
      '<td class="ql-num tabular">' + r.gcPercent.toFixed(1) + '</td>' +
      '<td class="ql-num tabular">' + r.meanQuality.toFixed(1) + '</td>' +
      '<td class="ql-num tabular">' + r.duplication.pctDuplicated.toFixed(1) + '</td>' +
      '<td class="ql-num tabular">' + (r.adapter.maxPct || 0).toFixed(1) + '</td>';
    tr.addEventListener('click', () => onPick(e.name));
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  scroll.appendChild(tbl);
  card.appendChild(scroll);
  container.appendChild(card);
}

// ---------------------------------------------------------------------------
//  render principal
// ---------------------------------------------------------------------------
export function render(container) {
  function paint() {
    container.innerHTML = '';
    const entries = Array.isArray(state.sequenceQC) ? state.sequenceQC : [];

    const header = document.createElement('header');
    header.className = 'ql-page-header';
    header.innerHTML =
      '<p class="ql-eyebrow">' + t('qc.eyebrow') + '</p>' +
      '<h1 class="ql-page-title">' + t('qc.title') + '</h1>' +
      '<p class="ql-page-sub">' + t('qc.subtitle') + '</p>';
    container.appendChild(header);

    // --- tarjeta de carga ---
    const loadCard = document.createElement('section');
    loadCard.className = 'ql-card ql-panel';
    const dz = document.createElement('div');
    dz.className = 'ql-dropzone';
    dz.tabIndex = 0;
    dz.setAttribute('role', 'button');
    dz.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>' +
      '<div><div class="ql-dz-text"><b>' + t('qc.empty.drop') + '</b></div><div class="ql-dz-sub">' + t('qc.empty.dropSub') + '</div></div>';
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.fastq,.fq,.gz';
    dz.appendChild(input);
    loadCard.appendChild(dz);

    // --- submuestra: visible y ajustable (presets + valor libre) ---
    const optRow = document.createElement('div');
    optRow.className = 'ql-field';
    optRow.style.marginTop = '14px';
    optRow.innerHTML = '<label>' + t('qc.maxReadsLabel') + '</label>';
    const seg = document.createElement('div');
    seg.className = 'ql-segmented';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', t('qc.maxReadsLabel'));
    QC_PRESETS.forEach((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-seg-btn' + (maxReads === v ? ' is-on' : '');
      b.textContent = v === Infinity ? t('qc.presetAll') : fmtInt(v);
      if (maxReads === v) b.setAttribute('aria-pressed', 'true');
      b.addEventListener('click', () => { maxReads = v; paint(); });
      seg.appendChild(b);
    });
    optRow.appendChild(seg);

    const customRow = document.createElement('div');
    customRow.className = 'ql-inputrow';
    customRow.style.marginTop = '8px';
    const cLabel = document.createElement('label');
    cLabel.setAttribute('for', 'qc-maxreads');
    cLabel.className = 'ql-field-help';
    cLabel.style.cssText = 'margin:0;flex:none;';
    cLabel.textContent = t('qc.presetCustom');
    const mrInput = document.createElement('input');
    mrInput.type = 'number';
    mrInput.id = 'qc-maxreads';
    mrInput.className = 'ql-num-small tabular';
    mrInput.min = '1000';
    mrInput.step = '10000';
    mrInput.value = isFinite(maxReads) ? String(maxReads) : '';
    mrInput.placeholder = '∞';
    mrInput.addEventListener('change', () => {
      const v = parseInt(mrInput.value, 10);
      if (isFinite(v) && v >= 1000) { maxReads = v; paint(); }
    });
    customRow.append(cLabel, mrInput);
    optRow.appendChild(customRow);
    optRow.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('qc.maxReadsHelp') + '</p>');

    // aviso de memoria / tiempo al elegir una submuestra grande
    const cost = estimateCost(entries, maxReads);
    if (cost) {
      const w = document.createElement('p');
      w.className = 'ql-field-help';
      w.style.cssText = 'margin-top:6px;color:#8a5a00;';
      w.innerHTML = '⚠ ' + cost;
      optRow.appendChild(w);
    }
    loadCard.appendChild(optRow);

    if (entries.length === 0) {
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;';
      const exBtn = document.createElement('button');
      exBtn.type = 'button';
      exBtn.className = 'ql-btn ql-btn-primary';
      exBtn.textContent = t('qc.loadExampleReal');
      exBtn.addEventListener('click', async () => {
        exBtn.disabled = true;
        exBtn.textContent = t('common.loadingProcessing');
        try { await loadRealSequenceQC(); } catch (e) { exBtn.disabled = false; exBtn.textContent = t('qc.loadExampleReal'); }
      });
      btnRow.appendChild(exBtn);
      loadCard.appendChild(btnRow);
    }

    const privacy = document.createElement('p');
    privacy.className = 'ql-privacy';
    privacy.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5l-8-3Z"/></svg>' + t('shell.footer');
    loadCard.appendChild(privacy);
    container.appendChild(loadCard);

    // eventos de carga
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('is-drag'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('is-drag'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('is-drag'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
    input.addEventListener('change', (e) => { if (e.target.files.length) addFiles(e.target.files); });

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ql-card ql-panel';
      empty.style.marginTop = '18px';
      empty.innerHTML = '<div class="ql-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 17V7m4 10v-4m4 4V5m4 12v-7m4 7V9"/><path d="M2 20h20"/></svg>' +
        '<h3>' + t('qc.empty.title') + '</h3><p>' + t('qc.empty.note') + '</p></div>';
      empty.querySelector('.ql-empty').appendChild(exampleDownloadBlock(['fastq']));
      container.appendChild(empty);
      return;
    }

    // --- lista de archivos + estado ---
    const fileList = document.createElement('section');
    fileList.className = 'ql-card ql-panel';
    fileList.style.marginTop = '18px';
    fileList.innerHTML = '<h2 style="margin-bottom:6px;">' + t('slots.fastq') + ' (' + entries.length + ')</h2>';
    const list = document.createElement('div');
    list.className = 'ql-filelist';
    const BIG = 100 * 1024 * 1024;
    let anyBig = false;
    entries.forEach((e) => {
      const row = document.createElement('div');
      row.className = 'ql-file-row';
      let status;
      if (e.report) status = fmtInt(e.report.nReads) + ' ' + t('qc.stats.reads').toLowerCase() + (e.report.subsampled ? ' · sub' : '');
      else if (errors.has(e.name)) status = '⚠ ' + errors.get(e.name);
      else if (running.has(e.name)) status = '';
      else status = fmtBytes(e.file && e.file.size);
      if (e.file && e.file.size > BIG && !e.report) anyBig = true;
      row.innerHTML = '<span class="ql-file-name">' + escapeHtml(e.name) + '</span>' +
        '<span class="ql-file-meta" id="' + safeId(e.name) + '_prog">' + escapeHtml(status) + '</span>';
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '✕';
      rm.title = t('ui.remove');
      rm.addEventListener('click', () => { errors.delete(e.name); if (selected === e.name) selected = null; removeFile(e.sourceFileId); });
      row.appendChild(rm);
      list.appendChild(row);
      if (running.has(e.name)) updateProgress(e.name);
    });
    fileList.appendChild(list);
    if (anyBig) {
      const w = document.createElement('p');
      w.className = 'ql-field-help';
      w.style.cssText = 'margin-top:10px;color:#8a5a00;';
      w.textContent = t('qc.bigFileWarn', { size: '> 100 MB', n: isFinite(maxReads) ? fmtInt(maxReads) : t('qc.presetAll') });
      fileList.appendChild(w);
    }
    // volver a analizar todo con el límite actual (útil al cambiar el preset)
    const doneNow = entries.filter((e) => e.report);
    if (doneNow.length > 0) {
      const reAll = document.createElement('button');
      reAll.type = 'button';
      reAll.className = 'ql-btn';
      reAll.style.marginTop = '10px';
      reAll.textContent = t('qc.reanalyzeAll', { n: isFinite(maxReads) ? fmtInt(maxReads) : t('qc.presetAll') });
      reAll.addEventListener('click', () => {
        doneNow.forEach((e) => { e.report = null; errors.delete(e.name); });
        paint();
      });
      fileList.appendChild(reAll);
    }
    container.appendChild(fileList);

    // --- resumen numérico + veredicto en lenguaje llano (antes de la tabla) ---
    renderGlobalSummary(container, entries);

    // --- comparativa ---
    renderComparison(container, entries, (name) => { selected = name; paint(); });

    // --- selección del archivo a mostrar ---
    const withReport = entries.filter((e) => e.report);
    if (!selected || !entries.find((e) => e.name === selected)) {
      selected = (withReport[0] || entries[0]).name;
    }
    const cur = entries.find((e) => e.name === selected);

    if (entries.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'ql-tabs';
      tabs.style.marginTop = '18px';
      entries.forEach((e) => {
        const b = document.createElement('button');
        b.className = 'ql-tab' + (e.name === selected ? ' is-active' : '');
        b.textContent = e.name;
        b.addEventListener('click', () => { selected = e.name; paint(); });
        tabs.appendChild(b);
      });
      container.appendChild(tabs);
    }

    if (cur.report) {
      renderReport(container, cur.report, cur.name);
    } else if (errors.has(cur.name)) {
      const c = document.createElement('div');
      c.className = 'ql-card ql-panel';
      c.style.marginTop = '18px';
      c.innerHTML = '<h2>' + t('qc.analyzeError') + '</h2><p class="ql-panel-note">' + escapeHtml(errors.get(cur.name)) + '</p>';
      const retry = document.createElement('button');
      retry.className = 'ql-btn';
      retry.textContent = t('qc.reanalyze');
      retry.addEventListener('click', () => { errors.delete(cur.name); analyze(cur, paint); paint(); });
      c.appendChild(retry);
      container.appendChild(c);
    } else {
      const c = document.createElement('div');
      c.className = 'ql-card ql-panel';
      c.style.marginTop = '18px';
      c.innerHTML = '<div class="ql-empty"><h3 id="' + safeId(cur.name) + '_prog">' + t('qc.analyzing') + '</h3>' +
        '<p class="ql-field-help">' + escapeHtml(cur.name) + '</p></div>';
      container.appendChild(c);
    }

    // --- lanzar análisis pendientes (máx. 2 a la vez) ---
    entries.forEach((e) => {
      if (!e.report && !running.has(e.name) && !errors.has(e.name) && running.size < 2) {
        analyze(e, paint);
      }
    });
  }

  async function addFiles(fileList) {
    const arr = Array.from(fileList).filter((f) => FASTQ_RE.test(f.name));
    if (arr.length === 0) return;
    arr.forEach((file) => {
      const fileId = registerFile(file.name, file.size, 'FASTQ');
      addSequenceQC({ sourceFileId: fileId, name: file.name, file, report: null });
    });
    // addSequenceQC ya dispara notify -> paint
  }

  paint();
  return subscribe(paint);
}
