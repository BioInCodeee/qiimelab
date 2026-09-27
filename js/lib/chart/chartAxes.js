// chartAxes.js — sección "Estructura": rango y escala log de los ejes, orden
// de categorías, rejilla menor y márgenes.
//
// Parte del editor de figuras troceado desde js/lib/chartEditor.js (Fase 0b,
// sin cambios de comportamiento). Reparto y patrón `ctx`: js/lib/chart/chartEditor.js.

export function createAxes(ctx) {
  const { T, applyCanvasMargins, cfg, figureOptionsCfg, writeStore } = ctx;

  // ---- estructura del gráfico (Fase 4: eje G4, orden de categorías G4,
  // rejilla menor G5, márgenes G3 — qiimelab-prompt-editor-fase-4-ejes-
  // rejilla-leyenda-lienzo.md) — a diferencia del motor --fig-* (Fase 0,
  // nunca repinta) estos SÍ cambian geometría/orden de los datos, así que
  // se resuelven en cfg.onFigureOptionsChange (mismo patrón que
  // onStatsChange/onColorScaleChange: el módulo vuelve a pintar entero).
  function structureOverrides() { return ctx.store.__structure || {}; }

  // Configuración EFECTIVA de "Estructura": la que pasa el módulo o, si no
  // pasa ninguna, una mínima con solo el margen genérico del lienzo — así
  // TODA figura tiene la sección. `axis` es el eje Y (o el único eje) y
  // `axisX` el eje horizontal cuando el gráfico tiene dos ejes numéricos.
  const structCfg = (() => {
    const c = figureOptionsCfg || {};
    return {
      axis: c.axis || false, axisX: c.axisX || false,
      categoryOrder: !!c.categoryOrder, gridMinor: !!c.gridMinor,
      margins: c.margins || { generic: true, base: { top: 0, right: 0, bottom: 0, left: 0 } },
    };
  })();

  function setStructureValue(id, val) {
    const s = (ctx.store.__structure = ctx.store.__structure || {});
    if (val === '' || val === undefined || val === null) delete s[id]; else s[id] = val;
    if (!Object.keys(s).length) delete ctx.store.__structure;
    writeStore();
    if (structCfg.margins.generic && id === 'marginExtra') { applyCanvasMargins(); return; }
    if (cfg.onFigureOptionsChange) try { cfg.onFigureOptionsChange(ctx.store.__structure || {}); } catch (e) { /* noop */ }
  }

  function structureRow(labelText, controlEl) {
    const row = document.createElement('div');
    row.className = 'ce-cs-row'; // mismo layout que la sección de escala de color
    const id = 'ce-struct-' + (++ctx.cePanelUid);
    const lab = document.createElement('label');
    lab.setAttribute('for', id);
    lab.textContent = labelText;
    row.appendChild(lab);
    controlEl.id = id;
    row.appendChild(controlEl);
    return row;
  }

  function renderStructureSection() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-colorscale'; // reutiliza el mismo estilo de sección que "Escala de color"
    wrap.innerHTML = '<h5>' + T.structureTitle + '</h5>';

    const rows = document.createElement('div');
    rows.className = 'ce-cs-rows';
    const s = structureOverrides();

    // dos ejes numéricos (X e Y) o uno solo; con los dos, cada fila lleva su letra
    const axisRows = (axCfg, kMin, kMax, kLog, label, labelLog) => {
      const [dMin, dMax] = axCfg.domain || [0, 1];
      const domainWrap = document.createElement('div');
      domainWrap.className = 'ce-cs-domain';
      const minInp = document.createElement('input');
      minInp.type = 'number'; minInp.step = 'any'; minInp.value = s[kMin] != null ? s[kMin] : dMin;
      minInp.setAttribute('aria-label', T.csDomainMin);
      minInp.addEventListener('change', () => { const v = parseFloat(minInp.value); if (Number.isFinite(v)) setStructureValue(kMin, v); });
      const maxInp = document.createElement('input');
      maxInp.type = 'number'; maxInp.step = 'any'; maxInp.value = s[kMax] != null ? s[kMax] : dMax;
      maxInp.setAttribute('aria-label', T.csDomainMax);
      maxInp.addEventListener('change', () => { const v = parseFloat(maxInp.value); if (Number.isFinite(v)) setStructureValue(kMax, v); });
      domainWrap.appendChild(minInp);
      domainWrap.appendChild(maxInp);
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button'; resetBtn.className = 'ql-btn ql-btn-ghost'; resetBtn.textContent = T.csResetDomain;
      resetBtn.addEventListener('click', () => {
        const s2 = (ctx.store.__structure = ctx.store.__structure || {});
        delete s2[kMin]; delete s2[kMax];
        if (!Object.keys(s2).length) delete ctx.store.__structure;
        writeStore();
        if (cfg.onFigureOptionsChange) try { cfg.onFigureOptionsChange(ctx.store.__structure || {}); } catch (e) { /* noop */ }
      });
      domainWrap.appendChild(resetBtn);
      rows.appendChild(structureRow(label, domainWrap));
      if (axCfg.log) {
        const logChk = document.createElement('input');
        logChk.type = 'checkbox'; logChk.checked = !!s[kLog];
        logChk.addEventListener('change', () => setStructureValue(kLog, logChk.checked ? true : ''));
        rows.appendChild(structureRow(labelLog, logChk));
      }
    };
    const twoAxes = !!(structCfg.axis && structCfg.axisX);
    if (structCfg.axisX) axisRows(structCfg.axisX, 'axisXMin', 'axisXMax', 'axisXLog', twoAxes ? T.axisDomainX : T.axisDomain, twoAxes ? T.axisLogX : T.axisLog);
    if (structCfg.axis) axisRows(structCfg.axis, 'axisMin', 'axisMax', 'axisLog', twoAxes ? T.axisDomainY : T.axisDomain, twoAxes ? T.axisLogY : T.axisLog);

    if (structCfg.categoryOrder) {
      const sel = document.createElement('select');
      [
        ['original', T.orderOriginal], ['alpha-asc', T.orderAlphaAsc], ['alpha-desc', T.orderAlphaDesc],
        ['value-asc', T.orderValueAsc], ['value-desc', T.orderValueDesc],
      ].forEach(([val, label]) => {
        const o = document.createElement('option'); o.value = val; o.textContent = label;
        if ((s.categoryOrder || 'original') === val) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => setStructureValue('categoryOrder', sel.value === 'original' ? '' : sel.value));
      rows.appendChild(structureRow(T.categoryOrderLabel, sel));
    }

    if (structCfg.gridMinor) {
      const chk = document.createElement('input');
      chk.type = 'checkbox'; chk.checked = !!s.gridMinor;
      chk.addEventListener('change', () => setStructureValue('gridMinor', chk.checked ? true : ''));
      rows.appendChild(structureRow(T.gridMinorLabel, chk));
    }

    if (structCfg.margins) {
      const base = structCfg.margins.base || { top: 0, right: 0, bottom: 0, left: 0 };
      const m = s.marginExtra || {};
      const marginWrap = document.createElement('div');
      marginWrap.className = 'ce-cs-domain';
      ['top', 'right', 'bottom', 'left'].forEach((side) => {
        const inp = document.createElement('input');
        inp.type = 'number'; inp.step = '1'; inp.min = '-' + base[side]; inp.max = '200';
        inp.value = m[side] != null ? m[side] : 0;
        inp.setAttribute('aria-label', T.marginSide(side));
        inp.addEventListener('change', () => {
          const v = parseFloat(inp.value);
          if (!Number.isFinite(v)) return;
          const m2 = { ...(structureOverrides().marginExtra || {}) };
          if (v === 0) delete m2[side]; else m2[side] = v;
          setStructureValue('marginExtra', Object.keys(m2).length ? m2 : '');
        });
        marginWrap.appendChild(inp);
      });
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button'; resetBtn.className = 'ql-btn ql-btn-ghost'; resetBtn.textContent = T.csResetDomain;
      resetBtn.addEventListener('click', () => setStructureValue('marginExtra', ''));
      marginWrap.appendChild(resetBtn);
      rows.appendChild(structureRow(structCfg.margins.generic ? T.marginsGenericLabel : T.marginsLabel, marginWrap));
    }

    wrap.appendChild(rows);
    return wrap;
  }

  return { renderStructureSection, structCfg };
}
