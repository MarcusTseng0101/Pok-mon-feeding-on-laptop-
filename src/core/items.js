// 重要物品：超級手環、超級進化石。拿到就一直有（存成 true／false），不會用掉。
//
// 超級進化：有那隻寶可夢的進化石＋超級手環，對戰時就會超級進化（點牠也可以叫牠超級進化）。
// XY 原作裡卡洛斯的寶可夢只有蒂安希能超級進化；其他的是《傳說 Z-A》（2025）新增的。
// 蒂安希進化石是好感滿了自己拿到的（舊存檔就有），不需要超級手環；其他都要。

export const MEGA = {
  652: { stone: 'chesnaughtite', sprite: 10292 }, // 布里卡隆
  655: { stone: 'delphoxite', sprite: 10293 }, // 妖火紅狐
  658: { stone: 'greninjite', sprite: 10294 }, // 甲賀忍蛙
  668: { stone: 'pyroarite', sprite: 10295 }, // 火炎獅
  678: { stone: 'meowsticite', sprite: 10314 }, // 超能妙喵
  687: { stone: 'malamarite', sprite: 10297 }, // 烏賊王
  689: { stone: 'barbaracite', sprite: 10298 }, // 龜足巨鎧
  691: { stone: 'dragalgite', sprite: 10299 }, // 毒藻龍
  701: { stone: 'hawluchanite', sprite: 10300 }, // 摔角鷹人
  719: { stone: 'diancite', sprite: 10075 }, // 蒂安希
};

export const KEY_ITEMS = {
  megaring: { zh: '超級手環', desc: '嵌著鑰石的手環。和寶可夢心意相通時，能讓進化石發出光芒。' },
  diancite: { zh: '蒂安希進化石', species: 719 },
  chesnaughtite: { zh: '布里卡隆進化石', species: 652 },
  delphoxite: { zh: '妖火紅狐進化石', species: 655 },
  greninjite: { zh: '甲賀忍蛙進化石', species: 658 },
  pyroarite: { zh: '火炎獅進化石', species: 668 },
  meowsticite: { zh: '超能妙喵進化石', species: 678 },
  malamarite: { zh: '烏賊王進化石', species: 687 },
  barbaracite: { zh: '龜足巨鎧進化石', species: 689 },
  dragalgite: { zh: '毒藻龍進化石', species: 691 },
  hawluchanite: { zh: '摔角鷹人進化石', species: 701 },
};
export const ITEM_IDS = Object.keys(KEY_ITEMS);

// 有這種寶可夢的進化石＋（蒂安希以外）超級手環
export function canMegaEvolve(items, speciesId) {
  const m = MEGA[speciesId];
  return Boolean(m && items?.[m.stone] && (m.stone === 'diancite' || items.megaring));
}

// 御三家：[哈力栗一族, 火狐狸一族, 呱呱泡蛙一族] 最後進化的進化石
export const STARTER_STONES = ['chesnaughtite', 'delphoxite', 'greninjite'];
const LINE_OF = id => (id >= 650 && id <= 658 ? Math.floor((id - 650) / 3) : -1);

// 你的御三家是哪一族：最早來的那隻御三家（放生了就看圖鑑裡最早抓到的）；都沒有就當作哈力栗
export function starterLine(state) {
  const mons = state.mons.filter(m => LINE_OF(m.species) >= 0).sort((a, b) => a.caughtAt - b.caughtAt);
  if (mons.length) return LINE_OF(mons[0].species);
  const seen = Object.entries(state.dex ?? {}).filter(([id, d]) => LINE_OF(Number(id)) >= 0 && d.firstCaughtAt)
    .sort((a, b) => a[1].firstCaughtAt - b[1].firstCaughtAt);
  return seen.length ? LINE_OF(Number(seen[0][0])) : 0;
}
