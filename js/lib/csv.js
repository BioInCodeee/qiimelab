// Parser/serializador de CSV y TSV, sin dependencias.
// Soporta comillas, comas/tabs escapados dentro de campos, y CRLF/LF.

export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === delimiter) { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

// Detecta si el texto es más probablemente TSV o CSV mirando la primera línea.
export function detectDelimiter(text) {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs >= commas ? '\t' : ',';
}

// Parsea texto delimitado en {headers, rows} donde rows es un array de objetos {header: valor}.
export function parseTable(text, delimiter) {
  const delim = delimiter || detectDelimiter(text);
  const rows = parseDelimited(text, delim);
  if (rows.length === 0) return { headers: [], rows: [], raw: [] };
  const headers = rows[0].map((h) => h.trim());
  const objRows = rows.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, idx) => { o[h] = r[idx] !== undefined ? r[idx] : ''; });
    return o;
  });
  return { headers, rows: objRows, raw: rows.slice(1) };
}

export function normalizeHeader(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Serializa {headers, rows} a texto delimitado, entrecomillando solo los
 * campos que lo necesitan (los que llevan el delimitador, comillas o salto de
 * línea), con las comillas internas duplicadas — que es justo lo que
 * `parseDelimited` sabe deshacer.
 * @param {string[]} headers
 * @param {Array<Object>} rows Objetos {cabecera: valor}.
 * @param {string} [delimiter='\t'] TSV por defecto, que es la convención de
 *   los metadatos de QIIME2.
 * @returns {string} Termina en salto de línea.
 */
export function toDelimitedText(headers, rows, delimiter = '\t') {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(delimiter)];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(delimiter));
  return lines.join('\n') + '\n';
}
