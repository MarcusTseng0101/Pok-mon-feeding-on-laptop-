// 帶一隻出門（core/outing.js）
//   F7：出門不是旅行（互斥、沒有隨機地點和回家時間）
//   F8：手機頁面唯讀（只多一個顯示的欄位）
//   F9：只有手動回家；忘了帶回來 12 小時後自己回家、不給明信片
//   F6：同步
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Out from '../src/core/outing.js';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import { mergeShared } from '../src/core/sync.js';
import { PLACES, OUTING_PLACE } from '../src/core/trips.js';
import { phoneSnapshot } from '../src/core/phonedata.js';

const MIN = 60_000, HOUR = 60 * MIN;
const at = (y, mo, d, h, m = 0) => new Date(y, mo - 1, d, h, m).getTime();
const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));

function makeGame(t0) {
  const t = { v: t0 };
  const g = new Game({ dex, state: migrate(defaultSave(t.v), dex, t.v), rng: createRng(7), now: () => t.v });
  g.chooseStarter(653);
  for (const sp of [661, 664]) { const m = g.createMon(sp); m.out = true; g.state.mons.push(m); }
  return { g, t };
}
const snap = (g, t, weather = null) => phoneSnapshot(g.state, { now: t.v, nameOf: m => g.displayName(m), speciesName: id => dex.name(id), spriteKeyOf: m => String(m.species), weather });

test('F7：出門和旅行互斥；一次只帶一隻；出門的不在桌面上', () => {
  const { g } = makeGame(at(2026, 9, 26, 9));
  const [a, b, c] = g.state.mons;
  assert.ok(g.goOut(a.uid));
  assert.equal(a.trip, null, '出門不是旅行');
  assert.equal(g.canDepart(a.uid), false, '出門中不能去旅行');
  assert.equal(g.depart(a.uid), null);
  assert.equal(g.canGoOut(b.uid), false, '一次只帶一隻');
  assert.equal(g.goOut(b.uid), null);
  assert.ok(!g.homeMons().includes(a), '出門的不在桌面上');
  assert.equal(g.setOut(a.uid, false), false, '出門中不能收回');
  // 旅行中的不能帶出門
  g.comeBack(a.uid);
  assert.ok(g.depart(b.uid), 'b 去旅行');
  assert.equal(g.canGoOut(b.uid), false, '旅行中不能出門');
  assert.ok(g.canGoOut(c.uid));
  // 沒放出來的不能帶出門
  c.out = false;
  assert.equal(g.canGoOut(c.uid), false);
});

test('20 分鐘以內不給明信片；超過就放進同一本相簿＋好感（摸一次的量）', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 9));
  const a = g.state.mons[0];
  const seen = [];
  g.on('outingBack', e => seen.push(e));
  g.goOut(a.uid);
  t.v += 19 * MIN;
  const aff0 = a.affection;
  const short = g.comeBack(a.uid, { weather: 'rain' });
  assert.equal(short.postcard, null);
  assert.equal(g.state.postcards.length, 0);
  assert.equal(a.affection, aff0);
  assert.equal(a.outing, null, '回家了');

  g.goOut(a.uid);
  t.v += 85 * MIN;
  const r = g.comeBack(a.uid, { weather: 'rain' });
  assert.ok(r.postcard);
  assert.equal(g.state.postcards.length, 1);
  const p = g.state.postcards[0];
  assert.equal(p.place, OUTING_PLACE);
  assert.equal(p.uid, a.uid);
  assert.match(p.diary, /1 小時 25 分鐘/);
  assert.match(p.diary, /10:44 回到家/);
  assert.match(p.diary, /家裡那邊下雨/);
  assert.ok(!/你那邊/.test(p.diary), 'F10：不假裝知道你在哪');
  assert.equal(a.affection, aff0 + Out.PET_AFFECTION);
  assert.equal(seen.length, 2);
  // 存檔讀回來明信片還在（出門的明信片不是旅行地點，也要留著）
  const back = migrate(structuredClone(g.state), dex, t.v);
  assert.equal(back.postcards.length, 1);
  assert.equal(back.postcards[0].place, OUTING_PLACE);
  assert.equal(back.placesVisited[OUTING_PLACE], undefined, '不算去過的旅行地點');
});

test('F9：沒有自動判斷回家；忘了帶回來 12 小時後自己回家、不給明信片', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 9));
  const a = g.state.mons[0];
  const seen = [];
  g.on('outingBack', e => seen.push(e));
  g.goOut(a.uid);
  // 一直 tick（中間你有回來用電腦也一樣）：12 小時內都不會自己回來
  for (let m = 1; m < 12 * 60; m++) { t.v += MIN; g.tick(); if (m % 30 === 0) g.lifeTick({ idleSeconds: 0 }); }
  assert.ok(a.outing, '12 小時內還在外面');
  t.v += MIN;
  g.tick();
  assert.equal(a.outing, null, '12 小時後自己回家');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].auto, true);
  assert.equal(seen[0].postcard, null);
  assert.equal(g.state.postcards.length, 0, '自己回家不給明信片');
});

test('手機摘要：出門中的夥伴在 outing（最上面），不在「在桌面上」；文字寫「家裡那邊」', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 15));
  const a = g.state.mons[0];
  assert.equal(snap(g, t).outing, undefined, '沒出門：手機摘要跟以前一樣，沒有這個欄位');
  g.goOut(a.uid);
  t.v += 50 * MIN;
  const d = snap(g, t, 'rain');
  assert.equal(d.outing.name, g.displayName(a));
  assert.equal(d.outing.minutes, 50);
  assert.equal(d.outing.pic, String(a.species));
  assert.match(d.outing.line, /家裡那邊下雨/);
  assert.ok(!/你那邊/.test(d.outing.line));
  assert.equal(d.pets.length, 2, '出門的不算在桌面上');
  assert.ok(!d.pets.some(p => p.name === d.outing.name));
  // 回家後明信片的地點寫「跟你出門」
  g.comeBack(a.uid);
  assert.equal(snap(g, t).postcards[0].place, '跟你出門');
});

test('F8 → F15：phoneAction 只是留著，不做任何事；手機唯一的寫入是打卡（POST act），而且只收 { kind, id, at }', () => {
  const { g } = makeGame(at(2026, 9, 26, 9));
  const before = JSON.stringify(g.state);
  assert.equal(Out.phoneAction(g.state, { type: 'pet', uid: g.state.mons[0].uid }), null);
  assert.equal(JSON.stringify(g.state), before);
  // 共生 v2（使用者決定開放少數寫入）：原本「沒有任何寫入的路由」改成「只有一條、而且照 F15 檢查」。
  // 每一條限制的實際行為在 test/phoneact.test.js 用真的請求測；這裡守住「沒有第二條寫入的路」
  const phone = readFileSync(new URL('../src/main/phone.js', import.meta.url), 'utf8');
  assert.equal((phone.match(/req\.method === 'POST'/g) ?? []).length, 2, '只有 POST 的 token 檢查和 act 兩處');
  assert.match(phone, /req\.method === 'POST' && m\[2\] === 'act'/);
  assert.ok(!/'PUT'|'PATCH'|'DELETE'/.test(phone), '沒有其他寫入的方法');
  assert.match(phone, /validAction\(JSON\.parse\(body\)\)/, '收到的東西一定經過 core/checkin.js 的 validAction');
  assert.ok(!/state|mons|affection|fullness|save/i.test(phone.replace(/\/\/.*$/gm, '')), 'main/phone.js 不碰存檔和數值');
});

test('同步：since 比較新的贏；已經在一台電腦回家的，不會被另一台又拉出去；一次只帶一隻', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 9));
  const [a, b] = g.state.mons;
  const base = structuredClone(g.state);
  // A 電腦：a 出門，30 分鐘後回家
  const A = structuredClone(base), B = structuredClone(base);
  A.mons[0].outing = { since: t.v };
  const ga = new Game({ dex, state: A, rng: createRng(1), now: () => t.v + 30 * MIN });
  ga.comeBack(a.uid);
  // B 電腦還以為 a 在外面（舊的同步）
  B.mons[0].outing = { since: t.v };
  for (const [x, y] of [[A, B], [B, A]]) {
    const m = mergeShared(x, y).mons.find(m => m.uid === a.uid);
    assert.equal(m.outing, null, '回家的那趟不會又出門');
  }
  // 兩邊各自帶不同的出門：比較晚出門的那隻留下
  const C = structuredClone(base), D = structuredClone(base);
  C.mons[0].outing = { since: t.v + 5 * MIN };
  D.mons[1].outing = { since: t.v + 9 * MIN };
  for (const [x, y] of [[C, D], [D, C]]) {
    const out = mergeShared(x, y).mons.filter(m => m.outing);
    assert.deepEqual(out.map(m => m.uid), [b.uid]);
  }
  // 同一隻兩邊時間不同：比較新的贏
  const E = structuredClone(base), F = structuredClone(base);
  E.mons[0].outing = { since: t.v + 1 * MIN };
  F.mons[0].outing = { since: t.v + 2 * MIN };
  assert.deepEqual(mergeShared(E, F).mons[0].outing, { since: t.v + 2 * MIN });
  assert.deepEqual(mergeShared(F, E).mons[0].outing, { since: t.v + 2 * MIN });
  // 旅行和出門同時出現（壞掉的同步）：旅行贏
  const G = structuredClone(base), H = structuredClone(base);
  G.mons[0].outing = { since: t.v };
  H.mons[0].trip = { id: 'x', place: Object.keys(PLACES)[0], departedAt: t.v, returnAt: t.v + HOUR, seed: 1 };
  H.mons[0].affection = 250; // 讓 H 那份贏
  const m = mergeShared(G, H).mons[0];
  assert.ok(m.trip && !m.outing);
});

test('舊存檔（沒有 outing 欄位）讀進來是「在家」', () => {
  const s = migrate({ mons: [{ uid: 'old', species: 653, out: true, trip: null }] }, dex, at(2026, 9, 26, 9));
  assert.equal(s.mons[0].outing, null);
  assert.equal(s.mons[0].outingDone, null);
  const bad = migrate({ mons: [{ uid: 'x', species: 653, out: true, outing: { since: 'yesterday' } }] }, dex, at(2026, 9, 26, 9));
  assert.equal(bad.mons[0].outing, null);
});
