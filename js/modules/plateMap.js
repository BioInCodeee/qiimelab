// #/mapa-placa — editor de mapas de microplaca.
//
// Módulo autónomo: no lee ni escribe el estado de la app, persiste solo en su
// propio localStorage. La lógica de rejilla, relleno y conversión a tabla vive
// en js/lib/plateMap.js y está testeada aparte; aquí solo hay interfaz.
//
// La decisión que manda sobre todo lo demás: **seleccionar se hace
// arrastrando**, no escribiendo nombres de pocillos. Arrastras un rectángulo,
// tocas la letra de una fila o el número de una columna para llevártela
// entera, y la esquina selecciona la placa completa. Shift suma a lo ya
// seleccionado y Ctrl (o Cmd) quita. Escribir "B2:D7" a mano es justo lo que
// este módulo existe para no tener que hacer.
//
// Se usan eventos de puntero (no de ratón) para que el arrastre funcione igual
// con dedo que con ratón, y la rejilla lleva `touch-action: none` porque si no
// el navegador se queda el gesto para desplazar la página y no llega nunca al
// arrastre.

import { t } from '../lib/i18n.js';
import {
  PLATE_FORMATS, allWells, wellsInBlock, parseWellId, plateGrid,
  fillSeries, fillConstant, mapToTable, tableToMap, innerWells, edgeWells,
  autofillFromDesign, PLATE_TABLE_HEADERS,
} from '../lib/plateMap.js';
import { toDelimitedText, parseTable } from '../lib/csv.js';
import { CATEGORICAL } from '../lib/palettes.js';
import { reactionPlan, qpcrLayout } from '../lib/qpcrPlan.js';

const STORE_KEY = 'smart-175.mapaPlaca';
const DESIGN_KEY = 'smart-175.diseno';
const FORMATS = Object.keys(PLATE_FORMATS).map(Number).sort((a, b) => a - b);

// ---------------------------------------------------------------- estado ---

function defaultState() {
  return { format: 96, map: {}, series: { prefix: 'Muestra ', start: 1, direction: 'row' } };
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && PLATE_FORMATS[Number(raw.format)]) {
      return {
        format: Number(raw.format),
        map: (raw.map && typeof raw.map === 'object') ? raw.map : {},
        series: {
          prefix: String(raw.series?.prefix ?? 'Muestra '),
          start: Number.isFinite(+raw.series?.start) ? +raw.series.start : 1,
          direction: raw.series?.direction === 'column' ? 'column' : 'row',
        },
      };
    }
  } catch (e) { /* localStorage puede fallar o venir corrupto */ }
  return defaultState();
}

function save(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* cuota llena */ }
}

/** Diseño guardado por #/diseno, si lo hay. Habilita el autorrelleno. */
function loadDesign() {
  try {
    const raw = JSON.parse(localStorage.getItem(DESIGN_KEY) || 'null');
    if (raw && Array.isArray(raw.labels) && raw.labels.length) return raw;
  } catch (e) { /* ignorar */ }
  return null;
}

// ------------------------------------------------------------------ CSS ----
// Se inyecta una sola vez. Son estilos propios de la rejilla, que no encajan
// en ninguna utilidad `ql-*` existente; si algún día se mueven a css/, basta
// con borrar esta función.

const STYLE_ID = 'ql-pm-style';
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
.ql-pm-wrap{overflow:auto;max-width:100%}
.ql-pm-grid{display:grid;gap:3px;touch-action:none;user-select:none;-webkit-user-select:none;width:max-content;padding:2px}
.ql-pm-head{display:flex;align-items:center;justify-content:center;font:600 11px/1 var(--font-ui,system-ui);color:var(--ink-muted,#666);cursor:pointer;border:0;background:none;padding:2px;min-width:18px;min-height:18px}
.ql-pm-head:hover{color:var(--ink,#111);text-decoration:underline}
.ql-pm-well{position:relative;aspect-ratio:1;min-width:18px;border-radius:50%;border:1px solid var(--line,#bbb);background:var(--surface,#fff);cursor:pointer;padding:0;overflow:hidden;font:500 9px/1.05 var(--font-ui,system-ui);color:var(--ink,#111)}
.ql-pm-well span{display:block;padding:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ql-pm-well.is-filled{border-color:var(--ink-muted,#888)}
.ql-pm-well.is-sel{outline:2px solid var(--brand,#00107C);outline-offset:1px}
.ql-pm-well.is-pre{outline:2px dashed var(--brand,#00107C);outline-offset:1px}
.ql-pm-well:focus-visible{outline:3px solid var(--brand,#00107C);outline-offset:2px}
.ql-pm-row{flex-wrap:wrap;gap:8px;margin:8px 0}
.ql-pm-swatches{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}
.ql-pm-sw{width:22px;height:22px;border-radius:4px;border:1px solid var(--line,#bbb);cursor:pointer;padding:0}
.ql-pm-sw.is-on{outline:2px solid var(--brand,#00107C);outline-offset:1px}
.ql-pm-count{font-variant-numeric:tabular-nums}
.ql-pm-legend{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.ql-pm-chip{display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:2px 8px;border:1px solid var(--line,#ccc);border-radius:999px}
.ql-pm-chip i{width:10px;height:10px;border-radius:50%;background:var(--line,#ccc);display:inline-block}
.ql-pm-preset{margin:8px 0}
.ql-pm-preset summary{cursor:pointer;font-weight:600}
@media (max-width:860px){.ql-pm-well{min-width:15px}.ql-pm-head{min-width:15px;font-size:10px}}
`;
  document.head.appendChild(st);
}

// ---------------------------------------------------------------- render ---

export function render(container, opts = {}) {
  injectStyle();
  const s = load();

  /** Pocillos seleccionados ahora mismo. */
  let selection = new Set();
  /** Vista previa del rectángulo que se está arrastrando. */
  let preview = new Set();
  /** Portapapeles interno (copiar/pegar entre zonas de la placa). */
  let clipboard = null;

  /** Una sola marcha atrás. Más de una se vuelve confusa en una rejilla:
   *  con una basta para arreglar el error típico, que es vaciar o pintar
   *  encima de una selección mal hecha. */
  let undoMap = null;

  let dragging = false;
  let dragAnchor = null;
  let dragMode = 'replace';
  const wellEls = new Map();

  const cellOf = (w) => s.map[w] || null;
  const isFilled = (w) => {
    const c = cellOf(w);
    return !!c && ['etiqueta', 'contenido', 'grupo', 'color'].some((k) => String(c[k] ?? '') !== '');
  };

  // --- pintado de la selección sin repintar la rejilla entera -------------
  // Con 384 pocillos, repintar en cada pointermove da un arrastre a tirones.
  function applyMarks() {
    wellEls.forEach((el, w) => {
      el.classList.toggle('is-sel', selection.has(w));
      el.classList.toggle('is-pre', preview.has(w));
    });
    if (countEl) {
      countEl.textContent = t('mapa.selected', { n: selection.size });
    }
    if (panelEl) panelEl.hidden = selection.size === 0;
  }

  function setSelection(wells) { selection = new Set(wells); applyMarks(); }
  function addSelection(wells) { wells.forEach((w) => selection.add(w)); applyMarks(); }
  function removeSelection(wells) { wells.forEach((w) => selection.delete(w)); applyMarks(); }

  // --- arrastre ------------------------------------------------------------
  function wellUnderPointer(ev) {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const btn = el && el.closest ? el.closest('[data-well]') : null;
    return btn ? btn.dataset.well : null;
  }

  function onKeyDown(ev) {
    if (ev.key === 'Escape' && selection.size) { setSelection([]); }
  }

  function onPointerDown(ev) {
    const well = ev.target.closest ? ev.target.closest('[data-well]') : null;
    if (!well) return;
    ev.preventDefault();
    dragging = true;
    dragAnchor = well.dataset.well;
    dragMode = ev.shiftKey ? 'add' : ((ev.ctrlKey || ev.metaKey) ? 'remove' : 'replace');
    preview = new Set([dragAnchor]);
    if (dragMode === 'replace') selection = new Set();
    applyMarks();
    try { gridEl.setPointerCapture(ev.pointerId); } catch (e) { /* algunos navegadores */ }
  }

  function onPointerMove(ev) {
    if (!dragging) return;
    const w = wellUnderPointer(ev);
    if (!w) return;
    preview = new Set(wellsInBlock(s.format, dragAnchor, w));
    applyMarks();
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    const block = [...preview];
    preview = new Set();
    if (dragMode === 'remove') removeSelection(block);
    else addSelection(block);
    dragAnchor = null;
  }

  function onPointerUp(ev) {
    if (!dragging) return;
    ev.preventDefault();
    endDrag();
    try { gridEl.releasePointerCapture(ev.pointerId); } catch (e) { /* ignorar */ }
  }

  // --- edición de los pocillos seleccionados -------------------------------
  /** Guarda el estado anterior antes de tocar el mapa. */
  function snapshot() {
    undoMap = JSON.parse(JSON.stringify(s.map));
  }

  function undo() {
    if (!undoMap) return;
    s.map = undoMap;
    undoMap = null;
    save(s);
    msg = t('mapa.undone');
    paint();
  }

  function applyToSelection(patch) {
    snapshot();
    selection.forEach((w) => {
      const cur = s.map[w] || { etiqueta: '', contenido: '', grupo: '', color: '' };
      s.map[w] = { ...cur, ...patch };
    });
    save(s);
    paint();
  }

  function clearSelection() {
    snapshot();
    selection.forEach((w) => { delete s.map[w]; });
    save(s);
    paint();
  }

  /** Orden de la selección según la dirección elegida, para numerar series. */
  function orderedSelection() {
    return [...selection].sort((a, b) => {
      const pa = parseWellId(a);
      const pb = parseWellId(b);
      return s.series.direction === 'column'
        ? (pa.col - pb.col) || (pa.row - pb.row)
        : (pa.row - pb.row) || (pa.col - pb.col);
    });
  }

  function applySeries() {
    snapshot();
    const labels = fillSeries(orderedSelection(), {
      prefix: s.series.prefix, start: s.series.start,
    });
    Object.entries(labels).forEach(([w, label]) => {
      const cur = s.map[w] || { etiqueta: '', contenido: '', grupo: '', color: '' };
      s.map[w] = { ...cur, etiqueta: label };
    });
    save(s);
    paint();
  }

  function copySelection() {
    const ordered = orderedSelection();
    if (!ordered.length) return;
    const anchor = parseWellId(ordered[0]);
    clipboard = ordered.map((w) => {
      const p = parseWellId(w);
      return { dr: p.row - anchor.row, dc: p.col - anchor.col, cell: { ...(s.map[w] || {}) } };
    });
    paint();
  }

  function pasteAt() {
    if (!clipboard || !selection.size) return;
    snapshot();
    const target = parseWellId(orderedSelection()[0]);
    const { rows, cols } = plateGrid(s.format);
    clipboard.forEach(({ dr, dc, cell }) => {
      const r = target.row + dr;
      const c = target.col + dc;
      if (r < 0 || c < 0 || r >= rows || c >= cols) return;
      const w = allWells(s.format)[r * cols + c];
      s.map[w] = { ...cell };
    });
    save(s);
    paint();
  }

  // --- importar / exportar -------------------------------------------------
  function download(text, name, mime) {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportCsv() {
    const { headers, rows } = mapToTable(s.map, s.format);
    download(toDelimitedText(headers, rows, ','), `mapa-placa-${s.format}.csv`, 'text/csv;charset=utf-8');
  }

  function importCsv(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseTable(String(reader.result || ''));
      const { map, ignored } = tableToMap(parsed.rows, s.format);
      s.map = map;
      save(s);
      msg = ignored > 0 ? t('mapa.importIgnored', { n: ignored }) : t('mapa.importOk');
      paint();
    };
    reader.readAsText(file);
  }

  function autofill() {
    const design = loadDesign();
    if (!design) return;
    snapshot();
    const wells = useInner ? innerWells(s.format) : allWells(s.format);
    const res = autofillFromDesign(s.format, design.labels, { order: design.order, wells });
    Object.entries(res.assignments).forEach(([w, label]) => {
      const cur = s.map[w] || { etiqueta: '', contenido: '', grupo: '', color: '' };
      s.map[w] = { ...cur, etiqueta: label };
    });
    save(s);
    msg = res.overflow > 0 ? t('mapa.autofillOverflow', { n: res.overflow })
      : t('mapa.autofillOk', { n: res.placed });
    paint();
  }

  /** Reparte una tanda de qPCR por la placa: una banda por diana, los
   *  triplicados de cada muestra seguidos y los controles sin molde al final. */
  function applyQpcrPreset(samplesText, targetsText, reps) {
    const samples = samplesText.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
    const targets = targetsText.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
    if (!samples.length || !targets.length) { msg = t('mapa.qpcrNeedBoth'); paint(); return; }
    const plan = reactionPlan({ samples, targets, plan: { technicalReplicates: reps } });
    const lay = qpcrLayout(plan.reactions, { format: s.format, allWells, plateGrid });
    snapshot();
    Object.assign(s.map, lay.assignments);
    save(s);
    msg = lay.overflow > 0
      ? t('mapa.qpcrOverflow', { n: lay.placed, out: lay.overflow })
      : t('mapa.qpcrOk', { n: lay.placed, r: plan.total });
    paint();
  }

  // --- construcción de la interfaz -----------------------------------------
  let gridEl = null;
  let panelEl = null;
  let countEl = null;
  let msg = '';
  let useInner = false;

  const el2 = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const btn = (label, onClick, extraClass = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ql-btn' + (extraClass ? ' ' + extraClass : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  const field = (labelText, input) => {
    const wrap = document.createElement('label');
    wrap.className = 'ql-field';
    const sp = document.createElement('span');
    sp.textContent = labelText;
    wrap.appendChild(sp);
    wrap.appendChild(input);
    return wrap;
  };

  function buildGrid() {
    const { rows, cols } = plateGrid(s.format);
    wellEls.clear();

    const wrap = document.createElement('div');
    wrap.className = 'ql-pm-wrap';

    const grid = document.createElement('div');
    grid.className = 'ql-pm-grid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', t('mapa.gridAria', { n: s.format }));
    grid.style.gridTemplateColumns = `auto repeat(${cols}, minmax(18px, 1fr))`;

    // esquina: selecciona la placa entera
    const corner = document.createElement('button');
    corner.type = 'button';
    corner.className = 'ql-pm-head';
    corner.textContent = '▦';
    corner.setAttribute('aria-label', t('mapa.selectAll'));
    corner.addEventListener('click', () => setSelection(allWells(s.format)));
    grid.appendChild(corner);

    // cabeceras de columna
    for (let c = 0; c < cols; c++) {
      const h = document.createElement('button');
      h.type = 'button';
      h.className = 'ql-pm-head';
      h.textContent = String(c + 1);
      h.setAttribute('aria-label', t('mapa.selectColumn', { n: c + 1 }));
      h.addEventListener('click', (ev) => {
        const col = wellsInBlock(s.format, `A${c + 1}`,
          `${'ABCDEFGHIJKLMNOP'[rows - 1]}${c + 1}`, { direction: 'column' });
        if (ev.shiftKey) addSelection(col); else setSelection(col);
      });
      grid.appendChild(h);
    }

    for (let r = 0; r < rows; r++) {
      const letter = 'ABCDEFGHIJKLMNOP'[r];
      const h = document.createElement('button');
      h.type = 'button';
      h.className = 'ql-pm-head';
      h.textContent = letter;
      h.setAttribute('aria-label', t('mapa.selectRow', { n: letter }));
      h.addEventListener('click', (ev) => {
        const row = wellsInBlock(s.format, `${letter}1`, `${letter}${cols}`);
        if (ev.shiftKey) addSelection(row); else setSelection(row);
      });
      grid.appendChild(h);

      for (let c = 0; c < cols; c++) {
        const w = letter + String(c + 1);
        const cell = cellOf(w);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ql-pm-well' + (isFilled(w) ? ' is-filled' : '');
        b.dataset.well = w;
        if (cell && cell.color) b.style.background = cell.color;
        const label = cell && cell.etiqueta ? cell.etiqueta : '';
        b.innerHTML = '<span></span>';
        b.firstChild.textContent = label;
        b.title = label ? `${w} · ${label}` : w;
        b.setAttribute('aria-label', label ? `${w}: ${label}` : t('mapa.emptyWell', { w }));
        wellEls.set(w, b);
        grid.appendChild(b);
      }
    }

    grid.addEventListener('pointerdown', onPointerDown);
    grid.addEventListener('pointermove', onPointerMove);
    grid.addEventListener('pointerup', onPointerUp);
    grid.addEventListener('pointercancel', endDrag);
    gridEl = grid;
    wrap.appendChild(grid);
    return wrap;
  }

  /** Qué grupos hay en la placa y de qué color, que es lo que se mira al
   *  revisar un mapa de un vistazo. */
  function buildLegend() {
    const seen = new Map();
    allWells(s.format).forEach((w) => {
      const c = s.map[w];
      if (!c) return;
      const key = String(c.grupo || c.etiqueta || '').trim();
      if (!key) return;
      if (!seen.has(key)) seen.set(key, { count: 0, color: c.color || '' });
      const e = seen.get(key);
      e.count++;
      if (!e.color && c.color) e.color = c.color;
    });
    if (!seen.size) return null;
    const box = document.createElement('div');
    box.className = 'ql-pm-legend';
    [...seen.entries()].slice(0, 24).forEach(([name, info]) => {
      const chip = document.createElement('span');
      chip.className = 'ql-pm-chip';
      const dot = document.createElement('i');
      if (info.color) dot.style.background = info.color;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(`${name} (${info.count})`));
      box.appendChild(chip);
    });
    return box;
  }

  function buildPanel() {
    const panel = document.createElement('section');
    panel.className = 'ql-card ql-panel';
    panel.hidden = selection.size === 0;

    const h = document.createElement('h2');
    h.textContent = t('mapa.panelTitle');
    panel.appendChild(h);

    const inputs = {};
    [['etiqueta', 'mapa.fLabel'], ['contenido', 'mapa.fContent'], ['grupo', 'mapa.fGroup']]
      .forEach(([key, k]) => {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.setAttribute('aria-label', t(k));
        inputs[key] = inp;
        panel.appendChild(field(t(k), inp));
      });

    // paleta validada para daltonismo + campo hex libre
    const sw = document.createElement('div');
    sw.className = 'ql-pm-swatches';
    let chosen = '';
    const hex = document.createElement('input');
    hex.type = 'text';
    hex.placeholder = '#12615F';
    hex.setAttribute('aria-label', t('mapa.fHex'));
    CATEGORICAL.forEach((color) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-pm-sw';
      b.style.background = color;
      b.setAttribute('aria-label', color);
      b.addEventListener('click', () => {
        chosen = color;
        hex.value = color;
        sw.querySelectorAll('.ql-pm-sw').forEach((x) => x.classList.remove('is-on'));
        b.classList.add('is-on');
      });
      sw.appendChild(b);
    });
    panel.appendChild(sw);
    panel.appendChild(field(t('mapa.fHex'), hex));

    const actions = document.createElement('div');
    actions.className = 'ql-inputrow ql-pm-row';
    actions.appendChild(btn(t('mapa.apply'), () => {
      const patch = {};
      Object.entries(inputs).forEach(([k, inp]) => { if (inp.value !== '') patch[k] = inp.value; });
      const color = hex.value.trim() || chosen;
      if (color) patch.color = color;
      if (Object.keys(patch).length) applyToSelection(patch);
    }, 'ql-btn-primary'));
    actions.appendChild(btn(t('mapa.clear'), clearSelection));
    actions.appendChild(btn(t('mapa.copy'), copySelection));
    actions.appendChild(btn(t('mapa.paste'), pasteAt));
    panel.appendChild(actions);

    // --- serie numerada ---
    const serieBox = document.createElement('div');
    serieBox.className = 'ql-inputrow ql-pm-row';
    const pre = document.createElement('input');
    pre.type = 'text';
    pre.value = s.series.prefix;
    pre.setAttribute('aria-label', t('mapa.seriesPrefix'));
    pre.addEventListener('input', () => { s.series.prefix = pre.value; save(s); });
    const start = document.createElement('input');
    start.type = 'number';
    start.value = String(s.series.start);
    start.setAttribute('aria-label', t('mapa.seriesStart'));
    start.addEventListener('input', () => { s.series.start = Number(start.value) || 1; save(s); });
    const dir = document.createElement('select');
    dir.setAttribute('aria-label', t('mapa.seriesDirection'));
    [['row', t('mapa.byRow')], ['column', t('mapa.byColumn')]].forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      dir.appendChild(o);
    });
    dir.value = s.series.direction;
    dir.addEventListener('change', () => { s.series.direction = dir.value; save(s); });
    serieBox.appendChild(field(t('mapa.seriesPrefix'), pre));
    serieBox.appendChild(field(t('mapa.seriesStart'), start));
    serieBox.appendChild(field(t('mapa.seriesDirection'), dir));
    serieBox.appendChild(btn(t('mapa.applySeries'), applySeries));
    panel.appendChild(serieBox);

    panelEl = panel;
    return panel;
  }

  function paint() {
    container.innerHTML = '';
    wellEls.clear();

    if (!opts.embedded) {
      const header = document.createElement('header');
      header.className = 'ql-page-header';
      header.innerHTML = '<p class="ql-eyebrow">' + t('mapa.eyebrow') + '</p>'
        + '<h1 class="ql-page-title">' + t('mapa.title') + '</h1>'
        + '<p class="ql-page-sub">' + t('mapa.subtitle') + '</p>';
      container.appendChild(header);
    }

    const bar = document.createElement('div');
    bar.className = 'ql-inputrow ql-pm-row';

    const fmt = document.createElement('select');
    fmt.setAttribute('aria-label', t('mapa.format'));
    FORMATS.forEach((f) => {
      const o = document.createElement('option');
      o.value = String(f);
      o.textContent = t('mapa.formatN', { n: f });
      fmt.appendChild(o);
    });
    fmt.value = String(s.format);
    fmt.addEventListener('change', () => {
      s.format = Number(fmt.value);
      selection = new Set();
      save(s);
      paint();
    });
    bar.appendChild(field(t('mapa.format'), fmt));

    bar.appendChild(btn(t('mapa.selectInner'), () => { setSelection(innerWells(s.format)); }));
    bar.appendChild(btn(t('mapa.selectEdge'), () => { setSelection(edgeWells(s.format)); }));
    bar.appendChild(btn(t('mapa.selectNone'), () => setSelection([])));

    const design = loadDesign();
    if (design) {
      const innerToggle = document.createElement('input');
      innerToggle.type = 'checkbox';
      innerToggle.checked = useInner;
      innerToggle.setAttribute('aria-label', t('mapa.avoidEdge'));
      innerToggle.addEventListener('change', () => { useInner = innerToggle.checked; });
      bar.appendChild(field(t('mapa.avoidEdge'), innerToggle));
      bar.appendChild(btn(t('mapa.autofill', { n: design.labels.length }), autofill));
    }

    const undoBtn = btn(t('mapa.undo'), undo);
    undoBtn.disabled = !undoMap;
    bar.appendChild(undoBtn);
    bar.appendChild(btn(t('mapa.exportCsv'), exportCsv));

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.csv,.tsv,.txt';
    file.style.display = 'none';
    file.addEventListener('change', () => { if (file.files[0]) importCsv(file.files[0]); });
    bar.appendChild(btn(t('mapa.importCsv'), () => file.click()));
    bar.appendChild(file);

    container.appendChild(bar);

    const hint = document.createElement('p');
    hint.className = 'ql-panel-note';
    hint.textContent = t('mapa.dragHint');
    container.appendChild(hint);

    countEl = document.createElement('p');
    countEl.className = 'ql-panel-note ql-pm-count';
    countEl.textContent = t('mapa.selected', { n: selection.size });
    container.appendChild(countEl);

    if (msg) {
      const m = document.createElement('p');
      m.className = 'ql-panel-note';
      m.setAttribute('role', 'status');
      m.textContent = msg;
      container.appendChild(m);
      msg = '';
    }

    // preset de qPCR
    const preset = document.createElement('details');
    preset.className = 'ql-pm-preset';
    const sum = document.createElement('summary');
    sum.textContent = t('mapa.qpcrPreset');
    preset.appendChild(sum);
    const pr = document.createElement('div');
    pr.className = 'ql-inputrow ql-pm-row';
    const inSamples = document.createElement('input');
    inSamples.type = 'text';
    inSamples.placeholder = 'M1, M2, M3';
    inSamples.setAttribute('aria-label', t('mapa.qpcrSamples'));
    const inTargets = document.createElement('input');
    inTargets.type = 'text';
    inTargets.placeholder = '16S, DIANA';
    inTargets.setAttribute('aria-label', t('mapa.qpcrTargets'));
    const inReps = document.createElement('input');
    inReps.type = 'number';
    inReps.min = '1';
    inReps.value = '3';
    inReps.className = 'ql-num-small';
    inReps.setAttribute('aria-label', t('mapa.qpcrReps'));
    pr.appendChild(field(t('mapa.qpcrSamples'), inSamples));
    pr.appendChild(field(t('mapa.qpcrTargets'), inTargets));
    pr.appendChild(field(t('mapa.qpcrReps'), inReps));
    pr.appendChild(btn(t('mapa.qpcrApply'),
      () => applyQpcrPreset(inSamples.value, inTargets.value, Number(inReps.value) || 3)));
    preset.appendChild(pr);
    preset.appendChild(el2('p', 'ql-panel-note', t('mapa.qpcrNote')));
    container.appendChild(preset);

    const legend = buildLegend();
    if (legend) container.appendChild(legend);
    else {
      const empty = el2('p', 'ql-panel-note', t('mapa.emptyHint'));
      container.appendChild(empty);
    }

    container.appendChild(buildGrid());
    container.appendChild(buildPanel());
    applyMarks();
  }

  document.addEventListener('keydown', onKeyDown);
  paint();

  return () => {
    save(s);
    document.removeEventListener('keydown', onKeyDown);
    if (gridEl) {
      gridEl.removeEventListener('pointerdown', onPointerDown);
      gridEl.removeEventListener('pointermove', onPointerMove);
      gridEl.removeEventListener('pointerup', onPointerUp);
      gridEl.removeEventListener('pointercancel', endDrag);
    }
    wellEls.clear();
  };
}

export { PLATE_TABLE_HEADERS };
