// Módulo de Inferencia Funcional Taxonómica (FAPROTAX / Custom Dictionaries)
// Predice perfiles funcionales y ciclos biogeoquímicos a partir de linajes 16S/ITS
// sin dependencias externas.

import { state, subscribe } from '../state.js';
import { t, getLang } from '../lib/i18n.js';
import { DEFAULT_FAPROTAX, FAPROTAX_METADATA, FUNCTION_NAMES } from '../lib/faprotax.js';
import { DEFAULT_PHENOTYPES, PHENOTYPES_METADATA, PHENOTYPE_NAMES } from '../lib/phenotypes.js';
import { groupTaxaByAbundance, OTHER_COLOR } from './taxaBarplot.js';
import { makeGroupResolver } from '../lib/sampleMatch.js';
import { loadRealCommunityData, mountExampleButtons } from '../lib/exampleData.js';
import { attachChartEditor, getFigureOptions } from '../lib/chartEditor.js';
import { chartTypeField } from '../lib/chartTypeSelector.js';
import { groupColor, CAT_VARS } from '../lib/groupBoxplot.js';
import { svgEl, escapeHtml, delegateHover, plotClip } from '../lib/dom.js';
import { orderCategories } from '../lib/categoryOrder.js';

// Colores de serie: la paleta categórica de la app (--cat-N, la misma que usan
// barplots/alfa/beta...) en vez de los hex fijos de antes, para que el editor
// pueda recolorear cada serie (sección Paleta de Personalizar). Las series
// comparten hueco cada CAT_VARS.length, igual que en taxaBarplot.js.
function getSeriesColor(index, isOther = false) {
  if (isOther) return OTHER_COLOR;
  return 'var(' + CAT_VARS[index % CAT_VARS.length] + ')';
}
/** Atributo que enlaza un elemento con su hueco de paleta editable. */
function seriesTag(index, isOther = false) {
  return isOther ? {} : { 'data-ce-series-fill': 's' + (index % CAT_VARS.length) };
}
/** paletteSeries para attachChartEditor: un hueco por color realmente usado
 *  (`series` en el MISMO orden que los índices con los que se pintó). */
function paletteSeriesFor(series) {
  const seen = new Set();
  const out = [];
  series.forEach((sObj, i) => {
    if (!sObj || sObj.isOther) return;
    const slot = i % CAT_VARS.length;
    if (seen.has(slot)) return;
    seen.add(slot);
    out.push({ id: 's' + slot, label: formatFunctionName(sObj.key, getLang()) });
  });
  return out;
}

/**
 * Normaliza y construye un índice de búsqueda rápida para cualquier base de datos funcional.
 * Soporta formatos:
 *  1. { [functionName]: [taxon1, taxon2, ...] } (estándar FAPROTAX)
 *  2. { [taxonName]: [func1, func2, ...] }
 *  3. { groups: { ... } } o { functions: { ... } } o { taxa: { ... } }
 *  4. Array de [{ taxon, functions: [...] }] o [{ function, taxa: [...] }]
 *
 * @param {Object|Array} db - Diccionario de funciones
 * @returns {{
 *   rawExact: Map<string, Set<string>>,
 *   rawLower: Map<string, Set<string>>,
 *   tokenExact: Map<string, Set<string>>,
 *   tokenClean: Map<string, Set<string>>,
 *   allFunctions: Set<string>
 * }}
 */
export function buildDatabaseIndex(db) {
  const rawExact = new Map();
  const rawLower = new Map();
  const tokenExact = new Map();
  const tokenClean = new Map();
  const allFunctions = new Set();

  if (!db || typeof db !== 'object') {
    return { rawExact, rawLower, tokenExact, tokenClean, allFunctions };
  }

  function addMapping(taxon, fnName) {
    if (!taxon || !fnName) return;
    const tStr = String(taxon).trim();
    const fStr = String(fnName).trim();
    if (!tStr || !fStr) return;

    allFunctions.add(fStr);

    // Exact
    if (!rawExact.has(tStr)) rawExact.set(tStr, new Set());
    rawExact.get(tStr).add(fStr);

    const tLower = tStr.toLowerCase();
    if (!rawLower.has(tLower)) rawLower.set(tLower, new Set());
    rawLower.get(tLower).add(fStr);

    // Token exacto (ej. g__Pseudomonas o Pseudomonas)
    if (!tokenExact.has(tLower)) tokenExact.set(tLower, new Set());
    tokenExact.get(tLower).add(fStr);

    // Token limpio sin prefijo taxonómico (ej. 'pseudomonas')
    const cleaned = tLower.replace(/^[a-z]__/i, '').trim();
    if (cleaned) {
      if (!tokenClean.has(cleaned)) tokenClean.set(cleaned, new Set());
      tokenClean.get(cleaned).add(fStr);
    }
  }

  // Detectar formato del objeto
  let source = db;
  if (db.groups && typeof db.groups === 'object') source = db.groups;
  else if (db.functions && typeof db.functions === 'object') source = db.functions;
  else if (db.pathways && typeof db.pathways === 'object') source = db.pathways;
  else if (db.taxa && typeof db.taxa === 'object') source = db.taxa;
  else if (db.traits && typeof db.traits === 'object') source = db.traits;

  function traverse(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        if (item.taxon && Array.isArray(item.functions)) {
          item.functions.forEach((f) => addMapping(item.taxon, f));
        } else if (item.function && Array.isArray(item.taxa)) {
          item.taxa.forEach((t) => addMapping(t, item.function));
        } else if (item.taxon && Array.isArray(item.traits)) {
          item.traits.forEach((t) => addMapping(item.taxon, t));
        } else if (item.trait && Array.isArray(item.taxa)) {
          item.taxa.forEach((t) => addMapping(t, item.trait));
        }
      });
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        // Puede ser key = función y value = [taxones], o key = taxón y value = [funciones]
        const firstVal = String(value[0] || '');
        const keyLooksLikeTaxon = /^[a-z]__|;/i.test(key);
        const valLooksLikeTaxon = /^[a-z]__|;/i.test(firstVal);

        if (keyLooksLikeTaxon && !valLooksLikeTaxon) {
          // key = taxón, value = [funciones]
          value.forEach((fn) => addMapping(key, fn));
        } else {
          // por defecto: key = función, value = [taxones]
          value.forEach((tax) => addMapping(tax, key));
        }
      } else if (typeof value === 'string') {
        addMapping(value, key);
      } else if (value && typeof value === 'object') {
        // Objeto anidado (categoría fenotípica ej. gram_stain -> { gram_positive: [...] })
        traverse(value);
      }
    }
  }

  traverse(source);

  return { rawExact, rawLower, tokenExact, tokenClean, allFunctions };
}

/**
 * Encuentra las funciones metabólicas asociadas a un linaje taxonómico según el índice de la base de datos.
 * Aplica reglas estrictas de concordancia:
 *  - Coincidencia exacta de la cadena completa de linaje
 *  - Coincidencia exacta por rango taxonómico (token de género, especie, familia, etc.)
 *
 * @param {string} taxonName - Nombre o linaje del taxón (ej. "k__Bacteria;...;g__Pseudomonas")
 * @param {Object} dbIndex - Índice construido por buildDatabaseIndex
 * @returns {Set<string>} Conjunto de funciones asociadas
 */
export function findFunctionsForTaxon(taxonName, dbIndex) {
  const result = new Set();
  if (!taxonName || !dbIndex) return result;

  const raw = String(taxonName).trim();
  const rawLower = raw.toLowerCase();

  // 1. Coincidencia directa completa
  if (dbIndex.rawExact.has(raw)) {
    dbIndex.rawExact.get(raw).forEach((f) => result.add(f));
  }
  if (dbIndex.rawLower.has(rawLower)) {
    dbIndex.rawLower.get(rawLower).forEach((f) => result.add(f));
  }

  // 2. Partición estricta de linaje por rangos delimitados por ';'
  const tokens = raw.split(';').map((p) => p.trim()).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const tokLower = tok.toLowerCase();

    // Coincidencia exacta con token con prefijo (ej. 'g__Pseudomonas')
    if (dbIndex.tokenExact.has(tokLower)) {
      dbIndex.tokenExact.get(tokLower).forEach((f) => result.add(f));
    }

    // Coincidencia con nombre limpio de rango (ej. 'Pseudomonas')
    const tokClean = tokLower.replace(/^[a-z]__/i, '').trim();
    if (tokClean && dbIndex.tokenClean.has(tokClean)) {
      dbIndex.tokenClean.get(tokClean).forEach((f) => result.add(f));
    }
  }

  return result;
}

/**
 * Analiza e identifica la estructura de una matriz taxonómica de entrada.
 * Soporta:
 *  - Formato ancho (filas = muestras, columnas = taxones)
 *  - Formato largo (filas = taxones, columnas = muestras)
 *  - Array de objetos de muestra
 *
 * @param {Object|Array} taxaMatrix
 * @param {string} [customSampleKey]
 * @returns {{
 *   samples: string[],
 *   taxa: Array<{ name: string, values: Object.<string, number> }>,
 *   sampleTotals: Object.<string, number>,
 *   sampleKey: string
 * }}
 */
export function parseTaxaMatrix(taxaMatrix, customSampleKey = null) {
  let headers = [];
  let rows = [];

  if (taxaMatrix && Array.isArray(taxaMatrix.rows) && Array.isArray(taxaMatrix.headers)) {
    headers = taxaMatrix.headers.slice();
    rows = taxaMatrix.rows;
  } else if (Array.isArray(taxaMatrix)) {
    rows = taxaMatrix;
    if (rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) {
      headers = Object.keys(rows[0]);
    }
  } else if (taxaMatrix && typeof taxaMatrix === 'object') {
    if (Array.isArray(taxaMatrix.rows)) rows = taxaMatrix.rows;
    if (Array.isArray(taxaMatrix.headers)) headers = taxaMatrix.headers.slice();
  }

  if (rows.length === 0 || headers.length === 0) {
    return { samples: [], taxa: [], sampleTotals: {}, sampleKey: customSampleKey || 'SampleID' };
  }

  const sampleKeyCandidate = customSampleKey || headers[0] || 'SampleID';
  const firstColKey = headers[0];

  // Comprobar si las filas representan taxones (filas = taxones, columnas = muestras)
  const isTaxonRows = /^(taxon|taxa|otu|asv|feature|featureid|#otu id|species|genus)$/i.test(firstColKey.trim());

  if (isTaxonRows) {
    const sampleHeaders = headers.slice(1);
    const sampleTotals = {};
    sampleHeaders.forEach((s) => { sampleTotals[s] = 0; });

    const taxa = [];
    rows.forEach((r) => {
      const taxonName = String(r[firstColKey] || '').trim();
      if (!taxonName) return;
      const values = {};
      sampleHeaders.forEach((s) => {
        const val = parseFloat(r[s]) || 0;
        values[s] = val;
        sampleTotals[s] = (sampleTotals[s] || 0) + val;
      });
      taxa.push({ name: taxonName, values });
    });

    return { samples: sampleHeaders, taxa, sampleTotals, sampleKey: 'SampleID' };
  }

  // Filas representan muestras (filas = muestras, columnas = taxones)
  const sampleKey = sampleKeyCandidate;
  const taxonHeaders = headers.filter((h) => h !== sampleKey);
  const samples = rows.map((r) => String(r[sampleKey] || '').trim()).filter(Boolean);

  const sampleTotals = {};
  samples.forEach((s) => { sampleTotals[s] = 0; });

  const taxaMap = new Map();
  taxonHeaders.forEach((th) => {
    taxaMap.set(th, { name: th, values: {} });
  });

  rows.forEach((r) => {
    const sId = String(r[sampleKey] || '').trim();
    if (!sId) return;
    taxonHeaders.forEach((th) => {
      const val = parseFloat(r[th]) || 0;
      taxaMap.get(th).values[sId] = val;
      sampleTotals[sId] = (sampleTotals[sId] || 0) + val;
    });
  });

  const taxa = Array.from(taxaMap.values());
  return { samples, taxa, sampleTotals, sampleKey };
}

/**
 * Motor de inferencia funcional estricto: Mapea taxones a rutas metabólicas
 * según un diccionario de referencia (FAPROTAX o custom).
 *
 * @param {Object|Array} taxaMatrix - Matriz taxonómica ({ headers, rows } o Array)
 * @param {Object|Array} databaseJSON - Base de datos de funciones
 * @param {Object} [options={}] - Opciones de cálculo
 * @param {boolean} [options.includeUnassigned=true] - Incluir categoría 'Sin función asignada'
 * @param {string} [options.unassignedLabel='Sin función asignada'] - Etiqueta para taxones no asignados
 * @param {boolean} [options.asPercentage=true] - Devolver abundancias en % (0-100) en lugar de fracciones (0-1)
 * @param {string} [options.sampleKey=null] - Nombre de la columna de muestras
 * @returns {{
 *   headers: string[],
 *   rows: Object[],
 *   functions: string[],
 *   samples: string[],
 *   sampleKey: string,
 *   byFunction: Object[],
 *   mappedTaxa: string[],
 *   unassignedTaxa: string[],
 *   mappingStats: {
 *     totalTaxa: number,
 *     mappedTaxaCount: number,
 *     unassignedTaxaCount: number,
 *     coveragePercent: number,
 *     averageMappedAbundance: number
 *   }
 * }}
 */
export function mapTaxonomyToFunction(taxaMatrix, databaseJSON, options = {}) {
  const opts = {
    includeUnassigned: true,
    unassignedLabel: 'Sin función asignada',
    asPercentage: true,
    normalizeFunctional: true,
    sampleKey: null,
    ...options
  };

  const dbIndex = buildDatabaseIndex(databaseJSON);
  const parsed = parseTaxaMatrix(taxaMatrix, opts.sampleKey);
  const { samples, taxa, sampleTotals, sampleKey } = parsed;

  const mappedTaxaSet = new Set();
  const unassignedTaxaSet = new Set();
  const activeFunctions = new Set();

  // Matriz de acumulación muestra -> función -> valor
  const sampleFunctionScores = {};
  const sampleUnassignedScores = {};
  const sampleMappedAbund = {};

  samples.forEach((s) => {
    sampleFunctionScores[s] = {};
    sampleUnassignedScores[s] = 0;
    sampleMappedAbund[s] = 0;
  });

  // Iteración estricta sobre cada ASV/OTU / taxón
  taxa.forEach((tax) => {
    const matchedFns = findFunctionsForTaxon(tax.name, dbIndex);
    const hasMatch = matchedFns.size > 0;

    if (hasMatch) {
      mappedTaxaSet.add(tax.name);
      matchedFns.forEach((f) => activeFunctions.add(f));
    } else {
      unassignedTaxaSet.add(tax.name);
    }

    samples.forEach((s) => {
      const total = sampleTotals[s] || 1;
      const raw = tax.values[s] || 0;
      const frac = total > 0 ? (raw / total) : 0;
      const value = opts.asPercentage ? (frac * 100) : frac;

      if (hasMatch) {
        sampleMappedAbund[s] += value;
        matchedFns.forEach((f) => {
          sampleFunctionScores[s][f] = (sampleFunctionScores[s][f] || 0) + value;
        });
      } else {
        sampleUnassignedScores[s] += value;
      }
    });
  });

  const sortedFunctions = Array.from(activeFunctions).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  const finalFunctions = [...sortedFunctions];
  if (opts.includeUnassigned) {
    finalFunctions.push(opts.unassignedLabel);
  }

  const headers = [sampleKey, ...finalFunctions];

  // Construcción de filas compatibles con los barplots.
  // Normalización Matemática Funcional: se calcula el total funcional por muestra
  // y se relativiza cada función respecto a dicho total (multiplicado por 100),
  // garantizando un techo estricto del 100% sin desbordamientos en los barplots.
  const rows = samples.map((s) => {
    const row = { [sampleKey]: s };
    const relObj = {};

    let sampleTotalFunctional = 1;
    if (opts.normalizeFunctional) {
      sampleTotalFunctional = 0;
      sortedFunctions.forEach((f) => {
        sampleTotalFunctional += (sampleFunctionScores[s][f] || 0);
      });
      if (opts.includeUnassigned) {
        sampleTotalFunctional += (sampleUnassignedScores[s] || 0);
      }
      if (sampleTotalFunctional <= 0) sampleTotalFunctional = 1;
    }

    sortedFunctions.forEach((f) => {
      const rawVal = sampleFunctionScores[s][f] || 0;
      const frac = opts.normalizeFunctional ? (rawVal / sampleTotalFunctional) : (opts.asPercentage ? rawVal / 100 : rawVal);
      const normVal = opts.asPercentage ? (opts.normalizeFunctional ? +(frac * 100).toFixed(4) : +rawVal.toFixed(4)) : +frac.toFixed(4);
      row[f] = normVal;
      relObj[f] = opts.asPercentage ? +(normVal / 100).toFixed(6) : normVal;
    });

    if (opts.includeUnassigned) {
      const rawUnassigned = sampleUnassignedScores[s] || 0;
      const unassignedFrac = opts.normalizeFunctional ? (rawUnassigned / sampleTotalFunctional) : (opts.asPercentage ? rawUnassigned / 100 : rawUnassigned);
      const normUnassignedVal = opts.asPercentage ? (opts.normalizeFunctional ? +(unassignedFrac * 100).toFixed(4) : +rawUnassigned.toFixed(4)) : +unassignedFrac.toFixed(4);
      row[opts.unassignedLabel] = normUnassignedVal;
      relObj[opts.unassignedLabel] = opts.asPercentage ? +(normUnassignedVal / 100).toFixed(6) : normUnassignedVal;
    }

    row._relative = relObj;
    return row;
  });

  // Vista transpuesta: funciones como filas con valores normalizados
  const byFunction = finalFunctions.map((f) => {
    const item = { function: f };
    samples.forEach((s, sIdx) => {
      item[s] = rows[sIdx][f];
    });
    return item;
  });

  // Métricas estadísticas de cobertura
  const totalTaxa = taxa.length;
  const mappedTaxaCount = mappedTaxaSet.size;
  const unassignedTaxaCount = unassignedTaxaSet.size;
  const coveragePercent = totalTaxa > 0 ? +((mappedTaxaCount / totalTaxa) * 100).toFixed(2) : 0;

  let totalMappedPct = 0;
  samples.forEach((s) => {
    totalMappedPct += sampleMappedAbund[s];
  });
  const averageMappedAbundance = samples.length > 0 ? +(totalMappedPct / samples.length).toFixed(2) : 0;

  return {
    headers,
    rows,
    functions: finalFunctions,
    samples,
    sampleKey,
    byFunction,
    mappedTaxa: Array.from(mappedTaxaSet),
    unassignedTaxa: Array.from(unassignedTaxaSet),
    mappingStats: {
      totalTaxa,
      mappedTaxaCount,
      unassignedTaxaCount,
      coveragePercent,
      averageMappedAbundance,
    }
  };
}

/**
 * Traduce el identificador técnico de la función a un nombre legible por el usuario.
 */
export function formatFunctionName(key, lang = 'es') {
  if (FUNCTION_NAMES[key]) {
    return FUNCTION_NAMES[key][lang] || FUNCTION_NAMES[key]['es'] || key;
  }
  if (PHENOTYPE_NAMES[key]) {
    return PHENOTYPE_NAMES[key][lang] || PHENOTYPE_NAMES[key]['es'] || key;
  }
  const tKey = 'inference.trait_' + key;
  const translated = t(tKey);
  if (translated && translated !== tKey) return translated;
  return key.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Renderizador de Interfaz Gráfica (UI)
// ---------------------------------------------------------------------------

export function render(container) {
  let selectedDbType = 'faprotax'; // 'faprotax' | 'phenotypes' | 'custom'
  let activeDb = DEFAULT_FAPROTAX;
  let activeDbInfo = {
    name: FAPROTAX_METADATA.name,
    isCustom: false,
    type: 'faprotax',
    version: FAPROTAX_METADATA.version
  };
  let customDb = null;
  let customDbInfo = null;

  let currentLevel = 6; // Nivel de género por defecto
  let viewMode = 'barplot'; // 'barplot' | 'lollipop' | 'table' (el aluvial se retiró en la Fase 2: no funcionaba)
  let topN = 15;
  let minAbundance = 1; // 1%
  let minPrev = 0;
  let selectedGroupCol = null;
  let editor = null;
  let wasEditing = false;
  let tooltipEl = null;

  function ensureTooltip() {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'ql-tooltip';
      tooltipEl.style.position = 'fixed';
      tooltipEl.style.display = 'none';
      tooltipEl.style.zIndex = '9999';
      tooltipEl.style.pointerEvents = 'none';
      document.body.appendChild(tooltipEl);
    }
  }

  function getTaxaTable() {
    if (state.taxaBarplot && state.taxaBarplot.levels) {
      const lvls = Object.keys(state.taxaBarplot.levels).sort((a, b) => Number(a) - Number(b));
      if (lvls.length > 0) {
        if (!state.taxaBarplot.levels[currentLevel]) {
          currentLevel = lvls.includes('6') ? 6 : Number(lvls[lvls.length - 1]);
        }
        return {
          table: state.taxaBarplot.levels[currentLevel],
          levels: lvls,
        };
      }
    }
    if (state.taxaCounts && state.taxaCounts.rows && state.taxaCounts.rows.length > 0) {
      return {
        table: state.taxaCounts,
        levels: [],
      };
    }
    return null;
  }

  function paint() {
    wasEditing = editor && editor.isEditing ? editor.isEditing() : false;
    if (editor) { editor.destroy(); editor = null; }
    container.innerHTML = '';
    ensureTooltip();

    const isPhenotypes = selectedDbType === 'phenotypes';

    // Cabecera del módulo adaptativa según base de datos activa
    const header = document.createElement('header');
    header.className = 'ql-page-header';
    header.innerHTML =
      '<p class="ql-eyebrow">' + (isPhenotypes ? (t('inference.eyebrowPhenotypes') || 'RASGOS FENOTÍPICOS Y ECOLÓGICOS') : (t('inference.eyebrow') || 'ANÁLISIS METABÓLICO')) + '</p>' +
      '<h1 class="ql-page-title">' + (isPhenotypes ? (t('inference.titlePhenotypes') || 'Inferencia Fenotípica y Morfológica') : (t('inference.title') || 'Inferencia Funcional Taxonómica')) + '</h1>' +
      '<p class="ql-page-sub">' + (isPhenotypes ? (t('inference.subtitlePhenotypes') || 'Predicción de tinción Gram, morfología celular, movilidad, esporulación, temperatura, pH, enzimas y ecología a partir de perfiles 16S/ITS') : (t('inference.subtitle') || 'Predicción estricta de rutas metabólicas y biogeoquímicas a partir de perfiles 16S/ITS')) + '</p>';
    container.appendChild(header);

    // Aviso Metodológico Permanente (Requisito estricto)
    const alertBanner = document.createElement('aside');
    alertBanner.className = 'ql-alert-warning ql-inference-banner';
    alertBanner.setAttribute('role', 'alert');
    alertBanner.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>' +
      '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' +
      '</svg>' +
      '<div>' +
      '<strong>' + (t('inference.warningTitle') || 'Nota metodológica:') + '</strong> ' +
      (t('inference.warningText') || 'La inferencia funcional por 16S/ITS es predictiva. Para confirmación del potencial genómico se requiere secuenciación Shotgun. Cite siempre la base de datos de referencia utilizada.') +
      '</div>';
    container.appendChild(alertBanner);

    const taxaInfo = getTaxaTable();
    if (!taxaInfo || !taxaInfo.table || !taxaInfo.table.rows || taxaInfo.table.rows.length === 0) {
      // Estado vacío
      const emptyCard = document.createElement('div');
      emptyCard.className = 'ql-card ql-empty';
      emptyCard.innerHTML =
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">' +
        '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>' +
        '</svg>' +
        '<h3>' + (t('inference.emptyTitle') || 'No se han detectado tablas taxonómicas') + '</h3>' +
        '<p>' + (t('inference.emptyDesc') || 'Para predecir el perfil funcional se necesita una tabla de taxonomía o abundancia por taxón (QIIME2 barplot o conteos).') + '</p>';
      mountExampleButtons(emptyCard, { real: loadRealCommunityData });
      container.appendChild(emptyCard);
      return;
    }

    // Ejecución del motor de inferencia matemática
    const inferredMatrix = mapTaxonomyToFunction(taxaInfo.table, activeDb, {
      includeUnassigned: true,
      asPercentage: true,
      unassignedLabel: t('inference.unassigned') || 'Sin función asignada',
    });

    // Panel de métricas estadísticas
    const statsContainer = document.createElement('div');
    statsContainer.className = 'ql-inference-stats-grid';
    const stats = inferredMatrix.mappingStats;
    statsContainer.innerHTML =
      '<div class="ql-inference-stat-card">' +
      '<div class="ql-inference-stat-label">' + (t('inference.statTotalTaxa') || 'Taxones Evaluados') + '</div>' +
      '<div class="ql-inference-stat-val">' + stats.totalTaxa + '</div>' +
      '</div>' +
      '<div class="ql-inference-stat-card">' +
      '<div class="ql-inference-stat-label">' + (t('inference.statMappedTaxa') || 'Taxones Anotados') + '</div>' +
      '<div class="ql-inference-stat-val" style="color:var(--accent);">' + stats.mappedTaxaCount + '</div>' +
      '</div>' +
      '<div class="ql-inference-stat-card">' +
      '<div class="ql-inference-stat-label">' + (t('inference.statUnassigned') || 'Sin Función') + '</div>' +
      '<div class="ql-inference-stat-val" style="color:var(--ink-3);">' + stats.unassignedTaxaCount + '</div>' +
      '</div>' +
      '<div class="ql-inference-stat-card">' +
      '<div class="ql-inference-stat-label">' + (t('inference.statCoverage') || 'Cobertura Taxonómica') + '</div>' +
      '<div class="ql-inference-stat-val">' + stats.coveragePercent + '%</div>' +
      '</div>' +
      '<div class="ql-inference-stat-card">' +
      '<div class="ql-inference-stat-label">' + (isPhenotypes ? (t('inference.statTraits') || 'Rasgos Detectados') : (t('inference.statFunctions') || 'Rutas Detectadas')) + '</div>' +
      '<div class="ql-inference-stat-val">' + (inferredMatrix.functions.length - 1) + '</div>' +
      '</div>';
    container.appendChild(statsContainer);

    // Controles y visualización principal
    const grid = document.createElement('div');
    grid.className = 'ql-grid-sidebar';

    const mainPanel = document.createElement('div');
    mainPanel.className = 'ql-main';

    // Barra de herramientas de vistas (Barras / Lollipop / Tabla)
    const viewTabs = chartTypeField({
      labelKey: 'inference.viewLabel',
      options: [
        { value: 'barplot', labelKey: 'inference.tabBarplot' },
        { value: 'lollipop', labelKey: 'inference.tabLollipop' },
        { value: 'table', labelKey: 'inference.tabTable' },
      ],
      active: viewMode,
      onChange: (v) => { viewMode = v; paint(); },
    });
    viewTabs.style.marginBottom = '16px';
    mainPanel.appendChild(viewTabs);

    const chartCard = document.createElement('div');
    chartCard.className = 'ql-card';
    mainPanel.appendChild(chartCard);

    // Barra lateral de controles
    const sidebar = document.createElement('aside');
    sidebar.className = 'ql-sidebar';

    // Selector de Base de Datos desplegable (<select>)
    const dbCard = document.createElement('div');
    dbCard.className = 'ql-field';
    dbCard.innerHTML =
      '<label for="ql-select-db">' + (t('inference.dbLabel') || 'Base de datos de inferencia') + '</label>' +
      '<select id="ql-select-db" class="ql-select" style="width:100%;margin-bottom:8px;">' +
      '<option value="faprotax"' + (selectedDbType === 'faprotax' ? ' selected' : '') + '>' +
      (t('inference.dbMetabolism') || 'Metabolismo (FAPROTAX)') +
      '</option>' +
      '<option value="phenotypes"' + (selectedDbType === 'phenotypes' ? ' selected' : '') + '>' +
      (t('inference.dbPhenotypes') || 'Fenotipo y Morfología (BacDive/metaTraits)') +
      '</option>' +
      '<option value="custom"' + (selectedDbType === 'custom' ? ' selected' : '') + '>' +
      (t('inference.dbCustom') || 'Cargar JSON Personalizado') +
      '</option>' +
      '</select>' +
      '<input type="file" id="ql-upload-db" accept=".json" style="display:none;" />' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">' +
      '<span class="ql-badge" style="display:inline-block;">DB: ' + escapeHtml(activeDbInfo.name) + '</span>' +
      (selectedDbType === 'custom' && customDb
        ? '<button type="button" class="ql-btn ql-btn-sm" id="ql-btn-reupload" style="font-size:11px;padding:2px 8px;cursor:pointer;">' +
          (t('inference.changeCustomFile') || 'Cambiar archivo…') + '</button>'
        : '') +
      '</div>';

    const selectDb = dbCard.querySelector('#ql-select-db');
    const fileInput = dbCard.querySelector('#ql-upload-db');
    const btnReupload = dbCard.querySelector('#ql-btn-reupload');

    selectDb.addEventListener('change', () => {
      const val = selectDb.value;
      if (val === 'faprotax') {
        selectedDbType = 'faprotax';
        activeDb = DEFAULT_FAPROTAX;
        activeDbInfo = { name: FAPROTAX_METADATA.name, isCustom: false, type: 'faprotax', version: FAPROTAX_METADATA.version };
        paint();
      } else if (val === 'phenotypes') {
        selectedDbType = 'phenotypes';
        activeDb = DEFAULT_PHENOTYPES;
        activeDbInfo = { name: PHENOTYPES_METADATA.name, isCustom: false, type: 'phenotypes', version: PHENOTYPES_METADATA.version };
        paint();
      } else if (val === 'custom') {
        if (customDb) {
          selectedDbType = 'custom';
          activeDb = customDb;
          activeDbInfo = customDbInfo;
          paint();
        } else {
          fileInput.click();
        }
      }
    });

    if (btnReupload) {
      btnReupload.addEventListener('click', () => fileInput.click());
    }

    fileInput.addEventListener('change', (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) {
        if (!customDb) {
          selectDb.value = selectedDbType;
        }
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsedJson = JSON.parse(e.target.result);
          customDb = parsedJson;
          customDbInfo = {
            name: file.name,
            isCustom: true,
            type: 'custom',
            version: 'Custom JSON',
          };
          selectedDbType = 'custom';
          activeDb = customDb;
          activeDbInfo = customDbInfo;
          paint();
        } catch (err) {
          alert((t('inference.jsonError') || 'Error al procesar el archivo JSON: ') + err.message);
          selectDb.value = selectedDbType;
        }
      };
      reader.readAsText(file);
    });
    sidebar.appendChild(dbCard);

    // Selector de nivel taxonómico si hay varios
    if (taxaInfo.levels && taxaInfo.levels.length > 1) {
      const lvlField = document.createElement('div');
      lvlField.className = 'ql-field';
      lvlField.innerHTML = '<label>' + (t('barplots.levelLabel') || 'Nivel Taxonómico') + '</label>';
      const lvlSelect = document.createElement('select');
      taxaInfo.levels.forEach((l) => {
        const opt = document.createElement('option');
        opt.value = l;
        opt.textContent = (t('barplots.level', { n: l }) || 'Nivel ' + l) + (Number(l) === 6 ? ' (Género)' : Number(l) === 7 ? ' (Especie)' : '');
        if (Number(l) === currentLevel) opt.selected = true;
        lvlSelect.appendChild(opt);
      });
      lvlSelect.addEventListener('change', () => {
        currentLevel = Number(lvlSelect.value);
        paint();
      });
      lvlField.appendChild(lvlSelect);
      sidebar.appendChild(lvlField);
    }

    // Selector de grupo de metadatos (si hay metadatos)
    let metaCols = [];
    if (state.metadata && Array.isArray(state.metadata.headers)) {
      metaCols = state.metadata.headers.filter((h) => h !== state.metadata.sampleIdKey);
    }
    if (metaCols.length > 0) {
      const grpField = document.createElement('div');
      grpField.className = 'ql-field';
      grpField.innerHTML = '<label>' + (t('barplots.groupCol') || 'Agrupar por metadato') + '</label>';
      const grpSelect = document.createElement('select');
      const defOpt = document.createElement('option');
      defOpt.value = '';
      defOpt.textContent = t('barplots.noGroup') || '(Sin agrupar / Muestras individuales)';
      grpSelect.appendChild(defOpt);
      metaCols.forEach((col) => {
        const opt = document.createElement('option');
        opt.value = col;
        opt.textContent = col;
        if (selectedGroupCol === col) opt.selected = true;
        grpSelect.appendChild(opt);
      });
      grpSelect.addEventListener('change', () => {
        selectedGroupCol = grpSelect.value || null;
        paint();
      });
      grpField.appendChild(grpSelect);
      sidebar.appendChild(grpField);
    }

    // Controles de filtrado y agrupamiento en "Otros"
    const topNField = document.createElement('div');
    topNField.className = 'ql-field';
    topNField.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
      '<label for="qlInfTopN" style="margin:0;">' + (t('inference.topNLabel') || 'Top N funciones') + '</label>' +
      '<span class="ql-badge">' + topN + '</span>' +
      '</div>' +
      '<input type="range" id="qlInfTopN" min="5" max="50" step="1" value="' + topN + '" style="width:100%;" />';
    const topNInput = topNField.querySelector('#qlInfTopN');
    topNInput.addEventListener('input', (e) => {
      topN = parseInt(e.target.value, 10) || 15;
      topNField.querySelector('.ql-badge').textContent = topN;
    });
    topNInput.addEventListener('change', () => paint());
    sidebar.appendChild(topNField);

    const minAbundField = document.createElement('div');
    minAbundField.className = 'ql-field';
    minAbundField.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
      '<label for="qlInfMinAbund" style="margin:0;">' + (t('inference.minAbundLabel') || 'Abundancia mínima') + '</label>' +
      '<span class="ql-badge">' + minAbundance + '%</span>' +
      '</div>' +
      '<input type="range" id="qlInfMinAbund" min="0" max="10" step="0.5" value="' + minAbundance + '" style="width:100%;" />';
    const minAbundInput = minAbundField.querySelector('#qlInfMinAbund');
    minAbundInput.addEventListener('input', (e) => {
      minAbundance = parseFloat(e.target.value) || 0;
      minAbundField.querySelector('.ql-badge').textContent = minAbundance + '%';
    });
    minAbundInput.addEventListener('change', () => paint());
    sidebar.appendChild(minAbundField);

    // Botón de exportación CSV
    const exportField = document.createElement('div');
    exportField.className = 'ql-field';
    exportField.style.marginTop = '20px';
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'ql-btn';
    exportBtn.style.width = '100%';
    exportBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>' +
      '</svg> ' + (t('inference.exportCsv') || 'Exportar matriz (CSV)');
    exportBtn.addEventListener('click', () => {
      const csvContent = generateCsv(inferredMatrix);
      const prefix = isPhenotypes ? 'inferencia_fenotipica_' : 'inferencia_funcional_';
      downloadBlob(csvContent, prefix + activeDbInfo.name.replace(/\.[^/.]+$/, '') + '.csv', 'text/csv;charset=utf-8;');
    });
    exportField.appendChild(exportBtn);
    sidebar.appendChild(exportField);

    grid.appendChild(mainPanel);
    grid.appendChild(sidebar);
    container.appendChild(grid);

    // Renderizar la vista seleccionada en chartCard
    if (viewMode === 'barplot') {
      renderStackedBarplot(chartCard, inferredMatrix, {
        topN,
        minAbundance,
        minPrev,
        groupCol: selectedGroupCol,
      });
    } else if (viewMode === 'lollipop') {
      renderLollipop(chartCard, inferredMatrix, {
        topN,
        minAbundance,
        minPrev,
        groupCol: selectedGroupCol,
      });
    } else if (viewMode === 'table') {
      renderDataTable(chartCard, inferredMatrix);
    }
  }

  // -------------------------------------------------------------------------
  // Renderizadores específicos de vista
  // -------------------------------------------------------------------------

  function renderStackedBarplot(card, matrix, opts) {
    card.innerHTML = '';
    const isPhenotypes = selectedDbType === 'phenotypes';
    const bso = getFigureOptions('inference-barplot');
    const grouped = groupTaxaByAbundance(matrix, opts.minAbundance, opts.topN, {
      minPrev: opts.minPrev,
      isPercentage: true,
      sampleKey: matrix.sampleKey,
      categoryOrder: bso.categoryOrder,
    });

    const { topTaxa, series, hasOther } = grouped;
    let rows = grouped.rows;

    // Ordenar muestras por grupo si aplica
    const resolveGroup = opts.groupCol ? makeGroupResolver(state.metadata, opts.groupCol) : null;
    if (resolveGroup) {
      rows = rows.slice().sort((a, b) => {
        const gA = resolveGroup(a[matrix.sampleKey]) || '';
        const gB = resolveGroup(b[matrix.sampleKey]) || '';
        return gA.localeCompare(gB, undefined, { numeric: true }) ||
               String(a[matrix.sampleKey]).localeCompare(String(b[matrix.sampleKey]), undefined, { numeric: true });
      });
    }

    const nSamples = rows.length;
    const margin = { top: 40, right: 220, bottom: 90, left: 60 };
    const barWidth = Math.max(14, Math.min(36, Math.floor(700 / (nSamples || 1))));
    const plotWidth = Math.max(500, nSamples * (barWidth + 4));
    const W = plotWidth + margin.left + margin.right;
    const H = 460;
    const innerW = W - margin.left - margin.right;
    const innerH = H - margin.top - margin.bottom;

    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`,
      class: 'ql-svg',
      role: 'img',
      'aria-label': t('inference.chartAria') || 'Gráfico de barras apiladas de funciones metabólicas',
      style: 'max-width:100%;height:auto;display:block;'
    });

    // Ejes de coordenadas
    const axesG = svgEl('g', { class: 'ql-axes' });
    axesG.appendChild(svgEl('line', {
      x1: margin.left, y1: margin.top,
      x2: margin.left, y2: margin.top + innerH,
      class: 'ql-baseline-line',
    }));
    axesG.appendChild(svgEl('line', {
      x1: margin.left, y1: margin.top + innerH,
      x2: margin.left + innerW, y2: margin.top + innerH,
      class: 'ql-baseline-line',
    }));

    // rango manual del eje de porcentaje (Ajustes > Estructura); 0-100 por defecto
    const pLo = bso.axisMin != null ? bso.axisMin : 0, pHi = bso.axisMax != null ? bso.axisMax : 100;
    const yP = (pct) => margin.top + innerH - ((pct - pLo) / ((pHi - pLo) || 1)) * innerH;
    const barClip = plotClip(svg, 'ql-clip-infbar', margin.left, margin.top, innerW, innerH);
    // Ticks eje Y (5 marcas entre el mínimo y el máximo del rango)
    [0, 0.25, 0.5, 0.75, 1].map((f) => pLo + f * (pHi - pLo)).forEach((pct, ti) => {
      const y = yP(pct);
      // la marca del mínimo coincide con el eje X ya dibujado arriba — no duplicar la línea
      if (ti > 0) {
        axesG.appendChild(svgEl('line', {
          x1: margin.left - 5, y1: y,
          x2: margin.left + innerW, y2: y,
          class: 'ql-gridline',
        }));
      }

      const label = svgEl('text', {
        x: margin.left - 8, y: y + 4,
        class: 'ql-tick-label',
        'text-anchor': 'end',
      });
      label.textContent = (Math.abs(pct - Math.round(pct)) < 0.05 ? String(Math.round(pct)) : pct.toFixed(1)) + '%';
      axesG.appendChild(label);
    });

    const mainTitle = svgEl('text', {
      x: margin.left + innerW / 2, y: 22,
      class: 'ce-title ql-chart-main-title',
      'text-anchor': 'middle',
      'font-size': '14px',
      'font-weight': '600',
      fill: 'var(--ink-1)',
      'data-ce': 'title'
    });
    mainTitle.textContent = isPhenotypes
      ? (t('inference.titlePhenotypes') || 'Inferencia Fenotípica y Morfológica')
      : (t('inference.title') || 'Inferencia Funcional Taxonómica');
    svg.appendChild(mainTitle);

    const yTitle = svgEl('text', {
      x: -(margin.top + innerH / 2),
      y: 18,
      transform: 'rotate(-90)',
      'text-anchor': 'middle',
      'font-size': '12px',
      'font-weight': '600',
      fill: 'var(--ink-1)',
      class: 'ql-axis-label ql-chart-y-title',
      'data-ce': 'ytitle'
    });
    yTitle.textContent = t('inference.yAxisTitle') || 'Abundancia Relativa Funcional (%)';
    axesG.appendChild(yTitle);

    const xTitle = svgEl('text', {
      x: margin.left + innerW / 2,
      y: H - 10,
      'text-anchor': 'middle',
      'font-size': '12px',
      'font-weight': '600',
      fill: 'var(--ink-1)',
      class: 'ql-axis-label ql-chart-x-title',
      'data-ce': 'xtitle'
    });
    xTitle.textContent = opts.groupCol ? (t('barplots.axisSamplesBy', { col: opts.groupCol }) || 'Muestras agrupadas') : (t('barplots.axisSamples') || 'Muestras');
    axesG.appendChild(xTitle);
    svg.appendChild(axesG);

    // Dibujo de barras apiladas
    const barsG = svgEl('g', { class: 'ql-bars' });
    const stepX = innerW / nSamples;

    rows.forEach((r, sIdx) => {
      const sId = String(r[matrix.sampleKey]);
      const x = margin.left + sIdx * stepX + (stepX - barWidth) / 2;
      let curYFrac = 0;

      // Renderizar series en orden
      series.forEach((sObj, cIdx) => {
        const fKey = sObj.key;
        const val = parseFloat(r[fKey]) || 0;
        const frac = val / 100;
        if (frac <= 0) return;

        const yTopB = yP((curYFrac + frac) * 100), yBotB = yP(curYFrac * 100);
        const h = yBotB - yTopB;
        const y = yTopB;
        curYFrac += frac;

        const rect = svgEl('rect', {
          x, y,
          width: barWidth,
          height: Math.max(0.5, h),
          'data-ce-role': 'bar', 'clip-path': barClip,
          fill: sObj.isOther ? OTHER_COLOR : getSeriesColor(cIdx, sObj.isOther),
          ...seriesTag(cIdx, sObj.isOther),
          stroke: 'var(--surface)',
          'stroke-width': '0.5',
          'data-sample': sId,
          'data-function': fKey,
          'data-val': val.toFixed(2),
        });

        barsG.appendChild(rect);
      });

      // Etiqueta del eje X (nombre de muestra)
      const xLabel = svgEl('text', {
        x: x + barWidth / 2,
        y: margin.top + innerH + 14,
        class: 'ql-tick-label',
        'text-anchor': 'end',
        transform: `rotate(-45, ${x + barWidth / 2}, ${margin.top + innerH + 14})`
      });
      xLabel.textContent = sId.length > 14 ? sId.slice(0, 12) + '…' : sId;
      barsG.appendChild(xLabel);
    });

    svg.appendChild(barsG);
    delegateHover(svg, 'rect[data-sample]', {
      onEnter: (el, ev) => {
        tooltipEl.style.display = 'block';
        tooltipEl.innerHTML =
          '<strong>' + escapeHtml(el.dataset.sample) + '</strong><br/>' +
          escapeHtml(formatFunctionName(el.dataset.function, getLang())) + ': <b>' + el.dataset.val + '%</b>';
        positionTooltip(ev);
      },
      onMove: (el, ev) => positionTooltip(ev),
      onLeave: () => { tooltipEl.style.display = 'none'; },
    });

    // Leyenda lateral interactiva
    const legendG = svgEl('g', { class: 'ql-legend', 'data-ce': 'legend', transform: `translate(${W - margin.right + 20}, ${margin.top})` });
    const legTitle = svgEl('text', { x: 0, y: 0, 'font-size': '12px', 'font-weight': '600', fill: 'var(--ink)' });
    legTitle.textContent = isPhenotypes
      ? (t('inference.legendPhenotypes') || 'Rasgos Principales')
      : (t('inference.legendTitle') || 'Funciones Principales');
    legendG.appendChild(legTitle);

    series.forEach((sObj, i) => {
      if (i > 22) return; // Limitar tamaño de leyenda
      const y = 20 + i * 18;
      const gItem = svgEl('g', { style: 'cursor:pointer;', 'data-legend-key': sObj.key });

      const swatch = svgEl('rect', {
        x: 0, y: y - 10,
        width: 12, height: 12,
        rx: 2,
        fill: sObj.isOther ? OTHER_COLOR : getSeriesColor(i, sObj.isOther),
        ...seriesTag(i, sObj.isOther),
      });
      gItem.appendChild(swatch);

      const fName = formatFunctionName(sObj.key, getLang());
      const label = svgEl('text', {
        x: 18, y: y,
        class: 'ql-tick-label',
      });
      label.textContent = fName.length > 22 ? fName.slice(0, 20) + '…' : fName;
      gItem.appendChild(label);

      legendG.appendChild(gItem);
    });

    svg.appendChild(legendG);
    delegateHover(svg, 'g[data-legend-key]', {
      onEnter: (el) => {
        barsG.querySelectorAll('rect').forEach((r) => {
          if (r.getAttribute('data-function') !== el.dataset.legendKey) {
            r.style.opacity = '0.2';
          }
        });
      },
      onLeave: () => {
        barsG.querySelectorAll('rect').forEach((r) => { r.style.opacity = '1'; });
      },
    });
    card.appendChild(svg);

    // Conectar editor de gráficos
    editor = attachChartEditor({
      key: 'inference-barplot',
      svg,
      mount: card,
      filename: isPhenotypes ? 'inferencia_fenotipica_barplot' : 'inferencia_funcional_barplot',
      lang: getLang(),
      elements: [
        { id: 'title', selector: '[data-ce="title"]' },
        { id: 'xtitle', selector: '[data-ce="xtitle"]' },
        { id: 'ytitle', selector: '[data-ce="ytitle"]' },
        { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
      ],
      paletteSeries: paletteSeriesFor(series),
      paletteType: 'categorical',
      figureOptions: { categoryOrder: true, axis: { domain: [0, 100] } },
      onFigureOptionsChange: () => paint(),
      startEditing: wasEditing,
    });
  }

  // Lollipop: un punto por función (media de abundancia relativa), ordenadas
  // de mayor a menor. Con columna de agrupación seleccionada, cada función
  // muestra un punto POR GRUPO (media de ese grupo) unidos por una línea de
  // rango — comparar rutas/funciones dominantes entre grupos, como pide el
  // prompt. Sin agrupar, es un lollipop clásico (tallo desde 0).
  function renderLollipop(card, matrix, opts) {
    card.innerHTML = '';
    const isPhenotypes = selectedDbType === 'phenotypes';
    const grouped = groupTaxaByAbundance(matrix, opts.minAbundance, opts.topN, {
      minPrev: opts.minPrev,
      isPercentage: true,
      sampleKey: matrix.sampleKey,
    });
    const { series, rows } = grouped;

    const resolveGroup = (opts.groupCol && state.metadata) ? makeGroupResolver(state.metadata, opts.groupCol) : null;
    const groupNames = resolveGroup
      ? Array.from(new Set(rows.map((r) => resolveGroup(r[matrix.sampleKey])).filter(Boolean))).sort()
      : null;

    const lso = getFigureOptions('inference-lollipop');
    let values = series.map((sObj) => {
      const all = rows.map((r) => parseFloat(r[sObj.key]) || 0);
      const overall = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
      let byGroup = null;
      if (groupNames) {
        byGroup = {};
        groupNames.forEach((g) => {
          const vals = rows.filter((r) => resolveGroup(r[matrix.sampleKey]) === g).map((r) => parseFloat(r[sObj.key]) || 0);
          byGroup[g] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        });
      }
      return { sObj, overall, byGroup };
    }).sort((a, b) => b.overall - a.overall);
    // orden de las filas (Ajustes > Estructura); 'original' = abundancia descendente
    {
      const byKey = new Map(values.map((v) => [v.sObj.key, v]));
      values = orderCategories(values.map((v) => v.sObj.key), (k) => byKey.get(k).overall, lso.categoryOrder).map((k) => byKey.get(k));
    }

    const n = values.length;
    const margin = { top: 40, right: groupNames ? 170 : 40, bottom: 50, left: 210 };
    const rowH = Math.max(20, Math.min(34, 460 / Math.max(n, 1)));
    const innerH = rowH * n;
    const innerW = 420;
    const W = margin.left + innerW + margin.right;
    const H = margin.top + innerH + margin.bottom;

    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`,
      class: 'ql-svg',
      role: 'img',
      'aria-label': t('inference.lollipopAria') || 'Lollipop de funciones dominantes',
      style: 'max-width:100%;height:auto;display:block;',
    });

    const maxVal = Math.max(1e-9, ...values.map((v) => Math.max(v.overall, ...(v.byGroup ? Object.values(v.byGroup) : [0]))));
    const xLo = lso.axisXMin != null ? lso.axisXMin : 0, xHi = lso.axisXMax != null ? lso.axisXMax : maxVal;
    const xScale = (v) => margin.left + ((v - xLo) / ((xHi - xLo) || 1)) * innerW;
    const lclip = plotClip(svg, 'ql-clip-inflolli', margin.left, margin.top, innerW, innerH);

    const axesG = svgEl('g');
    axesG.appendChild(svgEl('line', { x1: margin.left, x2: margin.left, y1: margin.top, y2: margin.top + innerH, class: 'ql-baseline-line' }));
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      const x = margin.left + f * innerW;
      // f=0 coincide con la línea base ya dibujada arriba — no duplicar
      if (f > 0) axesG.appendChild(svgEl('line', { x1: x, x2: x, y1: margin.top, y2: margin.top + innerH, class: 'ql-gridline' }));
      const lbl = svgEl('text', { x, y: margin.top + innerH + 16, class: 'ql-tick-label', 'text-anchor': 'middle' });
      const xv = xLo + f * (xHi - xLo);
      lbl.textContent = xv.toFixed(Math.abs(xv) < 1 ? 2 : 1) + '%';
      axesG.appendChild(lbl);
    });

    const mainTitle = svgEl('text', {
      x: margin.left + innerW / 2, y: 22, class: 'ce-title ql-chart-main-title', 'text-anchor': 'middle',
      'font-size': '14px', 'font-weight': '600', fill: 'var(--ink-1)', 'data-ce': 'title',
    });
    mainTitle.textContent = isPhenotypes
      ? (t('inference.titlePhenotypes') || 'Inferencia Fenotípica y Morfológica')
      : (t('inference.title') || 'Inferencia Funcional Taxonómica');
    svg.appendChild(mainTitle);

    const xTitle = svgEl('text', {
      x: margin.left + innerW / 2, y: H - 10, 'text-anchor': 'middle', 'font-size': '12px', 'font-weight': '600',
      fill: 'var(--ink-1)', class: 'ql-axis-label ql-chart-x-title', 'data-ce': 'xtitle',
    });
    xTitle.textContent = t('inference.lollipopAxis') || 'Abundancia relativa media (%)';
    axesG.appendChild(xTitle);
    const yTitleL = svgEl('text', {
      x: 12, y: margin.top + innerH / 2, 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (margin.top + innerH / 2) + ')',
      'font-size': '12px', 'font-weight': '600', fill: 'var(--ink-1)', class: 'ql-axis-label ql-chart-y-title', 'data-ce': 'ytitle',
    });
    yTitleL.textContent = isPhenotypes ? t('inference.axisTrait') : t('inference.axisFunction');
    axesG.appendChild(yTitleL);
    svg.appendChild(axesG);

    const rowsG = svgEl('g');
    values.forEach((v, i) => {
      const cy = margin.top + i * rowH + rowH / 2;
      const fName = formatFunctionName(v.sObj.key, getLang());
      const lbl = svgEl('text', { x: margin.left - 10, y: cy + 4, class: 'ql-tick-label', 'text-anchor': 'end' });
      lbl.textContent = fName.length > 32 ? fName.slice(0, 30) + '…' : fName;
      rowsG.appendChild(lbl);

      if (v.byGroup) {
        const gxs = groupNames.map((g) => xScale(v.byGroup[g]));
        if (groupNames.length > 1) {
          rowsG.appendChild(svgEl('line', { x1: Math.min(...gxs), x2: Math.max(...gxs), y1: cy, y2: cy, class: 'ql-baseline-line', 'data-ce-series-stroke': 'stick', 'data-ce-role': 'line', 'clip-path': lclip }));
        }
        groupNames.forEach((g, gi) => {
          const cx = xScale(v.byGroup[g]);
          rowsG.appendChild(svgEl('circle', {
            cx, cy, r: 4.5, fill: groupColor(gi), 'data-ce-role': 'marker', 'clip-path': lclip, 'data-ce-series-fill': 'g' + gi, stroke: 'var(--surface)', 'stroke-width': 1,
            'data-fn': v.sObj.key, 'data-group': g, 'data-val': v.byGroup[g].toFixed(2),
          }));
        });
      } else {
        const cx = xScale(v.overall);
        rowsG.appendChild(svgEl('line', { x1: margin.left, x2: cx, y1: cy, y2: cy, class: 'ql-baseline-line', 'data-ce-series-stroke': 'stick', 'data-ce-role': 'line', 'clip-path': lclip }));
        rowsG.appendChild(svgEl('circle', {
          cx, cy, r: 5, fill: v.sObj.isOther ? OTHER_COLOR : getSeriesColor(i, v.sObj.isOther), 'data-ce-role': 'marker', 'clip-path': lclip, ...seriesTag(i, v.sObj.isOther), stroke: 'var(--surface)', 'stroke-width': 1,
          'data-fn': v.sObj.key, 'data-val': v.overall.toFixed(2),
        }));
      }
    });
    svg.appendChild(rowsG);

    delegateHover(svg, 'circle[data-fn]', {
      onEnter: (el, ev) => {
        const fName = formatFunctionName(el.dataset.fn, getLang());
        tooltipEl.style.display = 'block';
        tooltipEl.innerHTML = '<strong>' + escapeHtml(fName) + '</strong>' +
          (el.dataset.group ? '<br/>' + escapeHtml(el.dataset.group) : '') +
          '<br/>' + el.dataset.val + '%';
        positionTooltip(ev);
      },
      onMove: (el, ev) => positionTooltip(ev),
      onLeave: () => { tooltipEl.style.display = 'none'; },
    });

    if (groupNames) {
      const legendG = svgEl('g', { 'data-ce': 'legend', transform: `translate(${W - margin.right + 20}, ${margin.top})` });
      groupNames.forEach((g, gi) => {
        const y = 14 + gi * 18;
        legendG.appendChild(svgEl('circle', { cx: 5, cy: y - 4, r: 5, fill: groupColor(gi), 'data-ce-series-fill': 'g' + gi }));
        const lt = svgEl('text', { x: 16, y, class: 'ql-tick-label' });
        lt.textContent = g.length > 20 ? g.slice(0, 18) + '…' : g;
        legendG.appendChild(lt);
      });
      svg.appendChild(legendG);
    }

    card.appendChild(svg);

    const note = document.createElement('p');
    note.className = 'ql-field-help';
    note.style.margin = '8px 0 0';
    note.textContent = groupNames ? (t('inference.lollipopGroupNote') || '') : (t('inference.lollipopNoGroupNote') || '');
    card.appendChild(note);

    editor = attachChartEditor({
      key: 'inference-lollipop',
      svg,
      mount: card,
      filename: isPhenotypes ? 'inferencia_fenotipica_lollipop' : 'inferencia_funcional_lollipop',
      lang: getLang(),
      elements: [
        { id: 'title', selector: '[data-ce="title"]' },
        { id: 'xtitle', selector: '[data-ce="xtitle"]' },
        { id: 'ytitle', selector: '[data-ce="ytitle"]' },
        ...(groupNames ? [{ id: 'legend', selector: '[data-ce="legend"]', kind: 'group' }] : []),
      ],
      paletteSeries: [
        ...(groupNames ? groupNames.map((g, gi) => ({ id: 'g' + gi, label: g })) : paletteSeriesFor(values.map((v) => v.sObj))),
        { id: 'stick', label: t('inference.lollipopStick') || 'Palillo' },
      ],
      figureOptions: { axisX: { domain: [0, maxVal] }, categoryOrder: true },
      onFigureOptionsChange: () => paint(),
      paletteType: 'categorical',
      startEditing: wasEditing,
    });
  }

  function renderDataTable(card, matrix) {
    card.innerHTML = '';
    const tableWrap = document.createElement('div');
    tableWrap.className = 'ql-table-wrap';
    tableWrap.style.maxHeight = '500px';
    tableWrap.style.overflow = 'auto';

    const table = document.createElement('table');
    table.className = 'ql-table';

    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    matrix.headers.forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h === matrix.sampleKey ? (t('common.sample') || 'Muestra') : formatFunctionName(h, getLang());
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    matrix.rows.forEach((r) => {
      const tr = document.createElement('tr');
      matrix.headers.forEach((h) => {
        const td = document.createElement('td');
        if (h === matrix.sampleKey) {
          td.textContent = r[h];
          td.style.fontWeight = '600';
        } else {
          td.textContent = (r[h] !== undefined ? (+r[h]).toFixed(2) + '%' : '0.00%');
          td.className = 'tabular';
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    card.appendChild(tableWrap);
  }

  function positionTooltip(ev) {
    if (!tooltipEl) return;
    const x = ev.clientX + 14;
    const y = ev.clientY + 14;
    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;
  }

  function generateCsv(matrix) {
    const lines = [];
    lines.push(matrix.headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','));
    matrix.rows.forEach((r) => {
      const rowVals = matrix.headers.map((h) => {
        const val = r[h] !== undefined ? r[h] : 0;
        return typeof val === 'number' ? val.toFixed(4) : `"${String(val).replace(/"/g, '""')}"`;
      });
      lines.push(rowVals.join(','));
    });
    return lines.join('\n');
  }

  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Suscribirse a cambios del estado global
  const unsubscribe = subscribe(() => paint());
  paint();

  return () => {
    if (unsubscribe) unsubscribe();
    if (editor) editor.destroy();
    if (tooltipEl && tooltipEl.parentNode) tooltipEl.parentNode.removeChild(tooltipEl);
  };
}

