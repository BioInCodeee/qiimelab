// "Descargar script R": piezas comunes para generar, a partir de la sesión
// actual, un script de R que reproduce un análisis de Smart-175 con los
// paquetes de referencia (vegan, ape, stats…). Solo para los métodos de
// Nivel A/B de methodEquivalence.js — los de Nivel C necesitan otro enfoque
// (ejecutar la herramienta original, no traducir la aproximación) y quedan
// fuera a propósito.
//
// Los scripts se escriben SIEMPRE en español (comentarios para alguien que
// sabe R básico pero no conoce la app), sea cual sea el idioma de la
// interfaz; los botones sí van por i18n.
//
// Datos: una tabla de hasta R_EMBED_MAX_ROWS filas va DENTRO del script
// como data.frame() (autocontenido); si es más grande, el script la lee de
// un .tsv con nombre y columnas fijos, y el botón "Descargar datos para R"
// que aparece al lado exporta ese .tsv tal cual lo espera el script.

import { t, tIn } from './i18n.js';
import { METHODS } from './methodEquivalence.js';

export const R_EMBED_MAX_ROWS = 500;

/** Literal de cadena de R. */
export function rStr(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
}

/** Número de R con precisión completa (String() de JS ya da la
 *  representación más corta que vuelve al mismo double); NA si no es finito. */
export function rNum(x) {
  return (typeof x === 'number' && Number.isFinite(x)) ? String(x) : 'NA';
}

/** c(...) partido en líneas de ~90 caracteres, con sangría. */
export function rVec(values, type = 'num', indent = '  ') {
  const items = values.map((v) => (type === 'str' ? (v == null ? 'NA' : rStr(v)) : rNum(v)));
  if (!items.length) return type === 'str' ? 'character(0)' : 'numeric(0)';
  const lines = [];
  let cur = '';
  items.forEach((it, i) => {
    const piece = it + (i < items.length - 1 ? ', ' : '');
    if (cur && (cur + piece).length > 90) { lines.push(cur.trimEnd()); cur = ''; }
    cur += piece;
  });
  if (cur) lines.push(cur.trimEnd());
  if (lines.length === 1) return 'c(' + lines[0] + ')';
  return 'c(\n' + lines.map((l) => indent + '  ' + l).join('\n') + '\n' + indent + ')';
}

/** Comentario de R con ajuste de línea (~78 columnas). */
export function rComment(text, prefix = '# ') {
  const out = [];
  String(text).split('\n').forEach((para) => {
    if (!para.trim()) { out.push(prefix.trimEnd()); return; }
    const lead = (para.match(/^\s*(- )?/) || [''])[0];
    const words = para.trim().split(/\s+/);
    let line = '';
    words.forEach((w) => {
      if (line && (prefix + line + ' ' + w).length > 78) {
        out.push(prefix + line);
        line = ' '.repeat(lead.length) + w;
      } else {
        line = line ? line + ' ' + w : w;
      }
    });
    if (line) out.push(prefix + line);
  });
  return out.join('\n');
}

function tsvCell(v, type) {
  if (type === 'str') return v == null ? 'NA' : String(v).replace(/[\t\n\r]/g, ' ');
  return rNum(v);
}

/**
 * Una tabla de datos del script: embebida como data.frame() si cabe, o
 * leída de un .tsv que se descarga aparte con el botón de datos.
 *
 * @param {string} varName  nombre del objeto en R
 * @param {{name:string, values:Array, type:'num'|'str'}[]} columns  todas de la misma longitud
 * @param {{ file:string, what:string }} opt  `file` = nombre del .tsv si no cabe;
 *        `what` = descripción en una frase (para el comentario)
 * @returns {{ code:string, dataFile: null | {filename:string, text:string} }}
 */
export function rTable(varName, columns, { file, what }) {
  const nRows = columns.length ? columns[0].values.length : 0;
  if (nRows <= R_EMBED_MAX_ROWS) {
    const cols = columns.map((c) => '  ' + rStr(c.name) + ' = ' + rVec(c.values, c.type, '  '));
    return {
      code: rComment(what + ' (' + nRows + ' filas, incluidas en el propio script).') + '\n' +
        varName + ' <- data.frame(\n' + cols.join(',\n') + ',\n  check.names = FALSE, stringsAsFactors = FALSE\n)',
      dataFile: null,
    };
  }
  const header = columns.map((c) => c.name.replace(/[\t\n\r]/g, ' ')).join('\t');
  const lines = [header];
  for (let i = 0; i < nRows; i++) lines.push(columns.map((c) => tsvCell(c.values[i], c.type)).join('\t'));
  const colList = columns.map((c) => c.name);
  // tablas anchas (una columna por muestra: conteos, matrices de distancias):
  // se describen por su forma en vez de listar cientos de nombres
  const wide = colList.length > 30;
  const colDesc = wide
    ? 'primera columna "' + colList[0] + '" y después ' + (colList.length - 1) + ' columnas (' +
      colList.slice(1, 4).join(', ') + ', …, ' + colList[colList.length - 1] + ')'
    : colList.join(', ');
  const colTypes = wide
    ? 'c(' + rStr(columns[0].type === 'str' ? 'character' : 'numeric') + ', rep(' +
      rStr(columns[1].type === 'str' ? 'character' : 'numeric') + ', ' + (colList.length - 1) + '))'
    : rVec(columns.map((c) => (c.type === 'str' ? 'character' : 'numeric')), 'str', '  ');
  const code = rComment(what + ' (' + nRows + ' filas). Es demasiado grande para ir dentro del script: ' +
      'descárgalo con el botón "Descargar datos para R" de Smart-175 (junto al botón de este script) y ' +
      'guárdalo en la misma carpeta que este archivo, con el nombre "' + file + '". ' +
      'Es un texto separado por tabuladores, en UTF-8, con estas columnas en este orden:') + '\n' +
    rComment(colDesc, '#   ') + '\n' +
    '# (si R no lo encuentra, usa setwd() para ir a esa carpeta o pon aquí la ruta completa)\n' +
    varName + ' <- read.delim(' + rStr(file) + ', check.names = FALSE, stringsAsFactors = FALSE,\n' +
    '  quote = "", na.strings = "NA", encoding = "UTF-8", colClasses = ' + colTypes + ')\n' +
    (wide
      ? 'stopifnot(ncol(' + varName + ') == ' + colList.length + ', colnames(' + varName + ')[1] == ' + rStr(colList[0]) + ')'
      : 'stopifnot(identical(colnames(' + varName + '), ' + rVec(colList, 'str') + '))');
  return { code, dataFile: { filename: file, text: lines.join('\n') + '\n' } };
}

/** Texto de la nota de validación (Nivel A/B/C) tal cual lo muestra la app
 *  junto al resultado (claves equiv.* de i18n, en español). */
export function validationNote(ids) {
  const byLevel = { A: [], B: [], C: [] };
  ids.forEach((id) => {
    const m = METHODS[id];
    if (m && !byLevel[m.level].some((x) => x.tool === m.tool)) byLevel[m.level].push(m);
  });
  const parts = [];
  if (byLevel.A.length) {
    parts.push(tIn('es', 'equiv.levelATitle') + ' ' + tIn('es', 'equiv.levelABody', { tool: byLevel.A.map((m) => m.tool).join(' · ') }));
  }
  if (byLevel.B.length) {
    parts.push(tIn('es', 'equiv.levelBTitle') + ' ' + tIn('es', 'equiv.levelBBody', { tool: byLevel.B.map((m) => m.tool).join(' · ') }));
  }
  if (byLevel.C.length) {
    const tools = byLevel.C.map((m) => m.tool).join(' · ');
    const where = [...new Set(byLevel.C.map((m) => m.where).filter(Boolean))].join(' · ');
    parts.push(tIn('es', 'equiv.levelCTitle') + ' ' + tIn('es', where ? 'equiv.levelCBody' : 'equiv.levelCBodyNoWhere', { tool: tools, where }));
  }
  return parts;
}

/**
 * Cabecera comentada común.
 * @param {{ title:string, what:string, functions:string[], methodIds:string[], params:[string,string][], notes?:string[] }} o
 */
export function rHeader(o) {
  const bar = '# ' + '='.repeat(74);
  const out = [bar, '#  Smart-175 · script de R equivalente', '#  ' + o.title,
    '#  Generado el ' + new Date().toISOString().slice(0, 10) + ' con los datos y opciones de la sesión.', bar, '#'];
  out.push('# QUÉ REPRODUCE', rComment(o.what), '#');
  out.push('# PAQUETES Y FUNCIONES DE R QUE USA');
  o.functions.forEach((f) => out.push(rComment('- ' + f)));
  out.push('#');
  const notes = validationNote(o.methodIds || []);
  if (notes.length) {
    out.push('# NOTA DE VALIDACIÓN (el texto de Smart-175 para este método)');
    notes.forEach((n) => out.push(rComment(n, '#   ')));
    out.push('#');
  }
  out.push('# PARÁMETROS DE ESTA SESIÓN');
  o.params.forEach(([k, v]) => out.push(rComment('- ' + k + ': ' + v)));
  (o.notes || []).forEach((n) => { out.push('#'); out.push(rComment(n)); });
  out.push('#', '# Cómo usarlo: abre este archivo en RStudio (o en R) y ejecútalo entero', '# (en RStudio: botón "Source"). Los resultados salen en la consola.', bar);
  return out.join('\n');
}

/** Bloque "# Paquetes necesarios". */
export function rPackages(pkgs) {
  const out = ['', '# ---- Paquetes necesarios ' + '-'.repeat(50)];
  if (!pkgs.length) {
    out.push('# Solo se usan funciones de R base (paquete "stats", que ya viene con R):', '# no hace falta instalar nada.');
    return out.join('\n');
  }
  out.push('# Si no los tienes instalados, quita el "#" de la línea siguiente y',
    '# ejecútala una sola vez:',
    '# install.packages(' + (pkgs.length === 1 ? rStr(pkgs[0]) : 'c(' + pkgs.map(rStr).join(', ') + ')') + ')');
  pkgs.forEach((p) => out.push('suppressPackageStartupMessages(library(' + p + '))'));
  return out.join('\n');
}

/** Encabezado de sección dentro del script. */
export function rSection(title) {
  return '\n# ---- ' + title + ' ' + '-'.repeat(Math.max(4, 68 - title.length));
}

/** Descarga un texto como archivo. */
export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* noop */ } }, 4000);
  } catch (e) { /* entorno restringido */ }
}

const R_ICON = '<svg aria-hidden="true" focusable="false" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><path d="m9 9 3 3-3 3"/><path d="M14 15h4"/></svg>';

/**
 * Botón "Descargar script R" (y, si los datos no caben en el script, el
 * botón de datos al lado). Mismo aspecto en la barra del editor de gráficos
 * y en las tablas que no pasan por él (PERMANOVA).
 *
 * @param {{ build: () => ({ filename:string, text:string, dataFiles:{filename:string,text:string}[] }),
 *           hasDataFiles?: boolean }} cfg
 *   `build` se llama al pulsar (no en cada repintado). `hasDataFiles`: si
 *   el módulo ya sabe que alguna tabla supera R_EMBED_MAX_ROWS.
 */
export function rScriptControls(cfg) {
  const wrap = document.createElement('span');
  wrap.className = 'ql-rscript';
  const mk = (label, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ql-btn ql-rscript-btn';
    b.title = title;
    b.innerHTML = R_ICON + '<span>' + label + '</span>';
    b.addEventListener('click', onClick);
    return b;
  };
  wrap.appendChild(mk(t('rscript.btn'), t('rscript.btnTitle'), () => {
    const s = cfg.build();
    if (s) downloadText(s.filename, s.text);
  }));
  if (cfg.hasDataFiles) {
    wrap.appendChild(mk(t('rscript.dataBtn'), t('rscript.dataBtnTitle'), () => {
      const s = cfg.build();
      (s && s.dataFiles || []).forEach((f) => downloadText(f.filename, f.text, 'text/tab-separated-values;charset=utf-8'));
    }));
  }
  return wrap;
}

/** Junta las piezas de un script y recoge los archivos de datos externos. */
export function assembleScript(filename, parts) {
  const dataFiles = [];
  const text = parts.map((p) => {
    if (p && typeof p === 'object') { if (p.dataFile) dataFiles.push(p.dataFile); return p.code; }
    return p;
  }).filter((p) => p != null && p !== '').join('\n') + '\n';
  return { filename, text, dataFiles };
}
