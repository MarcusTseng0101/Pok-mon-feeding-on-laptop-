// 信封、腳印簽名（全部用程式畫）
import { paint } from './pixel.js';

const K = '#2a2030';

export const envelope = paint(16, 12, set => {
  for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) set(x, y, x === 0 || y === 0 || x === 15 || y === 11 ? K : '#fbf7ee');
  for (let k = 1; k < 8; k++) { set(k, k, K); set(15 - k, k, K); } // 封口的 V 字
  set(7, 7, '#ff6fa5'); set(8, 7, '#ff6fa5'); set(7, 8, '#ff6fa5'); set(8, 8, '#ff6fa5'); // 愛心封蠟
});

// 小腳印（顏色＝寫信那隻的屬性顏色）
const PAW = ['.X.X.', 'X.X.X', '.....', '.XXX.', 'XXXXX', '.XXX.'];
const pawCache = new Map();
export function pawprint(color) {
  if (!pawCache.has(color)) pawCache.set(color, paint(5, 6, set => PAW.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'X') set(x, y, color); }))));
  return pawCache.get(color);
}
