# Smart-175

> **Producto: Smart-175. Repositorio: `qiimelab`, sin cambios (decisión deliberada).** "QiimeLab" es el nombre
> heredado: ya no aparece en nada de lo que ve el usuario. El repo, la URL de GitHub Pages
> (`lucadoktor.github.io/qiimelab/`), la carpeta y el `name` de `package.json` se quedan como están
> a propósito — renombrarlos rompería enlaces y forks sin aportar nada a quien usa la app.
> Las claves antiguas `qiimelab.*` de localStorage se migran solas a `smart-175.*` al arrancar
> (`js/lib/storageMigration.js`).

[![verify](https://github.com/LucaDoktor/qiimelab/actions/workflows/verify.yml/badge.svg)](https://github.com/LucaDoktor/qiimelab/actions/workflows/verify.yml)

Analiza resultados de **QIIME2** y archivos **FASTQ** enteramente en el
navegador: barplots taxonómicos, diversidad alfa y beta, abundancia
diferencial, diagramas de Venn/UpSet, correlograma entre variables, índices
funcionales de PICRUSt2 y control de calidad de secuencias estilo FastQC.

**Sin backend. Sin instalación.** Los análisis se ejecutan localmente: se
abre el archivo, se parsea con JavaScript y se dibuja al momento, y los
archivos no se envían a nuestros servidores. Una función opcional (BLAST en el
módulo Sanger) abre una consulta a NCBI y envía la secuencia introducida a ese
servicio externo.

Interfaz en **español, inglés, italiano, alemán y chino** (selector en la
barra lateral).

## Probarlo

- **En local**, con Python (suele venir instalado):

  ```bash
  cd qiimelab            # la carpeta de este repo
  python3 -m http.server 8000
  # abre http://localhost:8000
  ```

  Hace falta servirlo por HTTP: los `<script type="module">` no funcionan
  abriendo `index.html` con doble clic (`file://`).

  Si tienes Node, `npm run serve` hace lo mismo y `npm test` corre la suite
  (`package.json` es solo esa interfaz de desarrollo: sin dependencias y sin
  build, no hace falta `npm install`).

- **En VS Code**: clic derecho sobre `index.html` → "Open with Live Server".

- **En GitHub Pages / Netlify / cualquier hosting estático**: sube la carpeta
  tal cual. No hay build step.

## Qué puede hacer

| Módulo | Entrada | Qué produce |
|---|---|---|
| **Carga de datos** | `.qza` / `.qzv` / `.tsv` / `.csv` / `.tsv.gz` / `.fastq[.gz]` | Detecta el tipo de cada archivo y lo enruta al módulo correspondiente |
| **Barplots taxonómicos** | tabla de abundancia por taxón (o el `.qzv` de `qiime taxa barplot`) | Barras apiladas de abundancia relativa, top 7 + «Otros», agrupables por metadatos |
| **Diversidad alfa** | vector de diversidad alfa + metadatos | Boxplot por grupo + test de Kruskal-Wallis |
| **Diversidad beta** | matriz de distancias (`.qza` o `.tsv`) | Mapa de calor ordenado por dendrograma UPGMA |
| **Abundancia diferencial** | tabla tipo DESeq2 / ANCOM-BC | Volcano plot interactivo + generador de script de R |
| **Recuentos microbianos** | recuento de laboratorio (placa UFC/mL, NMP/mL) con réplicas en filas | Agrupa réplicas, promedia en log10, barras con barra de error ±SD / ±SE |
| **Venn / UpSet** | tabla de conteos taxón × muestra + metadatos | Taxones compartidos y exclusivos entre grupos (Venn hasta 4 grupos, UpSet 5+) |
| **Control de calidad (FASTQ)** | `.fastq` / `.fq` / `.fastq.gz` / `.fq.gz` | Informe estilo FastQC: calidad por posición, composición de bases, %GC, duplicación, sobrerrepresentadas, adaptadores, tabla comparativa multi-muestra |

Cada módulo tiene un **estado vacío con botón de ejemplo** (real y sintético),
deja **corregir a mano el mapeo de columnas** y ofrece una **tabla** como
alternativa a cada gráfico.

## Personalizar y exportar las figuras

Cada gráfico (barplot, diversidad alfa/beta, volcano, Venn/UpSet) tiene un
botón **«Personalizar»**: activa un modo de edición para **arrastrar** los
textos de la figura (título, títulos de eje, leyenda) y cambiarles **color,
fuente, negrita/cursiva y tamaño**. Los cambios se guardan en el navegador
por módulo y se pueden **restablecer**. El botón **«Descargar SVG»** exporta
la figura tal cual se ve, lista para un informe o un póster. También hay una
hoja de estilos de impresión: al imprimir sale solo la figura y las tablas,
sin la interfaz.

## Qué archivos acepta

- **`.qza` / `.qzv` directamente** — se desempaquetan en el navegador
  (`js/lib/minizip.js`, sin librerías) y se busca dentro lo que cada módulo
  necesita.
- **`.tsv` / `.csv` / `.txt`** ya exportados.
- **`.tsv.gz` / `.csv.gz`** — gzip suelto (el formato de
  `pred_metagenome_unstrat.tsv.gz` de PICRUSt2).
- **`.fastq` / `.fq` / `.fastq.gz` / `.fq.gz`** — se leen en *streaming*, sin
  cargar el archivo entero en memoria; el análisis se basa en una submuestra
  configurable (200 000 lecturas por defecto).

La detección de tipo (`js/lib/ingest.js`) es una heurística sobre las
cabeceras, siempre pensada para poder equivocarse sin romper nada: el mapeo
de columnas se puede corregir en cada módulo.

**Limitación conocida:** la tabla de conteos de `feature-table.qza` suele
venir en BIOM (HDF5 binario), que esta versión aún no lee. Expórtala antes:

```bash
qiime tools export --input-path feature-table.qza --output-path exported/
biom convert -i exported/feature-table.biom -o feature-table.tsv --to-tsv
```

## Dependencias

**Ninguna a nivel de código** — son módulos ES nativos, sin `npm install`, sin
bundler. **Cero peticiones externas al cargar y analizar**: la tipografía
**IBM Plex** se sirve desde el propio repo (`fonts/` + `css/fonts.css`,
subconjuntos latin/latin-ext, ~256 KB), así que la app carga y funciona sin
conexión desde la primera visita cacheada. La única excepción es el BLAST
opcional del módulo Sanger, que sí necesita red y envía la secuencia a NCBI. Si una fuente faltara, el CSS degrada a la del sistema.

## Datos de ejemplo (`datos-ejemplo/`)

Recorte pequeño y curado de resultados **reales** de un estudio de microbioma
16S con varios grupos de tratamiento y una fase de validación, **anonimizado**
(nombres de grupo, de muestra y de las variables del diseño son genéricos; los
valores numéricos, los nombres de taxones y las categorías de KEGG se
conservan). Cada módulo tiene un botón **«Cargar ejemplo real»** que hace
`fetch()` de estos archivos y los pasa por el mismo `ingest.js` que un archivo
subido a mano — sirve además de referencia de «así tiene que verse tu
archivo». Ver `datos-ejemplo/README.md` para el detalle de cada uno.

La carpeta se regenera con un script que vive **fuera de este repositorio**
(en el repo de datos privado): lee los resultados originales, aplica el
diccionario de anonimización, reescribe `datos-ejemplo/` y verifica con una
lista negra que no se cuele ningún identificador. Ni el script ni el
diccionario se publican; solo el resultado ya anonimizado.

## Estructura

```
qiimelab/
├── index.html
├── favicon.svg               # logotipo (dendrograma sobre baldosa de marca)
├── icon-maskable.svg         # icono adaptable para la PWA (fondo a sangre)
├── manifest.json             # manifiesto de la PWA
├── sw.js                     # service worker (caché en tiempo de ejecución)
├── .nojekyll                 # desactiva el procesado Jekyll de GitHub Pages
├── datos-ejemplo/            # recorte real anonimizado + su README
├── recursos/                 # plantillas de scripts (pipeline QIIME2 + R) + su README
├── tests/                    # batería de verificación (node tests/run.mjs)
├── .github/workflows/        # verify.yml — CI en cada push/PR a main
├── css/                      # tokens.css (paleta), base.css, components.css
└── js/
    ├── app.js                 # router por hash + carga perezosa de módulos
    ├── state.js               # almacén compartido (slots: metadata, taxonomy…)
    ├── lib/
    │   ├── csv.js               # parser TSV/CSV
    │   ├── minizip.js           # lector ZIP (.qza/.qzv) + gunzip
    │   ├── fastq.js             # lector y analizador FASTQ en streaming
    │   ├── ingest.js            # detección de tipo de archivo
    │   ├── route.js             # "resultado de ingest → slot del estado"
    │   ├── stats.js             # Kruskal-Wallis, chi², beta incompleta,
    │   │                        #   Pearson/Spearman + p-valor, UPGMA
    │   ├── i18n.js              # traducciones (es/en/it/de/zh) + t()
    │   ├── pwa.js               # registro del SW + aviso de versión / offline / instalar
    │   ├── heavyStats.js        # UPGMA / rarefacción en worker si el tamaño lo justifica
    │   ├── chartEditor.js       # personalizar/arrastrar textos + exportar SVG/PNG
    │   ├── groupBoxplot.js      # boxplot por grupo + Kruskal-Wallis (alfa y funcional)
    │   ├── motif.js             # motivo SVG del hero (dendrograma + puntos)
    │   ├── countStats.js        # recuento microbiano: media/SD/SE en log10 por grupo
    │   └── exampleData.js       # cargadores de ejemplo (sintéticos y reales)
    ├── workers/
    │   ├── fastqWorker.js       # análisis FASTQ fuera del hilo de la UI
    │   └── statsWorker.js       # UPGMA + curvas de rarefacción fuera del hilo de la UI
    └── modules/                 # un archivo por módulo (shell, home, upload,
        │                        # taxaBarplot, alphaDiversity, betaDiversity,
        │                        # differentialAbundance, microbialCounts, venn,
        │                        # correlogram, functional, sequenceQC, recursos)
```

## Recursos (`recursos/`)

Plantillas de scripts **educativas**, adaptadas de un pipeline de metabarcoding
real: el flujo de QIIME 2 (16S + dos pasos de ITS) en `recursos/pipeline-qiime2/`
y un par de helpers de R en `recursos/r-analisis/`. Rutas como
`<<CAMBIA_ESTO_POR_TU_CARPETA>>`, nombres de archivo genéricos, sin datos.
**No son un procedimiento soportado paso a paso.** La app las lista para
descargar en `#/recursos`. Ver `recursos/README.md`.

Añadir un módulo: crear el archivo en `js/modules/`, una entrada en
`moduleLoaders` de `js/app.js` y otra en `ROUTES` de `js/modules/shell.js`.

## Verificación

```bash
node tests/run.mjs          # toda la batería, con resumen final
```

Node ESM sin dependencias de `npm`. Los tests de navegador usan Chrome
headless vía CDP; los de estadística comparan contra R cuando está disponible
y, si no, contra una referencia R embebida (modo GOLDEN). Cubre las 14
rutas en claro/oscuro, el ciclo de sesión, accesibilidad, el desborde móvil
a 375/768px, la PWA (manifest + service worker + carga offline) y ~40
comprobaciones numéricas. Detalle en `tests/README.md`.

El workflow **verify** (`.github/workflows/verify.yml`) ejecuta `node
tests/run.mjs` en cada push y pull request a `main` (Ubuntu; sin R → modo
GOLDEN).

## PWA

`manifest.json` + `sw.js` en la raíz. El service worker cachea en tiempo de
ejecución (network-first para el HTML, cache-first con revalidación para el
resto del mismo origen) — sin lista de precache, porque no hay build step.
La app se puede instalar (botón en el pie, en navegadores que lo soportan) y
abre sin conexión con los datos que ya se cargaran. Cuando hay una versión
nueva aparece un aviso discreto para recargar.

## Notas de desarrollo

- **`js/lib/minizip.js`** — lector de ZIP escrito a mano (sin JSZip) porque el
  entorno donde se generó este scaffold no tenía acceso de red. Verificado
  contra un ZIP construido con Node (`zlib.deflateRawSync` / `inflateRawSync`).
  Si un `.qza` no se lee, comprueba con `unzip -l` que no sea ZIP64.
- **`js/lib/stats.js`** — el p-valor de chi-cuadrado (gamma incompleta,
  Lanczos) se verificó contra valores críticos de tabla; el UPGMA, con un caso
  de juguete con distancias conocidas. La **beta incompleta regularizada**
  (fracción continua de Lentz, para el p-valor de correlación) se verificó
  contra `pbeta()` de R en casos analíticos y contra `cor.test` (Anscombe I)
  a 1e-9; Spearman contra la fórmula exacta `1 − 6·Σd²/(n(n²−1))`.
  Los **índices de diversidad alfa** — Shannon, Simpson (1−D), Pielou (J'),
  Chao1 corregido por sesgo por muestra, y los estimadores de riqueza por
  incidencia por grupo (Chao2, jackknife 1º/2º orden, bootstrap, con sus
  errores estándar) — se verificaron número a número contra
  `vegan::diversity()`, `vegan::estimateR()` y `vegan::specpool()` (error
  relativo < 1e-12 sobre la tabla de conteos de ejemplo y un caso de juguete
  con singletons/doubletons). Las **curvas de rarefacción** (`rarefactionCurve`,
  esperanza analítica de riqueza de Hurlbert 1971 con `logGamma` para los
  combinatorios, sin remuestreo) se verificaron contra `vegan::rarefy()` en 5
  muestras × ~60 profundidades de la tabla de conteos de ejemplo (error
  relativo máximo 2·10⁻¹⁰).
- **`js/lib/fastq.js`** — un solo recorrido en streaming acumula todas las
  métricas; los percentiles de calidad por posición salen de un histograma
  `[posición][Phred]`, sin guardar las lecturas. **No sustituye a
  DADA2/QIIME2**: son estadísticas descriptivas sobre el FASTQ tal cual.
- **Rendimiento con datasets grandes** — medido antes de tocar nada
  (`tests/perf-stress.mjs`, dataset sintético de 260 muestras × 2800 taxones).
  Bloqueaban el hilo principal: las **curvas de rarefacción** de todas las
  muestras (~530 ms) y el **UPGMA** del mapa de calor beta (O(n³): ~170 ms a
  520 muestras). Ambos se movieron a `js/workers/statsWorker.js` vía
  `js/lib/heavyStats.js`, que solo usa el worker por encima de un umbral de
  tamaño (por debajo calcula en el hilo principal, sin el coste de arrancarlo).
  Con el worker el hueco máximo entre frames baja a ~17-20 ms. **No** se
  tocaron: el correlograma (acotado por diseño a ≤ ~40 variables, ~35 ms), la
  matriz Bray-Curtis (solo para el ejemplo sintético de 20 muestras) y el
  render de la tabla de abundancia diferencial (~150 ms para 4200 filas: es
  trabajo de DOM que un worker no puede hacer; el arreglo sería virtualizar la
  tabla).

## Licencia

MIT — ver `LICENSE`.
