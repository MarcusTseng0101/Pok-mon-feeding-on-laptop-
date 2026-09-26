// 秘密基地的像素美術：帳篷、小屋、樹屋、院子的地面、家具（全部用程式畫）
import { paint } from './pixel.js';

const K = '#2a2030';
export const CELL = 16; // 院子一格幾個美術像素

const tools = set => ({
  rect: (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c); },
  box: (x, y, w, h, fill, edge = K) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, i === 0 || j === 0 || i === w - 1 || j === h - 1 ? edge : fill); },
});

// ---------- 住的地方 ----------
export const tent = paint(44, 34, set => {
  const t = tools(set);
  for (let k = 0; k < 30; k++) { // 三角形的布
    const half = Math.round(k * 0.72);
    for (let x = -half; x <= half; x++) set(22 + x, 3 + k, Math.abs(x) === half ? K : x < 0 ? '#e86a5a' : '#f28a7a');
  }
  for (let k = 0; k < 16; k++) { const half = Math.round(k * 0.4); for (let x = -half; x <= half; x++) set(22 + x, 17 + k, Math.abs(x) === half ? K : '#3a2430'); } // 門口
  t.rect(0, 33, 44, 1, K);
  set(22, 1, K); set(22, 2, K); set(23, 1, '#ffe066'); set(24, 1, '#ffe066'); set(24, 2, '#ffe066'); // 小旗子
});

export const hut = paint(48, 40, set => {
  const t = tools(set);
  t.box(6, 16, 36, 24, '#c89a5a');
  for (let y = 18; y < 39; y += 4) t.rect(7, y, 34, 1, '#a87a44'); // 木板
  for (let k = 0; k < 16; k++) { const half = 6 + k * 1.5; for (let x = -half; x <= half; x++) set(24 + Math.round(x), 2 + k, Math.abs(x) >= half - 1 ? K : k % 3 === 0 ? '#6a4a8a' : '#8a6aaa'); } // 屋頂
  t.box(19, 26, 10, 14, '#6a4028'); set(26, 33, '#ffe066'); // 門
  t.box(10, 21, 7, 6, '#bfe8ff'); t.box(31, 21, 7, 6, '#bfe8ff'); // 窗戶
});

export const treehouse = paint(52, 56, set => {
  const t = tools(set);
  t.box(22, 30, 8, 26, '#7a4a28'); // 樹幹
  for (let y = 0; y < 26; y++) for (let x = 0; x < 52; x++) { // 樹冠
    const dx = (x - 26) / 25, dy = (y - 12) / 13;
    if (dx * dx + dy * dy <= 1) set(x, y, dx * dx + dy * dy > 0.86 ? K : (x + y) % 5 === 0 ? '#3f8a44' : '#4fa04f');
  }
  t.box(10, 18, 32, 16, '#c89a5a'); t.box(20, 23, 8, 11, '#6a4028'); t.box(32, 22, 6, 5, '#bfe8ff'); // 小屋
  for (let y = 34; y < 55; y += 3) t.rect(31, y, 6, 1, '#a87a44'); t.rect(31, 34, 1, 22, K); t.rect(36, 34, 1, 22, K); // 梯子
});

export const STRUCTURES = [tent, hut, treehouse];

// ---------- 家具（寬度＝格數×CELL；底部對齊那一格的前緣） ----------
export const FURNITURE_ART = {
  bed: paint(30, 14, set => {
    const t = tools(set);
    t.box(0, 4, 30, 10, '#8a5a3a'); t.box(1, 2, 28, 8, '#ff9ec7'); t.box(2, 2, 8, 5, '#ffffff'); // 床架、被子、枕頭
    for (let x = 12; x < 28; x += 4) t.rect(x, 5, 2, 1, '#ffc8de');
    t.rect(1, 13, 2, 1, K); t.rect(27, 13, 2, 1, K);
  }),
  table: paint(28, 14, set => {
    const t = tools(set);
    t.box(1, 3, 26, 5, '#c89a5a'); t.rect(3, 8, 2, 6, K); t.rect(23, 8, 2, 6, K);
    t.box(9, 0, 5, 4, '#ffffff'); set(11, 1, '#ffb347'); t.box(17, 1, 6, 3, '#ff9ec7'); // 杯子、泡芙
  }),
  rug: paint(30, 12, set => {
    for (let y = 2; y < 12; y++) for (let x = 0; x < 30; x++) set(x, y, x === 0 || y === 2 || x === 29 || y === 11 ? K : (x + y) % 4 < 2 ? '#5ab8ff' : '#8fd0ff');
  }),
  lamp: paint(12, 20, set => {
    const t = tools(set);
    t.box(2, 0, 8, 6, '#ffe98a'); t.rect(5, 6, 2, 12, K); t.box(3, 17, 6, 3, '#6a5a7a');
  }),
  plant: paint(12, 16, set => {
    const t = tools(set);
    for (const [x, y] of [[5, 0], [3, 2], [7, 2], [2, 5], [8, 4], [5, 4], [4, 6], [6, 6]]) t.box(x, y, 3, 3, '#4fa04f', '#2f6a34');
    t.box(3, 10, 6, 6, '#d86a4a');
  }),
  trophy: paint(14, 16, set => {
    const t = tools(set);
    t.box(3, 0, 8, 7, '#ffd84a'); t.rect(1, 1, 2, 1, K); t.rect(1, 2, 1, 3, K); t.rect(2, 4, 1, 1, K); t.rect(11, 1, 2, 1, K); t.rect(12, 2, 1, 3, K); t.rect(11, 4, 1, 1, K); // 杯子和把手
    t.rect(6, 7, 2, 4, '#e8b830'); t.box(3, 11, 8, 5, '#8a6a3a'); set(5, 2, '#fff6c0'); set(5, 3, '#fff6c0');
  }),
};

// 院子的地面（W 格 × H 格），邊緣用棋盤格淡出，看起來不像一個方塊
export function yard(gw, gh, stage) {
  const w = gw * CELL + 8, h = gh * CELL + 6;
  const tint = ['#d8c49a', '#cdb88a', '#c4ae80'][stage] ?? '#d8c49a';
  return paint(w, h, set => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edge >= 3 || (edge >= 1 && (x + y) % 2 === 0) || (edge === 0 && (x + y) % 4 === 0)) set(x, y, (((x * 73856093) ^ (y * 19349663)) >>> 0) % 17 === 0 ? '#b8a070' : tint); // 零散的小石子（不要排成斜線）
    }
  });
}
