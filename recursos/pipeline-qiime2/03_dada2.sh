#!/usr/bin/env bash
# =============================================================================
# 03_dada2.sh — denoising, filtrado, unión de pares y quimeras (DADA2)
#
# Entrada:  demux_trimmed.qza (salida del paso 02, sin primers).
# Salida:   table.qza (tabla de ASVs), rep_seqs.qza (secuencias representativas),
#           dada2_stats.qza/.qzv (cuántas lecturas sobreviven en cada etapa).
# Para qué: DADA2 modela el error del secuenciador para inferir variantes reales
#           (ASVs) a resolución de un nucleótido.
#
# Plantilla educativa adaptada de un pipeline real. NO es un procedimiento
# soportado paso a paso: léela y ajústala a tus datos antes de ejecutarla.
# =============================================================================
set -e

# --- AJUSTA ESTO -----------------------------------------------------------
RUTA_BASE="<<CAMBIA_ESTO_POR_TU_CARPETA>>"   # carpeta raíz de tu análisis
NUM_HILOS=4                                  # ajusta según tu máquina

# Posición (pb) a la que se recorta cada lectura por su extremo 3'. Sácala de
# demux_trimmed.qzv (paso 02): corta donde la caja de calidad baja de ~Q25-30.
# Restricción: TRUNC_F + TRUNC_R menos la longitud del amplicón debe dejar
# >= 12 pb (idealmente >= 20) de solapamiento para que el merge funcione.
TRUNC_F=270          # EJEMPLO — para 16S V3-V4 (~465 pb) con lecturas 2x300 de buena calidad
TRUNC_R=250          # EJEMPLO — el reverse suele caer antes de calidad, se recorta más

# Errores esperados máximos por lectura (suma de probabilidades de error). Si
# se supera, la lectura se descarta antes del modelo. 2 es el valor DADA2 por
# defecto y funciona bien; súbelo a 3-5 si retienes muy pocas lecturas.
MAX_EE_F=2
MAX_EE_R=2

# Bases a cortar por el extremo 5' (inicio). Déjalo en 0 salvo que el paso 02
# no haya quitado del todo los primers o veas ruido en las primeras bases.
TRIM_LEFT_F=0
TRIM_LEFT_R=0
# -------------------------------------------------------------------------
RES_DIR="${RUTA_BASE}/resultados"
LOG_DIR="${RUTA_BASE}/logs"

mkdir -p "${RES_DIR}/03_dada2" "${LOG_DIR}"
exec > >(tee -i "${LOG_DIR}/03_dada2.log")
exec 2>&1

echo "DADA2 (denoising): $(date)"

qiime dada2 denoise-paired \
  --i-demultiplexed-seqs "${RES_DIR}/demux_trimmed.qza" \
  --p-trunc-len-f "${TRUNC_F}" \
  --p-trunc-len-r "${TRUNC_R}" \
  --p-trim-left-f "${TRIM_LEFT_F}" \
  --p-trim-left-r "${TRIM_LEFT_R}" \
  --p-max-ee-f "${MAX_EE_F}" \
  --p-max-ee-r "${MAX_EE_R}" \
  --p-n-threads "${NUM_HILOS}" \
  --o-representative-sequences "${RES_DIR}/03_dada2/rep_seqs.qza" \
  --o-table "${RES_DIR}/03_dada2/table.qza" \
  --o-denoising-stats "${RES_DIR}/03_dada2/dada2_stats.qza"

qiime metadata tabulate \
  --m-input-file "${RES_DIR}/03_dada2/dada2_stats.qza" \
  --o-visualization "${RES_DIR}/03_dada2/dada2_stats.qzv"

echo "Hecho: revisa dada2_stats.qzv — necesitas retener suficientes lecturas por muestra"
echo "  · los .qzv se ven en https://view.qiime2.org o subiéndolos a Smart-175:"
echo "    https://lucadoktor.github.io/qiimelab/"
