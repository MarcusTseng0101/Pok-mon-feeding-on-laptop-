// 草屬性 6 招，每一招自己的演出
//   藤鞭     兩條帶葉子的藤蔓像蛇一樣伸出去，上、下各甩一下（鞭尖「啪」），再縮回來
//   飛葉快刀 5 片葉子邊飛邊翻，從上、下兩邊繞大弧線飛過去，打中斜斜的綠色刀痕，葉子掉到地上
//   落英繽紛 五瓣花先在自己身邊繞成漩渦，再往前橫掃過目標，花瓣黏一下再飄落
//   木角     頭上長出木頭角衝過去，打中後綠色光點沿曲線流回自己，自己發綠光
//   棉花孢子 棉球從頭上噴到天上，再從目標頭上慢慢飄下來、黏在身上
//   尖刺防守 身邊地上長出帶刺的藤，順時針圍成半圓頂，刺一起抖一下
import * as FX from '../movefx.js';
import * as art from '../../gfx/art.js';
import { TAU, lerp, clamp01, rgba, glow, part, mover, cut, ripple, ribbon } from './kit.js';

const DARK = '#2e6a2a', GREEN = '#4ab04a', LEAF = '#78c850', PALE = '#c8f0a0', PINK = '#ff9ec7', PINK2 = '#ffd6ea', WOOD = '#9a6a3a';

function leafShape(ctx, x, y, len, ang, flip, col = LEAF) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.scale(1, flip);
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  ctx.quadraticCurveTo(0, -len * 0.45, len / 2, 0);
  ctx.quadraticCurveTo(0, len * 0.45, -len / 2, 0);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.strokeStyle = DARK;
  ctx.lineWidth = Math.max(1, len / 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  ctx.lineTo(len / 2, 0);
  ctx.strokeStyle = PALE;
  ctx.stroke();
  ctx.restore();
}

// ---------- 藤鞭 ----------
const GROW = [0.1, 0.4], WHIP = [0.45, 0.6], RETRACT = [0.9, 1.2]; // 猜的，可調整
// 一條藤：從 a 往 b 伸（reach 0–1），wave 是蛇行，snap 是甩下去的量（-1 往上、1 往下）
function vinePts(a, b, reach, wave, snap, side, S, n = 18) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * reach;
    const bend = Math.sin(u * Math.PI) * side * 22 * S; // 上面那條往上拱、下面那條往下拱
    const snake = Math.sin(u * 9 - wave) * 4 * S * u;
    const whip = snap * u * u * 26 * S;
    pts.push({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) - bend + snake + whip });
  }
  return pts;
}
function crack(stage, x, y) {
  const S = stage.S;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    stage.fx.add({ draw: (ctx, p, k) => { ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = S; ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a) * 3 * S, p.y + Math.sin(a) * 3 * S); ctx.lineTo(p.x + Math.cos(a) * (6 + k * 8) * S, p.y + Math.sin(a) * (6 + k * 8) * S); ctx.stroke(); ctx.restore(); }, x, y, life: 0.2, fade: false });
  }
}
const vineReach = t => (t < GROW[0] ? 0 : t < GROW[1] ? (t - GROW[0]) / (GROW[1] - GROW[0]) : t < RETRACT[0] ? 1 : clamp01(1 - (t - RETRACT[0]) / (RETRACT[1] - RETRACT[0])));
const vineSnap = (t, at) => { const d = t - at; return d < 0 ? 0 : d < 0.08 ? d / 0.08 : Math.max(0, 1 - (d - 0.08) / 0.2); };
const vineBase = pet => { const r = pet.rect(); return { x: pet.x + pet.facing * r.w * 0.2, y: r.y + r.h * 0.6 }; };

const vinewhip = {
  time: () => ({ dur: 1.3, hit: WHIP[1] + 0.01 }),
  update(pet, m, t, dt, K) {
    const s = (m.s ??= {});
    const tip = side => { const a = vineBase(pet), b = K.targetPoint(m.target), p = vinePts(a, b, 1, t * 14, side === 1 ? 1 : -1, side, pet.S); return p[p.length - 1]; };
    if (t >= WHIP[0] + 0.08 && !s.c1) { s.c1 = true; const q = tip(1); crack(pet.stage, q.x, q.y); if (K.isPet(m.target)) m.target.flinchT = 0.2; }
    if (t >= WHIP[1] + 0.08 && !s.c2) { s.c2 = true; const q = tip(-1); crack(pet.stage, q.x, q.y); }
  },
  draw(ctx, pet, m, t, K) {
    const S = pet.S, reach = vineReach(t);
    if (reach <= 0) return;
    const a = vineBase(pet), b = K.targetPoint(m.target);
    for (const side of [1, -1]) {
      const snap = vineSnap(t, side === 1 ? WHIP[0] : WHIP[1]) * (side === 1 ? 1 : -1);
      const pts = vinePts(a, b, reach, t * 14, snap, side, S);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const [w, c] of [[4, DARK], [2.2, GREEN]]) {
        ctx.strokeStyle = c;
        ctx.lineWidth = w * S;
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.stroke();
      }
      ctx.restore();
      for (let i = 3; i < pts.length - 1; i += 4) {
        const q = pts[i], r = pts[i + 1];
        leafShape(ctx, q.x, q.y - 2 * S * side, 6 * S, Math.atan2(r.y - q.y, r.x - q.x) - side * 0.8, 1);
      }
    }
  },
  pose(pet, p, m, t) { if (t > WHIP[0] && t < WHIP[1] + 0.2) p.rot = pet.facing * 0.1 * Math.sin((t - WHIP[0]) * 40); },
  impact(pet, m, at) {
    const st = pet.stage;
    cut(st, at.x, at.y, 0.3, 30, LEAF, { width: 2 });
    FX.hitSpark(st, at.x, at.y, PALE, 16, 6);
    crack(st, at.x, at.y);
  },
};

// ---------- 飛葉快刀 ----------
// 每片：出發時間、弧線往上（-1）或往下（1）、弧有多大
const LEAVES = [[0.15, -1, 1.0], [0.22, 1, 0.8], [0.29, -1, 0.6], [0.36, 1, 1.1], [0.43, -1, 0.85]];
const LEAF_FLY = 0.68, LEAF_ARC = 85, LEAF_LEN = 20; // 猜的，可調整
const razorleaf = {
  time: () => ({ dur: 1.4, hit: LEAVES[4][0] + LEAF_FLY + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= { n: 0 });
    while (s.n < LEAVES.length && t >= LEAVES[s.n][0]) {
      const i = s.n++, [, side, big] = LEAVES[i], a = pet.mouth(), b = K.targetPoint(m.target);
      // 迴旋鏢：先往上（或往下）甩出大弧線、繞過目標後面，再勾回來打中
      const dir = b.x > a.x ? 1 : -1;
      const c1 = { x: lerp(a.x, b.x, 0.3), y: a.y + side * LEAF_ARC * S * big };
      const c2 = { x: b.x + dir * 45 * S, y: b.y + side * LEAF_ARC * 0.7 * S * big };
      const bez = (p0, p1, p2, p3, k) => (1 - k) ** 3 * p0 + 3 * (1 - k) ** 2 * k * p1 + 3 * (1 - k) * k * k * p2 + k ** 3 * p3;
      const path = k => ({ x: bez(a.x, c1.x, c2.x, b.x, k), y: bez(a.y, c1.y, c2.y, b.y, k) });
      mover(st, {
        life: LEAF_FLY, S, path,
        drawAt: (ctx, q, p) => { ribbon(ctx, p.hist, S, PALE, 3, 0.85); leafShape(ctx, q.x, q.y, LEAF_LEN * S, p.t * 18, Math.cos(p.t * 26)); }, // 邊飛邊翻、留一道綠線
        onArrive: q => {
          cut(st, q.x, q.y, side * 0.8, 22, LEAF, { width: 1.5 });
          // 葉子掉到地上
          st.fx.add({ img: art.leaf, x: q.x, y: q.y, vx: pet.facing * 20 * S, vy: -20 * S, g: 80 * S, life: 0.9, wobble: true });
          if (i === LEAVES.length - 1 && pet.moveCtx === m) K.hit(pet);
          else if (K.isPet(m.target)) m.target.flinchT = 0.15;
        },
      });
    }
  },
  pose(pet, p, m, t) { if (t < 0.5) p.rot = pet.facing * 0.12 * Math.sin(t * 30); }, // 甩頭把葉子甩出去
  impact(pet, m, at) {
    const st = pet.stage;
    cut(st, at.x, at.y, -0.8, 34, LEAF, { width: 2 });
    cut(st, at.x, at.y, 0.8, 34, LEAF, { width: 2, delay: 0.05 });
  },
};

// ---------- 落英繽紛 ----------
const N_PETALS = 20, SWIRL = [0.05, 0.45], SWEEP = [0.45, 1.3], PETAL_R = 4.5; // 猜的，可調整
function flower(ctx, x, y, r, ang) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = PINK;
  for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, r * 0.5, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.35, 0, TAU);
  ctx.fill();
  ctx.restore();
}
const petalblizzard = {
  time: () => ({ dur: 1.8, hit: 1.0 }),
  // 花瓣的位置只看時間（不用粒子）：先繞自己轉，再往前橫掃
  draw(ctx, pet, m, t, K) {
    if (t < SWIRL[0] || t > SWEEP[1] + 0.15) return;
    const S = pet.S, r = pet.rect(), c = { x: pet.x, y: r.y + r.h * 0.55 }, b = K.targetPoint(m.target);
    const alpha = t > SWEEP[1] ? 1 - (t - SWEEP[1]) / 0.15 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let i = 0; i < N_PETALS; i++) {
      const ph = (i / N_PETALS) * TAU, band = ((i * 7) % N_PETALS) / N_PETALS - 0.5;
      const sw = clamp01((t - SWIRL[0]) / (SWIRL[1] - SWIRL[0]));
      const rad = (8 + 26 * sw) * S, ang = ph + t * 9;
      let x = c.x + Math.cos(ang) * rad, y = c.y + Math.sin(ang) * rad * 0.6;
      if (t > SWEEP[0]) {
        const u = clamp01((t - SWEEP[0]) / (SWEEP[1] - SWEEP[0]) - (i % 4) * 0.05);
        const ex = b.x + (b.x - c.x) * 0.35, ey = b.y + band * 50 * S;
        x = lerp(x, ex, u * u * (3 - 2 * u));
        y = lerp(y, ey, u) + Math.sin(u * 8 + ph) * 5 * S;
      }
      flower(ctx, x, y, PETAL_R * S, t * 6 + ph);
    }
    ctx.restore();
  },
  update() {},
  pose(pet, p, m, t) { if (t < SWIRL[1]) p.rot = Math.sin(t * 20) * 0.1; }, // 轉圈圈
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    // 黏在身上一下再飄落
    for (let i = 0; i < 7; i++) {
      const x = at.x + (i - 3) * 4 * S, y = at.y + ((i * 5) % 7 - 3) * 4 * S;
      part(st, { x, y, life: 1.3, draw: (ctx, p, k) => { const fall = Math.max(0, k - 0.35); ctx.save(); ctx.globalAlpha = 1 - Math.max(0, k - 0.7) / 0.3; flower(ctx, p.x + Math.sin(k * 12 + i) * 4 * S * (fall > 0), p.y + fall * fall * 70 * S, PETAL_R * S, k * 4 + i); ctx.restore(); } });
    }
  },
};

// ---------- 木角 ----------
const CHARGE_END = 0.45; // 猜的，可調整
function horn(ctx, pet, S) {
  const r = pet.rect(), f = pet.facing, x = pet.x + f * r.w * 0.28, y = r.y + r.h * 0.3;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y - 3 * S);
  ctx.quadraticCurveTo(x + f * 8 * S, y - 7 * S, x + f * 14 * S, y - 10 * S);
  ctx.quadraticCurveTo(x + f * 7 * S, y - 1 * S, x, y + 3 * S);
  ctx.closePath();
  ctx.fillStyle = WOOD;
  ctx.fill();
  ctx.strokeStyle = '#5a3a1a';
  ctx.lineWidth = S;
  ctx.stroke();
  ctx.fillStyle = LEAF;
  ctx.fillRect(x + f * 5 * S - S, y - 6 * S, 2 * S, 2 * S);
  ctx.restore();
}
const hornleech = {
  time: () => ({ dur: 1.35, hit: CHARGE_END }),
  update(pet, m, t, dt, K) {
    const back = CHARGE_END + 0.35;
    K.dash(pet, m, t < CHARGE_END ? (t / CHARGE_END) ** 2 : Math.max(0, 1 - (t - CHARGE_END) / (back - CHARGE_END)));
    if (t < CHARGE_END && Math.random() < dt * 25) FX.streaks(pet, PALE);
  },
  draw(ctx, pet, m, t) { if (t < 0.9) horn(ctx, pet, pet.S); },
  pose(pet, p, m, t) { if (t < CHARGE_END) p.rot = pet.facing * 0.18; }, // 低頭衝
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    st.fx.burst(at.x, at.y, S, [WOOD, '#c8955a'], { n: 8, speed: 110, spread: TAU, g: 260, life: 0.5, size: S });
    FX.hitSpark(st, at.x, at.y, PALE, 18, 6);
    // 綠色光點沿曲線流回自己，到了自己發綠光
    for (let i = 0; i < 7; i++) {
      const a = { x: at.x + (i - 3) * 3 * S, y: at.y + ((i * 3) % 5 - 2) * 3 * S }, up = (i % 2 ? -1 : 1) * (20 + i * 3) * S;
      mover(st, {
        life: 0.45, delay: 0.1 + i * 0.05, S,
        path: k => { const c = pet.rect(), b = { x: pet.x, y: c.y + c.h * 0.5 }; return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) + Math.sin(k * Math.PI) * up }; },
        drawAt: (ctx, q) => glow(ctx, () => { const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 5 * S); g.addColorStop(0, rgba(PALE, 1)); g.addColorStop(1, rgba(GREEN, 0)); ctx.fillStyle = g; ctx.fillRect(q.x - 5 * S, q.y - 5 * S, 10 * S, 10 * S); }),
        onArrive: () => { const c = pet.rect(); FX.blob(st, { x: pet.x, y: c.y + c.h * 0.5, s0: c.w / S * 0.6, s1: c.w / S * 1.1, a0: 0.35, a1: 0, life: 0.3, col: GREEN }); },
      });
    }
  },
};

// ---------- 棉花孢子 ----------
const COTTON = [[0.1, -10, 0.0], [0.16, 6, 1.1], [0.22, -3, 2.3], [0.28, 12, 3.1], [0.34, -14, 4.4]]; // 出發時間、落點左右、搖的相位；猜的，可調整
function cottonBall(ctx, x, y, r) {
  ctx.save();
  for (const [dx, dy, rr] of [[-0.5, 0.1, 0.7], [0.45, 0.15, 0.65], [0, -0.35, 0.75], [0, 0.2, 0.8]]) {
    const g = ctx.createRadialGradient(x + dx * r, y + dy * r, 0, x + dx * r, y + dy * r, rr * r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.7, 'rgba(240,240,240,0.8)');
    g.addColorStop(1, 'rgba(240,240,240,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x + dx * r, y + dy * r, rr * r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
const cottonspore = {
  time: () => ({ dur: 1.85, hit: 1.1 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= { n: 0 });
    while (s.n < COTTON.length && t >= COTTON[s.n][0]) {
      const i = s.n++, [, dx, ph] = COTTON[i];
      const r0 = pet.rect(), a = { x: pet.x, y: r0.y };
      const b = K.targetPoint(m.target), land = { x: b.x + dx * S, y: b.y - (4 - (i % 3) * 4) * S };
      const sky = { x: lerp(a.x, b.x, 0.5), y: Math.min(a.y, b.y) - 90 * S };
      // 先噴到天上（快），再從目標頭上慢慢飄下來、左右搖，最後黏在身上
      const up = 0.25, down = 0.75;
      mover(st, {
        life: up + down + 0.5, S,
        path: k => {
          const tt = k * (up + down + 0.5);
          if (tt < up) { const u = tt / up; return { x: lerp(a.x, sky.x, u), y: lerp(a.y, sky.y, 1 - (1 - u) ** 2) }; }
          if (tt < up + down) { const u = (tt - up) / down; return { x: lerp(sky.x, land.x, u) + Math.sin(u * 7 + ph) * 10 * S * (1 - u), y: lerp(sky.y, land.y, u) }; }
          return land;
        },
        drawAt: (ctx, q, p, k) => { ctx.save(); ctx.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1; cottonBall(ctx, q.x, q.y, 6 * S); ctx.restore(); },
      });
    }
  },
  pose(pet, p, m, t) { if (t < 0.4) { p.sy = 1 + Math.sin(t * 40) * 0.05; p.rot = -pet.facing * 0.1; } }, // 抬頭噴
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S;
    ripple(st, at.x, at.y, '#ffffff', 6, 20, { life: 0.4, width: 1, fill: 0.2 });
    st.fx.burst(at.x, at.y, S, ['#ffffff', '#f0f0f0'], { n: 6, speed: 30, spread: TAU, g: 20, life: 0.8, size: S });
    if (K.isPet(m.target)) m.target.squashT = 0.18;
  },
};

// ---------- 尖刺防守 ----------
const N_SPIKE = 13, SPIKE_L = 10; // 猜的，可調整
const spikyshield = {
  time: () => ({ dur: 1.4, hit: null }),
  update(pet, m, t) {
    // 抖完以後刺往外噴一點碎片
    if (t > 0.95 && !m.s) {
      m.s = true;
      const S = pet.S, r = pet.rect(), R = Math.max(r.w, r.h) * 0.8 + 10 * S;
      for (let i = 0; i < N_SPIKE; i++) {
        const a = Math.PI + (Math.PI * (i + 0.5)) / N_SPIKE;
        pet.stage.fx.add({ rect: i % 2 ? PALE : GREEN, size: 1.5 * S, x: pet.x + Math.cos(a) * R, y: pet.gy + Math.sin(a) * R, vx: Math.cos(a) * 90 * S, vy: Math.sin(a) * 90 * S, g: 200 * S, life: 0.4 });
      }
    }
  },
  draw(ctx, pet, m, t) {
    const S = pet.S, r = pet.rect(), cx = pet.x, gy = pet.gy, R = Math.max(r.w, r.h) * 0.8 + 10 * S;
    const grow = clamp01((t - 0.08) / 0.55), fade = t > 1.25 ? clamp01(1 - (t - 1.25) / 0.15) : 1;
    if (grow <= 0 || fade <= 0) return;
    const shake = t > 0.75 && t < 0.95 ? Math.sin(t * 90) * 1.5 * S : 0;
    const pt = a => ({ x: cx + Math.cos(a) * R * 0.9 + shake, y: gy - 2 * S + Math.sin(a) * R });
    // 先在地上往兩邊爬出根
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = DARK;
    ctx.lineWidth = 3 * S;
    const root = R * 0.9 + 26 * S * clamp01(t / 0.3);
    ctx.beginPath();
    for (let x = -root; x <= root; x += 3 * S) { const y = gy - 1 * S + Math.sin(x / (4 * S)) * S; x === -root ? ctx.moveTo(cx + x, y) : ctx.lineTo(cx + x, y); }
    ctx.stroke();
    ctx.restore();
    // 從左邊地上順時針長到右邊地上（半圓頂）
    const end = Math.PI + Math.PI * grow;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.lineCap = 'round';
    for (const [w, c] of [[6, DARK], [3.5, GREEN], [1, PALE]]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w * S;
      ctx.beginPath();
      for (let a = Math.PI; a <= end + 1e-6; a += 0.08) { const q = pt(a); a === Math.PI ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y); }
      ctx.stroke();
    }
    // 刺一根一根冒出來（朝外）
    ctx.fillStyle = PALE;
    ctx.strokeStyle = DARK;
    ctx.lineWidth = S;
    for (let i = 0; i < N_SPIKE; i++) {
      const a = Math.PI + (Math.PI * (i + 0.5)) / N_SPIKE;
      if (a > end) break;
      const q = pt(a), L = SPIKE_L * S * clamp01((end - a) / 0.3) * (shake ? 1.25 : 1), nx = Math.cos(a), ny = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(q.x - ny * 2 * S, q.y + nx * 2 * S);
      ctx.lineTo(q.x + nx * L, q.y + ny * L);
      ctx.lineTo(q.x + ny * 2 * S, q.y - nx * 2 * S);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (shake) { ctx.fillStyle = '#ffffff'; ctx.fillRect(q.x + nx * L - S, q.y + ny * L - S, 2 * S, 2 * S); ctx.fillStyle = PALE; } // 抖的時候刺尖一閃
    }
    ctx.restore();
  },
  pose(pet, p, m, t) { if (t < 0.6) { p.sx = 1.06; p.sy = 0.94; } }, // 蹲低
};

export const GRASS = { vinewhip, razorleaf, petalblizzard, hornleech, cottonspore, spikyshield };
