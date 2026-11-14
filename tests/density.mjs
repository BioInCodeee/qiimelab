// tests/density.mjs — densidad de la interfaz (js/lib/density.js).
//
// Lo que se prueba sin navegador es la DECISIÓN: a qué ayuda se le pone botón
// y a cuál no. Es donde está el riesgo real — si la regla se equivoca, el modo
// compacto esconde texto que nadie va a encontrar, o llena la pantalla de
// botones «?» junto a párrafos sueltos.
//
//   node tests/density.mjs

import { needsHelpToggle, DEFAULT_DENSITY, prepareHelpToggles } from '../js/lib/density.js';

let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

// Doble mínimo de un elemento, con lo justo que mira needsHelpToggle().
function el({ prev = null, inDetails = false, managed = false, className = '' } = {}) {
  return {
    tagName: 'P',
    className,
    previousElementSibling: prev,
    closest: (sel) => (sel === 'details' && inDetails ? {} : null),
    getAttribute: (k) => (k === 'data-help-managed' ? (managed ? '1' : null) : null),
  };
}
const ctrl = (tag, className = '') => ({ tagName: tag, className });

console.log('a qué ayuda se le pone botón');

check('tras un <select> sí', needsHelpToggle(el({ prev: ctrl('SELECT') })));
check('tras un <input> sí', needsHelpToggle(el({ prev: ctrl('INPUT') })));
check('tras un <textarea> sí', needsHelpToggle(el({ prev: ctrl('TEXTAREA') })));
check('tras un <label> sí', needsHelpToggle(el({ prev: ctrl('LABEL') })));
check('tras un <button> sí', needsHelpToggle(el({ prev: ctrl('BUTTON') })));
check('tras un grupo segmentado sí', needsHelpToggle(el({ prev: ctrl('DIV', 'ql-segmented') })));
check('tras un deslizador sí', needsHelpToggle(el({ prev: ctrl('INPUT', 'ql-range') })));

check('un párrafo suelto, sin control delante, NO',
  needsHelpToggle(el({ prev: null })) === false);
check('tras otro párrafo (nota de pie de tarjeta) NO',
  needsHelpToggle(el({ prev: ctrl('P') })) === false);
check('tras un encabezado NO', needsHelpToggle(el({ prev: ctrl('H2') })) === false);

check('dentro de un <details> NO: su autor ya lo plegó',
  needsHelpToggle(el({ prev: ctrl('SELECT'), inDetails: true })) === false);
check('ya gestionado NO: no se duplica en repintados',
  needsHelpToggle(el({ prev: ctrl('SELECT'), managed: true })) === false);

check('nulo o sin closest() no rompe',
  needsHelpToggle(null) === false && needsHelpToggle({}) === false &&
  needsHelpToggle(undefined) === false);

console.log('\nvalores por defecto y robustez');
check('el modo por defecto es guiado (la app no cambia sola)', DEFAULT_DENSITY === 'guided');
check('prepareHelpToggles sin raíz devuelve 0',
  prepareHelpToggles(null) === 0 && prepareHelpToggles({}) === 0);
check('prepareHelpToggles con una raíz vacía devuelve 0',
  prepareHelpToggles({ querySelectorAll: () => [] }) === 0);

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
