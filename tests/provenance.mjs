// tests/provenance.mjs — el lector de YAML de QIIME 2 (js/lib/qiimeYaml.js) y
// el lector de procedencia que va encima (js/lib/provenance.js).
//
// Cómo se validó el parser al escribirlo, que es la parte que no se puede
// repetir aquí: se extrajeron los 626 `action.yaml` y `metadata.yaml` reales
// de los 30 artefactos de prueba de `qiime2/provenance_lib` (versiones de
// archivo 0 a 5, de 2016 a 2022) y se comparó la salida contra PyYAML con el
// mismo esquema de etiquetas que usa QIIME 2 View. Resultado: 626 de 626
// idénticos, cero excepciones. Esos artefactos NO se traen al repo (son
// datos de prueba de otro proyecto y pesan de más), así que lo que queda aquí
// son casos escritos a mano que ejercitan la MISMA gramática, más el .qza de
// ejemplo del repo, al que se le añadió una procedencia sintética.
//
//   node tests/provenance.mjs

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ROOT } from './lib/env.mjs';

const { parseQiimeYaml } = await import(APP_ROOT + '/js/lib/qiimeYaml.js');
const { listZipEntries } = await import(APP_ROOT + '/js/lib/minizip.js');
const { readProvenance, provenanceChain, normalizeAction, isUuid } =
  await import(APP_ROOT + '/js/lib/provenance.js');

let failed = false;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed = true;
};
const eqJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('--- 1. gramática del YAML de QIIME 2 ---');

// Un action.yaml con TODAS las formas que aparecen en los artefactos reales:
// mapas anidados a 4 espacios, secuencias de mapas de una clave, secuencias de
// escalares a la misma indentación que su clave, escalares de bloque, comillas,
// colecciones en línea vacías y las seis etiquetas propias.
const ACTION = `execution:
    uuid: 4779bf7d-cae8-4ff2-a27d-4c97f581803f
    runtime:
        start: 2018-11-08T17:59:39.330487-07:00
        end: 2018-11-08T17:59:47.215712-07:00
        duration: 7 seconds, and 885225 microseconds

action:
    type: pipeline
    plugin: !ref 'environment:plugins:phylogeny'
    action: align_to_tree_mafft_fasttree
    inputs:
    -   sequences: 7ecf8954-e49a-4605-992e-99fcee397935
    -   optional_thing: null
    parameters:
    -   n_threads: 1
    -   mask_max_gap_frequency: 1.0
    -   parttree: false
    -   metadata: !metadata 'sample-metadata.tsv'
    -   from_artifact: !metadata '430a6575-86b3-4cf6-b72e-0f7fce3ed342:column.tsv'
    -   where: !set ['a', 'b']
    -   tone: !color '#ff0000'
    output-name: tree
    alias-of: d32a5ea6-1ca1-4635-b522-2253568ae35b

transformers:
    inputs:
        alignment:
        -   from: AlignedDNASequencesDirectoryFormat
            to: AlignedDNAFASTAFormat
    output:
    -   from: biom.table:Table
        to: BIOMV210DirFmt
        plugin: !ref 'environment:plugins:types'
        citations:
        - !cite 'view|types:2020.2.0|biom.table:Table|0'
        - !cite 'view|types:2020.2.0|BIOMV210DirFmt|0'

environment:
    platform: macosx-10.9-x86_64
    python: |-
        3.5.5 | packaged by conda-forge
        [GCC 4.2.1 Compatible Apple LLVM 6.1.0]
    framework:
        version: 2018.11.0
        website: https://qiime2.org
    plugins:
        phylogeny:
            version: 2018.11.0
            website: https://github.com/qiime2/q2-phylogeny
    python-packages:
        urllib3: '1.23'
        numpy: 1.12.1
`;

const y = parseQiimeYaml(ACTION);

check('mapa anidado por indentación', y.execution.runtime.duration === '7 seconds, and 885225 microseconds');
check('la hora ISO se queda literal, sin convertir a fecha',
  y.execution.runtime.start === '2018-11-08T17:59:39.330487-07:00', y.execution.runtime.start);
check('los dos puntos de la hora no se leen como clave: valor',
  typeof y.execution.runtime.start === 'string');
check('!ref → nombre del plugin', y.action.plugin.tag === 'ref' && y.action.plugin.plugin === 'phylogeny');
check('secuencia de mapas de una clave: 2 entradas', y.action.inputs.length === 2, JSON.stringify(y.action.inputs));
check('entrada con uuid', y.action.inputs[0].sequences === '7ecf8954-e49a-4605-992e-99fcee397935');
check('entrada opcional sin usar → null', y.action.inputs[1].optional_thing === null);
check('parámetros: 7 entradas', y.action.parameters.length === 7, String(y.action.parameters.length));
check('número sin convertir, conserva el .0 del archivo',
  y.action.parameters[1].mask_max_gap_frequency === '1.0');
check('booleano de YAML no se convierte', y.action.parameters[2].parttree === 'false');
check('!metadata simple → fichero sin artefactos',
  eqJSON(y.action.parameters[3].metadata, { tag: 'metadata', file: 'sample-metadata.tsv', artifacts: [] }));
check('!metadata con artefactos → se separan',
  eqJSON(y.action.parameters[4].from_artifact,
    { tag: 'metadata', file: 'column.tsv', artifacts: ['430a6575-86b3-4cf6-b72e-0f7fce3ed342'] }));
check('!set en línea → lista', eqJSON(y.action.parameters[5].where, { tag: 'set', value: ['a', 'b'] }));
check('!color → valor', y.action.parameters[6].tone.value === '#ff0000');
check('clave con guion (output-name, alias-of)',
  y.action['output-name'] === 'tree' && y.action['alias-of'] === 'd32a5ea6-1ca1-4635-b522-2253568ae35b');

// el caso que más cuesta: una lista a la MISMA indentación que su clave, dentro
// de un elemento de secuencia. Si se lee mal, los !cite se cuelan como
// hermanos del transformador y la lista pasa de 1 elemento a 3.
check('transformers.output: UN elemento, no tres', y.transformers.output.length === 1,
  JSON.stringify(y.transformers.output).slice(0, 120));
check('citations anidadas dentro del elemento', y.transformers.output[0].citations.length === 2);
check('!cite → clave de la cita',
  y.transformers.output[0].citations[0].key === 'view|types:2020.2.0|biom.table:Table|0');
check('secuencia anidada bajo clave indentada (transformers.inputs)',
  y.transformers.inputs.alignment.length === 1 &&
  y.transformers.inputs.alignment[0].to === 'AlignedDNAFASTAFormat');

check('escalar de bloque |- con varias líneas',
  y.environment.python === '3.5.5 | packaged by conda-forge\n[GCC 4.2.1 Compatible Apple LLVM 6.1.0]',
  JSON.stringify(y.environment.python));
check('escalar de bloque: la línea con | no se lee como clave',
  !Object.prototype.hasOwnProperty.call(y.environment, '3.5.5 '));
check('entrecomillado conserva el valor como texto', y.environment['python-packages'].urllib3 === '1.23');
check('versiones de plugins', y.environment.plugins.phylogeny.version === '2018.11.0');

// colecciones en línea vacías: si llegan como la cadena "[]" o "{}", quien
// recorra los parámetros se encuentra dos caracteres en vez de una lista
const emptyColl = parseQiimeYaml('action:\n    inputs: []\n    parameters: []\nenvironment:\n    plugins: {}\n');
check('inputs: [] → array vacío', Array.isArray(emptyColl.action.inputs) && emptyColl.action.inputs.length === 0);
check('parameters: [] → array vacío', Array.isArray(emptyColl.action.parameters));
check('plugins: {} → objeto vacío',
  emptyColl.environment.plugins && typeof emptyColl.environment.plugins === 'object'
  && !Array.isArray(emptyColl.environment.plugins));

// robustez: nunca debe lanzar por contenido raro, porque un action.yaml de una
// versión futura con una clave nueva tiene que seguir dando lo que sí se entiende
let threw = false;
try {
  parseQiimeYaml('');
  parseQiimeYaml('   ');
  parseQiimeYaml('basura sin dos puntos\notra línea\n');
  parseQiimeYaml('a:\n  - - anidado raro\n');
  parseQiimeYaml('a: !etiqueta-desconocida valor\n');
  parseQiimeYaml('clave:\n\n\n');
} catch (e) { threw = true; }
check('no lanza con entradas vacías, basura o etiquetas desconocidas', !threw);
check('texto vacío → objeto vacío', eqJSON(parseQiimeYaml(''), {}));

console.log('--- 2. normalizeAction ---');
const act = normalizeAction(parseQiimeYaml(ACTION));
check('tipo y acción', act.type === 'pipeline' && act.action === 'align_to_tree_mafft_fasttree');
check('plugin resuelto desde !ref', act.plugin === 'phylogeny');
check('alias-of de pipeline registrado', act.aliasOf === 'd32a5ea6-1ca1-4635-b522-2253568ae35b');
check('entradas normalizadas con sus uuid',
  act.inputs.length === 2 && eqJSON(act.inputs[0].uuids, ['7ecf8954-e49a-4605-992e-99fcee397935']));
check('entrada opcional vacía se marca', act.inputs[1].empty === true && act.inputs[1].uuids.length === 0);
check('parámetro de metadatos se clasifica como metadata',
  act.parameters.find((p) => p.name === 'metadata').kind === 'metadata');
check('parámetro de metadatos desde artefacto conserva el uuid',
  eqJSON(act.parameters.find((p) => p.name === 'from_artifact').artifacts,
    ['430a6575-86b3-4cf6-b72e-0f7fce3ed342']));
check('parámetro nulo se marca como empty',
  normalizeAction(parseQiimeYaml('action:\n    parameters:\n    -   x: null\n')).parameters[0].kind === 'empty');
check('!set se aplana a texto legible',
  act.parameters.find((p) => p.name === 'where').value === 'a, b');
check('runtime completo', !!act.runtime.start && !!act.runtime.end && !!act.runtime.duration);
check('versión del framework y plataforma', act.frameworkVersion === '2018.11.0' && act.platform === 'macosx-10.9-x86_64');
check('import se marca como raíz de la cadena',
  normalizeAction(parseQiimeYaml('action:\n    type: import\n    inputs: []\n')).isRoot === true);
check('normalizeAction(null) → null', normalizeAction(null) === null);

console.log('--- 3. isUuid ---');
check('acepta un uuid de QIIME 2', isUuid('00000000-0000-4000-8000-000000000000'));
check('rechaza lo que no lo es', !isUuid('data') && !isUuid('') && !isUuid(null));

console.log('--- 4. lectura del .qza de ejemplo del repo ---');
const buf = readFileSync(join(APP_ROOT, 'datos-ejemplo/diversidad-beta/bray_curtis.qza'));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const entries = listZipEntries(ab);
const prov = await readProvenance(ab, entries);

check('tipo y formato del artefacto',
  prov.type === 'DistanceMatrix' && prov.format === 'DistanceMatrixDirectoryFormat');
check('versión de archivo desde VERSION', prov.archiveVersion === '5');
// VERSION manda sobre action.yaml: el primero dice con qué versión se ESCRIBIÓ
// el archivo, el segundo con cuál se ejecutó la acción, y pueden diferir
check('la versión del framework sale de VERSION, no de action.yaml',
  prov.frameworkVersion === '2025.10.0', prov.frameworkVersion);
check('tiene procedencia', prov.hasProvenance === true);
check('acción final: diversity beta',
  prov.action.plugin === 'diversity' && prov.action.action === 'beta');
check('parámetro metric=braycurtis',
  prov.action.parameters.find((p) => p.name === 'metric').value === 'braycurtis');
check('3 artefactos aguas arriba', prov.upstream.length === 3, String(prov.upstream.length));
check('no se marca como visualización', prov.isVisualization === false);
check('no truncado', prov.upstreamTruncated === false);

const chain = provenanceChain(prov);
check('la cadena tiene 4 pasos', chain.length === 4, String(chain.length));
check('empieza por el import', chain[0].action.type === 'import');
check('luego dada2, rarefy y beta, en ese orden',
  chain[1].action.action === 'denoise_single' &&
  chain[2].action.action === 'rarefy' &&
  chain[3].action.action === 'beta',
  chain.map((c) => c.action && c.action.action).join(' → '));
check('el último paso es este artefacto', chain[3].isFinal === true && chain[3].uuid === prov.uuid);
check('cada paso lleva su tipo semántico',
  chain[1].type === 'FeatureTable[Frequency]' && chain[0].type === 'SampleData[SequencesWithQuality]');

console.log('--- 5. artefactos sin procedencia y entradas inválidas ---');
// un .qza de QIIME 2 anterior a la captura de procedencia (versión de archivo
// 0) existe de verdad; no debe romper la importación del dato
const noProv = await readProvenance(ab, entries.filter((e) => !/\/provenance\//.test(e.name)));
check('sin provenance/ → hasProvenance false, sin lanzar', noProv.hasProvenance === false);
check('sin provenance/ aún se leen tipo y versión',
  noProv.type === 'DistanceMatrix' && noProv.archiveVersion === '5');
check('cadena vacía si no hay acción', eqJSON(provenanceChain(noProv), []));
check('entries vacío → resultado vacío, sin lanzar', (await readProvenance(ab, [])).hasProvenance === false);
check('raíz que no es un uuid → resultado vacío',
  (await readProvenance(ab, [{ name: 'suelto/data/x.tsv' }])).hasProvenance === false);
check('provenanceChain(null) → []', eqJSON(provenanceChain(null), []));

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
