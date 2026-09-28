// 電屬性 3 招，每一招自己的演出
//   電擊       鋸齒閃電每 2 幀換一次形狀，閃 3 下；目標黑白交替閃（觸電）
//   拋物面充電 頭上撐起碟形電弧，電花從目標沿拋物線一顆一顆跳回碟子，自己亮黃光
//   蹭蹭臉頰   走到目標旁邊左右蹭 3 下（不擊退），臉頰冒小電花，目標身上留靜電毛毛
import * as FX from '../movefx.js';
import { TAU, lerp, clamp01, rgba, glow, part, mover } from './kit.js';

const YELLOW = '#ffd84a', PALE = '#fffbd0', WHITE = '#ffffff';

// 鋸齒線：seed 一樣形狀就一樣
function boltPts(a, b, seed, jag, n = 8) {
  let s = (seed * 9301 + 49297) % 233280;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  const pts = [a];
  for (let i = 1; i < n; i++) { const u = i / n, off = (r() - 0.5) * 2 * jag; pts.push({ x: a.x + dx * u + nx * off, y: a.y + dy * u + ny * off }); }
  pts.push(b);
  return pts;
}
function strokeBolt(ctx, pts, S, width = 1, alpha = 1) {
  glow(ctx, () => {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [w, c, a] of [[8, YELLOW, 0.3], [3.5, YELLOW, 1], [1.5, PALE, 1], [0.6, WHITE, 1]]) {
      ctx.globalAlpha = a * alpha;
      ctx.strokeStyle = c;
      ctx.lineWidth = w * S * width;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
  });
}
// 小電花（鋸齒短線），在 (x, y) 附近亂跳
function zap(stage, x, y, len = 10, life = 0.12) {
  const S = stage.S, a = Math.random() * TAU, seed = Math.floor(Math.random() * 1e5);
  const b = { x: x + Math.cos(a) * len * S, y: y + Math.sin(a) * len * S };
  part(stage, { x, y, life, draw: (ctx, p, k) => strokeBolt(ctx, boltPts({ x, y }, b, seed, 3 * S, 4), S, 0.4, 1 - k) });
}

// ---------- 電擊 ----------
const FLASH = [[0.3, 0.42], [0.5, 0.62], [0.7, 0.85]]; // 閃 3 下；猜的，可調整
const flashOn = t => FLASH.some(([a, b]) => t >= a && t < b);
const thundershock = {
  time: () => ({ dur: 1.2, hit: FLASH[1][0] + 0.01 }),
  update(pet, m, t, dt, K) {
    const s = (m.s ??= {});
    // 每一下閃的開頭：嘴邊和目標身上爆一下電花
    FLASH.forEach(([a], i) => {
      if (t >= a && !s[i]) {
        s[i] = true;
        const b = K.targetPoint(m.target);
        for (let j = 0; j < 3; j++) zap(pet.stage, b.x, b.y, 12);
        if (K.isPet(m.target)) m.target.flinchT = 0.2;
      }
    });
  },
  draw(ctx, pet, m, t, K) {
    if (t > 0.2 && t < 0.9) {
      const S = pet.S, r = pet.rect(), seed = Math.floor(t * 15);
      for (let i = 0; i < 5; i++) { const ang = (i / 5) * TAU + seed, cx = pet.x + Math.cos(ang) * r.w * 0.45, cy = r.y + r.h / 2 + Math.sin(ang) * r.h * 0.45; strokeBolt(ctx, boltPts({ x: cx, y: cy }, { x: cx + Math.cos(ang) * 9 * S, y: cy + Math.sin(ang) * 9 * S }, seed * 3 + i, 3 * S, 3), S, 0.45); }
    }
    if (!flashOn(t)) return;
    const S = pet.S, a = pet.mouth(), b = K.targetPoint(m.target), seed = Math.floor(t * 15); // 每 2 幀換形狀
    const pts = boltPts(a, b, seed, 22 * S, 9);
    strokeBolt(ctx, pts, S, 1.4);
    // 分岔
    const i = 3 + (seed % 4), q = pts[i];
    strokeBolt(ctx, boltPts(q, { x: q.x + (seed % 2 ? 1 : -1) * 10 * S, y: q.y + 18 * S }, seed + 7, 4 * S, 4), S, 0.5);
  },
  pose(pet, p, m, t) { if (flashOn(t)) { p.sx = 1.05; p.sy = 1.05; } }, // 放電時全身繃緊
  // 放電的時候全身劈哩啪啦（身上一圈小閃電）
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S;
    const r = K.isPet(m.target) ? m.target.rect() : { x: at.x - 14 * S, y: at.y - 14 * S, w: 28 * S, h: 28 * S };
    // 觸電：目標黑白交替閃
    part(st, {
      x: at.x, y: at.y, life: 0.45,
      draw: (ctx, p) => {
        const on = Math.floor(p.t * 20) % 2;
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = on ? WHITE : '#1a1a2a';
        ctx.beginPath();
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w * 0.55, r.h * 0.55, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      },
    });
    for (let i = 0; i < 5; i++) zap(st, at.x, at.y, 16, 0.2);
    FX.hitSpark(st, at.x, at.y, YELLOW, 20, 8);
  },
};

// ---------- 拋物面充電 ----------
const HOPS = [0.55, 0.68, 0.81, 0.94, 1.07], HOP_T = 0.35; // 電花出發的時間、飛多久；猜的，可調整
const dishAt = pet => { const r = pet.rect(); return { x: pet.x, y: r.y - 12 * pet.S }; };
const paraboliccharge = {
  dimAt: 'between',
  time: () => ({ dur: 1.65, hit: HOPS[0] }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= { n: 0 });
    while (s.n < HOPS.length && t >= HOPS[s.n]) {
      s.n++;
      const b = K.targetPoint(m.target), a = { x: b.x + (Math.random() - 0.5) * 10 * S, y: b.y };
      zap(st, b.x, b.y, 14); // 從目標身上被吸出來
      // 從目標沿拋物線跳回碟子
      mover(st, {
        life: HOP_T, S,
        path: k => { const d = dishAt(pet); return { x: lerp(a.x, d.x, k), y: lerp(a.y, d.y, k) - Math.sin(k * Math.PI) * 45 * S }; },
        drawAt: (ctx, q, p) => { glow(ctx, () => { const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 6 * S); g.addColorStop(0, rgba(WHITE, 1)); g.addColorStop(0.4, rgba(YELLOW, 0.9)); g.addColorStop(1, rgba(YELLOW, 0)); ctx.fillStyle = g; ctx.fillRect(q.x - 6 * S, q.y - 6 * S, 12 * S, 12 * S); }); if (p.hist?.length > 2) strokeBolt(ctx, p.hist, S, 0.6, 0.9); },
        onArrive: () => { const c = pet.rect(); FX.blob(st, { x: pet.x, y: c.y + c.h / 2, s0: c.w / S * 0.7, s1: c.w / S * 1.2, a0: 0.4, a1: 0, life: 0.25, col: YELLOW }); zap(st, dishAt(pet).x, dishAt(pet).y, 12); },
      });
    }
  },
  // 碟子：開口朝上的弧線，邊緣冒電
  draw(ctx, pet, m, t) {
    const k = clamp01(t / 0.3), fade = t > 1.4 ? clamp01(1 - (t - 1.4) / 0.25) : 1;
    if (k <= 0 || fade <= 0) return;
    const S = pet.S, d = dishAt(pet), w = 34 * S * k;
    glow(ctx, () => {
      ctx.globalAlpha = fade;
      for (const [lw, c] of [[5, rgba(YELLOW, 0.4)], [2, YELLOW], [0.8, WHITE]]) {
        ctx.strokeStyle = c;
        ctx.lineWidth = lw * S;
        ctx.beginPath();
        for (let i = 0; i <= 16; i++) { const u = i / 16 * 2 - 1; const x = d.x + u * w, y = d.y - u * u * 16 * S * k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      ctx.strokeStyle = YELLOW;
      ctx.lineWidth = S;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x, d.y + 10 * S * k); // 碟子的柄
      ctx.stroke();
    });
  },
  pose(pet, p, m, t) { if (t < 1.4) { p.sy = 1.04; p.rot = Math.sin(t * 30) * 0.03; } }, // 撐著碟子
  impact(pet, m, at) {
    const st = pet.stage;
    for (let i = 0; i < 4; i++) zap(st, at.x, at.y, 14, 0.2);
    FX.hitSpark(st, at.x, at.y, YELLOW, 16, 6);
  },
};

// ---------- 蹭蹭臉頰 ----------
const WALK = 0.4, RUB = 0.5, BACK = 0.35; // 猜的，可調整
const nuzzle = {
  knock: 0, // 蹭蹭不會把對方推開
  time: () => ({ dur: WALK + RUB + BACK + 0.1, hit: WALK + RUB }),
  update(pet, m, t, dt, K) {
    const k = t < WALK ? (t / WALK) * (2 - t / WALK) : t < WALK + RUB ? 1 : Math.max(0, 1 - (t - WALK - RUB) / BACK);
    K.dash(pet, m, k);
    if (t > WALK && t < WALK + RUB && Math.random() < dt * 20) {
      const r = pet.rect();
      zap(pet.stage, pet.x + pet.facing * r.w * 0.3, r.y + r.h * 0.45, 7); // 臉頰冒小電花
    }
  },
  // 左右蹭 3 下
  pose(pet, p, m, t) {
    if (t > WALK && t < WALK + RUB) { const u = (t - WALK) / RUB; p.rot = Math.sin(u * 3 * TAU) * 0.18; p.ox = Math.sin(u * 3 * TAU) * 2; }
  },
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S;
    const r = K.isPet(m.target) ? m.target.rect() : { x: at.x - 14 * S, y: at.y - 14 * S, w: 28 * S, h: 28 * S };
    // 靜電毛毛：身上一圈小鋸齒線一直閃
    part(st, {
      x: at.x, y: at.y, life: 1.1,
      draw: (ctx, p, k) => {
        const seed = Math.floor(p.t * 12);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + seed, cx = r.x + r.w / 2 + Math.cos(a) * r.w * 0.5, cy = r.y + r.h / 2 + Math.sin(a) * r.h * 0.45;
          strokeBolt(ctx, boltPts({ x: cx, y: cy }, { x: cx + Math.cos(a) * 6 * S, y: cy + Math.sin(a) * 6 * S }, seed * 7 + i, 2 * S, 3), S, 0.3, 1 - k);
        }
      },
    });
    st.fx.hearts(at.x, at.y - 10 * S, S, 1);
  },
};

export const ELECTRIC = { thundershock, paraboliccharge, nuzzle };
