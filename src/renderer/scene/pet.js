// 桌面上的夥伴寶可夢：在整個桌面上自由走動（俯視的桌面平面，不把工作列當地板），
// 會發呆、伸懶腰、東張西望、坐下、轉圈、跳舞、打滾、跌倒、跟其他夥伴追著玩、被抓起來丟出去。
// 依屬性的生態動作和夥伴之間的互動寫在 behaviors.js，每一種寶可夢的專屬習性寫在 habits.js。
// 位置：(x, gy) = 腳底在桌面平面上的位置（裝置像素）；z = 離地高度（美術像素）；alt = 會飄的寶可夢的飄浮高度。
// 美術像素 × stage.S = 裝置像素。
import { blit } from '../gfx/pixel.js';
import { liveAsset } from '../gfx/sprites.js';
import * as art from '../gfx/art.js';
import { hearts } from '../../core/amie.js';
import { spriteKey } from '../../core/forms.js';
import { ACTIONS, soloOptions, socialOptions, WALK_SPEED, RUN_SPEED } from './behaviors.js';
import { HABIT_ACTIONS, habitOptions } from './habits.js';
import { MOVE_ACTIONS, moveOptions } from './moves.js';
import { SOCIAL_ACTIONS, groupOptions, maybeComfort } from './social.js';
import { integrateKnock } from './physics.js';
import { updateForm, drawForm } from './battleforms.js';
import { PERCH_ACTIONS, perchBounds, perchedChoices, perchOption } from './perching.js';
import { tag, weigh, afterChoice, tickMind } from './mindlink.js';
import { homeOptions, homeNight, exhausted } from './home.js';
import { TRAVEL_ACTIONS, startDepart, drawCarried } from './travel.js';
import { traitsOf } from '../../core/mind.js';
import { CURSOR_ACTIONS, cursorOptions, wantsToPounce, startPounce, besideCursor } from './cursor.js';

const GRAVITY = 900; // 美術像素／秒²
const DROP = 14; // 放開時離地的高度（美術像素）


// 專注番茄鐘進行中：只做安靜的動作，不跑來跑去、不找別隻玩
function focusChoices(pet) {
  const rp = (a, b) => a + Math.random() * (b - a);
  return [
    ['idle', 10, () => pet.set('idle', rp(4, 10))],
    ['sit', 14, () => pet.set('sit', rp(8, 20))],
    ['nap', 10, () => pet.set('sleep', rp(10, 30))],
    ['look', 3, () => pet.set('look', rp(2, 3))],
  ];
}

// [名稱, 權重, 動作] 裡依權重挑一個
function pickWeighted(list) {
  const choices = list.filter(([, w]) => w > 0);
  const total = choices.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  return choices.find(([, w]) => (r -= w) < 0) ?? choices[0];
}

// 動畫播放速度（原作的待機動畫；走路、跑步時播快一點，看起來像在邁步）
const ANIM_SPEED = { walk: 1.5, approach: 1.5, walkTogether: 1.5, run: 2, chase: 2, flee: 2, chaseCursor: 2, pounce: 1.6, dance: 1.6, held: 1.4, sit: 0.7, sleep: 0.3, dizzy: 0.5, shiver: 2.5 };

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

  // 圖片依形態而不同（藍花的花蓓蓓、超級蒂安希…）；battleForm 是對戰中暫時的形態，不存檔
  get spriteKey() { return spriteKey(this.mon.species, this.battleForm ?? this.mon.form); }
  // 會動的圖載好了就用它（每一隻有自己的播放位置），還沒就先用不會動的圖
  // 這一幀有在移動就播走路的動作（左右腳輪流抬），不然播待機（呼吸）
  get asset() {
    const lp = this.lastPos, moving = lp && Math.hypot(this.x - lp.x, this.gy - lp.y) > 0.25 * this.S;
    return liveAsset(this, this.stage.sprites, this.spriteKey, this.mon.shiny, this.animT, moving ? 'walk' : 'idle');
  }
  get S() { return this.stage.S; }
  get types() { return this.stage.dex.get(this.mon.species).types; }
  get act() { return ACTIONS[this.state] ?? HABIT_ACTIONS[this.state] ?? MOVE_ACTIONS[this.state] ?? SOCIAL_ACTIONS[this.state] ?? PERCH_ACTIONS[this.state] ?? CURSOR_ACTIONS[this.state] ?? TRAVEL_ACTIONS[this.state]; }
  // 圖的腳底在螢幕上的 y（含飄浮與離地高度，不含走路的上下晃動）
  get y() { return this.gy - (this.alt + this.z) * this.S; }
  restY() { return this.gy - this.alt * this.S; }
  set(state, dur = 0) {
    const was = this.state;
    this.state = state; this.stateT = 0; this.dur = dur;
    // 跌倒或頭暈時，感情好的夥伴可能會跑來安慰
    if ((state === 'trip' || state === 'dizzy') && was !== state && !this.leaving && !this.guest) maybeComfort(this);
  }

  // 腳底可以站的範圍：頭不能超出螢幕上緣。站在視窗頂邊上時只能沿著頂邊走
  bounds() {
    if (this.perch) { const pb = perchBounds(this); if (pb) return pb; }
    const a = this.asset, S = this.S, st = this.stage;
    const half = (a.w * S) / 2;
    return { x0: half, x1: st.W - half, y0: (a.h + this.alt + 6) * S, y1: st.H - 3 * S };
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
    if (this.flinchT > 0) p.ox += Math.floor(this.flinchT * 30) % 2 ? 2 : -2;
    if (this.squashT > 0) { const s = this.squashT / 0.18; p.sx *= 1 + 0.22 * s; p.sy *= 1 - 0.2 * s; }
    return p;
  }

  hit(px, py) {
    if (this.leaving || this.alpha < 0.5) return false;
    const r = this.rect(), S = this.S, a = this.asset;
    if (px < r.x || py < r.y || px >= r.x + r.w || py >= r.y + r.h) return false;
    if (this.act?.intangible?.(this)) return false;
    if (this.state === 'roll' || this.state === 'trip') return true; // 轉動中用外框判定
    let ax = Math.floor((px - r.x) / S), ay = Math.floor((py - r.y) / S);
    if (this.facing > 0) ax = a.w - 1 - ax;
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
  get free() { return ['idle', 'walk', 'sit', 'look', 'stretch'].includes(this.state) && !this.leaving && !this.reserved; }

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

  happy() { this.set('happy', 0.6); }

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
  moveTo(tx, ty, speed, dt) {
    const dx = tx - this.x, dy = ty - this.gy;
    const d = Math.hypot(dx, dy);
    if (d < 3 * this.S) return true;
    const step = Math.min(d, speed * dt);
    this.x += (dx / d) * step;
    this.gy += (dy / d) * step;
    if (Math.abs(dx) > this.S) this.facing = Math.sign(dx);
    this.walkPhase += step / (this.S * 4);
    return false;
  }

  // ---------- 每一幀 ----------
  update(dt) {
    const st = this.stage, S = this.S;
    this.lastPos = { x: this.x, y: this.gy, dt }; // 碰撞時用來估計速度
    this.hopT = Math.max(0, (this.hopT ?? 0) - dt); // 被撞到時彈一下
    this.t += dt;
    this.animT += dt * (ANIM_SPEED[this.state] ?? 1);
    this.stateT += dt;
    this.squashT = Math.max(0, this.squashT - dt);
    this.flinchT = Math.max(0, (this.flinchT ?? 0) - dt); // 被招式打到
    this.flipT = Math.max(0, (this.flipT ?? 0) - dt); // 被「顛倒」倒過來
    updateForm(this, dt); // 超級進化、牽絆變身
    // guest：故事對戰的對手（不是你的夥伴）：沒有心情、不會自己決定要做什麼
    if (!this.guest) tickMind(this, dt); // 需求隨時間變化（每秒一次）
    if (!this.guest && wantsToPounce(this, dt)) this.choose(tag([['pounce', 1, () => startPounce(this)]], 'cursor')); // 游標在附近晃：撲過去
    if (this.emote && this.t > this.emote.until) this.emote = null;
    const p = st.pointer;
    const near = p.known && Math.abs(p.x - this.x) < 260 * (S / 2) && Math.abs(p.y - this.y) < 300 * (S / 2);
    const done = this.stateT > this.dur;

    switch (this.state) {
      case 'appear':
        if (this.stateT > 0.45) this.set(this.guest ? 'battle' : 'idle', 1.5);
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
          const arrive = Math.hypot(this.target.x - this.x, this.target.y - this.gy) < 40 * S ? this.onArrive : null;
          this.onArrive = null;
          this.set('idle', 1);
          arrive?.();
          break;
        }
        if (this.moveTo(this.target.x, this.target.y, speed, dt)) {
          if (this.state === 'run' && this.stateT < this.dur) { this.target = this.randomPoint(60, 200); break; } // 暴衝：一直換方向
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
        const b = this.bounds();
        this.x += this.rollDir * 60 * S * dt;
        if (this.x <= b.x0 || this.x >= b.x1) this.rollDir *= -1;
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
        if (near && st.env.userActive) this.facing = p.x > this.x ? 1 : -1;
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
        if (done) this.set('idle', 1);
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
    if (this.state !== 'held') {
      const b = this.bounds();
      if (this.x < b.x0) { this.x = b.x0; this.vx = Math.abs(this.vx) * 0.5; }
      if (this.x > b.x1) { this.x = b.x1; this.vx = -Math.abs(this.vx) * 0.5; }
      if (this.gy < b.y0) { this.gy = b.y0; this.vy = Math.abs(this.vy) * 0.5; }
      if (this.gy > b.y1) { this.gy = b.y1; this.vy = -Math.abs(this.vy) * 0.5; }
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
    this.walkLimit = null;
    if (st.game?.tripStatus(this.uid) === 'away') { startDepart(this); return; } // 已經出發了（例如走到一半被拎起來）：繼續走

    if (this.perch) { this.choose(tag(perchedChoices(this), 'explore')); return; } // 站在視窗上：只做安靜的事或跳下來
    if (st.env.focus) { this.choose(tag(focusChoices(this), 'rest')); return; } // 專注中：安靜地陪你
    // 站在視窗上、正在往上跳的不算（不會被拉去玩）
    const others = [...st.pets.values()].filter(o => o !== this && o.free && !o.partner && !o.perch && o.state !== 'perchUp');
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
    const h = hearts(this.mon.affection);
    const settings = st.game?.state.settings;
    const musicOn = settings && !settings.muted && settings.musicVolume > 0.05;

    const rp = (a, b) => a + Math.random() * (b - a);
    const choices = tag([
      ['walk', 30, () => { this.target = this.randomPoint(50, 320); this.set('walk'); }],
      ['idle', 14, () => this.set('idle', rp(2, 6))],
      ['look', 7, () => { this.set('look', rp(1.6, 2.6)); if (Math.random() < 0.5) this.showEmote('?', 1.2); }],
      ['sit', 7, () => this.set('sit', rp(3, 8))],
      ['stretch', 4, () => { this.set('stretch', 1.2); if (Math.random() < 0.5) this.showEmote('…', 1); }],
      // 肚子餓：跟你討泡芙，或自己去附近找找有沒有樹果
      ['beg', this.mon.fullness < 30 ? 4 : 0, () => { this.showEmote(art.puff('sweet-basic'), 2); this.set('idle', 2); }],
      ['hungry', this.mon.fullness < 100 ? 5 : 0, () => {
        this.target = this.randomPoint(40, 160);
        this.set('walk');
        this.onArrive = () => {
          if (this.floats) { this.set('look', 1.6); this.showEmote('♪', 1); return; }
          this.target = this.randomPoint(10, 30);
          this.set('forage', rp(2.5, 3.5));
        };
      }],
      ['shiver', 2, () => this.set('shiver', 0.6)],
      ['follow', h >= 3 && st.pointer.known && st.env.userActive ? 9 : 0, () => this.set('follow', rp(3, 7))],
      ['run', this.mon.enjoyment > 120 || h >= 2 ? 4 : 1, () => { this.target = this.randomPoint(80, 260); this.set('run', rp(2.5, 4.5)); }],
      ['spin', h >= 2 ? 3 : 0, () => this.set('spin', 0.9)],
      ['dance', musicOn && h >= 1 ? 4 : 0, () => this.set('dance', rp(3, 6))],
      ['roll', !this.floats && h >= 1 ? 3 : 0, () => { this.rollDir = this.facing; this.set('roll', 1); }],
      ['play', others.length && h >= 1 ? 6 : 0, () => {
        const o = others[Math.floor(Math.random() * others.length)];
        this.partner = o; o.partner = this;
        this.set('chase', rp(4, 6));
        o.set('flee', this.dur);
        this.showEmote('!', 0.8);
        o.showEmote('♪', 0.8);
        st.fire('bond', this, o, 2);
      }],
    ], 'rest').concat(
      tag(soloOptions(this), 'play'),
      tag(socialOptions(this, others), 'social'),
      tag(habitOptions(this, others), 'habit'), // 這一種寶可夢專屬的習性
      tag(moveOptions(this, others), 'train'), // 練習招式、切磋
      tag(groupOptions(this, others.filter(o => !o.group)), 'social'), // 一群一起玩、好朋友之間
      tag(perchOption(this), 'explore'), // 跳到其他視窗的標題列上
      tag(cursorOptions(this), 'cursor'), // 追游標、坐在游標旁邊
      tag(homeOptions(this), 'base'), // 回秘密基地睡覺、坐坐
      // 出門旅行（一次只有一隻、桌面上至少留一隻；很少發生）
      tag([['trip', !this.perch && !st.minigame?.active && !this.evolveView && st.game?.canDepart(this.uid) ? 1 : 0, () => {
        if (st.game.depart(this.uid, { curious: traitsOf(this.mon.nature).curious })) startDepart(this);
      }]], 'trip'),
    );
    this.choose(choices);
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
      blit(ctx, k < 0.7 ? a.white : a.canvas, this.x - w / 2, this.y - h, sc, { flipX: this.facing > 0, alpha });
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
    const pose = this.pose();
    if (sink > 0) {
      // 只畫地面以上的部分，身體往下沉
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, this.stage.W, Math.round(this.gy));
      ctx.clip();
      ctx.translate(0, Math.round(sink * a.h) * S);
    }
    const flipY = this.upsideDown || this.flipT > 0;
    if (flipY || (pose.sx === 1 && pose.sy === 1 && pose.rot === 0)) {
      blit(ctx, img, r.x + pose.ox * S, r.y, S, { flipX: this.facing > 0, flipY, alpha });
      if (sleepy) blit(ctx, a.dark, r.x, r.y, S, { flipX: this.facing > 0, alpha: 0.18 * alpha });
    } else {
      const w = a.w * S, h = a.h * S;
      const feetX = Math.round(this.x + pose.ox * S), feetY = r.y + h;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (pose.pivot === 'center') ctx.translate(feetX, feetY - h / 2);
      else ctx.translate(feetX, feetY);
      ctx.rotate(pose.rot);
      ctx.scale(pose.sx * (this.facing > 0 ? -1 : 1), pose.sy);
      const oy = pose.pivot === 'center' ? -h / 2 : -h;
      ctx.drawImage(img, -w / 2, oy, w, h);
      if (sleepy) { ctx.globalAlpha = 0.18 * alpha; ctx.drawImage(a.dark, -w / 2, oy, w, h); }
      ctx.restore();
    }
    if (sink > 0) ctx.restore();
    // 被招式打到：白色閃爍
    if (this.flinchT > 0 && Math.floor(this.flinchT * 20) % 2) blit(ctx, a.white, r.x + pose.ox * S, r.y, S, { flipX: this.facing > 0, flipY, alpha: 0.6 * alpha });
    act?.drawOver?.(this, ctx);
    const carrying = this.stage.game?.tripStatus(this.uid) === 'back';
    if (!this.emote && carrying) drawCarried(this, ctx); // 旅行回來：頂著明信片
    // 節日：頭上戴著小裝飾（core/calendar.js；故事對戰的對手不戴）
    const deco = this.stage.env.holidayDeco && art.decos[this.stage.env.holidayDeco];
    if (deco && !this.emote && !carrying && !this.guest && alpha > 0.5) {
      const r2 = this.rect();
      blit(ctx, deco, Math.round(r2.x + r2.w * (this.facing > 0 ? 0.62 : 0.38) - (deco.width * S) / 2), r2.y - (deco.height - 2) * S, S, { alpha });
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
