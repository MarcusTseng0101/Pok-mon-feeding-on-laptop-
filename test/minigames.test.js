// PR 3：小遊戲的計分與獎勵
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import * as mg from '../src/core/minigames.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 8, 25, 14, 0).getTime();
const DAY = 24 * 3600 * 1000;

function newGame(seed = 1) {
  let clock = T0;
  const game = new Game({ dex, state: defaultSave(T0), rng: createRng(seed), now: () => clock });
  game.advance = ms => { clock += ms; };
  return game;
}

test('摘樹果：五種都會掉、一場最多帶回 15 顆、統計有記', () => {
  const rng = createRng(2);
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(mg.rollBerry(rng));
  assert.deepEqual([...seen].sort(), ['aspear', 'cheri', 'chesto', 'pecha', 'rawst']);
  const g = newGame();
  assert.equal(g.addBerries({ pecha: 10, cheri: 10, durian: 5 }), 15);
  assert.equal(g.state.bag.berries.pecha + g.state.bag.berries.cheri, 15);
  assert.equal(g.state.stats.berriesPicked, 15);
});

test('做泡芙：口味看最多的樹果', () => {
  assert.equal(mg.puffFlavor(['pecha', 'pecha', 'cheri']), 'sweet');
  assert.equal(mg.puffFlavor(['cheri', 'rawst', 'rawst']), 'mocha');
  assert.equal(mg.puffFlavor(['chesto', 'aspear', 'cheri']), 'mint'); // 都一樣多：用第一個
});

test('做泡芙：攪拌要轉夠圈而且穩定', () => {
  const steady = Array(50).fill(8); // 5 秒、每秒 8 弧度 ≈ 6.4 圈
  assert.equal(mg.stirScore(steady), mg.STIR_MAX);
  const jerky = Array.from({ length: 50 }, (_, i) => (i % 2 ? 2 : 14));
  assert.ok(mg.stirScore(jerky) < mg.STIR_MAX / 2, `忽快忽慢 ${mg.stirScore(jerky)}`);
  const tooFew = Array(50).fill(1); // 不到 1 圈
  assert.ok(mg.stirScore(tooFew) < 15);
  const backAndForth = Array.from({ length: 50 }, (_, i) => (Math.floor(i / 3) % 2 ? 8 : -8));
  assert.ok(mg.stirScore(backAndForth) < 10, '來回晃不算攪拌');
  assert.equal(mg.stirScore([]), 0);
});

test('做泡芙：烘烤時機、裝飾分散度、等級分界', () => {
  assert.equal(mg.bakeScore(0), mg.BAKE_MAX);
  assert.equal(mg.bakeScore(0.8), 0);
  assert.equal(mg.bakeScore(-0.4), Math.round(mg.BAKE_MAX / 2));
  const spread = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 0.2, y: 0.8 }, { x: 0.8, y: 0.8 }];
  assert.equal(mg.decoScore(spread), mg.DECO_MAX);
  assert.ok(mg.decoScore(Array(5).fill({ x: 0.5, y: 0.5 })) < 5, '點在同一個地方');
  assert.equal(mg.decoScore([]), 0);
  assert.equal(mg.STIR_MAX + mg.BAKE_MAX + mg.DECO_MAX, 100);
  assert.deepEqual([0, 39, 40, 69, 70, 89, 90, 100].map(mg.bakeTier), ['basic', 'basic', 'frosted', 'frosted', 'fancy', 'fancy', 'deluxe', 'deluxe']);
});

test('做泡芙：用掉 3 顆樹果、每天最多 5 個、豪華的每天只有 1 個', () => {
  const g = newGame();
  g.state.bag.berries.pecha = 30;
  const before = g.state.bag.puffs['sweet-deluxe'];
  const r1 = g.bakePuff(['pecha', 'pecha', 'pecha'], 100);
  assert.deepEqual(r1, { ok: true, puff: 'sweet-deluxe', tier: 'deluxe', capped: false });
  assert.equal(g.state.bag.berries.pecha, 27);
  assert.equal(g.state.bag.puffs['sweet-deluxe'], before + 1);
  // 第二個豪華的：降成精緻
  const r2 = g.bakePuff(['pecha', 'pecha', 'pecha'], 100);
  assert.deepEqual([r2.tier, r2.capped], ['fancy', true]);
  for (let i = 0; i < 3; i++) assert.equal(g.bakePuff(['pecha', 'pecha', 'pecha'], 50).ok, true);
  assert.equal(g.bakesLeft(), 0);
  assert.equal(g.bakePuff(['pecha', 'pecha', 'pecha'], 50).reason, 'daily');
  assert.equal(g.state.bag.berries.pecha, 15, '被拒絕的時候不能扣樹果');
  // 隔天重新計算
  g.advance(DAY);
  assert.equal(g.bakesLeft(), 5);
  assert.equal(g.bakePuff(['pecha', 'pecha', 'pecha'], 95).tier, 'deluxe');
  // 樹果不夠
  g.state.bag.berries.cheri = 2;
  assert.equal(g.bakePuff(['cheri', 'cheri', 'cheri'], 50).reason, 'no-berry');
  assert.equal(g.state.bag.berries.cheri, 2);
  assert.equal(g.state.stats.puffsBaked, 6);
  // 每日計數會存檔
  const back = migrate(structuredClone(g.state), dex, T0);
  assert.deepEqual(back.minigames, g.state.minigames);
});

test('做泡芙不會比原本拿泡芙的方式更划算：一天最多 5 個，只有 1 個豪華', () => {
  // 原本：每日禮物 3 個＋夥伴大約每小時 1 個。做泡芙一天最多多 5 個，而且要先摘 15 顆樹果
  assert.ok(mg.DAILY_BAKES <= 5);
  assert.equal(mg.DAILY_DELUXE, 1);
  assert.equal(mg.BERRIES_PER_PUFF, 3);
});

test('頭球：好感最多 +15', () => {
  const g = newGame();
  const m = g.createMon(650);
  g.state.mons.push(m);
  assert.equal(mg.headItAffection(4), 4);
  assert.equal(mg.headItAffection(40), 15);
  g.headIt(m.uid, 40);
  assert.equal(m.affection, 15);
});

test('拼圖：打亂後一定不是原本的順序；拼完滿足感 +20', () => {
  const rng = createRng(4);
  for (let i = 0; i < 50; i++) {
    const t = mg.shufflePuzzle(rng);
    assert.equal(t.length, 9);
    assert.deepEqual([...t].sort(), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(mg.puzzleSolved(t), false);
  }
  const g = newGame();
  const m = g.createMon(650);
  m.enjoyment = 100;
  g.state.mons.push(m);
  g.puzzleDone(m.uid);
  assert.equal(m.enjoyment, 120);
});

test('超級特訓：單項最多 252、總和最多 510', () => {
  const g = newGame();
  const m = g.createMon(650);
  g.state.mons.push(m);
  assert.deepEqual(g.train(m.uid, 'atk', 10), { gained: 40, value: 40 });
  g.train(m.uid, 'atk', 999);
  assert.equal(m.training.atk, 252);
  g.train(m.uid, 'spe', 999);
  assert.equal(m.training.spe, 252);
  const r = g.train(m.uid, 'hp', 999);
  assert.equal(r.gained, 6, '只剩 6 點');
  assert.equal(mg.trainingTotal(m.training), 510);
  assert.equal(g.train(m.uid, 'def', 5).gained, 0);
  assert.equal(g.train(m.uid, 'luck', 5), null);
});

test('切磋：特訓差距對命中最多 ±15%', () => {
  const none = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const full = { hp: 252, atk: 252, def: 6, spa: 0, spd: 0, spe: 0 };
  assert.equal(mg.duelEdge(none, none), 1);
  assert.equal(mg.duelEdge(full, none), 1.15);
  assert.equal(mg.duelEdge(none, full), 0.85);
  assert.equal(mg.duelHitChance(none, none), 0.8);
  assert.ok(Math.abs(mg.duelHitChance(full, none) - 0.92) < 1e-9);
  assert.ok(Math.abs(mg.duelHitChance(none, full) - 0.68) < 1e-9, '剛抓到的也還有 68% 打得中');
});
