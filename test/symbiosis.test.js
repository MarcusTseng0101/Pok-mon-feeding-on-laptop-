// 共生（core/symbiosis.js）：休息的果實、花草、一起累、你出現了
//   F1：從你的行為來的效果只加不減（熬夜 3 天，共生這條路不扣任何數值）
//   F4：一天最多 4 顆，一顆是半個普通泡芙
//   F5：一天從 05:00 開始（04:59 吃的算前一天）
//   F6：兩台電腦同一天取最大值，不相加
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Sym from '../src/core/symbiosis.js';
import * as R from '../src/core/routine.js';
import { TIERS } from '../src/core/amie.js';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import { mergeShared } from '../src/core/sync.js';
import { PLACES } from '../src/core/trips.js';

const MIN = 60_000, HOUR = 60 * MIN;
const at = (y, mo, d, h, m = 0) => new Date(y, mo - 1, d, h, m).getTime();
const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));

// 每分鐘 tick 一次，從 from 到 to，一直在用電腦
function use(s, from, to, routine = null) {
  const evs = [];
  for (let t = from; t <= to; t += MIN) evs.push(...Sym.tick(s, t, { idleSeconds: 0 }, routine).map(e => ({ ...e, t })));
  return evs;
}

test('連續用電腦 90 分鐘前不給果實；到了給一顆，而且只給一顆', () => {
  const s = Sym.defaultSymbiosis(), t0 = at(2026, 9, 26, 9);
  const before = use(s, t0, t0 + 89 * MIN);
  assert.equal(before.filter(e => e.type === 'fruitOffered').length, 0);
  const after = use(s, t0 + 90 * MIN, t0 + 200 * MIN);
  assert.equal(after.filter(e => e.type === 'fruitOffered').length, 1, '沒離開就一直放著，不變多');
  assert.ok(s.fruit);
});

test('中間停一下（不到 3 分鐘）還是算連續；離開 3 分鐘才重新算', () => {
  const s = Sym.defaultSymbiosis(), t0 = at(2026, 9, 26, 9);
  use(s, t0, t0 + 40 * MIN);
  Sym.tick(s, t0 + 41 * MIN, { idleSeconds: 90 }); // 看文章停了 90 秒
  const evs = use(s, t0 + 42 * MIN, t0 + 91 * MIN);
  assert.equal(evs.filter(e => e.type === 'fruitOffered').length, 1, '停 90 秒不算休息');

  const s2 = Sym.defaultSymbiosis();
  use(s2, t0, t0 + 60 * MIN);
  Sym.tick(s2, t0 + 61 * MIN, { idleSeconds: 200 });
  assert.equal(use(s2, t0 + 62 * MIN, t0 + 100 * MIN).filter(e => e.type === 'fruitOffered').length, 0, '離開過了，要重新算 90 分鐘');
});

test('沒離開就不會被吃；離開 3 分鐘 → 吃掉、今天有休息、花草長一級', () => {
  const s = Sym.defaultSymbiosis(), t0 = at(2026, 9, 26, 9);
  use(s, t0, t0 + 95 * MIN);
  assert.ok(s.fruit);
  assert.deepEqual(Sym.tick(s, t0 + 96 * MIN, { idleSeconds: 120 }), [], '2 分鐘還不算');
  const evs = Sym.tick(s, t0 + 97 * MIN, { idleSeconds: 190 });
  assert.deepEqual(evs.map(e => e.type), ['fruitEaten', 'bloom']);
  assert.equal(s.fruit, null);
  assert.equal(Sym.fruitsToday(s, t0 + 97 * MIN), 1);
  assert.equal(Sym.bloomToday(s, t0 + 97 * MIN), 1);
});

test('桌面上沒有夥伴、或專注中：不放果實；沒有夥伴也不會被吃', () => {
  const t0 = at(2026, 9, 26, 9);
  for (const sig of [{ pets: false }, { busy: true }]) {
    const s = Sym.defaultSymbiosis();
    for (let t = t0; t <= t0 + 120 * MIN; t += MIN) Sym.tick(s, t, { idleSeconds: 0, ...sig });
    assert.equal(s.fruit, null, JSON.stringify(sig));
  }
  const s = Sym.defaultSymbiosis();
  use(s, t0, t0 + 95 * MIN);
  assert.deepEqual(Sym.tick(s, t0 + 99 * MIN, { idleSeconds: 400, pets: false }), []);
  assert.ok(s.fruit, '沒有夥伴在家：果實留著等牠們回來');
});

test('F4：一天最多 4 顆；一顆是半個普通泡芙', () => {
  const s = Sym.defaultSymbiosis();
  let t = at(2026, 9, 26, 8), eaten = 0;
  for (let round = 0; round < 7; round++) {
    use(s, t, t + 91 * MIN);
    t += 92 * MIN;
    eaten += Sym.tick(s, t, { idleSeconds: 200 }).filter(e => e.type === 'fruitEaten').length;
    t += 5 * MIN;
  }
  assert.equal(eaten, Sym.FRUITS_PER_DAY);
  assert.equal(Sym.fruitsToday(s, t), Sym.FRUITS_PER_DAY);
  assert.equal(Sym.FRUIT_GAIN.fullness, TIERS.basic.fullness / 2);
  assert.equal(Sym.FRUIT_GAIN.affection, TIERS.basic.affection / 2);
  assert.equal(Sym.FRUIT_GAIN.xp, TIERS.basic.xp / 2);
});

test('F5：04:59 吃的算前一天，05:01 算新的一天', () => {
  const s = Sym.defaultSymbiosis();
  use(s, at(2026, 9, 27, 3, 0), at(2026, 9, 27, 4, 45));
  Sym.tick(s, at(2026, 9, 27, 4, 59), { idleSeconds: 200 });
  assert.equal(s.days['2026-09-26'].fruits, 1);
  assert.equal(s.days['2026-09-27']?.fruits ?? 0, 0);
  assert.equal(Sym.bloomToday(s, at(2026, 9, 27, 4, 59)), 1);
  const next = Sym.tick(s, at(2026, 9, 27, 5, 1), { idleSeconds: 0 });
  assert.ok(next.some(e => e.type === 'presence'), '05:01 是新的一天：第一次看到你');
  assert.equal(Sym.bloomToday(s, at(2026, 9, 27, 5, 1)), 0);
  assert.deepEqual(Sym.pastFlowers(s, at(2026, 9, 27, 5, 1)), [{ day: '2026-09-26', level: 1 }], '昨天留下一朵小花');
});

test('F6：兩台電腦同一天各吃 3 顆，merge 後是 3 不是 6；小花最多 7 朵', () => {
  const day = { fruits: 3, rest: true, focus: false, sleep: false, seen: true };
  const a = { ...Sym.defaultSymbiosis(), days: { '2026-09-26': day } };
  const b = { ...Sym.defaultSymbiosis(), days: { '2026-09-26': { ...day, focus: true } } };
  const m = Sym.mergeSymbiosis(a, b);
  assert.equal(m.days['2026-09-26'].fruits, 3);
  assert.equal(Sym.bloomOf(m.days['2026-09-26']), 2, '兩邊做到的好事取聯集');
  const flowers = Array.from({ length: 10 }, (_, i) => ({ day: `2026-09-${String(10 + i).padStart(2, '0')}`, level: 1 + (i % 3) }));
  const m2 = Sym.mergeSymbiosis({ flowers: flowers.slice(0, 6) }, { flowers: flowers.slice(4) });
  assert.equal(m2.flowers.length, Sym.FLOWERS_KEPT);
  assert.equal(m2.flowers.at(-1).day, '2026-09-19');
});

test('一起累：昨天 01:00 以後才睡 → 今天早上累、中午恢復；準時睡 → 花草長一級', () => {
  const r = R.defaultRoutine();
  R.tick(r, at(2026, 9, 25, 10), { active: true });
  R.tick(r, at(2026, 9, 26, 2, 30), { active: true }); // 25 號的作息日，02:30 才睡
  const s = Sym.defaultSymbiosis(), morning = at(2026, 9, 26, 9);
  const evs = Sym.tick(s, morning, { idleSeconds: 0 }, r);
  assert.deepEqual(evs.map(e => e.type), ['presence', 'tired']);
  assert.ok(Sym.isTired(s, morning));
  assert.ok(!Sym.isTired(s, at(2026, 9, 26, 12, 5)), '中午就好了');
  assert.equal(Sym.bloomToday(s, morning), 0, '熬夜不算準時睡');

  const r2 = R.defaultRoutine();
  R.tick(r2, at(2026, 9, 25, 10), { active: true });
  R.tick(r2, at(2026, 9, 25, 23, 10), { active: true });
  const s2 = Sym.defaultSymbiosis();
  const evs2 = Sym.tick(s2, morning, { idleSeconds: 0 }, r2);
  assert.deepEqual(evs2.map(e => e.type), ['presence', 'bloom']);
  assert.ok(!Sym.isTired(s2, morning));
});

test('mark：同一件事一天只算一次；三件都做到是 3 級', () => {
  const s = Sym.defaultSymbiosis(), t = at(2026, 9, 26, 10);
  assert.equal(Sym.mark(s, t, 'focus'), 1);
  assert.equal(Sym.mark(s, t, 'focus'), null);
  assert.equal(Sym.mark(s, t, 'rest'), 2);
  assert.equal(Sym.mark(s, t, 'sleep'), 3);
  assert.equal(Sym.mark(s, t, 'nope'), null);
  assert.equal(Sym.MAX_BLOOM, 3);
});

test('存檔：亂掉的資料讀進來會修好；重開 app 從頭算連續時間', () => {
  const s = Sym.normalizeSymbiosis({ days: { bad: {}, '2026-09-26': { fruits: 99, rest: 'yes' } }, fruit: { at: 5, berry: 'x' }, flowers: [{ day: '2026-09-20', level: 9 }], tiredDay: 3, streakFrom: 1 });
  assert.deepEqual(s.days, { '2026-09-26': { fruits: Sym.FRUITS_PER_DAY, rest: false, focus: false, sleep: false, seen: false } });
  assert.equal(s.fruit.berry, Sym.FRUIT_BERRIES[0]);
  assert.equal(s.flowers[0].level, Sym.MAX_BLOOM);
  assert.equal(s.tiredDay, null);
  assert.equal(s.streakFrom, undefined);
  assert.deepEqual(Sym.normalizeSymbiosis(null), Sym.defaultSymbiosis());
  const old = migrate({ ...defaultSave(0), symbiosis: undefined }, dex, 0);
  assert.deepEqual(old.symbiosis, Sym.defaultSymbiosis(), '舊存檔讀進來有預設值');
});

// ---------- 接上 Game ----------
function makeGame(t0) {
  const t = { v: t0 };
  const g = new Game({ dex, state: migrate(defaultSave(t.v), dex, t.v), rng: createRng(7), now: () => t.v });
  g.chooseStarter(653);
  for (const sp of [661, 664]) { const m = g.createMon(sp); m.out = true; g.state.mons.push(m); }
  return { g, t };
}
const stats = g => g.state.mons.map(m => ({ uid: m.uid, affection: m.affection, fullness: m.fullness, enjoyment: m.enjoyment, xp: m.xp }));

test('F1：連續 3 天熬夜到 03:00，共生這條路完全不扣數值', () => {
  const { g, t } = makeGame(at(2026, 9, 20, 9));
  let tired = 0, calls = 0;
  for (let d = 0; d < 3; d++) {
    for (let m = 9 * 60; m <= 27 * 60; m += 1) { // 09:00 到隔天 03:00
      t.v = at(2026, 9, 20 + d, 0) + m * MIN;
      g.routineTick({ active: true });
      const idleSeconds = m % 100 === 99 ? 240 : 0; // 偶爾離開一下
      const before = stats(g);
      const evs = g.lifeTick({ idleSeconds });
      calls++;
      if (evs.some(e => e.type === 'tired')) tired++;
      const after = stats(g);
      for (let i = 0; i < before.length; i++) for (const k of ['affection', 'fullness', 'enjoyment', 'xp']) {
        assert.ok(after[i][k] >= before[i][k], `第 ${d + 1} 天 ${k} 被扣了：${before[i][k]} → ${after[i][k]}`);
      }
    }
  }
  assert.equal(tired, 2, '第 2、3 天早上一起累');
  const texts = JSON.stringify(g.state.mons.map(m => m.memory ?? []));
  assert.ok(!/熬夜|晚睡/.test(texts), '熬夜不寫進記憶');
});

test('Game：吃果實 → 在家的每一隻都加飽足、滿足、好感、成長；旅行中的不算', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 9));
  const traveler = g.state.mons[2];
  traveler.trip = { id: 'trip-test', place: Object.keys(PLACES)[0], departedAt: t.v, returnAt: t.v + 10 * HOUR, seed: 1 };
  for (const m of g.state.mons) { m.fullness = 50; m.enjoyment = 50; }
  const seen = [];
  g.on('symbiosis', e => seen.push(...e.events.map(x => x.type)));
  for (let i = 0; i <= 91; i++) { t.v = at(2026, 9, 26, 9) + i * MIN; g.lifeTick({ idleSeconds: 0 }); }
  assert.ok(g.symbiosisView().fruit, '有果實');
  const before = stats(g);
  t.v += MIN;
  g.lifeTick({ idleSeconds: 200 });
  const after = stats(g);
  for (const i of [0, 1]) {
    assert.equal(after[i].fullness - before[i].fullness, Sym.FRUIT_GAIN.fullness);
    assert.equal(after[i].enjoyment - before[i].enjoyment, Sym.FRUIT_GAIN.enjoyment);
    assert.ok(after[i].affection > before[i].affection);
    assert.equal(after[i].xp - before[i].xp, Sym.FRUIT_GAIN.xp);
  }
  assert.deepEqual(after[2], before[2], '旅行中的沒吃到');
  assert.ok(seen.includes('presence') && seen.includes('fruitOffered') && seen.includes('fruitEaten') && seen.includes('bloom'));
  assert.equal(g.symbiosisView().bloom, 1);
});

test('Game：完成專注 → 花草長一級；同步兩份存檔各吃 3 顆 → 還是 3', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 10));
  g.startFocus(25);
  t.v += 26 * MIN;
  const events = [];
  g.on('symbiosis', e => events.push(...e.events));
  g.finishFocus();
  assert.deepEqual(events, [{ type: 'bloom', level: 1 }]);

  const day = R.routineDay(t.v);
  const a = structuredClone(g.state), b = structuredClone(g.state);
  a.symbiosis.days[day].fruits = 3;
  b.symbiosis.days[day].fruits = 3;
  const merged = mergeShared(a, b);
  assert.equal(merged.symbiosis.days[day].fruits, 3);
});
