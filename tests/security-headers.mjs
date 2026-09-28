// tests/security-headers.mjs — cabeceras de seguridad vía <meta> (GitHub Pages
// no permite fijar cabeceras HTTP): Content-Security-Policy y referrer.
//
// Parte 1 (sin Chrome): index.html declara la CSP y `referrer: no-referrer`;
// el hash 'sha256-…' de script-src coincide con el script de tema en línea
// TAL CUAL está ahora (si alguien lo edita sin recalcular, la app arrancaría
// sin tema y esto falla); ningún origen externo salvo NCBI en form-action.
// Parte 2 (Chrome): un colector de violaciones CSP inyectado ANTES que
// cualquier script de la página recorre todas las rutas con los ejemplos
// cargados y ejercita lo que más fácilmente chocaría con la CSP — los tres
// workers (QC, alineamiento, estadística pesada), exportar SVG/PNG/PDF, el
// informe y el BLAST de Sanger — y exige 0 violaciones y 0 errores. También
// que el aviso de NCBI esté a la vista junto al botón de BLAST (A6).
//
//   node tests/security-headers.mjs

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { APP_ROOT, findChrome } from './lib/env.mjs';

let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

console.log('--- 1. index.html ---');
const html = readFileSync(APP_ROOT + '/index.html', 'utf8');
const cspMeta = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
const dir = Object.fromEntries(cspMeta.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));
check('declara una Content-Security-Policy', !!cspMeta, cspMeta.slice(0, 80));
check('referrer: no-referrer', /<meta name="referrer" content="no-referrer"\s*\/?>/.test(html));
const cspPos = html.indexOf('http-equiv="Content-Security-Policy"');
check('la CSP va antes de cualquier <script> y <link> (solo gobierna lo que viene después)', cspPos > 0 && cspPos < html.indexOf('<script') && cspPos < html.indexOf('<link'));
check("default-src 'self', object-src 'none', base-uri 'self'", (dir['default-src'] || []).join(' ') === "'self'" && (dir['object-src'] || []).join(' ') === "'none'" && (dir['base-uri'] || []).join(' ') === "'self'", JSON.stringify(dir));
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const hashes = inline.map((src) => "'sha256-" + createHash('sha256').update(src, 'utf8').digest('base64') + "'");
const scriptSrc = dir['script-src'] || [];
check('script-src = self + el hash de CADA script en línea (sin unsafe-inline/unsafe-eval)',
  scriptSrc[0] === "'self'" && hashes.every((h) => scriptSrc.includes(h)) && !scriptSrc.some((x) => /unsafe/.test(x)), JSON.stringify({ scriptSrc, hashes }));
const external = Object.entries(dir).flatMap(([k, v]) => v.filter((x) => /^https?:/.test(x)).map((x) => k + ' ' + x));
check('el único origen externo es NCBI, y solo en form-action', external.length === 1 && external[0] === 'form-action https://blast.ncbi.nlm.nih.gov', JSON.stringify(external));

if (!findChrome()) {
  console.log('\n(sin Chrome: se omite la parte de la app)');
  console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
  process.exit(failed ? 1 : 0);
}

console.log('\n--- 2. la app con la CSP activa ---');
const { ensureServer } = await import('./lib/server.mjs');
const { connect } = await import('./lib/cdp.mjs');
const { sleep, LOAD_ALL, ROUTES } = await import('./lib/app.mjs');
const server = await ensureServer();
const c = await connect({ url: server.url + '/index.html', label: 'security-headers' });
// colector de violaciones: se evalúa en cada documento ANTES que sus scripts
await c.rpc('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ← ' + (e.blockedURI || 'inline') + ' @' + (e.sourceFile || '').split('/').pop() + ':' + e.lineNumber));`,
}, c.sessionId);
const violations = async () => c.ev('window.__csp || []');
try {
  await c.goto(); await sleep(1500);
  check('la CSP está activa en la página (meta leída por el navegador)', await c.ev(`!!document.querySelector('meta[http-equiv="Content-Security-Policy"]')`));
  check('el script de tema en línea se ejecutó (su hash es válido)', (await violations()).length === 0, JSON.stringify(await violations()));
  await c.ev(LOAD_ALL); await sleep(1500);
  for (const r of ROUTES) { await c.ev(`location.hash = ${JSON.stringify(r)}`); await sleep(900); }
  // workers: QC (fastqWorker) ya corre con LOAD_ALL; estadística pesada = rarefacción de alfa
  await c.ev(`location.hash = '#/qc'`); await sleep(2500);
  await c.ev(`location.hash = '#/alfa'`); await sleep(1200);
  await c.ev(`[...document.querySelectorAll('#app-view .ql-tab')].find((x) => /rarefac/i.test(x.textContent))?.click()`); await sleep(3000);
  // alineamiento (alignWorker) + árbol
  await c.ev(`location.hash = '#/arbol'`); await sleep(1200);
  await c.ev(`[...document.querySelectorAll('button')].find((x) => /Cargar ejemplo|Load example/.test(x.textContent))?.click()`);
  for (let i = 0; i < 60; i++) { if (await c.ev(`document.querySelectorAll('svg.ql-svg text.ql-phylo-leaflabel').length === 16`)) break; await sleep(250); }
  // exportar en los 4 formatos (blob:, data:, canvas, CompressionStream)
  await c.ev(`(() => { window.__dl = 0; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => o(b); HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl++; }; })()`);
  for (const fmt of ['svg', 'png', 'tiff', 'pdf']) {
    await c.ev(`(() => { const s = document.querySelector('.ce-export-format'); s.value = '${fmt}'; s.dispatchEvent(new Event('change')); document.querySelector('.ce-download-btn').click(); })()`);
    await sleep(fmt === 'svg' ? 400 : 2500);
  }
  check('las 4 exportaciones (SVG/PNG/TIFF/PDF) se generan con la CSP activa', (await c.ev('window.__dl')) === 4, String(await c.ev('window.__dl')));
  // informe (fuentes incrustadas como data:)
  await c.ev(`location.hash = '#/informe'`); await sleep(1500);
  await c.ev(`[...document.querySelectorAll('#app-view button')].find((x) => /HTML/i.test(x.textContent))?.click()`); await sleep(2500);
  // Sanger: BLAST
  await c.ev(`location.hash = '#/sanger'`); await sleep(1500);
  await c.ev(`[...document.querySelectorAll('.ql-tab')].find((x) => /Entrada|Input/i.test(x.textContent))?.click()`); await sleep(500);
  await c.ev(`[...document.querySelectorAll('button')].find((x) => /muestra limpia|clean sample/i.test(x.textContent))?.click()`);
  for (let i = 0; i < 40; i++) { if (await c.ev(`document.querySelectorAll('.ql-table tbody tr').length > 0`)) break; await sleep(300); }
  await c.ev(`[...document.querySelectorAll('.ql-tab')].find((x) => /Resultados|Results/i.test(x.textContent))?.click()`);
  for (let i = 0; i < 20; i++) { if (await c.ev(`!!document.querySelector('a[href*="blast.ncbi.nlm.nih.gov"]')`)) break; await sleep(300); }
  const blast = await c.ev(`(() => {
    const a = document.querySelector('a[href*="blast.ncbi.nlm.nih.gov"]');
    if (!a) return null;
    const note = [...a.closest('div').parentElement.querySelectorAll('.ql-field-help')].map((p) => p.textContent).join(' ');
    const noteEl = [...a.closest('div').parentElement.querySelectorAll('.ql-field-help')].find((p) => /NCBI/.test(p.textContent));
    return { href: a.href.slice(0, 80), target: a.target, title: a.title, note, noteVisible: !!noteEl && noteEl.getClientRects().length > 0 && !noteEl.closest('details:not([open])') };
  })()`);
  check('el enlace de BLAST apunta a blast.ncbi.nlm.nih.gov y abre en pestaña nueva', !!blast && /^https:\/\/blast\.ncbi\.nlm\.nih\.gov\/Blast\.cgi\?/.test(blast.href) && blast.target === '_blank', JSON.stringify(blast));
  check('A6: junto al botón, a la vista (no plegado), se avisa de que la secuencia sale hacia NCBI', !!blast && blast.noteVisible && /(Envía|Sends).*NCBI/.test(blast.note), blast && blast.note.slice(0, 140));
  check('A6: el propio botón lo dice al pasar el ratón', !!blast && /NCBI/.test(blast.title) && /(Envía|Sends)/.test(blast.title), blast && blast.title);

  const v = await violations();
  check('0 violaciones de CSP en todo el recorrido', v.length === 0, v.slice(0, 5).join(' | '));
  check('sin errores de consola', c.problems.length === 0, c.problems.slice(0, 3).join('; '));
} catch (e) {
  console.error('EXCEPCIÓN:', e.message);
  failed = true;
} finally {
  c.kill();
  if (server.started) server.stop();
}
console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
