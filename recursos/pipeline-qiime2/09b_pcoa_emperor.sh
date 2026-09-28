#!/usr/bin/env bash
# =============================================================================
# 09b_pcoa_emperor.sh — solo el PCoA + Emperor de las matrices no filogenéticas
#
# Entrada:  matrices de distancia beta ya calculadas (bray_curtis.qza,
#           jaccard.qza) + metadatos.
# Salida:   *_pcoa.qza (coordenadas) + *_emperor.qzv (visor 3D interactivo).
# Para qué: repetir solo esta parte si UniFrac falló pero Bray-Curtis/Jaccard
#           se calcularon bien, o si cambias los metadatos y quieres re-colorear.
#
# Plantilla educativa adaptada de un pipeline real. NO es un procedimiento
# soportado paso a paso: léela y ajústala a tus datos antes de ejecutarla.
# =============================================================================
set -e

# --- AJUSTA ESTO -----------------------------------------------------------
RUTA_BASE="<<CAMBIA_ESTO_POR_TU_CARPETA>>"   # carpeta raíz de tu análisis
METADATOS="${RUTA_BASE}/sample-metadata.tsv"
# Matrices de distancia (por nombre de archivo, sin .qza) sobre las que hacer
# el PCoA. Deben existir en resultados/08_diversidad/beta/ (paso 09).
METRICAS=(bray_curtis jaccard)
# -------------------------------------------------------------------------
BETA_DIR="${RUTA_BASE}/resultados/08_diversidad"

mkdir -p "${BETA_DIR}/pcoa"

for metric in "${METRICAS[@]}"; do
  qiime diversity pcoa \
    --i-distance-matrix "${BETA_DIR}/beta/${metric}.qza" \
    --o-pcoa "${BETA_DIR}/pcoa/${metric}_pcoa.qza"
  qiime emperor plot \
    --i-pcoa "${BETA_DIR}/pcoa/${metric}_pcoa.qza" \
    --m-metadata-file "${METADATOS}" \
    --o-visualization "${BETA_DIR}/pcoa/${metric}_emperor.qzv"
done

echo "Hecho: PCoA + Emperor en ${BETA_DIR}/pcoa/"
echo "  · los .qzv (Emperor) se ven en https://view.qiime2.org o subiéndolos a"
echo "    Smart-175: https://lucadoktor.github.io/qiimelab/"
