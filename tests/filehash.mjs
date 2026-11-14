// tests/filehash.mjs — la huella SHA-256 de los archivos de entrada
// (js/lib/fileHash.js), de punta a punta.
//
// Se comprueba contra el valor canónico de SHA-256("abc") y contra el
// sha256sum real del .qza de ejemplo del repo, que es lo que una persona
// ejecutaría para verificarlo (`shasum -a 256`). Si se regenera ese artefacto,
// el hash embebido aquí es el que avisa.
//
// Cubre también los dos casos en los que NO hay huella y hay que decirlo en vez
// de dejar el hueco: por encima del tope de tamaño, y sin contexto seguro
// (file://, donde crypto.subtle no existe — que es justo cómo se abriría un
// paquete offline).
//
//   node tests/filehash.mjs

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
const c = await connect({ url: server.url + '/index.html', label: 'filehash' });

try {
  await c.goto(); await sleep(1500);
  const avail = await c.ev(`(async()=>{const m=await import('/js/lib/fileHash.js');return m.hashAvailable();})()`);
  check('crypto.subtle disponible en contexto seguro', avail===true);
  const known = await c.ev(`(async()=>{
    const m=await import('/js/lib/fileHash.js');
    const r=await m.sha256Hex(new TextEncoder().encode('abc').buffer);
    return r.hex;
  })()`);
  // SHA-256("abc") es un valor canónico conocido
  check('SHA-256("abc") coincide con el valor canónico',
     known==='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', known);
  const tooBig = await c.ev(`(async()=>{
    const m=await import('/js/lib/fileHash.js');
    return (await m.sha256Hex(new ArrayBuffer(2048),{maxBytes:1024})).skipped;
  })()`);
  check('por encima del tope devuelve skipped=too-large', tooBig==='too-large', String(tooBig));

  await c.ev(`location.hash = '#/cargar'`); await sleep(1200);
  await c.ev(`(async () => {
    const res = await fetch('/datos-ejemplo/diversidad-beta/bray_curtis.qza');
    const file = new File([await res.arrayBuffer()], 'bray_curtis.qza');
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.querySelector('#app-view input[type=file]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(2800);
  const row = await c.ev(`(() => {
    const h = document.querySelector('#app-view .ql-file-hash');
    return h ? { text: h.textContent, title: h.getAttribute('title') } : null;
  })()`);
  check('la fila del archivo muestra la huella', !!row, JSON.stringify(row));
  if (row) {
    check('12 caracteres a la vista', row.text.length===12, row.text);
    check('hash completo en el title', /^SHA-256: [0-9a-f]{64}$/.test(row.title||''), (row.title||'').slice(0,30));
    check('coincide con el sha256sum real',
       (row.title||'').endsWith('b8c161547529813835c5022c0e446f5d347bc002c5392434a8f8f1c63680896f'));
  }
  // el informe solo monta secciones si antes se ha visitado algun modulo
  // (reportLog captura una instantanea por ruta visitada)
  await c.ev(`location.hash = '#/beta'`); await sleep(3000);
  await c.ev(`location.hash = '#/informe'`); await sleep(2000);
  // el documento solo se monta al pulsar "generar"
  const clicked = await c.ev(`(() => {
    const b=[...document.querySelectorAll('#app-view button')].find(x=>/Generar|Generate/i.test(x.textContent));
    if(b) b.click(); return !!b;
  })()`);
  check('hay botón de generar el informe', clicked===true);
  await sleep(4000);
  const rep = await c.ev(`(() => {
    const txt = document.querySelector('#app-view').textContent.replace(/\\s+/g,' ');
    return { hasHeading: /Archivos de entrada/.test(txt), hasHash: /b8c161547529/.test(txt), hasHowTo: /shasum -a 256/.test(txt) };
  })()`);
  check('el informe trae la sección de archivos de entrada', rep.hasHeading);
  check('con el hash completo', rep.hasHash);
  check('y cómo recalcularlo', rep.hasHowTo);
  check('sin errores de consola', c.problems.length===0, c.problems.join('; '));
} finally { await c.close?.(); }
console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
