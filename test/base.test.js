// v3 PR 4：秘密基地——升級扣材料、家具不能重疊、同步用最後修改的那一邊、材料走 ledger
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import * as B from '../src/core/base.js';
import * as T from '../src/core/trips.js';
import { startSync, joinSync, syncStep, mergeShared } from '../src/core/sync.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 8, 25, 14, 0).getTime();

function game() {
  let clock = T0;
  const g = new Game({ dex, state: migrate(defaultSave(T0), dex, T0), rng: createRng(1), now: () => clock });
  g.chooseStarter(650);
  return { g, tick: ms => { clock += ms; } };
}

test('一開始：帳篷＋一張小床，材料都是 0', () => {
  const { g } = game();
  assert.equal(g.state.base.stage, 0);
  assert.deepEqual(g.state.base.items.map(i => i.kind), ['bed']);
  assert.deepEqual(g.state.bag.materials, { wood: 0, cloth: 0, stone: 0, shiny: 0 });
});

test('升級要扣材料；不夠就不能升；最高是樹屋', () => {
  const { g } = game();
  assert.deepEqual(g.baseUpgrade(), { ok: false, reason: 'materials' });
  Object.assign(g.state.bag.materials, { wood: 20, cloth: 5, stone: 6, shiny: 2 });
  assert.ok(g.baseUpgrade().ok);
  assert.deepEqual(g.state.bag.materials, { wood: 14, cloth: 1, stone: 6, shiny: 2 });
  assert.equal(g.state.base.stage, 1);
  assert.ok(g.baseUpgrade().ok);
  assert.deepEqual(g.state.bag.materials, { wood: 2, cloth: 1, stone: 0, shiny: 0 });
  assert.deepEqual(g.baseUpgrade(), { ok: false, reason: 'max' });
});

test('家具：不能重疊、不能超出院子、有數量上限；收起來材料全部還你', () => {
  const { g } = game();
  Object.assign(g.state.bag.materials, { wood: 50, cloth: 50, stone: 50, shiny: 50 });
  // 小床在 (0,1)–(1,1)
  assert.equal(g.basePlace('table', 1, 1).reason, 'blocked');
  assert.equal(g.basePlace('table', 7, 0).reason, 'blocked', '超出右邊');
  assert.equal(g.basePlace('lamp', 0, 3).reason, 'blocked', '超出前面');
  const t = g.basePlace('table', 2, 1);
  assert.ok(t.ok);
  assert.equal(g.state.bag.materials.wood, 47);
  assert.ok(g.basePlace('plant', 0, 0).ok);
  assert.equal(g.basePlace('plant', 5, 0).reason, 'full', '帳篷最多 3 個');
  assert.ok(g.baseMove(t.item.id, 4, 2));
  assert.equal(g.baseMove(t.item.id, 0, 1), false, '移到別的家具上');
  assert.ok(g.baseRemove(t.item.id));
  assert.equal(g.state.bag.materials.wood, 49, '桌子的材料還回來了');
});

test('獎盃：有幾個獎章才能擺幾個', () => {
  const { g } = game();
  g.state.bag.materials = { wood: 50, cloth: 50, stone: 50, shiny: 50 };
  assert.equal(Object.keys(g.state.achievements).length, 1); // 第一個夥伴
  assert.ok(g.basePlace('trophy', 4, 0).ok);
  assert.equal(g.basePlace('trophy', 5, 0).reason, 'no-medal');
});

test('存檔：讀回來一樣；壞掉的家具（重疊、超出、不認得的）會被丟掉', () => {
  const { g } = game();
  g.state.bag.materials = { wood: 50, cloth: 50, stone: 50, shiny: 50 };
  g.basePlace('rug', 3, 2);
  g.baseSide('right');
  const back = migrate(JSON.parse(JSON.stringify(g.state)), dex, T0);
  assert.deepEqual(back.base, g.state.base);
  assert.deepEqual(back.bag.materials, g.state.bag.materials);
  const bad = B.normalizeBase({ stage: 9, side: 'up', items: [{ id: 'a', kind: 'bed', x: 0, y: 0 }, { id: 'b', kind: 'bed', x: 1, y: 0 }, { id: 'c', kind: 'sofa', x: 4, y: 0 }, { id: 'd', kind: 'lamp', x: 9, y: 0 }] }, T0);
  assert.equal(bad.stage, 2);
  assert.equal(bad.side, 'left');
  assert.deepEqual(bad.items.map(i => i.id), ['a']);
});

test('同步：基地用最後修改的那一邊（對調一樣、合併兩次一樣）；材料走 ledger', () => {
  let clock = T0;
  const a = new Game({ dex, state: migrate(defaultSave(T0), dex, T0), rng: createRng(1), now: () => clock });
  a.chooseStarter(650);
  startSync(a.state, { folder: '/s', deviceId: 'devaaaa1' });
  const b = new Game({ dex, state: joinSync(migrate(defaultSave(T0), dex, T0), migrate(structuredClone(a.state), dex, T0), { folder: '/s', deviceId: 'devbbbb2', mode: 'adopt' }), rng: createRng(2), now: () => clock });
  // A 拿到 5 個木頭（旅行帶回來），B 拿到 2 塊布
  a.state.bag.materials.wood += 5;
  b.state.bag.materials.cloth += 2;
  clock += 1000;
  a.state.bag.materials.wood -= 1; a.state.bag.materials.stone += 1; // （隨便動一下）
  a.state.bag.materials.stone -= 1; a.state.bag.materials.wood += 1;
  a.basePlace('table', 4, 0); // A 擺了一張桌子（木頭 5 → 2）
  clock += 1000;
  b.baseSide('right'); // B 比較晚改：B 的基地贏
  a.state = syncStep(a.state, []);
  b.state = syncStep(b.state, [a.state]);
  a.state = syncStep(a.state, [b.state]);
  assert.deepEqual(a.state.bag.materials, { wood: 2, cloth: 2, stone: 0, shiny: 0 });
  assert.deepEqual(b.state.bag.materials, a.state.bag.materials);
  assert.equal(a.state.base.side, 'right');
  assert.deepEqual(a.state.base, b.state.base);
  const ab = mergeShared(a.state, b.state), ba = mergeShared(b.state, a.state);
  assert.deepEqual(ab.base, ba.base);
  assert.deepEqual(mergeShared(ab, b.state).base, ab.base);
});

test('旅行會帶回 1–3 個材料（那個地方比較容易撿到的）', () => {
  for (let i = 0; i < 200; i++) {
    const place = T.PLACE_IDS[i % 12];
    const r = T.rollTrip({ id: `t${i}`, place, departedAt: 0, returnAt: 1, seed: i * 31 + 7 }, { dex });
    const n = Object.values(r.gifts.materials).reduce((s, v) => s + v, 0);
    assert.ok(n >= 1 && n <= 3, `${n}`);
    for (const k of Object.keys(r.gifts.materials)) assert.ok(B.PLACE_MATERIALS[place].includes(k));
  }
  // 收下明信片：材料進背包
  const { g, tick } = game();
  const m2 = g.createMon(653); m2.out = true; g.state.mons.push(m2);
  const trip = g.depart(g.state.mons[0].uid);
  tick(trip.returnAt - trip.departedAt + 1);
  const r = g.settleTrip(g.state.mons[0].uid);
  for (const [k, n] of Object.entries(r.gifts.materials)) assert.equal(g.state.bag.materials[k], n);
});

test('心智：很累又有床的時候，比較不想在地上打瞌睡', async () => {
  const M = await import('../src/core/mind.js');
  const lv = { food: 90, fun: 60, energy: 15, social: 70, curiosity: 70, comfort: 70 };
  const noBed = M.weights({ recent: [] }, lv, M.traitsOf('hardy'), {});
  const bed = M.weights({ recent: [] }, lv, M.traitsOf('hardy'), { bedFree: true });
  assert.ok(bed.rest < noBed.rest * 0.5 && bed.base === noBed.base, JSON.stringify({ noBed, bed }));
});

test('地板：預設沙地、舊存檔讀進來也是沙地；換成遊樂園不用材料；不認識的地板不收；同步跟著基地走（最後改的那一邊）', () => {
  const { g, tick } = game();
  assert.equal(g.state.base.floor, 'sand');
  const old = structuredClone(g.state.base); delete old.floor;
  assert.equal(B.normalizeBase(old).floor, 'sand', '舊存檔');
  assert.equal(B.normalizeBase({ ...old, floor: 'lava' }).floor, 'sand', '不認識的地板');
  const mats = JSON.stringify(g.state.bag.materials);
  tick(1000);
  assert.equal(g.baseFloor('park'), true);
  assert.equal(g.state.base.floor, 'park');
  assert.equal(g.state.base.updatedAt, T0 + 1000);
  assert.equal(JSON.stringify(g.state.bag.materials), mats, '不用材料');
  assert.equal(g.baseFloor('park'), false, '一樣的不算改');
  assert.equal(g.baseFloor('lava'), false);
  assert.equal(B.normalizeBase(structuredClone(g.state.base)).floor, 'park', '存檔讀回來還是遊樂園');
  // 另一台電腦比較晚改成沙地：用那一邊的
  const other = structuredClone(g.state.base);
  other.floor = 'sand'; other.updatedAt = T0 + 5000;
  assert.equal(B.mergeBase(g.state.base, other).floor, 'sand');
  assert.equal(B.mergeBase(other, g.state.base).floor, 'sand');
});

test('住的地方：可以鑽進去睡幾隻、門口在圖上的哪裡', () => {
  assert.deepEqual(B.STAGES.map(s => s.sleeps), [2, 3, 4]);
  for (const s of B.STAGES) assert.ok(Number.isInteger(s.door) && s.door > 0);
  assert.deepEqual(B.FLOORS.map(f => f.id), ['sand', 'park']);
});

test('鑰圈兒的收藏：舊存檔沒有就是空的；叼什麼由遊戲的亂數決定；最多 8 個，滿了就不叼；不改 base.updatedAt', () => {
  const { g, tick } = game();
  assert.deepEqual(g.state.base.trinkets, []);
  const old = structuredClone(g.state.base); delete old.trinkets;
  assert.deepEqual(B.normalizeBase(old).trinkets, [], '舊存檔');
  const updatedAt = g.state.base.updatedAt;
  let tries = 0;
  while (g.state.base.trinkets.length < B.TRINKET_MAX && tries++ < 500) {
    tick(1000);
    const kind = g.trinketToCarry();
    if (kind) { assert.ok(B.TRINKETS[kind], kind); assert.equal(g.stashTrinket(kind), true); }
  }
  assert.equal(g.state.base.trinkets.length, B.TRINKET_MAX);
  assert.ok(tries > B.TRINKET_MAX, '不是每次找到都叼（TRINKET_CHANCE）');
  for (let i = 0; i < 50; i++) assert.equal(g.trinketToCarry(), null, '滿了就不叼');
  assert.equal(g.stashTrinket('coin'), false, '滿了放不進去');
  assert.equal(g.state.base.updatedAt, updatedAt, '不改 base.updatedAt（不蓋掉另一台擺的家具）');
  // 存檔讀回來一樣；壞掉的、不認識的、重複的不收
  assert.deepEqual(B.normalizeBase(structuredClone(g.state.base)).trinkets, g.state.base.trinkets);
  const bad = [{ id: 'a', kind: 'sword', at: 1 }, { id: 5, kind: 'coin', at: 1 }, { id: 'b', kind: 'coin' }, null, { id: 'c', kind: 'coin', at: 2 }, { id: 'c', kind: 'bell', at: 3 }];
  assert.deepEqual(B.normalizeTrinkets(bad), [{ id: 'c', kind: 'coin', at: 2 }]);
});

test('鑰圈兒的收藏：同步時兩邊撿到的加起來（另一台比較晚擺家具也不會不見），兩邊對調結果一樣、最多 8 個', () => {
  const { g } = game();
  const a = structuredClone(g.state.base), b = structuredClone(g.state.base);
  a.trinkets = [{ id: 'ta', kind: 'coin', at: T0 + 10 }];
  b.trinkets = [{ id: 'tb', kind: 'bell', at: T0 + 20 }];
  b.updatedAt = T0 + 99999; b.floor = 'park'; // 另一台比較晚改了地板
  const m1 = B.mergeBase(a, b), m2 = B.mergeBase(b, a);
  assert.equal(m1.floor, 'park', '基地本身照舊用最後改的那一邊');
  assert.deepEqual(m1.trinkets.map(t => t.id), ['ta', 'tb'], '收藏兩邊加起來');
  assert.deepEqual(m1, m2, '兩邊對調結果一樣');
  // 一樣的時間：也是對調結果一樣
  const c = structuredClone(a), d = structuredClone(a); c.trinkets = [{ id: 'x', kind: 'key', at: 1 }]; d.side = 'right';
  assert.deepEqual(B.mergeBase(c, d), B.mergeBase(d, c));
  // 加起來超過 8 個：留先撿到的
  const many = n => Array.from({ length: n }, (_, i) => ({ id: `m${n}-${i}`, kind: 'marble', at: T0 + i * 2 + (n === 6 ? 1 : 0) }));
  a.trinkets = many(6); b.trinkets = many(5);
  const m = B.mergeBase(a, b);
  assert.equal(m.trinkets.length, B.TRINKET_MAX);
  assert.ok(m.trinkets.every((t, i, arr) => !i || arr[i - 1].at <= t.at));
});
