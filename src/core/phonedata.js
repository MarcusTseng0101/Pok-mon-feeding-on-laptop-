// 手機頁面看到的摘要：只挑要顯示的欄位，絕不把整份存檔送出去（見 src/main/phone.js）。
// 圖片（夥伴的小圖、明信片）由畫面另外畫好放進 pics／postcards[].img（data URL），這裡只留 key。
import { KINDS as LETTER_KINDS } from './letters.js';
import { PLACES } from './trips.js';
import { MOODS, moodToday } from './mood.js';
import { MILESTONES, daysTogether } from './together.js';
import { holidaysOn, HOLIDAYS } from './calendar.js';
import { hearts } from './amie.js';

export const LETTERS_SHOWN = 20;
export const POSTCARDS_SHOWN = 8;

// nameOf(mon) → 暱稱或種類名；speciesName(id) → 種類名；spriteKeyOf(mon) → 圖片 key
export function phoneSnapshot(state, { now, nameOf, speciesName, spriteKeyOf }) {
  const mood = moodToday(state.mood ?? { log: [] }, now);
  const t = state.together ?? { milestones: [] };
  const mons = state.mons ?? [];
  const home = mons.filter(m => m.out && !(m.trip && now < m.trip.returnAt));
  return {
    at: now,
    daysTogether: Number.isFinite(t.firstMet) ? daysTogether(t, now) : null,
    mood: mood ? { id: mood, zh: MOODS[mood].zh, emoji: MOODS[mood].emoji } : null,
    holidays: holidaysOn(now, { birthday: state.settings?.birthday, firstMet: t.firstMet }).map(id => HOLIDAYS[id].zh),
    milestones: [...(t.milestones ?? [])].reverse().map(m => ({ zh: MILESTONES[m.id]?.zh ?? '', at: m.at })),
    pets: home.map(m => ({ name: nameOf(m), species: speciesName(m.species), hearts: hearts(m.affection), pic: spriteKeyOf(m) })),
    trips: mons.filter(m => m.trip && now < m.trip.returnAt).map(m => ({ name: nameOf(m), place: PLACES[m.trip.place]?.zh ?? '', returnAt: m.trip.returnAt, pic: spriteKeyOf(m) })),
    letters: [...(state.letters?.inbox ?? [])].reverse().slice(0, LETTERS_SHOWN).map(l => ({
      id: l.id, name: l.name, kind: LETTER_KINDS[l.kind]?.zh ?? '', at: l.at, text: l.text, opened: Boolean(l.opened),
    })),
    postcards: [...(state.postcards ?? [])].reverse().slice(0, POSTCARDS_SHOWN).map(p => ({
      id: p.id, place: PLACES[p.place]?.zh ?? '', at: p.at, name: p.name, diary: p.diary,
    })),
    pics: {}, // 畫面填：{ 圖片 key: data URL }
  };
}
