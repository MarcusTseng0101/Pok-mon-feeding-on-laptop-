// 拍照確認後一起做的寫入路由（src/main/phone.js 的 POST /t/<token>/act）：F15 每一條各一個測試
// 手機頁面本來是唯讀的（PR-E 的 F8）；現在只多這一條路由，其他全部不變
// F30：照片送不過來（1 KB）；F33：vendor 的檔案一個一個列，白名單跟資料夾內容一樣
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createPhoneServer, VENDOR } from '../src/main/phone.js';

const dir = fileURLToPath(new URL('../src/phone/', import.meta.url));
const TOKEN = '0123456789abcdef0123456789abcdef';
const ID = 'ab'.repeat(16);
const good = { kind: 'drink', id: ID, at: 1 };

async function withServer(fn, opts = {}) {
  const got = [];
  const s = createPhoneServer({
    token: TOKEN,
    getSnapshot: () => ({ hello: 1 }),
    files: { '': `${dir}index.html`, 'phone.js': `${dir}phone.js`, 'phone.css': `${dir}phone.css` },
    vendorDir: `${dir}vendor`,
    onAction: a => { got.push(a); return { ok: true, kind: 'drink', name: '咕咕鴿', line: '咕咕鴿跟你一起喝水', until: 5, secret: 'x', affection: 255 }; },
    ...opts,
  });
  const [u] = await s.start([{ address: '127.0.0.1', tailscale: false }], 39000 + Math.floor(Math.random() * 900));
  const url = new URL(u.url);
  const post = (body, { headers = {}, path = 'act', raw = false } = {}) => fetch(new URL(path, url), {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: raw ? body : JSON.stringify(body),
  });
  try { await fn({ s, url, post, got }); } finally { await s.stop(); }
}

test('一起做：格式對就交給 onAction，只回畫面用的欄位（不回存檔、不回數值）', async () => {
  await withServer(async ({ post, got }) => {
    const r = await post(good);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, kind: 'drink', name: '咕咕鴿', line: '咕咕鴿跟你一起喝水', until: 5 });
    assert.deepEqual(got, [good]);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });
});

test('token 不對 → 404（跟 GET 一樣）', async () => {
  await withServer(async ({ url, got }) => {
    const bad = new URL(`/t/${'f'.repeat(32)}/act`, url);
    const r = await fetch(bad, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(good) });
    assert.equal(r.status, 404);
    assert.equal(got.length, 0);
  });
});

test('不是 application/json → 415（跨站的表單送不過來）', async () => {
  await withServer(async ({ post, got }) => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      assert.equal((await post(good, { headers: { 'Content-Type': type } })).status, 415, type);
    }
    assert.equal((await post(good, { headers: { 'Content-Type': 'application/json; charset=utf-8' } })).status, 200);
    assert.equal(got.length, 1);
  });
});

test('Origin 不是這個網址 → 403；同一個網址、沒有 Origin → 可以', async () => {
  await withServer(async ({ url, post, got }) => {
    assert.equal((await post(good, { headers: { Origin: 'http://evil.example' } })).status, 403);
    assert.equal((await post(good, { headers: { Origin: `http://${url.host}.evil.example` } })).status, 403);
    assert.equal((await post(good, { headers: { Origin: 'null' } })).status, 403);
    assert.equal((await post({ ...good, id: 'cd'.repeat(16) }, { headers: { Origin: `http://${url.host}` } })).status, 200);
    assert.equal(got.length, 1);
  });
});

test('body 超過 1 KB → 413（邊讀邊算，不先讀完）', async () => {
  await withServer(async ({ url, post, got }) => {
    assert.equal((await post({ ...good, pad: 'x'.repeat(2000) })).status, 413);
    // 不給 Content-Length（chunked）也一樣擋得住
    const http = await import('node:http');
    const status = await new Promise((resolve, reject) => {
      const req = http.request(new URL('act', url), { method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', err => (err.code === 'ECONNRESET' || err.code === 'EPIPE' ? resolve('reset') : reject(err)));
      const chunk = 'x'.repeat(512);
      let i = 0;
      const pump = () => { if (i++ < 200 && !req.destroyed) { req.write(chunk); setImmediate(pump); } else req.end(); };
      pump();
    });
    assert.ok(status === 413 || status === 'reset', String(status));
    assert.equal(got.length, 0);
  });
});

test('格式不對 → 400：多的欄位、不認識的種類、壞掉的 JSON、id 不對', async () => {
  await withServer(async ({ post, got }) => {
    for (const body of [{ ...good, affection: 255 }, { ...good, kind: 'feed' }, { ...good, id: 'x' }, { ...good, at: 'now' }, [good], null]) {
      assert.equal((await post(body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await post('{nope', { raw: true })).status, 400);
    assert.equal(got.length, 0);
  });
});

test('每分鐘最多 20 個 → 超過 429', async () => {
  await withServer(async ({ post }) => {
    const codes = [];
    for (let i = 0; i < 22; i++) codes.push((await post({ ...good, id: i.toString(16).padStart(32, '0') })).status);
    assert.deepEqual(codes.slice(0, 20), Array(20).fill(200));
    assert.deepEqual(codes.slice(20), [429, 429]);
  });
});

test('只有 act 可以 POST；OPTIONS、PUT、DELETE 一律 405；GET 的行為沒變', async () => {
  await withServer(async ({ url, post }) => {
    assert.equal((await post(good, { path: 'data.json' })).status, 405);
    assert.equal((await post(good, { path: '' })).status, 405);
    for (const method of ['OPTIONS', 'PUT', 'DELETE']) assert.equal((await fetch(new URL('act', url), { method })).status, 405, method);
    assert.equal((await fetch(new URL('act', url))).status, 404, 'GET act：沒有這個檔案');
    const r = await fetch(new URL('data.json', url));
    assert.deepEqual(await r.json(), { hello: 1 });
  });
});

test('沒有接 onAction（例如測試用的小網站）：回 ok:false，不報錯', async () => {
  await withServer(async ({ post }) => {
    const r = await post(good);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: false });
  }, { onAction: undefined });
});

test('F30：照片送不過來——一張最小的 JPEG 照片（base64）就超過 1 KB → 413，不交給 onAction', async () => {
  await withServer(async ({ post, got }) => {
    const photo = readFileSync(new URL('../docs/screens/life-phone.png', import.meta.url)).toString('base64');
    assert.ok(photo.length > 1024);
    assert.equal((await post({ ...good, photo: `data:image/png;base64,${photo}` })).status, 413);
    const small = `data:image/jpeg;base64,${photo.slice(0, 400)}`; // 小到 1 KB 以內：多的欄位照樣 400
    assert.equal((await post({ ...good, photo: small })).status, 400);
    assert.equal(got.length, 0);
    const src = readFileSync(new URL('../src/main/phone.js', import.meta.url), 'utf8');
    assert.match(src, /const ACT_LIMIT = 1024;/, '1 KB 的上限不能放寬');
  });
});

test('F33：vendor 的白名單一個一個列，跟 src/phone/vendor 的內容一樣；只有這些能讀，可以快取；總共 ≤ 21 MB', async () => {
  const files = readdirSync(`${dir}vendor`).filter(f => f !== 'LICENSES.md').sort();
  assert.deepEqual([...VENDOR].sort(), files);
  assert.ok(VENDOR.every(f => /^[a-z0-9.-]+$/.test(f)), '網址上的名字是平的');
  const lic = readFileSync(`${dir}vendor/LICENSES.md`, 'utf8');
  for (const f of files) assert.ok(lic.includes(f), `LICENSES.md 沒寫到 ${f}`);
  assert.match(lic, /Apache License\s+Version 2\.0/);
  const total = files.reduce((s, f) => s + statSync(`${dir}vendor/${f}`).size, 0);
  assert.ok(total <= 21 * 1024 * 1024, `vendor 總共 ${(total / 1048576).toFixed(1)} MB`); // 停損量到 19.7 MB，使用者同意（猜的上限，可調整）
  await withServer(async ({ url }) => {
    const r = await fetch(new URL('coco-ssd.min.js', url));
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /javascript/);
    assert.match(r.headers.get('cache-control'), /max-age/);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    const m = await fetch(new URL('model.json', url));
    assert.equal(m.status, 200);
    assert.match(m.headers.get('content-type'), /json/);
    assert.equal((await fetch(new URL('group1-shard5of5', url))).status, 200);
    for (const bad of ['LICENSES.md', 'tf.min.js', 'vendor', '..%2fphone.js']) assert.equal((await fetch(new URL(bad, url))).status, 404, bad);
    assert.equal((await fetch(new URL('data.json', url))).headers.get('cache-control'), 'no-store', '其他的一律不快取');
  });
});
