// 色違：基本機率 1/512（桌面上遭遇比原作少，所以比原作的 1/4096 高），用「抽幾次」疊加加成。
//   閃耀護符：捕獲 60 種後自動獲得，+2 次
//   同種連鎖：連續捕獲同一種寶可夢，連鎖越長越容易遇到牠、牠的色違也越容易出現
//   泡芙誘餌：華麗泡芙 +1 次、豪華泡芙 +2 次
// 連鎖在「抓到別種」時重新計算，在「連鎖中的那一種逃走／放牠走」時中斷。

export const BASE_ODDS = 512;
export const CHARM_AT = 60;
export const CHAIN_STEPS = [5, 10, 20, 30]; // 到這些數字時提示玩家

export function chainRolls(count) {
  return count >= 30 ? 8 : count >= 20 ? 5 : count >= 10 ? 3 : count >= 5 ? 1 : 0;
}

const LURE_ROLLS = { fancy: 1, deluxe: 2 };

// 這一次生成的寶可夢要抽幾次色違
export function shinyRolls(state, speciesId, ctx = {}) {
  let rolls = 1;
  if (state.shinyCharm) rolls += 2;
  if (state.chain?.species === speciesId) rolls += chainRolls(state.chain.count);
  rolls += LURE_ROLLS[ctx.lureTier] ?? 0;
  return rolls;
}

export function shinyChance(state, speciesId, ctx = {}) {
  return 1 - Math.pow(1 - 1 / BASE_ODDS, shinyRolls(state, speciesId, ctx));
}

// 連鎖中的寶可夢比較容易出現（最多 4 倍）
export function chainSpawnMult(state, speciesId) {
  const c = state.chain;
  return c?.species === speciesId ? 1 + Math.min(20, c.count) * 0.15 : 1;
}

// 抓到一隻之後更新連鎖，回傳新的連鎖數
export function advanceChain(state, speciesId) {
  if (state.chain?.species === speciesId) state.chain.count++;
  else state.chain = { species: speciesId, count: 1 };
  return state.chain.count;
}

// 連鎖中的那一種沒抓到就中斷；回傳中斷前的連鎖數（沒中斷回傳 0）
export function breakChain(state, speciesId) {
  if (state.chain?.species !== speciesId || !state.chain.count) return 0;
  const was = state.chain.count;
  state.chain = { species: null, count: 0 };
  return was;
}
