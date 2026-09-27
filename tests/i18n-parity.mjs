// tests/i18n-parity.mjs
// Paridad de claves entre idiomas: toma js/i18n/es.js como referencia y lista,
// para cada otro idioma, las claves que le faltan (esas se ven en español en
// la interfaz, porque t() cae a `es`), las que sobran (claves huérfanas que ya
// no existen en `es`) y las que no conservan los mismos `{marcadores}` que el
// original (la interpolación dejaría `{n}` a la vista o perdería un dato).
//
// Es INFORMATIVO: reporta y sale con 0 aunque falten claves (it/de/zh solo
// traducen la navegación a propósito). Con --strict sale con 1 si hay algún
// hueco, para usarlo como puerta cuando se quiera exigir paridad completa.
//
//   node tests/i18n-parity.mjs            # resumen + primeras claves de cada lista
//   node tests/i18n-parity.mjs --all      # todas las claves
//   node tests/i18n-parity.mjs --strict   # sale con 1 si falta/sobra algo

const LANGS = ['en', 'it', 'de', 'zh'];
const SHOW_ALL = process.argv.includes('--all');
const STRICT = process.argv.includes('--strict');
const MAX = SHOW_ALL ? Infinity : 15;

const load = async (lang) => (await import('../js/i18n/' + lang + '.js')).default;

// hojas de texto del diccionario como { 'modulo.clave': 'texto' }
function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

const placeholders = (s) => (typeof s === 'string' ? [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',') : '');

function printList(title, keys) {
  if (!keys.length) return;
  console.log(`    ${title}: ${keys.length}`);
  keys.slice(0, MAX).forEach((k) => console.log('      - ' + k));
  if (keys.length > MAX) console.log(`      … y ${keys.length - MAX} más (usa --all)`);
}

const es = flatten(await load('es'));
console.log(`--- Paridad de claves i18n (referencia: es, ${es.size} claves) ---`);

let gaps = 0;
for (const lang of LANGS) {
  const dict = flatten(await load(lang));
  const missing = [...es.keys()].filter((k) => !dict.has(k));
  const orphan = [...dict.keys()].filter((k) => !es.has(k));
  const badVars = [...dict.keys()].filter((k) => es.has(k) && placeholders(es.get(k)) !== placeholders(dict.get(k)));
  const pct = ((es.size - missing.length) / es.size * 100).toFixed(1);
  console.log(`  [${lang}] ${dict.size} claves · cobertura ${pct}% · faltan ${missing.length} · sobran ${orphan.length} · marcadores distintos ${badVars.length}`);
  printList('faltan (se verán en español)', missing);
  printList('sobran (no existen en es)', orphan);
  printList('marcadores {…} distintos a es', badVars);
  gaps += missing.length + orphan.length + badVars.length;
}

if (STRICT && gaps) {
  console.log(`❌ --strict: ${gaps} diferencias de paridad.`);
  process.exit(1);
}
console.log(gaps ? `ℹ️  ${gaps} diferencias de paridad (informativo, no es un fallo).` : '✅ Paridad completa en los 5 idiomas.');
