// 會動的像素圖（gfx/rig.js）：維持原本的 2 倍像素圖，切成頭／身體／左右腳，只移動整數個像素。
// 待機會呼吸、走路左右腳輪流抬；每一格的顏色都是原圖裡有的（沒有糊掉、沒有新顏色）；
// 高度跟原本一樣（上面多留 1 格）；兩隻同一種的不會同步；點得到
const { run } = require('./lib.cjs');

run('anim', async ({ page, shot }, check) => {
  const r = await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(650);
    for (const id of [650, 697, 715]) { const m = game.createMon(id); m.out = true; game.state.mons.push(m); }
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 4 && Date.now() - t0 < 15000) await new Promise(res => setTimeout(res, 50));
    await Promise.all([650, 697, 715].map(id => stage.sprites.get(id)));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity; director.updateEnv = () => {};
    Object.assign(stage.env, { sleepy: false, userActive: false, hour: 14, focus: null });
    const [a, b, c, d] = [...stage.pets.values()];
    const out = {};
    // 每一格的顏色都是原圖有的顏色；大小＝原圖＋左右各 1、上面 1
    const colors = cv => { const s = new Set(); const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0) s.add(`${px[i]},${px[i + 1]},${px[i + 2]},${px[i + 3]}`); return s; };
    out.pixel = [650, 697].map(id => {
      const still = stage.sprites.peek(id, false), anim = stage.sprites.peekAnim(id, false), base = colors(still.canvas);
      const all = [...anim.sets.idle.frames, ...anim.sets.walk.frames];
      const bad = all.reduce((n, f) => n + [...colors(f.canvas)].filter(k => !base.has(k)).length, 0);
      return { id, still: [still.w, still.h], anim: [anim.w, anim.h], newColors: bad, legs: anim.info.hasLegs };
    });
    const sig = p => { const cv = p.asset.canvas; const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let h = 0; for (let i = 0; i < px.length; i += 3) h = (h * 31 + px[i]) >>> 0; return h; };
    // 待機：2 秒內至少換 2 種畫面（呼吸）
    for (const p of [a, b, c, d]) { p.set('idle', 999); p.gy = 400 * stage.dpr; }
    a.x = 300 * stage.dpr; b.x = 450 * stage.dpr; c.x = 700 * stage.dpr; d.x = 950 * stage.dpr;
    const idle = new Set();
    for (let i = 0; i < 60; i++) { stage.update(1 / 30); idle.add(sig(a)); }
    out.idleFrames = idle.size;
    out.idleSet = a.view?.set === a.view?.anim.sets.idle;
    // 走路：用走路的那一組（左腳抬、身體上來、右腳抬、身體上來），1 秒內至少 3 種畫面
    a.target = { x: 100 * stage.dpr, y: a.gy }; a.set('walk'); a.walkLimit = 99;
    const walk = new Set();
    let walkSet = 0;
    for (let i = 0; i < 30; i++) { stage.update(1 / 30); walk.add(sig(a)); if (a.view?.set === a.view?.anim.sets.walk) walkSet++; }
    out.walkFrames = walk.size;
    out.walkSet = walkSet;
    // 兩隻同一種的不同步
    let same = 0;
    a.set('idle', 999);
    for (let i = 0; i < 60; i++) { stage.update(1 / 30); if (a.asset.frame === b.asset.frame) same++; }
    out.sameFrames = same;
    // 點得到
    const rc = c.rect();
    out.hit = stage.targetAt(rc.x + rc.w / 2, rc.y + rc.h * 0.6) === c;
    stage.draw();
    return out;
  });
  console.log(JSON.stringify(r));
  check(r.pixel.every(p => p.newColors === 0), `動起來的圖出現原圖沒有的顏色（糊掉了）：${JSON.stringify(r.pixel)}`);
  check(r.pixel.every(p => p.anim[0] === p.still[0] + 2 && p.anim[1] === p.still[1] + 1), `大小不對：${JSON.stringify(r.pixel)}`);
  check(r.pixel.every(p => p.legs), `應該找得到腳：${JSON.stringify(r.pixel)}`);
  check(r.idleSet && r.idleFrames >= 2, `待機沒有在呼吸：${r.idleFrames}`);
  check(r.walkSet >= 20 && r.walkFrames >= 3, `走路沒有用走路的動作：${r.walkSet} 幀、${r.walkFrames} 種畫面`);
  check(r.sameFrames < 60, '兩隻同一種的動作完全同步');
  check(r.hit, '點不到會動的寶可夢');
  await shot('anim');
});
