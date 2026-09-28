// 鋼屬性 2 招，每一招自己的演出
//   王者盾牌 正前方從地上升起一面金邊金屬大盾，「鏗」一道斜斜的閃光立好，盾面光澤掃過去
//   加農光炮 嘴前一個白點越變越大（四周的線往裡收），射出最粗、邊緣是直的光炮，自己往後退一步（後座力）
import * as FX from '../movefx.js';
import { clamp01, rgba, glow, part } from './kit.js';

const SILVER = '#b8c0d8', STEEL = '#8898c0', DARKSTEEL = '#4a5470', GOLD = '#ffe066', WHITE = '#ffffff';

// ---------- 王者盾牌 ----------
const RISE = [0.1, 0.35], CLANG = 0.4, SHEEN = [0.6, 0.95], KS_OFF = [1.2, 1.45]; // 猜的，可調整
function shieldPath(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y - h / 2);
  ctx.lineTo(x + w / 2, y - h / 2);
  ctx.lineTo(x + w / 2, y + h * 0.1);
  ctx.quadraticCurveTo(x + w / 2, y + h * 0.4, x, y + h / 2);
  ctx.quadraticCurveTo(x - w / 2, y + h * 0.4, x - w / 2, y + h * 0.1);
  ctx.closePath();
}
const kingsshield = {
  time: () => ({ dur: KS_OFF[1] + 0.05, hit: null }),
  update(pet, m, t) {
    if (t >= CLANG && !m.s) {
      m.s = true;
      const st = pet.stage, S = pet.S, c = shieldAt(pet);
      // 「鏗」：斜斜一道白光＋幾顆亮點
      part(st, { x: c.x, y: c.y, life: 0.3, draw: (ctx, p, k) => glow(ctx, () => { ctx.strokeStyle = rgba(WHITE, 1 - k); ctx.lineWidth = 3 * S * (1 - k); ctx.beginPath(); ctx.moveTo(p.x - 22 * S, p.y + 22 * S); ctx.lineTo(p.x + 22 * S, p.y - 22 * S); ctx.stroke(); }) });
      st.fx.sparkles(c.x, c.y, S, 5, 20);
      st.shake(1.5, 0.1);
    }
  },
  draw(ctx, pet, m, t) {
    const S = pet.S, c = shieldAt(pet), w = 30 * S, h = 40 * S;
    const rise = clamp01((t - RISE[0]) / (RISE[1] - RISE[0])), fade = t > KS_OFF[0] ? clamp01(1 - (t - KS_OFF[0]) / (KS_OFF[1] - KS_OFF[0])) : 1;
    if (rise <= 0 || fade <= 0) return;
    const y = c.y + (1 - rise) * 20 * S;
    ctx.save();
    ctx.globalAlpha = fade * rise;
    // 盾面：金屬漸層
    shieldPath(ctx, c.x, y, w, h);
    const g = ctx.createLinearGradient(c.x - w / 2, y - h / 2, c.x + w / 2, y + h / 2);
    g.addColorStop(0, SILVER);
    g.addColorStop(0.5, WHITE);
    g.addColorStop(1, STEEL);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2.5 * S;
    ctx.stroke();
    // 中間的紋章：金色十字
    ctx.fillStyle = GOLD;
    ctx.fillRect(c.x - 1.5 * S, y - h * 0.3, 3 * S, h * 0.55);
    ctx.fillRect(c.x - w * 0.25, y - h * 0.12, w * 0.5, 3 * S);
    // 光澤掃過去
    const u = (t - SHEEN[0]) / (SHEEN[1] - SHEEN[0]);
    if (u > 0 && u < 1) {
      ctx.save();
      shieldPath(ctx, c.x, y, w, h);
      ctx.clip();
      const x = c.x - w + u * 2 * w;
      ctx.fillStyle = rgba(WHITE, 0.85);
      ctx.beginPath();
      ctx.moveTo(x - 3 * S, y + h / 2); ctx.lineTo(x + 3 * S, y + h / 2); ctx.lineTo(x + 12 * S, y - h / 2); ctx.lineTo(x + 6 * S, y - h / 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },
  pose(pet, p, m, t) { if (t < KS_OFF[0]) { p.sy = 1.06; p.sx = 0.97; } }, // 站得直直的
};
function shieldAt(pet) { const r = pet.rect(); return { x: pet.x + pet.facing * (r.w * 0.5 + 12 * pet.S), y: r.y + r.h * 0.5 }; }

// ---------- 加農光炮 ----------
const FC_CHARGE = 0.4, FC_OFF = 0.95, FC_W = 12; // 猜的，可調整
const flashcannon = {
  time: () => ({ dur: 1.3, hit: FC_CHARGE + 0.05 }),
  update(pet, m, t, dt, K) {
    // 後座力：光炮射出去的時候往後退一步
    K.dash(pet, m, t < FC_CHARGE ? 0 : t < FC_CHARGE + 0.12 ? -0.08 * ((t - FC_CHARGE) / 0.12) : t < FC_OFF ? -0.08 : Math.max(-0.08, -0.08 * (1 - (t - FC_OFF) / 0.3)));
  },
  draw(ctx, pet, m, t, K) {
    const S = pet.S, a = pet.mouth(), b = K.targetPoint(m.target), calm = pet.stage.calmFx;
    if (t < FC_CHARGE) {
      // 白點越變越大，四周的線往裡收
      const k = t / FC_CHARGE;
      glow(ctx, () => {
        const r = (2 + 8 * k) * S, g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, r * 2);
        g.addColorStop(0, rgba(WHITE, 1)); g.addColorStop(0.5, rgba(SILVER, 0.7)); g.addColorStop(1, rgba(SILVER, 0));
        ctx.fillStyle = g;
        ctx.fillRect(a.x - r * 2, a.y - r * 2, r * 4, r * 4);
        ctx.strokeStyle = rgba(WHITE, 0.8);
        ctx.lineWidth = S;
        for (let i = 0; i < 6; i++) { const ang = (i / 6) * Math.PI * 2 + 0.3, d = (40 - 34 * ((t * 4 + i * 0.3) % 1)) * S; ctx.beginPath(); ctx.moveTo(a.x + Math.cos(ang) * d, a.y + Math.sin(ang) * d); ctx.lineTo(a.x + Math.cos(ang) * (d - 8 * S), a.y + Math.sin(ang) * (d - 8 * S)); ctx.stroke(); }
      });
      return;
    }
    if (t > FC_OFF + 0.2) return;
    const fade = t > FC_OFF ? 1 - (t - FC_OFF) / 0.2 : 1, grow = clamp01((t - FC_CHARGE) / 0.06);
    const ang = Math.atan2(b.y - a.y, b.x - a.x), len = Math.hypot(b.x - a.x, b.y - a.y) * grow;
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(ang);
    // 最粗、邊緣是直的：外層銀色、中間白色（不是圓頭的光）
    const w = FC_W * S * fade * (1 + Math.sin(t * 60) * 0.05);
    ctx.fillStyle = rgba(STEEL, 0.55);
    ctx.fillRect(0, -w * 0.75, len, w * 1.5);
    ctx.fillStyle = rgba(SILVER, 0.9);
    ctx.fillRect(0, -w / 2, len, w);
    ctx.fillStyle = WHITE;
    ctx.fillRect(0, -w / 4, len, w / 2);
    ctx.fillStyle = DARKSTEEL;
    ctx.fillRect(0, -w * 0.75, len, S); // 硬邊
    ctx.fillRect(0, w * 0.75 - S, len, S);
    ctx.restore();
    // 射出去的一瞬間：嘴前白閃（減少閃光時很淡）
    if (t < FC_CHARGE + 0.12) glow(ctx, () => { const r = 30 * S, g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, r); g.addColorStop(0, rgba(WHITE, calm ? 0.25 : 0.95)); g.addColorStop(1, rgba(WHITE, 0)); ctx.fillStyle = g; ctx.fillRect(a.x - r, a.y - r, r * 2, r * 2); });
  },
  pose(pet, p, m, t) { if (t < FC_CHARGE) { p.sx = 1.06; p.sy = 0.94; } else if (t < FC_OFF) p.rot = -pet.facing * 0.1; }, // 被後座力推得往後仰
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    const calm = st.calmFx;
    FX.blob(st, { x: at.x, y: at.y, s0: 20, s1: 70, a0: calm ? 0.35 : 1, a1: 0, life: 0.3, col: WHITE });
    for (let i = 0; i < 6; i++) st.fx.add({ rect: i % 2 ? WHITE : SILVER, size: S, x: at.x, y: at.y, vx: Math.cos(i) * 150 * S, vy: Math.sin(i) * 150 * S - 40 * S, g: 200 * S, life: 0.5 });
    st.fx.sparkles(at.x, at.y, S, 6, 24);
  },
};

export const STEEL_MOVES = { kingsshield, flashcannon };
