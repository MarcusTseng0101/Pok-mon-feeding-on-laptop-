// 在外面也能用（Tailscale HTTPS）：src/main/phone.js 的 serve 部分
//   F23：tailscale serve 把請求轉到 127.0.0.1，所以打開這個選項才多聽 127.0.0.1；沒打開就不聽；永遠不聽 0.0.0.0；
//        不相信 Tailscale-User-Login 標頭，token 仍然是唯一的門
//   網址只收 *.ts.net（測試連線時網址裡帶著密碼）；app 不執行 tailscale 指令
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPhoneServer, serveBase, serveCommand, checkServe, LOOPBACK } from '../src/main/phone.js';

const dir = fileURLToPath(new URL('../src/phone/', import.meta.url));
const TOKEN = '0123456789abcdef0123456789abcdef';
const BASE = 'https://laptop.tail1234.ts.net';
const files = { '': `${dir}index.html`, 'phone.js': `${dir}phone.js` };
const randomPort = () => 39000 + Math.floor(Math.random() * 900);
const canConnect = (host, port) => fetch(`http://${host}:${port}/t/${TOKEN}/data.json`).then(r => r.status, () => 'refused');

test('serveBase：只收 https://<電腦>.<tailnet>.ts.net（可以少打 https:// 或多一個 /），其他都不收', () => {
  assert.equal(serveBase('https://laptop.tail1234.ts.net'), BASE);
  assert.equal(serveBase('  laptop.TAIL1234.ts.net/ '), BASE);
  for (const bad of ['http://laptop.tail1234.ts.net', 'https://evil.com', 'https://laptop.tail1234.ts.net.evil.com', 'https://ts.net', 'https://a.ts.net',
    'https://laptop.tail1234.ts.net/t/abc', 'https://user@laptop.tail1234.ts.net', 'https://laptop.tail1234.ts.net:8443', '', null, 'javascript:alert(1)']) {
    assert.equal(serveBase(bad), null, String(bad));
  }
  assert.equal(serveCommand(37851), 'tailscale serve --bg --https=443 http://127.0.0.1:37851');
});

test('F23：沒打開「在外面也能用」→ 不聽 127.0.0.1；打開 → 聽，網址清單多一個 https 的（沒有 http://127.0.0.1）', async () => {
  const s = createPhoneServer({ token: TOKEN, getSnapshot: () => ({ ok: 1 }), files });
  // 容器裡沒有區網位址：用另一個 loopback 位址當「區網」
  const lan = { address: '127.0.0.2', tailscale: false };
  try {
    const port = randomPort();
    let urls = await s.start([lan], port);
    assert.deepEqual(urls.map(u => u.url), [`http://127.0.0.2:${s.port}/t/${TOKEN}/`]);
    assert.equal(await canConnect(LOOPBACK, s.port), 'refused', '沒打開就不聽 127.0.0.1');
    urls = await s.start([lan], port, { serve: 'laptop.tail1234.ts.net' });
    assert.equal(await canConnect(LOOPBACK, s.port), 200);
    assert.deepEqual(urls.map(u => u.url), [`http://127.0.0.2:${s.port}/t/${TOKEN}/`, `${BASE}/t/${TOKEN}/`]);
    assert.equal(urls[1].https, true);
    // 網址不對就當作沒打開
    urls = await s.start([lan], port, { serve: 'https://evil.com' });
    assert.equal(await canConnect(LOOPBACK, s.port), 'refused');
    // 重新產生網址：https 的也換掉
    await s.start([lan], port, { serve: BASE });
    const t2 = s.regenerate();
    assert.equal(s.urls[1].url, `${BASE}/t/${t2}/`);
  } finally { await s.stop(); }
});

test('F23：傳進來的位址清單裡有 0.0.0.0 也不會照聽；app 給的位址（privateAddresses）本來就沒有 127.0.0.1', async () => {
  const s = createPhoneServer({ token: TOKEN, getSnapshot: () => ({}), files });
  try {
    const urls = await s.start([{ address: '0.0.0.0' }, { address: '127.0.0.2' }], randomPort());
    assert.deepEqual(urls.map(u => new URL(u.url).hostname), ['127.0.0.2']);
    assert.equal(await canConnect(LOOPBACK, s.port), 'refused');
  } finally { await s.stop(); }
  const main = readFileSync(new URL('../src/main/main.js', import.meta.url), 'utf8');
  assert.match(main, /phone\.start\(privateAddresses\(os\.networkInterfaces\(\)\), undefined, \{ serve: phoneServe \}\)/, 'main.js 只給區網和 Tailscale 的位址，127.0.0.1 交給 serve 決定');
  const src = readFileSync(new URL('../src/main/phone.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /listen\([^)]*'0\.0\.0\.0'/);
  assert.doesNotMatch(src, /tailscale-user|x-forwarded/i, '不相信 Tailscale 或代理加的身分標頭');
  assert.doesNotMatch(src, /child_process/, 'app 不執行 tailscale 指令');
  assert.doesNotMatch(readFileSync(new URL('../src/main/main.js', import.meta.url), 'utf8'), /tailscale serve[^\n]*(exec|spawn)|(exec|spawn)[^\n]*tailscale/i);
});

test('F23：從 127.0.0.1 進來（tailscale serve），token 不對一樣 404；帶了 Tailscale-User-Login 也沒用', async () => {
  const s = createPhoneServer({ token: TOKEN, getSnapshot: () => ({ ok: 1 }), files });
  try {
    await s.start([], randomPort(), { serve: BASE });
    const bad = await fetch(`http://${LOOPBACK}:${s.port}/t/${'f'.repeat(32)}/data.json`, { headers: { 'Tailscale-User-Login': 'me@example.com' } });
    assert.equal(bad.status, 404);
    const good = await fetch(`http://${LOOPBACK}:${s.port}/t/${TOKEN}/data.json`);
    assert.deepEqual(await good.json(), { ok: 1 });
    // 經過 https 代理時 Origin 是 https://<電腦>.ts.net、Host 一樣：POST act 照樣收
    const post = await fetch(`http://${LOOPBACK}:${s.port}/t/${TOKEN}/act`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `https://${LOOPBACK}:${s.port}` }, body: JSON.stringify({ kind: 'drink', id: 'ab'.repeat(16), at: 1 }) });
    assert.equal(post.status, 200);
  } finally { await s.stop(); }
});

test('測試連線：GET https://<電腦>.ts.net/t/<token>/data.json；不是 ts.net 的網址根本不送出去（網址裡有密碼）', async () => {
  const asked = [];
  const ok = await checkServe(BASE, TOKEN, async url => { asked.push(url); return { ok: true, status: 200, json: async () => ({}) }; });
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(asked, [`${BASE}/t/${TOKEN}/data.json`]);
  const bad = await checkServe('https://evil.com', TOKEN, async url => { asked.push(url); return { ok: true, json: async () => ({}) }; });
  assert.equal(bad.ok, false);
  assert.equal(asked.length, 1, '不對的網址不會發出請求');
  const gone = await checkServe(BASE, TOKEN, async () => ({ ok: false, status: 502 }));
  assert.equal(gone.ok, false);
  assert.match(gone.error, /502/);
  const down = await checkServe(BASE, TOKEN, async () => { throw new TypeError('fetch failed'); });
  assert.equal(down.ok, false);
  assert.match(down.error, /連不到/);
});
