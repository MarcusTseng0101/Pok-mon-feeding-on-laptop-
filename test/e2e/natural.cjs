// 「動得自然」的量尺（規格 §7 的 M1–M9）：12 隻身體不同的代表在桌面上自由活動，用固定種子模擬，記錄每一幀
// PR-N1 只量；PR-N2 起 M2、M3、M4 有門檻（下面的 check），另外有打斷測試（真的滑鼠）；PR-N3 起 M7、M8、M9 也有門檻；PR-N5 起 M8 的每分鐘換狀態也有（每一種自己的上限）。
// 其他斷言：整段模擬沒有 pageerror、每隻都真的有在做事（不是全部卡住）。
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
  const { seeds: r, M9_test } = await page.evaluate(async ({ SPECIES, SEEDS, MIN, CLASS_OF }) => {
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

    // 每隻的加速度上限（PR-N2 以後才有 scene/locomotion.js；舊版沒有就用固定的 15 px/s）
    const loco = await import('/src/renderer/scene/locomotion.js').catch(() => null);
    const { RUN_SPEED } = await import('/src/renderer/scene/behaviors.js');
    const jumpLimit = p => {
      if (!loco?.gait) return 15;
      const g = loco.gait(p), v = loco.topSpeed(p, RUN_SPEED * S, 26) / S; // 美術像素／秒
      return (v / g.acc) * dt * 1.5; // 規格 M1：一幀的速度變化 > 加速度上限 × dt × 1.5
    };
    const INSTANT = new Set(['spin', 'dance', 'refuse', 'roll', 'appear', 'held', 'fall', 'evolving']);
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

    const seeds = [], series = [];
    for (const seed of SEEDS) {
      const rng = mulberry(seed * 9973);
      Math.random = rng;
      if (typeof game.rng === 'function') game.rng = rng;
      // 每個種子從一樣的起點開始
      pets.forEach((p, i) => {
        Object.assign(p.mon, { fullness: 150, enjoyment: 150 });
        p.mon.mind = null; p.mon.memory = [];
        p.x = stage.W * (0.1 + 0.8 * ((i + 0.5) / pets.length)); p.gy = stage.H * (0.5 + 0.3 * rng());
        p.vx = p.vy = p.vz = p.z = 0; p.lv = { x: 0, y: 0 }; /* 移動速度也清掉：以前上一個種子留下的速度讓第一幀就在滑（被算成瞬間起步） */ p.partner = null; p.group = null; p.onArrive = null; p.reserved = null; p.perch = null;
        p.set('idle', 0.5 + rng());
      });
      const rec = pets.map(p => ({
        sp: p.mon.species, hasLegs: Boolean(p.view?.anim?.info?.hasLegs), moving: 0, jumps: 0, flips: 0, flipTurn: 0, changes: 0, rot: 0, scale: 0,
        states: {}, cls: {}, runs: [], runState: p.state, runT: 0, stillRun: 0, walk: null, walkBouts: 0, walkPaused: 0,
        wdist: 0, wcyc: 0, bumps: 0, stride: p.view?.anim?.info?.stride || 2, lastV: 0, lastF: p.viewFacing ?? p.facing, jumpStates: {}, lastSet: p.animSet(), lastCanvas: null, setSwitch: 0, bigSwitch: 0, switchDiffs: [], mv: [], soc: [], frames: new Set(),
      }));
      for (let i = 0; i < N; i++) {
        const before = pets.map(p => ({ x: p.x, y: p.gy, a: p.animT, st: p.state, kv: Math.abs(p.kvx ?? 0) + Math.abs(p.kvy ?? 0) > 0 }));
        const stopped = stage.stopT > 0; // 這一幀開始時在「頓一下」（stage.update 會把 dt 乘 0.12）
        director.update?.(dt);
        stage.update(dt);
        pets.forEach((p, k) => {
          const o = rec[k], b = before[k];
          const v = Math.hypot(p.x - b.x, p.gy - b.y) / S / dt; // 美術像素／秒
          const mv = v > 2;
          o.mv.push(mv ? 1 : 0); o.soc.push(SOCIAL(p) || p.bumpT > 0 || Math.abs(p.kvx ?? 0) + Math.abs(p.kvy ?? 0) > 0 || stopped || stage.stopT > 0 ? 1 : 0); // M9：社交、互相擠到、被撞、「頓一下」（全舞台一起放慢）的時間扣掉：兩隻之間的互動或全部一起的，不是各自決定要動
          if (mv) o.moving++;
          // M1：一幀之內的速度變化超過加速度上限（被拎、掉落、放招、瞬移、被推或被撞到的那幾幀不算）
          const knocked = b.kv || Math.abs(p.kvx ?? 0) + Math.abs(p.kvy ?? 0) > 0 || p.hopT > 0; // 被打到、被撞飛（這一幀開始時還有擊退速度也算：擊退在這一幀裡衰減到 0，這一幀還是被推了）
          const hitStop = stage.stopT > 0 || stopped; // 招式打中時整個舞台放慢一下（「頓一下」）：大家一起慢，不是牠自己瞬間減速
          const teleport = p.state === 'habit' && p.habit?.teleport; // 瞬移型習性（規格 M1 的排除；habits.js 標 teleport）
          const exempt = EXEMPT.has(p.state) || EXEMPT.has(b.st) || teleport || knocked || hitStop; // b.st：這一幀開始時的狀態（放招在這一幀結束、最後搬了位置，也算放招）
          // 上一幀是排除的（頓一下時 dt × 0.12、放招、被拎、被打到）：這一幀的速度不跟它比（PR-N4a 修量法：以前頓完的下一幀會被算成「瞬間起步」，26 → 3 剛好是 × 0.12）
          const jump = !exempt && !o.lastExempt && Math.abs(v - o.lastV) > jumpLimit(p);
          if (jump && p.bumpT > 0) o.bumps++; // 被別隻擠了一下（physics.js 推開重疊）：另外算，跟被打到一樣不算在 M1
          else if (jump) { o.jumps++; o.jumpStates[p.state] = (o.jumpStates[p.state] ?? 0) + 1; }
          o.lastV = v; o.lastExempt = exempt;
          // M4：畫出來的面向翻過去之前，有沒有做至少 0.12 秒的轉身（轉圈、跳舞、搖頭這種本來就要快速翻的不算）
          const vf = p.viewFacing ?? p.facing;
          // 轉圈這種本來就直接翻的（同一幀結束的也算：instantFlipAt）不算
          if (vf !== o.lastF) { if (!INSTANT.has(p.state) && p.instantFlipAt !== p.t) { o.flips++; if (p.turnedAt === p.t && p.lastTurn >= 0.12 - 1e-6) o.flipTurn++; else (o.noTurn ??= []).length < 4 && o.noTurn.push([p.state, o.prevState, +(p.t - (p.turnStart ?? -99)).toFixed(2)]); } o.lastF = vf; }
          o.prevState = p.state;
          // 時間分配、狀態長度（M5、M8）
          o.states[p.state] = (o.states[p.state] ?? 0) + dt;
          const c = CLASS_OF[p.state] ?? 'other';
          o.cls[c] = (o.cls[c] ?? 0) + dt;
          if (p.state !== o.runState) { o.changes++; o.runs.push(o.runT); o.runState = p.state; o.runT = 0; }
          o.runT += dt;
          // 只做一次的（練招式、沒有對象的習性：scene/pet.js 的 boutRep.once）：同一段裡不准再重新開始（使用者：一段裡連放好幾招像在打空氣）
          const br = p.boutRep;
          // 重新開始可能發生在同一幀裡（做完 → 過場 idle → 馬上又開始），取樣看不到中間的 idle：改看「同一段、同一個狀態，做了多久（stateT）卻變短了」
          if (br?.once && p.state === br.name) {
            if (o.onceBr !== br) { o.onceBr = br; o.onceBouts = (o.onceBouts ?? 0) + 1; }
            else if (o.onceLast === br.name && p.stateT < o.onceT) o.onceRepeat = (o.onceRepeat ?? 0) + 1;
          }
          o.onceLast = p.state; o.onceT = p.stateT;
          // M3：探索的散步（walk，而且是散步不是去某個地方：pet.explore；舊版沒有這個欄位就全部的 walk 都算）超過 3 秒的那一段，中間有沒有 0.3–2 秒的停頓
          if (p.state === 'walk' && (p.explore ?? true)) {
            o.walk ??= { t: 0, still: 0, paused: false };
            o.walk.t += dt;
            // 停著＝自己沒有在走（lastStepDist：這一幀自己走了幾格，跟 M2 一樣）。被別隻擠、被推（例如旁邊在集合遊行）位置會變，但不是牠在走（PR-N4a 修量法；舊版沒有這個欄位就看位置）
            const selfMv = p.lastStepDist != null ? p.lastStepDist / dt > 2 : mv;
            if (!selfMv) o.walk.still += dt; else { if (o.walk.still >= 0.3 && o.walk.still <= 2) o.walk.paused = true; o.walk.still = 0; }
          } else if (o.walk) {
            // 散步停在一個 0.3–2 秒的停頓裡被叫走（遊行、被找去玩）：那一次停頓也算（以前要等「又開始走」才算，會漏掉）
            if (o.walk.still >= 0.3 && o.walk.still <= 2) o.walk.paused = true;
            if (o.walk.t > 3) { o.walkBouts++; if (o.walk.paused) o.walkPaused++; }
            o.walk = null;
          }
          // M2：有腳、在走路的時候，一輪步態走了多遠
          const set = p.animSet();
          // 只算用腳走的（會飄的走路動畫本來就照時間播），被擠、被撞、被習性直接搬動的那幾幀（位置變了但不是自己走的：lastStepDist = 0）不算
          if (o.hasLegs && !p.floats && !knocked && !(p.bumpT > 0) && (p.lastStepDist ?? 1) > 0 && set === 'walk' && mv && p.view?.set?.total) { o.wdist += v * dt; o.wcyc += (p.animT - b.a) / p.view.set.total; }
          // M7：整張圖的旋轉、縮放：量「真的畫出來的」那一個（PR-N3 起 draw() 畫的是 toPuppet 翻過以後的 puppetXf；舊版沒有就是 pose()，舊版 draw() 直接畫它）
          const po = p.puppetXf ?? p.pose();
          if (po.rot && !ninety(po.rot)) o.rot++;
          if (Math.abs(Math.abs(po.sx) - 1) > 1e-6 || Math.abs(Math.abs(po.sy) - 1) > 1e-6) o.scale++;
          if (p.view?.puppet && p.view.cur && o.frames.size < 4000) o.frames.add(p.view.cur.canvas); // M7 的顏色：畫過的每一張木偶圖，最後檢查
          // M8：換動作組那一幀的像素變化
          const cv = p.asset?.canvas;
          if (set !== o.lastSet && o.lastCanvas && cv) { const d = diff(pix(o.lastCanvas), pix(cv)); o.setSwitch++; o.switchDiffs.push(d); if (d > 0.25) { o.bigSwitch++; if ((o.bigList ??= []).length < 6) o.bigList.push(`${o.lastSet}→${set} ${p.state} ${d.toFixed(2)} [${o.lastKey}]→[${p.view?.key}]`); } }
          // M8（使用者同意的量法修改）：像素圖整隻動 1 格就會變 40–60% 的像素，「≤ 25%」量不出有沒有跳格。
          // 改量參數：相鄰兩幀，每一個量化參數（lean、crouch、低頭、呼吸、腳、部位角度級）最多變 1 級，頭的位置最多動 1 格。每一幀都量（比只量換動作那一幀嚴）
          const key = p.view?.key;
          if (key && o.lastKey && p.view === o.lastView) {
            const a = o.lastKey.split(',').map(Number), b = key.split(',').map(Number);
            // 骨架木偶的步相 gait 是繞圈的（info.cyclic：15 → 0 是往前 1 格，不是 15 格）；其他參數照舊直接相減
            const cyc = new Map(p.view.anim.info?.cyclic ?? []), stepOf = (x, y, i) => { const d = Math.abs(x - y), n = cyc.get(i); return n ? Math.min(d, n - d) : d; };
            const st = Math.max(...a.map((x, i) => stepOf(x, b[i], i))), hd = Math.abs((a[1] + a[2] - a[3]) - (b[1] + b[2] - b[3]));
            o.maxStep = Math.max(o.maxStep ?? 0, st, hd);
            if (set !== o.lastSet) o.switchStep = Math.max(o.switchStep ?? 0, st, hd);
            if (Math.max(st, hd) > 1 && (o.stepList ??= []).length < 6) o.stepList.push(`${o.lastSet}→${set} ${p.state} [${o.lastKey}]→[${key}]`);
          }
          o.lastSet = set; o.lastCanvas = cv; o.lastKey = key; o.lastView = p.view;
        });
      }
      // 整理
      const per = {};
      // M7：木偶圖裡有沒有原圖沒有的顏色（糊掉、混色）；部位轉的角度有沒有超過上限（gfx/rig.js 的 PART_MAX）
      const rigMod = await import('/src/renderer/gfx/rig.js');
      const etho = await import('/src/core/ethogram.js'); // M8：每一種自己的上限（switchMaxAt）
      const colorsOf = cv => { const s = new Set(), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) s.add(`${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`); return s; };
      rec.forEach((o, k) => {
        const p = pets[k], base = colorsOf(stage.sprites.peek(p.spriteKey, p.mon.shiny).canvas);
        o.newColors = 0;
        for (const cv of o.frames) for (const c of colorsOf(cv)) if (!base.has(c)) o.newColors++;
        o.partMax = p.view?.anim?.stats?.maxPart ?? null;
        o.partLimit = rigMod.PART_MAX ?? null;
      });
      for (const o of rec) {
        const tot = N * dt;
        const share = Object.fromEntries(Object.entries(o.cls).map(([k, v]) => [k, Math.round(100 * v / tot)]));
        per[o.sp] = {
          M1_jumpsPerMin: +(o.jumps / MIN).toFixed(1), M1_states: o.jumpStates, M1_bumpsPerMin: +(o.bumps / MIN).toFixed(1),
          M2_slide: o.wcyc > 0.5 ? +((o.wdist / o.wcyc) / (2 * o.stride)).toFixed(2) : null, // 步幅：rig.js 的 info.stride（舊版沒有＝2，腳前後各 1 格）
          M3_pausedWalks: o.walkBouts ? Math.round(100 * o.walkPaused / o.walkBouts) : null,
          M4_turnPose: o.flips ? Math.round(100 * o.flipTurn / o.flips) : null, M4_misses: o.noTurn ?? [],
          M5_share: share,
          M7_rot: Math.round(100 * o.rot / N), M7_scale: Math.round(100 * o.scale / N), M7_rotFrames: o.rot, M7_scaleFrames: o.scale,
          M7_frames: o.frames.size, M7_newColors: o.newColors, M7_partMax: o.partMax == null ? null : +o.partMax.toFixed(3), M7_partLimit: o.partLimit,
          M8_changesPerMin: +(o.changes / MIN).toFixed(1), M8_max: etho.switchMaxAt?.(o.sp, stage.env.hour, {}, stage.dex.get(o.sp)?.types ?? []) ?? null, M8_medianBout: +med(o.runs).toFixed(2),
          M8_bigSwitchPct: o.setSwitch ? Math.round(100 * o.bigSwitch / o.setSwitch) : 0, M8_switchMedian: +(med(o.switchDiffs)).toFixed(2), M8_big: o.bigList ?? [],
          once_bouts: o.onceBouts ?? 0, once_repeat: o.onceRepeat ?? 0,
          M8_maxStep: o.maxStep ?? null, M8_switchStep: o.switchStep ?? null, M8_steps: o.stepList ?? [],
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
      const cors = [], pairNames = [];
      for (let i = 0; i < rec.length; i++) for (let j = i + 1; j < rec.length; j++) {
        pairs.push(js(rec[i].cls, rec[j].cls));
        const mask = rec[i].soc.map((s, k) => s || rec[j].soc[k]);
        cors.push(corr(rec[i].mv, rec[j].mv, mask));
        pairNames.push(`${rec[i].sp}-${rec[j].sp}`);
      }
      series.push(rec.map(o => ({ mv: o.mv, soc: o.soc })));
      seeds.push({
        seed, per,
        M6_jsd: { min: +Math.min(...pairs).toFixed(3), median: +med(pairs).toFixed(3) },
        M9_corr: { max: +Math.max(...cors).toFixed(3), median: +med(cors).toFixed(3), maxPair: pairNames[cors.indexOf(Math.max(...cors))] },
      });
    }
    Math.random = realRandom;
    // M9 的對照組：不同種子的兩隻（不在同一次模擬，一定互不相干）也算一樣的相關係數。
    // 兩隻都常常休息很久時，就算完全無關，66 對裡面最大的也可能很高；這個是「純巧合」有多高
    const corr0 = (x, y, mx, my) => {
      let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (let i = 0; i < x.length; i++) { if (mx[i] || my[i]) continue; n++; sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i]; sxy += x[i] * y[i]; }
      const cv = sxy / n - (sx / n) * (sy / n), vx = sxx / n - (sx / n) ** 2, vy = syy / n - (sy / n) ** 2;
      return vx > 0 && vy > 0 ? cv / Math.sqrt(vx * vy) : 0;
    };
    for (let k = 0; k < series.length; k++) {
      const A = series[k], B = series[(k + 1) % series.length], null0 = [];
      for (let i = 0; i < A.length; i++) for (let j = i + 1; j < B.length; j++) null0.push(corr0(A[i].mv, B[j].mv, A[i].soc, B[j].soc));
      seeds[k].M9_null = { max: +Math.max(...null0).toFixed(3), median: +med(null0).toFixed(3) };
    }
    // M9 的門檻（使用者同意的修改）：「實際的最大值 ≤ 對照組的最大值」兩邊都是很多對裡取最大，完全不相干時誰大像擲銅板。
    // 改成：先做一大池不相干的配對（不同種子的兩隻、時間再隨便錯開），用它算出「一樣多對取最大」在不相干時的分布，
    // 實際量到的最大值（全部種子一起）≤ 那個分布的 99 百分位才過（不相干時只有約 1% 的機會失敗）
    // 「198 對取最大」的 99 百分位＝單一對的 99.995 百分位，池子要很大才量得準（4000 對時每次跑差到 0.37–0.48），
    // 所以池子放 10 萬對；為了快，兩邊都每 5 幀取一次（每秒 6 次；狀態一段都好幾秒，取樣不影響相關係數）
    const nr = mulberry(424242), POOL = 100000, REPS = 4000, DS = 5, len = series[0].length, S3 = series.length;
    const ds = series.map(sr => sr.map(o => ({ mv: Uint8Array.from({ length: Math.floor(o.mv.length / DS) }, (_, i) => o.mv[i * DS]), soc: Uint8Array.from({ length: Math.floor(o.soc.length / DS) }, (_, i) => o.soc[i * DS]) })));
    const n = ds[0][0].mv.length;
    const corrAt = (A, B, sh) => {
      let m = 0, sx = 0, sy = 0, sxy = 0;
      for (let i = 0; i < n; i++) { const j = (i + sh) % n; if (A.soc[i] || B.soc[j]) continue; const x = A.mv[i], y = B.mv[j]; m++; sx += x; sy += y; sxy += x * y; }
      const vx = sx / m - (sx / m) ** 2, vy = sy / m - (sy / m) ** 2; // 0／1 的序列：平方＝自己
      return vx > 0 && vy > 0 ? (sxy / m - (sx / m) * (sy / m)) / Math.sqrt(vx * vy) : 0;
    };
    const pool = new Float64Array(POOL);
    for (let c = 0; c < POOL; c++) {
      const ka = Math.floor(nr() * S3), kb = (ka + 1 + Math.floor(nr() * (S3 - 1))) % S3;
      pool[c] = corrAt(ds[ka][Math.floor(nr() * len)], ds[kb][Math.floor(nr() * len)], Math.floor(nr() * n));
    }
    let real = -1, realPair = '';
    for (let k = 0; k < S3; k++) for (let i = 0; i < len; i++) for (let j = i + 1; j < len; j++) { const c = corrAt(ds[k][i], ds[k][j], 0); if (c > real) { real = c; realPair = `種子 ${seeds[k].seed} ${seeds[k].per ? Object.keys(seeds[k].per)[i] + '-' + Object.keys(seeds[k].per)[j] : ''}`; } }
    const PAIRS = S3 * (len * (len - 1)) / 2, maxes = [];
    for (let r = 0; r < REPS; r++) { let mx = -1; for (let c = 0; c < PAIRS; c++) mx = Math.max(mx, pool[Math.floor(nr() * POOL)]); maxes.push(mx); }
    maxes.sort((a, b) => a - b);
    const M9_test = { real: +real.toFixed(3), realPair, p99: +maxes[Math.floor(REPS * 0.99)].toFixed(3), p50: +maxes[REPS >> 1].toFixed(3), pairs: PAIRS };
    return { seeds, M9_test };
  }, { SPECIES, SEEDS, MIN, CLASS_OF });
  const secs = (Date.now() - t0) / 1000;

  // ---------- 打斷測試（規格 §8，PR-N2 起）：用真的滑鼠打斷，5 秒內要回到正常的一段，而且身上沒有留著舊的東西 ----------
  // 準備狀況（讓牠正在走、正在坐）用 evaluate；打斷本身一定是真的滑鼠
  const clean = () => page.evaluate(() => [...window.__kalos.stage.pets.values()].map(p => {
    const bad = [];
    // 卡在拎起、掉落、放招裡出不來（4 秒以上）；放下以後自己又去練招（PR-N4 起做完一件事會直接接下一件）是新的一段，不算
    if (['held', 'fall', 'move'].includes(p.state) && p.stateT > 4) bad.push(`還在 ${p.state}（${p.stateT.toFixed(1)} 秒）`);
    // 放招逗對方（cast）本來就是單方面的：behaviors.js 開始 cast 時刻意把對方的 partner 清掉（對方不用停下來等）。PR-N5 以前檢查剛好碰到 cast 的那一刻會誤判
    if (p.partner && p.partner.partner !== p && !p.group && p.state !== 'cast') bad.push(`partner 是單方面的（${p.state} → ${p.partner.mon.species} ${p.partner.state}）`);
    if (p.onArrive && !['walk', 'trip', 'run', 'approach'].includes(p.state)) bad.push(`不在走路卻留著 onArrive（${p.state}）`);
    if (p.reserved && ['idle', 'sit', 'nap', 'look'].includes(p.state)) bad.push('閒著卻被 reserved');
    if (p.lv && Math.hypot(p.lv.x, p.lv.y) > 0 && ['idle', 'sit', 'nap'].includes(p.state) && p.stateT > 2) bad.push('停著很久了卻還有速度');
    return bad.length ? `${p.mon.species}：${bad.join('、')}` : null;
  }).filter(Boolean));
  const spotOn = sp => page.evaluate(sp => {
    const { stage } = window.__kalos, p = [...stage.pets.values()].find(q => q.mon.species === sp);
    const r = p.rect();
    // 用舞台自己的判斷（stage.petAt）：這個點點下去選到的一定是牠，不是疊在前面的別隻
    for (let v = 0.5; v < 0.95; v += 0.05) for (let u = 0.3; u <= 0.7; u += 0.05) { const x = r.x + r.w * u, y = r.y + r.h * v; if (stage.petAt(x, y) === p) return { x: x / stage.dpr, y: y / stage.dpr }; }
    return null;
  }, sp);
  const stateOf = sp => page.evaluate(sp => { const p = [...window.__kalos.stage.pets.values()].find(q => q.mon.species === sp); return { state: p.state, bout: p.bout?.name ?? null }; }, sp);
  const interrupts = [];
  // 1) 走到一半被拎起來、放下
  await page.evaluate(() => {
    const { stage } = window.__kalos, p = [...stage.pets.values()].find(q => q.mon.species === 650);
    // 其他的先移到下面坐著、不讓別隻找去玩（不然滑鼠可能按到疊在上面的另一隻，要測的那隻也可能被拉去遊行）；
    // 要測的 668、655、656 也先坐著等（測到牠的時候才換）
    const TESTED = [650, 668, 655, 656];
    [...stage.pets.values()].forEach((q, i) => {
      if (q === p) return;
      q.partner = null; q.group = null;
      if (!TESTED.includes(q.mon.species)) { q.x = stage.W * (0.05 + 0.08 * i); q.gy = stage.H * 0.95; q.reserved = true; }
      q.set('sit', 60);
    });
    p.x = stage.W * 0.3; p.gy = stage.H * 0.45; p.target = { x: stage.W * 0.7, y: stage.H * 0.45 }; p.onArrive = () => {}; p.set('walk');
  });
  await page.waitForTimeout(700);
  const g = await spotOn(650);
  if (g) {
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(g.x + i * 3, g.y - i * 10); await page.waitForTimeout(30); }
    interrupts.push(['拎起來', (await stateOf(650)).state]);
    await page.mouse.up();
  } else interrupts.push(['拎起來', '點不到']);
  // 2) 坐著休息時點牠、開選單，再點旁邊空的地方關掉
  await page.evaluate(() => { const { stage } = window.__kalos, p = [...stage.pets.values()].find(q => q.mon.species === 668); p.x = stage.W * 0.5; p.gy = stage.H * 0.75; p.lv = { x: 0, y: 0 }; p.set('sit', 3); });
  await page.waitForTimeout(300);
  const m = await spotOn(668);
  if (m) {
    await page.mouse.click(m.x, m.y);
    const opened = await page.waitForSelector('.bubble:not(.hidden)', { timeout: 3000 }).then(() => true).catch(() => false);
    await page.keyboard.press('Escape'); // 真的按 Esc 關掉（點空白的地方不會關選單）
    const closed = await page.waitForSelector('.bubble.hidden', { state: 'attached', timeout: 2000 }).then(() => true).catch(() => false);
    interrupts.push(['開選單', opened && closed ? '開了' : `開了 ${opened}、關了 ${closed}`]);
  } else interrupts.push(['開選單', '點不到']);
  // 3) 放招式打到旁邊那一隻（放在畫面中間偏右：左上角會跳出故事的全息通訊，選單不能被它蓋住）
  await page.evaluate(() => { const { stage } = window.__kalos, a = [...stage.pets.values()].find(q => q.mon.species === 655), b = [...stage.pets.values()].find(q => q.mon.species === 656); a.x = stage.W * 0.62; a.gy = stage.H * 0.6; b.x = a.x + ((a.asset.w + b.asset.w) / 2 + 20) * stage.S; /* 圖不能疊在一起，不然點到的是前面那隻 */ b.gy = a.gy; a.lv = { x: 0, y: 0 }; b.lv = { x: 0, y: 0 }; /* 各自一個：以前 a.lv = b.lv = {…} 兩隻共用同一個速度，655 放完招走開時 656 坐著也「有速度」（偶爾失敗的原因） */ a.set('sit', 30); b.set('sit', 30); a.facing = 1; });
  await page.waitForTimeout(300);
  const k = await spotOn(655);
  if (k) {
    await page.mouse.click(k.x, k.y);
    const ok = await page.waitForSelector('.bubble:not(.hidden) [data-act="moves"]', { timeout: 3000 }).then(() => true).catch(() => false);
    const owner = await page.evaluate(() => window.__kalos.ui.bubblePet?.mon.species ?? null);
    let st = '沒有招式選單';
    if (ok) {
      await page.click('.bubble [data-act="moves"]'); await page.click('.bubble [data-move]');
      for (let i = 0; i < 10 && st !== 'move'; i++) { st = (await stateOf(655)).state; if (st !== 'move') await page.waitForTimeout(100); }
    }
    interrupts.push(['放招', owner === 655 ? st : `選單是 ${owner} 的`]);
  } else interrupts.push(['放招', '點不到']);
  await page.evaluate(() => { for (const q of window.__kalos.stage.pets.values()) q.reserved = false; }); // 準備用的，放開
  await page.waitForTimeout(5000); // 5 秒內要回到正常
  const leftovers = await clean();
  console.log(`打斷測試：${interrupts.map(([a, b]) => `${a}→${b}`).join('、')}；5 秒後：${leftovers.join('；') || '全部正常'}`);
  check(interrupts[0][1] === 'held', `拎不起來：${JSON.stringify(interrupts)}`);
  check(interrupts[1][1] === '開了', `點了沒有開選單：${JSON.stringify(interrupts)}`);
  check(interrupts[2][1] === 'move', `沒有放招：${JSON.stringify(interrupts)}`);
  check(leftovers.length === 0, `打斷以後 5 秒還沒回到正常：${leftovers.join('；')}`);

  // 每個種子的每一隻都要有在做事（全部卡在同一個狀態＝模擬壞了，量出來的數字沒有意義）
  for (const s of r) for (const [sp, v] of Object.entries(s.per)) check(Object.keys(v.states).length >= 3, `種子 ${s.seed} 的 ${sp} 只做了 ${Object.keys(v.states).join('、')}`);

  // 門檻（PR-N2）：移動做好以後這三個每一隻、每個種子都要過（規格 §7.1，門檻沒動）。
  // M1（瞬間起步）＝ 0（使用者決定在 PR-N4b 起達成；照規格排除被拎、掉落、放招、被打到／被擠、瞬移型習性、「頓一下」）
  for (const s of r) for (const [sp, v] of Object.entries(s.per)) {
    check(v.M1_jumpsPerMin === 0, `M1 瞬間起步：種子 ${s.seed} 的 ${sp} 每分鐘 ${v.M1_jumpsPerMin} 次（要 0）：${JSON.stringify(v.M1_states)}`);
    if (v.M2_slide != null) check(v.M2_slide >= 0.85 && v.M2_slide <= 1.15, `M2 腳打滑：種子 ${s.seed} 的 ${sp} 是 ${v.M2_slide}（要 0.85–1.15）`);
    if (v.M3_pausedWalks != null) check(v.M3_pausedWalks >= 60, `M3 走走停停：種子 ${s.seed} 的 ${sp} 只有 ${v.M3_pausedWalks}%（要 ≥ 60%）`);
    if (v.M4_turnPose != null) check(v.M4_turnPose === 100, `M4 轉身：種子 ${s.seed} 的 ${sp} 只有 ${v.M4_turnPose}%（要 100%）`);
    // 門檻（PR-N3，規格 §7.1 的 M7、M8）：整張圖只准翻面或轉 90° 的倍數、不縮放；沒有原圖以外的顏色；部位不超過上限；姿勢不跳格
    check(v.M7_rotFrames === 0 && v.M7_scaleFrames === 0, `M7 整張圖被轉（不是 90° 倍數）${v.M7_rotFrames} 幀、被縮放 ${v.M7_scaleFrames} 幀：種子 ${s.seed} 的 ${sp}`);
    check(v.M7_newColors === 0, `M7 原圖沒有的顏色：種子 ${s.seed} 的 ${sp} 有 ${v.M7_newColors} 種`);
    check(v.M7_partMax != null && v.M7_partMax <= v.M7_partLimit + 1e-9, `M7 部位角度：種子 ${s.seed} 的 ${sp} 轉到 ${v.M7_partMax}（上限 ${v.M7_partLimit}）`);
    check(!v.once_repeat, `只做一次的（練招式、沒有對象的習性）一段裡又重新開始 ${v.once_repeat} 次：種子 ${s.seed} 的 ${sp}`);
    check(v.M8_maxStep != null && v.M8_maxStep <= 1, `M8 姿勢跳格：種子 ${s.seed} 的 ${sp} 相鄰兩幀有參數一次變 ${v.M8_maxStep} 級：${v.M8_steps.join('；')}`);
  }
  { const all = r.flatMap(s => Object.values(s.per)); console.log(`只做一次的（練招式、沒有對象的習性）：量到 ${all.reduce((a, v) => a + (v.once_bouts ?? 0), 0)} 段，又重新開始 ${all.reduce((a, v) => a + (v.once_repeat ?? 0), 0)} 次`); }
  // M8 的「每分鐘換狀態 ≤ 表的值」：使用者決定照模板給每一種自己的上限（core/ethogram.js 的 switchMaxAt），PR-N5 起每一隻都要過。
  // 用每一隻 3 個種子合起來（30 分鐘）的平均：同一隻 10 分鐘一段差很多（量過同一隻 1.9–7.7），一段 10 分鐘量的是運氣，不是牠的節奏。每個種子的也印出來
  for (const sp of Object.keys(r[0].per)) {
    const rates = r.map(s => s.per[sp].M8_changesPerMin), max = r[0].per[sp].M8_max, avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    console.log(`M8 ${sp}：每分鐘換 ${avg.toFixed(1)} 次（上限 ${max}；各種子 ${rates.join('／')}）`);
    check(max != null && avg <= max, `M8 換狀態太頻繁：${sp} 30 分鐘平均每分鐘 ${avg.toFixed(1)} 次（上限 ${max}；各種子 ${rates.join('／')}）`);
  }
  // M9（不同步，使用者同意的門檻修改）：規格原本是「66 對取最大值 < 0.3」，但休息變長以後，連不同種子的兩隻（一定不相干）最大值也有 0.2–0.4，
  // 量不出同步。改成：實際量到的最大值 ≤ 不相干配對「一樣多對取最大」的 99 百分位＝不比純巧合更同步（算法見上面的 M9_test）
  console.log(`M9：實際最大 ${M9_test.real}（${M9_test.realPair}）；不相干時（${M9_test.pairs} 對取最大）中位數 ${M9_test.p50}、99 百分位 ${M9_test.p99}`);
  check(M9_test.real <= M9_test.p99, `M9 不同步：實際最大 ${M9_test.real}（${M9_test.realPair}）比不相干時的 99 百分位 ${M9_test.p99} 還高`);

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
      M7: { rot: worst('M7_rot'), scale: worst('M7_scale'), newColors: worst('M7_newColors'), partMax: worst('M7_partMax'), frames: worst('M7_frames') },
      M8: { overMax: Object.values(s.per).filter(v => v.M8_max != null && v.M8_changesPerMin > v.M8_max).length, changesMedian: med(col('M8_changesPerMin')), changesWorst: worst('M8_changesPerMin'), boutMedian: med(col('M8_medianBout')), bigSwitchWorst: worst('M8_bigSwitchPct'), maxStep: worst('M8_maxStep'), switchStep: worst('M8_switchStep') },
      M9: { ...s.M9_corr, nullMax: s.M9_null?.max },
    };
  });
  const out = path.join(ROOT, '.cache/natural');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `natural-${TAG}.json`), JSON.stringify({ minutes: MIN, seconds: secs, legs, summary, M9_test, seeds: r }, null, 1));
  console.log(`表寫有腳、木偶切不出腳（${legs.missing.length} 隻）：${legs.missing.join('、') || '無'}`);
  console.log(`表的體型沒寫腳、木偶切出腳（${legs.extra.length} 隻，參考）：${legs.extra.join('、') || '無'}`);
  console.log(JSON.stringify(summary));
  for (const s of r) console.log(`種子 ${s.seed}：` + Object.entries(s.per).map(([sp, v]) => `${sp} 動${v.moving}% 換${v.M8_changesPerMin}/分 [${Object.entries(v.M5_share).map(([k, x]) => k + x).join(' ')}]`).join(' | '));
  console.log(`模擬 ${MIN} 分鐘 × ${SEEDS.length} 個種子，花了 ${secs.toFixed(0)} 秒`);
};

run('natural', test);
