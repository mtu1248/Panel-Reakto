/* Panel REAKTO — pamięć podręczna aplikacji.
   Pliki aplikacji trzymane są lokalnie, dzięki czemu otwiera się natychmiast
   i działa bez połączenia. Dane z arkusza pobierane są zawsze z sieci. */
const WERSJA = 'reakto-v3.0.1';
const PLIKI = [
  './', './index.html', './style.css', './xlsx.js', './analiza.js', './app.js',
  './manifest.json', './ikona-180.png', './ikona-192.png', './ikona-512.png',
];

self.addEventListener('install', e => {
  // `cache: 'reload'` — pliki prosto z serwera, z pominięciem pamięci HTTP
  // przeglądarki. Bez tego nowa wersja potrafiła złożyć się z nowego app.js
  // i starego analiza.js (GitHub Pages trzyma pliki w pamięci 10 minut).
  e.waitUntil(caches.open(WERSJA)
    .then(c => c.addAll(PLIKI.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
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
  if (url.origin !== location.origin) return;
  // Od 3.0.1 najpierw sieć, potem pamięć: po wgraniu nowej wersji na
  // GitHub Pages telefon dostaje ją przy pierwszym otwarciu, a bez zasięgu
  // aplikacja i tak otwiera się z pamięci.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      if (r.ok) {
        const kopia = r.clone();
        caches.open(WERSJA).then(cache => cache.put(e.request, kopia));
      }
      return r;
    }).catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
  );
});
