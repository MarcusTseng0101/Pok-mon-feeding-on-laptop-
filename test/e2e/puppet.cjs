// 像素木偶（gfx/rig.js）：72 隻每一隻、每一組動作都做一次，檢查：
//   - 每一格的顏色都是原圖有的（轉手、尾巴也沒有混色、沒有糊掉）
//   - 大小＝原圖＋左右各 pad、上面 pad；腳底那一列在最下面（站的位置不變）
//   - 每一組動作真的有動（至少 2 種畫面），而且跟待機不一樣
//   - 沒有被切掉一大塊：每一格的像素數跟原圖差不到 25%
//   - 做一隻全部的動作花多久（第一次看到那一隻時做，太久會卡一下）
// 另外把每一隻的每一組動作排成總表（docs/screens/puppet-1～4.png），人工一隻一隻看切得對不對
const fs = require('fs');
const path = require('path');
const { run, ROOT } = require('./lib.cjs');

const PER_SHEET = 18;

run('puppet', async ({ page }, check) => {
  const r = await page.evaluate(async (PER_SHEET) => {
    const { game, stage, ui } = window.__kalos;
    ui.modal.classList.add('hidden');
    const ids = stage.dex.ids;
    await Promise.all(ids.map(id => stage.sprites.get(id)));
    const { buildRig, SETS } = await import('/src/renderer/gfx/rig.js');
    const px = cv => cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const colors = cv => { const s = new Set(), d = px(cv); for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) s.add(`${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`); return s; };
    const count = cv => { const d = px(cv); let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; };
    const sig = cv => { const d = px(cv); let h = 0; for (let i = 0; i < d.length; i += 3) h = (h * 31 + d[i]) >>> 0; return h; };
    const bottom = cv => { const d = px(cv), y = cv.height - 1; let n = 0; for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 40) n++; return n; };
    const out = { species: [], bad: [], ms: [] };
    const rigs = [];
    for (const id of ids) {
      const still = stage.sprites.peek(id, false);
      if (still.fallback) { out.bad.push(`${id} 圖沒載到`); continue; }
      const t0 = performance.now();
      const rig = buildRig(still.canvas, { floats: stage.dex.floats(id) });
      for (const s of SETS) void rig.sets[s].frames;
      out.ms.push(performance.now() - t0);
      rigs.push([id, rig, still]);
      const base = colors(still.canvas), n0 = count(still.canvas), pad = rig.info.pad;
      const idleSigs = new Set(rig.sets.idle.frames.map(sig));
      const row = { id, parts: rig.info.parts.map(p => p.kind).join(',') || '-', legs: rig.info.hasLegs };
      if (rig.w !== still.w + pad * 2 || rig.h !== still.h + pad) out.bad.push(`${id} 大小不對 ${rig.w}x${rig.h}`);
      for (const s of SETS) {
        const fr = rig.sets[s].frames, sigs = new Set(fr.map(sig));
        let newC = 0, worst = 0;
        for (const f of fr) {
          newC += [...colors(f)].filter(k => !base.has(k)).length;
          worst = Math.max(worst, Math.abs(count(f) - n0) / n0);
        }
        if (newC) out.bad.push(`${id} ${s} 有 ${newC} 種原圖沒有的顏色`);
        if (worst > 0.25) out.bad.push(`${id} ${s} 像素數差了 ${Math.round(worst * 100)}%`);
        if (sigs.size < 2) out.bad.push(`${id} ${s} 沒有在動`);
        if (s !== 'idle' && [...sigs].every(x => idleSigs.has(x))) out.bad.push(`${id} ${s} 跟待機一模一樣`);
        if (s === 'idle' && fr.some(f => bottom(f) === 0)) out.bad.push(`${id} 待機時腳離開地面`);
      }
      out.species.push(row);
    }
    // 總表：每一列一隻，每一組動作放第 1 格和中間那格
    const cols = SETS.flatMap(s => [[s, 0], [s, 0.5]]);
    out.sheets = [];
    for (let k = 0; k < rigs.length; k += PER_SHEET) {
      const chunk = rigs.slice(k, k + PER_SHEET);
      const cw = Math.max(...chunk.map(([, r]) => r.w)) + 4, ch = Math.max(...chunk.map(([, r]) => r.h)) + 4;
      const c = document.createElement('canvas');
      c.width = 40 + cols.length * cw; c.height = 16 + chunk.length * ch;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.fillStyle = '#e8f0e0'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#333'; g.font = '10px sans-serif';
      cols.forEach(([s, f], i) => { if (!f) g.fillText(s, 40 + i * cw, 11); });
      chunk.forEach(([id, rig], j) => {
        const y = 16 + j * ch;
        g.fillText(String(id), 4, y + ch / 2);
        cols.forEach(([s, f], i) => {
          const fr = rig.sets[s].frames, cv = fr[Math.floor(f * fr.length)];
          if (i % 2 === 0) { g.fillStyle = i % 4 ? '#dde8d4' : '#e8f0e0'; g.fillRect(40 + i * cw, y, cw * 2, ch); }
          g.drawImage(cv, 40 + i * cw + 2, y + ch - 2 - cv.height);
        });
      });
      out.sheets.push(c.toDataURL('image/png'));
    }
    return out;
  }, PER_SHEET);
  // 真的用滑鼠：按住寶可夢拖起來 → 播「被拎著」；放開掉下來、站好 → 回到待機
  const p0 = await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    game.chooseStarter(650);
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 1 && Date.now() - t0 < 15000) await new Promise(res => setTimeout(res, 50));
    director.nextSpawnAt = Infinity; director.updateEnv = () => {}; game.canDepart = () => false;
    const p = [...stage.pets.values()][0];
    p.x = 500 * stage.dpr; p.gy = 450 * stage.dpr; p.set('idle', 999);
    const rc = p.rect();
    return { x: (rc.x + rc.w / 2) / stage.dpr, y: (rc.y + rc.h * 0.6) / stage.dpr };
  });
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(p0.x + i * 4, p0.y - i * 12); await page.waitForTimeout(30); }
  const held = await page.evaluate(() => { const p = [...window.__kalos.stage.pets.values()][0]; return { state: p.state, set: p.animSet(), same: p.view?.set === p.view?.anim.sets.dangle }; });
  await page.mouse.up();
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => { const p = [...window.__kalos.stage.pets.values()][0]; return { state: p.state, set: p.animSet() }; });
  console.log(JSON.stringify({ held, after }));
  check(held.state === 'held' && held.set === 'dangle' && held.same, `拎起來應該播「被拎著」：${JSON.stringify(held)}`);
  check(after.set !== 'dangle', `放下以後還在播「被拎著」：${JSON.stringify(after)}`);
  r.sheets.forEach((d, i) => fs.writeFileSync(path.join(ROOT, 'docs/screens', `puppet-${i + 1}.png`), Buffer.from(d.split(',')[1], 'base64')));
  const ms = r.ms.slice().sort((a, b) => a - b), withParts = r.species.filter(s => s.parts !== '-').length;
  console.log(`${r.species.length} 隻；有找到手／尾巴／耳朵的 ${withParts} 隻；做全部動作的時間 中位數 ${ms[ms.length >> 1].toFixed(1)} ms、最慢 ${ms[ms.length - 1].toFixed(1)} ms`);
  console.log(r.species.map(s => `${s.id}:${s.parts}`).join(' '));
  check(r.species.length === 72, `應該 72 隻都做得出來：${r.species.length}`);
  check(!r.bad.length, r.bad.slice(0, 8).join('；'));
  check(withParts >= 50, `找到會動的部位的太少：${withParts} 隻`); // 猜的，可調整
  check(ms[ms.length - 1] < 400, `做一隻太久：${ms[ms.length - 1].toFixed(0)} ms`); // 猜的，可調整
});
