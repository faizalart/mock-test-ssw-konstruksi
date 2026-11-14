const CACHE_NAME = 'ssw-konstruksi-shell-v1';

const CORE = [
  './',
  './index.html',
  './styles.css',
  './CSV-IMPORT-STYLES.css',
  './RICH-HTML-STYLES.css',
  './QUESTION-EDITOR-UPDATES.css',
  './ZEN-APP-SHELL.css',
  './HOME-DASHBOARD.css',
  './ZEN-PAGES.css',
  './assets/zen-warrior-bg.png',
  './app.js',
  './db.js',
  './utils.js',
  './archive.js',
  './data/latsol-konstruksi-01.json',
  './data/kotoba-dan-kategori-tambahan.json',
  './data/sharedKotobaDictionary.json',
  './data/kotobaMapping.json',
  './manifest.webmanifest',
  './favicon.png',
  './hasbulla-192.png',
  './hasbulla-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok && (event.request.url.includes('/assets/') || event.request.url.includes('/data/'))) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
