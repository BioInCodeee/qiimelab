// chartLegacyDialog.js — openChartEditor: el diálogo modal LEGACY (ver la
// decisión de arquitectura en chart/chartEditor.js). Sin usos en la app; no
// añadir casos de uso nuevos.
//
// Parte del editor de figuras troceado desde js/lib/chartEditor.js (Fase 0b,
// sin cambios de comportamiento). Reparto y patrón `ctx`: js/lib/chart/chartEditor.js.

import { escapeHtml } from '../dom.js';
import { exportPng, exportSvg } from './chartExport.js';
import { FONTS } from './chartFigureStyle.js';
import { CE_ICONS } from './chartStyles.js';

// =========================================================================
//  INFRAESTRUCTURA DEL EDITOR GRÁFICO GLOBAL (<dialog> MODAL)
// =========================================================================

/**
 * Abre un diálogo modal <dialog> amplio para editar en tiempo real los
 * parámetros de tipografía, colores y geometría de una gráfica.
 *
 * @param {Element|string} chartRef - Referencia al SVG, contenedor o clave del gráfico
 * @param {Object} [configOptions] - Parámetros de configuración iniciales
 * @param {Function} [onUpdate] - Callback en tiempo real (currentConfig, changedKey, changedValue)
 * @returns {{ dialog: HTMLDialogElement, close: () => void }}
 */
/**
 * @deprecated Vía de edición legacy — ver la nota de arquitectura al
 * principio del archivo (22 sep 2026). Sin uso en el repo desde que el
 * diagrama aluvial de taxaBarplot.js migró a `attachChartEditor` +
 * `cfg.geometrySliders`. No añadir casos de uso nuevos; se conserva el
 * código por ahora como red de seguridad, no como API recomendada.
 */
export function openChartEditor(chartRef, configOptions = {}, onUpdate = () => {}) {
  // 1. Cerrar cualquier diálogo de edición previo para evitar duplicados
  const prevDialog = document.querySelector('dialog.ql-chart-editor-dialog');
  if (prevDialog) {
    try { prevDialog.close(); } catch (e) {}
    prevDialog.remove();
  }

  let svgEl = null;
  if (chartRef) {
    if (typeof chartRef === 'object' && chartRef.tagName) {
      svgEl = chartRef.tagName.toLowerCase() === 'svg' ? chartRef : (chartRef.querySelector ? chartRef.querySelector('svg') : null);
    } else if (typeof chartRef === 'string') {
      const found = document.querySelector(chartRef);
      if (found) svgEl = found.tagName.toLowerCase() === 'svg' ? found : found.querySelector('svg');
    }
  }

  // 2. Clon de configuración y valores por defecto
  const typography = Object.assign({
    fontFamily: 'var(--font-body)',
    fontSize: 13,
    isBold: false,
    isItalic: false,
  }, configOptions.typography || {});

  const colors = Object.assign({
    palette: 'categorical',
    series: [],
    linkOpacity: 0.4,
  }, configOptions.colors || {});

  const geometry = Object.assign({
    nodeWidth: 20,
    nodeGap: 2,
    linkOpacity: 0.4,
    sliders: [],
  }, configOptions.geometry || {});

  // Sliders por defecto para diagrama aluvial si no se especificaron
  if (geometry.sliders.length === 0 && (configOptions.chartType === 'alluvial' || geometry.nodeWidth !== undefined)) {
    geometry.sliders = [
      { id: 'nodeWidth', key: 'nodeWidth', label: 'Ancho de los nodos/barras', min: 6, max: 60, step: 2, value: geometry.nodeWidth || 20, unit: 'px' },
      { id: 'nodeGap', key: 'nodeGap', label: 'Separación entre nodos', min: 0, max: 14, step: 1, value: geometry.nodeGap ?? 2, unit: 'px' },
      { id: 'linkOpacity', key: 'linkOpacity', label: 'Opacidad de los flujos', min: 0.1, max: 0.95, step: 0.05, value: geometry.linkOpacity ?? colors.linkOpacity ?? 0.4, isPercent: true },
    ];
  }

  const currentConfig = {
    title: configOptions.title || 'Ajustes de la gráfica',
    subtitle: configOptions.subtitle || 'Modifica tipografía, colores y geometría con previsualización en tiempo real.',
    chartType: configOptions.chartType || 'generic',
    typography,
    colors,
    geometry,
  };

  const initialConfig = JSON.parse(JSON.stringify(currentConfig));

  function notify(key, val) {
    if (typeof onUpdate === 'function') {
      try {
        onUpdate(key, val, currentConfig);
      } catch (err) {
        console.warn('onUpdate callback error:', err);
      }
    }
  }

  // 3. Crear el elemento nativo <dialog>
  const dialog = document.createElement('dialog');
  dialog.className = 'ql-chart-editor-dialog';
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('role', 'dialog');

  // Cabecera
  const header = document.createElement('header');
  header.className = 'ql-ce-dialog-header';
  header.innerHTML = `
    <div>
      <h2 class="ql-ce-dialog-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <span>${escapeHtml(currentConfig.title)}</span>
      </h2>
      <p class="ql-ce-dialog-subtitle">${escapeHtml(currentConfig.subtitle)}</p>
    </div>
    <button type="button" class="ql-ce-dialog-close" title="Cerrar" aria-label="Cerrar">✕</button>
  `;
  dialog.appendChild(header);

  // Navegación de pestañas (Tipografía | Colores | Geometría)
  const nav = document.createElement('nav');
  nav.className = 'ql-ce-dialog-nav';
  const tabs = [
    { id: 'geometry', label: 'Geometría' },
    { id: 'typography', label: 'Tipografía' },
    { id: 'colors', label: 'Colores' },
  ];
  let activeTab = 'geometry';

  tabs.forEach((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ql-ce-tab-btn' + (t.id === activeTab ? ' is-active' : '');
    btn.textContent = t.label;
    btn.setAttribute('data-tab', t.id);
    btn.addEventListener('click', () => {
      activeTab = t.id;
      dialog.querySelectorAll('.ql-ce-tab-btn').forEach((b) => {
        b.classList.toggle('is-active', b.getAttribute('data-tab') === activeTab);
      });
      dialog.querySelectorAll('.ql-ce-tab-panel').forEach((p) => {
        p.classList.toggle('is-active', p.getAttribute('data-panel') === activeTab);
      });
    });
    nav.appendChild(btn);
  });
  dialog.appendChild(nav);

  // Cuerpo con paneles
  const body = document.createElement('div');
  body.className = 'ql-ce-dialog-body';

  // --- PANEL 1: GEOMETRÍA ---
  const panelGeom = document.createElement('div');
  panelGeom.className = 'ql-ce-tab-panel' + (activeTab === 'geometry' ? ' is-active' : '');
  panelGeom.setAttribute('data-panel', 'geometry');

  if (currentConfig.geometry.sliders && currentConfig.geometry.sliders.length > 0) {
    currentConfig.geometry.sliders.forEach((sl) => {
      const sliderField = document.createElement('div');
      sliderField.className = 'ql-field';
      const val = sl.isPercent ? Math.round(sl.value * 100) : sl.value;
      const min = sl.isPercent ? Math.round(sl.min * 100) : sl.min;
      const max = sl.isPercent ? Math.round(sl.max * 100) : sl.max;
      const step = sl.isPercent ? Math.round(sl.step * 100) : sl.step;
      const unit = sl.isPercent ? '%' : (sl.unit || '');

      sliderField.innerHTML = `<label for="ql-ce-sl-${sl.id}">${escapeHtml(sl.label)}${unit ? ' (' + unit + ')' : ''}</label>` +
        `<div class="ql-inputrow">` +
        `<input type="range" id="ql-ce-sl-${sl.id}-r" min="${min}" max="${max}" step="${step}" value="${val}">` +
        `<input type="number" id="ql-ce-sl-${sl.id}" class="ql-num-small tabular" min="${min}" max="${max}" step="${step}" value="${val}">` +
        `</div>`;

      const rInput = sliderField.querySelector(`#ql-ce-sl-${sl.id}-r`);
      const nInput = sliderField.querySelector(`#ql-ce-sl-${sl.id}`);

      const onSliderChange = (rawVal) => {
        const num = parseFloat(rawVal);
        const actualVal = sl.isPercent ? num / 100 : num;
        sl.value = actualVal;
        currentConfig.geometry[sl.key || sl.id] = actualVal;
        rInput.value = num;
        nInput.value = num;
        notify(sl.key || sl.id, actualVal);
      };

      rInput.addEventListener('input', () => onSliderChange(rInput.value));
      nInput.addEventListener('change', () => onSliderChange(nInput.value));

      panelGeom.appendChild(sliderField);
    });
  }
  body.appendChild(panelGeom);

  // --- PANEL 2: TIPOGRAFÍA Y TÍTULOS ---
  const panelTypo = document.createElement('div');
  panelTypo.className = 'ql-ce-tab-panel' + (activeTab === 'typography' ? ' is-active' : '');
  panelTypo.setAttribute('data-panel', 'typography');

  // Sección de Títulos globales del gráfico y ejes
  const modalTitleDefs = [
    { id: 'title', label: 'Título del Gráfico', inputId: 'ql-ce-title-input', selector: '.ql-chart-main-title, .ce-title, [data-ce="title"]' },
    { id: 'xtitle', label: 'Título Eje X', inputId: 'ql-ce-xtitle-input', selector: '.ql-chart-x-title, [data-ce="xtitle"]' },
    { id: 'ytitle', label: 'Título Eje Y', inputId: 'ql-ce-ytitle-input', selector: '.ql-chart-y-title, [data-ce="ytitle"]' },
  ];

  const titlesSection = document.createElement('div');
  titlesSection.className = 'ql-field ql-ce-titles-container';
  titlesSection.innerHTML = '<label style="font-weight:600;">Títulos de la figura</label>' +
    '<p class="ql-field-help" style="margin-bottom:8px;">Edición reactiva de títulos en tiempo real.</p>';

  const titleRows = document.createElement('div');
  titleRows.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:6px;margin-bottom:14px;';

  modalTitleDefs.forEach((td) => {
    const subField = document.createElement('div');
    subField.className = 'ql-field';
    subField.style.marginBottom = '6px';

    const lab = document.createElement('label');
    lab.setAttribute('for', td.inputId);
    lab.textContent = td.label;
    subField.appendChild(lab);

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.id = td.inputId;
    inp.className = 'ql-input ' + td.inputId;
    inp.placeholder = td.label;

    if (svgEl) {
      const match = svgEl.querySelector(td.selector);
      if (match && match.textContent) inp.value = match.textContent.trim();
    }
    if (!inp.value && configOptions[td.id]) {
      inp.value = configOptions[td.id];
    }

    inp.addEventListener('input', () => {
      const val = inp.value;
      if (svgEl) {
        const matches = svgEl.querySelectorAll(td.selector);
        matches.forEach((el) => { el.textContent = val; });
      }
      currentConfig[td.id] = val;
      notify(td.id, val);
    });

    subField.appendChild(inp);
    titleRows.appendChild(subField);
  });

  titlesSection.appendChild(titleRows);
  panelTypo.appendChild(titlesSection);

  const fontField = document.createElement('div');
  fontField.className = 'ql-field';
  fontField.innerHTML = '<label for="ql-ce-font-select">Familia tipográfica</label>';
  const fontSelect = document.createElement('select');
  fontSelect.id = 'ql-ce-font-select';
  fontSelect.className = 'ql-select';
  FONTS.forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if (currentConfig.typography.fontFamily === val) opt.selected = true;
    fontSelect.appendChild(opt);
  });
  fontSelect.addEventListener('change', () => {
    currentConfig.typography.fontFamily = fontSelect.value;
    notify('fontFamily', fontSelect.value);
  });
  fontField.appendChild(fontSelect);
  panelTypo.appendChild(fontField);

  const fontStylesField = document.createElement('div');
  fontStylesField.className = 'ql-field';
  fontStylesField.innerHTML = '<label>Estilos de texto</label>';

  const checkRow = document.createElement('div');
  checkRow.style.cssText = 'display:flex;gap:20px;margin-top:4px;flex-wrap:wrap;';

  const boldLabel = document.createElement('label');
  boldLabel.className = 'ql-ce-checkbox-label';
  const boldChk = document.createElement('input');
  boldChk.type = 'checkbox';
  boldChk.checked = Boolean(currentConfig.typography.isBold);
  boldChk.addEventListener('change', () => {
    currentConfig.typography.isBold = boldChk.checked;
    notify('isBold', boldChk.checked);
  });
  boldLabel.appendChild(boldChk);
  boldLabel.appendChild(document.createTextNode(' Texto en negrita (600)'));
  checkRow.appendChild(boldLabel);

  const italicLabel = document.createElement('label');
  italicLabel.className = 'ql-ce-checkbox-label';
  const italicChk = document.createElement('input');
  italicChk.type = 'checkbox';
  italicChk.checked = Boolean(currentConfig.typography.isItalic);
  italicChk.addEventListener('change', () => {
    currentConfig.typography.isItalic = italicChk.checked;
    notify('isItalic', italicChk.checked);
  });
  italicLabel.appendChild(italicChk);
  italicLabel.appendChild(document.createTextNode(' Texto en cursiva'));
  checkRow.appendChild(italicLabel);

  fontStylesField.appendChild(checkRow);
  panelTypo.appendChild(fontStylesField);

  const sizeField = document.createElement('div');
  sizeField.className = 'ql-field';
  sizeField.innerHTML = '<label for="ql-ce-font-size">Tamaño de fuente (px)</label>' +
    '<div class="ql-inputrow">' +
    '<input type="range" id="ql-ce-font-size-r" min="9" max="22" step="1" value="' + (currentConfig.typography.fontSize || 13) + '">' +
    '<input type="number" id="ql-ce-font-size" class="ql-num-small tabular" min="9" max="22" step="1" value="' + (currentConfig.typography.fontSize || 13) + '">' +
    '</div>';
  {
    const rInput = sizeField.querySelector('#ql-ce-font-size-r');
    const nInput = sizeField.querySelector('#ql-ce-font-size');
    const onSizeChange = (v) => {
      const nv = Math.max(9, Math.min(22, parseInt(v, 10) || 13));
      rInput.value = nv;
      nInput.value = nv;
      currentConfig.typography.fontSize = nv;
      notify('fontSize', nv);
    };
    rInput.addEventListener('input', () => onSizeChange(rInput.value));
    nInput.addEventListener('change', () => onSizeChange(nInput.value));
  }
  panelTypo.appendChild(sizeField);
  body.appendChild(panelTypo);

  // --- PANEL 3: COLORES ---
  const panelColors = document.createElement('div');
  panelColors.className = 'ql-ce-tab-panel' + (activeTab === 'colors' ? ' is-active' : '');
  panelColors.setAttribute('data-panel', 'colors');

  if (currentConfig.colors.series && currentConfig.colors.series.length > 0) {
    const seriesSec = document.createElement('div');
    seriesSec.className = 'ql-field';
    seriesSec.innerHTML = '<label>Colores asignados por serie o taxón</label>' +
      '<p class="ql-field-help" style="margin-bottom:8px;">Ajusta los colores principales de los elementos.</p>';
    const colorList = document.createElement('div');
    colorList.style.cssText = 'max-height:220px;overflow-y:auto;padding-right:4px;display:flex;flex-direction:column;gap:6px;';

    currentConfig.colors.series.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'ql-ce-color-row';
      const name = document.createElement('span');
      name.style.cssText = 'font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px;';
      name.textContent = s.label || s.id;
      row.appendChild(name);

      const colorInp = document.createElement('input');
      colorInp.type = 'color';
      colorInp.style.cssText = 'width:36px;height:26px;border:none;border-radius:4px;cursor:pointer;padding:0;background:none;';
      let initialColor = s.color || '#3b82f6';
      if (!initialColor.startsWith('#')) initialColor = '#3b82f6';
      colorInp.value = initialColor;

      colorInp.addEventListener('input', () => {
        s.color = colorInp.value;
        notify('seriesColor', { id: s.id, color: colorInp.value });
      });
      row.appendChild(colorInp);
      colorList.appendChild(row);
    });
    seriesSec.appendChild(colorList);
    panelColors.appendChild(seriesSec);
  }

  const opField = document.createElement('div');
  opField.className = 'ql-field';
  const currOp = currentConfig.colors.linkOpacity ?? currentConfig.geometry.linkOpacity ?? 0.4;
  opField.innerHTML = '<label for="ql-ce-op-r">Opacidad de los flujos (%)</label>' +
    '<div class="ql-inputrow">' +
    '<input type="range" id="ql-ce-op-r" min="10" max="95" step="5" value="' + Math.round(currOp * 100) + '">' +
    '<input type="number" id="ql-ce-op" class="ql-num-small tabular" min="10" max="95" step="5" value="' + Math.round(currOp * 100) + '">' +
    '</div>';
  {
    const rInput = opField.querySelector('#ql-ce-op-r');
    const nInput = opField.querySelector('#ql-ce-op');
    const onOpChange = (v) => {
      const nv = Math.max(10, Math.min(95, parseInt(v, 10) || 40));
      rInput.value = nv;
      nInput.value = nv;
      const frac = nv / 100;
      currentConfig.colors.linkOpacity = frac;
      currentConfig.geometry.linkOpacity = frac;
      notify('linkOpacity', frac);
    };
    rInput.addEventListener('input', () => onOpChange(rInput.value));
    nInput.addEventListener('change', () => onOpChange(nInput.value));
  }
  panelColors.appendChild(opField);
  body.appendChild(panelColors);

  dialog.appendChild(body);

  // Pie del modal
  const footer = document.createElement('footer');
  footer.className = 'ql-ce-dialog-footer';

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'ql-btn ql-btn-ghost';
  resetBtn.textContent = 'Restablecer valores';
  resetBtn.addEventListener('click', () => {
    Object.assign(currentConfig.typography, initialConfig.typography);
    Object.assign(currentConfig.colors, initialConfig.colors);
    Object.assign(currentConfig.geometry, initialConfig.geometry);

    fontSelect.value = currentConfig.typography.fontFamily;
    boldChk.checked = currentConfig.typography.isBold;
    italicChk.checked = currentConfig.typography.isItalic;

    if (currentConfig.geometry.sliders) {
      currentConfig.geometry.sliders.forEach((sl) => {
        const orig = initialConfig.geometry.sliders.find((s) => s.id === sl.id);
        if (orig) {
          sl.value = orig.value;
          const r = dialog.querySelector(`#ql-ce-sl-${sl.id}-r`);
          const n = dialog.querySelector(`#ql-ce-sl-${sl.id}`);
          const displayVal = sl.isPercent ? Math.round(sl.value * 100) : sl.value;
          if (r) r.value = displayVal;
          if (n) n.value = displayVal;
        }
      });
    }

    modalTitleDefs.forEach((td) => {
      const orig = initialConfig[td.id] !== undefined ? initialConfig[td.id] : '';
      currentConfig[td.id] = orig;
      const inp = dialog.querySelector('#' + td.inputId);
      if (inp) inp.value = orig;
      if (svgEl && orig) {
        const matches = svgEl.querySelectorAll(td.selector);
        matches.forEach((el) => { el.textContent = orig; });
      }
    });

    notify('reset', currentConfig);
  });
  footer.appendChild(resetBtn);

  const actionsRight = document.createElement('div');
  actionsRight.className = 'ql-ce-dialog-footer-actions';
  actionsRight.style.display = 'flex';
  actionsRight.style.gap = '8px';
  actionsRight.style.alignItems = 'center';

  if (svgEl) {
    const dlSvgBtn = document.createElement('button');
    dlSvgBtn.type = 'button';
    dlSvgBtn.className = 'ql-btn';
    dlSvgBtn.innerHTML = `${CE_ICONS.download} <span>Descargar SVG</span>`;
    dlSvgBtn.title = 'Descargar SVG vectorial';
    dlSvgBtn.addEventListener('click', () => {
      exportSvg(svgEl, currentConfig.filename || configOptions.filename || 'smart175_figura');
    });
    actionsRight.appendChild(dlSvgBtn);

    const dlPngBtn = document.createElement('button');
    dlPngBtn.type = 'button';
    dlPngBtn.className = 'ql-btn';
    dlPngBtn.innerHTML = `${CE_ICONS.download} <span>Descargar PNG</span>`;
    dlPngBtn.title = 'Descargar PNG en alta resolución (300 dpi)';
    dlPngBtn.addEventListener('click', () => {
      exportPng(svgEl, currentConfig.filename || configOptions.filename || 'smart175_figura', 4);
    });
    actionsRight.appendChild(dlPngBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ql-btn ql-btn-primary';
  closeBtn.textContent = 'Cerrar';
  closeBtn.addEventListener('click', () => dialog.close());
  actionsRight.appendChild(closeBtn);

  footer.appendChild(actionsRight);

  dialog.appendChild(footer);

  // Eventos de cierre y clic fuera
  header.querySelector('.ql-ce-dialog-close').addEventListener('click', () => dialog.close());

  dialog.addEventListener('click', (ev) => {
    const rect = dialog.getBoundingClientRect();
    const isInDialog = (
      rect.top <= ev.clientY && ev.clientY <= rect.top + rect.height &&
      rect.left <= ev.clientX && ev.clientX <= rect.left + rect.width
    );
    if (!isInDialog) {
      dialog.close();
    }
  });

  dialog.addEventListener('close', () => {
    dialog.remove();
  });

  document.body.appendChild(dialog);
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }

  return {
    dialog,
    close: () => {
      try { dialog.close(); } catch (e) { dialog.remove(); }
    },
  };
}
