// 形態：同一種寶可夢的不同外觀（花蓓蓓的花色、彩粉蝶的花紋、多麗米亞的造型…）。
// 形態 key 對應 PokeAPI sprites repo 的檔名：sprites/pokemon/<圖鑑號>-<形態>.png。
//
// 兩種形態：
// - 永久形態：存在 mon.form（null 表示預設形態），進化時會繼承。
// - 對戰形態：超級進化、牽絆變身。只影響圖片與演出，不存進存檔。

const FLABEBE = ['red', 'yellow', 'orange', 'blue', 'white']; // 永恆之花（670-eternal）不收
const VIVILLON = [
  'meadow', 'icy-snow', 'polar', 'tundra', 'continental', 'garden', 'elegant', 'modern', 'marine', 'archipelago',
  'high-plains', 'sandstorm', 'river', 'monsoon', 'savanna', 'sun', 'ocean', 'jungle', 'fancy', 'poke-ball',
];
const FURFROU = ['natural', 'heart', 'star', 'diamond', 'debutante', 'matron', 'dandy', 'la-reine', 'kabuki', 'pharaoh'];

// family：同一條進化線共用同一組形態。visible：這個圖鑑號的圖片有沒有分形態
export const FORMS = {
  664: { family: 'vivillon', keys: VIVILLON, visible: false }, // 粉蝶蟲：看不出來，但已經決定好
  665: { family: 'vivillon', keys: VIVILLON, visible: false }, // 粉蝶蛹
  666: { family: 'vivillon', keys: VIVILLON, visible: true },
  669: { family: 'flabebe', keys: FLABEBE, visible: true },
  670: { family: 'flabebe', keys: FLABEBE, visible: true },
  671: { family: 'flabebe', keys: FLABEBE, visible: true },
  676: { family: 'furfrou', keys: FURFROU, visible: true },
};

export const FORM_ZH = {
  red: '紅花', yellow: '黃花', orange: '橙花', blue: '藍花', white: '白花',
  meadow: '花園花紋', 'icy-snow': '冰雪花紋', polar: '雪國花紋', tundra: '雪原花紋', continental: '大陸花紋',
  garden: '庭園花紋', elegant: '高雅花紋', modern: '摩登花紋', marine: '大海花紋', archipelago: '群島花紋',
  'high-plains': '荒野花紋', sandstorm: '沙塵花紋', river: '大河花紋', monsoon: '驟雨花紋', savanna: '熱帶草原花紋',
  sun: '太陽花紋', ocean: '大洋花紋', jungle: '熱帶雨林花紋', fancy: '幻彩花紋', 'poke-ball': '球球花紋',
  natural: '野生的樣子', heart: '心形造型', star: '星形造型', diamond: '菱形造型', debutante: '淑女造型',
  matron: '貴婦造型', dandy: '紳士造型', 'la-reine': '女王造型', kabuki: '歌舞伎造型', pharaoh: '國王造型',
  mega: '超級進化', ash: '牽絆變身',
};

// 對戰形態：圖片是獨立的圖鑑號
export const BATTLE_FORMS = {
  719: { mega: 10075 }, // 超級蒂安希
  658: { ash: 10117 }, // 小智版甲賀忍蛙
};

export const SPRITE_KEY_RE = /^\d{3,5}(-[a-z]+)*$/;
export const isSpriteKey = key => typeof key === 'string' && key.length <= 32 && SPRITE_KEY_RE.test(key);

export const formsOf = speciesId => FORMS[speciesId]?.keys ?? [];
export const defaultForm = speciesId => FORMS[speciesId]?.keys[0] ?? null;
export const isValidForm = (speciesId, form) => form === null || formsOf(speciesId).includes(form);
export const isBattleForm = (speciesId, form) => Boolean(BATTLE_FORMS[speciesId]?.[form]);

// 存檔用的形式：預設形態一律存成 null，不合法的也變成 null
export function canonicalForm(speciesId, form) {
  if (typeof form !== 'string' || !isValidForm(speciesId, form)) return null;
  return form === defaultForm(speciesId) ? null : form;
}

// 圖片 key：'669'、'669-blue'、'10075'
export function spriteKey(speciesId, form = null) {
  const battle = BATTLE_FORMS[speciesId]?.[form];
  if (battle) return String(battle);
  const f = canonicalForm(speciesId, form);
  return f && FORMS[speciesId].visible ? `${speciesId}-${f}` : String(speciesId);
}

// 從圖片 key 拿回圖鑑號（對戰形態的圖片號對回原本的寶可夢）
export function speciesOfKey(key) {
  const n = Number.parseInt(key, 10);
  for (const [species, forms] of Object.entries(BATTLE_FORMS)) if (Object.values(forms).includes(n)) return Number(species);
  return n;
}

// 進化時形態跟著走（藍花的花蓓蓓 → 藍花的花葉蒂）；新的寶可夢沒有這個形態就回到預設
export function inheritForm(fromSpecies, toSpecies, form) {
  if (FORMS[fromSpecies]?.family !== FORMS[toSpecies]?.family) return null;
  return canonicalForm(toSpecies, form);
}

export function formName(speciesId, form) {
  const f = form ?? defaultForm(speciesId);
  return f ? FORM_ZH[f] ?? f : null;
}
