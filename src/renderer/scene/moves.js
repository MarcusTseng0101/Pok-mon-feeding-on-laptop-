// 招式動作：夥伴會自己練習招式、跟其他夥伴切磋，也可以從對話框叫牠使出招式。
// 只有演出，沒有傷害或對戰規則；屬性相剋只用來顯示「效果絕佳！」之類的字。
//
// 每一招有自己的演出（CHOREO，放在 choreo/<屬性>.js）：自己的時間表和畫法。流星群還是走這裡的 meteor（本來就獨一無二）。
// kind 欄位（projectile 發射物、beam 光束、contact 衝撞、line 伸過去、area 擴散、rain 從天上落、self 替自己、portal 在目標那裡、meteor）
// 不再決定演出，但還在用：打中的擊退力道、放招時要不要變暗（movefx.dimFor）、movefx.cjs 的檢查都看它。
// big／heavy／jump／trail／soft 也還在用（變暗的程度、打中的手感）
import * as art from '../gfx/art.js';
import { meet } from './behaviors.js';
import { knockFrom, knock } from './physics.js';
import { duelHitChance } from '../../core/minigames.js';
import { transform, endDuelForms } from './battleforms.js';
import * as FX from './movefx.js';
import { MOVES, movesetFor, battleMovesFor } from '../../core/moves.js';
import { effectiveness } from '../../core/types.js';
import { CHOREO } from './choreo/index.js';

const T = art.TYPE_COLORS;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.floor(Math.random() * list.length)];

// 招式資料和每種寶可夢會用的招式搬到 core/moves.js（手機遊戲也用）；這裡照舊匯出，其他檔案不用改
export { MOVES, movesetFor, battleMovesFor };

export { effectiveness }; // 屬性相剋表在 core/types.js（故事裡的對戰也用）
export { CHOREO };

// ---------- 使出招式 ----------
const center = pet => { const r = pet.rect(); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
const isPet = t => t && typeof t.rect === 'function';
const targetPoint = t => (isPet(t) ? center(t) : t);

// 招式的時間軸（秒）：hit = 打中的時間點
function timeline(def, pet, target, ch = null) {
  const a = pet.mouth(), b = targetPoint(target);
  if (ch) return ch.time(pet, a, b);
  if (def.kind === 'meteor') return { dur: 2.6, hit: null }; // 第一顆流星落地才算打中
  return { dur: 1, hit: 0.5 }; // 保險：沒有自己演出的招（現在沒有）至少會打中、會結束
}

// target：另一隻夥伴、野生寶可夢，或是 {x, y}。onHit(effectiveness) 在打中時呼叫，onEnd 在結束時呼叫
export function useMove(pet, moveId, target, { onHit, onEnd, announce = true } = {}) {
  const def = MOVES[moveId];
  if (!def) return false;
  const ch = CHOREO[moveId] ?? null;
  const tl = timeline(def, pet, target, ch);
  pet.moveCtx = { id: moveId, def, ch, target, tl, onHit, onEnd, hitDone: false, from: { x: pet.x, gy: pet.gy } };
  const p = targetPoint(target);
  if (Math.abs(p.x - pet.x) > pet.S) pet.facing = p.x > pet.x ? 1 : -1;
  pet.set('move', tl.dur);
  if (announce) {
    const h = pet.head();
    pet.stage.fx.text(h.x, h.y - 8 * pet.S, `${def.zh}！`, pet.S, lighten(T[def.type]));
  }
  pet.stage.markBusy(tl.dur + 0.5);
  return true;
}

// 往前方練習用的目標點
export function practicePoint(pet) {
  const b = pet.bounds(), S = pet.S;
  const x = Math.max(b.x0, Math.min(b.x1, pet.x + pet.facing * rnd(90, 150) * S));
  return { x, y: pet.gy - (pet.asset.h * S) / 2 };
}

// 招式名稱用淡一點的屬性色，深色的桌布上也看得清楚
function lighten(hex, k = 0.45) {
  const n = parseInt(hex.slice(1), 16);
  const ch = s => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function burst(pet, x, y, colors, opts) { pet.stage.fx.burst(x, y, pet.S, colors, opts); }

// 打中（原作風格：打擊火花、衝擊波、屬性碎片、頓一下、畫面震一下；效果絕佳更誇張）
function impact(pet, def, at, eff = 1) {
  const c = [T[def.type], '#ffffff'];
  burst(pet, at.x, at.y, c, { n: def.big ? 14 : 8, speed: def.big ? 80 : 55, spread: 6.3, g: 60, life: 0.5 });
  FX.impactFx(pet.stage, def, at.x, at.y, eff, { contact: def.kind === 'contact' });
  pet.stage.audio.sfx(def.kind === 'contact' ? 'land' : 'hit');
}

function hit(pet) {
  const m = pet.moveCtx;
  if (m.hitDone) return;
  m.hitDone = true;
  const at = targetPoint(m.target);
  const eff = isPet(m.target) ? effectiveness(m.def.type, m.target.types) : 1;
  if (m.ch?.impact) {
    // 有自己演出的招：打中的樣子自己畫，頓一下、震一下、音效跟大家一樣
    m.ch.impact(pet, m, at, eff, KIT);
    FX.hitFeel(pet.stage, m.def, eff, { contact: m.def.kind === 'contact' });
    pet.stage.audio.sfx(m.def.kind === 'contact' ? 'land' : 'hit');
  } else impact(pet, m.def, at, eff);
  if (isPet(m.target)) m.target.flinchT = 0.4;
  // 擊退：衝撞最大力，擴散的會把旁邊的也一起推開；效果絕佳更遠、沒有效果不會動
  const power = ({ contact: 320, projectile: 220, beam: 200, line: 160, rain: 150, portal: 180, area: 260, meteor: 240 }[m.def.kind] ?? 0) * (m.ch?.knock ?? 1); // 有自己演出的招可以設 knock（蹭蹭臉頰＝0，不推開）
  const mult = (m.def.big || m.def.heavy ? 1.3 : 1) * (eff > 1 ? 1.5 : eff < 1 ? (eff === 0 ? 0 : 0.6) : 1);
  if (m.def.kind === 'area') {
    const S = pet.S, r = (m.def.big ? 110 : 75) * S;
    for (const o of pet.stage.pets.values()) {
      if (o === pet) continue;
      const d = Math.hypot(o.x - pet.x, o.gy - pet.gy);
      if (d < r) knockFrom(o, pet.x, pet.gy, power * (1 - d / r * 0.5) * (o === m.target ? mult : 1));
    }
    if (isPet(m.target) && m.target.guest) knockFrom(m.target, pet.x, pet.gy, power * mult); // 故事對戰的對手不在夥伴名單裡
  } else if (isPet(m.target) && power) {
    knockFrom(m.target, pet.x, pet.gy, power * mult);
  }
  m.onHit?.(eff);
}

// 衝過去再回來（跟 contact 一樣只加位移的變化量）：k 從 0（原地）到 1（貼著目標）
function dash(pet, m, k) {
  const back = m.from, to = targetPoint(m.target), S = pet.S;
  const reach = isPet(m.target) ? ((m.target.asset.w + pet.asset.w) / 2) * S * 0.8 : 0;
  const dir = to.x > back.x ? 1 : -1;
  const tx = to.x - dir * reach, tgy = isPet(m.target) ? m.target.gy : back.gy;
  const ox = (tx - back.x) * k, oy = (tgy - back.gy) * k;
  const off = (m.off ??= { x: 0, y: 0 });
  pet.x += ox - off.x;
  pet.gy += oy - off.y;
  off.x = ox;
  off.y = oy;
}

// 給 choreo/*.js 用的工具（用參數傳過去，choreo 不 import moves.js，避免互相 import）
const KIT = { hit, center, targetPoint, isPet, dash, rnd, pick };

// 放招的一開始：兩隻周圍的桌面變暗（照原作：大招會換背景）
function startDim(pet, m) {
  const def = m.def, level = FX.dimFor(def);
  if (!level) return;
  const S = pet.S, a = center(pet), b = targetPoint(m.target);
  const self = (def.kind === 'self' || def.kind === 'area') && m.ch?.dimAt !== 'between'; // 有自己演出的擴散招可以把變暗放在兩隻中間（動作在中間發生）
  const x = self ? a.x : (a.x + b.x) / 2, y = self ? a.y : (a.y + b.y) / 2;
  const half = self ? 0 : Math.hypot(b.x - a.x, b.y - a.y) / 2;
  const rx = Math.max(110 * S, half + 90 * S) * (def.kind === 'meteor' ? 1.2 : 1);
  const fadeIn = 0.25, fadeOut = 0.3;
  FX.dim(pet.stage, { x, y, rx, ry: rx * (def.kind === 'meteor' ? 0.6 : 0.5), level, fadeIn, fadeOut, hold: Math.max(0.2, m.tl.dur - fadeIn - 0.15), type: def.type, stars: def.kind === 'meteor' });
}

// 流星群：一顆一顆落下來（每顆落地都爆炸；第一顆算「打中」）
const METEOR = ['#ff7a2a', '#ffd25a', '#ff3a1a'];
function dropMeteors(pet, m) {
  const S = pet.S, st = pet.stage, to = targetPoint(m.target);
  const gy = isPet(m.target) ? m.target.gy : to.y + 20 * S;
  [[-20, 0], [24, -3], [-2, 2], [40, 4], [-34, 3], [10, -1]].forEach(([ox, oy], i) => {
    const tx = to.x + ox * S, ty = gy + oy * S;
    FX.falling(st, {
      x0: tx - 150 * S * (Math.random() < 0.5 ? 1 : 0.8), y0: -30 * S, tx, ty, life: 0.42, cols: METEOR, size: 6, tail: 90, delay: i * 0.13,
      onLand: (x, y) => {
        FX.landing(st, x, y, METEOR);
        st.shake(5, 0.28);
        st.hitStop(0.03);
        st.audio.sfx('land');
        if (!pet.moveCtx || pet.moveCtx !== m) return;
        if (!m.hitDone) hit(pet);
        else if (isPet(m.target)) { knockFrom(m.target, x, y, 90); m.target.flinchT = 0.2; }
      },
    });
  });
}

export const MOVE_ACTIONS = {
  move: {
    update(pet, dt, done) {
      const m = pet.moveCtx;
      if (!m) { pet.set('idle', 1); return; }
      const t = pet.stateT, def = m.def, S = pet.S, st = pet.stage;
      const from = pet.mouth(), to = targetPoint(m.target);
      if (isPet(m.target) && m.target.leaving) m.target = to;
      if (!m.started) { m.started = true; startDim(pet, m); }
      if (m.ch) {
        m.ch.update(pet, m, t, dt, KIT);
        if (m.tl.hit != null && t > m.tl.hit) hit(pet); // 保險：演出沒呼叫到也要算打中（hit 只會算一次）
      } else if (def.kind === 'meteor') {
        // 流星群：全身發出橘光 → 朝天空射出光球 → 6 顆流星錯開落下
        const cc = center(pet);
        if (t > 0.05 && t < 0.72) {
          m.auraT = (m.auraT ?? 0) - dt;
          if (m.auraT <= 0) {
            m.auraT = 0.05;
            FX.blob(st, { x: cc.x, y: cc.y, s0: pet.asset.w * 1.4, s1: pet.asset.w * 1.8, a0: 0.45, a1: 0, life: 0.2, col: METEOR[0] });
            FX.blob(st, { x: cc.x + rnd(-0.5, 0.5) * pet.asset.w * S, y: pet.gy - rnd(0, pet.asset.h) * S, vy: -rnd(60, 120) * S, s0: 6, s1: 2, a0: 1, a1: 0, life: 0.5, col: pick(METEOR) });
          }
        }
        if (t > 0.62 && !m.launched) {
          m.launched = true;
          FX.projectile(st, from, { x: from.x + pet.facing * 20 * S, y: -40 * S }, 0.38, METEOR, { big: true });
          st.shake(2, 0.12);
          st.audio.sfx('hit');
        }
        if (t > 1.0 && !m.dropped) { m.dropped = true; dropMeteors(pet, m); }
        if (t > 2.0 && !m.hitDone) hit(pet); // 保險：流星沒落地（例如特效被清掉）也要算打中
      } else if (t > m.tl.hit) hit(pet); // 保險：沒有自己演出的招（現在沒有）
      if (done) {
        pet.z = 0;
        pet.moveAlpha = 1;
        if (m.off) { pet.x -= m.off.x; pet.gy -= m.off.y; } // 收回還沒走完的衝刺位移（只有衝刺的招會有 off）
        pet.clamp();
        const end = m.onEnd;
        pet.moveCtx = null;
        if (end) end(); else pet.set('idle', rnd(1, 2));
      }
    },
    pose(pet, p, k) {
      const m = pet.moveCtx;
      if (!m) return;
      const t = pet.stateT;
      if (m.ch) { m.ch.pose?.(pet, p, m, t); return; }
      if (m.def.kind === 'meteor') { if (t < 0.62) { p.sx = 1.04; p.sy = 1.04; } else if (t < 0.9) p.rot = -pet.facing * 0.15; }
    },
    lift: () => 0,
    alpha: pet => pet.moveAlpha ?? 1,
    drawOver(pet, ctx) {
      const m = pet.moveCtx;
      if (m?.ch) m.ch.draw?.(ctx, pet, m, pet.stateT, KIT);
    },
  },
  // 故事裡的對戰（scene/battle.js）：走到自己的位置、面向對手，等輪到自己
  battle: {
    update(pet, dt) {
      const b = pet.battleSpot;
      if (!b) { pet.set('idle', 1); return; }
      if (pet.moveTo(b.x, b.y, 160 * pet.S, dt)) pet.facing = b.face;
    },
    lift: pet => (pet.floats ? Math.round(Math.sin(pet.t * 2) * 2) : Math.floor(pet.t * 2.4) % 2),
  },
  // 倒下了：往旁邊倒、慢慢變淡（對手倒下後會消失；你的夥伴對戰結束後站起來）
  faint: {
    update(pet) { if (pet.guest) pet.alpha = Math.max(0, 1 - pet.stateT / 0.9); },
    pose(pet, p) { p.rot = -pet.facing * (Math.PI / 2) * Math.min(1, pet.stateT / 0.25); p.pivot = 'center'; },
    lift: () => 0,
  },
  // 切磋中沒輪到的一方：看著對方
  duel: {
    update(pet, dt, done) {
      const d = pet.duel;
      if (!d || d.over || done) { endDuel(d, pet); return; }
      const o = d.a === pet ? d.b : d.a;
      if (!o || o.leaving || o.state === 'held' || (o.state !== 'duel' && o.state !== 'move')) { endDuel(d, pet); return; }
      pet.facing = o.x > pet.x ? 1 : -1;
      // 兩隻都在等的時候，倒數完換下一招
      if (pet === d.a && o.state === 'duel') {
        d.cool -= dt;
        if (d.cool <= 0) nextTurn(d);
      }
    },
    lift: pet => Math.floor(pet.t * 3) % 2,
  },
};

// ---------- 切磋 ----------
const EFF_TEXT = eff => (eff === 0 ? ['好像沒有效果…', '#b8b8c8'] : eff > 1 ? ['效果絕佳！', '#ffb13a'] : eff < 1 ? ['效果不太好…', '#8ec5ff'] : null);

function react(defender, eff) {
  const t = EFF_TEXT(eff), h = defender.head(), S = defender.S;
  if (t) defender.stage.fx.text(h.x, h.y - 18 * S, t[0], S, t[1]);
  defender.showEmote(eff === 0 ? '?' : eff > 1 ? '@' : '!', 0.9);
}

function startDuel(a, b) {
  const d = { a, b, turn: 0, turns: 4, over: false, cool: 0.5, hits: new Map() }; // hits：打中的效果加總（決定輸贏）
  a.duel = b.duel = d;
  a.partner = b; b.partner = a;
  a.set('duel', 30); b.set('duel', 30);
  a.showEmote('!', 0.8); b.showEmote('!', 0.8);
  // 拿到進化石的蒂安希：對戰一開始就超級進化（跟原作一樣），對戰結束變回來
  for (const p of [a, b]) if (!p.battleForm && p.stage.game.canMega(p.uid)) { transform(p, 'mega', { duel: true }); d.cool = 1.8; }
}

// 牽絆變身：甲賀忍蛙的招式打中對手時，有機會跟牠的羈絆共鳴（一場對戰最多判定一次）
const BOND_CHANCE = 1 / 3; // 猜的，可調整
function maybeBondForm(d, atk, eff) {
  if (d.bondTried?.has(atk) || eff === 0 || atk.battleForm || !atk.stage.game.canBondForm(atk.uid)) return;
  (d.bondTried ??= new Set()).add(atk);
  if (Math.random() < BOND_CHANCE) transform(atk, 'ash', { duel: true });
}

function nextTurn(d) {
  if (d.over) return;
  if (d.turn >= d.turns) { finishDuel(d); return; }
  const atk = d.turn % 2 ? d.b : d.a, def = atk === d.a ? d.b : d.a;
  if (atk.state !== 'duel' || def.state !== 'duel') { endDuel(d); return; }
  d.turn++;
  const moves = movesetFor(atk.stage.dex, atk.mon.species, atk.mon);
  // 超級特訓的成果：訓練得比對方多，比較容易打中（最多 ±15%）
  if (Math.random() > duelHitChance(atk.mon.training, def.mon.training)) {
    const S = def.S, side = Math.random() < 0.5 ? -1 : 1;
    def.hopT = 0.35;
    knock(def, side * 220 * S, 0);
    def.stage.fx.text(def.head().x, def.head().y - 18 * S, '躲開了！', S, '#8ec5ff');
    useMove(atk, pick(moves), { x: def.x - side * 30 * S, y: def.gy - (def.asset.h * S) / 2 }, { // 打到剛剛站的地方旁邊
      onEnd: () => { if (d.over) { atk.set('idle', 1); return; } atk.set('duel', 30); d.cool = 0.45; },
    });
    return;
  }
  useMove(atk, pick(moves), def, {
    onHit: eff => { react(def, eff); maybeBondForm(d, atk, eff); d.hits.set(atk, (d.hits.get(atk) ?? 0) + eff); },
    onEnd: () => { if (d.over) { atk.set('idle', 1); return; } atk.set('duel', 30); d.cool = 0.45; },
  });
}

function finishDuel(d) {
  d.over = true;
  // 打中比較多（效果加總比較高）的贏；一樣就是平手
  const ha = d.hits.get(d.a) ?? 0, hb = d.hits.get(d.b) ?? 0;
  const winner = ha > hb ? d.a : hb > ha ? d.b : null;
  const loser = winner && (winner === d.a ? d.b : d.a);
  for (const p of [d.a, d.b]) {
    p.duel = null; p.partner = null;
    if (p.state !== 'duel') continue;
    if (p === loser) { p.set('sit', 1.2); p.showEmote('…', 1.4); } else { p.set('happy', 0.6); p.showEmote('♪', 1.2); }
  }
  if (winner) d.a.stage.fire('duelResult', winner, loser);
  d.a.stage.fx.hearts((d.a.x + d.b.x) / 2, Math.min(d.a.head().y, d.b.head().y), d.a.S, 3);
  d.a.stage.fire('bond', d.a, d.b, 3);
  endDuelForms(d.a, d.b);
}

function endDuel(d, pet) {
  if (d) {
    d.over = true;
    for (const p of [d.a, d.b]) { p.duel = null; if (p.partner === d.a || p.partner === d.b) p.partner = null; if (p.state === 'duel') p.set('idle', 1); }
    endDuelForms(d.a, d.b);
  } else if (pet) { pet.duel = null; pet.set('idle', 1); endDuelForms(pet); }
}

// Pet.decide() 用
export function moveOptions(pet, others) {
  if (pet.stage.battle) return []; // 故事的對戰進行中：旁邊的夥伴不自己練招、不切磋
  const h = pet.mon.affection;
  const list = [
    ['practice', 4, () => useMove(pet, pick(movesetFor(pet.stage.dex, pet.mon.species, pet.mon)), practicePoint(pet))],
  ];
  if (others.length && h >= 50) {
    list.push(['duel', 4, () => {
      const o = pick(others);
      meet(pet, o, { gap: 46, then: (a, b) => startDuel(a, b) });
    }]);
  }
  return list;
}

