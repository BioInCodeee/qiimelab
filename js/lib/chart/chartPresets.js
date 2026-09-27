// chartPresets.js — presets de estilo propios del usuario (localStorage,
// globales: se aplican a cualquier gráfico) y la sección "Presets" del panel.
// Los presets de revista (Nature/Cell) se retiraron en la Fase 1.
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

export function createPresets(ctx) {
  const { T, paletteSeries, renderToolbar, sync, writeStore } = ctx;

  // ---- Presets (Fase 6 Paso 1): aplicar es sobreescribir `store` con el
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

    const help = document.createElement('p');
    help.className = 'ce-hint';
    help.textContent = T.presetHelp;
    wrap.appendChild(help);

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

    return wrap;
  }

  return { renderPresetsSection };
}
