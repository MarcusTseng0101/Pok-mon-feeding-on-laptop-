// 獎章（成就）。每一個都是 { id, name, desc, check(state) }，check 是純函式：只看存檔。
// 解鎖的時間記在 state.achievements[id]。
// 獎勵：收集 20 個 → 下一隻粉蝶蟲是幻彩花紋；全部收集 → 球球花紋（原作是配信限定的兩種花紋）。
import { FORMS, defaultForm } from './forms.js';

const caught = s => Object.values(s.dex).filter(d => d.caught > 0).length;
const has = (s, id) => (s.dex[id]?.caught ?? 0) > 0;
const shinySpecies = s => Object.values(s.dex).filter(d => d.shiny > 0).length;
const maxAffection = s => Math.max(0, ...s.mons.map(m => m.affection));
const maxBond = s => Math.max(0, ...Object.values(s.bonds));
const formsCaught = (s, id) => Object.values(s.dex[id]?.forms ?? {}).filter(f => f.caught > 0).length;
const trainingTotal = m => Object.values(m.training ?? {}).reduce((a, b) => a + b, 0);

export const ACHIEVEMENTS = [
  // 圖鑑
  { id: 'dex-1', name: '第一個夥伴', desc: '收服第一隻寶可夢', check: s => caught(s) >= 1 },
  { id: 'dex-10', name: '卡洛斯見習生', desc: '圖鑑收服 10 種', check: s => caught(s) >= 10 },
  { id: 'dex-30', name: '卡洛斯訓練家', desc: '圖鑑收服 30 種', check: s => caught(s) >= 30 },
  { id: 'dex-50', name: '卡洛斯研究員', desc: '圖鑑收服 50 種', check: s => caught(s) >= 50 },
  { id: 'dex-72', name: '卡洛斯圖鑑完成', desc: '72 種全部收服', check: s => caught(s) >= 72 },
  // 色違與連鎖
  { id: 'shiny-1', name: '閃閃發光', desc: '收服第一隻色違寶可夢', check: s => shinySpecies(s) >= 1 },
  { id: 'shiny-5', name: '色違收藏家', desc: '收服 5 種色違寶可夢', check: s => shinySpecies(s) >= 5 },
  { id: 'charm', name: '閃耀護符', desc: '拿到閃耀護符', check: s => s.shinyCharm },
  { id: 'chain-10', name: '連鎖高手', desc: '同一種寶可夢連鎖 10 次', check: s => (s.chain?.count ?? 0) >= 10 },
  // 交流
  { id: 'hearts-5', name: '心心相印', desc: '有一隻夥伴的好感滿了', check: s => maxAffection(s) >= 255 },
  { id: 'best-friends', name: '最好的朋友', desc: '有兩隻夥伴變成最好的朋友', check: s => maxBond(s) >= 200 },
  { id: 'fed-100', name: '泡芙師傅的客人', desc: '餵了 100 個泡芙', check: s => (s.stats.puffsFed ?? 0) >= 100 },
  { id: 'evolve-1', name: '進化的光芒', desc: '讓夥伴第一次進化', check: s => (s.stats.evolutions ?? 0) >= 1 },
  { id: 'evolve-10', name: '見證成長', desc: '讓夥伴進化 10 次', check: s => (s.stats.evolutions ?? 0) >= 10 },
  // 小遊戲
  { id: 'berries-50', name: '摘樹果能手', desc: '總共摘了 50 顆樹果', check: s => (s.stats.berriesPicked ?? 0) >= 50 },
  { id: 'baker', name: '泡芙師傅', desc: '做了 10 個泡芙', check: s => (s.stats.puffsBaked ?? 0) >= 10 },
  { id: 'training-max', name: '超級特訓大師', desc: '有一隻夥伴練到 510', check: s => s.mons.some(m => trainingTotal(m) >= 510) },
  // 跟電腦一起
  { id: 'focus-1', name: '專心的一刻', desc: '完成一次專注', check: s => (s.focus?.sessions ?? 0) >= 1 },
  { id: 'focus-streak-7', name: '一週的習慣', desc: '連續 7 天完成專注', check: s => (s.focus?.streakDays ?? 0) >= 7 },
  { id: 'egg-1', name: '新生命', desc: '孵出第一顆蛋', check: s => (s.stats.eggsHatched ?? 0) >= 1 },
  { id: 'egg-5', name: '育寶屋的常客', desc: '孵出 5 顆蛋', check: s => (s.stats.eggsHatched ?? 0) >= 5 },
  { id: 'perch-10', name: '視窗上的風景', desc: '夥伴站上視窗 10 次', check: s => (s.stats.perches ?? 0) >= 10 },
  // 旅行
  { id: 'trip-1', name: '第一次出遠門', desc: '夥伴第一次旅行回來', check: s => (s.stats.trips ?? 0) >= 1 },
  { id: 'trip-places-6', name: '卡洛斯漫遊', desc: '明信片收集了 6 個地方', check: s => Object.keys(s.placesVisited ?? {}).length >= 6 },
  { id: 'trip-places-12', name: '走遍卡洛斯', desc: '12 個地方的明信片全部收集', check: s => Object.keys(s.placesVisited ?? {}).length >= 12 },
  // 卡洛斯的形態
  { id: 'flabebe-5', name: '五色花園', desc: '收服 5 種花色的花蓓蓓一族', check: s => [669, 670, 671].some(id => formsCaught(s, id) >= 5) },
  { id: 'furfrou-9', name: '美容大師', desc: '多麗米亞的 9 種造型都剪過', check: s => formsCaught(s, 676) - (s.dex[676]?.forms?.[defaultForm(676)]?.caught ? 1 : 0) >= FORMS[676].keys.length - 1 },
  { id: 'mega', name: '超級進化', desc: '拿到蒂安希進化石', check: s => Boolean(s.bag?.items?.diancite) },
  // 傳說
  { id: 'legend-trio', name: '卡洛斯的傳說', desc: '收服哲爾尼亞斯、伊裴爾塔爾、基格爾德', check: s => [716, 717, 718].every(id => has(s, id)) },
];

export const REWARD_FANCY_AT = 20;

// 新解鎖的獎章 id（還沒記錄的、而且條件成立的）
export function newlyUnlocked(state) {
  return ACHIEVEMENTS.filter(a => !state.achievements[a.id] && a.check(state)).map(a => a.id);
}

// 解鎖數量到了該給的彩粉蝶花紋獎勵（每個只給一次）
export function pendingRewards(state) {
  const n = Object.keys(state.achievements).filter(id => ACHIEVEMENTS.some(a => a.id === id)).length;
  const got = state.achievementRewards;
  const out = [];
  if (n >= REWARD_FANCY_AT && !got.fancy) out.push('fancy');
  if (n >= ACHIEVEMENTS.length && !got.pokeBall) out.push('poke-ball');
  return out;
}
