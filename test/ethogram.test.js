// 物種生活表（core/ethogram.js）：資料完整、時間分配照表（M5）、不同身體的寶可夢過得不一樣（M6）、架構規則
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRng } from '../src/core/rng.js';
import * as E from '../src/core/ethogram.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const KALOS = JSON.parse(read('../data/kalos.json'));
const TYPES = Object.fromEntries((Array.isArray(KALOS) ? KALOS : KALOS.species ?? Object.values(KALOS)).map(s => [s.id, s.types]));
const IDS = Array.from({ length: 72 }, (_, i) => 650 + i);

// scene/habits.js 的 HABITS_BY_SPECIES（renderer 的檔案會載入畫面的東西，這裡直接讀文字）
function habitsBySpecies() {
  const s = read('../src/renderer/scene/habits.js');
  const blk = s.slice(s.indexOf('export const HABITS_BY_SPECIES = {'));
  const body = blk.slice(0, blk.indexOf('};'));
  return Object.fromEntries([...body.matchAll(/(\d{3}): \[([^\]]*)\]/g)].map(([, id, v]) => [id, [...v.matchAll(/'([a-z]+)'/g)].map(m => m[1])]));
}

// 核心模擬：一隻寶可夢過一天（24 小時，每一段照 nextBout），所有選項都做得到、心智不偏
function offersFor(id, hour) {
  const ctx = { id, types: TYPES[id], hour, fullness: 80, enjoyment: 100, hearts: 2, others: 2, pointer: true, userActive: true, music: false, floats: false, digger: id === 659 || id === 660 };
  const offers = Object.keys(E.ACTS).map(name => ({ name, w: E.actWeight(name, ctx), cat: 'x' }));
  for (const h of E.SPECIES[id].habits) offers.push({ name: h, w: 7, cat: 'habit' });
  offers.push({ name: 'greet', w: 3, cat: 'social' }, { name: 'toss', w: 4, cat: 'social' });
  return offers;
}
function simulateDay(id, seed) {
  const rng = createRng(seed);
  const cls = {}, names = {};
  for (let hour = 0; hour < 24; hour++) {
    const offers = offersFor(id, hour);
    let t = 0;
    while (t < 3600) {
      const b = E.nextBout(id, { hour, types: TYPES[id], offers }, rng);
      cls[b.kind] = (cls[b.kind] ?? 0) + b.dur;
      names[b.name] = (names[b.name] ?? 0) + b.dur;
      t += b.dur;
    }
  }
  return { cls, names };
}
const norm = h => { const s = Object.values(h).reduce((a, b) => a + b, 0); return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v / s])); };
function jsd(a, b) {
  const p = norm(a), q = norm(b);
  let d = 0;
  for (const k of new Set([...Object.keys(p), ...Object.keys(q)])) {
    const x = p[k] ?? 0, y = q[k] ?? 0, m = (x + y) / 2;
    if (x) d += 0.5 * x * Math.log2(x / m);
    if (y) d += 0.5 * y * Math.log2(y / m);
  }
  return Math.sqrt(Math.max(0, d));
}
const meanBudget = id => {
  const out = {};
  for (let h = 0; h < 24; h++) for (const [k, v] of Object.entries(E.budgetAt(id, h, {}, TYPES[id]))) out[k] = (out[k] ?? 0) + v / 24;
  return out;
};

test('72 隻都有，每一隻的三個依據（外型、屬性、圖鑑）都寫了，出處是 52poke', () => {
  assert.deepEqual(Object.keys(E.SPECIES).map(Number).sort((a, b) => a - b), IDS);
  for (const id of IDS) {
    const s = E.SPECIES[id];
    for (const k of ['look', 'type', 'dex']) assert.ok(s.why?.[k]?.length >= 1, `${id} ${s.name} 缺 why.${k}`);
    assert.ok(s.src.startsWith('https://wiki.52poke.com/zh-hant/'), `${id} 缺出處`);
    assert.ok(E.TEMPLATES[s.tpl], `${id} 模板 ${s.tpl} 不存在`);
    assert.ok(['day', 'night', 'crep', 'any'].includes(s.diel), `${id} 作息 ${s.diel}`);
    assert.ok(s.body && s.sleep && s.traits, `${id} 缺身體、睡姿或個性`);
  }
});

test('scene/habits.js 的每一個習性都出現在那一隻的表裡（舊的對照一個都沒丟）', () => {
  const H = habitsBySpecies();
  assert.equal(Object.keys(H).length, 72);
  for (const [id, keys] of Object.entries(H)) {
    for (const k of keys) {
      assert.ok(E.SPECIES[id].habits.includes(k), `${id} 的習性 ${k} 不在表的 habits 裡`);
      assert.ok(E.SPECIES[id].why.dex.includes(k), `${id} 的習性 ${k} 在 why.dex 裡沒有依據`);
    }
  }
});

test('時間分配：每一隻、每一個小時都加起來是 1，而且沒有負的', () => {
  for (const id of IDS) for (let h = 0; h < 24; h++) {
    for (const env of [{}, { weather: 'rain' }, { weather: 'snow' }, { plugged: true }]) {
      const b = E.budgetAt(id, h, env, TYPES[id]);
      const sum = Object.values(b).reduce((a, x) => a + x, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `${id} ${h} 點加起來 ${sum}`);
      for (const [k, v] of Object.entries(b)) assert.ok(v >= 0, `${id} ${h} 點 ${k} 是負的`);
    }
  }
});

test('作息：夜行的白天休息比晚上多；晝行的相反；休息是大宗（F5）', () => {
  const rest = (id, h) => E.budgetAt(id, h, {}, TYPES[id]).rest;
  assert.ok(rest(714, 12) > rest(714, 23) + 0.1, '嗡蝠白天應該比較常休息');
  assert.ok(rest(650, 23) > rest(650, 12) + 0.1, '哈力栗晚上應該比較常休息');
  assert.ok(rest(668, 12) >= 0.6, '火炎獅（獅子）大部分時間在休息');
  for (const id of IDS) assert.ok(meanBudget(id).rest >= 0.3, `${id} 一天平均休息不到 30%`);
});

test('屬性對環境：火屬性下雨休息變多、水屬性下雨玩變多、電屬性插電更常放電', () => {
  const b = (id, env) => E.budgetAt(id, 12, env, TYPES[id]);
  assert.ok(b(653, { weather: 'rain' }).rest > b(653, {}).rest, '火狐狸下雨要躲');
  assert.ok(b(656, { weather: 'rain' }).play > b(656, {}).play, '呱呱泡蛙下雨出來玩');
  assert.ok(b(706, { weather: 'rain' }).explore > b(706, {}).explore, '黏美龍下雨出來散步（百科）');
  const ctx = { id: 694, types: TYPES[694], hour: 12 };
  assert.ok(E.actWeight('spark', { ...ctx, plugged: true }) > E.actWeight('spark', ctx) * 2, '傘電蜥插電時更常放電');
});

test('nextBout：同一個種子同樣的結果；沒有選項回傳 null；需求高的類別比較常被選到', () => {
  const offers = offersFor(650, 12);
  const run = seed => { const rng = createRng(seed); return Array.from({ length: 50 }, () => E.nextBout(650, { hour: 12, types: ['grass'], offers }, rng).name); };
  assert.deepEqual(run(7), run(7));
  assert.equal(E.nextBout(650, { hour: 12, offers: [] }, createRng(1)), null);
  const share = mind => {
    const rng = createRng(3); let f = 0;
    const off = [{ name: 'idle', w: 14, cat: 'rest' }, { name: 'hungry', w: 5, cat: 'need' }];
    for (let i = 0; i < 2000; i++) if (E.nextBout(650, { hour: 12, offers: off, mind }, rng).kind === 'forage') f++;
    return f;
  };
  assert.ok(share({ need: 3 }) > share({ need: 0.2 }) * 3, '餓了（need 倍率高）要更常找吃的');
  // 長度：休息多數短、少數很長
  const rng = createRng(5);
  const d = Array.from({ length: 2000 }, () => E.nextBout(650, { hour: 12, offers: [{ name: 'sit', w: 1, cat: 'rest' }] }, rng).dur).sort((a, b) => a - b);
  assert.ok(d[1000] < 30 && d[1980] > 60, `坐著的長度中位數 ${d[1000].toFixed(1)}、99% ${d[1980].toFixed(1)}`);
});

test('專注模式的安靜選項也由這裡決定', () => {
  const rng = createRng(2);
  const seen = new Set(Array.from({ length: 200 }, () => E.focusBout(rng).name));
  assert.deepEqual([...seen].sort(), ['idle', 'look', 'nap', 'sit']);
});

// M5：72 隻 × 24 小時 × 3 個種子，每一類花的時間跟表差 ≤ 8 個百分點
test('M5 時間分配：核心模擬一天，每一類的時間比例跟表差 ≤ 8 個百分點（3 個種子都要過）', () => {
  const worst = { d: 0 };
  for (const seed of [1, 2, 3]) for (const id of IDS) {
    const got = norm(simulateDay(id, seed * 1000 + id).cls), want = meanBudget(id);
    for (const c of E.CLASSES) {
      const d = Math.abs((got[c] ?? 0) - (want[c] ?? 0));
      if (d > worst.d) Object.assign(worst, { d, id, c, seed });
    }
  }
  assert.ok(worst.d <= 0.08, `最差：種子 ${worst.seed} 的 ${worst.id} ${worst.c} 差 ${(worst.d * 100).toFixed(1)} 個百分點`);
});

// M6：身體類型不同的兩隻，行為直方圖的 JS 距離 ≥ 0.15（每一對、3 個種子都要過）
test('M6 物種不同：身體類型不同的兩隻，一天的行為直方圖 Jensen–Shannon 距離 ≥ 0.15', () => {
  for (const seed of [1, 2, 3]) {
    const H = Object.fromEntries(IDS.map(id => [id, simulateDay(id, seed * 7 + id).names]));
    let worst = { d: 1 };
    for (const a of IDS) for (const b of IDS) {
      if (a >= b || E.SPECIES[a].body === E.SPECIES[b].body) continue;
      const d = jsd(H[a], H[b]);
      if (d < worst.d) worst = { d, a, b };
    }
    assert.ok(worst.d >= 0.15, `種子 ${seed}：${worst.a} 和 ${worst.b} 只差 ${worst.d.toFixed(3)}`);
  }
});

test('架構規則：renderer 的 pet.js、behaviors.js 沒有權重表；core/ethogram.js 是純邏輯', () => {
  const table = /\[\s*'[a-zA-Z]+'\s*,\s*[0-9]+\s*,\s*\(\)\s*=>/;
  for (const f of ['../src/renderer/scene/pet.js', '../src/renderer/scene/behaviors.js']) {
    const bad = read(f).split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => table.test(l));
    assert.deepEqual(bad, [], `${f} 還有權重表：${bad.map(([n]) => n).join(', ')}`);
  }
  const core = read('../src/core/ethogram.js').replace(/\/\/.*$/gm, ''); // 註解裡可以寫「不准 Math.random」
  assert.ok(!/Math\.random|Date\.now|document\.|window\./.test(core), 'core/ethogram.js 不能用 Math.random、Date.now、DOM');
});

test('範圍外的介面：learn 先回傳原表', () => {
  assert.equal(E.learn(650, []), E.SPECIES[650]);
});
