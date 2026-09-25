// 夥伴的生態動作與夥伴之間的互動。
// Pet 的狀態機遇到不認得的狀態時會查 ACTIONS：每個動作可以提供
//   update(pet, dt, done)  每一幀（done = 時間到了）
//   lift(pet, k)           上下位移（美術像素），k = 動作進度 0–1
//   pose(pet, p, k)        改變伸縮／旋轉（p 是 Pet.pose() 的結果）
//   alpha(pet)             透明度（鬼魂淡出、瞬間移動）
//   sink(pet)              鑽進地面的比例 0–1（挖洞）
//   intangible(pet)        這時候點不到牠
//   drawOver(pet, ctx)     額外畫的東西（丟球遊戲的球）
// soloOptions() / socialOptions() 列出「現在可以做什麼」與權重，Pet.decide() 從中抽一個。
import * as art from '../gfx/art.js';
import { blit } from '../gfx/pixel.js';
import { hearts } from '../../core/amie.js';

export const WALK_SPEED = 26; // 美術像素／秒
export const RUN_SPEED = 72;

const T = art.TYPE_COLORS;
const has = (pet, ...types) => pet.types.some(t => types.includes(t));
const rnd = (a, b) => a + Math.random() * (b - a);
const NOCTURNAL_IDS = new Set([714, 715]); // 嗡蝠、音波龍
const DIGGERS = new Set([659, 660]); // 掘掘兔、掘地兔

export function isNocturnal(pet) { return NOCTURNAL_IDS.has(pet.mon.species) || has(pet, 'ghost', 'dark'); }
function isNight(env) { const h = env.hour ?? 12; return h >= 20 || h < 6; }
function isDay(env) { const h = env.hour ?? 12; return h >= 7 && h < 17; }

// 同一條進化線（例如哈力栗和胖胖哈力）
function familyRoot(dex, id) {
  let s = dex.get(id);
  while (s?.evolvesFrom && dex.has(s.evolvesFrom)) s = dex.get(s.evolvesFrom);
  return s?.id ?? id;
}

function faceEachOther(a, b) { a.facing = b.x > a.x ? 1 : -1; b.facing = a.x > b.x ? 1 : -1; }
function release(a, b) { if (a.partner === b) a.partner = null; if (b?.partner === a) b.partner = null; }
function bond(a, b, n) { a.stage.fire('bond', a, b, n); }
function toIdle(pet, d = 1 + Math.random() * 2) { pet.set('idle', d); }
function center(pet) { const r = pet.rect(); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

// ---------- 走過去找對方 ----------
// 走到對方旁邊（gap = 兩隻之間留的空隙，美術像素）後呼叫 then(pet, other)。
// sneak：從背後偷偷靠近（對方不會停下來等）
export function meet(pet, other, { gap = 6, sneak = false, then, wait = true }) {
  pet.partner = other;
  pet.meet = { gap, sneak, then };
  pet.set('approach', 16);
  if (wait && !sneak) { other.partner = pet; other.set('wait', 17); }
}

export const ACTIONS = {
  approach: {
    update(pet, dt, done) {
      const o = pet.partner, m = pet.meet;
      if (!o || o.leaving || done || (m.sneak ? false : o.partner !== pet)) { if (o) release(pet, o); toIdle(pet); return; }
      const S = pet.S;
      const dist = ((o.asset.w + pet.asset.w) / 2 + m.gap) * S;
      // 偷偷靠近要繞到對方背後；一般的從現在這一側過去
      const side = m.sneak ? -o.facing : (Math.sign(pet.x - o.x) || 1);
      const b = pet.bounds();
      let tx = o.x + side * dist;
      if (tx < b.x0 || tx > b.x1) tx = o.x - side * dist;
      // 離很遠就用跑的（偷偷靠近的除外）
      const far = Math.hypot(tx - pet.x, o.gy - pet.gy) > 160 * S;
      const speed = m.sneak ? WALK_SPEED * S * 0.6 : far ? RUN_SPEED * S * 0.8 : WALK_SPEED * S * 1.2;
      if (pet.moveTo(tx, o.gy, speed, dt)) {
        pet.meet = null;
        if (!m.sneak) faceEachOther(pet, o);
        m.then(pet, o);
      }
    },
    alpha: pet => (pet.meet?.sneak ? 0.6 : 1),
    lift: pet => Math.round(Math.abs(Math.sin(pet.walkPhase)) * 2),
  },
  // 被找的那一隻停下來等
  wait: {
    update(pet, dt, done) {
      const o = pet.partner;
      if (!o || o.partner !== pet || o.leaving || done) { if (o?.partner !== pet) pet.partner = null; toIdle(pet); return; }
      pet.facing = o.x > pet.x ? 1 : -1;
    },
  },

  // ---------- 生態動作（一隻） ----------
  sunbathe: {
    update(pet, dt, done) {
      const S = pet.S, c = center(pet);
      if (Math.random() < dt * 3) pet.stage.fx.burst(c.x + rnd(-8, 8) * S, c.y, S, has(pet, 'fire') ? ['#ffd84a', '#ff9d3a'] : ['#9be15d', '#ffe98a'], { n: 1, speed: 12, g: -6, life: 1.4, wobble: true });
      if (done) { toIdle(pet); pet.showEmote('♪', 1.2); }
    },
    pose(pet, p) { p.sx = 1.05; p.sy = 0.94; p.rot = -pet.facing * 0.05; },
    lift: () => 0,
  },
  splash: {
    update(pet, dt, done) {
      const S = pet.S;
      pet.fxT = (pet.fxT ?? 0) - dt;
      if (pet.fxT <= 0) {
        pet.fxT = 0.3;
        pet.stage.fx.burst(pet.x, pet.gy - 2 * S, S, ['#8ec5ff', '#d8ecff', '#5aa0f0'], { n: 7, speed: 70, spread: 2.2, g: 220, life: 0.6 });
        pet.stage.audio.sfx('rustle');
      }
      if (done) toIdle(pet);
    },
    lift: (pet) => Math.round(Math.abs(Math.sin(pet.stateT * Math.PI / 0.3)) * 4),
  },
  ember: {
    update(pet, dt, done) {
      const S = pet.S, m = pet.mouth();
      if (pet.stateT > 0.3 && Math.random() < dt * 30) {
        pet.stage.fx.burst(m.x, m.y, S, ['#ff6a2a', '#ffb13a', '#ffe066'], { n: 1, speed: 80, dir: pet.facing > 0 ? 0 : Math.PI, spread: 0.5, g: -40, life: 0.5 });
      }
      if (done) toIdle(pet);
    },
    pose(pet, p, k) { p.rot = k < 0.25 ? pet.facing * 0.08 : -pet.facing * 0.06; },
  },
  spark: {
    update(pet, dt, done) {
      const S = pet.S, r = pet.rect();
      if (Math.random() < dt * 14) pet.stage.fx.burst(r.x + Math.random() * r.w, r.y + Math.random() * r.h, S, ['#fff27a', '#ffd84a', '#ffffff'], { n: 2, speed: 40, spread: 6.3, g: 0, life: 0.25 });
      if (done) { toIdle(pet); if (pet.stage.env.plugged) pet.showEmote('♪', 1); }
    },
    pose(pet, p) { p.ox = Math.floor(pet.stateT * 24) % 2 ? 1 : 0; },
  },
  chill: {
    update(pet, dt, done) {
      const S = pet.S, r = pet.rect();
      if (Math.random() < dt * 6) pet.stage.fx.burst(r.x + rnd(-0.3, 1.3) * r.w, r.y - 6 * S, S, ['#ffffff', '#d8f4ff'], { n: 1, speed: 8, dir: Math.PI / 2, spread: 0.6, g: 10, life: 2, wobble: true });
      if (done) toIdle(pet);
    },
  },
  bubbles: {
    update(pet, dt, done) {
      const S = pet.S, m = pet.mouth();
      if (Math.random() < dt * 5) pet.stage.fx.burst(m.x, m.y, S, ['#c070d0', '#e0a0f0'], { n: 1, speed: 14, spread: 1, g: -12, life: 1.6, size: S, wobble: true });
      if (done) toIdle(pet);
    },
  },
  fade: {
    update(pet, dt, done) {
      // 淡出到快看不見的時候偷偷換個位置
      if (!pet.faded && pet.stateT > pet.dur * 0.5) {
        pet.faded = true;
        const p = pet.randomPoint(30, 120);
        pet.x = p.x; pet.gy = p.y;
      }
      if (done) { pet.faded = false; toIdle(pet); }
    },
    alpha(pet) { const k = pet.stateT / pet.dur; return 1 - 0.8 * Math.sin(Math.min(1, k) * Math.PI); },
    intangible: pet => pet.stateT / pet.dur > 0.3 && pet.stateT / pet.dur < 0.7,
  },
  teleport: {
    update(pet, dt, done) {
      const S = pet.S;
      if (!pet.faded && pet.stateT > 0.3) {
        pet.faded = true;
        pet.stage.fx.ring(center(pet).x, center(pet).y, S, T.psychic, 26);
        const p = pet.randomPoint(150, 500);
        pet.x = p.x; pet.gy = p.y;
        pet.stage.fx.ring(center(pet).x, center(pet).y, S, T.psychic, 26);
        pet.stage.audio.sfx('sparkle');
      }
      if (done) { pet.faded = false; toIdle(pet); pet.showEmote('✦', 0.8); }
    },
    alpha: pet => (pet.stateT < 0.3 ? 1 - pet.stateT / 0.3 : Math.min(1, (pet.stateT - 0.3) / 0.3)),
    intangible: pet => pet.stateT < 0.5,
    pose(pet, p) { if (pet.stateT < 0.3) { p.sx = 1 - pet.stateT; p.sy = 1 + pet.stateT; } },
  },
  dig: {
    // 0–0.7 秒鑽下去、地底移動、最後 0.6 秒冒出來
    update(pet, dt, done) {
      const S = pet.S, t = pet.stateT;
      if (Math.random() < dt * (t < 0.7 || t > pet.dur - 0.6 ? 20 : 8)) {
        pet.stage.fx.burst(pet.x + rnd(-6, 6) * S, pet.gy - S, S, ['#9a6a3a', '#c8955a', '#6e4a28'], { n: 2, speed: 45, spread: 1.6, g: 200, life: 0.5 });
      }
      if (t > 0.7 && t < pet.dur - 0.6) pet.moveTo(pet.target.x, pet.target.y, RUN_SPEED * S * 1.2, dt);
      if (done) { toIdle(pet); pet.showEmote('!', 0.8); }
    },
    sink(pet) {
      const t = pet.stateT, end = pet.dur - 0.6;
      return t < 0.7 ? t / 0.7 : t < end ? 1 : Math.max(0, 1 - (t - end) / 0.6);
    },
    intangible: pet => ACTIONS.dig.sink(pet) > 0.5,
    lift: pet => (pet.stateT > pet.dur - 0.35 ? Math.round(Math.sin((pet.dur - pet.stateT) / 0.35 * Math.PI) * 5) : 0),
  },
  shine: {
    update(pet, dt, done) {
      const S = pet.S, r = pet.rect();
      if (Math.random() < dt * 5) pet.stage.fx.sparkles(r.x + Math.random() * r.w, r.y + Math.random() * r.h, S, 1, 2);
      if (done) toIdle(pet);
    },
    pose(pet, p) { p.sy = 1.04; },
  },
  forage: {
    update(pet, dt, done) {
      const S = pet.S;
      pet.moveTo(pet.target.x, pet.target.y, WALK_SPEED * S * 0.35, dt);
      if (Math.random() < dt * 3) pet.stage.fx.burst(pet.mouth().x, pet.gy - S, S, ['#8a7a4a', '#b8a06a'], { n: 1, speed: 20, spread: 2, g: 150, life: 0.4 });
      if (done) {
        toIdle(pet);
        if (Math.random() < 0.25) { pet.showEmote('!', 0.7); setTimeout(() => pet.showEmote('♪', 1), 700); }
      }
    },
    pose(pet, p) { p.rot = pet.facing * 0.16 + Math.sin(pet.stateT * 10) * 0.03; },
    lift: () => 0,
  },
  train: {
    update(pet, dt, done) {
      const S = pet.S;
      const beat = Math.floor(pet.stateT / 0.35);
      if (beat !== pet.beat) {
        pet.beat = beat;
        if (beat % 2 === 0) { const m = pet.mouth(); pet.stage.fx.burst(m.x + pet.facing * 8 * S, m.y, S, ['#ffffff', '#ffe066'], { n: 3, speed: 40, spread: 6.3, g: 0, life: 0.2 }); }
      }
      if (done) { pet.beat = null; toIdle(pet); }
    },
    pose(pet, p) { p.ox = pet.facing * (Math.floor(pet.stateT / 0.35) % 2 ? 3 : 0); p.rot = pet.facing * (Math.floor(pet.stateT / 0.35) % 2 ? 0.08 : 0); },
  },
  twirl: {
    update(pet, dt, done) {
      const S = pet.S, c = center(pet);
      pet.facing = Math.floor(pet.stateT / 0.12) % 2 ? 1 : -1;
      if (Math.random() < dt * 10) pet.stage.fx.burst(c.x + rnd(-10, 10) * S, c.y + rnd(-10, 10) * S, S, ['#ffb0d0', '#ffffff', '#ffd6ea'], { n: 1, speed: 10, g: -10, life: 1, wobble: true });
      if (done) { toIdle(pet); pet.showEmote('♥', 1); }
    },
    lift: (pet, k) => Math.round(Math.sin(k * Math.PI) * 5),
  },
  slime: {
    update(pet, dt, done) {
      const S = pet.S;
      if (pet.moveTo(pet.target.x, pet.target.y, WALK_SPEED * S * 0.5, dt) || done) { toIdle(pet); return; }
      if (Math.random() < dt * 5) pet.stage.fx.add({ rect: Math.random() < 0.5 ? '#b58ad8' : '#8a5ab8', size: S / 2, x: pet.x + rnd(-4, 4) * S, y: pet.gy - S, life: 5 });
    },
    pose(pet, p) { const s = Math.sin(pet.stateT * 6); p.sx = 1 + s * 0.06; p.sy = 1 - s * 0.06; },
    lift: () => 0,
  },
  soar: {
    // 會飛的：拉高後滑翔到遠方
    update(pet, dt, done) {
      const S = pet.S;
      const k = Math.min(1, pet.stateT / pet.dur);
      const maxZ = Math.max(0, (pet.gy - pet.asset.h * S) / S - pet.alt - 6);
      pet.z = Math.min(maxZ, Math.sin(k * Math.PI) * 55);
      pet.moveTo(pet.target.x, pet.target.y, RUN_SPEED * S * 0.8, dt);
      if (done) { pet.z = 0; toIdle(pet); }
    },
    pose(pet, p) { p.rot = -pet.facing * 0.12; },
  },
  nap: {
    update(pet, dt, done) {
      if (Math.floor(pet.t) % 3 === 0 && !pet.emote) pet.showEmote('Z', 1.2);
      if (done) { pet.set('stretch', 1.2); pet.showEmote('…', 1); }
    },
    pose(pet, p) { p.sx = 1.06; p.sy = 0.9 + Math.sin(pet.t * 1.6) * 0.02; },
    lift: () => 0,
    dark: true,
  },
  sniff: {
    update(pet, dt, done) {
      if (pet.stateT > 1 && !pet.sniffed) { pet.sniffed = true; pet.showEmote(Math.random() < 0.6 ? '♪' : '♥', 1.2); }
      if (done) { pet.sniffed = false; toIdle(pet); }
    },
    pose(pet, p) { p.rot = pet.facing * 0.14 + Math.sin(pet.stateT * 12) * 0.03; },
    lift: () => 0,
  },
  watch: {
    // 看別的夥伴吃泡芙（有點羨慕）
    update(pet, dt, done) {
      const o = pet.watching;
      if (o) pet.facing = o.x > pet.x ? 1 : -1;
      if (done || !o || o.leaving) { pet.watching = null; toIdle(pet); }
    },
  },
  cheer: {
    // 夥伴們替捕獲成功歡呼
    update(pet, dt, done) { if (done) toIdle(pet); },
    lift: pet => Math.round(Math.abs(Math.sin(pet.stateT * Math.PI / 0.35)) * 6),
  },

  // ---------- 兩隻一起 ----------
  toss: {
    // 兩隻互丟精靈球：每 0.9 秒一次，接球的跳一下
    update(pet, dt, done) {
      const o = pet.partner;
      if (!o || o.partner !== pet || o.leaving) { pet.partner = null; toIdle(pet); return; }
      faceEachOther(pet, o);
      if (pet.tossRole === 0) {
        const n = Math.floor(pet.stateT / 0.9);
        if (n !== pet.tossN) { pet.tossN = n; if (n > 0) pet.stage.audio.sfx('click'); }
      }
      if (done) {
        release(pet, o);
        pet.set('happy', 0.6);
        pet.showEmote('♪', 1.2);
        if (pet.tossRole === 0) bond(pet, o, 3);
      }
    },
    lift(pet) {
      const n = Math.floor(pet.stateT / 0.9), u = (pet.stateT % 0.9) / 0.9;
      const receiver = n % 2 === 0 ? 1 : 0;
      return pet.tossRole === receiver && u > 0.8 ? 3 : 0;
    },
    pose(pet, p) {
      const n = Math.floor(pet.stateT / 0.9), u = (pet.stateT % 0.9) / 0.9;
      const thrower = n % 2 === 0 ? 0 : 1;
      if (pet.tossRole === thrower && u < 0.15) p.rot = pet.facing * 0.12;
    },
    drawOver(pet, ctx) {
      const o = pet.partner;
      if (pet.tossRole !== 0 || !o || pet.stateT >= pet.dur) return;
      const S = pet.S, img = art.balls.poke;
      const n = Math.floor(pet.stateT / 0.9), u = (pet.stateT % 0.9) / 0.9;
      const [a, b] = n % 2 === 0 ? [pet, o] : [o, pet];
      const ha = center(a), hb = center(b);
      const x = ha.x + (hb.x - ha.x) * u, y = ha.y + (hb.y - ha.y) * u - Math.sin(u * Math.PI) * 30 * S;
      blit(ctx, img, x - (img.width * S) / 2, y - (img.height * S) / 2, S);
    },
  },
  spar: {
    // 玩打架：互相衝過去，碰到時冒星星
    update(pet, dt, done) {
      const o = pet.partner;
      if (!o || o.partner !== pet || o.leaving) { pet.partner = null; toIdle(pet); return; }
      faceEachOther(pet, o);
      const clash = Math.floor(pet.stateT / 0.8);
      if (pet.tossRole === 0 && clash !== pet.tossN && pet.stateT % 0.8 > 0.2) {
        pet.tossN = clash;
        const S = pet.S, a = center(pet), b = center(o);
        pet.stage.fx.burst((a.x + b.x) / 2, (a.y + b.y) / 2, S, ['#ffffff', '#ffe066'], { n: 5, speed: 60, spread: 6.3, g: 0, life: 0.25 });
        pet.stage.audio.sfx('land');
      }
      if (done) {
        release(pet, o);
        if (pet.tossRole === 0 && Math.random() < 0.3) { pet.set('dizzy', 1.2); pet.showEmote('@', 1.2); }
        else { pet.set('happy', 0.6); pet.showEmote('♪', 1); }
        if (pet.tossRole === 0) bond(pet, o, 2);
      }
    },
    pose(pet, p) {
      const phase = Math.max(0, Math.sin((pet.stateT / 0.8) * Math.PI * 2));
      p.ox = pet.facing * Math.round(phase * 6);
      p.rot = pet.facing * phase * 0.1;
    },
  },
  cast: {
    // 用自己屬性的招式「逗」對方：水槍、電擊、妖精的光…
    update(pet, dt, done) {
      const o = pet.partner, S = pet.S;
      if (!o || o.leaving) { pet.partner = null; toIdle(pet); return; }
      pet.facing = o.x > pet.x ? 1 : -1;
      if (pet.stateT > 0.2 && pet.stateT < 0.9 && Math.random() < dt * 30) {
        const m = pet.mouth(), c = center(o);
        const dx = c.x - m.x, dy = c.y - m.y, d = Math.hypot(dx, dy) || 1, v = 160 * S;
        pet.stage.fx.add({ rect: pet.castColor, size: S / 2 + (Math.random() < 0.3 ? S / 2 : 0), x: m.x, y: m.y, vx: (dx / d) * v, vy: (dy / d) * v, life: d / v, fade: false });
      }
      if (pet.stateT > 0.9 && !pet.castHit) { pet.castHit = true; react(pet, o); }
      if (done) { pet.castHit = false; pet.partner = null; toIdle(pet); bond(pet, o, 2); }
    },
    pose(pet, p) { p.rot = pet.stateT < 0.2 ? pet.facing * 0.1 : -pet.facing * 0.05; },
  },
  levitate: {
    // 被超能力抬起來
    update(pet, dt, done) {
      const S = pet.S, k = Math.min(1, pet.stateT / 0.4);
      const maxZ = Math.max(0, (pet.gy - pet.asset.h * S) / S - pet.alt - 6);
      pet.z = Math.min(maxZ, 18 * k + Math.sin(pet.stateT * 5) * 2);
      if (Math.random() < dt * 6) { const c = center(pet); pet.stage.fx.burst(c.x + rnd(-10, 10) * S, c.y + rnd(-10, 10) * S, S, T.psychic, { n: 1, speed: 6, g: -6, life: 0.6 }); }
      if (done) {
        if (pet.floats) { pet.z = 0; toIdle(pet); return; }
        pet.vx = pet.vy = pet.vz = 0;
        pet.set('fall');
      }
    },
    pose(pet, p) { p.rot = Math.sin(pet.stateT * 3) * 0.12; },
  },
  tag: {
    // 跟在同一條進化線的夥伴後面走
    update(pet, dt, done) {
      const o = pet.partner, S = pet.S;
      if (!o || o.leaving || done) { if (o) release(pet, o); toIdle(pet); return; }
      const gap = ((o.asset.w + pet.asset.w) / 2 + 4) * S;
      const arrived = pet.moveTo(o.x - o.facing * gap, o.gy + 2 * S, WALK_SPEED * S * 1.4, dt);
      if (arrived) pet.facing = o.facing;
    },
    lift: pet => Math.round(Math.abs(Math.sin(pet.walkPhase)) * 2),
  },
};

// 被招式打到的反應
function react(caster, target) {
  const S = caster.S, fx = caster.stage.fx, c = center(target);
  const kind = caster.castKind;
  const cheer = (emote = '♪') => { target.set('happy', 0.6); target.showEmote(emote, 1.4); };
  if (kind === 'water') {
    fx.burst(c.x, c.y, S, ['#8ec5ff', '#d8ecff'], { n: 8, speed: 60, spread: 6.3, g: 200, life: 0.5 });
    if (has(target, 'fire')) { target.set('shiver', 0.8); target.showEmote('💢', 1.4); fx.burst(c.x, c.y - 6 * S, S, ['#ffffff', '#e0e0e0'], { n: 6, speed: 20, g: -30, life: 1.2, wobble: true }); }
    else if (has(target, 'grass')) { cheer(); fx.sparkles(c.x, c.y, S, 4, 14); }
    else { target.set('shiver', 0.8); target.showEmote('…', 1.2); }
  } else if (kind === 'electric') {
    fx.burst(c.x, c.y, S, ['#fff27a', '#ffffff'], { n: 10, speed: 70, spread: 6.3, g: 0, life: 0.3 });
    if (has(target, 'electric')) cheer('✦');
    else { target.set('dizzy', 1.1); target.showEmote('@', 1.1); }
  } else if (kind === 'fairy') {
    fx.hearts(c.x, c.y - 10 * S, S, 3);
    cheer('♥');
  } else if (kind === 'psychic') {
    target.set('levitate', 1.8);
    target.showEmote('!', 1);
  } else if (kind === 'fire') {
    if (has(target, 'ice', 'grass')) { target.set('startle', 0.5); target.showEmote('💢', 1.2); }
    else cheer();
  } else if (kind === 'grass') {
    fx.burst(c.x, c.y - 10 * S, S, ['#78c850', '#a8e070'], { n: 6, speed: 20, g: 30, life: 1.4, wobble: true });
    cheer();
  } else if (kind === 'ice') {
    fx.burst(c.x, c.y - 10 * S, S, ['#ffffff', '#d8f4ff'], { n: 8, speed: 20, g: 20, life: 1.4, wobble: true });
    if (has(target, 'ice')) cheer(); else { target.set('shiver', 0.8); target.showEmote('…', 1); }
  }
}
const CAST_KINDS = ['water', 'electric', 'fairy', 'psychic', 'fire', 'grass', 'ice'];

// ---------- 可以做什麼（一隻） ----------
// 回傳 [名稱, 權重, 開始的函式]
export function soloOptions(pet) {
  const env = pet.stage.env, S = pet.S;
  const night = isNight(env), day = isDay(env), noct = isNocturnal(pet);
  const list = [];
  const add = (name, w, start) => { if (w > 0) list.push([name, w, start]); };
  const plain = (name, d) => () => pet.set(name, d);

  add('sunbathe', has(pet, 'grass', 'fire') && day ? 6 : 0, plain('sunbathe', rnd(5, 8)));
  add('splash', has(pet, 'water') ? 4 : 0, plain('splash', 1.2));
  add('ember', has(pet, 'fire') ? 3 : 0, plain('ember', 1.3));
  add('spark', has(pet, 'electric') ? (env.plugged ? 12 : 4) : 0, plain('spark', 1.4));
  add('chill', has(pet, 'ice') ? 4 : 0, plain('chill', 2.5));
  add('bubbles', has(pet, 'poison') ? 4 : 0, plain('bubbles', 2.5));
  add('fade', has(pet, 'ghost') ? (night ? 7 : 3) : 0, plain('fade', 3));
  add('teleport', has(pet, 'psychic') ? 3 : 0, plain('teleport', 0.9));
  add('dig', !pet.floats && (has(pet, 'ground') || DIGGERS.has(pet.mon.species)) ? 4 : 0, () => { pet.target = pet.randomPoint(100, 300); pet.set('dig', 3); });
  add('shine', has(pet, 'steel', 'rock') ? 3 : 0, plain('shine', 1.6));
  add('forage', !pet.floats && has(pet, 'bug', 'normal', 'ground', 'grass') ? 4 : 0, () => { pet.target = pet.randomPoint(15, 40); pet.set('forage', rnd(2.5, 4)); });
  add('train', has(pet, 'fighting') ? 6 : 0, plain('train', 2.1));
  add('twirl', has(pet, 'fairy') ? 4 : 0, plain('twirl', 1.2));
  add('slime', has(pet, 'dragon') && !pet.floats ? 4 : 0, () => { pet.target = pet.randomPoint(60, 180); pet.set('slime', 8); });
  add('soar', pet.floats ? (noct && night ? 6 : 3) : 0, () => { pet.target = pet.randomPoint(200, 500); pet.set('soar', rnd(2.8, 4)); });
  // 作息：白天活動的晚上容易打瞌睡，夜行性的白天容易打瞌睡
  add('nap', (night && !noct) || (day && noct) ? 8 : 1, plain('nap', rnd(8, 16)));
  // 桌面上有誘餌泡芙：跑過去聞一聞（肚子餓的更想去）
  if (env.lure) {
    add('sniff', pet.mon.fullness < 80 ? 12 : 4, () => {
      pet.target = { x: env.lure.x + (pet.x < env.lure.x ? -1 : 1) * (pet.asset.w / 2 + 6) * S, y: env.lure.y };
      pet.set('walk');
      pet.onArrive = () => { pet.facing = env.lure && env.lure.x > pet.x ? 1 : -1; pet.set('sniff', 2.4); };
    });
  }
  return list;
}

// ---------- 可以做什麼（兩隻） ----------
export function socialOptions(pet, others) {
  if (!others.length) return [];
  const dex = pet.stage.dex, game = pet.stage.game, env = pet.stage.env;
  const h = hearts(pet.mon.affection);
  // 感情越好越常找對方
  const pickBy = (cands, weightFn = () => 1) => {
    const ws = cands.map(o => weightFn(o) * (1 + (game?.bondOf(pet.uid, o.uid) ?? 0) / 40));
    let r = Math.random() * ws.reduce((a, b) => a + b, 0);
    return cands.find((o, i) => (r -= ws[i]) < 0) ?? cands[0];
  };
  const list = [];
  const add = (name, w, start) => { if (w > 0) list.push([name, w, start]); };
  const closeBy = others.filter(o => Math.hypot(o.x - pet.x, o.gy - pet.gy) < 700 * pet.S);
  const near = closeBy.length ? closeBy : others;

  add('greet', 3, () => {
    const o = pickBy(near);
    meet(pet, o, { gap: 4, then: (a, b) => {
      a.set('greet', 0.9); b.set('greet', 0.9);
      a.showEmote('♥', 1.2); b.showEmote('♪', 1.2);
      release(a, b); bond(a, b, 1);
    } });
  });
  add('toss', h >= 1 ? 4 : 0, () => {
    const o = pickBy(near);
    meet(pet, o, { gap: 40, then: (a, b) => {
      const d = 4 * 0.9 + 0.2;
      a.tossRole = 0; b.tossRole = 1; a.tossN = b.tossN = -1;
      a.partner = b; b.partner = a;
      a.set('toss', d); b.set('toss', d);
      a.stage.markBusy(d);
    } });
  });
  add('spar', has(pet, 'fighting') ? 6 : h >= 2 ? 2 : 0, () => {
    const o = pickBy(near, o => (has(o, 'fighting') ? 3 : 1));
    meet(pet, o, { gap: 2, then: (a, b) => {
      a.tossRole = 0; b.tossRole = 1; a.tossN = -1;
      a.partner = b; b.partner = a;
      a.set('spar', 2.4); b.set('spar', 2.4);
      a.showEmote('!', 0.7); b.showEmote('!', 0.7);
      a.stage.markBusy(2.4);
    } });
  });
  const castKind = CAST_KINDS.find(t => pet.types.includes(t));
  add('cast', castKind ? 4 : 0, () => {
    const o = pickBy(near);
    pet.castKind = castKind;
    pet.castColor = T[castKind];
    meet(pet, o, { gap: 36, then: (a, b) => { a.set('cast', 1.5); a.partner = b; b.partner = null; if (b.state === 'wait') b.set('idle', 2); a.stage.markBusy(1.6); } });
  });
  // 惡作劇：惡和幽靈屬性會從背後偷偷靠近嚇對方
  add('prank', has(pet, 'dark', 'ghost') ? 4 : 0, () => {
    const o = pickBy(near);
    meet(pet, o, { gap: 2, sneak: true, then: (a, b) => {
      a.partner = null;
      if (!b.free) { toIdle(a); return; }
      b.facing = a.x > b.x ? 1 : -1;
      b.set('startle', 0.5); b.showEmote('!', 1);
      a.set('happy', 0.6); a.showEmote('♪', 1.2);
      bond(a, b, 1);
    } });
  });
  // 同一條進化線：小的跟在大的後面走
  const root = familyRoot(dex, pet.mon.species);
  const fam = others.filter(o => o.mon.species !== pet.mon.species && familyRoot(dex, o.mon.species) === root);
  add('tag', fam.length ? 10 : 0, () => {
    const o = pickBy(fam);
    const [small, big] = dex.stage(pet.mon.species) <= dex.stage(o.mon.species) ? [pet, o] : [o, pet];
    small.partner = big; big.partner = small;
    big.target = big.randomPoint(150, 400);
    big.set('walk');
    small.set('tag', rnd(6, 10));
    small.showEmote('♥', 1.2);
    bond(small, big, 2);
  });
  // 同一種：一起跳舞
  const twins = others.filter(o => o.mon.species === pet.mon.species);
  add('mirror', twins.length ? 6 : 0, () => {
    const o = pickBy(twins);
    meet(pet, o, { gap: 10, then: (a, b) => {
      const d = rnd(3, 5);
      release(a, b);
      a.set('dance', d); b.set('dance', d);
      a.showEmote('♪', 1); b.showEmote('♪', 1);
      bond(a, b, 2);
    } });
  });
  // 晚上想睡的：靠過去跟其他夥伴擠在一起睡（火屬性的比較溫暖）
  const sleepers = [...pet.stage.pets.values()].filter(o => o !== pet && !o.leaving && (o.state === 'sleep' || o.state === 'nap'));
  add('cuddle', (env.sleepy || isNight(env)) && sleepers.length ? 12 : 0, () => {
    const o = pickBy(sleepers, o => (has(o, 'fire') ? 3 : 1));
    meet(pet, o, { gap: 0, wait: false, then: (a, b) => {
      a.partner = null;
      a.facing = b.x > a.x ? 1 : -1;
      a.set(env.sleepy ? 'sleep' : 'nap', rnd(10, 20));
      a.showEmote('♥', 1);
      bond(a, b, 1);
    } });
  });
  return list;
}

// 有人在吃泡芙：附近閒著的夥伴會過來看
export function watchEating(eater) {
  const S = eater.S;
  for (const o of eater.stage.pets.values()) {
    if (o === eater || !o.free || o.partner) continue;
    if (Math.hypot(o.x - eater.x, o.gy - eater.gy) > 320 * S || Math.random() < 0.3) continue;
    o.watching = eater;
    o.set('watch', 2.6);
    o.showEmote(Math.random() < 0.5 ? '…' : '♪', 1.2);
  }
}
