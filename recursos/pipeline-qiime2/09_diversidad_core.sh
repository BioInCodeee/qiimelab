#!/usr/bin/env bash
# =============================================================================
# 09_diversidad_core.sh — diversidad alfa y beta, paso a paso
#
# Entrada:  table_final_filtered.qza + rooted_tree.qza (paso 08) + metadatos.
# Salida:   tabla rarefizada, curva de rarefacción, vectores de diversidad alfa
#           (Shannon, Observed Features), matrices de distancia beta
#           (Bray-Curtis, Jaccard, UniFrac) y sus PCoA + gráficos Emperor.
# Para qué: hace lo mismo que `qiime diversity core-metrics-phylogenetic` pero
#           desglosado, para ver y controlar cada métrica por separado.
#
# La PROFUNDIDAD_RAREFACCION la eliges tú a partir de table_summary.qzv
# (paso 06/08): un valor que no descarte demasiadas muestras y donde la curva
# de rarefacción (alpha_rarefaction.qzv) ya esté aplanada.
#
# Plantilla educativa adaptada de un pipeline real. NO es un procedimiento
# soportado paso a paso: léela y ajústala a tus datos antes de ejecutarla.
# =============================================================================
set -e
set -o pipefail

# --- AJUSTA ESTO -----------------------------------------------------------
RUTA_BASE="<<CAMBIA_ESTO_POR_TU_CARPETA>>"          # carpeta raíz de tu análisis
METADATOS="${RUTA_BASE}/sample-metadata.tsv"

# Lecturas a las que se submuestrea cada muestra (rarefacción). Elígela en
# table_summary.qzv (paso 06/08): lo más alta posible SIN descartar muestras
# que te interesen, y donde la curva de rarefacción (alpha_rarefaction.qzv) ya
# esté plana. Es el único parámetro sin valor por defecto: tienes que ponerlo.
PROFUNDIDAD_RAREFACCION="<<CAMBIA_ESTO>>"           # EJEMPLO — p. ej. 10000

# Métricas a calcular. Estas son el conjunto estándar de core-metrics.
# Alfa: shannon (estructura/equitatividad), observed_features (riqueza).
# Beta no filogenética: braycurtis (cuantitativa), jaccard (presencia/ausencia).
# Beta filogenética (UniFrac): necesita el árbol del paso 08.
METRICAS_ALFA=(shannon observed_features)
METRICAS_BETA=(bray_curtis jaccard)                     # no filogenéticas
METRICAS_UNIFRAC=(unweighted_unifrac weighted_unifrac)  # filogenéticas
# -------------------------------------------------------------------------
RES_DIR="${RUTA_BASE}/resultados"
LOG_DIR="${RUTA_BASE}/logs"

# El id de métrica de QIIME 2 no lleva guion bajo ("braycurtis"); el resto
# coincide con el nombre de archivo que usamos.
metric_id() { case "$1" in bray_curtis) echo braycurtis ;; *) echo "$1" ;; esac; }

# UniFrac puede dar problemas de multihilo en algunos equipos; forzar 1 hilo
# es lo más seguro y solo cuesta algo de tiempo.
export OMP_NUM_THREADS=1
export UNIFRAC_THREADS=1

mkdir -p "${RES_DIR}/08_diversidad/alpha" "${RES_DIR}/08_diversidad/beta" \
         "${RES_DIR}/08_diversidad/pcoa" "${LOG_DIR}"
exec > >(tee -i "${LOG_DIR}/09_diversidad_core.log")
exec 2>&1

echo "Diversidad (alfa + beta): $(date)"

echo "-> 1. Rarefacción a ${PROFUNDIDAD_RAREFACCION} lecturas/muestra..."
qiime feature-table rarefy \
  --i-table "${RES_DIR}/06_filtrado/table_final_filtered.qza" \
  --p-sampling-depth "${PROFUNDIDAD_RAREFACCION}" \
  --o-rarefied-table "${RES_DIR}/08_diversidad/rarefied_table.qza"

echo "-> 2. Curva de rarefacción..."
qiime diversity alpha-rarefaction \
  --i-table "${RES_DIR}/06_filtrado/table_final_filtered.qza" \
  --i-phylogeny "${RES_DIR}/07_filogenia/rooted_tree.qza" \
  --p-max-depth "${PROFUNDIDAD_RAREFACCION}" \
  --m-metadata-file "${METADATOS}" \
  --o-visualization "${RES_DIR}/08_diversidad/alpha_rarefaction.qzv"

echo "-> 3. Diversidad alfa (Shannon = equitatividad, Observed = riqueza)..."
for m in "${METRICAS_ALFA[@]}"; do
  qiime diversity alpha \
    --i-table "${RES_DIR}/08_diversidad/rarefied_table.qza" \
    --p-metric "${m}" \
    --o-alpha-diversity "${RES_DIR}/08_diversidad/alpha/${m}.qza"
done

echo "-> 4. Diversidad beta no filogenética..."
for m in "${METRICAS_BETA[@]}"; do
  qiime diversity beta \
    --i-table "${RES_DIR}/08_diversidad/rarefied_table.qza" \
    --p-metric "$(metric_id "${m}")" \
    --o-distance-matrix "${RES_DIR}/08_diversidad/beta/${m}.qza"
done

echo "-> 5. Diversidad beta filogenética (UniFrac, 1 hilo)..."
for m in "${METRICAS_UNIFRAC[@]}"; do
  qiime diversity beta-phylogenetic \
    --i-table "${RES_DIR}/08_diversidad/rarefied_table.qza" \
    --i-phylogeny "${RES_DIR}/07_filogenia/rooted_tree.qza" \
    --p-metric "${m}" \
    --p-threads 1 \
    --o-distance-matrix "${RES_DIR}/08_diversidad/beta/${m}.qza"
done

echo "-> 6. PCoA + gráficos Emperor..."
for m in "${METRICAS_BETA[@]}" "${METRICAS_UNIFRAC[@]}"; do
  qiime diversity pcoa \
    --i-distance-matrix "${RES_DIR}/08_diversidad/beta/${m}.qza" \
    --o-pcoa "${RES_DIR}/08_diversidad/pcoa/${m}_pcoa.qza"
  qiime emperor plot \
    --i-pcoa "${RES_DIR}/08_diversidad/pcoa/${m}_pcoa.qza" \
    --m-metadata-file "${METADATOS}" \
    --o-visualization "${RES_DIR}/08_diversidad/pcoa/${m}_emperor.qzv"
done

echo "Hecho: resultados en ${RES_DIR}/08_diversidad/"
echo "  · los .qzv se ven en https://view.qiime2.org o subiéndolos a Smart-175:"
echo "    https://bioincodeee.github.io/qiimelab/"
