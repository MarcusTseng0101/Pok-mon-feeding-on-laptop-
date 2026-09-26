// 秘密基地：螢幕左下或右下角的一小塊地方。後面是住的地方（帳篷 → 小屋 → 樹屋），前面是院子，
// 院子是格子，可以擺家具。材料（木頭、布、石頭、閃亮石）是旅行帶回來的，放在背包的 materials（同步走 ledger）。
// 寶可夢累了會去床上睡、想休息會去基地坐著、晚上大家回基地擠在一起睡。
// 這裡不用內建亂數，也不碰畫面。

export const MATERIALS = { wood: '木頭', cloth: '布', stone: '石頭', shiny: '閃亮石' };
export const GRID_W = 8; // 院子幾格寬
export const GRID_H = 3; // 幾格深

// 住的地方：升級要花材料；每一階可以擺的家具數量不同（數字是猜的，可以調）
export const STAGES = [
  { id: 'tent', zh: '帳篷', cost: null, maxItems: 3 },
  { id: 'hut', zh: '小屋', cost: { wood: 6, cloth: 4 }, maxItems: 6 },
  { id: 'treehouse', zh: '樹屋', cost: { wood: 12, stone: 6, shiny: 2 }, maxItems: 10 },
];

// 家具：佔幾格（w×h）、要多少材料。獎盃不用材料，但有幾個獎章才能擺幾個
export const FURNITURE = {
  bed: { zh: '床', w: 2, h: 1, cost: { wood: 3, cloth: 2 } },
  table: { zh: '桌子', w: 2, h: 1, cost: { wood: 3 } },
  rug: { zh: '地毯', w: 2, h: 1, cost: { cloth: 3 } },
  lamp: { zh: '燈', w: 1, h: 1, cost: { stone: 2, shiny: 1 } },
  plant: { zh: '盆栽', w: 1, h: 1, cost: { wood: 1, stone: 1 } },
  trophy: { zh: '獎盃', w: 1, h: 1, cost: {} },
};

// 一開始就有：帳篷＋一張小床（不然累了沒地方睡）
export function defaultBase(now = 0) {
  return { side: 'left', stage: 0, items: [{ id: 'bed0', kind: 'bed', x: 0, y: 1, updatedAt: now }], updatedAt: now };
}

export function normalizeBase(raw, now = 0) {
  if (!raw || typeof raw !== 'object') return defaultBase(now);
  const b = {
    side: raw.side === 'right' ? 'right' : 'left',
    stage: Number.isInteger(raw.stage) ? Math.max(0, Math.min(STAGES.length - 1, raw.stage)) : 0,
    items: [],
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
  };
  for (const it of Array.isArray(raw.items) ? raw.items : []) {
    if (!it || !FURNITURE[it.kind] || typeof it.id !== 'string' || !Number.isInteger(it.x) || !Number.isInteger(it.y)) continue;
    const item = { id: it.id.slice(0, 40), kind: it.kind, x: it.x, y: it.y, updatedAt: Number.isFinite(it.updatedAt) ? it.updatedAt : now };
    if (b.items.length < STAGES[b.stage].maxItems && canPlace(b, item.kind, item.x, item.y) && !b.items.some(o => o.id === item.id)) b.items.push(item);
  }
  return b;
}

export const emptyMaterials = () => Object.fromEntries(Object.keys(MATERIALS).map(k => [k, 0]));

// ---------- 格子 ----------
export function cells(kind, x, y) {
  const f = FURNITURE[kind], out = [];
  for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) out.push(`${x + i},${y + j}`);
  return out;
}

// 這裡放得下嗎（在院子裡、不跟其他家具重疊；ignoreId：移動時不算自己）
export function canPlace(base, kind, x, y, ignoreId = null) {
  const f = FURNITURE[kind];
  if (!f || x < 0 || y < 0 || x + f.w > GRID_W || y + f.h > GRID_H) return false;
  const used = new Set(base.items.filter(it => it.id !== ignoreId).flatMap(it => cells(it.kind, it.x, it.y)));
  return cells(kind, x, y).every(c => !used.has(c));
}

// 第一個放得下的位置（從後面往前、從左往右找）
export function firstFree(base, kind) {
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) if (canPlace(base, kind, x, y)) return { x, y };
  return null;
}

// ---------- 材料 ----------
export const enough = (materials, cost) => Object.entries(cost ?? {}).every(([k, n]) => (materials[k] ?? 0) >= n);
const spend = (materials, cost) => { for (const [k, n] of Object.entries(cost ?? {})) materials[k] -= n; };
const refund = (materials, cost) => { for (const [k, n] of Object.entries(cost ?? {})) materials[k] = Math.min(999, (materials[k] ?? 0) + n); };

export const trophiesAllowed = state => Object.keys(state.achievements ?? {}).length;

// 可以擺嗎：回傳 null（可以）或原因
export function placeProblem(state, kind, x, y) {
  const base = state.base;
  if (!FURNITURE[kind]) return 'unknown';
  if (base.items.length >= STAGES[base.stage].maxItems) return 'full';
  if (kind === 'trophy' && base.items.filter(it => it.kind === 'trophy').length >= trophiesAllowed(state)) return 'no-medal';
  if (!enough(state.bag.materials, FURNITURE[kind].cost)) return 'materials';
  if (!canPlace(base, kind, x, y)) return 'blocked';
  return null;
}

export function place(state, kind, x, y, now, id) {
  const problem = placeProblem(state, kind, x, y);
  if (problem) return { ok: false, reason: problem };
  spend(state.bag.materials, FURNITURE[kind].cost);
  const item = { id, kind, x, y, updatedAt: now };
  state.base.items.push(item);
  state.base.updatedAt = now;
  return { ok: true, item };
}

export function move(state, id, x, y, now) {
  const it = state.base.items.find(i => i.id === id);
  if (!it || !canPlace(state.base, it.kind, x, y, id)) return false;
  Object.assign(it, { x, y, updatedAt: now });
  state.base.updatedAt = now;
  return true;
}

// 收起來：材料全部還你（不會因為擺錯位置而虧）
export function remove(state, id, now) {
  const i = state.base.items.findIndex(it => it.id === id);
  if (i < 0) return false;
  refund(state.bag.materials, FURNITURE[state.base.items[i].kind].cost);
  state.base.items.splice(i, 1);
  state.base.updatedAt = now;
  return true;
}

export function upgrade(state, now) {
  const next = STAGES[state.base.stage + 1];
  if (!next) return { ok: false, reason: 'max' };
  if (!enough(state.bag.materials, next.cost)) return { ok: false, reason: 'materials' };
  spend(state.bag.materials, next.cost);
  state.base.stage++;
  state.base.updatedAt = now;
  return { ok: true, stage: next };
}

// ---------- 同步 ----------
// 整個基地用最後修改的時間決定用哪一邊（last-writer-wins；一樣就比內容，兩邊對調結果才一樣）
export function mergeBase(a, b) {
  if (!a || !b) return structuredClone(a ?? b);
  if (a.updatedAt !== b.updatedAt) return structuredClone(a.updatedAt > b.updatedAt ? a : b);
  return structuredClone(JSON.stringify(a) >= JSON.stringify(b) ? a : b);
}

// ---------- 旅行帶回來的材料 ----------
// 每個地方比較容易撿到的材料（旅行的結算用；由旅行的種子決定）
export const PLACE_MATERIALS = {
  'reflection-cave': ['shiny', 'stone'], lumiose: ['cloth', 'stone'], 'fossil-lab': ['stone', 'shiny'],
  'wish-lake': ['shiny', 'cloth'], 'frost-cavern': ['stone', 'cloth'], 'fog-forest': ['wood', 'wood'],
  seaside: ['wood', 'cloth'], 'flower-field': ['cloth', 'wood'], desert: ['stone', 'shiny'],
  tunnel: ['stone', 'wood'], castle: ['cloth', 'shiny'], arena: ['wood', 'stone'],
};
