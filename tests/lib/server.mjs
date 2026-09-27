// Servidor HTTP estático para los tests de navegador. Si ya hay uno sirviendo
// la app en el puerto, lo reutiliza; si no, arranca `python3 -m http.server`
// sobre la raíz del repo y lo para al terminar.
//
// tests/run.mjs arranca UN servidor propio en un puerto libre para toda la
// ejecución y lo pasa a cada test por QL_TEST_PORT (ver `startServer`), así
// que en la suite completa nunca se reutiliza un servidor ajeno en :8931 (de
// otro árbol de trabajo u otra herramienta, que podía morir a mitad de la
// ejecución) ni se arranca/para uno por test. Lanzar un test suelto sigue
// usando :8931 por defecto.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { APP_ROOT } from './env.mjs';

const PORT = Number(process.env.QL_TEST_PORT || 8931);
const BASE = `http://127.0.0.1:${PORT}`;

async function reachable(base = BASE) {
  try {
    const r = await fetch(base + '/index.html', { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

/** Un puerto TCP libre en 127.0.0.1 (lo asigna el sistema). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/**
 * Arranca `python3 -m http.server` en `port` sobre la raíz del repo y espera
 * a que responda. @returns {Promise<{ url, started: true, stop } | null>}
 */
export async function startServer(port) {
  const base = `http://127.0.0.1:${port}`;
  let proc;
  try {
    proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'],
      { cwd: APP_ROOT, stdio: 'ignore' });
  } catch { return null; }

  for (let i = 0; i < 50; i++) {
    await sleep(200);
    if (await reachable(base)) {
      return {
        url: base, started: true,
        stop() { try { proc.kill('SIGKILL'); } catch { /* noop */ } },
      };
    }
    if (proc.exitCode != null) return null;
  }
  try { proc.kill('SIGKILL'); } catch { /* noop */ }
  return null;
}

/**
 * @returns {Promise<{ url: string, started: boolean, stop: () => void } | null>}
 *   null si no se puede servir la app (no hay python3 y no había servidor).
 */
export async function ensureServer() {
  if (await reachable()) return { url: BASE, started: false, stop() {} };
  return startServer(PORT);
}
