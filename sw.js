const CACHE_NAME = 'flashcard-v15-stable';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json'
];

// Install & Force Update
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// Activate & Destroy Old Caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName); // HAPUS CACHE LAMA
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Network First, Fallback to Cache
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
