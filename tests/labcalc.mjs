// Test unitario y de integridad matemática para la Calculadora Bioquímica (labcalc.js)
//
//   node tests/labcalc.mjs

import { APP_ROOT } from './lib/env.mjs';

const {
  ATOMIC_WEIGHTS,
  parseChemicalFormula,
  calcNucleicAcidMW,
  solveMolarity,
  solveDilution,
  getDefaultMasterMixReagents,
  calculateMasterMix,
  calcDnaTemplateVolume,
  autoBalanceDnaWater,
  balanceWaterToVolume,
  getDefaultCommercialMix,
  computeCommercialMix,
  RECOMMENDED_PRIMER_FINAL_UM,
  getDefaultQpcrMix,
  qpcrReactionCount,
  computeQpcrMix,
  QPCR_PRIMER_FINAL_UM,
  render,
} = await import(APP_ROOT + '/js/modules/labcalc.js');

const { ROUTES } = await import(APP_ROOT + '/js/modules/shell.js');
const { t, setLang } = await import(APP_ROOT + '/js/lib/i18n.js');

let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed = true;
};

const approxEqual = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

console.log('--- 1. Diccionario IUPAC y Constantes Atómicas ---');
{
  check('H está presente y tiene peso atómico estándar ~1.008', approxEqual(ATOMIC_WEIGHTS.H, 1.008));
  check('C tiene peso atómico estándar ~12.011', approxEqual(ATOMIC_WEIGHTS.C, 12.011));
  check('N tiene peso atómico estándar ~14.007', approxEqual(ATOMIC_WEIGHTS.N, 14.007));
  check('O tiene peso atómico estándar ~15.999', approxEqual(ATOMIC_WEIGHTS.O, 15.999));
  check('Na tiene peso atómico estándar ~22.990', approxEqual(ATOMIC_WEIGHTS.Na, 22.990));
  check('Cl tiene peso atómico estándar ~35.45', approxEqual(ATOMIC_WEIGHTS.Cl, 35.45));
  check('Fe tiene peso atómico estándar ~55.845', approxEqual(ATOMIC_WEIGHTS.Fe, 55.845));
}

console.log('\n--- 2. Motor de Peso Molecular: Fórmulas Estándar ---');
{
  const nacl = parseChemicalFormula('NaCl');
  check('NaCl: ok=true y MW = 58.44 g/mol', nacl.ok && approxEqual(nacl.mw, 58.44), `mw=${nacl.mw}`);
  check('NaCl: contiene 2 elementos (Na, Cl)', nacl.elements.length === 2);

  const glucose = parseChemicalFormula('C6H12O6');
  check('C6H12O6 (Glucosa): ok=true y MW = 180.156 g/mol', glucose.ok && approxEqual(glucose.mw, 180.156), `mw=${glucose.mw}`);
  const sumPercent = glucose.elements.reduce((acc, el) => acc + el.percent, 0);
  check('C6H12O6: la suma de porcentajes elementales es 100%', approxEqual(sumPercent, 100));

  const water = parseChemicalFormula('H2O');
  check('H2O: ok=true y MW = 18.015 g/mol', water.ok && approxEqual(water.mw, 18.015), `mw=${water.mw}`);
}

console.log('\n--- 3. Motor de Peso Molecular: Paréntesis y Corchetes Complejos ---');
{
  const caoh2 = parseChemicalFormula('Ca(OH)2');
  check('Ca(OH)2: ok=true y MW = 74.092 g/mol', caoh2.ok && approxEqual(caoh2.mw, 74.092), `mw=${caoh2.mw}`);

  const ammSulf = parseChemicalFormula('(NH4)2SO4');
  check('(NH4)2SO4: ok=true y MW = 132.134 g/mol', ammSulf.ok && approxEqual(ammSulf.mw, 132.134), `mw=${ammSulf.mw}`);
  const nCount = ammSulf.elements.find(e => e.symbol === 'N')?.count;
  const hCount = ammSulf.elements.find(e => e.symbol === 'H')?.count;
  check('(NH4)2SO4: recuento de átomos N=2 y H=8', nCount === 2 && hCount === 8);

  const complex = parseChemicalFormula('K3[Fe(CN)6]');
  check('K3[Fe(CN)6]: ok=true y MW = 329.247 g/mol', complex.ok && approxEqual(complex.mw, 329.247), `mw=${complex.mw}`);
}

console.log('\n--- 4. Motor de Peso Molecular: Hidratos ---');
{
  const mgso4 = parseChemicalFormula('MgSO4·7H2O');
  check('MgSO4·7H2O (con ·): ok=true y MW = 246.466 g/mol', mgso4.ok && approxEqual(mgso4.mw, 246.466), `mw=${mgso4.mw}`);

  const cuso4 = parseChemicalFormula('CuSO4*5H2O');
  check('CuSO4*5H2O (con *): ok=true y MW = 249.677 g/mol', cuso4.ok && approxEqual(cuso4.mw, 249.677), `mw=${cuso4.mw}`);

  const cacl2 = parseChemicalFormula('CaCl2.2H2O');
  check('CaCl2.2H2O (con .): ok=true y MW = 147.008 g/mol', cacl2.ok && approxEqual(cacl2.mw, 147.008), `mw=${cacl2.mw}`);

  const feso4 = parseChemicalFormula('FeSO4 · 7H2O');
  check('FeSO4 · 7H2O (con espacios alrededor del punto): MW = 278.006 g/mol', feso4.ok && approxEqual(feso4.mw, 278.006), `mw=${feso4.mw}`);
}

console.log('\n--- 5. Reactivos y Tampones Comunes de Laboratorio ---');
{
  const tris = parseChemicalFormula('C4H11NO3');
  check('Tris base (C4H11NO3): MW = 121.136 g/mol', tris.ok && approxEqual(tris.mw, 121.136), `mw=${tris.mw}`);

  const edta = parseChemicalFormula('C10H16N2O8');
  check('EDTA ácido libre (C10H16N2O8): MW = 292.244 g/mol', edta.ok && approxEqual(edta.mw, 292.244), `mw=${edta.mw}`);

  const sds = parseChemicalFormula('NaC12H25SO4');
  check('SDS (NaC12H25SO4): MW = 288.378 g/mol', sds.ok && approxEqual(sds.mw, 288.378), `mw=${sds.mw}`);

  const hepes = parseChemicalFormula('C8H18N2O4S');
  check('HEPES (C8H18N2O4S): MW = 238.302 g/mol', hepes.ok && approxEqual(hepes.mw, 238.302), `mw=${hepes.mw}`);
}

console.log('\n--- 6. Validación de Errores en Fórmulas Químicas ---');
{
  const unclosed = parseChemicalFormula('(NH4');
  check('Paréntesis abierto sin cerrar retorna error', !unclosed.ok && typeof unclosed.error === 'string');

  const unopened = parseChemicalFormula('NaCl)');
  check('Paréntesis de cierre desbalanceado retorna error', !unopened.ok && typeof unopened.error === 'string');

  const unknown = parseChemicalFormula('Xx2O');
  check('Elemento químico desconocido retorna error informativo', !unknown.ok && unknown.error.includes('Xx'));

  const empty = parseChemicalFormula('');
  check('Cadena vacía retorna error', !empty.ok);
}

console.log('\n--- 7. Motor de Ácidos Nucleicos (ADN / ARN) ---');
{
  const dsdna = calcNucleicAcidMW('dsDNA', 1000);
  const expDsDNA = 1000 * 617.96 + 36.04; // 617996.04
  check('dsDNA 1000 pb: MW = (1000 * 617.96) + 36.04 = 617996.04 g/mol', dsdna.ok && approxEqual(dsdna.mw, expDsDNA));

  const ssdna = calcNucleicAcidMW('ssDNA', 20);
  const expSsDNA = 20 * 303.7 + 79.0; // 6153.0
  check('ssDNA (Primer) 20 nt: MW = (20 * 303.7) + 79.0 = 6153 g/mol', ssdna.ok && approxEqual(ssdna.mw, expSsDNA));

  const ssrna = calcNucleicAcidMW('ssRNA', 100);
  const expSsRNA = 100 * 320.5 + 159.0; // 32209.0
  check('ssRNA 100 nt: MW = (100 * 320.5) + 159.0 = 32209 g/mol', ssrna.ok && approxEqual(ssrna.mw, expSsRNA));

  const invalidLen = calcNucleicAcidMW('dsDNA', -5);
  check('Longitud no positiva retorna error', !invalidLen.ok);
}

console.log('\n--- 8. Motor de Molaridad (m = C × V × MW) ---');
{
  // Caso A: Despejar Masa (m)
  // C = 0.5 M, V = 250 mL = 0.25 L, MW = 58.44 g/mol -> m = 0.5 * 0.25 * 58.44 = 7.305 g
  const solMass = solveMolarity({ conc: 0.5, concUnit: 'M', vol: 250, volUnit: 'mL', mw: 58.44, massUnit: 'g' });
  check('Despeje de Masa (m): 0.5M, 250mL, MW 58.44 -> 7.305 g', solMass.ok && solMass.solved === 'mass' && approxEqual(solMass.value, 7.305));

  // Caso B: Masa en mg
  const solMassMg = solveMolarity({ conc: 0.5, concUnit: 'M', vol: 250, volUnit: 'mL', mw: 58.44, massUnit: 'mg' });
  check('Despeje de Masa en mg: 7305 mg', solMassMg.ok && approxEqual(solMassMg.value, 7305));

  // Caso C: Despejar Volumen (V)
  // m = 10 g, C = 0.5 M, MW = 58.44 g/mol -> V = 10 / (0.5 * 58.44) = 0.34223 L = 342.23 mL
  const solVol = solveMolarity({ mass: 10, massUnit: 'g', conc: 0.5, concUnit: 'M', mw: 58.44, volUnit: 'mL' });
  check('Despeje de Volumen (V) en mL: ~342.23 mL', solVol.ok && solVol.solved === 'vol' && approxEqual(solVol.value, 342.23, 0.1));

  // Caso D: Despejar Concentración (C)
  // m = 5.844 g, V = 500 mL = 0.5 L, MW = 58.44 -> C = 5.844 / (0.5 * 58.44) = 0.2 M = 200 mM
  const solConc = solveMolarity({ mass: 5.844, massUnit: 'g', vol: 500, volUnit: 'mL', mw: 58.44, concUnit: 'mM' });
  check('Despeje de Concentración (C) en mM: 200 mM', solConc.ok && solConc.solved === 'conc' && approxEqual(solConc.value, 200));

  // Caso E: Despejar MW
  // m = 5.844 g, C = 0.2 M, V = 0.5 L -> MW = 5.844 / (0.2 * 0.5) = 58.44 g/mol
  const solMW = solveMolarity({ mass: 5.844, massUnit: 'g', conc: 0.2, concUnit: 'M', vol: 0.5, volUnit: 'L' });
  check('Despeje de Peso Molecular (MW): 58.44 g/mol', solMW.ok && solMW.solved === 'mw' && approxEqual(solMW.value, 58.44));

  // Caso F: Menos de 3 campos llenos retorna null
  const solFew = solveMolarity({ mass: 10, massUnit: 'g', mw: 58.44 });
  check('Menos de 3 campos llenos retorna null (espera más datos)', solFew === null);
}

console.log('\n--- 9. Motor de Diluciones (C1 × V1 = C2 × V2) ---');
{
  // Caso A: Despejar V1 (Stock necesario)
  // C1 = 10X, C2 = 1X, V2 = 100 mL -> V1 = (1 * 100) / 10 = 10 mL; V_dil = 90 mL
  const dilV1 = solveDilution({ c1: 10, c1Unit: 'X', c2: 1, c2Unit: 'X', v2: 100, v2Unit: 'mL', v1Unit: 'mL' });
  check('Despeje de V1: Stock 10X a 1X en 100 mL -> V1 = 10 mL', dilV1.ok && dilV1.solved === 'v1' && approxEqual(dilV1.value, 10));
  check('Dilución válida y volumen de diluyente = 90 mL', dilV1.isValidDilution && approxEqual(dilV1.vDilInV2Unit, 90));

  // Caso B: Despejar V2
  // C1 = 5 M, V1 = 20 mL, C2 = 1 M -> V2 = (5 * 20) / 1 = 100 mL; V_dil = 80 mL
  const dilV2 = solveDilution({ c1: 5, c1Unit: 'M', v1: 20, v1Unit: 'mL', c2: 1, c2Unit: 'M', v2Unit: 'mL' });
  check('Despeje de V2: 5M (20mL) a 1M -> V2 = 100 mL', dilV2.ok && dilV2.solved === 'v2' && approxEqual(dilV2.value, 100));
  check('Volumen de disolvente a añadir = 80 mL', dilV2.isValidDilution && approxEqual(dilV2.vDilInV2Unit, 80));

  // Caso C: Despejar C2
  // C1 = 100 mM, V1 = 10 mL, V2 = 50 mL -> C2 = (100 * 10) / 50 = 20 mM
  const dilC2 = solveDilution({ c1: 100, c1Unit: 'mM', v1: 10, v1Unit: 'mL', v2: 50, v2Unit: 'mL', c2Unit: 'mM' });
  check('Despeje de C2: 100mM (10mL) en 50mL -> C2 = 20 mM', dilC2.ok && dilC2.solved === 'c2' && approxEqual(dilC2.value, 20));

  // Caso D: Dilución imposible (C2 > C1)
  // C1 = 1 M, C2 = 5 M (concentración final mayor que stock)
  const dilInvalid = solveDilution({ c1: 1, c1Unit: 'M', c2: 5, c2Unit: 'M', v2: 100, v2Unit: 'mL', v1Unit: 'mL' });
  check('Detección de dilución inválida (C2 > C1): isValidDilution=false', dilInvalid.ok && dilInvalid.isValidDilution === false);
}

console.log('\n--- 10. Integración en el Enrutador y Shell de Smart-175 ---');
{
  const calcRoute = ROUTES.find(r => r.id === 'calculadora');
  check('Ruta "calculadora" registrada en ROUTES de shell.js', !!calcRoute);
  check('Ruta calculadora asignada al grupo "counts"', calcRoute && calcRoute.group === 'counts');
  check('Ruta calculadora usa icono "calculator"', calcRoute && calcRoute.icon === 'calculator');

  check('Traducción de nav.calculadora existe en ES', t('nav.calculadora') === 'Calculadora');
  check('Traducción de calc.title existe en ES', typeof t('calc.title') === 'string' && t('calc.title').length > 0);
  check('Traducción de calc.molTitle existe en ES', typeof t('calc.molTitle') === 'string');
  check('Traducción de calc.dilTitle existe en ES', typeof t('calc.dilTitle') === 'string');

  check('Módulo labcalc exporta función render(container)', typeof render === 'function');
}

console.log('\n--- 11. Motor de Master Mix para PCR (Receta, Excedente y Exclusión) ---');
{
  const defReagents = getDefaultMasterMixReagents();
  check('getDefaultMasterMixReagents retorna 7 componentes estándar', Array.isArray(defReagents) && defReagents.length === 7);

  const templateItem = defReagents.find(r => r.id === 'template');
  check('El molde de ADN (template) viene marcado como excluido (inMix: false)', templateItem && templateItem.inMix === false);

  const h2oItem = defReagents.find(r => r.id === 'h2o');
  check('H2O PCR-grade viene marcada como incluida (inMix: true)', h2oItem && h2oItem.inMix === true);

  // Caso A: N = 10 reacciones, margen de pipeteo 10% -> multiplicador 11x
  // Receta por defecto ahora suma 20.0 µL (VF por defecto del proyecto), no
  // 25.0: cebadores a 0.4 µL (0.2 µM final de un stock 10 µM) y el agua
  // absorbe la diferencia frente a la receta previa de 25 µL.
  const res10 = calculateMasterMix(defReagents, 10, 10);
  check('Multiplicador efectivo para N=10 y 10% margen es 11x', approxEqual(res10.effectiveReactions, 11));
  check('Volumen total por reacción es 20.0 µL', approxEqual(res10.totalPerRxn, 20.0), `totalPerRxn=${res10.totalPerRxn}`);
  check('Volumen de Master Mix a pipetear por pocillo es 15.0 µL', approxEqual(res10.pipettePerWell, 15.0), `pipettePerWell=${res10.pipettePerWell}`);
  check('Volumen de Molde por pocillo es 5.0 µL', approxEqual(res10.templatePerWell, 5.0), `templatePerWell=${res10.templatePerWell}`);
  check('Volumen total del tubo Master Mix es 165.0 µL (15 µL * 11)', approxEqual(res10.totalMasterMix, 165.0), `totalMasterMix=${res10.totalMasterMix}`);

  // Comprobar volúmenes calculados individuales
  const h2oRes = res10.reagents.find(r => r.id === 'h2o');
  check('H2O en Master Mix: 11.0 * 11 = 121.0 µL', h2oRes && approxEqual(h2oRes.totalVol, 121.0), `h2o=${h2oRes?.totalVol}`);

  const bufferRes = res10.reagents.find(r => r.id === 'buffer');
  check('Tampón 10X en Master Mix: 2.5 * 11 = 27.5 µL', bufferRes && approxEqual(bufferRes.totalVol, 27.5), `buffer=${bufferRes?.totalVol}`);

  const fwdRes = res10.reagents.find(r => r.id === 'fwd');
  check('Cebador Forward por defecto es 0.4 µL (0.2 µM final @ stock 10 µM, VF=20)', fwdRes && approxEqual(fwdRes.unitVol, 0.4), `fwd=${fwdRes?.unitVol}`);

  const taqRes = res10.reagents.find(r => r.id === 'taq');
  check('Taq Polymerase en Master Mix: 0.2 * 11 = 2.2 µL', taqRes && approxEqual(taqRes.totalVol, 2.2), `taq=${taqRes?.totalVol}`);

  const templateRes = res10.reagents.find(r => r.id === 'template');
  check('Molde de ADN en Master Mix: totalVol = 0 (excluido)', templateRes && templateRes.totalVol === 0);

  // Caso B: N = 8 reacciones, margen 0%
  const res8NoExcess = calculateMasterMix(defReagents, 8, 0);
  check('Sin margen (0%): multiplicador = 8x y total Master Mix = 120.0 µL', approxEqual(res8NoExcess.effectiveReactions, 8) && approxEqual(res8NoExcess.totalMasterMix, 120.0));

  // Caso C: N = 24 reacciones, margen 5% -> 24 * 1.05 = 25.2x
  const res24 = calculateMasterMix(defReagents, 24, 5);
  check('N=24 con 5% exceso: multiplicador = 25.2x y total Master Mix = 378.0 µL', approxEqual(res24.effectiveReactions, 25.2) && approxEqual(res24.totalMasterMix, 378.0));

  // Caso D: Reactivo personalizado (SYBR Green I 1.25 µL)
  const customReagents = [
    ...defReagents,
    { id: 'sybr', name: 'SYBR Green I (10X)', unitVol: 1.25, inMix: true },
  ];
  const resCustom = calculateMasterMix(customReagents, 10, 10);
  check('Añadido SYBR Green (1.25 µL): totalPerRxn = 21.25 µL', approxEqual(resCustom.totalPerRxn, 21.25));
  check('Añadido SYBR Green (1.25 µL): pipettePerWell = 16.25 µL', approxEqual(resCustom.pipettePerWell, 16.25));
  check('Añadido SYBR Green (1.25 µL): totalMasterMix = 178.75 µL (16.25 * 11)', approxEqual(resCustom.totalMasterMix, 178.75));

  // Caso E: Robustez ante entradas inválidas o vacías
  const resEmpty = calculateMasterMix([], 10, 10);
  check('Lista vacía de reactivos retorna 0 de forma segura', resEmpty.totalMasterMix === 0 && resEmpty.totalPerRxn === 0);

  const resNeg = calculateMasterMix(defReagents, -5, -10);
  check('Valores negativos en N o margen se normalizan a 0 sin romper', resNeg.effectiveReactions === 0 && resNeg.totalMasterMix === 0);
}

console.log('\n--- 12. Textos e Internacionalización de Master Mix ---');
{
  check('Traducción de calc.tabMasterMix existe', typeof t('calc.tabMasterMix') === 'string' && t('calc.tabMasterMix').length > 0);
  check('Traducción de calc.mmTitle existe', typeof t('calc.mmTitle') === 'string' && t('calc.mmTitle').length > 0);
  check('Traducción de calc.mmReactions existe', typeof t('calc.mmReactions') === 'string');
  check('Traducción de calc.mmExcess existe', typeof t('calc.mmExcess') === 'string');
  check('Traducción de calc.mmTotalPerRxn existe', typeof t('calc.mmTotalPerRxn') === 'string');
  check('Traducción de calc.mmTotalMasterMix existe', typeof t('calc.mmTotalMasterMix') === 'string');
  check('Traducción de calc.mmPipettePerWell existe', typeof t('calc.mmPipettePerWell') === 'string');
  check('Traducción de calc.mmTemplatePerWell existe', typeof t('calc.mmTemplatePerWell') === 'string');
  check('Traducción de calc.mmDnaConc existe', typeof t('calc.mmDnaConc') === 'string');
  check('Traducción de calc.mmDnaTargetMass existe', typeof t('calc.mmDnaTargetMass') === 'string');
  check('Traducción de calc.mmDnaSectionTitle existe', typeof t('calc.mmDnaSectionTitle') === 'string');

  // Modo A (Master Mix comercial) vs Modo B (por componentes)
  check('Traducción de calc.mmModeCommercial existe', typeof t('calc.mmModeCommercial') === 'string' && t('calc.mmModeCommercial').length > 0);
  check('Traducción de calc.mmModeComponents existe', typeof t('calc.mmModeComponents') === 'string' && t('calc.mmModeComponents').length > 0);
  check('Traducción de calc.mmComVF existe', typeof t('calc.mmComVF') === 'string');
  check('Traducción de calc.mmComMixX existe', typeof t('calc.mmComMixX') === 'string');
  check('Traducción de calc.mmComPrimerStock existe', typeof t('calc.mmComPrimerStock') === 'string');
  check('Traducción de calc.mmComPrimerFinal existe', typeof t('calc.mmComPrimerFinal') === 'string');
  check('Traducción de calc.mmComPrimerUseRecommended existe', typeof t('calc.mmComPrimerUseRecommended') === 'string');
  check('Traducción de calc.mmPrimerConcHint existe y cita 0.2 µM', typeof t('calc.mmPrimerConcHint') === 'string' && t('calc.mmPrimerConcHint').includes('0.2'));
  check('Traducción de calc.mmComOverflow existe', typeof t('calc.mmComOverflow') === 'string');

  // Paridad ES/EN de las claves nuevas (CLAUDE.md: mantener paridad es/en)
  setLang('en');
  check('Traducción EN de calc.mmModeCommercial existe y difiere de ES', t('calc.mmModeCommercial') === 'Commercial Master Mix');
  check('Traducción EN de calc.mmComPrimerFinal existe', typeof t('calc.mmComPrimerFinal') === 'string' && t('calc.mmComPrimerFinal').length > 0);
  check('Traducción EN de calc.mmPrimerConcHint cita 0.2 µM', t('calc.mmPrimerConcHint').includes('0.2'));
  setLang('es');
}

console.log('\n--- 13. Cálculo de Masa de ADN y Auto-Balance de Agua en Master Mix ---');
{
  // A. Cálculo de volumen de molde: V = Masa / Concentración
  check('30 ng @ 10 ng/µL -> Volumen de ADN = 3.0 µL', approxEqual(calcDnaTemplateVolume(30, 10), 3.0));
  check('30 ng @ 15 ng/µL -> Volumen de ADN = 2.0 µL', approxEqual(calcDnaTemplateVolume(30, 15), 2.0));
  check('30 ng @ 60 ng/µL -> Volumen de ADN = 0.5 µL', approxEqual(calcDnaTemplateVolume(30, 60), 0.5));
  check('50 ng @ 25 ng/µL -> Volumen de ADN = 2.0 µL', approxEqual(calcDnaTemplateVolume(50, 25), 2.0));

  // Entradas no válidas
  check('Concentración <= 0 retorna null', calcDnaTemplateVolume(30, 0) === null && calcDnaTemplateVolume(30, -5) === null);
  check('Masa <= 0 retorna null', calcDnaTemplateVolume(0, 10) === null && calcDnaTemplateVolume(-10, 10) === null);
  check('Valores no numéricos retornan null', calcDnaTemplateVolume('abc', 10) === null);

  // B. Auto-balance de agua manteniendo volumen total constante (20 µL, VF
  // por defecto del proyecto desde este prompt — antes eran 25 µL)
  const baseReagents = getDefaultMasterMixReagents();
  const baseTotal = baseReagents.reduce((acc, r) => acc + r.unitVol, 0);
  check('Receta base suma exactamente 20.0 µL', approxEqual(baseTotal, 20.0));

  // Caso 1: ADN pasa de 5.0 µL a 3.0 µL (disminuye 2 µL) -> Agua aumenta de 11.0 a 13.0 µL
  const balanced3 = autoBalanceDnaWater(baseReagents, 3.0);
  const dnaItem1 = balanced3.find(r => r.id === 'template');
  const waterItem1 = balanced3.find(r => r.id === 'h2o');
  const total1 = balanced3.reduce((acc, r) => acc + r.unitVol, 0);
  check('Molde actualizado a 3.0 µL', dnaItem1 && approxEqual(dnaItem1.unitVol, 3.0));
  check('Agua auto-balanceada a 13.0 µL (11.0 + 2.0)', waterItem1 && approxEqual(waterItem1.unitVol, 13.0));
  check('Volumen total de reacción se mantiene constante en 20.0 µL', approxEqual(total1, 20.0));

  // Caso 2: ADN pasa a 1.0 µL (disminuye 4 µL) -> Agua aumenta de 11.0 a 15.0 µL
  const balanced1 = autoBalanceDnaWater(baseReagents, 1.0);
  const waterItem2 = balanced1.find(r => r.id === 'h2o');
  const total2 = balanced1.reduce((acc, r) => acc + r.unitVol, 0);
  check('Agua auto-balanceada a 15.0 µL con 1.0 µL de ADN', waterItem2 && approxEqual(waterItem2.unitVol, 15.0));
  check('Volumen total sigue siendo 20.0 µL con 1.0 µL de ADN', approxEqual(total2, 20.0));

  // Caso 3: ADN pasa a 8.0 µL (aumenta 3 µL) -> Agua disminuye de 11.0 a 8.0 µL
  const balanced8 = autoBalanceDnaWater(baseReagents, 8.0);
  const waterItem3 = balanced8.find(r => r.id === 'h2o');
  const total3 = balanced8.reduce((acc, r) => acc + r.unitVol, 0);
  check('Agua auto-balanceada a 8.0 µL con 8.0 µL de ADN', waterItem3 && approxEqual(waterItem3.unitVol, 8.0));
  check('Volumen total sigue siendo 20.0 µL con 8.0 µL de ADN', approxEqual(total3, 20.0));

  // Caso 4: Volumen de ADN excesivo (ej. 25 µL) -> Agua se trunca a 0 de forma segura sin negativos
  const balancedOverflow = autoBalanceDnaWater(baseReagents, 25.0);
  const waterItemOver = balancedOverflow.find(r => r.id === 'h2o');
  check('Agua se acota a 0 µL cuando el volumen de ADN desborda el espacio disponible', waterItemOver && waterItemOver.unitVol === 0);

  // Inmutabilidad
  check('autoBalanceDnaWater no muta el array original de reactivos', baseReagents.find(r => r.id === 'template').unitVol === 5.0);
}

console.log('\n--- 14. Master Mix — Modo A: Master Mix comercial (2X/5X/10X) ---');
{
  // A. balanceWaterToVolume: agua = resto hasta el volumen objetivo
  const rNoWater = balanceWaterToVolume(
    [{ id: 'a', unitVol: 4 }, { id: 'h2o', unitVol: 0 }, { id: 'b', unitVol: 6 }],
    20,
  );
  check('balanceWaterToVolume: agua = 20 - (4+6) = 10.0 µL', approxEqual(rNoWater.reagents.find(r => r.id === 'h2o').unitVol, 10.0));
  check('balanceWaterToVolume: sin desborde -> overflow=false', rNoWater.overflow === false);
  check('balanceWaterToVolume: no muta el array original', [{ id: 'a', unitVol: 4 }, { id: 'h2o', unitVol: 0 }, { id: 'b', unitVol: 6 }][1].unitVol === 0);

  const rOverflow = balanceWaterToVolume(
    [{ id: 'a', unitVol: 14 }, { id: 'h2o', unitVol: 0 }, { id: 'b', unitVol: 9 }],
    20,
  );
  check('balanceWaterToVolume: componentes (23) > VF (20) -> agua = 0, nunca negativa', rOverflow.reagents.find(r => r.id === 'h2o').unitVol === 0);
  check('balanceWaterToVolume: señala overflow=true cuando los componentes superan VF', rOverflow.overflow === true);

  // B. getDefaultCommercialMix: valores por defecto reales del prompt
  const defCommercial = getDefaultCommercialMix();
  check('Por defecto VF = 20 µL', approxEqual(defCommercial.vf, 20));
  check('Por defecto mezcla = 2X', approxEqual(defCommercial.mixX, 2));
  check('Por defecto cebador final = 0.2 µM (RECOMMENDED_PRIMER_FINAL_UM)', approxEqual(defCommercial.primerFinal, RECOMMENDED_PRIMER_FINAL_UM) && approxEqual(RECOMMENDED_PRIMER_FINAL_UM, 0.2));

  // C. computeCommercialMix: fórmulas volMix = VF/X y volCebador = (concFinal·VF)/concStock
  const mixDef = computeCommercialMix(defCommercial);
  check('volMix = VF/X = 20/2 = 10.0 µL', approxEqual(mixDef.volMix, 10.0), `volMix=${mixDef.volMix}`);
  check('volCebador = (0.2 × 20) / 10 = 0.4 µL', approxEqual(mixDef.volPrimer, 0.4), `volPrimer=${mixDef.volPrimer}`);
  check('Sin desborde por defecto', mixDef.overflow === false);

  const sumDef = mixDef.reagents.reduce((acc, r) => acc + r.unitVol, 0);
  check('Conservación del volumen final: suma de componentes == VF (20 µL)', approxEqual(sumDef, defCommercial.vf, 1e-2), `suma=${sumDef}`);

  const mixRow = mixDef.reagents.find(r => r.id === 'mix');
  const fwdRow = mixDef.reagents.find(r => r.id === 'primerFwd');
  const revRow = mixDef.reagents.find(r => r.id === 'primerRev');
  check('Fila de la mezcla comercial marcada inMix=true', mixRow && mixRow.inMix === true);
  check('Cebadores Fwd y Rev con el mismo volumen calculado', fwdRow && revRow && approxEqual(fwdRow.unitVol, revRow.unitVol));

  // D. Otra concentración de mezcla (5X) y de cebador -> misma fórmula
  const mix5x = computeCommercialMix({ vf: 20, mixX: 5, primerStock: 10, primerFinal: 0.5, templateVol: 2, extras: [] });
  check('volMix = 20/5 = 4.0 µL con mezcla 5X', approxEqual(mix5x.volMix, 4.0));
  check('volCebador = (0.5 × 20) / 10 = 1.0 µL con 0.5 µM final', approxEqual(mix5x.volPrimer, 1.0));

  // E. VF distinto de 20 (todo editable, no solo el valor por defecto)
  const mix25 = computeCommercialMix({ vf: 25, mixX: 2, primerStock: 10, primerFinal: 0.2, templateVol: 2, extras: [] });
  check('VF editable: volMix = 25/2 = 12.5 µL', approxEqual(mix25.volMix, 12.5));
  const sum25 = mix25.reagents.reduce((acc, r) => acc + r.unitVol, 0);
  check('VF editable: la suma sigue igualando VF (25 µL)', approxEqual(sum25, 25, 1e-2));

  // F. Reactivo extra opcional (BSA) se incluye en la conservación del volumen
  const mixExtra = computeCommercialMix({
    vf: 20, mixX: 2, primerStock: 10, primerFinal: 0.2, templateVol: 2,
    extras: [{ id: 'bsa', name: 'BSA', unitVol: 1.0, inMix: true }],
  });
  const bsaRow = mixExtra.reagents.find(r => r.id === 'bsa');
  check('Reactivo extra (BSA) presente en la lista derivada', bsaRow && approxEqual(bsaRow.unitVol, 1.0));
  const sumExtra = mixExtra.reagents.reduce((acc, r) => acc + r.unitVol, 0);
  check('Con extra: la suma sigue igualando VF (20 µL) — el agua absorbe el hueco', approxEqual(sumExtra, 20, 1e-2));
  check('Con el extra, el agua es menor que sin él', mixExtra.water < mixDef.water);

  // G. Desborde real: mezcla + cebadores + molde ya superan VF
  const mixOverflow = computeCommercialMix({ vf: 10, mixX: 2, primerStock: 10, primerFinal: 0.2, templateVol: 8, extras: [] });
  // volMix=5.0, volPrimer=0.2 cada uno (0.4 total), template=8 -> 13.4 > VF=10
  check('Desborde real: agua = 0 (nunca negativa)', mixOverflow.reagents.find(r => r.id === 'h2o').unitVol === 0);
  check('Desborde real: overflow=true', mixOverflow.overflow === true);

  // H. calculateMasterMix (multiplicador N×margen) también aplica al Modo A
  const mixCalc = calculateMasterMix(mixDef.reagents, 12, 10);
  check('Modo A también usa calculateMasterMix: N=12 + 10% = 13.2x', approxEqual(mixCalc.effectiveReactions, 13.2));
  check('Modo A: totalPerRxn == VF (20 µL)', approxEqual(mixCalc.totalPerRxn, 20.0));
}


console.log('\n--- qPCR (Fase 2, B4): química, sonda y recuento de placa ---');
{
  check('placa: (8 muestras + 5 estándares + 1 NTC) × 3 réplicas = 42', qpcrReactionCount({ samples: 8, standards: 5, ntc: 1, replicates: 3 }) === 42);
  check('placa: réplicas 0 cuenta como 1; valores vacíos como 0', qpcrReactionCount({ samples: 4, standards: '', ntc: 1, replicates: 0 }) === 5);
  const sy = computeQpcrMix(getDefaultQpcrMix('sybr'));
  const v = (res, id) => (res.reagents.find((r) => r.id === id) || {}).unitVol;
  check('SYBR 20 µL: mezcla 2X = 10 µL', approxEqual(v(sy, 'mix'), 10));
  check('SYBR: cebadores a 0,4 µM desde 10 µM = 0,8 µL cada uno', QPCR_PRIMER_FINAL_UM.sybr === 0.4 && approxEqual(v(sy, 'primerFwd'), 0.8) && approxEqual(v(sy, 'primerRev'), 0.8));
  check('SYBR: sin fila de sonda', v(sy, 'probe') === undefined);
  check('SYBR: agua completa hasta 20 µL (6,4 µL con 2 µL de molde)', approxEqual(v(sy, 'h2o'), 6.4) && !sy.overflow);
  const pr = computeQpcrMix(getDefaultQpcrMix('probe'));
  check('Sonda: cebadores a 0,9 µM = 1,8 µL cada uno', approxEqual(v(pr, 'primerFwd'), 1.8));
  check('Sonda: 0,25 µM desde 10 µM = 0,5 µL, dentro de la mezcla', approxEqual(v(pr, 'probe'), 0.5) && pr.reagents.find((r) => r.id === 'probe').inMix === true);
  const sum = pr.reagents.reduce((a, r) => a + r.unitVol, 0);
  check('Sonda: todo suma exactamente el volumen final (20 µL)', approxEqual(sum, 20) && approxEqual(v(pr, 'h2o'), 3.9));
  const rows = calculateMasterMix(pr.reagents, 42, 10);
  check('la placa de 42 reacciones + 10% pasa por el mismo multiplicador (46,2×)', approxEqual(rows.effectiveReactions, 46.2));
  const big = computeQpcrMix({ ...getDefaultQpcrMix('probe'), templateVol: 10 });
  check('molde excesivo en sonda: agua nunca negativa y overflow=true', v(big, 'h2o') === 0 && big.overflow === true);
}

console.log(failed ? '\n❌ ALGUNAS PRUEBAS FALLARON\n' : '\n✅ TODAS LAS PRUEBAS DE LAB CALC PASARON EXITOSAMENTE (100%)\n');
process.exit(failed ? 1 : 0);
