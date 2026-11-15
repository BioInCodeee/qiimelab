// Generador de un párrafo de "Métodos" por plantilla (NO es IA): toma los
// parámetros REALES de lo que hay en el estado (distancia elegida, métricas,
// columnas de grupo, nº de muestras…) y arma frases fijas. Va al principio del
// informe combinado, con un aviso de "revisar antes de publicar".
//
// Solo afirma lo que se puede leer del estado. Los umbrales que viven en el
// estado local de un módulo (log2FC, padj, submuestra de QC…) NO se conocen
// aquí: se nombran de forma genérica y el aviso cubre el resto.

import { state } from '../state.js';
import { t, getLang } from './i18n.js';

function sampleCount() {
  if (state.metadata && Array.isArray(state.metadata.rows)) return state.metadata.rows.length;
  if (state.betaDiversity) {
    const m = Object.values(state.betaDiversity.metrics)[0];
    if (m && m.sampleIds) return m.sampleIds.length;
  }
  return null;
}

function groupCols() {
  if (!state.metadata) return [];
  return state.metadata.headers.filter((h) => h !== state.metadata.sampleIdKey);
}

const L = () => (getLang() === 'en' ? 'en' : 'es');

/**
 * @param {Set<string>|string[]} selectedIds  ids de módulo incluidos en el informe
 * @returns {{ heading:string, disclaimer:string, paragraphs:string[] }}
 */
export function methodsText(selectedIds) {
  const sel = new Set(Array.isArray(selectedIds) ? selectedIds : [...(selectedIds || [])]);
  const en = L() === 'en';
  const P = [];
  const n = sampleCount();
  const gc = groupCols();
  const firstGroup = gc[0];

  // --- datos de partida ---
  {
    const bits = [];
    if (n != null) bits.push(en ? `${n} samples` : `${n} muestras`);
    if (state.metadata && gc.length) {
      bits.push(en
        ? `metadata with ${gc.length} variable(s) (${gc.slice(0, 4).join(', ')}${gc.length > 4 ? '…' : ''})`
        : `metadatos con ${gc.length} variable(s) (${gc.slice(0, 4).join(', ')}${gc.length > 4 ? '…' : ''})`);
    }
    if (state.taxonomy) bits.push(en ? 'a taxonomy assignment table' : 'una tabla de asignación taxonómica');
    if (bits.length) {
      P.push(en
        ? `Analyses were run in Smart-175 (browser-only, no server) on ${bits.join(', ')}.`
        : `Los análisis se hicieron en Smart-175 (solo en el navegador, sin servidor) sobre ${bits.join(', ')}.`);
    }
  }

  // --- barplots ---
  if (sel.has('barplots') && state.taxaBarplot) {
    const levels = Object.keys(state.taxaBarplot.levels);
    P.push(en
      ? `Taxonomic composition is shown as stacked relative-abundance barplots${levels.length ? ` (level${levels.length > 1 ? 's' : ''} ${levels.join(', ')})` : ''}, with the least abundant taxa collapsed into an "Other" category${firstGroup ? `; samples can be grouped by ${firstGroup}` : ''}.`
      : `La composición taxonómica se muestra como barplots apilados de abundancia relativa${levels.length ? ` (nivel${levels.length > 1 ? 'es' : ''} ${levels.join(', ')})` : ''}, agrupando los taxones menos abundantes en «Otros»${firstGroup ? `; las muestras se pueden agrupar por ${firstGroup}` : ''}.`);
  }

  // --- diversidad alfa ---
  if (sel.has('alfa') && (state.alphaDiversity || state.taxaCounts)) {
    const metrics = state.alphaDiversity ? Object.keys(state.alphaDiversity.metrics) : [];
    P.push(en
      ? `Within-sample (alpha) diversity${metrics.length ? ` (${metrics.join(', ')})` : ''} was compared between ${firstGroup ? `groups of ${firstGroup}` : 'groups'} with the non-parametric Kruskal-Wallis test.`
      : `La diversidad intramuestral (alfa)${metrics.length ? ` (${metrics.join(', ')})` : ''} se comparó entre ${firstGroup ? `grupos de ${firstGroup}` : 'grupos'} con el test no paramétrico de Kruskal-Wallis.`);
    if (state.taxaCounts) {
      P.push(en
        ? 'Rarefaction curves (analytic expectation, Hurlbert 1971; no random resampling) were computed from the count table.'
        : 'Las curvas de rarefacción (esperanza analítica de Hurlbert 1971, sin remuestreo aleatorio) se calcularon a partir de la tabla de conteos.');
    }
  }

  // --- diversidad beta ---
  if (sel.has('beta') && (state.betaDiversity || state.ordination)) {
    const dist = state.betaDiversity ? Object.keys(state.betaDiversity.metrics) : [];
    const distName = dist.length ? dist.join(', ') : (state.ordination && state.ordination.metricName) || (en ? 'a supplied distance matrix' : 'una matriz de distancias aportada');
    const bits = [];
    if (state.betaDiversity) bits.push(en ? 'a heatmap ordered by UPGMA hierarchical clustering' : 'un mapa de calor ordenado por clustering jerárquico UPGMA');
    if (state.ordination) bits.push(en ? 'principal coordinates analysis (PCoA)' : 'un análisis de coordenadas principales (PCoA)');
    P.push(en
      ? `Between-sample (beta) diversity used ${distName} distances, visualised with ${bits.join(' and ')}.${firstGroup ? ` Group separation was tested with one-factor PERMANOVA (permutation of group labels; equivalent to vegan::adonis2) on the ${firstGroup} factor, and homogeneity of multivariate dispersions with PERMDISP (distance to the group centroid; equivalent to vegan::betadisper with type = "centroid") on the same factor.` : ''}`
      : `La diversidad entre muestras (beta) usó distancias ${distName}, representadas con ${bits.join(' y ')}.${firstGroup ? ` La separación entre grupos se contrastó con una PERMANOVA de un factor (permutación de las etiquetas de grupo; equivalente a vegan::adonis2) sobre ${firstGroup}, y la homogeneidad de las dispersiones multivariantes con PERMDISP (distancia al centroide del grupo; equivalente a vegan::betadisper con type = "centroid") sobre el mismo factor.` : ''}`);
  }

  // --- abundancia diferencial ---
  if (sel.has('diferencial') && state.differentialAbundance) {
    const isKO = state.differentialAbundance.entityType === 'ko';
    P.push(en
      ? `Differential abundance of ${isKO ? 'KEGG orthologs' : 'taxa'} was taken from a pre-computed table (DESeq2/ANCOM-BC-style: identifier, log2 fold-change, adjusted p-value). Smart-175 does not re-run the test; features were flagged using the log2 fold-change and adjusted-p thresholds set in the module.`
      : `La abundancia diferencial de ${isKO ? 'ortólogos KEGG' : 'taxones'} se tomó de una tabla precalculada (estilo DESeq2/ANCOM-BC: identificador, log2 fold-change, p-valor ajustado). Smart-175 no re-ejecuta el test; las entidades se marcaron con los umbrales de log2 fold-change y p ajustado fijados en el módulo.`);
  }
  if (sel.has('diferencial') && Array.isArray(state.diffComparisons) && state.diffComparisons.length >= 2) {
    P.push(en
      ? `${state.diffComparisons.length} comparisons were overlaid to count features significant in several of them.`
      : `Se superpusieron ${state.diffComparisons.length} comparaciones para contar las entidades significativas en varias de ellas.`);
  }

  // --- recuentos microbianos ---
  if (sel.has('recuentos') && Array.isArray(state.microbialCounts) && state.microbialCounts.length) {
    const orgs = state.microbialCounts.length;
    P.push(en
      ? `Microbial counts (${orgs} organism${orgs > 1 ? 's' : ''}) were averaged per experimental group in log10 space, shown as bars with ± standard-deviation (or ± standard-error) error bars.`
      : `Los recuentos microbianos (${orgs} organismo${orgs > 1 ? 's' : ''}) se promediaron por grupo experimental en escala log10, representados como barras con barra de error ± desviación típica (o ± error estándar).`);
  }

  // --- venn / upset ---
  if (sel.has('venn') && state.taxaCounts && state.metadata) {
    P.push(en
      ? `Shared and exclusive taxa between groups${firstGroup ? ` of ${firstGroup}` : ''} were derived from the count table (presence = count > 0) and shown as a Venn diagram (≤ 4 groups) or an UpSet plot (5+).`
      : `Los taxones compartidos y exclusivos entre grupos${firstGroup ? ` de ${firstGroup}` : ''} se derivaron de la tabla de conteos (presencia = conteo > 0) y se muestran como diagrama de Venn (≤ 4 grupos) o gráfico UpSet (5+).`);
  }

  // --- correlograma ---
  if (sel.has('correlograma') && state.metadata) {
    P.push(en
      ? 'Pairwise Pearson (or Spearman) correlations between the numeric variables loaded (metadata columns, top-N taxon relative abundances, alpha metrics) were shown as a correlogram and a co-occurrence network.'
      : 'Las correlaciones de Pearson (o Spearman) por pares entre las variables numéricas cargadas (columnas de metadatos, abundancia relativa de los taxones top-N, métricas alfa) se muestran como correlograma y como red de co-ocurrencia.');
  }

  // --- funcional ---
  if (sel.has('funcional') && state.functionalKO && state.functionalCategories) {
    P.push(en
      ? `Functional module scores were computed from the PICRUSt2 KO table (each sample relativised by its total KO abundance, then the module's KOs summed) and compared between ${firstGroup ? `groups of ${firstGroup}` : 'groups'} with Kruskal-Wallis.`
      : `Las puntuaciones de módulo funcional se calcularon a partir de la tabla de KOs de PICRUSt2 (cada muestra relativizada por su abundancia total de KOs y luego sumados los KOs del módulo) y se compararon entre ${firstGroup ? `grupos de ${firstGroup}` : 'grupos'} con Kruskal-Wallis.`);
  }

  // --- QC ---
  if (sel.has('qc') && Array.isArray(state.sequenceQC)) {
    const done = state.sequenceQC.filter((e) => e.report);
    if (done.length) {
      const anySub = done.some((e) => e.report.subsampled);
      P.push(en
        ? `Raw-read quality of ${done.length} FASTQ file(s) was assessed with a FastQC-style report computed in-browser${anySub ? ' on a subsample of the first reads of each file' : ' on the whole file'} (per-position Phred quality, base composition, %GC, duplication, adapter content). This is descriptive QC and does not replace DADA2/QIIME 2 filtering.`
        : `La calidad de las lecturas crudas de ${done.length} archivo(s) FASTQ se evaluó con un informe estilo FastQC calculado en el navegador${anySub ? ' sobre una submuestra de las primeras lecturas de cada archivo' : ' sobre el archivo completo'} (calidad Phred por posición, composición de bases, %GC, duplicación, adaptadores). Es un QC descriptivo y no sustituye al filtrado de DADA2/QIIME 2.`);
    }
  }

  // --- multiple-testing note (si hay algo que lo use) ---
  if (sel.has('diferencial') || (sel.has('alfa') && gc.length)) {
    P.push(en
      ? 'Where many tests were run at once, p-values were adjusted for the false discovery rate (Benjamini-Hochberg).'
      : 'Cuando se hicieron muchos tests a la vez, los p-valores se ajustaron por la tasa de falsos descubrimientos (Benjamini-Hochberg).');
  }

  return {
    heading: t('informe.methodsHeading'),
    disclaimer: t('informe.methodsDisclaimer'),
    paragraphs: P,
  };
}
