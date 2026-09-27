// chartPresets.js — presets de estilo: los de usuario (localStorage) y los de
// revista (JOURNAL_PRESETS), más la sección "Presets" del panel.
//
// Parte del editor de figuras troceado desde js/lib/chartEditor.js (Fase 0b,
// sin cambios de comportamiento). Reparto y patrón `ctx`: js/lib/chart/chartEditor.js.

// ---- Presets (Fase 6, Paso 1 y 3 de qiimelab-prompt-editor-fase-6-
// presets-style-match-export-revista.md): un preset es "una foto del
// store" -- el mismo objeto que ya se guarda en
// localStorage['smart-175.chartStyle.'+key], más name/seriesOrder. Se
// guardan en una clave APARTE, compartida entre TODAS las gráficas (no
// por `key`), porque un preset debe poder aplicarse a cualquier gráfico. */
const PRESETS_LSKEY = 'smart-175.chartPresets';

/** Función pura, sin DOM -- mismo patrón que getPaletteOverrides/etc. */
export function readPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_LSKEY)) || {}; }
  catch (e) { return {}; }
}
function writePresets(all) {
  try {
    if (Object.keys(all).length) localStorage.setItem(PRESETS_LSKEY, JSON.stringify(all));
    else localStorage.removeItem(PRESETS_LSKEY);
  } catch (e) { /* modo privado */ }
}

const PT_TO_PX = 96 / 72; // 1pt = 4/3 px a 96dpi -- la tabla de la revista viene en pt, el motor --fig-* en px
const pt = (n) => Math.round(n * PT_TO_PX * 100) / 100;

/** Presets de revista (Paso 3): NO editables por el usuario -- reaplicar
 *  siempre vuelve a la especificación oficial exacta, así que no hace
 *  falta un "restablecer" aparte. Valores tomados de la tabla de
 *  `Claude outputs/estudio-editor-graficas-nivel-biorender.md` sección
 *  1.5 (rangos de la revista; se elige un valor concreto dentro de cada
 *  rango, documentado aquí en pt antes de convertir a px):
 *   - Nature: texto de cuerpo 7pt (rango 5-7), título de panel 8pt
 *     negrita, línea 0.5pt (rango 0.25-1), fuente Helvetica/Arial.
 *   - Cell: texto de cuerpo 7pt (rango 6-8), línea 1pt (rango 0.5-1.5),
 *     fuente Arial únicamente. */
function journalStyleBlock({ font, bodyPt, titlePt, linePt, widthMm }) {
  return {
    __figureStyle: { font, tickSize: pt(bodyPt), axisTitleSize: pt(bodyPt), gridWidth: pt(linePt), axisWidth: pt(linePt) },
    __export: { widthMm },
    title: { size: pt(titlePt), bold: true, font },
  };
}
export const JOURNAL_PRESETS = {
  nature89: { id: 'nature89', builtin: true, journal: 'nature', widthMm: 89, store: journalStyleBlock({ font: 'Helvetica, Arial, sans-serif', bodyPt: 7, titlePt: 8, linePt: 0.5, widthMm: 89 }) },
  nature183: { id: 'nature183', builtin: true, journal: 'nature', widthMm: 183, store: journalStyleBlock({ font: 'Helvetica, Arial, sans-serif', bodyPt: 7, titlePt: 8, linePt: 0.5, widthMm: 183 }) },
  cell85: { id: 'cell85', builtin: true, journal: 'cell', widthMm: 85, store: journalStyleBlock({ font: 'Arial, sans-serif', bodyPt: 7, titlePt: 8, linePt: 1, widthMm: 85 }) },
  cell114: { id: 'cell114', builtin: true, journal: 'cell', widthMm: 114, store: journalStyleBlock({ font: 'Arial, sans-serif', bodyPt: 7, titlePt: 8, linePt: 1, widthMm: 114 }) },
  cell174: { id: 'cell174', builtin: true, journal: 'cell', widthMm: 174, store: journalStyleBlock({ font: 'Arial, sans-serif', bodyPt: 7, titlePt: 8, linePt: 1, widthMm: 174 }) },
};

export function createPresets(ctx) {
  const {
    T, getExportWidthMm, paletteSeries, renderToolbar, setExportWidthMm, sync, writeStore,
  } = ctx;

  // ---- Presets (Fase 6 Paso 1/3): aplicar es sobreescribir `store` con el
  // contenido del preset (remapeando __palette por POSICIÓN si el nº de
  // series no coincide) y llamar a writeStore()+sync() -- cero código de
  // bajo nivel nuevo, reutiliza exactamente lo que ya existe para leer/
  // escribir `store`. ----
  function applyPresetSnapshot(preset) {
    const cloned = JSON.parse(JSON.stringify(preset.store || {}));
    if (cloned.__palette) {
      const order = Array.isArray(preset.seriesOrder) ? preset.seriesOrder : Object.keys(cloned.__palette);
      const newPal = {};
      if (paletteSeries.length) {
        const n = Math.min(order.length, paletteSeries.length);
        for (let i = 0; i < n; i++) {
          const oldId = order[i], newId = paletteSeries[i].id;
          if (cloned.__palette[oldId] !== undefined) newPal[newId] = cloned.__palette[oldId];
        }
      }
      if (Object.keys(newPal).length) cloned.__palette = newPal; else delete cloned.__palette;
    }
    ctx.store = cloned;
    writeStore();
    sync();
  }

  function savePresetAs(name) {
    if (!name || !name.trim()) return;
    const all = readPresets();
    const id = 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    all[id] = {
      id, name: name.trim(), builtin: false, savedAt: Date.now(),
      seriesOrder: paletteSeries.map((s) => s.id),
      store: JSON.parse(JSON.stringify(ctx.store)),
    };
    writePresets(all);
    renderToolbar();
  }

  function deleteUserPreset(id) {
    const all = readPresets();
    delete all[id];
    writePresets(all);
    renderToolbar();
  }

  function renderPresetsSection() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-presets ce-colorscale'; // reutiliza el estilo de sección de "Escala de color"/"Estructura"
    wrap.innerHTML = '<h5>' + T.presetsTitle + '</h5>';

    // ancho de exportación
    const widthRow = document.createElement('div');
    widthRow.className = 'ce-cs-row';
    const widthId = 'ce-exportwidth-' + (++ctx.cePanelUid);
    const widthLab = document.createElement('label');
    widthLab.setAttribute('for', widthId);
    widthLab.textContent = T.exportWidthLabel;
    const widthInp = document.createElement('input');
    widthInp.type = 'number'; widthInp.id = widthId; widthInp.min = '10'; widthInp.max = '400'; widthInp.step = '1';
    widthInp.value = getExportWidthMm() || '';
    widthInp.addEventListener('change', () => setExportWidthMm(parseFloat(widthInp.value) || null));
    widthRow.appendChild(widthLab); widthRow.appendChild(widthInp);
    wrap.appendChild(widthRow);
    const widthHelp = document.createElement('p');
    widthHelp.className = 'ce-hint';
    widthHelp.textContent = T.exportWidthHelp;
    wrap.appendChild(widthHelp);

    // guardar preset actual
    const saveRow = document.createElement('div');
    saveRow.className = 'ce-cs-row';
    const nameInp = document.createElement('input');
    nameInp.type = 'text'; nameInp.placeholder = T.presetNamePlaceholder; nameInp.setAttribute('aria-label', T.presetSaveLabel);
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button'; saveBtn.className = 'ql-btn';
    saveBtn.textContent = T.presetSaveBtn;
    saveBtn.addEventListener('click', () => { savePresetAs(nameInp.value); nameInp.value = ''; });
    saveRow.appendChild(nameInp); saveRow.appendChild(saveBtn);
    wrap.appendChild(saveRow);

    // presets del usuario
    const userPresets = Object.values(readPresets()).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    if (!userPresets.length) {
      const noneP = document.createElement('p');
      noneP.className = 'ce-hint';
      noneP.textContent = T.presetNone;
      wrap.appendChild(noneP);
    } else {
      userPresets.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'ce-cs-row';
        const lab = document.createElement('span');
        lab.textContent = p.name;
        lab.style.flex = '1 1 auto';
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button'; applyBtn.className = 'ql-btn';
        applyBtn.textContent = T.presetApplyBtn;
        applyBtn.addEventListener('click', () => applyPresetSnapshot(p));
        const delBtn = document.createElement('button');
        delBtn.type = 'button'; delBtn.className = 'ql-btn ql-btn-ghost';
        delBtn.textContent = T.presetDeleteBtn;
        delBtn.setAttribute('aria-label', T.presetDeleteBtn + ': ' + p.name);
        delBtn.addEventListener('click', () => deleteUserPreset(p.id));
        row.appendChild(lab); row.appendChild(applyBtn); row.appendChild(delBtn);
        wrap.appendChild(row);
      });
    }

    // presets de revista (Paso 3): no editables, reaplicar siempre vuelve a
    // la especificación oficial
    const journalH5 = document.createElement('h5');
    journalH5.textContent = T.presetJournalTitle;
    wrap.appendChild(journalH5);
    const journalHelp = document.createElement('p');
    journalHelp.className = 'ce-hint';
    journalHelp.textContent = T.presetJournalHelp;
    wrap.appendChild(journalHelp);
    const journalRow = document.createElement('div');
    journalRow.className = 'ce-cs-row';
    Object.values(JOURNAL_PRESETS).forEach((jp) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ql-btn';
      b.textContent = (jp.journal === 'nature' ? T.presetNatureLabel : T.presetCellLabel)(jp.widthMm);
      b.addEventListener('click', () => applyPresetSnapshot(jp));
      journalRow.appendChild(b);
    });
    wrap.appendChild(journalRow);

    return wrap;
  }

  return { renderPresetsSection };
}
