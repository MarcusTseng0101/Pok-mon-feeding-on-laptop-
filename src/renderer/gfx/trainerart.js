// 手繪的訓練家圖：Showdown／Smogon 沒有圖的人（博士、莎娜、特雷維、弗拉達利、查克洛、卡露乃、帥哥、閃焰隊手下）。
// 跟 Showdown 的訓練家圖一樣是站著的全身像（36×76 美術像素），用幾個形狀拼出來，再自動加外框和右側陰影。
import { paint } from './pixel.js';

const W = 36, H = 76, CX = 18;
const INK = '#1a1628';

// 每個人：皮膚、頭髮（樣式＋顏色）、衣服、褲子（或裙子）、鞋子、配件
const SPECS = {
  sycamore: { skin: '#f4c8a0', hair: ['wavy', '#2a3050'], coat: '#f4f4f8', shirt: '#6aa0e0', pants: '#2a3050', shoes: '#6a4a30', stubble: true },
  shauna: { skin: '#f8d0b0', hair: ['pigtails', '#c8602a'], top: '#ff7eb0', skirt: '#ffffff', legs: 'skin', shoes: '#ff5a90', short: true },
  trevor: { skin: '#f8d0b0', hair: ['bowl', '#e0782a'], top: '#5ab04a', shorts: '#8a6a40', legs: 'skin', shoes: '#4a4a58', short: true },
  lysandre: { skin: '#f0c098', hair: ['mane', '#e8402a'], top: '#24222c', shirt: '#3a3844', pants: '#24222c', shoes: '#101018', beard: true, tall: true },
  grant: { skin: '#9a6a44', hair: ['short', '#3a2a20'], top: '#d8b060', pants: '#6a4a2a', shoes: '#3a2a20', vest: '#8a5a2a' },
  diantha: { skin: '#f8dcc4', hair: ['bob', '#22202c'], dress: '#fbfbff', sash: '#ff8ab0', shoes: '#ffffff', long: true },
  looker: { skin: '#f0c8a0', hair: ['short', '#1a1a24'], coat: '#c8a878', shirt: '#e8e0d0', pants: '#4a4a58', shoes: '#2a2020', belt: '#8a6a40' },
  grunt: { skin: '#f4c8a0', hair: ['spiky', '#ff7a2a'], top: '#e8402a', pants: '#e8402a', shoes: '#202028', visor: '#2a2a40', trim: '#ffffff' },
};

function shade(hexColor, k) {
  const n = parseInt(hexColor.slice(1), 16);
  const ch = s => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return `#${[16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

function draw(spec) {
  const g = Array.from({ length: H }, () => Array(W).fill(null));
  const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H) g[y][x] = c; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, c); };
  const ellipse = (cx, cy, rx, ry, c) => { for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) put(x, y, c); };
  // 上下兩條邊的左右端點之間線性內插（梯形）
  const trap = (y0, y1, l0, r0, l1, r1, c) => { for (let y = y0; y <= y1; y++) { const k = y1 === y0 ? 0 : (y - y0) / (y1 - y0); rect(Math.round(l0 + (l1 - l0) * k), y, Math.round(r0 + (r1 - r0) * k), y, c); } };

  const skin = spec.skin, [style, hair] = spec.hair;
  const top = spec.top ?? spec.shirt ?? '#888888';
  const legsC = spec.legs === 'skin' ? skin : spec.pants ?? skin;
  const up = spec.tall ? -2 : 0; // 弗拉達利比較高：頭和上半身往上

  // 頭髮後面的部分（先畫，被臉蓋住）
  if (style === 'mane') { ellipse(CX, 11 + up, 11, 10, hair); for (let i = 0; i < 7; i++) { const a = Math.PI * (0.95 + i * 0.18); ellipse(CX + Math.cos(a) * 11, 10 + up + Math.sin(a) * 9, 2.2, 2.2, hair); } }
  if (style === 'pigtails') { ellipse(8, 14, 3, 4.5, hair); ellipse(28, 14, 3, 4.5, hair); rect(8, 16, 9, 20, hair); rect(27, 16, 28, 20, hair); }
  if (style === 'bob') { trap(8, 20, 11, 25, 10, 26, hair); ellipse(11, 4, 3, 3, hair); ellipse(25, 4, 3, 3, hair); }
  if (style === 'wavy') trap(8, 17, 11, 25, 10, 26, hair);

  // 腳、鞋子
  const legTop = spec.dress ? 60 : 44;
  rect(13, legTop, 16, 68, legsC);
  rect(20, legTop, 23, 68, legsC);
  rect(12, 69, 16, 71, spec.shoes);
  rect(20, 69, 24, 71, spec.shoes);
  // 短褲／裙子／長褲的上半
  if (spec.shorts) trap(38, 50, 13, 23, 12, 24, spec.shorts);
  else if (spec.skirt) trap(37, 48, 13, 23, 10, 26, spec.skirt);
  else if (spec.pants) trap(38, 46, 13, 23, 13, 23, spec.pants);
  // 身體
  const sy = 19 + up;
  if (spec.dress) {
    trap(sy, 37, 12, 24, 13, 23, spec.dress); // 上身
    trap(37, 68, 13, 23, 7, 29, spec.dress); // 長裙
    rect(13, 36, 23, 37, spec.sash);
    trap(38, 44, 17, 19, 15, 21, spec.sash); // 腰帶垂下來
  } else {
    trap(sy, 38, 11, 25, 13, 23, top);
    if (spec.vest) { trap(sy + 1, 36, 11, 14, 13, 15, spec.vest); trap(sy + 1, 36, 22, 25, 21, 23, spec.vest); }
    if (spec.beard) { trap(sy + 1, sy + 8, 15, 21, 17, 19, spec.shirt); rect(18, sy + 3, 18, sy + 9, '#c83020'); } // 西裝的領口、紅領巾
    if (spec.trim) { rect(17, sy + 2, 19, 38, spec.trim); rect(13, 37, 23, 37, spec.trim); }
  }
  // 長外套（博士的白袍、帥哥的風衣）：前面開著露出襯衫
  if (spec.coat) {
    trap(sy, 58, 10, 26, 8, 28, spec.coat);
    trap(sy + 1, 40, 16, 20, 17, 19, spec.shirt);
    if (spec.belt) rect(10, 38, 26, 39, spec.belt);
    rect(17, 41, 19, 58, spec.pants); // 外套下擺中間的縫
  }
  // 手（外套的人袖子也是外套色）
  const sleeve = spec.coat ?? (spec.dress ? skin : spec.short ? skin : top);
  trap(sy + 1, 38, 8, 10, 8, 10, sleeve);
  trap(sy + 1, 38, 26, 28, 26, 28, sleeve);
  if (spec.short) { trap(sy + 1, sy + 5, 8, 10, 8, 10, top); trap(sy + 1, sy + 5, 26, 28, 26, 28, top); }
  // 手臂和身體之間的一條暗線（不然會黏成一塊）
  for (let y = sy + 4; y <= 37; y++) { const l = g[y][10], r = g[y][26]; if (l) put(10, y, shade(l, 0.72)); if (r) put(26, y, shade(r, 0.72)); }
  ellipse(9, 40, 1.6, 1.8, skin);
  ellipse(27, 40, 1.6, 1.8, skin);
  // 脖子、頭
  rect(16, 16 + up, 20, 19 + up, skin);
  ellipse(CX, 11 + up, 5.5, 6.5, skin);
  // 臉
  const ey = 12 + up;
  rect(15, ey, 15, ey + 1, INK);
  rect(21, ey, 21, ey + 1, INK);
  put(18, ey + 4, shade(skin, 0.75));
  if (spec.stubble) rect(16, ey + 5, 20, ey + 5, shade(skin, 0.82));
  if (spec.beard) { trap(ey + 3, ey + 8, 12, 24, 15, 21, hair); rect(17, ey + 4, 19, ey + 4, shade(skin, 0.7)); }
  if (spec.visor) { rect(13, ey - 1, 23, ey + 1, spec.visor); rect(14, ey - 1, 16, ey - 1, '#ff5a3a'); }
  // 前面的頭髮
  switch (style) {
    case 'wavy': trap(4, 8, 13, 23, 12, 24, hair); ellipse(CX, 6, 6.5, 3.5, hair); put(14, 9, hair); put(22, 9, hair); break;
    case 'pigtails': case 'bowl': ellipse(CX, 7, 6.5, 4.5, hair); rect(12, 7, 24, 9, hair); if (style === 'bowl') { rect(12, 10, 13, 13, hair); rect(23, 10, 24, 13, hair); } break;
    case 'mane': ellipse(CX, 5 + up, 7, 3.5, hair); put(13, 9 + up, hair); put(23, 9 + up, hair); break;
    case 'short': ellipse(CX, 6, 6, 3.5, hair); rect(12, 6, 13, 10, hair); rect(23, 6, 24, 10, hair); break;
    case 'bob': ellipse(CX, 6, 7, 4, hair); rect(11, 7, 13, 17, hair); rect(23, 7, 25, 17, hair); rect(14, 7, 17, 8, hair); break;
    case 'spiky': ellipse(CX, 6, 6.5, 4, hair); for (let i = 0; i < 5; i++) { put(12 + i * 3, 1, hair); rect(12 + i * 3, 2, 13 + i * 3, 3, hair); } break;
  }

  // 陰影：右邊緣（光從左邊來）暗一點
  const shaded = g.map((row, y) => row.map((c, x) => (c && (x === W - 1 || !row[x + 1] || (row[x + 1] !== c && x > CX + 3)) && c !== INK ? shade(c, 0.78) : c)));
  return paint(W, H, set => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = shaded[y][x];
      if (c) { set(x, y, c); continue; }
      // 外框：旁邊有東西的透明格
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx]);
      if (near) set(x, y, INK);
    }
  });
}

const cache = new Map();
// 有手繪的圖就回傳 canvas，沒有回傳 null
export function drawnTrainer(who) {
  if (!SPECS[who]) return null;
  if (!cache.has(who)) cache.set(who, draw(SPECS[who]));
  return cache.get(who);
}
export const DRAWN = Object.keys(SPECS);
