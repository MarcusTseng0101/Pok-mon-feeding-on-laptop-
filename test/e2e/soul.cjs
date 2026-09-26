// v3 成功的定義：「放著 10 分鐘就有戲」
// 3 隻寶可夢、使用者完全不操作、舞台時間 600 秒（固定 dt = 1/30 快轉），5 個種子都要過：
//   1. 自主行為至少 6 種不同的類別
//   2. 沒有一個類別超過全部決策的 40%
//   3. 每個決策都有理由，而且理由屬於實際被選中的類別
//   4. 至少 2 個理由提到需求，至少 1 個提到關係或記憶
//   5. 出門旅行最多 1 次（一次只能一隻出門，旅行至少 30 分鐘）
//   6. 有回秘密基地（v3 PR 4）
// 執行：node test/e2e/soul.cjs        BASELINE=1 node test/e2e/soul.cjs（心智的倍率全部當 1，看基準線）
const { open } = require('./lib.cjs');

const SEEDS = [1, 2, 3, 4, 5];
const SIM_SECONDS = 600;
const DT = 1 / 30;
const baseline = process.env.BASELINE === '1';

// 在網頁的程式執行之前：Math.random 換成固定種子；可以暫停 requestAnimationFrame
function seedPage(seed) {
  let a = seed >>> 0;
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
    const r = await page.evaluate(async ({ SIM_SECONDS, DT, baseline }) => {
      const { game, director, stage } = window.__kalos;
      game.chooseStarter(650);
      for (const id of [653, 656]) { const m = game.createMon(id); m.out = true; game.state.mons.push(m); }
      director.syncPets();
      const t0 = Date.now();
      while (stage.pets.size < 3 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
      window.__holdRaf = true; // 停掉真的畫面迴圈，只用下面的快轉
      await new Promise(r => setTimeout(r, 100));
      director.nextSpawnAt = Infinity;
      director.updateEnv = () => {};
      Object.assign(stage.env, { sleepy: false, userActive: false, hour: 14, focus: null }); // 白天、使用者不在
      stage.mindOff = baseline;
      stage.decisionLog = [];
      const wall = performance.now();
      const steps = Math.round(SIM_SECONDS / DT);
      for (let i = 0; i < steps; i++) {
        stage.update(DT);
        if (i % 600 === 0) await new Promise(r => setTimeout(r, 0));
      }
      return { log: stage.decisionLog, wallMs: Math.round(performance.now() - wall), pets: stage.pets.size };
    }, { SIM_SECONDS, DT, baseline });
    return { ...r, errors: ctx.errors };
  } finally {
    await ctx.close();
  }
}

(async () => {
  const problems = [];
  const rows = [];
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
    rows.push(`種子 ${seed}：${log.length} 個決策、${r.wallMs}ms  ${JSON.stringify(share)}  需求 ${needs}、關係/記憶 ${rel}`);
    if (baseline) continue;
    const p = m => problems.push(`種子 ${seed}：${m}`);
    if (Object.keys(count).length < 6) p(`只有 ${Object.keys(count).length} 種類別`);
    if (maxShare > 40) p(`類別太集中 ${JSON.stringify(share)}`);
    if (bad.length) p(`${bad.length} 個理由不屬於實際的類別，例如 ${JSON.stringify(bad[0])}`);
    if (needs < 2) p(`提到需求的理由只有 ${needs} 個`);
    if (rel < 1) p('沒有理由提到關係或記憶');
    if (!count.base) p('沒有回秘密基地');
    if ((count.trip ?? 0) > 1) p(`600 秒內出門旅行了 ${count.trip} 次（最多 1 次）`);
    if (r.errors.length) p(`console 有錯誤：${r.errors.slice(0, 2).join(' | ')}`);
  }
  console.log(rows.join('\n'));
  if (baseline) { console.log('BASELINE（沒有判定）'); return; }
  console.log(problems.length ? `FAIL soul: ${problems.join('; ')}` : 'PASS soul');
  process.exitCode = problems.length ? 1 : 0;
})();
