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

// 桌面上的小信箱（常駐）：有沒看的信就把紅旗子立起來、信封從投信口露出來
function mailboxArt(unread) {
  const W = 16, H = 22;
  const BOX = '#6aa8e8', BOX_D = '#3f76b8', POST = '#8a5a3a', POST_D = '#5e3a24', FLAG = '#ff4d5e';
  return paint(W, H, set => {
    // 柱子
    for (let y = 12; y < H; y++) { set(6, y, K); set(9, y, K); set(7, y, POST); set(8, y, POST_D); }
    for (let x = 4; x < 12; x++) set(x, H - 1, K);
    // 箱子（上面是圓的）
    for (let y = 2; y < 13; y++) for (let x = 1; x < 13; x++) {
      const corner = y === 2 && (x < 3 || x > 10);
      if (corner) continue;
      const edge = x === 1 || x === 12 || y === 12 || (y === 2) || (y === 3 && (x === 2 || x === 11));
      set(x, y, edge ? K : x > 9 ? BOX_D : BOX);
    }
    set(2, 3, K); set(11, 3, K);
    // 投信口
    for (let x = 3; x < 10; x++) set(x, 7, K);
    if (unread) {
      // 露出來的信封
      for (let x = 4; x < 9; x++) { set(x, 5, K); set(x, 6, '#fbf7ee'); }
      set(3, 6, K); set(9, 6, K); set(6, 6, '#ff6fa5');
    }
    // 旗子：有信立起來，沒信放平
    if (unread) {
      for (let y = 1; y < 9; y++) set(13, y, K);
      for (let y = 1; y < 4; y++) for (let x = 14; x < 16; x++) set(x, y, FLAG);
    } else {
      for (let x = 13; x < 16; x++) set(x, 9, K);
      set(15, 8, FLAG); set(15, 10, FLAG);
    }
  });
}
export const mailbox = { empty: mailboxArt(false), full: mailboxArt(true) };
