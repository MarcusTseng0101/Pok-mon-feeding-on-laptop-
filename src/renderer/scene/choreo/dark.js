// 惡屬性 3 招，每一招自己的演出
//   咬住     衝過去，目標上面出現上下兩排牙齒的大嘴，張開 →「喀」合上，留下齒痕
//   暗襲要害 周圍一下子全暗，自己消失、出現在目標背後，一道很細的橫線閃光，燈亮了目標才慢半拍被打中
//   顛倒     目標身邊一圈暗色箭頭打轉，目標翻成倒立（箭頭反過來轉）再翻回來
import * as FX from '../movefx.js';
import { TAU, clamp01, glow, part } from './kit.js';

const WHITE_LINE = '#ffffff', TOOTH = '#ffffff', GUM = '#6a2a3a', INK = '#2a1a1a', DARK = '#6a4a4a', GOLD = '#ffe066', SLASH = '#e0c8b8';

// ---------- 咬住 ----------
const BT_DASH = 0.3, JAW = [0.3, 0.45], CLAMP = 0.5, BT_BACK = [0.65, 1.0]; // 猜的，可調整
function jaws(ctx, x, y, w, gap, S, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const side of [-1, 1]) {
    const yy = y + side * gap / 2;
    // 牙齦（弧）＋一排三角形牙齒（朝中間）
    ctx.fillStyle = GUM;
    ctx.beginPath();
    ctx.ellipse(x, yy + side * 4 * S, w / 2, 5 * S, 0, side > 0 ? 0 : Math.PI, side > 0 ? Math.PI : TAU);
    ctx.fill();
    ctx.fillStyle = TOOTH;
    ctx.strokeStyle = INK;
    ctx.lineWidth = S;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x0 = x - w / 2 + (i / n) * w, x1 = x0 + w / n;
      ctx.beginPath();
      ctx.moveTo(x0, yy);
      ctx.lineTo((x0 + x1) / 2, yy - side * 7 * S);
      ctx.lineTo(x1, yy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}
const bite = {
  time: () => ({ dur: BT_BACK[1] + 0.05, hit: CLAMP }),
  update(pet, m, t, dt, K) {
    K.dash(pet, m, t < BT_DASH ? (t / BT_DASH) * 0.8 : t < BT_BACK[0] ? 0.8 : Math.max(0, 0.8 * (1 - (t - BT_BACK[0]) / (BT_BACK[1] - BT_BACK[0]))));
    // 大嘴畫在特效層（在夥伴上面，才不會被目標蓋住）
    if (t >= JAW[0] && !m.s) {
      m.s = true;
      const S = pet.S;
      part(pet.stage, {
        x: 0, y: 0, life: CLAMP + 0.12 - JAW[0],
        draw: (ctx, p) => {
          const tt = JAW[0] + p.t, b = K.targetPoint(m.target);
          const open = tt < JAW[1] ? clamp01((tt - JAW[0]) / (JAW[1] - JAW[0])) : clamp01(1 - (tt - JAW[1]) / (CLAMP - JAW[1]));
          jaws(ctx, b.x, b.y, 46 * S, (4 + 40 * open) * S, S, tt > CLAMP ? 1 - (tt - CLAMP) / 0.12 : 1);
        },
      });
    }
  },
  pose(pet, p, m, t) { if (t > JAW[0] && t < CLAMP + 0.1) { p.rot = pet.facing * 0.12; p.sy = 1.05; } }, // 撲上去咬
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    // 齒痕：上下兩排小點，留一下
    part(st, {
      x: at.x, y: at.y, life: 0.8,
      draw: (ctx, p, k) => { ctx.save(); ctx.globalAlpha = 1 - k; ctx.fillStyle = GUM; for (const dy of [-4, 4]) for (let i = 0; i < 5; i++) ctx.fillRect(p.x - 12 * S + i * 6 * S, p.y + dy * S, 2 * S, 2 * S); ctx.restore(); },
    });
    FX.hitSpark(st, at.x, at.y, SLASH, 20, 8);
  },
};

// ---------- 暗襲要害 ----------
const DARKEN = 0.05, VANISH = 0.15, APPEAR = 0.35, SLICE = 0.4, NS_HIT = 0.7, NS_BACK = [0.9, 1.25]; // 猜的，可調整
const nightslash = {
  time: () => ({ dur: NS_BACK[1] + 0.05, hit: NS_HIT }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= {});
    // 周圍一下子全暗（減少閃光時變暗只有一半，movefx.dim 自己會處理）
    if (t >= DARKEN && !s.dark) {
      s.dark = true;
      const a = pet.rect(), b = K.targetPoint(m.target), x = (pet.x + b.x) / 2, rx = Math.abs(b.x - pet.x) / 2 + 150 * S;
      FX.dim(st, { x, y: a.y + a.h / 2, rx, ry: rx * 0.5, level: 0.85, fadeIn: 0.08, hold: NS_HIT - 0.1, fadeOut: 0.3, type: 'dark' });
    }
    // 瞬間移到目標背後（k > 1：穿過目標）
    const to = K.targetPoint(m.target), back = m.from, reach = K.isPet(m.target) ? ((m.target.asset.w + pet.asset.w) / 2) * S * 0.8 : 0;
    const dir = to.x > back.x ? 1 : -1, front = to.x - dir * reach, behind = to.x + dir * reach;
    const kBehind = Math.abs(front - back.x) > 1 ? (behind - back.x) / (front - back.x) : 1;
    const k = t < VANISH ? 0 : t < NS_BACK[0] ? kBehind : Math.max(0, kBehind * (1 - (t - NS_BACK[0]) / (NS_BACK[1] - NS_BACK[0])));
    K.dash(pet, m, k);
    if (t >= APPEAR && !s.face) { s.face = true; pet.facing = -dir; } // 在背後轉身
    if (t >= NS_BACK[0] && !s.turn) { s.turn = true; pet.facing = dir; }
    pet.moveAlpha = t > VANISH - 0.05 && t < APPEAR ? 0 : t > NS_BACK[0] && t < NS_BACK[1] - 0.05 ? 0.3 : 1;
  },
  // 一道很細很長的橫線閃光
  draw(ctx, pet, m, t, K) {
    if (t < SLICE || t > SLICE + 0.25) return;
    const S = pet.S, b = K.targetPoint(m.target), u = (t - SLICE) / 0.25, L = 70 * S;
    glow(ctx, () => {
      ctx.globalAlpha = u < 0.3 ? 1 : 1 - (u - 0.3) / 0.7;
      ctx.strokeStyle = WHITE_LINE;
      ctx.lineWidth = Math.max(1, S * (1 - u));
      ctx.beginPath();
      ctx.moveTo(b.x - L / 2, b.y - 2 * S);
      ctx.lineTo(b.x - L / 2 + L * Math.min(1, u * 4), b.y + 2 * S);
      ctx.stroke();
    });
  },
  pose(pet, p, m, t) { if (t > APPEAR && t < NS_BACK[0]) p.rot = -pet.facing * 0.25; }, // 揮完刀的姿勢
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    // 慢半拍：線的位置裂開
    FX.slash(st, at.x, at.y, SLASH, { r: 30, dir: 1 });
    st.fx.burst(at.x, at.y, S, [INK, DARK, SLASH], { n: 10, speed: 120, spread: 0.6, dir: 0, g: 60, life: 0.4, size: S / 2 });
    st.fx.burst(at.x, at.y, S, [INK, DARK, SLASH], { n: 10, speed: 120, spread: 0.6, dir: Math.PI, g: 60, life: 0.4, size: S / 2 });
  },
};
// ---------- 顛倒 ----------
const ARROWS = [0.15, 1.15], FLIP = 0.7; // 猜的，可調整
function arrow(ctx, x, y, ang, s, col) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = Math.max(1, s / 4);
  ctx.beginPath();
  ctx.arc(0, 0, s, -0.6, 0.6);
  ctx.stroke();
  const hx = Math.cos(0.6) * s, hy = Math.sin(0.6) * s;
  ctx.beginPath();
  ctx.moveTo(hx + s * 0.1, hy + s * 0.35);
  ctx.lineTo(hx - s * 0.35, hy - s * 0.05);
  ctx.lineTo(hx + s * 0.4, hy - s * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
const topsyturvy = {
  time: () => ({ dur: 1.4, hit: FLIP }),
  update(pet, m, t, dt, K) {
    // 打中前一刻讓對方倒過來（跟原本一樣用 flipT）
    if (t >= FLIP - 0.02 && !m.s) { m.s = true; if (K.isPet(m.target)) m.target.flipT = 0.9; }
  },
  draw(ctx, pet, m, t, K) {
    if (t < ARROWS[0] || t > ARROWS[1]) return;
    const S = pet.S, b = K.targetPoint(m.target), r = K.isPet(m.target) ? m.target.rect() : { w: 28 * S, h: 28 * S };
    const k = clamp01((t - ARROWS[0]) / 0.15) * (t > ARROWS[1] - 0.2 ? (ARROWS[1] - t) / 0.2 : 1), spin = t < FLIP ? t * 6 : FLIP * 6 - (t - FLIP) * 8; // 倒過來以後反轉
    ctx.save();
    ctx.globalAlpha = k;
    for (let i = 0; i < 4; i++) {
      const a = spin + (i / 4) * TAU, x = b.x + Math.cos(a) * (r.w * 0.6 + 10 * S), y = b.y + Math.sin(a) * (r.h * 0.5 + 6 * S);
      arrow(ctx, x, y, a + Math.PI / 2 * (t < FLIP ? 1 : -1), 10 * S, i % 2 ? DARK : GOLD);
    }
    ctx.restore();
  },
  pose(pet, p, m, t) { if (t > ARROWS[0] && t < FLIP) p.rot = Math.sin(t * 12) * 0.15; }, // 手在畫圈
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    st.fx.stars(at.x, at.y, S, 3);
    FX.hitSpark(st, at.x, at.y, GOLD, 18, 6);
  },
};

export const DARK_MOVES = { bite, nightslash, topsyturvy };
