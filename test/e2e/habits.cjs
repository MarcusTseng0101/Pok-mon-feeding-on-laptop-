// 回歸測試：72 種寶可夢每一種的每一個習性都跑一次，要能結束、不能跑出螢幕、不能有錯誤
const { run } = require('./lib.cjs');

const LIMIT_S = 30; // 模擬秒數；超過還沒回到一般狀態就算卡住

run('habits', async ({ page }, check) => {
  const r = await page.evaluate(async LIMIT_S => {
    const { game, director, stage, dex } = window.__kalos;
    const H = await import('/src/renderer/scene/habits.js');
    game.chooseStarter(650);
    const missing = dex.ids.filter(id => !H.HABITS_BY_SPECIES[id]?.length);
    const unknown = [];
    for (const names of Object.values(H.HABITS_BY_SPECIES)) for (const n of names) if (!H.HABITS[n]) unknown.push(n);
    const oob = [], stuck = [];
    let runs = 0;
    stage.env.hour = 22; stage.env.plugged = true;
    const ids = dex.ids;
    for (let i = 0; i < ids.length; i += 6) {
      for (const m of game.state.mons) m.out = false;
      const group = ids.slice(i, i + 6);
      if (!group.includes(713)) group.push(i < 60 ? 694 : 713); // 冰岩怪：有「載別隻」的習性
      for (const id of group) { const m = game.createMon(id, {}); m.affection = 200; m.out = true; game.state.mons.push(m); }
      stage.pets.clear();
      director.syncPets();
      const t0 = Date.now();
      while (stage.pets.size < group.length && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
      const pets = [...stage.pets.values()];
      for (const p of pets) {
        for (const [name, , start] of H.habitOptions(p, pets.filter(o => o !== p))) {
          for (const q of pets) { q.set('idle', 99); q.partner = null; q.habit = null; q.z = 0; }
          start();
          runs++;
          let f = 0;
          for (; f < LIMIT_S * 20; f++) {
            stage.update(0.05);
            if (f % 5 === 0) stage.draw();
            for (const q of pets) {
              const rc = q.rect();
              if (!Number.isFinite(q.x + q.gy + q.z) || q.gy > stage.H + 2 || rc.y < -3) oob.push(`${dex.name(q.mon.species)} ${q.state} gy=${Math.round(q.gy)}`);
            }
            if (f > 40 && p.state === 'idle') break;
          }
          if (f >= LIMIT_S * 20) stuck.push(`${dex.name(p.mon.species)}:${name}（還在 ${p.state}）`);
        }
      }
    }
    return { missing, unknown, oob: oob.slice(0, 10), oobCount: oob.length, stuck, runs };
  }, LIMIT_S);
  console.log(`跑了 ${r.runs} 個習性`);
  check(r.missing.length === 0, `沒有習性的寶可夢：${r.missing}`);
  check(r.unknown.length === 0, `不存在的習性：${r.unknown}`);
  check(r.oobCount === 0, `跑出螢幕 ${r.oobCount} 次：${r.oob.join('、')}`);
  check(r.stuck.length === 0, `${LIMIT_S} 秒內沒結束：${r.stuck.join('、')}`);
});
