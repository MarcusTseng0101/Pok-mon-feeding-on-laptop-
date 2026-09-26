// 手機上看得到的小頁面：電腦上的 app 開一個只給區網（和 Tailscale）連的小網頁，手機掃 QR code 就能看信箱、明信片。
//
// 安全：
// - 預設關閉，要在設定裡打開
// - 網址帶 128-bit 的隨機 token（/t/<token>/），沒有 token 或 token 不對一律 404；token 可以一鍵重新產生
// - 只提供 GET（唯讀），絕不提供存檔原始 JSON，只有畫面組好的摘要（core/phonedata.js）
// - 只監聽區網位址（10.x、172.16–31.x、192.168.x）和 Tailscale 的位址（100.64–127.x），不監聽 0.0.0.0
// - 頁面不准執行內嵌程式（Content-Security-Policy），文字一律用 textContent 放進畫面（見 src/phone/phone.js）
// 這個檔案不碰 Electron（main.js 負責接起來），所以 node --test 可以直接測。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' };

// files：{ 網址上的檔名: 硬碟上的路徑 }（'' 是首頁）；getSnapshot()：現在的摘要（物件）
export function createPhoneServer({ files, getSnapshot, token }) {
  let current = token ?? newToken();
  let servers = [];
  let urls = [];

  const sameToken = t => {
    const a = Buffer.from(String(t)), b = Buffer.from(current);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  async function handle(req, res) {
    const send = (code, body = '', type = 'text/plain; charset=utf-8') => {
      res.writeHead(code, { ...HEADERS, 'Content-Type': type });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...HEADERS, Allow: 'GET, HEAD' }); res.end(); return; }
    const m = /^\/t\/([0-9a-f]{32})\/([a-z0-9.-]*)$/.exec(new URL(req.url, 'http://x').pathname);
    if (!m || !sameToken(m[1])) { send(404, 'not found'); return; }
    const name = m[2];
    if (name === 'data.json') { send(200, JSON.stringify(getSnapshot() ?? {}), 'application/json; charset=utf-8'); return; }
    if (!Object.hasOwn(files, name)) { send(404, 'not found'); return; }
    try {
      const file = files[name];
      send(200, await readFile(file), TYPES[path.extname(file)] ?? 'application/octet-stream');
    } catch { send(404, 'not found'); }
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
