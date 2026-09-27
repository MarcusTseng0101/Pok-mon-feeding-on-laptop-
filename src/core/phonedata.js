// 手機頁面看到的摘要：只挑要顯示的欄位，絕不把整份存檔送出去（見 src/main/phone.js）。
// 圖片（夥伴的小圖、明信片）由畫面另外畫好放進 pics／postcards[].img（data URL），這裡只留 key。
import { KINDS as LETTER_KINDS } from './letters.js';
import { PLACES, placeZh } from './trips.js';
import { outingMon, minutesOut, outingLine } from './outing.js';
import { MOODS, moodToday } from './mood.js';
import { MILESTONES, daysTogether } from './together.js';
import { holidaysOn, HOLIDAYS } from './calendar.js';
import { hearts } from './amie.js';
import { timeline, lifeCtx, ACT_ZH, CODE } from './life.js';
import { spans } from './checkin.js';

export const LETTERS_SHOWN = 20;
const LIFE_ZH = Object.fromEntries(Object.entries(CODE).map(([act, c]) => [c, ACT_ZH[act]])); // 字 → 「在喝水」
export const LIFE_SLOTS = 144; // 手機上牠們的生活表：往後 24 小時（斷線了也照樣過）
export const POSTCARDS_SHOWN = 8;

// nameOf(mon) → 暱稱或種類名；speciesName(id) → 種類名；spriteKeyOf(mon) → 圖片 key；weather＝設定的城市（家裡那邊）現在的天氣
export function phoneSnapshot(state, { now, nameOf, speciesName, spriteKeyOf, weather = null }) {
  const mood = moodToday(state.mood ?? { log: [] }, now);
  const t = state.together ?? { milestones: [] };
  const mons = state.mons ?? [];
  const home = mons.filter(m => m.out && !m.outing && !(m.trip && now < m.trip.returnAt));
  const out = outingMon(state);
  const ctx = lifeCtx(state.routine, now, spans(state.symbiosis?.checkins ?? {})); // 跟你一起做的事也在生活表裡
  return {
    at: now,
    // 跟你出門的那隻（手機頁面最上面）：出門多久、一句話。沒有出門就沒有這個欄位
    ...(out ? { outing: { name: nameOf(out), since: out.outing.since, minutes: minutesOut(out, now), line: outingLine({ minutes: minutesOut(out, now), now, weather }), pic: spriteKeyOf(out) } } : {}),
    daysTogether: Number.isFinite(t.firstMet) ? daysTogether(t, now) : null,
    mood: mood ? { id: mood, zh: MOODS[mood].zh, emoji: MOODS[mood].emoji } : null,
    holidays: holidaysOn(now, { birthday: state.settings?.birthday, firstMet: t.firstMet }).map(id => HOLIDAYS[id].zh),
    milestones: [...(t.milestones ?? [])].reverse().map(m => ({ zh: MILESTONES[m.id]?.zh ?? '', at: m.at })),
    // 在家的夥伴：life＝往後 24 小時每 10 分鐘在做什麼（core/life.js，一格一個字），手機照時間查表，跟電腦算的一樣
    pets: home.map(m => ({ name: nameOf(m), species: speciesName(m.species), hearts: hearts(m.affection), pic: spriteKeyOf(m), life: { ...timeline(m, now, LIFE_SLOTS, ctx), zh: LIFE_ZH } })),
    trips: mons.filter(m => m.trip && now < m.trip.returnAt).map(m => ({ name: nameOf(m), place: PLACES[m.trip.place]?.zh ?? '', returnAt: m.trip.returnAt, pic: spriteKeyOf(m) })),
    letters: [...(state.letters?.inbox ?? [])].reverse().slice(0, LETTERS_SHOWN).map(l => ({
      id: l.id, name: l.name, kind: LETTER_KINDS[l.kind]?.zh ?? '', at: l.at, text: l.text, opened: Boolean(l.opened),
    })),
    postcards: [...(state.postcards ?? [])].reverse().slice(0, POSTCARDS_SHOWN).map(p => ({
      id: p.id, place: placeZh(p.place), at: p.at, name: p.name, diary: p.diary,
    })),
    pics: {}, // 畫面填：{ 圖片 key: data URL }
  };
}
