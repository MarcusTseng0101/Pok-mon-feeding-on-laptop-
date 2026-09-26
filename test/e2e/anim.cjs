// 會動的圖（Showdown 的 GIF）：載好以後桌面上的寶可夢會動；高度跟原本不會動的圖一樣；
// 走路播得比待機快；兩隻同一種的不會同步；關掉（?anim=0）或下載不到就用原本的圖
const { run } = require('./lib.cjs');

const setup = async (page, ids) => page.evaluate(async ids => {
  const { game, director, stage, ui } = window.__kalos;
  game.chooseStarter(ids[0]);
  for (const id of ids.slice(1)) { const m = game.createMon(id); m.out = true; game.state.mons.push(m); }
  director.syncPets();
  const t0 = Date.now();
  while (stage.pets.size < ids.length && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
  ui.modal.classList.add('hidden');
  director.nextSpawnAt = Infinity; director.updateEnv = () => {};
  Object.assign(stage.env, { sleepy: false, userActive: false, hour: 14, focus: null });
  const pets = [...stage.pets.values()];
  for (const p of pets) void p.asset;
  const t1 = Date.now();
  while (pets.some(p => !stage.sprites.peekAnim(p.spriteKey, p.mon.shiny)) && Date.now() - t1 < 20000) await new Promise(r => setTimeout(r, 100));
}, ids);

run('anim', async ({ page, shot }, check) => {
  await setup(page, [650, 650, 697]);
  const r = await page.evaluate(() => {
    const { stage } = window.__kalos;
    const [a, b, c] = [...stage.pets.values()];
    const sig = p => { const cv = p.asset.canvas; const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let h = 0; for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) >>> 0; return h; };
    const out = { animated: [a, b, c].map(p => Boolean(p.asset.animated)) };
    out.sizes = [a, c].map(p => { const still = stage.sprites.peek(p.spriteKey, false); return { still: still.h, anim: p.asset.h, frames: stage.sprites.peekAnim(p.spriteKey, false).frames.length }; });
    // 1 秒內至少換 5 張不同的畫面
    for (const p of [a, b, c]) { p.set('idle', 999); }
    a.x = 300 * stage.dpr; b.x = 500 * stage.dpr; c.x = 800 * stage.dpr;
    const seen = new Set();
    for (let i = 0; i < 30; i++) { stage.update(1 / 30); seen.add(sig(a)); }
    out.distinct = seen.size;
    // 兩隻同一種的：不是同一格
    let same = 0;
    for (let i = 0; i < 30; i++) { stage.update(1 / 30); if (a.asset.frame === b.asset.frame) same++; }
    out.sameFrames = same;
    // 走路播得比待機快
    const t0 = a.animT; stage.update(1 / 30); const idleStep = a.animT - t0;
    a.target = { x: 100 * stage.dpr, y: a.gy }; a.set('walk');
    const t1 = a.animT; stage.update(1 / 30); const walkStep = a.animT - t1;
    out.speed = +(walkStep / idleStep).toFixed(2);
    // 滑鼠點得到（用當下這一格的形狀判斷）
    const rc = c.rect(), hit = stage.targetAt(rc.x + rc.w / 2, rc.y + rc.h * 0.6);
    out.hit = hit === c;
    for (const p of [a, b, c]) p.set('idle', 999);
    stage.draw();
    return out;
  });
  console.log(JSON.stringify(r));
  check(r.animated.every(Boolean), `沒有用會動的圖：${r.animated}`);
  check(r.sizes.every(s => Math.abs(s.anim - s.still) <= 1 && s.frames > 10), `大小跟原本不一樣：${JSON.stringify(r.sizes)}`);
  check(r.distinct >= 5, `1 秒內畫面沒有在動（${r.distinct} 種畫面）`);
  check(r.sameFrames < 30, '兩隻同一種的動作完全同步');
  check(r.speed >= 1.4, `走路沒有播得比較快：${r.speed}`);
  check(r.hit, '點不到會動的寶可夢');
  await shot('anim');

  // 下載不到會動的圖（離線、沒有這張）：用原本不會動的圖，一樣可以點、可以動
  const off = await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    stage.sprites.api.getAnimSprite = async () => null;
    const m = game.createMon(656); m.shiny = true; m.out = true; game.state.mons.push(m);
    director.syncPets();
    const t0 = Date.now();
    while (!stage.pets.has(m.uid) && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    const p = stage.pets.get(m.uid);
    void p.asset;
    await new Promise(r => setTimeout(r, 500));
    for (let i = 0; i < 30; i++) stage.update(1 / 30);
    stage.draw();
    return { animated: Boolean(p.asset.animated), fallback: p.asset.fallback, w: p.asset.w };
  });
  check(!off.animated && !off.fallback && off.w > 10, `下載不到會動的圖時沒有用原本的圖：${JSON.stringify(off)}`);
});
