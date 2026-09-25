// 更多夥伴之間的互動（兩隻以上一起玩的遊戲、好朋友之間的親密動作、跌倒時的安慰）。
// behaviors.js 是基本的互動；這裡是需要比較多協調的：鬼抓人、排隊遊行、捉迷藏、大家一起合照…
import * as art from '../gfx/art.js';
import { blit } from '../gfx/pixel.js';
import { hearts } from '../../core/amie.js';
import { meet, WALK_SPEED, RUN_SPEED } from './behaviors.js';
import { startHabit } from './habits.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.floor(Math.random() * list.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.gy - b.gy);
const bond = (a, b, n) => a.stage.fire('bond', a, b, n);
const bondOf = (a, b) => a.stage.game?.bondOf(a.uid, b.uid) ?? 0;
const center = pet => { const r = pet.rect(); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
const valid = p => p && !p.leaving && p.state !== 'held' && p.state !== 'evolving';

// 一群一起玩的遊戲：group = { kind, members, ... }，每一隻的 pet.group 指向它
function endGroup(g, { happy = true } = {}) {
  if (g.over) return;
  g.over = true;
  for (const p of g.members) {
    if (p.group !== g) continue;
    p.group = null;
    p.partner = null;
    p.z = p.floats ? p.z : 0;
    if (!valid(p)) continue;
    if (happy) { p.set('happy', 0.6); p.showEmote(Math.random() < 0.5 ? '♪' : '♥', 1.2); }
    else p.set('idle', 1);
  }
  const m = g.members;
  for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) bond(m[i], m[j], happy ? 2 : 0);
}
// 群組裡有人被抓起來、離開就結束
function groupBroken(g) { return g.over || g.members.some(p => !valid(p) || p.group !== g); }

export const SOCIAL_ACTIONS = {
  // ---------- 鬼抓人 ----------
  // 當鬼的去追最近的，碰到就換人當鬼；換 4 次或時間到就結束
  oni: {
    update(pet, dt) {
      const g = pet.group, S = pet.S;
      if (!g || groupBroken(g)) { if (g) endGroup(g, { happy: false }); else pet.set('idle', 1); return; }
      if (pet !== g.members[0]) return; // 由第一隻統一推進
      g.t += dt;
      if (g.t > g.dur || g.catches >= 4) { endGroup(g); return; }
      const it = g.it;
      for (const p of g.members) {
        if (p.freezeT > 0) { p.freezeT -= dt; continue; }
        if (p === it) {
          const runners = g.members.filter(o => o !== it && o !== g.last);
          const target = runners.sort((a, b) => dist(a, it) - dist(b, it))[0] ?? g.members.find(o => o !== it);
          if (it.moveTo(target.x, target.gy, RUN_SPEED * S * 0.95, dt) || dist(it, target) < ((it.asset.w + target.asset.w) / 2) * S * 0.7) {
            // 抓到了：換人當鬼
            g.catches++;
            g.last = it;
            g.it = target;
            target.freezeT = 0.8;
            target.showEmote('!', 0.8);
            it.showEmote('♪', 0.8);
            pet.stage.fx.stars((it.x + target.x) / 2, Math.min(it.head().y, target.head().y), S, 4);
            pet.stage.audio.sfx('click');
          }
        } else {
          // 逃跑：遠離鬼，被逼到邊邊就往旁邊溜
          const dx = p.x - it.x, dy = p.gy - it.gy, d = Math.hypot(dx, dy) || 1;
          if (d > 360 * S) { p.facing = it.x > p.x ? 1 : -1; continue; } // 夠遠了，停下來看
          const b = p.bounds();
          let tx = p.x + (dx / d) * 80 * S, ty = p.gy + (dy / d) * 80 * S;
          if (tx < b.x0 || tx > b.x1) { tx = p.x; ty = p.gy + (ty > (b.y0 + b.y1) / 2 ? -1 : 1) * 80 * S; }
          if (ty < b.y0 || ty > b.y1) { ty = p.gy; tx = p.x + (tx > (b.x0 + b.x1) / 2 ? -1 : 1) * 80 * S; }
          p.moveTo(tx, ty, RUN_SPEED * S * 0.8, dt);
        }
      }
    },
    lift: pet => Math.round(Math.abs(Math.sin(pet.walkPhase)) * 3),
    pose(pet, p) { if (pet.group?.it === pet) p.rot = -pet.facing * 0.1; },
    drawOver(pet, ctx) {
      // 當鬼的頭上有個小驚嘆號
      const g = pet.group;
      if (g?.it !== pet || Math.floor(pet.t * 4) % 2) return;
      const e = art.emotes['💢'], h = pet.head();
      blit(ctx, e, h.x - (e.width * pet.S) / 2, h.y - (e.height + 3) * pet.S, pet.S);
    },
  },

  // ---------- 排隊遊行 ----------
  parade: {
    update(pet, dt) {
      const g = pet.group, S = pet.S;
      if (!g || groupBroken(g)) { if (g) endGroup(g, { happy: false }); else pet.set('idle', 1); return; }
      if (pet !== g.members[0]) return;
      g.t += dt;
      if (g.t > g.dur) { endGroup(g); return; }
      const [lead, ...rest] = g.members;
      if (lead.moveTo(g.wp.x, g.wp.y, WALK_SPEED * S * 1.1, dt)) g.wp = lead.randomPoint(120, 300);
      let prev = lead;
      for (const p of rest) {
        const gap = ((prev.asset.w + p.asset.w) / 2 + 3) * S;
        const tx = prev.x - prev.facing * gap;
        if (p.moveTo(tx, prev.gy, WALK_SPEED * S * 1.25, dt)) p.facing = prev.facing;
        prev = p;
      }
      if (g.music && Math.random() < dt * 0.8) pick(g.members).showEmote('♪', 1);
    },
    lift: pet => Math.round(Math.abs(Math.sin(pet.walkPhase)) * 2),
  },

  // ---------- 捉迷藏 ----------
  // 鬼先摀著眼睛數數，其他的跑去躲（變得半透明），鬼再一個一個找出來
  hideseek: {
    update(pet, dt) {
      const g = pet.group, S = pet.S;
      if (!g || groupBroken(g)) { if (g) endGroup(g, { happy: false }); else pet.set('idle', 1); return; }
      if (pet !== g.members[0]) return;
      g.t += dt;
      const seeker = g.seeker, hiders = g.members.filter(p => p !== seeker);
      if (g.phase === 'count') {
        if (Math.floor(g.t) !== g.lastCount) { g.lastCount = Math.floor(g.t); seeker.showEmote('…', 0.8); }
        for (const h of hiders) if (!h.hidden) { if (h.moveTo(h.spot.x, h.spot.y, RUN_SPEED * S * 0.7, dt)) h.hidden = true; }
        if (g.t > 4) { g.phase = 'seek'; seeker.showEmote('!', 0.8); g.t = 0; }
        return;
      }
      if (g.t > 20) { endGroup(g); return; }
      const left = hiders.filter(h => !h.found);
      if (!left.length) { endGroup(g); return; }
      // 先到處找找，再去最近的那一隻
      const target = left.sort((a, b) => dist(a, seeker) - dist(b, seeker))[0];
      if (!g.wander) g.wander = Math.random() < 0.5 ? seeker.randomPoint(80, 200) : { x: target.x, y: target.gy };
      const arrived = seeker.moveTo(g.wander.x, g.wander.y, WALK_SPEED * S * 1.3, dt);
      if (arrived) { seeker.showEmote('?', 0.8); g.wander = { x: target.x, y: target.gy }; }
      if (dist(seeker, target) < ((seeker.asset.w + target.asset.w) / 2 + 6) * S) {
        target.found = true;
        target.hidden = false;
        target.group = null;
        g.members = g.members.filter(p => p !== target); // 找到的就離開遊戲
        target.set('startle', 0.5);
        target.showEmote('!', 1);
        seeker.showEmote('♪', 0.8);
        g.wander = null;
        bond(seeker, target, 2);
      }
    },
    alpha: pet => (pet.hidden ? 0.4 : 1),
    pose(pet, p) {
      const g = pet.group;
      if (g?.phase === 'count' && g.seeker === pet) { p.sx = 1.06; p.sy = 0.9; } // 摀著眼睛蹲下來
      else if (pet.hidden) { p.sy = 0.85; p.sx = 1.05; }
    },
    lift: pet => (pet.hidden || pet.group?.phase === 'count' ? 0 : Math.round(Math.abs(Math.sin(pet.walkPhase)) * 2)),
  },

  // ---------- 大家一起合照 ----------
  photo: {
    update(pet, dt) {
      const g = pet.group, S = pet.S;
      if (!g || groupBroken(g)) { if (g) endGroup(g, { happy: false }); else pet.set('idle', 1); return; }
      if (pet !== g.members[0]) return;
      g.t += dt;
      let ready = true;
      g.members.forEach((p, i) => {
        const spot = g.spots[i];
        if (!p.moveTo(spot.x, spot.y, RUN_SPEED * S * 0.7, dt)) ready = false;
        else p.facing = spot.x < g.cx ? 1 : -1;
      });
      if ((ready || g.t > 8) && !g.flashAt) { g.flashAt = g.t + 1.2; for (const p of g.members) p.showEmote('♪', 1); }
      if (g.flashAt && g.t > g.flashAt && !g.flashed) {
        g.flashed = true;
        // 喀嚓！
        pet.stage.audio.sfx('click');
        const y = Math.min(...g.members.map(p => p.head().y));
        pet.stage.fx.ring(g.cx, y, S, '#ffffff', 90);
        for (const p of g.members) pet.stage.fx.sparkles(center(p).x, center(p).y, S, 3, 16);
      }
      if (g.flashed && g.t > g.flashAt + 1) endGroup(g);
    },
    pose(pet, p) { const g = pet.group; if (g?.flashAt && !g.flashed) { p.sy = 1.06; } },
    lift: pet => (pet.group?.flashAt ? 1 : Math.round(Math.abs(Math.sin(pet.walkPhase)) * 2)),
  },

  // ---------- 兩隻之間 ----------
  nuzzle: {
    update(pet, dt, done) {
      const o = pet.partner;
      if (!valid(o) || o.partner !== pet) { pet.partner = null; pet.set('idle', 1); return; }
      pet.facing = o.x > pet.x ? 1 : -1;
      if (Math.random() < dt * 3) pet.stage.fx.hearts((pet.x + o.x) / 2, Math.min(pet.head().y, o.head().y), pet.S, 1);
      if (done) {
        pet.partner = null;
        pet.set('happy', 0.6);
        pet.showEmote('♥', 1);
        if (pet.nuzzleLead) bond(pet, o, 3);
      }
    },
    pose(pet, p) { p.rot = pet.facing * (0.1 + Math.sin(pet.stateT * 6) * 0.06); p.ox = pet.facing * 1; },
    lift: () => 0,
  },
  stare: {
    // 瞪眼比賽：誰先眨眼（「…」）誰就輸了
    update(pet, dt, done) {
      const o = pet.partner, S = pet.S;
      if (!valid(o) || o.partner !== pet) { pet.partner = null; pet.set('idle', 1); return; }
      pet.facing = o.x > pet.x ? 1 : -1;
      if (pet.stareLead && Math.random() < dt * 12) {
        const a = pet.head(), b = o.head(), u = Math.random();
        pet.stage.fx.add({ rect: Math.random() < 0.5 ? '#fff27a' : '#ffffff', size: S / 2, x: a.x + (b.x - a.x) * u, y: a.y + 6 * S + (b.y - a.y) * u + (Math.random() - 0.5) * 4 * S, life: 0.12, fade: false });
      }
      if (done && pet.stareLead) {
        const [win, lose] = Math.random() < 0.5 ? [pet, o] : [o, pet];
        for (const p of [pet, o]) p.partner = null;
        lose.set('shiver', 0.8); lose.showEmote('…', 1.2);
        win.set('happy', 0.6); win.showEmote('♪', 1.2);
        bond(pet, o, 1);
      }
    },
    pose(pet, p) { p.sx = 1.03; p.sy = 0.96; p.rot = pet.facing * 0.05; },
    lift: () => 0,
  },
  share: {
    // 叼著泡芙拿去給肚子餓的夥伴（只是動作，不會用掉背包裡的泡芙）
    update(pet, dt) {
      const o = pet.partner, S = pet.S;
      if (!valid(o)) { pet.partner = null; pet.set('idle', 1); return; }
      const gap = ((o.asset.w + pet.asset.w) / 2 + 2) * S;
      if (pet.moveTo(o.x + (pet.x < o.x ? -gap : gap), o.gy, WALK_SPEED * S * 1.3, dt)) {
        pet.facing = o.x > pet.x ? 1 : -1;
        o.partner = null;
        pet.partner = null;
        o.facing = pet.x > o.x ? 1 : -1;
        o.startEat(pet.sharePuff);
        pet.set('happy', 0.6);
        pet.showEmote('♥', 1.2);
        bond(pet, o, 3);
      }
    },
    lift: pet => Math.round(Math.abs(Math.sin(pet.walkPhase)) * 2),
    drawOver(pet, ctx) {
      const r = pet.rect(), S = pet.S, img = art.puff(pet.sharePuff);
      blit(ctx, img, r.x + r.w * (pet.facing < 0 ? 0.2 : 0.8) - (img.width * S) / 2, r.y + r.h * 0.5, S);
    },
  },
  comfort: {
    // 看到好朋友跌倒或頭暈，跑過去看看
    update(pet, dt, done) {
      const o = pet.partner, S = pet.S;
      if (!valid(o) || done) { pet.partner = null; pet.set('idle', 1); return; }
      const gap = ((o.asset.w + pet.asset.w) / 2 + 2) * S;
      if (pet.moveTo(o.x + (pet.x < o.x ? -gap : gap), o.gy, RUN_SPEED * S * 0.7, dt)) {
        pet.facing = o.x > pet.x ? 1 : -1;
        pet.partner = null;
        pet.set('greet', 0.9);
        pet.showEmote('♥', 1.2);
        pet.stage.fx.hearts(o.head().x, o.head().y, S, 2);
        bond(pet, o, 2);
      }
    },
    lift: pet => Math.round(Math.abs(Math.sin(pet.walkPhase)) * 3),
  },
};

// ---------- 開始 ----------
function startGroup(kind, members, extra = {}) {
  const g = { kind, members, t: 0, over: false, ...extra };
  for (const p of members) { p.group = g; p.partner = null; p.set(kind, 60); }
  members[0].stage.markBusy(2);
  return g;
}

// 好朋友跌倒或頭暈時，附近感情好的夥伴會來安慰
export function maybeComfort(hurt) {
  const st = hurt.stage;
  const friends = [...st.pets.values()].filter(o => o !== hurt && o.free && !o.partner && !o.group && bondOf(o, hurt) >= 30 && dist(o, hurt) < 600 * o.S);
  if (!friends.length || Math.random() < 0.3) return;
  const f = friends.sort((a, b) => bondOf(b, hurt) - bondOf(a, hurt))[0];
  f.partner = hurt;
  f.showEmote('!', 0.8);
  f.set('comfort', 6);
}

// Pet.decide() 用：[名稱, 權重, 開始]
export function groupOptions(pet, others) {
  const list = [];
  const add = (name, w, start) => { if (w > 0) list.push([name, w, start]); };
  const st = pet.stage, S = pet.S, h = hearts(pet.mon.affection);
  const settings = st.game?.state.settings;
  const musicOn = settings && !settings.muted && settings.musicVolume > 0.05;
  const crew = others.filter(o => !o.group && dist(o, pet) < 900 * S);

  add('oni', crew.length >= 2 && h >= 1 ? 3 : 0, () => {
    const members = [pet, ...crew.slice(0, 4)];
    const g = startGroup('oni', members, { it: pet, catches: 0, dur: rnd(12, 18), last: null });
    pet.showEmote('💢', 1);
    for (const p of members.slice(1)) p.showEmote('!', 0.8);
    return g;
  });
  add('parade', crew.length >= 2 ? (musicOn ? 3 : 1.5) : 0, () => {
    const members = [pet, ...crew.slice(0, 5)];
    startGroup('parade', members, { dur: rnd(8, 14), wp: pet.randomPoint(150, 300), music: musicOn });
    pet.showEmote('♪', 1);
  });
  add('hideseek', crew.length >= 2 && h >= 1 ? 2 : 0, () => {
    const members = [pet, ...crew.slice(0, 3)];
    const g = startGroup('hideseek', members, { seeker: pet, phase: 'count', lastCount: -1 });
    for (const p of members.slice(1)) { p.spot = p.randomPoint(200, 500); p.hidden = false; p.found = false; }
    return g;
  });
  add('photo', crew.length >= 2 && st.pointer.known ? 1.5 : 0, () => {
    const members = [pet, ...crew.slice(0, 5)];
    // 排成一排，面向中間
    const cx = Math.max(200 * S, Math.min(st.W - 200 * S, st.W / 2 + rnd(-200, 200) * S));
    const y = st.H * rnd(0.55, 0.8);
    let total = members.reduce((s, p) => s + p.asset.w + 6, 0) * S, x = cx - total / 2;
    const spots = members.map(p => { const w = (p.asset.w + 6) * S; const spot = { x: x + w / 2, y: y + rnd(-4, 4) * S }; x += w; return spot; });
    startGroup('photo', members, { spots, cx });
    pet.showEmote('!', 0.8);
  });

  // 兩隻
  const close = others.filter(o => bondOf(pet, o) >= 30);
  add('nuzzle', close.length ? 6 : 0, () => {
    const o = pick(close);
    meet(pet, o, { gap: -3, then: (a, b) => {
      a.partner = b; b.partner = a;
      a.nuzzleLead = true; b.nuzzleLead = false;
      a.set('nuzzle', 2.2); b.set('nuzzle', 2.2);
    } });
  });
  // 感情很好、體型差很多：小的騎到大的背上
  const height = p => st.dex.get(p.mon.species).height;
  const mounts = others.filter(o => bondOf(pet, o) >= 100 && height(o) >= height(pet) * 2 && o.asset.w > pet.asset.w && !o.floats && !pet.floats);
  add('piggyback', mounts.length ? 5 : 0, () => {
    const o = pick(mounts);
    meet(pet, o, { gap: 0, then: (a, b) => {
      a.partner = null; b.partner = null;
      b.set('idle', 2);
      startHabit(a, 'ride', { on: b });
      a.dur = rnd(8, 14);
    } });
  });
  add('stare', others.length ? 2 : 0, () => {
    const same = others.filter(o => o.types.some(t => pet.types.includes(t)));
    const o = pick(same.length ? same : others);
    meet(pet, o, { gap: 18, then: (a, b) => {
      a.partner = b; b.partner = a;
      a.stareLead = true; b.stareLead = false;
      a.set('stare', 2.5); b.set('stare', 3);
      a.showEmote('💢', 1); b.showEmote('💢', 1);
    } });
  });
  const hungry = others.filter(o => o.mon.fullness < 90);
  add('share', h >= 3 && hungry.length ? 4 : 0, () => {
    const o = pick(hungry);
    pet.sharePuff = pick(['sweet', 'mint', 'citrus', 'mocha', 'spice']) + '-basic';
    pet.partner = o;
    o.partner = pet;
    o.set('wait', 12);
    pet.set('share', 12);
    pet.showEmote('!', 0.8);
  });
  return list;
}
