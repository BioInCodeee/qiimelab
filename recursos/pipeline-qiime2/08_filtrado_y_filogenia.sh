#!/usr/bin/env bash
# =============================================================================
# 08_filtrado_y_filogenia.sh — limpia la tabla y construye el árbol filogenético
#
# Entrada:  table.qza + rep_seqs.qza + taxonomy.qza (pasos 03 y 05).
# Salida:   table_final_filtered.qza (sin cloroplastos/mitocondrias/eucariotas y
#           sin ASVs muy raros) + rooted_tree.qza (para métricas UniFrac).
# Para qué: 1) esos taxones no son microbiota bacteriana; 2) filtrar singletons
#           y artefactos de PCR baja el ruido y estabiliza los modelos
#           estadísticos posteriores; 3) UniFrac necesita una filogenia.
#
# Plantilla educativa adaptada de un pipeline real. NO es un procedimiento
# soportado paso a paso: léela y ajústala a tus datos antes de ejecutarla.
# =============================================================================
set -e

# --- AJUSTA ESTO -----------------------------------------------------------
RUTA_BASE="<<CAMBIA_ESTO_POR_TU_CARPETA>>"   # carpeta raíz de tu análisis
NUM_HILOS=4                                  # ajusta según tu máquina
METADATOS="${RUTA_BASE}/sample-metadata.tsv"

# Taxones a excluir de la tabla. Para 16S se quitan cloroplastos, mitocondrias
# (ADN de plantas/hospedador) y eucariotas. OJO: para ITS (hongos) NO pongas
# "eukaryota" aquí — borrarías toda tu diana. Ajústalo a tu marcador.
TAXONES_EXCLUIR="mitochondria,chloroplast,eukaryota"   # EJEMPLO — válido para 16S

# Filtro de ASVs raros. Un ASV se conserva si aparece >= MIN_FREQ veces EN TOTAL
# y en >= MIN_SAMPLES muestras. Sirve para quitar singletons y errores de PCR
# que DADA2 no pilló, sin sacrificar taxones reales. 10 / 2 es conservador y
# suele quitar mucho ASV sin apenas perder lecturas; súbelo si tienes ruido,
# bájalo (p. ej. 1 / 1 = sin filtro) si tu comunidad es de baja diversidad.
MIN_FREQ=10       # EJEMPLO — frecuencia total mínima de un ASV
MIN_SAMPLES=2     # EJEMPLO — nº mínimo de muestras en las que debe aparecer
# -------------------------------------------------------------------------
RES_DIR="${RUTA_BASE}/resultados"
LOG_DIR="${RUTA_BASE}/logs"

mkdir -p "${RES_DIR}/06_filtrado" "${RES_DIR}/07_filogenia" "${LOG_DIR}"
exec > >(tee -i "${LOG_DIR}/08_filtrado_y_filogenia.log")
exec 2>&1

echo "Filtrado y filogenia: $(date)"

echo "-> Excluyendo taxones: ${TAXONES_EXCLUIR} ..."
qiime taxa filter-table \
  --i-table "${RES_DIR}/03_dada2/table.qza" \
  --i-taxonomy "${RES_DIR}/05_taxonomia/taxonomy.qza" \
  --p-exclude "${TAXONES_EXCLUIR}" \
  --o-filtered-table "${RES_DIR}/06_filtrado/table_taxa_filtered.qza"

qiime taxa filter-seqs \
  --i-sequences "${RES_DIR}/03_dada2/rep_seqs.qza" \
  --i-taxonomy "${RES_DIR}/05_taxonomia/taxonomy.qza" \
  --p-exclude "${TAXONES_EXCLUIR}" \
  --o-filtered-sequences "${RES_DIR}/06_filtrado/rep_seqs_taxa_filtered.qza"

echo "-> Filtrando ASVs raros (freq < ${MIN_FREQ}, presentes en < ${MIN_SAMPLES} muestras)..."
qiime feature-table filter-features \
  --i-table "${RES_DIR}/06_filtrado/table_taxa_filtered.qza" \
  --p-min-frequency "${MIN_FREQ}" \
  --p-min-samples "${MIN_SAMPLES}" \
  --o-filtered-table "${RES_DIR}/06_filtrado/table_final_filtered.qza"

qiime feature-table filter-seqs \
  --i-data "${RES_DIR}/06_filtrado/rep_seqs_taxa_filtered.qza" \
  --i-table "${RES_DIR}/06_filtrado/table_final_filtered.qza" \
  --o-filtered-data "${RES_DIR}/06_filtrado/rep_seqs_final_filtered.qza"

qiime feature-table summarize \
  --i-table "${RES_DIR}/06_filtrado/table_final_filtered.qza" \
  --o-visualization "${RES_DIR}/06_filtrado/table_final_filtered_summary.qzv" \
  --m-sample-metadata-file "${METADATOS}"

echo "-> Árbol filogenético (MAFFT + FastTree)..."
qiime phylogeny align-to-tree-mafft-fasttree \
  --i-sequences "${RES_DIR}/06_filtrado/rep_seqs_final_filtered.qza" \
  --p-n-threads "${NUM_HILOS}" \
  --o-alignment "${RES_DIR}/07_filogenia/aligned_rep_seqs.qza" \
  --o-masked-alignment "${RES_DIR}/07_filogenia/masked_aligned_rep_seqs.qza" \
  --o-tree "${RES_DIR}/07_filogenia/unrooted_tree.qza" \
  --o-rooted-tree "${RES_DIR}/07_filogenia/rooted_tree.qza"

echo "Hecho: revisa table_final_filtered_summary.qzv para elegir la rarefacción."
echo "  · los .qzv se ven en https://view.qiime2.org o subiéndolos a Smart-175:"
echo "    https://bioincodeee.github.io/qiimelab/"
