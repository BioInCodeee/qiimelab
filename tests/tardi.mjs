// tests/tardi.mjs — la mascota (js/lib/tardi.js) y su modo sobrio.
//
// El fallo que motiva esta suite: tardiHtml() construye su aria-label con
// t('tardi.' + estado), y el WIP de la rama tardi-mascota llegó SIN ninguna
// clave tardi.* en los diccionarios. La mascota se pintaba igual, los tests de
// vista pasaban igual, y lo único roto era lo que nadie mira: quien navega con
// lector de pantalla oía «tardi.idle». De ahí que aquí se compruebe el
// aria-label RESUELTO en los cinco idiomas, no que la función devuelva algo.
//
// Estático: se simulan document y localStorage, sin Chrome.
//
//   node tests/tardi.mjs

import { readFileSync } from 'node:fs';
import { APP_ROOT } from './lib/env.mjs';

let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

// --- DOM y almacenamiento simulados, antes de importar nada --------------
const htmlAttrs = new Map();
globalThis.document = {
  documentElement: {
    setAttribute: (k, v) => htmlAttrs.set(k, String(v)),
    removeAttribute: (k) => htmlAttrs.delete(k),
    getAttribute: (k) => (htmlAttrs.has(k) ? htmlAttrs.get(k) : null),
  },
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => ({ setAttribute() {}, appendChild() {}, style: {}, dataset: {} }),
};
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { TARDI_STATES, tardiHtml, getSobrio, setSobrio, applyDataSobrio, initSobrio, onSobrioChange, DEFAULT_SOBRO } =
  await import('../js/lib/tardi.js');
const { tIn, LANGS } = await import('../js/i18n/index.js');

const codigos = LANGS.map((l) => (typeof l === 'string' ? l : l.code));

console.log('los seis estados de AGAR.md');
check('TARDI_STATES tiene 6 estados', TARDI_STATES.length === 6, TARDI_STATES.join(', '));
for (const esperado of ['idle', 'busy', 'ready', 'warn', 'error', 'celebrate']) {
  check(`incluye «${esperado}»`, TARDI_STATES.includes(esperado));
}

// Esto es el corazón de la suite: la clave tiene que existir y resolver a texto
// de verdad en TODOS los idiomas, no caer al nombre de la clave.
console.log('aria-label resuelto en los cinco idiomas');
for (const lang of codigos) {
  const malas = TARDI_STATES.filter((s) => {
    const v = tIn(lang, 'tardi.' + s);
    return !v || v === 'tardi.' + s || v.includes('tardi.');
  });
  check(`[${lang}] los 6 estados tienen texto`, malas.length === 0,
    malas.length ? 'sin traducir: ' + malas.join(', ') : '');
}

// Regla de Agar: el aria-label describe EL ESTADO, no al animal. Proxy
// mecánico: no puede nombrar a la mascota ni a la especie.
console.log('el aria-label describe el estado, no al animal');
const PROHIBIDAS = ['tardi', 'tardígrado', 'tardigrado', 'tardigrade', 'tardigrada',
  'mascota', 'mascotte', 'maskottchen', 'mascot', '吉祥物', '水熊'];
for (const lang of codigos) {
  const malas = [];
  for (const s of TARDI_STATES) {
    const v = String(tIn(lang, 'tardi.' + s) || '').toLowerCase();
    if (PROHIBIDAS.some((p) => v.includes(p))) malas.push(s);
  }
  check(`[${lang}] ningún estado nombra al animal`, malas.length === 0, malas.join(', '));
}

console.log('el ajuste de mascota está traducido');
for (const lang of codigos) {
  const malas = ['mascota', 'mascotaAnimada', 'mascotaSobria', 'mascotaHelp'].filter((k) => {
    const v = tIn(lang, 'shell.' + k);
    return !v || v === 'shell.' + k;
  });
  check(`[${lang}] las 4 claves del ajuste`, malas.length === 0, malas.join(', '));
}

console.log('marcado que genera tardiHtml');
const html = tardiHtml('ready');
check('trae role="img"', html.includes('role="img"'));
check('trae data-state="ready"', html.includes('data-state="ready"'));
check('el aria-label no es el nombre de la clave', !html.includes('aria-label="tardi.'));
check('sin <defs> ni id (varias instancias no pueden chocar)',
  !/<defs/i.test(html) && !/\sid="/.test(html));
check('estado desconocido → idle', tardiHtml('loquesea').includes('data-state="idle"'));
check('sin estado → idle', tardiHtml().includes('data-state="idle"'));
check('opts.lg añade la clase grande', tardiHtml('idle', { lg: true }).includes('ql-tardi-lg'));
check('sin lg no la añade', !tardiHtml('idle').includes('ql-tardi-lg'));
// Un aria-label con una comilla sin escapar rompería el atributo entero.
check('el aria-label va escapado', !/aria-label="[^"]*"[^>]*"/.test(html));

console.log('modo sobrio');
check('por defecto la mascota se ve', DEFAULT_SOBRO === false && getSobrio() === false);
setSobrio(true);
check('al activarlo, <html data-sobrio="on">', htmlAttrs.get('data-sobrio') === 'on');
check('getSobrio lo refleja', getSobrio() === true);
setSobrio(false);
check('al desactivarlo, el atributo se quita', htmlAttrs.get('data-sobrio') === undefined);
let avisos = 0;
const off = onSobrioChange(() => { avisos++; });
setSobrio(true); setSobrio(false);
check('onSobrioChange avisa de cada cambio', avisos === 2, 'avisos: ' + avisos);
off();
setSobrio(true);
check('tras desuscribir ya no avisa', avisos === 2, 'avisos: ' + avisos);
setSobrio(false);
// initSobrio() es lo que corre app.js al arrancar: tiene que respetar lo guardado.
store.set('smart-175.sobrio', '1');
initSobrio();
check('initSobrio aplica lo guardado', htmlAttrs.get('data-sobrio') === 'on');
store.set('smart-175.sobrio', '0');
initSobrio();
check('initSobrio respeta el «no sobrio»', htmlAttrs.get('data-sobrio') === undefined);
check('applyDataSobrio sin DOM no revienta', (() => {
  const d = globalThis.document; delete globalThis.document;
  try { applyDataSobrio(true); return true; } catch (e) { return false; } finally { globalThis.document = d; }
})());

// El modo sobrio se apoya en CSS: si la regla no está, el ajuste no hace nada
// aunque el atributo se escriba bien.
console.log('el CSS respalda el ajuste');
const components = readFileSync(APP_ROOT + '/css/components.css', 'utf8');
check('[data-sobrio="on"] oculta .ql-tardi-wrap',
  /\[data-sobrio="on"\][^{]*\.ql-tardi-wrap\s*\{[^}]*display:\s*none/.test(components));

console.log(failed ? '\nFALLOS' : '\nOK');
process.exit(failed ? 1 : 0);
