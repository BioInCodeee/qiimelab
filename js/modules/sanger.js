// Secuenciación Sanger: recorte por calidad + solapamiento forward/reverse +
// consenso, a partir de cromatogramas .ab1 (o FASTQ/FASTA ya extraídos).
//
// Autocontenido como #/primers o #/ufc: no lee ni escribe el estado global
// de la app. Persiste en localStorage solo la CONFIGURACIÓN (método de
// recorte, palabras clave de emparejamiento, longitud de amplicón…) y el
// ÚLTIMO LOTE DE RESULTADOS ya calculado (id, método, diagnóstico, consenso
// — texto pequeño). La traza y las calidades crudas de los .ab1 subidos
// viven solo en memoria de esta pestaña del navegador: si recargas la
// página, los resultados y el consenso siguen ahí, pero el visor de
// cromatograma necesita volver a subir el archivo (o recargar el ejemplo).

import { t, getLang } from '../lib/i18n.js';
import { parseAb1 } from '../lib/ab1Parser.js';
import { trimRead } from '../lib/sangerTrim.js';
import { mergeReads, reverseComplement, findSeedAnchor, overlapAlign, windowedIdentityTrim } from '../lib/sangerOverlap.js';
import { listZipEntries, readZipEntry } from '../lib/minizip.js';
import { CATEGORICAL } from '../lib/palettes.js';
import { attachChartEditor } from '../lib/chartEditor.js';
import { alignWithWorker } from '../lib/aligner.js';
import { openPanel } from '../lib/modal.js';
import { svgEl, escapeHtml, moreDetailsHtml } from '../lib/dom.js';
import { glossaryLinkHtml } from '../lib/glossaryLink.js';
import { markExternal } from '../lib/reportLog.js';

const STORE_KEY = 'smart-175.sanger';
const LEGACY_STORE_KEY = 'qiimelab.sanger';
const PRIMERS_STORE_KEY = 'smart-175.primers';
const LEGACY_PRIMERS_STORE_KEY = 'qiimelab.primers';

// Sin asignación previa de color base A/C/G/T en el resto de la app — se usan
// los 4 primeros tonos de la paleta categórica, el subconjunto ya validado
// como "seguro para scatter" (cualquier par se distingue), apropiado aquí
// porque las 4 trazas se superponen y cualquier par puede quedar adyacente.
const BASE_COLOR = { A: CATEGORICAL[0], C: CATEGORICAL[1], G: CATEGORICAL[2], T: CATEGORICAL[3] };

const EXAMPLE_CLEAN = ['datos-ejemplo/sanger/B13-27F.ab1', 'datos-ejemplo/sanger/B13-1492R.ab1'];
const EXAMPLE_REVIEW = ['datos-ejemplo/sanger/B1-27F.ab1', 'datos-ejemplo/sanger/B1-1492R.ab1'];

const TABS = [
  { id: 'entrada', labelKey: 'sanger.tabEntrada' },
  { id: 'cromatograma', labelKey: 'sanger.tabCromatograma' },
  { id: 'resultados', labelKey: 'sanger.tabResultados' },
];

function fmtPct(x) { return Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—'; }

export function cleanFastaOrPlain(text) {
  if (!text || typeof text !== 'string') return '';
  const lines = text.trim().split(/\r?\n/);
  const seqLines = lines.filter((line) => !line.trim().startsWith('>'));
  return seqLines.join('').replace(/[^A-Za-z-]/g, '').toUpperCase();
}

export function renderAlignmentHTML(result, opts = {}) {
  if (!result || !result.alignedA || !result.alignedB || result.score <= 0) {
    return '<pre class="ql-code ql-align-result-pre"><code>' + t('sanger.alignNoResult') + '</code></pre>';
  }

  const { lineLength = 60 } = opts;
  const { alignedA, alignedB, startA, startB, score, identity, length, matches, mismatches, gaps, cigar } = result;

  const headerLine = `${t('sanger.alignScore')}: ${score} | ${t('sanger.colLen')}: ${length} pb | ${t('sanger.colIdentity')}: ${(identity * 100).toFixed(1)}% (${matches}/${length}) | ${t('sanger.alignMismatches')}: ${mismatches} | ${t('sanger.alignGaps')}: ${gaps}${cigar ? ` | CIGAR: ${cigar}` : ''}`;

  const lines = [headerLine];

  let curA = startA;
  let curB = startB;

  for (let offset = 0; offset < alignedA.length; offset += lineLength) {
    const chunkA = alignedA.slice(offset, offset + lineLength);
    const chunkB = alignedB.slice(offset, offset + lineLength);

    let htmlA = '';
    let htmlB = '';
    let matchLine = '';

    let basesA = 0;
    let basesB = 0;

    let inMisA = false;
    let inMisB = false;
    let inMisM = false;

    for (let k = 0; k < chunkA.length; k++) {
      const ca = chunkA[k];
      const cb = chunkB[k];
      if (ca !== '-') basesA++;
      if (cb !== '-') basesB++;

      const isGap = ca === '-' || cb === '-';
      const isMatch = !isGap && ca.toUpperCase() === cb.toUpperCase();
      const misA = !isMatch;
      const misB = !isMatch;
      const misM = !isMatch && !isGap;

      if (misA && !inMisA) { htmlA += '<span class="ql-mismatch">'; inMisA = true; }
      else if (!misA && inMisA) { htmlA += '</span>'; inMisA = false; }
      htmlA += escapeHtml(ca);

      if (misB && !inMisB) { htmlB += '<span class="ql-mismatch">'; inMisB = true; }
      else if (!misB && inMisB) { htmlB += '</span>'; inMisB = false; }
      htmlB += escapeHtml(cb);

      if (misM && !inMisM) { matchLine += '<span class="ql-mismatch">'; inMisM = true; }
      else if (!misM && inMisM) { matchLine += '</span>'; inMisM = false; }
      matchLine += isMatch ? '|' : (isGap ? ' ' : '.');
    }
    if (inMisA) htmlA += '</span>';
    if (inMisB) htmlB += '</span>';
    if (inMisM) matchLine += '</span>';

    const endPosA = curA + basesA;
    const endPosB = curB + basesB;
    const padLen = Math.max(6, String(Math.max(endPosA, endPosB)).length);

    lines.push('');
    lines.push(`Consenso   ${String(curA).padStart(padLen)}  ${htmlA}  ${endPosA}`);
    lines.push(`${' '.repeat(11 + padLen + 2)}${matchLine}`);
    lines.push(`Referencia ${String(curB).padStart(padLen)}  ${htmlB}  ${endPosB}`);

    curA = endPosA;
    curB = endPosB;
  }

  return `<pre class="ql-code ql-align-result-pre"><code>${lines.join('\n')}</code></pre>`;
}

/**
 * Procesa y calcula las columnas de solapamiento y métricas entre Forward y
 * Reverse Complement, identificando coincidencias, discrepancias y extremos.
 *
 * @param {string|Object} fwdOrData - Secuencia Forward o un objeto contenedor
 * @param {string} [revCompSeq] - Secuencia Reverse Complement
 * @param {string} [consensus] - Secuencia consenso resultante
 * @param {Object} [opts] - Opciones de alineamiento
 * @returns {Object} Datos estructurados del solapamiento y columnas
 */
export function buildOverlapData(fwdOrData, revCompSeq, consensus, opts = {}) {
  let fwdSeq = '';
  let rcSeq = '';
  let consSeq = '';
  let options = opts;

  if (typeof fwdOrData === 'object' && fwdOrData !== null && !Array.isArray(fwdOrData)) {
    fwdSeq = fwdOrData.fwdSeq || fwdOrData.forward || '';
    rcSeq = fwdOrData.revCompSeq || fwdOrData.rcSeq || fwdOrData.reverseComplement || '';
    consSeq = fwdOrData.consensus || '';
    options = revCompSeq && typeof revCompSeq === 'object' ? revCompSeq : opts;
  } else {
    fwdSeq = fwdOrData || '';
    rcSeq = revCompSeq || '';
    consSeq = consensus || '';
  }

  if (!fwdSeq && !rcSeq && !consSeq) {
    return {
      fwdSeq: '',
      rcSeq: '',
      consSeq: '',
      cols: [],
      colHtmls: [],
      overlapBases: 0,
      matches: 0,
      mismatches: 0,
      identityPct: '—',
      firstFwdIdx: -1,
      lastFwdIdx: -1,
      firstRevIdx: -1,
      lastRevIdx: -1,
      isEmpty: true,
    };
  }

  let colsA = options.colsA || '';
  let colsB = options.colsB || '';
  let fStart = Number.isFinite(options.fStart) ? options.fStart : -1;
  let rStart = Number.isFinite(options.rStart) ? options.rStart : 0;
  let isOverlap = colsA.length > 0 && fStart >= 0;

  if (!isOverlap && fwdSeq && rcSeq) {
    // 1. Intentar ancla por semillas (modelo Sanger de Smart-175)
    const anchor = findSeedAnchor(fwdSeq, rcSeq);
    if (anchor && anchor.reliable) {
      const dEstimate = Math.max(0, Math.min(fwdSeq.length, anchor.diagonal));
      const winFStart = Math.max(0, dEstimate - 40);
      const winF = fwdSeq.slice(winFStart);
      const winR = rcSeq.slice(0, Math.min(rcSeq.length, fwdSeq.length - dEstimate + 40));
      const aln = overlapAlign(winF, winR);
      if (aln.colsA.length > 0) {
        const trimEnd = windowedIdentityTrim(aln.colsA, aln.colsB);
        if (trimEnd > 0) {
          colsA = aln.colsA.slice(0, trimEnd);
          colsB = aln.colsB.slice(0, trimEnd);
          fStart = winFStart + aln.aStart;
          rStart = aln.bStart;
          isOverlap = true;
        }
      }
    }

    // 2. Fallback: alineamiento directo de extremos libres si no hubo ancla k=15
    if (!isOverlap) {
      const aln = overlapAlign(fwdSeq, rcSeq);
      if (aln.colsA.length > 0 && aln.score > 0) {
        const trimEnd = windowedIdentityTrim(aln.colsA, aln.colsB);
        if (trimEnd > 0) {
          colsA = aln.colsA.slice(0, trimEnd);
          colsB = aln.colsB.slice(0, trimEnd);
          fStart = aln.aStart;
          rStart = aln.bStart;
          isOverlap = true;
        }
      }
    }
  }

  // Construcción de columnas
  const cols = [];

  if (isOverlap) {
    // Flanco 5' que sobrepase en RevComp (raro)
    for (let j = 0; j < rStart; j++) {
      cols.push({ f: ' ', r: rcSeq[j], type: 'rev-only ql-overlap-rev' });
    }

    // Flanco 5' solo Forward
    for (let i = 0; i < fStart; i++) {
      cols.push({ f: fwdSeq[i], r: ' ', type: 'fwd-only ql-overlap-fwd' });
    }

    // Zona de solapamiento
    let fBases = 0, rBases = 0;
    for (let k = 0; k < colsA.length; k++) {
      const ca = colsA[k];
      const cb = colsB[k];
      if (ca !== '-') fBases++;
      if (cb !== '-') rBases++;

      const isMatch = ca === cb && ca !== '-';
      const isMismatch = ca !== cb && ca !== '-' && cb !== '-';
      const type = isMatch
        ? 'overlap-match ql-overlap-match'
        : (isMismatch ? 'overlap-mismatch ql-overlap-mismatch' : 'ql-ds-gap');

      cols.push({ f: ca, r: cb, type });
    }

    // Flanco 3' de Forward si sobrara (raro)
    for (let i = fStart + fBases; i < fwdSeq.length; i++) {
      cols.push({ f: fwdSeq[i], r: ' ', type: 'fwd-only ql-overlap-fwd' });
    }

    // Flanco 3' solo RevComp
    for (let j = rStart + rBases; j < rcSeq.length; j++) {
      cols.push({ f: ' ', r: rcSeq[j], type: 'rev-only ql-overlap-rev' });
    }
  } else {
    // Modo sin solapamiento (stitched o lecturas separadas)
    if (fwdSeq) {
      for (let i = 0; i < fwdSeq.length; i++) {
        cols.push({ f: fwdSeq[i], r: ' ', type: 'fwd-only ql-overlap-fwd' });
      }
    }
    const nBridgeMatch = consSeq ? consSeq.slice(fwdSeq.length).match(/^N+/) : null;
    const nGap = nBridgeMatch ? nBridgeMatch[0].length : (fwdSeq && rcSeq ? 10 : 0);
    for (let k = 0; k < nGap; k++) {
      cols.push({ f: ' ', r: ' ', type: 'ql-ds-gap' });
    }
    if (rcSeq) {
      for (let j = 0; j < rcSeq.length; j++) {
        cols.push({ f: ' ', r: rcSeq[j], type: 'rev-only ql-overlap-rev' });
      }
    }
  }

  // Métricas del solapamiento
  let overlapBases = 0, matches = 0, mismatches = 0;
  for (let i = 0; i < cols.length; i++) {
    if (cols[i].type.includes('overlap-match')) { overlapBases++; matches++; }
    else if (cols[i].type.includes('overlap-mismatch')) { overlapBases++; mismatches++; }
    else if (cols[i].type.includes('ql-ds-gap') && cols[i].f !== ' ' && cols[i].r !== ' ') { overlapBases++; }
  }
  const identityPct = overlapBases > 0 ? ((matches / overlapBases) * 100).toFixed(1) + '%' : '—';

  // Identificar posiciones iniciales y finales de cada lectura para etiquetas 5' y 3'
  const firstFwdIdx = cols.findIndex((c) => c.f !== ' ' && c.f !== '-');
  let lastFwdIdx = -1;
  for (let i = cols.length - 1; i >= 0; i--) {
    if (cols[i].f !== ' ' && cols[i].f !== '-') { lastFwdIdx = i; break; }
  }
  const firstRevIdx = cols.findIndex((c) => c.r !== ' ' && c.r !== '-');
  let lastRevIdx = -1;
  for (let i = cols.length - 1; i >= 0; i--) {
    if (cols[i].r !== ' ' && cols[i].r !== '-') { lastRevIdx = i; break; }
  }

  const colHtmls = [];

  // Etiqueta 5' inicial
  const initFwdTag = firstFwdIdx === 0 ? '<div class="ql-ds-tag" title="Extremo 5\' Forward">5\'</div>' : '<div class="ql-ds-block ql-ds-empty"></div>';
  const initRevTag = firstRevIdx === 0 ? '<div class="ql-ds-tag" title="Extremo 5\' Reverse Complement">5\'</div>' : '<div class="ql-ds-block ql-ds-empty"></div>';
  if (firstFwdIdx === 0 || firstRevIdx === 0) {
    colHtmls.push('<div class="ql-ds-col ql-ds-col-tag">' + initFwdTag + initRevTag + '</div>');
  }

  // Columnas con bloques apilados
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    const pos = i + 1;

    // Bloque superior (Forward)
    let uHtml = '';
    if (c.f !== ' ' && c.f !== '-') {
      uHtml = `<div class="ql-ds-block ${c.type}" title="Pos: ${pos} | Forward: ${escapeHtml(c.f)}">${escapeHtml(c.f)}</div>`;
    } else if (i === lastFwdIdx + 1) {
      uHtml = '<div class="ql-ds-tag" title="Extremo 3\' Forward">3\'</div>';
    } else {
      uHtml = '<div class="ql-ds-block ql-ds-empty"></div>';
    }

    // Bloque inferior (Reverse Complement)
    let lHtml = '';
    if (c.r !== ' ' && c.r !== '-') {
      lHtml = `<div class="ql-ds-block ${c.type}" title="Pos: ${pos} | RevComp: ${escapeHtml(c.r)}">${escapeHtml(c.r)}</div>`;
    } else if (i === firstRevIdx - 1) {
      lHtml = '<div class="ql-ds-tag" title="Extremo 5\' Reverse Complement">5\'</div>';
    } else {
      lHtml = '<div class="ql-ds-block ql-ds-empty"></div>';
    }

    colHtmls.push(`<div class="ql-ds-col" data-pos="${pos}">${uHtml}${lHtml}</div>`);
  }

  // Etiqueta 3' final si Forward o RevComp llegan hasta el último bloque
  const endFwdTag = lastFwdIdx === cols.length - 1 ? '<div class="ql-ds-tag" title="Extremo 3\' Forward">3\'</div>' : '<div class="ql-ds-block ql-ds-empty"></div>';
  const endRevTag = lastRevIdx === cols.length - 1 ? '<div class="ql-ds-tag" title="Extremo 3\' Reverse Complement">3\'</div>' : '<div class="ql-ds-block ql-ds-empty"></div>';
  if (lastFwdIdx === cols.length - 1 || lastRevIdx === cols.length - 1) {
    colHtmls.push('<div class="ql-ds-col ql-ds-col-tag">' + endFwdTag + endRevTag + '</div>');
  }

  return {
    fwdSeq,
    rcSeq,
    consSeq,
    cols,
    colHtmls,
    overlapBases,
    matches,
    mismatches,
    identityPct,
    firstFwdIdx,
    lastFwdIdx,
    firstRevIdx,
    lastRevIdx,
    isEmpty: false,
  };
}

/**
 * Renderiza el solapamiento entre Forward y Reverse Complement en una
 * visualización horizontal de "doble cadena" estilo Genome Browser, con
 * contenedor scrollable (overflow-x: auto), carril Flexbox con dos bloques
 * apilados por posición de nucleótido, etiquetas direccionales 5' y 3' y
 * bloques vacíos en los extremos no solapados.
 *
 * @param {string|Object} fwdOrData - Secuencia Forward recortada o un objeto { fwdSeq, revCompSeq, consensus, ... }
 * @param {string} [revCompSeq] - Secuencia Reverse Complement recortada
 * @param {string} [consensus] - Secuencia consenso resultante
 * @param {Object} [opts] - Opciones adicionales
 * @returns {string} HTML seguro del carril de doble cadena horizontal
 */
export function renderOverlapHTML(fwdOrData, revCompSeq, consensus, opts = {}) {
  const data = (fwdOrData && fwdOrData.cols && fwdOrData.colHtmls)
    ? fwdOrData
    : buildOverlapData(fwdOrData, revCompSeq, consensus, opts);

  if (data.isEmpty) {
    return `<div class="ql-ds-container"><p class="ql-field-help" style="padding:12px;margin:0;">${t('sanger.overlapNoData')}</p></div>`;
  }

  return `<div class="ql-ds-wrapper">
    <div class="ql-ds-header">
      <span>Forward: <strong>${data.fwdSeq.length} pb</strong></span>
      <span>RevComp: <strong>${data.rcSeq.length} pb</strong></span>
      <span>${t('sanger.overlapStatOverlapLen')}: <strong>${data.overlapBases} pb</strong></span>
      <span>${t('sanger.overlapStatIdentity')}: <strong>${data.identityPct}</strong> (${data.matches}/${data.overlapBases})</span>
      <span>${t('sanger.overlapStatMismatches')}: <strong>${data.mismatches}</strong></span>
      <span>${t('sanger.overlapStatConsensusLen')}: <strong>${data.consSeq.length || data.cols.length} pb</strong></span>
    </div>
    <div class="ql-ds-container" tabindex="0" role="region" aria-label="Visor de doble cadena de solapamiento">
      <div class="ql-ds-track">
        <div class="ql-ds-labels">
          <div class="ql-ds-lane-label">Forward</div>
          <div class="ql-ds-lane-label">RevComp</div>
        </div>
        ${data.colHtmls.join('')}
      </div>
    </div>
  </div>`;
}

/**
 * Renderiza el minimapa condensado de toda la secuencia con bloques estrechos
 * de color y el recuadro del indicador de viewport.
 *
 * @param {Object|Array} overlapDataOrCols - Datos generados por buildOverlapData o array de columnas
 * @param {Object} [opts] - Opciones adicionales
 * @returns {string} HTML del minimapa
 */
export function renderMinimapHTML(overlapDataOrCols, opts = {}) {
  const data = Array.isArray(overlapDataOrCols)
    ? { cols: overlapDataOrCols }
    : (overlapDataOrCols && overlapDataOrCols.cols ? overlapDataOrCols : buildOverlapData(overlapDataOrCols, opts));

  const cols = data.cols || [];
  const colCount = cols.length;

  return `<div class="ql-minimap-wrap">
    <div class="ql-minimap-header">
      <strong>${t('sanger.minimapTitle') || 'Minimapa de la secuencia'}</strong>
      <span>${t('sanger.minimapHint') || 'Clic o arrastra para navegar'}</span>
    </div>
    <div class="ql-minimap-container" role="region" aria-label="Minimapa de solapamiento">
      <div class="ql-minimap-track">
        <canvas class="ql-minimap-canvas" width="${Math.max(1, colCount)}" height="14" aria-hidden="true"></canvas>
      </div>
      <div class="ql-minimap-viewport" aria-hidden="true"></div>
    </div>
  </div>`;
}

/**
 * Dibuja las columnas del minimapa directamente sobre el contexto 2D del canvas.
 * Evita inyectar miles de nodos DOM y previene layout thrashing.
 *
 * @param {HTMLCanvasElement} canvas - Canvas sobre el que dibujar
 * @param {Object|Array} overlapDataOrCols - Datos de solapamiento o array de columnas
 * @param {Object} [opts] - Opciones adicionales
 */
export function drawMinimapCanvas(canvas, overlapDataOrCols, opts = {}) {
  if (!canvas) return;
  const data = Array.isArray(overlapDataOrCols)
    ? { cols: overlapDataOrCols }
    : (overlapDataOrCols && overlapDataOrCols.cols ? overlapDataOrCols : buildOverlapData(overlapDataOrCols, opts));

  const cols = data.cols || [];
  if (!cols.length) return;

  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) return;

  const w = canvas.width || cols.length;
  const h = canvas.height || 14;
  ctx.clearRect(0, 0, w, h);

  const colW = w / cols.length;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    let fill = '#94a3b8';
    if (c.type.includes('overlap-mismatch')) fill = '#dc2626';
    else if (c.type.includes('overlap-match')) fill = '#059669';
    else if (c.type.includes('fwd-only')) fill = '#0284c7';
    else if (c.type.includes('rev-only')) fill = '#9333ea';

    ctx.fillStyle = fill;
    const x = i * colW;
    const barW = c.type.includes('overlap-mismatch') ? Math.max(2, colW) : Math.max(1, colW);
    ctx.fillRect(x, 0, barW, h);
  }
}

/**
 * Calcula las coordenadas del indicador del minimapa a partir del scroll de la vista principal.
 *
 * @param {number} scrollLeft - Desplazamiento horizontal actual
 * @param {number} scrollWidth - Ancho total con scroll de la vista principal
 * @param {number} clientWidth - Ancho visible de la vista principal
 * @param {number} minimapWidth - Ancho disponible del carril del minimapa
 * @param {number} [minVpWidth=8] - Ancho mínimo del indicador
 * @returns {{ scrollPct: number, vpWidth: number, left: number }}
 */
export function calculateMinimapViewport(scrollLeft, scrollWidth, clientWidth, minimapWidth, minVpWidth = 8) {
  if (scrollWidth <= 0 || minimapWidth <= 0) {
    return { scrollPct: 0, vpWidth: minimapWidth || 0, left: 0 };
  }
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  const visibleRatio = Math.min(1, clientWidth / scrollWidth);
  const vpWidth = Math.max(minVpWidth, Math.min(minimapWidth, visibleRatio * minimapWidth));

  let scrollPct = 0;
  let left = 0;
  if (maxScroll > 0) {
    scrollPct = Math.max(0, Math.min(1, scrollLeft / maxScroll));
    left = scrollPct * (minimapWidth - vpWidth);
  }

  return { scrollPct, vpWidth, left };
}

/**
 * Calcula el desplazamiento (scrollLeft) para la vista principal a partir de una interacción (clic/drag) en el minimapa.
 *
 * @param {number} clickX - Posición horizontal del puntero relativa al minimapa
 * @param {number} minimapWidth - Ancho del carril del minimapa
 * @param {number} scrollWidth - Ancho total con scroll de la vista principal
 * @param {number} clientWidth - Ancho visible de la vista principal
 * @returns {{ clickPct: number, targetScrollLeft: number }}
 */
export function calculateScrollFromMinimap(clickX, minimapWidth, scrollWidth, clientWidth) {
  if (minimapWidth <= 0) {
    return { clickPct: 0, targetScrollLeft: 0 };
  }
  const clampedX = Math.max(0, Math.min(minimapWidth, clickX));
  const clickPct = clampedX / minimapWidth;
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  const targetScrollLeft = clickPct * maxScroll;

  return { clickPct, targetScrollLeft };
}

/**
 * Abre un modal interactivo con visor de doble cadena horizontal (zoom)
 * y minimapa condensado inferior sincronizado.
 *
 * Sincronización:
 * - Principal a Minimapa: scroll en vista principal -> actualiza left y width del indicador.
 * - Minimapa a Principal: clic/arrastre en minimapa -> ajusta scrollLeft en vista principal.
 *
 * Gestión de memoria:
 * - Todos los listeners se destruyen al cerrar el modal evitando fugas de memoria.
 *
 * @param {Object} resultItem - Datos de la muestra ({ id, consensus, fSeq, rcSeq, method, ... })
 * @param {Object} [opts] - Opciones adicionales ({ samples, state, onClose })
 * @returns {{ close: Function }} Controlador del modal
 */
export function openOverlapModal(resultItem, opts = {}) {
  let fSeq = resultItem.fSeq || resultItem.fwdSeq || '';
  let rcSeq = resultItem.rcSeq || resultItem.revCompSeq || '';
  if ((!fSeq || !rcSeq) && opts.samples && opts.samples.has(resultItem.id)) {
    const sample = opts.samples.get(resultItem.id);
    const s = opts.state;
    const fTrim = sample.forward && s ? effectiveTrim(sample, 'forward', sample.forward, s) : null;
    const rTrim = sample.reverse && s ? effectiveTrim(sample, 'reverse', sample.reverse, s) : null;
    if (sample.forward && fTrim && !fTrim.discarded) {
      fSeq = slice(sample.forward, fTrim).sequence;
    }
    if (sample.reverse && rTrim && !rTrim.discarded) {
      rcSeq = reverseComplement(slice(sample.reverse, rTrim).sequence);
    }
  }

  const sampleId = resultItem.id || 'Muestra';
  const consensus = resultItem.consensus || '';
  const overlapData = buildOverlapData(fSeq, rcSeq, consensus, opts);

  let modal = null;
  modal = openPanel({
    title: (t('sanger.overlapPanelTitle') || 'Inspección de solapamiento') + ': ' + sampleId,
    extraClass: 'ql-modal-overlap',
    closeLabel: 'Cerrar',
    render: (bodyEl) => {
      const wrap = document.createElement('div');
      wrap.className = 'ql-overlap-modal-body';

      if (resultItem.method === 'stitched') {
        const note = document.createElement('p');
        note.className = 'ql-panel-note';
        note.style.cssText = 'color:var(--warning-ink);margin:0;';
        note.textContent = t('sanger.overlapMethodStitched');
        wrap.appendChild(note);
      }

      const legend = document.createElement('div');
      legend.className = 'ql-overlap-legend';
      legend.innerHTML =
        '<span class="ql-overlap-legend-item"><span class="ql-overlap-legend-box" style="background:#0284c7;"></span> ' + t('sanger.legendFwdOnly') + '</span>' +
        '<span class="ql-overlap-legend-item"><span class="ql-overlap-legend-box" style="background:#059669;"></span> ' + t('sanger.legendOverlap') + '</span>' +
        '<span class="ql-overlap-legend-item"><span class="ql-overlap-legend-box" style="background:#dc2626;"></span> ' + t('sanger.legendMismatch') + '</span>' +
        '<span class="ql-overlap-legend-item"><span class="ql-overlap-legend-box" style="background:#9333ea;"></span> ' + t('sanger.legendRevOnly') + '</span>';
      wrap.appendChild(legend);

      const mainSection = document.createElement('div');
      mainSection.className = 'ql-overlap-modal-main';
      mainSection.innerHTML = renderOverlapHTML(overlapData);
      wrap.appendChild(mainSection);

      const minimapDiv = document.createElement('div');
      minimapDiv.innerHTML = renderMinimapHTML(overlapData);
      const minimapWrap = minimapDiv.firstElementChild;
      wrap.appendChild(minimapWrap);

      const minimapCanvas = minimapWrap.querySelector('.ql-minimap-canvas');
      if (minimapCanvas) {
        drawMinimapCanvas(minimapCanvas, overlapData);
      }

      const footer = document.createElement('div');
      footer.className = 'ql-overlap-modal-footer';
      footer.innerHTML = '<span class="ql-field-help" style="margin:0;">' +
        'Total: <strong>' + (overlapData.cols ? overlapData.cols.length : 0) + ' columnas</strong> | ' +
        (t('sanger.minimapHint') || 'Clic o arrastra en el minimapa para navegar') +
        '</span>';

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'ql-btn ql-btn-sm';
      closeBtn.textContent = 'Cerrar';
      closeBtn.addEventListener('click', () => {
        if (modal && typeof modal.close === 'function') modal.close();
      });
      footer.appendChild(closeBtn);
      wrap.appendChild(footer);

      bodyEl.appendChild(wrap);

      // Elementos interactivos
      const mainContainer = mainSection.querySelector('.ql-ds-container');
      const minimapContainer = minimapWrap.querySelector('.ql-minimap-container');
      const minimapTrack = minimapWrap.querySelector('.ql-minimap-track');
      const viewportIndicator = minimapWrap.querySelector('.ql-minimap-viewport');

      function syncMainToMinimap() {
        if (!mainContainer || !minimapTrack || !viewportIndicator) return;
        const scrollW = mainContainer.scrollWidth;
        const clientW = mainContainer.clientWidth;
        const minimapW = minimapTrack.clientWidth;
        if (scrollW <= 0 || minimapW <= 0) return;

        const { scrollPct, vpWidth, left } = calculateMinimapViewport(
          mainContainer.scrollLeft,
          scrollW,
          clientW,
          minimapW
        );

        viewportIndicator.style.width = vpWidth.toFixed(1) + 'px';
        viewportIndicator.style.left = left.toFixed(1) + 'px';
        viewportIndicator.setAttribute('data-scroll-pct', scrollPct.toFixed(4));
      }

      function syncMinimapToMain(e) {
        if (!mainContainer || !minimapTrack) return;
        const rect = minimapTrack.getBoundingClientRect();
        if (rect.width <= 0) return;

        const clickX = e.clientX - rect.left;
        const { targetScrollLeft } = calculateScrollFromMinimap(
          clickX,
          rect.width,
          mainContainer.scrollWidth,
          mainContainer.clientWidth
        );

        mainContainer.scrollLeft = targetScrollLeft;
      }

      let isPointerDown = false;
      const onPointerDown = (e) => {
        isPointerDown = true;
        syncMinimapToMain(e);
      };
      const onPointerMove = (e) => {
        if (!isPointerDown) return;
        syncMinimapToMain(e);
      };
      const onPointerUp = () => {
        isPointerDown = false;
      };
      const onMainScroll = () => {
        syncMainToMinimap();
      };
      const onResize = () => {
        syncMainToMinimap();
        if (minimapCanvas) drawMinimapCanvas(minimapCanvas, overlapData);
      };

      if (mainContainer) {
        mainContainer.addEventListener('scroll', onMainScroll, { passive: true });
      }
      if (minimapContainer) {
        minimapContainer.addEventListener('pointerdown', onPointerDown);
        minimapContainer.addEventListener('click', syncMinimapToMain);
      }
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('resize', onResize, { passive: true });

      let ro = null;
      if (typeof ResizeObserver !== 'undefined' && mainContainer && minimapContainer) {
        ro = new ResizeObserver(() => syncMainToMinimap());
        ro.observe(mainContainer);
        ro.observe(minimapContainer);
      }

      // Sincronización inicial
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => syncMainToMinimap());
      } else {
        syncMainToMinimap();
      }

      // Destrucción total de listeners al cerrar el modal (prevención de fugas de memoria)
      return () => {
        if (mainContainer) {
          mainContainer.removeEventListener('scroll', onMainScroll);
        }
        if (minimapContainer) {
          minimapContainer.removeEventListener('pointerdown', onPointerDown);
          minimapContainer.removeEventListener('click', syncMinimapToMain);
        }
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('resize', onResize);
        if (ro) {
          ro.disconnect();
          ro = null;
        }
        if (typeof opts.onClose === 'function') {
          try { opts.onClose(); } catch (e) { /* noop */ }
        }
      };
    },
  });

  return modal;
}


function defaultState() {
  return {
    tab: 'entrada',
    trimMethod: 'mott', mottThreshold: 0.01, phredScore: 20, windowSize: 15, windowMinQ: 20, minLength: 50,
    fwdKeywords: '27F,FWD,FORWARD', revKeywords: '907R,1492R,REV,REVERSE',
    expectedAmplicon: '', ampliconTolerance: 150,
    selectedSampleId: '', selectedDirection: 'forward',
    manualTrim: {}, // { [sampleId]: { forward:{start,end}|null, reverse:{start,end}|null } }
    results: [], // último lote calculado: { id, method, needsReview, reason, overlapLen, matches, identity, nAmbiguous, fLen, rLen, consensus }
  };
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_STORE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const d = defaultState();
      const rawPhred = Number.isFinite(+raw.phredScore) && +raw.phredScore >= 10 && +raw.phredScore <= 60
        ? Math.round(+raw.phredScore)
        : null;
      const rawMott = Number.isFinite(+raw.mottThreshold) && +raw.mottThreshold > 0 ? +raw.mottThreshold : null;
      const phredScore = rawPhred !== null
        ? rawPhred
        : (rawMott !== null ? Math.max(10, Math.min(60, Math.round(-10 * Math.log10(rawMott)))) : d.phredScore);
      const mottThreshold = Math.pow(10, -phredScore / 10);

      return {
        tab: typeof raw.tab === 'string' ? raw.tab : d.tab,
        trimMethod: raw.trimMethod === 'window' ? 'window' : 'mott',
        mottThreshold,
        phredScore,
        windowSize: Number.isFinite(+raw.windowSize) && +raw.windowSize > 1 ? +raw.windowSize : d.windowSize,
        windowMinQ: Number.isFinite(+raw.windowMinQ) ? +raw.windowMinQ : d.windowMinQ,
        minLength: Number.isFinite(+raw.minLength) && +raw.minLength >= 10 && +raw.minLength <= 500 ? +raw.minLength : d.minLength,
        fwdKeywords: typeof raw.fwdKeywords === 'string' ? raw.fwdKeywords : d.fwdKeywords,
        revKeywords: typeof raw.revKeywords === 'string'
          ? (raw.revKeywords === '1492R,REV,REVERSE' ? d.revKeywords : raw.revKeywords)
          : d.revKeywords,
        expectedAmplicon: typeof raw.expectedAmplicon === 'string' ? raw.expectedAmplicon : d.expectedAmplicon,
        ampliconTolerance: Number.isFinite(+raw.ampliconTolerance) && +raw.ampliconTolerance >= 0 ? +raw.ampliconTolerance : d.ampliconTolerance,
        selectedSampleId: typeof raw.selectedSampleId === 'string' ? raw.selectedSampleId : '',
        selectedDirection: raw.selectedDirection === 'reverse' ? 'reverse' : 'forward',
        manualTrim: raw.manualTrim && typeof raw.manualTrim === 'object' ? raw.manualTrim : {},
        results: Array.isArray(raw.results) ? raw.results : [],
      };
    }
  } catch (e) { /* localStorage puede fallar */ }
  return defaultState();
}
function save(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* noop */ }
}

// ---------- emparejamiento por nombre de archivo ----------

// Cebadores habituales y su sentido — se reconocen solos (en cualquier
// posición del nombre: antes, en medio o después de la muestra), sin
// necesidad de configurarlos a mano. Los campos de palabras clave de abajo
// son solo para cebadores fuera de esta lista.
const KNOWN_PRIMER_DIRECTION = {
  // 16S (bacterias)
  '27F': 'forward', '8F': 'forward', '338F': 'forward', '515F': 'forward', '519F': 'forward',
  '785F': 'forward', '805F': 'forward', '907F': 'forward',
  '337R': 'reverse', '519R': 'reverse', '785R': 'reverse', '805R': 'reverse',
  '907R': 'reverse', '1100R': 'reverse', '1492R': 'reverse',
  // ITS (hongos)
  ITS1: 'forward', ITS1F: 'forward', ITS3: 'forward', ITS5: 'forward',
  ITS2: 'reverse', ITS4: 'reverse', ITS4B: 'reverse',
  // clonación / vectores
  M13F: 'forward', M13FWD: 'forward', T7: 'forward',
  M13R: 'reverse', M13REV: 'reverse', T3: 'reverse',
};

function baseName(filename) { return String(filename).replace(/\.[^./\\]+$/, ''); }
function splitKeywords(s) { return String(s || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean); }

/** Divide el nombre en tokens conservando los separadores (para poder
 *  reconstruir el id de muestra sin perder puntos, p. ej. "56.1"). Las
 *  posiciones pares son contenido; las impares, el separador que sigue. */
function tokenizeKeepSeps(base) { return base.split(/([-_.\s]+)/); }

/** Busca el token que es un cebador — cruza tanto el diccionario estático
 *  KNOWN_PRIMER_DIRECTION (prioridad absoluta para cebadores estándar) como
 *  las palabras clave configuradas a mano por el usuario (fwdKw/revKw). */
function findPrimerToken(tokens, fwdKw, revKw) {
  // 1. Coincidencia exacta contra catálogo estático (insensible a mayúsculas)
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    const upper = tok.trim().toUpperCase();
    if (KNOWN_PRIMER_DIRECTION[upper]) {
      return { direction: KNOWN_PRIMER_DIRECTION[upper], tokenIndex: i };
    }
  }
  // 2. Coincidencia exacta contra palabras clave de la interfaz
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    const upper = tok.trim().toUpperCase();
    if (fwdKw.includes(upper)) return { direction: 'forward', tokenIndex: i };
    if (revKw.includes(upper)) return { direction: 'reverse', tokenIndex: i };
  }
  // 3. Coincidencia por inclusión contra palabras clave de la interfaz
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    const upper = tok.trim().toUpperCase();
    const isF = fwdKw.some((k) => upper.includes(k));
    const isR = revKw.some((k) => upper.includes(k));
    if (isF && !isR) return { direction: 'forward', tokenIndex: i };
    if (isR && !isF) return { direction: 'reverse', tokenIndex: i };
  }
  // 4. Coincidencia por inclusión dentro del token contra catálogo estático
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    const upper = tok.trim().toUpperCase();
    for (const [primer, dir] of Object.entries(KNOWN_PRIMER_DIRECTION)) {
      if (upper.includes(primer)) {
        return { direction: dir, tokenIndex: i, primerSub: primer };
      }
    }
  }
  return null;
}

/** A partir del nombre de archivo, adivina a la vez el id de muestra (todo
 *  menos el cebador) y el sentido (forward/reverse), cruzando fwdKw, revKw y
 *  KNOWN_PRIMER_DIRECTION como respaldo absoluto. */
function identifyRead(filename, fwdKw, revKw) {
  const base = baseName(filename);
  const tokens = tokenizeKeepSeps(base);
  const hit = findPrimerToken(tokens, fwdKw, revKw);
  if (!hit) {
    // Respaldo global sobre el nombre base completo si no se aisló por separadores
    const upper = base.toUpperCase();
    for (const [primer, dir] of Object.entries(KNOWN_PRIMER_DIRECTION)) {
      if (upper.includes(primer)) {
        const re = new RegExp('([-_.]?)' + primer + '([-_.]?)', 'i');
        const cleaned = base.replace(re, (m, p1, p2) => (p1 && p2 ? p1 : ''));
        const sampleId = cleaned.replace(/^[-_.\s]+|[-_.\s]+$/g, '').trim() || base;
        return { sampleId, direction: dir };
      }
    }
    for (const k of fwdKw) {
      if (upper.includes(k)) {
        const re = new RegExp('([-_.]?)' + k + '([-_.]?)', 'i');
        const cleaned = base.replace(re, (m, p1, p2) => (p1 && p2 ? p1 : ''));
        const sampleId = cleaned.replace(/^[-_.\s]+|[-_.\s]+$/g, '').trim() || base;
        return { sampleId, direction: 'forward' };
      }
    }
    for (const k of revKw) {
      if (upper.includes(k)) {
        const re = new RegExp('([-_.]?)' + k + '([-_.]?)', 'i');
        const cleaned = base.replace(re, (m, p1, p2) => (p1 && p2 ? p1 : ''));
        const sampleId = cleaned.replace(/^[-_.\s]+|[-_.\s]+$/g, '').trim() || base;
        return { sampleId, direction: 'reverse' };
      }
    }
    return { sampleId: base, direction: null };
  }

  const rest = tokens.slice();
  if (hit.primerSub && rest[hit.tokenIndex] && rest[hit.tokenIndex].length > hit.primerSub.length) {
    const re = new RegExp('([-_.]?)' + hit.primerSub + '([-_.]?)', 'i');
    rest[hit.tokenIndex] = rest[hit.tokenIndex].replace(re, (m, p1, p2) => (p1 && p2 ? p1 : '')).trim();
  } else {
    rest.splice(hit.tokenIndex, 1);
    if (rest[hit.tokenIndex] !== undefined && /^[-_.\s]+$/.test(rest[hit.tokenIndex])) rest.splice(hit.tokenIndex, 1);
    else if (hit.tokenIndex > 0 && /^[-_.\s]+$/.test(rest[hit.tokenIndex - 1])) rest.splice(hit.tokenIndex - 1, 1);
  }
  const sampleId = rest.join('').trim() || base;
  return { sampleId, direction: hit.direction };
}

// ---------- lectura de archivos ----------

function parseSingleFastq(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i][0] === '@' && lines[i + 2] && lines[i + 2][0] === '+') {
      const seq = lines[i + 1].trim().toUpperCase();
      const qualLine = (lines[i + 3] || '');
      const qual = new Uint8Array(seq.length);
      for (let k = 0; k < seq.length; k++) qual[k] = Math.max(0, (qualLine.charCodeAt(k) || 33) - 33);
      return { sequence: seq, quality: qual };
    }
  }
  throw new Error(t('sanger.errBadFastq'));
}
function parseSingleFasta(text) {
  let seq = '';
  for (const line of text.split(/\r?\n/)) { if (line && line[0] !== '>') seq += line.trim().toUpperCase(); }
  if (!seq) throw new Error(t('sanger.errBadFasta'));
  return { sequence: seq, quality: null };
}

async function readReadFile(file) {
  const name = file.name;
  if (/\.ab1$/i.test(name)) {
    const buf = await file.arrayBuffer();
    const r = parseAb1(buf);
    return { fileName: name, sequence: r.sequence, quality: r.quality, trace: r.trace, peakLocations: r.peakLocations, traceIsRaw: r.traceIsRaw };
  }
  if (/\.(fastq|fq)$/i.test(name)) {
    const rec = parseSingleFastq(await file.text());
    return { fileName: name, sequence: rec.sequence, quality: rec.quality, trace: null, peakLocations: null };
  }
  if (/\.(fasta|fa)$/i.test(name)) {
    const rec = parseSingleFasta(await file.text());
    return { fileName: name, sequence: rec.sequence, quality: rec.quality, trace: null, peakLocations: null };
  }
  throw new Error(t('sanger.errUnknownExt', { name }));
}

// ---------- recorte + solapamiento sobre las lecturas cargadas ----------

function autoTrimOf(read, s) {
  if (!read) return null;
  const pThreshold = Number.isFinite(+s.phredScore)
    ? Math.pow(10, -s.phredScore / 10)
    : (Number.isFinite(+s.mottThreshold) && +s.mottThreshold > 0 ? +s.mottThreshold : 0.01);
  return s.trimMethod === 'window'
    ? trimRead(read.quality, { method: 'window', windowSize: s.windowSize, minQuality: s.windowMinQ, minLength: s.minLength })
    : trimRead(read.quality, { method: 'mott', errorProbThreshold: pThreshold, minLength: s.minLength });
}
function effectiveTrim(sample, direction, read, s) {
  const auto = autoTrimOf(read, s);
  if (!auto) return null;
  const manual = s.manualTrim[sample.id] && s.manualTrim[sample.id][direction];
  if (manual && Number.isFinite(manual.start) && Number.isFinite(manual.end) && manual.end > manual.start) {
    return { start: manual.start, end: manual.end, length: manual.end - manual.start, discarded: (manual.end - manual.start) < s.minLength, manual: true };
  }
  return auto;
}
function slice(read, trim) {
  if (!read || !trim) return null;
  return { sequence: read.sequence.slice(trim.start, trim.end), quality: read.quality ? read.quality.slice(trim.start, trim.end) : null };
}

function computeResult(sample, s) {
  const fTrim = sample.forward ? effectiveTrim(sample, 'forward', sample.forward, s) : null;
  const rTrim = sample.reverse ? effectiveTrim(sample, 'reverse', sample.reverse, s) : null;
  const fOk = sample.forward && fTrim && !fTrim.discarded;
  const rOk = sample.reverse && rTrim && !rTrim.discarded;
  const base = { id: sample.id, fTrim, rTrim, fLen: fOk ? fTrim.length : 0, rLen: rOk ? rTrim.length : 0 };

  if (fOk && rOk) {
    const f = slice(sample.forward, fTrim);
    const r = slice(sample.reverse, rTrim);
    const expectedAmpliconLen = parseFloat(s.expectedAmplicon) > 0 ? parseFloat(s.expectedAmplicon) : null;
    const res = mergeReads(f, r, { expectedAmpliconLen, ampliconTolerance: s.ampliconTolerance });
    return { ...base, ...res, fSeq: f.sequence, rcSeq: reverseComplement(r.sequence) };
  }
  if (fOk) {
    const f = slice(sample.forward, fTrim);
    return { ...base, method: 'forward-only', needsReview: false, reason: 'no_reverse', consensus: f.sequence, overlapLen: 0, matches: 0, identity: 0, nAmbiguous: 0, anchorSeedHits: 0 };
  }
  if (rOk) {
    const r = slice(sample.reverse, rTrim);
    return { ...base, method: 'reverse-only', needsReview: false, reason: 'no_forward', consensus: reverseComplement(r.sequence), overlapLen: 0, matches: 0, identity: 0, nAmbiguous: 0, anchorSeedHits: 0 };
  }
  return { ...base, method: 'none', needsReview: true, reason: (sample.forward || sample.reverse) ? 'discarded_short' : 'no_reads', consensus: '', overlapLen: 0, matches: 0, identity: 0, nAmbiguous: 0, anchorSeedHits: 0 };
}

const REASON_KEY = {
  ok: 'sanger.reasonOk', no_anchor: 'sanger.reasonNoAnchor', overlap_too_short: 'sanger.reasonOverlapShort',
  low_identity: 'sanger.reasonLowIdentity', implausible_length: 'sanger.reasonImplausible',
  no_reverse: 'sanger.reasonNoReverse', no_forward: 'sanger.reasonNoForward',
  discarded_short: 'sanger.reasonDiscarded', no_reads: 'sanger.reasonNoReads',
};
const METHOD_KEY = {
  merged: 'sanger.methodMerged', stitched: 'sanger.methodStitched',
  'forward-only': 'sanger.methodForwardOnly', 'reverse-only': 'sanger.methodReverseOnly', none: 'sanger.methodNone',
};

function sendConsensusToPrimers(sampleId, consensus) {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(PRIMERS_STORE_KEY) || localStorage.getItem(LEGACY_PRIMERS_STORE_KEY) || 'null'); } catch (e) { raw = null; }
  if (!raw || !Array.isArray(raw.primers)) {
    raw = {
      tab: 'template', primers: [{ id: 'pr1', name: '', raw: '' }, { id: 'pr2', name: '', raw: '' }],
      salt: 50, conc: 500, templateText: '', templateTol: 1, templateA: '', templateB: '',
      covRefText: '', covTaxText: '', covTol: 1, covA: '', covB: '', covRankIdx: 6, batchPairs: [],
      designText: '', designMode: 'qpcr', designOverrides: { standard: {}, qpcr: {} }, designTargetStart: '', designTargetEnd: '',
    };
  }
  raw.tab = 'template';
  raw.templateText = '>' + sampleId + '\n' + consensus + '\n';
  try { localStorage.setItem(PRIMERS_STORE_KEY, JSON.stringify(raw)); } catch (e) { /* noop */ }
  location.hash = '#/primers';
}

/**
 * URL de la "Common URL API" de NCBI BLAST (CMD=Put) que lanza una búsqueda
 * blastn contra `nt` con la secuencia ya cargada — verificado a mano (no
 * solo documentado) que una petición GET a esta URL con un consenso Sanger
 * real (~1400 nt) devuelve la página de espera con un RID asignado, no una
 * página en blanco. La identificación en sí (correr BLAST) queda fuera de
 * la app: esto es solo el puente hacia NCBI.
 */
function ncbiBlastUrl(sequence) {
  return 'https://blast.ncbi.nlm.nih.gov/Blast.cgi?CMD=Put&PROGRAM=blastn&DATABASE=nt&QUERY=' + encodeURIComponent(sequence);
}

/**
 * Envía un lote de secuencias consenso a NCBI BLAST utilizando la técnica
 * del formulario POST oculto (hidden form POST). Abre la interfaz web de
 * BLAST en una pestaña nueva con el multi-FASTA pre-cargado en el campo QUERY,
 * esquivando las restricciones de CORS del navegador y los límites de longitud
 * de URL por GET.
 */
function sendBatchToNCBI(consensusList) {
  if (!Array.isArray(consensusList) || !consensusList.length) return;
  const valid = consensusList.filter((item) => item && (item.consensus || item.sequence));
  if (!valid.length) return;

  const multiFasta = valid
    .map((item) => {
      const name = item.id || item.sampleId || item.name || 'secuencia';
      const seq = String(item.consensus || item.sequence || '').trim();
      return `>${name}\n${seq}`;
    })
    .join('\n') + '\n';

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi';
  form.target = '_blank';
  form.style.display = 'none';

  const fields = {
    PROGRAM: 'blastn',
    PAGE_TYPE: 'BlastSearch',
    LINK_LOC: 'blasthome',
    QUERY: multiFasta,
  };

  for (const [key, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

// ---------- visor de cromatograma ----------

export function clientXToSvgX(svg, clientX) {
  const rect = svg && svg.getBoundingClientRect ? svg.getBoundingClientRect() : { left: 0, width: 0 };
  const vb = svg && svg.viewBox ? svg.viewBox.baseVal : null;
  const vbW = (vb && vb.width) || parseFloat(svg && svg.style && svg.style.width) || 1000;
  const vbX = (vb && vb.x) || 0;
  if (!rect || !rect.width) return vbX + (Number.isFinite(clientX) ? clientX : 0);
  return vbX + (clientX - rect.left) * (vbW / rect.width);
}

export function baseIndexAtX(x, nBases, xOfBase) {
  let lo = 0, hi = Math.max(0, nBases - 1);
  while (lo < hi) { const mid = (lo + hi) >> 1; if (xOfBase(mid) < x) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * Encuentra el índice del pico (base) más cercano a la coordenada X dada.
 * @param {number} x
 * @param {number} nBases
 * @param {Function} xOfBase
 * @returns {number}
 */
export function nearestBaseIndexAtX(x, nBases, xOfBase) {
  if (!nBases || nBases <= 0) return -1;
  let lo = 0, hi = nBases - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xOfBase(mid) < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(xOfBase(lo - 1) - x) < Math.abs(xOfBase(lo) - x)) {
    return lo - 1;
  }
  return lo;
}

/**
 * Cálculo de Confianza:
 * Por cada valor Phred (Q), la probabilidad de error es E = 10^(-Q/10).
 * El porcentaje de confianza es (1 - E) * 100.
 * @param {number} q
 * @returns {number}
 */
export function phredConfidence(q) {
  if (!Number.isFinite(q) || q < 0) return 0;
  const e = Math.pow(10, -q / 10);
  return (1 - e) * 100;
}

/**
 * Formato de confianza: ej. 99.9%
 * @param {number|null} conf
 * @returns {string}
 */
export function formatConfidence(conf) {
  if (!Number.isFinite(conf)) return '—';
  return conf.toFixed(1) + '%';
}

/**
 * Calcula entre 3 y 4 ticks distribuidos limpiamente para el eje Y de intensidad (RFU).
 * @param {number} maxVal
 * @returns {number[]}
 */
export function getIntensityTicks(maxVal) {
  if (!Number.isFinite(maxVal) || maxVal <= 0) return [0];
  let step = 1000;
  if (maxVal <= 100) step = 25;
  else if (maxVal <= 300) step = 100;
  else if (maxVal <= 700) step = 200;
  else if (maxVal <= 1600) step = 500;
  else if (maxVal <= 3500) step = 1000;
  else step = Math.max(1000, Math.pow(10, Math.floor(Math.log10(maxVal / 2))));

  const ticks = [0];
  for (let v = step; v < maxVal; v += step) {
    ticks.push(v);
  }
  if (ticks.length < 3) {
    ticks.push(Math.round(maxVal));
  } else if (ticks.length > 5) {
    return [0, Math.round(maxVal / 3), Math.round((2 * maxVal) / 3), Math.round(maxVal)];
  }
  return ticks;
}

/**
 * Calcula marcas numéricas para el eje X de posición (pb) adaptadas al espaciado.
 * @param {number} nBases
 * @param {number} pxPerBase
 * @returns {number[]}
 */
export function getPositionTicks(nBases, pxPerBase) {
  if (!nBases || nBases <= 0) return [];
  let step = 100;
  if (pxPerBase * 50 >= 150) step = 50;
  else if (pxPerBase * 100 >= 150) step = 100;
  else if (pxPerBase * 200 >= 150) step = 200;
  else step = 500;

  const ticks = [1];
  for (let p = step; p < nBases; p += step) {
    ticks.push(p);
  }
  return ticks;
}

/**
 * Dibuja el cromatograma (4 trazas A/C/G/T + calidad por base) y los dos
 * marcadores de recorte arrastrables. Devuelve un manejador para engancharlo
 * al arrastre y a los inputs numéricos de respaldo (accesibles por teclado).
 */
export function drawChromatogram(svg, read, trimRange) {
  svg.innerHTML = '';
  const nBases = read.sequence.length;
  const hasTrace = !!read.trace;
  const pxPerBase = hasTrace ? 7 : 5;
  const W = Math.max(600, nBases * pxPerBase);
  const marginL = 64, marginR = 16, marginT = 26, traceH = hasTrace ? 150 : 0, gap = hasTrace ? 18 : 0, qualH = 70;
  const qualBase = marginT + traceH + gap + qualH;
  const marginB = 44;
  const H = qualBase + marginB;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  // ancho en px FIJO, por encima del reset global `svg { max-width:100% }`
  // (css/base.css, pensado para que ninguna figura desborde en móvil): con
  // lecturas de cientos/miles de nt, encoger todo el viewBox al ancho del
  // contenedor aplastaría las 4 trazas en una sola banda ilegible. En su
  // lugar, el contenedor (chartWrap) hace scroll horizontal — el mismo
  // patrón ya permitido para tablas/código anchos, aquí para un cromatograma.
  svg.style.width = W + 'px';
  svg.style.maxWidth = 'none';
  svg.style.height = H + 'px';
  svg.style.display = 'block';
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', t('sanger.chromatogramAlt'));

  const xOfBase = (bi) => {
    const clamped = Math.max(0, Math.min(nBases - 1, bi));
    if (hasTrace && read.peakLocations) {
      const traceMax = Math.max(1, read.trace.A.length - 1);
      return marginL + (Math.max(0, Math.min(traceMax, read.peakLocations[clamped])) / traceMax) * (W - marginL - marginR);
    }
    return marginL + (clamped / Math.max(1, nBases - 1)) * (W - marginL - marginR);
  };

  let maxIntensity = 1;
  if (hasTrace) {
    const traceLen = read.trace.A.length;
    for (const b of ['A', 'C', 'G', 'T']) {
      const arr = read.trace[b];
      if (arr) {
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] > maxIntensity) maxIntensity = arr[i];
        }
      }
    }
    const yOf = (v) => marginT + traceH - (v / maxIntensity) * traceH;
    const xOfTraceIdx = (ti) => marginL + (ti / Math.max(1, traceLen - 1)) * (W - marginL - marginR);
    const step = Math.max(1, Math.floor(traceLen / (W * 1.5)));
    ['A', 'C', 'G', 'T'].forEach((b) => {
      const pts = [];
      for (let ti = 0; ti < traceLen; ti += step) pts.push(xOfTraceIdx(ti).toFixed(1) + ',' + yOf(read.trace[b][ti]).toFixed(1));
      svg.appendChild(svgEl('polyline', {
        points: pts.join(' '), fill: 'none', stroke: BASE_COLOR[b], 'stroke-width': 1.1, 'data-ce-role': 'line',
        'data-ce-series-stroke': 'base-' + b,
      }));
    });
  }

  // calidad por base (área)
  const qualScale = 60; // techo visual (Phred 60 = tope de la barra, sube a más)
  if (read.quality) {
    let d = 'M' + xOfBase(0).toFixed(1) + ',' + qualBase;
    for (let bi = 0; bi < nBases; bi++) {
      const y = qualBase - (Math.min(qualScale, read.quality[bi]) / qualScale) * qualH;
      d += ' L' + xOfBase(bi).toFixed(1) + ',' + y.toFixed(1);
    }
    d += ' L' + xOfBase(nBases - 1).toFixed(1) + ',' + qualBase + ' Z';
    // calidad Phred = dato: gris de datos (--neutral), no el azul de marca
    svg.appendChild(svgEl('path', { d, fill: 'var(--neutral)', opacity: '0.4', stroke: 'var(--neutral)', 'stroke-width': '1' }));
  }

  // Ejes de coordenadas (líneas de referencia fijas)
  if (hasTrace) {
    svg.appendChild(svgEl('line', {
      x1: marginL, x2: marginL, y1: marginT, y2: marginT + traceH,
      stroke: 'var(--border)', 'stroke-width': '1', class: 'ql-axis-line',
    }));
  }
  svg.appendChild(svgEl('line', {
    x1: marginL, x2: marginL, y1: qualBase - qualH, y2: qualBase,
    stroke: 'var(--border)', 'stroke-width': '1', class: 'ql-axis-line',
  }));
  svg.appendChild(svgEl('line', {
    x1: marginL, x2: W - marginR, y1: qualBase, y2: qualBase,
    stroke: 'var(--border)', 'stroke-width': '1', class: 'ql-axis-line',
  }));

  // Etiquetas descriptivas y unidades físicas en los ejes
  const labels = {};
  if (hasTrace) {
    const yTraceCenter = marginT + traceH / 2;
    const xTrace = 16;
    const labelIntensity = svgEl('text', {
      x: xTrace,
      y: yTraceCenter,
      class: 'ql-axis-label ql-chroma-axis-label',
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      transform: 'rotate(-90 ' + xTrace + ' ' + yTraceCenter + ')',
      'data-axis': 'y-trace',
    });
    const iKey = t('sanger.axisIntensity');
    labelIntensity.textContent = (iKey && iKey !== 'sanger.axisIntensity') ? iKey : 'Intensidad (RFU)';
    svg.appendChild(labelIntensity);
    labels.intensity = labelIntensity;

    // Escala numérica (ticks) del eje Y superior (Intensidad RFU)
    const intensityTicks = getIntensityTicks(maxIntensity);
    intensityTicks.forEach((v) => {
      const y = marginT + traceH - (v / maxIntensity) * traceH;
      svg.appendChild(svgEl('line', {
        x1: marginL - 5, x2: marginL, y1: y.toFixed(1), y2: y.toFixed(1),
        class: 'ql-axis-tick-line', stroke: 'var(--border)', 'stroke-width': '1',
      }));
      const tNode = svgEl('text', {
        x: marginL - 8, y: y.toFixed(1),
        class: 'ql-axis-tick-label',
        'text-anchor': 'end', 'dominant-baseline': 'central',
        'data-tick-y-trace': String(v),
      });
      tNode.textContent = String(v);
      svg.appendChild(tNode);
    });
  }

  const yQualCenter = marginT + traceH + gap + qualH / 2;
  const xQual = 16;
  const labelQuality = svgEl('text', {
    x: xQual,
    y: yQualCenter,
    class: 'ql-axis-label ql-chroma-axis-label',
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    transform: 'rotate(-90 ' + xQual + ' ' + yQualCenter + ')',
    'data-axis': 'y-qual',
  });
  const qKey = t('sanger.axisQuality');
  labelQuality.textContent = (qKey && qKey !== 'sanger.axisQuality') ? qKey : 'Calidad (Phred Q)';
  svg.appendChild(labelQuality);
  labels.quality = labelQuality;

  // Escala numérica (ticks fijos) del eje Y inferior: 0, 20, 40, 60
  const qualTicks = [0, 20, 40, 60];
  qualTicks.forEach((q) => {
    const y = qualBase - (q / qualScale) * qualH;
    svg.appendChild(svgEl('line', {
      x1: marginL - 5, x2: marginL, y1: y.toFixed(1), y2: y.toFixed(1),
      class: 'ql-axis-tick-line', stroke: 'var(--border)', 'stroke-width': '1',
    }));
    const tNode = svgEl('text', {
      x: marginL - 8, y: y.toFixed(1),
      class: 'ql-axis-tick-label',
      'text-anchor': 'end', 'dominant-baseline': 'central',
      'data-tick-y-qual': String(q),
    });
    tNode.textContent = String(q);
    svg.appendChild(tNode);
  });

  // Escala numérica (ticks) del eje X (Posición pb)
  const posTicks = getPositionTicks(nBases, pxPerBase);
  posTicks.forEach((pos) => {
    const bx = xOfBase(pos - 1);
    svg.appendChild(svgEl('line', {
      x1: bx.toFixed(1), x2: bx.toFixed(1), y1: qualBase, y2: (qualBase + 5).toFixed(1),
      class: 'ql-axis-tick-line', stroke: 'var(--border)', 'stroke-width': '1',
    }));
    const tNode = svgEl('text', {
      x: bx.toFixed(1), y: (qualBase + 16).toFixed(1),
      class: 'ql-axis-tick-label',
      'text-anchor': 'middle', 'dominant-baseline': 'central',
      'data-tick-x-pos': String(pos),
    });
    tNode.textContent = String(pos);
    svg.appendChild(tNode);
  });

  const xMid = marginL + (W - marginL - marginR) / 2;
  const yPos = qualBase + 32;
  const labelPosition = svgEl('text', {
    x: xMid.toFixed(1),
    y: yPos.toFixed(1),
    class: 'ql-axis-label ql-chroma-axis-label',
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'data-axis': 'x-pos',
  });
  const pKey = t('sanger.axisPosition');
  labelPosition.textContent = (pKey && pKey !== 'sanger.axisPosition') ? pKey : 'Posición (pb)';
  svg.appendChild(labelPosition);
  labels.position = labelPosition;

  // línea de guía interactiva (crosshair)
  const guideLine = svgEl('line', {
    class: 'ql-chroma-crosshair',
    x1: 0, x2: 0,
    y1: marginT - 14,
    y2: qualBase + 5,
    stroke: 'var(--ink-muted, #71767b)',
    'stroke-width': '1',
    'stroke-dasharray': '3 2',
    style: 'display:none;pointer-events:none;',
  });
  guideLine.style.display = 'none';
  svg.appendChild(guideLine);

  const handles = {};
  ['start', 'end'].forEach((which) => {
    const bi = which === 'start' ? trimRange.start : Math.max(0, trimRange.end - 1);
    const x = xOfBase(bi);
    const g = svgEl('g', {
      'data-trim': which, style: 'cursor:ew-resize', tabindex: '0', role: 'slider',
      'aria-label': t('sanger.trimHandle' + (which === 'start' ? 'Start' : 'End')),
      'aria-valuemin': '0', 'aria-valuemax': String(nBases),
      'aria-valuenow': String(which === 'start' ? trimRange.start : trimRange.end),
    });
    g.appendChild(svgEl('line', { x1: x, x2: x, y1: marginT - 14, y2: qualBase + 5, stroke: which === 'start' ? 'var(--critical)' : 'var(--accent)', 'stroke-width': '2', 'stroke-dasharray': '5 3' }));
    g.appendChild(svgEl('circle', { cx: x, cy: marginT - 14, r: '8', fill: which === 'start' ? 'var(--critical)' : 'var(--accent)' }));
    svg.appendChild(g);
    handles[which] = g;
  });

  return { xOfBase, handles, W, H, nBases, guideLine, labels };
}

/**
 * Añade interactividad (tooltip y crosshair) al cromatograma.
 * Eventos: mousemove, mouseleave, mouseenter al contenedor o SVG.
 * @param {object} cfg
 * @param {SVGSVGElement} cfg.svg
 * @param {HTMLElement} [cfg.chartWrap]
 * @param {object} cfg.read
 * @param {Function} cfg.xOfBase
 * @param {number} cfg.nBases
 * @param {SVGLineElement} [cfg.guideLine]
 * @param {Function} [cfg.isDragging]
 * @returns {{ tooltip: HTMLElement, guideLine: SVGLineElement, update: Function, hide: Function, destroy: Function }}
 */
export function attachChromatogramTooltip(cfg) {
  const {
    svg,
    chartWrap = svg && svg.parentElement,
    read,
    xOfBase,
    nBases = (read && read.sequence ? read.sequence.length : 0),
    isDragging = () => false,
  } = cfg;

  if (!svg) return null;

  let guideLine = cfg.guideLine || svg.querySelector('.ql-chroma-crosshair');
  if (!guideLine) {
    guideLine = svgEl('line', {
      class: 'ql-chroma-crosshair',
      x1: 0, x2: 0, y1: 12, y2: 280,
      stroke: 'var(--ink-muted, #71767b)',
      'stroke-width': '1',
      'stroke-dasharray': '3 2',
      style: 'display:none;pointer-events:none;',
    });
    guideLine.style.display = 'none';
    svg.appendChild(guideLine);
  }
  guideLine.style.display = 'none';

  let tooltip = chartWrap ? chartWrap.querySelector('.ql-chroma-tooltip') : null;
  if (!tooltip && chartWrap) {
    tooltip = document.createElement('div');
    tooltip.className = 'ql-chroma-tooltip';
    tooltip.style.display = 'none';
    chartWrap.appendChild(tooltip);
  }

  function hide() {
    if (tooltip) tooltip.style.display = 'none';
    if (guideLine) guideLine.style.display = 'none';
  }

  function update(e) {
    if (isDragging()) {
      hide();
      return;
    }
    if (!read || !read.sequence || nBases <= 0) {
      hide();
      return;
    }

    const svgX = clientXToSvgX(svg, e.clientX);
    const bi = nearestBaseIndexAtX(svgX, nBases, xOfBase);
    if (bi < 0 || bi >= nBases) {
      hide();
      return;
    }

    const base = (read.sequence[bi] || '—').toUpperCase();
    const q = (read.quality && Number.isFinite(read.quality[bi])) ? read.quality[bi] : null;
    const conf = q != null ? phredConfidence(q) : null;
    const qStr = q != null ? String(q) : '—';
    const confStr = formatConfidence(conf);

    if (tooltip) {
      tooltip.textContent = `Base: ${base} | Phred: ${qStr} | Confianza: ${confStr}`;
      tooltip.style.display = 'block';

      if (chartWrap) {
        const wrapRect = chartWrap.getBoundingClientRect ? chartWrap.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 200 };
        const scrollLeft = chartWrap.scrollLeft || 0;
        const scrollTop = chartWrap.scrollTop || 0;
        const clientWidth = chartWrap.clientWidth || 600;

        const clientX = Number.isFinite(e.clientX) ? e.clientX : (wrapRect.left || 0) + (xOfBase ? xOfBase(bi) : 0);
        const clientY = Number.isFinite(e.clientY) ? e.clientY : (wrapRect.top || 0) + 50;

        const mouseX = clientX - (wrapRect.left || 0) + scrollLeft;
        const mouseY = clientY - (wrapRect.top || 0) + scrollTop;

        const ttWidth = tooltip.offsetWidth || 180;
        const ttHeight = tooltip.offsetHeight || 28;

        let left = mouseX + 12;
        const clientXRel = clientX - (wrapRect.left || 0);
        if (clientXRel + 12 + ttWidth > clientWidth) {
          left = mouseX - ttWidth - 12;
        }
        if (left < scrollLeft + 4) {
          left = scrollLeft + 4;
        }

        let top = mouseY - ttHeight - 8;
        const clientYRel = clientY - (wrapRect.top || 0);
        if (clientYRel - ttHeight - 8 < 0) {
          top = mouseY + 14;
        }

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
      }
    }

    if (guideLine && typeof xOfBase === 'function') {
      const peakX = xOfBase(bi);
      guideLine.setAttribute('x1', peakX.toFixed(1));
      guideLine.setAttribute('x2', peakX.toFixed(1));
      guideLine.style.display = '';
    }
  }

  const onMouseMove = (e) => update(e);
  const onMouseEnter = (e) => update(e);
  const onMouseLeave = () => hide();
  const onScroll = () => hide();

  svg.addEventListener('mousemove', onMouseMove);
  svg.addEventListener('mouseenter', onMouseEnter);
  svg.addEventListener('mouseleave', onMouseLeave);

  if (chartWrap) {
    chartWrap.addEventListener('mousemove', onMouseMove);
    chartWrap.addEventListener('mouseenter', onMouseEnter);
    chartWrap.addEventListener('mouseleave', onMouseLeave);
    chartWrap.addEventListener('scroll', onScroll, { passive: true });
  }

  function destroy() {
    svg.removeEventListener('mousemove', onMouseMove);
    svg.removeEventListener('mouseenter', onMouseEnter);
    svg.removeEventListener('mouseleave', onMouseLeave);
    if (chartWrap) {
      chartWrap.removeEventListener('mousemove', onMouseMove);
      chartWrap.removeEventListener('mouseenter', onMouseEnter);
      chartWrap.removeEventListener('mouseleave', onMouseLeave);
      chartWrap.removeEventListener('scroll', onScroll);
      if (tooltip && tooltip.parentNode === chartWrap) {
        chartWrap.removeChild(tooltip);
      }
    }
    if (guideLine && guideLine.parentNode === svg) {
      svg.removeChild(guideLine);
    }
  }

  return {
    tooltip,
    guideLine,
    update,
    hide,
    destroy,
  };
}

// ---------- render ----------

export function render(container) {
  const s = load();
  const samples = new Map(); // id -> { id, forward: ReadData|null, reverse: ReadData|null }
  const pending = []; // archivos sin dirección detectable: { fileKey, read, fileName, id, direction }
  let nextPendingKey = 1;
  let stopActiveDrag = null; // si el usuario navega fuera a mitad de un arrastre, lo suelta el cleanup final
  let trimDebounceTimer = null; // temporizador de debounce para controles de recorte interactivo
  let editor = null;
  let wasEditing = false;
  let chromaTooltip = null;

  function sampleList() { return [...samples.values()].sort((a, b) => a.id.localeCompare(b.id)); }

  function recomputeResults() {
    s.results = sampleList().map((sample) => {
      const r = computeResult(sample, s);
      return {
        id: r.id, method: r.method, needsReview: r.needsReview, reason: r.reason,
        overlapLen: r.overlapLen, matches: r.matches, identity: r.identity, nAmbiguous: r.nAmbiguous,
        fLen: r.fLen, rLen: r.rLen, consensus: r.consensus,
        fSeq: r.fSeq || '', rcSeq: r.rcSeq || '',
      };
    });
  }

  function upsertRead(id, direction, read) {
    if (!samples.has(id)) samples.set(id, { id, forward: null, reverse: null });
    samples.get(id)[direction] = read;
  }

  /** Expande cualquier .zip de la lista a sus .ab1/.fastq/.fq/.fasta/.fa
   *  internos (envueltos como pseudo-File con .name/.arrayBuffer()/.text());
   *  el resto de archivos pasa tal cual. */
  async function expandZips(fileList) {
    const out = [];
    for (const file of fileList) {
      if (!/\.zip$/i.test(file.name)) { out.push(file); continue; }
      try {
        const buf = await file.arrayBuffer();
        const entries = listZipEntries(buf).filter((e) => (
          /\.(ab1|fastq|fq|fasta|fa)$/i.test(e.name)
          && !e.name.endsWith('/')
          && !/(^|\/)__MACOSX\//.test(e.name)
          && !/(^|\/)\./.test(e.name.split('/').pop())
        ));
        if (!entries.length) {
          pending.push({ fileKey: 'err' + (nextPendingKey++), error: t('sanger.errZipEmpty', { name: file.name }), fileName: file.name });
          continue;
        }
        for (const entry of entries) {
          const bytes = await readZipEntry(buf, entry);
          const shortName = entry.name.split('/').pop();
          out.push({
            name: shortName,
            arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            text: async () => new TextDecoder('utf-8').decode(bytes),
          });
        }
      } catch (err) {
        pending.push({ fileKey: 'err' + (nextPendingKey++), error: (err && err.message) || String(err), fileName: file.name });
      }
    }
    return out;
  }

  async function handleFiles(fileList) {
    fileList = await expandZips(fileList);
    const fwdKw = splitKeywords(s.fwdKeywords), revKw = splitKeywords(s.revKeywords);
    for (const file of fileList) {
      let read;
      try { read = await readReadFile(file); } catch (err) { pending.push({ fileKey: 'err' + (nextPendingKey++), error: (err && err.message) || String(err), fileName: file.name }); continue; }
      const { sampleId: id, direction } = identifyRead(file.name, fwdKw, revKw);
      if (direction) upsertRead(id, direction, read);
      else pending.push({ fileKey: 'p' + (nextPendingKey++), read, fileName: file.name, id, direction: 'forward' });
    }
    recomputeResults();
    save(s);
    paint();
  }

  async function loadExample(urls) {
    const files = await Promise.all(urls.map(async (u) => {
      const resp = await fetch(u);
      const buf = await resp.arrayBuffer();
      return { name: u.split('/').pop(), arrayBuffer: async () => buf };
    }));
    await handleFiles(files);
  }

  function paint() {
    if (trimDebounceTimer) { clearTimeout(trimDebounceTimer); trimDebounceTimer = null; }
    wasEditing = editor && editor.isEditing ? editor.isEditing() : false;
    if (editor) { editor.destroy(); editor = null; }
    if (chromaTooltip) { chromaTooltip.destroy(); chromaTooltip = null; }
    container.innerHTML = '';
    save(s);

    const header = document.createElement('header');
    header.className = 'ql-page-header';
    header.innerHTML =
      '<p class="ql-eyebrow">' + t('sanger.eyebrow') + '</p>' +
      '<h1 class="ql-page-title">' + t('sanger.title') + '</h1>' +
      '<p class="ql-page-sub">' + t('sanger.subtitle') + '</p>';
    container.appendChild(header);

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
      b.addEventListener('click', () => { s.tab = tabDef.id; paint(); });
      tabsEl.appendChild(b);
    });
    container.appendChild(tabsEl);

    if (s.tab === 'entrada') paintEntrada(container);
    else if (s.tab === 'cromatograma') paintCromatograma(container);
    else paintResultados(container);
  }

  // ---------------- pestaña: entrada ----------------
  function paintEntrada(container) {
    const stack = document.createElement('div');
    stack.className = 'ql-stack';

    const scopeCard = document.createElement('section');
    scopeCard.className = 'ql-card ql-panel';
    scopeCard.innerHTML = '<h2>' + t('sanger.scopeTitle') + '</h2><p class="ql-panel-note">' + t('sanger.scopeNote') + '</p>' +
      glossaryLinkHtml('sangerConsensusTerm');
    stack.appendChild(scopeCard);

    // --- dropzone ---
    const upCard = document.createElement('section');
    upCard.className = 'ql-card ql-panel';
    upCard.innerHTML = '<h2>' + t('sanger.uploadTitle') + '</h2><p class="ql-panel-note">' + t('sanger.uploadNote') + '</p>';
    const dz = document.createElement('div');
    dz.className = 'ql-dropzone';
    dz.tabIndex = 0;
    dz.setAttribute('role', 'button');
    dz.setAttribute('aria-label', t('sanger.uploadTitle'));
    dz.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>' +
      '<div><div class="ql-dz-text">' + t('sanger.dropzone') + '</div><div class="ql-dz-sub">' + t('sanger.dropSub') + '</div></div>';
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.ab1,.fastq,.fq,.fasta,.fa,.zip';
    dz.appendChild(input);
    input.addEventListener('change', () => { if (input.files.length) handleFiles([...input.files]); input.value = ''; });
    dz.addEventListener('click', (e) => { if (e.target !== input) input.click(); });
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('is-drag'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('is-drag'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault(); dz.classList.remove('is-drag');
      if (e.dataTransfer && e.dataTransfer.files.length) handleFiles([...e.dataTransfer.files]);
    });
    upCard.appendChild(dz);

    const exRow = document.createElement('div');
    exRow.style.cssText = 'margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;';
    const mkExBtn = (label, urls) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ql-btn ql-btn-primary'; b.textContent = label;
      b.addEventListener('click', async () => {
        b.disabled = true; const prev = b.textContent; b.textContent = t('common.loadingProcessing');
        try { await loadExample(urls); } catch (err) { console.error(err); } finally { b.disabled = false; b.textContent = prev; }
      });
      return b;
    };
    exRow.appendChild(mkExBtn(t('sanger.exampleClean'), EXAMPLE_CLEAN));
    exRow.appendChild(mkExBtn(t('sanger.exampleReview'), EXAMPLE_REVIEW));
    upCard.appendChild(exRow);
    stack.appendChild(upCard);

    // --- archivos sin dirección detectada ---
    if (pending.length) {
      const pendCard = document.createElement('section');
      pendCard.className = 'ql-card ql-panel';
      pendCard.innerHTML = '<h2>' + t('sanger.pendingTitle') + '</h2><p class="ql-panel-note">' + t('sanger.pendingNote') + '</p>';
      pending.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'ql-field';
        row.style.cssText = 'display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:10px;';
        if (p.error) {
          row.innerHTML = '<span class="ql-badge ql-badge-crit">' + escapeHtml(p.fileName) + '</span><span class="ql-field-help" style="margin:0;">' + escapeHtml(p.error) + '</span>';
          pendCard.appendChild(row);
          return;
        }
        row.innerHTML =
          '<span style="font-size:12.5px;color:var(--ink-2);min-width:160px;" title="' + escapeHtml(p.fileName) + '">' + escapeHtml(p.fileName) + '</span>';
        const idInput = document.createElement('input');
        idInput.type = 'text'; idInput.value = p.id; idInput.style.maxWidth = '140px';
        idInput.setAttribute('aria-label', t('sanger.pendingSampleId'));
        idInput.addEventListener('input', () => { p.id = idInput.value; });
        const dirSel = document.createElement('select');
        dirSel.setAttribute('aria-label', t('sanger.pendingDirection'));
        [['forward', t('sanger.forward')], ['reverse', t('sanger.reverse')]].forEach(([v, lbl]) => {
          const o = document.createElement('option'); o.value = v; o.textContent = lbl; if (v === p.direction) o.selected = true; dirSel.appendChild(o);
        });
        dirSel.addEventListener('change', () => { p.direction = dirSel.value; });
        const addBtn = document.createElement('button');
        addBtn.type = 'button'; addBtn.className = 'ql-btn'; addBtn.textContent = t('sanger.pendingAdd');
        addBtn.addEventListener('click', () => {
          upsertRead(p.id.trim() || p.fileName, p.direction, p.read);
          pending.splice(pending.indexOf(p), 1);
          recomputeResults(); save(s); paint();
        });
        row.appendChild(idInput); row.appendChild(dirSel); row.appendChild(addBtn);
        pendCard.appendChild(row);
      });
      stack.appendChild(pendCard);
    }

    // --- muestras emparejadas ---
    const list = sampleList();
    if (list.length) {
      const table = document.createElement('section');
      table.className = 'ql-card ql-panel';
      table.innerHTML = '<h2>' + t('sanger.samplesTitle') + '</h2>';
      const scroll = document.createElement('div');
      scroll.className = 'ql-table-scroll';
      const tbl = document.createElement('table');
      tbl.className = 'ql-table';
      tbl.innerHTML = '<thead><tr><th>' + t('sanger.colSample') + '</th><th>' + t('sanger.colForward') + '</th><th>' + t('sanger.colReverse') + '</th><th></th></tr></thead>';
      const tbody = document.createElement('tbody');
      list.forEach((sample) => {
        const tr = document.createElement('tr');
        const fLabel = sample.forward ? escapeHtml(sample.forward.fileName) + (sample.forward.trace ? '' : ' <span class="ql-badge ql-badge-muted">' + t('sanger.noTrace') + '</span>') : '—';
        const rLabel = sample.reverse ? escapeHtml(sample.reverse.fileName) + (sample.reverse.trace ? '' : ' <span class="ql-badge ql-badge-muted">' + t('sanger.noTrace') + '</span>') : '—';
        tr.innerHTML = '<td><strong>' + escapeHtml(sample.id) + '</strong></td><td>' + fLabel + '</td><td>' + rLabel + '</td><td></td>';
        const rmBtn = document.createElement('button');
        rmBtn.type = 'button'; rmBtn.className = 'ql-btn'; rmBtn.textContent = t('sanger.remove');
        rmBtn.addEventListener('click', () => { samples.delete(sample.id); recomputeResults(); save(s); paint(); });
        tr.lastElementChild.appendChild(rmBtn);
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      scroll.appendChild(tbl);
      table.appendChild(scroll);
      stack.appendChild(table);
    }

    // --- configuración ---
    const cfg = document.createElement('section');
    cfg.className = 'ql-card ql-panel';
    cfg.innerHTML = '<h2>' + t('sanger.configTitle') + '</h2>';

    const trimField = document.createElement('div');
    trimField.className = 'ql-field';
    trimField.innerHTML = '<label>' + t('sanger.trimMethodLabel') + '</label>';
    const segWrap = document.createElement('div');
    segWrap.style.cssText = 'display:flex;gap:8px;';
    [['mott', t('sanger.trimMethodMott')], ['window', t('sanger.trimMethodWindow')]].forEach(([v, lbl]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ql-seg-btn' + (s.trimMethod === v ? ' is-on' : ''); b.textContent = lbl;
      b.addEventListener('click', () => { s.trimMethod = v; recomputeResults(); save(s); paint(); });
      segWrap.appendChild(b);
    });
    trimField.appendChild(segWrap);
    trimField.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('sanger.trimMethodHelp') + '</p>');
    cfg.appendChild(trimField);

    function numField(labelKey, value, onChange, { step = 1, min = 0, helpKey = null } = {}) {
      const f = document.createElement('div');
      f.className = 'ql-field';
      const id = 'sg' + Math.random().toString(36).slice(2, 8);
      f.innerHTML = '<label for="' + id + '">' + t(labelKey) + '</label>';
      const inp = document.createElement('input');
      inp.type = 'number'; inp.id = id; inp.value = value; inp.step = String(step); inp.min = String(min);
      inp.addEventListener('change', () => { onChange(+inp.value); recomputeResults(); save(s); paint(); });
      f.appendChild(inp);
      if (helpKey) f.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t(helpKey) + '</p>');
      return f;
    }

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 16px;';
    if (s.trimMethod === 'mott') {
      grid.appendChild(numField('sanger.mottThresholdLabel', s.mottThreshold, (v) => { s.mottThreshold = v; }, { step: 0.01, min: 0.001, helpKey: 'sanger.mottThresholdHelp' }));
    } else {
      grid.appendChild(numField('sanger.windowSizeLabel', s.windowSize, (v) => { s.windowSize = v; }, { step: 1, min: 2 }));
      grid.appendChild(numField('sanger.windowMinQLabel', s.windowMinQ, (v) => { s.windowMinQ = v; }, { step: 1, min: 0 }));
    }
    grid.appendChild(numField('sanger.minLengthLabel', s.minLength, (v) => { s.minLength = v; }, { step: 1, min: 0 }));
    cfg.appendChild(grid);

    const kwGrid = document.createElement('div');
    kwGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0 16px;margin-top:6px;';
    function textField(labelKey, value, onChange, helpKey) {
      const f = document.createElement('div');
      f.className = 'ql-field';
      const id = 'sg' + Math.random().toString(36).slice(2, 8);
      f.innerHTML = '<label for="' + id + '">' + t(labelKey) + '</label>';
      const inp = document.createElement('input');
      inp.type = 'text'; inp.id = id; inp.value = value;
      inp.addEventListener('change', () => { onChange(inp.value); recomputeResults(); save(s); paint(); });
      f.appendChild(inp);
      if (helpKey) f.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t(helpKey) + '</p>');
      return f;
    }
    kwGrid.appendChild(textField('sanger.fwdKeywordsLabel', s.fwdKeywords, (v) => { s.fwdKeywords = v; }, 'sanger.keywordsHelp'));
    kwGrid.appendChild(textField('sanger.revKeywordsLabel', s.revKeywords, (v) => { s.revKeywords = v; }, 'sanger.revKeywordsHelp'));
    cfg.appendChild(kwGrid);

    const ampGrid = document.createElement('div');
    ampGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 16px;margin-top:6px;';
    ampGrid.appendChild(numField('sanger.ampliconLenLabel', s.expectedAmplicon || '', (v) => { s.expectedAmplicon = v ? String(v) : ''; }, { step: 1, min: 0, helpKey: 'sanger.ampliconLenHelp' }));
    ampGrid.appendChild(numField('sanger.ampliconTolLabel', s.ampliconTolerance, (v) => { s.ampliconTolerance = v; }, { step: 10, min: 0 }));
    cfg.appendChild(ampGrid);

    stack.appendChild(cfg);
    container.appendChild(stack);
  }

  // ---------------- pestaña: cromatograma ----------------
  function paintCromatograma(container) {
    const stack = document.createElement('div');
    stack.className = 'ql-stack';
    const list = sampleList();

    if (!list.length) {
      const empty = document.createElement('section');
      empty.className = 'ql-card ql-panel';
      empty.innerHTML = '<h2>' + t('sanger.noSamplesTitle') + '</h2><p class="ql-panel-note">' + t('sanger.noSamplesNote') + '</p>';
      stack.appendChild(empty); container.appendChild(stack); return;
    }
    if (!list.some((sm) => sm.id === s.selectedSampleId)) s.selectedSampleId = list[0].id;
    const sample = list.find((sm) => sm.id === s.selectedSampleId);

    const card = document.createElement('section');
    card.className = 'ql-card ql-panel';
    const ctrlRow = document.createElement('div');
    ctrlRow.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px;';

    const sampSel = document.createElement('select');
    sampSel.setAttribute('aria-label', t('sanger.selectSample'));
    list.forEach((sm) => { const o = document.createElement('option'); o.value = sm.id; o.textContent = sm.id; if (sm.id === s.selectedSampleId) o.selected = true; sampSel.appendChild(o); });
    sampSel.addEventListener('change', () => { s.selectedSampleId = sampSel.value; save(s); paint(); });
    ctrlRow.appendChild(sampSel);

    const dirWrap = document.createElement('div');
    dirWrap.style.cssText = 'display:flex;gap:8px;';
    [['forward', t('sanger.forward')], ['reverse', t('sanger.reverse')]].forEach(([v, lbl]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ql-seg-btn' + (s.selectedDirection === v ? ' is-on' : '');
      b.textContent = lbl; b.disabled = !sample[v];
      b.addEventListener('click', () => { s.selectedDirection = v; save(s); paint(); });
      dirWrap.appendChild(b);
    });
    ctrlRow.appendChild(dirWrap);
    card.appendChild(ctrlRow);

    const read = sample[s.selectedDirection];
    if (!read) {
      card.insertAdjacentHTML('beforeend', '<p class="ql-panel-note">' + t('sanger.noReadForDirection') + '</p>');
      stack.appendChild(card); container.appendChild(stack); return;
    }

    const manual = s.manualTrim[sample.id] && s.manualTrim[sample.id][s.selectedDirection];
    const trimRange = effectiveTrim(sample, s.selectedDirection, read, s);

    if (!read.trace) card.insertAdjacentHTML('beforeend', '<p class="ql-field-help">' + t('sanger.noTraceNote') + '</p>');

    const chartWrap = document.createElement('div');
    chartWrap.className = 'ql-chroma-wrap';
    chartWrap.style.cssText = 'overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-md);padding:8px;position:relative;';
    const svg = svgEl('svg', {});
    chartWrap.appendChild(svg);
    card.appendChild(chartWrap);

    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:12px;';
    if (read.trace) {
      ['A', 'C', 'G', 'T'].forEach((b) => {
        legend.insertAdjacentHTML('beforeend', '<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:12px;height:3px;background:' + BASE_COLOR[b] + ';display:inline-block;"></span>' + b + '</span>');
      });
    }
    legend.insertAdjacentHTML('beforeend', '<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;background:var(--critical);border-radius:50%;display:inline-block;"></span>' + t('sanger.legendStart') + '</span>');
    legend.insertAdjacentHTML('beforeend', '<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;background:var(--accent);border-radius:50%;display:inline-block;"></span>' + t('sanger.legendEnd') + '</span>');
    card.appendChild(legend);

    const chart = drawChromatogram(svg, read, trimRange);
    chromaTooltip = attachChromatogramTooltip({
      svg,
      chartWrap,
      read,
      xOfBase: chart.xOfBase,
      nBases: chart.nBases,
      guideLine: chart.guideLine,
      isDragging: () => !!dragging,
    });

    let dragging = null, liveStart = trimRange.start, liveEnd = trimRange.end;
    function moveHandleTo(which, bi) {
      const g = chart.handles[which];
      if (!g) return;
      const x = chart.xOfBase(which === 'start' ? bi : Math.max(0, bi - 1));
      g.querySelectorAll('line').forEach((l) => { l.setAttribute('x1', x); l.setAttribute('x2', x); });
      const circle = g.querySelector('circle');
      if (circle) circle.setAttribute('cx', x);
      g.setAttribute('aria-valuenow', String(bi));
    }

    function commitManual(start, end) {
      start = Math.max(0, Math.min(read.sequence.length - 1, Math.round(start)));
      end = Math.max(start + 1, Math.min(read.sequence.length, Math.round(end)));
      s.manualTrim[sample.id] = s.manualTrim[sample.id] || {};
      s.manualTrim[sample.id][s.selectedDirection] = { start, end };
      recomputeResults(); save(s); paint();
    }

    const numRow = document.createElement('div');
    numRow.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;margin-top:14px;';
    const startField = document.createElement('div');
    startField.className = 'ql-field'; startField.style.maxWidth = '160px';
    const startId = 'sgTrimStart', endId = 'sgTrimEnd';
    startField.innerHTML = '<label for="' + startId + '">' + t('sanger.trimStartLabel') + '</label>';
    const startInp = document.createElement('input');
    startInp.type = 'number'; startInp.id = startId; startInp.min = '0'; startInp.max = String(read.sequence.length); startInp.value = trimRange.start;
    startInp.addEventListener('change', () => commitManual(+startInp.value, trimRange.end));
    startField.appendChild(startInp);
    const endField = document.createElement('div');
    endField.className = 'ql-field'; endField.style.maxWidth = '160px';
    endField.innerHTML = '<label for="' + endId + '">' + t('sanger.trimEndLabel') + '</label>';
    const endInp = document.createElement('input');
    endInp.type = 'number'; endInp.id = endId; endInp.min = '0'; endInp.max = String(read.sequence.length); endInp.value = trimRange.end;
    endInp.addEventListener('change', () => commitManual(trimRange.start, +endInp.value));
    endField.appendChild(endInp);
    numRow.appendChild(startField); numRow.appendChild(endField);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button'; resetBtn.className = 'ql-btn'; resetBtn.textContent = t('sanger.resetTrim');
    resetBtn.disabled = !manual;
    resetBtn.style.alignSelf = 'flex-end';
    resetBtn.addEventListener('click', () => {
      if (s.manualTrim[sample.id]) delete s.manualTrim[sample.id][s.selectedDirection];
      recomputeResults(); save(s); paint();
    });
    numRow.appendChild(resetBtn);
    card.appendChild(numRow);

    const trimInfoEl = document.createElement('p');
    trimInfoEl.className = 'ql-field-help';
    trimInfoEl.style.marginTop = '10px';
    function updateTrimInfo(start, end, isMan) {
      const len = Math.max(0, end - start);
      trimInfoEl.innerHTML = t('sanger.trimInfo', { start, end, len, total: read.sequence.length }) +
        (isMan ? ' · ' + t('sanger.trimIsManual') : ' · ' + t('sanger.trimIsAuto'));
    }
    updateTrimInfo(trimRange.start, trimRange.end, !!manual);
    card.appendChild(trimInfoEl);

    // Arrastre interactivo en el SVG
    function onPointerMove(e) {
      if (!dragging) return;
      if (chromaTooltip) chromaTooltip.hide();
      const x = clientXToSvgX(svg, e.clientX);
      const bi = baseIndexAtX(x, chart.nBases, chart.xOfBase);
      if (dragging === 'start') { liveStart = Math.min(bi, liveEnd - 1); moveHandleTo('start', liveStart); startInp.value = liveStart; }
      else { liveEnd = Math.max(bi + 1, liveStart + 1); moveHandleTo('end', liveEnd); endInp.value = liveEnd; }
      updateTrimInfo(liveStart, liveEnd, true);
    }
    function onPointerUp() {
      const wasDragging = dragging;
      dragging = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      stopActiveDrag = null;
      if (wasDragging) commitManual(liveStart, liveEnd);
    }
    ['start', 'end'].forEach((which) => {
      chart.handles[which].addEventListener('pointerdown', (e) => {
        e.preventDefault(); dragging = which; liveStart = trimRange.start; liveEnd = trimRange.end;
        if (chromaTooltip) chromaTooltip.hide();
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        stopActiveDrag = onPointerUp;
      });
      chart.handles[which].addEventListener('keydown', (e) => {
        const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -10 : e.key === 'ArrowDown' ? 10 : 0;
        if (!delta) return;
        e.preventDefault();
        if (which === 'start') commitManual(trimRange.start + delta, trimRange.end);
        else commitManual(trimRange.start, trimRange.end + delta);
      });
    });

    // Panel de Ajustes de Recorte Dinámico (Mott)
    const trimPanel = document.createElement('div');
    trimPanel.className = 'ql-trim-panel';

    const panelHead = document.createElement('div');
    panelHead.style.cssText = 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;';
    panelHead.innerHTML = '<div style="display:flex;align-items:center;gap:8px;">' +
      '<strong style="font-size:13.5px;color:var(--ink);">' + t('sanger.trimSettingsTitle') + '</strong>' +
      '<span class="ql-badge ql-badge-muted">Mott</span>' +
      '</div>' +
      '<span class="ql-field-help" style="margin:0;font-size:12px;">' + t('sanger.phredScoreHelp') + '</span>';
    trimPanel.appendChild(panelHead);

    const curQ = Number.isFinite(+s.phredScore) ? Math.max(10, Math.min(60, Math.round(+s.phredScore))) : 20;
    const curP = Math.pow(10, -curQ / 10);
    const curMinLen = Number.isFinite(+s.minLength) ? Math.max(10, Math.min(500, Math.round(+s.minLength))) : 50;

    function getPhredBadgeClass(q) {
      if (q >= 30) return 'ql-badge-good';
      if (q >= 20) return 'ql-badge-good';
      if (q >= 15) return 'ql-badge-warn';
      return 'ql-badge-crit';
    }

    const slidersGrid = document.createElement('div');
    slidersGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;';

    // 1. Phred slider
    const phredCol = document.createElement('div');
    phredCol.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    const phredHead = document.createElement('div');
    phredHead.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    phredHead.innerHTML = '<label for="sgPhredSlider" style="font-weight:600;font-size:12.5px;cursor:pointer;">' +
      t('sanger.phredScoreLabel') + '</label>';
    const phredVal = document.createElement('span');
    phredVal.id = 'sgPhredVal';
    phredVal.className = 'ql-badge ' + getPhredBadgeClass(curQ);
    phredVal.textContent = `Q${curQ} (P ≈ ${curP.toFixed(4)})`;
    phredHead.appendChild(phredVal);
    phredCol.appendChild(phredHead);

    const phredSlider = document.createElement('input');
    phredSlider.type = 'range';
    phredSlider.id = 'sgPhredSlider';
    phredSlider.min = '10';
    phredSlider.max = '60';
    phredSlider.step = '1';
    phredSlider.value = String(curQ);
    phredSlider.className = 'ql-range';
    phredSlider.setAttribute('aria-label', t('sanger.phredScoreLabel'));
    phredCol.appendChild(phredSlider);

    const phredTicks = document.createElement('div');
    phredTicks.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;color:var(--ink-muted);padding:0 2px;';
    phredTicks.innerHTML = '<span>Q10 (P=0.1)</span><span>Q20 (P=0.01)</span><span>Q30 (P=0.001)</span><span>Q60</span>';
    phredCol.appendChild(phredTicks);
    slidersGrid.appendChild(phredCol);

    // 2. Min length slider
    const minLenCol = document.createElement('div');
    minLenCol.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    const minLenHead = document.createElement('div');
    minLenHead.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    minLenHead.innerHTML = '<label for="sgMinLenSlider" style="font-weight:600;font-size:12.5px;cursor:pointer;">' +
      t('sanger.minLengthLabel') + '</label>';
    const minLenVal = document.createElement('span');
    minLenVal.id = 'sgMinLenVal';
    minLenVal.className = 'ql-badge';
    minLenVal.textContent = `${curMinLen} pb`;
    minLenHead.appendChild(minLenVal);
    minLenCol.appendChild(minLenHead);

    const minLenSlider = document.createElement('input');
    minLenSlider.type = 'range';
    minLenSlider.id = 'sgMinLenSlider';
    minLenSlider.min = '10';
    minLenSlider.max = '500';
    minLenSlider.step = '5';
    minLenSlider.value = String(curMinLen);
    minLenSlider.className = 'ql-range';
    minLenSlider.setAttribute('aria-label', t('sanger.minLengthLabel'));
    minLenCol.appendChild(minLenSlider);

    const minLenTicks = document.createElement('div');
    minLenTicks.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;color:var(--ink-muted);padding:0 2px;';
    minLenTicks.innerHTML = '<span>10 pb</span><span>250 pb</span><span>500 pb</span>';
    minLenCol.appendChild(minLenTicks);
    slidersGrid.appendChild(minLenCol);

    trimPanel.appendChild(slidersGrid);

    // 3. Live consensus preview
    const prevWrap = document.createElement('div');
    prevWrap.id = 'sgConsensusPreview';
    prevWrap.style.cssText = 'padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm,6px);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:12.5px;margin-top:4px;';

    function renderConsensusPreview() {
      const res = s.results.find((r) => r.id === sample.id);
      if (!res || !res.consensus) {
        prevWrap.innerHTML = '<span style="color:var(--critical);font-weight:500;">' + t('sanger.noConsensusAvailable') + '</span>';
        return;
      }
      if (res.method === 'merged') {
        prevWrap.innerHTML = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
          '<strong style="color:var(--ink);">' + t('sanger.consensusPreview') + ':</strong> ' +
          '<span>' + res.consensus.length + ' pb</span>' +
          '<span class="ql-badge ql-badge-good">' + t('sanger.colOverlap') + ': ' + res.overlapLen + ' pb (' + fmtPct(res.identity) + ')</span>' +
          (res.needsReview ? '<span class="ql-badge ql-badge-warn">' + t('sanger.reviewNeeded') + '</span>' : '') +
          '</div>' +
          '<span class="ql-field-help" style="margin:0;">' + t('sanger.consensusUpdated') + ' ✓</span>';
      } else if (res.method === 'stitched') {
        prevWrap.innerHTML = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
          '<strong style="color:var(--ink);">' + t('sanger.consensusPreview') + ':</strong> ' +
          '<span>' + res.consensus.length + ' pb</span>' +
          '<span class="ql-badge ql-badge-warn">Stitched (N-bridge)</span>' +
          '</div>' +
          '<span class="ql-field-help" style="margin:0;">' + t('sanger.consensusUpdated') + ' ✓</span>';
      } else if (res.method === 'single') {
        prevWrap.innerHTML = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
          '<strong style="color:var(--ink);">' + t('sanger.consensusPreview') + ':</strong> ' +
          '<span>' + res.consensus.length + ' pb (' + (res.fLen ? 'Forward' : 'Reverse') + ')</span>' +
          '</div>' +
          '<span class="ql-field-help" style="margin:0;">' + t('sanger.consensusUpdated') + ' ✓</span>';
      } else {
        prevWrap.innerHTML = '<span style="color:var(--critical);font-weight:500;">' + t('sanger.noConsensusAvailable') + '</span>';
      }
    }
    renderConsensusPreview();
    trimPanel.appendChild(prevWrap);
    card.appendChild(trimPanel);

    function applyDynamicTrim(immediateVisualOnly = false) {
      const q = +phredSlider.value;
      const minLen = +minLenSlider.value;
      const p = Math.pow(10, -q / 10);

      phredVal.className = 'ql-badge ' + getPhredBadgeClass(q);
      phredVal.textContent = `Q${q} (P ≈ ${p.toFixed(4)})`;
      minLenVal.textContent = `${minLen} pb`;

      if (read && read.quality) {
        const tr = trimRead(read.quality, {
          method: 'mott',
          errorProbThreshold: p,
          minLength: minLen,
        });

        if (s.manualTrim[sample.id] && s.manualTrim[sample.id][s.selectedDirection]) {
          delete s.manualTrim[sample.id][s.selectedDirection];
        }
        resetBtn.disabled = true;

        moveHandleTo('start', tr.start);
        moveHandleTo('end', tr.end);
        startInp.value = tr.start;
        endInp.value = tr.end;
        liveStart = tr.start;
        liveEnd = tr.end;
        updateTrimInfo(tr.start, tr.end, false);
      }

      if (trimDebounceTimer) clearTimeout(trimDebounceTimer);

      const commitChanges = () => {
        s.phredScore = q;
        s.mottThreshold = p;
        s.minLength = minLen;
        s.trimMethod = 'mott';
        save(s);
        recomputeResults();
        renderConsensusPreview();
      };

      if (immediateVisualOnly) {
        trimDebounceTimer = setTimeout(commitChanges, 300);
      } else {
        commitChanges();
      }
    }

    phredSlider.addEventListener('input', () => applyDynamicTrim(true));
    phredSlider.addEventListener('change', () => applyDynamicTrim(false));
    minLenSlider.addEventListener('input', () => applyDynamicTrim(true));
    minLenSlider.addEventListener('change', () => applyDynamicTrim(false));

    stack.appendChild(card);
    container.appendChild(stack);

    // wasEditing ya se capturó en paint() -- para cuando llegamos aquí,
    // paint() ya destruyó el editor anterior (variable compartida a nivel
    // de módulo, no de esta función)
    editor = attachChartEditor({
      key: 'sanger-chromatogram', svg, mount: card, lang: getLang(),
      filename: t('sanger.title') + '-' + sample.id + '-' + s.selectedDirection,
      elements: [{ id: 'title', create: { text: t('sanger.tabCromatograma'), x: 8, y: 14, anchor: 'start', cls: 'ce-title' } }],
      paletteType: 'categorical', paletteMax: 4,
      paletteSeries: read.trace ? ['A', 'C', 'G', 'T'].map((b) => ({ id: 'base-' + b, label: b })) : [],
      startEditing: wasEditing,
    });
  }

  // ---------------- pestaña: resultados ----------------
  function paintResultados(container) {
    const stack = document.createElement('div');
    stack.className = 'ql-stack';
    recomputeResults();
    save(s);
    const results = s.results;

    if (!results.length) {
      const empty = document.createElement('section');
      empty.className = 'ql-card ql-panel';
      empty.innerHTML = '<h2>' + t('sanger.noSamplesTitle') + '</h2><p class="ql-panel-note">' + t('sanger.noSamplesNote') + '</p>';
      stack.appendChild(empty); container.appendChild(stack); return;
    }

    const summary = document.createElement('section');
    summary.className = 'ql-card ql-panel';
    summary.innerHTML = '<h2>' + t('sanger.resultsTitle') + '</h2><p class="ql-panel-note">' + t('sanger.resultsNote') + '</p>';
    const scroll = document.createElement('div');
    scroll.className = 'ql-table-scroll';
    const tbl = document.createElement('table');
    tbl.className = 'ql-table';
    tbl.innerHTML = '<thead><tr><th>' + t('sanger.colSample') + '</th><th>' + t('sanger.colMethod') + '</th>' +
      '<th>' + t('sanger.colOverlap') + '</th><th>' + t('sanger.colIdentity') + '</th><th>' + t('sanger.colLen') + '</th><th>' + t('sanger.colReview') + '</th><th style="min-width:240px;"></th></tr></thead>';
    const tbody = document.createElement('tbody');

    function createComparePanel(resultItem) {
      const panel = document.createElement('div');
      panel.className = 'ql-ref-compare-panel';

      const head = document.createElement('div');
      head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
      head.innerHTML = '<strong>' + t('sanger.compareWithRef') + ': ' + escapeHtml(resultItem.id) + '</strong>';

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'ql-btn ql-btn-ghost ql-btn-sm';
      closeBtn.textContent = '✕';
      closeBtn.setAttribute('aria-label', 'Cerrar');
      closeBtn.addEventListener('click', () => {
        const pTr = panel.closest('tr.ql-ref-compare-row');
        if (pTr) pTr.remove(); else panel.remove();
      });
      head.appendChild(closeBtn);
      panel.appendChild(head);

      const lbl = document.createElement('label');
      lbl.style.cssText = 'font-size:12.5px;color:var(--ink);font-weight:500;';
      lbl.textContent = t('sanger.pasteRef');
      panel.appendChild(lbl);

      const ta = document.createElement('textarea');
      ta.className = 'ql-textarea';
      ta.rows = 3;
      ta.placeholder = t('sanger.refPlaceholder');
      panel.appendChild(ta);

      const actRow = document.createElement('div');
      actRow.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;';

      const alignBtn = document.createElement('button');
      alignBtn.type = 'button';
      alignBtn.className = 'ql-btn ql-btn-primary';
      alignBtn.textContent = t('sanger.alignBtn');

      const statusMsg = document.createElement('span');
      statusMsg.style.cssText = 'font-size:12px;color:var(--ink-muted);display:none;';
      statusMsg.textContent = t('sanger.aligning');

      actRow.appendChild(alignBtn);
      actRow.appendChild(statusMsg);
      panel.appendChild(actRow);

      const out = document.createElement('div');
      panel.appendChild(out);

      alignBtn.addEventListener('click', async () => {
        const cleanRef = cleanFastaOrPlain(ta.value);
        if (!cleanRef) {
          out.innerHTML = '<p class="ql-field-help" style="color:var(--critical);margin-top:6px;">' + t('sanger.alignEmptyRef') + '</p>';
          return;
        }
        if (!resultItem.consensus) {
          out.innerHTML = '<p class="ql-field-help" style="color:var(--critical);margin-top:6px;">' + t('sanger.noConsensus') + '</p>';
          return;
        }

        alignBtn.disabled = true;
        statusMsg.style.display = 'inline';
        out.innerHTML = '<div style="padding:10px 0;color:var(--ink-muted);font-style:italic;">' + t('sanger.aligning') + '</div>';

        try {
          const aln = await alignWithWorker(resultItem.consensus, cleanRef);
          out.innerHTML = renderAlignmentHTML(aln);
        } catch (err) {
          out.innerHTML = '<p class="ql-field-help" style="color:var(--critical);margin-top:6px;">' + escapeHtml(err && err.message ? err.message : String(err)) + '</p>';
        } finally {
          alignBtn.disabled = false;
          statusMsg.style.display = 'none';
        }
      });

      return panel;
    }

    function toggleCompareRow(targetTr, resultItem) {
      const next = targetTr.nextElementSibling;
      if (next && next.classList.contains('ql-ref-compare-row')) {
        next.remove();
        return;
      }
      tbody.querySelectorAll('.ql-ref-compare-row').forEach((el) => el.remove());

      const compTr = document.createElement('tr');
      compTr.className = 'ql-ref-compare-row';
      const td = document.createElement('td');
      td.colSpan = 7;
      td.appendChild(createComparePanel(resultItem));
      compTr.appendChild(td);
      targetTr.after(compTr);
    }

    function createOverlapPanel(resultItem) {
      const panel = document.createElement('div');
      panel.className = 'ql-overlap-panel';
      panel.innerHTML = renderOverlapHTML(resultItem.fSeq || '', resultItem.rcSeq || '', resultItem.consensus || '');
      return panel;
    }

    results.forEach((r) => {
      const tr = document.createElement('tr');
      if (r.needsReview) tr.style.background = 'color-mix(in srgb, var(--warning) 10%, transparent)';
      const badgeClass = r.needsReview ? 'ql-badge-warn' : (r.method === 'merged' ? 'ql-badge-good' : 'ql-badge-muted');
      tr.innerHTML =
        '<td><strong>' + escapeHtml(r.id) + '</strong></td>' +
        '<td><span class="ql-badge ' + badgeClass + '">' + t(METHOD_KEY[r.method] || r.method) + '</span></td>' +
        '<td>' + (r.overlapLen || '—') + '</td>' +
        '<td>' + (r.overlapLen ? fmtPct(r.identity) : '—') + '</td>' +
        '<td>' + (r.consensus.length || '—') + '</td>' +
        '<td>' + (r.needsReview ? '<span class="ql-badge ql-badge-warn">' + t('sanger.reviewNeeded') + '</span>' : t('sanger.reviewOk')) + '</td>' +
        '<td style="text-align:right;white-space:nowrap;"></td>';
      if (r.consensus) {
        const actionsCell = tr.lastElementChild;
        const actionsGroup = document.createElement('div');
        actionsGroup.className = 'ql-table-actions';

        if (r.method === 'merged' || r.method === 'stitched' || (r.fLen > 0 && r.rLen > 0)) {
          const ovBtn = document.createElement('button');
          ovBtn.type = 'button';
          ovBtn.className = 'ql-btn-icon-sq';
          ovBtn.title = t('sanger.inspectOverlapTitle');
          ovBtn.setAttribute('aria-label', t('sanger.inspectOverlapTitle'));
          ovBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
          ovBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            s.selectedSampleId = r.id;
            save(s);
            paintDetail(r);
            openOverlapModal(r, { samples, state: s });
          });
          actionsGroup.appendChild(ovBtn);
        }

        const compBtn = document.createElement('button');
        compBtn.type = 'button';
        compBtn.className = 'ql-btn-icon-sq';
        compBtn.title = t('sanger.compareWithRef');
        compBtn.setAttribute('aria-label', t('sanger.compareWithRef'));
        compBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>';
        compBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          s.selectedSampleId = r.id;
          save(s);
          paintDetail(r);
          toggleCompareRow(tr, r);
        });
        actionsGroup.appendChild(compBtn);

        actionsCell.appendChild(actionsGroup);
      }
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => { s.selectedSampleId = r.id; save(s); paintDetail(r); });
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    scroll.appendChild(tbl);
    summary.appendChild(scroll);

    const actionsRow = document.createElement('div');
    actionsRow.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button'; exportBtn.className = 'ql-btn ql-btn-primary';
    exportBtn.textContent = t('sanger.exportFasta');
    exportBtn.addEventListener('click', () => {
      const fasta = results.filter((r) => r.consensus).map((r) => '>' + r.id + ' method=' + r.method + (r.needsReview ? ' NEEDS_REVIEW' : '') + '\n' + r.consensus).join('\n') + '\n';
      const blob = new Blob([fasta], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'sanger-consenso.fasta'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
    actionsRow.appendChild(exportBtn);

    const validResults = results.filter((r) => r.consensus);
    const batchBlastBtn = document.createElement('button');
    batchBlastBtn.type = 'button';
    batchBlastBtn.className = 'ql-btn';
    batchBlastBtn.textContent = t('sanger.blastBatch') + ' ↗';
    batchBlastBtn.title = t('sanger.blastBatchTitle');
    batchBlastBtn.disabled = !validResults.length;
    batchBlastBtn.addEventListener('click', () => {
      sendBatchToNCBI(validResults);
      markExternal('ncbi-blast'); // el informe completo repetirá el aviso de NCBI
    });
    actionsRow.appendChild(batchBlastBtn);
    summary.appendChild(actionsRow);
    // aviso a la vista (no solo en el title del botón, que en táctil no se ve):
    // el lote envía TODOS los consensos a un servicio externo
    const batchNote = document.createElement('p');
    batchNote.className = 'ql-field-help ql-blast-batch-note';
    batchNote.textContent = t('sanger.blastBatchNote');
    summary.appendChild(batchNote);
    stack.appendChild(summary);

    const detailWrap = document.createElement('section');
    detailWrap.className = 'ql-card ql-panel';
    detailWrap.id = 'sangerDetail';
    stack.appendChild(detailWrap);
    container.appendChild(stack);

    function paintDetail(r) {
      detailWrap.innerHTML = '';
      detailWrap.innerHTML = '<h2>' + escapeHtml(r.id) + '</h2>';
      if (r.needsReview) {
        detailWrap.insertAdjacentHTML('beforeend',
          '<p class="ql-panel-note" style="color:var(--warning-ink);"><strong>' + t('sanger.reviewNeeded') + '</strong> — ' + t(REASON_KEY[r.reason] || r.reason) + '</p>');
      }
      const stats = document.createElement('div');
      stats.className = 'ql-stats';
      [
        [t('sanger.colMethod'), t(METHOD_KEY[r.method] || r.method)],
        [t('sanger.colOverlap'), r.overlapLen || '—'],
        [t('sanger.colIdentity'), r.overlapLen ? fmtPct(r.identity) : '—'],
        [t('sanger.statAmbiguous'), r.nAmbiguous],
        [t('sanger.statConsensusLen'), r.consensus.length],
      ].forEach(([lbl, val]) => {
        const tile = document.createElement('div'); tile.className = 'ql-stat';
        tile.innerHTML = '<div class="ql-stat-label">' + lbl + '</div><div class="ql-stat-value" style="font-size:18px;">' + val + '</div>';
        stats.appendChild(tile);
      });
      detailWrap.appendChild(stats);

      const pre = document.createElement('pre');
      pre.className = 'ql-code';
      pre.style.cssText = 'max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all;margin-top:14px;';
      pre.textContent = r.consensus || t('sanger.noConsensus');
      detailWrap.appendChild(pre);

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;';
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button'; copyBtn.className = 'ql-btn'; copyBtn.textContent = t('sanger.copyFasta');
      copyBtn.addEventListener('click', () => {
        try {
          navigator.clipboard.writeText('>' + r.id + '\n' + r.consensus);
          copyBtn.textContent = t('sanger.copiedFasta');
          setTimeout(() => { copyBtn.textContent = t('sanger.copyFasta'); }, 1600);
        } catch (e) { /* clipboard puede fallar */ }
      });
      const sendBtn = document.createElement('button');
      sendBtn.type = 'button'; sendBtn.className = 'ql-btn'; sendBtn.textContent = t('sanger.sendToPrimers');
      sendBtn.disabled = !r.consensus;
      sendBtn.addEventListener('click', () => sendConsensusToPrimers(r.id, r.consensus));
      btnRow.appendChild(copyBtn); btnRow.appendChild(sendBtn);
      if (r.consensus) {
        if (r.method === 'merged' || r.method === 'stitched' || (r.fLen > 0 && r.rLen > 0)) {
          const ovDetailBtn = document.createElement('button');
          ovDetailBtn.type = 'button';
          ovDetailBtn.className = 'ql-btn';
          ovDetailBtn.textContent = t('sanger.inspectOverlap');
          ovDetailBtn.title = t('sanger.inspectOverlapTitle');
          ovDetailBtn.addEventListener('click', () => {
            openOverlapModal(r, { samples, state: s });
          });
          btnRow.appendChild(ovDetailBtn);
        }

        const compDetailBtn = document.createElement('button');
        compDetailBtn.type = 'button';
        compDetailBtn.className = 'ql-btn';
        compDetailBtn.textContent = t('sanger.compareWithRef');
        let detailPanel = null;
        compDetailBtn.addEventListener('click', () => {
          if (detailPanel && detailPanel.parentElement) {
            detailPanel.remove();
            detailPanel = null;
          } else {
            detailPanel = createComparePanel(r);
            detailWrap.appendChild(detailPanel);
          }
        });
        btnRow.appendChild(compDetailBtn);

        const blastLink = document.createElement('a');
        blastLink.className = 'ql-btn';
        blastLink.href = ncbiBlastUrl(r.consensus);
        blastLink.target = '_blank';
        blastLink.rel = 'noopener';
        blastLink.title = t('sanger.blastTitle');
        blastLink.textContent = t('sanger.blastLink') + ' ↗';
        blastLink.addEventListener('click', () => markExternal('ncbi-blast'));
        btnRow.appendChild(blastLink);
      }
      detailWrap.appendChild(btnRow);
      detailWrap.insertAdjacentHTML('beforeend', '<p class="ql-field-help" style="margin-top:8px;">' + t('sanger.blastNote') + '</p>' +
        moreDetailsHtml(t('ui.moreDetails'), t('sanger.blastNoteMore')));
    }

    const initial = results.find((r) => r.id === s.selectedSampleId) || results[0];
    paintDetail(initial);
  }

  paint();
  return () => {
    if (stopActiveDrag) stopActiveDrag();
    if (trimDebounceTimer) clearTimeout(trimDebounceTimer);
    if (editor) { editor.destroy(); editor = null; }
    if (chromaTooltip) { chromaTooltip.destroy(); chromaTooltip = null; }
  };
}
