// Modo claro/oscuro/automático. El CSS (css/tokens.css) ya define las
// variables para :root[data-theme="dark"] y para prefers-color-scheme; este
// módulo solo decide qué atributo poner en <html> y lo persiste — sin
// cuentas, sin backend, solo localStorage de este navegador (igual que
// profile.js con el nombre local).
//
// Sin nada guardado, el tema es OSCURO (decisión de producto, 28 sep 2026):
// gana aunque el sistema operativo pida claro — «automático» (seguir al SO)
// sigue disponible, pero como elección explícita, y por eso ahora se guarda
// ('auto' en localStorage) en vez de borrarse. Quien ya tenía 'light' o
// 'dark' guardado lo conserva tal cual. El script en línea de index.html
// replica esta regla para el primer pintado (y su hash va en la CSP).

const KEY = 'smart-175.theme';
const LEGACY_KEY = 'qiimelab.theme';
const VALID = new Set(['light', 'dark', 'auto']);
const listeners = new Set();

/** Tema por defecto de quien no ha elegido ninguno. */
export const DEFAULT_THEME = 'dark';

/** Tema guardado, o DEFAULT_THEME si no hay elección explícita. */
export function getTheme() {
  try {
    const v = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
    return VALID.has(v) ? v : DEFAULT_THEME;
  } catch (e) { return DEFAULT_THEME; }
}

function applyDataTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

// Fuerza el color de la barra del navegador (meta theme-color) a seguir la
// elección explícita en vez del prefers-color-scheme del SO; en 'auto' se
// restauran las media queries originales que ya trae index.html.
// Las dos <meta> se localizan UNA sola vez y se guardan. No se pueden volver
// a buscar por su atributo `media` en cada llamada: este mismo código lo
// reescribe (''/'not all'), así que a partir del primer cambio explícito el
// selector [media*="light"] ya no casaba con nada, salía por el `return` de
// abajo y el color de la barra del navegador se quedaba congelado en el del
// primer cambio (light→dark→light no hacía nada). Se resuelven por posición
// y se recuerda su `media` original en `dataset.origMedia` para 'auto'.
let metas = null;
function themeColorMetas() {
  if (metas) return metas;
  const all = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
  const byMedia = (kind) => all.find((m) => (m.getAttribute('media') || '').includes(kind))
    || all.find((m) => m.dataset.origMedia !== undefined && m.dataset.origMedia.includes(kind));
  const light = byMedia('light');
  const dark = byMedia('dark');
  if (!light || !dark || light === dark) return null;
  if (light.dataset.origMedia === undefined) light.dataset.origMedia = light.getAttribute('media') || '';
  if (dark.dataset.origMedia === undefined) dark.dataset.origMedia = dark.getAttribute('media') || '';
  metas = { light, dark };
  return metas;
}

function applyMetaThemeColor(theme) {
  const found = themeColorMetas();
  if (!found) return;
  const lightMeta = found.light;
  const darkMeta = found.dark;
  if (theme === 'light') {
    lightMeta.setAttribute('media', '');
    darkMeta.setAttribute('media', 'not all');
  } else if (theme === 'dark') {
    lightMeta.setAttribute('media', 'not all');
    darkMeta.setAttribute('media', '');
  } else {
    lightMeta.setAttribute('media', lightMeta.dataset.origMedia);
    darkMeta.setAttribute('media', darkMeta.dataset.origMedia);
  }
}

/** Aplica el tema al DOM sin tocar localStorage (llamar al arrancar la app). */
export function applyTheme(theme) {
  const v = VALID.has(theme) ? theme : DEFAULT_THEME;
  applyDataTheme(v);
  applyMetaThemeColor(v);
}

/** Se llama una vez al arrancar la app (igual que initPWA en app.js). */
export function initTheme() {
  applyTheme(getTheme());
}

/** Guarda (también 'auto': sin nada guardado el tema sería el oscuro por
 *  defecto, no el del sistema), aplica y avisa a los suscriptores. */
export function setTheme(theme) {
  const v = VALID.has(theme) ? theme : DEFAULT_THEME;
  try {
    localStorage.setItem(KEY, v);
    localStorage.removeItem(LEGACY_KEY);
  } catch (e) { /* modo privado: se queda en memoria de esta pestaña */ }
  applyTheme(v);
  listeners.forEach((fn) => { try { fn(v); } catch (e) { /* noop */ } });
  return v;
}

/** Se ejecuta `fn(theme)` cada vez que cambia. Devuelve función para desuscribir. */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
