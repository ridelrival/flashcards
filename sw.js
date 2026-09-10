// Change this version whenever the app shell changes.
const CACHE_PREFIX = `flashcards:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}v5`;
const ASSETS = ['./','./index.html','./styles.css','./js/app.js','./js/core.js','./js/storage.js','./manifest.json','./icon.png'];
const assetURLs = new Set(ASSETS.map(path => new URL(path,self.registration.scope).href));

self.addEventListener('install',event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  // Updates wait until the user chooses Update now; first installs activate normally.
});
self.addEventListener('message',event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate',event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch',event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url), scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  // Serve the installed shell together, rather than mixing old HTML and new modules.
  const cleanURL = new URL(url); cleanURL.search = ''; cleanURL.hash = '';
  if (!assetURLs.has(cleanURL.href)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    const cached = await cache.match(cleanURL.href);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type !== 'opaque') await cache.put(cleanURL.href,response.clone());
    return response;
  }));
});
