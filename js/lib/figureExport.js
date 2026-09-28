// figureExport.js — pipeline de exportación de figuras: SVG limpio (sin
// var()/color()/color-mix() residual, siempre legible con independencia del
// tema activo), PNG con metadatos de dpi reales (chunk pHYs), TIFF baseline
// sin compresión con resolución embebida y PDF de una página (la figura
// rasterizada al tamaño físico — no vectorial). Sin dependencias.
//
// Motivación — 2 bugs confirmados en el pipeline anterior de chartEditor.js
// (ver Paso 3 de qiimelab-prompt-editor-fase-0-fundamentos.md):
//  1. Exportar en modo oscuro copiaba el `style` computado tal cual → texto
//     claro sobre el fondo blanco forzado del export, ilegible. Aquí la
//     figura se resuelve SIEMPRE en el esquema pedido (por defecto claro),
//     con independencia de en qué tema esté navegando quien exporta.
//  2. Los rellenos con color-mix() (mapas de calor, matriz de correlación,
//     degradados de composición de taxaBarplot.js/betaDiversity.js) resuelven
//     en Chromium al valor computado moderno `color(srgb r g b)` (componentes
//     0-1) en vez de `rgb()` — los editores vectoriales (Illustrator/Inkscape)
//     no lo interpretan y quedaba tal cual en el SVG exportado.
//
// `resolveComputedColor` reconoce las formas EXACTAS que devuelve
// getComputedStyle() en un navegador real — nunca hex, nunca nombres de
// color, eso es autoría, no valor computado — así que es una función pura,
// sin canvas ni parser de CSS de autor, 100% testable en Node (ver
// tests/figureexport.mjs).

const SVG_NS = 'http://www.w3.org/2000/svg';

// -------------------------------------------------------- color computado --
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function pct(v) { return v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v); }

/**
 * Color computado (getComputedStyle) → [r,g,b,a] con r,g,b en 0..255 y a en
 * 0..1. Formas reconocidas: `rgb(r, g, b)`, `rgba(r, g, b, a)`,
 * `rgb(r g b / a)`, `color(srgb r g b [/ a])` (salida moderna de Chromium
 * para color-mix()/relative color syntax — componentes 0..1, no 0..255),
 * `none`, `transparent`. `var(...)`/`url(...)` sin resolver devuelven null:
 * quien llama decide el fallback (normalmente dejar el atributo como estaba).
 */
export function resolveComputedColor(str) {
  if (str == null) return null;
  const s = String(str).trim().toLowerCase();
  if (!s || s === 'none') return null;
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s.startsWith('url(') || s.startsWith('var(')) return null;

  let m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] === undefined ? 1 : pct(m[4]);
    return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), clamp01(a)];
  }
  m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] === undefined ? 1 : pct(m[4]);
    return [Math.round(clamp01(+m[1]) * 255), Math.round(clamp01(+m[2]) * 255), Math.round(clamp01(+m[3]) * 255), clamp01(a)];
  }
  return null; // currentcolor u otra forma no resuelta
}

export function resolveComputedColorHex(str) {
  const c = resolveComputedColor(str);
  if (!c) return null;
  const h = (v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return '#' + h(c[0]) + h(c[1]) + h(c[2]);
}

// ---------------------------------------------------- serialización SVG ----
const INHERITED_TEXT = ['font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing'];
const STROKE_PROPS = ['stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit'];
const SKIP_CLASSES = ['ce-hit', 'ce-outline'];

// getComputedStyle: en el navegador es un global; en el runner de tests sin
// navegador (tests/charteditor.mjs) solo existe como window.getComputedStyle
// — mismo patrón de resolución que ya usa inlineComputedStyles más abajo en
// chartEditor.js.
function getCS(el) {
  if (typeof getComputedStyle === 'function') return getComputedStyle(el);
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') return window.getComputedStyle(el);
  return null;
}

function setColorAttr(el, name, cssValue) {
  // name: 'fill' | 'stroke' | 'stop-color'; la opacidad va en '<name>-opacity'
  if (!cssValue || cssValue === 'none') { if (cssValue === 'none') el.setAttribute(name, 'none'); return; }
  if (cssValue.startsWith('url(')) { el.setAttribute(name, cssValue.replace(/url\("?([^")]+)"?\)/i, 'url($1)')); return; }
  const rgba = resolveComputedColor(cssValue);
  if (!rgba) return; // sin resolver: se deja el atributo tal como estaba en el original
  const hex = '#' + [0, 1, 2].map((i) => rgba[i].toString(16).padStart(2, '0')).join('');
  el.setAttribute(name, hex);
  if (rgba[3] < 0.9999) el.setAttribute(name === 'stop-color' ? 'stop-opacity' : name + '-opacity', String(+rgba[3].toFixed(4)));
  else el.removeAttribute(name === 'stop-color' ? 'stop-opacity' : name + '-opacity');
}

function styleToAttrs(srcEl, dstEl) {
  const cs = getCS(srcEl);
  if (!cs) return;
  const tag = (dstEl.tagName || '').toLowerCase();
  const isShape = /^(path|rect|circle|ellipse|line|polyline|polygon|text|tspan|use)$/.test(tag);

  if (tag === 'stop') { setColorAttr(dstEl, 'stop-color', cs.getPropertyValue('stop-color')); return; }

  if (isShape || tag === 'g') {
    if (isShape) {
      setColorAttr(dstEl, 'fill', cs.getPropertyValue('fill'));
      const strokeVal = cs.getPropertyValue('stroke');
      if (tag !== 'text' && tag !== 'tspan') setColorAttr(dstEl, 'stroke', strokeVal);
      else if (strokeVal && strokeVal !== 'none') setColorAttr(dstEl, 'stroke', strokeVal);
      if (dstEl.getAttribute('stroke') && dstEl.getAttribute('stroke') !== 'none') {
        STROKE_PROPS.forEach((p) => {
          const v = cs.getPropertyValue(p);
          if (v && v !== 'none' && v !== 'normal') dstEl.setAttribute(p, v.replace(/px$/, ''));
        });
      }
    }
    const op = parseFloat(cs.getPropertyValue('opacity'));
    if (isFinite(op) && op < 0.9999) dstEl.setAttribute('opacity', String(+op.toFixed(4)));
    else dstEl.removeAttribute('opacity');
  }

  if (tag === 'text' || tag === 'tspan') {
    INHERITED_TEXT.forEach((p) => {
      let v = cs.getPropertyValue(p);
      if (!v) return;
      if (p === 'font-size') v = String(parseFloat(v));
      dstEl.setAttribute(p, v.replace(/"/g, "'"));
    });
    const anchor = cs.getPropertyValue('text-anchor');
    if (anchor && anchor !== 'start' && !dstEl.getAttribute('text-anchor')) dstEl.setAttribute('text-anchor', anchor);
    const db = cs.getPropertyValue('dominant-baseline');
    if (db && db !== 'auto' && !dstEl.getAttribute('dominant-baseline')) dstEl.setAttribute('dominant-baseline', db);
  }

  // limpieza: nada de CSS residual ni de artefactos del editor
  dstEl.removeAttribute('style');
  ['pointer-events', 'tabindex', 'role'].forEach((a) => dstEl.removeAttribute(a));
  if (dstEl.hasAttribute('class')) {
    const kept = dstEl.getAttribute('class').split(/\s+/).filter((c) => c && !/^ce-/.test(c));
    if (kept.length) dstEl.setAttribute('class', kept.join(' ')); else dstEl.removeAttribute('class');
  }
}

/**
 * Serializa un <svg> de Smart-175 listo para editor vectorial / revista.
 * @param {SVGSVGElement} svg
 * @param {object} [o]
 * @param {'light'|'current'} [o.scheme='light']  esquema con el que resolver los colores
 * @param {'white'|'transparent'|string} [o.background='white']  '#rrggbb' también vale
 * @param {number} [o.widthMm]  ancho físico; el alto se deduce del viewBox
 * @returns {{ svg: string, width: number, height: number, widthMm: (number|null), heightMm: (number|null) }}
 */
export function serializeForExport(svg, o = {}) {
  const scheme = o.scheme || 'light';
  const root = (typeof document !== 'undefined') ? document.documentElement : null;
  const prev = root ? root.getAttribute('data-theme') : null;
  if (scheme === 'light' && root) root.setAttribute('data-theme', 'light');
  let out;
  try {
    const clone = svg.cloneNode(true);
    clone.querySelectorAll(SKIP_CLASSES.map((c) => '.' + c).join(',')).forEach((n) => n.remove());
    const srcAll = [svg, ...svg.querySelectorAll('*')].filter((n) => !SKIP_CLASSES.some((c) => n.classList && n.classList.contains(c)));
    const dstAll = [clone, ...clone.querySelectorAll('*')];
    // ambos recorridos tienen el mismo orden salvo los nodos filtrados/eliminados → mapeo por posición
    const n = Math.min(srcAll.length, dstAll.length);
    for (let i = 0; i < n; i++) styleToAttrs(srcAll[i], dstAll[i]);
    if (clone.classList && clone.classList.remove) clone.classList.remove('ce-editing');

    const vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal : null;
    const W = vb ? vb.width : (svg.getBoundingClientRect ? svg.getBoundingClientRect().width || 800 : 800);
    const H = vb ? vb.height : (svg.getBoundingClientRect ? svg.getBoundingClientRect().height || 600 : 600);
    const vx = vb ? vb.x : 0, vy = vb ? vb.y : 0;
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('viewBox', `${vx} ${vy} ${W} ${H}`);
    let widthMm = null, heightMm = null;
    if (o.widthMm > 0) {
      widthMm = +o.widthMm; heightMm = +(o.widthMm * H / W).toFixed(3);
      clone.setAttribute('width', widthMm + 'mm'); clone.setAttribute('height', heightMm + 'mm');
    } else {
      clone.setAttribute('width', String(Math.round(W))); clone.setAttribute('height', String(Math.round(H)));
    }
    clone.removeAttribute('style'); clone.removeAttribute('class');

    const bgOpt = o.background || 'white';
    if (bgOpt !== 'transparent') {
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', vx); rect.setAttribute('y', vy); rect.setAttribute('width', W); rect.setAttribute('height', H);
      rect.setAttribute('fill', bgOpt === 'white' ? '#ffffff' : (resolveComputedColorHex(bgOpt) || '#ffffff'));
      rect.setAttribute('class', 'ce-export-bg');
      clone.insertBefore(rect, clone.firstChild);
    }

    const serializer = (typeof XMLSerializer !== 'undefined') ? new XMLSerializer()
      : (typeof globalThis !== 'undefined' && globalThis.XMLSerializer) ? new globalThis.XMLSerializer() : null;
    const body = serializer ? serializer.serializeToString(clone) : (clone.outerHTML || '');
    out = { svg: '<?xml version="1.0" encoding="UTF-8"?>\n' + body, width: W, height: H, widthMm, heightMm };
  } finally {
    if (scheme === 'light' && root) {
      if (prev == null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', prev);
    }
  }
  return out;
}

// ------------------------------------------------- fuentes incrustadas ----
// Un SVG rasterizado como <img> (PNG/TIFF/PDF) es un documento aislado que NO
// ve las @font-face de la página: sin esto, las figuras en IBM Plex o en
// Liberation Sans/Serif salían con la fuente de reserva del sistema. Se
// incrustan como data: (font-src 'self' data: en la CSP) solo las caras
// autoalojadas que usa de verdad la figura — también en la descarga SVG,
// para que el archivo se vea igual en cualquier navegador; en Word/Inkscape
// manda el nombre de familia de la pila (Liberation → Arial/Times).

const _fontData = new Map(); // url absoluta → Promise<string base64>

function unquote(f) { return f.trim().replace(/^["']|["']$/g, ''); }

function weightNum(w) {
  if (w === 'bold') return 700;
  if (w === 'normal' || !w) return 400;
  const n = parseFloat(w);
  return isFinite(n) ? n : 400;
}

/** @font-face de las hojas de estilo del mismo origen → [{family, style, wMin, wMax, weight, url, range}] */
function pageFontFaces() {
  const out = [];
  if (typeof document === 'undefined' || !document.styleSheets) return out;
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const r of Array.from(rules || [])) {
      if (typeof CSSFontFaceRule === 'undefined' || !(r instanceof CSSFontFaceRule)) continue;
      const st = r.style;
      const m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(st.getPropertyValue('src'));
      if (!m) continue;
      const wParts = (st.getPropertyValue('font-weight') || '400').trim().split(/\s+/).map(weightNum);
      out.push({
        family: unquote(st.getPropertyValue('font-family')),
        style: (st.getPropertyValue('font-style') || 'normal').trim(),
        weight: (st.getPropertyValue('font-weight') || '400').trim(),
        wMin: Math.min(...wParts), wMax: Math.max(...wParts),
        url: new URL(m[1], sheet.href || document.baseURI).href,
        range: (st.getPropertyValue('unicode-range') || '').trim(),
      });
    }
  }
  return out;
}

/** Caras que necesita un texto (pila de familias + peso + estilo), con la
 *  misma lógica que el navegador: la primera familia de la pila que exista,
 *  el estilo pedido (o normal) y el peso más cercano. */
function pickFaces(faces, familyStack, weight, style) {
  for (const fam of familyStack.split(',').map(unquote)) {
    const ofFam = faces.filter((f) => f.family.toLowerCase() === fam.toLowerCase());
    if (!ofFam.length) continue;
    const st = ofFam.some((f) => f.style === style) ? style : (ofFam.some((f) => f.style === 'normal') ? 'normal' : ofFam[0].style);
    const cand = ofFam.filter((f) => f.style === st);
    const dist = (f) => (weight < f.wMin ? f.wMin - weight : weight > f.wMax ? weight - f.wMax : 0);
    const best = Math.min(...cand.map(dist));
    return cand.filter((f) => dist(f) === best);
  }
  return [];
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fontBase64(url) {
  if (!_fontData.has(url)) {
    _fontData.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(toBase64)
      .catch((e) => { _fontData.delete(url); throw e; }));
  }
  return _fontData.get(url);
}

/**
 * Incrusta en un SVG ya serializado (serializeForExport) las @font-face
 * autoalojadas que usan sus textos. Si algo falla, devuelve el SVG tal cual
 * (la figura sale igual, con la fuente de reserva).
 * @param {string} svgString
 * @returns {Promise<string>}
 */
export async function embedFonts(svgString) {
  try {
    const faces = pageFontFaces();
    if (!faces.length) return svgString;
    const wanted = new Map(); // url → cara
    const attr = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; };
    for (const m of svgString.matchAll(/<(?:text|tspan)\b[^>]*>/g)) {
      const fam = attr(m[0], 'font-family');
      if (!fam) continue;
      const w = weightNum(attr(m[0], 'font-weight') || '400');
      const st = attr(m[0], 'font-style') || 'normal';
      pickFaces(faces, fam.replace(/&quot;/g, '"'), w, st === 'oblique' ? 'italic' : st).forEach((f) => wanted.set(f.url, f));
    }
    if (!wanted.size) return svgString;
    const css = [];
    for (const f of wanted.values()) {
      const b64 = await fontBase64(f.url);
      css.push('@font-face{font-family:\'' + f.family + '\';font-style:' + f.style + ';font-weight:' + f.weight +
        ';src:url(data:font/woff2;base64,' + b64 + ') format(\'woff2\')' + (f.range ? ';unicode-range:' + f.range : '') + '}');
    }
    const style = '<defs><style type="text/css"><![CDATA[' + css.join('\n') + ']]></style></defs>';
    return svgString.replace(/(<svg\b[^>]*>)/, '$1' + style);
  } catch (e) {
    return svgString;
  }
}

// -------------------------------------------------------------- raster ----
/** SVG (string) → canvas a widthPx×heightPx. Fondo: se pinta solo si no es transparente. */
export function rasterize(svgString, widthPx, heightPx, { transparent = false } = {}) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function')
      ? URL.createObjectURL(blob)
      : ('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString));
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = Math.round(widthPx); cv.height = Math.round(heightPx);
      const c = cv.getContext('2d');
      if (!transparent) { c.fillStyle = '#ffffff'; c.fillRect(0, 0, cv.width, cv.height); }
      c.drawImage(img, 0, 0, cv.width, cv.height);
      if (url.startsWith('blob:') && typeof URL !== 'undefined') URL.revokeObjectURL(url);
      resolve(cv);
    };
    img.onerror = (e) => {
      if (url.startsWith('blob:') && typeof URL !== 'undefined') URL.revokeObjectURL(url);
      reject(e || new Error('SVG no decodificable'));
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------- CRC32 ----
let _crcTable = null;
function crc32(bytes) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; _crcTable[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = _crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Inserta el chunk pHYs (píxeles/metro) tras IHDR. `png`: Uint8Array. */
export function pngWithDpi(png, dpi) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (png[i] !== sig[i]) throw new Error('No es un PNG');
  const ppm = Math.round(dpi / 0.0254);
  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, ppm); dv.setUint32(4, ppm); data[8] = 1;
  const type = [0x70, 0x48, 0x59, 0x73]; // 'pHYs'
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const cdv = new DataView(chunk.buffer);
  cdv.setUint32(0, 9); chunk.set(type, 4); chunk.set(data, 8);
  const crcInput = new Uint8Array(4 + 9); crcInput.set(type, 0); crcInput.set(data, 4);
  cdv.setUint32(17, crc32(crcInput));
  // IHDR = 8 (firma) + 4 (len) + 4 (tipo) + 13 (datos) + 4 (crc) = fin en 33
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0); out.set(chunk, ihdrEnd); out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

/** canvas → PNG (Uint8Array) con el chunk pHYs si se pide `dpi`. Vía
 *  toDataURL()/atob() en vez de canvas.toBlob(): es síncrono y funciona
 *  igual en cualquier navegador real sin depender de Blob.arrayBuffer(). */
export function canvasToPng(canvas, dpi) {
  const dataUrl = canvas.toDataURL('image/png');
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dpi ? pngWithDpi(bytes, dpi) : bytes;
}

// ---------------------------------------------------------------- TIFF ----
/**
 * TIFF baseline sin compresión, little-endian, 8 bits/canal, con resolución en ppp.
 * @param {ImageData} img
 * @param {number} dpi
 * @param {{alpha?: boolean}} [o]  alpha=true → RGBA (ExtraSamples=2, alfa no asociado); si no, RGB
 * @returns {Uint8Array}
 */
export function encodeTiff(img, dpi, o = {}) {
  const { width: w, height: h, data } = img;
  const spp = o.alpha ? 4 : 3;
  const entries = o.alpha ? 13 : 12;
  const ifdOff = 8;
  const ifdSize = 2 + entries * 12 + 4;
  const extraOff = ifdOff + ifdSize;
  const bpsBytes = spp * 2;
  const bpsOff = extraOff;
  const xresOff = bpsOff + bpsBytes;
  const yresOff = xresOff + 8;
  const pixOff = yresOff + 8;
  const pixBytes = w * h * spp;
  const buf = new Uint8Array(pixOff + pixBytes);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x49; buf[1] = 0x49; dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true);
  let p = ifdOff;
  dv.setUint16(p, entries, true); p += 2;
  const SHORT = 3, LONG = 4, RATIONAL = 5;
  const put = (tag, type, count, value) => {
    dv.setUint16(p, tag, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, count, true);
    if (type === SHORT && count === 1) dv.setUint16(p + 8, value, true); else dv.setUint32(p + 8, value, true);
    p += 12;
  };
  put(256, LONG, 1, w);                    // ImageWidth
  put(257, LONG, 1, h);                    // ImageLength
  put(258, SHORT, spp, bpsOff);            // BitsPerSample
  put(259, SHORT, 1, 1);                   // Compression = none
  put(262, SHORT, 1, 2);                   // Photometric = RGB
  put(273, LONG, 1, pixOff);               // StripOffsets
  put(277, SHORT, 1, spp);                 // SamplesPerPixel
  put(278, LONG, 1, h);                    // RowsPerStrip
  put(279, LONG, 1, pixBytes);             // StripByteCounts
  put(282, RATIONAL, 1, xresOff);          // XResolution
  put(283, RATIONAL, 1, yresOff);          // YResolution
  put(296, SHORT, 1, 2);                   // ResolutionUnit = inch
  if (o.alpha) put(338, SHORT, 1, 2);      // ExtraSamples = alfa no asociado
  dv.setUint32(p, 0, true);                // sin IFD siguiente
  for (let i = 0; i < spp; i++) dv.setUint16(bpsOff + i * 2, 8, true);
  dv.setUint32(xresOff, Math.round(dpi), true); dv.setUint32(xresOff + 4, 1, true);
  dv.setUint32(yresOff, Math.round(dpi), true); dv.setUint32(yresOff + 4, 1, true);
  if (o.alpha) {
    buf.set(data, pixOff); // ImageData ya es RGBA no premultiplicado
  } else {
    for (let i = 0, j = pixOff; i < data.length; i += 4, j += 3) { buf[j] = data[i]; buf[j + 1] = data[i + 1]; buf[j + 2] = data[i + 2]; }
  }
  return buf;
}

// ----------------------------------------------------------------- PDF ----
/**
 * PDF 1.4 de una página con la figura como imagen RGB (FlateDecode). Función
 * pura: recibe los bytes RGB ya comprimidos en zlib (ver `deflateZlib`). La
 * página mide exactamente `wPt`×`hPt` puntos (1pt = 1/72"), así que al
 * imprimir sale al tamaño físico pedido; la resolución efectiva es wPx/wPt*72.
 * No es vectorial: para editar trazos en Illustrator/Inkscape, el SVG.
 */
export function encodePdf(rgbZ, wPx, hPx, wPt, hPt) {
  const enc = new TextEncoder();
  const chunks = []; const offsets = []; let len = 0;
  const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
  const num = (n) => String(Math.round(n * 1000) / 1000);
  const obj = (n, head, stream) => {
    offsets[n] = len;
    put(n + ' 0 obj\n' + head + '\n');
    if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); }
    put('endobj\n');
  };
  put('%PDF-1.4\n');
  put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // marca binaria (comentario)
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(wPt) + ' ' + num(hPt) + '] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>');
  const content = enc.encode('q ' + num(wPt) + ' 0 0 ' + num(hPt) + ' 0 0 cm /Im0 Do Q');
  obj(4, '<< /Length ' + content.length + ' >>', content);
  obj(5, '<< /Type /XObject /Subtype /Image /Width ' + wPx + ' /Height ' + hPx + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ' + rgbZ.length + ' >>', rgbZ);
  const xref = len;
  put('xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
  put('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  const out = new Uint8Array(len); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** zlib (RFC 1950, lo que espera FlateDecode) con el CompressionStream nativo. */
export async function deflateZlib(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Pipeline completo: <svg> → { svg, png, tiff, pdf } con tamaño físico.
 * @param {number} [o.widthMm]  ancho físico deseado (p.ej. 89/183mm Nature,
 *        85/174mm Cell). Sin especificar, se reinterpreta el tamaño actual
 *        en px como si fueran px CSS a 96ppp — "el tamaño de siempre", solo
 *        que rasterizado a `dpi` en vez de a la resolución de pantalla.
 */
export async function exportFigure(svg, { widthMm, dpi = 300, scheme = 'light', background = 'white', formats = ['svg', 'png', 'tiff'] } = {}) {
  const s = serializeForExport(svg, { scheme, background, widthMm });
  s.svg = await embedFonts(s.svg);
  const effWidthMm = s.widthMm != null ? s.widthMm : (s.width / 96 * 25.4);
  const wPx = Math.round(effWidthMm / 25.4 * dpi);
  const hPx = Math.round(wPx * s.height / s.width);
  const res = { svg: s.svg, widthMm: s.widthMm, heightMm: s.heightMm, widthPx: wPx, heightPx: hPx, dpi };
  if (formats.includes('png') || formats.includes('tiff') || formats.includes('pdf')) {
    const cv = await rasterize(s.svg, wPx, hPx, { transparent: background === 'transparent' });
    if (formats.includes('png')) res.png = canvasToPng(cv, dpi);
    if (formats.includes('tiff')) {
      const id = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
      res.tiff = encodeTiff(id, dpi, { alpha: background === 'transparent' });
    }
    if (formats.includes('pdf')) {
      // PDF sin canal alfa: se aplana sobre blanco aunque se pida transparente
      const { data } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
      const rgb = new Uint8Array(cv.width * cv.height * 3);
      for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
        const a = data[i + 3] / 255;
        rgb[j] = Math.round(data[i] * a + 255 * (1 - a));
        rgb[j + 1] = Math.round(data[i + 1] * a + 255 * (1 - a));
        rgb[j + 2] = Math.round(data[i + 2] * a + 255 * (1 - a));
      }
      const wPt = effWidthMm / 25.4 * 72;
      res.pdf = encodePdf(await deflateZlib(rgb), cv.width, cv.height, wPt, wPt * cv.height / cv.width);
    }
  }
  return res;
}
