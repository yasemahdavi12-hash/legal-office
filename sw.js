/* قانون در جیب شما — Service Worker
 * Caches public static shell only.
 * NEVER caches /api/*, auth tokens, or private user data.
 */
const CACHE_VERSION = 'legal-pwa-v4';
const STATIC_CACHE = CACHE_VERSION + '-static';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-512-maskable.png',
  '/icon.svg'
];

const STATIC_EXT = /\.(?:js|css|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|json)$/i;

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function isApiRequest(url) {
  return url.pathname === '/api' || url.pathname.startsWith('/api/');
}

function isPrivatePath(url) {
  if (isApiRequest(url)) return true;
  // Uploads / storage must never be cached by SW
  if (url.pathname.startsWith('/storage/')) return true;
  if (url.pathname.startsWith('/database/')) return true;
  return false;
}

function hasAuthHeader(request) {
  return !!request.headers.get('Authorization');
}

function isNavigation(request) {
  return request.mode === 'navigate' ||
    (request.method === 'GET' && request.headers.get('accept') &&
      request.headers.get('accept').includes('text/html'));
}

function isStaticAsset(url) {
  if (PRECACHE_URLS.includes(url.pathname)) return true;
  if (url.pathname === '/sw.js') return false;
  return STATIC_EXT.test(url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle same-origin; leave CDN/third-party alone
  if (!sameOrigin(url)) return;

  // Never intercept non-GET (login/register/logout/refresh/reset/uploads)
  if (request.method !== 'GET') return;

  // Never cache or serve API / private resources from Cache Storage
  if (isPrivatePath(url) || hasAuthHeader(request)) {
    event.respondWith(fetch(request));
    return;
  }

  // App shell navigations: network-first, then cache, then offline page
  if (isNavigation(request)) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Public static assets: cache-first with network update
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }

  // Default: network only (no cache write)
  event.respondWith(fetch(request));
});

async function networkFirstNavigation(request) {
  try {
    const fresh = await fetch(request);
    // Only cache successful HTML shell responses (never API)
    if (fresh && fresh.ok && fresh.type === 'basic') {
      const cache = await caches.open(STATIC_CACHE);
      const url = new URL(request.url);
      // Cache only known shell paths
      if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/offline.html') {
        cache.put(request, fresh.clone());
      }
    }
    return fresh;
  } catch {
    const cached = await caches.match(request) ||
      await caches.match('/index.html') ||
      await caches.match('/');
    if (cached) return cached;
    return (await caches.match('/offline.html')) ||
      new Response('آفلاین هستید', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Background revalidate (ignore errors)
    fetch(request).then(async (fresh) => {
      if (fresh && fresh.ok && fresh.type === 'basic') {
        const cache = await caches.open(STATIC_CACHE);
        cache.put(request, fresh.clone());
      }
    }).catch(() => {});
    return cached;
  }
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    return (await caches.match('/offline.html')) ||
      new Response('', { status: 504 });
  }
}

self.addEventListener('push', (event) => {
  let payload = { title: 'یادآوری', body: '', data: {} };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch { /* ignore */ }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'یادآوری', {
      body: payload.body || '',
      data: payload.data || {},
      dir: 'rtl',
      lang: 'fa',
      icon: '/icon-192.png',
      badge: '/icon-192.png'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
