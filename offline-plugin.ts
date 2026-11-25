import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
/** Local assets only. User media and research records have separate explicit storage. */
export function offlinePlugin(): Plugin {
  return {
    name: 'chladni-offline',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = [
        './',
        './index.html',
        './fonts/IBMPlexSansKR-Regular.woff2',
        './fonts/IBMPlexSansKR-Medium.woff2',
        './environment/studio_small_08_1k.hdr',
        './favicon.svg',
        ...Object.keys(bundle)
          .filter((x) => x !== 'index.html')
          .map((x) => './' + x),
      ];
      const revision = createHash('sha256')
        .update(JSON.stringify(files))
        .digest('hex')
        .slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `const PREFIX='chladni-'+new URL(self.registration.scope).pathname+'-';const CACHE=PREFIX+${JSON.stringify(revision)};const ASSETS=${JSON.stringify(files)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith(caches.open(CACHE).then(async cache=>{const cached=await cache.match(event.request,{ignoreSearch:true,ignoreVary:true});if(cached)return cached;if(event.request.mode==='navigate'){try{return await fetch(event.request);}catch{return (await cache.match('./index.html',{ignoreVary:true}));}}return fetch(event.request);}));});`,
      });
    },
  };
}
