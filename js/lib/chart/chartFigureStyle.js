// chartFigureStyle.js — motor de variables CSS de rol (--fig-*): fuentes,
// rejilla, ejes, marcas; sección "Estilo de la figura" del panel.
//
// Parte del editor de figuras troceado desde js/lib/chartEditor.js (Fase 0b,
// sin cambios de comportamiento). Reparto y patrón `ctx`: js/lib/chart/chartEditor.js.

import { isValidHex } from '../paletteValidator.js';

export const FONTS = [
  ['var(--font-body)', 'Sans (IBM Plex)'],
  ['var(--font-display)', 'Serif (IBM Plex)'],
  ['var(--font-mono)', 'Mono (IBM Plex)'],
  ['system-ui, sans-serif', 'Sistema'],
  ['Georgia, "Times New Roman", serif', 'Serif del sistema'],
  ['ui-monospace, Menlo, monospace', 'Mono del sistema'],
];

// ---- motor de variables CSS de rol (--fig-*) — Paso 2 de
// qiimelab-prompt-editor-fase-0-fundamentos.md. Cada entrada: la variable
// CSS que escribe (con fallback ya puesto en css/components.css), de qué
// nodo de rol lee su valor por defecto (para prellenar el control) y qué
// propiedad computada leer. `kind` decide el tipo de control: 'color',
// 'number' (con min/max/step) o 'dash' (select de trazo).
const FIG_STYLE_VARS = [
  { id: 'gridColor', css: '--fig-grid-color', kind: 'color', role: '.ql-gridline', prop: 'stroke' },
  { id: 'gridWidth', css: '--fig-grid-width', kind: 'number', role: '.ql-gridline', prop: 'strokeWidth', min: 0.5, max: 3, step: 0.25 },
  { id: 'gridDash', css: '--fig-grid-dash', kind: 'dash' },
  { id: 'axisColor', css: '--fig-axis-color', kind: 'color', role: '.ql-baseline-line', prop: 'stroke' },
  { id: 'axisWidth', css: '--fig-axis-width', kind: 'number', role: '.ql-baseline-line', prop: 'strokeWidth', min: 0.5, max: 3, step: 0.25 },
  { id: 'tickColor', css: '--fig-tick-color', kind: 'color', role: '.ql-tick-label', prop: 'fill' },
  { id: 'tickSize', css: '--fig-tick-size', kind: 'number', role: '.ql-tick-label', prop: 'fontSize', min: 8, max: 16, step: 1, unit: 'px' },
  { id: 'axisTitleColor', css: '--fig-axis-title-color', kind: 'color', role: '.ql-axis-label', prop: 'fill' },
  { id: 'axisTitleSize', css: '--fig-axis-title-size', kind: 'number', role: '.ql-axis-label', prop: 'fontSize', min: 9, max: 18, step: 1, unit: 'px' },
  { id: 'font', css: '--fig-font', kind: 'font' },
  // Fase 4 (qiimelab-prompt-editor-fase-4-ejes-rejilla-leyenda-lienzo.md):
  // G5 mostrar/ocultar rejilla, G6 ocultar leyenda, G3 marco/fondo del
  // panel — las 3 son solo variables CSS de rol (nunca repintan), igual
  // que el resto de este motor; el color/grosor de rejilla/eje ya estaba.
  { id: 'gridVisible', css: '--fig-grid-opacity', kind: 'toggle' },
  { id: 'legendVisible', css: '--fig-legend-opacity', kind: 'toggle' },
  { id: 'pointsVisible', css: '--fig-points-opacity', kind: 'toggle' },
  { id: 'panelBorderColor', css: '--fig-panel-border-color', kind: 'color', role: '.ql-panel-border', prop: 'stroke' },
  { id: 'panelBorderWidth', css: '--fig-panel-border-width', kind: 'number', role: '.ql-panel-border', prop: 'strokeWidth', min: 0, max: 4, step: 0.5 },
  { id: 'panelBgColor', css: '--fig-panel-bg-color', kind: 'color', role: '.ql-panel-bg', prop: 'fill' },
];

export function createFigureStyle(ctx) {
  const { T, svg, toHex, writeStoreDebounced } = ctx;

  // ---- estilo de figura (motor de variables CSS de rol --fig-*) ----
  // Puro CSS custom properties sobre el propio <svg>: no repinta nada, así
  // que a diferencia de la paleta de series o la geometría no necesita
  // recalcular nada del gráfico — por eso no hay `cfg.onFigureStyleChange`.
  function figureStyleOverrides() { return ctx.store.__figureStyle || {}; }

  function applyFigureStyle() {
    const ov = figureStyleOverrides();
    FIG_STYLE_VARS.forEach((f) => {
      const v = ov[f.id];
      if (v === undefined || v === '') svg.style.removeProperty(f.css);
      else svg.style.setProperty(f.css, f.unit ? (v + f.unit) : String(v));
    });
    // tipografía global (Fase 1): la misma fuente en TODOS los textos de la
    // figura — títulos, ejes, leyenda, etiquetas —, por encima del estilo
    // propio de cada elemento (regla con !important en chartStyles.js)
    const gf = ov.globalFont;
    svg.classList.toggle('ce-global-font', !!gf);
    if (gf) svg.style.setProperty('--fig-global-font', gf);
    else svg.style.removeProperty('--fig-global-font');
  }

  function setFigureStyleValue(id, val) {
    const fs = (ctx.store.__figureStyle = ctx.store.__figureStyle || {});
    if (val === '' || val === undefined || val === null) delete fs[id];
    else fs[id] = val;
    if (!Object.keys(fs).length) delete ctx.store.__figureStyle;
    applyFigureStyle();
    writeStoreDebounced();
  }

  /** Valor por defecto para prellenar un control: lee el nodo de rol ya
   *  dibujado en el propio SVG (si existe) para no inventar un número que
   *  luego no coincida con lo que se ve — mismo principio que el color de
   *  serie en `effectiveSeriesColor`. */
  function figStyleDefault(f) {
    if (f.kind === 'font') {
      const node = svg.querySelector('.ql-tick-label, .ql-axis-label');
      return node ? getComputedStyle(node).fontFamily : '';
    }
    if (f.kind === 'dash') return 'none';
    if (f.kind === 'toggle') return true; // visible por defecto — 0 = oculto, el único valor que se persiste
    const node = f.role ? svg.querySelector(f.role) : null;
    if (!node) return f.kind === 'color' ? '#000000' : (f.min ?? 0);
    const cs = getComputedStyle(node);
    if (f.kind === 'color') return toHex(cs[f.prop]);
    return parseFloat(cs[f.prop]) || f.min;
  }

  function figStyleControl(id, ov, ariaLabel) {
    const f = FIG_STYLE_VARS.find((v) => v.id === id);
    const def = figStyleDefault(f);
    if (f.kind === 'toggle') {
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.checked = ov[id] !== 0;
      inp.setAttribute('aria-label', ariaLabel);
      inp.addEventListener('change', () => setFigureStyleValue(id, inp.checked ? '' : 0));
      return inp;
    }
    if (f.kind === 'color') {
      const current = ov[id] || def;
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.value = isValidHex(current) ? current : '#000000';
      inp.setAttribute('aria-label', ariaLabel);
      inp.addEventListener('input', () => setFigureStyleValue(id, inp.value));
      return inp;
    }
    if (f.kind === 'number') {
      const current = ov[id] !== undefined ? ov[id] : def;
      const inp = document.createElement('input');
      inp.type = 'number'; inp.className = 'tabular';
      inp.min = f.min; inp.max = f.max; inp.step = f.step;
      inp.value = current;
      inp.setAttribute('aria-label', ariaLabel);
      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v)) return;
        setFigureStyleValue(id, Math.max(f.min, Math.min(f.max, v)));
      });
      return inp;
    }
    // f.kind === 'dash'
    const current = ov[id] || def;
    const sel = document.createElement('select');
    [['none', T.dashSolid], ['2 2', T.dashDotted], ['4 4', T.dashDashed]].forEach(([val, label]) => {
      const o = document.createElement('option'); o.value = val; o.textContent = label;
      if (val === current) o.selected = true;
      sel.appendChild(o);
    });
    sel.setAttribute('aria-label', ariaLabel);
    sel.addEventListener('change', () => setFigureStyleValue(id, sel.value === 'none' ? '' : sel.value));
    return sel;
  }

  function fontSelect(id, current) {
    const sel = document.createElement('select');
    sel.id = id;
    FONTS.forEach(([val, label]) => {
      const o = document.createElement('option'); o.value = val; o.textContent = label;
      if (current === val) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }

  /** Fuente de ejes y marcas (--fig-font: .ql-tick-label/.ql-axis-label). */
  function figStyleFontRow(ov) {
    const row = document.createElement('div');
    row.className = 'ce-figstyle-row';
    const selId = 'ce-figstyle-font-' + (++ctx.cePanelUid);
    const lab = document.createElement('label');
    lab.setAttribute('for', selId);
    lab.textContent = T.axisFont;
    row.appendChild(lab);
    const def = figStyleDefault(FIG_STYLE_VARS.find((v) => v.id === 'font'));
    const sel = fontSelect(selId, ov.font || def);
    // con la tipografía global activa manda esa; este control no tendría efecto
    sel.disabled = !!ov.globalFont;
    if (ov.globalFont) sel.title = T.axisFontOverridden;
    sel.addEventListener('change', () => setFigureStyleValue('font', sel.value));
    row.appendChild(sel);
    return row;
  }

  /** Tipografía global: casilla + fuente, aplicada a todos los textos. */
  function figStyleGlobalFontRow(ov) {
    const row = document.createElement('div');
    row.className = 'ce-figstyle-row ce-globalfont-row';
    const chkId = 'ce-globalfont-' + (++ctx.cePanelUid);
    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.id = chkId; chk.checked = !!ov.globalFont;
    const lab = document.createElement('label');
    lab.setAttribute('for', chkId);
    lab.textContent = T.globalFontLabel;
    const controls = document.createElement('div');
    controls.className = 'ce-figstyle-controls';
    const def = figStyleDefault(FIG_STYLE_VARS.find((v) => v.id === 'font'));
    const sel = fontSelect('ce-globalfont-sel-' + ctx.cePanelUid, ov.globalFont || ov.font || def);
    sel.setAttribute('aria-label', T.globalFontSelect);
    sel.disabled = !chk.checked;
    chk.addEventListener('change', () => {
      sel.disabled = !chk.checked;
      setFigureStyleValue('globalFont', chk.checked ? sel.value : '');
    });
    sel.addEventListener('change', () => { if (chk.checked) setFigureStyleValue('globalFont', sel.value); });
    controls.appendChild(chk); controls.appendChild(sel);
    row.appendChild(lab); row.appendChild(controls);
    const help = document.createElement('p');
    help.className = 'ce-hint';
    help.textContent = T.globalFontHelp;
    const frag = document.createElement('div');
    frag.className = 'ce-globalfont';
    frag.appendChild(row); frag.appendChild(help);
    return frag;
  }

  function figStyleGroupRow(label, ids, ov) {
    const row = document.createElement('div');
    row.className = 'ce-figstyle-row';
    const lab = document.createElement('label');
    lab.textContent = label;
    row.appendChild(lab);
    const controls = document.createElement('div');
    controls.className = 'ce-figstyle-controls';
    ids.forEach((id) => {
      const suffix = id.endsWith('Color') ? T.color : id.endsWith('Dash') ? T.dashLabel : T.size;
      controls.appendChild(figStyleControl(id, ov, label + ' — ' + suffix));
    });
    row.appendChild(controls);
    return row;
  }

  function renderFigureStyleSection() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-figstyle';
    wrap.innerHTML = '<h5>' + T.figureStyleTitle + '</h5>';

    const rows = document.createElement('div');
    rows.className = 'ce-figstyle-rows';
    const ov = figureStyleOverrides();

    rows.appendChild(figStyleGlobalFontRow(ov));
    rows.appendChild(figStyleFontRow(ov));
    rows.appendChild(figStyleGroupRow(T.gridLabel, ['gridColor', 'gridWidth', 'gridDash'], ov));
    rows.appendChild(figStyleSingleRow(T.gridVisibleLabel, 'gridVisible', ov));
    rows.appendChild(figStyleGroupRow(T.axisLabel, ['axisColor', 'axisWidth'], ov));
    rows.appendChild(figStyleGroupRow(T.tickLabel, ['tickColor', 'tickSize'], ov));
    rows.appendChild(figStyleGroupRow(T.axisTitleLabel, ['axisTitleColor', 'axisTitleSize'], ov));
    rows.appendChild(figStyleSingleRow(T.legendVisibleLabel, 'legendVisible', ov));
    rows.appendChild(figStyleGroupRow(T.panelBorderLabel, ['panelBorderColor', 'panelBorderWidth'], ov));
    rows.appendChild(figStyleSingleRow(T.panelBgLabel, 'panelBgColor', ov));
    rows.appendChild(figStyleSingleRow(T.pointsVisibleLabel, 'pointsVisible', ov));

    wrap.appendChild(rows);
    return wrap;
  }

  /** Fila con un único control (toggle/color suelto) — mismo layout que
   *  figStyleGroupRow, pero sin varios controles agrupados bajo una misma
   *  etiqueta. Paso 4 (G5/G6/G3): mostrar/ocultar rejilla, ocultar leyenda,
   *  fondo del panel. */
  function figStyleSingleRow(label, id, ov) {
    const row = document.createElement('div');
    row.className = 'ce-figstyle-row';
    const rowId = 'ce-figstyle-' + id + '-' + (++ctx.cePanelUid);
    const lab = document.createElement('label');
    lab.setAttribute('for', rowId);
    lab.textContent = label;
    row.appendChild(lab);
    const controls = document.createElement('div');
    controls.className = 'ce-figstyle-controls';
    const ctl = figStyleControl(id, ov, label);
    ctl.id = rowId;
    controls.appendChild(ctl);
    row.appendChild(controls);
    return row;
  }

  return { applyFigureStyle, renderFigureStyleSection };
}
