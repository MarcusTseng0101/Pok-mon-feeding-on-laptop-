// 幽靈屬性 3 招，每一招自己的演出
//   暗影球   嘴前聚成一顆黑球（紫色火焰邊），晃著飛過去；打中先往內吸一下再炸開，冒黑煙
//   影子偷襲 自己的影子脫離、沿地面伸到目標腳下，從目標的影子伸出一隻黑色的手往上打；自己變淡
//   萬聖夜   目標頭上浮出一顆南瓜燈，咧嘴笑、眨眼，打中時糖果「啵啵」噴出來、紫煙一圈
import * as FX from '../movefx.js';
import { TAU, lerp, clamp01, rgba, glow, part, groundOf, mover, ribbon, ripple } from './kit.js';

const PURPLE = '#7050b0', LILAC = '#c8a0ff', DARK = '#1a1026', SHADOW = '#2a1a3a', ORANGE = '#ffb13a', PUMPKIN = '#ff8a2a', STEM = '#4a9a3a';
const CANDY = ['#ff5d8f', '#7ab8ff', '#ffe066', '#9be15d', '#ffffff'];

// ---------- 暗影球 ----------
const SB_CHARGE = 0.35, SB_FLY = 0.6; // 猜的，可調整
function darkOrb(ctx, x, y, r, t) {
  glow(ctx, () => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + t * 5, rr = r * (1.25 + Math.sin(t * 20 + i * 2) * 0.2);
      const g = ctx.createRadialGradient(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, 0, x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, rr * 0.6);
      g.addColorStop(0, rgba(LILAC, 0.6));
      g.addColorStop(1, rgba(PURPLE, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - rr * 2, y - rr * 2, rr * 4, rr * 4);
    }
  });
  ctx.save();
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(DARK, 1));
  g.addColorStop(0.75, rgba(SHADOW, 0.95));
  g.addColorStop(1, rgba(PURPLE, 0.6));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}
const shadowball = {
  time: () => ({ dur: 1.5, hit: SB_CHARGE + SB_FLY + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    if (t >= SB_CHARGE && !m.s) {
      m.s = true;
      const a = pet.mouth(), b = K.targetPoint(m.target);
      mover(st, {
        life: SB_FLY, S,
        path: k => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) + Math.sin(k * TAU * 2) * 22 * S * (1 - k * 0.7) }), // 大大地晃著飛
        drawAt: (ctx, q, p) => { ribbon(ctx, p.hist, S, PURPLE, 9, 0.6); darkOrb(ctx, q.x, q.y, 12 * S, p.t); },
        onArrive: () => { if (pet.moveCtx === m) K.hit(pet); },
      });
    }
  },
  draw(ctx, pet, m, t) {
    if (t >= SB_CHARGE) return;
    const f = pet.mouth(), S = pet.S;
    darkOrb(ctx, f.x + pet.facing * 10 * S, f.y, (2 + 10 * (t / SB_CHARGE)) * S, t);
  },
  pose(pet, p, m, t) { if (t < SB_CHARGE) { p.sx = 1.05; p.sy = 0.95; } else if (t < SB_CHARGE + 0.15) p.rot = pet.facing * 0.1; },
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    // 先往內吸（一圈往中間縮），再炸開
    part(st, { x: at.x, y: at.y, life: 0.15, draw: (ctx, p, k) => { ctx.save(); ctx.strokeStyle = rgba(LILAC, 0.9); ctx.lineWidth = 2 * S; ctx.beginPath(); ctx.arc(p.x, p.y, (50 - 44 * k) * S, 0, TAU); ctx.stroke(); ctx.restore(); } });
    FX.later(st, 0.15, () => {
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; FX.blob(st, { x: at.x, y: at.y, vx: Math.cos(a) * 110 * S, vy: Math.sin(a) * 80 * S, s0: 12, s1: 26, a0: 0.8, a1: 0, life: 0.5, col: i % 2 ? PURPLE : LILAC, wisp: true }); }
      for (let i = 0; i < 3; i++) FX.smoke(st, at.x + (i - 1) * 8 * S, at.y, 26);
    });
  },
};

// ---------- 影子偷襲 ----------
const CREEP = [0.1, 0.5], HAND = [0.45, 0.62], SN_OFF = 1.1; // 猜的，可調整
function hand(ctx, x, y, s, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = DARK;
  ctx.strokeStyle = LILAC;
  ctx.lineWidth = Math.max(1, s / 6);
  ctx.beginPath();
  ctx.moveTo(x - s * 0.5, y + s * 1.6); // 手臂從下面伸上來
  ctx.lineTo(x - s * 0.6, y);
  // 3 根尖尖的手指＋大拇指
  ctx.lineTo(x - s * 0.7, y - s * 0.9);
  ctx.lineTo(x - s * 0.35, y - s * 0.2);
  ctx.lineTo(x - s * 0.1, y - s * 1.2);
  ctx.lineTo(x + s * 0.1, y - s * 0.25);
  ctx.lineTo(x + s * 0.5, y - s * 1.0);
  ctx.lineTo(x + s * 0.55, y - s * 0.1);
  ctx.lineTo(x + s * 0.95, y - s * 0.3);
  ctx.lineTo(x + s * 0.6, y + s * 0.4);
  ctx.lineTo(x + s * 0.5, y + s * 1.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ff5d8f';
  ctx.fillRect(x - s * 0.1, y + s * 0.2, s * 0.2, s * 0.2); // 一隻紅眼睛
  ctx.restore();
}
const shadowsneak = {
  time: () => ({ dur: 1.35, hit: HAND[1] }),
  update(pet, m, t) { pet.moveAlpha = t < SN_OFF ? 0.55 : 1; }, // 影子跑掉了，自己變淡
  draw(ctx, pet, m, t, K) {
    const S = pet.S, g = groundOf(m, K, S), a = { x: pet.x, y: pet.gy };
    const u = clamp01((t - CREEP[0]) / (CREEP[1] - CREEP[0])), fade = t > SN_OFF ? clamp01(1 - (t - SN_OFF) / 0.2) : 1;
    if (u > 0 && fade > 0) {
      // 地上一條越伸越長的影子（前端是一團）
      const x1 = lerp(a.x, g.x, u);
      ctx.save();
      ctx.globalAlpha = 0.75 * fade;
      ctx.fillStyle = SHADOW;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - 2 * S);
      ctx.quadraticCurveTo((a.x + x1) / 2, a.y - 4 * S + Math.sin(t * 20) * S, x1, g.y - 3 * S);
      ctx.lineTo(x1, g.y + 3 * S);
      ctx.quadraticCurveTo((a.x + x1) / 2, a.y + 4 * S, a.x, a.y + 2 * S);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x1, g.y, 12 * S, 4 * S, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    // 從目標的影子伸出黑手往上打
    if (t > HAND[0] && t < SN_OFF) {
      const k = clamp01((t - HAND[0]) / (HAND[1] - HAND[0])), b = K.targetPoint(m.target), y = lerp(g.y, b.y + 4 * S, k * (2 - k));
      hand(ctx, g.x, y, 13 * S, t > SN_OFF - 0.2 ? (SN_OFF - t) / 0.2 : 1);
    }
  },
  pose(pet, p, m, t) { if (t < SN_OFF) p.sy = 0.94; }, // 蹲低
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    FX.hitSpark(st, at.x, at.y, LILAC, 22, 8);
    for (let i = 0; i < 6; i++) FX.blob(st, { x: at.x + (i - 2.5) * 5 * S, y: at.y + 8 * S, vy: -60 * S, s0: 10, s1: 20, a0: 0.7, a1: 0, life: 0.6, col: PURPLE, wisp: true });
  },
};

// ---------- 萬聖夜 ----------
const POP = [0.15, 0.4], TT_HIT = 0.85, TT_OFF = 1.25; // 猜的，可調整
function pumpkin(ctx, x, y, s, grin, blink) {
  ctx.save();
  ctx.fillStyle = PUMPKIN;
  ctx.strokeStyle = '#a04a10';
  ctx.lineWidth = Math.max(1, s / 8);
  for (const dx of [-0.45, 0.45, 0]) { ctx.beginPath(); ctx.ellipse(x + dx * s, y, s * 0.6, s * 0.8, 0, 0, TAU); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = STEM;
  ctx.fillRect(x - s * 0.1, y - s * 1.05, s * 0.2, s * 0.35);
  ctx.fillStyle = DARK;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    if (blink) { ctx.rect(x + side * s * 0.4 - s * 0.2, y - s * 0.25, s * 0.4, s * 0.08); }
    else { ctx.moveTo(x + side * s * 0.4, y - s * 0.45); ctx.lineTo(x + side * s * 0.2, y - s * 0.1); ctx.lineTo(x + side * s * 0.6, y - s * 0.1); ctx.closePath(); }
    ctx.fill();
  }
  // 咧嘴笑（鋸齒）
  ctx.beginPath();
  const w = s * (0.6 + grin * 0.3);
  ctx.moveTo(x - w, y + s * 0.2);
  for (let i = 0; i <= 6; i++) ctx.lineTo(x - w + (i / 6) * 2 * w, y + s * (0.3 + (i % 2 ? 0.15 : 0) + grin * 0.1));
  ctx.lineTo(x + w * 0.7, y + s * (0.55 + grin * 0.1));
  ctx.lineTo(x - w * 0.7, y + s * (0.55 + grin * 0.1));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function candy(ctx, x, y, s, col, ang) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = col;
  ctx.fillRect(-s * 0.5, -s * 0.35, s, s * 0.7);
  ctx.beginPath(); ctx.moveTo(-s * 0.5, 0); ctx.lineTo(-s, -s * 0.45); ctx.lineTo(-s, s * 0.45); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(s * 0.5, 0); ctx.lineTo(s, -s * 0.45); ctx.lineTo(s, s * 0.45); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-s * 0.2, -s * 0.35, s * 0.15, s * 0.7);
  ctx.restore();
}
const trickortreat = {
  time: () => ({ dur: 1.5, hit: TT_HIT }),
  update() {},
  draw(ctx, pet, m, t, K) {
    const S = pet.S, b = K.targetPoint(m.target), top = K.isPet(m.target) ? m.target.rect().y : b.y - 14 * S;
    const k = clamp01((t - POP[0]) / (POP[1] - POP[0])), fade = t > TT_OFF ? clamp01(1 - (t - TT_OFF) / 0.2) : 1;
    if (k <= 0 || fade <= 0) return;
    const grin = clamp01((t - 0.5) / 0.3), blink = (t > 0.58 && t < 0.64) || (t > 0.72 && t < 0.78);
    ctx.save();
    ctx.globalAlpha = fade;
    glow(ctx, () => { const g = ctx.createRadialGradient(b.x, top - 16 * S, 0, b.x, top - 16 * S, 22 * S * k); g.addColorStop(0, rgba(ORANGE, 0.5)); g.addColorStop(1, rgba(ORANGE, 0)); ctx.fillStyle = g; ctx.fillRect(b.x - 22 * S, top - 38 * S, 44 * S, 44 * S); });
    pumpkin(ctx, b.x + Math.sin(t * 6) * 2 * S, top - 16 * S + Math.sin(t * 4) * 2 * S, 11 * S * (k < 1 ? k * (1.2 - 0.2 * k) : 1), grin, blink);
    ctx.restore();
  },
  pose(pet, p, m, t) { if (t < TT_HIT) p.rot = Math.sin(t * 14) * 0.1; }, // 搖頭晃腦（施法）
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, top = K.isPet(m.target) ? m.target.rect().y : at.y - 14 * S;
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i - 4) * 0.3, v = (90 + (i % 3) * 30) * S, col = CANDY[i % CANDY.length];
      mover(st, { life: 0.8, S, path: k => ({ x: at.x + Math.cos(a) * v * k * 0.8, y: top - 16 * S + Math.sin(a) * v * k * 0.8 + k * k * 160 * S }), drawAt: (ctx, q, p, k) => { ctx.save(); ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1; candy(ctx, q.x, q.y, 3.5 * S, col, k * 8 + i); ctx.restore(); } });
    }
    ripple(st, at.x, at.y, PURPLE, 8, 40, { life: 0.6, width: 3, fill: 0.2 });
    FX.hitSpark(st, at.x, at.y, ORANGE, 18, 6);
  },
};

export const GHOST = { shadowball, shadowsneak, trickortreat };
