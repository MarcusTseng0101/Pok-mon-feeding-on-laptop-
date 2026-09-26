// 手機頁面的小網站（src/main/phone.js）：沒有 token 一律 404、只能讀、安全標頭、只監聽區網和 Tailscale、重新產生網址
// 還有摘要（core/phonedata.js）只放要顯示的東西
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createPhoneServer, privateAddresses } from '../src/main/phone.js';
import { phoneSnapshot } from '../src/core/phonedata.js';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';

const dir = fileURLToPath(new URL('../src/phone/', import.meta.url));
const TOKEN = '0123456789abcdef0123456789abcdef';

async function withServer(fn, snapshot = { hello: '<b>x</b>' }) {
  const s = createPhoneServer({ token: TOKEN, getSnapshot: () => snapshot, files: { '': `${dir}index.html`, 'phone.js': `${dir}phone.js`, 'phone.css': `${dir}phone.css` } });
  const [u] = await s.start([{ address: '127.0.0.1', tailscale: false }], 38000 + Math.floor(Math.random() * 1000));
  try { await fn(s, new URL(u.url)); } finally { await s.stop(); }
}

test('沒有 token、token 不對、猜路徑：一律 404', async () => {
  await withServer(async (s, url) => {
    const base = `${url.protocol}//${url.host}`;
    for (const p of ['/', '/data.json', '/t/', `/t/${'f'.repeat(32)}/`, `/t/${'f'.repeat(32)}/data.json`, `/t/${TOKEN}/../../package.json`, `/t/${TOKEN}/save.json`, `/t/${TOKEN.toUpperCase()}/`]) {
      const r = await fetch(base + p);
      assert.equal(r.status, 404, p);
    }
    const ok = await fetch(url);
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /Kalos Amie/);
  });
});

test('只能讀：POST／PUT／DELETE 都不行；摘要是 JSON、有安全標頭', async () => {
  await withServer(async (s, url) => {
    for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await fetch(new URL('data.json', url), { method })).status, 405, method);
    const r = await fetch(new URL('data.json', url));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { hello: '<b>x</b>' });
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.doesNotMatch(r.headers.get('content-security-policy'), /unsafe-inline/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(new URL('phone.js', url))).headers.get('content-type'), 'text/javascript; charset=utf-8');
  });
});

test('重新產生網址：舊的馬上失效、新的可以用', async () => {
  await withServer(async (s, url) => {
    const t = s.regenerate();
    assert.notEqual(t, TOKEN);
    assert.match(t, /^[0-9a-f]{32}$/);
    assert.equal((await fetch(url)).status, 404);
    assert.equal((await fetch(new URL(s.urls[0].url))).status, 200);
  });
});

test('只監聽區網和 Tailscale 的位址（不含 127.0.0.1、公開 IP、IPv6）', () => {
  const list = privateAddresses({
    lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    wifi: [{ family: 'IPv4', address: '192.168.1.23', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
    eth: [{ family: 'IPv4', address: '10.0.0.5', internal: false }, { family: 'IPv4', address: '172.20.1.1', internal: false }, { family: 'IPv4', address: '172.32.0.1', internal: false }],
    tailscale0: [{ family: 'IPv4', address: '100.101.102.103', internal: false }],
    cgn: [{ family: 'IPv4', address: '100.128.0.1', internal: false }],
    pub: [{ family: 'IPv4', address: '8.8.8.8', internal: false }],
  });
  assert.deepEqual(list.map(a => [a.address, a.tailscale]), [['192.168.1.23', false], ['10.0.0.5', false], ['172.20.1.1', false], ['100.101.102.103', true]]);
});

test('頁面本身：沒有內嵌的程式（CSP 不准）；文字用 textContent', () => {
  const html = readFileSync(`${dir}index.html`, 'utf8'), js = readFileSync(`${dir}phone.js`, 'utf8');
  assert.doesNotMatch(html.replace(/<script src="phone\.js" defer><\/script>/, ''), /<script/);
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
});

test('摘要：只有要顯示的欄位，沒有存檔的其他東西', () => {
  const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
  const t = { v: new Date(2026, 8, 25, 12).getTime() };
  const g = new Game({ dex, state: migrate(defaultSave(t.v), dex, t.v), rng: createRng(1), now: () => t.v });
  g.chooseStarter(650);
  g.rename(g.state.mons[0].uid, '<img src=x onerror=alert(1)>');
  g.setMood('happy');
  const d = phoneSnapshot(g.state, { now: t.v, nameOf: m => g.displayName(m), speciesName: id => dex.name(id), spriteKeyOf: m => String(m.species) });
  assert.deepEqual(Object.keys(d).sort(), ['at', 'daysTogether', 'holidays', 'letters', 'milestones', 'mood', 'pets', 'pics', 'postcards', 'trips']);
  assert.equal(d.mood.zh, '很開心');
  assert.deepEqual(d.holidays, ['中秋節']);
  assert.equal(d.pets[0].name.startsWith('<img'), true, '名字原樣傳過去（頁面用 textContent 顯示）');
  const json = JSON.stringify(d);
  for (const secret of ['bag', 'sync', 'nature', 'training', 'memory', 'mind', 'settings']) assert.equal(json.includes(`"${secret}"`), false, secret);
});
