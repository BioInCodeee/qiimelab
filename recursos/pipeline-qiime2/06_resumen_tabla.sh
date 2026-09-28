#!/usr/bin/env bash
# =============================================================================
# 06_resumen_tabla.sh — resumen de la tabla de ASVs cruzada con los metadatos
#
# Entrada:  table.qza (paso 03) + tus metadatos (TSV).
# Salida:   table_summary.qzv, con cuántas secuencias limpias tiene cada muestra.
# Para qué: es el archivo con el que decides la profundidad de rarefacción
#           (sampling depth) para los análisis de diversidad de los pasos 09-10.
#
# Plantilla educativa adaptada de un pipeline real. NO es un procedimiento
# soportado paso a paso: léela y ajústala a tus datos antes de ejecutarla.
# =============================================================================
set -e

# --- AJUSTA ESTO -----------------------------------------------------------
RUTA_BASE="<<CAMBIA_ESTO_POR_TU_CARPETA>>"   # carpeta raíz de tu análisis
METADATOS="${RUTA_BASE}/sample-metadata.tsv"
# -------------------------------------------------------------------------
RES_DIR="${RUTA_BASE}/resultados"
LOG_DIR="${RUTA_BASE}/logs"

mkdir -p "${LOG_DIR}"
exec > >(tee -i "${LOG_DIR}/06_resumen_tabla.log")
exec 2>&1

echo "Resumen de la tabla de ASVs: $(date)"

qiime feature-table summarize \
  --i-table "${RES_DIR}/03_dada2/table.qza" \
  --o-visualization "${RES_DIR}/03_dada2/table_summary.qzv" \
  --m-sample-metadata-file "${METADATOS}"

echo "Hecho: abre table_summary.qzv y anota la profundidad mínima aceptable."
echo "  · los .qzv se ven en https://view.qiime2.org o subiéndolos a Smart-175:"
echo "    https://lucadoktor.github.io/qiimelab/"
