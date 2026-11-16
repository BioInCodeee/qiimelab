// tests/theme-meta.mjs — color de la barra del navegador (<meta name="theme-color">)
// al cambiar de tema desde el selector, js/lib/theme.js.
//
// Regresión: applyMetaThemeColor() buscaba las dos <meta> por su atributo
// `media` ([media*="light"] / [media*="dark"]) y acto seguido lo reescribía
// ('' y 'not all'). A partir del primer cambio explícito el selector ya no
// casaba con nada y la función salía por su `return`, así que la barra se
// quedaba congelada en el color del primer cambio: light→dark→light no movía
// nada. Aquí se encadenan varios cambios y se comprueba que CADA uno deja las
// dos <meta> como toca, y que 'auto' restaura el `media` original.
//
// Sin Chrome: se simulan document y localStorage a mano.
//
//   node tests/theme-meta.mjs

let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

const LIGHT_MEDIA = '(prefers-color-scheme: light)';
const DARK_MEDIA = '(prefers-color-scheme: dark)';

function fakeMeta(media) {
  const attrs = new Map([['name', 'theme-color'], ['media', media]]);
  return {
    dataset: {},
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, String(v)),
  };
}

function installFakeDom() {
  const light = fakeMeta(LIGHT_MEDIA);
  const dark = fakeMeta(DARK_MEDIA);
  const htmlAttrs = new Map();
  globalThis.document = {
    documentElement: {
      setAttribute: (k, v) => htmlAttrs.set(k, String(v)),
      removeAttribute: (k) => htmlAttrs.delete(k),
      getAttribute: (k) => (htmlAttrs.has(k) ? htmlAttrs.get(k) : null),
    },
    querySelectorAll: (sel) => (sel.includes('theme-color') ? [light, dark] : []),
    // querySelector con la semántica real de [media*="..."]: casa contra el
    // valor ACTUAL del atributo, que es justo lo que hacía fallar al código
    // antiguo a partir del segundo cambio.
    querySelector: (sel) => {
      if (!sel.includes('theme-color')) return null;
      const m = /media\*="([^"]+)"/.exec(sel);
      if (!m) return light;
      return [light, dark].find((el) => (el.getAttribute('media') || '').includes(m[1])) || null;
    },
  };
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return { light, dark, htmlAttrs };
}

const { light, dark, htmlAttrs } = installFakeDom();
const { setTheme, applyTheme } = await import('../js/lib/theme.js');

const media = () => [light.getAttribute('media'), dark.getAttribute('media')];
const expect = (theme, want) => {
  setTheme(theme);
  const got = media();
  check(`setTheme('${theme}') → media [${want.join(' | ')}]`, got[0] === want[0] && got[1] === want[1], `obtenido [${got.join(' | ')}]`);
};

console.log('theme-color tras cada cambio de tema');
// Arranque: igual que initTheme() con el tema oscuro por defecto.
applyTheme('dark');
check('arranque en oscuro deja la <meta> oscura activa', media()[1] === '' && media()[0] === 'not all', `[${media().join(' | ')}]`);

// El encadenado es lo que rompía: cada cambio tiene que seguir moviendo las <meta>.
expect('light', ['', 'not all']);
expect('dark', ['not all', '']);
expect('light', ['', 'not all']);
expect('dark', ['not all', '']);

console.log('auto restaura el media original');
setTheme('auto');
check('media original restaurado', media()[0] === LIGHT_MEDIA && media()[1] === DARK_MEDIA, `[${media().join(' | ')}]`);
check("auto quita data-theme de <html>", htmlAttrs.get('data-theme') === undefined);

// Y después de 'auto' se tiene que poder seguir cambiando.
expect('light', ['', 'not all']);

console.log(failed ? '\nFALLOS' : '\nOK');
process.exit(failed ? 1 : 0);
