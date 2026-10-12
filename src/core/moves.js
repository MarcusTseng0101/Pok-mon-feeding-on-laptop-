// 招式資料（名字、屬性、演出種類）和每種寶可夢會用的招式。純資料＋純函式：
// 桌面的演出（renderer/scene/moves.js）和手機遊戲（src/journey）共用。kind／big／heavy 這些欄位的意思見 renderer/scene/moves.js 開頭。
import { hearts } from './amie.js';

export const MOVES = {
  tackle: { zh: '撞擊', type: 'normal', kind: 'contact' },
  hypervoice: { zh: '巨聲', type: 'normal', kind: 'area' },
  boomburst: { zh: '爆音波', type: 'normal', kind: 'area', big: true },
  sweetscent: { zh: '甜甜香氣', type: 'normal', kind: 'area', soft: true },
  ember: { zh: '火花', type: 'fire', kind: 'projectile' },
  flamethrower: { zh: '噴射火焰', type: 'fire', kind: 'beam' },
  mysticalfire: { zh: '魔法火焰', type: 'fire', kind: 'projectile', big: true },
  watergun: { zh: '水槍', type: 'water', kind: 'beam' },
  bubble: { zh: '泡沫', type: 'water', kind: 'projectile' },
  waterpulse: { zh: '水之波動', type: 'water', kind: 'projectile', big: true },
  watershuriken: { zh: '飛水手裏劍', type: 'water', kind: 'projectile' },
  steameruption: { zh: '蒸汽爆炸', type: 'water', kind: 'area', big: true },
  vinewhip: { zh: '藤鞭', type: 'grass', kind: 'line' },
  razorleaf: { zh: '飛葉快刀', type: 'grass', kind: 'projectile' },
  petalblizzard: { zh: '落英繽紛', type: 'grass', kind: 'area' },
  hornleech: { zh: '木角', type: 'grass', kind: 'contact' },
  cottonspore: { zh: '棉花孢子', type: 'grass', kind: 'area', soft: true },
  spikyshield: { zh: '尖刺防守', type: 'grass', kind: 'self' },
  thundershock: { zh: '電擊', type: 'electric', kind: 'beam' },
  paraboliccharge: { zh: '拋物面充電', type: 'electric', kind: 'area' },
  nuzzle: { zh: '蹭蹭臉頰', type: 'electric', kind: 'contact' },
  aurorabeam: { zh: '極光束', type: 'ice', kind: 'beam' },
  iceshard: { zh: '冰礫', type: 'ice', kind: 'projectile' },
  avalanche: { zh: '雪崩', type: 'ice', kind: 'rain' },
  freezedry: { zh: '冷凍乾燥', type: 'ice', kind: 'area' },
  armthrust: { zh: '猛推', type: 'fighting', kind: 'contact' },
  aurasphere: { zh: '波導彈', type: 'fighting', kind: 'projectile', big: true },
  flyingpress: { zh: '飛身重壓', type: 'fighting', kind: 'contact', jump: true },
  acid: { zh: '溶解液', type: 'poison', kind: 'projectile' },
  sludgebomb: { zh: '污泥炸彈', type: 'poison', kind: 'projectile', big: true },
  mudshot: { zh: '泥巴射擊', type: 'ground', kind: 'projectile' },
  bulldoze: { zh: '重踏', type: 'ground', kind: 'area' },
  thousandarrows: { zh: '千箭齊發', type: 'ground', kind: 'rain' },
  peck: { zh: '啄', type: 'flying', kind: 'contact' },
  airslash: { zh: '空氣斬', type: 'flying', kind: 'projectile' },
  bravebird: { zh: '勇鳥猛攻', type: 'flying', kind: 'contact', trail: true },
  hurricane: { zh: '暴風', type: 'flying', kind: 'area' },
  oblivionwing: { zh: '死亡之翼', type: 'flying', kind: 'beam' },
  confusion: { zh: '念力', type: 'psychic', kind: 'projectile', big: true },
  psychic: { zh: '精神強念', type: 'psychic', kind: 'portal' },
  reflect: { zh: '反射壁', type: 'psychic', kind: 'self' },
  hyperspacehole: { zh: '異次元洞', type: 'psychic', kind: 'portal' },
  stringshot: { zh: '吐絲', type: 'bug', kind: 'line' },
  quiverdance: { zh: '蝶舞', type: 'bug', kind: 'self' },
  powergem: { zh: '力量寶石', type: 'rock', kind: 'projectile' },
  headsmash: { zh: '雙刃頭錘', type: 'rock', kind: 'contact', heavy: true },
  diamondstorm: { zh: '鑽石風暴', type: 'rock', kind: 'area' },
  shadowball: { zh: '暗影球', type: 'ghost', kind: 'projectile', big: true },
  shadowsneak: { zh: '影子偷襲', type: 'ghost', kind: 'contact' },
  trickortreat: { zh: '萬聖夜', type: 'ghost', kind: 'portal' },
  kingsshield: { zh: '王者盾牌', type: 'steel', kind: 'self' },
  flashcannon: { zh: '加農光炮', type: 'steel', kind: 'beam' },
  fairylock: { zh: '妖精之鎖', type: 'fairy', kind: 'self' },
  dragonpulse: { zh: '龍之波動', type: 'dragon', kind: 'beam' },
  dracometeor: { zh: '流星群', type: 'dragon', kind: 'meteor', big: true }, // 龍屬性、而且好感滿了才會（跟原作一樣要很親近）
  bite: { zh: '咬住', type: 'dark', kind: 'contact' },
  nightslash: { zh: '暗襲要害', type: 'dark', kind: 'contact' },
  topsyturvy: { zh: '顛倒', type: 'dark', kind: 'portal' },
  moonblast: { zh: '月亮之力', type: 'fairy', kind: 'projectile', big: true },
  fairywind: { zh: '妖精之風', type: 'fairy', kind: 'area' },
  disarmingvoice: { zh: '魅惑之聲', type: 'fairy', kind: 'area' },
  geomancy: { zh: '大地掌控', type: 'fairy', kind: 'self' },
};

// 各屬性的基本招式（沒有專屬招式時用這個補）
export const TYPE_MOVE = {
  normal: 'tackle', fire: 'ember', water: 'watergun', grass: 'razorleaf', electric: 'thundershock', ice: 'iceshard',
  fighting: 'armthrust', poison: 'acid', ground: 'mudshot', flying: 'airslash', psychic: 'confusion', bug: 'stringshot',
  rock: 'powergem', ghost: 'shadowball', dragon: 'dragonpulse', dark: 'bite', steel: 'flashcannon', fairy: 'fairywind',
};

// 各種寶可夢的代表招式（參考原作 X・Y 會學的招式）
export const SIGNATURE = {
  650: ['vinewhip'], 651: ['vinewhip', 'hornleech'], 652: ['spikyshield', 'hornleech'],
  653: ['ember'], 654: ['flamethrower', 'ember'], 655: ['mysticalfire', 'psychic'],
  656: ['bubble'], 657: ['waterpulse', 'bubble'], 658: ['watershuriken', 'nightslash'],
  659: ['mudshot'], 660: ['bulldoze', 'mudshot'],
  661: ['peck'], 662: ['ember', 'peck'], 663: ['bravebird', 'flamethrower'],
  664: ['stringshot'], 665: ['stringshot'], 666: ['quiverdance', 'hurricane'],
  667: ['ember'], 668: ['hypervoice', 'flamethrower'],
  669: ['fairywind'], 670: ['fairywind', 'petalblizzard'], 671: ['petalblizzard', 'moonblast'],
  672: ['razorleaf', 'vinewhip'], 673: ['hornleech', 'razorleaf'],
  674: ['armthrust'], 675: ['nightslash', 'armthrust'],
  676: ['tackle', 'bite'],
  677: ['confusion'], 678: ['psychic', 'reflect'],
  679: ['shadowsneak'], 680: ['shadowsneak', 'flashcannon'], 681: ['kingsshield', 'shadowball'],
  682: ['sweetscent', 'fairywind'], 683: ['disarmingvoice', 'moonblast'],
  684: ['cottonspore', 'fairywind'], 685: ['sweetscent', 'cottonspore'],
  686: ['topsyturvy'], 687: ['topsyturvy', 'psychic'],
  688: ['tackle', 'waterpulse'], 689: ['armthrust', 'waterpulse'],
  690: ['acid', 'bubble'], 691: ['sludgebomb', 'dragonpulse'],
  692: ['watergun', 'waterpulse'], 693: ['aurasphere', 'waterpulse'],
  694: ['thundershock'], 695: ['paraboliccharge', 'thundershock'],
  696: ['bite'], 697: ['headsmash', 'bite'],
  698: ['aurorabeam'], 699: ['freezedry', 'aurorabeam'],
  700: ['disarmingvoice', 'moonblast'],
  701: ['flyingpress', 'airslash'],
  702: ['nuzzle', 'thundershock'],
  703: ['reflect', 'powergem'],
  704: ['bubble', 'tackle'], 705: ['acid', 'dragonpulse'], 706: ['dragonpulse', 'sludgebomb'],
  707: ['fairylock', 'flashcannon'],
  708: ['shadowsneak', 'razorleaf'], 709: ['shadowball', 'hornleech'],
  710: ['trickortreat', 'shadowball'], 711: ['trickortreat', 'shadowball'],
  712: ['iceshard'], 713: ['avalanche', 'iceshard'],
  714: ['airslash', 'hypervoice'], 715: ['boomburst', 'dragonpulse'],
  716: ['geomancy', 'moonblast'], 717: ['oblivionwing', 'shadowball'], 718: ['thousandarrows', 'dragonpulse'],
  719: ['diamondstorm', 'moonblast'], 720: ['hyperspacehole', 'psychic'], 721: ['steameruption', 'flamethrower'],
};

// 最多 4 個：（龍屬性而且好感滿了：流星群）→ 代表招式 → 各屬性的基本招式 → 撞擊
export function movesetFor(dex, speciesId, mon = null) {
  const types = dex.get(speciesId).types;
  const draco = mon && types.includes('dragon') && hearts(mon.affection) >= 5 ? ['dracometeor'] : [];
  const list = [...draco, ...(SIGNATURE[speciesId] ?? []), ...types.map(t => TYPE_MOVE[t]), 'tackle'];
  return [...new Set(list)].filter(id => MOVES[id]).slice(0, 4);
}

// 故事裡的對戰用：代表招式前 3 個＋撞擊（屬性都被克制的時候，至少有一招打得到）
export function battleMovesFor(dex, speciesId, mon = null) {
  const list = movesetFor(dex, speciesId, mon);
  return list.includes('tackle') ? list : [...list.slice(0, 3), 'tackle'];
}
