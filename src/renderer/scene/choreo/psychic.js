// 超能屬性 4 招，每一招自己的演出
//   念力       沒有東西飛過去：目標身邊一圈圈粉紅扭曲、頭上轉圈的星星，在原地晃（被弄暈）
//   精神強念   自己頭上一圈圈粉紅波紋、兩隻中間閃一下粉紅光（桌面是透明的，沒辦法真的把後面的顏色反轉），目標被舉到半空再砸到地上
//   反射壁     六角形玻璃沿著身前一道弧一片一片拼起來（比自己高、彎彎的護罩），拼好後一道反光掃過去
//   異次元洞   目標背後打開一個圓環洞，自己的拳頭從洞裡打出來（自己這邊也開一個小洞）
import * as FX from '../movefx.js';
import { TAU, lerp, clamp01, rgba, glow, part, groundOf, ripple, lift } from './kit.js';

const PINK = '#ff4d9e', PINK2 = '#ffc8e4', VIOLET = '#c070ff', DEEP = '#5a2a8a', WHITE = '#ffffff', GLASS = '#7ab8ff', GOLD = '#ffe066';

const headOf = pet => { const r = pet.rect(); return { x: pet.x, y: r.y + r.h * 0.25 }; };
function star(ctx, x, y, r, col) {
  ctx.save();
  ctx.fillStyle = col;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * TAU, rr = i % 2 ? r * 0.45 : r; i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
// 額頭發光（超能力）
function brow(ctx, pet, k, t) {
  const S = pet.S, h = headOf(pet);
  glow(ctx, () => {
    const r = (6 + 3 * Math.sin(t * 20)) * S * k;
    const g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, r * 2);
    g.addColorStop(0, rgba(WHITE, 0.9 * k));
    g.addColorStop(0.3, rgba(PINK, 0.7 * k));
    g.addColorStop(1, rgba(PINK, 0));
    ctx.fillStyle = g;
    ctx.fillRect(h.x - r * 2, h.y - r * 2, r * 4, r * 4);
  });
}

// ---------- 念力 ----------
const CF_ON = 0.15, CF_OFF = 1.25; // 猜的，可調整
const confusion = {
  time: () => ({ dur: 1.5, hit: 1.15 }),
  update(pet, m, t, dt, K) {
    // 目標在原地晃：一下一下小小彈起來（hopT）
    const s = (m.s ??= { n: 0 });
    if (K.isPet(m.target) && t > CF_ON + 0.1 && t < 1.1 && t > CF_ON + 0.1 + s.n * 0.22) { s.n++; m.target.hopT = 0.2; }
  },
  draw(ctx, pet, m, t, K) {
    if (t < CF_ON || t > CF_OFF + 0.2) return;
    const S = pet.S, k = clamp01((t - CF_ON) / 0.2) * (t > CF_OFF ? 1 - (t - CF_OFF) / 0.2 : 1);
    brow(ctx, pet, k, t);
    const r = K.isPet(m.target) ? m.target.rect() : (() => { const b = K.targetPoint(m.target); return { x: b.x - 14 * S, y: b.y - 14 * S, w: 28 * S, h: 28 * S }; })();
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    // 一圈圈會扭的粉紅圈
    ctx.save();
    ctx.globalAlpha = k;
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = i % 2 ? PINK2 : PINK;
      ctx.lineWidth = 1.5 * S;
      ctx.beginPath();
      for (let j = 0; j <= 32; j++) {
        const a = (j / 32) * TAU, rr = (r.w * 0.45 + i * 6 * S) * (1 + Math.sin(a * 4 + t * 10 + i) * 0.08);
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.75;
        j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    // 頭上轉圈的星星（暈了）
    for (let i = 0; i < 3; i++) { const a = t * 6 + (i / 3) * TAU; star(ctx, cx + Math.cos(a) * 12 * S, r.y - 4 * S + Math.sin(a) * 3 * S, 3 * S, GOLD); }
    ctx.restore();
  },
  pose(pet, p, m, t) { if (t > CF_ON && t < CF_OFF) p.sy = 1.04; }, // 集中精神
  impact(pet, m, at) {
    const st = pet.stage;
    FX.hitSpark(st, at.x, at.y, PINK2, 18, 8);
    ripple(st, at.x, at.y, PINK, 4, 26, { life: 0.35, width: 2 });
  },
};

// ---------- 精神強念 ----------
const PS_LIFT = [0.35, 0.3, 0.25], PS_SLAM = 0.95; // 升、停、砸；猜的，可調整
const psychic = {
  time: () => ({ dur: 1.5, hit: PS_SLAM }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= { rings: 0 });
    // 頭上一圈圈粉紅波紋
    if (t > 0.1 && s.rings < 4 && t > 0.1 + s.rings * 0.18) { s.rings++; const h = headOf(pet); ripple(st, h.x, h.y, s.rings % 2 ? PINK : VIOLET, 6, 40, { life: 0.5, width: 2 }); }
    if (t > PS_SLAM - PS_LIFT[0] - PS_LIFT[1] - PS_LIFT[2] && !s.lifted) { s.lifted = true; if (K.isPet(m.target)) lift(st, m.target, { up: PS_LIFT[0], hold: PS_LIFT[1], down: PS_LIFT[2], height: 34, slam: true }); }
  },
  draw(ctx, pet, m, t, K) {
    const S = pet.S, k = clamp01(t / 0.2) * (t > 1.2 ? clamp01(1 - (t - 1.2) / 0.2) : 1);
    brow(ctx, pet, k, t);
    // 兩隻中間閃一下粉紅光（柔邊；減少閃光時很淡）
    if (t > 0.25 && t < 0.45) {
      const a = pet.mouth(), b = K.targetPoint(m.target), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, R = Math.abs(b.x - a.x) / 2 + 50 * S;
      const k2 = Math.sin(((t - 0.25) / 0.2) * Math.PI) * (pet.stage.calmFx ? 0.2 : 0.55);
      glow(ctx, () => {
        ctx.translate(cx, cy);
        ctx.scale(1, 0.45);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
        g.addColorStop(0, rgba(PINK2, k2));
        g.addColorStop(0.6, rgba(PINK, k2 * 0.5));
        g.addColorStop(1, rgba(PINK, 0));
        ctx.fillStyle = g;
        ctx.fillRect(-R, -R, R * 2, R * 2);
      });
    }
    // 目標身上一層粉紅光（被念力抓住）
    if (K.isPet(m.target) && t > 0.3 && t < PS_SLAM) {
      const r = m.target.rect();
      glow(ctx, () => { ctx.strokeStyle = rgba(PINK, 0.8); ctx.lineWidth = 2 * S; ctx.beginPath(); ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w * 0.6, r.h * 0.6, 0, 0, TAU); ctx.stroke(); });
    }
  },
  pose(pet, p, m, t) { if (t > 0.3 && t < PS_SLAM) p.sy = 1.05 + Math.sin(t * 30) * 0.02; else if (t >= PS_SLAM && t < PS_SLAM + 0.15) p.rot = pet.facing * 0.1; },
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, g = groundOf(m, K, S);
    FX.shockwave(st, g.x, g.y, PINK, 60, { flat: 0.3, thick: 4 });
    ripple(st, g.x, g.y, VIOLET, 10, 44, { flat: 0.3, life: 0.5, width: 2, delay: 0.08 });
    st.fx.burst(g.x, g.y, S, [PINK, PINK2, WHITE], { n: 10, speed: 100, dir: -Math.PI / 2, spread: 2.4, g: 300, life: 0.5, size: S });
    if (K.isPet(m.target)) m.target.squashT = 0.18;
  },
};

// ---------- 反射壁 ----------
// 六角形沿著身前的一道弧排（從中間往上下拼）；N_HEX 片、弧的角度範圍；猜的，可調整
const N_HEX = 11, ARC = 1.3;
const HEX = Array.from({ length: N_HEX }, (_, i) => { const j = i % 2 ? (i + 1) / 2 : -i / 2; return j / ((N_HEX - 1) / 2); }); // -1…1，拼的順序：中間 → 上下
function hex(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  ctx.closePath();
}
const reflect = {
  time: () => ({ dur: 1.5, hit: null }),
  update() {},
  draw(ctx, pet, m, t) {
    const S = pet.S, r = pet.rect(), f = pet.facing, cx = pet.x, cy = r.y + r.h * 0.5, R = 10 * S, rad = Math.max(r.w, r.h) * 0.75 + 14 * S;
    const at = v => { const a = v * ARC; return { x: cx + f * Math.cos(a) * rad, y: cy + Math.sin(a) * rad }; };
    const fade = t > 1.2 ? clamp01(1 - (t - 1.2) / 0.3) : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    HEX.forEach((v, i) => {
      const t0 = 0.1 + i * 0.05, k = clamp01((t - t0) / 0.1);
      if (k <= 0) return;
      const { x, y } = at(v);
      hex(ctx, x, y, R * k);
      ctx.fillStyle = rgba(GLASS, t > 0.7 && t < 0.8 ? 0.6 : 0.35); // 拼好時整面亮一下
      ctx.fill();
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = 1.2 * S;
      ctx.stroke();
    });
    // 拼好後：一道反光斜斜掃過去
    const sweep = (t - 0.8) / 0.3;
    if (sweep > 0 && sweep < 1) {
      ctx.save();
      ctx.beginPath();
      HEX.forEach(v => { const q = at(v); hex(ctx, q.x, q.y, R); });
      ctx.clip();
      const y = cy - rad - 2 * R + sweep * (2 * rad + 4 * R), x0 = cx + f * rad * 0.2, x1 = cx + f * (rad + 2 * R);
      ctx.fillStyle = rgba(WHITE, 0.8);
      ctx.beginPath();
      ctx.moveTo(x0, y + 2 * R); ctx.lineTo(x1, y - 2 * R); ctx.lineTo(x1, y); ctx.lineTo(x0, y + 4 * R);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },
  pose(pet, p, m, t) { if (t < 0.7) p.rot = -pet.facing * 0.06; },
};

// ---------- 異次元洞 ----------
const HOLE = [0.15, 0.45], PUNCH = 0.8, HOLE_OFF = 1.2; // 猜的，可調整
function hoop(ctx, x, y, r, t, S, alpha) {
  glow(ctx, () => {
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    g.addColorStop(0, rgba('#1a0a2a', 0.9));
    g.addColorStop(0.75, rgba(DEEP, 0.6));
    g.addColorStop(1, rgba(VIOLET, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.55, r, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2 * S;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.55, r, 0, t * 4, t * 4 + TAU * 0.85);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}
const hyperspacehole = {
  knock: -0.6, // 從背後打：目標往自己這邊飛
  time: () => ({ dur: 1.45, hit: PUNCH + 0.01 }),
  update() {},
  draw(ctx, pet, m, t, K) {
    const S = pet.S, b = K.targetPoint(m.target), dir = b.x > pet.x ? 1 : -1;
    const open = clamp01((t - HOLE[0]) / (HOLE[1] - HOLE[0])) * (t > HOLE_OFF ? clamp01(1 - (t - HOLE_OFF) / 0.2) : 1);
    if (open <= 0) return;
    const behind = { x: b.x + dir * 30 * S, y: b.y };
    hoop(ctx, behind.x, behind.y, 22 * S * open, t, S, open);
    const f = pet.mouth(), mine = { x: f.x + dir * 10 * S, y: f.y };
    hoop(ctx, mine.x, mine.y, 12 * S * open, -t, S, open * 0.9);
    // 拳頭（光團）從目標背後的洞裡打出來
    if (t > HOLE[1] && t < PUNCH + 0.15) {
      const u = clamp01((t - HOLE[1]) / (PUNCH - HOLE[1])), x = lerp(behind.x, b.x + dir * 6 * S, u * u);
      glow(ctx, () => {
        const g = ctx.createRadialGradient(x, b.y, 0, x, b.y, 10 * S);
        g.addColorStop(0, rgba(WHITE, 1)); g.addColorStop(0.4, rgba(VIOLET, 0.9)); g.addColorStop(1, rgba(VIOLET, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - 10 * S, b.y - 10 * S, 20 * S, 20 * S);
      });
    }
  },
  pose(pet, p, m, t) { if (t > HOLE[0] && t < PUNCH + 0.1) { p.rot = pet.facing * 0.2; p.ox = 3; } }, // 一拳打進自己面前的洞
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, dir = at.x > pet.x ? 1 : -1;
    FX.hitSpark(st, at.x + dir * 6 * S, at.y, VIOLET, 24, 8);
    ripple(st, at.x + dir * 6 * S, at.y, GOLD, 6, 30, { life: 0.35, width: 2 });
    st.fx.burst(at.x, at.y, S, [VIOLET, DEEP, GOLD], { n: 10, speed: 110, dir: dir > 0 ? Math.PI : 0, spread: 1.8, g: 100, life: 0.5, size: S });
  },
};

export const PSYCHIC = { confusion, psychic, reflect, hyperspacehole };
