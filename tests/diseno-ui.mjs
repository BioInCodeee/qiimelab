// tests/diseno-ui.mjs — #/diseno en Chrome de verdad.
//
// Comprueba el encadenado completo, que es lo que justifica el módulo: se
// declara un diseño, salen los números y los avisos, y el archivo de
// metadatos queda guardado de forma que #/mapa-placa puede repartirlo solo.
//
//   node tests/diseno-ui.mjs

import { findChrome } from './lib/env.mjs';

let failed = 0;
function check(name, ok, detail = '') {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (!ok && detail ? '  → ' + detail : ''));
  if (!ok) failed++;
}

if (!findChrome()) { console.log('SKIP: sin Chrome'); process.exit(2); }

const { ensureServer } = await import('./lib/server.mjs');
const { connect } = await import('./lib/cdp.mjs');
const { sleep } = await import('./lib/app.mjs');
const server = await ensureServer();

/** Escribe en el input cuya etiqueta coincide y dispara change. */
const setField = (label, value, nth = 0) => `(() => {
  const labs = [...document.querySelectorAll('label.ql-field')]
    .filter((l) => l.querySelector('span') && l.querySelector('span').textContent === ${JSON.stringify(label)});
  const lab = labs[${nth}];
  if (!lab) return 'sin campo';
  const inp = lab.querySelector('input, select');
  inp.value = ${JSON.stringify(value)};
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

const clickBtn = (text) => `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === ${JSON.stringify(text)});
  if (!b) return 'sin botón';
  b.click();
  return true;
})()`;

const bodyText = `document.body.innerText`;

const c = await connect({ url: server.url + '/index.html#/diseno', label: 'diseno' });
try {
  await c.goto();
  await sleep(1500);
  await c.ev(`localStorage.removeItem('smart-175.diseno')`);
  await c.goto();
  await sleep(1500);

  check('arranca con un diseño de ejemplo ya puesto',
    (await c.ev(bodyText)).includes('unidades experimentales'));

  // 3 niveles × 2 niveles × 3 réplicas = 18
  check('el recuento inicial es correcto',
    (await c.ev(bodyText)).includes('18 unidades experimentales'),
    (await c.ev(bodyText)).split('\n').find((l) => l.includes('unidades')) || '');

  check('y enseña de dónde sale el número',
    (await c.ev(bodyText)).includes('De dónde sale'));

  // --- la distinción que justifica el módulo -------------------------------
  check('pone réplicas técnicas', (await c.ev(setField('Réplicas técnicas', '3'))) === true);
  await sleep(500);
  let txt = await c.ev(bodyText);
  check('las técnicas NO cambian el número de unidades',
    txt.includes('18 unidades experimentales'));
  check('pero sí el de medidas', txt.includes('54 medidas'));

  check('baja a una réplica biológica', (await c.ev(setField('Réplicas biológicas', '1'))) === true);
  await sleep(500);
  txt = await c.ev(bodyText);
  check('con una biológica y técnicas, avisa de pseudorreplicación',
    txt.includes('pseudorreplicación'));
  await c.ev(setField('Réplicas biológicas', '3'));
  await c.ev(setField('Réplicas técnicas', '1'));
  await sleep(500);

  // --- muestreo destructivo ------------------------------------------------
  check('añade tiempos', (await c.ev(setField('Tiempos de muestreo', '24h, 48h, 72h'))) === true);
  await sleep(500);
  txt = await c.ev(bodyText);
  check('con muestreo destructivo los tiempos multiplican: 54 unidades',
    txt.includes('54 unidades experimentales'), txt.split('\n').find((l) => l.includes('unidades')) || '');

  await c.ev(`document.getElementById('ds-destructive').click()`);
  await sleep(500);
  txt = await c.ev(bodyText);
  check('sin muestreo destructivo vuelven a ser 18',
    txt.includes('18 unidades experimentales'));
  check('y avisa de que son medidas repetidas', txt.includes('medidas repetidas'));
  await c.ev(`document.getElementById('ds-destructive').click()`);
  await sleep(400);

  // --- medio, matraz y botellas -------------------------------------------
  txt = await c.ev(bodyText);
  check('propone el matraz que corresponde al volumen de trabajo',
    txt.includes('Erlenmeyer de 250 mL') || txt.includes('250 mL'),
    txt.split('\n').find((l) => l.includes('Erlenmeyer')) || '');
  check('calcula el medio a preparar con su exceso', txt.includes('Medio a preparar'));
  check('y lo reparte en botellas sin pasar del tope', txt.includes('Botellas'));

  // --- recuentos: la carga de siembra --------------------------------------
  check('añade un recuento', (await c.ev(clickBtn('Añadir recuento'))) === true);
  await sleep(400);
  await c.ev(setField('Variable', 'Bacterias totales'));
  await sleep(300);
  await c.ev(setField('Medio', 'PCA', 1));
  await sleep(500);
  txt = await c.ev(bodyText);
  check('la siembra aparece con su cuenta: 3 × 3 = 9 placas por muestra',
    txt.includes('3 × 3 = 9'), txt.split('\n').find((l) => l.includes('9')) || '');
  check('y el total de placas sale del número de unidades',
    txt.includes('486'), txt.split('\n').find((l) => l.includes('486')) || '');

  // --- etiquetas y semilla -------------------------------------------------
  check('sin semilla avisa de que no se aleatoriza',
    (await c.ev(bodyText)).includes('no se aleatoriza'));
  check('genera semilla', (await c.ev(clickBtn('Semilla nueva'))) === true);
  await sleep(500);
  check('con semilla lo dice y pide anotarla en Métodos',
    (await c.ev(bodyText)).includes('Métodos'));

  // --- el enlace con el mapa de placa --------------------------------------
  const stored = await c.ev(`(() => {
    const d = JSON.parse(localStorage.getItem('smart-175.diseno') || '{}');
    return { labels: (d.labels || []).length, order: (d.order || []).length, first: (d.labels || [])[0] };
  })()`);
  check('el diseño queda guardado con sus etiquetas y su orden',
    stored.labels === 54 && stored.order === 54, JSON.stringify(stored));
  check('las etiquetas llevan factores, tiempo y réplica',
    /Control/.test(stored.first) && /R1$/.test(stored.first), stored.first);

  const meta = await c.ev(`document.querySelectorAll('.ql-table').length`);
  check('hay vista previa de los metadatos', meta >= 2, String(meta));
  const headers = await c.ev(`[...document.querySelectorAll('.ql-table')].pop()
    ? [...[...document.querySelectorAll('.ql-table')].pop().querySelectorAll('th')].map((h) => h.textContent) : []`);
  check('la primera columna de los metadatos es sample-id',
    headers[0] === 'sample-id', headers.join(','));

  // y el mapa de placa lo ve
  await c.ev(`location.hash = '#/mapa-placa'`);
  await sleep(1200);
  check('el mapa de placa ofrece repartir ese diseño',
    (await c.ev(bodyText)).includes('Repartir el diseño'),
    (await c.ev(bodyText)).split('\n').find((l) => l.includes('Repartir')) || '');

  check('0 errores de consola', c.problems.length === 0, c.problems.slice(0, 3).join(' | '));
} catch (e) {
  check('sin excepciones', false, e.stack || String(e));
} finally {
  c.kill();
}
if (server.started) server.stop();

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
