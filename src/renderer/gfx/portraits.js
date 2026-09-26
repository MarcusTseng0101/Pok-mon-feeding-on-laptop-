// 故事裡的人的圖：先試 Showdown 的訓練家圖（依序試 CAST 裡列的檔名），拿不到就用手繪的圖（gfx/trainerart.js），
// 都沒有才用剪影。
import { makeCanvas, paint } from './pixel.js';
import { drawnTrainer } from './trainerart.js';
import { CAST } from '../../core/story.js';

// 半身剪影（24×24）：頭、肩膀，用角色的顏色
const BUST = [
  '........OOOOOOO.........',
  '.......OCCCCCCCO........',
  '......OCCCCCCCCCO.......',
  '......OCCCCCCCCCO.......',
  '......OCCCCCCCCCO.......',
  '......OCCCCCCCCCO.......',
  '.......OCCCCCCCO........',
  '........OCCCCCO.........',
  '.........OCCCO..........',
  '.....OOOOOCCCOOOOO......',
  '...OOCCCCCCCCCCCCCOO....',
  '..OCCCCCCCCCCCCCCCCCO...',
  '.OCCCCCCCCCCCCCCCCCCCO..',
  '.OCCCCCCCCCCCCCCCCCCCO..',
  'OCCCCCCCCCCCCCCCCCCCCCO.',
  'OCCCCCCCCCCCCCCCCCCCCCO.',
  'OCCCCCCCCCCCCCCCCCCCCCO.',
];
const silhouettes = new Map();
export function silhouette(who) {
  if (!silhouettes.has(who)) {
    const color = CAST[who]?.color ?? '#8a86a0';
    silhouettes.set(who, paint(24, BUST.length, set => BUST.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'O') set(x, y, '#1a1628'); else if (c === 'C') set(x, y, color); }))));
  }
  return silhouettes.get(who);
}

// 全身剪影（來拜訪的人拿不到圖時用）：高高瘦瘦的一個人，tall＝特別高（AZ 有三公尺）
const figures = new Map();
export function figure(who, tall = who === 'az') {
  const key = `${who}${tall}`;
  if (!figures.has(key)) {
    const color = CAST[who]?.color ?? '#8a86a0', h = tall ? 46 : 34, w = 14;
    figures.set(key, paint(w, h, set => {
      const fill = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, color); };
      fill(5, 0, 8, 3); // 頭
      fill(4, 1, 9, 2);
      fill(3, 5, 10, Math.round(h * 0.62)); // 身體（長大衣）
      fill(2, 6, 11, Math.round(h * 0.45)); // 肩膀、手
      fill(4, Math.round(h * 0.62), 6, h - 1); // 腳
      fill(7, Math.round(h * 0.62), 9, h - 1);
    }));
  }
  return figures.get(key);
}

function loadImage(src) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
}
function crop(img) {
  const c = makeCanvas(img.width, img.height), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (data[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const out = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export class Portraits {
  constructor(api) { this.api = api; this.cache = new Map(); }
  // 同步：拿到了就回傳圖，不然回傳剪影（並開始載入）
  peek(who) {
    const e = this.get(who) && this.cache.get(who);
    return e.canvas ?? drawnTrainer(who) ?? silhouette(who);
  }
  // 站著的樣子（來拜訪的人）：拿到訓練家圖就用它，不然用全身剪影
  peekFigure(who) {
    const e = this.cache.get(who);
    return e?.real ? e.canvas : drawnTrainer(who) ?? figure(who);
  }
  // { canvas, real }：real＝真的訓練家圖（不是剪影）
  get(who) {
    if (!this.cache.has(who)) {
      const entry = { canvas: null, real: false };
      entry.promise = (async () => {
        for (const name of CAST[who]?.sprites ?? []) {
          try {
            const url = await this.api.getTrainerSprite?.(name);
            if (!url) continue;
            const c = crop(await loadImage(url));
            if (c) { entry.canvas = c; entry.real = true; return entry; }
          } catch { /* 下一個 */ }
        }
        const drawn = drawnTrainer(who);
        if (drawn) { entry.canvas = drawn; entry.real = true; return entry; }
        entry.canvas = silhouette(who);
        return entry;
      })();
      this.cache.set(who, entry);
    }
    return this.cache.get(who).promise;
  }
}
