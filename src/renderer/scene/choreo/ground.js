// 地面屬性 3 招，每一招自己的演出
//   泥巴射擊 一串又平又快的泥塊，每塊拖一條棕色線，打到身上黏泥點
//   重踏     自己跺腳 2 下，每下一個地面隆起的波往外跑，波經過的夥伴跳一下
//   千箭齊發 很多綠箭先往天上射，停一下，再密集落在目標那一柱，插在地上一圈
import * as FX from '../movefx.js';
import { lerp, rgba, part, groundOf, mover, ribbon } from './kit.js';

const MUD = '#9a6a3a', MUD2 = '#c8955a', DARKMUD = '#5a3a1a', GREEN = '#3ad06a', DARKGREEN = '#0e3a1a', PALEGREEN = '#a8ffc0';

// ---------- 泥巴射擊 ----------
const CLUMPS = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45], CLUMP_FLY = 0.25; // 猜的，可調整
function clump(ctx, x, y, r, seed) {
  ctx.save();
  ctx.fillStyle = MUD;
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 2, rr = r * (0.8 + ((seed * 7 + i * 3) % 5) * 0.08); i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8); }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = DARKMUD;
  ctx.fillRect(x - r * 0.3, y, r * 0.35, r * 0.35);
  ctx.fillStyle = MUD2;
  ctx.fillRect(x - r * 0.4, y - r * 0.45, r * 0.3, r * 0.25);
  ctx.restore();
}
// 地上的一灘泥（留一下）
function groundSplat(stage, x, y) {
  const S = stage.S;
  part(stage, { x, y, life: 1.2, draw: (ctx, p, k) => { ctx.save(); ctx.globalAlpha = 0.85 * (k > 0.6 ? (1 - k) / 0.4 : 1); ctx.fillStyle = MUD; ctx.beginPath(); ctx.ellipse(p.x, p.y, 9 * S * Math.min(1, k * 8), 2.5 * S, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = DARKMUD; ctx.fillRect(p.x - 3 * S, p.y - S, 2 * S, S); ctx.restore(); } });
  stage.fx.burst(x, y, S, [MUD, MUD2], { n: 3, speed: 50, dir: -Math.PI / 2, spread: 1.6, g: 300, life: 0.35, size: S / 2 });
}
const mudshot = {
  time: () => ({ dur: 1.2, hit: CLUMPS[5] + CLUMP_FLY + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= { n: 0 });
    while (s.n < CLUMPS.length && t >= CLUMPS[s.n]) {
      const i = s.n++, a = pet.mouth(), b = K.targetPoint(m.target), dy = [0, -4, 3, -2, 5, 0][i] * S, splat = (m.splat ??= []);
      mover(st, {
        life: CLUMP_FLY, S,
        path: k => ({ x: lerp(a.x, b.x, k), y: lerp(a.y + dy * 0.3, b.y + dy, k) }),
        onStep: (q, k) => { if (!splat[i] && k > 0.3 + i * 0.08) { splat[i] = true; groundSplat(st, q.x, pet.gy + ((i * 5) % 7 - 3) * S); } }, // 沿路甩到地上的泥
        drawAt: (ctx, q, p) => { ribbon(ctx, p.hist, S, MUD2, 4, 0.8); clump(ctx, q.x, q.y, 7 * S, i); },
        onArrive: q => {
          // 黏在身上的泥點
          part(st, { x: q.x + (i - 2.5) * 3 * S, y: q.y, life: 1.1, draw: (ctx, p, k) => { ctx.save(); ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1; clump(ctx, p.x, p.y + k * 4 * S, 4.5 * S, i + 3); ctx.restore(); } });
          st.fx.burst(q.x, q.y, S, [MUD, MUD2], { n: 3, speed: 70, dir: Math.PI, spread: 1.4, g: 300, life: 0.4, size: S / 2 });
          if (i === CLUMPS.length - 1 && pet.moveCtx === m) K.hit(pet);
        },
      });
    }
  },
  pose(pet, p, m, t) { if (t > CLUMPS[0] - 0.05 && t < CLUMPS[5] + 0.1) p.ox = Math.sin(t * 60) * 1.5; }, // 連射的後座力
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    st.fx.burst(at.x, at.y, S, [MUD, MUD2, DARKMUD], { n: 10, speed: 110, spread: Math.PI * 2, g: 320, life: 0.55, size: S });
    FX.smoke(st, at.x, at.y + 6 * S, 18);
  },
};

// ---------- 重踏 ----------
const STOMPS = [0.25, 0.6], WAVE_V = 380, WAVE_LIFE = 0.9; // 波的速度（裝置像素／秒，乘 S/2）；猜的，可調整
// 地面隆起的波：一段拱起的土，往兩邊跑
function wave(stage, x0, y, dir, onPass) {
  const S = stage.S, passed = new Set();
  part(stage, {
    x: x0, y, life: WAVE_LIFE,
    tick: (p, dt) => {
      const x = p.x0 ?? (p.x0 = p.x);
      const cx = x + dir * WAVE_V * (S / 2) * (p.t + dt);
      onPass?.(cx, passed);
      if (Math.random() < dt * 20) FX.smoke(stage, cx, y - 2 * S, 16);
      if (Math.random() < dt * 25) stage.fx.add({ rect: Math.random() < 0.5 ? MUD : DARKMUD, size: S, x: cx, y: y - 10 * S, vx: dir * 40 * S, vy: -(90 + Math.random() * 60) * S, g: 500 * S, life: 0.5 }); // 被頂起來的土塊
    },
    draw: (ctx, p, k) => {
      const cx = (p.x0 ?? p.x) + dir * WAVE_V * (S / 2) * p.t, h = 22 * S * (1 - k * 0.6), w = 30 * S;
      ctx.save();
      ctx.globalAlpha = 1 - k * 0.5;
      ctx.fillStyle = MUD;
      ctx.beginPath();
      ctx.moveTo(cx - w, y);
      ctx.quadraticCurveTo(cx - w * 0.3, y - h * 1.6, cx, y - h);
      ctx.quadraticCurveTo(cx + w * 0.3, y - h * 0.4, cx + w, y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = MUD2;
      ctx.lineWidth = S;
      ctx.stroke();
      ctx.fillStyle = DARKMUD;
      ctx.fillRect(cx - w * 0.2, y - h * 0.6, 2 * S, 2 * S);
      ctx.restore();
    },
  });
}
const bulldoze = {
  dimAt: 'between', // 波會跑到目標那邊
  time: () => ({ dur: 1.5, hit: 0.76 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= { n: 0 });
    while (s.n < STOMPS.length && t >= STOMPS[s.n]) {
      s.n++;
      st.shake(2, 0.15);
      FX.shockwave(st, pet.x, pet.gy, MUD2, 40, { flat: 0.3, thick: 4, life: 0.35 });
      for (let j = 0; j < 2; j++) FX.smoke(st, pet.x + (j ? 10 : -10) * S, pet.gy, 26);
      // 波經過的夥伴彈一下（用現有的 hopT：被撞到時彈一下的那個）
      const hop = (cx, passed) => {
        for (const o of st.pets.values()) {
          if (o === pet || passed.has(o) || o.floats) continue;
          if (Math.abs(o.x - cx) < 10 * S && Math.abs(o.gy - pet.gy) < 40 * S) { passed.add(o); o.hopT = 0.35; }
        }
      };
      for (const dir of [-1, 1]) wave(st, pet.x + dir * 10 * S, pet.gy, dir, hop);
    }
  },
  pose(pet, p, m, t) {
    for (const s of STOMPS) { const d = t - s + 0.12; if (d > 0 && d < 0.12) { p.sy = 1.08; p.sx = 0.94; } else if (d >= 0.12 && d < 0.22) { p.sy = 0.86; p.sx = 1.12; } } // 抬腳 → 踩下去
  },
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, g = groundOf(m, K, S);
    st.fx.burst(g.x, g.y, S, [MUD, MUD2], { n: 10, speed: 100, dir: -Math.PI / 2, spread: 2.2, g: 320, life: 0.6, size: S });
    FX.smoke(st, g.x, g.y, 26);
  },
};

// ---------- 千箭齊發 ----------
const UP = [0.15, 0.55], PAUSE = 0.8, RAIN = [0.8, 1.15], N_UP = 10, N_DOWN = 14; // 猜的，可調整
function arrow(ctx, x, y, ang, len, S, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 1.5 * S;
  ctx.beginPath();
  ctx.moveTo(-len, 0);
  ctx.lineTo(0, 0);
  ctx.stroke();
  ctx.fillStyle = PALEGREEN;
  ctx.beginPath();
  ctx.moveTo(3 * S, 0);
  ctx.lineTo(-2 * S, -2.5 * S);
  ctx.lineTo(-2 * S, 2.5 * S);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = DARKGREEN;
  ctx.fillRect(-len, -2 * S, 3 * S, 4 * S); // 箭羽
  ctx.restore();
}
const thousandarrows = {
  time: () => ({ dur: 1.8, hit: 1.0 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= { up: 0, down: 0 });
    // 往天上射
    while (s.up < N_UP && t >= lerp(UP[0], UP[1], s.up / N_UP)) {
      const i = s.up++, r = pet.rect(), x0 = pet.x + (i - N_UP / 2) * 2 * S, y0 = r.y;
      mover(st, { life: 0.35, S, path: k => ({ x: x0 + pet.facing * k * 20 * S, y: y0 - k * k * 260 * S }), drawAt: (ctx, q) => arrow(ctx, q.x, q.y, -Math.PI / 2 + pet.facing * 0.1, 12 * S, S) });
    }
    // 密集落在目標那一柱，插在地上
    while (t >= PAUSE && s.down < N_DOWN && t >= lerp(RAIN[0], RAIN[1], s.down / N_DOWN)) {
      const i = s.down++, g = groundOf(m, K, S), x = g.x + ((i * 37) % 13 - 6) * 4 * S, y = g.y + ((i * 11) % 5 - 2) * 2 * S;
      mover(st, {
        life: 0.22, S,
        path: k => ({ x: x - (1 - k) * 12 * S, y: lerp(y - 180 * S, y, k * k) }),
        drawAt: (ctx, q) => arrow(ctx, q.x, q.y, Math.PI / 2 - 0.08, 14 * S, S),
        onArrive: q => {
          // 插在地上一下
          part(st, { x: q.x, y: q.y, life: 0.9, draw: (ctx, p, k) => arrow(ctx, p.x, p.y, Math.PI / 2 - 0.08, 10 * S, S, k > 0.6 ? (1 - k) / 0.4 : 1) });
          st.fx.burst(q.x, q.y, S, [MUD, MUD2], { n: 2, speed: 50, dir: -Math.PI / 2, spread: 1.6, g: 260, life: 0.3, size: S / 2 });
        },
      });
    }
  },
  // 停一下的時候：天上一閃一閃的綠光
  draw(ctx, pet, m, t, K) {
    if (t < UP[1] || t > RAIN[0]) return;
    const S = pet.S, g = groundOf(m, K, S), k = (t - UP[1]) / (RAIN[0] - UP[1]);
    ctx.save();
    ctx.globalAlpha = 0.5 * Math.sin(k * Math.PI);
    ctx.fillStyle = rgba(GREEN, 0.5);
    for (let i = 0; i < 7; i++) ctx.fillRect(g.x + (i - 3) * 8 * S, g.y - 150 * S + ((i * 5) % 3) * 4 * S, 1.5 * S, 6 * S);
    ctx.restore();
  },
  pose(pet, p, m, t) { if (t > UP[0] && t < UP[1]) { p.sy = 1.08; p.rot = -pet.facing * 0.15; } }, // 往上射
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, g = groundOf(m, K, S);
    FX.shockwave(st, g.x, g.y, PALEGREEN, 34, { flat: 0.3, thick: 3 });
    st.fx.burst(g.x, g.y, S, [MUD, MUD2, GREEN], { n: 10, speed: 110, dir: -Math.PI / 2, spread: 2, g: 320, life: 0.55, size: S });
  },
};

export const GROUND = { mudshot, bulldoze, thousandarrows };
