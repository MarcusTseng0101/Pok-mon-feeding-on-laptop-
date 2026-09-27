// 手機上看得到的小頁面：電腦上的 app 開一個只給區網（和 Tailscale）連的小網頁，手機掃 QR code 就能看信箱、明信片。
//
// 安全：
// - 預設關閉，要在設定裡打開
// - 網址帶 128-bit 的隨機 token（/t/<token>/），沒有 token 或 token 不對一律 404；token 可以一鍵重新產生
// - 讀：只提供 GET，絕不提供存檔原始 JSON，只有畫面組好的摘要（core/phonedata.js）
// - 寫：只有一條 POST /t/<token>/act（拍照確認後一起做，core/checkin.js）。只收 JSON、同一個網址來的、1 KB 以內、每分鐘 20 個以內，
//   而且只能是 { kind, id, at } 三個欄位；收到的東西原樣交給 onAction，這裡不碰任何數值。
//   1 KB 也是「照片不會離開手機」的最後一道防線（F30）：不管為了什麼都不要放寬
// - 手機上辨識照片用的 TensorFlow.js 和模型（src/phone/vendor 資料夾）：只有 VENDOR 列出來的檔案，一個一個列，不用萬用字元（F33）；
//   這些檔案不會變，手機可以快取（其他一律不快取）
// - 只監聽區網位址（10.x、172.16–31.x、192.168.x）和 Tailscale 的位址（100.64–127.x），不監聽 0.0.0.0
// - 在外面也能用（Tailscale HTTPS）：你自己在電腦上跑 `tailscale serve`，它把 https://<電腦>.<tailnet>.ts.net 轉到 127.0.0.1，
//   所以只有這個選項打開時才多聽 127.0.0.1（F23）。app 不執行 tailscale 指令；不相信 Tailscale-User-Login 這類標頭
//   （從 127.0.0.1 進來的請求，本機任何程式都能偽造），token 仍然是唯一的門
// - 頁面不准執行內嵌程式（Content-Security-Policy），文字一律用 textContent 放進畫面（見 src/phone/phone.js）
// 這個檔案不碰 Electron（main.js 負責接起來），所以 node --test 可以直接測。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { validAction } from '../core/checkin.js';

export const DEFAULT_PORT = 37851;
export const newToken = () => randomBytes(16).toString('hex');
export const LOOPBACK = '127.0.0.1';

// 在外面也能用：你貼上的 Tailscale HTTPS 網址 → 'https://<電腦>.<tailnet>.ts.net'（不對就是 null）。
// 只收 *.ts.net：測試連線時網址裡帶著密碼，不能送到別的網站
export function serveBase(s) {
  const m = /^\s*(?:https:\/\/)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9-]+\.ts\.net)\/?\s*$/i.exec(String(s ?? ''));
  return m ? `https://${m[1].toLowerCase()}` : null;
}
// 要貼到電腦終端機的那一行（app 自己不執行）
export const serveCommand = port => `tailscale serve --bg --https=443 http://${LOOPBACK}:${port}`;
// 測試連線：從這台電腦 GET https://<電腦>.ts.net/t/<token>/data.json（走 tailscale serve 回到自己）
export async function checkServe(base, token, fetchImpl = fetch) {
  const b = serveBase(base);
  if (!b) return { ok: false, error: '網址要像 https://你的電腦.xxxx.ts.net' };
  try {
    const r = await fetchImpl(`${b}/t/${token}/data.json`, { signal: AbortSignal.timeout(6000), redirect: 'error' });
    if (!r.ok) return { ok: false, error: `連得到，但回了 ${r.status}（tailscale serve 的目標是不是 ${LOOPBACK} 和這裡的連接埠？）` };
    await r.json();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `連不到（${err?.name === 'TimeoutError' ? '逾時' : '網路錯誤'}）：Tailscale 有沒有開、MagicDNS 和 HTTPS 憑證有沒有打開、指令有沒有貼` };
  }
}

// 可以監聽的位址：區網和 Tailscale（100.64.0.0/10）的 IPv4
export function privateAddresses(interfaces) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces ?? {})) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      const [p, q] = a.address.split('.').map(Number);
      const tailscale = p === 100 && q >= 64 && q <= 127;
      const lan = p === 10 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168);
      if (lan || tailscale) out.push({ address: a.address, name, tailscale });
    }
  }
  return out;
}

const HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};
const ACT_LIMIT = 1024; // POST body 最多幾個 byte
const ACT_RATE = 20; // 每分鐘最多幾個 POST（猜的，可調整）
const ACT_TIMEOUT = 5000; // 等 onAction 回應最多幾毫秒
// 回給手機的欄位：只有畫面用得到的
const REPLY_FIELDS = ['ok', 'kind', 'name', 'line', 'until'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };

// src/phone/vendor 資料夾裡的每一個檔案（LICENSES.md 除外，那是給人看的）。網址上是平的：model.json 用相對路徑找 shard
// 版本：@tensorflow/tfjs-core、-converter、-backend-cpu、-backend-webgl 4.22.0；@tensorflow-models/coco-ssd 2.2.3；ssdlite_mobilenet_v2
export const VENDOR = [
  'tf-core.min.js', 'tf-converter.min.js', 'tf-backend-cpu.min.js', 'tf-backend-webgl.min.js', 'coco-ssd.min.js',
  'model.json', 'group1-shard1of5', 'group1-shard2of5', 'group1-shard3of5', 'group1-shard4of5', 'group1-shard5of5',
];
const VENDOR_CACHE = 'private, max-age=604800, immutable'; // 手機快取 7 天（猜的，可調整）

// files：{ 網址上的檔名: 硬碟上的路徑 }（'' 是首頁）；getSnapshot()：現在的摘要（物件）
// vendorDir：src/phone/vendor 的路徑（VENDOR 的檔案從這裡讀）
// onAction({ kind, id, at })：拍照確認後一起做（可以是 async），回傳 { ok, kind, name, line, until }；沒有給就一律回 { ok: false }
export function createPhoneServer({ files, getSnapshot, token, vendorDir = null, onAction = null }) {
  let current = token ?? newToken();
  let servers = [];
  let urls = [];
  let port = null;
  let recentPosts = []; // 最近一分鐘的 POST（時間）

  const sameToken = t => {
    const a = Buffer.from(String(t)), b = Buffer.from(current);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  async function handle(req, res) {
    const send = (code, body = '', type = 'text/plain; charset=utf-8', extra = {}) => {
      res.writeHead(code, { ...HEADERS, 'Content-Type': type, ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const m = /^\/t\/([0-9a-f]{32})\/([a-z0-9.-]*)$/.exec(new URL(req.url, 'http://x').pathname);
    if (req.method === 'POST' && (!m || !sameToken(m[1]))) { send(404, 'not found'); return; }
    if (req.method === 'POST' && m[2] === 'act') { await act(req, res, send); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...HEADERS, Allow: 'GET, HEAD' }); res.end(); return; }
    if (!m || !sameToken(m[1])) { send(404, 'not found'); return; }
    const name = m[2];
    if (name === 'data.json') { send(200, JSON.stringify(getSnapshot() ?? {}), 'application/json; charset=utf-8'); return; }
    if (vendorDir && VENDOR.includes(name)) {
      try { send(200, await readFile(path.join(vendorDir, name)), TYPES[path.extname(name)] ?? 'application/octet-stream', { 'Cache-Control': VENDOR_CACHE }); } catch { send(404, 'not found'); }
      return;
    }
    if (!Object.hasOwn(files, name)) { send(404, 'not found'); return; }
    try {
      const file = files[name];
      send(200, await readFile(file), TYPES[path.extname(file)] ?? 'application/octet-stream');
    } catch { send(404, 'not found'); }
  }

  // POST act（F15）：一條一條檢查，有一條不對就不交給 onAction
  async function act(req, res, send) {
    const json = (code, obj) => send(code, JSON.stringify(obj), 'application/json; charset=utf-8');
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') { send(415, 'json only'); return; }
    // 有 Origin 就一定要是這個網址本身（http 或 https 都算，Tailscale serve 是 https）
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) { send(403, 'forbidden'); return; }
    const t = Date.now();
    recentPosts = recentPosts.filter(x => t - x < 60_000);
    if (recentPosts.length >= ACT_RATE) { send(429, 'slow down'); return; }
    recentPosts.push(t);
    if (Number(req.headers['content-length']) > ACT_LIMIT) { tooBig(req, res); return; }
    // 邊讀邊算大小，超過就斷線（不先讀完再檢查）
    const body = await new Promise(resolve => {
      const chunks = [];
      let size = 0, done = false;
      req.on('data', c => {
        if (done) return;
        size += c.length;
        if (size > ACT_LIMIT) { done = true; resolve(null); tooBig(req, res); return; }
        chunks.push(c);
      });
      req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
      req.on('error', () => { if (!done) { done = true; resolve(null); } });
    });
    if (body === null) return;
    let action = null;
    try { action = validAction(JSON.parse(body)); } catch { action = null; }
    if (!action) { send(400, 'bad request'); return; }
    if (!onAction) { json(200, { ok: false }); return; }
    let reply = null;
    try {
      reply = await Promise.race([Promise.resolve(onAction(action)), new Promise(r => setTimeout(() => r(undefined), ACT_TIMEOUT))]);
    } catch { reply = null; }
    if (reply === undefined) { send(503, 'busy'); return; }
    const out = { ok: false };
    if (reply && typeof reply === 'object') for (const k of REPLY_FIELDS) if (reply[k] !== undefined) out[k] = reply[k];
    json(200, out);
  }
  function tooBig(req, res) {
    if (res.headersSent) { req.destroy(); return; }
    res.writeHead(413, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
    res.end('too large', () => req.destroy());
  }

  function listen(address, port) {
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => { handle(req, res).catch(() => { res.writeHead(500); res.end(); }); });
      s.once('error', reject);
      s.listen(port, address, () => { s.off('error', reject); resolve(s); });
    });
  }

  return {
    get token() { return current; },
    get urls() { return urls; },
    get port() { return port; },
    // addresses：[{ address, tailscale }]；port 被佔用就往後找（最多 10 個）
    // serve：在外面也能用的網址（serveBase 的結果）：多聽 127.0.0.1，網址清單多一個 https 的
    async start(addresses, from = DEFAULT_PORT, { serve = null } = {}) {
      await this.stop();
      const base = serveBase(serve);
      // 0.0.0.0 一律不聽；127.0.0.1 只有打開「在外面也能用」時才由這裡加（main.js 給的 privateAddresses 本來就沒有它）
      const list = addresses.filter(a => a.address !== '0.0.0.0' && !(base && a.address === LOOPBACK));
      if (base) list.push({ address: LOOPBACK, local: true });
      if (!list.length) return urls;
      let first = null, used = from;
      for (let p = from; p < from + 10 && !first; p++) {
        try { first = await listen(list[0].address, p); used = p; } catch (err) { if (err.code !== 'EADDRINUSE') throw err; }
      }
      if (!first) throw new Error('找不到可以用的連接埠');
      servers = [first];
      const ok = [list[0]];
      for (const a of list.slice(1)) { try { servers.push(await listen(a.address, used)); ok.push(a); } catch { /* 這個位址不能用：跳過 */ } }
      port = used;
      urls = ok.filter(a => !a.local).map(a => ({ url: `http://${a.address}:${used}/t/${current}/`, tailscale: a.tailscale }));
      if (base && ok.some(a => a.local)) urls.push({ url: `${base}/t/${current}/`, tailscale: true, https: true });
      return urls;
    },
    async stop() {
      await Promise.all(servers.map(s => new Promise(r => s.close(() => r()))));
      servers = [];
      urls = [];
      port = null;
    },
    // 重新產生網址（舊的網址馬上失效）
    regenerate() {
      current = newToken();
      urls = urls.map(u => ({ ...u, url: u.url.replace(/\/t\/[0-9a-f]{32}\//, `/t/${current}/`) }));
      return current;
    },
  };
}
