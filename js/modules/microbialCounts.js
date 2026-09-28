// Recuentos microbianos (placa: UFC/mL; NMP: NMP/mL). El laboratorio entrega
// el valor por réplica ya resuelto; este módulo solo agrupa las réplicas,
// promedia en log10 y pinta barras con barra de error (±SD por defecto, ±SE
// con un toggle — la etiqueta deja claro cuál se muestra).
//
// Entrada: state.microbialCounts — un array de "series", una por organismo.
// Cada serie trae la tabla ya parseada + un mapeo de columnas editable
// (agrupación / valor / dilución / ¿ya en log10?). Se pueden cargar varias
// series a la vez, de un archivo con varias columnas de valor o de varios
// archivos (botón "+ añadir"), igual que "Comparar varias" en diferencial.

import {
  state, subscribe, registerFile,
  addMicrobialCountSeries, updateMicrobialCountSeries, removeMicrobialCountSeries,
} from '../state.js';
import { t, getLang } from '../lib/i18n.js';
import { groupColor, drawGroupStripPlot, drawGroupViolin, legendPositionLabel } from '../lib/groupBoxplot.js';
import { chartTypeField } from '../lib/chartTypeSelector.js';
import { attachChartEditor, getFigureOptions } from '../lib/chartEditor.js';
import { orderCategories } from '../lib/categoryOrder.js';
import { ingestFile } from '../lib/ingest.js';
import { parseTable } from '../lib/csv.js';
import { summariseCountSeries, splitByFacet } from '../lib/countStats.js';
import { fisherLSD, compactLetterDisplay } from '../lib/stats.js';
import { drawSignificanceBrackets, countBracketRows } from '../lib/statAnnotations.js';
import {
  loadExampleMicrobialCountsPlate, loadExampleMicrobialCountsMPN, exampleDownloadBlock,
} from '../lib/exampleData.js';
import { svgEl, escapeHtml, moreDetailsHtml, plotClip } from '../lib/dom.js';
import { glossaryLinkHtml } from '../lib/glossaryLink.js';
import { createTooltip, hideTooltip, showTooltip } from '../lib/tooltip.js';
import { render as renderCfuCalculator } from './cfuCalculator.js';
function fmt(v, d) {
  return (typeof v === 'number' && isFinite(v)) ? v.toFixed(d) : '—';
}

const NUM_RE = /^-?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?$/;
function columnLooksNumeric(rows, header) {
  if (!rows.length) return false;
  const ok = rows.filter((r) => NUM_RE.test(String(r[header] ?? '').trim())).length;
  return ok >= Math.max(1, rows.length * 0.7);
}

export function render(container) {
  // Recuentos y la calculadora de UFC/mL son un mismo módulo con dos
  // pestañas (Fase 2, B4). La pestaña va en el hash (#/recuentos?tab=calc)
  // para que sea enlazable; #/ufc es un alias que redirige ahí (app.js).
  const section = new URLSearchParams(location.hash.split('?')[1] || '').get('tab') === 'calc' ? 'calc' : 'data';
  let calcCleanup = null;
  let activeId = null;
  let errBar = 'sd';               // 'sd' | 'se'
  let plotStyle = 'bars';          // 'bars' | 'jitter'
  let sigDisplay = 'letters';      // 'letters' | 'brackets' — Paso 4 de
                                    // qiimelab-prompt-editor-fase-1-anotaciones-estadisticas.md
  let sort = { key: 'group', dir: 'asc' };
  let editors = []; // uno por bloque — con "agrupar por" puede haber varios a la vez
  let wasEditingAny = false; // ver cfg.startEditing en chartEditor.js — si CUALQUIER bloque
                              // estaba en modo "Personalizar" antes de repintar, todos los
                              // bloques recreados vuelven a arrancar ya en ese modo
  const addVarState = new Map(); // seriesId -> { open, mode:'manual'|'file', name, joinCol, editingCol, msg }
  const mappingOpen = new Set(); // series con el desplegable de mapeo abierto (sobrevive a paint())

  async function addFromFile(file, msgEl) {
    let ing;
    try { ing = await ingestFile(file); }
    catch (e) { if (msgEl) msgEl.textContent = (e && e.message) || String(e); return; }
    const mc = ing.results.find((r) => r.kind === 'microbialCounts');
    if (!mc) {
      if (msgEl) msgEl.textContent = t('recuentos.notRecognised', { name: file.name }) +
        (ing.warnings && ing.warnings.length ? ' — ' + ing.warnings.join(' · ') : '');
      return;
    }
    const fileId = registerFile(file.name, file.size, t('recuentos.fileNote') + ' — ' + file.name);
    const base = file.name.replace(/\.[^.]+$/, '');
    const generic = /^(valor|value|count|counts|recuento|log|log10|dato|resultado)$/i;
    const cols = (mc.valueCols && mc.valueCols.length) ? mc.valueCols : [mc.valueCol];
    cols.forEach((vc, k) => {
      const raw = String(mc.headers[vc] || '').trim();
      const label = (!raw || generic.test(raw.replace(/[^a-z0-9]/gi, '')))
        ? (cols.length > 1 ? base + ' — ' + (raw || ('serie ' + (k + 1))) : base)
        : raw;
      addMicrobialCountSeries({
        label,
        sourceFileId: fileId,
        headers: mc.headers,
        rows: mc.rows,
        mapping: {
          groupCols: (mc.groupCols || []).slice(),
          valueCol: vc,
          dilutionCol: mc.dilutionCol != null ? mc.dilutionCol : null,
          alreadyLog: !!mc.alreadyLog,
          facetCol: null,
        },
      });
    });
  }

  function paint() {
    // isEditing() devuelve el modo ('edit'|'settings') o false — se conserva el modo, no un booleano
    wasEditingAny = editors.map((e) => (e.isEditing ? e.isEditing() : false)).find(Boolean) || false;
    editors.forEach((e) => e.destroy()); editors = [];
    if (calcCleanup) { calcCleanup(); calcCleanup = null; }
    container.innerHTML = '';

    const header = document.createElement('header');
    header.className = 'ql-page-header';
    header.innerHTML =
      '<p class="ql-eyebrow">' + t('recuentos.eyebrow') + '</p>' +
      '<h1 class="ql-page-title">' + t('recuentos.title') + '</h1>' +
      '<p class="ql-page-sub">' + t(section === 'calc' ? 'ufc.subtitle' : 'recuentos.subtitle') + '</p>';
    container.appendChild(header);

    // ---- pestañas de primer nivel: análisis | calculadora UFC/mL ----
    const secTabs = document.createElement('div');
    secTabs.className = 'ql-tabs ql-mc-sections';
    secTabs.setAttribute('role', 'tablist');
    [['data', t('recuentos.sectionData'), '#/recuentos'], ['calc', t('recuentos.sectionCalc'), '#/recuentos?tab=calc']].forEach(([id, label, href]) => {
      const a = document.createElement('a');
      a.className = 'ql-tab' + (section === id ? ' is-active' : '');
      a.href = href;
      a.setAttribute('role', 'tab');
      a.setAttribute('aria-selected', String(section === id));
      a.textContent = label;
      secTabs.appendChild(a);
    });
    container.appendChild(secTabs);

    if (section === 'calc') {
      const host = document.createElement('div');
      container.appendChild(host);
      calcCleanup = renderCfuCalculator(host, { embedded: true });
      return;
    }

    const series = Array.isArray(state.microbialCounts) ? state.microbialCounts : [];

    if (series.length === 0) {
      const card = document.createElement('div');
      card.className = 'ql-card ql-panel';
      card.innerHTML =
        '<div class="ql-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 20h16"/><rect x="5.5" y="11" width="3.6" height="9" rx="0.8"/><rect x="10.2" y="6" width="3.6" height="14" rx="0.8"/><rect x="14.9" y="9" width="3.6" height="11" rx="0.8"/><path d="M7.3 11V9M12 6V3.5M16.7 9V6.5"/></svg>' +
        '<h3>' + t('recuentos.emptyTitle') + '</h3><p>' + t('recuentos.emptyDesc') + '</p></div>';
      const host = card.querySelector('.ql-empty');
      const row = document.createElement('div');
      row.className = 'ql-example-btns';
      row.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:4px;';
      const msg = document.createElement('p');
      msg.className = 'ql-field-help';
      msg.style.cssText = 'width:100%;text-align:center;';
      [[t('recuentos.exPlate'), loadExampleMicrobialCountsPlate, 'ql-btn ql-btn-primary'],
        [t('recuentos.exMPN'), loadExampleMicrobialCountsMPN, 'ql-btn']].forEach(([label, fn, cls]) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = cls; b.textContent = label;
        b.addEventListener('click', async () => {
          b.disabled = true; msg.textContent = '';
          try {
            const w = await fn();
            if (Array.isArray(w) && w.length) msg.textContent = w.join(' · ');
          } catch (e) { b.disabled = false; msg.textContent = String((e && e.message) || e); }
        });
        row.appendChild(b);
      });
      const load = document.createElement('a');
      load.href = '#/cargar'; load.className = 'ql-btn'; load.textContent = t('ui.goLoadData');
      row.appendChild(load);
      host.appendChild(row);
      host.appendChild(msg);
      host.appendChild(exampleDownloadBlock(['recuentosPlaca', 'recuentosNMP']));
      container.appendChild(card);
      return;
    }

    if (!activeId || !series.some((s) => s.id === activeId)) activeId = series[0].id;

    // ---- lista de series: etiqueta editable + mapeo de columnas + quitar + añadir ----
    renderSeriesManager(series);

    // ---- pestañas de organismo (una por serie) ----
    if (series.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'ql-tabs';
      series.forEach((s) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ql-tab' + (s.id === activeId ? ' is-active' : '');
        b.textContent = s.label || t('recuentos.unnamed');
        b.addEventListener('click', () => { if (activeId !== s.id) { activeId = s.id; paint(); } });
        tabs.appendChild(b);
      });
      container.appendChild(tabs);
    }

    const active = series.find((s) => s.id === activeId);
    renderChartAndTable(active);
  }

  // =========================================================================
  //  Añadir una variable propia (columna) a una serie: a mano, fila a fila,
  //  o subiendo un archivo de 2 columnas (clave + valor) que se une por una
  //  columna existente. La columna nueva queda disponible como cualquier
  //  otra para "agrupar por" o como columna de agrupación de réplicas.
  // =========================================================================
  function renderAddVariable(s) {
    const st = addVarState.get(s.id) || { open: false, mode: 'manual', name: '', joinCol: 0, editingCol: null, msg: '' };
    addVarState.set(s.id, st);
    const wrap = document.createElement('div');
    wrap.style.marginTop = '10px';

    // ---- tabla editable de una columna ya existente (recién creada o cualquiera) ----
    if (st.editingCol != null && s.headers[st.editingCol] != null) {
      const colName = s.headers[st.editingCol];
      const idCols = (s.mapping.groupCols || []).map((i) => s.headers[i]).filter(Boolean);
      const editCard = document.createElement('div');
      editCard.style.cssText = 'border:1px solid var(--border);border-radius:var(--radius-md);padding:10px;margin-top:8px;';
      editCard.innerHTML = '<p class="ql-field-help" style="margin:0 0 8px;"><strong>' +
        t('recuentos.editingVar', { name: colName }) + '</strong></p>';
      const scroll = document.createElement('div');
      scroll.className = 'ql-table-scroll';
      scroll.style.maxHeight = '260px';
      const tbl = document.createElement('table');
      tbl.className = 'ql-table';
      tbl.innerHTML = '<thead><tr><th>' + t('recuentos.editingRowLabel') + '</th><th>' + escapeHtml(colName) + '</th></tr></thead>';
      const tb = document.createElement('tbody');
      s.rows.forEach((r, i) => {
        const tr = document.createElement('tr');
        const label = idCols.length ? idCols.map((c) => r[c]).join(' › ') : t('recuentos.rowN', { n: i + 1 });
        const tdLbl = document.createElement('td');
        tdLbl.textContent = label || t('recuentos.rowN', { n: i + 1 });
        tr.appendChild(tdLbl);
        const tdVal = document.createElement('td');
        const inp = document.createElement('input');
        inp.type = 'text'; inp.value = r[colName] ?? '';
        inp.setAttribute('aria-label', colName + ' — ' + (label || t('recuentos.rowN', { n: i + 1 })));
        inp.addEventListener('change', () => {
          r[colName] = inp.value;
          updateMicrobialCountSeries(s.id, { rows: s.rows.slice() });
        });
        tdVal.appendChild(inp);
        tr.appendChild(tdVal);
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      scroll.appendChild(tbl);
      editCard.appendChild(scroll);
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button'; doneBtn.className = 'ql-btn'; doneBtn.style.marginTop = '8px';
      doneBtn.textContent = t('recuentos.editingDone');
      doneBtn.addEventListener('click', () => { st.editingCol = null; paint(); });
      editCard.appendChild(doneBtn);
      wrap.appendChild(editCard);
      return wrap;
    }

    if (!st.open) {
      const openBtn = document.createElement('button');
      openBtn.type = 'button'; openBtn.className = 'ql-btn';
      openBtn.textContent = t('recuentos.addVariable');
      openBtn.addEventListener('click', () => { st.open = true; paint(); });
      wrap.appendChild(openBtn);
      // acceso directo a editar cualquier columna ya existente
      if (s.headers.length) {
        const editSel = document.createElement('select');
        editSel.style.marginLeft = '8px';
        editSel.setAttribute('aria-label', t('recuentos.editVariablePick'));
        const ph = document.createElement('option');
        ph.value = ''; ph.textContent = t('recuentos.editVariablePick');
        editSel.appendChild(ph);
        s.headers.forEach((h, i) => {
          const o = document.createElement('option');
          o.value = String(i); o.textContent = h || t('ui.columnN', { n: i + 1 });
          editSel.appendChild(o);
        });
        editSel.addEventListener('change', () => {
          if (editSel.value === '') return;
          st.editingCol = parseInt(editSel.value, 10);
          paint();
        });
        wrap.appendChild(editSel);
      }
      return wrap;
    }

    // ---- panel abierto: crear columna a mano o desde archivo ----
    const panel = document.createElement('div');
    panel.style.cssText = 'border:1px solid var(--border);border-radius:var(--radius-md);padding:10px;margin-top:4px;';

    const modeSeg = document.createElement('div');
    modeSeg.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';
    [['manual', t('recuentos.addVarManual')], ['file', t('recuentos.addVarFile')]].forEach(([m, lbl]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ql-seg-btn' + (st.mode === m ? ' is-on' : ''); b.textContent = lbl;
      b.addEventListener('click', () => { st.mode = m; paint(); });
      modeSeg.appendChild(b);
    });
    panel.appendChild(modeSeg);

    if (st.mode === 'manual') {
      const nameField = document.createElement('div');
      nameField.className = 'ql-field';
      nameField.innerHTML = '<label>' + t('recuentos.addVarNameLabel') + '</label>';
      const nameInp = document.createElement('input');
      nameInp.type = 'text'; nameInp.value = st.name; nameInp.placeholder = t('recuentos.addVarNamePh');
      nameInp.addEventListener('input', () => { st.name = nameInp.value; });
      nameField.appendChild(nameInp);
      panel.appendChild(nameField);

      const createBtn = document.createElement('button');
      createBtn.type = 'button'; createBtn.className = 'ql-btn ql-btn-primary';
      createBtn.textContent = t('recuentos.addVarCreate');
      createBtn.addEventListener('click', () => {
        const name = st.name.trim();
        if (!name) return;
        if (s.headers.includes(name)) { st.msg = t('recuentos.addVarDupName'); paint(); return; }
        const newRows = s.rows.map((r) => ({ ...r, [name]: '' }));
        updateMicrobialCountSeries(s.id, { headers: [...s.headers, name], rows: newRows });
        st.open = false; st.name = ''; st.msg = '';
        st.editingCol = s.headers.length; // índice de la columna recién creada
        paint();
      });
      panel.appendChild(createBtn);
    } else {
      panel.insertAdjacentHTML('beforeend', '<p class="ql-field-help" style="margin:0 0 8px;">' + t('recuentos.addVarFileHelp') + '</p>');
      const joinField = document.createElement('div');
      joinField.className = 'ql-field';
      joinField.innerHTML = '<label>' + t('recuentos.addVarJoinLabel') + '</label>';
      const joinSel = document.createElement('select');
      s.headers.forEach((h, i) => {
        const o = document.createElement('option');
        o.value = String(i); o.textContent = h || t('ui.columnN', { n: i + 1 });
        if (st.joinCol === i) o.selected = true;
        joinSel.appendChild(o);
      });
      joinSel.addEventListener('change', () => { st.joinCol = parseInt(joinSel.value, 10); });
      joinField.appendChild(joinSel);
      panel.appendChild(joinField);

      const fileInp = document.createElement('input');
      fileInp.type = 'file'; fileInp.accept = '.csv,.tsv,.txt';
      fileInp.addEventListener('change', async () => {
        const f = fileInp.files && fileInp.files[0];
        fileInp.value = '';
        if (!f) return;
        const text = await f.text();
        const parsed = parseTable(text);
        if (parsed.headers.length < 2) { st.msg = t('recuentos.addVarFileBadFormat'); paint(); return; }
        const [keyHeader, valHeader] = parsed.headers;
        const newName = valHeader || t('recuentos.addVarFileDefaultName');
        if (s.headers.includes(newName)) { st.msg = t('recuentos.addVarDupName'); paint(); return; }
        const lookup = new Map();
        parsed.rows.forEach((r) => lookup.set(String(r[keyHeader] ?? '').trim(), r[valHeader]));
        const joinHeader = s.headers[st.joinCol];
        let matched = 0;
        const newRows = s.rows.map((r) => {
          const k = String(r[joinHeader] ?? '').trim();
          const v = lookup.has(k) ? lookup.get(k) : '';
          if (lookup.has(k)) matched++;
          return { ...r, [newName]: v };
        });
        updateMicrobialCountSeries(s.id, { headers: [...s.headers, newName], rows: newRows });
        st.open = false; st.msg = t('recuentos.addVarFileMatched', { n: matched, total: s.rows.length });
        st.editingCol = null;
        paint();
      });
      panel.appendChild(fileInp);
    }

    if (st.msg) panel.insertAdjacentHTML('beforeend', '<p class="ql-field-help" style="margin-top:8px;">' + escapeHtml(st.msg) + '</p>');

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'ql-btn'; cancelBtn.style.cssText = 'margin-top:8px;margin-left:8px;';
    cancelBtn.textContent = t('ui.cancel');
    cancelBtn.addEventListener('click', () => { st.open = false; st.msg = ''; paint(); });
    panel.appendChild(cancelBtn);

    wrap.appendChild(panel);
    return wrap;
  }

  // =========================================================================
  //  Gestor de series (mapeo de columnas)
  // =========================================================================
  function renderSeriesManager(series) {
    const card = document.createElement('section');
    card.className = 'ql-card ql-panel';
    card.style.marginBottom = '20px';
    card.innerHTML = '<h2>' + t('recuentos.seriesTitle', { n: series.length }) + '</h2>' +
      '<p class="ql-panel-note">' + t('recuentos.seriesNote') + '</p>';

    series.forEach((s) => {
      const box = document.createElement('div');
      box.className = 'ql-mc-series';

      const top = document.createElement('div');
      top.className = 'ql-cmp-row';
      const lbl = document.createElement('input');
      lbl.type = 'text'; lbl.value = s.label || ''; lbl.className = 'ql-cmp-label';
      lbl.setAttribute('aria-label', t('recuentos.labelAria'));
      lbl.addEventListener('change', () => updateMicrobialCountSeries(s.id, { label: lbl.value.trim() || s.label }));
      top.appendChild(lbl);
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'ql-cmp-rm'; rm.title = t('ui.remove');
      rm.setAttribute('aria-label', t('ui.remove')); rm.textContent = '✕';
      rm.addEventListener('click', () => { if (activeId === s.id) activeId = null; removeMicrobialCountSeries(s.id); });
      top.appendChild(rm);
      box.appendChild(top);

      // Todo el mapeo va en un desplegable PLEGADO por defecto (Fase 2, B4):
      // el mapeo automático ya da una gráfica, así que el texto y los
      // controles solo se abren si hay que corregir algo — antes, con los
      // dos ejemplos cargados, la gráfica empezaba a ~4000px. Resumen de una
      // línea con lo esencial; se recuerda abierto entre repintados (cada
      // cambio de mapeo repinta el módulo entero).
      const det = document.createElement('details');
      det.className = 'ql-exdl-details ql-mc-mapping';
      det.open = mappingOpen.has(s.id) || !!(addVarState.get(s.id) || {}).open;
      det.addEventListener('toggle', () => { if (det.open) mappingOpen.add(s.id); else mappingOpen.delete(s.id); });
      const sum = document.createElement('summary');
      const colName = (i) => s.headers[i] || t('ui.columnN', { n: i + 1 });
      sum.textContent = t('recuentos.mappingSummary', {
        value: s.mapping.valueCol != null ? colName(s.mapping.valueCol) : '—',
        groups: (s.mapping.groupCols || []).map(colName).join(', ') || '—',
      });
      det.appendChild(sum);

      // ---- mapeo: columna de valor / dilución / ¿ya en log10? ----
      const map = document.createElement('div');
      map.className = 'ql-mapping-grid';

      const valField = document.createElement('div');
      valField.className = 'ql-field';
      valField.innerHTML = '<label>' + t('recuentos.mapValue') + '</label>';
      const valSel = document.createElement('select');
      s.headers.forEach((h, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = (h || t('ui.columnN', { n: i + 1 })) + (columnLooksNumeric(s.rows, h) ? '' : ' ⚠');
        if (s.mapping.valueCol === i) o.selected = true;
        valSel.appendChild(o);
      });
      valSel.addEventListener('change', () => {
        const vc = parseInt(valSel.value, 10);
        const gc = (s.mapping.groupCols || []).filter((i) => i !== vc);
        updateMicrobialCountSeries(s.id, { mapping: { ...s.mapping, valueCol: vc, groupCols: gc } });
      });
      valField.appendChild(valSel);
      map.appendChild(valField);

      const dilField = document.createElement('div');
      dilField.className = 'ql-field';
      dilField.innerHTML = '<label>' + t('recuentos.mapDilution') + '</label>';
      const dilSel = document.createElement('select');
      const none = document.createElement('option');
      none.value = '-1'; none.textContent = t('recuentos.dilNone');
      if (s.mapping.dilutionCol == null) none.selected = true;
      dilSel.appendChild(none);
      s.headers.forEach((h, i) => {
        const o = document.createElement('option');
        o.value = String(i); o.textContent = h || t('ui.columnN', { n: i + 1 });
        if (s.mapping.dilutionCol === i) o.selected = true;
        dilSel.appendChild(o);
      });
      dilSel.addEventListener('change', () => {
        const dc = parseInt(dilSel.value, 10);
        updateMicrobialCountSeries(s.id, { mapping: { ...s.mapping, dilutionCol: dc < 0 ? null : dc } });
      });
      dilField.appendChild(dilSel);
      dilField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('recuentos.dilHelp') + '</p>');
      map.appendChild(dilField);

      const logField = document.createElement('div');
      logField.className = 'ql-field';
      logField.innerHTML = '<label>' + t('recuentos.mapScale') + '</label>';
      const logRow = document.createElement('label');
      logRow.className = 'ql-checkrow';
      const logCb = document.createElement('input');
      logCb.type = 'checkbox'; logCb.checked = !!s.mapping.alreadyLog;
      logCb.addEventListener('change', () => updateMicrobialCountSeries(s.id, { mapping: { ...s.mapping, alreadyLog: logCb.checked } }));
      logRow.appendChild(logCb);
      logRow.appendChild(document.createTextNode(' ' + t('recuentos.alreadyLog')));
      logField.appendChild(logRow);
      logField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('recuentos.scaleHelp') + '</p>');
      map.appendChild(logField);

      det.appendChild(map);

      // ---- columnas de agrupación (varias) ----
      const gWrap = document.createElement('div');
      gWrap.className = 'ql-field';
      gWrap.innerHTML = '<label>' + t('recuentos.mapGroups') + '</label>' +
        '<p class="ql-field-help" style="margin-top:0;">' + t('recuentos.groupsHelp') + '</p>';
      const gcSet = new Set(s.mapping.groupCols || []);
      s.headers.forEach((h, i) => {
        if (i === s.mapping.valueCol || i === s.mapping.dilutionCol) return;
        const row = document.createElement('label');
        row.className = 'ql-checkrow';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = gcSet.has(i);
        cb.addEventListener('change', () => {
          const next = new Set(s.mapping.groupCols || []);
          if (cb.checked) next.add(i); else next.delete(i);
          updateMicrobialCountSeries(s.id, { mapping: { ...s.mapping, groupCols: [...next].sort((a, b) => a - b) } });
        });
        row.appendChild(cb);
        row.appendChild(document.createTextNode(' ' + (h || t('ui.columnN', { n: i + 1 }))));
        gWrap.appendChild(row);
      });
      det.appendChild(gWrap);

      // ---- agrupar por (una variable, separa el análisis entero en un
      // bloque por nivel — no combina réplicas como groupCols de arriba) ----
      const facetField = document.createElement('div');
      facetField.className = 'ql-field';
      facetField.innerHTML = '<label>' + t('recuentos.mapFacet') + '</label>';
      const facetSel = document.createElement('select');
      const noneOpt = document.createElement('option');
      noneOpt.value = '-1'; noneOpt.textContent = t('recuentos.facetNone');
      if (s.mapping.facetCol == null) noneOpt.selected = true;
      facetSel.appendChild(noneOpt);
      s.headers.forEach((h, i) => {
        if (i === s.mapping.valueCol || i === s.mapping.dilutionCol) return;
        const o = document.createElement('option');
        o.value = String(i); o.textContent = h || t('ui.columnN', { n: i + 1 });
        if (s.mapping.facetCol === i) o.selected = true;
        facetSel.appendChild(o);
      });
      facetSel.addEventListener('change', () => {
        const fc = parseInt(facetSel.value, 10);
        updateMicrobialCountSeries(s.id, { mapping: { ...s.mapping, facetCol: fc < 0 ? null : fc } });
      });
      facetField.appendChild(facetSel);
      facetField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('recuentos.facetHelp') + '</p>' +
        moreDetailsHtml(t('ui.moreDetails'), t('recuentos.facetHelpMore')));
      det.appendChild(facetField);

      det.appendChild(renderAddVariable(s));
      box.appendChild(det);

      card.appendChild(box);
    });

    // ---- barra de acciones: añadir archivo / cargar ejemplo ----
    const bar = document.createElement('div');
    bar.className = 'ql-session-bar';
    const addBtn = document.createElement('button');
    addBtn.type = 'button'; addBtn.className = 'ql-btn'; addBtn.textContent = t('recuentos.add');
    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = '.csv,.tsv,.txt'; fileInput.style.display = 'none';
    fileInput.setAttribute('aria-hidden', 'true'); fileInput.tabIndex = -1;
    const msg = document.createElement('p');
    msg.className = 'ql-field-help';
    addBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      addBtn.disabled = true; msg.textContent = '';
      await addFromFile(f, msg);
      addBtn.disabled = false;
    });
    bar.append(addBtn, fileInput);
    card.appendChild(bar);
    card.appendChild(msg);

    container.appendChild(card);
  }

  // =========================================================================
  //  Gráfico + tabla de una serie — un bloque por nivel de "agrupar por"
  //  (facetCol), o un único bloque si no hay ninguna variable elegida —
  //  mismo espíritu que "agrupar por" en diversidad alfa/beta: el análisis
  //  entero (barras + ANOVA/LSD) se recalcula por separado para cada nivel,
  //  no solo el gráfico.
  // =========================================================================
  function renderChartAndTable(s) {
    const facets = splitByFacet(s);
    if (facets.length > 1) {
      const facetHeader = document.createElement('p');
      facetHeader.className = 'ql-panel-note';
      facetHeader.style.margin = '0 0 4px';
      facetHeader.textContent = t('recuentos.facetActive', { col: s.headers[s.mapping.facetCol], n: facets.length });
      container.appendChild(facetHeader);
    }
    facets.forEach(({ level, series: fs }) => renderOneBlock(fs, level, facets.length > 1));
  }

  function renderOneBlock(s, level, showHeading) {
    const summary = summariseCountSeries(s);
    let usable = summary.groups.filter((g) => g.n > 0);
    // orden de los grupos (Ajustes > Estructura). Se aplica ANTES de fisherLSD:
    // las letras y los corchetes se indexan por posición de grupo. Solo en la
    // vista de barras: puntos/violín ordenan por su cuenta en groupBoxplot.js.
    if (plotStyle === 'bars') {
      const byKey = new Map(usable.map((g) => [g.key, g]));
      const so = getFigureOptions('microbialCounts' + (level ? '-' + level : ''));
      usable = orderCategories(usable.map((g) => g.key), (k) => byKey.get(k).meanLog, so.categoryOrder).map((k) => byKey.get(k));
    }

    if (showHeading) {
      const h = document.createElement('h2');
      h.className = 'ql-block-heading';
      h.style.cssText = 'margin:22px 0 10px;padding-top:14px;border-top:1px solid var(--border);';
      h.textContent = t('recuentos.facetLevel', { level });
      container.appendChild(h);
    }

    // ANOVA de un factor + LSD de Fisher por pares -> letras de grupo
    // homogéneo (a, b, ab…). Sobre los MISMOS valores en log10 que ya usa
    // el resto del módulo para media/SD/SE — no una estadística aparte.
    let lsd = null, letters = null;
    if (usable.length >= 2) {
      const attempt = fisherLSD(usable.map((g) => g.values), 0.05);
      if (!attempt.error) {
        lsd = attempt;
        letters = compactLetterDisplay(usable.length, lsd.pairwise, lsd.means);
      }
    }

    const grid = document.createElement('div');
    grid.className = 'ql-grid-2';

    const chartPanel = document.createElement('section');
    chartPanel.className = 'ql-card ql-panel';
    chartPanel.innerHTML = '<p class="ql-panel-note" style="margin-bottom:4px;">' +
      (plotStyle === 'jitter' ? t('recuentos.jitterNote') : plotStyle === 'violin' ? t('recuentos.violinNote') : t('recuentos.chartNote', { bar: errBar === 'sd' ? t('recuentos.sd') : t('recuentos.se') })) + '</p>';
    const chartWrap = document.createElement('div');
    chartWrap.className = 'ql-chartwrap scroll-x';
    const svg = svgEl('svg', { class: 'ql-svg', role: 'img', 'aria-label': t('recuentos.a11yChart', { organism: (s.label || '') + (level ? ' — ' + level : '') }) });
    const tooltip = createTooltip(chartWrap);
    chartWrap.appendChild(svg);
    chartPanel.appendChild(chartWrap);
    grid.appendChild(chartPanel);

    const controls = document.createElement('aside');
    controls.className = 'ql-card ql-panel';
    controls.innerHTML = '<h2>' + t('ui.controls') + '</h2>';

    controls.appendChild(chartTypeField({
      labelKey: 'recuentos.plotStyleLabel',
      options: [
        { value: 'bars', labelKey: 'recuentos.plotStyleBars' },
        { value: 'jitter', labelKey: 'recuentos.plotStyleJitter' },
        { value: 'violin', labelKey: 'recuentos.plotStyleViolin' },
      ],
      active: plotStyle,
      onChange: (v) => { plotStyle = v; paint(); },
      helpKey: 'recuentos.plotStyleHelp',
    }));

    // toggle ±SD / ±SE (solo tiene sentido con barras — el jitter muestra cada réplica)
    if (plotStyle === 'bars') {
      const ebField = document.createElement('div');
      ebField.className = 'ql-field';
      ebField.innerHTML = '<label>' + t('recuentos.errBarLabel') + '</label>';
      const seg = document.createElement('div');
      seg.className = 'ql-segmented';
      [['sd', t('recuentos.sdFull')], ['se', t('recuentos.seFull')]].forEach(([v, lbl]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ql-seg-btn' + (errBar === v ? ' is-on' : '');
        b.textContent = lbl;
        b.addEventListener('click', () => { if (errBar !== v) { errBar = v; paint(); } });
        seg.appendChild(b);
      });
      ebField.appendChild(seg);
      ebField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('recuentos.errBarHelp') + '</p>');
      controls.appendChild(ebField);
    }

    // letras compactas ⇄ corchetes por pares — mismo cálculo de fisherLSD
    // (ANOVA + LSD de Fisher, alpha=0.05) ya hecho arriba, solo cambia el
    // renderizado (Paso 4 de qiimelab-prompt-editor-fase-1-anotaciones-
    // estadisticas.md). Solo tiene sentido con barras (el jitter no dibuja
    // significación hoy) y cuando hay letras que mostrar.
    if (plotStyle === 'bars' && lsd) {
      const sigField = document.createElement('div');
      sigField.className = 'ql-field';
      sigField.innerHTML = '<label>' + t('recuentos.sigDisplayLabel') + '</label>';
      const seg = document.createElement('div');
      seg.className = 'ql-segmented';
      [['letters', t('recuentos.sigDisplayLetters')], ['brackets', t('recuentos.sigDisplayBrackets')]].forEach(([v, lbl]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ql-seg-btn' + (sigDisplay === v ? ' is-on' : '');
        b.textContent = lbl;
        b.addEventListener('click', () => { if (sigDisplay !== v) { sigDisplay = v; paint(); } });
        seg.appendChild(b);
      });
      sigField.appendChild(seg);
      sigField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('recuentos.sigDisplayHelp') + '</p>');
      controls.appendChild(sigField);
    }

    // resumen
    const statsBox = document.createElement('div');
    statsBox.style.marginTop = '16px';
    statsBox.innerHTML = '<div class="ql-stats">' +
      '<div class="ql-stat"><div class="ql-stat-label">' + t('recuentos.statGroups') + '</div><div class="ql-stat-value" style="font-size:20px;">' + usable.length + '</div></div>' +
      '<div class="ql-stat"><div class="ql-stat-label">' + t('recuentos.statReplicates') + '</div><div class="ql-stat-value" style="font-size:20px;">' + (summary.modeN || '—') + '</div></div>' +
      '</div>';
    controls.appendChild(statsBox);

    // ANOVA + LSD de Fisher: letras de grupo homogéneo
    if (lsd) {
      const anovaBox = document.createElement('div');
      anovaBox.style.marginTop = '10px';
      anovaBox.innerHTML = '<div class="ql-stats">' +
        '<div class="ql-stat"><div class="ql-stat-label">' + t('recuentos.statAnovaF') + '</div><div class="ql-stat-value" style="font-size:18px;">' + fmt(lsd.anova.F, 2) + '</div></div>' +
        '<div class="ql-stat"><div class="ql-stat-label">' + t('recuentos.statAnovaP') + '</div><div class="ql-stat-value" style="font-size:18px;">' + fmt(lsd.anova.p, 4) + '</div></div>' +
        '</div>';
      controls.appendChild(anovaBox);
      const lsdNote = document.createElement('p');
      lsdNote.className = 'ql-field-help';
      lsdNote.style.marginTop = '6px';
      lsdNote.textContent = t('recuentos.lsdCaveat');
      controls.appendChild(lsdNote);
      lsdNote.insertAdjacentHTML('afterend', glossaryLinkHtml('lsd'));
    } else if (usable.length >= 2) {
      const w = document.createElement('p');
      w.className = 'ql-field-help';
      w.textContent = t('recuentos.lsdNeedMore');
      controls.appendChild(w);
    }

    // aviso de réplicas desiguales
    if (summary.unevenN) {
      const w = document.createElement('p');
      w.className = 'ql-privacy';
      w.style.cssText = 'border-color:color-mix(in srgb, var(--warning) 45%, var(--border-strong));';
      w.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>' +
        t('recuentos.unevenWarn', {
          list: usable.filter((g) => g.n !== summary.modeN).map((g) => g.key + ' (n=' + g.n + ')').join(', '),
          mode: summary.modeN,
        });
      controls.appendChild(w);
    }
    // aviso de valores excluidos
    if (summary.excluded > 0) {
      const w = document.createElement('p');
      w.className = 'ql-field-help';
      w.textContent = t('recuentos.excludedWarn', { n: summary.excluded });
      controls.appendChild(w);
    }

    grid.appendChild(controls);
    container.appendChild(grid);

    // ---- tabla ----
    const tableCard = document.createElement('section');
    tableCard.className = 'ql-card ql-panel';
    tableCard.style.marginTop = '20px';
    tableCard.innerHTML = '<h2>' + t('recuentos.tableTitle') + '</h2>' +
      '<p class="ql-panel-note">' + t('recuentos.tableNote', { col: escapeHtml(summary.valueName || '') }) + '</p>';
    container.appendChild(tableCard);

    if (usable.length === 0) {
      chartPanel.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('recuentos.noGroups') + '</p>');
      return;
    }

    if (plotStyle === 'jitter') {
      drawJitter(svg, chartWrap, tooltip, chartPanel, s, summary, usable, level);
    } else if (plotStyle === 'violin') {
      drawViolin(svg, chartWrap, tooltip, chartPanel, s, summary, usable, level);
    } else {
      drawBars(svg, chartWrap, tooltip, chartPanel, s, summary, usable, letters, lsd, level);
    }
    renderTable(tableCard, summary, usable, letters);
  }

  // ---- puntos por réplica + mediana por grupo (alternativa a las barras ±SD/SE) ----
  function drawJitter(svg, chartWrap, tooltip, chartPanel, s, summary, groups, level) {
    const groupNames = groups.map((g) => g.key);
    const groupData = {};
    groups.forEach((g) => { groupData[g.key] = g.values; });
    const yTitle = t('recuentos.yAxis', { unit: s.mapping.alreadyLog ? (summary.valueName || t('recuentos.value')) : ('log₁₀ ' + (summary.valueName || t('recuentos.value'))) });
    const blockTitle = (s.label || t('recuentos.title')) + (level ? ' — ' + level : '');

    const { ceElements, paletteSeries, figureOptions, legendPositions, statsControls } = drawGroupStripPlot({
      svg, chartWrap, tooltip, groupNames, groupData,
      title: blockTitle, xTitle: summary.groupColNames.join(' × ') || t('recuentos.group'),
      yTitle, valueLabel: yTitle, valueDecimals: 3,
    });

    const blockKey = 'microbialCounts-jitter' + (level ? '-' + level : '');
    editors.push(attachChartEditor({
      key: blockKey, svg, mount: chartPanel,
      filename: t('recuentos.title') + '-' + (s.label || 'serie') + (level ? '-' + level : '') + '-jitter', lang: getLang(),
      elements: ceElements,
      paletteSeries, paletteType: 'categorical',
      statsControls, onStatsChange: () => paint(),
      figureOptions, onFigureOptionsChange: () => paint(),
      legendPositions: (legendPositions || []).map((p) => ({ ...p, label: legendPositionLabel(p.id, getLang()) })),
      onReset: () => paint(),
      startEditing: wasEditingAny,
    }));
  }

  // ---- violín: densidad KDE por grupo, misma escala de ancho entre grupos ----
  function drawViolin(svg, chartWrap, tooltip, chartPanel, s, summary, groups, level) {
    const groupNames = groups.map((g) => g.key);
    const groupData = {};
    groups.forEach((g) => { groupData[g.key] = g.values; });
    const yTitle = t('recuentos.yAxis', { unit: s.mapping.alreadyLog ? (summary.valueName || t('recuentos.value')) : ('log₁₀ ' + (summary.valueName || t('recuentos.value'))) });
    const blockTitle = (s.label || t('recuentos.title')) + (level ? ' — ' + level : '');

    const { ceElements, paletteSeries, figureOptions, legendPositions, statsControls, lowN } = drawGroupViolin({
      svg, chartWrap, tooltip, groupNames, groupData,
      title: blockTitle, xTitle: summary.groupColNames.join(' × ') || t('recuentos.group'),
      yTitle, valueLabel: yTitle, valueDecimals: 3,
    });

    if (lowN && lowN.length) {
      const p = document.createElement('p');
      p.className = 'ql-field-help';
      p.textContent = t('recuentos.violinLowN', { groups: lowN.join(', ') });
      chartPanel.appendChild(p);
    }

    const blockKey = 'microbialCounts-violin' + (level ? '-' + level : '');
    editors.push(attachChartEditor({
      key: blockKey, svg, mount: chartPanel,
      filename: t('recuentos.title') + '-' + (s.label || 'serie') + (level ? '-' + level : '') + '-violin', lang: getLang(),
      elements: ceElements,
      paletteSeries, paletteType: 'categorical',
      statsControls, onStatsChange: () => paint(),
      figureOptions, onFigureOptionsChange: () => paint(),
      legendPositions: (legendPositions || []).map((p) => ({ ...p, label: legendPositionLabel(p.id, getLang()) })),
      onReset: () => paint(),
      startEditing: wasEditingAny,
    }));
  }

  // ---- barras verticales + barra de error ----
  function drawBars(svg, chartWrap, tooltip, chartPanel, s, summary, groups, letters, lsd, level) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const err = (g) => (errBar === 'sd' ? g.sd : g.se);
    const tops = groups.map((g) => g.meanLog + err(g));
    const bots = groups.map((g) => g.meanLog - err(g));
    let yMax = Math.max(...tops);
    let yMin = Math.min(...bots, ...groups.map((g) => g.meanLog));
    // eje truncado (práctica habitual con datos en log): margen y redondeo
    const span = (yMax - yMin) || 1;
    yMax = Math.ceil((yMax + span * 0.12) * 2) / 2;
    yMin = Math.max(0, Math.floor((yMin - span * 0.12) * 2) / 2);
    if (yMax - yMin < 0.5) yMax = yMin + 0.5;
    // rango manual del eje Y (Ajustes > Estructura); por defecto el automático
    const blockKey = 'microbialCounts' + (level ? '-' + level : '');
    const autoY = [yMin, yMax];
    const so = getFigureOptions(blockKey);
    if (so.axisMin != null) yMin = so.axisMin;
    if (so.axisMax != null) yMax = so.axisMax;
    if (!(yMax > yMin)) { yMin = autoY[0]; yMax = autoY[1]; }

    const n = groups.length;
    const slotW = Math.max(70, Math.min(150, 620 / n));
    const marginL = 60, marginR = 20;
    const rowHeight = 26;
    // corchetes por pares (Paso 4): mismo fisherLSD.pairwise ya calculado
    // arriba, solo cambia el renderizado — sin recorte por umbral propio,
    // el `significant` de fisherLSD (alpha=0.05) ya decide qué par se ve.
    const bracketXPositions = groups.map((_, gi) => marginL + slotW * gi + slotW / 2);
    const sigPairs = (sigDisplay === 'brackets' && lsd)
      ? lsd.pairwise.filter((p) => p.significant).map((p) => ({ i: p.i, j: p.j, p: p.p }))
      : [];
    const bracketRows = sigPairs.length ? countBracketRows(sigPairs, bracketXPositions) : 0;
    const marginT = sigDisplay === 'brackets'
      ? (bracketRows ? 40 + (bracketRows - 1) * rowHeight + 24 : 40)
      : (letters ? 54 : 40);
    const longestLabel = Math.max(...groups.map((g) => g.key.length));
    const rotate = n > 4 || longestLabel > 12;
    const marginB = rotate ? 60 + Math.min(120, longestLabel * 5.2) : 70;
    const innerH = 340;
    const W = Math.max(marginL + marginR + slotW * n, 380);
    const H = marginT + innerH + marginB;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.style.width = W > 640 ? W + 'px' : '';
    svg.style.maxWidth = W > 640 ? 'none' : '';

    const yScale = (v) => marginT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

    // gridlines + ticks
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const v = yMin + (i / ticks) * (yMax - yMin);
      const y = yScale(v);
      svg.appendChild(svgEl('line', { x1: marginL, x2: W - marginR, y1: y, y2: y, class: 'ql-gridline' }));
      const tk = svgEl('text', { x: marginL - 8, y: y + 3, class: 'ql-tick-label', 'text-anchor': 'end' });
      tk.textContent = v.toFixed(2);
      svg.appendChild(tk);
    }
    svg.appendChild(svgEl('line', { x1: marginL, x2: marginL, y1: marginT, y2: marginT + innerH, class: 'ql-baseline-line' }));
    svg.appendChild(svgEl('line', { x1: marginL, x2: W - marginR, y1: marginT + innerH, y2: marginT + innerH, class: 'ql-baseline-line' }));

    const barW = Math.min(54, slotW * 0.56);
    // barras y barras de error recortadas al área de trazado (rango manual)
    const dataLayer = svgEl('g', { 'clip-path': plotClip(svg, 'ql-clip-recuentos', marginL, marginT, W - marginL - marginR, innerH) });
    svg.appendChild(dataLayer);
    groups.forEach((g, gi) => {
      const cx = marginL + slotW * gi + slotW / 2;
      const col = groupColor(gi);
      const yTop = yScale(g.meanLog);
      const yBase = yScale(yMin);
      const rect = svgEl('rect', {
        x: cx - barW / 2, y: yTop, width: barW, height: Math.max(1, yBase - yTop),
        fill: col, 'fill-opacity': 0.22, stroke: col, 'stroke-width': 1.5, rx: 3, 'data-ce-role': 'bar',
        'data-ce-series-fill': 's' + gi, 'data-ce-series-stroke': 's' + gi,
      });
      rect.addEventListener('mouseenter', () => {
        showTooltip(chartWrap, cx, yTop, g.key, [
          t('recuentos.ttMean') + ' = ' + fmt(g.meanLog, 3) + ' · n = ' + g.n,
          'SD = ' + fmt(g.sd, 3) + ' · SE = ' + fmt(g.se, 3),
        ], { svg, W, H, tooltip });
      });
      rect.addEventListener('mouseleave', () => hideTooltip(tooltip));
      dataLayer.appendChild(rect);

      // barra de error (solo si n >= 2 → SD/SE definidos)
      const e = err(g);
      let errTopY = yTop;
      if (g.n >= 2 && e > 0) {
        const yHi = yScale(g.meanLog + e), yLo = yScale(Math.max(yMin, g.meanLog - e));
        dataLayer.appendChild(svgEl('line', { x1: cx, x2: cx, y1: yHi, y2: yLo, class: 'ql-errorbar-line', stroke: 'var(--ink)', 'stroke-width': 1.5, 'data-ce-role': 'line' }));
        dataLayer.appendChild(svgEl('line', { x1: cx - 7, x2: cx + 7, y1: yHi, y2: yHi, class: 'ql-errorbar-line', stroke: 'var(--ink)', 'stroke-width': 1.5, 'data-ce-role': 'line' }));
        dataLayer.appendChild(svgEl('line', { x1: cx - 7, x2: cx + 7, y1: yLo, y2: yLo, class: 'ql-errorbar-line', stroke: 'var(--ink)', 'stroke-width': 1.5, 'data-ce-role': 'line' }));
        errTopY = yHi;
      }

      // letra de grupo homogéneo (ANOVA + LSD de Fisher): dos grupos que
      // comparten letra NO difieren significativamente entre sí. Alternativa
      // (Paso 4): corchetes por pares, dibujados una vez fuera de este bucle.
      if (sigDisplay === 'letters' && letters && letters[gi]) {
        const lt = svgEl('text', {
          x: cx, y: errTopY - 8, class: 'ql-letter-label', 'text-anchor': 'middle', 'font-weight': 700, 'font-size': 13, fill: 'var(--ink)',
        });
        lt.textContent = letters[gi];
        svg.appendChild(lt);
      }

      // etiqueta de grupo
      const ly = marginT + innerH + (rotate ? 14 : 20);
      const tx = svgEl('text', {
        x: cx, y: ly, class: 'ql-tick-label',
        'text-anchor': rotate ? 'end' : 'middle',
        transform: rotate ? 'rotate(-40 ' + cx + ' ' + ly + ')' : '',
      });
      tx.textContent = g.key.length > 28 ? g.key.slice(0, 27) + '…' : g.key;
      svg.appendChild(tx);
    });

    if (sigPairs.length) {
      drawSignificanceBrackets(svg, { pairs: sigPairs, xPositions: bracketXPositions, yTop: marginT - 16, rowHeight });
    }

    // título de eje Y
    const yT = svgEl('text', {
      x: 15, y: marginT + innerH / 2, class: 'ql-axis-label', 'text-anchor': 'middle',
      transform: 'rotate(-90 15 ' + (marginT + innerH / 2) + ')', 'data-ce': 'ytitle',
    });
    yT.textContent = t('recuentos.yAxis', { unit: s.mapping.alreadyLog ? (summary.valueName || t('recuentos.value')) : ('log₁₀ ' + (summary.valueName || t('recuentos.value'))) });
    svg.appendChild(yT);

    const xLabelBase = marginT + innerH + marginB - 30;
    const xT = svgEl('text', { x: marginL + (W - marginL - marginR) / 2, y: xLabelBase, class: 'ql-axis-label', 'text-anchor': 'middle', 'data-ce': 'xtitle' });
    xT.textContent = summary.groupColNames.join(' × ') || t('recuentos.group');
    svg.appendChild(xT);

    // leyenda: qué es la barra de error
    const legG = svgEl('g', { 'data-ce': 'legend' });
    legG.appendChild(svgEl('line', { x1: 0, x2: 0, y1: -6, y2: 6, stroke: 'var(--ink)', 'stroke-width': 1.5 }));
    legG.appendChild(svgEl('line', { x1: -5, x2: 5, y1: -6, y2: -6, stroke: 'var(--ink)', 'stroke-width': 1.5 }));
    legG.appendChild(svgEl('line', { x1: -5, x2: 5, y1: 6, y2: 6, stroke: 'var(--ink)', 'stroke-width': 1.5 }));
    const lt = svgEl('text', { x: 12, y: 4, class: 'ql-tick-label' });
    lt.textContent = errBar === 'sd' ? t('recuentos.legendSd') : t('recuentos.legendSe');
    legG.appendChild(lt);
    legG.setAttribute('transform', 'translate(' + (marginL + 8) + ',' + (marginT - 20) + ')');
    svg.appendChild(legG);

    const blockTitle = (s.label || t('recuentos.title')) + (level ? ' — ' + level : '');
    editors.push(attachChartEditor({
      key: blockKey, svg, mount: chartPanel,
      filename: t('recuentos.title') + '-' + (s.label || 'serie') + (level ? '-' + level : ''), lang: getLang(),
      elements: [
        { id: 'title', create: { text: blockTitle, x: W / 2, y: 22, anchor: 'middle', cls: 'ce-title' } },
        { id: 'xtitle', selector: '[data-ce="xtitle"]' },
        { id: 'ytitle', selector: '[data-ce="ytitle"]' },
        { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
        ...(sigPairs.length ? [{ id: 'sig', selector: '[data-ce="sig"]', kind: 'group' }] : []),
      ],
      paletteSeries: groups.map((g, i) => ({ id: 's' + i, label: g.key })),
      paletteType: 'categorical',
      figureOptions: { axis: { domain: autoY }, categoryOrder: true },
      onFigureOptionsChange: () => paint(),
      onReset: () => paint(),
      startEditing: wasEditingAny,
    }));
  }

  // ---- tabla alternativa (grupo, n, media log10, SD, SE) con aria-sort ----
  function renderTable(tableCard, summary, groups, letters) {
    const cols = [
      ['group', t('recuentos.colGroup')],
      ['n', 'n'],
      ['mean', t('recuentos.colMean')],
      ['sd', 'SD'],
      ['se', 'SE'],
      ...(letters ? [['letter', t('recuentos.colLetter')]] : []),
    ];
    const scrollDiv = document.createElement('div');
    scrollDiv.className = 'ql-table-scroll scroll-x';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table';
    let thead = '<thead><tr>';
    cols.forEach(([key, lbl]) => {
      const on = sort.key === key;
      thead += '<th aria-sort="' + (on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '">' +
        '<button type="button" data-sort="' + key + '">' + escapeHtml(lbl) +
        (on ? ' <span aria-hidden="true">' + (sort.dir === 'asc' ? '▲' : '▼') + '</span>' : '') + '</button></th>';
    });
    tbl.innerHTML = thead + '</tr></thead>';

    const rows = groups.map((g, i) => ({ group: g.key, n: g.n, mean: g.meanLog, sd: g.sd, se: g.se, letter: letters ? letters[i] : '' }));
    const dir = sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (typeof x === 'string') return x.localeCompare(y) * dir;
      return ((x || 0) - (y || 0)) * dir;
    });
    const tb = document.createElement('tbody');
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(r.group) + '</td>' +
        '<td class="ql-num tabular">' + r.n + '</td>' +
        '<td class="ql-num tabular">' + fmt(r.mean, 3) + '</td>' +
        '<td class="ql-num tabular">' + (r.n >= 2 ? fmt(r.sd, 3) : '—') + '</td>' +
        '<td class="ql-num tabular">' + (r.n >= 2 ? fmt(r.se, 3) : '—') + '</td>' +
        (letters ? '<td class="ql-num tabular mono">' + escapeHtml(r.letter || '—') + '</td>' : '');
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    scrollDiv.appendChild(tbl);
    tableCard.appendChild(scrollDiv);

    tbl.querySelectorAll('th button[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sort');
        if (sort.key === key) sort = { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
        else sort = { key, dir: key === 'group' ? 'asc' : 'desc' };
        paint();
      });
    });

    // descarga de ejemplos
    const dl = document.createElement('div');
    dl.style.marginTop = '16px';
    dl.appendChild(exampleDownloadBlock(['recuentosPlaca', 'recuentosNMP']));
    tableCard.appendChild(dl);
  }

  paint();
  const stop = subscribe(paint);
  return () => {
    stop(); editors.forEach((e) => e.destroy()); editors = [];
    if (calcCleanup) { calcCleanup(); calcCleanup = null; }
  };
}
