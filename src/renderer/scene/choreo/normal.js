// 一般屬性 4 招，每一招自己的演出
//   撞擊     往後縮蓄力 → 帶速度線衝過去 → 自己壓扁、目標彈開（最基本的，其他衝撞招都比它多一樣東西）
//   巨聲     嘴巴發出 3 道大弧形聲波「)))」只往前跑，目標跟著震
//   爆音波   先吸氣變大 → 四面八方的鋸齒圈炸開，附近的夥伴全部彈一下
//   甜甜香氣 粉紅色波浪香氣線橫著慢慢飄過去，目標聞到冒愛心（不推開）
import * as FX from '../movefx.js';
import { TAU, lerp, clamp01, rgba, glow, part } from './kit.js';

const WHITE = '#ffffff', GRAY = '#b8b0a0', CREAM = '#fff6c0', VIOLET = '#c070ff', PINK = '#ffb0d0', PINK2 = '#ffd6ea';

// ---------- 撞擊 ----------
const WIND = 0.2, RUSH = 0.4, TK_BACK = [0.5, 0.85]; // 猜的，可調整
const tackle = {
  time: () => ({ dur: TK_BACK[1] + 0.05, hit: RUSH }),
  update(pet, m, t, dt, K) {
    const k = t < WIND ? -0.08 * (t / WIND) : t < RUSH ? lerp(-0.08, 1, ((t - WIND) / (RUSH - WIND)) ** 2) : t < TK_BACK[0] ? 1 : Math.max(0, 1 - (t - TK_BACK[0]) / (TK_BACK[1] - TK_BACK[0]));
    K.dash(pet, m, k);
    if (t > WIND && t < RUSH && Math.random() < dt * 40) FX.streaks(pet);
  },
  pose(pet, p, m, t) {
    if (t < WIND) { p.sx = 0.9; p.sy = 1.08; p.rot = -pet.facing * 0.1; } // 往後縮
    else if (t < RUSH) p.rot = pet.facing * 0.15; // 往前衝
    else if (t < RUSH + 0.15) { p.sx = 1.2; p.sy = 0.82; } // 撞到：自己壓扁
  },
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    st.fx.stars(at.x, at.y, S, 5);
    FX.shockwave(st, at.x, at.y, WHITE, 36, { thick: 3 });
    FX.smoke(st, at.x, at.y + 8 * S, 20);
  },
};

// ---------- 巨聲 ----------
const WAVES = [0.2, 0.35, 0.5], WAVE_T = 0.45; // 猜的，可調整
const hypervoice = {
  dimAt: 'between',
  time: () => ({ dur: 1.3, hit: WAVES[1] + WAVE_T - 0.05 }),
  update(pet, m, t, dt, K) {
    const s = (m.s ??= { n: 0 });
    // 目標跟著聲波一下一下震
    if (K.isPet(m.target) && s.n < 3 && t > WAVES[s.n] + WAVE_T * 0.85) { s.n++; m.target.hopT = 0.25; }
  },
  draw(ctx, pet, m, t, K) {
    const S = pet.S, a = pet.mouth(), b = K.targetPoint(m.target), dir = b.x > a.x ? 1 : -1, dist = Math.abs(b.x - a.x) + 20 * S;
    ctx.save();
    ctx.lineCap = 'round';
    WAVES.forEach(w0 => {
      const u = (t - w0) / WAVE_T;
      if (u < 0 || u > 1.15) return;
      const x = a.x + dir * dist * Math.min(1, u), R = (10 + 30 * Math.min(1, u)) * S, alpha = u > 1 ? (1.15 - u) / 0.15 : 1;
      ctx.globalAlpha = alpha;
      for (const [w, c] of [[6, GRAY], [3, WHITE]]) {
        ctx.strokeStyle = c;
        ctx.lineWidth = w * S;
        ctx.beginPath();
        // 往前開口的大弧「)」
        ctx.arc(x - dir * R, a.y + (b.y - a.y) * Math.min(1, u), R, dir > 0 ? -0.9 : Math.PI - 0.9, dir > 0 ? 0.9 : Math.PI + 0.9);
        ctx.stroke();
      }
    });
    ctx.restore();
  },
  pose(pet, p, m, t) { if (t > WAVES[0] - 0.05 && t < WAVES[2] + 0.1) { p.sy = 1.08 + Math.sin(t * 60) * 0.03; p.rot = -pet.facing * 0.08; } }, // 大聲喊
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    FX.hitSpark(st, at.x, at.y, CREAM, 20, 8);
    st.fx.burst(at.x, at.y, S, [WHITE, CREAM], { n: 8, speed: 100, spread: TAU, g: 60, life: 0.4, size: S / 2 });
  },
};

// ---------- 爆音波 ----------
const INHALE = 0.45, BURSTS = [0.45, 0.58, 0.71]; // 猜的，可調整
function jagRing(ctx, x, y, r, S, col, alpha, seed) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = col;
  ctx.lineWidth = 3 * S;
  ctx.beginPath();
  for (let i = 0; i <= 28; i++) { const a = (i / 28) * TAU, rr = r * (i % 2 ? 0.9 : 1.08) + Math.sin(i * 3 + seed) * S; const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.7; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}
const boomburst = {
  time: () => ({ dur: 1.4, hit: BURSTS[0] + 0.05 }),
  update(pet, m, t) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= { n: 0 });
    while (s.n < BURSTS.length && t >= BURSTS[s.n]) {
      s.n++;
      st.shake(4, 0.2);
      // 附近的夥伴全部彈一下
      for (const o of st.pets.values()) if (o !== pet && Math.hypot(o.x - pet.x, o.gy - pet.gy) < 200 * S) o.hopT = 0.3;
    }
  },
  draw(ctx, pet, m, t) {
    const S = pet.S, r = pet.rect(), cx = pet.x, cy = r.y + r.h * 0.5;
    if (t < INHALE) {
      // 吸氣：空氣的線往自己收
      ctx.save();
      ctx.strokeStyle = rgba(WHITE, 0.7);
      ctx.lineWidth = S;
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU, u = (t * 3 + i * 0.3) % 1, d0 = (60 - 44 * u) * S; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * d0, cy + Math.sin(a) * d0 * 0.7); ctx.lineTo(cx + Math.cos(a) * (d0 - 10 * S), cy + Math.sin(a) * (d0 - 10 * S) * 0.7); ctx.stroke(); }
      ctx.restore();
      return;
    }
    BURSTS.forEach((b0, i) => {
      const u = (t - b0) / 0.6;
      if (u < 0 || u > 1) return;
      jagRing(ctx, cx, cy, (14 + 110 * (1 - (1 - u) ** 2)) * S, S, i % 2 ? VIOLET : WHITE, 1 - u, i);
    });
  },
  pose(pet, p, m, t) {
    if (t < INHALE) { const k = t / INHALE; p.sx = 1 + 0.15 * k; p.sy = 1 + 0.15 * k; } // 吸氣變大
    else if (t < BURSTS[2] + 0.1) { p.sx = 0.95; p.sy = 1.05 + Math.sin(t * 70) * 0.04; } // 吼出去
  },
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    st.fx.burst(at.x, at.y, S, [WHITE, VIOLET], { n: 10, speed: 130, spread: TAU, g: 80, life: 0.45, size: S / 2 });
    FX.hitSpark(st, at.x, at.y, VIOLET, 24, 10);
  },
};

// ---------- 甜甜香氣 ----------
const DRIFT = [0.2, 1.2], SWEET_HIT = 1.0; // 猜的，可調整
const sweetscent = {
  knock: 0, // 聞香味不會被推開
  dimAt: 'between',
  time: () => ({ dur: 1.7, hit: SWEET_HIT }),
  update(pet, m, t, dt, K) {
    if (t > DRIFT[0] && t < DRIFT[1] && Math.random() < dt * 10) {
      const b = K.targetPoint(m.target), a = pet.mouth(), u = clamp01((t - DRIFT[0]) / (DRIFT[1] - DRIFT[0]));
      pet.stage.fx.sparkles(lerp(a.x, b.x, u), lerp(a.y, b.y, u) + (Math.random() - 0.5) * 20 * pet.S, pet.S, 1, 3);
    }
  },
  draw(ctx, pet, m, t, K) {
    const S = pet.S, a = pet.mouth(), b = K.targetPoint(m.target);
    const u = clamp01((t - DRIFT[0]) / (DRIFT[1] - DRIFT[0])), fade = t > 1.35 ? clamp01(1 - (t - 1.35) / 0.3) : 1;
    if (u <= 0 || fade <= 0) return;
    // 3 條粉紅波浪線，前端慢慢飄向目標
    glow(ctx, () => {
      for (let j = 0; j < 3; j++) {
        ctx.strokeStyle = rgba(j % 2 ? PINK2 : PINK, 0.8 * fade);
        ctx.lineWidth = 2.5 * S;
        ctx.beginPath();
        for (let i = 0; i <= 30; i++) {
          const v = (i / 30) * u, x = lerp(a.x, b.x, v), y = lerp(a.y, b.y, v) + (j - 1) * 9 * S + Math.sin(v * 14 - t * 5 + j * 2) * 5 * S;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
    });
  },
  pose(pet, p, m, t) { if (t < DRIFT[1]) p.rot = Math.sin(t * 5) * 0.08; }, // 輕輕搖
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S;
    st.fx.hearts(at.x, at.y - 12 * S, S, 3); // 聞到了，冒愛心
    if (K.isPet(m.target)) m.target.hopT = 0.3;
    part(st, { x: at.x, y: at.y, life: 0.6, draw: (ctx, p, k) => glow(ctx, () => { const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 30 * S); g.addColorStop(0, rgba(PINK2, 0.5 * (1 - k))); g.addColorStop(1, rgba(PINK, 0)); ctx.fillStyle = g; ctx.fillRect(p.x - 30 * S, p.y - 30 * S, 60 * S, 60 * S); }) });
  },
};

export const NORMAL = { tackle, hypervoice, boomburst, sweetscent };
