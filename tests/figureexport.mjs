// tests/figureexport.mjs — Paso 3 de qiimelab-prompt-editor-fase-0-fundamentos.md
// (pipeline de exportación de figuras, js/lib/figureExport.js).
//
// Parte 1 (siempre corre, sin Chrome): resolveComputedColor, pngWithDpi,
// encodeTiff y encodePdf son funciones puras — se verifican decodificando a mano los
// bytes producidos (CRC32/IFD propios, no reutilizando el código bajo
// prueba) igual que se haría con un visor real o Python-Pillow.
//
// Parte 2 (necesita Chrome; se salta si no hay): exporta de verdad una
// gráfica con degradado color-mix() (beta, heatmap UPGMA) estando la app en
// modo oscuro, y comprueba en el SVG resultante que no queda ningún
// `color(`/`var(` sin resolver y que el texto sale oscuro (no el blanco del
// tema oscuro activo) — los 2 bugs confirmados que motivan este módulo.
//
//   node tests/figureexport.mjs

import { resolveComputedColor, resolveComputedColorHex, pngWithDpi, encodeTiff, encodePdf, deflateZlib } from '../js/lib/figureExport.js';
import { inflateSync } from 'node:zlib';

let failed = false;
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + (detail ? '  ' + detail : ''));
  if (!ok) failed = true;
}

console.log('--- 1. resolveComputedColor (formas reales de getComputedStyle) ---');
{
  const cases = [
    ['rgb(30, 64, 175)', [30, 64, 175, 1]],
    ['rgba(30, 64, 175, 0.5)', [30, 64, 175, 0.5]],
    ['rgb(30 64 175 / 50%)', [30, 64, 175, 0.5]],
    // el bug confirmado: color-mix() resuelve en Chromium a color(srgb ...) con componentes 0..1
    ['color(srgb 0.164706 0.643137 0.372549)', [42, 164, 95, 1]],
    ['color(srgb 1 1 1 / 0.5)', [255, 255, 255, 0.5]],
    ['transparent', [0, 0, 0, 0]],
  ];
  cases.forEach(([input, expected]) => {
    const got = resolveComputedColor(input);
    const ok = got && expected.every((v, i) => Math.abs(v - got[i]) < 0.001);
    check(`"${input}" → [${expected.join(',')}]`, ok, got ? `(obtenido [${got.join(',')}])` : '(null)');
  });

  check('"none" → null (sin relleno/trazo, no se toca el atributo)', resolveComputedColor('none') === null);
  check('"var(--accent)" → null (sin resolver, no es autoría)', resolveComputedColor('var(--accent)') === null);
  check('"url(#grad1)" → null (gradiente referenciado, no un color plano)', resolveComputedColor('url(#grad1)') === null);
  check('"currentcolor" → null (forma no cubierta, deja el atributo intacto)', resolveComputedColor('currentcolor') === null);

  check('resolveComputedColorHex del bug de color-mix() → "#2aa45f"',
    resolveComputedColorHex('color(srgb 0.164706 0.643137 0.372549)') === '#2aa45f');
}

console.log('\n--- 2. pngWithDpi (chunk pHYs, verificado con CRC32 independiente) ---');
{
  // PNG sintético mínimo: firma + IHDR (13 bytes de datos, forma válida) + 4
  // bytes de "resto del archivo" arbitrarios, para comprobar que se preservan.
  function buildFakePng(trailer) {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    const ihdrData = new Uint8Array(13); // width/height/bitdepth/colortype/... da igual el contenido exacto
    ihdrData.set([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    const ihdrLen = new Uint8Array(4); new DataView(ihdrLen.buffer).setUint32(0, 13);
    const ihdrType = [0x49, 0x48, 0x44, 0x52]; // 'IHDR'
    const ihdrCrc = new Uint8Array(4); // no se valida en pngWithDpi, cero vale
    return new Uint8Array([...sig, ...ihdrLen, ...ihdrType, ...ihdrData, ...ihdrCrc, ...trailer]);
  }
  // CRC32 estándar (tabla generada independiente de la de figureExport.js),
  // para no validar la implementación contra sí misma.
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  function crc32Ref(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const trailer = [1, 2, 3, 4];
  const png = buildFakePng(trailer);
  const out = pngWithDpi(png, 300);

  check('la salida crece exactamente los 21 bytes del chunk pHYs', out.length === png.length + 21);

  const ihdrEnd = 8 + 4 + 4 + 13 + 4; // 33
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const chunkLen = dv.getUint32(ihdrEnd);
  const chunkType = String.fromCharCode(...out.subarray(ihdrEnd + 4, ihdrEnd + 8));
  check('el chunk insertado justo tras IHDR es "pHYs" de 9 bytes', chunkType === 'pHYs' && chunkLen === 9);

  const ppmX = dv.getUint32(ihdrEnd + 8);
  const ppmY = dv.getUint32(ihdrEnd + 12);
  const unit = out[ihdrEnd + 16];
  const expectedPpm = Math.round(300 / 0.0254); // 300 dpi → 11811 píxeles/metro
  check(`XResolution/YResolution = ${expectedPpm} px/m (300 dpi) y unidad = metros`,
    ppmX === expectedPpm && ppmY === expectedPpm && unit === 1,
    `(obtenido X=${ppmX} Y=${ppmY} unit=${unit})`);

  const storedCrc = dv.getUint32(ihdrEnd + 17);
  const crcInput = out.subarray(ihdrEnd + 4, ihdrEnd + 17); // tipo + datos, sin el propio crc
  check('el CRC32 del chunk pHYs es correcto (verificado con tabla CRC32 independiente)',
    storedCrc === crc32Ref(crcInput));

  const preservedTrailer = out.subarray(ihdrEnd + 21);
  check('el resto del PNG original se conserva intacto tras el chunk nuevo',
    preservedTrailer.length === trailer.length && trailer.every((b, i) => preservedTrailer[i] === b));

  check('lanza si el archivo no empieza con la firma PNG', (() => {
    try { pngWithDpi(new Uint8Array([1, 2, 3]), 300); return false; } catch (e) { return true; }
  })());
}

console.log('\n--- 3. encodeTiff (IFD decodificado a mano, RGB y RGBA) ---');
{
  // decodificador de IFD mínimo e independiente del propio encodeTiff, para
  // no validar la implementación contra sí misma.
  function readIfd(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (buf[0] !== 0x49 || buf[1] !== 0x49) throw new Error('no es little-endian II');
    if (dv.getUint16(2, true) !== 42) throw new Error('falta el número mágico 42');
    const ifdOff = dv.getUint32(4, true);
    const count = dv.getUint16(ifdOff, true);
    const tags = {};
    for (let i = 0; i < count; i++) {
      const p = ifdOff + 2 + i * 12;
      const tag = dv.getUint16(p, true);
      const type = dv.getUint16(p + 2, true);
      const cnt = dv.getUint32(p + 4, true);
      const valOff = p + 8;
      let value;
      if (type === 3 && cnt === 1) value = dv.getUint16(valOff, true);
      else if (type === 4 && cnt === 1) value = dv.getUint32(valOff, true);
      else if (type === 5) value = dv.getUint32(valOff, true); // offset a un RATIONAL
      else value = dv.getUint32(valOff, true);
      tags[tag] = value;
    }
    return { count, tags, dv };
  }

  const img2x1 = { width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]) }; // rojo opaco, verde semitransp.

  // --- RGB (sin alfa) ---
  const rgb = encodeTiff(img2x1, 300, { alpha: false });
  const ifdRgb = readIfd(rgb);
  check('RGB: 12 entradas en el IFD (sin ExtraSamples)', ifdRgb.count === 12);
  check('RGB: ImageWidth=2, ImageLength=1', ifdRgb.tags[256] === 2 && ifdRgb.tags[257] === 1);
  check('RGB: SamplesPerPixel=3, Compression=1 (ninguna), Photometric=2 (RGB)',
    ifdRgb.tags[277] === 3 && ifdRgb.tags[259] === 1 && ifdRgb.tags[262] === 2);
  check('RGB: XResolution/YResolution = 300 (numerador de la racional, denominador implícito 1)',
    ifdRgb.dv.getUint32(ifdRgb.tags[282], true) === 300 && ifdRgb.dv.getUint32(ifdRgb.tags[283], true) === 300);
  const pixOffRgb = ifdRgb.tags[273];
  const pixRgb = rgb.subarray(pixOffRgb, pixOffRgb + 6);
  check('RGB: los 2 píxeles quedan en 3 bytes/píxel, sin el canal alfa',
    Array.from(pixRgb).join(',') === '255,0,0,0,255,0');

  // --- RGBA (con alfa) ---
  const rgba = encodeTiff(img2x1, 300, { alpha: true });
  const ifdRgba = readIfd(rgba);
  check('RGBA: 13 entradas en el IFD (incluye ExtraSamples)', ifdRgba.count === 13);
  check('RGBA: SamplesPerPixel=4 y tag 338 (ExtraSamples) = 2 (alfa no asociado)',
    ifdRgba.tags[277] === 4 && ifdRgba.tags[338] === 2);
  const pixOffRgba = ifdRgba.tags[273];
  const pixRgba = rgba.subarray(pixOffRgba, pixOffRgba + 8);
  check('RGBA: los 2 píxeles conservan el canal alfa tal cual (sin premultiplicar)',
    Array.from(pixRgba).join(',') === '255,0,0,255,0,255,0,128');
}

console.log('\n--- 3b. encodePdf (xref/offsets y la imagen, decodificados a mano) ---');
{
  // 3×2 px RGB conocidos → deflate → PDF; se relee con zlib de Node (no con
  // el código bajo prueba) y se comprueban las tablas del PDF byte a byte
  const w = 3, h = 2;
  const rgb = Uint8Array.from({ length: w * h * 3 }, (_, i) => (i * 37) % 256);
  const z = await deflateZlib(rgb);
  check('deflateZlib produce zlib que Node descomprime a los mismos bytes', Buffer.compare(inflateSync(Buffer.from(z)), Buffer.from(rgb)) === 0);
  const wPt = 89 / 25.4 * 72, hPt = wPt * h / w;
  const pdf = encodePdf(z, w, h, wPt, hPt);
  const txt = Buffer.from(pdf).toString('latin1');
  check('empieza por %PDF-1.4 y termina en %%EOF', txt.startsWith('%PDF-1.4\n') && txt.trimEnd().endsWith('%%EOF'));
  const xref = +(txt.match(/startxref\n(\d+)/) || [])[1];
  check('startxref apunta exactamente a la tabla xref', txt.slice(xref, xref + 5) === 'xref\n', String(xref));
  const offs = [...txt.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((m) => +m[1]);
  check('las 5 entradas de xref apuntan al inicio de su objeto', offs.length === 5 && offs.every((o, i) => txt.startsWith((i + 1) + ' 0 obj', o)), JSON.stringify(offs));
  const mb = txt.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  check('la página mide el tamaño físico pedido (89 mm = 252.28 pt)', mb && Math.abs(+mb[1] - 252.283) < 0.01 && Math.abs(+mb[2] - hPt) < 0.01, mb && mb[0]);
  const im = txt.indexOf('/Subtype /Image');
  const lenM = txt.slice(im).match(/\/Width (\d+) \/Height (\d+).*?\/Length (\d+) >>\nstream\n/);
  const start = im + txt.slice(im).indexOf('stream\n') + 7;
  const stream = Buffer.from(pdf.subarray(start, start + (lenM ? +lenM[3] : 0)));
  check('el XObject de imagen declara 3×2 y su stream descomprime a los píxeles originales',
    lenM && +lenM[1] === w && +lenM[2] === h && Buffer.compare(inflateSync(stream), Buffer.from(rgb)) === 0);
}

console.log('\n--- 4. Exportación real en Chrome (color-mix() en modo oscuro) ---');
{
  const { ensureServer } = await import('./lib/server.mjs');
  const { connect } = await import('./lib/cdp.mjs');
  const { findChrome, skip } = await import('./lib/env.mjs');
  const { sleep, LOAD_ALL } = await import('./lib/app.mjs');

  if (!findChrome()) skip('no se encontró Chrome/Chromium');
  const server = await ensureServer();
  if (!server) skip('no se pudo servir la app (¿python3?)');

  const c = await connect({ url: server.url + '/index.html', label: 'figureexport-e2e' });
  await c.goto();
  await sleep(1000);
  await c.ev(LOAD_ALL);
  await c.ev(`location.hash = '#/beta'`);
  await sleep(1500);
  // forzar modo oscuro DE VERDAD (no solo emulación de medios): es la vía
  // real por la que un usuario exporta desde el tema oscuro.
  await c.ev(`document.documentElement.setAttribute('data-theme', 'dark')`);
  await sleep(300);

  // Todo el análisis se hace DENTRO del navegador y solo se devuelve un
  // resumen pequeño: el SVG/PNG/TIFF reales pesan varios MB, y transmitirlos
  // enteros de vuelta a Node vía Runtime.evaluate(returnByValue) es lentísimo
  // (CDP tarda minuto y medio en serializar/transmitir esa cantidad de JSON) —
  // no es una limitación real de figureExport.js, solo del canal de depuración.
  const result = await c.ev(`(async () => {
    const svg = document.querySelector('svg.ql-svg');
    if (!svg) return { err: 'no se encontró ningún <svg> en #/beta' };
    const { exportFigure } = await import('/js/lib/figureExport.js');
    const res = await exportFigure(svg, { widthMm: 89, dpi: 300, scheme: 'light', background: 'white', formats: ['svg', 'png', 'tiff', 'pdf'] });

    const noColorFn = !/color\\(/.test(res.svg);
    const noVar = !/var\\(--/.test(res.svg);
    const hasWhiteBg = res.svg.includes('fill="#ffffff"') && res.svg.includes('ce-export-bg');

    // en modo oscuro el texto de la app es casi blanco; exportado con
    // scheme:'light' debe salir oscuro y legible sobre el fondo blanco.
    const fillMatch = res.svg.match(/class="ql-axis-label"[^>]*fill="(#[0-9a-f]{6})"/i)
      || res.svg.match(/fill="(#[0-9a-f]{6})"[^>]*class="ql-axis-label"/i);
    let axisTitleHex = null, axisTitleLum = null;
    if (fillMatch) {
      axisTitleHex = fillMatch[1];
      axisTitleLum = parseInt(axisTitleHex.slice(1, 3), 16) * 0.299 + parseInt(axisTitleHex.slice(3, 5), 16) * 0.587 + parseInt(axisTitleHex.slice(5, 7), 16) * 0.114;
    }

    const pngHead = Array.from(res.png.subarray(0, 50));
    const tiffHead = Array.from(res.tiff.subarray(0, 4));
    const pdfTxt = new TextDecoder('latin1').decode(res.pdf.subarray(0, 600));
    const pdfMediaBox = (pdfTxt.match(/\\/MediaBox \\[0 0 ([\\d.]+) /) || [])[1];
    const pdfImg = new TextDecoder('latin1').decode(res.pdf).match(/\\/Width (\\d+) \\/Height (\\d+)/);

    return { noColorFn, noVar, hasWhiteBg, axisTitleHex, axisTitleLum, pngHead, tiffHead, pdfHead: pdfTxt.slice(0, 8), pdfMediaBox, pdfW: pdfImg && +pdfImg[1], widthPx: res.widthPx };
  })()`);

  if (result.err) {
    check('encuentra un <svg> exportable en #/beta', false, result.err);
  } else {
    check('el SVG exportado no contiene ningún "color(" sin resolver', result.noColorFn);
    check('el SVG exportado no contiene ninguna var() sin resolver', result.noVar);
    check('el SVG exportado sigue teniendo el fondo blanco sólido de export', result.hasWhiteBg);

    if (result.axisTitleHex) {
      check(`el título de eje exporta oscuro y legible sobre fondo blanco (${result.axisTitleHex}, luminancia ${result.axisTitleLum.toFixed(0)}/255)`,
        result.axisTitleLum < 128);
    } else {
      check('encuentra el título de eje (.ql-axis-label) en el SVG exportado para comprobar su color', false);
    }

    const pngBytes = Uint8Array.from(result.pngHead);
    const dvPng = new DataView(pngBytes.buffer);
    const ihdrEnd = 33;
    check('el PNG exportado tiene el chunk pHYs en la posición esperada',
      String.fromCharCode(...pngBytes.subarray(ihdrEnd + 4, ihdrEnd + 8)) === 'pHYs');
    const ppm = dvPng.getUint32(ihdrEnd + 8);
    check(`el PNG exportado a 300 dpi trae el dpi real embebido (${Math.round(ppm * 0.0254)} dpi)`,
      Math.round(ppm * 0.0254) === 300);

    check('el TIFF exportado empieza con la cabecera little-endian válida (II, 42)',
      result.tiffHead[0] === 0x49 && result.tiffHead[1] === 0x49 &&
      new DataView(Uint8Array.from(result.tiffHead).buffer).getUint16(2, true) === 42);

    check('el PDF exportado es un %PDF-1.4 de 89 mm de ancho con la imagen a 300 dpi',
      result.pdfHead === '%PDF-1.4' && Math.abs(+result.pdfMediaBox - 252.283) < 0.01 && result.pdfW === result.widthPx,
      JSON.stringify({ head: result.pdfHead, mb: result.pdfMediaBox, w: result.pdfW, px: result.widthPx }));
  }

  c.kill();
}

console.log('\n--- Resumen ---');
if (failed) {
  console.error('❌ Fallaron algunos tests.');
  process.exit(1);
} else {
  console.log('✅ Todos los tests pasaron exitosamente.');
  process.exit(0);
}
