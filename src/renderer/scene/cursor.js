// 滑鼠變成玩具：撲過去、追著跑、坐在游標旁邊（游標一動就嚇一跳跑開）。
//
// 最重要的一條：這些動作只「讀」游標位置，永遠不會讓視窗攔截滑鼠。
// 寶可夢只要停在游標正下方，stage.wantsMouse() 就會變成 true、把你的點擊吃掉，
// 所以牠們一律停在游標「旁邊」（身體的範圍不會蓋到游標）。
import { WALK_SPEED, RUN_SPEED } from './behaviors.js';
import { hearts } from '../../core/amie.js';
import { traitsOf } from '../../core/mind.js';

export const POUNCE_SPEED = 800; // 游標晃得比這快（CSS 像素／秒）才會撲
export const SIT_AFTER = 8; // 游標停幾秒以後會過去坐
const rnd = (a, b) => a + Math.random() * (b - a);

// 游標旁邊的位置：腳在游標下面一點，身體在游標左邊或右邊，不會蓋住游標
export function besideCursor(pet, side = null) {
  const p = pet.stage.pointer, S = pet.S, b = pet.bounds();
  const off = (pet.asset.w / 2 + 10) * S;
  let s = side ?? (pet.x < p.x ? -1 : 1);
  let x = p.x + s * off;
  if (x < b.x0 || x > b.x1) { s = -s; x = p.x + s * off; } // 靠到螢幕邊邊：換另一邊
  const y = Math.max(b.y0, Math.min(b.y1, p.y + 14 * S));
  return { x: Math.max(b.x0, Math.min(b.x1, x)), y, side: s };
}

// 游標有沒有在牠身上（測試和保險用：坐下、落地前會再確認一次）
export function coversCursor(pet) {
  const p = pet.stage.pointer, r = pet.rect();
  return p.known && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

const pointerCss = st => ({ speed: (st.pointerSpeed?.() ?? 0) / st.dpr });

// 游標在附近快速晃動：不膽小、有一點感情的會撲過去（Pet.update 每幀問一次）
export function wantsToPounce(pet, dt) {
  const st = pet.stage, p = st.pointer;
  if (!p.known || !st.env.userActive || !pet.free || pet.perch || pet.partner || pet.group) return false;
  if (hearts(pet.mon.affection) < 1 || traitsOf(pet.mon.nature).timid >= 0.7) return false;
  const d = Math.hypot(p.x - pet.x, p.y - pet.gy) / st.dpr;
  if (d > 360 || pointerCss(st).speed < POUNCE_SPEED) return false;
  return Math.random() < dt * 2.5;
}

export function startPounce(pet) {
  pet.pounce = { from: null, to: null };
  pet.facing = pet.stage.pointer.x > pet.x ? 1 : -1;
  pet.set('pounce', 1.1);
  pet.showEmote('!', 0.6);
}

// 滑鼠相關的選項（Pet.decide() 用；類別都是 cursor）
export function cursorOptions(pet) {
  const st = pet.stage, p = st.pointer, h = hearts(pet.mon.affection);
  if (!p.known || !st.env.userActive || pet.perch) return [];
  return [
    ['chaseCursor', h >= 1 ? 4 : 0, () => pet.set('chaseCursor', rnd(3, 6))],
    ['cursorSit', st.pointerStill > SIT_AFTER ? 8 : 0, () => { pet.cursorSit = { seated: false, side: null }; pet.set('cursorSit', 25); }],
  ];
}

export const CURSOR_ACTIONS = {
  // 撲：先壓低身體瞄準（0.45 秒），再跳到游標旁邊
  pounce: {
    update(pet, dt, done) {
      const S = pet.S, d = pet.pounce;
      if (pet.stateT < 0.45) { pet.facing = pet.stage.pointer.x > pet.x ? 1 : -1; return; }
      if (!d.to) { d.from = { x: pet.x, y: pet.gy }; d.to = besideCursor(pet, pet.x < pet.stage.pointer.x ? -1 : 1); }
      const k = Math.min(1, (pet.stateT - 0.45) / 0.55);
      pet.x = d.from.x + (d.to.x - d.from.x) * k;
      pet.gy = d.from.y + (d.to.y - d.from.y) * k;
      pet.walkPhase += dt * 8;
      if (done) {
        pet.pounce = null;
        pet.stage.fx.burst(pet.x, pet.gy, S, ['#ffffff', '#ffe066'], { n: 4, speed: 30, spread: 6, g: 120, life: 0.3 });
        pet.showEmote(Math.random() < 0.5 ? '♪' : '?', 1); // 抓到了？還是撲空了？
        pet.set('idle', rnd(1, 2));
      }
    },
    lift(pet) { return pet.stateT < 0.45 ? 0 : Math.round(Math.sin(Math.min(1, (pet.stateT - 0.45) / 0.55) * Math.PI) * 16); },
    pose(pet, p) { if (pet.stateT < 0.45) { p.sx = 1.12; p.sy = 0.82; p.rot = pet.facing * 0.06; } else p.rot = pet.facing * 0.2; },
  },
  // 追著游標跑（比 follow 快，會一跳一跳）；追到就在旁邊停下來看著
  chaseCursor: {
    update(pet, dt, done) {
      const st = pet.stage, p = st.pointer;
      if (!p.known || done) { pet.set('idle', 1); return; }
      const t = besideCursor(pet);
      if (pet.moveTo(t.x, t.y, RUN_SPEED * pet.S * 0.85, dt)) pet.facing = p.x > pet.x ? 1 : -1;
    },
    lift: pet => Math.round(Math.abs(Math.sin(pet.walkPhase * 0.7)) * 5),
  },
  // 游標停很久：走過去坐在旁邊；游標一動就嚇一跳跑開
  cursorSit: {
    update(pet, dt, done) {
      const st = pet.stage, p = st.pointer, c = pet.cursorSit, S = pet.S;
      if (!p.known || !c) { pet.cursorSit = null; pet.set('idle', 1); return; }
      if (!c.seated) {
        if (st.pointerStill < 0.05) { pet.cursorSit = null; pet.set('idle', 1); return; } // 走過去的途中游標就動了：算了
        const t = besideCursor(pet, c.side);
        c.side = t.side;
        if (pet.moveTo(t.x, t.y, WALK_SPEED * S * 1.3, dt)) {
          c.seated = true;
          c.at = { x: p.x, y: p.y };
          pet.facing = p.x > pet.x ? 1 : -1;
          pet.showEmote('♪', 1.2);
        }
        return;
      }
      // 坐著：游標一動就嚇一跳
      if (p.x !== c.at.x || p.y !== c.at.y) {
        pet.cursorSit = null;
        pet.showEmote('!', 1);
        pet.hopT = 0.35;
        st.game?.remember(pet.uid, { k: 'cursor-surprised' });
        const away = pet.x < p.x ? -1 : 1;
        const b = pet.bounds();
        pet.target = { x: Math.max(b.x0, Math.min(b.x1, pet.x + away * rnd(120, 200) * S)), y: pet.gy };
        pet.set('run', 1.2);
        return;
      }
      if (done) { pet.cursorSit = null; pet.set('idle', 1); }
    },
    lift: pet => (pet.cursorSit?.seated ? 0 : Math.round(Math.abs(Math.sin(pet.walkPhase)) * 2)),
    pose(pet, p) { if (pet.cursorSit?.seated) { p.sx = 1.06; p.sy = 0.9; } },
  },
};
