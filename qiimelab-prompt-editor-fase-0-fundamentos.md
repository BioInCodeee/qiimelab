# Prompt Fase 0: fundamentos compartidos del editor nivel BioRender

> Preparado en una sesión de cowork (claude.ai), 21-22 sep 2026, a partir de
> una auditoría de código real (con números de línea) y de dos prototipos
> construidos y probados en un sandbox aparte (no en este repo): un motor de
> variables CSS de rol y un pipeline de exportación. Documentos de referencia
> completos: `Claude outputs/estudio-editor-graficas-nivel-biorender.md`
> (arquitectura, investigación de BioRender/Prism/ggplot2, especificaciones de
> revista, bugs confirmados) y `Claude outputs/inventario-editor-graficas.md`
> (estado real de cada una de las ~28 vistas de gráfico de la app, con
> línea:archivo). **Leer los dos enteros antes de tocar código** — este
> prompt resume lo esencial pero no repite el detalle completo.

## Por qué esta fase va primero

Las fases 1-6 (anotaciones estadísticas, paletas extendidas, heatmaps,
ejes/rejilla/leyenda, específicos por tipo, presets/export final) dependen
todas de tres piezas de infraestructura que hoy no existen. Construirlas una
vez aquí evita reimplementar lo mismo 6-8 veces en fases posteriores:

1. Un **motor de variables CSS de rol** (`--fig-*`) para lo que no necesita
   repintar (color/grosor de rejilla, ticks, títulos de eje).
2. Un **pipeline de exportación limpio** (arregla 2 bugs reales confirmados
   y añade tamaño físico en mm + PNG con dpi + TIFF).
3. Un **módulo de estadística por pares** (`pairwiseStats.js`) + formateador
   de p-valor con los 4 estilos de GraphPad Prism — sin esto, la Fase 1
   (asteriscos ⇄ p-valor, corchetes por pares) no tiene datos que mostrar.

Además, esta fase decide una cuestión de arquitectura pendiente
(`openChartEditor` vs `attachChartEditor`, ver más abajo) que si se deja sin
resolver duplica trabajo en cada fase siguiente.

## Antes de tocar código: verificar el estado real

Como con cualquier prompt heredado de otra sesión: los números de línea de
abajo son de la auditoría del 21-22 sep 2026, puede haber cambiado algo desde
entonces (sobre todo si `qiimelab-prompt-resolver-conflictos-md2.md` ya se
ejecutó; los prompts de modo oscuro y de fenotipos ya se enviaron y sus
documentos se retiraron del repo el 14 nov 2026).
Confirmar con grep antes de asumir que una línea sigue en el mismo sitio.

## Paso 1 — decidir el destino de `openChartEditor`

`js/lib/chartEditor.js` tiene hoy dos vías de edición no unificadas:
`attachChartEditor` (línea 183, la que usan 25+ vistas) y `openChartEditor`
(línea 1253, modal aparte con pestañas geometría/tipografía y sliders, usado
solo por el aluvial de `taxaBarplot.js` línea 1024). Antes de construir nada
nuevo, decidir explícitamente uno de estos dos caminos y documentarlo en un
comentario al principio de `chartEditor.js`:

- **Opción A (recomendada)**: migrar el aluvial de `taxaBarplot.js` a
  `attachChartEditor` con una nueva sección "geometría" en el panel (sliders
  reutilizando el patrón de `row()`/inputs ya existente), y marcar
  `openChartEditor` como legacy/a retirar en un commit posterior.
- **Opción B**: mantener `openChartEditor` como vía B intencional para
  gráficos con muchos parámetros geométricos continuos, y portarle en
  paralelo cada capa nueva (más trabajo sostenido en cada fase siguiente).

Si se elige A, este es un commit pequeño y aislado — hacerlo antes de la
Fase 5 (que toca el aluvial para el degradado origen→destino de los flujos).

## Paso 2 — motor de variables CSS de rol

En `css/components.css`, líneas ~931-940, las clases de rol pasan a tener
variable con fallback al valor de tema actual (no cambia nada visualmente
hasta que el editor escriba la variable):

```css
svg.ql-svg .ql-gridline { stroke: var(--fig-grid-color, var(--gridline)); stroke-width: var(--fig-grid-width, 1); stroke-dasharray: var(--fig-grid-dash, none); }
svg.ql-svg .ql-baseline-line { stroke: var(--fig-axis-color, var(--baseline)); stroke-width: var(--fig-axis-width, 1.25); }
svg.ql-svg .ql-tick-label { fill: var(--fig-tick-color, var(--ink-2)); font-size: var(--fig-tick-size, 11px); font-family: var(--fig-font, var(--font-mono)); }
svg.ql-svg .ql-axis-label { fill: var(--fig-axis-title-color, var(--ink)); font-size: var(--fig-axis-title-size, 12px); font-family: var(--fig-font, var(--font-mono)); }
```

En `chartEditor.js`, una nueva sección del panel (junto a `renderPaletteSection`,
línea 416) que escribe estas variables con `svg.style.setProperty('--fig-...', v)`
y las persiste en `store.__figureStyle` (mismo objeto `store` que ya existe,
misma clave `localStorage['smart-175.chartStyle.' + key]` — no una tabla nueva).
Verificado en el sandbox de la sesión anterior: este mecanismo cambia el
100% de los nodos con clase de rol en `barplots`/`alfa`/`beta`/`diferencial`
sin repintar nada. **No** cubre `correlograma` (31 `<text>` de estrellas/r sin
clase) ni `inferencia` (31 `<text>` + 7 `<line>` sin clase) — ver Paso 4.

## Paso 3 — pipeline de exportación

Copiar `Claude outputs/assets/figureExport.prototype.js` (prototipo ya
construido y probado con Playwright+Pillow en 10 combinaciones ruta×tema×fondo:
0 residuos de `color(`/`var(`/`color-mix`, 0 texto claro sobre fondo forzado,
dpi de PNG y TIFF exactos, tamaño en mm correcto — ver el estudio, sección
4.5, para las cifras completas) a `js/lib/figureExport.js`, adaptado a las
convenciones del repo (nombres de función en el estilo del resto de
`js/lib/`, comentarios en español). Integrar en `chartEditor.js`:

- `serializeSvg(svgEl)` (línea 1032) pasa a usar `serializeForExport(svg,
  {scheme:'light', background:'white'})` del nuevo módulo en vez de su
  lógica actual de `inlineComputedStyles` — esto arregla los 2 bugs
  confirmados (texto ilegible en modo oscuro, `color(srgb…)`/`var()` sin
  resolver) para las ~28 vistas de golpe.
- `exportSvg`/`exportPng` (líneas 1102/1143) ganan un diálogo simple de
  opciones antes de descargar: ancho en mm (por defecto el tamaño actual en
  px reinterpretado, con un selector para 89/183 mm Nature u 85/174 mm Cell
  como atajos — ver tabla de especificaciones en el estudio, sección 1.5),
  formato (SVG/PNG/TIFF — TIFF es nuevo), dpi para PNG/TIFF (150/300/600),
  fondo (blanco/transparente).
- Nueva opción de descarga TIFF en la barra de herramientas (`renderToolbar`,
  línea 277), junto a los botones de SVG/PNG ya existentes.

**Antes de dar esta fase por cerrada**: abrir al menos un SVG exportado en
Illustrator o Inkscape reales (el sandbox de la sesión anterior no tenía
ninguno de los dos instalados — es la única verificación que falta).

## Paso 4 — dar clase de rol a lo que hoy no la tiene

Auditoría confirmada (ver inventario, secciones de cada gráfica):

- `js/modules/correlogram.js`: las estrellas de significación y valores `r`
  dentro de celda (`stars(p)` línea 103, dibujo de celda ~línea 404-421) son
  `<text>` sueltos — darles `class="ql-cell-value"` o similar (nueva clase,
  no forzar `ql-tick-label` que es semánticamente para ejes).
- `js/modules/inference.js`: 31 `<text>` y 7 `<line>` sin rol en la vista de
  barras (línea ~1093 en adelante) — auditar primero qué son exactamente
  (probablemente etiquetas de barra + líneas de estructura de layout) antes
  de asignar clase, no hacerlo a ciegas.
- `js/modules/differentialAbundance.js` heatmap: 9 `<text>` de valor de
  celda sin rol (línea ~810-820) — mismo tratamiento que correlograma.
- `js/modules/microbialCounts.js`: las 3 `<line>` de barra de error
  (línea 770-772) y el `<text>` de letra compacta (línea 780) sin rol —
  nuevas clases `ql-errorbar-line`/`ql-letter-label`.

Esto es trabajo mecánico pero no automatizable a ciegas (hay que confirmar
que la clase nueva no colisiona con estilos ya puestos a mano en cada sitio).

## Paso 5 — módulo de estadística por pares

Nuevo `js/lib/pairwiseStats.js`, siguiendo el estilo de `js/lib/stats.js`
(funciones puras, JSDoc, sin dependencias). Usar
`Claude outputs/assets/pairwise_fixtures.json` como fixtures de test
(generadas con scipy/numpy en la sesión anterior y ancladas a valores
documentados de R — **no generadas con R real**, revalidar contra
`Rscript` si está disponible en esta máquina antes de confiar en ellas al
100%). Funciones a implementar:

- `mannWhitneyU(x, y)`: regla de `wilcox.test` de R — exacto si
  `n1+n2 < 50` y sin empates, si no aproximación normal con corrección de
  continuidad y varianza corregida por empates. Fixture: `pairwise[].mannWhitney`.
- `welchT(x, y)` / `studentT(x, y)`: ya hay precedente de t-test en
  `js/lib/stats.js` (`fisherLSD` usa varianza combinada) — puede que valga
  la pena extraer un t-test genérico compartido. Fixtures: `pairwise[].welch`/`.student`.
- `wilcoxonSignedRank(x, y)` (pareado). Fixtures: `paired`.
- `dunnTest(groups)` (post-hoc de Kruskal-Wallis, con corrección por
  empates de Dunn 1964). Fixtures: `kruskalDunn`.
- `pAdjust(pvals, method)` con `'holm'|'bonferroni'|'hochberg'|'BH'|'BY'`
  (hoy solo existe `benjaminiHochberg` en `stats.js` — decidir si esta
  función nueva la sustituye o la envuelve, sin duplicar lógica). Fixtures: `pAdjust`.
- Opcional: `tukeyHSD` si se quiere paridad completa con ANOVA (fixtures
  ya incluyen un caso `tukey`, pero requiere la función `ptukey` — más
  trabajo, valorar si compensa frente a Dunn+BH que cubre el caso no
  paramétrico ya usado en toda la app).

Y en `js/lib/stats.js` (o un nuevo `js/lib/pFormat.js`), un formateador con
los 4 estilos de Prism — especificación exacta en
`pairwise_fixtures.json.pFormatSpec` (umbrales, decimales, cero inicial por
estilo GP/APA/NEJM/custom) — y modos de salida `'stars'|'exact'|'stars+exact'`.
Decidir y documentar explícitamente si el umbral de asteriscos usa `≤` (como
GraphPad) o `<` (como ggsignif/ggpubr por defecto) — no dejarlo implícito.

## Alcance de este prompt

Dado el tamaño, dividir en commits pequeños (regla fija de `CLAUDE.md`):

1. Decisión Paso 1 (documentada, con o sin migración del aluvial).
2. CSS + wiring del motor de variables (Paso 2) — sin aplicarlo aún a
   ninguna vista concreta más allá de una prueba manual en una gráfica.
3. `figureExport.js` integrado en `chartEditor.js` (Paso 3) — este commit
   por sí solo ya es visible para el usuario (arregla el bug de exportación
   en modo oscuro en las ~28 vistas).
4. Clases de rol nuevas (Paso 4) — un commit por módulo tocado.
5. `pairwiseStats.js` + formateador de p + tests (Paso 5) — el más grande,
   puede partirse en "tests con fixtures" (commit) + "implementación hasta
   que pasen" (commit).

`node tests/run.mjs` en verde después de cada commit. `git push` al terminar
la sesión, sin excepción (regla fija de `CLAUDE.md`).

## Criterio de aceptación

- Exportar cualquier gráfica en modo oscuro produce un SVG/PNG con texto
  oscuro legible sobre fondo claro (verificar visualmente al menos 3 vistas:
  una de barras, un heatmap, un boxplot).
- El SVG exportado de un heatmap (beta o correlograma) no contiene
  `color(srgb` ni `var(--` en ningún atributo.
- Descargar PNG a 300 dpi y comprobar con cualquier visor/`file`/Python-Pillow
  que el dpi embebido es 300 (no solo el tamaño en píxeles).
- Nueva opción de descarga TIFF funcional en al menos una vista.
- `mannWhitneyU`/`welchT`/`dunnTest`/`pAdjust` pasan contra
  `pairwise_fixtures.json` con tolerancia razonable (1e-4 relativo, salvo
  el caso exacto de Mann-Whitney que debe ser exacto).
- Decisión sobre `openChartEditor` documentada en un comentario en
  `chartEditor.js`, no solo en la cabeza de quien lo implementó.
- `node tests/run.mjs` en verde.
