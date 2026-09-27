// methodEquivalence.js — registro central de cuán equivalente es cada
// método de QiimeLab a la herramienta de referencia, y el aviso de UI que lo
// dice. Sustituye a los avisos ad hoc que había repartidos por los módulos
// ("inspirado en LEfSe…", "inspirado en RDA/CCA de R…"), para que el
// criterio sea el mismo en todas partes.
//
//   Nivel A — equivalente matemático validado: la misma fórmula cerrada que
//             la referencia, validada en tests/stats/ (no muestra aviso).
//   Nivel B — implementación propia validada frente a R: mismo método, pero
//             con decisiones de implementación propias (permutaciones,
//             descomposición, desempates); coincide con R en la suite de
//             tests, no necesariamente en cada decimal con otros datos.
//   Nivel C — inspirado/simplificado, NO equivalente: comparte la idea de
//             una herramienta conocida pero no la reproduce; sus números no
//             deben compararse con los de esa herramienta. Aviso visible
//             SIEMPRE que se muestra un resultado de este nivel.
//
// Los nombres de las herramientas no se traducen (términos del dominio).

import { t } from './i18n.js';
import { escapeHtml } from './dom.js';

/** id → { level, tool, where } ; `tool`/`where` solo para B y C. */
export const METHODS = Object.freeze({
  // Nivel A
  shannon: { level: 'A', tool: 'vegan::diversity' },
  simpson: { level: 'A', tool: 'vegan::diversity' },
  pearson: { level: 'A', tool: 'stats::cor' },
  spearman: { level: 'A', tool: 'stats::cor' },
  bh: { level: 'A', tool: 'stats::p.adjust("BH")' },
  'permanova-f': { level: 'A', tool: 'vegan::adonis2 (pseudo-F)' },
  // Nivel B
  permanova: { level: 'B', tool: 'vegan::adonis2', where: 'R' },
  rda: { level: 'B', tool: 'vegan::rda', where: 'R' },
  cca: { level: 'B', tool: 'vegan::cca', where: 'R' },
  upgma: { level: 'B', tool: 'stats::hclust(method = "average")', where: 'R' },
  nj: { level: 'B', tool: 'ape::nj', where: 'R' },
  // Nivel C
  'lefse-like': { level: 'C', tool: 'LEfSe', where: 'Galaxy/Python (Segata et al. 2011)' },
  'ancombc-like': { level: 'C', tool: 'ANCOM-BC', where: 'R/Bioconductor' },
  'rf-biomarkers': { level: 'C', tool: 'Random Forest (randomForest/Boruta)', where: 'R' },
  'msa-progressive': { level: 'C', tool: 'MAFFT/MUSCLE', where: null },
});

/** Nivel ('A'|'B'|'C') de un método, o null si no está registrado. */
export function methodLevel(id) {
  const m = METHODS[id];
  return m ? m.level : null;
}

/**
 * HTML del aviso de equivalencia de uno o varios métodos (p. ej. la vista
 * de consenso de biomarcadores junta tres). Nivel A → '' (sin aviso). Si hay
 * varios, se agrupan por nivel en un solo aviso.
 */
export function methodNoticeHtml(ids, { withA = false } = {}) {
  const list = (Array.isArray(ids) ? ids : [ids]).map((id) => [id, METHODS[id]]).filter(([, m]) => m);
  if (!list.length) return '';
  const byLevel = { A: [], B: [], C: [] };
  list.forEach(([, m]) => { if (!byLevel[m.level].some((x) => x.tool === m.tool)) byLevel[m.level].push(m); });
  const parts = [];
  if (byLevel.C.length) {
    const tools = byLevel.C.map((m) => m.tool).join(' · ');
    const where = [...new Set(byLevel.C.map((m) => m.where).filter(Boolean))].join(' · ');
    parts.push('<div class="ql-method-notice ql-method-c" role="note" data-method-level="C">'
      + '<strong>' + escapeHtml(t('equiv.levelCTitle')) + '</strong> '
      + escapeHtml(t(where ? 'equiv.levelCBody' : 'equiv.levelCBodyNoWhere', { tool: tools, where })) + '</div>');
  }
  if (byLevel.B.length) {
    const tools = byLevel.B.map((m) => m.tool).join(' · ');
    parts.push('<p class="ql-method-notice ql-method-b" role="note" data-method-level="B">'
      + '<strong>' + escapeHtml(t('equiv.levelBTitle')) + '</strong> '
      + escapeHtml(t('equiv.levelBBody', { tool: tools })) + '</p>');
  }
  if (withA && byLevel.A.length) {
    parts.push('<p class="ql-method-notice ql-method-a" data-method-level="A"><strong>'
      + escapeHtml(t('equiv.levelATitle')) + '</strong> '
      + escapeHtml(t('equiv.levelABody', { tool: byLevel.A.map((m) => m.tool).join(' · ') })) + '</p>');
  }
  return parts.join('');
}

/** Igual que methodNoticeHtml, pero como nodo (un <div> contenedor), o null. */
export function methodNotice(ids, opts) {
  const html = methodNoticeHtml(ids, opts);
  if (!html) return null;
  const wrap = document.createElement('div');
  wrap.className = 'ql-method-notices';
  wrap.innerHTML = html;
  return wrap;
}
