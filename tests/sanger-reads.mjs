// tests/sanger-reads.mjs — #/sanger, botón «Ver secuencias»: comprueba los
// tres helpers puros del visor de lecturas, sin navegador.
//
// Lo que importa científicamente aquí es que la reverse se muestre en las dos
// orientaciones y que ambas sean de verdad complementarias e inversas: el
// resultado guarda la reverse YA complementada (`rcSeq`, la que se alinea
// contra la forward), así que la columna «tal como se secuenció» se obtiene
// volviendo a complementar. Si eso se invirtiera, el usuario copiaría una
// secuencia que no es la que salió de su secuenciador.
//
//   node tests/sanger-reads.mjs

import { formatSeqBlock, collectReadSequences, buildReadsFasta } from '../js/modules/sanger.js';
import { reverseComplement } from '../js/lib/sangerOverlap.js';

let failed = false;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!ok) failed = true; };

// --- formatSeqBlock ---------------------------------------------------------
console.log('formatSeqBlock');

check('secuencia vacía → cadena vacía', formatSeqBlock('') === '' && formatSeqBlock(null) === '');

const seq75 = 'ACGT'.repeat(18) + 'ACG'; // 75 bases
const lines = formatSeqBlock(seq75).split('\n');
check('75 bases con ancho 60 → 2 líneas', lines.length === 2, '(' + lines.length + ')');
check('la 1ª línea empieza en la coordenada 1', lines[0].trim().startsWith('1 '), JSON.stringify(lines[0].slice(0, 12)));
check('la 2ª línea empieza en la coordenada 61', lines[1].trim().startsWith('61 '), JSON.stringify(lines[1].slice(0, 12)));

const bases = (s) => s.split('\n').map((l) => l.replace(/^\s*\d+\s+/, '').replace(/ /g, '')).join('');
check('no se pierde ni se duplica ninguna base', bases(formatSeqBlock(seq75)) === seq75);

const firstGroups = lines[0].replace(/^\s*\d+\s+/, '').split(' ');
check('bloques de 10 bases', firstGroups.length === 6 && firstGroups.every((g) => g.length === 10), '(' + firstGroups.length + ' bloques)');

const narrow = formatSeqBlock('ACGTACGTAC', 4, 2).split('\n');
check('ancho y bloque configurables', narrow.length === 3 && narrow[0].replace(/^\s*\d+\s+/, '') === 'AC GT', JSON.stringify(narrow[0]));

// --- collectReadSequences ---------------------------------------------------
console.log('\ncollectReadSequences');

const FWD = 'ACGTACGTAAGGTTCCAACGT';
const REV_AS_SEQUENCED = 'TTGGAACCTTACGTACGTAAA';
const RC = reverseComplement(REV_AS_SEQUENCED);
const CONS = FWD + 'TTTT';

const full = collectReadSequences({ id: 'B13', fSeq: FWD, rcSeq: RC, consensus: CONS });
check('4 entradas con forward + reverse + consenso', full.length === 4, '(' + full.length + ')');
check('orden: forward, reverse, revcomp, consenso',
  full.map((r) => r.key).join(',') === 'forward,reverse,revcomp,consensus',
  full.map((r) => r.key).join(','));
check('la forward se muestra tal cual', full[0].seq === FWD);
check('la reverse se muestra como salió del secuenciador', full[1].seq === REV_AS_SEQUENCED, full[1].seq);
check('la revcomp es la que guarda el resultado', full[2].seq === RC);
check('reverse y revcomp son complementarias e inversas', reverseComplement(full[1].seq) === full[2].seq);
check('el consenso se muestra tal cual', full[3].seq === CONS);

const onlyFwd = collectReadSequences({ id: 'solo-F', fSeq: FWD, consensus: FWD });
check('sin reverse → no se inventan sus dos filas',
  onlyFwd.map((r) => r.key).join(',') === 'forward,consensus',
  onlyFwd.map((r) => r.key).join(','));

const onlyRev = collectReadSequences({ id: 'solo-R', rcSeq: RC });
check('solo reverse, sin consenso → 2 filas',
  onlyRev.map((r) => r.key).join(',') === 'reverse,revcomp',
  onlyRev.map((r) => r.key).join(','));

check('muestra sin nada → lista vacía', collectReadSequences({}).length === 0 && collectReadSequences().length === 0);

// --- buildReadsFasta --------------------------------------------------------
console.log('\nbuildReadsFasta');

const fasta = buildReadsFasta({ id: 'B13', fSeq: FWD, rcSeq: RC, consensus: CONS });
const fLines = fasta.trimEnd().split('\n');
check('una cabecera y una secuencia por lectura', fLines.length === 8, '(' + fLines.length + ')');
check('cabeceras con el id de la muestra y el sufijo',
  fLines.filter((l) => l.startsWith('>')).join('|') ===
    ['>B13_forward len=' + FWD.length, '>B13_reverse len=' + REV_AS_SEQUENCED.length,
      '>B13_reverse_revcomp len=' + RC.length, '>B13_consenso len=' + CONS.length].join('|'),
  fLines.filter((l) => l.startsWith('>')).join('|'));
check('las secuencias del FASTA van sin numerar ni espacios',
  fLines.filter((l) => !l.startsWith('>')).every((l) => /^[A-Z]+$/.test(l)));
check('termina en salto de línea', fasta.endsWith('\n'));
check('muestra vacía → FASTA vacío', buildReadsFasta({}) === '');
check('id ausente → no rompe la cabecera', buildReadsFasta({ fSeq: FWD }).startsWith('>muestra_forward'));

console.log('\nRESULTADO: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
