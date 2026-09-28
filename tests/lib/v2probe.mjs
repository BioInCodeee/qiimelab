// Sondeo v2 de una vista (tests/design-v2-modules.mjs). Se evalúa en la página
// y devuelve, para #app-view + barra lateral + pie:
//   lowText        texto visible por debajo de 4,5:1 (3:1 si es grande) contra
//                  su fondo real (se componen los fondos semitransparentes)
//   accentInChart  marcas de una figura (<svg> de datos) pintadas con el azul
//                  de marca: la marca no va dentro de las figuras (tarea 5).
//                  Fuera: iconos, botones y controles interactivos de la figura
//                  (asas role=slider, contornos del editor .ce-*)
//   teal           restos del teal de antes de v2
//   plexUI         texto de interfaz en IBM Plex (solo las figuras lo conservan)
// Se omiten: lo decorativo (aria-hidden), lo atenuado/deshabilitado (exento en
// WCAG) y el texto SVG que va sobre celdas/barras (su fondo no es el contenedor).
export const V2_PROBE = `
(() => {
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const toRgba = (c) => {
    if (!c || c === 'none' || c === 'transparent') return null;
    if (c.startsWith('url(')) return null;
    let m = c.match(/^rgba?\\(([^)]+)\\)/);
    if (m) { const p = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
    m = c.match(/^color\\(srgb ([^)]+)\\)/);
    if (m) { const p = m[1].split(/[\\s\\/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
    // oklab/oklch u otros: que los resuelva el canvas
    cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1);
    const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
  };
  const lum = (r) => { const c = r.slice(0, 3).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (fg, bg) => { const a = fg[3]; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1); };
  const rootBg = toRgba(getComputedStyle(document.body).backgroundColor);
  const bgOf = (el) => {
    const stack = [];
    let unknown = false;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage && s.backgroundImage !== 'none' && !(e.tagName === 'BODY' || e.tagName === 'HTML')) unknown = true;
      const b = toRgba(s.backgroundColor);
      if (b && b[3] > 0) { stack.push(b); if (b[3] >= 1) break; }
    }
    let bg = rootBg;
    for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg);
    return { bg, unknown };
  };
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const faded = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { if (Number(getComputedStyle(e).opacity) < 1) return true; if (e.disabled || e.getAttribute('aria-disabled') === 'true') return true; } return false; };
  const accent = toRgba(getComputedStyle(document.body).getPropertyValue('--accent').trim());
  const accent2 = toRgba(getComputedStyle(document.body).getPropertyValue('--accent-2').trim());
  const same = (a, b) => a && b && a[3] > 0 && Math.abs(a[0] - b[0]) < 2 && Math.abs(a[1] - b[1]) < 2 && Math.abs(a[2] - b[2]) < 2;
  const TEAL = ['#12615f', '#17756f', '#57c9be', '#74d6cb'].map(toRgba);
  const out = { lowText: [], fadedLow: 0, accentInChart: [], teal: [], plexUI: [], unknownBg: 0, nText: 0 };
  const scope = [document.getElementById('app-view'), document.getElementById('sidebar'), document.getElementById('app-footer')];
  const desc = (el) => {
    const cls = typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls.trim().split(/\\s+/).slice(0, 2).join('.') : '') + ' «' + (el.textContent || '').trim().slice(0, 30) + '»';
  };
  scope.forEach((root) => {
    if (!root) return;
    root.querySelectorAll('*').forEach((el) => {
      if (!vis(el)) return;
      const s = getComputedStyle(el);
      const inSvg = !!el.closest('svg');
      // restos del teal
      ['color', 'backgroundColor', 'borderTopColor', 'fill', 'stroke'].forEach((p) => {
        const c = toRgba(s[p]); if (c && TEAL.some((t) => same(c, t))) out.teal.push(desc(el) + ' ' + p);
      });
      // IBM Plex fuera de figuras
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (hasText && !inSvg && /IBM Plex/.test(s.fontFamily.split(',')[0])) out.plexUI.push(desc(el));
      // marca dentro de figuras (svg de datos, no iconos)
      if (inSvg && !el.closest('.ql-nav-icon, .ql-btn, button, .ql-brand, .ql-hero-motif, [role="slider"], [class*="ce-"]') && el.tagName !== 'svg') {
        const svg = el.closest('svg');
        const r = svg.getBoundingClientRect();
        if (r.width >= 80 && r.height >= 60) {
          ['fill', 'stroke'].forEach((p) => {
            const c = toRgba(s[p]);
            if (same(c, accent) || same(c, accent2)) out.accentInChart.push(desc(el) + ' ' + p);
          });
        }
      }
      if (!hasText) return;
      if (el.closest('[aria-hidden="true"]')) return; // decorativo
      out.nText++;
      // texto SVG que no es rótulo de eje/leyenda/título: puede ir sobre una
      // celda o barra (mapa de calor), su fondo no es el del contenedor
      if (inSvg && !/ql-(tick|axis)-label|legend|title/.test(el.getAttribute('class') || '')) { out.unknownBg++; return; }
      const fg = toRgba(inSvg ? s.fill : s.color);
      if (!fg || fg[3] === 0) return;
      const { bg, unknown } = bgOf(inSvg ? el.closest('svg').parentElement : el);
      if (unknown) { out.unknownBg++; return; }
      const r = ratio(over(fg, bg), bg);
      const size = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 700;
      const min = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
      if (r < min) {
        if (faded(el)) { out.fadedLow++; return; }
        out.lowText.push(desc(el) + ' ' + r.toFixed(2) + (inSvg ? ' [svg]' : ''));
      }
    });
  });
  const uniq = (a) => [...new Map(a.map((x) => [x.replace(/ «.*»/, '') + (x.match(/ [\\d.]+( \\[svg\\])?$/) || [''])[0], x])).values()];
  out.lowText = uniq(out.lowText).slice(0, 40);
  out.accentInChart = uniq(out.accentInChart).slice(0, 20);
  out.teal = uniq(out.teal).slice(0, 20);
  out.plexUI = uniq(out.plexUI).slice(0, 20);
  return out;
})()
`;
