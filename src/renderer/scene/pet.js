// 桌面上的夥伴寶可夢：在整個桌面上自由走動（俯視的桌面平面，不把工作列當地板），
// 會發呆、伸懶腰、東張西望、坐下、轉圈、跳舞、打滾、跌倒、跟其他夥伴追著玩、被抓起來丟出去。
// 依屬性的生態動作和夥伴之間的互動寫在 behaviors.js，每一種寶可夢的專屬習性寫在 habits.js。
// 位置：(x, gy) = 腳底在桌面平面上的位置（裝置像素）；z = 離地高度（美術像素）；alt = 會飄的寶可夢的飄浮高度。
// 美術像素 × stage.S = 裝置像素。
import { blit } from '../gfx/pixel.js';
import { puppetAsset } from '../gfx/sprites.js';
import * as art from '../gfx/art.js';
import { hearts } from '../../core/amie.js';
import { spriteKey } from '../../core/forms.js';
import { ACTIONS, soloOptions, socialOptions, boutCtx, WALK_SPEED, RUN_SPEED } from './behaviors.js';
import { HABIT_ACTIONS, habitOptions, habitMean } from './habits.js';
import { MOVE_ACTIONS, moveOptions } from './moves.js';
import { SOCIAL_ACTIONS, groupOptions, maybeComfort } from './social.js';
import { integrateKnock } from './physics.js';
import { updateForm, drawForm } from './battleforms.js';
import { PERCH_ACTIONS, perchBounds, perchedChoices, perchOption } from './perching.js';
import { tag, weigh, afterChoice, tickMind, mindWeights } from './mindlink.js';
import { homeOptions, homeNight, exhausted, makeRoom, tickRoom, TENT_ACTIONS } from './home.js';
import { TRAVEL_ACTIONS, startDepart, drawCarried } from './travel.js';
import { traitsOf } from '../../core/mind.js';
import { CURSOR_ACTIONS, cursorOptions, wantsToPounce, startPounce, besideCursor } from './cursor.js';
import { LIFE_ACTIONS, lifeOptions, boostLife } from './lifeacts.js';
import { actWeight, nextBout, focusBout, ACTS as BOUT_ACTS } from '../../core/ethogram.js';
import { step, coast, turnTime, wanderPath, pauseTick, gait, topSpeed, RUN_STRIDE } from './locomotion.js';

const GRAVITY = 900; // 美術像素／秒²
const DROP = 14; // 放開時離地的高度（美術像素）


// 專注番茄鐘進行中：只做安靜的動作，不跑來跑去、不找別隻玩（做哪個、多久由 core/ethogram.js 的 focusBout 決定）
const FOCUS_STATE = { idle: 'idle', sit: 'sit', nap: 'sleep', look: 'look' };

// [名稱, 權重, 動作] 裡依權重挑一個
function pickWeighted(list) {
  const choices = list.filter(([, w]) => w > 0);
  const total = choices.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  return choices.find(([, w]) => (r -= w) < 0) ?? choices[0];
}

// 動畫播放速度（原作的待機動畫；走路、跑步時播快一點，看起來像在邁步）
const TINY = 0.55; // 全螢幕時縮小到幾倍（猜的，可調整）
// 狀態 → 播哪一組動作（沒列的看有沒有在移動）
const ANIM_SET = {
  held: 'dangle', fall: 'dangle',
  sleep: 'sleep', nap: 'sleep', gemnap: 'sleep',
  eat: 'eat', munch: 'eat', sip: 'eat', graze: 'eat', sweettooth: 'eat',
  trip: 'hurt', dizzy: 'hurt', startle: 'hurt', stuck: 'hurt',
  move: 'attack', ram: 'attack', roar: 'attack', spar: 'attack', tantrum: 'attack', stomp: 'attack', chomp: 'attack', bite: 'attack',
  happy: 'happy', hop: 'happy', greet: 'happy', dance: 'happy', cheer: 'happy', twirl: 'happy', bounce: 'happy', hug: 'happy', hugging: 'happy', flashypose: 'happy', keyfound: 'happy',
};
const RUNS = new Set(['run', 'chase', 'flee', 'chaseCursor', 'pounce', 'oni', 'tag']);
const CHEER_MAX = 0.8; // 這麼短以內的 happy 算「互動結束的開心」 // 猜的，可調整
const REST_GUARD = 0.8; // 休息的前多少不會被找去玩 // 猜的，可調整
const HEAD_ROOM = 14; // 頭上留幾格（美術像素）：嚇一跳往上跳 10 格＋開心彈一下 4 格也碰不到螢幕上緣，不用瞬間把整隻往下推（PR-N4a，規格 M1；以前 6） // 猜的，可調整
const EDGE_SOFT = 3; // 自己走、滑到螢幕邊可以超出幾格（美術像素），照減速度停下 // 猜的，可調整
const FILLER_MAX = 5; // 這麼短以內的 idle 算「做完一件事的過場」（各處寫的是 1–4.5 秒；測試、導演要牠停著的都是 10 秒以上） // 猜的，可調整
const KEEP_ARRIVE = new Set(['walk', 'run', 'trip']); // 換到這些狀態時留著 onArrive（還在往那裡走）
// 這些狀態本來就是要快速翻來翻去（轉圈、跳舞、搖頭）：面向直接翻，不做轉身
const INSTANT_FLIP = new Set(['spin', 'dance', 'refuse', 'roll', 'appear', 'held', 'fall', 'evolving']);
const ANIM_SPEED = { walk: 1.5, approach: 1.5, walkTogether: 1.5, run: 2, chase: 2, flee: 2, chaseCursor: 2, pounce: 1.6, dance: 1.6, held: 1.4, sit: 0.7, sleep: 0.3, dizzy: 0.5, shiver: 2.5 };
// 休息中（跟隨的擺幅打折，規格 F9）
const RESTING = new Set(['idle', 'sit', 'sleep', 'nap', 'inside', 'cursorSit', 'watch', 'chill', 'wait', 'sunbathe', 'read']);
// 休息中被嚇到只彈一下、不打斷的狀態（睡著的、在帳篷裡的不算：會醒）；反應多短以內才這樣（PR-N5）
const REACT_KEEP = new Set(['idle', 'sit', 'cursorSit', 'watch', 'chill', 'wait', 'sunbathe', 'read']);
const REACT_MAX = 1; // 猜的，可調整

// ---------- 集中轉換器（規格 PR-N3、§4.3、F7）----------
// 行為、習性、招式的 pose() 還是寫整張圖的 { sx, sy, rot, ox, pivot }（140 處不用改），畫之前在這裡翻成像素木偶的參數：
//   小角度的 rot → 上身錯開 lean 格（身高 × 0.5）；sy < 1 → 身體往下沉 crouch 列、sy > 1 → 伸長（crouch 負的）；sx → 不管（寬度不變）
//   只有 rot 接近 90° 的倍數（跌倒、翻滾、倒立）才整張圖轉，而且只轉 90° 的倍數（quarter）。所以像素永遠是方的、不會出現原圖沒有的顏色
// h：圖的高度（美術像素）；face：畫出來的面向（翻面時 lean 的左右跟著反過來）
const QUARTER = Math.PI / 2;
const SNAP = 0.3; // 離 90° 的倍數多近（弧度，約 17°）才整張轉 // 猜的，可調整
const LEAN_K = 0.5, CROUCH_K = 0.5; // rot、sy 換成幾格 // 猜的，可調整（規格：lean = round(rot × 身高 × 0.5)）
export function toPuppet(p, h, face = -1) {
  const rot = p.rot || 0, q = Math.round(rot / QUARTER), rest = rot - q * QUARTER;
  const quarter = q !== 0 && Math.abs(rest) <= SNAP ? ((q % 4) + 4) % 4 : 0;
  const tilt = quarter ? rest : rot; // 沒有整張轉的時候，整個角度都變成往那邊傾
  // 螢幕上 rot > 0 是頭往右；圖本身面向左，負的 lean 是往前（往左）：沒翻面時同號，翻面時反號
  const lean = Math.max(-4, Math.min(4, Math.sin(Math.max(-QUARTER, Math.min(QUARTER, tilt))) * h * LEAN_K)) * (face > 0 ? -1 : 1);
  const crouch = (1 - (p.sy ?? 1)) * h * CROUCH_K;
  return { lean, crouch, quarter, pivot: p.pivot ?? 'feet', ox: Math.round(p.ox || 0), rot: quarter * QUARTER, sx: 1, sy: 1 };
}

export class Pet {
  constructor(stage, mon, { x, gy, fromBall = false } = {}) {
    this.stage = stage;
    this.mon = mon;
    this.uid = mon.uid;
    this.floats = stage.dex.floats(mon.species);
    this.alt = this.floats ? 24 + Math.random() * 40 : 0; // 飄浮高度（美術像素）
    this.x = x ?? stage.W * (0.15 + Math.random() * 0.7);
    this.gy = gy ?? stage.H * (0.4 + Math.random() * 0.5);
    this.z = 0;
    this.vx = 0; // 桌面平面上的速度（裝置像素／秒）
    this.vy = 0;
    this.vz = 0; // 垂直速度（美術像素／秒，往上為正）
    this.facing = Math.random() < 0.5 ? -1 : 1; // -1 面向左（原圖方向）
    this.t = Math.random() * 10;
    this.animT = Math.random() * 10; // 動畫播放到哪（走路播快一點、睡覺播慢一點）
    this.state = fromBall ? 'appear' : 'idle';
    this.stateT = 0;
    this.dur = 1 + Math.random() * 2;
    this.target = { x: this.x, y: this.gy };
    this.partner = null; // 一起玩的夥伴
    this.onArrive = null;
    this.emote = null;
    this.eating = null;
    this.grab = null;
    this.walkPhase = 0;
    this.upsideDown = false;
    this.dizzy = false;
    this.squashT = 0; // 落地時壓扁一下
    this.rollDir = 1;
    this.alpha = 1;
    this.leaving = false;
    this.evolveView = null; // 進化演出時由外部控制
    this.clamp();
  }

  // 面向：-1 面向左（原圖方向）。程式讀到的是新的方向（邏輯不變）；畫出來的 viewFacing 等轉身做完（turnT 秒）才翻，
  // 轉身中往新方向偏一格（預備動作）。規格 PR-N2、F2：以前每次都是 1 幀瞬間翻面
  get facing() { return this._facing; }
  set facing(v) {
    if (v === this._facing) return;
    const first = this._facing == null;
    this._facing = v;
    if (first || INSTANT_FLIP.has(this.state)) { this.viewFacing = v; this.turnT = 0; this.instantFlipAt = this.t; return; }
    if (v === this.viewFacing) { this.turnT = 0; return; } // 轉到一半又轉回來：不用轉了
    this.turnT = turnTime(this);
    this.turnStart = this.t;
  }

  // 圖片依形態而不同（藍花的花蓓蓓、超級蒂安希…）；battleForm 是對戰中暫時的形態，不存檔
  get spriteKey() { return spriteKey(this.mon.species, this.battleForm ?? this.mon.form); }
  // 會動的圖載好了就用它（每一隻有自己的播放位置），還沒就先用不會動的圖
  // 播哪一組動作（gfx/rig.js）：被打到、被拎著、睡覺、吃、出招、開心各有自己的；
  // 其他的這一幀有在移動就播走路（跑的狀態播跑），不然播待機（呼吸）
  get asset() {
    return puppetAsset(this, this.stage.sprites, this.spriteKey, this.mon.shiny);
  }
  animSet() {
    if (this.flinchT > 0) return 'hurt';
    const s = ANIM_SET[this.state] ?? this.act?.animSet?.(this); // 習性可以指定播哪一組（habits.js 的 set）
    if (s) return s;
    const lp = this.lastPos, moving = lp && Math.hypot(this.x - lp.x, this.gy - lp.y) > 0.25 * this.S;
    if (this.cheerT > 0 && !moving) return 'happy'; // 互動結束開心地舉手（停著的時候）
    return moving ? (RUNS.has(this.state) ? 'run' : 'walk') : 'idle';
  }
  get S() { return this.stage.S; }
  get types() { return this.stage.dex.get(this.mon.species).types; }
  get act() { return ACTIONS[this.state] ?? HABIT_ACTIONS[this.state] ?? MOVE_ACTIONS[this.state] ?? SOCIAL_ACTIONS[this.state] ?? PERCH_ACTIONS[this.state] ?? CURSOR_ACTIONS[this.state] ?? TRAVEL_ACTIONS[this.state] ?? LIFE_ACTIONS[this.state] ?? TENT_ACTIONS[this.state]; }
  // 圖的腳底在螢幕上的 y（含飄浮與離地高度，不含走路的上下晃動）
  get y() { return this.gy - (this.alt + this.z) * this.S; }
  restY() { return this.gy - this.alt * this.S; }
  set(state, dur = 0) {
    // 互動結束的「開心」（0.6 秒，遊行、合照、切磋、追完、吃完…）：彈一下、舉手（cheerT），不另外切一個狀態，
    // 接著直接挑下一件事（使用者決定的 M8 做法：以前每次互動結束都多換一次狀態）
    if (state === 'happy' && dur <= CHEER_MAX && !this.guest) { this.cheerT = dur; this.hopT = Math.max(this.hopT ?? 0, 0.25); state = 'idle'; dur = 1; }
    // 休息中被別隻嚇到、冷到（吼叫、超音波、放招逗牠…1 秒以內的反應）：彈一下（表情是呼叫的人放的），接著休息，不另外切一個狀態。
    // 跟上面的開心一樣（PR-N5，規格 M8：以前每次都打斷休息、嚇完再挑下一件事，休息多的物種被旁邊吵到，換狀態的次數超過上限）。睡著的照舊會醒
    if ((state === 'startle' || state === 'shiver') && dur <= REACT_MAX && REACT_KEEP.has(this.state) && !this.guest) { this.hopT = Math.max(this.hopT ?? 0, 0.25); return; }
    const was = this.state;
    this.state = state; this.stateT = 0; this.dur = dur;
    // 不是在往某個地方走了（被叫去看東西、被拎起來、嚇一跳…）：「走到了要做什麼」也不要了，不然會留著舊的（規格 F10）。
    // 跌倒（trip）例外：站起來會繼續走過去
    if (!KEEP_ARRIVE.has(state)) this.onArrive = null;
    // 做完一件事時各處會塞一段 1–3 秒的 idle 過場，一件事就變成換兩次狀態（規格 M8：每分鐘換太多次）。
    // 不是「下一件事」選出來的休息、又很短的 idle＝過場：這一幀 update 結束時直接挑下一件事（呼叫的人接著換了別的狀態就照它的）。
    // 長的（測試、導演要牠停著）、nextBout 選的休息（restIdle）照舊
    this.fillerIdle = state === 'idle' && !this.restIdle && dur <= FILLER_MAX;
    // 被叫去做別的：這一段玩完了。停下來的 idle 只有過場的會接著重複；長的（測試、導演要牠停著）也算被叫走
    // （PR-N5 找到的 PR-N4 舊 bug：以前任何 idle 都留著，停著以後再放一次招，放完又自己重複練，招式一直放不完）
    if (this.boutRep && !this.fillerIdle && state !== this.boutRep.name) this.boutRep = null;
    if (this.restBout && state !== this.restBout.state) this.restBout = null; // 休息結束了（或被叫走）
    this.restIdle = false;
    // 散步的路線只屬於 decide() 開始的那一段散步：別的地方換狀態（被找去玩、導演叫牠去角落）就不要了。
    // 以前留著，導演叫牠走到角落以後，會接著走舊散步路線的下一段又走開（PR-N4b 找到的舊 bug）
    if (!this.exploreStart) { this.explore = false; this.path = null; }
    this.exploreStart = false;
    // 跌倒或頭暈時，感情好的夥伴可能會跑來安慰
    if ((state === 'trip' || state === 'dizzy') && was !== state && !this.leaving && !this.guest) maybeComfort(this);
  }

  // 腳底可以站的範圍：頭不能超出螢幕上緣。站在視窗頂邊上時只能沿著頂邊走
  bounds() {
    if (this.perch) { const pb = perchBounds(this); if (pb) return pb; }
    const a = this.asset, S = this.S, st = this.stage;
    const half = (a.w * S) / 2;
    return { x0: half, x1: st.W - half, y0: (a.h + this.alt + HEAD_ROOM) * S, y1: st.H - 3 * S };
  }
  clamp() {
    const b = this.bounds();
    this.x = Math.max(b.x0, Math.min(b.x1, this.x));
    this.gy = Math.max(b.y0, Math.min(b.y1, this.gy));
  }
  randomPoint(minDist, maxDist) {
    const b = this.bounds(), S = this.S;
    const ang = Math.random() * Math.PI * 2, d = (minDist + Math.random() * (maxDist - minDist)) * S;
    return {
      x: Math.max(b.x0 + 8 * S, Math.min(b.x1 - 8 * S, this.x + Math.cos(ang) * d)),
      y: Math.max(b.y0 + 4 * S, Math.min(b.y1 - 4 * S, this.gy + Math.sin(ang) * d * 0.7)),
    };
  }

  // 在螢幕上的矩形（裝置像素）
  rect() {
    const a = this.asset, S = this.S;
    const w = a.w * S, h = a.h * S;
    return { x: Math.round(this.x - w / 2), y: Math.round(this.y - h - this.lift() * S), w, h };
  }
  head() { const r = this.rect(); return { x: r.x + r.w / 2, y: r.y }; }
  mouth() { const r = this.rect(); return { x: r.x + r.w * (this.facing < 0 ? 0.35 : 0.65), y: r.y + r.h * 0.4 }; }

  // 動作造成的上下位移（美術像素）
  lift() {
    const k = this.dur > 0 ? Math.min(1, this.stateT / this.dur) : 0;
    const bump = this.hopT > 0 ? Math.round(Math.sin((this.hopT / 0.25) * Math.PI) * 4) : 0;
    return bump + this.baseLift(k);
  }

  baseLift(k) {
    if (this.act?.lift) return this.act.lift(this, k);
    switch (this.state) {
      case 'walk': case 'follow': case 'chase': case 'flee': case 'run':
        return Math.round(Math.abs(Math.sin(this.walkPhase)) * (this.state === 'walk' || this.state === 'follow' ? 2 : 3));
      case 'hop': case 'happy': case 'greet':
        return Math.round(Math.sin(Math.min(1, this.stateT / 0.35) * Math.PI) * 6);
      case 'startle':
        return Math.round(Math.sin(Math.min(1, this.stateT / 0.3) * Math.PI) * 10);
      case 'spin':
        return Math.round(Math.abs(Math.sin(k * Math.PI * 2)) * 5);
      case 'dance':
        return Math.round(Math.abs(Math.sin(this.stateT * Math.PI * 2.4)) * 3);
      case 'roll':
        return 1;
      case 'sleep': case 'sit': case 'trip':
        return 0;
    }
    if (this.floats && this.state !== 'held' && this.state !== 'fall') return Math.round(Math.sin(this.t * 2) * 2);
    return Math.floor(this.t * 1.6) % 2; // 呼吸
  }

  // 畫的時候的變形：sx/sy 伸縮、rot 旋轉、ox 左右位移（美術像素）、pivot 旋轉中心
  pose() {
    const k = this.dur > 0 ? Math.min(1, this.stateT / this.dur) : 0;
    const p = { sx: 1, sy: 1, rot: 0, ox: 0, pivot: 'feet' };
    switch (this.state) {
      case 'stretch': {
        // 先縮再伸長
        const s = Math.sin(k * Math.PI);
        if (k < 0.25) { p.sx = 1 + 0.12 * (k / 0.25); p.sy = 1 - 0.1 * (k / 0.25); }
        else { p.sx = 1 - 0.08 * s; p.sy = 1 + 0.18 * s; }
        break;
      }
      case 'sit': p.sx = 1.08; p.sy = 0.88; break;
      case 'sleep': p.sx = 1.06; p.sy = 0.9 + Math.sin(this.t * 1.6) * 0.02; break;
      case 'dance': p.rot = Math.sin(this.stateT * Math.PI * 1.2) * 0.14; break;
      case 'run': case 'chase': case 'flee': p.rot = -this.facing * 0.08; break;
      case 'roll': p.rot = this.rollDir * k * Math.PI * 2; p.pivot = 'center'; break;
      case 'shiver': p.ox = Math.floor(this.stateT * 30) % 2 ? 1 : -1; break;
      case 'trip': {
        const fall = Math.min(1, this.stateT / 0.18);
        const up = this.stateT > this.dur - 0.25 ? (this.dur - this.stateT) / 0.25 : 1;
        p.rot = this.facing * (Math.PI / 2) * fall * Math.max(0, up);
        break;
      }
      case 'dizzy': p.rot = Math.sin(this.stateT * 9) * 0.16; break;
      case 'refuse': p.rot = Math.sin(this.stateT * 20) * 0.06; break;
    }
    this.act?.pose?.(this, p, k);
    if (this.turnT > 0) p.ox += this.facing; // 轉身的預備動作：往要轉過去的那一邊偏一格
    if (this.flinchT > 0) p.ox += Math.floor(this.flinchT * 30) % 2 ? 2 : -2;
    if (this.squashT > 0) { const s = this.squashT / 0.18; p.sx *= 1 + 0.22 * s; p.sy *= 1 - 0.2 * s; }
    // 有視窗全螢幕時變小（director.js）改在 draw() 用整數倍率畫，不放進這裡的縮放
    return p;
  }

  hit(px, py) {
    if (this.leaving || this.alpha < 0.5) return false;
    const r = this.rect(), S = this.S, a = this.asset;
    if (px < r.x || py < r.y || px >= r.x + r.w || py >= r.y + r.h) return false;
    if (this.act?.intangible?.(this)) return false;
    if (this.state === 'roll' || this.state === 'trip') return true; // 轉動中用外框判定
    let ax = Math.floor((px - r.x) / S), ay = Math.floor((py - r.y) / S);
    if (this.viewFacing > 0) ax = a.w - 1 - ax;
    if (this.upsideDown) ay = a.h - 1 - ay;
    // 容許 1 美術像素的誤差，細長的寶可夢比較好點
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = ax + dx, y = ay + dy;
      if (x >= 0 && y >= 0 && x < a.w && y < a.h && a.mask[y * a.w + x]) return true;
    }
    return false;
  }

  showEmote(key, seconds = 1.6) {
    const img = typeof key === 'string' ? art.emotes[key] : key;
    if (img) this.emote = { img, until: this.t + seconds };
  }

  // 可以被其他夥伴找去玩／被打斷的狀態
  // reserved：正在過去陪你（晚睡時走到游標旁邊），別隻不能在半路找牠玩
  // 閒著、可以被找去玩：正要去看日落、正在看日落的不算（director.js 安排的）
  // 正在休息（nextBout 選的休息）的前 80%：別隻不會找牠去玩（動物休息時不會一直被拉起來；使用者決定的 M8 做法）。
  // 只擋「別隻挑誰一起玩」；導演的反應（有人探頭轉頭看、日落、下雨）照舊，休息的動物聽到動靜也會抬頭
  get restingNow() { return Boolean(this.restBout?.state === this.state && this.t < this.restBout.until); }
  get free() { return ['idle', 'walk', 'sit', 'look', 'stretch'].includes(this.state) && !this.leaving && !this.reserved && !this.sunsetSit && !(this.state === 'sit' && this.t < (this.gazeWestUntil ?? 0)); }

  // ---------- 反應 ----------
  onStroke(result) {
    const S = this.S, h = this.head();
    if (this.state === 'sleep' || this.state === 'sit') { this.set('idle', 1); if (this.state === 'sleep') this.showEmote('!', 0.8); }
    if (result?.affectionGain > 0 && Math.random() < 0.45) this.stage.fx.hearts(h.x, h.y, S);
    if (result?.enjoymentFull && Math.random() < 0.3) this.showEmote('♪');
    if (this.state === 'idle' || this.state === 'walk' || this.state === 'look') this.set('hop', 0.35);
  }

  startEat(puffKey) {
    this.endPlay();
    this.set('eat', 1.4);
    this.eating = { puff: puffKey, bites: 0 };
  }

  refuse() {
    this.set('refuse', 0.9);
    this.showEmote('…', 1.2);
  }

  // 走出螢幕（出門）、走回來的路上：開心就好（愛心、表情照樣有），不要停下來
  // 坐著等你的（在果實旁邊等、看日落：director.js 安排的）也一樣：冒個 ♪ 就好，不要站起來（站起來就不等了）
  happy() {
    if (this.state === 'depart' || this.state === 'tripReturn') return;
    if (this.state === 'sit' && (this.reserved || this.sunsetSit)) { this.showEmote('♪', 1.2); return; }
    this.set('happy', 0.6);
  }

  pickUp(px, py) {
    const r = this.rect();
    this.perch = null; // 從視窗上被抓起來
    this.perchJump = null;
    this.endPlay();
    this.meet = null;
    this.habit = null;
    this.moveCtx = null;
    this.moveAlpha = 1;
    this.watching = null;
    this.faded = false;
    this.grab = { dx: px - r.x, dy: py - r.y };
    this.z = 0;
    this.vx = this.vy = this.vz = 0;
    this.set('held');
    this.showEmote(hearts(this.mon.affection) >= 3 ? '♪' : '!', 0.8);
    this.upsideDown = this.mon.species === 686; // 好啦魷被抓起來時會倒過來
  }

  release(vx, vy) {
    const S = this.S;
    vx = Math.max(-2500, Math.min(2500, vx));
    vy = Math.max(-2500, Math.min(2500, vy));
    const feet = this.y;
    // 放開的地方就是桌面上的位置；不會飄的寶可夢從手上掉下來一小段
    this.z = this.floats ? 0 : DROP;
    this.gy = feet + (this.alt + this.z) * S;
    this.vx = vx * 0.5;
    this.vy = vy * (this.floats ? 0.5 : 0.3);
    this.vz = this.floats ? 0 : Math.max(0, -vy / S) * 0.25; // 往上甩會拋高
    this.dizzy = Math.hypot(vx, vy) > 1600 * (S / 2);
    this.grab = null;
    this.upsideDown = false;
    this.set('fall');
  }

  endPlay() {
    const p = this.partner;
    this.partner = null;
    if (p && p.partner === this) { p.partner = null; if (p.state === 'chase' || p.state === 'flee') p.set('idle', 1); }
  }

  // 往目標移動，到了回傳 true
  // 往 (tx, ty) 走（加減速、轉身、步頻上限都在 scene/locomotion.js）；到了回傳 true
  moveTo(tx, ty, speed, dt) { return step(this, tx, ty, speed, dt, WALK_SPEED); }

  // ---------- 每一幀 ----------
  update(dt) {
    const st = this.stage, S = this.S;
    this.lastPos = { x: this.x, y: this.gy, dt }; // 碰撞時用來估計速度
    this.hopT = Math.max(0, (this.hopT ?? 0) - dt); // 被撞到時彈一下
    this.cheerT = Math.max(0, (this.cheerT ?? 0) - dt); // 開心地舉手（見 set）
    this.t += dt;
    this.stateT += dt;
    // 轉身做完：畫出來的面向才翻過去
    if (this.turnT > 0) { this.turnT = Math.max(0, this.turnT - dt); if (!this.turnT) { this.viewFacing = this.facing; this.turnedAt = this.t; this.lastTurn = this.t - this.turnStart; } } // lastTurn：這次轉了幾秒（測試用）
    if (INSTANT_FLIP.has(this.state) && this.viewFacing !== this.facing) { this.viewFacing = this.facing; this.turnT = 0; this.instantFlipAt = this.t; }
    this.squashT = Math.max(0, this.squashT - dt);
    this.flinchT = Math.max(0, (this.flinchT ?? 0) - dt); // 被招式打到
    this.flipT = Math.max(0, (this.flipT ?? 0) - dt); // 被「顛倒」倒過來
    updateForm(this, dt); // 超級進化、牽絆變身
    // guest：故事對戰的對手（不是你的夥伴）：沒有心情、不會自己決定要做什麼
    if (!this.guest) tickMind(this, dt); // 需求隨時間變化（每秒一次）
    if (!this.guest) tickRoom(this, dt); // 在基地休息時跟別隻疊在一起：後來的挪開（scene/home.js）
    if (!this.guest && wantsToPounce(this, dt)) { startPounce(this); afterChoice(this, ['pounce', 1, null, 'cursor']); } // 游標在附近晃：撲過去
    if (this.emote && this.t > this.emote.until) this.emote = null;
    const p = st.pointer;
    const near = p.known && Math.abs(p.x - this.x) < 260 * (S / 2) && Math.abs(p.y - this.y) < 300 * (S / 2);
    const done = this.stateT > this.dur;

    switch (this.state) {
      case 'appear':
        if (this.stateT > 0.45) { this.restIdle = true; this.set(this.guest ? 'battle' : 'idle', 1.5); } // 剛從球裡出來：先站一下（不是過場）
        break;
      case 'idle':
        if (near && st.env.userActive) {
          this.facing = p.x > this.x ? 1 : -1;
          // 游標很快地衝過來：膽小的會嚇一跳
          if (hearts(this.mon.affection) < 2 && st.pointerSpeed?.() > 2600 * (S / 2) && Math.random() < dt * 3) {
            this.set('startle', 0.5);
            this.showEmote('!', 0.8);
            break;
          }
        }
        if (done) { if (this.guest) this.set('battle'); else this.decide(); }
        break;
      case 'walk':
      case 'run': {
        const speed = (this.state === 'run' ? RUN_SPEED : WALK_SPEED) * S * (st.env.calm ? 0.6 : st.env.tired ? 0.75 : 1); // 你說今天很累、或昨天熬夜了（一起累）：大家走慢一點
        // 路被別隻擋住太久就放棄
        // 已經很近了（被別隻擋住最後幾步）就當作到了，不然放棄
        if (this.state === 'walk' && this.stateT > (this.walkLimit ?? 15)) {
          // 導演交代的差事（reserved：躲到角落、去你旁邊）走不到也照樣在這裡做完（PR-N4b：做完一件事會直接接下一件，放棄的話就走開了）
          const arrive = Math.hypot(this.target.x - this.x, this.target.y - this.gy) < 40 * S || this.reserved ? this.onArrive : null;
          this.onArrive = null;
          this.set('idle', 1);
          arrive?.();
          break;
        }
        if (this.state === 'walk' && this.explore && pauseTick(this, dt)) break; // 散步：停下來看一看
        if (this.moveTo(this.target.x, this.target.y, speed, dt)) {
          if (this.state === 'run' && this.stateT < this.dur) { this.target = this.randomPoint(60, 200); break; } // 暴衝：一直換方向
          if (this.state === 'walk' && this.explore && this.path?.length) { this.target = this.path.shift(); break; } // 散步：下一段
          if (this.state === 'walk' && this.explore && this.t < (this.walkUntil ?? 0)) { this.path = wanderPath(this); this.target = this.path.shift(); break; } // 這一段散步還沒走滿：換個方向繼續走
          const arrive = this.onArrive;
          this.onArrive = null;
          this.set('idle', 1.5 + Math.random() * 3);
          arrive?.(); // 走到目的地時觸發（打招呼用）
          break;
        }
        if (this.state === 'run' && done) { this.set('idle', 1.5); this.showEmote('✦', 1); break; }
        // 不會飄的偶爾會跌倒
        if (!this.floats && Math.random() < dt * (this.state === 'run' ? 0.12 : 0.012)) {
          this.set('trip', 1.3);
          this.showEmote('@', 1.3);
          st.audio.sfx('land');
        }
        break;
      }
      case 'follow': {
        if (!p.known || done) { this.set('idle', 2); break; }
        // 走到游標旁邊（不停在游標正下方：那樣會蓋住游標、把你的點擊吃掉）
        const t = besideCursor(this);
        if (this.moveTo(t.x, t.y + this.alt * S, WALK_SPEED * S * 1.8, dt)) this.facing = p.x > this.x ? 1 : -1;
        break;
      }
      case 'chase':
      case 'flee': {
        const o = this.partner;
        if (!o || o.leaving || o.partner !== this) { this.partner = null; this.set('idle', 1); break; }
        if (this.state === 'chase') {
          if (this.moveTo(o.x, o.gy, RUN_SPEED * S * 0.95, dt) || done) {
            // 抓到了（或時間到）：兩個都很開心
            for (const q of [this, o]) { q.partner = null; q.set('happy', 0.6); q.showEmote('♪', 1.4); }
            st.fx.hearts((this.x + o.x) / 2, Math.min(this.head().y, o.head().y), S);
            st.audio.sfx('heart');
          }
        } else {
          const dx = this.x - o.x, dy = this.gy - o.gy, d = Math.hypot(dx, dy) || 1;
          const b = this.bounds();
          let tx = this.x + (dx / d) * 80 * S, ty = this.gy + (dy / d) * 80 * S;
          // 被逼到邊邊就往旁邊溜
          if (tx < b.x0 || tx > b.x1) { tx = this.x; ty = this.gy + (ty > (b.y0 + b.y1) / 2 ? -1 : 1) * 80 * S; }
          if (ty < b.y0 || ty > b.y1) { ty = this.gy; tx = this.x + (tx > (b.x0 + b.x1) / 2 ? -1 : 1) * 80 * S; }
          this.moveTo(tx, ty, RUN_SPEED * S * 0.85, dt);
        }
        break;
      }
      case 'roll': {
        // 打滾：跟走路一樣有加速度上限（PR-N4a，規格 M1：以前直接改位置，碰到邊瞬間反向）；快到邊先減速再彈回來，快結束時慢下來
        const b = this.bounds(), lv = (this.lv ??= { x: 0, y: 0 });
        const acc = topSpeed(this, RUN_SPEED * S, WALK_SPEED) / gait(this).acc;
        const room = this.rollDir > 0 ? b.x1 - this.x : this.x - b.x0;
        if (room < (lv.x * lv.x) / (2 * acc) + 4 * S && Math.sign(lv.x) === this.rollDir) this.rollDir *= -1; // 照現在的速度煞車要多遠：來不及就提早轉向
        const want = Math.min(60 * S, Math.sqrt(2 * acc * Math.max(0, room)), acc * Math.max(0, this.dur - this.stateT));
        const dv = this.rollDir * want - lv.x;
        lv.x += Math.sign(dv) * Math.min(Math.abs(dv), acc * dt);
        lv.y -= Math.sign(lv.y) * Math.min(Math.abs(lv.y), acc * dt); // 前一段留下的上下速度（例如跑步接打滾）慢慢停，不是瞬間歸零
        this.x += lv.x * dt; this.gy += lv.y * dt;
        this.moved = true; // 這一幀自己動過了（locomotion 的 coast 不要再滑一次）
        if (done) { this.set('idle', 1); if (Math.random() < 0.5) this.showEmote('♪', 1); }
        break;
      }
      case 'look':
        // 東張西望
        this.facing = Math.floor(this.stateT / 0.55) % 2 ? 1 : -1;
        if (done) this.set('idle', 1 + Math.random() * 2);
        break;
      case 'spin':
        this.facing = Math.floor(this.stateT / 0.09) % 2 ? 1 : -1;
        if (done) { this.set('idle', 1); this.showEmote('♪', 1); }
        break;
      case 'dance':
        if (Math.floor(this.stateT / 0.42) % 2) this.facing = Math.floor(this.stateT / 0.84) % 2 ? 1 : -1;
        if (!this.emote && Math.random() < dt * 0.8) this.showEmote('♪', 1);
        if (done) this.set('idle', 1.5);
        break;
      case 'sit':
        if (this.t < (this.gazeWestUntil ?? 0)) this.facing = -1; // 看日落（director.js）：一直看著西邊
        else if (near && st.env.userActive) this.facing = p.x > this.x ? 1 : -1;
        if (done) this.set('idle', 1);
        break;
      case 'sleep':
        if (!st.env.sleepy) { this.set('stretch', 1.2); this.showEmote('…', 1); }
        else if (Math.floor(this.t) % 3 === 0 && !this.emote) this.showEmote('Z', 1.2);
        break;
      case 'shiver':
        if (done) { this.set('idle', 1); this.showEmote('✦', 0.8); }
        break;
      case 'trip':
        // 站起來：本來要走去哪裡（床、你旁邊、果實…）就繼續走過去，不會忘記
        if (done) { if (this.onArrive && this.target) this.set('walk'); else this.set('idle', 1); }
        break;
      case 'greet':
        if (this.partner) this.facing = this.partner.x > this.x ? 1 : -1;
        if (done) { this.partner = null; this.set('idle', 1.5); }
        break;
      case 'dizzy':
      case 'stretch':
      case 'startle':
      case 'hop':
      case 'happy':
      case 'refuse':
        if (this.state === 'refuse') this.facing = Math.floor(this.stateT * 8) % 2 ? 1 : -1;
        if (done) this.set('idle', 1 + Math.random() * 2);
        break;
      case 'eat':
        if (this.eating) {
          const bites = Math.min(3, Math.floor(this.stateT / 0.4));
          if (bites > this.eating.bites) {
            this.eating.bites = bites;
            const m = this.mouth();
            st.audio.sfx('eat');
            st.fx.crumbs(m.x, m.y, S, art.FLAVOR_COLORS[this.eating.puff.split('-')[0]].F);
          }
        }
        if (done) { this.eating = null; this.set('happy', 0.6); }
        break;
      case 'held':
        if (this.grab && p.known) {
          const a = this.asset;
          this.x = p.x - this.grab.dx + (a.w * S) / 2;
          this.gy = p.y - this.grab.dy + a.h * S + this.alt * S;
        }
        break;
      case 'fall':
        this.updateFall(dt);
        break;
      case 'evolving':
        break;
      default:
        if (this.act) this.act.update(this, dt, done);
        else this.set('idle', 1);
    }
    // 色違的夥伴身上偶爾會閃一下
    if (this.mon.shiny && this.state !== 'held' && Math.random() < dt * 0.25) {
      const r = this.rect();
      st.fx.sparkles(r.x + r.w * (0.2 + Math.random() * 0.6), r.y + r.h * (0.2 + Math.random() * 0.5), S, 1, 2);
    }

    integrateKnock(this, dt); // 被推、被打到的擊退
    // 走出螢幕（出門）、從螢幕外走進來（回家）的時候本來就在螢幕外：不要夾回來，不然會卡在邊上
    const offscreen = (this.state === 'depart' && this.departure?.phase === 'out') || this.state === 'tripReturn';
    if (this.state !== 'held' && !offscreen) {
      const b0 = this.bounds(), lv = this.lv ?? {};
      // 軟邊（PR-N4a，規格 M1）：自己走、滑過去的可以超出一點點（EDGE_SOFT 格），照減速度停下，不會撞牆一樣瞬間停住；
      // 再超出去（或被丟出去）才夾回來
      const soft = this.state === 'fall' ? 0 : EDGE_SOFT * S;
      const b = { x0: b0.x0 - soft, x1: b0.x1 + soft, y0: b0.y0 - soft, y1: b0.y1 + soft };
      // 走到邊上被擋住：那個方向的走路速度也歸零（不然會一直往邊上滑、看起來是瞬間停住）
      if (this.x < b.x0) { this.x = b.x0; this.vx = Math.abs(this.vx) * 0.5; if (lv.x < 0) lv.x = 0; }
      if (this.x > b.x1) { this.x = b.x1; this.vx = -Math.abs(this.vx) * 0.5; if (lv.x > 0) lv.x = 0; }
      if (this.gy < b.y0) { this.gy = b.y0; this.vy = Math.abs(this.vy) * 0.5; if (lv.y < 0) lv.y = 0; }
      if (this.gy > b.y1) { this.gy = b.y1; this.vy = -Math.abs(this.vy) * 0.5; if (lv.y > 0) lv.y = 0; }
      // 跳起來（招式、習性）時頭不能超出螢幕上緣：靠近上緣就跳低一點；
      // 動作本身的上下晃動（嚇一跳、蹦蹦跳）也一樣，整隻往下移一點
      if (this.z > 0) {
        const top = this.rect().y;
        if (top < 0) this.z = Math.max(0, this.z + top / S);
      }
      const headY = this.rect().y;
      if (headY < 0) this.gy = Math.min(b.y1, this.gy - headY);
    }
    if (this.leaving) this.alpha = Math.max(0, this.alpha - dt * 3);
    // 換到過場的 idle（這一幀、或上一幀在別的地方被換的）：直接挑下一件事（見 set()）
    if (this.fillerIdle && this.state === 'idle' && !this.guest && !this.leaving) {
      this.fillerIdle = false;
      // 一段裡重複做的小動作（ACTS 的 rep）：這一段還沒滿就再做一次，滿了才挑下一件事
      const r = this.boutRep, env = this.stage.env;
      if (r && this.t < r.until && !env.sleepy && !env.focus && !this.perch) r.start(r.rep);
      else { this.boutRep = null; this.decide(); }
    }
  }

  // 每一幀、所有夥伴都 update 完以後（stage.update 呼叫）：
  // 有些群體動作是由帶頭的那一隻推著大家走（遊行、合照），誰先 update 不一定，所以要等全部推完才知道這一幀「有沒有被推著走」
  settle(dt) {
    coast(this, dt, WALK_SPEED); // 這一幀沒有人叫 moveTo、身上還有速度：滑一小段停下（scene/locomotion.js）
    // 動畫：走路、跑步照走了多遠播（一輪＝左右腳各一步，一步 stride 美術像素），腳才不會在地上滑；其他照時間播
    const moved = this.stepDist ?? 0, anim = this.view?.anim, setName = this.animSet(), stride = anim?.info?.stride;
    this.stepDist = 0;
    this.lastStepDist = moved; // 測試用：這一幀是不是自己走的（natural.cjs 的 M2 只算自己走的）
    if (moved > 0 && stride && !this.floats && (setName === 'walk' || setName === 'run')) this.animT += (moved / (2 * stride * (setName === 'run' ? RUN_STRIDE : 1))) * anim.sets[setName].total;
    else this.animT += dt * (ANIM_SPEED[this.state] ?? 1);
    // 像素木偶（規格 PR-N3）：這一組動作的步相＋整張圖的姿勢（toPuppet）→ 彈簧追過去 → 量化成這一幀的圖
    const view = this.asset;
    if (view?.puppet) {
      const total = view.anim.sets[setName]?.total ?? 1;
      this.puppetXf = toPuppet(this.pose(), view.anim.info.H, this.viewFacing);
      const k = this.dur > 0 ? Math.min(1, this.stateT / this.dur) : 0;
      view.drive(dt, setName, this.animT / total, this.puppetXf, RESTING.has(this.state), this.act?.puppet?.(this, k)); // 習性直接指定的身體姿勢
    }
  }

  // 被丟出去：在桌面上滑行，不會飄的會先掉到地上、彈一下
  updateFall(dt) {
    const S = this.S;
    this.x += this.vx * dt;
    this.gy += this.vy * dt;
    const airborne = this.z > 0 || this.vz > 0;
    const friction = Math.pow(airborne ? 0.5 : 0.03, dt);
    this.vx *= friction;
    this.vy *= friction;
    if (this.floats) {
      if (Math.hypot(this.vx, this.vy) < 20 * S) this.set('idle', 1);
      return;
    }
    this.vz -= GRAVITY * dt;
    this.z += this.vz * dt;
    if (this.z > 0) return;
    this.z = 0;
    if (this.vz < -150) {
      // 落地彈一下
      const impact = -this.vz;
      this.vz = impact * 0.35;
      this.squashT = 0.18;
      this.stage.audio.sfx('land');
      if (impact > 260) this.dizzy = true;
      return;
    }
    this.vz = 0;
    if (Math.hypot(this.vx, this.vy) > 30 * S) return; // 還在滑
    this.vx = this.vy = 0;
    this.squashT = 0.18;
    if (this.dizzy) {
      this.dizzy = false;
      this.set('dizzy', 1.6);
      this.showEmote('@', 1.6);
    } else {
      this.set('idle', this.emote ? 1.6 : 1);
    }
  }

  // 抽一個選項來做，然後讓心智想一個理由（選項是 [名稱, 權重, 動作, 類別]）
  choose(choices) {
    const c = pickWeighted(weigh(this, choices));
    c[2]();
    afterChoice(this, c);
  }

  decide() {
    const st = this.stage;
    this.onArrive = null;
    this.bedId = null; // 睡醒了：床空出來
    this.homeSpot = null; // 基地空地上占的那一格也空出來（scene/home.js）
    this.path = null; this.explore = false; // 上一次散步的路線
    this.boutRep = null;
    this.walkLimit = null;
    if (st.game?.tripStatus(this.uid) === 'away') { startDepart(this); return; } // 已經出發了（例如走到一半被拎起來）：繼續走

    if (this.perch) { this.choose(tag(perchedChoices(this), 'explore')); return; } // 站在視窗上：只做安靜的事或跳下來
    if (st.env.focus) { // 專注中：安靜地陪你
      const b = focusBout(Math.random);
      this.restIdle = true; // 專注時選的就是休息
      this.set(FOCUS_STATE[b.name], b.dur);
      afterChoice(this, [b.name, 1, null, 'rest']);
      return;
    }
    // 站在視窗上、正在往上跳的不算（不會被拉去玩）
    const others = [...st.pets.values()].filter(o => o !== this && o.free && !o.restingNow && !o.partner && !o.perch && o.state !== 'perchUp');
    if (st.env.sleepy) {
      // 晚上：先回秘密基地（床空著就上床，不然去基地跟大家擠在一起）。
      // 睡著了要到早上才會醒，所以一定要先回到家再睡
      const home = homeNight(this);
      if (home) { this.choose(tag([home], 'base')); return; }
      // 想睡了：有其他夥伴在睡的話靠過去一起睡
      const cuddle = socialOptions(this, others).find(([n]) => n === 'cuddle');
      if (cuddle && Math.random() < 0.6) { cuddle[2](); afterChoice(this, [...cuddle, 'social']); return; }
      const nap = Math.random() < 0.3 ? 'stretch' : 'nap';
      this.set(nap === 'stretch' ? 'stretch' : 'sleep', 1.2);
      if (this.state === 'stretch') this.showEmote('…', 1);
      afterChoice(this, [nap, 1, null, 'rest']);
      return;
    }
    const tired = exhausted(this); // 累壞了：直接回床上睡
    if (tired) { this.choose(tag([tired], 'base')); return; }
    if (makeRoom(this)) { afterChoice(this, ['makeRoom', 1, null, 'base']); return; } // 在基地跟別隻疊在一起：挪開（保持個體距離）
    const rp = (a, b) => a + Math.random() * (b - a);
    // 這幾個基本動作怎麼做（多常做、做多久由 core/ethogram.js 的物種生活表決定；d＝nextBout 給的長度）
    const ctx = { ...boutCtx(this), others: others.length };
    const acts = {
      // 散步：微彎的路線、走走停停（scene/locomotion.js）
      // 一段散步走滿 nextBout 給的長度（PR-N5，規格 M8）：路線走完、時間還沒到就再接一段路線（以前走完 2–3 段就停，比生活表估的長度短，散步被挑得太常）
      walk: d => { this.path = wanderPath(this); this.target = this.path.shift(); this.explore = true; this.walkUntil = this.t + (d ?? 0); this.movingT = 0; this.pauseT = 0; this.nextPause = null; this.exploreStart = true; this.set('walk'); this.walkLimit = Math.max(15, (d ?? 0) + 8); },
      idle: d => { this.restIdle = true; this.set('idle', d); },
      look: d => { this.set('look', d); if (Math.random() < 0.5) this.showEmote('?', 1.2); },
      sit: d => this.set('sit', d),
      stretch: d => { this.set('stretch', d); if (Math.random() < 0.5) this.showEmote('…', 1); },
      // 肚子餓：跟你討泡芙，或自己去附近找找有沒有樹果
      beg: () => { this.showEmote(art.puff('sweet-basic'), 2); this.set('idle', 2); },
      hungry: d => {
        this.target = this.randomPoint(40, 160);
        this.set('walk');
        const t0 = this.t;
        this.onArrive = () => {
          if (this.floats) { this.set('look', 1.6); this.showEmote('♪', 1); return; }
          this.target = this.randomPoint(10, 30);
          this.set('forage', Math.max(4, (d ?? 6) - (this.t - t0))); // 找吃的一段：走過去加上找，滿 nextBout 給的長度（PR-N5；PR-N4 是 4–8 秒，以前 2.5–3.5 秒）
        };
      },
      shiver: d => this.set('shiver', d),
      follow: d => this.set('follow', d),
      run: d => { this.target = this.randomPoint(80, 260); this.set('run', d); },
      spin: () => this.set('spin', 0.9),
      dance: d => this.set('dance', d),
      roll: () => { const b = this.bounds(); this.rollDir = this.x - b.x0 > b.x1 - this.x ? -1 : 1; this.facing = this.rollDir; this.set('roll', 1); }, // 往空間大的那邊滾
      play: () => {
        const o = others[Math.floor(Math.random() * others.length)];
        this.partner = o; o.partner = this;
        this.set('chase', rp(4, 6));
        o.set('flee', this.dur);
        this.showEmote('!', 0.8);
        o.showEmote('♪', 0.8);
        st.fire('bond', this, o, 2);
      },
    };
    const choices = tag(Object.entries(acts).map(([name, start]) => [name, actWeight(name, ctx), start]), 'rest').concat(
      tag(soloOptions(this), 'play'),
      tag(socialOptions(this, others), 'social'),
      tag(habitOptions(this, others), 'habit'), // 這一種寶可夢專屬的習性
      tag(moveOptions(this, others), 'train'), // 練習招式、切磋
      tag(groupOptions(this, others.filter(o => !o.group)), 'social'), // 一群一起玩、好朋友之間
      tag(perchOption(this), 'explore'), // 跳到其他視窗的標題列上
      tag(cursorOptions(this), 'cursor'), // 追游標、坐在游標旁邊
      tag(homeOptions(this), 'base'), // 回秘密基地睡覺、坐坐
      tag(lifeOptions(this), 'rest'), // 自己喝水、看書、吃東西（scene/lifeacts.js）
      // 出門旅行（一次只有一隻、桌面上至少留一隻；很少發生）
      tag([['trip', !this.perch && !st.minigame?.active && !this.evolveView && st.game?.canDepart(this.uid) ? 1 : 0, () => {
        if (st.game.depart(this.uid, { curious: traitsOf(this.mon.nature).curious })) startDepart(this);
      }]], 'trip'),
    );
    // 牠們自己的生活（core/life.js）：這一格在喝水，喝水的選項就比較容易被選到
    const life = st.game?.lifeAt?.(this.uid);
    const offers = life ? boostLife(choices, life) : choices;
    // 下一段做什麼、做多久：物種生活表（時間分配 × 心智的需求 × 屬性對環境的反應）
    const bout = nextBout(this.mon.species, { ...ctx, mind: mindWeights(this), offers: offers.map(([name, w, , cat]) => ({ name, w, cat, mean: cat === 'habit' ? habitMean(this, name) : undefined })) }, Math.random); // 習性自己的平均長度（PR-N5）
    const c = bout && offers.find(o => o[0] === bout.name && o[1] > 0);
    if (!c) { this.restIdle = true; this.set('idle', rp(2, 4)); return; }
    this.bout = bout; // 測試、之後的移動（PR-N2）用：這一段屬於哪一類
    this.restBout = null;
    // 沒有對象的習性也一樣：一段做滿 nextBout 給的長度，做完一次、時間還沒到就再做一次（PR-N5，規格 M8；結束時變成別的狀態的習性不會重複，見 set()）
    const rep = BOUT_ACTS[c[0]]?.rep ?? (c[3] === 'habit' && habitMean(this, c[0]) != null ? 1 : null);
    if (rep) { c[2](rep); this.boutRep = { name: this.state, start: c[2], rep, until: this.t + bout.dur }; } // 重複做到這一段滿
    else c[2](bout.dur);
    if (bout.kind === 'rest' && this.state !== 'walk') this.restBout = { state: this.state, until: this.t + (this.dur || bout.dur) * REST_GUARD }; // 走去休息的地方的路上不算
    afterChoice(this, c);
  }

  draw(ctx) {
    const S = this.S, a = this.asset, r = this.rect(), act = this.act;
    const alpha = this.alpha * (act?.alpha?.(this) ?? 1);
    const sink = act?.sink?.(this) ?? 0; // 挖洞：身體有多少在地面下
    const sleepy = this.state === 'sleep' || act?.dark;
    if (this.state === 'appear') {
      // 從球裡出來：白光慢慢變成原本的樣子
      const k = Math.min(1, this.stateT / 0.45);
      const sc = Math.max(1, Math.round(S * (0.3 + 0.7 * k)));
      const w = a.w * sc, h = a.h * sc;
      blit(ctx, k < 0.7 ? a.white : a.canvas, this.x - w / 2, this.y - h, sc, { flipX: this.viewFacing > 0, alpha });
      return;
    }
    // 桌面上的影子（離地越高越小越淡）
    if ((this.state !== 'held' || !this.floats) && sink < 0.9) {
      const h = this.alt + this.z;
      const k = Math.max(0.35, 1 - h / 120);
      const sw = Math.max(2, Math.round((a.w / 2) * k)) * S;
      ctx.fillStyle = `rgba(20,10,30,${(0.2 * k * Math.min(1, alpha * 1.5)).toFixed(3)})`;
      ctx.fillRect(Math.round(this.x - sw / 2), Math.round(this.gy) - S, sw, S);
      ctx.fillRect(Math.round(this.x - sw / 2 + S), Math.round(this.gy), sw - 2 * S, S);
    }
    const img = this.evolveView ?? a.canvas;
    if (sink > 0) {
      // 只畫地面以上的部分，身體往下沉
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, this.stage.W, Math.round(this.gy));
      ctx.clip();
      ctx.translate(0, Math.round(sink * a.h) * S);
    }
    const flipY = this.upsideDown || this.flipT > 0;
    // 傾斜、蹲低已經做進木偶的圖裡（settle 的 toPuppet）；這裡整張圖只會翻面、轉 90° 的倍數，只用整數倍率畫（規格 F7）
    const xf = this.puppetXf ?? toPuppet(this.pose(), a.h, this.viewFacing); // settle() 這一幀已經算過就直接用
    const ox = xf.ox * S;
    const quarter = flipY ? 0 : xf.quarter;
    const sc = this.stage.env.tiny ? Math.max(1, Math.round(S * TINY)) : S; // 有視窗全螢幕：躲在角落、變小（director.js）；小一點但還是整數倍率
    if (!quarter && sc === S) {
      blit(ctx, img, r.x + ox, r.y, S, { flipX: this.viewFacing > 0, flipY, alpha });
      if (sleepy) blit(ctx, a.dark, r.x + ox, r.y, S, { flipX: this.viewFacing > 0, alpha: 0.18 * alpha });
    } else {
      const w = a.w * sc, h = a.h * sc;
      const feetX = Math.round(this.x + ox), feetY = r.y + a.h * S;
      const center = xf.pivot === 'center';
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(feetX, center ? feetY - Math.round(h / 2 / sc) * sc : feetY);
      ctx.rotate(quarter * (Math.PI / 2));
      ctx.scale(this.viewFacing > 0 ? -1 : 1, flipY ? -1 : 1);
      const x0 = -Math.round(w / 2 / sc) * sc, oy = center ? -Math.round(h / 2 / sc) * sc : -h;
      ctx.drawImage(img, x0, oy, w, h);
      if (sleepy) { ctx.globalAlpha = 0.18 * alpha; ctx.drawImage(a.dark, x0, oy, w, h); }
      ctx.restore();
    }
    if (sink > 0) ctx.restore();
    // 被招式打到：白色閃爍
    if (this.flinchT > 0 && Math.floor(this.flinchT * 20) % 2) blit(ctx, a.white, r.x + ox, r.y, S, { flipX: this.viewFacing > 0, flipY, alpha: 0.6 * alpha });
    act?.drawOver?.(this, ctx);
    const carrying = this.stage.game?.tripStatus(this.uid) === 'back';
    if (!this.emote && carrying) drawCarried(this, ctx); // 旅行回來：頂著明信片
    // 節日：頭上戴著小裝飾（core/calendar.js；故事對戰的對手不戴）
    const deco = this.stage.env.holidayDeco && art.decos[this.stage.env.holidayDeco];
    if (deco && !this.emote && !carrying && !this.guest && alpha > 0.5) {
      const r2 = this.rect();
      blit(ctx, deco, Math.round(r2.x + r2.w * (this.viewFacing > 0 ? 0.62 : 0.38) - (deco.width * S) / 2), r2.y - (deco.height - 2) * S, S, { alpha });
    }
    drawForm(this, ctx);
    if (this.eating && this.eating.bites < 3) {
      const m = this.mouth();
      const img2 = art.bittenPuff(this.eating.puff, this.eating.bites);
      blit(ctx, img2, m.x - (img2.width * S) / 2, m.y - (img2.height * S) / 2, S);
    }
    if (this.emote && alpha > 0.3) drawEmoteBubble(ctx, this, S);
  }
}

// 表情泡泡：白底、深色框，小尾巴指著頭頂正中間。
// 跟別隻聊天時泡泡往外側偏（尾巴不動），兩隻的泡泡才不會疊在一起；碰到螢幕邊邊就往內收
function drawEmoteBubble(ctx, pet, S) {
  const e = pet.emote.img, h = pet.head(), st = pet.stage;
  const pad = 2, w = (e.width + pad * 2) * S, hh = (e.height + pad * 2) * S, tail = 3 * S;
  const bob = Math.floor(pet.t * 3) % 2 ? 0 : S;
  const hx = Math.round(h.x / S) * S;
  const o = pet.partner;
  const lean = o && Math.abs(o.x - pet.x) < (w + 8 * S) * 2 ? (o.x > pet.x ? -1 : 1) * Math.round(w / 2 / S - 3) * S : 0;
  const x = Math.max(S, Math.min(st.W - w - S, hx - Math.round(w / 2 / S) * S + lean));
  const y = Math.max(S, Math.round(h.y) - hh - tail - 2 * S - bob);
  const tx = Math.max(x + 2 * S, Math.min(x + w - 4 * S, hx - S)); // 尾巴的位置（留在泡泡裡面）
  ctx.fillStyle = '#2a2030';
  ctx.fillRect(x, y - S, w, hh + 2 * S);
  ctx.fillRect(x - S, y, w + 2 * S, hh);
  ctx.fillRect(tx - S, y + hh, 4 * S, S);
  ctx.fillRect(tx, y + hh + S, 2 * S, tail - S);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, hh);
  ctx.fillRect(tx, y + hh, 2 * S, S);
  blit(ctx, e, x + pad * S, y + pad * S, S);
}
