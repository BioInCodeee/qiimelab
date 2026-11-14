// tests/permdisp-ui.mjs — la sección de PERMDISP de #/beta, en el navegador
// y con los datos de ejemplo reales cargados.
//
// Lo que cubre, y por qué cada cosa:
//   - la tabla, la lectura conjunta PERMANOVA + PERMDISP y el aviso de que la
//     dispersión se mide al CENTROIDE (no a la mediana espacial de vegan);
//   - que el boxplot de dispersión se dibuja ADEMÁS del gráfico de la vista:
//     los dos viven en la misma pasada de paint(), y cada uno tiene su propio
//     editor de figuras (`editor` y `dispEditor`) justo para eso;
//   - que ese boxplot NO lleva llaves de significación. Es el punto que más
//     importa de todo este archivo: pintarlas supondría enseñar un
//     Kruskal-Wallis/Dunn sobre unas distancias al centroide que no son
//     independientes (salen de centroides estimados con los mismos datos),
//     es decir un contraste distinto del que dice la tabla de arriba.
//
//   node tests/permdisp-ui.mjs

import { findChrome } from './lib/env.mjs';

let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed = true;
};

if (!findChrome()) {
  console.log('SKIP: no hay Chrome local');
  process.exit(2);
}

const { ensureServer } = await import('./lib/server.mjs');
const { connect } = await import('./lib/cdp.mjs');
const { sleep } = await import('./lib/app.mjs');
const server = await ensureServer();
const c = await connect({ url: server.url + '/index.html', label: 'permdisp-ui' });

try {
  await c.goto(); await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); })()`);
  await sleep(1500);
  await c.ev(`location.hash = '#/beta'`); await sleep(3000);

  console.log('--- 1. tabla y textos ---');
  const txt = await c.ev(`document.querySelector('#app-view').textContent.replace(/\\s+/g,' ')`);
  check('aparece la sección de PERMDISP', /PERMDISP/.test(txt));
  check('aparece la dispersión media por grupo', /Distancia media al centroide/.test(txt));
  check('aparece la lectura conjunta PERMANOVA + PERMDISP', /Lectura conjunta/.test(txt));
  check('declara que mide al centroide, no a la mediana espacial', /type = "centroid"/.test(txt));

  console.log('--- 2. aviso de equivalencia ---');
  const notices = await c.ev(`[...document.querySelectorAll('#app-view [data-method-level]')].map((n) => n.getAttribute('data-method-level') + ':' + n.textContent.replace(/\\s+/g, ' ').slice(0, 120))`);
  check('PERMDISP declara Nivel B frente a vegan::betadisper',
    notices.some((n) => /^B:.*betadisper/.test(n)), JSON.stringify(notices));

  console.log('--- 3. boxplot de dispersión ---');
  const nSvg = await c.ev(`document.querySelectorAll('#app-view .ql-chartwrap svg.ql-svg').length`);
  check('convive con el gráfico de la vista: 2 figuras (' + nSvg + ')', nSvg >= 2);

  const last = await c.ev(`(() => {
    const svgs = [...document.querySelectorAll('#app-view svg.ql-svg')];
    const el = svgs[svgs.length - 1];
    return {
      title: (el.querySelector('.ce-title') || {}).textContent || '',
      rects: el.querySelectorAll('rect').length,
      points: el.querySelectorAll('circle').length,
      sig: el.querySelectorAll('[data-ce="sig"] *').length,
    };
  })()`);
  check('la última figura es la de dispersión: "' + last.title + '"', /Dispersi/.test(last.title));
  check('dibuja cajas (' + last.rects + ' rects)', last.rects > 0);
  check('dibuja un punto por muestra (' + last.points + ' circles)', last.points > 0);
  check('NO lleva llaves de significación (' + last.sig + ' elementos en [data-ce="sig"])', last.sig === 0);

  console.log('--- 4. consola ---');
  check('sin errores de consola', c.problems.length === 0, c.problems.join('; '));
} finally {
  await c.close?.();
}

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
