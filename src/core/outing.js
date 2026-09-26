// 帶一隻出門：你離開電腦時帶著牠（在桌面上把牠拖到螢幕邊緣，或在夥伴頁按「帶牠出門」），
// 回來時在電腦上點牠留下的紙條，牠跑回來、給你一張「今天跟你出門」的明信片。
// 純邏輯：時間由呼叫的人給，沒有亂數、不碰畫面。
//
// 跟旅行（core/trips.js）是兩種不同的狀態：
//   mon.trip   ＝牠自己去某個地方，隨機回家時間，會帶禮物回來
//   mon.outing ＝{ since }，跟你一起出門，只有你（在電腦上）帶牠回家；兩者互斥
// 不知道你在哪：天氣只有設定的城市，所以文字寫「家裡那邊」。
import { OUTING_PLACE } from './trips.js';
import { WEATHER_ZH } from './weather.js';

const MIN = 60_000;
export const POSTCARD_AFTER = 20 * MIN; // 出門多久才給明信片（猜的，可調整）
export const AUTO_BACK = 12 * 60 * MIN; // 忘了帶牠回來：幾小時後自己回家（猜的，可調整）
export const PET_AFFECTION = 0.5; // 回家時加的好感：跟摸一次一樣（amie.js 的 STROKE_AFFECTION）
export const FORGOT_LINE = '你忘記帶我回來了嗎？';

// ---------- 狀態 ----------
// mon.outing = { since }（null＝在家）；mon.outingDone＝最後一次回家的那趟 since（同步時才不會又跑出去）
export function normalizeOuting(o) {
  return o && typeof o === 'object' && Number.isFinite(o.since) ? { since: o.since } : null;
}

export const isOut = mon => Boolean(mon?.outing);
export const outingMon = state => (state.mons ?? []).find(m => m.outing) ?? null;

// 可以帶牠出門嗎：在桌面上、沒有在旅行、現在沒有別隻跟你出門（一次只帶一隻）
export function canGoOut(state, uid) {
  const mon = (state.mons ?? []).find(m => m.uid === uid);
  return Boolean(mon && mon.out && !mon.trip && !mon.outing && !outingMon(state));
}

export function goOut(state, uid, now) {
  if (!canGoOut(state, uid)) return null;
  const mon = state.mons.find(m => m.uid === uid);
  mon.outing = { since: now };
  return mon.outing;
}

// 出門多久（分鐘）；時鐘被調回去就當 0
export const minutesOut = (mon, now) => (mon?.outing ? Math.max(0, Math.floor((now - mon.outing.since) / MIN)) : 0);

export function durationZh(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h} 小時${m ? ` ${m} 分鐘` : ''}` : `${m} 分鐘`;
}
const hhmm = t => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

// 回家：{ minutes, postcard（null＝不給）, auto, affection }。postcard 由 Game 補上 uid／name 後放進相簿
//   auto＝忘了帶回來、自己回家（不給明信片）
export function comeBack(state, uid, now, { weather = null, auto = false } = {}) {
  const mon = (state.mons ?? []).find(m => m.uid === uid);
  if (!mon?.outing) return null;
  const since = mon.outing.since, minutes = minutesOut(mon, now);
  mon.outing = null;
  mon.outingDone = Math.max(mon.outingDone ?? 0, since);
  const earned = !auto && now - since >= POSTCARD_AFTER;
  const postcard = earned ? {
    id: `out-${mon.uid}-${since.toString(36)}`.slice(0, 60),
    place: OUTING_PLACE,
    seed: (since / MIN) >>> 0,
    at: now,
    diary: diaryLine({ minutes, at: now, weather }),
  } : null;
  return { minutes, postcard, auto, affection: earned ? PET_AFFECTION : 0 };
}

// 忘了帶回來：超過 AUTO_BACK 的那隻（最多一隻）
export function overdue(state, now) {
  const mon = outingMon(state);
  return mon && now - mon.outing.since >= AUTO_BACK ? mon : null;
}

// 明信片上的日記：出門多久、幾點回來、那時家裡那邊的天氣
export function diaryLine({ minutes, at, weather }) {
  const w = WEATHER_ZH[weather];
  return `跟你出門 ${durationZh(minutes)}，${hhmm(at)} 回到家。${w ? `那時家裡那邊${w === '晴天' || w === '多雲' || w === '晴朗的夜晚' ? `是${w}` : w}。` : ''}`.slice(0, 120);
}

// 手機頁面上的一句話：依出門多久、現在幾點、家裡那邊的天氣組出來（固定的，不用亂數）
export function outingLine({ minutes, now, weather }) {
  const h = new Date(now).getHours();
  const time = h < 5 ? '好晚了，' : h < 11 ? '早安，' : h < 14 ? '中午了，' : h < 18 ? '' : '天黑了，';
  const long = minutes < 20 ? '剛出門，好期待' : minutes < 120 ? '跟你在一起真好' : '走了好久，有點累了';
  const home = weather === 'rain' || weather === 'thunder' ? '家裡那邊下雨了，還好跟你出來' : weather === 'snow' ? '家裡那邊在下雪' : '';
  return `${time}${long}${home ? `。${home}` : ''}`;
}

// ---------- 手機 ----------
// 手機頁面是唯讀的（src/main/phone.js）：這裡先留著，還沒有實作
export function phoneAction(state, action) { /* 之後：從手機摸摸牠，需要另外的安全設計 */ return null; } // eslint-disable-line no-unused-vars

// ---------- 同步 ----------
// since 比較新的那邊贏；已經在任何一台電腦回家的那趟（since <= outingDone）就不要了
export function mergeOuting(a, b) {
  const done = Math.max(a?.outingDone ?? 0, b?.outingDone ?? 0);
  const x = a?.outing, y = b?.outing;
  const pick = !x ? y : !y ? x : y.since > x.since ? y : x;
  return { outing: pick && pick.since > done ? { since: pick.since } : null, outingDone: done || null };
}
