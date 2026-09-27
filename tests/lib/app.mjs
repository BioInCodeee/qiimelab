// Piezas compartidas por los tests de navegador: rutas, carga de ejemplos,
// recorrido de subvistas y la sonda de accesibilidad.

import { setTimeout as sleep } from 'node:timers/promises';

export { sleep };

// 19 rutas de módulo (#/…#/validacion) + la subvista "Red" del correlograma = 20.
export const ROUTES = ['#/', '#/cargar', '#/barplots', '#/alfa', '#/beta', '#/diferencial',
  '#/recuentos', '#/ufc', '#/primers', '#/arbol', '#/sanger', '#/venn', '#/correlograma', '#/funcional', '#/qc', '#/informe',
  '#/recursos', '#/glosario', '#/validacion'];

// carga TODOS los ejemplos reales (+ conteos sintéticos + 3 comparaciones + 2 recuentos)
export const LOAD_ALL = `(async () => {
  const m = await import('/js/lib/exampleData.js');
  await m.loadRealCommunityData();
  await m.loadRealDifferentialAbundance();
  await m.loadRealFunctionalWithMeta();
  await m.loadRealSequenceQC();
  m.loadExampleCounts && m.loadExampleCounts();
  if (m.loadRealDiffComparisons) await m.loadRealDiffComparisons();
  if (m.loadExampleMicrobialCountsPlate) await m.loadExampleMicrobialCountsPlate();
  if (m.loadExampleMicrobialCountsMPN) await m.loadExampleMicrobialCountsMPN();
})()`;

export async function waitQC(c) {
  await c.ev("location.hash = '#/qc'");
  await sleep(600);
  for (let i = 0; i < 40; i++) {
    const done = await c.ev(`(async () => { const { state } = await import('/js/state.js'); return state.sequenceQC.filter(e => e.report).length; })()`);
    if (done >= 2) break;
    await sleep(400);
  }
}

// pestañas .ql-tab / .ql-seg-btn a recorrer por ruta
const TABS_FOR = {
  '#/alfa': ['rarefac', 'Boxplot'],
  '#/beta': ['PCoA', 'RDA/CCA', 'Mapa de calor'],
  '#/barplots': ['Taxa candidatos', 'Random Forest', 'Consenso', 'Barplot'],
  '#/diferencial': ['Comparar', 'Lollipop', 'calor', 'Volcano', 'Individual'],
  '#/correlograma': ['Red', 'Matriz'],
  '#/recuentos': ['Coliformes', 'Aerobios'],
  '#/primers': ['Diseño', 'Dímeros', 'Plantilla', 'Cobertura', 'Lote', 'Primers'],
  '#/sanger': ['Cromatograma', 'Resultados', 'Entrada'],
};

export async function walkRoute(c, route, { report = false, onInfo = () => {} } = {}) {
  await c.ev(`location.hash = ${JSON.stringify(route)}`);
  await sleep(1500);
  await c.ev(`document.querySelectorAll('details').forEach(d => d.open = true)`);
  await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Personalizar|Customise/.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(350);
  for (const frag of (TABS_FOR[route] || [])) {
    await c.ev(`(() => { const b = [...document.querySelectorAll('.ql-tab, .ql-seg-btn')].find(x => x.textContent.indexOf(${JSON.stringify(frag)}) > -1); if (b) b.click(); })()`);
    await sleep(600);
  }
  if (route === '#/correlograma') {
    await c.ev(`(() => { const n = document.querySelector('#clR'); if (n) { n.value = '0.1'; n.dispatchEvent(new Event('change')); } })()`);
    await sleep(400);
  }
  if (route === '#/ufc') {
    // rellenar una fila y probar el envío a #/recuentos como serie nueva
    await c.ev(`(() => {
      const tr = document.querySelector('.ql-ufc-table tbody tr');
      if (!tr) return;
      const inputs = tr.querySelectorAll('input');
      inputs[0].value = 'sweep'; inputs[0].dispatchEvent(new Event('change'));
      inputs[1].value = '100'; inputs[1].dispatchEvent(new Event('change'));
      inputs[2].value = '3'; inputs[2].dispatchEvent(new Event('change'));
    })()`);
    await sleep(300);
    await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Enviar a Recuentos/.test(x.textContent)); if (b) b.click(); })()`);
    await sleep(300);
  }
  if (route === '#/barplots') {
    // orientación horizontal del barplot apilado — mismos datos, otra proyección
    await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Horizontal'); if (b) b.click(); })()`);
    await sleep(400);
  }
  if (route === '#/arbol') {
    // módulo autónomo (localStorage, no LOAD_ALL): carga su propio ejemplo y
    // espera a que termine el pipeline async (alineamiento + NJ) antes de
    // probar "Personalizar" sobre el árbol ya dibujado.
    await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Cargar ejemplo|Load example/.test(x.textContent)); if (b) b.click(); })()`);
    await sleep(500);
    for (let i = 0; i < 60; i++) {
      if (await c.ev(`document.querySelectorAll('.ql-svg .ql-baseline-line').length > 0`)) break;
      await sleep(400);
    }
    await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Personalizar|Customise/.test(x.textContent)); if (b) b.click(); })()`);
    await sleep(350);
    // layout circular: mismo árbol, proyección polar — probarlo también
    await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Circular'); if (b) b.click(); })()`);
    await sleep(400);
  }
  if (route === '#/sanger') {
    // módulo autónomo (localStorage): el bucle de pestañas de arriba ya deja
    // la vista en "Entrada" (última de TABS_FOR) — ahí vive el botón de
    // ejemplo. Carga el par B13 (limpio), espera el pipeline async (fetch de
    // 2 .ab1 + parseo + recorte + solapamiento) y visita cromatograma (con
    // traza real ya dibujada) y resultados (con la fila ya calculada).
    await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /muestra limpia|clean sample/i.test(x.textContent)); if (b) b.click(); })()`);
    for (let i = 0; i < 40; i++) {
      if (await c.ev(`document.querySelectorAll('.ql-table tbody tr').length > 0`)) break;
      await sleep(300);
    }
    await c.ev(`(() => { const b = [...document.querySelectorAll('.ql-tab')].find(x => /Cromatograma|Chromatogram/i.test(x.textContent)); if (b) b.click(); })()`);
    for (let i = 0; i < 30; i++) {
      if (await c.ev(`document.querySelectorAll('svg.ql-svg polyline').length > 0`)) break;
      await sleep(300);
    }
    await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Personalizar|Customise/.test(x.textContent)); if (b) b.click(); })()`);
    await sleep(300);
    await c.ev(`(() => { const b = [...document.querySelectorAll('.ql-tab')].find(x => /Resultados|Results/i.test(x.textContent)); if (b) b.click(); })()`);
    await sleep(400);
    await c.ev(`(() => { const tr = document.querySelector('.ql-table tbody tr'); if (tr) tr.click(); })()`);
    await sleep(300);
  }
  if (route === '#/venn') {
    // forma de rectángulos (alternativa a los círculos, exacta con 4 conjuntos)
    await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Rectángulos'); if (b) b.click(); })()`);
    await sleep(400);
  }
  if (route === '#/glosario') {
    // esperar a que el módulo termine de pintar las entradas (bajo carga puede tardar)
    for (let i = 0; i < 25; i++) {
      if (await c.ev(`document.querySelectorAll('.ql-glossary-entry').length`) >= 20) break;
      await sleep(200);
    }
    // el <details> ya lo abre la línea de arriba; aquí comprobamos el filtro.
    // Los fallos van por console.error → los recoge c.problems, como el resto.
    await c.ev(`(() => {
      const bad = (m) => console.error('glosario: ' + m);
      const input = document.querySelector('#glosFilter');
      const entries = [...document.querySelectorAll('.ql-glossary-entry')];
      const groups = [...document.querySelectorAll('.ql-glossary-group')];
      if (!input || entries.length < 20) return bad('filtro o entradas ausentes (' + entries.length + ')');
      if (!entries.every((d) => d.querySelector('summary') && d.querySelector('.ql-fmt-body p') && d.querySelector('.ql-fmt-body p').textContent.trim().length > 20)) {
        bad('algún <details> sin summary o con una definición vacía/sin resolver');
      }
      input.value = 'bray-curtis'; input.dispatchEvent(new Event('input'));
      const vis = entries.filter((d) => !d.hidden);
      if (vis.length !== 1 || vis[0].id !== 'glos-bray') bad('filtro "bray-curtis" muestra ' + vis.length + ' [' + vis.map((d) => d.id) + ']');
      if (groups.filter((s) => !s.hidden).length !== 1) bad('el filtro no oculta los grupos vacíos');
      input.value = 'xyzzy-nada'; input.dispatchEvent(new Event('input'));
      if (entries.some((d) => !d.hidden)) bad('un filtro sin coincidencias deja entradas visibles');
      input.value = ''; input.dispatchEvent(new Event('input'));
      if (entries.filter((d) => !d.hidden).length !== entries.length) bad('limpiar el filtro no restaura todo');
    })()`);
    await sleep(200);
  }
  if (route === '#/informe' && report) {
    await c.ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.indexOf('Generar') > -1 || x.textContent.indexOf('Generate') > -1); if (b) b.click(); })()`);
    await sleep(6000);
    const secs = await c.ev(`document.querySelectorAll('.ql-report-section').length`);
    onInfo(`#/informe → ${secs} secciones`);
  }
  if (route === '#/validacion') {
    // la página autocomprueba stats.js contra R en vivo: si alguna fila falla,
    // es una regresión numérica → que lo pille el barrido.
    await c.ev(`(async () => {
      const { runValidation } = await import('/js/lib/statsValidation.js');
      const r = runValidation();
      const failed = r.filter((x) => !x.pass);
      if (failed.length) console.error('validacion: ' + failed.map((x) => x.key + (x.error ? ' (' + x.error + ')' : ' rel=' + x.maxRelErr.toExponential(1))).join(', '));
      const dom = document.querySelectorAll('.ql-table tbody tr').length;
      if (dom !== r.length) console.error('validacion: la tabla pinta ' + dom + ' filas, esperaba ' + r.length);
    })()`);
    await sleep(150);
  }
}

// heurísticas de accesibilidad — devuelve una lista de problemas (vacía = ok)
export const A11Y_PROBE = `(() => {
  const bad = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const accName = (el) => (
    (el.getAttribute('aria-label') || '').trim() ||
    (el.getAttribute('title') || '').trim() ||
    (el.textContent || '').trim() ||
    (el.querySelector('img[alt]') ? el.querySelector('img[alt]').getAttribute('alt').trim() : '') ||
    (el.getAttribute('aria-labelledby') ? 'labelledby' : '')
  );
  document.querySelectorAll('button, a[href]').forEach((el) => {
    if (!vis(el)) return;
    if (!accName(el)) bad.push('boton/enlace sin nombre: <' + el.tagName.toLowerCase() + (el.className ? ' class="' + el.className + '"' : '') + '>');
  });
  document.querySelectorAll('input, select, textarea').forEach((el) => {
    if (el.type === 'hidden' || !vis(el)) return;
    const byId = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    const wrap = el.closest('label');
    const al = (el.getAttribute('aria-label') || '').trim();
    const alb = el.getAttribute('aria-labelledby');
    if (!byId && !wrap && !al && !alb) bad.push('input sin etiqueta: ' + (el.name || el.id || el.type || el.className));
  });
  document.querySelectorAll('svg[role="img"]').forEach((el) => {
    if (!(el.getAttribute('aria-label') || '').trim() && !el.getAttribute('aria-labelledby')) bad.push('svg[role=img] sin aria-label');
  });
  // un slider en el DOM y con caja pero de ancho ~0 es un control invisible (visto: el ancho
  // de input[type=number] de base.css aplastaba a los sliders vecinos dentro de .ql-inputrow)
  document.querySelectorAll('input[type="range"]').forEach((el) => {
    if (el.getClientRects().length && el.getBoundingClientRect().width < 40) {
      bad.push('slider colapsado (' + Math.round(el.getBoundingClientRect().width) + 'px): ' + (el.id || el.className));
    }
  });
  const mains = document.querySelectorAll('main');
  if (mains.length !== 1) bad.push('nº de <main> = ' + mains.length);
  if (mains[0] && mains[0].getAttribute('tabindex') !== '-1') bad.push('<main> sin tabindex=-1');
  const skip = document.querySelector('a.ql-skip-link');
  if (!skip) bad.push('sin enlace "saltar al contenido"');
  else if (skip.getAttribute('href') !== '#app-view') bad.push('skip-link con destino incorrecto');
  document.querySelectorAll('nav').forEach((n) => {
    if (!(n.getAttribute('aria-label') || '').trim() && !n.getAttribute('aria-labelledby')) bad.push('<nav> sin aria-label');
  });
  const active = document.querySelector('.ql-nav-item.is-active');
  if (active && active.getAttribute('aria-current') !== 'page') bad.push('enlace de navegación activo sin aria-current');
  return bad;
})()`;
