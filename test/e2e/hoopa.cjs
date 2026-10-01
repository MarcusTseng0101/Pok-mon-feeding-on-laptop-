// 胡帕用圓環把夥伴送到別的地方：胡帕指著附近的夥伴 → 夥伴身上開一個圓環、淡出 → 從另一個地方的圓環淡入 → 嚇一跳、左右看
//   送到一半真的用滑鼠把夥伴拎起來：不會卡在半透明、不會兩隻的 partner 留著
const { run } = require('./lib.cjs');

const test = async ({ page, shot }, check) => {
  await page.waitForSelector('.modal .starter [data-id="650"]', { timeout: 20000 });
  await page.click('.modal .starter [data-id="650"]');
  await page.waitForFunction(() => window.__kalos.game.state.starterChosen, null, { timeout: 10000 });
  await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    const m = game.createMon(720); m.out = true; game.state.mons.push(m);
    director.syncPets();
    const t0 = Date.now();
    while (![...stage.pets.values()].some(p => p.mon.species === 720 && p.state !== 'appear') && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    game.canDepart = () => false; director.nextSpawnAt = Infinity; director.updateEnv = () => {};
    Object.assign(stage.env, { sleepy: false, userActive: true, hour: 14, focus: null });
  });
  // 準備狀況：胡帕和哈力栗站近一點，胡帕開始「用圓環把夥伴送走」（社交習性的入口 begin，跟遊戲裡挑中時一樣）
  const send = () => page.evaluate(async () => {
    const { stage } = window.__kalos;
    const { HABITS } = await import('/src/renderer/scene/habits.js');
    const h = [...stage.pets.values()].find(p => p.mon.species === 720), c = [...stage.pets.values()].find(p => p.mon.species === 650);
    h.x = stage.W * 0.45; h.gy = stage.H * 0.6; c.x = stage.W * 0.6; c.gy = stage.H * 0.6; c.partner = null; h.partner = null;
    c.set('idle', 999); h.set('idle', 999);
    HABITS.ringSend.begin(h, c);
    return { from: { x: c.x, y: c.gy }, to: c.hd.to };
  });
  const look = () => page.evaluate(() => {
    const { stage } = window.__kalos, h = [...stage.pets.values()].find(p => p.mon.species === 720), c = [...stage.pets.values()].find(p => p.mon.species === 650);
    const k = c.state === 'habit' && c.dur ? c.stateT / c.dur : null;
    return { hoopa: h.state === 'habit' ? h.habitName : h.state, guest: c.state === 'habit' ? c.habitName : c.state, k, alpha: c.act?.alpha?.(c) ?? 1, x: c.x, y: c.gy, partners: [Boolean(h.partner), Boolean(c.partner)] };
  });

  const start = await send();
  const seen = [];
  let shotIn = false, shotOut = false;
  // 等到送完（最多 10 秒；機器忙的時候一輪 100 毫秒會變慢，不能用固定次數）
  const t0 = Date.now();
  for (let i = 0; Date.now() - t0 < 10000; i++) {
    const s = await look(); seen.push(s);
    if (!shotIn && s.k > 0.25 && s.k < 0.42) { shotIn = true; await shot('hoopa-ring-in'); }
    if (!shotOut && s.k > 0.6 && s.k < 0.8) { shotOut = true; await shot('hoopa-ring-out'); }
    if (s.guest !== 'ringed' && i > 2) break;
    await page.waitForTimeout(100);
  }
  const during = seen.filter(s => s.guest === 'ringed');
  check(during.length && during[0].hoopa === 'ringCast', `胡帕沒有在施法：${JSON.stringify(seen.slice(0, 3))}`);
  check(during.some(s => s.alpha === 0), '被送走的中間沒有消失（淡出）');
  const end = seen.at(-1);
  const moved = Math.hypot(end.x - start.from.x, end.y - start.from.y);
  check(moved > 150, `沒有被送到別的地方：只移動了 ${Math.round(moved)}`);
  check(end.guest === 'look' && end.alpha === 1, `出來以後應該左右看、看得見：${JSON.stringify(end)}`);
  await page.waitForTimeout(600);
  const after = await look();
  check(!after.partners[0] && !after.partners[1], `送完以後 partner 還留著：${JSON.stringify(after)}`);

  // 送到一半（還看得見、還沒被吸進去的時候）真的用滑鼠把哈力栗拎起來
  await send();
  const pt = await page.evaluate(() => {
    const { stage } = window.__kalos, c = [...stage.pets.values()].find(p => p.mon.species === 650), r = c.rect(), d = stage.dpr;
    for (let v = 0.6; v < 0.95; v += 0.05) for (const u of [0.5, 0.45, 0.55, 0.4, 0.6]) { const x = r.x + r.w * u, y = r.y + r.h * v; if (stage.petAt(x, y) === c) return { x: x / d, y: y / d }; }
    return null;
  });
  check(pt, '點不到哈力栗');
  if (pt) {
    await page.mouse.move(pt.x, pt.y); await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(pt.x + i * 4, pt.y - i * 8); await page.waitForTimeout(30); }
    const held = await look();
    check(held.guest === 'held', `拎不起來：${JSON.stringify(held)}`);
    await page.mouse.up();
  }
  await page.waitForTimeout(3500);
  const free = await look();
  check(free.alpha === 1 && free.guest !== 'ringed' && !free.partners[0] && !free.partners[1], `被拎起來以後卡住了：${JSON.stringify(free)}`);
  console.log(JSON.stringify({ start, moved: Math.round(moved), end, after, free }));
};

run('hoopa', test);
