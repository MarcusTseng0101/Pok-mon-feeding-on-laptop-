// 形態圖片：藍花的花蓓蓓要真的顯示藍花的圖（不是替代圖、也不是紅花的圖）
const { run } = require('./lib.cjs');

run('forms', async ({ page, shot }, check) => {
  const r = await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    game.chooseStarter(650);
    document.querySelector('.modal')?.classList.add('hidden');
    const mk = (species, form, x) => {
      const m = game.createMon(species, { form });
      m.out = true;
      m.pos = { x, y: 0.6 };
      game.state.mons.push(m);
      return m;
    };
    game.state.mons[0].out = false;
    const blue = mk(669, 'blue', 0.2), red = mk(669, null, 0.4), polar = mk(666, 'polar', 0.6), heart = mk(676, 'heart', 0.8);
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 4 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 100));
    for (const p of stage.pets.values()) p.set('idle', 99);
    await new Promise(r => setTimeout(r, 1500));
    window.__kalos.ui.modal.classList.add('hidden'); // 歡迎視窗是非同步打開的，會蓋住寶可夢
    const pet = m => stage.pets.get(m.uid);
    const px = a => { const c = a.canvas.getContext('2d').getImageData(0, 0, a.w, a.h).data; let h = 0; for (let i = 0; i < c.length; i += 97) h = (h * 31 + c[i]) >>> 0; return h; };
    const info = m => ({ key: pet(m)?.spriteKey, fallback: pet(m)?.asset.fallback, hash: pet(m) && px(pet(m).asset) });
    // 用不合法的 key 要圖片：要被拒絕
    const bad = await window.kalos?.getSprite?.('../../etc/passwd') ?? await (await import('/src/renderer/mock-api.js')).createMockApi().getSprite('../../etc/passwd');
    return { blue: info(blue), red: info(red), polar: info(polar), heart: info(heart), bad, pets: stage.pets.size };
  });
  await shot('forms');
  check(r.pets === 4, `只有 ${r.pets} 隻出現`);
  check(r.blue.key === '669-blue', `藍花 key 是 ${r.blue.key}`);
  check(r.polar.key === '666-polar', `雪國花紋 key 是 ${r.polar.key}`);
  check(r.heart.key === '676-heart', `心形造型 key 是 ${r.heart.key}`);
  for (const k of ['blue', 'red', 'polar', 'heart']) check(r[k].fallback === false, `${k} 顯示的是替代圖`);
  check(r.blue.hash !== r.red.hash, '藍花跟紅花的圖一模一樣');
  check(r.bad === null, '不合法的圖片 key 沒有被拒絕');
  console.log(JSON.stringify(r));
});
