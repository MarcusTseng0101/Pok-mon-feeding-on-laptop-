// 牠們自己的生活，在桌面上（規則在 core/life.js）：自己去喝水、看書、吃東西，旁邊放著杯子、書、碗。
// 不出聲、不跳通知、不走向游標：是環境裡的變化，不算打擾（不用經過打擾額度）。
// 心智照舊決定要做什麼（Pet.decide）；core/life.js 說這一格牠在做什麼，那件事的選項權重就乘上 LIFE_BOOST。
// 這裡只演出，不改任何數值。
import { Prop } from './wild.js';
import { traceImg } from '../gfx/traces.js';

export const LIFE_BOOST = 4; // 這一格在做的事，選到的機會變成幾倍（猜的，可調整）
// core/life.js 的生活 → 桌面上對應的選項（Pet.decide 的名字）
export const LIFE_OPTS = {
  drink: ['sip'], read: ['read'], eat: ['munch', 'hungry'],
  nap: ['sit', 'stretch'], sleep: ['sit'], play: ['run', 'play', 'spin', 'roll'], wander: ['walk', 'look'],
};
const ITEM = { sip: 'cup', read: 'book', munch: 'bowl' }; // 放在旁邊的小東西（gfx/traces.js）

const rnd = (a, b) => a + Math.random() * (b - a);

const AGAIN_AFTER = 8 * 60; // 同一件事做完以後，至少隔幾秒才會再做（喝完水不會馬上又喝；猜的，可調整）

// 平常也偶爾會做（權重跟 sit、look 差不多小）；這一格正在做的話由 boostLife 放大
export function lifeOptions(pet) {
  if (pet.perch) return [];
  const w = (name, base) => (pet.t - (pet.lifeLast?.[name] ?? -Infinity) < AGAIN_AFTER ? 0 : base);
  return [
    ['sip', w('sip', 2), () => startLifeAct(pet, 'sip', rnd(4, 6))],
    ['read', w('read', 2), () => startLifeAct(pet, 'read', rnd(8, 14))],
    ['munch', w('munch', 1.5), () => startLifeAct(pet, 'munch', rnd(4, 6))],
  ];
}

// choices：[名稱, 權重, 動作, 類別]；act：core/life.js 說牠這一格在做什麼
export function boostLife(choices, act) {
  const names = LIFE_OPTS[act];
  if (!names) return choices;
  return choices.map(c => (names.includes(c[0]) ? [c[0], c[1] * LIFE_BOOST, c[2], c[3]] : c));
}

// 把杯子（書、碗）放在面前，開始做
export function startLifeAct(pet, name, dur) {
  const st = pet.stage, S = pet.S;
  finish(pet); // 上一個還沒收：先收
  const x = Math.max(24 * S, Math.min(st.W - 24 * S, pet.x + pet.facing * (pet.asset.w * S * 0.5 + 12 * S)));
  const prop = new Prop(st, { kind: 'npc', x, y: pet.gy, life: dur + 0.4, scale: 2 });
  prop.img = traceImg(ITEM[name]);
  prop.hit = () => false; // 只是擺著：點不到、不擋滑鼠
  prop.lifeItem = name; // 測試用
  st.props.push(prop);
  pet.lifeProp = prop;
  pet.facing = x > pet.x ? 1 : -1;
  pet.set(name, dur);
  (pet.lifeLast ??= {})[name] = pet.t;
  st.lifeLog?.push({ uid: pet.uid, name }); // 測試用
}

// 自己喝水、看書、吃東西到一半，被別的事叫走（下雨擠到游標旁邊…）：把杯子、書、碗收起來
export const busyWithLife = pet => Object.hasOwn(LIFE_ACTIONS, pet.state);
export function stopLifeAct(pet) { finish(pet); }

function finish(pet) {
  if (pet.lifeProp) { pet.lifeProp.life = Math.min(pet.lifeProp.life, pet.lifeProp.t); pet.lifeProp = null; }
}

export const LIFE_ACTIONS = {
  // 喝水：低頭喝一口、抬頭，重複
  sip: {
    update(pet, dt, done) {
      if (Math.floor(pet.stateT / 1.2) !== Math.floor((pet.stateT - dt) / 1.2) && Math.random() < 0.3 && !pet.emote) pet.showEmote('♪', 0.8);
      if (done) { finish(pet); pet.set('idle', 1); }
    },
    pose(pet, p) { const dip = (pet.stateT % 1.2) < 0.5; p.sy = dip ? 0.93 : 1; p.sx = dip ? 1.04 : 1; p.rot = dip ? pet.facing * 0.12 : 0; },
    lift: () => 0,
  },
  // 看書：坐著，偶爾點頭、翻一頁
  read: {
    update(pet, dt, done) {
      if (Math.random() < dt * 0.15 && !pet.emote) pet.showEmote('…', 1.2);
      if (done) { finish(pet); pet.set('stretch', 1.2); }
    },
    pose(pet, p) { p.sx = 1.08; p.sy = 0.88; p.rot = Math.floor(pet.stateT / 1.6) % 2 ? pet.facing * 0.06 : 0; },
    lift: () => 0,
  },
  // 吃東西：一口一口
  munch: {
    update(pet, dt, done) {
      if (Math.floor(pet.stateT / 0.5) !== Math.floor((pet.stateT - dt) / 0.5) && pet.lifeProp) {
        const r = pet.lifeProp.rect();
        pet.stage.fx.crumbs?.(r.x + r.w / 2, r.y, pet.S, '#e8404a');
      }
      if (done) { finish(pet); pet.set('happy', 0.6); }
    },
    pose(pet, p) { const bite = (pet.stateT % 0.5) < 0.2; p.sy = bite ? 0.92 : 1; p.rot = bite ? pet.facing * 0.1 : 0; },
    lift: () => 0,
  },
};
