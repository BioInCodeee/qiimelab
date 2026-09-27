// tests/glosario-links.mjs
// Integridad de los enlaces al glosario: todo `#/glosario?t=<id>` (y cada
// `glos:` de las tarjetas de home.js) tiene que apuntar a un término que
// existe, con título y definición en ES y EN. Nace de la auditoría de copy
// (21 sep): varias cadenas prometían "ver ¿qué significa esto?" sin enlace
// real, y una tarjeta de home apuntaba a un id inexistente.
//
//   node tests/glosario-links.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed = true;
};

// --- diccionarios (un archivo por idioma en js/i18n/) ---
const DICTS = {};
for (const lang of ['es', 'en']) DICTS[lang] = (await import('../js/i18n/' + lang + '.js')).default;
const get = (lang, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), DICTS[lang]);

// --- términos del glosario (id + def opcional) ---
const glosSrc = readFileSync(join(ROOT, 'js/modules/glosario.js'), 'utf8');
const terms = [...glosSrc.matchAll(/\{\s*id:\s*'([^']+)'(?:,\s*def:\s*'([^']+)')?/g)].map((m) => ({ id: m[1], def: m[2] }));
const ids = new Set(terms.map((t) => t.id));

console.log('--- 1. Cada término del glosario tiene título y definición en ES y EN ---');
check('hay términos en el glosario', terms.length > 50, `n=${terms.length}`);
for (const lang of ['es', 'en']) {
  const noName = terms.filter((t) => typeof get(lang, 'glosario.n.' + t.id) !== 'string' || !get(lang, 'glosario.n.' + t.id).trim());
  const noDef = terms.filter((t) => { const d = get(lang, t.def || 'glosario.d.' + t.id); return typeof d !== 'string' || d.trim().length < 20; });
  check(`[${lang}] todos con título (glosario.n.<id>)`, noName.length === 0, noName.map((t) => t.id).join(', '));
  check(`[${lang}] todos con definición no vacía`, noDef.length === 0, noDef.map((t) => t.id).join(', '));
}

console.log('--- 2. Todo enlace a un término apunta a un id real ---');
const refs = new Map(); // id -> dónde se referencia
const addRef = (id, where) => { if (!refs.has(id)) refs.set(id, []); refs.get(id).push(where); };
for (const f of readdirSync(join(ROOT, 'js/modules')).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(join(ROOT, 'js/modules', f), 'utf8');
  for (const m of src.matchAll(/#\/glosario\?t=([A-Za-z0-9_]+)/g)) addRef(m[1], f);
  for (const m of src.matchAll(/\bglos:\s*'([^']+)'/g)) addRef(m[1], f + ' (glos:)');
  for (const m of src.matchAll(/glossaryLinkHtml\('([^']+)'/g)) addRef(m[1], f + ' (glossaryLinkHtml)');
}
// enlaces construidos con una variable (no se pueden leer del texto): se
// declaran aquí y se comprueba abajo que el módulo sigue construyéndolos
const DYNAMIC = [
  ['taxaBarplot.js', ['ancombc', 'randomforest', 'kruskal']],
  ['betaDiversity.js', ['rda', 'cca']],
];
for (const [f, list] of DYNAMIC) {
  const src = readFileSync(join(ROOT, 'js/modules', f), 'utf8');
  for (const id of list) {
    check(`${f} sigue mencionando el id dinámico «${id}»`, src.includes("'" + id + "'") || src.includes('rdaMethod'), '');
    addRef(id, f + ' (dinámico)');
  }
}
const broken = [...refs.entries()].filter(([id]) => !ids.has(id));
check(`${refs.size} ids referenciados, todos existen en el glosario`, broken.length === 0,
  broken.map(([id, w]) => `${id} ← ${w.join(', ')}`).join(' | '));

console.log('--- 3. Ninguna cadena promete un enlace de glosario en texto plano ---');
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, p ? p + '.' + k : k) : [[p ? p + '.' + k : k, v]]));
for (const lang of ['es', 'en']) {
  const promise = flat(DICTS[lang]).filter(([, v]) => typeof v === 'string' && /ver ["“]¿qué significa esto\?["”]|see ["“]what does this mean\?["”]/i.test(v));
  check(`[${lang}] sin «ver ¿qué significa esto?» escrito a mano dentro de un texto`, promise.length === 0, promise.map(([k]) => k).join(', '));
}

if (failed) {
  console.error('❌ Fallaron algunos tests en glosario-links.mjs');
  process.exit(1);
} else {
  console.log('✅ Todos los tests de glosario-links pasaron exitosamente.');
  process.exit(0);
}
