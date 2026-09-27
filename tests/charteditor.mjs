// tests/charteditor.mjs — Test unitario y de integración para:
// 1. Editor gráfico (attachChartEditor): títulos desde la barra Personalizar.
//    (El modal legacy openChartEditor se retiró en la Fase 1, 27 sep 2026.)
// 2. Limpieza UI con botones de icono cuadrado (.ql-btn-icon-sq) en la tabla Sanger.
// 3. Integración en el diagrama aluvial con parámetros geométricos y reactividad.

import {
  attachChartEditor,
  exportSvg,
  exportPng,
  serializeSvg,
  sanitizeFilename,
  inlineComputedStyles,
} from '../js/lib/chartEditor.js';
import * as taxaModule from '../js/modules/taxa.js';
import * as taxaBarplotModule from '../js/modules/taxaBarplot.js';
import { computeAlluvialLayout } from '../js/lib/alluvial.js';

let failed = false;
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + (detail ? '  ' + detail : ''));
  if (!ok) failed = true;
}

// ---- Mini entorno DOM mock para testing de componentes UI ----
function createMockDOM() {
  const listeners = new Map();
  let nextId = 1;

  function makeEl(tagName) {
    const el = {
      _uid: nextId++,
      tagName: tagName.toUpperCase(),
      attributes: {},
      // objeto plano + los 3 métodos de CSSStyleDeclaration que usa el motor
      // --fig-* (applyFigureStyle en chartEditor.js): el resto del código ya
      // solo hace asignación directa de propiedad (el.style.fill = '#fff'),
      // que un objeto plano soporta sin más.
      style: {
        setProperty(k, v) { this[k] = v; },
        removeProperty(k) { delete this[k]; },
        getPropertyValue(k) { return this[k] || ''; },
      },
      classList: {
        _classes: new Set(),
        add(...cls) { cls.forEach((c) => el.classList._classes.add(c)); },
        remove(...cls) { cls.forEach((c) => el.classList._classes.delete(c)); },
        toggle(cls, force) {
          if (force === undefined) {
            if (el.classList._classes.has(cls)) el.classList._classes.delete(cls);
            else el.classList._classes.add(cls);
          } else if (force) {
            el.classList._classes.add(cls);
          } else {
            el.classList._classes.delete(cls);
          }
        },
        contains(cls) { return el.classList._classes.has(cls); },
      },
      children: [],
      parentElement: null,
      _value: '',
      _checked: false,
      _listeners: {},

      get id() { return el.attributes.id || ''; },
      set id(val) { el.attributes.id = val; },

      get className() { return Array.from(el.classList._classes).join(' '); },
      set className(val) {
        el.classList._classes.clear();
        String(val || '').split(/\s+/).filter(Boolean).forEach((c) => el.classList._classes.add(c));
      },

      get value() { return el._value; },
      set value(v) { el._value = String(v); },

      get checked() { return el._checked; },
      set checked(v) { el._checked = Boolean(v); },

      get textContent() {
        if (el._textContent !== undefined) return el._textContent;
        if (el.children && el.children.length > 0) {
          return el.children.map((c) => c.textContent || '').join('');
        }
        return '';
      },
      set textContent(txt) {
        el._textContent = String(txt);
      },

      get firstChild() { return el.children[0] || null; },
      get lastElementChild() { return el.children[el.children.length - 1] || null; },

      get parentNode() { return el.parentElement; },
      set parentNode(p) { el.parentElement = p; },

      setAttribute(k, v) { el.attributes[k] = String(v); },
      getAttribute(k) { return el.attributes[k] || null; },
      removeAttribute(k) { delete el.attributes[k]; },
      hasAttribute(k) { return k in el.attributes; },

      appendChild(child) {
        if (!child) return child;
        if (typeof child === 'string') {
          child = makeEl('#text');
          child.textContent = child;
        }
        child.parentElement = el;
        el.children.push(child);
        return child;
      },
      insertBefore(newChild, refChild) {
        if (!newChild) return newChild;
        if (newChild.parentElement) newChild.parentElement.removeChild(newChild);
        newChild.parentElement = el;
        const idx = refChild ? el.children.indexOf(refChild) : -1;
        if (idx >= 0) {
          el.children.splice(idx, 0, newChild);
        } else {
          el.children.push(newChild);
        }
        return newChild;
      },
      removeChild(child) {
        const idx = el.children.indexOf(child);
        if (idx >= 0) {
          el.children.splice(idx, 1);
          child.parentElement = null;
        }
        return child;
      },
      remove() {
        if (el.parentElement) {
          el.parentElement.removeChild(el);
        }
      },
      addEventListener(type, fn) {
        el._listeners[type] = el._listeners[type] || [];
        el._listeners[type].push(fn);
      },
      removeEventListener(type, fn) {
        if (!el._listeners[type]) return;
        el._listeners[type] = el._listeners[type].filter((cb) => cb !== fn);
      },
      dispatchEvent(type, ev = {}) {
        const list = el._listeners[type] || [];
        list.forEach((cb) => cb({ target: el, ...ev }));
      },
      querySelector(selector) {
        return findFirst(el, selector);
      },
      querySelectorAll(selector) {
        const results = [];
        findAll(el, selector, results);
        return results;
      },
      getBoundingClientRect() {
        return { top: 50, left: 50, width: 600, height: 500, right: 650, bottom: 550 };
      },
      getBBox() {
        return { x: 10, y: 10, width: 100, height: 20 };
      },
      click() {
        el.dispatchEvent('click');
        if (el.tagName === 'A') {
          doc._downloads = doc._downloads || [];
          doc._downloads.push({
            href: el.getAttribute('href') || el.href,
            download: el.getAttribute('download') || el.download,
          });
        }
      },
      cloneNode(deep = false) {
        const clone = makeEl(el.tagName);
        clone.attributes = { ...el.attributes };
        clone.style = { ...el.style };
        clone.classList._classes = new Set(el.classList._classes);
        clone.textContent = el.textContent;
        clone._value = el._value;
        clone._checked = el._checked;
        if (el._innerHTML !== undefined) {
          clone._innerHTML = el._innerHTML;
        }
        if (deep && el.children) {
          el.children.forEach((c) => {
            if (c && c.cloneNode) clone.appendChild(c.cloneNode(true));
          });
        }
        return clone;
      },
      showModal() {
        el.open = true;
        el.setAttribute('open', '');
      },
      close() {
        el.open = false;
        el.removeAttribute('open');
        el.dispatchEvent('close');
      },
    };

    if (tagName.toLowerCase() === 'canvas') {
      el.width = 300;
      el.height = 150;
      const ctx = {
        fillStyle: '#000000',
        fillRect(x, y, w, h) {
          el._fillRects = el._fillRects || [];
          el._fillRects.push({ fillStyle: ctx.fillStyle, x, y, w, h });
        },
        drawImage(img, dx, dy, dw, dh) {
          el._drawImages = el._drawImages || [];
          el._drawImages.push({ img, dx, dy, dw, dh });
        },
        // getImageData: usado por exportFigure(..., {formats:['tiff']}) en
        // figureExport.js para leer los píxeles a codificar. El mock no
        // rasteriza nada de verdad, así que basta un buffer del tamaño
        // correcto (todo ceros) para que encodeTiff no reciba undefined.
        getImageData(x, y, w, h) {
          return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
        },
      };
      el.getContext = (type) => (type === '2d' ? ctx : null);
      el.toDataURL = (type) => `data:${type || 'image/png'};base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==`;
    }

    Object.defineProperty(el, 'viewBox', {
      get() {
        const vbAttr = el.getAttribute('viewBox');
        if (vbAttr) {
          const parts = vbAttr.trim().split(/[\s,]+/).map(Number);
          if (parts.length === 4) {
            return { baseVal: { x: parts[0], y: parts[1], width: parts[2], height: parts[3] } };
          }
        }
        return { baseVal: { x: 0, y: 0, width: 600, height: 500 } };
      },
    });

    // Helper para innerHTML sencillo
    Object.defineProperty(el, 'innerHTML', {
      get() { return el._innerHTML || ''; },
      set(html) {
        el._innerHTML = html;
        parseSimpleHtml(html, el);
      },
    });

    return el;
  }

  function parseSimpleHtml(html, parent) {
    parent.children = [];
    if (!html.includes('<')) {
      parent.textContent = html;
      return;
    }
    const tagRegex = /<([a-z0-9-]+)([^>]*)>(.*?)<\/\1>|<([a-z0-9-]+)([^>]*)\/>/gis;
    let match;
    let hasChildren = false;
    while ((match = tagRegex.exec(html)) !== null) {
      hasChildren = true;
      const tag = match[1] || match[4];
      const attrsStr = match[2] || match[5] || '';
      const inner = match[3] || '';
      const child = makeEl(tag);
      parseAttrs(attrsStr, child);
      if (inner) child.innerHTML = inner;
      parent.appendChild(child);
    }
    if (!hasChildren && html.includes('<')) {
      // Tags autocontenidos como input
      const singleTagRegex = /<([a-z0-9-]+)([^>]*)>/gi;
      let m2;
      while ((m2 = singleTagRegex.exec(html)) !== null) {
        const tag = m2[1];
        const attrsStr = m2[2] || '';
        const child = makeEl(tag);
        parseAttrs(attrsStr, child);
        parent.appendChild(child);
      }
    }
  }

  function parseAttrs(attrStr, el) {
    const attrRegex = /([a-z0-9_:-]+)(?:="([^"]*)")?/gi;
    let match;
    while ((match = attrRegex.exec(attrStr)) !== null) {
      const name = match[1];
      const val = match[2] !== undefined ? match[2] : '';
      if (name === 'id') el.id = val;
      else if (name === 'class') el.className = val;
      else if (name === 'type') { el.type = val; el.setAttribute('type', val); }
      else if (name === 'value') { el.value = val; el.setAttribute('value', val); }
      else if (name === 'min') { el.min = val; el.setAttribute('min', val); }
      else if (name === 'max') { el.max = val; el.setAttribute('max', val); }
      else if (name === 'step') { el.step = val; el.setAttribute('step', val); }
      else el.setAttribute(name, val);
    }
  }

  function matchesSelector(el, selector) {
    if (!el || !selector) return false;
    if (selector.includes(',')) {
      return selector.split(',').some((part) => matchesSelector(el, part.trim()));
    }
    if (selector.startsWith('#')) return el.id === selector.slice(1);
    if (selector.startsWith('.')) {
      const cls = selector.slice(1).split(/[ .[:]/)[0];
      return el.classList.contains(cls);
    }
    const attrMatch = selector.match(/^([a-z0-9_-]*)\[([a-z0-9_-]+)(?:="([^"]*)")?\]$/i);
    if (attrMatch) {
      const [, tag, k, v] = attrMatch;
      if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      if (v === undefined) return el.hasAttribute(k);
      return el.getAttribute(k) === v || (k === 'type' && el.type === v);
    }
    return el.tagName.toLowerCase() === selector.toLowerCase();
  }

  function findFirst(root, selector) {
    for (const child of root.children) {
      if (matchesSelector(child, selector)) return child;
      const sub = findFirst(child, selector);
      if (sub) return sub;
    }
    return null;
  }

  function findAll(root, selector, acc) {
    for (const child of root.children) {
      if (matchesSelector(child, selector)) acc.push(child);
      findAll(child, selector, acc);
    }
  }

  const headEl = makeEl('head');
  const bodyEl = makeEl('body');

  const doc = {
    head: headEl,
    body: bodyEl,
    createElement: (tag) => makeEl(tag),
    createElementNS: (ns, tag) => makeEl(tag),
    createTextNode: (txt) => {
      const el = makeEl('#text');
      el.textContent = txt;
      return el;
    },
    getElementById: (id) => findFirst(doc.body, '#' + id) || findFirst(doc.head, '#' + id),
    querySelector: (sel) => findFirst(doc.body, sel) || findFirst(doc.head, sel),
    querySelectorAll: (sel) => {
      const results = [];
      findAll(doc.body, sel, results);
      return results;
    },
    addEventListener: (type, fn) => {},
    removeEventListener: (type, fn) => {},
  };

  if (typeof globalThis.XMLSerializer === 'undefined') {
    globalThis.XMLSerializer = class XMLSerializer {
      serializeToString(node) {
        function ser(n) {
          if (!n) return '';
          if (n.tagName === '#TEXT') return n.textContent || '';
          const tag = n.tagName.toLowerCase();
          let attrs = '';
          if (n.attributes) {
            for (const [k, v] of Object.entries(n.attributes)) {
              attrs += ` ${k}="${String(v).replace(/"/g, '&quot;')}"`;
            }
          }
          if (n.children && n.children.length > 0) {
            const inner = n.children.map(ser).join('');
            return `<${tag}${attrs}>${inner}</${tag}>`;
          }
          if (n.textContent) {
            return `<${tag}${attrs}>${n.textContent}</${tag}>`;
          }
          return `<${tag}${attrs}/>`;
        }
        return ser(node);
      }
    };
  }

  if (typeof globalThis.Image === 'undefined') {
    globalThis.Image = class MockImage {
      constructor() {
        this._src = '';
        this.onload = null;
        this.onerror = null;
      }
      get src() { return this._src; }
      set src(val) {
        this._src = val;
        setTimeout(() => {
          if (typeof this.onload === 'function') {
            this.onload();
          }
        }, 5);
      }
    };
  }

  return { doc, makeEl };
}

console.log('\n--- 1. attachChartEditor: títulos desde la barra Personalizar ---');
{
  const { doc, makeEl } = createMockDOM();
  globalThis.document = doc;
  globalThis.window = {
    getComputedStyle: () => ({ getPropertyValue: () => '#2a78d6' }),
  };

  // Comprobar attachChartEditor en modo Personalizar (Global Text Editor)
  const mountAttach = makeEl('div');
  doc.body.appendChild(mountAttach);
  const svgAttach = makeEl('svg');
  const mainSvgT = makeEl('text');
  mainSvgT.className = 'ql-chart-main-title';
  mainSvgT.textContent = 'Título Inicial Toolbar';
  svgAttach.appendChild(mainSvgT);

  const xSvgT = makeEl('text');
  xSvgT.className = 'ql-chart-x-title';
  xSvgT.textContent = 'X Inicial Toolbar';
  svgAttach.appendChild(xSvgT);

  const ySvgT = makeEl('text');
  ySvgT.className = 'ql-chart-y-title';
  ySvgT.textContent = 'Y Inicial Toolbar';
  svgAttach.appendChild(ySvgT);

  attachChartEditor({
    key: 'testGlobalAttach',
    svg: svgAttach,
    mount: mountAttach,
    filename: 'test_global',
    lang: 'es',
    elements: [
      { id: 'title', selector: '.ql-chart-main-title' },
      { id: 'xtitle', selector: '.ql-chart-x-title' },
      { id: 'ytitle', selector: '.ql-chart-y-title' },
    ]
  });

  const customBtn = Array.from(mountAttach.querySelectorAll('button')).find((b) => b.innerHTML.includes('Personalizar'));
  check('attachChartEditor genera botón Personalizar', Boolean(customBtn));
  if (customBtn) {
    customBtn.dispatchEvent('click');
    const titlesSec = mountAttach.querySelector('.ce-titles-section');
    check('al pulsar Personalizar se despliega la sección de títulos (.ce-titles-section)', Boolean(titlesSec));

    const inpMain = mountAttach.querySelector('.ql-ce-title-input');
    const inpX = mountAttach.querySelector('.ql-ce-xtitle-input');
    const inpY = mountAttach.querySelector('.ql-ce-ytitle-input');

    check('sección contiene input de título (.ql-ce-title-input)', Boolean(inpMain));
    check('sección contiene input de eje X (.ql-ce-xtitle-input)', Boolean(inpX));
    check('sección contiene input de eje Y (.ql-ce-ytitle-input)', Boolean(inpY));

    if (inpMain) {
      inpMain.value = 'Título Modificado en Toolbar';
      inpMain.dispatchEvent('input');
      check('evento input en toolbar actualiza reactivamente .ql-chart-main-title en SVG',
        mainSvgT.textContent === 'Título Modificado en Toolbar');
    }

    if (inpX) {
      inpX.value = 'Tratamiento A/B';
      inpX.dispatchEvent('input');
      check('evento input en toolbar actualiza reactivamente .ql-chart-x-title en SVG',
        xSvgT.textContent === 'Tratamiento A/B');
    }

    if (inpY) {
      inpY.value = 'Abundancia %';
      inpY.dispatchEvent('input');
      check('evento input en toolbar actualiza reactivamente .ql-chart-y-title en SVG',
        ySvgT.textContent === 'Abundancia %');
    }
  }
}

console.log('\n--- 2. Limpieza de tabla Sanger en js/modules/sanger.js ---');
{
  const { doc, makeEl } = createMockDOM();
  globalThis.document = doc;

  // Importar el archivo crudo de sanger.js para verificar la estructura generada
  const sangerJsContent = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../js/modules/sanger.js', import.meta.url), 'utf8')
  );

  check('tabla Sanger usa contenedor flexbox ql-table-actions', sangerJsContent.includes('actionsGroup.className = \'ql-table-actions\';'));
  check('tabla Sanger usa botones cuadrados ql-btn-icon-sq', sangerJsContent.includes('ovBtn.className = \'ql-btn-icon-sq\';') && sangerJsContent.includes('compBtn.className = \'ql-btn-icon-sq\';'));
  check('botón de solapamiento tiene icono SVG de ojo', sangerJsContent.includes('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>'));
  check('botón de comparación tiene icono SVG de capas', sangerJsContent.includes('<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>'));
  check('botones tienen atributo title para accesibilidad y tooltip hover', sangerJsContent.includes('ovBtn.title = t(\'sanger.inspectOverlapTitle\');') && sangerJsContent.includes('compBtn.title = t(\'sanger.compareWithRef\');'));
  check('se eliminaron los botones de texto antiguos "Ver solapamiento" de la tabla', !sangerJsContent.includes('ovBtn.textContent = t(\'sanger.inspectOverlap\')'));
  check('se eliminaron los botones de texto antiguos "Comparar con Referencia" de la tabla', !sangerJsContent.includes('compBtn.textContent = t(\'sanger.compareWithRef\')'));
}

console.log('\n--- 3. Integración en el Diagrama Aluvial (js/modules/taxa.js y taxaBarplot.js) ---');
{
  check('taxa.js exporta función render correctamente', typeof taxaModule.render === 'function');
  check('taxaBarplot.js exporta función render correctamente', typeof taxaBarplotModule.render === 'function');

  // Verificar que computeAlluvialLayout responde correctamente a cambios de geometría
  const mockData = {
    groups: ['Control', 'Tratamiento'],
    taxa: [
      { key: 't1', label: 'Bacteroides', colorVar: '--cat-1' },
      { key: 't2', label: 'Prevotella', colorVar: '--cat-2' },
    ],
    matrix: {
      Control: { t1: 0.6, t2: 0.4 },
      Tratamiento: { t1: 0.3, t2: 0.7 },
    },
    sampleCounts: { Control: 5, Tratamiento: 5 },
  };

  const layoutDefault = computeAlluvialLayout(mockData, {
    width: 600,
    height: 400,
    margin: { top: 20, right: 20, bottom: 20, left: 20 },
    nodeWidth: 20,
    nodeGap: 2,
  });

  const layoutWide = computeAlluvialLayout(mockData, {
    width: 600,
    height: 400,
    margin: { top: 20, right: 20, bottom: 20, left: 20 },
    nodeWidth: 40,
    nodeGap: 8,
  });

  check('nodo estándar tiene ancho 20', layoutDefault.nodes[0].width === 20);
  check('nodo expandido tiene ancho 40', layoutWide.nodes[0].width === 40);
  check('el cambio geométrico se refleja en las curvas de enlace Bézier',
    layoutDefault.links[0].d !== layoutWide.links[0].d);

  // El aluvial migró del modal openChartEditor (botón "⚙ Ajustes" aparte) a
  // attachChartEditor + cfg.geometrySliders el 22 sep 2026 — ver nota de
  // arquitectura al principio de js/lib/chartEditor.js y qiimelab-prompt-
  // editor-fase-0-fundamentos.md Paso 1. Unifica con el resto de ~28 vistas
  // (mismo botón "Personalizar" para todo) y de paso hace persistente la
  // geometría entre sesiones, cosa que el modal no hacía.
  const taxaBarplotContent = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../js/modules/taxaBarplot.js', import.meta.url), 'utf8')
  );

  check('taxaBarplot.js NO tiene ya el botón de ajustes aparte (unificado en "Personalizar")',
    !taxaBarplotContent.includes('ql-btn-settings') && !taxaBarplotContent.includes('openTaxaChartEditor'));
  check('taxaBarplot.js migró el aluvial a attachChartEditor con geometrySliders',
    taxaBarplotContent.includes('geometrySliders:') && taxaBarplotContent.includes('onGeometryChange:'));
  check('taxaBarplot.js ya no invoca el openChartEditor legacy',
    !taxaBarplotContent.includes('openChartEditor(svg'));
  check('taxaBarplot.js actualiza geometría en tiempo real (alluvialNodeWidth, alluvialNodeGap, alluvialLinkOpacity)',
    taxaBarplotContent.includes("id === 'nodeWidth') alluvialNodeWidth = Number(val)") &&
    taxaBarplotContent.includes("id === 'nodeGap') alluvialNodeGap = Number(val)") &&
    taxaBarplotContent.includes("id === 'linkOpacity') alluvialLinkOpacity = Number(val)"));
  check('taxaBarplot.js siembra la geometría persistida con getFigureGeometry antes del primer pintado',
    taxaBarplotContent.includes('getFigureGeometry(ALLUVIAL_CE_KEY)'));
}

console.log('\n--- 4. Motor de exportación vectorial (SVG) y rasterizado (PNG 300 dpi) ---');
{
  const { doc, makeEl } = createMockDOM();
  globalThis.document = doc;
  globalThis.window = {
    getComputedStyle: (el) => ({
      getPropertyValue: (p) => {
        if (p === 'fill') return '#1e40af';
        if (p === 'font-family') return 'var(--font-body)';
        return '';
      },
    }),
  };

  // 4.1 Sanitización de nombres de archivo
  check('sanitizeFilename limpia extensiones repetidas y caracteres inválidos',
    sanitizeFilename('mi gráfico (2026).svg') === 'mi_gráfico_2026');
  check('sanitizeFilename usa nombre por defecto si la entrada es vacía',
    sanitizeFilename('', 'smart175_figura') === 'smart175_figura');
  check('sanitizeFilename limpia caracteres especiales como slashes y dos puntos',
    sanitizeFilename('taxa/alluvial:v1.png') === 'taxa_alluvial_v1');

  // 4.2 Serialización de SVG con fondo blanco sólido y sin artefactos de edición
  const testSvg = makeEl('svg');
  testSvg.setAttribute('viewBox', '0 0 800 600');
  testSvg.classList.add('ce-editing');

  const hitBox = makeEl('rect');
  hitBox.className = 'ce-hit';
  testSvg.appendChild(hitBox);

  const outline = makeEl('rect');
  outline.className = 'ce-outline';
  testSvg.appendChild(outline);

  const dataGroup = makeEl('g');
  dataGroup.className = 'ce-el ce-selected';
  const textNode = makeEl('text');
  textNode.textContent = 'Figura de Microbiota';
  dataGroup.appendChild(textNode);
  testSvg.appendChild(dataGroup);

  const serialized = serializeSvg(testSvg);
  check('serializeSvg inicia con declaración XML UTF-8',
    serialized.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  check('serializeSvg incluye atributos xmlns y dimensiones',
    serialized.includes('xmlns="http://www.w3.org/2000/svg"') && serialized.includes('width="800"') && serialized.includes('height="600"'));
  check('serializeSvg inyecta rect de fondo blanco sólido (#ffffff)',
    serialized.includes('<rect') && serialized.includes('fill="#ffffff"') && serialized.includes('class="ce-export-bg"'));
  check('serializeSvg elimina clases ce-editing y ce-selected del clon',
    !serialized.includes('ce-editing') && !serialized.includes('ce-selected'));
  check('serializeSvg elimina elementos auxiliares ce-hit y ce-outline',
    !serialized.includes('ce-hit') && !serialized.includes('ce-outline'));
  check('el SVG original en el DOM conserva sus clases y estructura intacta',
    testSvg.classList.contains('ce-editing') && testSvg.querySelector('.ce-hit') !== null);

  // 4.3 Exportación vectorial (SVG)
  doc._downloads = [];
  const svgExportResult = exportSvg(testSvg, 'figura_paper');
  check('exportSvg devuelve objeto con str, filename y blob',
    svgExportResult && typeof svgExportResult.str === 'string' && svgExportResult.filename === 'figura_paper.svg' && svgExportResult.blob !== null);
  check('exportSvg genera blob con tipo image/svg+xml;charset=utf-8',
    svgExportResult.blob && svgExportResult.blob.type === 'image/svg+xml;charset=utf-8');
  const lastSvgDl = doc._downloads[doc._downloads.length - 1];
  check('exportSvg simula descarga automática mediante enlace con nombre seguro',
    lastSvgDl && lastSvgDl.download === 'figura_paper.svg');

  // 4.4 Exportación rasterizada en alta resolución (PNG 300+ dpi)
  const pngExportPromise = exportPng(testSvg, 'figura_alta_res', 4);
  const pngExportResult = await pngExportPromise;

  check('exportPng resuelve promesa con metadata de imagen',
    Boolean(pngExportResult && pngExportResult.filename === 'figura_alta_res.png'));
  check('exportPng escala dimensiones por factor 4x (300+ dpi)',
    pngExportResult.width === 3200 && pngExportResult.height === 2400 && pngExportResult.scale === 4);
  check('exportPng rellena el canvas con fondo blanco sólido (#ffffff)',
    pngExportResult.canvas._fillRects &&
    pngExportResult.canvas._fillRects.some((r) => r.fillStyle === '#ffffff' && r.w === 3200 && r.h === 2400));
  check('exportPng dibuja la imagen escalada en el canvas en onload',
    pngExportResult.canvas._drawImages &&
    pngExportResult.canvas._drawImages.some((d) => d.dw === 3200 && d.dh === 2400));
  check('exportPng exporta con canvas.toDataURL("image/png")',
    typeof pngExportResult.dataUrl === 'string' && pngExportResult.dataUrl.startsWith('data:image/png'));
  const lastPngDl = doc._downloads[doc._downloads.length - 1];
  check('exportPng dispara descarga con elemento <a> y nombre dinámico .png',
    lastPngDl && lastPngDl.download === 'figura_alta_res.png');

  // 4.5 Botones de exportación en la barra de herramientas (attachChartEditor)
  const mountTb = makeEl('div');
  doc.body.appendChild(mountTb);
  const svgTb = makeEl('svg');
  svgTb.setAttribute('viewBox', '0 0 600 400');
  mountTb.appendChild(svgTb);

  const editorTb = attachChartEditor({
    key: 'testExportToolbar',
    svg: svgTb,
    mount: mountTb,
    filename: 'smart175_test_tb',
    lang: 'es',
  });

  // Fase 1: un desplegable de formato + un solo botón "Descargar" (antes, un
  // botón por formato)
  const allTbBtns = Array.from(mountTb.querySelectorAll('button'));
  const oldBtns = allTbBtns.filter((b) => b.textContent && /Descargar (SVG|PNG|TIFF)/.test(b.textContent));
  const btnDl = allTbBtns.find((b) => b.classList.contains('ce-download-btn'));
  const fmtSel = Array.from(mountTb.querySelectorAll('select')).find((s) => s.classList.contains('ce-export-format'));
  const fmtVals = fmtSel ? fmtSel.children.map((o) => o.value) : [];

  check('ya no hay un botón por formato (Descargar SVG/PNG/TIFF)', oldBtns.length === 0, oldBtns.map((b) => b.textContent).join(','));
  check('la barra tiene un desplegable de formato con svg/png/tiff/pdf', JSON.stringify(fmtVals) === '["svg","png","tiff","pdf"]', JSON.stringify(fmtVals));
  check('la barra tiene un único botón "Descargar"', Boolean(btnDl) && /Descargar/.test(btnDl.textContent));

  // pdf no se pulsa aquí: necesita getImageData + CompressionStream reales
  // (se comprueba en el navegador en tests/figureexport.mjs)
  for (const fmt of ['svg', 'png', 'tiff']) {
    if (!btnDl || !fmtSel) break;
    doc._downloads = [];
    fmtSel.value = fmt;
    btnDl.dispatchEvent('click');
    // PNG/TIFF son async (rasterizado simulado)
    await new Promise((r) => setTimeout(r, 30));
    const dl = doc._downloads[doc._downloads.length - 1];
    check('formato "' + fmt + '" + Descargar → descarga smart175_test_tb.' + fmt,
      dl && dl.download === 'smart175_test_tb.' + fmt, dl && dl.download);
  }

  editorTb.destroy();
}

console.log('\n--- 5. Resumen de resultados ---');
if (failed) {
  console.error('❌ Fallaron algunos tests.');
  process.exit(1);
} else {
  console.log('✅ Todos los tests pasaron exitosamente.');
  process.exit(0);
}
