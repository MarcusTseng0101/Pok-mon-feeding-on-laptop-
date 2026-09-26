// 導演：把遊戲規則（core/）和舞台演出（scene/）、介面（ui/）串起來。
import { Pet } from './scene/pet.js';
import { watchEating } from './scene/behaviors.js';
import { Spot, WildMon, ThrownBall, Prop } from './scene/wild.js';
import { EggProp } from './scene/egg.js';
import { REFRESH_MS } from '../core/weather.js';
import { ACHIEVEMENTS } from '../core/achievements.js';
import { planSpawn, nextSpawnDelay, shouldDropCell, timeOfDay } from '../core/encounter.js';
import { ringBonus, catchProbability, BALLS } from '../core/capture.js';
import { shinyChance } from '../core/shiny.js';
import { spriteKey, inheritForm } from '../core/forms.js';
import { puffName, hearts, FLAVOR_ZH, parsePuffKey } from '../core/amie.js';
import * as art from './gfx/art.js';
import { socialized } from '../core/mind.js';

const TYPING_WATCH_AFTER = 30; // 連續打字幾秒後過來看（秒）
const TYPING_COOLDOWN = 3 * 60 * 1000; // 猜的，可調整：不要一直跑過來

const LURE_MINUTES = 10;

export class Director {
  constructor({ stage, game, dex, sprites, audio, api, rng, dev }) {
    Object.assign(this, { stage, game, dex, sprites, audio, api, rng, dev });
    this.ui = null; // app.js 建好 UI 後設定
    this.signals = { cpuHot: false, justPluggedIn: false, returnedFromIdle: false, idleSeconds: 0, returnedAt: 0 };
    this.enc = null; // 目前的遭遇 { wild(core), entity, deadline, throwing }
    this.lure = null; // { puff, flavor, until, prop }
    this.evolution = null;
    this.nextSpawnAt = Date.now() + (dev ? 5000 : 60_000); // 開啟後一分鐘內先來一隻
    this.bindStage();
    this.bindGame();
  }

  // ---------- 環境 ----------
  ctx() {
    const d = new Date();
    return {
      hour: d.getHours(),
      weekday: d.getDay(),
      cpuHot: this.signals.cpuHot,
      justPluggedIn: this.signals.justPluggedIn,
      returnedFromIdle: this.signals.returnedFromIdle,
      lure: this.lure && Date.now() < this.lure.until ? this.lure.flavor : null,
      lureTier: this.lure && Date.now() < this.lure.until ? parsePuffKey(this.lure.puff).tier : null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, // 彩粉蝶的花紋依所在地區決定
      weather: this.game.state.weather?.enabled ? this.weather ?? null : null,
      vivillon: this.game.state.pendingVivillon[0], // 成就獎勵：下一隻粉蝶蟲的特別花紋（沒有就是 undefined）
    };
  }

  setSignals(s) {
    if (!s) return;
    const returned = s.returnedAt && s.returnedAt !== this.signals.returnedAt;
    this.signals = s;
    this.updateEnv();
    if (returned) this.welcomeBack();
  }

  updateEnv() {
    const h = new Date().getHours();
    const idle = this.signals.idleSeconds ?? 0;
    const env = this.stage.env;
    env.sleepy = (h >= 1 && h < 6) || idle > 5 * 60;
    env.userActive = idle < 60;
    env.hour = h;
    env.plugged = this.signals.justPluggedIn;
    env.lure = this.lure ? { x: this.lure.prop.x, y: this.lure.prop.y } : null;
  }

  ambientSong() {
    const tod = timeOfDay(new Date().getHours());
    return tod === 'night' ? 'nocturne' : 'cafe';
  }

  refreshMusic() {
    if (this.evolution) return;
    this.audio.playSong(this.enc ? 'wild' : this.ambientSong());
  }

  welcomeBack() {
    let greeted = 0;
    for (const pet of this.stage.pets.values()) {
      if (hearts(pet.mon.affection) >= 3 && pet.state !== 'held') {
        pet.set('follow', 3);
        pet.showEmote('♥', 2);
        greeted++;
      }
    }
    if (greeted) this.ui?.toast('歡迎回來！夥伴們跑過來迎接你了');
    this.nextSpawnAt = Math.min(this.nextSpawnAt, Date.now() + nextSpawnDelay(this.game.state.settings.encounterRate, this.ctx(), this.rng, { dev: this.dev }));
  }

  // ---------- 夥伴同步 ----------
  // 存檔整份換掉（同步之後）：桌面上的寶可夢改指到新的資料，再依照誰在外面叫出來／收回去
  rebindPets() {
    for (const p of this.stage.pets.values()) {
      const m = this.game.mon(p.uid);
      if (m) p.mon = m;
    }
    this.syncPets();
  }

  syncPets() {
    const quiet = this.game.state.settings.quiet;
    const want = new Set(quiet ? [] : this.game.outMons().map(m => m.uid));
    for (const uid of [...this.stage.pets.keys()]) if (!want.has(uid)) this.stage.removePet(uid);
    const outs = this.game.outMons();
    outs.forEach((mon, i) => {
      if (!want.has(mon.uid) || this.stage.pets.has(mon.uid)) return;
      // 回到上次關掉時的位置；新出來的平均分散在螢幕上，不要擠在一起
      const st = this.stage;
      const pos = mon.pos
        ? { x: mon.pos.x * st.W, gy: mon.pos.y * st.H }
        : { x: st.W * (0.15 + (0.7 * (i + 0.5)) / outs.length + (Math.random() - 0.5) * 0.06), gy: st.H * (0.45 + Math.random() * 0.45) };
      this.sprites.get(spriteKey(mon.species, mon.form), mon.shiny).then(() => {
        if (this.game.mon(mon.uid)?.out && !this.game.state.settings.quiet) st.addPet(mon, { ...pos, fromBall: true });
      });
    });
    this.stage.hidden = quiet;
  }

  // ---------- 每一幀／每秒 ----------
  update(dt) {
    const now = Date.now();
    const quiet = this.game.state.settings.quiet;
    const playing = Boolean(this.ui?.minigames.active); // 玩小遊戲的時候不會有野生寶可夢來打擾
    const focusing = Boolean(this.game.state.focus.active); // 專注中也不會
    this.stage.env.focus = focusing;
    if (focusing && this.game.focusRemaining() <= 0) this.finishFocus();
    if (!focusing) this.typingReaction(now);
    if (!quiet && !playing && !focusing && !this.stage.spot && !this.enc && now >= this.nextSpawnAt && this.game.state.starterChosen) this.spawn();
    if (this.enc && !this.enc.throwing && now > this.enc.deadline) this.wildLeaves('等不及，自己跑走了…');
    if (this.lure && now > this.lure.until) {
      this.lure.prop.life = 0;
      this.lure = null;
      this.updateEnv();
      this.ui?.toast('誘餌泡芙的香味散掉了');
    }
    if (this.evolution) this.updateEvolution(dt);
  }

  // ---------- 天氣 ----------
  // 每 30 分鐘查一次；查不到（沒網路、網站掛了）就沿用上一次的結果，不會讓遊戲卡住
  async refreshWeather(force = false) {
    const w = this.game.state.weather;
    if (!w?.enabled || this.game.state.settings.quiet) { if (!w?.enabled) this.setWeather(null); return; }
    if (!force && Date.now() - (this.weatherAt ?? 0) < REFRESH_MS) return;
    this.weatherAt = Date.now();
    const r = await Promise.resolve(this.api.getWeather?.(w.lat, w.lon)).catch(() => null);
    if (r?.weather) this.setWeather(r.weather);
  }

  setWeather(kind) {
    if (this.weather === kind) return;
    this.weather = kind;
    this.stage.weatherFx.set(kind);
    this.stage.env.weather = kind;
    this.ui?.refreshSoon();
  }

  // ---------- 孵蛋 ----------
  eggColor(egg) { return art.TYPE_COLORS[this.dex.get(egg.species).types[0]] ?? '#7ac86a'; }

  // 每 10 秒：游標移動的距離＋有沒有在操作電腦 → 步數
  tickEggs(seconds = 10) {
    const px = this.stage.takeCursorTravel();
    const active = (this.signals.idleSeconds ?? 999) < seconds ? seconds : 0;
    if (this.game.state.eggs.length) this.game.addEggSteps(px, active);
  }

  // 好了的蛋出現在桌面上（夥伴旁邊），點一下開始孵化
  showReadyEggs() {
    const st = this.stage, S = st.S;
    if (this.game.state.settings.quiet) return;
    for (const egg of this.game.readyEggs()) {
      if (st.props.some(p => p.kind === 'egg' && p.uid === egg.uid)) continue;
      const near = [...st.pets.values()].find(p => !p.perch && !p.leaving);
      const x = near ? Math.max(30 * S, Math.min(st.W - 30 * S, near.x + (Math.random() < 0.5 ? -1 : 1) * (near.asset.w / 2 + 16) * S)) : st.W / 2;
      const y = near ? near.gy : st.H * 0.8;
      st.props.push(new EggProp(st, { uid: egg.uid, x, y, color: this.eggColor(egg), onHatch: e => this.hatch(e) }));
      this.ui?.toast('蛋好像動了一下…點一下看看！', { icon: art.egg(this.eggColor(egg), 1) });
    }
  }

  hatch(prop) {
    const st = this.stage;
    const mon = this.game.hatchEgg(prop.uid, { pos: { x: prop.x / st.W, y: prop.y / st.H } }); // 從蛋的位置出來
    if (!mon) return;
    this.syncPets();
    this.audio.jingle('newEntry', { resumeWith: this.ambientSong() });
    this.ui?.toast(`蛋孵化了！是${mon.shiny ? '色違的' : ''}${this.dex.name(mon.species)}！`, { icon: art.sparkle, kind: 'dex' });
    for (const p of st.pets.values()) if (p.uid !== mon.uid && p.free && Math.hypot(p.x - prop.x, p.gy - prop.y) < 300 * st.S) { p.facing = prop.x > p.x ? 1 : -1; p.showEmote('!', 1.2); }
  }

  // ---------- 專注番茄鐘 ----------
  finishFocus() {
    const r = this.game.finishFocus();
    if (!r) return;
    this.audio.jingle('newEntry', { resumeWith: this.ambientSong() });
    this.ui?.toast(`專注 ${r.minutes} 分鐘完成！拿到了${puffName(r.puff)}${r.streak > 1 ? `（連續 ${r.streak} 天）` : ''}`, { icon: art.puff(r.puff), kind: 'dex' });
    for (const p of this.stage.pets.values()) {
      if (p.perch || !['idle', 'sit', 'sleep', 'look'].includes(p.state)) continue;
      p.set('happy', 1.2);
      p.showEmote('♥', 1.5);
    }
  }

  // ---------- 打字反應（不讀鍵盤：看 signals.typing） ----------
  // 連續打字超過 30 秒：1–2 隻夥伴跑到游標旁邊圍觀
  typingReaction(now) {
    const s = this.signals, st = this.stage;
    if (!s.typing || (s.typingSeconds ?? 0) < TYPING_WATCH_AFTER || now < (this.typingCooldown ?? 0) || !st.pointer.known) return;
    if (this.enc || this.ui?.minigames.active) return;
    this.typingCooldown = now + TYPING_COOLDOWN;
    const free = [...st.pets.values()].filter(p => p.free && !p.partner && !p.perch).sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.5 ? 1 : 2);
    this.typingWatchers = free.map(p => p.uid); // 這次是誰跑過來（除錯、測試用）
    const S = st.S;
    free.forEach((p, i) => {
      const b = p.bounds();
      const side = i === 0 ? -1 : 1;
      p.target = { x: Math.max(b.x0, Math.min(b.x1, st.pointer.x + side * (50 + Math.random() * 40) * S)), y: Math.max(b.y0, Math.min(b.y1, st.pointer.y + (30 + Math.random() * 40) * S)) };
      p.set('walk');
      p.onArrive = () => {
        p.facing = st.pointer.x > p.x ? 1 : -1;
        p.set('look', 3);
        p.showEmote(Math.random() < 0.5 ? '♪' : '!', 1.5);
      };
    });
  }

  scheduleNext() {
    this.nextSpawnAt = Date.now() + nextSpawnDelay(this.game.state.settings.encounterRate, this.ctx(), this.rng, { dev: this.dev });
  }

  async spawn(forcePlan) {
    const ctx = this.ctx();
    const plan = forcePlan ?? planSpawn(ctx, this.game.state, this.dex, this.rng);
    this.nextSpawnAt = Infinity;
    await this.sprites.get(spriteKey(plan.speciesId, plan.form), plan.shiny); // 先載好，點下去才不會看到替代圖
    if (this.stage.spot || this.enc) return;
    const life = this.dev ? 60 : plan.special ? 300 : 180;
    this.stage.spot = new Spot(this.stage, plan, { life });
    if (plan.special) this.ui?.toast('好像有什麼不尋常的氣息…', { icon: art.sparkle });
    if (shouldDropCell(this.game.state, this.rng)) this.dropCell();
  }

  dropCell() {
    const S = this.stage.S;
    const prop = new Prop(this.stage, {
      kind: 'cell',
      x: this.stage.W * (0.1 + Math.random() * 0.8),
      y: this.stage.H * (0.25 + Math.random() * 0.68),
      life: 300,
      onClick: () => {
        prop.life = 0;
        prop.t = Math.max(prop.t, 0);
        prop.gone = true;
        this.game.addZygardeCell();
        this.audio.sfx('collect');
        this.stage.fx.sparkles(prop.x, prop.y - 4 * S, S, 6, 12);
        const n = this.game.state.zygardeCells;
        this.ui?.toast(n >= 10 ? '基格爾德核心集滿 10 顆了！有什麼正在聚集…' : `撿到基格爾德核心（${n}／10）`, { icon: art.zygardeCell(0) });
      },
    });
    this.stage.props.push(prop);
  }

  placeLure(puff) {
    if (this.lure) { this.ui?.toast('桌面上已經有一個誘餌了'); return false; }
    if (!this.game.takePuff(puff)) return false;
    const { flavor } = parsePuffKey(puff);
    const prop = new Prop(this.stage, {
      kind: 'lure',
      puff,
      x: this.stage.W * (0.2 + Math.random() * 0.6),
      y: this.stage.H * (0.45 + Math.random() * 0.45),
      life: LURE_MINUTES * 60,
      onClick: () => {
        const left = Math.max(0, Math.ceil((this.lure?.until - Date.now()) / 60000));
        this.ui?.toast(`${puffName(puff)}的香味還會持續約 ${left} 分鐘`);
      },
    });
    this.stage.props.push(prop);
    this.lure = { puff, flavor, until: Date.now() + LURE_MINUTES * 60_000, prop };
    this.updateEnv();
    this.audio.sfx('open');
    this.ui?.toast(`放好${FLAVOR_ZH[flavor]}泡芙了，喜歡這個香味的寶可夢會比較快出現`);
    if (!this.enc && !this.stage.spot) this.scheduleNext();
    return true;
  }

  // ---------- 舞台事件 ----------
  bindStage() {
    const st = this.stage;
    st.on('stroke', pet => {
      if (pet.state === 'evolving' || pet.state === 'eat') return;
      const r = this.game.stroke(pet.uid);
      pet.onStroke(r);
      if (r?.affectionGain > 0 && Math.random() < 0.3) this.audio.sfx('heart');
    });
    st.on('click', target => {
      this.audio.resume();
      if (target instanceof Pet) this.ui?.openPetBubble(target);
      else if (target instanceof Spot) this.beginEncounter(target);
      else if (target instanceof WildMon) this.ui?.showEncounter(this.enc);
      else target?.onClick?.(); // 道具、蛋
    });
    st.on('modeClick', target => {
      const m = st.mode;
      if (m?.type === 'aim') {
        if (target instanceof WildMon && target.state === 'idle') this.throwBall(m.ball);
        else this.setMode(null);
      } else if (m?.type === 'minigame') {
        m.host.click(st.pointer.x, st.pointer.y);
      } else if (m?.type === 'feed') {
        const ok = m.target === 'wild' ? target instanceof WildMon : target instanceof Pet;
        if (ok) st.fire('feed', target, m.puff);
        else this.setMode(null);
      }
    });
    st.on('feed', (target, puff) => this.feed(target, puff));
    st.on('cancelMode', () => this.setMode(null));
    st.on('escape', () => {
      if (this.ui?.minigames.active) this.ui.minigames.closeMinigame('esc');
      else if (st.mode) this.setMode(null);
      else this.ui?.closeAll();
    });
    st.on('petPicked', () => this.ui?.closeBubble());
    st.on('petReleased', (pet, { wasUpsideDown }) => {
      if (wasUpsideDown && this.game.evolutionStatus(pet.uid, { heldUpsideDown: true })?.ready) {
        this.startEvolution(pet, { heldUpsideDown: true });
      }
    });
    st.on('spotGone', () => { if (!this.enc) this.scheduleNext(); });
    st.on('bond', (a, b, n) => {
      this.game.bond(a.uid, b.uid, n);
      this.game.playedTogether(a.uid, b.uid); // 兩邊都記得跟誰玩過
      for (const p of [a, b]) if (p.mon.mind) socialized(p.mon.mind, 8);
    });
    st.on('duelResult', (w, l) => this.game.duelResult(w.uid, l.uid));
    st.on('perched', () => { this.game.state.stats.perches++; });
    // 超級進化、牽絆變身（只是演出，不會存檔）
    st.on('formChange', (pet, form) => {
      const name = this.game.displayName(pet.mon);
      if (form === 'mega') this.ui?.toast(`${name}超級進化成超級蒂安希了！`, { icon: art.sparkle });
      if (form === 'ash') this.ui?.toast(`${name}和夥伴的羈絆產生了共鳴…牽絆變身！`, { icon: art.sparkle });
      if (form) pet.stage.fx.hearts(pet.x, pet.head().y, pet.S, 2);
    });
  }

  setMode(mode) {
    const prev = this.stage.mode;
    this.stage.mode = mode;
    this.ui?.onModeChange(mode);
    // 桌面小遊戲的模式被別的東西取消了（右鍵、開始餵泡芙…）：遊戲也要結束，不然會玩到一半沒有滑鼠
    if (prev?.type === 'minigame' && mode?.type !== 'minigame') prev.host.onModeLost();
  }

  feedMode(puff, target = 'pet') {
    if (!(this.game.state.bag.puffs[puff] > 0)) return;
    this.setMode({ type: 'feed', puff, target });
    this.ui?.toast(target === 'wild' ? '把泡芙拿到野生寶可夢嘴邊' : '把泡芙拿到寶可夢嘴邊，牠就會吃（右鍵取消）');
  }

  feed(target, puff) {
    const st = this.stage;
    if (target instanceof WildMon) {
      const r = this.game.feedWild(this.enc.wild, puff);
      if (!r.ok) return;
      this.setMode(null);
      target.startEat(puff);
      const emote = r.reaction === 'liked' ? '♥' : r.reaction === 'disliked' ? '…' : '♪';
      setTimeout(() => { target.emote = { img: art.emotes[emote], until: target.t + 1.5 }; }, 1300);
      this.ui?.showEncounter(this.enc);
      return;
    }
    const pet = target;
    if (pet.state === 'evolving' || pet.state === 'held') return;
    const r = this.game.feed(pet.uid, puff);
    if (!r.ok) {
      if (r.reason === 'full') {
        pet.refuse();
        this.audio.sfx('refuse');
        this.ui?.toast(`${this.game.displayName(pet.mon)}吃不下了`);
      }
      if (r.reason === 'no-puff') this.setMode(null);
      return;
    }
    pet.startEat(puff);
    watchEating(pet);
    this.setMode(null);
    st.markBusy(2);
    setTimeout(() => {
      const name = this.game.displayName(pet.mon);
      if (r.reaction === 'liked') {
        pet.showEmote('♥', 1.8);
        st.fx.hearts(pet.head().x, pet.head().y, st.S, 4);
        this.audio.sfx('happy');
        this.ui?.toast(`${name}非常喜歡${FLAVOR_ZH[parsePuffKey(puff).flavor]}口味！`);
      } else if (r.reaction === 'disliked') {
        pet.showEmote('…', 1.8);
        this.ui?.toast(`${name}好像不太喜歡這個口味…`);
      } else {
        pet.showEmote('♪', 1.5);
        st.fx.hearts(pet.head().x, pet.head().y, st.S, 1);
      }
      this.ui?.refresh();
    }, 1300);
  }

  // ---------- 遭遇與捕獲 ----------
  beginEncounter(spot) {
    const wild = this.game.startEncounter(spot.plan);
    this.stage.spot = null;
    const entity = new WildMon(this.stage, wild, spot);
    this.stage.wild = entity;
    const legendary = this.dex.get(wild.speciesId).legendary || this.dex.get(wild.speciesId).mythical;
    this.enc = { wild, entity, deadline: Date.now() + (legendary ? 240_000 : 120_000), throwing: false };
    this.audio.sfx('appear');
    setTimeout(() => this.refreshMusic(), 350);
    if (wild.shiny) {
      setTimeout(() => this.audio.sfx('sparkle'), 300);
      setTimeout(() => this.audio.sfx('sparkle'), 650);
      this.ui?.toast(`哇！是色違的${this.dex.name(wild.speciesId)}！`, { icon: art.sparkle, kind: 'dex' });
    }
    this.petsReact(entity, wild.shiny ? '✦' : '!');
    this.ui?.showEncounter(this.enc);
  }

  // 夥伴們看向野生寶可夢／替捕獲歡呼／看牠離開
  petsReact(target, emote, state = null) {
    for (const pet of this.stage.pets.values()) {
      if (!pet.free || pet.partner) continue;
      if (Math.random() < 0.3) continue;
      pet.facing = target.x > pet.x ? 1 : -1;
      if (state) pet.set(state, state === 'cheer' ? 1.1 : 1.5);
      else pet.set('idle', 2 + Math.random() * 2);
      setTimeout(() => pet.showEmote(emote, 1.4), Math.random() * 400);
    }
  }

  catchChance(ball) {
    if (!this.enc) return 0;
    return catchProbability(this.dex.get(this.enc.wild.speciesId).captureRate, { ball, puff: this.enc.wild.puff });
  }

  aim(ball) {
    if (!this.enc || this.enc.throwing) return;
    if (!(this.game.state.bag.balls[ball] > 0)) { this.ui?.toast(`沒有${BALLS[ball].zh}了`); return; }
    const p = this.catchChance(ball);
    const ringColor = p > 0.5 ? '#7ee06a' : p > 0.2 ? '#ffd84a' : '#ff5a4a';
    this.setMode({ type: 'aim', ball, ringColor });
  }

  throwBall(ball) {
    const enc = this.enc, st = this.stage, S = st.S;
    if (!enc || enc.throwing) return;
    const w = enc.entity;
    const bonus = ringBonus(w.ring());
    const result = this.game.throwBall(enc.wild, ball, bonus.mult);
    this.setMode(null);
    if (!result.ok) { this.ui?.toast(`沒有${BALLS[ball].zh}了`); return; }
    enc.throwing = true;
    enc.deadline = Date.now() + 120_000;
    this.ui?.showEncounter(enc);
    this.audio.sfx('throw');
    const c = w.center();
    const from = { x: c.x + (c.x < st.W / 2 ? 1 : -1) * Math.min(st.W * 0.25, 420 * S), y: st.H - 10 * S };
    const ballEntity = new ThrownBall(st, {
      kind: ball,
      from,
      target: c,
      floorY: w.groundY,
      result,
      onHit: () => {
        w.set('absorbed');
        if (bonus.zh) st.fx.text(c.x, c.y - (w.rect().h / 2) - 8 * S, bonus.zh, S, '#ffe066');
      },
      onDone: r => this.afterThrow(r, ballEntity),
    });
    st.balls.push(ballEntity);
    st.markBusy(6);
  }

  afterThrow(r, ballEntity) {
    const enc = this.enc, w = enc.entity, st = this.stage;
    const name = this.dex.name(enc.wild.speciesId);
    if (r.caught) {
      w.set('caught');
      this.audio.jingle('caught', { resumeWith: this.ambientSong() });
      this.ui?.toast(`抓到${enc.wild.shiny ? '色違的' : ''}${name}了！`, { icon: art.balls[ballEntity.kind] });
      setTimeout(() => this.petsReact(ballEntity, '♪', 'cheer'), 600);
      const mon = r.mon;
      setTimeout(() => {
        if (r.isNewSpecies) {
          this.audio.jingle('newEntry', { resumeWith: this.ambientSong() });
          this.ui?.toast(`${name}的資料已登錄到圖鑑！`, { kind: 'dex' });
        }
        const gifts = [];
        for (const [k, n] of Object.entries(r.rewards.balls)) gifts.push(`${BALLS[k].zh}×${n}`);
        for (const p of r.rewards.puffs) gifts.push(puffName(p));
        if (gifts.length) this.ui?.toast(`獲得：${gifts.join('、')}`);
        if (mon.out && !this.game.state.settings.quiet) {
          const pet = this.stage.addPet(mon, { x: ballEntity.x, gy: ballEntity.floorY, fromBall: true });
          if (mon.shiny) this.stage.fx.stars(pet.x, pet.y - (pet.asset.h * this.stage.S) / 2, this.stage.S, 10);
        }
        else this.ui?.toast(`${name}待在夥伴盒裡（桌面上已經有 6 隻了）`);
        this.ui?.refresh();
      }, 1900);
      this.endEncounter();
    } else {
      w.set('reappear');
      setTimeout(() => {
        if (!this.enc) return;
        if (r.fled) {
          this.wildLeaves('逃走了…');
        } else {
          enc.throwing = false;
          const lines = ['啊！差一點點！', '可惡！明明就快抓到了！', '還差一點！'];
          this.ui?.toast(r.shakes >= 2 ? lines[1] : r.shakes === 1 ? lines[2] : lines[0]);
          this.ui?.showEncounter(enc);
        }
      }, 500);
    }
  }

  wildLeaves(reason) {
    if (!this.enc) return;
    const w = this.enc.entity;
    this.game.wildGone(this.enc.wild);
    this.petsReact(w, '…');
    w.set('flee');
    this.audio.sfx('flee');
    this.ui?.toast(`${this.dex.name(this.enc.wild.speciesId)}${reason}`);
    this.endEncounter();
  }

  runAway() {
    if (!this.enc || this.enc.throwing) return;
    this.wildLeaves('回到了牠來的地方');
  }

  endEncounter() {
    this.enc = null;
    this.setMode(null);
    this.ui?.hideEncounter();
    setTimeout(() => this.refreshMusic(), 2600);
    this.scheduleNext();
  }

  // ---------- 進化 ----------
  async startEvolution(pet, extra = {}) {
    const status = this.game.evolutionStatus(pet.uid, extra);
    if (!status?.ready || this.evolution) return;
    pet.endPlay();
    const to = status.evo.to;
    const oldAsset = pet.asset;
    const newAsset = await this.sprites.get(spriteKey(to, inheritForm(pet.mon.species, to, pet.mon.form)), pet.mon.shiny);
    this.ui?.closeBubble();
    pet.set('evolving');
    pet.showEmote('!', 1);
    this.audio.stopSong();
    this.audio.playSong('evolving', { restart: true });
    this.ui?.toast(`咦？${this.game.displayName(pet.mon)}的樣子…`);
    this.evolution = { pet, extra, t: 0, oldAsset, newAsset, flip: 0 };
    this.stage.markBusy(9);
  }

  updateEvolution(dt) {
    const ev = this.evolution, pet = ev.pet, S = this.stage.S;
    ev.t += dt;
    const DUR = 6;
    if (ev.t < DUR) {
      // 新舊兩個白色剪影交替，越來越快
      const speed = 1.5 + ev.t * 2.2;
      ev.flip += dt * speed;
      pet.evolveView = Math.floor(ev.flip) % 2 ? ev.newAsset.white : ev.oldAsset.white;
      if (Math.random() < dt * 6) this.stage.fx.sparkles(pet.x, pet.y - (ev.oldAsset.h * S) / 2, S, 1, 30);
      return;
    }
    const oldName = this.dex.name(pet.mon.species);
    const nick = pet.mon.nickname;
    const r = this.game.evolve(pet.uid, ev.extra);
    this.evolution = null;
    pet.evolveView = null;
    pet.floats = this.dex.floats(pet.mon.species);
    pet.alt = pet.floats ? pet.alt || 60 : 0;
    pet.set('fall');
    this.audio.sfx('flash');
    this.stage.fx.ring(pet.x, pet.y - (pet.asset.h * S) / 2, S, '#ffffff', 60);
    this.stage.fx.stars(pet.x, pet.y - (pet.asset.h * S) / 2, S, 10);
    if (!r) { this.refreshMusic(); return; }
    this.audio.jingle('evolved', { resumeWith: this.ambientSong() });
    this.ui?.toast(`恭喜！${nick ?? oldName}進化成${this.dex.name(r.to)}了！`, { kind: 'dex' });
    this.ui?.refresh();
  }

  // ---------- 遊戲事件 ----------
  bindGame() {
    const g = this.game;
    g.on('heartsUp', ({ uid, hearts: n }) => {
      const pet = this.stage.pets.get(uid);
      if (pet) {
        this.stage.fx.bigHeart(pet.head().x, pet.head().y - 8 * this.stage.S, this.stage.S);
        pet.happy();
      }
      this.audio.jingle('hearts');
      const mon = g.mon(uid);
      this.ui?.toast(n >= 5 ? `${g.displayName(mon)}最喜歡你了！（♥5）` : `${g.displayName(mon)}對你的好感提升了！（♥${n}）`);
    });
    g.on('partnerGift', ({ uid, puff }) => {
      const pet = this.stage.pets.get(uid);
      if (pet) { pet.showEmote(art.puff(puff), 3); pet.happy(); }
      this.audio.jingle('gift');
      this.ui?.toast(`${g.displayName(g.mon(uid))}撿到了${puffName(puff)}送給你！`, { icon: art.puff(puff) });
    });
    g.on('dailyGift', ({ balls, puffs }) => {
      setTimeout(() => {
        this.ui?.toast(`每日禮物：精靈球×${balls.poke}、超級球×${balls.great}、高級球×${balls.ultra}，以及 ${puffs.length} 個泡芙`, { icon: art.balls.poke });
      }, 1500);
    });
    g.on('party', () => this.syncPets());
    g.on('chain', ({ speciesId, count }) => {
      const odds = Math.round(1 / shinyChance(g.state, speciesId));
      this.ui?.toast(`${this.dex.name(speciesId)}連鎖 ×${count}！牠會更常出現，色違機率約 1/${odds}`, { icon: art.sparkle });
    });
    g.on('chainBroken', ({ speciesId, count }) => {
      if (count >= 3) this.ui?.toast(`${this.dex.name(speciesId)}的連鎖（×${count}）中斷了…`);
    });
    g.on('item', ({ item, uid }) => {
      if (item !== 'diancite') return;
      this.audio.jingle('newEntry', { resumeWith: this.ambientSong() });
      this.ui?.toast(`${this.game.displayName(this.game.mon(uid))}好像很信任你…獲得了「蒂安希進化石」！現在牠可以超級進化了`, { icon: art.sparkle, kind: 'dex' });
    });
    g.on('eggFound', ({ egg, parents }) => {
      const [a, b] = parents.map(u => this.game.displayName(this.game.mon(u)));
      this.ui?.toast(`${a}和${b}一起找到了一顆蛋！用游標、在電腦前待著，蛋就會慢慢孵化`, { icon: art.egg(this.eggColor(egg)) });
    });
    g.on('eggReady', () => this.showReadyEggs());
    g.on('achievement', ({ id }) => {
      const a = ACHIEVEMENTS.find(x => x.id === id);
      this.audio.sfx('sparkle');
      this.ui?.toast(`獲得獎章「${a.name}」：${a.desc}`, { icon: art.medal(true), kind: 'dex' });
    });
    g.on('vivillonReward', ({ form }) => {
      this.ui?.toast(form === 'fancy' ? '收集了 20 個獎章！好像有一隻花紋很特別的粉蝶蟲在附近…' : '所有獎章都收集到了！有一隻帶著精靈球花紋的粉蝶蟲出現了…', { icon: art.sparkle, kind: 'dex' });
      this.nextSpawnAt = Math.min(this.nextSpawnAt, Date.now() + 60_000);
    });
    g.on('trimExpired', ({ uid }) => {
      const m = this.game.mon(uid);
      if (m) this.ui?.toast(`${this.game.displayName(m)}的毛長回來了`);
    });
    g.on('charm', () => {
      this.audio.jingle('newEntry', { resumeWith: this.ambientSong() });
      this.ui?.toast('圖鑑捕獲 60 種！獲得了「閃耀護符」，色違更容易出現了', { icon: art.sparkle, kind: 'dex' });
    });
    g.on('bondUp', ({ a, b, level, zh }) => {
      if (level < 2) return;
      const pa = this.stage.pets.get(a), pb = this.stage.pets.get(b);
      for (const p of [pa, pb]) if (p) this.stage.fx.hearts(p.head().x, p.head().y, this.stage.S, 3);
      this.audio.sfx('heart');
      this.ui?.toast(`${g.displayName(g.mon(a))}和${g.displayName(g.mon(b))}變成${zh}了！`);
    });
  }

  // 開發用：立刻生成一個氣息點
  spawnNow() {
    if (this.enc) return;
    this.stage.spot = null;
    this.spawn();
  }
}
