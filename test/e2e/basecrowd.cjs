// 白天回基地休息不會擠成一團（使用者回報：好幾隻擠在基地、圖疊在一起）
// 6 隻、白天、使用者不在，自由活動 10 分鐘（快轉，固定種子）：
//   - 在基地空地上休息（坐著、發呆）的兩隻，圖重疊超過較小那隻的 30%（一前一後蓋到一點是正常的遠近）：
//     一次最多 3 秒（別隻剛好停下來的那一下，要反應、走開；猜的，可調整），不能一直疊著
//   - 有夥伴白天鑽進帳篷休息（住得下就進去，動物大多回窩休息）
// 環境變數 BASECROWD_ROOT：量別的版本（例如 main）用，預設是這個 repo
const path = require('node:path');
const { run } = require(path.join(process.env.BASECROWD_ROOT ?? path.resolve(__dirname, '../..'), 'test/e2e/lib.cjs'));

const SPECIES = [655, 663, 668, 671, 704, 714];

// 同一個種子每次都要一樣（照 soul.cjs）：網頁一開就把 Math.random 換成固定種子、可以停掉真的畫面迴圈
function seedPage() {
  let a = 1;
  window.__reseed = s => { a = s >>> 0; };
  Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => (window.__holdRaf ? 0 : raf(cb));
}
const SEEDS = [1, 2, 3];

const test = async ({ page }, check) => {
  await page.waitForSelector('.modal .starter [data-id="650"]', { timeout: 20000 });
  await page.click('.modal .starter [data-id="650"]');
  await page.waitForFunction(() => window.__kalos.game.state.starterChosen, null, { timeout: 10000 });
  const r = await page.evaluate(async ({ SPECIES, SEEDS }) => {
    const { game, director, stage } = window.__kalos;
    const { createRng } = await import('/src/core/rng.js');
    window.__reseed(7); game.rng = director.rng = createRng(7); // 建立之前：飄浮高度、個性是建立時抽的
    for (const sp of SPECIES.slice(1)) { const m = game.createMon(sp); m.out = true; m.affection = 120; game.state.mons.push(m); }
    director.syncPets();
    const w0 = Date.now();
    while ([...stage.pets.values()].filter(p => p.state !== 'appear').length < SPECIES.length && Date.now() - w0 < 30000) await new Promise(res => setTimeout(res, 50));
    await Promise.all([...stage.pets.values()].map(p => stage.sprites.get(p.spriteKey)));
    for (const p of stage.pets.values()) void p.asset; // 木偶先切好（大小不會中途變）
    window.__holdRaf = true; // 停掉真的畫面迴圈，只用下面的快轉
    await new Promise(r => setTimeout(r, 100));
    game.canDepart = () => false; director.nextSpawnAt = Infinity; director.updateEnv = () => {};
    Object.assign(stage.env, { hour: 14, sleepy: false, userActive: false, focus: false });
    const view = stage.baseView;
    const frac = (a, b) => { // 兩隻的圖重疊的面積占較小那隻的比例（跟 scene/home.js 的 overlapFrac 同一個算法，這裡自己算）
      const ra = a.rect(), rb = b.rect();
      const ix = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x), iy = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
      return ix > 0 && iy > 0 ? (ix * iy) / Math.min(ra.w * ra.h, rb.w * rb.h) : 0;
    };
    const realNow = Date.now;
    const RESTING = new Set(['sit', 'idle', 'nap', 'stretch']);
    const pets = [...stage.pets.values()].sort((a, b) => a.mon.species - b.mon.species);
    const out = [];
    for (const seed of SEEDS) {
      window.__reseed(seed * 131);
      game.rng = director.rng = createRng(seed * 131); // 遊戲自己的亂數也固定（不然同一個種子每次不一樣）
      // 時鐘也固定、跟著快轉走（牠們的生活 core/life.js、記憶都看時間；soul.cjs 以前也是這個原因）
      let simT = 0; const t0Sim = new Date(2026, 8, 22, 14, 0).getTime();
      Date.now = () => t0Sim + Math.round(simT * 1000);
      // 每個種子從一樣的起點開始（位置、面向、動畫時間、飄浮高度、數值、心智、記憶）
      pets.forEach((p, i) => {
        Object.assign(p.mon, { fullness: 150, enjoyment: 150, affection: 120, mind: null, memory: [] });
        Object.assign(p, { partner: null, group: null, onArrive: null, homeSpot: null, bedId: null, x: stage.W * (0.15 + 0.13 * i), gy: stage.H * 0.6, z: 0, vx: 0, vy: 0, vz: 0, facing: i % 2 ? 1 : -1, t: i, animT: i });
        if (p.floats) p.alt = 40;
        p.set('idle', 0.5 + 0.2 * i);
      });
      let overlap = 0, atBase = 0, inside = 0, worst = null, longest = 0;
      const since = new Map(); // 哪一對從什麼時候開始疊在一起
      for (let f = 0; f < 30 * 600; f++) {
        simT += 1 / 30;
        stage.update(1 / 30);
        const home = pets.filter(p => RESTING.has(p.state) && view.contains(p.x, p.gy) && !p.bedId);
        atBase += home.length;
        inside += pets.filter(p => p.state === 'inside').length;
        let bad = false;
        for (let i = 0; i < home.length; i++) for (let j = i + 1; j < home.length; j++) {
          const a = home[i], b = home[j];
          const k = a.uid + '|' + b.uid;
          if (frac(a, b) > 0.3) {
            bad = true;
            if (!since.has(k)) since.set(k, simT);
            const d = simT - since.get(k);
            if (d > longest) { longest = d; worst = [a.mon.species, b.mon.species, a.state, b.state]; }
          } else since.delete(k);
        }
        for (const k of [...since.keys()]) if (!home.some(p => k.startsWith(p.uid + '|')) || !home.some(p => k.endsWith('|' + p.uid))) since.delete(k);
        if (bad) overlap++;
      }
      out.push({ seed, longestSec: +longest.toFixed(1), overlapSec: +(overlap / 30).toFixed(1), restAtBaseSec: Math.round(atBase / 30), insideSec: Math.round(inside / 30), worst });
    }
    Date.now = realNow;
    return out;
  }, { SPECIES, SEEDS });
  console.log(JSON.stringify(r));
  for (const s of r) check(s.longestSec <= 3, `種子 ${s.seed}：基地空地上有兩隻一直疊在一起 ${s.longestSec} 秒（${JSON.stringify(s.worst)}）`);
  check(r.some(s => s.insideSec > 0), `白天沒有任何一隻鑽進帳篷休息：${JSON.stringify(r)}`);
};

test.options = { init: seedPage };
run('basecrowd', test);
