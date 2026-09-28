// 龍屬性：龍之波動（流星群不動，它本來就有自己的演出，還在 moves.js 的 meteor）
//   龍之波動 兩色螺旋纏成的光束往前轉，最前面是一顆龍頭；龍頭咬到目標的位置炸開成漩渦
import * as FX from '../movefx.js';
import { TAU, lerp, clamp01, rgba, glow, ripple } from './kit.js';

const DRAGON = '#6a40ff', DRAGON2 = '#b8a0ff', AZURE = '#58b4ff', WHITE = '#ffffff', GOLD = '#ffe066';

const DP_ON = 0.3, DP_REACH = 0.3, DP_OFF = 1.05; // 猜的，可調整
function dragonHead(ctx, x, y, ang, s, bite) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  // 上顎、下顎（張開 → 咬）
  const open = 0.45 * (1 - bite);
  ctx.fillStyle = DRAGON;
  ctx.strokeStyle = DRAGON2;
  ctx.lineWidth = Math.max(1, s / 8);
  ctx.beginPath();
  ctx.moveTo(-s, -s * 0.5);
  ctx.lineTo(s * 1.3, -s * open);
  ctx.lineTo(s * 0.2, -s * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s, s * 0.3);
  ctx.lineTo(s * 1.2, s * open);
  ctx.lineTo(-s * 0.2, s * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 兩隻角、眼睛
  ctx.strokeStyle = AZURE;
  ctx.lineWidth = Math.max(1, s / 5);
  ctx.beginPath();
  ctx.moveTo(-s * 0.4, -s * 0.8); ctx.lineTo(-s * 1.3, -s * 1.5);
  ctx.moveTo(-s * 0.1, -s * 0.85); ctx.lineTo(-s * 0.7, -s * 1.7);
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.fillRect(-s * 0.1, -s * 0.6, s * 0.3, s * 0.2);
  ctx.restore();
}
const dragonpulse = {
  time: () => ({ dur: 1.35, hit: DP_ON + DP_REACH + 0.01 }),
  update() {},
  draw(ctx, pet, m, t, K) {
    const S = pet.S, a = pet.mouth(), b = K.targetPoint(m.target);
    const u1 = clamp01((t - DP_ON) / DP_REACH), fade = t > DP_OFF ? clamp01(1 - (t - DP_OFF) / 0.25) : 1;
    if (u1 <= 0 || fade <= 0) return;
    const ex = lerp(a.x, b.x, u1), ey = lerp(a.y, b.y, u1), len = Math.hypot(ex - a.x, ey - a.y) || 1, nx = -(ey - a.y) / len, ny = (ex - a.x) / len;
    glow(ctx, () => {
      ctx.globalAlpha = fade;
      // 淡淡的中心光
      ctx.strokeStyle = rgba(DRAGON2, 0.35);
      ctx.lineWidth = 6 * S;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke();
      // 兩色螺旋（相位差半圈，一直往前轉）
      for (const [ph, col] of [[0, DRAGON], [Math.PI, AZURE]]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5 * S;
        ctx.beginPath();
        for (let i = 0; i <= 40; i++) {
          const u = i / 40, off = Math.sin(u * len / (9 * S) - t * 24 + ph) * 8 * S * Math.min(1, u * 6);
          const x = lerp(a.x, ex, u) + nx * off, y = lerp(a.y, ey, u) + ny * off;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
    });
    // 最前面的龍頭（打中後咬下去、慢慢淡掉）
    const bite = clamp01((t - DP_ON - DP_REACH) / 0.1), headFade = t > DP_ON + DP_REACH + 0.25 ? clamp01(1 - (t - DP_ON - DP_REACH - 0.25) / 0.2) : 1;
    if (headFade > 0) { ctx.save(); ctx.globalAlpha = fade * headFade; dragonHead(ctx, ex, ey + Math.sin(t * 18) * 2 * S, Math.atan2(ey - a.y, ex - a.x), 8 * S, bite); ctx.restore(); }
  },
  pose(pet, p, m, t) { if (t < DP_ON) { p.sx = 1.05; p.sy = 0.95; } else if (t < DP_OFF) p.rot = pet.facing * 0.08; },
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    // 炸開成漩渦
    for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; FX.blob(st, { x: at.x + Math.cos(a) * 18 * S, y: at.y + Math.sin(a) * 12 * S, vx: -Math.sin(a) * 130 * S, vy: Math.cos(a) * 90 * S, s0: 7, s1: 2, a0: 1, a1: 0, life: 0.45, col: i % 2 ? DRAGON : AZURE }); }
    ripple(st, at.x, at.y, DRAGON2, 6, 34, { life: 0.4, width: 2 });
    FX.hitSpark(st, at.x, at.y, WHITE, 22, 8);
  },
};

export const DRAGON_MOVES = { dragonpulse };
