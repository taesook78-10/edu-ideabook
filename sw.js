/* sw.js — 교육 아이디어 북 (PWA) */
/* Scope: root (/) — register('sw.js') in index.html */
/* Strategy:
   - Precache core shell (index, manifest, icons)
   - Navigation requests → network-first, fallback to cached index.html
   - Same-origin GET (non-HTML) → stale-while-revalidate
   - Images from trusted CDNs (YouTube thumbnails, favicons, Pinterest embeds) → stale-while-revalidate
   - Clean up old caches on activate
*/

const CACHE_VERSION = 'edu-ideas-v1.0.0';
const PRECACHE = `precache-${CACHE_VERSION}`;
const RUNTIME  = `runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/', './', 'index.html', 'manifest.json',
  'icon-72x72.png','icon-96x96.png','icon-128x128.png','icon-144x144.png',
  'icon-152x152.png','icon-180x180.png','icon-192x192.png','icon-384x384.png','icon-512x512.png'
];

// Helper: create a reload Request so we bypass HTTP cache during install
function reloadReq(url) {
  return new Request(url, { cache: 'reload', credentials: 'same-origin' });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    await cache.addAll(PRECACHE_URLS.map(reloadReq));
    // Activate SW immediately after install
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Claim pages so the SW controls clients without reload
    await self.clients.claim();
    // Delete old caches
    const names = await caches.keys();
    await Promise.all(
      names.map((name) => {
        if (name !== PRECACHE && name !== RUNTIME) {
          return caches.delete(name);
        }
      })
    );
  })());
});

// Hosts allowed for runtime image caching
const IMAGE_HOST_WHITELIST = new Set([
  self.location.host,                  // same origin
  'img.youtube.com',
  'i.ytimg.com',
  'www.google.com',                    // favicons
  's2.googleusercontent.com',
  'assets.pinterest.com'               // pin embed
]);

function isNavigationRequest(req) {
  return req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'));
}

function isImageLike(req) {
  const url = new URL(req.url);
  return req.destination === 'image' ||
         /\.(?:png|jpg|jpeg|gif|webp|svg)(\?.*)?$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET
  if (req.method !== 'GET') return;

  // Navigation requests: Network first, fallback to cached index.html
  if (isNavigationRequest(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(reloadReq(req.url));
        // Optionally update runtime cache
        const cache = await caches.open(RUNTIME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        // Offline fallback
        const cache = await caches.open(PRECACHE);
        return (await cache.match('index.html')) || Response.error();
      }
    })());
    return;
  }

  // Same-origin static (non-HTML) — stale-while-revalidate
  if (url.origin === self.location.origin) {
    // Avoid caching the service worker file itself
    if (url.pathname.endsWith('/sw.js')) return;

    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      const networkFetch = fetch(req).then((res) => {
        // Only cache successful, basic/opaqueredirect responses
        if (res && (res.status === 200 || res.type === 'opaqueredirect')) {
          cache.put(req, res.clone());
        }
        return res;
      }).catch(() => undefined);
      return cached || networkFetch || new Response('', { status: 504, statusText: 'Gateway Timeout' });
    })());
    return;
  }

  // External images from whitelisted hosts — stale-while-revalidate
  if (isImageLike(req) && IMAGE_HOST_WHITELIST.has(url.host)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      const networkFetch = fetch(req, { mode: 'cors' }).then((res) => {
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      }).catch(() => undefined);
      return cached || networkFetch || Response.error();
    })());
    return;
  }

  // Default: Pass-through (no caching), but try network then cache fallback if previously stored
  event.respondWith((async () => {
    try {
      return await fetch(req);
    } catch {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      return cached || Response.error();
    }
  })());
});

// Optional: listen for a message to immediately activate updated SW
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
