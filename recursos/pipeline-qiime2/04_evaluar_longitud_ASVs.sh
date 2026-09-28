#!/usr/bin/env bash
# =============================================================================
# 04_evaluar_longitud_ASVs.sh — mide la longitud de tus ASVs
#
# Entrada:  rep_seqs.qza (salida del paso 03).
# Salida:   rep_seqs_summary.qzv, con la distribución de longitudes.
# Para qué: conocer la longitud real (media/mediana) de tus ASVs te permite
#           elegir un clasificador taxonómico entrenado a esa medida exacta,
#           que da mejor resolución (sobre todo a nivel de género) que uno
#           genérico. Para 16S V3-V4 sin primers suele rondar ~400-430 pb.
#
# Plantilla educativa adaptada de un pipeline real. NO es un procedimiento
# soportado paso a paso: léela y ajústala a tus datos antes de ejecutarla.
# =============================================================================
set -e

# --- AJUSTA ESTO -----------------------------------------------------------
RUTA_BASE="<<CAMBIA_ESTO_POR_TU_CARPETA>>"   # carpeta raíz de tu análisis
# -------------------------------------------------------------------------
RES_DIR="${RUTA_BASE}/resultados"
LOG_DIR="${RUTA_BASE}/logs"

mkdir -p "${LOG_DIR}"
exec > >(tee -i "${LOG_DIR}/04_evaluar_longitud_ASVs.log")
exec 2>&1

echo "Longitud de secuencias representativas: $(date)"

qiime feature-table tabulate-seqs \
  --i-data "${RES_DIR}/03_dada2/rep_seqs.qza" \
  --o-visualization "${RES_DIR}/03_dada2/rep_seqs_summary.qzv"

echo "Hecho: abre rep_seqs_summary.qzv y mira la tabla de estadísticas de"
echo "longitud para decidir tu clasificador."
echo "  · el .qzv se ve en https://view.qiime2.org o subiéndolo a Smart-175:"
echo "    https://bioincodeee.github.io/qiimelab/"
