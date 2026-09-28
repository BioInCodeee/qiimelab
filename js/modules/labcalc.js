// Calculadora Bioquímica y de Laboratorio para Smart-175.
// Módulo 100% en cliente para pesos moleculares (fórmulas e hidratos, ADN/ARN),
// preparación de disoluciones molares (m = C × V × MW) y diluciones (C1V1 = C2V2).

import { t } from '../lib/i18n.js';
import { escapeHtml, moreDetailsHtml } from '../lib/dom.js';

const STORE_KEY = 'smart-175.labcalc';

// ============================================================================
// 1. DICCIONARIO IUPAC DE PESOS ATÓMICOS ESTÁNDAR (g/mol)
// ============================================================================
export const ATOMIC_WEIGHTS = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007,
  O: 15.999, F: 18.998, Ne: 20.180, Na: 22.990, Mg: 24.305, Al: 26.982,
  Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948, K: 39.098,
  Ca: 40.078, Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938,
  Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ga: 69.723,
  Ge: 72.630, As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.468,
  Sr: 87.62, Y: 88.906, Zr: 91.224, Nb: 92.906, Mo: 95.95, Tc: 98,
  Ru: 101.07, Rh: 102.91, Pd: 106.42, Ag: 107.87, Cd: 112.41, In: 114.82,
  Sn: 118.71, Sb: 121.76, Te: 127.60, I: 126.90, Xe: 131.29, Cs: 132.91,
  Ba: 137.33, La: 138.91, Ce: 140.12, Pr: 140.91, Nd: 144.24, Sm: 150.36,
  Eu: 151.96, Gd: 157.25, Tb: 158.93, Dy: 162.50, Ho: 164.93, Er: 167.26,
  Tm: 168.93, Yb: 173.05, Lu: 174.97, Hf: 178.49, Ta: 180.95, W: 183.84,
  Re: 186.21, Os: 190.23, Ir: 192.22, Pt: 195.08, Au: 196.97, Hg: 200.59,
  Tl: 204.38, Pb: 207.2, Bi: 208.98, U: 238.03,
};

export const ELEMENT_NAMES = {
  H: 'Hidrógeno / Hydrogen', C: 'Carbono / Carbon', N: 'Nitrógeno / Nitrogen',
  O: 'Oxígeno / Oxygen', Na: 'Sodio / Sodium', Mg: 'Magnesio / Magnesium',
  P: 'Fósforo / Phosphorus', S: 'Azufre / Sulfur', Cl: 'Cloro / Chlorine',
  K: 'Potasio / Potassium', Ca: 'Calcio / Calcium', Fe: 'Hierro / Iron',
  Cu: 'Cobre / Copper', Zn: 'Cinc / Zinc', Mn: 'Manganeso / Manganese',
  Co: 'Cobalto / Cobalt', Ni: 'Níquel / Nickel', I: 'Yodo / Iodine',
  Br: 'Bromo / Bromine', F: 'Flúor / Fluorine', Al: 'Aluminio / Aluminium',
  Si: 'Silicio / Silicon', Ag: 'Plata / Silver', Ba: 'Bario / Barium',
  Pb: 'Plomo / Lead', Li: 'Litio / Lithium',
};

// Factores de conversión a SI base
export const MASS_UNITS = { g: 1, mg: 1e-3, 'µg': 1e-6, ug: 1e-6, ng: 1e-9 };
export const VOL_UNITS = { L: 1, mL: 1e-3, 'µL': 1e-6, uL: 1e-6 };
export const CONC_UNITS = {
  M: 1, mM: 1e-3, 'µM': 1e-6, uM: 1e-6, nM: 1e-9, pM: 1e-12,
  '%': 1, 'mg/mL': 1, 'µg/mL': 1e-3, 'ng/µL': 1, 'X': 1,
};

// ============================================================================
// 2. MOTORES MATEMÁTICOS
// ============================================================================

/**
 * Parsea una fórmula química con soporte para paréntesis, corchetes e hidratos
 * (ej. NaCl, C6H12O6, MgSO4·7H2O, Ca(OH)2, (NH4)2SO4, K3[Fe(CN)6]).
 */
export function parseChemicalFormula(formula) {
  if (!formula || typeof formula !== 'string') {
    return { ok: false, error: 'La fórmula debe ser una cadena no vacía.' };
  }
  const clean = formula.trim().replace(/\s+/g, '');
  if (!clean) {
    return { ok: false, error: 'Introduce una fórmula química.' };
  }

  // Separar hidratos por ·, * o punto entre grupos químicos
  const parts = clean.split(/[·*]|(?<=[A-Za-z0-9)\]])\.(?=\d*[A-Z])/);
  const totalElements = {};

  for (const rawPart of parts) {
    if (!rawPart) continue;
    const m = rawPart.match(/^(\d+)(.*)$/);
    let coeff = 1;
    let body = rawPart;
    if (m && m[2]) {
      coeff = parseInt(m[1], 10);
      body = m[2];
    } else if (m && !m[2]) {
      return { ok: false, error: `Segmento inválido: ${rawPart}` };
    }

    const tokens = body.match(/([A-Z][a-z]?|\d+|[()[\]])/g);
    if (!tokens || tokens.join('') !== body) {
      return { ok: false, error: `Caracteres no reconocidos en la fórmula: ${rawPart}` };
    }

    const stack = [{}];
    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok === '(' || tok === '[') {
        stack.push({});
        i++;
      } else if (tok === ')' || tok === ']') {
        if (stack.length <= 1) {
          return { ok: false, error: `Paréntesis o corchete de cierre desbalanceado en: ${rawPart}` };
        }
        i++;
        let mult = 1;
        if (i < tokens.length && /^\d+$/.test(tokens[i])) {
          mult = parseInt(tokens[i], 10);
          i++;
        }
        const top = stack.pop();
        const target = stack[stack.length - 1];
        for (const [el, cnt] of Object.entries(top)) {
          target[el] = (target[el] || 0) + cnt * mult;
        }
      } else if (/^[A-Z][a-z]?$/.test(tok)) {
        if (!ATOMIC_WEIGHTS[tok]) {
          return { ok: false, error: `Elemento químico desconocido o no soportado: "${tok}"` };
        }
        i++;
        let count = 1;
        if (i < tokens.length && /^\d+$/.test(tokens[i])) {
          count = parseInt(tokens[i], 10);
          i++;
        }
        const target = stack[stack.length - 1];
        target[tok] = (target[tok] || 0) + count;
      } else {
        return { ok: false, error: `Sintaxis inesperada cerca de: ${tok}` };
      }
    }

    if (stack.length !== 1) {
      return { ok: false, error: `Paréntesis o corchete de apertura sin cerrar en: ${rawPart}` };
    }

    for (const [el, cnt] of Object.entries(stack[0])) {
      totalElements[el] = (totalElements[el] || 0) + cnt * coeff;
    }
  }

  let mw = 0;
  const elements = [];
  for (const [symbol, count] of Object.entries(totalElements)) {
    const weight = count * ATOMIC_WEIGHTS[symbol];
    mw += weight;
    elements.push({
      symbol,
      name: ELEMENT_NAMES[symbol] || symbol,
      count,
      atomicWeight: ATOMIC_WEIGHTS[symbol],
      weight,
    });
  }

  // Ordenar elementos por masa decreciente
  elements.sort((a, b) => b.weight - a.weight);
  for (const el of elements) {
    el.percent = (el.weight / mw) * 100;
  }

  return {
    ok: true,
    formula: clean,
    mw: Math.round(mw * 1000) / 1000,
    elements,
  };
}

/**
 * Calcula el Peso Molecular aproximado de ácidos nucleicos.
 * - dsDNA: bp * 617.96 + 36.04
 * - ssDNA/primers: nt * 303.7 + 79.0
 * - ssRNA: nt * 320.5 + 159.0
 */
export function calcNucleicAcidMW(type, length) {
  const len = parseInt(length, 10);
  if (!Number.isFinite(len) || len <= 0) {
    return { ok: false, error: 'Introduce una longitud en bases o nucleótidos mayor a 0.' };
  }

  let mw = 0;
  let formulaStr = '';
  switch (type) {
    case 'dsDNA':
      mw = len * 617.96 + 36.04;
      formulaStr = `(${len} pb × 617.96) + 36.04`;
      break;
    case 'ssDNA':
      mw = len * 303.7 + 79.0;
      formulaStr = `(${len} nt × 303.7) + 79.0`;
      break;
    case 'ssRNA':
      mw = len * 320.5 + 159.0;
      formulaStr = `(${len} nt × 320.5) + 159.0`;
      break;
    default:
      return { ok: false, error: `Tipo de ácido nucleico desconocido: ${type}` };
  }

  return {
    ok: true,
    type,
    length: len,
    mw: Math.round(mw * 100) / 100,
    formulaStr,
  };
}

/**
 * Resuelve la ecuación de molaridad: m = C × V × MW.
 * Normaliza internamente a SI (m en g, V en L, C en M, MW en g/mol).
 */
export function solveMolarity({ mass, massUnit = 'g', vol, volUnit = 'L', conc, concUnit = 'M', mw }) {
  const mFactor = MASS_UNITS[massUnit] || 1;
  const vFactor = VOL_UNITS[volUnit] || 1;
  const cFactor = CONC_UNITS[concUnit] || 1;

  const mNum = parseFloat(String(mass).replace(',', '.'));
  const vNum = parseFloat(String(vol).replace(',', '.'));
  const cNum = parseFloat(String(conc).replace(',', '.'));
  const mwNum = parseFloat(String(mw).replace(',', '.'));

  const mVal = Number.isFinite(mNum) && mNum > 0 ? mNum * mFactor : null;
  const vVal = Number.isFinite(vNum) && vNum > 0 ? vNum * vFactor : null;
  const cVal = Number.isFinite(cNum) && cNum > 0 ? cNum * cFactor : null;
  const mwVal = Number.isFinite(mwNum) && mwNum > 0 ? mwNum : null;

  const filledCount = [mVal !== null, vVal !== null, cVal !== null, mwVal !== null].filter(Boolean).length;
  if (filledCount < 3) return null;

  let solved = null;
  let solvedValSI = null;
  let unit = null;
  let formulaDesc = '';

  if (mVal === null) {
    solved = 'mass';
    solvedValSI = cVal * vVal * mwVal;
    unit = massUnit;
    formulaDesc = 'm = C × V × MW';
  } else if (cVal === null) {
    solved = 'conc';
    solvedValSI = mVal / (vVal * mwVal);
    unit = concUnit;
    formulaDesc = 'C = m / (V × MW)';
  } else if (vVal === null) {
    solved = 'vol';
    solvedValSI = mVal / (cVal * mwVal);
    unit = volUnit;
    formulaDesc = 'V = m / (C × MW)';
  } else if (mwVal === null) {
    solved = 'mw';
    solvedValSI = mVal / (cVal * vVal);
    unit = 'g/mol';
    formulaDesc = 'MW = m / (C × V)';
  }

  if (!solved) return null;

  const resVal = solved === 'mass' ? solvedValSI / mFactor :
                 solved === 'vol' ? solvedValSI / vFactor :
                 solved === 'conc' ? solvedValSI / cFactor :
                 solvedValSI;

  return {
    ok: true,
    solved,
    value: resVal,
    unit,
    siValue: solvedValSI,
    formulaDesc,
  };
}

/**
 * Resuelve la ecuación de dilución: C1 × V1 = C2 × V2.
 * Normaliza unidades y calcula el volumen de diluyente requerido (V2 - V1).
 */
export function solveDilution({ c1, c1Unit = 'M', v1, v1Unit = 'mL', c2, c2Unit = 'M', v2, v2Unit = 'mL' }) {
  const c1Factor = CONC_UNITS[c1Unit] || 1;
  const c2Factor = CONC_UNITS[c2Unit] || 1;
  const v1Factor = VOL_UNITS[v1Unit] || 1;
  const v2Factor = VOL_UNITS[v2Unit] || 1;

  const c1Num = parseFloat(String(c1).replace(',', '.'));
  const v1Num = parseFloat(String(v1).replace(',', '.'));
  const c2Num = parseFloat(String(c2).replace(',', '.'));
  const v2Num = parseFloat(String(v2).replace(',', '.'));

  const c1Val = Number.isFinite(c1Num) && c1Num > 0 ? c1Num * c1Factor : null;
  const v1Val = Number.isFinite(v1Num) && v1Num > 0 ? v1Num * v1Factor : null;
  const c2Val = Number.isFinite(c2Num) && c2Num > 0 ? c2Num * c2Factor : null;
  const v2Val = Number.isFinite(v2Num) && v2Num > 0 ? v2Num * v2Factor : null;

  const filledCount = [c1Val !== null, v1Val !== null, c2Val !== null, v2Val !== null].filter(Boolean).length;
  if (filledCount < 3) return null;

  let solved = null;
  let solvedValSI = null;
  let solvedUnit = null;

  if (v1Val === null) {
    solved = 'v1';
    solvedValSI = (c2Val * v2Val) / c1Val;
    solvedUnit = v1Unit;
  } else if (c1Val === null) {
    solved = 'c1';
    solvedValSI = (c2Val * v2Val) / v1Val;
    solvedUnit = c1Unit;
  } else if (v2Val === null) {
    solved = 'v2';
    solvedValSI = (c1Val * v1Val) / c2Val;
    solvedUnit = v2Unit;
  } else if (c2Val === null) {
    solved = 'c2';
    solvedValSI = (c1Val * v1Val) / v2Val;
    solvedUnit = c2Unit;
  }

  if (!solved) return null;

  const resVal = solved === 'v1' ? solvedValSI / v1Factor :
                 solved === 'v2' ? solvedValSI / v2Factor :
                 solved === 'c1' ? solvedValSI / c1Factor :
                 solvedValSI / c2Factor;

  const actV1SI = solved === 'v1' ? solvedValSI : v1Val;
  const actV2SI = solved === 'v2' ? solvedValSI : v2Val;
  const actC1SI = solved === 'c1' ? solvedValSI : c1Val;
  const actC2SI = solved === 'c2' ? solvedValSI : c2Val;

  const isValidDilution = actC1SI >= actC2SI && actV2SI >= actV1SI;
  const vDilSI = actV2SI - actV1SI;
  const vDilInV2Unit = vDilSI / v2Factor;

  return {
    ok: true,
    solved,
    value: resVal,
    unit: solvedUnit,
    isValidDilution,
    vDilSI,
    vDilInV2Unit,
    v1Val: actV1SI / v1Factor,
    v1Unit,
    v2Val: actV2SI / v2Factor,
    v2Unit,
    c1Val: actC1SI / c1Factor,
    c1Unit,
    c2Val: actC2SI / c2Factor,
    c2Unit,
  };
}

// Formateador limpio de números de laboratorio
export function fmtLabNumber(val, decimals = 4) {
  if (!Number.isFinite(val)) return '—';
  if (val === 0) return '0';
  const abs = Math.abs(val);
  if (abs >= 1e6 || (abs < 1e-4 && abs > 0)) {
    return val.toExponential(decimals);
  }
  const factor = Math.pow(10, decimals);
  return (Math.round(val * factor) / factor).toString();
}

/**
 * Lista por defecto de reactivos para una reacción estándar de PCR de 20 µL
 * (VF por defecto del proyecto). Cebadores a 0.4 µL de stock 10 µM = 0.2 µM
 * final (mismo objetivo que el modo "Master Mix comercial"); el agua absorbe
 * la diferencia frente a la receta previa de 25 µL.
 */
export function getDefaultMasterMixReagents() {
  return [
    { id: 'h2o', name: t('calc.mmDefaultH2O') || 'H2O PCR-grade', unitVol: 11.0, inMix: true },
    { id: 'buffer', name: t('calc.mmDefaultBuffer') || 'Tampón PCR (10X)', unitVol: 2.5, inMix: true },
    { id: 'dntps', name: t('calc.mmDefaultDNTPs') || 'dNTPs (10 mM)', unitVol: 0.5, inMix: true },
    { id: 'fwd', name: t('calc.mmDefaultFwd') || 'Cebador Forward (10 µM)', unitVol: 0.4, inMix: true },
    { id: 'rev', name: t('calc.mmDefaultRev') || 'Cebador Reverse (10 µM)', unitVol: 0.4, inMix: true },
    { id: 'taq', name: t('calc.mmDefaultTaq') || 'Taq Polimerasa (5 U/µL)', unitVol: 0.2, inMix: true },
    { id: 'template', name: t('calc.mmDefaultTemplate') || 'Molde de ADN', unitVol: 5.0, inMix: false },
  ];
}

/**
 * Calcula los volúmenes necesarios para un cóctel de PCR (Master Mix),
 * aplicando el multiplicador por número de reacciones y el factor de excedente/pipeteo.
 *
 * Multiplicador = N × (1 + Margen% / 100)
 * Para reactivos en Master Mix: Vol_total = Vol_unitario × Multiplicador
 * Para reactivos excluidos (ej. Template): Vol_total = 0 (se añade individualmente)
 */
export function calculateMasterMix(reagents, numReactions, excessPct = 10) {
  const n = Math.max(0, parseFloat(numReactions) || 0);
  const excess = Math.max(0, parseFloat(excessPct) || 0);
  const effectiveReactions = n * (1 + excess / 100);

  const safeReagents = Array.isArray(reagents) ? reagents : [];
  let totalPerRxn = 0;
  let totalMasterMix = 0;
  let pipettePerWell = 0;
  let templatePerWell = 0;

  const enriched = safeReagents.map((r) => {
    const unitVol = Math.max(0, parseFloat(r.unitVol) || 0);
    const inMix = Boolean(r.inMix);
    const totalVol = inMix ? unitVol * effectiveReactions : 0;

    totalPerRxn += unitVol;
    if (inMix) {
      pipettePerWell += unitVol;
      totalMasterMix += totalVol;
    } else {
      templatePerWell += unitVol;
    }

    return {
      id: r.id,
      name: r.name,
      unitVol,
      inMix,
      totalVol,
    };
  });

  return {
    numReactions: n,
    excessPct: excess,
    effectiveReactions,
    totalPerRxn,
    totalMasterMix,
    pipettePerWell,
    templatePerWell,
    reagents: enriched,
  };
}

/**
 * Calcula el volumen de molde de ADN requerido a partir de la masa objetivo y concentración.
 * V_adn = Masa (ng) / Concentración (ng/µL)
 *
 * @param {number|string} targetMassNg - Masa objetivo en nanogramos
 * @param {number|string} concNgPerUl - Concentración en ng/µL
 * @returns {number|null} Volumen en µL o null si los valores son inválidos
 */
export function calcDnaTemplateVolume(targetMassNg, concNgPerUl) {
  const mass = parseFloat(targetMassNg);
  const conc = parseFloat(concNgPerUl);
  if (!Number.isFinite(mass) || !Number.isFinite(conc) || conc <= 0 || mass <= 0) {
    return null;
  }
  return Math.round((mass / conc) * 10000) / 10000;
}

/**
 * Auto-balancea el volumen de agua (H2O PCR-grade) al modificar el volumen de molde de ADN,
 * manteniendo el volumen total unitario de la reacción (ej. 25 µL) constante.
 *
 * Delta = V_dna_nuevo - V_dna_antiguo
 * V_agua_nuevo = V_agua_antiguo - Delta
 *
 * @param {Array} reagents - Lista de reactivos
 * @param {number|string} newDnaVol - Nuevo volumen unitario del molde en µL
 * @param {string} [templateId='template'] - ID del molde de ADN
 * @param {string} [waterId='h2o'] - ID del agua
 * @returns {Array} Nueva lista de reactivos con los volúmenes actualizados
 */
export function autoBalanceDnaWater(reagents, newDnaVol, templateId = 'template', waterId = 'h2o') {
  if (!Array.isArray(reagents)) return [];
  const safeDnaVol = Math.max(0, parseFloat(newDnaVol) || 0);

  const templateIdx = reagents.findIndex((r) => r.id === templateId);
  const waterIdx = reagents.findIndex((r) => r.id === waterId);

  if (templateIdx === -1 || waterIdx === -1) {
    return reagents.map((r) => ({ ...r }));
  }

  const oldDnaVol = Math.max(0, parseFloat(reagents[templateIdx].unitVol) || 0);
  const oldWaterVol = Math.max(0, parseFloat(reagents[waterIdx].unitVol) || 0);

  const delta = safeDnaVol - oldDnaVol;
  const rawNewWaterVol = oldWaterVol - delta;
  const newWaterVol = Math.max(0, Math.round(rawNewWaterVol * 10000) / 10000);
  const roundedDnaVol = Math.round(safeDnaVol * 10000) / 10000;

  return reagents.map((r, i) => {
    if (i === templateIdx) {
      return { ...r, unitVol: roundedDnaVol };
    }
    if (i === waterIdx) {
      return { ...r, unitVol: newWaterVol };
    }
    return { ...r };
  });
}

/**
 * Recalcula el volumen de agua (H2O) de una lista de reactivos como el resto
 * hasta un volumen final objetivo, a partir de TODOS los demás reactivos.
 *
 * A diferencia de autoBalanceDnaWater() (que ajusta el agua por el DELTA de
 * un único campo, el molde, asumiendo que el total ya estaba en su sitio),
 * esta versión generalizada recalcula el agua desde cero cada vez — sirve
 * igual si lo que cambió fue el volumen final, la concentración de la
 * mezcla comercial, los cebadores, el molde o cualquier reactivo extra
 * (modo "Master Mix comercial").
 *
 * Nunca negativa: si el resto de componentes ya supera el volumen objetivo,
 * el agua se acota a 0 y se señala `overflow: true` (nunca un volumen
 * negativo silencioso).
 *
 * @param {Array} reagents - reactivos, incluido el de agua (su unitVol se sobreescribe)
 * @param {number|string} targetVolume - volumen final objetivo (VF) en µL
 * @param {string} [waterId='h2o']
 * @returns {{ reagents: Array, water: number, overflow: boolean }}
 */
export function balanceWaterToVolume(reagents, targetVolume, waterId = 'h2o') {
  const vf = Math.max(0, parseFloat(targetVolume) || 0);
  const safeReagents = Array.isArray(reagents) ? reagents : [];
  const waterIdx = safeReagents.findIndex((r) => r.id === waterId);

  const othersSum = safeReagents.reduce((acc, r, i) => {
    if (i === waterIdx) return acc;
    return acc + Math.max(0, parseFloat(r.unitVol) || 0);
  }, 0);

  const rawWater = vf - othersSum;
  const overflow = rawWater < 0;
  const water = Math.max(0, Math.round(rawWater * 10000) / 10000);

  if (waterIdx === -1) {
    return { reagents: safeReagents.map((r) => ({ ...r })), water, overflow };
  }
  return {
    reagents: safeReagents.map((r, i) => (i === waterIdx ? { ...r, unitVol: water } : { ...r })),
    water,
    overflow,
  };
}

// Concentración final de cebador sugerida para PCR de amplicones 16S/ITS con
// mezclas comerciales 2X — ver justificación y fuentes citadas en
// calc.mmPrimerConcHint (protocolos EMP 16S/ITS + Illumina 16S V3-V4, todos
// a 0.2 µM final; NEB confirma 200 nM como recomendación general con Taq).
export const RECOMMENDED_PRIMER_FINAL_UM = 0.2;

/**
 * Valores por defecto del modo "Master Mix comercial" (Modo A): VF=20 µL,
 * mezcla comercial 2X, cebadores a concentración final recomendada 0.2 µM
 * desde un stock 10 µM.
 */
export function getDefaultCommercialMix() {
  return {
    vf: 20,
    mixX: 2,
    primerStock: 10,
    primerFinal: RECOMMENDED_PRIMER_FINAL_UM,
    templateVol: 2,
    extras: [],
  };
}

/**
 * Modo A — Master Mix comercial: deriva la lista de reactivos (mezcla
 * comercial NX, cebadores Fwd/Rev, molde, extras opcionales y agua) a partir
 * de parámetros editables, en vez del modelo reactivo-a-reactivo del Modo B.
 *
 *   volMix    = VF / X
 *   volCebador = (concFinal × VF) / concStock   (igual para Fwd y Rev)
 *   agua      = balanceWaterToVolume(..., VF)   (nunca negativa)
 *
 * @param {{vf:number, mixX:number, primerStock:number, primerFinal:number,
 *          templateVol:number, extras:Array}} commercial
 * @returns {{ reagents: Array, volMix: number, volPrimer: number,
 *             water: number, overflow: boolean }}
 */
export function computeCommercialMix(commercial) {
  const c = commercial || {};
  const vf = Math.max(0, parseFloat(c.vf) || 0);
  const mixX = Math.max(0, parseFloat(c.mixX) || 0);
  const primerStock = Math.max(0, parseFloat(c.primerStock) || 0);
  const primerFinal = Math.max(0, parseFloat(c.primerFinal) || 0);
  const templateVol = Math.max(0, parseFloat(c.templateVol) || 0);
  const extras = Array.isArray(c.extras) ? c.extras : [];

  const volMix = mixX > 0 ? Math.round((vf / mixX) * 10000) / 10000 : 0;
  const volPrimer = primerStock > 0 ? Math.round(((primerFinal * vf) / primerStock) * 10000) / 10000 : 0;

  const withoutWater = [
    { id: 'mix', name: c.mixName || t('calc.mmComMixRowName', { x: fmtLabNumber(mixX, 2) }) || `Master Mix comercial (${fmtLabNumber(mixX, 2)}X)`, unitVol: volMix, inMix: true },
    { id: 'primerFwd', name: t('calc.mmDefaultFwd') || 'Cebador Forward', unitVol: volPrimer, inMix: true },
    { id: 'primerRev', name: t('calc.mmDefaultRev') || 'Cebador Reverse', unitVol: volPrimer, inMix: true },
    ...extras.map((e) => ({
      id: e.id,
      name: e.name,
      unitVol: Math.max(0, parseFloat(e.unitVol) || 0),
      inMix: e.inMix !== false,
    })),
    { id: 'h2o', name: t('calc.mmDefaultH2O') || 'H2O PCR-grade', unitVol: 0, inMix: true },
    { id: 'template', name: t('calc.mmDefaultTemplate') || 'Molde de ADN', unitVol: templateVol, inMix: false },
  ];

  const { reagents, water, overflow } = balanceWaterToVolume(withoutWater, vf, 'h2o');

  return { reagents, volMix, volPrimer, water, overflow };
}

// ---- qPCR (Fase 2, B4) -------------------------------------------------------
// Una qPCR se prepara igual que el "Master Mix comercial" (mezcla 2X lista +
// cebadores + molde + agua), así que reutiliza computeCommercialMix; lo que
// cambia son los valores de partida y dos cosas propias de qPCR: la sonda
// (química TaqMan/hidrólisis) y el nº de reacciones de la placa, que se
// cuenta como (muestras + puntos de la curva estándar + NTC) × réplicas
// técnicas. Concentraciones finales de partida (editables):
//  - SYBR Green: cebadores 0,4 µM (rango habitual 0,1–0,5 µM).
//  - Sonda (TaqMan): cebadores 0,9 µM y sonda 0,25 µM (las del protocolo
//    estándar de Applied Biosystems para ensayos TaqMan).
export const QPCR_PRIMER_FINAL_UM = Object.freeze({ sybr: 0.4, probe: 0.9 });
export const QPCR_PROBE_FINAL_UM = 0.25;

/** Valores de partida del modo qPCR para la química dada ('sybr' | 'probe'). */
export function getDefaultQpcrMix(chem = 'sybr') {
  const c = chem === 'probe' ? 'probe' : 'sybr';
  return {
    chem: c,
    vf: 20,
    mixX: 2,
    primerStock: 10,
    primerFinal: QPCR_PRIMER_FINAL_UM[c],
    probeStock: 10,
    probeFinal: QPCR_PROBE_FINAL_UM,
    templateVol: 2,
    extras: [],
    plate: { samples: 8, standards: 5, ntc: 1, replicates: 3 },
  };
}

/** Reacciones de una placa de qPCR: (muestras + estándares + NTC) × réplicas técnicas. */
export function qpcrReactionCount(plate) {
  const p = plate || {};
  const n = (k) => Math.max(0, Math.floor(parseFloat(p[k]) || 0));
  return (n('samples') + n('standards') + n('ntc')) * Math.max(1, n('replicates'));
}

/**
 * Mezcla de qPCR: la del modo comercial con la fila de la mezcla rotulada por
 * química y, si es de sonda, una fila derivada para la sonda
 * (vol = conc. final × VF / stock), antes del agua.
 */
export function computeQpcrMix(q) {
  const c = q || {};
  const vf = Math.max(0, parseFloat(c.vf) || 0);
  const probeStock = Math.max(0, parseFloat(c.probeStock) || 0);
  const probeFinal = Math.max(0, parseFloat(c.probeFinal) || 0);
  const volProbe = c.chem === 'probe' && probeStock > 0 ? Math.round(((probeFinal * vf) / probeStock) * 10000) / 10000 : 0;
  const extras = [
    ...(c.chem === 'probe' ? [{ id: 'probe', name: t('calc.qpcrProbeRow', { stock: fmtLabNumber(probeStock, 2) }), unitVol: volProbe, inMix: true }] : []),
    ...(Array.isArray(c.extras) ? c.extras : []),
  ];
  const mixName = t(c.chem === 'probe' ? 'calc.qpcrMixRowProbe' : 'calc.qpcrMixRowSybr', { x: fmtLabNumber(parseFloat(c.mixX) || 0, 2) });
  return { ...computeCommercialMix({ ...c, extras, mixName }), volProbe };
}

// ============================================================================
// 3. ESTADO DEL MÓDULO Y PERSISTENCIA
// ============================================================================

function defaultState() {
  return {
    tab: 'mw', // 'mw' | 'molarity' | 'dilutions' | 'mastermix'
    formula: 'MgSO4·7H2O',
    naType: 'dsDNA',
    naLength: '1000',
    molarity: {
      mass: '',
      massUnit: 'g',
      vol: '500',
      volUnit: 'mL',
      conc: '0.1',
      concUnit: 'M',
      mw: '58.44',
      lastAuto: 'mass',
    },
    dilution: {
      c1: '10',
      c1Unit: 'X',
      v1: '',
      v1Unit: 'mL',
      c2: '1',
      c2Unit: 'X',
      v2: '100',
      v2Unit: 'mL',
      lastAuto: 'v1',
    },
    masterMix: {
      mode: 'commercial', // 'commercial' (Modo A, por defecto) | 'components' (Modo B) | 'qpcr'
      numReactions: 10,
      excessPct: 10,
      dnaConc: '',
      dnaTargetMass: 30,
      reagents: getDefaultMasterMixReagents(),
      commercial: getDefaultCommercialMix(),
      qpcr: getDefaultQpcrMix('sybr'),
    },
  };
}

/** Sanea el estado qPCR guardado (mismo criterio que el comercial). */
function loadQpcr(raw) {
  const chem = raw && raw.chem === 'probe' ? 'probe' : 'sybr';
  const def = getDefaultQpcrMix(chem);
  if (!raw || typeof raw !== 'object') return def;
  const numOr = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
  const p = raw.plate && typeof raw.plate === 'object' ? raw.plate : {};
  return {
    chem,
    vf: numOr(raw.vf, def.vf), mixX: numOr(raw.mixX, def.mixX),
    primerStock: numOr(raw.primerStock, def.primerStock), primerFinal: numOr(raw.primerFinal, def.primerFinal),
    probeStock: numOr(raw.probeStock, def.probeStock), probeFinal: numOr(raw.probeFinal, def.probeFinal),
    templateVol: numOr(raw.templateVol, def.templateVol),
    extras: Array.isArray(raw.extras) ? raw.extras.map((r, i) => ({
      id: String(r.id || `q_${i}_${Date.now()}`), name: typeof r.name === 'string' ? r.name : '',
      unitVol: numOr(r.unitVol, 0), inMix: r.inMix !== false,
    })) : [],
    plate: {
      samples: numOr(p.samples, def.plate.samples), standards: numOr(p.standards, def.plate.standards),
      ntc: numOr(p.ntc, def.plate.ntc), replicates: numOr(p.replicates, def.plate.replicates),
    },
  };
}

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const def = defaultState();
      return {
        tab: ['mw', 'molarity', 'dilutions', 'mastermix'].includes(raw.tab) ? raw.tab : def.tab,
        formula: typeof raw.formula === 'string' ? raw.formula : def.formula,
        naType: ['dsDNA', 'ssDNA', 'ssRNA'].includes(raw.naType) ? raw.naType : def.naType,
        naLength: String(raw.naLength || def.naLength),
        molarity: { ...def.molarity, ...(raw.molarity || {}) },
        dilution: { ...def.dilution, ...(raw.dilution || {}) },
        masterMix: raw.masterMix && typeof raw.masterMix === 'object' ? {
          mode: ['commercial', 'components', 'qpcr'].includes(raw.masterMix.mode) ? raw.masterMix.mode : def.masterMix.mode,
          qpcr: loadQpcr(raw.masterMix.qpcr),
          numReactions: typeof raw.masterMix.numReactions === 'number' ? raw.masterMix.numReactions : (parseFloat(raw.masterMix.numReactions) || def.masterMix.numReactions),
          excessPct: typeof raw.masterMix.excessPct === 'number' ? raw.masterMix.excessPct : (parseFloat(raw.masterMix.excessPct) || def.masterMix.excessPct),
          dnaConc: typeof raw.masterMix.dnaConc === 'string' || typeof raw.masterMix.dnaConc === 'number' ? String(raw.masterMix.dnaConc) : def.masterMix.dnaConc,
          dnaTargetMass: typeof raw.masterMix.dnaTargetMass === 'number' ? raw.masterMix.dnaTargetMass : (parseFloat(raw.masterMix.dnaTargetMass) || def.masterMix.dnaTargetMass),
          reagents: Array.isArray(raw.masterMix.reagents) && raw.masterMix.reagents.length > 0
            ? raw.masterMix.reagents.map((r, i) => ({
                id: String(r.id || `r_${i}_${Date.now()}`),
                name: typeof r.name === 'string' ? r.name : '',
                unitVol: typeof r.unitVol === 'number' ? r.unitVol : (parseFloat(r.unitVol) || 0),
                inMix: r.inMix !== undefined ? Boolean(r.inMix) : true,
              }))
            : def.masterMix.reagents,
          commercial: raw.masterMix.commercial && typeof raw.masterMix.commercial === 'object' ? {
            vf: typeof raw.masterMix.commercial.vf === 'number' ? raw.masterMix.commercial.vf : (parseFloat(raw.masterMix.commercial.vf) || def.masterMix.commercial.vf),
            mixX: typeof raw.masterMix.commercial.mixX === 'number' ? raw.masterMix.commercial.mixX : (parseFloat(raw.masterMix.commercial.mixX) || def.masterMix.commercial.mixX),
            primerStock: typeof raw.masterMix.commercial.primerStock === 'number' ? raw.masterMix.commercial.primerStock : (parseFloat(raw.masterMix.commercial.primerStock) || def.masterMix.commercial.primerStock),
            primerFinal: typeof raw.masterMix.commercial.primerFinal === 'number' ? raw.masterMix.commercial.primerFinal : (parseFloat(raw.masterMix.commercial.primerFinal) || def.masterMix.commercial.primerFinal),
            templateVol: typeof raw.masterMix.commercial.templateVol === 'number' ? raw.masterMix.commercial.templateVol : (parseFloat(raw.masterMix.commercial.templateVol) || def.masterMix.commercial.templateVol),
            extras: Array.isArray(raw.masterMix.commercial.extras)
              ? raw.masterMix.commercial.extras.map((r, i) => ({
                  id: String(r.id || `x_${i}_${Date.now()}`),
                  name: typeof r.name === 'string' ? r.name : '',
                  unitVol: typeof r.unitVol === 'number' ? r.unitVol : (parseFloat(r.unitVol) || 0),
                  inMix: r.inMix !== undefined ? Boolean(r.inMix) : true,
                }))
              : def.masterMix.commercial.extras,
          } : def.masterMix.commercial,
        } : def.masterMix,
      };
    }
  } catch (e) { /* ignore */ }
  return defaultState();
}

function saveState(s) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch (e) { /* ignore */ }
}

// ============================================================================
// 4. RENDERIZADO PRINCIPAL DEL MÓDULO (SUB-PESTAÑAS)
// ============================================================================

export function render(container) {
  const s = loadState();

  const TABS = [
    { id: 'mw', labelKey: 'calc.tabMW' },
    { id: 'molarity', labelKey: 'calc.tabMolarity' },
    { id: 'dilutions', labelKey: 'calc.tabDilutions' },
    { id: 'mastermix', labelKey: 'calc.tabMasterMix' },
  ];

  function paint() {
    container.innerHTML = '';

    // Cabecera estándar de página
    const header = document.createElement('header');
    header.className = 'ql-page-header';
    header.innerHTML =
      `<p class="ql-eyebrow">${t('calc.eyebrow')}</p>` +
      `<h1 class="ql-page-title">${t('calc.title')}</h1>` +
      `<p class="ql-page-sub">${t('calc.subtitle')}</p>`;
    container.appendChild(header);

    // Navegación interna con sub-pestañas (.ql-tabs)
    const tabsEl = document.createElement('div');
    tabsEl.className = 'ql-tabs';
    tabsEl.setAttribute('role', 'tablist');
    TABS.forEach((tabDef) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-tab' + (s.tab === tabDef.id ? ' is-active' : '');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(s.tab === tabDef.id));
      b.textContent = t(tabDef.labelKey);
      b.addEventListener('click', () => {
        s.tab = tabDef.id;
        saveState(s);
        paint();
      });
      tabsEl.appendChild(b);
    });
    container.appendChild(tabsEl);

    // Renderizado exclusivo del panel activo
    if (s.tab === 'mw') {
      paintMW(container);
    } else if (s.tab === 'molarity') {
      paintMolarity(container);
    } else if (s.tab === 'dilutions') {
      paintDilutions(container);
    } else {
      paintMasterMix(container);
    }
  }

  // --------------------------------------------------------------------------
  // SUB-PESTAÑA 1: PESO MOLECULAR (FÓRMULAS QUÍMICAS Y ÁCIDOS NUCLEICOS)
  // --------------------------------------------------------------------------
  function paintMW(parent) {
    const stack = document.createElement('div');
    stack.className = 'ql-stack';

    // ---- TARJETA 1: Fórmulas Químicas ----
    const chemCard = document.createElement('section');
    chemCard.className = 'ql-card ql-panel';

    const chemPresets = [
      { label: 'NaCl', formula: 'NaCl' },
      { label: 'Tris base', formula: 'C4H11NO3' },
      { label: 'EDTA', formula: 'C10H16N2O8' },
      { label: 'SDS', formula: 'NaC12H25SO4' },
      { label: 'HEPES', formula: 'C8H18N2O4S' },
      { label: 'MgSO₄·7H₂O', formula: 'MgSO4·7H2O' },
      { label: 'Glucosa', formula: 'C6H12O6' },
      { label: 'CaCl₂·2H₂O', formula: 'CaCl2.2H2O' },
      { label: 'CuSO₄·5H₂O', formula: 'CuSO4*5H2O' },
      { label: '(NH₄)₂SO₄', formula: '(NH4)2SO4' },
    ];

    chemCard.innerHTML = `
      <h2>${t('calc.chemTitle')}</h2>
      <p class="ql-panel-note">${t('calc.chemDesc')}</p>
      <div class="ql-calc-presets">
        <span class="ql-calc-presets-label">${t('calc.chemExamples')}</span>
        <div class="ql-calc-presets-tags">
          ${chemPresets.map(p => `<button type="button" class="ql-calc-preset-tag" data-formula="${p.formula}">${p.label}</button>`).join('')}
        </div>
      </div>
      <div class="ql-calc-input-row" style="margin-top:14px;">
        <input type="text" id="ql-calc-formula-input" class="ql-calc-text-input"
               placeholder="${t('calc.formulaPlaceholder')}" value="${s.formula || ''}" spellcheck="false" autocomplete="off" />
        <button type="button" id="ql-calc-formula-btn" class="ql-btn ql-btn-primary">${t('calc.calculateBtn')}</button>
      </div>
      <div id="ql-calc-formula-result" class="ql-calc-result-area" style="margin-top:16px;"></div>
    `;
    stack.appendChild(chemCard);

    // ---- TARJETA 2: Ácidos Nucleicos (ADN / ARN) ----
    const naCard = document.createElement('section');
    naCard.className = 'ql-card ql-panel';
    naCard.innerHTML = `
      <h2>${t('calc.naTitle')}</h2>
      <p class="ql-panel-note">${t('calc.naDesc')}</p>
      <div class="ql-calc-form-grid" style="margin-top:14px;">
        <div class="ql-calc-field">
          <label class="ql-calc-label" for="ql-calc-na-type">${t('calc.naType')}</label>
          <select id="ql-calc-na-type" class="ql-calc-select">
            <option value="dsDNA" ${s.naType === 'dsDNA' ? 'selected' : ''}>${t('calc.dsDNA')}</option>
            <option value="ssDNA" ${s.naType === 'ssDNA' ? 'selected' : ''}>${t('calc.ssDNA')}</option>
            <option value="ssRNA" ${s.naType === 'ssRNA' ? 'selected' : ''}>${t('calc.ssRNA')}</option>
          </select>
        </div>
        <div class="ql-calc-field">
          <label class="ql-calc-label" for="ql-calc-na-len">${t('calc.naLength')} (<span id="ql-calc-na-unit-label">${s.naType === 'dsDNA' ? t('calc.bpUnit') : t('calc.ntUnit')}</span>)</label>
          <div class="ql-calc-unit-group">
            <input type="number" id="ql-calc-na-len" min="1" step="1" value="${s.naLength || '1000'}" class="ql-calc-number-input" />
            <span class="ql-calc-unit-badge" id="ql-calc-na-unit-badge">${s.naType === 'dsDNA' ? t('calc.bpUnit') : t('calc.ntUnit')}</span>
          </div>
        </div>
      </div>
      <div id="ql-calc-na-result" class="ql-calc-result-area" style="margin-top:16px;"></div>
    `;
    stack.appendChild(naCard);

    parent.appendChild(stack);

    // Eventos y cálculo interactivo de Fórmulas Químicas
    const formulaInput = chemCard.querySelector('#ql-calc-formula-input');
    const formulaBtn = chemCard.querySelector('#ql-calc-formula-btn');
    const formulaResult = chemCard.querySelector('#ql-calc-formula-result');

    function updateFormula() {
      const f = formulaInput.value.trim();
      s.formula = f;
      saveState(s);
      if (!f) {
        formulaResult.innerHTML = '';
        return;
      }
      const res = parseChemicalFormula(f);
      if (!res.ok) {
        formulaResult.innerHTML = `<div class="ql-calc-alert ql-calc-alert-error">${res.error}</div>`;
        return;
      }

      formulaResult.innerHTML = `
        <div class="ql-calc-result-box">
          <div class="ql-calc-result-header">
            <div>
              <span class="ql-calc-result-label">${t('calc.molarMass')}:</span>
              <div class="ql-calc-result-val">${fmtLabNumber(res.mw, 3)} <span class="ql-calc-result-unit">g/mol</span></div>
            </div>
            <button type="button" class="ql-btn ql-btn-secondary ql-calc-bridge-btn" id="ql-calc-use-mw-btn">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14m-7-7 7 7-7 7"/></svg>
              ${t('calc.useInMolarity')}
            </button>
          </div>
          <div class="ql-calc-composition-title">${t('calc.composition')}:</div>
          <div class="ql-calc-table-wrap">
            <table class="ql-calc-table">
              <thead>
                <tr>
                  <th>Símbolo</th>
                  <th>Elemento</th>
                  <th style="text-align:right;">Átomos</th>
                  <th style="text-align:right;">Masa (g/mol)</th>
                  <th style="text-align:right;">% Masa</th>
                </tr>
              </thead>
              <tbody>
                ${res.elements.map(el => `
                  <tr>
                    <td><strong>${el.symbol}</strong></td>
                    <td class="ql-ink-muted">${el.name}</td>
                    <td style="text-align:right;">${el.count}</td>
                    <td style="text-align:right; font-family:var(--font-mono);">${fmtLabNumber(el.weight, 3)}</td>
                    <td style="text-align:right;">
                      <span class="ql-calc-percent-tag">${el.percent.toFixed(2)}%</span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // Puente hacia Molaridad
      const useBtn = formulaResult.querySelector('#ql-calc-use-mw-btn');
      if (useBtn) {
        useBtn.addEventListener('click', () => {
          s.molarity.mw = String(res.mw);
          if (s.molarity.lastAuto === 'mw') s.molarity.lastAuto = null;
          s.tab = 'molarity';
          saveState(s);
          paint();
        });
      }
    }

    formulaBtn.addEventListener('click', updateFormula);
    formulaInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') updateFormula();
    });
    formulaInput.addEventListener('input', () => {
      s.formula = formulaInput.value;
      saveState(s);
    });

    chemCard.querySelectorAll('.ql-calc-preset-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        formulaInput.value = tag.getAttribute('data-formula') || '';
        updateFormula();
      });
    });

    // Render inicial si había fórmula
    if (s.formula) updateFormula();

    // Eventos y cálculo de Ácidos Nucleicos
    const naTypeSelect = naCard.querySelector('#ql-calc-na-type');
    const naLenInput = naCard.querySelector('#ql-calc-na-len');
    const naUnitLabel = naCard.querySelector('#ql-calc-na-unit-label');
    const naUnitBadge = naCard.querySelector('#ql-calc-na-unit-badge');
    const naResult = naCard.querySelector('#ql-calc-na-result');

    function updateNA() {
      const type = naTypeSelect.value;
      const len = naLenInput.value;
      s.naType = type;
      s.naLength = len;
      saveState(s);

      const unitText = type === 'dsDNA' ? t('calc.bpUnit') : t('calc.ntUnit');
      if (naUnitLabel) naUnitLabel.textContent = unitText;
      if (naUnitBadge) naUnitBadge.textContent = unitText;

      const res = calcNucleicAcidMW(type, len);
      if (!res.ok) {
        naResult.innerHTML = `<div class="ql-calc-alert ql-calc-alert-error">${res.error}</div>`;
        return;
      }

      const mwKDa = res.mw / 1000;
      naResult.innerHTML = `
        <div class="ql-calc-result-box">
          <div class="ql-calc-result-header">
            <div>
              <span class="ql-calc-result-label">${t('calc.molarMass')}:</span>
              <div class="ql-calc-result-val">
                ${fmtLabNumber(res.mw, 2)} <span class="ql-calc-result-unit">g/mol</span>
                <span class="ql-calc-secondary-val">(${fmtLabNumber(mwKDa, 2)} kDa)</span>
              </div>
              <div class="ql-field-help" style="margin-top:4px;">${res.formulaStr}</div>
            </div>
            <button type="button" class="ql-btn ql-btn-secondary ql-calc-bridge-btn" id="ql-calc-use-na-mw-btn">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14m-7-7 7 7-7 7"/></svg>
              ${t('calc.useInMolarity')}
            </button>
          </div>
        </div>
      `;

      const useBtn = naResult.querySelector('#ql-calc-use-na-mw-btn');
      if (useBtn) {
        useBtn.addEventListener('click', () => {
          s.molarity.mw = String(res.mw);
          if (s.molarity.lastAuto === 'mw') s.molarity.lastAuto = null;
          s.tab = 'molarity';
          saveState(s);
          paint();
        });
      }
    }

    naTypeSelect.addEventListener('change', updateNA);
    naLenInput.addEventListener('input', updateNA);
    updateNA();
  }

  // --------------------------------------------------------------------------
  // SUB-PESTAÑA 2: CALCULADORA DE MOLARIDAD (m = C × V × MW)
  // --------------------------------------------------------------------------
  function paintMolarity(parent) {
    const card = document.createElement('section');
    card.className = 'ql-card ql-panel';
    card.innerHTML = `
      <div class="ql-calc-header-row">
        <div>
          <h2>${t('calc.molTitle')}</h2>
          <p class="ql-panel-note">${t('calc.molDesc')}</p>
        </div>
        <button type="button" id="ql-calc-mol-clear" class="ql-btn ql-btn-subtle ql-btn-sm">${t('calc.clearBtn')}</button>
      </div>

      <div class="ql-calc-params-grid" style="margin-top:18px;">
        <!-- Masa -->
        <div class="ql-calc-param-box" id="ql-param-mass-box">
          <div class="ql-calc-param-header">
            <label class="ql-calc-label" for="ql-mol-mass">${t('calc.mass')}</label>
            <span class="ql-calc-auto-badge is-hidden" id="ql-badge-mass">${t('calc.solvedBadge')}</span>
          </div>
          <div class="ql-calc-unit-group">
            <input type="number" id="ql-mol-mass" step="any" min="0" value="${s.molarity.mass || ''}"
                   placeholder="Ej. 2.92" class="ql-calc-number-input" />
            <select id="ql-mol-mass-unit" class="ql-calc-unit-select">
              <option value="g" ${s.molarity.massUnit === 'g' ? 'selected' : ''}>g</option>
              <option value="mg" ${s.molarity.massUnit === 'mg' ? 'selected' : ''}>mg</option>
              <option value="µg" ${s.molarity.massUnit === 'µg' ? 'selected' : ''}>µg</option>
              <option value="ng" ${s.molarity.massUnit === 'ng' ? 'selected' : ''}>ng</option>
            </select>
          </div>
        </div>

        <!-- Volumen -->
        <div class="ql-calc-param-box" id="ql-param-vol-box">
          <div class="ql-calc-param-header">
            <label class="ql-calc-label" for="ql-mol-vol">${t('calc.volume')}</label>
            <span class="ql-calc-auto-badge is-hidden" id="ql-badge-vol">${t('calc.solvedBadge')}</span>
          </div>
          <div class="ql-calc-unit-group">
            <input type="number" id="ql-mol-vol" step="any" min="0" value="${s.molarity.vol || ''}"
                   placeholder="Ej. 500" class="ql-calc-number-input" />
            <select id="ql-mol-vol-unit" class="ql-calc-unit-select">
              <option value="L" ${s.molarity.volUnit === 'L' ? 'selected' : ''}>L</option>
              <option value="mL" ${s.molarity.volUnit === 'mL' ? 'selected' : ''}>mL</option>
              <option value="µL" ${s.molarity.volUnit === 'µL' ? 'selected' : ''}>µL</option>
            </select>
          </div>
        </div>

        <!-- Concentración -->
        <div class="ql-calc-param-box" id="ql-param-conc-box">
          <div class="ql-calc-param-header">
            <label class="ql-calc-label" for="ql-mol-conc">${t('calc.concentration')}</label>
            <span class="ql-calc-auto-badge is-hidden" id="ql-badge-conc">${t('calc.solvedBadge')}</span>
          </div>
          <div class="ql-calc-unit-group">
            <input type="number" id="ql-mol-conc" step="any" min="0" value="${s.molarity.conc || ''}"
                   placeholder="Ej. 0.1" class="ql-calc-number-input" />
            <select id="ql-mol-conc-unit" class="ql-calc-unit-select">
              <option value="M" ${s.molarity.concUnit === 'M' ? 'selected' : ''}>M</option>
              <option value="mM" ${s.molarity.concUnit === 'mM' ? 'selected' : ''}>mM</option>
              <option value="µM" ${s.molarity.concUnit === 'µM' ? 'selected' : ''}>µM</option>
              <option value="nM" ${s.molarity.concUnit === 'nM' ? 'selected' : ''}>nM</option>
              <option value="pM" ${s.molarity.concUnit === 'pM' ? 'selected' : ''}>pM</option>
            </select>
          </div>
        </div>

        <!-- Peso Molecular -->
        <div class="ql-calc-param-box" id="ql-param-mw-box">
          <div class="ql-calc-param-header">
            <label class="ql-calc-label" for="ql-mol-mw">${t('calc.mw')}</label>
            <span class="ql-calc-auto-badge is-hidden" id="ql-badge-mw">${t('calc.solvedBadge')}</span>
          </div>
          <div class="ql-calc-unit-group">
            <input type="number" id="ql-mol-mw" step="any" min="0" value="${s.molarity.mw || ''}"
                   placeholder="Ej. 58.44" class="ql-calc-number-input" />
            <span class="ql-calc-unit-badge">g/mol</span>
          </div>
        </div>
      </div>

      <!-- Resumen y fórmula explicativa -->
      <div id="ql-mol-summary" class="ql-calc-math-summary" style="margin-top:20px;"></div>
    `;

    parent.appendChild(card);

    const inputMass = card.querySelector('#ql-mol-mass');
    const selectMassUnit = card.querySelector('#ql-mol-mass-unit');
    const badgeMass = card.querySelector('#ql-badge-mass');
    const boxMass = card.querySelector('#ql-param-mass-box');

    const inputVol = card.querySelector('#ql-mol-vol');
    const selectVolUnit = card.querySelector('#ql-mol-vol-unit');
    const badgeVol = card.querySelector('#ql-badge-vol');
    const boxVol = card.querySelector('#ql-param-vol-box');

    const inputConc = card.querySelector('#ql-mol-conc');
    const selectConcUnit = card.querySelector('#ql-mol-conc-unit');
    const badgeConc = card.querySelector('#ql-badge-conc');
    const boxConc = card.querySelector('#ql-param-conc-box');

    const inputMW = card.querySelector('#ql-mol-mw');
    const badgeMW = card.querySelector('#ql-badge-mw');
    const boxMW = card.querySelector('#ql-param-mw-box');

    const summaryEl = card.querySelector('#ql-mol-summary');
    const clearBtn = card.querySelector('#ql-calc-mol-clear');

    const fields = {
      mass: { input: inputMass, unit: selectMassUnit, badge: badgeMass, box: boxMass },
      vol: { input: inputVol, unit: selectVolUnit, badge: badgeVol, box: boxVol },
      conc: { input: inputConc, unit: selectConcUnit, badge: badgeConc, box: boxConc },
      mw: { input: inputMW, unit: null, badge: badgeMW, box: boxMW },
    };

    function recalculate(userFieldChanged) {
      // Si el usuario tecleó en el campo que antes era auto-despejado, deja de serlo
      if (userFieldChanged && s.molarity.lastAuto === userFieldChanged) {
        s.molarity.lastAuto = null;
      }

      const currentVals = {
        mass: inputMass.value.trim(),
        massUnit: selectMassUnit.value,
        vol: inputVol.value.trim(),
        volUnit: selectVolUnit.value,
        conc: inputConc.value.trim(),
        concUnit: selectConcUnit.value,
        mw: inputMW.value.trim(),
      };

      // Si hay 4 campos con valor pero uno es lastAuto, omitimos ese para recalcularlo
      const targetParams = { ...currentVals };
      if (s.molarity.lastAuto && targetParams[s.molarity.lastAuto]) {
        targetParams[s.molarity.lastAuto] = '';
      }

      const res = solveMolarity(targetParams);

      // Limpiar insignias de todos
      Object.keys(fields).forEach((k) => {
        fields[k].badge.classList.add('is-hidden');
        fields[k].box.classList.remove('is-solved');
      });

      if (res && res.ok && res.solved) {
        s.molarity.lastAuto = res.solved;
        const target = fields[res.solved];
        const formattedVal = fmtLabNumber(res.value, 4);
        target.input.value = formattedVal;
        target.badge.classList.remove('is-hidden');
        target.box.classList.add('is-solved');

        // Sincronizar en estado
        s.molarity[res.solved] = formattedVal;

        summaryEl.innerHTML = `
          <div class="ql-calc-callout">
            <div class="ql-calc-callout-title">${t('calc.formulaExpl')}</div>
            <div class="ql-calc-callout-desc">
              Despeje: <strong>${res.formulaDesc}</strong> &rarr;
              Resultado: <strong>${formattedVal} ${res.unit}</strong>
            </div>
          </div>
        `;
      } else {
        summaryEl.innerHTML = `
          <div class="ql-calc-callout-idle">
            ${t('calc.molDesc')}
          </div>
        `;
      }

      // Guardar entradas de usuario
      s.molarity.mass = inputMass.value;
      s.molarity.massUnit = selectMassUnit.value;
      s.molarity.vol = inputVol.value;
      s.molarity.volUnit = selectVolUnit.value;
      s.molarity.conc = inputConc.value;
      s.molarity.concUnit = selectConcUnit.value;
      s.molarity.mw = inputMW.value;
      saveState(s);
    }

    // Listeners
    ['mass', 'vol', 'conc', 'mw'].forEach((k) => {
      fields[k].input.addEventListener('input', () => recalculate(k));
      if (fields[k].unit) {
        fields[k].unit.addEventListener('change', () => recalculate(k));
      }
    });

    clearBtn.addEventListener('click', () => {
      s.molarity.mass = '';
      s.molarity.vol = '';
      s.molarity.conc = '';
      s.molarity.mw = '';
      s.molarity.lastAuto = null;
      inputMass.value = '';
      inputVol.value = '';
      inputConc.value = '';
      inputMW.value = '';
      recalculate(null);
    });

    // Ejecución inicial
    recalculate(null);
  }

  // --------------------------------------------------------------------------
  // SUB-PESTAÑA 3: CALCULADORA DE DILUCIONES (C1 × V1 = C2 × V2)
  // --------------------------------------------------------------------------
  function paintDilutions(parent) {
    const card = document.createElement('section');
    card.className = 'ql-card ql-panel';
    card.innerHTML = `
      <div class="ql-calc-header-row">
        <div>
          <h2>${t('calc.dilTitle')}</h2>
          <p class="ql-panel-note">${t('calc.dilDesc')}</p>
        </div>
        <button type="button" id="ql-calc-dil-clear" class="ql-btn ql-btn-subtle ql-btn-sm">${t('calc.clearBtn')}</button>
      </div>

      <div class="ql-calc-params-grid" style="margin-top:18px;">
        <!-- C1 (Stock) -->
        <div class="ql-calc-param-box" id="ql-param-c1-box">
          <div class="ql-calc-param-header">
            <label class="ql-calc-label" for="ql-dil-c1">${t('calc.c1')}</label>
            <span class="ql-calc-auto-badge is-hidden" id="ql-badge-c1">${t('calc.solvedBadge')}</span>
          </div>
          <div class="ql-calc-unit-group">
            <input type="number" id="ql-dil-c1" step="any" min="0" value="${s.dilution.c1 || ''}"
                   placeholder="Ej. 10" class="ql-calc-number-input" />
            <select id="ql-dil-c1-unit" class="ql-calc-unit-select">
              <option value="X" ${s.dilution.c1Unit === 'X' ? 'selected' : ''}>X</option>
              <option value="M" ${s.dilution.c1Unit === 'M' ? 'selected' : ''}>M</option>
              <option value="mM" ${s.dilution.c1Unit === 'mM' ? 'selected' : ''}>mM</option>
              <option value="µM" ${s.dilution.c1Unit === 'µM' ? 'selected' : ''}>µM</option>
              <option value="nM" ${s.dilution.c1Unit === 'nM' ? 'selected' : ''}>nM</option>
              <option value="%" ${s.dilution.c1Unit === '%' ? 'selected' : ''}>%</option>
              <option value="mg/mL" ${s.dilution.c1Unit === 'mg/mL' ? 'selected' : ''}>mg/mL</option>
              <option value="µg/mL" ${s.dilution.c1Unit === 'µg/mL' ? 'selected' : ''}>µg/mL</option>
            </select>
          </div>
        </div>

        <!-- V1 (Volumen Stock) -->
        <div class="ql-calc-param-box" id="ql-param-v1-box">
          <div class="ql-calc-param-header">
            <label class="ql-calc-label" for="ql-dil-v1">${t('calc.v1')}</label>
            <span class="ql-calc-auto-badge is-hidden" id="ql-badge-v1">${t('calc.solvedBadge')}</span>
          </div>
          <div class="ql-calc-unit-group">
            <input type="number" id="ql-dil-v1" step="any" min="0" value="${s.dilution.v1 || ''}"
                   placeholder="Ej. 10" class="ql-calc-number-input" />
            <select id="ql-dil-v1-unit" class="ql-calc-unit-select">
              <option value="mL" ${s.dilution.v1Unit === 'mL' ? 'selected' : ''}>mL</option>
              <option value="µL" ${s.dilution.v1Unit === 'µL' ? 'selected' : ''}>µL</option>
              <option value="L" ${s.dilution.v1Unit === 'L' ? 'selected' : ''}>L</option>
            </select>
          </div>
        </div>

        <!-- C2 (Final) -->
        <div class="ql-calc-param-box" id="ql-param-c2-box">
          <div class="ql-calc-param-header">
            <label class="ql-calc-label" for="ql-dil-c2">${t('calc.c2')}</label>
            <span class="ql-calc-auto-badge is-hidden" id="ql-badge-c2">${t('calc.solvedBadge')}</span>
          </div>
          <div class="ql-calc-unit-group">
            <input type="number" id="ql-dil-c2" step="any" min="0" value="${s.dilution.c2 || ''}"
                   placeholder="Ej. 1" class="ql-calc-number-input" />
            <select id="ql-dil-c2-unit" class="ql-calc-unit-select">
              <option value="X" ${s.dilution.c2Unit === 'X' ? 'selected' : ''}>X</option>
              <option value="M" ${s.dilution.c2Unit === 'M' ? 'selected' : ''}>M</option>
              <option value="mM" ${s.dilution.c2Unit === 'mM' ? 'selected' : ''}>mM</option>
              <option value="µM" ${s.dilution.c2Unit === 'µM' ? 'selected' : ''}>µM</option>
              <option value="nM" ${s.dilution.c2Unit === 'nM' ? 'selected' : ''}>nM</option>
              <option value="%" ${s.dilution.c2Unit === '%' ? 'selected' : ''}>%</option>
              <option value="mg/mL" ${s.dilution.c2Unit === 'mg/mL' ? 'selected' : ''}>mg/mL</option>
              <option value="µg/mL" ${s.dilution.c2Unit === 'µg/mL' ? 'selected' : ''}>µg/mL</option>
            </select>
          </div>
        </div>

        <!-- V2 (Volumen Final) -->
        <div class="ql-calc-param-box" id="ql-param-v2-box">
          <div class="ql-calc-param-header">
            <label class="ql-calc-label" for="ql-dil-v2">${t('calc.v2')}</label>
            <span class="ql-calc-auto-badge is-hidden" id="ql-badge-v2">${t('calc.solvedBadge')}</span>
          </div>
          <div class="ql-calc-unit-group">
            <input type="number" id="ql-dil-v2" step="any" min="0" value="${s.dilution.v2 || ''}"
                   placeholder="Ej. 100" class="ql-calc-number-input" />
            <select id="ql-dil-v2-unit" class="ql-calc-unit-select">
              <option value="mL" ${s.dilution.v2Unit === 'mL' ? 'selected' : ''}>mL</option>
              <option value="µL" ${s.dilution.v2Unit === 'µL' ? 'selected' : ''}>µL</option>
              <option value="L" ${s.dilution.v2Unit === 'L' ? 'selected' : ''}>L</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Resumen de instrucción de preparación y advertencias -->
      <div id="ql-dil-summary" class="ql-calc-math-summary" style="margin-top:20px;"></div>
    `;

    parent.appendChild(card);

    const inputC1 = card.querySelector('#ql-dil-c1');
    const selectC1Unit = card.querySelector('#ql-dil-c1-unit');
    const badgeC1 = card.querySelector('#ql-badge-c1');
    const boxC1 = card.querySelector('#ql-param-c1-box');

    const inputV1 = card.querySelector('#ql-dil-v1');
    const selectV1Unit = card.querySelector('#ql-dil-v1-unit');
    const badgeV1 = card.querySelector('#ql-badge-v1');
    const boxV1 = card.querySelector('#ql-param-v1-box');

    const inputC2 = card.querySelector('#ql-dil-c2');
    const selectC2Unit = card.querySelector('#ql-dil-c2-unit');
    const badgeC2 = card.querySelector('#ql-badge-c2');
    const boxC2 = card.querySelector('#ql-param-c2-box');

    const inputV2 = card.querySelector('#ql-dil-v2');
    const selectV2Unit = card.querySelector('#ql-dil-v2-unit');
    const badgeV2 = card.querySelector('#ql-badge-v2');
    const boxV2 = card.querySelector('#ql-param-v2-box');

    const summaryEl = card.querySelector('#ql-dil-summary');
    const clearBtn = card.querySelector('#ql-calc-dil-clear');

    const fields = {
      c1: { input: inputC1, unit: selectC1Unit, badge: badgeC1, box: boxC1 },
      v1: { input: inputV1, unit: selectV1Unit, badge: badgeV1, box: boxV1 },
      c2: { input: inputC2, unit: selectC2Unit, badge: badgeC2, box: boxC2 },
      v2: { input: inputV2, unit: selectV2Unit, badge: badgeV2, box: boxV2 },
    };

    function recalculateDilution(userFieldChanged) {
      if (userFieldChanged && s.dilution.lastAuto === userFieldChanged) {
        s.dilution.lastAuto = null;
      }

      const currentVals = {
        c1: inputC1.value.trim(),
        c1Unit: selectC1Unit.value,
        v1: inputV1.value.trim(),
        v1Unit: selectV1Unit.value,
        c2: inputC2.value.trim(),
        c2Unit: selectC2Unit.value,
        v2: inputV2.value.trim(),
        v2Unit: selectV2Unit.value,
      };

      const targetParams = { ...currentVals };
      if (s.dilution.lastAuto && targetParams[s.dilution.lastAuto]) {
        targetParams[s.dilution.lastAuto] = '';
      }

      const res = solveDilution(targetParams);

      Object.keys(fields).forEach((k) => {
        fields[k].badge.classList.add('is-hidden');
        fields[k].box.classList.remove('is-solved');
      });

      if (res && res.ok && res.solved) {
        s.dilution.lastAuto = res.solved;
        const target = fields[res.solved];
        const formattedVal = fmtLabNumber(res.value, 4);
        target.input.value = formattedVal;
        target.badge.classList.remove('is-hidden');
        target.box.classList.add('is-solved');

        s.dilution[res.solved] = formattedVal;

        if (!res.isValidDilution) {
          summaryEl.innerHTML = `
            <div class="ql-calc-alert ql-calc-alert-error">
              <strong>Error de dilución:</strong> ${t('calc.dilError')}
            </div>
          `;
        } else {
          const v1Fmt = `${fmtLabNumber(res.v1Val, 4)} ${res.v1Unit}`;
          const v2Fmt = `${fmtLabNumber(res.v2Val, 4)} ${res.v2Unit}`;
          const vDilFmt = `${fmtLabNumber(res.vDilInV2Unit, 4)} ${res.v2Unit}`;

          const tipText = t('calc.dilTip', {
            v1: v1Fmt,
            vDil: vDilFmt,
            v2: v2Fmt,
          });

          summaryEl.innerHTML = `
            <div class="ql-calc-callout">
              <div class="ql-calc-callout-title">${t('calc.dilInstruction')}</div>
              <div class="ql-calc-callout-desc">${tipText}</div>
              <div class="ql-calc-secondary-meta" style="margin-top:8px;">
                <span>${t('calc.diluentVol')}: <strong>${vDilFmt}</strong></span>
              </div>
            </div>
          `;
        }
      } else {
        summaryEl.innerHTML = `
          <div class="ql-calc-callout-idle">
            ${t('calc.dilDesc')}
          </div>
        `;
      }

      s.dilution.c1 = inputC1.value;
      s.dilution.c1Unit = selectC1Unit.value;
      s.dilution.v1 = inputV1.value;
      s.dilution.v1Unit = selectV1Unit.value;
      s.dilution.c2 = inputC2.value;
      s.dilution.c2Unit = selectC2Unit.value;
      s.dilution.v2 = inputV2.value;
      s.dilution.v2Unit = selectV2Unit.value;
      saveState(s);
    }

    ['c1', 'v1', 'c2', 'v2'].forEach((k) => {
      fields[k].input.addEventListener('input', () => recalculateDilution(k));
      fields[k].unit.addEventListener('change', () => recalculateDilution(k));
    });

    clearBtn.addEventListener('click', () => {
      s.dilution.c1 = '';
      s.dilution.v1 = '';
      s.dilution.c2 = '';
      s.dilution.v2 = '';
      s.dilution.lastAuto = null;
      inputC1.value = '';
      inputV1.value = '';
      inputC2.value = '';
      inputV2.value = '';
      recalculateDilution(null);
    });

    recalculateDilution(null);
  }

  // --------------------------------------------------------------------------
  // SUB-PESTAÑA 4: CALCULADORA DE MASTER MIX PARA PCR
  // Dos modos: A) Master Mix comercial (2X/5X/10X, por defecto) — B) por
  // componentes (receta reactivo a reactivo, el modelo original).
  // --------------------------------------------------------------------------
  function paintMasterMix(parent) {
    const modeBar = document.createElement('div');
    modeBar.className = 'ql-segmented';
    modeBar.style.marginBottom = '18px';
    [
      ['commercial', t('calc.mmModeCommercial')],
      ['components', t('calc.mmModeComponents')],
      ['qpcr', t('calc.mmModeQpcr')],
    ].forEach(([m, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-seg-btn' + (s.masterMix.mode === m ? ' is-on' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        if (s.masterMix.mode !== m) {
          s.masterMix.mode = m;
          saveState(s);
          paint();
        }
      });
      modeBar.appendChild(b);
    });
    parent.appendChild(modeBar);

    if (s.masterMix.mode === 'components') {
      paintMasterMixComponents(parent);
    } else if (s.masterMix.mode === 'qpcr') {
      paintQpcrSetup(parent);
      paintMasterMixCommercial(parent, { variant: 'qpcr' });
    } else {
      paintMasterMixCommercial(parent);
    }
  }

  // qPCR: química (SYBR / sonda), sonda y recuento de reacciones de la placa.
  // La tabla de la mezcla la pinta paintMasterMixCommercial({variant:'qpcr'}).
  function paintQpcrSetup(parent) {
    const q = s.masterMix.qpcr;
    const card = document.createElement('section');
    card.className = 'ql-card ql-panel ql-qpcr-setup';
    card.style.marginBottom = '18px';
    const total = qpcrReactionCount(q.plate);
    const num = (id, label, val, extra = '') => `
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="${id}">${label}</label>
          <input type="number" id="${id}" min="0" step="1" value="${val}" class="ql-calc-number-input" style="width:110px;" ${extra} />
        </div>`;
    card.innerHTML = `
      <h2>${t('calc.qpcrTitle')}</h2>
      <p class="ql-panel-note">${t('calc.qpcrDesc')}</p>
      <div class="ql-segmented" role="group" aria-label="${escapeHtml(t('calc.qpcrChemLabel'))}" style="margin:6px 0 14px;">
        <button type="button" class="ql-seg-btn${q.chem === 'sybr' ? ' is-on' : ''}" data-chem="sybr">${t('calc.qpcrChemSybr')}</button>
        <button type="button" class="ql-seg-btn${q.chem === 'probe' ? ' is-on' : ''}" data-chem="probe">${t('calc.qpcrChemProbe')}</button>
      </div>
      ${q.chem === 'probe' ? `<div class="ql-calc-controls-bar">
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="ql-qpcr-probe-stock">${t('calc.qpcrProbeStock')}</label>
          <div class="ql-calc-unit-group" style="width:120px;"><input type="number" id="ql-qpcr-probe-stock" min="0" step="any" value="${q.probeStock}" class="ql-calc-number-input" /><span class="ql-calc-unit-badge">µM</span></div>
        </div>
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="ql-qpcr-probe-final">${t('calc.qpcrProbeFinal')}</label>
          <div class="ql-calc-unit-group" style="width:120px;"><input type="number" id="ql-qpcr-probe-final" min="0" step="any" value="${q.probeFinal}" class="ql-calc-number-input" /><span class="ql-calc-unit-badge">µM</span></div>
        </div>
      </div>` : ''}
      <h3 class="ql-calc-subtitle" style="margin:14px 0 6px;font-size:13px;">${t('calc.qpcrPlateTitle')}</h3>
      <div class="ql-calc-controls-bar">
        ${num('ql-qpcr-samples', t('calc.qpcrSamples'), q.plate.samples)}
        ${num('ql-qpcr-standards', t('calc.qpcrStandards'), q.plate.standards)}
        ${num('ql-qpcr-ntc', t('calc.qpcrNtc'), q.plate.ntc)}
        ${num('ql-qpcr-reps', t('calc.qpcrReplicates'), q.plate.replicates, 'min="1"')}
      </div>
      <p class="ql-field-help" id="ql-qpcr-total">${t('calc.qpcrTotal', { n: total })}</p>
      <button type="button" id="ql-qpcr-use" class="ql-btn ql-btn-sm">${t('calc.qpcrUseTotal', { n: total })}</button>
      ${moreDetailsHtml(t('ui.moreDetails'), t('calc.qpcrHelp'))}`;
    parent.appendChild(card);

    card.querySelectorAll('[data-chem]').forEach((b) => b.addEventListener('click', () => {
      const chem = b.getAttribute('data-chem');
      if (chem === q.chem) return;
      // cambiar de química recoloca las concentraciones de cebador a las de
      // partida de esa química (el resto de lo escrito se conserva)
      q.chem = chem;
      q.primerFinal = QPCR_PRIMER_FINAL_UM[chem];
      saveState(s); paint();
    }));
    const probeStock = card.querySelector('#ql-qpcr-probe-stock');
    const probeFinal = card.querySelector('#ql-qpcr-probe-final');
    [probeStock, probeFinal].forEach((el) => el && el.addEventListener('change', () => {
      q.probeStock = Math.max(0, parseFloat(probeStock.value) || 0);
      q.probeFinal = Math.max(0, parseFloat(probeFinal.value) || 0);
      saveState(s); paint();
    }));
    const plateIds = { samples: '#ql-qpcr-samples', standards: '#ql-qpcr-standards', ntc: '#ql-qpcr-ntc', replicates: '#ql-qpcr-reps' };
    const totalP = card.querySelector('#ql-qpcr-total');
    const useBtn = card.querySelector('#ql-qpcr-use');
    Object.entries(plateIds).forEach(([k, sel]) => card.querySelector(sel).addEventListener('input', (e) => {
      q.plate[k] = Math.max(k === 'replicates' ? 1 : 0, parseInt(e.target.value, 10) || 0);
      const n = qpcrReactionCount(q.plate);
      totalP.textContent = t('calc.qpcrTotal', { n });
      useBtn.textContent = t('calc.qpcrUseTotal', { n });
      saveState(s);
    }));
    useBtn.addEventListener('click', () => {
      s.masterMix.numReactions = Math.max(1, qpcrReactionCount(q.plate));
      saveState(s); paint();
    });
  }

  function paintMasterMixComponents(parent) {
    const card = document.createElement('section');
    card.className = 'ql-card ql-panel';

    card.innerHTML = `
      <div class="ql-calc-header-row">
        <div>
          <h2>${t('calc.mmTitle')}</h2>
          <p class="ql-panel-note">${t('calc.mmDesc')}</p>
        </div>
        <button type="button" id="ql-calc-mm-reset" class="ql-btn ql-btn-subtle ql-btn-sm">${t('calc.mmReset')}</button>
      </div>

      <div class="ql-calc-controls-bar" style="margin-top:18px;">
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="ql-mm-rxns">${t('calc.mmReactions')}</label>
          <input type="number" id="ql-mm-rxns" min="1" step="1" value="${s.masterMix.numReactions}" class="ql-calc-number-input" style="width:130px;" />
        </div>
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="ql-mm-excess">${t('calc.mmExcess')}</label>
          <div class="ql-calc-unit-group" style="width:130px;">
            <input type="number" id="ql-mm-excess" min="0" max="100" step="1" value="${s.masterMix.excessPct}" class="ql-calc-number-input" />
            <span class="ql-calc-unit-badge">%</span>
          </div>
        </div>
        <div id="ql-mm-effective-badge" class="ql-calc-control-hint"></div>
      </div>

      <!-- Panel de Concentración de Molde y Auto-Balance de Agua -->
      <div class="ql-calc-controls-bar" style="margin-top:12px;">
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="ql-mm-dna-conc">${t('calc.mmDnaConc')}</label>
          <div class="ql-calc-unit-group" style="width:160px;">
            <input type="number" id="ql-mm-dna-conc" min="0" step="any" value="${s.masterMix.dnaConc || ''}"
                   placeholder="Ej. 10" class="ql-calc-number-input" />
            <span class="ql-calc-unit-badge">ng/µL</span>
          </div>
        </div>
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="ql-mm-dna-mass">${t('calc.mmDnaTargetMass')}</label>
          <div class="ql-calc-unit-group" style="width:160px;">
            <input type="number" id="ql-mm-dna-mass" min="0" step="any" value="${s.masterMix.dnaTargetMass != null ? s.masterMix.dnaTargetMass : 30}"
                   placeholder="30" class="ql-calc-number-input" />
            <span class="ql-calc-unit-badge">ng</span>
          </div>
        </div>
        <div id="ql-mm-dna-feedback" class="ql-calc-control-hint"></div>
      </div>

      <div class="ql-stats" id="ql-mm-stats" style="margin-top:16px;">
        <div class="ql-stat">
          <div class="ql-stat-label">${t('calc.mmTotalPerRxn')}</div>
          <div class="ql-stat-value" id="ql-mm-stat-per-rxn">—</div>
        </div>
        <div class="ql-stat" style="border-color:var(--accent);">
          <div class="ql-stat-label" style="color:var(--accent);">${t('calc.mmTotalMasterMix')}</div>
          <div class="ql-stat-value" id="ql-mm-stat-total-mm" style="color:var(--accent);">—</div>
        </div>
        <div class="ql-stat">
          <div class="ql-stat-label">${t('calc.mmPipettePerWell')}</div>
          <div class="ql-stat-value" id="ql-mm-stat-pipette">—</div>
        </div>
        <div class="ql-stat">
          <div class="ql-stat-label">${t('calc.mmTemplatePerWell')}</div>
          <div class="ql-stat-value" id="ql-mm-stat-template">—</div>
        </div>
      </div>

      <div class="ql-calc-table-wrap" style="margin-top:20px;">
        <table class="ql-calc-table" id="ql-mm-table">
          <thead>
            <tr>
              <th style="min-width:180px;">${t('calc.mmReagentCol')}</th>
              <th style="width:140px; text-align:right;">${t('calc.mmUnitVolCol')}</th>
              <th style="width:130px; text-align:center;">${t('calc.mmInMixCol')}</th>
              <th style="width:160px; text-align:right;">${t('calc.mmTotalVolCol')}</th>
              <th style="width:60px; text-align:center;">${t('calc.mmActionsCol')}</th>
            </tr>
          </thead>
          <tbody id="ql-mm-tbody"></tbody>
        </table>
      </div>

      <div style="margin-top:14px; display:flex; justify-content:flex-start;">
        <button type="button" id="ql-mm-add-btn" class="ql-btn ql-btn-secondary ql-btn-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;"><path d="M12 5v14M5 12h14"/></svg>
          ${t('calc.mmAddReagent')}
        </button>
      </div>
    `;

    parent.appendChild(card);

    const inputRxns = card.querySelector('#ql-mm-rxns');
    const inputExcess = card.querySelector('#ql-mm-excess');
    const inputDnaConc = card.querySelector('#ql-mm-dna-conc');
    const inputDnaMass = card.querySelector('#ql-mm-dna-mass');
    const dnaFeedback = card.querySelector('#ql-mm-dna-feedback');
    const badgeEffective = card.querySelector('#ql-mm-effective-badge');
    const resetBtn = card.querySelector('#ql-calc-mm-reset');
    const addBtn = card.querySelector('#ql-mm-add-btn');
    const tbody = card.querySelector('#ql-mm-tbody');

    const statPerRxn = card.querySelector('#ql-mm-stat-per-rxn');
    const statTotalMM = card.querySelector('#ql-mm-stat-total-mm');
    const statPipette = card.querySelector('#ql-mm-stat-pipette');
    const statTemplate = card.querySelector('#ql-mm-stat-template');

    function updateStatsAndCalculations() {
      const rxnsVal = Math.max(1, parseInt(inputRxns.value, 10) || 1);
      const excessVal = Math.max(0, parseFloat(inputExcess.value) || 0);
      s.masterMix.numReactions = rxnsVal;
      s.masterMix.excessPct = excessVal;

      const calcRes = calculateMasterMix(s.masterMix.reagents, rxnsVal, excessVal);

      // Badge informativa de reacciones efectivas
      badgeEffective.innerHTML = `Factor pipeteo: <strong>${calcRes.numReactions}</strong> + ${calcRes.excessPct}% = <strong>${fmtLabNumber(calcRes.effectiveReactions, 2)}</strong> rxns`;

      // Tarjetas de estadísticas
      statPerRxn.textContent = `${fmtLabNumber(calcRes.totalPerRxn, 2)} µL`;
      statTotalMM.textContent = `${fmtLabNumber(calcRes.totalMasterMix, 2)} µL`;
      statPipette.textContent = `${fmtLabNumber(calcRes.pipettePerWell, 2)} µL`;
      statTemplate.textContent = `${fmtLabNumber(calcRes.templatePerWell, 2)} µL`;

      // Actualizar los volúmenes totales en las filas existentes
      calcRes.reagents.forEach((r) => {
        const totalCell = tbody.querySelector(`.ql-mm-total-cell[data-id="${r.id}"]`);
        if (totalCell) {
          if (r.inMix) {
            totalCell.innerHTML = `<strong style="font-family:var(--font-mono); color:var(--accent);">${fmtLabNumber(r.totalVol, 2)} µL</strong>`;
          } else {
            totalCell.innerHTML = `<span class="ql-ink-muted" style="font-size:12px;">— (${t('calc.mmTemplatePerWell')})</span>`;
          }
        }
      });

      saveState(s);
    }

    function handleDnaInputChange() {
      const concRaw = inputDnaConc.value.trim();
      const massRaw = inputDnaMass.value.trim();
      s.masterMix.dnaConc = concRaw;
      s.masterMix.dnaTargetMass = massRaw === '' ? 30 : (parseFloat(massRaw) || 0);

      const concVal = parseFloat(concRaw);
      const massVal = parseFloat(massRaw);

      if (Number.isFinite(concVal) && concVal > 0 && Number.isFinite(massVal) && massVal > 0) {
        const dnaVol = calcDnaTemplateVolume(massVal, concVal);
        if (dnaVol !== null) {
          s.masterMix.reagents = autoBalanceDnaWater(s.masterMix.reagents, dnaVol, 'template', 'h2o');

          const templateRowInput = tbody.querySelector(`.ql-mm-input-vol[data-id="template"]`);
          if (templateRowInput) {
            templateRowInput.value = dnaVol;
          }
          const waterRowInput = tbody.querySelector(`.ql-mm-input-vol[data-id="h2o"]`);
          const waterItem = s.masterMix.reagents.find((r) => r.id === 'h2o');
          if (waterRowInput && waterItem) {
            waterRowInput.value = waterItem.unitVol;
          }

          updateStatsAndCalculations();

          const currentTotal = s.masterMix.reagents.reduce((acc, r) => acc + (parseFloat(r.unitVol) || 0), 0);
          if (waterItem && waterItem.unitVol === 0 && dnaVol > 19.8) {
            dnaFeedback.innerHTML = `<span style="color:var(--critical); font-weight:600;">${t('calc.mmDnaOverflow', { dnaVol: fmtLabNumber(dnaVol, 2) })}</span>`;
          } else {
            dnaFeedback.innerHTML = t('calc.mmDnaTip', {
              dnaVol: fmtLabNumber(dnaVol, 2),
              waterVol: fmtLabNumber(waterItem ? waterItem.unitVol : 0, 2),
              totalVol: fmtLabNumber(currentTotal, 2),
            });
          }
          saveState(s);
          return;
        }
      }
      dnaFeedback.innerHTML = '';
      saveState(s);
    }

    function renderTableRows() {
      const calcRes = calculateMasterMix(s.masterMix.reagents, s.masterMix.numReactions, s.masterMix.excessPct);
      const canDelete = s.masterMix.reagents.length > 1;

      tbody.innerHTML = calcRes.reagents.map((r) => `
        <tr data-id="${escapeHtml(r.id)}">
          <td>
            <input type="text" class="ql-mm-input-name" data-id="${escapeHtml(r.id)}" value="${escapeHtml(r.name)}" placeholder="${t('calc.mmReagentCol')}" />
          </td>
          <td style="text-align:right;">
            <div class="ql-calc-unit-group" style="width:100%;">
              <input type="number" min="0" step="any" class="ql-mm-input-vol" data-id="${escapeHtml(r.id)}" value="${r.unitVol}" style="text-align:right;" />
              <span class="ql-calc-unit-badge">µL</span>
            </div>
          </td>
          <td style="text-align:center;">
            <input type="checkbox" class="ql-mm-input-inmix" data-id="${escapeHtml(r.id)}" ${r.inMix ? 'checked' : ''} aria-label="${t('calc.mmInMixCol')}" />
          </td>
          <td style="text-align:right;" class="ql-mm-total-cell" data-id="${escapeHtml(r.id)}">
            ${r.inMix
              ? `<strong style="font-family:var(--font-mono); color:var(--accent);">${fmtLabNumber(r.totalVol, 2)} µL</strong>`
              : `<span class="ql-ink-muted" style="font-size:12px;">— (${t('calc.mmTemplatePerWell')})</span>`
            }
          </td>
          <td style="text-align:center;">
            <button type="button" class="ql-btn ql-btn-subtle ql-btn-sm ql-mm-btn-del" data-id="${escapeHtml(r.id)}" title="${t('calc.mmDelete')}" ${canDelete ? '' : 'disabled'}>
              &times;
            </button>
          </td>
        </tr>
      `).join('');

      updateStatsAndCalculations();

      if (s.masterMix.dnaConc && s.masterMix.dnaTargetMass) {
        const concVal = parseFloat(s.masterMix.dnaConc);
        const massVal = parseFloat(s.masterMix.dnaTargetMass);
        if (concVal > 0 && massVal > 0) {
          const dnaVol = calcDnaTemplateVolume(massVal, concVal);
          const waterItem = s.masterMix.reagents.find((r) => r.id === 'h2o');
          const currentTotal = s.masterMix.reagents.reduce((acc, r) => acc + (parseFloat(r.unitVol) || 0), 0);
          dnaFeedback.innerHTML = t('calc.mmDnaTip', {
            dnaVol: fmtLabNumber(dnaVol, 2),
            waterVol: fmtLabNumber(waterItem ? waterItem.unitVol : 0, 2),
            totalVol: fmtLabNumber(currentTotal, 2),
          });
        }
      }
    }

    // Escuchadores de eventos para controles globales
    inputRxns.addEventListener('input', updateStatsAndCalculations);
    inputExcess.addEventListener('input', updateStatsAndCalculations);
    inputDnaConc.addEventListener('input', handleDnaInputChange);
    inputDnaMass.addEventListener('input', handleDnaInputChange);

    // Delegación de eventos en el cuerpo de la tabla para rendimiento y sin pérdida de foco
    tbody.addEventListener('input', (e) => {
      const id = e.target.getAttribute('data-id');
      if (!id) return;
      const reagent = s.masterMix.reagents.find((r) => String(r.id) === id);
      if (!reagent) return;

      if (e.target.classList.contains('ql-mm-input-name')) {
        reagent.name = e.target.value;
        saveState(s);
      } else if (e.target.classList.contains('ql-mm-input-vol')) {
        const val = parseFloat(e.target.value);
        const safeVal = Number.isFinite(val) && val >= 0 ? val : 0;

        if (id === 'template') {
          s.masterMix.reagents = autoBalanceDnaWater(s.masterMix.reagents, safeVal, 'template', 'h2o');
          const waterRowInput = tbody.querySelector(`.ql-mm-input-vol[data-id="h2o"]`);
          const waterItem = s.masterMix.reagents.find((r) => r.id === 'h2o');
          if (waterRowInput && waterItem) {
            waterRowInput.value = waterItem.unitVol;
          }
          if (s.masterMix.dnaTargetMass && safeVal > 0) {
            const calculatedConc = Math.round((s.masterMix.dnaTargetMass / safeVal) * 1000) / 1000;
            s.masterMix.dnaConc = String(calculatedConc);
            inputDnaConc.value = s.masterMix.dnaConc;
          }
          const currentTotal = s.masterMix.reagents.reduce((acc, r) => acc + (parseFloat(r.unitVol) || 0), 0);
          dnaFeedback.innerHTML = t('calc.mmDnaTip', {
            dnaVol: fmtLabNumber(safeVal, 2),
            waterVol: fmtLabNumber(waterItem ? waterItem.unitVol : 0, 2),
            totalVol: fmtLabNumber(currentTotal, 2),
          });
        } else {
          reagent.unitVol = safeVal;
        }
        updateStatsAndCalculations();
      }
    });

    tbody.addEventListener('change', (e) => {
      const id = e.target.getAttribute('data-id');
      if (!id) return;
      const reagent = s.masterMix.reagents.find((r) => String(r.id) === id);
      if (!reagent) return;

      if (e.target.classList.contains('ql-mm-input-inmix')) {
        reagent.inMix = Boolean(e.target.checked);
        updateStatsAndCalculations();
      }
    });

    tbody.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.ql-mm-btn-del');
      if (!delBtn || delBtn.disabled) return;
      const id = delBtn.getAttribute('data-id');
      if (!id) return;

      if (s.masterMix.reagents.length > 1) {
        s.masterMix.reagents = s.masterMix.reagents.filter((r) => String(r.id) !== id);
        saveState(s);
        renderTableRows();
      }
    });

    // Botón Añadir Reactivo
    addBtn.addEventListener('click', () => {
      const newId = 'reagent_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      s.masterMix.reagents.push({
        id: newId,
        name: t('calc.mmNewReagentName') || 'Nuevo Reactivo',
        unitVol: 1.0,
        inMix: true,
      });
      saveState(s);
      renderTableRows();
    });

    // Botón Restablecer (solo toca lo propio de este modo, no s.masterMix.commercial)
    resetBtn.addEventListener('click', () => {
      s.masterMix.numReactions = 10;
      s.masterMix.excessPct = 10;
      s.masterMix.dnaConc = '';
      s.masterMix.dnaTargetMass = 30;
      s.masterMix.reagents = getDefaultMasterMixReagents();
      inputRxns.value = s.masterMix.numReactions;
      inputExcess.value = s.masterMix.excessPct;
      inputDnaConc.value = '';
      inputDnaMass.value = 30;
      dnaFeedback.innerHTML = '';
      saveState(s);
      renderTableRows();
    });

    // Render inicial
    renderTableRows();
  }

  // --------------------------------------------------------------------------
  // SUB-PESTAÑA 4, MODO A: MASTER MIX COMERCIAL (2X/5X/10X)
  // --------------------------------------------------------------------------
  function paintMasterMixCommercial(parent, { variant = 'commercial' } = {}) {
    const isQpcr = variant === 'qpcr';
    const card = document.createElement('section');
    card.className = 'ql-card ql-panel';
    const cm = isQpcr ? s.masterMix.qpcr : s.masterMix.commercial;
    const recommendedPrimer = isQpcr ? QPCR_PRIMER_FINAL_UM[cm.chem] : RECOMMENDED_PRIMER_FINAL_UM;

    card.innerHTML = `
      <div class="ql-calc-header-row">
        <div>
          <h2>${t(isQpcr ? 'calc.qpcrMixTitle' : 'calc.mmTitle')}</h2>
          <p class="ql-panel-note">${t(isQpcr ? 'calc.qpcrMixDesc' : 'calc.mmComDesc')}</p>
        </div>
        <button type="button" id="ql-mmcom-reset" class="ql-btn ql-btn-subtle ql-btn-sm">${t('calc.mmReset')}</button>
      </div>

      <div class="ql-calc-controls-bar" style="margin-top:18px;">
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="ql-mmcom-rxns">${t('calc.mmReactions')}</label>
          <input type="number" id="ql-mmcom-rxns" min="1" step="1" value="${s.masterMix.numReactions}" class="ql-calc-number-input" style="width:130px;" />
        </div>
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="ql-mmcom-excess">${t('calc.mmExcess')}</label>
          <div class="ql-calc-unit-group" style="width:130px;">
            <input type="number" id="ql-mmcom-excess" min="0" max="100" step="1" value="${s.masterMix.excessPct}" class="ql-calc-number-input" />
            <span class="ql-calc-unit-badge">%</span>
          </div>
        </div>
        <div id="ql-mmcom-effective-badge" class="ql-calc-control-hint"></div>
      </div>

      <div class="ql-calc-controls-bar" style="margin-top:16px;">
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="ql-mmcom-vf">${t('calc.mmComVF')}</label>
          <div class="ql-calc-unit-group" style="width:120px;">
            <input type="number" id="ql-mmcom-vf" min="0" step="any" value="${cm.vf}" class="ql-calc-number-input" />
            <span class="ql-calc-unit-badge">µL</span>
          </div>
        </div>
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="ql-mmcom-mixx">${t('calc.mmComMixX')}</label>
          <div class="ql-calc-unit-group" style="width:100px;">
            <input type="number" id="ql-mmcom-mixx" min="0" step="any" value="${cm.mixX}" class="ql-calc-number-input" />
            <span class="ql-calc-unit-badge">X</span>
          </div>
        </div>
        <div id="ql-mmcom-mix-hint" class="ql-calc-control-hint"></div>
      </div>

      <div class="ql-calc-controls-bar" style="margin-top:12px;">
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="ql-mmcom-primer-stock">${t('calc.mmComPrimerStock')}</label>
          <div class="ql-calc-unit-group" style="width:120px;">
            <input type="number" id="ql-mmcom-primer-stock" min="0" step="any" value="${cm.primerStock}" class="ql-calc-number-input" />
            <span class="ql-calc-unit-badge">µM</span>
          </div>
        </div>
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="ql-mmcom-primer-final">${t('calc.mmComPrimerFinal')}</label>
          <div class="ql-calc-unit-group" style="width:120px;">
            <input type="number" id="ql-mmcom-primer-final" min="0" step="any" value="${cm.primerFinal}" class="ql-calc-number-input" />
            <span class="ql-calc-unit-badge">µM</span>
          </div>
          <button type="button" id="ql-mmcom-primer-recommend" class="ql-calc-preset-tag" style="margin-top:6px; align-self:flex-start;">${isQpcr ? t('calc.qpcrPrimerUseRecommended', { v: recommendedPrimer }) : t('calc.mmComPrimerUseRecommended')}</button>
        </div>
        <div id="ql-mmcom-primer-hint" class="ql-calc-control-hint"></div>
      </div>
      <div class="ql-metric-explain">${t(isQpcr ? (cm.chem === 'probe' ? 'calc.qpcrPrimerHintProbe' : 'calc.qpcrPrimerHintSybr') : 'calc.mmPrimerConcHint')}</div>

      <div class="ql-calc-controls-bar" style="margin-top:12px;">
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="ql-mmcom-template-vol">${t('calc.mmComTemplateVolLabel')}</label>
          <div class="ql-calc-unit-group" style="width:120px;">
            <input type="number" id="ql-mmcom-template-vol" min="0" step="any" value="${cm.templateVol}" class="ql-calc-number-input" />
            <span class="ql-calc-unit-badge">µL</span>
          </div>
        </div>
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="ql-mmcom-dna-conc">${t('calc.mmDnaConc')}</label>
          <div class="ql-calc-unit-group" style="width:160px;">
            <input type="number" id="ql-mmcom-dna-conc" min="0" step="any" value="${s.masterMix.dnaConc || ''}"
                   placeholder="Ej. 10" class="ql-calc-number-input" />
            <span class="ql-calc-unit-badge">ng/µL</span>
          </div>
        </div>
        <div class="ql-calc-control-group">
          <label class="ql-calc-label" for="ql-mmcom-dna-mass">${t('calc.mmDnaTargetMass')}</label>
          <div class="ql-calc-unit-group" style="width:160px;">
            <input type="number" id="ql-mmcom-dna-mass" min="0" step="any" value="${s.masterMix.dnaTargetMass != null ? s.masterMix.dnaTargetMass : 30}"
                   placeholder="30" class="ql-calc-number-input" />
            <span class="ql-calc-unit-badge">ng</span>
          </div>
        </div>
        <div id="ql-mmcom-dna-feedback" class="ql-calc-control-hint"></div>
      </div>

      <div id="ql-mmcom-overflow" style="margin-top:12px;"></div>

      <div class="ql-stats" id="ql-mmcom-stats" style="margin-top:16px;">
        <div class="ql-stat">
          <div class="ql-stat-label">${t('calc.mmTotalPerRxn')}</div>
          <div class="ql-stat-value" id="ql-mmcom-stat-per-rxn">—</div>
        </div>
        <div class="ql-stat" style="border-color:var(--accent);">
          <div class="ql-stat-label" style="color:var(--accent);">${t('calc.mmTotalMasterMix')}</div>
          <div class="ql-stat-value" id="ql-mmcom-stat-total-mm" style="color:var(--accent);">—</div>
        </div>
        <div class="ql-stat">
          <div class="ql-stat-label">${t('calc.mmPipettePerWell')}</div>
          <div class="ql-stat-value" id="ql-mmcom-stat-pipette">—</div>
        </div>
        <div class="ql-stat">
          <div class="ql-stat-label">${t('calc.mmTemplatePerWell')}</div>
          <div class="ql-stat-value" id="ql-mmcom-stat-template">—</div>
        </div>
      </div>

      <div class="ql-calc-table-wrap" style="margin-top:20px;">
        <table class="ql-calc-table" id="ql-mmcom-table">
          <thead>
            <tr>
              <th style="min-width:180px;">${t('calc.mmReagentCol')}</th>
              <th style="width:140px; text-align:right;">${t('calc.mmUnitVolCol')}</th>
              <th style="width:130px; text-align:center;">${t('calc.mmInMixCol')}</th>
              <th style="width:160px; text-align:right;">${t('calc.mmTotalVolCol')}</th>
              <th style="width:60px; text-align:center;">${t('calc.mmActionsCol')}</th>
            </tr>
          </thead>
          <tbody id="ql-mmcom-tbody"></tbody>
        </table>
      </div>

      <div style="margin-top:14px;">
        <p class="ql-field-help" style="margin-bottom:8px;">${t('calc.mmComExtrasTitle')}</p>
        <button type="button" id="ql-mmcom-add-btn" class="ql-btn ql-btn-secondary ql-btn-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;"><path d="M12 5v14M5 12h14"/></svg>
          ${t('calc.mmAddReagent')}
        </button>
      </div>
    `;

    parent.appendChild(card);

    const inputRxns = card.querySelector('#ql-mmcom-rxns');
    const inputExcess = card.querySelector('#ql-mmcom-excess');
    const inputVf = card.querySelector('#ql-mmcom-vf');
    const inputMixX = card.querySelector('#ql-mmcom-mixx');
    const inputPrimerStock = card.querySelector('#ql-mmcom-primer-stock');
    const inputPrimerFinal = card.querySelector('#ql-mmcom-primer-final');
    const primerRecommendBtn = card.querySelector('#ql-mmcom-primer-recommend');
    const inputTemplateVol = card.querySelector('#ql-mmcom-template-vol');
    const inputDnaConc = card.querySelector('#ql-mmcom-dna-conc');
    const inputDnaMass = card.querySelector('#ql-mmcom-dna-mass');
    const dnaFeedback = card.querySelector('#ql-mmcom-dna-feedback');
    const mixHint = card.querySelector('#ql-mmcom-mix-hint');
    const primerHint = card.querySelector('#ql-mmcom-primer-hint');
    const badgeEffective = card.querySelector('#ql-mmcom-effective-badge');
    const overflowBox = card.querySelector('#ql-mmcom-overflow');
    const resetBtn = card.querySelector('#ql-mmcom-reset');
    const addBtn = card.querySelector('#ql-mmcom-add-btn');
    const tbody = card.querySelector('#ql-mmcom-tbody');

    const statPerRxn = card.querySelector('#ql-mmcom-stat-per-rxn');
    const statTotalMM = card.querySelector('#ql-mmcom-stat-total-mm');
    const statPipette = card.querySelector('#ql-mmcom-stat-pipette');
    const statTemplate = card.querySelector('#ql-mmcom-stat-template');

    // Ids fijos/derivados: sus filas se muestran de solo lectura (el valor
    // sale de la fórmula, no se edita celda a celda como en el Modo B).
    const FIXED_IDS = new Set(['mix', 'primerFwd', 'primerRev', 'probe', 'h2o', 'template']);

    function recalc() {
      s.masterMix.numReactions = Math.max(1, parseInt(inputRxns.value, 10) || 1);
      s.masterMix.excessPct = Math.max(0, parseFloat(inputExcess.value) || 0);
      cm.vf = Math.max(0, parseFloat(inputVf.value) || 0);
      cm.mixX = Math.max(0, parseFloat(inputMixX.value) || 0);
      cm.primerStock = Math.max(0, parseFloat(inputPrimerStock.value) || 0);
      cm.primerFinal = Math.max(0, parseFloat(inputPrimerFinal.value) || 0);
      cm.templateVol = Math.max(0, parseFloat(inputTemplateVol.value) || 0);

      const mixRes = isQpcr ? computeQpcrMix(cm) : computeCommercialMix(cm);
      const calcRes = calculateMasterMix(mixRes.reagents, s.masterMix.numReactions, s.masterMix.excessPct);

      badgeEffective.innerHTML = t('calc.mmEffectiveBadge', {
        n: calcRes.numReactions, pct: calcRes.excessPct, total: fmtLabNumber(calcRes.effectiveReactions, 2),
      });
      mixHint.innerHTML = t('calc.mmComMixHint', { vol: fmtLabNumber(mixRes.volMix, 3), x: fmtLabNumber(cm.mixX, 2) });
      primerHint.innerHTML = t('calc.mmComPrimerHint', { vol: fmtLabNumber(mixRes.volPrimer, 3) });

      statPerRxn.textContent = `${fmtLabNumber(calcRes.totalPerRxn, 2)} µL`;
      statTotalMM.textContent = `${fmtLabNumber(calcRes.totalMasterMix, 2)} µL`;
      statPipette.textContent = `${fmtLabNumber(calcRes.pipettePerWell, 2)} µL`;
      statTemplate.textContent = `${fmtLabNumber(calcRes.templatePerWell, 2)} µL`;

      if (mixRes.overflow) {
        const total = mixRes.reagents.filter((r) => r.id !== 'h2o').reduce((acc, r) => acc + r.unitVol, 0);
        overflowBox.innerHTML = `<div class="ql-calc-alert ql-calc-alert-error">${t('calc.mmComOverflow', { total: fmtLabNumber(total, 2), vf: fmtLabNumber(cm.vf, 2) })}</div>`;
      } else {
        overflowBox.innerHTML = '';
      }

      tbody.innerHTML = calcRes.reagents.map((r) => {
        const isFixed = FIXED_IDS.has(r.id);
        const volCell = isFixed
          ? `<span class="tabular" style="font-family:var(--font-mono);">${fmtLabNumber(r.unitVol, 3)} µL</span>`
          : `<div class="ql-calc-unit-group" style="width:100%;"><input type="number" min="0" step="any" class="ql-mmcom-input-vol" data-id="${escapeHtml(r.id)}" value="${r.unitVol}" style="text-align:right;" /><span class="ql-calc-unit-badge">µL</span></div>`;
        const nameCell = isFixed
          ? escapeHtml(r.name)
          : `<input type="text" class="ql-mmcom-input-name" data-id="${escapeHtml(r.id)}" value="${escapeHtml(r.name)}" placeholder="${t('calc.mmReagentCol')}" />`;
        const inMixCell = isFixed
          ? (r.inMix ? '✓' : '—')
          : `<input type="checkbox" class="ql-mmcom-input-inmix" data-id="${escapeHtml(r.id)}" ${r.inMix ? 'checked' : ''} aria-label="${t('calc.mmInMixCol')}" />`;
        const delCell = isFixed
          ? ''
          : `<button type="button" class="ql-btn ql-btn-subtle ql-btn-sm ql-mmcom-btn-del" data-id="${escapeHtml(r.id)}" title="${t('calc.mmDelete')}">&times;</button>`;

        return `
          <tr data-id="${escapeHtml(r.id)}">
            <td>${nameCell}</td>
            <td style="text-align:right;">${volCell}</td>
            <td style="text-align:center;">${inMixCell}</td>
            <td style="text-align:right;">
              ${r.inMix
                ? `<strong style="font-family:var(--font-mono); color:var(--accent);">${fmtLabNumber(r.totalVol, 2)} µL</strong>`
                : `<span class="ql-ink-muted" style="font-size:12px;">— (${t('calc.mmTemplatePerWell')})</span>`
              }
            </td>
            <td style="text-align:center;">${delCell}</td>
          </tr>
        `;
      }).join('');

      saveState(s);
    }

    function handleDnaInputChange() {
      const concRaw = inputDnaConc.value.trim();
      const massRaw = inputDnaMass.value.trim();
      s.masterMix.dnaConc = concRaw;
      s.masterMix.dnaTargetMass = massRaw === '' ? 30 : (parseFloat(massRaw) || 0);

      const concVal = parseFloat(concRaw);
      const massVal = parseFloat(massRaw);

      if (Number.isFinite(concVal) && concVal > 0 && Number.isFinite(massVal) && massVal > 0) {
        const dnaVol = calcDnaTemplateVolume(massVal, concVal);
        if (dnaVol !== null) {
          inputTemplateVol.value = dnaVol;
          dnaFeedback.innerHTML = t('calc.mmDnaTip', {
            dnaVol: fmtLabNumber(dnaVol, 2),
            waterVol: '—',
            totalVol: '—',
          });
          recalc();
          return;
        }
      }
      dnaFeedback.innerHTML = '';
      recalc();
    }

    // Controles globales
    inputRxns.addEventListener('input', recalc);
    inputExcess.addEventListener('input', recalc);
    inputVf.addEventListener('input', recalc);
    inputMixX.addEventListener('input', recalc);
    inputPrimerStock.addEventListener('input', recalc);
    inputPrimerFinal.addEventListener('input', recalc);
    inputTemplateVol.addEventListener('input', recalc);
    inputDnaConc.addEventListener('input', handleDnaInputChange);
    inputDnaMass.addEventListener('input', handleDnaInputChange);

    primerRecommendBtn.addEventListener('click', () => {
      inputPrimerFinal.value = recommendedPrimer;
      recalc();
    });

    // Delegación de eventos en la tabla, solo afecta a filas de extras
    // (las filas fijas/derivadas no llevan estas clases, así que no matchean)
    tbody.addEventListener('input', (e) => {
      const id = e.target.getAttribute('data-id');
      if (!id) return;
      const extra = cm.extras.find((r) => String(r.id) === id);
      if (!extra) return;

      if (e.target.classList.contains('ql-mmcom-input-name')) {
        extra.name = e.target.value;
        saveState(s);
      } else if (e.target.classList.contains('ql-mmcom-input-vol')) {
        const val = parseFloat(e.target.value);
        extra.unitVol = Number.isFinite(val) && val >= 0 ? val : 0;
        recalc();
      }
    });

    tbody.addEventListener('change', (e) => {
      const id = e.target.getAttribute('data-id');
      if (!id) return;
      const extra = cm.extras.find((r) => String(r.id) === id);
      if (!extra) return;

      if (e.target.classList.contains('ql-mmcom-input-inmix')) {
        extra.inMix = Boolean(e.target.checked);
        recalc();
      }
    });

    tbody.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.ql-mmcom-btn-del');
      if (!delBtn) return;
      const id = delBtn.getAttribute('data-id');
      if (!id) return;
      cm.extras = cm.extras.filter((r) => String(r.id) !== id);
      recalc();
    });

    // Botón Añadir reactivo extra
    addBtn.addEventListener('click', () => {
      const newId = 'extra_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      cm.extras.push({
        id: newId,
        name: t('calc.mmNewReagentName') || 'Nuevo reactivo',
        unitVol: 0,
        inMix: true,
      });
      recalc();
    });

    // Botón Restablecer (solo el propio de este modo, no toca s.masterMix.reagents)
    resetBtn.addEventListener('click', () => {
      Object.assign(cm, isQpcr ? getDefaultQpcrMix(cm.chem) : getDefaultCommercialMix());
      s.masterMix.numReactions = 10;
      s.masterMix.excessPct = 10;
      s.masterMix.dnaConc = '';
      s.masterMix.dnaTargetMass = 30;
      inputRxns.value = s.masterMix.numReactions;
      inputExcess.value = s.masterMix.excessPct;
      inputVf.value = cm.vf;
      inputMixX.value = cm.mixX;
      inputPrimerStock.value = cm.primerStock;
      inputPrimerFinal.value = cm.primerFinal;
      inputTemplateVol.value = cm.templateVol;
      inputDnaConc.value = '';
      inputDnaMass.value = 30;
      dnaFeedback.innerHTML = '';
      recalc();
    });

    // Render inicial
    recalc();
  }

  // Pintar vista inicial
  paint();

  return () => {
    saveState(s);
  };
}
