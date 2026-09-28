// tests/design-v2.mjs
// Sistema de diseño v2 — piloto en la portada (css/tokens.css [data-ds="v2"],
// design-system/smart-175/MASTER.md):
//   1. estático: contraste WCAG de los tokens v2 en claro y oscuro (texto
//      ≥ 4,5:1), incluido el texto de estado --good-ink sobre su insignia
//   2. navegador: la portada lleva data-ds="v2" con Fira Sans y el azul del
//      MASTER; al salir a otro módulo el atributo desaparece y todo vuelve a
//      IBM Plex + teal (el resto de la app no cambia); Fira se sirve desde el
//      propio origen, sin ninguna petición externa; 0 errores de consola.

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
check('v2 no redefine ningún color de DATOS', !Object.keys({ ...LIGHT, ...DARK }).some((k) => /^(cat-\d|enriched|depleted|neutral|corr-|good$|warning|critical)/.test(k)));

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
  const bad = pairs.filter(([, r]) => r < 4.5);
  check(`${name}: todo el texto v2 ≥ 4,5:1`, bad.length === 0, bad.map(([n, r]) => n + ' ' + r.toFixed(2)).join(', '));
  console.log('      ' + pairs.map(([n, r]) => n + ' ' + r.toFixed(1)).join(' · '));
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
  console.log('\n--- 2. portada piloto ---');
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
    return {
      ds: v.getAttribute('data-ds'),
      h1Font: h1 ? getComputedStyle(h1).fontFamily : '',
      btnBg: btn ? getComputedStyle(btn).backgroundColor : '',
      sidebarFont: getComputedStyle(document.querySelector('.ql-nav-item')).fontFamily,
      firaLoaded: document.fonts.check('600 16px "Fira Sans"'),
      external: performance.getEntriesByType('resource').map((r) => r.name).filter((u) => !u.startsWith(location.origin) && !u.startsWith('data:') && !u.startsWith('blob:')),
      firaReq: performance.getEntriesByType('resource').filter((r) => /Fira/.test(r.name)).map((r) => r.name.replace(location.origin, '')),
    };
  })()`);
  try {
    await c.goto(); await sleep(1500);
    await c.ev(LOAD_ALL); await sleep(1000);
    await c.ev(`location.hash = '#/'`); await sleep(1500);
    const home = await probe();
    check('la portada lleva data-ds="v2"', home.ds === 'v2', JSON.stringify(home.ds));
    check('título de la portada en Fira Sans', /^"?Fira Sans/.test(home.h1Font), home.h1Font);
    check('botón primario con el azul de marca v2 (#00107C)', home.btnBg === 'rgb(0, 16, 124)', home.btnBg);
    check('Fira Sans cargada, desde el propio origen (fonts/)', home.firaLoaded && home.firaReq.length > 0 && home.firaReq.every((u) => u.startsWith('/fonts/')), JSON.stringify(home.firaReq));
    check('ninguna petición externa', home.external.length === 0, home.external.join(', '));
    check('la barra lateral sigue en IBM Plex (fuera del piloto)', /IBM Plex Sans/.test(home.sidebarFont), home.sidebarFont);

    await c.ev(`location.hash = '#/alfa'`); await sleep(1800);
    const alfa = await probe();
    check('al salir de la portada se retira data-ds', alfa.ds === null, JSON.stringify(alfa.ds));
    check('#/alfa sigue con IBM Plex Serif en el título', /IBM Plex Serif/.test(alfa.h1Font), alfa.h1Font);

    await c.ev(`(async () => { const { setTheme } = await import('/js/lib/theme.js'); setTheme('dark'); })()`);
    await c.ev(`location.hash = '#/'`); await sleep(1500);
    const dark = await probe();
    check('oscuro: portada con el azul claro derivado (#93C5FD)', dark.ds === 'v2' && dark.btnBg === 'rgb(147, 197, 253)', dark.btnBg);
    await c.ev(`location.hash = '#/beta'`); await sleep(1500);
    const beta = await c.ev(`({ ds: document.getElementById('app-view').getAttribute('data-ds'), accent: getComputedStyle(document.getElementById('app-view')).getPropertyValue('--accent').trim() })`);
    check('oscuro: #/beta conserva el teal de siempre', beta.ds === null && beta.accent === '#57c9be', JSON.stringify(beta));

    // ---- 3. encabezado de identidad (js/lib/brand.js) en los 4 breakpoints ----
    console.log('\n--- 3. encabezado: wordmark + motivo (375/768/1024/1440, claro y oscuro) ---');
    const HERO = `(async () => {
      await document.fonts.ready;
      const hero = document.querySelector('#app-view .ql-hero-brand');
      if (!hero) return null;
      const wm = hero.querySelector('.ql-wordmark-hero');
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
      const texts = [...hero.querySelectorAll('.ql-eyebrow, .ql-wordmark-hero, .ql-hero-sub')].map((el) => {
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
