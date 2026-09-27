// chartColors.js — paleta de las series de datos: color/opacidad/degradado/
// patrón/borde por serie, <defs> propios, aplicación sobre el SVG y el
// selector de paletas del panel.
//
// Parte del editor de figuras troceado desde js/lib/chartEditor.js (Fase 0b,
// sin cambios de comportamiento). Reparto y patrón `ctx`: js/lib/chart/chartEditor.js.

import {
  PALETTE_TYPE_FAMILY,
  evenlySampleColors,
  paletteColorAt,
  paletteColorsOf,
  palettesForType,
  resolvePaletteColors,
} from '../palettes.js';
import {
  defId,
  defIdPrefix,
  defaultGradient,
  defaultPattern,
  gradientLineFromAngle,
  normalizeSeriesStyle,
  patternTileSpec,
  representativeColor,
} from '../paletteStyle.js';
import { isValidHex } from '../paletteValidator.js';
import { NS } from './chartStyles.js';

export function createColors(ctx) {
  const { T, key, paletteMax, paletteSeries, paletteType, svg, writeStore } = ctx;

  // ---- paleta de series de datos ----
  // store.__palette = { seriesId: styleValue } — solo las series con algo
  // personalizado a mano o por un botón de paleta; las demás siguen el
  // var() por defecto del propio módulo (fill/stroke tal como lo dibujó).
  // `styleValue` es un string hex (formato de antes de la Fase 2 —
  // qiimelab-prompt-editor-fase-2-paletas-relleno-series.md Paso 2) o un
  // objeto RALO `{ color?, opacity?, fillType?, gradient?, pattern?,
  // border? }` — normalizeSeriesStyle() de js/lib/paletteStyle.js migra el
  // primer formato al segundo al leer, así que TODO el código de aquí en
  // adelante solo trata con el objeto, nunca con el string suelto.
  function paletteOverrides() { return ctx.store.__palette || {}; }
  function seriesStyle(id) { return normalizeSeriesStyle(paletteOverrides()[id]); }

  /** Color efectivo actual de una serie: el override si existe, si no el
   *  que ya está dibujado en el propio SVG (resuelto por el navegador, así
   *  que respeta el tema claro/oscuro), y si no hay ningún nodo (gráficos de
   *  degradado continuo, que no taggean nodos) el que le tocaría por orden
   *  dentro de la paleta activa — solo como referencia para el aviso de choque. */
  function effectiveSeriesColor(id, idx) {
    const style = seriesStyle(id);
    const rep = representativeColor(style, null);
    if (rep) return rep;
    const node = svg.querySelector('[data-ce-series-fill="' + id + '"], [data-ce-series-stroke="' + id + '"]');
    if (node) {
      const prop = node.hasAttribute('data-ce-series-fill') ? 'fill' : 'stroke';
      return toHex(getComputedStyle(node)[prop]);
    }
    return paletteColorAt(paletteType, idx, { max: paletteMax }) || '#888888';
  }

  // ---- <defs> de degradado/patrón (Pasos 3-4 de qiimelab-prompt-editor-
  // fase-2-paletas-relleno-series.md) — un <linearGradient>/<pattern> por
  // serie en modo degradado/patrón, dentro de un único <defs> al principio
  // del propio <svg>. Los ids llevan el `key` del módulo (namespaced, ver
  // js/lib/paletteStyle.js defId): js/modules/informe.js clona el <svg> de
  // varios módulos dentro de UNA sola página, así que dos gráficos con una
  // serie 's0' cada uno no pueden compartir id sin que uno "robe" el
  // degradado del otro.
  function svgDefs() {
    let defs = svg.querySelector(':scope > defs');
    if (!defs) { defs = document.createElementNS(NS, 'defs'); svg.insertBefore(defs, svg.firstChild); }
    return defs;
  }

  /** Borra los <defs> de degradado/patrón de ESTE módulo que ya no
   *  corresponden a ninguna serie en ese modo — si no, cambiar de
   *  degradado a sólido y volver a degradado dejaría <defs> huérfanos
   *  acumulándose en el <svg> (inofensivo para el pintado, pero ensucia el
   *  SVG exportado). Se llama al principio de applyPalette(), antes de
   *  recrear los que sí hacen falta. */
  function pruneOwnDefs(neededIds) {
    const defs = svg.querySelector(':scope > defs');
    if (!defs) return;
    const prefixes = [defIdPrefix('gradient', key), defIdPrefix('pattern', key)];
    [...defs.children].forEach((el) => {
      const id = el.getAttribute('id') || '';
      if (prefixes.some((p) => id.startsWith(p)) && !neededIds.has(id)) defs.removeChild(el);
    });
  }

  function ensureGradientDef(seriesId, gradCfg) {
    const id = defId('gradient', key, seriesId);
    const defs = svgDefs();
    let grad = defs.querySelector('#' + CSS.escape(id));
    if (!grad) { grad = document.createElementNS(NS, 'linearGradient'); grad.setAttribute('id', id); defs.appendChild(grad); }
    const line = gradientLineFromAngle(gradCfg.angle || 0);
    grad.setAttribute('x1', line.x1); grad.setAttribute('y1', line.y1);
    grad.setAttribute('x2', line.x2); grad.setAttribute('y2', line.y2);
    while (grad.firstChild) grad.removeChild(grad.firstChild);
    (gradCfg.stops || []).forEach((st) => {
      const stop = document.createElementNS(NS, 'stop');
      stop.setAttribute('offset', (st.pos != null ? st.pos : 0) + '%');
      stop.setAttribute('stop-color', isValidHex(st.color) ? st.color : '#000000');
      grad.appendChild(stop);
    });
    return id;
  }

  function ensurePatternDef(seriesId, patCfg) {
    const id = defId('pattern', key, seriesId);
    const defs = svgDefs();
    let pat = defs.querySelector('#' + CSS.escape(id));
    if (!pat) {
      pat = document.createElementNS(NS, 'pattern');
      pat.setAttribute('id', id);
      pat.setAttribute('patternUnits', 'userSpaceOnUse');
      defs.appendChild(pat);
    }
    const spec = patternTileSpec(patCfg);
    pat.setAttribute('width', spec.width);
    pat.setAttribute('height', spec.height);
    if (spec.patternTransform) pat.setAttribute('patternTransform', spec.patternTransform);
    else pat.removeAttribute('patternTransform');
    while (pat.firstChild) pat.removeChild(pat.firstChild);
    if (patCfg.bg && patCfg.bg !== 'transparent') {
      const bgRect = document.createElementNS(NS, 'rect');
      bgRect.setAttribute('width', spec.width); bgRect.setAttribute('height', spec.height);
      bgRect.setAttribute('fill', patCfg.bg);
      pat.appendChild(bgRect);
    }
    const fg = isValidHex(patCfg.fg) ? patCfg.fg : '#000000';
    (spec.shapes || []).forEach((sh) => {
      let el;
      if (sh.type === 'circle') {
        el = document.createElementNS(NS, 'circle');
        el.setAttribute('cx', sh.cx); el.setAttribute('cy', sh.cy); el.setAttribute('r', sh.r);
        el.setAttribute('fill', fg);
      } else {
        el = document.createElementNS(NS, 'line');
        el.setAttribute('x1', sh.x1); el.setAttribute('y1', sh.y1); el.setAttribute('x2', sh.x2); el.setAttribute('y2', sh.y2);
        el.setAttribute('stroke', fg);
        el.setAttribute('stroke-width', sh.strokeWidth || 1);
      }
      pat.appendChild(el);
    });
    return id;
  }

  /** Aplica (o revierte, si no hay override) el relleno de cada serie
   *  configurada a los nodos ya dibujados — sin repintar el gráfico.
   *  Opacidad 1 (o ausente) se trata como "sin personalizar": se limpia el
   *  estilo inline y el nodo vuelve a su fill-opacity/stroke-opacity propios
   *  (p. ej. las cajas de groupBoxplot.js dibujan fill-opacity:0.16 fijo —
   *  tocar el color de una serie no debe borrar eso de regalo). Tipo de
   *  relleno (Pasos 3-4): sólido (color plano, como antes) | degradado
   *  (<linearGradient>) | patrón (<pattern>) — mutuamente excluyentes, no
   *  3 casillas independientes (ver prompt Paso 3). */
  function applyPalette() {
    // 1ª pasada: qué <defs> hacen falta en total — hay que conocer el
    // conjunto completo ANTES de podar huérfanos, o se borraría uno que
    // otra serie acaba de pedir en esta misma llamada.
    const neededDefIds = new Set();
    paletteSeries.forEach((s) => {
      const style = seriesStyle(s.id);
      const fillType = style.fillType || 'solid';
      if (fillType === 'gradient' && style.gradient) neededDefIds.add(defId('gradient', key, s.id));
      else if (fillType === 'pattern' && style.pattern) neededDefIds.add(defId('pattern', key, s.id));
    });
    pruneOwnDefs(neededDefIds);
    paletteSeries.forEach((s) => {
      const style = seriesStyle(s.id);
      const fillType = style.fillType || 'solid';
      const opacityStr = style.opacity != null ? String(style.opacity) : '';
      let fillValue = style.color || '';
      if (fillType === 'gradient' && style.gradient) fillValue = 'url(#' + ensureGradientDef(s.id, style.gradient) + ')';
      else if (fillType === 'pattern' && style.pattern) fillValue = 'url(#' + ensurePatternDef(s.id, style.pattern) + ')';

      const fillNodes = svg.querySelectorAll('[data-ce-series-fill="' + s.id + '"]');
      const strokeNodes = svg.querySelectorAll('[data-ce-series-stroke="' + s.id + '"]');
      fillNodes.forEach((n) => { n.style.fill = fillValue; n.style.fillOpacity = opacityStr; });

      // borde: si hay `border` explícito, manda sobre el color de relleno —
      // y se aplica también a nodos que SOLO llevan -fill (p. ej. las
      // barras de taxaBarplot.js, que hoy no tienen ningún stroke propio)
      // porque si no el control no tendría ningún efecto visible ahí. Sin
      // `border` explícito: mismo comportamiento que antes de la Fase 2 —
      // el color de serie sigue marcando fill Y stroke, pero SOLO en los
      // nodos que el propio módulo ya etiquetó con -stroke (nunca se
      // inventa un borde en una barra que nunca lo tuvo).
      if (style.border) {
        const strokeTargets = strokeNodes.length ? strokeNodes : fillNodes;
        const bc = style.border.color || style.color || '';
        const bw = style.border.width != null ? String(style.border.width) : '';
        strokeTargets.forEach((n) => { n.style.stroke = bc; n.style.strokeWidth = bw; n.style.strokeOpacity = opacityStr; });
      } else {
        strokeNodes.forEach((n) => { n.style.stroke = fillValue; n.style.strokeWidth = ''; n.style.strokeOpacity = opacityStr; });
      }

      // radio de esquina: solo tiene sentido en <rect>; nunca se inventa
      // en un <path>/<circle> (Venn, puntos de dispersión…).
      fillNodes.forEach((n) => {
        if (!n.tagName || n.tagName.toLowerCase() !== 'rect') return;
        if (style.border && style.border.radius != null) {
          n.style.setProperty('rx', style.border.radius + 'px');
          n.style.setProperty('ry', style.border.radius + 'px');
        } else {
          n.style.removeProperty('rx');
          n.style.removeProperty('ry');
        }
      });
    });
  }

  /** Escribe un campo del estilo ralo de una serie (color/opacity/…) y
   *  limpia la entrada entera si se queda vacía — mismo criterio que ya
   *  regía cuando `store.__palette[id]` era un string suelto: "sin
   *  personalizar" no debe dejar basura en localStorage. */
  function setSeriesStyleField(id, field, value, isNoop) {
    const pal = (ctx.store.__palette = ctx.store.__palette || {});
    const cur = normalizeSeriesStyle(pal[id]);
    if (value != null && !isNoop) cur[field] = value; else delete cur[field];
    if (Object.keys(cur).length) pal[id] = cur; else delete pal[id];
    if (!Object.keys(pal).length) delete ctx.store.__palette;
    applyPalette();
    writeStore();
  }

  function setSeriesColor(id, hex) { setSeriesStyleField(id, 'color', hex, !hex); }
  /** opacity=1 (o null) se trata como valor neutro/no personalizado — ver
   *  el porqué en el comentario de applyPalette(). */
  function setSeriesOpacity(id, opacity) { setSeriesStyleField(id, 'opacity', opacity, opacity == null || opacity === 1); }
  /** 'solid' es el valor neutro/por defecto — no deja rastro en
   *  localStorage (mismo criterio que el resto de campos ralos). Al entrar
   *  por primera vez en degradado/patrón, siembra una configuración por
   *  defecto a partir del color actual de la serie (Paso 6: cambiar el
   *  SELECTOR de tipo de relleno debe verse en el gráfico al momento, no
   *  quedarse en blanco hasta que el usuario también elija paradas/trazo). */
  function setSeriesFillType(id, type) {
    const pal = (ctx.store.__palette = ctx.store.__palette || {});
    const cur = normalizeSeriesStyle(pal[id]);
    if (!type || type === 'solid') {
      delete cur.fillType;
    } else {
      cur.fillType = type;
      const idx = paletteSeries.findIndex((p) => p.id === id);
      const baseColor = cur.color || effectiveSeriesColor(id, idx);
      if (type === 'gradient' && !cur.gradient) cur.gradient = defaultGradient(baseColor);
      if (type === 'pattern' && !cur.pattern) cur.pattern = defaultPattern(baseColor);
    }
    if (Object.keys(cur).length) pal[id] = cur; else delete pal[id];
    if (!Object.keys(pal).length) delete ctx.store.__palette;
    applyPalette();
    writeStore();
  }
  function setSeriesGradient(id, gradCfg) { setSeriesStyleField(id, 'gradient', gradCfg, false); }
  function setSeriesPattern(id, patCfg) { setSeriesStyleField(id, 'pattern', patCfg, false); }
  function setSeriesBorder(id, borderCfg) {
    const hasAny = borderCfg && (borderCfg.color || borderCfg.width != null || borderCfg.radius != null);
    setSeriesStyleField(id, 'border', hasAny ? borderCfg : null, !hasAny);
  }

  /** Aplica una paleta del catálogo (js/lib/palettes.js) a TODAS las series
   *  configuradas de golpe. `id` es 'app:<paletteType>' (la paleta por
   *  defecto de la app) o un id de PALETTE_CATALOG (Fase 2, Paso 1 de
   *  qiimelab-prompt-editor-fase-2-paletas-relleno-series.md). Categóricas:
   *  un color por serie EN ORDEN (mismo comportamiento que antes). Secuencial/
   *  divergente: se muestrean equiespaciadas tantas paradas como series haya
   *  configuradas (2 "polos" siempre caen en el primer/último tono de la
   *  rampa elegida, nunca en sus 2 primeros — ver evenlySampleColors). */
  function applyPresetPalette(id) {
    const pal = (ctx.store.__palette = ctx.store.__palette || {});
    const isQualitative = (PALETTE_TYPE_FAMILY[paletteType] || 'qualitative') === 'qualitative';
    const picks = isQualitative
      ? paletteSeries.map((s, i) => resolvePaletteColors(id, i, { max: paletteMax }))
      : evenlySampleColors(paletteColorsOf(id, { max: paletteMax }), paletteSeries.length);
    paletteSeries.forEach((s, i) => {
      if (!picks[i]) return;
      const cur = normalizeSeriesStyle(pal[s.id]);
      cur.color = picks[i];
      // aplicar una paleta completa siempre da relleno sólido — un
      // degradado/patrón que se quedara con las paradas del color anterior
      // quedaría descolocado frente al nuevo color base (Paso 6: "sólido/
      // degradado/patrón/borde" es la jerarquía de tipo de relleno, no algo
      // que sobreviva sin más a cambiar la paleta entera). La opacidad y el
      // borde SÍ se conservan: son preferencias de estilo independientes
      // del tono elegido.
      delete cur.fillType; delete cur.gradient; delete cur.pattern;
      pal[s.id] = cur;
    });
    ctx.store.__paletteChoice = id;
    applyPalette();
    writeStore();
  }

  const PALETTE_LABEL = {
    categorical: T.paletteCategorical, sequential: T.paletteSequential,
    sequentialPoles: T.paletteSequential, divergent: T.paletteDivergent,
    divergentPoles: T.paletteDivergent,
  };

  function swatchBarColors(colors) {
    const bar = document.createElement('span');
    bar.className = 'ce-pal-swatchbar';
    (colors || []).slice(0, paletteMax || (colors || []).length).forEach((hex) => {
      const sw = document.createElement('span');
      sw.style.background = hex;
      bar.appendChild(sw);
    });
    return bar;
  }

  function paletteEntryLabel(p) {
    if (p.isDefault) return (PALETTE_LABEL[paletteType] || paletteType) + ' — ' + T.paletteAppDefault;
    return p.name;
  }

  /** Desplegable con todas las paletas de la MISMA familia que `paletteType`
   *  (categórica/secuencial/divergente — nunca mezcladas: no tendría
   *  sentido ofrecer una rampa secuencial de 9 tonos para recolorear series
   *  discretas de un Venn) + una vista previa de swatches que se actualiza
   *  al cambiar de opción SIN aplicar todavía, y un botón "Aplicar" aparte
   *  (Paso 1 de qiimelab-prompt-editor-fase-2-paletas-relleno-series.md —
   *  antes era un único botón fijo a la paleta por defecto de la app). */
  function renderPaletteChooser() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-pal-chooser';

    const options = palettesForType(paletteType);
    const current = ctx.store.__paletteChoice && options.some((p) => p.id === ctx.store.__paletteChoice)
      ? ctx.store.__paletteChoice : 'app:' + paletteType;

    const row = document.createElement('div');
    row.className = 'ce-pal-chooser-row';
    const selId = 'ce-pal-choose-' + (++ctx.cePanelUid);
    const lab = document.createElement('label');
    lab.setAttribute('for', selId);
    lab.textContent = T.paletteChoose;
    row.appendChild(lab);

    const sel = document.createElement('select');
    sel.id = selId;
    const appGroup = document.createElement('optgroup');
    appGroup.label = PALETTE_LABEL[paletteType] || paletteType;
    const catGroup = document.createElement('optgroup');
    catGroup.label = T.paletteTitle;
    options.forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = paletteEntryLabel(p);
      if (p.id === current) o.selected = true;
      (p.isDefault ? appGroup : catGroup).appendChild(o);
    });
    sel.appendChild(appGroup);
    if (catGroup.children.length) sel.appendChild(catGroup);
    row.appendChild(sel);

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'ql-btn';
    applyBtn.textContent = T.paletteApply;
    applyBtn.addEventListener('click', () => applyPresetPalette(sel.value));
    row.appendChild(applyBtn);
    wrap.appendChild(row);

    const preview = document.createElement('div');
    preview.className = 'ce-pal-preview';
    // Nº de series "seguro" bajo daltonismo -- Paso 4 de
    // qiimelab-prompt-editor-fase-6-presets-style-match-export-revista.md:
    // mostrar el N calculado por paletteValidator (vía maxSafeN, ya
    // computado en paletteCatalog.js), no una afirmación genérica de
    // "colorblind-safe" sin más. Nota SIEMPRE visible (no solo al
    // excederlo, que es lo que ya hacía `warn` más abajo).
    const safeNote = document.createElement('p');
    safeNote.className = 'ce-pal-safen';
    const warn = document.createElement('p');
    warn.className = 'ce-pal-warn';
    const paint = () => {
      const p = options.find((o) => o.id === sel.value);
      preview.innerHTML = '';
      if (p) preview.appendChild(swatchBarColors(p.colors));
      safeNote.textContent = (p && p.type === 'qualitative' && p.maxSafeN != null) ? T.paletteSafeN(p.maxSafeN) : '';
      warn.textContent = '';
      if (p && p.type === 'qualitative' && p.maxSafeN != null && paletteSeries.length > p.maxSafeN) {
        warn.textContent = '⚠ ' + T.paletteWarnSafeN(paletteSeries.length, p.maxSafeN);
      }
    };
    sel.addEventListener('change', paint);
    paint();
    wrap.appendChild(preview);
    wrap.appendChild(safeNote);
    wrap.appendChild(warn);

    return wrap;
  }

  function renderPaletteSection() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-palette';
    wrap.innerHTML = '<h5>' + T.paletteTitle + '</h5>';

    wrap.appendChild(renderPaletteChooser());

    const rows = document.createElement('div');
    rows.className = 'ce-pal-rows';
    const currentHexes = paletteSeries.map((s, i) => effectiveSeriesColor(s.id, i));
    paletteSeries.forEach((s, i) => { rows.appendChild(ctx.renderSeriesRow(s, i, currentHexes)); });
    wrap.appendChild(rows);
    return wrap;
  }

  function toHex(color) {
    if (!color) return '#000000';
    if (/^#[0-9a-f]{6}$/i.test(color)) return color;
    const m = color.match(/rgba?\(([^)]+)\)/i);
    if (!m) return '#000000';
    const [r, g, b] = m[1].split(',').map((x) => parseInt(x, 10));
    return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, x || 0)).toString(16).padStart(2, '0')).join('');
  }

  return {
    applyPalette, renderPaletteSection, seriesStyle, setSeriesBorder, setSeriesColor,
    setSeriesFillType, setSeriesGradient, setSeriesOpacity, setSeriesPattern, toHex,
  };
}
