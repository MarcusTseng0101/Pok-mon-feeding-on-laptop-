// 出門旅行：寶可夢走出螢幕，去卡洛斯的某個地方玩一陣子，回來時帶明信片、日記和禮物。
//
// 時間一律用絕對時間（departedAt、returnAt），程式關掉也照樣在旅行；
// 結算（settleTrip）用旅行自己的種子產生結果，所以結算幾次、在哪台電腦結算，結果都一樣。
// 結算過的旅行記在 state.tripsDone，同步時另一台電腦就不會再結算一次（不會拿到兩份禮物）。
// 這裡不用內建亂數，也不碰畫面。
import { createRng } from './rng.js';
import { BERRIES } from './amie.js';

const MIN = 60_000;
export const TRIP_MIN_MIN = 30; // 旅行最短、最長幾分鐘（猜的，可以調）
export const TRIP_MAX_MIN = 360;
export const FRIEND_CHANCE = 0.05; // 帶朋友回來
export const EGG_CHANCE = 0.03; // 撿到蛋
export const POSTCARDS_KEPT = 60;
const TRIPS_DONE_KEPT = 300;

// 卡洛斯的 12 個地點。types：那裡常見的屬性（旅行的寶可夢屬性相同比較想去；日記裡看到的寶可夢）
// gifts：可能帶回來的東西（權重）；diary：日記（{place} 地點、{sight} 看到的寶可夢、{friend} 好朋友）
export const PLACES = {
  'reflection-cave': {
    zh: '鏡面洞窟', types: ['rock', 'fairy', 'steel'],
    gifts: { ball: 3, berry: 4, puff: 2 },
    diary: ['在{place}看到好多個自己，嚇了一跳', '{place}的牆壁亮晶晶的，照出好多個我', '在{place}遇到了{sight}，牠也在照鏡子'],
    friendDiary: '想讓{friend}也看看{place}的鏡子',
  },
  lumiose: {
    zh: '密阿雷市', types: ['normal', 'electric', 'psychic'],
    gifts: { puff: 5, ball: 3, berry: 1 },
    diary: ['{place}的稜柱塔好高，晚上會發光', '在{place}的咖啡廳門口聞到好香的泡芙', '在{place}的大街上跟{sight}擦身而過'],
    friendDiary: '{place}好大，下次想跟{friend}一起逛',
  },
  'fossil-lab': {
    zh: '化石研究所', types: ['rock', 'dragon'],
    gifts: { ball: 4, berry: 2, puff: 1 },
    diary: ['在{place}看到好大的骨頭', '{place}的研究員摸了摸我的頭', '在{place}聽說很久很久以前有{sight}'],
    friendDiary: '要跟{friend}說{place}的化石有多大',
  },
  'wish-lake': {
    zh: '許願星湖', types: ['water', 'fairy'],
    gifts: { berry: 4, puff: 3, ball: 1 },
    diary: ['晚上在{place}看到流星，許了一個願望', '{place}的水好清，看得到星星的倒影', '在{place}邊跟{sight}一起看星星'],
    friendDiary: '在{place}許願希望一直跟{friend}在一起',
  },
  'frost-cavern': {
    zh: '冰雪山道', types: ['ice'],
    gifts: { berry: 3, ball: 3, puff: 2 },
    diary: ['{place}好冷，鼻子都凍紅了', '在{place}滑了一跤，冰好滑', '{place}的雪地上有{sight}的腳印'],
    friendDiary: '{place}好冷，好想跟{friend}擠在一起取暖',
  },
  'fog-forest': {
    zh: '迷霧森林', types: ['bug', 'grass', 'ghost'],
    gifts: { berry: 5, puff: 1, ball: 2 },
    diary: ['在{place}差點迷路，還好找到路回來', '{place}的霧好濃，好像有誰在看我', '在{place}的樹洞裡看到{sight}在睡覺'],
    friendDiary: '在{place}迷路的時候好想{friend}',
  },
  seaside: {
    zh: '海邊城鎮', types: ['water', 'flying'],
    gifts: { berry: 3, ball: 3, puff: 2 },
    diary: ['在{place}的沙灘上撿到一個貝殼', '{place}的海風鹹鹹的', '在{place}看到{sight}在浪花裡玩'],
    friendDiary: '下次想跟{friend}一起去{place}玩水',
  },
  'flower-field': {
    zh: '花田', types: ['grass', 'fairy', 'bug'],
    gifts: { berry: 5, puff: 2, ball: 1 },
    diary: ['{place}開滿了花，香香的', '在{place}打了好幾個滾', '在{place}跟{sight}一起聞花'],
    friendDiary: '摘了一朵{place}的花想送給{friend}',
  },
  desert: {
    zh: '沙漠', types: ['ground', 'fire'],
    gifts: { ball: 4, berry: 2, puff: 1 },
    diary: ['{place}好熱，沙子燙腳', '在{place}挖到一個亮亮的東西', '在{place}看到{sight}從沙子裡跑出來'],
    friendDiary: '{place}好熱，好想念跟{friend}吹冷氣',
  },
  tunnel: {
    zh: '隧道', types: ['dark', 'ground', 'poison'],
    gifts: { ball: 4, berry: 3, puff: 1 },
    diary: ['{place}裡面黑黑的，有點可怕', '在{place}聽到自己的回音', '在{place}的角落遇到了{sight}'],
    friendDiary: '在{place}裡面有點怕，要是{friend}在就好了',
  },
  castle: {
    zh: '城堡', types: ['steel', 'psychic', 'ghost'],
    gifts: { puff: 4, ball: 3, berry: 1 },
    diary: ['{place}的花園好漂亮', '在{place}看到一個會動的盔甲', '{place}的走廊上有{sight}在散步'],
    friendDiary: '想帶{friend}去{place}當公主和王子',
  },
  arena: {
    zh: '競技場', types: ['fighting', 'fire', 'dragon'],
    gifts: { ball: 5, puff: 2, berry: 1 },
    diary: ['在{place}看了一場好精彩的對戰', '在{place}學到一招新的姿勢', '在{place}看到{sight}拿到了冠軍'],
    friendDiary: '要變得跟{place}的冠軍一樣強，打贏{friend}',
  },
};
export const PLACE_IDS = Object.keys(PLACES);

// ---------- 狀態 ----------
// mon.trip = { id, place, departedAt, returnAt, seed }（null＝在家）
export function normalizeTrip(t) {
  if (!t || typeof t !== 'object' || !PLACES[t.place] || typeof t.id !== 'string') return null;
  if (!Number.isFinite(t.departedAt) || !Number.isFinite(t.returnAt) || t.returnAt < t.departedAt) return null;
  return { id: t.id.slice(0, 60), place: t.place, departedAt: t.departedAt, returnAt: t.returnAt, seed: Number.isFinite(t.seed) ? t.seed >>> 0 : 1 };
}

// 時鐘被調回去（now 比出發時間還早）：從現在重新算，旅行長度不變，不會永遠回不來
export function fixClock(trip, now) {
  if (!trip || now >= trip.departedAt) return trip;
  const dur = trip.returnAt - trip.departedAt;
  trip.departedAt = now;
  trip.returnAt = now + dur;
  return trip;
}

// 'home'（在家）、'away'（旅行中）、'back'（回來了，明信片還沒收）
export function tripStatus(mon, now) {
  if (!mon?.trip) return 'home';
  fixClock(mon.trip, now);
  return now >= mon.trip.returnAt ? 'back' : 'away';
}

export const travelers = state => state.mons.filter(m => m.trip);

// 可以出發嗎：在桌面上、現在沒有別隻在旅行、出發後桌面上還至少有一隻
export function canDepart(state, uid) {
  const mon = state.mons.find(m => m.uid === uid);
  if (!mon || !mon.out || mon.trip) return false;
  if (travelers(state).length) return false;
  return state.mons.filter(m => m.out && !m.trip && m.uid !== uid).length >= 1;
}

// ---------- 出發 ----------
// 去哪裡：屬性相同的地方比較想去；去多久：越好奇去越久
export function planTrip(mon, { types = [], curious = 0.5 } = {}, rng, now) {
  const place = rng.weighted(PLACE_IDS.map(id => ({ id, w: PLACES[id].types.some(t => types.includes(t)) ? 3 : 1 }))).id;
  const minutes = Math.round(TRIP_MIN_MIN + rng() * (TRIP_MAX_MIN - TRIP_MIN_MIN) * (0.3 + curious * 0.7));
  return {
    id: `${mon.uid}-${now.toString(36)}`,
    place,
    departedAt: now,
    returnAt: now + minutes * MIN,
    seed: Math.floor(rng() * 2 ** 31),
  };
}

// ---------- 結算 ----------
// 用旅行自己的種子決定帶回來什麼：結算幾次都一樣（但只有第一次會真的加進背包）
export function rollTrip(trip, { dex, friendName = null, selfName = '' } = {}) {
  const rng = createRng(trip.seed);
  const P = PLACES[trip.place];
  // 看到的寶可夢：那個地方常見屬性的（不是傳說）
  const sights = (dex?.all ?? []).filter(s => !s.legendary && !s.mythical && s.types.some(t => P.types.includes(t)));
  const sight = sights.length ? sights[Math.floor(rng() * sights.length)] : null;
  const fill = s => s.replaceAll('{place}', P.zh).replaceAll('{sight}', sight?.name?.zh ?? '野生寶可夢').replaceAll('{friend}', friendName ?? '').replaceAll('{name}', selfName);
  const lines = [P.diary[Math.floor(rng() * P.diary.length)]];
  if (friendName && rng() < 0.6) lines.push(P.friendDiary);
  const diary = lines.map(fill).join('。');
  // 禮物：1–2 樣
  const gifts = { berries: {}, balls: {}, puffs: [] };
  const n = rng() < 0.4 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const kind = rng.weighted(Object.entries(P.gifts).map(([k, w]) => ({ k, w }))).k;
    if (kind === 'berry') {
      const b = Object.keys(BERRIES)[Math.floor(rng() * 5)];
      gifts.berries[b] = (gifts.berries[b] ?? 0) + 2 + Math.floor(rng() * 3);
    } else if (kind === 'ball') {
      const r = rng();
      const ball = r < 0.15 ? 'ultra' : r < 0.5 ? 'great' : 'poke';
      gifts.balls[ball] = (gifts.balls[ball] ?? 0) + (ball === 'poke' ? 3 : 1);
    } else {
      const flavor = ['sweet', 'mint', 'citrus', 'mocha', 'spice'][Math.floor(rng() * 5)];
      gifts.puffs.push(`${flavor}-${rng() < 0.3 ? 'frosted' : 'basic'}`);
    }
  }
  const egg = rng() < EGG_CHANCE;
  const friend = rng() < FRIEND_CHANCE && sights.length ? sights[Math.floor(rng() * sights.length)].id : null;
  return { place: trip.place, diary, gifts, egg, friend, sight: sight?.id ?? null, postcardSeed: Math.floor(rng() * 2 ** 31) };
}

export function normalizePostcard(p) {
  if (!p || typeof p !== 'object' || !PLACES[p.place] || typeof p.id !== 'string' || !Number.isFinite(p.at)) return null;
  return {
    id: p.id.slice(0, 60),
    place: p.place,
    seed: Number.isFinite(p.seed) ? p.seed >>> 0 : 1,
    at: p.at,
    uid: typeof p.uid === 'string' ? p.uid.slice(0, 40) : '',
    name: typeof p.name === 'string' ? p.name.slice(0, 12) : '',
    diary: typeof p.diary === 'string' ? p.diary.slice(0, 120) : '',
  };
}

// ---------- 同步 ----------
// 旅行：兩邊都有就用出發時間比較晚的；已經在任何一台電腦結算過的就不要了
export function mergeTrip(a, b, done) {
  const pick = !a ? b : !b ? a : (b.departedAt > a.departedAt || (b.departedAt === a.departedAt && b.id > a.id) ? b : a);
  return pick && !done.has(pick.id) ? structuredClone(pick) : null;
}
export function mergePostcards(a = [], b = []) {
  const map = new Map();
  for (const p of [...a, ...b]) if (!map.has(p.id)) map.set(p.id, p);
  return [...map.values()].sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1)).slice(-POSTCARDS_KEPT);
}
export function mergeTripsDone(a = [], b = []) {
  return [...new Set([...a, ...b])].sort().slice(-TRIPS_DONE_KEPT);
}
export { TRIPS_DONE_KEPT };

// 用種子產生的亂數（給 Game 用：撿到的蛋是哪一種也要每次都一樣）
export const seededRng = seed => createRng(seed >>> 0);
