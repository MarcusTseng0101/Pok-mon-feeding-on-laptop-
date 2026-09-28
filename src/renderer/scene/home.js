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

// 兩個框（{ x, y, w, h }）重疊的面積占比較小那個的多少（0–1）
export function overlapFrac(ra, rb) {
  const ix = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
  const iy = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
  return ix > 0 && iy > 0 ? (ix * iy) / Math.min(ra.w * ra.h, rb.w * rb.h) : 0;
}
// 假設牠站在 (x, y)（腳底）時畫出來的框：會飄的畫在腳底上面 alt 美術像素（跟 Pet.rect() 一樣）
function rectAt(p, x, y) {
  const S = p.S, w = p.asset.w * S, h = p.asset.h * S;
  return { x: x - w / 2, y: y - (p.alt ?? 0) * S - h, w, h };
}
// 重疊超過這個比例就算擠在一起（一前一後稍微蓋到一點是正常的遠近，蓋掉一大塊就是疊成一團）。
// 測試（basecrowd.cjs）量的是 30%，這裡 25% 就挪開，才不會卡在剛好 30% 的邊界上（猜的，可調整）
export const CROWD = 0.25;
// 挑空格時要更空一點：走路停下的位置跟那一格會差一兩個像素，留點餘裕才不會一到就又算擠（猜的，可調整）
const SPOT_ROOM = 0.15;
const DAY_INSIDE = 0.5; // 白天回基地休息時鑽進住的地方的機會（猜的，可調整）

// 基地的空地裡，還沒被別隻占走的：別隻坐在那裡、或正要走過去的格子不算（不然好幾隻擠在同一格、疊在一起）
export function openSpots(pet) {
  const view = pet.stage.baseView;
  if (!view) return [];
  // 別隻要去的那一格、和牠現在真的站的地方（走到空地時停的位置會跟那一格差一點）都要避開
  const taken = [...pet.stage.pets.values()].filter(o => o !== pet && !o.perch && !INSIDE.includes(o.state))
    .flatMap(o => [o.homeSpot && { o, at: o.homeSpot }, view.contains(o.x, o.gy) && { o, at: { x: o.x, y: o.gy } }].filter(Boolean));
  return view.freeSpots().filter(sp => taken.every(({ o, at }) => overlapFrac(rectAt(pet, sp.x, sp.y), rectAt(o, at.x, at.y)) <= SPOT_ROOM));
}

// 走到最近一格沒人的空地，到了做 then（沒有空地就回傳 false）
function goSpot(pet, then) {
  const spots = openSpots(pet);
  if (!spots.length) return false;
  const spot = spots.reduce((a, b) => (Math.hypot(b.x - pet.x, b.y - pet.gy) < Math.hypot(a.x - pet.x, a.y - pet.gy) ? b : a));
  pet.homeSpot = spot; // 別隻挑位置時知道這格有人要來了（Pet.decide() 清掉）
  walkThen(pet, spot, then);
  return true;
}

// 在基地裡跟牠疊在一起的那一隻（沒有就是 undefined）。only：只看符合條件的（例如正在休息的）
function crowdedBy(pet, only = () => true) {
  const view = pet.stage.baseView;
  if (!view || pet.perch || pet.bedId || !view.contains(pet.x, pet.gy)) return undefined;
  const r = pet.rect();
  return [...pet.stage.pets.values()].find(o => o !== pet && only(o) && !o.bedId && !o.perch && !INSIDE.includes(o.state) && view.contains(o.x, o.gy)
    && overlapFrac(r, o.rect()) > CROWD);
}
const crowded = pet => Boolean(crowdedBy(pet));

// 休息中每 ROOM_CHECK 秒看一次：停下來的地方跟別隻疊在一起（追著玩、嚇一跳、東張西望完直接停在原地，
// 或走到空地時停的位置跟目標差一點），就讓後來停下的那隻挪開；另一隻還在走的話等牠走過去
const RESTING = new Set(['idle', 'sit', 'look', 'stretch', 'nap']);
const ROOM_CHECK = 0.5; // 秒（猜的，可調整）
export function tickRoom(pet, dt) {
  if (!RESTING.has(pet.state) || pet.reserved || pet.partner) return;
  pet.roomT = (pet.roomT ?? 0) + dt;
  if (pet.roomT < ROOM_CHECK) return;
  pet.roomT = 0;
  const o = crowdedBy(pet, q => RESTING.has(q.state)); // 還在走的：等牠走過去
  if (!o) return;
  const newer = pet.stateT < o.stateT || (pet.stateT === o.stateT && pet.uid > o.uid); // 同時停下的：固定讓其中一隻讓
  if (newer) makeRoom(pet);
}

// 動物休息時會保持個體距離：在基地裡跟別隻疊在一起，就挪到最近的空地（基地滿了就走開）。
// Pet.decide() 每次先問這裡；從帳篷出來、門口住滿的也用這個。then：到了以後做什麼（預設坐下）
export function makeRoom(pet, then = () => { pet.set('sit', rnd(5, 10)); }) {
  if (!crowded(pet)) return false;
  if (!goSpot(pet, then)) { pet.target = pet.randomPoint(60, 160); pet.set('walk'); }
  return true;
}

// 走到基地的空地坐著（或看看有沒有人在睡，擠過去）。
// 白天：住的地方還住得下，一半的機會鑽進去休息（動物大多回窩休息；全部都進去的話桌面上會空空的、也沒辦法找牠玩）；
// 不然找一格沒人的空地；都沒有就不去
export function goHomeAndRest(pet, { night = false } = {}) {
  const view = pet.stage.baseView;
  if (!view) return false;
  if (!night && roomInside(pet) && (Math.random() < DAY_INSIDE || !openSpots(pet).length)) return goInside(pet);
  const spots = night ? view.freeSpots() : openSpots(pet); // 晚上本來就是擠在一起睡
  if (!spots.length) return false;
  const spot = pick(spots);
  pet.homeSpot = spot;
  walkThen(pet, spot, () => {
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
    if (!roomInside(pet)) { if (!goSpot(pet, () => pet.set('sit', rnd(5, 10)))) pet.set('sit', rnd(3, 6)); return; } // 走到門口才發現住滿了：找一格空地坐（門口會有別隻出來）
    pet.insideFor = night ? rnd(30, 60) : rnd(15, 30); // 跟睡床一樣久
    pet.insideNight = night; // 晚上鑽進去的：跟睡床一樣睡到早上才出來
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
      // 白天小睡：時間到就出來；晚上：睡到早上（跟睡床的 sleep 一樣，env.sleepy 結束才醒）
      const wake = pet.insideNight ? !pet.stage.env.sleepy : done;
      if (wake) { pet.peeking = 0; pet.insideNight = false; pet.set('goOut', 0.6); }
    },
    pose(pet, p) { p.sx = 0.45; p.sy = 0.45; }, // 探頭的時候：站在門口裡面，比外面小（在後面；猜的，可調整）
    alpha: pet => (pet.peeking > 0 ? 1 : 0),
    intangible: () => true, // 在裡面：點不到、滑鼠移過去也沒有名字
    lift: () => 0,
  },
  goOut: {
    update(pet, dt, done) {
      if (!done) return;
      const stretch = () => { pet.set('stretch', 1.2); pet.showEmote('…', 1); };
      if (!makeRoom(pet, stretch)) stretch(); // 門口有別隻：先走開一點再伸懶腰
    },
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
    // 住的地方住滿、空地也都有人：不去（去了只會擠成一團）
    ['goBase', !room && !openSpots(pet).length ? 0 : atHome(pet) ? 0.5 : comfort < 70 ? 5 : 2.5, () => goHomeAndRest(pet) || pet.set('sit', rnd(3, 6))],
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

