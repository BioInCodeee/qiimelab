// chartState.js — lectura del estilo persistido de cada figura
// (localStorage smart-175.chartStyle.<key>, con fallback al prefijo antiguo
// qiimelab.*). Los módulos lo leen ANTES de pintar: paleta, opciones de
// estructura, geometría, estilo, estadística y escala de color.
//
// Parte del editor de figuras troceado desde js/lib/chartEditor.js (Fase 0b,
// sin cambios de comportamiento). Reparto y patrón `ctx`: js/lib/chart/chartEditor.js.

// prefijos de la clave localStorage de cada figura (<prefijo><key>); el
// antiguo solo se lee y se limpia, nunca se escribe
export const CHARTSTYLE_PREFIX = 'smart-175.chartStyle.';
export const LEGACY_CHARTSTYLE_PREFIX = 'qiimelab.chartStyle.';

function readChartStyleRaw(key) {
  try {
    const raw = localStorage.getItem(CHARTSTYLE_PREFIX + key) || localStorage.getItem(LEGACY_CHARTSTYLE_PREFIX + key);
    return JSON.parse(raw) || {};
  }
  catch (e) { return {}; }
}

/** Los overrides de paleta persistidos para `key` — { seriesId: '#hex' }.
 *  Función pura, sin DOM: para que los módulos con degradado continuo
 *  (mapas de calor, matriz de correlación) puedan leerla ANTES de calcular
 *  sus colores, sin esperar a que exista el <svg>. */
export function getPaletteOverrides(key) {
  return readChartStyleRaw(key).__palette || {};
}

/** Las opciones estructurales (Fase 4: eje G4, rejilla menor G5, leyenda
 *  G6, lienzo G3 — qiimelab-prompt-editor-fase-4-ejes-rejilla-leyenda-
 *  lienzo.md Paso 1) persistidas para `key` —
 *  `{ axisMin?, axisMax?, axisLog?, tickFormat?, categoryOrder?, gridMinor?,
 *  legendSwatchSize?, marginExtra?: {top,right,bottom,left} }`. Función
 *  pura, sin DOM: el módulo la lee al principio del pintado (mismo punto
 *  donde ya lee `groupData`/`series`) y ajusta la geometría ANTES de
 *  dibujar — mismo patrón que getPaletteOverrides/getColorScaleOptions.
 *  Ralo: valores ausentes = sin personalizar, el valor por defecto lo
 *  decide quien llama, no esta función. */
export function getFigureOptions(key) {
  return readChartStyleRaw(key).__structure || {};
}

/** Los valores de geometría persistidos para `key` — { sliderId: number }.
 *  Función pura, sin DOM: para que un módulo pueda leer (p. ej. el ancho de
 *  nodo o la opacidad de flujo elegidos por el usuario) ANTES de calcular su
 *  layout inicial, igual que `getPaletteOverrides` para el color. */
export function getFigureGeometry(key) {
  return readChartStyleRaw(key).__geometry || {};
}

/** Los valores del motor de variables CSS de rol (rejilla, eje, marcas,
 *  título de eje, fuente — ver Paso 2 de qiimelab-prompt-editor-fase-0-
 *  fundamentos.md) persistidos para `key` — { varId: valor }. Función pura,
 *  sin DOM: mismo patrón que getPaletteOverrides/getFigureGeometry, aunque
 *  hoy ningún módulo necesita leerla antes del primer pintado (los `--fig-*`
 *  se aplican vía `svg.style.setProperty`, no afectan al cálculo del layout). */
export function getFigureStyle(key) {
  return readChartStyleRaw(key).__figureStyle || {};
}

/** Las opciones de anotación estadística (modo asteriscos/p-exacto, estilo
 *  Prism, umbral de significación, método de ajuste de p) persistidas para
 *  `key` — ver Paso 3 de qiimelab-prompt-editor-fase-1-anotaciones-
 *  estadisticas.md. Función pura, sin DOM: el módulo la lee ANTES de
 *  calcular los pares significativos (mannWhitneyU/dunnTest dependen de
 *  qué método de ajuste y umbral haya elegido el usuario), igual que
 *  getFigureGeometry/getPaletteOverrides. Valores ausentes = sin
 *  personalizar; los valores por defecto los decide quien llama (aquí no,
 *  para no bifurcar la fuente de verdad de "cuál es el valor por defecto"). */
export function getStatsOptions(key) {
  return readChartStyleRaw(key).__stats || {};
}

/** Las opciones de escala de color continua (paleta, dominio, punto medio,
 *  pasos discretos, invertir) persistidas para `key` — Paso 3 de
 *  qiimelab-prompt-editor-fase-3-heatmaps-escalas-continuas.md. Función
 *  pura, sin DOM: los 3 consumidores (betaDiversity/correlogram/
 *  differentialAbundance heatmap) la leen ANTES de construir su
 *  `makeColorScale()` (js/lib/colorScale.js), mismo patrón que
 *  getStatsOptions/getPaletteOverrides. Ralo: solo trae las claves que el
 *  usuario tocó; los valores por defecto (paleta de la app, dominio real de
 *  los datos, punto medio 0) los decide cada módulo, no aquí. */
export function getColorScaleOptions(key) {
  return readChartStyleRaw(key).__colorScale || {};
}
