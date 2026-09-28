// 水屬性 5 招，每一招自己的演出（規格：外型、節奏、打中的樣子都跟最像的招不一樣）
//   水槍       細水柱受重力往下彎、沿路滴水，打中濺出皇冠形水花、地上留一灘水
//   泡沫       7 顆大小不同的泡泡慢慢飄、左右搖，有 2 顆半路自己破，碰到一顆一顆「啵」
//   水之波動   手上一顆水球脹縮 3 下再直直射出，沿路一圈一圈漣漪，打中是地上擴散的橢圓波紋
//   飛水手裏劍 3 片四刃手裏劍高速自轉、水平連射、拖一條水帶，打中碎成扇形水滴＋X 字刀痕
//   蒸汽爆炸   目標腳下發橘光、裂開，往上噴白色蒸汽柱，雲往兩邊翻滾
import * as FX from '../movefx.js';
import { TAU, lerp, clamp01, rgba, glow, part, groundOf, mover, ribbon, cut, ripple } from './kit.js';

const BLUE = '#4a90e8', LIGHT = '#bfe2ff', PALE = '#e8f6ff';

// ---------- 飛水手裏劍 ----------
function drawShuriken(ctx, x, y, r, ang, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    // 一片彎刃：從中心附近彎出去到刀尖，再彎回來
    ctx.moveTo(Math.cos(a + 0.9) * r * 0.28, Math.sin(a + 0.9) * r * 0.28);
    ctx.quadraticCurveTo(Math.cos(a + 0.3) * r * 0.85, Math.sin(a + 0.3) * r * 0.85, Math.cos(a) * r, Math.sin(a) * r);
    ctx.quadraticCurveTo(Math.cos(a - 0.2) * r * 0.45, Math.sin(a - 0.2) * r * 0.45, Math.cos(a - 0.9) * r * 0.28, Math.sin(a - 0.9) * r * 0.28);
    ctx.closePath();
  }
  ctx.fillStyle = BLUE;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r / 7);
  ctx.strokeStyle = PALE;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.22, 0, TAU);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
}

// 往前方噴的扇形水滴
function spray(stage, x, y, dir, n = 8) {
  const S = stage.S;
  stage.fx.burst(x, y, S, [LIGHT, PALE, BLUE], { n, speed: 150, dir: dir > 0 ? -0.35 : Math.PI + 0.35, spread: 1.3, g: 380, life: 0.5, size: S });
}

const THROW = [0.25, 0.37, 0.49], FLY = 0.22, SHURIKEN_R = 11; // 猜的，可調整

const watershuriken = {
  time: () => ({ dur: 1.15, hit: THROW[2] + FLY + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= { thrown: 0 });
    while (s.thrown < 3 && t >= THROW[s.thrown]) {
      const i = s.thrown++, from = pet.mouth(), to = K.targetPoint(m.target), dy = [-6, 0, 6][i] * S, dir = pet.facing;
      const a = { x: from.x, y: from.y }, b = { x: to.x, y: to.y + dy };
      mover(st, {
        life: FLY, S,
        path: k => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) }),
        drawAt: (ctx, q, p) => {
          ribbon(ctx, p.hist, S, LIGHT, 5, 0.8);
          drawShuriken(ctx, q.x, q.y, SHURIKEN_R * S, p.t * 40 * dir);
        },
        onArrive: q => {
          spray(st, q.x, q.y, dir, 6);
          if (i < 2) {
            cut(st, q.x, q.y, i === 0 ? 0.75 : -0.75, 40, BLUE, { life: 0.65 }); // 前兩片各一道，交叉成 X（留一下）
            FX.hitSpark(st, q.x, q.y, PALE, 12, 6);
            if (K.isPet(m.target)) m.target.flinchT = 0.2;
          } else if (pet.moveCtx === m) K.hit(pet);
        },
      });
    }
  },
  // 丟之前：嘴巴前面長出第一片，轉著
  draw(ctx, pet, m, t) {
    if (t >= THROW[0]) return;
    const f = pet.mouth(), S = pet.S;
    drawShuriken(ctx, f.x + pet.facing * 4 * S, f.y - 2 * S, SHURIKEN_R * S * clamp01(t / 0.2), t * 30, clamp01(t / 0.1));
  },
  pose(pet, p, m, t) {
    if (t < THROW[0]) p.rot = -pet.facing * 0.16; // 往後拉
    else if (t < THROW[2] + 0.1) p.rot = pet.facing * (0.12 + 0.06 * Math.sin((t - THROW[0]) * 52)); // 一片接一片甩出去
  },
  impact(pet, m, at) {
    const st = pet.stage;
    spray(st, at.x, at.y, pet.facing, 14);
    cut(st, at.x, at.y, 0, 48, BLUE, { width: 2.5, life: 0.6 }); // 最後一片橫著切過去
    FX.hitSpark(st, at.x, at.y, PALE, 22, 8);
    for (let i = 0; i < 4; i++) ripple(st, at.x, at.y, LIGHT, 2, 8, { life: 0.25, delay: i * 0.03, width: 1 });
  },
};

// ---------- 泡沫 ----------
// 每顆：出發時間、半徑（美術像素）、飛多久、搖的相位、半路破不破
const BUBBLES = [
  [0.10, 5, 1.05, 0.0, false], [0.18, 3, 0.95, 1.3, true], [0.26, 7, 1.10, 2.1, false], [0.34, 4, 0.90, 3.4, false],
  [0.42, 6, 1.00, 4.2, false], [0.50, 3, 0.85, 5.0, true], [0.58, 5, 0.95, 0.7, false],
]; // 猜的，可調整

function drawBubble(ctx, x, y, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = rgba('#8ec5ff', 0.18);
  ctx.fill();
  ctx.lineWidth = Math.max(1, r / 5);
  ctx.strokeStyle = rgba(PALE, 0.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.62, -2.5, -1.6);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();
}
function pop(stage, x, y, r) {
  const S = stage.S;
  ripple(stage, x, y, PALE, r / S, (r / S) * 2.2, { life: 0.18, width: 1 });
  stage.fx.burst(x, y, S, [PALE, LIGHT], { n: 4, speed: 60, spread: TAU, g: 120, life: 0.35, size: S / 2 });
}

const bubble = {
  time: () => ({ dur: 1.9, hit: 1.16 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= { n: 0 });
    while (s.n < BUBBLES.length && t >= BUBBLES[s.n][0]) {
      const [, rr, L, ph, midPop] = BUBBLES[s.n++];
      const from = pet.mouth(), to = K.targetPoint(m.target), r = rr * S;
      const end = midPop ? 0.55 : 1; // 半路自己破的只飛一半
      const path = k => {
        const u = k * end;
        return { x: lerp(from.x, to.x, u), y: lerp(from.y, to.y, u) - Math.sin(u * Math.PI) * 14 * S + Math.sin(u * TAU * 1.5 + ph) * 7 * S };
      };
      mover(st, { life: L * end, S, path, drawAt: (ctx, q) => drawBubble(ctx, q.x, q.y, r), onArrive: q => pop(st, q.x, q.y, r) });
    }
  },
  pose(pet, p, m, t) { if (t < 0.65) p.sy = 1 + Math.sin(t * 38) * 0.04; }, // 一顆一顆吹出來
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    [[-8, -6], [7, 2], [-2, 9]].forEach(([dx, dy], i) => FX.later(st, i * 0.06, () => pop(st, at.x + dx * S, at.y + dy * S, 4 * S)));
  },
};

// ---------- 水之波動 ----------
const PULSE_END = 0.55, PULSE_FLY = 0.4; // 猜的，可調整
function drawOrb(ctx, x, y, r) {
  ctx.save();
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  g.addColorStop(0, rgba(PALE, 0.95));
  g.addColorStop(0.5, rgba('#5aa0f0', 0.75));
  g.addColorStop(1, rgba(BLUE, 0.35));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.lineWidth = Math.max(1, r / 6);
  ctx.strokeStyle = PALE;
  ctx.stroke();
  ctx.restore();
}
const orbAt = pet => { const f = pet.mouth(); return { x: f.x + pet.facing * 7 * pet.S, y: f.y }; };

const waterpulse = {
  time: () => ({ dur: 1.5, hit: PULSE_END + PULSE_FLY + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    if (t >= PULSE_END && !m.s) {
      m.s = true;
      const a = orbAt(pet), b = K.targetPoint(m.target);
      mover(st, {
        life: PULSE_FLY, S,
        path: k => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) }),
        drawAt: (ctx, q) => drawOrb(ctx, q.x, q.y, 9 * S),
        onArrive: () => { if (pet.moveCtx === m) K.hit(pet); },
      });
      // 沿路一圈一圈的漣漪（直的橢圓，跟著球往前）
      for (let i = 0; i < 5; i++) FX.later(st, 0.05 + i * 0.07, () => {
        const k = (0.05 + i * 0.07) / PULSE_FLY;
        ripple(st, lerp(a.x, b.x, k), lerp(a.y, b.y, k), LIGHT, 5, 13, { flat: 2.2, life: 0.35, width: 1.2 });
      });
    }
  },
  // 手上的水球脹縮 3 下
  draw(ctx, pet, m, t) {
    if (t >= PULSE_END) return;
    const o = orbAt(pet), S = pet.S;
    const grow = clamp01(t / 0.2), beat = 1 + 0.3 * Math.max(0, Math.sin((t / PULSE_END) * 3 * TAU - Math.PI / 2));
    drawOrb(ctx, o.x, o.y, (4 + 5 * grow) * S * beat);
  },
  pose(pet, p, m, t) {
    if (t < PULSE_END) { const b = Math.sin((t / PULSE_END) * 3 * TAU); p.sx = 1 + b * 0.04; p.sy = 1 - b * 0.04; }
    else if (t < PULSE_END + 0.25) p.rot = pet.facing * 0.1;
  },
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, g = groundOf(m, K, S);
    for (let i = 0; i < 3; i++) ripple(st, g.x, g.y, LIGHT, 8, 44 + i * 10, { flat: 0.28, life: 0.7, delay: i * 0.13, width: 2, fill: 0.25 });
    drawBurst(st, at.x, at.y);
    if (K.isPet(m.target)) m.target.squashT = 0.18;
  },
};
function drawBurst(st, x, y) {
  const S = st.S;
  part(st, { x, y, life: 0.25, draw: (ctx, p, k) => { ctx.save(); ctx.globalAlpha = 1 - k; drawOrb(ctx, p.x, p.y, (9 + k * 14) * S); ctx.restore(); } });
  st.fx.burst(x, y, S, [LIGHT, PALE], { n: 8, speed: 90, spread: TAU, g: 200, life: 0.5, size: S });
}

// ---------- 水槍 ----------
const JET_ON = 0.25, JET_REACH = 0.3, JET_OFF = 0.95; // 猜的，可調整
const jetPoint = (a, b, u, S) => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) + Math.sin(u * Math.PI) * 16 * S }); // 受重力往下彎

const watergun = {
  time: () => ({ dur: 1.3, hit: JET_ON + JET_REACH + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const a = pet.mouth(), b = K.targetPoint(m.target);
    const u1 = clamp01((t - JET_ON) / JET_REACH), u0 = clamp01((t - JET_OFF) / 0.25);
    if (u1 <= u0) return;
    // 沿路滴下來的水
    if (Math.random() < dt * 18) {
      const q = jetPoint(a, b, lerp(u0, u1, Math.random()), S);
      st.fx.add({ rect: LIGHT, size: S / 2, x: q.x, y: q.y, vx: pet.facing * 20 * S, vy: 10 * S, g: 420 * S, life: 0.45 });
    }
    // 打到的地方一直往上濺（皇冠）
    if (u1 >= 1 && t < JET_OFF && Math.random() < dt * 30) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.8, v = (70 + Math.random() * 50) * S;
      st.fx.add({ rect: Math.random() < 0.5 ? PALE : LIGHT, size: S / 2, x: b.x, y: b.y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, g: 380 * S, life: 0.5 });
    }
  },
  draw(ctx, pet, m, t, K) {
    const S = pet.S, a = pet.mouth(), b = K.targetPoint(m.target);
    const u1 = clamp01((t - JET_ON) / JET_REACH), u0 = clamp01((t - JET_OFF) / 0.25);
    if (u1 <= u0) return;
    const n = 24, wob = 1 + Math.sin(t * 45) * 0.15;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [w, c] of [[4.5, rgba('#5aa0f0', 0.85)], [2, LIGHT], [0.8, '#ffffff']]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w * S * wob;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const q = jetPoint(a, b, lerp(u0, u1, i / n), S);
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  },
  pose(pet, p, m, t) { if (t > JET_ON && t < JET_OFF) p.rot = pet.facing * (0.06 + Math.sin(t * 45) * 0.015); },
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, g = groundOf(m, K, S);
    st.fx.burst(at.x, at.y, S, [PALE, LIGHT, '#5aa0f0'], { n: 14, speed: 130, dir: -Math.PI / 2, spread: 1.6, g: 340, life: 0.6, size: S });
    // 地上的一灘水，慢慢乾
    part(st, {
      x: g.x, y: g.y, life: 1.3,
      draw: (ctx, p, k) => {
        const rx = (14 + 12 * Math.min(1, k * 4)) * S * (1 - k * 0.4);
        ctx.save();
        ctx.globalAlpha = 0.55 * (1 - k);
        ctx.fillStyle = '#5aa0f0';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rx, rx * 0.22, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = PALE;
        ctx.fillRect(p.x - rx * 0.4, p.y - S, rx * 0.35, S);
        ctx.restore();
      },
    });
  },
};

// ---------- 蒸汽爆炸 ----------
const CRACK = [[-26, 0], [-17, -2], [-10, 1], [-3, -1], [4, 2], [12, -1], [19, 1], [26, -1]]; // 美術像素，猜的，可調整
const BRANCH = [[[-10, 1], [-13, 5]], [[4, 2], [7, 6]], [[12, -1], [16, -5]]];
const ERUPT = 0.9, GEYSER = 0.75;

const steameruption = {
  time: () => ({ dur: 1.75, hit: ERUPT }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= {});
    if (!s.crack) {
      s.crack = true;
      const g = groundOf(m, K, S);
      // 地面發橘光、裂縫一段一段裂開
      part(st, {
        x: g.x, y: g.y, life: ERUPT + 0.3,
        draw: (ctx, p) => {
          const k = clamp01(p.t / (ERUPT - 0.1)), fade = p.t > ERUPT ? 1 - (p.t - ERUPT) / 0.3 : 1;
          glow(ctx, () => {
            const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 30 * S);
            gr.addColorStop(0, rgba('#ff9d3a', 0.8 * k * fade));
            gr.addColorStop(1, rgba('#ff6a2a', 0));
            ctx.fillStyle = gr;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.scale(1, 0.28);
            ctx.translate(-p.x, -p.y);
            ctx.fillRect(p.x - 30 * S, p.y - 30 * S, 60 * S, 60 * S);
            ctx.restore();
          });
          ctx.save();
          ctx.globalAlpha = fade;
          ctx.strokeStyle = '#ffd25a';
          ctx.lineWidth = S;
          ctx.beginPath();
          const n = Math.max(1, Math.round(k * (CRACK.length - 1)));
          const mid = (CRACK.length - 1) / 2;
          // 從中間往兩邊裂
          CRACK.forEach(([x, y], i) => {
            if (Math.abs(i - mid) > n / 2 + 0.5) return;
            const X = p.x + x * S, Y = p.y + y * S;
            ctx.lineTo(X, Y);
          });
          ctx.stroke();
          if (k > 0.6) for (const [[x0, y0], [x1, y1]] of BRANCH) { ctx.beginPath(); ctx.moveTo(p.x + x0 * S, p.y + y0 * S); ctx.lineTo(p.x + x1 * S, p.y + y1 * S); ctx.stroke(); }
          ctx.restore();
        },
      });
    }
    // 裂縫冒出一點點蒸汽
    if (t < ERUPT && t > 0.3) {
      s.puffT = (s.puffT ?? 0) - dt;
      if (s.puffT <= 0) {
        s.puffT = 0.12;
        const g = groundOf(m, K, S);
        FX.blob(st, { x: g.x + (Math.random() - 0.5) * 40 * S, y: g.y, vy: -30 * S, s0: 6, s1: 12, a0: 0.5, a1: 0, life: 0.5, col: '#ffffff', wisp: true });
      }
    }
    if (t > 0.45 && t < ERUPT && !s.rumble) { s.rumble = true; st.shake(1.5, ERUPT - 0.45); } // 地面在抖（減少震動時不抖）
  },
  pose(pet, p, m, t) { if (t < ERUPT) { p.sx = 1.05; p.sy = 0.95; } }, // 往下壓（讓地面噴出來）
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, g = groundOf(m, K, S);
    // 白色蒸汽柱：很快長高、變粗、淡掉
    part(st, {
      x: g.x, y: g.y, life: GEYSER,
      draw: (ctx, p, k) => {
        const h = 120 * S * Math.min(1, k * 6), w = (14 + 12 * k) * S, a = k < 0.6 ? 0.9 : 0.9 * (1 - (k - 0.6) / 0.4);
        const gr = ctx.createLinearGradient(0, p.y, 0, p.y - h);
        gr.addColorStop(0, rgba('#ffffff', a));
        gr.addColorStop(0.7, rgba(PALE, a * 0.6));
        gr.addColorStop(1, rgba(PALE, 0));
        ctx.save();
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.moveTo(p.x - w / 2, p.y);
        ctx.quadraticCurveTo(p.x - w * 0.3, p.y - h * 0.5, p.x - w * 0.7, p.y - h);
        ctx.lineTo(p.x + w * 0.7, p.y - h);
        ctx.quadraticCurveTo(p.x + w * 0.3, p.y - h * 0.5, p.x + w / 2, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      },
    });
    // 往上翻滾的雲、沿著地面往兩邊滾的雲
    for (let i = 0; i < 7; i++) FX.blob(st, { x: g.x + (i - 3) * 3 * S, y: g.y - 20 * S - i * 12 * S, vy: -110 * S, vx: (i - 3) * 10 * S, s0: 18, s1: 46, a0: 0.8, a1: 0, life: 0.9, col: '#ffffff', wisp: true, delay: i * 0.04 });
    for (const dir of [-1, 1]) for (let i = 0; i < 3; i++) FX.blob(st, { x: g.x + dir * 8 * S, y: g.y - 4 * S, vx: dir * (70 + i * 30) * S, vy: -8 * S, s0: 16, s1: 36, a0: 0.7, a1: 0, life: 0.9, col: '#ffffff', wisp: true, delay: 0.05 + i * 0.05 });
    st.fx.burst(g.x, g.y, S, ['#ffd25a', '#ff9d3a'], { n: 8, speed: 130, dir: -Math.PI / 2, spread: 0.9, g: 300, life: 0.6, size: S });
    if (K.isPet(m.target)) m.target.squashT = 0.18;
  },
};

export const WATER = { watergun, bubble, waterpulse, watershuriken, steameruption };
