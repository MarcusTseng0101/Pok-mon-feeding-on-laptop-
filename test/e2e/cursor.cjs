// v3 PR 2：滑鼠變成玩具——撲過去、追游標、坐在游標旁邊（游標一動就嚇跑）
// 最重要的檢查：牠們永遠停在游標「旁邊」，不會蓋住游標讓視窗攔截你的點擊。
const { run } = require('./lib.cjs');

const holdRaf = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => (window.__holdRaf ? 0 : raf(cb));
};

async function setup(page) {
  return page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    game.chooseStarter(656);
    const m = game.state.mons[0];
    m.affection = 120; // 有感情才會玩
    m.nature = 'jolly'; // 爽朗：不膽小
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 1 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    window.__holdRaf = true;
    await new Promise(r => setTimeout(r, 100));
    director.nextSpawnAt = Infinity;
    director.updateEnv = () => {};
    Object.assign(stage.env, { sleepy: false, userActive: true, hour: 14, focus: null });
    const pet = [...stage.pets.values()][0];
    pet.x = 300; pet.gy = 500; pet.set('idle', 999);
    window.__kalos.ui.modal.classList.add('hidden'); // 歡迎視窗會讓整個畫面可以點
    return { dpr: stage.dpr };
  });
}

const test = async ({ page, shot }, check) => {
  await setup(page);
  const step = (sec, watch = false) => page.evaluate(({ sec, watch }) => {
    const { stage } = window.__kalos;
    const pet = [...stage.pets.values()][0];
    let covered = 0, grabbed = 0;
    const states = new Set();
    for (let i = 0; i < sec * 30; i++) {
      stage.update(1 / 30);
      states.add(pet.state);
      if (watch) {
        const p = stage.pointer, r = pet.rect();
        if (p.known && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) covered++;
        if (stage.wantsMouse()) grabbed++; // 這一幀會不會讓視窗攔截滑鼠
      }
    }
    return { covered, grabbed, states: [...states], state: pet.state, x: pet.x, gy: pet.gy };
  }, { sec, watch });

  // 1) 追游標：游標在遠處慢慢移動，牠追過去，但從頭到尾都不會蓋住游標
  await page.mouse.move(800, 300);
  await page.evaluate(() => { const { stage } = window.__kalos; [...stage.pets.values()][0].set('chaseCursor', 8); });
  let chase = { covered: 0, grabbed: 0 };
  for (let i = 0; i < 16; i++) {
    await page.mouse.move(800 + i * 8, 300 + (i % 4) * 6, { steps: 3 });
    const r = await step(0.5, true);
    chase.covered += r.covered; chase.grabbed += r.grabbed; chase.last = r;
  }
  const near = await page.evaluate(() => { const { stage } = window.__kalos; const p = [...stage.pets.values()][0]; return Math.hypot(p.x - stage.pointer.x, p.gy - stage.pointer.y) / stage.S; });
  check(chase.covered === 0 && chase.grabbed === 0, `追游標時蓋住游標或攔截了滑鼠：${JSON.stringify(chase)}`);
  check(near < 80, `沒有追到游標旁邊：距離 ${near}`);

  // 2) 快速晃動：牠會撲過去
  await page.evaluate(() => { const { stage } = window.__kalos; const p = [...stage.pets.values()][0]; p.x = 500; p.gy = 500; p.set('idle', 999); window.__kalos.stage.decisionLog = []; });
  let pounced = false;
  for (let i = 0; i < 60 && !pounced; i++) {
    await page.mouse.move(i % 2 ? 560 : 700, 420 + (i % 3) * 10, { steps: 2 });
    const r = await step(0.1);
    pounced = r.states.includes('pounce');
  }
  const logP = await page.evaluate(() => window.__kalos.stage.decisionLog.find(e => e.name === 'pounce'));
  check(pounced, '游標快速晃動時沒有撲過去');
  check(logP && logP.cat === 'cursor' && logP.key.startsWith('cursor.'), `撲過去沒有理由：${JSON.stringify(logP)}`);
  const land = await step(1.5, true);
  check(land.covered === 0, `撲完落在游標正下方：${JSON.stringify(land)}`);

  // 3) 游標停 9 秒：可以坐到游標旁邊；做很多次決定，一定會選到至少一次
  await page.mouse.move(640, 360);
  await page.evaluate(() => { const { stage } = window.__kalos; const p = [...stage.pets.values()][0]; p.x = 300; p.gy = 560; p.set('idle', 999); });
  await step(9);
  const sit = await page.evaluate(() => {
    const { stage } = window.__kalos;
    const pet = [...stage.pets.values()][0];
    let chosen = 0;
    for (let i = 0; i < 150; i++) {
      pet.set('idle', 999);
      pet.decide();
      if (pet.state === 'cursorSit') chosen++;
    }
    pet.cursorSit = { seated: false, side: null };
    pet.set('cursorSit', 25);
    return { still: stage.pointerStill, chosen };
  });
  check(sit.still > 8, `游標停著的時間沒有累積：${sit.still}`);
  check(sit.chosen > 0, '游標停了 9 秒，150 次決定裡一次都沒有坐過去');
  const sat = await step(6, true);
  const seated = await page.evaluate(() => { const { stage } = window.__kalos; return Boolean([...stage.pets.values()][0].cursorSit?.seated); });
  check(seated && sat.covered === 0 && sat.grabbed === 0, `沒有坐到游標旁邊，或蓋住了游標：${JSON.stringify({ seated, ...sat })}`);
  await page.evaluate(() => {
    const { stage } = window.__kalos;
    stage.draw();
    // 截圖看不到系統游標：只在截圖裡畫一個箭頭標出游標的位置
    const ctx = stage.ctx, { x, y } = stage.pointer;
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 18); ctx.lineTo(x + 5, y + 14); ctx.lineTo(x + 12, y + 13); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x + 2, y + 4); ctx.lineTo(x + 2, y + 14); ctx.lineTo(x + 5, y + 11); ctx.lineTo(x + 8, y + 11); ctx.closePath(); ctx.fill();
  });
  await shot('cursor-sit');
  // 游標一動：嚇一跳跑開，而且記得
  await page.mouse.move(660, 370);
  const after = await step(0.2);
  const mem = await page.evaluate(() => { const { stage } = window.__kalos; return [...stage.pets.values()][0].mon.memory.map(e => e.k); });
  check(after.state === 'run' && mem.includes('cursor-surprised'), `游標動了沒有嚇跑：${after.state} ${mem}`);

  // 4) 你不在電腦前：不會玩游標
  const away = await page.evaluate(() => {
    const { stage } = window.__kalos;
    stage.env.userActive = false;
    const pet = [...stage.pets.values()][0];
    let n = 0;
    for (let i = 0; i < 100; i++) { pet.set('idle', 999); pet.decide(); if (['chaseCursor', 'cursorSit', 'pounce', 'follow'].includes(pet.state)) n++; }
    return n;
  });
  check(away === 0, `使用者不在時還在玩游標 ${away} 次`);
  console.log(JSON.stringify({ chase, near, pounced, sit, seated, after: after.state }));
};
test.options = { init: holdRaf };
run('cursor', test);
