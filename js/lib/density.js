// Densidad de la interfaz: dos vistas sobre la MISMA funcionalidad.
//
// El problema medido (14 nov 2026): el módulo de primers muestra 35 párrafos
// de ayuda permanentes, barplots 30, Sanger 17. Nada de eso sobra —son
// explicaciones buenas, escritas para alguien que no sabe qué es una Tm o una
// q-valor— pero mostrarlas TODAS a la vez, siempre, convierte cada pantalla en
// un muro de texto en el que no se encuentra el control que se buscaba.
//
// La solución no es borrar texto (la regla del proyecto es que el texto
// retirado se reubica, nunca se elimina), sino que cada persona elija cuánto
// quiere ver:
//
//   guiado   — todo visible, como hasta ahora. Para quien aterriza por primera
//              vez o usa un módulo que no conoce.
//   compacto — las ayudas quedan plegadas tras un botón «?» por campo. El
//              texto sigue ahí, a un toque, y la pantalla cabe de un vistazo.
//
// El mecanismo es genérico a propósito: actúa sobre la clase `ql-field-help`,
// que ya usan los 21 módulos, así que no hay que tocar ni uno. Lo que un
// módulo tenga dentro de un `<details>` propio no se toca, porque ya está
// plegado por su autor.

const KEY = 'smart-175.density';
const VALID = new Set(['guided', 'compact']);
const listeners = new Set();

/** Modo por defecto de quien no ha elegido: guiado, que es como estaba. */
export const DEFAULT_DENSITY = 'guided';

/** @returns {'guided'|'compact'} */
export function getDensity() {
  try {
    const v = localStorage.getItem(KEY);
    return VALID.has(v) ? v : DEFAULT_DENSITY;
  } catch (e) { return DEFAULT_DENSITY; }
}

/** @param {'guided'|'compact'} mode */
export function setDensity(mode) {
  const v = VALID.has(mode) ? mode : DEFAULT_DENSITY;
  try { localStorage.setItem(KEY, v); } catch (e) { /* cuota/privado */ }
  applyDataDensity(v);
  listeners.forEach((fn) => { try { fn(v); } catch (e) { /* noop */ } });
}

/** Escribe el atributo que lee el CSS. */
export function applyDataDensity(mode) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-density', VALID.has(mode) ? mode : DEFAULT_DENSITY);
}

/** @param {(mode:string)=>void} fn @returns {() => void} */
export function onDensityChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * ¿Hay que ponerle un botón de ayuda a este párrafo?
 *
 * Se excluyen tres casos, y los tres por una razón concreta:
 *   - el que ya está dentro de un <details>: su autor ya decidió plegarlo;
 *   - el que ya tiene botón: no duplicar en repintados sucesivos;
 *   - el que no tiene delante un control al que referirse (está suelto como
 *     nota de pie de una tarjeta): plegarlo escondería algo que nadie va a
 *     buscar detrás de un «?» junto a un campo que no existe.
 *
 * Función pura sobre un elemento para poder probarla sin navegador.
 * @param {{parentElement:Object|null, previousElementSibling:Object|null, closest:Function}} el
 * @returns {boolean}
 */
export function needsHelpToggle(el) {
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest('details')) return false;
  if (el.getAttribute && el.getAttribute('data-help-managed') === '1') return false;
  const prev = el.previousElementSibling;
  if (!prev) return false;
  const tag = String(prev.tagName || '').toLowerCase();
  // un control, una etiqueta o un grupo de botones delante: hay a qué anclar
  // Boolean() explicito: sin el, un className vacio hace que la funcion
  // devuelva '' en vez de false. Funciona igual en un if, pero un predicado
  // que a veces devuelve una cadena es una trampa para quien lo compare.
  return Boolean(
    tag === 'select' || tag === 'input' || tag === 'textarea' ||
    tag === 'label' || tag === 'button' ||
    (prev.className && /ql-segmented|ql-field-label|ql-range/.test(String(prev.className))),
  );
}

/**
 * Pone el botón «?» a las ayudas que lo necesiten dentro de `root`.
 *
 * No borra ni mueve nada: solo marca el párrafo y le añade un botón hermano.
 * Quién se ve y quién no lo decide el CSS según `data-density`, de modo que
 * cambiar de modo no obliga a repintar los módulos.
 *
 * @param {Element} root
 * @param {(key:string)=>string} t Traductor, para el rótulo accesible.
 * @returns {number} Cuántas ayudas se han preparado.
 */
export function prepareHelpToggles(root, t) {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  let n = 0;
  root.querySelectorAll('p.ql-field-help').forEach((p) => {
    if (!needsHelpToggle(p)) return;
    p.setAttribute('data-help-managed', '1');
    const id = 'help-' + Math.random().toString(36).slice(2, 9);
    p.id = p.id || id;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ql-help-toggle';
    btn.textContent = '?';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', p.id);
    btn.setAttribute('aria-label', t ? t('shell.showHelp') : 'Mostrar la ayuda de este campo');
    btn.addEventListener('click', () => {
      const open = p.getAttribute('data-help-open') === '1';
      p.setAttribute('data-help-open', open ? '0' : '1');
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
    p.parentNode.insertBefore(btn, p);
    n++;
  });
  return n;
}
