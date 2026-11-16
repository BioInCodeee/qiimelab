# Agar — revisión visual módulo a módulo

Estado (16 nov 2026): cimientos hechos, pasada por módulos hecha, cromado y
mascota hechos. Queda lo listado en «Lo que falta del sistema».

Esta línea se quedó desactualizada una vez diciendo «falta la pasada por
módulos» cuando más abajo, en el mismo archivo, ya estaba documentada como
hecha. Al cerrar algo, actualizar **las dos**.

Agar es la dirección visual que sustituye al cromado del v2 original. Cambia
superficies, tinta, tipografía y radios; **no cambia los colores de datos**.
Este documento es la lista de trabajo para aplicarla módulo a módulo.

## Qué ya está hecho

- `css/tokens.css`: superficies crema, tinta cálida, radios 8/12/16 y
  tipografía (IBM Plex Serif en titulares, Fira Sans en interfaz) en `:root`,
  en `[data-ds="v2"]` y en los dos bloques oscuros.
- `css/components.css`: `.ql-eyebrow` sube a `--ink-2` por contraste sobre el
  motivo del encabezado.
- `tests/design-v2.mjs`: los valores esperados de marca y tipografía pasan a
  ser los de Agar.

## La decisión que conviene no volver a tomar

El sistema Agar nació con un acento terracota (`#b4532a`). **No puede ser el
color de marca de esta app**: queda a ΔE OKLab 7,0 de `--critical` y 9,7 de
`--enriched`, así que un botón primario se leería como un valor crítico. Un
barrido de todo el rango cálido (hue 15-95, contra las dos paletas de datos)
deja solo castaños muy oscuros en claro y rosas casi neutros (croma 0,03) en
oscuro, porque los datos ya ocupan naranja, rojo, ámbar y amarillo.

Por eso la marca es el **teal** (`#12615f` claro / `#57c9be` oscuro), que está
libre de la paleta de datos y pasa el suelo de ΔE ≥ 15 en los dos temas. El
calor de Agar lo ponen las superficies crema y la serif de los titulares.

El terracota se queda donde no compite con ningún dato: la mascota y las
ilustraciones de placa. **Nunca dentro de una figura.**

## Cómo hacer la pasada (barata, desde Claude Code local)

Un módulo por sesión, o varios si son pequeños. Para cada
`js/modules/<nombre>.js`:

1. `grep -n "#[0-9a-fA-F]\{3,6\}" js/modules/<nombre>.js` — cualquier color
   literal que no venga de un token es deuda: pásalo a `var(--…)`. Si es un
   color de datos, debe salir de `--cat-*`, `--enriched`/`--depleted` o los
   estados, nunca de un hex suelto.
2. Radios y espaciado a tokens (`--radius-*`, `--space-*`). Sin píxeles sueltos.
3. Titulares del módulo con `--font-display` (serif), cifras con `--font-mono`,
   el resto con `--font-body`.
4. **Estado vacío**: todos los módulos deben tener uno, con su botón de datos de
   ejemplo (es regla del proyecto). Donde falte, añadirlo.
5. Texto secundario en `--ink-2`; `--ink-muted` solo para rótulos cortos y
   nunca encima de una superficie teñida o de una ilustración.
6. Nada de texto en `var(--good)` / `var(--warning)`: van `--good-ink` y
   `--warning-ink` (ya lo vigila `tests/design-v2.mjs`).
7. Cualquier texto nuevo, clave i18n en `es` (y `en` si puedes), nunca
   literal.
8. `node tests/run.mjs --rapido` antes de cada commit; la suite completa antes
   del push (lo fuerzan los hooks de `.githooks/`).

## Orden sugerido

Primero lo que más se ve y menos riesgo tiene:

1. Portada y glosario — casi todo texto, sin figuras.
2. `informe.js` — además comprueba el HTML autocontenido (lleva su propio
   `data-ds="v2"` en `<body>`).
3. Módulos de tabla: `qc.js`, `recuentos.js`, `metadatos.js`.
4. Módulos autónomos: `primers.js`, `labcalc.js`, `phylo.js` — no tocan
   `state.js`, así que el riesgo de romper la sesión exportable es nulo.
5. Módulos con figura: `alfa`, `beta`, `taxaBarplot`, `correlogram`,
   `differentialAbundance`, `temporal`, `inference`. Aquí la regla de oro:
   **el cromado cambia, la figura no**. Las figuras conservan IBM Plex y los
   colores de datos tal cual.
6. `sanger.js` el último: es el más grande y el que tiene el BLAST externo.

## Lo que falta del sistema, aparte de los módulos

- ~~**Mascota (Tardi)** y sus seis estados~~ → **hecha (16 nov 2026)**.
  `js/lib/tardi.js`: SVG plano dibujado a mano, sin `defs` ni `id` (así varias
  instancias no chocan), `role="img"` con `aria-label` que describe el estado y
  no al animal, y modo sobrio (`localStorage` + `data-sobrio` en `<html>` +
  una regla de CSS), con su ajuste junto a tema y densidad. Pintada en la
  portada (`home.js`). `tests/tardi.mjs` comprueba los seis estados, el
  `aria-label` **resuelto en los cinco idiomas** y el modo sobrio.
  Cuidado con el fallo que tuvo esto en su WIP: la mascota se pintaba bien y
  los tests de vista pasaban, pero no existía ninguna clave `tardi.*`, así que
  el `aria-label` era literalmente «tardi.idle». Un estado nuevo necesita sus
  cinco traducciones, y `tests/tardi.mjs` es la puerta.
- **Módulo de enfrentamientos** (captura, resultado, estado vacío): diseñado,
  sin construir. Es un módulo autónomo, como `labcalc.js`.
- **Tabla de réplicas** y **barra inferior de módulos**: especificadas en el
  sistema de diseño, sin implementar.

## Pasada módulo a módulo: hecha (16 nov 2026)

`tests/design-v2-modules.mjs` recorre las 21 rutas y sus pestañas (58 vistas)
en claro y en oscuro. Está en verde: 120/120. Lo que salió de la pasada:

- **Seis tokens que se usaban sin existir** (`--line`, `--brand`, `--warn-ink`,
  `--font-ui`, `--bad`, `--focus`): como no estaban definidos, siempre ganaba
  el fallback incrustado, así que esos trozos de `plateMap.js`,
  `antagonism.js`, `qpcr.js`, `designPlanner.js`, `betaDiversity.js` y
  `components.css` se quedaban congelados en claro y en el azul viejo. Ahora
  son alias en el bloque v2.
- **Colores incrustados en `<canvas>`**, que no sigue CSS: `antagonism.js`
  pintaba el punto de siembra con el azul v2 y los antagonistas con un ámbar
  a mano. Van por `token()`, un helper nuevo en `js/lib/dom.js`.
- **`.ql-cons-disc` usaba `--critical` como color de texto** (4,42:1). Es el
  mismo fallo que el repo ya había corregido para `--good` y `--warning`: va
  `--critical-ink`.
- `.ql-nav-soon` a 9,5px en oscuro se quedaba en 4,43:1 → `--ink-2`.
- `validacion.js`, `sequenceQC.js` y el `placeholder` de `plateMap.js`:
  literales sueltos pasados a tokens.

### Lo que se dejó a propósito

- **Los colores de detección de `plateImage.js`** (cian, ámbar, amarillo,
  verde, gris) marcan estados de colonia **sobre una fotografía**, donde no
  valen las premisas de contraste de la app ni la paleta de datos. Cambiarlos
  sin fotos reales de placa delante es arriesgado. Pendiente de revisar con
  imágenes de verdad.
- `OTHER_COLOR` (`#d3d3d3`) en `taxaBarplot.js`: es el gris fijo de «otros» en
  las pilas, decisión de dataviz anterior, distinta de `--cat-8`.
- Los hex dentro del script de R que exporta `differentialAbundance.js`: son
  para que la figura de R salga igual que la de la app.

### Comprobaciones de test que cambiaron, y por qué

Dos guardas codificaban la identidad anterior y marcaban como error justo lo
que Agar decide:

- `tests/lib/v2probe.mjs` buscaba «restos del teal». El teal es ahora el color
  de marca, así que esa comprobación se retiró. Lo que sigue delatando una
  vista con el cromado heredado es `plexUI`.
- `plexUI` marcaba cualquier IBM Plex en interfaz. Los titulares van en IBM
  Plex **Serif** a propósito, así que ahora solo marca IBM Plex **Sans** o
  **Mono**, que es lo que de verdad indica texto de interfaz sin migrar.
