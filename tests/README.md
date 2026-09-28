# tests/

Verificación de Smart-175. Todo es Node ESM sin dependencias de `npm`
(`node ≥ 20`). Los tests de navegador usan Chrome/Chromium headless vía CDP;
los de estadística comparan contra R cuando está disponible (`stats/primertm.mjs`
compara contra Biopython en vez de R, mismo patrón GOLDEN + recálculo en vivo).

```
node tests/run.mjs              # todo, con resumen final
node tests/run.mjs stats        # solo tests/stats/*
node tests/run.mjs contrast cvd # solo esos
node tests/<archivo>.mjs        # un test suelto
```

Cada test sale con **0** (pasa), **1** (falla) o **2** (se salta: falta
Chrome, R, un paquete de R, o Biopython). El runner sale ≠ 0 solo si algo
**falla**; los saltados no cuentan.

## Gate de tests: un test en rojo bloquea el commit y el push

Los hooks viven versionados en `.githooks/` y se activan **una vez por
clon** (también en cada `git worktree`, que comparte la configuración):

```
git config core.hooksPath .githooks
```

- **pre-commit** → `node tests/run.mjs --rapido` (estáticos + R, sin
  navegador; ~20 s) sobre exactamente lo que está en el índice, no sobre el
  árbol de trabajo.
- **pre-push** → la suite **completa** (~15 min, con Chrome) sobre
  exactamente los commits que se empujan (`git archive` a un temporal).

Si algo falla, el commit/push se cancela y se listan los tests en rojo, con
la ruta al log completo. Por defecto **bloquea**. Para saltárselo a
conciencia (p. ej. un commit que solo toca documentación):

```
git commit --no-verify …              # o: SMART175_SKIP_TESTS=1 git commit …
git push --no-verify                  # o: SMART175_SKIP_TESTS=1 git push
```

Los tests que se **saltan** (falta Chrome, R o Biopython) no bloquean: igual
que en el runner, solo cuenta como fallo un test que falla.

## Qué cubre cada archivo

| archivo | tipo | qué comprueba |
|---|---|---|
| `server-smoke.mjs` | navegador | Humo de infraestructura, corre ANTES de cualquier suite de navegador: el Chrome controlado por CDP navega a `/index.html`, `/js/app.js` y hace un `import()` dinámico. Si no llega, sale con `SERVER_REACHABILITY_FROM_CHROME: Chrome cannot reach http://127.0.0.1:PORT — …` y `run.mjs` marca el resto de suites de navegador como *no ejecutadas por infraestructura* en vez de dejar que fallen en cascada con `chrome-error://chromewebdata/…`. `run.mjs` además arranca un único servidor propio en un puerto libre para toda la ejecución (`QL_TEST_PORT` heredado por cada test), así que nunca reutiliza un servidor ajeno en :8931. |
| `sweep-routes.mjs` | navegador | Las 19 rutas/subvistas (18 módulos + la subvista "Red" del correlograma) en **claro y oscuro**, con todos los ejemplos cargados. Incluye `#/glosario` con su filtro de texto y sus `<details>`. Falla ante cualquier `console.error` / excepción. |
| `sweep-session.mjs` | navegador | Ciclo `exportSession()` → `clearAllState()` → `importSession()` → re-barrido. Canarios numéricos (nº taxa, KW H/p, % var PCoA, profundidad mín. de rarefacción, nº comparaciones…) **idénticos bit a bit** y **0** referencias `sourceFileId` colgadas. |
| `sweep-a11y.mjs` | navegador | Heurísticas por ruta × tema: nombre accesible en cada `button`/`a`, etiqueta en cada `input`/`select`, `aria-label` en cada `svg[role=img]`, una `<main tabindex=-1>`, enlace “saltar al contenido”, `<nav aria-label>`, `aria-current` en la navegación activa. |
| `keyboard-editor.mjs` | navegador | El editor de gráficos con **solo teclado**: foco en el tirador, flechas mueven (Shift = paso mayor), Intro abre el panel (el foco entra), Escape cierra y devuelve el foco, la posición persiste en `localStorage`. |
| `session-ui.mjs` | navegador | Los botones de guardar/cargar sesión en `#/cargar` + el modal de confirmación de carga: `role=dialog`, `aria-modal`, `aria-labelledby` real, foco en el botón de aceptar, Escape cierra resolviendo `false`. |
| `compare-overlap.mjs` | navegador | Vista “Comparar varias”: recalcula el solapamiento de significativos (`padj < 0.05`) desde los 3 CSV de `datos-ejemplo/` y comprueba que las regiones del diagrama de Venn y el histograma “sig. en N de M” de la UI coinciden. |
| `glosario-links.mjs` | estático | Integridad de los enlaces al glosario: cada término de `glosario.js` tiene título y definición no vacía en ES y EN; todo `#/glosario?t=<id>` y cada `glos:` de las tarjetas de `home.js` (más los ids que `taxaBarplot.js`/`betaDiversity.js` construyen con una variable, declarados en el test) apunta a un id real; y ninguna cadena promete "ver ¿qué significa esto?" en texto plano en lugar de enlazar. |
| `i18n-parity.mjs` | estático | Paridad de claves entre `js/i18n/es.js` y `en`/`it`/`de`/`zh`: lista las claves que faltan (se verían en español), las que sobran y las que no conservan los mismos `{marcadores}`. **Informativo**: sale con 0 aunque haya huecos; `--strict` sale con 1, `--all` lista todas las claves. |
| `datahealth.mjs` | estático | Fixtures de `checkDataHealth()`: id duplicado, muestra de más/menos, celda de grupo vacía, los 4 a la vez, tolerancia de sufijos → encuentra **exactamente** cada fallo. |
| `primerdimers.mjs` | estático | `scanDimer()`/`scanHairpin()` (`js/lib/primerDimers.js`): un primer con un palíndromo GC fuerte (auto-dímero) frente a otro sin ninguna base complementaria a sí misma (poli-A); una horquilla diseñada a mano (dos brazos GC con un bucle) frente al mismo poli-A; una pareja con cola 3' complementaria frente a una pareja sin relación; y que `buildDimerMatrix()` no recalcule cada pareja dos veces. |
| `primertemplate.mjs` | estático | `parseFasta()`/`findPrimerSites()`/`findAmplicons()` (`js/lib/primerTemplate.js`): plantilla construida a mano con un primer insertado literal (hebra `+`) y otro como su complementario inverso (hebra `-`) → posición exacta y amplicón correcto; un mismatch introducido a propósito en el extremo 3' desaparece con tolerancia 0 y aparece marcado como crítico con tolerancia 1. |
| `primercoverage.mjs` | estático | `computeCoverage()`/`groupCoverageByTaxon()`/`buildTaxonomyMap()` (`js/lib/primerCoverage.js`): 4 referencias (2 con el primer, 2 sin él) agrupadas en 2 grupos taxonómicos (uno 100% cubierto, el otro 0%); cobertura de una pareja (amplicón) cuando solo una referencia tiene los dos sitios; alias de columnas id/taxonomía habituales. |
| `palettes.mjs` | estático | `paletteValidator.js` (distancia OKLab, simulación de dicromacia Machado 2009, contraste WCAG) marca un par rojo/verde de igual luminosidad como confuso en protanopía/deuteranopía (y NO marca rojo/verde "puros", que sí se distinguen por brillo); las 3 paletas por defecto (`js/lib/palettes.js`) pasan con el mismo criterio que ya usan `cvd.mjs`/`contrast.mjs` para `--cat-*`; más el catálogo ampliado de 40 paletas (`js/lib/paletteCatalog.js`, Fase 2 Paso 1): estructura/overflowMode/maxSafeN, `palettesForType`/`resolvePaletteColors`/`evenlySampleColors` (el "2 polos siempre caen en el primer/último tono, no en los 2 primeros" de una rampa de 11). |
| `palettestyle.mjs` | estático | `js/lib/paletteStyle.js` (Fase 2, Pasos 2-5): migración de `store.__palette[id]` de string a objeto ralo, `defaultGradient`/`defaultPattern`/`darken`, geometría de `gradientLineFromAngle` (longitud de línea siempre 1, cualquier ángulo) y `patternTileSpec` (diagonal/dots/grid), `defId`/`defIdPrefix` (namespaced por módulo — dos gráficos con una serie "s0" cada uno no chocan de id cuando `informe.js` clona varios `<svg>` en una página). |
| `paletteseries.mjs` | navegador | Editor de gráficos, Fase 2 completa, en Chrome real (necesita `<svg>`/`getComputedStyle`/`<defs>` reales): desplegable de paletas agrupado + aviso de `maxSafeN`; opacidad persistente sin pisar el color; degradado y patrón crean/actualizan/podan su `<defs>` y sobreviven a `serializeForExport` (referencia `fill="url(#…)"` LOCAL, no absoluta) y a una rasterización PNG real; borde independiente en las 3 gráficas piloto del prompt (barras sin stroke propio, cajas con stroke propio, regiones de Venn). |
| `primerdesign.mjs` | estático | `designPrimers()` (`js/lib/primerDesign.js`): sobre una plantilla con 515F/806R real embebido cerca (producto ~129 pb) y un primer sintético embebido lejos (~749 pb), el modo qPCR solo da parejas de 121-140 pb y el modo estándar da parejas de 612-799 pb (que qPCR rechazaría por tamaño); una secuencia duplicada en la plantilla se excluye de los candidatos (especificidad); cambiar el tope de tamaño a mano lo respeta; `confirmSpecificity()` (reutiliza `findPrimerSites` de `primerTemplate.js`) confirma 1 sola aparición de cada primer de la mejor pareja. |
| `phyloalign.mjs` | estático | `needlemanWunsch()`/`buildProgressiveAlignment()` (`js/lib/phyloAlign.js`): secuencias idénticas sin huecos, una inserción conocida produce exactamente 1 hueco neto, máxima divergencia en secuencias de igual longitud no desplaza el marco; el alineamiento progresivo de 4 secuencias (guía UPGMA real) da una MSA de anchura única cuya versión sin huecos reconstruye cada secuencia original byte a byte, y la p-distance de la pareja casi idéntica sale muy por debajo de la de la pareja divergente. |
| `venngeometry.mjs` | estático | `buildRectVennLayout()` (`js/lib/setDiagram.js`, Venn de rectángulos para 2-4 conjuntos): las 2ⁿ-1 combinaciones no vacías aparecen todas exactamente una vez, la máscara 0 nunca se etiqueta, y — comprobación geométrica real, no solo de conteo — cada etiqueta de región cae dentro de los rectángulos de los conjuntos que marca su máscara y fuera de los demás. |
| `privacy.mjs` | estático | 2 pasadas de literales prohibidos (listas `LEAK_A` + `LEAK_B` en base64, las mismas que `VW_Final/scripts/verify_recursos_qiimelab.mjs`) sobre todo el árbol de código y datos de ejemplo, o sobre un rango git (`node tests/privacy.mjs 08b51af..HEAD`). |
| `contrast.mjs` | estático | Contraste WCAG AA de los pares texto/fondo y componente/fondo, en claro y oscuro. Colores resueltos desde `css/tokens.css` (sigue al archivo). Falla si algún par de texto/UI incumple AA **sin** justificación documentada. |
| `cvd.mjs` | estático | Simulación de proto/deutero/tritanopía (Machado 2009) sobre la paleta de datos. **Gate**: el par divergente `--corr-pos` × `--corr-neg` (único canal solo-color) ≥ ΔE 8 en las 3 dicromacias. La paleta categórica se informa (adyacentes < 8 por protan./deuter. bloquean; solo por tritanopía se aceptan). |
| `forcelayout.mjs` | estático | Invariantes de `forceLayout()`: (a) sin NaN/Infinity, (b) componentes conexas separadas (ratio > 1.5), (c) misma semilla → coordenadas **bit-idénticas**. |
| `figurefonts.mjs` | navegador | Liberation Sans/Serif (SIL OFL, autoalojadas en `fonts/`, compatibles en métricas con Arial/Times New Roman) en el selector de tipografía del editor: etiquetas "compatible con …", se aplican en pantalla cargadas desde el propio sitio, y la exportación SVG/PNG/TIFF/PDF las lleva incrustadas (`@font-face` con `data:`). Prueba de que el raster usa la fuente **incrustada** y no la del sistema: con la familia renombrada a una inexistente sale idéntico píxel a píxel; sin el `@font-face`, distinto. |
| `rscript-export.mjs` | navegador + R (`vegan`, `ape`) | "Descargar script R" de punta a punta con el ejemplo real: en alfa (Shannon del archivo, Chao1 y Simpson calculados; Games-Howell, Dunn y Tukey), PERMANOVA (999 y 9999 permutaciones), RDA, CCA, correlograma (Pearson y Spearman) y árbol NJ (p y JC69) pulsa el botón, ejecuta el `.R` descargado **tal cual** con `Rscript` (debe correr sin error) y compara sus resultados con lo que muestra la página: valores por muestra, Kruskal-Wallis, test elegido y p por pareja; Df/SS/R²/F exactos y p dentro del error de Monte Carlo; % por eje, coordenadas y correlaciones (con el signo de cada eje alineado); r/p/n de cada pareja; topología (Robinson-Foulds = 0) y distancias por el árbol. `SAVE_DIR=/ruta` guarda los scripts. |
| `rscript-builders.mjs` | R (`vegan`) | El camino "dataset grande" de los scripts de R: por encima de 500 filas la tabla va a un `.tsv` aparte (matriz de 520 muestras, conteos de 600 taxones); R lee esos archivos y da el mismo pseudo-F/R² y los mismos Chao1 que la app; nombres con comillas, espacios y ñ intactos (también con R en locale C). |
| `stats/diversity.mjs` | R (`vegan`) | `shannonIndex`, `simpsonIndex`, `observedRichness`, `pielouEvenness`, `chao1` vs `vegan::diversity` / `estimateR`, en 6 muestras reales + 2 vectores sintéticos con singletons. |
| `stats/rarefaction.mjs` | R (`vegan`) | `rarefactionCurve()` (Hurlbert 1971) vs `vegan::rarefy()` en 3 muestras reales, en las profundidades que devuelve la curva. |
| `stats/richness.mjs` | R (`vegan`) | `incidenceRichnessEstimators()` vs `vegan::specpool()` (Chao2, jack1/2, bootstrap **y sus SE**) en 3 grupos de muestras reales. |
| `stats/kruskalwallis.mjs` | R base | `kruskalWallis()` → `{H, df, p}` vs `kruskal.test()` (H con corrección por empates + p chi²). |
| `stats/correlation.mjs` | R base | `pearson()` / `spearman()` → `{r, p, n}` vs `cor.test()` (Spearman = Pearson sobre rangos). |
| `stats/incompletebeta.mjs` | R base | `incompleteBeta()` vs `pbeta()` y `studentTwoTailedP()` vs `2·pt(-|t|, df)`. |
| `stats/chisquare.mjs` | R base | `chiSquarePValue()` vs `pchisq(x, df, lower.tail = FALSE)`. |
| `stats/benjaminihochberg.mjs` | R base | `benjaminiHochberg()` vs `p.adjust(p, method = "BH")`. |
| `stats/cliffsdelta.mjs` | R (`effsize`) | `cliffsDelta()` vs `effsize::cliff.delta()$estimate`. |
| `stats/countsummary.mjs` | R base | `summariseCountSeries()` (recuento microbiano): media/SD/SE en log10 por grupo vs. `mean()` / `sd()` / `sd()/sqrt(n)`; además comprueba la exclusión de celdas `#NUM!` / 0 y la vía "el valor ya viene en log10". |
| `stats/permanova.mjs` | R (`vegan`) | `permanova()` (PERMANOVA de un factor): Df, sumas de cuadrados, pseudo-F y R² **exactos** vs `vegan::adonis2`; el p-valor (estocástico) se comprueba por rango + determinismo. |
| `stats/fisherlsd.mjs` | R (`agricolae`) | `oneWayAnova()`/`fisherLSD()`/`compactLetterDisplay()`: F/p del ANOVA vs `aov()`, p-valor por pareja vs `agricolae::LSD.test(p.adj="none")` en un caso con tamaños de grupo MUY desiguales (patrón de significación no monótono con la media); las letras de grupo homogéneo coinciden carácter a carácter con `LSD.test()$groups`, más un caso a mano (grafo camino) donde un grupo debe llevar dos letras. |
| `stats/lefselda.mjs` | R base | `fisherDiscriminantCoefficient()`/`lefseLdaScore()` (LDA univariante de LEfSe, variante propia): el coeficiente vs su relación EXACTA y conocida con `t.test(var.equal=TRUE)` (ningún paquete de R calcula directamente este coeficiente — `MASS::lda()$scaling` normaliza a varianza unitaria y no sirve, se comprobó y se descartó); determinismo del bootstrap con semilla fija, orden de magnitud razonable entre la mediana bootstrapeada y el coeficiente con todos los datos, y que un taxón claramente más enriquecido da un score mayor que uno apenas distinto. |
| `stats/neighborjoining.mjs` | R (`ape`) | `neighborJoining()` (`js/lib/neighborJoining.js`) sobre el ejemplo de 5 taxones publicado en la entrada de Wikipedia "Neighbor joining": las distancias patrísticas reconstruyen la matriz original **exacto** (el árbol es perfectamente aditivo) vs `ape::nj()` + `cophenetic()`; además las 7 longitudes de rama con nombre del artículo (a=2, b=3, u→v=3, c=4, v→w=2, d=2, e=1) y los casos n=2/n=3. |
| `stats/phylodistance.mjs` | R (`ape`) | `pDistance()`/`jukesCantorCorrection()` (`js/lib/phyloDistance.js`) vs `ape::dist.dna(model="raw"/"JC69", pairwise.deletion=TRUE)`: proporción de sitios distintos con huecos excluidos por pares, saturación (NaN) de JC69 a p≥0,75, y `buildDistanceMatrix()` capando el par saturado. |
| `stats/primertm.mjs` | Biopython | `tmNN()`/`meltingTemp()` (`js/lib/primerAnalysis.js`, Tm de vecino más próximo SantaLucia 1998) vs `Bio.SeqUtils.MeltingTemp.Tm_NN` (`nn_table=DNA_NN3`, `saltcorr=5`) — 10 casos (secuencias concretas, sal/concentración de primer variadas) + el primer degenerado 515F (4 resoluciones IUPAC → min/max/media). |
| `stats/rda.mjs` | R (`vegan`) | `rda()` (`js/lib/constrainedOrdination.js`, ordenación restringida lineal) sobre `varespec`/`varechem` (N,P,K,Ca,pH) de vegan: los 5 autovalores y la inercia total **exactos** vs `vegan::rda()$CCA$eig`/`$tot.chi` (recálculo en vivo ~1e-15 de error relativo); las coordenadas de sitios/especies/biplot usan una convención de escalado propia (no la de vegan), verificada con el invariante ‖lc_k‖²/(n-1) == autovalor_k. |
| `stats/cca.mjs` | R (`vegan`) | Igual que `rda.mjs` pero para `cca()` (ordenación restringida por correspondencias, chi-cuadrado) — mismo dataset e invariante (aquí sin dividir por n-1), más casos de error (valores negativos, tabla vacía). |
| `stats/randomforest.mjs` | R (`randomForest`) | `randomForest()` (`js/lib/randomForest.js`, bagging de árboles CART + importancia Mean Decrease Gini) vs `randomForest::randomForest(importance=TRUE)` sobre un dataset sintético de 45 muestras/3 grupos/12 variables (3 informativas + 9 de ruido puro): al ser un método estocástico (bootstrap + submuestreo de variables) NO se compara valor a valor, sino que se verifica que el RANKING coincide — correlación de Spearman, mismo top-3 exacto, y separación limpia (sin solape) entre informativas y ruido en ambos bosques; además el criterio de significancia "Boruta-lite" (variables sombra barajadas) y casos de error. |
| `mobile-audit.mjs` | navegador | Recorre las 19 rutas a 375px y 768px con todos los ejemplos cargados. **Falla** si alguna ruta ensancha el layout más allá del viewport (ratio > 1.04 → scroll-x del body). Los casos "apretado" (ratio 1.0–1.04) se informan pero no fallan. En la misma pasada audita el **menú lateral como cajón** (≤ 860px, `js/lib/navDrawer.js`): contenido visible sin scroll al cargar, botón «Menú» con nombre accesible + `aria-expanded` + `aria-controls`, panel superpuesto que no empuja el contenido, foco que entra y queda atrapado (Tab/Shift+Tab con teclas reales por CDP), controles del panel (idioma, tema, nombre) alcanzables, y cierre con Escape / tocando fuera / al navegar. Además comprueba que por encima del breakpoint (861px y 1280px) el sidebar sigue siendo el de siempre (sticky, 240px, sin botón) y que un panel abierto se cierra al agrandar la ventana. |
| `pwa.mjs` | estático + navegador | `manifest.json` es JSON válido con los campos obligatorios y sus iconos existen; `index.html` enlaza el manifest. Con navegador: el service worker registra, activa y controla la página tras la 1ª carga; con la red simulada offline por CDP una 2ª navegación sigue sirviendo el shell (sidebar + main + footer) desde caché sin errores; y el evento `offline`/`online` muestra/oculta el banner "sin conexión" de `js/lib/pwa.js`. |
| `perf-stress.mjs` | navegador | Genera un dataset de estrés (260 muestras × 2800 taxones, semilla fija, **no** en `datos-ejemplo/`) y cronometra las 4 operaciones pesadas midiendo el "jank" (hueco máximo entre frames de `requestAnimationFrame`). **Falla** si la ruta migrada a Web Worker (`js/lib/heavyStats.js`: UPGMA de matrices grandes + curvas de rarefacción) vuelve a bloquear el hilo principal (> 120 ms). El resto solo se informa. |
| `globalfont.mjs` | navegador | Tipografía global del editor (Fase 1): la casilla "Usar tipografía global" cambia de golpe todos los `<text>` de la figura en alfa/barplots/beta, incluido un título con fuente propia; desactiva "Fuente de ejes y marcas" mientras está activa; se exporta en el SVG, se guarda en `store.__figureStyle.globalFont`, persiste al recargar y al desactivarla cada texto vuelve a su fuente. |
| `zipbomb.mjs` | estático | Límites anti zip-bomb de `minizip.js` con ZIP reales fabricados (`tests/lib/zip.mjs`): ratio >100× (bomba de 64 MB de ceros), entrada >250 MB, presupuesto total, >2000 entradas, cabecera que miente (se corta el flujo), `.gz` suelto; los rechazos previos ocurren sin crear ningún `DecompressionStream`, e `ingestFile()` lo convierte en un aviso legible sin perder el resto del artefacto. |
| `methodequivalence.mjs` | estático + navegador | Convención de equivalencia científica (`js/lib/methodEquivalence.js`): el registro clasifica Nivel A/B/C según la tabla acordada; el aviso Nivel C aparece en biomarcadores (KW/LEfSe, ANCOM-BC, Random Forest, consenso) y en el alineamiento del árbol, y la nota Nivel B en PERMANOVA, RDA/CCA y Neighbor-Joining. |
| `informe-completo.mjs` | navegador | Informe completo (`#/informe`, `js/lib/reportLog.js`): sin análisis abiertos → estado vacío; tras ejecutar alfa, beta (PERMANOVA) y correlograma y pulsar «Generar informe completo» en la barra lateral, el informe trae exactamente esos 3 módulos, Métodos = `methodsText()` tal cual, figuras `<img>` que cargan y no están en blanco, los mismos avisos A/B/C que el módulo; en impresión emulada no se ve la interfaz, un salto de página por sección, negro sobre blanco con tema oscuro, PDF A4 real; se regenera en inglés; aviso de NCBI solo si se lanzó un BLAST. `REPORT_PDF_OUT=… ` guarda el PDF. |
| `design-v2.mjs` | estático + navegador | Sistema de diseño v2 (piloto en la portada, `[data-ds="v2"]` en `css/tokens.css`, origen en `design-system/smart-175/MASTER.md`): contraste ≥ 4,5:1 de todo el texto v2 en claro y oscuro (incluido `--good-ink` sobre su insignia), v2 no redefine colores de datos, los dos bloques oscuros coinciden; en Chrome la portada lleva Fira Sans + azul `#1E40AF` (`#60A5FA` en oscuro) servida desde `fonts/`, sin peticiones externas, y al salir a `#/alfa` o `#/beta` se retira el atributo y vuelve IBM Plex + teal. |
| `alpha-boxstats.mjs` | navegador | #/alfa: modo "Cajas sin puntos" (mismas cajas, 0 puntos, nota propia) y el selector "Test a usar" nombrando el test aplicado ("Automático → …" + "Test aplicado: … Por qué: …"; al forzar otro, "(elegido a mano)" y lo que habría elegido el automático). |
| `venn-sets.mjs` | navegador | #/venn con muchos conjuntos: ejemplo sintético de 10 grupos, control "Conjuntos a mostrar" y, para K = 10/6/4/3, cada región de la tabla comparada con un cálculo independiente; 5+ → UpSet (neutro por encima de 7), 4 → rectángulos, 3 → círculos. |
| `correlogram-pie-split.mjs` | navegador | #/correlograma: glifo "Sectores" (cada sector comparado con su r de la tabla: ángulo y sentido) y matriz "Partida" (▲ Pearson / ▼ Spearman, comprobado con el tooltip de una celda y su simétrica frente a las dos columnas r); Burbujas y Red siguen dibujando. |
| `biomarker-volcano.mjs` | navegador | #/barplots → Taxa candidatos → Volcano: con los datos de ejemplo reales, los puntos de color son exactamente los taxones de la tabla de significativos (KW y ANCOM-BC, mismo umbral q), un punto por taxón testado, umbrales q y \|δ\| dibujados, aviso Nivel C del método, Random Forest deshabilitado, tooltip con el taxón. |
| `correlogram-circular.mjs` | navegador | #/correlograma → Mapa de calor → Disposición «Circular»: cada sector anular tiene el mismo color que su celda rectangular, tooltip = r de la tabla, un anillo numerado por variable, matriz partida conservada (dentro de la diagonal = método elegido, fuera = el otro), vuelta a Rectangular intacta, Burbujas sin opción circular, y export SVG/PNG/TIFF/PDF con firmas de archivo válidas. |
| `phylo-sunburst.mjs` | navegador | #/arbol vista Sunburst: 16 sectores hoja, un sector por clado interno, ángulos de las hojas = 360° y cada clado abarca exactamente las hojas que declara; nota propia; Rectangular/Circular siguen dibujando. |
| `storage-migration.mjs` | estático + navegador | Migración de localStorage `qiimelab.*` → `smart-175.*` (`js/lib/storageMigration.js`): con un Storage simulado (copia, no pisa una nueva existente, borra la antigua, idempotente, no borra si falla la escritura) y en la app real con claves antiguas escritas a mano (tema, idioma, perfil, estilo de figura, árbol y una clave desconocida): tras recargar están bajo la nueva con el mismo valor, la antigua no existe, la app las aplica y no hay errores de consola. |
| `theme-default.mjs` | navegador | Tema por defecto (`js/lib/theme.js` `DEFAULT_THEME` + script en línea de `index.html`): con el arranque virgen (`connect({ theme: null })`) y el SO en claro o en oscuro, sin nada guardado la app sale en oscuro sin escribir nada; `'light'`/`'dark'` guardados (y el heredado `qiimelab.theme`) se respetan; «Automático» se guarda como `'auto'` y, tras recargar, sigue al sistema. El resto de tests fija un tema explícito antes de cada documento (`tests/lib/cdp.mjs`, opción `theme`), así que siguen probando el tema que dicen probar. |
| `security-headers.mjs` | estático + navegador | CSP y `referrer` vía `<meta>` en index.html: el hash de script-src coincide con el script de tema en línea actual, sin `unsafe-*` en scripts, único origen externo NCBI en `form-action`; y en Chrome, con un colector de violaciones inyectado antes de todo, recorrer todas las rutas + workers + exportar en 4 formatos + informe + BLAST de Sanger da 0 violaciones; el aviso de NCBI está a la vista junto al botón. |
| `button-hover.mjs` | navegador | Micro-interacción de los `.ql-btn` con el ratón REAL (Input.dispatchMouseEvent; Chrome lanzado con `--blink-settings` de ratón de escritorio, porque headless es `hover: none`): scale(1.04) + sombra en 7 módulos; sin escala con `prefers-reduced-motion: reduce`, en un dispositivo sin hover (táctil) ni en botones deshabilitados. |

### Modo de los tests de `stats/`

Cada uno lleva:
1. entradas deterministas,
2. resultado JS de `js/lib/stats.js`,
3. **GOLDEN** embebido = lo que devolvió R al escribir el test.

Se compara **siempre** JS vs GOLDEN (regresión sin depender de R). Si hay
`Rscript` + el paquete necesario, además se recalcula en R y se compara R vs
GOLDEN (detecta deriva) y R vs JS. Así `node tests/stats/*` funciona con o sin
R instalado.

## Qué NO cubre (para saber qué falta si algo se rompe)

- **Ingesta / parsers** (`ingest.js`, `csv.js`, `minizip.js`, `ordination.js`,
  `fastq.js`): se ejercitan de forma indirecta al cargar los ejemplos en el
  barrido. `tests/ingest.mjs` (nuevo) SÍ cubre la ruta `.qza`/`.qzv` de verdad
  — construye ZIPs válidos a mano (STORED y DEFLATE) y ejercita
  `listZipEntries`/`readZipText`/`listQiimeDataFiles`/`gunzip*` y
  `ingestFile()` end-to-end: taxonomía, matriz de distancias y ordination.txt
  con nombre interno genérico (usa el nombre EXTERIOR del .qza), varios
  `level-N.csv` de un `taxa-bar-plots.qzv`, aviso de BIOM binario, `.qza`
  corrupto (sin EOCD) y una entrada con método de compresión no soportado que
  no debe tirar abajo el resto del artefacto. Lo que SIGUE sin test unitario:
  cabeceras raras fuera del caso `.qza`, `#q2:types`, y el resto de rutas de
  `classifyTable()` (metadata, functionalKO, microbialCounts…) para archivos
  sueltos `.tsv/.csv`. El `diagnoseTable()` tampoco tiene test propio.
- **`upgma()` / `leafOrder()`** (clustering del mapa de calor beta): sin
  verificación numérica contra R (`hclust`).
- **Vista de biomarcadores end-to-end**: `stats/benjaminihochberg.mjs` +
  `stats/cliffsdelta.mjs` + `stats/kruskalwallis.mjs` + `stats/ancombc.mjs` +
  `stats/randomforest.mjs` cubren las fórmulas de los 3 métodos (incl. el
  criterio "Boruta-lite" de variables sombra de Random Forest); la
  comprobación de que la pestaña “Biomarcadores” pinta esos números — incluida
  la subvista "Consenso entre métodos" (taxón × método) — no está persistida
  (sí lo está la equivalente de “Comparar varias”, ver `compare-overlap.mjs`).
- **Descarga del HTML autocontenido del informe**: no automatizada (la
  impresión/PDF del informe sí: `informe-completo.mjs`; la exportación del
  editor, en `security-headers.mjs`).
- **`#/arbol` interactivo**: `sweep-routes.mjs` carga el ejemplo, espera a que
  termine el pipeline y prueba "Personalizar" sobre el árbol ya dibujado (con
  las fórmulas cubiertas por `phyloalign.mjs`/`stats/neighborjoining.mjs`/
  `stats/phylodistance.mjs`); el aviso de "demasiadas secuencias" con el botón
  de quedarse con las más abundantes, quitar una secuencia a mano de la lista,
  y que cambiar p-distance↔Jukes-Cantor NO repita el alineamiento (cacheado
  aparte), se verificaron a mano una vez, no de forma persistida.
- **i18n**: `i18n-parity.mjs` reporta los huecos de claves entre idiomas pero
  no falla por ellos (salvo con `--strict`); no se revisa la calidad de la
  traducción ni la pluralización (`{n} elementos` en idiomas con otras reglas).
  Las cadenas propias de `chartEditor` (su objeto `I18N`) quedan fuera del check.
- **Rendimiento**: `perf-stress.mjs` mide las 4 operaciones pesadas y verifica
  que las migradas a worker no bloqueen; no hay presupuesto de tiempo para el
  resto de rutas ni medición de memoria.
- **Compatibilidad de navegadores**: solo se prueba en el Chrome del sistema.
