// 回歸測試：碰撞與擊退。自由活動 4 分鐘（模擬時間）不能有深度重疊、不能跑出螢幕；
// 丟出去的會把別隻撞開；重的撞輕的，輕的飛比較遠
const { run } = require('./lib.cjs');

run('physics', async ({ page }, check) => {
  const r = await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    const M = await import('/src/renderer/scene/moves.js');
    game.chooseStarter(653);
    for (const id of [713, 659, 700, 701, 668]) { const m = game.createMon(id, {}); m.affection = 200; m.out = true; game.state.mons.push(m); }
    // 這裡只測碰撞：不讓牠們出門旅行（出門的會從桌面上消失，下面拿舊的 pets 陣列算距離就會算錯）
    game.canDepart = () => false;
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 6 && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
    const pets = [...stage.pets.values()];
    const P = Object.fromEntries(pets.map(p => [p.mon.species, p]));
    const reset = () => { for (const q of pets) { q.set('idle', 99); q.partner = null; q.group = null; q.duel = null; q.habit = null; q.moveCtx = null; q.z = 0; q.kvx = q.kvy = 0; q.vx = q.vy = 0; } };
    const nd = (a, b) => { const rx = (a.asset.w + b.asset.w) * 0.35 * stage.S, ry = rx * 0.45; return Math.hypot((b.x - a.x) / rx, (b.gy - a.gy) / ry); };
    const out = {};
    // 全部疊在同一點 → 被推開
    reset();
    for (const q of pets) { q.x = 600 + Math.random(); q.gy = 450; }
    for (let f = 0; f < 60; f++) stage.update(0.05);
    let min = 9;
    for (let i = 0; i < pets.length; i++) for (let j = i + 1; j < pets.length; j++) if (!pets[i].floats && !pets[j].floats) min = Math.min(min, nd(pets[i], pets[j]));
    out.stackedMin = min;
    // 撞球：丟出去的火狐狸把掘掘兔撞開
    reset();
    const a = P[653], b = P[659];
    a.x = 300; a.gy = 450; b.x = 520; b.gy = 452;
    for (const q of pets) if (q !== a && q !== b) { q.x = 1100; q.gy = 150 + Math.random() * 400; }
    a.vx = 1400; a.vy = 0; a.vz = 0; a.set('fall');
    const bx = b.x;
    for (let f = 0; f < 40; f++) stage.update(0.05);
    out.billiard = b.x - bx;
    // 重的撞輕的 vs 輕的撞重的
    reset();
    const av = P[713], fk = P[653];
    av.x = 300; av.gy = 300; fk.x = 500; fk.gy = 300; av.vx = 1400; av.vy = 0; av.set('fall');
    let x0 = fk.x; for (let f = 0; f < 40; f++) stage.update(0.05);
    out.heavyHitsLight = fk.x - x0;
    reset();
    av.x = 500; av.gy = 300; fk.x = 300; fk.gy = 300; fk.vx = 1400; fk.vy = 0; fk.set('fall');
    x0 = av.x; for (let f = 0; f < 40; f++) stage.update(0.05);
    out.lightHitsHeavy = av.x - x0;
    // 自由活動 4 分鐘
    reset();
    for (const q of pets) { q.x = 200 + Math.random() * 900; q.gy = 200 + Math.random() * 450; q.set('idle', Math.random() * 2); }
    let deep = 0, oob = 0;
    for (let f = 0; f < 240 * 20; f++) {
      stage.update(0.05);
      for (const q of pets) { const rc = q.rect(); if (!Number.isFinite(q.x + q.gy) || rc.y < -3 || q.gy > stage.H + 2) oob++; }
      for (let i = 0; i < pets.length; i++) for (let j = i + 1; j < pets.length; j++) {
        const x = pets[i], y = pets[j];
        if (stage.pets.get(x.uid) !== x || stage.pets.get(y.uid) !== y) continue; // 已經不在桌面上
        if (x.floats || y.floats || x.state === 'held') continue;
        const exempt = x.partner === y || y.partner === x || x.hidden || y.hidden || ['habit', 'dig'].includes(x.state) || ['habit', 'dig'].includes(y.state);
        if (!exempt && nd(x, y) < 0.6) deep++;
      }
    }
    out.deep = deep;
    out.oob = oob;
    // 貼著螢幕邊緣疊在一起：推不動的那一邊由另一隻多退，1 幀內分開
    reset();
    const [e1, e2] = [P[653], P[659]];
    for (const q of pets) if (q !== e1 && q !== e2) { q.x = 200; q.gy = 200 + Math.random() * 300; }
    out.edge = {};
    for (const [name, place] of [['bottom', b => [600, b.y1, 601, b.y1 - 3]], ['corner', b => [b.x0, b.y1, b.x0 + 3, b.y1 - 3]], ['right', b => [b.x1, 400, b.x1, 404]]]) {
      const [x1, y1, x2, y2] = place(e1.bounds());
      e1.x = x1; e1.gy = y1; e2.x = x2; e2.gy = y2;
      let f = 0;
      for (; f < 30 && nd(e1, e2) < 0.95; f++) stage.update(0.05);
      out.edge[name] = f;
    }
    // 靠近上緣使出會跳起來的招式（飛身重壓）：頭不能跑出螢幕
    reset();
    const hw = P[701], tg = P[668];
    let topOut = 0;
    for (let rep = 0; rep < 3; rep++) {
      hw.set('idle', 99); tg.set('idle', 99);
      hw.x = 400; hw.gy = hw.bounds().y0; tg.x = 520; tg.gy = hw.gy;
      M.useMove(hw, 'flyingpress', tg);
      for (let f = 0; f < 40; f++) { stage.update(0.05); if (hw.rect().y < -3) topOut++; }
    }
    out.topOut = topOut;
    return out;
  });
  console.log(JSON.stringify(r));
  check(r.stackedMin >= 0.9, `疊在一起後沒有被推開（最近距離 ${r.stackedMin.toFixed(2)}）`);
  check(r.billiard > 80, `丟出去撞到的只移動了 ${Math.round(r.billiard)}px`);
  check(r.heavyHitsLight > r.lightHitsHeavy * 2, `重的撞輕的（${Math.round(r.heavyHitsLight)}px）應該遠大於輕的撞重的（${Math.round(r.lightHitsHeavy)}px）`);
  check(r.deep === 0, `自由活動時深度重疊 ${r.deep} 幀`);
  check(r.oob === 0, `跑出螢幕 ${r.oob} 次`);
  for (const [k, f] of Object.entries(r.edge)) check(f <= 2, `貼著${k}邊疊在一起，${f} 幀才分開`);
  check(r.topOut === 0, `在上緣跳起來，頭跑出螢幕 ${r.topOut} 幀`);
});
