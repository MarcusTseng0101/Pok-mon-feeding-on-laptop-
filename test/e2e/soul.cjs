// v3 成功的定義：「放著 10 分鐘就有戲」
// 3 隻寶可夢、使用者完全不操作、舞台時間 600 秒（固定 dt = 1/30 快轉），5 個種子都要過：
//   1. 自主行為至少 6 種不同的類別
//   2. 沒有一個類別超過全部決策的 40%
//   3. 每個決策都有理由，而且理由屬於實際被選中的類別
//   4. 每個種子至少 2 個理由提到需求；提到關係或記憶的理由，5 個種子合起來至少 REL_TOTAL 個
//      （使用者同意的量法修改，骨架木偶第 3 批：原本每個種子都要至少 1 個。放 10 分鐘有沒有提到關係很看路線，main 上 12 個種子裡本來就有 1 個是 0；
//       改之前：每個種子 ≥ 1；改之後：合起來 ≥ 5。main 的 5 個種子合起來 40、這個分支 45）
//   5. 出門旅行最多 1 次（一次只能一隻出門，旅行至少 30 分鐘）
//   6. 有回秘密基地（v3 PR 4）
// 執行：node test/e2e/soul.cjs        BASELINE=1 node test/e2e/soul.cjs（心智的倍率全部當 1，看基準線）
const { open } = require('./lib.cjs');

const SEEDS = [1, 2, 3, 4, 5];
const SIM_SECONDS = 600;
const DT = 1 / 30;
const baseline = process.env.BASELINE === '1';
const REL_TOTAL = 5; // 5 個種子合起來至少幾個理由提到關係或記憶 // 猜的，可調整（只在第一次改量法時定，之後不改）

// 在網頁的程式執行之前：Math.random 換成固定種子；可以暫停 requestAnimationFrame
function seedPage(seed) {
  let a = seed >>> 0;
  window.__reseed = s => { a = s >>> 0; };
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => (window.__holdRaf ? 0 : raf(cb));
}

async function runSeed(seed) {
  const ctx = await open({ init: seedPage, initArg: seed });
  const { page } = ctx;
  try {
    const r = await page.evaluate(async ({ SIM_SECONDS, DT, baseline, seed }) => {
      const { game, director, stage } = window.__kalos;
      // 同一個種子每次都要一樣（以前偶爾失敗的原因：同一個種子每次跑出來不一樣）：
      //  - 畫面迴圈一開始就停（等圖載好的時間不一定，牠們會先走不一樣遠）
      //  - 時鐘固定在某一天的 14:00、跟著快轉走（牠們的生活 core/life.js 看時間；uid 也含有時間，生活表用 uid 當種子）
      //  - 亂數在建立夥伴前、開始快轉前各重新設定一次（載入時用掉幾個亂數要看載入的速度）；
      //    遊戲自己的亂數（game.rng，uid 和心智用它）一開啟 app 就用當下的時間當種子，也要換成固定的
      //  - 快轉中間不讓出（不然 app 每 10 秒的 tick 之類的計時器會在不一定的時間插進來用掉亂數）
      window.__holdRaf = true; // 停掉真的畫面迴圈，只用下面的快轉
      await new Promise(r => setTimeout(r, 100));
      const t0Sim = new Date(2026, 8, 22, 14, 0).getTime();
      let simT = 0;
      Date.now = () => t0Sim + Math.round(simT * 1000);
      window.__reseed(seed);
      const { createRng } = await import('/src/core/rng.js');
      game.rng = director.rng = createRng(seed);
      game.chooseStarter(650);
      for (const id of [653, 656]) { const m = game.createMon(id); m.out = true; game.state.mons.push(m); }
      director.syncPets();
      const t0 = performance.now();
      while (stage.pets.size < 3 && performance.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
      director.nextSpawnAt = Infinity;
      director.updateEnv = () => {};
      Object.assign(stage.env, { sleepy: false, userActive: false, hour: 14, focus: null }); // 白天、使用者不在
      stage.mindOff = baseline;
      stage.decisionLog = [];
      // 開始的位置和狀態也固定（照建立的順序排）
      const order = game.state.mons.map(m => m.uid);
      [...stage.pets.values()].sort((a, b) => order.indexOf(a.uid) - order.indexOf(b.uid)).forEach((p, i) => {
        p.x = stage.W * (0.3 + i * 0.2); p.gy = stage.H * 0.7; p.z = 0; p.facing = i % 2 ? 1 : -1; p.set('idle', 0.5 + i * 0.3);
      });
      window.__reseed(seed * 7919);
      game.rng = director.rng = createRng(seed * 7919);
      const wall = performance.now();
      const steps = Math.round(SIM_SECONDS / DT);
      for (let i = 0; i < steps; i++) {
        simT += DT;
        stage.update(DT);
      }
      return { log: stage.decisionLog, wallMs: Math.round(performance.now() - wall), pets: stage.pets.size };
    }, { SIM_SECONDS, DT, baseline, seed });
    return { ...r, errors: ctx.errors };
  } finally {
    await ctx.close();
  }
}

(async () => {
  const problems = [];
  const rows = [];
  let relTotal = 0;
  for (const seed of SEEDS) {
    let r;
    try { r = await runSeed(seed); } catch (err) { problems.push(`種子 ${seed}：${err.message}`); continue; }
    const log = r.log;
    const count = {};
    for (const e of log) count[e.cat] = (count[e.cat] ?? 0) + 1;
    const share = Object.fromEntries(Object.entries(count).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round((v / log.length) * 100)]));
    const maxShare = Math.max(...Object.values(share));
    const bad = log.filter(e => !e.text || !e.key?.startsWith(`${e.cat}.`));
    const needs = log.filter(e => e.cites === 'need').length;
    const rel = log.filter(e => e.cites === 'relation' || e.cites === 'memory').length;
    relTotal += rel;
    rows.push(`種子 ${seed}：${log.length} 個決策、${r.wallMs}ms  ${JSON.stringify(share)}  需求 ${needs}、關係/記憶 ${rel}`);
    if (baseline) continue;
    const p = m => problems.push(`種子 ${seed}：${m}`);
    if (Object.keys(count).length < 6) p(`只有 ${Object.keys(count).length} 種類別`);
    if (maxShare > 40) p(`類別太集中 ${JSON.stringify(share)}`);
    if (bad.length) p(`${bad.length} 個理由不屬於實際的類別，例如 ${JSON.stringify(bad[0])}`);
    if (needs < 2) p(`提到需求的理由只有 ${needs} 個`);
    if (!count.base) p('沒有回秘密基地');
    if ((count.trip ?? 0) > 1) p(`600 秒內出門旅行了 ${count.trip} 次（最多 1 次）`);
    if (r.errors.length) p(`console 有錯誤：${r.errors.slice(0, 2).join(' | ')}`);
  }
  console.log(rows.join('\n'));
  if (baseline) { console.log('BASELINE（沒有判定）'); return; }
  console.log(`提到關係或記憶的理由：${SEEDS.length} 個種子合起來 ${relTotal} 個（要 ≥ ${REL_TOTAL}）`);
  if (relTotal < REL_TOTAL) problems.push(`${SEEDS.length} 個種子合起來只有 ${relTotal} 個理由提到關係或記憶（要 ≥ ${REL_TOTAL}）`);
  console.log(problems.length ? `FAIL soul: ${problems.join('; ')}` : 'PASS soul');
  process.exitCode = problems.length ? 1 : 0;
})();
