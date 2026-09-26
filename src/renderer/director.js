// 導演：把遊戲規則（core/）和舞台演出（scene/）、介面（ui/）串起來。
import { Pet } from './scene/pet.js';
import { watchEating, WALK_SPEED } from './scene/behaviors.js';
import { Spot, PeekSpot, WildMon, ThrownBall, Prop } from './scene/wild.js';
import { EggProp } from './scene/egg.js';
import { REFRESH_MS } from '../core/weather.js';
import { ACHIEVEMENTS } from '../core/achievements.js';
import { planSpawn, nextSpawnDelay, shouldDropCell, timeOfDay, shouldPeek } from '../core/encounter.js';
import { ringBonus, catchProbability, BALLS } from '../core/capture.js';
import { shinyChance } from '../core/shiny.js';
import { spriteKey, inheritForm } from '../core/forms.js';
import { puffName, hearts, FLAVOR_ZH, parsePuffKey, BERRIES } from '../core/amie.js';
import { BREAK_IDLE } from '../core/symbiosis.js';
import { Garden } from './scene/garden.js';
import * as art from './gfx/art.js';
import { socialized } from '../core/mind.js';
import { PLACES } from '../core/trips.js';
import { startDepart, startReturn } from './scene/travel.js';
import { BaseView } from './scene/base.js';
import { FURNITURE, STAGES } from '../core/base.js';
import * as cards from './gfx/postcards.js';
import * as mail from './gfx/letters.js';
import { StoryBattle } from './scene/battle.js';
import * as A from '../core/attention.js';
import { routineDay, clockOf, minuteOf } from '../core/routine.js';
import { HOLIDAYS } from '../core/calendar.js';
import { MILESTONES } from '../core/together.js';
import { MOODS } from '../core/mood.js';
import { phoneSnapshot } from '../core/phonedata.js';
import { KEY_ITEMS } from '../core/items.js';
import { CAST, BADGES, lossesOf } from '../core/story.js';

const CAST_ZH = who => CAST[who]?.zh ?? '有人';

const TYPING_WATCH_AFTER = 30; // 連續打字幾秒後過來看（秒）
const TYPING_COOLDOWN = 3 * 60 * 1000; // 猜的，可調整：不要一直跑過來

const LURE_MINUTES = 10;

const BASE_PROBLEM = { full: '這一階的基地擺不下更多家具了，升級看看', 'no-medal': '獎盃的數量不能超過獎章', materials: '材料不夠', blocked: '這裡放不下' };

export class Director {
  constructor({ stage, game, dex, sprites, audio, api, rng, dev }) {
    Object.assign(this, { stage, game, dex, sprites, audio, api, rng, dev });
    this.ui = null; // app.js 建好 UI 後設定
    this.signals = { cpuHot: false, justPluggedIn: false, returnedFromIdle: false, idleSeconds: 0, returnedAt: 0 };
    this.enc = null; // 目前的遭遇 { wild(core), entity, deadline, throwing }
    this.lure = null; // { puff, flavor, until, prop }
    this.evolution = null;
    this.spawnKinds = []; // 最近幾次是一般氣息點還是探頭
    this.nextSpawnAt = Date.now() + (dev ? 5000 : 60_000); // 開啟後一分鐘內先來一隻
    this.bindStage();
    this.bindGame();
    this.stage.garden = new Garden(this.stage, () => this.lifeView);
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
    // 共生：記下這段時間最長的閒置；有果實在等、你也離開夠久了 → 不用等到整分鐘，現在就讓牠們吃
    this.maxIdle = Math.max(this.maxIdle ?? 0, s.idleSeconds ?? 0);
    if (this.game.state.symbiosis?.fruit && (s.idleSeconds ?? 0) >= BREAK_IDLE) this.lifeTick();
    // 回來了：早上第一次就說早安，不然是一般的「歡迎回來」
    if (returned && !this.routineTick().includes('greet')) this.welcomeBack();
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

  // ---------- 打擾額度（core/attention.js）----------
  // 所有「沒有你的操作就主動找你」的演出都從這裡過：放行就馬上演，不然排隊（過期就丟）。
  // ttl：排隊多久還有意義（毫秒；Infinity＝一定要演）
  attentionOpts() {
    const s = this.game.state;
    const blocked = Boolean(s.focus.active || s.settings.quiet || this.ui?.minigames?.active);
    const limit = A.limitOf(s.settings.interruptions);
    // 你說今天很累：額度降一級
    return { limit: this.game.moodToday() === 'tired' ? A.lowerLimit(limit) : limit, blocked };
  }
  interrupt({ id, kind, ttl = Infinity }, run) {
    const now = Date.now();
    this.attnQueue ??= [];
    const ev = { id, kind, priority: A.PRIORITY[kind] ?? 0, expiresAt: now + ttl, run };
    const r = A.request(this.game.state.attention, this.attnQueue, ev, now, this.attentionOpts());
    (this.attnLog ??= []).push({ at: now, id, kind, granted: r.granted }); // 除錯、測試用
    if (r.granted) run();
    return r.granted;
  }
  // 每秒一次：額度空出來了就放行排隊中最優先的
  drainAttention() {
    if (!this.attnQueue?.length) return;
    const now = Date.now();
    const ev = A.drain(this.game.state.attention, this.attnQueue, now, this.attentionOpts());
    if (!ev) return;
    this.attnLog.push({ at: now, id: ev.id, kind: ev.kind, granted: true, late: true });
    ev.run();
  }

  refreshMusic() {
    if (this.evolution) return;
    this.audio.playSong(this.enc ? 'wild' : this.ambientSong());
  }

  welcomeBack() {
    this.interrupt({ id: 'welcome', kind: 'greet', ttl: 10 * 60_000 }, () => this.greetUser());
    this.nextSpawnAt = Math.min(this.nextSpawnAt, Date.now() + nextSpawnDelay(this.game.state.settings.encounterRate, this.ctx(), this.rng, { dev: this.dev }));
  }

  // ---------- 作息（core/routine.js）----------
  // 每分鐘記一次你有沒有在用電腦；早上第一次 → 早安，比平常晚 → 打哈欠、靠過來
  routineTick() {
    const s = this.signals ?? {};
    const active = (s.idleSeconds ?? Infinity) < 60;
    const evs = this.game.routineTick({ active, typing: Boolean(s.typing) });
    const day = routineDay(Date.now());
    this.refreshDay();
    for (const e of evs) {
      if (e === 'holiday') {
        const h = HOLIDAYS[this.game.holidaysToday()[0]];
        if (h) this.interrupt({ id: `holiday:${day}`, kind: 'greet', ttl: 12 * 3_600_000 }, () => this.greetUser(h.hello));
      }
      if (e === 'greet') this.interrupt({ id: `greet:${day}`, kind: 'greet', ttl: 2 * 3_600_000 }, () => this.greetUser('早安！夥伴們跑過來跟你打招呼了'));
      if (e === 'bedtime') this.bedtime();
    }
    return evs;
  }

  // 今天的樣子：節日的小裝飾、心情（很累：走慢一點、不跑來玩游標）
  refreshDay() {
    const env = this.stage.env, g = this.game;
    const deco = g.holidaysToday().map(id => HOLIDAYS[id].deco)[0] ?? null;
    env.holidayDeco = deco;
    const mood = g.moodToday();
    env.calm = mood === 'tired';
    env.mood = mood;
  }

  // 心情的日常效果（每秒一次，只是動作、不出聲、不跳通知）：
  //   很開心：偶爾有一隻跳起舞來；壓力大：好感最高的那隻安靜地坐到游標旁邊
  moodTick(dt) {
    const env = this.stage.env, st = this.stage;
    if (!env.mood || env.focus || this.game.state.settings.quiet) return;
    this.moodT = (this.moodT ?? 0) + dt;
    if (env.mood === 'happy' && this.moodT > 45) {
      this.moodT = 0;
      const free = [...st.pets.values()].filter(p => p.free && !p.perch && !p.partner);
      const p = free[Math.floor(Math.random() * free.length)];
      if (p) { p.set('dance', 3); p.showEmote('♪', 1.5); }
    }
    if (env.mood === 'stressed' && this.moodT > 20) {
      this.moodT = 0;
      if (!st.pointer.known || st.pointerStill < 8 || [...st.pets.values()].some(p => p.state === 'cursorSit')) return;
      // 最親近的那隻（正在忙的就等下一次）
      const p = [...st.pets.values()].filter(q => !q.leaving && !q.perch && !q.inBattle).sort((a, b) => b.mon.affection - a.mon.affection)[0];
      if (p?.free) { p.endPlay(); p.cursorSit = { seated: false, side: null }; p.set('cursorSit', 60); this.companion = p.uid; } // 正在跟別隻玩也先放下
    }
  }

  // 你在選單選了今天的心情：馬上有反應（這是你操作的回應，不算打擾）
  moodChosen(id) {
    const st = this.stage;
    this.refreshDay();
    this.moodT = 100; // 開心、壓力大的效果馬上來一次
    this.ui?.toast(`${MOODS[id].emoji} ${MOODS[id].reply}`);
    for (const p of st.pets.values()) {
      if (!p.free || p.perch) continue;
      if (id === 'happy') { p.set('dance', 2.5); p.showEmote('♪', 1.5); }
      else if (id === 'tired') { p.set('sit', 6); p.showEmote('…', 1.5); }
      else p.showEmote('!', 1);
    }
  }

  // ---------- 手機頁面（src/main/phone.js）----------
  // 打開的時候每 30 秒把摘要送過去：只有要顯示的欄位（core/phonedata.js），圖片畫成 data URL
  pushPhone() {
    const g = this.game;
    if (!g.state.settings.phone || !this.api.phoneSnapshot) return null;
    const keyOf = m => `${spriteKey(m.species, m.form)}${m.shiny ? ':s' : ''}`;
    const data = phoneSnapshot(g.state, { now: Date.now(), nameOf: m => g.displayName(m), speciesName: id => this.dex.name(id), spriteKeyOf: keyOf });
    for (const k of new Set([...data.pets, ...data.trips].map(p => p.pic))) {
      const [key, s] = k.split(':');
      try { data.pics[k] = this.sprites.peek(key, s === 's').canvas.toDataURL('image/png'); } catch { /* 還沒載好：下次 */ }
    }
    const byId = new Map(g.state.postcards.map(p => [p.id, p]));
    for (const c of data.postcards) {
      const p = byId.get(c.id);
      try { if (p) c.img = cards.postcard(p.place, p.seed).toDataURL('image/png'); } catch { /* 沒有圖就只有字 */ }
    }
    this.api.phoneSnapshot(data);
    return data;
  }

  // 比平常晚睡：大家打哈欠（只是動作，不算打擾）；最喜歡你的那隻靠到游標旁邊坐下（要經過額度）
  bedtime() {
    const st = this.stage, g = this.game.state;
    if (g.focus.active || g.settings.quiet) return;
    const pets = [...st.pets.values()].filter(p => p.free && !p.partner && !p.perch);
    pets.forEach((p, i) => setTimeout(() => { if (p.free) { p.set('stretch', 1.2); p.showEmote('Z', 2); } }, i * 400));
    this.interrupt({ id: `bedtime:${routineDay(Date.now())}`, kind: 'bedtime', ttl: 30 * 60_000 }, () => {
      // 打完哈欠再走過來；正在忙的（被拎著、在視窗上、在對戰）不算
      const p = [...st.pets.values()].filter(q => !q.leaving && !q.perch && !q.inBattle && !['held', 'fall', 'evolving', 'move', 'duel', 'eat'].includes(q.state))
        .sort((a, b) => b.mon.affection - a.mon.affection)[0];
      if (!p || !st.pointer.known) return;
      p.endPlay?.();
      const b = p.bounds(), S = st.S;
      p.target = { x: Math.max(b.x0, Math.min(b.x1, st.pointer.x - 60 * S)), y: Math.max(b.y0, Math.min(b.y1, st.pointer.y + 40 * S)) };
      p.set('walk');
      // 走得到就好：依距離給時間（一起累、很累的時候走比較慢），最少 8 秒
      p.walkLimit = Math.max(8, Math.hypot(p.target.x - p.x, p.target.y - p.gy) / (WALK_SPEED * S * 0.6) + 3);
      p.reserved = true; // 走過去的路上別隻不能找牠玩
      setTimeout(() => { p.reserved = false; }, (p.walkLimit + 1) * 1000);
      p.onArrive = () => { p.reserved = false; p.facing = st.pointer.x > p.x ? 1 : -1; p.set('sit', 20); p.showEmote('Z', 3); this.bedtimeSat = { uid: p.uid, x: p.x, y: p.gy }; };
      this.bedtimePet = p.uid; // 測試用
      this.ui?.toast(`${this.game.displayName(p.mon)}揉揉眼睛，靠到你旁邊……已經 ${clockOf(minuteOf(Date.now()))} 了，早點休息吧`);
    });
  }

  greetUser(text = '歡迎回來！夥伴們跑過來迎接你了') {
    let greeted = 0;
    for (const pet of this.stage.pets.values()) {
      if (hearts(pet.mon.affection) >= 3 && pet.state !== 'held') {
        pet.set('follow', 3);
        pet.showEmote('♥', 2);
        greeted++;
      }
    }
    if (greeted) this.ui?.toast(text);
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
    // 旅行中的不在桌面上；正在走出去的讓牠走完；回來了的由 refreshTrips() 讓牠從邊邊走進來
    const want = new Set(quiet ? [] : this.game.homeMons().map(m => m.uid));
    for (const uid of [...this.stage.pets.keys()]) if (!want.has(uid) && this.stage.pets.get(uid).state !== 'depart') this.stage.removePet(uid);
    const outs = this.game.homeMons();
    outs.forEach((mon, i) => {
      if (!want.has(mon.uid) || this.stage.pets.has(mon.uid) || this.game.tripStatus(mon.uid) === 'back') return;
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
    this.stage.env.noApproach = this.game.state.settings.interruptions === '0' || this.stage.env.calm; // 完全不主動打擾、或你說今天很累：不跑來玩游標
    if (focusing && this.game.focusRemaining() <= 0) this.finishFocus();
    if (!focusing) this.typingReaction(now);
    if (!quiet && !playing && !focusing && !this.stage.spot && !this.enc && !this.stage.battle && now >= this.nextSpawnAt && this.game.state.starterChosen) this.spawn();
    if (this.enc && !this.enc.throwing && now > this.enc.deadline) this.wildLeaves('等不及，自己跑走了…');
    if (this.lure && now > this.lure.until) {
      this.lure.prop.life = 0;
      this.lure = null;
      this.updateEnv(); // 香味散掉了（不跳通知：不重要的事不打擾你）
    }
    if (this.evolution) this.updateEvolution(dt);
    this.tripT = (this.tripT ?? 0) + dt;
    if (this.tripT >= 1) { this.tripT = 0; this.refreshTrips(); this.drainAttention(); this.refreshLife(); }
    this.lifeAmbient(dt);
    if (!this.dayChecked) { this.dayChecked = true; this.refreshDay(); }
    this.moodTick(dt);
    this.phoneT = (this.phoneT ?? 25) + dt;
    if (this.phoneT >= 30) { this.phoneT = 0; this.pushPhone(); }
    this.routineT = (this.routineT ?? 0) + dt;
    if (this.routineT >= 60) { this.routineT = 0; this.routineTick(); this.lifeTick(); }
  }

  // ---------- 共生（規則在 core/symbiosis.js）----------
  // 這裡只演出：數值由 Game.lifeTick() 加，畫面不改任何數值。
  // 果實、花草、一起累都不出聲、不跳通知（是環境裡的變化，不算打擾）。
  lifeTick() {
    const idle = this.signals?.idleSeconds ?? 0;
    const longestIdle = Math.max(this.maxIdle ?? 0, idle);
    this.maxIdle = idle;
    const evs = this.game.lifeTick({ idleSeconds: idle, longestIdle }); // 事件從 game 的 'symbiosis' 來（見 bindGame）
    this.refreshLife();
    return evs;
  }

  // 每秒一次：畫面跟存檔對齊（重開 app 時果實還在、一起累的時間到了就恢復）
  refreshLife() {
    const g = this.game;
    this.lifeView = g.state.starterChosen ? g.symbiosisView() : null;
    this.stage.env.tired = Boolean(this.lifeView?.tired);
    const fruit = this.lifeView?.fruit;
    if (fruit && !this.fruitProp && !this.fruitOffering) this.placeFruit(fruit.berry, this.fruitSpot());
    if (!fruit && this.fruitProp && !this.fruitEating) this.removeFruit();
  }

  onLife(events) {
    for (const e of events) {
      if (e.type === 'fruitOffered') this.offerFruit(e.berry);
      if (e.type === 'fruitEaten') this.eatFruit(e.berry);
      if (e.type === 'bloom') this.bloomed(e.level);
      if (e.type === 'tired') this.yawnAll();
    }
    this.refreshLife();
  }

  // 果實放在哪：螢幕下緣、游標的正下方附近（游標不在就中間）
  fruitSpot() {
    const st = this.stage, S = st.S;
    const x = st.pointer.known ? st.pointer.x : st.W / 2;
    return { x: Math.max(40 * S, Math.min(st.W - 90 * S, x)), y: st.H - 4 * S };
  }
  // 誰去做：沒在忙、最親近你的。playing：正在跟別隻對打的也算（walkThen 會等牠打完再過去）
  lifePets({ playing = false } = {}) {
    const busy = ['held', 'fall', 'evolving', 'depart', ...(playing ? [] : ['move', 'duel'])];
    return [...this.stage.pets.values()]
      .filter(p => !p.leaving && !p.perch && !p.inBattle && (!p.reserved || p.uid === this.fruitBy) && !busy.includes(p.state))
      .sort((a, b) => b.mon.affection - a.mon.affection);
  }
  placeFruit(berry, spot) {
    const st = this.stage;
    this.removeFruit();
    this.fruitProp = new Prop(st, { kind: 'fruit', puff: berry, x: spot.x, y: spot.y, scale: 2, onClick: () => this.fruitClicked() });
    st.props.push(this.fruitProp);
    return this.fruitProp;
  }
  removeFruit() {
    if (this.fruitProp) { this.fruitProp.life = this.fruitProp.t; this.fruitProp = null; }
  }

  // 走到 target 再做 arrive()：半路跌倒、被拎起來、被擋住，站起來以後繼續走（最多重走 tries 次）。
  // 真的到不了（離開桌面、重走也不行、超過 60 秒）就呼叫 giveUp()。走的路上別隻不能把牠找走（reserved）
  walkThen(p, target, arrive, { tries = 3, giveUp = () => {} } = {}) {
    let left = tries, over = false, started = false;
    const t0 = Date.now();
    const end = ok => { if (over) return; over = true; clearInterval(timer); p.reserved = false; (ok ? arrive : giveUp)(); };
    const onArr = () => end(true);
    const go = () => { p.endPlay?.(); p.target = { ...target }; p.set('walk'); p.walkLimit = 45; p.onArrive = onArr; p.reserved = true; };
    const timer = setInterval(() => {
      if (!started) { // 正在跟別隻對打：等打完再出發（半路打斷會讓對手卡住）
        if (p.leaving || Date.now() - t0 > 60_000) return end(false);
        if (!['move', 'duel'].includes(p.state)) { started = true; go(); }
        return;
      }
      if (p.onArrive === onArr && p.state === 'walk') return; // 還在走
      if (p.leaving || !this.stage.pets.has(p.uid) || Date.now() - t0 > 60_000) return end(false);
      if (['trip', 'held', 'fall', 'land'].includes(p.state)) return; // 等牠站起來
      if (left-- > 0) go(); else end(false);
    }, 400);
    if (!['move', 'duel'].includes(p.state)) { started = true; go(); }
  }

  // 連續用電腦 90 分鐘：最親近的那隻把一顆樹果帶到游標下面的螢幕下緣，坐在旁邊等你
  offerFruit(berry) {
    const st = this.stage, S = st.S, spot = this.fruitSpot();
    const p = this.lifePets()[0];
    if (!p) { this.placeFruit(berry, spot); return; }
    this.fruitOffering = true;
    const b = p.bounds(), side = spot.x > st.W / 2 ? -1 : 1;
    const target = { x: Math.max(b.x0, Math.min(b.x1, spot.x + side * (p.asset.w / 2 + 12) * S)), y: b.y1 };
    const put = arrived => {
      if (!this.fruitOffering) return;
      this.fruitOffering = false;
      if (!this.game.state.symbiosis.fruit) return; // 走過去的路上你就離開了、已經被吃掉
      this.placeFruit(berry, spot);
      st.fx.sparkles(spot.x, spot.y - 8 * S, S, 4, 8);
      if (!arrived || p.leaving || p.perch) return; // 走不到：果實還是放好，牠就做自己的事
      p.facing = spot.x > p.x ? 1 : -1;
      p.set('sit', 30);
      p.reserved = true; // 坐著等的時候別隻不能把牠找走
      if (this.keeperTimer) clearTimeout(this.keeperTimer);
      this.keeperTimer = setTimeout(() => { p.reserved = false; }, 30_000);
      this.fruitBy = p.uid; // 測試用
    };
    this.walkThen(p, target, () => put(true), { giveUp: () => put(false) });
  }

  // 你離開了一下：大家走過去分著吃（你回來時看到的是吃完的樣子）
  eatFruit(berry) {
    const st = this.stage, S = st.S;
    this.fruitOffering = false;
    const prop = this.fruitProp ?? this.placeFruit(berry, this.fruitSpot());
    this.fruitEating = true;
    const eaters = this.lifePets({ playing: true }).slice(0, 4);
    for (const p of eaters) p.reserved = false; // 在旁邊等的那隻也一起吃
    const puff = `${BERRIES[berry] ?? 'sweet'}-basic`; // 碎屑的顏色跟樹果的味道一樣
    let left = eaters.length;
    const finish = () => {
      if (!this.fruitEating) return;
      this.fruitEating = false;
      if (this.fruitProp === prop) this.removeFruit();
      else prop.life = prop.t;
    };
    const done = () => { if (--left <= 0) setTimeout(finish, 1600); }; // 最後一隻吃完（吃 1.4 秒）
    eaters.forEach((p, i) => {
      const b = p.bounds(), side = i % 2 ? 1 : -1, dist = (p.asset.w / 2 + 10 + Math.floor(i / 2) * 16) * S;
      const target = { x: Math.max(b.x0, Math.min(b.x1, prop.x + side * dist)), y: b.y1 };
      this.walkThen(p, target, () => {
        p.facing = prop.x > p.x ? 1 : -1;
        p.startEat(puff);
        st.fx.hearts(p.head().x, p.head().y, S);
        done();
      }, { giveUp: () => { (this.fruitGaveUp ??= []).push(p.uid); done(); } }); // fruitGaveUp：測試用
    });
    this.fruitEaters = eaters.map(p => p.uid); // 測試用
    if (!eaters.length) setTimeout(finish, 500);
  }

  fruitClicked() {
    // 你點了果實（回應，不算打擾）：說明一下，不催你
    const p = this.stage.pets.get(this.fruitBy) ?? this.lifePets()[0];
    if (p) p.showEmote('♪', 1.2);
    this.ui?.toast('大家在等你離開電腦休息一下，回來就一起吃', { icon: art.berries[this.fruitProp?.puff] ?? art.berries.pecha });
  }

  // 今天又做到一件好事：花草長一點（只有閃一下，不出聲）
  bloomed() {
    const st = this.stage, S = st.S;
    for (let i = 0; i < 5; i++) st.fx.sparkles(st.W * (0.1 + 0.2 * i), st.H - 6 * S, S, 2, 6);
  }

  // 昨天熬夜了：今天早上大家也有點累（只是動作，不扣任何東西、不說任何話）
  yawnAll() {
    this.lifePets().forEach((p, i) => setTimeout(() => {
      if (p.leaving || p.perch || p.inBattle || p.reserved || ['held', 'fall', 'evolving', 'move', 'duel', 'eat', 'depart'].includes(p.state)) return;
      p.endPlay?.(); // 正在玩的也先停下來打個哈欠
      p.set('stretch', 1.4);
      p.showEmote('Z', 2);
    }, 800 + i * 500));
  }
  lifeAmbient(dt) {
    if (!this.stage.env.tired || this.stage.env.focus) return;
    this.yawnT = (this.yawnT ?? 0) + dt;
    if (this.yawnT < 75) return; // 猜的，可調整
    this.yawnT = 0;
    const free = [...this.stage.pets.values()].filter(p => p.free && !p.partner && !p.perch);
    const p = free[Math.floor(Math.random() * free.length)];
    if (p) { p.set('stretch', 1.2); p.showEmote('Z', 1.6); }
  }

  // ---------- 出門旅行 ----------
  // 每秒檢查一次：旅行中的留一張紙條；回來了的從邊邊走進來；收完明信片的拿掉紙條
  refreshTrips() {
    const st = this.stage, S = st.S;
    this.notes ??= new Map();
    const quiet = this.game.state.settings.quiet;
    for (const mon of this.game.outMons()) {
      const status = this.game.tripStatus(mon.uid);
      const pet = st.pets.get(mon.uid);
      if (status === 'away') {
        if (pet && pet.state !== 'depart' && !pet.leaving) startDepart(pet); // 從夥伴頁按「讓牠去旅行」
        if (!pet && !this.notes.has(mon.uid)) { // 走出螢幕以後才放紙條（放在牠出發的地方）
          const pos = mon.pos ? { x: mon.pos.x * st.W, y: mon.pos.y * st.H } : { x: st.W * 0.5, y: st.H * 0.7 };
          const prop = new Prop(st, { kind: 'note', x: pos.x, y: pos.y, onClick: () => this.noteClicked(mon.uid) });
          st.props.push(prop);
          this.notes.set(mon.uid, prop);
        }
      } else {
        const prop = this.notes.get(mon.uid);
        if (prop) { prop.life = 0; this.notes.delete(mon.uid); }
        if (status === 'back' && !pet && !quiet && !this.returning?.has(mon.uid)) {
          (this.returning ??= new Set()).add(mon.uid);
          this.sprites.get(spriteKey(mon.species, mon.form), mon.shiny).then(() => {
            this.returning.delete(mon.uid);
            if (this.game.tripStatus(mon.uid) !== 'back' || st.pets.has(mon.uid)) return;
            startReturn(st.addPet(mon, { x: -100, gy: st.H * 0.7 }));
            this.interrupt({ id: `trip:${mon.uid}`, kind: 'gift' }, () => this.ui?.toast(`${this.game.displayName(mon)}旅行回來了！點牠收下明信片`, { icon: cards.mini }));
          });
        }
      }
    }
    for (const [uid, prop] of this.notes) if (!this.game.mon(uid)?.trip) { prop.life = 0; this.notes.delete(uid); }
  }

  noteClicked(uid) {
    const mon = this.game.mon(uid);
    if (!mon?.trip) return;
    const t = new Date(mon.trip.returnAt);
    const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    const day = new Date().toDateString() === t.toDateString() ? '' : '明天 ';
    this.ui?.toast(`${this.game.displayName(mon)}去${PLACES[mon.trip.place].zh}旅行了，大約 ${day}${hhmm} 回來`, { icon: cards.note });
  }

  // ---------- 信 ----------
  // ---------- 主線故事（core/story.js）----------
  // 每 10 秒看一次：時間到了、你在、而且沒有在做別的事（專注、勿擾、小遊戲、遭遇）才開始下一件
  tickStory({ force = false } = {}) {
    const ui = this.ui, g = this.game;
    if (!ui?.holo || this.storyBusy || ui.holo.busy) return false;
    if (this.enc || this.stage.minigame || this.stage.battle || g.state.focus.active || g.state.settings.quiet) return false;
    if (!ui.modal.classList.contains('hidden')) return false;
    const ev = g.storyNext({ force });
    if (!ev) return false;
    if (ev.kind === 'letter' || force) { this.playStory(ev); return true; } // 信直接進信箱（有信的提醒另外排隊）；開發用的 force 不排隊
    // 打來、廣播、有人來拜訪：要經過打擾額度（排隊時不會被丟掉，只是晚一點）
    if (this.attnQueue?.some(q => q.id === `story:${ev.id}`)) return false;
    this.interrupt({ id: `story:${ev.id}`, kind: 'story' }, () => {
      if (this.storyBusy || ui.holo.busy || g.state.story.done.includes(ev.id)) return;
      this.playStory(ev);
    });
    return true;
  }

  async playStory(ev) {
    this.storyBusy = true;
    const g = this.game;
    if (ev.kind === 'letter') {
      g.storyLetter(ev);
      g.storyDone(ev.id);
      this.storyBusy = false;
      return;
    }
    if (ev.kind === 'visit' || ev.kind === 'battle') { this.spawnVisitor(ev); return; } // 點他才開始說話；在那之前不會發生別的事
    const r = await this.ui.holo.play(ev, { onLine: who => this.storyReact(ev, who) });
    if (ev.kind === 'legend') { this.storyLegend(ev); return; } // 抓到才算做完
    g.storyDone(ev.id, { choice: r.choice });
    this.storyBusy = false;
  }

  // ---------- 故事裡的對戰 ----------
  // 館主說完話就開打；打完再說一段（贏了／輸了）
  startStoryBattle(ev, visitor) {
    const pets = [...this.stage.pets.values()].filter(p => !p.leaving && !p.mon.trip);
    if (!pets.length) {
      this.ui?.toast('桌面上要有夥伴才能對戰。把夥伴叫出來以後，再點一次來挑戰的人');
      visitor.talking = false;
      return;
    }
    this.ui?.closeBubble?.();
    for (const p of pets) if (p.free && !p.perch) { p.facing = p.x < this.stage.W / 2 ? 1 : -1; p.set('look', 2); p.showEmote('!', 1); }
    this.audio.playSong('wild');
    const battle = new StoryBattle({ stage: this.stage, game: this.game, dex: this.dex, audio: this.audio, hud: this.ui.battleHud }, ev, {
      onEnd: async (won, uids) => {
        const g = this.game;
        if (won) {
          this.audio.jingle('caught', { resumeWith: this.ambientSong() });
          for (const p of this.stage.pets.values()) if (p.free) { p.set('cheer', 1.1); p.showEmote('♪', 1.4); }
          g.battleWon?.(uids);
        }
        await this.ui.holo.play({ ...ev, kind: 'call', lines: won ? ev.win : ev.lose, choice: null }, { onLine: w => this.storyReact(ev, w) });
        if (won) {
          g.storyDone(ev.id);
          if (ev.battle.badge) this.ui?.toast(`獲得了${BADGES[ev.battle.badge].zh}！`, { icon: art.sparkle, kind: 'dex' });
          if (ev.id === 'champion-diantha') this.ui?.toast('你成為了卡洛斯的冠軍！', { icon: art.sparkle, kind: 'dex' });
        } else {
          g.storyLost(ev.id);
          const n = lossesOf(g.state.story, ev.id);
          this.ui?.toast(n >= 2 ? '明天再來挑戰。換一隻屬性有利的夥伴、或多陪陪夥伴（好感越高越強），會比較好打' : '明天再來挑戰吧');
        }
        visitor.life = visitor.t + 0.5;
        this.storyBusy = false;
        this.refreshMusic();
      },
    });
    battle.start();
  }

  // ---------- 傳說的寶可夢 ----------
  // 出現在桌面中間，不會逃走、不會等太久自己走掉；抓到才算這件事做完（關掉 app 下次會再出現）
  storyLegend(ev) {
    const g = this.game, st = this.stage, S = st.S;
    const bag = g.state.bag.balls;
    if (bag.poke + bag.great + bag.ultra < 5) {
      bag.ultra += 5;
      this.ui?.toast('博士寄來了 5 顆高級球！');
    }
    const plan = g.storyLegendPlan(ev);
    this.stage.spot = null;
    this.beginEncounter({ plan, x: st.W / 2, y: st.H * 0.55, groundY: st.H - 60 * S });
    if (this.enc) this.enc.deadline = Infinity;
    st.shake(6, 0.8);
    this.ui?.toast(`${this.dex.name(plan.speciesId)}出現了！`, { icon: art.sparkle, kind: 'dex' });
  }

  // 有人說話：夥伴轉頭看投影（廣播在正中間，通訊器在左下角）
  storyReact(ev, who) {
    const st = this.stage, first = !this.storyReacted?.has(ev.id);
    (this.storyReacted ??= new Set()).add(ev.id);
    for (const p of st.pets.values()) {
      if (!p.free || p.perch) continue;
      p.facing = ev.kind === 'broadcast' ? (p.x < st.W / 2 ? 1 : -1) : -1;
      p.set('look', 2.5);
      if (first) p.showEmote(ev.kind === 'broadcast' ? '?' : '!', 1.2);
    }
  }

  // 來拜訪的人：站在秘密基地另一邊，點他才開始對話；說完慢慢走掉
  spawnVisitor(ev) {
    const st = this.stage, S = st.S, who = ev.lines[0][0];
    const spot = () => {
      const L = st.baseView?.layout();
      if (!L) return { x: st.W * 0.3, y: st.H - 12 * S };
      const right = this.game.state.base?.side === 'right';
      return { x: right ? L.x + L.w * 0.25 : L.x + L.w * 0.75, y: L.y + L.h * 0.55 };
    };
    const prop = new Prop(st, { kind: 'npc', ...spot(), onClick: async () => {
      if (prop.talking) return;
      prop.talking = true;
      await this.ui.holo.play(ev, { onLine: w => this.storyReact(ev, w) });
      if (ev.kind === 'battle') { this.startStoryBattle(ev, prop); return; }
      this.game.storyDone(ev.id);
      prop.life = prop.t + 0.5; // 慢慢消失
      this.storyBusy = false;
    } });
    prop.img = this.ui.portraits.peekFigure(who);
    this.ui.portraits.get(who).then(() => { prop.img = this.ui.portraits.peekFigure(who); });
    st.props.push(prop);
    this.visitor = prop;
    const who0 = ev.lines[0][0];
    this.ui?.toast(ev.kind === 'battle' ? `${CAST_ZH(who0)}來挑戰你了！點他開始對戰` : `${who0 === 'az' ? '有一個很高的人' : '有人'}站在秘密基地旁邊……`);
  }

  // 桌面上常駐的信箱：放在秘密基地院子靠螢幕中間的那一側；有沒看的信就立旗子
  refreshMail() {
    const st = this.stage;
    if (!this.mailbox || this.mailbox.gone) {
      this.mailbox = new Prop(st, { kind: 'mailbox', x: 0, y: 0, anchor: () => this.mailboxSpot(), onClick: () => this.openMailbox() });
      Object.assign(this.mailbox, this.mailboxSpot());
      st.props.push(this.mailbox);
    }
    this.mailbox.unread = this.game.unreadLetters().length;
  }

  mailboxSpot() {
    const st = this.stage, S = st.S, L = st.baseView?.layout();
    if (!L) return { x: st.W - 90 * S, y: st.H - 8 * S };
    const right = this.game.state.base?.side === 'right';
    return { x: right ? L.x - 14 * S : L.x + L.w + 14 * S, y: L.y + L.h };
  }

  // 點信箱：有沒看的信就直接打開最舊的那封，沒有就打開信箱（收件夾）
  openMailbox() {
    const l = this.game.unreadLetters()[0];
    if (l) { this.audio.sfx('open'); this.ui?.showLetter(l); return; }
    this.ui?.open('mail');
  }

  // ---------- 秘密基地 ----------
  startBasePlace(kind) {
    this.setMode({ type: 'base', kind });
    this.ui?.toast(`點院子裡的格子放${FURNITURE[kind].zh}（右鍵取消）`);
  }

  baseModeClick() {
    const st = this.stage, m = st.mode;
    const cell = st.baseView.cellAt(st.pointer.x, st.pointer.y);
    if (!cell) { this.setMode(null); return; } // 點到院子外面：取消
    if (m.kind) {
      const r = this.game.basePlace(m.kind, cell.x, cell.y);
      if (!r.ok) { this.ui?.toast(BASE_PROBLEM[r.reason] ?? '這裡放不下'); return; }
      this.audio.sfx('collect');
      st.fx.sparkles(st.baseView.spotOf(r.item).x, st.baseView.spotOf(r.item).y - 8 * st.S, st.S, 6, 10);
    } else if (m.moveId) {
      if (!this.game.baseMove(m.moveId, cell.x, cell.y)) { this.ui?.toast('這裡放不下'); return; }
      this.audio.sfx('click');
    }
    this.setMode(null);
  }

  // 從夥伴頁按「讓牠去旅行」
  sendOnTrip(uid) {
    const pet = this.stage.pets.get(uid);
    // 小遊戲、被拎著、進化中、專注中都不出發
    if (this.ui?.minigames.active || this.game.state.focus.active || this.evolution || (pet && ['held', 'evolving'].includes(pet.state))) {
      this.ui?.toast('現在不太方便出門，等一下再說');
      return false;
    }
    const trip = this.game.depart(uid, { curious: 0.5 });
    if (!trip) return false;
    if (pet) startDepart(pet);
    return true;
  }

  // 點旅行回來的寶可夢：收下明信片、禮物、日記
  collectTrip(pet) {
    const r = this.game.settleTrip(pet.uid);
    if (!r) return;
    this.audio.sfx('collect');
    pet.set('happy', 0.8);
    pet.showEmote('♥', 1.4);
    this.ui?.showPostcard(r);
    if (r.egg) this.ui?.toast('牠還撿到了一顆蛋！', { icon: art.egg() });
    // 帶了朋友回來：過一下子，那隻野生寶可夢會出現在附近
    if (r.friend) {
      setTimeout(() => {
        if (this.enc || this.stage.spot) return;
        this.spawn({ speciesId: r.friend, form: null, spot: this.dex.habitat(r.friend), shiny: false, nature: this.rng.pick(this.dex.natures).slug, special: false });
        this.ui?.toast(`${this.game.displayName(pet.mon)}帶了一個朋友回來！`);
      }, 3000);
    }
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
      this.interrupt({ id: `egg:${egg.uid}`, kind: 'gift' }, () => this.ui?.toast('蛋好像動了一下…點一下看看！', { icon: art.egg(this.eggColor(egg), 1) }));
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
    // 今天專注加起來超過兩小時：大家一起慶祝（番茄鐘結束了才來，要經過額度）
    if (r.twoHours) setTimeout(() => this.interrupt({ id: `focus2h:${routineDay(Date.now())}`, kind: 'celebrate', ttl: 2 * 3_600_000 }, () => this.celebrateFocus()), 2500);
    for (const p of this.stage.pets.values()) {
      if (p.perch || !['idle', 'sit', 'sleep', 'look'].includes(p.state)) continue;
      p.set('happy', 1.2);
      p.showEmote('♥', 1.5);
    }
  }

  celebrateFocus() {
    this.audio.jingle('hearts');
    // 大家都來跳（正在忙的：被拎著、在視窗上、在放招、在吃東西的不算）
    for (const p of this.stage.pets.values()) {
      if (p.perch || p.leaving || p.inBattle || ['held', 'fall', 'evolving', 'move', 'duel', 'eat', 'sleep'].includes(p.state)) continue;
      p.endPlay?.();
      p.set('dance', 3);
      p.showEmote('♪', 2);
    }
    this.stage.fx.stars(this.stage.W / 2, this.stage.H * 0.6, this.stage.S, 12);
    this.ui?.toast('今天專注超過兩小時了！大家一起幫你慶祝', { icon: art.sparkle, kind: 'dex' });
  }

  // ---------- 打字反應（不讀鍵盤：看 signals.typing） ----------
  // 連續打字超過 30 秒：1–2 隻夥伴跑到游標旁邊圍觀
  typingReaction(now) {
    const s = this.signals, st = this.stage;
    if (!s.typing || (s.typingSeconds ?? 0) < TYPING_WATCH_AFTER || now < (this.typingCooldown ?? 0) || !st.pointer.known) return;
    if (this.enc || this.ui?.minigames.active) return;
    this.typingCooldown = now + TYPING_COOLDOWN;
    // 跑到游標旁邊是主動打擾：額度用完就算了（過 30 秒還沒輪到，你大概也不在打字了）
    this.interrupt({ id: 'typing', kind: 'ambient', ttl: 30_000 }, () => this.typingApproach());
  }

  typingApproach() {
    const st = this.stage;
    if (!this.signals?.typing || !st.pointer.known) return;
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
    // 每 3 次出現最多 1 次用「探頭」的方式（同一個出現時間，不會變多）
    const peek = forcePlan ? forcePlan.spot === 'peek' : shouldPeek(this.spawnKinds, plan, Math.random);
    this.spawnKinds = [...this.spawnKinds, peek ? 'peek' : 'spot'].slice(-10);
    if (peek) {
      this.stage.spot = new PeekSpot(this.stage, { ...plan, spot: 'peek' }, { life });
      this.noticePeeker(this.stage.spot);
    } else this.stage.spot = new Spot(this.stage, plan, { life });
    // 出現時的沙沙聲：這小時已經打擾過你就安靜地出現（寶可夢照樣會來）。
    // 聲音很小、又很常出現，所以只「看」額度、不用掉額度，不然每小時的那一次都會被它吃掉
    const spot = this.stage.spot;
    spot.silent = !A.canInterrupt(this.game.state.attention, Date.now(), this.attentionOpts());
    if (plan.special) this.interrupt({ id: 'special', kind: 'ambient', ttl: 10 * 60_000 }, () => { if (this.stage.spot === spot) this.ui?.toast('好像有什麼不尋常的氣息…', { icon: art.sparkle }); });
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
      if (target instanceof Pet && this.game.tripStatus(target.uid) === 'back') this.collectTrip(target);
      else if (target instanceof Pet) this.ui?.openPetBubble(target);
      else if (target instanceof Spot) this.beginEncounter(target);
      else if (target instanceof WildMon) this.ui?.showEncounter(this.enc);
      else target?.onClick?.(); // 道具、蛋
    });
    st.on('modeClick', target => {
      const m = st.mode;
      if (m?.type === 'aim') {
        if (target instanceof WildMon && target.state === 'idle') this.throwBall(m.ball);
        else this.setMode(null);
      } else if (m?.type === 'base') {
        this.baseModeClick();
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
    // 秘密基地：點家具可以搬動它
    st.baseView = new BaseView(st, () => this.game.state.base);
    st.on('furnitureClick', it => {
      this.setMode({ type: 'base', moveId: it.id });
      this.ui?.toast(`點院子裡的格子，把${FURNITURE[it.kind].zh}搬過去（右鍵取消）`);
    });
    // 探頭：慢慢靠近 → 走進來；太快 → 嚇跑（還沒開始遭遇，所以不會中斷連鎖）
    st.on('peekCome', spot => { if (this.stage.spot === spot && !this.enc) this.beginEncounter(spot); });
    st.on('peekScared', () => this.ui?.toast('嚇跑了…下次慢慢靠近牠試試'));
    st.on('bond', (a, b, n) => {
      this.game.bond(a.uid, b.uid, n);
      this.game.playedTogether(a.uid, b.uid); // 兩邊都記得跟誰玩過
      for (const p of [a, b]) if (p.mon.mind) socialized(p.mon.mind, 8);
    });
    // 走出螢幕了：從舞台上拿掉（紙條由 refreshTrips 放）
    st.on('tripGone', pet => {
      const f = pet.tripFrom, mon = this.game.mon(pet.uid);
      if (f && mon) mon.pos = { x: Math.min(1, Math.max(0, f.x / this.stage.W)), y: Math.min(1, Math.max(0, f.y / this.stage.H)) };
      this.stage.pets.delete(pet.uid);
      this.refreshTrips();
    });
    st.on('duelResult', (w, l) => this.game.duelResult(w.uid, l.uid));
    st.on('perched', () => { this.game.state.stats.perches++; });
    // 超級進化、牽絆變身（只是演出，不會存檔）
    st.on('formChange', (pet, form) => {
      if (pet.duel && !pet.inBattle) { if (form) pet.stage.fx.hearts(pet.x, pet.head().y, pet.S, 2); return; } // 夥伴自己切磋時變身：不跳通知
      const name = this.game.displayName(pet.mon);
      if (form === 'mega') this.ui?.toast(`${name}超級進化成超級${this.dex.name(pet.mon.species)}了！`, { icon: art.sparkle });
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

  // 有野生寶可夢從邊邊探頭：離牠最近的夥伴會注意到（看過去、記住）
  noticePeeker(spot) {
    const pets = [...this.stage.pets.values()].filter(p => !p.leaving && p.state !== 'held' && p.state !== 'evolving');
    const pet = pets.sort((a, b) => Math.abs(a.x - spot.x) - Math.abs(b.x - spot.x))[0];
    if (!pet) return;
    if (pet.free && !pet.partner && !pet.perch) { // 正在忙的就不轉頭，但一樣會注意到、記住
      pet.facing = spot.side < 0 ? -1 : 1;
      pet.set('look', 2.5);
    }
    pet.showEmote('?', 1.5);
    pet.thought = { key: 'explore.peeker', text: '外面好像有誰在看？', cat: 'explore', at: pet.t };
    this.game.remember(pet.uid, { k: 'saw-peeker', data: { name: this.dex.name(spot.plan.speciesId) } });
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
    if (!enc.wild.story) enc.deadline = Date.now() + 120_000;
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
      if (enc.wild.story) { this.game.storyDone(enc.wild.story); this.storyBusy = false; } // 故事裡的傳說寶可夢
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
    if (this.enc.wild.story) this.storyBusy = false; // 這件事還沒做完：之後會再發生
    const w = this.enc.entity;
    this.game.wildGone(this.enc.wild);
    this.petsReact(w, '…');
    w.set('flee');
    this.audio.sfx('flee');
    this.ui?.toast(`${this.dex.name(this.enc.wild.speciesId)}${reason}`);
    this.endEncounter();
  }

  // force：勿擾模式（故事裡的傳說寶可夢平常不會走；勿擾時暫時離開，下次會再來）
  runAway({ force = false } = {}) {
    if (!this.enc || this.enc.throwing || (this.enc.wild.story && !force)) return;
    this.wildLeaves(this.enc.wild.story ? '暫時離開了，之後還會再來' : '回到了牠來的地方');
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
      this.interrupt({ id: `gift:${uid}:${puff}`, kind: 'gift', ttl: 3 * 3_600_000 }, () => {
        const p = this.stage.pets.get(uid);
        if (p) { p.showEmote(art.puff(puff), 3); p.happy(); }
        this.audio.jingle('gift');
        this.ui?.toast(`${g.displayName(g.mon(uid))}撿到了${puffName(puff)}送給你！`, { icon: art.puff(puff) });
      });
    });
    g.on('dailyGift', ({ balls, puffs }) => {
      setTimeout(() => this.interrupt({ id: 'daily', kind: 'gift' }, () => {
        this.ui?.toast(`每日禮物：精靈球×${balls.poke}、超級球×${balls.great}、高級球×${balls.ultra}，以及 ${puffs.length} 個泡芙`, { icon: art.balls.poke });
      }), 1500);
    });
    g.on('party', () => this.syncPets());
    g.on('chain', ({ speciesId, count }) => {
      const odds = Math.round(1 / shinyChance(g.state, speciesId));
      this.ui?.toast(`${this.dex.name(speciesId)}連鎖 ×${count}！牠會更常出現，色違機率約 1/${odds}`, { icon: art.sparkle });
    });
    g.on('chainBroken', ({ speciesId, count }) => {
      if (count >= 3) this.ui?.toast(`${this.dex.name(speciesId)}的連鎖（×${count}）中斷了…`);
    });
    g.on('item', ({ item, uid, story }) => {
      if (story) { // 故事裡拿到的
        this.audio.jingle('newEntry', { resumeWith: this.ambientSong() });
        const it = KEY_ITEMS[item];
        const how = item === 'megaring' ? '有了它，帶著進化石的夥伴就能超級進化' : it.species ? `${this.dex.name(it.species)}帶著它、又有超級手環，就能超級進化` : '';
        this.ui?.toast(`獲得了「${it.zh}」！${how}`, { icon: art.sparkle, kind: 'dex' });
        return;
      }
      if (item !== 'diancite') return;
      this.audio.jingle('newEntry', { resumeWith: this.ambientSong() });
      this.ui?.toast(`${this.game.displayName(this.game.mon(uid))}好像很信任你…獲得了「蒂安希進化石」！現在牠可以超級進化了`, { icon: art.sparkle, kind: 'dex' });
    });
    g.on('eggFound', ({ egg, parents }) => {
      const [a, b] = parents.map(u => this.game.displayName(this.game.mon(u)));
      this.interrupt({ id: `eggFound:${egg.uid}`, kind: 'gift' }, () => this.ui?.toast(`${a}和${b}一起找到了一顆蛋！用游標、在電腦前待著，蛋就會慢慢孵化`, { icon: art.egg(this.eggColor(egg)) }));
    });
    g.on('eggReady', () => this.showReadyEggs());
    // 里程碑：一定會告訴你（排隊也不會丟）
    g.on('milestone', ({ id }) => {
      const m = MILESTONES[id];
      this.interrupt({ id: `milestone:${id}`, kind: 'milestone' }, () => {
        this.audio.jingle('hearts');
        for (const p of this.stage.pets.values()) if (!p.perch) { this.stage.fx.hearts(p.head().x, p.head().y, this.stage.S, 2); if (p.free) p.set('happy', 0.8); }
        this.ui?.toast(`✦ ${m.zh}！${m.line}`, { icon: art.sparkle, kind: 'dex' });
      });
    });
    g.on('symbiosis', ({ events }) => this.onLife(events));
    g.on('mood', ({ mood }) => { if (mood) this.moodChosen(mood); else this.refreshDay(); });
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
      if (m) this.interrupt({ id: `trim:${uid}`, kind: 'ambient', ttl: 30 * 60_000 }, () => this.ui?.toast(`${this.game.displayName(m)}的毛長回來了`));
    });
    g.on('charm', () => {
      this.audio.jingle('newEntry', { resumeWith: this.ambientSong() });
      this.ui?.toast('圖鑑捕獲 60 種！獲得了「閃耀護符」，色違更容易出現了', { icon: art.sparkle, kind: 'dex' });
    });
    // 信：有沒打開的信，桌面角落就有一個信封
    // 有信：信箱馬上插旗子（不吵）；「叮」一聲和通知要排隊
    g.on('letter', l => { this.refreshMail(); this.interrupt({ id: `letter:${l.id}`, kind: 'gift' }, () => { this.audio.sfx('open'); this.ui?.toast(`${l.name}寫了一封信給你`, { icon: mail.envelope }); }); });
    g.on('letterOpened', () => this.refreshMail());
    g.on('letterDeleted', () => this.refreshMail());
    g.on('bondUp', ({ a, b, level, zh }) => {
      if (level < 2) return;
      const pa = this.stage.pets.get(a), pb = this.stage.pets.get(b);
      for (const p of [pa, pb]) if (p) this.stage.fx.hearts(p.head().x, p.head().y, this.stage.S, 3); // 愛心是畫面，不算打擾
      this.interrupt({ id: `bond:${a}:${b}:${level}`, kind: 'ambient', ttl: 30 * 60_000 }, () => {
        this.audio.sfx('heart');
        this.ui?.toast(`${g.displayName(g.mon(a))}和${g.displayName(g.mon(b))}變成${zh}了！`);
      });
    });
  }

  // 開發用：立刻生成一個氣息點
  spawnNow() {
    if (this.enc) return;
    this.stage.spot = null;
    this.spawn();
  }
}
