// 「動得自然」的量尺（規格 §7 的 M1–M9）：12 隻身體不同的代表在桌面上自由活動，用固定種子模擬，記錄每一幀
// PR-N1 只量、只回報，不設門檻（門檻在量完舊值、使用者看過以後才固定；之後的 PR 才加上 check）。
// 唯一的斷言：整段模擬沒有 pageerror、每隻都真的有在做事（不是全部卡住）。
// 結果寫到 .cache/natural/natural-<名字>.json（不進 repo），也印在最後。
// 環境變數：NATURAL_MIN＝模擬幾分鐘（預設 10）、NATURAL_TAG＝結果檔名（例如 old / new）
const fs = require('node:fs');
const path = require('node:path');
const { run, ROOT } = require('./lib.cjs');

const SPECIES = [650, 655, 656, 663, 666, 668, 671, 673, 688, 704, 714, 716]; // 每種身體類型至少一隻（規格 §7.2）
const SEEDS = [1, 2, 3];
const MIN = Number(process.env.NATURAL_MIN ?? 10);
const TAG = process.env.NATURAL_TAG ?? 'run';

// 狀態 → 時間分配的類別（只是量尺用；規格 §5.1 的 休息／探索／找吃的／玩／社交／理毛，另外有習性和「其他」）
const CLS = {
  rest: 'idle sit sleep nap sunbathe chill wait watch inside cursorSit read levitate',
  explore: 'walk look dig slime soar perchUp approach goIn goOut',
  forage: 'forage sniff munch sip eat hungry',
  play: 'run spin dance roll splash ember spark bubbles fade teleport shine twirl train follow pounce chaseCursor cast tag happy hop',
  social: 'chase flee greet toss spar cuddle oni parade hideseek photo nuzzle stare chat walkTogether share comfort cheer duel',
  groom: 'stretch shiver',
  habit: 'habit',
};
const CLASS_OF = {};
for (const [c, s] of Object.entries(CLS)) for (const k of s.split(' ')) CLASS_OF[k] = c;

const test = async ({ page }, check) => {
  await page.waitForSelector('.modal .starter [data-id="650"]', { timeout: 20000 });
  await page.click('.modal .starter [data-id="650"]');
  await page.waitForFunction(() => window.__kalos.game.state.starterChosen, null, { timeout: 10000 });
  // 物種生活表寫的身體 vs 像素木偶真的切出來的：寫「兩腳」「四腳」「人形」「只有腳」的要切得出腳。
  // 不相符只列出來（PR 描述問使用者），不自己改其中一邊（規格 §9 PR-N1）
  const legs = await page.evaluate(async () => {
    const { stage } = window.__kalos;
    const { SPECIES } = await import('/src/core/ethogram.js');
    const { buildRig } = await import('/src/renderer/gfx/rig.js');
    await Promise.all(stage.dex.ids.map(id => stage.sprites.get(id)));
    const LEGGED = new Set(['upright', 'quadruped', 'humanoid', 'legs']);
    const out = { missing: [], extra: [] };
    for (const id of stage.dex.ids) {
      const still = stage.sprites.peek(id, false);
      if (still.fallback || !SPECIES[id]) continue;
      const rig = buildRig(still.canvas, { floats: stage.dex.floats(id) });
      const want = LEGGED.has(SPECIES[id].body);
      // missing：表說有腳、木偶切不出腳（規格要列出來問）；extra：表的體型沒寫腳、木偶切出兩塊當腳（鳥本來就有腳；葉子、觸手被當成腳是已知限制）
      if (want && !rig.info.hasLegs) out.missing.push(`${id} ${SPECIES[id].name}（${SPECIES[id].body}）`);
      if (!want && rig.info.hasLegs) out.extra.push(`${id} ${SPECIES[id].name}（${SPECIES[id].body}）`);
    }
    return out;
  });
  const t0 = Date.now();
  const r = await page.evaluate(async ({ SPECIES, SEEDS, MIN, CLASS_OF }) => {
    const { game, director, stage } = window.__kalos;
    for (const sp of SPECIES.slice(1)) { const m = game.createMon(sp); m.out = true; game.state.mons.push(m); }
    director.syncPets();
    const w0 = Date.now();
    while ([...stage.pets.values()].filter(p => p.state !== 'appear').length < SPECIES.length && Date.now() - w0 < 30000) await new Promise(res => setTimeout(res, 50));
    await Promise.all([...stage.pets.values()].map(p => stage.sprites.get(p.spriteKey)));
    for (const p of stage.pets.values()) p.asset; // 先把木偶切好（p.view.anim.info 才有腳的資料）
    // 不讓外面的事插進來：不出門旅行、不生野生的、固定下午兩點、你在用電腦
    game.canDepart = () => false; director.nextSpawnAt = Infinity;
    director.updateEnv = () => {};
    Object.assign(stage.env, { hour: 14, sleepy: false, userActive: true, focus: false, plugged: false, lure: null });

    const mulberry = s => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const realRandom = Math.random;
    const dt = 1 / 30, N = Math.round(30 * 60 * MIN), S = stage.S;
    const pets = [...stage.pets.values()].sort((a, b) => a.mon.species - b.mon.species);
    const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
    const EXEMPT = new Set(['held', 'fall', 'move', 'battle', 'faint', 'duel', 'appear', 'teleport']); // 被拎、掉落、放招、瞬移：不算瞬間起步
    const SOCIAL = p => Boolean(p.partner || p.group);
    const ninety = r => { const q = r / (Math.PI / 2); return Math.abs(q - Math.round(q)) < 1e-6; };
    // 換動作組那一幀：舊圖和新圖（腳底置中對齊）有多少比例的像素不一樣
    const pix = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; return { w: c.width, h: c.height, d }; };
    const diff = (a, b) => {
      const W = Math.max(a.w, b.w), H = Math.max(a.h, b.h);
      const at = (m, x, y) => { const xx = x - ((W - m.w) >> 1), yy = y - (H - m.h); if (xx < 0 || yy < 0 || xx >= m.w || yy >= m.h) return 0; const i = (yy * m.w + xx) * 4; return m.d[i + 3] ? (m.d[i] << 16 | m.d[i + 1] << 8 | m.d[i + 2]) + 1 : 0; };
      let any = 0, ch = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = at(a, x, y), q = at(b, x, y); if (p || q) { any++; if (p !== q) ch++; } }
      return any ? ch / any : 0;
    };

    const seeds = [];
    for (const seed of SEEDS) {
      const rng = mulberry(seed * 9973);
      Math.random = rng;
      if (typeof game.rng === 'function') game.rng = rng;
      // 每個種子從一樣的起點開始
      pets.forEach((p, i) => {
        Object.assign(p.mon, { fullness: 150, enjoyment: 150 });
        p.mon.mind = null; p.mon.memory = [];
        p.x = stage.W * (0.1 + 0.8 * ((i + 0.5) / pets.length)); p.gy = stage.H * (0.5 + 0.3 * rng());
        p.vx = p.vy = p.vz = p.z = 0; p.partner = null; p.group = null; p.onArrive = null; p.reserved = null; p.perch = null;
        p.set('idle', 0.5 + rng());
      });
      const rec = pets.map(p => ({
        sp: p.mon.species, hasLegs: Boolean(p.view?.anim?.info?.hasLegs), moving: 0, jumps: 0, flips: 0, flipTurn: 0, changes: 0, rot: 0, scale: 0,
        states: {}, cls: {}, runs: [], runState: p.state, runT: 0, stillRun: 0, walk: null, walkBouts: 0, walkPaused: 0,
        wdist: 0, wcyc: 0, lastV: 0, lastF: p.facing, lastSet: p.animSet(), lastCanvas: null, setSwitch: 0, bigSwitch: 0, switchDiffs: [], mv: [], soc: [],
      }));
      for (let i = 0; i < N; i++) {
        const before = pets.map(p => ({ x: p.x, y: p.gy, a: p.animT }));
        director.update?.(dt);
        stage.update(dt);
        pets.forEach((p, k) => {
          const o = rec[k], b = before[k];
          const v = Math.hypot(p.x - b.x, p.gy - b.y) / S / dt; // 美術像素／秒
          const mv = v > 2;
          o.mv.push(mv ? 1 : 0); o.soc.push(SOCIAL(p) ? 1 : 0);
          if (mv) o.moving++;
          // M1：一幀之內速度差超過 15 px/s（現在還沒有加速度上限，先用固定值）
          if (!EXEMPT.has(p.state) && Math.abs(v - o.lastV) > 15) o.jumps++;
          o.lastV = v;
          // M4：翻面前 0.12 秒內有沒有轉身姿勢（pet.turnT；現在還沒有這個欄位）
          if (p.facing !== o.lastF) { o.flips++; if (p.turnT > 0 || p.turnedAt > p.t - 0.12) o.flipTurn++; o.lastF = p.facing; }
          // 時間分配、狀態長度（M5、M8）
          o.states[p.state] = (o.states[p.state] ?? 0) + dt;
          const c = CLASS_OF[p.state] ?? 'other';
          o.cls[c] = (o.cls[c] ?? 0) + dt;
          if (p.state !== o.runState) { o.changes++; o.runs.push(o.runT); o.runState = p.state; o.runT = 0; }
          o.runT += dt;
          // M3：探索（walk）超過 3 秒的那一段，中間有沒有 0.3–2 秒的停頓
          if (p.state === 'walk') {
            o.walk ??= { t: 0, still: 0, paused: false };
            o.walk.t += dt;
            if (!mv) o.walk.still += dt; else { if (o.walk.still >= 0.3 && o.walk.still <= 2) o.walk.paused = true; o.walk.still = 0; }
          } else if (o.walk) {
            if (o.walk.t > 3) { o.walkBouts++; if (o.walk.paused) o.walkPaused++; }
            o.walk = null;
          }
          // M2：有腳、在走路的時候，一輪步態走了多遠
          const set = p.animSet();
          if (o.hasLegs && set === 'walk' && mv && p.view?.set?.total) { o.wdist += v * dt; o.wcyc += (p.animT - b.a) / p.view.set.total; }
          // M7：整張圖的旋轉、縮放
          const po = p.pose();
          if (po.rot && !ninety(po.rot)) o.rot++;
          if (Math.abs(Math.abs(po.sx) - 1) > 1e-6 || Math.abs(Math.abs(po.sy) - 1) > 1e-6) o.scale++;
          // M8：換動作組那一幀的像素變化
          const cv = p.asset?.canvas;
          if (set !== o.lastSet && o.lastCanvas && cv) { const d = diff(pix(o.lastCanvas), pix(cv)); o.setSwitch++; o.switchDiffs.push(d); if (d > 0.25) o.bigSwitch++; }
          o.lastSet = set; o.lastCanvas = cv;
        });
      }
      // 整理
      const per = {};
      for (const o of rec) {
        const tot = N * dt;
        const share = Object.fromEntries(Object.entries(o.cls).map(([k, v]) => [k, Math.round(100 * v / tot)]));
        per[o.sp] = {
          M1_jumpsPerMin: +(o.jumps / MIN).toFixed(1),
          M2_slide: o.wcyc > 0.5 ? +((o.wdist / o.wcyc) / (2 * 2)).toFixed(2) : null, // 步幅＝2 美術像素（rig.js 走路時腳前後各 1 格）
          M3_pausedWalks: o.walkBouts ? Math.round(100 * o.walkPaused / o.walkBouts) : null,
          M4_turnPose: o.flips ? Math.round(100 * o.flipTurn / o.flips) : null,
          M5_share: share,
          M7_rot: Math.round(100 * o.rot / N), M7_scale: Math.round(100 * o.scale / N),
          M8_changesPerMin: +(o.changes / MIN).toFixed(1), M8_medianBout: +med(o.runs).toFixed(2),
          M8_bigSwitchPct: o.setSwitch ? Math.round(100 * o.bigSwitch / o.setSwitch) : 0, M8_switchMedian: +(med(o.switchDiffs)).toFixed(2),
          moving: Math.round(100 * o.moving / N),
          flipsPerMin: +(o.flips / MIN).toFixed(1),
          top: Object.entries(o.states).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${Math.round(100 * v / tot)}%`),
          states: o.states,
        };
      }
      // M6：兩隻的時間分配（類別）的 Jensen–Shannon 距離（以 2 為底，0–1）
      // 不用狀態名稱：10 分鐘裡狀態名稱的直方圖雜訊太大（同一隻換個種子就差 ~0.33，量過），比不出物種差異
      const js = (a, b) => {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        const sa = Object.values(a).reduce((x, y) => x + y, 0), sb = Object.values(b).reduce((x, y) => x + y, 0);
        let d = 0;
        for (const k of keys) {
          const p = (a[k] ?? 0) / sa, q = (b[k] ?? 0) / sb, m = (p + q) / 2;
          if (p) d += 0.5 * p * Math.log2(p / m);
          if (q) d += 0.5 * q * Math.log2(q / m);
        }
        return Math.sqrt(Math.max(0, d));
      };
      const pairs = [];
      const corr = (x, y, mask) => {
        let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
        for (let i = 0; i < x.length; i++) { if (mask[i]) continue; n++; sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i]; sxy += x[i] * y[i]; }
        const cv = sxy / n - (sx / n) * (sy / n), vx = sxx / n - (sx / n) ** 2, vy = syy / n - (sy / n) ** 2;
        return vx > 0 && vy > 0 ? cv / Math.sqrt(vx * vy) : 0;
      };
      const cors = [];
      for (let i = 0; i < rec.length; i++) for (let j = i + 1; j < rec.length; j++) {
        pairs.push(js(rec[i].cls, rec[j].cls));
        const mask = rec[i].soc.map((s, k) => s || rec[j].soc[k]);
        cors.push(corr(rec[i].mv, rec[j].mv, mask));
      }
      seeds.push({
        seed, per,
        M6_jsd: { min: +Math.min(...pairs).toFixed(3), median: +med(pairs).toFixed(3) },
        M9_corr: { max: +Math.max(...cors).toFixed(3), median: +med(cors).toFixed(3) },
      });
    }
    Math.random = realRandom;
    return seeds;
  }, { SPECIES, SEEDS, MIN, CLASS_OF });
  const secs = (Date.now() - t0) / 1000;

  // 每個種子的每一隻都要有在做事（全部卡在同一個狀態＝模擬壞了，量出來的數字沒有意義）
  for (const s of r) for (const [sp, v] of Object.entries(s.per)) check(Object.keys(v.states).length >= 3, `種子 ${s.seed} 的 ${sp} 只做了 ${Object.keys(v.states).join('、')}`);

  // 摘要：每個量尺，12 隻的中位數和最差的那隻；3 個種子分開列
  const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  const summary = r.map(s => {
    const col = k => Object.values(s.per).map(v => v[k]);
    const worst = (k, hi = true) => { const a = col(k).filter(x => x != null); return a.length ? (hi ? Math.max(...a) : Math.min(...a)) : null; };
    return {
      seed: s.seed,
      M1: { median: med(col('M1_jumpsPerMin')), worst: worst('M1_jumpsPerMin') },
      M2: { median: med(col('M2_slide')), worst: worst('M2_slide') },
      M3: { median: med(col('M3_pausedWalks')), worst: worst('M3_pausedWalks', false) },
      M4: { median: med(col('M4_turnPose')), worst: worst('M4_turnPose', false) },
      M6: s.M6_jsd,
      M7: { rot: worst('M7_rot'), scale: worst('M7_scale') },
      M8: { changesMedian: med(col('M8_changesPerMin')), changesWorst: worst('M8_changesPerMin'), boutMedian: med(col('M8_medianBout')), bigSwitchWorst: worst('M8_bigSwitchPct') },
      M9: s.M9_corr,
    };
  });
  const out = path.join(ROOT, '.cache/natural');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `natural-${TAG}.json`), JSON.stringify({ minutes: MIN, seconds: secs, legs, summary, seeds: r }, null, 1));
  console.log(`表寫有腳、木偶切不出腳（${legs.missing.length} 隻）：${legs.missing.join('、') || '無'}`);
  console.log(`表的體型沒寫腳、木偶切出腳（${legs.extra.length} 隻，參考）：${legs.extra.join('、') || '無'}`);
  console.log(JSON.stringify(summary));
  for (const s of r) console.log(`種子 ${s.seed}：` + Object.entries(s.per).map(([sp, v]) => `${sp} 動${v.moving}% 換${v.M8_changesPerMin}/分 [${Object.entries(v.M5_share).map(([k, x]) => k + x).join(' ')}]`).join(' | '));
  console.log(`模擬 ${MIN} 分鐘 × ${SEEDS.length} 個種子，花了 ${secs.toFixed(0)} 秒`);
};

run('natural', test);
