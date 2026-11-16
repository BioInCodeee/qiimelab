# Cómo se ven las apps parecidas en 2026 — research visual/UX (16 nov 2026)

Tercera pasada de research. Las dos anteriores: `qiimelab-analisis-competencia.md`
(sep 2026, MicrobiomeAnalyst/q2view/Qiita — todo su "quick wins" ya está hecho:
rarefacción, carga nativa `.qza`, informe exportable, RDA/CCA, PCoA 3D) y
`qiimelab-mejoras-research-nov2026.md` (14 nov, colonias/heat-tree/STORMS/WASM).
Esta es distinta: **no pregunta qué funciones faltan, sino cómo se ven y se
sienten las herramientas comparables en 2026**, y qué patrones visuales/UX
merece adoptar Smart-175. Verificación en vivo de webs el 16 nov 2026.

Responde además: **¿el Agar ya está completo?** (sección 1).

---

## 1. Estado del Agar

**El cromado sí: está completo y verificado.** Lo que faltaba del sistema no es
la pasada visual sino piezas nuevas de producto:

- Cimientos (tokens crema/tinta/serif, radios, componentes) — hecho.
- Pasada módulo a módulo — **hecha** (16 nov 2026): `tests/design-v2-modules.mjs`
  recorre 21 rutas y 58 vistas en claro y oscuro, 120/120. De ahí salieron seis
  tokens fantasma (`--line`, `--brand`, `--warn-ink`, `--font-ui`, `--bad`,
  `--focus`) que se usaban sin existir, los colores de `<canvas>` de
  `antagonism.js` vía el helper `token()` nuevo en `dom.js`, y dos fallos de
  contraste (`--critical` como texto, `.ql-nav-soon` en oscuro).
- Últimos sitios pre-Agar (favicon, icono maskable, política de privacidad) —
  hechos en `14df050` ("lo último que seguía en azul").

Lo que queda del sistema de diseño, según `design-system/smart-175/AGAR.md`
§"Lo que falta", todo nuevo (no es retoque del cromado):

1. **Mascota (Tardi)** con sus seis estados + «modo sobrio»: no implementada.
2. **Módulo de enfrentamientos** (captura, resultado, estado vacío): diseñado,
   sin construir.
3. **Tabla de réplicas** y **barra inferior de módulos**: especificadas, sin
   implementar.
4. Aparcado a propósito con causa: los **colores de detección de
   `plateImage.js`** (cian/ámbar/amarillo/verde/gris sobre fotografía) quedan
   pendientes de revisar **con fotos reales de placa delante** — cambiarlos a
   ciegas es arriesgado y el propio AGAR.md lo deja escrito así.

---

## 2. Panorama por familia

### 2.1 Análisis de microbioma (la competencia directa)

- **MicrobiomeAnalyst 2.0** (McGill) — el más citado y vivo. Visualmente
  «académica funcional»: Jakarta Faces/PrimeFaces, Arial 13 px, azul cielo +
  botón terracota, sin modo oscuro, sin i18n. Lo fuerte: informe PDF de sesión
  automático, ayuda inline en cada campo, changelog público muy vivo (última
  entrada 10/2026, ANCOM-BC2 y Aitchison añadidos en 2026). Lo malo: la sesión
  caduca a los 30 min y hay caídas que obligan a resubir datos — exactamente el
  fallo que una app sin servidor no puede tener.
- **QIIME 2 View** (q2view) — el pariente arquitectónico (Service Worker, nada
  sube a servidor). Minimal, dropzone central, **galería de 4 ejemplos que dan
  la primera figura en 1 clic**, y **provenance inline** (qué comandos, qué
  parámetros, qué versiones generaron esa vista). Solo visor, no analiza.
- **Qiita** (UCSD) — plataforma meta-análisis con cuenta obligatoria; EMPeror
  sigue siendo el benchmark de PCoA interactiva. No es el caso de uso de
  Smart-175.
- **Mian** (UBC Vancouver) — la más «designed» del grupo (landing tipo SaaS,
  tres rutas de entrada: registro / demo con datos precargados / continuar sin
  cuenta). Su infra de una sola instancia cae: 500 verificada el día del
  research. Refuerza el argumento de la arquitectura sin servidor.
- **MicrobiomeDB** (VEuPathDB) — el patrón más copiable: **apps «ghosted» en
  gris con explicación de por qué no aplican a los datos cargados**, y botón
  «Export plot» (PNG/SVG) en cada figura. Release congelada desde 2024.
- **MetaTree** (2026, BMC Bioinformatics) — gemela arquitectónica de Smart-175
  (100% client-side en GitHub Pages, D3): árbol compartido entre paneles con
  zoom sincronizado, «Reset to Example» en 1 clic, «Load parameters», toggle
  claro/oscuro. Debilidad visible: panel de control denso sin progresión
  guiada, sin i18n.

### 2.2 Secuenciación, QC, primers y laboratorio

- **SnapGene 9 / Benchling / Geneious Prime** — escritorio o SaaS de pago con
  onboarding por vídeos (SnapGene Academy, Prism Academy: contenido educativo
  como estrategia de captación). Lo copiable: el historial automático de
  procedimientos de SnapGene (documentación sin esfuerzo del usuario) y la
  vista de contig de Geneious/DNA Baser (cromatograma + consenso +
  discrepancias en una vista, corrección a clic). Lo no copiable: cuenta,
  licencia, densidad de menús.
- **Visores de cromatogramas** — hay una **ola nueva 2025-2026 de visores .ab1
  100% client-side sin registro** (SeqSMART, ConductScience, familia
  bioToolsonline): Phred coloreado por tramos (Q20/Q30), **sugerencia de puntos
  de recorte**, demo precargada, export FASTA. **TEAL** (EMBL) tiene el mejor
  UX pero requiere servidor Tracy. **IDT OligoAnalyzer**, el estándar de facto
  de oligos, ahora **exige iniciar sesión** — fricción que convierte en
  ventaja a cualquier calculadora abierta.
- **NEB Tm Calculator** — patrón de dominio importante: el **buffer/polimerasa
  es una precondición** (Q5, Phusion, GoTaq…): elegir el enzima ajusta el Ta
  recomendado. Tabla de constantes embebida, cero backend.
- **fastq.bio / qtqc** — FastQC en el navegador (fastq.bio vía WebAssembly de
  biowasm, con dependencia de CDN externa). Ninguno tiene comparativa
  multi-muestra: es el hueco que Smart-175 ya cubre con su tabla estilo MultiQC
  + semáforo.

Convenciones del dominio a respetar (no negociable): picos de cromatograma
A=verde, C=azul, G=negro, T=rojo (ABI); zonas de baja calidad grises/recortadas;
semáforo Phred sobre tramos Q20/Q30; qPCR con FAM=verde, VIC/HEX=amarillento,
ROX=rojo, Cy5=violeta, curvas Rn/ΔRn vs ciclo con línea de umbral, banda de
validez de eficiencia 90-110%; IUPAC y N en secuencias.

### 2.3 Dataviz y estadística (la referencia de «figuras publicables»)

- **Datawrapper** — el patrón oro del editor de gráficos en navegador. Lo
  distintivo: **presets de impresión con tamaño exacto en mm/pulgadas y
  presets nombrados por equipo** («2 columnas»), **texto editable en el PDF
  exportado** (lo citan los usuarios: «arreglar la errata en Illustrator»), y
  modo oscuro resuelto **por tokens** en el embed, no en el editor.
- **Flourish / BioRender** — la galería con miniaturas grandes **convence antes
  del flujo**; BioRender estrenó en 2026 «Graphing» (importa incluso ficheros
  de Prism, detección de variables, estilo consistente entre gráficos) y su AI
  «Leo» con el lema «cada cambio sigue en tus manos». No copiar: paywall para
  exportar sin marca de agua (veneno para un TFG) y registro forzado.
- **jamovi / JASP** — el moat docente: **resultados ya maquetados en formato
  APA listos para pegar**, código R equivalente visible en vivo (jamovi), y
  **output anotado educativo** + biblioteca de datos para docentes (JASP).
  Accesibilidad documentada (VPAT) como parte del producto.
- **GraphPad Prism** — la referencia de exportación (DPI elegible, dimensiones
  de revista, presets) y del vínculo «tipo de tabla → análisis → gráfico». No
  copiar: modales anidados y nube obligatoria.
- **Observable Plot** — lección: los *defaults* que «saben bien» sin configurar
  y la galería de ejemplos ejecutables como documentación.
- **Orange** — la selección en un gráfico filtra el resto del flujo (linking);
  no aplica su lienzo de widgets.
- **Tendencias 2025-2026**: IA como asistente con control del usuario; modo
  oscuro emparejado por tokens (SPSS 30 lo estrena en estadística); el print
  vuelve (presets de revista); **el informe HTML autocontenido desplaza al PDF
  como unidad de análisis reproducible** (fastq.bio ya lo hace, Smart-175 lo
  tiene); *progressive disclosure* para atender a novato y experto a la vez.

---

## 3. Qué adoptar (priorizado y filtrado por lo que ya existe)

Ya cubierto por Smart-175 (no reproponer): galería de ejemplos por módulo con
carga en 1 clic, guía de diagnóstico de archivos (`fmt.*`), informe
autocontenido imprimible, semáforo QC + comparativa multi-muestra, editor de
figuras por elementos con exportación SVG/PNG, i18n en 5 idiomas, tema oscuro
por tokens (Agar), paletas CVD, sesión exportable JSON, PWA offline, sonda de
móvil en la suite.

Lo nuevo, por valor/esfuerzo:

1. **Presets de tamaño de exportación por destino** — menú «revista» en el
   exportador: 85 mm (1 columna), 180 mm (2 columnas), póster A0, diapositiva
   16:9; fija tamaño, margen y resolución del PNG/SVG. Ojo: no es lo mismo que
   los *presets de estilo* (Nature/Cell) que se retiraron en la Fase 1 — esto
   es **tamaño y margen**, no paleta ni tipografía. Datawrapper lo hace con un
   combobox y Prism lo cobra. Es lo que más pega al público TFG/publicación.
   Esfuerzo: bajo-medio (`chartExport.js` ya serializa; falta el escalado a
   medida física y el menú).
2. **Módulos «ghosted» con causa visible** — patrón MicrobiomeDB: en la
   navegación/portada, el módulo que no puede ejecutarse con los datos
   presentes va en gris con el motivo («necesita matriz de distancias»), en
   lugar de estar activo y fallar dentro. Ya hay validaciones y las insignias
   de la portada; es formalizarlas en la navegación. Elimina la fricción nº1
   del novato («¿por qué no funciona PERMANOVA?»). Esfuerzo: bajo.
3. **Cromatograma con calidad coloreada por tramos + recorte sugerido** —
   colorear por Phred (Q20/Q30) y marcar los extremos que el algoritmo de Mott
   ya calcula en `sangerTrim.js`, más una traza de ejemplo precargada (los
   visores client-side nuevos lo traen de serie). Respetando la convención de
   colores ACGT. Valor didáctico alto. Esfuerzo: bajo-medio.
4. **Polimerasa como precondición del Ta** (NEB) — en primers y qPCR, tabla
   embebida de constantes por enzima/buffer (Taq, Phusion, Q5, GoTaq) que
   ajuste el Ta recomendado y lo declare. Credibilidad docente instantánea;
   nadie client-side lo ofrece. Esfuerzo: bajo.
5. **«¿Cómo se hizo esta figura?»** — provenance por figura (q2view/miaDash):
   el informe ya reúne métodos por sesión; falta el resumen de parámetros del
   módulo al pie de cada figura (o al exportarla). Encaja con la tendencia
   «provenance como capa de UI». Esfuerzo: medio.
6. **STORMS en el informe** — del doc del 14 nov, sigue pendiente y el research
   lo reconfirma como quick win docente (checklist con filas que la app
   rellena sola y huecos explícitos para el autor). Esfuerzo: bajo.
7. **Output anotado educativo extendido** — el patrón JASP. Smart-175 ya lo
   tiene en QC (`explain`/`interpret`) y en el glosario con enlaces
   `seeIn`; extenderlo a las figuras centrales (cómo leer un PCoA, cómo leer
   un volcán) es contenido más que código. Esfuerzo: medio, i18n×5.
8. *(A decidir — toca arquitectura de estado)* **Enlace de estado por URL**
   (Ribbon): compartir una tanda qPCR o un plan de diseño por hash, sin
   backend. Valor docente (repartir ejercicio por enlace); el límite es el
   tamaño del hash con datos incluidos. Decidir después de la sesión
   exportable v2.

---

## 4. Qué NO copiar (visto en la competencia)

- Login obligatorio para calculadoras (IDT) o caducidad de sesión a 30 min
  (MicrobiomeAnalyst): son el argumento de venta de Smart-175.
- Paywall para exportar/publicar (BioRender) — veneno para estudiantes.
- Dashboards saturados de gráficos iguales sin jerarquía (FastQC clásico,
  Datagrok) — Smart-175 ya se apartó con el semáforo + comparativa.
- Scrollytelling/narrativa interactiva (Flourish) y lienzo de widgets (Orange):
  fuera del alcance de «figura para un TFG».
- IA generadora opaca: si algún día entra, como asistente con control
  («cada cambio sigue en tus manos», BioRender Leo/Flourish) y sin peticiones
  externas.

## 5. Dónde ya va por delante (para no gastar más ahí)

Ninguna de las revisadas tiene i18n real (todas solo inglés), ni tema oscuro
emparejado con sistema de diseño propio (solo MetaTree tiene un toggle
básico), ni módulos de laboratorio (colonias por foto, qPCR, primers, Sanger,
UFC/NMP — hueco de mercado real), ni edición de figuras por elementos con
exportación para revista, ni informe autocontenido imprimible salvo fastq.bio
(congelado, sin editor), ni arquitectura sin caducidad. Solo q2view y MetaTree
comparten el modelo sin servidor, y ninguno analiza.

---

## Fuentes

- MicrobiomeAnalyst: https://www.microbiomeanalyst.ca/ · changelog: https://www.microbiomeanalyst.ca/faces/docs/UpdateHistory.xhtml
- QIIME 2 View: https://view.qiime2.org/ · https://github.com/qiime2/q2view
- Qiita: https://qiita.ucsd.edu/ · EMPeror: https://github.com/biocore/emperor
- Mian: https://miandata.org/ · https://academic.oup.com/bioinformatics/article/38/4/1176/6426068
- MicrobiomeDB: https://microbiomedb.org/mbio/app/about
- MetaTree: https://byemaxx.github.io/MetaTree · https://doi.org/10.1186/s12859-026-06475-3
- Review comparativa 2026: https://www.frontiersin.org/journals/microbiology/articles/10.3389/fmicb.2025.1711000/full
- SnapGene: https://www.snapgene.com/updates · Benchling: https://www.benchling.com · Geneious: https://www.geneious.com/updates
- Directorio de visores de trazas (actualizado 15-nov-2026): https://www.nucleics.com/trace-viewer-reviews/ · Teal: https://gear-genomics.com/teal/
- IDT OligoAnalyzer: https://pages.idtdna.com/pages/tools/oligoanalyzer · NEB Tm: https://tmcalculator.neb.com
- Primer-BLAST: https://www.ncbi.nlm.nih.gov/tools/primer-blast/ · Primer3 web: https://primer3.org/webinterface.html
- fastq.bio: https://www.fastq.bio/ · qtqc: https://qtqc.evogeno.me · biowasm: https://biowasm.com
- Ribbon: https://ribbon.genomics.io
- Datawrapper: https://www.datawrapper.de/ · print export: https://www.datawrapper.de/print-export · dark mode: https://www.datawrapper.de/dark-mode
- Flourish: https://flourish.studio · BioRender: https://www.biorender.com · BioRender Graphing: https://www.biorender.com/product/graphing
- Observable Plot: https://observablehq.com/plot
- jamovi: https://www.jamovi.org · JASP: https://jasp-stats.org
- Prism: https://www.graphpad.com · Orange: https://orangedatamining.com
