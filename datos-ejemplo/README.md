# Datos de ejemplo

Recorte pequeño y curado de resultados **reales** de un estudio de microbioma
**16S** con varios grupos de tratamiento (A–N) y una fase de validación, 3
réplicas por grupo (42 muestras). Los nombres de grupo, de muestra y de las
variables del diseño están **anonimizados** — se ve la estructura exacta
(grupos, réplicas, variables categóricas), no de qué va el estudio.

Casi todo sale de un pipeline QIIME2 + DESeq2 + PICRUSt2 **ya ejecutado**
(la excepción es el par FASTQ de `qc/`, para el módulo de control de calidad).
Sirve para dos cosas:

1. Probar cada módulo sin tener datos propios (botón **"Cargar ejemplo real"**).
2. Ver **la estructura exacta** que debe tener tu propio archivo antes de subirlo.

Puedes arrastrar cualquiera de estos archivos a la pantalla **Cargar datos**
igual que harías con los tuyos.

| Archivo | Qué es | De qué paso sale |
|---|---|---|
| `metadatos/sample-metadata.tsv` | Metadatos de las 42 muestras: `sample-id`, `fase`, `variable_1`…`variable_4` (factores del diseño), `tiempo_dias`, `replicate`, `grupo`. 1ª fila = cabecera; 2ª fila `#q2:types` la ignora Smart-175 automáticamente. | Archivo de metadatos de QIIME2, el que se pasa a `qiime diversity core-metrics`. |
| `taxonomia/taxonomy.tsv` | Asignación taxonómica por ASV: `Feature ID`, `Taxon` (`d__;p__;…;g__`), `Confidence`. Recortado a 2.500 ASVs y a nivel de género para que pese poco; tu archivo real tendrá todos los ASVs y puede llegar a especie. | `qiime feature-classifier classify-sklearn` → `taxonomy.qza`, exportado a TSV. Clasificador SILVA 138 V3–V4. |
| `barplot/genero_abundancia_relativa_TOP14.csv` | Abundancia relativa (%) por muestra a nivel de **género**: muestras en filas, los 14 géneros más abundantes como columnas (nombre corto: `Lactobacillus`, `Clostridium_sensu_stricto_1`…), columna `Others` con el resto agregado y `grupo` con el grupo. | Tabla `collapse` de QIIME2 a nivel 6, limpiada y reducida a top-14 en R. |
| `venn/genero_conteos_absolutos.csv` | Conteos **absolutos** por género: taxones en filas, muestras en columnas (`taxon`, `A-1`, `A-2`, …). Todos los géneros, sin top-N ni "Others" — es el formato correcto para presencia/ausencia (Venn, UpSet, PERMANOVA). | Tabla `collapse` de QIIME2 a nivel 6 sin normalizar, exportada a CSV. |
| `diversidad-alfa/shannon.tsv` | Índice de Shannon (equitatividad) por muestra. Dos columnas: id de muestra + `shannon_entropy`. | `qiime diversity core-metrics` → `shannon_vector.qza`, exportado a TSV. |
| `diversidad-alfa/observed_features.tsv` | Riqueza (nº de ASVs observados) por muestra. Mismo formato que Shannon. | `qiime diversity core-metrics` → `observed_features_vector.qza`, exportado. |
| `diversidad-beta/bray_curtis.qza` | Matriz de distancias Bray-Curtis entre las 42 muestras. **Se sube tal cual** — Smart-175 abre el `.qza` en el navegador; por dentro es un TSV plano (`distance-matrix.tsv`). | `qiime diversity core-metrics` → `bray_curtis_distance_matrix.qza`. |
| `abundancia-diferencial/DESeq2_D_vs_Control.csv` | Abundancia diferencial (DESeq2) del **Grupo D** frente al Control, a nivel de género. Columnas: `Genus, baseMean, log2FoldChange, lfcSE, stat, pvalue, padj, Significancia, neg_log10_padj`. | Script DESeq2 sobre la tabla de conteos por género. |
| `abundancia-diferencial/DESeq2_N_vs_Control.csv` | Igual, para el **Grupo N** vs Control. | idem. |
| `abundancia-diferencial/DESeq2_D_vs_N.csv` | **Grupo D vs Grupo N** (dos tratamientos entre sí, no contra el control). | idem. |
| `funcional-picrust2/KOlist.csv` | 53 KOs (ortólogos KEGG) agrupados en **módulos funcionales** (`Lactic acid fermentation`, `Urea metabolism`, `Proteolysis`…). Columnas: `Functional Module, KO, Gene, Enzyme, EC Number, …`. | Lista curada a mano (bioquímica estándar de KEGG). |
| `funcional-picrust2/KO_pred_metagenome_unstrat.tsv.gz` | Abundancia predicha de **cada KO en cada muestra** (metagenoma inferido). `function` (= KO) en filas, muestras en columnas. Viene en **gzip suelto** (`.tsv.gz`) — Smart-175 lo descomprime en el navegador. | PICRUSt2 → `KO_metagenome_out/pred_metagenome_unstrat.tsv.gz` (versión **unstrat**, resumen ya agregado). |
| `pcoa/bray_curtis_ordination.txt` | Coordenadas PCoA ya calculadas (formato "Ordination Results" de scikit-bio): secciones `Eigvals`, `Proportion explained`, `Site`. | `qiime diversity pcoa` → `bray_curtis_pcoa.qza`, exportado a `ordination.txt`. |
| `qc/muestra_ejemplo_R1.fastq.gz`<br>`qc/muestra_ejemplo_R2.fastq.gz` | Par de lecturas FASTQ 16S (submuestra de 3.000 lecturas de 301 nt, R1 + R2) para el módulo de control de calidad. Se conservan secuencia y calidad tal cual (fragmentos del gen 16S rRNA), pero la cabecera es **totalmente sintética** (`@SIM-#####/1`): nada del instrumento, run, celda de flujo ni índices reales. | Recorte de un `.fastq.gz` real recién salido del secuenciador (antes de cutadapt/DADA2). |
| `primers/referencia_ejemplo.fasta`<br>`primers/taxonomia_ejemplo.tsv` | 8 secuencias **100 % sintéticas** (relleno aleatorio con semilla fija) para el módulo de primers: 3 llevan los sitios de 515F/806R exactos, 1 lleva un mismatch no crítico en 515F, 1 lleva un mismatch en el propio extremo 3' de 806R, 1 no tiene el sitio de 806R, 1 tiene 2 mismatches en 515F (uno en el 3'), y 1 no tiene ningún sitio. La taxonomía (`Feature ID`, `Taxon`) usa géneros reales de ejemplo sobre esa secuencia inventada, solo para poder probar la cobertura agrupada por taxón. | Generado con un script determinista (semilla fija) a partir de los propios 515F/806R, verificado con la propia librería de búsqueda de sitios — no sale de ningún estudio, real ni ajeno. |
| `primers/gen_ejemplo.fasta` | 1 secuencia **100 % sintética** (819 pb) para la pestaña "Diseño" del módulo de primers: lleva 515F/806R reales embebidos cerca (producto ~129 pb, dentro del rango de qPCR) y un primer sintético limpio embebido lejos (producto ~749 pb, solo lo acepta PCR estándar) — para que el ejemplo demuestre la diferencia de tamaño de amplicón entre los dos modos, no solo un caso corto. | Mismo generador determinista que el de arriba; verificado ejecutando el propio diseñador contra la secuencia antes de guardarla (`tests/primerdesign.mjs` usa esta misma secuencia). |
| `phylo/secuencias_ejemplo.fasta` | 16 secuencias **100 % sintéticas** (160 pb, semilla fija) de tipo 16S para el módulo de árbol filogenético: 4 "clados" de 4 secuencias con una subestructura (2,2) real dentro de cada uno (no un reparto al azar de 4 hermanas — eso no deja ninguna señal real que Neighbor-Joining pueda recuperar de forma fiable, se comprobó a mano antes de generarlo así). Los nombres son géneros bacterianos reales usados solo por realismo pedagógico, igual que en `primers/taxonomia_ejemplo.tsv` — la secuencia en sí no es la de ningún género real. | Generador determinista (semilla fija) que muta un ancestro raíz al azar; verificado ejecutando el propio pipeline (alineamiento progresivo + NJ) antes de guardarlo: las 4 familias de género salen monofiléticas y la distancia mínima entre clados (0,24) es muy superior a la máxima dentro de un clado (0,15). |
| `sanger/B13-27F.ab1`<br>`sanger/B13-1492R.ab1`<br>`sanger/B1-27F.ab1`<br>`sanger/B1-1492R.ab1` | Cromatogramas Sanger **reales** (16S, primers 27F/1492R) para el módulo `#/sanger`: B13 es un par limpio (solapamiento alto, identidad ~100 %); B1 es el caso que no tiene overlap real posible con este amplicón y que un alineador local sin ancla fusionaba mal — aquí queda marcado como pendiente de revisión manual. Los códigos de muestra son anónimos (sin nombres ni metadatos identificables). Cada `.ab1` es una reconstrucción MÍNIMA: se conservan la traza de los 4 canales, la secuencia llamada, la calidad Phred y las posiciones de pico — TODOS los demás campos del formato ABIF (nombre de operador, de instrumento, de contenedor/placa…) se han quitado, porque el archivo original los trae y pueden contener nombres reales de laboratorio. Ver `sanger/README.md`. | Cromatograma real de un secuenciador Sanger, reconstruido a un ABIF mínimo con un script que vive fuera de este repositorio (mismo principio que el resto de esta carpeta: solo se publica el resultado ya limpio). |

## Estructura de los grupos

42 muestras = 14 grupos × 3 réplicas. Los ids de muestra son `<letra>-<réplica>`
(`A-1`, `A-2`, `A-3`, `B-1`, …, `N-3`); la letra coincide con el grupo.

| Grupo | `fase` | Réplicas |
|---|---|---|
| `Control` | `basal` | A-1 … A-3 |
| `Grupo B` … `Grupo E` | `validacion` | B-1 … E-3 |
| `Grupo F` … `Grupo G` | `ensayo_1` | F-1 … G-3 |
| `Grupo H` … `Grupo J` | `ensayo_2` | H-1 … J-3 |
| `Grupo K` … `Grupo M` | `ensayo_3` | K-1 … M-3 |
| `Grupo N` | `ensayo_4` | N-1 … N-3 |

`variable_1`…`variable_4` son factores categóricos del diseño (`si`/`no` o
`nivel_0`/`nivel_1`/`nivel_2`) — sirven para probar el "agrupar por" de cada
módulo con distintos números de grupos.

---

*Los datos de ejemplo se generan con un script fuera de este repositorio a
partir de resultados reales, aplicando la anonimización de nombres. Lo único
que se publica es esta carpeta ya anonimizada.*
