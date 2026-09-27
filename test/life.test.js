// 牠們自己的生活（core/life.js）
//   F20：同一個時間一定算出一樣的答案（純函式、跟怎麼問無關）
//   F34：跟你的作息一樣，不是亂數：你平常睡的時候牠們在睡、吃飯時間在吃、每天都有喝水
//   F16：沒有「肚子餓」「好寂寞」這種狀態，文字不責怪
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../src/core/life.js';
import * as R from '../src/core/routine.js';
import { NATURE_TRAITS } from '../src/core/mind.js';

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const at = (y, mo, d, h, m = 0) => new Date(y, mo - 1, d, h, m).getTime();
const NATURES = Object.keys(NATURE_TRAITS);
const pets = n => Array.from({ length: n }, (_, i) => ({ uid: `mon-${i}-${(i * 7919) % 1000}`, nature: NATURES[i % NATURES.length] }));
const DEFAULT = L.lifeCtx(null, 0);

test('架構：core/life.js 是純邏輯，沒有模組層級的可變狀態', () => {
  const src = readFileSync(new URL('../src/core/life.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Math\.random|Date\.now|document\.|window\.|localStorage|fetch\(|createRng\(|rng\.js/);
  assert.doesNotMatch(src, /^(let|var) /m);
});

test('F20：跟怎麼問無關——每 1 分鐘問和每 37 分鐘問，共同的時間點答案一樣；切兩段算和一次算一樣', () => {
  const pet = { uid: 'abc', nature: 'jolly' }, t0 = at(2026, 9, 27, 6);
  const every = step => { const m = new Map(); for (let t = t0; t < t0 + DAY; t += step) m.set(t, L.activityAt(pet, t, DEFAULT)); return m; };
  const a = every(MIN), b = every(37 * MIN);
  for (const [t, act] of b) assert.equal(a.get(t), act);
  const whole = L.timeline(pet, t0, 144, DEFAULT).acts;
  const parts = L.timeline(pet, t0, 60, DEFAULT).acts + L.timeline(pet, t0 + 60 * L.SLOT, 84, DEFAULT).acts;
  assert.equal(whole, parts);
  assert.equal(whole.length, 144);
  // 時間表查回來跟直接算一樣（手機查表、電腦直接算）
  const tl = L.timeline(pet, t0 + 3 * MIN, 144, DEFAULT);
  for (let i = 0; i < 144; i += 7) assert.equal(L.actOfCode(tl.acts[i]), L.activityAt(pet, tl.from + i * tl.slot + 4 * MIN, DEFAULT));
});

test('F34：1000 隻，你平常睡覺的時段 ≥ 70% 在睡；午餐時間吃東西是其他時間的 3 倍以上；每隻每天至少 4 次喝水', () => {
  const day0 = at(2026, 9, 27, 0);
  let sleepSlots = 0, sleeping = 0, lunch = 0, lunchEat = 0, other = 0, otherEat = 0, minDrinks = Infinity;
  for (const pet of pets(1000)) {
    const tl = L.timeline(pet, day0, 144, DEFAULT).acts;
    let drinks = 0;
    for (let i = 0; i < 144; i++) {
      const m = i * 10 + 5, act = L.actOfCode(tl[i]);
      if (m >= 23 * 60 + 30 || m < 7 * 60 + 30) { sleepSlots++; if (act === 'sleep') sleeping++; continue; }
      if (m >= 12 * 60 && m < 13 * 60) { lunch++; if (act === 'eat') lunchEat++; }
      else if (!(m >= 18 * 60 + 30 && m < 19 * 60 + 30)) { other++; if (act === 'eat') otherEat++; }
      if (act === 'drink') drinks++;
    }
    minDrinks = Math.min(minDrinks, drinks);
  }
  assert.ok(sleeping / sleepSlots >= 0.7, `睡覺時段只有 ${(sleeping / sleepSlots).toFixed(2)} 在睡`);
  assert.ok(lunchEat / lunch >= 3 * (otherEat / other), `午餐 ${(lunchEat / lunch).toFixed(2)} vs 其他 ${(otherEat / other).toFixed(2)}`);
  assert.ok(minDrinks >= 4, `有一隻一天只喝 ${minDrinks} 次水`);
});

test('F34：跟著你的作息——你平常 01:00 才睡、09:00 起來，牠們 03:00 在睡、10:00 醒著', () => {
  const r = R.defaultRoutine();
  for (let d = 10; d < 20; d++) { R.tick(r, at(2026, 9, d, 9), { active: true }); R.tick(r, at(2026, 9, d + 1, 1), { active: true }); }
  const now = at(2026, 9, 21, 12), ctx = L.lifeCtx(r, now);
  assert.deepEqual(ctx, { sleepFrom: 1 * 60 + 20, sleepTo: 8 * 60 + 50 });
  for (const pet of pets(50)) {
    assert.equal(L.activityAt(pet, at(2026, 9, 22, 3), ctx), 'sleep');
    assert.notEqual(L.activityAt(pet, at(2026, 9, 22, 10), ctx), 'sleep');
    assert.notEqual(L.activityAt(pet, at(2026, 9, 22, 0, 10), ctx), 'sleep', '你還沒睡，牠們也還醒著');
  }
  assert.deepEqual(L.lifeCtx(R.defaultRoutine(), now), DEFAULT, '作息不夠 7 天：用預設');
});

test('個性：外向的比較常玩、內向的比較常看書', () => {
  const count = (nature, act) => {
    let n = 0;
    for (let i = 0; i < 300; i++) n += [...L.timeline({ uid: `p${i}`, nature }, at(2026, 9, 27, 0), 144, DEFAULT).acts].filter(c => c === L.CODE[act]).length;
    return n;
  };
  assert.ok(count('jolly', 'play') > count('bashful', 'play') * 1.5);
  assert.ok(count('bashful', 'read') > count('jolly', 'read') * 1.2);
});

test('F16：只有這七種生活，沒有「餓」「寂寞」；文字不責怪', () => {
  assert.deepEqual(L.ACTS, ['sleep', 'nap', 'drink', 'eat', 'read', 'play', 'wander']);
  const GUILT = /好久|怎麼都|又忘|連續.{0,3}天|快點|不理我|餓|寂寞|等你/;
  for (const a of L.ACTS) assert.doesNotMatch(L.lifeLine(a, '咕咕鴿'), GUILT);
  assert.equal(L.lifeLine('drink', '咕咕鴿'), '咕咕鴿在喝水');
});
