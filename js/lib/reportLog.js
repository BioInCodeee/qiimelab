// reportLog.js — qué ha ejecutado de verdad el usuario en esta sesión, para
// el informe completo (#/informe).
//
// El informe NO recalcula ni vuelve a pintar nada: cuando el usuario sale de
// un módulo de análisis, app.js llama a captureRoute() ANTES de la limpieza
// del módulo y aquí se guarda una instantánea de lo que había en pantalla en
// ese momento (figuras .ql-svg visibles, tablas .ql-table visibles y los ids
// de los avisos de equivalencia que mostraba). Un módulo que no se visitó, o
// que se visitó sin resultados (estado vacío), no deja instantánea → no sale
// en el informe.
//
// Las figuras se guardan como clon del DOM (barato); la serialización cara
// (serializeForExport, la misma del editor de figuras) se hace solo al
// generar el informe. Vive en memoria: una recarga de la pestaña empieza una
// sesión de informe nueva.

import { getLang } from './i18n.js';
import { state } from '../state.js';

/** Rutas cuyo contenido es un resultado de análisis (orden = orden del informe). */
export const REPORT_ROUTES = [
  'qc', 'barplots', 'alfa', 'beta', 'temporal', 'venn', 'correlograma',
  'diferencial', 'funcional', 'inferencia', 'recuentos', 'primers', 'arbol', 'sanger',
];

const MAX_FIGURES = 4;
const MAX_TABLES = 3;
export const MAX_TABLE_ROWS = 25;

const snapshots = new Map(); // routeId → snapshot
const noted = new Map();     // routeId → Set de ids de método ejecutados en la visita actual
const external = new Set();  // 'ncbi-blast' si alguna secuencia salió hacia NCBI

const visible = (el) => el.getClientRects().length > 0 && !el.closest('.ql-tooltip');

// huella de los archivos cargados: si alguno desaparece (limpiar sesión,
// importar otra), la instantánea ya no describe los datos actuales
const fileKeys = () => state.files.map((f) => f.id + '\u0000' + f.name);

/**
 * Extrae figuras, tablas y avisos visibles de `root` (sin modificarlo).
 * @returns {{figures:SVGSVGElement[], tables:HTMLTableElement[], truncated:boolean, methodIds:string[]}}
 */
export function harvest(root) {
  const figures = [...root.querySelectorAll('svg.ql-svg')].filter(visible).slice(0, MAX_FIGURES)
    .map((svg) => svg.cloneNode(true));
  let truncated = false;
  const tables = [...root.querySelectorAll('table.ql-table')].filter(visible).slice(0, MAX_TABLES).map((tbl) => {
    const c = tbl.cloneNode(true);
    // botones/controles de las cabeceras (ordenar…) no funcionan en papel
    c.querySelectorAll('button').forEach((b) => b.replaceWith(document.createTextNode(b.textContent)));
    c.querySelectorAll('input, select').forEach((n) => n.remove());
    const rows = c.querySelectorAll('tbody tr');
    if (rows.length > MAX_TABLE_ROWS) {
      for (let k = rows.length - 1; k >= MAX_TABLE_ROWS; k--) rows[k].remove();
      truncated = true;
    }
    return c;
  });
  const methodIds = [...new Set([...root.querySelectorAll('[data-method-ids]')].filter(visible)
    .flatMap((n) => n.getAttribute('data-method-ids').split(' ').filter(Boolean)))];
  return { figures, tables, truncated, methodIds };
}

/**
 * Un módulo declara los métodos de methodEquivalence.js que acaba de ejecutar
 * (p. ej. alfa calcula Shannon a partir de conteos, o beta ordena el mapa de
 * calor por UPGMA) — también los de Nivel A, que en el módulo no muestran
 * aviso. Se acumulan durante la visita y se guardan con la instantánea.
 */
export function noteMethods(routeId, ids) {
  if (!noted.has(routeId)) noted.set(routeId, new Set());
  const set = noted.get(routeId);
  (Array.isArray(ids) ? ids : [ids]).forEach((id) => { if (id) set.add(id); });
}

/** Devuelve y olvida los métodos declarados para `routeId`. */
export function takeNotedMethods(routeId) {
  const ids = [...(noted.get(routeId) || [])];
  noted.delete(routeId);
  return ids;
}

/** Guarda la instantánea de `routeId` si ese módulo mostraba algún resultado. */
export function captureRoute(routeId, root) {
  if (!REPORT_ROUTES.includes(routeId) || !root) return;
  const extra = takeNotedMethods(routeId);
  try {
    const h = harvest(root);
    if (!h.figures.length && !h.tables.length) return; // estado vacío: no se ejecutó nada
    h.methodIds = [...new Set([...extra, ...h.methodIds])];
    snapshots.set(routeId, { ...h, lang: getLang(), at: Date.now(), files: fileKeys() });
  } catch (e) { /* una captura fallida nunca debe impedir navegar */ }
}

/** Instantáneas vigentes, en el orden de REPORT_ROUTES. */
export function getSnapshots() {
  const now = new Set(fileKeys());
  return REPORT_ROUTES.filter((id) => snapshots.has(id))
    .map((id) => ({ id, ...snapshots.get(id) }))
    .filter((s) => s.files.every((k) => now.has(k)));
}

export function markExternal(kind) { external.add(kind); }
export function hasExternal(kind) { return external.has(kind); }

/** Solo para tests. */
export function clearReportLog() { snapshots.clear(); noted.clear(); external.clear(); }
