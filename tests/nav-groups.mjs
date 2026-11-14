// tests/nav-groups.mjs — el recorrido de la navegación (shell.js GROUPS/ROUTES).
//
// La agrupación se rehízo en 5 secciones numeradas —1 datos → 2 comunidad →
// 3 molecular → 4 laboratorio → 5 resultados, más «Recursos» sin número porque
// no es un paso del análisis— para que se vea el orden sin tener que conocer de
// antemano el nombre de cada módulo.
//
// Lo que este test protege es la condición con la que se hizo: **ninguna ruta
// cambia de hash**. Reagrupar es solo visual; si un día alguien mueve un módulo
// de sección y de paso le cambia el `id`, se rompen marcadores, los enlaces del
// informe y los botones de datos de ejemplo. Aquí se comprueban los 22 hashes
// uno a uno, y que la home (que deriva su agrupación de ROUTES, no de una lista
// paralela) muestra los mismos rótulos que el menú.
//
//   node tests/nav-groups.mjs

import { findChrome } from './lib/env.mjs';

let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  \u2713 ' : '  \u2717 ') + name + (extra ? '  ' + extra : ''));
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
const c = await connect({ url: server.url + '/index.html', label: 'nav-groups' });

try {
  await c.goto(); await sleep(1800);
  const nav = await c.ev(`(() => {
    const groups=[...document.querySelectorAll('.ql-nav')].map(n=>{
      const lab=n.querySelector('.ql-nav-group-label');
      return { label: lab?lab.textContent.trim():null,
               step: lab&&lab.querySelector('.ql-nav-step')?lab.querySelector('.ql-nav-step').textContent:null,
               items: [...n.querySelectorAll('.ql-nav-item')].map(a=>a.getAttribute('href')) };
    }).filter(g=>g.items.length);
    return groups;
  })()`);
  nav.forEach(g=>console.log('   '+(g.step||'-')+' '+String(g.label||'(sin rótulo)').padEnd(38)+g.items.join(' ')));
  const steps = nav.filter(g=>g.step).map(g=>g.step);
  check('5 secciones numeradas, en orden 1-5', steps.join(',')==='1,2,3,4,5', steps.join(','));
  check('«Recursos» sin número', nav.some(g=>g.label&&/Recursos/.test(g.label)&&!g.step));
  const hrefs = nav.flatMap(g=>g.items);
  check('las 22 rutas siguen presentes en el menú', hrefs.length===22, String(hrefs.length));
  // ninguna ruta puede haber cambiado de hash
  const esperadas = ['#/','#/cargar','#/qc','#/validacion','#/barplots','#/alfa','#/beta','#/temporal','#/venn',
    '#/correlograma','#/arbolcalor','#/funcional','#/arbol','#/primers','#/sanger','#/recuentos','#/calculadora',
    '#/diferencial','#/inferencia','#/informe','#/recursos','#/glosario'];
  const faltan = esperadas.filter(h=>!hrefs.includes(h));
  check('ningún hash ha cambiado', faltan.length===0, faltan.join(' '));
  // la home debe reflejar el mismo agrupamiento (deriva de ROUTES)
  const homeGroups = await c.ev(`[...document.querySelectorAll('#app-view .ql-home-group .ql-modgroup-title strong')].map(e=>e.textContent.trim())`);
  console.log('   home:', homeGroups.join(' | '));
  check('la home usa los mismos rótulos que el menú',
     homeGroups.every(h=>nav.some(g=>g.label&&g.label.includes(h))), homeGroups.join(' | '));
  // navegar a una ruta de cada sección y comprobar que carga
  for (const h of ['#/validacion','#/temporal','#/sanger','#/calculadora','#/inferencia']) {
    await c.ev(`location.hash='${h}'`); await sleep(1100);
    const okr = await c.ev(`!!document.querySelector('#app-view .ql-page-title, #app-view h1')`);
    check('carga '+h, okr===true);
  }
  check('sin errores de consola', c.problems.length===0, c.problems.join('; '));
} finally { await c.close?.(); }
console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
