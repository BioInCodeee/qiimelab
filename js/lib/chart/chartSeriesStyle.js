// chartSeriesStyle.js — controles por serie del panel de paleta: color sólido
// (con aviso de choque), degradado, patrón, opacidad y borde.
//
// Parte del editor de figuras troceado desde js/lib/chartEditor.js (Fase 0b,
// sin cambios de comportamiento). Reparto y patrón `ctx`: js/lib/chart/chartEditor.js.

import { defaultGradient, defaultPattern } from '../paletteStyle.js';
import { checkAgainstPalette, isValidHex } from '../paletteValidator.js';

export function createSeriesStyle(ctx) {
  const {
    T, paletteSeries, seriesStyle, setSeriesBorder, setSeriesColor, setSeriesFillType,
    setSeriesGradient, setSeriesOpacity, setSeriesPattern, svg,
  } = ctx;

  /** Aviso de choque de color (ya existía antes de la Fase 2) — extraído a
   *  su propia función porque ahora lo consumen tanto el control sólido
   *  como el degradado (sobre su parada dominante, ver Paso 6: "sigue
   *  aplicando sobre el color representativo, no se desactiva para las
   *  series con relleno no sólido"). */
  function clashWarningFor(i, hex, currentHexes) {
    const warn = document.createElement('p');
    warn.className = 'ce-pal-warn';
    const paint = (h) => {
      warn.textContent = '';
      if (!h) return;
      if (!isValidHex(h)) { warn.textContent = '⚠ ' + T.paletteInvalidHex; return; }
      const others = paletteSeries.map((s2, j) => (j === i ? null : currentHexes[j])).filter(Boolean);
      const res = checkAgainstPalette(h, others);
      if (res.verdict === 'PASS') return;
      if (res.reason === 'clash') {
        const otherLabel = (paletteSeries.find((s2, j) => currentHexes[j] === res.other) || {}).label || res.other;
        warn.textContent = '⚠ ' + T.paletteWarnClash(otherLabel);
      } else if (res.reason === 'contrast') {
        warn.textContent = '⚠ ' + T.paletteWarnContrast;
      }
    };
    paint(hex);
    return { el: warn, paint };
  }

  /** Sólido (Paso 1, ya existía): color + campo hex, con vista previa en
   *  vivo sin persistir hasta confirmar — igual que siempre, solo que
   *  ahora vive en su propia función porque el resto de la fila cambia
   *  según el tipo de relleno elegido. */
  function renderSolidControls(s, i, currentHexes, paintWarn) {
    const wrap = document.createElement('div');
    wrap.className = 'ce-pal-solid';
    const hex = currentHexes[i];

    const colorId = 'ce-pal-c-' + (++ctx.cePanelUid);
    const inpColor = document.createElement('input');
    inpColor.type = 'color'; inpColor.id = colorId;
    inpColor.value = isValidHex(hex) ? hex : '#888888';
    inpColor.setAttribute('aria-label', s.label + ' — ' + T.color);

    const inpHex = document.createElement('input');
    inpHex.type = 'text'; inpHex.className = 'ce-hexfield';
    inpHex.value = (isValidHex(hex) ? hex : '').toUpperCase();
    inpHex.setAttribute('aria-label', s.label + ' — ' + T.hex);
    inpHex.placeholder = '#RRGGBB';

    const preview = (h) => {
      const ok = h === '' || isValidHex(h);
      svg.querySelectorAll('[data-ce-series-fill="' + s.id + '"]').forEach((n) => { n.style.fill = ok ? h : ''; });
      if (!seriesStyle(s.id).border) {
        svg.querySelectorAll('[data-ce-series-stroke="' + s.id + '"]').forEach((n) => { n.style.stroke = ok ? h : ''; });
      }
    };
    const commit = (h) => { if (!h || isValidHex(h)) setSeriesColor(s.id, h || null); };

    inpColor.addEventListener('input', () => { inpHex.value = inpColor.value.toUpperCase(); paintWarn(inpColor.value); preview(inpColor.value); });
    inpColor.addEventListener('change', () => commit(inpColor.value));
    inpHex.addEventListener('input', () => {
      let v = inpHex.value.trim();
      if (v && v[0] !== '#') v = '#' + v;
      paintWarn(v);
      if (isValidHex(v)) { inpColor.value = v; preview(v); }
    });
    inpHex.addEventListener('change', () => {
      let v = inpHex.value.trim();
      if (v && v[0] !== '#') v = '#' + v;
      if (!v || isValidHex(v)) commit(v);
    });
    inpHex.addEventListener('keydown', (e) => { if (e.key === 'Enter') inpHex.blur(); });

    wrap.appendChild(inpColor);
    wrap.appendChild(inpHex);
    return wrap;
  }

  /** Degradado (Paso 3): 2-3 paradas + ángulo. Se siembra con
   *  defaultGradient() la primera vez (ver setSeriesFillType) así que aquí
   *  `style.gradient` ya existe siempre que fillType === 'gradient'. */
  function renderGradientControls(s, style, paintWarn) {
    const wrap = document.createElement('div');
    wrap.className = 'ce-pal-gradient';
    const grad = style.gradient || defaultGradient(style.color);
    const stops = grad.stops && grad.stops.length >= 2 ? grad.stops : defaultGradient(style.color).stops;
    const commitGrad = (next) => setSeriesGradient(s.id, next);

    const stopsRow = document.createElement('div');
    stopsRow.className = 'ce-pal-grad-stops';
    stops.forEach((st, idx) => {
      const cInp = document.createElement('input');
      cInp.type = 'color'; cInp.value = isValidHex(st.color) ? st.color : '#888888';
      cInp.setAttribute('aria-label', s.label + ' — ' + T.paletteGradientStop(idx + 1));
      cInp.addEventListener('input', () => { if (idx === 0) paintWarn(cInp.value); });
      cInp.addEventListener('change', () => {
        commitGrad({ ...grad, stops: stops.map((s2, j) => (j === idx ? { ...s2, color: cInp.value } : s2)) });
      });
      stopsRow.appendChild(cInp);
    });
    wrap.appendChild(stopsRow);

    if (stops.length < 3) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button'; addBtn.className = 'ql-btn ql-btn-ghost'; addBtn.textContent = T.paletteAddStop;
      addBtn.addEventListener('click', () => {
        commitGrad({ ...grad, stops: [stops[0], { color: stops[0].color, pos: 50 }, stops[stops.length - 1]] });
      });
      wrap.appendChild(addBtn);
    } else {
      const rmBtn = document.createElement('button');
      rmBtn.type = 'button'; rmBtn.className = 'ql-btn ql-btn-ghost'; rmBtn.textContent = T.paletteRemoveStop;
      rmBtn.addEventListener('click', () => commitGrad({ ...grad, stops: [stops[0], stops[stops.length - 1]] }));
      wrap.appendChild(rmBtn);
    }

    const angleId = 'ce-pal-ga-' + (++ctx.cePanelUid);
    const angleLab = document.createElement('label');
    angleLab.setAttribute('for', angleId); angleLab.textContent = T.paletteGradientAngle;
    const angleInp = document.createElement('input');
    angleInp.type = 'number'; angleInp.id = angleId; angleInp.min = '0'; angleInp.max = '359'; angleInp.step = '15';
    angleInp.value = String(grad.angle != null ? grad.angle : 90);
    angleInp.addEventListener('change', () => {
      let v = parseFloat(angleInp.value);
      if (!Number.isFinite(v)) v = 0;
      commitGrad({ ...grad, angle: ((v % 360) + 360) % 360 });
    });
    wrap.appendChild(angleLab);
    wrap.appendChild(angleInp);

    return wrap;
  }

  /** Patrón (Paso 4): rayado diagonal / puntos / cuadrícula, trazo + fondo
   *  (transparente por defecto — un rayado de verdad, no un bloque de
   *  color con líneas encima) + separación + grosor, y ángulo solo para el
   *  rayado diagonal (los otros 2 tipos no lo usan). */
  function renderPatternControls(s, style) {
    const wrap = document.createElement('div');
    wrap.className = 'ce-pal-pattern';
    const pat = style.pattern || defaultPattern(style.color);
    const commitPat = (next) => setSeriesPattern(s.id, next);

    const kindId = 'ce-pal-pk-' + (++ctx.cePanelUid);
    const kindLab = document.createElement('label'); kindLab.setAttribute('for', kindId); kindLab.textContent = T.palettePatternKind;
    const kindSel = document.createElement('select'); kindSel.id = kindId;
    [['diagonal', T.palettePatternDiagonal], ['dots', T.palettePatternDots], ['grid', T.palettePatternGrid]].forEach(([val, label]) => {
      const o = document.createElement('option'); o.value = val; o.textContent = label;
      if (val === (pat.kind || 'diagonal')) o.selected = true;
      kindSel.appendChild(o);
    });
    kindSel.addEventListener('change', () => commitPat({ ...pat, kind: kindSel.value }));
    wrap.appendChild(kindLab); wrap.appendChild(kindSel);

    const fgInp = document.createElement('input');
    fgInp.type = 'color'; fgInp.value = isValidHex(pat.fg) ? pat.fg : '#888888';
    fgInp.setAttribute('aria-label', s.label + ' — ' + T.palettePatternFg);
    fgInp.addEventListener('change', () => commitPat({ ...pat, fg: fgInp.value }));
    wrap.appendChild(fgInp);

    const bgTransparent = !pat.bg || pat.bg === 'transparent';
    const bgInp = document.createElement('input');
    bgInp.type = 'color'; bgInp.value = isValidHex(pat.bg) ? pat.bg : '#ffffff';
    bgInp.disabled = bgTransparent;
    bgInp.setAttribute('aria-label', s.label + ' — ' + T.palettePatternBg);
    bgInp.addEventListener('change', () => { if (!bgChk.checked) commitPat({ ...pat, bg: bgInp.value }); });
    const bgChkId = 'ce-pal-pbgc-' + (++ctx.cePanelUid);
    const bgChk = document.createElement('input');
    bgChk.type = 'checkbox'; bgChk.id = bgChkId; bgChk.checked = bgTransparent;
    bgChk.addEventListener('change', () => {
      bgInp.disabled = bgChk.checked;
      commitPat({ ...pat, bg: bgChk.checked ? 'transparent' : bgInp.value });
    });
    const bgLab = document.createElement('label'); bgLab.setAttribute('for', bgChkId); bgLab.textContent = T.palettePatternTransparentBg;
    wrap.appendChild(bgInp); wrap.appendChild(bgChk); wrap.appendChild(bgLab);

    const numField = (labelText, val, min, max, step, onChange) => {
      const span = document.createElement('span'); span.className = 'ce-pal-pat-num';
      const id = 'ce-pal-pn-' + (++ctx.cePanelUid);
      const lab = document.createElement('label'); lab.setAttribute('for', id); lab.textContent = labelText;
      const inp = document.createElement('input');
      inp.type = 'number'; inp.id = id; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(val);
      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v)) return;
        onChange(Math.max(min, Math.min(max, v)));
      });
      span.appendChild(lab); span.appendChild(inp);
      return span;
    };
    wrap.appendChild(numField(T.palettePatternSpacing, pat.spacing != null ? pat.spacing : 8, 3, 30, 1, (v) => commitPat({ ...pat, spacing: v })));
    wrap.appendChild(numField(T.palettePatternStroke, pat.strokeWidth != null ? pat.strokeWidth : 2, 0.5, 8, 0.5, (v) => commitPat({ ...pat, strokeWidth: v })));
    if ((pat.kind || 'diagonal') === 'diagonal') {
      wrap.appendChild(numField(T.palettePatternAngle, pat.angle != null ? pat.angle : 45, 0, 179, 5, (v) => commitPat({ ...pat, angle: v })));
    }

    return wrap;
  }

  /** Opacidad (Paso 2) — un control por serie, independiente del tipo de
   *  relleno (se aplica igual a sólido/degradado/patrón). */
  function renderOpacityControl(s) {
    const row = document.createElement('div');
    row.className = 'ce-pal-opacity';
    const curOpacity = seriesStyle(s.id).opacity;
    const opId = 'ce-pal-op-' + (++ctx.cePanelUid);
    const lab = document.createElement('label');
    lab.setAttribute('for', opId); lab.textContent = T.paletteOpacity;
    const opRange = document.createElement('input');
    opRange.type = 'range'; opRange.id = opId; opRange.min = '0'; opRange.max = '100'; opRange.step = '5';
    opRange.value = String(Math.round((curOpacity != null ? curOpacity : 1) * 100));
    opRange.setAttribute('aria-label', s.label + ' — ' + T.paletteOpacity);
    const opNum = document.createElement('span');
    opNum.className = 'ce-pal-op-val';
    opNum.textContent = opRange.value + '%';
    opRange.addEventListener('input', () => { opNum.textContent = opRange.value + '%'; });
    opRange.addEventListener('change', () => setSeriesOpacity(s.id, Math.max(0, Math.min(100, +opRange.value)) / 100));
    row.appendChild(lab); row.appendChild(opRange); row.appendChild(opNum);
    return row;
  }

  /** Borde independiente (Paso 5) — color/grosor/radio de esquina aparte
   *  del relleno. `<details>` nativo (sin estado propio que mantener): se
   *  abre solo si ya hay un borde configurado. El radio de esquina solo
   *  tiene efecto visual en series dibujadas con <rect> (applyPalette lo
   *  ignora en <path>/<circle> — Venn, puntos de dispersión…) pero el
   *  control se muestra igual: no sabemos de antemano la forma de cada
   *  serie sin auditar cada módulo, y dejarlo sin efecto ahí es inofensivo. */
  function renderBorderControls(s, style) {
    const det = document.createElement('details');
    det.className = 'ce-pal-border';
    if (style.border) det.open = true;
    const sum = document.createElement('summary'); sum.textContent = T.paletteBorderTitle;
    det.appendChild(sum);

    const b = style.border || {};
    const commitBorder = (next) => setSeriesBorder(s.id, next);
    const body = document.createElement('div');
    body.className = 'ce-pal-border-body';

    const field = (labelText, inputEl) => {
      const row = document.createElement('div'); row.className = 'ce-pal-border-row';
      const lab = document.createElement('label'); lab.setAttribute('for', inputEl.id); lab.textContent = labelText;
      row.appendChild(lab); row.appendChild(inputEl);
      return row;
    };

    const cInp = document.createElement('input');
    cInp.type = 'color'; cInp.id = 'ce-pal-bc-' + (++ctx.cePanelUid);
    cInp.value = isValidHex(b.color) ? b.color : (isValidHex(style.color) ? style.color : '#000000');
    cInp.addEventListener('change', () => commitBorder({ ...b, color: cInp.value }));
    body.appendChild(field(T.paletteBorderColor, cInp));

    const wInp = document.createElement('input');
    wInp.type = 'number'; wInp.id = 'ce-pal-bw-' + (++ctx.cePanelUid);
    wInp.min = '0'; wInp.max = '10'; wInp.step = '0.5'; wInp.value = String(b.width != null ? b.width : 1.5);
    wInp.addEventListener('change', () => {
      const v = parseFloat(wInp.value);
      if (Number.isFinite(v)) commitBorder({ ...b, width: Math.max(0, Math.min(10, v)) });
    });
    body.appendChild(field(T.paletteBorderWidth, wInp));

    const rInp = document.createElement('input');
    rInp.type = 'number'; rInp.id = 'ce-pal-br-' + (++ctx.cePanelUid);
    rInp.min = '0'; rInp.max = '30'; rInp.step = '1'; rInp.value = String(b.radius != null ? b.radius : 0);
    rInp.addEventListener('change', () => {
      const v = parseFloat(rInp.value);
      if (Number.isFinite(v)) commitBorder({ ...b, radius: Math.max(0, Math.min(30, v)) });
    });
    body.appendChild(field(T.paletteBorderRadius, rInp));

    det.appendChild(body);
    return det;
  }

  /** Una fila completa por serie: cabecera (etiqueta + selector de tipo de
   *  relleno) + controles según el tipo elegido + opacidad + borde +
   *  aviso de choque de color (Paso 6: jerarquía sólido/degradado/patrón
   *  mutuamente excluyente, opacidad y borde independientes de esa
   *  elección). */
  function renderSeriesRow(s, i, currentHexes) {
    const style = seriesStyle(s.id);
    const fillType = style.fillType || 'solid';

    const block = document.createElement('div');
    block.className = 'ce-pal-row-block';

    const head = document.createElement('div');
    head.className = 'ce-pal-row-head';
    const lab = document.createElement('label');
    lab.textContent = s.label;
    const ftId = 'ce-pal-ft-' + (++ctx.cePanelUid);
    lab.setAttribute('for', ftId);
    head.appendChild(lab);

    const ftSel = document.createElement('select');
    ftSel.id = ftId;
    [['solid', T.paletteFillSolid], ['gradient', T.paletteFillGradient], ['pattern', T.paletteFillPattern]].forEach(([val, label]) => {
      const o = document.createElement('option'); o.value = val; o.textContent = label;
      if (val === fillType) o.selected = true;
      ftSel.appendChild(o);
    });
    ftSel.addEventListener('change', () => setSeriesFillType(s.id, ftSel.value));
    head.appendChild(ftSel);
    block.appendChild(head);

    const { el: warnEl, paint: paintWarn } = clashWarningFor(i, currentHexes[i], currentHexes);

    const fillWrap = document.createElement('div');
    fillWrap.className = 'ce-pal-row-fill';
    if (fillType === 'gradient') fillWrap.appendChild(renderGradientControls(s, style, paintWarn));
    else if (fillType === 'pattern') fillWrap.appendChild(renderPatternControls(s, style));
    else fillWrap.appendChild(renderSolidControls(s, i, currentHexes, paintWarn));
    block.appendChild(fillWrap);

    block.appendChild(renderOpacityControl(s));
    block.appendChild(renderBorderControls(s, style));
    block.appendChild(warnEl);

    return block;
  }

  return { renderSeriesRow };
}
