// Barra lateral: navegación entre módulos + resumen de qué datos hay cargados
// + selector de idioma.

import { state, subscribe } from '../state.js';
import { t, getLang, setLang, LANGS } from '../lib/i18n.js';
import { getProfileName, setProfileName } from '../lib/profile.js';
import { getTheme, setTheme } from '../lib/theme.js';

// Sistema de iconos propio: 24×24, trazo 1.7, extremos redondeados, sin
// relleno salvo los puntos de datos. Cada glifo abstrae su módulo.
const ic = (body) => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
const ICONS = {
  home: ic('<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10.5V19a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-8.5"/>'),
  upload: ic('<path d="M12 15V4m0 0-3.5 3.5M12 4l3.5 3.5"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>'),
  bars: ic('<rect x="7.5" y="4" width="9" height="16" rx="1.5"/><path d="M7.5 10h9M7.5 14.5h9"/>'),
  alpha: ic('<path d="M12 4v3.5M12 16.5V20"/><rect x="7.5" y="7.5" width="9" height="9" rx="1.2"/><path d="M7.5 12h9"/><path d="M9.5 4h5M9.5 20h5"/>'),
  beta: ic('<rect x="4" y="4" width="16" height="16" rx="1.6"/><path d="M4 9.33h16M4 14.66h16M9.33 4v16M14.66 4v16"/>'),
  volcano: ic('<path d="M4 20h16"/><path d="M12 20V5" stroke-dasharray="2.4 2.6"/><circle cx="7" cy="10" r="1.35" fill="currentColor" stroke="none"/><circle cx="9.3" cy="14.5" r="1.35" fill="currentColor" stroke="none"/><circle cx="12.6" cy="16.5" r="1.35" fill="currentColor" stroke="none"/><circle cx="15.4" cy="12.5" r="1.35" fill="currentColor" stroke="none"/><circle cx="17.3" cy="8" r="1.35" fill="currentColor" stroke="none"/>'),
  recuentos: ic('<path d="M4 20h16"/><rect x="6" y="11" width="4" height="9" rx="1"/><rect x="14" y="7" width="4" height="13" rx="1"/><path d="M8 11V8.5M16 7V4.5" /><path d="M6.7 8.5h2.6M14.7 4.5h2.6"/>'),
  calculator: ic('<rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="10" y2="11"/><line x1="14" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="10" y2="15"/><line x1="14" y1="15" x2="16" y2="15"/>'),
  primers: ic('<path d="M3 12h6M21 12h-6"/><path d="M7 9l2 3-2 3M17 9l-2 3 2 3"/>'),
  arbol: ic('<path d="M3 12H6M6 6.75V17.25M6 6.75H13M6 17.25H13M13 4.5V9M13 4.5H20M13 9H20M13 15V19.5M13 15H20M13 19.5H20"/>'),
  sanger: ic('<path d="M4 20V4M4 4c3 3 5-2 8 0s5-2 8 0M4 9c3 3 5-2 8 0s5-2 8 0M4 14c3 3 5-2 8 0s5-2 8 0"/>'),
  venn: ic('<circle cx="9.5" cy="12" r="6"/><circle cx="14.5" cy="12" r="6"/>'),
  qc: ic('<path d="M4 20h16"/><path d="M6.5 20V9M11 20V7.5M15.5 20V10.5M20 20V15"/>'),
  correlogram: ic('<rect x="4" y="4" width="16" height="16" rx="1.6"/><path d="M4 9.33h16M4 14.66h16M9.33 4v16M14.66 4v16"/><circle cx="6.7" cy="6.7" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="17.3" cy="17.3" r="1" fill="currentColor" stroke="none"/><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none"/>'),
  functional: ic('<path d="M4 19h16"/><rect x="5.5" y="12" width="3.4" height="7" rx="0.8"/><rect x="10.3" y="7" width="3.4" height="12" rx="0.8"/><rect x="15.1" y="10" width="3.4" height="9" rx="0.8"/><path d="M4.5 5.5c2-2 3.5 2 5.5 0s3.5 2 5.5 0 3.5 2 4 1.5"/>'),
  inferencia: ic('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="17" r="2.5"/><path d="m8 7.5 8 7M16 7.5l-8 7"/>'),
  recursos: ic('<path d="M7 3h8l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><path d="M10 13.5 8.5 15 10 16.5M14 13.5 15.5 15 14 16.5"/>'),
  informe: ic('<path d="M7 3h8l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><path d="M9 12h6M9 15.5h6M9 8.5h2"/>'),
  glosario: ic('<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5Z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/><path d="M9 7.5h6M9 10.5h4"/>'),
  validacion: ic('<path d="M12 3 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
  temporal: ic('<path d="M4 20h16M4 20V4"/><path d="M4 15.5 9 10l4 3 7-7.5"/><circle cx="9" cy="10" r="1.3" fill="currentColor" stroke="none"/><circle cx="13" cy="13" r="1.3" fill="currentColor" stroke="none"/><circle cx="20" cy="5.5" r="1.3" fill="currentColor" stroke="none"/>'),
};

// Logomark: dendrograma (agrupamiento) reducido a 3 hojas y 2 nodos, sobre
// baldosa redondeada con el color de marca.
const BRAND_MARK =
  '<svg class="ql-brand-mark" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<rect width="32" height="32" rx="8" fill="var(--accent)"/>' +
  '<g stroke="var(--accent-ink)" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M8 25V17H15V25"/><path d="M11.5 17V11H23V25"/></g>' +
  '<g fill="var(--accent-ink)"><circle cx="8" cy="25" r="1.9"/><circle cx="15" cy="25" r="1.9"/><circle cx="23" cy="25" r="1.9"/></g>' +
  '</svg>';

// id = fragmento de ruta (#/<id>); navKey = clave de traducción del rótulo;
// group = sección de la navegación (ver GROUPS más abajo) — 'home' queda
// fuera de cualquier sección, es la portada, no un módulo de análisis.
// Reordenar/agrupar es solo visual: ninguna ruta cambia de sitio.
export const ROUTES = [
  { id: '', navKey: 'nav.home', icon: 'home', group: 'home' },
  { id: 'cargar', navKey: 'nav.upload', icon: 'upload', group: 'data' },
  { id: 'qc', navKey: 'nav.qc', icon: 'qc', group: 'data' },
  { id: 'barplots', navKey: 'nav.barplots', icon: 'bars', group: 'composition' },
  { id: 'alfa', navKey: 'nav.alpha', icon: 'alpha', group: 'composition' },
  { id: 'beta', navKey: 'nav.beta', icon: 'beta', group: 'composition' },
  { id: 'temporal', navKey: 'nav.temporal', icon: 'temporal', group: 'composition' },
  { id: 'venn', navKey: 'nav.venn', icon: 'venn', group: 'composition' },
  { id: 'correlograma', navKey: 'nav.correlograma', icon: 'correlogram', group: 'composition' },
  { id: 'diferencial', navKey: 'nav.differential', icon: 'volcano', group: 'stats' },
  { id: 'funcional', navKey: 'nav.funcional', icon: 'functional', group: 'stats' },
  { id: 'inferencia', navKey: 'nav.inference', icon: 'inferencia', group: 'stats' },
  { id: 'validacion', navKey: 'nav.validacion', icon: 'validacion', group: 'stats' },
  { id: 'recuentos', navKey: 'nav.recuentos', icon: 'recuentos', group: 'counts' },
  { id: 'calculadora', navKey: 'nav.calculadora', icon: 'calculator', group: 'counts' },
  { id: 'primers', navKey: 'nav.primers', icon: 'primers', group: 'primers' },
  { id: 'arbol', navKey: 'nav.arbol', icon: 'arbol', group: 'primers' },
  { id: 'sanger', navKey: 'nav.sanger', icon: 'sanger', group: 'primers' },
  { id: 'informe', navKey: 'nav.informe', icon: 'informe', group: 'resources' },
  { id: 'recursos', navKey: 'nav.recursos', icon: 'recursos', group: 'resources' },
  { id: 'glosario', navKey: 'nav.glosario', icon: 'glosario', group: 'resources' },
];

// título de cada sección de la navegación, en el mismo orden en que aparecen
// (home no lleva cabecera propia — ver renderShell).
export const GROUPS = [
  { id: 'data', titleKey: 'shell.groupData' },
  { id: 'composition', titleKey: 'shell.groupComposition' },
  { id: 'stats', titleKey: 'shell.groupStats' },
  { id: 'counts', titleKey: 'shell.groupCounts' },
  { id: 'primers', titleKey: 'shell.groupPrimers' },
  { id: 'resources', titleKey: 'shell.groupResources' },
];

// primers.js persiste en localStorage (no es una salida de QIIME2, no usa
// state) — lectura mínima para la insignia, sin importar el módulo entero.
function primersHaveData() {
  try {
    const raw = JSON.parse(localStorage.getItem('smart-175.primers') || localStorage.getItem('qiimelab.primers') || 'null');
    return !!(raw && Array.isArray(raw.primers) && raw.primers.some((p) => String(p.raw || '').trim().length >= 4));
  } catch (e) { return false; }
}

function phyloHasData() {
  try {
    const raw = JSON.parse(localStorage.getItem('smart-175.phylo') || localStorage.getItem('qiimelab.phylo') || 'null');
    return !!(raw && typeof raw.fastaText === 'string' && raw.fastaText.trim().length > 0);
  } catch (e) { return false; }
}

// sanger.js persiste solo la configuración y el último lote de resultados
// (la traza/calidad crudas viven en memoria de esa pestaña, no aquí).
function sangerHasData() {
  try {
    const raw = JSON.parse(localStorage.getItem('smart-175.sanger') || localStorage.getItem('qiimelab.sanger') || 'null');
    return !!(raw && Array.isArray(raw.results) && raw.results.length > 0);
  } catch (e) { return false; }
}

/** ¿Tiene ESE módulo los datos que necesita, ahora mismo? Lo usa la barra
 *  lateral (insignia "sin datos") y la portada (home.js). */
export function slotFilled(routeId) {
  switch (routeId) {
    case 'barplots': return !!state.taxaBarplot;
    case 'primers': return primersHaveData();
    case 'arbol': return phyloHasData();
    case 'sanger': return sangerHasData();
    case 'alfa': return !!state.alphaDiversity;
    case 'beta': return !!state.betaDiversity;
    case 'diferencial': return !!state.differentialAbundance || (Array.isArray(state.diffComparisons) && state.diffComparisons.length > 0);
    case 'recuentos': return Array.isArray(state.microbialCounts) && state.microbialCounts.length > 0;
    case 'venn': return !!state.taxaCounts && !!state.metadata;
    case 'correlograma': return !!state.metadata || !!state.alphaDiversity || !!state.taxaBarplot || !!state.taxaCounts;
    case 'temporal': return !!state.metadata && (!!state.alphaDiversity || !!state.taxaBarplot || !!state.taxaCounts);
    case 'funcional': return !!state.functionalKO && !!state.functionalCategories && !!state.metadata;
    case 'qc': return Array.isArray(state.sequenceQC) && state.sequenceQC.length > 0;
    case 'informe': return !!state.taxaBarplot || !!state.alphaDiversity || !!state.betaDiversity ||
      !!state.ordination || !!state.differentialAbundance || !!state.taxaCounts ||
      !!state.functionalKO || (Array.isArray(state.sequenceQC) && state.sequenceQC.length > 0) ||
      (Array.isArray(state.microbialCounts) && state.microbialCounts.length > 0);
    default: return true;
  }
}

export function renderShell(container, currentRoute) {
  container.innerHTML = '';
  container.setAttribute('aria-label', t('shell.nav'));

  const brand = document.createElement('a');
  brand.className = 'ql-brand';
  brand.href = '#/';
  brand.title = t('nav.home');
  brand.innerHTML = BRAND_MARK + '<span class="ql-brand-name">Smart-175</span>';
  container.appendChild(brand);

  const who = getProfileName();
  if (who) {
    const hi = document.createElement('p');
    hi.className = 'ql-greeting';
    hi.textContent = t('shell.greeting', { name: who });
    container.appendChild(hi);
  }

  function navItem(r) {
    const a = document.createElement('a');
    a.href = '#/' + r.id;
    const isActive = currentRoute === r.id;
    a.className = 'ql-nav-item' + (isActive ? ' is-active' : '');
    if (isActive) a.setAttribute('aria-current', 'page');
    const filled = slotFilled(r.id);
    a.innerHTML = '<span class="ql-nav-icon">' + ICONS[r.icon] + '</span><span>' + t(r.navKey) + '</span>' +
      (r.id !== '' && r.id !== 'cargar' && !filled ? '<span class="ql-nav-soon">' + t('shell.noData') + '</span>' : '');
    return a;
  }

  // "Resumen" (home) va suelto, antes de las secciones — es la portada, no
  // un módulo de análisis más.
  const homeNav = document.createElement('div');
  homeNav.className = 'ql-nav';
  homeNav.appendChild(navItem(ROUTES.find((r) => r.group === 'home')));
  container.appendChild(homeNav);

  GROUPS.forEach((g) => {
    const routesInGroup = ROUTES.filter((r) => r.group === g.id);
    if (!routesInGroup.length) return;
    const nav = document.createElement('div');
    nav.className = 'ql-nav';
    const label = document.createElement('div');
    label.className = 'ql-nav-group-label';
    label.textContent = t(g.titleKey);
    nav.appendChild(label);
    routesInGroup.forEach((r) => nav.appendChild(navItem(r)));
    container.appendChild(nav);
  });

  const statusWrap = document.createElement('div');
  statusWrap.className = 'ql-nav';
  statusWrap.style.marginTop = 'auto';
  const statusLabel = document.createElement('div');
  statusLabel.className = 'ql-nav-group-label';
  statusLabel.textContent = t('shell.sessionData');
  statusWrap.appendChild(statusLabel);

  const checklist = document.createElement('div');
  checklist.className = 'ql-checklist';
  checklist.style.padding = '0 12px';
  const items = [
    [t('slots.metadata'), !!state.metadata],
    [t('slots.taxonomy'), !!state.taxonomy],
    [t('slots.taxaBarplot'), !!state.taxaBarplot],
    [t('slots.taxaCounts'), !!state.taxaCounts],
    [t('slots.alpha'), !!state.alphaDiversity],
    [t('slots.beta'), !!state.betaDiversity],
    [t('slots.differential'), !!state.differentialAbundance],
    [t('slots.fastq'), Array.isArray(state.sequenceQC) && state.sequenceQC.length > 0],
  ];
  items.forEach(([lbl, done]) => {
    const row = document.createElement('div');
    row.className = 'ql-check-row' + (done ? ' is-done' : '');
    row.innerHTML = '<span class="ql-check-dot"></span>' + lbl;
    checklist.appendChild(row);
  });
  statusWrap.appendChild(checklist);
  container.appendChild(statusWrap);

  // ---- ajustes: idioma + nombre local (autónimos, sin banderas) ----
  const setWrap = document.createElement('div');
  setWrap.className = 'ql-nav ql-settings';
  const setLabel = document.createElement('div');
  setLabel.className = 'ql-nav-group-label';
  setLabel.textContent = t('shell.settings');
  setWrap.appendChild(setLabel);

  const langSel = document.createElement('select');
  langSel.id = 'ql-lang-select';
  langSel.setAttribute('aria-label', t('shell.language'));
  langSel.className = 'ql-settings-input';
  LANGS.forEach((l) => {
    const opt = document.createElement('option');
    opt.value = l.code;
    opt.textContent = l.label;
    if (l.code === getLang()) opt.selected = true;
    langSel.appendChild(opt);
  });
  langSel.addEventListener('change', () => setLang(langSel.value));
  setWrap.appendChild(langSel);

  const themeSeg = document.createElement('div');
  themeSeg.className = 'ql-segmented ql-segmented-block';
  themeSeg.setAttribute('role', 'group');
  themeSeg.setAttribute('aria-label', t('shell.theme'));
  const themeNow = getTheme();
  [
    ['light', t('shell.themeLight')],
    ['dark', t('shell.themeDark')],
    ['auto', t('shell.themeAuto')],
  ].forEach(([v, lbl]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ql-seg-btn' + (themeNow === v ? ' is-on' : '');
    if (themeNow === v) b.setAttribute('aria-pressed', 'true');
    b.textContent = lbl;
    b.addEventListener('click', () => {
      if (getTheme() === v) return;
      setTheme(v);
      themeSeg.querySelectorAll('.ql-seg-btn').forEach((btn) => {
        const isOn = btn === b;
        btn.classList.toggle('is-on', isOn);
        if (isOn) btn.setAttribute('aria-pressed', 'true');
        else btn.removeAttribute('aria-pressed');
      });
    });
    themeSeg.appendChild(b);
  });
  setWrap.appendChild(themeSeg);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = 'ql-profile-name';
  nameInput.className = 'ql-settings-input';
  nameInput.maxLength = 40;
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  nameInput.placeholder = t('shell.namePlaceholder');
  nameInput.setAttribute('aria-label', t('shell.nameLabel'));
  nameInput.value = getProfileName();
  // guarda al salir del campo o con Enter; setProfileName avisa a sus
  // suscriptores (app.js repinta barra + vista, así el "Hola, X" del hero
  // también se actualiza al instante)
  const commitName = () => setProfileName(nameInput.value);
  nameInput.addEventListener('change', commitName);
  nameInput.addEventListener('blur', commitName);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });
  setWrap.appendChild(nameInput);
  container.appendChild(setWrap);

  const footer = document.createElement('p');
  footer.className = 'ql-sidebar-note';
  footer.textContent = t('shell.footer');
  container.appendChild(footer);
}

/** Se suscribe UNA vez (llamar solo al arrancar la app) para repintar la barra lateral cuando cambie el estado. */
export function subscribeShell(container, getRoute) {
  return subscribe(() => renderShell(container, getRoute()));
}
