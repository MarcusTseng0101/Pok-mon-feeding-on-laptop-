// 每一招都不一樣：用「畫面指紋」檢查任兩招只看畫面就分得出來（規格：每招獨一無二）
//   1. 每一招放的時候，在 10/25/40/55/70/85% 的時間截兩隻中間那一塊，減掉放招前的畫面（背景、夥伴本來的樣子不算），
//      只留「亮度」和「不透明度」（不看顏色：同一個動作換顏色＝換皮，要抓得到），縮成 16×8 格 → 這一招的指紋
//   2. 尺：同一招用兩個不同的亂數種子各跑一次，兩次的距離＝這招自己的晃動；全部招裡最大的那個就是尺
//   3. 過關：每一招（已經有自己演出的，CHOREO）跟最像的另一招的距離 ≥ 尺 × RATIO
//   4. 每一招都有自己的演出物件（沒有兩招共用）；這次要做完的屬性每一招都在 CHOREO 裡
//   5. 接觸表：每招一排、6 格，存到 docs/screens/moves-<屬性>.png
// MOVEPRINT_ALL=1：62 招全部都要過（用來確認舊的動畫會被抓到）
// MOVEPRINT_SHEETS=<資料夾>：所有屬性的接觸表都存到那個資料夾（改之前的樣子，不進 repo）
const fs = require('node:fs');
const path = require('node:path');
const { run, ROOT } = require('./lib.cjs');

const RATIO = 2; // 猜的，可調整（但只能在第一次量舊動畫之前決定，之後不改）
const SEEDS = [11, 29];
const OLD_RULER = 1.162; // 舊的 62 招量到的尺（蒸汽爆炸；等會動的圖載好以後重新量的，一樣 56 招不過）；新的尺超過它 1.5 倍＝有招的形狀大部分靠亂數，停下來看
const DONE_TYPES = ['water', 'fire', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock']; // 這個 PR 要做完的屬性
// 使用者同意的例外（只在 old 還沒有自己的演出時才算；old 重做以後自動失效，要重新比）：
//   尖刺防守 vs 5 個舊的「自己用」招（反射壁、蝶舞、王者盾牌、妖精之鎖、大地掌控，1.80–1.83 倍）：這 5 招現在是同一個舊演出，
//   形狀完全不同（刺藤半圓頂 vs 彩色圈圈），近是因為都在自己身上放、周圍一樣變暗。這 5 招在 PR③、PR④ 重做
const EXEMPT = ['reflect', 'quiverdance', 'kingsshield', 'fairylock', 'geomancy'].map(old => ['spikyshield', old]);
const GROUPS = {
  'water-fire-grass': ['water', 'fire', 'grass'],
  'electric-ice-fighting-poison-ground-flying': ['electric', 'ice', 'fighting', 'poison', 'ground', 'flying'],
  'psychic-bug-rock-ghost-steel-dragon': ['psychic', 'bug', 'rock', 'ghost', 'steel', 'dragon'],
  'normal-dark-fairy': ['normal', 'dark', 'fairy'],
};

// 固定種子的 Math.random（招式的特效用的是 Math.random，不是 game.rng）
const seeded = () => {
  let s = 1;
  window.__reseed = n => { s = (n >>> 0) || 1; };
  Math.random = () => {
    s = (s ^ (s << 13)) >>> 0; s = (s ^ (s >>> 17)) >>> 0; s = (s ^ (s << 5)) >>> 0;
    return s / 4294967296;
  };
};

const test = async ({ page }, check) => {
  const r = await page.evaluate(async ({ SEEDS, GROUPS }) => {
    const { game, director, stage, ui } = window.__kalos;
    const M = await import('/src/renderer/scene/moves.js');
    window.__reseed(7); // 載入時用掉幾個亂數不一定：建立夥伴（色違、大小…）之前先固定
    game.chooseStarter(653);
    const m = game.createMon(650); m.out = true; game.state.mons.push(m);
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 2 && Date.now() - t0 < 15000) await new Promise(res => setTimeout(res, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity; director.updateEnv = () => {};
    game.canDepart = () => false;
    Object.assign(stage.env, { sleepy: false, userActive: false, hour: 14, focus: null });
    const [a, b] = [...stage.pets.values()];
    // 會動的圖是非同步載入的：等兩隻的都載好再量（不然有時候量到不會動的圖）
    const t1 = Date.now();
    while (![a, b].every(p => stage.sprites.peekAnim?.(p.spriteKey, p.mon.shiny)) && Date.now() - t1 < 10000) await new Promise(res => setTimeout(res, 50));
    const animated = [a, b].map(p => Boolean(stage.sprites.peekAnim?.(p.spriteKey, p.mon.shiny)));
    const dpr = stage.dpr;
    const place = () => {
      stage.fx.parts = []; stage.stopT = 0; stage.shakeT = 0; stage.dimFx = null;
      stage.clock = 0; stage.lastBump = new Map(); // 碰撞的冷卻看舞台時間：頁面開了多久不一定，每招都從 0 開始
      for (const p of [a, b]) {
        p.set('idle', 999); p.moveCtx = null; p.kvx = p.kvy = 0; p.vx = p.vy = p.vz = 0; p.z = 0; p.t = 0; p.walkPhase = 0; p.hopT = 0; p.animT = 0; p.view = null; p.lastPos = null; // 播放位置也從頭開始
        p.flinchT = 0; p.flipT = 0; p.squashT = 0; p.moveAlpha = 1;
      }
      a.x = 400 * dpr; a.gy = 450 * dpr; b.x = 700 * dpr; b.gy = 450 * dpr; a.facing = 1; b.facing = -1;
    };
    // 兩隻中間那一塊
    const X0 = 280 * dpr, Y0 = 230 * dpr, W = 540 * dpr, H = 240 * dpr, GX = 16, GY = 8;
    const cx = stage.canvas.getContext('2d');
    const grab = () => {
      const sk = stage.shakeT; stage.shakeT = 0; stage.draw(); stage.shakeT = sk; // 震動是大家共用的，不算進形狀
      const d = cx.getImageData(X0, Y0, W, H).data, out = new Float64Array(GX * GY * 2), n = new Float64Array(GX * GY);
      for (let y = 0; y < H; y++) {
        const gy = Math.floor((y * GY) / H);
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4, c = gy * GX + Math.floor((x * GX) / W), al = d[i + 3] / 255;
          out[c * 2] += ((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255) * al;
          out[c * 2 + 1] += al;
          n[c]++;
        }
      }
      for (let c = 0; c < GX * GY; c++) { out[c * 2] /= n[c]; out[c * 2 + 1] /= n[c]; }
      return out;
    };
    const FR = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85];
    const CW = 180, CH = 80, LW = 110;
    const ids = Object.keys(M.MOVES);
    const sheets = {};
    for (const [g, types] of Object.entries(GROUPS)) {
      const list = ids.filter(id => types.includes(M.MOVES[id].type));
      const c = document.createElement('canvas');
      c.width = LW + CW * FR.length; c.height = CH * list.length;
      const s = c.getContext('2d');
      s.fillStyle = '#34424f'; s.fillRect(0, 0, c.width, c.height);
      s.font = '16px sans-serif'; s.textBaseline = 'middle';
      sheets[g] = { c, s, list };
    }
    const sheetOf = id => Object.values(sheets).find(x => x.list.includes(id));
    const prints = {};
    for (const id of ids) {
      prints[id] = [];
      for (const seed of SEEDS) {
        place();
        window.__reseed(seed);
        for (let i = 0; i < 3; i++) stage.update(1 / 30);
        const base = grab();
        M.useMove(a, id, b, { announce: false });
        const dur = a.moveCtx.tl.dur;
        const fp = []; // 6 張指紋攤平接在一起
        let k = 0; // 截了幾張
        const sh = seed === SEEDS[0] ? sheetOf(id) : null, row = sh ? sh.list.indexOf(id) : -1; // 第一個種子畫進接觸表
        for (let i = 0; i < 300 && k < FR.length; i++) {
          stage.update(1 / 30);
          while (k < FR.length && (!a.moveCtx || a.stateT >= FR[k] * dur)) {
            const g = grab();
            for (let j = 0; j < g.length; j++) fp.push(g[j] - base[j]);
            if (sh) sh.s.drawImage(stage.canvas, X0, Y0, W, H, LW + CW * k, CH * row, CW, CH);
            k++;
          }
        }
        prints[id].push(Array.from(fp));
        if (sh) { sh.s.fillStyle = '#ffffff'; sh.s.fillText(M.MOVES[id].zh, 8, CH * row + CH / 2); }
      }
      place();
    }
    const choreo = Object.keys(M.CHOREO);
    const distinct = new Set(choreo.map(id => M.CHOREO[id])).size;
    const types = Object.fromEntries(ids.map(id => [id, M.MOVES[id].type]));
    const out = {};
    for (const [g, x] of Object.entries(sheets)) out[g] = x.c.toDataURL('image/png');
    return { prints, choreo, distinct, types, sheets: out, animated };
  }, { SEEDS, GROUPS });

  check(r.animated.every(Boolean), `會動的圖沒有載好：${r.animated}`);
  const ids = Object.keys(r.prints);
  const dist = (u, v) => { let s = 0; for (let i = 0; i < u.length; i++) s += (u[i] - v[i]) ** 2; return Math.sqrt(s); };
  const self = Object.fromEntries(ids.map(id => [id, dist(r.prints[id][0], r.prints[id][1])]));
  const ruler = Math.max(...Object.values(self));
  const rulerId = ids.find(id => self[id] === ruler);
  // 兩招之間的距離：兩個種子交叉比，取最近的（對「剛好很像的那一次」也要分得開）
  const pair = (x, y) => Math.min(...r.prints[x].flatMap(u => r.prints[y].map(v => dist(u, v))));
  const pairs = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push({ a: ids[i], b: ids[j], d: pair(ids[i], ids[j]) });
  pairs.sort((p, q) => p.d - q.d);
  const exempt = p => EXEMPT.some(([n, old]) => !r.choreo.includes(old) && ((p.a === n && p.b === old) || (p.a === old && p.b === n)));
  const used = pairs.filter(exempt);
  if (used.length) console.log('例外（舊招還沒重做）：', used.map(p => `${p.a}/${p.b}:${(p.d / ruler).toFixed(2)}`).join(' '));
  if (process.env.MOVEPRINT_NEAR) for (const id of process.env.MOVEPRINT_NEAR.split(',')) console.log(id, pairs.filter(p => p.a === id || p.b === id).slice(0, 8).map(p => `${p.a === id ? p.b : p.a}:${(p.d / ruler).toFixed(2)}`).join(' '));
  const nearest = id => pairs.filter(p => (p.a === id || p.b === id) && !exempt(p))[0];
  const need = process.env.MOVEPRINT_ALL ? ids : r.choreo;
  const close = need.map(id => ({ id, ...nearest(id) })).filter(x => x.d < ruler * RATIO);
  const fmt = p => `${p.a}/${p.b}:${(p.d / ruler).toFixed(2)}`;
  if (process.env.MOVEPRINT_HASH) console.log('hash', require('node:crypto').createHash('sha1').update(JSON.stringify(r.prints)).digest('hex'), ids.map(id => id + ':' + require('node:crypto').createHash('sha1').update(JSON.stringify(r.prints[id])).digest('hex').slice(0, 6)).join(' '));
  console.log(JSON.stringify({ ruler: +ruler.toFixed(3), rulerId, ratio: RATIO, choreo: r.choreo.length, top5: pairs.slice(0, 5).map(fmt), fail: close.length }));
  if (close.length) console.log('太像的（距離／尺）：', [...new Set(close.map(fmt))].join(' '));

  check(ruler <= OLD_RULER * 1.5, `尺變太大（${ruler.toFixed(3)}，${rulerId}）：這招的形狀大部分靠亂數，主要的形狀要固定`);
  check(r.distinct === r.choreo.length, `有招共用同一個演出：${r.choreo.length} 招只有 ${r.distinct} 個演出`);
  const missing = ids.filter(id => DONE_TYPES.includes(r.types[id]) && !r.choreo.includes(id));
  check(missing.length === 0, `這個 PR 的屬性還有招沒有自己的演出：${missing}`);
  check(close.length === 0, `有招跟別招太像（要 ≥ 尺 × ${RATIO}）：${[...new Set(close.map(fmt))].join(' ')}`);

  const done = Object.entries(GROUPS).filter(([, types]) => ids.filter(id => types.includes(r.types[id])).every(id => r.choreo.includes(id))).map(([g]) => g);
  const dir = process.env.MOVEPRINT_SHEETS;
  for (const [g, url] of Object.entries(r.sheets)) {
    const file = dir ? path.join(dir, `moves-${g}.png`) : done.includes(g) ? path.join(ROOT, 'docs/screens', `moves-${g}.png`) : null;
    if (file) fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  }
};
test.options = { init: seeded };
run('moveprint', test);
