#!/usr/bin/env bash
# =============================================================================
# 05_taxonomia.sh — asignación taxonómica de los ASVs
#
# Entrada:  rep_seqs.qza + table.qza (paso 03), un clasificador entrenado (.qza)
#           y tus metadatos (TSV con una fila #q2:types).
# Salida:   taxonomy.qza/.qzv (identidad de cada ASV) + table_summary.qzv.
# Para qué: pone nombre biológico a cada ASV. Con un clasificador entrenado a la
#           longitud de TU amplicón la resolución a nivel de género mejora mucho.
#
# El clasificador NO se incluye aquí. Descárgate uno oficial pre-entrenado de
#   https://docs.qiime2.org  ("Data resources" -> Naive Bayes classifiers,
#   SILVA / Greengenes2), o entrena el tuyo con el plugin RESCRIPT.
#
# Plantilla educativa adaptada de un pipeline real. NO es un procedimiento
# soportado paso a paso: léela y ajústala a tus datos antes de ejecutarla.
# =============================================================================
set -e

# --- AJUSTA ESTO -----------------------------------------------------------
RUTA_BASE="<<CAMBIA_ESTO_POR_TU_CARPETA>>"        # carpeta raíz de tu análisis
NUM_HILOS=4                                       # ajusta según tu máquina
CLASIFICADOR="${RUTA_BASE}/tu-clasificador-entrenado.qza"
METADATOS="${RUTA_BASE}/sample-metadata.tsv"
# -------------------------------------------------------------------------
RES_DIR="${RUTA_BASE}/resultados"
LOG_DIR="${RUTA_BASE}/logs"

mkdir -p "${RES_DIR}/05_taxonomia" "${LOG_DIR}"
exec > >(tee -i "${LOG_DIR}/05_taxonomia.log")
exec 2>&1

echo "Clasificación taxonómica: $(date)"

if [ ! -f "${CLASIFICADOR}" ]; then
    echo "ERROR: no encuentro el clasificador en ${CLASIFICADOR}"
    echo "Descarga uno de https://docs.qiime2.org (Data resources) y ajusta la ruta."
    exit 1
fi

qiime feature-classifier classify-sklearn \
  --i-classifier "${CLASIFICADOR}" \
  --i-reads "${RES_DIR}/03_dada2/rep_seqs.qza" \
  --p-n-jobs "${NUM_HILOS}" \
  --o-classification "${RES_DIR}/05_taxonomia/taxonomy.qza"

qiime metadata tabulate \
  --m-input-file "${RES_DIR}/05_taxonomia/taxonomy.qza" \
  --o-visualization "${RES_DIR}/05_taxonomia/taxonomy.qzv"

qiime feature-table summarize \
  --i-table "${RES_DIR}/03_dada2/table.qza" \
  --o-visualization "${RES_DIR}/03_dada2/table_summary.qzv" \
  --m-sample-metadata-file "${METADATOS}"

echo "Hecho: taxonomy.qzv (asignaciones) + table_summary.qzv (lecturas por muestra)"
echo "  · los .qzv se ven en https://view.qiime2.org o subiéndolos a Smart-175:"
echo "    https://bioincodeee.github.io/qiimelab/"
