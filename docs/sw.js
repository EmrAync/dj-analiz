// SahneCAD çevrimdışı önbellek: önce ağ, ağ yoksa önbellek (salonda internet olmasa da açılır)
const C = 'sahnecad-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(C).then((c) => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(
    fetch(r)
      .then((res) => {
        if (res.ok) {
          const cp = res.clone();
          caches.open(C).then((c) => c.put(r, cp));
        }
        return res;
      })
      .catch(() => caches.match(r).then((m) => m || (r.mode === 'navigate' ? caches.match('./index.html') : undefined))),
  );
});
