// 斷網也能用：手機頁面的 service worker（只在 HTTPS 下註冊，也就是 Tailscale 的「在外面也能用」）。
//
// - 頁面本身（html、js、css、字型）和 data.json：網路優先，連不到才用上一次存下來的（F26：連得到就一定是新的，不會卡在舊版）。
//   用快取的 data.json 時加一個標頭 X-Kalos-Offline，手機頁面就寫「離線中，資料是 HH:MM 的」。
// - 辨識照片用的 vendor 檔案（TensorFlow.js＋模型）：版本固定，存一次就一直用（VENDOR_CACHE 帶版本，換版本時刪掉舊的）。
//   第一次打開就在背景存好，斷網也能拍照、猜、一起做。
// - 網址換了（token 重新產生）：頁面或 data.json 回 404 → 刪掉自己的快取、取消註冊，頁面寫「網址換了，請重新掃 QR code」。
// - POST act 不經過這裡（照原樣送；送不出去由 snap.js 排隊）。
// - 電腦才是唯一的資料來源（F24）：這裡只存快取，iPhone 清掉也沒關係，連上電腦就全部回來。
const PAGE_CACHE = 'kalos-page-v1';
const VENDOR_CACHE = 'kalos-vendor-tfjs4.22.0-cocossd2.2.3-v1';
const PAGE = ['./', 'phone.js', 'phone.css', 'snap.js', 'snap.css', 'font.woff2', 'data.json'];
const VENDOR = [
  'tf-core.min.js', 'tf-converter.min.js', 'tf-backend-cpu.min.js', 'tf-backend-webgl.min.js', 'coco-ssd.min.js',
  'model.json', 'group1-shard1of5', 'group1-shard2of5', 'group1-shard3of5', 'group1-shard4of5', 'group1-shard5of5',
];
const GONE = '網址換了，請重新掃電腦上的 QR code。';

const here = new URL('./', self.registration.scope);
const nameOf = url => (url.startsWith(here.href) ? url.slice(here.href.length).split('?')[0] : null);

async function fill(cacheName, list) {
  const cache = await caches.open(cacheName);
  for (const f of list) {
    if (await cache.match(new URL(f, here))) continue;
    try { const r = await fetch(new URL(f, here), { cache: 'no-store' }); if (r.ok) await cache.put(new URL(f, here), r); } catch { /* 下次再存 */ }
  }
}

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(fill(PAGE_CACHE, PAGE));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== PAGE_CACHE && k !== VENDOR_CACHE) await caches.delete(k);
    await self.clients.claim();
    await fill(VENDOR_CACHE, VENDOR); // 背景存好辨識用的檔案（大約 19 MB，只存一次）
  })());
});

async function forget() {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const name = nameOf(req.url);
  if (name == null) return;
  if (VENDOR.includes(name)) {
    e.respondWith((async () => {
      const cache = await caches.open(VENDOR_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) await cache.put(req, r.clone());
      return r;
    })());
    return;
  }
  if (!PAGE.includes(name === '' ? './' : name)) return;
  e.respondWith((async () => {
    const cache = await caches.open(PAGE_CACHE);
    const key = new URL(name === '' ? './' : name, here);
    try {
      const r = await fetch(req, { cache: 'no-store' });
      if (r.status === 404 && (name === '' || name === 'data.json')) {
        await forget();
        return new Response(name === '' ? GONE : JSON.stringify({ gone: true }), { status: 404, headers: { 'Content-Type': name === '' ? 'text/plain; charset=utf-8' : 'application/json' } });
      }
      if (r.ok) await cache.put(key, r.clone());
      return r;
    } catch {
      const hit = await cache.match(key);
      if (!hit) return new Response('', { status: 503 });
      if (name !== 'data.json') return hit;
      const h = new Headers(hit.headers);
      h.set('X-Kalos-Offline', '1');
      return new Response(await hit.blob(), { status: 200, headers: h });
    }
  })());
});
