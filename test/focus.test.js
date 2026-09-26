// PR 4：專注番茄鐘
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import { clampMinutes, remainingMs, nextStreak, rewardTier } from '../src/core/focus.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 8, 25, 14, 0).getTime();
const MIN = 60_000, DAY = 24 * 60 * MIN;

function newGame() {
  let clock = T0;
  const game = new Game({ dex, state: defaultSave(T0), rng: createRng(1), now: () => clock });
  game.advance = ms => { clock += ms; };
  return game;
}

test('專注：長度 15–60 分鐘，剩餘時間用開始時間算（電腦睡眠也不會算錯）', () => {
  assert.equal(clampMinutes(5), 15);
  assert.equal(clampMinutes(90), 60);
  assert.equal(clampMinutes('x'), 25);
  const active = { startedAt: T0, minutes: 25 };
  assert.equal(remainingMs(active, T0), 25 * MIN);
  assert.equal(remainingMs(active, T0 + 10 * MIN), 15 * MIN);
  assert.equal(remainingMs(active, T0 + 3 * 3600_000), 0); // 睡了三小時回來：直接到時間
  assert.equal(remainingMs(null, T0), 0);
});

test('專注：時間到才有獎勵；放棄沒有獎勵；完成時外出的夥伴好感 +5', () => {
  const g = newGame();
  const m = g.createMon(650); m.out = true; g.state.mons.push(m);
  const puffs = () => Object.values(g.state.bag.puffs).reduce((a, b) => a + b, 0);
  const p0 = puffs();
  assert.equal(g.startFocus(25), true);
  assert.equal(g.startFocus(25), false, '不能同時開兩個');
  g.advance(24 * MIN);
  assert.equal(g.finishFocus(), null, '還沒到');
  g.advance(1 * MIN);
  const r = g.finishFocus();
  assert.equal(r.minutes, 25);
  assert.equal(r.streak, 1);
  assert.match(r.puff, /-frosted$/);
  assert.equal(puffs(), p0 + 1);
  assert.equal(m.affection, 5);
  assert.deepEqual([g.state.focus.sessions, g.state.focus.totalMinutes, g.state.stats.focusSessions], [1, 25, 1]);
  // 放棄
  g.startFocus(30);
  g.advance(10 * MIN);
  assert.equal(g.cancelFocus(), true);
  g.advance(30 * MIN);
  assert.equal(g.finishFocus(), null);
  assert.equal(g.state.focus.sessions, 1);
});

test('專注：連續天數與獎勵等級；豪華泡芙每天只有第一次', () => {
  assert.equal(nextStreak({ lastDay: null, streakDays: 0 }, '2026-09-25', '2026-09-24'), 1);
  assert.equal(nextStreak({ lastDay: '2026-09-24', streakDays: 4 }, '2026-09-25', '2026-09-24'), 5);
  assert.equal(nextStreak({ lastDay: '2026-09-25', streakDays: 4 }, '2026-09-25', '2026-09-24'), 4);
  assert.equal(nextStreak({ lastDay: '2026-09-20', streakDays: 9 }, '2026-09-25', '2026-09-24'), 1);
  assert.equal(rewardTier(1, true), 'frosted');
  assert.equal(rewardTier(3, true), 'fancy');
  assert.equal(rewardTier(7, true), 'deluxe');
  assert.equal(rewardTier(7, false), 'fancy');
  const g = newGame();
  for (let day = 0; day < 8; day++) {
    g.startFocus(15); g.advance(15 * MIN); g.finishFocus();
    g.advance(DAY - 15 * MIN);
  }
  assert.equal(g.state.focus.streakDays, 8);
});

test('專注：關掉遊戲再打開，進行中的專注還在（存檔會記開始時間）', () => {
  const g = newGame();
  g.startFocus(40);
  const back = migrate(structuredClone(g.state), dex, T0);
  assert.deepEqual(back.focus.active, { startedAt: T0, minutes: 40 });
  assert.equal(migrate({ settings: { focusMinutes: 999 } }, dex, T0).settings.focusMinutes, 60);
});

test('設定「減少閃光和畫面震動」：預設關；只有 true 才算打開；讀回來一樣', () => {
  assert.equal(defaultSave(T0).settings.calmFx, false);
  assert.equal(migrate({ settings: { calmFx: 'yes' } }, dex, T0).settings.calmFx, false);
  assert.equal(migrate({ settings: { calmFx: true } }, dex, T0).settings.calmFx, true);
  assert.equal(migrate({}, dex, T0).settings.calmFx, false);
});
