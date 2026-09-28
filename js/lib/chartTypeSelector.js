// Selector de "tipo de gráfico" reutilizable — mismo segmented control que
// ya usaban a mano taxaBarplot.js (vertical/horizontal) y primers.js (modo
// de diseño), pero como un único componente para que cada módulo que ofrezca
// vistas alternativas de LOS MISMOS datos (p. ej. barras apiladas vs
// burbujas) no reimplemente el control. Solo construye el selector — el
// dibujo del propio gráfico sigue siendo cosa de cada módulo (formas de
// datos demasiado distintas entre sí para una única función de dibujo).
//
// Sin persistencia en localStorage a propósito: el resto de controles
// afines en estos módulos (orientación de barras, pestañas de vista) viven
// solo en el closure del módulo y se reinician al volver a entrar — este
// selector sigue el mismo comportamiento ya establecido, no inventa uno nuevo.

import { t } from './i18n.js';

/**
 * @param {Object} opts
 * @param {string} opts.labelKey - clave i18n del <label> visible y del aria-label del grupo
 * @param {{value:string, labelKey?:string, label?:string}[]} opts.options - 2+ tipos, en el orden en que se
 *        muestran; `label` (texto ya resuelto) sirve cuando la etiqueta lleva datos interpolados
 * @param {string} opts.active - value del tipo activo
 * @param {(value:string)=>void} opts.onChange - se llama solo cuando el usuario elige un tipo distinto del activo
 * @param {string} [opts.helpKey] - clave i18n opcional de una línea de ayuda bajo el control
 * @returns {HTMLElement} el campo completo (`.ql-field` con label + `.ql-segmented`), listo para insertar
 */
export function chartTypeField({ labelKey, options, active, onChange, helpKey }) {
  const field = document.createElement('div');
  field.className = 'ql-field';
  field.innerHTML = '<label>' + t(labelKey) + '</label>';

  const seg = document.createElement('div');
  seg.className = 'ql-segmented';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', t(labelKey));
  options.forEach(({ value, labelKey: optLabelKey, label }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ql-seg-btn' + (active === value ? ' is-on' : '');
    if (active === value) b.setAttribute('aria-pressed', 'true');
    b.textContent = label != null ? label : t(optLabelKey);
    b.addEventListener('click', () => { if (active !== value) onChange(value); });
    seg.appendChild(b);
  });
  field.appendChild(seg);

  if (helpKey) field.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t(helpKey) + '</p>');
  return field;
}
