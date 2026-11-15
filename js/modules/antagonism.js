// #/antagonismo — medición sobre foto de placa.
//
// Dos ensayos que comparten imagen, ROI y calibración pero NO comparten
// geometría:
//
//   - Enfrentamiento (el prioritario): el hongo crece radialmente desde su
//     punto de siembra y el antagonista lo frena por un lado. Se mide cuánto
//     se ha acortado ese radio → PICR.
//   - Difusión: césped uniforme y zona limpia alrededor del pocillo. Se mide
//     el diámetro del halo.
//
// La lógica está en plateMetrology.js y antagonismMetrics.js, testeadas
// aparte. Aquí hay interfaz y nada más.
//
// La imagen no sale del navegador en ningún momento.

import { t } from '../lib/i18n.js';
import {
  mmPerPixel, REFERENCE_OBJECTS, referenceCheck, fitEllipse, perspectiveCheck,
  prepareField, sectorRadius, freestDirection,
} from '../lib/plateMetrology.js';
import { confrontation, halo, formatMm, WARN } from '../lib/antagonismMetrics.js';
import { toDelimitedText } from '../lib/csv.js';
import { suggestRoi, toGrayscale } from '../lib/colonyCount.js';

const STORE_KEY = 'smart-175.antagonismo';
const CANVAS_MAX = 640;

function defaultState() {
  return {
    mode: 'enfrentamiento',
    plateDiameterMm: 90,
    reference: 'well6',
    sensitivity: 0,
    polarity: 'auto',
    sectorHalfDeg: 15,
    plates: [],        // [{name, roi, center, antagonists:[{x,y,label}], isControl, measures}]
    current: 0,
  };
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      // las imágenes no se guardan: pesan demasiado para localStorage
      return { ...defaultState(), ...raw, plates: (raw.plates || []).map((p) => ({ ...p, image: null })) };
    }
  } catch (e) { /* puede venir corrupto */ }
  return defaultState();
}
function save(s) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      ...s, plates: s.plates.map(({ image, ...rest }) => rest),
    }));
  } catch (e) { /* cuota */ }
}

const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;

export function render(container, opts = {}) {
  const s = load();
  let msg = '';
  /** Imágenes decodificadas de esta sesión, por índice de placa. */
  const images = new Map();
  /** Campo preparado de la placa actual (gris corregido + umbral). */
  let field = null;
  let dragging = null;

  const plate = () => s.plates[s.current] || null;
  const image = () => images.get(s.current) || null;

  // --- DOM -----------------------------------------------------------------
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const btn = (label, onClick, cls = '') => {
    const b = el('button', 'ql-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  const field_ = (labelText, inp) => {
    const w = el('label', 'ql-field');
    w.appendChild(el('span', null, labelText));
    w.appendChild(inp);
    return w;
  };
  const num = (value, onChange, aria, extra = {}) => {
    const i = document.createElement('input');
    i.type = 'number';
    i.value = String(value);
    i.className = 'ql-num-small';
    i.setAttribute('aria-label', aria);
    Object.entries(extra).forEach(([k, v]) => { i[k] = v; });
    i.addEventListener('change', () => onChange(Number(i.value)));
    return i;
  };

  function download(text, name) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // --- imagen --------------------------------------------------------------
  function addImage(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, CANVAS_MAX / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
        const idx = s.plates.length;
        const roi = suggestRoi(toGrayscale(data));
        s.plates.push({
          name: file.name || t('antag.plateN', { n: idx + 1 }),
          roi, center: { x: roi.cx, y: roi.cy }, antagonists: [], isControl: false,
        });
        images.set(idx, { canvas: cv, data });
        s.current = idx;
        field = null;
        save(s);
        paint();
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  function ensureField() {
    const im = image();
    const p = plate();
    if (!im || !p) { field = null; return null; }
    if (!field) {
      field = prepareField(im.data, p.roi, {
        sensitivity: s.sensitivity,
        polarity: s.polarity === 'auto' ? undefined : s.polarity,
      });
    }
    return field;
  }

  // --- medición ------------------------------------------------------------
  function measure() {
    const p = plate();
    const f = ensureField();
    if (!p || !f) return null;

    const mmPx = mmPerPixel(s.plateDiameterMm, p.roi.radius);
    const refMm = REFERENCE_OBJECTS[s.reference] ? REFERENCE_OBJECTS[s.reference].mm : 6;
    const half = rad(s.sectorHalfDeg);
    const plateRadiusMm = p.roi.radius * mmPx;

    // ¿sale la placa redonda? se ajusta una elipse al borde detectado
    const edgePts = [];
    for (let k = 0; k < 36; k++) {
      const a = (2 * Math.PI * k) / 36;
      edgePts.push({ x: p.roi.cx + p.roi.radius * Math.cos(a), y: p.roi.cy + p.roi.radius * Math.sin(a) });
    }
    const persp = perspectiveCheck(fitEllipse(edgePts));

    if (s.mode === 'difusion') {
      const rows = p.antagonists.map((a, i) => {
        const skip = (refMm / 2) / mmPx + 3;
        const sec = sectorRadius(f, a.x, a.y, 0, Math.PI,
          { rays: 36, mode: 'onset', skipInner: skip });
        const floored = sec.floored === sec.n && sec.n > 0;
        const d = floored ? 0 : 2 * sec.radiusPx * mmPx;
        const h = halo({ d1Mm: d, d2Mm: d, referenceDiameterMm: refMm });
        return {
          label: a.label || t('antag.sourceN', { n: i + 1 }),
          d1: h.meanMm, d2: h.meanMm, mean: h.meanMm,
          inhibition: h.inhibition, warnings: h.warnings, floored,
        };
      });
      return { mode: 'difusion', rows, mmPx, refMm, persp, plateRadiusMm };
    }

    // enfrentamiento
    const angles = p.antagonists.map((a) => Math.atan2(a.y - p.center.y, a.x - p.center.x));
    const free = freestDirection(angles);
    const freeSec = free
      ? sectorRadius(f, p.center.x, p.center.y, free.angle, Math.min(half, free.halfGap * 0.8),
        { rays: 21, skipInner: 3 })
      : null;
    const control = s.plates.find((x) => x.isControl && x !== p);
    const controlR = control && control.controlRadiusMm;

    const rows = p.antagonists.map((a, i) => {
      const ang = Math.atan2(a.y - p.center.y, a.x - p.center.x);
      const sec = sectorRadius(f, p.center.x, p.center.y, ang, half, { rays: 21, skipInner: 3 });
      const centerToSourceMm = Math.hypot(a.x - p.center.x, a.y - p.center.y) * mmPx;
      const res = confrontation({
        rFacingMm: sec.radiusPx * mmPx,
        rFreeMm: freeSec ? freeSec.radiusPx * mmPx : NaN,
        rControlMm: controlR,
        centerToSourceMm,
        sourceRadiusMm: refMm / 2,
        plateRadiusMm,
        freeCensored: !!(freeSec && freeSec.censored > 0),
        noGrowth: f.lowContrast,
      });
      return {
        label: a.label || t('antag.sourceN', { n: i + 1 }),
        rFacing: sec.radiusPx * mmPx,
        rFree: freeSec ? freeSec.radiusPx * mmPx : NaN,
        ...res,
      };
    });
    return {
      mode: 'enfrentamiento', rows, mmPx, refMm, persp, plateRadiusMm,
      freeAngle: free ? free.angle : null,
      freeRadius: freeSec ? freeSec.radiusPx : NaN,
      lowContrast: f.lowContrast,
    };
  }

  // --- dibujo --------------------------------------------------------------
  function drawOverlay(cv, m) {
    const p = plate();
    const im = image();
    if (!p || !im) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(im.canvas, 0, 0);

    // ROI
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath();
    ctx.arc(p.roi.cx, p.roi.cy, p.roi.radius, 0, 2 * Math.PI);
    ctx.stroke();

    if (s.mode === 'enfrentamiento') {
      // punto de siembra
      ctx.fillStyle = '#00107C';
      ctx.beginPath();
      ctx.arc(p.center.x, p.center.y, 5, 0, 2 * Math.PI);
      ctx.fill();
      // radio libre
      if (m && Number.isFinite(m.freeRadius) && m.freeAngle != null) {
        ctx.strokeStyle = 'rgba(0,200,120,.95)';
        ctx.beginPath();
        ctx.moveTo(p.center.x, p.center.y);
        ctx.lineTo(p.center.x + Math.cos(m.freeAngle) * m.freeRadius,
          p.center.y + Math.sin(m.freeAngle) * m.freeRadius);
        ctx.stroke();
      }
    }

    p.antagonists.forEach((a, i) => {
      const row = m && m.rows[i];
      if (s.mode === 'enfrentamiento' && row && Number.isFinite(row.rFacing) && m.mmPx) {
        const ang = Math.atan2(a.y - p.center.y, a.x - p.center.x);
        const rpx = row.rFacing / m.mmPx;
        ctx.strokeStyle = 'rgba(217,119,6,.95)';
        ctx.beginPath();
        ctx.moveTo(p.center.x, p.center.y);
        ctx.lineTo(p.center.x + Math.cos(ang) * rpx, p.center.y + Math.sin(ang) * rpx);
        ctx.stroke();
      }
      if (s.mode === 'difusion' && row && Number.isFinite(row.mean) && m.mmPx) {
        ctx.strokeStyle = 'rgba(217,119,6,.95)';
        ctx.beginPath();
        ctx.arc(a.x, a.y, (row.mean / 2) / m.mmPx, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.fillStyle = '#D97706';
      ctx.beginPath();
      ctx.arc(a.x, a.y, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), a.x, a.y);
    });
  }

  // --- interacción con el lienzo -------------------------------------------
  function canvasPoint(cv, ev) {
    const r = cv.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * cv.width,
      y: ((ev.clientY - r.top) / r.height) * cv.height,
    };
  }

  function hitTest(pt) {
    const p = plate();
    if (!p) return null;
    if (s.mode === 'enfrentamiento' && Math.hypot(pt.x - p.center.x, pt.y - p.center.y) < 12) {
      return { kind: 'center' };
    }
    for (let i = 0; i < p.antagonists.length; i++) {
      const a = p.antagonists[i];
      if (Math.hypot(pt.x - a.x, pt.y - a.y) < 12) return { kind: 'antagonist', index: i };
    }
    return null;
  }

  // --- secciones -----------------------------------------------------------
  function sectionImage() {
    const sec = el('section', 'ql-card ql-panel');
    sec.appendChild(el('h2', null, t('antag.imageTitle')));
    sec.appendChild(el('p', 'ql-panel-note', t('antag.privacy')));

    const row = el('div', 'ql-inputrow ql-ag-row');
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.className = 'ql-ag-file';
    file.setAttribute('aria-label', t('antag.loadImage'));
    file.addEventListener('change', () => {
      [...file.files].forEach(addImage);
      file.value = '';
    });
    row.appendChild(field_(t('antag.loadImage'), file));

    const mode = document.createElement('select');
    mode.setAttribute('aria-label', t('antag.mode'));
    [['enfrentamiento', t('antag.modeConf')], ['difusion', t('antag.modeDiff')]].forEach(([v, l]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = l;
      mode.appendChild(o);
    });
    mode.value = s.mode;
    mode.addEventListener('change', () => { s.mode = mode.value; save(s); paint(); });
    row.appendChild(field_(t('antag.mode'), mode));
    sec.appendChild(row);

    if (!s.plates.length) {
      sec.appendChild(el('p', 'ql-panel-note', t('antag.emptyHint')));
      return sec;
    }

    const tabs = el('div', 'ql-inputrow ql-ag-row');
    s.plates.forEach((p, i) => {
      const b = btn(p.name + (p.isControl ? ' ·' + t('antag.controlShort') : ''),
        () => { s.current = i; field = null; paint(); },
        i === s.current ? 'ql-btn-primary' : '');
      tabs.appendChild(b);
    });
    sec.appendChild(tabs);
    return sec;
  }

  function sectionCalibration(m) {
    const sec = el('section', 'ql-card ql-panel');
    sec.appendChild(el('h2', null, t('antag.calTitle')));
    const p = plate();

    const row = el('div', 'ql-inputrow ql-ag-row');
    const d = document.createElement('select');
    d.setAttribute('aria-label', t('antag.plateDiameter'));
    [55, 60, 90, 100, 150].forEach((v) => {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = `${v} mm`;
      d.appendChild(o);
    });
    d.value = String(s.plateDiameterMm);
    d.addEventListener('change', () => { s.plateDiameterMm = Number(d.value); save(s); paint(); });
    row.appendChild(field_(t('antag.plateDiameter'), d));

    const ref = document.createElement('select');
    ref.setAttribute('aria-label', t('antag.reference'));
    Object.entries(REFERENCE_OBJECTS).forEach(([k, v]) => {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = `${t('antag.ref_' + k)} (${v.mm} mm)`;
      ref.appendChild(o);
    });
    ref.value = s.reference;
    ref.addEventListener('change', () => { s.reference = ref.value; save(s); paint(); });
    row.appendChild(field_(t('antag.reference'), ref));

    row.appendChild(field_(t('antag.roiRadius'),
      num(Math.round(p.roi.radius), (v) => {
        p.roi.radius = Math.max(10, v);
        field = null;
        save(s);
        paint();
      }, t('antag.roiRadius'), { min: 10 })));
    sec.appendChild(row);

    if (m) {
      sec.appendChild(el('p', 'ql-panel-note',
        t('antag.scale', { mm: (m.mmPx * 1000).toFixed(1) })));
      if (!m.persp.ok) {
        sec.appendChild(el('p', 'ql-panel-note ql-ag-warn',
          t('antag.warnPerspective', { pct: ((1 - m.persp.ratio) * 100).toFixed(1) })));
      }
    }
    sec.appendChild(el('p', 'ql-panel-note', t('antag.photoHint')));
    return sec;
  }

  function sectionCanvas(m) {
    const sec = el('section', 'ql-card ql-panel');
    sec.appendChild(el('h2', null, t('antag.markTitle')));
    sec.appendChild(el('p', 'ql-panel-note',
      s.mode === 'enfrentamiento' ? t('antag.markConf') : t('antag.markDiff')));

    const im = image();
    if (!im) {
      sec.appendChild(el('p', 'ql-panel-note', t('antag.reloadImage')));
      return sec;
    }

    const cv = document.createElement('canvas');
    cv.width = im.canvas.width;
    cv.height = im.canvas.height;
    cv.className = 'ql-ag-canvas';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', t('antag.canvasAria'));
    cv.style.touchAction = 'none';

    cv.addEventListener('pointerdown', (ev) => {
      const pt = canvasPoint(cv, ev);
      const hit = hitTest(pt);
      const p = plate();
      if (hit) {
        dragging = hit;
        try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ignorar */ }
        return;
      }
      if (ev.shiftKey && s.mode === 'enfrentamiento') {
        p.center = pt;
      } else {
        p.antagonists.push({ x: pt.x, y: pt.y, label: '' });
      }
      save(s);
      paint();
    });
    cv.addEventListener('pointermove', (ev) => {
      if (!dragging) return;
      const pt = canvasPoint(cv, ev);
      const p = plate();
      if (dragging.kind === 'center') p.center = pt;
      else Object.assign(p.antagonists[dragging.index], { x: pt.x, y: pt.y });
      drawOverlay(cv, measure());
    });
    const stop = (ev) => {
      if (!dragging) return;
      dragging = null;
      try { cv.releasePointerCapture(ev.pointerId); } catch (e) { /* ignorar */ }
      save(s);
      paint();
    };
    cv.addEventListener('pointerup', stop);
    cv.addEventListener('pointercancel', stop);
    cv.addEventListener('dblclick', (ev) => {
      const hit = hitTest(canvasPoint(cv, ev));
      if (hit && hit.kind === 'antagonist') {
        plate().antagonists.splice(hit.index, 1);
        save(s);
        paint();
      }
    });

    sec.appendChild(cv);
    drawOverlay(cv, m);

    const row = el('div', 'ql-inputrow ql-ag-row');
    const sens = document.createElement('input');
    sens.type = 'range';
    sens.min = '-40';
    sens.max = '40';
    sens.value = String(s.sensitivity);
    sens.setAttribute('aria-label', t('antag.threshold'));
    sens.addEventListener('input', () => {
      s.sensitivity = Number(sens.value);
      field = null;
      drawOverlay(cv, measure());
    });
    sens.addEventListener('change', () => { save(s); paint(); });
    row.appendChild(field_(t('antag.threshold'), sens));
    row.appendChild(field_(t('antag.sector'),
      num(s.sectorHalfDeg, (v) => { s.sectorHalfDeg = Math.max(2, v); save(s); paint(); },
        t('antag.sector'), { min: 2, max: 90 })));
    row.appendChild(btn(t('antag.clearMarks'), () => {
      plate().antagonists = [];
      save(s);
      paint();
    }));
    sec.appendChild(row);
    sec.appendChild(el('p', 'ql-panel-note', t('antag.thresholdNote')));

    if (s.mode === 'enfrentamiento') {
      const ctrl = el('label', 'ql-checkrow');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'ag-control';
      cb.checked = !!plate().isControl;
      cb.setAttribute('aria-label', t('antag.asControl'));
      cb.addEventListener('change', () => {
        const p = plate();
        p.isControl = cb.checked;
        if (cb.checked && m) {
          const f = ensureField();
          const sec2 = sectorRadius(f, p.center.x, p.center.y, 0, Math.PI, { rays: 36, skipInner: 3 });
          p.controlRadiusMm = sec2.radiusPx * m.mmPx;
        }
        save(s);
        paint();
      });
      ctrl.appendChild(cb);
      ctrl.appendChild(el('span', null, t('antag.asControl')));
      sec.appendChild(ctrl);
    }
    return sec;
  }

  function sectionResults(m) {
    const sec = el('section', 'ql-card ql-panel');
    sec.appendChild(el('h2', null, t('antag.resultsTitle')));
    if (!m || !m.rows.length) {
      sec.appendChild(el('p', 'ql-panel-note', t('antag.noMarks')));
      return sec;
    }

    const headers = s.mode === 'enfrentamiento'
      ? [t('antag.colSource'), t('antag.colRFacing'), t('antag.colRFree'),
        t('antag.colGap'), 'PICR (%)', t('antag.colNotes')]
      : [t('antag.colSource'), t('antag.colDiameter'), t('antag.colNotes')];

    const scroll = el('div', 'ql-table-scroll scroll-x');
    const tb = el('table', 'ql-table');
    const thead = el('thead');
    const htr = el('tr');
    headers.forEach((h) => htr.appendChild(el('th', null, h)));
    thead.appendChild(htr);
    tb.appendChild(thead);
    const body = el('tbody');

    const noteOf = (r) => (r.warnings || []).map((w) => {
      switch (w) {
        case WARN.EDGE_CENSORED: return t('antag.wEdge');
        case WARN.REACHED_SOURCE: return t('antag.wReached');
        case WARN.CONTROL_ASYMMETRIC: return t('antag.wAsym');
        case WARN.NO_GROWTH: return t('antag.wNoGrowth');
        case WARN.GROWTH_STIMULATED: return t('antag.wStimulated');
        case WARN.PICR_DISCREPANCY: return t('antag.wDiscrepancy');
        case WARN.NO_INHIBITION: return t('antag.wNoInhibition');
        default: return w;
      }
    }).join(' · ');

    m.rows.forEach((r) => {
      const tr = el('tr');
      if (s.mode === 'enfrentamiento' && !r.measurable) tr.classList.add('ql-ufc-bad');
      if (s.mode === 'difusion' && !r.inhibition) tr.classList.add('ql-ufc-bad');
      const cells = s.mode === 'enfrentamiento'
        ? [r.label, formatMm(r.rFacing) ?? '—', formatMm(r.rFree) ?? '—',
          formatMm(r.gapMm) ?? '—',
          (r.measurable && Number.isFinite(r.picrPreferred)) ? r.picrPreferred.toFixed(1) : '—',
          noteOf(r)]
        : [r.label, r.inhibition ? `${formatMm(r.mean)} mm` : t('antag.noHalo'), noteOf(r)];
      cells.forEach((cth) => tr.appendChild(el('td', null, String(cth))));
      body.appendChild(tr);
    });
    tb.appendChild(body);
    scroll.appendChild(tb);
    sec.appendChild(scroll);

    if (s.mode === 'enfrentamiento') {
      const hasControl = s.plates.some((p) => p.isControl);
      sec.appendChild(el('p', 'ql-panel-note',
        hasControl ? t('antag.usingControl') : t('antag.usingSamePlate')));
    }
    sec.appendChild(el('p', 'ql-panel-note', t('antag.noBreakpoints')));

    sec.appendChild(btn(t('antag.exportCsv'), () => {
      const hs = s.mode === 'enfrentamiento'
        ? ['placa', 'fuente', 'r_enfrentado_mm', 'r_libre_mm', 'hueco_mm', 'picr', 'avisos']
        : ['placa', 'fuente', 'diametro_mm', 'avisos'];
      const rows = m.rows.map((r) => (s.mode === 'enfrentamiento' ? {
        placa: plate().name, fuente: r.label,
        r_enfrentado_mm: formatMm(r.rFacing), r_libre_mm: formatMm(r.rFree),
        hueco_mm: formatMm(r.gapMm),
        picr: Number.isFinite(r.picrPreferred) ? r.picrPreferred.toFixed(2) : '',
        avisos: (r.warnings || []).join(' '),
      } : {
        placa: plate().name, fuente: r.label,
        diametro_mm: r.inhibition ? formatMm(r.mean) : '',
        avisos: (r.warnings || []).join(' '),
      }));
      download(toDelimitedText(hs, rows, ','), 'antagonismo.csv');
    }, 'ql-btn-primary'));
    return sec;
  }

  // --- pintado -------------------------------------------------------------
  function paint() {
    container.innerHTML = '';
    if (!opts.embedded) {
      const header = el('header', 'ql-page-header');
      header.appendChild(el('p', 'ql-eyebrow', t('antag.eyebrow')));
      header.appendChild(el('h1', 'ql-page-title', t('antag.title')));
      header.appendChild(el('p', 'ql-page-sub', t('antag.subtitle')));
      container.appendChild(header);
    }
    if (msg) {
      const m2 = el('p', 'ql-panel-note', msg);
      m2.setAttribute('role', 'status');
      container.appendChild(m2);
      msg = '';
    }
    container.appendChild(sectionImage());
    if (plate()) {
      const m = measure();
      container.appendChild(sectionCalibration(m));
      container.appendChild(sectionCanvas(m));
      container.appendChild(sectionResults(m));
    }
  }

  injectStyle();
  paint();
  return () => { save(s); images.clear(); };
}

const STYLE_ID = 'ql-ag-style';
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
.ql-ag-row{flex-wrap:wrap;gap:10px;margin:8px 0;align-items:flex-end}
.ql-ag-canvas{max-width:100%;height:auto;border:1px solid var(--line,#ccc);border-radius:6px;cursor:crosshair;display:block}
.ql-ag-warn{color:var(--warn-ink,#8a5a00);font-weight:600}
.ql-ag-file{font-size:13px}
`;
  document.head.appendChild(st);
}
