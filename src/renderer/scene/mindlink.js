// 把心智（core/mind.js）接到舞台上的寶可夢：
//   - 每秒更新一次需求（不是每一幀，不然想法會一直閃）
//   - Pet.decide() 的每個選項歸到一個類別，權重乘上心智給的倍率
//   - 抽出來、開始做以後，才用「實際被選中的類別」問理由（理由才不會說謊）
// 心智不自己選行為；選行為的只有 Pet.decide()。
import * as M from '../../core/mind.js';
import { recall, summary } from '../../core/memory.js';
import { freeBeds } from './home.js';

const MIN = 60_000;
const SLEEP_STATES = new Set(['sleep', 'nap']);
const REST_STATES = new Set(['sit', 'idle', 'sunbathe', 'chill', 'cuddle']);

// 選項名稱 → 類別。沒列出來的用來源預設（socialOptions → social、habitOptions → habit…）
const NAME_CAT = {
  walk: 'explore', look: 'explore', dig: 'explore', slime: 'explore', soar: 'explore', perch: 'explore', down: 'explore',
  idle: 'rest', sit: 'rest', stretch: 'rest', shiver: 'rest', nap: 'rest', sunbathe: 'rest', chill: 'rest',
  follow: 'cursor', pounce: 'cursor', chaseCursor: 'cursor', cursorSit: 'cursor',
  run: 'play', spin: 'play', dance: 'play', roll: 'play', splash: 'play', ember: 'play', spark: 'play',
  bubbles: 'play', fade: 'play', teleport: 'play', shine: 'play', twirl: 'play',
  trip: 'trip', depart: 'trip',
  goBed: 'base', goBase: 'base', homeNight: 'base',
  forage: 'need', sniff: 'need', hungry: 'need', beg: 'need',
  train: 'train',
  play: 'social',
};

// [名稱, 權重, 動作] → [名稱, 權重, 動作, 類別]
export function tag(list, fallback) {
  return list.map(([n, w, f]) => [n, w, f, NAME_CAT[n] ?? fallback]);
}

export function ensureMind(pet) {
  pet.mon.mind ??= M.createMind(Math.random);
  pet.mon.memory ??= [];
  return pet.mon.mind;
}

export function tickMind(pet, dt) {
  pet.mindT = (pet.mindT ?? 0) + dt;
  if (pet.mindT < 1) return;
  const mind = ensureMind(pet);
  const env = pet.stage.env;
  const activity = SLEEP_STATES.has(pet.state) ? 'sleep' : REST_STATES.has(pet.state) ? 'rest' : null;
  M.tickNeeds(mind, pet.mindT, { activity, night: (env.hour ?? 12) >= 20 || (env.hour ?? 12) < 6 });
  pet.mindT = 0;
}

const nameOf = (st, mon) => mon.nickname ?? st.dex.name(mon.species);

// 目前跟誰的競爭心最強（在桌面上的夥伴裡）
function topRival(pet) {
  const game = pet.stage.game;
  if (!game) return null;
  let best = null;
  for (const o of pet.stage.pets.values()) {
    if (o === pet) continue;
    const r = game.rivalryOf(pet.uid, o.uid);
    if (r > 0 && (!best || r > best.r)) best = { pet: o, r };
  }
  return best;
}

export function levelsOf(pet) {
  return M.levels(ensureMind(pet), pet.mon);
}

// 權重乘上心智的倍率（stage.mindOff 時全部當 1，用來量基準線）
export function weigh(pet, choices) {
  if (pet.stage.mindOff) return choices;
  const mind = ensureMind(pet);
  const w = M.weights(mind, M.levels(mind, pet.mon), M.traitsOf(pet.mon.nature), { rival: Boolean(topRival(pet)), userActive: Boolean(pet.stage.env.userActive), canTrip: Boolean(pet.stage.game?.canDepart(pet.uid)) && !pet.perch, bedFree: freeBeds(pet).length > 0 });
  return choices.map(([n, wt, f, cat]) => [n, wt * (w[cat] ?? 1), f, cat]);
}

// 做了這個選項以後：滿足需求、想一個理由、記下來
export function afterChoice(pet, [name, , , cat]) {
  const st = pet.stage, game = st.game;
  const mind = ensureMind(pet);
  const lv = M.levels(mind, pet.mon);
  const now = Date.now();
  // 對象：一起玩的夥伴、一群裡的其他成員；練習的話找競爭對手
  let otherPet = pet.partner ?? pet.group?.members?.find(o => o !== pet) ?? null;
  if (!otherPet && cat === 'train') otherPet = topRival(pet)?.pet ?? null;
  const other = otherPet && game ? {
    name: nameOf(st, otherPet.mon),
    bond: game.bondOf(pet.uid, otherPet.uid),
    rivalry: game.rivalryOf(pet.uid, otherPet.uid),
  } : null;
  const mem = pet.mon.memory ?? [];
  const ctx = {
    other,
    recentFed: recall(mem, { k: 'fed', since: now - 10 * MIN }).length > 0,
    recentStroke: recall(mem, { k: 'stroked', since: now - 10 * MIN }).length > 0,
    night: Boolean(pet.stage.env.sleepy),
    sawPeeker: recall(mem, { k: 'saw-peeker', since: now - 24 * 60 * MIN }).length > 0,
    cursorSurprised: recall(mem, { k: 'cursor-surprised', since: now - 24 * 60 * MIN }).length > 0,
    playedWithOther: otherPet ? recall(mem, { k: 'played-with', with: otherPet.uid, since: now - 24 * 60 * MIN }).length > 0 : false,
  };
  const thought = M.reason(cat, lv, Math.random, ctx);
  const delta = M.satisfy(mind, cat, { name, food: lv.food });
  // 小遊戲進行中：獎勵由小遊戲決定，自己做的事不再加減數值
  if ((delta.fullness || delta.enjoyment) && !st.minigame?.active) game?.mindDelta(pet.uid, delta);
  if (cat === 'social' && otherPet?.mon.mind) M.socialized(otherPet.mon.mind);
  M.think(mind, thought, now);
  pet.thought = { ...thought, cat, at: pet.t };
  st.decisionLog?.push({ uid: pet.uid, name, cat, key: thought.key, text: thought.text, cites: M.citesOf(thought.key) });
  return thought;
}

// 夥伴資料頁用：心情、需求、最近的想法、記得的事（收回來的也看得到）
export function describe(mon, now = Date.now()) {
  const mind = mon.mind ?? M.normalizeMind(null);
  const lv = M.levels(mind, mon);
  const lost = recall(mon.memory ?? [], { k: 'lost', since: now - 10 * MIN }).length > 0;
  return { mood: M.moodOf(lv, { lostRecently: lost }), levels: lv, thoughts: [...mind.thoughts].reverse(), memories: summary(mon.memory ?? [], now, 3) };
}
