import { state, subscribe } from '../state.js';
import { t } from '../lib/i18n.js';
import { brandHero } from '../lib/brand.js';
import { getProfileName } from '../lib/profile.js';
import { slotFilled, GROUPS, ROUTES } from './shell.js';
import { healthBannerEl } from '../lib/healthBanner.js';
import { escapeHtml } from '../lib/dom.js';
import { mountExampleButtons, loadExampleCommunityData, loadRealCommunityData } from '../lib/exampleData.js';

// La portada tiene UNA tarea: que quien entra sepa qué hacer a continuación.
// Antes mostraba de golpe el estado de 8 huecos de datos y 15 módulos en 5
// grupos abiertos — en un móvil, varias pantallas de scroll antes de poder
// hacer nada. Ahora todo lo que no es la acción principal está plegado en
// <details> nativos: se ve el resumen en una línea y se abre lo que interese.
//
// Se usan <details>/<summary> del navegador a propósito, y no un plegable
// propio: traen la accesibilidad por teclado y el estado abierto/cerrado
// gratis, y funcionan aunque falle el JavaScript.

// route = fragmento de ruta; qKey = pregunta en lenguaje llano (texto principal);
// nameKey/descKey = rótulo y descripción técnicos (secundarios); glos = id del
// término de glosario más relevante (#/glosario?t=<glos>); group = misma
// sección que en la navegación principal (shell.js GROUPS) — la rejilla usa
// las mismas cabeceras/orden, así que no se repite ni se puede desincronizar.
const MODULES_INFO = [
  { route: 'qc', qKey: 'home.q.qc', nameKey: 'nav.qc', descKey: 'modules.qc.desc', glos: 'qc' },
  { route: 'barplots', qKey: 'home.q.barplots', nameKey: 'nav.barplots', descKey: 'modules.barplots.desc', glos: 'relAbund' },
  { route: 'alfa', qKey: 'home.q.alfa', nameKey: 'nav.alpha', descKey: 'modules.alpha.desc', glos: 'alphaDiv' },
  { route: 'beta', qKey: 'home.q.beta', nameKey: 'nav.beta', descKey: 'modules.beta.desc', glos: 'betaDiv' },
  { route: 'arbolcalor', qKey: 'home.q.arbolcalor', nameKey: 'nav.arbolcalor', descKey: 'modules.arbolcalor.desc', glos: 'relAbund' },
  { route: 'temporal', qKey: 'home.q.temporal', nameKey: 'nav.temporal', descKey: 'modules.temporal.desc', glos: 'alphaDiv' },
  { route: 'venn', qKey: 'home.q.venn', nameKey: 'nav.venn', descKey: 'modules.venn.desc', glos: 'venn' },
  { route: 'correlograma', qKey: 'home.q.correlograma', nameKey: 'nav.correlograma', descKey: 'modules.correlograma.desc', glos: 'correlation' },
  { route: 'diferencial', qKey: 'home.q.diferencial', nameKey: 'nav.differential', descKey: 'modules.differential.desc', glos: 'diffAbund' },
  { route: 'funcional', qKey: 'home.q.funcional', nameKey: 'nav.funcional', descKey: 'modules.funcional.desc', glos: 'kegg' },
  { route: 'inferencia', qKey: 'home.q.inferencia', nameKey: 'nav.inference', descKey: 'modules.inferencia.desc', glos: 'kegg' },
  { route: 'recuentos', qKey: 'home.q.recuentos', nameKey: 'nav.recuentos', descKey: 'modules.recuentos.desc', glos: 'sdvsse' },
  { route: 'recuentos?tab=foto', qKey: 'home.q.placa', nameKey: 'recuentos.sectionPhoto', descKey: 'modules.placa.desc', glos: 'sdvsse' },
  { route: 'primers', qKey: 'home.q.primers', nameKey: 'nav.primers', descKey: 'modules.primers.desc', glos: 'primerTm' },
  { route: 'arbol', qKey: 'home.q.arbol', nameKey: 'nav.arbol', descKey: 'modules.arbol.desc', glos: 'neighborJoiningTerm' },
  { route: 'sanger', qKey: 'home.q.sanger', nameKey: 'nav.sanger', descKey: 'modules.sanger.desc', glos: 'sangerConsensusTerm' },
];

const MORE_LINKS = [
  { route: 'recuentos?tab=calc', navKey: 'nav.ufc' },
  { route: 'informe', navKey: 'nav.informe' },
  { route: 'recursos', navKey: 'nav.recursos' },
  { route: 'glosario', navKey: 'nav.glosario' },
  { route: 'validacion', navKey: 'nav.validacion' },
];

const SLOT_ROWS = [
  ['slots.metadata', () => !!state.metadata],
  ['slots.taxonomy', () => !!state.taxonomy],
  ['slots.taxaBarplot', () => !!state.taxaBarplot],
  ['slots.taxaCounts', () => !!state.taxaCounts],
  ['slots.alpha', () => !!state.alphaDiversity],
  ['slots.beta', () => !!state.betaDiversity],
  ['slots.differential', () => !!state.differentialAbundance],
  ['slots.fastq', () => Array.isArray(state.sequenceQC) && state.sequenceQC.length > 0],
];

/** Sección de una ruta según shell.js ROUTES — única fuente de verdad. Antes
 *  cada entrada de MODULES_INFO repetía su `group`, y eran dos listas que
 *  había que mantener a mano en paralelo. */
function groupOfRoute(route) {
  const id = String(route).split('?')[0];
  const r = ROUTES.find((x) => x.id === id);
  return r ? r.group : null;
}

export function render(container) {
  function paint() {
    container.innerHTML = '';

    const who = getProfileName();
    container.appendChild(brandHero({
      eyebrowHtml: (who ? t('shell.greeting', { name: escapeHtml(who) }) + ' · ' : '') + t('home.eyebrow'),
      subHtml: t('home.subtitle'),
    }));

    const stack = document.createElement('div');
    stack.className = 'ql-stack';

    const anyData = state.metadata || state.taxonomy || state.taxaBarplot || state.alphaDiversity ||
      state.betaDiversity || state.differentialAbundance || state.taxaCounts ||
      (Array.isArray(state.sequenceQC) && state.sequenceQC.length > 0) ||
      (Array.isArray(state.microbialCounts) && state.microbialCounts.length > 0);

    // ---- 1. la acción principal, sola y arriba ----
    const cta = document.createElement('section');
    cta.className = 'ql-card ql-panel';
    cta.innerHTML = anyData
      ? '<h2>' + t('home.ctaLoadedTitle') + '</h2><p class="ql-panel-note">' + t('home.ctaLoadedNote') + '</p>'
      : '<h2>' + t('home.ctaEmptyTitle') + '</h2><p class="ql-panel-note">' + t('home.ctaEmptyNote') + '</p>';

    const ctaRow = document.createElement('div');
    ctaRow.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;';
    const ctaBtn = document.createElement('a');
    ctaBtn.href = '#/cargar';
    ctaBtn.className = 'ql-btn ql-btn-primary';
    ctaBtn.textContent = anyData ? t('home.ctaBtnMore') : t('home.ctaBtnLoad');
    ctaRow.appendChild(ctaBtn);
    cta.appendChild(ctaRow);

    // Datos de ejemplo EN LA PORTADA, no escondidos dentro de cada módulo:
    // quien llega sin archivos a mano puede ver la aplicación funcionando sin
    // tener que conseguir primero un dataset. Es la diferencia entre probarla
    // y cerrarla.
    if (!anyData) {
      mountExampleButtons(cta, {
        real: loadRealCommunityData,
        synthetic: loadExampleCommunityData,
        download: ['barplot', 'metadata', 'shannon'],
      });
    }
    stack.appendChild(cta);

    // panel de estado (semáforo) — solo si ya hay algo cargado
    const banner = healthBannerEl({ compact: true, link: true, hideWhenEmpty: true });
    if (banner) stack.appendChild(banner);

    // ---- 2. qué hay cargado: una línea, y el detalle si se pide ----
    const loaded = SLOT_ROWS.filter(([, has]) => has()).length;
    const summary = document.createElement('details');
    summary.className = 'ql-card ql-panel ql-home-details';
    // se abre solo si no hay nada cargado y por tanto el resumen es la propia
    // explicación de qué falta
    summary.open = false;
    const sumHead = document.createElement('summary');
    sumHead.innerHTML = '<strong>' + t('home.summaryTitle') + '</strong> · ' +
      '<span class="ql-field-help" style="margin:0;">' +
      t('home.summaryCount', { n: loaded, total: SLOT_ROWS.length }) + '</span>';
    summary.appendChild(sumHead);
    summary.insertAdjacentHTML('beforeend', '<p class="ql-panel-note">' + t('home.summaryNote') + '</p>');
    const stats = document.createElement('div');
    stats.className = 'ql-stats';
    SLOT_ROWS.forEach(([lbl, has]) => {
      const done = has();
      const tile = document.createElement('div');
      // estado como clase (no color en línea): el verde es el indicador, el
      // texto va en un color con contraste ≥ 4,5:1 (ver [data-ds="v2"] .ql-stat)
      tile.className = 'ql-stat ql-stat-status' + (done ? ' is-on' : '');
      tile.innerHTML = '<div class="ql-stat-label">' + t(lbl) + '</div><div class="ql-stat-value">' +
        (done ? t('common.available') : t('common.noData')) + '</div>';
      stats.appendChild(tile);
    });
    summary.appendChild(stats);
    stack.appendChild(summary);

    // ---- 3. módulos, plegados por sección ----
    // Se abre SOLO la primera sección que tenga datos listos: es la que la
    // persona puede usar ahora mismo. Si no hay datos, se abre la primera, que
    // es por donde se empieza.
    const modsSection = document.createElement('section');
    modsSection.className = 'ql-card ql-panel';
    modsSection.innerHTML = '<h2>' + t('home.modulesTitle') + '</h2><p class="ql-panel-note">' + t('home.modulesNote') + '</p>';

    let openedOne = false;
    GROUPS.forEach((g, gi) => {
      const inGroup = MODULES_INFO.filter((m) => groupOfRoute(m.route) === g.id);
      if (!inGroup.length) return;
      const ready = inGroup.filter((m) => slotFilled(m.route.split('?')[0])).length;

      const det = document.createElement('details');
      det.className = 'ql-home-group';
      if (!openedOne && (anyData ? ready > 0 : gi === 0)) { det.open = true; openedOne = true; }
      const head = document.createElement('summary');
      head.className = 'ql-modgroup-title';
      head.innerHTML = '<strong>' + t(g.titleKey) + '</strong> ' +
        '<span class="ql-badge ' + (ready ? 'ql-badge-good' : 'ql-badge-muted') + '">' +
        t('home.groupReady', { n: ready, total: inGroup.length }) + '</span>';
      det.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'ql-modgrid';
      inGroup.forEach((m) => {
        const has = slotFilled(m.route.split('?')[0]);
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
      det.appendChild(grid);
      modsSection.appendChild(det);
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
