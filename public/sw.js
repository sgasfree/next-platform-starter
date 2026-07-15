// Service Worker — S-GAS Freeconomy (PWA)
// Strategia conservativa:
//  - HTML: network-first (online prende sempre l'ultima versione; offline usa
//    la copia in cache). Evita il classico problema della "app vecchia".
//  - Asset statici (docx-lib.js, icone, manifest): cache-first (cambiano di rado).
//  - Tutto il resto (Supabase, Netlify Functions, EmailJS, CDN, Telegram) NON
//    viene intercettato: i dati dinamici vanno sempre in rete, niente cache stale.
const CACHE = 'sgas-pwa-v1';
const ASSETS = [
  './',
  './index.html',
  './docx-lib.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll fallisce se un asset non c'è: lo rendiamo tollerante
      .then((c) => Promise.allSettled(ASSETS.map((a) => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Solo GET e stesso dominio; il resto passa direttamente in rete.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Non toccare mai le Netlify Functions (auth, proxy, telegram).
  if (url.pathname.startsWith('/.netlify/')) return;

  const isHTML = req.mode === 'navigate'
    || url.pathname === '/' || url.pathname === './'
    || url.pathname.endsWith('/index.html') || url.pathname.endsWith('.html');

  if (isHTML) {
    // Network-first: online = ultima versione, offline = cache.
    e.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Asset statici: cache-first con aggiornamento in background.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
