// 故事裡的對戰（道館、四天王、冠軍、閃焰隊）：在桌面下方中間打一場。
// 數字在 core/battle.js；這裡負責演出：派夥伴出場、對手從球裡出來、輪流放招（沿用招式特效）、倒下、換下一隻。
//
// 你這邊：桌面上的夥伴都可以上場，一次一隻；倒下了就換下一隻，全部倒下就輸了。
// 對手：照順序一隻一隻出來。畫面下方的對戰面板（ui/battlehud.js）顯示血量、選招式。
import { Pet } from './pet.js';
import * as B from '../../core/battle.js';
import { lossesOf } from '../../core/story.js';
import { hearts } from '../../core/amie.js';
import { MOVES, useMove, battleMovesFor } from './moves.js';
import { transform, endDuelForms } from './battleforms.js';

const GAP = 120; // 兩邊離中間多遠（美術像素）
const TURN_PAUSE = 0.55; // 一招結束到下一招之間（秒）
const ANIM_LIMIT = 6; // 一招最多演多久；超過就當作演完了（例如夥伴被別的事打斷）

const trainingOf = mon => Object.values(mon.training ?? {}).reduce((a, b) => a + b, 0);
const moveInfo = id => ({ id, type: MOVES[id].type, big: Boolean(MOVES[id].big) });

export class StoryBattle {
  // ev：故事事件（kind 'battle'）；onEnd(won)：打完（或認輸）時
  constructor({ stage, game, dex, audio, hud }, ev, { onEnd }) {
    Object.assign(this, { st: stage, game, dex, audio, hud, ev, onEnd });
    const power = B.retryPower(ev.battle.power, lossesOf(game.state.story, ev.id));
    this.foes = ev.battle.foes.map((species, i) => ({
      i, species,
      f: B.fighter({ species, types: dex.get(species).types, side: 'foe', grade: B.gradeOf(dex, species), power }),
      pet: null,
    }));
    this.fi = 0; // 現在是第幾隻對手
    this.mine = new Map(); // uid → fighter（上場過的才有）
    this.cur = null; // 你現在上場的夥伴（Pet）
    this.phase = 'pick'; // pick → you → anim → foe → … → over
    this.wait = 0; // 倒數（秒），到了做 this.then
    this.then = null;
    this.over = false;
  }

  // 對戰的位置：桌面下方中間，站在對戰面板（ui/battlehud.js）的上面
  spots() {
    const st = this.st, S = st.S, cx = st.W / 2, y = Math.round(this.hud.top() * st.dpr) - 10 * S;
    return { you: { x: cx - GAP * S, y, face: 1 }, foe: { x: cx + GAP * S, y, face: -1 } };
  }

  // 沒上場的夥伴：走到兩旁觀戰，不要擋在中間
  clearArena() {
    const st = this.st, S = st.S, cx = st.W / 2, half = (GAP + 70) * S;
    for (const p of st.pets.values()) {
      if (p === this.cur || p.inBattle || p.leaving || p.perch || ['held', 'fall', 'evolving', 'walk', 'look'].includes(p.state)) continue;
      p.endPlay?.();
      p.habit = null;
      p.moveCtx = null;
      if (Math.abs(p.x - cx) > half) continue;
      const side = p.x < cx ? -1 : 1;
      p.target = { x: Math.max(40 * S, Math.min(st.W - 40 * S, cx + side * (half + (30 + Math.random() * 80) * S))), y: p.gy };
      p.onArrive = () => { p.facing = side < 0 ? 1 : -1; p.set('look', 3); };
      p.set('walk', 6);
    }
  }

  start() {
    this.st.battle = this;
    this.hud.open(this);
    this.sendFoe();
    this.askPartner('要派誰出場？');
  }

  // 還能上場的夥伴（在桌面上、沒在旅行、沒倒下）
  bench() {
    return [...this.st.pets.values()].filter(p => !p.leaving && !p.mon.trip && p.state !== 'held' && p.state !== 'evolving' && (this.mine.get(p.uid)?.hp ?? 1) > 0);
  }

  askPartner(msg) {
    this.phase = 'pick';
    const list = this.bench().filter(p => p !== this.cur);
    if (!list.length) { this.finish(false); return; }
    this.hud.pick(list, msg, { canCancel: Boolean(this.cur && this.mine.get(this.cur.uid)?.hp > 0) });
  }

  // ---------- 上場 ----------
  sendOut(pet, { swap = false } = {}) {
    if (this.over || this.phase !== 'pick') return;
    this.phase = 'enter';
    this.hud.moves(null);
    const st = this.st, S = st.S, spot = this.spots().you;
    if (this.cur && this.cur !== pet) this.retire(this.cur);
    this.cur = pet;
    pet.endPlay?.();
    pet.perch = null;
    pet.perchJump = null;
    pet.habit = null;
    pet.moveCtx = null;
    pet.inBattle = true;
    // 從球裡出來：直接出現在自己的位置
    pet.x = spot.x; pet.gy = spot.y; pet.z = 0; pet.vx = pet.vy = pet.vz = 0;
    pet.facing = 1;
    pet.battleSpot = spot;
    pet.set('battle');
    st.fx.ring(pet.x, pet.y - (pet.asset.h * S) / 2, S, '#ffffff', 26);
    st.fx.sparkles(pet.x, pet.y - (pet.asset.h * S) / 2, S, 6, 18);
    this.audio.sfx('appear');
    let f = this.mine.get(pet.uid);
    if (!f) {
      f = B.fighter({ uid: pet.uid, species: pet.mon.species, types: pet.types, side: 'you', hearts: hearts(pet.mon.affection), training: trainingOf(pet.mon), grade: B.gradeOf(this.dex, pet.mon.species) });
      this.mine.set(pet.uid, f);
    }
    const name = this.game.displayName(pet.mon);
    this.hud.setSide('you', { name, hp: f.hp, max: f.max, species: pet.mon.species, count: this.bench().length });
    this.hud.say(`去吧！${name}！`);
    // 有進化石＋超級手環：一上場就超級進化（跟原作一樣，一場只有一隻）
    let delay = 0.7;
    if (!this.megaUsed && this.game.canMega(pet.uid)) {
      this.megaUsed = pet.uid;
      B.megaEvolve(f);
      setTimeout(() => { if (!this.over && this.cur === pet) { transform(pet, 'mega', { duel: true }); this.hud.say(`${name}的超級進化石回應了你的超級手環！`); } }, 500);
      delay = 2.4;
    }
    // 換夥伴會用掉這一回合
    this.after(delay, swap ? () => this.foeTurn() : () => this.yourTurn());
  }

  // 下場（換夥伴、或對戰結束）：站回旁邊
  retire(pet) {
    pet.inBattle = false;
    pet.battleSpot = null;
    if (pet.state === 'battle' || pet.state === 'move') pet.set('idle', 1);
    const S = this.st.S;
    pet.x -= 70 * S; // 讓出位置給下一隻
    pet.clamp();
    endDuelForms(pet);
  }

  sendFoe() {
    const st = this.st, spot = this.spots().foe, foe = this.foes[this.fi];
    const mon = { uid: `foe:${this.ev.id}:${foe.i}`, species: foe.species, form: null, shiny: false, affection: 0, training: {}, nickname: null, memory: [] };
    const pet = new Pet(st, mon, { x: spot.x, gy: spot.y, fromBall: true });
    pet.guest = true;
    pet.facing = -1;
    pet.battleSpot = spot;
    st.guests.push(pet);
    foe.pet = pet;
    this.audio.sfx('appear');
    this.hud.setSide('foe', { name: this.dex.name(foe.species), hp: foe.f.hp, max: foe.f.max, species: foe.species, count: this.foes.length - this.fi });
  }

  // ---------- 回合 ----------
  yourTurn() {
    if (this.over) return;
    this.phase = 'you';
    const foe = this.foes[this.fi];
    const ids = battleMovesFor(this.dex, this.cur.mon.species, this.cur.mon);
    this.hud.moves(ids.map(id => ({ id, zh: MOVES[id].zh, type: MOVES[id].type, hint: B.moveHint(moveInfo(id), foe.f) })), { canSwitch: this.bench().length > 1 });
    this.hud.say(`${this.game.displayName(this.cur.mon)}要怎麼做？`);
  }

  // 你選了一招
  choose(id) {
    if (this.phase !== 'you' || this.over) return;
    this.phase = 'anim';
    this.hud.moves(null);
    const foe = this.foes[this.fi];
    this.play(this.cur, foe.pet, this.mine.get(this.cur.uid), foe.f, id, () => {
      if (foe.f.hp <= 0) this.foeDown();
      else this.after(TURN_PAUSE, () => this.foeTurn());
    });
  }

  foeTurn() {
    if (this.over) return;
    this.phase = 'foe';
    const foe = this.foes[this.fi], me = this.mine.get(this.cur.uid);
    const ids = battleMovesFor(this.dex, foe.species);
    const pick = B.pickFoeMove(foe.f, me, ids.map(moveInfo), Math.random);
    this.play(foe.pet, this.cur, foe.f, me, pick.id, () => {
      if (me.hp <= 0) this.youDown();
      else this.after(TURN_PAUSE, () => this.yourTurn());
    });
  }

  // 出一招：先算結果，再照著演（躲開就打到旁邊）；演完呼叫 done
  play(atk, def, af, df, id, done) {
    const r = B.attack(af, df, moveInfo(id), Math.random);
    const name = atk.guest ? `對手的${this.dex.name(atk.mon.species)}` : this.game.displayName(atk.mon);
    this.hud.say(`${name}使出了${MOVES[id].zh}！`);
    let finished = false;
    const end = () => {
      if (finished || this.over) return;
      finished = true;
      clearTimeout(guard);
      if (!atk.leaving && !['faint', 'held', 'fall'].includes(atk.state)) atk.set('battle');
      if (r.kind === 'status') this.hud.say(B.STATUS_ZH[r.effect]);
      done();
    };
    const guard = setTimeout(end, ANIM_LIMIT * 1000);
    const S = this.st.S;
    if (r.kind === 'dodge') {
      def.hopT = 0.35;
      const side = def.x > atk.x ? 1 : -1;
      useMove(atk, id, { x: def.x + side * 34 * S, y: def.gy - (def.asset.h * S) / 2 }, { announce: false, onEnd: end });
      setTimeout(() => { this.st.fx.text(def.head().x, def.head().y - 18 * S, '躲開了！', S, '#8ec5ff'); this.hud.say(`${this.game.displayName(def.mon)}為了你躲開了攻擊！`); }, 450);
      return;
    }
    useMove(atk, id, def, {
      announce: false,
      onHit: () => this.landed(def, df, r),
      onEnd: () => { if (r.kind === 'hit' && !r.shown) this.landed(def, df, r); end(); },
    });
  }

  // 打中了：扣血、跳字
  landed(def, df, r) {
    if (r.shown || r.kind !== 'hit') return;
    r.shown = true;
    const S = this.st.S, h = def.head();
    this.hud.setHp(def.guest ? 'foe' : 'you', df.hp);
    const lines = [];
    if (r.eff === 0) lines.push(['好像沒有效果…', '#b8b8c8']);
    else if (r.eff > 1) lines.push(['效果絕佳！', '#ffb13a']);
    else if (r.eff < 1) lines.push(['效果不太好…', '#8ec5ff']);
    if (r.crit) lines.push(['擊中要害！', '#ffe066']);
    lines.forEach(([t, c], i) => setTimeout(() => this.st.fx.text(h.x, h.y - (18 + i * 10) * S, t, S, c), i * 250));
    if (lines.length) this.hud.say(lines.map(l => l[0]).join(' '));
    def.showEmote(r.eff === 0 ? '?' : r.eff > 1 ? '@' : '!', 0.9);
    if (r.endure) setTimeout(() => { this.hud.say(`${this.game.displayName(def.mon)}為了不讓你難過，撐住了！`); def.showEmote('!', 1.4); }, 500);
  }

  foeDown() {
    const foe = this.foes[this.fi];
    foe.pet.set('faint', 1);
    this.hud.say(`對手的${this.dex.name(foe.species)}倒下了！`);
    this.audio.sfx('flee');
    this.after(1.1, () => {
      foe.pet.gone = true;
      this.fi++;
      if (this.fi >= this.foes.length) { this.finish(true); return; }
      this.sendFoe();
      this.hud.say(`對手派出了${this.dex.name(this.foes[this.fi].species)}！`);
      this.after(1, () => this.yourTurn());
    });
  }

  youDown() {
    const pet = this.cur;
    pet.set('faint', 99);
    pet.showEmote('…', 1.5);
    this.hud.setSide('you', { name: this.game.displayName(pet.mon), hp: 0, max: 100, species: pet.mon.species, count: this.bench().length });
    this.hud.say(`${this.game.displayName(pet.mon)}倒下了……`);
    this.after(1.2, () => {
      pet.inBattle = false;
      pet.battleSpot = null;
      pet.x -= 70 * this.st.S;
      pet.clamp();
      endDuelForms(pet);
      this.cur = null;
      this.askPartner('下一隻要派誰？');
    });
  }

  // 認輸
  giveUp() {
    if (this.over || this.phase === 'anim' || this.phase === 'foe') return;
    this.finish(false);
  }

  finish(won) {
    if (this.over) return;
    this.over = true;
    this.phase = 'over';
    this.wait = 0;
    this.then = null;
    this.hud.close();
    for (const f of this.foes) if (f.pet) f.pet.gone = true;
    // 上場過的夥伴：站起來；贏了一起開心
    for (const uid of this.mine.keys()) {
      const p = this.st.pets.get(uid);
      if (!p) continue;
      p.inBattle = false;
      p.battleSpot = null;
      endDuelForms(p);
      if (['battle', 'move', 'faint'].includes(p.state)) p.set(won ? 'happy' : 'sit', won ? 0.6 : 1.5);
      p.showEmote(won ? '♪' : '…', 1.4);
    }
    if (this.st.battle === this) this.st.battle = null;
    this.onEnd?.(won, [...this.mine.keys()]);
  }

  // ---------- 每一幀（stage.update 呼叫）----------
  after(sec, fn) { this.wait = sec; this.then = fn; }

  update(dt) {
    if (this.over) return;
    this.st.markBusy(0.5);
    this.clearT = (this.clearT ?? 0) - dt;
    if (this.clearT <= 0) { this.clearT = 0.5; this.clearArena(); }
    if (this.then) {
      this.wait -= dt;
      if (this.wait <= 0) { const fn = this.then; this.then = null; fn(); }
    }
    // 你的夥伴在等你選招的時候被別的事打斷（例如從別的地方被叫走）：拉回來
    const p = this.cur;
    if (p && (this.phase === 'you' || this.phase === 'pick') && !['battle', 'move', 'faint', 'held', 'fall'].includes(p.state)) {
      p.battleSpot = this.spots().you;
      p.set('battle');
    }
    if (p?.leaving) { this.cur = null; this.askPartner('下一隻要派誰？'); }
  }
}
