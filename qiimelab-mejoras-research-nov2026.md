# Smart-175 — mejoras propuestas a partir de research (14 nov 2026)

Research hecho desde una sesión de chat (Claude), buscando literatura y
herramientas reales, no ideas sueltas. Cada propuesta lleva de dónde sale.
Sustituye en parte a `qiimelab-analisis-competencia.md` (sep 2026): aquello
comparaba contra MicrobiomeAnalyst / q2view / Qiita y ya está casi todo cerrado
(rarefacción, carga nativa `.qza`, informe exportable, RDA/CCA, PCoA 3D).

Orden: A y C son las que más valor añaden por esfuerzo. D es una decisión de
arquitectura, no una tarea.

---

## A. Contador de colonias (`#/recuentos?tab=foto`) — de prototipo a publicable

Lo que se acaba de implementar usa Otsu + componentes conexas + estimación de
agregados por área. Funciona, pero la literatura del campo es clara sobre dos
puntos donde se queda corto.

### A1. Separar colonias en contacto con transformada de distancia + watershed

**Prioridad: alta.** Es la parte más débil de lo actual: un agregado se estima
como `área / área mediana`, que asume colonias del mismo tamaño y falla en
cuanto hay variación real.

El método estándar del campo es watershed sobre la transformada de distancia.
La app APD Colony Counter (A*STAR) lo incorporó con OpenCV justamente para
esto: separa mejor las colonias fusionadas o parcialmente solapadas, colocando
internamente las líneas que las dividen. El mismo enfoque (umbral →
transformada de distancia → watershed) aparece repetido como solución canónica
en los trabajos de conteo por imagen.

Aviso que recoge la literatura y conviene tener en cuenta: el watershed
sobre-segmenta o sub-segmenta cuando la variación de intensidad entre las
colonias en contacto es débil. Por eso se propone *además* de la estimación
actual, con el número de semillas (máximos locales de la transformada de
distancia) como recuento y el área como control de cordura, no al revés.

Implementable sin dependencias: transformada de distancia euclídea aproximada
por dos pasadas (chamfer), máximos locales con supresión por radio, y relleno
por regiones desde las semillas.

### A2. Tratar el borde de la placa por forma, no descartándolo

**Prioridad: media.** Hoy se descarta todo objeto que toca el borde de la ROI.
Eso elimina el reborde del plástico y su sombra — que es el artefacto número
uno — pero también las colonias reales pegadas al borde, que en una placa bien
sembrada son varias.

El enfoque de la literatura es separar el área central del área del borde y, en
el borde, distinguir colonias del reborde de la placa usando excentricidad,
área y longitud de los ejes mayor y menor. Eso es exactamente lo que falta:
ya se calcula área, circularidad y alargamiento de la caja; añadir
excentricidad por momentos de segundo orden es poco código.

### A3. Página de validación del recuento

**Prioridad: alta** (y es lo que convierte la función en algo citable).

Ya existe el patrón en el proyecto: la página de validación de estadística
frente a R. Hace falta el equivalente aquí, porque el conteo por imagen no es
aritmética, es una estimación, y sin acuerdo medido no es defendible.

Dos referencias con las que compararse:

- **OpenCFU** (Geissmann 2013, PLoS ONE) es la referencia abierta del campo:
  su autor demostró que es más rápido, más preciso y más robusto frente a
  artefactos habituales que NICE (NIST Integrated Colony Enumerator) y que la
  macro de Cai. Es C++ con GUI, open source, y acepta una carpeta de imágenes
  en un paso — o sea, se puede usar para generar la verdad de referencia de un
  lote.
- **Acuerdo con el recuento manual.** La app APD publicó 90,3 % ± 6,4 de
  acuerdo sobre 12 placas, y dice explícitamente que las tecnologías de
  procesado de imagen actuales no llegan al 100 %. Ese es el orden de magnitud
  honesto que debería aparecer en la UI, no una cifra de precisión implícita.

Un dato que respalda el diseño actual: en el estudio comparativo del IPB, el
método automático falla precisamente en las colonias del borde de la placa,
y es el método *interactivo* (con clics del usuario corrigiendo) el que mejor
se acerca al recuento manual, mejor que el automático y que NICE. Es decir: la
corrección a clics no es un parche, es lo que hace el recuento utilizable, y la
app debería decirlo en lugar de disculparse por ello.

### A4. Hough circular como segundo método (opcional)

**Prioridad: baja.** Hay trabajo reciente comparando Hough Circle Transform
contra el recuento manual: concluye que es más efectivo que el manual para
detección automatizada, manteniendo buena exactitud con caídas menores de
recall y F-measure sobre todo en placas de alta densidad. Encaja con la
filosofía del proyecto de ofrecer varios métodos y un panel de consenso, como
ya se hace en biomarcadores. No antes de A1-A3.

---

## B. Visualización: heat-tree topológicamente consistente

**Prioridad: media-alta.** Es la propuesta con más diferenciación frente a lo
que ya existe, y encaja con piezas que el proyecto ya tiene (UPGMA en beta
diversidad, paletas validadas para daltonismo, editor de figuras compartido).

MetaTree (Wu et al., *BMC Bioinformatics* 2026, 27:158) parte de dos
limitaciones que Smart-175 tiene igual que todos:

- los **barplots apilados** obligan a agregar a rangos taxonómicos gruesos, lo
  que esconde los patrones de los niveles profundos, que suelen ser los
  informativos; y están limitados por cuántos colores se distinguen de verdad;
- los **heatmaps con clustering** separan el dendrograma de la matriz, así que
  el lector tiene que unir mentalmente las dos cosas, y se vuelven ilegibles al
  crecer el número de features.

Lo que aporta MetaTree, y que serviría de especificación para un módulo nuevo:

- árbol de referencia compartido entre todos los paneles, con correspondencia
  uno a uno de nodos, para que un clado esté en la misma posición en todas las
  vistas;
- color de nodo, tamaño de nodo y anchura de rama mapeables a la variable que
  se elija, con paletas, dominio y dirección configurables y transformaciones
  log o raíz cuadrada;
- layouts radial, dendrograma y circle-packing;
- navegación sincronizada (pan y zoom) entre paneles;
- control de etiquetas: densidad por profundidad o por abundancia, descarte
  automático de solapes, límites de fuente y longitud;
- filtrado y poda: búsqueda, listas de inclusión/exclusión, umbrales de
  abundancia, colapsar y expandir ramas;
- modos de análisis: muestra, grupo, comparación de dos grupos (Wilcoxon o
  Welch, con FDR de Benjamini-Hochberg y log2 fold-change) y matriz
  todos-contra-todos;
- exportación SVG/PNG por panel más tablas de estadística.

Nota de posicionamiento útil: el propio artículo señala que Metacoder depende
de R, produce salida estática de ggplot2 y sus etiquetas se solapan o se
vuelven ilegibles en los niveles profundos, y que PhyD3, GraPhlAn, ETE, Krona e
iTOL renderizan árboles individuales más que comparaciones sistemáticas, varios
requiriendo scripting o archivos de configuración. Un heat-tree interactivo,
sin instalación y con control fino de etiquetas es hueco real de mercado.

Lo de MetaTree que ya tenemos: Wilcoxon, Welch, BH-FDR, log2FC, paletas,
export SVG/PNG, importación con mapeo de columnas. Lo nuevo de verdad es el
árbol compartido y el control de etiquetas.

---

## C. Reproducibilidad: lo que pide una revista

### C1. Checklist STORMS en el informe exportable

**Prioridad: alta.** Esfuerzo bajo, valor alto para quien va a publicar, y
nadie más lo ofrece integrado.

STORMS (*Strengthening The Organization and Reporting of Microbiome Studies*,
Mirzayi et al., *Nature Medicine* 2021;27:1885-1892) es un checklist de 17
ítems en 6 secciones que se corresponden con las secciones típicas de un
artículo, y se publica como **tabla editable para incluir en material
suplementario**. Nació porque las guías de epidemiología observacional o
genética (STROBE, STREGA) no cubren lo específico de microbioma: de los ítems
de la versión actual, 57 son guías nuevas desarrolladas desde cero.

Propuesta concreta: el módulo `#/informe` ya reúne métodos (`methodsText.js`) y
los avisos de equivalencia Nivel A/B/C (`methodEquivalence.js`). Añadir una
sección que emita el checklist STORMS con dos tipos de fila: las que la app
puede rellenar sola (secuenciación usada, filtros de prevalencia aplicados,
índices de diversidad, test estadístico y corrección de FDR, versiones) y las
que quedan como hueco explícito para el autor (diseño del estudio, criterios de
inclusión, consentimiento). Última versión del checklist en
`stormsmicrobiome.org`.

Ojo al alcance: STORMS es de microbioma **humano**. Para suelo, compost o
plásticos hay que presentarlo como plantilla adaptable, no como norma aplicable
tal cual.

### C2. Trazabilidad de procedencia estilo Shiny-phyloseq

**Prioridad: media.** Shiny-phyloseq (McMurdie & Holmes, *Bioinformatics* 2014)
introdujo justamente esto: permitir al usuario **archivar el código y los datos
necesarios para reproducir exactamente** el análisis, como objetivo declarado de
reproducibilidad y portabilidad.

Smart-175 ya tiene las dos mitades: sesión exportable en JSON con versionado, y
los scripts de R comentados que reproducen los análisis validados contra R
(Nivel A/B). Falta cerrar el círculo: un único paquete descargable —sesión +
scripts + versión de la app + semillas aleatorias— de modo que un revisor pueda
repetir la figura. Es trabajo de empaquetado, no de algoritmo.

---

## D. Decisión de arquitectura: WebAssembly para dejar de aproximar

**No es una tarea, es una decisión que hay que tomar a conciencia**, porque toca
la regla de "cero dependencias de código" del CLAUDE.md.

Hoy hay métodos marcados Nivel C precisamente porque son aproximaciones
propias (tipo ANCOM-BC, tipo LEfSe) y el alineamiento múltiple del módulo de
árbol es un alineamiento progresivo simplificado, no MAFFT. WebAssembly ofrece
la alternativa de **usar la herramienta real en el navegador** en lugar de
aproximarla, que es lo que la regla de "nunca reimplementar una herramienta
externa" querría:

- **biowasm** es un repositorio de herramientas de genómica compiladas de C/C++
  a WebAssembly para correr en el navegador (samtools, bedtools, bcftools,
  minimap2, seqtk, fastp, kalign…), con **Aioli** como framework que las
  ejecuta dentro de WebWorkers — es decir, fuera del hilo principal, igual que
  el `alignWorker.js` actual.
- Ya hay precedentes en producción: CZ ID usa `htsfile` y `seqtk` para detectar
  problemas antes de subir archivos, fastq.bio corre `fastp` para evaluar
  calidad de secuenciación, Ribbon corre `samtools`, y **Datagrok corre kalign
  en el navegador para alineamiento múltiple** — exactamente el hueco del
  módulo de árbol.
- Sobre el coste: ViralWasm ejecuta las herramientas originales de línea de
  comandos client-side sin configuración del usuario con una penalización de
  solo **2-3× respecto a sus equivalentes de línea de comandos**. Es decir, el
  rendimiento no es el obstáculo.

Lo que hay que decidir: un `.wasm` es una dependencia de código, aunque no
venga de npm. Mi recomendación es permitirlo **auto-hospedado** (no por CDN, que
rompería el "sin peticiones externas") y solo para sustituir aproximaciones por
la herramienta real, empezando por el MSA. Si se decide que no, entonces el
Nivel C debería declarar explícitamente que existe esta alternativa y que se
descartó, para que el lector sepa que la aproximación es una elección y no un
descuido.

---

## E. Skills y plugins para la parte de diseño

Lo que pidió el usuario: algo que ayude con visualización y diseño de la app.
Disponible sin instalar nada en la sesión de chat: `dataviz` (método de color,
formas y layout para gráficos, con validador de paleta) y `frontend-design`.

En el catálogo de plugins, sin instalar todavía, lo que de verdad encaja:

| Plugin | Por qué encaja aquí |
|---|---|
| **audit-suite** (Orbit, comunidad) | 16 skills: lentes de auditoría de Design, UX, Frontend, Accesibilidad, Performance y Producción, más `web-design-guidelines` y `make-interfaces-feel-better`. Sin dependencias externas. Es lo más parecido a la auditoría cruzada que ya se hace a mano en este proyecto. |
| **UI Design Review** (UXKIN) | `ui-review`, `ui-polish`, `ui-compare`: revisa la pantalla **renderizada** en móvil y escritorio, prioriza lo que arreglar y compara con cómo lo resuelven productos reales. Cubre justo el hueco que quedó abierto con el contador de colonias (no hubo pasada visual). |
| **frontend-design** (Anthropic) | Versión plugin de la skill de diseño de UI. |
| **Intuitive Software Design** | Diseño en torno a tareas reales del usuario; útil para el modo guiado/avanzado que lleva aparcado en P2. |

Recomendación: `audit-suite` para una auditoría de UX/accesibilidad del lote de
módulos nuevos, y `UI Design Review` para la pasada visual pendiente. Los dos
son de la comunidad, así que conviene leer qué hacen antes de darles la carpeta.

---

## Qué NO hacer

- **Reescribir el contador de colonias con una red neuronal.** Hay trabajo en
  esa dirección, pero rompe el "cero dependencias" de forma mucho más cara que
  un `.wasm`, y A1-A3 cierran la mayor parte del hueco de exactitud.
- **Checklist STORMS presentado como norma para muestras ambientales.** Es de
  microbioma humano; venderlo como universal sería incorrecto.
- **Dar una cifra de precisión del recuento por imagen sin haberla medido.**
  Hasta que exista A3, la UI debe hablar de recuento asistido y de acuerdo con
  el recuento manual, no de exactitud.

---

## Fuentes

- Geissmann Q. *OpenCFU, a New Free and Open-Source Software to Count Cell Colonies and Other Circular Objects.* PLoS ONE 2013;8(2):e54072. https://pmc.ncbi.nlm.nih.gov/articles/PMC3574151
- *APD Colony Counter App: Using Watershed Algorithm for improved colony counting.* Nature Methods Application Notes 2016. https://oar.a-star.edu.sg/storage/o/o13no50vx3/775-an9774.pdf
- *Interactive/Automated Method to Count Bacterial Colonies.* RECPAD 2015, IPB. https://bibliotecadigital.ipb.pt/bitstreams/ecaa38e7-f120-4fbe-9563-1151a0ebe8e0/download
- *A Comparison of Bacterial Colonies Count from Petri Dishes Utilizing Hough Transform and Traditional Manual Counting.* arXiv 2505.20365. https://arxiv.org/pdf/2505.20365
- Wu et al. *MetaTree: an interactive web platform for aligned hierarchical data visualization.* BMC Bioinformatics 2026;27:158. https://doi.org/10.1186/s12859-026-06475-3
- Mirzayi C, et al. *Reporting guidelines for human microbiome research: the STORMS checklist.* Nat Med 2021;27:1885-1892. https://doi.org/10.1038/s41591-021-01552-x — checklist en https://www.stormsmicrobiome.org/
- McMurdie PJ, Holmes S. *Shiny-phyloseq: Web application for interactive microbiome analysis with provenance tracking.* Bioinformatics 2014. https://doi.org/10.1093/bioinformatics/btu616
- biowasm / Aioli. https://github.com/biowasm/biowasm · https://github.com/biowasm/aioli
- *ViralWasm: a client-side user-friendly web application suite for viral genomics.* 2024. https://pubmed.ncbi.nlm.nih.gov/38200583/
