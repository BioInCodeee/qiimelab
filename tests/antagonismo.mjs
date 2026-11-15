// tests/antagonismo.mjs — #/antagonismo: geometría de medición sobre foto de
// placa (plateMetrology.js) y métricas de los dos ensayos
// (antagonismMetrics.js).
//
// Las imágenes son sintéticas y se construyen aquí: con un micelio de radio
// conocido truncado a una distancia conocida, el PICR correcto se sabe de
// antemano. En una foto real el número "correcto" lo decide un humano, así que
// no hay otra forma de tener verdad de referencia exacta.
//
// Los casos cubren lo que de verdad rompe estas medidas:
//   - iluminación desigual → debe sobrevivir a la corrección de fondo
//   - micelio que alcanza la pared de la placa → NO medible, no un número
//   - varios antagonistas → el sector libre es el más alejado de todos
//   - sombra del cilindro de Oxford → no debe tomarse por borde del halo
//   - radios contaminados por una muesca → la mediana no se mueve
//   - PICR negativo → se reporta, no se recorta
//
//   node tests/antagonismo.mjs

import {
  median, mmPerPixel, referenceCheck, fitEllipse, axisRatio, perspectiveCheck,
  prepareField, rayEdge, sectorRadius, freestDirection, REFERENCE_OBJECTS,
} from '../js/lib/plateMetrology.js';
import {
  picr, inhibitionGap, confrontation, halo, overlappingHalos, formatMm, WARN,
} from '../js/lib/antagonismMetrics.js';

let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed = true;
};
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

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
      const g = inside ? agar + gradient * (x / width - 0.5) * 2 : outside;
      const p = (y * width + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = Math.max(0, Math.min(255, g));
      data[p + 3] = 255;
    }
  }
  return { data, width, height, cx, cy, plateRadius: R };
}

/** Pinta donde `fn(x, y)` sea cierto. */
function paintWhere(img, value, fn) {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (!fn(x, y)) continue;
      const p = (y * img.width + x) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = value;
    }
  }
}

/** Micelio circular de radio `r` truncado en x > cx + cut (cut = Infinity → sin truncar). */
function paintMycelium(img, cx, cy, r, value, cut = Infinity) {
  paintWhere(img, value, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r && (x - cx) <= cut);
}

function paintAnnulus(img, cx, cy, rIn, rOut, value) {
  paintWhere(img, value, (x, y) => {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2;
    return d2 >= rIn * rIn && d2 <= rOut * rOut;
  });
}

const W = 400;
const H = 400;
const ROI = { cx: 200, cy: 200, radius: 175 };

// =============================================================================
console.log('\nmm/píxel y objeto de referencia');
// =============================================================================

check('placa de 90 mm con ROI de 175 px → 0,2571 mm/px',
  near(mmPerPixel(90, 175), 90 / 350, 1e-9));
// A igual radio en píxeles, una placa más pequeña significa que cada píxel
// abarca MENOS milímetros.
check('a igual ROI, la placa de 55 mm da menos mm por píxel que la de 150',
  mmPerPixel(55, 175) < mmPerPixel(150, 175));
check('datos imposibles → NaN',
  Number.isNaN(mmPerPixel(0, 175)) && Number.isNaN(mmPerPixel(90, 0)));

check('el cilindro de Oxford es de 8 mm, no de 6',
  REFERENCE_OBJECTS.oxford8.mm === 8 && REFERENCE_OBJECTS.disc6.mm === 6);
check('disco medido en 6,3 mm sobre 6 nominales → pasa',
  referenceCheck(6.3, 6).ok);
check('cilindro medido en 11 mm sobre 8 nominales → no pasa',
  !referenceCheck(11, 8).ok);
check('el error relativo se reporta con signo',
  near(referenceCheck(9, 6).relError, 0.5, 1e-9));

// =============================================================================
console.log('\nmediana robusta');
// =============================================================================

check('mediana de impar', median([3, 1, 2]) === 2);
check('mediana de par', median([1, 2, 3, 4]) === 2.5);
check('un valor disparatado no la mueve', median([60, 61, 59, 60, 5]) === 60);
check('lista vacía → NaN', Number.isNaN(median([])));

// =============================================================================
console.log('\najuste de elipse');
// =============================================================================

{
  // caso analítico: a=50, b=30, centro (120, 80), girada 30°
  const a = 50;
  const b = 30;
  const th = Math.PI / 6;
  const pts = [];
  for (let k = 0; k < 24; k++) {
    const t = (2 * Math.PI * k) / 24;
    const x = a * Math.cos(t);
    const y = b * Math.sin(t);
    pts.push({
      x: 120 + x * Math.cos(th) - y * Math.sin(th),
      y: 80 + x * Math.sin(th) + y * Math.cos(th),
    });
  }
  const fit = fitEllipse(pts);
  check('recupera los semiejes', fit && near(fit.a, a, 0.01) && near(fit.b, b, 0.01),
    fit ? `a=${fit.a.toFixed(3)} b=${fit.b.toFixed(3)}` : 'null');
  check('recupera el centro', fit && near(fit.cx, 120, 0.01) && near(fit.cy, 80, 0.01));
  check('recupera el ángulo (módulo π)',
    fit && near(Math.abs(Math.sin(fit.theta - th)), 0, 1e-3),
    fit ? `θ=${(fit.theta * 180 / Math.PI).toFixed(2)}°` : 'null');

  const circle = [];
  for (let k = 0; k < 12; k++) {
    const t = (2 * Math.PI * k) / 12;
    circle.push({ x: 50 * Math.cos(t), y: 50 * Math.sin(t) });
  }
  check('un círculo da relación de ejes 1', near(axisRatio(fitEllipse(circle)), 1, 1e-6));
  check('el círculo pasa la comprobación de perspectiva',
    perspectiveCheck(fitEllipse(circle)).ok);
  check('la elipse al 60 % NO pasa la comprobación de perspectiva',
    !perspectiveCheck(fit).ok);

  check('menos de 5 puntos → null', fitEllipse([{ x: 0, y: 0 }, { x: 1, y: 1 }]) === null);
  check('puntos alineados → null', fitEllipse([
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 },
    { x: 4, y: 4 }, { x: 5, y: 5 },
  ]) === null);
}

// =============================================================================
console.log('\ndirección libre con varios antagonistas');
// =============================================================================

check('un antagonista → su opuesto exacto',
  near(freestDirection([0]).angle, Math.PI, 1e-9));
check('dos a 90° → la bisectriz del hueco grande (225°)',
  near(freestDirection([0, Math.PI / 2]).angle, 5 * Math.PI / 4, 1e-9),
  `${(freestDirection([0, Math.PI / 2]).angle * 180 / Math.PI).toFixed(1)}°`);
check('tres repartidos → el centro del mayor hueco',
  near(freestDirection([0, Math.PI / 4, Math.PI / 2]).angle, Math.PI / 2 + 3 * Math.PI / 4, 1e-9));
check('el hueco libre se reporta para no abrir el sector más de lo que cabe',
  near(freestDirection([0, Math.PI / 2]).halfGap, 3 * Math.PI / 4, 1e-9));
check('sin antagonistas → null', freestDirection([]) === null);

// =============================================================================
console.log('\naritmética de PICR');
// =============================================================================

check('inhibición del 41,7 %', near(picr(60, 35), 41.666, 0.01));
check('sin inhibición → 0', picr(60, 60) === 0);
check('inhibición total → 100', picr(60, 0) === 100);
check('PICR negativo se reporta, no se recorta a cero',
  near(picr(50, 60), -20, 1e-9));
check('radio de referencia cero → null (no es divisible)', picr(0, 10) === null);
check('radio de referencia negativo → null', picr(-5, 10) === null);

check('hueco de inhibición', near(inhibitionGap(15, 30, 4), 11, 1e-9));
check('micelio que invade el cilindro → hueco negativo',
  inhibitionGap(28, 30, 4) < 0);

// =============================================================================
console.log('\nvalidaciones del enfrentamiento');
// =============================================================================

{
  const base = {
    rFacingMm: 9, rFreeMm: 15.4, centerToSourceMm: 30,
    sourceRadiusMm: 4, plateRadiusMm: 45,
  };

  const ok = confrontation(base);
  check('caso limpio: medible y con PICR de misma placa',
    ok.measurable && near(ok.picrSamePlate, 41.55, 0.1), `PICR=${ok.picrSamePlate.toFixed(2)}`);
  check('sin control, la referencia preferida es la misma placa',
    ok.preferredSource === 'samePlate' && ok.picrVsControl === null);

  const withControl = confrontation({ ...base, rControlMm: 16 });
  check('con control enlazado, el PICR preferido es el del control',
    withControl.preferredSource === 'control'
    && near(withControl.picrVsControl, 43.75, 0.01));
  check('y las dos cifras se devuelven juntas',
    withControl.picrSamePlate != null && withControl.picrVsControl != null);

  const edge = confrontation({ ...base, rFreeMm: 44 });
  check('micelio en la pared de la placa → NO medible',
    !edge.measurable && edge.warnings.includes(WARN.EDGE_CENSORED));
  check('y no por eso deja de calcular, solo de dar la placa por buena',
    edge.picrSamePlate != null);

  const censored = confrontation({ ...base, freeCensored: true });
  check('rayo libre censurado por la ROI → NO medible', !censored.measurable);

  const reached = confrontation({ ...base, rFacingMm: 27 });
  check('micelio que alcanza el cilindro → aviso de que no hay zona libre',
    reached.warnings.includes(WARN.REACHED_SOURCE) && reached.gapMm <= 0);

  const asym = confrontation({ ...base, rControlMm: 16, controlAxisRatio: 0.82 });
  check('control elíptico → aviso de simetría dudosa',
    asym.warnings.includes(WARN.CONTROL_ASYMMETRIC));
  check('control redondo → sin ese aviso',
    !confrontation({ ...base, rControlMm: 16, controlAxisRatio: 0.98 })
      .warnings.includes(WARN.CONTROL_ASYMMETRIC));

  const disc = confrontation({ ...base, rControlMm: 30 });
  check('discrepancia grande entre misma placa y control → aviso',
    disc.warnings.includes(WARN.PICR_DISCREPANCY));

  const stim = confrontation({ ...base, rFacingMm: 18 });
  check('estímulo del crecimiento: PICR negativo con su aviso',
    stim.picrSamePlate < 0 && stim.warnings.includes(WARN.GROWTH_STIMULATED));
  check('y sigue siendo una placa medible: es un resultado, no un fallo',
    stim.measurable);

  const dead = confrontation({ ...base, noGrowth: true });
  check('placa sin crecimiento → no interpretable y sin cifras',
    !dead.measurable && dead.picrPreferred === null
    && dead.warnings.includes(WARN.NO_GROWTH));
}

// =============================================================================
console.log('\nhalos de difusión');
// =============================================================================

{
  const h = halo({ d1Mm: 22, d2Mm: 24, referenceDiameterMm: 8 });
  check('media de los dos diámetros', h.meanMm === 23);
  check('la diferencia entre ambos se reporta (halo no redondo)', h.deltaMm === 2);
  check('hay inhibición', h.inhibition);

  const none = halo({ d1Mm: 8, d2Mm: 8, referenceDiameterMm: 8 });
  check('halo igual al cilindro → sin inhibición, no un número',
    !none.inhibition && none.warnings.includes(WARN.NO_INHIBITION));
  const small = halo({ d1Mm: 7, d2Mm: 7.5, referenceDiameterMm: 8 });
  check('halo menor que el cilindro → sin inhibición', !small.inhibition);

  check('un solo diámetro: media sin delta',
    halo({ d1Mm: 20, referenceDiameterMm: 8 }).deltaMm === null);

  const pairs = overlappingHalos([
    { x: 0, y: 0, radiusMm: 10 },
    { x: 15, y: 0, radiusMm: 10 },
    { x: 60, y: 0, radiusMm: 5 },
  ]);
  check('halos que se tocan se detectan como no medibles',
    pairs.length === 1 && pairs[0][0] === 0 && pairs[0][1] === 1);

  check('redondeo honesto a una cifra decimal', formatMm(23.4712) === 23.5);
}

// =============================================================================
console.log('\nenfrentamiento sobre imagen sintética');
// =============================================================================

{
  // Micelio de radio 60 px truncado a 35 px por el lado del antagonista (+x).
  // PICR esperado = (60 - 35) / 60 * 100 = 41,67 %
  const img = makePlate(W, H, { agar: 90 });
  paintMycelium(img, 200, 200, 60, 200, 35);
  const field = prepareField(img, ROI, { polarity: 'light' });

  const facing = sectorRadius(field, 200, 200, 0, 0.26, { rays: 21, skipInner: 4 });
  const free = sectorRadius(field, 200, 200, Math.PI, 0.26, { rays: 21, skipInner: 4 });
  check('radio hacia el antagonista ≈ 35 px', near(facing.radiusPx, 35, 2),
    `${facing.radiusPx}`);
  check('radio libre ≈ 60 px', near(free.radiusPx, 60, 2), `${free.radiusPx}`);
  const p = picr(free.radiusPx, facing.radiusPx);
  check('PICR dentro de ±3 puntos del valor real', near(p, 41.67, 3), `${p.toFixed(2)} %`);
  check('ningún rayo censurado en una placa holgada',
    facing.censored === 0 && free.censored === 0);
}

{
  // Lo mismo con gradiente de iluminación de lado a lado.
  const img = makePlate(W, H, { agar: 90, gradient: 60 });
  paintMycelium(img, 200, 200, 60, 200, 35);
  const field = prepareField(img, ROI, { polarity: 'light' });
  const facing = sectorRadius(field, 200, 200, 0, 0.26, { rays: 21, skipInner: 4 });
  const free = sectorRadius(field, 200, 200, Math.PI, 0.26, { rays: 21, skipInner: 4 });
  const p = picr(free.radiusPx, facing.radiusPx);
  check('sobrevive al gradiente de iluminación', near(p, 41.67, 5),
    `${Number.isFinite(p) ? p.toFixed(2) : p} %`);
}

{
  // Muesca de agar dentro del micelio en una dirección: un par de rayos
  // devuelven un radio corto. La mediana no debe moverse.
  const img = makePlate(W, H, { agar: 90 });
  paintMycelium(img, 200, 200, 60, 200, Infinity);
  paintWhere(img, 90, (x, y) => Math.abs(y - 200) <= 1 && x > 220 && x < 260);
  const field = prepareField(img, ROI, { polarity: 'light' });
  const sec = sectorRadius(field, 200, 200, 0, 0.26, { rays: 21, skipInner: 4 });
  check('una muesca en dos rayos no arrastra la mediana', near(sec.radiusPx, 60, 2),
    `${sec.radiusPx}`);
}

{
  // Micelio que ha llegado a la pared: la medida está cortada por el plástico.
  const img = makePlate(W, H, { agar: 90 });
  paintMycelium(img, 200, 200, 174, 200, 35);
  const field = prepareField(img, ROI, { polarity: 'light' });
  const free = sectorRadius(field, 200, 200, Math.PI, 0.26, { rays: 21, skipInner: 4 });
  check('micelio hasta el borde → rayos censurados', free.censored > 0,
    `${free.censored}/${free.n}`);

  const mmPx = mmPerPixel(90, ROI.radius);
  const res = confrontation({
    rFacingMm: 35 * mmPx,
    rFreeMm: free.radiusPx * mmPx,
    centerToSourceMm: 30,
    sourceRadiusMm: 4,
    plateRadiusMm: ROI.radius * mmPx,
    freeCensored: free.censored > 0,
  });
  check('y la placa se marca NO medible en vez de dar un PICR',
    !res.measurable && res.warnings.includes(WARN.EDGE_CENSORED));
}

{
  // Placa sin crecimiento: Otsu partiría el ruido del agar.
  const img = makePlate(W, H, { agar: 90 });
  const field = prepareField(img, ROI, {});
  check('placa sin crecimiento → contraste bajo detectado', field.lowContrast,
    `contraste=${field.contrast.toFixed(2)}`);
}

// =============================================================================
console.log('\ndifusión sobre imagen sintética: la sombra del cilindro');
// =============================================================================

{
  // Geometría de difusión: cilindro brillante en el centro, su anillo de
  // sombra alrededor, zona limpia, y césped bacteriano a partir de 70 px.
  // El borde del halo es 70 px; sin descartar la sombra se mediría ~3 px.
  const img = makePlate(W, H, { agar: 100 });        // agar limpio = 100
  paintAnnulus(img, 200, 200, 70, 175, 180);         // césped = 180
  paintAnnulus(img, 200, 200, 15, 23, 45);           // sombra del cilindro = 45
  paintMycelium(img, 200, 200, 15, 235, Infinity);   // cilindro metálico = 235
  const field = prepareField(img, ROI, { polarity: 'light' });

  const naive = sectorRadius(field, 200, 200, 0, Math.PI, {
    rays: 36, mode: 'onset', skipInner: 0,
  });
  const masked = sectorRadius(field, 200, 200, 0, Math.PI, {
    rays: 36, mode: 'onset', skipInner: 28,
  });
  check('sin máscara anular el borde detectado es el cilindro, no el halo',
    naive.radiusPx < 30, `${naive.radiusPx}`);
  check('con la máscara anular el borde del halo sale en ≈70 px',
    near(masked.radiusPx, 70, 3), `${masked.radiusPx}`);
  check('y es un borde de verdad, no el suelo de la máscara',
    masked.floored === 0 && naive.floored > 0);

  const mmPx = mmPerPixel(90, ROI.radius);
  const d = 2 * masked.radiusPx * mmPx;
  const h = halo({ d1Mm: d, d2Mm: d, referenceDiameterMm: 8 });
  check('el halo en mm es coherente con la calibración',
    near(h.meanMm, 2 * 70 * mmPx, 1), `${h.meanMm.toFixed(1)} mm`);
  check('y hay inhibición porque supera el cilindro', h.inhibition);
}

{
  // Césped que llega hasta el cilindro: no hay halo.
  const img = makePlate(W, H, { agar: 100 });
  paintAnnulus(img, 200, 200, 24, 175, 180);
  paintMycelium(img, 200, 200, 15, 235, Infinity);
  const field = prepareField(img, ROI, { polarity: 'light' });
  const sec = sectorRadius(field, 200, 200, 0, Math.PI, {
    rays: 36, mode: 'onset', skipInner: 28,
  });
  check('placa sin halo: el césped ya está en el primer píxel medido',
    sec.floored === sec.n && sec.n > 0, `${sec.floored}/${sec.n}`);
  // Y por eso el radio devuelto NO es un halo: es el propio skipInner. Si se
  // tomara por una medida real saldría un halo de ~14 mm inexistente, que es
  // justo el error que `floored` existe para impedir.
  const mmPx = mmPerPixel(90, ROI.radius);
  const h = halo({
    d1Mm: sec.floored === sec.n ? 0 : 2 * sec.radiusPx * mmPx,
    d2Mm: sec.floored === sec.n ? 0 : 2 * sec.radiusPx * mmPx,
    referenceDiameterMm: 8,
  });
  check('→ se reporta «sin inhibición», no un número pequeño',
    !h.inhibition && h.warnings.includes(WARN.NO_INHIBITION));
}

// =============================================================================
console.log('\nmodos de rayo: acabar vs empezar');
// =============================================================================

{
  const img = makePlate(W, H, { agar: 90 });
  paintMycelium(img, 200, 200, 50, 200, Infinity);
  paintAnnulus(img, 200, 200, 90, 110, 200);  // colonia satélite más allá de un hueco
  const field = prepareField(img, ROI, { polarity: 'light' });

  const end = rayEdge(field, 200, 200, 0, { mode: 'end', skipInner: 4 });
  check('modo «acabar»: una satélite tras un hueco no estira el frente',
    end && near(end.radiusPx, 50, 2), end ? `${end.radiusPx}` : 'null');

  const onset = rayEdge(field, 200, 200, 0, { mode: 'onset', skipInner: 60 });
  check('modo «empezar»: con skipInner encuentra la satélite a 90 px',
    onset && near(onset.radiusPx, 90, 2), onset ? `${onset.radiusPx}` : 'null');

  check('dirección sin nada que medir → null',
    rayEdge(field, 200, 200, 0, { mode: 'onset', skipInner: 115 }) === null);
}

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
