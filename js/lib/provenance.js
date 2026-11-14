// provenance.js — lee la PROCEDENCIA que QIIME 2 guarda dentro de cada
// .qza/.qzv: qué acción produjo el artefacto, con qué parámetros, sobre qué
// entradas, con qué versiones y en qué momento.
//
// Por qué esto importa: hasta ahora `ingest.js` abría el .qza y solo miraba
// dentro de `<uuid>/data/`. Todo lo demás venía en el mismo ZIP que ya
// abríamos y se tiraba a la basura. Es la diferencia entre "una matriz de
// distancias" y "la matriz Bray-Curtis que salió de qiime diversity beta
// sobre esta tabla, rarefactada a 1000, con QIIME 2 2024.10".
//
// La estructura de un artefacto, comprobada contra artefactos reales:
//
//   <uuid>/VERSION                      "QIIME 2", archive: N, framework: X
//   <uuid>/metadata.yaml                uuid, type, format
//   <uuid>/data/…                       el contenido (esto ya se leía)
//   <uuid>/provenance/metadata.yaml     metadatos del propio resultado
//   <uuid>/provenance/action/action.yaml  la acción que lo produjo
//   <uuid>/provenance/citations.bib
//   <uuid>/provenance/artifacts/<uuid>/   lo mismo por cada artefacto de
//                                         aguas arriba, recursivamente
//
// Límite conocido y deliberado: NO se resuelve la procedencia interna de los
// pipelines. Cuando una acción es un pipeline, QIIME 2 pone un `alias-of` que
// apunta al resultado interno real, y seguir esa cadena hasta el fondo es lo
// que hace QIIME 2 View con ~800 líneas y un motor de grafos. Aquí se registra
// el `alias-of` y se marca el nodo como pipeline, que es lo que el usuario
// necesita leer; no se despliega el interior.

import { readZipText } from './minizip.js';
import { parseQiimeYaml } from './qiimeYaml.js';

/** Tope de artefactos de aguas arriba que se leen de un archivo. Un .qza de
 *  un análisis largo puede traer cientos; leerlos todos para pintar una lista
 *  que nadie va a recorrer entera no compensa. Si se pasa, se dice. */
export const MAX_UPSTREAM = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Acciones que no tienen entradas de QIIME 2 aguas arriba: ahí acaba la cadena. */
const ROOT_ACTIONS = ['import'];

/** `true` si la cadena es un UUID con el formato que usa QIIME 2. */
export function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

/** Busca una entrada del ZIP por su ruta relativa dentro del artefacto. */
function findEntry(entries, uuid, relPath) {
  const want = uuid + '/' + relPath;
  return entries.find((e) => e.name === want) || null;
}

/** Lee y parsea un YAML de dentro del artefacto; null si no está o no se lee. */
async function readYaml(buffer, entries, uuid, relPath) {
  const entry = findEntry(entries, uuid, relPath);
  if (!entry) return null;
  try {
    return parseQiimeYaml(await readZipText(buffer, entry));
  } catch (e) {
    return null;
  }
}

/**
 * Lee el archivo `VERSION`, que no es YAML: son tres líneas sueltas
 * ("QIIME 2", "archive: 5", "framework: 2025.10.0").
 */
async function readVersion(buffer, entries, uuid) {
  const entry = findEntry(entries, uuid, 'VERSION');
  if (!entry) return { archive: null, framework: null };
  let text = '';
  try { text = await readZipText(buffer, entry); } catch (e) { return { archive: null, framework: null }; }
  const archive = /^\s*archive:\s*(.+)$/m.exec(text);
  const framework = /^\s*framework:\s*(.+)$/m.exec(text);
  return {
    archive: archive ? archive[1].trim() : null,
    framework: framework ? framework[1].trim() : null,
  };
}

/** El valor de una etiqueta `!ref` es el nombre del plugin; si no, la cadena. */
function pluginName(v) {
  if (v && typeof v === 'object' && v.tag === 'ref') return v.plugin;
  return typeof v === 'string' ? v : null;
}

/**
 * Las entradas de una acción vienen como una lista de mapas de una sola clave,
 * donde el valor es un UUID, una lista de UUID (una List), un mapa
 * (una Collection) o null (una entrada opcional sin usar).
 * @returns {{name:string, uuids:string[], empty:boolean}[]}
 */
function normalizeInputs(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const name = Object.keys(entry)[0];
    if (name === undefined) return;
    const value = entry[name];
    const uuids = [];
    const collect = (v) => {
      if (v == null) return;
      if (typeof v === 'string') { if (isUuid(v)) uuids.push(v); return; }
      if (v && typeof v === 'object' && v.tag === 'no-provenance') { uuids.push(v.uuid); return; }
      if (Array.isArray(v)) { v.forEach(collect); return; }
      if (typeof v === 'object') { Object.values(v).forEach(collect); }
    };
    collect(value);
    out.push({ name, uuids, empty: value == null });
  });
  return out;
}

/**
 * Los parámetros también son una lista de mapas de una sola clave. Se clasifican
 * para que la interfaz pueda mostrarlos sin volver a mirar las etiquetas:
 * `metadata` cuando el valor es un `!metadata`, `empty` cuando no se pasó, y
 * `scalar` en el resto.
 * @returns {{name:string, kind:'scalar'|'metadata'|'empty', value:string, file?:string, artifacts?:string[]}[]}
 */
function normalizeParameters(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const name = Object.keys(entry)[0];
    if (name === undefined) return;
    const v = entry[name];
    if (v == null) { out.push({ name, kind: 'empty', value: '' }); return; }
    if (typeof v === 'object' && v.tag === 'metadata') {
      out.push({ name, kind: 'metadata', value: v.file, file: v.file, artifacts: v.artifacts || [] });
      return;
    }
    if (typeof v === 'object' && v.tag === 'set') {
      out.push({ name, kind: 'scalar', value: (v.value || []).join(', ') });
      return;
    }
    if (typeof v === 'object' && v.tag === 'color') { out.push({ name, kind: 'scalar', value: v.value }); return; }
    if (Array.isArray(v)) { out.push({ name, kind: 'scalar', value: v.map((x) => fmtScalar(x)).join(', ') }); return; }
    out.push({ name, kind: 'scalar', value: fmtScalar(v) });
  });
  return out;
}

function fmtScalar(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.tag === 'ref') return v.plugin;
    if (v.tag === 'cite') return v.key;
    if (v.tag === 'metadata') return v.file;
    if (v.tag === 'set') return (v.value || []).join(', ');
    if (v.value !== undefined) return String(v.value);
    return '';
  }
  return String(v);
}

/** Versiones de los plugins declarados en el entorno de una acción. */
function normalizePlugins(env) {
  const plugins = env && env.plugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return [];
  return Object.keys(plugins).map((name) => {
    const p = plugins[name] || {};
    return { name, version: p.version != null ? String(p.version) : null, website: p.website || null };
  });
}

/**
 * Convierte un `action.yaml` crudo en la forma que consume la interfaz.
 * @param {object|null} raw
 * @returns {object|null}
 */
export function normalizeAction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw.action || {};
  const ex = raw.execution || {};
  const env = raw.environment || {};
  const runtime = ex.runtime || {};
  const framework = env.framework || {};
  return {
    type: a.type || null,
    plugin: pluginName(a.plugin),
    action: a.action || null,
    outputName: a['output-name'] || null,
    aliasOf: a['alias-of'] || null,
    isRoot: ROOT_ACTIONS.includes(a.type),
    inputs: normalizeInputs(a.inputs),
    parameters: normalizeParameters(a.parameters),
    executionUuid: ex.uuid || null,
    runtime: {
      start: runtime.start || null,
      end: runtime.end || null,
      duration: runtime.duration || null,
    },
    frameworkVersion: framework.version != null ? String(framework.version) : null,
    platform: env.platform || null,
    plugins: normalizePlugins(env),
  };
}

/**
 * Lee la procedencia completa de un artefacto ya abierto como ZIP.
 *
 * No lanza nunca: un artefacto sin `provenance/` (los hay, y los nuestros de
 * ejemplo son así) devuelve `hasProvenance: false` y el resto de campos a
 * null, porque la importación del dato NO debe fallar por no poder leer de
 * dónde viene.
 *
 * @param {ArrayBuffer|Uint8Array} buffer  el .qza/.qzv entero
 * @param {{name:string}[]} entries  entradas del ZIP (de `listZipEntries`)
 * @returns {Promise<{
 *   uuid:string|null, type:string|null, format:string|null,
 *   archiveVersion:string|null, frameworkVersion:string|null,
 *   hasProvenance:boolean, action:object|null,
 *   upstream:{uuid:string, type:string|null, format:string|null, action:object|null}[],
 *   upstreamTruncated:boolean, isVisualization:boolean
 * }>}
 */
export async function readProvenance(buffer, entries) {
  const empty = {
    uuid: null, type: null, format: null,
    archiveVersion: null, frameworkVersion: null,
    hasProvenance: false, action: null,
    upstream: [], upstreamTruncated: false, isVisualization: false,
  };
  if (!Array.isArray(entries) || !entries.length) return empty;

  // La raíz del ZIP es una única carpeta con el UUID del artefacto.
  const roots = new Set();
  entries.forEach((e) => {
    const first = e.name.split('/')[0];
    if (isUuid(first)) roots.add(first);
  });
  if (roots.size !== 1) return empty;
  const uuid = [...roots][0];

  const meta = await readYaml(buffer, entries, uuid, 'metadata.yaml');
  const version = await readVersion(buffer, entries, uuid);
  const actionRaw = await readYaml(buffer, entries, uuid, 'provenance/action/action.yaml');

  // artefactos de aguas arriba: provenance/artifacts/<uuid>/…
  const upstreamUuids = [];
  const seen = new Set();
  const prefix = uuid + '/provenance/artifacts/';
  entries.forEach((e) => {
    if (!e.name.startsWith(prefix)) return;
    const id = e.name.slice(prefix.length).split('/')[0];
    if (isUuid(id) && !seen.has(id)) { seen.add(id); upstreamUuids.push(id); }
  });

  const truncated = upstreamUuids.length > MAX_UPSTREAM;
  const upstream = [];
  for (const id of upstreamUuids.slice(0, MAX_UPSTREAM)) {
    const m = await readYaml(buffer, entries, uuid, 'provenance/artifacts/' + id + '/metadata.yaml');
    const act = await readYaml(buffer, entries, uuid, 'provenance/artifacts/' + id + '/action/action.yaml');
    upstream.push({
      uuid: id,
      type: m && m.type ? String(m.type) : null,
      format: m && m.format ? String(m.format) : null,
      action: normalizeAction(act),
    });
  }

  const action = normalizeAction(actionRaw);
  return {
    uuid: (meta && meta.uuid) ? String(meta.uuid) : uuid,
    type: meta && meta.type ? String(meta.type) : null,
    format: meta && meta.format ? String(meta.format) : null,
    archiveVersion: version.archive,
    frameworkVersion: version.framework || (action && action.frameworkVersion) || null,
    hasProvenance: !!action,
    action,
    upstream,
    upstreamTruncated: truncated,
    isVisualization: !!(meta && meta.type === 'Visualization'),
  };
}

/**
 * Ordena la procedencia como una cadena legible de arriba abajo: primero los
 * `import` (de dónde salieron los datos), al final la acción que produjo este
 * artefacto. Es el orden en el que una persona lo cuenta en la sección de
 * métodos, no el orden en el que está guardado.
 *
 * El orden se obtiene por profundidad en el grafo de entradas. Los nodos que
 * no cuelgan de la raíz (los internos de un pipeline, que no desplegamos)
 * quedan al final, para que no se pierdan.
 *
 * @param {object} prov  resultado de readProvenance()
 * @returns {{uuid:string, type:string|null, action:object|null, depth:number, isFinal:boolean}[]}
 */
export function provenanceChain(prov) {
  if (!prov || !prov.action) return [];
  const byUuid = new Map();
  prov.upstream.forEach((u) => byUuid.set(u.uuid, u));

  const depth = new Map();
  const visit = (id, d, guard) => {
    if (guard.has(id)) return; // ciclo: imposible en teoría, barato de descartar
    guard.add(id);
    const prev = depth.get(id);
    if (prev === undefined || d > prev) depth.set(id, d);
    const node = byUuid.get(id);
    if (!node || !node.action) { guard.delete(id); return; }
    node.action.inputs.forEach((inp) => inp.uuids.forEach((up) => visit(up, d + 1, guard)));
    guard.delete(id);
  };
  prov.action.inputs.forEach((inp) => inp.uuids.forEach((id) => visit(id, 1, new Set())));

  const chain = [...depth.entries()]
    .map(([id, d]) => {
      const node = byUuid.get(id) || { uuid: id, type: null, format: null, action: null };
      return { uuid: id, type: node.type, format: node.format, action: node.action, depth: d, isFinal: false };
    })
    // más profundo = más arriba en el análisis = primero al contarlo
    .sort((a, b) => (b.depth - a.depth) || a.uuid.localeCompare(b.uuid));

  // los que no cuelgan de la raíz (internos de pipeline) van detrás
  const inChain = new Set(chain.map((c) => c.uuid));
  prov.upstream.forEach((u) => {
    if (!inChain.has(u.uuid)) {
      chain.push({ uuid: u.uuid, type: u.type, format: u.format, action: u.action, depth: 0, isFinal: false });
    }
  });

  chain.push({
    uuid: prov.uuid, type: prov.type, format: prov.format,
    action: prov.action, depth: 0, isFinal: true,
  });
  return chain;
}
