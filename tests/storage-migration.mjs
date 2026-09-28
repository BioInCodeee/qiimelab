// tests/storage-migration.mjs — migración de localStorage del nombre heredado
// (qiimelab.*) al actual (smart-175.*), js/lib/storageMigration.js.
//
// Parte 1 (sin Chrome): la función con un Storage simulado — copia, no pisa
// una clave nueva ya existente, borra la antigua, es idempotente y no borra
// la antigua si escribir la nueva falla.
// Parte 2 (Chrome): se escriben a mano claves ANTIGUAS (tema, idioma, perfil,
// estilo de una figura, estado del árbol y una clave que el código ya no
// conoce), se recarga la app y se comprueba que (a) aparecen bajo la clave
// nueva con el mismo valor, (b) la antigua ya no existe, (c) la app las
// aplica de verdad (tema oscuro, inglés, "Hola, <nombre>", estilo de la
// figura) y (d) sin errores de consola.
//
//   node tests/storage-migration.mjs

import { APP_ROOT, findChrome } from './lib/env.mjs';

let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

function fakeStorage(init = {}, { failSet = false } = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (failSet) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}

console.log('--- 1. migrateLegacyStorage (Storage simulado) ---');
{
  const { migrateLegacyStorage } = await import(APP_ROOT + '/js/lib/storageMigration.js');
  const st = fakeStorage({
    'qiimelab.theme': 'dark',
    'qiimelab.chartStyle.alphaDiversity': '{"title":{"bold":true}}',
    'qiimelab.lang': 'en',
    'smart-175.lang': 'de', // ya hay una nueva: manda la nueva
    'otra.app.clave': 'x',
  });
  const rep = migrateLegacyStorage(st);
  const d = st.dump();
  check('copia qiimelab.theme → smart-175.theme con el mismo valor', d['smart-175.theme'] === 'dark');
  check('copia las claves con sufijo (chartStyle.<figura>)', d['smart-175.chartStyle.alphaDiversity'] === '{"title":{"bold":true}}');
  check('si la clave nueva ya existe no la pisa (smart-175.lang sigue "de")', d['smart-175.lang'] === 'de');
  check('borra TODAS las claves antiguas', !Object.keys(d).some((k) => k.startsWith('qiimelab.')), JSON.stringify(Object.keys(d)));
  check('no toca claves ajenas', d['otra.app.clave'] === 'x');
  check('informe: 2 movidas, 1 conservada', rep.moved.length === 2 && rep.kept.length === 1, JSON.stringify(rep));
  const again = migrateLegacyStorage(st);
  check('idempotente: una segunda pasada no hace nada', again.moved.length + again.kept.length + again.failed.length === 0);
  const full = fakeStorage({ 'qiimelab.profileName': 'Ana' }, { failSet: true });
  const rf = migrateLegacyStorage(full);
  check('si escribir la nueva falla, la antigua NO se borra', full.dump()['qiimelab.profileName'] === 'Ana' && rf.failed.length === 1);
  check('sin localStorage (Node) no lanza', (() => { try { migrateLegacyStorage(undefined); return true; } catch (e) { return false; } })());
}

if (!findChrome()) {
  console.log('\n(sin Chrome: se omite la parte de la app)');
  console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
  process.exit(failed ? 1 : 0);
}

console.log('\n--- 2. la app real con claves antiguas simuladas ---');
const { ensureServer } = await import('./lib/server.mjs');
const { connect } = await import('./lib/cdp.mjs');
const { sleep } = await import('./lib/app.mjs');
const server = await ensureServer();
const c = await connect({ url: server.url + '/index.html', label: 'storage-migration' });
const OLD = {
  'qiimelab.theme': 'dark',
  'qiimelab.lang': 'en',
  'qiimelab.profileName': 'Tester Antiguo',
  'qiimelab.chartStyle.alphaDiversity': JSON.stringify({ title: { fill: '#aa2266', bold: true } }),
  'qiimelab.phylo': JSON.stringify({ fastaText: '', correction: 'jc', layout: 'circular', nni: false, rooting: 'none', referenceLeaf: '', colorCol: '' }),
  'qiimelab.claveQueYaNoExiste': 'legado',
};
try {
  await c.goto(); await sleep(1200);
  await c.ev(`(() => { localStorage.clear(); const o = ${JSON.stringify(OLD)}; for (const k in o) localStorage.setItem(k, o[k]); })()`);
  await c.goto(); await sleep(2000); // recarga con las claves antiguas
  const after = await c.ev(`(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; })()`);
  const oldLeft = Object.keys(after).filter((k) => k.startsWith('qiimelab.'));
  check('ninguna clave qiimelab.* sobrevive a la recarga', oldLeft.length === 0, oldLeft.join(', '));
  const same = Object.entries(OLD).filter(([k, v]) => after['smart-175.' + k.slice('qiimelab.'.length)] !== v).map(([k]) => k);
  check('las 6 aparecen bajo smart-175.* con el mismo valor (incluida una que el código ya no conoce)', same.length === 0, same.join(', '));

  const ui = await c.ev(`({ theme: document.documentElement.getAttribute('data-theme'), lang: document.documentElement.lang, nav: (document.querySelector('nav') || document.body).innerText })`);
  check('la app aplica el tema migrado (data-theme="dark")', ui.theme === 'dark', String(ui.theme));
  check('la app arranca en el idioma migrado (lang="en")', ui.lang === 'en', ui.lang);
  check('el nombre de perfil migrado aparece en la barra lateral', /Tester Antiguo/.test(ui.nav));

  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); })()`);
  await sleep(1200);
  await c.ev(`location.hash = '#/alfa'`); await sleep(2000);
  const title = await c.ev(`(() => { const t = [...document.querySelectorAll('#app-view svg.ql-svg text')].find((x) => x.style.fill); return t ? { fill: getComputedStyle(t).fill, weight: getComputedStyle(t).fontWeight, text: t.textContent } : null; })()`);
  check('el estilo de figura migrado se aplica (título de alfa en #aa2266, negrita)', !!title && title.fill === 'rgb(170, 34, 102)' && +title.weight >= 700, JSON.stringify(title));
  check('sin errores de consola al cargar con datos "antiguos"', c.problems.length === 0, c.problems.join('; '));
} catch (e) {
  console.error('EXCEPCIÓN:', e.message);
  failed = true;
} finally {
  c.kill();
  if (server.started) server.stop();
}
console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
