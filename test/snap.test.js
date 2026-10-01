// 拍照，一起做：手機頁面（src/phone/snap.js）
//   對照表：偵測到的物件 → 你在做什麼
//   F31：猜的只是預選——沒有信心 ≥ 0.5 的物件就不預選
//   F30：照片不離開手機——src/phone/*.js 沒有 FormData、XMLHttpRequest、sendBeacon；fetch( 只有兩處（讀 data.json、送 act），
//        送出的 body 只有 JSON.stringify({ kind, id, at })
//   F33：不用 eval、不用 WebAssembly、不連外部網址；CSP 不放寬
//   架構規則 2：電腦端不 import vendor 資料夾的任何東西
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url'; // Windows：.pathname 會變成 /C:/...，要轉回真的路徑
import { SNAPS } from '../src/core/checkin.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const src = read('../src/phone/snap.js');
// 在沒有 document 的環境跑：只拿到純邏輯（畫面的部分包在 if (typeof document !== 'undefined') 裡）
const ctx = vm.createContext({});
vm.runInContext(`${src}\nthis.out = { guessKind, SNAP_OBJECTS, SNAP_KINDS, GUESS_MIN };`, ctx);
const { guessKind, GUESS_MIN } = ctx.out;
const { SNAP_OBJECTS, SNAP_KINDS } = JSON.parse(JSON.stringify(ctx.out)); // 換成這邊的陣列（vm 裡的原型不一樣）
const d = (cls, score) => ({ class: cls, score });

test('對照表：杯子、瓶子 → 喝水；書、筆電 → 讀書；碗和食物 → 吃飯；床、沙發 → 休息', () => {
  assert.equal(guessKind([d('cup', 0.9)]).kind, 'drink');
  assert.equal(guessKind([d('bottle', 0.7)]).kind, 'drink');
  assert.equal(guessKind([d('book', 0.8)]).kind, 'read');
  assert.equal(guessKind([d('laptop', 0.6)]).kind, 'read');
  for (const f of ['bowl', 'sandwich', 'pizza', 'banana', 'fork']) assert.equal(guessKind([d(f, 0.6)]).kind, 'eat', f);
  assert.equal(guessKind([d('couch', 0.6)]).kind, 'rest');
  // 同一張有好幾樣：信心最高的那一樣
  assert.equal(guessKind([d('cup', 0.55), d('book', 0.8), d('person', 0.99)]).kind, 'read');
  // 每一個物件只對到一件事
  const all = Object.values(SNAP_OBJECTS).flat();
  assert.equal(new Set(all).size, all.length);
});

test('F31：沒有信心就不預選；人、狗這種不相干的東西也不預選', () => {
  assert.equal(GUESS_MIN, 0.5);
  assert.equal(guessKind([]), null);
  assert.equal(guessKind([d('cup', 0.49)]), null);
  assert.equal(guessKind([d('person', 0.99), d('dog', 0.9)]), null);
  assert.equal(guessKind([d('cup', 0.5)]).kind, 'drink');
});

test('選項跟電腦（core/checkin.js 的 SNAPS）一樣；生活表的字跟 core/life.js 一樣', async () => {
  assert.deepEqual(SNAP_KINDS.map(k => k.id), SNAPS.map(s => s.id));
  assert.deepEqual(SNAP_KINDS.map(k => k.minutes), SNAPS.map(s => s.minutes));
  assert.deepEqual(Object.keys(SNAP_OBJECTS).sort(), SNAPS.map(s => s.id).sort());
  const { CODE } = await import('../src/core/life.js');
  for (const k of SNAP_KINDS) assert.equal(k.code, CODE[SNAPS.find(s => s.id === k.id).life], k.id);
});

test('F30：照片不離開手機（靜態檢查）', () => {
  const files = readdirSync(new URL('../src/phone/', import.meta.url)).filter(f => f.endsWith('.js'));
  assert.deepEqual(files.sort(), ['phone.js', 'snap.js', 'sw.js']);
  const strip = f => read(`../src/phone/${f}`).replace(/^\s*\/\/.*$/gm, '');
  const code = ['phone.js', 'snap.js'].map(strip).join('\n'), sw = strip('sw.js');
  assert.doesNotMatch(code + sw, /FormData|XMLHttpRequest|sendBeacon|WebSocket|EventSource|navigator\.share|postMessage/);
  assert.equal((code.match(/fetch\(/g) ?? []).length, 2);
  assert.match(code, /fetch\('data\.json'/);
  // 送出的 body 只有 kind、id、at（排隊的也一樣，F30）
  assert.match(code, /fetch\('act', \{ method: 'POST', headers: \{ 'Content-Type': 'application\/json' \}, body: JSON\.stringify\(\{ kind: a\.kind, id: a\.id, at: a\.at \}\) \}\)/);
  assert.doesNotMatch(code, /randomUUID/, 'F25');
  // 佇列只存 { kind, id, at }（照片不進佇列）
  assert.match(code, /const a = \{ kind, id: newId\(\), at: Date\.now\(\) \};/);
  // service worker 只管 GET，不送任何 body、不改請求
  assert.match(sw, /if \(req\.method !== 'GET'\) return;/);
  assert.doesNotMatch(sw, /method:|body:|\.formData\(|new Request\(/);
});

test('F33：不用 eval、WebAssembly；不連外部網址；模型從同一個小網站讀；CSP 沒有放寬', () => {
  const code = read('../src/phone/snap.js').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ .*$/gm, '');
  assert.doesNotMatch(code, /\beval\(|new Function|WebAssembly|wasm|https?:\/\//);
  assert.match(code, /modelUrl: new URL\('model\.json', location\.href\)\.href/);
  for (const f of readdirSync(new URL('../src/phone/vendor/', import.meta.url)).filter(x => x.endsWith('.js'))) {
    assert.doesNotMatch(read(`../src/phone/vendor/${f}`), /WebAssembly|\beval\(|new Function\(/, `${f}：CSP 不允許（見 vendor/LICENSES.md 的修改）`);
  }
  assert.match(code, /setBackend\('webgl'\)/);
  const server = read('../src/main/phone.js');
  assert.match(server, /script-src 'self';/);
  assert.doesNotMatch(server, /unsafe-eval|wasm-unsafe-eval|unsafe-inline/);
  // index.html：只載同一個網站的程式；模型不是一打開就載
  const html = read('../src/phone/index.html');
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]), ['phone.js']);
  assert.match(read('../src/phone/phone.js'), /src: 'snap\.js'/, 'snap.js 由 phone.js 載入（同一個網站）');
  assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, '文字一律用 textContent');
  assert.match(html, /<input type="file" accept="image\/\*" capture="environment">/);
});

test('架構規則 2：src/main、src/renderer、src/core 不 import vendor 資料夾', () => {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  for (const f of ['src/main', 'src/renderer', 'src/core'].flatMap(d => walk(fileURLToPath(new URL(`../${d}`, import.meta.url))))) {
    if (!/\.(m?js|cjs|html)$/.test(f)) continue;
    assert.doesNotMatch(readFileSync(f, 'utf8'), /vendor\//, f);
  }
});
