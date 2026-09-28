// tests/design-v2.mjs
// Sistema de diseño v2 — piloto en la portada (css/tokens.css [data-ds="v2"],
// design-system/smart-175/MASTER.md):
//   1. estático: contraste WCAG de los tokens v2 en claro y oscuro (texto
//      ≥ 4,5:1), incluido el texto de estado --good-ink sobre su insignia
//   1b. estático: azul de marca a ΔE OKLab ≥ 15 de todos los colores de datos
//   2. navegador: data-ds="v2" en <body> (global): portada, módulos, barra
//      lateral, pie e informe con Fira Sans y el azul de marca; las figuras
//      conservan IBM Plex; Fira desde el propio origen, sin peticiones
//      externas; 0 errores de consola
//   3. navegador: encabezado de identidad (wordmark + motivo) en 4 breakpoints

import { readFileSync } from 'node:fs';
import { APP_ROOT, findChrome } from './lib/env.mjs';

let failed = 0;
function check(name, ok, detail = '') {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (!ok && detail ? '  → ' + detail : ''));
  if (!ok) failed++;
}

// ---------- 1. contraste ----------
console.log('\n--- 1. contraste de los tokens v2 ---');
const CSS = readFileSync(APP_ROOT + '/css/tokens.css', 'utf8');
const block = (re) => {
  const m = CSS.match(re);
  if (!m) throw new Error('no está el bloque ' + re);
  return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
};
const ROOT = block(/:root\s*\{([^}]*)\}/);
const LIGHT = block(/\n\[data-ds="v2"\]\s*\{([^}]*)\}/);
const DARK = { ...LIGHT, ...block(/:root\[data-theme="dark"\] \[data-ds="v2"\]\s*\{([^}]*)\}/) };
const DARK_MQ = block(/:root:not\(\[data-theme="light"\]\) \[data-ds="v2"\]\s*\{([^}]*)\}/);
check('los dos bloques oscuros (media query y data-theme) son idénticos',
  JSON.stringify(DARK_MQ) === JSON.stringify(block(/:root\[data-theme="dark"\] \[data-ds="v2"\]\s*\{([^}]*)\}/)));
check('v2 no redefine ningún color de DATOS', !Object.keys({ ...LIGHT, ...DARK }).some((k) => /^(cat-\d|enriched|depleted|neutral|corr-|good$|warning$|critical$)/.test(k)));

const hex = (h) => { h = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = (rgb) => { const c = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a, b, p) => a.map((v, i) => Math.round(v * p + b[i] * (1 - p)));
for (const [name, T] of [['claro', LIGHT], ['oscuro', DARK]]) {
  const good = hex(ROOT.good); // --good no cambia entre temas (#0ca30c)
  const pairs = [
    ['ink / page', T.ink, T.page], ['ink / surface', T.ink, T.surface],
    ['ink-2 / surface', T['ink-2'], T.surface], ['ink-muted / page', T['ink-muted'], T.page],
    ['ink-muted / surface', T['ink-muted'], T.surface], ['accent / surface', T.accent, T.surface],
    ['accent-ink / accent', T['accent-ink'], T.accent], ['highlight-ink / highlight', T['highlight-ink'], T.highlight],
    ['good-ink / page (KPI)', T['good-ink'], T.page],
  ].map(([n, a, b]) => [n, ratio(hex(a), hex(b))]);
  pairs.push(['good-ink / insignia (good 16% sobre surface)', ratio(hex(T['good-ink']), mix(good, hex(T.surface), 0.16))]);
  pairs.push(['warning-ink / page', ratio(hex(T['warning-ink']), hex(T.page))]);
  pairs.push(['warning-ink / insignia (warning 22% sobre surface)', ratio(hex(T['warning-ink']), mix(hex(ROOT.warning), hex(T.surface), 0.22))]);
  const bad = pairs.filter(([, r]) => r < 4.5);
  check(`${name}: todo el texto v2 ≥ 4,5:1`, bad.length === 0, bad.map(([n, r]) => n + ' ' + r.toFixed(2)).join(', '));
  console.log('      ' + pairs.map(([n, r]) => n + ' ' + r.toFixed(1)).join(' · '));
}

// ---------- 1a. --good / --warning nunca como color de TEXTO ----------
// Como texto dan 3,2:1 y 1,8:1 sobre claro: el color de datos va en el fondo,
// el borde o el indicador, y el texto en su tono --good-ink / --warning-ink.
{
  const { readdirSync } = await import('node:fs');
  const files = ['css/components.css', 'css/base.css', 'css/print.css'];
  const walk = (d) => readdirSync(APP_ROOT + '/' + d, { withFileTypes: true }).forEach((e) => {
    if (e.isDirectory()) walk(d + '/' + e.name); else if (e.name.endsWith('.js')) files.push(d + '/' + e.name);
  });
  walk('js');
  const re = /(?<![-\w])color\s*[:=]\s*['"]?var\(--(good|warning)\)/g;
  const hits = files.flatMap((f) => readFileSync(APP_ROOT + '/' + f, 'utf8').split('\n')
    .map((l, i) => (l.match(re) ? f + ':' + (i + 1) : null)).filter(Boolean));
  check('ningún texto en var(--good) / var(--warning) (usar --good-ink / --warning-ink)', hits.length === 0, hits.join(', '));
}

// ---------- 1b. marca frente a colores de DATOS ----------
// Mismo criterio que cuando se eligió el teal (commit 40a9be5): ΔE OKLab ×100
// ≥ 15 entre el azul de marca (y su variante de hover) y cada color que
// codifica datos — categóricos, par divergente y estados —, en los dos temas.
// Si falla, se ajusta la MARCA, nunca los datos (validados para daltonismo).
console.log('\n--- 1b. azul de marca frente a colores de datos (ΔE OKLab ≥ 15) ---');
const { deltaE } = await import('../js/lib/paletteValidator.js');
const { SEQUENTIAL } = await import('../js/lib/palettes.js');
const ROOT_DARK = { ...ROOT, ...block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/) };
const DATA_KEYS = ['cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6', 'cat-7', 'cat-8', 'enriched', 'depleted', 'neutral', 'good', 'warning', 'critical'];
for (const [name, T, D] of [['claro', LIGHT, ROOT], ['oscuro', DARK, ROOT_DARK]]) {
  for (const tok of ['accent', 'accent-2']) {
    const dists = DATA_KEYS.map((k) => [k, deltaE(T[tok], D[k])]).sort((a, b) => a[1] - b[1]);
    check(`${name}: --${tok} ${T[tok]} a ΔE ≥ 15 de todos los colores de datos`, dists[0][1] >= 15, dists.slice(0, 3).map(([k, d]) => k + ' ' + d.toFixed(1)).join(', '));
    console.log(`      más cercanos: ${dists.slice(0, 3).map(([k, d]) => k + ' ' + d.toFixed(1)).join(' · ')} · rampa secuencial (informativo) ${Math.min(...SEQUENTIAL.map((h) => deltaE(T[tok], h))).toFixed(1)}`);
  }
  check(`${name}: --accent a ΔE ≥ 15 de --ink (un enlace no se confunde con el texto)`, deltaE(T.accent, T.ink) >= 15, deltaE(T.accent, T.ink).toFixed(1));
}

// ---------- 2. navegador ----------
if (!findChrome()) {
  console.log('\n(sin Chrome: se omite la parte de interfaz)');
} else {
  console.log('\n--- 2. v2 global (data-ds en <body>) ---');
  const { ensureServer } = await import('./lib/server.mjs');
  const { connect } = await import('./lib/cdp.mjs');
  const { sleep, LOAD_ALL } = await import('./lib/app.mjs');
  const server = await ensureServer();
  const c = await connect({ url: server.url + '/index.html', label: 'design-v2' });
  const probe = () => c.ev(`(async () => {
    await document.fonts.ready;
    const v = document.getElementById('app-view');
    const h1 = v.querySelector('h1');
    const btn = v.querySelector('.ql-btn-primary');
    const tick = v.querySelector('svg .ql-tick-label');
    const kpi = v.querySelector('.ql-stat:not(.ql-stat-status) .ql-stat-value');
    return {
      ds: document.body.getAttribute('data-ds'),
      viewAccent: getComputedStyle(v).getPropertyValue('--accent').trim(),
      h1Font: h1 ? getComputedStyle(h1).fontFamily : '',
      btnBg: btn ? getComputedStyle(btn).backgroundColor : '',
      ctaBg: getComputedStyle(document.querySelector('#sidebar .ql-report-cta')).backgroundColor,
      sidebarFont: getComputedStyle(document.querySelector('.ql-nav-item')).fontFamily,
      footerFont: getComputedStyle(document.querySelector('#app-footer .ql-footer-inner')).fontFamily,
      tickFont: tick ? getComputedStyle(tick).fontFamily : null,
      kpiDot: kpi ? getComputedStyle(kpi, '::before').content : null,
      firaLoaded: document.fonts.check('600 16px "Fira Sans"'),
      external: performance.getEntriesByType('resource').map((r) => r.name).filter((u) => !u.startsWith(location.origin) && !u.startsWith('data:') && !u.startsWith('blob:')),
      firaReq: performance.getEntriesByType('resource').filter((r) => /Fira/.test(r.name)).map((r) => r.name.replace(location.origin, '')),
    };
  })()`);
  check('el HTML autocontenido del informe también lleva data-ds="v2" en <body>',
    /<body class="ql-standalone" data-ds="v2">/.test(readFileSync(APP_ROOT + '/js/modules/informe.js', 'utf8')));
  check('index.html: data-ds="v2" en <body>', /<body data-ds="v2">/.test(readFileSync(APP_ROOT + '/index.html', 'utf8')));
  try {
    await c.goto(); await sleep(1500);
    await c.ev(LOAD_ALL); await sleep(1000);
    await c.ev(`location.hash = '#/'`); await sleep(1500);
    const home = await probe();
    check('<body> lleva data-ds="v2"', home.ds === 'v2', JSON.stringify(home.ds));
    check('título de la portada en Fira Sans', /^"?Fira Sans/.test(home.h1Font), home.h1Font);
    check('botón primario con el azul de marca v2 (#00107C)', home.btnBg === 'rgb(0, 16, 124)', home.btnBg);
    check('«Generar informe completo» (barra lateral) con el mismo azul que la portada', home.ctaBg === home.btnBg, home.ctaBg);
    check('barra lateral y pie en Fira Sans', /^"?Fira Sans/.test(home.sidebarFont) && /^"?Fira Sans/.test(home.footerFont), home.sidebarFont + ' | ' + home.footerFont);
    check('Fira Sans cargada, desde el propio origen (fonts/)', home.firaLoaded && home.firaReq.length > 0 && home.firaReq.every((u) => u.startsWith('/fonts/')), JSON.stringify(home.firaReq));
    check('ninguna petición externa', home.external.length === 0, home.external.join(', '));

    await c.ev(`location.hash = '#/alfa'`); await sleep(2200);
    const alfa = await probe();
    check('#/alfa: v2 sigue activo al cambiar de módulo (título en Fira Sans, azul de marca)', alfa.ds === 'v2' && /^"?Fira Sans/.test(alfa.h1Font) && alfa.viewAccent === '#00107c', JSON.stringify({ h1: alfa.h1Font, accent: alfa.viewAccent }));
    check('#/alfa: la figura conserva IBM Plex (marcas de eje en IBM Plex Mono)', /IBM Plex Mono/.test(alfa.tickFont || ''), String(alfa.tickFont));
    check('#/alfa: las cifras de KPI no llevan el punto de estado de la portada', alfa.kpiDot === 'none', String(alfa.kpiDot));

    await c.ev(`(async () => { const { setTheme } = await import('/js/lib/theme.js'); setTheme('dark'); })()`);
    await c.ev(`location.hash = '#/'`); await sleep(1500);
    const dark = await probe();
    check('oscuro: portada con el azul claro derivado (#93C5FD)', dark.ds === 'v2' && dark.btnBg === 'rgb(147, 197, 253)', dark.btnBg);
    await c.ev(`location.hash = '#/beta'`); await sleep(1500);
    const beta = await probe();
    check('oscuro: #/beta con el azul de marca v2 (#93C5FD), no el teal', beta.viewAccent === '#93c5fd', beta.viewAccent);

    // ---- 3. encabezado de identidad (js/lib/brand.js) en los 4 breakpoints ----
    console.log('\n--- 3. encabezado: wordmark + motivo (375/768/1024/1440, claro y oscuro) ---');
    const HERO = `(async () => {
      await document.fonts.ready;
      const hero = document.querySelector('#app-view .ql-hero-brand');
      if (!hero) return null;
      const wm = hero.querySelector('.ql-wordmark-hero') || hero.querySelector('.ql-hero-title');
      const motifBox = hero.querySelector('.ql-hero-motif');
      const svg = motifBox.querySelector('svg');
      const ms = getComputedStyle(motifBox);
      const m = motifBox.getBoundingClientRect();
      // opacidad efectiva máxima del motivo detrás de cada texto: opacidad ×
      // máscara (lineal de transparente en el borde izquierdo a opaca en fade%)
      const fade = parseFloat((ms.maskImage || ms.webkitMaskImage || '').match(/([\\d.]+)%\\)?\\s*$/)?.[1] || '0') / 100 || 0.0001;
      const alphaAt = (x) => x <= m.left ? 0 : Number(ms.opacity) * Math.min(1, (x - m.left) / (fade * m.width));
      const parse = (c) => c.match(/[\\d.]+/g).slice(0, 3).map(Number);
      const page = parse(getComputedStyle(document.body).backgroundColor);
      const motifRgb = parse(ms.color);
      const texts = [...hero.querySelectorAll('.ql-eyebrow, .ql-hero-title, .ql-hero-sub')].map((el) => {
        const r = el.getBoundingClientRect();
        const overlapsY = r.bottom > m.top && r.top < m.bottom;
        return { cls: el.className, fg: parse(getComputedStyle(el).color), alpha: overlapsY ? alphaAt(r.right) : 0 };
      });
      return {
        font: getComputedStyle(wm).fontFamily, weight: getComputedStyle(wm).fontWeight, size: parseFloat(getComputedStyle(wm).fontSize),
        color: getComputedStyle(wm).color, accent: getComputedStyle(wm).getPropertyValue('--accent').trim(), text: wm.textContent,
        h1: wm.closest('h1') !== null,
        motifShown: ms.display !== 'none' && m.width > 150 && svg.getBoundingClientRect().height > 60,
        tree: !!svg.querySelector('.ql-motif-tree'), dots: svg.querySelectorAll('.ql-motif-dots circle').length,
        page, motifRgb, texts,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sidebarWm: getComputedStyle(document.querySelector('#sidebar .ql-wordmark')).fontFamily,
      };
    })()`;
    const lumC = (rgb) => lum(rgb.map(Math.round));
    const ratioRgb = (a, b) => { const x = lumC(a), y = lumC(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    for (const theme of ['light', 'dark']) {
      await c.ev(`(async () => { const { setTheme } = await import('/js/lib/theme.js'); setTheme('${theme}'); })()`);
      for (const w of [375, 768, 1024, 1440]) {
        await c.setViewport(w, 900);
        await c.ev(`location.hash = '#/glosario'`); await sleep(500);
        await c.ev(`location.hash = '#/'`); await sleep(1200);
        const h = await c.ev(HERO);
        const tag = `${theme === 'light' ? 'claro' : 'oscuro'} ${w}px`;
        if (!h) { check(`${tag}: hay encabezado de identidad`, false); continue; }
        check(`${tag}: wordmark «Smart-175» en <h1>, Fira Sans 700, color de marca, ≥ 44px`,
          h.text === 'Smart-175' && h.h1 && /^"?Fira Sans/.test(h.font) && Number(h.weight) >= 700 && h.size >= 44,
          JSON.stringify({ font: h.font, weight: h.weight, size: h.size, text: h.text }));
        check(`${tag}: motivo (dendrograma + nube de puntos) visible`, h.motifShown && h.tree && h.dots >= 20, JSON.stringify({ shown: h.motifShown, dots: h.dots }));
        check(`${tag}: sin scroll horizontal`, h.overflow <= 0, String(h.overflow));
        const worst = h.texts.map((tx) => {
          const bg = h.motifRgb.map((v, i) => v * tx.alpha + h.page[i] * (1 - tx.alpha));
          return [tx.cls, ratioRgb(tx.fg, bg), tx.alpha];
        }).sort((a, b) => a[1] - b[1])[0];
        check(`${tag}: texto del encabezado ≥ 4,5:1 sobre el trazo más denso del motivo`, worst[1] >= 4.5,
          worst[0] + ' ' + worst[1].toFixed(2) + ' (opacidad efectiva ' + worst[2].toFixed(2) + ')');
        console.log(`      peor: ${worst[0]} ${worst[1].toFixed(2)}:1 con el motivo a opacidad efectiva ${worst[2].toFixed(2)}`);
        if (w === 1440) check(`${tag}: la barra lateral usa el mismo wordmark (Fira Sans)`, /^"?Fira Sans/.test(h.sidebarWm), h.sidebarWm);
      }
      // el mismo encabezado en las páginas de consulta (pageHero): glosario
      for (const w of [375, 1440]) {
        await c.setViewport(w, 900);
        await c.ev(`location.hash = '#/glosario'`); await sleep(1200);
        const h = await c.ev(HERO);
        const tag = `${theme === 'light' ? 'claro' : 'oscuro'} ${w}px #/glosario`;
        if (!h) { check(`${tag}: encabezado con motivo`, false); continue; }
        check(`${tag}: motivo visible, sin scroll horizontal`, h.motifShown && h.dots >= 20 && h.overflow <= 0, JSON.stringify({ shown: h.motifShown, overflow: h.overflow }));
        const worst = h.texts.map((tx) => {
          const bg = h.motifRgb.map((v, i) => v * tx.alpha + h.page[i] * (1 - tx.alpha));
          return [tx.cls, ratioRgb(tx.fg, bg), tx.alpha];
        }).sort((a, b) => a[1] - b[1])[0];
        check(`${tag}: texto del encabezado ≥ 4,5:1 sobre el motivo`, worst[1] >= 4.5, worst[0] + ' ' + worst[1].toFixed(2));
      }
    }
    check('0 errores de consola', c.problems.length === 0, c.problems.slice(0, 3).join(' | '));
  } catch (e) {
    check('sin excepciones', false, e.stack || String(e));
  } finally {
    c.kill();
    if (server.started) server.stop();
  }
}

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
