/* Panel REAKTO — pamięć podręczna aplikacji.
   Pliki aplikacji trzymane są lokalnie, dzięki czemu otwiera się natychmiast
   i działa bez połączenia. Dane z arkusza pobierane są zawsze z sieci. */
const WERSJA = 'reakto-v3';
const PLIKI = [
  './', './index.html', './style.css', './xlsx.js', './analiza.js', './app.js',
  './manifest.json', './ikona-180.png', './ikona-192.png', './ikona-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(WERSJA).then(c => c.addAll(PLIKI)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(n => n !== WERSJA).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // dane z Arkuszy Google zawsze prosto z sieci
  if (url.hostname.includes('google.com')) return;
  e.respondWith(
    caches.match(e.request).then(c => c || fetch(e.request).then(r => {
      if (r.ok && url.origin === location.origin) {
        const kopia = r.clone();
        caches.open(WERSJA).then(cache => cache.put(e.request, kopia));
      }
      return r;
    }).catch(() => caches.match('./index.html')))
  );
});
