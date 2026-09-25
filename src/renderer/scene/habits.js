// 每一種寶可夢的專屬習性動作（根據圖鑑敘述與原作設定）。
// HABITS 是動作的定義；HABITS_BY_SPECIES 決定誰會做哪些。
// 動作進行時 Pet 的狀態是 'habit'，實際的內容在 pet.habit（由 HABIT_ACTIONS.habit 轉交）。
// 每個習性可以提供：
//   zh            顯示在夥伴資料裡的說明
//   dur           秒數（或 pet => 秒數）
//   w(pet, ctx)   權重（預設 7；回傳 0 表示現在不會做）
//   social        需要另一隻夥伴：pick(pet, others) 選對象，begin(pet, other) 開始
//   start / update(pet, dt, k) / end / pose(pet, p, k) / lift(pet, k) / alpha / intangible / drawOver(pet, ctx)
import * as art from '../gfx/art.js';
import { blit } from '../gfx/pixel.js';
import { meet, isNight, isDay, WALK_SPEED, RUN_SPEED } from './behaviors.js';

const T = art.TYPE_COLORS;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.floor(Math.random() * list.length)];
const has = (pet, ...types) => pet.types.some(t => types.includes(t));
const center = pet => { const r = pet.rect(); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
const burst = (pet, x, y, colors, opts) => pet.stage.fx.burst(x, y, pet.S, colors, opts);
const idle = pet => pet.set('idle', rnd(1, 3));
const bond = (a, b, n) => a.stage.fire('bond', a, b, n);
const dist = (a, b) => Math.hypot(a.x - b.x, a.gy - b.gy) / a.S; // 美術像素
// 一個時間點只觸發一次（k 是動作進度 0–1）
const once = (pet, key, cond) => { if (!cond || pet.hd[key]) return false; pet.hd[key] = true; return true; };
const maxZ = pet => Math.max(0, (pet.gy - pet.asset.h * pet.S) / pet.S - pet.alt - 6);

// 附近閒著、可以被影響的夥伴
function around(pet, radius, { free = true } = {}) {
  return [...pet.stage.pets.values()].filter(o => o !== pet && !o.leaving && o.state !== 'held' && o.state !== 'evolving'
    && (!free || (o.free && !o.partner)) && dist(pet, o) < radius);
}
function startle(o, emote = '!') { o.set('startle', 0.5); o.showEmote(emote, 1); }

// 從 a 往 b 射出一串粒子
function stream(pet, from, to, colors, { rate = 30, dt, speed = 150 } = {}) {
  if (Math.random() > dt * rate) return;
  const S = pet.S, dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy) || 1, v = speed * S;
  pet.stage.fx.add({ rect: pick(colors), size: S / 2, x: from.x, y: from.y, vx: (dx / d) * v, vy: (dy / d) * v, life: d / v, fade: false });
}
// 繞著中心轉的粒子
function orbit(pet, colors, radius, n = 3, speed = 6) {
  const c = center(pet), S = pet.S;
  for (let i = 0; i < n; i++) {
    const a = pet.stateT * speed + (i / n) * Math.PI * 2;
    pet.stage.fx.add({ rect: colors[i % colors.length], size: S / 2 + (i % 2) * S / 2, x: c.x + Math.cos(a) * radius * S, y: c.y + Math.sin(a) * radius * S * 0.6, life: 0.2 });
  }
}
// 在牠嘴邊畫一個小道具
// （嘴巴大約在臉朝向那一側、身體中間偏上一點）
function holdAtMouth(pet, ctx, img, { dy = 0, raise = 0 } = {}) {
  const r = pet.rect(), S = pet.S;
  const mx = r.x + r.w * (pet.facing < 0 ? 0.22 : 0.78), my = r.y + r.h * 0.56;
  const x = mx - (img.width * S) / 2, y = my - raise * S + dy * S - (img.height * S) / 2;
  blit(ctx, img, x, y, S, { flipX: pet.facing < 0 });
}

export function startHabit(pet, name, data = {}) {
  const h = HABITS[name];
  pet.habit = h;
  pet.habitName = name;
  pet.hd = { ...data };
  pet.set('habit', typeof h.dur === 'function' ? h.dur(pet) : h.dur ?? 2);
  h.start?.(pet);
}

// 走到某個位置後再開始習性動作
function walkThen(pet, x, y, name, data) {
  const b = pet.bounds();
  pet.target = { x: Math.max(b.x0, Math.min(b.x1, x)), y: Math.max(b.y0, Math.min(b.y1, y)) };
  pet.set('walk');
  pet.onArrive = () => startHabit(pet, name, data);
}

// 兩隻玩打架（沿用 behaviors.js 的 spar 動作）
function beginSpar(pet, o) {
  meet(pet, o, { gap: 1, then: (a, b) => {
    a.tossRole = 0; b.tossRole = 1; a.tossN = -1;
    a.partner = b; b.partner = a;
    a.set('spar', 2.4); b.set('spar', 2.4);
    a.showEmote('!', 0.7); b.showEmote('!', 0.7);
    a.stage.markBusy(2.4);
  } });
}

export const HABITS = {
  // ---------- 哈力栗系列：硬殼、互相衝撞鍛鍊 ----------
  hunker: {
    zh: '縮進硬殼裡', dur: 2.5,
    start: pet => pet.showEmote('!', 0.8),
    pose: (pet, p) => { p.sx = 1.1; p.sy = 0.78; },
    lift: () => 0,
    end: pet => { idle(pet); pet.showEmote('♪', 1); },
  },
  ram: {
    zh: '跟夥伴互相衝撞鍛鍊', social: true,
    pick: (pet, others) => pick(others),
    begin: beginSpar,
  },
  guard: {
    zh: '舉起拳頭擺出防禦姿勢', dur: 2.4,
    update(pet, dt) { const m = pet.mouth(); if (Math.random() < dt * 8) burst(pet, m.x + pet.facing * 6 * pet.S, m.y, ['#ffffff', '#c8f0a0'], { n: 1, speed: 10, spread: 6.3, g: 0, life: 0.4 }); },
    pose: (pet, p) => { p.sy = 0.95; p.sx = 1.04; },
    end: pet => { idle(pet); pet.showEmote('✦', 1); },
  },

  // ---------- 火狐狸系列：咬樹枝、耳朵噴熱氣、樹枝火把 ----------
  twig: {
    zh: '咬著樹枝散步', dur: () => rnd(4, 7),
    start: pet => { pet.target = pet.randomPoint(60, 200); },
    update(pet, dt) { pet.moveTo(pet.target.x, pet.target.y, WALK_SPEED * pet.S * 0.7, dt); },
    lift: pet => Math.round(Math.abs(Math.sin(pet.walkPhase)) * 2),
    drawOver: (pet, ctx) => holdAtMouth(pet, ctx, art.twig),
    end: pet => { idle(pet); pet.showEmote('♪', 1); },
  },
  earpuff: {
    zh: '從耳朵噴出熱氣', dur: 1.4,
    start: pet => pet.showEmote('💢', 0.8),
    update(pet, dt) {
      const r = pet.rect();
      if (Math.random() < dt * 16) for (const sx of [0.2, 0.8]) burst(pet, r.x + r.w * sx, r.y + 2 * pet.S, ['#ffffff', '#ffd0a0', '#e0e0e0'], { n: 1, speed: 30, dir: -Math.PI / 2 + (sx - 0.5), spread: 0.4, g: -20, life: 0.8, wobble: true });
    },
    pose: (pet, p) => { p.sy = 1.05; },
  },
  signal: {
    zh: '點燃尾巴的樹枝向同伴打信號', dur: 2.6,
    update(pet, dt, k) {
      const S = pet.S, h = pet.head();
      const tip = { x: h.x + pet.facing * 12 * S, y: h.y - 6 * S + Math.sin(pet.stateT * 8) * 3 * S };
      if (k > 0.15 && Math.random() < dt * 25) burst(pet, tip.x, tip.y, ['#ff6a2a', '#ffb13a', '#ffe066'], { n: 1, speed: 20, g: -60, life: 0.4 });
      if (once(pet, 'seen', k > 0.4)) for (const o of around(pet, 400)) { o.facing = pet.x > o.x ? 1 : -1; o.showEmote('!', 1); }
    },
    drawOver(pet, ctx) {
      const S = pet.S, h = pet.head(), img = art.twig;
      blit(ctx, img, h.x + pet.facing * 12 * S - (img.width * S) / 2, h.y - 6 * S + Math.sin(pet.stateT * 8) * 3 * S, S, { flipX: pet.facing < 0 });
    },
    pose: (pet, p) => { p.rot = -pet.facing * 0.06; },
    lift: () => 0,
  },
  vortex: {
    zh: '用超能力轉出火焰漩渦', dur: 2.4,
    update(pet) { orbit(pet, ['#ff6a2a', '#ffb13a', '#ffe066', T.psychic], pet.asset.w * 0.7, 4, 7); },
    pose: (pet, p) => { p.sy = 1.04; },
    end: pet => { idle(pet); pet.showEmote('✦', 0.8); },
  },

  // ---------- 呱呱泡蛙系列：泡泡、爬高塔、忍者 ----------
  frubbles: {
    zh: '用泡泡包住全身，一邊留意四周', dur: 2.6,
    update(pet, dt) {
      const r = pet.rect();
      if (Math.random() < dt * 14) burst(pet, r.x + Math.random() * r.w, r.y + Math.random() * r.h, ['#ffffff', '#d8f0ff'], { n: 1, speed: 6, g: -4, life: 1.2, size: pet.S, wobble: true });
      pet.facing = Math.floor(pet.stateT / 0.7) % 2 ? 1 : -1;
    },
    start: pet => pet.showEmote('?', 1.2),
  },
  leap: {
    zh: '一口氣跳得老高', dur: 1.3,
    start: pet => { pet.target = pet.randomPoint(150, 380); pet.hd.d = Math.hypot(pet.target.x - pet.x, pet.target.y - pet.gy); },
    update(pet, dt, k) {
      pet.z = Math.min(maxZ(pet), Math.sin(k * Math.PI) * 90);
      pet.moveTo(pet.target.x, pet.target.y, pet.hd.d / pet.dur * 1.05, dt);
    },
    pose: (pet, p, k) => { p.sx = k < 0.1 ? 1.15 : 0.92; p.sy = k < 0.1 ? 0.85 : 1.1; },
    lift: () => 0,
    end: pet => { pet.z = 0; pet.squashT = 0.18; pet.stage.audio.sfx('land'); idle(pet); },
  },
  ninja: {
    zh: '像忍者一樣消失，又從別的地方冒出來', dur: 1.5,
    update(pet, dt, k) {
      const S = pet.S, c = center(pet);
      if (once(pet, 'poof1', k > 0.15)) burst(pet, c.x, c.y, ['#c8c8d8', '#ffffff', '#9898a8'], { n: 14, speed: 40, spread: 6.3, g: -10, life: 0.7 });
      if (once(pet, 'jump', k > 0.4)) {
        const p = pet.stage.pointer;
        const spot = p.known && Math.random() < 0.5 ? { x: p.x + rnd(-80, 80) * S, y: p.y + 40 * S } : pet.randomPoint(150, 450);
        pet.x = spot.x; pet.gy = spot.y; pet.clamp();
        const c2 = center(pet);
        burst(pet, c2.x, c2.y, ['#c8c8d8', '#ffffff', '#9898a8'], { n: 14, speed: 40, spread: 6.3, g: -10, life: 0.7 });
      }
    },
    alpha: pet => { const k = pet.stateT / pet.dur; return k < 0.15 ? 1 : k < 0.6 ? 0 : Math.min(1, (k - 0.6) * 5); },
    intangible: pet => pet.stateT / pet.dur < 0.65,
    end: pet => { idle(pet); pet.showEmote('✦', 0.8); },
  },
  shuriken: {
    zh: '丟出水手裏劍', dur: 1.2,
    update(pet, dt, k) {
      const S = pet.S, m = pet.mouth();
      if (once(pet, 'throw', k > 0.3)) {
        pet.stage.fx.add({ img: art.star, x: m.x, y: m.y, vx: pet.facing * 320 * S, life: 1.1, fade: false });
        pet.stage.audio.sfx('throw');
      }
      if (k > 0.3 && k < 0.9 && Math.random() < dt * 30) {
        const x = m.x + pet.facing * (pet.stateT - 0.36) * 320 * S;
        burst(pet, x, m.y, ['#8ec5ff', '#ffffff'], { n: 1, speed: 10, g: 60, life: 0.3 });
      }
    },
    pose: (pet, p, k) => { p.rot = k < 0.3 ? -pet.facing * 0.15 : pet.facing * 0.12; },
  },

  // ---------- 掘掘兔系列 ----------
  alert: {
    zh: '聽到翅膀聲就馬上挖洞躲起來',
    // 桌面上有會飛的夥伴時特別敏感
    w: pet => ([...pet.stage.pets.values()].some(o => o !== pet && o.floats && has(o, 'flying')) ? 14 : 5),
    dur: 1,
    start: pet => pet.showEmote('!', 1),
    pose: (pet, p) => { p.sy = 1.08; },
    lift: () => 0,
    end: pet => { pet.target = pet.randomPoint(100, 300); pet.set('dig', 3); },
  },
  shed: {
    zh: '抖一抖，掉下保暖的毛', dur: 1.6,
    update(pet, dt) { const r = pet.rect(); if (Math.random() < dt * 12) burst(pet, r.x + Math.random() * r.w, r.y + r.h * 0.6, ['#f0e0c0', '#c8a878', '#ffffff'], { n: 1, speed: 15, g: 25, life: 1.6, wobble: true }); },
    pose: (pet, p) => { p.ox = Math.floor(pet.stateT * 26) % 2 ? 1 : -1; },
  },

  // ---------- 小箭雀系列 ----------
  peck: {
    zh: '低頭啄地面', dur: 2.2,
    update(pet) {
      const n = Math.floor(pet.stateT / 0.28);
      if (n !== pet.hd.n) { pet.hd.n = n; if (n % 2 === 0) burst(pet, pet.mouth().x + pet.facing * 3 * pet.S, pet.gy - pet.S, ['#8a7a4a', '#b8a06a'], { n: 2, speed: 25, spread: 2, g: 180, life: 0.3 }); }
    },
    pose: (pet, p) => { p.rot = pet.facing * (Math.floor(pet.stateT / 0.14) % 2 ? 0.35 : 0.1); },
    lift: () => 0,
  },
  heatup: {
    zh: '一興奮身體就發燙', dur: 1.6,
    start: pet => pet.showEmote('!', 0.8),
    update(pet, dt) { const r = pet.rect(); if (Math.random() < dt * 14) burst(pet, r.x + Math.random() * r.w, r.y + r.h * 0.5, ['#ff9d3a', '#ffd84a', '#ff6a2a'], { n: 1, speed: 18, g: -40, life: 0.7, wobble: true }); },
    lift: pet => Math.round(Math.abs(Math.sin(pet.stateT * 10)) * 2),
  },
  shoo: {
    zh: '把靠近地盤的傢伙趕走', social: true,
    pick: (pet, others) => { const near = others.filter(o => dist(pet, o) < 350); return near.length ? pick(near) : null; },
    begin(pet, o) {
      pet.partner = o; o.partner = pet;
      pet.set('chase', 2.5); o.set('flee', 2.5);
      pet.showEmote('💢', 1); o.showEmote('!', 0.8);
    },
  },
  dive: {
    zh: '從高空高速俯衝', dur: 1.8,
    start: pet => { pet.target = pet.randomPoint(250, 600); },
    update(pet, dt, k) {
      const S = pet.S;
      pet.z = Math.min(maxZ(pet), k < 0.35 ? (k / 0.35) * 70 : Math.max(0, 70 * (1 - (k - 0.35) / 0.65)));
      if (k > 0.35) {
        pet.moveTo(pet.target.x, pet.target.y, RUN_SPEED * S * 3, dt);
        if (Math.random() < dt * 40) { const c = center(pet); burst(pet, c.x - pet.facing * 6 * S, c.y, ['#ff6a2a', '#ffb13a'], { n: 1, speed: 10, g: -10, life: 0.4 }); }
      }
      if (once(pet, 'hit', k > 0.97)) { pet.stage.fx.stars(pet.x, pet.gy - 4 * S, S, 6); pet.stage.audio.sfx('land'); }
    },
    pose: (pet, p, k) => { p.rot = k < 0.35 ? -pet.facing * 0.2 : pet.facing * 0.35; },
    lift: () => 0,
    end: pet => { pet.z = 0; idle(pet); },
  },

  // ---------- 粉蝶蟲系列 ----------
  powder: {
    zh: '噴出保護自己的粉末', dur: 1.5,
    update(pet, dt) { const c = center(pet); if (Math.random() < dt * 20) burst(pet, c.x, c.y, ['#d8d0c0', '#b8b0a0', '#fff8e8'], { n: 1, speed: 30, spread: 6.3, g: 10, life: 0.9, wobble: true }); },
    pose: (pet, p) => { p.sy = 0.94 + Math.sin(pet.stateT * 14) * 0.03; },
  },
  harden: {
    zh: '變得硬梆梆一動也不動', dur: 3,
    update(pet, dt) { const r = pet.rect(); if (Math.random() < dt * 3) pet.stage.fx.sparkles(r.x + Math.random() * r.w, r.y + Math.random() * r.h, pet.S, 1, 2); },
    lift: () => 0,
  },
  scales: {
    zh: '灑下色彩繽紛的鱗粉', dur: 3.2,
    start: pet => { pet.target = pet.randomPoint(80, 250); },
    update(pet, dt) {
      pet.moveTo(pet.target.x, pet.target.y, WALK_SPEED * pet.S * 1.2, dt);
      const r = pet.rect();
      if (Math.random() < dt * 18) burst(pet, r.x + Math.random() * r.w, r.y + r.h * 0.5, ['#ff5d8f', '#ffd84a', '#7ab8ff', '#9be15d', '#c070ff'], { n: 1, speed: 8, dir: Math.PI / 2, g: 30, life: 1.4, wobble: true });
    },
  },

  // ---------- 小獅獅系列 ----------
  inspect: {
    zh: '好奇地跑去看看別的東西',
    w: pet => (pet.stage.pets.size > 1 || pet.stage.props.length ? 8 : 0),
    dur: 0.01,
    start(pet) {
      const st = pet.stage, S = pet.S;
      const things = [...[...st.pets.values()].filter(o => o !== pet && !o.leaving).map(o => ({ x: o.x, y: o.gy })), ...st.props.map(p => ({ x: p.x, y: p.y }))];
      if (!things.length) return;
      const t = pick(things);
      pet.showEmote('?', 1.2);
      walkThen(pet, t.x + (pet.x < t.x ? -1 : 1) * (pet.asset.w / 2 + 14) * S, t.y, 'sniffat');
    },
  },
  sniffat: {
    zh: '湊過去聞一聞', dur: 1.8,
    update(pet, dt, k) { if (once(pet, 'e', k > 0.5)) pet.showEmote(Math.random() < 0.6 ? '♪' : '?', 1); },
    pose: (pet, p) => { p.rot = pet.facing * 0.14 + Math.sin(pet.stateT * 12) * 0.03; },
    lift: () => 0,
  },
  mane: {
    zh: '鬃毛變得熱呼呼', dur: 1.4,
    start: pet => pet.showEmote('💢', 1),
    update(pet, dt) { const h = pet.head(); if (Math.random() < dt * 20) burst(pet, h.x + rnd(-8, 8) * pet.S, h.y + 4 * pet.S, ['#ff6a2a', '#ffb13a'], { n: 1, speed: 20, g: -50, life: 0.5 }); },
  },
  roar: {
    zh: '大聲吼叫，大家都嚇一跳', dur: 1.4,
    update(pet, dt, k) {
      if (once(pet, 'roar', k > 0.25)) {
        const m = pet.mouth();
        pet.stage.fx.ring(m.x, m.y, pet.S, '#ff9d3a', 70);
        pet.stage.fx.ring(m.x, m.y, pet.S, '#ffe066', 45);
        pet.stage.audio.sfx('appear');
        for (const o of around(pet, 300)) startle(o);
      }
    },
    pose: (pet, p, k) => { if (k > 0.2 && k < 0.7) { p.sx = 1.06; p.sy = 1.06; p.rot = -pet.facing * 0.08; } },
  },

  // ---------- 花蓓蓓系列：花粉、照顧花、庭園 ----------
  pollen: {
    zh: '收集花粉', dur: 3,
    update(pet, dt) {
      if (Math.random() > dt * 10) return;
      const c = center(pet), S = pet.S, a = Math.random() * Math.PI * 2, r = 26 * S, v = 30 * S;
      pet.stage.fx.add({ rect: '#ffe066', size: S / 2, x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, vx: -Math.cos(a) * v, vy: -Math.sin(a) * v, life: r / v });
    },
    end: pet => { idle(pet); pet.showEmote('♪', 1); },
  },
  tend: {
    zh: '種花、照顧花', dur: 2.4,
    update(pet, dt, k) {
      if (once(pet, 'plant', k > 0.35)) {
        const x = pet.x + pet.facing * (pet.asset.w / 2 + 3) * pet.S, y = pet.gy;
        pet.stage.addDecal(pick(art.flowers), x, y, 60);
        pet.stage.fx.sparkles(x, y - 3 * pet.S, pet.S, 4, 8);
      }
    },
    pose: (pet, p) => { p.rot = pet.facing * 0.14; },
    lift: () => 0,
    end: pet => { idle(pet); pet.showEmote('♥', 1); },
  },
  garden: {
    zh: '在身邊種出一圈花', dur: 3,
    update(pet, dt, k) {
      const n = Math.floor(k * 6);
      if (n > (pet.hd.n ?? -1) && n < 6) {
        pet.hd.n = n;
        const a = (n / 6) * Math.PI * 2, S = pet.S, r = (pet.asset.w / 2 + 10) * S;
        const x = pet.x + Math.cos(a) * r, y = pet.gy + Math.sin(a) * r * 0.4;
        pet.stage.addDecal(pick(art.flowers), x, y, 90);
        pet.stage.fx.sparkles(x, y - 3 * S, S, 2, 6);
      }
    },
    end: pet => { idle(pet); pet.showEmote('♥', 1); },
  },
  graze: {
    zh: '低頭吃草', dur: 0.01,
    start: pet => { pet.target = pet.randomPoint(15, 40); pet.set('forage', rnd(3, 5)); },
  },

  // ---------- 頑皮熊貓系列 ----------
  glare: {
    zh: '努力瞪人，但忍不住笑出來', dur: 3,
    start: pet => pet.showEmote('💢', 1.4),
    update(pet, dt, k) {
      const p = pet.stage.pointer;
      if (p.known) pet.facing = p.x > pet.x ? 1 : -1;
      if (once(pet, 'smile', k > 0.7)) pet.showEmote('♪', 1.2);
    },
    pose: (pet, p, k) => { if (k < 0.7) { p.sy = 0.95; p.sx = 1.03; } },
    lift: (pet, k) => (k > 0.7 ? Math.round(Math.abs(Math.sin((k - 0.7) * 20)) * 3) : 0),
  },
  leafsense: {
    zh: '咬著葉子感覺四周的動靜', dur: 3.5,
    update(pet) { pet.facing = Math.floor(pet.stateT / 1.1) % 2 ? 1 : -1; },
    drawOver: (pet, ctx) => holdAtMouth(pet, ctx, art.leaf, { dy: -1 }),
    lift: () => 0,
  },

  // ---------- 多麗米亞 ----------
  groom: {
    zh: '整理毛，游標靠近時撒嬌', dur: 2,
    update(pet, dt, k) {
      const r = pet.rect(), p = pet.stage.pointer;
      if (Math.random() < dt * 10) burst(pet, r.x + Math.random() * r.w, r.y + r.h * 0.5, ['#ffffff', '#f0f0f0'], { n: 1, speed: 12, g: 20, life: 1.2, wobble: true });
      if (once(pet, 'love', k > 0.5 && p.known && Math.hypot(p.x - pet.x, p.y - pet.y) < 250 * pet.S)) { pet.facing = p.x > pet.x ? 1 : -1; pet.showEmote('♥', 1.2); }
    },
    pose: (pet, p) => { p.ox = Math.floor(pet.stateT * 20) % 2 ? 1 : 0; },
  },

  // ---------- 妙喵系列：控制不了的超能力、保護夥伴 ----------
  psyburst: {
    zh: '超能力不小心爆發，把旁邊的夥伴彈開', dur: 1.8,
    start: pet => pet.showEmote('!', 0.6),
    update(pet, dt, k) {
      if (!once(pet, 'burst', k > 0.35)) return;
      const c = center(pet), S = pet.S;
      pet.stage.fx.ring(c.x, c.y, S, T.psychic, 90);
      pet.stage.fx.ring(c.x, c.y, S, '#ffffff', 60);
      pet.stage.audio.sfx('flash');
      for (const o of around(pet, 200, { free: false })) {
        if (o.state === 'habit' || o.partner) continue;
        const dx = o.x - pet.x, dy = o.gy - pet.gy, d = Math.hypot(dx, dy) || 1;
        o.vx = (dx / d) * 500 * S; o.vy = (dy / d) * 300 * S;
        if (!o.floats) { o.z = Math.max(o.z, 1); o.vz = 120; }
        o.set('fall');
        o.showEmote('!', 0.8);
      }
    },
    pose: (pet, p, k) => { if (k < 0.35) { p.sy = 1 + k * 0.3; } },
    end: pet => { idle(pet); pet.showEmote('…', 1.4); },
  },
  protect: {
    zh: '用超能力保護感情好的夥伴', social: true,
    pick: (pet, others) => {
      const g = pet.stage.game;
      return [...others].sort((a, b) => (g?.bondOf(pet.uid, b.uid) ?? 0) - (g?.bondOf(pet.uid, a.uid) ?? 0))[0];
    },
    begin(pet, o) {
      meet(pet, o, { gap: 4, then: (a, b) => { a.partner = b; b.partner = a; startHabit(a, 'barrier'); b.set('wait', 2.4); } });
    },
  },
  barrier: {
    zh: '張開保護罩', dur: 2.2,
    update(pet, dt, k) {
      const o = pet.partner;
      if (!o) return;
      const n = Math.floor(pet.stateT / 0.55);
      if (n !== pet.hd.n) { pet.hd.n = n; const c = center(o); pet.stage.fx.ring(c.x, c.y, pet.S, n % 2 ? '#7ab8ff' : T.psychic, (o.asset.w / 2 + 8)); }
      pet.facing = o.x > pet.x ? 1 : -1;
    },
    end(pet) {
      const o = pet.partner;
      pet.partner = null;
      if (o) { if (o.partner === pet) o.partner = null; o.set('happy', 0.6); o.showEmote('♥', 1.2); bond(pet, o, 3); }
      pet.set('happy', 0.6);
    },
  },

  // ---------- 獨劍鞘系列 ----------
  sway: {
    zh: '劍身輕輕搖晃', dur: 3,
    pose: (pet, p) => { p.rot = Math.sin(pet.stateT * 2.5) * 0.28; p.pivot = 'center'; },
  },
  drain: {
    zh: '偷偷吸一點夥伴的精氣（對方會想睡）', social: true,
    pick: (pet, others) => pick(others),
    begin(pet, o) {
      meet(pet, o, { gap: 18, then: (a, b) => { a.partner = b; b.partner = a; startHabit(a, 'drainOn'); b.set('wait', 2.2); } });
    },
  },
  drainOn: {
    zh: '吸取精氣', dur: 2,
    update(pet, dt) { const o = pet.partner; if (o) stream(pet, center(o), center(pet), ['#7ab8ff', '#b8d8ff'], { dt, rate: 25, speed: 80 }); },
    end(pet) {
      const o = pet.partner;
      pet.partner = null;
      pet.set('happy', 0.6);
      if (o) { if (o.partner === pet) o.partner = null; o.set('nap', rnd(4, 7)); o.showEmote('…', 1.2); bond(pet, o, 1); }
    },
  },
  swordplay: {
    zh: '兩把劍輪流快速揮舞', dur: 1.8,
    update(pet, dt) { const c = center(pet); if (Math.random() < dt * 20) burst(pet, c.x + pet.facing * 10 * pet.S, c.y + rnd(-10, 10) * pet.S, ['#ffffff', '#d8e8ff'], { n: 2, speed: 60, spread: 0.6, dir: pet.facing > 0 ? 0 : Math.PI, g: 0, life: 0.15 }); },
    pose: (pet, p) => { p.rot = (Math.floor(pet.stateT / 0.15) % 2 ? 1 : -1) * 0.35; p.pivot = 'center'; },
  },
  stance: {
    zh: '切換盾牌與劍的架勢', dur: 1.3,
    update(pet, dt, k) { if (once(pet, 'flash', k > 0.45)) { const c = center(pet); pet.stage.fx.sparkles(c.x, c.y, pet.S, 8, 20); pet.stage.audio.sfx('click'); } },
    pose: (pet, p, k) => { const s = Math.sin(k * Math.PI); p.sx = 1 - s * 0.25; p.sy = 1 + s * 0.12; },
    drawOver(pet, ctx) {
      const a = Math.sin(Math.min(1, pet.stateT / pet.dur) * Math.PI);
      if (a > 0.3) { const r = pet.rect(); blit(ctx, pet.asset.white, r.x, r.y, pet.S, { flipX: pet.facing > 0, alpha: (a - 0.3) * 0.9 }); }
    },
  },

  // ---------- 粉香香系列：香味 ----------
  perfume: {
    zh: '散發香氣，把夥伴吸引過來', dur: 3,
    update(pet, dt, k) {
      const c = center(pet);
      if (Math.random() < dt * 10) burst(pet, c.x + rnd(-8, 8) * pet.S, c.y, ['#ffb0d0', '#ffd6ea', '#e08ab8'], { n: 1, speed: 15, g: -15, life: 1.6, wobble: true });
      if (once(pet, 'lure', k > 0.3)) {
        const fans = around(pet, 450);
        if (fans.length) {
          const o = pick(fans);
          o.showEmote('♥', 1.2);
          meet(o, pet, { gap: 3, wait: false, then: (a, b) => { a.partner = null; a.set('happy', 0.6); a.showEmote('♥', 1.2); bond(a, b, 1); } });
        }
      }
    },
  },
  aroma: {
    zh: '用芳香讓身邊的夥伴放鬆', dur: 2.6,
    update(pet, dt, k) {
      const c = center(pet);
      if (Math.random() < dt * 12) burst(pet, c.x + rnd(-10, 10) * pet.S, c.y, ['#ffb0d0', '#ffffff', '#e08ab8'], { n: 1, speed: 25, spread: 6.3, g: -10, life: 1.4, wobble: true });
      if (once(pet, 'calm', k > 0.5)) for (const o of around(pet, 260)) { o.set('happy', 0.6); pet.stage.fx.hearts(o.head().x, o.head().y, pet.S, 1); bond(pet, o, 1); }
    },
  },
  string: {
    zh: '吐出黏答答的絲黏住夥伴', social: true,
    pick: (pet, others) => pick(others),
    begin(pet, o) {
      meet(pet, o, { gap: 26, then: (a, b) => { a.partner = b; b.partner = a; startHabit(a, 'spin'); b.set('wait', 1); } });
    },
  },
  spin: {
    zh: '吐絲', dur: 1.2,
    update(pet, dt, k) {
      const o = pet.partner;
      if (!o) return;
      if (k < 0.6) stream(pet, pet.mouth(), center(o), ['#ffffff', '#f0e8f0'], { dt, rate: 40, speed: 200 });
      if (once(pet, 'hit', k > 0.6)) { o.partner = null; startHabit(o, 'stuck'); }
    },
    end: pet => { pet.partner = null; pet.set('happy', 0.6); pet.showEmote('♪', 1); },
  },
  stuck: {
    zh: '被黏住了', dur: 2,
    start: pet => pet.showEmote('…', 1.6),
    update(pet, dt) { const r = pet.rect(); if (Math.random() < dt * 6) burst(pet, r.x + Math.random() * r.w, r.y + Math.random() * r.h, ['#ffffff'], { n: 1, speed: 4, g: 0, life: 0.6 }); },
    pose: (pet, p) => { p.ox = Math.floor(pet.stateT * 14) % 2 ? 1 : -1; p.sx = 0.96; },
    lift: () => 0,
    end: pet => { idle(pet); pet.showEmote('💢', 1); },
  },
  bounce: {
    zh: '軟綿綿地彈跳', dur: 1.8,
    lift: pet => Math.round(Math.abs(Math.sin(pet.stateT * Math.PI / 0.45)) * 8),
    pose(pet, p) { const u = Math.abs(Math.sin(pet.stateT * Math.PI / 0.45)); p.sx = 1.15 - u * 0.2; p.sy = 0.85 + u * 0.2; },
  },
  sweettooth: {
    zh: '聞到甜甜的誘餌就跑過去',
    w: pet => (pet.stage.env.lure ? 16 : 0),
    dur: 0.01,
    start(pet) {
      const l = pet.stage.env.lure;
      if (!l) return;
      pet.showEmote('!', 0.8);
      pet.target = { x: l.x + (pet.x < l.x ? -1 : 1) * (pet.asset.w / 2 + 6) * pet.S, y: l.y };
      pet.set('run', 5);
      pet.onArrive = () => { pet.set('sniff', 2.4); };
    },
  },

  // ---------- 好啦魷系列：閃光、催眠 ----------
  flash: {
    zh: '閃爍發光體讓對方頭暈，趁機溜走', dur: 1.4,
    update(pet, dt, k) {
      const r = pet.rect();
      if (Math.floor(pet.stateT * 10) % 2 && Math.random() < dt * 40) burst(pet, r.x + Math.random() * r.w, r.y + Math.random() * r.h, ['#ffffff', '#8ae8ff', '#ffe066'], { n: 1, speed: 5, g: 0, life: 0.12 });
      if (once(pet, 'daze', k > 0.6)) for (const o of around(pet, 220)) { o.set('dizzy', 1.2); o.showEmote('@', 1.2); }
    },
    drawOver(pet, ctx) {
      if (Math.floor(pet.stateT * 10) % 2) { const r = pet.rect(); blit(ctx, pet.asset.white, r.x, r.y, pet.S, { flipX: pet.facing > 0, alpha: 0.45 }); }
    },
    end: pet => { pet.target = pet.randomPoint(200, 400); pet.set('run', 1.5); },
  },
  hypno: {
    zh: '用光芒催眠夥伴，讓牠慢慢走過來', social: true,
    pick: (pet, others) => { const near = others.filter(o => dist(pet, o) < 500); return near.length ? pick(near) : null; },
    begin(pet, o) {
      pet.partner = o; o.partner = pet;
      pet.facing = o.x > pet.x ? 1 : -1;
      startHabit(pet, 'hypnotize');
      startHabit(o, 'drawn', { to: pet });
    },
  },
  hypnotize: {
    zh: '催眠', dur: 4,
    update(pet) {
      const n = Math.floor(pet.stateT / 0.6);
      if (n !== pet.hd.n) { pet.hd.n = n; const c = center(pet); pet.stage.fx.ring(c.x, c.y, pet.S, has(pet, 'ghost') ? '#ff9d3a' : T.psychic, 40); }
    },
    end: pet => { pet.partner = null; pet.set('happy', 0.6); pet.showEmote('♪', 1); },
  },
  drawn: {
    zh: '被催眠了', dur: 3.8,
    start: pet => pet.showEmote('…', 2),
    update(pet, dt) {
      const to = pet.hd.to;
      if (!to || to.leaving) return;
      const gap = ((to.asset.w + pet.asset.w) / 2 + 4) * pet.S;
      pet.moveTo(to.x + (pet.x < to.x ? -gap : gap), to.gy, WALK_SPEED * pet.S * 0.4, dt);
    },
    pose: (pet, p) => { p.rot = Math.sin(pet.stateT * 3) * 0.08; },
    lift: pet => Math.round(Math.abs(Math.sin(pet.walkPhase)) * 1),
    end: pet => { if (pet.hd.to?.partner === pet) pet.hd.to.partner = null; pet.partner = null; startle(pet); bond(pet, pet.hd.to, 1); },
  },

  // ---------- 龜腳腳系列 ----------
  bicker: {
    zh: '兩個頭步調不一致，吵起來', dur: 2,
    start: pet => pet.showEmote('💢', 1.2),
    pose: (pet, p) => { const s = Math.floor(pet.stateT / 0.2) % 2 ? 1 : -1; p.ox = s * 2; p.rot = s * 0.06; },
    end: pet => { idle(pet); pet.showEmote('♪', 1); },
  },
  lookout: {
    zh: '用手上的眼睛觀察四面八方', dur: 2.4,
    update(pet) { pet.facing = Math.floor(pet.stateT / 0.3) % 2 ? 1 : -1; },
    start: pet => pet.showEmote('!', 0.8),
    pose: (pet, p) => { p.sy = 1.04; },
  },

  // ---------- 垃垃藻系列 ----------
  camo: {
    zh: '假裝成海藻不讓人發現', dur: 4,
    pose: (pet, p) => { p.rot = Math.sin(pet.stateT * 2) * 0.1; },
    alpha: () => 0.6,
    drawOver(pet, ctx) { const r = pet.rect(); blit(ctx, pet.asset.dark, r.x, r.y, pet.S, { flipX: pet.facing > 0, alpha: 0.2 }); },
    lift: () => 0,
  },
  sunhat: {
    zh: '讓頭頂曬太陽，製造龍之能量',
    w: pet => (isDay(pet.stage.env) ? 8 : 1),
    dur: 5,
    update(pet, dt) { const h = pet.head(); if (Math.random() < dt * 5) burst(pet, h.x + rnd(-6, 6) * pet.S, h.y + 4 * pet.S, [T.dragon, '#c070d0', '#ffe066'], { n: 1, speed: 10, g: -8, life: 1.4, wobble: true }); },
    pose: (pet, p) => { p.sy = 1.04; },
  },

  // ---------- 鐵臂槍蝦系列：水砲 ----------
  watershot: {
    zh: '從鉗子射出水彈', dur: 1.4,
    update(pet, dt, k) { waterShot(pet, k, { range: 240, size: 1, ring: false }); },
    pose: (pet, p, k) => { p.ox = k > 0.28 && k < 0.45 ? -pet.facing * 3 : 0; },
  },
  cannon: {
    zh: '發射威力超強的海水砲彈', dur: 1.6,
    update(pet, dt, k) { waterShot(pet, k, { range: 400, size: 2, ring: true }); },
    pose: (pet, p, k) => { p.ox = k > 0.25 && k < 0.45 ? -pet.facing * 5 : 0; p.rot = k > 0.25 && k < 0.45 ? -pet.facing * 0.1 : 0; },
  },

  // ---------- 傘電蜥系列 ----------
  solar: {
    zh: '曬太陽發電',
    w: pet => (isDay(pet.stage.env) ? 12 : 2),
    dur: () => rnd(4, 6),
    update(pet, dt, k) {
      const r = pet.rect();
      if (Math.random() < dt * (2 + k * 20)) burst(pet, r.x + Math.random() * r.w, r.y + Math.random() * r.h * 0.5, ['#fff27a', '#ffd84a', '#ffffff'], { n: 2, speed: 40, spread: 6.3, g: 0, life: 0.25 });
    },
    pose: (pet, p) => { p.sx = pet.mon.species === 695 ? 1.1 : 1.04; p.sy = 0.95; },
    lift: () => 0,
    end: pet => { idle(pet); pet.showEmote('✦', 1); },
  },

  // ---------- 寶寶暴龍系列 ----------
  tantrum: {
    zh: '任性地跺腳撒嬌', dur: 2,
    start: pet => pet.showEmote('💢', 1.2),
    update(pet) {
      const n = Math.floor(pet.stateT / 0.3);
      if (n !== pet.hd.n) { pet.hd.n = n; burst(pet, pet.x, pet.gy - pet.S, ['#9a6a3a', '#c8955a'], { n: 3, speed: 40, spread: 2, g: 200, life: 0.4 }); }
    },
    lift: pet => Math.round(Math.abs(Math.sin(pet.stateT * Math.PI / 0.3)) * 4),
    end(pet) {
      const p = pet.stage.pointer;
      if (p.known) pet.facing = p.x > pet.x ? 1 : -1;
      idle(pet);
      pet.showEmote('♥', 1.2);
    },
  },
  chomp: {
    zh: '鬧著玩地咬夥伴一口', social: true,
    pick: (pet, others) => pick(others),
    begin(pet, o) { meet(pet, o, { gap: 1, then: (a, b) => { a.partner = b; b.partner = a; startHabit(a, 'bite'); b.set('wait', 1); } }); },
  },
  bite: {
    zh: '咬', dur: 0.9,
    update(pet, dt, k) {
      const o = pet.partner;
      if (o && once(pet, 'hit', k > 0.45)) {
        const c = center(o);
        pet.stage.fx.stars(c.x, c.y, pet.S, 4);
        pet.stage.audio.sfx('land');
        o.partner = null;
        startle(o);
        bond(pet, o, 1);
      }
    },
    pose: (pet, p, k) => { p.ox = pet.facing * Math.round(Math.sin(k * Math.PI) * 6); },
    end: pet => { pet.partner = null; pet.set('happy', 0.6); pet.showEmote('♪', 1); },
  },
  stomp: {
    zh: '重重地踏地，地面都在震動', dur: 1.3,
    update(pet, dt, k) {
      if (once(pet, 'hit', k > 0.55)) {
        const S = pet.S;
        pet.stage.fx.ring(pet.x, pet.gy, S, '#c8955a', 70);
        burst(pet, pet.x, pet.gy - S, ['#9a6a3a', '#c8955a', '#6e4a28'], { n: 14, speed: 70, spread: 2.5, g: 200, life: 0.6 });
        pet.stage.audio.sfx('land');
        pet.squashT = 0.18;
        for (const o of around(pet, 320)) startle(o);
      }
    },
    lift: (pet, k) => (k < 0.55 ? Math.round(Math.sin((k / 0.55) * Math.PI / 2) * 8) : 0),
  },

  // ---------- 冰雪龍系列 ----------
  aurora: {
    zh: '帆上閃著極光',
    w: pet => (isNight(pet.stage.env) ? 12 : 5),
    dur: 3.2,
    update(pet, dt) {
      const h = pet.head();
      if (Math.random() < dt * 14) burst(pet, h.x + rnd(-14, 14) * pet.S, h.y + rnd(0, 12) * pet.S, ['#7affc8', '#7ab8ff', '#c070ff', '#ff9ec7', '#ffe066'], { n: 1, speed: 8, g: -10, life: 1.4, wobble: true });
    },
    pose: (pet, p) => { p.sy = 1.03; },
  },
  diamonddust: {
    zh: '噴出冰氣，四周飄起鑽石塵', dur: 2.2,
    update(pet, dt) {
      const S = pet.S;
      if (Math.random() < dt * 30) burst(pet, pet.x + rnd(-80, 80) * S, pet.gy - rnd(20, 90) * S, ['#ffffff', '#d8f4ff', '#bfe8ff'], { n: 1, speed: 10, dir: Math.PI / 2, g: 20, life: 1.6, wobble: true });
      if (Math.random() < dt * 3) pet.stage.fx.sparkles(pet.x + rnd(-60, 60) * S, pet.gy - rnd(10, 60) * S, S, 1, 2);
    },
  },

  // ---------- 仙子伊布 ----------
  ribbon: {
    zh: '用緞帶安撫不開心或頭暈的夥伴', social: true,
    pick: (pet, others) => {
      const all = [...pet.stage.pets.values()].filter(o => o !== pet && !o.leaving && !o.partner);
      const upset = all.filter(o => ['dizzy', 'shiver', 'startle', 'refuse', 'trip'].includes(o.state));
      return upset.length ? pick(upset) : others.length ? pick(others) : null;
    },
    begin(pet, o) {
      meet(pet, o, { gap: 12, wait: true, then: (a, b) => { a.partner = b; b.partner = a; startHabit(a, 'soothe'); b.set('wait', 2); } });
    },
  },
  soothe: {
    zh: '緞帶', dur: 1.8,
    update(pet, dt, k) {
      const o = pet.partner;
      if (!o) return;
      stream(pet, pet.head(), center(o), ['#ffb0d0', '#7ab8ff', '#ffffff'], { dt, rate: 30, speed: 90 });
      if (once(pet, 'calm', k > 0.6)) { pet.stage.fx.hearts(o.head().x, o.head().y, pet.S, 3); }
    },
    end(pet) {
      const o = pet.partner;
      pet.partner = null;
      pet.set('happy', 0.6);
      if (o) { if (o.partner === pet) o.partner = null; o.set('happy', 0.6); o.showEmote('♥', 1.2); bond(pet, o, 2); }
    },
  },

  // ---------- 摔角鷹人 ----------
  flashypose: {
    zh: '出招前擺出華麗的姿勢（有時會被打斷）', dur: 2,
    update(pet, dt, k) { if (once(pet, 'shine', k > 0.4)) { const c = center(pet); pet.stage.fx.sparkles(c.x, c.y, pet.S, 10, 24); pet.stage.audio.sfx('sparkle'); pet.showEmote('✦', 1); } },
    pose: (pet, p, k) => { if (k > 0.3) { p.sy = 1.12; p.sx = 0.96; p.rot = -pet.facing * 0.12; } },
    lift: (pet, k) => (k > 0.3 ? 2 : 0),
    end(pet) {
      if (Math.random() < 0.25) { pet.set('trip', 1.3); pet.showEmote('@', 1.3); pet.stage.audio.sfx('land'); }
      else idle(pet);
    },
  },

  // ---------- 咚咚鼠 ----------
  leech: {
    zh: '從電屬性的夥伴那裡偷電', social: true,
    pick: (pet, others) => { const e = others.filter(o => has(o, 'electric')); return e.length ? pick(e) : null; },
    begin(pet, o) { meet(pet, o, { gap: 14, then: (a, b) => { a.partner = b; b.partner = a; startHabit(a, 'charge'); b.set('wait', 2.2); } }); },
  },
  charge: {
    zh: '偷電', dur: 2,
    update(pet, dt) { const o = pet.partner; if (o) stream(pet, center(o), center(pet), ['#fff27a', '#ffd84a', '#ffffff'], { dt, rate: 40, speed: 120 }); },
    end(pet) {
      const o = pet.partner;
      pet.partner = null;
      pet.set('happy', 0.6); pet.showEmote('♪', 1);
      if (o) { if (o.partner === pet) o.partner = null; o.showEmote('…', 1.2); o.set('idle', 2); bond(pet, o, 1); }
    },
  },
  outlet: {
    zh: '電腦剛接上電源時跑去充電',
    w: pet => (pet.stage.env.plugged ? 16 : 0),
    dur: 2.5,
    update(pet, dt) { const r = pet.rect(); if (Math.random() < dt * 20) burst(pet, r.x + Math.random() * r.w, r.y + Math.random() * r.h, ['#fff27a', '#ffffff'], { n: 1, speed: 30, spread: 6.3, g: 0, life: 0.2 }); },
    end: pet => { pet.set('happy', 0.6); pet.showEmote('♪', 1); },
  },

  // ---------- 小碎鑽 ----------
  gemnap: {
    zh: '像在礦床裡一樣靜靜地沉睡', dur: () => rnd(12, 20),
    update(pet, dt) {
      if (Math.floor(pet.t) % 3 === 0 && !pet.emote) pet.showEmote('Z', 1.2);
      const r = pet.rect();
      if (Math.random() < dt * 1.5) pet.stage.fx.sparkles(r.x + Math.random() * r.w, r.y + Math.random() * r.h, pet.S, 1, 2);
    },
  },

  // ---------- 黏黏寶系列 ----------
  hide: {
    zh: '一感覺到有東西靠近就縮起來',
    w(pet) {
      const p = pet.stage.pointer;
      const threat = (p.known && Math.hypot(p.x - pet.x, p.y - pet.y) < 180 * pet.S) || around(pet, 120, { free: false }).length;
      return threat ? 18 : 3;
    },
    dur: 3,
    start(pet) {
      const p = pet.stage.pointer;
      if (p.known) pet.facing = p.x > pet.x ? -1 : 1; // 轉過去背對
      pet.showEmote('…', 1.4);
    },
    pose: (pet, p) => { p.sy = 0.74; p.sx = 1.1; },
    lift: () => 0,
  },
  hug: {
    zh: '緊緊抱住感情好的夥伴（黏答答的）', social: true,
    pick: (pet, others) => {
      const g = pet.stage.game;
      return [...others].sort((a, b) => (g?.bondOf(pet.uid, b.uid) ?? 0) - (g?.bondOf(pet.uid, a.uid) ?? 0))[0];
    },
    begin(pet, o) { meet(pet, o, { gap: -6, then: (a, b) => { a.partner = b; b.partner = a; startHabit(a, 'hugging'); b.set('wait', 2.4); } }); },
  },
  hugging: {
    zh: '抱抱', dur: 2.2,
    update(pet, dt) {
      const o = pet.partner;
      if (o && Math.random() < dt * 3) pet.stage.fx.hearts((pet.x + o.x) / 2, Math.min(pet.head().y, o.head().y), pet.S, 1);
      if (Math.random() < dt * 5) pet.stage.fx.add({ rect: '#b58ad8', size: pet.S / 2, x: pet.x + rnd(-8, 8) * pet.S, y: pet.gy - pet.S, life: 4 });
    },
    pose: (pet, p) => { const s = Math.sin(pet.stateT * 5); p.sx = 1.04 + s * 0.03; p.sy = 0.97 - s * 0.03; },
    end(pet) {
      const o = pet.partner;
      pet.partner = null;
      pet.set('happy', 0.6);
      if (o) { if (o.partner === pet) o.partner = null; o.set('happy', 0.6); o.showEmote('♥', 1.2); bond(pet, o, 3); }
    },
  },

  // ---------- 鑰圈兒 ----------
  jingle: {
    zh: '叮叮噹噹地搖鑰匙', dur: 1.6,
    update(pet, dt) {
      const n = Math.floor(pet.stateT / 0.35);
      if (n !== pet.hd.n) { pet.hd.n = n; pet.stage.audio.sfx('click'); const c = center(pet); pet.stage.fx.sparkles(c.x + rnd(-10, 10) * pet.S, c.y, pet.S, 1, 4); }
    },
    pose: (pet, p) => { p.rot = Math.sin(pet.stateT * 24) * 0.18; p.pivot = 'center'; },
  },
  keyhunt: {
    zh: '到處找亮晶晶的東西收集',
    w: pet => (pet.stage.props.length ? 10 : 4),
    dur: 0.01,
    start(pet) {
      const props = pet.stage.props;
      const t = props.length ? pick(props) : pet.randomPoint(100, 300);
      walkThen(pet, t.x + (pet.x < t.x ? -1 : 1) * 10 * pet.S, t.y, 'keyfound');
    },
  },
  keyfound: {
    zh: '找到了', dur: 1.6,
    update(pet, dt, k) { if (once(pet, 'find', k > 0.3)) { pet.showEmote('♥', 1.2); pet.stage.fx.add({ img: art.key, x: pet.x, y: pet.head().y - 4 * pet.S, vy: -20 * pet.S, life: 1.2 }); } },
    pose: (pet, p) => { p.rot = pet.facing * 0.14; },
  },

  // ---------- 小木靈系列 ----------
  callaway: {
    zh: '發出像小孩的聲音，把夥伴引走', social: true,
    pick: (pet, others) => { const near = others.filter(o => dist(pet, o) < 500); return near.length ? pick(near) : null; },
    begin(pet, o) {
      pet.showEmote('♪', 1.4);
      pet.target = pet.randomPoint(250, 500);
      pet.set('walk');
      o.partner = pet;
      startHabit(o, 'lured', { to: pet });
    },
  },
  lured: {
    zh: '被引走', dur: 6,
    start: pet => pet.showEmote('♪', 1),
    update(pet, dt) {
      const to = pet.hd.to;
      if (!to || to.leaving) return;
      const gap = ((to.asset.w + pet.asset.w) / 2 + 12) * pet.S;
      pet.moveTo(to.x - (to.facing || 1) * gap, to.gy, WALK_SPEED * pet.S * 1.1, dt);
    },
    lift: pet => Math.round(Math.abs(Math.sin(pet.walkPhase)) * 2),
    end(pet) { pet.partner = null; pet.set('look', 2); pet.showEmote('?', 1.6); }, // 迷路了
  },
  roots: {
    zh: '從腳底伸出根鬚連結四周', dur: 2.6,
    update(pet, dt) {
      if (Math.random() > dt * 18) return;
      const a = Math.random() * Math.PI * 2, v = 25 * pet.S;
      pet.stage.fx.add({ rect: Math.random() < 0.5 ? '#6e4a28' : '#4a9a3a', size: pet.S / 2, x: pet.x, y: pet.gy - pet.S, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.4, life: 2, fade: true });
    },
    pose: (pet, p) => { p.sy = 0.96; },
    lift: () => 0,
  },
  lantern: {
    zh: '南瓜的洞在夜裡發光',
    w: pet => (isNight(pet.stage.env) ? 12 : 3),
    dur: 4,
    update(pet) {
      const n = Math.floor(pet.stateT / 0.8);
      if (n !== pet.hd.n) { pet.hd.n = n; const c = center(pet); pet.stage.fx.ring(c.x, c.y, pet.S, '#ffb13a', 22); }
    },
    drawOver(pet, ctx) {
      const r = pet.rect(), a = 0.15 + Math.sin(pet.stateT * 4) * 0.1;
      blit(ctx, art.sparkle, r.x + r.w / 2 - 2 * pet.S, r.y + r.h * 0.45, pet.S, { alpha: a * 3 });
    },
  },
  knock: {
    zh: '晚上跑去「敲門」（選單按鈕）',
    w: pet => (isNight(pet.stage.env) ? 6 : 0),
    dur: 0.01,
    start(pet) {
      const st = pet.stage;
      walkThen(pet, st.W - 70 * pet.S, st.H - 6 * pet.S, 'knocking');
    },
  },
  knocking: {
    zh: '叩叩', dur: 1.6,
    update(pet) {
      pet.facing = 1;
      const n = Math.floor(pet.stateT / 0.35);
      if (n !== pet.hd.n && n < 3) { pet.hd.n = n; pet.stage.audio.sfx('click'); }
    },
    pose: (pet, p) => { p.rot = Math.floor(pet.stateT / 0.175) % 2 ? 0.12 : 0; },
    end: pet => { idle(pet); pet.showEmote('♪', 1); },
  },

  // ---------- 冰寶系列 ----------
  ride: {
    zh: '把腳凍在冰岩怪背上，一起移動',
    w: pet => ([...pet.stage.pets.values()].some(o => o.mon.species === 713 && !o.leaving) ? 14 : 0),
    dur: () => rnd(15, 25),
    start(pet) {
      // 冰寶找冰岩怪；其他情況（好朋友背著）由呼叫的人指定 hd.on
      const av = pet.hd.on ?? [...pet.stage.pets.values()].find(o => o.mon.species === 713 && !o.leaving);
      pet.hd.on = av;
      if (av) { pet.showEmote('♥', 1.2); pet.stage.fx.burst(pet.x, pet.gy, pet.S, ['#ffffff', '#d8f4ff'], { n: 6, speed: 30, spread: 6.3, g: 0, life: 0.5 }); }
    },
    update(pet) {
      const av = pet.hd.on;
      if (!av || av.leaving || av.state === 'held') { pet.z = 0; pet.set('fall'); return; }
      pet.x = av.x;
      pet.gy = av.gy + 1;
      pet.z = av.z + av.alt + av.asset.h * 0.55;
      pet.facing = av.facing;
    },
    lift: () => 0,
    end(pet) {
      // 輕輕跳到冰岩怪旁邊
      const av = pet.hd.on;
      pet.z = 0;
      if (av) pet.x = av.x + (av.asset.w / 2 + pet.asset.w / 2 + 2) * pet.S * (Math.random() < 0.5 ? -1 : 1);
      pet.clamp();
      pet.squashT = 0.18;
      pet.set('hop', 0.35);
    },
  },
  mend: {
    zh: '晚上坐著讓身上的裂縫長好',
    w: pet => (isNight(pet.stage.env) ? 12 : 2),
    dur: () => rnd(5, 8),
    update(pet, dt) { const r = pet.rect(); if (Math.random() < dt * 3) pet.stage.fx.sparkles(r.x + Math.random() * r.w, r.y + Math.random() * r.h, pet.S, 1, 2); },
    pose: (pet, p) => { p.sx = 1.05; p.sy = 0.94; },
    lift: () => 0,
    end: pet => { idle(pet); pet.showEmote('✦', 1); },
  },

  // ---------- 嗡蝠系列 ----------
  ultrasound: {
    zh: '發出超音波，大家都摀住耳朵',
    w: pet => (isNight(pet.stage.env) ? 12 : 5),
    dur: 2,
    update(pet, dt, k) {
      const n = Math.floor(pet.stateT / 0.35);
      const big = pet.mon.species === 715;
      if (n !== pet.hd.n) { pet.hd.n = n; const m = pet.mouth(); pet.stage.fx.ring(m.x, m.y, pet.S, n % 2 ? '#c070ff' : '#7ab8ff', big ? 70 : 45); }
      if (once(pet, 'cover', k > 0.4)) for (const o of around(pet, big ? 350 : 220)) { o.set('shiver', 1); o.showEmote('…', 1); }
    },
    pose: (pet, p) => { p.sy = 1.05; },
  },

  // ---------- 傳說與幻之寶可夢 ----------
  rainbow: {
    zh: '角閃耀出七種顏色，分享生命的能量', dur: 3,
    update(pet, dt, k) {
      const h = pet.head();
      if (Math.random() < dt * 20) burst(pet, h.x + rnd(-16, 16) * pet.S, h.y + rnd(0, 10) * pet.S, ['#ff5d5d', '#ffb13a', '#ffe066', '#7ae07a', '#7ab8ff', '#8a6aff', '#e070ff'], { n: 1, speed: 12, g: -10, life: 1.2, wobble: true });
      if (once(pet, 'share', k > 0.5)) for (const o of around(pet, 400, { free: false })) { pet.stage.fx.hearts(o.head().x, o.head().y, pet.S, 2); o.showEmote('♥', 1); }
    },
  },
  darkwings: {
    zh: '張開翅膀，四周暗了下來', dur: 2.5,
    update(pet, dt, k) {
      const c = center(pet);
      if (Math.random() < dt * 24) burst(pet, c.x + rnd(-30, 30) * pet.S, c.y + rnd(-10, 10) * pet.S, ['#3a1020', '#8a1a30', '#1a1a2a'], { n: 1, speed: 20, spread: 6.3, g: -5, life: 1.2, wobble: true });
      if (once(pet, 'shiver', k > 0.5)) for (const o of around(pet, 300)) { o.set('shiver', 0.8); o.showEmote('…', 1); }
    },
    pose: (pet, p) => { p.sx = 1.08; },
  },
  cells: {
    zh: '核心在身邊繞圈', dur: 3,
    update(pet) { orbit(pet, ['#3ad06a', '#a8ffc0', '#0e3a1a'], pet.asset.w * 0.7, 5, 4); },
  },
  diamonds: {
    zh: '壓縮空氣做出鑽石', dur: 2.2,
    update(pet, dt, k) {
      const n = Math.floor(k * 3);
      if (n > (pet.hd.n ?? -1) && n < 3) {
        pet.hd.n = n;
        const S = pet.S, x = pet.x + rnd(-30, 30) * S, y = pet.gy + rnd(-6, 10) * S;
        pet.stage.addDecal(art.diamond, x, y, 45);
        pet.stage.fx.sparkles(x, y - 3 * S, S, 4, 6);
        pet.stage.audio.sfx('sparkle');
      }
    },
    pose: (pet, p) => { p.sy = 1.04; },
  },
  portal: {
    zh: '鑽進圓環，從別的地方出來', dur: 1.8,
    update(pet, dt, k) {
      if (once(pet, 'jump', k > 0.45)) {
        const p = pet.randomPoint(200, 500);
        pet.x = p.x; pet.gy = p.y;
        pet.stage.audio.sfx('sparkle');
      }
    },
    alpha: pet => { const k = pet.stateT / pet.dur; return k < 0.2 ? 1 : k < 0.45 ? 1 - (k - 0.2) / 0.25 : k < 0.55 ? 0 : Math.min(1, (k - 0.55) / 0.25); },
    intangible: pet => { const k = pet.stateT / pet.dur; return k > 0.3 && k < 0.7; },
    drawOver(pet, ctx) {
      const k = pet.stateT / pet.dur, img = art.ring(pet.stateT), S = pet.S;
      const a = k < 0.1 ? k * 10 : k > 0.9 ? (1 - k) * 10 : 1;
      const c = center(pet);
      blit(ctx, img, c.x - (img.width * S) / 2, c.y - (img.height * S) / 2, S, { alpha: Math.max(0, Math.min(1, a)) * 0.9 });
    },
  },
  steam: {
    zh: '從背上的手臂噴出蒸氣', dur: 2,
    update(pet, dt, k) {
      const r = pet.rect();
      if (k > 0.2 && Math.random() < dt * 40) burst(pet, r.x + r.w * (pet.facing > 0 ? 0.3 : 0.7), r.y + 4 * pet.S, ['#ffffff', '#e0e8f0', '#c8d0d8'], { n: 1, speed: 70, dir: -Math.PI / 2 - pet.facing * 0.4, spread: 0.5, g: -30, life: 1.2, wobble: true });
      if (once(pet, 'boom', k > 0.2)) { pet.stage.fx.ring(r.x + r.w / 2, r.y, pet.S, '#ffffff', 50); pet.stage.audio.sfx('flee'); }
    },
    pose: (pet, p, k) => { if (k > 0.2) p.sy = 0.96; },
  },
};

// 水砲：射出去的水彈飛到盡頭後濺開
function waterShot(pet, k, { range, size, ring }) {
  const S = pet.S, m = pet.mouth();
  if (once(pet, 'fire', k > 0.28)) {
    pet.hd.from = { x: m.x, y: m.y };
    const b = pet.bounds();
    const toX = Math.max(b.x0, Math.min(b.x1, m.x + pet.facing * range * S));
    pet.hd.to = { x: toX, y: m.y };
    const v = 420 * S, life = Math.abs(toX - m.x) / v;
    pet.hd.flight = life;
    for (let i = 0; i < 5; i++) pet.stage.fx.add({ rect: i % 2 ? '#d8ecff' : '#5aa0f0', size: (S / 2) * size + (i === 0 ? S : 0), x: m.x - pet.facing * i * 3 * S, y: m.y, vx: pet.facing * v, life, fade: false });
    pet.stage.audio.sfx('throw');
  }
  if (pet.hd.from && once(pet, 'splash', pet.stateT > pet.dur * 0.28 + pet.hd.flight)) {
    const t = pet.hd.to;
    burst(pet, t.x, t.y, ['#8ec5ff', '#d8ecff', '#5aa0f0'], { n: 10 * size, speed: 60 * size, spread: 6.3, g: 200, life: 0.6 });
    if (ring) pet.stage.fx.ring(t.x, t.y, S, '#8ec5ff', 40);
    pet.stage.audio.sfx('rustle');
  }
}

// 每一種會做的習性（同一條進化線共用一部分）
export const HABITS_BY_SPECIES = {
  650: ['hunker', 'ram'], 651: ['ram', 'hunker'], 652: ['guard', 'ram'],
  653: ['twig', 'earpuff'], 654: ['signal', 'twig'], 655: ['vortex', 'signal'],
  656: ['frubbles'], 657: ['leap', 'frubbles'], 658: ['ninja', 'shuriken'],
  659: ['alert'], 660: ['shed', 'alert'],
  661: ['peck', 'heatup'], 662: ['shoo', 'peck'], 663: ['dive', 'shoo'],
  664: ['powder'], 665: ['harden', 'powder'], 666: ['scales'],
  667: ['inspect', 'mane'], 668: ['roar', 'inspect'],
  669: ['pollen'], 670: ['tend', 'pollen'], 671: ['garden', 'tend'],
  672: ['graze'], 673: ['ram', 'graze'],
  674: ['glare'], 675: ['leafsense', 'glare'],
  676: ['groom'],
  677: ['psyburst'], 678: ['protect', 'psyburst'],
  679: ['sway', 'drain'], 680: ['swordplay', 'sway'], 681: ['stance', 'swordplay'],
  682: ['perfume'], 683: ['aroma', 'perfume'],
  684: ['string', 'perfume'], 685: ['bounce', 'sweettooth'],
  686: ['flash'], 687: ['hypno', 'flash'],
  688: ['bicker'], 689: ['lookout', 'bicker'],
  690: ['camo'], 691: ['sunhat', 'camo'],
  692: ['watershot'], 693: ['cannon'],
  694: ['solar'], 695: ['solar'],
  696: ['tantrum', 'chomp'], 697: ['stomp', 'chomp'],
  698: ['aurora'], 699: ['aurora', 'diamonddust'],
  700: ['ribbon'],
  701: ['flashypose'],
  702: ['leech', 'outlet'],
  703: ['gemnap'],
  704: ['hide'], 705: ['hide', 'sweettooth'], 706: ['hug'],
  707: ['jingle', 'keyhunt'],
  708: ['callaway'], 709: ['roots', 'callaway'],
  710: ['lantern', 'hypno'], 711: ['lantern', 'knock'],
  712: ['ride'], 713: ['mend'],
  714: ['ultrasound'], 715: ['ultrasound'],
  716: ['rainbow'], 717: ['darkwings'], 718: ['cells'], 719: ['diamonds'], 720: ['portal'], 721: ['steam'],
};

// 夥伴資料裡顯示的習性說明
export function habitNames(speciesId) {
  return (HABITS_BY_SPECIES[speciesId] ?? []).map(n => HABITS[n].zh);
}

// Pet.decide() 用：[名稱, 權重, 開始]
export function habitOptions(pet, others) {
  const list = [];
  for (const name of HABITS_BY_SPECIES[pet.mon.species] ?? []) {
    const h = HABITS[name];
    const w = h.w ? h.w(pet) : 7;
    if (!(w > 0)) continue;
    if (h.social) {
      if (!others.length) continue;
      list.push([name, w, () => {
        const o = h.pick(pet, others);
        if (o) h.begin(pet, o);
        else pet.set('idle', 1);
      }]);
    } else {
      list.push([name, w, () => startHabit(pet, name)]);
    }
  }
  return list;
}

// 狀態 'habit' 的轉接：把每一幀交給 pet.habit
export const HABIT_ACTIONS = {
  habit: {
    update(pet, dt, done) {
      const h = pet.habit;
      if (!h) { idle(pet); return; }
      const k = Math.min(1, pet.stateT / pet.dur);
      h.update?.(pet, dt, k);
      if (pet.state !== 'habit' || pet.habit !== h) return;
      if (done) {
        pet.habit = null;
        h.end?.(pet);
        if (pet.state === 'habit' && !pet.habit) idle(pet);
      }
    },
    lift(pet, k) {
      const h = pet.habit;
      if (h?.lift) return h.lift(pet, k);
      return pet.floats ? Math.round(Math.sin(pet.t * 2) * 2) : Math.floor(pet.t * 1.6) % 2;
    },
    pose: (pet, p, k) => pet.habit?.pose?.(pet, p, k),
    alpha: pet => pet.habit?.alpha?.(pet) ?? 1,
    intangible: pet => pet.habit?.intangible?.(pet) ?? false,
    drawOver: (pet, ctx) => pet.habit?.drawOver?.(pet, ctx),
  },
};

