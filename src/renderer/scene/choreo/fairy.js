// 妖精屬性 5 招，每一招自己的演出
//   妖精之鎖 金色鎖鏈一節一節圍住目標，鑰匙出現轉一下「喀」，鎖鏈亮一下再消失（不打人）
//   月亮之力 自己背後升起月亮（月牙變滿月），一道粉紅月光從上往下照到目標
//   妖精之風 一條沿正弦波飄的半透明風帶，亮片跟著吹過去，目標被吹得晃
//   魅惑之聲 音符和愛心慢慢飄、追著目標，碰到一個一個啵，目標臉紅
//   大地掌控 自己發光，身邊地上一根一根升起 6 道彩色光柱，再一起往頭上收成一點、爆出亮片（不打人）
import * as FX from '../movefx.js';
import { key as keyArt } from '../../gfx/art.js';
import { blit } from '../../gfx/pixel.js';
import { TAU, lerp, clamp01, rgba, glow, part, groundOf, mover, ripple } from './kit.js';

const GOLD = '#ffd84a', GOLD2 = '#fff2a0', PINK = '#ff8ec7', PINK2 = '#ffd0e8', WHITE = '#ffffff', MOON = '#fff6d8';
const GEO = ['#ff5d5d', '#ffb13a', '#ffe066', '#7ae07a', '#7ab8ff', '#c070ff'];

const boxOf = (m, K, S) => {
  if (K.isPet(m.target)) return m.target.rect();
  const b = K.targetPoint(m.target);
  return { x: b.x - 14 * S, y: b.y - 14 * S, w: 28 * S, h: 28 * S };
};

// ---------- 妖精之鎖 ----------
const N_LINK = 16, LINKS = [0.1, 0.6], TURN = [0.65, 0.85], FL_OFF = [1.15, 1.5]; // 猜的，可調整
const fairylock = {
  time: () => ({ dur: FL_OFF[1] + 0.05, hit: null }),
  update(pet, m, t, dt, K) {
    if (t >= TURN[1] && !m.s) {
      m.s = true;
      const S = pet.S, r = boxOf(m, K, S);
      pet.stage.fx.sparkles(r.x + r.w / 2, r.y + r.h, S, 5, 14); // 「喀」
      ripple(pet.stage, r.x + r.w / 2, r.y + r.h / 2, GOLD, 10, 40, { life: 0.4, width: 2 });
    }
  },
  draw(ctx, pet, m, t, K) {
    const S = pet.S, r = boxOf(m, K, S), cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w * 0.7 + 6 * S, ry = r.h * 0.6 + 4 * S;
    const fade = t > FL_OFF[0] ? clamp01(1 - (t - FL_OFF[0]) / (FL_OFF[1] - FL_OFF[0])) : 1;
    if (t < LINKS[0] || fade <= 0) return;
    const shown = clamp01((t - LINKS[0]) / (LINKS[1] - LINKS[0])) * N_LINK, lit = t > TURN[1] && t < TURN[1] + 0.2;
    ctx.save();
    ctx.globalAlpha = fade;
    for (let i = 0; i < Math.floor(shown); i++) {
      const a = (i / N_LINK) * TAU - Math.PI / 2, x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a + Math.PI / 2 + (i % 2 ? Math.PI / 2 : 0));
      ctx.strokeStyle = lit ? WHITE : GOLD;
      ctx.lineWidth = 1.5 * S;
      ctx.beginPath();
      ctx.ellipse(0, 0, 4 * S, i % 2 ? 1.5 * S : 2.5 * S, 0, 0, TAU); // 一節一節的鏈子（直的、橫的交錯）
      ctx.stroke();
      ctx.restore();
    }
    // 鑰匙：出現在前面，轉一下（左右翻）
    if (t > LINKS[1] - 0.05) {
      const flip = t > TURN[0] && t < TURN[1] ? Math.cos(((t - TURN[0]) / (TURN[1] - TURN[0])) * Math.PI) : 1;
      const sc = 2 * S;
      ctx.translate(cx, r.y + r.h + 6 * S);
      ctx.scale(flip || 0.05, 1);
      blit(ctx, keyArt, -(keyArt.width * sc) / 2, -(keyArt.height * sc) / 2, sc);
    }
    ctx.restore();
  },
  pose(pet, p, m, t) { if (t < TURN[1]) p.rot = Math.sin(t * 10) * 0.08; },
};

// ---------- 月亮之力 ----------
const RISE = [0.05, 0.5], SHINE = [0.5, 1.05], MB_HIT = 0.75; // 猜的，可調整
const moonAt = pet => { const r = pet.rect(); return { x: pet.x - pet.facing * r.w * 0.3, y: r.y - 26 * pet.S }; };
function moon(ctx, x, y, R, full) {
  ctx.save();
  glow(ctx, () => { const g = ctx.createRadialGradient(x, y, 0, x, y, R * 2.2); g.addColorStop(0, rgba(PINK2, 0.6)); g.addColorStop(1, rgba(PINK, 0)); ctx.fillStyle = g; ctx.fillRect(x - R * 2.2, y - R * 2.2, R * 4.4, R * 4.4); });
  // 月牙 → 滿月：只在月亮的圓裡面畫，挖掉一個越移越遠的圓（不會挖到後面畫的東西）
  ctx.beginPath();
  ctx.arc(x, y, R, 0, TAU);
  ctx.clip();
  ctx.fillStyle = MOON;
  ctx.beginPath();
  ctx.rect(x - R * 2, y - R * 2, R * 4, R * 4);
  if (full < 1) ctx.arc(x + R * (0.5 + full * 1.6), y - R * 0.2, R * 0.95, 0, TAU);
  ctx.fill('evenodd');
  ctx.restore();
}
const moonblast = {
  time: () => ({ dur: SHINE[1] + 0.3, hit: MB_HIT }),
  update() {},
  draw(ctx, pet, m, t, K) {
    const S = pet.S, mo = moonAt(pet), up = clamp01((t - RISE[0]) / (RISE[1] - RISE[0])), fade = t > SHINE[1] ? clamp01(1 - (t - SHINE[1]) / 0.25) : 1;
    if (up <= 0 || fade <= 0) return;
    const y = mo.y + (1 - up) * 20 * S;
    ctx.save();
    ctx.globalAlpha = fade;
    // 月光：從月亮往目標照下去的光（梯形，越往下越寬）
    const u = clamp01((t - SHINE[0]) / 0.2);
    if (u > 0) {
      const b = K.targetPoint(m.target), bx = lerp(mo.x, b.x, u), by = lerp(y, b.y + 10 * S, u);
      glow(ctx, () => {
        const g = ctx.createLinearGradient(mo.x, y, bx, by);
        g.addColorStop(0, rgba(PINK2, 0.8));
        g.addColorStop(1, rgba(PINK, 0.35));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(mo.x - 5 * S, y);
        ctx.lineTo(mo.x + 5 * S, y);
        ctx.lineTo(bx + 16 * S, by);
        ctx.lineTo(bx - 16 * S, by);
        ctx.closePath();
        ctx.fill();
      });
    }
    moon(ctx, mo.x, y, 11 * S, clamp01((t - RISE[0]) / (RISE[1] - RISE[0])));
    ctx.restore();
  },
  pose(pet, p, m, t) { if (t < SHINE[0]) p.rot = -pet.facing * 0.1; else if (t < SHINE[1]) p.sy = 1.05; }, // 抬頭看月亮
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, g = groundOf(m, K, S);
    ripple(st, g.x, g.y, PINK2, 8, 40, { flat: 0.3, life: 0.6, width: 2, fill: 0.3 });
    st.fx.sparkles(at.x, at.y, S, 10, 26);
    FX.hitSpark(st, at.x, at.y, PINK, 22, 8);
  },
};

// ---------- 妖精之風 ----------
const GUST = [0.15, 0.85], FW_HIT = 0.6; // 猜的，可調整
const fairywind = {
  dimAt: 'between',
  time: () => ({ dur: 1.3, hit: FW_HIT }),
  update(pet, m, t, dt, K) {
    if (t > GUST[0] && t < GUST[1] && Math.random() < dt * 40) {
      const S = pet.S, a = pet.mouth(), b = K.targetPoint(m.target), u = Math.random() * clamp01((t - GUST[0]) / 0.3);
      const x = lerp(a.x, b.x + (b.x - a.x) * 0.2, u), y = lerp(a.y, b.y, u) + Math.sin(u * 9 - t * 8) * 14 * S;
      pet.stage.fx.add({ rect: [PINK, WHITE, GOLD2][Math.floor(Math.random() * 3)], size: S / 2, x, y, vx: Math.sign(b.x - a.x) * 120 * S, vy: 0, life: 0.35, blink: true });
    }
  },
  // 半透明的風帶（沿正弦波）
  draw(ctx, pet, m, t, K) {
    const S = pet.S, a = pet.mouth(), b = K.targetPoint(m.target);
    const u1 = clamp01((t - GUST[0]) / 0.3), fade = t > GUST[1] ? clamp01(1 - (t - GUST[1]) / 0.3) : 1;
    if (u1 <= 0 || fade <= 0) return;
    const end = { x: b.x + (b.x - a.x) * 0.2, y: b.y };
    glow(ctx, () => {
      for (const [w, c] of [[14, rgba(PINK2, 0.18 * fade)], [5, rgba(WHITE, 0.4 * fade)]]) {
        ctx.strokeStyle = c;
        ctx.lineWidth = w * S;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i <= 30; i++) { const u = (i / 30) * u1, x = lerp(a.x, end.x, u), y = lerp(a.y, end.y, u) + Math.sin(u * 9 - t * 8) * 14 * S; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
    });
  },
  pose(pet, p, m, t) { if (t > GUST[0] && t < GUST[1]) p.rot = pet.facing * Math.sin(t * 16) * 0.1; }, // 揮手搧風
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S;
    if (K.isPet(m.target)) m.target.hopT = 0.35; // 被吹得晃
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; FX.blob(st, { x: at.x + Math.cos(a) * 12 * S, y: at.y + Math.sin(a) * 8 * S, vx: -Math.sin(a) * 90 * S, vy: Math.cos(a) * 60 * S, s0: 5, s1: 2, a0: 1, a1: 0, life: 0.45, col: i % 2 ? PINK : WHITE }); }
  },
};

// ---------- 魅惑之聲 ----------
const NOTES = [0.15, 0.27, 0.39, 0.51, 0.63], NOTE_FLY = 0.6; // 猜的，可調整
function note(ctx, x, y, s, col) {
  ctx.save();
  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1, s / 4);
  ctx.beginPath();
  ctx.ellipse(x, y, s * 0.55, s * 0.4, -0.4, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + s * 0.5, y);
  ctx.lineTo(x + s * 0.5, y - s * 1.6);
  ctx.lineTo(x + s * 1.1, y - s * 1.2);
  ctx.stroke();
  ctx.restore();
}
function heart(ctx, x, y, s, col) {
  ctx.save();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.8);
  ctx.bezierCurveTo(x - s * 1.2, y - s * 0.2, x - s * 0.5, y - s * 1.0, x, y - s * 0.35);
  ctx.bezierCurveTo(x + s * 0.5, y - s * 1.0, x + s * 1.2, y - s * 0.2, x, y + s * 0.8);
  ctx.fill();
  ctx.restore();
}
const disarmingvoice = {
  dimAt: 'between',
  time: () => ({ dur: 1.55, hit: NOTES[4] + NOTE_FLY - 0.05 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= { n: 0 });
    while (s.n < NOTES.length && t >= NOTES[s.n]) {
      const i = s.n++, a = pet.mouth(), up = (i % 2 ? 1 : -1) * (20 + i * 4) * S;
      mover(st, {
        life: NOTE_FLY, S,
        // 慢慢飄、追著目標（終點每幀看目標在哪）
        path: k => { const b = K.targetPoint(m.target); return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) + Math.sin(k * Math.PI) * up + Math.sin(k * 12 + i) * 3 * S }; },
        drawAt: (ctx, q) => (i % 2 ? heart(ctx, q.x, q.y, 8 * S, PINK) : note(ctx, q.x, q.y, 8 * S, i % 4 ? '#c070ff' : '#ff5d8f')),
        onArrive: q => ripple(st, q.x, q.y, PINK2, 3, 12, { life: 0.25, width: 1.5 }),
      });
    }
  },
  pose(pet, p, m, t) { if (t < NOTES[4] + 0.1) { p.sy = 1.04 + Math.sin(t * 20) * 0.03; p.rot = Math.sin(t * 8) * 0.08; } }, // 唱歌
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S;
    // 目標臉紅：兩團粉紅在臉頰上一陣子
    if (K.isPet(m.target)) {
      const who = m.target;
      part(st, {
        x: 0, y: 0, life: 1.1,
        draw: (ctx, p, k) => { const r = who.rect(); ctx.save(); ctx.globalAlpha = 0.6 * (k > 0.7 ? (1 - k) / 0.3 : 1); ctx.fillStyle = '#ff7aa8'; for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(r.x + r.w / 2 + side * r.w * 0.22, r.y + r.h * 0.42, 3.5 * S, 2 * S, 0, 0, TAU); ctx.fill(); } ctx.restore(); },
      });
    }
    st.fx.hearts(at.x, at.y - 10 * S, S, 2);
  },
};

// ---------- 大地掌控 ----------
const PILLARS = [0.1, 0.7], GATHER = [0.8, 1.1], GM_OFF = 1.5; // 猜的，可調整
const geomancy = {
  time: () => ({ dur: GM_OFF + 0.05, hit: null }),
  update(pet, m, t) {
    if (t >= GATHER[1] && !m.s) {
      m.s = true;
      const S = pet.S, r = pet.rect();
      pet.stage.fx.sparkles(pet.x, r.y - 16 * S, S, 12, 30);
      FX.blob(pet.stage, { x: pet.x, y: r.y - 16 * S, s0: 10, s1: 50, a0: 1, a1: 0, life: 0.4, col: WHITE });
    }
  },
  draw(ctx, pet, m, t) {
    const S = pet.S, r = pet.rect(), cx = pet.x, gy = pet.gy, top = r.y - 16 * S;
    const fade = t > GATHER[1] ? clamp01(1 - (t - GATHER[1]) / (GM_OFF - GATHER[1])) : 1;
    if (t < PILLARS[0] || fade <= 0) return;
    glow(ctx, () => {
      // 自己發光
      const g = ctx.createRadialGradient(cx, r.y + r.h / 2, 0, cx, r.y + r.h / 2, r.w);
      g.addColorStop(0, rgba(WHITE, 0.45 * fade));
      g.addColorStop(1, rgba(WHITE, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - r.w, r.y + r.h / 2 - r.w, r.w * 2, r.w * 2);
      GEO.forEach((c, i) => {
        const at = PILLARS[0] + (i / 6) * (PILLARS[1] - PILLARS[0]), k = clamp01((t - at) / 0.15);
        if (k <= 0) return;
        const a = (i / 6) * TAU + 0.3, px = cx + Math.cos(a) * (r.w * 0.7 + 12 * S), py = gy + Math.sin(a) * 10 * S;
        const gather = clamp01((t - GATHER[0]) / (GATHER[1] - GATHER[0]));
        // 光柱：從地上往上長；收的時候柱子往頭上那一點倒過去
        const h = 70 * S * k, x0 = lerp(px, cx, gather), y0 = lerp(py, top, gather), x1 = lerp(px, cx, gather * 0.9), y1 = lerp(py - h, top, gather);
        const gr = ctx.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, rgba(c, 0.85 * fade));
        gr.addColorStop(1, rgba(c, 0));
        ctx.strokeStyle = gr;
        ctx.lineWidth = 5 * S * (1 - gather * 0.6);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      });
    });
  },
  pose(pet, p, m, t) { if (t < GATHER[1]) { p.sy = 1 + 0.08 * clamp01(t / 0.5); p.sx = 1 - 0.03 * clamp01(t / 0.5); } }, // 吸收大地的力量
};

export const FAIRY = { fairylock, moonblast, fairywind, disarmingvoice, geomancy };
