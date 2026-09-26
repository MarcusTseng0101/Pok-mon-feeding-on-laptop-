// 打擾額度（core/attention.js）：每小時上限、專注中擋住、被擋下的排隊不丟掉、過期的丟掉、優先順序
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../src/core/attention.js';

const MIN = 60_000, T0 = Date.UTC(2026, 8, 26, 2, 0);

test('每小時最多 1 次：第二次被擋、排隊；60 分鐘後放行', () => {
  const att = A.defaultAttention(), q = [];
  assert.deepEqual(A.request(att, q, { id: 'a', kind: 'greet' }, T0), { granted: true });
  const r = A.request(att, q, { id: 'b', kind: 'gift', expiresAt: Infinity }, T0 + 10 * MIN);
  assert.equal(r.granted, false);
  assert.equal(r.retryAt, T0 + 60 * MIN);
  assert.equal(q.length, 1);
  assert.equal(A.drain(att, q, T0 + 59 * MIN), null, '還沒到');
  assert.equal(A.drain(att, q, T0 + 60 * MIN + 1)?.id, 'b');
  assert.equal(q.length, 0);
  assert.equal(A.usedInWindow(att, T0 + 61 * MIN), 1);
});

test('專注中、勿擾中：額度是 0，全部排隊；結束後依優先順序放行', () => {
  const att = A.defaultAttention(), q = [];
  const blocked = { blocked: true };
  assert.equal(A.request(att, q, { id: 'typing', kind: 'ambient', priority: A.PRIORITY.ambient, expiresAt: T0 + 5 * MIN }, T0, blocked).granted, false);
  assert.equal(A.request(att, q, { id: 'story:gym-viola', kind: 'story', priority: A.PRIORITY.story, expiresAt: Infinity }, T0 + MIN, blocked).granted, false);
  assert.equal(A.request(att, q, { id: 'gift', kind: 'gift', priority: A.PRIORITY.gift, expiresAt: Infinity }, T0 + 2 * MIN, blocked).granted, false);
  assert.equal(A.drain(att, q, T0 + 3 * MIN, blocked), null, '還在專注');
  // 專注 25 分鐘結束：打字的反應已經過期（丟掉），故事先放行
  const t = T0 + 25 * MIN;
  assert.equal(A.drain(att, q, t)?.id, 'story:gym-viola');
  assert.deepEqual(q.map(e => e.id), ['gift']);
  assert.equal(A.drain(att, q, t + MIN), null, '這小時用掉了');
  assert.equal(A.drain(att, q, t + 61 * MIN)?.id, 'gift');
});

test('被延後的故事事件一定會發生（不會過期）', () => {
  const att = A.defaultAttention(), q = [];
  A.request(att, q, { id: 'x', kind: 'greet' }, T0);
  A.request(att, q, { id: 'story', kind: 'story', priority: A.PRIORITY.story, expiresAt: Infinity }, T0 + MIN);
  let got = null;
  for (let t = T0; t < T0 + 10 * 60 * MIN && !got; t += 5 * MIN) got = A.drain(att, q, t);
  assert.equal(got?.id, 'story');
});

test('有更優先的在排隊：新的低優先申請不能插隊', () => {
  const att = A.defaultAttention(), q = [];
  A.request(att, q, { id: 'x', kind: 'greet' }, T0);
  A.request(att, q, { id: 'story', kind: 'story', priority: 50 }, T0 + MIN);
  const r = A.request(att, q, { id: 'gift', kind: 'gift', priority: 20 }, T0 + 61 * MIN);
  assert.equal(r.granted, false, '故事還在等，禮物不能先走');
  assert.equal(A.drain(att, q, T0 + 61 * MIN)?.id, 'story');
});

test('同一件事只排一次；設定的上限；很累的時候降一級', () => {
  const att = A.defaultAttention(), q = [];
  A.request(att, q, { id: 'a', kind: 'greet' }, T0, { limit: 0 });
  A.request(att, q, { id: 'a', kind: 'greet' }, T0 + MIN, { limit: 0 });
  assert.equal(q.length, 1);
  assert.equal(A.limitOf('2'), 2);
  assert.equal(A.limitOf('unlimited'), Infinity);
  assert.equal(A.limitOf('nope'), A.DEFAULT_LIMIT);
  assert.equal(A.lowerLimit(Infinity), 2);
  assert.equal(A.lowerLimit(1), 0);
  assert.equal(A.lowerLimit(0), 0);
  const u = A.defaultAttention(), uq = [];
  for (let i = 0; i < 5; i++) assert.equal(A.request(u, uq, { id: `u${i}` }, T0 + i, { limit: Infinity }).granted, true);
});

test('存檔與同步：只留 24 小時內、合併兩台電腦放行的時間', () => {
  assert.deepEqual(A.normalizeAttention({ granted: [3, 'x', 1, NaN] }), { granted: [1, 3] });
  assert.deepEqual(A.normalizeAttention(null), A.defaultAttention());
  const m = A.mergeAttention({ granted: [T0] }, { granted: [T0 + MIN, T0] });
  assert.deepEqual(m.granted, [T0, T0 + MIN]);
  assert.equal(A.canInterrupt(m, T0 + 2 * MIN), false, '另一台電腦剛打擾過你');
});
