// Router mínimo basado en hash + arranque de la app. Sin build step: todo
// son módulos ES nativos que el navegador carga directamente.

// PRIMERO: migra las claves qiimelab.* de localStorage a smart-175.* antes de
// que ningún otro módulo (i18n, tema, perfil…) lea las suyas al evaluarse
import './lib/storageMigration.js';
import { renderShell, subscribeShell } from './modules/shell.js';
import { renderFooter } from './modules/footer.js';
import { onLangChange, t } from './lib/i18n.js';
import { onProfileChange } from './lib/profile.js';
import { watchFieldLabels, linkFieldLabels } from './lib/a11yFields.js';
import { initPWA, onPWAChange } from './lib/pwa.js';
import { initTheme } from './lib/theme.js';
import { initNavDrawer } from './lib/navDrawer.js';
import { captureRoute } from './lib/reportLog.js';

const sidebar = document.getElementById('sidebar');
const view = document.getElementById('app-view');
const footer = document.getElementById('app-footer');

// enlace "saltar al contenido" (primer tabulador de la página) + destino enfocable
view.setAttribute('tabindex', '-1');
const skipLink = document.createElement('a');
skipLink.className = 'ql-skip-link';
skipLink.href = '#app-view';
skipLink.addEventListener('click', (e) => {
  e.preventDefault();
  view.focus();
  view.scrollIntoView({ block: 'start' });
});
document.body.insertBefore(skipLink, document.body.firstChild);
function syncSkipLink() { skipLink.textContent = t('ui.skipToContent'); }
syncSkipLink();

// ≤ 860 px: la barra lateral es un cajón tras un botón «Menú» (ver js/lib/navDrawer.js)
initNavDrawer(sidebar, view);

const moduleLoaders = {
  '': () => import('./modules/home.js'),
  cargar: () => import('./modules/upload.js'),
  barplots: () => import('./modules/taxaBarplot.js'),
  alfa: () => import('./modules/alphaDiversity.js'),
  beta: () => import('./modules/betaDiversity.js'),
  temporal: () => import('./modules/temporal.js'),
  diferencial: () => import('./modules/differentialAbundance.js'),
  recuentos: () => import('./modules/microbialCounts.js'),
  // #/ufc: la calculadora vive ahora como pestaña de #/recuentos (Fase 2, B4);
  // el alias redirige para no romper enlaces guardados
  ufc: () => { location.replace('#/recuentos?tab=calc'); return import('./modules/microbialCounts.js'); },
  calculadora: () => import('./modules/labcalc.js'),
  primers: () => import('./modules/primers.js'),
  arbol: () => import('./modules/phylo.js'),
  sanger: () => import('./modules/sanger.js'),
  venn: () => import('./modules/venn.js'),
  correlograma: () => import('./modules/correlogram.js'),
  funcional: () => import('./modules/functional.js'),
  inferencia: () => import('./modules/inference.js'),
  qc: () => import('./modules/sequenceQC.js'),
  informe: () => import('./modules/informe.js'),
  recursos: () => import('./modules/recursos.js'),
  glosario: () => import('./modules/glosario.js'),
  validacion: () => import('./modules/validacion.js'),
};

let routeId = '';
let cleanupCurrentModule = null;

function currentRouteId() {
  // #/glosario?t=shannon → "glosario" (se ignora subruta y query)
  const hash = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return hash in moduleLoaders ? hash : '';
}

async function renderRoute() {
  // instantánea para el informe completo de lo que mostraba el módulo que se
  // deja, ANTES de su limpieza (ver js/lib/reportLog.js)
  captureRoute(routeId, view);
  if (typeof cleanupCurrentModule === 'function') {
    try { cleanupCurrentModule(); } catch (e) { /* noop */ }
  }
  cleanupCurrentModule = null;

  routeId = currentRouteId();
  renderShell(sidebar, routeId);
  renderFooter(footer);
  view.innerHTML =
    '<div class="ql-skel" role="status" aria-live="polite">' +
    '<span class="ql-skel-sr">' + t('app.loading') + '</span>' +
    '<div class="ql-skel-line ql-skel-eyebrow"></div>' +
    '<div class="ql-skel-line ql-skel-title"></div>' +
    '<div class="ql-skel-line ql-skel-sub"></div>' +
    '<div class="ql-skel-card"></div>' +
    '<div class="ql-skel-card ql-skel-card-sm"></div>' +
    '</div>';
  try {
    const mod = await moduleLoaders[routeId]();
    if (routeId !== currentRouteId()) return; // el usuario ya navegó a otro sitio mientras cargaba
    view.innerHTML = '';
    cleanupCurrentModule = mod.render(view) || null;
    linkFieldLabels(view); // etiqueta↔control tras el render inicial (el observer cubre los re-render)
  } catch (err) {
    console.error(err);
    view.innerHTML = '<div class="ql-card ql-panel"><h2>' + t('app.moduleLoadError') + '</h2>' +
      '<p class="ql-panel-note">' + (err && err.message ? err.message : t('app.unknownError')) + '</p></div>';
  }
}

subscribeShell(sidebar, () => routeId);
watchFieldLabels(view); // re-enlaza label↔control en cada re-render de módulo
window.addEventListener('hashchange', renderRoute);
// al cambiar de idioma o de nombre local se repinta toda la app
onLangChange(() => { syncSkipLink(); renderRoute(); });
onProfileChange(renderRoute);
// PWA: al aparecer/desaparecer la posibilidad de instalar, repinta el footer
onPWAChange(() => renderFooter(footer));
initPWA();
initTheme();
renderRoute();
