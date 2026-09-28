// Runner único: ejecuta todos los tests de tests/ y resume pasa/falla/salta.
//
//   node tests/run.mjs                 → todo
//   node tests/run.mjs stats           → solo tests/stats/*
//   node tests/run.mjs sweep-routes contrast   → solo esos
//
// Cada test sale con 0 (pasa), 1 (falla) o 2 (se salta: falta Chrome / R / …).
// El runner sale != 0 si algún test falla (los saltados no cuentan como fallo).

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findChrome, hasR, hasBiopython } from './lib/env.mjs';
import { freePort, startServer } from './lib/server.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));

const SUITE = [
  { name: 'privacy', file: 'privacy.mjs', kind: 'estático' },
  { name: 'contrast', file: 'contrast.mjs', kind: 'estático' },
  { name: 'cvd', file: 'cvd.mjs', kind: 'estático' },
  { name: 'forcelayout', file: 'forcelayout.mjs', kind: 'estático' },
  { name: 'datahealth', file: 'datahealth.mjs', kind: 'estático' },
  { name: 'primerdimers', file: 'primerdimers.mjs', kind: 'estático' },
  { name: 'primertemplate', file: 'primertemplate.mjs', kind: 'estático' },
  { name: 'primercoverage', file: 'primercoverage.mjs', kind: 'estático' },
  { name: 'palettes', file: 'palettes.mjs', kind: 'estático' },
  { name: 'palettestyle', file: 'palettestyle.mjs', kind: 'estático' },
  { name: 'colorscale', file: 'colorscale.mjs', kind: 'estático' },
  { name: 'colorscalepanel', file: 'colorscalepanel.mjs', kind: 'navegador' },
  { name: 'colorscaleperf', file: 'colorscaleperf.mjs', kind: 'navegador' },
  { name: 'figureoptions', file: 'figureoptions.mjs', kind: 'navegador' },
  { name: 'sequenceqc-editor', file: 'sequenceqc-editor.mjs', kind: 'navegador' },
  { name: 'venn-editor', file: 'venn-editor.mjs', kind: 'navegador' },
  { name: 'phylo-editor', file: 'phylo-editor.mjs', kind: 'navegador' },
  { name: 'phylo-reroot', file: 'phylo-reroot.mjs', kind: 'navegador' },
  { name: 'pcoa-ellipses', file: 'pcoa-ellipses.mjs', kind: 'navegador' },
  { name: 'violin', file: 'violin.mjs', kind: 'navegador' },
  { name: 'sanger-editor', file: 'sanger-editor.mjs', kind: 'navegador' },
  { name: 'inference-lollipop-editor', file: 'inference-lollipop-editor.mjs', kind: 'navegador' },
  { name: 'chartpresets', file: 'chartpresets.mjs', kind: 'navegador' },
  { name: 'globalfont', file: 'globalfont.mjs', kind: 'navegador' },
  { name: 'methodequivalence', file: 'methodequivalence.mjs', kind: 'navegador' },
  { name: 'alpha-boxstats', file: 'alpha-boxstats.mjs', kind: 'navegador' },
  { name: 'venn-sets', file: 'venn-sets.mjs', kind: 'navegador' },
  { name: 'correlogram-pie-split', file: 'correlogram-pie-split.mjs', kind: 'navegador' },
  { name: 'phylo-sunburst', file: 'phylo-sunburst.mjs', kind: 'navegador' },
  { name: 'storage-migration', file: 'storage-migration.mjs', kind: 'navegador' },
  { name: 'temporal', file: 'temporal.mjs', kind: 'navegador' },
  { name: 'ui-fixes-editor-alluvial', file: 'ui-fixes-editor-alluvial.mjs', kind: 'navegador' },
  { name: 'chart-consistency', file: 'chart-consistency.mjs', kind: 'navegador' },
  { name: 'primerdesign', file: 'primerdesign.mjs', kind: 'estático' },
  { name: 'phyloalign', file: 'phyloalign.mjs', kind: 'estático' },
  { name: 'phylonni', file: 'phylonni.mjs', kind: 'estático' },
  { name: 'microbialcountsfacet', file: 'microbialcountsfacet.mjs', kind: 'estático' },
  { name: 'sangertrim', file: 'sangertrim.mjs', kind: 'estático' },
  { name: 'sangeroverlap', file: 'sangeroverlap.mjs', kind: 'estático' },
  { name: 'venngeometry', file: 'venngeometry.mjs', kind: 'estático' },
  { name: 'labcalc', file: 'labcalc.mjs', kind: 'estático' },
  { name: 'inference', file: 'inference.mjs', kind: 'estático' },
  { name: 'phenotypes', file: 'phenotypes.mjs', kind: 'estático' },
  { name: 'ingest', file: 'ingest.mjs', kind: 'estático' },
  { name: 'zipbomb', file: 'zipbomb.mjs', kind: 'estático' },
  { name: 'aligner', file: 'aligner.mjs', kind: 'estático' },
  { name: 'alluvial', file: 'alluvial.mjs', kind: 'estático' },
  { name: 'sunburst', file: 'sunburst.mjs', kind: 'estático' },
  { name: 'charteditor', file: 'charteditor.mjs', kind: 'estático' },
  { name: 'statannotations', file: 'statannotations.mjs', kind: 'estático' },
  { name: 'figureexport', file: 'figureexport.mjs', kind: 'estático' },
  { name: 'chromatooltip', file: 'chromatooltip.mjs', kind: 'estático' },
  { name: 'sangerinspector', file: 'sangerinspector.mjs', kind: 'estático' },
  { name: 'taxagrouping', file: 'taxagrouping.mjs', kind: 'estático' },
  { name: 'dom_tooltip', file: 'dom_tooltip.mjs', kind: 'estático' },
  { name: 'glosario-links', file: 'glosario-links.mjs', kind: 'estático' },
  { name: 'i18n-parity', file: 'i18n-parity.mjs', kind: 'estático' },
  { name: 'pformat', file: 'pformat.mjs', kind: 'estático' },
  { name: 'stats/diversity', file: 'stats/diversity.mjs', kind: 'R' },
  { name: 'stats/rarefaction', file: 'stats/rarefaction.mjs', kind: 'R' },
  { name: 'stats/richness', file: 'stats/richness.mjs', kind: 'R' },
  { name: 'stats/kruskalwallis', file: 'stats/kruskalwallis.mjs', kind: 'R' },
  { name: 'stats/correlation', file: 'stats/correlation.mjs', kind: 'R' },
  { name: 'stats/incompletebeta', file: 'stats/incompletebeta.mjs', kind: 'R' },
  { name: 'stats/chisquare', file: 'stats/chisquare.mjs', kind: 'R' },
  { name: 'stats/benjaminihochberg', file: 'stats/benjaminihochberg.mjs', kind: 'R' },
  { name: 'stats/cliffsdelta', file: 'stats/cliffsdelta.mjs', kind: 'R' },
  { name: 'stats/countsummary', file: 'stats/countsummary.mjs', kind: 'R' },
  { name: 'stats/permanova', file: 'stats/permanova.mjs', kind: 'R' },
  { name: 'stats/fisherlsd', file: 'stats/fisherlsd.mjs', kind: 'R' },
  { name: 'stats/lefselda', file: 'stats/lefselda.mjs', kind: 'R' },
  { name: 'stats/ancombc', file: 'stats/ancombc.mjs', kind: 'R' },
  { name: 'stats/neighborjoining', file: 'stats/neighborjoining.mjs', kind: 'R' },
  { name: 'stats/phylodistance', file: 'stats/phylodistance.mjs', kind: 'R' },
  { name: 'stats/rda', file: 'stats/rda.mjs', kind: 'R' },
  { name: 'stats/cca', file: 'stats/cca.mjs', kind: 'R' },
  { name: 'stats/randomforest', file: 'stats/randomforest.mjs', kind: 'R' },
  { name: 'stats/pairwisestats', file: 'stats/pairwisestats.mjs', kind: 'R' },
  { name: 'stats/confidenceellipse', file: 'stats/confidenceellipse.mjs', kind: 'R' },
  { name: 'stats/gaussiankde', file: 'stats/gaussiankde.mjs', kind: 'R' },
  { name: 'stats/statautoselect', file: 'stats/statautoselect.mjs', kind: 'R' },
  { name: 'statautoselect-editor', file: 'statautoselect-editor.mjs', kind: 'navegador' },
  { name: 'stats/primertm', file: 'stats/primertm.mjs', kind: 'Biopython' },
  { name: 'keyboard-editor', file: 'keyboard-editor.mjs', kind: 'navegador' },
  { name: 'paletteseries', file: 'paletteseries.mjs', kind: 'navegador' },
  { name: 'chart-fullscreen', file: 'chart-fullscreen.mjs', kind: 'navegador' },
  { name: 'sangerchromatogram', file: 'sangerchromatogram.mjs', kind: 'navegador' },
  { name: 'session-ui', file: 'session-ui.mjs', kind: 'navegador' },
  { name: 'compare-overlap', file: 'compare-overlap.mjs', kind: 'navegador' },
  { name: 'sweep-a11y', file: 'sweep-a11y.mjs', kind: 'navegador' },
  { name: 'sweep-session', file: 'sweep-session.mjs', kind: 'navegador' },
  { name: 'sweep-routes', file: 'sweep-routes.mjs', kind: 'navegador' },
  { name: 'mobile-audit', file: 'mobile-audit.mjs', kind: 'navegador' },
  { name: 'pwa', file: 'pwa.mjs', kind: 'navegador' },
  { name: 'perf-stress', file: 'perf-stress.mjs', kind: 'navegador' },
];

const filters = process.argv.slice(2);
const picked = filters.length
  ? SUITE.filter((s) => filters.some((f) => s.name === f || s.name.startsWith(f + '/') || s.file === f || s.name.startsWith(f)))
  : SUITE;

// avisos de entorno
if (!findChrome()) console.log('· sin Chrome/Chromium → los tests de navegador se SALTAN\n');
if (!hasR()) console.log('· sin Rscript → los tests de stats corren en modo GOLDEN (referencia R embebida)\n');
if (!hasBiopython()) console.log('· sin Biopython → stats/primertm corre en modo GOLDEN (referencia Biopython embebida)\n');

function runOne(spec) {
  return new Promise((resolve) => {
    const started = Date.now();
    const p = spawn(process.execPath, [join(DIR, spec.file)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      resolve({ spec, code, secs, out });
    });
  });
}

// Un solo servidor para toda la ejecución, en un puerto libre y sirviendo
// ESTE árbol (salvo que se fije QL_TEST_PORT a mano): nada de reutilizar lo
// que haya en :8931 ni de arrancar/parar uno por test. Los hijos lo heredan
// por el entorno.
const browserPicked = picked.some((s) => s.kind === 'navegador');
let sharedServer = null;
if (browserPicked && findChrome() && !process.env.QL_TEST_PORT) {
  sharedServer = await startServer(await freePort());
  if (sharedServer) {
    process.env.QL_TEST_PORT = sharedServer.url.split(':').pop();
    console.log('· servidor de test propio: ' + sharedServer.url + '\n');
  }
}

// Humo de infraestructura antes de cualquier suite de navegador: si Chrome
// no llega al servidor, no tiene sentido lanzar el resto (fallarían en
// cascada con chrome-error://…); se marcan como fallo de infraestructura.
const SMOKE = { name: 'server-smoke', file: 'server-smoke.mjs', kind: 'navegador' };
const queue = browserPicked && !picked.some((s) => s.name === SMOKE.name) ? [SMOKE, ...picked] : picked;
let chromeUnreachable = false;

const results = [];
for (const spec of queue) {
  process.stdout.write(`\n${'━'.repeat(70)}\n▶ ${spec.name}  (${spec.kind})\n${'━'.repeat(70)}\n`);
  if (chromeUnreachable && spec.kind === 'navegador') {
    const msg = 'NO EJECUTADO: SERVER_REACHABILITY_FROM_CHROME (ver server-smoke) — fallo de infraestructura, no del código';
    process.stdout.write(msg + '\n');
    results.push({ spec, code: 1, secs: '0.0', out: msg });
    continue;
  }
  const r = await runOne(spec);
  process.stdout.write(r.out.trimEnd() + '\n');
  results.push(r);
  if (spec.name === SMOKE.name && r.code === 1) chromeUnreachable = true;
}
if (sharedServer) sharedServer.stop();

const mark = { 0: 'PASA ', 1: 'FALLA', 2: 'salta' };
console.log('\n\n' + '═'.repeat(70));
console.log('RESUMEN');
console.log('═'.repeat(70));
let fails = 0, skips = 0;
for (const r of results) {
  if (r.code === 1) fails++;
  if (r.code === 2) skips++;
  console.log(`  ${mark[r.code] ?? 'ERR ' + r.code}  ${r.spec.name.padEnd(28)} ${r.secs.padStart(5)}s`);
}
console.log('─'.repeat(70));
console.log(`  ${results.length} tests · ${results.length - fails - skips} pasan · ${fails} fallan · ${skips} saltados`);
process.exit(fails ? 1 : 0);
