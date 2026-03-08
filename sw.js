const CACHE = 'spendsmart-v3';
const ASSETS = ['/', '/index.html', '/manifest.json'];
self.addEventListener('install',  e => { e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(cached=>{
    if (cached) return cached;
    return fetch(e.request).then(res=>{
      if (e.request.method==='GET' && res.status===200) { const c=res.clone(); caches.open(CACHE).then(ca=>ca.put(e.request,c)); }
      return res;
    }).catch(()=>e.request.mode==='navigate'?caches.match('/index.html'):undefined);
  }));
});
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.openWindow('/')); });
