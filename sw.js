const CACHE="bf6-build-lab-v2";
const CORE=["./","./index.html","./styles.css","./app.js","./fallback-data.js","./class-data.js","./manifest.webmanifest","./icon.svg"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  e.respondWith(
    caches.match(e.request).then(cached=>{
      const fresh=fetch(e.request).then(r=>{
        if(r && (r.ok || r.type==="opaque")) caches.open(CACHE).then(c=>c.put(e.request,r.clone()));
        return r;
      }).catch(()=>cached);
      return cached || fresh;
    })
  );
});