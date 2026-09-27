import { state, subscribe } from '../state.js';
import { t, getLang } from '../lib/i18n.js';
import { upgma, leafOrder, permanova, formatP, confidenceEllipsePoints } from '../lib/stats.js';
import { upgmaOrderAsync } from '../lib/heavyStats.js';
import { makeGroupResolver } from '../lib/sampleMatch.js';
import { rda, cca } from '../lib/constrainedOrdination.js';
import { glossaryLinkHtml } from '../lib/glossaryLink.js';
import { taxaRelativeAbundance } from '../lib/taxaAbundance.js';
import { loadExampleCommunityData, loadRealCommunityData, mountExampleButtons } from '../lib/exampleData.js';
import { attachChartEditor, getColorScaleOptions, getFigureOptions } from '../lib/chartEditor.js';
import { CATEGORICAL_SCATTER_MAX, paletteColorsOf } from '../lib/palettes.js';
import { makeColorScale } from '../lib/colorScale.js';
import { svgEl, escapeHtml, delegateHover, plotClip } from '../lib/dom.js';
import { showTooltip, hideTooltip } from '../lib/tooltip.js';
import { chartTypeField } from '../lib/chartTypeSelector.js';
import { methodNoticeHtml } from '../lib/methodEquivalence.js';

const CAT_VARS = ['--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5', '--cat-6', '--cat-7'];
const NUM_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const RDA_TOPN_DEFAULT = 15, RDA_TOPN_MIN = 5, RDA_TOPN_MAX = 40;

// columnas de metadatos usables como variable numérica de tamaño en el PCoA
// de burbujas — mismo criterio que collectVariables() en correlogram.js: al
// menos 3 valores numéricos que cubran ≥60% de las filas no vacías de esa columna.
function numericMetaColumns(groupOptions) {
  if (!state.metadata) return [];
  return groupOptions.filter((col) => {
    let seen = 0, numeric = 0;
    state.metadata.rows.forEach((r) => {
      const raw = r[col];
      if (raw == null || String(raw).trim() === '') return;
      seen++;
      if (NUM_RE.test(String(raw).trim())) numeric++;
    });
    return numeric >= 3 && numeric >= seen * 0.6;
  });
}
function line(x1, y1, x2, y2) {
  return svgEl('line', { x1, y1, x2, y2, class: 'ql-baseline-line' });
}
function drawDendrogram(node, svg, xOf, yScale) {
  if (!node.left && !node.right) return { x: xOf(node.label), y: yScale(0) };
  const L = drawDendrogram(node.left, svg, xOf, yScale);
  const R = drawDendrogram(node.right, svg, xOf, yScale);
  const y = yScale(node.height);
  svg.appendChild(line(L.x, L.y, L.x, y));
  svg.appendChild(line(R.x, R.y, R.x, y));
  svg.appendChild(line(L.x, y, R.x, y));
  return { x: (L.x + R.x) / 2, y };
}

// explicación llana de una métrica de distancia, por su nombre
const BETA_EXPLAIN = [
  [/bray.?curtis/i, 'beta.exBray'],
  [/jaccard/i, 'beta.exJaccard'],
  [/unweighted.*unifrac/i, 'beta.exUwUnifrac'],
  [/weighted.*unifrac/i, 'beta.exWUnifrac'],
  [/unifrac/i, 'beta.exUnifrac'],
  [/aitchison/i, 'beta.exAitchison'],
];
function explainBetaMetric(name) {
  const n = String(name || '').trim();
  for (const [re, key] of BETA_EXPLAIN) if (re.test(n)) return t(key);
  return null;
}
function metricExplainEl(name) {
  const txt = explainBetaMetric(name);
  if (!txt) return null;
  const p = document.createElement('p');
  p.className = 'ql-metric-explain';
  p.innerHTML = '<strong>' + escapeHtml(String(name)) + '.</strong> ' + escapeHtml(txt);
  return p;
}

export function render(container) {
  let view = 'heatmap';
  let metric = null;
  let orderMode = 'clustering';
  let pcX = 0, pcY = 1;
  let pcoaGroupCol = null;
  let pcoaPlotStyle = 'scatter'; // 'scatter' | 'bubbles' | '3d'
  let rot3dX = -0.4, rot3dY = 0.6; // ángulos de rotación (radianes) de la nube 3D, persisten entre repintados
  let pcoaSizeCol = null;        // columna numérica de metadatos usada como tamaño en 'bubbles'
  let pcoaShowEllipses = false;  // elipses de confianza al 95% por grupo (2D, no aplica a 'bubbles' ni '3d')
  let editor = null;
  let wasEditing = false; // ver cfg.startEditing en chartEditor.js — capturado en paint() antes de
                           // destruir el editor, leído por renderHeatmap/renderConstrained/renderPcoa
                           // (funciones hermanas de paint(), no anidadas) al recrearlo
  let permGroupCol = null;
  let permN = 999;
  let permResult = null;   // cache del último cálculo {key, res}
  let rdaMethod = 'rda';     // 'rda' | 'cca'
  let rdaHellinger = true;   // transformación de Hellinger (solo aplica a 'rda')
  let rdaTopN = RDA_TOPN_DEFAULT; // nº de taxones incluidos como matriz respuesta
  let rdaVars = null;        // Set<nombre de columna de metadatos> elegidas como explicativas — null hasta inicializar
  let rdaShowSpecies = false;
  let rdaColorCol = null;
  // UPGMA de matrices grandes corre en un Web Worker (js/lib/heavyStats.js);
  // cacheamos el resultado para que el repaint tras el worker no lo relance.
  let heatCache = null;   // { key, tree, order }
  let clusterGen = 0;     // token: descarta resultados de un worker ya obsoleto

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
      '<p class="ql-eyebrow">' + t('beta.eyebrow') + '</p>' +
      '<h1 class="ql-page-title">' + t('beta.title') + '</h1>' +
      '<p class="ql-page-sub">' + t('beta.subtitle') + '</p>';
    container.appendChild(header);

    const hasHeat = !!state.betaDiversity;
    const hasPcoa = !!state.ordination;
    const hasConstrained = !!(taxaRelativeAbundance() && state.metadata);

    if (!hasHeat && !hasPcoa && !hasConstrained) {
      const card = document.createElement('div');
      card.className = 'ql-card ql-panel';
      card.innerHTML =
        '<div class="ql-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="17" r="2.4"/><circle cx="17" cy="17" r="2.4"/><circle cx="12" cy="7" r="2.4"/><path d="m9 15.5 1.7-6M15 15.5l-1.7-6"/></svg>' +
        '<h3>' + t('beta.emptyTitle') + '</h3><p>' + t('beta.emptyDesc') + '</p>' +
        '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">' +
        '<a href="#/cargar" class="ql-btn">' + t('ui.goLoadData') + '</a></div></div>';
      container.appendChild(card);
      mountExampleButtons(card.querySelector('.ql-empty'), { real: loadRealCommunityData, synthetic: loadExampleCommunityData, download: ['betaqza', 'pcoa', 'metadata'] });
      return;
    }

    if (view === 'heatmap' && !hasHeat) view = hasPcoa ? 'pcoa' : 'constrained';
    if (view === 'pcoa' && !hasPcoa) view = hasHeat ? 'heatmap' : 'constrained';
    if (view === 'constrained' && !hasConstrained) view = hasHeat ? 'heatmap' : 'pcoa';

    const tabDefs = [['heatmap', t('beta.tabHeatmap'), hasHeat], ['pcoa', t('beta.tabPcoa'), hasPcoa], ['constrained', t('beta.tabConstrained'), hasConstrained]];
    const tabs = document.createElement('div');
    tabs.className = 'ql-tabs';
    tabDefs.filter(([, , avail]) => avail).forEach(([v, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-tab' + (view === v ? ' is-active' : '');
      b.textContent = label;
      b.addEventListener('click', () => { view = v; paint(); });
      tabs.appendChild(b);
    });
    container.appendChild(tabs);

    if (view === 'heatmap') renderHeatmap();
    else if (view === 'pcoa') renderPcoa(hasPcoa);
    else renderConstrained();

    if (hasHeat && state.metadata) renderPermanova();
  }

  // =========================================================================
  //  PERMANOVA de un factor (adonis2 en JS puro)
  // =========================================================================
  function renderPermanova() {
    const metrics = Object.keys(state.betaDiversity.metrics);
    const m = (metric && metrics.includes(metric)) ? metric : metrics[0];
    const data = state.betaDiversity.metrics[m];
    const groupOptions = state.metadata.headers.filter((h) => h !== state.metadata.sampleIdKey);
    if (!groupOptions.length) return;
    if (!permGroupCol || !groupOptions.includes(permGroupCol)) permGroupCol = groupOptions[0];

    const card = document.createElement('section');
    card.className = 'ql-card ql-panel';
    card.style.marginTop = '20px';
    card.innerHTML = '<h2>' + t('beta.permTitle') + '</h2><p class="ql-panel-note">' + t('beta.permNote', { metric: escapeHtml(m) }) + '</p>';

    const controls = document.createElement('div');
    controls.className = 'ql-inputrow';
    controls.style.cssText = 'flex-wrap:wrap;gap:14px;margin-bottom:14px;';

    const gf = document.createElement('div');
    gf.className = 'ql-field';
    gf.style.cssText = 'flex:1 1 160px;margin:0;';
    gf.innerHTML = '<label>' + t('beta.permGroup') + '</label>';
    const gsel = document.createElement('select');
    groupOptions.forEach((h) => {
      const o = document.createElement('option');
      o.value = h; o.textContent = h;
      if (h === permGroupCol) o.selected = true;
      gsel.appendChild(o);
    });
    gsel.addEventListener('change', () => { permGroupCol = gsel.value; permResult = null; paint(); });
    gf.appendChild(gsel);
    controls.appendChild(gf);

    const pf = document.createElement('div');
    pf.className = 'ql-field';
    pf.style.cssText = 'flex:0 0 auto;margin:0;';
    pf.innerHTML = '<label>' + t('beta.permPermutations') + '</label>';
    const psel = document.createElement('select');
    [99, 499, 999, 4999, 9999].forEach((v) => {
      const o = document.createElement('option');
      o.value = String(v); o.textContent = String(v);
      if (v === permN) o.selected = true;
      psel.appendChild(o);
    });
    psel.addEventListener('change', () => { permN = parseInt(psel.value, 10); permResult = null; paint(); });
    pf.appendChild(psel);
    controls.appendChild(pf);
    card.appendChild(controls);

    // resolver muestra → grupo, en el orden de la matriz
    const resolve = makeGroupResolver(state.metadata, permGroupCol);
    const groups = data.sampleIds.map((sid) => resolve(sid));
    const keep = [];
    groups.forEach((g, i) => { if (g != null && g !== '') keep.push(i); });
    const nDropped = data.sampleIds.length - keep.length;

    const key = m + '|' + permGroupCol + '|' + permN + '|' + keep.length + '|' + data.sourceFileId;
    if (!permResult || permResult.key !== key) {
      if (keep.length < 4) {
        permResult = { key, res: { error: t('beta.permTooFew') } };
      } else {
        const sub = keep.map((i) => keep.map((j) => data.matrix[i][j]));
        const subGroups = keep.map((i) => groups[i]);
        permResult = { key, res: permanova(sub, subGroups, { permutations: permN, seed: 0x5152 }) };
      }
    }
    const r = permResult.res;

    if (r.error) {
      card.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + escapeHtml(r.error) + '</p>');
      container.appendChild(card);
      return;
    }

    const sig = isFinite(r.p) && r.p < 0.05;
    const scrollDiv = document.createElement('div');
    scrollDiv.className = 'ql-table-scroll scroll-x';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table';
    tbl.innerHTML = '<thead><tr><th></th><th>' + t('beta.permDf') + '</th><th>' + t('beta.permSS') +
      '</th><th>R²</th><th>' + t('beta.permF') + '</th><th>' + t('beta.permP') + '</th></tr></thead>' +
      '<tbody>' +
      '<tr><td>' + escapeHtml(permGroupCol) + '</td><td class="ql-num tabular">' + r.df1 + '</td>' +
      '<td class="ql-num tabular">' + r.SSa.toFixed(4) + '</td>' +
      '<td class="ql-num tabular">' + r.R2.toFixed(4) + '</td>' +
      '<td class="ql-num tabular">' + r.F.toFixed(3) + '</td>' +
      '<td class="ql-num tabular">' + formatP(r.p) + (sig ? ' <span class="mono">∗</span>' : '') + '</td></tr>' +
      '<tr><td>' + t('beta.permResidual') + '</td><td class="ql-num tabular">' + r.df2 + '</td>' +
      '<td class="ql-num tabular">' + r.SSw.toFixed(4) + '</td>' +
      '<td class="ql-num tabular">' + (1 - r.R2).toFixed(4) + '</td><td></td><td></td></tr>' +
      '<tr><td>' + t('beta.permTotal') + '</td><td class="ql-num tabular">' + (r.df1 + r.df2) + '</td>' +
      '<td class="ql-num tabular">' + r.SSt.toFixed(4) + '</td><td class="ql-num tabular">1.0000</td><td></td><td></td></tr>' +
      '</tbody>';
    scrollDiv.appendChild(tbl);
    card.appendChild(scrollDiv);

    const verdict = document.createElement('p');
    verdict.style.cssText = 'margin:12px 0 0;font-size:13px;';
    verdict.innerHTML = '<strong style="color:' + (sig ? 'var(--good)' : 'var(--ink-muted)') + ';">' +
      (sig ? t('beta.permSig') : t('beta.permNs')) + '</strong> ' +
      t('beta.permInterpret', { pct: (r.R2 * 100).toFixed(1), group: escapeHtml(permGroupCol), n: r.permutations });
    card.appendChild(verdict);

    const groupsInfo = document.createElement('p');
    groupsInfo.className = 'ql-field-help';
    groupsInfo.textContent = t('beta.permGroups', {
      list: r.groups.map((g, i) => g + ' (n=' + r.groupSizes[i] + ')').join(', '),
    }) + (nDropped ? ' · ' + t('beta.permDropped', { n: nDropped }) : '');
    card.appendChild(groupsInfo);

    const disc = document.createElement('p');
    disc.className = 'ql-field-help';
    disc.style.fontStyle = 'italic';
    disc.textContent = t('beta.permDisclaimer');
    card.appendChild(disc);
    card.insertAdjacentHTML('beforeend', methodNoticeHtml('permanova'));

    container.appendChild(card);
  }

  // =========================================================================
  //  ORDENACIÓN RESTRINGIDA — RDA / CCA (js/lib/constrainedOrdination.js)
  // =========================================================================
  function renderConstrained() {
    const abundance = taxaRelativeAbundance();
    if (!abundance || !state.metadata) {
      const card = document.createElement('div');
      card.className = 'ql-card ql-panel';
      card.style.marginTop = '18px';
      card.innerHTML = '<div class="ql-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="17" r="2.4"/><circle cx="17" cy="17" r="2.4"/><circle cx="12" cy="7" r="2.4"/><path d="m9 15.5 1.7-6M15 15.5l-1.7-6"/></svg>' +
        '<h3>' + t('beta.rdaEmptyTitle') + '</h3><p>' + t('beta.rdaEmptyDesc') + '</p></div>';
      container.appendChild(card);
      mountExampleButtons(card.querySelector('.ql-empty'), { real: loadRealCommunityData, synthetic: loadExampleCommunityData, download: ['counts', 'metadata'] });
      return;
    }

    const sampleIdsAll = Array.from(abundance.bySample[abundance.ranked[0]].keys());
    const groupOptions = state.metadata.headers.filter((h) => h !== state.metadata.sampleIdKey);
    const numericCols = numericMetaColumns(groupOptions);
    if (rdaVars == null) rdaVars = new Set(numericCols.length ? numericCols.slice(0, Math.min(3, numericCols.length)) : groupOptions.slice(0, 1));

    const grid = document.createElement('div');
    grid.className = 'ql-grid-2';

    const chartPanel = document.createElement('section');
    chartPanel.className = 'ql-card ql-panel';
    chartPanel.innerHTML = '<p class="ql-panel-note" style="margin-bottom:4px;">' + t('beta.rdaNote') + '</p>';
    const chartWrap = document.createElement('div');
    chartWrap.className = 'ql-chartwrap';
    const svg = svgEl('svg', { class: 'ql-svg', role: 'img', 'aria-label': rdaMethod.toUpperCase() });
    const tooltip = document.createElement('div');
    tooltip.className = 'ql-tooltip';
    chartWrap.appendChild(svg); chartWrap.appendChild(tooltip);
    chartPanel.appendChild(chartWrap);
    grid.appendChild(chartPanel);

    const controls = document.createElement('aside');
    controls.className = 'ql-card ql-panel';
    controls.innerHTML = '<h2>' + t('ui.controls') + '</h2>';

    controls.appendChild(chartTypeField({
      labelKey: 'beta.rdaMethodLabel',
      options: [{ value: 'rda', labelKey: 'beta.rdaMethodRda' }, { value: 'cca', labelKey: 'beta.rdaMethodCca' }],
      active: rdaMethod,
      onChange: (v) => { rdaMethod = v; paint(); },
      helpKey: rdaMethod === 'rda' ? 'beta.rdaMethodRdaHelp' : 'beta.rdaMethodCcaHelp',
    }));

    if (rdaMethod === 'rda') {
      const hf = document.createElement('label');
      hf.className = 'ql-checkrow';
      hf.style.marginTop = '8px';
      const hcb = document.createElement('input');
      hcb.type = 'checkbox'; hcb.checked = rdaHellinger;
      hcb.addEventListener('change', () => { rdaHellinger = hcb.checked; paint(); });
      hf.appendChild(hcb);
      hf.appendChild(document.createTextNode(' ' + t('beta.rdaHellingerLabel')));
      controls.appendChild(hf);
      const hh = document.createElement('p'); hh.className = 'ql-field-help'; hh.textContent = t('beta.rdaHellingerHelp');
      controls.appendChild(hh);
    }

    const topField = document.createElement('div');
    topField.className = 'ql-field';
    topField.style.marginTop = '10px';
    topField.innerHTML = '<label for="rdaTopNr">' + t('beta.rdaTopNLabel') + '</label>' +
      '<div class="ql-inputrow">' +
      '<input type="range" id="rdaTopNr" min="' + RDA_TOPN_MIN + '" max="' + Math.max(RDA_TOPN_MIN, Math.min(RDA_TOPN_MAX, abundance.ranked.length)) + '" step="1" value="' + rdaTopN + '" />' +
      '<input type="number" id="rdaTopN" class="ql-num-small tabular" min="' + RDA_TOPN_MIN + '" max="' + RDA_TOPN_MAX + '" step="1" value="' + rdaTopN + '" /></div>';
    controls.appendChild(topField);
    const topR = topField.querySelector('#rdaTopNr'), topN2 = topField.querySelector('#rdaTopN');
    const applyTopN = (v) => {
      const nv = Math.max(RDA_TOPN_MIN, Math.min(RDA_TOPN_MAX, Math.round(Number(v) || RDA_TOPN_DEFAULT)));
      if (nv !== rdaTopN) { rdaTopN = nv; paint(); }
    };
    topR.addEventListener('change', () => applyTopN(topR.value));
    topN2.addEventListener('change', () => applyTopN(topN2.value));

    const vField = document.createElement('div');
    vField.className = 'ql-field';
    vField.style.marginTop = '10px';
    vField.innerHTML = '<label>' + t('beta.rdaVarsLabel') + ' (' + rdaVars.size + ')</label>';
    [[numericCols, 'beta.rdaGrpNumeric'], [groupOptions.filter((h) => !numericCols.includes(h)), 'beta.rdaGrpCategorical']].forEach(([cols, labelKey]) => {
      if (!cols.length) return;
      const gh = document.createElement('div'); gh.className = 'ql-checkgroup-h'; gh.textContent = t(labelKey);
      vField.appendChild(gh);
      cols.forEach((h) => {
        const row = document.createElement('label'); row.className = 'ql-checkrow';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = rdaVars.has(h);
        cb.addEventListener('change', () => { if (cb.checked) rdaVars.add(h); else rdaVars.delete(h); paint(); });
        row.appendChild(cb); row.appendChild(document.createTextNode(' ' + h));
        vField.appendChild(row);
      });
    });
    controls.appendChild(vField);

    const spf = document.createElement('label');
    spf.className = 'ql-checkrow';
    spf.style.marginTop = '10px';
    const spcb = document.createElement('input');
    spcb.type = 'checkbox'; spcb.checked = rdaShowSpecies;
    spcb.addEventListener('change', () => { rdaShowSpecies = spcb.checked; paint(); });
    spf.appendChild(spcb);
    spf.appendChild(document.createTextNode(' ' + t('beta.rdaShowSpeciesLabel')));
    controls.appendChild(spf);

    if (groupOptions.length) {
      const cf = document.createElement('div'); cf.className = 'ql-field'; cf.style.marginTop = '10px';
      cf.innerHTML = '<label>' + t('beta.colorBy') + '</label>';
      const csel = document.createElement('select');
      const noneOpt = document.createElement('option'); noneOpt.value = ''; noneOpt.textContent = t('beta.rdaColorNone');
      csel.appendChild(noneOpt);
      groupOptions.forEach((h) => {
        const o = document.createElement('option'); o.value = h; o.textContent = h;
        if (h === rdaColorCol) o.selected = true; csel.appendChild(o);
      });
      csel.addEventListener('change', () => { rdaColorCol = csel.value || null; paint(); });
      cf.appendChild(csel); controls.appendChild(cf);
    }

    grid.appendChild(controls);
    container.appendChild(grid);

    if (rdaVars.size === 0) {
      chartPanel.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('beta.rdaNoVars') + '</p>');
      return;
    }

    // ---- construir Y (top-N taxones) y X (variables elegidas, dummy-codificadas si son categóricas) ----
    const speciesNames = abundance.ranked.slice(0, rdaTopN);
    const varNames = [];
    const resolvers = {};
    rdaVars.forEach((col) => { resolvers[col] = makeGroupResolver(state.metadata, col); });
    // solo se conservan muestras con dato en TODAS las variables elegidas (igual criterio que PERMANOVA con 'keep')
    const validSamples = sampleIdsAll.filter((sid) => Array.from(rdaVars).every((col) => {
      const v = resolvers[col](sid);
      return v != null && String(v).trim() !== '';
    }));
    const nDropped = sampleIdsAll.length - validSamples.length;

    const Xcols = []; // [{name, values:[por muestra válida]}]
    Array.from(rdaVars).sort().forEach((col) => {
      if (numericCols.includes(col)) {
        Xcols.push({ name: col, values: validSamples.map((sid) => parseFloat(resolvers[col](sid))) });
      } else {
        const levels = Array.from(new Set(validSamples.map((sid) => String(resolvers[col](sid)).trim()))).sort();
        levels.slice(1).forEach((lvl) => { // k-1 dummies, se omite el primer nivel (referencia)
          Xcols.push({ name: col + '=' + lvl, values: validSamples.map((sid) => (String(resolvers[col](sid)).trim() === lvl ? 1 : 0)) });
        });
      }
    });
    Xcols.forEach((c) => varNames.push(c.name));
    const X = validSamples.map((_, i) => Xcols.map((c) => c.values[i]));
    let Y = validSamples.map((sid) => speciesNames.map((sp) => abundance.bySample[sp].get(sid) ?? 0));
    if (rdaMethod === 'rda' && rdaHellinger) {
      Y = Y.map((row) => {
        const s = row.reduce((a, b) => a + b, 0);
        return s > 0 ? row.map((v) => Math.sqrt(v / s)) : row.map(() => 0);
      });
    }

    let res;
    try {
      res = rdaMethod === 'cca' ? cca(Y, X, speciesNames, varNames, validSamples) : rda(Y, X, speciesNames, varNames, validSamples);
    } catch (e) {
      chartPanel.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + escapeHtml(e.message) + '</p>');
      return;
    }

    if (nDropped) {
      chartPanel.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('beta.rdaDropped', { n: nDropped }) + '</p>');
    }

    // ---- biplot: sitios + flechas de variables + especies (opcional) ----
    const W = 660, H = 520;
    const m = { t: 46, r: 20, b: 78, l: 62 };
    const innerW = W - m.l - m.r, innerH = H - m.t - m.b;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    const ax1 = 0, ax2 = Math.min(1, res.nAxes - 1);
    const resolveColor = rdaColorCol ? makeGroupResolver(state.metadata, rdaColorCol) : null;
    const colorGroups = resolveColor ? Array.from(new Set(validSamples.map((sid) => resolveColor(sid)).filter(Boolean))).sort() : [];
    const colorFor = (g) => (g == null || !colorGroups.length ? 'var(--depleted)' : 'var(' + CAT_VARS[colorGroups.indexOf(g) % CAT_VARS.length] + ')');

    const allX = res.siteScores.map((s) => s[ax1]).concat(rdaShowSpecies ? res.speciesScores.map((s) => s[ax1]) : []);
    const allY = res.siteScores.map((s) => s[ax2]).concat(rdaShowSpecies ? res.speciesScores.map((s) => s[ax2]) : []);
    // las flechas de variables viven en escala de correlación [-1,1]; se re-escalan
    // para ocupar aprox. el mismo radio que la nube de puntos (convención habitual
    // de biplot: la LONGITUD relativa de las flechas importa, no su unidad exacta)
    const cloudRadius = Math.max(0.3, ...allX.map(Math.abs), ...allY.map(Math.abs));
    const arrowScale = cloudRadius * 0.9;
    const xr = [Math.min(-arrowScale, ...allX), Math.max(arrowScale, ...allX)];
    const yr = [Math.min(-arrowScale, ...allY), Math.max(arrowScale, ...allY)];
    const padX = (xr[1] - xr[0]) * 0.1 || 0.1, padY = (yr[1] - yr[0]) * 0.1 || 0.1;
    const autoX = [xr[0] - padX, xr[1] + padX], autoY = [yr[0] - padY, yr[1] + padY];
    const so = getFigureOptions('betaConstrained');
    const xMin = so.axisXMin != null ? so.axisXMin : autoX[0], xMax = so.axisXMax != null ? so.axisXMax : autoX[1];
    const yMin = so.axisMin != null ? so.axisMin : autoY[0], yMax = so.axisMax != null ? so.axisMax : autoY[1];
    const sx = (v) => m.l + ((v - xMin) / (xMax - xMin)) * innerW;
    const sy = (v) => m.t + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
    const clip = plotClip(svg, 'ql-clip-rda', m.l, m.t, innerW, innerH);

    for (let k = 0; k <= 4; k++) {
      const gx = m.l + (k / 4) * innerW, gy = m.t + (k / 4) * innerH;
      svg.appendChild(svgEl('line', { x1: gx, x2: gx, y1: m.t, y2: m.t + innerH, class: 'ql-gridline' }));
      svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + innerW, y1: gy, y2: gy, class: 'ql-gridline' }));
    }
    if (xMin < 0 && xMax > 0) svg.appendChild(svgEl('line', { x1: sx(0), x2: sx(0), y1: m.t, y2: m.t + innerH, class: 'ql-baseline-line' }));
    if (yMin < 0 && yMax > 0) svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + innerW, y1: sy(0), y2: sy(0), class: 'ql-baseline-line' }));

    // especies (opcional), debajo de todo lo demás
    if (rdaShowSpecies) {
      const spG = svgEl('g', { 'clip-path': clip });
      svg.appendChild(spG);
      res.speciesScores.forEach((s, i) => {
        const cx = sx(s[ax1]), cy = sy(s[ax2]);
        spG.appendChild(svgEl('circle', { cx, cy, r: 3, fill: 'var(--ink-muted)', 'fill-opacity': 0.55, 'data-ce-role': 'marker' }));
        const lb = svgEl('text', { x: cx + 5, y: cy + 3, class: 'ql-tick-label', fill: 'var(--ink-muted)', 'font-size': 9 });
        lb.textContent = speciesNames[i].length > 14 ? speciesNames[i].slice(0, 13) + '…' : speciesNames[i];
        spG.appendChild(lb);
      });
    }

    // flechas de variables explicativas
    const arrowG = svgEl('g', { 'clip-path': clip });
    svg.appendChild(arrowG);
    res.biplotScores.forEach((b, j) => {
      const ex = b[ax1] * arrowScale, ey = b[ax2] * arrowScale;
      const x1 = sx(0), y1 = sy(0), x2 = sx(ex), y2 = sy(ey);
      arrowG.appendChild(svgEl('line', { x1, y1, x2, y2, stroke: 'var(--enriched)', 'stroke-width': 1.6, 'marker-end': 'url(#rda-arrowhead)', 'data-ce-role': 'line' }));
      const lb = svgEl('text', { x: x2 + (ex >= 0 ? 4 : -4), y: y2, class: 'ql-tick-label', 'text-anchor': ex >= 0 ? 'start' : 'end', fill: 'var(--enriched)', 'font-weight': 600 });
      lb.textContent = varNames[j];
      arrowG.appendChild(lb);
    });
    const defs = svgEl('defs', {});
    defs.innerHTML = '<marker id="rda-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="var(--enriched)"/></marker>';
    svg.insertBefore(defs, svg.firstChild);

    // sitios
    const pts = svgEl('g', { 'clip-path': clip });
    svg.appendChild(pts);
    validSamples.forEach((sid, i) => {
      const cx = sx(res.siteScores[i][ax1]), cy = sy(res.siteScores[i][ax2]);
      const g = resolveColor ? resolveColor(sid) : null;
      pts.appendChild(svgEl('circle', {
        cx, cy, r: 5, fill: colorFor(g), 'fill-opacity': 0.82, stroke: 'var(--surface)', 'stroke-width': 1.4, 'data-i': i, 'data-ce-role': 'marker',
        ...(g != null ? { 'data-ce-series-fill': 's' + colorGroups.indexOf(g) } : {}),
      }));
    });
    delegateHover(svg, 'circle[data-i]', {
      onEnter: (el) => {
        const i = +el.dataset.i, sid = validSamples[i];
        const g = resolveColor ? resolveColor(sid) : null;
        const cx = sx(res.siteScores[i][ax1]), cy = sy(res.siteScores[i][ax2]);
        showTooltip(chartWrap, cx, cy, escapeHtml(sid) + (g ? ' · ' + escapeHtml(g) : ''),
          res.method.toUpperCase() + (ax1 + 1) + ' ' + res.siteScores[i][ax1].toFixed(3) + ' · ' + res.method.toUpperCase() + (ax2 + 1) + ' ' + res.siteScores[i][ax2].toFixed(3),
          { svg, W, H, tooltip, rawHtml: true });
      },
      onLeave: () => hideTooltip(tooltip),
    });

    const mName = res.method.toUpperCase();
    const xTitle = svgEl('text', { x: m.l + innerW / 2, y: H - 40, class: 'ql-axis-label', 'text-anchor': 'middle', 'data-ce': 'xtitle' });
    xTitle.textContent = t('beta.rdaAxis', { method: mName, n: ax1 + 1, pct: (res.proportionExplained[ax1] * 100 || 0).toFixed(1) });
    svg.appendChild(xTitle);
    const yTitle = svgEl('text', { x: 16, y: m.t + innerH / 2, class: 'ql-axis-label', 'text-anchor': 'middle', transform: 'rotate(-90 16 ' + (m.t + innerH / 2) + ')', 'data-ce': 'ytitle' });
    yTitle.textContent = t('beta.rdaAxis', { method: mName, n: ax2 + 1, pct: (res.proportionExplained[ax2] * 100 || 0).toFixed(1) });
    svg.appendChild(yTitle);

    if (colorGroups.length) {
      const legG = svgEl('g', { 'data-ce': 'legend' });
      const perRow = Math.max(1, Math.floor(innerW / 130));
      colorGroups.forEach((g, i) => {
        const col = i % perRow, rw = Math.floor(i / perRow);
        const xx = col * 130, yy = rw * 15;
        legG.appendChild(svgEl('rect', { x: xx, y: yy - 8, width: 10, height: 10, rx: 5, fill: colorFor(g), 'data-ce-series-fill': 's' + i }));
        const tx = svgEl('text', { x: xx + 15, y: yy, class: 'ql-tick-label' });
        tx.textContent = g.length > 16 ? g.slice(0, 15) + '…' : g;
        legG.appendChild(tx);
      });
      legG.setAttribute('transform', 'translate(' + m.l + ',' + (H - 22) + ')');
      svg.appendChild(legG);
    }

    editor = attachChartEditor({
      key: 'betaConstrained', svg, mount: chartPanel, filename: rdaMethod + '-biplot', lang: getLang(), startEditing: wasEditing,
      elements: [
        { id: 'title', create: { text: t('beta.rdaFigTitle', { method: mName }), x: W / 2, y: 24, anchor: 'middle', cls: 'ce-title' } },
        { id: 'xtitle', selector: '[data-ce="xtitle"]' },
        { id: 'ytitle', selector: '[data-ce="ytitle"]' },
        { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
      ],
      paletteSeries: colorGroups.map((g, i) => ({ id: 's' + i, label: g })),
      paletteType: 'categorical', paletteMax: CATEGORICAL_SCATTER_MAX,
      figureOptions: { axis: { domain: autoY }, axisX: { domain: autoX } },
      onFigureOptionsChange: () => paint(),
      onReset: () => paint(),
    });

    // ---- resumen + tablas ----
    const summary = document.createElement('section');
    summary.className = 'ql-card ql-panel';
    summary.style.marginTop = '20px';
    summary.innerHTML = '<h2>' + t('beta.rdaScreeTitle') + '</h2><p class="ql-panel-note">' +
      t('beta.rdaScree', {
        method: mName, n: res.nAxes,
        pct: (res.proportionExplained.slice(0, 2).reduce((a, b) => a + b, 0) * 100).toFixed(1),
        pctC: (res.proportionConstrained * 100).toFixed(1),
      }) + '</p>' +
      methodNoticeHtml(rdaMethod) +
      glossaryLinkHtml(rdaMethod);
    container.appendChild(summary);

    const varTable = document.createElement('section');
    varTable.className = 'ql-card ql-panel';
    varTable.style.marginTop = '20px';
    varTable.innerHTML = '<h2>' + t('beta.rdaVarTableTitle') + '</h2>';
    const vScroll = document.createElement('div'); vScroll.className = 'ql-table-scroll';
    const vTbl = document.createElement('table'); vTbl.className = 'ql-table';
    let vHead = '<thead><tr><th>' + t('beta.rdaColVar') + '</th>';
    for (let k = 0; k < res.nAxes; k++) vHead += '<th>' + mName + (k + 1) + '</th>';
    vTbl.innerHTML = vHead + '</tr></thead>';
    const vBody = document.createElement('tbody');
    varNames.forEach((name, j) => {
      const tr = document.createElement('tr');
      let c = '<td>' + escapeHtml(name) + '</td>';
      for (let k = 0; k < res.nAxes; k++) c += '<td class="ql-num tabular">' + res.biplotScores[j][k].toFixed(3) + '</td>';
      tr.innerHTML = c; vBody.appendChild(tr);
    });
    vTbl.appendChild(vBody); vScroll.appendChild(vTbl); varTable.appendChild(vScroll);
    container.appendChild(varTable);

    const siteTable = document.createElement('section');
    siteTable.className = 'ql-card ql-panel';
    siteTable.style.marginTop = '20px';
    siteTable.innerHTML = '<h2>' + t('beta.rdaTableTitle') + '</h2>';
    const sScroll = document.createElement('div'); sScroll.className = 'ql-table-scroll scroll-x';
    const sTbl = document.createElement('table'); sTbl.className = 'ql-table';
    let sHead = '<thead><tr><th>' + t('beta.colSample') + '</th>';
    if (colorGroups.length) sHead += '<th>' + escapeHtml(rdaColorCol) + '</th>';
    for (let k = 0; k < res.nAxes; k++) sHead += '<th>' + mName + (k + 1) + '</th>';
    sTbl.innerHTML = sHead + '</tr></thead>';
    const sBody = document.createElement('tbody');
    validSamples.forEach((sid, i) => {
      const tr = document.createElement('tr');
      let c = '<td>' + escapeHtml(sid) + '</td>';
      if (colorGroups.length) c += '<td>' + escapeHtml((resolveColor && resolveColor(sid)) || '—') + '</td>';
      for (let k = 0; k < res.nAxes; k++) c += '<td class="ql-num tabular">' + res.siteScores[i][k].toFixed(4) + '</td>';
      tr.innerHTML = c; sBody.appendChild(tr);
    });
    sTbl.appendChild(sBody); sScroll.appendChild(sTbl); siteTable.appendChild(sScroll);
    container.appendChild(siteTable);
  }

  // =========================================================================
  //  MAPA DE CALOR + DENDROGRAMA
  // =========================================================================
  function renderHeatmap() {
    const metrics = Object.keys(state.betaDiversity.metrics);
    if (!metric || !metrics.includes(metric)) metric = metrics[0];
    const data = state.betaDiversity.metrics[metric];

    const grid = document.createElement('div');
    grid.className = 'ql-grid-2';

    const chartPanel = document.createElement('section');
    chartPanel.className = 'ql-card ql-panel';
    chartPanel.innerHTML = '<p class="ql-panel-note" style="margin-bottom:4px;">' + t('beta.chartNote') + '</p>';
    const chartWrap = document.createElement('div');
    chartWrap.className = 'ql-chartwrap scroll-x';
    const svg = svgEl('svg', { class: 'ql-svg', role: 'img', 'aria-label': t('a11y.chartHeatmapBeta') });
    const tooltip = document.createElement('div');
    tooltip.className = 'ql-tooltip';
    chartWrap.appendChild(svg);
    chartWrap.appendChild(tooltip);
    chartPanel.appendChild(chartWrap);
    grid.appendChild(chartPanel);

    const controls = document.createElement('aside');
    controls.className = 'ql-card ql-panel';
    controls.innerHTML = '<h2>' + t('ui.controls') + '</h2>';
    if (metrics.length > 1) {
      const f = document.createElement('div');
      f.className = 'ql-field';
      f.innerHTML = '<label>' + t('beta.metricLabel') + '</label>';
      const sel = document.createElement('select');
      metrics.forEach((m) => {
        const o = document.createElement('option'); o.value = m; o.textContent = m;
        if (m === metric) o.selected = true; sel.appendChild(o);
      });
      sel.addEventListener('change', () => { metric = sel.value; paint(); });
      f.appendChild(sel);
      controls.appendChild(f);
    }
    const betaEx = metricExplainEl(metric);
    if (betaEx) controls.appendChild(betaEx);

    const fOrder = document.createElement('div');
    fOrder.className = 'ql-field';
    fOrder.innerHTML = '<label>' + t('beta.orderLabel') + '</label>';
    const selOrder = document.createElement('select');
    [['clustering', t('beta.orderClustering')], ['original', t('beta.orderOriginal')]].forEach(([v, lbl]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = lbl;
      if (v === orderMode) o.selected = true; selOrder.appendChild(o);
    });
    selOrder.addEventListener('change', () => { orderMode = selOrder.value; paint(); });
    fOrder.appendChild(selOrder);
    controls.appendChild(fOrder);

    const statsBox = document.createElement('div');
    statsBox.innerHTML = '<div class="ql-stats">' +
      '<div class="ql-stat"><div class="ql-stat-label">' + t('beta.statSamples') + '</div><div class="ql-stat-value" style="font-size:20px;">' + data.sampleIds.length + '</div></div></div>';
    controls.appendChild(statsBox);

    const privacy = document.createElement('p');
    privacy.className = 'ql-privacy';
    privacy.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5l-8-3Z"/></svg>' + t('beta.upgmaLocal');
    controls.appendChild(privacy);

    grid.appendChild(controls);
    container.appendChild(grid);

    const tableCard = document.createElement('section');
    tableCard.className = 'ql-card ql-panel';
    tableCard.style.marginTop = '20px';
    tableCard.innerHTML = '<h2>' + t('beta.tableTitle') + '</h2><p class="ql-panel-note">' + t('beta.tableNote') + '</p>';
    container.appendChild(tableCard);

    // ---- orden (UPGMA: en el hilo principal si es pequeño, en un Web Worker
    //      si la matriz es grande — O(n³), ~170 ms a 520 muestras) ----
    const wantClustering = orderMode === 'clustering' && data.sampleIds.length > 1;
    const ck = metric + '|' + data.sourceFileId + '|' + data.sampleIds.length;
    let tree = null, order = null;
    if (!wantClustering) {
      order = data.sampleIds.slice();
    } else if (heatCache && heatCache.key === ck) {
      tree = heatCache.tree; order = heatCache.order;
    } else if (data.sampleIds.length < 180) {
      tree = upgma(data.matrix, data.sampleIds);
      order = leafOrder(tree);
      heatCache = { key: ck, tree, order };
    } else {
      const wait = document.createElement('p');
      wait.className = 'ql-panel-note';
      wait.textContent = t('beta.clusteringWait');
      chartWrap.appendChild(wait);
      const gen = ++clusterGen;
      upgmaOrderAsync(data.matrix, data.sampleIds).then((res) => {
        if (gen !== clusterGen) return; // el usuario cambió de métrica / de ruta
        heatCache = { key: ck, tree: res.tree, order: res.order };
        paint();
      });
      return;
    }
    const clustered = !!tree;
    const idxOf = {};
    data.sampleIds.forEach((id, i) => { idxOf[id] = i; });

    // ---- layout ----
    const n = order.length;
    const cellSize = Math.max(10, Math.min(28, 640 / n));
    const dendroH = clustered ? 62 : 0;
    const marginL = 120, marginR = 20, marginT = 46 + dendroH, marginB = 64;
    const gridSize = cellSize * n;
    const W = Math.max(marginL + gridSize + marginR, 420);
    const H = marginT + gridSize + marginB;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.style.width = W + 'px';
    svg.style.maxWidth = 'none';
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const defs = svgEl('defs', {});
    svg.appendChild(defs);

    function xOf(label) { return marginL + order.indexOf(label) * cellSize + cellSize / 2; }
    if (clustered) {
      const dendroTop = marginT - dendroH + 6, dendroBottom = marginT - 6;
      const maxHeight = tree.height || 1e-9;
      drawDendrogram(tree, svg, xOf, (h) => dendroBottom - (h / maxHeight) * (dendroBottom - dendroTop));
    }

    let maxDist = 1e-9;
    for (let r = 0; r < data.matrix.length; r++) {
      const row = data.matrix[r];
      for (let c = 0; c < row.length; c++) {
        const v = row[c];
        if (v > maxDist) maxDist = v;
      }
    }

    // escala de color continua compartida (Paso 2-3 de qiimelab-prompt-
    // editor-fase-3-heatmaps-escalas-continuas.md) — sustituye al
    // color-mix() por celda: resuelve directo a #rrggbb, interpolando en
    // OKLab (js/lib/colorScale.js), y expone min/max/paleta/nº de pasos/
    // invertir desde el panel "Escala de color" del editor.
    const csOv = getColorScaleOptions('betaDiversity');
    const csDomain = [
      csOv.domainMin != null ? csOv.domainMin : 0,
      csOv.domainMax != null ? csOv.domainMax : maxDist,
    ];
    const colorScale = makeColorScale({
      type: 'sequential', domain: csDomain,
      range: paletteColorsOf(csOv.paletteId || 'app:sequential'),
      steps: csOv.steps, invert: csOv.invert,
    });

    // controles de celda (Paso 4): "valor en celda" — beta no dibujaba
    // ningún número antes de la Fase 3, se ofrece como opción (por defecto
    // apagada, ver defaultShowValue en attachChartEditor más abajo).
    // "Borde de celda" — inexistente hasta ahora en las 3 vistas.
    const showValue = csOv.showValue === true;
    const cellBorder = csOv.cellBorder || null;
    order.forEach((rowId, ri) => {
      order.forEach((colId, ci) => {
        const v = data.matrix[idxOf[rowId]][idxOf[colId]];
        const x = marginL + ci * cellSize, y = marginT + ri * cellSize;
        const rect = svgEl('rect', {
          x, y, width: cellSize - 1, height: cellSize - 1, 'data-ce-role': 'cell',
          fill: colorScale.scale(v) || 'var(--surface)',
          ...(cellBorder ? { stroke: cellBorder.color, 'stroke-width': cellBorder.width } : {}),
          'data-ri': ri, 'data-ci': ci,
        });
        svg.appendChild(rect);
        if (showValue && cellSize >= 12) {
          // mismo criterio de contraste que correlogram.js/
          // differentialAbundance.js: texto claro sobre el extremo "fuerte"
          // de la rampa (aquí, más lejos/distinto), oscuro sobre el resto —
          // heurística por magnitud, no por luminancia real del color ya
          // pintado (ídem en los otros 2 módulos).
          const span = colorScale.domain[1] - colorScale.domain[0];
          const frac = span === 0 ? 0 : Math.abs((v - colorScale.domain[0]) / span);
          const strong = frac > 0.55;
          const tx = svgEl('text', {
            x: x + (cellSize - 1) / 2, y: y + (cellSize - 1) / 2 + 3.5, class: 'ql-cell-value',
            'text-anchor': 'middle', 'font-size': Math.min(11, cellSize * 0.4),
            fill: strong ? 'var(--surface)' : 'var(--ink)', 'font-family': 'var(--font-mono)', 'pointer-events': 'none',
          });
          tx.textContent = v.toFixed(2);
          svg.appendChild(tx);
        }
      });
    });
    delegateHover(svg, 'rect[data-ri]', {
      onEnter: (el) => {
        const ri = +el.dataset.ri, ci = +el.dataset.ci;
        const rowId = order[ri], colId = order[ci];
        const v = data.matrix[idxOf[rowId]][idxOf[colId]];
        const cx = marginL + ci * cellSize + cellSize / 2, cy = marginT + ri * cellSize + cellSize / 2;
        showTooltip(chartWrap, cx, cy, escapeHtml(rowId) + ' — ' + escapeHtml(colId),
          t('beta.ttDistance') + ': ' + v.toFixed(4),
          { svg, W, H, tooltip, rawHtml: true });
      },
      onLeave: () => hideTooltip(tooltip),
    });

    const showEvery = n > 30 ? Math.ceil(n / 30) : 1;
    order.forEach((id, i) => {
      if (i % showEvery !== 0) return;
      const tx = svgEl('text', { x: marginL - 8, y: marginT + i * cellSize + cellSize / 2 + 3, class: 'ql-tick-label', 'text-anchor': 'end' });
      tx.textContent = id;
      svg.appendChild(tx);
    });

    const yTitle = svgEl('text', {
      x: 15, y: marginT + gridSize / 2, class: 'ql-axis-label', 'text-anchor': 'middle',
      transform: 'rotate(-90 15 ' + (marginT + gridSize / 2) + ')', 'data-ce': 'ytitle',
    });
    yTitle.textContent = t('beta.axisSamples');
    svg.appendChild(yTitle);

    // título del eje X (las columnas son las mismas muestras que las filas)
    const xTitleHm = svgEl('text', {
      x: marginL + gridSize / 2, y: marginT + gridSize + 14, class: 'ql-axis-label', 'text-anchor': 'middle', 'data-ce': 'xtitle',
    });
    xTitleHm.textContent = t('beta.axisSamples');
    svg.appendChild(xTitleHm);

    const legendGradId = 'ql-cscale-betaDiversity';
    const legGrad = svgEl('linearGradient', { id: legendGradId, x1: '0', y1: '0', x2: '1', y2: '0' });
    colorScale.legendStops.forEach((st) => {
      legGrad.appendChild(svgEl('stop', { offset: st.offset + '%', 'stop-color': st.color }));
    });
    defs.appendChild(legGrad);

    const legG = svgEl('g', { 'data-ce': 'legend' });
    // mínimo 215px: por debajo de eso las 2 etiquetas ("0.000 · similar" /
    // "1.000 · distinta", ~100-106px cada una) se solapan en el centro de
    // la barra — el cap de 160px de antes garantizaba justo esa colisión
    // con datasets pequeños/medianos (gridSize*0.6 < 215 es el caso común).
    // W ya reserva sitio de sobra para esto (floor de 420px, ver más abajo
    // en el cálculo de W de esta misma vista).
    const barW = Math.max(215, Math.min(240, gridSize * 0.6));
    legG.appendChild(svgEl('rect', { x: 0, y: 0, width: barW, height: 11, rx: 2, fill: 'url(#' + legendGradId + ')', stroke: 'var(--baseline)' }));
    const l0 = svgEl('text', { x: 0, y: 26, class: 'ql-tick-label' }); l0.textContent = csDomain[0].toFixed(3) + ' · ' + t('beta.legendSimilar');
    const l1 = svgEl('text', { x: barW, y: 26, class: 'ql-tick-label', 'text-anchor': 'end' }); l1.textContent = csDomain[1].toFixed(3) + ' · ' + t('beta.legendDistinct');
    legG.appendChild(l0); legG.appendChild(l1);
    legG.setAttribute('transform', 'translate(' + marginL + ',' + (marginT + gridSize + 22) + ')');
    svg.appendChild(legG);

    // Paso 5 de qiimelab-prompt-editor-fase-3-heatmaps-escalas-continuas.md
    // (rendimiento): con un dataset grande (100+ muestras → miles de
    // celdas) un `paint()` completo también reconstruye el dendrograma, los
    // controles Y la tabla de distancias N×N (esta última es, medido, el
    // coste dominante — más que las <rect> del propio mapa de calor) — un
    // simple cambio de paleta/dominio/pasos no necesita nada de eso.
    // `recolorCells()` actualiza en el sitio solo lo que SÍ depende de la
    // escala de color (fill/stroke de cada <rect>, el texto de valor y la
    // leyenda), sin tocar el resto del DOM. Medido con 200×200 celdas
    // sintéticas (tests/colorscaleperf.mjs): ~250 ms con `paint()` completo
    // → recolorear en el sitio evita la reconstrucción de la tabla y del
    // dendrograma, el coste que de verdad escalaba con N².
    function recolorCells() {
      const csOv2 = getColorScaleOptions('betaDiversity');
      const csDomain2 = [
        csOv2.domainMin != null ? csOv2.domainMin : 0,
        csOv2.domainMax != null ? csOv2.domainMax : maxDist,
      ];
      const scale2 = makeColorScale({
        type: 'sequential', domain: csDomain2,
        range: paletteColorsOf(csOv2.paletteId || 'app:sequential'),
        steps: csOv2.steps, invert: csOv2.invert,
      });
      const showValue2 = csOv2.showValue === true;
      const cellBorder2 = csOv2.cellBorder || null;

      svg.querySelectorAll('text.ql-cell-value').forEach((el) => el.remove());
      svg.querySelectorAll('rect[data-ri]').forEach((rect) => {
        const ri = +rect.dataset.ri, ci = +rect.dataset.ci;
        const rowId = order[ri], colId = order[ci];
        const v = data.matrix[idxOf[rowId]][idxOf[colId]];
        rect.setAttribute('fill', scale2.scale(v) || 'var(--surface)');
        if (cellBorder2) { rect.setAttribute('stroke', cellBorder2.color); rect.setAttribute('stroke-width', cellBorder2.width); }
        else { rect.removeAttribute('stroke'); rect.removeAttribute('stroke-width'); }
        if (showValue2 && cellSize >= 12) {
          const x = marginL + ci * cellSize, y = marginT + ri * cellSize;
          const span2 = scale2.domain[1] - scale2.domain[0];
          const frac2 = span2 === 0 ? 0 : Math.abs((v - scale2.domain[0]) / span2);
          const strong2 = frac2 > 0.55;
          const tx = svgEl('text', {
            x: x + (cellSize - 1) / 2, y: y + (cellSize - 1) / 2 + 3.5, class: 'ql-cell-value',
            'text-anchor': 'middle', 'font-size': Math.min(11, cellSize * 0.4),
            fill: strong2 ? 'var(--surface)' : 'var(--ink)', 'font-family': 'var(--font-mono)', 'pointer-events': 'none',
          });
          tx.textContent = v.toFixed(2);
          rect.insertAdjacentElement('afterend', tx);
        }
      });

      const legGradEl = svg.querySelector('#' + CSS.escape(legendGradId));
      if (legGradEl) {
        while (legGradEl.firstChild) legGradEl.removeChild(legGradEl.firstChild);
        scale2.legendStops.forEach((st) => legGradEl.appendChild(svgEl('stop', { offset: st.offset + '%', 'stop-color': st.color })));
      }
      const legTexts = legG.querySelectorAll('text');
      if (legTexts[0]) legTexts[0].textContent = scale2.domain[0].toFixed(3) + ' · ' + t('beta.legendSimilar');
      if (legTexts[1]) legTexts[1].textContent = scale2.domain[1].toFixed(3) + ' · ' + t('beta.legendDistinct');
    }

    editor = attachChartEditor({
      key: 'betaDiversity', svg, mount: chartPanel, filename: t('beta.title') + '-' + metric, lang: getLang(), startEditing: wasEditing,
      elements: [
        { id: 'title', create: { text: metric, x: W / 2, y: 22, anchor: 'middle', cls: 'ce-title' } },
        { id: 'xtitle', selector: '[data-ce="xtitle"]' },
        { id: 'ytitle', selector: '[data-ce="ytitle"]' },
        { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
      ],
      colorScale: { type: 'sequential', domain: [0, maxDist], defaultShowValue: false },
      onReset: () => paint(),
      onColorScaleChange: () => recolorCells(),
    });

    const scrollDiv = document.createElement('div');
    scrollDiv.className = 'ql-table-scroll scroll-x';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table';
    let theadHtml = '<thead><tr><th><button type="button">' + t('beta.colSample') + '</button></th>';
    order.forEach((id) => { theadHtml += '<th><button type="button">' + escapeHtml(id) + '</button></th>'; });
    tbl.innerHTML = theadHtml + '</tr></thead>';
    const tbody = document.createElement('tbody');
    order.forEach((rowId) => {
      const tr = document.createElement('tr');
      let cells = '<td>' + escapeHtml(rowId) + '</td>';
      order.forEach((colId) => { cells += '<td class="ql-num tabular">' + data.matrix[idxOf[rowId]][idxOf[colId]].toFixed(3) + '</td>'; });
      tr.innerHTML = cells;
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    scrollDiv.appendChild(tbl);
    tableCard.appendChild(scrollDiv);
  }

  // =========================================================================
  //  PCoA (coordenadas ya calculadas — ordination.txt de scikit-bio)
  // =========================================================================
  function renderPcoa(hasPcoa) {
    if (!hasPcoa) {
      const card = document.createElement('div');
      card.className = 'ql-card ql-panel';
      card.style.marginTop = '18px';
      card.innerHTML = '<div class="ql-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="6" cy="14" r="2.2"/><circle cx="15" cy="7" r="2.2"/><circle cx="18" cy="16" r="2.2"/><circle cx="9" cy="18" r="2.2"/></svg>' +
        '<h3>' + t('beta.pcoaEmptyTitle') + '</h3><p>' + t('beta.pcoaEmptyDesc') + '</p></div>';
      container.appendChild(card);
      mountExampleButtons(card.querySelector('.ql-empty'), { real: loadRealCommunityData, realLabel: t('beta.pcoaLoadExample'), download: ['pcoa', 'metadata'] });
      return;
    }

    const ord = state.ordination;
    const nAxes = ord.coords[0].length;
    const maxPC = Math.min(5, nAxes);
    if (pcX >= maxPC) pcX = 0;
    if (pcY >= maxPC || pcY === pcX) pcY = pcX === 1 ? 0 : 1;

    const groupOptions = state.metadata ? state.metadata.headers.filter((h) => h !== state.metadata.sampleIdKey) : [];
    if (state.metadata && (!pcoaGroupCol || !groupOptions.includes(pcoaGroupCol))) pcoaGroupCol = groupOptions[0] || null;
    const resolve = (state.metadata && pcoaGroupCol) ? makeGroupResolver(state.metadata, pcoaGroupCol) : null;

    const groupOf = {};
    ord.sampleIds.forEach((s) => { groupOf[s] = resolve ? resolve(s) : null; });
    const groups = Array.from(new Set(Object.values(groupOf).filter(Boolean))).sort();
    const colorForGroup = (g) => g == null ? 'var(--depleted)' : 'var(' + CAT_VARS[groups.indexOf(g) % CAT_VARS.length] + ')';

    const grid = document.createElement('div');
    grid.className = 'ql-grid-2';

    const chartPanel = document.createElement('section');
    chartPanel.className = 'ql-card ql-panel';
    chartPanel.innerHTML = '<p class="ql-panel-note" style="margin-bottom:4px;">' + t('beta.pcoaNote') + '</p>';
    const chartWrap = document.createElement('div');
    chartWrap.className = 'ql-chartwrap';
    const svg = svgEl('svg', { class: 'ql-svg', role: 'img', 'aria-label': 'PCoA' });
    const tooltip = document.createElement('div');
    tooltip.className = 'ql-tooltip';
    chartWrap.appendChild(svg); chartWrap.appendChild(tooltip);
    chartPanel.appendChild(chartWrap);
    grid.appendChild(chartPanel);

    const controls = document.createElement('aside');
    controls.className = 'ql-card ql-panel';
    controls.innerHTML = '<h2>' + t('ui.controls') + '</h2>';
    const pcoaEx = metricExplainEl(ord.metricName);
    if (pcoaEx) controls.appendChild(pcoaEx);
    const mkPCsel = (label, cur, cb) => {
      const f = document.createElement('div'); f.className = 'ql-field';
      f.innerHTML = '<label>' + label + '</label>';
      const sel = document.createElement('select');
      for (let i = 0; i < maxPC; i++) {
        const o = document.createElement('option'); o.value = String(i);
        o.textContent = t('beta.pcAxis', { n: i + 1, pct: (ord.proportionExplained[i] || 0).toFixed(1) });
        if (i === cur) o.selected = true; sel.appendChild(o);
      }
      sel.addEventListener('change', () => { cb(parseInt(sel.value, 10)); paint(); });
      f.appendChild(sel); controls.appendChild(f);
    };
    if (pcoaPlotStyle !== '3d') {
      mkPCsel(t('beta.axisX'), pcX, (v) => { pcX = v; });
      mkPCsel(t('beta.axisY'), pcY, (v) => { pcY = v; });
    }

    if (groupOptions.length) {
      const f = document.createElement('div'); f.className = 'ql-field';
      f.innerHTML = '<label>' + t('beta.colorBy') + '</label>';
      const sel = document.createElement('select');
      groupOptions.forEach((h) => {
        const o = document.createElement('option'); o.value = h; o.textContent = h;
        if (h === pcoaGroupCol) o.selected = true; sel.appendChild(o);
      });
      sel.addEventListener('change', () => { pcoaGroupCol = sel.value; paint(); });
      f.appendChild(sel); controls.appendChild(f);
    } else {
      const p = document.createElement('p'); p.className = 'ql-field-help'; p.textContent = t('beta.noMeta');
      controls.appendChild(p);
    }

    const numericCols = numericMetaColumns(groupOptions);
    let sizeVals = null; // Map<sampleId (metadata), number> — solo si plotStyle === 'bubbles'
    let sizeMin = 0, sizeMax = 1;
    // '3d' necesita ≥3 ejes en el ordination.txt, no metadatos numéricos —
    // por eso vive fuera del "if (numericCols.length > 0)" que gobierna burbujas
    if (pcoaPlotStyle === 'bubbles' && numericCols.length === 0) pcoaPlotStyle = 'scatter';
    if (pcoaPlotStyle === '3d' && maxPC < 3) pcoaPlotStyle = 'scatter';
    const styleOptions = [{ value: 'scatter', labelKey: 'beta.pcoaPlotStyleScatter' }];
    if (numericCols.length > 0) styleOptions.push({ value: 'bubbles', labelKey: 'beta.pcoaPlotStyleBubbles' });
    if (maxPC >= 3) styleOptions.push({ value: '3d', labelKey: 'beta.pcoaPlotStyle3d' });
    if (styleOptions.length > 1) {
      controls.appendChild(chartTypeField({
        labelKey: 'beta.pcoaPlotStyleLabel',
        options: styleOptions,
        active: pcoaPlotStyle,
        onChange: (v) => { pcoaPlotStyle = v; paint(); },
      }));
    }
    if (pcoaPlotStyle === 'scatter' && groups.length > 0) {
      const ellField = document.createElement('div'); ellField.className = 'ql-field';
      const ellRow = document.createElement('label'); ellRow.className = 'ql-checkrow';
      const ellCb = document.createElement('input');
      ellCb.type = 'checkbox'; ellCb.checked = pcoaShowEllipses;
      ellCb.addEventListener('change', () => { pcoaShowEllipses = ellCb.checked; paint(); });
      ellRow.appendChild(ellCb);
      ellRow.appendChild(document.createTextNode(' ' + t('beta.pcoaEllipsesLabel')));
      ellField.appendChild(ellRow);
      ellField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('beta.pcoaEllipsesHelp') + '</p>');
      controls.appendChild(ellField);
    }
    if (numericCols.length > 0 && pcoaPlotStyle === 'bubbles') {
      if (!pcoaSizeCol || !numericCols.includes(pcoaSizeCol)) pcoaSizeCol = numericCols[0];
      const sizeField = document.createElement('div'); sizeField.className = 'ql-field';
      sizeField.innerHTML = '<label>' + t('beta.pcoaSizeLabel') + '</label>';
      const sizeSel = document.createElement('select');
      numericCols.forEach((h) => {
        const o = document.createElement('option'); o.value = h; o.textContent = h;
        if (h === pcoaSizeCol) o.selected = true; sizeSel.appendChild(o);
      });
      sizeSel.addEventListener('change', () => { pcoaSizeCol = sizeSel.value; paint(); });
      sizeField.appendChild(sizeSel);
      controls.appendChild(sizeField);

      const sizeResolver = makeGroupResolver(state.metadata, pcoaSizeCol);
      sizeVals = new Map();
      ord.sampleIds.forEach((sid) => {
        const raw = sizeResolver(sid);
        if (raw != null && NUM_RE.test(String(raw).trim())) sizeVals.set(sid, parseFloat(raw));
      });
      const vals = Array.from(sizeVals.values());
      if (vals.length > 0) {
        sizeMin = Math.min(...vals); sizeMax = Math.max(...vals);
        const help = document.createElement('p'); help.className = 'ql-field-help';
        help.textContent = t('beta.pcoaSizeHelp', { col: pcoaSizeCol, min: sizeMin.toFixed(2), max: sizeMax.toFixed(2) });
        controls.appendChild(help);
      }
    }
    if (pcoaPlotStyle === '3d') {
      const help3d = document.createElement('p'); help3d.className = 'ql-field-help';
      help3d.textContent = t('beta.pcoa3dHelp');
      controls.appendChild(help3d);
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button'; resetBtn.className = 'ql-btn ql-btn-ghost'; resetBtn.style.marginTop = '4px';
      resetBtn.textContent = t('beta.pcoa3dResetView');
      resetBtn.addEventListener('click', () => { rot3dX = -0.4; rot3dY = 0.6; paint(); });
      controls.appendChild(resetBtn);
    }

    const cum3 = ord.proportionExplained.slice(0, 3).reduce((a, b) => a + b, 0);
    const sb = document.createElement('div');
    sb.style.marginTop = '10px';
    sb.innerHTML = '<p class="ql-field-help">' + t('beta.pcoaScree', { n: 3, pct: cum3.toFixed(1) }) + '</p>';
    controls.appendChild(sb);

    grid.appendChild(controls);
    container.appendChild(grid);

    // ---- dibujar scatter ----
    if (pcoaPlotStyle === '3d' && maxPC >= 3) {
      drawScatter3D();
    } else {
      drawScatter2D();
    }

    function drawScatter2D() {
    const W = 660, H = 520;
    const m = { t: 46, r: 20, b: 78, l: 62 };
    const innerW = W - m.l - m.r, innerH = H - m.t - m.b;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    const xs = ord.coords.map((c) => c[pcX]);
    const ys = ord.coords.map((c) => c[pcY]);
    const xr = [Math.min(...xs), Math.max(...xs)], yr = [Math.min(...ys), Math.max(...ys)];
    const padX = (xr[1] - xr[0]) * 0.08 || 0.1, padY = (yr[1] - yr[0]) * 0.08 || 0.1;
    const autoX = [xr[0] - padX, xr[1] + padX], autoY = [yr[0] - padY, yr[1] + padY];
    const so = getFigureOptions((pcoaPlotStyle === 'bubbles' && sizeVals) ? 'betaPcoaBubbles' : 'betaPcoa');
    const xMin = so.axisXMin != null ? so.axisXMin : autoX[0], xMax = so.axisXMax != null ? so.axisXMax : autoX[1];
    const yMin = so.axisMin != null ? so.axisMin : autoY[0], yMax = so.axisMax != null ? so.axisMax : autoY[1];
    const sx = (v) => m.l + ((v - xMin) / (xMax - xMin)) * innerW;
    const sy = (v) => m.t + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
    const clip = plotClip(svg, 'ql-clip-pcoa', m.l, m.t, innerW, innerH);

    for (let k = 0; k <= 4; k++) {
      const gx = m.l + (k / 4) * innerW, gy = m.t + (k / 4) * innerH;
      svg.appendChild(svgEl('line', { x1: gx, x2: gx, y1: m.t, y2: m.t + innerH, class: 'ql-gridline' }));
      svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + innerW, y1: gy, y2: gy, class: 'ql-gridline' }));
    }
    // ejes 0 (si caen dentro)
    if (xMin < 0 && xMax > 0) svg.appendChild(svgEl('line', { x1: sx(0), x2: sx(0), y1: m.t, y2: m.t + innerH, class: 'ql-baseline-line' }));
    if (yMin < 0 && yMax > 0) svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + innerW, y1: sy(0), y2: sy(0), class: 'ql-baseline-line' }));
    svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + innerW, y1: m.t + innerH, y2: m.t + innerH, class: 'ql-baseline-line' }));
    svg.appendChild(svgEl('line', { x1: m.l, x2: m.l, y1: m.t, y2: m.t + innerH, class: 'ql-baseline-line' }));

    // ticks
    [xMin, (xMin + xMax) / 2, xMax].forEach((v) => {
      const tx = svgEl('text', { x: sx(v), y: m.t + innerH + 16, class: 'ql-tick-label', 'text-anchor': 'middle' });
      tx.textContent = v.toFixed(2); svg.appendChild(tx);
    });
    [yMin, (yMin + yMax) / 2, yMax].forEach((v) => {
      const tx = svgEl('text', { x: m.l - 8, y: sy(v) + 3, class: 'ql-tick-label', 'text-anchor': 'end' });
      tx.textContent = v.toFixed(2); svg.appendChild(tx);
    });

    const isBubbles = pcoaPlotStyle === 'bubbles' && sizeVals;
    const sizeSpan = sizeMax - sizeMin || 1;
    const radiusFor = (sid) => {
      if (!isBubbles) return 5;
      if (!sizeVals.has(sid)) return 4; // sin dato para esa variable: punto neutro, algo más pequeño
      const frac = (sizeVals.get(sid) - sizeMin) / sizeSpan;
      return 4 + Math.sqrt(Math.max(0, frac)) * 12; // 4–16px, escala de área
    };

    // elipses de confianza al 95% por grupo (prompt "quick wins" del 22 sep
    // 2026, punto 3) -- equivalente a vegan::ordiellipse/ggplot2::
    // stat_ellipse(type="norm"), js/lib/stats.js:confidenceEllipsePoints.
    // Se dibujan ANTES que los puntos para que queden debajo (capa de
    // fondo), y se calculan en espacio de DATOS (no de píxeles: sx/sy
    // pueden tener escalas X/Y distintas) y solo se transforman a píxeles
    // al construir el polígono.
    let ellipsesOmitted = [];
    if (pcoaShowEllipses && groups.length > 0) {
      const ellG = svgEl('g', { 'data-ce': 'ellipses', 'clip-path': clip });
      groups.forEach((g, gi) => {
        const idxs = ord.sampleIds.map((sid, i) => (groupOf[sid] === g ? i : -1)).filter((i) => i >= 0);
        const xs = idxs.map((i) => ord.coords[i][pcX]), ys = idxs.map((i) => ord.coords[i][pcY]);
        const ell = confidenceEllipsePoints(xs, ys, 0.95, 72);
        if (!ell) { ellipsesOmitted.push(g); return; }
        const ptsAttr = ell.points.map(([dx, dy]) => sx(dx) + ',' + sy(dy)).join(' ');
        ellG.appendChild(svgEl('polygon', {
          points: ptsAttr, fill: colorForGroup(g), 'fill-opacity': 0.12, stroke: colorForGroup(g), 'stroke-width': 1.5, 'stroke-opacity': 0.7,
          'data-ce-series-fill': 's' + gi, 'data-ce-series-stroke': 's' + gi,
        }));
      });
      svg.appendChild(ellG);
    }

    const pts = svgEl('g', { 'clip-path': clip });
    svg.appendChild(pts);
    ord.sampleIds.forEach((sid, i) => {
      const cx = sx(ord.coords[i][pcX]), cy = sy(ord.coords[i][pcY]);
      const g = groupOf[sid];
      const c = svgEl('circle', {
        cx, cy, r: radiusFor(sid), fill: colorForGroup(g), 'fill-opacity': 0.78, stroke: 'var(--surface)', 'stroke-width': 1.4,
        'data-i': i, 'data-ce-role': 'marker',
        ...(g != null ? { 'data-ce-series-fill': 's' + groups.indexOf(g) } : {}),
      });
      pts.appendChild(c);
    });
    delegateHover(svg, 'circle[data-i]', {
      onEnter: (el) => {
        const i = +el.dataset.i;
        const sid = ord.sampleIds[i];
        const g = groupOf[sid];
        const cx = sx(ord.coords[i][pcX]), cy = sy(ord.coords[i][pcY]);
        const sizeLine = isBubbles ? ('<br>' + escapeHtml(pcoaSizeCol) + ': ' + (sizeVals.has(sid) ? sizeVals.get(sid).toFixed(2) : t('beta.pcoaSizeMissing'))) : '';
        showTooltip(chartWrap, cx, cy, escapeHtml(sid) + (g ? ' · ' + escapeHtml(g) : ''),
          'PCo' + (pcX + 1) + ' ' + ord.coords[i][pcX].toFixed(3) + ' · PCo' + (pcY + 1) + ' ' + ord.coords[i][pcY].toFixed(3) + sizeLine,
          { svg, W, H, tooltip, rawHtml: true });
      },
      onLeave: () => hideTooltip(tooltip),
    });

    const xTitle = svgEl('text', { x: m.l + innerW / 2, y: H - 40, class: 'ql-axis-label', 'text-anchor': 'middle', 'data-ce': 'xtitle' });
    xTitle.textContent = t('beta.pcAxis', { n: pcX + 1, pct: (ord.proportionExplained[pcX] || 0).toFixed(1) });
    svg.appendChild(xTitle);
    const yTitle = svgEl('text', { x: 16, y: m.t + innerH / 2, class: 'ql-axis-label', 'text-anchor': 'middle', transform: 'rotate(-90 16 ' + (m.t + innerH / 2) + ')', 'data-ce': 'ytitle' });
    yTitle.textContent = t('beta.pcAxis', { n: pcY + 1, pct: (ord.proportionExplained[pcY] || 0).toFixed(1) });
    svg.appendChild(yTitle);

    // leyenda de grupos
    if (groups.length) {
      const legG = svgEl('g', { 'data-ce': 'legend' });
      const perRow = Math.max(1, Math.floor(innerW / 130));
      groups.forEach((g, i) => {
        const col = i % perRow, rw = Math.floor(i / perRow);
        const xx = col * 130, yy = rw * 15;
        legG.appendChild(svgEl('rect', { x: xx, y: yy - 8, width: 10, height: 10, rx: 5, fill: colorForGroup(g), 'data-ce-series-fill': 's' + i }));
        const tx = svgEl('text', { x: xx + 15, y: yy, class: 'ql-tick-label' });
        tx.textContent = g.length > 16 ? g.slice(0, 15) + '…' : g;
        legG.appendChild(tx);
      });
      if (groups.length > CAT_VARS.length) {
        const nt = svgEl('text', { x: 0, y: Math.ceil(groups.length / perRow) * 15 + 4, class: 'ql-tick-label' });
        nt.setAttribute('fill', 'var(--ink-muted)');
        nt.textContent = t('ui.colorsRepeat');
        legG.appendChild(nt);
      }
      legG.setAttribute('transform', 'translate(' + m.l + ',' + (H - 22) + ')');
      svg.appendChild(legG);
    }

    if (pcoaShowEllipses && ellipsesOmitted.length) {
      const om = document.createElement('p');
      om.className = 'ql-field-help';
      om.textContent = t('beta.pcoaEllipsesOmitted', { groups: ellipsesOmitted.join(', ') });
      chartPanel.appendChild(om);
    }

    editor = attachChartEditor({
      key: isBubbles ? 'betaPcoaBubbles' : 'betaPcoa', svg, mount: chartPanel, filename: 'pcoa-' + ord.metricName, lang: getLang(), startEditing: wasEditing,
      elements: [
        { id: 'title', create: { text: t('beta.pcoaFigTitle', { metric: ord.metricName }), x: W / 2, y: 24, anchor: 'middle', cls: 'ce-title' } },
        { id: 'xtitle', selector: '[data-ce="xtitle"]' },
        { id: 'ytitle', selector: '[data-ce="ytitle"]' },
        { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
      ],
      // scatter (PCoA): cualquier punto puede acabar junto a cualquier otro,
      // así que la paleta categórica se limita a CATEGORICAL_SCATTER_MAX tonos.
      paletteSeries: groups.map((g, i) => ({ id: 's' + i, label: g })),
      paletteType: 'categorical', paletteMax: CATEGORICAL_SCATTER_MAX,
      figureOptions: { axis: { domain: autoY }, axisX: { domain: autoX } },
      onFigureOptionsChange: () => paint(),
      onReset: () => paint(),
    });
    }

    // proyección ortográfica manual (yaw + pitch) de los 3 primeros ejes,
    // rotable arrastrando — sin librería, mismo espíritu "a mano" que
    // js/lib/forceLayout.js (red de co-ocurrencia del correlograma)
    function drawScatter3D() {
      const W = 660, H = 520;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      const cx0 = W / 2, cy0 = (H - 60) / 2 + 6; // deja hueco abajo para la leyenda fija

      const raw3 = ord.coords.map((c) => [c[0], c[1], c[2]]);
      const centroid = [0, 1, 2].map((k) => raw3.reduce((s, p) => s + p[k], 0) / raw3.length);
      const centered = raw3.map((p) => p.map((v, k) => v - centroid[k]));
      // escala FIJA (no depende del ángulo): una rotación pura nunca aumenta
      // la norma de un punto, así que ningún punto se sale del radio disponible
      // sea cual sea la orientación actual — evita que el gráfico "respire" al girar
      const maxNorm = Math.max(...centered.map((p) => Math.hypot(p[0], p[1], p[2]))) || 1;
      const axisLen = maxNorm * 1.25;
      const avail = Math.min(W, H - 70) / 2 - 18;
      const scale = avail / axisLen;

      function project(p) {
        const [x, y, z] = p;
        // yaw (eje vertical Y)
        const cy_ = Math.cos(rot3dY), sy_ = Math.sin(rot3dY);
        const x1 = x * cy_ + z * sy_;
        const z1 = -x * sy_ + z * cy_;
        // pitch (eje horizontal X)
        const cx_ = Math.cos(rot3dX), sx_ = Math.sin(rot3dX);
        const y1 = y * cx_ - z1 * sx_;
        const z2 = y * sx_ + z1 * cx_;
        return { x: cx0 + x1 * scale, y: cy0 - y1 * scale, depth: z2 };
      }

      function draw3D() {
        svg.replaceChildren();
        const g = svgEl('g', {});
        svg.appendChild(g);

        // gizmo de ejes PC1/PC2/PC3: del centro a +axisLen, rotan con la nube
        const origin = project([0, 0, 0]);
        [[axisLen, 0, 0], [0, axisLen, 0], [0, 0, axisLen]].forEach((dir, k) => {
          const tip = project(dir);
          g.appendChild(svgEl('line', { x1: origin.x, y1: origin.y, x2: tip.x, y2: tip.y, class: 'ql-baseline-line' }));
          const lab = svgEl('text', { x: tip.x, y: tip.y, class: 'ql-tick-label', 'text-anchor': 'middle' });
          lab.textContent = t('beta.pcAxis', { n: k + 1, pct: (ord.proportionExplained[k] || 0).toFixed(1) });
          g.appendChild(lab);
        });

        // puntos: pintor's algorithm (más lejano primero) + tamaño/opacidad
        // por profundidad para dar sensación de 3D sin sombreado real
        const projected = ord.sampleIds.map((sid, i) => ({ sid, i, ...project(centered[i]) }));
        const depths = projected.map((p) => p.depth);
        const dMin = Math.min(...depths), dMax = Math.max(...depths), dSpan = (dMax - dMin) || 1;
        projected.sort((a, b) => a.depth - b.depth);

        const pts = svgEl('g', {});
        g.appendChild(pts);
        projected.forEach((p) => {
          const frac = (p.depth - dMin) / dSpan; // 0 = más lejos de la cámara, 1 = más cerca
          const gname = groupOf[p.sid];
          const c = svgEl('circle', {
            cx: p.x, cy: p.y, r: (3.6 + frac * 3.2).toFixed(2),
            fill: colorForGroup(gname), 'fill-opacity': (0.5 + frac * 0.4).toFixed(2),
            stroke: 'var(--surface)', 'stroke-width': 1.2, 'data-i': p.i, 'data-ce-role': 'marker',
            ...(gname != null ? { 'data-ce-series-fill': 's' + groups.indexOf(gname) } : {}),
          });
          pts.appendChild(c);
        });

        // leyenda de grupos — posición fija en pantalla, no rota con la nube
        if (groups.length) {
          const legG = svgEl('g', { 'data-ce': 'legend' });
          const perRow = Math.max(1, Math.floor((W - 40) / 130));
          groups.forEach((gn, i) => {
            const col = i % perRow, rw = Math.floor(i / perRow);
            const xx = col * 130, yy = rw * 15;
            legG.appendChild(svgEl('rect', { x: xx, y: yy - 8, width: 10, height: 10, rx: 5, fill: colorForGroup(gn), 'data-ce-series-fill': 's' + i }));
            const tx = svgEl('text', { x: xx + 15, y: yy, class: 'ql-tick-label' });
            tx.textContent = gn.length > 16 ? gn.slice(0, 15) + '…' : gn;
            legG.appendChild(tx);
          });
          legG.setAttribute('transform', 'translate(20,' + (H - 14) + ')');
          svg.appendChild(legG);
        }
        if (editor) editor.sync();
      }
      draw3D();

      delegateHover(svg, 'circle[data-i]', {
        onEnter: (el) => {
          const i = +el.dataset.i;
          const sid = ord.sampleIds[i];
          const gname = groupOf[sid];
          const cx = parseFloat(el.getAttribute('cx')), cy = parseFloat(el.getAttribute('cy'));
          showTooltip(chartWrap, cx, cy, escapeHtml(sid) + (gname ? ' · ' + escapeHtml(gname) : ''),
            'PCo1 ' + ord.coords[i][0].toFixed(3) + ' · PCo2 ' + ord.coords[i][1].toFixed(3) + ' · PCo3 ' + ord.coords[i][2].toFixed(3),
            { svg, W, H, tooltip, rawHtml: true });
        },
        onLeave: () => hideTooltip(tooltip),
      });

      // arrastrar para rotar — matriz de rotación calculada a mano (sin
      // librería), mismos principios de pointer capture que chartEditor.js
      svg.style.cursor = 'grab';
      svg.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const baseX = rot3dX, baseY = rot3dY;
        try { svg.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
        svg.style.cursor = 'grabbing';
        const onMove = (ev) => {
          const dx = ev.clientX - startX, dy = ev.clientY - startY;
          rot3dY = baseY + dx * 0.012;
          rot3dX = Math.max(-1.5, Math.min(1.5, baseX - dy * 0.012));
          draw3D();
        };
        const onUp = (ev) => {
          svg.removeEventListener('pointermove', onMove);
          svg.removeEventListener('pointerup', onUp);
          svg.removeEventListener('pointercancel', onUp);
          try { svg.releasePointerCapture(ev.pointerId); } catch (err) { /* noop */ }
          svg.style.cursor = 'grab';
        };
        svg.addEventListener('pointermove', onMove);
        svg.addEventListener('pointerup', onUp);
        svg.addEventListener('pointercancel', onUp);
      });

      editor = attachChartEditor({
        key: 'betaPcoa3d', svg, mount: chartPanel, filename: 'pcoa3d-' + ord.metricName, lang: getLang(), startEditing: wasEditing,
        elements: [
          { id: 'title', create: { text: t('beta.pcoa3dFigTitle', { metric: ord.metricName }), x: W / 2, y: 24, anchor: 'middle', cls: 'ce-title' } },
          { id: 'legend', selector: '[data-ce="legend"]', kind: 'group' },
        ],
        paletteSeries: groups.map((g, i) => ({ id: 's' + i, label: g })),
        paletteType: 'categorical', paletteMax: CATEGORICAL_SCATTER_MAX,
        onReset: () => paint(),
      });
    }

    // ---- tabla ----
    const tableCard = document.createElement('section');
    tableCard.className = 'ql-card ql-panel';
    tableCard.style.marginTop = '20px';
    tableCard.innerHTML = '<h2>' + t('beta.pcoaTableTitle') + '</h2>';
    const scrollDiv = document.createElement('div');
    scrollDiv.className = 'ql-table-scroll scroll-x';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table';
    let th = '<thead><tr><th>' + t('beta.colSample') + '</th>';
    if (groups.length) th += '<th>' + escapeHtml(pcoaGroupCol) + '</th>';
    for (let i = 0; i < maxPC; i++) th += '<th>PCo' + (i + 1) + '</th>';
    tbl.innerHTML = th + '</tr></thead>';
    const tb = document.createElement('tbody');
    ord.sampleIds.forEach((sid, i) => {
      const tr = document.createElement('tr');
      let c = '<td>' + escapeHtml(sid) + '</td>';
      if (groups.length) c += '<td>' + escapeHtml(groupOf[sid] || '—') + '</td>';
      for (let k = 0; k < maxPC; k++) c += '<td class="ql-num tabular">' + ord.coords[i][k].toFixed(4) + '</td>';
      tr.innerHTML = c;
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    scrollDiv.appendChild(tbl);
    tableCard.appendChild(scrollDiv);
    container.appendChild(tableCard);
  }

  paint();
  const stop = subscribe(paint);
  return () => { stop(); clusterGen++; if (editor) { editor.destroy(); editor = null; } };
}
