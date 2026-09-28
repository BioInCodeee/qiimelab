import { state, subscribe } from '../state.js';
import { t } from '../lib/i18n.js';
import { domainMotif } from '../lib/motif.js';
import { getProfileName } from '../lib/profile.js';
import { slotFilled, GROUPS } from './shell.js';
import { healthBannerEl } from '../lib/healthBanner.js';
import { escapeHtml } from '../lib/dom.js';

// route = fragmento de ruta; qKey = pregunta en lenguaje llano (texto principal);
// nameKey/descKey = rótulo y descripción técnicos (secundarios); glos = id del
// término de glosario más relevante (#/glosario?t=<glos>); group = misma
// sección que en la navegación principal (shell.js GROUPS) — la rejilla usa
// las mismas cabeceras/orden, así que no se repite ni se puede desincronizar.
const MODULES_INFO = [
  { route: 'qc', qKey: 'home.q.qc', nameKey: 'nav.qc', descKey: 'modules.qc.desc', glos: 'qc', group: 'data' },
  { route: 'barplots', qKey: 'home.q.barplots', nameKey: 'nav.barplots', descKey: 'modules.barplots.desc', glos: 'relAbund', group: 'composition' },
  { route: 'alfa', qKey: 'home.q.alfa', nameKey: 'nav.alpha', descKey: 'modules.alpha.desc', glos: 'alphaDiv', group: 'composition' },
  { route: 'beta', qKey: 'home.q.beta', nameKey: 'nav.beta', descKey: 'modules.beta.desc', glos: 'betaDiv', group: 'composition' },
  { route: 'venn', qKey: 'home.q.venn', nameKey: 'nav.venn', descKey: 'modules.venn.desc', glos: 'venn', group: 'composition' },
  { route: 'correlograma', qKey: 'home.q.correlograma', nameKey: 'nav.correlograma', descKey: 'modules.correlograma.desc', glos: 'correlation', group: 'composition' },
  { route: 'diferencial', qKey: 'home.q.diferencial', nameKey: 'nav.differential', descKey: 'modules.differential.desc', glos: 'diffAbund', group: 'stats' },
  { route: 'funcional', qKey: 'home.q.funcional', nameKey: 'nav.funcional', descKey: 'modules.funcional.desc', glos: 'kegg', group: 'stats' },
  { route: 'recuentos', qKey: 'home.q.recuentos', nameKey: 'nav.recuentos', descKey: 'modules.recuentos.desc', glos: 'sdvsse', group: 'counts' },
  { route: 'primers', qKey: 'home.q.primers', nameKey: 'nav.primers', descKey: 'modules.primers.desc', glos: 'primerTm', group: 'primers' },
  { route: 'arbol', qKey: 'home.q.arbol', nameKey: 'nav.arbol', descKey: 'modules.arbol.desc', glos: 'neighborJoiningTerm', group: 'primers' },
  { route: 'sanger', qKey: 'home.q.sanger', nameKey: 'nav.sanger', descKey: 'modules.sanger.desc', glos: 'sangerConsensusTerm', group: 'primers' },
];

const MORE_LINKS = [
  { route: 'recuentos?tab=calc', navKey: 'nav.ufc' },
  { route: 'informe', navKey: 'nav.informe' },
  { route: 'recursos', navKey: 'nav.recursos' },
  { route: 'glosario', navKey: 'nav.glosario' },
  { route: 'validacion', navKey: 'nav.validacion' },
];

export function render(container) {
  function paint() {
    container.innerHTML = '';

    const who = getProfileName();
    const header = document.createElement('header');
    header.className = 'ql-hero';
    header.innerHTML =
      '<div class="ql-hero-motif">' + domainMotif() + '</div>' +
      '<div class="ql-hero-body">' +
      '<p class="ql-eyebrow">' + (who ? t('shell.greeting', { name: escapeHtml(who) }) + ' · ' : '') + t('home.eyebrow') + '</p>' +
      '<h1 class="ql-hero-title">Smart-175</h1>' +
      '<p class="ql-hero-sub">' + t('home.subtitle') + '</p>' +
      '</div>';
    container.appendChild(header);

    const stack = document.createElement('div');
    stack.className = 'ql-stack';

    // CTA / estado de carga
    const cta = document.createElement('section');
    cta.className = 'ql-card ql-panel';
    const anyData = state.metadata || state.taxonomy || state.taxaBarplot || state.alphaDiversity ||
      state.betaDiversity || state.differentialAbundance || state.taxaCounts ||
      (Array.isArray(state.sequenceQC) && state.sequenceQC.length > 0) ||
      (Array.isArray(state.microbialCounts) && state.microbialCounts.length > 0);
    cta.innerHTML = anyData
      ? '<h2>' + t('home.ctaLoadedTitle') + '</h2><p class="ql-panel-note">' + t('home.ctaLoadedNote') + '</p>'
      : '<h2>' + t('home.ctaEmptyTitle') + '</h2><p class="ql-panel-note">' + t('home.ctaEmptyNote') + '</p>';
    const ctaBtn = document.createElement('a');
    ctaBtn.href = '#/cargar';
    ctaBtn.className = 'ql-btn ql-btn-primary';
    ctaBtn.textContent = anyData ? t('home.ctaBtnMore') : t('home.ctaBtnLoad');
    cta.appendChild(ctaBtn);
    stack.appendChild(cta);

    // panel de estado (semáforo) — solo si ya hay algo cargado
    const banner = healthBannerEl({ compact: true, link: true, hideWhenEmpty: true });
    if (banner) stack.appendChild(banner);

    // resumen de slots
    const summary = document.createElement('section');
    summary.className = 'ql-card ql-panel';
    summary.innerHTML = '<h2>' + t('home.summaryTitle') + '</h2><p class="ql-panel-note">' + t('home.summaryNote') + '</p>';
    const stats = document.createElement('div');
    stats.className = 'ql-stats';
    const rows = [
      [t('slots.metadata'), !!state.metadata],
      [t('slots.taxonomy'), !!state.taxonomy],
      [t('slots.taxaBarplot'), !!state.taxaBarplot],
      [t('slots.taxaCounts'), !!state.taxaCounts],
      [t('slots.alpha'), !!state.alphaDiversity],
      [t('slots.beta'), !!state.betaDiversity],
      [t('slots.differential'), !!state.differentialAbundance],
      [t('slots.fastq'), Array.isArray(state.sequenceQC) && state.sequenceQC.length > 0],
    ];
    rows.forEach(([lbl, done]) => {
      const tile = document.createElement('div');
      tile.className = 'ql-stat';
      tile.innerHTML = '<div class="ql-stat-label">' + lbl + '</div><div class="ql-stat-value" style="font-size:14px;color:' +
        (done ? 'var(--good)' : 'var(--ink-muted)') + '">' + (done ? t('common.available') : t('common.noData')) + '</div>';
      stats.appendChild(tile);
    });
    summary.appendChild(stats);
    stack.appendChild(summary);

    // módulos — como asistente de "qué quiero saber", agrupados en las
    // mismas secciones que la navegación principal (shell.js GROUPS)
    const modsSection = document.createElement('section');
    modsSection.className = 'ql-card ql-panel';
    modsSection.innerHTML = '<h2>' + t('home.modulesTitle') + '</h2><p class="ql-panel-note">' + t('home.modulesNote') + '</p>';
    GROUPS.forEach((g) => {
      const inGroup = MODULES_INFO.filter((m) => m.group === g.id);
      if (!inGroup.length) return;
      const h3 = document.createElement('h3');
      h3.className = 'ql-modgroup-title';
      h3.textContent = t(g.titleKey);
      modsSection.appendChild(h3);
      const grid = document.createElement('div');
      grid.className = 'ql-modgrid';
      inGroup.forEach((m) => {
        const has = slotFilled(m.route);
        const cell = document.createElement('div');
        cell.className = 'ql-modcell';
        const card = document.createElement('a');
        card.href = '#/' + m.route;
        card.className = 'ql-modcard ql-modcard-q';
        card.innerHTML =
          '<div class="ql-modcard-head">' +
          '<strong>' + t(m.qKey) + '</strong>' +
          '<span class="ql-badge ' + (has ? 'ql-badge-good' : 'ql-badge-muted') + '">' +
          t(has ? 'home.modHas' : 'home.modNo') + '</span></div>' +
          '<p class="ql-modcard-name">' + t(m.nameKey) + ' · ' + t(m.descKey) + '</p>' +
          '<span class="ql-modcard-go" aria-hidden="true">→</span>';
        cell.appendChild(card);
        const glosA = document.createElement('a');
        glosA.className = 'ql-modcard-glos';
        glosA.href = '#/glosario?t=' + m.glos;
        glosA.textContent = t('home.glosLink');
        cell.appendChild(glosA);
        grid.appendChild(cell);
      });
      modsSection.appendChild(grid);
    });

    const more = document.createElement('p');
    more.className = 'ql-modmore';
    more.innerHTML = t('home.moreLinks') + ' ' + MORE_LINKS
      .map((l) => '<a href="#/' + l.route + '">' + t(l.navKey) + '</a>')
      .join(' · ');
    modsSection.appendChild(more);
    stack.appendChild(modsSection);

    container.appendChild(stack);
  }
  paint();
  return subscribe(paint);
}
