// Script de preparación de datos (Node, fuera de lo que se sirve al navegador).
// Amplía la cobertura de géneros de js/lib/phenotypes.js usando The Microbe
// Directory (MD2) — https://github.com/dcdanko/MD2, licencia MIT.
//
// Uso:  node scripts/build-phenotypes-md2.mjs [--dry-run] [--threshold=0.7]
//
// Qué hace:
//   1. Descarga (con caché local en scripts/.md2-cache/, no versionado) los
//      CSV de MD2 que necesitamos vía el endpoint de LFS de GitHub
//      (media.githubusercontent.com — raw.githubusercontent.com solo da el
//      puntero LFS, no el contenido, porque MD2 versiona sus .csv con LFS).
//   2. Agrega esas filas a nivel de GÉNERO (no de especie: el 16S/ITS que
//      analiza Smart-175 rara vez resuelve más allá de género) por consenso:
//      un género solo recibe un rasgo si el % de especies con evidencia que
//      apuntan a ese rasgo supera --threshold (por defecto 0.7 = 70%).
//   3. Compara automáticamente contra los géneros ya curados a mano en
//      js/lib/phenotypes.js: si MD2 coincide, no hace nada (ya está); si MD2
//      añade un género nuevo, lo añade; si MD2 CONTRADICE un rasgo ya curado
//      a mano, NO sobrescribe — lo deja en un informe de conflictos para
//      revisión manual (la fuente agregada puede tener ruido, ver README de
//      MD2 y CLAUDE.md del proyecto).
//   4. Reescribe js/lib/phenotypes.js con la cobertura ampliada.
//
// Columnas de MD2 usadas y su mapeo a las categorías/rasgos que YA existían
// en PHENOTYPE_CATEGORIES (ver js/lib/phenotypes.js):
//   gram_stain              -> gram_stain.{gram_positive,gram_negative}
//   spore_forming           -> sporulation.{spore_forming,non_spore_forming}
//   optimal_temperature     -> temperature_range.{thermophile,mesophile,psychrophile}
//   optimal_ph              -> ph_range.{acidophile,neutrophile,alkaliphile}
//   extreme_environment     -> ecology.extremophile
//   biofilm_forming         -> ecology.biofilm_forming
//   animal_pathogen /
//   plant_pathogen /
//   pathogenicity (COGEM)   -> ecology.pathogenic
//   (dataset separado Halospecies.csv, clasificación de halotolerancia)
//                           -> salinity.{halophile,halotolerant}
//
// Columnas de MD2 SIN categoría equivalente hoy en PHENOTYPE_CATEGORIES
// (no se usan en esta pasada, requerirían una categoría nueva):
//   antimicrobial_susceptibility (resistencia/susceptibilidad a antimicrobianos)
//   animal_pathogen / plant_pathogen por separado (aquí se funden en "pathogenic" genérico)
//   pathogenicity (rating COGEM 1-4, aquí solo se usa como refuerzo booleano)
//
// Rasgos de PHENOTYPE_CATEGORIES que MD2 NO cubre en absoluto (se mantienen
// tal cual estaban, solo con la curación manual previa):
//   cell_morphology (bacillus/coccus/spirillum/pleomorphic)
//   motility (motile/non_motile)
//   oxygen_requirement (aerobe/anaerobe/facultative_anaerobe)
//   key_enzymes (catalase/oxidase/cellulase)

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(__dirname, '.md2-cache');
const PHENOTYPES_PATH = path.join(APP_ROOT, 'js', 'lib', 'phenotypes.js');
const REPORT_PATH = path.join(__dirname, 'md2-conflicts-report.md');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const thresholdArg = args.find((a) => a.startsWith('--threshold='));
const CONSENSUS_THRESHOLD = thresholdArg ? parseFloat(thresholdArg.split('=')[1]) : 0.7;

const MD2_SOURCES = {
  main: 'https://media.githubusercontent.com/media/dcdanko/MD2/master/datasets/all/microbe-directory.csv',
  halo: 'https://media.githubusercontent.com/media/dcdanko/MD2/master/datasets/all/Halospecies.csv',
};

// ---------------------------------------------------------------------------
// Descarga con caché local
// ---------------------------------------------------------------------------

async function fetchCached(url, cacheName) {
  await mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, cacheName);
  if (existsSync(cachePath)) {
    console.log(`  (caché) ${cacheName}`);
    return readFile(cachePath, 'utf-8');
  }
  console.log(`  descargando ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fallo al descargar ${url}: HTTP ${res.status}`);
  const text = await res.text();
  await writeFile(cachePath, text, 'utf-8');
  return text;
}

// ---------------------------------------------------------------------------
// Parser CSV mínimo (RFC 4180: comillas, comas y saltos de línea dentro de
// campos citados, comillas escapadas ""). Sin dependencias.
// ---------------------------------------------------------------------------

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvToObjects(text) {
  const rows = parseCSV(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.replace(/^﻿/, '').trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0] === '') continue;
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = (rows[r][c] ?? '').trim();
    out.push(obj);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Agregación por género con consenso
// ---------------------------------------------------------------------------

// tally: Map<genus, Map<label, count>> + Map<genus, totalWithEvidence>
function addVote(tally, genus, label) {
  if (!tally.has(genus)) tally.set(genus, new Map());
  const m = tally.get(genus);
  m.set(label, (m.get(label) || 0) + 1);
}

function consensusLabel(tally, genus, threshold) {
  const m = tally.get(genus);
  if (!m) return null;
  let total = 0;
  let best = null;
  let bestCount = 0;
  for (const [label, count] of m) {
    total += count;
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  if (total === 0) return null;
  if (bestCount / total >= threshold) return best;
  return null;
}

function buildGramTally(rows) {
  const tally = new Map();
  const GRAM_LABEL = { 0: 'gram_negative', 1: 'gram_positive' }; // 2 = Intermediate, se ignora
  for (const row of rows) {
    const g = row.genus;
    const v = row.gram_stain;
    if (!g || v === '') continue;
    const label = GRAM_LABEL[v];
    if (!label) continue;
    addVote(tally, g, label);
  }
  return tally;
}

function buildSporulationTally(rows) {
  const tally = new Map();
  const LABEL = { 0: 'non_spore_forming', 1: 'spore_forming' };
  for (const row of rows) {
    const g = row.genus;
    const v = row.spore_forming;
    if (!g || v === '') continue;
    const label = LABEL[v];
    if (!label) continue;
    addVote(tally, g, label);
  }
  return tally;
}

function buildBooleanTally(rows, column, positiveLabel) {
  // Vota "positiveLabel" cuando la fila vale 1; cuando vale 0 vota un
  // "__negative__" interno para que cuente como evidencia total, pero nunca
  // se emite como rasgo (ecology.* son banderas independientes, no exclusivas).
  const tally = new Map();
  for (const row of rows) {
    const g = row.genus;
    const v = row[column];
    if (!g || v === '') continue;
    addVote(tally, g, v === '1' ? positiveLabel : '__negative__');
  }
  return tally;
}

function buildPathogenicTally(rows) {
  // Combina animal_pathogen, plant_pathogen y pathogenicity (rating COGEM
  // 1-4, donde >=2 indica riesgo apreciable). Una fila cuenta como evidencia
  // si al menos una de las tres columnas tiene valor; es "pathogenic" si
  // cualquiera de ellas lo indica.
  const tally = new Map();
  for (const row of rows) {
    const g = row.genus;
    if (!g) continue;
    const hasEvidence =
      row.animal_pathogen !== '' || row.plant_pathogen !== '' || row.pathogenicity !== '';
    if (!hasEvidence) continue;
    const isPathogenic =
      row.animal_pathogen === '1' ||
      row.plant_pathogen === '1' ||
      (row.pathogenicity !== '' && parseInt(row.pathogenicity, 10) >= 2);
    addVote(tally, g, isPathogenic ? 'pathogenic' : '__negative__');
  }
  return tally;
}

function buildTemperatureTally(rows) {
  const tally = new Map();
  for (const row of rows) {
    const g = row.genus;
    const v = row.optimal_temperature;
    if (!g || v === '') continue;
    const t = parseFloat(v);
    if (Number.isNaN(t)) continue;
    let label;
    if (t > 45) label = 'thermophile';
    else if (t < 20) label = 'psychrophile';
    else label = 'mesophile';
    addVote(tally, g, label);
  }
  return tally;
}

function buildPhTally(rows) {
  const tally = new Map();
  for (const row of rows) {
    const g = row.genus;
    const v = row.optimal_ph;
    if (!g || v === '') continue;
    const ph = parseFloat(v);
    if (Number.isNaN(ph)) continue;
    let label;
    if (ph < 5.5) label = 'acidophile';
    else if (ph > 8) label = 'alkaliphile';
    else label = 'neutrophile';
    addVote(tally, g, label);
  }
  return tally;
}

function buildSalinityTally(haloRows) {
  const tally = new Map();
  for (const row of haloRows) {
    const species = row.Specie || row.specie || '';
    const genus = species.trim().split(/\s+/)[0];
    if (!genus) continue;
    const cls = (row['Halotolerance classification'] || '').trim();
    if (!cls) continue;
    const label = cls === 'Extreme' ? 'halophile' : 'halotolerant'; // Moderate/Slight
    addVote(tally, genus, label);
  }
  return tally;
}

// ---------------------------------------------------------------------------
// Fusión con los datos curados a mano (import directo del módulo actual)
// ---------------------------------------------------------------------------

// Grupos "mutuamente excluyentes": un género solo puede estar en UN rasgo del
// grupo. Un choque real (MD2 asigna un rasgo distinto al ya curado) se
// reporta y NO se sobrescribe.
const EXCLUSIVE_GROUPS = [
  { category: 'gram_stain', traits: ['gram_positive', 'gram_negative'] },
  { category: 'sporulation', traits: ['spore_forming', 'non_spore_forming'] },
  { category: 'temperature_range', traits: ['thermophile', 'mesophile', 'psychrophile'] },
  { category: 'ph_range', traits: ['acidophile', 'neutrophile', 'alkaliphile'] },
  { category: 'salinity', traits: ['halophile', 'halotolerant'] },
];

// Banderas independientes: añadir nunca "choca" con otro rasgo del mismo
// grupo (un género puede ser biofilm_forming Y pathogenic a la vez).
const INDEPENDENT_TRAITS = [
  { category: 'ecology', trait: 'biofilm_forming' },
  { category: 'ecology', trait: 'pathogenic' },
  { category: 'ecology', trait: 'extremophile' },
];

// Resoluciones manuales FIJADAS — 18 géneros donde MD2 contradecía la
// curación manual en un grupo excluyente, revisados caso por caso con
// criterio biológico (ver scripts/md2-conflicts-report.md y
// qiimelab-prompt-resolver-conflictos-md2.md para el razonamiento completo
// de cada uno; aplicado en js/lib/phenotypes.js el 2026-09-16).
//
// `md2At` es lo que opinaba el consenso de MD2 cuando se fijó esta decisión.
// Mientras una regeneración futura vea que MD2 sigue opinando lo mismo, el
// override se aplica en silencio (no se vuelve a reportar como conflicto
// "nuevo" algo que ya se decidió). Si MD2 cambia de opinión respecto a
// `md2At`, el override YA NO tapa el aviso — se reporta de nuevo como
// conflicto (con una nota explicando que la fuente cambió desde que se
// fijó), para que alguien pueda revisarlo otra vez con el dato actualizado.
const MANUAL_OVERRIDES = [
  { category: 'sporulation', genus: 'Actinomyces', trait: 'non_spore_forming', md2At: 'non_spore_forming' },
  { category: 'ph_range', genus: 'Helicobacter', trait: 'neutrophile', md2At: 'neutrophile' },
  { category: 'ph_range', genus: 'Enterococcus', trait: 'alkaliphile', md2At: 'alkaliphile' },
  { category: 'salinity', genus: 'Halobacterium', trait: 'halophile', md2At: 'halotolerant' },
  { category: 'salinity', genus: 'Staphylococcus', trait: 'halotolerant', md2At: 'halophile' },
  { category: 'temperature_range', genus: 'Campylobacter', trait: 'thermophile', md2At: 'mesophile' },
  { category: 'temperature_range', genus: 'Psychrobacter', trait: 'psychrophile', md2At: 'mesophile' },
  { category: 'temperature_range', genus: 'Pseudoalteromonas', trait: 'psychrophile', md2At: 'mesophile' },
  { category: 'temperature_range', genus: 'Shewanella', trait: 'mesophile', md2At: 'mesophile' },
  { category: 'temperature_range', genus: 'Flavobacterium', trait: 'mesophile', md2At: 'mesophile' },
  { category: 'ph_range', genus: 'Lactobacillus', trait: 'acidophile', md2At: 'neutrophile' },
  { category: 'ph_range', genus: 'Gluconobacter', trait: 'acidophile', md2At: 'neutrophile' },
  { category: 'ph_range', genus: 'Bifidobacterium', trait: 'neutrophile', md2At: 'neutrophile' },
  { category: 'ph_range', genus: 'Streptococcus', trait: 'neutrophile', md2At: 'neutrophile' },
  { category: 'ph_range', genus: 'Pediococcus', trait: 'neutrophile', md2At: 'neutrophile' },
  { category: 'salinity', genus: 'Halobacillus', trait: 'halophile', md2At: 'halotolerant' },
  { category: 'salinity', genus: 'Salinicoccus', trait: 'halophile', md2At: 'halotolerant' },
  { category: 'salinity', genus: 'Halomonas', trait: 'halotolerant', md2At: 'halotolerant' },
];
function findOverride(category, genus) {
  return MANUAL_OVERRIDES.find((o) => o.category === category && o.genus === genus) || null;
}

function findExistingTrait(curated, category, traits, genus) {
  const cat = curated[category] || {};
  for (const trait of traits) {
    const list = cat[trait] || [];
    if (list.includes(genus)) return trait;
  }
  return null;
}

function mergeExclusiveGroup(curated, additions, conflicts, category, traits, tally) {
  for (const genus of tally.keys()) {
    const md2Trait = consensusLabel(tally, genus, CONSENSUS_THRESHOLD);
    if (!md2Trait || !traits.includes(md2Trait)) continue;
    const override = findOverride(category, genus);
    if (override) {
      if (md2Trait === override.md2At) continue; // ya decidido contra esta misma opinión de MD2, no volver a tocar
      // MD2 cambió de opinión desde que se fijó el override: el valor final
      // sigue siendo el fijado a mano (no se pisa solo), pero si nadie lo
      // revisa esto quedaría desactualizado en silencio — mejor avisar.
      conflicts.push({
        category, genus, curated: override.trait, md2: md2Trait,
        note: `override fijado contra md2="${override.md2At}", pero MD2 ahora dice "${md2Trait}" — revisar de nuevo`,
      });
      continue;
    }
    const existingTrait = findExistingTrait(curated, category, traits, genus);
    if (existingTrait === md2Trait) continue; // ya coincide, nada que hacer
    if (existingTrait && existingTrait !== md2Trait) {
      conflicts.push({ category, genus, curated: existingTrait, md2: md2Trait });
      continue; // no sobrescribir un rasgo curado a mano que MD2 contradice
    }
    if (!additions[category]) additions[category] = {};
    if (!additions[category][md2Trait]) additions[category][md2Trait] = [];
    additions[category][md2Trait].push(genus);
  }
}

function mergeIndependentTrait(curated, additions, category, trait, tally) {
  const cat = curated[category] || {};
  const existingList = cat[trait] || [];
  for (const genus of tally.keys()) {
    const label = consensusLabel(tally, genus, CONSENSUS_THRESHOLD);
    if (label !== trait) continue; // consenso negativo o insuficiente
    if (existingList.includes(genus)) continue;
    if (!additions[category]) additions[category] = {};
    if (!additions[category][trait]) additions[category][trait] = [];
    additions[category][trait].push(genus);
  }
}

// ---------------------------------------------------------------------------
// Serialización de vuelta a js/lib/phenotypes.js
// ---------------------------------------------------------------------------

function serializeTraitArray(list) {
  // Mantiene la convención existente: nombre plano + alias g__Genero.
  const seen = new Set();
  const out = [];
  for (const genus of list) {
    if (seen.has(genus)) continue;
    seen.add(genus);
    out.push(genus, `g__${genus}`);
  }
  return out;
}

function applyAdditions(curated, additions) {
  const merged = JSON.parse(JSON.stringify(curated));
  for (const [category, traits] of Object.entries(additions)) {
    if (!merged[category]) merged[category] = {};
    for (const [trait, genusList] of Object.entries(traits)) {
      const uniqueNew = [...new Set(genusList)];
      const newEntries = serializeTraitArray(uniqueNew);
      merged[category][trait] = [...(merged[category][trait] || []), ...newEntries];
    }
  }
  return merged;
}

function jsArrayLiteral(arr, indent) {
  const pad = ' '.repeat(indent);
  const items = arr.map((s) => `'${s.replace(/'/g, "\\'")}'`);
  // Igual que el archivo original: una línea larga con envoltorio simple.
  const lines = [];
  let current = pad;
  for (const item of items) {
    const piece = item + ', ';
    if (current.length + piece.length > 100 && current.trim().length > 0) {
      lines.push(current.replace(/, $/, ','));
      current = pad;
    }
    current += piece;
  }
  if (current.trim().length > 0) lines.push(current.replace(/,\s*$/, ''));
  return lines.join('\n');
}

const CATEGORY_ORDER = [
  'gram_stain',
  'cell_morphology',
  'motility',
  'sporulation',
  'oxygen_requirement',
  'temperature_range',
  'ph_range',
  'key_enzymes',
  'ecology',
  'salinity',
];

// Única fuente de verdad de qué rasgos pertenece a cada categoría — se usa
// tanto para renderizar PHENOTYPE_CATEGORIES como para calcular traitsCount,
// así nunca puede desincronizarse del bloque literal (el archivo original
// tenía un traitsCount:28 desfasado del recuento real de 29).
const CATEGORY_TRAITS = {
  gram_stain: ['gram_positive', 'gram_negative'],
  cell_morphology: ['bacillus', 'coccus', 'spirillum', 'pleomorphic'],
  motility: ['motile', 'non_motile'],
  sporulation: ['spore_forming', 'non_spore_forming'],
  oxygen_requirement: ['aerobe', 'anaerobe', 'facultative_anaerobe'],
  temperature_range: ['thermophile', 'mesophile', 'psychrophile'],
  ph_range: ['acidophile', 'neutrophile', 'alkaliphile'],
  key_enzymes: ['catalase_positive', 'catalase_negative', 'oxidase_positive', 'oxidase_negative', 'cellulase_positive'],
  ecology: ['biofilm_forming', 'pathogenic', 'extremophile'],
  salinity: ['halophile', 'halotolerant'],
};
const TRAITS_COUNT = Object.values(CATEGORY_TRAITS).reduce((sum, list) => sum + list.length, 0);

const CATEGORY_TITLES = {
  gram_stain: '1. Tinción Gram',
  cell_morphology: '2. Morfología Celular',
  motility: '3. Movilidad',
  sporulation: '4. Esporulación',
  oxygen_requirement: '5. Requerimiento de Oxígeno',
  temperature_range: '6. Rango de Temperatura Óptima',
  ph_range: '7. Rango de pH',
  key_enzymes: '8. Enzimas Clave y Diagnósticas',
  ecology: '9. Ecología y Estilo de Vida',
  salinity: '10. Tolerancia Salina',
};

function renderDefaultPhenotypes(merged) {
  const blocks = [];
  for (const category of CATEGORY_ORDER) {
    const traits = merged[category] || {};
    const traitBlocks = Object.entries(traits).map(([trait, list]) => {
      return `    ${trait}: [\n${jsArrayLiteral(list, 6)}\n    ],`;
    });
    blocks.push(
      `  // -------------------------------------------------------------------------\n` +
        `  // ${CATEGORY_TITLES[category]}\n` +
        `  // -------------------------------------------------------------------------\n` +
        `  ${category}: {\n${traitBlocks.join('\n')}\n  },`
    );
  }
  return blocks.join('\n\n');
}

function renderFile(merged, stats) {
  const body = renderDefaultPhenotypes(merged);
  return `// Diccionario de referencia fenotípica, morfológica, fisiológica y ecológica
// Mapeo estandarizado de taxones procariontes a rasgos biológicos fundamentales.
// Fuentes: curación manual (BacDive/metaTraits) + agregación a nivel de género
// desde The Microbe Directory (MD2, https://github.com/dcdanko/MD2, MIT),
// generada con scripts/build-phenotypes-md2.mjs (re-ejecutable cuando MD2
// publique una versión nueva; umbral de consenso: ${CONSENSUS_THRESHOLD}).

export const PHENOTYPES_METADATA = {
  name: 'BacDive/metaTraits + MD2 Core',
  version: '3.0.0',
  reference: 'BacDive - The Bacterial Diversity Metadatabase (DSMZ) & metaTraits ontology (curación manual inicial); The Microbe Directory v2 (Danko et al., MIT License, https://github.com/dcdanko/MD2) agregado a nivel de género por consenso (>=${Math.round(CONSENSUS_THRESHOLD * 100)}% de especies con evidencia).',
  categoriesCount: 10,
  traitsCount: ${TRAITS_COUNT},
  genusCoverage: ${stats.genusCoverage},
};

export const PHENOTYPE_CATEGORIES = {
  gram_stain: {
    name: { es: 'Tinción Gram', en: 'Gram Stain' },
    traits: ${JSON.stringify(CATEGORY_TRAITS.gram_stain)},
  },
  cell_morphology: {
    name: { es: 'Morfología Celular', en: 'Cell Morphology' },
    traits: ${JSON.stringify(CATEGORY_TRAITS.cell_morphology)},
  },
  motility: {
    name: { es: 'Movilidad', en: 'Motility' },
    traits: ${JSON.stringify(CATEGORY_TRAITS.motility)},
  },
  sporulation: {
    name: { es: 'Esporulación', en: 'Sporulation' },
    traits: ${JSON.stringify(CATEGORY_TRAITS.sporulation)},
  },
  oxygen_requirement: {
    name: { es: 'Requerimiento de Oxígeno', en: 'Oxygen Requirement' },
    traits: ${JSON.stringify(CATEGORY_TRAITS.oxygen_requirement)},
  },
  temperature_range: {
    name: { es: 'Rango de Temperatura Óptima', en: 'Optimal Temperature Range' },
    traits: ${JSON.stringify(CATEGORY_TRAITS.temperature_range)},
  },
  ph_range: {
    name: { es: 'Rango de pH', en: 'pH Range' },
    traits: ${JSON.stringify(CATEGORY_TRAITS.ph_range)},
  },
  key_enzymes: {
    name: { es: 'Enzimas Clave y Diagnósticas', en: 'Key Diagnostic Enzymes' },
    traits: ${JSON.stringify(CATEGORY_TRAITS.key_enzymes)},
  },
  ecology: {
    name: { es: 'Ecología y Estilo de Vida', en: 'Ecology and Lifestyle' },
    traits: ${JSON.stringify(CATEGORY_TRAITS.ecology)},
  },
  salinity: {
    name: { es: 'Tolerancia Salina', en: 'Salinity Tolerance' },
    traits: ${JSON.stringify(CATEGORY_TRAITS.salinity)},
  },
};

export const DEFAULT_PHENOTYPES = {
${body}
};

// Asignar los rasgos planos directamente sobre DEFAULT_PHENOTYPES para máxima compatibilidad
// (permite acceso tanto categorizado como plano: DEFAULT_PHENOTYPES.gram_positive)
Object.keys(DEFAULT_PHENOTYPES).forEach((catKey) => {
  const catObj = DEFAULT_PHENOTYPES[catKey];
  if (catObj && typeof catObj === 'object' && !Array.isArray(catObj)) {
    Object.assign(DEFAULT_PHENOTYPES, catObj);
  }
});

export const FLAT_PHENOTYPES = { ...DEFAULT_PHENOTYPES };

export const PHENOTYPE_NAMES = {
  // Tinción Gram
  gram_positive: { es: 'Gram positivo', en: 'Gram-positive' },
  gram_negative: { es: 'Gram negativo', en: 'Gram-negative' },

  // Morfología Celular
  bacillus: { es: 'Bacilo (Bastón)', en: 'Bacillus (Rod)' },
  coccus: { es: 'Coco (Esférico)', en: 'Coccus (Spherical)' },
  spirillum: { es: 'Espirilo / Espiral', en: 'Spirillum / Spiral' },
  pleomorphic: { es: 'Pleomórfico', en: 'Pleomorphic' },

  // Movilidad
  motile: { es: 'Móvil', en: 'Motile' },
  non_motile: { es: 'No móvil (Inmóvil)', en: 'Non-motile' },

  // Esporulación
  spore_forming: { es: 'Formador de endosporas', en: 'Spore-forming' },
  non_spore_forming: { es: 'No formador de esporas', en: 'Non-spore-forming' },

  // Requerimiento de Oxígeno
  aerobe: { es: 'Aerobio estricto', en: 'Strict aerobe' },
  anaerobe: { es: 'Anaerobio estricto', en: 'Strict anaerobe' },
  facultative_anaerobe: { es: 'Anaerobio facultativo', en: 'Facultative anaerobe' },

  // Rango de Temperatura
  thermophile: { es: 'Termófilo (>45°C)', en: 'Thermophile (>45°C)' },
  mesophile: { es: 'Mesófilo (20-45°C)', en: 'Mesophile (20-45°C)' },
  psychrophile: { es: 'Psicrófilo (<20°C)', en: 'Psychrophile (<20°C)' },

  // Rango de pH
  acidophile: { es: 'Acidófilo (pH < 5.5)', en: 'Acidophile (pH < 5.5)' },
  neutrophile: { es: 'Neutrófilo (pH 5.5-8)', en: 'Neutrophile (pH 5.5-8)' },
  alkaliphile: { es: 'Alcalífilo (pH > 8)', en: 'Alkaliphile (pH > 8)' },

  // Enzimas Clave
  catalase_positive: { es: 'Catalasa positiva', en: 'Catalase positive' },
  catalase_negative: { es: 'Catalasa negativa', en: 'Catalase negative' },
  oxidase_positive: { es: 'Oxidasa positiva', en: 'Oxidase positive' },
  oxidase_negative: { es: 'Oxidasa negativa', en: 'Oxidase negative' },
  cellulase_positive: { es: 'Celulasa positiva (Celulolítico)', en: 'Cellulase positive' },

  // Ecología y Estilo de Vida
  biofilm_forming: { es: 'Formador de biopelícula', en: 'Biofilm forming' },
  pathogenic: { es: 'Potencial patógeno', en: 'Potential pathogen' },
  extremophile: { es: 'Extremófilo', en: 'Extremophile' },

  // Tolerancia Salina
  halophile: { es: 'Halófilo (requiere sal)', en: 'Halophile' },
  halotolerant: { es: 'Halotolerante', en: 'Halotolerant' },

  // No asignado
  Sin_funcion_asignada: { es: 'Sin rasgo asignado', en: 'Unassigned trait' },
  Sin_rasgo_asignado: { es: 'Sin rasgo asignado', en: 'Unassigned trait' },
};

export default DEFAULT_PHENOTYPES;
`;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Descargando datasets de MD2 (con caché local)...');
  const [mainCSV, haloCSV] = await Promise.all([
    fetchCached(MD2_SOURCES.main, 'microbe-directory.csv'),
    fetchCached(MD2_SOURCES.halo, 'Halospecies.csv'),
  ]);

  const allRows = csvToObjects(mainCSV);
  const bactRows = allRows.filter(
    (r) => (r.kingdom === 'Bacteria' || r.kingdom === 'Archaea') && r.genus
  );
  const haloRows = csvToObjects(haloCSV);
  console.log(`  filas Bacteria/Archaea con género: ${bactRows.length}`);
  console.log(`  filas Halospecies: ${haloRows.length}`);

  const { DEFAULT_PHENOTYPES: curated } = await import(
    'file://' + PHENOTYPES_PATH + `?t=${Date.now()}`
  );

  const additions = {};
  const conflicts = [];

  mergeExclusiveGroup(curated, additions, conflicts, 'gram_stain', ['gram_positive', 'gram_negative'], buildGramTally(bactRows));
  mergeExclusiveGroup(curated, additions, conflicts, 'sporulation', ['spore_forming', 'non_spore_forming'], buildSporulationTally(bactRows));
  mergeExclusiveGroup(curated, additions, conflicts, 'temperature_range', ['thermophile', 'mesophile', 'psychrophile'], buildTemperatureTally(bactRows));
  mergeExclusiveGroup(curated, additions, conflicts, 'ph_range', ['acidophile', 'neutrophile', 'alkaliphile'], buildPhTally(bactRows));
  mergeExclusiveGroup(curated, additions, conflicts, 'salinity', ['halophile', 'halotolerant'], buildSalinityTally(haloRows));

  mergeIndependentTrait(curated, additions, 'ecology', 'biofilm_forming', buildBooleanTally(bactRows, 'biofilm_forming', 'biofilm_forming'));
  mergeIndependentTrait(curated, additions, 'ecology', 'extremophile', buildBooleanTally(bactRows, 'extreme_environment', 'extremophile'));
  mergeIndependentTrait(curated, additions, 'ecology', 'pathogenic', buildPathogenicTally(bactRows));

  const merged = applyAdditions(curated, additions);

  // Estadísticas de cobertura (géneros distintos con al menos un rasgo).
  // OJO: `curated` viene de importar el módulo ya cargado, así que además de
  // las 10 claves de categoría también trae las claves planas que el propio
  // phenotypes.js genera al final (Object.assign de compatibilidad). Hay que
  // restringirse a CATEGORY_ORDER explícitamente o esas claves planas (que
  // son arrays de strings, no objetos trait->lista) se cuelan y sus strings
  // se recorren carácter a carácter, inflando el recuento con basura.
  const genusSet = new Set();
  for (const category of CATEGORY_ORDER) {
    const traits = merged[category] || {};
    for (const list of Object.values(traits)) {
      for (const entry of list) {
        if (!entry.startsWith('g__') && !entry.startsWith('f__') && !entry.startsWith('p__')) {
          genusSet.add(entry);
        }
      }
    }
  }

  console.log(`\nGéneros distintos cubiertos tras la fusión: ${genusSet.size}`);
  console.log(`Conflictos detectados (curado vs MD2, revisar a mano): ${conflicts.length}`);

  const reportLines = [
    '# Conflictos MD2 vs curación manual',
    '',
    `Generado por scripts/build-phenotypes-md2.mjs — umbral de consenso ${CONSENSUS_THRESHOLD}.`,
    'Estos géneros ya tenían un rasgo asignado a mano en una categoría excluyente',
    '(Gram, esporulación, temperatura, pH o salinidad) que MD2 contradice. NO se',
    'han sobrescrito automáticamente — revisar caso por caso antes de decidir.',
    '',
    '| Categoría | Género | Curado (manual) | MD2 (agregado) | Nota |',
    '|---|---|---|---|---|',
    ...conflicts.map((c) => `| ${c.category} | ${c.genus} | ${c.curated} | ${c.md2} | ${c.note || ''} |`),
    '',
  ];
  await writeFile(REPORT_PATH, reportLines.join('\n'), 'utf-8');
  console.log(`Informe de conflictos escrito en ${path.relative(APP_ROOT, REPORT_PATH)}`);

  if (DRY_RUN) {
    console.log('\n--dry-run: no se ha escrito js/lib/phenotypes.js');
    return;
  }

  const fileContent = renderFile(merged, { genusCoverage: genusSet.size });
  await writeFile(PHENOTYPES_PATH, fileContent, 'utf-8');
  console.log(`\njs/lib/phenotypes.js regenerado (${(fileContent.length / 1024).toFixed(0)} KB).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
