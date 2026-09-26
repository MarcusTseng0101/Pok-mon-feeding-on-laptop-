// 學會作息（core/routine.js）：跨過午夜、05:00 換日、時區、資料不夠不下結論、早安不看 app 有沒有重開、專注兩小時
// 用 process.env.TZ 固定時區（各時區的測試用子行程跑）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as R from '../src/core/routine.js';

const MIN = 60_000, HOUR = 60 * MIN;
const at = (y, mo, d, h, m = 0) => new Date(y, mo - 1, d, h, m).getTime();

test('作息日從 05:00 開始：00:30 還算昨天；04:59 和 05:01 是不同天', () => {
  assert.equal(R.routineDay(at(2026, 9, 27, 0, 30)), '2026-09-26');
  assert.equal(R.routineDay(at(2026, 9, 27, 4, 59)), '2026-09-26');
  assert.equal(R.routineDay(at(2026, 9, 27, 5, 1)), '2026-09-27');
  assert.equal(R.minuteOf(at(2026, 9, 27, 5, 0)), 0);
  assert.equal(R.minuteOf(at(2026, 9, 26, 23, 30)), 1110);
  assert.equal(R.minuteOf(at(2026, 9, 27, 1, 0)), 1200, '01:00 比 23:30 晚（不是比較早）');
  assert.ok(R.minuteOf(at(2026, 9, 27, 1, 0)) > R.minuteOf(at(2026, 9, 26, 23, 30)));
  assert.equal(R.clockOf(1200), '01:00');
});

// 過 n 天規律的生活：每天 start 點開電腦、end 點關（end 可以過午夜）
function live(r, days, startH, endH, from = at(2026, 9, 1, 0)) {
  for (let i = 0; i < days; i++) {
    const day = from + i * 24 * HOUR;
    const s = day + startH * HOUR, e = day + (endH < startH ? endH + 24 : endH) * HOUR;
    for (let t = s; t <= e; t += 30 * MIN) R.tick(r, t, { active: true });
  }
}

test('資料不夠 7 天：不說「比平常晚」，只看固定的 01:00', () => {
  const r = R.defaultRoutine();
  live(r, 3, 9, 23);
  const night = at(2026, 9, 4, 23, 50);
  assert.equal(R.usual(r, night), null);
  assert.equal(R.lateAfter(r, night), R.LATE_FALLBACK);
  assert.deepEqual(R.tick(r, night, { active: true }), [], '23:50 還不算');
  assert.deepEqual(R.tick(r, at(2026, 9, 5, 1, 5), { active: true }), ['bedtime']);
});

test('平常 23:30 睡：今天 00:20 還在 → 晚睡（跨過午夜也對）；一晚只提醒一次', () => {
  const r = R.defaultRoutine();
  live(r, 10, 9, 23.5);
  const u = R.usual(r, at(2026, 9, 11, 22));
  assert.equal(R.clockOf(u.last), '23:30');
  assert.deepEqual(R.tick(r, at(2026, 9, 11, 23, 50), { active: true }), []);
  assert.deepEqual(R.tick(r, at(2026, 9, 12, 0, 20), { active: true }), ['bedtime']);
  assert.deepEqual(R.tick(r, at(2026, 9, 12, 0, 50), { active: true }), [], '同一晚不再提醒');
  assert.equal(R.routineDay(at(2026, 9, 12, 0, 20)), '2026-09-11');
});

test('平常很晚睡（02:00）：00:30 不算晚睡；很早就不用電腦的人，也要 22:00 以後', () => {
  const r = R.defaultRoutine();
  live(r, 10, 11, 2);
  assert.deepEqual(R.tick(r, at(2026, 9, 12, 0, 30), { active: true }), []);
  assert.deepEqual(R.tick(r, at(2026, 9, 12, 2, 50), { active: true }), ['bedtime']);
  const e = R.defaultRoutine();
  live(e, 10, 7, 17);
  assert.equal(R.lateAfter(e, at(2026, 9, 12, 12)), R.LATE_EARLIEST);
});

test('早安：離開 4 小時以上、早上才算；一天一次；不管 app 有沒有重開（只看上一次操作的時間）', () => {
  const r = R.defaultRoutine();
  R.tick(r, at(2026, 9, 1, 23), { active: true });
  assert.deepEqual(R.tick(r, at(2026, 9, 2, 8), { active: true }), ['greet']);
  assert.deepEqual(R.tick(r, at(2026, 9, 2, 8, 1), { active: true }), []);
  // 睡午覺 5 小時再回來：已經打過招呼了
  assert.deepEqual(R.tick(r, at(2026, 9, 2, 13), { active: true }), []);
  // 隔天下午才開電腦：不是早上，不打招呼
  assert.deepEqual(R.tick(r, at(2026, 9, 3, 14), { active: true }), []);
  // 只離開 2 小時（熬夜到 04:00、06:00 又開）：不算早上第一次
  const n = R.defaultRoutine();
  R.tick(n, at(2026, 9, 1, 4), { active: true });
  assert.deepEqual(R.tick(n, at(2026, 9, 1, 6), { active: true }), []);
  // 沒在操作電腦：什麼都不記
  assert.deepEqual(R.tick(n, at(2026, 9, 1, 9), { active: false }), []);
  // 存檔讀回來還記得上一次操作的時間（app 重開不會重新打招呼）
  const back = R.normalizeRoutine(JSON.parse(JSON.stringify(r)));
  assert.deepEqual(R.tick(back, at(2026, 9, 3, 14, 5), { active: true }), []);
});

test('專注兩小時：加起來第一次超過 120 分鐘慶祝一次；隔天重新算', () => {
  const r = R.defaultRoutine();
  const t = at(2026, 9, 2, 10);
  assert.equal(R.addFocus(r, t, 50), false);
  assert.equal(R.addFocus(r, t + HOUR, 50), false);
  assert.equal(R.addFocus(r, t + 2 * HOUR, 25), true);
  assert.equal(R.addFocus(r, t + 3 * HOUR, 25), false);
  assert.equal(R.focusToday(r, t + 3 * HOUR), 150);
  assert.equal(R.addFocus(r, at(2026, 9, 3, 10), 120), true);
});

test('只存統計：28 天、每天 4 個數字；壞資料丟掉；同步取最早／最晚、加起來', () => {
  const r = R.defaultRoutine();
  live(r, 40, 9, 22);
  assert.equal(Object.keys(r.days).length, R.DAYS_KEPT);
  assert.deepEqual(Object.keys(Object.values(r.days)[0]).sort(), ['first', 'focus', 'last', 'typing']);
  const bad = R.normalizeRoutine({ days: { nope: { first: 1, last: 2 }, '2026-09-01': { first: 'x', last: 3 }, '2026-09-02': { first: 900, last: 100 } }, greeted: 'x' });
  assert.deepEqual(Object.keys(bad.days), ['2026-09-02']);
  assert.deepEqual(bad.days['2026-09-02'], { first: 100, last: 900, typing: 0, focus: 0 });
  assert.equal(bad.greeted, null);
  const a = { days: { '2026-09-02': { first: 200, last: 800, typing: 10, focus: 50 } }, lastActiveAt: 5, greeted: '2026-09-02' };
  const b = { days: { '2026-09-02': { first: 100, last: 900, typing: 5, focus: 25 } }, lastActiveAt: 9, greeted: '2026-09-01' };
  const m = R.mergeRoutine(a, b);
  assert.deepEqual(m.days['2026-09-02'], { first: 100, last: 900, typing: 15, focus: 75 });
  assert.equal(m.lastActiveAt, 9);
  assert.equal(m.greeted, '2026-09-02');
  assert.deepEqual(R.mergeRoutine(a, b), R.mergeRoutine(b, a));
});

// 不同時區：作息日和「幾點」都照當地時間
test('時區：台北和洛杉磯的同一個瞬間，是各自當地的作息日', () => {
  const file = fileURLToPath(new URL('../src/core/routine.js', import.meta.url));
  const script = `import(${JSON.stringify(file)}).then(R => { const t = Date.UTC(2026, 8, 26, 16, 30); console.log(R.routineDay(t) + ' ' + R.clockOf(R.minuteOf(t))); })`;
  const run = tz => execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz } }).toString().trim();
  assert.equal(run('Asia/Taipei'), '2026-09-26 00:30', '台北 00:30：還算 26 日晚上');
  assert.equal(run('America/Los_Angeles'), '2026-09-26 09:30');
});
