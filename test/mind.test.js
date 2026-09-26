// v3 PR 1：心智（需求、個性、心情、理由）和記憶
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRng } from '../src/core/rng.js';
import * as M from '../src/core/mind.js';
import * as mem from '../src/core/memory.js';
import { createDex } from '../src/core/dex.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import { mergeShared } from '../src/core/sync.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 8, 25, 14, 0).getTime();
const HOUR = 3_600_000;

// 模擬一隻寶可夢一小時：每 10 秒做一次決定（照倍率抽類別），需求隨時間變化
function simulate(seed, { minutes = 60, nature = 'hardy' } = {}) {
  const rng = createRng(seed);
  const mind = M.createMind(rng);
  const mon = { fullness: 120, enjoyment: 120 };
  const traits = M.traitsOf(nature);
  const log = [];
  let asleepFor = 0;
  for (let t = 0; t < minutes * 60; t += 10) {
    M.tickNeeds(mind, 10, { activity: asleepFor > 0 ? 'sleep' : null });
    mon.fullness = Math.max(0, mon.fullness - 10 / 120); // 飽足感每 2 分鐘 −1
    mon.enjoyment = Math.max(0, mon.enjoyment - 10 / 60);
    asleepFor = Math.max(0, asleepFor - 10);
    const lv = M.levels(mind, mon);
    const w = M.weights(mind, lv, traits);
    const total = M.CATEGORIES.reduce((s, c) => s + w[c], 0);
    let r = rng() * total, cat = M.CATEGORIES[0];
    for (const c of M.CATEGORIES) { r -= w[c]; if (r <= 0) { cat = c; break; } }
    const d = M.satisfy(mind, cat, { name: cat === 'rest' && rng() < 0.3 ? 'nap' : null, food: lv.food });
    if (d.fullness) mon.fullness = Math.min(255, mon.fullness + d.fullness);
    if (d.enjoyment) mon.enjoyment = Math.min(255, mon.enjoyment + d.enjoyment);
    if (cat === 'rest' && lv.energy < 30) asleepFor = 60;
    log.push({ t, cat, lv: { ...M.levels(mind, mon) }, w });
  }
  return log;
}

test('同一個種子跑兩次結果一樣', () => {
  assert.deepEqual(simulate(7), simulate(7));
  assert.notDeepEqual(simulate(7), simulate(8));
});

test('需求不會卡在 0 或 100 超過 5 分鐘（模擬 1 小時）', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const nature of ['hardy', 'timid', 'lax', 'jolly']) {
      const log = simulate(seed, { nature });
      for (const k of M.NEEDS) {
        let run = 0, worst = 0;
        for (const e of log) {
          const stuck = e.lv[k] <= 0.5 || (e.lv[k] >= 99.5 && !['food', 'fun'].includes(k)); // 吃飽、玩夠了一直是滿的沒關係
          run = stuck ? run + 10 : 0;
          worst = Math.max(worst, run);
        }
        assert.ok(worst <= 300, `種子 ${seed} ${nature}：${k} 卡住 ${worst} 秒`);
      }
    }
  }
});

test('倍率一定在 [0.25, 4]，而且不會只做一件事', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const log = simulate(seed);
    const count = {};
    for (const e of log) {
      for (const c of M.CATEGORIES) assert.ok(e.w[c] >= M.MULT_MIN && e.w[c] <= M.MULT_MAX, `${c}=${e.w[c]}`);
      count[e.cat] = (count[e.cat] ?? 0) + 1;
    }
    const max = Math.max(...Object.values(count)) / log.length;
    assert.ok(max <= 0.45, `種子 ${seed} 的分布太集中：${JSON.stringify(count)}`);
    assert.ok(Object.keys(count).length >= 6, `種子 ${seed} 只做了 ${Object.keys(count)}`);
  }
});

test('缺什麼就比較想做什麼；做膩了會換', () => {
  const mind = { ...M.createMind(() => 0.9), recent: [] };
  const lv = { food: 100, fun: 90, energy: 10, social: 95, curiosity: 95, comfort: 95 };
  const w = M.weights(mind, lv, M.traitsOf('hardy'));
  assert.ok(w.rest > 2 && w.rest > w.explore * 2, JSON.stringify(w));
  assert.equal(w.need, M.MULT_MIN, '不餓就不會去找吃的');
  const hungry = M.weights(mind, { ...lv, energy: 90, food: 10 }, M.traitsOf('lax'));
  assert.ok(hungry.need >= 3, JSON.stringify(hungry));
  mind.recent = ['rest', 'rest', 'rest'];
  const bored = M.weights(mind, lv, M.traitsOf('hardy'));
  assert.ok(bored.rest < w.rest * 0.5, '連續做 3 次會膩');
  // 個性：外向的比害羞的想找人玩
  const lonely = { ...lv, energy: 90, social: 20 };
  assert.ok(M.weights({ recent: [] }, lonely, M.traitsOf('jolly')).social > M.weights({ recent: [] }, lonely, M.traitsOf('bashful')).social);
});

test('滿足需求：做了就會回升；自己找吃的只能不餓，吃不飽', () => {
  const mind = { energy: 20, social: 20, curiosity: 20, comfort: 20, recent: [], thoughts: [] };
  M.satisfy(mind, 'explore');
  assert.equal(mind.curiosity, 50);
  M.satisfy(mind, 'social');
  assert.equal(mind.social, 50);
  M.satisfy(mind, 'rest', { name: 'nap' });
  assert.equal(mind.energy, 43);
  assert.deepEqual(M.satisfy(mind, 'need', { food: 30 }), { fullness: 22 });
  assert.deepEqual(M.satisfy(mind, 'need', { food: 100 }), {});
  assert.deepEqual(mind.recent, ['explore', 'social', 'rest', 'need', 'need']);
  // 睡覺恢復體力
  M.tickNeeds(mind, 60, { activity: 'sleep' });
  assert.equal(mind.energy, 51);
});

test('理由：每個類別每種情況至少 3 句；理由的 key 屬於那個類別', () => {
  for (const [cat, subs] of Object.entries(M.REASONS)) for (const [sub, list] of Object.entries(subs)) {
    assert.ok(list.length >= 3, `${cat}.${sub} 只有 ${list.length} 句`);
    assert.equal(new Set(list).size, list.length);
  }
  const rng = createRng(3);
  const lv = { food: 100, fun: 80, energy: 30, social: 30, curiosity: 30, comfort: 80 };
  for (const cat of M.CATEGORIES) {
    const r = M.reason(cat, lv, rng, { other: { name: '哈力栗', bond: 120, rivalry: 0 } });
    assert.ok(r.key.startsWith(`${cat}.`), `${cat} → ${r.key}`);
    assert.ok(r.text.length > 0 && !r.text.includes('{'), r.text);
  }
  assert.equal(M.reason('rest', lv, rng).key, 'rest.energy');
  assert.equal(M.citesOf('rest.energy'), 'need');
  assert.match(M.reason('social', lv, rng, { other: { name: '哈力栗', bond: 120, rivalry: 0 } }).text, /哈力栗/);
  assert.equal(M.reason('social', lv, rng, { other: { name: 'A', bond: 10, rivalry: 3 } }).key, 'social.rival');
  assert.equal(M.reason('social', lv, rng, { other: { name: 'A', bond: 10, rivalry: 0 }, playedWithOther: true }).key, 'social.memory');
  assert.equal(M.citesOf('social.memory'), 'memory');
  assert.equal(M.citesOf('social.friend'), 'relation');
  assert.equal(M.reason('play', lv, rng, { recentFed: true }).key, 'play.memory');
});

test('心情', () => {
  const base = { food: 80, fun: 80, energy: 80, social: 80, curiosity: 80, comfort: 80 };
  assert.equal(M.moodOf(base), 'happy');
  assert.equal(M.moodOf({ ...base, energy: 10 }), 'sleepy');
  assert.equal(M.moodOf({ ...base, social: 10 }), 'lonely');
  assert.equal(M.moodOf(base, { lostRecently: true }), 'grumpy');
  assert.equal(M.moodOf({ ...base, fun: 40, energy: 40, social: 40 }), 'calm');
});

test('個性：25 種性格都有，數值在 0–1', () => {
  for (const n of dex.natures) {
    const t = M.NATURE_TRAITS[n.slug];
    assert.ok(t, `沒有 ${n.slug}`);
    for (const v of Object.values(t)) assert.ok(v >= 0 && v <= 1);
  }
});

test('記憶：上限、合併重複、忘掉最不重要的、摘要', () => {
  const list = [];
  mem.remember(list, { k: 'stroked' }, T0);
  mem.remember(list, { k: 'stroked' }, T0 + 60_000); // 10 分鐘內重複只記一次
  assert.equal(list.length, 1);
  assert.equal(list[0].at, T0 + 60_000);
  mem.remember(list, { k: 'user-away', data: { hours: 9 } }, T0 + HOUR);
  for (let i = 0; i < 60; i++) mem.remember(list, { k: 'tripped' }, T0 + 2 * HOUR + i * 11 * 60_000);
  assert.equal(list.length, mem.MAX_EVENTS);
  assert.ok(list.some(e => e.k === 'user-away'), '重要的事不會先被忘掉');
  const s = mem.summary(list, T0 + 20 * HOUR, 3);
  assert.equal(s[0].text, '等你等了9個小時');
  assert.equal(mem.recall(list, { k: 'user-away' }).length, 1);
  // 壞掉的資料
  assert.deepEqual(mem.normalizeMemory([{ k: 'nope', at: 1 }, { k: 'fed' }, null, { k: 'won', at: 5, with: 'x', data: { name: 'a'.repeat(99), evil: '<script>' } }]),
    [{ k: 'won', at: 5, with: 'x', data: { name: 'a'.repeat(24) } }]);
});

test('Game：被餵、被摸、切磋、朋友來了都會記得；存檔讀回來一樣', () => {
  let t = T0;
  const game = new Game({ dex, state: defaultSave(T0), rng: createRng(1), now: () => t });
  game.chooseStarter(650);
  const a = game.state.mons[0];
  const b = game.createMon(653); b.out = true; game.state.mons.push(b);
  assert.ok(a.mind && Number.isFinite(a.mind.energy) && Array.isArray(a.memory));
  game.state.bag.puffs['sweet-basic'] = 1;
  game.feed(a.uid, 'sweet-basic');
  t += 20 * 60_000;
  game.stroke(a.uid);
  game.duelResult(a.uid, b.uid);
  game.duelResult(a.uid, b.uid);
  assert.equal(game.rivalryOf(a.uid, b.uid), 2);
  game.playedTogether(a.uid, b.uid);
  assert.deepEqual(a.memory.map(e => e.k), ['fed', 'stroked', 'won', 'played-with']);
  assert.deepEqual(b.memory.map(e => e.k), ['lost', 'played-with']);
  assert.equal(b.memory[0].data.name, game.displayName(a));
  // 離開 5 小時
  game.state.lastSeenAt = t;
  t += 5 * HOUR;
  game.catchUp();
  assert.ok(a.memory.some(e => e.k === 'user-away' && e.data.hours === 5));
  const back = migrate(JSON.parse(JSON.stringify(game.state)), dex, t);
  assert.deepEqual(back.mons[0].memory, a.memory);
  assert.deepEqual(back.mons[0].mind, a.mind);
  assert.equal(back.rivalries[Object.keys(game.state.rivalries)[0]], 2);
});

test('舊存檔沒有心智：補上固定的起始值（每次讀都一樣）', () => {
  const raw = { ...defaultSave(T0), starterChosen: true, mons: [{ uid: 'old1', species: 650, nature: 'timid', caughtAt: T0 }] };
  const x = migrate(structuredClone(raw), dex, T0).mons[0];
  const y = migrate(structuredClone(raw), dex, T0).mons[0];
  assert.deepEqual(x.mind, y.mind);
  assert.deepEqual(x.memory, []);
  for (const k of ['energy', 'social', 'curiosity', 'comfort']) assert.ok(x.mind[k] >= 45 && x.mind[k] <= 90);
});

test('同步：記憶取聯集、競爭心取最大；對調結果一樣、合併兩次一樣', () => {
  const base = migrate({ ...defaultSave(T0), starterChosen: true, mons: [{ uid: 'm1', species: 650, caughtAt: T0 }, { uid: 'm2', species: 653, caughtAt: T0 }] }, dex, T0);
  const A = structuredClone(base), B = structuredClone(base);
  mem.remember(A.mons[0].memory, { k: 'stroked' }, T0 + 1000);
  mem.remember(B.mons[0].memory, { k: 'won', with: 'm2', data: { name: '呆火狐' } }, T0 + 2000);
  A.rivalries['m1|m2'] = 1;
  B.rivalries['m1|m2'] = 3;
  const ab = mergeShared(A, B), ba = mergeShared(B, A);
  assert.deepEqual(ab.mons[0].memory.map(e => e.k), ['stroked', 'won']);
  assert.deepEqual(ab.mons[0].memory, ba.mons[0].memory);
  assert.equal(ab.rivalries['m1|m2'], 3);
  assert.deepEqual(mergeShared(ab, B).mons[0].memory, ab.mons[0].memory);
});

test('存檔大小：3 隻、30 天的事件，存檔小於 400 KB', () => {
  let t = T0;
  const game = new Game({ dex, state: defaultSave(T0), rng: createRng(2), now: () => t });
  game.chooseStarter(650);
  for (const id of [653, 656]) { const m = game.createMon(id); m.out = true; game.state.mons.push(m); }
  const [a, b, c] = game.state.mons;
  for (let i = 0; i < 30 * 24 * 4; i++) {
    t += 15 * 60_000;
    game.stroke(a.uid);
    game.playedTogether(b.uid, c.uid);
    if (i % 3 === 0) game.duelResult(a.uid, c.uid);
  }
  const size = JSON.stringify(game.state).length;
  assert.ok(size < 400_000, `${size}`);
  for (const m of game.state.mons) assert.ok(m.memory.length <= mem.MAX_EVENTS);
});
