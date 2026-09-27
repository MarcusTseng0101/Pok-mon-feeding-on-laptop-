// 寶可夢使用秘密基地：累了鑽進住的地方（帳篷、小屋、樹屋）睡、住不下就回床上睡、想休息回基地坐坐、
// 晚上回基地睡（有人在睡就擠過去，重用 cuddle）。
// 選項都交給 Pet.decide()（類別是 base）；這裡只提供「可以做什麼」和走過去以後做什麼。
import { socialOptions } from './behaviors.js';
import { STAGES } from '../../core/base.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.floor(Math.random() * list.length)];

// 床上已經有人（一張床睡一隻）
export function freeBeds(pet) {
  const view = pet.stage.baseView;
  if (!view) return [];
  const taken = new Set([...pet.stage.pets.values()].filter(o => o !== pet && o.bedId).map(o => o.bedId));
  return view.base.items.filter(it => it.kind === 'bed' && !taken.has(it.id));
}

function walkThen(pet, to, then) {
  pet.target = { x: to.x, y: to.y };
  pet.walkLimit = 45; // 基地可能在螢幕另一頭：走久一點也沒關係
  pet.set('walk');
  pet.onArrive = then;
}

// 走到床上睡覺
export function goToBed(pet, { night = false } = {}) {
  const bed = pick(freeBeds(pet));
  if (!bed) return false;
  const spot = pet.stage.baseView.spotOf(bed);
  walkThen(pet, spot, () => {
    pet.x = spot.x; pet.gy = spot.y;
    pet.bedId = bed.id;
    // 晚上的 sleep 會睡到早上；白天用 nap（睡一陣子就起來）
    pet.set(night ? 'sleep' : 'nap', night ? rnd(30, 60) : rnd(15, 30));
    pet.showEmote('Z', 1.5);
  });
  return true;
}

// 走到基地的空地坐著（或看看有沒有人在睡，擠過去）
export function goHomeAndRest(pet, { night = false } = {}) {
  const view = pet.stage.baseView;
  const spots = view?.freeSpots() ?? [];
  if (!spots.length) return false;
  walkThen(pet, pick(spots), () => {
    if (night) {
      const cuddle = socialOptions(pet, []).find(([n]) => n === 'cuddle');
      if (cuddle) { cuddle[2](); return; }
      pet.set('sleep', rnd(20, 40));
      return;
    }
    pet.set('sit', rnd(5, 10));
    pet.showEmote('♪', 1);
  });
  return true;
}

// ---------- 鑽進住的地方睡 ----------
// goIn（鑽進去、慢慢看不見）→ inside（看不見、點不到；偶爾從門口探頭）→ goOut（走出來）→ 伸懶腰
export const INSIDE = ['goIn', 'inside', 'goOut'];
const PEEK = 1.6; // 探頭多久（秒，猜的，可調整）
export function roomInside(pet) {
  const view = pet.stage.baseView;
  if (!view) return 0;
  const n = [...pet.stage.pets.values()].filter(o => o !== pet && INSIDE.includes(o.state)).length;
  return Math.max(0, STAGES[view.base.stage].sleeps - n);
}
export function goInside(pet, { night = false } = {}) {
  if (!roomInside(pet)) return false;
  const door = pet.stage.baseView.door();
  walkThen(pet, door, () => {
    if (!roomInside(pet)) { pet.set('sit', rnd(3, 6)); return; } // 走到門口才發現住滿了
    pet.x = door.x; pet.gy = door.y;
    pet.insideFor = night ? rnd(30, 60) : rnd(15, 30); // 跟睡床一樣久
    pet.set('goIn', 0.6);
  });
  return true;
}
export const TENT_ACTIONS = {
  goIn: {
    update(pet, dt, done) { if (done) { pet.peekT = rnd(6, 12); pet.peeking = 0; pet.set('inside', pet.insideFor ?? 20); } },
    pose(pet, p) { const k = Math.min(1, pet.stateT / 0.6); p.sy = 1 - 0.25 * k; p.sx = 1 - 0.15 * k; },
    alpha: pet => Math.max(0, 1 - pet.stateT / 0.6),
    lift: () => 0,
  },
  inside: {
    update(pet, dt, done) {
      if (pet.peeking > 0) pet.peeking -= dt;
      else if ((pet.peekT -= dt) <= 0) { pet.peeking = PEEK; pet.peekT = rnd(8, 16); if (!pet.emote) pet.showEmote('Z', PEEK); } // 探頭看一下外面（猜的，可調整）
      if (done) { pet.peeking = 0; pet.set('goOut', 0.6); }
    },
    pose(pet, p) { p.sx = 0.45; p.sy = 0.45; }, // 探頭的時候：站在門口裡面，比外面小（在後面；猜的，可調整）
    alpha: pet => (pet.peeking > 0 ? 1 : 0),
    intangible: () => true, // 在裡面：點不到、滑鼠移過去也沒有名字
    lift: () => 0,
  },
  goOut: {
    update(pet, dt, done) { if (done) { pet.set('stretch', 1.2); pet.showEmote('…', 1); } },
    alpha: pet => Math.min(1, pet.stateT / 0.6),
    lift: () => 0,
  },
};

export const atHome = pet => Boolean(pet.stage.baseView?.contains(pet.x, pet.gy, 10 * pet.S));

// Pet.decide() 用：[名稱, 權重, 動作]（類別都是 base）
export function homeOptions(pet) {
  if (!pet.stage.baseView || pet.perch) return [];
  const mind = pet.mon.mind;
  const energy = mind?.energy ?? 70, comfort = mind?.comfort ?? 70;
  const beds = freeBeds(pet).length, room = roomInside(pet);
  const tired = energy < 30 ? 30 : energy < 50 ? 8 : 0;
  return [
    // 很累的時候最想回家睡（比原地打瞌睡更想）：鑽進住的地方比床更想，住不下才睡床；權重是猜的，可以調
    ['goTent', room ? tired * 1.5 : 0, () => goInside(pet) || goToBed(pet) || pet.set('nap', rnd(8, 14))],
    ['goBed', !beds ? 0 : tired, () => goToBed(pet) || pet.set('nap', rnd(8, 14))],
    // 回基地坐坐：舒適度越低越想回去；就算不累，偶爾也會回家看看
    // （權重是猜的，可以調）
    ['goBase', atHome(pet) ? 0.5 : comfort < 70 ? 5 : 2.5, () => goHomeAndRest(pet) || pet.set('sit', rnd(3, 6))],
  ];
}

// 累壞了（體力 < 20）而且住得下或有空床：直接回家睡，不再東摸西摸
export const EXHAUSTED = 20;
export function exhausted(pet) {
  if (!pet.stage.baseView || pet.perch || (pet.mon.mind?.energy ?? 100) >= EXHAUSTED) return null;
  if (roomInside(pet)) return ['goTent', 1, () => goInside(pet) || goToBed(pet)];
  if (!freeBeds(pet).length) return null;
  return ['goBed', 1, () => goToBed(pet)];
}

// 晚上想睡：回基地（床空著就上床，不然去基地擠在一起）
export function homeNight(pet) {
  if (!pet.stage.baseView || pet.perch) return null;
  if (atHome(pet)) return null; // 已經在家：照原本的方式睡（旁邊有人就擠過去）
  if (roomInside(pet) && Math.random() < 0.6) return ['goTent', 1, () => goInside(pet, { night: true }) || goToBed(pet, { night: true })]; // 猜的，可調整
  if (freeBeds(pet).length && Math.random() < 0.6) return ['goBed', 1, () => goToBed(pet, { night: true })];
  return ['homeNight', 1, () => goHomeAndRest(pet, { night: true })];
}

