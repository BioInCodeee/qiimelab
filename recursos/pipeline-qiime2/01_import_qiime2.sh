#!/usr/bin/env bash
# =============================================================================
# 01_import_qiime2.sh — importa los FASTQ crudos a un artefacto .qza de QIIME 2
#
# Entrada:  carpeta de .fastq.gz con nombres en formato Casava 1.8
#           (patron <muestra>_<S##>_<L###>_<R1|R2>_001.fastq.gz).
# Salida:   demux_seqs.qza (datos empaquetados) + demux_seqs.qzv (resumen visual).
# Para qué: QIIME 2 trabaja siempre sobre artefactos .qza para mantener la
#           trazabilidad (provenance) de todo el análisis.
#
# Plantilla educativa adaptada de un pipeline real. NO es un procedimiento
# soportado paso a paso: léela y ajústala a tus datos antes de ejecutarla.
# =============================================================================
set -e

# --- AJUSTA ESTO -----------------------------------------------------------
RUTA_BASE="<<CAMBIA_ESTO_POR_TU_CARPETA>>"   # carpeta raíz de tu análisis

# Tipo de datos: paired-end (2 archivos por muestra, R1 + R2) o single-end.
TIPO_DATOS="SampleData[PairedEndSequencesWithQuality]"   # o SampleData[SequencesWithQuality] para single-end

# Formato de entrada. "Casava 1.8" = archivos ya demultiplexados con nombres
# <muestra>_S##_L###_R1_001.fastq.gz. Si tus nombres NO siguen ese patrón, usa
# en su lugar un manifiesto: PairedEndFastqManifestPhred33V2 (o …Phred64… si
# tus FASTQ son antiguos) y pon en --input-path un TSV con las rutas.
FORMATO="CasavaOneEightSingleLanePerSampleDirFmt"
# -------------------------------------------------------------------------
DATA_DIR="${RUTA_BASE}/fastq"                # aquí van tus .fastq.gz
RES_DIR="${RUTA_BASE}/resultados"
LOG_DIR="${RUTA_BASE}/logs"

mkdir -p "${RES_DIR}" "${LOG_DIR}"
exec > >(tee -i "${LOG_DIR}/01_import_qiime2.log")
exec 2>&1

echo "Importación a QIIME 2: $(date)"

qiime tools import \
  --type "${TIPO_DATOS}" \
  --input-path "${DATA_DIR}" \
  --input-format "${FORMATO}" \
  --output-path "${RES_DIR}/demux_seqs.qza"

qiime demux summarize \
  --i-data "${RES_DIR}/demux_seqs.qza" \
  --o-visualization "${RES_DIR}/demux_seqs.qzv"

echo "Hecho: ${RES_DIR}/demux_seqs.qza"
echo "  · el .qzv se ve en https://view.qiime2.org o subiéndolo a Smart-175:"
echo "    https://lucadoktor.github.io/qiimelab/"
