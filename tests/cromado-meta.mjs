// tests/cromado-meta.mjs — el cromado del navegador sigue a css/tokens.css.
//
// <meta name="theme-color"> (index.html) y theme_color/background_color
// (manifest.json) son colores escritos a mano, fuera de CSS. Ningún test de
// vista los ve: v2probe mira estilos calculados dentro de #app-view/#sidebar/
// #app-footer, así que una paleta nueva puede entrar entera y dejar la barra
// del navegador y la pantalla de arranque de la PWA con el color anterior.
// Pasó con Agar (16 nov 2026): la app ya era crema y teal y la barra seguía
// pintando el azul del v2 (#00107c) y el negro frío (#0c1018).
//
// Convención (la de siempre, solo trasladada a la paleta Agar):
//   · claro  → el color de marca (--accent del tema claro)
//   · oscuro → el fondo de página (--page del tema oscuro)
// El manifest usa el mismo par: theme_color = marca, background_color = fondo
// oscuro (la app arranca en oscuro por defecto, ver js/lib/theme.js).
//
//   node tests/cromado-meta.mjs

import { readFileSync } from 'node:fs';
import { APP_ROOT } from './lib/env.mjs';
import { hexOf } from './lib/tokens.mjs';

let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

const html = readFileSync(APP_ROOT + '/index.html', 'utf8');
const manifest = JSON.parse(readFileSync(APP_ROOT + '/manifest.json', 'utf8'));

const norm = (s) => String(s || '').trim().toLowerCase();
const MARCA = norm(hexOf('light', 'accent'));
const FONDO_OSCURO = norm(hexOf('dark', 'page'));

// Las dos <meta>, leídas por su media (es como las escribe index.html).
const metaFor = (kind) => {
  const re = new RegExp(`<meta[^>]*name="theme-color"[^>]*>`, 'g');
  for (const tag of html.match(re) || []) {
    if (!(/media="([^"]*)"/.exec(tag) || [, ''])[1].includes(kind)) continue;
    return norm((/content="([^"]*)"/.exec(tag) || [, ''])[1]);
  }
  return null;
};

console.log('meta theme-color de index.html');
check('existe la <meta> de claro', metaFor('light') !== null);
check('existe la <meta> de oscuro', metaFor('dark') !== null);
check(`claro = --accent del tema claro (${MARCA})`, metaFor('light') === MARCA, `es ${metaFor('light')}`);
check(`oscuro = --page del tema oscuro (${FONDO_OSCURO})`, metaFor('dark') === FONDO_OSCURO, `es ${metaFor('dark')}`);

console.log('manifest.json');
check(`theme_color = ${MARCA}`, norm(manifest.theme_color) === MARCA, `es ${norm(manifest.theme_color)}`);
check(`background_color = ${FONDO_OSCURO}`, norm(manifest.background_color) === FONDO_OSCURO, `es ${norm(manifest.background_color)}`);

// Guarda explícita contra el cromado anterior, en la misma línea que la
// comprobación `legacy` de tests/lib/v2probe.mjs.
console.log('sin restos del cromado anterior a Agar');
const LEGACY = ['#00107c', '#000a5a', '#0c1018', '#93c5fd', '#bfdbfe'];
const metas = (html.match(/<meta[^>]*name="theme-color"[^>]*>/g) || []).join(' ');
for (const c of LEGACY) {
  check(`${c} no aparece en las <meta> ni en el manifest`,
    !norm(metas).includes(c) && !norm(JSON.stringify(manifest)).includes(c));
}

// El fondo de <html> (el rebote del scroll) es el otro color de cromado que
// vive fuera del alcance de v2probe: queda por encima de #app-view, así que
// ninguna vista lo mide. Tiene que leer el token, no un hex a mano.
console.log('fondo de <html> (rebote del scroll)');
const components = readFileSync(APP_ROOT + '/css/components.css', 'utf8');
const htmlBg = /html:has\(>\s*body\[data-ds="v2"\]\)\s*\{([^}]*)\}/.exec(components);
check('existe la regla de fondo de <html>', !!htmlBg);
if (htmlBg) {
  check('usa var(--page), no un color a mano', /background:\s*var\(--page\)/.test(htmlBg[1]), htmlBg[1].trim());
}
check('ninguna regla de fondo de <html> con hex a mano',
  !/:root[^{]*:has\(>\s*body\[data-ds="v2"\]\)\s*\{\s*background:\s*#/.test(components));

console.log(failed ? '\nFALLOS' : '\nOK');
process.exit(failed ? 1 : 0);
