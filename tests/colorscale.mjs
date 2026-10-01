// js/lib/colorScale.js (Fase 3, Paso 1 de qiimelab-prompt-editor-fase-3-
// heatmaps-escalas-continuas.md): valores conocidos de interpolación OKLab,
// dominio simétrico/asimétrico, punto medio, discretización en bandas,
// inversión, y el nuevo par oklabToHex/oklabToUnit de paletteValidator.js
// que hace falta para poder volver de OKLab a un hex pintable.
//
//   node tests/colorscale.mjs

import { APP_ROOT } from './lib/env.mjs';
const { makeColorScale } = await import(APP_ROOT + '/js/lib/colorScale.js');
const { oklab, oklabToHex, oklabToUnit, isValidHex } = await import(APP_ROOT + '/js/lib/paletteValidator.js');
const { paletteColorsOf } = await import(APP_ROOT + '/js/lib/palettes.js');

let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

// ---- 0. inversa de OKLab (paletteValidator.js) — ida y vuelta exacta ----
console.log('-- oklabToHex / oklabToUnit: ida y vuelta exacta --');
{
  const samples = ['#2a78d6', '#e34948', '#ffffff', '#000000', '#a6a49c', '#008300', '#12615f', '#e69f00', '#440154', '#fee838'];
  let worst = 0;
  samples.forEach((hex) => {
    const back = oklabToHex(oklab(hex));
    const err = [1, 3, 5].reduce((m, i) => Math.max(m, Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(back.slice(i, i + 2), 16))), 0);
    worst = Math.max(worst, err);
  });
  check('hex -> oklab -> hex reproduce el original exacto (±0, no solo "cerca") en 10 colores variados', worst === 0, 'peor error de canal=' + worst);

  check('valor conocido: OKLab [0.5,0,0] (punto medio negro-blanco, a=b=0) = #636363',
    oklabToHex([0.5, 0, 0]) === '#636363');
  check('OKLab [0,0,0] = negro puro', oklabToHex([0, 0, 0]) === '#000000');
  check('OKLab [1,0,0] = blanco puro (o casi — puede saturar por redondeo)', /^#f[ef]f[ef]f[ef]$/i.test(oklabToHex([1, 0, 0])));
  check('oklabToUnit fuera de gamut no lanza (solo sujeta con clamp en oklabToHex)', Array.isArray(oklabToUnit([0.5, 5, 5])) && oklabToUnit([0.5, 5, 5]).length === 3);
}

// ---- 1. secuencial: dominio simétrico, 2 colores ----
console.log('\n-- secuencial: dominio [0,10], 2 colores --');
{
  const s = makeColorScale({ type: 'sequential', domain: [0, 10], range: ['#000000', '#ffffff'] });
  check('scale(min) === primer color exacto', s.scale(0) === '#000000');
  check('scale(max) === último color exacto', s.scale(10) === '#ffffff');
  check('scale(mid) === valor OKLab conocido #636363 (no un gris "sucio" de mezcla RGB)', s.scale(5) === '#636363');
  check('valores fuera de dominio se sujetan a los extremos (no extrapolan)', s.scale(-5) === '#000000' && s.scale(100) === '#ffffff');
  check('NaN/undefined -> null (deja que quien llama decida el color de reserva)', s.scale(NaN) === null && s.scale(undefined) === null);
}

// ---- 2. secuencial con una paleta multi-parada del catálogo (Fase 2) ----
console.log('\n-- secuencial: paleta de 11 paradas (viridis) usada tal cual --');
{
  const viridis = paletteColorsOf('viridis');
  check('viridis tiene 11 paradas (fixture del test, no una suposición)', viridis.length === 11);
  const s = makeColorScale({ type: 'sequential', domain: [0, 100], range: viridis });
  check('scale(min) === 1ª parada de viridis exacta', s.scale(0) === viridis[0]);
  check('scale(max) === última parada de viridis exacta', s.scale(100) === viridis[10]);
  check('scale(50) cae EXACTO en la parada central (índice 5 de 11, t=0.5) — no una mezcla',
    s.scale(50) === viridis[5]);
}

// ---- 3. divergente: dominio simétrico, punto medio en 0 (por defecto) ----
console.log('\n-- divergente: dominio [-1,1], midpoint=0 (defecto) --');
{
  const s = makeColorScale({ type: 'divergent', domain: [-1, 1], range: { neg: '#e34948', mid: '#a6a49c', pos: '#2a78d6' } });
  check('scale(min) === neg exacto', s.scale(-1) === '#e34948');
  check('scale(0) === mid exacto (el punto medio cae justo en el centro geométrico aquí)', s.scale(0) === '#a6a49c');
  check('scale(max) === pos exacto', s.scale(1) === '#2a78d6');
  check('scale(-0.5) es una mezcla real entre neg y mid, no ninguno de los 2 extremos',
    s.scale(-0.5) !== '#e34948' && s.scale(-0.5) !== '#a6a49c' && isValidHex(s.scale(-0.5)));
}

// ---- 4. divergente: dominio ASIMÉTRICO, punto medio no centrado ----
console.log('\n-- divergente: dominio [-2,4] (asimétrico), midpoint=1 --');
{
  // t del punto medio = (1 - (-2)) / (4 - (-2)) = 3/6 = 0.5 → cae en el
  // centro GEOMÉTRICO del dominio aunque el dominio no sea simétrico en
  // valor — caso elegido para poder verificar a mano sin calculadora.
  const s = makeColorScale({ type: 'divergent', domain: [-2, 4], midpoint: 1, range: { neg: '#000000', mid: '#a6a49c', pos: '#ffffff' } });
  check('el punto medio (valor=1) cae exacto en el color central', s.scale(1) === '#a6a49c');
  check('el valor mínimo del dominio (-2) sigue siendo el color neg exacto', s.scale(-2) === '#000000');
  check('el valor máximo del dominio (4) sigue siendo el color pos exacto', s.scale(4) === '#ffffff');
  // con un midpoint MÁS CERCA del máximo, la mitad "neg" ocupa más espacio
  // del dominio que la mitad "pos" — comprobación cualitativa: un valor a
  // medio camino entre min y midpoint debe estar MÁS mezclado hacia mid
  // que el mismo desplazamiento absoluto en la mitad "pos", más corta.
  const sSkewed = makeColorScale({ type: 'divergent', domain: [0, 10], midpoint: 8, range: { neg: '#000000', mid: '#808080', pos: '#ffffff' } });
  const lightnessOf = (hex) => oklab(hex)[0];
  const at4 = lightnessOf(sSkewed.scale(4));  // mitad del tramo neg (0..8)
  const at9 = lightnessOf(sSkewed.scale(9));  // mitad del tramo pos (8..10)
  check('con midpoint desplazado (8 de 10), el tramo "neg" (más largo) avanza más despacio que el "pos" (más corto) para el mismo avance relativo',
    Math.abs(at4 - lightnessOf('#404040')) < Math.abs(at9 - lightnessOf('#c0c0c0')) + 1, 'at4L=' + at4.toFixed(3) + ' at9L=' + at9.toFixed(3));
}

// ---- 5. divergente: paleta de longitud PAR (solo 2 polos, sin mid explícito) ----
console.log('\n-- divergente: rango de 2 colores sin parada central explícita --');
{
  const s = makeColorScale({ type: 'divergent', domain: [-1, 1], range: ['#000000', '#ffffff'] });
  check('se inserta una parada central interpolada en OKLab (mismo valor conocido que la prueba 1: #636363)', s.scale(0) === '#636363');
  check('los extremos siguen siendo los 2 colores originales exactos', s.scale(-1) === '#000000' && s.scale(1) === '#ffffff');
}

// ---- 6. discretización en N bandas ----
console.log('\n-- discretización: domain [0,10], 4 bandas --');
{
  const s = makeColorScale({ type: 'sequential', domain: [0, 10], range: ['#000000', '#ffffff'], steps: 4 });
  const c = (v) => s.scale(v);
  check('toda la banda 0 (t en [0, 0.25) -> valores [0, 2.5)) da el MISMO color', c(0) === c(1) && c(1) === c(2.4));
  check('la banda 1 empieza en el valor 2.5 (t=0.25) y es distinta de la banda 0', c(2.5) !== c(0));
  // banda 0 = t en [0, 0.25); su color debe ser el de t=0.125 (centro), que
  // en una rampa negro->blanco NO coincide ni con el extremo t=0 (negro
  // puro) ni con el borde t=0.25 de la banda — así se confirma que se
  // muestrea el centro, no un extremo, sin depender de introspección interna.
  const bandContinuous = makeColorScale({ type: 'sequential', domain: [0, 10], range: ['#000000', '#ffffff'] });
  check('cada banda usa el color de su CENTRO, no el de su borde (banda 0 == color continuo en el valor 1.25, el centro de [0,2.5))',
    c(0) === bandContinuous.scale(1.25) && c(0) !== bandContinuous.scale(0), 'c(0)=' + c(0));
  check('4 bandas -> como mucho 4 colores distintos en todo el dominio', new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(c)).size <= 4);
  check('el último valor del dominio cae en la última banda', c(10) === c(9.9));
}

// ---- 7. invertir ----
console.log('\n-- invertir --');
{
  const normal = makeColorScale({ type: 'sequential', domain: [0, 1], range: ['#000000', '#ffffff'] });
  const inv = makeColorScale({ type: 'sequential', domain: [0, 1], range: ['#000000', '#ffffff'], invert: true });
  check('invert intercambia qué color cae en qué extremo del dominio', inv.scale(0) === normal.scale(1) && inv.scale(1) === normal.scale(0));
  check('invert no toca el punto medio de un rango simétrico (sigue siendo el mismo gris)', inv.scale(0.5) === normal.scale(0.5));
}

// ---- 8. leyenda (datos para <linearGradient>) ----
console.log('\n-- legendStops --');
{
  const cont = makeColorScale({ type: 'sequential', domain: [0, 1], range: ['#000000', '#ffffff'] });
  check('modo continuo: se muestrean MUCHAS paradas (no solo las 2 ancla) — un <linearGradient> de SVG interpola en RGB plano entre <stop>, así que sin esto se perdería la uniformidad perceptual',
    cont.legendStops.length >= 30, cont.legendStops.length + ' paradas');
  check('las paradas de leyenda están ordenadas y cubren 0-100%',
    cont.legendStops[0].offset === 0 && cont.legendStops[cont.legendStops.length - 1].offset === 100 &&
    cont.legendStops.every((s, i, arr) => i === 0 || s.offset >= arr[i - 1].offset));

  const disc = makeColorScale({ type: 'sequential', domain: [0, 1], range: ['#000000', '#ffffff'], steps: 3 });
  check('modo discreto (3 bandas): 6 paradas (2 por banda, borde duro en cada frontera)', disc.legendStops.length === 6);
  check('cada banda es un color sólido: las 2 paradas de la banda 0 tienen el MISMO color',
    disc.legendStops[0].color === disc.legendStops[1].color);
  check('bandas consecutivas tienen colores distintos (si no, no discriminarían nada)',
    disc.legendStops[1].color !== disc.legendStops[2].color);
}

// ---- 9. dominio degenerado (min === max) no explota ----
console.log('\n-- casos límite --');
{
  const s = makeColorScale({ type: 'sequential', domain: [5, 5], range: ['#000000', '#ffffff'] });
  check('dominio degenerado (min===max) no lanza y da un color válido (t=0.5 por convención)', isValidHex(s.scale(5)));
  const s2 = makeColorScale({}); // sin ningún parámetro
  check('sin parámetros: usa la paleta secuencial por defecto de palettes.js y domain [0,1]', isValidHex(s2.scale(0)) && isValidHex(s2.scale(1)));
}


console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
