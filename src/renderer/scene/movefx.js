// 招式的演出（照原作 X・Y 的做法重做；參考 Pokémon Showdown 的招式動畫手法，沒有複製它的程式或圖片）：
//   1. 放招時背景會變：兩隻周圍的桌面局部變暗（流星群還會出現星空）
//   2. 特效是「柔邊光團」疊出來的：用「變亮」疊加，重疊的地方越疊越亮
//   3. 同一個東西錯開時間放好幾個（光束上的光團、脈衝環、流星）
//   4. 打到的瞬間爆開：光團放大 3 倍並淡出，加上打擊火花、衝擊波、頓一下、震一下
// 只有畫面，沒有規則。設定「減少閃光和畫面震動」打開時：變暗和光都比較淡、不震動。
// 座標都是裝置像素；S 是一個美術像素的大小。
import { blit, makeCanvas } from '../gfx/pixel.js';
import * as art from '../gfx/art.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp01 = v => Math.max(0, Math.min(1, v));
const lerp = (a, b, k) => a + (b - a) * k;
export const easeIn = k => k * k;
export const easeOut = k => 1 - (1 - k) * (1 - k);

// 屬性的主色、亮色、第三色
export const TYPE_FX = {
  normal: ['#e8e0c8', '#ffffff', '#fff6c0'], fire: ['#ff6a2a', '#ffd25a', '#ff3a1a'], water: ['#3a86ff', '#9fd4ff', '#ffffff'],
  grass: ['#4ab04a', '#b8f08a', '#fff6a0'], electric: ['#ffd84a', '#fffbd0', '#8fd0ff'], ice: ['#7ad0ff', '#e8fbff', '#b0a0ff'],
  fighting: ['#e05a3a', '#ffe066', '#ffffff'], poison: ['#a040c0', '#e0a0f0', '#6a2a8a'], ground: ['#c08a4a', '#f0d8a0', '#8a6030'],
  flying: ['#98b0ff', '#ffffff', '#d0dcff'], psychic: ['#ff4d9e', '#ffc8e4', '#c070ff'], bug: ['#a8c020', '#eaf590', '#ffffff'],
  rock: ['#c0a040', '#f0e0a0', '#8a7428'], ghost: ['#7050b0', '#d0b8ff', '#3a2a6a'], dragon: ['#6a40ff', '#b8a0ff', '#58b4ff'],
  dark: ['#6a4a4a', '#e0c8b8', '#2a1a1a'], steel: ['#b8c0d8', '#ffffff', '#8898c0'], fairy: ['#ff8ec7', '#ffffff', '#ffd0e8'],
};

const calm = stage => Boolean(stage.calmFx);

// ---------- 材質（柔邊光團），依顏色快取 ----------
const TEX = new Map();
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
export function glowTex(hex) {
  const key = `g${hex}`;
  if (!TEX.has(key)) {
    const c = makeCanvas(64, 64), g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.2, rgba(hex, 1));
    gr.addColorStop(0.5, rgba(hex, 0.35));
    gr.addColorStop(1, rgba(hex, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    TEX.set(key, c);
  }
  return TEX.get(key);
}
// 不規則的光團（像煙、像火焰的一團）
export function wispTex(hex, seed = 0) {
  const key = `w${hex}${seed % 6}`;
  if (!TEX.has(key)) {
    const c = makeCanvas(64, 64), g = c.getContext('2d');
    let s = (seed % 6) * 97 + 13;
    const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const x = 32 + (r() - 0.5) * 26, y = 32 + (r() - 0.5) * 26, rad = 9 + r() * 13;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, rgba(hex, 0.55));
      gr.addColorStop(1, rgba(hex, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
    }
    TEX.set(key, c);
  }
  return TEX.get(key);
}

function stamp(ctx, tex, x, y, size, alpha) {
  if (alpha <= 0.01 || size < 1) return;
  const a = ctx.globalAlpha;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(tex, x - size / 2, y - size / 2, size, size);
  ctx.globalAlpha = a;
}

// 用「變亮」疊加畫（光團、光束都用這個）
function additive(ctx, fn) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  fn();
  ctx.restore();
}

// ---------- 基本粒子 ----------
// 光團：大小從 s0 變到 s1（美術像素）、透明度從 a0 變到 a1；wisp＝不規則的一團
function drawBlob(ctx, p, k) {
  const e = p.ease === 'in' ? easeIn(k) : easeOut(k);
  const size = lerp(p.s0, p.s1, e) * p.S;
  const alpha = lerp(p.a0, p.a1, k) * (p.calm ? 0.6 : 1);
  additive(ctx, () => stamp(ctx, p.wisp ? wispTex(p.col, p.seed) : glowTex(p.col), p.x, p.y, size, alpha));
}
export function blob(stage, { x, y, vx = 0, vy = 0, g = 0, s0 = 10, s1 = 10, a0 = 1, a1 = 0, life = 0.4, col = '#ffffff', wisp = false, delay = 0, ease = 'out' }) {
  stage.fx.add({ draw: drawBlob, x, y, vx, vy, g, s0, s1, a0, a1, life, col, wisp, seed: Math.floor(Math.random() * 6), ease, S: stage.S, calm: calm(stage), t: -delay, fade: false });
}
// 爆開（Showdown 的 explode：到達後 0.2 秒內放大 3 倍並淡出）
export function explode(stage, x, y, cols, { n = 8, size = 16, spread = 10, life = 0.4, delay = 0 } = {}) {
  const S = stage.S;
  for (let i = 0; i < n; i++) {
    blob(stage, { x: x + rnd(-spread, spread) * S, y: y + rnd(-spread, spread) * S, s0: size * rnd(0.6, 1), s1: size * 3, a0: 1, a1: 0, life: life * rnd(0.8, 1.2), col: cols[i % cols.length], wisp: true, delay: delay + i * 0.012 });
  }
}
// 等一下再做（錯開時間用）
export function later(stage, delay, fn) { stage.fx.add({ run: fn, t: -delay, life: 0.001, draw: () => {} }); }

// ---------- 局部變暗（放招時兩隻周圍的桌面） ----------
// level：最暗多少；stars：出現星空（流星群）
export function dim(stage, { x, y, rx, ry, level = 0.45, hold = 0.8, fadeIn = 0.25, fadeOut = 0.3, type = 'normal', stars = false }) {
  if (level <= 0) return;
  const tint = TYPE_FX[type]?.[0] ?? '#000000';
  stage.dimFx = { x, y, rx, ry, level: level * (calm(stage) ? 0.5 : 1), hold, fadeIn, fadeOut, t: 0, tint, stars };
}
export function updateDim(stage, dt) {
  const d = stage.dimFx;
  if (!d) return;
  d.t += dt;
  if (d.t > d.fadeIn + d.hold + d.fadeOut) stage.dimFx = null;
}
export function drawDim(ctx, stage) {
  const d = stage.dimFx;
  if (!d) return;
  const k = d.t < d.fadeIn ? d.t / d.fadeIn : d.t < d.fadeIn + d.hold ? 1 : 1 - (d.t - d.fadeIn - d.hold) / d.fadeOut;
  const lv = d.level * clamp01(k);
  if (lv <= 0.005) return;
  // 深藍黑色，帶一點屬性色
  const n = parseInt(d.tint.slice(1), 16);
  const r = Math.round(10 + ((n >> 16) & 255) * 0.08), g = Math.round(8 + ((n >> 8) & 255) * 0.08), b = Math.round(24 + (n & 255) * 0.1);
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.scale(1, d.ry / d.rx);
  const gr = ctx.createRadialGradient(0, 0, d.rx * 0.2, 0, 0, d.rx);
  gr.addColorStop(0, `rgba(${r},${g},${b},${lv})`);
  gr.addColorStop(0.6, `rgba(${r},${g},${b},${lv * 0.8})`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = gr;
  ctx.fillRect(-d.rx, -d.rx, d.rx * 2, d.rx * 2);
  ctx.restore();
  if (d.stars) {
    let s = 7;
    const rr = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const S = stage.S;
    for (let i = 0; i < 70; i++) {
      const x = d.x + (rr() - 0.5) * 2 * d.rx, y = d.y + (rr() - 0.5) * 2 * d.ry;
      const q = Math.hypot((x - d.x) / d.rx, (y - d.y) / d.ry);
      if (q > 0.95) continue;
      const tw = 0.5 + 0.5 * Math.sin(d.t * 6 + i);
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, lv * tw * (1 - q * 0.7) * 1.8).toFixed(3)})`;
      const sz = i % 5 ? S / 2 : S;
      ctx.fillRect(Math.round(x), Math.round(y), sz, sz);
    }
  }
}

// ---------- 打擊火花、衝擊波、放射光、刀光、殘影 ----------
function drawSpark(ctx, p, k) {
  const len = p.size * (0.5 + k * 0.9), inner = p.size * 0.12;
  additive(ctx, () => {
    ctx.globalAlpha = Math.max(0, 1 - k * 1.2);
    ctx.lineCap = 'round';
    for (let i = 0; i < p.n; i++) {
      const a = p.rot + (i / p.n) * Math.PI * 2, L = len * (i % 2 ? 0.55 : 1);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.S * 2.5 * (1 - k);
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(a) * inner, p.y + Math.sin(a) * inner);
      ctx.lineTo(p.x + Math.cos(a) * L, p.y + Math.sin(a) * L);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = p.S * (1 - k);
      ctx.stroke();
    }
  });
}
export function hitSpark(stage, x, y, color, size = 22, n = 8) {
  stage.fx.add({ draw: drawSpark, x, y, S: stage.S, color, size: size * stage.S, n, rot: Math.random() * Math.PI, life: 0.26, fade: false });
}

function drawWave(ctx, p, k) {
  const r = p.maxR * easeOut(k), S = p.S;
  if (r < S) return;
  additive(ctx, () => {
    ctx.globalAlpha = Math.max(0, 1 - k) * (p.calm ? 0.6 : 1);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = Math.max(S, p.thick * (1 - k * 0.7) * S);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r * p.flat, 0, 0, Math.PI * 2);
    ctx.stroke();
  });
}
export function shockwave(stage, x, y, color, maxR, { thick = 3, flat = 1, life = 0.45, delay = 0 } = {}) {
  stage.fx.add({ draw: drawWave, x, y, S: stage.S, color, maxR: maxR * stage.S, thick, flat, life, fade: false, t: -delay, calm: calm(stage) });
}

function drawRays(ctx, p, k) {
  const a0 = p.rot + k * 0.6;
  additive(ctx, () => {
    ctx.globalAlpha = Math.sin(k * Math.PI) * p.alpha;
    const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.len);
    gr.addColorStop(0, p.color);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    for (let i = 0; i < p.n; i++) {
      const a = a0 + (i / p.n) * Math.PI * 2, w = 0.06;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(a - w) * p.len, p.y + Math.sin(a - w) * p.len * 0.8);
      ctx.lineTo(p.x + Math.cos(a + w) * p.len, p.y + Math.sin(a + w) * p.len * 0.8);
      ctx.closePath();
      ctx.fill();
    }
  });
}
export function rays(stage, x, y, color, len, { n = 12, life = 0.5, alpha = 0.6 } = {}) {
  stage.fx.add({ draw: drawRays, x, y, color, len: len * stage.S, n, rot: Math.random() * Math.PI, life, alpha: calm(stage) ? alpha * 0.4 : alpha, fade: false });
}

function drawSparkLine(ctx, p, k) {
  additive(ctx, () => {
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = p.S;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
    ctx.stroke();
  });
}
// 往四周噴的亮線（打中的時候）
export function sparks(stage, x, y, cols, n = 12, speed = 200) {
  const S = stage.S;
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2), v = rnd(0.5, 1) * speed * S;
    stage.fx.add({ draw: drawSparkLine, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, S, color: cols[i % cols.length], life: rnd(0.2, 0.4), fade: false });
  }
}

function drawSlash(ctx, p, k) {
  const S = p.S, sweep = Math.min(1, k * 2.5);
  additive(ctx, () => {
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.4) * 1.7);
    ctx.lineCap = 'round';
    for (const [w, col] of [[6 * S, p.color], [2 * S, '#ffffff']]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, p.a0, p.a0 + p.span * sweep * p.dir, p.dir < 0);
      ctx.stroke();
    }
  });
}
export function slash(stage, x, y, color, { r = 26, dir = 1, cross = false } = {}) {
  const S = stage.S;
  stage.fx.add({ draw: drawSlash, x, y, S, color, r: r * S, a0: -Math.PI * 0.85, span: Math.PI * 0.9, dir, life: 0.35, fade: false });
  if (cross) stage.fx.add({ draw: drawSlash, x, y, S, color, r: r * S, a0: -Math.PI * 0.15, span: Math.PI * 0.9, dir: -dir, life: 0.35, fade: false, t: -0.08 });
}

function drawGhost(ctx, p, k) {
  blit(ctx, p.img, p.x, p.y, p.S, { flipX: p.flipX, alpha: (1 - k) * 0.4 });
}
export function afterimage(pet) {
  const r = pet.rect();
  pet.stage.fx.add({ draw: drawGhost, img: pet.asset.canvas, x: r.x, y: r.y, S: pet.S, flipX: pet.facing > 0, life: 0.25, fade: false });
}
function drawStreak(ctx, p, k) {
  ctx.globalAlpha = (1 - k) * 0.8;
  ctx.fillStyle = p.color;
  const len = p.len * (1 - k * 0.5);
  ctx.fillRect(Math.round(p.x - (p.dir > 0 ? len : 0)), Math.round(p.y), Math.round(len), p.S);
  ctx.globalAlpha = 1;
}
export function streaks(pet, color = '#ffffff') {
  const S = pet.S, r = pet.rect();
  for (let i = 0; i < 2; i++) pet.stage.fx.add({ draw: drawStreak, x: pet.x - pet.facing * r.w * 0.3, y: r.y + rnd(0.2, 0.9) * r.h, len: rnd(14, 30) * S, dir: pet.facing, S, color, life: 0.2, fade: false });
}

// ---------- 蓄力：光團從四周螺旋吸進來，中間越來越亮 ----------
export function charge(stage, at, cols, t, dt, { big = false } = {}) {
  const S = stage.S;
  if (Math.random() < dt * (big ? 70 : 45)) {
    const a = rnd(0, Math.PI * 2), d = rnd(22, 40) * S, L = 0.26;
    stage.fx.add({
      draw: (ctx, p, k) => {
        const aa = p.a + k * 3, dd = p.d * (1 - easeIn(k));
        additive(ctx, () => stamp(ctx, glowTex(p.col), p.at.x + Math.cos(aa) * dd, p.at.y + Math.sin(aa) * dd * 0.8, (8 - k * 4) * S, Math.min(1, k * 4) * 0.9));
      },
      at, a, d, col: pick(cols), life: L, fade: false,
    });
  }
}
export function chargeCore(stage, at, col, { big = false, life = 0.34 } = {}) {
  blob(stage, { x: at.x, y: at.y, s0: 4, s1: big ? 26 : 18, a0: 0.5, a1: 1, life, col, ease: 'in' });
}

// ---------- 光束（外層屬性色、中心白色，外面兩條旋轉的能量絲） ----------
export function drawBeam(ctx, from, to, S, cols, k, t, { zigzag = false, width = 5, fade = 1 } = {}) {
  if (k <= 0 || fade <= 0) return;
  const ex = lerp(from.x, to.x, k), ey = lerp(from.y, to.y, k);
  const pulse = 1 + Math.sin(t * 50) * 0.12;
  if (zigzag) {
    // 閃電：每 0.05 秒換一次形狀
    const pts = bolt(from, { x: ex, y: ey }, S, Math.floor(t * 20));
    additive(ctx, () => {
      ctx.lineJoin = 'round';
      for (const [w, col, a] of [[10 * S, cols[0], 0.35], [4 * S, cols[0], 1], [2 * S, cols[1] ?? '#ffffff', 1], [S, '#ffffff', 1]]) {
        ctx.globalAlpha = a * fade;
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      }
    });
    return;
  }
  const w = width * S * pulse * fade;
  additive(ctx, () => {
    ctx.lineCap = 'round';
    for (const [m, col, a] of [[3.2, cols[0], 0.28], [2, cols[0], 0.6], [1.1, cols[1] ?? '#ffffff', 0.9], [0.45, '#ffffff', 1]]) {
      ctx.globalAlpha = a;
      ctx.strokeStyle = col;
      ctx.lineWidth = w * m;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    // 兩條旋轉的能量絲
    const len = Math.hypot(ex - from.x, ey - from.y) || 1, nx = -(ey - from.y) / len, ny = (ex - from.x) / len;
    ctx.lineWidth = Math.max(1, S * fade);
    for (const [ph, col] of [[0, cols[2] ?? cols[1] ?? '#ffffff'], [Math.PI, cols[1] ?? '#ffffff']]) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = col;
      ctx.beginPath();
      for (let s = 0; s <= 48; s++) {
        const u = s / 48, amp = width * 2.2 * S * Math.min(1, u * 4) * fade;
        const off = Math.sin((u * len) / (17 * S) - t * 30 + ph) * amp;
        const x = from.x + (ex - from.x) * u + nx * off, y = from.y + (ey - from.y) * u + ny * off;
        s ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    stamp(ctx, glowTex(cols[0]), from.x, from.y, width * 9 * S * fade * pulse, 0.9);
    if (k >= 1) stamp(ctx, glowTex(cols[0]), ex, ey, width * 14 * S * fade * pulse, 0.9);
  });
}

// 光束上一直往前送的脈衝環（from/to 是函式：兩隻會動）
function drawPulseRing(ctx, p, k) {
  const f = p.from(), to = p.to(), u = easeIn(k);
  const x = lerp(f.x, to.x, u), y = lerp(f.y, to.y, u), a = Math.atan2(to.y - f.y, to.x - f.x);
  additive(ctx, () => {
    ctx.globalAlpha = 0.9 * (1 - k * 0.5);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = p.S;
    ctx.beginPath();
    ctx.ellipse(x, y, 3 * p.S, (12 + u * 5) * p.S, a, 0, Math.PI * 2);
    ctx.stroke();
  });
}
export function pulseRing(stage, from, to, color, delay = 0) {
  stage.fx.add({ draw: drawPulseRing, from, to, color, S: stage.S, life: 0.26, t: -delay, fade: false });
}

function bolt(a, b, S, seed) {
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const n = 7, pts = [a];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  for (let i = 1; i < n; i++) {
    const u = i / n, off = (r() - 0.5) * 22 * S;
    pts.push({ x: a.x + dx * u + nx * off, y: a.y + dy * u + ny * off });
  }
  pts.push(b);
  return pts;
}
function drawBoltP(ctx, p, k) {
  const pts = bolt(p.a, p.b, p.S, p.seed);
  additive(ctx, () => {
    for (const [w, col, a] of [[6 * p.S, p.color, 0.35], [2 * p.S, p.color, 1], [p.S, '#ffffff', 1]]) {
      ctx.globalAlpha = a * (1 - k);
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.stroke();
    }
  });
}

// ---------- 發射物：發光的核心＋不規則的外暈＋一路留下漸淡的光團 ----------
export function projectile(stage, from, to, L, cols, { big = false, img = null, onArrive = null } = {}) {
  const S = stage.S, vx = (to.x - from.x) / L, vy = (to.y - from.y) / L;
  const size = big ? 16 : 10;
  stage.fx.add({
    draw: (ctx, p) => {
      additive(ctx, () => {
        stamp(ctx, wispTex(cols[0], p.seed), p.x, p.y, size * 2.6 * S, 0.8);
        stamp(ctx, glowTex(cols[1] ?? cols[0]), p.x, p.y, size * 1.4 * S, 1);
      });
      if (img) blit(ctx, img, p.x - (img.width * S) / 2, p.y - (img.height * S) / 2, S);
    },
    tick: (p, dt) => {
      p.trailT = (p.trailT ?? 0) - dt;
      if (p.trailT <= 0) { p.trailT = 0.02; blob(stage, { x: p.x, y: p.y, s0: size * 1.3, s1: size * 0.4, a0: 0.9, a1: 0, life: 0.34, col: cols[0], wisp: true }); }
      if (p.t + dt >= p.life && !p.arrived) { p.arrived = true; onArrive?.(); }
    },
    x: from.x, y: from.y, vx, vy, life: L, seed: Math.floor(Math.random() * 6), fade: false,
  });
  hitSpark(stage, from.x, from.y, cols[1] ?? '#ffffff', big ? 14 : 10, 6);
}

// ---------- 從天而降：帶尾巴的流星／冰塊／光箭 ----------
function drawFalling(ctx, p, k) {
  const u = easeIn(k), x = lerp(p.x0, p.tx, u), y = lerp(p.y0, p.ty, u);
  const dx = p.tx - p.x0, dy = p.ty - p.y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  const tail = p.tail * p.S * Math.min(1, u * 3);
  additive(ctx, () => {
    const gr = ctx.createLinearGradient(x, y, x - ux * tail, y - uy * tail);
    gr.addColorStop(0, rgba(p.cols[1] ?? p.cols[0], 0.9));
    gr.addColorStop(0.4, rgba(p.cols[0], 0.5));
    gr.addColorStop(1, rgba(p.cols[0], 0));
    ctx.strokeStyle = gr;
    ctx.lineCap = 'round';
    ctx.lineWidth = p.size * 0.9 * p.S;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - ux * tail, y - uy * tail); ctx.stroke();
    ctx.lineWidth = p.size * 0.3 * p.S;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - ux * tail * 0.6, y - uy * tail * 0.6); ctx.stroke();
    stamp(ctx, glowTex(p.cols[0]), x, y, p.size * 4 * p.S, 1);
    stamp(ctx, glowTex('#ffffff'), x, y, p.size * 1.4 * p.S, 1);
  });
}
export function falling(stage, { x0, y0, tx, ty, life = 0.42, cols, size = 5, tail = 80, delay = 0, onLand }) {
  stage.fx.add({
    draw: drawFalling, x0, y0, tx, ty, cols, size, tail, S: stage.S, life, t: -delay, fade: false,
    tick: (p, dt) => { if (p.t + dt >= p.life && !p.landed) { p.landed = true; onLand?.(tx, ty); } },
  });
}

// 落地爆炸：光、火光團、石塊、地面震波、煙
export function landing(stage, x, y, cols, { rocks = true, big = true } = {}) {
  const S = stage.S;
  blob(stage, { x, y: y - 4 * S, s0: 30, s1: big ? 90 : 60, a0: 1, a1: 0, life: 0.25, col: cols[0] });
  explode(stage, x, y - 8 * S, cols, { n: big ? 8 : 5, size: 14, spread: 8, life: 0.45 });
  shockwave(stage, x, y, cols[1] ?? cols[0], big ? 50 : 34, { flat: 0.3, thick: 3, life: 0.5 });
  if (rocks) for (let i = 0; i < 7; i++) {
    const a = rnd(-Math.PI * 0.95, -Math.PI * 0.05), v = rnd(90, 210) * S;
    stage.fx.add({ rect: pick(['#6a4e3a', '#8a6a4a', '#4a3a2a']), size: pick([S, 2 * S]), x, y: y - 3 * S, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 520 * S, life: 0.7 });
  }
  for (let i = 0; i < 3; i++) smoke(stage, x + rnd(-14, 14) * S, y - 3 * S, rnd(26, 40));
}
function drawSmoke(ctx, p, k) {
  const r = p.size * p.S * (0.6 + k * 0.7);
  const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  gr.addColorStop(0, `rgba(120,110,120,${(0.35 * (1 - k)).toFixed(3)})`);
  gr.addColorStop(1, 'rgba(120,110,120,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
}
export function smoke(stage, x, y, size = 30) {
  const S = stage.S;
  stage.fx.add({ draw: drawSmoke, x, y, vx: rnd(-30, 30) * S, vy: -rnd(5, 20) * S, size, S, life: rnd(0.8, 1.2), fade: false });
}

// ---------- 打中時各屬性的額外碎片 ----------
export function typeImpact(stage, type, x, y, big = false) {
  const S = stage.S, fx = stage.fx, [c0, c1, c2] = TYPE_FX[type] ?? TYPE_FX.normal, n = big ? 1.5 : 1;
  switch (type) {
    case 'fire': // 火舌往上竄
      for (let i = 0; i < 10 * n; i++) blob(stage, { x: x + rnd(-14, 14) * S, y: y + rnd(-4, 8) * S, vy: -rnd(50, 110) * S, vx: rnd(-15, 15) * S, s0: rnd(8, 14), s1: 3, a0: 0.9, a1: 0, life: rnd(0.35, 0.6), col: pick([c0, c1, c2]), wisp: true });
      break;
    case 'water': // 水花：往外噴、往下掉
      fx.burst(x, y, S, [c0, c1, '#ffffff'], { n: Math.round(16 * n), speed: 120, spread: Math.PI * 1.4, g: 320, life: 0.7, size: S });
      shockwave(stage, x, y + 6 * S, c1, 30, { flat: 0.4, thick: 2 });
      break;
    case 'electric': // 身上冒出小閃電
      for (let i = 0; i < 4 * n; i++) {
        const a = Math.random() * Math.PI * 2, d = rnd(14, 30) * S;
        fx.add({ draw: drawBoltP, a: { x, y }, b: { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d }, S, seed: Math.floor(Math.random() * 1e5), color: pick([c0, c2]), life: rnd(0.15, 0.3), fade: false, t: -i * 0.05 });
      }
      break;
    case 'grass': // 葉子轉著散開
      for (let i = 0; i < 8 * n; i++) { const a = Math.random() * Math.PI * 2, v = rnd(40, 100) * S; fx.add({ img: art.leaf, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20 * S, g: 60 * S, life: rnd(0.5, 0.9), wobble: true }); }
      break;
    case 'ice': // 冰晶碎片
      fx.burst(x, y, S, ['#ffffff', c1, c0], { n: Math.round(14 * n), speed: 130, spread: Math.PI * 2, g: 160, life: 0.6, size: S });
      for (let i = 0; i < 4; i++) fx.add({ img: art.sparkle, x: x + rnd(-18, 18) * S, y: y + rnd(-14, 14) * S, life: 0.6, blink: true });
      break;
    case 'poison': // 冒泡泡
      for (let i = 0; i < 8 * n; i++) blob(stage, { x: x + rnd(-16, 16) * S, y: y + rnd(-6, 10) * S, vy: -rnd(20, 60) * S, s0: rnd(4, 8), s1: rnd(8, 12), a0: 0.8, a1: 0, life: rnd(0.4, 0.8), col: pick([c0, c1, c2]) });
      break;
    case 'ground': // 塵土往兩邊噴
      for (const dir of [-Math.PI * 0.85, -Math.PI * 0.15]) fx.burst(x, y, S, [c0, c1, c2], { n: Math.round(8 * n), speed: 110, dir, spread: 0.6, g: 200, life: 0.7, size: S });
      for (let i = 0; i < 2; i++) smoke(stage, x + rnd(-10, 10) * S, y + 6 * S, 24);
      break;
    case 'flying':
      slash(stage, x, y, c1, { r: 22, cross: big });
      break;
    case 'psychic': // 一圈一圈的波紋
      for (let i = 0; i < 3; i++) shockwave(stage, x, y, pick([c0, c1, c2]), 30 + i * 6, { thick: 2, delay: i * 0.08 });
      break;
    case 'rock': // 石塊
      for (let i = 0; i < 8 * n; i++) fx.add({ rect: pick([c0, c2, c1]), size: pick([2 * S, 3 * S]), x: x + rnd(-14, 14) * S, y: y - rnd(0, 10) * S, vx: rnd(-80, 80) * S, vy: -rnd(40, 120) * S, g: 420 * S, life: 0.7 });
      break;
    case 'ghost': // 黑影往上飄
      for (let i = 0; i < 8 * n; i++) blob(stage, { x: x + rnd(-14, 14) * S, y: y + rnd(-6, 10) * S, vy: -rnd(20, 50) * S, s0: rnd(10, 16), s1: rnd(16, 22), a0: 0.7, a1: 0, life: rnd(0.5, 0.9), col: pick([c0, c2, c1]), wisp: true });
      break;
    case 'dragon': // 能量漩渦
      for (let i = 0; i < 12 * n; i++) { const a = (i / 12) * Math.PI * 2; blob(stage, { x: x + Math.cos(a) * 20 * S, y: y + Math.sin(a) * 14 * S, vx: -Math.sin(a) * 120 * S, vy: Math.cos(a) * 80 * S, s0: 6, s1: 2, a0: 1, a1: 0, life: 0.4, col: pick([c0, c1, c2]) }); }
      break;
    case 'dark':
      slash(stage, x, y, c0, { r: 24, cross: true });
      break;
    case 'steel':
      for (let i = 0; i < 5; i++) fx.add({ img: art.sparkle, x: x + rnd(-20, 20) * S, y: y + rnd(-16, 16) * S, life: 0.5, blink: true });
      break;
    case 'fairy':
      fx.sparkles(x, y, S, Math.round(8 * n), 26);
      fx.hearts(x, y, S, big ? 3 : 1);
      break;
    case 'bug':
    case 'fighting':
    case 'normal':
    default:
      fx.stars(x, y, S, big ? 6 : 4);
  }
}

// ---------- 打中 ----------
// eff：效果（>1 效果絕佳、0 沒有效果）
export function impactFx(stage, def, x, y, eff = 1, { contact = false } = {}) {
  const S = stage.S, cols = TYPE_FX[def.type] ?? TYPE_FX.normal;
  const big = def.big || def.heavy || eff > 1;
  const power = (big ? 1.4 : 1) * (eff === 0 ? 0.4 : 1);
  blob(stage, { x, y, s0: 20 * power, s1: (big ? 70 : 48) * power, a0: 1, a1: 0, life: 0.28, col: cols[0] }); // 閃光
  explode(stage, x, y, cols, { n: big ? 10 : 7, size: big ? 16 : 12, spread: 8 });
  hitSpark(stage, x, y, contact ? '#ffe066' : cols[1], (big ? 28 : 20) * power);
  shockwave(stage, x, y, cols[1], (big ? 60 : 40) * power, { thick: big ? 4 : 3 });
  sparks(stage, x, y, [cols[1], '#ffffff', cols[0]], big ? 16 : 10, big ? 260 : 200);
  if (eff !== 0) typeImpact(stage, def.type, x, y, big);
  if (eff > 1) {
    rays(stage, x, y, '#fff6c0', 90, { n: 14, life: 0.55 });
    shockwave(stage, x, y, '#ffffff', 90, { thick: 2, delay: 0.08 });
  }
  stage.hitStop(eff > 1 ? 0.12 : big || contact ? 0.07 : 0.05);
  stage.shake(eff > 1 ? 6 : big ? 5 : contact ? 3 : 2, eff > 1 ? 0.35 : 0.25);
}

// ---------- 各種招式：放招時要不要變暗、暗多少 ----------
export function dimFor(def) {
  switch (def.kind) {
    case 'meteor': return 0.65;
    case 'rain': return 0.5;
    case 'beam': return def.big ? 0.5 : 0.4;
    case 'portal': return 0.45;
    case 'area': return def.soft ? 0 : def.big ? 0.5 : 0.3;
    case 'self': return 0.3;
    case 'projectile': return def.big ? 0.3 : 0;
    case 'contact': return def.heavy || def.jump || def.trail ? 0.25 : 0;
    default: return 0;
  }
}
