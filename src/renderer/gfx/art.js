// 自製像素美術（全部由程式產生，沒有外部圖檔）
import { fromMap, paint, outline, makeCanvas } from './pixel.js';

const K = '#2a2030'; // 共用的深色外框

// ---------- 精靈球 ----------
const BALL_ROWS = [
  '....KKKK....',
  '..KKTTTTKK..',
  '.KATTTTTHAK.',
  '.KAATTTTAAK.',
  'KTTTTKKTTTTK',
  'KKKKKWWKKKKK',
  'KWWWKWWKWWWK',
  'KWWWWKKWWWWK',
  '.KWWWWWWWWK.',
  '.KWWWWWWWGK.',
  '..KKGGGGKK..',
  '....KKKK....',
];
const BALL_PALETTES = {
  poke: { K, T: '#e8404a', A: '#e8404a', H: '#ffc0c0', W: '#f8f4f0', G: '#c4c0c8' },
  great: { K, T: '#3a78e0', A: '#e8404a', H: '#b8d4ff', W: '#f8f4f0', G: '#c4c0c8' },
  ultra: { K, T: '#34303c', A: '#f8c830', H: '#8a8494', W: '#f8f4f0', G: '#c4c0c8' },
};
export const balls = Object.fromEntries(Object.entries(BALL_PALETTES).map(([k, p]) => [k, fromMap(BALL_ROWS, p)]));

// ---------- 寶可夢泡芙 ----------
export const FLAVOR_COLORS = {
  sweet: { F: '#ff9ec7', H: '#ffd4e6', C: '#f7d7a8', c: '#dcae78' },
  mint: { F: '#8fe3c4', H: '#d4fff0', C: '#f3e6c8', c: '#d6bf92' },
  citrus: { F: '#ffd35a', H: '#fff2b8', C: '#f7d7a8', c: '#dcae78' },
  mocha: { F: '#8a5a3c', H: '#c08a66', C: '#e2b98f', c: '#b98a5e' },
  spice: { F: '#ff6b4a', H: '#ffb8a0', C: '#f7d7a8', c: '#dcae78' },
};
const PUFF_ROWS = [
  '....KKKK....',
  '..KKFFFFKK..',
  '.KFHHFFFFFK.',
  '.KFHFFFFFFK.',
  'KFFFFFFFFFFK',
  'KFKFFKFFKFFK',
  'KCKCCKCCKCCK',
  'KCCCCCCCCCCK',
  'KCCCCCCCCCcK',
  '.KCCCCCCCcK.',
  '..KKccccKK..',
  '....KKKK....',
];
function puffCanvas(flavor, tier) {
  const pal = { K, ...FLAVOR_COLORS[flavor], W: '#ffffff', R: '#e83a5a', Y: '#ffe066' };
  const rows = PUFF_ROWS.map(r => r.split(''));
  if (tier !== 'basic') { // 糖霜：白色淋醬
    for (const [x, y] of [[3, 4], [4, 5], [6, 4], [7, 3], [9, 4], [8, 5]]) rows[y][x] = 'W';
  }
  let extraTop = 0;
  const out = rows.map(r => r.join(''));
  if (tier === 'fancy' || tier === 'deluxe') { // 頂端的莓果
    extraTop = 3;
    out.unshift('.....KK.....', '....KRRK....', '....KRWK....');
  }
  let c = fromMap(out, pal);
  if (tier === 'deluxe') { // 金色閃光
    const d = makeCanvas(c.width + 4, c.height);
    const ctx = d.getContext('2d');
    ctx.drawImage(c, 2, 0);
    const star = fromMap(['.Y.', 'YWY', '.Y.'], pal);
    ctx.drawImage(star, 0, extraTop + 1);
    ctx.drawImage(star, c.width + 1, extraTop + 5);
    c = d;
  }
  return c;
}
const puffCache = new Map();
export function puff(key) {
  if (!puffCache.has(key)) {
    const [flavor, tier] = key.split('-');
    puffCache.set(key, puffCanvas(flavor, tier));
  }
  return puffCache.get(key);
}
// 被咬掉 n 口的泡芙（0–3）
export function bittenPuff(key, bites) {
  const src = puff(key);
  if (!bites) return src;
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  const r = Math.ceil(src.width * 0.28);
  const spots = [[src.width, 2], [0, src.height * 0.4], [src.width * 0.6, src.height]];
  for (let i = 0; i < Math.min(bites, 3); i++) {
    ctx.beginPath();
    ctx.arc(spots[i][0], spots[i][1], r + i, 0, Math.PI * 2);
    ctx.fill();
  }
  if (bites >= 3) ctx.clearRect(0, 0, c.width, c.height);
  return c;
}

// ---------- 心 ----------
export const heart = fromMap([
  '.KK.KK.',
  'KPWKPPK',
  'KPPPPPK',
  '.KPPPK.',
  '..KPK..',
  '...K...',
], { K, P: '#ff5d8f', W: '#ffd0e0' });
export const heartSmall = fromMap(['P.P', 'PPP', '.P.'], { P: '#ff5d8f' });

// ---------- 表情符號（頭上冒出的小圖） ----------
const EMOTE_PAL = { K, W: '#ffffff', Y: '#ffe066', B: '#8ab8ff', P: '#ff7eb6', G: '#b0b0c0' };
export const emotes = {
  '!': fromMap(['.KKK.', '.KWK.', '.KWK.', '.KWK.', '.KKK.', '.KWK.', '.KKK.'], EMOTE_PAL),
  '?': fromMap(['KKKKK', 'KWWWK', 'KKKWK', '.KWWK', '.KKK.', '.KWK.', '.KKK.'], EMOTE_PAL),
  '♪': fromMap(['..KKK', '..KYK', '..KYK', '..KYK', 'KKKYK', 'KYYYK', 'KKKKK'], EMOTE_PAL),
  '…': fromMap(['.........', 'KKK.KKK.KKK', 'KWK.KWK.KWK', 'KKK.KKK.KKK'], EMOTE_PAL),
  Z: fromMap(['KKKKK', 'KBBBK', 'KKKBK', '.KBK.', 'KBKKK', 'KBBBK', 'KKKKK'], EMOTE_PAL),
  '✦': fromMap(['..K..', '.KYK.', 'KYWYK', '.KYK.', '..K..'], EMOTE_PAL),
  '♥': heart,
  '💢': fromMap(['K.K.K', '.KRK.', 'KRKRK', '.KRK.', 'K.K.K'], { K, R: '#ff4040' }),
  '@': fromMap(['.KKK.', 'KGGGK', 'KGKGK', 'KGGKK', '.KKGK'], EMOTE_PAL),
};

export const sparkle = fromMap(['..W..', '..W..', 'WWYWW', '..W..', '..W..'], { W: '#ffffff', Y: '#ffe066' });
export const star = fromMap(['..Y..', '.YYY.', 'YYWYY', '.YYY.', '.Y.Y.'], { Y: '#ffd84a', W: '#fff6c0' });
export const dizzyStar = fromMap(['.Y.', 'YWY', '.Y.'], { Y: '#ffd84a', W: '#fff6c0' });

// ---------- 氣息點 ----------
// 草叢：每一片葉子是一根柱子，頂端三格會隨 sway 左右晃
export function grass(frame, rustle) {
  const blades = [[1, 7], [3, 11], [5, 8], [7, 14], [9, 10], [11, 13], [13, 9], [15, 12], [17, 15], [19, 10], [21, 12], [23, 8], [25, 11], [27, 7]];
  return paint(30, 17, set => {
    blades.forEach(([bx, bh], i) => {
      const sway = rustle ? Math.round(Math.sin(frame * 1.7 + i * 1.3) * 1.4) : (frame + i) % 5 === 0 ? 1 : 0;
      for (let k = 0; k < bh; k++) {
        const y = 16 - k;
        const x = bx + (k >= bh - 3 ? sway : 0);
        set(x - 1, y, K);
        set(x + 1, y, K);
        set(x, y, k < 3 ? '#2f7a3a' : k >= bh - 3 ? '#9be36a' : '#4db35a');
      }
      set(bx + sway, 16 - bh, K);
    });
    for (let x = 0; x < 30; x++) { set(x, 16, '#2f7a3a'); set(x, 15, x % 3 ? '#3c9446' : '#2f7a3a'); }
  });
}

export function puddle(t) {
  const W = 40, H = 11;
  return paint(W, H, set => {
    const cx = W / 2 - 0.5, cy = H / 2 - 0.5;
    const ripple = (t * 0.6) % 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot((x - cx) / (W / 2), (y - cy) / (H / 2));
      if (d > 1) continue;
      let col = d > 0.86 ? '#26467c' : y < cy - 1 ? '#5aa0f0' : '#4a8ee0';
      if (Math.abs(d - ripple) < 0.08) col = '#d6efff';
      if (Math.abs(d - ((ripple + 0.5) % 1)) < 0.06) col = '#9ccfff';
      set(x, y, col);
    }
    set(cx - 8, cy - 2, '#ffffff'); set(cx - 7, cy - 2, '#ffffff');
  });
}

export function rock(t) {
  const W = 24, H = 14;
  const base = paint(W, H, set => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot((x - W / 2 + 0.5) / (W / 2), (y - H + 0.5) / H);
      if (d > 1) continue;
      const edge = d > 0.9;
      const light = x < W * 0.35 && y < H * 0.6;
      const dark = x > W * 0.62;
      set(x, y, edge ? K : light ? '#d8d4e4' : dark ? '#7c7494' : '#a8a2bc');
    }
    for (const [x, y] of [[9, 7], [10, 8], [15, 10], [16, 9]]) set(x, y, '#7c7494');
  });
  const c = makeCanvas(W + 6, H + 6);
  const ctx = c.getContext('2d');
  ctx.drawImage(base, 3, 6);
  const phase = Math.floor(t * 3) % 4;
  const spots = [[3, 4], [17, 1], [11, 0], [22, 7]];
  const [sx, sy] = spots[phase];
  ctx.drawImage(fromMap(['..W..', '..W..', 'WWYWW', '..W..', '..W..'], { W: '#ffffff', Y: '#fff6a0' }), sx, sy);
  return c;
}

export function wisp(t) {
  const W = 12, H = 16;
  return paint(W, H, set => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      // 水滴形火焰：下圓上尖，尖端隨時間擺動
      const ny = y / H;
      const sway = Math.sin(t * 6 + ny * 4) * (1 - ny) * 2;
      const half = ny < 0.45 ? ny * 10 : Math.sqrt(1 - Math.pow((ny - 0.62) / 0.4, 2)) * 5.5;
      const dx = Math.abs(x - W / 2 + 0.5 - sway);
      if (!(half > 0) || dx > half) continue;
      const inner = dx < half - 2 && ny > 0.35;
      const core = dx < half - 3.5 && ny > 0.55;
      set(x, y, core ? '#ffffff' : inner ? '#c89aff' : dx > half - 1 ? '#3a1a4a' : '#8a4ae0');
    }
  });
}

export function bird(t) {
  const f = Math.floor(t * 5) % 2;
  return fromMap(f ? [
    'K.........K', '.K.......K.', '..K.KKK.K..', '...KKKKK...',
  ] : [
    '...........', 'KK.......KK', '..KKKKKKK..', '....KKK....',
  ], { K: '#1a1a2acc' });
}

export function ring(t) {
  const N = 28, c = N / 2 - 0.5;
  return paint(N, N, set => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - c, y - c);
      const a = Math.atan2(y - c, x - c);
      if (d >= 10 && d < 13.6) set(x, y, d > 12.8 || d < 10.6 ? '#6a4a10' : (Math.sin(a * 3 + t * 4) > 0.6 ? '#fff0a0' : '#e8b830'));
      else if (d < 10) set(x, y, Math.sin(d * 1.2 - t * 5 + a) > 0 ? '#5a2a8a' : '#2a1040');
    }
  });
}

export function zygardeCell(t) {
  const blink = Math.floor(t * 2) % 3 === 0;
  return fromMap([
    '..KKK..',
    '.KGGGK.',
    'KGLGGGK',
    'KGG' + (blink ? 'W' : 'R') + 'GGK',
    'KGGGGGK',
    '.KGGGK.',
    '..KKK..',
  ], { K: '#0e3a1a', G: '#3ad06a', L: '#a8ffc0', R: '#e83a3a', W: '#ffffff' });
}

// ---------- 備用寶可夢圖（下載失敗或離線時） ----------
export const TYPE_COLORS = {
  normal: '#a8a878', fire: '#f08030', water: '#6890f0', grass: '#78c850', electric: '#f8d030', ice: '#98d8d8',
  fighting: '#c03028', poison: '#a040a0', ground: '#e0c068', flying: '#a890f0', psychic: '#f85888', bug: '#a8b820',
  rock: '#b8a038', ghost: '#705898', dragon: '#7038f8', dark: '#705848', steel: '#b8b8d0', fairy: '#ee99ac',
};
export function fallbackSprite(types, seed = 1) {
  const main = TYPE_COLORS[types[0]] ?? '#a8a878';
  const sub = TYPE_COLORS[types[1]] ?? main;
  const w = 24 + (seed % 3) * 4, h = 22 + (seed % 4) * 3;
  return outline(paint(w, h, set => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot((x - w / 2 + 0.5) / (w / 2), (y - h / 2 - 1) / (h / 2));
      if (d <= 0.95) set(x, y, y > h * 0.62 ? sub : main);
    }
    const ey = Math.floor(h * 0.42), ex = Math.floor(w * 0.32);
    for (const x of [ex, w - ex - 2]) { set(x, ey, K); set(x + 1, ey, K); set(x, ey + 1, K); set(x + 1, ey + 1, K); set(x, ey, '#ffffff'); }
    for (const x of [w * 0.28, w * 0.62]) for (let k = 0; k < 3; k++) set(x + k, h - 1, K);
  }));
}

// ---------- 習性動作用的小道具 ----------
export const twig = fromMap(['......KK', '..KKKKBK', 'KKBBBBK.', 'KBBKK...', '.KK.....'], { K, B: '#9a6a3a' });
export const leaf = fromMap(['..KK', '.KGK', 'KGGK', 'KGK.', '.K..'], { K: '#1e4a1e', G: '#6ac84a' });
export const key = fromMap(['.KKK....', 'KY.YKKKK', 'KY.YYYYK', '.KKKK.KK'], { K: '#6a5a20', Y: '#f8d850' });
export const diamond = fromMap(['.KKK.', 'KWLLK', 'KLLLK', '.KLK.', '..K..'], { K: '#3a6a9a', W: '#ffffff', L: '#bfe8ff' });
const FLOWER_COLORS = ['#ff5d8f', '#ffd84a', '#ffffff', '#7ab8ff', '#ff9d3a'];
export const flowers = FLOWER_COLORS.map(c => fromMap(['.P.P.', 'PPYPP', '.PPP.', '..G..', '.GG..'], { P: c, Y: c === '#ffd84a' ? '#ff9d3a' : '#ffd84a', G: '#4a9a3a' }));

// ---------- 小遊戲 ----------
// 樹果（顏色依原作：桃桃果粉紅、零餘果紫、利木果黃、莓莓果藍綠、櫻子果紅）
export const BERRY_COLORS = {
  pecha: { B: '#ff9ec7', H: '#ffd6e8', D: '#d86a9a' },
  chesto: { B: '#7a5cd6', H: '#b8a4ff', D: '#4c3aa0' },
  aspear: { B: '#ffd84a', H: '#fff2b0', D: '#d8a820' },
  rawst: { B: '#4ac0a8', H: '#a8f0e0', D: '#2a8a78' },
  cheri: { B: '#e8404a', H: '#ffa8a8', D: '#a82030' },
};
const BERRY_ROWS = [
  '...GG...',
  '..KGGK..',
  '.KBBBBK.',
  'KBHHBBBK',
  'KBHBBBBK',
  'KBBBBBDK',
  '.KBBBDK.',
  '..KKKK..',
];
export const berries = Object.fromEntries(Object.entries(BERRY_COLORS).map(([k, p]) => [k, fromMap(BERRY_ROWS, { K, G: '#4a9a3a', ...p })]));

// 樹果樹：shake 讓樹葉晃一下（0–1）
export function berryTree(shake = 0) {
  const w = 44, h = 56;
  return paint(w, h, set => {
    const dx = Math.round(Math.sin(shake * Math.PI * 4) * 2 * shake);
    // 樹幹
    for (let y = 30; y < h; y++) for (let x = 19; x < 25; x++) set(x, y, x === 19 || x === 24 ? K : y % 5 === 0 ? '#7a4a24' : '#9a6a3a');
    for (let x = 16; x < 28; x++) set(x, h - 1, K);
    // 樹冠：幾個圓疊在一起
    const blobs = [[22, 16, 15], [11, 22, 10], [33, 22, 10], [22, 26, 11]];
    const inside = (x, y) => blobs.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
    for (let y = 0; y < 38; y++) for (let x = 0; x < w; x++) {
      const sx = x - dx;
      if (!inside(sx, y)) continue;
      const edge = !inside(sx - 1, y) || !inside(sx + 1, y) || !inside(sx, y - 1) || !inside(sx, y + 1);
      const light = (sx + y) % 7 === 0 || (sx * 3 + y * 5) % 11 === 0;
      set(x, y, edge ? '#1e4a1e' : light ? '#8adc6a' : y < 14 ? '#6ac84a' : '#4aa83a');
    }
  });
}

// 氣球（超級特訓）：顏色依能力
export const STAT_COLORS = { hp: '#6fdc6f', atk: '#ff6b4a', def: '#ffd84a', spa: '#5ab8ff', spd: '#b88aff', spe: '#ff9ec7' };
export const balloons = Object.fromEntries(Object.entries(STAT_COLORS).map(([k, c]) => [k, fromMap([
  '..KKKK..',
  '.KBBBBK.',
  'KBWBBBBK',
  'KBWBBBBK',
  'KBBBBBBK',
  '.KBBBBK.',
  '..KBBK..',
  '...KK...',
  '....K...',
  '...K....',
  '....K...',
], { K, B: c, W: '#ffffff' })]));

// 頭球用的球
export const playBall = fromMap([
  '..KKKK..',
  '.KWWRWK.',
  'KWRRRWWK',
  'KWWRWWRK',
  'KRWWWRRK',
  'KWWRWWWK',
  '.KWWWWK.',
  '..KKKK..',
], { K, W: '#f8f4f0', R: '#3a78e0' });

// 蛋：底色＋屬性顏色的斑點；cracks 0–3 是裂痕
export function egg(spot = '#7ac86a', cracks = 0) {
  const rows = [
    '....KKKK....',
    '...KWWWWK...',
    '..KWWWSSWK..',
    '.KWWWWSSWWK.',
    '.KWSSWWWWWK.',
    'KWWSSWWWWWWK',
    'KWWWWWWSSWWK',
    'KWWWWWWSSWWK',
    'KWSSWWWWWWDK',
    'KWSSWWWWWWDK',
    '.KWWWWWWWDK.',
    '.KWWWWWWDDK.',
    '..KKDDDDKK..',
    '....KKKK....',
  ].map(r => r.split(''));
  const CR = [[[5, 3], [6, 4], [5, 5]], [[6, 6], [7, 7], [6, 8], [7, 9]], [[3, 7], [4, 8], [3, 9], [8, 4], [9, 5]]];
  for (let i = 0; i < Math.min(3, cracks); i++) for (const [x, y] of CR[i]) rows[y][x] = 'K';
  return fromMap(rows.map(r => r.join('')), { K, W: '#fbf6ea', D: '#e0d6c0', S: spot });
}
