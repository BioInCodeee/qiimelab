# Recursos

Plantillas de scripts **educativas**, adaptadas de un pipeline de metabarcoding
real. Sirven para entender el flujo de trabajo y como punto de partida — **no
son un procedimiento soportado paso a paso**. Léelas y ajústalas a tus datos
antes de ejecutar nada.

Todas las rutas están como `<<CAMBIA_ESTO_POR_TU_CARPETA>>`, el número de hilos
como `NUM_HILOS=4`, y cualquier valor que dependa del dataset (primers,
truncados, umbrales de filtrado, profundidad de rarefacción, columna de grupo,
métricas…) es una variable comentada al principio del script con `# EJEMPLO`.

Los artefactos `.qzv` que generan estos scripts se pueden ver en
[view.qiime2.org](https://view.qiime2.org) **o subiéndolos directamente a
Smart-175** ([bioincodeee.github.io/qiimelab](https://bioincodeee.github.io/qiimelab/))
para visualizarlos sin salir del navegador.

## `pipeline-qiime2/`

Flujo típico de amplicones 16S en QIIME 2, de FASTQ crudos a tablas y figuras,
más dos pasos específicos de ITS (hongos).

| Archivo | Qué hace |
|---|---|
| `00_qc_initial.sh` | Control de calidad de los FASTQ (FastQC + MultiQC) |
| `01_import_qiime2.sh` | Importa los FASTQ a un artefacto `.qza` |
| `02_cutadapt.sh` | Recorta los primers de amplificación (16S V3-V4) |
| `03_dada2.sh` | Denoising DADA2 → tabla de ASVs + secuencias representativas |
| `04_evaluar_longitud_ASVs.sh` | Mide la longitud de los ASVs (para elegir clasificador) |
| `05_taxonomia.sh` | Asignación taxonómica con un clasificador entrenado |
| `06_resumen_tabla.sh` | Resumen de la tabla cruzada con metadatos (elegir rarefacción) |
| `07_estadisticas_taxonomia.py` | Audita el % de ASVs asignados por nivel taxonómico |
| `08_filtrado_y_filogenia.sh` | Filtra cloroplasto/mitocondria/rarezas + árbol MAFFT/FastTree |
| `09_diversidad_core.sh` | Diversidad alfa y beta paso a paso (Shannon, Bray-Curtis, UniFrac, PCoA) |
| `09b_pcoa_emperor.sh` | Solo el PCoA + Emperor de Bray-Curtis / Jaccard |
| `09c_exportar_pcoa.sh` | Exporta las coordenadas del PCoA a `ordination.txt` |
| `10_estadistica_beta.sh` | PERMANOVA + PERMDISP sobre una matriz de distancia |
| `11_exportar_datos_brutos.sh` | Extrae los números de los `.qza`/`.qzv` a `.tsv` |
| `12_taxonomia_barplots.sh` | Barras taxonómicas + CSV de abundancias por nivel |
| `13_normalizar_taxonomia.py` | Limpia y normaliza esos CSV (Top-N + "Others", % por grupo) |
| `02_cutadapt_ITS.sh` | Cutadapt para ITS (maneja el read-through de ITS cortos) |
| `03_dada2_ITS.sh` | DADA2 para ITS (sin truncado a longitud fija) |

## `r-analisis/`

| Archivo | Qué hace |
|---|---|
| `correlograma.R` | Correlograma con `corrplot` (elipses + significancia + coeficientes) |
| `parse_qiime_ordination.R` | Lee un `ordination.txt` de QIIME 2 a un `data.frame` de coordenadas |
