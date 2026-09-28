// 格鬥屬性 3 招，每一招自己的演出
//   猛推     往前一步，張開的手掌高低交錯連推 5 下，目標一點一點往後退，第 5 下才算打中
//   波導彈   線從四周往自己收（聚氣），藍色球射出去會微微轉彎追過去，打中升起藍色光柱
//   飛身重壓 蹲低 → 高高跳起（頂點縮小一點、速度線）→ 目標腳下影子越變越大 → 砸下來，目標被壓扁
import * as FX from '../movefx.js';
import { knockFrom } from '../physics.js';
import { TAU, lerp, clamp01, rgba, glow, part, groundOf, mover, ribbon, ripple } from './kit.js';

const WHITE = '#ffffff', GOLD = '#ffe066', RED = '#e05a3a', AURA = '#5aa0f0', AURA2 = '#8ae8ff', DUST = '#e0c090';

// ---------- 猛推 ----------
const STEP = 0.25, PUSH = [0.35, 0.47, 0.59, 0.71, 0.83], RETURN = [0.95, 1.3]; // 猜的，可調整
function palm(ctx, x, y, s, dir, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir * s, s);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = WHITE;
  ctx.strokeStyle = RED;
  ctx.lineWidth = 1.2 / s;
  // 手掌＋4 根手指＋大拇指（朝前推）
  ctx.beginPath();
  ctx.ellipse(0, 0, 5, 6, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.rect(3, -5.5 + i * 3, 6, 2.4); ctx.fill(); ctx.stroke(); }
  ctx.beginPath();
  ctx.rect(-2, 5, 5, 2.4);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
const armthrust = {
  time: () => ({ dur: RETURN[1] + 0.1, hit: PUSH[4] + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    K.dash(pet, m, t < STEP ? (t / STEP) * 0.9 : t < RETURN[0] ? 0.9 : Math.max(0, 0.9 * (1 - (t - RETURN[0]) / (RETURN[1] - RETURN[0]))));
    const s = (m.s ??= { n: 0 });
    while (s.n < PUSH.length && t >= PUSH[s.n]) {
      const i = s.n++, b = K.targetPoint(m.target), dir = b.x > pet.x ? 1 : -1;
      const x = b.x - dir * 10 * S, y = b.y + (i % 2 ? 8 : -8) * S;
      part(st, { x, y, life: 0.18, draw: (ctx, p, k) => palm(ctx, p.x, p.y, S * (1.6 - k * 0.5), dir, 1 - k) });
      if (i < PUSH.length - 1) {
        st.fx.stars(x + dir * 6 * S, y, S, 1);
        st.shake(1.5, 0.08);
        if (K.isPet(m.target)) { m.target.flinchT = 0.12; knockFrom(m.target, pet.x, pet.gy, 60); } // 一點一點往後退（小小的擊退）
      }
    }
  },
  pose(pet, p, m, t) { if (t > PUSH[0] - 0.05 && t < PUSH[4] + 0.1) p.ox = Math.sin((t - PUSH[0]) / 0.12 * TAU) * 2; }, // 一下一下往前推
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    const dir = at.x > pet.x ? 1 : -1;
    part(st, { x: at.x - dir * 8 * S, y: at.y, life: 0.3, draw: (ctx, p, k) => palm(ctx, p.x, p.y, S * (2.2 - k), dir, 1 - k) });
    FX.hitSpark(st, at.x, at.y, GOLD, 24, 8);
    st.fx.stars(at.x, at.y, S, 4);
  },
};

// ---------- 波導彈 ----------
const GATHER = 0.5, LAUNCH = 0.55, AS_FLY = 0.45; // 猜的，可調整
const handAt = pet => { const r = pet.rect(); return { x: pet.x + pet.facing * r.w * 0.45, y: r.y + r.h * 0.55 }; };
function auraBall(ctx, x, y, r, t) {
  glow(ctx, () => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.8);
    g.addColorStop(0, rgba(WHITE, 1));
    g.addColorStop(0.3, rgba(AURA2, 0.9));
    g.addColorStop(0.6, rgba(AURA, 0.5));
    g.addColorStop(1, rgba(AURA, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 1.8, y - r * 1.8, r * 3.6, r * 3.6);
    ctx.strokeStyle = rgba(AURA2, 0.8);
    ctx.lineWidth = Math.max(1, r / 6);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.2, r * 0.5, t * 6, 0, TAU); // 繞著轉的一圈
    ctx.stroke();
  });
}
const aurasphere = {
  time: () => ({ dur: 1.45, hit: LAUNCH + AS_FLY + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    if (t >= LAUNCH && !m.s) {
      m.s = true;
      const a = handAt(pet), b0 = K.targetPoint(m.target), up = -34 * S;
      mover(st, {
        life: AS_FLY, S,
        // 微微轉彎追過去（終點跟著目標）
        path: k => { const b = m.target && pet.moveCtx === m ? K.targetPoint(m.target) : b0, c = { x: lerp(a.x, b.x, 0.5), y: lerp(a.y, b.y, 0.5) + up }; return { x: (1 - k) ** 2 * a.x + 2 * (1 - k) * k * c.x + k * k * b.x, y: (1 - k) ** 2 * a.y + 2 * (1 - k) * k * c.y + k * k * b.y }; },
        drawAt: (ctx, q, p) => { ribbon(ctx, p.hist, S, AURA2, 5, 0.6); auraBall(ctx, q.x, q.y, 7 * S, p.t); },
        onArrive: () => { if (pet.moveCtx === m) K.hit(pet); },
      });
    }
  },
  // 聚氣：8 條線從四周往手上收，球越來越大
  draw(ctx, pet, m, t) {
    if (t >= LAUNCH) return;
    const S = pet.S, h = handAt(pet), k = clamp01(t / GATHER);
    glow(ctx, () => {
      ctx.strokeStyle = rgba(AURA2, 0.8);
      ctx.lineWidth = S;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.2, u = (t * 3 + i * 0.37) % 1, r0 = (50 - 40 * u) * S, r1 = r0 - 10 * S;
        ctx.beginPath();
        ctx.moveTo(h.x + Math.cos(a) * r0, h.y + Math.sin(a) * r0 * 0.8);
        ctx.lineTo(h.x + Math.cos(a) * Math.max(4 * S, r1), h.y + Math.sin(a) * Math.max(4 * S, r1) * 0.8);
        ctx.stroke();
      }
    });
    auraBall(ctx, h.x, h.y, (2 + 5 * k) * S, t);
  },
  pose(pet, p, m, t) { if (t < LAUNCH) { p.sx = 1.05; p.sy = 0.95; } else if (t < LAUNCH + 0.2) p.rot = pet.facing * 0.12; },
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, g = groundOf(m, K, S);
    // 藍色光柱
    part(st, {
      x: g.x, y: g.y, life: 0.55,
      draw: (ctx, p, k) => glow(ctx, () => {
        const h = 90 * S * Math.min(1, k * 6), w = 12 * S * (1 - k * 0.6);
        const gr = ctx.createLinearGradient(0, p.y, 0, p.y - h);
        gr.addColorStop(0, rgba(WHITE, 0.9 * (1 - k)));
        gr.addColorStop(0.5, rgba(AURA2, 0.7 * (1 - k)));
        gr.addColorStop(1, rgba(AURA, 0));
        ctx.fillStyle = gr;
        ctx.fillRect(p.x - w / 2, p.y - h, w, h);
      }),
    });
    ripple(st, at.x, at.y, AURA2, 6, 34, { life: 0.4, width: 2 });
    FX.hitSpark(st, at.x, at.y, AURA2, 22, 8);
  },
};

// ---------- 飛身重壓 ----------
const CROUCH = 0.2, APEX = 0.55, HANG = 0.62, SLAM = 0.75, FP_BACK = [0.85, 1.25], HIGH = 70; // 猜的，可調整（太靠近螢幕上緣時 pet 自己會跳低一點）
const flyingpress = {
  time: () => ({ dur: FP_BACK[1] + 0.1, hit: SLAM }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const k = t < CROUCH ? 0 : t < APEX ? (t - CROUCH) / (APEX - CROUCH) : t < FP_BACK[0] ? 1 : Math.max(0, 1 - (t - FP_BACK[0]) / (FP_BACK[1] - FP_BACK[0]));
    K.dash(pet, m, k);
    pet.z = t < CROUCH ? 0 : t < APEX ? Math.sin(((t - CROUCH) / (APEX - CROUCH)) * Math.PI / 2) * HIGH : t < HANG ? HIGH : t < SLAM ? HIGH * (1 - ((t - HANG) / (SLAM - HANG)) ** 2) : 0;
    // 往下砸的速度線
    if (t > HANG && t < SLAM) {
      const r = pet.rect();
      for (let i = 0; i < 2; i++) st.fx.add({ rect: WHITE, size: S / 2, x: r.x + Math.random() * r.w, y: r.y - 4 * S, vy: -120 * S, life: 0.12 });
    }
  },
  // 目標腳下的影子越變越大
  draw(ctx, pet, m, t, K) {
    if (t < 0.3 || t > SLAM) return;
    const S = pet.S, g = groundOf(m, K, S), k = clamp01((t - 0.3) / (SLAM - 0.3));
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.3 * k;
    ctx.fillStyle = '#1a1420';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, (6 + 22 * k) * S, (2 + 5 * k) * S, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  },
  pose(pet, p, m, t) {
    if (t < CROUCH) { p.sx = 1.12; p.sy = 0.86; } // 蹲低
    else if (t > APEX - 0.05 && t < HANG) { p.sx = 0.85; p.sy = 0.85; } // 頂點看起來很高（縮小一點）
    else if (t > HANG && t < SLAM) { p.sx = 0.92; p.sy = 1.12; } // 往下衝拉長
  },
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, g = groundOf(m, K, S);
    FX.shockwave(st, g.x, g.y, DUST, 80, { flat: 0.3, thick: 5, life: 0.6 });
    ripple(st, g.x, g.y, WHITE, 10, 50, { flat: 0.3, life: 0.5, width: 2, delay: 0.06 });
    for (let i = 0; i < 4; i++) FX.smoke(st, g.x + (i - 1.5) * 12 * S, g.y - 2 * S, 30);
    st.fx.burst(g.x, g.y, S, [DUST, '#c08a4a'], { n: 12, speed: 120, dir: -Math.PI / 2, spread: 2.6, g: 320, life: 0.6, size: S });
    if (K.isPet(m.target)) m.target.squashT = 0.18; // 被壓扁（彈回來）
  },
};

export const FIGHTING = { armthrust, aurasphere, flyingpress };
