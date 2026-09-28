// Página "Recursos": plantillas de scripts (pipeline QIIME 2 + helpers de R)
// descargables una a una. No hay estado ni datos que cargar — es una lista
// estática servida desde recursos/.

import { t } from '../lib/i18n.js';
import { pageHero } from '../lib/brand.js';

const RES_BASE = 'recursos/';

// { file: ruta dentro de recursos/, k: sufijo de clave i18n recursos.d.<k> }
const CATEGORIES = [
  {
    titleKey: 'recursos.catPipeline',
    noteKey: 'recursos.catPipelineNote',
    items: [
      { file: 'pipeline-qiime2/00_qc_initial.sh', k: 'qc' },
      { file: 'pipeline-qiime2/01_import_qiime2.sh', k: 'import' },
      { file: 'pipeline-qiime2/02_cutadapt.sh', k: 'cutadapt' },
      { file: 'pipeline-qiime2/03_dada2.sh', k: 'dada2' },
      { file: 'pipeline-qiime2/04_evaluar_longitud_ASVs.sh', k: 'longitud' },
      { file: 'pipeline-qiime2/05_taxonomia.sh', k: 'taxonomia' },
      { file: 'pipeline-qiime2/06_resumen_tabla.sh', k: 'resumen' },
      { file: 'pipeline-qiime2/07_estadisticas_taxonomia.py', k: 'statstax' },
      { file: 'pipeline-qiime2/08_filtrado_y_filogenia.sh', k: 'filtrado' },
      { file: 'pipeline-qiime2/09_diversidad_core.sh', k: 'diversidad' },
      { file: 'pipeline-qiime2/09b_pcoa_emperor.sh', k: 'pcoa' },
      { file: 'pipeline-qiime2/09c_exportar_pcoa.sh', k: 'exportpcoa' },
      { file: 'pipeline-qiime2/10_estadistica_beta.sh', k: 'permanova' },
      { file: 'pipeline-qiime2/11_exportar_datos_brutos.sh', k: 'exportar' },
      { file: 'pipeline-qiime2/12_taxonomia_barplots.sh', k: 'barplots' },
      { file: 'pipeline-qiime2/13_normalizar_taxonomia.py', k: 'normalizar' },
      { file: 'pipeline-qiime2/02_cutadapt_ITS.sh', k: 'cutadaptits' },
      { file: 'pipeline-qiime2/03_dada2_ITS.sh', k: 'dada2its' },
    ],
  },
  {
    titleKey: 'recursos.catR',
    noteKey: 'recursos.catRNote',
    items: [
      { file: 'r-analisis/correlograma.R', k: 'correlograma' },
      { file: 'r-analisis/parse_qiime_ordination.R', k: 'ordination' },
    ],
  },
];

const DL_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/></svg>';

export function render(container) {
  container.innerHTML = '';

  container.appendChild(pageHero({
    eyebrowHtml: t('recursos.eyebrow'),
    titleHtml: t('recursos.title'),
    subHtml: t('recursos.subtitle'),
  }));

  const stack = document.createElement('div');
  stack.className = 'ql-stack';

  // Nota visible: son plantillas educativas, no un procedimiento soportado
  const note = document.createElement('div');
  note.className = 'ql-callout';
  note.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>' +
    '<p>' + t('recursos.note') + '</p>';
  stack.appendChild(note);

  CATEGORIES.forEach((cat) => {
    const section = document.createElement('section');
    section.className = 'ql-card ql-panel';
    section.innerHTML =
      '<h2>' + t(cat.titleKey) + '</h2>' +
      '<p class="ql-panel-note">' + t(cat.noteKey) + '</p>';

    const list = document.createElement('div');
    list.className = 'ql-reslist';
    cat.items.forEach((it) => {
      const name = it.file.split('/').pop();
      const row = document.createElement('div');
      row.className = 'ql-res-row';
      row.innerHTML =
        '<code class="ql-res-name">' + name + '</code>' +
        '<span class="ql-res-desc">' + t('recursos.d.' + it.k) + '</span>';
      const a = document.createElement('a');
      a.className = 'ql-res-dl';
      a.href = RES_BASE + it.file;
      a.setAttribute('download', name);
      a.innerHTML = DL_ICON + '<span>' + t('recursos.download') + '</span>';
      row.appendChild(a);
      list.appendChild(row);
    });
    section.appendChild(list);
    stack.appendChild(section);
  });

  container.appendChild(stack);
}
