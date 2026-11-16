// Modales accesibles, sin librería. Dos formas, la misma base de
// accesibilidad para las dos (ver `trapFocus`):
//   · role="dialog" + aria-modal="true" + aria-labelledby
//   · el foco entra en el diálogo y queda ATRAPADO (Tab / Shift+Tab ciclan)
//   · Escape o clic en el fondo cierran
//   · al cerrar, el foco vuelve al elemento que lo tenía antes
//
// openConfirm({...}) -> Promise<boolean> (true = confirmado) — confirmar/cancelar.
// openPanel({...}) -> { close() } — contenido interactivo persistente
//   (el llamador monta DOM de verdad en el cuerpo, no un string; lo usa
//   chartEditor.js para la vista a pantalla completa del editor de gráficos).

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Atrapa el foco dentro de `dlg` (Tab/Shift+Tab ciclan, Escape llama a
 *  `onEscape`) y devuelve la función a quitar de `document` al cerrar.
 *  `dlg` puede ser también una lista de raíces (el cajón de navegación de
 *  js/lib/navDrawer.js atrapa el foco entre su botón y su panel, que no son
 *  hermanos ni descendientes uno del otro). Exportada para reutilizarla. */
export function trapFocus(dlg, onEscape) {
  const roots = Array.isArray(dlg) ? dlg : [dlg];
  // Un elemento que encaja con el selector no siempre puede recibir el foco:
  // puede estar oculto (display:none, visibility:hidden) o pertenecer a una
  // parte del panel que no se renderiza en ese ancho. Si se cuela en la lista,
  // el ciclo de tabulacion manda el foco a la nada — y, peor, el "ultimo"
  // elemento del ciclo pasa a ser invisible, asi que Shift+Tab desde el primero
  // no lleva a ningun sitio util. getClientRects() vacio es la forma estandar
  // de detectar lo no renderizado, y cubre display:none en cualquier ancestro.
  const rendered = (el) => el.getClientRects().length > 0
    && getComputedStyle(el).visibility !== 'hidden';
  const focusables = () => roots.flatMap((r) => Array.from(
    r.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  )).filter((el) => !el.disabled && el.getAttribute('tabindex') !== '-1' && rendered(el));
  const inside = () => roots.some((r) => r.contains(document.activeElement));
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); onEscape(); return; }
    if (e.key === 'Tab') {
      const f = focusables();
      if (f.length === 0) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!inside()) { e.preventDefault(); first.focus(); }
    }
  }
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.bodyHtml]  HTML ya saneado por el llamador
 * @param {string} [o.confirmLabel]
 * @param {string} [o.cancelLabel]
 * @param {boolean} [o.danger]   estilo destructivo en el botón de confirmar
 * @returns {Promise<boolean>}
 */
export function openConfirm(o = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;

    const backdrop = document.createElement('div');
    backdrop.className = 'ql-modal-backdrop';

    const dlg = document.createElement('div');
    dlg.className = 'ql-modal ql-card ql-panel';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    const titleId = 'ql-modal-t-' + Math.random().toString(36).slice(2, 9);
    dlg.setAttribute('aria-labelledby', titleId);
    dlg.innerHTML =
      '<h2 id="' + titleId + '" class="ql-modal-title">' + esc(o.title) + '</h2>' +
      '<div class="ql-modal-body">' + (o.bodyHtml || '') + '</div>' +
      '<div class="ql-modal-actions"></div>';

    const mkBtn = (label, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      return b;
    };
    const cancelBtn = mkBtn(o.cancelLabel || 'Cancelar', 'ql-btn');
    const okBtn = mkBtn(o.confirmLabel || 'Aceptar', 'ql-btn ql-btn-primary' + (o.danger ? ' ql-btn-danger' : ''));
    dlg.querySelector('.ql-modal-actions').append(cancelBtn, okBtn);

    backdrop.appendChild(dlg);
    document.body.appendChild(backdrop);

    function close(val) {
      untrap();
      backdrop.remove();
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch (e) { /* noop */ }
      }
      resolve(val);
    }
    const untrap = trapFocus(dlg, () => close(false));
    backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close(false); });
    cancelBtn.addEventListener('click', () => close(false));
    okBtn.addEventListener('click', () => close(true));

    okBtn.focus();
  });
}

/**
 * Modal para contenido interactivo PERSISTENTE (no un confirmar/cancelar de
 * un solo uso): el llamador monta DOM de verdad en el cuerpo con
 * `render(bodyEl)` — puede incluso mover ahí un nodo que ya existía en la
 * página (no hace falta clonarlo). Si `render` devuelve una función, se
 * llama al cerrar (para, por ejemplo, devolver ese nodo a su sitio
 * original). Misma base de accesibilidad que openConfirm; se cierra con la
 * × del título, con Escape o con clic en el fondo.
 * @param {object} o
 * @param {string} o.title
 * @param {(bodyEl: HTMLElement) => (void|(() => void))} o.render
 * @param {string} [o.extraClass] clase extra en `.ql-modal` (p. ej. un ancho mayor)
 * @param {string} [o.closeLabel]
 * @returns {{ close: () => void }}
 */
export function openPanel(o = {}) {
  const prevFocus = document.activeElement;

  const backdrop = document.createElement('div');
  backdrop.className = 'ql-modal-backdrop';

  const dlg = document.createElement('div');
  dlg.className = 'ql-modal ql-card ql-panel' + (o.extraClass ? ' ' + o.extraClass : '');
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  const titleId = 'ql-modal-t-' + Math.random().toString(36).slice(2, 9);
  dlg.setAttribute('aria-labelledby', titleId);

  const head = document.createElement('div');
  head.className = 'ql-modal-panel-head';
  const h2 = document.createElement('h2');
  h2.id = titleId; h2.className = 'ql-modal-title'; h2.textContent = o.title || '';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button'; closeBtn.className = 'ql-modal-close';
  closeBtn.setAttribute('aria-label', o.closeLabel || 'Cerrar');
  closeBtn.innerHTML = '<svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  head.append(h2, closeBtn);

  const body = document.createElement('div');
  body.className = 'ql-modal-body ql-modal-panel-body';

  dlg.append(head, body);
  backdrop.appendChild(dlg);
  document.body.appendChild(backdrop);

  let cleanup = null;
  try { cleanup = o.render ? o.render(body) : null; } catch (e) { /* noop */ }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    untrap();
    if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { /* noop */ } }
    backdrop.remove();
    if (prevFocus && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus(); } catch (e) { /* noop */ }
    }
  }
  const untrap = trapFocus(dlg, close);
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close(); });
  closeBtn.addEventListener('click', () => close());

  closeBtn.focus();
  return { close };
}
