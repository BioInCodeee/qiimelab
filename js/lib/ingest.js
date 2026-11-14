// Detección automática de tipo de archivo QIIME2 y enrutado a los "slots"
// del estado compartido. Acepta directamente .qza/.qzv (los desempaqueta
// con minizip.js) o .tsv/.csv/.txt ya exportados a mano.
//
// La heurística puede equivocarse — cada módulo de arriba debe mostrar
// siempre qué se detectó y dejar corregirlo a mano (ver upload.js).

import { parseTable, normalizeHeader } from './csv.js';
import { listZipEntries, readZipText, gunzipText } from './minizip.js';
import { readProvenance } from './provenance.js';
import { parseOrdination, looksLikeOrdination } from './ordination.js';

const TAXON_KEYS = ['taxon', 'taxa', 'species', 'genus', 'feature', 'featureid', 'otu', 'asv', 'name', 'organism', 'id'];
// columna de identidad de una tabla de abundancia diferencial FUNCIONAL (por KO)
const KO_KEYS = ['ko', 'koid', 'keggko', 'kegg', 'orthology', 'orthologyid'];
const KO_CODE_RE = /^K\d{5}$/;
const LFC_KEYS = ['log2foldchange', 'log2fc', 'lfc', 'logfc', 'log2foldchg', 'foldchange'];
const PADJ_KEYS = ['padj', 'pvaladj', 'qvalue', 'qval', 'fdr', 'adjpval', 'adjustedpvalue', 'padjusted', 'pvaladjusted'];
// cabeceras que marcan la columna "resto agregado" de una tabla de abundancia relativa
const OTHERS_HEADER_KEYS = ['others', 'otros', 'other', 'resto'];
// --- recuento microbiano (placa / NMP) ---
// nombre de columna que deja claro que es un recuento de microorganismos. Solo
// términos de MÉTODO o de GRUPO FUNCIONAL (UFC, NMP, aerobios, coliformes,
// mohos…) — NADA de nombres de género/familia (Clostridium, Lactobacillus…),
// que aparecen como columnas en un barplot taxonómico.
const MICROBIAL_COUNT_STRONG = /(ufc|cfu|nmp|mpn|aerobi|coliform|mesofil|psicrofil|termofil|mohos|levadur|colonyforming|platecount|viablecount|numeromasprobable|mostprobablenumber|recuento)/;
// nombre genérico de "columna de valor" — solo cuenta como recuento con más pistas
const MICROBIAL_COUNT_WEAK = ['count', 'counts', 'valor', 'value', 'log', 'log10', 'logufc', 'logcfu', 'lognmp', 'recuento'];
// columna de factor de dilución (para el par Recuento + Dilución)
const DILUTION_RE = /^(factor)?(de)?diluc|dilution|^fd$/;
// columna que solo marca el número de réplica (NO es una variable de agrupación)
const REPLICATE_RE = /^(replica|replicas|repeticion|repeticiones|replicate|replicates|rep|reps|repl)$/;
// nombres de nivel taxonómico (QIIME2 numera: 1=reino … 7=especie)
const LEVEL_NAME_TO_NUMBER = [
  [/(^|[^a-z])(dominio|domain|reino|kingdom)([^a-z]|$)/, 1],
  [/(^|[^a-z])(filo|phylum)([^a-z]|$)/, 2],
  [/(^|[^a-z])(clase|class)([^a-z]|$)/, 3],
  [/(^|[^a-z])(orden|order)([^a-z]|$)/, 4],
  [/(^|[^a-z])(familia|family)([^a-z]|$)/, 5],
  [/(^|[^a-z])(genero|género|genus)([^a-z]|$)/, 6],
  [/(^|[^a-z])(especie|species)([^a-z]|$)/, 7],
];

function findBestColumn(headers, keys) {
  const norm = headers.map(normalizeHeader);
  for (const k of keys) {
    const idx = norm.indexOf(k);
    if (idx !== -1) return idx;
  }
  for (let i = 0; i < norm.length; i++) {
    for (const k of keys) if (norm[i].includes(k)) return i;
  }
  return -1;
}

function isNumeric(v) {
  if (v === '' || v === null || v === undefined) return false;
  return isFinite(parseFloat(v)) && /^-?[\d.eE+]+$/.test(String(v).trim());
}

// Más estricto que isNumeric: la cadena ENTERA tiene que ser un número
// (acepta notación científica "3.9e-137"). "S1-A", "Ctrl_0" → false.
function isNumericStrict(v) {
  const s = String(v == null ? '' : v).trim();
  return s !== '' && Number.isFinite(Number(s));
}

function stripQ2TypesRow(headers, rows) {
  if (rows.length === 0) return rows;
  const firstCol = headers[0];
  const firstVal = String(rows[0][firstCol] || '').trim().toLowerCase();
  if (firstVal.startsWith('#q2:types')) return rows.slice(1);
  return rows;
}

// Deduce el nivel taxonómico (1–7) del nombre del archivo: "level-6",
// "Nivel6", "…_Genero_…" → 6. Devuelve null si no hay pista.
export function guessLevelFromName(name) {
  const s = String(name || '').toLowerCase();
  const num = s.match(/level[-_ ]?(\d+)/) || s.match(/nivel[-_ ]?(\d+)/) || s.match(/\bl(\d)\b/);
  if (num) return parseInt(num[1], 10);
  for (const [re, n] of LEVEL_NAME_TO_NUMBER) if (re.test(s)) return n;
  return null;
}

/**
 * Clasifica una tabla ya parseada ({headers, rows}) y devuelve una
 * descripción de a qué slot pertenece, o null si no se reconoce.
 */
export function classifyTable(headers, rows, fileNameHint) {
  if (headers.length === 0 || rows.length === 0) return null;
  const norm = headers.map(normalizeHeader);

  // --- abundancia diferencial: log2FC + padj (por taxón o por KO) ---
  const lfcIdx = findBestColumn(headers, LFC_KEYS);
  const padjIdx = findBestColumn(headers, PADJ_KEYS);
  if (lfcIdx !== -1 && padjIdx !== -1) {
    let taxonIdx = findBestColumn(headers, KO_KEYS.concat(TAXON_KEYS));
    if (taxonIdx === lfcIdx || taxonIdx === padjIdx || taxonIdx === -1) {
      taxonIdx = headers.findIndex((_, i) => i !== lfcIdx && i !== padjIdx);
    }
    // ¿la columna de identidad son códigos KO (K#####)? -> tabla funcional
    const idKey = headers[taxonIdx];
    const koLike = idKey != null
      ? rows.filter((r) => KO_CODE_RE.test(String(r[idKey] ?? '').trim())).length
      : 0;
    const entityType = koLike >= Math.max(1, rows.length * 0.8) ? 'ko' : 'taxon';
    return { kind: 'differentialAbundance', headers, rows, entityType, mapping: { taxon: taxonIdx, lfc: lfcIdx, padj: padjIdx } };
  }

  // --- taxonomía: Feature ID + Taxon (+ Confidence) ---
  const hasFeatureId = norm.some((h) => h === 'featureid' || h === 'id');
  const hasTaxonCol = norm.some((h) => h === 'taxon' || h === 'taxonomy');
  if (hasFeatureId && hasTaxonCol) {
    // muchos exports de QIIME2 traen una fila "#q2:types  categorical
    // categorical" justo bajo la cabecera — si no se quita se cuela como un
    // "feature" falso.
    return { kind: 'taxonomy', headers, rows: stripQ2TypesRow(headers, rows) };
  }

  // --- recuento microbiano (placa UFC/mL, NMP/mL): columnas de agrupación +
  //     columna(s) de valor con nombre de recuento, o par Recuento + Dilución.
  //     Antes que "diversidad alfa" para que una tabla «Grupo, UFC/mL» no se
  //     lea como un vector de alfa. ---
  const microbial = classifyMicrobialCounts(headers, rows);
  if (microbial) return microbial;

  // --- diversidad alfa: 2 columnas, primera vacía/id, segunda numérica ---
  if (headers.length === 2) {
    const vals = rows.map((r) => r[headers[1]]);
    const numericCount = vals.filter(isNumeric).length;
    if (numericCount >= Math.max(1, vals.length * 0.9)) {
      const metricName = headers[1].trim() || (fileNameHint || 'métrica').replace(/\.[^.]+$/, '');
      return { kind: 'alphaDiversity', metricName, values: rowsToMap(rows, headers[0], headers[1]) };
    }
  }

  // --- matriz de distancias (diversidad beta): cuadrada, primera col = ids que también son cabeceras ---
  if (headers.length - 1 === rows.length && headers.length > 2) {
    const sampleIds = headers.slice(1);
    let matches = 0;
    rows.forEach((r, i) => { if (String(r[headers[0]]).trim() === sampleIds[i]) matches++; });
    if (matches >= rows.length * 0.8) {
      const matrix = rows.map((r) => sampleIds.map((id) => parseFloat(r[id])));
      const metricName = (fileNameHint || 'distancia').replace(/\.[^.]+$/, '');
      return { kind: 'betaDiversity', metricName, sampleIds, matrix };
    }
  }

  // --- taxa barplot (formato nativo del taxa-barplot.qzv de QIIME2):
  //     muchas cabeceras con ';' (cadenas de linaje d__;p__;c__…) ---
  const taxHeaderCount = headers.filter((h) => (h.match(/;/g) || []).length >= 2).length;
  if (taxHeaderCount >= 3) {
    const levelMatch = (fileNameHint || '').match(/level-(\d+)/i);
    const level = levelMatch ? parseInt(levelMatch[1], 10) : guessTaxonomyLevel(headers);
    return { kind: 'taxaBarplotLevel', level, headers, rows };
  }

  // --- taxa barplot (formato "ancho, nombres cortos"): muestras en filas,
  //     taxones como columnas con nombre corto (p. ej. "Lactobacillus"),
  //     una columna "Others"/"Otros" y a veces una columna de grupo
  //     categórica al final. Es el de
  //     resultados/11_tablas_taxonomia_limpias/<Nivel>/02_*_TOP14.csv ---
  const othersIdx = norm.findIndex((h) => OTHERS_HEADER_KEYS.includes(h));
  if (othersIdx !== -1 && headers.length >= 4 && rows.length >= 2) {
    const numericHeaders = headers.filter((h, i) => {
      if (i === 0) return false;
      const vals = rows.map((r) => r[h]);
      return vals.filter(isNumericStrict).length >= Math.max(1, vals.length * 0.9);
    });
    if (numericHeaders.includes(headers[othersIdx]) && numericHeaders.length >= 3) {
      const sampleKey = headers[0];
      // primera columna no numérica (que no sea la de id) = columna de grupo
      const groupColumn = headers.find((h, i) => i !== 0 && !numericHeaders.includes(h)) || null;
      const outHeaders = [sampleKey, ...numericHeaders];
      const outRows = rows.map((r) => {
        const o = {};
        outHeaders.forEach((h) => { o[h] = r[h]; });
        if (groupColumn) o[groupColumn] = r[groupColumn];
        return o;
      });
      return {
        kind: 'taxaBarplotLevel',
        level: guessLevelFromName(fileNameHint),
        headers: outHeaders,
        rows: outRows,
        groupColumn,
      };
    }
  }

  // --- lista de KOs por módulo funcional (KOlistVW.csv y similares):
  //     columnas "Functional Module" + "KO" ---
  const moduleIdx = norm.findIndex((h) => h === 'functionalmodule' || h === 'module' || h === 'modulofuncional' || h === 'pathway');
  const koIdx = norm.findIndex((h) => h === 'ko' || h === 'koid' || h === 'orthology' || h === 'keggko');
  if (moduleIdx !== -1 && koIdx !== -1) {
    return { kind: 'functionalCategories', headers, rows, mapping: { module: moduleIdx, ko: koIdx } };
  }

  // --- abundancia de KOs por muestra (PICRUSt2 pred_metagenome_unstrat):
  //     primera columna = ids KEGG (K#####), el resto columnas numéricas ---
  if (headers.length >= 3 && rows.length >= 5) {
    const k0 = headers[0];
    const koLike = rows.filter((r) => /^K\d{4,6}$/.test(String(r[k0]).trim())).length;
    if (koLike >= rows.length * 0.8) {
      return { kind: 'functionalKO', headers, rows, koKey: k0 };
    }
  }

  // --- conteos taxón × muestra: primera columna = etiquetas de texto
  //     (taxones / features), el RESTO son columnas numéricas (una por
  //     muestra). Es lo que sale de `qiime tools export` + `biom convert`
  //     de una feature-table, o de un collapse a un nivel sin normalizar.
  //     Sirve para presencia/ausencia (Venn/UpSet) y PERMANOVA. ---
  if (headers.length >= 3 && rows.length >= 4) {
    const label = headers[0];
    const labelNumeric = rows.filter((r) => isNumericStrict(r[label])).length;
    const valHeaders = headers.slice(1);
    let cells = 0, numCells = 0;
    valHeaders.forEach((h) => rows.forEach((r) => {
      cells++;
      if (isNumericStrict(r[h])) numCells++;
    }));
    const labelIsText = labelNumeric <= rows.length * 0.1;
    const restIsNumeric = numCells >= cells * 0.9;
    if (labelIsText && restIsNumeric) {
      const cleanRows = stripQ2TypesRow(headers, rows);
      return { kind: 'taxaCounts', headers, rows: cleanRows, taxonKey: label };
    }
  }

  // --- metadatos: primera columna tipo "sample-id" / "#SampleID" ---
  const firstNorm = norm[0];
  if (['sampleid', 'sampleid', 'id', 'sample'].includes(firstNorm) && headers.length >= 2) {
    const cleanRows = stripQ2TypesRow(headers, rows);
    return { kind: 'metadata', headers, rows: cleanRows, sampleIdKey: headers[0] };
  }

  return null;
}

/**
 * Cuando classifyTable() no reconoce una tabla, intenta decir POR QUÉ: busca
 * pistas parciales (una columna clave presente y otra ausente, tabla casi
 * cuadrada pero con ids que no casan, el nombre del archivo…) y devuelve una
 * frase que sugiere el formato esperado y el módulo al que pertenece, o null
 * si no hay ninguna pista.
 */
export function diagnoseTable(headers, rows, fileNameHint) {
  if (!Array.isArray(headers) || headers.length === 0) {
    return 'La tabla no tiene cabeceras legibles. La primera fila debe ser la fila de nombres de columna (sin título ni comentario encima).';
  }
  const norm = headers.map(normalizeHeader);
  const name = String(fileNameHint || '').toLowerCase();
  const nRows = Array.isArray(rows) ? rows.length : 0;

  // 1. abundancia diferencial: una de las dos columnas clave, no las dos
  const lfcIdx = findBestColumn(headers, LFC_KEYS);
  const padjIdx = findBestColumn(headers, PADJ_KEYS);
  if (lfcIdx !== -1 && padjIdx === -1) {
    return `Tiene una columna de log2FoldChange («${headers[lfcIdx]}») pero no encuentro la de p-valor ajustado (padj / qvalue / FDR). Es una tabla de abundancia diferencial para #/diferencial: necesita columna de identidad, log2FoldChange y padj.`;
  }
  if (padjIdx !== -1 && lfcIdx === -1) {
    return `Tiene una columna de p-valor ajustado («${headers[padjIdx]}») pero no la de log2FoldChange. Es una tabla de abundancia diferencial para #/diferencial: necesita columna de identidad, log2FoldChange y padj.`;
  }

  // 2. barplot taxonómico: alguna cabecera de linaje, pero no las 3 que pide
  const lineageHeaders = headers.filter((h) => (String(h).match(/;/g) || []).length >= 2).length;
  if (lineageHeaders >= 1 && lineageHeaders < 3) {
    return `Solo ${lineageHeaders} cabecera(s) con formato de linaje (d__;p__;c__…). Un barplot taxonómico para #/barplots necesita al menos 3 columnas de taxón, o el .qzv nativo de «qiime taxa barplot».`;
  }

  // 3. diversidad alfa: 2 columnas pero la 2ª no es suficientemente numérica
  if (headers.length === 2 && nRows > 0) {
    const numeric = rows.map((r) => r[headers[1]]).filter(isNumeric).length;
    if (numeric < nRows * 0.9) {
      return `2 columnas, pero la 2ª no es numérica (${numeric} de ${nRows} valores lo son). Un vector de diversidad alfa para #/alfa es «id de muestra , valor» con casi todos los valores numéricos.`;
    }
  }

  // 4. matriz de distancias beta: tabla cuadrada y numérica cuyos ids de fila no
  //    coinciden con las cabeceras (orden distinto o etiquetas distintas)
  if (headers.length - 1 === nRows && headers.length > 3) {
    const ids = headers.slice(1);
    let matches = 0, numCells = 0, cells = 0;
    rows.forEach((r, i) => {
      if (String(r[headers[0]]).trim() === ids[i]) matches++;
      ids.forEach((id) => { cells++; if (isNumeric(r[id])) numCells++; });
    });
    if (numCells >= cells * 0.9 && matches < nRows) {
      return 'Tabla cuadrada y numérica, pero las etiquetas de la primera columna no coinciden con las de las cabeceras. Una matriz de distancias beta para #/beta debe llevar las mismas muestras en filas y columnas, en el mismo orden.';
    }
  }

  // 4b. recuento microbiano: cabecera de recuento pero sin nada categórico
  //     por lo que agrupar (o todo numérico)
  if (norm.some((h) => MICROBIAL_COUNT_STRONG.test(h))) {
    return 'Tiene una columna con pinta de recuento microbiano (UFC / NMP / aerobios…), pero no encuentro ninguna columna de agrupación (granja, punto, grupo, tiempo…). Un recuento para #/recuentos necesita al menos una columna categórica por la que promediar las réplicas y una columna de valor.';
  }

  // 5. KOs de PICRUSt2: la primera columna tiene algunos códigos KEGG
  if (headers.length >= 2 && nRows > 0) {
    const k0 = headers[0];
    const koLike = rows.filter((r) => /^K\d{4,6}$/.test(String(r[k0] ?? '').trim())).length;
    if (koLike > 0 && koLike < nRows * 0.8) {
      return `La primera columna tiene algunos códigos KEGG (K#####) pero no la mayoría. La tabla de KOs de PICRUSt2 para #/funcional los necesita en casi todas las filas.`;
    }
  }

  // 6. metadatos: primera columna tipo sample-id pero sin más columnas
  if (['sampleid', 'id', 'sample'].includes(norm[0]) && headers.length < 2) {
    return 'La primera columna parece de identificadores de muestra pero no hay más columnas. Los metadatos necesitan al menos una variable además del id.';
  }

  // 7. sin pistas en el contenido → pista por el nombre del archivo
  const byName = [
    [/deseq|ancom|aldex|maaslin|lefse|diff.?abund|_da[_.]/, 'una tabla de abundancia diferencial para #/diferencial (identidad + log2FoldChange + padj)'],
    [/shannon|simpson|pielou|chao|observed|faith|evenness|alpha.?div/, 'un vector de diversidad alfa para #/alfa (id de muestra + valor numérico)'],
    [/bray|jaccard|unifrac|aitchison|dist.?mat|distance.?matrix|beta.?div/, 'una matriz de distancias beta para #/beta (cuadrada, mismas etiquetas en filas y columnas)'],
    [/taxonomy|taxon.*assign/, 'una tabla de taxonomía (columnas «Feature ID» y «Taxon»)'],
    [/sample.?meta|metadata|mapping.?file/, 'unos metadatos (primera columna «sample-id» + variables)'],
    [/pred_metagenome|picrust|ko.?abund|ko.?table|kegg/, 'la tabla de KOs de PICRUSt2 para #/funcional'],
    [/kolist|ko.?list|functional.?module|modulo.?funcional/, 'la lista de KOs por módulo funcional para #/funcional'],
    [/barplot|taxa.?bar|rel.?abund|abundancia.?relativa|top\d+/, 'un barplot taxonómico para #/barplots (muestras en filas, taxones en columnas)'],
    [/conteos|counts|feature.?table|otu.?table|asv.?table/, 'una tabla de conteos taxón × muestra para #/venn (etiquetas de texto + columnas numéricas por muestra)'],
    [/ufc|cfu|\bnmp\b|\bmpn\b|recuento|placa|aerobi|coliform|mesofil/, 'un recuento microbiano para #/recuentos (columnas de agrupación + una o varias columnas de valor UFC/NMP, réplicas en filas)'],
  ];
  for (const [re, what] of byName) {
    if (re.test(name)) return `Por el nombre parece ${what}. Comprueba que las columnas casan con ese formato (ver la guía de #/cargar).`;
  }
  return null;
}

/** ¿la columna `h` es numérica en (casi) todas las filas? */
function columnIsNumeric(rows, h) {
  if (rows.length === 0) return false;
  const ok = rows.filter((r) => isNumericStrict(r[h])).length;
  return ok >= Math.max(1, rows.length * 0.85);
}

/**
 * Recuento microbiano (placa: UFC/mL; NMP: NMP/mL). Patrón de fondo: varias
 * filas de réplica que comparten las columnas de agrupación (granja, punto,
 * grupo, tiempo…) + una o varias columnas de valor por organismo, o un par
 * Recuento + Dilución.
 *
 * Heurística deliberadamente laxa (como el resto de ingest.js) — el mapeo de
 * columnas en el módulo es la red de seguridad.
 */
function classifyMicrobialCounts(headers, rows) {
  if (headers.length < 2 || rows.length < 2) return null;
  const norm = headers.map(normalizeHeader);

  const numeric = headers.filter((h) => columnIsNumeric(rows, h));
  const numericSet = new Set(numeric);
  const dilutionCol = headers.find((h, i) => DILUTION_RE.test(norm[i]));
  const categorical = headers.filter((h) => !numericSet.has(h) && h !== dilutionCol);

  // columnas de valor: numéricas cuyo nombre grita "recuento" (fuertes)…
  let valueCols = headers.filter((h, i) => numericSet.has(h) && h !== dilutionCol && MICROBIAL_COUNT_STRONG.test(norm[i]));
  let strong = valueCols.length > 0;
  // …o el par Recuento/valor + Dilución …
  if (!strong && dilutionCol) {
    valueCols = headers.filter((h, i) => numericSet.has(h) && h !== dilutionCol &&
      (MICROBIAL_COUNT_WEAK.includes(norm[i]) || MICROBIAL_COUNT_STRONG.test(norm[i])));
    if (valueCols.length === 0) valueCols = numeric.filter((h) => h !== dilutionCol);
  }
  // …o una columna de valor genérica ("valor"/"count"/"log") con ≥2 columnas de agrupación
  if (valueCols.length === 0 && categorical.length >= 2) {
    valueCols = headers.filter((h, i) => numericSet.has(h) && MICROBIAL_COUNT_WEAK.includes(norm[i]));
  }
  if (valueCols.length === 0) return null;
  if (categorical.length === 0 && !dilutionCol) return null; // sin nada por lo que agrupar

  // columnas de agrupación por defecto: las categóricas que NO son un índice de réplica
  const groupColHeaders = categorical.filter((h) => !REPLICATE_RE.test(normalizeHeader(h)));
  const groupCols = (groupColHeaders.length ? groupColHeaders : categorical).map((h) => headers.indexOf(h));

  const idxOf = (h) => headers.indexOf(h);
  return {
    kind: 'microbialCounts',
    headers,
    rows,
    groupCols,
    valueCols: valueCols.map(idxOf),
    dilutionCol: dilutionCol != null ? idxOf(dilutionCol) : null,
    // por defecto: NO re-loguear si la cabecera ya dice "log"; sí si son crudos
    alreadyLog: valueCols.some((h) => /\blog/.test(normalizeHeader(h))),
    strong,
  };
}

function guessTaxonomyLevel(headers) {
  let maxSegments = 0;
  headers.forEach((h) => {
    const segs = (h.match(/;/g) || []).length + 1;
    if (h.includes(';') && segs > maxSegments) maxSegments = segs;
  });
  return maxSegments || null;
}

function rowsToMap(rows, keyCol, valCol) {
  const map = {};
  rows.forEach((r) => {
    const k = String(r[keyCol]).trim();
    const v = parseFloat(r[valCol]);
    if (k && isFinite(v)) map[k] = v;
  });
  return map;
}

/**
 * Procesa un File del navegador (drag&drop o <input type=file>).
 * Devuelve { results: [...], warnings: [...] } — un mismo archivo .qza/.qzv
 * puede producir varios resultados (p. ej. un taxa-barplot.qzv trae 7 niveles).
 */
export async function ingestFile(file) {
  const name = file.name;
  const lower = name.toLowerCase();
  const results = [];
  const warnings = [];

  // --- FASTQ (.fastq/.fq, con o sin .gz) ---
  // No se parsea aquí: el módulo de control de calidad lo lee en streaming.
  // Detección: extensión + (si no está comprimido) la primera línea empieza por '@'.
  if (/\.(fastq|fq)(\.gz)?$/i.test(lower)) {
    if (!lower.endsWith('.gz')) {
      let head = '';
      try { head = await file.slice(0, 400).text(); } catch (e) { /* noop */ }
      if (head && head.replace(/^\s+/, '')[0] !== '@') {
        warnings.push('"' + name + '": no parece un FASTQ (la primera línea no empieza por "@").');
        return { results, warnings };
      }
    }
    results.push({ kind: 'sequenceQC', file, name });
    return { results, warnings };
  }

  if (lower.endsWith('.qza') || lower.endsWith('.qzv')) {
    const buffer = await file.arrayBuffer();
    let entries;
    try {
      entries = listZipEntries(buffer);
    } catch (e) {
      warnings.push('"' + name + '": ' + e.message);
      return { results, warnings };
    }
    // La procedencia vive en el MISMO ZIP que ya está abierto: leerla aquí no
    // cuesta una lectura extra del archivo. Nunca debe impedir que el dato
    // entre, así que cualquier fallo se ignora y se sigue sin procedencia.
    let provenance = null;
    try {
      provenance = await readProvenance(buffer, entries);
    } catch (e) {
      provenance = null;
    }

    const dataEntries = entries.filter((e) => /\/data\//.test(e.name) && !e.name.endsWith('/'));
    if (dataEntries.length === 0) {
      warnings.push('"' + name + '": no se encontró contenido reconocible dentro del artefacto QIIME2.');
      return { results, warnings };
    }
    const hasBiomOnly = dataEntries.some((e) => /\.biom$/i.test(e.name))
      && !dataEntries.some((e) => /\.(tsv|csv)$/i.test(e.name));
    if (hasBiomOnly) {
      warnings.push('"' + name + '" contiene una tabla en formato BIOM (binario). Esta versión aún no lee BIOM en el navegador — expórtala con `biom convert -i feature-table.biom -o feature-table.tsv --to-tsv` y sube el .tsv resultante.');
    }
    // los nombres internos genéricos (distance-matrix.tsv, alpha-diversity.tsv…)
    // no dicen qué métrica es — para esos usamos el nombre del .qza de fuera
    // (bray_curtis.qza → "bray_curtis").
    const GENERIC_INNER = /^(distance-matrix|alpha-diversity|ordination|data|feature-table|taxonomy|metadata)\.[a-z0-9]+$/i;
    const outerBase = name.replace(/\.[^.]+$/, '');
    for (const entry of dataEntries) {
      if (!/\.(tsv|csv|txt)$/i.test(entry.name)) continue;
      let text;
      try {
        text = await readZipText(buffer, entry);
      } catch (e) {
        warnings.push('"' + entry.name + '": ' + e.message);
        continue;
      }
      const shortName = entry.name.split('/').pop();
      const hint = GENERIC_INNER.test(shortName) ? outerBase : shortName;
      // ordination.txt (PCoA.qza) — coordenadas ya calculadas
      if (/\.txt$/i.test(shortName)) {
        if (looksLikeOrdination(text)) {
          const ord = parseOrdination(text, hint);
          if (ord) { results.push({ kind: 'ordination', ...ord }); }
          else warnings.push('"' + shortName + '" (dentro de ' + name + '): ordination.txt ilegible.');
        }
        continue;
      }
      const { headers, rows } = parseTable(text);
      const classified = classifyTable(headers, rows, hint);
      if (classified) results.push(classified);
      else {
        const hint2 = diagnoseTable(headers, rows, hint);
        warnings.push('"' + shortName + '" (dentro de ' + name + '): no se reconoce el formato.' + (hint2 ? ' ' + hint2 : ' Puedes mapearlo a mano si es necesario.'));
      }
    }
    return { results, warnings, provenance };
  }

  // --- .gz suelto (gzip plano, NO un zip): los TSV de PICRUSt2 vienen así ---
  if (lower.endsWith('.gz')) {
    const innerName = name.replace(/\.gz$/i, '');
    if (!/\.(tsv|csv|txt)$/i.test(innerName)) {
      warnings.push('"' + name + '": solo se descomprimen .tsv.gz / .csv.gz / .txt.gz. Los .biom.gz u otros binarios comprimidos no se leen aquí.');
      return { results, warnings };
    }
    let text;
    try {
      text = await gunzipText(await file.arrayBuffer());
    } catch (e) {
      warnings.push('"' + name + '": no se ha podido descomprimir — ' + (e && e.message ? e.message : 'gzip inválido') + '.');
      return { results, warnings };
    }
    const { headers, rows } = parseTable(text);
    const classified = classifyTable(headers, rows, innerName);
    if (classified) results.push(classified);
    else {
      const hint = diagnoseTable(headers, rows, innerName);
      warnings.push('"' + innerName + '" (descomprimido de ' + name + '): no se ha reconocido el formato.' + (hint ? ' ' + hint : ''));
    }
    return { results, warnings };
  }

  if (lower.endsWith('.tsv') || lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = await file.text();
    // skbio "Ordination Results" (PCoA/PCA): coordenadas ya calculadas
    if (looksLikeOrdination(text)) {
      const ord = parseOrdination(text, name);
      if (ord) { results.push({ kind: 'ordination', ...ord }); return { results, warnings }; }
      warnings.push('"' + name + '": parece un ordination.txt pero no se han podido leer las coordenadas.');
      return { results, warnings };
    }
    const { headers, rows } = parseTable(text);
    const classified = classifyTable(headers, rows, name);
    if (classified) results.push(classified);
    else {
      const hint = diagnoseTable(headers, rows, name);
      warnings.push('"' + name + '": no se ha podido determinar qué tipo de dato es.' +
        (hint ? ' ' + hint : ' Revisa que la primera fila tenga cabeceras, o usa la guía de formatos de #/cargar.'));
    }
    return { results, warnings };
  }

  warnings.push('"' + name + '": formato no soportado (se aceptan .qza, .qzv, .tsv, .csv, .txt y .tsv.gz/.csv.gz).');
  return { results, warnings };
}
