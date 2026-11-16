// Generador de un párrafo de "Métodos" por plantilla (NO es IA): toma los
// parámetros REALES de lo que hay en el estado (distancia elegida, métricas,
// columnas de grupo, nº de muestras…) y arma frases fijas. Va al principio del
// informe combinado, con un aviso de "revisar antes de publicar".
//
// Solo afirma lo que se puede leer del estado. Los umbrales que viven en el
// estado local de un módulo (log2FC, padj, submuestra de QC…) NO se conocen
// aquí: se nombran de forma genérica y el aviso cubre el resto.
//
// Todas las frases viven como claves i18n bajo `methods.*` (en los cinco
// diccionarios de js/i18n/): se redactan en el idioma activo de la interfaz.

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

/** t() atajo para las frases de esta plantilla. */
const M = (key, params) => t('methods.' + key, params);

/**
 * @param {Set<string>|string[]} selectedIds  ids de módulo incluidos en el informe
 * @returns {{ heading:string, disclaimer:string, paragraphs:string[] }}
 */
export function methodsText(selectedIds) {
  const sel = new Set(Array.isArray(selectedIds) ? selectedIds : [...(selectedIds || [])]);
  const P = [];
  const n = sampleCount();
  const gc = groupCols();
  const firstGroup = gc[0];
  const groupPhrase = firstGroup ? M('groupsOf', { col: firstGroup }) : M('groupsBare');

  // --- datos de partida ---
  {
    const bits = [];
    if (n != null) bits.push(M('bitSamples', { n }));
    if (state.metadata && gc.length) {
      bits.push(M('bitMetadata', { g: gc.length, list: gc.slice(0, 4).join(', ') + (gc.length > 4 ? '…' : '') }));
    }
    if (state.taxonomy) bits.push(M('bitTaxonomy'));
    if (bits.length) P.push(M('intro', { list: bits.join(', ') }));
  }

  // --- barplots ---
  if (sel.has('barplots') && state.taxaBarplot) {
    const levels = Object.keys(state.taxaBarplot.levels);
    P.push(M('barplots', {
      levels: levels.length ? M(levels.length > 1 ? 'levelTagN' : 'levelTag1', { levels: levels.join(', ') }) : '',
      group: firstGroup ? M('groupTag', { col: firstGroup }) : '',
    }));
  }

  // --- diversidad alfa ---
  if (sel.has('alfa') && (state.alphaDiversity || state.taxaCounts)) {
    const metrics = state.alphaDiversity ? Object.keys(state.alphaDiversity.metrics) : [];
    P.push(M('alfa', {
      metrics: metrics.length ? M('metricsTag', { metrics: metrics.join(', ') }) : '',
      groups: groupPhrase,
    }));
    if (state.taxaCounts) P.push(M('rarefy'));
  }

  // --- diversidad beta ---
  if (sel.has('beta') && (state.betaDiversity || state.ordination)) {
    const dist = state.betaDiversity ? Object.keys(state.betaDiversity.metrics) : [];
    const distName = dist.length ? dist.join(', ') : (state.ordination && state.ordination.metricName) || M('betaDistFallback');
    const bits = [];
    if (state.betaDiversity) bits.push(M('betaHeatmap'));
    if (state.ordination) bits.push(M('betaPcoa'));
    P.push(M('beta', {
      dist: distName,
      viz: bits.join(M('joinAnd')),
      perm: firstGroup ? M('betaPerm', { col: firstGroup }) : '',
    }));
  }

  // --- abundancia diferencial ---
  if (sel.has('diferencial') && state.differentialAbundance) {
    const isKO = state.differentialAbundance.entityType === 'ko';
    P.push(M('dif', { entity: M(isKO ? 'entityKO' : 'entityTaxa') }));
  }
  if (sel.has('diferencial') && Array.isArray(state.diffComparisons) && state.diffComparisons.length >= 2) {
    P.push(M('difOverlay', { n: state.diffComparisons.length }));
  }

  // --- recuentos microbianos ---
  if (sel.has('recuentos') && Array.isArray(state.microbialCounts) && state.microbialCounts.length) {
    const orgs = state.microbialCounts.length;
    P.push(M('recuentos', { orgs: M(orgs > 1 ? 'orgCountN' : 'orgCount1', { n: orgs }) }));
  }

  // --- venn / upset ---
  if (sel.has('venn') && state.taxaCounts && state.metadata) {
    P.push(M('venn', { group: firstGroup ? M('vennGroupTag', { col: firstGroup }) : '' }));
  }

  // --- correlograma ---
  if (sel.has('correlograma') && state.metadata) {
    P.push(M('correl'));
  }

  // --- funcional ---
  if (sel.has('funcional') && state.functionalKO && state.functionalCategories) {
    P.push(M('funcional', { groups: groupPhrase }));
  }

  // --- QC ---
  if (sel.has('qc') && Array.isArray(state.sequenceQC)) {
    const done = state.sequenceQC.filter((e) => e.report);
    if (done.length) {
      const anySub = done.some((e) => e.report.subsampled);
      P.push(M('qc', {
        files: M('fileCount', { n: done.length }),
        sub: M(anySub ? 'qcSub' : 'qcWhole'),
      }));
    }
  }

  // --- multiple-testing note (si hay algo que lo use) ---
  if (sel.has('diferencial') || (sel.has('alfa') && gc.length)) {
    P.push(M('bh'));
  }

  return {
    heading: t('informe.methodsHeading'),
    disclaimer: t('informe.methodsDisclaimer'),
    paragraphs: P,
  };
}
