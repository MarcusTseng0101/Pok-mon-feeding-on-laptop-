// 進化：沒有等級，改用「成長」（xp，靠陪伴、撫摸、餵食累積）。
// 原作的進化等級 × 8 就是需要的成長值；道具／通訊進化改成需要足夠的成長和好感（羈絆）。
// 特殊條件保留原作精神：白天／夜晚、要有惡屬性夥伴在桌面上、好啦魷要「倒過來」。

import { hearts } from './amie.js';

const ITEM_XP = 240;
export const XP_PER_LEVEL = 8;

export function requirement(evo) {
  if (evo.trigger === 'level-up' && evo.minLevel) return { xp: evo.minLevel * XP_PER_LEVEL, hearts: 0 };
  if (evo.trigger === 'trade') return { xp: ITEM_XP, hearts: 4 };
  return { xp: ITEM_XP, hearts: 3 }; // use-item 及其他
}

const isDay = hour => hour >= 6 && hour < 18;

// ctx: { hour, outTypes: Set<type>（其他在桌面上的夥伴的屬性）, heldUpsideDown }
// 回傳 { evo, ready, need, blockers: [{ id, zh }] }；沒有可進化的對象回傳 null。
export function checkEvolution(mon, dex, ctx) {
  const evos = dex.get(mon.species)?.evolutions ?? [];
  if (!evos.length) return null;
  const results = evos.map(evo => {
    const need = requirement(evo);
    const blockers = [];
    if (mon.xp < need.xp) blockers.push({ id: 'xp', zh: `還需要更多相處（成長 ${Math.floor(mon.xp)}／${need.xp}）` });
    if (hearts(mon.affection) < need.hearts) blockers.push({ id: 'hearts', zh: `需要更深的羈絆（好感 ♥${need.hearts}）` });
    if (evo.timeOfDay === 'day' && !isDay(ctx.hour)) blockers.push({ id: 'time', zh: '好像在等待白天到來…' });
    if (evo.timeOfDay === 'night' && isDay(ctx.hour)) blockers.push({ id: 'time', zh: '好像在等待夜晚到來…' });
    if (evo.partyType && !ctx.outTypes?.has(evo.partyType)) blockers.push({ id: 'party', zh: `想和${dex.typeName(evo.partyType)}屬性的夥伴一起待在桌面上` });
    if (evo.upsideDown && !ctx.heldUpsideDown) blockers.push({ id: 'upsideDown', zh: '牠好像想倒過來看看世界…（把牠抓起來試試）' });
    return { evo, need, ready: blockers.length === 0, blockers };
  });
  // 有多條路線時（本作範圍內沒有，但保留）優先回傳已就緒的
  return results.find(r => r.ready) ?? results[0];
}

// 只看成長與好感是否達標（不管時段、夥伴、倒立），用來判斷要不要在寶可夢身上顯示提示
export function almostReady(result) {
  return result && result.blockers.every(b => b.id !== 'xp' && b.id !== 'hearts');
}
