// 招式的演出（參考原作 X・Y 的對戰動畫）：蓄力的光、粗光束、會發光的發射物、衝刺殘影、
// 打中時的打擊火花＋衝擊波＋各屬性的碎片、頓一下、畫面震一下。
// 只有畫面，沒有傷害或規則。設定裡「減少閃光和畫面震動」打開時：光比較淡、不震動。
//
// 這裡的粒子都用 Fx 的 draw 自己畫（座標是裝置像素，S 是一個美術像素的大小）。
import * as art from '../gfx/art.js';
import { blit } from '../gfx/pixel.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

// 屬性的主色、亮色（碎片、光暈用）
export const TYPE_FX = {
  normal: ['#e8e0c8', '#ffffff'], fire: ['#ff6a2a', '#ffe066'], water: ['#4a90e8', '#bfe4ff'], grass: ['#58b048', '#c8f0a0'],
  electric: ['#ffd84a', '#fffbd0'], ice: ['#8ed8f8', '#ffffff'], fighting: ['#e05a3a', '#ffe066'], poison: ['#a040a0', '#e0a0f0'],
  ground: ['#b88a4a', '#f0d8a0'], flying: ['#a0b8f8', '#ffffff'], psychic: ['#ff5d9e', '#ffd0e4'], bug: ['#a8b820', '#e8f080'],
  rock: ['#b8a038', '#f0e0a0'], ghost: ['#705898', '#d0b8ff'], dragon: ['#7038f8', '#c0a8ff'], dark: ['#4a3a3a', '#c8b8a8'],
  steel: ['#b8b8d0', '#ffffff'], fairy: ['#ff9ec7', '#ffffff'],
};

const calm = stage => stage.calmFx;

// 圓形的光暈（中間亮、外面淡）
function drawGlow(ctx, p, k) {
  const r = p.r * (p.grow ? 0.4 + k * 0.8 : 1);
  const a = (p.alpha ?? 0.7) * (p.fadeIn ? Math.min(1, k * 4) : 1) * (1 - k);
  if (a <= 0.01 || r < 1) return;
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.35, hexA(p.color, a * 0.8));
  g.addColorStop(1, hexA(p.color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
}

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

export function glow(stage, x, y, color, r, { life = 0.35, alpha = 0.7, grow = false, fadeIn = false, vx = 0, vy = 0 } = {}) {
  stage.fx.add({ draw: drawGlow, x, y, vx, vy, color, r, life, alpha: calm(stage) ? alpha * 0.35 : alpha, grow, fadeIn, fade: false });
}

// 打擊火花：從中間放射出去的尖刺（原作打中時那個白色的星形）
function drawSpark(ctx, p, k) {
  const n = p.n, S = p.S, len = p.size * (0.5 + k * 0.9), inner = p.size * 0.15 * (1 + k);
  ctx.globalAlpha = Math.max(0, 1 - k * 1.2);
  for (let i = 0; i < n; i++) {
    const a = p.rot + (i / n) * Math.PI * 2, long = i % 2 ? 0.55 : 1;
    const x1 = p.x + Math.cos(a) * inner, y1 = p.y + Math.sin(a) * inner;
    const steps = Math.max(2, Math.round((len * long) / S));
    for (let s = 0; s < steps; s++) {
      const u = s / steps, w = Math.max(1, Math.round((1 - u) * 2.4)) * S;
      ctx.fillStyle = u < 0.35 ? '#ffffff' : p.color;
      ctx.fillRect(Math.round((x1 + Math.cos(a) * len * long * u) / S) * S - w / 2, Math.round((y1 + Math.sin(a) * len * long * u) / S) * S - w / 2, w, w);
    }
  }
  ctx.globalAlpha = 1;
}

export function hitSpark(stage, x, y, color, size = 22, n = 8) {
  const S = stage.S;
  stage.fx.add({ draw: drawSpark, x, y, S, color, size: size * S, n, rot: Math.random() * Math.PI, life: 0.28, fade: false });
}

// 衝擊波：粗的橢圓環（地面的比較扁）
function drawWave(ctx, p, k) {
  const e = 1 - Math.pow(1 - k, 2.2); // 一開始很快、後面變慢
  const r = p.maxR * e, S = p.S;
  if (r < S) return;
  ctx.globalAlpha = Math.max(0, 1 - k) * (p.alpha ?? 1);
  ctx.strokeStyle = p.color;
  ctx.lineWidth = Math.max(S, Math.round(p.thick * (1 - k * 0.7)) * S);
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r, r * p.flat, 0, 0, Math.PI * 2);
  ctx.stroke();
  if (p.inner) {
    ctx.strokeStyle = p.inner;
    ctx.lineWidth = Math.max(1, ctx.lineWidth / 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function shockwave(stage, x, y, color, maxR, { thick = 4, flat = 1, inner = '#ffffff', life = 0.45, delay = 0 } = {}) {
  const S = stage.S;
  stage.fx.add({ draw: drawWave, x, y, S, color, inner, maxR: maxR * S, thick, flat, life, fade: false, t: -delay });
}

// 放射狀的光線（大招放出去、效果絕佳時）
function drawRays(ctx, p, k) {
  const a0 = p.rot + k * p.spin;
  ctx.globalAlpha = Math.max(0, Math.sin(k * Math.PI)) * (p.alpha ?? 0.6);
  ctx.fillStyle = p.color;
  for (let i = 0; i < p.n; i++) {
    const a = a0 + (i / p.n) * Math.PI * 2, w = 0.07;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(a - w) * p.len, p.y + Math.sin(a - w) * p.len * 0.8);
    ctx.lineTo(p.x + Math.cos(a + w) * p.len, p.y + Math.sin(a + w) * p.len * 0.8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function rays(stage, x, y, color, len, { n = 12, life = 0.5, alpha = 0.55 } = {}) {
  if (calm(stage)) alpha *= 0.4;
  stage.fx.add({ draw: drawRays, x, y, color, len: len * stage.S, n, rot: Math.random() * Math.PI, spin: 0.6, life, alpha, fade: false });
}

// 殘影：衝刺時留在後面、慢慢變淡的身影
function drawGhost(ctx, p, k) {
  blit(ctx, p.img, p.x, p.y, p.S, { flipX: p.flipX, alpha: (1 - k) * 0.45 });
}
export function afterimage(pet) {
  const r = pet.rect();
  pet.stage.fx.add({ draw: drawGhost, img: pet.asset.canvas, x: r.x, y: r.y, S: pet.S, flipX: pet.facing > 0, life: 0.25, fade: false });
}

// 速度線：衝刺方向的反方向拉出幾條白線
function drawStreak(ctx, p, k) {
  ctx.globalAlpha = (1 - k) * 0.8;
  ctx.fillStyle = p.color;
  const len = p.len * (1 - k * 0.5);
  ctx.fillRect(Math.round(p.x - (p.dir > 0 ? len : 0)), Math.round(p.y), Math.round(len), p.S);
  ctx.globalAlpha = 1;
}
export function streaks(pet, color = '#ffffff') {
  const S = pet.S, r = pet.rect();
  for (let i = 0; i < 2; i++) {
    pet.stage.fx.add({ draw: drawStreak, x: pet.x - pet.facing * r.w * 0.3, y: r.y + rnd(0.2, 0.9) * r.h, len: rnd(14, 30) * S, dir: pet.facing, S, color, life: 0.2, fade: false });
  }
}

// 蓄力：粒子從四周吸進來＋慢慢變亮的光
export function chargeUp(pet, at, c, dt) {
  const S = pet.S, st = pet.stage;
  if (Math.random() < dt * 40) {
    const a = Math.random() * Math.PI * 2, d = rnd(22, 38) * S, L = 0.22;
    st.fx.add({ rect: pick(c), size: S, x: at.x + Math.cos(a) * d, y: at.y + Math.sin(a) * d, vx: -Math.cos(a) * d / L, vy: -Math.sin(a) * d / L, life: L, fade: false });
  }
}

// 光束：外層屬性色、中間亮色、中心白色；伸出去、脈動、收回來。zigzag＝閃電
export function drawBeam(ctx, from, to, S, c, k, t, { zigzag = false, width = 5 } = {}) {
  if (k <= 0) return;
  const ex = from.x + (to.x - from.x) * k, ey = from.y + (to.y - from.y) * k;
  const pulse = 1 + Math.sin(t * 40) * 0.18;
  if (zigzag) {
    // 閃電：每 0.05 秒換一次形狀，粗的屬性色＋細的白色芯
    const seed = Math.floor(t * 20);
    const pts = bolt(from, { x: ex, y: ey }, S, seed);
    for (const [w, col] of [[4 * S, c[0]], [2 * S, c[1] ?? '#ffffff'], [S, '#ffffff']]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    return;
  }
  const layers = [[width * 1.9, c[0], 0.55], [width * 1.25, c[0], 1], [width * 0.75, c[1] ?? '#ffffff', 1], [width * 0.35, '#ffffff', 1]];
  const base = ctx.globalAlpha;
  ctx.lineCap = 'round';
  for (const [w, col, a] of layers) {
    ctx.globalAlpha = base * a;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(S, w * S * pulse);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  ctx.globalAlpha = base;
  ctx.lineCap = 'butt';
  // 光束上轉圈的亮點（像原作光束外面繞著的螺旋）
  const n = 7, dx = ex - from.x, dy = ey - from.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  for (let i = 0; i < n; i++) {
    const u = ((i / n) + t * 1.8) % 1, off = Math.sin(u * Math.PI * 6 + t * 20) * width * 1.4 * S;
    ctx.fillStyle = c[(i % (c.length - 1)) + 1] ?? '#ffffff';
    ctx.fillRect(Math.round(from.x + dx * u + nx * off), Math.round(from.y + dy * u + ny * off), 2 * S, 2 * S);
  }
}

// 閃電的折線（同一個 seed 形狀一樣）
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
  ctx.globalAlpha = 1 - k;
  const pts = bolt(p.a, p.b, p.S, p.seed);
  for (const [w, col] of [[3 * p.S, p.color], [p.S, '#ffffff']]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// 斬擊：一道弧形的刀光
function drawSlash(ctx, p, k) {
  const S = p.S, sweep = Math.min(1, k * 2.5);
  ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.4) * 1.7);
  for (const [w, col] of [[5 * S, p.color], [2 * S, '#ffffff']]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, p.a0, p.a0 + p.span * sweep * p.dir, p.dir < 0);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
export function slash(stage, x, y, color, { r = 26, dir = 1, cross = false } = {}) {
  const S = stage.S;
  stage.fx.add({ draw: drawSlash, x, y, S, color, r: r * S, a0: -Math.PI * 0.85, span: Math.PI * 0.9, dir, life: 0.35, fade: false });
  if (cross) stage.fx.add({ draw: drawSlash, x, y, S, color, r: r * S, a0: -Math.PI * 0.15, span: Math.PI * 0.9, dir: -dir, life: 0.35, fade: false, t: -0.08 });
}

// 打中時各屬性的碎片
export function typeImpact(stage, type, x, y, big = false) {
  const S = stage.S, fx = stage.fx, [c0, c1] = TYPE_FX[type] ?? TYPE_FX.normal, n = big ? 1.6 : 1;
  const burst = (colors, o) => fx.burst(x, y, S, colors, o);
  switch (type) {
    case 'fire': // 火舌往上竄
      for (let i = 0; i < 14 * n; i++) fx.add({ rect: pick(['#ff4a1a', '#ff8a2a', '#ffd84a', '#fff4b0']), size: pick([S, 2 * S]), x: x + rnd(-16, 16) * S, y: y + rnd(-4, 8) * S, vx: rnd(-15, 15) * S, vy: -rnd(40, 110) * S, g: -30 * S, life: rnd(0.35, 0.7), wobble: true });
      break;
    case 'water': // 水花：往外噴、往下掉
      burst(['#4a90e8', '#8ec5ff', '#ffffff'], { n: Math.round(16 * n), speed: 120, spread: Math.PI * 1.4, g: 320, life: 0.7, size: S });
      shockwave(stage, x, y + 6 * S, '#8ec5ff', 30, { flat: 0.4, thick: 2 });
      break;
    case 'electric': // 身上冒出小閃電
      for (let i = 0; i < 4 * n; i++) {
        const a = Math.random() * Math.PI * 2, d = rnd(14, 30) * S;
        fx.add({ draw: drawBoltP, a: { x, y }, b: { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d }, S, seed: Math.floor(Math.random() * 1e5), color: pick([c0, '#fff27a']), life: rnd(0.15, 0.3), fade: false, t: -i * 0.05 });
      }
      break;
    case 'grass': // 葉子轉著散開
      for (let i = 0; i < 10 * n; i++) { const a = Math.random() * Math.PI * 2, v = rnd(40, 100) * S; fx.add({ img: art.leaf, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20 * S, g: 60 * S, life: rnd(0.5, 0.9), wobble: true }); }
      break;
    case 'ice': // 冰晶碎片＋一圈霜
      burst(['#ffffff', '#bfe8ff', '#8ed8f8'], { n: Math.round(14 * n), speed: 130, spread: Math.PI * 2, g: 160, life: 0.6, size: S });
      for (let i = 0; i < 4; i++) fx.add({ img: art.sparkle, x: x + rnd(-18, 18) * S, y: y + rnd(-14, 14) * S, life: 0.6, blink: true });
      shockwave(stage, x, y, '#bfe8ff', 28, { thick: 2 });
      break;
    case 'fighting': // 大大的衝擊
      hitSpark(stage, x, y, '#ffe066', 30, 10);
      burst(['#ffffff', '#ffe066'], { n: Math.round(10 * n), speed: 140, spread: Math.PI * 2, g: 0, life: 0.3 });
      break;
    case 'poison': // 冒泡泡，破掉
      for (let i = 0; i < 10 * n; i++) fx.add({ rect: pick([c0, c1, '#6a2a6a']), size: 2 * S, x: x + rnd(-16, 16) * S, y: y + rnd(-6, 10) * S, vy: -rnd(20, 60) * S, life: rnd(0.4, 0.8), wobble: true });
      break;
    case 'ground': // 塵土往兩邊噴
      for (const dir of [-Math.PI * 0.85, -Math.PI * 0.15]) burst(['#b88a4a', '#e0c090', '#8a6a3a'], { n: Math.round(8 * n), speed: 110, dir, spread: 0.6, g: 200, life: 0.7, size: S });
      shockwave(stage, x, y + 10 * S, '#c8955a', 40, { flat: 0.35, thick: 3, inner: '#f0d8a0' });
      break;
    case 'flying': // 風的刀光
      slash(stage, x, y, '#d8e8ff', { r: 22, cross: big });
      burst(['#ffffff', '#d8e8ff'], { n: 8, speed: 120, spread: Math.PI * 2, g: 0, life: 0.3 });
      break;
    case 'psychic': // 一圈一圈粉紅色的波紋
      for (let i = 0; i < 3; i++) shockwave(stage, x, y, pick(['#ff5d9e', '#ffb0d0', '#c070ff']), 34 + i * 6, { thick: 2, inner: null, delay: i * 0.08 });
      break;
    case 'bug':
      burst([c0, c1, '#ffffff'], { n: Math.round(10 * n), speed: 90, spread: Math.PI * 2, g: 80, life: 0.5 });
      break;
    case 'rock': // 石塊掉下來
      for (let i = 0; i < 8 * n; i++) fx.add({ rect: pick(['#b8a038', '#8a7428', '#d8c878']), size: pick([2 * S, 3 * S]), x: x + rnd(-14, 14) * S, y: y - rnd(0, 10) * S, vx: rnd(-80, 80) * S, vy: -rnd(40, 120) * S, g: 420 * S, life: 0.7 });
      break;
    case 'ghost': // 黑影往上飄
      for (let i = 0; i < 10 * n; i++) fx.add({ draw: drawGlow, x: x + rnd(-14, 14) * S, y: y + rnd(-6, 10) * S, vy: -rnd(20, 50) * S, color: pick(['#705898', '#3a2a5a', '#c8a0ff']), r: rnd(6, 11) * S, alpha: 0.6, life: rnd(0.5, 0.9), fade: false });
      break;
    case 'dragon': // 紫藍色的能量漩渦
      for (let i = 0; i < 14 * n; i++) { const a = (i / 14) * Math.PI * 2; fx.add({ rect: pick(['#7038f8', '#a078ff', '#5aa0f0', '#ffffff']), size: S, x: x + Math.cos(a) * 26 * S, y: y + Math.sin(a) * 18 * S, vx: -Math.sin(a) * 120 * S - Math.cos(a) * 60 * S, vy: Math.cos(a) * 80 * S - Math.sin(a) * 40 * S, life: 0.4 }); }
      break;
    case 'dark': // 交叉的黑色刀光
      slash(stage, x, y, '#3a2a3a', { r: 24, cross: true });
      break;
    case 'steel': // 金屬的閃光
      hitSpark(stage, x, y, '#d8e8ff', 26, 4);
      for (let i = 0; i < 5; i++) fx.add({ img: art.sparkle, x: x + rnd(-20, 20) * S, y: y + rnd(-16, 16) * S, life: 0.5, blink: true });
      break;
    case 'fairy': // 亮晶晶＋愛心
      fx.sparkles(x, y, S, Math.round(8 * n), 26);
      fx.hearts(x, y, S, big ? 3 : 1);
      break;
    default: // 一般：星星
      fx.stars(x, y, S, big ? 8 : 5);
  }
}

// 打中：打擊火花、衝擊波、屬性碎片、光、頓一下、震一下。eff：效果（>1 效果絕佳）
export function impactFx(stage, def, x, y, eff = 1, { contact = false } = {}) {
  const S = stage.S, [c0, c1] = TYPE_FX[def.type] ?? TYPE_FX.normal;
  const big = def.big || def.heavy || eff > 1;
  const power = (big ? 1.5 : 1) * (eff === 0 ? 0.4 : 1);
  glow(stage, x, y, c0, (big ? 44 : 30) * S * power, { life: 0.3, alpha: 0.6 });
  hitSpark(stage, x, y, contact ? '#ffe066' : c1, (big ? 30 : 20) * power);
  shockwave(stage, x, y, c0, (big ? 70 : 44) * power, { thick: big ? 5 : 3, inner: c1 });
  if (eff !== 0) typeImpact(stage, def.type, x, y, big);
  if (eff > 1) {
    rays(stage, x, y, '#fff6c0', 90, { n: 14, life: 0.55 });
    shockwave(stage, x, y, '#ffffff', 100, { thick: 2, inner: null, delay: 0.08 });
  }
  stage.hitStop(eff > 1 ? 0.14 : big || contact ? 0.08 : 0.05);
  stage.shake(eff > 1 ? 7 : big ? 5 : contact ? 3 : 2, eff > 1 ? 0.35 : 0.22);
}
