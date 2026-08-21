
const CACHE='fournix-fielddiag-v10-20260821';
const LOCAL=['./','./index.html','./styles.css','./app.js','./manifest.json','./icon-192.png','./icon-512.png'];
const CDN=[
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await cache.addAll(LOCAL);
    for(const u of CDN){ try{ await cache.add(u); }catch{} }
  })());
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request){
  const cache=await caches.open(CACHE);
  try{
    const response=await fetch(request,{cache:'no-store'});
    if(response && response.ok) cache.put(request,response.clone()).catch(()=>{});
    return response;
  }catch(e){
    const hit=await cache.match(request);
    if(hit) return hit;
    throw e;
  }
}

async function cacheFirst(request){
  const cache=await caches.open(CACHE);
  const hit=await cache.match(request);
  if(hit) return hit;
  const response=await fetch(request);
  if(response && response.ok) cache.put(request,response.clone()).catch(()=>{});
  return response;
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  const sameOrigin=url.origin===self.location.origin;

  if(event.request.mode==='navigate'){
    event.respondWith(networkFirst(event.request).catch(()=>caches.match('./index.html')));
    return;
  }

  if(sameOrigin && (
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/app.js') ||
    url.pathname.endsWith('/styles.css') ||
    url.pathname.endsWith('/manifest.json') ||
    url.pathname.endsWith('/sw.js')
  )){
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Never substitute the HTML shell for executable or WASM assets.
  if(url.pathname.endsWith('.wasm') || url.pathname.endsWith('.js') || url.pathname.includes('dwg-worker')){
    event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});
