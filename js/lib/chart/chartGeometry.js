// chartGeometry.js — geometría: sliders estructurales del módulo
// (cfg.geometrySliders), escala universal por roles (data-ce-role) y márgenes
// del lienzo (viewBox).
//
// Parte del editor de figuras troceado desde js/lib/chartEditor.js (Fase 0b,
// sin cambios de comportamiento). Reparto y patrón `ctx`: js/lib/chart/chartEditor.js.

export function createGeometry(ctx) {
  const { T, cfg, geometrySliders, svg, writeStoreDebounced } = ctx;

  // ---- geometría (parámetros estructurales que necesitan repintar) ----
  function geometryOverrides() { return ctx.store.__geometry || {}; }

  // ---- geometría universal por roles (data-ce-role) ----
  // Cualquier figura puede marcar sus elementos de datos con data-ce-role=
  // marker|line|bar|barh|cell y obtiene GRATIS los sliders de tamaño de punto,
  // grosor de línea, anchura de barra/caja y tamaño de celda: se escala cada
  // elemento respecto a su valor original (guardado la 1ª vez), sin recalcular
  // ni repintar la figura — a diferencia de geometrySliders (por módulo), que
  // sí pueden rehacer el layout.
  const GEO_SLIDERS = [
    { key: 'marker', roles: ['marker'], label: () => T.geoMarker, min: 0.4, max: 3, step: 0.1 },
    { key: 'line', roles: ['line'], label: () => T.geoLine, min: 0.4, max: 4, step: 0.1 },
    { key: 'bar', roles: ['bar', 'barh'], label: () => T.geoBar, min: 0.2, max: 1.6, step: 0.05 },
    { key: 'cell', roles: ['cell'], label: () => T.geoCell, min: 0.4, max: 1, step: 0.05 },
  ];
  const geoBase = new WeakMap();
  function geoRoleElems(role) { return Array.from(svg.querySelectorAll('[data-ce-role="' + role + '"]')); }
  function geoPresentSliders() { return GEO_SLIDERS.filter((g) => g.roles.some((r) => svg.querySelector('[data-ce-role="' + r + '"]'))); }
  function geoScaleOf(key) { const g = ctx.store.__geoScale || {}; return g[key] != null ? g[key] : 1; }
  function geoBaseOf(el) {
    let b = geoBase.get(el);
    if (!b) {
      const n = (a) => { const v = parseFloat(el.getAttribute(a)); return Number.isFinite(v) ? v : 0; };
      b = { r: n('r'), x: n('x'), y: n('y'), w: n('width'), h: n('height'), sw: parseFloat(el.getAttribute('stroke-width')) };
      if (!Number.isFinite(b.sw)) b.sw = parseFloat(getComputedStyle(el).strokeWidth) || 1;
      geoBase.set(el, b);
    }
    return b;
  }
  function applyGeoScale() {
    const has = ctx.store.__geoScale && Object.keys(ctx.store.__geoScale).length;
    // sin ajustes guardados y sin nada aplicado antes: no tocar el DOM
    if (!has && !svg.__ceGeoApplied) return;
    svg.__ceGeoApplied = !!has;
    geoRoleElems('marker').forEach((el) => { const b = geoBaseOf(el); el.setAttribute('r', String(+(b.r * geoScaleOf('marker')).toFixed(3))); });
    geoRoleElems('line').forEach((el) => {
      const k = geoScaleOf('line');
      if (k === 1) el.style.removeProperty('stroke-width'); else el.style.strokeWidth = String(+(geoBaseOf(el).sw * k).toFixed(3));
    });
    const kb = geoScaleOf('bar');
    geoRoleElems('bar').forEach((el) => { const b = geoBaseOf(el); const w = b.w * kb; el.setAttribute('width', String(+w.toFixed(3))); el.setAttribute('x', String(+(b.x + (b.w - w) / 2).toFixed(3))); });
    geoRoleElems('barh').forEach((el) => { const b = geoBaseOf(el); const h = b.h * kb; el.setAttribute('height', String(+h.toFixed(3))); el.setAttribute('y', String(+(b.y + (b.h - h) / 2).toFixed(3))); });
    const kc = geoScaleOf('cell');
    geoRoleElems('cell').forEach((el) => {
      const b = geoBaseOf(el); const w = b.w * kc, h = b.h * kc;
      el.setAttribute('width', String(+w.toFixed(3))); el.setAttribute('height', String(+h.toFixed(3)));
      el.setAttribute('x', String(+(b.x + (b.w - w) / 2).toFixed(3))); el.setAttribute('y', String(+(b.y + (b.h - h) / 2).toFixed(3)));
    });
  }
  function setGeoScale(key, v) {
    const g = (ctx.store.__geoScale = ctx.store.__geoScale || {});
    if (!Number.isFinite(v) || v === 1) delete g[key]; else g[key] = v;
    if (!Object.keys(g).length) delete ctx.store.__geoScale;
    applyGeoScale();
    writeStoreDebounced();
  }

  function setGeometryValue(id, val) {
    const geo = (ctx.store.__geometry = ctx.store.__geometry || {});
    geo[id] = val;
    writeStoreDebounced();
    if (cfg.onGeometryChange) try { cfg.onGeometryChange(id, val); } catch (e) { /* noop */ }
  }

  function renderGeometrySection() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-geometry';
    wrap.innerHTML = '<h5>' + (T.geometryTitle || 'Geometría') + '</h5>';

    const rows = document.createElement('div');
    rows.className = 'ce-geom-rows';
    const geo = geometryOverrides();

    geometrySliders.forEach((sl) => {
      const current = geo[sl.id] !== undefined ? geo[sl.id] : sl.value;
      const toDisplay = (v) => (sl.isPercent ? Math.round(v * 100) : v);
      const fromDisplay = (v) => (sl.isPercent ? v / 100 : v);
      const min = toDisplay(sl.min), max = toDisplay(sl.max), step = toDisplay(sl.step);
      const unit = sl.isPercent ? '%' : (sl.unit || '');

      const row = document.createElement('div');
      row.className = 'ce-geom-row';
      const rowId = 'ce-geom-' + (++ctx.cePanelUid);
      const lab = document.createElement('label');
      lab.setAttribute('for', rowId);
      lab.textContent = sl.label + (unit ? ' (' + unit + ')' : '');
      row.appendChild(lab);

      const inputRow = document.createElement('div');
      inputRow.className = 'ql-inputrow';
      const rangeInp = document.createElement('input');
      rangeInp.type = 'range'; rangeInp.id = rowId;
      rangeInp.min = min; rangeInp.max = max; rangeInp.step = step; rangeInp.value = toDisplay(current);
      const numInp = document.createElement('input');
      numInp.type = 'number'; numInp.className = 'tabular';
      numInp.min = min; numInp.max = max; numInp.step = step; numInp.value = toDisplay(current);

      const onSliderChange = (raw) => {
        const num = parseFloat(raw);
        if (Number.isNaN(num)) return;
        const clamped = Math.max(min, Math.min(max, num));
        rangeInp.value = clamped; numInp.value = clamped;
        setGeometryValue(sl.id, fromDisplay(clamped));
      };
      rangeInp.addEventListener('input', () => onSliderChange(rangeInp.value));
      numInp.addEventListener('change', () => onSliderChange(numInp.value));

      inputRow.appendChild(rangeInp);
      inputRow.appendChild(numInp);
      row.appendChild(inputRow);
      rows.appendChild(row);
    });

    // sliders universales por rol (ver GEO_SLIDERS)
    geoPresentSliders().forEach((g) => {
      const cur = geoScaleOf(g.key);
      const row = document.createElement('div');
      row.className = 'ce-geom-row';
      const rowId = 'ce-geom-' + (++ctx.cePanelUid);
      const lab = document.createElement('label');
      lab.setAttribute('for', rowId);
      lab.textContent = g.label() + ' (×)';
      row.appendChild(lab);
      const inputRow = document.createElement('div');
      inputRow.className = 'ql-inputrow';
      const rangeInp = document.createElement('input');
      rangeInp.type = 'range'; rangeInp.id = rowId;
      rangeInp.min = g.min; rangeInp.max = g.max; rangeInp.step = g.step; rangeInp.value = cur;
      const numInp = document.createElement('input');
      numInp.type = 'number'; numInp.className = 'tabular';
      numInp.min = g.min; numInp.max = g.max; numInp.step = g.step; numInp.value = cur;
      const onChange = (raw) => {
        const num = parseFloat(raw);
        if (Number.isNaN(num)) return;
        const v = Math.max(g.min, Math.min(g.max, num));
        rangeInp.value = v; numInp.value = v;
        setGeoScale(g.key, v);
      };
      rangeInp.addEventListener('input', () => onChange(rangeInp.value));
      numInp.addEventListener('change', () => onChange(numInp.value));
      inputRow.appendChild(rangeInp);
      inputRow.appendChild(numInp);
      row.appendChild(inputRow);
      rows.appendChild(row);
    });

    wrap.appendChild(rows);
    return wrap;
  }

  // Margen extra genérico: amplía el viewBox (lienzo) sin tocar el layout del
  // módulo. Si el módulo cambia el viewBox por su cuenta (p. ej. el aluvial
  // al redibujarse), se toma el nuevo como base.
  let vbLast = null, vbBase = null, vbBasePx = null;
  function applyCanvasMargins() {
    if (!ctx.structCfg.margins.generic) return;
    const cur = svg.getAttribute('viewBox');
    if (!cur) return;
    if (cur !== vbLast) {
      vbBase = cur;
      vbBasePx = /px$/.test(svg.style.width || '') ? parseFloat(svg.style.width) : null;
    }
    const m = (ctx.store.__structure || {}).marginExtra || {};
    const t = +m.top || 0, r = +m.right || 0, b = +m.bottom || 0, l = +m.left || 0;
    const [x, y, w, h] = vbBase.split(/[\s,]+/).map(Number);
    if (![x, y, w, h].every(Number.isFinite)) return;
    if (!(t || r || b || l)) {
      if (vbLast && cur === vbLast) { svg.setAttribute('viewBox', vbBase); if (vbBasePx != null) svg.style.width = vbBasePx + 'px'; vbLast = null; }
      return;
    }
    const next = [x - l, y - t, w + l + r, h + t + b].map((v) => +v.toFixed(2)).join(' ');
    svg.setAttribute('viewBox', next);
    vbLast = next;
    if (vbBasePx != null) svg.style.width = (vbBasePx * (w + l + r) / w).toFixed(1) + 'px';
  }

  return { applyCanvasMargins, applyGeoScale, geoPresentSliders, renderGeometrySection };
}
