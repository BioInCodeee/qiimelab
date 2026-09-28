// Cliente CDP mínimo sobre el WebSocket nativo de Node. Lanza Chrome headless,
// abre una pestaña y expone ev()/screenshot()/problems.
//
// Recoge en `problems` cualquier console.error / assert / excepción no
// capturada de la página (con la etiqueta de la fase actual, via setLabel()).

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChrome, skip } from './env.mjs';

let portSeq = 9700 + Math.floor(Math.random() * 200);

// Lanza Chrome y espera a que el puerto de depuración responda. En un runner
// de CI cargado el proceso puede morir al arrancar (contención, /dev/shm…),
// así que se reintenta un par de veces con puerto y perfil nuevos antes de
// rendirse.
async function launchChrome(chromeBin, extraArgs = []) {
  let lastErr = 'CHROME_NO_START';
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = portSeq++;
    const profileDir = mkdtempSync(join(tmpdir(), 'ql-cdp-'));
    const chrome = spawn(chromeBin, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--disable-extensions', '--disable-background-networking', '--disable-dev-shm-usage',
      `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
      '--window-size=1400,2200', ...extraArgs, 'about:blank',
    ], { stdio: 'ignore' });
    let died = false;
    chrome.once('exit', () => { died = true; });

    let wsUrl;
    for (let i = 0; i < 100; i++) {
      if (died) break;
      try {
        const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; }
      } catch { /* aún no responde */ }
      await sleep(200);
    }
    if (wsUrl) return { chrome, profileDir, wsUrl };
    try { chrome.kill('SIGKILL'); } catch { /* noop */ }
    try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* noop */ }
    lastErr = died ? 'CHROME_DIED_ON_START' : 'CHROME_NO_START';
    await sleep(400);
  }
  throw new Error(lastErr);
}

// chromeArgs: argumentos extra de Chrome para un test concreto (p. ej.
// tests/button-hover.mjs declara un puntero con hover, que headless no tiene)
// theme: desde el 28 sep 2026 la app arranca en OSCURO si no hay tema guardado
// (js/lib/theme.js DEFAULT_THEME). Para que cada test siga probando el tema que
// dice probar, se guarda uno explícito antes de cada documento — 'light' por
// defecto, 'dark' con dark:true — solo si la página aún no tiene ninguno (así
// no pisa lo que siembre el propio test). theme:null = arranque virgen, para
// probar precisamente el valor por defecto (tests/theme-default.mjs).
export async function connect({ dark = false, theme, url = 'http://127.0.0.1:8931', label = 'cdp', chromeArgs = [] } = {}) {
  if (theme === undefined) theme = dark ? 'dark' : 'light';
  const chromeBin = findChrome();
  if (!chromeBin) skip('no se encontró Chrome/Chromium');

  let launched, ws;
  try {
    launched = await launchChrome(chromeBin, chromeArgs);
    ws = new WebSocket(launched.wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('WS_FAIL')), { once: true });
    });
  } catch (err) {
    skip(`Chrome no pudo arrancar en este entorno (${err?.message || err})`);
  }

  const { chrome, profileDir, wsUrl } = launched;

  let mid = 0;
  const rpc = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++mid;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === id) { ws.removeEventListener('message', h); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  const { targetId } = await rpc('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await rpc('Target.attachToTarget', { targetId, flatten: true });
  await rpc('Page.enable', {}, sessionId);
  await rpc('Runtime.enable', {}, sessionId);
  await rpc('Console.enable', {}, sessionId);
  if (dark) await rpc('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, sessionId);
  if (theme) {
    await rpc('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { if (location.protocol.startsWith('http') && !localStorage.getItem('smart-175.theme') && !localStorage.getItem('qiimelab.theme')) localStorage.setItem('smart-175.theme', ${JSON.stringify(theme)}); } catch (e) {}`,
    }, sessionId);
  }

  const problems = [];
  let current = label;
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) {
      problems.push(`[${current}] console.${m.params.type}: ` + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      problems.push(`[${current}] EXCEPTION: ` + (d.exception?.description || d.text));
    }
  });

  const ev = async (expr) => {
    const r = await rpc('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const screenshot = async (path) => {
    const { data } = await rpc('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
    writeFileSync(path, Buffer.from(data, 'base64'));
  };
  const setViewport = (width, height = 1400) =>
    rpc('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width < 700,
      screenWidth: width, screenHeight: height, positionX: 0, positionY: 0,
      screenOrientation: { angle: 0, type: 'portraitPrimary' },
    }, sessionId);

  return {
    ev, rpc, screenshot, setViewport, problems, sessionId,
    setLabel: (l) => { current = l; },
    // Page.navigate devuelve errorText si Chrome no llega (conexión rechazada,
    // servidor caído…): se convierte en un error claro en vez de dejar la
    // pestaña en chrome-error://chromewebdata/ y que cada import() posterior
    // falle con un mensaje críptico (ver tests/server-smoke.mjs)
    goto: async (u) => {
      const target = u ?? url;
      const r = await rpc('Page.navigate', { url: target }, sessionId);
      if (r && r.errorText) throw new Error(`SERVER_REACHABILITY_FROM_CHROME: Chrome cannot reach ${target} (${r.errorText})`);
      return r;
    },
    kill() {
      try { chrome.kill('SIGKILL'); } catch { /* noop */ }
      try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* noop */ }
    },
  };
}
