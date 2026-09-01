const CACHE="bf6-weapons-lab-v18-ballistic-ttk";
const CORE=["./","./index.html","./styles.css","./app.js","./roster-data.js","./class-data.js","./manifest.webmanifest","./icon.svg","./data/ballistics.json"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)))});
self.addEventListener("activate",e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const url=new URL(e.request.url);
  if(url.hostname.includes("raw.githubusercontent.com")){e.respondWith(fetch(e.request));return;}
  e.respondWith(fetch(e.request).then(r=>{if(r&&r.ok)caches.open(CACHE).then(c=>c.put(e.request,r.clone()));return r}).catch(()=>caches.match(e.request)));
});
