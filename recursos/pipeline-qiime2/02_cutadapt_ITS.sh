#!/usr/bin/env bash
# =============================================================================
# 02_cutadapt_ITS.sh — recorte de primers para el marcador ITS (hongos)
#
# Entrada:  demux_seqs.qza (import de tus FASTQ ITS, paso equivalente al 01).
# Salida:   demux_trimmed.qza sin primers + demux_trimmed.qzv.
# Por qué ITS es distinto de 16S: el ITS tiene longitud MUY variable entre
#   especies. En hongos con ITS corto el secuenciador "lee de largo" y aparece
#   el primer del otro extremo dentro de la lectura (read-through). Por eso
#   además del primer al inicio (--p-front) se recorta su reverso-complementario
#   al final (--p-adapter).
#
# Plantilla educativa adaptada de un pipeline real. NO es un procedimiento
# soportado paso a paso: léela y ajústala a tus datos antes de ejecutarla.
# =============================================================================
set -e

# --- AJUSTA ESTO -----------------------------------------------------------
RUTA_BASE="<<CAMBIA_ESTO_POR_TU_CARPETA>>"   # carpeta raíz de tu análisis ITS
NUM_HILOS=4                                  # ajusta según tu máquina

# Primers de tu librería y sus reverso-complementarios (para el read-through).
# Puedes calcular el RC con: echo "PRIMER" | rev | tr ACGTacgt TGCAtgca
PRIMER_F="CTTGGTCATTTAGAGGAAGTAA"     # EJEMPLO — ITS1f (forward)
PRIMER_R="GCTGCGTTCTTCATCGATGC"       # EJEMPLO — ITS2  (reverse)
PRIMER_F_RC="TTACTTCCTCTAAATGACCAAG"  # EJEMPLO — reverso-complementario de ITS1f
PRIMER_R_RC="GCATCGATGAAGAACGCAGC"    # EJEMPLO — reverso-complementario de ITS2

# Longitud mínima (pb) que debe quedar tras recortar; lo más corto se descarta.
# 50 elimina dímeros de primer y ruido sin tocar ITS reales (el ITS más corto
# ronda las 140-200 pb). No lo bajes de ~20.
LONGITUD_MINIMA=50
# -------------------------------------------------------------------------
RES_DIR="${RUTA_BASE}/resultados"
LOG_DIR="${RUTA_BASE}/logs"

mkdir -p "${RES_DIR}/02_cutadapt" "${LOG_DIR}"

echo "Cutadapt ITS (paired-end): $(date)"

qiime cutadapt trim-paired \
  --i-demultiplexed-sequences "${RES_DIR}/01_importacion/demux_seqs.qza" \
  --p-front-f "${PRIMER_F}" \
  --p-adapter-f "${PRIMER_R_RC}" \
  --p-front-r "${PRIMER_R}" \
  --p-adapter-r "${PRIMER_F_RC}" \
  --p-match-adapter-wildcards \
  --p-discard-untrimmed \
  --p-minimum-length "${LONGITUD_MINIMA}" \
  --p-cores "${NUM_HILOS}" \
  --o-trimmed-sequences "${RES_DIR}/02_cutadapt/demux_trimmed.qza" \
  --verbose > "${LOG_DIR}/02_cutadapt_ITS.log" 2>&1

# --- Qué hace cada parámetro -------------------------------------------------
# --p-front-f / --p-front-r  : recorta el primer anclado al inicio (5') de R1 / R2.
# --p-adapter-f / --p-adapter-r : recorta el reverso-complementario del otro
#     primer si aparece al final (3') por read-through en ITS corto.
# --p-match-adapter-wildcards : interpreta bases IUPAC (N, R, Y...) de los primers.
# --p-discard-untrimmed : si no encuentra el primer principal, descarta la lectura
#     (evita que entre ruido ambiental a DADA2).
# --p-minimum-length : descarta lo que quede demasiado corto tras recortar
#     (dímeros de primer, ruido); si no, DADA2 puede fallar. Ver LONGITUD_MINIMA.
# --------------------------------------------------------------------------

qiime demux summarize \
  --i-data "${RES_DIR}/02_cutadapt/demux_trimmed.qza" \
  --o-visualization "${RES_DIR}/02_cutadapt/demux_trimmed.qzv" >> "${LOG_DIR}/02_cutadapt_ITS.log" 2>&1

echo "Hecho: ${RES_DIR}/02_cutadapt/demux_trimmed.qza"
echo "  · los .qzv se ven en https://view.qiime2.org o subiéndolos a Smart-175:"
echo "    https://lucadoktor.github.io/qiimelab/"
