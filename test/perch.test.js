// PR 4：站在視窗上——哪些頂邊看得到
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleLedges, ledgeUnder } from '../src/core/perch.js';

const W = (hwnd, x, y, w, h) => ({ hwnd, x, y, w, h });

test('視窗頂邊：最上層的整條都看得到', () => {
  assert.deepEqual(visibleLedges([W('a', 100, 200, 400, 300)]), [{ hwnd: 'a', x0: 100, x1: 500, y: 200 }]);
});

test('視窗頂邊：被上層視窗蓋住的部分扣掉，可能被切成兩段', () => {
  // b 在 a 後面，a 蓋住 b 頂邊的中間
  const rects = [W('a', 300, 100, 200, 400), W('b', 100, 200, 800, 300)];
  assert.deepEqual(visibleLedges(rects), [
    { hwnd: 'a', x0: 300, x1: 500, y: 100 },
    { hwnd: 'b', x0: 100, x1: 300, y: 200 },
    { hwnd: 'b', x0: 500, x1: 900, y: 200 },
  ]);
});

test('視窗頂邊：上層視窗在頂邊下面（沒蓋到那一條線）就不算遮住', () => {
  const rects = [W('a', 300, 250, 200, 100), W('b', 100, 200, 800, 300)];
  assert.equal(visibleLedges(rects).filter(l => l.hwnd === 'b').length, 1);
  // 上層視窗的底邊剛好在頂邊上方：也沒蓋到
  const rects2 = [W('a', 300, 100, 200, 100), W('b', 100, 200, 800, 300)];
  assert.deepEqual(visibleLedges(rects2).find(l => l.hwnd === 'b'), { hwnd: 'b', x0: 100, x1: 900, y: 200 });
});

test('視窗頂邊：完全被蓋住、太窄、貼著螢幕上緣的不能站', () => {
  const rects = [W('a', 0, 0, 1920, 1040), W('b', 100, 200, 800, 300)];
  assert.deepEqual(visibleLedges(rects), []); // a 在最上緣（最大化），b 被 a 整個蓋住
  const narrow = [W('a', 300, 100, 790, 400), W('b', 280, 200, 830, 300)];
  assert.deepEqual(visibleLedges(narrow, { minWidth: 50 }).filter(l => l.hwnd === 'b'), []); // 兩邊只剩 20 px
});

test('腳下的頂邊還在不在', () => {
  const ls = visibleLedges([W('a', 300, 100, 200, 400), W('b', 100, 200, 800, 300)]);
  assert.ok(ledgeUnder(ls, 'b', 200));
  assert.equal(ledgeUnder(ls, 'b', 400), null); // 被 a 蓋住的地方
  assert.equal(ledgeUnder(ls, 'c', 200), null);
});
