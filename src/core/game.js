// 遊戲狀態的唯一入口：所有改動存檔的動作都經過 Game，畫面只負責演出。
// 不碰 DOM、不碰 Electron，所以 node --test 可以直接測。

import * as amie from './amie.js';
import { BALLS, catchProbability, rollCatch, fleeChance } from './capture.js';
import { checkEvolution } from './evolution.js';
import { MAX_OUT } from './save.js';
import { CHARM_AT, CHAIN_STEPS, advanceChain, breakChain } from './shiny.js';

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
  markSeen(speciesId) {
    const d = (this.state.dex[speciesId] ??= { seen: 0, caught: 0, firstSeenAt: this.now(), firstCaughtAt: null });
    const isNew = d.seen === 0;
    d.seen++;
    if (isNew) this.emit('dexSeen', { speciesId });
    return isNew;
  }

  startEncounter(plan) {
    this.state.stats.encounters++;
    this.markSeen(plan.speciesId);
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
    const mon = this.createMon(wild.speciesId, { shiny: wild.shiny, nature: wild.nature, ball });
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

  createMon(species, { shiny = false, nature, ball = 'poke' } = {}) {
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
    const d = (this.state.dex[mon.species] ??= { seen: 0, caught: 0, firstSeenAt: this.now(), firstCaughtAt: null });
    const isNewSpecies = d.caught === 0;
    d.seen++;
    d.caught++;
    d.firstCaughtAt ??= this.now();
    if (mon.shiny) d.shiny = (d.shiny ?? 0) + 1;
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
