// tests/qpcr-ui.mjs — #/qpcr en Chrome de verdad.
//
// Comprueba lo que no se ve leyendo el código: que la página encadena datos →
// control de calidad → cuantificación, que la cuantificación está CERRADA
// hasta que el usuario marca que ha mirado los avisos, y que el número que
// acaba en pantalla es el correcto.
//
// Los valores de Cq son reales; los nombres de muestra y de la diana están
// genericizados, como el resto de los datos de ejemplo del repo.
//
//   node tests/qpcr-ui.mjs

import { findChrome } from './lib/env.mjs';

let failed = 0;
function check(name, ok, detail = '') {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (!ok && detail ? '  → ' + detail : ''));
  if (!ok) failed++;
}

if (!findChrome()) {
  console.log('SKIP: sin Chrome');
  process.exit(2);
}

const { ensureServer } = await import('./lib/server.mjs');
const { connect } = await import('./lib/cdp.mjs');
const { sleep } = await import('./lib/app.mjs');
const server = await ensureServer();

// Tanda: dos dianas (DIANA y 16S), tres muestras en triplicado, un control
// sin molde limpio y un grupo con un pocillo sin amplificar.
const CSV = [
  'Well,Target,Content,Sample,Cq',
  'A01,16S,Unkn,CAL,11.5912136023691',
  'A02,16S,Unkn,CAL,11.5678875659939',
  'A03,16S,Unkn,CAL,11.5873977206921',
  'A04,DIANA,Unkn,CAL,30.8220233355963',
  'A05,DIANA,Unkn,CAL,31.1514198352284',
  'A06,DIANA,Unkn,CAL,31.0177459348954',
  'C01,16S,Unkn,M4,27.0661930695187',
  'C02,16S,Unkn,M4,26.7074104333356',
  'C03,16S,Unkn,M4,26.4316609683506',
  'C04,DIANA,Unkn,M4,31.7720344884711',
  'C05,DIANA,Unkn,M4,31.6364498331699',
  'C06,DIANA,Unkn,M4,32.2047855063527',
  'E01,16S,Unkn,T0,22.307112241749',
  'E02,16S,Unkn,T0,21.6611535568359',
  'E03,16S,Unkn,T0,21.606595961934',
  'E04,DIANA,Unkn,T0,25.3545666575658',
  'E05,DIANA,Unkn,T0,25.7164564646609',
  'E06,DIANA,Unkn,T0,25.6650569677473',
  'G01,16S,Unkn,M5,20.1',
  'G02,16S,Unkn,M5,20.3',
  'G03,16S,Unkn,M5,20.2',
  'G04,DIANA,Unkn,M5,28.4',
  'G05,DIANA,Unkn,M5,',
  'G06,DIANA,Unkn,M5,28.9',
  'H12,DIANA,Neg Ctrl,,',
].join('\n');

const setText = (sel, value) => `(() => {
  const el = document.querySelector('${sel}');
  if (!el) return false;
  el.value = ${JSON.stringify(value)};
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

const pickSelect = (labelText, value) => `(() => {
  const lab = [...document.querySelectorAll('label.ql-field')]
    .find((l) => l.querySelector('span') && l.querySelector('span').textContent === ${JSON.stringify(labelText)});
  if (!lab) return 'sin etiqueta';
  const sel = lab.querySelector('select');
  if (!sel) return 'sin select';
  sel.value = ${JSON.stringify(value)};
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

const c = await connect({ url: server.url + '/index.html#/qpcr', label: 'qpcr' });
try {
  await c.goto();
  await sleep(1500);
  await c.ev(`localStorage.removeItem('smart-175.qpcr')`);
  await c.goto();
  await sleep(1500);

  check('la página arranca sin datos y sin control de calidad',
    (await c.ev(`document.querySelectorAll('.ql-panel').length`)) === 1);
  check('y con una indicación de qué hacer, no en blanco',
    (await c.ev(`!!document.querySelector('.ql-panel-note')`)) === true);

  // el ejemplo cargable: la vía rápida para ver el módulo funcionando
  await c.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Cargar ejemplo').click()`);
  await sleep(700);
  check('el ejemplo carga datos y abre las cuatro secciones',
    (await c.ev(`document.querySelectorAll('.ql-panel').length`)) === 4);
  check('y trae avisos de calidad de verdad',
    (await c.ev(`document.querySelectorAll('.ql-qpcr-issues li').length`)) > 0);
  await c.ev(`localStorage.removeItem('smart-175.qpcr')`);
  await c.goto();
  await sleep(1200);

  const pasted = await c.ev(setText('.ql-qpcr-paste', CSV));
  check('la tabla se puede pegar directamente', pasted === true);
  await sleep(600);

  const panels = await c.ev(`[...document.querySelectorAll('.ql-panel h2')].map((h) => h.textContent)`);
  check('aparecen las secciones de calidad, curvas y cuantificación',
    panels.length === 4, panels.join(' | '));

  // --- control de calidad --------------------------------------------------
  const issues = await c.ev(`[...document.querySelectorAll('.ql-qpcr-issues li')].map((l) => l.textContent)`);
  check('el control de calidad lista avisos', issues.length > 0, String(issues.length));
  check('señala el pocillo sin amplificar de M5/DIANA',
    issues.some((i) => i.includes('M5') && i.includes('DIANA')), issues.join(' // ').slice(0, 160));
  check('señala que falta el control sin molde de 16S',
    issues.some((i) => i.includes('16S') && /molde/i.test(i)));
  check('señala los 16S demasiado tempranos',
    issues.some((i) => /línea base|baseline/i.test(i)));

  const means = await c.ev(`[...document.querySelectorAll('.ql-table tbody tr')]
    .map((tr) => [...tr.children].map((td) => td.textContent))`);
  check('la tabla de calidad recalcula la media solo con lo que amplificó',
    means.some((r) => r[0] === 'M5' && r[1] === 'DIANA' && r[2] === '2' && r[3] === '1'
      && r[4] === '28.65'),
    JSON.stringify(means.find((r) => r[0] === 'M5' && r[1] === 'DIANA')));

  // --- la puerta -----------------------------------------------------------
  const blocked = await c.ev(`(() => {
    const panel = [...document.querySelectorAll('.ql-panel')].pop();
    return !!panel.querySelector('.ql-qpcr-warn') && panel.querySelectorAll('select').length === 0;
  })()`);
  check('la cuantificación está cerrada hasta revisar la calidad', blocked === true);

  await c.ev(`document.getElementById('qpcr-gate').click()`);
  await sleep(500);
  check('al marcar la revisión aparecen los selectores',
    (await c.ev(`document.querySelectorAll('select').length`)) >= 3);

  // --- cuantificación ------------------------------------------------------
  check('selecciona diana', (await c.ev(pickSelect('Diana', 'DIANA'))) === true);
  await sleep(300);
  check('selecciona referencia', (await c.ev(pickSelect('Gen de referencia', '16S'))) === true);
  await sleep(300);
  check('selecciona calibrador', (await c.ev(pickSelect('Calibrador', 'T0'))) === true);
  await sleep(600);

  const res = await c.ev(`[...document.querySelectorAll('.ql-table')].pop()
    ? [...[...document.querySelectorAll('.ql-table')].pop().querySelectorAll('tbody tr')]
      .map((tr) => [...tr.children].map((td) => td.textContent)) : []`);
  check('sale la tabla de resultados', res.length >= 4, JSON.stringify(res).slice(0, 200));

  const m4 = res.find((r) => r[0] === 'M4');
  check('el cambio de expresión de M4 contra T0 es 0,375',
    m4 && m4[4] === '0.375', m4 ? m4.join(' | ') : 'sin fila');
  check('y lleva intervalo, no un número pelado',
    m4 && /–/.test(m4[5]), m4 ? m4[5] : '');
  const cal = res.find((r) => r[0] === 'T0');
  check('el calibrador sale consigo mismo en 1', cal && cal[4] === '1.000', cal ? cal[4] : '');

  const notes = await c.ev(`[...document.querySelectorAll('.ql-panel-note')].map((p) => p.textContent)`);
  check('el calibrador se declara en pantalla',
    notes.some((n) => n.includes('Calibrador: T0')), notes.filter((n) => n.includes('Calibrador')).join(''));
  check('y se avisa de que se ha supuesto eficiencia del 100 %',
    notes.some((n) => /100 %/.test(n) && /eficiencia/i.test(n)));

  // --- curva estándar → Pfaffl --------------------------------------------
  await c.ev(`(() => {
    const tas = [...document.querySelectorAll('.ql-qpcr-curve textarea')];
    const perfect = (e) => (40 - 3.321928094887362 * e).toFixed(6);
    const body = [3,4,5,6,7].map((e) => '1e' + e + '\\t' + perfect(e)).join('\\n');
    tas.forEach((ta) => { ta.value = body; ta.dispatchEvent(new Event('change', { bubbles: true })); });
  })()`);
  await sleep(800);
  const fit = await c.ev(`[...document.querySelectorAll('.ql-qpcr-curve .ql-panel-note')].map((p) => p.textContent)`);
  check('con cinco puntos perfectos la eficiencia sale al 100 %',
    fit.some((f) => f.includes('100.0')), fit.join(' // ').slice(0, 160));
  const notes2 = await c.ev(`[...document.querySelectorAll('.ql-panel-note')].map((p) => p.textContent)`);
  check('con eficiencias medidas el método pasa a Pfaffl',
    notes2.some((n) => n.includes('Pfaffl')), notes2.filter((n) => n.includes('Método')).join(''));

  check('0 errores de consola', c.problems.length === 0, c.problems.slice(0, 3).join(' | '));
} catch (e) {
  check('sin excepciones', false, e.stack || String(e));
} finally {
  c.kill();
}
if (server.started) server.stop();

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
