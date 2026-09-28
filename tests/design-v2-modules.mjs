// tests/design-v2-modules.mjs
// Sistema de diseño v2 módulo a módulo (fase global, 28 sep 2026): recorre
// TODAS las rutas — y las pestañas de cada una — en claro y en oscuro, con
// los datos de ejemplo cargados (también los de árbol, primers y Sanger, que
// van por su cuenta), y en cada vista exige, con tests/lib/v2probe.mjs:
//   · todo el texto visible ≥ 4,5:1 (3:1 si es grande) contra su fondo real
//   · ninguna marca de figura en el azul de marca (tarea 5: la marca no se
//     confunde con una serie de datos porque no va dentro de las figuras)
//   · ni rastro del teal anterior, ni texto de interfaz en IBM Plex (solo
//     las figuras lo conservan)
//   · 0 errores de consola
//
//   node tests/design-v2-modules.mjs

import { findChrome } from './lib/env.mjs';

if (!findChrome()) { console.log('SKIP: sin Chrome'); process.exit(2); }

const { ensureServer } = await import('./lib/server.mjs');
const { connect } = await import('./lib/cdp.mjs');
const { sleep, LOAD_ALL, waitQC } = await import('./lib/app.mjs');
const { V2_PROBE } = await import('./lib/v2probe.mjs');

let failed = 0;
function check(name, ok, detail = '') {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (!ok && detail ? '\n      → ' + detail : ''));
  if (!ok) failed++;
}

// ruta → { antes: textos de botón a pulsar una vez (datos de ejemplo propios),
//          tabs: pestañas/segmentos a recorrer }
const ROUTES = {
  '#/': {}, '#/cargar': {}, '#/qc': {},
  '#/barplots': { tabs: ['Flujos', 'Sunburst', 'Taxa candidatos', 'Random Forest', 'Consenso', 'Barras'] },
  '#/alfa': { tabs: ['rarefac', 'Boxplot'] },
  '#/beta': { tabs: ['PCoA', 'RDA/CCA', 'Mapa de calor'] },
  '#/temporal': {}, '#/venn': {},
  '#/correlograma': { tabs: ['Red', 'Matriz', 'Circular', 'Burbujas', 'Sectores'] },
  '#/diferencial': { tabs: ['Comparar', 'Lollipop', 'calor', 'Cajas', 'Volcano'] },
  '#/funcional': {},
  '#/inferencia': { tabs: ['Lollipop', 'Matriz de Funciones', 'Barras Apiladas'] },
  '#/validacion': {},
  '#/recuentos': { tabs: ['Coliformes', 'Aerobios'] },
  '#/calculadora': { tabs: ['Molaridad', 'Diluciones', 'Master Mix', 'Peso Molecular'] },
  '#/primers': { antes: ['Cargar ejemplo'], tabs: ['Diseño', 'Dímeros', 'Plantilla', 'Cobertura', 'Lote', 'Primers'] },
  '#/arbol': { antes: ['Cargar ejemplo'], tabs: ['Circular', 'Sunburst', 'Rectangular'] },
  '#/sanger': { antes: ['Cargar ejemplo (muestra limpia'], tabs: ['Cromatograma', 'Resultados', 'Entrada'] },
  '#/informe?generar': {}, '#/recursos': {}, '#/glosario': {},
};
const click = (txt) => `(() => { const b = [...document.querySelectorAll('#app-view button, #app-view .ql-tab, #app-view .ql-seg-btn, #app-view [role="tab"]')].find((x) => x.textContent.trim().includes(${JSON.stringify(txt)}) && x.getClientRects().length); if (b) b.click(); return !!b; })()`;

const server = await ensureServer();
for (const theme of ['light', 'dark']) {
  const T = theme === 'light' ? 'claro' : 'oscuro';
  console.log(`\n--- ${T} ---`);
  const c = await connect({ theme, url: server.url + '/index.html', label: 'v2-modules-' + theme });
  try {
    await c.goto(); await sleep(1500);
    await c.ev(LOAD_ALL); await sleep(2500);
    await waitQC(c);
    let views = 0;
    for (const [route, cfg] of Object.entries(ROUTES)) {
      c.setLabel(route + ' (' + T + ')');
      await c.ev(`location.hash = ${JSON.stringify(route)}`); await sleep(2200);
      for (const b of cfg.antes || []) { await c.ev(click(b)); await sleep(5000); }
      for (const tab of [null, ...(cfg.tabs || [])]) {
        if (tab && !(await c.ev(click(tab)))) continue;
        if (tab) await sleep(1600);
        const o = await c.ev(V2_PROBE);
        views++;
        const bad = [...o.lowText.map((x) => 'contraste: ' + x), ...o.accentInChart.map((x) => 'marca en figura: ' + x),
          ...o.teal.map((x) => 'teal: ' + x), ...o.plexUI.map((x) => 'IBM Plex en interfaz: ' + x)];
        check(`${T} ${route}${tab ? ' [' + tab + ']' : ''} (${o.nText} textos)`, bad.length === 0, bad.slice(0, 6).join('\n      → '));
      }
    }
    check(`${T}: se revisaron las ${Object.keys(ROUTES).length} rutas (${views} vistas)`, views >= 50, String(views));
    check(`${T}: 0 errores de consola`, c.problems.length === 0, c.problems.slice(0, 3).join(' | '));
  } catch (e) {
    check(`${T}: sin excepciones`, false, e.stack || String(e));
  } finally {
    c.kill();
  }
}
if (server.started) server.stop();

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
