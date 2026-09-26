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
