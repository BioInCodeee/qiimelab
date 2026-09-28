// tests/correlogram-pie-split.mjs — #/correlograma, vista Matriz (Fase 3, C2):
// glifo "Sectores" (ángulo = |r|·360°, horario si r>0, antihorario si r<0),
// comparado sector a sector con la tabla de parejas; y matriz "Partida"
// (▲ superior = método elegido, ▼ inferior = el otro), comprobando con el
// tooltip de una celda y su simétrica que cada triángulo trae su método y
// cuadra con las dos columnas r de la tabla. Burbujas y Red siguen dibujando.
//
//   node tests/correlogram-pie-split.mjs

import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, skip } from './lib/env.mjs';
import { sleep, LOAD_ALL } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const c = await connect({ url: server.url + '/index.html', label: 'correlogram-pie-split' });
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };
const click = (re) => c.ev(`(() => { const b = [...document.querySelectorAll('#app-view .ql-seg-btn, #app-view .ql-tab')].find((x) => ${re}.test(x.textContent)); if (b) b.click(); return !!b; })()`);

try {
  await c.goto(); await sleep(1500);
  await c.ev(LOAD_ALL); await sleep(1000);
  await c.ev(`location.hash = '#/correlograma'`); await sleep(2500);
  await click('/^Matriz/'); await sleep(1200);
  check('"Forma del gráfico" ofrece "Sectores"', await click('/^Sectores$/'));
  await sleep(1500);
  const pie = await c.ev(`(() => {
    const svg = document.querySelector('#app-view svg.ql-svg');
    const labels = [...svg.querySelectorAll('[data-ce="rowlabels"] text')].map((t) => t.textContent);
    const tab = {};
    [...document.querySelectorAll('#app-view .ql-table tbody tr')].forEach((tr) => { const td = tr.children; const r = parseFloat(td[2].textContent); tab[td[0].textContent + '|' + td[1].textContent] = r; tab[td[1].textContent + '|' + td[0].textContent] = r; });
    const rects = [...svg.querySelectorAll('rect[data-i]')];
    let checked = 0, bad = 0;
    for (const p of svg.querySelectorAll('path.ql-corr-pie')) {
      const m = p.getAttribute('d').match(/M([\\d.]+),([\\d.]+) L[\\d.]+,[\\d.]+ A([\\d.]+),[\\d.]+ 0 [01] ([01]) ([\\d.-]+),([\\d.-]+)/);
      const cx = +m[1], cy = +m[2], R = +m[3], sweep = +m[4], ex = +m[5], ey = +m[6];
      const rect = rects.find((r) => { const x = +r.getAttribute('x'), y = +r.getAttribute('y'), w = +r.getAttribute('width'); return cx > x && cx < x + w && cy > y && cy < y + w; });
      const r = tab[labels[+rect.dataset.i] + '|' + labels[+rect.dataset.j]];
      const a = Math.abs(r) * 2 * Math.PI, dir = r >= 0 ? 1 : -1;
      checked++;
      if (Math.hypot(cx + dir * R * Math.sin(a) - ex, cy - R * Math.cos(a) - ey) > 0.6 || (r >= 0) !== (sweep === 1)) bad++;
    }
    return { checked, bad };
  })()`);
  check(`cada sector barre |r|·360° en el sentido de su signo (${pie.checked} sectores vs la tabla)`, pie.checked > 10 && pie.bad === 0, JSON.stringify(pie));

  check('"Matriz" ofrece "Partida"', await click('/^Partida/'));
  await sleep(1500);
  await click('/^Mapa de calor$/'); await sleep(1500);
  const split = await c.ev(`(async () => {
    const svg = document.querySelector('#app-view svg.ql-svg');
    const labels = [...svg.querySelectorAll('[data-ce="rowlabels"] text')].map((t) => t.textContent);
    const head = [...document.querySelectorAll('#app-view .ql-table thead th')].map((t) => t.textContent);
    const td = document.querySelector('#app-view .ql-table tbody tr').children;
    const ia = labels.indexOf(td[0].textContent), ib = labels.indexOf(td[1].textContent);
    const rA = td[2].textContent.trim().split(' ')[0], rB = td[5].textContent.trim();
    const up = svg.querySelector('rect[data-i="' + Math.min(ia, ib) + '"][data-j="' + Math.max(ia, ib) + '"]');
    const lo = svg.querySelector('rect[data-i="' + Math.max(ia, ib) + '"][data-j="' + Math.min(ia, ib) + '"]');
    const tip = async (el) => { el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await new Promise((r) => setTimeout(r, 150)); const t = document.querySelector('.ql-tooltip'); return t ? t.textContent : ''; };
    return { head, rA, rB, tipUp: await tip(up), tipLo: await tip(lo), legend: (svg.querySelector('[data-ce="splitlegend"]') || {}).textContent || '' };
  })()`);
  check('la tabla trae r de los dos métodos', split.head.includes('r (Pearson)') && split.head.includes('r (Spearman)'), JSON.stringify(split.head));
  check('celda superior = Pearson (mismo r que la tabla)', split.tipUp.includes('Pearson: r = ' + split.rA), split.tipUp);
  check('celda simétrica inferior = Spearman (mismo r que la tabla)', split.tipLo.includes('Spearman: r = ' + split.rB), split.tipLo);
  check('la figura rotula qué método lleva cada triángulo', /▲.*Pearson.*▼.*Spearman/.test(split.legend), split.legend);

  await click('/^Burbujas$/'); await sleep(1200);
  check('Burbujas sigue dibujando', await c.ev(`document.querySelectorAll('#app-view svg.ql-svg circle[data-ce-series-fill]').length > 5`));
  await click('/^Red/'); await sleep(1500);
  check('Red sigue dibujando', await c.ev(`document.querySelectorAll('#app-view svg circle').length > 3`));
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
