// La barra lateral como cajón en pantallas estrechas (≤ 860 px, el mismo umbral
// que el @media de css/components.css). Por encima de ese ancho no hace nada:
// el sidebar sigue fijo a la izquierda, tal cual.
//
// En estrecho: barra superior fija con un botón "Menú" (aria-expanded +
// aria-controls) y el sidebar sale como panel SUPERPUESTO bajo esa barra, sin
// empujar el contenido. Se cierra con Escape, tocando fuera, con el propio
// botón y al navegar. Mientras está abierto el foco queda atrapado entre el
// botón y el panel (trapFocus, el mismo patrón que los modales de modal.js) y
// el contenido principal queda `inert`.
//
// Mejora progresiva: el CSS del cajón cuelga de la clase `ql-has-drawer` en
// <html>, que se pone aquí. Si este módulo no llegara a ejecutarse (p. ej. CSS
// nuevo con JS viejo en la caché del service worker) el sidebar sigue
// apilándose como antes en vez de quedar oculto sin botón para abrirlo.

import { t, onLangChange } from './i18n.js';
import { trapFocus } from './modal.js';
import { BRAND_NAME } from './brand.js';

const NARROW = '(max-width: 860px)'; // = @media de .ql-shell en components.css

const svg = (body) => '<svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">' + body + '</svg>';
const ICON_MENU = svg('<path class="ql-ico-menu" d="M4 7h16M4 12h16M4 17h16"/><path class="ql-ico-close" d="M6 6l12 12M18 6 6 18"/>');

/**
 * @param {HTMLElement} sidebar  el <nav id="sidebar"> (su contenido lo repinta shell.js)
 * @param {HTMLElement} view     el <main id="app-view">
 * @returns {{ close: () => void, isOpen: () => boolean }}
 */
export function initNavDrawer(sidebar, view) {
  const shell = sidebar.parentElement;
  const mainCol = view.parentElement;
  const mq = window.matchMedia(NARROW);

  const bar = document.createElement('div');
  bar.className = 'ql-navbar';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'nav-toggle';
  btn.className = 'ql-navbar-toggle';
  btn.setAttribute('aria-controls', sidebar.id);
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = ICON_MENU + '<span class="ql-navbar-label"></span>';
  const title = document.createElement('span');
  title.className = 'ql-navbar-title ql-wordmark';
  title.textContent = BRAND_NAME;
  bar.append(btn, title);

  const backdrop = document.createElement('div');
  backdrop.className = 'ql-nav-backdrop';

  shell.insertBefore(bar, sidebar);
  shell.appendChild(backdrop);

  const syncLabel = () => { btn.querySelector('.ql-navbar-label').textContent = t('shell.menu'); };
  syncLabel();
  onLangChange(syncLabel);

  let open = false;
  let untrap = null;

  /** @param {boolean} next
   *  @param {'toggle'|'nav'|'silent'} [how] a dónde va el foco al cerrar:
   *    'toggle' → al botón (Escape, tocar fuera, el propio botón);
   *    'nav'    → al contenido (se eligió un módulo);
   *    'silent' → no se toca (cambio de tamaño de ventana). */
  function setOpen(next, how = 'toggle') {
    next = next && mq.matches;
    if (next === open) return;
    open = next;
    const hadFocus = sidebar.contains(document.activeElement);
    sidebar.classList.toggle('is-open', open);
    document.documentElement.classList.toggle('ql-nav-open', open);
    btn.setAttribute('aria-expanded', String(open));
    mainCol.inert = open;
    if (open) {
      untrap = trapFocus([bar, sidebar], () => setOpen(false));
      const start = sidebar.querySelector('a[aria-current="page"]') || sidebar.querySelector('a[href]');
      if (start) start.focus();
    } else {
      if (untrap) { untrap(); untrap = null; }
      if (how === 'toggle') btn.focus();
      else if (how === 'nav' && hadFocus) view.focus({ preventScroll: true });
    }
  }

  btn.addEventListener('click', () => setOpen(!open));
  backdrop.addEventListener('pointerdown', () => setOpen(false));
  // elegir un módulo cierra el panel aunque sea el de la ruta actual (ahí no
  // hay hashchange); hashchange cubre además atrás/adelante y enlaces externos
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a[href]')) setOpen(false, 'nav'); });
  window.addEventListener('hashchange', () => setOpen(false, 'nav'));
  mq.addEventListener('change', () => { if (!mq.matches) setOpen(false, 'silent'); });

  document.documentElement.classList.add('ql-has-drawer');
  return { close: () => setOpen(false), isOpen: () => open };
}
