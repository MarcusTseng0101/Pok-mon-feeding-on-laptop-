// 真實的日曆（core/calendar.js）：農曆的日期寫死、除夕到初三、表外的年份不猜、季節（南半球反過來）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/core/calendar.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test('農曆日期表：跟規格寫死的日子一樣（2025–2028）', () => {
  assert.deepEqual([2025, 2026, 2027, 2028].map(y => C.LUNAR[y].newYear), ['01-29', '02-17', '02-06', '01-26']);
  assert.deepEqual([2025, 2026, 2027, 2028].map(y => C.LUNAR[y].midAutumn), ['10-06', '09-25', '09-15', '10-03']);
  for (let y = 2025; y <= 2040; y++) assert.ok(C.LUNAR[y], `${y} 在表裡`);
});

test('春節：除夕到初三；中秋只有那一天', () => {
  assert.deepEqual(C.holidaysOn(at(2026, 2, 15)), []);
  assert.deepEqual(C.holidaysOn(at(2026, 2, 16)), ['lunar-new-year'], '除夕');
  assert.deepEqual(C.holidaysOn(at(2026, 2, 19)), ['lunar-new-year'], '初三');
  assert.deepEqual(C.holidaysOn(at(2026, 2, 20)), []);
  assert.deepEqual(C.holidaysOn(at(2028, 1, 25)), ['lunar-new-year'], '2028 的除夕');
  assert.deepEqual(C.holidaysOn(at(2026, 9, 25, 0)), ['mid-autumn'], '半夜也算');
  assert.deepEqual(C.holidaysOn(at(2026, 9, 26)), []);
});

test('表外的年份：不過農曆節日，也不會壞掉', () => {
  assert.deepEqual(C.holidaysOn(at(2045, 2, 17)), []);
  assert.deepEqual(C.holidaysOn(at(2045, 12, 25)), ['christmas']);
});

test('國曆節日、你的生日、認識 100 天', () => {
  assert.deepEqual(C.holidaysOn(at(2026, 12, 24)), ['christmas']);
  assert.deepEqual(C.holidaysOn(at(2026, 12, 31)), ['new-year-eve']);
  assert.deepEqual(C.holidaysOn(at(2027, 1, 1)), ['new-year']);
  assert.deepEqual(C.holidaysOn(at(2026, 10, 1), { birthday: '10-01' }), ['birthday']);
  const met = at(2026, 1, 1, 23);
  assert.deepEqual(C.holidaysOn(at(2026, 4, 11, 1), { firstMet: met }), ['met-100'], '1/1 是第 0 天，4/11 是第 100 天');
  assert.deepEqual(C.holidaysOn(at(2026, 4, 10), { firstMet: met }), []);
  for (const h of Object.values(C.HOLIDAYS)) assert.ok(h.zh && h.deco && h.hello);
});

test('季節：北半球照月份，南半球反過來', () => {
  assert.equal(C.seasonOf(at(2026, 9, 26), 'Asia/Taipei'), 'autumn');
  assert.equal(C.seasonOf(at(2026, 1, 5), 'Asia/Taipei'), 'winter');
  assert.equal(C.seasonOf(at(2026, 9, 26), 'Australia/Sydney'), 'spring');
  assert.equal(C.seasonOf(at(2026, 7, 1), 'America/Argentina/Buenos_Aires'), 'winter');
  assert.equal(C.seasonOf(at(2026, 7, 1), ''), 'summer');
});
