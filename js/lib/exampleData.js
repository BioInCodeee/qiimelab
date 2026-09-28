// Dos vías para probar los módulos sin subir nada:
//
//  1. Un dataset SINTÉTICO (funciones loadExample*), generado en el navegador —
//     coherente (barplot, alfa y beta salen del mismo vector de abundancias) y
//     rápido. Para echar un vistazo.
//
//  2. El dataset REAL (funciones loadReal*), un recorte curado y anonimizado
//     de un estudio de microbioma 16S servido desde `datos-ejemplo/`. Se lee
//     con fetch() y pasa por el MISMO ingest.js que un archivo subido a mano,
//     así que además enseña la estructura exacta que debe tener tu propio
//     archivo.

import { state, registerFile, setSlot, addAlphaMetric, addBetaMetric, addTaxaBarplotLevel, addDiffComparison } from '../state.js';
import { ingestFile } from './ingest.js';
import { routeResultToState } from './route.js';
import { t } from './i18n.js';

const EXAMPLE_BASE = 'datos-ejemplo/';

// clave → [rutas relativas dentro de datos-ejemplo/] + clave i18n del rótulo.
// Sirve para los enlaces "descargar datos de ejemplo" de cada módulo.
export const EXAMPLE_FILES = {
  metadata: { paths: ['metadatos/sample-metadata.tsv'], key: 'exdl.metadata' },
  taxonomy: { paths: ['taxonomia/taxonomy.tsv'], key: 'exdl.taxonomy' },
  barplot: { paths: ['barplot/genero_abundancia_relativa_TOP14.csv'], key: 'exdl.barplot' },
  counts: { paths: ['venn/genero_conteos_absolutos.csv'], key: 'exdl.counts' },
  shannon: { paths: ['diversidad-alfa/shannon.tsv'], key: 'exdl.shannon' },
  observed: { paths: ['diversidad-alfa/observed_features.tsv'], key: 'exdl.observed' },
  betaqza: { paths: ['diversidad-beta/bray_curtis.qza'], key: 'exdl.betaqza' },
  pcoa: { paths: ['pcoa/bray_curtis_ordination.txt'], key: 'exdl.pcoa' },
  deseq2: { paths: ['abundancia-diferencial/DESeq2_D_vs_Control.csv'], key: 'exdl.deseq2' },
  kolist: { paths: ['funcional-picrust2/KOlist.csv'], key: 'exdl.kolist' },
  koabund: { paths: ['funcional-picrust2/KO_pred_metagenome_unstrat.tsv.gz'], key: 'exdl.koabund' },
  fastq: { paths: ['qc/muestra_ejemplo_R1.fastq.gz', 'qc/muestra_ejemplo_R2.fastq.gz'], key: 'exdl.fastq' },
  recuentosPlaca: { paths: ['recuentos/recuento_placa_ejemplo.csv'], key: 'exdl.recuentosPlaca' },
  recuentosNMP: { paths: ['recuentos/recuento_nmp_ejemplo.csv'], key: 'exdl.recuentosNMP' },
};

/** Solo la lista de enlaces de descarga (sin encabezado ni borde). */
export function exampleFileLinks(keys) {
  const list = document.createElement('div');
  list.className = 'ql-exdl-list';
  keys.forEach((k) => {
    const spec = EXAMPLE_FILES[k];
    if (!spec) return;
    spec.paths.forEach((rel) => {
      const a = document.createElement('a');
      a.href = EXAMPLE_BASE + rel;
      a.download = rel.split('/').pop();
      a.className = 'ql-exdl-link';
      const fname = rel.split('/').pop();
      a.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/></svg>' +
        '<span>' + fname + '</span>';
      a.title = fname + ' — ' + t(spec.key);
      list.appendChild(a);
    });
  });
  return list;
}

/** Devuelve un bloque con enlaces de descarga directa a los archivos de ejemplo. */
export function exampleDownloadBlock(keys) {
  const wrap = document.createElement('div');
  wrap.className = 'ql-exdl';
  const head = document.createElement('p');
  head.className = 'ql-exdl-head';
  head.textContent = t('exdl.intro');
  wrap.appendChild(head);
  wrap.appendChild(exampleFileLinks(keys));
  return wrap;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAXA = [
  { name: 'Faecalibacterium', tax: 'd__Bacteria;p__Firmicutes;c__Clostridia;o__Eubacteriales;f__Oscillospiraceae;g__Faecalibacterium', base: 0.16, shift: -0.7 },
  { name: 'Bacteroides', tax: 'd__Bacteria;p__Bacteroidota;c__Bacteroidia;o__Bacteroidales;f__Bacteroidaceae;g__Bacteroides', base: 0.14, shift: 0.5 },
  { name: 'Prevotella', tax: 'd__Bacteria;p__Bacteroidota;c__Bacteroidia;o__Bacteroidales;f__Prevotellaceae;g__Prevotella', base: 0.10, shift: -0.2 },
  { name: 'Akkermansia', tax: 'd__Bacteria;p__Verrucomicrobiota;c__Verrucomicrobiae;o__Verrucomicrobiales;f__Akkermansiaceae;g__Akkermansia', base: 0.05, shift: -0.9 },
  { name: 'Escherichia-Shigella', tax: 'd__Bacteria;p__Proteobacteria;c__Gammaproteobacteria;o__Enterobacterales;f__Enterobacteriaceae;g__Escherichia-Shigella', base: 0.04, shift: 1.4 },
  { name: 'Roseburia', tax: 'd__Bacteria;p__Firmicutes;c__Clostridia;o__Eubacteriales;f__Lachnospiraceae;g__Roseburia', base: 0.09, shift: -0.4 },
  { name: 'Ruminococcus', tax: 'd__Bacteria;p__Firmicutes;c__Clostridia;o__Eubacteriales;f__Oscillospiraceae;g__Ruminococcus', base: 0.08, shift: -0.1 },
  { name: 'Bifidobacterium', tax: 'd__Bacteria;p__Actinobacteriota;c__Actinobacteria;o__Bifidobacteriales;f__Bifidobacteriaceae;g__Bifidobacterium', base: 0.07, shift: -0.3 },
  { name: 'Enterococcus', tax: 'd__Bacteria;p__Firmicutes;c__Bacilli;o__Lactobacillales;f__Enterococcaceae;g__Enterococcus', base: 0.03, shift: 1.1 },
  { name: 'Blautia', tax: 'd__Bacteria;p__Firmicutes;c__Clostridia;o__Eubacteriales;f__Lachnospiraceae;g__Blautia', base: 0.08, shift: 0.1 },
  { name: 'Alistipes', tax: 'd__Bacteria;p__Bacteroidota;c__Bacteroidia;o__Bacteroidales;f__Rikenellaceae;g__Alistipes', base: 0.06, shift: -0.2 },
  { name: 'Veillonella', tax: 'd__Bacteria;p__Firmicutes;c__Negativicutes;o__Veillonellales;f__Veillonellaceae;g__Veillonella', base: 0.10, shift: 0.6 },
];

function shannon(p) {
  return -p.reduce((acc, v) => (v > 0 ? acc + v * Math.log(v) : acc), 0);
}

function brayCurtis(a, b) {
  let num = 0, den = 0;
  for (let i = 0; i < a.length; i++) { num += Math.abs(a[i] - b[i]); den += a[i] + b[i]; }
  return den === 0 ? 0 : num / den;
}

/** Metadatos + barplot taxonómico + alfa + beta, todo derivado del mismo vector de abundancias por muestra. */
export function loadExampleCommunityData() {
  const rnd = mulberry32(175); // semilla fija
  const nPerGroup = 10;
  const samples = [];
  for (let i = 0; i < nPerGroup; i++) samples.push({ id: 'CTRL-' + String(i + 1).padStart(2, '0'), grupo: 'Control' });
  for (let i = 0; i < nPerGroup; i++) samples.push({ id: 'TRAT-' + String(i + 1).padStart(2, '0'), grupo: 'Tratamiento' });

  const abundances = samples.map((s) => {
    const isTrat = s.grupo === 'Tratamiento';
    const weights = TAXA.map((t) => {
      const shiftAmt = isTrat ? t.shift : 0;
      const noise = (rnd() - 0.5) * 0.6;
      return Math.exp(Math.log(t.base) + shiftAmt + noise);
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    return weights.map((w) => w / sum);
  });

  const fileId = registerFile(
    'ejemplo_comunidad.smart-175',
    0,
    'Datos sintéticos generados en el navegador (metadatos + barplot + alfa + beta), para probar los módulos sin subir nada.'
  );

  setSlot('metadata', {
    sourceFileId: fileId,
    headers: ['sample-id', 'grupo'],
    rows: samples.map((s) => ({ 'sample-id': s.id, grupo: s.grupo })),
    sampleIdKey: 'sample-id',
  });

  const barHeaders = ['index', ...TAXA.map((t) => t.tax)];
  const barRows = samples.map((s, si) => {
    const row = { index: s.id };
    TAXA.forEach((t, ti) => { row[t.tax] = abundances[si][ti]; });
    return row;
  });
  addTaxaBarplotLevel(fileId, 6, barHeaders, barRows);

  const shannonValues = {};
  samples.forEach((s, si) => { shannonValues[s.id] = shannon(abundances[si]); });
  addAlphaMetric('shannon_entropy', fileId, shannonValues);

  const ids = samples.map((s) => s.id);
  const matrix = ids.map((_, i) => ids.map((_, j) => brayCurtis(abundances[i], abundances[j])));
  addBetaMetric('bray_curtis', fileId, ids, matrix);

  return fileId;
}

const DA_TAXA = [
  'Faecalibacterium prausnitzii', 'Bacteroides fragilis', 'Prevotella copri', 'Akkermansia muciniphila',
  'Escherichia coli', 'Ruminococcus bromii', 'Bifidobacterium longum', 'Lactobacillus reuteri',
  'Roseburia intestinalis', 'Fusobacterium nucleatum', 'Clostridioides difficile', 'Alistipes putredinis',
  'Parabacteroides distasonis', 'Eubacterium rectale', 'Blautia obeum', 'Dorea formicigenerans',
  'Enterococcus faecalis', 'Klebsiella pneumoniae', 'Veillonella parvula', 'Streptococcus salivarius',
  'Bacteroides uniformis', 'Bacteroides vulgatus', 'Prevotella stercorea', 'Coprococcus comes',
  'Anaerostipes hadrus', 'Collinsella aerofaciens', 'Odoribacter splanchnicus', 'Butyricimonas virosa',
  'Sutterella wadsworthensis', 'Desulfovibrio piger', 'Ruminococcus gnavus', 'Bilophila wadsworthia',
  'Methanobrevibacter smithii', 'Christensenella minuta', 'Oscillibacter valericigenes', 'Subdoligranulum variabile',
  'Turicibacter sanguinis', 'Holdemania filiformis', 'Catenibacterium mitsuokai', 'Megasphaera elsdenii',
  'Phascolarctobacterium succinatutens', 'Barnesiella intestinihominis', 'Paraprevotella clara',
  'Slackia isoflavoniconvertens', 'Gordonibacter pamelaeae', 'Eggerthella lenta', 'Flavonifractor plautii',
  'Intestinimonas butyriciproducens', 'Hungatella hathewayi', 'Erysipelatoclostridium ramosum',
];

/** Tabla estilo DESeq2/ANCOM-BC (taxón, log2FoldChange, padj) para el módulo de abundancia diferencial. */
export function loadExampleDifferentialAbundance() {
  const rnd = mulberry32(20260907);
  const rows = DA_TAXA.map((name) => {
    const driver = (rnd() - 0.5) * 2;
    const strong = rnd() < 0.34;
    let lfc = driver * (strong ? 1.6 + rnd() * 2.4 : rnd() * 1.4);
    lfc = Math.round(lfc * 100) / 100;
    const sig = strong && Math.abs(lfc) > 1;
    let padj = sig ? Math.pow(10, -(1.4 + rnd() * 4.2)) : Math.pow(10, -(rnd() * 1.3));
    padj = Math.min(padj, 0.98);
    return { taxon: name, log2FoldChange: lfc, padj: Number(padj.toPrecision(3)) };
  });
  const fileId = registerFile('ejemplo_abundancia_diferencial.csv', 0, 'Tabla sintética estilo DESeq2, generada en el navegador.');
  setSlot('differentialAbundance', {
    sourceFileId: fileId,
    headers: ['taxon', 'log2FoldChange', 'padj'],
    rows,
    mapping: { taxon: 0, lfc: 1, padj: 2 },
    entityType: 'taxon',
  });
  return fileId;
}

// Códigos KO de KEGG para el ejemplo funcional. Los que empiezan la lista están
// también en datos-ejemplo/funcional-picrust2/KOlist.csv (para que, si se carga
// también ese mapeo, la anotación gen/enzima salga); los últimos NO están, para
// enseñar el caso "sin anotar — mira la ficha en KEGG".
const DA_KO = [
  'K01176', 'K00016', 'K00925', 'K00625', 'K00929', 'K00656', 'K01026', 'K01256',
  'K03187', 'K01428', 'K00101', 'K00132', 'K00634', 'K01035', 'K00077', 'K01610',
  'K01512', 'K00467', 'K03778', 'K13923',
  'K02274', 'K00370', 'K01673', 'K18979', 'K00174', 'K11180', 'K02588', 'K03737',
];

/** Tabla estilo DESeq2 pero de KOs (K#####, log2FoldChange, padj) — abundancia diferencial funcional. */
export function loadExampleFunctionalDifferential() {
  const rnd = mulberry32(20260908);
  const rows = DA_KO.map((ko) => {
    const driver = (rnd() - 0.5) * 2;
    const strong = rnd() < 0.4;
    let lfc = driver * (strong ? 1.5 + rnd() * 2.2 : rnd() * 1.3);
    lfc = Math.round(lfc * 100) / 100;
    const sig = strong && Math.abs(lfc) > 1;
    let padj = sig ? Math.pow(10, -(1.5 + rnd() * 4)) : Math.pow(10, -(rnd() * 1.2));
    padj = Math.min(padj, 0.98);
    return { KO: ko, log2FoldChange: lfc, padj: Number(padj.toPrecision(3)) };
  });
  const fileId = registerFile('ejemplo_abundancia_diferencial_KO.csv', 0, 'Tabla sintética estilo DESeq2 por KO, generada en el navegador.');
  setSlot('differentialAbundance', {
    sourceFileId: fileId,
    headers: ['KO', 'log2FoldChange', 'padj'],
    rows,
    mapping: { taxon: 0, lfc: 1, padj: 2 },
    entityType: 'ko',
  });
  return fileId;
}

// ============================================================================
//  DATASET REAL — recorte anonimizado servido desde datos-ejemplo/
// ============================================================================

/**
 * Descarga un archivo de `datos-ejemplo/`, lo mete por el mismo ingest.js que
 * un archivo subido a mano y coloca el resultado en el estado.
 * Devuelve { fileId, results, warnings }.
 */
export async function ingestExampleFile(relPath, note) {
  const url = EXAMPLE_BASE + relPath;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error('No se ha podido descargar "' + relPath + '" (' + resp.status + '). ' +
      '¿Estás sirviendo la carpeta datos-ejemplo/ junto a la app?');
  }
  const blob = await resp.blob();
  const filename = relPath.split('/').pop();
  const file = new File([blob], filename, { type: blob.type });
  const fileId = registerFile(filename, blob.size, note || ('Ejemplo real — ' + relPath));
  const { results, warnings } = await ingestFile(file);
  const labels = results.map((r) => routeResultToState(fileId, r));
  const fileEntry = state.files.find((f) => f.id === fileId);
  if (fileEntry) {
    fileEntry.note = labels.length ? labels.join(' · ') : ('sin clasificar — ' + warnings.join('; '));
  }
  return { fileId, results, warnings };
}

async function ingestMany(specs) {
  const allWarnings = [];
  for (const [relPath, note] of specs) {
    try {
      const { warnings } = await ingestExampleFile(relPath, note);
      allWarnings.push(...warnings);
    } catch (e) {
      allWarnings.push(e && e.message ? e.message : String(e));
    }
  }
  return allWarnings;
}

// El ejemplo real es un recorte ANONIMIZADO de un estudio de microbioma 16S
// con varios grupos de tratamiento (A–N) y validación. Ver datos-ejemplo/README.md.

/** Metadatos + taxonomía + barplot (género) + conteos (género) + alfa (Shannon, Observed) + beta (Bray-Curtis). */
export function loadRealCommunityData() {
  return ingestMany([
    ['metadatos/sample-metadata.tsv', 'Ejemplo real — metadatos (42 muestras, 14 grupos)'],
    ['taxonomia/taxonomy.tsv', 'Ejemplo real — taxonomía SILVA (recorte de 2.500 ASVs, hasta género)'],
    ['barplot/genero_abundancia_relativa_TOP14.csv', 'Ejemplo real — abundancia relativa por género (TOP14 + Others)'],
    ['venn/genero_conteos_absolutos.csv', 'Ejemplo real — conteos absolutos por género (para Simpson, Chao1 y los estimadores por grupo)'],
    ['diversidad-alfa/shannon.tsv', 'Ejemplo real — Shannon por muestra'],
    ['diversidad-alfa/observed_features.tsv', 'Ejemplo real — riqueza (Observed Features) por muestra'],
    ['diversidad-beta/bray_curtis.qza', 'Ejemplo real — matriz Bray-Curtis (.qza, se abre en el navegador)'],
    ['pcoa/bray_curtis_ordination.txt', 'Ejemplo real — PCoA Bray-Curtis (ordination.txt de scikit-bio)'],
  ]);
}

/** Una tabla DESeq2 real (por defecto Grupo D vs Control). */
export function loadRealDifferentialAbundance(which) {
  const file = which || 'DESeq2_D_vs_Control.csv';
  return ingestMany([['abundancia-diferencial/' + file, 'Ejemplo real — DESeq2 ' + file.replace(/^DESeq2_|\.csv$/g, '').replace(/_/g, ' ')]]);
}

/** Las 3 tablas DESeq2 reales, cargadas en la vista "Comparar varias"
 *  (NO en el slot único differentialAbundance). */
export async function loadRealDiffComparisons() {
  const files = ['DESeq2_D_vs_Control.csv', 'DESeq2_D_vs_N.csv', 'DESeq2_N_vs_Control.csv'];
  const warnings = [];
  for (const name of files) {
    try {
      const w = await addDiffComparisonFromExample('abundancia-diferencial/' + name);
      warnings.push(...w);
    } catch (e) { warnings.push(e && e.message ? e.message : String(e)); }
  }
  return warnings;
}

/** Descarga un CSV de ejemplo, lo pasa por ingest.js y lo añade como una
 *  comparación (vista "Comparar varias"). */
async function addDiffComparisonFromExample(relPath) {
  const resp = await fetch(EXAMPLE_BASE + relPath);
  if (!resp.ok) throw new Error('No se ha podido descargar "' + relPath + '" (' + resp.status + ').');
  const blob = await resp.blob();
  const filename = relPath.split('/').pop();
  const file = new File([blob], filename, { type: blob.type });
  const { results, warnings } = await ingestFile(file);
  const da = results.find((r) => r.kind === 'differentialAbundance');
  if (!da) throw new Error('"' + filename + '" no se reconoce como tabla de abundancia diferencial.');
  const fileId = registerFile(filename, blob.size, 'Ejemplo real — comparación ' + filename.replace(/^DESeq2_|\.csv$/g, '').replace(/_/g, ' '));
  addDiffComparison({
    label: comparisonLabelFromName(filename) || filename,
    sourceFileId: fileId,
    headers: da.headers,
    rows: da.rows,
    mapping: da.mapping,
    entityType: da.entityType,
  });
  return warnings;
}

// "DESeq2_D_vs_Control.csv" -> "D vs Control"
function comparisonLabelFromName(fileName) {
  const m = String(fileName || '').replace(/\.[^.]+$/, '').match(/([A-Za-z0-9]+)[_ ]v[s]?[_ ]([A-Za-z0-9]+)/i);
  return m ? m[1] + ' vs ' + m[2] : null;
}

/** Lista de KOs por módulo funcional + abundancia de KOs por muestra (PICRUSt2, gzip). */
export function loadRealFunctional() {
  return ingestMany([
    ['funcional-picrust2/KOlist.csv', 'Ejemplo real — 53 KOs curados por módulo funcional'],
    ['funcional-picrust2/KO_pred_metagenome_unstrat.tsv.gz', 'Ejemplo real — abundancia de KOs por muestra (PICRUSt2, .tsv.gz)'],
  ]);
}

/** Lo mismo que loadRealFunctional() + los metadatos (para el módulo de índices funcionales). */
export function loadRealFunctionalWithMeta() {
  return ingestMany([
    ['metadatos/sample-metadata.tsv', 'Ejemplo real — metadatos (42 muestras, 14 grupos)'],
    ['funcional-picrust2/KOlist.csv', 'Ejemplo real — 53 KOs curados por módulo funcional'],
    ['funcional-picrust2/KO_pred_metagenome_unstrat.tsv.gz', 'Ejemplo real — abundancia de KOs por muestra (PICRUSt2, .tsv.gz)'],
  ]);
}

/** Tabla de conteos absolutos por género (taxón × muestra) — para Venn/UpSet. */
export function loadRealCounts() {
  return ingestMany([
    ['venn/genero_conteos_absolutos.csv', 'Ejemplo real — conteos absolutos por género (taxón × muestra)'],
    ['metadatos/sample-metadata.tsv', 'Ejemplo real — metadatos (42 muestras, 14 grupos)'],
  ]);
}

/**
 * Conteos sintéticos con 4 grupos e intersecciones controladas: cada grupo
 * tiene taxones exclusivos, todos comparten un núcleo, y hay solapes por
 * pares/tríos. Pensado para ver de un vistazo cómo se lee un Venn/UpSet.
 */
export function loadExampleCounts() {
  const groups = ['Dieta A', 'Dieta B', 'Dieta C', 'Dieta D'];
  const nPerGroup = 5;
  const rnd = mulberry32(424242);
  // núcleo compartido por los 4 + exclusivos + solapes
  const spec = [];
  for (let i = 0; i < 12; i++) spec.push({ name: 'Core_' + (i + 1), inMask: 0b1111 });
  groups.forEach((_, gi) => { for (let k = 0; k < 6; k++) spec.push({ name: 'Excl' + 'ABCD'[gi] + '_' + (k + 1), inMask: 1 << gi }); });
  [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3]].forEach(([a, b], p) => { for (let k = 0; k < 3; k++) spec.push({ name: 'Par' + 'ABCD'[a] + 'ABCD'[b] + '_' + (k + 1), inMask: (1 << a) | (1 << b) }); });
  [[0, 1, 2], [1, 2, 3]].forEach(([a, b, c]) => { for (let k = 0; k < 2; k++) spec.push({ name: 'Trio' + 'ABCD'[a] + 'ABCD'[b] + 'ABCD'[c] + '_' + (k + 1), inMask: (1 << a) | (1 << b) | (1 << c) }); });

  const samples = [];
  groups.forEach((g, gi) => { for (let r = 0; r < nPerGroup; r++) samples.push({ id: 'S' + 'ABCD'[gi] + (r + 1), group: g, gi }); });

  const headers = ['taxon', ...samples.map((s) => s.id)];
  const rows = spec.map((t) => {
    const row = { taxon: t.name };
    samples.forEach((s) => {
      const present = (t.inMask >> s.gi) & 1;
      // presente en ~80% de las muestras de sus grupos, con conteo variable
      row[s.id] = present && rnd() < 0.85 ? String(5 + Math.floor(rnd() * 200)) : '0';
    });
    return row;
  });

  const fileId = registerFile('ejemplo_conteos.csv', 0, 'Conteos sintéticos taxón × muestra con 4 grupos e intersecciones a propósito.');
  setSlot('taxaCounts', { sourceFileId: fileId, headers, rows, taxonKey: 'taxon' });
  if (!state.metadata) {
    setSlot('metadata', {
      sourceFileId: fileId,
      headers: ['sample-id', 'grupo'],
      rows: samples.map((s) => ({ 'sample-id': s.id, grupo: s.group })),
      sampleIdKey: 'sample-id',
      synthetic: true,
    });
  }
  return fileId;
}

/**
 * Conteos SINTÉTICOS con 10 grupos ("Sitio A"…"Sitio J", 3 muestras cada
 * uno) para ver cómo escala #/venn con muchos conjuntos (Fase 3, C1):
 * núcleo común, exclusivos de cada sitio, pares y tríos, y un gradiente
 * anidado (taxones presentes en los k primeros sitios) que genera muchas
 * intersecciones distintas. Mismo generador determinista que el de 4 grupos.
 */
export function loadExampleCounts10Sets() {
  const L = 'ABCDEFGHIJ';
  const groups = L.split('').map((c) => 'Sitio ' + c);
  const nPerGroup = 3;
  const rnd = mulberry32(101010);
  const all = (1 << groups.length) - 1;
  const spec = [];
  for (let i = 0; i < 10; i++) spec.push({ name: 'Nucleo_' + (i + 1), inMask: all });
  groups.forEach((_, gi) => { for (let k = 0; k < 2 + (gi % 3); k++) spec.push({ name: 'Excl' + L[gi] + '_' + (k + 1), inMask: 1 << gi }); });
  for (let a = 0; a < groups.length; a++) {
    const b = (a + 1) % groups.length, c = (a + 3) % groups.length;
    for (let k = 0; k < 2; k++) spec.push({ name: 'Par' + L[a] + L[b] + '_' + (k + 1), inMask: (1 << a) | (1 << b) });
    spec.push({ name: 'Trio' + L[a] + L[b] + L[c], inMask: (1 << a) | (1 << b) | (1 << c) });
  }
  for (let k = 2; k < groups.length; k++) spec.push({ name: 'Gradiente_' + L.slice(0, k), inMask: (1 << k) - 1 });

  const samples = [];
  groups.forEach((g, gi) => { for (let r = 0; r < nPerGroup; r++) samples.push({ id: 'S' + L[gi] + (r + 1), group: g, gi }); });
  const headers = ['taxon', ...samples.map((x) => x.id)];
  const rows = spec.map((tx) => {
    const row = { taxon: tx.name };
    samples.forEach((x) => {
      const present = (tx.inMask >> x.gi) & 1;
      // presente en ~2 de cada 3 muestras de sus grupos (el umbral por
      // defecto de #/venn es "≥1 muestra"), con conteo variable
      row[x.id] = present && rnd() < 0.7 ? String(5 + Math.floor(rnd() * 200)) : '0';
    });
    return row;
  });

  const fileId = registerFile('ejemplo_conteos_10_grupos.csv', 0, 'Conteos sintéticos taxón × muestra con 10 grupos (sitios A–J) e intersecciones a propósito.');
  setSlot('taxaCounts', { sourceFileId: fileId, headers, rows, taxonKey: 'taxon' });
  // los metadatos sintéticos se sustituyen; unos metadatos reales, no
  if (!state.metadata || state.metadata.synthetic) {
    setSlot('metadata', {
      sourceFileId: fileId,
      headers: ['sample-id', 'sitio'],
      rows: samples.map((x) => ({ 'sample-id': x.id, sitio: x.group })),
      sampleIdKey: 'sample-id',
      synthetic: true,
    });
  }
  return fileId;
}

/** Coordenadas PCoA ya calculadas (ordination.txt de scikit-bio). */
export function loadRealOrdination() {
  return ingestMany([['pcoa/bray_curtis_ordination.txt', 'Ejemplo real — PCoA Bray-Curtis (ordination.txt)']]);
}

// ---- recuento microbiano (SINTÉTICO: cifras y nombres 100% inventados,
//      mulberry32 con semilla fija; ver datos-ejemplo/recuentos/) ----

/** Recuento en placa: 3 organismos (UFC/mL), 3 puntos × 2 grupos × 2 tiempos ×
 *  3 réplicas. Trae una celda #NUM! a propósito (fórmula rota) para ver el
 *  aviso de valores descartados. */
export function loadExampleMicrobialCountsPlate() {
  return ingestMany([
    ['recuentos/recuento_placa_ejemplo.csv', 'Ejemplo sintético — recuento en placa (UFC/mL, réplicas en filas)'],
  ]);
}

/** Recuento por NMP: coliformes y E. coli (NMP/mL ya resuelto por el
 *  "laboratorio"). A un grupo le falta una réplica (tubo perdido). */
export function loadExampleMicrobialCountsMPN() {
  return ingestMany([
    ['recuentos/recuento_nmp_ejemplo.csv', 'Ejemplo sintético — recuento por NMP (NMP/mL, réplicas en filas)'],
  ]);
}

/** Par de FASTQ 16S reales (submuestra anonimizada, R1 + R2) para el módulo de QC. */
export function loadRealSequenceQC() {
  return ingestMany([
    ['qc/muestra_ejemplo_R1.fastq.gz', 'Ejemplo real — FASTQ 16S R1 (submuestra anonimizada)'],
    ['qc/muestra_ejemplo_R2.fastq.gz', 'Ejemplo real — FASTQ 16S R2 (submuestra anonimizada)'],
  ]);
}

// ---- helper de UI: fila de botones "cargar ejemplo" (sintético + real) ----

/**
 * Monta en `hostEl` una fila con hasta dos botones de ejemplo. `real` y
 * `synthetic` son funciones (la de `real` puede devolver una promesa). Se
 * encarga del estado "cargando…" y de enseñar errores/avisos.
 */
export function mountExampleButtons(hostEl, { synthetic, real, realLabel, syntheticLabel, download } = {}) {
  const row = document.createElement('div');
  row.className = 'ql-example-btns';
  row.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:4px;';
  const msg = document.createElement('p');
  msg.className = 'ql-field-help';
  msg.style.cssText = 'width:100%;text-align:center;margin-top:8px;';

  if (real) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ql-btn ql-btn-primary';
    b.textContent = realLabel || 'Cargar ejemplo real (estudio de microbioma 16S)';
    b.addEventListener('click', async () => {
      b.disabled = true;
      const prev = b.textContent;
      b.textContent = 'Descargando y procesando…';
      msg.textContent = '';
      try {
        const warnings = await real();
        if (Array.isArray(warnings) && warnings.length) {
          msg.textContent = 'Cargado, con avisos: ' + warnings.join(' · ');
        }
      } catch (e) {
        b.disabled = false;
        b.textContent = prev;
        msg.textContent = 'No se pudo cargar el ejemplo real: ' + (e && e.message ? e.message : e);
      }
    });
    row.appendChild(b);
  }

  if (synthetic) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ql-btn';
    b.textContent = syntheticLabel || 'Cargar ejemplo sintético (rápido)';
    b.addEventListener('click', () => { try { synthetic(); } catch (e) { msg.textContent = String(e && e.message || e); } });
    row.appendChild(b);
  }

  hostEl.appendChild(row);
  hostEl.appendChild(msg);
  if (Array.isArray(download) && download.length) hostEl.appendChild(exampleDownloadBlock(download));
  return row;
}
