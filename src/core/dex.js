// 圖鑑資料的查詢介面。data 來自 data/kalos.json（由 scripts/build-dex.mjs 產生）。

// 在桌面上飄浮／飛行的寶可夢。飛行屬性預設會飛，這裡補上非飛行但會飄的、並排除用走的。
const FLOAT_EXTRA = new Set([669, 670, 671, 679, 680, 681, 682, 686, 703, 707, 708, 719, 720]);
const WALKS_ANYWAY = new Set([661, 701]); // 小箭雀在地上跳、摔角鷹人用走的

// 出沒地點：物種會從哪一種「氣息點」冒出來
export const SPOTS = {
  grass: { zh: '沙沙作響的草叢' },
  puddle: { zh: '泛起漣漪的水窪' },
  sky: { zh: '掠過天空的影子' },
  rock: { zh: '閃閃發亮的石頭' },
  dusk: { zh: '搖曳的鬼火' },
  ring: { zh: '神秘的圓環' },
};

const HABITAT_OVERRIDE = { 704: 'puddle', 705: 'puddle', 706: 'puddle', 712: 'rock', 713: 'rock', 720: 'ring' };

export function createDex(data) {
  const byId = new Map(data.species.map(s => [s.id, s]));
  const natureBySlug = new Map(data.natures.map(n => [n.slug, n]));

  const stage = id => {
    let n = 1, s = byId.get(id);
    while (s?.evolvesFrom && byId.has(s.evolvesFrom)) { n++; s = byId.get(s.evolvesFrom); }
    return n;
  };

  const habitat = id => {
    if (HABITAT_OVERRIDE[id]) return HABITAT_OVERRIDE[id];
    const t = byId.get(id).types;
    if (t.includes('flying') && !WALKS_ANYWAY.has(id)) return 'sky';
    if (t.some(x => x === 'ghost' || x === 'dark' || x === 'psychic')) return 'dusk';
    if (t.includes('water') || t.includes('poison')) return 'puddle';
    if (t.some(x => x === 'rock' || x === 'steel' || x === 'ground')) return 'rock';
    return 'grass';
  };

  return {
    data,
    all: data.species,
    ids: data.species.map(s => s.id),
    get: id => byId.get(id),
    has: id => byId.has(id),
    stage,
    habitat,
    floats: id => FLOAT_EXTRA.has(id) || (byId.get(id).types.includes('flying') && !WALKS_ANYWAY.has(id)),
    typeName: t => data.typeNames[t] ?? t,
    nature: slug => natureBySlug.get(slug),
    natures: data.natures,
    name: id => byId.get(id)?.name.zh ?? `#${id}`,
  };
}
