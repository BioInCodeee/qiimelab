// tests/methodequivalence.mjs — convención de equivalencia científica
// (js/lib/methodEquivalence.js): el registro clasifica cada método en Nivel
// A/B/C según la tabla acordada, el componente de aviso sale solo para B/C,
// y en la app aparece el aviso de Nivel C en cada resultado de ese nivel
// (biomarcadores: KW/LEfSe, ANCOM-BC, Random Forest y la vista de consenso;
// alineamiento progresivo del árbol) y la nota de Nivel B en RDA/CCA,
// PERMANOVA y Neighbor-Joining.
//
//   node tests/methodequivalence.mjs

import { APP_ROOT, findChrome } from './lib/env.mjs';

let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

console.log('--- 1. registro (sin navegador) ---');
{
  const { METHODS, methodLevel, methodNoticeHtml } = await import(APP_ROOT + '/js/lib/methodEquivalence.js');
  const expect = {
    A: ['shannon', 'simpson', 'pearson', 'spearman', 'bh', 'permanova-f'],
    B: ['rda', 'cca', 'upgma', 'permanova'],
    C: ['lefse-like', 'ancombc-like', 'rf-biomarkers'],
  };
  for (const [lvl, ids] of Object.entries(expect)) {
    const wrong = ids.filter((id) => methodLevel(id) !== lvl);
    check(`Nivel ${lvl}: ${ids.join(', ')}`, wrong.length === 0, wrong.join(','));
  }
  check('todo método B/C declara su herramienta de referencia', Object.values(METHODS).filter((m) => m.level !== 'A').every((m) => m.tool));
  check('Nivel A no genera aviso (salvo que se pida)', methodNoticeHtml('shannon') === '' && /data-method-level="A"/.test(methodNoticeHtml('shannon', { withA: true })));
  const c = methodNoticeHtml('ancombc-like');
  check('el aviso de Nivel C nombra la herramienta y dice que no es equivalente', /data-method-level="C"/.test(c) && /ANCOM-BC/.test(c) && /equivalente/.test(c), c.replace(/<[^>]+>/g, ' ').slice(0, 160));
  const mix = methodNoticeHtml(['lefse-like', 'ancombc-like', 'rf-biomarkers', 'rda']);
  check('varios métodos se agrupan en un aviso por nivel', (mix.match(/data-method-level="C"/g) || []).length === 1 && (mix.match(/data-method-level="B"/g) || []).length === 1 && /LEfSe/.test(mix) && /Random Forest/.test(mix));
  check('un id desconocido no genera nada', methodNoticeHtml('no-existe') === '');
}

if (!findChrome()) {
  console.log('\n(sin Chrome: se omite la parte de interfaz)');
  console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
  process.exit(failed ? 1 : 0);
}

console.log('\n--- 2. interfaz ---');
const { ensureServer } = await import('./lib/server.mjs');
const { connect } = await import('./lib/cdp.mjs');
const { sleep } = await import('./lib/app.mjs');
const server = await ensureServer();
const c = await connect({ url: server.url + '/index.html', label: 'methodequivalence' });
const notices = () => c.ev(`[...document.querySelectorAll('#app-view [data-method-level]')].map((n) => n.getAttribute('data-method-level') + ':' + n.textContent.replace(/\\s+/g, ' ').slice(0, 140))`);
const click = (sel, re) => c.ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => ${re}.test(x.textContent)); if (b) b.click(); return !!b; })()`);
try {
  await c.goto(); await sleep(1500);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); })()`);
  await sleep(1500);

  await c.ev(`location.hash = '#/barplots'`); await sleep(1800);
  check('existe la pestaña del panel de taxa candidatos', await click('#app-view .ql-tab', '/Taxa candidatos/'));
  await sleep(2500);
  const kw = await notices();
  check('Kruskal-Wallis (por defecto) → aviso Nivel C "inspirado en LEfSe"', kw.some((n) => /^C:.*LEfSe/.test(n)), JSON.stringify(kw));
  for (const [re, tool] of [['/ANCOM/', 'ANCOM-BC'], ['/Random Forest/', 'Random Forest']]) {
    await click('#app-view .ql-seg-btn', re); await sleep(3000);
    const n = await notices();
    check(`método ${tool} → aviso Nivel C que nombra ${tool}`, n.some((x) => x.startsWith('C:') && x.includes(tool)), JSON.stringify(n));
  }
  await click('#app-view .ql-seg-btn', '/Consenso|Consensus/'); await sleep(3000);
  const cons = await notices();
  check('vista de consenso → un aviso Nivel C con los tres métodos', cons.some((x) => x.startsWith('C:') && /LEfSe/.test(x) && /ANCOM-BC/.test(x) && /Random Forest/.test(x)), JSON.stringify(cons));

  await c.ev(`location.hash = '#/cargar'`); await sleep(300);
  await c.ev(`location.hash = '#/beta'`); await sleep(1800);
  const beta = await notices();
  check('PERMANOVA → nota Nivel B (vegan::adonis2)', beta.some((x) => /^B:.*adonis2/.test(x)), JSON.stringify(beta));
  await click('#app-view .ql-tab, #app-view .ql-seg-btn', '/RDA/'); await sleep(2500);
  const rda = await notices();
  check('RDA → nota Nivel B (vegan::rda)', rda.some((x) => /^B:.*vegan::rda/.test(x)), JSON.stringify(rda));

  await c.ev(`location.hash = '#/arbol'`); await sleep(1500);
  const tree = await notices();
  check('árbol → aviso Nivel C (alineamiento simplificado, MAFFT/MUSCLE) + nota Nivel B (ape::nj)', tree.some((x) => /^C:.*MAFFT/.test(x)) && tree.some((x) => /^B:.*ape::nj/.test(x)), JSON.stringify(tree));

  check('sin errores de consola', c.problems.length === 0, c.problems.join('; '));
} catch (e) {
  console.error('EXCEPCIÓN:', e.message);
  failed = true;
} finally {
  c.kill();
  if (server.started) server.stop();
}
console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
