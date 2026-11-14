/* Service worker de Smart-175 — caché en tiempo de ejecución, sin lista fija.
 *
 * La app es "un módulo ES por archivo" y no tiene build step: una lista de
 * precache escrita a mano se desincronizaría con cada módulo nuevo. En su
 * lugar cacheamos lo que el navegador pide de verdad:
 *
 *   - navegación / HTML  → network-first (si hay red, la versión fresca gana;
 *                          sin red, servimos el shell cacheado)
 *   - código (js, css, json) → network-first, la caché es solo el respaldo sin
 *                          red. Antes era cache-first + revalidación: tras cada
 *                          despliegue se veía la versión ANTERIOR hasta recargar
 *                          dos veces (y el aviso "versión nueva" no salía porque
 *                          este archivo no cambiaba). Sin build step el código
 *                          cambia a diario, así que la frescura manda.
 *   - resto del mismo origen (fuentes, svg, imágenes)
 *                        → cache-first + revalidación en segundo plano
 *
 * El nombre de caché lleva versión; `activate` borra las viejas. Cuando este
 * archivo cambia, el navegador instala un SW nuevo que queda "en espera" y la
 * app muestra el aviso de recargar (ver js/lib/pwa.js).
 */

// Súbelo a mano cuando quieras forzar un vaciado de caché (normalmente no hace
// falta: el propio cambio de bytes de este archivo ya instala un SW nuevo).
const VERSION = 'v5'; // v5: el shell solo se cachea con el shell (desde que existe privacidad.html
// hay mas de una pagina HTML); v4 (Fase 4a): identidad Smart-175
const CACHE = 'smart-175-' + VERSION;

// El shell mínimo que garantiza que la app arranca sin red la primera vez que
// ya se visitó. Son rutas estables (no módulos de análisis): si alguna falla
// la instalación NO se aborta. Las fuentes van aquí porque ahora son locales
// (css/fonts.css) y el shell sin ellas parpadea a la tipografía del sistema.
const SHELL = [
  './',
  './index.html',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './css/print.css',
  './css/fonts.css',
  './fonts/IBMPlexSans-var.latin.woff2',
  './fonts/IBMPlexSans-var.latin-ext.woff2',
  './fonts/IBMPlexSerif-SemiBold.latin.woff2',
  './fonts/IBMPlexMono-Regular.latin.woff2',
  './js/app.js',
  './manifest.json',
  './favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    // no llamamos a skipWaiting(): dejamos que el usuario decida cuándo recargar
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // 'qiimelab-*' = cachés del nombre heredado: también se borran (Fase 4a)
    await Promise.all(keys.filter((k) => (k.startsWith('smart-175-') || k.startsWith('qiimelab-')) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// La página pide activar el SW en espera (tras confirmar el aviso de recarga).
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

function isHTMLRequest(req) {
  return req.mode === 'navigate' ||
    (req.method === 'GET' && (req.headers.get('accept') || '').includes('text/html'));
}

// ¿Esta navegación es el shell de la app, o alguna OTRA página del sitio?
// Desde que existe privacidad.html hay más de una página HTML, y la diferencia
// importa: cachear cualquier navegación bajo './index.html' haría que, después
// de visitar la política de privacidad, la app sin conexión sirviera esa página
// en lugar de la aplicación.
function isAppShell(url) {
  return url.pathname.endsWith('/') || /\/index\.html$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // 1) Navegación / HTML → network-first, con el shell como red de seguridad.
  if (isHTMLRequest(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(isAppShell(url) ? './index.html' : req, fresh.clone());
        }
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE);
        const exact = await cache.match(req);
        if (exact) return exact;
        // Para una página que no es el shell (la política de privacidad) y que
        // nunca se visitó con red, caer al shell daría la app donde se pidió
        // otra cosa: mejor fallar y que el navegador muestre su aviso de sin
        // conexión, que es la verdad.
        if (!isAppShell(url)) return Response.error();
        return (await cache.match('./index.html')) ||
          (await cache.match('./')) ||
          Response.error();
      }
    })());
    return;
  }

  // 2) Código (js/css/json) → network-first: la versión desplegada gana; la
  //    caché solo responde si no hay red (modo offline).
  if (sameOrigin && /\.(?:m?js|css|json)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res && res.ok && res.status === 200) cache.put(req, res.clone());
        return res;
      } catch (e) {
        return (await cache.match(req)) || Response.error();
      }
    })());
    return;
  }

  // 3) Resto del mismo origen (fuentes/svg/imágenes/woff2) → cache-first +
  //    revalidación en segundo plano. Ya no hay orígenes externos que atender.
  if (sameOrigin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res && res.ok && (res.status === 200)) cache.put(req, res.clone());
        return res;
      }).catch(() => null);

      if (cached) {
        event.waitUntil(network); // actualiza para la próxima visita
        return cached;
      }
      const res = await network;
      return res || Response.error();
    })());
  }
});
