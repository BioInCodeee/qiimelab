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
import { inflateSync } from 'node:zlib';
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

// ---------------------------------------------------------------------------
// Iconos. Los SVG son la fuente; los PNG de icons/ son lo que de verdad se ve
// en el icono instalado y en las fichas de las tiendas, y se generan con
// scripts/generar-iconos.sh. El fallo a cazar es «SVG actualizado, PNG
// olvidado», asi que no basta con mirar el SVG: se lee el pixel del PNG.
console.log('iconos: los SVG usan los teals de marca');
const favicon = readFileSync(APP_ROOT + '/favicon.svg', 'utf8');
const maskable = readFileSync(APP_ROOT + '/icon-maskable.svg', 'utf8');
const GRAD_0 = norm(hexOf('light', 'accent'));    // inicio del degradado
const GRAD_1 = norm(hexOf('light', 'accent-2'));  // fin, y fondo del de Apple
for (const [nombre, svg] of [['favicon.svg', favicon], ['icon-maskable.svg', maskable]]) {
  const stops = [...svg.matchAll(/stop-color="([^"]+)"/g)].map((m) => norm(m[1]));
  check(`${nombre}: degradado = ${GRAD_0} → ${GRAD_1}`,
    stops.length === 2 && stops[0] === GRAD_0 && stops[1] === GRAD_1, JSON.stringify(stops));
  for (const c of LEGACY) check(`${nombre}: sin ${c}`, !norm(svg).includes(c));
}

// Lector de PNG al minimo: solo lo justo para sacar el primer pixel. Sin
// dependencias (zlib va en Node) para que corra igual en el runner de CI.
function primerPixel(ruta) {
  const buf = readFileSync(ruta);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('no es un PNG: ' + ruta);
  let off = 8, w = 0, tipo = -1, bits = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const nom = buf.toString('ascii', off + 4, off + 8);
    const datos = buf.subarray(off + 8, off + 8 + len);
    if (nom === 'IHDR') {
      w = datos.readUInt32BE(0); bits = datos[8]; tipo = datos[9]; interlace = datos[12];
    } else if (nom === 'IDAT') idat.push(datos);
    else if (nom === 'IEND') break;
    off += 12 + len;
  }
  if (bits !== 8 || interlace !== 0) throw new Error('PNG no soportado (bits/entrelazado): ' + ruta);
  const canales = { 0: 1, 2: 3, 4: 2, 6: 4 }[tipo];
  if (!canales) throw new Error('tipo de color no soportado: ' + tipo);
  const crudo = inflateSync(Buffer.concat(idat));
  // Solo la primera fila: el filtro de la fila 0 usa la fila previa a ceros,
  // asi que basta con deshacer Sub/Up/Average/Paeth con prior = 0.
  const filtro = crudo[0];
  const fila = Buffer.from(crudo.subarray(1, 1 + w * canales));
  for (let i = 0; i < fila.length; i++) {
    const izq = i >= canales ? fila[i - canales] : 0;
    if (filtro === 1) fila[i] = (fila[i] + izq) & 0xff;
    else if (filtro === 3) fila[i] = (fila[i] + (izq >> 1)) & 0xff;
    else if (filtro === 4) fila[i] = (fila[i] + izq) & 0xff; // prior = 0 → Paeth = izq
    // 0 (ninguno) y 2 (Up, prior = 0) se quedan tal cual
  }
  const hex = (n) => n.toString(16).padStart(2, '0');
  const alfa = canales === 4 ? fila[3] : canales === 2 ? fila[1] : 255;
  return { hex: '#' + hex(fila[0]) + hex(fila[1]) + hex(fila[2]), alfa };
}

console.log('iconos: los PNG estan en sync con los SVG');
// Cada receta de scripts/generar-iconos.sh, comprobada en su esquina:
//   maskable → a sangre, opaco, esquina = inicio del degradado
//   apple    → aplanado sobre --accent-2, sin alfa
//   any      → desde favicon.svg, esquina transparente (rx=8)
for (const f of ['icon-maskable-192.png', 'icon-maskable-512.png']) {
  const p = primerPixel(APP_ROOT + '/icons/' + f);
  check(`${f}: esquina = ${GRAD_0} y opaca`, p.hex === GRAD_0 && p.alfa === 255, `${p.hex} alfa ${p.alfa}`);
}
{
  const p = primerPixel(APP_ROOT + '/icons/apple-touch-icon-180.png');
  check(`apple-touch-icon-180.png: esquina = ${GRAD_1} y sin alfa`, p.hex === GRAD_1 && p.alfa === 255, `${p.hex} alfa ${p.alfa}`);
}
for (const f of ['icon-192.png', 'icon-512.png']) {
  const p = primerPixel(APP_ROOT + '/icons/' + f);
  check(`${f}: esquina transparente (viene de favicon.svg)`, p.alfa === 0, `alfa ${p.alfa}`);
}

// ---------------------------------------------------------------------------
// privacidad.html es autonoma a proposito (su CSP, su estilo en linea, sin
// css/tokens.css), asi que su paleta va a mano y puede quedarse atras — como
// paso con Agar. Se compara contra los tokens.
console.log('privacidad.html sigue la paleta de tokens.css');
const priv = readFileSync(APP_ROOT + '/privacidad.html', 'utf8');
const privVar = (nombre, bloque) => {
  const m = new RegExp(`--${nombre}:\\s*([^;]+);`, 'g');
  const todos = [...bloque.matchAll(m)].map((x) => norm(x[1]));
  return todos.length ? todos[0] : null;
};
// El primer :root es el claro; el de dentro de la media query, el oscuro.
const corte = priv.indexOf('@media (prefers-color-scheme: dark)');
const claro = priv.slice(0, corte);
const oscuro = priv.slice(corte);
for (const [nombre, token] of [['ink', 'ink'], ['ink-2', 'ink-2'], ['bg', 'page'], ['card', 'surface'], ['brand', 'accent']]) {
  check(`claro --${nombre} = --${token} (${norm(hexOf('light', token))})`,
    privVar(nombre, claro) === norm(hexOf('light', token)), `es ${privVar(nombre, claro)}`);
  check(`oscuro --${nombre} = --${token} (${norm(hexOf('dark', token))})`,
    privVar(nombre, oscuro) === norm(hexOf('dark', token)), `es ${privVar(nombre, oscuro)}`);
}
for (const c of LEGACY) check(`privacidad.html: sin ${c}`, !norm(priv).includes(c));
check('privacidad.html trae sus propias <meta name="theme-color">',
  (priv.match(/name="theme-color"/g) || []).length === 2);

console.log(failed ? '\nFALLOS' : '\nOK');
process.exit(failed ? 1 : 0);
