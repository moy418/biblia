// Funciona sin internet: guarda la app y lo que vas leyendo.
const V = 'lumbrera-v2';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'vendor/leaflet.js', 'vendor/leaflet.css',
  'data/content_es.json', 'data/content_en.json', 'img/icon-192.png', 'img/icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== 'lumbrera-media').map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || e.request.headers.has('range') || /\.mp4$/.test(u.pathname) || u.hostname.endsWith('archive.org')) return;
  const sameOrigin = u.origin === location.origin;
  const media = /wikimedia\.org|wikipedia\.org\/wiki\/Special:FilePath|arcgisonline\.com/.test(u.href);
  if (!sameOrigin && !media) return;
  // App: red primero (para actualizarse), caché si no hay conexión. Imágenes y mapas: caché primero.
  e.respondWith((async () => {
    const cache = await caches.open(sameOrigin ? V : 'lumbrera-media');
    if (!sameOrigin || /\/data\/bible\/|\/img\//.test(u.pathname)) {
      const hit = await cache.match(e.request); if (hit) return hit;
      try { const r = await fetch(e.request); if (r.ok || r.type === 'opaque') cache.put(e.request, r.clone()); return r; } catch { return hit || Response.error(); }
    }
    try { const r = await fetch(e.request); if (r.ok) cache.put(e.request, r.clone()); return r; }
    catch { return (await cache.match(e.request)) || (await cache.match('index.html')); }
  })());
});
