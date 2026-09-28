// Migración única de localStorage del nombre heredado al actual.
//
// El producto se llama Smart-175 (el repositorio sigue llamándose "qiimelab"
// a propósito — ver README). Las claves de este navegador viven bajo el
// prefijo `smart-175.` (smart-175.theme, smart-175.lang,
// smart-175.profileName, smart-175.chartStyle.<figura>, smart-175.phylo…);
// versiones antiguas escribían `qiimelab.` y los módulos solo las leían como
// respaldo, sin borrarlas nunca.
//
// Al arrancar (app.js importa este módulo el PRIMERO, antes que i18n/tema/
// perfil, que leen sus claves al evaluarse): cada clave `qiimelab.<resto>`
// se copia a `smart-175.<resto>` si esa aún no existe (si ya existe, manda
// la nueva: es la más reciente) y la antigua se borra. Es genérica — cubre
// también claves que el código actual ya no conoce — e idempotente: sin
// claves antiguas no hace nada. Si escribir la nueva falla (cuota llena,
// modo privado), la antigua NO se borra: los respaldos de lectura que
// conservan los módulos la siguen encontrando.

export const LEGACY_PREFIX = 'qiimelab.';
export const CURRENT_PREFIX = 'smart-175.';

/**
 * @param {Storage} [storage]
 * @returns {{ moved: string[], kept: string[], failed: string[] }}
 *   moved: copiadas a la clave nueva y borradas; kept: la nueva ya existía
 *   (se borra solo la antigua); failed: no se pudo escribir la nueva.
 */
export function migrateLegacyStorage(storage = globalThis.localStorage) {
  const report = { moved: [], kept: [], failed: [] };
  let keys;
  try {
    keys = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(LEGACY_PREFIX)) keys.push(k);
    }
  } catch (e) { return report; } // sin localStorage (modo privado estricto, Node sin mock)
  for (const oldKey of keys) {
    const newKey = CURRENT_PREFIX + oldKey.slice(LEGACY_PREFIX.length);
    try {
      if (storage.getItem(newKey) === null) {
        storage.setItem(newKey, storage.getItem(oldKey));
        report.moved.push(oldKey);
      } else {
        report.kept.push(oldKey);
      }
      storage.removeItem(oldKey);
    } catch (e) {
      report.failed.push(oldKey);
    }
  }
  return report;
}

migrateLegacyStorage();
