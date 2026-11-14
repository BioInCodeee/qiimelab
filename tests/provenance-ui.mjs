// tests/provenance-ui.mjs — la procedencia del .qza en #/cargar, de punta a
// punta: se mete el artefacto de ejemplo por el MISMO input de archivos que usa
// una persona, y se comprueba que la cadena que lee js/lib/provenance.js llega
// a la pantalla con los parámetros citables.
//
// Los números que se afirman aquí (4 pasos, metric = braycurtis,
// sampling_depth = 1000) son los de la procedencia sintética que lleva
// datos-ejemplo/diversidad-beta/bray_curtis.qza; si se regenera ese artefacto,
// este test es el que avisa.
//
//   node tests/provenance-ui.mjs

import { findChrome } from './lib/env.mjs';

let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  \u2713 ' : '  \u2717 ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed = true;
};

if (!findChrome()) {
  console.log('SKIP: no hay Chrome local');
  process.exit(2);
}

const { ensureServer } = await import('./lib/server.mjs');
const { connect } = await import('./lib/cdp.mjs');
const { sleep } = await import('./lib/app.mjs');
const server = await ensureServer();
const c = await connect({ url: server.url + '/index.html', label: 'provenance-ui' });

try {
  await c.goto(); await sleep(1500);
  await c.ev(`location.hash = '#/cargar'`); await sleep(1200);
  // cargar el .qza de ejemplo por la misma vía que el usuario: ingestFile
  const r = await c.ev(`(async () => {
    const res = await fetch('/datos-ejemplo/diversidad-beta/bray_curtis.qza');
    const buf = await res.arrayBuffer();
    const file = new File([buf], 'bray_curtis.qza');
    const m = await import('/js/lib/ingest.js');
    const o = await m.ingestFile(file);
    return { kinds: o.results.map(x=>x.kind), hasProv: !!(o.provenance && o.provenance.hasProvenance) };
  })()`);
  check('ingestFile reconoce el artefacto: '+r.kinds.join(','), r.kinds.includes('betaDiversity'));
  check('y devuelve procedencia', r.hasProv);

  // ahora por la interfaz de verdad: simular el drop en el input de archivos
  const ui = await c.ev(`(async () => {
    const res = await fetch('/datos-ejemplo/diversidad-beta/bray_curtis.qza');
    const file = new File([await res.arrayBuffer()], 'bray_curtis.qza');
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.querySelector('#app-view input[type=file]');
    if (!input) return { err: 'no hay input de archivos' };
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`);
  check('hay input de archivos en #/cargar', !ui.err, ui.err||'');
  await sleep(2500);
  const dom = await c.ev(`(() => {
    const d = document.querySelector('#app-view details.ql-prov');
    if (!d) return { found:false };
    d.open = true;
    const items=[...d.querySelectorAll('.ql-prov-chain > li')].map(li=>li.textContent.replace(/\\s+/g,' ').trim());
    return { found:true, summary:d.querySelector('summary').textContent, items, finals:d.querySelectorAll('li.is-final').length,
             foot:[...d.querySelectorAll('.ql-field-help')].map(p=>p.textContent) };
  })()`);
  check('aparece el bloque de procedencia', dom.found);
  if (dom.found) {
    check('resumen: '+dom.summary, /4 pasos/.test(dom.summary));
    check('4 pasos en la cadena', dom.items.length===4, JSON.stringify(dom.items.length));
    check('1º import, 4º diversity beta', /Importación/.test(dom.items[0]) && /diversity beta/.test(dom.items[3]), dom.items[3]||'');
    check('el último va marcado como final', dom.finals===1);
    check('muestra parámetros citables', /metric = braycurtis/.test(dom.items[3]), dom.items[3]||'');
    check('muestra sampling_depth de la rarefacción', /sampling_depth = 1000/.test(dom.items[2]), dom.items[2]||'');
    check('pie con versión de QIIME 2', dom.foot.some(f=>/QIIME 2 2025\.10\.0/.test(f)), JSON.stringify(dom.foot[0]||''));
    check('aclara que no lo calcula Smart-175', dom.foot.some(f=>/no lo calcula Smart-175/.test(f)));
  }
  check('sin errores de consola', c.problems.length===0, c.problems.join('; '));
} finally { await c.close?.(); }
console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
