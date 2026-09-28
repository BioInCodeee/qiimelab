// Calculadora de UFC/mL (recuento en placa). Utilidad autocontenida: no lee ni
// escribe el estado de la app, no sube nada, solo aritmética en el navegador.
//
//   UFC/mL = colonias contadas / (volumen sembrado en mL × factor de dilución)
//
// Varias réplicas/diluciones a la vez → promedia (media aritmética, media de
// log10 ± SD, y media geométrica = 10^media(log10)). El log10 es lo que se usa
// para comparar y para las barras de #/recuentos.

import { t } from '../lib/i18n.js';
import { mean, stdDev, standardError } from '../lib/stats.js';
import { registerFile, addMicrobialCountSeries } from '../state.js';

const STORE_KEY = 'smart-175.ufcCalc';
const LEGACY_STORE_KEY = 'qiimelab.ufcCalc';

// modo de dilución: cómo interpreta el usuario el número de cada fila
//   exp    -> 10^(-n)            (n = 3  →  10⁻³)
//   factor -> el número tal cual (0.001)
//   ratio  -> 1 : X             (X = 1000  →  1/1000)
const DIL_MODES = ['exp', 'factor', 'ratio'];

function num(v) {
  const s = String(v == null ? '' : v).trim().replace(',', '.');
  if (s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function dilutionFactor(mode, raw) {
  const v = num(raw);
  if (!Number.isFinite(v)) return NaN;
  if (mode === 'exp') return Math.pow(10, -Math.abs(v));
  if (mode === 'ratio') return v > 0 ? 1 / v : NaN;
  return v > 0 ? v : NaN; // factor directo
}

function defaultState() {
  return {
    volume: 0.1,            // mL sembrados por placa
    dilMode: 'exp',
    rows: [
      { label: '', colonies: '', dil: '3' },
      { label: '', colonies: '', dil: '3' },
      { label: '', colonies: '', dil: '3' },
    ],
  };
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_STORE_KEY) || 'null');
    if (raw && Array.isArray(raw.rows) && raw.rows.length) {
      return {
        volume: Number.isFinite(+raw.volume) && +raw.volume > 0 ? +raw.volume : 0.1,
        dilMode: DIL_MODES.includes(raw.dilMode) ? raw.dilMode : 'exp',
        rows: raw.rows.map((r) => ({ label: String(r.label || ''), colonies: String(r.colonies ?? ''), dil: String(r.dil ?? '') })),
      };
    }
  } catch (e) { /* localStorage puede fallar */ }
  return defaultState();
}
function save(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* noop */ }
}

function fmtSci(v) {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const exp = Math.floor(Math.log10(Math.abs(v)));
  if (exp >= 3 || exp < -2) {
    const mant = v / Math.pow(10, exp);
    return mant.toFixed(2) + ' × 10' + supExp(exp);
  }
  return v.toFixed(v < 10 ? 2 : 0);
}
function supExp(n) {
  const map = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  return String(n).split('').map((c) => map[c] || c).join('');
}

/**
 * @param {HTMLElement} container
 * @param {{ embedded?: boolean }} [opts]  embedded: dentro de la pestaña
 *        "Calculadora UFC/mL" de #/recuentos — sin cabecera de página propia
 */
export function render(container, opts = {}) {
  let s = load();

  function computeRows() {
    return s.rows.map((r) => {
      const N = num(r.colonies);
      const d = dilutionFactor(s.dilMode, r.dil);
      const V = Number.isFinite(+s.volume) && +s.volume > 0 ? +s.volume : NaN;
      const ok = Number.isFinite(N) && N > 0 && Number.isFinite(d) && Number.isFinite(V);
      const cfu = ok ? N / (V * d) : NaN;
      return { ...r, N, d, cfu, log10: ok ? Math.log10(cfu) : NaN, ok, hasInput: Number.isFinite(N) };
    });
  }

  function paint() {
    container.innerHTML = '';
    save(s);

    if (!opts.embedded) {
      const header = document.createElement('header');
      header.className = 'ql-page-header';
      header.innerHTML =
        '<p class="ql-eyebrow">' + t('ufc.eyebrow') + '</p>' +
        '<h1 class="ql-page-title">' + t('ufc.title') + '</h1>' +
        '<p class="ql-page-sub">' + t('ufc.subtitle') + '</p>';
      container.appendChild(header);
    }

    const grid = document.createElement('div');
    grid.className = 'ql-grid-2';

    // ---- panel principal: filas ----
    const main = document.createElement('section');
    main.className = 'ql-card ql-panel';
    main.innerHTML = '<h2>' + t('ufc.rowsTitle') + '</h2><p class="ql-panel-note">' + t('ufc.formula') + '</p>';

    const rows = computeRows();

    const scroll = document.createElement('div');
    scroll.className = 'ql-table-scroll scroll-x';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table ql-ufc-table';
    const dilHead = s.dilMode === 'exp' ? t('ufc.colDilExp')
      : s.dilMode === 'ratio' ? t('ufc.colDilRatio') : t('ufc.colDilFactor');
    tbl.innerHTML = '<thead><tr>' +
      ['#', t('ufc.colLabel'), t('ufc.colColonies'), dilHead, t('ufc.colCfu'), t('ufc.colLog'), ''].map((h) => '<th>' + h + '</th>').join('') +
      '</tr></thead>';
    const tb = document.createElement('tbody');

    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.hasInput && !r.ok) tr.classList.add('ql-ufc-bad');

      const mkInput = (val, key, opts = {}) => {
        const inp = document.createElement('input');
        inp.type = opts.type || 'text';
        inp.value = val;
        inp.className = 'ql-ufc-in' + (opts.num ? ' tabular' : '');
        if (opts.ph) inp.placeholder = opts.ph;
        if (opts.aria) inp.setAttribute('aria-label', opts.aria + ' — ' + t('ufc.rowN', { n: i + 1 }));
        inp.addEventListener('input', () => { s.rows[i][key] = inp.value; recalc(); });
        inp.addEventListener('change', () => { s.rows[i][key] = inp.value; paint(); });
        return inp;
      };

      const cells = [
        String(i + 1),
        mkInput(r.label, 'label', { ph: t('ufc.labelPh'), aria: t('ufc.colLabel') }),
        mkInput(r.colonies, 'colonies', { num: true, ph: '0', aria: t('ufc.colColonies'), type: 'text' }),
        mkInput(r.dil, 'dil', { num: true, ph: s.dilMode === 'exp' ? '3' : s.dilMode === 'ratio' ? '1000' : '0.001', aria: dilHead }),
      ];
      cells.forEach((c) => {
        const td = document.createElement('td');
        if (typeof c === 'string') td.textContent = c; else td.appendChild(c);
        tr.appendChild(td);
      });

      const tdCfu = document.createElement('td');
      tdCfu.className = 'ql-num tabular ql-ufc-out';
      tdCfu.textContent = r.ok ? fmtSci(r.cfu) : (r.hasInput ? t('ufc.invalid') : '—');
      tr.appendChild(tdCfu);

      const tdLog = document.createElement('td');
      tdLog.className = 'ql-num tabular ql-ufc-out';
      tdLog.textContent = r.ok ? r.log10.toFixed(3) : '—';
      tr.appendChild(tdLog);

      const tdRm = document.createElement('td');
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'ql-cmp-rm';
      rm.textContent = '✕'; rm.title = t('ui.remove');
      rm.setAttribute('aria-label', t('ui.remove') + ' — ' + t('ufc.rowN', { n: i + 1 }));
      rm.disabled = s.rows.length <= 1;
      rm.addEventListener('click', () => { s.rows.splice(i, 1); paint(); });
      tdRm.appendChild(rm);
      tr.appendChild(tdRm);

      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    scroll.appendChild(tbl);
    main.appendChild(scroll);

    const addRow = document.createElement('button');
    addRow.type = 'button';
    addRow.className = 'ql-btn';
    addRow.style.marginTop = '12px';
    addRow.textContent = t('ufc.addRow');
    addRow.addEventListener('click', () => {
      const last = s.rows[s.rows.length - 1] || { dil: '' };
      s.rows.push({ label: '', colonies: '', dil: last.dil || '' });
      paint();
    });
    main.appendChild(addRow);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'ql-btn';
    clearBtn.style.cssText = 'margin-top:12px;margin-left:8px;';
    clearBtn.textContent = t('ufc.clear');
    clearBtn.addEventListener('click', () => { s = defaultState(); paint(); });
    main.appendChild(clearBtn);

    grid.appendChild(main);

    // ---- panel de controles ----
    const ctrl = document.createElement('aside');
    ctrl.className = 'ql-card ql-panel';
    ctrl.innerHTML = '<h2>' + t('ui.controls') + '</h2>';

    const volF = document.createElement('div');
    volF.className = 'ql-field';
    volF.innerHTML = '<label for="ufc-vol">' + t('ufc.volLabel') + '</label>';
    const volIn = document.createElement('input');
    volIn.type = 'text'; volIn.id = 'ufc-vol'; volIn.className = 'tabular';
    volIn.value = String(s.volume);
    volIn.addEventListener('input', () => { const v = num(volIn.value); if (Number.isFinite(v) && v > 0) { s.volume = v; recalc(); } });
    volIn.addEventListener('change', () => paint());
    volF.appendChild(volIn);
    volF.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('ufc.volHelp') + '</p>');
    ctrl.appendChild(volF);

    const dilF = document.createElement('div');
    dilF.className = 'ql-field';
    dilF.innerHTML = '<label>' + t('ufc.dilModeLabel') + '</label>';
    const seg = document.createElement('div');
    seg.className = 'ql-segmented';
    DIL_MODES.forEach((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-seg-btn' + (s.dilMode === m ? ' is-on' : '');
      b.textContent = t('ufc.dilMode_' + m);
      b.addEventListener('click', () => { if (s.dilMode !== m) { s.dilMode = m; paint(); } });
      seg.appendChild(b);
    });
    dilF.appendChild(seg);
    dilF.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('ufc.dilModeHelp') + '</p>');
    ctrl.appendChild(dilF);

    const link = document.createElement('p');
    link.className = 'ql-field-help';
    link.style.marginTop = '14px';
    link.innerHTML = t('ufc.recuentosNote') + ' <a href="#/recuentos">' + t(opts.embedded ? 'recuentos.sectionData' : 'nav.recuentos') + '</a>.';
    ctrl.appendChild(link);

    grid.appendChild(ctrl);
    container.appendChild(grid);

    // ---- resultado ----
    const usable = rows.filter((r) => r.ok);
    const resCard = document.createElement('section');
    resCard.className = 'ql-card ql-panel';
    resCard.style.marginTop = '20px';
    resCard.innerHTML = '<h2>' + t('ufc.resultTitle') + '</h2>';

    if (usable.length === 0) {
      resCard.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('ufc.noRows') + '</p>');
      container.appendChild(resCard);
      return;
    }

    const logs = usable.map((r) => r.log10);
    const cfus = usable.map((r) => r.cfu);
    const meanLog = mean(logs);
    const sd = stdDev(logs);
    const se = standardError(logs);
    const geoMean = Math.pow(10, meanLog);
    const arithMean = mean(cfus);

    const stats = document.createElement('div');
    stats.className = 'ql-stats';
    [
      [t('ufc.statN'), String(usable.length)],
      [t('ufc.statGeoMean'), fmtSci(geoMean) + ' UFC/mL'],
      [t('ufc.statMeanLog'), meanLog.toFixed(3)],
      [t('ufc.statSd'), usable.length >= 2 ? sd.toFixed(3) : '—'],
      [t('ufc.statSe'), usable.length >= 2 ? se.toFixed(3) : '—'],
      [t('ufc.statArithMean'), fmtSci(arithMean) + ' UFC/mL'],
    ].forEach(([lbl, val]) => {
      const tile = document.createElement('div');
      tile.className = 'ql-stat';
      tile.innerHTML = '<div class="ql-stat-label">' + lbl + '</div><div class="ql-stat-value" style="font-size:15px;">' + val + '</div>';
      stats.appendChild(tile);
    });
    resCard.appendChild(stats);

    const excluded = rows.filter((r) => r.hasInput && !r.ok).length;
    if (excluded > 0) {
      resCard.insertAdjacentHTML('beforeend',
        '<p class="ql-field-help" style="margin-top:10px;">' + t('ufc.excluded', { n: excluded }) + '</p>');
    }
    resCard.insertAdjacentHTML('beforeend',
      '<p class="ql-field-help" style="margin-top:6px;font-style:italic;">' + t('ufc.geoNote') + '</p>');

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'ql-btn';
    copyBtn.style.marginTop = '12px';
    copyBtn.textContent = t('ufc.copy');
    copyBtn.addEventListener('click', () => {
      const lines = [
        t('ufc.copyHeader'),
        ...usable.map((r) => (r.label || t('ufc.rowN', { n: rows.indexOf(r) + 1 })) + '\t' + r.cfu.toExponential(3) + '\t' + r.log10.toFixed(4)),
        '',
        t('ufc.statGeoMean') + '\t' + geoMean.toExponential(3),
        t('ufc.statMeanLog') + '\t' + meanLog.toFixed(4) + (usable.length >= 2 ? ' ± ' + sd.toFixed(4) + ' (SD)' : ''),
      ].join('\n');
      try {
        navigator.clipboard.writeText(lines);
        copyBtn.textContent = t('ufc.copied');
        setTimeout(() => { copyBtn.textContent = t('ufc.copy'); }, 1600);
      } catch (e) { /* clipboard puede fallar */ }
    });
    resCard.appendChild(copyBtn);

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'ql-btn';
    sendBtn.style.cssText = 'margin-top:12px;margin-left:8px;';
    sendBtn.textContent = t('ufc.sendToRecuentos');
    sendBtn.addEventListener('click', () => {
      const fileId = registerFile('calculadora-ufc.mL', 0, t('ufc.sendToRecuentosNote'));
      addMicrobialCountSeries({
        label: t('ufc.recuentosSeriesLabel'),
        sourceFileId: fileId,
        headers: [t('ufc.colLabel'), t('ufc.colCfu')],
        rows: usable.map((r) => ({
          [t('ufc.colLabel')]: r.label || t('ufc.rowN', { n: rows.indexOf(r) + 1 }),
          [t('ufc.colCfu')]: r.cfu,
        })),
        mapping: { groupCols: [0], valueCol: 1, dilutionCol: null, alreadyLog: false },
      });
      sendBtn.textContent = t('ufc.sentConfirm');
      setTimeout(() => { sendBtn.textContent = t('ufc.sendToRecuentos'); }, 2200);
    });
    resCard.appendChild(sendBtn);
    resCard.insertAdjacentHTML('beforeend', '<p class="ql-field-help" style="margin-top:8px;">' + t('ufc.sendToRecuentosHelp') + '</p>');

    container.appendChild(resCard);
  }

  // recálculo ligero sin repintar todo (mientras se teclea): actualiza solo las
  // celdas de salida y deja el resto del DOM/foco intacto.
  function recalc() {
    save(s);
    const rows = computeRows();
    const trs = container.querySelectorAll('.ql-ufc-table tbody tr');
    rows.forEach((r, i) => {
      const tr = trs[i];
      if (!tr) return;
      const outs = tr.querySelectorAll('.ql-ufc-out');
      if (outs[0]) outs[0].textContent = r.ok ? fmtSci(r.cfu) : (r.hasInput ? t('ufc.invalid') : '—');
      if (outs[1]) outs[1].textContent = r.ok ? r.log10.toFixed(3) : '—';
      tr.classList.toggle('ql-ufc-bad', r.hasInput && !r.ok);
    });
  }

  paint();
  return () => { save(s); };
}
