// 拍照，一起做（core/checkin.js、Game.snapTogether、core/life.js 的 ctx.together）
//   成功定義：你拍一杯水、確認 → 那段時間牠的生活是 drink（手機和電腦一樣）；回家的痕跡寫「12:40 你喝水的時候，咕咕鴿也一起喝了」
//   F16：只加不減，不改任何數值、沒有連續天數、文字不責怪不催
//   F17：回應和痕跡的文字寫出哪一隻、做了什麼（痕跡還有時間）
//   F18：同一個 id 只算一次；兩台電腦取聯集
//   F19：手機的時間夾到 [現在 − 24 小時, 現在]；04:59／05:01 分到對的作息日
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as CI from '../src/core/checkin.js';
import * as L from '../src/core/life.js';
import * as Sym from '../src/core/symbiosis.js';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import { mergeShared } from '../src/core/sync.js';
import { phoneSnapshot } from '../src/core/phonedata.js';

const MIN = 60_000, HOUR = 60 * MIN;
const at = (y, mo, d, h, m = 0) => new Date(y, mo - 1, d, h, m).getTime();
const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
let n = 0;
const newId = () => (++n).toString(16).padStart(32, '0');

function makeGame(t0) {
  const t = { v: t0 };
  const g = new Game({ dex, state: migrate(defaultSave(t.v), dex, t.v), rng: createRng(7), now: () => t.v });
  g.chooseStarter(653);
  for (const sp of [661, 664]) { const m = g.createMon(sp); m.out = true; g.state.mons.push(m); }
  g.state.mons[1].affection = 80; // 最親近的是小箭雀（661）
  return { g, t };
}
const stats = g => JSON.stringify(g.state.mons.map(m => [m.affection, m.fullness, m.enjoyment, m.xp, m.memory]));

test('架構：core/checkin.js 是純邏輯', () => {
  const src = readFileSync(new URL('../src/core/checkin.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Math\.random|Date\.now|document\.|window\.|localStorage|fetch\(|randomUUID/);
  assert.doesNotMatch(src, /^(let|var) /m);
});

test('validAction：只收 kind、id、at 三個欄位，而且格式要對（F15 的格式那一半）', () => {
  const id = newId();
  assert.deepEqual(CI.validAction({ kind: 'drink', id, at: 5 }), { kind: 'drink', id, at: 5 });
  assert.deepEqual(CI.validAction({ kind: 'done', id, at: 5 }), { kind: 'done', id, at: 5 });
  for (const bad of [null, [], 'drink', { kind: 'drink', id, at: 5, photo: 'data:image/jpeg;base64,xx' }, { kind: 'feed', id, at: 5 }, { kind: 'drink', id: 'x', at: 5 },
    { kind: 'drink', id: 'AB'.repeat(16), at: 5 }, { kind: 'drink', id, at: '5' }, { kind: 'drink', id, at: Infinity }, { kind: 'drink', id }, { kind: '__proto__', id, at: 1 }]) {
    assert.equal(CI.validAction(bad), null, JSON.stringify(bad));
  }
});

test('成功定義：12:40 拍一杯水、確認 → 最親近的那隻 12:40～12:50 在喝水（電腦和手機的生活表一樣），不改任何數值', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 12, 40));
  const fletch = g.state.mons[1];
  const before = stats(g);
  const r = g.snapTogether({ kind: 'drink', id: newId(), at: t.v });
  assert.equal(r.ok, true);
  assert.equal(r.name, g.displayName(fletch));
  assert.equal(r.line, `${g.displayName(fletch)}跟你一起喝水`);
  assert.equal(r.until, t.v + 10 * MIN);
  assert.equal(stats(g), before, '不改好感、飽足、成長、記憶（F16）');
  for (const m of [0, 5, 9]) assert.equal(g.lifeAt(fletch.uid, t.v + m * MIN), 'drink', `12:${40 + m}`);
  // 別隻照自己的生活過
  const other = g.state.mons[0];
  assert.equal(g.lifeAt(other.uid, t.v), L.activityAt(other, t.v, L.lifeCtx(g.state.routine, t.v)));
  // 手機的生活表（core/phonedata.js）現在這一格也是 drink
  const snap = phoneSnapshot(g.state, { now: t.v, nameOf: m => g.displayName(m), speciesName: id => dex.name(id), spriteKeyOf: m => String(m.species) });
  const p = snap.pets.find(x => x.name === g.displayName(fletch));
  assert.equal(p.life.acts[0], L.CODE.drink);
  // 算進今天做到的好事
  assert.equal(g.state.symbiosis.days['2026-09-26'].water, true);
});

test('跟你出門的那隻，就是跟你一起做的那隻', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 12));
  const froakie = g.state.mons[0];
  g.state.mons[0].outing = { since: t.v - HOUR };
  const r = g.snapTogether({ kind: 'eat', id: newId(), at: t.v });
  assert.equal(r.name, g.displayName(froakie));
  assert.equal(g.lifeAt(froakie.uid, t.v + 5 * MIN), 'eat');
});

test('讀書陪你讀到 50 分鐘，或你按「讀完了」；開始新的一件事，上一件就停在那一刻', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 14));
  const uid = g.state.mons[1].uid;
  g.snapTogether({ kind: 'read', id: newId(), at: t.v });
  assert.equal(g.lifeAt(uid, t.v + 45 * MIN), 'read');
  t.v += 20 * MIN;
  const done = g.snapTogether({ kind: 'done', id: newId(), at: t.v });
  assert.equal(done.line, `${g.displayName(g.state.mons[1])}伸了個懶腰`);
  assert.equal(g.lifeAt(uid, t.v + 25 * MIN), L.activityAt(g.state.mons[1], t.v + 25 * MIN, L.lifeCtx(g.state.routine, t.v)), '讀完了：回到自己的生活');
  // 喝水到一半又去吃飯：喝水停在吃飯那一刻
  t.v += 30 * MIN;
  g.snapTogether({ kind: 'drink', id: newId(), at: t.v });
  t.v += 4 * MIN;
  g.snapTogether({ kind: 'eat', id: newId(), at: t.v });
  const recs = Object.values(g.state.symbiosis.checkins.days['2026-09-26']);
  assert.equal(recs.find(r => r.kind === 'drink').until, t.v);
  assert.equal(g.lifeAt(uid, t.v + 6 * MIN), 'eat');
});

test('F18：同一個 id 送 3 次只記 1 次，回一樣的話；兩台電腦 merge 後取聯集', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 12));
  const id = newId();
  const r1 = g.snapTogether({ kind: 'drink', id, at: t.v });
  const r2 = g.snapTogether({ kind: 'drink', id, at: t.v });
  const r3 = g.snapTogether({ kind: 'drink', id, at: t.v + 5 * MIN });
  assert.deepEqual(r2, r1);
  assert.deepEqual(r3, r1);
  assert.equal(Object.keys(g.state.symbiosis.checkins.days['2026-09-26']).length, 1);
  for (let i = 0; i < 2; i++) g.snapTogether({ kind: 'eat', id: newId(), at: t.v + (20 + i) * MIN });
  const A = structuredClone(g.state), B = structuredClone(g.state);
  // B 那台按了「讀完了」（同一個 id 的 until 比較早）、又多一個不同的
  const readId = newId();
  A.symbiosis.checkins.days['2026-09-26'][readId] = { kind: 'read', at: t.v + HOUR, until: t.v + 2 * HOUR, uid: g.state.mons[1].uid };
  B.symbiosis.checkins.days['2026-09-26'][readId] = { kind: 'read', at: t.v + HOUR, until: t.v + HOUR + 15 * MIN, uid: g.state.mons[1].uid };
  for (const [x, y] of [[A, B], [B, A]]) {
    const m = mergeShared(x, y).symbiosis.checkins.days['2026-09-26'];
    assert.equal(Object.keys(m).length, 4);
    assert.equal(m[readId].until, t.v + HOUR + 15 * MIN, '讀完了：取比較早的結束');
  }
});

test('F19：手機的時間在未來或太久以前就用電腦的時間；04:59 算前一天、05:01 算當天', () => {
  const now = at(2026, 9, 26, 12);
  assert.equal(CI.clampAt(now + HOUR, now), now);
  assert.equal(CI.clampAt(now - 25 * HOUR, now), now);
  assert.equal(CI.clampAt(now - 2 * HOUR, now), now - 2 * HOUR);
  const c = CI.defaultCheckins();
  assert.equal(CI.apply(c, { kind: 'drink', id: newId(), at: at(2026, 9, 26, 4, 59) }, now, 'u').day, '2026-09-25');
  assert.equal(CI.apply(c, { kind: 'drink', id: newId(), at: at(2026, 9, 26, 5, 1) }, now, 'u').day, '2026-09-26');
});

test('F20：生活還是時間的純函式——一起做的那段怎麼問都一樣；生活表查回來跟直接算一樣', () => {
  const pet = { uid: 'abc', nature: 'jolly' }, t0 = at(2026, 9, 27, 12, 43);
  const ctx = L.lifeCtx(null, t0, [{ uid: 'abc', act: 'read', from: t0, until: t0 + 50 * MIN }]);
  const tl = L.timeline(pet, t0 - HOUR, 144, ctx);
  for (let i = 0; i < 144; i++) {
    const t = tl.from + i * tl.slot;
    for (const off of [0, 3 * MIN, 9 * MIN]) assert.equal(L.actOfCode(tl.acts[i]), L.activityAt(pet, t + off, ctx));
  }
  assert.equal(L.activityAt(pet, t0 + 49 * MIN, ctx), 'read');
  // 沒有一起做的事：ctx 跟以前一樣（舊的測試、手機摘要不變）
  assert.deepEqual(Object.keys(L.lifeCtx(null, t0, [])).sort(), ['sleepFrom', 'sleepTo']);
});

test('痕跡：回家後桌面上最多 3 個，文字寫出幾點、你做什麼、哪一隻一起做了什麼（F17）；讀完了不留痕跡', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 12, 40));
  const name = g.displayName(g.state.mons[1]);
  g.snapTogether({ kind: 'drink', id: newId(), at: t.v });
  let tr = g.togetherTraces();
  assert.equal(tr.length, 1);
  assert.equal(tr[0].trace, 'cup');
  assert.equal(tr[0].line, `12:40 你喝水的時候，${name}也一起喝了`);
  const t0 = t.v;
  for (const [k, m] of [['read', 20], ['done', 30], ['eat', 60], ['rest', 90]]) { t.v = t0 + m * MIN; g.snapTogether({ kind: k, id: newId(), at: t.v }); }
  t.v = t0 + 2 * HOUR;
  tr = g.togetherTraces();
  assert.deepEqual(tr.map(x => x.kind), ['rest', 'eat', 'read']);
  t.v += 13 * HOUR;
  assert.equal(g.togetherTraces().length, 0, '12 小時以後就收起來');
});

test('F16：文字不責怪、不催；舊存檔讀進來不會壞', () => {
  const GUILT = /好久|怎麼都|又忘|連續.{0,3}天|快點|不理我|餓|寂寞|等你|應該|要記得/;
  for (const s of CI.SNAPS) {
    assert.doesNotMatch(CI.replyLine(s.id, '咕咕鴿'), GUILT);
    assert.doesNotMatch(CI.traceLine({ kind: s.id, at: 0 }, '咕咕鴿'), GUILT);
  }
  const old = Sym.normalizeSymbiosis({ days: { '2026-09-20': { rest: true } }, flowers: [], fruit: null });
  assert.deepEqual(old.checkins, { days: {} });
  assert.equal(Sym.bloomOf({ rest: true, focus: true, sleep: true, meal: true, water: true }), Sym.MAX_BLOOM, '花草最多 3 級');
});
