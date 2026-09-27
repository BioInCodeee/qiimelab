// Internacionalización mínima, sin dependencias.
//
// Un archivo por idioma (es.js, en.js, it.js, de.js, zh.js); este índice solo
// los reúne y expone la API. js/lib/i18n.js re-exporta desde aquí para que
// ningún import del proyecto cambie. Paridad de claves: tests/i18n-parity.mjs.
//
// Mecanismo (una frase): cada literal visible del HTML generado por JS se
// sustituye por una llamada `t('modulo.clave')` en el mismo sitio donde
// estaba el texto; `t(clave, {n: 5})` interpola `{n}`; si falta la
// traducción en el idioma activo se cae a español y, si tampoco está, a la
// propia clave (nunca texto roto).
//
// Los TÉRMINOS TÉCNICOS del dominio (Bray-Curtis, PERMANOVA, Shannon, PCoA,
// rangos taxonómicos, nombres de género, KO/KEGG…) NO se traducen: se dejan
// igual en los 5 idiomas y solo se traduce la interfaz alrededor.

import es from './es.js';
import en from './en.js';
import it from './it.js';
import de from './de.js';
import zh from './zh.js';

const STORAGE_KEY = 'smart-175.lang';
const DEFAULT_LANG = 'es';

// Autónimos (el nombre de cada idioma en ese mismo idioma), sin banderas.
export const LANGS = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
  { code: 'it', label: 'Italiano' },
  { code: 'de', label: 'Deutsch' },
  { code: 'zh', label: '中文' },
];

const DICTS = { es, en, it, de, zh };

let currentLang = readStoredLang();
const listeners = new Set();

function readStoredLang() {
  try {
    const v = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('qiimelab.lang');
    if (v && DICTS[v]) return v;
  } catch (e) { /* localStorage puede lanzar en modo privado */ }
  return DEFAULT_LANG;
}

function lookup(dict, key) {
  if (!dict) return undefined;
  let cur = dict;
  for (const part of key.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
}

/** Traduce `key` al idioma activo. Cae a español y luego a la propia clave. */
export function t(key, params) {
  const val = lookup(DICTS[currentLang], key)
    ?? lookup(DICTS[DEFAULT_LANG], key)
    ?? key;
  return interpolate(val, params);
}

export function getLang() { return currentLang; }

export function setLang(code) {
  if (!DICTS[code] || code === currentLang) return;
  currentLang = code;
  try { localStorage.setItem(STORAGE_KEY, code); } catch (e) { /* ignore */ }
  try { document.documentElement.lang = code; } catch (e) { /* ignore */ }
  listeners.forEach((fn) => { try { fn(code); } catch (e) { /* noop */ } });
}

/** Se ejecuta `fn` cada vez que cambia el idioma. Devuelve una función para desuscribirse. */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// deja el <html lang> sincronizado desde el arranque
try { document.documentElement.lang = currentLang; } catch (e) { /* ignore */ }
