// chartElements.js — elementos editables del SVG (títulos, leyenda…):
// envoltura, selección, teclado, arrastre y panel flotante de estilo.
//
// Parte del editor de figuras troceado desde js/lib/chartEditor.js (Fase 0b,
// sin cambios de comportamiento). Reparto y patrón `ctx`: js/lib/chart/chartEditor.js.

import { isValidHex } from '../paletteValidator.js';
import { FONTS } from './chartFigureStyle.js';
import { NS } from './chartStyles.js';

export function createElements(ctx) {
  const {
    T, applyCanvasMargins, applyFigureStyle, applyGeoScale, applyPalette, cfg, elements,
    lang, st, svg, toHex, wraps, writeStore, writeStoreDebounced,
  } = ctx;

  // ---- crear / envolver elementos y aplicar estado ----
  function ensureEl(spec) {
    let inner = null;
    if (spec.selector) inner = svg.querySelector(spec.selector);
    if (!inner) inner = svg.querySelector('[data-ce="' + spec.id + '"]');
    if (!inner && spec.create) {
      inner = document.createElementNS(NS, 'text');
      inner.textContent = spec.create.text || '';
      inner.setAttribute('x', spec.create.x);
      inner.setAttribute('y', spec.create.y);
      inner.setAttribute('text-anchor', spec.create.anchor || 'middle');
      inner.setAttribute('data-ce', spec.id);
      if (spec.create.cls) inner.setAttribute('class', spec.create.cls);
      svg.appendChild(inner);
    }
    if (!inner) return null;

    // envolver en <g class="ce-el"> si no lo está ya
    let wrap = inner.parentNode;
    if (!(wrap && wrap.classList && wrap.classList.contains('ce-el'))) {
      wrap = document.createElementNS(NS, 'g');
      wrap.setAttribute('class', 'ce-el');
      wrap.setAttribute('data-ce-id', spec.id);
      inner.parentNode.insertBefore(wrap, inner);
      wrap.appendChild(inner);
    }
    wraps.set(spec.id, { wrap, inner, kind: spec.kind || 'text', create: spec.create });
    return wraps.get(spec.id);
  }

  function applyState(id) {
    const w = wraps.get(id);
    if (!w) return;
    const s = ctx.store[id] || {};
    w.wrap.setAttribute('transform', 'translate(' + (s.dx || 0) + ',' + (s.dy || 0) + ')');
    const targets = w.kind === 'group' ? w.wrap.querySelectorAll('text, tspan') : [w.inner];
    targets.forEach((el) => {
      el.style.fill = s.fill || '';
      el.style.fontFamily = s.font || '';
      el.style.fontWeight = s.bold ? '700' : (s.bold === false ? '400' : '');
      el.style.fontStyle = s.italic ? 'italic' : (s.italic === false ? 'normal' : '');
      el.style.fontSize = s.size ? s.size + 'px' : '';
    });
    if (w.kind === 'text' && typeof s.text === 'string') w.inner.textContent = s.text;
  }

  function decorate(id) {
    const w = wraps.get(id);
    if (!w) return;
    // quitar hit/outline previos
    w.wrap.querySelectorAll(':scope > .ce-hit, :scope > .ce-outline').forEach((n) => n.remove());
    if (!ctx.editing) return;
    let bb;
    try { bb = w.wrap.getBBox(); } catch (e) { return; }
    if (!bb || (bb.width === 0 && bb.height === 0)) return;
    const pad = 5;
    const mk = (cls) => {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('class', cls);
      r.setAttribute('x', bb.x - pad); r.setAttribute('y', bb.y - pad);
      r.setAttribute('width', bb.width + pad * 2); r.setAttribute('height', bb.height + pad * 2);
      r.setAttribute('rx', 3);
      return r;
    };
    const outline = mk('ce-outline');
    const hit = mk('ce-hit');
    // accesible por teclado: foco + rol + descripción; flechas mueven, Intro edita
    hit.setAttribute('tabindex', '0');
    hit.setAttribute('role', 'button');
    hit.setAttribute('aria-label', T.handle(elLabel(id)));
    w.wrap.appendChild(outline);
    w.wrap.appendChild(hit);
    hit.addEventListener('pointerdown', (e) => startDrag(e, id, hit));
    hit.addEventListener('focus', () => { ctx.selectedId = id; syncSelection(); });
    hit.addEventListener('keydown', (e) => onHitKey(e, id, hit));
  }

  // teclado sobre un "tirador": flechas mueven, Mayús multiplica el paso,
  // Intro / Espacio abren el panel de estilo, Escape lo cierra.
  function onHitKey(e, id, hit) {
    if (!ctx.editing) return;
    const STEP = e.shiftKey ? 12 : 2;
    let dx = 0, dy = 0;
    switch (e.key) {
      case 'ArrowLeft': dx = -STEP; break;
      case 'ArrowRight': dx = STEP; break;
      case 'ArrowUp': dy = -STEP; break;
      case 'ArrowDown': dy = STEP; break;
      case 'Enter': case ' ': case 'Spacebar':
        e.preventDefault();
        openPanelForHit(id, hit);
        return;
      default:
        return;
    }
    e.preventDefault();
    const s = st(id);
    s.dx = (s.dx || 0) + dx;
    s.dy = (s.dy || 0) + dy;
    const w = wraps.get(id);
    if (w) w.wrap.setAttribute('transform', 'translate(' + s.dx + ',' + s.dy + ')');
    writeStoreDebounced();
  }

  // abre el panel anclado al centro del tirador (no hay puntero en teclado)
  function openPanelForHit(id, hit) {
    let r;
    try { r = hit.getBoundingClientRect(); } catch (err) { r = null; }
    const ev = r
      ? { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
      : null;
    selectAndOpen(id, ev);
    // llevar el foco al primer control editable del panel (no al botón de cerrar)
    if (ctx.panel) {
      const first = ctx.panel.querySelector('.ce-row input, .ce-row select') || ctx.panel.querySelector('button');
      if (first) first.focus();
    }
  }

  function syncSelection() {
    wraps.forEach((w, id) => w.wrap.classList.toggle('ce-selected', id === ctx.selectedId && ctx.editing));
  }

  /** Re-encuentra, re-envuelve y re-aplica todo. Llamar tras cada re-render del gráfico. */
  function sync() {
    wraps.clear();
    elements.forEach((spec) => ensureEl(spec));
    wraps.forEach((_, id) => applyState(id));
    wraps.forEach((_, id) => decorate(id));
    syncSelection();
    // último paso a propósito: en algún gráfico (p. ej. las etiquetas de
    // grupo del Venn) el mismo <text> es a la vez un elemento de texto
    // arrastrable Y una serie de datos — si hay override de paleta, gana él.
    applyPalette();
    applyFigureStyle();
    applyGeoScale();
    applyCanvasMargins();
  }

  // ---- arrastre ----
  function svgScale() {
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width
      ? svg.viewBox.baseVal.width : r.width;
    return r.width && vb ? r.width / vb : 1;
  }
  function startDrag(e, id, hit) {
    if (!ctx.editing) return;
    e.preventDefault();
    e.stopPropagation();
    const s = st(id);
    const scale = svgScale();
    const startX = e.clientX, startY = e.clientY;
    const ox = s.dx || 0, oy = s.dy || 0;
    let moved = 0;
    try { hit.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    const onMove = (ev) => {
      const ddx = (ev.clientX - startX) / scale;
      const ddy = (ev.clientY - startY) / scale;
      moved = Math.max(moved, Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY));
      s.dx = ox + ddx; s.dy = oy + ddy;
      const w = wraps.get(id);
      if (w) w.wrap.setAttribute('transform', 'translate(' + s.dx + ',' + s.dy + ')');
    };
    const onUp = (ev) => {
      hit.removeEventListener('pointermove', onMove);
      hit.removeEventListener('pointerup', onUp);
      hit.removeEventListener('pointercancel', onUp);
      try { hit.releasePointerCapture(ev.pointerId); } catch (err) { /* noop */ }
      if (moved < 3) {
        // clic sin arrastre: si no cambió, no persistas el dx/dy=0 espurio
        if (!s.dx && !s.dy && Object.keys(s).length <= 2) { /* keep */ }
        selectAndOpen(id, ev);
      } else {
        writeStore();
      }
    };
    hit.addEventListener('pointermove', onMove);
    hit.addEventListener('pointerup', onUp);
    hit.addEventListener('pointercancel', onUp);
    selectAndOpen(id, e, true);
  }

  // ---- panel de estilo ----
  function selectAndOpen(id, ev, quiet) {
    ctx.selectedId = id;
    syncSelection();
    if (!quiet) openPanel(id, ev);
    else openPanel(id, ev);
  }
  function closePanel() {
    if (ctx.panel) { ctx.panel.remove(); ctx.panel = null; }
  }
  function openPanel(id, ev) {
    closePanel();
    const w = wraps.get(id);
    if (!w) return;
    const s = st(id);
    const cs = getComputedStyle(w.inner);
    ctx.panel = document.createElement('div');
    ctx.panel.className = 'ce-panel';
    ctx.panel.innerHTML = '<h4><span>' + elLabel(id) + '</span><button type="button" aria-label="' + T.close + '">×</button></h4>';

    const rows = document.createElement('div');
    ctx.panel.appendChild(rows);

    if (w.kind === 'text') {
      const rText = row(T.text);
      const inpText = document.createElement('input');
      inpText.type = 'text';
      inpText.value = (typeof s.text === 'string') ? s.text : w.inner.textContent;
      inpText.addEventListener('input', () => { s.text = inpText.value; w.inner.textContent = inpText.value; decorate(id); writeStoreDebounced(); });
      rText.appendChild(inpText);
      rows.appendChild(rText);
    }

    const rColor = row(T.color);
    const inpColor = document.createElement('input');
    inpColor.type = 'color';
    inpColor.value = toHex(s.fill || cs.fill);
    const inpColorHex = document.createElement('input');
    inpColorHex.type = 'text';
    inpColorHex.className = 'ce-hexfield';
    inpColorHex.setAttribute('aria-label', T.color + ' — ' + T.hex);
    inpColorHex.placeholder = '#RRGGBB';
    inpColorHex.value = inpColor.value.toUpperCase();
    inpColor.addEventListener('input', () => { s.fill = inpColor.value; inpColorHex.value = inpColor.value.toUpperCase(); applyState(id); writeStoreDebounced(); });
    inpColorHex.addEventListener('input', () => {
      let v = inpColorHex.value.trim();
      if (v && v[0] !== '#') v = '#' + v;
      if (!isValidHex(v)) return;
      inpColor.value = v; s.fill = v; applyState(id); writeStoreDebounced();
    });
    rColor.appendChild(inpColor);
    rColor.appendChild(inpColorHex);
    rows.appendChild(rColor);

    const rFont = row(T.font);
    const sel = document.createElement('select');
    FONTS.forEach(([val, label, key]) => {
      const o = document.createElement('option'); o.value = val; o.textContent = (key && T[key]) || label;
      if (s.font === val) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => { s.font = sel.value; applyState(id); decorate(id); writeStore(); });
    rFont.appendChild(sel);
    rows.appendChild(rFont);

    const rSize = row(T.size);
    const inpSize = document.createElement('input');
    inpSize.type = 'number'; inpSize.min = '8'; inpSize.max = '36'; inpSize.step = '1';
    inpSize.value = Math.round(parseFloat(s.size || cs.fontSize) || 12);
    inpSize.addEventListener('input', () => {
      let v = parseInt(inpSize.value, 10);
      if (!isFinite(v)) return;
      v = Math.max(8, Math.min(36, v));
      s.size = v; applyState(id); decorate(id); writeStoreDebounced();
    });
    rSize.appendChild(inpSize);
    rows.appendChild(rSize);

    const rTog = row('');
    const togWrap = document.createElement('div');
    togWrap.className = 'ce-toggles';
    const bB = document.createElement('button'); bB.type = 'button'; bB.textContent = 'B'; bB.style.fontWeight = '700';
    bB.setAttribute('aria-label', T.bold);
    const bI = document.createElement('button'); bI.type = 'button'; bI.textContent = 'I'; bI.style.fontStyle = 'italic';
    bI.setAttribute('aria-label', T.italic);
    const isBold = s.bold ?? (parseInt(cs.fontWeight, 10) >= 600);
    const isItalic = s.italic ?? (cs.fontStyle === 'italic');
    bB.classList.toggle('on', !!isBold); bB.setAttribute('aria-pressed', String(!!isBold));
    bI.classList.toggle('on', !!isItalic); bI.setAttribute('aria-pressed', String(!!isItalic));
    bB.addEventListener('click', () => { const on = !bB.classList.contains('on'); s.bold = on; bB.classList.toggle('on', on); bB.setAttribute('aria-pressed', String(on)); applyState(id); decorate(id); writeStore(); });
    bI.addEventListener('click', () => { const on = !bI.classList.contains('on'); s.italic = on; bI.classList.toggle('on', on); bI.setAttribute('aria-pressed', String(on)); applyState(id); decorate(id); writeStore(); });
    togWrap.appendChild(bB); togWrap.appendChild(bI);
    rTog.appendChild(togWrap);
    rows.appendChild(rTog);

    // posiciones predefinidas de leyenda (Paso 4 G6 de qiimelab-prompt-
    // editor-fase-4-ejes-rejilla-leyenda-lienzo.md) — reutiliza el MISMO
    // mecanismo de arrastre (s.dx/s.dy) en vez de recalcular el layout: el
    // módulo aporta unos pocos desplazamientos ya sensatos relativos a la
    // posición natural en la que él mismo dibuja la leyenda.
    if (id === 'legend' && Array.isArray(cfg.legendPositions) && cfg.legendPositions.length) {
      const rPos = row(T.legendPosition);
      const posWrap = document.createElement('div');
      posWrap.className = 'ce-toggles';
      cfg.legendPositions.forEach((p) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = p.label;
        b.addEventListener('click', () => {
          s.dx = p.dx; s.dy = p.dy;
          w.wrap.setAttribute('transform', 'translate(' + s.dx + ',' + s.dy + ')');
          writeStoreDebounced();
        });
        posWrap.appendChild(b);
      });
      rPos.appendChild(posWrap);
      rows.appendChild(rPos);
    }

    // enlazar cada <label> de fila con su control (accesibilidad del panel)
    ctx.panel.querySelectorAll('.ce-row').forEach((r) => {
      const lab = r.querySelector(':scope > label');
      const ctl = r.querySelector('input, select');
      if (lab && ctl && lab.textContent.trim()) {
        if (!ctl.id) ctl.id = 'ce-f-' + (++ctx.cePanelUid);
        lab.setAttribute('for', ctl.id);
      }
    });

    ctx.panel.setAttribute('role', 'group');
    ctx.panel.setAttribute('aria-label', elLabel(id));
    document.body.appendChild(ctx.panel);
    positionPanel(ev);
    ctx.panel.querySelector('h4 button').addEventListener('click', () => {
      closePanel(); ctx.selectedId = null; syncSelection();
      const w = wraps.get(id);
      const hit = w && w.wrap.querySelector(':scope > .ce-hit');
      if (hit) try { hit.focus(); } catch (e) { /* noop */ }
    });
  }
  function elLabel(id) {
    const es = lang === 'es';
    const map = { title: es ? 'Título de la figura' : 'Figure title',
                  xtitle: es ? 'Título eje X' : 'X axis title',
                  ytitle: es ? 'Título eje Y' : 'Y axis title',
                  legend: es ? 'Leyenda' : 'Legend' };
    if (map[id]) return map[id];
    if (/^grp\d+$/.test(id) || /^set\d+$/.test(id)) return es ? 'Etiqueta de grupo' : 'Group label';
    return id;
  }
  function row(label) {
    const r = document.createElement('div');
    r.className = 'ce-row';
    if (label) { const l = document.createElement('label'); l.textContent = label; r.appendChild(l); }
    else { const l = document.createElement('label'); l.textContent = ''; r.appendChild(l); }
    return r;
  }
  function positionPanel(ev) {
    if (!ctx.panel) return;
    const pr = ctx.panel.getBoundingClientRect();
    let x = (ev && ev.clientX ? ev.clientX + 16 : window.innerWidth / 2);
    let y = (ev && ev.clientY ? ev.clientY - 10 : 120);
    x = Math.min(x, window.innerWidth - pr.width - 12);
    y = Math.min(Math.max(12, y), window.innerHeight - pr.height - 12);
    ctx.panel.style.left = x + 'px';
    ctx.panel.style.top = y + 'px';
  }

  // clic fuera → cerrar panel
  function onDocDown(e) {
    if (!ctx.editing) return;
    if (ctx.panel && (ctx.panel.contains(e.target))) return;
    if (svg.contains(e.target)) return; // clics dentro del svg los gestiona el hit
    closePanel(); ctx.selectedId = null; syncSelection();
  }
  function onKey(e) {
    if (e.key !== 'Escape') return;
    const back = ctx.selectedId;
    closePanel(); ctx.selectedId = null; syncSelection();
    // devolver el foco al tirador que abrió el panel (navegación solo-teclado)
    if (back && ctx.editing) {
      const w = wraps.get(back);
      const hit = w && w.wrap.querySelector(':scope > .ce-hit');
      if (hit) try { hit.focus(); } catch (err) { /* noop */ }
    }
  }

  return { closePanel, decorate, onDocDown, onKey, sync, syncSelection };
}
