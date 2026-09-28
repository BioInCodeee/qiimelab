#!/usr/bin/env bash
# =============================================================================
# 02_cutadapt.sh — recorta los primers de amplificación (región 16S V3-V4)
#
# Entrada:  demux_seqs.qza (salida del paso 01).
# Salida:   demux_trimmed.qza sin primers + demux_trimmed.qzv (cuántas lecturas
#           pasaron el filtro).
# Para qué: los primers no son diversidad biológica real; si no se quitan, DADA2
#           los toma como secuencia y mete ruido en la inferencia de ASVs.
#
# Plantilla educativa adaptada de un pipeline real. NO es un procedimiento
# soportado paso a paso: léela y ajústala a tus datos antes de ejecutarla.
# =============================================================================
set -e

# --- AJUSTA ESTO -----------------------------------------------------------
RUTA_BASE="<<CAMBIA_ESTO_POR_TU_CARPETA>>"   # carpeta raíz de tu análisis
NUM_HILOS=4                                  # ajusta según tu máquina

# Secuencia de los primers de amplificación, tal como los diseñó tu laboratorio,
# en notación IUPAC (N, W, H, V… = bases ambiguas). Cutadapt los busca y recorta.
# Si no los quitas, DADA2 los toma como variación biológica e infla el ruido.
FORWARD_PRIMER="CCTACGGGNGGCWGCAG"       # EJEMPLO — 341F (16S V3-V4). Cámbialo por tu primer forward
REVERSE_PRIMER="GACTACHVGGGTATCTAATCC"   # EJEMPLO — 805R (16S V3-V4). Cámbialo por tu primer reverse
# -------------------------------------------------------------------------
RES_DIR="${RUTA_BASE}/resultados"
LOG_DIR="${RUTA_BASE}/logs"

mkdir -p "${RES_DIR}" "${LOG_DIR}"
exec > >(tee -i "${LOG_DIR}/02_cutadapt.log")
exec 2>&1

echo "Cutadapt (recorte de primers): $(date)"

qiime cutadapt trim-paired \
  --i-demultiplexed-sequences "${RES_DIR}/demux_seqs.qza" \
  --p-front-f "${FORWARD_PRIMER}" \
  --p-front-r "${REVERSE_PRIMER}" \
  --p-match-adapter-wildcards \
  --p-match-read-wildcards \
  --p-cores "${NUM_HILOS}" \
  --o-trimmed-sequences "${RES_DIR}/demux_trimmed.qza"
# --p-match-*-wildcards : hace que las bases ambiguas (N, W…) del primer casen
#     con cualquier base de la lectura. Deja siempre activados si tus primers
#     tienen letras IUPAC (casi todos los de 16S/ITS las tienen).

qiime demux summarize \
  --i-data "${RES_DIR}/demux_trimmed.qza" \
  --o-visualization "${RES_DIR}/demux_trimmed.qzv"

echo "Hecho: ${RES_DIR}/demux_trimmed.qza"
echo "  · los .qzv se ven en https://view.qiime2.org o subiéndolos a Smart-175:"
echo "    https://lucadoktor.github.io/qiimelab/"
