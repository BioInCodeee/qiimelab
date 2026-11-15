// Geometría de medición sobre una foto de placa, compartida por los dos
// ensayos de #/antagonismo (enfrentamiento y difusión en disco).
//
// Aquí vive todo lo que convierte píxeles en milímetros y lo que localiza un
// borde biológico sobre la imagen. Las métricas propias de cada ensayo (PICR,
// diámetros de halo) están en antagonismMetrics.js, que no toca imágenes.
//
// Se apoya en el pipeline que ya tiene colonyCount.js: no se reimplementa la
// escala de grises, ni la corrección de iluminación, ni Otsu, ni la ROI.
//
// NOTA de deuda conocida: en el repo hay ya tres copias privadas de `median`
// (ancomBC.js, colonyCount.js, statAutoSelect.js). Aquí se exporta una cuarta
// porque la robustez de la medida depende de ella y hace falta testearla
// aparte; consolidar las cuatro en stats.js es una tarea pendiente aparte.

import { solveLinearSystem, jacobiEigenSymmetric } from './linalg.js';
import {
  toGrayscale, boxBlur, otsuDetail, histogramInMask, circleMask, suggestRoi,
} from './colonyCount.js';

/** Mediana. Devuelve NaN con lista vacía. */
export function median(values) {
  const a = Array.from(values).filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Milímetros por píxel a partir del diámetro nominal de la placa y el radio
 * en píxeles de la ROI que la delimita.
 *
 * El diámetro nominal es el EXTERNO de la placa de Petri (90 mm en la placa
 * estándar), que es el círculo marcado que la cámara ve y al que `suggestRoi`
 * se ancla. Si se cambiara `suggestRoi` para ceñirse al borde del agar, esta
 * fórmula habría que corregirla: el agar es sensiblemente menor que la placa.
 * @returns {number} mm/px, o NaN si los datos no sirven.
 */
export function mmPerPixel(plateDiameterMm, roiRadiusPx) {
  const d = Number(plateDiameterMm);
  const r = Number(roiRadiusPx);
  if (!(d > 0) || !(r > 0)) return NaN;
  return d / (2 * r);
}

/** Diámetros nominales de los objetos de referencia habituales, en mm. */
export const REFERENCE_OBJECTS = {
  disc6: { mm: 6, kind: 'disc' },        // disco de papel de antibiograma
  oxford8: { mm: 8, kind: 'cylinder' },  // cilindro de Oxford: 8 ext / 6 int / 10 alto
  well5: { mm: 5, kind: 'well' },
  well6: { mm: 6, kind: 'well' },
  well8: { mm: 8, kind: 'well' },
};

/**
 * ¿Cuadra el objeto de referencia con su medida nominal? Es la comprobación
 * más rentable del módulo: si el disco de 6 mm "mide" 9, la calibración está
 * mal (o la foto no está perpendicular) y TODAS las medidas de la placa están
 * sesgadas por el mismo factor.
 * @returns {{ok:boolean, measuredMm:number, nominalMm:number, relError:number}}
 */
export function referenceCheck(measuredMm, nominalMm, tolerance = 0.15) {
  const m = Number(measuredMm);
  const n = Number(nominalMm);
  if (!(m > 0) || !(n > 0)) return { ok: false, measuredMm: m, nominalMm: n, relError: NaN };
  const relError = (m - n) / n;
  return { ok: Math.abs(relError) <= tolerance, measuredMm: m, nominalMm: n, relError };
}

/**
 * Ajuste de elipse por mínimos cuadrados a un conjunto de puntos de borde.
 *
 * Se ajusta la cónica a·x² + b·xy + c·y² + d·x + e·y = 1 (es decir, f = -1)
 * sobre los puntos centrados en su centroide. Centrar importa por dos
 * razones: condiciona mejor el sistema, y garantiza que el origen cae DENTRO
 * de la elipse y no sobre ella, que es el único caso donde fijar f = -1
 * degeneraría.
 *
 * Después se traslada al centro y se diagonaliza [[a, b/2], [b/2, c]]: los
 * semiejes son sqrt(-f'/λ) y el ángulo sale del autovector. Reutiliza
 * `solveLinearSystem` y `jacobiEigenSymmetric` de linalg.js.
 *
 * @param {Array<{x:number,y:number}>} points Al menos 5 puntos no alineados.
 * @returns {{cx:number,cy:number,a:number,b:number,theta:number}|null}
 *   a = semieje mayor, b = semieje menor, theta = ángulo del semieje mayor en
 *   radianes. null si los puntos no definen una elipse (recta, hipérbola,
 *   sistema singular).
 */
export function fitEllipse(points) {
  const pts = (points || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 5) return null;

  let mx = 0;
  let my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= pts.length;
  my /= pts.length;

  // normales del sistema sobredeterminado: (XᵗX)·coef = Xᵗ1
  const ATA = Array.from({ length: 5 }, () => new Array(5).fill(0));
  const ATb = Array.from({ length: 5 }, () => [0]);
  for (const p of pts) {
    const x = p.x - mx;
    const y = p.y - my;
    const row = [x * x, x * y, y * y, x, y];
    for (let i = 0; i < 5; i++) {
      ATb[i][0] += row[i];
      for (let j = 0; j < 5; j++) ATA[i][j] += row[i] * row[j];
    }
  }

  let coef;
  try {
    coef = solveLinearSystem(ATA, ATb).map((r) => r[0]);
  } catch {
    return null; // singular: los puntos no definen una cónica (p. ej. alineados)
  }
  const [a, b, c, d, e] = coef;
  const f = -1;

  // centro: resolver [[2a, b], [b, 2c]]·(x0, y0) = (-d, -e)
  const det = 4 * a * c - b * b;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const x0 = (b * e - 2 * c * d) / det;
  const y0 = (b * d - 2 * a * e) / det;

  // valor de la cónica en su centro
  const fc = a * x0 * x0 + b * x0 * y0 + c * y0 * y0 + d * x0 + e * y0 + f;
  if (!Number.isFinite(fc) || fc === 0) return null;

  const eig = jacobiEigenSymmetric([[a, b / 2], [b / 2, c]]);
  const [l1, l2] = eig.values;
  // semiejes: a·x'² + b·x'y' + c·y'² = -f'  →  λ·u² = -f'
  const s1 = -fc / l1;
  const s2 = -fc / l2;
  if (!(s1 > 0) || !(s2 > 0)) return null; // no es una elipse

  // jacobiEigenSymmetric ordena los autovalores de mayor a menor, así que l1
  // es el mayor y le corresponde el semieje MENOR
  const semiMinor = Math.sqrt(s1);
  const semiMajor = Math.sqrt(s2);
  const vMajor = eig.vectors[1];
  const theta = Math.atan2(vMajor[1], vMajor[0]);

  return {
    cx: x0 + mx,
    cy: y0 + my,
    a: Math.max(semiMajor, semiMinor),
    b: Math.min(semiMajor, semiMinor),
    theta: semiMajor >= semiMinor ? theta : Math.atan2(eig.vectors[0][1], eig.vectors[0][0]),
  };
}

/**
 * Relación entre semieje menor y mayor: 1 = círculo perfecto.
 * Es la medida de "qué poco redonda" sale la placa, y con ella se decide si
 * la cámara estaba perpendicular.
 */
export function axisRatio(ellipse) {
  if (!ellipse || !(ellipse.a > 0)) return NaN;
  return Math.min(ellipse.a, ellipse.b) / Math.max(ellipse.a, ellipse.b);
}

/**
 * ¿Estaba la cámara perpendicular? Una placa inclinada se proyecta como
 * elipse y todas las medidas quedan sesgadas de forma distinta según la
 * dirección, que es el peor tipo de sesgo: no se corrige con un factor.
 * No se intenta rectificar la perspectiva — se avisa y se repite la foto.
 * @returns {{ok:boolean, ratio:number}}
 */
export function perspectiveCheck(ellipse, tolerance = 0.03) {
  const ratio = axisRatio(ellipse);
  if (!Number.isFinite(ratio)) return { ok: false, ratio };
  return { ok: (1 - ratio) <= tolerance, ratio };
}

/**
 * Fondo estimado SOLO con los píxeles de dentro de la placa.
 *
 * Es la diferencia importante con la corrección de colonyCount.js, que
 * desenfoca la imagen entera. Fuera de la placa hay mesa, sombra o fondo
 * oscuro, y al desenfocar con un radio grande ese oscuro se mete hacia dentro:
 * el fondo estimado baja cerca del reborde, la imagen corregida sube ahí, y
 * aparece un anillo claro espurio pegado al borde que un umbral confunde con
 * crecimiento. Con radios pequeños el efecto es leve (de ahí que colonyCount
 * no lo note), pero aquí los radios son del orden de la placa entera.
 *
 * Se resuelve con dos desenfoques: el de los valores enmascarados y el de la
 * propia máscara, y dividiendo. Sigue siendo O(n) porque boxBlur lo es.
 */
function maskedBackground(gray, mask, width, height, radius) {
  const vals = new Float32Array(gray.length);
  const w = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const m = (mask && !mask[i]) ? 0 : 1;
    vals[i] = gray[i] * m;
    w[i] = m;
  }
  const bv = boxBlur(vals, width, height, radius);
  const bw = boxBlur(w, width, height, radius);
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = bw[i] > 1e-6 ? bv[i] / bw[i] : gray[i];
  return out;
}

/**
 * Prepara la imagen para medir: gris, corrección de iluminación, umbral de
 * Otsu dentro de la placa y polaridad resuelta.
 *
 * `bgRadiusFactor` es el parámetro que hay que entender antes de tocar nada.
 * La corrección de fondo resta un desenfoque de la propia imagen, y para que
 * eso estime el FONDO y no el objeto, el radio tiene que ser bastante mayor
 * que el objeto:
 *
 *   - colonias (un par de milímetros): 0.25 del radio de la placa sobra, y es
 *     lo que usa colonyCount.js.
 *   - un micelio que ocupa media placa, o un césped que la cubre casi entera:
 *     con 0.25 el desenfoque se "come" el propio objeto y su interior queda
 *     aplanado contra el fondo, así que deja de detectarse. Hace falta 1.0
 *     (todo el radio de la placa).
 *
 * Los dos ensayos de este módulo miden objetos grandes, así que el valor por
 * defecto es 1.0 para los dos. El 0.25 queda disponible por si algún día se
 * mide algo del tamaño de una colonia.
 *
 * @param {ImageData|{data:Uint8ClampedArray,width:number,height:number}} imageData
 * @param {{cx:number,cy:number,radius:number}} [roi]
 * @param {{sensitivity?:number, polarity?:'auto'|'light'|'dark',
 *          bgRadiusFactor?:number, minContrast?:number}} [opts]
 * @returns {{corrected:Float32Array, width:number, height:number, mask:Uint8Array,
 *            roi:Object, threshold:number, otsu:number, contrast:number,
 *            polarity:'light'|'dark', fraction:number, lowContrast:boolean}}
 */
export function prepareField(imageData, roi = null, opts = {}) {
  const grayInfo = toGrayscale(imageData);
  const { gray, width, height } = grayInfo;
  const theRoi = roi || suggestRoi(grayInfo);
  const mask = circleMask(width, height, theRoi.cx, theRoi.cy, theRoi.radius);

  const factor = Number.isFinite(opts.bgRadiusFactor) ? opts.bgRadiusFactor : 1.0;
  let corrected;
  if (factor > 0) {
    const bg = maskedBackground(
      gray, mask, width, height, Math.max(4, Math.round(theRoi.radius * factor)),
    );
    corrected = new Float32Array(gray.length);
    for (let i = 0; i < gray.length; i++) corrected[i] = gray[i] - bg[i] + 128;
  } else {
    corrected = Float32Array.from(gray);
  }

  const det = otsuDetail(histogramInMask(corrected, mask));
  const threshold = det.threshold + (Number(opts.sensitivity) || 0);
  const minContrast = Number.isFinite(opts.minContrast) ? opts.minContrast : 8;

  // Fracción de la placa por encima del umbral, que es lo que decide la
  // polaridad en automático y lo que delata una placa saturada.
  let above = 0;
  let total = 0;
  for (let i = 0; i < corrected.length; i++) {
    if (!mask[i]) continue;
    total++;
    if (corrected[i] > threshold) above++;
  }
  const fracAbove = total ? above / total : 0;

  let polarity;
  if (opts.polarity === 'light' || opts.polarity === 'dark') polarity = opts.polarity;
  else polarity = fracAbove <= 0.5 ? 'light' : 'dark';
  const fraction = polarity === 'light' ? fracAbove : 1 - fracAbove;

  return {
    corrected, width, height, mask, roi: theRoi,
    threshold, otsu: det.threshold, contrast: det.contrast,
    polarity, fraction,
    lowContrast: !(det.contrast >= minContrast),
  };
}

/** ¿Es este valor "objeto" según la polaridad del campo? */
function isObject(field, value) {
  return field.polarity === 'light' ? value > field.threshold : value < field.threshold;
}

/**
 * Radio de interés a lo largo de un rayo que sale de (cx, cy) en `angle`.
 *
 * Los dos ensayos NO miden lo mismo, y de ahí el parámetro `mode`:
 *
 *   - `'end'` (enfrentamiento): dónde ACABA el objeto. El rayo sale del punto
 *     de siembra del hongo, atraviesa el micelio y lo que interesa es el
 *     frente de avance.
 *   - `'onset'` (difusión): dónde EMPIEZA el objeto. El rayo sale del disco o
 *     cilindro, cruza la zona limpia y lo que interesa es dónde arranca el
 *     césped, que es el borde del halo.
 *
 * En los dos casos se exige un tramo sostenido de `runLength` píxeles antes de
 * dar un borde por bueno, y se devuelve el borde MÁS INTERNO que lo cumple.
 * Eso resuelve dos problemas reales de una sola vez: en `'end'`, una colonia
 * satélite más allá de un hueco no estira el frente; en `'onset'`, ni el
 * propio objeto de referencia ni su sombra se toman por césped (para la
 * sombra hace falta además `skipInner`, ver más abajo).
 *
 * `skipInner` descarta los primeros píxeles del rayo. En difusión no es
 * opcional: un cilindro de Oxford mide 10 mm de alto, refleja la luz y
 * proyecta un anillo de sombra justo a su alrededor, y sin descartar ese
 * anillo el borde detectado es el de la sombra en vez del del halo.
 *
 * @returns {{radiusPx:number, censored:boolean, floored:boolean}|null}
 *   censored = en `'end'`, el objeto seguía al llegar al límite de la ROI: la
 *   medida está cortada por la pared de la placa, no por la biología.
 *   floored = en `'onset'`, el objeto ya estaba presente en el primer píxel
 *   evaluado, así que el radio devuelto es el propio `skipInner` y no un borde
 *   de verdad. Es el caso de una placa sin halo: el césped llega hasta el
 *   cilindro y lo único que limita la medida es la máscara. Hay que tratarlo
 *   como «sin inhibición», nunca como un halo pequeño.
 *   null = no hay nada que medir en esta dirección.
 */
export function rayEdge(field, cx, cy, angle, opts = {}) {
  const { width, height, mask, corrected, roi } = field;
  const skipInner = Math.max(0, Number(opts.skipInner) || 0);
  const runLength = Math.max(1, Number(opts.runLength) || 3);
  const step = Number(opts.step) > 0 ? Number(opts.step) : 1;
  const mode = opts.mode === 'onset' ? 'onset' : 'end';
  const maxRadius = Number.isFinite(opts.maxRadius)
    ? opts.maxRadius
    : (roi ? roi.radius : Math.min(width, height) / 2);

  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  let candidate = null;  // en 'end', último píxel de objeto; en 'onset', primero
  let bgRun = 0;
  let objRun = 0;
  let sawObject = false;

  for (let r = skipInner; r <= maxRadius; r += step) {
    const x = Math.round(cx + dx * r);
    const y = Math.round(cy + dy * r);
    if (x < 0 || y < 0 || x >= width || y >= height) break;
    const i = y * width + x;
    if (mask && !mask[i]) break;

    if (isObject(field, corrected[i])) {
      sawObject = true;
      bgRun = 0;
      if (mode === 'onset') {
        if (objRun === 0) candidate = r;
        objRun += step;
        if (objRun >= runLength) {
          return { radiusPx: candidate, censored: false, floored: candidate <= skipInner };
        }
      } else {
        candidate = r;
      }
    } else {
      objRun = 0;
      if (mode === 'onset') {
        candidate = null;
      } else {
        bgRun += step;
        if (bgRun >= runLength && candidate != null) {
          return { radiusPx: candidate, censored: false, floored: false };
        }
      }
    }
  }

  if (!sawObject || candidate == null) return null;
  // Se salió del bucle sin cumplir el criterio: en 'end' significa que el
  // objeto seguía al llegar al borde de la ROI, y la medida está censurada por
  // la pared de la placa.
  return {
    radiusPx: candidate,
    censored: mode === 'end',
    floored: mode === 'onset' && candidate <= skipInner,
  };
}

/**
 * Radio robusto de un sector angular: mediana de los radios de varios rayos.
 *
 * Mediana y no media, a conciencia: un solo rayo que atraviesa una muesca de
 * contaminación, la sombra del cilindro o una burbuja del agar devolvería un
 * radio disparatado, y la media lo arrastraría.
 *
 * @param {number} angleCenter Dirección central del sector, en radianes.
 * @param {number} halfWidth Semiapertura del sector, en radianes.
 * @returns {{radiusPx:number, n:number, censored:number, floored:number,
 *            radii:number[]}}
 */
export function sectorRadius(field, cx, cy, angleCenter, halfWidth, opts = {}) {
  const rays = Math.max(1, Math.round(Number(opts.rays) || 31));
  const radii = [];
  let censored = 0;
  let floored = 0;
  for (let k = 0; k < rays; k++) {
    const t = rays === 1 ? 0.5 : k / (rays - 1);
    const angle = angleCenter - halfWidth + 2 * halfWidth * t;
    const hit = rayEdge(field, cx, cy, angle, opts);
    if (!hit) continue;
    radii.push(hit.radiusPx);
    if (hit.censored) censored++;
    if (hit.floored) floored++;
  }
  return {
    radiusPx: radii.length ? median(radii) : NaN,
    n: radii.length,
    censored,
    floored,
    radii,
  };
}

/** Normaliza un ángulo a [0, 2π). */
function norm(angle) {
  const t = angle % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
}

/**
 * Dirección más alejada de todos los antagonistas: el centro del mayor hueco
 * angular libre. Ahí es donde se mide el radio "libre" del hongo.
 *
 * Con un solo antagonista el resultado es exactamente su opuesto (180°), que
 * es el caso habitual; con varios NO lo es, y medir a ciegas a 180° del
 * primero caería dentro de la zona de influencia de otro.
 *
 * @param {number[]} angles Ángulos de los antagonistas, en radianes.
 * @returns {{angle:number, halfGap:number}|null} halfGap = semiamplitud del
 *   hueco libre, útil para no abrir el sector de medida más de lo que cabe.
 */
export function freestDirection(angles) {
  const list = (angles || []).filter((a) => Number.isFinite(a)).map(norm).sort((x, y) => x - y);
  if (!list.length) return null;
  if (list.length === 1) {
    return { angle: norm(list[0] + Math.PI), halfGap: Math.PI };
  }
  let bestStart = list[0];
  let bestGap = -1;
  for (let i = 0; i < list.length; i++) {
    const from = list[i];
    const to = i === list.length - 1 ? list[0] + 2 * Math.PI : list[i + 1];
    const gap = to - from;
    if (gap > bestGap) { bestGap = gap; bestStart = from; }
  }
  return { angle: norm(bestStart + bestGap / 2), halfGap: bestGap / 2 };
}
