// Gate de privacidad: 2 pasadas de literales prohibidos sobre el código y los
// datos de ejemplo del repo. Las listas son las MISMAS que usa el gate externo
// VW_Final/scripts/verify_recursos_qiimelab.mjs, guardadas aquí en base64 para
// que los propios literales prohibidos no aparezcan en claro dentro del repo
// público.
//
//   node tests/privacy.mjs                 → escanea el árbol de código+datos
//   node tests/privacy.mjs <git-range>     → solo los archivos cambiados en ese rango
//
// exit 0 = limpio · 1 = algún acierto

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, extname } from 'node:path';
import { APP_ROOT } from './lib/env.mjs';

const b64 = (s) => Buffer.from(s, 'base64').toString('utf8');
const build = (list) => list.map(({ s, f }) => new RegExp(b64(s), f));

const LEAK_A = build([{"s":"Q29udHJvbF90aWVtcG9fMA==","f":""},{"s":"VC1TSShOPylBSg==","f":""},{"s":"VC1JQyhOPylBSg==","f":""},{"s":"XGJGMS1OQTMwXGI=","f":""},{"s":"XGJGWzEyM10tQTMw","f":""},{"s":"XGJJQ09cYg==","f":""},{"s":"XGJJQ0FKXGI=","f":""},{"s":"XGJJQ05BSlxi","f":""},{"s":"XGJTSUFKXGI=","f":""},{"s":"XGJTSU5BSlxi","f":""},{"s":"MTZTdjN2NA==","f":""},{"s":"LU4yWzAtOV17M30t","f":""},{"s":"X1NcZCtfTDAwMQ==","f":""},{"s":"ZmFzZV9lc3R1ZGlv","f":""},{"s":"cGhfYWp1c3RhZG8=","f":""},{"s":"c3VwbGVtZW50b19jYXJib25v","f":""},{"s":"YWRpY2lvbl9pbm9jdWxv","f":""},{"s":"XGJhZ2l0YWNpb25cYg==","f":""},{"s":"Z3JvdXBfb3JpZ2luYWw=","f":""},{"s":"Y29udHJvbF9pbmljaWFs","f":""},{"s":"b3B0X2Vuc2F5bw==","f":""},{"s":"aW5vY3Vsb19vcHRpbWl6YWRv","f":""},{"s":"cHVyW2nDrV1u","f":"i"},{"s":"cG9yY2lu","f":"i"},{"s":"aW5bw7NvXWN1bG8=","f":"i"},{"s":"YmlvYWNpZGlmaWM=","f":"i"},{"s":"QWdyb1B1cmk=","f":"i"},{"s":"VkhcZHs1fQ==","f":""},{"s":"QUFIMkhLWU01","f":""},{"s":"XkBbQS1aYS16MC05XSs6XGQrOltBLVowLTldezYsfTo=","f":"m"},{"s":"Ok46MDpbQUNHVF17Nix9","f":""}]);

const LEAK_B = build([{"s":"amVzdXM=","f":"i"},{"s":"V2FjaHRlcg==","f":"i"},{"s":"QWdyb1B1cmlUZWNo","f":"i"},{"s":"XGJVQUxcYg==","f":""},{"s":"UkVDW18gXT8yMDI2","f":"i"},{"s":"cHVyW2nDrV1u","f":"i"},{"s":"cHVyaW5lcw==","f":"i"},{"s":"XGJjZXJkb3M/XGI=","f":"i"},{"s":"YmlvYWNpZGlmaWNhY2lbw7NvXW4=","f":"i"},{"s":"X1ZXXGI=","f":""},{"s":"Vlcy","f":""},{"s":"Vldfb3B0","f":""},{"s":"bWluaWNvbmRhMw==","f":""},{"s":"aTktMTQ5MDBL","f":"i"},{"s":"bGliZ29tcA==","f":"i"},{"s":"U0FNUExJTkdfREVQVEg9Mjc2MDA=","f":""},{"s":"Mjc2MDA=","f":""}]);

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.tsv', '.csv', '.txt', '.R', '.py', '.sh', '.yml', '.yaml', '']);
// .md2-cache: caché local (gitignored) de datos públicos de MD2 descargados
// por scripts/build-phenotypes-md2.mjs — nunca se commitea, pero al ser un
// volcado íntegro de una base de datos de virus/hospedadores puede coincidir
// por casualidad con algún término del denylist del estudio. Igual que
// node_modules/dist: artefacto local regenerable, fuera del alcance de este gate.
const SKIP_DIR = new Set(['.git', 'node_modules', 'dist', '.md2-cache']);
// binarios grandes / comprimidos que no son texto
const SKIP_EXT = new Set(['.qza', '.qzv', '.gz', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.woff', '.woff2', '.ttf']);

function walk(dir, acc) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (!SKIP_EXT.has(extname(name).toLowerCase()) && st.size < 4 * 1024 * 1024) acc.push(p);
  }
  return acc;
}

const range = process.argv[2];
let files;
if (range) {
  files = execSync('git diff --name-only ' + range, { cwd: APP_ROOT, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean).map((f) => join(APP_ROOT, f))
    .filter((f) => { try { return statSync(f).isFile() && !SKIP_EXT.has(extname(f).toLowerCase()); } catch { return false; } });
  console.log(`Rango ${range} → ${files.length} archivo(s)`);
} else {
  files = walk(APP_ROOT, []);
  console.log(`Árbol completo → ${files.length} archivo(s) de texto`);
}

let hits = 0;
for (const abs of files) {
  const ext = extname(abs).toLowerCase();
  if (ext && !TEXT_EXT.has(ext)) continue;
  let text;
  try { text = readFileSync(abs, 'utf8'); } catch { continue; }
  const rel = abs.slice(APP_ROOT.length + 1);
  for (const [pass, list] of [['A', LEAK_A], ['B', LEAK_B]]) {
    for (const re of list) {
      const m = text.match(re);
      if (m) {
        const line = text.slice(0, m.index).split('\n').length;
        console.error(`  ✗ [${pass}] ${rel}:${line}  →  ${JSON.stringify(m[0].slice(0, 40))}`);
        hits++;
      }
    }
  }
}

if (hits === 0) {
  console.log('✅ Sin aciertos en ninguna de las dos pasadas.');
  process.exit(0);
}
console.error(`\n❌ ${hits} acierto(s).`);
process.exit(1);
