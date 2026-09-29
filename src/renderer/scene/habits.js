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
// 習性裡邊做邊移動的：在走就播走路（腳才不會在地上滑），停著就站著
const stepSet = pet => (pet.lv && Math.hypot(pet.lv.x, pet.lv.y) > 2 * pet.S ? 'walk' : 'idle');

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
  // PR-N4：650–685 的習性改成「身體做的事」（像素木偶的參數 puppet、移動用 moveTo），特效只當點綴。
  // 每一種上面一行寫真實參考。身體參數：lean 負的往前、crouch 正的蹲低（負的伸長）、headPitch 正的低頭、arm／ear／tail 正的舉起來（弧度）。
  // 一段的長度照規格 §3（動物做一件事會持續一段時間），比以前長；數字都是猜的，可調整

  // ---------- 哈力栗系列：硬殼、互相衝撞鍛鍊 ----------
  // 真實參考：犰狳、刺蝟受驚時縮起來，過一會兒先探頭看看再放鬆
  hunker: {
    zh: '縮進硬殼裡', dur: () => rnd(3, 6),
    start: pet => pet.showEmote('!', 0.8),
    puppet: (pet, k) => (k < 0.8 ? { crouch: 3, headPitch: 2, arm: -0.6, ear: -0.5, tail: -0.4, lean: 1, breath: 0 } : { crouch: 1, headPitch: -1, ear: 0.2 }),
    lift: () => 0,
    end: pet => { idle(pet); pet.showEmote('♪', 1); },
  },
  // 真實參考：山羊、羊頂角前會先低頭、往後退一步蓄力
  ram: {
    zh: '跟夥伴互相衝撞鍛鍊', social: true,
    pick: (pet, others) => pick(others),
    begin: beginSpar,
  },
  // 真實參考：拳擊的護臉架勢（兩手舉到臉前、重心放低、腳站開）
  guard: {
    zh: '舉起拳頭擺出防禦姿勢', dur: () => rnd(3, 5),
    update(pet, dt, k) { if (once(pet, 'pose', k > 0.2)) { const m = pet.mouth(); burst(pet, m.x + pet.facing * 6 * pet.S, m.y, ['#ffffff', '#c8f0a0'], { n: 4, speed: 12, spread: 6.3, g: 0, life: 0.4 }); } },
    puppet: (pet, k) => ({ arm: 0.85, armSw: 0, crouch: 1, lean: k < 0.15 ? 1 : 0, headPitch: 1, legL: [-1, 0], legR: [1, 0] }),
    end: pet => { idle(pet); pet.showEmote('✦', 1); },
  },

  // ---------- 火狐狸系列：咬樹枝、耳朵噴熱氣、樹枝火把 ----------
  // 真實參考：狐狸叼著樹枝走，頭抬高一點、耳朵朝前
  twig: {
    zh: '咬著樹枝散步', dur: () => rnd(6, 10),
    start: pet => { pet.target = pet.randomPoint(60, 200); },
    update(pet, dt) { if (pet.moveTo(pet.target.x, pet.target.y, WALK_SPEED * pet.S * 0.7, dt)) pet.target = pet.randomPoint(40, 140); },
    puppet: () => ({ headPitch: -1, ear: 0.3 }),
    drawOver: (pet, ctx) => holdAtMouth(pet, ctx, art.twig),
    end: pet => { idle(pet); pet.showEmote('♪', 1); },
  },
  // 真實參考：耳廓狐的大耳朵散熱；生氣、太興奮時耳朵往後貼、身體壓低
  earpuff: {
    zh: '從耳朵噴出熱氣', dur: () => rnd(2.5, 4),
    update(pet, dt, k) {
      if (k < 0.3) return; // 先壓低、耳朵往後貼，才噴
      const r = pet.rect();
      if (Math.random() < dt * 10) for (const sx of [0.2, 0.8]) burst(pet, r.x + r.w * sx, r.y + 2 * pet.S, ['#ffffff', '#ffd0a0', '#e0e0e0'], { n: 1, speed: 30, dir: -Math.PI / 2 + (sx - 0.5), spread: 0.4, g: -20, life: 0.8, wobble: true });
    },
    puppet: (pet, k) => (k < 0.3 ? { ear: -0.6, crouch: 1, headPitch: 1, tail: 0.4 } : { ear: 0.5, earSw: 0.15 * Math.sin(pet.stateT * 18), crouch: 0, tail: 0.2 }),
  },
  // 真實參考：舉高火把揮動打信號（手舉高、左右揮）
  signal: {
    zh: '點燃尾巴的樹枝向同伴打信號', dur: () => rnd(3, 5),
    update(pet, dt, k) {
      const S = pet.S, h = pet.head();
      const tip = { x: h.x + pet.facing * 12 * S, y: h.y - 6 * S + Math.sin(pet.stateT * 5) * 3 * S };
      if (k > 0.15 && Math.random() < dt * 18) burst(pet, tip.x, tip.y, ['#ff6a2a', '#ffb13a', '#ffe066'], { n: 1, speed: 20, g: -60, life: 0.4 });
      if (once(pet, 'seen', k > 0.4)) for (const o of around(pet, 400)) { o.facing = pet.x > o.x ? 1 : -1; o.showEmote('!', 1); }
    },
    drawOver(pet, ctx) {
      const S = pet.S, h = pet.head(), img = art.twig;
      blit(ctx, img, h.x + pet.facing * 12 * S - (img.width * S) / 2, h.y - 6 * S + Math.sin(pet.stateT * 5) * 3 * S, S, { flipX: pet.facing < 0 });
    },
    puppet: pet => ({ arm: 0.8, armSw: 0.35 * Math.sin(pet.stateT * 5), tail: 0.4, headPitch: -1, lean: 1 }),
    lift: () => 0,
  },
  // 真實參考：靜靜凝視火焰（冥想）：身體不動、低頭看、只有呼吸
  vortex: {
    zh: '用超能力轉出火焰漩渦', dur: () => rnd(6, 12),
    update(pet, dt, k) { if (k > 0.25) orbit(pet, ['#ff6a2a', '#ffb13a', '#ffe066', T.psychic], pet.asset.w * 0.7, 3, 3); },
    puppet: () => ({ headPitch: 2, arm: 0.4, armSw: 0, lean: -1, tailSw: 0 }),
    end: pet => { idle(pet); pet.showEmote('✦', 0.8); },
  },

  // ---------- 呱呱泡蛙系列：泡泡、爬高塔、忍者 ----------
  // 真實參考：樹蛙蹲坐不動、只有眼睛（頭）左右掃視
  frubbles: {
    zh: '用泡泡包住全身，一邊留意四周', dur: () => rnd(8, 16), // PR-N5：以前 5–9 秒（青蛙蹲著不動可以很久）
    update(pet, dt) {
      const r = pet.rect();
      if (Math.random() < dt * 6) burst(pet, r.x + Math.random() * r.w, r.y + Math.random() * r.h, ['#ffffff', '#d8f0ff'], { n: 1, speed: 6, g: -4, life: 1.2, size: pet.S, wobble: true });
      pet.facing = Math.floor(pet.stateT / 1.6) % 2 ? 1 : -1; // 慢慢往兩邊看（會轉身，不是瞬間翻）
    },
    puppet: pet => ({ crouch: 2, headPitch: -1 + (Math.floor(pet.stateT / 0.8) % 2), lean: 0, breath: 1 }),
    start: pet => pet.showEmote('?', 1.2),
  },
  // 真實參考：青蛙起跳前先蹲低、腿一蹬跳出去，落地再蹲一下
  leap: {
    zh: '一口氣跳得老高', dur: () => rnd(1.6, 2.2),
    start: pet => { pet.target = pet.randomPoint(80, 200); },
    update(pet, dt, k) {
      const air = k > 0.2 && k < 0.85, u = (k - 0.2) / 0.65;
      pet.z = air ? Math.min(maxZ(pet), Math.sin(u * Math.PI) * 60) : 0;
      if (air) pet.moveTo(pet.target.x, pet.target.y, RUN_SPEED * pet.S, dt); // 最快跟跑步一樣（加速度有上限，規格 M1）
      if (once(pet, 'land', k > 0.85)) { pet.squashT = 0.18; pet.stage.audio.sfx('land'); }
    },
    puppet: (pet, k) => (k < 0.2 ? { crouch: 3, lean: -2, headPitch: -1, arm: -0.3 } : k < 0.85 ? { crouch: -2, lean: -2, arm: 0.5, legL: [0, 1], legR: [0, 1] } : { crouch: 2 }),
    lift: () => 0,
    end: pet => { pet.z = 0; idle(pet); },
  },
  // 真實參考：忍者先壓低身子、一瞬間消失（瞬移型習性：規格 M1 不算）
  ninja: {
    zh: '像忍者一樣消失，又從別的地方冒出來', dur: 1.8, teleport: true,
    update(pet, dt, k) {
      const S = pet.S, c = center(pet);
      if (once(pet, 'poof1', k > 0.3)) burst(pet, c.x, c.y, ['#c8c8d8', '#ffffff', '#9898a8'], { n: 14, speed: 40, spread: 6.3, g: -10, life: 0.7 });
      if (once(pet, 'jump', k > 0.5)) {
        const p = pet.stage.pointer;
        const spot = p.known && Math.random() < 0.5 ? { x: p.x + rnd(-80, 80) * S, y: p.y + 40 * S } : pet.randomPoint(150, 450);
        pet.x = spot.x; pet.gy = spot.y; pet.clamp();
        if (pet.lv) pet.lv.x = pet.lv.y = 0;
        const c2 = center(pet);
        burst(pet, c2.x, c2.y, ['#c8c8d8', '#ffffff', '#9898a8'], { n: 14, speed: 40, spread: 6.3, g: -10, life: 0.7 });
      }
    },
    puppet: () => ({ crouch: 3, lean: -3, headPitch: 1, arm: -0.4, ear: -0.3 }),
    alpha: pet => { const k = pet.stateT / pet.dur; return k < 0.3 ? 1 : k < 0.65 ? 0 : Math.min(1, (k - 0.65) * 5); },
    intangible: pet => pet.stateT / pet.dur < 0.7,
    end: pet => { idle(pet); pet.showEmote('✦', 0.8); },
  },
  // 真實參考：投擲：手往後拉、重心往後 → 往前甩、重心往前
  shuriken: {
    zh: '丟出水手裏劍', dur: () => rnd(1.6, 2.2),
    update(pet, dt, k) {
      const S = pet.S, m = pet.mouth();
      if (once(pet, 'throw', k > 0.45)) {
        pet.stage.fx.add({ img: art.star, x: m.x, y: m.y, vx: pet.facing * 320 * S, life: 1.1, fade: false });
        pet.stage.audio.sfx('throw');
      }
    },
    puppet: (pet, k) => (k < 0.45 ? { arm: 0.9, lean: 2, crouch: 1, headPitch: 0 } : { arm: -0.5, lean: -3, crouch: 0, headPitch: 0 }),
  },

  // ---------- 掘掘兔系列 ----------
  // 真實參考：穴兔警戒時用後腳站直、耳朵豎起、一動也不動，然後才衝去躲
  alert: {
    zh: '聽到翅膀聲就馬上挖洞躲起來',
    // 桌面上有會飛的夥伴時特別敏感
    w: pet => ([...pet.stage.pets.values()].some(o => o !== pet && o.floats && has(o, 'flying')) ? 14 : 5),
    dur: () => rnd(2, 3.5),
    start: pet => pet.showEmote('!', 1),
    puppet: () => ({ crouch: -2, headPitch: -2, ear: 0.6, earSw: 0, arm: 0.2, breath: 0 }),
    lift: () => 0,
    end: pet => { pet.target = pet.randomPoint(100, 300); pet.set('dig', 3); },
  },
  // 真實參考：狗甩乾身體（從頭到尾快速左右扭）
  shed: {
    zh: '抖一抖，掉下保暖的毛', dur: () => rnd(1.8, 2.6),
    update(pet, dt) { const r = pet.rect(); if (Math.random() < dt * 8) burst(pet, r.x + Math.random() * r.w, r.y + r.h * 0.6, ['#f0e0c0', '#c8a878', '#ffffff'], { n: 1, speed: 15, g: 25, life: 1.6, wobble: true }); },
    puppet: pet => { const s = Math.sin(pet.stateT * 22); return { lean: 2 * s, earSw: 0.4 * s, tailSw: 0.5 * s, crouch: 1 }; },
  },

  // ---------- 小箭雀系列 ----------
  // 真實參考：小鳥啄食：身體前傾、頭一下一下點地，中間抬頭看一下
  peck: {
    zh: '低頭啄地面', dur: () => rnd(4, 7), set: 'eat',
    update(pet) {
      const n = Math.floor(pet.stateT / 0.35);
      if (n !== pet.hd.n) { pet.hd.n = n; if (n % 2 === 0 && n % 8 < 6) burst(pet, pet.mouth().x + pet.facing * 3 * pet.S, pet.gy - pet.S, ['#8a7a4a', '#b8a06a'], { n: 2, speed: 25, spread: 2, g: 180, life: 0.3 }); }
    },
    puppet: pet => { const n = Math.floor(pet.stateT / 0.35); return n % 8 >= 6 ? { lean: 0, headPitch: -1, crouch: 0 } : { lean: -2, headPitch: n % 2 ? 0 : 2, crouch: 1, tail: 0.3 }; },
    lift: () => 0,
  },
  // 真實參考：鳥興奮、發熱時羽毛蓬起來、翅膀微微張開散熱
  heatup: {
    zh: '一興奮身體就發燙', dur: () => rnd(2.5, 4),
    start: pet => pet.showEmote('!', 0.8),
    update(pet, dt) { const r = pet.rect(); if (Math.random() < dt * 8) burst(pet, r.x + Math.random() * r.w, r.y + r.h * 0.5, ['#ff9d3a', '#ffd84a', '#ff6a2a'], { n: 1, speed: 18, g: -40, life: 0.7, wobble: true }); },
    puppet: pet => ({ crouch: -1, arm: 0.35 + 0.1 * Math.sin(pet.stateT * 9), tail: 0.4, headPitch: -1 }),
  },
  // 真實參考：鳥趕走闖入者前先張開翅膀、壓低身子威嚇，再追
  shoo: {
    zh: '把靠近地盤的傢伙趕走', social: true,
    pick: (pet, others) => { const near = others.filter(o => dist(pet, o) < 350); return near.length ? pick(near) : null; },
    begin(pet, o) {
      pet.facing = o.x > pet.x ? 1 : -1;
      startHabit(pet, 'threat', { o });
    },
  },
  threat: {
    zh: '張開翅膀威嚇', dur: 0.9,
    start: pet => { pet.showEmote('💢', 1); pet.hd.o?.showEmote('!', 0.8); },
    puppet: () => ({ arm: 0.9, crouch: 1, lean: -2, tail: 0.5, headPitch: 1 }),
    end(pet) {
      const o = pet.hd.o;
      if (!o || o.leaving || o.partner || !o.free) { idle(pet); return; }
      pet.partner = o; o.partner = pet;
      pet.set('chase', 2.5); o.set('flee', 2.5);
    },
  },
  // 真實參考：游隼俯衝（stoop）：先蹲低起飛、收起翅膀、身體往前傾直直衝下去
  dive: {
    zh: '從高空高速俯衝', dur: () => rnd(2.4, 3.2),
    start: pet => { pet.target = pet.randomPoint(150, 350); },
    update(pet, dt, k) {
      const S = pet.S;
      pet.z = Math.min(maxZ(pet), k < 0.35 ? (k / 0.35) * 60 : Math.max(0, 60 * (1 - (k - 0.35) / 0.55)));
      if (k > 0.35) {
        pet.moveTo(pet.target.x, pet.target.y, RUN_SPEED * S, dt); // 最快跟跑步一樣，加速度有上限（規格 M1）
        if (Math.random() < dt * 20) { const c = center(pet); burst(pet, c.x - pet.facing * 6 * S, c.y, ['#ff6a2a', '#ffb13a'], { n: 1, speed: 10, g: -10, life: 0.4 }); }
      }
      if (once(pet, 'hit', k > 0.92)) { pet.stage.fx.stars(pet.x, pet.gy - 4 * S, S, 4); pet.stage.audio.sfx('land'); }
    },
    puppet: (pet, k) => (k < 0.12 ? { crouch: 2, lean: 1, arm: 0.3 } : k < 0.35 ? { arm: 0.8, armSw: 0.3 * Math.sin(pet.stateT * 14), lean: 0, headPitch: -1 } : k < 0.92 ? { arm: -0.6, lean: -4, headPitch: 1, tail: 0.3 } : { arm: 0.6, crouch: 2, lean: 1 }),
    lift: () => 0,
    end: pet => { pet.z = 0; idle(pet); },
  },

  // ---------- 粉蝶蟲系列 ----------
  // 真實參考：毛毛蟲受驚時身體縮起、一陣一陣抖動
  powder: {
    zh: '噴出保護自己的粉末', dur: () => rnd(2, 3),
    update(pet, dt) { const c = center(pet); if (Math.random() < dt * 12) burst(pet, c.x, c.y, ['#d8d0c0', '#b8b0a0', '#fff8e8'], { n: 1, speed: 30, spread: 6.3, g: 10, life: 0.9, wobble: true }); },
    puppet: pet => ({ crouch: 2, lean: Math.sin(pet.stateT * 16) > 0 ? 1 : -1, headPitch: 1, tailSw: 0.3 * Math.sin(pet.stateT * 16) }),
  },
  // 真實參考：蛹、竹節蟲裝死：全身僵住，連呼吸都看不出來
  harden: {
    zh: '變得硬梆梆一動也不動', dur: () => rnd(6, 12),
    update(pet, dt) { const r = pet.rect(); if (Math.random() < dt * 1) pet.stage.fx.sparkles(r.x + Math.random() * r.w, r.y + Math.random() * r.h, pet.S, 1, 2); },
    puppet: () => ({ crouch: 1, breath: 0, arm: -0.3, tail: -0.3, ear: -0.3, armSw: 0, tailSw: 0, earSw: 0, lean: 0, headPitch: 1 }),
    lift: () => 0,
  },
  // 真實參考：蝴蝶停著曬太陽，翅膀慢慢張開、合起
  scales: {
    zh: '灑下色彩繽紛的鱗粉', dur: () => rnd(6, 10),
    update(pet, dt) {
      const r = pet.rect();
      if (Math.sin(pet.stateT * 1.6) > 0.6 && Math.random() < dt * 8) burst(pet, r.x + Math.random() * r.w, r.y + r.h * 0.5, ['#ff5d8f', '#ffd84a', '#7ab8ff', '#9be15d', '#c070ff'], { n: 1, speed: 8, dir: Math.PI / 2, g: 30, life: 1.4, wobble: true });
    },
    puppet: pet => ({ arm: 0.1 + 0.7 * (0.5 + 0.5 * Math.sin(pet.stateT * 1.6)), armSw: 0, ear: 0.2, lean: 0 }),
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
  // 真實參考：貓狗聞東西：身體伸長往前、低頭、鼻子一下一下動
  sniffat: {
    zh: '湊過去聞一聞', dur: () => rnd(2.5, 4),
    update(pet, dt, k) { if (once(pet, 'e', k > 0.6)) pet.showEmote(Math.random() < 0.6 ? '♪' : '?', 1); },
    puppet: pet => ({ lean: -3, headPitch: 1 + (Math.floor(pet.stateT / 0.3) % 2), crouch: 0, ear: 0.3, tail: 0.3 }),
    lift: () => 0,
  },
  // 真實參考：貓、獅子生氣時毛豎起來、身體看起來變大、尾巴翹高
  mane: {
    zh: '鬃毛變得熱呼呼', dur: () => rnd(2, 3),
    start: pet => pet.showEmote('💢', 1),
    update(pet, dt) { const h = pet.head(); if (Math.random() < dt * 10) burst(pet, h.x + rnd(-8, 8) * pet.S, h.y + 4 * pet.S, ['#ff6a2a', '#ffb13a'], { n: 1, speed: 20, g: -50, life: 0.5 }); },
    puppet: () => ({ crouch: -1, ear: 0.5, tail: 0.7, headPitch: 0, lean: 1 }),
  },
  // 真實參考：獅子吼叫：頭先往後、吸氣，再往前伸長脖子吼
  roar: {
    zh: '大聲吼叫，大家都嚇一跳', dur: () => rnd(2, 2.8),
    update(pet, dt, k) {
      if (once(pet, 'roar', k > 0.35)) {
        const m = pet.mouth();
        pet.stage.fx.ring(m.x, m.y, pet.S, '#ff9d3a', 70);
        pet.stage.fx.ring(m.x, m.y, pet.S, '#ffe066', 45);
        pet.stage.audio.sfx('appear');
        for (const o of around(pet, 300)) startle(o);
      }
    },
    puppet: (pet, k) => (k < 0.35 ? { headPitch: -2, lean: 2, crouch: -1, breath: 1 } : k < 0.8 ? { headPitch: 0, lean: -3, crouch: 1, tail: 0.6, ear: -0.3 } : { lean: 0, crouch: 0 }),
  },

  // ---------- 花蓓蓓系列：花粉、照顧花、庭園 ----------
  // 真實參考：蒲公英的種子隨風輕輕晃（抱著花、整隻慢慢左右擺）
  pollen: {
    zh: '收集花粉', dur: () => rnd(5, 8),
    update(pet, dt) {
      if (Math.random() > dt * 5) return;
      const c = center(pet), S = pet.S, a = Math.random() * Math.PI * 2, r = 26 * S, v = 30 * S;
      pet.stage.fx.add({ rect: '#ffe066', size: S / 2, x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, vx: -Math.cos(a) * v, vy: -Math.sin(a) * v, life: r / v });
    },
    puppet: pet => ({ lean: 1.5 * Math.sin(pet.stateT * 1.8), arm: 0.5, armSw: 0.1 * Math.sin(pet.stateT * 1.8), headPitch: 1 }),
    end: pet => { idle(pet); pet.showEmote('♪', 1); },
  },
  // 真實參考：園丁彎腰種花：身體前傾、頭低、手往下伸，種好再站直
  tend: {
    zh: '種花、照顧花', dur: () => rnd(3.5, 5.5),
    update(pet, dt, k) {
      if (once(pet, 'plant', k > 0.5)) {
        const x = pet.x + pet.facing * (pet.asset.w / 2 + 3) * pet.S, y = pet.gy;
        pet.stage.addDecal(pick(art.flowers), x, y, 60);
        pet.stage.fx.sparkles(x, y - 3 * pet.S, pet.S, 3, 8);
      }
    },
    puppet: (pet, k) => (k < 0.8 ? { lean: -3, crouch: 2, headPitch: 2, arm: -0.4 + 0.15 * Math.sin(pet.stateT * 5) } : { lean: 0, crouch: 0, headPitch: -1 }),
    lift: () => 0,
    end: pet => { idle(pet); pet.showEmote('♥', 1); },
  },
  // 真實參考：站在庭園邊很久，雙手慢慢張開（像曬太陽）
  garden: {
    zh: '在身邊種出一圈花', dur: () => rnd(6, 10),
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
    puppet: (pet, k) => ({ crouch: -1, arm: 0.2 + 0.5 * Math.min(1, k * 3), headPitch: -1, lean: 0 }),
    end: pet => { idle(pet); pet.showEmote('♥', 1); },
  },
  // 真實參考：羊吃草：低著頭一小步一小步往前，邊走邊嚼
  graze: {
    zh: '低頭吃草', dur: () => rnd(8, 14),
    set: pet => (pet.lv && Math.hypot(pet.lv.x, pet.lv.y) > 2 * pet.S ? 'walk' : 'eat'),
    start: pet => { pet.hd.next = rnd(1.5, 3); pet.target = { x: pet.x, y: pet.gy }; },
    update(pet, dt) {
      // 嚼一陣（站著）→ 往前挪一小步 → 再嚼
      if (pet.stateT > pet.hd.next) { pet.target = pet.randomPoint(10, 25); pet.hd.next = pet.stateT + rnd(2, 4); }
      pet.moveTo(pet.target.x, pet.target.y, WALK_SPEED * pet.S * 0.35, dt);
    },
    puppet: pet => ({ headPitch: 2, lean: -1, crouch: 1, ear: -0.1 + 0.1 * Math.sin(pet.stateT * 6), tail: 0.1 * Math.sin(pet.stateT * 3) }),
  },

  // ---------- 頑皮熊貓系列 ----------
  // 真實參考：小孩逞強瞪人：身體前傾、握拳、低頭往上瞪，撐不住就笑著跳一下
  glare: {
    zh: '努力瞪人，但忍不住笑出來', dur: () => rnd(4, 6),
    set: pet => (pet.stateT / pet.dur > 0.75 ? 'happy' : 'idle'),
    start: pet => pet.showEmote('💢', 1.4),
    update(pet, dt, k) {
      const p = pet.stage.pointer;
      if (p.known && k < 0.75) pet.facing = p.x > pet.x ? 1 : -1;
      if (once(pet, 'smile', k > 0.75)) pet.showEmote('♪', 1.2);
    },
    puppet: (pet, k) => (k < 0.75 ? { lean: -2, headPitch: 1, arm: 0.5, crouch: 1, ear: -0.2 } : null),
    lift: (pet, k) => (k > 0.75 ? Math.round(Math.abs(Math.sin((k - 0.75) * 20)) * 3) : 0),
  },
  // 真實參考：動物聽聲音：站定、頭抬起來、慢慢往兩邊轉
  leafsense: {
    zh: '咬著葉子感覺四周的動靜', dur: () => rnd(5, 8),
    update(pet) { pet.facing = Math.floor(pet.stateT / 1.8) % 2 ? 1 : -1; },
    drawOver: (pet, ctx) => holdAtMouth(pet, ctx, art.leaf, { dy: -1 }),
    puppet: () => ({ headPitch: -1, ear: 0.5, crouch: -1, arm: 0, breath: 0 }),
    lift: () => 0,
  },

  // ---------- 多麗米亞 ----------
  // 真實參考：狗理毛：轉頭往身上舔，一下一下
  groom: {
    zh: '整理毛，游標靠近時撒嬌', dur: () => rnd(4, 7),
    update(pet, dt, k) {
      const r = pet.rect(), p = pet.stage.pointer;
      if (Math.random() < dt * 5) burst(pet, r.x + Math.random() * r.w, r.y + r.h * 0.5, ['#ffffff', '#f0f0f0'], { n: 1, speed: 12, g: 20, life: 1.2, wobble: true });
      if (once(pet, 'love', k > 0.5 && p.known && Math.hypot(p.x - pet.x, p.y - pet.y) < 250 * pet.S)) { pet.facing = p.x > pet.x ? 1 : -1; pet.showEmote('♥', 1.2); }
    },
    puppet: pet => ({ headPitch: 2, lean: 2, crouch: 1, ear: -0.2, tail: 0.2 * Math.sin(pet.stateT * 4), breath: Math.floor(pet.stateT / 0.4) % 2 }),
  },

  // ---------- 妙喵系列：控制不了的超能力、保護夥伴 ----------
  // 真實參考：憋著一股力氣（全身繃緊、手舉起來、耳朵豎起），爆出去以後不好意思地縮起來
  psyburst: {
    zh: '超能力不小心爆發，把旁邊的夥伴彈開', dur: () => rnd(2.5, 3.5),
    start: pet => pet.showEmote('!', 0.6),
    update(pet, dt, k) {
      if (!once(pet, 'burst', k > 0.45)) return;
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
    puppet: (pet, k) => (k < 0.45 ? { crouch: -2, arm: 0.8, ear: 0.6, breath: 1, lean: 0 } : { crouch: 2, arm: -0.3, ear: -0.4, headPitch: 2, lean: 1 }),
    end: pet => { idle(pet); pet.showEmote('…', 1.4); },
  },
  protect: {
    zh: '用超能力保護感情好的夥伴', social: true,
    pick: (pet, others) => {
      const g = pet.stage.game;
      return [...others].sort((a, b) => (g?.bondOf(pet.uid, b.uid) ?? 0) - (g?.bondOf(pet.uid, a.uid) ?? 0))[0];
    },
    begin(pet, o) {
      meet(pet, o, { gap: 4, then: (a, b) => { a.partner = b; b.partner = a; startHabit(a, 'barrier'); b.set('wait', 3.4); } });
    },
  },
  // 真實參考：擋在同伴前面、張開手臂、耳朵張開（超能妙喵把耳朵內側的眼紋露出來）
  barrier: {
    zh: '張開保護罩', dur: () => rnd(3, 4),
    update(pet, dt, k) {
      const o = pet.partner;
      if (!o) return;
      const n = Math.floor(pet.stateT / 0.8);
      if (n !== pet.hd.n) { pet.hd.n = n; const c = center(o); pet.stage.fx.ring(c.x, c.y, pet.S, n % 2 ? '#7ab8ff' : T.psychic, (o.asset.w / 2 + 8)); }
      pet.facing = o.x > pet.x ? 1 : -1;
    },
    puppet: () => ({ arm: 0.9, ear: 0.7, crouch: 1, lean: -1, legL: [-1, 0], legR: [1, 0] }),
    end(pet) {
      const o = pet.partner;
      pet.partner = null;
      if (o) { if (o.partner === pet) o.partner = null; o.set('happy', 0.6); o.showEmote('♥', 1.2); bond(pet, o, 3); }
      pet.set('happy', 0.6);
    },
  },

  // ---------- 獨劍鞘系列 ----------
  // 真實參考：掛著的東西慢慢晃（像鐘擺，越到兩邊越慢）
  sway: {
    zh: '劍身輕輕搖晃', dur: () => rnd(5, 9),
    puppet: pet => ({ lean: 3 * Math.sin(pet.stateT * 1.6), armSw: 0.2 * Math.sin(pet.stateT * 1.6 - 0.6), tailSw: 0.2 * Math.sin(pet.stateT * 1.6 - 0.9) }),
  },
  drain: {
    zh: '偷偷吸一點夥伴的精氣（對方會想睡）', social: true,
    pick: (pet, others) => pick(others),
    begin(pet, o) {
      meet(pet, o, { gap: 18, then: (a, b) => { a.partner = b; b.partner = a; startHabit(a, 'drainOn'); b.set('wait', 3.2); } });
    },
  },
  // 真實參考：伸手（布條）慢慢靠過去、身體往對方傾
  drainOn: {
    zh: '吸取精氣', dur: () => rnd(2.5, 3.5),
    update(pet, dt) { const o = pet.partner; if (o) { pet.facing = o.x > pet.x ? 1 : -1; stream(pet, center(o), center(pet), ['#7ab8ff', '#b8d8ff'], { dt, rate: 15, speed: 80 }); } },
    puppet: (pet, k) => ({ arm: 0.3 + 0.6 * Math.min(1, k * 3), lean: -2, headPitch: 1 }),
    end(pet) {
      const o = pet.partner;
      pet.partner = null;
      pet.set('happy', 0.6);
      if (o) { if (o.partner === pet) o.partner = null; o.set('nap', rnd(4, 7)); o.showEmote('…', 1.2); bond(pet, o, 1); }
    },
  },
  // 真實參考：劍術練習：兩手輪流快速往前揮、身體跟著前後移重心
  swordplay: {
    zh: '兩把劍輪流快速揮舞', dur: () => rnd(2.5, 4),
    update(pet, dt) { const c = center(pet); if (Math.random() < dt * 10) burst(pet, c.x + pet.facing * 10 * pet.S, c.y + rnd(-10, 10) * pet.S, ['#ffffff', '#d8e8ff'], { n: 2, speed: 60, spread: 0.6, dir: pet.facing > 0 ? 0 : Math.PI, g: 0, life: 0.15 }); },
    puppet: pet => { const s = Math.floor(pet.stateT / 0.3) % 2 ? 1 : -1; return { armSw: 0.8 * s, arm: 0.3, lean: -2 * (s > 0 ? 1 : 0.3), crouch: 1 }; },
  },
  // 真實參考：換架勢：先縮起來（盾），再伸展開（劍）
  stance: {
    zh: '切換盾牌與劍的架勢', dur: () => rnd(2, 3),
    update(pet, dt, k) { if (once(pet, 'flash', k > 0.5)) { const c = center(pet); pet.stage.fx.sparkles(c.x, c.y, pet.S, 8, 20); pet.stage.audio.sfx('click'); } },
    puppet: (pet, k) => (k < 0.5 ? { crouch: 3, arm: -0.6, tail: -0.5, headPitch: 1 } : { crouch: -2, arm: 0.8, tail: 0.5, headPitch: -1 }),
    drawOver(pet, ctx) {
      const a = Math.sin(Math.min(1, pet.stateT / pet.dur) * Math.PI);
      if (a > 0.6) { const r = pet.rect(); blit(ctx, pet.asset.white, r.x, r.y, pet.S, { flipX: pet.viewFacing > 0, alpha: (a - 0.6) * 0.8 }); }
    },
  },

  // ---------- 粉香香系列：香味 ----------
  // 真實參考：嬰兒床的吊飾：懸著輕輕左右晃（52poke：粉香香懸停時像吊飾）
  perfume: {
    zh: '散發香氣，把夥伴吸引過來', dur: () => rnd(5, 8),
    update(pet, dt, k) {
      const c = center(pet);
      if (Math.random() < dt * 6) burst(pet, c.x + rnd(-8, 8) * pet.S, c.y, ['#ffb0d0', '#ffd6ea', '#e08ab8'], { n: 1, speed: 15, g: -15, life: 1.6, wobble: true });
      if (once(pet, 'lure', k > 0.3)) {
        const fans = around(pet, 450);
        if (fans.length) {
          const o = pick(fans);
          o.showEmote('♥', 1.2);
          meet(o, pet, { gap: 3, wait: false, then: (a, b) => { a.partner = null; a.set('happy', 0.6); a.showEmote('♥', 1.2); bond(a, b, 1); } });
        }
      }
    },
    puppet: pet => ({ lean: 2 * Math.sin(pet.stateT * 2.2), arm: 0.4, armSw: 0.15 * Math.sin(pet.stateT * 2.2 - 0.5), tailSw: 0.2 * Math.sin(pet.stateT * 2.2 - 0.8) }),
  },
  // 真實參考：佛朗明哥的舞姿：手舉高、身體左右擺、停一下再換邊（52poke：芳香精的動作像佛朗明哥）
  aroma: {
    zh: '用芳香讓身邊的夥伴放鬆', dur: () => rnd(4, 6),
    update(pet, dt, k) {
      const c = center(pet);
      if (Math.random() < dt * 6) burst(pet, c.x + rnd(-10, 10) * pet.S, c.y, ['#ffb0d0', '#ffffff', '#e08ab8'], { n: 1, speed: 25, spread: 6.3, g: -10, life: 1.4, wobble: true });
      pet.facing = Math.floor(pet.stateT / 1.5) % 2 ? 1 : -1;
      if (once(pet, 'calm', k > 0.5)) for (const o of around(pet, 260)) { o.set('happy', 0.6); pet.stage.fx.hearts(o.head().x, o.head().y, pet.S, 1); bond(pet, o, 1); }
    },
    puppet: pet => ({ arm: 0.9, armSw: 0.3 * Math.sin(pet.stateT * 4.2), lean: -2, crouch: -1, headPitch: -1 }),
  },
  string: {
    zh: '吐出黏答答的絲黏住夥伴', social: true,
    pick: (pet, others) => pick(others),
    begin(pet, o) {
      meet(pet, o, { gap: 26, then: (a, b) => { a.partner = b; b.partner = a; startHabit(a, 'spin'); b.set('wait', 1.8); } });
    },
  },
  // 真實參考：蜘蛛、蠶吐絲：身體往前壓低、頭一直對著對方
  spin: {
    zh: '吐絲', dur: () => rnd(1.6, 2.2),
    update(pet, dt, k) {
      const o = pet.partner;
      if (!o) return;
      pet.facing = o.x > pet.x ? 1 : -1;
      if (k < 0.6) stream(pet, pet.mouth(), center(o), ['#ffffff', '#f0e8f0'], { dt, rate: 30, speed: 200 });
      if (once(pet, 'hit', k > 0.6)) { o.partner = null; startHabit(o, 'stuck'); }
    },
    puppet: () => ({ lean: -3, crouch: 1, headPitch: 0 }),
    end: pet => { pet.partner = null; pet.set('happy', 0.6); pet.showEmote('♪', 1); },
  },
  // 真實參考：被黏住的動物用力掙扎：身體左右扭、壓低
  stuck: {
    zh: '被黏住了', dur: () => rnd(2.5, 3.5),
    start: pet => pet.showEmote('…', 1.6),
    update(pet, dt) { const r = pet.rect(); if (Math.random() < dt * 4) burst(pet, r.x + Math.random() * r.w, r.y + Math.random() * r.h, ['#ffffff'], { n: 1, speed: 4, g: 0, life: 0.6 }); },
    puppet: pet => { const s = Math.sin(pet.stateT * 10); return { lean: 2 * s, crouch: 2, armSw: 0.4 * s, ear: -0.3 }; },
    lift: () => 0,
    end: pet => { idle(pet); pet.showEmote('💢', 1); },
  },
  // 真實參考：小狗開心蹦跳：每一跳先蹲再彈，落地又蹲
  bounce: {
    zh: '軟綿綿地彈跳', dur: () => rnd(2.5, 4),
    lift: pet => Math.round(Math.max(0, Math.sin(pet.stateT * Math.PI / 0.5)) * 8),
    puppet: pet => { const u = Math.sin(pet.stateT * Math.PI / 0.5); return u > 0 ? { crouch: -1, arm: 0.5 } : { crouch: 2, arm: 0 }; },
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

  // PR-N5：686–721 也改成「身體做的事」（同上面的寫法）。以前的 pose（整張圖左右移、轉、壓扁拉長）拿掉，換成 puppet

  // ---------- 好啦魷系列：閃光、催眠 ----------
  // 真實參考：烏賊、墨魚受到威脅時身體一明一暗地閃，觸手張開、身體往後縮，閃完噴一下就溜
  flash: {
    zh: '閃爍發光體讓對方頭暈，趁機溜走', dur: () => rnd(2, 3),
    puppet: (pet, k) => (k < 0.25 ? { crouch: 1, lean: 1, arm: 0.3, headPitch: 1 } : { crouch: -1, lean: 1, arm: 0.8, armSw: Math.floor(pet.stateT * 5) % 2 ? 0.2 : -0.2, headPitch: -1 }),
    update(pet, dt, k) {
      const r = pet.rect();
      if (k > 0.25 && Math.floor(pet.stateT * 10) % 2 && Math.random() < dt * 40) burst(pet, r.x + Math.random() * r.w, r.y + Math.random() * r.h, ['#ffffff', '#8ae8ff', '#ffe066'], { n: 1, speed: 5, g: 0, life: 0.12 });
      if (once(pet, 'daze', k > 0.6)) for (const o of around(pet, 220)) { o.set('dizzy', 1.2); o.showEmote('@', 1.2); }
    },
    drawOver(pet, ctx) {
      // 先縮一下（k < 0.25）才開始閃
      if (pet.stateT / pet.dur > 0.25 && Math.floor(pet.stateT * 10) % 2) { const r = pet.rect(); blit(ctx, pet.asset.white, r.x, r.y, pet.S, { flipX: pet.facing > 0, alpha: 0.45 }); }
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
      startHabit(o, 'drawn', { to: pet, dur: pet.dur - 0.2 }); // 被催眠的比催眠的早一點點醒
    },
  },
  // 真實參考：蛇、催眠師：身體慢慢畫圈左右擺，頭一直對著對方
  hypnotize: {
    zh: '催眠', dur: () => rnd(4.5, 6.5),
    puppet: pet => { const s = Math.sin(pet.stateT * 2); return { lean: Math.round(2 * s), arm: 0.5, armSw: 0.3 * Math.sin(pet.stateT * 2 - 0.7), headPitch: 0, crouch: 0 }; },
    update(pet) {
      const n = Math.floor(pet.stateT / 0.6);
      if (n !== pet.hd.n) { pet.hd.n = n; const c = center(pet); pet.stage.fx.ring(c.x, c.y, pet.S, has(pet, 'ghost') ? '#ff9d3a' : T.psychic, 40); }
    },
    end: pet => { pet.partner = null; pet.set('happy', 0.6); pet.showEmote('♪', 1); },
  },
  // 真實參考：夢遊的人：身體前傾、頭低低的、手往前伸，一小步一小步慢慢走
  drawn: {
    zh: '被催眠了', dur: pet => pet.hd.dur ?? 3.8,
    set: stepSet,
    puppet: () => ({ lean: -2, headPitch: 1, arm: 0.4, armSw: 0, ear: -0.2 }),
    start: pet => pet.showEmote('…', 2),
    update(pet, dt) {
      const to = pet.hd.to;
      if (!to || to.leaving) return;
      const gap = ((to.asset.w + pet.asset.w) / 2 + 4) * pet.S;
      pet.moveTo(to.x + (pet.x < to.x ? -gap : gap), to.gy, WALK_SPEED * pet.S * 0.4, dt);
    },
    lift: pet => Math.round(Math.abs(Math.sin(pet.walkPhase)) * 1),
    end: pet => { if (pet.hd.to?.partner === pet) pet.hd.to.partner = null; pet.partner = null; startle(pet); bond(pet, pet.hd.to, 1); },
  },

  // ---------- 龜腳腳系列 ----------
  // 真實參考：兩個小孩吵架：你推我、我推你，身體一邊往前頂、一邊往後閃，手甩來甩去
  bicker: {
    zh: '兩個頭步調不一致，吵起來', dur: () => rnd(3, 5),
    start: pet => pet.showEmote('💢', 1.2),
    puppet: pet => { const s = Math.floor(pet.stateT / 0.45) % 2 ? 1 : -1; return { lean: 2 * s, armSw: 0.5 * s, arm: 0.3, headPitch: s > 0 ? 1 : -1, crouch: 1 }; },
    end: pet => { idle(pet); pet.showEmote('♪', 1); },
  },
  // 真實參考：哨兵瞭望：站高、手舉到眼睛上方，慢慢轉頭看一邊、再看另一邊
  lookout: {
    zh: '用手上的眼睛觀察四面八方', dur: () => rnd(4, 7),
    update(pet) { pet.facing = Math.floor(pet.stateT / 1.5) % 2 ? 1 : -1; }, // 慢慢往兩邊看（會轉身，不是一直翻）
    start: pet => pet.showEmote('!', 0.8),
    puppet: pet => ({ crouch: -2, arm: 0.8, armSw: 0.15 * Math.sin(pet.stateT * 1.5), headPitch: -1, breath: 0 }),
    lift: () => 0,
  },

  // ---------- 垃垃藻系列 ----------
  // 真實參考：葉海龍混在海藻裡：在原地跟著水流慢慢搖，幾乎不動
  camo: {
    zh: '假裝成海藻不讓人發現', dur: () => rnd(6, 12),
    puppet: pet => ({ lean: Math.round(1.5 * Math.sin(pet.stateT * 1.3)), tailSw: 0.3 * Math.sin(pet.stateT * 1.3 - 0.8), armSw: 0.2 * Math.sin(pet.stateT * 1.3 - 0.4), breath: 0 }),
    alpha: () => 0.6,
    drawOver(pet, ctx) { const r = pet.rect(); blit(ctx, pet.asset.dark, r.x, r.y, pet.S, { flipX: pet.facing > 0, alpha: 0.2 }); },
    lift: () => 0,
  },
  // 真實參考：海龜、蜥蜴曬太陽：脖子伸長、頭抬高朝著太陽，一動也不動
  sunhat: {
    zh: '讓頭頂曬太陽，製造龍之能量',
    w: pet => (isDay(pet.stage.env) ? 8 : 1),
    dur: () => rnd(6, 10),
    update(pet, dt) { const h = pet.head(); if (Math.random() < dt * 5) burst(pet, h.x + rnd(-6, 6) * pet.S, h.y + 4 * pet.S, [T.dragon, '#c070d0', '#ffe066'], { n: 1, speed: 10, g: -8, life: 1.4, wobble: true }); },
    puppet: () => ({ crouch: -1, headPitch: -2, arm: 0.3, tail: 0.2, breath: 0 }),
    lift: () => 0,
  },

  // ---------- 鐵臂槍蝦系列：水砲 ----------
  // 真實參考：槍蝦：大鉗子舉起來瞄準一陣子，「啪」一聲射出去，身體被後座力往後推一下
  watershot: {
    zh: '從鉗子射出水彈', dur: () => rnd(2.2, 3),
    update(pet, dt, k) { waterShot(pet, k, { range: 240, size: 1, ring: false, at: 0.4 }); },
    puppet: (pet, k) => (k < 0.4 ? { arm: 0.7, lean: -1, crouch: 1, headPitch: 0 } : k < 0.55 ? { arm: 0.4, lean: 2, crouch: 0 } : { arm: 0.1, lean: 0, crouch: 0 }),
  },
  cannon: {
    zh: '發射威力超強的海水砲彈', dur: () => rnd(2.6, 3.4),
    update(pet, dt, k) { waterShot(pet, k, { range: 400, size: 2, ring: true, at: 0.4 }); },
    puppet: (pet, k) => (k < 0.4 ? { arm: 0.8, lean: -1, crouch: 2, headPitch: 1, legL: [-1, 0], legR: [1, 0] } : k < 0.6 ? { arm: 0.5, lean: 3, crouch: 1 } : { arm: 0.1, lean: 0, crouch: 0 }),
  },

  // ---------- 傘電蜥系列 ----------
  // 真實參考：蜥蜴曬太陽：身體貼地壓低、頸部的褶傘張開（這裡用耳朵、手往外張），一動也不動
  solar: {
    zh: '曬太陽發電',
    w: pet => (isDay(pet.stage.env) ? 12 : 2),
    dur: () => rnd(8, 15),
    update(pet, dt, k) {
      const r = pet.rect();
      if (Math.random() < dt * (2 + k * 20)) burst(pet, r.x + Math.random() * r.w, r.y + Math.random() * r.h * 0.5, ['#fff27a', '#ffd84a', '#ffffff'], { n: 2, speed: 40, spread: 6.3, g: 0, life: 0.25 });
    },
    puppet: pet => ({ crouch: 2, ear: pet.mon.species === 695 ? 0.9 : 0.6, arm: 0.4, headPitch: -1, breath: 0, tail: 0 }),
    lift: () => 0,
    end: pet => { idle(pet); pet.showEmote('✦', 1); },
  },

  // ---------- 寶寶暴龍系列 ----------
  // 真實參考：小孩耍賴跺腳：左右腳輪流用力踩、手甩、頭低低的
  tantrum: {
    zh: '任性地跺腳撒嬌', dur: () => rnd(3, 5),
    start: pet => pet.showEmote('💢', 1.2),
    update(pet) {
      const n = Math.floor(pet.stateT / 0.4);
      if (n !== pet.hd.n) { pet.hd.n = n; burst(pet, pet.x + (n % 2 ? 1 : -1) * 3 * pet.S, pet.gy - pet.S, ['#9a6a3a', '#c8955a'], { n: 3, speed: 40, spread: 2, g: 200, life: 0.4 }); }
    },
    puppet: pet => { const n = Math.floor(pet.stateT / 0.4), up = pet.stateT % 0.4 < 0.2; return { legL: [0, n % 2 && up ? -2 : 0], legR: [0, !(n % 2) && up ? -2 : 0], lean: n % 2 ? 1 : -1, armSw: n % 2 ? 0.5 : -0.5, headPitch: 1, crouch: up ? 0 : 1 }; },
    lift: () => 0,
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
    begin(pet, o) { meet(pet, o, { gap: 1, then: (a, b) => { a.partner = b; b.partner = a; startHabit(a, 'bite'); b.set('wait', a.dur + 0.2); } }); },
  },
  // 真實參考：小狗玩咬：先往後縮、壓低頭，再往前一撲咬一口
  bite: {
    zh: '咬', dur: () => rnd(1.3, 1.7),
    puppet: (pet, k) => (k < 0.4 ? { lean: 2, crouch: 2, headPitch: 1, tail: 0.4 } : k < 0.65 ? { lean: -4, crouch: 0, headPitch: 1, tail: 0.5 } : { lean: -1, crouch: 0, headPitch: 0 }),
    lift: () => 0,
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
    end: pet => { pet.partner = null; pet.set('happy', 0.6); pet.showEmote('♪', 1); },
  },
  // 真實參考：大象、大型動物跺腳：一隻腳抬高、重心移到另一邊，再用全身的重量踩下去
  stomp: {
    zh: '重重地踏地，地面都在震動', dur: () => rnd(2, 2.8),
    puppet: (pet, k) => (k < 0.55 ? { legL: [0, -2], lean: 1, crouch: -1, arm: 0.4, tail: 0.3, headPitch: -1 } : k < 0.75 ? { legL: [0, 0], crouch: 2, lean: -1, headPitch: 1, arm: 0 } : { crouch: 0, lean: 0 }),
    lift: () => 0,
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
  },

  // ---------- 冰雪龍系列 ----------
  // 真實參考：天鵝、孔雀把翅膀（冰雪龍是背上的帆）張開、脖子伸長抬頭，慢慢地呼吸
  aurora: {
    zh: '帆上閃著極光',
    w: pet => (isNight(pet.stage.env) ? 12 : 5),
    dur: () => rnd(5, 8),
    puppet: pet => ({ crouch: -2, headPitch: -2, arm: 0.6, tail: 0.3, breath: Math.floor(pet.stateT / 1.5) % 2 }),
    lift: () => 0,
    update(pet, dt) {
      const h = pet.head();
      if (Math.random() < dt * 14) burst(pet, h.x + rnd(-14, 14) * pet.S, h.y + rnd(0, 12) * pet.S, ['#7affc8', '#7ab8ff', '#c070ff', '#ff9ec7', '#ffe066'], { n: 1, speed: 8, g: -10, life: 1.4, wobble: true });
    },
  },
  // 真實參考：冬天呼出一口長長的白氣：先抬頭吸一口氣，再往前慢慢吐
  diamonddust: {
    zh: '噴出冰氣，四周飄起鑽石塵', dur: () => rnd(3, 5),
    puppet: (pet, k) => (k < 0.2 ? { headPitch: -1, breath: 1, crouch: -1 } : { headPitch: 0, lean: -1, breath: 0, crouch: 0 }),
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
      meet(pet, o, { gap: 12, wait: true, then: (a, b) => { a.partner = b; b.partner = a; startHabit(a, 'soothe'); b.set('wait', a.dur + 0.2); } });
    },
  },
  // 真實參考：安撫小孩：靠過去、身體往前傾、頭歪低，手（緞帶）輕輕地拍
  soothe: {
    zh: '緞帶', dur: () => rnd(3, 4.5),
    puppet: pet => ({ lean: -2, headPitch: 1, arm: 0.5, armSw: 0.2 * Math.sin(pet.stateT * 3), ear: -0.2, crouch: 1 }),
    lift: () => 0,
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
  // 真實參考：摔角選手進場擺姿勢：先蹲低蓄力，再挺胸、兩手舉高、下巴抬高，停在那裡讓大家看
  flashypose: {
    zh: '出招前擺出華麗的姿勢（有時會被打斷）', dur: () => rnd(2.5, 4),
    update(pet, dt, k) { if (once(pet, 'shine', k > 0.4)) { const c = center(pet); pet.stage.fx.sparkles(c.x, c.y, pet.S, 10, 24); pet.stage.audio.sfx('sparkle'); pet.showEmote('✦', 1); } },
    puppet: (pet, k) => (k < 0.3 ? { crouch: 2, arm: -0.3, lean: 0, headPitch: 1 } : { crouch: -2, arm: 0.9, lean: 1, headPitch: -2, tail: 0.5, legL: [-1, 0], legR: [1, 0] }),
    lift: () => 0,
    end(pet) {
      if (Math.random() < 0.25) { pet.set('trip', 1.3); pet.showEmote('@', 1.3); pet.stage.audio.sfx('land'); }
      else idle(pet);
    },
  },

  // ---------- 咚咚鼠 ----------
  leech: {
    zh: '從電屬性的夥伴那裡偷電', social: true,
    pick: (pet, others) => { const e = others.filter(o => has(o, 'electric')); return e.length ? pick(e) : null; },
    begin(pet, o) { meet(pet, o, { gap: 14, then: (a, b) => { a.partner = b; b.partner = a; startHabit(a, 'charge'); b.set('wait', a.dur + 0.2); } }); },
  },
  // 真實參考：老鼠、松鼠偷偷湊過去：身體往前伸長、兩手往前、耳朵豎起來，尾巴翹高
  charge: {
    zh: '偷電', dur: () => rnd(3, 4.5),
    puppet: pet => ({ lean: -2, arm: 0.5, ear: 0.6, tail: 0.5, tailSw: 0.15 * Math.sin(pet.stateT * 6), headPitch: 0 }),
    lift: () => 0,
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
    dur: () => rnd(4, 7),
    update(pet, dt) { const r = pet.rect(); if (Math.random() < dt * 20) burst(pet, r.x + Math.random() * r.w, r.y + Math.random() * r.h, ['#fff27a', '#ffffff'], { n: 1, speed: 30, spread: 6.3, g: 0, life: 0.2 }); },
    // 真實參考：貓窩在暖氣旁邊：縮成一團、尾巴捲起來、舒服得耳朵放鬆
    puppet: pet => ({ crouch: 2, headPitch: 1, ear: -0.2, tail: 0.6, tailSw: 0.1 * Math.sin(pet.stateT * 2), arm: -0.3, breath: Math.floor(pet.stateT / 1.2) % 2 }),
    lift: () => 0,
    end: pet => { pet.set('happy', 0.6); pet.showEmote('♪', 1); },
  },

  // ---------- 小碎鑽 ----------
  // 真實參考：石頭一樣的沉睡（冬眠的動物）：縮起來完全不動，只有很慢的呼吸
  gemnap: {
    zh: '像在礦床裡一樣靜靜地沉睡', dur: () => rnd(15, 25),
    puppet: pet => ({ crouch: 1, headPitch: 1, arm: -0.2, ear: -0.2, tail: -0.2, breath: Math.floor(pet.stateT / 2.5) % 2 }),
    lift: () => 0,
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
    // 真實參考：蛞蝓、蝸牛被碰到：觸角縮回去、身體貼地變扁，過一會兒才慢慢把觸角伸出來看看
    dur: () => rnd(4, 7),
    start(pet) {
      const p = pet.stage.pointer;
      if (p.known) pet.facing = p.x > pet.x ? -1 : 1; // 轉過去背對
      pet.showEmote('…', 1.4);
    },
    puppet: (pet, k) => (k < 0.8 ? { crouch: 3, ear: -0.8, headPitch: 2, arm: -0.5, tail: -0.3, breath: 0 } : { crouch: 1, ear: 0.3, headPitch: 0 }),
    lift: () => 0,
  },
  hug: {
    zh: '緊緊抱住感情好的夥伴（黏答答的）', social: true,
    pick: (pet, others) => {
      const g = pet.stage.game;
      return [...others].sort((a, b) => (g?.bondOf(pet.uid, b.uid) ?? 0) - (g?.bondOf(pet.uid, a.uid) ?? 0))[0];
    },
    begin(pet, o) { meet(pet, o, { gap: -6, then: (a, b) => { a.partner = b; b.partner = a; startHabit(a, 'hugging'); b.set('wait', a.dur + 0.2); } }); },
  },
  // 真實參考：抱抱：兩手張開環住對方、身體靠過去，抱著輕輕左右搖
  hugging: {
    zh: '抱抱', dur: () => rnd(3, 5),
    puppet: pet => ({ arm: 0.8, lean: -2 + Math.round(Math.sin(pet.stateT * 2.5)), crouch: 1, headPitch: 1, ear: -0.2 }),
    lift: () => 0,
    update(pet, dt) {
      const o = pet.partner;
      if (o && Math.random() < dt * 3) pet.stage.fx.hearts((pet.x + o.x) / 2, Math.min(pet.head().y, o.head().y), pet.S, 1);
      if (Math.random() < dt * 5) pet.stage.fx.add({ rect: '#b58ad8', size: pet.S / 2, x: pet.x + rnd(-8, 8) * pet.S, y: pet.gy - pet.S, life: 4 });
    },
    end(pet) {
      const o = pet.partner;
      pet.partner = null;
      pet.set('happy', 0.6);
      if (o) { if (o.partner === pet) o.partner = null; o.set('happy', 0.6); o.showEmote('♥', 1.2); bond(pet, o, 3); }
    },
  },

  // ---------- 鑰圈兒 ----------
  // 真實參考：小孩搖鈴：手舉起來快速左右搖，身體跟著一點點晃
  jingle: {
    zh: '叮叮噹噹地搖鑰匙', dur: () => rnd(2.5, 4),
    update(pet, dt) {
      const n = Math.floor(pet.stateT / 0.35);
      if (n !== pet.hd.n) { pet.hd.n = n; pet.stage.audio.sfx('click'); const c = center(pet); pet.stage.fx.sparkles(c.x + rnd(-10, 10) * pet.S, c.y, pet.S, 1, 4); }
    },
    puppet: pet => { const s = Math.floor(pet.stateT / 0.175) % 2 ? 1 : -1; return { arm: 0.6, armSw: 0.5 * s, lean: s > 0 ? 1 : 0, headPitch: -1 }; },
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
  // 真實參考：喜鵲、烏鴉找到亮晶晶的東西：先低頭湊近仔細看，再開心地抬起頭
  keyfound: {
    zh: '找到了', dur: () => rnd(2.5, 3.5),
    update(pet, dt, k) { if (once(pet, 'find', k > 0.3)) { pet.showEmote('♥', 1.2); pet.stage.fx.add({ img: art.key, x: pet.x, y: pet.head().y - 4 * pet.S, vy: -20 * pet.S, life: 1.2 }); } },
    puppet: (pet, k) => (k < 0.3 ? { lean: -2, headPitch: 2, crouch: 1 } : { lean: 0, headPitch: -1, crouch: -1, arm: 0.5 }),
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
  // 真實參考：跟著聲音走的小孩：一邊走一邊抬頭找聲音在哪裡、耳朵豎起來
  lured: {
    zh: '被引走', dur: 6,
    set: stepSet,
    puppet: () => ({ headPitch: -1, ear: 0.4 }),
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
  // 真實參考：樹扎根：腳站開站穩、身體慢慢往下沉，手（樹枝）往上伸、隨風輕輕晃
  roots: {
    zh: '從腳底伸出根鬚連結四周', dur: () => rnd(5, 9),
    update(pet, dt) {
      if (Math.random() > dt * 18) return;
      const a = Math.random() * Math.PI * 2, v = 25 * pet.S;
      pet.stage.fx.add({ rect: Math.random() < 0.5 ? '#6e4a28' : '#4a9a3a', size: pet.S / 2, x: pet.x, y: pet.gy - pet.S, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.4, life: 2, fade: true });
    },
    puppet: pet => ({ crouch: 2, legL: [-1, 0], legR: [1, 0], arm: 0.6, armSw: 0.1 * Math.sin(pet.stateT * 1.2), headPitch: 1, breath: 0 }),
    lift: () => 0,
  },
  // 真實參考：夜裡提著燈籠站著的人：身體不動，只有慢慢左右看
  lantern: {
    zh: '南瓜的洞在夜裡發光',
    w: pet => (isNight(pet.stage.env) ? 12 : 3),
    dur: () => rnd(6, 10),
    puppet: pet => ({ headPitch: -1, arm: 0.3, lean: Math.round(Math.sin(pet.stateT * 0.9)), crouch: 0 }),
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
  // 真實參考：敲門：手舉起來，一下一下往前敲（身體跟著往前），敲三下以後側耳聽有沒有人
  knocking: {
    zh: '叩叩', dur: () => rnd(2.5, 3.5),
    update(pet) {
      pet.facing = 1;
      const n = Math.floor(pet.stateT / 0.35);
      if (n !== pet.hd.n && n < 3) { pet.hd.n = n; pet.stage.audio.sfx('click'); }
    },
    puppet: pet => (pet.stateT < 1.05 ? { arm: 0.8, lean: pet.stateT % 0.35 < 0.175 ? -2 : 0, headPitch: 0 } : { arm: 0, lean: 0, headPitch: -1, ear: 0.5 }),
    lift: () => 0,
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
    // 真實參考：騎在大人肩上的小孩：身體放低坐穩、手扶著、抬頭看前面
    puppet: () => ({ crouch: 1, arm: 0.4, headPitch: -1 }),
    lift: () => 0,
    end(pet) {
      // 輕輕跳到冰岩怪旁邊
      const av = pet.hd.on;
      pet.z = 0;
      if (av) {
        // 往有空間的那一邊跳：跳向螢幕邊緣的話會被夾回來，正好疊在冰岩怪身上
        const gap = (av.asset.w / 2 + pet.asset.w / 2 + 4) * pet.S;
        const b = pet.bounds();
        const room = s => (s < 0 ? av.x - gap >= b.x0 : av.x + gap <= b.x1);
        let side = Math.random() < 0.5 ? -1 : 1;
        if (!room(side)) side = -side;
        pet.x = av.x + gap * side;
        if (!room(side)) pet.gy = av.gy + (av.gy > (b.y0 + b.y1) / 2 ? -1 : 1) * av.asset.h * 0.6 * pet.S; // 兩邊都沒空間（很窄的螢幕）：往前或往後跳
      }
      pet.clamp();
      pet.squashT = 0.18;
      pet.set('hop', 0.35);
    },
  },
  mend: {
    zh: '晚上坐著讓身上的裂縫長好',
    w: pet => (isNight(pet.stage.env) ? 12 : 2),
    // 真實參考：受傷的動物窩著休養：縮起來、低頭，慢慢地呼吸
    dur: () => rnd(10, 20),
    update(pet, dt) { const r = pet.rect(); if (Math.random() < dt * 3) pet.stage.fx.sparkles(r.x + Math.random() * r.w, r.y + Math.random() * r.h, pet.S, 1, 2); },
    puppet: pet => ({ crouch: 2, headPitch: 1, arm: -0.3, breath: Math.floor(pet.stateT / 2) % 2 }),
    lift: () => 0,
    end: pet => { idle(pet); pet.showEmote('✦', 1); },
  },

  // ---------- 嗡蝠系列 ----------
  // 真實參考：蝙蝠叫的時候：頭往前伸、張嘴、耳朵豎直，翅膀微微張開
  ultrasound: {
    zh: '發出超音波，大家都摀住耳朵',
    w: pet => (isNight(pet.stage.env) ? 12 : 5),
    dur: () => rnd(3, 5),
    puppet: () => ({ headPitch: -1, lean: -2, ear: 0.7, arm: 0.5, crouch: -1 }),
    update(pet, dt, k) {
      const n = Math.floor(pet.stateT / 0.35);
      const big = pet.mon.species === 715;
      if (n !== pet.hd.n) { pet.hd.n = n; const m = pet.mouth(); pet.stage.fx.ring(m.x, m.y, pet.S, n % 2 ? '#c070ff' : '#7ab8ff', big ? 70 : 45); }
      if (once(pet, 'cover', k > 0.4)) for (const o of around(pet, big ? 350 : 220)) { o.set('shiver', 1); o.showEmote('…', 1); }
    },
  },

  // ---------- 傳說與幻之寶可夢 ----------
  // 真實參考：公鹿抬頭挺胸展示角：站直、頭抬高，慢慢地呼吸
  rainbow: {
    zh: '角閃耀出七種顏色，分享生命的能量', dur: () => rnd(5, 8),
    puppet: pet => ({ crouch: -2, headPitch: -2, breath: Math.floor(pet.stateT / 1.5) % 2, tail: 0.2 }),
    lift: () => 0,
    update(pet, dt, k) {
      const h = pet.head();
      if (Math.random() < dt * 20) burst(pet, h.x + rnd(-16, 16) * pet.S, h.y + rnd(0, 10) * pet.S, ['#ff5d5d', '#ffb13a', '#ffe066', '#7ae07a', '#7ab8ff', '#8a6aff', '#e070ff'], { n: 1, speed: 12, g: -10, life: 1.2, wobble: true });
      if (once(pet, 'share', k > 0.5)) for (const o of around(pet, 400, { free: false })) { pet.stage.fx.hearts(o.head().x, o.head().y, pet.S, 2); o.showEmote('♥', 1); }
    },
  },
  // 真實參考：老鷹、蝙蝠展翅威嚇：翅膀完全張開、身體壓低往前
  darkwings: {
    zh: '張開翅膀，四周暗了下來', dur: () => rnd(3.5, 5),
    update(pet, dt, k) {
      const c = center(pet);
      if (Math.random() < dt * 24) burst(pet, c.x + rnd(-30, 30) * pet.S, c.y + rnd(-10, 10) * pet.S, ['#3a1020', '#8a1a30', '#1a1a2a'], { n: 1, speed: 20, spread: 6.3, g: -5, life: 1.2, wobble: true });
      if (once(pet, 'shiver', k > 0.5)) for (const o of around(pet, 300)) { o.set('shiver', 0.8); o.showEmote('…', 1); }
    },
    puppet: (pet, k) => (k < 0.2 ? { arm: 0.3, crouch: 0, headPitch: 0 } : { arm: 0.9, crouch: 1, lean: -2, tail: 0.5, headPitch: 1 }),
  },
  // 真實參考：蛇盤著休息：身體不動、慢慢呼吸，頭跟著看繞圈的核心
  cells: {
    zh: '核心在身邊繞圈', dur: () => rnd(5, 8),
    update(pet) { orbit(pet, ['#3ad06a', '#a8ffc0', '#0e3a1a'], pet.asset.w * 0.7, 5, 4); },
    puppet: pet => ({ crouch: 1, headPitch: Math.round(Math.sin(pet.stateT * 2)), breath: Math.floor(pet.stateT / 1.8) % 2 }),
    lift: () => 0,
  },
  // 真實參考：用手搓、捏東西：兩手在胸前合起來用力壓（身體跟著縮一下），放開看一看，再做下一顆
  diamonds: {
    zh: '壓縮空氣做出鑽石', dur: () => rnd(3.5, 5),
    puppet: (pet, k) => ((k * 3) % 1 < 0.6 ? { arm: 0.5, crouch: 1, lean: -1, headPitch: 1 } : { arm: 0.2, crouch: 0, lean: 0, headPitch: 0 }),
    lift: () => 0,
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
  },
  // 真實參考：跳水、鑽圈：先蹲低、兩手往前伸，往前一鑽；出來的時候落地蹲一下（瞬移型習性：規格 M1 不算）
  portal: {
    zh: '鑽進圓環，從別的地方出來', dur: () => rnd(2.2, 3), teleport: true,
    puppet: (pet, k) => (k < 0.3 ? { crouch: 2, arm: 0.8, lean: -2, headPitch: 1 } : k < 0.55 ? { crouch: -2, arm: 0.9, lean: -3 } : k < 0.75 ? { crouch: 2, arm: 0.3, lean: 1 } : { crouch: 0, arm: 0, lean: 0 }),
    lift: () => 0,
    update(pet, dt, k) {
      if (once(pet, 'jump', k > 0.45)) {
        const p = pet.randomPoint(200, 500);
        pet.x = p.x; pet.gy = p.y;
        if (pet.lv) pet.lv.x = pet.lv.y = 0;
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
  // 真實參考：鯨魚從噴氣孔噴氣：身體先往下壓、憋一下，氣往上衝的時候背上的手臂舉起來、頭抬起
  steam: {
    zh: '從背上的手臂噴出蒸氣', dur: () => rnd(3, 5),
    puppet: (pet, k) => (k < 0.2 ? { crouch: 2, headPitch: 1, arm: -0.3, breath: 1 } : { crouch: 0, arm: 0.8, headPitch: -1, lean: 1, breath: 0 }),
    lift: () => 0,
    update(pet, dt, k) {
      const r = pet.rect();
      if (k > 0.2 && Math.random() < dt * 40) burst(pet, r.x + r.w * (pet.facing > 0 ? 0.3 : 0.7), r.y + 4 * pet.S, ['#ffffff', '#e0e8f0', '#c8d0d8'], { n: 1, speed: 70, dir: -Math.PI / 2 - pet.facing * 0.4, spread: 0.5, g: -30, life: 1.2, wobble: true });
      if (once(pet, 'boom', k > 0.2)) { pet.stage.fx.ring(r.x + r.w / 2, r.y, pet.S, '#ffffff', 50); pet.stage.audio.sfx('flee'); }
    },
  },
};

// 水砲：射出去的水彈飛到盡頭後濺開（at：動作進行到多少的時候射；PR-N5 先瞄準一陣子才射）
function waterShot(pet, k, { range, size, ring, at = 0.28 }) {
  const S = pet.S, m = pet.mouth();
  if (once(pet, 'fire', k > at)) {
    pet.hd.from = { x: m.x, y: m.y };
    const b = pet.bounds();
    const toX = Math.max(b.x0, Math.min(b.x1, m.x + pet.facing * range * S));
    pet.hd.to = { x: toX, y: m.y };
    const v = 420 * S, life = Math.abs(toX - m.x) / v;
    pet.hd.flight = life;
    for (let i = 0; i < 5; i++) pet.stage.fx.add({ rect: i % 2 ? '#d8ecff' : '#5aa0f0', size: (S / 2) * size + (i === 0 ? S : 0), x: m.x - pet.facing * i * 3 * S, y: m.y, vx: pet.facing * v, life, fade: false });
    pet.stage.audio.sfx('throw');
  }
  if (pet.hd.from && once(pet, 'splash', pet.stateT > pet.dur * at + pet.hd.flight)) {
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

// 一段平均多長（秒；nextBout 算時間分配用，PR-N5）：dur 大多是 rnd(a, b)，亂數固定在 0.5 算出來的就是平均。
// 找夥伴的、先走過去才開始的（dur 很短）不知道多長：回傳 undefined，照生活表的估計
const meanCache = new Map();
export function habitMean(pet, name) {
  const h = HABITS[name];
  if (!h || h.social || h.dur == null) return undefined;
  if (!meanCache.has(name)) {
    let v = h.dur;
    if (typeof v === 'function') { const r = Math.random; Math.random = () => 0.5; try { v = h.dur(pet); } finally { Math.random = r; } }
    meanCache.set(name, v >= 1 ? v : undefined);
  }
  return meanCache.get(name);
}

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
    // 身體怎麼擺（像素木偶的參數，蓋過那一組動作的目標；彈簧會自己過渡）、播哪一組動作（PR-N4）
    puppet: (pet, k) => pet.habit?.puppet?.(pet, k),
    animSet: pet => (typeof pet.habit?.set === 'function' ? pet.habit.set(pet) : pet.habit?.set),
    alpha: pet => pet.habit?.alpha?.(pet) ?? 1,
    intangible: pet => pet.habit?.intangible?.(pet) ?? false,
    drawOver: (pet, ctx) => pet.habit?.drawOver?.(pet, ctx),
  },
};

