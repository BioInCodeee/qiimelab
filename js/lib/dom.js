// Utilidades DOM y SVG compartidas para Smart-175

/**
 * Escapa caracteres especiales de HTML para inserción segura en el DOM.
 * @param {*} s
 * @returns {string}
 */
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

/**
 * Crea un elemento SVG en el namespace http://www.w3.org/2000/svg con los atributos dados.
 * @param {string} tag
 * @param {Object} [attrs]
 * @returns {SVGElement}
 */
export function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v != null) el.setAttribute(k, v);
    }
  }
  return el;
}

/**
 * Delegación de eventos de hover: un único listener en `container` que
 * detecta entradas/salidas de los elementos que coinciden con `selector`,
 * en vez de un listener `mouseenter`/`mouseleave` por elemento. Evita crear
 * miles de listeners en gráficos con muchos nodos (heatmaps, scatter, etc.).
 * @param {HTMLElement|SVGElement} container
 * @param {string} selector
 * @param {Object} [opts]
 * @param {(el: Element, e: PointerEvent) => void} [opts.onEnter]
 * @param {(el: Element, e: PointerEvent) => void} [opts.onLeave]
 * @param {(el: Element, e: PointerEvent) => void} [opts.onMove] - opcional, para tooltips que siguen al cursor (p. ej. inference.js)
 */
export function delegateHover(container, selector, { onEnter, onLeave, onMove } = {}) {
  let current = null;
  container.addEventListener('pointerover', (e) => {
    const el = e.target.closest(selector);
    if (!el || el === current || !container.contains(el)) return;
    current = el;
    onEnter && onEnter(el, e);
  });
  container.addEventListener('pointerout', (e) => {
    const el = e.target.closest(selector);
    if (!el || el !== current) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    current = null;
    onLeave && onLeave(el, e);
  });
  if (onMove) {
    container.addEventListener('pointermove', (e) => {
      if (!current || !e.target.closest(selector)) return;
      onMove(current, e);
    });
  }
}

/**
 * Detalle plegable ("más detalles") para no dejar párrafos largos siempre
 * visibles: una nota corta va fuera y el texto completo vive dentro de un
 * <details>. Devuelve HTML (los textos de i18n ya pueden llevar marcado, igual
 * que el resto de la app los inserta con innerHTML); `label` y `bodyHtml` NO
 * se escapan aquí — vienen de t().
 * @param {string} label    texto del resumen (t('ui.moreDetails'))
 * @param {string} bodyHtml contenido completo
 * @returns {string}
 */
export function moreDetailsHtml(label, bodyHtml) {
  return '<details class="ql-more"><summary>' + label + '</summary>' +
    '<div class="ql-more-body">' + bodyHtml + '</div></details>';
}

/**
 * Parte un texto del tipo `<b>Qué falló:</b> cómo arreglarlo…` en la cabecera
 * en negrita y el resto. Si no hay cabecera en negrita al principio, o lo que
 * queda es corto (< minRest), no hay nada que plegar: devuelve rest = ''.
 * @param {string} html
 * @param {number} [minRest=120]
 * @returns {{ lead: string, rest: string }}
 */
export function splitLead(html, minRest = 120) {
  const s = String(html);
  const m = s.match(/^\s*<b>[\s\S]*?<\/b>/);
  if (!m) return { lead: s, rest: '' };
  const lead = m[0].trim();
  const rest = s.slice(m[0].length).trim();
  return rest.length >= minRest ? { lead, rest } : { lead: s, rest: '' };
}

/** Recorta al área de trazado (x,y,w,h): con un rango de eje manual más
 *  estrecho que los datos, nada se dibuja fuera de los ejes. Devuelve el valor
 *  para el atributo clip-path del grupo de datos. `id` debe ser único por SVG. */
export function plotClip(svg, id, x, y, w, h) {
  let defs = svg.querySelector('defs');
  if (!defs) { defs = svgEl('defs', {}); svg.insertBefore(defs, svg.firstChild); }
  const cp = svgEl('clipPath', { id });
  cp.appendChild(svgEl('rect', { x, y, width: w, height: h }));
  defs.appendChild(cp);
  return 'url(#' + id + ')';
}

/**
 * Valor actual de un token de diseño, leído del DOM.
 *
 * Para lo que se dibuja en <canvas>, donde no hay CSS que resuelva var() y
 * hasta ahora los colores iban incrustados a mano: así la marca sobre la foto
 * de una placa sigue el tema claro/oscuro como el resto de la interfaz.
 *
 * @param {string} name      nombre del token, con los dos guiones ('--accent')
 * @param {string} fallback  valor si el token no existe o aún no hay estilos
 * @returns {string}
 */
export function token(name, fallback = '') {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}
