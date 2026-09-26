// 招式的演出：每一招都能從頭放到尾、沒有錯誤、粒子不會爆量；打中會頓一下、震一下；
// 設定「減少閃光和畫面震動」打開時不震動、光比較淡；畫一幀的時間在預算內
const { run } = require('./lib.cjs');

run('movefx', async ({ page, shot }, check) => {
  const r = await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    const M = await import('/src/renderer/scene/moves.js');
    game.chooseStarter(653);
    const m = game.createMon(650); m.out = true; game.state.mons.push(m);
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 2 && Date.now() - t0 < 15000) await new Promise(res => setTimeout(res, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity; director.updateEnv = () => {};
    Object.assign(stage.env, { sleepy: false, userActive: false, hour: 14, focus: null });
    const [a, b] = [...stage.pets.values()];
    const place = () => {
      stage.fx.parts = []; stage.stopT = 0; stage.shakeT = 0;
      for (const p of [a, b]) { p.set('idle', 999); p.moveCtx = null; p.kvx = p.kvy = 0; p.z = 0; }
      a.x = 400 * stage.dpr; a.gy = 450 * stage.dpr; b.x = 700 * stage.dpr; b.gy = 450 * stage.dpr; a.facing = 1; b.facing = -1;
    };
    const play = id => {
      place();
      let hitAt = null, shook = false, stopped = false, maxParts = 0, drawMs = 0, frames = 0;
      M.useMove(a, id, b, { onHit: () => { hitAt = frames; } });
      for (let i = 0; i < 200 && a.moveCtx; i++) {
        stage.update(1 / 30);
        if (stage.shakeT > 0) shook = true;
        if (stage.stopT > 0) stopped = true;
        maxParts = Math.max(maxParts, stage.fx.parts.length);
        const t = performance.now(); stage.draw(); drawMs += performance.now() - t;
        frames++;
      }
      return { id, done: !a.moveCtx, hit: hitAt !== null, shook, stopped, maxParts, drawMs: drawMs / Math.max(1, frames) };
    };
    const ids = Object.keys(M.MOVES);
    const all = ids.map(play);
    // 減少閃光和畫面震動
    game.setSetting('calmFx', true);
    const calm = ['flamethrower', 'headsmash', 'boomburst', 'moonblast'].map(play);
    game.setSetting('calmFx', false);
    // 截圖：噴射火焰打中
    place();
    M.useMove(a, 'flamethrower', b);
    for (let i = 0; i < 24; i++) stage.update(1 / 30);
    stage.shakeT = 0;
    stage.draw();
    return { n: ids.length, all, calm };
  });
  const bad = r.all.filter(x => !x.done);
  const noHit = r.all.filter(x => !x.hit && !['sweetscent', 'cottonspore', 'spikyshield', 'reflect', 'quiverdance', 'kingsshield', 'fairylock', 'geomancy'].includes(x.id));
  const heavy = r.all.filter(x => x.maxParts > 400);
  const slow = r.all.filter(x => x.drawMs > 6);
  const quiet = r.all.filter(x => x.hit && !x.shook);
  console.log(JSON.stringify({ n: r.n, maxParts: Math.max(...r.all.map(x => x.maxParts)), drawMs: +Math.max(...r.all.map(x => x.drawMs)).toFixed(2), calm: r.calm }));
  check(r.n >= 60 && bad.length === 0, `有招式放不完：${bad.map(x => x.id)}`);
  check(noHit.length === 0, `有招式沒有打中：${noHit.map(x => x.id)}`);
  check(heavy.length === 0, `粒子太多：${heavy.map(x => `${x.id}:${x.maxParts}`)}`);
  check(slow.length === 0, `畫一幀太久：${slow.map(x => `${x.id}:${x.drawMs.toFixed(1)}ms`)}`);
  check(quiet.length === 0, `打中了卻沒有震動：${quiet.map(x => x.id)}`);
  check(r.all.filter(x => x.hit).every(x => x.stopped), '打中時沒有頓一下');
  check(r.calm.every(x => x.done && !x.shook), `減少震動打開了還是在震：${JSON.stringify(r.calm)}`);
  await shot('movefx');
});
