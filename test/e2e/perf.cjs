// 效能：6 隻夥伴 + 1 隻野生寶可夢，量每一幀 update + draw 的時間（真實毫秒）
// 目標：中位數 < 8 ms、p95 < 16 ms
const { run } = require('./lib.cjs');

const FRAMES = Number(process.env.FRAMES) || 1500;

run('perf', async ({ page }, check) => {
  const r = await page.evaluate(async FRAMES => {
    const { game, director, stage } = window.__kalos;
    game.chooseStarter(653);
    for (const id of [669, 666, 676, 700, 713]) { const m = game.createMon(id, {}); m.affection = 200; m.out = true; game.state.mons.push(m); }
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 6 && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
    await director.spawn();
    await new Promise(r => setTimeout(r, 1500));
    const times = [];
    for (let f = 0; f < FRAMES; f++) {
      const t = performance.now();
      stage.update(1 / 60);
      stage.draw();
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    return { p50: times[Math.floor(times.length * 0.5)], p95: times[Math.floor(times.length * 0.95)], pets: stage.pets.size, wild: Boolean(stage.wild || stage.spot) };
  }, FRAMES);
  console.log(`每幀 update+draw：中位數 ${r.p50.toFixed(2)} ms，p95 ${r.p95.toFixed(2)} ms（${r.pets} 隻夥伴，野生：${r.wild ? '有' : '沒有'}）`);
  check(r.p50 < 8, `中位數 ${r.p50.toFixed(2)} ms 超過 8 ms`);
  check(r.p95 < 16, `p95 ${r.p95.toFixed(2)} ms 超過 16 ms`);
});
