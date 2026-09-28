// tests/venn-sets.mjs — #/venn con muchos conjuntos (Fase 3, C1): el ejemplo
// sintético de 10 grupos, el control "Conjuntos a mostrar" y que CADA región
// de la tabla sea la intersección exacta de los conjuntos elegidos
// (comparado con un cálculo independiente sobre el estado), para K = 10, 6,
// 4 y 3; con 5+ → UpSet (color neutro por encima de 7 conjuntos), con 4 →
// rectángulos por defecto, con 3 → círculos.
//
//   node tests/venn-sets.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'venn-sets' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

const INDEP = (K) => `(async () => {
  const { state } = await import('/js/state.js');
  const tc = state.taxaCounts, md = state.metadata;
  const grp = {}; md.rows.forEach((r) => { grp[r['sample-id']] = r.sitio; });
  const groups = [...new Set(Object.values(grp))].sort().slice(0, ${K});
  const counts = {};
  tc.rows.forEach((row) => {
    const inG = groups.filter((g) => tc.headers.slice(1).some((s) => grp[s] === g && Number(row[s]) > 0));
    if (!inG.length) return;
    const k = inG.join(' ∩ '); counts[k] = (counts[k] || 0) + 1;
  });
  return counts;
})()`;
const APP = `[...document.querySelectorAll('#app-view .ql-table tbody tr')].filter((tr) => tr.children.length === 3).reduce((o, tr) => { o[tr.children[0].textContent] = Number(tr.children[2].textContent); return o; }, {})`;
const KIND = `(() => { const svg = document.querySelector('#app-view .ql-chartwrap svg'); return { upset: !!svg && /UpSet/i.test(svg.getAttribute('aria-label') || ''), rects: svg ? svg.querySelectorAll('rect[data-ce-series-fill]').length : 0, rounds: svg ? svg.querySelectorAll('circle[data-ce-series-fill], ellipse[data-ce-series-fill]').length : 0, fills: svg ? [...new Set([...svg.querySelectorAll('[data-ce-series-fill]')].map((e) => e.getAttribute('fill')))] : [] }; })()`;

try {
  await c.goto(server.url + '/index.html#/venn'); await sleep(2000);
  check('el estado vacío de #/venn ofrece el ejemplo sintético con 10 grupos', await c.ev(`(() => { const b = document.querySelector('.ql-venn-ten'); if (b) b.click(); return !!b; })()`));
  await sleep(1500);
  check('...que carga 10 conjuntos y el control "Conjuntos a mostrar" (máx. 10)', await c.ev(`(() => { const i = document.querySelector('#vnSets'); return !!i && i.max === '10' && i.value === '10'; })()`));
  for (const [K, expect] of [[10, 'upset-neutral'], [6, 'upset'], [4, 'rect'], [3, 'round']]) {
    await c.ev(`(() => { const i = document.querySelector('#vnSets'); i.value = '${K}'; i.dispatchEvent(new Event('change')); })()`); await sleep(1200);
    const app = await c.ev(APP), ind = await c.ev(INDEP(K));
    const keys = new Set([...Object.keys(app), ...Object.keys(ind)]);
    const diff = [...keys].filter((k) => app[k] !== ind[k]);
    check(`K=${K}: las ${Object.keys(ind).length} regiones son las intersecciones exactas (cálculo independiente)`, diff.length === 0 && Object.keys(app).length > 0, diff.slice(0, 3).join(' | '));
    const kind = await c.ev(KIND);
    const ok = expect === 'upset-neutral' ? kind.upset && kind.fills.length === 1 && kind.fills[0] === 'var(--ink-2)'
      : expect === 'upset' ? kind.upset && kind.fills.length === K
        : expect === 'rect' ? !kind.upset && kind.rects === 4
          : !kind.upset && kind.rounds === 3;
    check(`K=${K}: vista ${expect}`, ok, JSON.stringify(kind));
  }
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
