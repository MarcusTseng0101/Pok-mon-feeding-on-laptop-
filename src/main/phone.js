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
// - 頁面不准執行內嵌程式（Content-Security-Policy），文字一律用 textContent 放進畫面（見 src/phone/phone.js）
// 這個檔案不碰 Electron（main.js 負責接起來），所以 node --test 可以直接測。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { validAction } from '../core/checkin.js';

export const DEFAULT_PORT = 37851;
export const newToken = () => randomBytes(16).toString('hex');

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
    // addresses：[{ address, tailscale }]；port 被佔用就往後找（最多 10 個）
    async start(addresses, port = DEFAULT_PORT) {
      await this.stop();
      if (!addresses.length) return urls;
      let first = null, used = port;
      for (let p = port; p < port + 10 && !first; p++) {
        try { first = await listen(addresses[0].address, p); used = p; } catch (err) { if (err.code !== 'EADDRINUSE') throw err; }
      }
      if (!first) throw new Error('找不到可以用的連接埠');
      servers = [first];
      for (const a of addresses.slice(1)) { try { servers.push(await listen(a.address, used)); } catch { /* 這個位址不能用：跳過 */ } }
      urls = addresses.slice(0, servers.length).map(a => ({ url: `http://${a.address}:${used}/t/${current}/`, tailscale: a.tailscale }));
      return urls;
    },
    async stop() {
      await Promise.all(servers.map(s => new Promise(r => s.close(() => r()))));
      servers = [];
      urls = [];
    },
    // 重新產生網址（舊的網址馬上失效）
    regenerate() {
      current = newToken();
      urls = urls.map(u => ({ ...u, url: u.url.replace(/\/t\/[0-9a-f]{32}\//, `/t/${current}/`) }));
      return current;
    },
  };
}
