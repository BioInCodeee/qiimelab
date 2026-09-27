// chartColorScale.js — sección "Escala de color" de los heatmaps con
// degradado continuo (paleta, dominio, punto medio, valor en celda).
//
// Parte del editor de figuras troceado desde js/lib/chartEditor.js (Fase 0b,
// sin cambios de comportamiento). Reparto y patrón `ctx`: js/lib/chart/chartEditor.js.

import { palettesForType } from '../palettes.js';
import { isValidHex } from '../paletteValidator.js';

export function createColorScale(ctx) {
  const { T, cfg, colorScaleCfg, writeStore } = ctx;

  // ---- escala de color continua (Paso 3 de qiimelab-prompt-editor-fase-3-
  // heatmaps-escalas-continuas.md) — igual que estadística: un cambio aquí
  // obliga a RECALCULAR el color de cada celda con js/lib/colorScale.js
  // (repintado completo, justificado a diferencia del motor --fig-*, que
  // nunca repinta), así que se resuelve entero en cfg.onColorScaleChange.
  function colorScaleOverrides() { return ctx.store.__colorScale || {}; }

  function setColorScaleValue(id, val) {
    const s = (ctx.store.__colorScale = ctx.store.__colorScale || {});
    if (val === '' || val === undefined || val === null) delete s[id]; else s[id] = val;
    if (!Object.keys(s).length) delete ctx.store.__colorScale;
    writeStore();
    if (cfg.onColorScaleChange) try { cfg.onColorScaleChange(ctx.store.__colorScale || {}); } catch (e) { /* noop */ }
  }

  function colorScaleRow(labelText, controlEl) {
    const row = document.createElement('div');
    row.className = 'ce-cs-row';
    const id = 'ce-cs-' + (++ctx.cePanelUid);
    const lab = document.createElement('label');
    lab.setAttribute('for', id);
    lab.textContent = labelText;
    row.appendChild(lab);
    controlEl.id = id;
    row.appendChild(controlEl);
    return row;
  }

  function renderColorScaleSection() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-colorscale';
    wrap.innerHTML = '<h5>' + T.colorScaleTitle + '</h5>';

    const rows = document.createElement('div');
    rows.className = 'ce-cs-rows';
    const s = colorScaleOverrides();
    const csType = colorScaleCfg.type === 'divergent' ? 'divergent' : 'sequential';
    const defaultPaletteId = colorScaleCfg.defaultPaletteId || ('app:' + csType);
    const currentPaletteId = s.paletteId || defaultPaletteId;

    // paleta — reutiliza el catálogo/desplegable de la Fase 2
    // (palettesForType) con la lista COMPLETA de paradas de cada paleta
    // (no solo 2-3 polos): colorScale.js interpola tantas paradas como
    // traiga la paleta elegida, así que una de 11 (viridis, RdBu…) se
    // aprovecha entera, no solo su primer/último tono.
    const paletteSel = document.createElement('select');
    palettesForType(csType).forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.isDefault ? (csType === 'divergent' ? T.paletteDivergent : T.paletteSequential) + ' — ' + T.paletteAppDefault : p.name;
      if (p.id === currentPaletteId) o.selected = true;
      paletteSel.appendChild(o);
    });
    paletteSel.addEventListener('change', () => setColorScaleValue('paletteId', paletteSel.value === defaultPaletteId ? '' : paletteSel.value));
    rows.appendChild(colorScaleRow(T.csPalette, paletteSel));

    // dominio min/max — por defecto el rango real de los datos que trae
    // `colorScaleCfg.domain` (recalculado por el módulo en cada pintado);
    // "restablecer" borra el override entero de una vez, no min y max por
    // separado (evita quedarse con solo uno de los dos personalizado sin
    // querer).
    const [dataMin, dataMax] = colorScaleCfg.domain || [0, 1];
    const domainWrap = document.createElement('div');
    domainWrap.className = 'ce-cs-domain';
    const minInp = document.createElement('input');
    minInp.type = 'number'; minInp.step = 'any'; minInp.value = s.domainMin != null ? s.domainMin : dataMin;
    minInp.setAttribute('aria-label', T.csDomainMin);
    minInp.addEventListener('change', () => { const v = parseFloat(minInp.value); if (Number.isFinite(v)) setColorScaleValue('domainMin', v); });
    const maxInp = document.createElement('input');
    maxInp.type = 'number'; maxInp.step = 'any'; maxInp.value = s.domainMax != null ? s.domainMax : dataMax;
    maxInp.setAttribute('aria-label', T.csDomainMax);
    maxInp.addEventListener('change', () => { const v = parseFloat(maxInp.value); if (Number.isFinite(v)) setColorScaleValue('domainMax', v); });
    domainWrap.appendChild(minInp);
    domainWrap.appendChild(maxInp);
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button'; resetBtn.className = 'ql-btn ql-btn-ghost'; resetBtn.textContent = T.csResetDomain;
    resetBtn.addEventListener('click', () => {
      const s2 = (ctx.store.__colorScale = ctx.store.__colorScale || {});
      delete s2.domainMin; delete s2.domainMax;
      if (!Object.keys(s2).length) delete ctx.store.__colorScale;
      writeStore();
      if (cfg.onColorScaleChange) try { cfg.onColorScaleChange(ctx.store.__colorScale || {}); } catch (e) { /* noop */ }
    });
    domainWrap.appendChild(resetBtn);
    rows.appendChild(colorScaleRow(T.csDomain, domainWrap));

    if (csType === 'divergent') {
      const midInp = document.createElement('input');
      midInp.type = 'number'; midInp.step = 'any';
      const defMid = colorScaleCfg.defaultMidpoint != null ? colorScaleCfg.defaultMidpoint : 0;
      midInp.value = s.midpoint != null ? s.midpoint : defMid;
      midInp.addEventListener('change', () => {
        const v = parseFloat(midInp.value);
        if (Number.isFinite(v)) setColorScaleValue('midpoint', v === defMid ? '' : v);
      });
      rows.appendChild(colorScaleRow(T.csMidpoint, midInp));
    }

    const stepsInp = document.createElement('input');
    stepsInp.type = 'number'; stepsInp.min = '0'; stepsInp.max = '20'; stepsInp.step = '1';
    stepsInp.value = s.steps != null ? s.steps : 0;
    stepsInp.addEventListener('change', () => {
      const v = parseInt(stepsInp.value, 10);
      if (!Number.isFinite(v)) return;
      setColorScaleValue('steps', Math.max(0, Math.min(20, v)) || '');
    });
    rows.appendChild(colorScaleRow(T.csSteps, stepsInp));

    const invertChk = document.createElement('input');
    invertChk.type = 'checkbox'; invertChk.checked = !!s.invert;
    invertChk.addEventListener('change', () => setColorScaleValue('invert', invertChk.checked ? true : ''));
    rows.appendChild(colorScaleRow(T.csInvert, invertChk));

    // ---- controles de celda (Paso 4 de qiimelab-prompt-editor-fase-3-
    // heatmaps-escalas-continuas.md) — universales para los 3 heatmaps,
    // aunque el valor por defecto de "valor en celda" lo decide cada
    // módulo (`colorScaleCfg.defaultShowValue`: correlograma/diferencial ya
    // lo dibujaban siempre, así que su valor por defecto es true; beta no
    // lo dibujaba, así que el suyo es false — el prompt pide "mostrar/
    // ocultar" en los 3, no "añadir solo a beta").
    const defShowVal = colorScaleCfg.defaultShowValue !== false;
    const showValChk = document.createElement('input');
    showValChk.type = 'checkbox';
    showValChk.checked = s.showValue != null ? s.showValue : defShowVal;
    showValChk.addEventListener('change', () => setColorScaleValue('showValue', showValChk.checked === defShowVal ? '' : showValChk.checked));
    rows.appendChild(colorScaleRow(T.csShowValue, showValChk));

    const cb = s.cellBorder || null;
    const borderWrap = document.createElement('div');
    borderWrap.className = 'ce-cs-domain'; // mismo layout de fila con varios controles
    const borderChk = document.createElement('input');
    borderChk.type = 'checkbox'; borderChk.checked = !!cb;
    borderChk.setAttribute('aria-label', T.csCellBorder);
    const bColorInp = document.createElement('input');
    bColorInp.type = 'color'; bColorInp.value = isValidHex(cb && cb.color) ? cb.color : '#000000';
    bColorInp.disabled = !borderChk.checked;
    bColorInp.setAttribute('aria-label', T.paletteBorderColor);
    const bWidthInp = document.createElement('input');
    bWidthInp.type = 'number'; bWidthInp.min = '0.5'; bWidthInp.max = '6'; bWidthInp.step = '0.5';
    bWidthInp.value = cb && cb.width != null ? cb.width : 1;
    bWidthInp.disabled = !borderChk.checked;
    bWidthInp.setAttribute('aria-label', T.paletteBorderWidth);
    const commitBorder = () => {
      bColorInp.disabled = !borderChk.checked;
      bWidthInp.disabled = !borderChk.checked;
      if (!borderChk.checked) { setColorScaleValue('cellBorder', ''); return; }
      const w = parseFloat(bWidthInp.value);
      setColorScaleValue('cellBorder', { color: bColorInp.value, width: Number.isFinite(w) ? Math.max(0.5, Math.min(6, w)) : 1 });
    };
    borderChk.addEventListener('change', commitBorder);
    bColorInp.addEventListener('change', commitBorder);
    bWidthInp.addEventListener('change', commitBorder);
    borderWrap.appendChild(borderChk);
    borderWrap.appendChild(bColorInp);
    borderWrap.appendChild(bWidthInp);
    rows.appendChild(colorScaleRow(T.csCellBorder, borderWrap));

    wrap.appendChild(rows);
    return wrap;
  }

  return { renderColorScaleSection };
}
