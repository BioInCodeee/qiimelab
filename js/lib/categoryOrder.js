// Orden de categorías compartido (Ajustes > Estructura > Orden de categorías).
// Los módulos con categorías en un eje (grupos, taxones, variables, comparaciones)
// llaman a orderCategories() con el modo guardado por el editor
// (`getFigureOptions(key).categoryOrder`); 'original' devuelve el orden que ya
// traía el módulo. Función pura, sin DOM.

/**
 * @param {string[]} names            categorías en el orden original del módulo
 * @param {(name:string)=>number} valueOf  valor numérico de cada categoría
 *        (para 'value-*'); puede devolver NaN → esas van al final
 * @param {string} [mode]             original | alpha-asc | alpha-desc | value-asc | value-desc | cluster
 * @param {string[]} [clusterOrder]   orden ya calculado por el módulo para 'cluster'
 * @returns {string[]}                array NUEVO (no reordena in situ)
 */
export function orderCategories(names, valueOf, mode, clusterOrder) {
  const arr = names.slice();
  if (!mode || mode === 'original') return arr;
  const byText = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  const val = (n) => { const v = valueOf ? valueOf(n) : NaN; return Number.isFinite(v) ? v : NaN; };
  // NaN siempre al final, sea cual sea el sentido
  const num = (dir) => (a, b) => {
    const va = val(a), vb = val(b);
    if (Number.isNaN(va) && Number.isNaN(vb)) return 0;
    if (Number.isNaN(va)) return 1;
    if (Number.isNaN(vb)) return -1;
    return dir * (va - vb);
  };
  if (mode === 'alpha-asc') arr.sort(byText);
  else if (mode === 'alpha-desc') arr.sort((a, b) => byText(b, a));
  else if (mode === 'value-asc') arr.sort(num(1));
  else if (mode === 'value-desc') arr.sort(num(-1));
  else if (mode === 'cluster' && Array.isArray(clusterOrder)) {
    const rank = new Map(clusterOrder.map((n, i) => [n, i]));
    arr.sort((a, b) => (rank.has(a) ? rank.get(a) : 1e9) - (rank.has(b) ? rank.get(b) : 1e9));
  }
  return arr;
}
