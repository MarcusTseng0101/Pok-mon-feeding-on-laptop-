// 蟲屬性 2 招，每一招自己的演出
//   吐絲 白絲射出去，繞著目標一圈一圈纏起來，目標變成半個繭，慢慢鬆開
//   蝶舞 自己左右搖擺，4 隻不同顏色的蝴蝶沿 8 字形繞著飛、撒亮粉
import { TAU, lerp, clamp01, rgba, glow } from './kit.js';

const SILK = '#f4f0f4', WHITE = '#ffffff', WINGS = ['#ff5d8f', '#ffd84a', '#7ab8ff', '#9be15d'];

// ---------- 吐絲 ----------
const SHOOT = [0.12, 0.38], WRAP = [0.4, 0.95], LOOSEN = [1.1, 1.5]; // 猜的，可調整
const targetBox = (m, K, S) => {
  if (K.isPet(m.target)) return m.target.rect();
  const b = K.targetPoint(m.target);
  return { x: b.x - 14 * S, y: b.y - 14 * S, w: 28 * S, h: 28 * S };
};
const stringshot = {
  time: () => ({ dur: 1.6, hit: SHOOT[1] + 0.01 }),
  update() {},
  draw(ctx, pet, m, t, K) {
    const S = pet.S, a = pet.mouth(), r = targetBox(m, K, S), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const fade = t > LOOSEN[0] ? clamp01(1 - (t - LOOSEN[0]) / (LOOSEN[1] - LOOSEN[0])) : 1;
    ctx.save();
    ctx.strokeStyle = SILK;
    ctx.lineCap = 'round';
    // 從嘴巴射出去的絲（纏的時候還連著，慢慢變淡）
    const u = clamp01((t - SHOOT[0]) / (SHOOT[1] - SHOOT[0]));
    if (u > 0 && t < WRAP[1] + 0.2) {
      ctx.globalAlpha = t > WRAP[1] ? 1 - (t - WRAP[1]) / 0.2 : 1;
      ctx.lineWidth = 1.5 * S;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      for (let i = 1; i <= 12; i++) { const v = (i / 12) * u; ctx.lineTo(lerp(a.x, cx, v), lerp(a.y, cy, v) + Math.sin(v * Math.PI) * 5 * S + Math.sin(v * 20 + t * 30) * S); }
      ctx.stroke();
    }
    // 一圈一圈纏上去（由下往上，越纏越多圈）
    const w = clamp01((t - WRAP[0]) / (WRAP[1] - WRAP[0]));
    if (w > 0 && fade > 0) {
      ctx.globalAlpha = fade;
      const loops = 6, done = w * loops;
      ctx.lineWidth = 1.2 * S;
      for (let i = 0; i < Math.ceil(done); i++) {
        const y = r.y + r.h * (0.95 - i * 0.1) + (1 - fade) * 6 * S * (i % 2 ? 1 : -1); // 鬆開的時候一圈一圈滑開
        const part = Math.min(1, done - i);
        ctx.beginPath();
        ctx.ellipse(cx, y, r.w * 0.55, 3 * S, (i % 2 ? 0.12 : -0.12), 0, TAU * part);
        ctx.stroke();
      }
      // 半個繭：下半身包成白色
      if (w > 0.5) {
        ctx.fillStyle = rgba(SILK, 0.55 * clamp01((w - 0.5) * 2) * fade);
        ctx.beginPath();
        ctx.ellipse(cx, r.y + r.h * 0.78, r.w * 0.52, r.h * 0.3, 0, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  },
  pose(pet, p, m, t) { if (t > SHOOT[0] && t < WRAP[1]) { p.rot = pet.facing * Math.sin(t * 25) * 0.05; p.sx = 1.03; } }, // 一直吐
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    st.fx.burst(at.x, at.y, S, [SILK, WHITE], { n: 6, speed: 60, spread: TAU, g: 60, life: 0.5, size: S / 2 });
  },
};

// ---------- 蝶舞 ----------
function butterfly(ctx, x, y, s, flap, col, ang) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = col;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * s * 0.55 * flap, -s * 0.2, s * 0.6 * flap, s * 0.5, side * 0.4, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(side * s * 0.4 * flap, s * 0.35, s * 0.4 * flap, s * 0.32, -side * 0.3, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#3a2a2a';
  ctx.fillRect(-s * 0.08, -s * 0.5, s * 0.16, s);
  ctx.restore();
}
const quiverdance = {
  time: () => ({ dur: 1.6, hit: null }),
  update(pet, m, t, dt) {
    // 撒亮粉
    if (t > 0.1 && t < 1.3 && Math.random() < dt * 30) {
      const S = pet.S, i = Math.floor(Math.random() * 4), q = wingPos(pet, t, i);
      pet.stage.fx.add({ rect: WINGS[i], size: S, x: q.x, y: q.y, vy: 20 * S, life: 0.7, blink: true });
    }
  },
  draw(ctx, pet, m, t) {
    const S = pet.S, k = clamp01(t / 0.2) * (t > 1.35 ? clamp01(1 - (t - 1.35) / 0.25) : 1);
    if (k <= 0) return;
    glow(ctx, () => {
      const r = pet.rect(), g = ctx.createRadialGradient(pet.x, r.y + r.h / 2, 0, pet.x, r.y + r.h / 2, r.w);
      g.addColorStop(0, rgba('#ffd6ea', 0.35 * k));
      g.addColorStop(1, rgba('#ffd6ea', 0));
      ctx.fillStyle = g;
      ctx.fillRect(pet.x - r.w, r.y + r.h / 2 - r.w, r.w * 2, r.w * 2);
    });
    ctx.save();
    ctx.globalAlpha = k;
    for (let i = 0; i < 4; i++) { const q = wingPos(pet, t, i), flap = 0.35 + 0.65 * Math.abs(Math.sin(t * 22 + i)); butterfly(ctx, q.x, q.y, 10 * S, flap, WINGS[i], Math.sin(t * 5 + i) * 0.4); }
    ctx.restore();
  },
  pose(pet, p, m, t) { if (t < 1.4) { p.rot = Math.sin(t * 9) * 0.14; p.ox = Math.sin(t * 9) * 2; } }, // 左右搖擺跳舞
};
// 8 字形：每隻相位不同
function wingPos(pet, t, i) {
  const S = pet.S, r = pet.rect(), cx = pet.x, cy = r.y + r.h * 0.45, a = t * 3.2 + (i / 4) * TAU;
  return { x: cx + Math.sin(a) * (r.w * 0.8 + 22 * S), y: cy + Math.sin(a * 2) * (r.h * 0.45 + 10 * S) };
}

export const BUG = { stringshot, quiverdance };
