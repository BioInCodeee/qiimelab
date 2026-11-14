// tests/colony-count.mjs — #/recuentos?tab=foto: pipeline de recuento de
// colonias sobre imagen, y la aritmética de UFC/mL compartida.
//
// Se prueba contra imágenes sintéticas construidas aquí (discos de posición y
// radio conocidos), que es la única forma de tener una verdad de referencia
// exacta: en una foto real el número "correcto" lo decide un humano.
//
// Los casos cubren lo que de verdad rompe un recuento por imagen:
//   - iluminación desigual (gradiente) → debe sobrevivir a la corrección de fondo
//   - colonias oscuras sobre agar claro y al contrario (polaridad)
//   - borde de la placa fuera de la ROI
//   - arañazos alargados → descartados por circularidad
//   - colonias en contacto → estimadas, no contadas como una
//   - cultivo confluente → marcado como no contable
//
//   node tests/colony-count.mjs

import {
  toGrayscale, boxBlur, otsuFromHistogram, histogramInMask, circleMask,
  suggestRoi, labelComponents, circularity, countColonies, applyManualEdits,
  distanceTransform, findSeeds, watershedSplit,
} from '../js/lib/colonyCount.js';
import { dilutionFactor, volumeInMl, cfuPerMl, plateReliability } from '../js/lib/cfu.js';
import { scaledSize, nearestMark } from '../js/modules/plateImage.js';

let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

// --- utilidades para construir placas sintéticas -----------------------------
function makePlate(width, height, opts = {}) {
  const { agar = 90, gradient = 0, outside = 20 } = opts;
  const data = new Uint8ClampedArray(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const R = opts.plateRadius != null ? opts.plateRadius : 0.45 * Math.min(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
      // gradiente de iluminación de izquierda a derecha
      const g = inside ? agar + gradient * (x / width - 0.5) * 2 : outside;
      const p = (y * width + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = Math.max(0, Math.min(255, g));
      data[p + 3] = 255;
    }
  }
  return { data, width, height, cx, cy, plateRadius: R };
}

function paintDisc(img, x0, y0, r, value) {
  for (let y = Math.floor(y0 - r); y <= Math.ceil(y0 + r); y++) {
    for (let x = Math.floor(x0 - r); x <= Math.ceil(x0 + r); x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      if ((x - x0) ** 2 + (y - y0) ** 2 > r * r) continue;
      const p = (y * img.width + x) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = value;
    }
  }
}

function paintRect(img, x0, y0, w, h, value) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const p = (y * img.width + x) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = value;
    }
  }
}

// rejilla de colonias separadas, dentro de un radio dado
function scatterColonies(img, n, r, value, radiusLimit) {
  const placed = [];
  const step = Math.ceil(Math.sqrt(n));
  const span = (radiusLimit * 1.4) / step;
  let k = 0;
  for (let i = 0; i < step && k < n; i++) {
    for (let j = 0; j < step && k < n; j++) {
      const x = img.cx - radiusLimit * 0.7 + span * (j + 0.5);
      const y = img.cy - radiusLimit * 0.7 + span * (i + 0.5);
      if ((x - img.cx) ** 2 + (y - img.cy) ** 2 > (radiusLimit * 0.9) ** 2) continue;
      paintDisc(img, x, y, r, value);
      placed.push({ x, y });
      k++;
    }
  }
  return placed;
}

// --- piezas del pipeline -----------------------------------------------------
console.log('piezas del pipeline');

const flat = makePlate(60, 60, { agar: 100 });
const g = toGrayscale(flat);
check('escala de grises por luminancia', Math.abs(g.gray[30 * 60 + 30] - 100) < 0.5, String(g.gray[30 * 60 + 30]));

const ramp = new Float32Array(25).fill(0);
ramp[12] = 100; // delta central
const blurred = boxBlur(ramp, 5, 5, 1);
const sumBefore = ramp.reduce((a, b) => a + b, 0);
const sumAfter = blurred.reduce((a, b) => a + b, 0);
check('el desenfoque de caja conserva aproximadamente la masa', Math.abs(sumBefore - sumAfter) / sumBefore < 0.25,
  sumBefore.toFixed(1) + ' → ' + sumAfter.toFixed(1));
check('el desenfoque reparte el delta a los vecinos', blurred[11] > 0 && blurred[12] < 100);
check('radio 0 no cambia nada', boxBlur(ramp, 5, 5, 0)[12] === 100);

const hist = new Uint32Array(256);
for (let i = 0; i < 100; i++) hist[30]++;
for (let i = 0; i < 100; i++) hist[200]++;
const th = otsuFromHistogram(hist);
// Convenio de Otsu: la clase baja es "≤ t", así que con dos modas puntuales en
// 30 y 200 cualquier t de [30, 199] las separa igual de bien y la
// implementación devuelve el primero. Lo que hay que exigir es la separación,
// no un valor intermedio concreto.
check('Otsu separa dos modas bien definidas', th >= 30 && th < 200 && !(30 > th) && 200 > th, 'th=' + th);
check('clasificar con «> t» deja cada moda en su clase', !(30 > th) && 200 > th);
check('Otsu con histograma vacío → -1', otsuFromHistogram(new Uint32Array(256)) === -1);

const m = circleMask(20, 20, 10, 10, 5);
check('la máscara circular marca el centro y no la esquina', m[10 * 20 + 10] === 1 && m[0] === 0);
const maskArea = m.reduce((a, b) => a + b, 0);
check('área de la máscara ≈ πr²', Math.abs(maskArea - Math.PI * 25) / (Math.PI * 25) < 0.15, String(maskArea));

check('histograma restringido a la máscara', histogramInMask(new Float32Array(400).fill(42), m)[42] === maskArea);

const binTwo = new Uint8Array(100);
[11, 12, 21, 22].forEach((i) => { binTwo[i] = 1; });  // cuadrado 2x2
[77, 78, 87, 88].forEach((i) => { binTwo[i] = 1; });  // otro, separado
const lab = labelComponents(binTwo, 10, 10);
check('dos objetos separados → dos componentes', lab.blobs.length === 2, String(lab.blobs.length));
check('área correcta de cada uno', lab.blobs.every((b) => b.area === 4));
check('centroide correcto', Math.abs(lab.blobs[0].cx - 1.5) < 1e-9 && Math.abs(lab.blobs[0].cy - 1.5) < 1e-9);

const diag = new Uint8Array(100);
[11, 22].forEach((i) => { diag[i] = 1; }); // solo tocándose en diagonal
check('8-vecinos une los contactos en diagonal', labelComponents(diag, 10, 10).blobs.length === 1);

check('circularidad de un disco grande ≈ 1', (() => {
  const w = 101;
  const bin = new Uint8Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) if ((x - 50) ** 2 + (y - 50) ** 2 <= 2500) bin[y * w + x] = 1;
  const b = labelComponents(bin, w, w).blobs[0];
  return circularity(b.area, b.perimeter) > 0.85;
})());
check('circularidad de una línea es baja', (() => {
  const bin = new Uint8Array(100 * 10);
  for (let x = 0; x < 100; x++) bin[5 * 100 + x] = 1;
  const b = labelComponents(bin, 100, 10).blobs[0];
  return circularity(b.area, b.perimeter) < 0.2;
})());
check('perímetro 0 → circularidad 0, sin dividir por cero', circularity(10, 0) === 0);

const roi = suggestRoi(toGrayscale(makePlate(200, 200, { agar: 180, outside: 20, plateRadius: 70 })));
check('la ROI sugerida centra la placa', Math.abs(roi.cx - 100) < 12 && Math.abs(roi.cy - 100) < 12,
  roi.cx.toFixed(1) + ',' + roi.cy.toFixed(1));
check('la ROI sugerida da un radio del orden de la placa', roi.radius > 45 && roi.radius < 100, roi.radius.toFixed(1));

// --- recuento completo -------------------------------------------------------
console.log('\nrecuento sobre placas sintéticas');

const R = 0.45 * 300;
const mkRoi = (img) => ({ cx: img.cx, cy: img.cy, radius: img.plateRadius * 0.95 });

// 24 colonias claras sobre agar oscuro, iluminación plana
const p1 = makePlate(300, 300, { agar: 80 });
const placed1 = scatterColonies(p1, 24, 5, 200, R);
const r1 = countColonies(p1, { roi: mkRoi(p1) });
check('cuenta 24 colonias claras sobre agar oscuro', r1.total === placed1.length,
  r1.total + ' vs ' + placed1.length);
check('ninguna marcada como agregado', r1.estimated === 0);
check('polaridad detectada: claras', r1.polarity === 'light', r1.polarity);
check('área mediana ≈ πr² de la colonia', Math.abs(r1.medianArea - Math.PI * 25) / (Math.PI * 25) < 0.2,
  r1.medianArea.toFixed(1));
check('no se marca como confluente', r1.confluent === false);

// mismas colonias con un gradiente de iluminación fuerte
const p2 = makePlate(300, 300, { agar: 80, gradient: 60 });
const placed2 = scatterColonies(p2, 24, 5, 200, R);
const r2 = countColonies(p2, { roi: mkRoi(p2) });
check('la corrección de fondo aguanta un gradiente de ±60 niveles', r2.total === placed2.length,
  r2.total + ' vs ' + placed2.length);

// colonias oscuras sobre agar claro
const p3 = makePlate(300, 300, { agar: 200, outside: 30 });
const placed3 = scatterColonies(p3, 16, 5, 60, R);
const r3 = countColonies(p3, { roi: mkRoi(p3) });
check('cuenta colonias oscuras sobre agar claro', r3.total === placed3.length, r3.total + ' vs ' + placed3.length);
check('polaridad detectada: oscuras', r3.polarity === 'dark', r3.polarity);

// polaridad forzada en contra → no debe encontrar las colonias
const r3f = countColonies(p3, { roi: mkRoi(p3), polarity: 'light' });
check('forzar la polaridad equivocada no inventa el mismo recuento', r3f.total !== placed3.length,
  'total=' + r3f.total);

// borde de la placa: fuera de la ROI no se cuenta nada
const p4 = makePlate(300, 300, { agar: 80 });
const placed4 = scatterColonies(p4, 12, 5, 200, R);
for (let a = 0; a < 360; a += 2) { // reborde brillante del plástico
  const rad = (a * Math.PI) / 180;
  paintDisc(p4, p4.cx + Math.cos(rad) * p4.plateRadius, p4.cy + Math.sin(rad) * p4.plateRadius, 3, 255);
}
const r4 = countColonies(p4, { roi: { cx: p4.cx, cy: p4.cy, radius: p4.plateRadius * 0.9 } });
check('el reborde de la placa queda fuera de la ROI', r4.total === placed4.length, r4.total + ' vs ' + placed4.length);

// arañazo alargado → fuera por circularidad
const p5 = makePlate(300, 300, { agar: 80 });
const placed5 = scatterColonies(p5, 9, 5, 200, R);
paintRect(p5, Math.round(p5.cx - 60), Math.round(p5.cy + 40), 120, 3, 210);
const r5 = countColonies(p5, { roi: mkRoi(p5) });
check('un arañazo alargado no se cuenta como colonia', r5.total === placed5.length, r5.total + ' vs ' + placed5.length);

// colonias en contacto → estimadas, no contadas como una sola.
// Son del MISMO tamaño que las demás: el tamaño típico de colonia lo fija la
// mediana de la propia placa, así que el agregado se detecta por ser varias
// veces esa mediana, no por una constante.
const p6 = makePlate(300, 300, { agar: 80 });
const singles6 = scatterColonies(p6, 9, 5, 200, R);
paintDisc(p6, p6.cx + 60, p6.cy - 60, 5, 200);
paintDisc(p6, p6.cx + 68, p6.cy - 60, 5, 200);
paintDisc(p6, p6.cx + 64, p6.cy - 53, 5, 200);
const r6 = countColonies(p6, { roi: mkRoi(p6) });
check('un agregado se estima en más de una colonia', r6.estimated >= 2, 'estimadas=' + r6.estimated);
check('el agregado se marca como tal', r6.items.some((i) => i.merged === true));
check('counted + estimated = total', r6.counted + r6.estimated === r6.total);
check('el total queda cerca de las colonias reales', Math.abs(r6.total - (singles6.length + 3)) <= 2,
  r6.total + ' vs ' + (singles6.length + 3));

// cultivo confluente
const p7 = makePlate(300, 300, { agar: 80 });
paintDisc(p7, p7.cx, p7.cy, p7.plateRadius * 0.85, 200);
const r7 = countColonies(p7, { roi: mkRoi(p7) });
check('un cultivo confluente se marca como no contable', r7.confluent === true);

// placa vacía
const r8 = countColonies(makePlate(200, 200, { agar: 100 }), { roi: { cx: 100, cy: 100, radius: 80 } });
check('placa sin colonias → recuento 0', r8.total === 0, String(r8.total));

// sensibilidad
const p9 = makePlate(300, 300, { agar: 80 });
scatterColonies(p9, 24, 5, 140, R); // colonias de bajo contraste
const low = countColonies(p9, { roi: mkRoi(p9), sensitivity: 60 });
check('subir el umbral reduce o mantiene el recuento', low.total <= countColonies(p9, { roi: mkRoi(p9) }).total,
  low.total + ' ≤ ' + countColonies(p9, { roi: mkRoi(p9) }).total);

// --- correcciones manuales ---------------------------------------------------
console.log('\ncorrecciones manuales');

const fake = {
  items: [
    { merged: false, count: 1 },
    { merged: false, count: 1 },
    { merged: true, count: 3, split: 'watershed' },
    { merged: true, count: 2, split: 'area' },
  ],
};
check('sin ediciones: 2 contadas + 5 estimadas', applyManualEdits(fake).total === 7);
check('quitar una marca automática', applyManualEdits(fake, { removed: [0] }).total === 6);
check('quitar un agregado quita sus colonias estimadas', applyManualEdits(fake, { removed: [2] }).total === 4);
check('añadir marcas a mano suma', applyManualEdits(fake, { added: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }).total === 9);
check('las añadidas se informan por separado', applyManualEdits(fake, { added: [{ x: 1, y: 1 }] }).manual === 1);
check('se distingue lo separado por watershed de lo estimado por área', (() => {
  const r = applyManualEdits(fake);
  return r.estimatedWatershed === 3 && r.estimatedArea === 2 && r.estimated === 5;
})(), JSON.stringify(applyManualEdits(fake)));
check('quitar el agregado por área no toca el del watershed', (() => {
  const r = applyManualEdits(fake, { removed: [3] });
  return r.estimatedWatershed === 3 && r.estimatedArea === 0;
})());

// --- UFC/mL ------------------------------------------------------------------
console.log('\nUFC/mL');

check('dilución 10⁻³ en modo exponente', Math.abs(dilutionFactor('exp', 3) - 0.001) < 1e-12);
check('el signo del exponente es indiferente', dilutionFactor('exp', -3) === dilutionFactor('exp', 3));
check('dilución como factor directo', dilutionFactor('factor', '0,001') === 0.001);
check('dilución como razón 1:1000', dilutionFactor('ratio', 1000) === 0.001);
check('dilución no interpretable → NaN', Number.isNaN(dilutionFactor('exp', 'abc')));

check('100 µL son 0,1 mL', volumeInMl(100, 'ul') === 0.1);
check('1 L son 1000 mL', volumeInMl(1, 'l') === 1000);
check('volumen 0 o negativo → NaN', Number.isNaN(volumeInMl(0, 'ml')) && Number.isNaN(volumeInMl(-1, 'ml')));
check('unidad desconocida → NaN', Number.isNaN(volumeInMl(1, 'barriles')));

// 68 colonias, 0,1 mL sembrados, 10⁻³ → 68 / (0,1 × 0,001) = 6,8e5
check('UFC/mL del caso de libro', Math.abs(cfuPerMl(68, 0.1, 0.001) - 6.8e5) / 6.8e5 < 1e-12,
  cfuPerMl(68, 0.1, 0.001).toExponential(2));
check('0 colonias es un resultado válido (0 UFC/mL)', cfuPerMl(0, 0.1, 0.001) === 0);
check('sin volumen → NaN', Number.isNaN(cfuPerMl(68, NaN, 0.001)));
check('colonias negativas → NaN', Number.isNaN(cfuPerMl(-1, 0.1, 0.001)));

check('25-250 colonias es el rango fiable', plateReliability(68) === 'ok');
check('por debajo de 25 avisa de recuento bajo', plateReliability(12) === 'low');
check('por encima de 250 avisa de placa saturada', plateReliability(400) === 'high');
check('sin dato → none', plateReliability('') === 'none');

// --- transformada de distancia y watershed ----------------------------------
console.log('\ntransformada de distancia y watershed');

// disco de radio 12: la distancia en el centro debe valer ~12
const W = 61;
const disc = new Uint8Array(W * W);
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if ((x - 30) ** 2 + (y - 30) ** 2 <= 144) disc[y * W + x] = 1;
const dtDisc = distanceTransform(disc, W, W);
check('la distancia en el centro de un disco ≈ su radio', Math.abs(dtDisc[30 * W + 30] - 12) <= 1,
  dtDisc[30 * W + 30].toFixed(2));
check('la distancia en el fondo es 0', dtDisc[0] === 0);
check('el máximo está en el centro', (() => {
  let best = -1; let bi = -1;
  for (let i = 0; i < dtDisc.length; i++) if (dtDisc[i] > best) { best = dtDisc[i]; bi = i; }
  return Math.abs((bi % W) - 30) <= 1 && Math.abs(Math.floor(bi / W) - 30) <= 1;
})());

// exactitud contra fuerza bruta en una máscara pequeña arbitraria
check('coincide con la fuerza bruta (euclídea exacta)', (() => {
  const w = 17; const h = 13;
  const bin = new Uint8Array(w * h);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < bin.length; i++) bin[i] = rnd() < 0.65 ? 1 : 0;
  const fast = distanceTransform(bin, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[y * w + x]) continue;
      let best = Infinity;
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          if (bin[j * w + i]) continue;
          best = Math.min(best, Math.sqrt((x - i) ** 2 + (y - j) ** 2));
        }
      }
      if (Number.isFinite(best) && Math.abs(fast[y * w + x] - best) > 1e-6) return false;
    }
  }
  return true;
})());

// helper: máscara con discos dados, y cuántas partes saca el watershed
function splitCount(circles, size = 121, minSeedDist = null) {
  const bin = new Uint8Array(size * size);
  circles.forEach(([cx, cy, r]) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) bin[y * size + x] = 1;
      }
    }
  });
  const dist = distanceTransform(bin, size, size);
  const pixels = [];
  for (let i = 0; i < bin.length; i++) if (bin[i]) pixels.push(i);
  const rMed = circles[0][2];
  const seeds = findSeeds(dist, pixels, size, minSeedDist != null ? minSeedDist : Math.max(2, rMed * 0.55));
  const ws = watershedSplit(dist, pixels, size, size, seeds);
  return { seeds: seeds.length, ...ws, pixels: pixels.length };
}

const one = splitCount([[60, 60, 12]]);
check('una colonia sola no se parte en dos', one.seeds === 1, 'semillas=' + one.seeds);

const two = splitCount([[50, 60, 12], [72, 60, 12]]);
check('dos colonias en contacto → 2 partes', two.count === 2, 'partes=' + two.count + ' semillas=' + two.seeds);
check('las dos partes reparten el área del agregado',
  two.parts.length === 2 && Math.abs(two.parts[0].area - two.parts[1].area) / two.pixels < 0.15,
  two.parts.map((p) => p.area).join('/') + ' de ' + two.pixels);
check('los centros de las partes caen cerca de los centros reales',
  two.parts.every((p) => Math.min(Math.abs(p.x - 50), Math.abs(p.x - 72)) < 4),
  two.parts.map((p) => p.x.toFixed(1)).join(','));

const three = splitCount([[52, 55, 11], [70, 55, 11], [61, 70, 11]]);
check('tres colonias en racimo → 3 partes', three.count === 3, 'partes=' + three.count);

const four = splitCount([[35, 60, 10], [53, 60, 10], [71, 60, 10], [89, 60, 10]]);
check('cadena de cuatro → 4 partes', four.count === 4, 'partes=' + four.count);

// tamaños distintos: es el caso en el que el estimador por área falla
const uneven = splitCount([[50, 60, 16], [78, 60, 9]], 141, Math.max(2, 9 * 0.55));
check('dos colonias de tamaño muy distinto → 2 partes, no 3', uneven.count === 2, 'partes=' + uneven.count);

// solapamiento severo: el watershed ya no debería inventarse crestas
const fused = splitCount([[58, 60, 12], [64, 60, 12]]);
check('solapamiento casi total → no se fuerza la división', fused.count <= 2, 'partes=' + fused.count);

check('sin semillas o con una sola → no hay división', (() => {
  const r1 = watershedSplit(new Float32Array(10), [0, 1], 5, 2, []);
  const r2 = watershedSplit(new Float32Array(10), [0, 1], 5, 2, [{ idx: 0, x: 0, y: 0, d: 1 }]);
  return r1.count === 0 && r1.parts.length === 0 && r2.count === 1 && r2.parts.length === 0;
})());

// --- integración: el recuento usa el watershed ------------------------------
console.log('\nel recuento completo usa el watershed');

const p10 = makePlate(300, 300, { agar: 80 });
const singles10 = scatterColonies(p10, 9, 5, 200, R);
// un par en contacto, del mismo tamaño que las demás, lejos de la rejilla
// (la rejilla cae en cx-63/cx/cx+63, así que a cx+100 no choca con ninguna)
paintDisc(p10, p10.cx + 96, p10.cy, 5, 200);
paintDisc(p10, p10.cx + 105, p10.cy, 5, 200);
const r10 = countColonies(p10, { roi: mkRoi(p10) });
const agg10 = r10.items.filter((i) => i.merged);
check('el agregado se parte por watershed, no por área',
  agg10.length === 1 && agg10[0].split === 'watershed', JSON.stringify(agg10.map((a) => a.split)));
check('el par en contacto se cuenta como 2', agg10.length === 1 && agg10[0].count === 2,
  'count=' + (agg10[0] ? agg10[0].count : '—'));
check('el total es exacto', r10.total === singles10.length + 2, r10.total + ' vs ' + (singles10.length + 2));
check('se informa de cuántos agregados se dividieron por watershed',
  r10.watershedSplits === 1 && r10.aggregates === 1,
  'ws=' + r10.watershedSplits + ' agg=' + r10.aggregates);
check('cada parte trae su centro para poder dibujarla',
  agg10[0].parts.length === 2 && agg10[0].parts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));

// --- ayudantes de la interfaz -----------------------------------------------
console.log('\nayudantes de la interfaz');

check('una foto de 4032×3024 se reescala sin deformarse', (() => {
  const r = scaledSize(4032, 3024, 1400);
  return r.width === 1400 && Math.abs(r.height - 1050) <= 1 &&
    Math.abs(r.width / r.height - 4032 / 3024) < 0.01;
})(), JSON.stringify(scaledSize(4032, 3024, 1400)));
check('una imagen pequeña no se amplía', (() => {
  const r = scaledSize(600, 400, 1400);
  return r.width === 600 && r.height === 400 && r.scale === 1;
})());
check('vertical: el lado largo es el que manda', scaledSize(3024, 4032, 1400).height === 1400);

const marks = [{ x: 10, y: 10 }, { x: 100, y: 100 }];
check('un toque encima de una marca la encuentra', nearestMark(marks, 12, 11, 10) === 0);
check('gana la más cercana', nearestMark(marks, 98, 99, 20) === 1);
check('un toque lejos no encuentra ninguna', nearestMark(marks, 50, 50, 10) === -1);
check('lista vacía → -1', nearestMark([], 1, 1, 10) === -1 && nearestMark(undefined, 1, 1, 10) === -1);

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
