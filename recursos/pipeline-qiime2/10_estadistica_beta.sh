#!/usr/bin/env bash
# =============================================================================
# 10_estadistica_beta.sh — significancia estadística de la diversidad beta
#
# Entrada:  una matriz de distancia (p. ej. bray_curtis.qza) + metadatos con
#           la columna de grupo que quieres contrastar.
# Salida:   permanova_*.qzv (¿los grupos tienen composición distinta?) y
#           permdisp_*.qzv (¿la dispersión dentro de cada grupo es homogénea?
#           — supuesto que hay que comprobar para interpretar bien PERMANOVA).
#
# Plantilla educativa adaptada de un pipeline real. NO es un procedimiento
# soportado paso a paso: léela y ajústala a tus datos antes de ejecutarla.
# =============================================================================
set -e

# --- AJUSTA ESTO -----------------------------------------------------------
RUTA_BASE="<<CAMBIA_ESTO_POR_TU_CARPETA>>"   # carpeta raíz de tu análisis
METADATOS="${RUTA_BASE}/sample-metadata.tsv"

# Columna de tus metadatos con el factor cuyo efecto quieres contrastar
# (tratamiento, sitio, tiempo…). Tiene que existir en el TSV de metadatos.
COLUMNA_GRUPO="grupo"       # EJEMPLO — cámbialo por el nombre real de tu columna

# Matriz de distancia sobre la que hacer el test (nombre de archivo, sin .qza).
# bray_curtis capta cambios de abundancia; jaccard, de presencia/ausencia;
# *_unifrac tienen además en cuenta el parentesco filogenético.
METRICA="bray_curtis"      # EJEMPLO

# Nº de permutaciones del test. 999 da p-valores con 3 decimales y es el
# estándar para explorar; sube a 9999 para la cifra final de un paper.
PERMUTACIONES=999
# -------------------------------------------------------------------------
RES_DIR="${RUTA_BASE}/resultados"
LOG_DIR="${RUTA_BASE}/logs"
DIST="${RES_DIR}/08_diversidad/beta/${METRICA}.qza"

mkdir -p "${RES_DIR}/09_estadistica" "${LOG_DIR}"
exec > >(tee -i "${LOG_DIR}/10_estadistica_beta.log")
exec 2>&1

echo "Estadística de diversidad beta: $(date)"

echo "-> PERMANOVA (${COLUMNA_GRUPO})..."
qiime diversity beta-group-significance \
  --i-distance-matrix "${DIST}" \
  --m-metadata-file "${METADATOS}" \
  --m-metadata-column "${COLUMNA_GRUPO}" \
  --p-method permanova \
  --p-permutations "${PERMUTACIONES}" \
  --o-visualization "${RES_DIR}/09_estadistica/permanova_${METRICA}.qzv"

echo "-> PERMDISP (${COLUMNA_GRUPO})..."
qiime diversity beta-group-significance \
  --i-distance-matrix "${DIST}" \
  --m-metadata-file "${METADATOS}" \
  --m-metadata-column "${COLUMNA_GRUPO}" \
  --p-method permdisp \
  --p-permutations "${PERMUTACIONES}" \
  --o-visualization "${RES_DIR}/09_estadistica/permdisp_${METRICA}.qzv"

echo "Hecho: resultados en ${RES_DIR}/09_estadistica/"
echo "  · los .qzv se ven en https://view.qiime2.org o subiéndolos a Smart-175:"
echo "    https://bioincodeee.github.io/qiimelab/"
