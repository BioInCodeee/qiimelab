// qiimeYaml.js — lector del subconjunto de YAML que escribe QIIME 2 en los
// `metadata.yaml` y `action.yaml` de dentro de un .qza/.qzv.
//
// NO es un parser de YAML de propósito general, y no pretende serlo: YAML
// completo son miles de líneas y aquí sobran. QIIME 2 escribe estos archivos
// con PyYAML y un volcado muy regular, así que basta cubrir lo que de verdad
// aparece. Lo que soporta, comprobado contra artefactos reales:
//
//   - mapas anidados por indentación            clave:
//                                                   otra: valor
//   - secuencias de mapas de una sola clave     -   sequences: <uuid>
//   - secuencias de escalares                   - !cite 'framework|qiime2...'
//   - escalares con y sin comillas              version: '1.23'
//   - escalares de bloque                       python: |-
//   - las etiquetas propias de QIIME 2 (abajo)
//
// Decisión deliberada: los valores se quedan como CADENAS, no se convierten a
// número ni a booleano. Es lo mismo que hace QIIME 2 View (usa el CORE_SCHEMA
// de js-yaml justo para esto) y evita de un golpe toda la fama de YAML con los
// tipos: que `1.0` pierda el `.0` al mostrarlo, que `'18.0'` y `18.0` acaben
// iguales, o que un parámetro con valor `no` se convierta en `false`. Aquí
// estos datos se muestran y se buscan, no se opera con ellos. Lo único que sí
// se interpreta son las formas nulas de YAML (`null`, `~`, vacío) → null,
// porque un parámetro sin valor hay que distinguirlo de la cadena "null".
//
// Las etiquetas de QIIME 2 (mismo vocabulario que `yaml-schema.ts` de q2view):
//   !ref 'environment:plugins:diversity' → { tag:'ref', plugin:'diversity' }
//   !cite 'framework|qiime2:2018.11.0|0' → { tag:'cite', key:'…' }
//   !metadata 'metadata.tsv'             → { tag:'metadata', file, artifacts:[] }
//   !metadata '<uuid>,<uuid>:col.tsv'    → artifacts con los uuid de delante
//   !no-provenance '<uuid>'              → { tag:'no-provenance', uuid }
//   !color '#ff0000'                     → { tag:'color', value }
//   !set [a, b]                          → { tag:'set', value:[…] }

/** Formas con las que YAML escribe el nulo. */
const NULL_RE = /^(null|~|Null|NULL)$/;

/** Quita las comillas de un escalar y deshace los escapes que PyYAML genera. */
function unquote(raw) {
  const s = raw.trim();
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return s;
}

/**
 * Interpreta una etiqueta propia de QIIME 2. Devuelve el objeto etiquetado, o
 * `undefined` si el escalar no lleva etiqueta.
 */
function parseTag(raw) {
  const s = raw.trim();
  if (s[0] !== '!') return undefined;
  const m = /^(![\w-]+)\s*([\s\S]*)$/.exec(s);
  if (!m) return undefined;
  const tag = m[1].slice(1);
  const rest = m[2].trim();
  const value = unquote(rest);

  if (tag === 'ref') {
    // 'environment:plugins:<plugin>' — el nombre del plugin es la 3ª parte
    const parts = value.split(':');
    return { tag: 'ref', value, plugin: parts.length >= 3 ? parts[2] : value };
  }
  if (tag === 'cite') return { tag: 'cite', key: value };
  if (tag === 'metadata') {
    // 'fichero.tsv' o '<uuid>,<uuid>:fichero.tsv'
    const idx = value.lastIndexOf(':');
    if (idx === -1) return { tag: 'metadata', file: value, artifacts: [] };
    return {
      tag: 'metadata',
      file: value.slice(idx + 1),
      artifacts: value.slice(0, idx).split(',').map((x) => x.trim()).filter(Boolean),
    };
  }
  if (tag === 'no-provenance') return { tag: 'no-provenance', uuid: value };
  if (tag === 'color') return { tag: 'color', value };
  if (tag === 'set') {
    // forma en línea: !set ['a', 'b'] — la forma en bloque la resuelve el
    // lector de secuencias y llega aquí sin corchetes
    const inner = /^\[([\s\S]*)\]$/.exec(value);
    const items = inner
      ? inner[1].split(',').map((x) => unquote(x)).filter((x) => x !== '')
      : (value === '' ? [] : [value]);
    return { tag: 'set', value: items };
  }
  return { tag, value };
}

/** Convierte un escalar en su valor final (null, etiqueta, colección en línea
 *  o cadena). QIIME 2 escribe `parameters: []` y `plugins: {}` cuando una
 *  acción no lleva ninguno, y eso TIENE que llegar como colección vacía: si
 *  llega como la cadena "[]", quien recorra los parámetros se encuentra dos
 *  caracteres en vez de una lista. */
function scalar(raw) {
  const s = raw.trim();
  if (s === '' || NULL_RE.test(s)) return null;
  const tagged = parseTag(s);
  if (tagged !== undefined) return tagged;
  if (s === '[]') return [];
  if (s === '{}') return {};
  // lista en línea de escalares simples, sin anidar: [a, b, c]
  const flow = /^\[([^[\]{}]*)\]$/.exec(s);
  if (flow) {
    const inner = flow[1].trim();
    return inner === '' ? [] : inner.split(',').map((x) => scalar(x));
  }
  return unquote(s);
}

/** Ancho de la indentación de una línea (los tabuladores cuentan como 1). */
function indentOf(line) {
  let n = 0;
  while (n < line.length && (line[n] === ' ' || line[n] === '\t')) n++;
  return n;
}

/**
 * Lee un escalar de bloque (`|`, `|-`, `>`, `|+`, `>-`): todas las líneas
 * siguientes con más indentación que `parentIndent`.
 * @returns {{value:string, next:number}} el texto y el índice de la siguiente
 *   línea sin consumir.
 */
function readBlockScalar(lines, start, parentIndent, header) {
  const folded = header[0] === '>';
  const chomp = header.includes('-') ? 'strip' : (header.includes('+') ? 'keep' : 'clip');
  const out = [];
  let i = start;
  let blockIndent = -1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') { out.push(''); continue; }
    const ind = indentOf(line);
    if (ind <= parentIndent) break;
    if (blockIndent === -1) blockIndent = ind;
    out.push(line.slice(Math.min(blockIndent, ind)));
  }
  // quitar las líneas en blanco del final según el indicador de recorte
  while (out.length && out[out.length - 1] === '') out.pop();
  let value = folded ? out.join(' ') : out.join('\n');
  if (chomp === 'clip' && value !== '') value += '\n';
  if (chomp === 'keep') value += '\n';
  return { value, next: i };
}

/**
 * Lee el bloque que empieza en `start` con indentación `indent`, sea un mapa o
 * una secuencia, y devuelve el valor con el índice de la primera línea que ya
 * no le pertenece.
 */
function parseBlock(lines, start, indent) {
  // ¿secuencia o mapa? lo dice la primera línea con contenido
  let i = start;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return { value: null, next: i };

  const isSeq = /^-(\s|$)/.test(lines[i].slice(indentOf(lines[i])));
  return isSeq ? parseSequence(lines, i, indent) : parseMap(lines, i, indent);
}

function parseSequence(lines, start, indent) {
  const out = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    const ind = indentOf(line);
    // Solo son hermanos los guiones a ESTA indentación: uno más indentado
    // pertenece a una estructura anidada dentro del elemento anterior (p. ej.
    // la lista `citations:` de un transformador), no a esta secuencia.
    if (ind !== indent) break;
    const body = line.slice(ind);
    if (!/^-(\s|$)/.test(body)) break;

    // "-   clave: valor" / "- escalar" / "-" seguido de bloque indentado
    const afterDash = body.replace(/^-\s*/, '');
    const dashOffset = body.length - afterDash.length; // columnas hasta el contenido
    if (afterDash === '') {
      const inner = parseBlock(lines, i + 1, ind + 1);
      out.push(inner.value);
      i = inner.next;
      continue;
    }
    // ¿es "clave: valor"? ojo con las etiquetas y las horas (2018-11-08T17:59)
    const kv = splitKeyValue(afterDash);
    if (kv) {
      // un elemento de secuencia que es un mapa: puede tener más claves en
      // líneas siguientes con la indentación del contenido tras el guion
      const itemIndent = ind + dashOffset;
      const sub = parseMapInline(lines, i, itemIndent, kv, afterDash);
      out.push(sub.value);
      i = sub.next;
      continue;
    }
    out.push(scalar(afterDash));
    i++;
  }
  return { value: out, next: i };
}

/**
 * Separa "clave: valor" sin romperse con lo que NO es un mapa: una etiqueta
 * (`!cite 'a|b:c'`), una hora ISO (`2018-11-08T17:59:39-07:00`) o una URL.
 * @returns {{key:string, rest:string}|null}
 */
function splitKeyValue(text) {
  if (text[0] === '!') return null;
  const m = /^([^:\s][^:]*?):(\s|$)/.exec(text);
  if (!m) return null;
  return { key: unquote(m[1]), rest: text.slice(m[0].length - (m[2] === '' ? 0 : m[2].length)).trim() };
}

/** Mapa cuya primera clave ya viene leída (elemento de secuencia). */
function parseMapInline(lines, start, itemIndent, firstKv, firstBody) {
  const obj = {};
  const assign = (key, rest, lineIdx, indent) => {
    if (rest === '' || NULL_RE.test(rest)) {
      // ¿bloque anidado debajo? Una secuencia puede ir a la MISMA indentación
      // que su clave (YAML lo permite y QIIME 2 lo usa para `citations:`),
      // así que no basta con exigir más indentación.
      let j = lineIdx + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length) {
        const nextInd = indentOf(lines[j]);
        const isSeqChild = /^-(\s|$)/.test(lines[j].slice(nextInd));
        if (nextInd > indent || (isSeqChild && nextInd === indent)) {
          const inner = parseBlock(lines, j, nextInd);
          obj[key] = inner.value;
          return inner.next;
        }
      }
      obj[key] = null;
      return lineIdx + 1;
    }
    const bs = /^([|>][-+]?)\s*$/.exec(rest);
    if (bs) {
      const blk = readBlockScalar(lines, lineIdx + 1, indent, bs[1]);
      obj[key] = blk.value;
      return blk.next;
    }
    obj[key] = scalar(rest);
    return lineIdx + 1;
  };

  let i = assign(firstKv.key, firstKv.rest, start, itemIndent);
  // claves siguientes del MISMO elemento: exactamente a itemIndent y sin guion
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    const ind = indentOf(line);
    if (ind !== itemIndent) break;
    const body = line.slice(ind);
    if (/^-(\s|$)/.test(body)) break;
    const kv = splitKeyValue(body);
    if (!kv) break;
    i = assign(kv.key, kv.rest, i, itemIndent);
  }
  return { value: obj, next: i };
}

function parseMap(lines, start, indent) {
  const obj = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) { i++; continue; }
    const ind = indentOf(line);
    if (ind < indent) break;
    const body = line.slice(ind);
    if (/^-(\s|$)/.test(body)) break; // la secuencia es de quien nos llamó
    if (body === '---' || body === '...') { i++; continue; }

    const kv = splitKeyValue(body);
    if (!kv) { i++; continue; } // línea que no sabemos leer: se ignora, no se rompe

    const { key, rest } = kv;
    const bs = /^([|>][-+]?)\s*$/.exec(rest);
    if (bs) {
      const blk = readBlockScalar(lines, i + 1, ind, bs[1]);
      obj[key] = blk.value;
      i = blk.next;
      continue;
    }
    if (rest === '') {
      // bloque anidado (mapa o secuencia) o clave sin valor
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length) {
        const nextInd = indentOf(lines[j]);
        const nextBody = lines[j].slice(nextInd);
        const isSeqChild = /^-(\s|$)/.test(nextBody);
        // una secuencia puede ir a la MISMA indentación que su clave
        if (nextInd > ind || (isSeqChild && nextInd === ind)) {
          const inner = parseBlock(lines, j, nextInd);
          obj[key] = inner.value;
          i = inner.next;
          continue;
        }
      }
      obj[key] = null;
      i++;
      continue;
    }
    obj[key] = scalar(rest);
    i++;
  }
  return { value: obj, next: i };
}

/**
 * Lee un YAML de QIIME 2 a objeto. Nunca lanza por contenido inesperado: lo
 * que no sabe leer se omite, porque un `action.yaml` de una versión futura con
 * una clave nueva debe seguir dando la procedencia que sí se entiende, no un
 * error que tire la importación entera.
 *
 * @param {string} text
 * @returns {object}
 */
export function parseQiimeYaml(text) {
  if (typeof text !== 'string' || text.trim() === '') return {};
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const { value } = parseBlock(lines, 0, 0);
  return (value && typeof value === 'object') ? value : {};
}
