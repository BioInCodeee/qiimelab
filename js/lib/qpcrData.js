// Lectura y control de calidad de una tanda de qPCR.
//
// Entrada: el export de resultados del termociclador (Bio-Rad CFX Maestro y
// equivalentes) como CSV o TSV. Columnas que se usan: Well, Fluor, Target,
// Content, Sample, Cq. El resto se conserva pero no se toca.
//
// Dos decisiones que son la razón de ser de este archivo:
//
//   1. UN POCILLO SIN AMPLIFICACIÓN NO ES UN CERO. El equipo escribe `Cq Mean`
//      = 0 en las filas sin Cq, y esa columna, arrastrada a una hoja de
//      cálculo, convierte "no amplificó" en "amplificó en el ciclo 0", es
//      decir en unas 2^31 veces más molde del que había. Aquí la columna
//      `Cq Mean` del equipo se IGNORA siempre y las medias se recalculan solo
//      con los pocillos que de verdad tienen Cq.
//
//   2. EL CONTROL DE CALIDAD VA ANTES QUE LA ARITMÉTICA. Una media de
//      triplicados que difieren en 4 ciclos no es un dato, y un ΔΔCt
//      calculado sobre ella tampoco. Por eso `qcReport` se calcula aparte y el
//      módulo debe enseñarlo antes de dejar cuantificar nada.

/** Textos con los que los equipos marcan "no amplificó". */
const UNDETERMINED = new Set(['', 'n/a', 'na', 'nan', 'undetermined', 'undet', '-', 'no cq']);

export const QC = {
  HIGH_SD: 'highSd',              // réplicas técnicas demasiado dispersas
  UNDETERMINED: 'undetermined',   // algún pocillo sin amplificación
  MOSTLY_UNDETERMINED: 'mostlyUndetermined', // menos de la mitad amplificó
  NO_NTC: 'noNtc',                // una diana sin control sin molde
  NTC_AMPLIFIED: 'ntcAmplified',  // el control sin molde amplificó
  EARLY_CQ: 'earlyCq',            // Cq tan temprano que la línea base no es fiable
  LATE_CQ: 'lateCq',              // Cq en el límite de detección
  SINGLE_REPLICATE: 'singleReplicate',
};

/** Umbrales por defecto, todos ajustables desde la interfaz. */
export const QC_DEFAULTS = {
  maxSd: 0.5,      // SD de réplicas técnicas, en ciclos
  minCq: 12,       // por debajo, la ventana de línea base del equipo se solapa
  maxCq: 35,       // por encima, límite de detección
  minReplicates: 2,
};

/** Nombres de columna admitidos, en minúsculas y sin espacios. */
const FIELDS = {
  well: ['well', 'pocillo'],
  fluor: ['fluor', 'dye'],
  target: ['target', 'targetname', 'diana', 'gen'],
  content: ['content', 'tipo'],
  sample: ['sample', 'samplename', 'muestra'],
  cq: ['cq', 'ct', 'cт', 'cqvalue'],
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');

/** Empareja las cabeceras del archivo con los campos que hacen falta. */
export function mapHeaders(headers = []) {
  const map = {};
  for (const [field, names] of Object.entries(FIELDS)) {
    const hit = headers.find((h) => names.includes(norm(h)));
    if (hit !== undefined) map[field] = hit;
  }
  return map;
}

/**
 * Cq de una celda. Devuelve null cuando el pocillo no amplificó, NUNCA 0.
 * El 0 es un valor legítimo de Cq en teoría, así que no se puede usar como
 * marca de ausencia: por eso null.
 */
export function parseCq(raw) {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (UNDETERMINED.has(s.toLowerCase())) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** ¿Esta fila es un control sin molde? */
export function isNtc(content) {
  const c = norm(content);
  return c.includes('negctrl') || c.includes('ntc') || c.includes('negative')
    || c === 'neg' || c.includes('blank');
}

/**
 * Normaliza la tabla del equipo a las filas que usa el resto del módulo.
 * @param {{headers:string[], rows:Array<Object>}} table Salida de `parseTable`.
 * @returns {{wells:Array<Object>, mapping:Object, missing:string[]}}
 */
export function readRun(table, overrides = {}) {
  const mapping = { ...mapHeaders(table.headers || []), ...overrides };
  const missing = ['well', 'target', 'cq'].filter((k) => !mapping[k]);
  const wells = (table.rows || []).map((r) => ({
    well: String(r[mapping.well] ?? '').trim(),
    fluor: mapping.fluor ? String(r[mapping.fluor] ?? '').trim() : '',
    target: String(r[mapping.target] ?? '').trim(),
    content: mapping.content ? String(r[mapping.content] ?? '').trim() : '',
    sample: mapping.sample ? String(r[mapping.sample] ?? '').trim() : '',
    cq: parseCq(r[mapping.cq]),
  })).filter((w) => w.well !== '');
  return { wells, mapping, missing };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
function sd(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Agrupa por muestra y diana, recalculando media y SD **solo** con los
 * pocillos que amplificaron.
 * @returns {Array<{sample:string, target:string, wells:Array, cqs:number[],
 *                  n:number, undetermined:number, mean:number, sd:number}>}
 */
export function groupReplicates(wells = []) {
  const map = new Map();
  for (const w of wells) {
    if (isNtc(w.content)) continue;
    const key = w.sample + '\u0000' + w.target;
    if (!map.has(key)) map.set(key, { sample: w.sample, target: w.target, wells: [] });
    map.get(key).wells.push(w);
  }
  return [...map.values()].map((g) => {
    const cqs = g.wells.map((w) => w.cq).filter((c) => c != null);
    return {
      ...g,
      cqs,
      n: cqs.length,
      undetermined: g.wells.length - cqs.length,
      mean: cqs.length ? mean(cqs) : NaN,
      sd: sd(cqs),
    };
  }).sort((a, b) => (a.sample.localeCompare(b.sample) || a.target.localeCompare(b.target)));
}

/**
 * La réplica que más se aleja de la mediana del grupo. No se descarta sola:
 * se señala para que decida una persona, porque con n = 3 la estadística no
 * distingue un error de pipeteo de una muestra de verdad distinta.
 * @returns {{well:string, cq:number, deviation:number}|null}
 */
export function suggestOutlier(group) {
  if (!group || group.n < 3) return null;
  const sorted = [...group.cqs].sort((a, b) => a - b);
  const med = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  let worst = null;
  for (const w of group.wells) {
    if (w.cq == null) continue;
    const dev = Math.abs(w.cq - med);
    if (!worst || dev > worst.deviation) worst = { well: w.well, cq: w.cq, deviation: dev };
  }
  return worst;
}

/** SD del grupo si se quita esa réplica, para ver si merece la pena. */
export function sdWithout(group, well) {
  const cqs = group.wells.filter((w) => w.well !== well && w.cq != null).map((w) => w.cq);
  return sd(cqs);
}

/**
 * Informe de calidad de la tanda. Se calcula ANTES de cuantificar y el módulo
 * tiene que enseñarlo antes de dejar seguir.
 *
 * @param {Array} wells Salida de `readRun().wells`.
 * @param {Object} [opts] Umbrales; por defecto `QC_DEFAULTS`.
 * @returns {{groups:Array, ntc:Array, targets:string[], issues:Array,
 *            ok:boolean, counts:Object}}
 */
export function qcReport(wells = [], opts = {}) {
  const o = { ...QC_DEFAULTS, ...opts };
  const groups = groupReplicates(wells);
  const targets = [...new Set(wells.map((w) => w.target).filter(Boolean))].sort();

  const ntcWells = wells.filter((w) => isNtc(w.content));
  const ntc = targets.map((target) => {
    const own = ntcWells.filter((w) => w.target === target);
    const amplified = own.filter((w) => w.cq != null);
    return { target, wells: own.length, amplified: amplified.map((w) => ({ well: w.well, cq: w.cq })) };
  });

  const issues = [];
  for (const n of ntc) {
    if (n.wells === 0) issues.push({ code: QC.NO_NTC, target: n.target });
    else if (n.amplified.length) {
      issues.push({ code: QC.NTC_AMPLIFIED, target: n.target, wells: n.amplified });
    }
  }

  for (const g of groups) {
    const where = { sample: g.sample, target: g.target };
    if (g.undetermined > 0) {
      issues.push({ code: QC.UNDETERMINED, ...where, n: g.undetermined, of: g.wells.length });
      if (g.n <= g.wells.length / 2) {
        issues.push({ code: QC.MOSTLY_UNDETERMINED, ...where, n: g.n, of: g.wells.length });
      }
    }
    if (g.n === 1) issues.push({ code: QC.SINGLE_REPLICATE, ...where });
    if (g.n >= 2 && g.sd > o.maxSd) {
      const out = suggestOutlier(g);
      issues.push({
        code: QC.HIGH_SD, ...where, sd: g.sd,
        outlier: out, sdWithout: out ? sdWithout(g, out.well) : NaN,
      });
    }
    if (g.n && Math.min(...g.cqs) < o.minCq) {
      issues.push({ code: QC.EARLY_CQ, ...where, cq: Math.min(...g.cqs) });
    }
    if (g.n && Math.max(...g.cqs) > o.maxCq) {
      issues.push({ code: QC.LATE_CQ, ...where, cq: Math.max(...g.cqs) });
    }
  }

  const counts = {};
  issues.forEach((i) => { counts[i.code] = (counts[i.code] || 0) + 1; });

  return {
    groups, ntc, targets, issues, counts,
    ok: issues.length === 0,
  };
}
