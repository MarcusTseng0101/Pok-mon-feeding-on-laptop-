// v3 PR 2：滑鼠玩具（心智的 cursor 類別）與野生探頭的頻率
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';
import * as M from '../src/core/mind.js';
import * as mem from '../src/core/memory.js';
import { shouldPeek, PEEK_CHANCE } from '../src/core/encounter.js';

const lv = { food: 90, fun: 40, energy: 80, social: 80, curiosity: 40, comfort: 80 };

test('cursor：你不在電腦前就不玩；好奇外向的比膽小的愛玩', () => {
  const mind = { recent: [] };
  assert.equal(M.weights(mind, lv, M.traitsOf('naive'), { userActive: false }).cursor, M.MULT_MIN);
  const naive = M.weights(mind, lv, M.traitsOf('naive'), { userActive: true }).cursor;
  const timid = M.weights(mind, lv, M.traitsOf('timid'), { userActive: true }).cursor;
  assert.ok(naive > timid * 1.5, `${naive} vs ${timid}`);
  assert.ok(naive <= M.MULT_MAX);
});

test('cursor 的理由：被游標嚇過會記得', () => {
  const rng = createRng(1);
  assert.equal(M.reason('cursor', lv, rng).key, 'cursor.fun');
  assert.equal(M.reason('cursor', { ...lv, fun: 90 }, rng).key, 'cursor.curiosity');
  assert.equal(M.reason('cursor', { ...lv, fun: 90, curiosity: 90 }, rng).key, 'cursor.calm');
  const r = M.reason('cursor', lv, rng, { cursorSurprised: true });
  assert.equal(r.key, 'cursor.memory');
  assert.equal(M.citesOf(r.key), 'memory');
  assert.equal(M.citesOf('explore.peeker'), 'memory');
  const list = [];
  mem.remember(list, { k: 'cursor-surprised' }, 1000);
  mem.remember(list, { k: 'saw-peeker', data: { name: '掘掘兔' } }, 2000);
  assert.deepEqual(mem.summary(list, 3000).map(e => e.text).sort(), ['坐在箭頭旁邊，它突然跑掉嚇了我一跳', '看到掘掘兔從螢幕邊邊探頭'].sort());
});

test('探頭：每 3 次最多 1 次、不會連續；傳說的不探頭', () => {
  const plan = { special: false };
  for (const seed of [1, 2, 3, 4, 5]) {
    const rng = createRng(seed);
    const kinds = [];
    for (let i = 0; i < 300; i++) kinds.push(shouldPeek(kinds, plan, rng) ? 'peek' : 'spot');
    const n = kinds.filter(k => k === 'peek').length;
    assert.ok(n <= 100, `${n}/300`);
    assert.ok(n > 300 * PEEK_CHANCE * 0.25, `太少：${n}/300`);
    for (let i = 0; i < kinds.length; i++) if (kinds[i] === 'peek') assert.ok(!kinds.slice(i + 1, i + 3).includes('peek'), `第 ${i} 次附近連續探頭`);
  }
  assert.equal(shouldPeek([], { special: true }, () => 0), false);
});
