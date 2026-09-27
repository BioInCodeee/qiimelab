// chartExport.js — exportación: descargas SVG/PNG/TIFF de attachChartEditor
// (vía js/lib/figureExport.js, ancho físico en mm) y el pipeline antiguo
// serializeSvg/exportSvg/exportPng (API pública; sin usos en la app desde que
// se borró openChartEditor, solo en tests/charteditor.mjs).
//
// Parte del editor de figuras troceado desde js/lib/chartEditor.js (Fase 0b,
// sin cambios de comportamiento). Reparto y patrón `ctx`: js/lib/chart/chartEditor.js.

import { exportFigure, serializeForExport } from '../figureExport.js';
import { NS } from './chartStyles.js';

/**
 * Sanitiza nombres de archivo para descargas de figuras científicas.
 */
export function sanitizeFilename(filename, defaultName = 'smart175_figura') {
  if (!filename || typeof filename !== 'string') return defaultName;
  let name = filename.trim().replace(/\.(svg|png)$/i, '');
  const clean = name.replace(/[^a-z0-9_\u00C0-\u024F-]+/gi, '_').replace(/^_+|_+$/g, '');
  return clean || defaultName;
}

/**
 * Copia estilos calculados (fills, strokes, tipografías) a atributos inline del clon
 * para garantizar que el SVG conserve su aspecto exacto fuera de la aplicación.
 */
export function inlineComputedStyles(srcRoot, dstRoot) {
  if (!srcRoot || !dstRoot) return;
  const getCS = (typeof getComputedStyle === 'function')
    ? getComputedStyle
    : ((typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') ? window.getComputedStyle : null);
  if (!getCS) return;

  const src = srcRoot.querySelectorAll ? srcRoot.querySelectorAll('*') : [];
  const dst = dstRoot.querySelectorAll ? dstRoot.querySelectorAll('*') : [];
  const props = [
    'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
    'stroke-linejoin', 'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-weight',
    'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'stop-color', 'stop-opacity'
  ];
  const copy = (a, b) => {
    try {
      const cs = getCS(a);
      if (!cs) return;
      let decl = '';
      props.forEach((p) => {
        const v = cs.getPropertyValue ? cs.getPropertyValue(p) : cs[p];
        if (v && v !== 'normal' && v !== 'none' || (p === 'fill' && v)) {
          if (v) decl += p + ':' + v + ';';
        }
      });
      if (decl && b.setAttribute) {
        const prev = b.getAttribute('style') || '';
        b.setAttribute('style', decl + prev);
      }
    } catch (e) {}
  };
  copy(srcRoot, dstRoot);
  for (let i = 0; i < src.length && i < dst.length; i++) {
    if (dst[i].classList && (dst[i].classList.contains('ce-hit') || dst[i].classList.contains('ce-outline'))) continue;
    copy(src[i], dst[i]);
  }
}

/**
 * Serializa un nodo SVG a XML estándar, incrustando estilos calculados y
 * añadiendo un fondo blanco sólido (#ffffff) permanente para revistas científicas.
 */
export function serializeSvg(svgEl) {
  if (!svgEl) return '';
  const clone = svgEl.cloneNode(true);
  if (clone.classList && clone.classList.remove) {
    clone.classList.remove('ce-editing');
  }
  if (clone.querySelectorAll) {
    clone.querySelectorAll('.ce-hit, .ce-outline').forEach((n) => n.remove());
    clone.querySelectorAll('.ce-el').forEach((g) => {
      if (g.classList && g.classList.remove) g.classList.remove('ce-selected');
    });
  }
  inlineComputedStyles(svgEl, clone);

  const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
  let w = vb && vb.width ? vb.width : (svgEl.getBoundingClientRect ? svgEl.getBoundingClientRect().width : 0);
  let h = vb && vb.height ? vb.height : (svgEl.getBoundingClientRect ? svgEl.getBoundingClientRect().height : 0);
  if (!w || !h) {
    w = parseFloat(svgEl.getAttribute('width')) || 800;
    h = parseFloat(svgEl.getAttribute('height')) || 600;
  }
  w = Math.round(w);
  h = Math.round(h);

  clone.setAttribute('xmlns', NS);
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  if (!clone.getAttribute('viewBox')) {
    const vx = vb && vb.x !== undefined ? vb.x : 0;
    const vy = vb && vb.y !== undefined ? vb.y : 0;
    clone.setAttribute('viewBox', `${vx} ${vy} ${w} ${h}`);
  }
  clone.removeAttribute('style');

  // Fondo blanco sólido (#ffffff) permanente para publicación científica
  if (clone.querySelectorAll) {
    clone.querySelectorAll('.ce-export-bg').forEach((n) => n.remove());
  }
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('class', 'ce-export-bg');
  const vx = vb && vb.x !== undefined ? vb.x : 0;
  const vy = vb && vb.y !== undefined ? vb.y : 0;
  bg.setAttribute('x', String(vx));
  bg.setAttribute('y', String(vy));
  bg.setAttribute('width', String(w));
  bg.setAttribute('height', String(h));
  bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);

  let serializer;
  if (typeof XMLSerializer !== 'undefined') {
    serializer = new XMLSerializer();
  } else if (typeof globalThis !== 'undefined' && globalThis.XMLSerializer) {
    serializer = new globalThis.XMLSerializer();
  }
  let str = serializer ? serializer.serializeToString(clone) : (clone.outerHTML || '');
  if (!str.startsWith('<?xml')) {
    str = '<?xml version="1.0" encoding="UTF-8"?>\n' + str;
  }
  return str;
}

/**
 * Exporta un elemento SVG a archivo vectorial .svg con descarga automática en el navegador.
 *
 * @param {SVGElement} svgEl - Elemento SVG a exportar
 * @param {string} [filename='smart175_figura'] - Nombre de archivo
 * @returns {{ str: string, filename: string, blob: Blob|null }}
 */
export function exportSvg(svgEl, filename = 'smart175_figura') {
  if (!svgEl) {
    throw new Error('No SVG element provided for exportSvg');
  }
  const str = serializeSvg(svgEl);
  const downloadName = sanitizeFilename(filename, 'smart175_figura') + '.svg';
  let blob = null;

  try {
    blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof document !== 'undefined') {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      a.style.display = 'none';
      if (document.body) {
        document.body.appendChild(a);
      }
      a.click();
      a.remove();
      setTimeout(() => {
        try { URL.revokeObjectURL(url); } catch (e) {}
      }, 4000);
    }
  } catch (e) {
    // Entorno restringido / headless
  }

  return { str, filename: downloadName, blob };
}

/**
 * Exporta un elemento SVG a imagen rasterizada PNG en alta resolución (300+ dpi)
 * renderizando en un <canvas> escalado en memoria con fondo blanco sólido (#ffffff).
 *
 * @param {SVGElement} svgEl - Elemento SVG a exportar
 * @param {string} [filename='smart175_figura'] - Nombre de archivo
 * @param {number} [scale=4] - Factor de escala para 300+ dpi (por defecto 4x)
 * @returns {Promise<{ canvas: HTMLCanvasElement, dataUrl: string, filename: string, width: number, height: number, scale: number }>}
 */
export function exportPng(svgEl, filename = 'smart175_figura', scale = 4) {
  return new Promise((resolve, reject) => {
    try {
      if (!svgEl) {
        throw new Error('No SVG element provided for exportPng');
      }

      const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
      let w = vb && vb.width ? vb.width : (svgEl.getBoundingClientRect ? svgEl.getBoundingClientRect().width : 0);
      let h = vb && vb.height ? vb.height : (svgEl.getBoundingClientRect ? svgEl.getBoundingClientRect().height : 0);
      if (!w || !h) {
        w = parseFloat(svgEl.getAttribute('width')) || 800;
        h = parseFloat(svgEl.getAttribute('height')) || 600;
      }
      w = Math.round(w);
      h = Math.round(h);

      const targetScale = Math.max(1, Number(scale) || 4);
      const str = serializeSvg(svgEl);

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * targetScale);
      canvas.height = Math.round(h * targetScale);

      const ctx = canvas.getContext ? canvas.getContext('2d') : null;
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      const downloadName = sanitizeFilename(filename, 'smart175_figura') + '.png';
      const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
      const url = (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function')
        ? URL.createObjectURL(blob)
        : ('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str));

      const img = (typeof Image !== 'undefined') ? new Image() : (globalThis.Image ? new globalThis.Image() : null);
      if (!img) {
        throw new Error('Image constructor is not available');
      }

      img.onload = () => {
        try {
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          }
          if (url.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            URL.revokeObjectURL(url);
          }

          let dataUrl = '';
          if (typeof canvas.toDataURL === 'function') {
            dataUrl = canvas.toDataURL('image/png');
          }

          if (dataUrl && typeof document !== 'undefined') {
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = downloadName;
            a.style.display = 'none';
            if (document.body) {
              document.body.appendChild(a);
            }
            a.click();
            a.remove();
          }

          resolve({
            canvas,
            dataUrl,
            filename: downloadName,
            width: canvas.width,
            height: canvas.height,
            scale: targetScale,
          });
        } catch (err) {
          if (url.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            try { URL.revokeObjectURL(url); } catch (e) {}
          }
          reject(err);
        }
      };

      img.onerror = (err) => {
        if (url.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          try { URL.revokeObjectURL(url); } catch (e) {}
        }
        reject(err || new Error('Error decodificando imagen SVG para exportar a PNG'));
      };

      img.src = url;
    } catch (err) {
      reject(err);
    }
  });
}

export function createExport(ctx) {
  const { T, filename, svg, writeStoreDebounced } = ctx;

  // ---- exportar SVG/PNG/TIFF vía js/lib/figureExport.js (Paso 3 de
  // qiimelab-prompt-editor-fase-0-fundamentos.md): siempre en esquema claro
  // y sin var()/color() residual, con independencia del tema activo. SVG es
  // síncrono (solo serialización DOM); PNG/TIFF son async (decodifican la
  // figura en un <canvas> antes de poder leer sus bytes).
  function downloadFilename(ext) { return sanitizeFilename(filename, 'smart175_figura') + '.' + ext; }

  function triggerDownload(data, mime, name) {
    try {
      const blob = new Blob([data], { type: mime });
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof document !== 'undefined') {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.style.display = 'none';
        if (document.body) document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* noop */ } }, 4000);
      }
    } catch (e) { /* entorno restringido / headless */ }
  }

  // ---- ancho de exportación físico (mm): store.__export.widthMm, editable
  // en la sección "Exportación" del panel (y guardado en los presets). ----
  function getExportWidthMm() { return (ctx.store.__export && ctx.store.__export.widthMm) || null; }
  function setExportWidthMm(mm) {
    if (mm > 0) ctx.store.__export = { widthMm: mm }; else delete ctx.store.__export;
    writeStoreDebounced();
  }

  function serialize() {
    return serializeForExport(svg, { scheme: 'light', background: 'white', widthMm: getExportWidthMm() }).svg;
  }

  function downloadSvg() {
    const str = serialize();
    triggerDownload(str, 'image/svg+xml;charset=utf-8', downloadFilename('svg'));
    return str;
  }

  async function downloadPng() {
    const res = await exportFigure(svg, { formats: ['png'], scheme: 'light', background: 'white', dpi: 300, widthMm: getExportWidthMm() });
    triggerDownload(res.png, 'image/png', downloadFilename('png'));
    return res;
  }

  async function downloadTiff() {
    const res = await exportFigure(svg, { formats: ['tiff'], scheme: 'light', background: 'white', dpi: 300, widthMm: getExportWidthMm() });
    triggerDownload(res.tiff, 'image/tiff', downloadFilename('tiff'));
    return res;
  }

  // PDF de una página: la figura rasterizada a 300 ppp al tamaño físico
  // (no vectorial — para editar trazos, el SVG). Ver encodePdf().
  async function downloadPdf() {
    const res = await exportFigure(svg, { formats: ['pdf'], scheme: 'light', background: 'white', dpi: 300, widthMm: getExportWidthMm() });
    triggerDownload(res.pdf, 'application/pdf', downloadFilename('pdf'));
    return res;
  }

  function renderExportSection() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-export ce-colorscale'; // mismo estilo de sección que Estructura/Presets
    wrap.innerHTML = '<h5>' + T.exportTitle + '</h5>';
    const row = document.createElement('div');
    row.className = 'ce-cs-row';
    const id = 'ce-exportwidth-' + (++ctx.cePanelUid);
    const lab = document.createElement('label');
    lab.setAttribute('for', id);
    lab.textContent = T.exportWidthLabel;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.id = id; inp.min = '10'; inp.max = '400'; inp.step = '1';
    inp.value = getExportWidthMm() || '';
    inp.addEventListener('change', () => setExportWidthMm(parseFloat(inp.value) || null));
    row.appendChild(lab); row.appendChild(inp);
    wrap.appendChild(row);
    const help = document.createElement('p');
    help.className = 'ce-hint';
    help.textContent = T.exportWidthHelp;
    wrap.appendChild(help);
    return wrap;
  }

  /** Descarga en el formato elegido en el desplegable de la barra. */
  function downloadAs(fmt) {
    const fn = { svg: downloadSvg, png: downloadPng, tiff: downloadTiff, pdf: downloadPdf }[fmt];
    return fn ? fn() : undefined;
  }

  return {
    downloadAs, downloadPdf, downloadPng, downloadSvg, downloadTiff, getExportWidthMm,
    renderExportSection, serialize, setExportWidthMm,
  };
}
