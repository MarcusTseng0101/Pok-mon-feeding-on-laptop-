// PR 5：雲端資料夾同步——這個 PR 最重要的測試
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import { startSync, joinSync, syncStep, mergeShared, applyLedger, flattenBag } from '../src/core/sync.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 8, 25, 14, 0).getTime();

// 同一個起點的兩台電腦：A 先開始同步，B 用「沿用資料夾裡的存檔」加入
function twoDevices() {
  let clock = T0;
  const a = new Game({ dex, state: defaultSave(T0), rng: createRng(1), now: () => clock });
  a.chooseStarter(653);
  startSync(a.state, { folder: '/sync', deviceId: 'devaaaa1' });
  const fileA = migrate(structuredClone(a.state), dex, T0);
  const bState = joinSync(migrate(defaultSave(T0), dex, T0), fileA, { folder: '/sync', deviceId: 'devbbbb2', mode: 'adopt' });
  const b = new Game({ dex, state: bState, rng: createRng(2), now: () => clock });
  const tick = ms => { clock += ms; };
  return { a, b, tick };
}
function catchOne(g, species) {
  const wild = g.startEncounter({ speciesId: species, form: null, spot: 'grass', shiny: false, nature: 'hardy', special: false });
  let r;
  for (let i = 0; i < 80 && !r?.caught && !wild.gone; i++) r = g.throwBall(wild, 'poke', 2.5);
  assert.ok(r?.caught, `要抓到 ${species} 才能測`);
  return r.mon;
}
// 比較「共用的部分」：設定、同步資訊、位置、在不在桌面上是各台電腦自己的
function shared(s) {
  const c = structuredClone(s);
  delete c.settings; delete c.sync; delete c.weather; delete c.lastSeenAt; delete c.regenMinutes; delete c.nextPartnerGiftAt;
  c.focus = { ...c.focus, active: null };
  for (const m of c.mons) { delete m.pos; delete m.out; }
  return c;
}

test('同步：A、B 從同一個起點各自抓不同的寶可夢、各自用掉不同數量的球 → 兩隻都在、球的數量正確', () => {
  const { a, b, tick } = twoDevices();
  const start = { ...a.state.bag.balls };
  const monA = catchOne(a, 659);
  tick(1000);
  const monB = catchOne(b, 661);
  const usedA = start.poke - a.state.bag.balls.poke; // 丟了幾顆、加上抓到的獎勵，都是 A 自己的變化
  const usedB = start.poke - b.state.bag.balls.poke;
  const greatA = a.state.bag.balls.great - start.great, greatB = b.state.bag.balls.great - start.great;
  // A 同步（讀到 B 的檔案），B 也同步（讀到 A 的檔案）
  const fileB0 = syncStep(b.state, []);
  const A1 = syncStep(a.state, [fileB0]);
  const B1 = syncStep(fileB0, [A1]);
  for (const s of [A1, B1]) {
    const uids = s.mons.map(m => m.uid);
    assert.ok(uids.includes(monA.uid) && uids.includes(monB.uid), '兩邊抓到的都要在');
    assert.equal(s.mons.length, 3); // 御三家＋兩隻
    assert.equal(s.bag.balls.poke, start.poke - usedA - usedB, '精靈球＝起點 − A 用的 − B 用的');
    assert.equal(s.bag.balls.great, start.great + greatA + greatB, '新種的獎勵兩邊都算');
    assert.equal(s.dex[659].caught, 1);
    assert.equal(s.dex[661].caught, 1);
  }
  assert.deepEqual(shared(A1), shared(B1), '同步完兩台電腦的共用部分要一模一樣');
});

test('同步：合併的順序對調，結果一樣', () => {
  const { a, b, tick } = twoDevices();
  catchOne(a, 659); tick(1000); catchOne(b, 661);
  b.rename(b.state.mons[0].uid, '小火');
  const fa = syncStep(a.state, []), fb = syncStep(b.state, []);
  const ab = applyLedger(mergeShared(fa, fb));
  const ba = applyLedger(mergeShared(fb, fa));
  assert.deepEqual(shared(ab), shared(ba));
});

test('同步：同一份資料合併兩次，跟合併一次一樣（不會重複加球、重複加寶可夢）', () => {
  const { a, b } = twoDevices();
  catchOne(a, 659);
  b.state.bag.puffs['sweet-basic'] += 4; // B 拿到 4 個泡芙
  const fb = syncStep(b.state, []);
  const once = syncStep(a.state, [fb]);
  const twice = syncStep(once, [fb]);
  const thrice = syncStep(twice, [fb, fb]);
  assert.deepEqual(shared(twice), shared(once));
  assert.deepEqual(shared(thrice), shared(once));
  assert.equal(once.bag.puffs['sweet-basic'], a.state.bag.puffs['sweet-basic'] + 4);
});

test('同步：兩台電腦來回同步很多次，背包一直是對的', () => {
  const { a, b } = twoDevices();
  let A = a.state, B = b.state;
  const expected = flattenBag(A.bag);
  for (let round = 0; round < 6; round++) {
    // 每一輪各自拿到、用掉一些
    A.bag.balls.poke -= 1; expected['balls.poke'] -= 1;
    B.bag.balls.poke -= 1; expected['balls.poke'] -= 1; // 起點 15 顆，6 輪共用掉 12 顆
    B.bag.berries.pecha += 3; expected['berries.pecha'] += 3;
    A = syncStep(A, [B]);
    B = syncStep(B, [A]);
  }
  A = syncStep(A, [B]);
  for (const s of [A, B]) {
    assert.equal(s.bag.balls.poke, expected['balls.poke']);
    assert.equal(s.bag.berries.pecha, expected['berries.pecha']);
  }
});

test('同步：兩邊都有的寶可夢，取好感＋成長多的那份；暱稱用比較新改的；在不在桌面上各自保留', () => {
  const { a, b, tick } = twoDevices();
  const uid = a.state.mons[0].uid;
  a.mon(uid).affection = 200; // A 這邊比較親
  tick(1000);
  b.rename(uid, '小火'); // B 這邊比較晚改名
  b.mon(uid).out = false;
  const m = syncStep(a.state, [syncStep(b.state, [])]).mons.find(x => x.uid === uid);
  assert.equal(m.affection, 200);
  assert.equal(m.nickname, '小火');
  assert.equal(m.out, true, 'A 這台電腦上牠還在桌面上');
});

test('同步：已經孵化的蛋，別台電腦的舊存檔裡還有也不會再出現', () => {
  const { a, b } = twoDevices();
  const egg = { uid: 'egg1', species: 650, form: null, shiny: false, steps: 0, need: 100, receivedAt: T0 };
  a.state.eggs.push({ ...egg });
  b.state.eggs.push({ ...egg });
  a.state.eggs[0].steps = 100;
  a.hatchEgg('egg1');
  const A1 = syncStep(a.state, [syncStep(b.state, [])]);
  assert.equal(A1.eggs.length, 0);
  const B1 = syncStep(b.state, [A1]);
  assert.equal(B1.eggs.length, 0, 'B 同步之後，那顆蛋也不見了（已經在 A 孵出來了）');
  assert.ok(B1.mons.some(m => m.species === 650 && m.uid !== a.state.mons[0].uid));
});

test('同步：統計取最大（不相加），圖鑑計數取最大、時間取最早，獎章聯集', () => {
  const { a, b } = twoDevices();
  a.state.stats.strokes = 50; b.state.stats.strokes = 80;
  a.state.dex[700] = { seen: 3, caught: 0, shiny: 0, firstSeenAt: T0 + 5, firstCaughtAt: null };
  b.state.dex[700] = { seen: 1, caught: 1, shiny: 0, firstSeenAt: T0 + 1, firstCaughtAt: T0 + 9 };
  a.state.achievements['dex-10'] = T0 + 50;
  b.state.achievements['dex-10'] = T0 + 20;
  b.state.achievements['egg-1'] = T0 + 30;
  const s = syncStep(a.state, [syncStep(b.state, [])]);
  assert.equal(s.stats.strokes, 80);
  assert.deepEqual(s.dex[700], { seen: 3, caught: 1, shiny: 0, firstSeenAt: T0 + 1, firstCaughtAt: T0 + 9 });
  assert.deepEqual(s.achievements, { ...s.achievements, 'dex-10': T0 + 20, 'egg-1': T0 + 30 });
});

test('同步：加入時選「合併兩份」，兩邊原本的東西都保留、背包相加', () => {
  let clock = T0;
  const a = new Game({ dex, state: defaultSave(T0), rng: createRng(1), now: () => clock });
  a.chooseStarter(653);
  startSync(a.state, { folder: '/sync', deviceId: 'devaaaa1' });
  const other = new Game({ dex, state: defaultSave(T0), rng: createRng(5), now: () => clock });
  other.chooseStarter(656);
  const joined = joinSync(other.state, migrate(structuredClone(a.state), dex, T0), { folder: '/sync', deviceId: 'devcccc3', mode: 'merge' });
  assert.deepEqual(joined.mons.map(m => m.species).sort(), [653, 656]);
  assert.equal(joined.bag.balls.poke, a.state.bag.balls.poke + other.state.bag.balls.poke);
  // 存檔讀回來同步資訊還在
  const back = migrate(structuredClone(joined), dex, T0);
  assert.deepEqual(back.sync.ledger, joined.sync.ledger);
  assert.deepEqual(back.sync.origin, joined.sync.origin);
});
