// tests/rscript-export.mjs — "Descargar script R" (js/lib/rScript.js +
// rScriptBuilders.js) de punta a punta, en la app real y en el R real:
//
//   1. carga el ejemplo real, entra en cada módulo de Nivel A/B (alfa,
//      PERMANOVA, RDA, CCA, correlograma Pearson/Spearman, árbol NJ con p y
//      JC69), pulsa el botón y recoge el .R que descarga el navegador;
//   2. lo ejecuta TAL CUAL con `Rscript archivo.R` (tiene que correr sin
//      error, incluidos los gráficos), y después con source() para leer sus
//      objetos de resultado;
//   3. compara esos números con los que muestra la página (tablas, textos
//      del cuadro de estadística) y, donde la página redondea, también con
//      el cálculo de la propia app a precisión completa.
//
//   node tests/rscript-export.mjs
//   SAVE_DIR=/ruta node tests/rscript-export.mjs   → además guarda los .R descargados

import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureServer } from './lib/server.mjs';
import { connect } from './lib/cdp.mjs';
import { findChrome, hasR, hasRPackage, skip } from './lib/env.mjs';
import { sleep } from './lib/app.mjs';

if (!findChrome()) skip('no se encontró Chrome/Chromium');
if (!hasR()) skip('no hay Rscript');
for (const p of ['vegan', 'ape', 'jsonlite']) if (!hasRPackage(p)) skip('falta el paquete de R ' + p);
const server = await ensureServer();
if (!server) skip('no se pudo servir la app (¿python3?)');

const WORK = mkdtempSync(join(tmpdir(), 'smart175-rscript-'));
let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };
const arr = (v) => (Array.isArray(v) ? v : [v]);
const close = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

/** Ejecuta el script tal cual (debe terminar sin error) y luego lo carga con
 *  source() para devolver en JSON las expresiones pedidas. */
function runR(name, script, exprs) {
  const dir = join(WORK, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'script.R');
  writeFileSync(file, script);
  if (process.env.SAVE_DIR) { mkdirSync(process.env.SAVE_DIR, { recursive: true }); writeFileSync(join(process.env.SAVE_DIR, name + '.R'), script); }
  let plainOk = true, err = '';
  try {
    execFileSync('Rscript', ['script.R'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  } catch (e) { plainOk = false; err = String(e.stderr || e.message).slice(-600); }
  check(name + ': el script descargado corre en R sin errores', plainOk, err);
  const probe = 'invisible(capture.output(source("script.R", chdir = TRUE)))\n' +
    'writeLines(enc2utf8(as.character(jsonlite::toJSON(list(' + Object.entries(exprs).map(([k, v]) => k + ' = ' + v).join(', ') + '), digits = NA, na = "null", auto_unbox = TRUE))), "out.json", useBytes = TRUE)';
  writeFileSync(join(dir, 'probe.R'), probe);
  execFileSync('Rscript', ['probe.R'], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'], maxBuffer: 64 << 20 });
  return JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
}

const c = await connect({ url: server.url + '/index.html', label: 'rscript-export' });
const clickSeg = (re) => c.ev(`(() => { const b = [...document.querySelectorAll('#app-view .ql-seg-btn, #app-view .ql-tab')].find((x) => ${re}.test(x.textContent.trim())); if (b) b.click(); return !!b; })()`);
const setSelect = (labelRe, value) => c.ev(`(() => {
  const f = [...document.querySelectorAll('#app-view .ql-field')].find((x) => { const l = x.querySelector('label'); return l && ${labelRe}.test(l.textContent); });
  const s = f && f.querySelector('select'); if (!s) return false;
  s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change')); return s.value === ${JSON.stringify(value)};
})()`);
/** Pulsa el botón de script R que haya dentro de `scope` y devuelve el texto descargado. */
async function download(scope = '#app-view') {
  const n0 = await c.ev('window.__dl.length');
  const ok = await c.ev(`(() => { const b = document.querySelector(${JSON.stringify(scope + ' .ql-rscript-btn')}); if (b) b.click(); return !!b; })()`);
  if (!ok) return null;
  await sleep(200);
  return c.ev(`(async () => { if (window.__dl.length <= ${n0}) return null; return await window.__dl[window.__dl.length - 1].text(); })()`);
}

try {
  await c.setViewport(1400, 1800);
  await c.goto(); await sleep(1500);
  await c.ev(`(() => { window.__dl = []; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__dl.push(b); return o(b); }; })()`);
  await c.ev(`(async () => { const m = await import('/js/lib/exampleData.js'); await m.loadRealCommunityData(); })()`);
  await sleep(800);

  // ================================================================ ALFA ==
  // la app: valores por muestra + test elegido + p por pareja (Holm por defecto)
  const APP_ALPHA = `(async (metricName, groupCol) => {
    const { state } = await import('/js/state.js');
    const { collectAlphaMetrics } = await import('/js/lib/alphaMetrics.js');
    const { matchSampleId } = await import('/js/lib/sampleMatch.js');
    const sa = await import('/js/lib/statAutoSelect.js');
    const ps = await import('/js/lib/pairwiseStats.js');
    const m = collectAlphaMetrics().find((x) => x.name === metricName);
    const byKey = {}; state.metadata.rows.forEach((r) => { byKey[r[state.metadata.sampleIdKey]] = r; });
    const keys = Object.keys(byKey);
    const gd = {}; const values = {};
    Object.keys(m.values).forEach((sid) => {
      const v = m.values[sid]; if (typeof v !== 'number' || !isFinite(v)) return;
      const k = matchSampleId(keys, sid); const g = k == null ? undefined : byKey[k][groupCol];
      if (g === undefined || g === '') return;
      (gd[g] = gd[g] || []).push(v); values[sid] = v;
    });
    const names = Object.keys(gd).sort(); const groups = names.map((g) => gd[g]);
    const diag = sa.recommendTest(groups);
    const pairs = {};
    const test = diag.recommended;
    if (names.length === 2) {
      const f = test === 'student' ? ps.studentT : test === 'welch' ? ps.welchT : ps.mannWhitneyU;
      pairs[names[0] + '|' + names[1]] = f(groups[0], groups[1]).p;
    } else if (test === 'anova-tukey') sa.tukeyHSD(groups).pairwise.forEach((q) => { pairs[names[q.i] + '|' + names[q.j]] = q.p; });
    else if (test === 'welch-anova-gh') sa.gamesHowell(groups).pairwise.forEach((q) => { pairs[names[q.i] + '|' + names[q.j]] = q.p; });
    else ps.dunnTest(names.map((g) => ({ label: g, values: gd[g] }))).comparisons.forEach((q) => { pairs[q.a + '|' + q.b] = q.adj.holm; });
    const box = [...document.querySelectorAll('#app-view .mono.tabular')].map((e) => e.textContent).join(' ');
    return { values, test, pairs, box };
  })`;
  const alphaCases = [
    { metric: 'shannon_entropy', group: 'fase', name: 'alfa-shannon-archivo' },
    { metric: 'chao1', group: 'grupo', name: 'alfa-chao1-calculado' },
    { metric: 'simpson', group: 'fase', name: 'alfa-simpson-calculado' },
  ];
  await c.ev(`location.hash = '#/alfa'`); await sleep(1800);
  for (const ac of alphaCases) {
    console.log('\n· Diversidad alfa: ' + ac.metric + ' por ' + ac.group);
    await setSelect('/Métrica/', ac.metric); await sleep(700);
    await setSelect('/Agrupar|Grupo/', ac.group); await sleep(900);
    const script = await download('#app-view');
    check('se descarga el script', !!script && script.includes('kruskal.test'));
    if (!script) continue;
    const app = await c.ev(`${APP_ALPHA}(${JSON.stringify(ac.metric)}, ${JSON.stringify(ac.group)})`);
    const r = runR(ac.name, script, {
      muestra: 'datos$muestra', valor: 'datos$valor', H: 'unname(kw$statistic)', df: 'unname(kw$parameter)', p: 'kw$p.value',
      recomendado: 'test_recomendado', usado: 'test_usado',
      g1: 'comparaciones$grupo1', g2: 'comparaciones$grupo2', padj: 'comparaciones$p_ajustado',
    });
    ['muestra', 'valor', 'g1', 'g2', 'padj'].forEach((k) => { r[k] = arr(r[k]); });
    const maxV = Math.max(...r.muestra.map((s, i) => Math.abs(r.valor[i] - app.values[s])));
    check(`valor por muestra idéntico al de la app (${r.muestra.length} muestras, máx. dif. ${maxV.toExponential(1)})`,
      r.muestra.length === Object.keys(app.values).length && maxV < 1e-9);
    const mH = /H = ([\d.]+), df = (\d+)/.exec(app.box), mP = /p = (< 0\.0001|[\d.]+)/.exec(app.box);
    check(`Kruskal-Wallis = lo que muestra la app (H = ${r.H.toFixed(3)}, df = ${r.df}, p = ${r.p.toPrecision(4)})`,
      mH && close(r.H, +mH[1], 5e-4) && r.df === +mH[2] &&
      (mP[1] === '< 0.0001' ? r.p < 1e-4 : close(r.p, +mP[1], 5e-5)), mH && mP ? mH[0] + ' · ' + mP[0] : app.box);
    const TEST_R = { student: 't de Student', welch: 't de Welch', mannwhitney: 'Mann-Whitney', 'anova-tukey': 'ANOVA + Tukey', 'welch-anova-gh': 'ANOVA de Welch + Games-Howell', 'kruskal-dunn': 'Kruskal-Wallis + Dunn' };
    check(`mismo test por pares elegido en R y en la app (${r.recomendado})`, r.recomendado === TEST_R[app.test] && r.usado === TEST_R[app.test]);
    const diffs = r.g1.map((a, i) => Math.abs(r.padj[i] - app.pairs[a + '|' + r.g2[i]]));
    check(`p ajustado de las ${r.g1.length} parejas = app (máx. dif. ${Math.max(...diffs).toExponential(1)})`,
      r.g1.length === Object.keys(app.pairs).length && Math.max(...diffs) < (app.test === 'anova-tukey' || app.test === 'welch-anova-gh' ? 1e-5 : 1e-9));
  }

  // ========================================================== PERMANOVA ==
  console.log('\n· PERMANOVA');
  await c.ev(`location.hash = '#/beta'`); await sleep(2500);
  await clickSeg('/^Mapa de calor$/'); await sleep(1500);
  for (const perms of ['999', '9999']) {
    await c.ev(`(() => { const f = [...document.querySelectorAll('#app-view .ql-field')].find((x) => /Permutaciones/i.test(x.textContent)); const s = f.querySelector('select'); s.value = ${JSON.stringify(perms)}; s.dispatchEvent(new Event('change')); })()`);
    await sleep(perms === '9999' ? 3500 : 1500);
    const script = await download('#app-view .ql-rscript-row');
    check(`se descarga el script (${perms} permutaciones)`, !!script && script.includes('adonis2') && script.includes('permutations = ' + perms));
    if (!script) continue;
    const table = await c.ev(`[...document.querySelectorAll('#app-view .ql-rscript-row')].map((row) => [...row.closest('section').querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())))[0]`);
    const r = runR('permanova-' + perms, script, { Df: 'resultado$Df', SS: 'resultado$SumOfSqs', R2: 'resultado$R2', F: 'resultado$F[1]', p: 'resultado[["Pr(>F)"]][1]' });
    const [row1, row2, row3] = table;
    check('Df = app', r.Df[0] === +row1[1] && r.Df[1] === +row2[1] && r.Df[2] === +row3[1], JSON.stringify(r.Df));
    check('sumas de cuadrados = app (4 decimales)', close(r.SS[0], +row1[2], 5e-5) && close(r.SS[1], +row2[2], 5e-5) && close(r.SS[2], +row3[2], 5e-5));
    check(`R² = app (${r.R2[0].toFixed(4)})`, close(r.R2[0], +row1[3], 5e-5) && close(r.R2[1], +row2[3], 5e-5));
    check(`pseudo-F = app (${r.F.toFixed(3)})`, close(r.F, +row1[4], 5e-4));
    const pApp = parseFloat(row1[5].replace('< ', ''));
    const n = +perms;
    const tolP = 4 * Math.sqrt(Math.max(pApp, 1 / (n + 1)) * (1 - Math.min(pApp, 0.999)) / n) + 2 / (n + 1);
    check(`p por permutaciones compatible con la app (R ${r.p.toFixed(4)} vs app ${row1[5]}; tolerancia de Monte Carlo ±${tolP.toFixed(4)})`,
      row1[5].startsWith('<') ? r.p <= 0.0001 + tolP : Math.abs(r.p - pApp) <= tolP);
  }

  // ============================================================ RDA / CCA ==
  const readConstrained = `(() => {
    const secs = [...document.querySelectorAll('#app-view section.ql-card')];
    const tbl = (re) => { const s = secs.find((x) => { const h = x.querySelector('h2'); return h && re.test(h.textContent); }); return s ? [...s.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())) : null; };
    const pct = [...document.querySelectorAll('#app-view svg [data-ce="xtitle"], #app-view svg [data-ce="ytitle"]')].map((e) => parseFloat(/\\(([\\d.]+)/.exec(e.textContent)[1]));
    const scree = secs.map((x) => x.textContent).find((tx) => /inercia total/.test(tx)) || '';
    const m = /explican el ([\\d.]+) % de la inercia total/.exec(scree);
    return { vars: tbl(/cada variable/), sites: tbl(/Coordenadas por muestra/), pct, pctC: m ? +m[1] : NaN };
  })()`;
  for (const [method, addCat] of [['RDA', null], ['CCA', null], ['RDA', 'fase'], ['CCA', 'fase']]) {
    console.log('\n· ' + method + (addCat ? ' con la variable categórica "' + addCat + '"' : ''));
    await clickSeg('/^RDA\\/CCA$/'); await sleep(1500);
    await clickSeg('/^' + method + '$/'); await sleep(1500);
    if (addCat) {
      // solo la categórica: en este ejemplo "fase" es colineal con "tiempo_dias" (cada fase
      // tiene su día), y con las dos la app rechaza el modelo (matriz singular), con razón
      const on = await c.ev(`(async () => {
        const boxes = () => [...document.querySelectorAll('#app-view .ql-card label')].filter((x) => x.querySelector('input[type=checkbox]') && x.closest('.ql-field'));
        for (let i = 0; i < 12; i++) { // cada clic repinta: se vuelve a buscar la siguiente casilla a cambiar
          const l = boxes().find((x) => x.querySelector('input').checked !== (x.textContent.trim() === ${JSON.stringify(addCat)}));
          if (!l) break;
          l.querySelector('input').click(); await new Promise((r) => setTimeout(r, 900));
        }
        return boxes().filter((l) => l.querySelector('input').checked).map((l) => l.textContent.trim());
      })()`);
      await sleep(1200);
      check('solo la variable categórica marcada', JSON.stringify(on) === JSON.stringify([addCat]), JSON.stringify(on));
    }
    const script = await download('#app-view .ql-grid-2');
    check('se descarga el script', !!script && script.includes(method.toLowerCase() + '(Y ~ ., data = X)'));
    if (!script) continue;
    const app = await c.ev(readConstrained);
    const r = runR(method.toLowerCase() + (addCat ? '-' + addCat : ''), script, {
      pct: 'as.numeric(porcentaje_eje)', pctC: 'porcentaje_restringido', sitios: 'unname(sitios)', muestras: 'rownames(sitios)',
      cor: 'unname(correlaciones)',
    });
    r.pct = arr(r.pct);
    check(`% de cada eje = app (${r.pct.map((v) => v.toFixed(1)).join(', ')})`, app.pct.length === 2 && app.pct.every((v, i) => close(v, r.pct[i], 0.051)), JSON.stringify(app.pct));
    check(`% explicado por las variables = app (${r.pctC.toFixed(1)} %)`, close(app.pctC, r.pctC, 0.051));
    // el signo de cada eje es arbitrario: se alinea con el de la app antes de comparar
    const nAx = r.sitios[0].length;
    const sign = Array.from({ length: nAx }, (_, k) => {
      let dot = 0; app.sites.forEach((row, i) => { dot += parseFloat(row[row.length - nAx + k]) * r.sitios[i][k]; });
      return dot < 0 ? -1 : 1;
    });
    let dS = 0; app.sites.forEach((row, i) => { for (let k = 0; k < nAx; k++) dS = Math.max(dS, Math.abs(parseFloat(row[row.length - nAx + k]) - sign[k] * r.sitios[i][k])); });
    check(`coordenadas de las ${app.sites.length} muestras = app (4 decimales, signo de eje alineado; máx. dif. ${dS.toExponential(1)})`,
      app.sites.length === r.muestras.length && app.sites.every((row, i) => row[0] === r.muestras[i]) && dS <= 5.01e-5);
    let dC = 0; app.vars.forEach((row, j) => { for (let k = 0; k < nAx; k++) dC = Math.max(dC, Math.abs(parseFloat(row[1 + k]) - sign[k] * r.cor[j][k])); });
    check(`flechas (correlaciones) de las ${app.vars.length} variables = app (máx. dif. ${dC.toExponential(1)})`, dC <= 5.01e-4);
  }

  // ========================================================= CORRELOGRAMA ==
  await c.ev(`location.hash = '#/correlograma'`); await sleep(2500);
  await clickSeg('/^Matriz/'); await sleep(1200);
  for (const method of ['Pearson', 'Spearman']) {
    console.log('\n· Correlograma (' + method + ')');
    await clickSeg('/^' + method + '/'); await sleep(1500);
    const script = await download('#app-view');
    check('se descarga el script', !!script && script.includes('cor.test'));
    if (!script) continue;
    const rows = await c.ev(`(() => { const s = [...document.querySelectorAll('#app-view section.ql-card')].find((x) => x.querySelector('table') && /Variable|Pareja|A$/.test(x.querySelector('thead').textContent) && x.querySelectorAll('thead th').length >= 5); return [...s.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())); })()`);
    const r = runR('correlograma-' + method.toLowerCase(), script, { a: 'resultados$variable_a', b: 'resultados$variable_b', r: 'resultados$r', p: 'resultados$p', n: 'resultados$n' });
    const key = (a, b) => [a, b].sort().join('|');
    const rMap = new Map(r.a.map((a, i) => [key(a, r.b[i]), i]));
    let bad = [];
    rows.forEach((row) => {
      const i = rMap.get(key(row[0], row[1]));
      const rApp = parseFloat(row[2]);
      const pOk = row[3] === '—' ? r.p[i] == null : row[3].startsWith('<') ? r.p[i] < 1e-4 : close(r.p[i], +row[3], 5e-5);
      if (i == null || !close(r.r[i], rApp, 5e-4) || !pOk || r.n[i] !== +row[4]) bad.push(row.join(' '));
    });
    check(`r, p y n de las ${rows.length} parejas = tabla de la app`, rows.length === r.a.length && bad.length === 0, bad.slice(0, 3).join(' · '));
  }

  // =============================================================== ÁRBOL ==
  for (const correction of ['p', 'jc']) {
    console.log('\n· Árbol NJ (' + (correction === 'jc' ? 'Jukes-Cantor' : 'p-distance') + ')');
    await c.ev(`(async () => {
      const fasta = await (await fetch('/datos-ejemplo/phylo/secuencias_ejemplo.fasta')).text();
      localStorage.setItem('smart-175.phylo', JSON.stringify({ fastaText: fasta, correction: ${JSON.stringify(correction)}, layout: 'rect', nni: false, rooting: 'none', referenceLeaf: '', colorCol: '' }));
      location.hash = '#/'; })()`);
    await sleep(500);
    await c.ev(`location.hash = '#/arbol'`);
    for (let i = 0; i < 40 && !(await c.ev(`!!document.querySelector('#app-view pre.ql-code')`)); i++) await sleep(500);
    const script = await download('#app-view');
    check('se descarga el script', !!script && script.includes('nj(distancias)'));
    if (!script) continue;
    const appNwk = await c.ev(`document.querySelector('#app-view pre.ql-code').textContent`);
    const r = runR('arbol-' + correction, script, { topo: 'diferencia_topologia', dlen: 'diferencia_longitudes', ntips: 'length(arbol$tip.label)' });
    check('el árbol de referencia del script es el que muestra la app (sin NNI ni raíz)', script.includes(JSON.stringify(appNwk).slice(1, -1)));
    check(`ape::nj da la misma topología que la app (Robinson-Foulds = ${r.topo}, ${r.ntips} hojas)`, r.topo === 0 && r.ntips === 16);
    check(`y las mismas distancias por el árbol entre hojas (máx. dif. ${Number(r.dlen).toExponential(1)})`, r.dlen < 1e-5);
  }

  check('\nsin errores de consola', c.problems.length === 0, c.problems.join('; '));
} catch (e) {
  console.log('  ✗ excepción: ' + (e && e.stack || e));
  failed = true;
} finally {
  c.kill();
  if (server.started) server.stop();
}
console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
