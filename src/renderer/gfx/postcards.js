// 明信片：卡洛斯 12 個地點的像素風景（全部用程式畫，沒有外部圖檔）。
// 同一個地點＋種子每次畫出來都一樣（雲、星星、花的位置由種子決定）。
import { paint } from './pixel.js';

export const W = 64, H = 40;
const K = '#2a2030';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 小工具（都在 set 上面畫）
const tools = set => {
  const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c); };
  const disc = (cx, cy, r, c) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r) set(cx + x, cy + y, c); };
  // 山：底部中心 cx、底 y、高 h
  const mountain = (cx, by, h, c, cap = null) => {
    for (let k = 0; k < h; k++) {
      const half = Math.round(((h - k) / h) * h * 1.1);
      for (let x = -half; x <= half; x++) set(cx + x, by - k, cap && k > h * 0.7 ? cap : c);
    }
  };
  // 天空：上面 a、下面 b，中間用棋盤格混色
  const sky = (a, b, until) => { for (let y = 0; y < until; y++) for (let x = 0; x < W; x++) set(x, y, y < until * 0.45 ? a : y < until * 0.65 ? ((x + y) % 2 ? a : b) : b); };
  const cloud = (x, y, c = '#ffffff') => { rect(x, y, 7, 2, c); rect(x + 2, y - 1, 3, 1, c); };
  return { rect, disc, mountain, sky, cloud };
};

const SCENES = {
  'reflection-cave'(set, t, r) {
    t.rect(0, 0, W, H, '#2c2440');
    for (let i = 0; i < 9; i++) { // 鏡子一樣的水晶
      const x = Math.floor(r() * 58) + 3, h = 6 + Math.floor(r() * 10), y = 36 - h;
      for (let k = 0; k < h; k++) { const w = Math.max(1, Math.round((h - k) / 3)); t.rect(x - (w >> 1), y + k, w, 1, k < 2 ? '#ffffff' : '#9fd8ff'); }
    }
    t.rect(0, 36, W, 4, '#4a3f66');
    for (let i = 0; i < 12; i++) set(Math.floor(r() * W), Math.floor(r() * 30), '#dff4ff'); // 反光
  },
  lumiose(set, t, r) {
    t.sky('#2a2f6a', '#f28a5a', 30);
    // 稜柱塔
    for (let k = 0; k < 26; k++) { const w = Math.max(1, Math.round(k / 4)); t.rect(32 - w, 8 + k, w * 2 + 1, 1, k % 5 === 0 ? '#ffe98a' : '#a8b4c8'); }
    set(32, 7, '#ffe98a');
    for (let i = 0; i < 8; i++) { const x = i * 8 + Math.floor(r() * 3), h = 6 + Math.floor(r() * 7); t.rect(x, 34 - h, 6, h, '#3d3a58'); for (let w = 0; w < 3; w++) set(x + 1 + w * 2, 34 - h + 2, r() < 0.6 ? '#ffe98a' : '#2a2840'); }
    t.rect(0, 34, W, 6, '#555266');
  },
  'fossil-lab'(set, t, r) {
    t.sky('#8fd0ff', '#d8f0ff', 26);
    t.rect(0, 26, W, 14, '#c8a877');
    t.rect(10, 14, 26, 12, '#e8e4dc'); t.rect(10, 13, 26, 1, K); t.rect(14, 18, 4, 8, '#6a8aa8'); t.rect(24, 17, 8, 4, '#9fd8ff');
    // 化石的骨頭
    t.rect(42, 31, 16, 2, '#f6efe0'); for (let i = 0; i < 4; i++) t.rect(44 + i * 4, 28, 1, 6, '#f6efe0'); t.disc(58, 30, 2, '#f6efe0');
    t.cloud(Math.floor(r() * 20) + 40, 6);
  },
  'wish-lake'(set, t, r) {
    t.rect(0, 0, W, 24, '#141a44');
    for (let i = 0; i < 22; i++) set(Math.floor(r() * W), Math.floor(r() * 22), r() < 0.3 ? '#ffe98a' : '#ffffff');
    const sx = 10 + Math.floor(r() * 30); for (let k = 0; k < 7; k++) set(sx + k, 4 + (k >> 1), k === 0 ? '#ffffff' : '#ffe98a'); // 流星
    t.rect(0, 24, W, 16, '#1f3a7a');
    for (let i = 0; i < 14; i++) set(Math.floor(r() * W), 25 + Math.floor(r() * 14), '#8fb8ff'); // 倒影
    t.mountain(8, 24, 6, '#20284a'); t.mountain(56, 24, 8, '#20284a');
  },
  'frost-cavern'(set, t, r) {
    t.sky('#9fc8e8', '#e8f6ff', 28);
    t.mountain(18, 30, 18, '#7890b0', '#ffffff'); t.mountain(46, 30, 14, '#8aa0c0', '#ffffff');
    t.rect(0, 30, W, 10, '#f4fbff');
    for (let i = 0; i < 26; i++) set(Math.floor(r() * W), Math.floor(r() * 30), '#ffffff'); // 雪
  },
  'fog-forest'(set, t, r) {
    t.rect(0, 0, W, H, '#b8c8b4');
    for (let i = 0; i < 9; i++) { const x = 3 + i * 7 + Math.floor(r() * 3), h = 16 + Math.floor(r() * 10); t.rect(x, 36 - h, 2, h, '#4a3a2a'); t.disc(x + 1, 36 - h, 4, i % 2 ? '#3f6a44' : '#4d7a50'); }
    for (let y = 10; y < 34; y += 3) for (let x = 0; x < W; x++) if ((x + y) % 4 === 0) set(x, y, '#dfe8dc'); // 霧
    t.rect(0, 36, W, 4, '#5a6a4a');
  },
  seaside(set, t, r) {
    t.sky('#6ab8ff', '#bfe4ff', 22);
    t.rect(0, 22, W, 10, '#2f7ad8');
    for (let i = 0; i < 10; i++) t.rect(Math.floor(r() * 60), 23 + Math.floor(r() * 8), 3, 1, '#bfe4ff');
    t.rect(0, 32, W, 8, '#f2d9a0');
    for (let i = 0; i < 4; i++) { const x = 36 + i * 7; t.rect(x, 26, 6, 6, i % 2 ? '#f4efe4' : '#ffd8b8'); t.rect(x, 24, 6, 2, '#d85a4a'); } // 房子
    t.disc(12, 8, 4, '#ffe066'); t.cloud(Math.floor(r() * 20) + 22, 5);
  },
  'flower-field'(set, t, r) {
    t.sky('#8fd0ff', '#dff4ff', 20);
    t.mountain(50, 22, 7, '#7ab87a');
    t.rect(0, 20, W, 20, '#6fbf5a');
    const colors = ['#ff6fa5', '#ffe066', '#ffffff', '#b88aff', '#ff9d3a'];
    for (let i = 0; i < 90; i++) { const y = 21 + Math.floor(r() * 18); set(Math.floor(r() * W), y, colors[Math.floor(r() * colors.length)]); }
    t.cloud(Math.floor(r() * 30) + 6, 6);
  },
  desert(set, t, r) {
    t.sky('#f7c46a', '#ffe8b0', 22);
    t.disc(48, 9, 5, '#fff4c8');
    for (let x = 0; x < W; x++) { const h = Math.round(4 + Math.sin(x / 7 + r() * 0.2) * 3); t.rect(x, 22 + h - 4, 1, H, '#e0a860'); }
    for (let x = 0; x < W; x++) { const h = Math.round(Math.sin(x / 5 + 1) * 2); t.rect(x, 31 + h, 1, H, '#c98a48'); }
    t.rect(14, 22, 2, 10, '#4a8a3a'); t.rect(12, 25, 2, 3, '#4a8a3a'); t.rect(16, 24, 2, 3, '#4a8a3a'); // 仙人掌
  },
  tunnel(set, t, r) {
    t.rect(0, 0, W, H, '#3a3440');
    t.disc(32, 26, 13, '#141018'); t.rect(19, 26, 27, 12, '#141018');
    for (let i = 0; i < 6; i++) t.disc(8 + i * 10, 4 + Math.floor(r() * 4), 2, '#4a4454');
    for (let i = 0; i < 5; i++) set(24 + Math.floor(r() * 16), 18 + Math.floor(r() * 16), '#ffe066'); // 發亮的眼睛？
    t.rect(0, 36, W, 4, '#2a2430');
  },
  castle(set, t, r) {
    t.sky('#8fb8ff', '#e8dcff', 28);
    t.rect(16, 14, 32, 16, '#e8e0f0');
    for (const x of [14, 30, 46]) { t.rect(x, 8, 5, 22, '#d4c8e4'); t.rect(x - 1, 6, 7, 2, '#6a5aa8'); set(x + 2, 5, '#6a5aa8'); }
    t.rect(29, 22, 6, 8, '#6a5aa8');
    t.rect(0, 30, W, 10, '#6fbf5a');
    for (let i = 0; i < 12; i++) set(Math.floor(r() * W), 31 + Math.floor(r() * 8), '#ff6fa5');
    t.cloud(Math.floor(r() * 10) + 2, 4);
  },
  arena(set, t, r) {
    t.sky('#6ab8ff', '#bfe4ff', 16);
    t.rect(0, 16, W, 24, '#8a7a9a');
    for (let y = 17; y < 26; y += 2) for (let x = 0; x < W; x++) if (r() < 0.35) set(x, y, ['#ff6fa5', '#ffe066', '#5ab8ff', '#ffffff'][Math.floor(r() * 4)]); // 觀眾
    t.rect(6, 27, 52, 11, '#c8a877'); t.rect(6, 27, 52, 1, '#ffffff'); t.rect(31, 27, 1, 11, '#ffffff'); t.disc(32, 32, 3, '#c8a877');
    for (let x = 32 - 3; x <= 32 + 3; x++) for (let y = 29; y <= 35; y++) if (Math.abs((x - 32) ** 2 + (y - 32) ** 2 - 9) < 3) set(x, y, '#ffffff');
  },
};

const cache = new Map();
export function postcard(place, seed = 1) {
  const key = `${place}|${seed}`;
  if (cache.has(key)) return cache.get(key);
  const img = paint(W + 4, H + 4, set => {
    // 白色的明信片邊框＋深色外框
    for (let y = 0; y < H + 4; y++) for (let x = 0; x < W + 4; x++) set(x, y, x === 0 || y === 0 || x === W + 3 || y === H + 3 ? K : '#fbf7ee');
    const inner = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) set(x + 2, y + 2, c); };
    (SCENES[place] ?? SCENES.seaside)(inner, tools(inner), rng(seed));
  });
  if (cache.size > 80) cache.delete(cache.keys().next().value);
  cache.set(key, img);
  return img;
}

// 旅行中留在桌面上的小紙條
export const note = paint(12, 10, set => {
  for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) set(x, y, x === 0 || y === 0 || x === 11 || y === 9 ? K : '#fff6c8');
  for (const y of [3, 5, 7]) for (let x = 2; x < (y === 7 ? 7 : 10); x++) set(x, y, '#b09a6a');
  set(10, 1, '#e8404a'); set(9, 1, '#e8404a'); set(10, 2, '#e8404a'); // 圖釘
});

// 頭上頂著的小明信片
export const mini = paint(10, 7, set => {
  for (let y = 0; y < 7; y++) for (let x = 0; x < 10; x++) set(x, y, x === 0 || y === 0 || x === 9 || y === 6 ? K : '#fbf7ee');
  for (let x = 2; x < 8; x++) { set(x, 2, '#6ab8ff'); set(x, 3, '#6fbf5a'); }
  set(7, 4, '#e8404a');
});
