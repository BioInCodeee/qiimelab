// chartEditor.js — motor de personalización de figuras, compartido por los
// módulos de gráficos.
//
// Qué hace:
//  - Modo "Personalizar" (botón). Con él apagado no interfiere en nada.
//  - Arrastra con el ratón SOLO elementos de texto/anotación (título de la
//    figura, títulos de eje, bloque de leyenda). Los marcadores de datos
//    (puntos, barras, líneas) NO se mueven nunca.
//  - Panel flotante por elemento: color de texto, familia de fuente (las 3
//    ya cargadas + genéricas del sistema), negrita/cursiva, tamaño.
//  - Persistencia en localStorage por módulo (smart-175.chartStyle.<key>),
//    re-aplicada al recargar. Botón "Restablecer".
//  - Sección "Estilo de la figura": motor de variables CSS de rol (--fig-*,
//    ver css/components.css) para rejilla/eje/marcas/título de eje/fuente.
//    Solo variables CSS con fallback al tema actual — no repinta nada, así
//    que a diferencia de la paleta o la geometría no hace falta cfg por
//    módulo: aparece en las ~28 vistas en cuanto usan las clases de rol
//    (.ql-gridline/.ql-baseline-line/.ql-tick-label/.ql-axis-label).
//  - "Descargar SVG/PNG/TIFF" (attachChartEditor): pasan por
//    js/lib/figureExport.js (Paso 3 de qiimelab-prompt-editor-fase-0-
//    fundamentos.md) — resuelven SIEMPRE en esquema claro (legible con
//    independencia del tema activo) y sin var()/color() residual (el bug de
//    color-mix() en mapas de calor/degradados). PNG/TIFF llevan dpi real
//    embebido (300 por defecto). `openChartEditor` (legacy, ver más abajo)
//    sigue con el pipeline antiguo (serializeSvg/exportSvg/exportPng): no
//    se le ha portado el arreglo por no ganar casos de uso nuevos.
//
//  - "Descargar SVG" (openChartEditor, legacy): exporta la figura tal cual
//    se ve, con los estilos inline resueltos (sin depender de la hoja de
//    estilos de la app).
//
//  - Paleta de color para las SERIES de datos (no solo el texto): botones de
//    paleta completa (categórica/secuencial/divergente) + una fila por serie
//    con swatch nativo + campo de texto #RRGGBB, con aviso suave (no
//    bloqueante) si el color chocaría con otro de la misma figura. Dos
//    mecanismos según el tipo de gráfico (ver cfg.paletteSeries más abajo):
//    directo por atributo `data-ce-series-fill/-stroke="<id>"` en los nodos
//    ya dibujados (sin repintar — la mayoría de gráficos: barras, cajas,
//    puntos, dímeros…), o lectura de `getPaletteOverrides(key)` ANTES de
//    calcular colores, para las figuras con degradado continuo (mapas de
//    calor, matriz de correlación) que sí necesitan repintar al cambiar.
//
// Sin dependencias, sin build step. No toca datos ni escalas.
//
// DECISIÓN DE ARQUITECTURA (22 sep 2026, ver Claude outputs/estudio-editor-
// graficas-nivel-biorender.md sección 2 y qiimelab-prompt-editor-fase-0-
// fundamentos.md Paso 1): este archivo tenía dos vías de edición no
// unificadas. `attachChartEditor` (abajo) es ahora la ÚNICA vía — la usan
// las ~28 vistas de gráfico de la app. `openChartEditor` (modal aparte con
// pestañas geometría/tipografía/colores, más abajo en el archivo) queda
// documentado como LEGACY: se retiró su único uso (el diagrama aluvial de
// taxaBarplot.js) en favor de `attachChartEditor` + `cfg.geometrySliders`
// (nueva sección "Geometría" del panel, mismo patrón que la paleta y los
// títulos). No se ha borrado el código de `openChartEditor` todavía —
// queda como referencia/red de seguridad un tiempo — pero no debe ganar
// ningún caso de uso nuevo; cualquier control nuevo va en `attachChartEditor`.
//
// ESTRUCTURA (Fase 0b, 27 sep 2026): este archivo solo orquesta. El código
// vive troceado en js/lib/chart/ (un archivo por sección del editor) y
// js/lib/chartEditor.js es una fachada de una línea que re-exporta desde
// aquí, así que ningún módulo cambia su import:
//   chartEditor.js      attachChartEditor: estado de la instancia, barra de
//                       herramientas, títulos, pantalla completa, reset, init
//   chartElements.js    elementos editables, arrastre y panel de estilo
//   chartColors.js      paleta de series · chartSeriesStyle.js  sus controles
//   chartColorScale.js  escala de color   · chartStats.js       estadística
//   chartAxes.js        estructura/ejes   · chartGeometry.js    geometría/márgenes
//   chartFigureStyle.js --fig-*/fuentes   · chartPresets.js     presets/revistas
//   chartExport.js      descargas         · chartState.js       lectura persistida
//   chartI18n.js · chartStyles.js · chartLegacyDialog.js (openChartEditor)
// Cada sección es una fábrica `createX(ctx)` que se invoca una vez por
// instancia; ver el comentario de `ctx` dentro de attachChartEditor.

import { openPanel as openModalPanel } from '../modal.js';
import { tr } from './chartI18n.js';
import { CE_ICONS, injectStyles } from './chartStyles.js';
import { createColors } from './chartColors.js';
import { createSeriesStyle } from './chartSeriesStyle.js';
import { createGeometry } from './chartGeometry.js';
import { createStats } from './chartStats.js';
import { createColorScale } from './chartColorScale.js';
import { createAxes } from './chartAxes.js';
import { createFigureStyle } from './chartFigureStyle.js';
import { createElements } from './chartElements.js';
import { createExport } from './chartExport.js';
import { createPresets } from './chartPresets.js';

// API pública (la misma que exponía el chartEditor.js de un solo archivo)
export {
  getPaletteOverrides, getFigureOptions, getFigureGeometry, getFigureStyle, getStatsOptions,
  getColorScaleOptions,
} from './chartState.js';
export { readPresets, JOURNAL_PRESETS } from './chartPresets.js';
export { sanitizeFilename, inlineComputedStyles, serializeSvg, exportSvg, exportPng } from './chartExport.js';
export { openChartEditor } from './chartLegacyDialog.js';

/**
 * @param {object} cfg
 * @param {string} cfg.key      clave de módulo (localStorage smart-175.chartStyle.<key>)
 * @param {SVGSVGElement} cfg.svg
 * @param {HTMLElement} cfg.mount   dónde se cuelga la barra de herramientas
 * @param {string} cfg.filename     nombre del .svg exportado
 * @param {Array}  cfg.elements     [{ id, selector?, create?, kind? }]
 *        - selector: CSS para encontrar el nodo dentro del svg (se re-busca en cada sync)
 *        - create:   { text, x, y, anchor, cls } para crear un <text> si no existe
 *        - kind:     'text' (def.) | 'group' (aplica estilo a los <text> descendientes)
 * @param {string} [cfg.lang]
 * @param {Function} [cfg.onChange]  se llama tras cualquier cambio persistido
 * @param {Array}  [cfg.geometrySliders]  [{ id, label, min, max, step, value,
 *        unit?, isPercent? }] — parámetros estructurales que SÍ necesitan
 *        recalcular geometría (p. ej. ancho de nodo de un aluvial) y por
 *        tanto no pueden ser una simple variable CSS. `value` es el valor
 *        por defecto si no hay nada persistido; leer el efectivo con
 *        `getFigureGeometry(key)` antes del primer pintado. Cada cambio se
 *        persiste en `store.__geometry[id]` y dispara `cfg.onGeometryChange`.
 * @param {Function} [cfg.onGeometryChange]  (id, value) — el módulo debe
 *        repintar con el nuevo valor (mismo patrón que `onReset`/`onChange`,
 *        pero con el dato: no hay forma de inferirlo solo del DOM).
 * @param {object} [cfg.statsControls]  { hasMultiGroup } — activa la sección
 *        "Significación estadística" (Paso 3 de qiimelab-prompt-editor-
 *        fase-1-anotaciones-estadisticas.md): modo asteriscos/p-exacto,
 *        estilo Prism, umbral, método de ajuste (solo con hasMultiGroup,
 *        ≥3 grupos — con 2 no hay comparaciones múltiples que ajustar).
 * @param {Function} [cfg.onStatsChange]  se llama tras persistir un cambio
 *        en las opciones de estadística — el módulo debe repintar entero
 *        (recalcula qué pares son significativos), mismo patrón que `onReset`.
 * @param {object} [cfg.colorScale]  { type: 'sequential'|'divergent',
 *        domain: [min,max] (el rango REAL de los datos en este pintado, para
 *        el botón "restablecer" y como valor por defecto), defaultPaletteId?
 *        (id de js/lib/palettes.js — 'app:sequential'/'app:divergent' si se
 *        omite), defaultMidpoint? (solo divergent, 0 si se omite),
 *        defaultShowValue? (Paso 4: si el módulo ya dibuja el valor en cada
 *        celda sin necesidad de tocar nada — correlograma/diferencial lo
 *        dejan implícito true; beta lo pone a false) } — activa
 *        la sección "Escala de color" (Paso 3 de qiimelab-prompt-editor-
 *        fase-3-heatmaps-escalas-continuas.md), para los 3 heatmaps con
 *        degradado continuo (beta/correlograma/diferencial). El módulo debe
 *        leer `getColorScaleOptions(key)` ANTES de construir su
 *        `makeColorScale()` (js/lib/colorScale.js) — mismo patrón que
 *        `getStatsOptions`/`getPaletteOverrides`.
 * @param {Function} [cfg.onColorScaleChange]  se llama tras persistir un
 *        cambio de escala — el módulo repinta entero (cambia el color de
 *        CADA celda, a diferencia del motor --fig-* que nunca repinta).
 * @param {boolean} [cfg.startEditing]  arranca ya en modo "Personalizar" —
 *        para cuando `onReset`/`onColorScaleChange`/etc. destruyen y vuelven
 *        a crear la instancia entera: pasar `editorAnterior.isEditing()`
 *        aquí para no cerrar el panel en cada repintado disparado desde
 *        dentro del propio editor.
 * @param {object} [cfg.figureOptions]  Fase 4 (qiimelab-prompt-editor-fase-
 *        4-ejes-rejilla-leyenda-lienzo.md), activa la sección "Estructura":
 *        { axis: false|{domain:[min,max], log?:boolean}, categoryOrder:
 *        false|true, gridMinor: false|true, margins:
 *        false|{base:{top,right,bottom,left}} }. El módulo lee
 *        `getFigureOptions(key)` ANTES de calcular su layout (igual que
 *        `getStatsOptions`/`getPaletteOverrides`).
 * @param {Function} [cfg.onFigureOptionsChange]  se llama tras persistir un
 *        cambio estructural — el módulo repinta entero (cambia orden/
 *        rango/márgenes, no solo estilo).
 * @param {Array} [cfg.legendPositions]  [{id, label, dx, dy}] posiciones
 *        predefinidas para el elemento 'legend' (Paso 4 G6) — aparecen como
 *        botones en su panel de estilo, además de poder seguir
 *        arrastrándose libremente. `dx`/`dy` son ABSOLUTOS (mismo sistema
 *        que ya usa el arrastre), no relativos a la posición actual.
 */
// Foco pendiente tras un repintado "de recálculo" (estadística/escala de
// color/estructura): esas secciones fuerzan cfg.onStatsChange/
// onColorScaleChange/... -> paint() del módulo -> destroy() de esta
// instancia + attachChartEditor() de cero, así que el <select>/<input> que
// el usuario acababa de tocar deja de existir a mitad de la interacción y
// el foco cae a <body>. Para alguien navegando por teclado (o simplemente
// mirando el anillo de foco) eso se siente como si "Personalizar" se
// hubiera cerrado, aunque el panel siga abierto. Module-scope a propósito:
// la instancia VIEJA es quien captura el foco (vía 'focusin' en su propio
// toolbar) justo antes de autodestruirse, y es la instancia NUEVA quien lo
// consume al arrancar — no hay ninguna instancia común entre ambas.
let pendingRefocusRef = null;
export function attachChartEditor(cfg) {
  injectStyles();
  const { key, svg, mount, filename = 'figura', elements = [] } = cfg;
  const paletteSeries = cfg.paletteSeries || []; // [{ id, label }] — series de datos recoloreables
  const paletteType = cfg.paletteType || 'categorical'; // qué botones de paleta ofrecer
  const paletteMax = cfg.paletteMax; // tope de tonos simultáneos (scatter/red: 3-4, no los 8)
  const geometrySliders = cfg.geometrySliders || []; // [{ id, label, min, max, step, value, unit?, isPercent? }]
  const statsControls = cfg.statsControls || null; // { hasMultiGroup } | null (sección desactivada)
  const colorScaleCfg = cfg.colorScale || null; // { type, domain, defaultPaletteId?, defaultMidpoint? } | null
  // Fase 4 (qiimelab-prompt-editor-fase-4-ejes-rejilla-leyenda-lienzo.md):
  // { axis: false|{domain:[min,max], log?:bool}, categoryOrder: false|true,
  //   gridMinor: false|true, margins: false|true } — cada clave activa (o
  //   no) su propia subsección; el módulo lee getFigureOptions(key) al
  //   pintar y decide qué hacer con cada campo, aquí solo se activa/
  //   desactiva la UI correspondiente.
  const figureOptionsCfg = cfg.figureOptions || null;
  const lang = cfg.lang || 'es';
  const T = tr(lang);
  const LSKEY = 'smart-175.chartStyle.' + key;
  const LEGACY_LSKEY = 'qiimelab.chartStyle.' + key;

  // Contexto compartido con las secciones (js/lib/chart/*.js). Cada fábrica
  // createX(ctx) destructura al empezar lo que ya existe y no cambia (cfg,
  // svg, T, funciones del núcleo, exports de secciones creadas antes). El
  // estado MUTABLE compartido (store, editing, selectedId, panel,
  // cePanelUid) vive solo en ctx y se lee/escribe siempre como ctx.x, y las
  // funciones de una sección creada DESPUÉS se llaman como ctx.fn() (se
  // resuelven al ejecutarse, no al crearse). register() publica en ctx lo
  // que exporta cada sección.
  const ctx = {
    T, cfg, colorScaleCfg, elements, figureOptionsCfg, filename, geometrySliders, key, lang,
    paletteMax, paletteSeries, paletteType, renderToolbar, st, statsControls, svg,
    writeStore, writeStoreDebounced,
  };
  function register(api) { Object.assign(ctx, api); return api; }

  ctx.store = readStore();
  // startEditing: para módulos cuyo paint() destruye y vuelve a crear el
  // editor en cada repintado (el patrón `if (editor) editor.destroy();
  // editor = attachChartEditor(...)` que usan los 3 heatmaps de la Fase 3 y
  // varias otras vistas para onReset) — sin esto, cada cambio que dispara un
  // repintado completo (cambiar la escala de color, "Restablecer"…) cierra
  // el panel "Personalizar" de golpe porque la NUEVA instancia siempre
  // arrancaba con editing=false, perdiendo el estado de la anterior. El
  // módulo debe leer `editor.isEditing()` ANTES de destruir la instancia
  // vieja y pasarlo aquí.
  // Dos paneles exclusivos: 'edit' (Personalizar: títulos, estilo, paleta,
  // presets — lo que se ARRASTRA y se ve) y 'settings' (rueda Ajustes:
  // estructura, geometría, estadística, escala de color — lo que RECALCULA
  // la figura). startEditing acepta true|'edit'|'settings'; isEditing()
  // devuelve el modo ('edit'|'settings') o false, así que los módulos que
  // hacen `startEditing: editor.isEditing()` conservan cuál estaba abierto.
  ctx.editing = !!cfg.startEditing && cfg.startEditing !== 'settings';
  let settingsOpen = cfg.startEditing === 'settings';
  ctx.selectedId = null;
  ctx.panel = null;
  ctx.cePanelUid = 0; // ids para enlazar <label for> ↔ control dentro del panel
  const wraps = new Map(); // id -> { wrap, inner, def }
  let fsHandle = null; // { close } del modal de pantalla completa, si está abierto

  Object.assign(ctx, { wraps });
  const { renderPaletteSection } = register(createColors(ctx));
  register(createSeriesStyle(ctx));
  const { geoPresentSliders, renderGeometrySection } = register(createGeometry(ctx));
  const { renderStatsSection } = register(createStats(ctx));
  const { renderColorScaleSection } = register(createColorScale(ctx));
  const { renderStructureSection } = register(createAxes(ctx));
  const { renderFigureStyleSection } = register(createFigureStyle(ctx));
  const {
    closePanel, decorate, onDocDown, onKey, sync, syncSelection,
  } = register(createElements(ctx));
  const { downloadPng, downloadSvg, downloadTiff, serialize } = register(createExport(ctx));
  const { renderPresetsSection } = register(createPresets(ctx));

  function readStore() {
    try {
      const raw = localStorage.getItem(LSKEY) || localStorage.getItem(LEGACY_LSKEY);
      return JSON.parse(raw) || {};
    }
    catch (e) { return {}; }
  }
  function writeStore() {
    try {
      if (Object.keys(ctx.store).length) {
        localStorage.setItem(LSKEY, JSON.stringify(ctx.store));
        localStorage.removeItem(LEGACY_LSKEY);
      } else {
        localStorage.removeItem(LSKEY);
        localStorage.removeItem(LEGACY_LSKEY);
      }
    } catch (e) { /* modo privado */ }
    if (cfg.onChange) try { cfg.onChange(); } catch (e) { /* noop */ }
    renderToolbar();
    // ver la nota de `pendingRefocusRef` más arriba — este renderToolbar()
    // de aquí es el que de verdad rompe el foco en el caso más común
    // (`onStatsChange`/`onColorScaleChange` que NO destruye el editor
    // entero, p. ej. el atajo `recolorCells()` de beta): reconstruye el
    // <select>/<input> que el usuario acaba de tocar sin que
    // cfg.onStatsChange/onColorScaleChange lleguen a intervenir. Sin
    // limpiar pendingRefocusRef aquí a propósito: si además el módulo SÍ
    // destruye y recrea el editor entero (grupo/alfa/funcional/...), la
    // llamada de más abajo (init de attachChartEditor) necesita la misma
    // referencia para completar el aterrizaje final.
    if (pendingRefocusRef) restoreFocusRef(pendingRefocusRef);
  }
  function st(id) { return (ctx.store[id] = ctx.store[id] || {}); }

  // ---- barra de herramientas ----
  const toolbar = document.createElement('div');
  toolbar.className = 'ce-toolbar';
  mount.appendChild(toolbar);

  // ver la nota de arquitectura junto a `let pendingRefocusRef` más arriba.
  // Clases de las secciones que SÍ pueden repintarse enteras a mitad de
  // interacción (estadística/escala de color/geometría/estructura) — no
  // hace falta cubrir paleta/títulos/presets, cuyos cambios no disparan
  // cfg.onStatsChange/onColorScaleChange y por tanto nunca destruyen esta
  // instancia. Dos secciones distintas reutilizan la misma clase CSS
  // ('ce-colorscale': Escala de color Y Estructura), así que además de la
  // clase se guarda el índice de aparición dentro del toolbar.
  const REFOCUS_SECTION_SEL = '.ce-stats, .ce-colorscale, .ce-geometry';
  function captureFocusRef() {
    const ae = document.activeElement;
    if (!ae || !toolbar.contains(ae)) return null;
    const section = ae.closest(REFOCUS_SECTION_SEL);
    if (!section) return null;
    const sectionClass = section.className.split(' ')[0];
    const sameClassSections = Array.from(toolbar.querySelectorAll('.' + sectionClass));
    const sectionIdx = sameClassSections.indexOf(section);
    const focusables = Array.from(section.querySelectorAll('select, input, button'));
    const idx = focusables.indexOf(ae);
    if (idx < 0 || sectionIdx < 0) return null;
    return { sectionClass, sectionIdx, idx };
  }
  function restoreFocusRef(ref) {
    if (!ref) return;
    const sameClassSections = Array.from(toolbar.querySelectorAll('.' + ref.sectionClass));
    const section = sameClassSections[ref.sectionIdx];
    if (!section) return;
    const focusables = Array.from(section.querySelectorAll('select, input, button'));
    const el = focusables[ref.idx];
    if (el) try { el.focus(); } catch (e) { /* noop */ }
  }
  toolbar.addEventListener('focusin', () => { pendingRefocusRef = captureFocusRef(); });

  function renderToolbar() {
    toolbar.innerHTML = '';

    const lead = document.createElement('p');
    lead.className = 'ce-lead';
    if (ctx.editing) {
      lead.className = 'ce-hint';
      lead.textContent = T.hint;
    } else if (settingsOpen) {
      lead.className = 'ce-hint';
      lead.textContent = T.settingsHint;
    } else {
      lead.innerHTML = '<strong>' + T.lead + '</strong> ' + T.leadRest;
    }
    toolbar.appendChild(lead);

    const bCustom = mkBtn(CE_ICONS.edit, ctx.editing ? T.done : T.customize, () => { setPanel(ctx.editing ? false : 'edit'); });
    bCustom.className = 'ql-btn' + (ctx.editing ? ' ce-on' : ' ce-cta');
    toolbar.appendChild(bCustom);

    // rueda de Ajustes: la MISMA en todas las figuras (antes solo el aluvial
    // de Barplots tenía la suya, un modal aparte ya retirado)
    const bSet = mkBtn(CE_ICONS.gear, settingsOpen ? T.done : T.settings, () => { setPanel(settingsOpen ? false : 'settings'); });
    bSet.className = 'ql-btn ce-settings-btn' + (settingsOpen ? ' ce-on' : '');
    bSet.setAttribute('aria-expanded', String(settingsOpen));
    toolbar.appendChild(bSet);

    const bFull = mkBtn(CE_ICONS.fullscreen, fsHandle ? T.fullscreenExit : T.fullscreen, openFullscreen);
    bFull.className = 'ql-btn' + (fsHandle ? ' ce-on' : '');
    toolbar.appendChild(bFull);

    const bDl = mkBtn(CE_ICONS.download, T.download, downloadSvg);
    bDl.className = 'ql-btn';
    toolbar.appendChild(bDl);

    const bPng = mkBtn(CE_ICONS.download, T.downloadPng, downloadPng);
    bPng.className = 'ql-btn';
    toolbar.appendChild(bPng);

    const bTiff = mkBtn(CE_ICONS.download, T.downloadTiff, downloadTiff);
    bTiff.className = 'ql-btn';
    toolbar.appendChild(bTiff);

    if (Object.keys(ctx.store).length) {
      const bReset = mkBtn(CE_ICONS.reset, T.reset, resetAll);
      bReset.className = 'ql-btn ql-btn-ghost';
      toolbar.appendChild(bReset);
    }

    if (ctx.editing) {
      toolbar.appendChild(renderTitlesSection());
    }

    // sección de estilo (rejilla/eje/marcas/título de eje/fuente): siempre
    // disponible cuando se edita, a diferencia de paleta/geometría que son
    // opt-in por módulo — todo gráfico con las clases de rol de components.css
    // (la inmensa mayoría) la aprovecha gratis, sin cfg adicional.
    if (ctx.editing) toolbar.appendChild(renderFigureStyleSection());

    if (ctx.editing && paletteSeries.length) toolbar.appendChild(renderPaletteSection());

    // ---- panel Ajustes (rueda): lo que recalcula la figura ----
    if (settingsOpen) toolbar.appendChild(renderStructureSection());

    if (settingsOpen && (geometrySliders.length || geoPresentSliders().length)) toolbar.appendChild(renderGeometrySection());

    if (settingsOpen && statsControls) toolbar.appendChild(renderStatsSection());

    if (settingsOpen && colorScaleCfg) toolbar.appendChild(renderColorScaleSection());

    // Presets (Fase 6): siempre disponible al editar, no opt-in por módulo
    // -- a diferencia de paleta/geometría, cualquier gráfico puede guardar/
    // aplicar un preset (aunque no tenga paletteSeries, sigue teniendo
    // __figureStyle/posiciones de elemento que guardar).
    if (ctx.editing) toolbar.appendChild(renderPresetsSection());
  }

  function renderTitlesSection() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-titles ce-titles-section';
    wrap.innerHTML = '<h5>' + (T.titlesTitle || 'Títulos de la figura') + '</h5>';

    const rows = document.createElement('div');
    rows.className = 'ce-titles-rows';

    const titleDefs = [
      {
        id: 'title',
        label: T.chartTitle || 'Título del Gráfico',
        selector: '.ql-chart-main-title, .ce-title, [data-ce="title"]',
        cls: 'ql-ce-title-input',
      },
      {
        id: 'xtitle',
        label: T.xAxisTitle || 'Título Eje X',
        selector: '.ql-chart-x-title, [data-ce="xtitle"]',
        cls: 'ql-ce-xtitle-input',
      },
      {
        id: 'ytitle',
        label: T.yAxisTitle || 'Título Eje Y',
        selector: '.ql-chart-y-title, [data-ce="ytitle"]',
        cls: 'ql-ce-ytitle-input',
      },
    ];

    titleDefs.forEach((td) => {
      const row = document.createElement('div');
      row.className = 'ce-title-row';

      const lab = document.createElement('label');
      lab.setAttribute('for', td.cls);
      lab.textContent = td.label;
      row.appendChild(lab);

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.id = td.cls;
      inp.className = 'ql-input ce-textfield ' + td.cls;
      inp.placeholder = td.label;

      const stVal = ctx.store[td.id] && typeof ctx.store[td.id].text === 'string' ? ctx.store[td.id].text : null;
      if (stVal !== null) {
        inp.value = stVal;
      } else {
        const matching = svg.querySelector(td.selector);
        if (matching && matching.textContent) {
          inp.value = matching.textContent.trim();
        }
      }

      inp.addEventListener('input', () => {
        const val = inp.value;
        const targets = svg.querySelectorAll(td.selector);
        targets.forEach((target) => {
          target.textContent = val;
        });
        const w = wraps.get(td.id);
        if (w && w.inner) {
          w.inner.textContent = val;
        }
        const s = st(td.id);
        s.text = val;
        decorate(td.id);
        writeStoreDebounced();
        if (cfg.onChange) try { cfg.onChange(); } catch (e) {}
      });

      row.appendChild(inp);
      rows.appendChild(row);
    });

    wrap.appendChild(rows);
    return wrap;
  }

  function mkBtn(icon, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = icon + '<span>' + label + '</span>';
    b.addEventListener('click', onClick);
    return b;
  }

  // ---- pantalla completa: mueve el <svg> real y la barra de herramientas
  // (no una copia) a un modal ancho; al cerrar, vuelven exactamente a su
  // sitio original. sync()/writeStore() no distinguen dónde vive el <svg>
  // en el DOM, así que editar, arrastrar y exportar funcionan igual dentro.
  function openFullscreen() {
    if (fsHandle) { fsHandle.close(); return; }
    const svgHome = { parent: svg.parentNode, next: svg.nextSibling };
    const toolbarHome = { parent: toolbar.parentNode, next: toolbar.nextSibling };
    if (!svgHome.parent || !toolbarHome.parent) return;
    fsHandle = openModalPanel({
      title: T.fullscreenTitle,
      extraClass: 'ql-modal-wide',
      closeLabel: T.close,
      render(bodyEl) {
        const stage = document.createElement('div');
        stage.className = 'ce-fs-stage';
        const svgWrap = document.createElement('div');
        svgWrap.className = 'ce-fs-svgwrap';
        svgWrap.appendChild(svg);
        stage.appendChild(svgWrap);
        stage.appendChild(toolbar);
        bodyEl.appendChild(stage);
        svg.classList.add('ce-fs-svg');
        return () => {
          fsHandle = null;
          svg.classList.remove('ce-fs-svg');
          try { svgHome.parent.insertBefore(svg, svgHome.next); } catch (e) { /* noop */ }
          try { toolbarHome.parent.insertBefore(toolbar, toolbarHome.next); } catch (e) { /* noop */ }
          renderToolbar();
        };
      },
    });
    renderToolbar();
  }

  function setEditing(on) {
    ctx.editing = on;
    if (on) settingsOpen = false;
    svg.classList.toggle('ce-editing', on);
    if (!on) { closePanel(); ctx.selectedId = null; syncSelection(); }
    renderToolbar();
    sync();
  }
  /** Abre 'edit' (Personalizar) o 'settings' (Ajustes), o cierra ambos (false). */
  function setPanel(mode) {
    settingsOpen = mode === 'settings';
    setEditing(mode === 'edit');
  }

  let debTimer = null;
  function writeStoreDebounced() {
    clearTimeout(debTimer);
    debTimer = setTimeout(writeStore, 300);
  }
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('keydown', onKey);

  // ---- reset ----
  function resetAll() {
    ctx.store = {};
    try {
      localStorage.removeItem(LSKEY);
      localStorage.removeItem(LEGACY_LSKEY);
    } catch (e) { /* noop */ }
    closePanel();
    ctx.selectedId = null;
    if (cfg.onReset) { cfg.onReset(); return; } // el módulo re-renderiza
    // fallback: limpiar in situ
    wraps.forEach((w, id) => {
      w.wrap.setAttribute('transform', 'translate(0,0)');
      const targets = w.kind === 'group' ? w.wrap.querySelectorAll('text, tspan') : [w.inner];
      targets.forEach((el) => { el.style.cssText = ''; });
      if (w.create && typeof w.create.text === 'string') w.inner.textContent = w.create.text;
    });
    sync();
    if (cfg.onChange) try { cfg.onChange(); } catch (e) {}
    renderToolbar();
  }

  // ---- init ----
  if (ctx.editing) svg.classList.add('ce-editing'); // startEditing: ver más arriba
  renderToolbar();
  // cfg.startEditing=true SOLO puede venir de un repintado que el propio
  // editor disparó (ver nota de `pendingRefocusRef` más arriba) — una
  // apertura nueva de "Personalizar" por el usuario nunca lo pasa, así que
  // no hay riesgo de robarle el foco a otra cosa que tuviera antes.
  if (cfg.startEditing && pendingRefocusRef) {
    restoreFocusRef(pendingRefocusRef);
    pendingRefocusRef = null;
  }
  sync();

  return {
    sync,
    serialize,
    download: downloadSvg,
    downloadPng,
    isDirty: () => Object.keys(ctx.store).length > 0,
    isEditing: () => (ctx.editing ? 'edit' : (settingsOpen ? 'settings' : false)),
    destroy() {
      if (fsHandle) fsHandle.close(); // devuelve el <svg>/toolbar a casa antes de que el módulo limpie su contenedor
      clearTimeout(debTimer);
      closePanel();
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onKey);
      svg.classList.remove('ce-editing');
      toolbar.remove();
      svg.querySelectorAll('.ce-hit, .ce-outline').forEach((n) => n.remove());
    },
  };
}
