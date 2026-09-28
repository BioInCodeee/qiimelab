// tests/rscript-builders.mjs — el camino "dataset grande" de "Descargar
// script R" (js/lib/rScript.js), que el ejemplo real (42 muestras) no
// ejercita: por encima de R_EMBED_MAX_ROWS filas la tabla NO va dentro del
// script, sino en un .tsv aparte que el script lee por nombre y con las
// columnas exactas. Se generan los archivos con los mismos generadores que
// usa la app, se ejecuta el script en R real junto a sus .tsv y se comparan
// los números con el cálculo de la app. Además: nombres con comillas,
// espacios y tildes sobreviven al viaje (embebidos y en .tsv).
//
//   node tests/rscript-builders.mjs

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { hasR, hasRPackage, skip } from './lib/env.mjs';
import { R_EMBED_MAX_ROWS, rTable } from '../js/lib/rScript.js';
import { permanovaScript, alphaScript } from '../js/lib/rScriptBuilders.js';
import { permanova, chao1 } from '../js/lib/stats.js';
import { mulberry32 } from '../js/lib/groupBoxplot.js';
import { recommendTest } from '../js/lib/statAutoSelect.js';

if (!hasR()) skip('no hay Rscript');
if (!hasRPackage('vegan') || !hasRPackage('jsonlite')) skip('faltan vegan/jsonlite');

let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

function runWithData(s, exprs) {
  const dir = mkdtempSync(join(tmpdir(), 'smart175-rbuild-'));
  writeFileSync(join(dir, 'script.R'), s.text);
  s.dataFiles.forEach((f) => writeFileSync(join(dir, f.filename), f.text));
  execFileSync('Rscript', ['script.R'], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 64 << 20 });
  const probe = 'invisible(capture.output(source("script.R")))\nwriteLines(enc2utf8(as.character(jsonlite::toJSON(list(' +
    Object.entries(exprs).map(([k, v]) => k + ' = ' + v).join(', ') + '), digits = NA, auto_unbox = TRUE))), "out.json", useBytes = TRUE)';
  writeFileSync(join(dir, 'probe.R'), probe);
  execFileSync('Rscript', ['probe.R'], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'], maxBuffer: 64 << 20 });
  return JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
}

const rnd = mulberry32(175);

// ---- PERMANOVA con 520 muestras: matriz y grupos a .tsv ----
{
  const n = R_EMBED_MAX_ROWS + 20;
  const ids = Array.from({ length: n }, (_, i) => 'M "' + (i + 1) + '" ñ');
  const groups = ids.map((_, i) => ['Control', 'Trat. A', 'Trat B'][i % 3]);
  const pts = ids.map((_, i) => [rnd() + (i % 3) * 0.15, rnd(), rnd()]);
  const D = pts.map((a) => pts.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])));
  const s = permanovaScript({ metricName: 'euclidea', groupCol: 'tratamiento', sampleIds: ids, groups, matrix: D, permutations: 99, seed: 0x5152, nDropped: 0 });
  check(`${n} muestras → 2 archivos de datos aparte (matriz + grupos)`, s.dataFiles.length === 2, s.dataFiles.map((f) => f.filename).join(', '));
  check('el script no lleva los datos dentro y dice qué archivo y qué columnas espera',
    s.text.length < 20000 && s.dataFiles.every((f) => s.text.includes('"' + f.filename + '"')) && s.text.includes('columnas'));
  const js = permanova(D, groups, { permutations: 99, seed: 0x5152 });
  const r = runWithData(s, { F: 'resultado$F[1]', R2: 'resultado$R2[1]', ids: 'rownames(D)' });
  check(`R lee los .tsv y da el mismo pseudo-F y R² que la app (F ${r.F.toFixed(4)} vs ${js.F.toFixed(4)})`,
    Math.abs(r.F - js.F) < 1e-8 * js.F && Math.abs(r.R2 - js.R2) < 1e-10);
  check('los nombres con comillas, espacios y ñ llegan intactos', JSON.stringify(r.ids) === JSON.stringify(ids));
}

// ---- alfa (Chao1 calculado) con 600 taxones: conteos a .tsv, grupos embebidos ----
{
  const nTaxa = R_EMBED_MAX_ROWS + 100;
  const sampleIds = Array.from({ length: 24 }, (_, i) => 'S-' + (i + 1));
  const taxa = Array.from({ length: nTaxa }, (_, i) => 'g__Taxón ' + i);
  const vectors = {};
  sampleIds.forEach((sid, si) => { vectors[sid] = taxa.map(() => { const u = rnd(); return u < 0.5 ? 0 : Math.floor(-Math.log(rnd()) * (2 + si % 4)); }); });
  const rows = sampleIds.map((sid, i) => ({ sampleId: sid, group: ['a', 'b', 'c'][i % 3], value: chao1(vectors[sid]) }));
  const groupOrder = ['a', 'b', 'c'];
  const test = recommendTest(groupOrder.map((g) => rows.filter((r) => r.group === g).map((r) => r.value))).recommended;
  const s = alphaScript({ metricName: 'chao1', kind: 'chao1', computed: true, groupCol: 'lote', groupOrder, rows,
    counts: { taxa, sampleIds, vectors }, testChoice: test, overridden: false, adjust: 'BH', threshold: 0.05 });
  check(`${nTaxa} taxones → solo la tabla de conteos va aparte`, s.dataFiles.length === 1 && /^conteos_/.test(s.dataFiles[0].filename) && s.text.includes('grupos <- data.frame('));
  const r = runWithData(s, { m: 'datos$muestra', v: 'datos$valor', test: 'test_recomendado' });
  const maxD = Math.max(...r.m.map((sid, i) => Math.abs(r.v[i] - rows.find((x) => x.sampleId === sid).value)));
  check(`Chao1 de las 24 muestras calculado en R desde el .tsv = app (máx. dif. ${maxD})`, r.m.length === 24 && maxD < 1e-9);
  check(`mismo test por pares recomendado (${r.test})`, r.test === { 'anova-tukey': 'ANOVA + Tukey', 'welch-anova-gh': 'ANOVA de Welch + Games-Howell', 'kruskal-dunn': 'Kruskal-Wallis + Dunn' }[test]);
}

// ---- tabla pequeña: embebida, sin archivos aparte ----
{
  const t = rTable('x', [{ name: 'a "b"', values: [1, NaN, 2.5e-12], type: 'num' }, { name: 'c', values: ['x\ty', null, 'z'], type: 'str' }], { file: 'x.tsv', what: 'prueba' });
  check('≤ ' + R_EMBED_MAX_ROWS + ' filas → data.frame() dentro del script', t.dataFile === null && t.code.includes('x <- data.frame(') && t.code.includes('"a \\"b\\"" = c(1, NA, 2.5e-12)'));
}

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
