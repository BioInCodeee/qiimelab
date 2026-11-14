// Recuento de colonias sobre una foto de la placa, entero en el navegador.
// Sin dependencias y sin red: la imagen nunca sale del equipo del usuario.
//
// El pipeline es el clásico de conteo de partículas, con las decisiones
// pensadas para una foto de móvil de una placa de Petri:
//
//   1. escala de grises por luminancia
//   2. corrección de iluminación: se resta una versión muy desenfocada de la
//      propia imagen (equivalente barato al "rolling ball" de ImageJ), porque
//      una foto de placa casi siempre tiene un lado más iluminado que el otro
//      y un umbral global sobre la imagen cruda cortaría ese gradiente en vez
//      de las colonias
//   3. umbral automático de Otsu sobre los píxeles DE DENTRO de la placa
//   4. etiquetado de componentes conexas (8-vecinos)
//   5. filtros por área y por circularidad, para descartar arañazos, el borde
//      de la placa, rotulaciones y motas de polvo
//   6. los objetos muy grandes se tratan como colonias en contacto y se
//      estiman por área / área mediana
//
// LÍMITES, que el módulo muestra al usuario y conviene no olvidar: esto es un
// recuento ASISTIDO, no un dato cerrado. Colonias muy solapadas se cuentan de
// menos, las puntiformes pueden caer por debajo del área mínima, y un cultivo
// confluente no es contable por ningún método. Por eso el resultado es
// corregible a mano y se informa de cuántas colonias son estimadas.

/** Media ponderada de luminancia (Rec. 601), la que usa ImageJ por defecto. */
export function toGrayscale(imageData) {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return { gray, width, height };
}

/**
 * Desenfoque de caja separable por medias móviles: O(n) en vez de O(n·r²),
 * que es lo que permite desenfocar con radios grandes (los que hacen falta
 * para estimar el fondo) sin bloquear la pestaña.
 * @param {Float32Array} src
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 * @returns {Float32Array}
 */
export function boxBlur(src, width, height, radius) {
  const r = Math.max(0, Math.floor(radius));
  if (r === 0) return Float32Array.from(src);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);

  // horizontal
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / (2 * r + 1);
      const add = src[row + Math.min(width - 1, x + r + 1)];
      const rem = src[row + Math.max(0, x - r)];
      sum += add - rem;
    }
  }
  // vertical
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / (2 * r + 1);
      const add = tmp[Math.min(height - 1, y + r + 1) * width + x];
      const rem = tmp[Math.max(0, y - r) * width + x];
      sum += add - rem;
    }
  }
  return out;
}

/**
 * Umbral de Otsu: el que maximiza la varianza entre las dos clases de un
 * histograma de 256 niveles.
 * @param {ArrayLike<number>} hist 256 frecuencias.
 * @returns {number} Nivel de corte (0-255); -1 si el histograma está vacío.
 */
export function otsuFromHistogram(hist) {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
  if (total === 0) return -1;
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let bestVar = -1;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = i; }
  }
  return best;
}

/**
 * Otsu con el detalle que hace falta para decidir si el corte significa algo:
 * además del umbral, las medias de las dos clases. Si esas medias casi
 * coinciden, Otsu ha partido ruido — el histograma no tiene dos poblaciones,
 * y en una placa eso quiere decir que no hay nada que destaque del agar.
 * @param {ArrayLike<number>} hist 256 frecuencias.
 * @returns {{threshold:number,meanBelow:number,meanAbove:number,contrast:number}}
 */
export function otsuDetail(hist) {
  const threshold = otsuFromHistogram(hist);
  if (threshold < 0) return { threshold, meanBelow: NaN, meanAbove: NaN, contrast: 0 };
  let nB = 0; let sB = 0; let nA = 0; let sA = 0;
  for (let i = 0; i < 256; i++) {
    if (i <= threshold) { nB += hist[i]; sB += i * hist[i]; }
    else { nA += hist[i]; sA += i * hist[i]; }
  }
  const meanBelow = nB ? sB / nB : NaN;
  const meanAbove = nA ? sA / nA : NaN;
  const contrast = (Number.isFinite(meanBelow) && Number.isFinite(meanAbove)) ? meanAbove - meanBelow : 0;
  return { threshold, meanBelow, meanAbove, contrast };
}

/** Histograma de 256 niveles de los valores dentro de la máscara. */
export function histogramInMask(values, mask) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) {
    if (mask && !mask[i]) continue;
    let v = Math.round(values[i]);
    v = v < 0 ? 0 : (v > 255 ? 255 : v);
    hist[v]++;
  }
  return hist;
}

/**
 * Máscara circular: la zona de la placa que se analiza. Excluir el borde es
 * importante de verdad — el reborde del plástico y la sombra que proyecta son
 * lo primero que un umbral confunde con colonias.
 * @returns {Uint8Array}
 */
export function circleMask(width, height, cx, cy, radius) {
  const mask = new Uint8Array(width * height);
  const r2 = radius * radius;
  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/**
 * Posición y radio sugeridos para la placa: centro de masas y extensión de
 * los píxeles claros de una versión desenfocada (la placa iluminada sobre un
 * fondo más oscuro es el caso normal de una foto en un banco de laboratorio).
 * Es solo una PROPUESTA — el módulo la deja ajustar a mano.
 */
export function suggestRoi(grayInfo) {
  const { gray, width, height } = grayInfo;
  const blur = boxBlur(gray, width, height, Math.max(2, Math.round(Math.min(width, height) / 50)));
  const th = otsuFromHistogram(histogramInMask(blur, null));
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (blur[y * width + x] > th) { n++; sx += x; sy += y; }
    }
  }
  const fallback = { cx: width / 2, cy: height / 2, radius: 0.47 * Math.min(width, height) };
  if (n < 0.02 * width * height) return fallback;
  const cx = sx / n;
  const cy = sy / n;
  // radio equivalente del área clara, acotado para no comerse la imagen ni
  // quedarse en un reflejo pequeño
  const rEq = Math.sqrt(n / Math.PI);
  const radius = Math.min(0.5 * Math.min(width, height), Math.max(0.2 * Math.min(width, height), rEq * 0.95));
  return { cx, cy, radius };
}

/**
 * Componentes conexas de 8 vecinos sobre una máscara binaria.
 * Iterativo a propósito: una placa con cultivo casi confluente genera
 * componentes de cientos de miles de píxeles y la versión recursiva
 * desbordaría la pila.
 * @param {Uint8Array} bin 1 = objeto.
 * @returns {{blobs: Array<{area:number,cx:number,cy:number,perimeter:number,minX:number,minY:number,maxX:number,maxY:number,pixels:Int32Array}>}}
 */
export function labelComponents(bin, width, height) {
  const seen = new Uint8Array(bin.length);
  const blobs = [];
  const stack = new Int32Array(bin.length);
  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let perimeter = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    const pixels = [];
    while (top > 0) {
      const idx = stack[--top];
      const x = idx % width;
      const y = (idx - x) / width;
      area++;
      sx += x; sy += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      pixels.push(idx);
      // borde: vecino de 4 que no es objeto (o se sale de la imagen)
      let edge = false;
      if (x === 0 || !bin[idx - 1]) edge = true;
      if (x === width - 1 || !bin[idx + 1]) edge = true;
      if (y === 0 || !bin[idx - width]) edge = true;
      if (y === height - 1 || !bin[idx + width]) edge = true;
      if (edge) perimeter++;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue;
          const nIdx = ny * width + nx;
          if (bin[nIdx] && !seen[nIdx]) { seen[nIdx] = 1; stack[top++] = nIdx; }
        }
      }
    }
    blobs.push({
      area, cx: sx / area, cy: sy / area, perimeter,
      minX, minY, maxX, maxY, pixels: Int32Array.from(pixels),
    });
  }
  return { blobs };
}

/**
 * Circularidad 4πA/P². Un círculo perfecto da 1; un arañazo o el borde de la
 * placa, valores bajos. Con áreas pequeñas el perímetro en píxeles es un
 * estimador malo, así que el filtro solo debe aplicarse por encima de unas
 * decenas de píxeles.
 */
export function circularity(area, perimeter) {
  if (!(perimeter > 0)) return 0;
  return Math.min(1, (4 * Math.PI * area) / (perimeter * perimeter));
}

/**
 * Transformada de distancia euclídea EXACTA (Felzenszwalb & Huttenlocher
 * 2012): para cada píxel de objeto, la distancia al píxel de fondo más
 * cercano. Separable y O(n) — nada de aproximaciones chamfer, que sesgan las
 * diagonales y desplazarían los máximos locales, que es justo lo que aquí se
 * usa como centro de colonia.
 *
 * @param {Uint8Array} bin 1 = objeto.
 * @returns {Float32Array} Distancia en píxeles (0 en el fondo).
 */
export function distanceTransform(bin, width, height) {
  const INF = 1e20;
  const d = new Float64Array(bin.length);
  for (let i = 0; i < bin.length; i++) d[i] = bin[i] ? INF : 0;

  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const dOut = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  // Envolvente inferior de parábolas en 1D: el núcleo del algoritmo.
  const dt1d = (len) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (k > 0 && s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      dOut[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };

  // pasada por filas
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = d[row + x];
    dt1d(width);
    for (let x = 0; x < width; x++) d[row + x] = dOut[x];
  }
  // pasada por columnas
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = d[y * width + x];
    dt1d(height);
    for (let y = 0; y < height; y++) d[y * width + x] = dOut[y];
  }

  const out = new Float32Array(bin.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(d[i]);
  return out;
}

/**
 * Semillas de colonia: máximos locales de la transformada de distancia, con
 * supresión de no-máximos. El radio de supresión se escala con la propia
 * distancia del candidato, porque el máximo del centro de una colonia vale
 * aproximadamente su radio: así una colonia grande no genera varias semillas y
 * dos pequeñas en contacto siguen generando dos.
 *
 * @param {Float32Array} dist
 * @param {Int32Array|number[]} pixels Píxeles del objeto a dividir.
 * @param {number} width
 * @param {number} minSeedDist Distancia mínima para que un píxel sea semilla.
 * @returns {Array<{idx:number,x:number,y:number,d:number}>} De mayor a menor distancia.
 */
export function findSeeds(dist, pixels, width, minSeedDist) {
  const cand = [];
  for (let i = 0; i < pixels.length; i++) {
    const idx = pixels[i];
    const dv = dist[idx];
    if (dv < minSeedDist) continue;
    cand.push({ idx, x: idx % width, y: (idx - (idx % width)) / width, d: dv });
  }
  cand.sort((a, b) => b.d - a.d);

  const provisional = [];
  for (let i = 0; i < cand.length; i++) {
    const c = cand[i];
    // un candidato solo es máximo nuevo si no cae dentro del "dominio" de uno
    // ya aceptado; el dominio es del tamaño de esa colonia
    let ok = true;
    for (let j = 0; j < provisional.length; j++) {
      const s = provisional[j];
      const sep = Math.max(minSeedDist, s.d * 0.9);
      if ((c.x - s.x) ** 2 + (c.y - s.y) ** 2 < sep * sep) { ok = false; break; }
    }
    if (ok) provisional.push(c);
  }

  // Segunda pasada: quitar los máximos de CONFLUENCIA.
  //
  // En un racimo de colonias muy solapadas, el punto más grueso de la masa
  // común no está en ninguna colonia, sino entre todas: ahí cabe un círculo
  // inscrito mayor que en cada colonia por separado, así que la transformada
  // de distancia tiene allí su máximo absoluto. Tomarlo como semilla añade una
  // colonia que no existe — es la sobre-segmentación clásica del watershed
  // sobre la transformada de distancia.
  //
  // Un máximo que se apoya sobre dos o más máximos de altura comparable,
  // todos dentro de su propio radio, es un punto de confluencia y no un centro
  // de colonia. Una colonia grande de verdad no tiene otros máximos
  // comparables dentro de sí, así que no se ve afectada.
  const seeds = provisional.filter((s) => {
    let comparable = 0;
    for (let j = 0; j < provisional.length; j++) {
      const o = provisional[j];
      if (o === s) continue;
      if (o.d < s.d * 0.8) continue;
      if ((o.x - s.x) ** 2 + (o.y - s.y) ** 2 <= s.d * s.d) comparable++;
    }
    return comparable < 2;
  });
  return seeds.length ? seeds : provisional.slice(0, 1);
}

// Montículo binario de máximos por distancia: la cola de prioridad de la
// inundación. Se inunda de la cresta hacia abajo, que es lo que hace que la
// frontera entre dos colonias caiga en el estrechamiento entre ambas.
function makeMaxHeap() {
  const items = [];
  const up = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (items[p].d >= items[i].d) break;
      const tmp = items[p]; items[p] = items[i]; items[i] = tmp;
      i = p;
    }
  };
  const down = (i) => {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < items.length && items[l].d > items[m].d) m = l;
      if (r < items.length && items[r].d > items[m].d) m = r;
      if (m === i) break;
      const tmp = items[m]; items[m] = items[i]; items[i] = tmp;
      i = m;
    }
  };
  return {
    size: () => items.length,
    push(it) { items.push(it); up(items.length - 1); },
    pop() {
      const top = items[0];
      const last = items.pop();
      if (items.length) { items[0] = last; down(0); }
      return top;
    },
  };
}

/**
 * Watershed con marcadores sobre la transformada de distancia, restringido a
 * los píxeles de un objeto. Cada semilla crece hacia abajo por la distancia;
 * donde dos cuencas se encuentran queda la frontera.
 *
 * @returns {{count:number, parts:Array<{x:number,y:number,area:number}>}}
 */
export function watershedSplit(dist, pixels, width, height, seeds) {
  if (seeds.length <= 1) {
    return { count: seeds.length, parts: [] };
  }
  const inObject = new Set(pixels);
  const label = new Map(); // idx -> nº de semilla
  const heap = makeMaxHeap();
  seeds.forEach((s, k) => {
    label.set(s.idx, k);
    heap.push({ idx: s.idx, d: s.d, k });
  });

  while (heap.size() > 0) {
    const cur = heap.pop();
    const x = cur.idx % width;
    const y = (cur.idx - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue;
        const nIdx = ny * width + nx;
        if (!inObject.has(nIdx) || label.has(nIdx)) continue;
        label.set(nIdx, cur.k);
        heap.push({ idx: nIdx, d: dist[nIdx], k: cur.k });
      }
    }
  }

  const acc = seeds.map(() => ({ sx: 0, sy: 0, area: 0 }));
  label.forEach((k, idx) => {
    const x = idx % width;
    const y = (idx - x) / width;
    acc[k].sx += x; acc[k].sy += y; acc[k].area++;
  });
  const parts = acc
    .filter((a) => a.area > 0)
    .map((a) => ({ x: a.sx / a.area, y: a.sy / a.area, area: a.area }));
  return { count: parts.length, parts };
}

function median(arr) {
  if (!arr.length) return NaN;
  const s = Float64Array.from(arr).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Cuenta colonias en una foto de placa.
 *
 * @param {{data:Uint8ClampedArray|Array,width:number,height:number}} imageData
 * @param {Object} [opts]
 * @param {{cx:number,cy:number,radius:number}} [opts.roi] Zona de placa; por defecto, la sugerida.
 * @param {'auto'|'light'|'dark'} [opts.polarity='auto'] Colonias más claras o más oscuras que el agar.
 * @param {number} [opts.sensitivity=0] Desplaza el umbral de Otsu (±, en niveles de gris).
 * @param {number} [opts.minArea] Área mínima en px; por defecto relativa a la placa.
 * @param {number} [opts.maxArea] Área máxima de UNA colonia en px; por encima se considera agregado.
 * @param {number} [opts.minCircularity=0.55] Circularidad mínima (solo sobre objetos no diminutos).
 * @returns {{total:number,counted:number,estimated:number,items:Array,threshold:number,polarity:string,medianArea:number,roi:Object,confluent:boolean}}
 */
export function countColonies(imageData, opts = {}) {
  const grayInfo = toGrayscale(imageData);
  const { gray, width, height } = grayInfo;
  const roi = opts.roi || suggestRoi(grayInfo);
  const mask = circleMask(width, height, roi.cx, roi.cy, roi.radius);

  // 1. fondo: desenfoque con un radio del orden de un cuarto de la placa, muy
  //    por encima del tamaño de una colonia, para que el fondo estimado no se
  //    "coma" las propias colonias
  const bg = boxBlur(gray, width, height, Math.max(4, Math.round(roi.radius / 4)));
  const corrected = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) corrected[i] = gray[i] - bg[i] + 128;

  const roiArea = Math.PI * roi.radius * roi.radius;

  // 2. umbral de Otsu dentro de la placa, desplazable por el usuario
  const det = otsuDetail(histogramInMask(corrected, mask));
  const base = det.threshold;
  const threshold = base + (Number(opts.sensitivity) || 0);

  // Si las dos clases que separa Otsu tienen prácticamente la misma media, no
  // hay dos poblaciones: es una placa sin crecimiento (o una foto velada). Sin
  // este corte, Otsu parte el ruido por la mitad y el pipeline "encuentra"
  // objetos donde solo hay agar.
  const minContrast = Number.isFinite(opts.minContrast) ? opts.minContrast : 8;
  if (!(det.contrast >= minContrast)) {
    return {
      counted: 0, estimated: 0, total: 0, items: [],
      threshold, otsu: base, contrast: det.contrast,
      polarity: opts.polarity === 'dark' ? 'dark' : 'light',
      medianArea: 0, roi, confluent: false, lowContrast: true,
      largestFraction: 0,
    };
  }

  // 3. polaridad: en automático gana la que deja MENOS superficie marcada,
  //    porque las colonias son minoría frente al agar
  const build = (dark) => {
    const bin = new Uint8Array(gray.length);
    let fg = 0;
    for (let i = 0; i < gray.length; i++) {
      if (!mask[i]) continue;
      const hit = dark ? corrected[i] < threshold : corrected[i] > threshold;
      if (hit) { bin[i] = 1; fg++; }
    }
    return { bin, fg };
  };
  let polarity = opts.polarity === 'dark' || opts.polarity === 'light' ? opts.polarity : 'auto';
  let chosen;
  if (polarity === 'auto') {
    const light = build(false);
    const dark = build(true);
    polarity = dark.fg < light.fg ? 'dark' : 'light';
    chosen = dark.fg < light.fg ? dark : light;
  } else {
    chosen = build(polarity === 'dark');
  }

  // 4. componentes conexas y filtros
  const minArea = Number.isFinite(opts.minArea) ? opts.minArea : Math.max(6, roiArea * 2e-5);
  const minCirc = Number.isFinite(opts.minCircularity) ? opts.minCircularity : 0.55;
  // Un objeto que ocupa más de esta fracción de la placa ya no es una colonia
  const hugeArea = roiArea * 0.1;

  const { blobs } = labelComponents(chosen.bin, width, height);

  // Los objetos que tocan el borde de la ROI se descartan: ahí es donde caen
  // el reborde del plástico, su sombra y los recortes de colonias partidas
  // por el círculo, y ninguno de los tres es un recuento.
  const edgeR2 = Math.max(0, roi.radius - 2) ** 2;
  const touchesEdge = (b) => {
    for (let i = 0; i < b.pixels.length; i++) {
      const idx = b.pixels[i];
      const x = idx % width;
      const y = (idx - x) / width;
      if ((x - roi.cx) ** 2 + (y - roi.cy) ** 2 > edgeR2) return true;
    }
    return false;
  };

  // Alargamiento de la caja contenedora. Hace falta ADEMÁS de la
  // circularidad porque un agregado de colonias en contacto tampoco es
  // circular, y no se le puede exigir que lo sea; lo que distingue un arañazo
  // o una grieta del agar de un grupo de colonias es que es larguísimo y
  // estrecho, no que sea irregular.
  const maxAspect = Number.isFinite(opts.maxAspect) ? opts.maxAspect : 4;
  const aspectOf = (b) => {
    const w = b.maxX - b.minX + 1;
    const h = b.maxY - b.minY + 1;
    return Math.max(w, h) / Math.max(1, Math.min(w, h));
  };

  const candidates = blobs
    .filter((b) => b.area >= minArea && !touchesEdge(b))
    .map((b) => ({ ...b, circ: circularity(b.area, b.perimeter), aspect: aspectOf(b) }))
    .filter((b) => b.area < 30 || b.aspect <= maxAspect);

  const largest = candidates.reduce((mx, b) => Math.max(mx, b.area), 0);
  const largestFraction = roiArea > 0 ? largest / roiArea : 0;

  // La mediana se calcula sobre los objetos de tamaño plausible: así el
  // tamaño típico de colonia lo fija la propia placa, no una constante.
  const medianArea = median(candidates.filter((b) => b.area <= hugeArea).map((b) => b.area));
  const aggFactor = Number.isFinite(opts.aggregateFactor) ? opts.aggregateFactor : 2;
  const maxArea = Number.isFinite(opts.maxArea)
    ? opts.maxArea
    : (Number.isFinite(medianArea) && medianArea > 0 ? medianArea * aggFactor : roiArea * 0.01);

  // Puerta de división: a partir de qué tamaño MERECE LA PENA intentar dividir
  // un objeto. Deliberadamente baja (1,35 x la mediana) y distinta del umbral
  // de agregado: dos colonias que apenas se tocan suman menos del doble de una
  // sola (el solapamiento descuenta área), así que un umbral de 2x las dejaría
  // pasar como una. Quien decide si hay dos colonias es el watershed —- el
  // area solo decide a quien se le pregunta.
  const splitGate = Number.isFinite(opts.splitGate) ? opts.splitGate : 1.35;
  const gateArea = (Number.isFinite(medianArea) && medianArea > 0)
    ? medianArea * splitGate
    : maxArea;
  const medianRadius = (Number.isFinite(medianArea) && medianArea > 0)
    ? Math.sqrt(medianArea / Math.PI)
    : 0;
  const minSeedDist = Number.isFinite(opts.minSeedDist)
    ? opts.minSeedDist
    : Math.max(2, medianRadius * 0.55);

  // La transformada de distancia se calcula UNA vez para toda la mascara (el
  // fondo separa los objetos, asi que vale para todos), y solo si hay algun
  // objeto lo bastante grande como para preguntarse si son varios.
  const dist = candidates.some((b) => b.area > gateArea)
    ? distanceTransform(chosen.bin, width, height)
    : null;

  const single = [];
  const aggregates = [];
  candidates.forEach((b) => {
    if (dist && b.area > gateArea) {
      const seeds = findSeeds(dist, b.pixels, width, minSeedDist);
      const ws = watershedSplit(dist, b.pixels, width, height, seeds);
      if (ws.count >= 2) { aggregates.push({ ...b, ws }); return; }
    }
    if (b.area > maxArea) { aggregates.push({ ...b, ws: null }); return; }
    // la circularidad solo discrimina cuando hay perimetro suficiente
    if (b.area >= 30 && b.circ < minCirc) return;
    single.push(b);
  });

  // 5. agregados: colonias en contacto, estimadas por área
  const items = single.map((b) => ({
    x: b.cx, y: b.cy, area: b.area, circularity: b.circ, merged: false, count: 1,
  }));
  let estimated = 0;
  let watershedUsed = 0;
  aggregates.forEach((b) => {
    if (b.ws && b.ws.count >= 2) {
      watershedUsed++;
      estimated += b.ws.count;
      items.push({
        x: b.cx, y: b.cy, area: b.area, circularity: b.circ,
        merged: true, count: b.ws.count, parts: b.ws.parts, split: 'watershed',
      });
      return;
    }
    // Objeto por encima del umbral de agregado al que el watershed no le
    // encontro mas de una cresta: o es una colonia grande de verdad, o es una
    // masa tan fusionada que ya no tiene estrechamientos. Se cae al estimador
    // por area, dejando constancia (split: 'area') de que esa cifra es mas
    // debil que un recuento.
    const n = (Number.isFinite(medianArea) && medianArea > 0)
      ? Math.max(2, Math.round(b.area / medianArea))
      : 1;
    estimated += n;
    items.push({
      x: b.cx, y: b.cy, area: b.area, circularity: b.circ,
      merged: true, count: n, parts: [], split: 'area',
    });
  });

  return {
    counted: single.length,
    estimated,
    total: single.length + estimated,
    items,
    threshold,
    otsu: base,
    contrast: det.contrast,
    polarity,
    medianArea: Number.isFinite(medianArea) ? medianArea : 0,
    roi,
    largestFraction,
    lowContrast: false,
    aggregates: aggregates.length,
    watershedSplits: watershedUsed,
    // Un único objeto que ocupa más de la décima parte de la placa: eso es
    // crecimiento confluente (o un umbral mal puesto), y una placa confluente
    // no es contable por ningún método — se avisa en vez de dar una cifra.
    confluent: largestFraction > 0.1,
  };
}

/**
 * Aplica las correcciones manuales del usuario al recuento automático.
 * @param {Object} result Salida de countColonies.
 * @param {{removed?:number[],added?:Array<{x:number,y:number}>}} edits
 *   removed: índices de `result.items` descartados; added: marcas puestas a mano.
 * @returns {{total:number,counted:number,estimated:number,manual:number}}
 */
export function applyManualEdits(result, edits = {}) {
  const removed = new Set(edits.removed || []);
  let counted = 0;
  let estimated = 0;
  let estimatedWatershed = 0;
  let estimatedArea = 0;
  (result.items || []).forEach((it, i) => {
    if (removed.has(i)) return;
    if (!it.merged) { counted += 1; return; }
    estimated += it.count;
    // Separar las dos clases de agregado importa: las colonias que el
    // watershed ha separado por su forma son un recuento, y las que solo se
    // han estimado por área son una conjetura. No deben presentarse igual.
    if (it.split === 'watershed') estimatedWatershed += it.count;
    else estimatedArea += it.count;
  });
  const manual = (edits.added || []).length;
  return {
    counted, estimated, estimatedWatershed, estimatedArea, manual,
    total: counted + estimated + manual,
  };
}
