// PR 4：站在視窗上（失敗模式 7：站在頂邊上的和地上的不能互相推擠）
const { run } = require('./lib.cjs');

const WIN = { hwnd: '101', x: 320, y: 300, w: 640, h: 330 };

run('perch', async ({ page, shot }, check) => {
  const r = await page.evaluate(async WIN => {
    const { game, director, stage, api } = window.__kalos;
    const P = await import('/src/renderer/scene/perching.js');
    game.chooseStarter(653);
    for (const id of [656, 659, 700, 668, 713]) { const m = game.createMon(id, {}); m.affection = 120; m.out = true; game.state.mons.push(m); }
    director.syncPets();
    director.nextSpawnAt = Infinity;
    const t0 = Date.now();
    while (stage.pets.size < 6 && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
    api.emit('windows', [WIN]);
    const pets = [...stage.pets.values()];
    const yieldNow = () => new Promise(r => setTimeout(r, 0));
    const run = async (frames, each) => { for (let f = 0; f < frames; f++) { stage.update(0.05); each?.(f); if (f % 20 === 0) await yieldNow(); } };
    const out = {};
    out.ledges = stage.ledges.map(l => [l.x0, l.x1, l.y]);

    // 1) 兩隻跳上去（一隻用走的、一隻會飄）
    const up = [pets[0], pets[3]]; // 火狐狸、仙子伊布
    const ground = pets.filter(p => !up.includes(p));
    // 地上的先坐著不動：別隻的習性（超音波讓大家發抖…）會打斷正在跳的那一隻，那是正常的，但這裡要測的是跳上去本身
    for (const p of ground) p.set('sit', 999);
    const l = stage.ledges[0];
    const spotsX = [l.x0 + (l.x1 - l.x0) * 0.35, l.x0 + (l.x1 - l.x0) * 0.65];
    up.forEach((p, i) => { p.set('idle', 1); P.startPerch(p, l, spotsX[i]); });
    const landedOnce = new Set();
    for (let f = 0; f < 400 && landedOnce.size < 2; f++) {
      stage.update(0.05);
      for (const p of up) if (p.perch && !landedOnce.has(p)) { landedOnce.add(p); p.set('sit', 999); } // 站上去就先坐好（不然牠可能自己又跳下來）
      if (f % 20 === 0) await yieldNow();
    }
    out.perched = up.map(p => landedOnce.has(p));
    out.upInfo = up.map(p => [p.mon.species, p.state, Math.round(p.x), Math.round(p.gy), p.perchJump?.phase ?? null, Math.round(p.stateT * 10) / 10]);
    // 地上的擠到視窗頂邊的正下方，逼它們跟上面的靠得很近
    for (const g of ground) { g.x = l.x0 + Math.random() * (l.x1 - l.x0); g.gy = Math.min(g.bounds().y1, l.y + 10 * stage.S); g.set('idle', 2); }
    await run(10); // 剛剛是直接把牠們搬過去的（瞬間移動會疊在一起），先讓碰撞推開再開始算

    // 2) 自由活動 60 秒：站在上面的不能被推離頂邊；同一層不能深度重疊
    let offLedge = 0, deep = 0, crossLayer = 0;
    const nd = (a, b) => { const rx = (a.asset.w + b.asset.w) * 0.35 * stage.S, ry = rx * 0.45; return Math.hypot((b.x - a.x) / rx, (b.gy - a.gy) / ry); };
    await run(1200, () => {
      for (const p of up) {
        if (!p.perch) continue;
        const cur = stage.ledges.find(x => x.hwnd === p.perch.hwnd);
        if (!cur || Math.abs(p.gy - cur.y) > 0.5 || p.x < cur.x0 - 1 || p.x > cur.x1 + 1) offLedge++;
      }
      for (let i = 0; i < pets.length; i++) for (let j = i + 1; j < pets.length; j++) {
        const a = pets[i], b = pets[j];
        if ((a.perch?.hwnd ?? null) !== (b.perch?.hwnd ?? null)) continue;
        if (a.floats || b.floats || a.partner === b || b.partner === a || ['habit', 'dig', 'perchUp', 'fall'].includes(a.state) || ['habit', 'dig', 'perchUp', 'fall'].includes(b.state) || a.hidden || b.hidden) continue;
        if (nd(a, b) < 0.6) { deep++; (out.deepInfo ??= []).length < 6 && out.deepInfo.push([a.mon.species, a.state, Boolean(a.perch), b.mon.species, b.state, Boolean(b.perch), nd(a, b).toFixed(2), Math.round(a.x), Math.round(a.gy), Math.round(b.x), Math.round(b.gy), a.z.toFixed(1), b.z.toFixed(1)].join(' ')); }
      }
      // 站在上面的只在頂邊上走來走去（不讓牠自己跳下來），這段只測「會不會被推下去」
      for (const p of up) if (p.perch && p.state !== 'walk') { const b = p.bounds(); p.target = { x: b.x0 + Math.random() * (b.x1 - b.x0), y: b.y0 }; p.set('walk'); }
    });
    out.offLedge = offLedge;
    out.deep = deep;
    out.stillUp = up.filter(p => p.perch).length;

    // 畫面：畫一個假的視窗在後面，拍照用
    for (const p of up) if (!p.perch) { P.startPerch(p, stage.ledges[0], p.x); }
    await run(200);
    out.beforeShot = up.map(p => Boolean(p.perch));
    for (const p of up) if (p.perch) p.set('sit', 999); // 拍照時真的畫面還在跑：先坐好，不要自己跳下來
    window.__up = up;
    return out;
  }, WIN);
  // 截圖：在畫面後面畫一個假的視窗
  await page.evaluate(W => {
    const d = document.createElement('div');
    d.id = 'fakewin';
    Object.assign(d.style, { position: 'fixed', left: `${W.x}px`, top: `${W.y}px`, width: `${W.w}px`, height: `${W.h}px`, background: '#f4f6fa', border: '1px solid #9aa4b8', boxShadow: '0 6px 24px rgba(0,0,0,.25)', zIndex: '-1' });
    d.innerHTML = '<div style="height:32px;background:#e3e8f2;border-bottom:1px solid #c8d0de;font:13px sans-serif;line-height:32px;padding-left:12px;color:#445">記事本</div>';
    document.body.prepend(d);
  }, WIN);
  await page.waitForTimeout(300);
  await shot('perch');

  const r2 = await page.evaluate(async WIN => {
    const { stage, api } = window.__kalos;
    const pets = [...stage.pets.values()];
    const up = window.__up; // 跟前半段同樣的兩隻
    const out = {};
    const yieldNow = () => new Promise(r => setTimeout(r, 0));
    const P0 = await import('/src/renderer/scene/perching.js');
    for (const p of pets) if (!up.includes(p)) p.set('sit', 999); // 同上：地上的先不要打擾
    for (const p of up) if (!p.perch) { p.set('idle', 1); P0.startPerch(p, stage.ledges[0], Math.max(stage.ledges[0].x0 + 60, Math.min(stage.ledges[0].x1 - 60, p.x))); }
    for (let f = 0; f < 600 && up.some(p => !p.perch); f++) {
      stage.update(0.05);
      for (const p of up) if (p.perch && p.state !== 'sit') p.set('sit', 999);
      if (f % 20 === 0) await yieldNow();
    }
    // 3) 視窗慢慢移動：跟著走（每 0.25 秒移 5 CSS 像素 = 20 px/s）。先讓牠們坐著不動，才量得出來
    for (const p of up) p.set('sit', 999);
    const x0 = up.map(p => p.x);
    let w = { ...WIN };
    for (let k = 0; k < 8; k++) {
      w = { ...w, x: w.x + 5 };
      await new Promise(r => setTimeout(r, 250));
      api.emit('windows', [w]);
      for (let f = 0; f < 5; f++) stage.update(0.05);
    }
    out.followed = up.map((p, i) => Math.round(p.x - x0[i]));
    out.stillUp = up.filter(p => p.perch).length;
    // 4) 視窗被很快地拖走：甩下來
    await new Promise(r => setTimeout(r, 100));
    api.emit('windows', [{ ...w, x: w.x + 300 }]);
    out.afterFling = up.map(p => [Boolean(p.perch), p.state]);
    let landed = false;
    for (let f = 0; f < 200; f++) { stage.update(0.05); if (up.every(p => !p.perch && p.state !== 'fall')) { landed = true; break; } if (f % 20 === 0) await yieldNow(); }
    out.landed = landed;
    // 5) 再跳上去，然後關掉視窗
    const P = P0;
    api.emit('windows', [WIN]);
    const L = stage.ledges[0];
    up.forEach((p, i) => { p.set('idle', 1); P.startPerch(p, L, L.x0 + (L.x1 - L.x0) * (i ? 0.7 : 0.3)); });
    for (let f = 0; f < 600 && up.some(p => !p.perch); f++) {
      stage.update(0.05);
      for (const p of up) if (p.perch && p.state !== 'sit') p.set('sit', 999); // 站上去就坐好
      if (f % 20 === 0) await yieldNow();
    }
    for (const p of up) if (p.perch) p.set('sit', 999);
    out.reperched = up.filter(p => p.perch).length;
    api.emit('windows', []);
    out.afterClose = up.filter(p => p.perch).length;
    for (let f = 0; f < 100; f++) stage.update(0.05);
    for (const p of pets) p.set('idle', 1); // 接下來測「自己跳上去」：大家自由活動
    // 6) 自己跳上去：有視窗的時候，自由活動 6 分鐘，至少會有一隻自己跳上去（權重低；3 分鐘大約有 3% 的機會一隻都沒有）
    api.emit('windows', [WIN]);
    // 固定成白天：半夜（1–6 點）大家都在睡覺，本來就不會跳上視窗（測試不能看真的時鐘）
    window.__kalos.director.updateEnv = () => {};
    Object.assign(stage.env, { sleepy: false, userActive: true, hour: 14 });
    const before = window.__kalos.game.state.stats.perches;
    out.candidates = pets.map(p => P.perchCandidates(p).length);
    for (let f = 0; f < 6 * 60 * 20; f++) { stage.update(0.05); if (f % 40 === 0) await yieldNow(); }
    out.natural = window.__kalos.game.state.stats.perches - before;
    return out;
  }, WIN);

  console.log(JSON.stringify({ ...r, ...r2 }));
  check(r.ledges.length === 1, `應該有一條頂邊：${JSON.stringify(r.ledges)}`);
  check(r.perched.every(Boolean), `沒有跳上去：${r.perched} ${JSON.stringify(r.upInfo)}`);
  check(r.offLedge === 0, `站在頂邊上的被推離頂邊 ${r.offLedge} 次`);
  check(r.deep === 0, `同一層深度重疊 ${r.deep} 幀：${JSON.stringify(r.deepInfo)}`);
  check(r2.stillUp === 2 && r2.followed.every(d => d >= 30 && d <= 50), `視窗慢慢移動時沒有跟著走：${r2.followed}（應該約 40）`);
  check(r2.afterFling.every(([perched, state]) => !perched && (state === 'fall' || state === 'walk')), `視窗被甩開時沒有掉下來：${JSON.stringify(r2.afterFling)}`);
  check(r2.landed, '掉下來之後沒有落地');
  check(r2.reperched === 2 && r2.afterClose === 0, `關掉視窗時沒有掉下來：${r2.reperched} → ${r2.afterClose}`);
  check(r2.natural >= 1, `6 分鐘內沒有任何一隻自己跳上視窗（${r2.natural}，可以站的頂邊：${r2.candidates}）`);
});
