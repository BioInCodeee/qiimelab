// Identidad de marca: el wordmark «Smart-175» y el encabezado de la portada.
// Un solo sitio para el nombre y su tratamiento tipográfico (Fira Sans 700 en
// el azul de marca, clase .ql-wordmark en css/components.css): lo usan la
// portada (grande, con el motivo detrás), la barra lateral, la barra superior
// del cajón móvil (navDrawer.js) y el pie — así la cabecera de identidad es la
// misma en toda la app, no solo en la portada.
//
// El motivo de fondo es el de siempre (js/lib/motif.js, 8 sep 2026, commit
// 0622b85): dendrograma UPGMA + nube de puntos tipo PCoA. El árbol RADIAL que
// lo sustituyó unas horas (3ed2c36) se retiró a petición del usuario (bc58904)
// porque se leía como un mapa de genoma circular — no se recupera.

import { domainMotif } from './motif.js';

export const BRAND_NAME = 'Smart-175';

/** HTML del wordmark. `cls` añade clases (p. ej. el tamaño de la portada). */
export function wordmarkHtml(cls = '') {
  return '<span class="ql-wordmark' + (cls ? ' ' + cls : '') + '">' + BRAND_NAME + '</span>';
}

/**
 * Encabezado de identidad de la portada: rótulo, wordmark grande como <h1> y
 * subtítulo, con el motivo de dominio detrás. Contraste: en escritorio el
 * motivo va a la derecha del texto y se desvanece antes de tocarlo; en
 * pantallas estrechas pasa por detrás, con opacidad acotada para que todo el
 * texto siga ≥ 4,5:1 (tests/design-v2.mjs lo mide).
 * @param {{ eyebrowHtml: string, subHtml: string }} opt  HTML ya escapado
 * @returns {HTMLElement}
 */
export function brandHero({ eyebrowHtml, subHtml }) {
  const header = document.createElement('header');
  header.className = 'ql-hero ql-hero-brand';
  header.innerHTML =
    // proporción ~2:1 = la de la caja del motivo en el encabezado (con la
    // 4:1 por defecto, «meet» lo encogía a una tira)
    '<div class="ql-hero-motif">' + domainMotif({ w: 640, h: 330 }) + '</div>' +
    '<div class="ql-hero-body">' +
    '<p class="ql-eyebrow">' + eyebrowHtml + '</p>' +
    '<h1 class="ql-hero-title">' + wordmarkHtml('ql-wordmark-hero') + '</h1>' +
    '<p class="ql-hero-sub">' + subHtml + '</p>' +
    '</div>';
  return header;
}
