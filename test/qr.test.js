// QR code（core/qr.js）：跟 Nayuki 的 QR Code generator（Python 版）逐格一樣，包括自動挑的遮罩
// 對照資料 test/fixtures/qr-nayuki.json 是用 qrcodegen（pip）產生的：4 個網址 × 8 種遮罩＋自動
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeQR } from '../src/core/qr.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/qr-nayuki.json', import.meta.url), 'utf8'));

test('跟參考實作逐格一樣（版本 1、4、5、7；8 種遮罩＋自動挑）', () => {
  for (const f of fixtures) {
    const q = encodeQR(f.text, { mask: f.mask });
    assert.equal(q.version, f.version, f.text);
    if (f.mask === null) assert.equal(q.mask, f.autoMask, `自動挑的遮罩 ${f.text}`);
    const rows = Array.from({ length: q.size }, (_, y) => Array.from({ length: q.size }, (_, x) => (q.get(x, y) ? '1' : '0')).join(''));
    assert.deepEqual(rows, f.rows, `${f.text} 遮罩 ${f.mask}`);
  }
});

test('太長的放不進去會丟錯（不會產生壞掉的圖）；中文也可以', () => {
  assert.throws(() => encodeQR('x'.repeat(300)));
  const q = encodeQR('寶可夢');
  assert.ok(q.size >= 21);
  assert.equal(q.get(-1, 0), false);
});
