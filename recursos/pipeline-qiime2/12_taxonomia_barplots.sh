#!/usr/bin/env bash
# =============================================================================
# 12_taxonomia_barplots.sh — barras de composición taxonómica + CSV por nivel
#
# Entrada:  table_final_filtered.qza + taxonomy.qza (pasos 05 y 08) + metadatos.
# Salida:   taxa-bar-plots.qzv (barras interactivas) y un CSV de abundancias
#           por cada nivel taxonómico (Filo ... Especie) en taxonomia_csv/.
# Para qué: los CSV te dejan hacer heatmaps, aluviales o barras a medida en
#           R / Python. El script 13 los limpia y normaliza.
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
exec > >(tee -i "${LOG_DIR}/12_taxonomia_barplots.log")
exec 2>&1

echo "Taxa bar plots: $(date)"

echo "-> Visualización interactiva..."
qiime taxa barplot \
  --i-table "${RES_DIR}/06_filtrado/table_final_filtered.qza" \
  --i-taxonomy "${RES_DIR}/05_taxonomia/taxonomy.qza" \
  --m-metadata-file "${METADATOS}" \
  --o-visualization "${RES_DIR}/05_taxonomia/taxa-bar-plots.qzv"

echo "-> Exportando CSV por nivel..."
TEMP_DIR="${RES_DIR}/05_taxonomia/taxa_bar_plot_data_temp"
FINAL_DIR="${RES_DIR}/10_datos_exportados/taxonomia_csv"
mkdir -p "${TEMP_DIR}" "${FINAL_DIR}"

qiime tools export \
  --input-path "${RES_DIR}/05_taxonomia/taxa-bar-plots.qzv" \
  --output-path "${TEMP_DIR}"

# level-2 = Filo ... level-7 = Especie
for nivel in 2 3 4 5 6 7; do
  if [ -f "${TEMP_DIR}/level-${nivel}.csv" ]; then
    case "${nivel}" in
      2) nombre="Filo" ;;
      3) nombre="Clase" ;;
      4) nombre="Orden" ;;
      5) nombre="Familia" ;;
      6) nombre="Genero" ;;
      7) nombre="Especie" ;;
    esac
    mv "${TEMP_DIR}/level-${nivel}.csv" "${FINAL_DIR}/Abundancia_${nombre}_Nivel${nivel}.csv"
    echo "   - ${FINAL_DIR}/Abundancia_${nombre}_Nivel${nivel}.csv"
  fi
done
rm -rf "${TEMP_DIR}"

echo "Hecho: CSV en ${FINAL_DIR}/"
echo "  · los .qzv se ven en https://view.qiime2.org o subiéndolos a Smart-175:"
echo "    https://bioincodeee.github.io/qiimelab/"
