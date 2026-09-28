#!/usr/bin/env bash
# =============================================================================
# 03_dada2_ITS.sh — denoising DADA2 para el marcador ITS (hongos)
#
# Entrada:  demux_trimmed.qza (salida de 02_cutadapt_ITS.sh).
# Salida:   table.qza, rep_seqs.qza, dada2_stats.qza/.qzv.
# Clave en ITS: NO se trunca a longitud fija (--p-trunc-len 0). El ITS tiene
#   longitud natural muy variable; truncar a un valor fijo descartaría taxones
#   con ITS largo. En su lugar se usa truncado dinámico por calidad
#   (--p-trunc-q) y el filtro de errores esperados (--p-max-ee).
#
# Plantilla educativa adaptada de un pipeline real. NO es un procedimiento
# soportado paso a paso: léela y ajústala a tus datos antes de ejecutarla.
# =============================================================================
set -e

# --- AJUSTA ESTO -----------------------------------------------------------
RUTA_BASE="<<CAMBIA_ESTO_POR_TU_CARPETA>>"   # carpeta raíz de tu análisis ITS
NUM_HILOS=4                                  # ajusta según tu máquina
METADATOS="${RUTA_BASE}/sample-metadata.tsv"

# Truncado dinámico: corta la lectura en la primera base con calidad Phred
# <= TRUNC_Q. En ITS NO se trunca a longitud fija (--p-trunc-len 0), así que
# este es el filtro de calidad de cola principal. 2 es el valor recomendado.
TRUNC_Q=2

# Errores esperados máximos por lectura (suma de probabilidades de error).
# 2 es el valor DADA2 por defecto; súbelo a 3-5 si retienes muy pocas lecturas.
MAX_EE_F=2
MAX_EE_R=2
# -------------------------------------------------------------------------
RES_DIR="${RUTA_BASE}/resultados"
LOG_DIR="${RUTA_BASE}/logs"

mkdir -p "${RES_DIR}/03_dada2" "${LOG_DIR}"

echo "DADA2 ITS (paired-end): $(date)"

qiime dada2 denoise-paired \
  --i-demultiplexed-seqs "${RES_DIR}/02_cutadapt/demux_trimmed.qza" \
  --p-trunc-len-f 0 \
  --p-trunc-len-r 0 \
  --p-trunc-q "${TRUNC_Q}" \
  --p-max-ee-f "${MAX_EE_F}" \
  --p-max-ee-r "${MAX_EE_R}" \
  --p-n-threads "${NUM_HILOS}" \
  --o-table "${RES_DIR}/03_dada2/table.qza" \
  --o-representative-sequences "${RES_DIR}/03_dada2/rep_seqs.qza" \
  --o-denoising-stats "${RES_DIR}/03_dada2/dada2_stats.qza" > "${LOG_DIR}/03_dada2_ITS.log" 2>&1

# --- Qué hace cada parámetro -------------------------------------------------
# --p-trunc-len-f 0 / -r 0 : recomendación oficial de DADA2 para ITS. Desactiva
#     el truncado a longitud fija para no mutilar taxones con ITS largo.
# --p-trunc-q       : truncado dinámico de rescate (ver TRUNC_Q).
# --p-max-ee-f / -r : "errores esperados" máximos por lectura (ver MAX_EE_*).
# --------------------------------------------------------------------------

qiime metadata tabulate \
  --m-input-file "${RES_DIR}/03_dada2/dada2_stats.qza" \
  --o-visualization "${RES_DIR}/03_dada2/dada2_stats.qzv" >> "${LOG_DIR}/03_dada2_ITS.log" 2>&1

qiime feature-table summarize \
  --i-table "${RES_DIR}/03_dada2/table.qza" \
  --m-sample-metadata-file "${METADATOS}" \
  --o-visualization "${RES_DIR}/03_dada2/table_summary.qzv" >> "${LOG_DIR}/03_dada2_ITS.log" 2>&1

echo "Hecho: revisa dada2_stats.qzv y table_summary.qzv"
echo "  · los .qzv se ven en https://view.qiime2.org o subiéndolos a Smart-175:"
echo "    https://bioincodeee.github.io/qiimelab/"
