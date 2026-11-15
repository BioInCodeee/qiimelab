// #/qpcr — análisis de una tanda de qPCR.
//
// Módulo autónomo: la tabla del termociclador no sale del navegador. La lógica
// vive en js/lib/qpcrData.js (lectura y control de calidad) y
// js/lib/qpcrQuant.js (curvas, eficiencia, ΔΔCt, Pfaffl, absoluta), las dos
// testeadas aparte contra una tanda real.
//
// El orden de la página no es decorativo: datos → CONTROL DE CALIDAD →
// cuantificación. Una media de triplicados que difieren en cuatro ciclos no es
// un dato, y un ΔΔCt calculado sobre ella tampoco, así que la sección de
// cuantificación está cerrada hasta que el usuario marca que ha mirado los
// avisos. No se le impide seguir; se le impide seguir sin haber mirado.

import { t } from '../lib/i18n.js';
import { parseTable, toDelimitedText } from '../lib/csv.js';
import { readRun, qcReport, QC, QC_DEFAULTS } from '../lib/qpcrData.js';
import {
  standardCurve, relativeExpression, absoluteQuantity, geneCopies,
  decimalSeries, QUANT_WARN,
} from '../lib/qpcrQuant.js';

const STORE_KEY = 'smart-175.qpcr';

/**
 * Tanda de ejemplo. Los valores de Cq son de una tanda real, con los nombres
 * genericizados; sirve para ver el módulo funcionando sin tener datos a mano,
 * y a propósito trae problemas de verdad (un pocillo sin amplificar, 16S muy
 * tempranos y ningún control sin molde para 16S) para que el control de
 * calidad tenga algo que enseñar.
 */
const EXAMPLE = [
  'Well,Target,Content,Sample,Cq',
  'A01,16S,Unkn,CAL,11.5912136023691',
  'A02,16S,Unkn,CAL,11.5678875659939',
  'A03,16S,Unkn,CAL,11.5873977206921',
  'A04,DIANA,Unkn,CAL,30.8220233355963',
  'A05,DIANA,Unkn,CAL,31.1514198352284',
  'A06,DIANA,Unkn,CAL,31.0177459348954',
  'C01,16S,Unkn,M4,27.0661930695187',
  'C02,16S,Unkn,M4,26.7074104333356',
  'C03,16S,Unkn,M4,26.4316609683506',
  'C04,DIANA,Unkn,M4,31.7720344884711',
  'C05,DIANA,Unkn,M4,31.6364498331699',
  'C06,DIANA,Unkn,M4,32.2047855063527',
  'E01,16S,Unkn,T0,22.307112241749',
  'E02,16S,Unkn,T0,21.6611535568359',
  'E03,16S,Unkn,T0,21.606595961934',
  'E04,DIANA,Unkn,T0,25.3545666575658',
  'E05,DIANA,Unkn,T0,25.7164564646609',
  'E06,DIANA,Unkn,T0,25.6650569677473',
  'G04,DIANA,Unkn,M5,28.4',
  'G05,DIANA,Unkn,M5,',
  'G06,DIANA,Unkn,M5,28.9',
  'G01,16S,Unkn,M5,20.1',
  'G02,16S,Unkn,M5,20.3',
  'G03,16S,Unkn,M5,20.2',
  'H12,DIANA,Neg Ctrl,,',
].join('\n');
const MAX_STORED = 400000; // no guardar tandas enormes en localStorage

function defaultState() {
  return {
    raw: '',
    cfg: { target: '', reference: '', calibrator: '' },
    curves: {},            // { diana: [{quantity, cq}] }
    thresholds: { ...QC_DEFAULTS },
    qcReviewed: false,
    copies: { ng: 1.25, bp: 150 },
  };
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && typeof raw === 'object') return { ...defaultState(), ...raw };
  } catch (e) { /* puede venir corrupto */ }
  return defaultState();
}

function save(s) {
  try {
    const copy = { ...s, raw: s.raw.length > MAX_STORED ? '' : s.raw };
    localStorage.setItem(STORE_KEY, JSON.stringify(copy));
  } catch (e) { /* cuota llena */ }
}

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
/** Los cambios de expresión abarcan órdenes de magnitud: notación adaptativa. */
const fmtFold = (v) => {
  if (!Number.isFinite(v)) return '—';
  if (v !== 0 && (Math.abs(v) >= 1000 || Math.abs(v) < 0.01)) return v.toExponential(2);
  return v.toFixed(3);
};

export function render(container, opts = {}) {
  const s = load();
  let msg = '';

  // --- derivados -----------------------------------------------------------
  function parsed() {
    if (!s.raw.trim()) return null;
    const table = parseTable(s.raw);
    if (!table.headers.length) return null;
    const run = readRun(table);
    if (run.missing.length) return { run, qc: null, error: run.missing };
    return { run, qc: qcReport(run.wells, s.thresholds), error: null };
  }

  function curveFor(target) {
    const pts = (s.curves[target] || []).filter(
      (p) => Number(p.quantity) > 0 && Number.isFinite(Number(p.cq)),
    );
    return pts.length >= 2 ? standardCurve(pts) : null;
  }

  function efficiencies() {
    const ct = curveFor(s.cfg.target);
    const cr = curveFor(s.cfg.reference);
    return (ct && cr && Number.isFinite(ct.efficiency) && Number.isFinite(cr.efficiency))
      ? { target: ct.efficiency, reference: cr.efficiency } : null;
  }

  // --- utilidades de DOM ---------------------------------------------------
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
  const field = (labelText, input) => {
    const w = el('label', 'ql-field');
    w.appendChild(el('span', null, labelText));
    w.appendChild(input);
    return w;
  };
  const select = (value, options, onChange, aria) => {
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', aria);
    options.forEach((o) => {
      const op = document.createElement('option');
      op.value = o;
      op.textContent = o || '—';
      sel.appendChild(op);
    });
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  };
  const table = (headers, rows) => {
    const scroll = el('div', 'ql-table-scroll scroll-x');
    const tb = el('table', 'ql-table');
    tb.innerHTML = '<thead><tr>' + headers.map((h) => '<th></th>').join('') + '</tr></thead>';
    [...tb.querySelectorAll('th')].forEach((th, i) => { th.textContent = headers[i]; });
    const body = el('tbody');
    rows.forEach((r) => {
      const tr = el('tr');
      if (r.bad) tr.classList.add('ql-ufc-bad');
      (r.cells || r).forEach((c) => {
        const td = el('td');
        if (c && typeof c === 'object') {
          td.textContent = c.text;
          if (c.cls) td.className = c.cls;
        } else td.textContent = c;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    tb.appendChild(body);
    scroll.appendChild(tb);
    return scroll;
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

  // --- secciones -----------------------------------------------------------
  function sectionData() {
    const sec = el('section', 'ql-card ql-panel');
    sec.appendChild(el('h2', null, t('qpcr.dataTitle')));
    sec.appendChild(el('p', 'ql-panel-note', t('qpcr.dataNote')));

    const ta = document.createElement('textarea');
    ta.rows = 6;
    ta.className = 'ql-qpcr-paste';
    ta.placeholder = t('qpcr.pastePlaceholder');
    ta.setAttribute('aria-label', t('qpcr.pasteAria'));
    ta.value = s.raw;
    ta.addEventListener('change', () => { s.raw = ta.value; s.qcReviewed = false; save(s); paint(); });
    sec.appendChild(ta);

    const row = el('div', 'ql-inputrow ql-qpcr-row');
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.csv,.tsv,.txt';
    file.style.display = 'none';
    file.addEventListener('change', () => {
      const f = file.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { s.raw = String(r.result || ''); s.qcReviewed = false; save(s); paint(); };
      r.readAsText(f);
    });
    row.appendChild(btn(t('qpcr.loadFile'), () => file.click()));
    row.appendChild(file);
    row.appendChild(btn(t('qpcr.loadExample'), () => {
      s.raw = EXAMPLE;
      s.cfg = { target: 'DIANA', reference: '16S', calibrator: 'T0' };
      s.qcReviewed = false;
      save(s);
      msg = t('qpcr.exampleLoaded');
      paint();
    }));
    row.appendChild(btn(t('qpcr.clearData'), () => {
      s.raw = ''; s.qcReviewed = false; save(s); paint();
    }));
    sec.appendChild(row);
    if (!s.raw.trim()) sec.appendChild(el('p', 'ql-panel-note', t('qpcr.emptyHint')));
    return sec;
  }

  function sectionQc(p) {
    const sec = el('section', 'ql-card ql-panel');
    sec.appendChild(el('h2', null, t('qpcr.qcTitle')));

    if (p.error) {
      sec.appendChild(el('p', 'ql-panel-note', t('qpcr.missingColumns', { cols: p.error.join(', ') })));
      return sec;
    }

    const { qc } = p;
    sec.appendChild(el('p', 'ql-panel-note', t('qpcr.qcNote')));

    // umbrales
    const thr = el('div', 'ql-inputrow ql-qpcr-row');
    const num = (key, label, step) => {
      const i = document.createElement('input');
      i.type = 'number';
      i.step = step;
      i.className = 'ql-num-small';
      i.value = String(s.thresholds[key]);
      i.setAttribute('aria-label', label);
      i.addEventListener('change', () => {
        s.thresholds[key] = Number(i.value);
        save(s);
        paint();
      });
      return field(label, i);
    };
    thr.appendChild(num('maxSd', t('qpcr.thrSd'), '0.1'));
    thr.appendChild(num('minCq', t('qpcr.thrMinCq'), '1'));
    thr.appendChild(num('maxCq', t('qpcr.thrMaxCq'), '1'));
    sec.appendChild(thr);

    // resumen por grupo
    const rows = qc.groups.map((g) => {
      const bad = (g.n >= 2 && g.sd > s.thresholds.maxSd) || g.undetermined > 0 || g.n < 2;
      return {
        bad,
        cells: [
          g.sample, g.target, String(g.n),
          g.undetermined ? String(g.undetermined) : '',
          fmt(g.mean, 2), fmt(g.sd, 2),
        ],
      };
    });
    sec.appendChild(table(
      [t('qpcr.colSample'), t('qpcr.colTarget'), t('qpcr.colN'),
        t('qpcr.colUndet'), t('qpcr.colMean'), t('qpcr.colSd')],
      rows,
    ));

    // avisos
    if (qc.issues.length) {
      const ul = el('ul', 'ql-qpcr-issues');
      qc.issues.forEach((i) => {
        const li = el('li');
        const where = i.sample ? `${i.sample} · ${i.target}` : (i.target || '');
        let text;
        switch (i.code) {
          case QC.HIGH_SD:
            text = t('qpcr.issHighSd', { where, sd: fmt(i.sd, 2) });
            if (i.outlier) {
              text += ' ' + t('qpcr.issOutlier', {
                well: i.outlier.well, cq: fmt(i.outlier.cq, 2), sd: fmt(i.sdWithout, 2),
              });
            }
            break;
          case QC.UNDETERMINED: text = t('qpcr.issUndet', { where, n: i.n, of: i.of }); break;
          case QC.MOSTLY_UNDETERMINED: text = t('qpcr.issMostly', { where }); break;
          case QC.SINGLE_REPLICATE: text = t('qpcr.issSingle', { where }); break;
          case QC.NO_NTC: text = t('qpcr.issNoNtc', { where }); break;
          case QC.NTC_AMPLIFIED: text = t('qpcr.issNtcAmp', { where }); break;
          case QC.EARLY_CQ: text = t('qpcr.issEarly', { where, cq: fmt(i.cq, 2) }); break;
          case QC.LATE_CQ: text = t('qpcr.issLate', { where, cq: fmt(i.cq, 2) }); break;
          default: text = i.code + ' ' + where;
        }
        li.textContent = text;
        ul.appendChild(li);
      });
      sec.appendChild(ul);
    } else {
      sec.appendChild(el('p', 'ql-panel-note', t('qpcr.qcClean')));
    }

    const gate = el('label', 'ql-checkrow');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = s.qcReviewed;
    cb.id = 'qpcr-gate';
    cb.setAttribute('aria-label', t('qpcr.gate'));
    cb.addEventListener('change', () => { s.qcReviewed = cb.checked; save(s); paint(); });
    gate.appendChild(cb);
    gate.appendChild(el('span', null, t('qpcr.gate')));
    sec.appendChild(gate);

    return sec;
  }

  function sectionCurves(p) {
    const sec = el('section', 'ql-card ql-panel');
    sec.appendChild(el('h2', null, t('qpcr.curveTitle')));
    sec.appendChild(el('p', 'ql-panel-note', t('qpcr.curveNote')));

    // calculadora de copias
    const calc = el('div', 'ql-inputrow ql-qpcr-row');
    const mk = (key, label, step) => {
      const i = document.createElement('input');
      i.type = 'number';
      i.step = step;
      i.className = 'ql-num-small';
      i.value = String(s.copies[key]);
      i.setAttribute('aria-label', label);
      i.addEventListener('change', () => { s.copies[key] = Number(i.value); save(s); paint(); });
      return field(label, i);
    };
    calc.appendChild(mk('ng', t('qpcr.ngPerUl'), '0.01'));
    calc.appendChild(mk('bp', t('qpcr.ampliconBp'), '1'));
    const copies = geneCopies(s.copies.ng, s.copies.bp);
    const out = el('output', 'ql-stat-value',
      Number.isFinite(copies) ? copies.toExponential(4) + ' ' + t('qpcr.copiesPerUl') : '—');
    calc.appendChild(field(t('qpcr.copies'), out));
    sec.appendChild(calc);
    if (Number.isFinite(copies)) {
      sec.appendChild(el('p', 'ql-panel-note',
        t('qpcr.seriesHint', {
          list: decimalSeries(copies, 6).map((v) => v.toExponential(1)).join(' · '),
        })));
    }

    const targets = p && p.qc ? p.qc.targets : [];
    targets.forEach((target) => {
      const box = el('div', 'ql-qpcr-curve');
      box.appendChild(el('h3', null, target));
      const pts = s.curves[target] || [];
      const ta = document.createElement('textarea');
      ta.rows = 3;
      ta.placeholder = t('qpcr.curvePlaceholder');
      ta.setAttribute('aria-label', t('qpcr.curveAria', { target }));
      ta.value = pts.map((x) => `${x.quantity}\t${x.cq}`).join('\n');
      ta.addEventListener('change', () => {
        s.curves[target] = ta.value.split('\n').map((line) => {
          const [q, c] = line.split(/[\t;,]+/).map((x) => Number(String(x).trim().replace(',', '.')));
          return { quantity: q, cq: c };
        }).filter((x) => Number.isFinite(x.quantity) && Number.isFinite(x.cq));
        save(s);
        paint();
      });
      box.appendChild(ta);

      const fit = curveFor(target);
      if (fit) {
        const info = el('p', 'ql-panel-note', t('qpcr.curveFit', {
          slope: fmt(fit.slope, 4), r2: fmt(fit.r2, 4),
          eff: fmt(fit.efficiencyPct, 1), n: fit.n,
        }));
        box.appendChild(info);
        fit.warnings.forEach((w) => {
          const key = w === QUANT_WARN.EFFICIENCY_OUT ? 'qpcr.warnEff'
            : w === QUANT_WARN.LOW_R2 ? 'qpcr.warnR2' : 'qpcr.warnFewPoints';
          box.appendChild(el('p', 'ql-panel-note ql-qpcr-warn', t(key)));
        });
      }
      sec.appendChild(box);
    });

    return sec;
  }

  function sectionQuant(p) {
    const sec = el('section', 'ql-card ql-panel');
    sec.appendChild(el('h2', null, t('qpcr.quantTitle')));

    if (!s.qcReviewed) {
      sec.appendChild(el('p', 'ql-panel-note ql-qpcr-warn', t('qpcr.gateBlocked')));
      return sec;
    }

    const targets = p.qc.targets;
    const samples = [...new Set(p.qc.groups.map((g) => g.sample))].filter(Boolean);
    const row = el('div', 'ql-inputrow ql-qpcr-row');
    row.appendChild(field(t('qpcr.selTarget'), select(s.cfg.target, ['', ...targets],
      (v) => { s.cfg.target = v; save(s); paint(); }, t('qpcr.selTarget'))));
    row.appendChild(field(t('qpcr.selReference'), select(s.cfg.reference, ['', ...targets],
      (v) => { s.cfg.reference = v; save(s); paint(); }, t('qpcr.selReference'))));
    row.appendChild(field(t('qpcr.selCalibrator'), select(s.cfg.calibrator, ['', ...samples],
      (v) => { s.cfg.calibrator = v; save(s); paint(); }, t('qpcr.selCalibrator'))));
    sec.appendChild(row);

    if (!s.cfg.target || !s.cfg.reference || !s.cfg.calibrator) {
      sec.appendChild(el('p', 'ql-panel-note', t('qpcr.pickAll')));
      return sec;
    }
    if (s.cfg.target === s.cfg.reference) {
      sec.appendChild(el('p', 'ql-panel-note ql-qpcr-warn', t('qpcr.sameTarget')));
      return sec;
    }

    const eff = efficiencies();
    const res = relativeExpression(p.qc.groups, { ...s.cfg, efficiency: eff || undefined });

    // el calibrador, siempre a la vista
    sec.appendChild(el('p', 'ql-panel-note', t('qpcr.calibratorIs', {
      sample: res.calibrator,
      method: res.method === 'pfaffl' ? t('qpcr.methodPfaffl') : t('qpcr.methodLivak'),
    })));
    if (!eff) sec.appendChild(el('p', 'ql-panel-note ql-qpcr-warn', t('qpcr.warnAssumed')));

    const headers = [t('qpcr.colSample'), 'ΔCt', 'SD', 'ΔΔCt', t('qpcr.colFold'), t('qpcr.colRange')];
    if (eff) headers.push(t('qpcr.colPfaffl'));
    const rows = res.rows.map((r) => {
      const cells = [
        r.sample, fmt(r.dct, 3), fmt(r.dctSd, 3), fmt(r.ddct, 3),
        fmtFold(r.fold),
        (Number.isFinite(r.foldLow) ? `${fmtFold(r.foldLow)} – ${fmtFold(r.foldHigh)}` : '—'),
      ];
      if (eff) cells.push(fmtFold(r.ratioPfaffl));
      return {
        bad: !r.usable || (r.warnings || []).includes(QUANT_WARN.CALIBRATOR_MATRIX),
        cells,
      };
    });
    sec.appendChild(table(headers, rows));

    if (res.warnings.includes(QUANT_WARN.CALIBRATOR_MATRIX)) {
      sec.appendChild(el('p', 'ql-panel-note ql-qpcr-warn', t('qpcr.warnMatrix')));
    }

    // cuantificación absoluta, si hay curva de la diana
    const curve = curveFor(s.cfg.target);
    if (curve) {
      const abs = p.qc.groups
        .filter((g) => g.target === s.cfg.target && g.n)
        .map((g) => [g.sample, fmt(g.mean, 2),
          (() => { const q = absoluteQuantity(g.mean, curve); return q == null ? '—' : q.toExponential(3); })()]);
      sec.appendChild(el('h3', null, t('qpcr.absTitle')));
      sec.appendChild(table([t('qpcr.colSample'), t('qpcr.colMean'), t('qpcr.colCopies')], abs));
    }

    sec.appendChild(btn(t('qpcr.exportCsv'), () => {
      const hs = ['sample', 'cqTarget', 'sdTarget', 'cqReference', 'sdReference',
        'dct', 'dctSd', 'ddct', 'ddctSd', 'fold', 'foldLow', 'foldHigh',
        'ratioPfaffl', 'method', 'calibrator'];
      const out = res.rows.map((r) => ({ ...r, calibrator: res.calibrator }));
      download(toDelimitedText(hs, out, ','), 'qpcr-resultados.csv');
    }, 'ql-btn-primary'));

    return sec;
  }

  // --- pintado -------------------------------------------------------------
  function paint() {
    container.innerHTML = '';
    if (!opts.embedded) {
      const header = el('header', 'ql-page-header');
      header.innerHTML = '<p class="ql-eyebrow"></p><h1 class="ql-page-title"></h1><p class="ql-page-sub"></p>';
      header.querySelector('.ql-eyebrow').textContent = t('qpcr.eyebrow');
      header.querySelector('.ql-page-title').textContent = t('qpcr.title');
      header.querySelector('.ql-page-sub').textContent = t('qpcr.subtitle');
      container.appendChild(header);
    }
    if (msg) {
      const m = el('p', 'ql-panel-note', msg);
      m.setAttribute('role', 'status');
      container.appendChild(m);
      msg = '';
    }

    container.appendChild(sectionData());
    const p = parsed();
    if (p) {
      container.appendChild(sectionQc(p));
      if (!p.error) {
        container.appendChild(sectionCurves(p));
        container.appendChild(sectionQuant(p));
      }
    }
  }

  injectStyle();
  paint();
  return () => { save(s); };
}

const STYLE_ID = 'ql-qpcr-style';
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
.ql-qpcr-paste{width:100%;font:12px/1.4 var(--font-mono,ui-monospace,monospace)}
.ql-qpcr-row{flex-wrap:wrap;gap:10px;margin:8px 0}
.ql-qpcr-issues{margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.5}
.ql-qpcr-issues li{margin:2px 0}
.ql-qpcr-warn{color:var(--warn-ink,#8a5a00);font-weight:600}
.ql-qpcr-curve{margin:10px 0;padding:8px 0;border-top:1px solid var(--border,#ddd)}
.ql-qpcr-curve textarea{width:100%;font:12px/1.4 var(--font-mono,ui-monospace,monospace)}
`;
  document.head.appendChild(st);
}
