// Recuento de colonias sobre una foto de la placa (#/recuentos?tab=foto).
//
// Autocontenido como la calculadora de UFC/mL: la imagen se analiza en el
// propio navegador con js/lib/colonyCount.js y NO sale del equipo (ni se
// guarda en localStorage — solo se persisten los ajustes numéricos). La
// aritmética de UFC/mL es la compartida de js/lib/cfu.js, la misma que usa la
// pestaña «Calculadora UFC/mL».
//
// El recuento es ASISTIDO: el automático propone y la persona corrige a clics.
// Esa corrección no es un adorno — en una placa real hay colonias pegadas al
// borde, restos de medio y colonias puntiformes, y quien publica el dato es
// quien tiene que poder ajustarlo.

import { t } from '../lib/i18n.js';
import { escapeHtml } from '../lib/dom.js';
import { registerFile, addMicrobialCountSeries } from '../state.js';
import { DIL_MODES, dilutionFactor, volumeInMl, cfuPerMl, num, plateReliability } from '../lib/cfu.js';
import { countColonies, applyManualEdits, toGrayscale, suggestRoi } from '../lib/colonyCount.js';

const STORE_KEY = 'smart-175.plateImage';

// Lado máximo al que se reescala la foto antes de analizarla. Una foto de
// móvil son 12 Mpx; a ese tamaño el etiquetado de componentes tarda segundos y
// no mejora el recuento, porque una colonia ya ocupa cientos de píxeles.
const MAX_SIDE = 1400;

const VOLUME_UNITS = ['ul', 'ml', 'l'];

function defaultSettings() {
  return {
    polarity: 'auto',
    sensitivity: 0,
    minArea: 0,          // 0 = automático (relativo al tamaño de la placa)
    aggregateFactor: 2,
    dilMode: 'exp',
    dil: '3',
    volume: '100',
    volumeUnit: 'ul',
  };
}

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const d = defaultSettings();
      return {
        polarity: ['auto', 'light', 'dark'].includes(raw.polarity) ? raw.polarity : d.polarity,
        sensitivity: Number.isFinite(+raw.sensitivity) ? +raw.sensitivity : d.sensitivity,
        minArea: Number.isFinite(+raw.minArea) && +raw.minArea >= 0 ? +raw.minArea : d.minArea,
        aggregateFactor: Number.isFinite(+raw.aggregateFactor) && +raw.aggregateFactor > 1 ? +raw.aggregateFactor : d.aggregateFactor,
        dilMode: DIL_MODES.includes(raw.dilMode) ? raw.dilMode : d.dilMode,
        dil: String(raw.dil ?? d.dil),
        volume: String(raw.volume ?? d.volume),
        volumeUnit: VOLUME_UNITS.includes(raw.volumeUnit) ? raw.volumeUnit : d.volumeUnit,
      };
    }
  } catch (e) { /* localStorage puede fallar */ }
  return defaultSettings();
}

function saveSettings(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* cuota/privado */ }
}

function fmtSci(v) {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  return v.toExponential(2).replace('e+', '·10^').replace('e-', '·10^-');
}

/** Lado reescalado manteniendo la proporción, con tope en MAX_SIDE. */
export function scaledSize(width, height, maxSide = MAX_SIDE) {
  const k = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), scale: k };
}

/**
 * Índice de la marca más cercana a un punto, si cae dentro del radio dado.
 * Es lo que permite que un clic encima de una marca la quite en vez de añadir
 * otra justo al lado.
 * @returns {number} -1 si no hay ninguna lo bastante cerca.
 */
export function nearestMark(marks, x, y, radius) {
  let best = -1;
  let bestD = radius * radius;
  (marks || []).forEach((m, i) => {
    const d = (m.x - x) ** 2 + (m.y - y) ** 2;
    if (d <= bestD) { bestD = d; best = i; }
  });
  return best;
}

export function render(container, opts = {}) {
  const s = loadSettings();
  let imageData = null;     // ImageData ya reescalado
  let bitmapCanvas = null;  // canvas con la foto reescalada
  let result = null;        // salida de countColonies
  let roi = null;
  let edits = { removed: [], added: [] };
  let fileName = '';
  let busy = false;

  const root = document.createElement('div');
  container.appendChild(root);

  // ---------- carga de la imagen ----------
  async function useFile(file) {
    if (!file) return;
    fileName = file.name || 'placa';
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (e) {
      paint({ error: t('placa.errorImage') });
      return;
    }
    const { width, height } = scaledSize(bitmap.width, bitmap.height);
    const cv = document.createElement('canvas');
    cv.width = width; cv.height = height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close && bitmap.close();
    bitmapCanvas = cv;
    imageData = ctx.getImageData(0, 0, width, height);
    roi = suggestRoi(toGrayscale(imageData));
    edits = { removed: [], added: [] };
    analyse();
  }

  function analyse() {
    if (!imageData) return;
    busy = true;
    paint();
    // Un tick para que el "analizando…" llegue a pintarse antes de bloquear
    // el hilo con el etiquetado de componentes.
    setTimeout(() => {
      try {
        result = countColonies(imageData, {
          roi,
          polarity: s.polarity,
          sensitivity: s.sensitivity,
          minArea: s.minArea > 0 ? s.minArea : undefined,
          aggregateFactor: s.aggregateFactor,
        });
        roi = result.roi;
      } catch (e) {
        result = null;
        busy = false;
        paint({ error: (e && e.message) || String(e) });
        return;
      }
      busy = false;
      paint();
    }, 20);
  }

  // ---------- recuento y UFC/mL ----------
  function totals() {
    if (!result) return { counted: 0, estimated: 0, manual: 0, total: 0 };
    return applyManualEdits(result, edits);
  }

  function cfu() {
    const n = totals().total;
    const factor = dilutionFactor(s.dilMode, s.dil);
    const vol = volumeInMl(s.volume, s.volumeUnit);
    const value = cfuPerMl(n, vol, factor);
    return { n, factor, vol, value, log10: Number.isFinite(value) && value > 0 ? Math.log10(value) : NaN };
  }

  // ---------- pintado ----------
  function drawOverlay(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!result) return;
    // círculo de la placa
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(roi.cx, roi.cy, roi.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const removed = new Set(edits.removed);
    result.items.forEach((it, i) => {
      const r = Math.max(4, Math.sqrt(it.area / Math.PI));
      ctx.beginPath();
      ctx.arc(it.x, it.y, r + 2, 0, Math.PI * 2);
      if (removed.has(i)) {
        ctx.strokeStyle = 'rgba(148,163,184,0.75)';
        ctx.lineWidth = 1.5;
      } else if (it.merged) {
        ctx.strokeStyle = '#D97706';
        ctx.lineWidth = 2.5;
      } else {
        ctx.strokeStyle = '#22D3EE';
        ctx.lineWidth = 2;
      }
      ctx.stroke();
      // Si el watershed separó el agregado, se dibuja CADA colonia en su sitio:
      // es lo que el usuario necesita ver para dar el recuento por bueno o
      // corregirlo. El contorno ámbar del conjunto se mantiene para que se
      // sepa que esas vienen de una masa dividida, no de objetos aislados.
      if (it.merged && !removed.has(i) && it.parts && it.parts.length) {
        it.parts.forEach((part) => {
          const pr = Math.max(3, Math.sqrt(part.area / Math.PI));
          ctx.beginPath();
          ctx.arc(part.x, part.y, pr, 0, Math.PI * 2);
          ctx.strokeStyle = '#FBBF24';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
      }
      if (it.merged && !removed.has(i)) {
        ctx.fillStyle = '#D97706';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText('×' + it.count, it.x + r + 4, it.y - r);
      }
    });

    edits.added.forEach((m) => {
      ctx.beginPath();
      ctx.arc(m.x, m.y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#34D399';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(m.x - 3, m.y); ctx.lineTo(m.x + 3, m.y);
      ctx.moveTo(m.x, m.y - 3); ctx.lineTo(m.x, m.y + 3);
      ctx.stroke();
    });
  }

  // Convención del repo: div.ql-field con su <label> y la ayuda como
  // <p class="ql-field-help"> (igual que la calculadora de UFC/mL).
  function field(label, help) {
    const wrap = document.createElement('div');
    wrap.className = 'ql-field';
    wrap.innerHTML = '<label>' + escapeHtml(label) + '</label>';
    if (help) wrap.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + escapeHtml(help) + '</p>');
    return wrap;
  }

  function paint(extra = {}) {
    root.innerHTML = '';

    const intro = document.createElement('div');
    intro.className = 'ql-card ql-panel';
    intro.innerHTML =
      '<h2>' + t('placa.title') + '</h2>' +
      '<p class="ql-panel-note">' + t('placa.note') + '</p>' +
      '<p class="ql-field-help">' + t('placa.privacyNote') + '</p>';
    root.appendChild(intro);

    // ---- entrada de imagen ----
    const inCard = document.createElement('div');
    inCard.className = 'ql-card ql-panel';
    inCard.innerHTML = '<h2>' + t('placa.uploadTitle') + '</h2>';

    const fileIn = document.createElement('input');
    fileIn.type = 'file';
    fileIn.accept = 'image/*';
    fileIn.setAttribute('aria-label', t('placa.uploadTitle'));
    fileIn.addEventListener('change', () => { if (fileIn.files && fileIn.files[0]) useFile(fileIn.files[0]); });
    inCard.appendChild(fileIn);

    // En móvil abre directamente la cámara: hacer la foto a la placa y contar
    // en el mismo sitio es justo el caso de uso.
    const camIn = document.createElement('input');
    camIn.type = 'file';
    camIn.accept = 'image/*';
    camIn.setAttribute('capture', 'environment');
    camIn.style.display = 'none';
    camIn.addEventListener('change', () => { if (camIn.files && camIn.files[0]) useFile(camIn.files[0]); });
    const camBtn = document.createElement('button');
    camBtn.type = 'button';
    camBtn.className = 'ql-btn';
    camBtn.style.marginTop = '10px';
    camBtn.textContent = t('placa.takePhoto');
    camBtn.addEventListener('click', () => camIn.click());
    inCard.appendChild(camBtn);
    inCard.appendChild(camIn);

    if (fileName) {
      inCard.insertAdjacentHTML('beforeend',
        '<p class="ql-field-help" style="margin-top:8px;">' + escapeHtml(fileName) +
        (imageData ? ' — ' + imageData.width + '×' + imageData.height + ' px' : '') + '</p>');
    }
    if (extra.error) {
      inCard.insertAdjacentHTML('beforeend',
        '<p class="ql-panel-note" style="color:var(--critical-ink);">' + escapeHtml(extra.error) + '</p>');
    }
    root.appendChild(inCard);

    if (!imageData) return;

    // ---- lienzo + ajustes ----
    const workCard = document.createElement('div');
    workCard.className = 'ql-card ql-panel';
    workCard.innerHTML = '<h2>' + t('placa.plateTitle') + '</h2>' +
      '<p class="ql-field-help">' + t('placa.clickHelp') + '</p>';

    const stack = document.createElement('div');
    stack.className = 'ql-plate-stack';
    stack.style.cssText = 'position:relative;max-width:100%;';
    const shown = document.createElement('canvas');
    shown.width = imageData.width; shown.height = imageData.height;
    shown.style.cssText = 'max-width:100%;height:auto;display:block;border-radius:8px;';
    shown.getContext('2d').drawImage(bitmapCanvas, 0, 0);
    const overlay = document.createElement('canvas');
    overlay.width = imageData.width; overlay.height = imageData.height;
    overlay.style.cssText = 'position:absolute;inset:0;max-width:100%;height:auto;width:100%;cursor:crosshair;';
    stack.appendChild(shown);
    stack.appendChild(overlay);
    workCard.appendChild(stack);
    drawOverlay(overlay);

    overlay.addEventListener('click', (ev) => {
      if (!result) return;
      const rect = overlay.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * overlay.width;
      const y = ((ev.clientY - rect.top) / rect.height) * overlay.height;
      const tol = Math.max(10, (result.medianArea ? Math.sqrt(result.medianArea / Math.PI) : 8) * 1.6);

      // 1) ¿hay una marca manual ahí? → quitarla
      const iMan = nearestMark(edits.added, x, y, tol);
      if (iMan >= 0) { edits.added.splice(iMan, 1); refreshCount(overlay); return; }
      // 2) ¿hay un objeto automático ahí? → alternar descartado
      const iAuto = nearestMark(result.items, x, y, tol);
      if (iAuto >= 0) {
        const k = edits.removed.indexOf(iAuto);
        if (k >= 0) edits.removed.splice(k, 1); else edits.removed.push(iAuto);
        refreshCount(overlay);
        return;
      }
      // 3) sitio vacío → marca nueva
      edits.added.push({ x, y });
      refreshCount(overlay);
    });

    if (busy) {
      workCard.insertAdjacentHTML('beforeend', '<p class="ql-panel-note">' + t('placa.analysing') + '</p>');
    }

    // ajustes de detección
    const ctrls = document.createElement('div');
    ctrls.className = 'ql-plate-controls';

    const polWrap = field(t('placa.polarity'), t('placa.polarityHelp'));
    const polSel = document.createElement('select');
    polSel.className = '';
    [['auto', t('placa.polarityAuto')], ['light', t('placa.polarityLight')], ['dark', t('placa.polarityDark')]]
      .forEach(([v, lbl]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = lbl; o.selected = s.polarity === v;
        polSel.appendChild(o);
      });
    polSel.addEventListener('change', () => { s.polarity = polSel.value; saveSettings(s); analyse(); });
    polWrap.appendChild(polSel);
    ctrls.appendChild(polWrap);

    const sensWrap = field(t('placa.sensitivity'), t('placa.sensitivityHelp'));
    const sens = document.createElement('input');
    sens.type = 'range'; sens.min = '-40'; sens.max = '40'; sens.step = '2';
    sens.value = String(s.sensitivity);
    sens.className = 'ql-range';
    sens.setAttribute('aria-label', t('placa.sensitivity'));
    const sensOut = document.createElement('output');
    sensOut.textContent = String(s.sensitivity);
    sens.addEventListener('input', () => { sensOut.textContent = sens.value; });
    sens.addEventListener('change', () => { s.sensitivity = num(sens.value) || 0; saveSettings(s); analyse(); });
    sensWrap.appendChild(sens); sensWrap.appendChild(sensOut);
    ctrls.appendChild(sensWrap);

    const aggWrap = field(t('placa.aggFactor'), t('placa.aggFactorHelp'));
    const agg = document.createElement('input');
    agg.type = 'number'; agg.min = '1.2'; agg.max = '6'; agg.step = '0.1';
    agg.value = String(s.aggregateFactor);
    agg.className = 'tabular';
    agg.addEventListener('change', () => {
      const v = num(agg.value);
      if (Number.isFinite(v) && v > 1) { s.aggregateFactor = v; saveSettings(s); analyse(); }
    });
    aggWrap.appendChild(agg);
    ctrls.appendChild(aggWrap);

    const minWrap = field(t('placa.minArea'), t('placa.minAreaHelp'));
    const minIn = document.createElement('input');
    minIn.type = 'number'; minIn.min = '0'; minIn.step = '1';
    minIn.value = String(s.minArea);
    minIn.className = 'tabular';
    minIn.addEventListener('change', () => {
      const v = num(minIn.value);
      s.minArea = Number.isFinite(v) && v >= 0 ? v : 0;
      saveSettings(s); analyse();
    });
    minWrap.appendChild(minIn);
    ctrls.appendChild(minWrap);

    // ROI
    const roiWrap = field(t('placa.roiRadius'), t('placa.roiHelp'));
    const roiIn = document.createElement('input');
    roiIn.type = 'range';
    roiIn.min = String(Math.round(Math.min(imageData.width, imageData.height) * 0.1));
    roiIn.max = String(Math.round(Math.min(imageData.width, imageData.height) * 0.5));
    roiIn.step = '2';
    roiIn.value = String(Math.round(roi.radius));
    roiIn.className = 'ql-range';
    roiIn.setAttribute('aria-label', t('placa.roiRadius'));
    roiIn.addEventListener('change', () => {
      roi = { ...roi, radius: num(roiIn.value) };
      edits = { removed: [], added: [] };
      analyse();
    });
    roiWrap.appendChild(roiIn);
    ctrls.appendChild(roiWrap);

    workCard.appendChild(ctrls);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'ql-btn';
    resetBtn.style.marginTop = '10px';
    resetBtn.textContent = t('placa.resetEdits');
    resetBtn.disabled = !edits.added.length && !edits.removed.length;
    resetBtn.addEventListener('click', () => { edits = { removed: [], added: [] }; paint(); });
    workCard.appendChild(resetBtn);

    root.appendChild(workCard);

    // ---- recuento ----
    const cnt = document.createElement('div');
    cnt.className = 'ql-card ql-panel';
    cnt.id = 'ql-plate-count';
    root.appendChild(cnt);
    paintCount(cnt);
  }

  function refreshCount(overlay) {
    drawOverlay(overlay);
    const host = root.querySelector('#ql-plate-count');
    if (host) paintCount(host);
    const reset = root.querySelector('.ql-panel button');
    if (reset) reset.disabled = !edits.added.length && !edits.removed.length;
  }

  function paintCount(host) {
    host.innerHTML = '<h2>' + t('placa.countTitle') + '</h2>';
    const tt = totals();

    const stats = document.createElement('div');
    stats.className = 'ql-stats';
    [
      [t('placa.statCounted'), tt.counted],
      [t('placa.statEstimated'), tt.estimated + (tt.estimatedArea > 0 ? ' (' + tt.estimatedArea + ' ' + t('placa.statByArea') + ')' : '')],
      [t('placa.statManual'), tt.manual],
      [t('placa.statTotal'), tt.total],
    ].forEach(([lbl, val]) => {
      const tile = document.createElement('div');
      tile.className = 'ql-stat';
      tile.innerHTML = '<div class="ql-stat-label">' + lbl + '</div><div class="ql-stat-value">' + val + '</div>';
      stats.appendChild(tile);
    });
    host.appendChild(stats);

    const warn = [];
    if (result && result.lowContrast) warn.push(t('placa.warnLowContrast'));
    if (result && result.confluent) warn.push(t('placa.warnConfluent'));
    if (tt.estimatedWatershed > 0) warn.push(t('placa.warnSplit', { n: tt.estimatedWatershed }));
    if (tt.estimatedArea > 0) warn.push(t('placa.warnAreaEstimate', { n: tt.estimatedArea }));
    const rel = plateReliability(tt.total);
    if (rel === 'low') warn.push(t('placa.warnFewColonies'));
    if (rel === 'high') warn.push(t('placa.warnManyColonies'));
    warn.forEach((w) => {
      host.insertAdjacentHTML('beforeend',
        '<p class="ql-panel-note" style="color:var(--warning-ink);margin:6px 0 0;">' + escapeHtml(w) + '</p>');
    });

    // ---- dilución y volumen ----
    const grid = document.createElement('div');
    grid.className = 'ql-plate-controls';

    const modeWrap = field(t('placa.dilMode'), t('placa.dilModeHelp'));
    const modeSel = document.createElement('select');
    modeSel.className = '';
    [['exp', t('placa.dilExp')], ['factor', t('placa.dilFactor')], ['ratio', t('placa.dilRatio')]]
      .forEach(([v, lbl]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = lbl; o.selected = s.dilMode === v;
        modeSel.appendChild(o);
      });
    modeSel.addEventListener('change', () => { s.dilMode = modeSel.value; saveSettings(s); paintCount(host); });
    modeWrap.appendChild(modeSel);
    grid.appendChild(modeWrap);

    const dilWrap = field(t('placa.dilution'));
    const dilIn = document.createElement('input');
    dilIn.type = 'text'; dilIn.inputMode = 'decimal';
    dilIn.className = 'tabular';
    dilIn.value = s.dil;
    dilIn.addEventListener('input', () => { s.dil = dilIn.value; saveSettings(s); updateOut(host); });
    dilWrap.appendChild(dilIn);
    grid.appendChild(dilWrap);

    const volWrap = field(t('placa.volume'), t('placa.volumeHelp'));
    const volRow = document.createElement('div');
    volRow.style.cssText = 'display:flex;gap:8px;';
    const volIn = document.createElement('input');
    volIn.type = 'text'; volIn.inputMode = 'decimal';
    volIn.className = 'tabular';
    volIn.value = s.volume;
    volIn.addEventListener('input', () => { s.volume = volIn.value; saveSettings(s); updateOut(host); });
    const unitSel = document.createElement('select');
    unitSel.className = '';
    unitSel.setAttribute('aria-label', t('placa.volumeUnit'));
    [['ul', 'µL'], ['ml', 'mL'], ['l', 'L']].forEach(([v, lbl]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = lbl; o.selected = s.volumeUnit === v;
      unitSel.appendChild(o);
    });
    unitSel.addEventListener('change', () => { s.volumeUnit = unitSel.value; saveSettings(s); updateOut(host); });
    volRow.appendChild(volIn); volRow.appendChild(unitSel);
    volWrap.appendChild(volRow);
    grid.appendChild(volWrap);

    host.appendChild(grid);

    const out = document.createElement('div');
    out.className = 'ql-plate-result';
    out.style.cssText = 'margin-top:14px;';
    host.appendChild(out);
    updateOut(host);

    host.insertAdjacentHTML('beforeend',
      '<p class="ql-field-help" style="margin-top:10px;">' + t('placa.formulaHelp') + '</p>');

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'ql-btn ql-btn-primary';
    sendBtn.style.marginTop = '10px';
    sendBtn.textContent = t('placa.sendToRecuentos');
    sendBtn.addEventListener('click', () => {
      const c = cfu();
      if (!Number.isFinite(c.value)) return;
      const fileId = registerFile(fileName || 'placa', 0, t('placa.sendNote'));
      const labelCol = t('placa.colLabel');
      const cfuCol = t('placa.colCfu');
      addMicrobialCountSeries({
        label: t('placa.seriesLabel'),
        sourceFileId: fileId,
        headers: [labelCol, cfuCol],
        rows: [{ [labelCol]: fileName || t('placa.seriesLabel'), [cfuCol]: c.value }],
        mapping: { groupCols: [0], valueCol: 1, dilutionCol: null, alreadyLog: false },
      });
      sendBtn.textContent = t('placa.sentConfirm');
      setTimeout(() => { sendBtn.textContent = t('placa.sendToRecuentos'); }, 2200);
    });
    host.appendChild(sendBtn);
  }

  function updateOut(host) {
    const out = host.querySelector('.ql-plate-result');
    if (!out) return;
    const c = cfu();
    if (!Number.isFinite(c.value)) {
      out.innerHTML = '<p class="ql-panel-note">' + t('placa.resultIncomplete') + '</p>';
      return;
    }
    out.innerHTML =
      '<div class="ql-stat"><div class="ql-stat-label">' + t('placa.resultCfu') + '</div>' +
      '<div class="ql-stat-value">' + escapeHtml(fmtSci(c.value)) + ' ' + t('placa.cfuUnit') + '</div></div>' +
      '<p class="ql-field-help" style="margin-top:6px;">log₁₀ = ' +
      (Number.isFinite(c.log10) ? c.log10.toFixed(3) : '—') + '</p>';
  }

  paint();

  if (opts.onReady) opts.onReady();
  return function cleanup() {
    root.remove();
    imageData = null;
    bitmapCanvas = null;
    result = null;
  };
}
