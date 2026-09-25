// 遊戲狀態的唯一入口：所有改動存檔的動作都經過 Game，畫面只負責演出。
// 不碰 DOM、不碰 Electron，所以 node --test 可以直接測。

import * as amie from './amie.js';
import { BALLS, catchProbability, rollCatch, fleeChance } from './capture.js';
import { checkEvolution } from './evolution.js';
import { MAX_OUT, MAX_EGGS, normalizeTraining, TRAINING_STATS, TRAINING_MAX, TRAINING_TOTAL } from './save.js';
import * as mg from './minigames.js';
import * as focus from './focus.js';
import * as eggs from './eggs.js';
import { canonicalForm, inheritForm, defaultForm, FORMS } from './forms.js';
import { CHARM_AT, CHAIN_STEPS, advanceChain, breakChain, shinyChance } from './shiny.js';

// 夥伴之間的感情（0–255），到這些門檻時通知畫面
export const BOND_LEVELS = [
  { at: 0, zh: '還不熟' },
  { at: 30, zh: '認識了' },
  { at: 100, zh: '好朋友' },
  { at: 200, zh: '最好的朋友' },
];
export const bondLevel = points => BOND_LEVELS.reduce((lv, l, i) => (points >= l.at ? i : lv), 0);
export const bondKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
export const TRIM_DAYS = 5; // 剪毛後幾天長回來（原作）
const TRIM_AFFECTION = 10; // 猜的，可調整
const localDate = t => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const STARTERS = [650, 653, 656];

export class Game {
  constructor({ dex, state, rng, now = () => Date.now() }) {
    this.dex = dex;
    this.state = state;
    this.rng = rng;
    this.now = now;
    this.listeners = new Map();
    this.lastTick = now();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
    return () => this.listeners.set(event, this.listeners.get(event).filter(f => f !== fn));
  }
  emit(event, payload) {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
    if (event !== 'change') for (const fn of this.listeners.get('change') ?? []) fn({ event, payload });
  }

  // ---- 查詢 ----
  mon(uid) { return this.state.mons.find(m => m.uid === uid); }
  outMons() { return this.state.mons.filter(m => m.out); }
  caughtCount() { return Object.values(this.state.dex).filter(d => d.caught > 0).length; }
  seenCount() { return Object.values(this.state.dex).filter(d => d.seen > 0).length; }
  displayName(mon) { return mon.nickname ?? this.dex.name(mon.species); }
  outTypes(exceptUid) {
    return new Set(this.outMons().filter(m => m.uid !== exceptUid).flatMap(m => this.dex.get(m.species).types));
  }
  evolutionStatus(uid, extra = {}) {
    const mon = this.mon(uid);
    return mon ? checkEvolution(mon, this.dex, { hour: new Date(this.now()).getHours(), outTypes: this.outTypes(uid), ...extra }) : null;
  }

  // ---- 時間流逝 ----
  // 開啟遊戲時補算離線期間（最多算 24 小時，避免放假回來全部歸零）
  catchUp() {
    const t = this.now();
    const away = Math.min(24 * 60, Math.max(0, (t - (this.state.lastSeenAt ?? t)) / MIN));
    for (const m of this.state.mons) amie.applyDecay(m, away);
    this.state.lastSeenAt = t;
    this.lastTick = t;
    this.checkDailyGift();
    this.expireTrims();
    return away;
  }

  tick() {
    const t = this.now();
    const minutes = Math.max(0, Math.min(10, (t - this.lastTick) / MIN)); // 電腦休眠回來不重複計算
    this.lastTick = t;
    this.state.lastSeenAt = t;
    if (minutes <= 0) return;
    for (const m of this.state.mons) {
      amie.applyDecay(m, minutes);
      if (m.out && !this.state.settings.quiet) amie.together(m, minutes);
    }
    // 精靈球會慢慢補充：每 10 分鐘 1 顆，最多補到 30
    this.state.regenMinutes += minutes;
    while (this.state.regenMinutes >= 10) {
      this.state.regenMinutes -= 10;
      if (this.state.bag.balls.poke < 30) this.state.bag.balls.poke++;
    }
    this.checkDailyGift();
    this.maybePartnerGift(t);
    this.expireTrims();
    this.checkItems(); // 陪伴也會加好感
    this.maybeFindEgg();
    this.emit('tick');
  }

  checkDailyGift() {
    const today = localDate(this.now());
    if (this.state.lastDailyGift === today) return;
    this.state.lastDailyGift = today;
    const puffs = [this.randomPuff(), this.randomPuff(), this.randomPuff()];
    const balls = { poke: 10, great: 3, ultra: 1 };
    for (const [k, n] of Object.entries(balls)) this.state.bag.balls[k] += n;
    for (const p of puffs) this.state.bag.puffs[p]++;
    this.emit('dailyGift', { balls, puffs });
  }

  // 好感 ♥2 以上的夥伴偶爾會「撿到」泡芙送你
  maybePartnerGift(t) {
    if (t < this.state.nextPartnerGiftAt) return;
    const candidates = this.outMons().filter(m => amie.hearts(m.affection) >= 2);
    if (!candidates.length) return;
    const giver = this.rng.weighted(candidates.map(m => ({ m, w: amie.hearts(m.affection) }))).m;
    const puff = this.randomPuff(amie.hearts(giver.affection));
    this.state.bag.puffs[puff]++;
    this.state.nextPartnerGiftAt = t + this.rng.range(40, 80) * MIN;
    this.emit('partnerGift', { uid: giver.uid, puff });
  }

  randomPuff(luck = 0) {
    const flavor = this.rng.pick(amie.FLAVORS);
    const tier = this.rng.weighted([
      { t: 'basic', w: 60 }, { t: 'frosted', w: 25 + luck * 2 }, { t: 'fancy', w: 11 + luck * 2 }, { t: 'deluxe', w: 4 + luck },
    ]).t;
    return amie.puffKey(flavor, tier);
  }

  // ---- 交流 ----
  stroke(uid) {
    const mon = this.mon(uid);
    if (!mon) return null;
    const before = amie.hearts(mon.affection);
    const r = amie.stroke(mon);
    this.state.stats.strokes++;
    this.afterAffection(mon, before);
    return r;
  }

  feed(uid, puff) {
    const mon = this.mon(uid);
    if (!mon) return { ok: false, reason: 'no-mon' };
    if (!(this.state.bag.puffs[puff] > 0)) return { ok: false, reason: 'no-puff' };
    const before = amie.hearts(mon.affection);
    const r = amie.feed(mon, puff, this.dex.nature(mon.nature));
    if (r.ok) {
      this.state.bag.puffs[puff]--;
      this.state.stats.puffsFed++;
      this.afterAffection(mon, before);
      this.emit('fed', { uid, puff, ...r });
    }
    return r;
  }

  afterAffection(mon, heartsBefore) {
    const now = amie.hearts(mon.affection);
    if (now > heartsBefore) this.emit('heartsUp', { uid: mon.uid, hearts: now });
    this.checkItems();
  }

  // 蒂安希的好感第一次滿了：拿到蒂安希進化石（之後可以超級進化）
  checkItems() {
    if (this.state.bag.items.diancite) return;
    const diancie = this.state.mons.find(m => m.species === 719 && m.affection >= amie.MAX);
    if (!diancie) return;
    this.state.bag.items.diancite = true;
    this.emit('item', { item: 'diancite', uid: diancie.uid });
  }

  // ---- 對戰形態（只影響演出，不存檔） ----
  canMega(uid) {
    const mon = this.mon(uid);
    return Boolean(mon?.species === 719 && this.state.bag.items.diancite);
  }
  // 牽絆變身：好感滿的甲賀忍蛙，而且有一個「最好的朋友」（感情 200 以上）
  canBondForm(uid) {
    const mon = this.mon(uid);
    return Boolean(mon?.species === 658 && mon.affection >= amie.MAX && (this.bestFriend(uid)?.points ?? 0) >= BOND_LEVELS[3].at);
  }

  // ---- 多麗米亞美容 ----
  // 花一個泡芙請牠剪毛；5 天後長回原本的樣子（跟原作一樣）
  trim(uid, style, puff) {
    const mon = this.mon(uid);
    if (mon?.species !== 676) return { ok: false, reason: 'not-furfrou' };
    if (style === defaultForm(676) || canonicalForm(676, style) !== style) return { ok: false, reason: 'bad-style' };
    if (!(this.state.bag.puffs[puff] > 0)) return { ok: false, reason: 'no-puff' };
    const before = amie.hearts(mon.affection);
    this.state.bag.puffs[puff]--;
    mon.form = style;
    mon.trimAt = this.now();
    amie.addAffection(mon, TRIM_AFFECTION);
    this.recordForm(676, style, 'caught');
    this.afterAffection(mon, before);
    this.emit('trimmed', { uid, style });
    this.emit('bag');
    return { ok: true };
  }

  expireTrims() {
    for (const mon of this.state.mons) {
      if (mon.species !== 676 || !mon.form || this.now() - (mon.trimAt ?? 0) < TRIM_DAYS * DAY) continue;
      mon.form = null;
      mon.trimAt = null;
      this.emit('trimExpired', { uid: mon.uid });
    }
  }

  // ---- 小遊戲（計分規則在 minigames.js） ----
  // 摘樹果：counts = { pecha: 2, ... }
  addBerries(counts) {
    let total = 0;
    for (const [b, n] of Object.entries(counts)) {
      if (!(b in this.state.bag.berries) || !(n > 0)) continue;
      const add = Math.min(n, mg.MAX_BERRIES_PER_GAME - total);
      if (add <= 0) break;
      this.state.bag.berries[b] = Math.min(999, this.state.bag.berries[b] + add);
      total += add;
    }
    this.state.stats.berriesPicked += total;
    this.emit('bag');
    return total;
  }

  // 還可以做幾個泡芙（今天）
  bakesLeft() {
    return Math.max(0, mg.DAILY_BAKES - mg.todayCounters(this.state, localDate(this.now())).baked);
  }

  // 做泡芙：berries 是 3 個樹果名稱，score 0–100（攪拌＋烘烤＋裝飾）
  bakePuff(berries, score) {
    if (berries.length !== mg.BERRIES_PER_PUFF) return { ok: false, reason: 'berries' };
    const need = {};
    for (const b of berries) need[b] = (need[b] ?? 0) + 1;
    for (const [b, n] of Object.entries(need)) if (!(this.state.bag.berries[b] >= n)) return { ok: false, reason: 'no-berry' };
    const today = mg.todayCounters(this.state, localDate(this.now()));
    if (today.baked >= mg.DAILY_BAKES) return { ok: false, reason: 'daily' };
    for (const [b, n] of Object.entries(need)) this.state.bag.berries[b] -= n;
    const wanted = mg.bakeTier(Math.max(0, Math.min(100, score)));
    const tier = mg.cappedTier(wanted, today);
    const puff = amie.puffKey(mg.puffFlavor(berries), tier);
    today.baked++;
    if (tier === 'deluxe') today.deluxe++;
    this.state.bag.puffs[puff]++;
    this.state.stats.puffsBaked++;
    this.emit('baked', { puff, tier, capped: tier !== wanted });
    this.emit('bag');
    return { ok: true, puff, tier, capped: tier !== wanted };
  }

  // 頭球：連續頂到幾次
  headIt(uid, streak) {
    const mon = this.mon(uid);
    if (!mon) return null;
    const before = amie.hearts(mon.affection);
    const gain = amie.addAffection(mon, mg.headItAffection(streak));
    mon.enjoyment = Math.min(amie.MAX, mon.enjoyment + streak * 2);
    this.afterAffection(mon, before);
    this.emit('party', { uid });
    return { affection: gain };
  }

  // 拼圖拼完
  puzzleDone(uid) {
    const mon = this.mon(uid);
    if (!mon) return null;
    mon.enjoyment = Math.min(amie.MAX, mon.enjoyment + mg.PUZZLE_ENJOYMENT);
    this.emit('party', { uid });
    return { enjoyment: mg.PUZZLE_ENJOYMENT };
  }

  // 超級特訓：打破 pops 個氣球。回傳實際加了多少（碰到上限會變少）
  train(uid, stat, pops) {
    const mon = this.mon(uid);
    if (!mon || !TRAINING_STATS.includes(stat)) return null;
    const before = mon.training[stat];
    // 只能用剩下的空間，不能把別的能力擠掉（normalizeTraining 是依固定順序分配，不能拿來做這件事）
    const room = TRAINING_TOTAL - mg.trainingTotal(mon.training);
    const add = Math.min(Math.max(0, pops) * mg.TRAINING_PER_POP, TRAINING_MAX - before, room);
    mon.training = { ...mon.training, [stat]: before + Math.max(0, add) };
    const gained = mon.training[stat] - before;
    this.emit('trained', { uid, stat, gained });
    this.emit('party', { uid });
    return { gained, value: mon.training[stat] };
  }

  // ---- 專注番茄鐘（規則在 focus.js） ----
  startFocus(minutes = this.state.settings.focusMinutes) {
    if (this.state.focus.active) return false;
    this.state.focus.active = { startedAt: this.now(), minutes: focus.clampMinutes(minutes) };
    this.emit('focus', { active: true });
    return true;
  }
  focusRemaining() { return focus.remainingMs(this.state.focus.active, this.now()); }
  cancelFocus() {
    if (!this.state.focus.active) return false;
    this.state.focus.active = null;
    this.emit('focus', { active: false, done: false });
    return true;
  }
  // 時間到了：給獎勵（由畫面每一幀檢查 focusRemaining() 之後呼叫）
  finishFocus() {
    const f = this.state.focus, a = f.active;
    if (!a || this.focusRemaining() > 0) return null;
    const today = localDate(this.now()), yesterday = localDate(this.now() - DAY);
    const firstToday = f.lastDay !== today;
    f.streakDays = focus.nextStreak(f, today, yesterday);
    f.lastDay = today;
    f.sessions++;
    f.totalMinutes += a.minutes;
    f.active = null;
    this.state.stats.focusSessions++;
    const puff = amie.puffKey(this.rng.pick(amie.FLAVORS), focus.rewardTier(f.streakDays, firstToday));
    this.state.bag.puffs[puff]++;
    for (const m of this.outMons()) {
      const before = amie.hearts(m.affection);
      amie.addAffection(m, focus.FOCUS_AFFECTION);
      this.afterAffection(m, before);
    }
    const r = { puff, minutes: a.minutes, streak: f.streakDays };
    this.emit('focus', { active: false, done: true, ...r });
    this.emit('bag');
    return r;
  }

  // ---- 孵蛋（規則在 eggs.js） ----
  // 每天一次機會：最好的朋友（感情 200 以上）兩隻都在桌面上時
  maybeFindEgg() {
    const today = localDate(this.now());
    if (this.state.eggDay === today) return null;
    const out = this.outMons();
    const pairs = [];
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      if (this.bondOf(out[i].uid, out[j].uid) >= BOND_LEVELS[3].at) pairs.push([out[i], out[j]]);
    }
    if (!pairs.length) return null; // 還沒有這樣的一對：今天的機會先留著
    this.state.eggDay = today;
    if (this.state.eggs.length >= MAX_EGGS || !this.rng.chance(eggs.EGG_CHANCE)) return null;
    const parents = this.rng.pick(pairs);
    const e = eggs.eggFrom(this.dex, parents, this.rng);
    if (!e) return null;
    // 色違機率跟野生的一樣，但連鎖加成不算（連鎖是野生遭遇的機制）
    const noChain = { ...this.state, chain: { species: null, count: 0 } };
    const egg = {
      uid: `egg${this.now().toString(36)}${Math.floor(this.rng() * 1e6).toString(36)}`,
      species: e.species,
      form: e.form,
      shiny: this.rng.chance(shinyChance(noChain, e.species, {})),
      steps: 0,
      need: eggs.eggNeed(e.species),
      receivedAt: this.now(),
    };
    this.state.eggs.push(egg);
    this.emit('eggFound', { egg, parents: parents.map(m => m.uid) });
    this.emit('bag');
    return egg;
  }

  // 游標移動的距離（CSS 像素）＋在電腦前的秒數 → 步數
  addEggSteps(px, activeSeconds) {
    const add = eggs.stepsFrom(px, activeSeconds);
    if (!add) return;
    for (const egg of this.state.eggs) {
      const was = egg.steps;
      egg.steps = Math.min(egg.need, egg.steps + add);
      if (was < egg.need && egg.steps >= egg.need) this.emit('eggReady', { uid: egg.uid });
    }
  }

  readyEggs() { return this.state.eggs.filter(e => e.steps >= e.need); }

  // pos：從哪裡出來（螢幕比例，畫面用）；要在通知畫面之前設好
  hatchEgg(uid, { pos = null } = {}) {
    const i = this.state.eggs.findIndex(e => e.uid === uid && e.steps >= e.need);
    if (i < 0) return null;
    const [egg] = this.state.eggs.splice(i, 1);
    const mon = this.createMon(egg.species, { shiny: egg.shiny, form: egg.form, ball: 'poke' });
    mon.affection = eggs.HATCH_AFFECTION;
    if (pos) mon.pos = pos;
    const t = this.now();
    const d = (this.state.dex[egg.species] ??= { seen: 0, caught: 0, firstSeenAt: t, firstCaughtAt: null });
    const isNewSpecies = d.caught === 0;
    d.seen++;
    d.caught++;
    d.firstCaughtAt ??= t;
    if (egg.shiny) { d.shiny = (d.shiny ?? 0) + 1; this.state.stats.shinies++; }
    this.recordForm(egg.species, egg.form, 'caught');
    if (this.outMons().length < MAX_OUT) mon.out = true;
    this.state.mons.push(mon);
    this.state.stats.eggsHatched++;
    this.checkCharm();
    this.emit('hatched', { mon, isNewSpecies });
    this.emit('party', { uid: mon.uid });
    return mon;
  }

  // ---- 背包 ----
  addPuff(puff, n = 1) { this.state.bag.puffs[puff] = (this.state.bag.puffs[puff] ?? 0) + n; this.emit('bag'); }
  takePuff(puff) {
    if (!(this.state.bag.puffs[puff] > 0)) return false;
    this.state.bag.puffs[puff]--;
    this.emit('bag');
    return true;
  }

  // ---- 遭遇與捕獲 ----
  markSeen(speciesId, form = null) {
    const d = (this.state.dex[speciesId] ??= { seen: 0, caught: 0, firstSeenAt: this.now(), firstCaughtAt: null });
    const isNew = d.seen === 0;
    d.seen++;
    this.recordForm(speciesId, form, 'seen');
    if (isNew) this.emit('dexSeen', { speciesId });
    return isNew;
  }

  // 圖鑑分形態記錄（花蓓蓓的花色…）；預設形態用它的名稱（'red'）當 key
  recordForm(speciesId, form, field) {
    if (!FORMS[speciesId]) return;
    const d = (this.state.dex[speciesId] ??= { seen: 0, caught: 0, firstSeenAt: this.now(), firstCaughtAt: null });
    const key = canonicalForm(speciesId, form) ?? defaultForm(speciesId);
    const f = ((d.forms ??= {})[key] ??= { seen: 0, caught: 0 });
    f[field]++;
    if (field === 'caught' && f.seen === 0) f.seen = 1;
  }

  startEncounter(plan) {
    this.state.stats.encounters++;
    this.markSeen(plan.speciesId, plan.form);
    return { ...plan, puff: 'none', failedThrows: 0, done: false };
  }

  feedWild(wild, puff) {
    if (wild.puff !== 'none') return { ok: false, reason: 'already' };
    if (!this.takePuff(puff)) return { ok: false, reason: 'no-puff' };
    const { flavor } = amie.parsePuffKey(puff);
    wild.puff = amie.tasteReaction(this.dex.nature(wild.nature), flavor);
    wild.puffKey = puff;
    return { ok: true, reaction: wild.puff };
  }

  throwBall(wild, ball, ringMult = 1) {
    if (wild.done) return { ok: false, reason: 'done' };
    if (!(this.state.bag.balls[ball] > 0)) return { ok: false, reason: 'no-ball' };
    this.state.bag.balls[ball]--;
    this.state.stats.throws++;
    const species = this.dex.get(wild.speciesId);
    const p = catchProbability(species.captureRate, { ball, ringMult, puff: wild.puff });
    const roll = rollCatch(p, this.rng);
    const result = { ok: true, p, ...roll, fled: false, mon: null, rewards: null };
    if (roll.caught) {
      wild.done = true;
      Object.assign(result, this.registerCatch(wild, ball));
    } else {
      wild.failedThrows++;
      result.fled = this.rng.chance(fleeChance(species, { puffed: wild.puff !== 'none', failedThrows: wild.failedThrows }));
      if (result.fled) this.wildGone(wild);
    }
    this.emit('bag');
    return result;
  }

  // 野生寶可夢沒被抓到就離開（逃走、等太久、放牠走）：連鎖中斷
  wildGone(wild) {
    if (wild.gone) return 0;
    wild.done = true;
    wild.gone = true;
    const lost = breakChain(this.state, wild.speciesId);
    if (lost) this.emit('chainBroken', { speciesId: wild.speciesId, count: lost });
    return lost;
  }

  registerCatch(wild, ball) {
    const t = this.now();
    const d = (this.state.dex[wild.speciesId] ??= { seen: 1, caught: 0, firstSeenAt: t, firstCaughtAt: null });
    const isNewSpecies = d.caught === 0;
    d.caught++;
    d.firstCaughtAt ??= t;
    const mon = this.createMon(wild.speciesId, { shiny: wild.shiny, nature: wild.nature, ball, form: wild.form });
    this.recordForm(wild.speciesId, wild.form, 'caught');
    // 餵過牠喜歡或討厭的泡芙，抓到時就已經知道牠的口味
    if (wild.puff === 'liked' || wild.puff === 'disliked') mon.tasteKnown = true;
    if (wild.puff !== 'none') amie.addAffection(mon, 10);
    if (this.outMons().length < MAX_OUT) mon.out = true;
    this.state.mons.push(mon);
    this.state.stats.catches++;
    if (wild.shiny) {
      d.shiny = (d.shiny ?? 0) + 1;
      this.state.stats.shinies++;
    }
    const chain = advanceChain(this.state, wild.speciesId);
    if (CHAIN_STEPS.includes(chain)) this.emit('chain', { speciesId: wild.speciesId, count: chain });
    this.checkCharm();
    if (wild.speciesId === 718) this.state.zygardeCells = 0;

    const rewards = { balls: {}, puffs: [] };
    if (isNewSpecies) {
      rewards.balls.great = 2;
      const n = this.caughtCount();
      if (n % 10 === 0) rewards.balls.ultra = 3;
    }
    if (this.rng.chance(0.3)) rewards.puffs.push(this.randomPuff());
    for (const [k, v] of Object.entries(rewards.balls)) this.state.bag.balls[k] += v;
    for (const p of rewards.puffs) this.state.bag.puffs[p]++;
    this.emit('caught', { mon, isNewSpecies, rewards });
    return { mon, isNewSpecies, rewards };
  }

  createMon(species, { shiny = false, nature, ball = 'poke', form = null } = {}) {
    return {
      uid: `${this.now().toString(36)}${Math.floor(this.rng() * 1e9).toString(36)}`,
      species,
      nickname: null,
      nature: nature ?? this.rng.pick(this.dex.natures).slug,
      shiny,
      ball,
      caughtAt: this.now(),
      affection: 0,
      fullness: 100,
      enjoyment: 100,
      xp: 0,
      out: false,
      tasteKnown: false,
      form: canonicalForm(species, form),
      trimAt: null,
      training: normalizeTraining(null),
    };
  }

  chooseStarter(speciesId) {
    if (this.state.starterChosen || !STARTERS.includes(speciesId)) return null;
    const mon = this.createMon(speciesId, { ball: 'poke' });
    mon.out = true;
    mon.affection = 20;
    this.state.mons.push(mon);
    this.state.dex[speciesId] = { seen: 1, caught: 1, firstSeenAt: this.now(), firstCaughtAt: this.now() };
    this.state.starterChosen = true;
    this.emit('starter', { mon });
    return mon;
  }

  // 捕獲 60 種：獲得閃耀護符
  checkCharm() {
    if (this.state.shinyCharm || this.caughtCount() < CHARM_AT) return;
    this.state.shinyCharm = true;
    this.emit('charm');
  }
  shinySpeciesCount() { return Object.values(this.state.dex).filter(d => d.shiny > 0).length; }

  // ---- 夥伴之間 ----
  bond(uidA, uidB, amount = 1) {
    if (uidA === uidB || !this.mon(uidA) || !this.mon(uidB)) return null;
    const k = bondKey(uidA, uidB);
    const before = this.state.bonds[k] ?? 0;
    const after = Math.min(255, before + amount);
    this.state.bonds[k] = after;
    const lv = bondLevel(after);
    if (lv > bondLevel(before)) this.emit('bondUp', { a: uidA, b: uidB, level: lv, zh: BOND_LEVELS[lv].zh });
    return after;
  }
  bondOf(uidA, uidB) { return this.state.bonds[bondKey(uidA, uidB)] ?? 0; }
  bestFriend(uid) {
    let best = null;
    for (const [k, v] of Object.entries(this.state.bonds)) {
      const [a, b] = k.split('|');
      if (a !== uid && b !== uid) continue;
      const other = a === uid ? b : a;
      if (this.mon(other) && (!best || v > best.points)) best = { uid: other, points: v };
    }
    return best;
  }

  addZygardeCell() {
    this.state.zygardeCells = Math.min(10, this.state.zygardeCells + 1);
    this.emit('cell', { cells: this.state.zygardeCells });
  }

  // ---- 夥伴管理 ----
  setOut(uid, out) {
    const mon = this.mon(uid);
    if (!mon) return false;
    if (out && !mon.out && this.outMons().length >= MAX_OUT) return false;
    mon.out = out;
    this.emit('party', { uid, out });
    return true;
  }

  rename(uid, name) {
    const mon = this.mon(uid);
    if (!mon) return;
    const trimmed = (name ?? '').trim().slice(0, 12);
    mon.nickname = trimmed && trimmed !== this.dex.name(mon.species) ? trimmed : null;
    this.emit('party', { uid });
  }

  evolve(uid, extra = {}) {
    const mon = this.mon(uid);
    const status = this.evolutionStatus(uid, extra);
    if (!mon || !status?.ready) return null;
    const from = mon.species;
    mon.species = status.evo.to;
    mon.form = inheritForm(from, mon.species, mon.form); // 藍花的花蓓蓓進化後還是藍花
    const d = (this.state.dex[mon.species] ??= { seen: 0, caught: 0, firstSeenAt: this.now(), firstCaughtAt: null });
    const isNewSpecies = d.caught === 0;
    d.seen++;
    d.caught++;
    d.firstCaughtAt ??= this.now();
    if (mon.shiny) d.shiny = (d.shiny ?? 0) + 1;
    this.recordForm(mon.species, mon.form, 'caught');
    this.state.stats.evolutions++;
    this.checkCharm();
    this.emit('evolved', { uid, from, to: mon.species, isNewSpecies });
    return { from, to: mon.species, isNewSpecies };
  }

  setSetting(key, value) {
    this.state.settings[key] = value;
    this.emit('settings', { key, value });
  }
}

export { BALLS };
