// chartStyles.js — hoja de estilos del editor (inyectada una vez), iconos SVG
// de la barra y el namespace SVG compartido.
//
// Parte del editor de figuras troceado desde js/lib/chartEditor.js (Fase 0b,
// sin cambios de comportamiento). Reparto y patrón `ctx`: js/lib/chart/chartEditor.js.

export const NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'ce-styles';

// iconos propios, mismo estilo que la barra lateral (24×24, trazo 1.7, redondeado)
// aria-hidden/focusable="false": son decorativos, el <span> del botón lleva el texto.
export const CE_ICONS = {
  edit: '<svg aria-hidden="true" focusable="false" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.4 3.6a2 2 0 0 1 2.9 2.9L7.5 18.3 3.5 19.5l1.2-4Z"/></svg>',
  download: '<svg aria-hidden="true" focusable="false" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10m0 0-3.5-3.5M12 14l3.5-3.5"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>',
  reset: '<svg aria-hidden="true" focusable="false" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9a8 8 0 1 1-1.5 4.5"/><path d="M3.5 4.5v4.8h4.8"/></svg>',
  fullscreen: '<svg aria-hidden="true" focusable="false" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M9 20H5a1 1 0 0 1-1-1v-4M15 20h4a1 1 0 0 0 1-1v-4"/></svg>',
};

export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
.ce-toolbar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:14px; padding-top:14px; border-top:1px solid var(--border-strong); }
.ce-toolbar .ce-lead { font-size:12px; color:var(--ink-2); flex:1 1 100%; margin:0 0 4px; }
.ce-toolbar .ce-lead strong { color:var(--ink); font-weight:600; }
.ce-download { display:inline-flex; align-items:center; gap:6px; }
.ce-download .ce-export-format { width:auto; min-width:0; }
/* tipografía global: manda sobre la fuente propia de cada texto (Fase 1) */
svg.ce-global-font text, svg.ce-global-font tspan { font-family:var(--fig-global-font) !important; }
.ce-globalfont .ce-hint { margin:0 0 4px; }
/* panel único (Fase 1): dos bloques, "Datos y estructura" y "Apariencia" */
.ce-group { flex:1 1 100%; display:flex; flex-wrap:wrap; gap:8px; align-items:flex-start; margin-top:12px; padding:10px 12px 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface); }
.ce-group-title { flex:1 1 100%; margin:0; font-size:12.5px; font-weight:600; color:var(--ink); }
.ce-group-hint { flex:1 1 100%; margin:0 0 2px; }
.ce-group > :nth-child(3) { margin-top:0; padding-top:0; border-top:0; }
.ce-toolbar .ce-hint { font-size:11.5px; color:var(--ink-muted); flex:1 1 100%; margin:2px 0 0; }
.ce-toolbar button { display:inline-flex; align-items:center; gap:6px; }
.ce-toolbar button svg { flex:none; }
.ce-toolbar .ce-cta { border-color:var(--accent); color:var(--accent); background:var(--accent-soft); }
.ce-toolbar .ce-cta:hover { border-color:var(--accent); background:color-mix(in srgb, var(--accent) 18%, var(--surface)); }
svg.ce-editing { }
svg.ce-editing .ce-el { cursor: move; }
.ce-outline { fill:none; stroke:var(--accent); stroke-width:1; stroke-dasharray:4 3; pointer-events:none; opacity:0; transition:opacity .1s ease; }
svg.ce-editing .ce-el:hover .ce-outline, svg.ce-editing .ce-el.ce-selected .ce-outline { opacity:1; }
svg.ce-editing .ce-el.ce-selected .ce-outline { stroke-width:1.4; stroke-dasharray:none; }
.ce-hit { fill:transparent; pointer-events:none; }
svg.ce-editing .ce-hit { pointer-events:all; cursor:move; }
svg.ce-editing .ce-hit:focus { outline:none; }
svg.ce-editing .ce-hit:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.ce-panel {
  position:fixed; z-index:60; width:230px; background:var(--surface); color:var(--ink);
  border:1px solid var(--border-strong); border-radius:var(--radius-md); box-shadow:var(--shadow);
  padding:12px; font-family:var(--font-body); font-size:12.5px;
}
.ce-panel h4 { margin:0 0 8px; font-family:var(--font-body); font-size:12px; font-weight:600; color:var(--ink-2); display:flex; justify-content:space-between; align-items:center; }
.ce-panel h4 button { border:none; background:none; cursor:pointer; color:var(--ink-muted); font-size:15px; line-height:1; padding:0 2px; }
.ce-row { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
.ce-row:last-child { margin-bottom:0; }
.ce-row label { flex:0 0 52px; color:var(--ink-muted); font-size:11.5px; }
.ce-row input[type=color] { width:34px; height:26px; padding:0; border:1px solid var(--border); border-radius:5px; background:none; cursor:pointer; }
.ce-row input[type=number] { width:64px; }
.ce-row select { flex:1; }
.ce-toggles { display:flex; gap:6px; }
.ce-toggles button {
  flex:1; border:1px solid var(--border-strong); background:var(--surface); color:var(--ink-2);
  border-radius:6px; padding:5px 0; cursor:pointer; font-size:12px;
}
.ce-toggles button.on { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
.ce-toolbar .ce-on { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
text.ce-title { font-family:var(--font-display); font-size:15px; font-weight:600; fill:var(--ink); }
.ce-hexfield { width:76px; font-family:var(--font-mono); text-transform:uppercase; }
.ce-titles-section { flex:1 1 100%; margin-top:10px; padding-top:10px; border-top:1px solid var(--border); }
.ce-titles-section h5 { margin:0 0 8px; font-size:11.5px; font-weight:600; color:var(--ink-2); }
.ce-titles-rows { display:flex; flex-direction:column; gap:6px; max-width:480px; }
.ce-title-row { display:flex; align-items:center; gap:8px; }
.ce-title-row label { flex:0 0 130px; font-size:12px; font-weight:500; color:var(--ink-2); }
.ce-title-row input[type=text] { flex:1; min-width:180px; height:26px; padding:2px 8px; font-size:12px; border:1px solid var(--border-strong); border-radius:4px; background:var(--surface); color:var(--ink); }
.ce-palette { flex:1 1 100%; margin-top:10px; padding-top:10px; border-top:1px solid var(--border); }
.ce-palette h5 { margin:0 0 8px; font-size:11.5px; font-weight:600; color:var(--ink-2); }
.ce-pal-chooser { margin-bottom:10px; }
.ce-pal-chooser-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.ce-pal-chooser-row label { font-size:12px; color:var(--ink-2); }
.ce-pal-chooser-row select { flex:1; min-width:160px; }
.ce-pal-chooser-row button { border:1px solid var(--border-strong); background:var(--surface); color:var(--ink-2); border-radius:6px; padding:5px 10px; cursor:pointer; font-size:12px; }
.ce-pal-chooser-row button:hover { border-color:var(--accent); color:var(--ink); }
.ce-pal-preview { margin-top:6px; }
.ce-pal-swatchbar { display:flex; }
.ce-pal-swatchbar span { display:block; width:8px; height:14px; }
.ce-pal-rows { display:flex; flex-direction:column; gap:10px; max-width:480px; }
.ce-pal-row-block { border:1px solid var(--border); border-radius:6px; padding:8px; display:flex; flex-direction:column; gap:6px; }
.ce-pal-row-head { display:flex; align-items:center; gap:8px; }
.ce-pal-row-head label { flex:1 1 auto; font-size:12px; font-weight:500; color:var(--ink-2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ce-pal-row-head select { flex:none; width:auto; min-width:96px; }
.ce-pal-row-fill, .ce-pal-opacity { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.ce-pal-solid, .ce-pal-gradient, .ce-pal-pattern { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.ce-pal-row-fill input[type=color], .ce-pal-border-body input[type=color] { width:28px; height:24px; padding:0; border:1px solid var(--border); border-radius:5px; background:none; cursor:pointer; flex:none; }
.ce-pal-row-fill input[type=text] { flex:0 0 84px; }
.ce-pal-row-fill input[type=number], .ce-pal-border-body input[type=number] { width:56px; flex:none; }
.ce-pal-row-fill select { flex:none; width:auto; min-width:110px; }
.ce-pal-grad-stops { display:flex; gap:4px; }
.ce-pal-pat-num { display:flex; align-items:center; gap:4px; }
.ce-pal-pat-num label { font-size:11px; color:var(--ink-muted); }
.ce-pal-opacity input[type=range] { flex:0 1 80px; min-width:50px; }
.ce-pal-op-val { flex:none; width:34px; font-size:11px; color:var(--ink-muted); font-family:var(--font-mono); }
.ce-pal-border { font-size:12px; }
.ce-pal-border summary { cursor:pointer; color:var(--ink-2); font-size:11.5px; }
.ce-pal-border-body { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:6px; }
.ce-pal-border-row { display:flex; align-items:center; gap:6px; }
.ce-pal-border-row label { font-size:11px; color:var(--ink-muted); }
.ce-pal-warn { font-size:11px; color:#8a5a00; margin:0; }
.ce-pal-safen { font-size:11px; color:var(--ink-muted); margin:2px 0 0; }
.ce-pal-safen:empty { display:none; }
.ce-geometry { flex:1 1 100%; margin-top:10px; padding-top:10px; border-top:1px solid var(--border); }
.ce-geometry h5 { margin:0 0 8px; font-size:11.5px; font-weight:600; color:var(--ink-2); }
.ce-geom-rows { display:flex; flex-direction:column; gap:8px; max-width:420px; }
.ce-geom-row { display:flex; align-items:center; gap:8px; }
.ce-geom-row label { flex:0 0 auto; min-width:150px; font-size:12px; color:var(--ink-2); }
.ce-geom-row .ql-inputrow { display:flex; align-items:center; gap:8px; flex:1; }
.ce-geom-row input[type=range] { flex:1; min-width:0; }
.ce-geom-row input[type=number] { width:64px; flex:none; }
.ce-stats { flex:1 1 100%; margin-top:10px; padding-top:10px; border-top:1px solid var(--border); }
.ce-stats h5 { margin:0 0 8px; font-size:11.5px; font-weight:600; color:var(--ink-2); }
.ce-stats-rows { display:flex; flex-direction:column; gap:8px; max-width:420px; }
.ce-stats-row { display:flex; align-items:center; gap:8px; }
.ce-stats-row label { flex:0 0 auto; min-width:150px; font-size:12px; color:var(--ink-2); }
.ce-stats-row select { flex:1; min-width:0; }
.ce-stats-diagnostic { font-size:11.5px; color:var(--ink-2); line-height:1.4; background:var(--page); border:1px solid var(--border); border-radius:6px; padding:8px 10px; }
.ce-stats-row input[type=number] { width:72px; flex:none; }
.ce-colorscale { flex:1 1 100%; margin-top:10px; padding-top:10px; border-top:1px solid var(--border); }
.ce-colorscale h5 { margin:0 0 8px; font-size:11.5px; font-weight:600; color:var(--ink-2); }
.ce-cs-rows { display:flex; flex-direction:column; gap:8px; max-width:420px; }
.ce-cs-row { display:flex; align-items:center; gap:8px; }
.ce-cs-row label { flex:0 0 auto; min-width:150px; font-size:12px; color:var(--ink-2); }
.ce-cs-row select { flex:1; min-width:0; }
.ce-cs-row input[type=number] { width:72px; flex:none; }
.ce-cs-row input[type=text] { flex:1; min-width:120px; height:26px; padding:2px 8px; font-size:12px; border:1px solid var(--border-strong); border-radius:4px; background:var(--surface); color:var(--ink); }
.ce-presets .ce-cs-row { margin-bottom:6px; flex-wrap:wrap; }
.ce-presets .ce-cs-row span { font-size:12px; color:var(--ink-2); }
.ce-presets .ce-cs-row label { min-width:0; }
.ce-cs-domain { display:flex; align-items:center; gap:6px; flex:1; flex-wrap:wrap; }
.ce-cs-domain button { border:1px solid var(--border-strong); background:var(--surface); color:var(--ink-2); border-radius:6px; padding:4px 8px; cursor:pointer; font-size:11.5px; }
.ce-cs-domain button:hover { border-color:var(--accent); color:var(--ink); }
.ce-figstyle { flex:1 1 100%; margin-top:10px; padding-top:10px; border-top:1px solid var(--border); }
.ce-figstyle h5 { margin:0 0 8px; font-size:11.5px; font-weight:600; color:var(--ink-2); }
.ce-figstyle-rows { display:flex; flex-direction:column; gap:8px; max-width:480px; }
.ce-figstyle-row { display:flex; align-items:center; gap:8px; }
.ce-figstyle-row label { flex:0 0 auto; min-width:110px; font-size:12px; color:var(--ink-2); }
.ce-figstyle-row select { flex:1; min-width:0; }
.ce-figstyle-controls { display:flex; align-items:center; gap:6px; flex:1; flex-wrap:wrap; }
.ce-figstyle-controls input[type=color] { width:28px; height:24px; padding:0; border:1px solid var(--border); border-radius:5px; background:none; cursor:pointer; flex:none; }
.ce-figstyle-controls input[type=number] { width:56px; flex:none; }
.ce-figstyle-controls select { flex:none; width:auto; min-width:96px; }
.ce-fs-stage { display:flex; flex-direction:column; gap:14px; }
.ce-fs-svgwrap { flex:1 1 auto; min-height:0; display:flex; align-items:center; justify-content:center; overflow:auto; background:var(--page); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px; }
.ce-fs-svgwrap svg.ce-fs-svg { width:100% !important; height:auto !important; max-height:calc(100vh - 260px); }
.ce-fs-stage .ce-toolbar { flex:none; margin-top:0; padding-top:14px; }
`;
  document.head.appendChild(s);
}
