// tests/antagonismo-ui.mjs — #/antagonismo en Chrome de verdad.
//
// Se fabrica una placa sintética con un micelio de radio conocido truncado a
// una distancia conocida, así que el PICR correcto se sabe de antemano: con
// radio libre 60 px y radio enfrentado 35 px, (60−35)/60 = 41,7 %.
//
// Eso permite comprobar de punta a punta lo que no se ve leyendo el código:
// que la foto se carga, que la calibración convierte a milímetros, que tocar
// el lienzo coloca el antagonista donde se ha tocado y que el número que sale
// en la tabla es el correcto.
//
//   node tests/antagonismo-ui.mjs

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

/**
 * Placa sintética: agar a 90, micelio a 200, truncado en x > cx+35.
 * Con `fade > 0` el borde del micelio se desvanece a lo largo de esos píxeles,
 * que es como se ve un frente de hifas de verdad.
 */
const makeImage = (fade = 0) => `(async () => {
  const cv = document.createElement('canvas');
  cv.width = 400; cv.height = 400;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(400, 400);
  for (let y = 0; y < 400; y++) {
    for (let x = 0; x < 400; x++) {
      const dx = x - 200, dy = y - 200;
      const inPlate = dx * dx + dy * dy <= 180 * 180;
      const d = Math.sqrt(dx * dx + dy * dy);
      const inMyc = d <= 60 && dx <= 35;
      let v = inPlate ? 90 : 20;
      if (inMyc) v = 200;
      else if (${fade} > 0 && inPlate && dx <= 35 && d > 60 && d <= 60 + ${fade}) {
        v = 200 - (200 - 90) * ((d - 60) / ${fade});
      }
      const p = (y * 400 + x) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const file = new File([blob], 'placa.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.querySelector('.ql-ag-file');
  if (!input) return 'sin input';
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

/** Toca el lienzo en coordenadas de la imagen. */
const tapCanvas = (x, y, shift = false) => `(() => {
  const cv = document.querySelector('.ql-ag-canvas');
  if (!cv) return 'sin lienzo';
  const r = cv.getBoundingClientRect();
  const cx = r.left + (${x} / cv.width) * r.width;
  const cy = r.top + (${y} / cv.height) * r.height;
  cv.dispatchEvent(new PointerEvent('pointerdown', {
    pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true,
    clientX: cx, clientY: cy, shiftKey: ${shift},
  }));
  return true;
})()`;

const setField = (label, value) => `(() => {
  const lab = [...document.querySelectorAll('label.ql-field')]
    .find((l) => l.querySelector('span') && l.querySelector('span').textContent === ${JSON.stringify(label)});
  if (!lab) return 'sin campo';
  const inp = lab.querySelector('input, select');
  inp.value = ${JSON.stringify(value)};
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

const resultRows = `[...document.querySelectorAll('.ql-table tbody tr')]
  .map((tr) => [...tr.children].map((td) => td.textContent))`;

const c = await connect({ url: server.url + '/index.html#/antagonismo', label: 'antagonismo' });
try {
  await c.goto();
  await sleep(1500);
  await c.ev(`localStorage.removeItem('smart-175.antagonismo')`);
  await c.goto();
  await sleep(1500);

  check('arranca pidiendo una foto y explicando cómo tomarla',
    (await c.ev(`document.body.innerText`)).includes('fondo oscuro'));

  check('la foto se carga', (await c.ev(makeImage(0))) === true);
  await sleep(1200);
  check('aparece el lienzo con la placa',
    (await c.ev(`!!document.querySelector('.ql-ag-canvas')`)) === true);

  // calibración determinista
  await c.ev(setField('Diámetro de placa', '90'));
  await sleep(300);
  await c.ev(setField('Radio de la placa (px)', '175'));
  await sleep(500);
  const scale = await c.ev(`document.body.innerText`);
  check('la escala sale de la placa y el radio: 90/350 = 257 µm por píxel',
    scale.includes('257.1'), scale.split('\n').find((l) => l.includes('Escala')) || '');

  check('sin marcas no inventa medidas',
    (await c.ev(`document.body.innerText`)).includes('al menos una fuente'));

  // antagonista a la derecha del centro, en la dirección truncada
  check('tocar el lienzo coloca el antagonista', (await c.ev(tapCanvas(330, 200))) === true);
  await sleep(900);

  const rows = await c.ev(resultRows);
  check('sale una fila de medida', rows.length === 1, JSON.stringify(rows));
  const r = rows[0] || [];
  check('el radio enfrentado ≈ 9,0 mm (35 px)',
    Math.abs(parseFloat(r[1]) - 9.0) < 0.6, r[1]);
  check('el radio libre ≈ 15,4 mm (60 px)',
    Math.abs(parseFloat(r[2]) - 15.4) < 0.6, r[2]);
  check('el PICR sale en 41,7 % ± 3',
    Math.abs(parseFloat(r[4]) - 41.7) < 3, r[4]);
  check('y sin avisos en una placa limpia', (r[5] || '').trim() === '', r[5]);

  check('dice que sin control usa el radio libre de la misma placa',
    (await c.ev(`document.body.innerText`)).includes('crecimiento simétrico'));
  check('y deja claro que no interpreta sensible ni resistente',
    (await c.ev(`document.body.innerText`)).includes('No se interpreta'));

  // un segundo antagonista en la dirección libre debe mover el sector libre
  await c.ev(tapCanvas(70, 200));
  await sleep(900);
  const rows2 = await c.ev(resultRows);
  check('un segundo antagonista añade su fila', rows2.length === 2, String(rows2.length));

  // Con el borde nítido de esta placa, mover el umbral NO debe cambiar la
  // medida: entre 90 y 200 cualquier corte cae en el mismo píxel.
  const nitidoAntes = parseFloat((await c.ev(resultRows))[0][1]);
  await c.ev(`(() => { const s = document.querySelector('input[type="range"]');
    s.value = '25'; s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(900);
  const nitidoDespues = parseFloat((await c.ev(resultRows))[0][1]);
  check('con borde nítido el umbral no mueve la medida: es robusta',
    nitidoDespues === nitidoAntes, `${nitidoAntes} → ${nitidoDespues}`);

  // Con un frente DIFUSO sí la mueve, y esa es justo la limitación que el
  // módulo tiene que poner delante del usuario con el deslizador.
  check('carga una segunda placa con el frente difuso',
    (await c.ev(makeImage(14))) === true);
  await sleep(1200);
  await c.ev(setField('Radio de la placa (px)', '175'));
  await sleep(400);
  await c.ev(tapCanvas(330, 200));
  await sleep(900);
  // El lado enfrentado de esta placa es un corte recto y sigue nítido; el que
  // tiene el frente difuso es el radio LIBRE, que es el de la columna 3.
  const difusoAntes = parseFloat((await c.ev(resultRows))[0][2]);
  await c.ev(`(() => { const s = document.querySelector('input[type="range"]');
    s.value = '30'; s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(900);
  const difusoDespues = parseFloat((await c.ev(resultRows))[0][2]);
  check('con frente difuso el umbral SÍ mueve el radio libre medido',
    Number.isFinite(difusoDespues) && difusoDespues !== difusoAntes,
    `${difusoAntes} → ${difusoDespues}`);
  check('y el módulo lo advierte junto al deslizador',
    (await c.ev(`document.body.innerText`)).includes('difuso'));

  // modo difusión
  await c.ev(setField('Ensayo', 'difusion'));
  await sleep(900);
  check('el modo difusión cambia las columnas de la tabla',
    (await c.ev(`[...document.querySelectorAll('.ql-table th')].map((h) => h.textContent).join(',')`))
      .includes('Diámetro'));

  check('0 errores de consola', c.problems.length === 0, c.problems.slice(0, 3).join(' | '));
} catch (e) {
  check('sin excepciones', false, e.stack || String(e));
} finally {
  c.kill();
}
if (server.started) server.stop();

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
