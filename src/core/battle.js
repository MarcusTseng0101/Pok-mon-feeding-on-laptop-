// 故事裡的對戰（道館、四天王、冠軍、閃焰隊）：你的夥伴 vs 對手的寶可夢。
// 這裡只有數字（純函式，rng 由外面給），演出在 renderer/scene/battle.js。
//
// 規則刻意簡單：每隻 100 HP、輪流出招、你先攻；傷害看屬性相剋、本系加成、好感和超級特訓。
// 好感的效果照原作「寶可夢親善」：容易擊中要害、會躲開攻擊、快倒下時為了你撐住一次。
import { effectiveness } from './types.js';

export const HP = 100;
const BASE = 24; // 一般招式、雙方平手時一下打掉多少（約 4～5 下倒一隻）

// 變化招式：不造成傷害。guard＝下一次受到的傷害變少；boost＝下一次攻擊變強；lower＝對手下一次攻擊變弱
export const STATUS_MOVES = {
  reflect: 'guard', kingsshield: 'guard', spikyshield: 'guard', fairylock: 'guard',
  quiverdance: 'boost', geomancy: 'boost',
  stringshot: 'lower', sweetscent: 'lower', cottonspore: 'lower', trickortreat: 'lower', topsyturvy: 'lower',
};
export const STATUS_ZH = { guard: '防守姿態', boost: '力量提升了', lower: '對手的力量下降了' };

// 進化到哪裡：還沒進化的弱一點，最後進化和傳說的強一點（沒有等級，用這個代替）
export function gradeOf(dex, id) {
  const s = dex.get(id);
  if (s.legendary || s.mythical) return 1.3;
  const final = !s.evolutions?.length;
  const stage = dex.stage(id);
  if (final) return stage >= 3 ? 1.1 : stage === 2 ? 1.05 : 1;
  return stage >= 2 ? 0.92 : 0.8;
}

// 輸掉以後再挑戰：對手每次弱一點（最多弱到一半），屬性很不利也不會永遠卡關
export const retryPower = (power, losses = 0) => power * Math.max(0.5, Math.pow(0.85, losses));

// 一隻參戰的寶可夢。side：'you'／'foe'；hearts：好感（0–5，只有你的有）；training：超級特訓總和（0–510）
// grade：進化階段（gradeOf）；power：對手的強度（道館 0.75 → 冠軍 1.3）；mega：有超級進化
export function fighter({ uid = null, species, types, side, hearts = 0, training = 0, grade = 1, power = 1, mega = false }) {
  const you = side === 'you';
  const atk = grade * (you ? 1 + 0.06 * hearts + 0.25 * (training / 510) : power) * (mega ? 1.25 : 1);
  const bulk = grade * (you ? 1 + 0.04 * hearts + 0.2 * (training / 510) : power) * (mega ? 1.15 : 1);
  return { uid, species, types, side, hearts, atk, bulk, mega, hp: HP, max: HP, guard: false, boost: false, weak: false, endured: false };
}

// 超級進化（對戰中途才變的時候用）
export function megaEvolve(f) {
  if (f.mega) return;
  f.mega = true;
  f.atk *= 1.25;
  f.bulk *= 1.15;
}

// 出一招。move：{ id, type, big }；回傳發生了什麼（畫面照著演），並直接改 att／def 的狀態
export function attack(att, def, move, rng) {
  const status = STATUS_MOVES[move.id];
  if (status) {
    if (status === 'guard') att.guard = true;
    else if (status === 'boost') att.boost = true;
    else def.weak = true;
    return { kind: 'status', effect: status, dmg: 0, eff: 1 };
  }
  const eff = effectiveness(move.type, def.types);
  // 你的夥伴很喜歡你：有時會躲開（好感 5 顆心 10%）
  if (def.side === 'you' && eff > 0 && rng() < 0.02 * def.hearts) return { kind: 'dodge', dmg: 0, eff };
  const crit = eff > 0 && rng() < 0.0625 + (att.side === 'you' ? 0.02 * att.hearts : 0);
  const stab = att.types.includes(move.type) ? 1.2 : 1;
  // 4 倍剋制算成 2.5 倍：只帶一隻夥伴時，不會因為一個屬性就完全打不贏
  let dmg = BASE * (att.atk / def.bulk) * Math.min(2.5, eff) * stab * (move.big ? 1.25 : 1) * (0.85 + rng() * 0.15);
  if (crit) dmg *= 1.5;
  if (att.boost) dmg *= 1.6;
  if (att.weak) dmg *= 0.7;
  if (def.guard) dmg *= 0.4;
  att.boost = false;
  att.weak = false;
  def.guard = false;
  dmg = eff > 0 ? Math.max(1, Math.round(dmg)) : 0;
  let endure = false;
  // 快倒下了：好感 4 顆心以上，有機會為了你撐住（一場一次）
  if (def.side === 'you' && dmg >= def.hp && def.hp > 1 && !def.endured && def.hearts >= 4 && rng() < 0.25 * (def.hearts - 3)) {
    dmg = def.hp - 1;
    def.endured = endure = true;
  }
  def.hp = Math.max(0, def.hp - dmg);
  return { kind: 'hit', dmg, eff, crit, endure, fainted: def.hp <= 0 };
}

// 對手選招：大多選最有效的攻擊招式，偶爾用變化招式或隨便選
export function pickFoeMove(att, def, moves, rng) {
  const score = m => (STATUS_MOVES[m.id] ? 0.6 : effectiveness(m.type, def.types) * (att.types.includes(m.type) ? 1.2 : 1) * (m.big ? 1.25 : 1));
  if (rng() < 0.25) return moves[Math.floor(rng() * moves.length)];
  return [...moves].sort((a, b) => score(b) - score(a))[0];
}

// 你這邊選招的提示：對這隻對手的效果（畫面上的招式按鈕用）
export function moveHint(move, def) {
  if (STATUS_MOVES[move.id]) return { zh: '變化', cls: 'status' };
  const e = effectiveness(move.type, def.types);
  return e === 0 ? { zh: '沒有效果', cls: 'none' } : e > 1 ? { zh: '效果絕佳', cls: 'super' } : e < 1 ? { zh: '效果不好', cls: 'weak' } : { zh: '', cls: '' };
}
