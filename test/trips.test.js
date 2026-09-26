// v3 PR 3：出門旅行——結算要冪等、時鐘倒退也回得來、同步不會拿兩份禮物
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import * as T from '../src/core/trips.js';
import { startSync, joinSync, syncStep, mergeShared, flattenBag } from '../src/core/sync.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 8, 25, 14, 0).getTime();
const MIN = 60_000, HOUR = 60 * MIN;

function twoOut(seed = 1) {
  let clock = T0;
  const g = new Game({ dex, state: defaultSave(T0), rng: createRng(seed), now: () => clock });
  g.chooseStarter(650);
  const b = g.createMon(653); b.out = true; g.state.mons.push(b);
  return { g, a: g.state.mons[0], b, set: t => { clock = t; }, now: () => clock };
}

test('地點：12 個，每個都有 3 句以上的日記、禮物、屬性', () => {
  assert.equal(T.PLACE_IDS.length, 12);
  for (const [id, p] of Object.entries(T.PLACES)) {
    assert.ok(p.zh && p.types.length && p.diary.length >= 3 && Object.keys(p.gifts).length && p.friendDiary, id);
  }
});

test('出發條件：一次只能一隻、桌面上至少留一隻', () => {
  const { g, a, b } = twoOut();
  assert.ok(g.canDepart(a.uid));
  assert.ok(g.depart(a.uid));
  assert.equal(g.canDepart(b.uid), false, '已經有一隻在旅行');
  assert.equal(g.depart(a.uid), null);
  const solo = new Game({ dex, state: defaultSave(T0), rng: createRng(1), now: () => T0 });
  solo.chooseStarter(650);
  assert.equal(solo.canDepart(solo.state.mons[0].uid), false, '只剩一隻就不能出門');
});

test('旅行時間 30 分鐘到 6 小時；越好奇去越久（平均）', () => {
  const rng = createRng(3);
  const mon = { uid: 'x' };
  const avg = curious => { let s = 0; for (let i = 0; i < 400; i++) { const t = T.planTrip(mon, { types: [], curious }, rng, T0); s += t.returnAt - t.departedAt; assert.ok(t.returnAt - t.departedAt >= 30 * MIN && t.returnAt - t.departedAt <= 360 * MIN); } return s / 400; };
  assert.ok(avg(0.9) > avg(0.1) * 1.3);
});

test('結算：還沒回來不能結算；結算兩次結果一樣（第二次什麼都沒有）', () => {
  const { g, a, set } = twoOut();
  const trip = g.depart(a.uid);
  assert.equal(g.tripStatus(a.uid), 'away');
  assert.equal(g.settleTrip(a.uid), null);
  set(trip.returnAt + 1);
  assert.equal(g.tripStatus(a.uid), 'back');
  const bagBefore = flattenBag(g.state.bag);
  const r = g.settleTrip(a.uid);
  assert.ok(r && r.postcard.place === trip.place && r.diary.length > 4);
  assert.ok(!r.diary.includes('{') && !r.diary.includes('undefined'), r.diary);
  const bagAfter = flattenBag(g.state.bag);
  assert.notDeepEqual(bagAfter, bagBefore, '有帶禮物回來');
  assert.equal(g.settleTrip(a.uid), null, '第二次結算');
  assert.deepEqual(flattenBag(g.state.bag), bagAfter);
  assert.equal(g.state.postcards.length, 1);
  assert.equal(g.state.stats.trips, 1);
  assert.equal(a.trip, null);
  assert.ok(a.memory.some(e => e.k === 'trip'));
  assert.ok(g.state.achievements['trip-1'], '第一次旅行的獎章');
  // 同一趟旅行擲出來的結果每次都一樣（跟什麼時候結算無關）
  assert.deepEqual(T.rollTrip(trip, { dex }), T.rollTrip(trip, { dex }));
});

test('關掉 8 小時再打開：回來了，只結算一次', () => {
  const { g, a, set } = twoOut();
  const trip = g.depart(a.uid);
  const saved = JSON.parse(JSON.stringify(g.state));
  set(T0 + 8 * HOUR);
  const g2 = new Game({ dex, state: migrate(saved, dex, T0 + 8 * HOUR), rng: createRng(9), now: () => T0 + 8 * HOUR });
  g2.catchUp();
  assert.equal(g2.tripStatus(a.uid), 'back');
  assert.ok(g2.settleTrip(a.uid));
  assert.equal(g2.settleTrip(a.uid), null);
  assert.equal(g2.state.postcards.length, 1);
  assert.equal(g2.state.postcards[0].id, trip.id);
});

test('時鐘被調回去：不會永遠回不來（旅行長度不變）', () => {
  const trip = { id: 'x', place: 'desert', departedAt: T0, returnAt: T0 + 2 * HOUR, seed: 1 };
  const mon = { trip };
  assert.equal(T.tripStatus(mon, T0 - 5 * HOUR), 'away');
  assert.equal(trip.departedAt, T0 - 5 * HOUR);
  assert.equal(trip.returnAt, T0 - 3 * HOUR);
  assert.equal(T.tripStatus(mon, T0 - 3 * HOUR), 'back');
});

test('存檔：旅行中、明信片、去過的地點讀回來一樣；壞資料被丟掉', () => {
  const { g, a, set } = twoOut();
  const trip = g.depart(a.uid);
  set(trip.returnAt);
  g.settleTrip(a.uid);
  g.depart(g.state.mons[1].uid);
  const back = migrate(JSON.parse(JSON.stringify(g.state)), dex, T0);
  assert.deepEqual(back.postcards, g.state.postcards);
  assert.deepEqual(back.mons[1].trip, g.state.mons[1].trip);
  assert.deepEqual(back.placesVisited, g.state.placesVisited);
  assert.deepEqual(back.tripsDone, g.state.tripsDone);
  const bad = migrate({ ...defaultSave(T0), mons: [{ uid: 'q', species: 650, trip: { id: 'z', place: 'moon', departedAt: 1, returnAt: 2 } }], postcards: [{ id: 1 }], placesVisited: { moon: 1, desert: 'x', arena: 5 } }, dex, T0);
  assert.equal(bad.mons[0].trip, null);
  assert.deepEqual(bad.postcards, []);
  assert.deepEqual(bad.placesVisited, { arena: 5 });
});

test('同步：A 結算了旅行，B 的存檔裡那趟旅行不會再結算；禮物只算一次；對調、兩次都一樣', () => {
  let clock = T0;
  const a = new Game({ dex, state: defaultSave(T0), rng: createRng(1), now: () => clock });
  a.chooseStarter(650);
  const m2 = a.createMon(653); m2.out = true; a.state.mons.push(m2);
  startSync(a.state, { folder: '/s', deviceId: 'devaaaa1' });
  const trip = a.depart(a.state.mons[0].uid);
  const fileA = migrate(structuredClone(a.state), dex, T0);
  const b = new Game({ dex, state: joinSync(migrate(defaultSave(T0), dex, T0), fileA, { folder: '/s', deviceId: 'devbbbb2', mode: 'adopt' }), rng: createRng(2), now: () => clock });
  assert.ok(b.state.mons[0].trip, 'B 也知道牠在旅行');
  clock = trip.returnAt + 1;
  const berriesBefore = { ...a.state.bag.berries }, ballsBefore = { ...a.state.bag.balls };
  const r = a.settleTrip(a.state.mons[0].uid);
  // A 把結果寫進資料夾；B 還沒同步前不能結算，同步後那趟旅行就不見了
  a.state = syncStep(a.state, []); // syncStep 回傳新的存檔（畫面那邊也是這樣換掉）
  b.state = syncStep(b.state, [a.state]);
  assert.equal(b.state.mons[0].trip, null, 'B 同步後不該還在旅行');
  assert.equal(b.settleTrip(b.state.mons[0].uid), null);
  assert.equal(b.state.postcards.length, 1);
  for (const [k, n] of Object.entries(r.gifts.berries)) assert.equal(b.state.bag.berries[k], berriesBefore[k] + n, `B 收到 A 的禮物 ${k}`);
  for (const [k, n] of Object.entries(r.gifts.balls)) assert.equal(b.state.bag.balls[k], ballsBefore[k] + n, `B 收到 A 的禮物 ${k}`);
  a.state = syncStep(a.state, [b.state]);
  assert.deepEqual(flattenBag(a.state.bag), flattenBag(b.state.bag), '兩邊背包一樣');
  // 交換律、冪等
  const ab = mergeShared(a.state, b.state), ba = mergeShared(b.state, a.state);
  assert.deepEqual(ab.postcards, ba.postcards);
  assert.deepEqual(ab.tripsDone, ba.tripsDone);
  assert.deepEqual(mergeShared(ab, b.state).postcards, ab.postcards);
});

test('同步：兩邊的旅行取出發時間比較晚的；結算過的不要', () => {
  const t1 = { id: 'a', place: 'desert', departedAt: 1, returnAt: 2, seed: 1 };
  const t2 = { id: 'b', place: 'arena', departedAt: 5, returnAt: 9, seed: 2 };
  assert.equal(T.mergeTrip(t1, t2, new Set()).id, 'b');
  assert.equal(T.mergeTrip(t2, t1, new Set()).id, 'b');
  assert.equal(T.mergeTrip(t1, null, new Set()).id, 'a');
  assert.equal(T.mergeTrip(t1, t2, new Set(['b'])), null);
});

test('帶朋友回來的機率大約 5%，撿到蛋大約 3%', () => {
  let friends = 0, eggs = 0;
  for (let i = 0; i < 4000; i++) {
    const r = T.rollTrip({ id: `t${i}`, place: T.PLACE_IDS[i % 12], departedAt: 0, returnAt: 1, seed: i * 7919 }, { dex });
    if (r.friend) { friends++; assert.ok(!dex.get(r.friend).legendary); }
    if (r.egg) eggs++;
  }
  assert.ok(friends > 120 && friends < 290, `${friends}`);
  assert.ok(eggs > 60 && eggs < 190, `${eggs}`);
});
