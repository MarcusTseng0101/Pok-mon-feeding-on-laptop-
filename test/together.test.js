// 你和大家（core/together.js）＋心情（core/mood.js）：
// 里程碑不會因為夥伴的記憶淡掉或放生而消失、舊存檔推回第一次見面、每週的信只寫真的發生過的事、同步
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import { mergeShared } from '../src/core/sync.js';
import * as T from '../src/core/together.js';
import * as M from '../src/core/mood.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const HOUR = 3_600_000, DAY = 24 * HOUR;
const at = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

function newGame(t) {
  const g = new Game({ dex, state: migrate(defaultSave(t.v), dex, t.v), rng: createRng(5), now: () => t.v });
  g.chooseStarter(656);
  return g;
}

test('第一次見面：選御三家那天；認識滿 7／30 天的里程碑各一次', () => {
  const t = { v: at(2026, 9, 1, 20) };
  const g = newGame(t);
  assert.equal(g.state.together.firstMet, t.v);
  const got = [];
  g.on('milestone', e => got.push(e.id));
  t.v = at(2026, 9, 8, 9);
  g.tick();
  t.v += HOUR;
  g.tick();
  assert.deepEqual(got, ['met-7']);
  t.v = at(2026, 10, 1, 9);
  g.tick();
  assert.deepEqual(got, ['met-7', 'met-30']);
  assert.equal(T.daysTogether(g.state.together, t.v), 30);
});

test('里程碑不會跟著夥伴不見：放生了、記憶淡掉了都還在', () => {
  const t = { v: at(2026, 9, 1, 20) };
  const g = newGame(t);
  t.v = at(2026, 9, 9, 9);
  g.tick();
  g.state.mons = []; // 全部放生
  const back = migrate(JSON.parse(JSON.stringify(g.state)), dex, t.v);
  assert.ok(T.has(back.together, 'met-7'));
});

test('第一次一起熬夜：01:00 以後還在、有夥伴在桌面上；只算一次', () => {
  const t = { v: at(2026, 9, 1, 23) };
  const g = newGame(t);
  const got = [];
  g.on('milestone', e => got.push(e.id));
  g.routineTick({ active: true });
  assert.deepEqual(got, []);
  t.v = at(2026, 9, 2, 1, 20);
  g.routineTick({ active: true });
  t.v += HOUR;
  g.routineTick({ active: true });
  assert.deepEqual(got, ['late-night']);
  // 夥伴都收起來了：不算
  const t2 = { v: at(2026, 9, 1, 23) };
  const h = newGame(t2);
  h.state.mons.forEach(m => { m.out = false; });
  t2.v = at(2026, 9, 2, 1, 20);
  h.routineTick({ active: true });
  assert.equal(T.has(h.state.together, 'late-night'), false);
});

test('第一次一天專注滿 3 小時', () => {
  const t = { v: at(2026, 9, 1, 9) };
  const g = newGame(t);
  for (let i = 0; i < 7; i++) {
    g.state.focus.active = { startedAt: t.v, minutes: 25 };
    t.v += 26 * 60_000;
    g.finishFocus();
  }
  assert.equal(T.has(g.state.together, 'focus-3h'), false, '175 分鐘');
  g.state.focus.active = { startedAt: t.v, minutes: 25 };
  t.v += 26 * 60_000;
  g.finishFocus();
  assert.equal(T.has(g.state.together, 'focus-3h'), true);
});

test('節日：那天第一次看到你打招呼一次；第一次一起過節的里程碑；信多一句', () => {
  const t = { v: at(2026, 9, 24, 20) };
  const g = newGame(t);
  t.v = at(2026, 9, 25, 10); // 2026 中秋
  assert.ok(g.routineTick({ active: true }).includes('holiday'));
  assert.ok(!g.routineTick({ active: true }).includes('holiday'));
  assert.ok(T.has(g.state.together, 'first-holiday'));
  const w = g.letterWriter();
  g.state.letters.pending.push({ key: 'x', kind: 'hearts', uid: w.uid, due: t.v, data: {} });
  const [l] = g.deliverLetters();
  assert.match(l.text.split('\n')[0], /中秋節快樂！/);
});

test('舊存檔沒有第一次見面：用最早來的夥伴推回來', () => {
  const t = { v: at(2026, 9, 1) };
  const g = newGame(t);
  const raw = JSON.parse(JSON.stringify(g.state));
  delete raw.together;
  raw.mons[0].caughtAt = at(2026, 3, 1);
  const s = migrate(raw, dex, t.v);
  assert.equal(s.together.firstMet, at(2026, 3, 1));
  const fresh = migrate(defaultSave(t.v), dex, t.v);
  assert.equal(fresh.together.firstMet, null, '還沒選御三家就沒有');
});

test('心情：一天一次、跳過就不再問、05:00 換日；存 60 天', () => {
  const t = { v: at(2026, 9, 1, 9) };
  const g = newGame(t);
  assert.equal(M.shouldAsk(g.state.mood, t.v), true);
  g.skipMood();
  assert.equal(M.shouldAsk(g.state.mood, t.v), false);
  assert.equal(g.setMood('nope'), false);
  g.setMood('tired');
  g.setMood('happy');
  assert.equal(g.moodToday(), 'happy', '同一天改心情');
  t.v = at(2026, 9, 2, 4, 30); // 還是 9/1 的作息日
  assert.equal(g.moodToday(), 'happy');
  t.v = at(2026, 9, 2, 5, 30);
  assert.equal(g.moodToday(), null);
  assert.equal(M.shouldAsk(g.state.mood, t.v), true);
  for (let i = 0; i < 80; i++) M.setMood(g.state.mood, 'happy', t.v + i * DAY);
  assert.equal(g.state.mood.log.length, M.KEPT);
});

test('每週的信：週日 9 點以後、一週一封、不佔每天 2 封；信裡每個數字都對得上統計', () => {
  const t = { v: at(2026, 9, 20, 10) }; // 週日
  const g = newGame(t);
  // 這一週（9/20 前 7 天）：開了 5 天電腦、專注 95 分鐘、2 天很累 1 天很開心
  const days = T.weekDays(at(2026, 9, 27, 10));
  days.slice(0, 5).forEach((d, i) => { g.state.routine.days[d] = { first: 200, last: 900, typing: 10, focus: i === 0 ? 70 : i === 1 ? 25 : 0 }; });
  g.state.mood.log = [{ day: days[0], mood: 'tired' }, { day: days[2], mood: 'tired' }, { day: days[3], mood: 'happy' }];
  t.v = at(2026, 9, 27, 8); // 週日 8 點：還沒
  assert.equal(g.maybeWeeklyLetter(), null);
  t.v = at(2026, 9, 27, 9, 30);
  g.state.letters.sent = 2; // 今天的 2 封已經寄完了
  g.state.letters.day = g.state.letters.day ?? null;
  const r = g.maybeWeeklyLetter();
  assert.ok(r, '週日早上要寄');
  assert.equal(r.letter.kind, 'weekly');
  const s = T.weeklySummary(g.state, t.v);
  assert.deepEqual({ days: s.days, focus: s.focus, moods: s.moods }, { days: 5, focus: 95, moods: { tired: 2, happy: 1, stressed: 0 } });
  // 信裡的數字：天數、專注時間、心情天數都跟統計一樣，沒有編出來的數字
  const text = r.letter.text;
  assert.match(text, /這週我們一起過了 5 天/);
  assert.match(text, /1 小時35 分鐘/);
  assert.match(text, /有 2 天你說很累/);
  const nums = (text.match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b);
  assert.deepEqual(nums, [1, 2, 5, 35], '信裡只有這些數字');
  assert.deepEqual(r.refs.map(x => x.k), ['days', 'focus', 'mood:tired']);
  assert.equal(g.maybeWeeklyLetter(), null, '同一週不寄第二封');
  // 這週都沒開電腦：不寄
  const t2 = { v: at(2026, 9, 27, 10) };
  const h = newGame(t2);
  h.state.routine.days = {};
  assert.equal(h.maybeWeeklyLetter(), null);
});

test('同步：里程碑取聯集、第一次見面取早的、心情同一天用這台電腦的', () => {
  const t = { v: at(2026, 9, 1) };
  const a = newGame(t), b = newGame({ v: at(2026, 8, 1) });
  a.state.together.milestones = [{ id: 'met-7', at: 5 }];
  b.state.together.milestones = [{ id: 'late-night', at: 9 }, { id: 'met-7', at: 3 }];
  M.setMood(a.state.mood, 'happy', t.v);
  M.setMood(b.state.mood, 'tired', t.v);
  const m = mergeShared(a.state, b.state);
  assert.deepEqual(m.together.milestones, [{ id: 'met-7', at: 3 }, { id: 'late-night', at: 9 }]);
  assert.equal(m.together.firstMet, at(2026, 8, 1));
  assert.equal(M.moodToday(m.mood, t.v), 'happy');
  assert.deepEqual(T.mergeTogether(a.state.together, b.state.together).milestones, T.mergeTogether(b.state.together, a.state.together).milestones);
});
