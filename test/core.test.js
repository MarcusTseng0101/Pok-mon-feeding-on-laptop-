import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import * as amie from '../src/core/amie.js';
import { catchProbability, rollCatch, ringBonus } from '../src/core/capture.js';
import { planSpawn, speciesWeights, activeModifiers, rollSpecial, nextSpawnDelay } from '../src/core/encounter.js';
import { checkEvolution } from '../src/core/evolution.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 8, 25, 14, 0).getTime(); // 週五下午
const ctxAt = (hour, extra = {}) => ({ hour, weekday: 5, cpuHot: false, justPluggedIn: false, returnedFromIdle: false, lure: null, ...extra });

function newGame(seed = 1, t = T0) {
  let clock = t;
  const game = new Game({ dex, state: defaultSave(t), rng: createRng(seed), now: () => clock });
  game.advance = ms => { clock += ms; };
  return game;
}

test('圖鑑資料：72 種，每一種都有繁中名稱、敘述、屬性', () => {
  assert.equal(dex.all.length, 72);
  for (const s of dex.all) {
    assert.ok(s.name.zh, `${s.id} 缺名稱`);
    assert.ok(s.flavor, `${s.id} 缺敘述`);
    assert.ok(s.types.length >= 1);
  }
  assert.equal(dex.stage(650), 1);
  assert.equal(dex.stage(652), 3);
  assert.equal(dex.stage(700), 1, '仙子伊布的伊布不在範圍內，視為第一階段');
  assert.equal(dex.habitat(661), 'grass', '小箭雀在地上跳');
  assert.equal(dex.habitat(662), 'sky');
  assert.equal(dex.habitat(686), 'dusk');
});

test('心數門檻與原作寶可夢交流相同', () => {
  assert.deepEqual([0, 1, 49, 50, 100, 150, 254, 255].map(amie.hearts), [0, 1, 1, 2, 3, 4, 4, 5]);
});

test('性格喜好：固執喜歡辣、討厭澀；勤奮沒有偏好', () => {
  assert.equal(amie.tasteReaction(dex.nature('adamant'), 'spice'), 'liked');
  assert.equal(amie.tasteReaction(dex.nature('adamant'), 'mint'), 'disliked');
  assert.equal(amie.tasteReaction(dex.nature('hardy'), 'spice'), 'neutral');
});

test('吃太飽會拒絕；喜歡的口味好感加成 1.5 倍', () => {
  const mon = { affection: 0, fullness: 0, enjoyment: 0, xp: 0 };
  const r = amie.feed(mon, 'spice-basic', dex.nature('adamant'));
  assert.equal(r.reaction, 'liked');
  assert.equal(r.affectionGain, 4.5);
  mon.fullness = 220;
  assert.equal(amie.feed(mon, 'spice-basic', dex.nature('adamant')).reason, 'full');
});

test('撫摸：滿足感滿了之後不再增加好感', () => {
  const mon = { affection: 0, fullness: 0, enjoyment: 250, xp: 0 };
  assert.ok(amie.stroke(mon).affectionGain > 0);
  assert.equal(mon.enjoyment, 255);
  assert.equal(amie.stroke(mon).affectionGain, 0);
});

test('捕獲率：常見的容易、傳說的難但不是零，球與時機有加成', () => {
  const easy = catchProbability(255);
  const hard = catchProbability(3);
  assert.ok(easy > 0.8 && easy <= 0.97);
  assert.ok(hard >= 0.02 && hard < 0.05);
  const best = catchProbability(3, { ball: 'ultra', ringMult: ringBonus(0.3).mult, puff: 'liked' });
  assert.ok(best > 0.1, `最佳條件下傳說寶可夢應有一成以上：${best}`);
  assert.ok(catchProbability(45, { ball: 'great' }) > catchProbability(45));
});

test('rollCatch 的實際成功率符合 p', () => {
  const rng = createRng(42);
  for (const p of [0.1, 0.5, 0.9]) {
    let caught = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (rollCatch(p, rng).caught) caught++;
    assert.ok(Math.abs(caught / N - p) < 0.015, `p=${p} 實測 ${caught / N}`);
  }
});

test('遭遇：一般情況不會出現傳說、幻之寶可夢或仙子伊布', () => {
  const state = defaultSave(T0);
  const ids = new Set(speciesWeights(ctxAt(14), state, dex).filter(w => w.w > 0).map(w => w.id));
  for (const id of [700, 716, 717, 718, 719, 720, 721]) assert.ok(!ids.has(id), `${id} 不該出現`);
  const rng = createRng(3);
  for (let i = 0; i < 500; i++) assert.equal(planSpawn(ctxAt(14), state, dex, rng).special, false);
});

test('遭遇：電腦很燙時火屬性明顯變多；夜晚鬼火變多', () => {
  const state = defaultSave(T0);
  const share = (ctx, pred) => {
    const ws = speciesWeights(ctx, state, dex);
    const total = ws.reduce((s, w) => s + w.w, 0);
    return ws.filter(w => pred(w.id)).reduce((s, w) => s + w.w, 0) / total;
  };
  const isFire = id => dex.get(id).types.includes('fire');
  assert.ok(share(ctxAt(14, { cpuHot: true }), isFire) > share(ctxAt(14), isFire) * 2);
  const isDusk = id => dex.habitat(id) === 'dusk';
  assert.ok(share(ctxAt(23), isDusk) > share(ctxAt(14), isDusk) * 3);
  assert.ok(activeModifiers(ctxAt(23), dex).some(m => m.id === 'night'));
});

test('遭遇：有好感滿點的夥伴才會遇到仙子伊布', () => {
  const state = defaultSave(T0);
  state.mons.push({ affection: 255 });
  assert.ok(speciesWeights(ctxAt(14), state, dex).find(w => w.id === 700).w > 0);
});

test('基格爾德核心集滿 10 顆必定遇到基格爾德', () => {
  const state = defaultSave(T0);
  state.zygardeCells = 10;
  assert.equal(rollSpecial(ctxAt(14), state, createRng(1)), 718);
});

test('生成間隔：誘餌讓等待變短', () => {
  const a = createRng(7), b = createRng(7);
  assert.ok(nextSpawnDelay('normal', ctxAt(14, { lure: 'sweet' }), a) < nextSpawnDelay('normal', ctxAt(14), b));
});

test('進化條件：等級換算成長值、白天限定、倒立', () => {
  const mon = { species: 650, affection: 0, xp: 127 };
  assert.equal(checkEvolution(mon, dex, ctxAt(14)).ready, false);
  mon.xp = 128;
  assert.equal(checkEvolution(mon, dex, ctxAt(14)).ready, true);
  const tyrunt = { species: 696, affection: 0, xp: 999 };
  assert.equal(checkEvolution(tyrunt, dex, ctxAt(22)).ready, false);
  assert.equal(checkEvolution(tyrunt, dex, ctxAt(12)).ready, true);
  const inkay = { species: 686, affection: 0, xp: 999 };
  assert.deepEqual(checkEvolution(inkay, dex, ctxAt(12)).blockers.map(b => b.id), ['upsideDown']);
  assert.equal(checkEvolution(inkay, dex, { ...ctxAt(12), heldUpsideDown: true }).ready, true);
  const pancham = { species: 674, affection: 0, xp: 999 };
  assert.equal(checkEvolution(pancham, dex, { ...ctxAt(12), outTypes: new Set(['dark']) }).ready, true);
  assert.equal(checkEvolution({ species: 652, affection: 0, xp: 0 }, dex, ctxAt(12)), null);
});

test('Game：選御三家、每日禮物只發一次', () => {
  const g = newGame();
  const gifts = [];
  g.on('dailyGift', x => gifts.push(x));
  g.catchUp();
  g.catchUp();
  assert.equal(gifts.length, 1);
  const mon = g.chooseStarter(653);
  assert.equal(mon.out, true);
  assert.equal(g.chooseStarter(650), null, '只能選一次');
  assert.equal(g.caughtCount(), 1);
});

test('Game：捕獲流程會扣球、登記圖鑑、給新種獎勵', () => {
  const g = newGame(11);
  g.catchUp();
  let wild, r, tries = 0;
  do {
    wild = g.startEncounter({ speciesId: 659, spot: 'grass', shiny: false, nature: 'jolly' });
    const before = g.state.bag.balls.ultra;
    r = g.throwBall(wild, 'ultra', 1.7);
    assert.equal(g.state.bag.balls.ultra, before - 1 + (r.rewards?.balls.ultra ?? 0));
    g.state.bag.balls.ultra += 1;
  } while (!r.caught && ++tries < 20);
  assert.ok(r.caught);
  assert.equal(r.isNewSpecies, true);
  assert.equal(g.state.dex[659].caught, 1);
  assert.ok(g.state.dex[659].seen >= 1);
  assert.equal(g.throwBall(wild, 'poke').ok, false, '同一隻不能再丟');
});

test('Game：沒有泡芙不能餵；餵了會扣掉', () => {
  const g = newGame();
  const mon = g.chooseStarter(650);
  g.state.bag.puffs['mint-deluxe'] = 0;
  assert.equal(g.feed(mon.uid, 'mint-deluxe').reason, 'no-puff');
  g.state.bag.puffs['mint-deluxe'] = 1;
  mon.fullness = 0;
  assert.equal(g.feed(mon.uid, 'mint-deluxe').ok, true);
  assert.equal(g.state.bag.puffs['mint-deluxe'], 0);
});

test('Game：最多 6 隻在桌面上', () => {
  const g = newGame();
  for (let i = 0; i < 8; i++) g.state.mons.push(g.createMon(659));
  const results = g.state.mons.map(m => g.setOut(m.uid, true));
  assert.equal(results.filter(Boolean).length, 6);
});

test('Game：離線最多扣 24 小時的飽足感', () => {
  const g = newGame();
  const mon = g.chooseStarter(656);
  mon.fullness = 255;
  mon.enjoyment = 255;
  g.state.lastSeenAt = T0 - 3 * 24 * 3600 * 1000;
  g.catchUp();
  assert.equal(mon.fullness, 0);
  assert.equal(mon.enjoyment, 0);
  assert.ok(mon.affection > 0, '好感不會因離線下降');
});

test('Game：進化會登記新圖鑑', () => {
  const g = newGame();
  const mon = g.chooseStarter(656);
  mon.xp = 999;
  const r = g.evolve(mon.uid);
  assert.deepEqual([r.from, r.to], [656, 657]);
  assert.equal(g.state.dex[657].caught, 1);
});

test('存檔 migrate：壞資料會被修好', () => {
  const s = migrate({
    bag: { balls: { poke: -5, great: 'x' } },
    mons: [{ uid: 'a', species: 650, affection: 999, out: true }, { uid: 'b', species: 1 }],
    dex: { 650: { seen: 1, caught: 1 }, 25: { seen: 1 } },
  }, dex, T0);
  assert.equal(s.bag.balls.poke, 0);
  assert.equal(s.bag.balls.great, 0);
  assert.equal(s.mons.length, 1);
  assert.equal(s.mons[0].affection, 255);
  assert.deepEqual(Object.keys(s.dex), ['650']);
  assert.equal(s.starterChosen, true);
  assert.equal(migrate(null, dex, T0).version, 1);
});

test('存檔 migrate：桌面位置保留下來，壞掉的位置丟掉', () => {
  const base = { uid: 'a', species: 650, nature: 'hardy' };
  const s = migrate({
    mons: [
      { ...base, uid: 'a', pos: { x: 0.3, y: 0.7 } },
      { ...base, uid: 'b', pos: { x: 3, y: -1 } },
      { ...base, uid: 'c', pos: { x: 'left' } },
      { ...base, uid: 'd' },
    ],
  }, dex, T0);
  assert.deepEqual(s.mons.map(m => m.pos), [{ x: 0.3, y: 0.7 }, { x: 1, y: 0 }, null, null]);
});

// ---------- 色違與連鎖 ----------
import { shinyChance, shinyRolls, chainRolls, BASE_ODDS, CHARM_AT } from '../src/core/shiny.js';
import { bondLevel } from '../src/core/game.js';

// 一定抓得到的捕獲（反覆丟到抓到為止）
function catchOne(g, speciesId, shiny = false) {
  for (let i = 0; i < 200; i++) {
    const wild = g.startEncounter({ speciesId, spot: 'grass', shiny, nature: 'hardy' });
    g.state.bag.balls.ultra += 1;
    const saved = { ...g.state.chain };
    const r = g.throwBall(wild, 'ultra', 1.7);
    if (r.caught) return r;
    g.state.chain = saved; // 測試只關心抓到的結果，逃走不算
  }
  throw new Error('抓不到');
}

test('色違：基本 1/512，護符、連鎖、豪華泡芙誘餌會提高', () => {
  const s = defaultSave(T0);
  assert.ok(Math.abs(shinyChance(s, 659) - 1 / BASE_ODDS) < 1e-12);
  s.shinyCharm = true;
  assert.equal(shinyRolls(s, 659), 3);
  s.chain = { species: 659, count: 30 };
  assert.equal(shinyRolls(s, 659), 3 + chainRolls(30));
  assert.equal(shinyRolls(s, 661), 3, '連鎖只對同一種有效');
  assert.equal(shinyRolls(s, 661, { lureTier: 'deluxe' }), 5);
  assert.ok(shinyChance(s, 659) > 10 / BASE_ODDS);
});

test('連鎖：同種連續捕獲會累積、抓別種重新計算、連鎖中的那一種逃走就中斷', () => {
  const g = newGame(5);
  g.catchUp();
  const events = [];
  g.on('chain', e => events.push(e.count));
  g.on('chainBroken', e => events.push(-e.count));
  for (let i = 0; i < 5; i++) catchOne(g, 659);
  assert.deepEqual(g.state.chain, { species: 659, count: 5 });
  assert.ok(events.includes(5));
  // 連鎖中的物種比較常出現
  const w = speciesWeights(ctxAt(14), g.state, dex);
  const base = speciesWeights(ctxAt(14), defaultSave(T0), dex);
  assert.ok(w.find(x => x.id === 659).w > base.find(x => x.id === 659).w * 1.5);
  // 別種逃走不影響
  g.wildGone(g.startEncounter({ speciesId: 661, spot: 'sky', shiny: false, nature: 'hardy' }));
  assert.equal(g.state.chain.count, 5);
  // 同種逃走：中斷
  g.wildGone(g.startEncounter({ speciesId: 659, spot: 'grass', shiny: false, nature: 'hardy' }));
  assert.equal(g.state.chain.count, 0);
  assert.ok(events.includes(-5));
  catchOne(g, 659);
  catchOne(g, 661);
  assert.deepEqual(g.state.chain, { species: 661, count: 1 });
});

test('色違：抓到會記在圖鑑；進化後新的形態也算色違；捕獲 60 種拿到閃耀護符', () => {
  const g = newGame(9);
  g.catchUp();
  const r = catchOne(g, 656, true);
  assert.equal(r.mon.shiny, true);
  assert.equal(g.state.dex[656].shiny, 1);
  assert.equal(g.state.stats.shinies, 1);
  r.mon.xp = 999;
  g.evolve(r.mon.uid);
  assert.equal(g.state.dex[657].shiny, 1);
  assert.equal(g.shinySpeciesCount(), 2);
  let charm = 0;
  g.on('charm', () => charm++);
  for (const id of dex.ids.slice(0, CHARM_AT)) g.state.dex[id] = { seen: 1, caught: 1, shiny: 0 };
  catchOne(g, 659);
  assert.equal(g.state.shinyCharm, true);
  assert.equal(charm, 1);
});

test('夥伴感情：累積、升級通知、找出最好的朋友、存檔清掉不存在的夥伴', () => {
  const g = newGame(3);
  g.catchUp();
  const a = g.chooseStarter(650);
  const b = catchOne(g, 659).mon, c = catchOne(g, 661).mon;
  const ups = [];
  g.on('bondUp', e => ups.push(e.level));
  for (let i = 0; i < 35; i++) g.bond(a.uid, b.uid);
  g.bond(c.uid, a.uid, 10);
  assert.equal(g.bondOf(b.uid, a.uid), 35);
  assert.deepEqual(ups, [1]);
  assert.equal(g.bestFriend(a.uid).uid, b.uid);
  assert.equal(bondLevel(120), 2);
  assert.equal(g.bond(a.uid, a.uid), null);
  const s = migrate({ ...g.state, bonds: { ...g.state.bonds, 'x|y': 50, [`${a.uid}|${b.uid}`]: 999 } }, dex, T0);
  assert.equal(Object.keys(s.bonds).length, 2);
  assert.equal(Object.values(s.bonds).sort((x, y) => y - x)[0], 255);
});
