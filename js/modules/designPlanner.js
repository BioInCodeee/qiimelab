// #/diseno — calculador de ensayos.
//
// Declaras factores, niveles y réplicas, y sale cuántas unidades hay que
// montar, cuánto medio preparar de cada tipo, en qué botellas, cómo
// etiquetarlo y en qué orden colocarlo.
//
// Módulo autónomo: la lógica está en designExpand.js, mediaPlan.js,
// labelScheme.js, assayPlan.js y designMetadata.js, todas testeadas aparte.
// Aquí solo hay interfaz.
//
// Al guardar, el diseño deja en localStorage las etiquetas y el orden
// aleatorizado para que #/mapa-placa pueda repartirlo por la placa sin que el
// usuario teclee nada dos veces. Esa es la razón de que este módulo vaya antes
// que el resto del flujo.

import { t } from '../lib/i18n.js';
import { expandDesign, blockPlan, DESIGN_WARN } from '../lib/designExpand.js';
import {
  planMedia, suggestFlask, aerationCheck, packBottles,
  PLATE_AGAR_VOLUME, MEDIA_WARN,
} from '../lib/mediaPlan.js';
import {
  buildLabels, defaultTemplate, availableTokens, randomizeOrder, randomSeed,
} from '../lib/labelScheme.js';
import { buildMetadata, metadataText, METADATA_WARN } from '../lib/designMetadata.js';
import {
  VARIABLE_KIND, DEFAULT_COUNT_PLAN, platingBurden, countMediaLayers,
  buildDirectSheet, buildCountSheet, ASSAY_WARN,
} from '../lib/assayPlan.js';
import { toDelimitedText } from '../lib/csv.js';

const STORE_KEY = 'smart-175.diseno';

function defaultState() {
  return {
    factors: [
      { name: 'Tratamiento', levels: 'Control, T1, T2' },
      { name: 'Tiempo', levels: 'Inicial, Final' },
    ],
    bio: 3,
    tech: 1,
    timepoints: '',
    destructive: true,
    capacity: 0,
    unitType: 'matraz',
    volumePerUnit: 50,
    layers: [{ medium: 'LB', volume: 50 }],
    excess: 10,
    container: '',
    template: '',
    abbrev: {},
    seed: 0,
    variables: [],
  };
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && Array.isArray(raw.factors)) return { ...defaultState(), ...raw };
  } catch (e) { /* puede venir corrupto */ }
  return defaultState();
}

const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const fmtVol = (ml) => (ml >= 1000 ? `${(ml / 1000).toFixed(2)} L` : `${ml.toFixed(0)} mL`);

export function render(container, opts = {}) {
  const s = load();
  let msg = '';

  // --- derivados -----------------------------------------------------------
  function parseFactors() {
    return s.factors
      .filter((f) => String(f.name).trim() !== '')
      .map((f) => ({
        name: f.name.trim(),
        levels: String(f.levels).split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean),
      }));
  }

  function compute() {
    const times = String(s.timepoints).split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
    const exp = expandDesign({
      factors: parseFactors(),
      biologicalReplicates: s.bio,
      technicalReplicates: s.tech,
      timepoints: times,
      destructiveSampling: s.destructive,
    });
    const template = s.template || defaultTemplate(exp.effectiveFactors, times.length > 0);
    const { labels, duplicates, unique } = buildLabels(exp.units, template, { abbrev: s.abbrev });
    const seed = s.seed || 0;
    const rnd = seed ? randomizeOrder(exp.units, seed) : null;
    const bp = blockPlan(exp.unitCount, s.capacity);

    const layers = s.layers.filter((l) => String(l.medium).trim() && Number(l.volume) > 0);
    const unitLayers = exp.units.map(() => layers.map((l) => ({ ...l })));
    const burden = platingBurden(exp, s.variables);
    const plan = planMedia(
      [...unitLayers, ...countMediaLayers(burden)],
      { excessFraction: s.excess / 100 },
    );

    const meta = buildMetadata(exp, {
      labels,
      order: rnd ? rnd.order : null,
      unitType: s.unitType,
      unitLayers,
      container: s.container || (s.unitType === 'matraz'
        ? `Erlenmeyer ${suggestFlask(s.volumePerUnit) || '?'} mL` : ''),
      blockPlan: bp,
    });

    return { exp, template, labels, duplicates, unique, rnd, bp, plan, burden, meta, times };
  }

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
  const field = (labelText, input) => {
    const w = el('label', 'ql-field');
    w.appendChild(el('span', null, labelText));
    w.appendChild(input);
    return w;
  };
  const input = (type, value, onChange, aria, extra = {}) => {
    const i = document.createElement('input');
    i.type = type;
    i.value = String(value ?? '');
    i.setAttribute('aria-label', aria);
    Object.entries(extra).forEach(([k, v]) => { i[k] = v; });
    i.addEventListener('change', () => { onChange(type === 'number' ? Number(i.value) : i.value); });
    return i;
  };
  const table = (headers, rows) => {
    const scroll = el('div', 'ql-table-scroll scroll-x');
    const tb = el('table', 'ql-table');
    const thead = el('thead');
    const htr = el('tr');
    headers.forEach((h) => htr.appendChild(el('th', null, h)));
    thead.appendChild(htr);
    tb.appendChild(thead);
    const body = el('tbody');
    rows.forEach((r) => {
      const tr = el('tr');
      const cells = Array.isArray(r) ? r : r.cells;
      if (!Array.isArray(r) && r.bad) tr.classList.add('ql-ufc-bad');
      cells.forEach((c) => tr.appendChild(el('td', null, String(c))));
      body.appendChild(tr);
    });
    tb.appendChild(body);
    scroll.appendChild(tb);
    return scroll;
  };
  function download(text, name, mime = 'text/csv;charset=utf-8') {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const save = () => {
    try {
      const c = compute();
      localStorage.setItem(STORE_KEY, JSON.stringify({
        ...s,
        labels: c.labels,
        order: c.rnd ? c.rnd.order : c.exp.units.map((u) => u.index),
      }));
    } catch (e) { /* cuota llena */ }
  };
  const touch = () => { save(); paint(); };

  // --- secciones -----------------------------------------------------------
  function sectionFactors() {
    const sec = el('section', 'ql-card ql-panel');
    sec.appendChild(el('h2', null, t('diseno.factorsTitle')));
    sec.appendChild(el('p', 'ql-panel-note', t('diseno.factorsNote')));

    s.factors.forEach((f, i) => {
      const row = el('div', 'ql-inputrow ql-ds-row');
      row.appendChild(field(t('diseno.factorName'),
        input('text', f.name, (v) => { s.factors[i].name = v; touch(); }, t('diseno.factorName'))));
      row.appendChild(field(t('diseno.factorLevels'),
        input('text', f.levels, (v) => { s.factors[i].levels = v; touch(); }, t('diseno.factorLevels'))));
      row.appendChild(btn('×', () => { s.factors.splice(i, 1); touch(); }));
      sec.appendChild(row);
    });
    sec.appendChild(btn(t('diseno.addFactor'),
      () => { s.factors.push({ name: '', levels: '' }); touch(); }));
    return sec;
  }

  function sectionReplicates() {
    const sec = el('section', 'ql-card ql-panel');
    sec.appendChild(el('h2', null, t('diseno.repsTitle')));
    sec.appendChild(el('p', 'ql-panel-note', t('diseno.repsNote')));

    const row = el('div', 'ql-inputrow ql-ds-row');
    row.appendChild(field(t('diseno.bio'),
      input('number', s.bio, (v) => { s.bio = v; touch(); }, t('diseno.bio'), { min: 1, className: 'ql-num-small' })));
    row.appendChild(field(t('diseno.tech'),
      input('number', s.tech, (v) => { s.tech = v; touch(); }, t('diseno.tech'), { min: 1, className: 'ql-num-small' })));
    row.appendChild(field(t('diseno.capacity'),
      input('number', s.capacity, (v) => { s.capacity = v; touch(); }, t('diseno.capacity'), { min: 0, className: 'ql-num-small' })));
    sec.appendChild(row);

    const row2 = el('div', 'ql-inputrow ql-ds-row');
    row2.appendChild(field(t('diseno.timepoints'),
      input('text', s.timepoints, (v) => { s.timepoints = v; touch(); }, t('diseno.timepoints'))));
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = s.destructive;
    cb.id = 'ds-destructive';
    cb.setAttribute('aria-label', t('diseno.destructive'));
    cb.addEventListener('change', () => { s.destructive = cb.checked; touch(); });
    const lab = el('label', 'ql-checkrow');
    lab.appendChild(cb);
    lab.appendChild(el('span', null, t('diseno.destructive')));
    row2.appendChild(lab);
    sec.appendChild(row2);
    sec.appendChild(el('p', 'ql-panel-note', t('diseno.destructiveNote')));
    return sec;
  }

  function sectionUnit() {
    const sec = el('section', 'ql-card ql-panel');
    sec.appendChild(el('h2', null, t('diseno.unitTitle')));

    const row = el('div', 'ql-inputrow ql-ds-row');
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', t('diseno.unitType'));
    ['matraz', 'tubo', 'placa', 'pocillo', 'bolsa', 'botella'].forEach((v) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t('diseno.unit_' + v);
      sel.appendChild(o);
    });
    sel.value = s.unitType;
    sel.addEventListener('change', () => { s.unitType = sel.value; touch(); });
    row.appendChild(field(t('diseno.unitType'), sel));
    row.appendChild(field(t('diseno.volumePerUnit'),
      input('number', s.volumePerUnit, (v) => { s.volumePerUnit = v; touch(); },
        t('diseno.volumePerUnit'), { min: 0, step: '0.1', className: 'ql-num-small' })));
    row.appendChild(field(t('diseno.excess'),
      input('number', s.excess, (v) => { s.excess = v; touch(); },
        t('diseno.excess'), { min: 0, className: 'ql-num-small' })));
    sec.appendChild(row);

    if (s.unitType === 'matraz') {
      const flask = suggestFlask(s.volumePerUnit);
      const aer = flask ? aerationCheck(s.volumePerUnit, flask) : null;
      sec.appendChild(el('p', 'ql-panel-note', flask
        ? t('diseno.flaskHint', { v: s.volumePerUnit, n: flask, pct: fmt((aer.fraction) * 100, 0) })
        : t('diseno.flaskNone')));
    }
    if (s.unitType === 'placa') {
      sec.appendChild(el('p', 'ql-panel-note', t('diseno.plateHint', {
        list: Object.entries(PLATE_AGAR_VOLUME).map(([d, v]) => `${d} mm ≈ ${v} mL`).join(' · '),
      })));
    }

    sec.appendChild(el('h3', null, t('diseno.layersTitle')));
    sec.appendChild(el('p', 'ql-panel-note', t('diseno.layersNote')));
    s.layers.forEach((l, i) => {
      const r = el('div', 'ql-inputrow ql-ds-row');
      r.appendChild(field(t('diseno.medium'),
        input('text', l.medium, (v) => { s.layers[i].medium = v; touch(); }, t('diseno.medium'))));
      r.appendChild(field(t('diseno.layerVolume'),
        input('number', l.volume, (v) => { s.layers[i].volume = v; touch(); },
          t('diseno.layerVolume'), { min: 0, step: '0.1', className: 'ql-num-small' })));
      r.appendChild(btn('×', () => { s.layers.splice(i, 1); touch(); }));
      sec.appendChild(r);
    });
    sec.appendChild(btn(t('diseno.addLayer'),
      () => { s.layers.push({ medium: '', volume: s.volumePerUnit }); touch(); }));
    return sec;
  }

  function sectionVariables() {
    const sec = el('section', 'ql-card ql-panel');
    sec.appendChild(el('h2', null, t('diseno.varsTitle')));
    sec.appendChild(el('p', 'ql-panel-note', t('diseno.varsNote')));

    s.variables.forEach((v, i) => {
      const r = el('div', 'ql-inputrow ql-ds-row');
      r.appendChild(field(t('diseno.varName'),
        input('text', v.name, (x) => { s.variables[i].name = x; touch(); }, t('diseno.varName'))));
      const kind = document.createElement('select');
      kind.setAttribute('aria-label', t('diseno.varKind'));
      [[VARIABLE_KIND.DIRECT, t('diseno.kindDirect')], [VARIABLE_KIND.COUNT, t('diseno.kindCount')]]
        .forEach(([val, label]) => {
          const o = document.createElement('option');
          o.value = val;
          o.textContent = label;
          kind.appendChild(o);
        });
      kind.value = v.kind;
      kind.addEventListener('change', () => { s.variables[i].kind = kind.value; touch(); });
      r.appendChild(field(t('diseno.varKind'), kind));
      if (v.kind === VARIABLE_KIND.DIRECT) {
        r.appendChild(field(t('diseno.varUnit'),
          input('text', v.unit || '', (x) => { s.variables[i].unit = x; touch(); }, t('diseno.varUnit'))));
      } else {
        r.appendChild(field(t('diseno.varMedium'),
          input('text', v.medium || '', (x) => { s.variables[i].medium = x; touch(); }, t('diseno.varMedium'))));
        r.appendChild(field(t('diseno.varDil'),
          input('number', v.dilutions ?? DEFAULT_COUNT_PLAN.dilutions,
            (x) => { s.variables[i].dilutions = x; touch(); }, t('diseno.varDil'),
            { min: 1, className: 'ql-num-small' })));
        r.appendChild(field(t('diseno.varPlates'),
          input('number', v.platesPerDilution ?? DEFAULT_COUNT_PLAN.platesPerDilution,
            (x) => { s.variables[i].platesPerDilution = x; touch(); }, t('diseno.varPlates'),
            { min: 1, className: 'ql-num-small' })));
      }
      r.appendChild(btn('×', () => { s.variables.splice(i, 1); touch(); }));
      sec.appendChild(r);
    });
    const add = el('div', 'ql-inputrow ql-ds-row');
    add.appendChild(btn(t('diseno.addDirect'), () => {
      s.variables.push({ name: '', kind: VARIABLE_KIND.DIRECT, unit: '' });
      touch();
    }));
    add.appendChild(btn(t('diseno.addCount'), () => {
      s.variables.push({ name: '', kind: VARIABLE_KIND.COUNT, medium: '', ...DEFAULT_COUNT_PLAN });
      touch();
    }));
    sec.appendChild(add);
    return sec;
  }

  function sectionResults(c) {
    const sec = el('section', 'ql-card ql-panel');
    sec.appendChild(el('h2', null, t('diseno.resultsTitle')));

    if (!c.exp.unitCount) {
      sec.appendChild(el('p', 'ql-panel-note', t('diseno.emptyHint')));
      return sec;
    }

    // el número, y de dónde sale
    const big = el('p', 'ql-stat-value', t('diseno.unitsN', { n: c.exp.unitCount }));
    sec.appendChild(big);
    sec.appendChild(el('p', 'ql-panel-note', t('diseno.breakdown', {
      parts: c.exp.breakdown.map((b) => `${b.count} ${
        b.label === 'biological' ? t('diseno.bioShort')
          : b.label === 'timepoints' ? t('diseno.timeShort') : b.label}`).join(' × '),
    })));
    if (c.exp.measurementCount !== c.exp.unitCount) {
      sec.appendChild(el('p', 'ql-panel-note',
        t('diseno.measurements', { n: c.exp.measurementCount })));
    }

    // avisos de diseño
    const warn = [];
    const W = {
      [DESIGN_WARN.FEW_BIOLOGICAL]: 'diseno.wFewBio',
      [DESIGN_WARN.PSEUDOREPLICATION]: 'diseno.wPseudo',
      [DESIGN_WARN.SINGLE_LEVEL]: 'diseno.wSingleLevel',
      [DESIGN_WARN.NO_FACTORS]: 'diseno.wNoFactors',
      [DESIGN_WARN.REPEATED_MEASURES]: 'diseno.wRepeated',
    };
    c.exp.warnings.forEach((w) => { if (W[w]) warn.push(t(W[w])); });
    if (c.exp.ignoredFactors.length) {
      warn.push(t('diseno.wIgnored', { list: c.exp.ignoredFactors.join(', ') }));
    }
    if (c.bp && !c.bp.fits) warn.push(t('diseno.wBlocks', { n: c.bp.blocks, per: c.bp.perBlock }));
    if (!c.unique) warn.push(t('diseno.wDuplicates', { n: c.duplicates.length }));
    c.burden.warnings.forEach((w) => {
      if (w === ASSAY_WARN.HEAVY_PLATING) warn.push(t('diseno.wHeavyPlating', { n: c.burden.totalPlates }));
      if (w === ASSAY_WARN.MISSING_MEDIUM) warn.push(t('diseno.wNoMedium'));
    });
    if (warn.length) {
      const ul = el('ul', 'ql-ds-warn');
      warn.forEach((x) => ul.appendChild(el('li', null, x)));
      sec.appendChild(ul);
    }

    // siembra de los recuentos
    if (c.burden.perVariable.length) {
      sec.appendChild(el('h3', null, t('diseno.plattingTitle')));
      sec.appendChild(table(
        [t('diseno.colVar'), t('diseno.colMedium'), t('diseno.colPerSample'), t('diseno.colPlates')],
        c.burden.perVariable.map((v) => [v.name, v.medium || '—',
          `${v.dilutions} × ${v.platesPerDilution} = ${v.platesPerOccasion}`, v.totalPlates]),
      ));
    }

    // medios y botellas
    if (c.plan.length) {
      sec.appendChild(el('h3', null, t('diseno.mediaTitle')));
      sec.appendChild(table(
        [t('diseno.colMedium'), t('diseno.colBase'), t('diseno.colTotal'), t('diseno.colBottles')],
        c.plan.map((m) => {
          const b = packBottles(m.totalVolume);
          return [m.medium, fmtVol(m.baseVolume), fmtVol(m.totalVolume),
            b.bottles.map((x) => `${x.fill.toFixed(0)}/${x.size}`).join(' + ') || '—'];
        }),
      ));
      sec.appendChild(el('p', 'ql-panel-note', t('diseno.bottleNote')));
    }
    return sec;
  }

  function sectionLabels(c) {
    const sec = el('section', 'ql-card ql-panel');
    sec.appendChild(el('h2', null, t('diseno.labelsTitle')));
    if (!c.exp.unitCount) return sec;

    const row = el('div', 'ql-inputrow ql-ds-row');
    row.appendChild(field(t('diseno.template'),
      input('text', s.template || c.template, (v) => { s.template = v; touch(); }, t('diseno.template'))));
    row.appendChild(field(t('diseno.seed'),
      input('number', s.seed, (v) => { s.seed = v; touch(); }, t('diseno.seed'),
        { min: 0, className: 'ql-num-small' })));
    row.appendChild(btn(t('diseno.newSeed'), () => { s.seed = randomSeed(); touch(); }));
    sec.appendChild(row);
    sec.appendChild(el('p', 'ql-panel-note',
      t('diseno.tokens', { list: availableTokens(c.exp.effectiveFactors, c.times.length > 0).join(' ') })));
    sec.appendChild(el('p', 'ql-panel-note', s.seed
      ? t('diseno.seedOn', { seed: s.seed }) : t('diseno.seedOff')));

    const preview = c.labels.slice(0, 8).join(' · ') + (c.labels.length > 8 ? ' …' : '');
    sec.appendChild(el('p', 'ql-panel-note ql-ds-preview', preview));

    const actions = el('div', 'ql-inputrow ql-ds-row');
    actions.appendChild(btn(t('diseno.exportLabels'), () => {
      download(toDelimitedText(['etiqueta'], c.labels.map((l) => ({ etiqueta: l })), ','),
        'etiquetas.csv');
    }));
    actions.appendChild(btn(t('diseno.printLabels'), () => window.print()));
    sec.appendChild(actions);
    return sec;
  }

  function sectionExport(c) {
    const sec = el('section', 'ql-card ql-panel');
    sec.appendChild(el('h2', null, t('diseno.exportTitle')));
    sec.appendChild(el('p', 'ql-panel-note', t('diseno.exportNote')));
    if (!c.exp.unitCount) return sec;

    if (c.meta.warnings.includes(METADATA_WARN.DUPLICATE_IDS)) {
      sec.appendChild(el('p', 'ql-panel-note ql-ds-warntext', t('diseno.wDupIds')));
    }

    const actions = el('div', 'ql-inputrow ql-ds-row');
    actions.appendChild(btn(t('diseno.exportMeta'),
      () => download(metadataText(c.meta), 'metadatos.tsv', 'text/tab-separated-values;charset=utf-8'),
      'ql-btn-primary'));

    const direct = s.variables.filter((v) => v.kind === VARIABLE_KIND.DIRECT);
    if (direct.length) {
      actions.appendChild(btn(t('diseno.exportDirect'), () => {
        const sheet = buildDirectSheet(c.meta, s.variables);
        download(toDelimitedText(sheet.headers, sheet.rows, ','), 'hoja-datos.csv');
      }));
    }
    const counts = s.variables.filter((v) => v.kind === VARIABLE_KIND.COUNT);
    if (counts.length) {
      actions.appendChild(btn(t('diseno.exportCounts'), () => {
        const sheet = buildCountSheet(c.meta, s.variables, { dilutionExponents: [-3, -4, -5] });
        download(toDelimitedText(sheet.headers, sheet.rows, ','), 'hoja-siembra.csv');
      }));
    }
    sec.appendChild(actions);

    sec.appendChild(el('h3', null, t('diseno.previewTitle')));
    sec.appendChild(table(c.meta.headers,
      c.meta.rows.slice(0, 6).map((r) => c.meta.headers.map((h) => r[h] ?? ''))));
    if (c.meta.rows.length > 6) {
      sec.appendChild(el('p', 'ql-panel-note', t('diseno.andMore', { n: c.meta.rows.length - 6 })));
    }
    sec.appendChild(el('p', 'ql-panel-note', t('diseno.plateLink')));
    return sec;
  }

  // --- pintado -------------------------------------------------------------
  function paint() {
    container.innerHTML = '';
    if (!opts.embedded) {
      const header = el('header', 'ql-page-header');
      header.appendChild(el('p', 'ql-eyebrow', t('diseno.eyebrow')));
      header.appendChild(el('h1', 'ql-page-title', t('diseno.title')));
      header.appendChild(el('p', 'ql-page-sub', t('diseno.subtitle')));
      container.appendChild(header);
    }
    if (msg) {
      const m = el('p', 'ql-panel-note', msg);
      m.setAttribute('role', 'status');
      container.appendChild(m);
      msg = '';
    }
    const c = compute();
    container.appendChild(sectionFactors());
    container.appendChild(sectionReplicates());
    container.appendChild(sectionUnit());
    container.appendChild(sectionVariables());
    container.appendChild(sectionResults(c));
    container.appendChild(sectionLabels(c));
    container.appendChild(sectionExport(c));
  }

  injectStyle();
  save();
  paint();
  return () => { save(); };
}

const STYLE_ID = 'ql-ds-style';
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
.ql-ds-row{flex-wrap:wrap;gap:10px;margin:6px 0;align-items:flex-end}
.ql-ds-warn{margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.5}
.ql-ds-warn li{margin:2px 0}
.ql-ds-warntext{color:var(--warn-ink,#8a5a00);font-weight:600}
.ql-ds-preview{font-family:var(--font-mono,ui-monospace,monospace);font-size:12px;word-break:break-all}
`;
  document.head.appendChild(st);
}
