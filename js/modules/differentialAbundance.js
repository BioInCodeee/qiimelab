import { state, subscribe, setSlot, registerFile, addDiffComparison, updateDiffComparison, removeDiffComparison } from '../state.js';
import { t, getLang } from '../lib/i18n.js';
import {
  loadExampleDifferentialAbundance, loadExampleFunctionalDifferential,
  loadRealDifferentialAbundance, loadRealDiffComparisons, mountExampleButtons,
} from '../lib/exampleData.js';
import { ingestFile } from '../lib/ingest.js';
import { formatP } from '../lib/stats.js';
import { partitionByMask, drawVenn } from '../lib/setDiagram.js';
import { attachChartEditor, getColorScaleOptions, getFigureOptions } from '../lib/chartEditor.js';
import { makeColorScale } from '../lib/colorScale.js';
import { paletteColorsOf } from '../lib/palettes.js';
import { annotateKO, keggEntryUrl } from '../lib/koAnnotate.js';
import { svgEl, escapeHtml, delegateHover, plotClip } from '../lib/dom.js';
import { showTooltip as showTooltipCentral, hideTooltip } from '../lib/tooltip.js';
import { chartTypeField } from '../lib/chartTypeSelector.js';
import { drawGroupBoxplot, legendPositionLabel } from '../lib/groupBoxplot.js';
import { taxaRelativeAbundance } from '../lib/taxaAbundance.js';
import { shortTaxonName } from './taxaBarplot.js';
import { makeGroupResolver } from '../lib/sampleMatch.js';

const MARGIN = { top: 48, right: 28, bottom: 86, left: 58 };
const W = 900, H = 560;

function shortenTaxon(name) {
  const parts = String(name).split(' ');
  if (parts.length <= 1) return name;
  return parts[0].charAt(0) + '. ' + parts.slice(1).join(' ');
}

// El taxón de la tabla de resultados (DESeq2/ANCOM-BC) y el de la tabla de
// abundancia (taxaBarplot/taxaCounts) rara vez se escriben igual — una puede
// traer el linaje completo ("d__Bacteria;...;g__Lactobacillus") y la otra
// solo el nombre corto. Se compara por nombre corto normalizado; sin
// coincidencia devuelve null (no se inventa un emparejamiento dudoso).
function matchTaxonToAbundance(diffTaxon, relAbund) {
  if (!relAbund) return null;
  if (relAbund.bySample[diffTaxon]) return diffTaxon; // misma convención, ya coincide
  const norm = (s) => shortTaxonName(s).toLowerCase().trim();
  const target = norm(diffTaxon);
  if (!target) return null;
  return Object.keys(relAbund.bySample).find((full) => norm(full) === target) || null;
}
function niceStep(range, targetTicks) {
  if (range <= 0) return 1;
  const raw = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step;
  if (norm < 1.5) step = 1; else if (norm < 3) step = 2; else if (norm < 7) step = 5; else step = 10;
  return step * mag;
}

function buildRScript(taxonCol, lfcCol, padjCol, lfcThresh, padjThresh, sourceFileName, isKO) {
  const ent = isKO ? 'ko' : 'taxon';       // solo cambia el texto, no la lógica
  const entPl = isKO ? 'kos' : 'taxones';
  return `# Volcano plot de abundancia diferencial${isKO ? ' funcional (KOs)' : ''} — generado por Smart-175
# Reproduce, en R, el mismo gráfico y los mismos umbrales que has usado aquí.

library(ggplot2)

## 1. Cargar tu tabla de resultados (la misma que subiste: ${sourceFileName || 'tu_tabla.csv'})
res <- read.csv("${sourceFileName || 'tu_tabla.csv'}", check.names = FALSE)

## Renombra si tus columnas no se llaman exactamente así:
## res\$${ent}${' '.repeat(Math.max(1, 15 - ent.length))}<- res\$${taxonCol}
## res\$log2FoldChange  <- res\$${lfcCol}
## res\$padj            <- res\$${padjCol}

## 2. Umbrales (los mismos que en Smart-175)
lfc_threshold  <- ${lfcThresh}
padj_threshold <- ${padjThresh}

res$estado <- "No significativo"
res$estado[res$${lfcCol} >=  lfc_threshold & res$${padjCol} < padj_threshold] <- "Enriquecido"
res$estado[res$${lfcCol} <= -lfc_threshold & res$${padjCol} < padj_threshold] <- "Reducido"

## 3. Volcano plot
ggplot(res, aes(x = ${lfcCol}, y = -log10(${padjCol}), color = estado)) +
  geom_point(alpha = 0.85, size = 2) +
  scale_color_manual(values = c(
    "Enriquecido"        = "#e34948",
    "Reducido"           = "#2a78d6",
    "No significativo"   = "#a6a49c"
  )) +
  geom_vline(xintercept = c(-lfc_threshold, lfc_threshold), linetype = "dashed", color = "grey50") +
  geom_hline(yintercept = -log10(padj_threshold), linetype = "dashed", color = "grey50") +
  theme_minimal(base_size = 13) +
  labs(x = "log2 Fold Change", y = expression(-log[10](padj)), color = NULL,
       title = "Abundancia diferencial${isKO ? ' funcional' : ''}")

## 4. Exportar los ${entPl} significativos
write.csv(subset(res, estado != "No significativo"),
          "${entPl}_significativos.csv", row.names = FALSE)

## --------------------------------------------------------------------
## Si en cambio partes de conteos crudos (no de una tabla ya calculada),
## el pipeline habitual con DESeq2 sería:
##
## library(DESeq2)
## counts   <- read.delim("${isKO ? 'ko_pred_metagenome_unstrat.tsv' : 'feature-table.tsv'}", row.names = 1, check.names = FALSE)
## metadata <- read.delim("metadata.tsv", row.names = 1)
## dds <- DESeqDataSetFromMatrix(round(counts), metadata, design = ~ <tu_variable_de_grupo>)
## dds <- DESeq(dds)
## res <- as.data.frame(results(dds))
## res$${ent} <- rownames(res)
## (y continuar desde el paso 2 de arriba)
`;
}

// formas específicas de "log2 fold change" (evita cazar lfcSE, log10, etc.)
const LFC_STRONG = ['log2foldchange', 'log2fc', 'l2fc', 'logfoldchange', 'foldchange'];
const normHdr = (h) => String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, '');
// columnas que NO son un log2FC aunque lo parezcan (error estándar, estadístico…)
const NOT_LFC = /(^|[^a-z])(se|stderr|std|error|stat|pval|pvalue|padj|fdr|qval|mean|rank|conf|lower|upper|neglog|log10)([^a-z]|$)/i;

// nombre legible de la comparación a partir del archivo de origen
// ("DESeq2_D_vs_Control.csv" -> "D vs Control")
function comparisonLabel(fileName) {
  if (!fileName) return null;
  const m = String(fileName).replace(/\.[^.]+$/, '').match(/([A-Za-z0-9]+)[_ ]v[s]?[_ ]([A-Za-z0-9]+)/i);
  if (m) return m[1] + ' vs ' + m[2];
  return null;
}

export function render(container) {
  let thresholds = { lfc: 1, padj: 0.05, labelN: 8 };
  let search = '';
  let sort = { key: 'padj', dir: 'asc' };
  let mapping = null;
  let mappedFileId = null; // para re-mapear si se carga otra tabla distinta
  let showRScript = false;
  let chartType = 'volcano'; // 'volcano' | 'lollipop' | 'heatmap' | 'boxplot'
  let boxplotTaxon = null;     // taxón elegido en la vista de cajas y bigotes
  let boxplotGroupCol = null;  // columna de metadatos para agrupar esa vista
  let mainView = 'individual'; // 'individual' | 'compare'
  let cmpPadj = 0.05;          // umbral padj de "significativo en N de M"
  let cmpSort = { key: 'count', dir: 'desc' };
  let cmpOpenMask = null;      // región del diagrama de solapamiento seleccionada
  let editor = null;
  let wasEditing = false; // capturado en paint(); lo leen renderChart() y renderCompare() (ver cfg.startEditing en chartEditor.js)

  // columnas de log2FoldChange presentes en la tabla (la mapeada + cualquier
  // otra que lo parezca, para el mapa de calor multi-comparación)
  function lfcColumns(headers) {
    const cols = [];
    headers.forEach((h, i) => {
      if (i === mapping.taxon || i === mapping.padj) return;
      if (i === mapping.lfc) { cols.push({ key: h, idx: i }); return; }
      const n = normHdr(h);
      const looksLfc = LFC_STRONG.some((k) => n.includes(k)) || /\blfc\b/i.test(String(h));
      if (looksLfc && !NOT_LFC.test(String(h))) cols.push({ key: h, idx: i });
    });
    if (!cols.some((c) => c.idx === mapping.lfc)) cols.unshift({ key: headers[mapping.lfc], idx: mapping.lfc });
    cols.sort((a, b) => (a.idx === mapping.lfc ? -1 : b.idx === mapping.lfc ? 1 : a.idx - b.idx));
    return cols;
  }

  function computeDerived() {
    const da = state.differentialAbundance;
    const headers = da.headers;
    const taxonKey = headers[mapping.taxon], lfcKey = headers[mapping.lfc], padjKey = headers[mapping.padj];
    const lfcCols = lfcColumns(headers);
    const out = [];
    let skipped = 0;
    da.rows.forEach((r) => {
      const taxon = String(r[taxonKey] || '').trim();
      const lfc = parseFloat(r[lfcKey]);
      const padj = parseFloat(r[padjKey]);
      if (!taxon || !isFinite(lfc) || !isFinite(padj) || padj < 0) { skipped++; return; }
      const padjEff = Math.max(padj, 1e-10);
      const neglog = -Math.log10(padjEff);
      let status = 'ns';
      if (padj < thresholds.padj) {
        if (lfc >= thresholds.lfc) status = 'up';
        else if (lfc <= -thresholds.lfc) status = 'down';
      }
      const lfcExtra = lfcCols.map((c) => { const v = parseFloat(r[c.key]); return isFinite(v) ? v : null; });
      out.push({ taxon, lfc, padj, neglog, status, capped: padj < 1e-10, lfcExtra });
    });
    return { data: out, skipped, taxonKey, lfcKey, padjKey, lfcCols };
  }

  function paint() {
    // ver cfg.startEditing en chartEditor.js: sin esto, cada repintado
    // disparado DESDE DENTRO del propio editor (escala de color,
    // "Restablecer"…) cerraría el panel "Personalizar" de golpe.
    wasEditing = editor && editor.isEditing ? editor.isEditing() : false;
    if (editor) { editor.destroy(); editor = null; }
    container.innerHTML = '';
    const header = document.createElement('header');
    header.className = 'ql-page-header';
    header.innerHTML =
      '<p class="ql-eyebrow">' + t('differential.eyebrow') + '</p>' +
      '<h1 class="ql-page-title">' + t('differential.title') + '</h1>' +
      '<p class="ql-page-sub">' + t('differential.subtitle') + '</p>';
    container.appendChild(header);

    // --- vista principal: Individual | Comparar varias ---
    const mainTabs = document.createElement('div');
    mainTabs.className = 'ql-tabs';
    [['individual', t('differential.viewIndividual')], ['compare', t('differential.viewCompare')]].forEach(([v, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-tab' + (mainView === v ? ' is-active' : '');
      b.textContent = label;
      b.addEventListener('click', () => { if (mainView !== v) { mainView = v; paint(); } });
      mainTabs.appendChild(b);
    });
    container.appendChild(mainTabs);

    if (mainView === 'compare') { renderCompare(); return; }

    if (!state.differentialAbundance) {
      const card = document.createElement('div');
      card.className = 'ql-card ql-panel';
      card.innerHTML =
        '<div class="ql-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 20h18"/><circle cx="12" cy="9" r="3"/><circle cx="6" cy="14" r="1.4"/><circle cx="18" cy="16" r="1.6"/></svg>' +
        '<h3>' + t('differential.emptyTitle') + '</h3>' +
        '<p>' + t('differential.emptyDesc') + '</p>' +
        '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">' +
        '<a href="#/cargar" class="ql-btn">' + t('ui.goLoadData') + '</a></div></div>';
      container.appendChild(card);
      const emptyHost = card.querySelector('.ql-empty');
      const exRow = mountExampleButtons(emptyHost, {
        real: () => loadRealDifferentialAbundance(),
        synthetic: loadExampleDifferentialAbundance,
        realLabel: t('differential.exampleLabel'),
        download: ['deseq2'],
      });
      // ejemplo funcional (KOs) — la tabla entra en el mismo slot differentialAbundance
      const koBtn = document.createElement('button');
      koBtn.type = 'button';
      koBtn.className = 'ql-btn';
      koBtn.textContent = t('differential.exampleKO');
      koBtn.addEventListener('click', () => { try { loadExampleFunctionalDifferential(); } catch (e) { /* noop */ } });
      (exRow || emptyHost).appendChild(koBtn);
      return;
    }

    const da = state.differentialAbundance;
    if (!mapping || mappedFileId !== da.sourceFileId) {
      mapping = { ...da.mapping };
      mappedFileId = da.sourceFileId;
    }

    // entidad de las filas: taxón o KO (según lo detectado en la carga)
    const isKO = da.entityType === 'ko';
    const entName = isKO ? t('differential.entKO') : t('differential.entTaxon');       // "taxón" / "KO"
    const entPlural = isKO ? t('differential.entKOs') : t('differential.entTaxa');     // "taxones" / "KOs"
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const catsForAnn = isKO && state.functionalCategories ? true : false;
    // etiqueta corta de una fila para los ejes: taxón abreviado, o "K##### · gen"
    const entLabel = (id) => {
      if (!isKO) return shortenTaxon(id);
      const a = annotateKO(id);
      return a && a.gene ? id + ' · ' + a.gene : id;
    };

    // ---- mapeo de columnas ----
    const mapCard = document.createElement('section');
    mapCard.className = 'ql-card ql-panel';
    mapCard.style.marginBottom = '20px';
    mapCard.innerHTML = '<h2>' + t('differential.columnsTitle') + '</h2><p class="ql-panel-note">' + t('differential.columnsNote') + '</p>';
    const mapGrid = document.createElement('div');
    mapGrid.className = 'ql-mapping-grid';
    ['taxon', 'lfc', 'padj'].forEach((key) => {
      const f = document.createElement('div');
      f.className = 'ql-field';
      f.innerHTML = '<label>' + ({ taxon: cap(entName), lfc: t('differential.colLfc'), padj: t('differential.colPadj') }[key]) + '</label>';
      const sel = document.createElement('select');
      da.headers.forEach((h, i) => {
        const opt = document.createElement('option');
        opt.value = String(i); opt.textContent = h || t('ui.columnN', { n: i + 1 });
        if (mapping[key] === i) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => {
        mapping = { ...mapping, [key]: parseInt(sel.value, 10) };
        setSlot('differentialAbundance', { ...da, mapping });
      });
      f.appendChild(sel);
      mapGrid.appendChild(f);
    });
    mapCard.appendChild(mapGrid);
    container.appendChild(mapCard);

    const { data, skipped, taxonKey, lfcKey, padjKey, lfcCols } = computeDerived();

    // "Cajas y bigotes" cruza el taxón significativo con una tabla de
    // abundancia por muestra APARTE (taxaBarplot/taxaCounts) — no siempre
    // está cargada, y no aplica a diferencial funcional (KOs). Si falta
    // cualquiera de las dos cosas, la opción ni se ofrece (no se rompe nada,
    // simplemente no aparece un tipo de gráfico que no podría dibujar nada).
    const relAbund = (!isKO && state.metadata) ? taxaRelativeAbundance() : null;
    const canBoxplot = !!relAbund;
    if (chartType === 'boxplot' && !canBoxplot) chartType = 'volcano';
    // taxones que hoy cumplen los umbrales (arriba/abajo) Y tienen una columna
    // de abundancia emparejada por nombre — únicos candidatos al boxplot.
    const sigMatched = canBoxplot
      ? data.filter((d) => d.status !== 'ns').map((d) => ({ ...d, matchedKey: matchTaxonToAbundance(d.taxon, relAbund) }))
        .filter((d) => d.matchedKey).sort((a, b) => a.padj - b.padj)
      : [];
    if (chartType === 'boxplot' && (!boxplotTaxon || !sigMatched.some((d) => d.taxon === boxplotTaxon))) {
      boxplotTaxon = sigMatched.length ? sigMatched[0].taxon : null;
    }
    const groupOptionsForBoxplot = state.metadata ? state.metadata.headers.filter((h) => h !== state.metadata.sampleIdKey) : [];
    if (chartType === 'boxplot' && (!boxplotGroupCol || !groupOptionsForBoxplot.includes(boxplotGroupCol))) {
      boxplotGroupCol = groupOptionsForBoxplot[0] || null;
    }

    // ---- selector de tipo de gráfico ----
    const tabOptions = [['volcano', t('differential.viewVolcano')], ['lollipop', t('differential.viewLollipop')], ['heatmap', t('differential.viewHeatmap')]];
    if (canBoxplot) tabOptions.push(['boxplot', t('differential.viewBoxplot')]);
    const tabs = document.createElement('div');
    tabs.className = 'ql-tabs';
    tabOptions.forEach(([v, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ql-tab' + (chartType === v ? ' is-active' : '');
        b.textContent = label;
        b.addEventListener('click', () => { if (chartType !== v) { chartType = v; paint(); } });
        tabs.appendChild(b);
      });
    container.appendChild(tabs);

    const grid = document.createElement('div');
    grid.className = 'ql-grid-2';

    const chartPanel = document.createElement('section');
    chartPanel.className = 'ql-card ql-panel';
    const chartNoteKey = chartType === 'lollipop' ? 'differential.chartNoteLolli'
      : chartType === 'heatmap' ? 'differential.chartNoteHeat'
      : chartType === 'boxplot' ? 'differential.chartNoteBoxplot' : 'differential.chartNote';
    chartPanel.innerHTML = '<p class="ql-panel-note" style="margin-bottom:4px;">' + t(chartNoteKey) + '</p>';
    const chartWrap = document.createElement('div');
    chartWrap.className = 'ql-chartwrap';
    const svg = svgEl('svg', { class: 'ql-svg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': t('a11y.chartVolcano') });
    if (chartType === 'heatmap') chartWrap.classList.add('scroll-x');
    const tooltip = document.createElement('div');
    tooltip.className = 'ql-tooltip';
    chartWrap.appendChild(svg);
    chartWrap.appendChild(tooltip);
    chartPanel.appendChild(chartWrap);
    grid.appendChild(chartPanel);

    // delegación de hover: un único listener en el svg (persiste entre
    // llamadas a renderChart() al escribir en la búsqueda o mover sliders),
    // en vez de un listener por punto/celda. Cada render* asigna
    // activeTooltip antes de repintar sus elementos con [data-tt].
    let activeTooltip = null;
    delegateHover(svg, '[data-tt]', {
      onEnter: (el) => { if (activeTooltip) activeTooltip(el); },
      onLeave: () => hideTooltip(tooltip),
    });

    const controls = document.createElement('aside');
    controls.className = 'ql-card ql-panel';
    controls.innerHTML = '<h2>' + t('ui.controls') + '</h2>';

    const stats = document.createElement('div');
    stats.className = 'ql-stats';
    stats.style.marginBottom = '16px';
    controls.appendChild(stats);

    const lfcField = document.createElement('div');
    lfcField.className = 'ql-field';
    lfcField.innerHTML = '<label>' + t('differential.thrLfc') + '</label><div class="ql-inputrow">' +
      '<input type="range" aria-label="' + escapeHtml(t('differential.thrLfc')) + '" min="0" max="4" step="0.1" value="' + thresholds.lfc + '" id="lfcRange" />' +
      '<input type="number" aria-label="' + escapeHtml(t('differential.thrLfc')) + '" class="ql-num-small tabular" min="0" max="10" step="0.1" value="' + thresholds.lfc + '" id="lfcInput" /></div>';
    controls.appendChild(lfcField);

    const padjField = document.createElement('div');
    padjField.className = 'ql-field';
    padjField.innerHTML = '<label>' + t('differential.thrPadj') + '</label><div class="ql-inputrow">' +
      '<input type="range" aria-label="' + escapeHtml(t('differential.thrPadj')) + '" min="0.001" max="0.2" step="0.001" value="' + thresholds.padj + '" id="padjRange" />' +
      '<input type="number" aria-label="' + escapeHtml(t('differential.thrPadj')) + '" class="ql-num-small tabular" min="0.0001" max="1" step="0.001" value="' + thresholds.padj + '" id="padjInput" /></div>';
    controls.appendChild(padjField);

    let labelField = null;
    if (chartType === 'volcano') {
      labelField = document.createElement('div');
      labelField.className = 'ql-field';
      labelField.innerHTML = '<label>' + t('differential.labelN') + '</label><input type="number" min="0" max="25" step="1" value="' + thresholds.labelN + '" id="labelNInput" />';
      controls.appendChild(labelField);
    }

    let searchField = null;
    if (chartType !== 'boxplot') {
      searchField = document.createElement('div');
      searchField.className = 'ql-field';
      searchField.innerHTML = '<label>' + t('differential.searchLabel', { ent: entName }) + '</label><input type="text" id="searchInput" placeholder="' + t(isKO ? 'differential.searchPlaceholderKO' : 'differential.searchPlaceholder') + '" value="' + escapeHtml(search) + '" />';
      controls.appendChild(searchField);
    }

    if (chartType === 'boxplot') {
      const taxonField = document.createElement('div');
      taxonField.className = 'ql-field';
      taxonField.innerHTML = '<label>' + t('differential.boxplotTaxonLabel', { ent: cap(entName) }) + '</label>';
      const taxonSel = document.createElement('select');
      sigMatched.forEach((d) => {
        const opt = document.createElement('option');
        opt.value = d.taxon;
        opt.textContent = d.taxon + ' (padj ' + formatP(d.padj) + ', log2FC ' + d.lfc.toFixed(2) + ')';
        if (d.taxon === boxplotTaxon) opt.selected = true;
        taxonSel.appendChild(opt);
      });
      taxonSel.addEventListener('change', () => { boxplotTaxon = taxonSel.value; paint(); });
      taxonField.appendChild(taxonSel);
      controls.appendChild(taxonField);

      if (groupOptionsForBoxplot.length > 0) {
        const grpField = document.createElement('div');
        grpField.className = 'ql-field';
        grpField.innerHTML = '<label>' + t('barplots.groupCol') + '</label>';
        const grpSel = document.createElement('select');
        groupOptionsForBoxplot.forEach((h) => {
          const opt = document.createElement('option');
          opt.value = h; opt.textContent = h;
          if (h === boxplotGroupCol) opt.selected = true;
          grpSel.appendChild(opt);
        });
        grpSel.addEventListener('change', () => { boxplotGroupCol = grpSel.value; paint(); });
        grpField.appendChild(grpSel);
        controls.appendChild(grpField);
      }

      const matchNote = document.createElement('p');
      matchNote.className = 'ql-field-help';
      matchNote.textContent = t('differential.boxplotMatchNote', { n: sigMatched.length, total: data.filter((d) => d.status !== 'ns').length });
      controls.appendChild(matchNote);
    }

    const rBtn = document.createElement('button');
    rBtn.type = 'button';
    rBtn.className = 'ql-btn ql-btn-primary';
    rBtn.style.width = '100%';
    rBtn.textContent = showRScript ? t('differential.hideRscript') : t('differential.genRscript');
    controls.appendChild(rBtn);

    grid.appendChild(controls);
    container.appendChild(grid);

    if (showRScript) {
      const rCard = document.createElement('section');
      rCard.className = 'ql-card ql-panel';
      rCard.style.marginTop = '20px';
      rCard.innerHTML = '<h2>' + t('differential.rTitle') + '</h2><p class="ql-panel-note">' + t('differential.rNote') + '</p>';
      const code = document.createElement('pre');
      code.className = 'ql-code';
      const script = buildRScript(taxonKey, lfcKey, padjKey, thresholds.lfc.toFixed(2), thresholds.padj, (state.files.find(f => f.id === da.sourceFileId) || {}).name, isKO);
      code.textContent = script;
      rCard.appendChild(code);
      const copyBtn = document.createElement('button');
      copyBtn.className = 'ql-btn';
      copyBtn.style.marginTop = '10px';
      copyBtn.type = 'button';
      copyBtn.textContent = t('differential.copyClipboard');
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(script);
          copyBtn.textContent = t('differential.copied');
          setTimeout(() => { copyBtn.textContent = t('differential.copyClipboard'); }, 1800);
        } catch (e) {
          copyBtn.textContent = t('differential.copyManual');
        }
      });
      rCard.appendChild(copyBtn);
      container.appendChild(rCard);
    }

    // tabla
    const tableCard = document.createElement('section');
    tableCard.className = 'ql-card ql-panel';
    tableCard.style.marginTop = '20px';
    const koNote = isKO ? ' · ' + t(catsForAnn ? 'differential.koAnnNote' : 'differential.koNoListNote') : '';
    tableCard.innerHTML = '<h2>' + t('differential.tableTitle') + '</h2><p class="ql-panel-note">' + t('differential.rowsCount', { n: data.length, ent: entPlural }) + (skipped ? ' · ' + t('differential.rowsSkipped', { n: skipped }) : '') + koNote + '</p>';
    const scrollDiv = document.createElement('div');
    scrollDiv.className = 'ql-table-scroll';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table';
    tbl.innerHTML = '<thead><tr>' +
      '<th><button type="button" data-sort="taxon">' + escapeHtml(cap(entName)) + '</button></th>' +
      (isKO ? '<th>' + t('differential.colGene') + '</th>' : '') +
      '<th><button type="button" data-sort="lfc">log2FC</button></th>' +
      '<th><button type="button" data-sort="padj">padj</button></th>' +
      '<th><button type="button" data-sort="neglog">−log10(padj)</button></th>' +
      '<th><button type="button" data-sort="status">' + t('differential.colStatus') + '</button></th></tr></thead>';
    const tbody = document.createElement('tbody');
    tbl.appendChild(tbody);
    scrollDiv.appendChild(tbl);
    tableCard.appendChild(scrollDiv);
    container.appendChild(tableCard);

    // ---- render dinámico: stats, legend, chart, tabla ----
    let ceCfg = null; // config de chartEditor de la vista activa (la fija renderChart)

    function renderStats() {
      const up = data.filter((d) => d.status === 'up').length;
      const down = data.filter((d) => d.status === 'down').length;
      stats.innerHTML =
        '<div class="ql-stat"><div class="ql-stat-label">' + escapeHtml(cap(entPlural)) + '</div><div class="ql-stat-value">' + data.length + '</div></div>' +
        '<div class="ql-stat ql-stat-up"><div class="ql-stat-label">' + t('differential.statUp') + '</div><div class="ql-stat-value">' + up + '</div></div>' +
        '<div class="ql-stat ql-stat-down"><div class="ql-stat-label">' + t('differential.statDown') + '</div><div class="ql-stat-value">' + down + '</div></div>';
    }
    function colorFor(status) { return status === 'up' ? 'var(--enriched)' : status === 'down' ? 'var(--depleted)' : 'var(--neutral)'; }

    // leyenda dentro del SVG (para que el editor la mueva y la exportación la incluya)
    function drawSvgLegend(parent, cx, y, which) {
      which = which || ['up', 'down', 'ns'];
      const up = data.filter((d) => d.status === 'up').length;
      const down = data.filter((d) => d.status === 'down').length;
      const ns = data.length - up - down;
      const all = {
        up: ['var(--enriched)', t('differential.legendUp') + ' (' + up + ')'],
        down: ['var(--depleted)', t('differential.legendDown') + ' (' + down + ')'],
        ns: ['var(--neutral)', t('differential.legendNs') + ' (' + ns + ')'],
      };
      const items = which.map((k) => all[k]);
      const g = svgEl('g', { 'data-ce': 'legend' });
      const GAP = 26, SW = 11, TXT = 6.2;
      const widths = items.map(([, label]) => SW + 6 + label.length * TXT);
      const total = widths.reduce((a, b) => a + b, 0) + GAP * (items.length - 1);
      let x = -total / 2;
      items.forEach(([col, label], i) => {
        g.appendChild(svgEl('rect', { x, y: -SW + 1, width: SW, height: SW, rx: 2, fill: col, ...(which[i] === 'ns' ? {} : { 'data-ce-series-fill': which[i] }) }));
        const tx = svgEl('text', { x: x + SW + 6, y: 0, class: 'ql-tick-label' });
        tx.textContent = label;
        g.appendChild(tx);
        x += widths[i] + GAP;
      });
      g.setAttribute('transform', 'translate(' + cx + ',' + y + ')');
      parent.appendChild(g);
    }

    // divergente por log2FC: azul (reducido) — neutro — rojo (enriquecido).
    // Escala de color continua compartida (Paso 2 de qiimelab-prompt-
    // editor-fase-3-heatmaps-escalas-continuas.md) en vez de color-mix()
    // por celda. Dominio simétrico [-maxAbs, maxAbs] (mismo criterio que ya
    // tenía esta vista), editable desde el panel igual que los demás.
    function heatColorScale(maxAbs) {
      const csOv = getColorScaleOptions('differentialAbundance-heatmap');
      const domain = [
        csOv.domainMin != null ? csOv.domainMin : -maxAbs,
        csOv.domainMax != null ? csOv.domainMax : maxAbs,
      ];
      return makeColorScale({
        type: 'divergent', domain,
        range: paletteColorsOf(csOv.paletteId || 'app:divergent'),
        // la paleta divergente por defecto de la app es [neg=rojo, mid=gris,
        // pos=azul] (js/lib/palettes.js) pero aquí domain[0] (el extremo
        // negativo) es "down" = azul/depleted: sin invertir, un log2FC muy
        // negativo saldría rojo. Solo se invierte SI se usa la paleta de la
        // app (paletteId ausente) — si el usuario elige otra paleta del
        // catálogo a propósito, se respeta tal cual la trae, mismo criterio
        // que beta/correlograma (sin casos especiales por paleta).
        invert: csOv.invert != null ? csOv.invert : !csOv.paletteId,
        midpoint: csOv.midpoint != null ? csOv.midpoint : 0,
        steps: csOv.steps,
      });
    }

    const SIG_CAP = 40;
    function significantTaxa(searchTerm) {
      const all = data.filter((d) => d.status !== 'ns');
      const totalSig = all.length;
      // con búsqueda activa y coincidencias: solo esas (sin tope)
      if (searchTerm) {
        const m = all.filter((d) => d.taxon.toLowerCase().includes(searchTerm));
        if (m.length) return { sig: m.slice().sort((a, b) => b.lfc - a.lfc), capped: false, totalSig };
      }
      let sig = all;
      const capped = totalSig > SIG_CAP;
      // si hay que recortar, nos quedamos con los de |log2FC| más grande
      if (capped) sig = sig.slice().sort((a, b) => Math.abs(b.lfc) - Math.abs(a.lfc)).slice(0, SIG_CAP);
      return { sig: sig.slice().sort((a, b) => b.lfc - a.lfc), capped, totalSig };
    }

    function positionTooltip(cx, cy) {
      const vb = svg.viewBox.baseVal;
      showTooltipCentral(chartWrap, cx, cy, null, null, { svg, W: vb.width || W, H: vb.height || H, tooltip });
    }
    // anotación KO para tooltips: "amyA · Alpha-amylase · EC 3.2.1.1" o el
    // aviso de "sin anotar". Devuelve '' si la tabla no es de KOs.
    function koTooltipLine(koCode) {
      if (!isKO) return '';
      const a = annotateKO(koCode);
      if (a && a.annotated) {
        const bits = [a.gene, a.enzyme].filter(Boolean).join(' · ');
        return '<div class="ql-tt-row">' + escapeHtml(bits) + (a.ec ? ' · EC ' + escapeHtml(a.ec) : '') + '</div>';
      }
      return '<div class="ql-tt-row" style="opacity:.75;">' + escapeHtml(t('differential.koUnannotated')) + '</div>';
    }

    function showTooltip(d, cx, cy) {
      const vb = svg.viewBox.baseVal;
      const padjText = d.capped ? '< 1e-10' : d.padj.toExponential(2);
      const html = '<div class="ql-tt-name">' + escapeHtml(d.taxon) + '</div>' + koTooltipLine(d.taxon) +
        '<div class="ql-tt-row">log2FC ' + d.lfc.toFixed(2) + ' · padj ' + padjText + '</div>';
      showTooltipCentral(chartWrap, cx, cy, null, null, { svg, W: vb.width || W, H: vb.height || H, tooltip, html });
    }
    function tooltipRaw(name, rowHtml, cx, cy, koCode) {
      const vb = svg.viewBox.baseVal;
      const html = '<div class="ql-tt-name">' + name + '</div>' + (koCode ? koTooltipLine(koCode) : '') +
        '<div class="ql-tt-row">' + rowHtml + '</div>';
      showTooltipCentral(chartWrap, cx, cy, null, null, { svg, W: vb.width || W, H: vb.height || H, tooltip, html });
    }

    // ---- despachador de vistas ----
    function renderChart() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      svg.style.width = '';
      svg.style.maxWidth = '';
      svg.style.marginLeft = '';
      svg.style.marginRight = '';
      const term = search.trim().toLowerCase();
      if (chartType === 'lollipop') ceCfg = renderLollipop(term);
      else if (chartType === 'heatmap') ceCfg = renderHeatmap(term);
      else if (chartType === 'boxplot') ceCfg = renderBoxplot();
      else ceCfg = renderVolcano(term);
    }

    function noSigText(vbW, vbH) {
      svg.setAttribute('viewBox', '0 0 ' + vbW + ' ' + vbH);
      const tx = svgEl('text', { x: vbW / 2, y: vbH / 2, 'text-anchor': 'middle', class: 'ql-axis-label', fill: 'var(--ink-muted)' });
      tx.textContent = t('differential.noSig');
      svg.appendChild(tx);
    }
    function capText(x, y, totalSig) {
      const cn = svgEl('text', { x, y, 'text-anchor': 'middle', class: 'ql-tick-label', fill: 'var(--ink-muted)' });
      cn.textContent = t('differential.capNote', { cap: SIG_CAP, total: totalSig });
      svg.appendChild(cn);
    }

    // ===== Volcano =====
    function renderVolcano(searchTerm) {
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      const innerW = W - MARGIN.left - MARGIN.right, innerH = H - MARGIN.top - MARGIN.bottom;
      let maxAbsLfc = 0, maxNeglog = 0;
      data.forEach((d) => { maxAbsLfc = Math.max(maxAbsLfc, Math.abs(d.lfc)); maxNeglog = Math.max(maxNeglog, d.neglog); });
      const xMax = Math.max(maxAbsLfc * 1.2, thresholds.lfc * 1.6, 1.5);
      const yMax = Math.max(maxNeglog * 1.15, -Math.log10(thresholds.padj) * 1.3, 1);
      // rangos manuales (Ajustes > Estructura); por defecto los automáticos
      const autoVX = [-xMax, xMax], autoVY = [0, yMax];
      const vso = getFigureOptions('differentialAbundance');
      const xLo = vso.axisXMin != null ? vso.axisXMin : autoVX[0], xHi = vso.axisXMax != null ? vso.axisXMax : autoVX[1];
      const yLo = vso.axisMin != null ? vso.axisMin : autoVY[0], yHi = vso.axisMax != null ? vso.axisMax : autoVY[1];
      const xScale = (v) => MARGIN.left + ((v - xLo) / ((xHi - xLo) || 1)) * innerW;
      const yScale = (v) => MARGIN.top + innerH - ((v - yLo) / ((yHi - yLo) || 1)) * innerH;

      const g = svgEl('g', {});
      svg.appendChild(g);

      const xStep = niceStep(xHi - xLo, 6);
      const xStart = Math.ceil(xLo / xStep) * xStep;
      for (let xv = xStart; xv <= xHi + 1e-9; xv += xStep) {
        const xPix = xScale(xv);
        g.appendChild(svgEl('line', { x1: xPix, x2: xPix, y1: MARGIN.top, y2: MARGIN.top + innerH, class: 'ql-gridline' }));
        const tk = svgEl('text', { x: xPix, y: MARGIN.top + innerH + 18, class: 'ql-tick-label', 'text-anchor': 'middle' });
        tk.textContent = (Math.round(xv * 100) / 100).toString();
        g.appendChild(tk);
      }
      const yStep = niceStep(yHi - yLo, 5);
      for (let yv = Math.ceil(yLo / yStep) * yStep; yv <= yHi + 1e-9; yv += yStep) {
        const yPix = yScale(yv);
        g.appendChild(svgEl('line', { x1: MARGIN.left, x2: MARGIN.left + innerW, y1: yPix, y2: yPix, class: 'ql-gridline' }));
        const tk = svgEl('text', { x: MARGIN.left - 10, y: yPix + 3, class: 'ql-tick-label', 'text-anchor': 'end' });
        tk.textContent = (Math.round(yv * 10) / 10).toString();
        g.appendChild(tk);
      }
      g.appendChild(svgEl('line', { x1: MARGIN.left, x2: MARGIN.left + innerW, y1: MARGIN.top + innerH, y2: MARGIN.top + innerH, class: 'ql-baseline-line' }));
      g.appendChild(svgEl('line', { x1: MARGIN.left, x2: MARGIN.left, y1: MARGIN.top, y2: MARGIN.top + innerH, class: 'ql-baseline-line' }));

      if (thresholds.lfc > 0) {
        [thresholds.lfc, -thresholds.lfc].filter((v) => v > xLo && v < xHi).forEach((v) => {
          const xp = xScale(v);
          g.appendChild(svgEl('line', { x1: xp, x2: xp, y1: MARGIN.top, y2: MARGIN.top + innerH, class: 'ql-threshold-line' }));
        });
      }
      const padjY = -Math.log10(thresholds.padj);
      if (padjY > yLo && padjY < yHi) {
        const yp = yScale(padjY);
        g.appendChild(svgEl('line', { x1: MARGIN.left, x2: MARGIN.left + innerW, y1: yp, y2: yp, class: 'ql-threshold-line' }));
      }

      const xTitle = svgEl('text', { x: MARGIN.left + innerW / 2, y: H - 12, class: 'ql-axis-label', 'text-anchor': 'middle', 'data-ce': 'xtitle' });
      xTitle.textContent = 'log2FoldChange';
      g.appendChild(xTitle);
      const yTitle = svgEl('text', { x: 16, y: MARGIN.top + innerH / 2, class: 'ql-axis-label', 'text-anchor': 'middle', transform: 'rotate(-90 16 ' + (MARGIN.top + innerH / 2) + ')', 'data-ce': 'ytitle' });
      yTitle.textContent = '−log10(padj)';
      g.appendChild(yTitle);

      drawSvgLegend(g, MARGIN.left + innerW / 2, H - 40);

      const hasSearch = searchTerm.length > 0;
      const pointsLayer = svgEl('g', { 'clip-path': plotClip(svg, 'ql-clip-volcano', MARGIN.left, MARGIN.top, innerW, innerH) });
      g.appendChild(pointsLayer);
      const pointNodes = [];
      activeTooltip = (el) => {
        const d = data[+el.dataset.tt];
        showTooltip(d, +el.dataset.cx, +el.dataset.cy);
      };
      data.forEach((d, i) => {
        const cx = xScale(d.lfc), cy = yScale(d.neglog);
        const matches = hasSearch && d.taxon.toLowerCase().includes(searchTerm);
        const dim = hasSearch && !matches;
        if (matches) {
          pointsLayer.appendChild(svgEl('circle', { cx, cy, r: 9.5, fill: 'none', stroke: 'var(--surface)', 'stroke-width': 4 }));
          pointsLayer.appendChild(svgEl('circle', { cx, cy, r: 9.5, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2 }));
        }
        const c = svgEl('circle', {
          cx, cy, r: d.status === 'ns' ? 4 : 4.6, fill: colorFor(d.status), opacity: dim ? 0.2 : (d.status === 'ns' ? 0.55 : 0.92), stroke: 'var(--surface)', 'stroke-width': 1.6, 'data-ce-role': 'marker',
          'data-tt': i, 'data-cx': cx, 'data-cy': cy,
          ...(d.status === 'ns' ? {} : { 'data-ce-series-fill': d.status }),
        });
        pointsLayer.appendChild(c);
        pointNodes.push({ d, cx, cy });
      });

      const labelN = Math.max(0, Math.min(25, thresholds.labelN | 0));
      const sig = pointNodes.filter((p) => p.d.status !== 'ns').sort((a, b) => a.d.padj - b.d.padj).slice(0, labelN);
      const labelLayer = svgEl('g', {});
      g.appendChild(labelLayer);
      sig.forEach((p, i) => {
        const tier = i % 3;
        const dy = -10 - tier * 11;
        const tl = svgEl('text', { x: p.cx, y: p.cy + dy, class: 'ql-tick-label', 'text-anchor': 'middle' });
        tl.textContent = entLabel(p.d.taxon);
        labelLayer.appendChild(tl);
        try {
          const bbox = tl.getBBox();
          const minX = MARGIN.left + 2, maxX = MARGIN.left + innerW - 2;
          if (bbox.x < minX) { tl.setAttribute('text-anchor', 'start'); tl.setAttribute('x', minX); }
          else if (bbox.x + bbox.width > maxX) { tl.setAttribute('text-anchor', 'end'); tl.setAttribute('x', maxX); }
        } catch (e) { /* getBBox puede fallar si aún no está en el DOM visible */ }
      });

      return {
        key: 'differentialAbundance',
        filename: t('differential.title') + '-volcano',
        elements: [
          { id: 'title', create: { text: t('differential.chartTitle'), x: W / 2, y: 26, anchor: 'middle', cls: 'ce-title' } },
          { id: 'xtitle', selector: '[data-ce="xtitle"]' },
          { id: 'ytitle', selector: '[data-ce="ytitle"]' },
          { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
        ],
        paletteSeries: [{ id: 'up', label: t('differential.legendUp') }, { id: 'down', label: t('differential.legendDown') }],
        paletteType: 'divergentPoles',
        figureOptions: { axis: { domain: autoVY }, axisX: { domain: autoVX } },
      };
    }

    // ===== Lollipop =====
    const LOLLI_W = 780;
    function lolliCfg(autoX) {
      return {
        key: 'differentialAbundance-lollipop',
        filename: t('differential.title') + '-lollipop',
        elements: [
          { id: 'title', create: { text: t('differential.chartLolli'), x: LOLLI_W / 2, y: 24, anchor: 'middle', cls: 'ce-title' } },
          { id: 'xtitle', selector: '[data-ce="xtitle"]' },
          { id: 'ytitle', selector: '[data-ce="ytitle"]' },
          { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
        ],
        paletteSeries: [{ id: 'up', label: t('differential.legendUp') }, { id: 'down', label: t('differential.legendDown') }],
        paletteType: 'divergentPoles',
        ...(autoX ? { figureOptions: { axisX: { domain: autoX } } } : {}),
      };
    }
    function renderLollipop(searchTerm) {
      const { sig, capped, totalSig } = significantTaxa(searchTerm);
      if (sig.length === 0) { noSigText(LOLLI_W, 300); return lolliCfg(); }
      const anyMatch = searchTerm && sig.some((d) => d.taxon.toLowerCase().includes(searchTerm));

      const rowH = 24, mL = 210, mR = 34, mT = 52, mB = 66;
      const innerW = LOLLI_W - mL - mR;
      const plotH = sig.length * rowH;
      const H2 = mT + plotH + mB;
      svg.setAttribute('viewBox', '0 0 ' + LOLLI_W + ' ' + H2);
      const g = svgEl('g', {});
      svg.appendChild(g);

      let maxAbs = 0;
      sig.forEach((d) => { maxAbs = Math.max(maxAbs, Math.abs(d.lfc)); });
      const xMax = Math.max(maxAbs * 1.12, thresholds.lfc * 1.4, 1);
      const autoLX = [-xMax, xMax];
      const lso = getFigureOptions('differentialAbundance-lollipop');
      const xLo = lso.axisXMin != null ? lso.axisXMin : autoLX[0], xHi = lso.axisXMax != null ? lso.axisXMax : autoLX[1];
      const xScale = (v) => mL + ((v - xLo) / ((xHi - xLo) || 1)) * innerW;
      const lclip = plotClip(svg, 'ql-clip-lolli', mL, mT, innerW, plotH);

      const xStep = niceStep(xHi - xLo, 6);
      const xStart = Math.ceil(xLo / xStep) * xStep;
      for (let xv = xStart; xv <= xHi + 1e-9; xv += xStep) {
        const xp = xScale(xv);
        g.appendChild(svgEl('line', { x1: xp, x2: xp, y1: mT, y2: mT + plotH, class: 'ql-gridline' }));
        const tk = svgEl('text', { x: xp, y: mT + plotH + 18, class: 'ql-tick-label', 'text-anchor': 'middle' });
        tk.textContent = (Math.round(xv * 100) / 100).toString();
        g.appendChild(tk);
      }
      g.appendChild(svgEl('line', { x1: xScale(0), x2: xScale(0), y1: mT, y2: mT + plotH, class: 'ql-baseline-line' }));
      if (thresholds.lfc > 0) {
        [thresholds.lfc, -thresholds.lfc].filter((v) => v > xLo && v < xHi).forEach((v) => g.appendChild(svgEl('line', { x1: xScale(v), x2: xScale(v), y1: mT, y2: mT + plotH, class: 'ql-threshold-line' })));
      }

      activeTooltip = (el) => {
        const d = sig[+el.dataset.tt];
        showTooltip(d, +el.dataset.cx, +el.dataset.cy);
      };
      sig.forEach((d, i) => {
        const y = mT + i * rowH + rowH / 2;
        const matches = anyMatch && d.taxon.toLowerCase().includes(searchTerm);
        const dim = anyMatch && !matches;
        const col = d.status === 'up' ? 'var(--enriched)' : 'var(--depleted)';
        const row = svgEl('g', dim ? { opacity: 0.25 } : {});
        if (matches) row.appendChild(svgEl('rect', { x: mL - 6, y: y - rowH / 2 + 1, width: innerW + 12, height: rowH - 2, fill: 'var(--accent-soft)', rx: 3 }));
        row.appendChild(svgEl('line', { x1: xScale(0), x2: xScale(d.lfc), y1: y, y2: y, stroke: col, 'stroke-width': 2, 'data-ce-series-stroke': d.status, 'data-ce-role': 'line', 'clip-path': lclip }));
        const dot = svgEl('circle', {
          cx: xScale(d.lfc), cy: y, r: 5, fill: col, stroke: 'var(--surface)', 'stroke-width': 1.4, 'data-ce-series-fill': d.status, 'data-ce-role': 'marker', 'clip-path': lclip,
          'data-tt': i, 'data-cx': xScale(d.lfc), 'data-cy': y,
        });
        row.appendChild(dot);
        const lbl = svgEl('text', { x: mL - 12, y: y + 4, class: 'ql-tick-label', 'text-anchor': 'end' });
        lbl.textContent = entLabel(d.taxon);
        row.appendChild(lbl);
        g.appendChild(row);
      });

      const xt = svgEl('text', { x: mL + innerW / 2, y: H2 - 30, class: 'ql-axis-label', 'text-anchor': 'middle', 'data-ce': 'xtitle' });
      xt.textContent = 'log2FoldChange';
      g.appendChild(xt);
      const ytL = svgEl('text', { x: 12, y: mT + plotH / 2, class: 'ql-axis-label', 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (mT + plotH / 2) + ')', 'data-ce': 'ytitle' });
      ytL.textContent = cap(entName);
      g.appendChild(ytL);
      drawSvgLegend(g, mL + innerW / 2, H2 - 10, ['up', 'down']);
      if (capped) capText(LOLLI_W / 2, 42, totalSig);

      return lolliCfg(autoLX);
    }

    // ===== Mapa de calor =====
    function heatCfg(HW, maxAbs) {
      return {
        key: 'differentialAbundance-heatmap',
        filename: t('differential.title') + '-heatmap',
        elements: [
          { id: 'title', create: { text: t('differential.chartHeat'), x: HW / 2, y: 22, anchor: 'middle', cls: 'ce-title' } },
          { id: 'xtitle', selector: '[data-ce="xtitle"]' },
          { id: 'ytitle', selector: '[data-ce="ytitle"]' },
          { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
        ],
        colorScale: { type: 'divergent', domain: [-(maxAbs || 1), maxAbs || 1], defaultMidpoint: 0 },
        onColorScaleChange: () => paint(),
      };
    }
    function renderHeatmap(searchTerm) {
      const { sig, capped, totalSig } = significantTaxa(searchTerm);
      const anyMatch = searchTerm && sig.some((d) => d.taxon.toLowerCase().includes(searchTerm));
      const single = lfcCols.length <= 1;
      const srcName = (state.files.find((f) => f.id === state.differentialAbundance.sourceFileId) || {}).name;
      const colLabels = single ? [comparisonLabel(srcName) || t('differential.heatOneCol')] : lfcCols.map((c) => c.key);
      const nCols = colLabels.length;
      const cellW = single ? 108 : Math.max(52, Math.min(104, 460 / nCols));
      const mL = 210, mR = 24, mT = single ? 74 : 100, mB = 78;
      const gridW = cellW * nCols;
      const HW = mL + gridW + mR;

      if (sig.length === 0) { noSigText(HW, 300); return heatCfg(HW); }

      const rowH = Math.max(15, Math.min(24, 520 / sig.length));
      const plotH = sig.length * rowH;
      const HH = mT + plotH + mB;
      svg.setAttribute('viewBox', '0 0 ' + HW + ' ' + HH);
      svg.style.width = (single ? HW : Math.max(HW, 460)) + 'px';
      svg.style.maxWidth = 'none';
      if (single) { svg.style.marginLeft = 'auto'; svg.style.marginRight = 'auto'; }
      const g = svgEl('g', {});
      svg.appendChild(g);

      let maxAbs = 0;
      sig.forEach((d) => (single ? [d.lfc] : d.lfcExtra).forEach((v) => { if (v != null && isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v)); }));
      maxAbs = maxAbs || 1;
      const colorScale = heatColorScale(maxAbs);
      const lfcFill = (v) => (v == null || !isFinite(v) ? 'var(--page)' : (colorScale.scale(v) || 'var(--page)'));
      // controles de celda (Paso 4): "valor en celda" hace toggle del
      // número de log2FC que antes era incondicional (por defecto sigue
      // apareciendo). "Borde de celda": nuevo.
      const heatCsOv = getColorScaleOptions('differentialAbundance-heatmap');
      const showValue = heatCsOv.showValue !== false;
      const cellBorder = heatCsOv.cellBorder || null;

      activeTooltip = (el) => {
        const [ri, ci] = el.dataset.tt.split(':').map(Number);
        const d = sig[ri], cl = colLabels[ci];
        const v = single ? d.lfc : d.lfcExtra[ci];
        tooltipRaw(escapeHtml(d.taxon), (nCols > 1 ? escapeHtml(cl) + ' · ' : '') + 'log2FC ' + (v == null ? '—' : v.toFixed(2)), +el.dataset.cx, +el.dataset.cy, d.taxon);
      };
      sig.forEach((d, ri) => {
        const y = mT + ri * rowH;
        const matches = anyMatch && d.taxon.toLowerCase().includes(searchTerm);
        const dim = anyMatch && !matches;
        colLabels.forEach((cl, ci) => {
          const v = single ? d.lfc : d.lfcExtra[ci];
          const x = mL + ci * cellW;
          const rect = svgEl('rect', {
            x, y, width: cellW - 2, height: rowH - 2, rx: 2, fill: lfcFill(v), opacity: dim ? 0.3 : 1, 'data-ce-role': 'cell',
            ...(cellBorder ? { stroke: cellBorder.color, 'stroke-width': cellBorder.width } : {}),
            'data-tt': ri + ':' + ci, 'data-cx': x + cellW / 2, 'data-cy': y + rowH / 2,
          });
          g.appendChild(rect);
          if (showValue && v != null && isFinite(v) && cellW >= 40 && rowH >= 15) {
            const strong = Math.abs(v) / maxAbs > 0.55;
            const tx = svgEl('text', { x: x + (cellW - 2) / 2, y: y + rowH / 2 + 3, class: 'ql-cell-value', 'text-anchor': 'middle', 'font-size': Math.min(11, rowH * 0.5).toFixed(1), fill: strong ? 'var(--surface)' : 'var(--ink)', 'font-family': 'var(--font-mono)', 'pointer-events': 'none', opacity: dim ? 0.4 : 1 });
            tx.textContent = v.toFixed(1);
            g.appendChild(tx);
          }
        });
        const lbl = svgEl('text', { x: mL - 10, y: y + rowH / 2 + 3, class: 'ql-tick-label', 'text-anchor': 'end', opacity: dim ? 0.35 : 1 });
        lbl.textContent = entLabel(d.taxon);
        g.appendChild(lbl);
      });

      colLabels.forEach((cl, ci) => {
        const x = mL + ci * cellW + (cellW - 2) / 2;
        const yy = mT - 10;
        const tx = svgEl('text', { x, y: yy, class: 'ql-tick-label', 'text-anchor': single ? 'middle' : 'end' });
        if (!single) tx.setAttribute('transform', 'rotate(-40 ' + x + ' ' + yy + ')');
        tx.textContent = cl.length > 24 ? cl.slice(0, 23) + '…' : cl;
        g.appendChild(tx);
      });

      const legG = svgEl('g', { 'data-ce': 'legend' });
      const defs = svgEl('defs', {});
      const legendGradId = 'ql-cscale-differentialAbundance-heatmap';
      const grad = svgEl('linearGradient', { id: legendGradId, x1: '0', y1: '0', x2: '1', y2: '0' });
      colorScale.legendStops.forEach((st) => {
        grad.appendChild(svgEl('stop', { offset: st.offset + '%', 'stop-color': st.color }));
      });
      defs.appendChild(grad);
      svg.appendChild(defs);
      const barW = Math.min(200, Math.max(120, gridW + 30));
      legG.appendChild(svgEl('rect', { x: 0, y: 0, width: barW, height: 11, rx: 2, fill: 'url(#' + legendGradId + ')', stroke: 'var(--baseline)' }));
      const midT = colorScale.domain[1] === colorScale.domain[0] ? 0.5
        : (colorScale.midpoint - colorScale.domain[0]) / (colorScale.domain[1] - colorScale.domain[0]);
      const fmt = (v) => (Math.round(v * 100) / 100).toString();
      [[fmt(colorScale.domain[0]), 0, 'start'], [fmt(colorScale.midpoint), Math.max(0, Math.min(barW, midT * barW)), 'middle'], [fmt(colorScale.domain[1]), barW, 'end']]
        .forEach(([lab, xx, anc]) => {
          const lt = svgEl('text', { x: xx, y: 25, class: 'ql-tick-label', 'text-anchor': anc });
          lt.textContent = lab;
          legG.appendChild(lt);
        });
      const lnote = svgEl('text', { x: 0, y: 41, class: 'ql-tick-label', fill: 'var(--ink-muted)' });
      lnote.textContent = t('differential.heatLegendNote');
      legG.appendChild(lnote);
      const xtH = svgEl('text', { x: mL + gridW / 2, y: mT + plotH + 14, class: 'ql-axis-label', 'text-anchor': 'middle', 'data-ce': 'xtitle' });
      xtH.textContent = t('differential.axisComparison');
      g.appendChild(xtH);
      const ytH = svgEl('text', { x: 12, y: mT + plotH / 2, class: 'ql-axis-label', 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (mT + plotH / 2) + ')', 'data-ce': 'ytitle' });
      ytH.textContent = cap(entName);
      g.appendChild(ytH);
      legG.setAttribute('transform', 'translate(' + mL + ',' + (mT + plotH + 22) + ')');
      svg.appendChild(legG);

      if (capped) capText(HW / 2, single ? 40 : 20, totalSig);
      return heatCfg(HW, maxAbs);
    }

    // ===== Cajas y bigotes =====
    // Complementa el lollipop/volcano (que resumen el efecto en un número)
    // con la distribución real de abundancia del taxón elegido, agrupada por
    // una columna de metadatos — mismo componente (drawGroupBoxplot) que
    // diversidad alfa/recuentos, mismo Kruskal-Wallis de contraste.
    function boxplotCfg(titleText) {
      return {
        key: 'differentialAbundance-boxplot',
        filename: t('differential.title') + '-boxplot' + (boxplotTaxon ? '-' + boxplotTaxon : ''),
        elements: [
          { id: 'title', create: { text: titleText, x: W / 2, y: 24, anchor: 'middle', cls: 'ce-title' } },
          { id: 'xtitle', selector: '[data-ce="xtitle"]' },
          { id: 'ytitle', selector: '[data-ce="ytitle"]' },
          { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
        ],
        paletteType: 'categorical',
      };
    }
    function renderBoxplot() {
      const d = boxplotTaxon ? sigMatched.find((x) => x.taxon === boxplotTaxon) : null;
      if (!d || !boxplotGroupCol) {
        noSigText(W, H);
        return boxplotCfg(t('differential.title'));
      }
      const sampleVals = relAbund.bySample[d.matchedKey]; // Map sampleId(taxaBarplot/Counts) -> %
      const resolveGroup = makeGroupResolver(state.metadata, boxplotGroupCol);
      const groupData = {};
      const groupNames = [];
      sampleVals.forEach((val, sid) => {
        const g = resolveGroup(sid);
        if (!g) return;
        if (!groupData[g]) { groupData[g] = []; groupNames.push(g); }
        groupData[g].push(val);
      });
      groupNames.sort();

      if (groupNames.length === 0) {
        noSigText(W, H);
        return boxplotCfg(d.taxon);
      }

      const result = drawGroupBoxplot({
        svg, chartWrap, tooltip,
        groupNames, groupData, key: 'differentialAbundance-boxplot',
        title: d.taxon, xTitle: boxplotGroupCol, yTitle: t('differential.boxplotYAxis'),
        valueLabel: t('differential.boxplotYAxis'), valueDecimals: 2,
      });

      return {
        ...boxplotCfg(d.taxon), elements: result.ceElements, paletteSeries: result.paletteSeries,
        statsControls: result.statsControls,
        figureOptions: result.figureOptions, legendPositions: result.legendPositions,
      };
    }

    function renderTable() {
      const sorted = data.slice().sort((a, b) => {
        const dir = sort.dir === 'asc' ? 1 : -1;
        let av = a[sort.key], bv = b[sort.key];
        if (typeof av === 'string') return av.localeCompare(bv) * dir;
        return (av - bv) * dir;
      });
      // aria-sort en la cabecera activa (tabla ordenable accesible)
      tbl.querySelectorAll('thead th').forEach((th) => {
        const b = th.querySelector('button[data-sort]');
        if (!b) return;
        th.setAttribute('aria-sort',
          b.dataset.sort === sort.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      });
      tbody.innerHTML = '';
      if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="' + (isKO ? 6 : 5) + '" style="text-align:center;color:var(--ink-muted);padding:24px;">' + t('differential.noRows') + '</td></tr>';
        return;
      }
      const frag = document.createDocumentFragment();
      sorted.forEach((d) => {
        const tr = document.createElement('tr');
        const pillClass = d.status === 'up' ? 'ql-pill-up' : d.status === 'down' ? 'ql-pill-down' : 'ql-pill-ns';
        const pillText = d.status === 'up' ? t('differential.pillUp') : d.status === 'down' ? t('differential.pillDown') : t('differential.pillNs');
        const padjText = d.capped ? '&lt; 1e-10' : d.padj.toExponential(2);
        let entCell;
        if (isKO) {
          const ann = annotateKO(d.taxon);
          const gene = ann && ann.gene ? escapeHtml(ann.gene) : '';
          entCell = '<td><span class="mono">' + escapeHtml(d.taxon) + '</span> ' +
            '<a class="ql-kegg-link" href="' + escapeHtml(keggEntryUrl(d.taxon)) + '" target="_blank" rel="noopener" title="' + t('differential.keggTitle') + '">KEGG&nbsp;↗</a></td>' +
            '<td class="ql-cell-muted">' + (gene || (ann && ann.enzyme ? escapeHtml(ann.enzyme) : '<span class="ql-cell-muted">' + t('differential.koUnannotatedShort') + '</span>')) + '</td>';
        } else {
          entCell = '<td>' + escapeHtml(d.taxon) + '</td>';
        }
        tr.innerHTML = entCell +
          '<td class="ql-num tabular">' + d.lfc.toFixed(2) + '</td>' +
          '<td class="ql-num tabular">' + padjText + '</td>' +
          '<td class="ql-num tabular">' + d.neglog.toFixed(2) + '</td>' +
          '<td><span class="ql-pill ' + pillClass + '">' + pillText + '</span></td>';
        frag.appendChild(tr);
      });
      tbody.appendChild(frag);
    }

    renderStats(); renderChart(); renderTable();

    editor = attachChartEditor({
      key: ceCfg.key,
      svg,
      mount: chartPanel,
      filename: ceCfg.filename,
      lang: getLang(),
      elements: ceCfg.elements,
      paletteSeries: ceCfg.paletteSeries,
      paletteType: ceCfg.paletteType,
      onChange: ceCfg.onChange,
      colorScale: ceCfg.colorScale,
      onColorScaleChange: ceCfg.onColorScaleChange,
      statsControls: ceCfg.statsControls, onStatsChange: () => paint(),
      figureOptions: ceCfg.figureOptions, onFigureOptionsChange: () => paint(),
      legendPositions: (ceCfg.legendPositions || []).map((p) => ({ ...p, label: legendPositionLabel(p.id, getLang()) })),
      onReset: () => paint(),
      startEditing: wasEditing,
    });

    // eventos
    const lfcRange = controls.querySelector('#lfcRange'), lfcInput = controls.querySelector('#lfcInput');
    const padjRange = controls.querySelector('#padjRange'), padjInput = controls.querySelector('#padjInput');
    const labelNInput = controls.querySelector('#labelNInput');
    const searchInput = controls.querySelector('#searchInput');

    function syncPair(range, input, key) {
      range.addEventListener('input', () => { input.value = range.value; thresholds = { ...thresholds, [key]: parseFloat(range.value) }; refresh(); });
      input.addEventListener('input', () => { const v = parseFloat(input.value); if (!isFinite(v)) return; range.value = v; thresholds = { ...thresholds, [key]: v }; refresh(); });
    }
    syncPair(lfcRange, lfcInput, 'lfc');
    syncPair(padjRange, padjInput, 'padj');
    if (labelNInput) labelNInput.addEventListener('input', () => { thresholds = { ...thresholds, labelN: parseInt(labelNInput.value, 10) || 0 }; refresh(); });
    if (searchInput) searchInput.addEventListener('input', () => { search = searchInput.value; renderChart(); if (editor) editor.sync(); });
    rBtn.addEventListener('click', () => { showRScript = !showRScript; paint(); });
    tbl.querySelectorAll('th button[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sort');
        if (sort.key === key) sort = { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
        else sort = { key, dir: 'asc' };
        renderTable();
      });
    });

    function refresh() {
      const recomputed = computeDerived();
      data.length = 0;
      recomputed.data.forEach((d) => data.push(d));
      renderStats(); renderChart(); renderTable();
      if (editor) editor.sync();
    }
  }

  // =========================================================================
  //  VISTA "COMPARAR VARIAS" — varias tablas de abundancia diferencial a la vez
  // =========================================================================
  function cmpRows(cmp) {
    // filas de UNA comparación → { id -> { lfc, padj } } con su mapeo de columnas
    const tk = cmp.headers[cmp.mapping.taxon], lk = cmp.headers[cmp.mapping.lfc], pk = cmp.headers[cmp.mapping.padj];
    const out = {};
    cmp.rows.forEach((r) => {
      const id = String(r[tk] ?? '').trim();
      if (!id) return;
      const lfc = parseFloat(r[lk]);
      const padj = parseFloat(r[pk]);
      out[id] = { lfc: isFinite(lfc) ? lfc : null, padj: (isFinite(padj) && padj >= 0) ? padj : null };
    });
    return out;
  }

  async function addComparisonFromFile(file) {
    let ing;
    try { ing = await ingestFile(file); }
    catch (e) { return { error: (e && e.message) || String(e) }; }
    const da = ing.results.find((r) => r.kind === 'differentialAbundance');
    if (!da) return { error: t('differential.cmpNotRecognised', { name: file.name }) };
    const fileId = registerFile(file.name, file.size, 'Comparación — ' + file.name);
    addDiffComparison({
      label: comparisonLabel(file.name) || file.name.replace(/\.[^.]+$/, ''),
      sourceFileId: fileId,
      headers: da.headers, rows: da.rows, mapping: da.mapping, entityType: da.entityType,
    });
    return { ok: true, warnings: ing.warnings };
  }

  function renderCompare() {
    const comparisons = Array.isArray(state.diffComparisons) ? state.diffComparisons : [];

    const intro = document.createElement('section');
    intro.className = 'ql-card ql-panel';
    intro.style.marginBottom = '20px';
    intro.innerHTML = '<h2>' + t('differential.cmpTitle') + '</h2><p class="ql-panel-note">' + t('differential.cmpIntro') + '</p>';

    const bar = document.createElement('div');
    bar.className = 'ql-session-bar';
    const addBtn = document.createElement('button');
    addBtn.type = 'button'; addBtn.className = 'ql-btn'; addBtn.textContent = t('differential.cmpAdd');
    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = '.csv,.tsv,.txt'; fileInput.style.display = 'none';
    addBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      addBtn.disabled = true;
      const res = await addComparisonFromFile(f);
      addBtn.disabled = false;
      if (res.error) { cmpMsg.textContent = res.error; }
      // addDiffComparison hace notify() → paint() por el subscribe
    });
    bar.append(addBtn, fileInput);

    if (state.differentialAbundance && !comparisons.some((c) => c.sourceFileId === state.differentialAbundance.sourceFileId)) {
      const useInd = document.createElement('button');
      useInd.type = 'button'; useInd.className = 'ql-btn'; useInd.textContent = t('differential.cmpUseIndividual');
      useInd.addEventListener('click', () => {
        const da = state.differentialAbundance;
        const fname = (state.files.find((f) => f.id === da.sourceFileId) || {}).name || 'comparación';
        addDiffComparison({
          label: comparisonLabel(fname) || fname.replace(/\.[^.]+$/, ''),
          sourceFileId: da.sourceFileId,
          headers: da.headers, rows: da.rows, mapping: { ...da.mapping }, entityType: da.entityType,
        });
      });
      bar.appendChild(useInd);
    }
    if (comparisons.length === 0) {
      const exBtn = document.createElement('button');
      exBtn.type = 'button'; exBtn.className = 'ql-btn'; exBtn.textContent = t('differential.cmpExample');
      exBtn.addEventListener('click', async () => { exBtn.disabled = true; try { await loadRealDiffComparisons(); } catch (e) { /* noop */ } });
      bar.appendChild(exBtn);
    }
    intro.appendChild(bar);
    const cmpMsg = document.createElement('p');
    cmpMsg.className = 'ql-field-help';
    intro.appendChild(cmpMsg);
    container.appendChild(intro);

    if (comparisons.length === 0) {
      const empty = document.createElement('section');
      empty.className = 'ql-card ql-panel';
      empty.innerHTML = '<p class="ql-field-help">' + t('differential.cmpEmpty') + '</p>';
      container.appendChild(empty);
      return;
    }

    // ---- lista de comparaciones: etiqueta editable + mapeo de columnas + quitar ----
    const listCard = document.createElement('section');
    listCard.className = 'ql-card ql-panel';
    listCard.style.marginBottom = '20px';
    listCard.innerHTML = '<h2>' + t('differential.cmpLoaded', { n: comparisons.length }) + '</h2>';
    comparisons.forEach((cmp) => {
      const row = document.createElement('div');
      row.className = 'ql-cmp-row';
      const lblInput = document.createElement('input');
      lblInput.type = 'text'; lblInput.value = cmp.label; lblInput.className = 'ql-cmp-label';
      lblInput.setAttribute('aria-label', t('differential.cmpLabelAria'));
      lblInput.addEventListener('change', () => updateDiffComparison(cmp.id, { label: lblInput.value.trim() || cmp.label }));
      row.appendChild(lblInput);

      const mapWrap = document.createElement('div');
      mapWrap.className = 'ql-cmp-map';
      ['taxon', 'lfc', 'padj'].forEach((key) => {
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', ({ taxon: t('differential.colTaxon'), lfc: t('differential.colLfc'), padj: t('differential.colPadj') }[key]));
        cmp.headers.forEach((h, i) => {
          const o = document.createElement('option');
          o.value = String(i); o.textContent = h || t('ui.columnN', { n: i + 1 });
          if (cmp.mapping[key] === i) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', () => updateDiffComparison(cmp.id, { mapping: { ...cmp.mapping, [key]: parseInt(sel.value, 10) } }));
        mapWrap.appendChild(sel);
      });
      row.appendChild(mapWrap);

      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'ql-cmp-rm'; rm.title = t('ui.remove'); rm.textContent = '✕';
      rm.addEventListener('click', () => removeDiffComparison(cmp.id));
      row.appendChild(rm);
      listCard.appendChild(row);
    });
    container.appendChild(listCard);

    if (comparisons.length < 2) {
      const need = document.createElement('section');
      need.className = 'ql-card ql-panel';
      need.innerHTML = '<p class="ql-field-help">' + t('differential.cmpNeed2') + '</p>';
      container.appendChild(need);
      return;
    }

    // ---- matriz por entidad: LFC/padj por comparación + "sig. en N de M" ----
    const perCmp = comparisons.map((c) => ({ cmp: c, byId: cmpRows(c) }));
    const allIds = new Set();
    perCmp.forEach((p) => Object.keys(p.byId).forEach((id) => allIds.add(id)));
    const isKO = comparisons.some((c) => c.entityType === 'ko');

    // solo entidades significativas en AL MENOS una comparación — así la tabla y
    // el diagrama de solapamiento cuentan la misma historia
    const rows = [...allIds].map((id) => {
      const cells = perCmp.map((p) => p.byId[id] || null);
      const sigCells = cells.filter((c) => c && c.padj != null && c.padj < cmpPadj);
      const sigCount = sigCells.length;
      const signs = sigCells.map((c) => Math.sign(c.lfc || 0)).filter((s) => s !== 0);
      const concordant = signs.length > 0 && signs.every((s) => s === signs[0]);
      return { id, cells, sigCount, concordant };
    }).filter((r) => r.sigCount > 0);

    // partición de solapamiento (entidad → comparaciones donde es significativa)
    const memberSets = perCmp.map((p) => Object.keys(p.byId).filter((id) => {
      const c = p.byId[id]; return c && c.padj != null && c.padj < cmpPadj;
    }));
    const setNames = comparisons.map((c) => c.label);
    const { byMask, presence } = partitionByMask(setNames, memberSets);

    // controles: umbral padj
    const ctl = document.createElement('section');
    ctl.className = 'ql-card ql-panel';
    ctl.style.marginBottom = '20px';
    ctl.innerHTML = '<h2>' + t('ui.controls') + '</h2>';
    const pf = document.createElement('div');
    pf.className = 'ql-field';
    pf.innerHTML = '<label for="cmpPadj">' + t('differential.cmpPadjLabel') + '</label>' +
      '<div class="ql-inputrow">' +
      '<input type="range" aria-label="' + escapeHtml(t('differential.cmpPadjLabel')) + '" id="cmpPadjR" min="0.001" max="0.2" step="0.001" value="' + cmpPadj + '" />' +
      '<input type="number" id="cmpPadj" class="ql-num-small tabular" min="0.0001" max="1" step="0.001" value="' + cmpPadj + '" /></div>' +
      '<p class="ql-field-help">' + t('differential.cmpPadjHelp') + '</p>';
    ctl.appendChild(pf);
    const pR = pf.querySelector('#cmpPadjR'), pN = pf.querySelector('#cmpPadj');
    const applyP = (v) => { const nv = Math.max(0.0001, Math.min(1, Number(v))); if (isFinite(nv) && nv !== cmpPadj) { cmpPadj = nv; cmpOpenMask = null; paint(); } };
    pR.addEventListener('input', () => { pN.value = pR.value; });
    pR.addEventListener('change', () => applyP(pR.value));
    pN.addEventListener('change', () => applyP(pN.value));
    container.appendChild(ctl);

    // ---- diagrama de solapamiento (2-4 comparaciones) ----
    if (comparisons.length >= 2 && comparisons.length <= 4) {
      const diagCard = document.createElement('section');
      diagCard.className = 'ql-card ql-panel';
      diagCard.style.marginBottom = '20px';
      diagCard.innerHTML = '<h2>' + t('differential.cmpOverlapTitle') + '</h2>' +
        '<p class="ql-panel-note">' + t('differential.cmpOverlapNote', { p: cmpPadj }) + '</p>';
      const diagWrap = document.createElement('div');
      diagWrap.className = 'ql-chartwrap';
      diagCard.appendChild(diagWrap);
      container.appendChild(diagCard);
      const cmpSvg = drawVenn(diagWrap, setNames, byMask, (mask) => { cmpOpenMask = (cmpOpenMask === mask ? null : mask); paint(); }, {
        ariaLabel: t('differential.cmpOverlapAria'),
      });
      // mismo editor que el Venn de #/venn: este diagrama era el único sin
      // barra Personalizar/Ajustes/pantalla completa/descargas
      if (cmpSvg) {
        const vb = cmpSvg.viewBox.baseVal;
        editor = attachChartEditor({
          key: 'differentialAbundance-compareVenn', svg: cmpSvg, mount: diagCard, filename: 'diferencial-solapamiento', lang: getLang(),
          elements: [
            { id: 'title', create: { text: t('differential.cmpOverlapTitle'), x: vb.x + vb.width / 2, y: vb.y + 16, anchor: 'middle', cls: 'ce-title' } },
            ...setNames.map((_, gi) => ({ id: 'grp' + gi, selector: '[data-ce="grp' + gi + '"]' })),
          ],
          paletteSeries: setNames.map((g, i) => ({ id: 's' + i, label: g })),
          paletteType: 'categorical',
          onReset: () => paint(),
          startEditing: wasEditing,
        });
      }
      if (cmpOpenMask != null) {
        const inSets = setNames.filter((_, i) => (cmpOpenMask >> i) & 1);
        const members = (byMask.get(cmpOpenMask) || []).slice().sort();
        const sel = document.createElement('p');
        sel.className = 'ql-field-help';
        sel.innerHTML = '<strong>' + escapeHtml(inSets.join(' ∩ ')) + '</strong> (' + members.length + '): ' +
          members.map((m) => '<span class="mono">' + escapeHtml(m) + '</span>').join(', ');
        diagCard.appendChild(sel);
      }
    }

    // ---- matriz de consenso entre métodos ----
    // Por cada par de comparaciones: entidades significativas en AMBAS, separando
    // las que coinciden en el signo del efecto (concordantes) de las de signo
    // opuesto (discordantes → señal poco fiable). La diagonal = sig. de cada una.
    {
      const sigDir = perCmp.map((p) => {
        const m = new Map(); // id -> signo (+1 / -1 / 0)
        Object.keys(p.byId).forEach((id) => {
          const c = p.byId[id];
          if (c && c.padj != null && c.padj < cmpPadj) m.set(id, Math.sign(c.lfc || 0));
        });
        return m;
      });
      const consCard = document.createElement('section');
      consCard.className = 'ql-card ql-panel';
      consCard.style.marginBottom = '20px';
      consCard.innerHTML = '<h2>' + t('differential.cmpConsensusTitle') + '</h2>' +
        '<p class="ql-panel-note">' + t('differential.cmpConsensusNote', { p: cmpPadj }) + '</p>';
      const cScroll = document.createElement('div');
      cScroll.className = 'ql-table-scroll scroll-x';
      const cTbl = document.createElement('table');
      cTbl.className = 'ql-table ql-consensus';
      let ch = '<thead><tr><td></td>';
      comparisons.forEach((c) => { ch += '<th scope="col">' + escapeHtml(c.label) + '</th>'; });
      ch += '</tr></thead>';
      let cb = '<tbody>';
      comparisons.forEach((ci, i) => {
        cb += '<tr><th scope="row">' + escapeHtml(ci.label) + '</th>';
        comparisons.forEach((cj, j) => {
          if (i === j) { cb += '<td class="ql-num tabular ql-cons-diag">' + sigDir[i].size + '</td>'; return; }
          let concord = 0, discord = 0;
          sigDir[i].forEach((si, id) => {
            if (!sigDir[j].has(id)) return;
            const sj = sigDir[j].get(id);
            if (si !== 0 && sj !== 0 && si !== sj) discord++;
            else concord++;
          });
          cb += '<td class="ql-num tabular">' +
            (concord + discord === 0 ? '<span class="ql-cell-muted">0</span>' : '<strong>' + concord + '</strong>' +
              (discord ? ' <span class="ql-cons-disc" title="' + escapeHtml(t('differential.cmpConsensusDiscord')) + '">(' + discord + ' ✗)</span>' : '')) +
            '</td>';
        });
        cb += '</tr>';
      });
      cTbl.innerHTML = ch + cb + '</tbody>';
      cScroll.appendChild(cTbl);
      consCard.appendChild(cScroll);

      const fullSig = [...allIds].filter((id) => perCmp.every((p) => {
        const c = p.byId[id]; return c && c.padj != null && c.padj < cmpPadj;
      }));
      const consistent = fullSig.filter((id) => {
        const signs = perCmp.map((p) => Math.sign(p.byId[id].lfc || 0)).filter((s) => s !== 0);
        return signs.length > 0 && signs.every((s) => s === signs[0]);
      }).sort();
      const consP = document.createElement('p');
      consP.className = 'ql-field-help';
      consP.innerHTML = t('differential.cmpConsensusAll', { n: consistent.length, m: comparisons.length }) +
        (consistent.length ? ' ' + consistent.slice(0, 40).map((x) => '<span class="mono">' + escapeHtml(x) + '</span>').join(', ') : '');
      consCard.appendChild(consP);
      container.appendChild(consCard);
    }

    // ---- tabla resumen ----
    const tableCard = document.createElement('section');
    tableCard.className = 'ql-card ql-panel';
    tableCard.innerHTML = '<h2>' + t('differential.cmpTableTitle') + '</h2>' +
      '<p class="ql-panel-note">' + t('differential.cmpTableNote', { n: rows.length, m: comparisons.length }) + '</p>';
    const scrollDiv = document.createElement('div');
    scrollDiv.className = 'ql-table-scroll scroll-x';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table';

    const headCells = [['id', isKO ? 'KO' : t('differential.colTaxon')]];
    comparisons.forEach((c, i) => headCells.push(['c' + i, c.label]));
    headCells.push(['count', t('differential.cmpSigCount', { m: comparisons.length })]);
    let thead = '<thead><tr>';
    headCells.forEach(([key, lbl]) => {
      const on = cmpSort.key === key;
      thead += '<th aria-sort="' + (on ? (cmpSort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '">' +
        '<button type="button" data-sort="' + key + '">' + escapeHtml(lbl) +
        (on ? ' <span aria-hidden="true">' + (cmpSort.dir === 'asc' ? '▲' : '▼') + '</span>' : '') + '</button></th>';
    });
    tbl.innerHTML = thead + '</tr></thead>';

    const dir = cmpSort.dir === 'asc' ? 1 : -1;
    const sorted = rows.slice().sort((a, b) => {
      if (cmpSort.key === 'id') return a.id.localeCompare(b.id) * dir;
      if (cmpSort.key === 'count') return (a.sigCount - b.sigCount) * dir || a.id.localeCompare(b.id);
      const ci = parseInt(cmpSort.key.slice(1), 10);
      const av = a.cells[ci] && a.cells[ci].padj != null ? a.cells[ci].padj : Infinity;
      const bv = b.cells[ci] && b.cells[ci].padj != null ? b.cells[ci].padj : Infinity;
      return (av - bv) * dir;
    });

    const tb = document.createElement('tbody');
    sorted.slice(0, 300).forEach((r) => {
      const tr = document.createElement('tr');
      let html = '<td>' + (isKO
        ? '<span class="mono">' + escapeHtml(r.id) + '</span> <a class="ql-kegg-link" href="' + escapeHtml(keggEntryUrl(r.id)) + '" target="_blank" rel="noopener">KEGG&nbsp;↗</a>'
        : escapeHtml(r.id)) + '</td>';
      r.cells.forEach((c) => {
        if (!c || c.lfc == null) { html += '<td class="ql-num tabular ql-cell-muted">—</td>'; return; }
        const sig = c.padj != null && c.padj < cmpPadj;
        html += '<td class="ql-num tabular"' + (sig ? ' style="font-weight:600;"' : '') + '>' +
          c.lfc.toFixed(2) + ' <span class="ql-cell-muted">(' + (c.padj != null ? formatP(c.padj) : '—') + ')</span></td>';
      });
      html += '<td class="ql-num tabular">' + r.sigCount + ' / ' + comparisons.length +
        (r.sigCount >= 2
          ? (r.concordant
            ? ' <span class="ql-cons-ok" title="' + escapeHtml(t('differential.cmpConsensusOk')) + '">✓</span>'
            : ' <span class="ql-cons-disc" title="' + escapeHtml(t('differential.cmpConsensusMixed')) + '">✗</span>')
          : '') + '</td>';
      tr.innerHTML = html;
      tb.appendChild(tr);
    });
    if (sorted.length > 300) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="' + headCells.length + '" style="text-align:center;color:var(--ink-muted);padding:12px;">' +
        t('differential.cmpTruncated', { shown: 300, total: sorted.length }) + '</td>';
      tb.appendChild(tr);
    }
    tbl.appendChild(tb);
    scrollDiv.appendChild(tbl);
    tableCard.appendChild(scrollDiv);
    container.appendChild(tableCard);
    tbl.querySelectorAll('th button[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sort');
        if (cmpSort.key === key) cmpSort = { key, dir: cmpSort.dir === 'asc' ? 'desc' : 'asc' };
        else cmpSort = { key, dir: key === 'id' ? 'asc' : (key === 'count' ? 'desc' : 'asc') };
        paint();
      });
    });
  }

  paint();
  const stop = subscribe(paint);
  return () => { stop(); if (editor) { editor.destroy(); editor = null; } };
}
