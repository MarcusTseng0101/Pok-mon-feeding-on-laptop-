// 手機打卡（core/checkin.js、Game.checkin）
//   F16：只加不減，不向你要求打卡、沒有連續天數、文字不責怪不催
//   F17：回應和痕跡的文字寫出哪一隻、做了什麼（痕跡還有時間）
//   F18：同一個 id 只算一次；上限用不重複的 id 數；兩台電腦取聯集
//   F19：手機的時間夾到 [現在 − 24 小時, 現在]；04:59／05:01 分到對的作息日
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as CI from '../src/core/checkin.js';
import * as Sym from '../src/core/symbiosis.js';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import { mergeShared } from '../src/core/sync.js';

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
  g.state.mons[1].affection = 80; // 最親近的是咕咕鴿（661）
  return { g, t };
}
const stats = m => ({ affection: m.affection, fullness: m.fullness, enjoyment: m.enjoyment, xp: m.xp });

test('validAction：只收 kind、id、at 三個欄位，而且格式要對（F15 的格式那一半）', () => {
  const id = newId();
  assert.deepEqual(CI.validAction({ kind: 'meal', id, at: 5 }), { kind: 'meal', id, at: 5 });
  assert.deepEqual(CI.validAction({ kind: 'visit', id, at: 5 }), { kind: 'visit', id, at: 5 });
  for (const bad of [null, [], 'meal', { kind: 'meal', id, at: 5, affection: 255 }, { kind: 'feed', id, at: 5 }, { kind: 'meal', id: 'x', at: 5 },
    { kind: 'meal', id: 'AB'.repeat(16), at: 5 }, { kind: 'meal', id, at: '5' }, { kind: 'meal', id, at: Infinity }, { kind: 'meal', id }, { kind: '__proto__', id, at: 1 }]) {
    assert.equal(CI.validAction(bad), null, JSON.stringify(bad));
  }
});

test('F18：同一個 id 送 3 次只加 1 次，回一樣的話；上限用不重複的 id 數算', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 12));
  const fletch = g.mon(g.state.mons[1].uid);
  const before = stats(fletch);
  const id = newId();
  const r1 = g.checkin({ kind: 'water', id, at: t.v });
  const mid = stats(fletch);
  const r2 = g.checkin({ kind: 'water', id, at: t.v });
  const r3 = g.checkin({ kind: 'water', id, at: t.v + 5 * MIN });
  assert.deepEqual(r2, r1);
  assert.deepEqual(r3, r1);
  assert.deepEqual(stats(fletch), mid, '重送不再加');
  assert.equal(mid.affection, before.affection + CI.GAIN.affection);
  assert.equal(mid.xp, before.xp + CI.GAIN.xp);

  // 去睡一天只算一次：第二次（不同 id）照樣記下、照樣有回應，但不加數值
  const s1 = g.checkin({ kind: 'sleep', id: newId(), at: t.v });
  const aff = fletch.affection;
  const s2 = g.checkin({ kind: 'sleep', id: newId(), at: t.v + MIN });
  assert.ok(s1.ok && s2.ok && s2.line === s1.line);
  assert.equal(fletch.affection, aff, '超過一天的上限：不加');
  assert.equal(CI.countOn(g.state.symbiosis.checkins, '2026-09-26', 'sleep'), 2);
});

test('F18：兩台電腦各收到同樣 3 個打卡，merge 後還是 3 個（聯集，不相加）', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 12));
  for (let i = 0; i < 3; i++) g.checkin({ kind: 'meal', id: newId(), at: t.v + i * MIN });
  const A = structuredClone(g.state), B = structuredClone(g.state);
  B.symbiosis.checkins.days['2026-09-26'][newId()] = { kind: 'walk', at: t.v, uid: null, gain: true }; // B 多一個不同的
  for (const [x, y] of [[A, B], [B, A]]) {
    const m = mergeShared(x, y).symbiosis.checkins;
    assert.equal(CI.countOn(m, '2026-09-26', 'meal'), 3);
    assert.equal(CI.countOn(m, '2026-09-26', 'walk'), 1);
  }
});

test('F19：手機的時間在未來或太久以前就用電腦的時間；04:59 算前一天、05:01 算當天', () => {
  const now = at(2026, 9, 26, 12);
  assert.equal(CI.clampAt(now + 3 * HOUR, now), now, '未來 3 小時');
  assert.equal(CI.clampAt(now - 30 * HOUR, now), now, '30 小時以前');
  assert.equal(CI.clampAt(now - 5 * HOUR, now), now - 5 * HOUR, '5 小時以前：相信');
  assert.equal(CI.clampAt(NaN, now), now);

  const c = CI.defaultCheckins(), later = at(2026, 9, 26, 9);
  assert.equal(CI.apply(c, { kind: 'water', id: newId(), at: at(2026, 9, 26, 4, 59) }, later).day, '2026-09-25');
  assert.equal(CI.apply(c, { kind: 'water', id: newId(), at: at(2026, 9, 26, 5, 1) }, later).day, '2026-09-26');
  const future = CI.apply(c, { kind: 'water', id: newId(), at: later + 3 * HOUR }, later);
  assert.equal(future.rec.at, later, '超出範圍的照樣收，用電腦現在的時間');
});

test('打卡算進今天做到的好事：吃飯＝meal、讀書＝focus；花草最多 3 級', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 12));
  const seen = [];
  g.on('symbiosis', e => seen.push(...e.events));
  g.checkin({ kind: 'meal', id: newId(), at: t.v });
  assert.equal(g.symbiosisView().bloom, 1);
  g.checkin({ kind: 'study', id: newId(), at: t.v });
  assert.equal(g.state.symbiosis.days['2026-09-26'].focus, true);
  g.checkin({ kind: 'water', id: newId(), at: t.v });
  g.checkin({ kind: 'walk', id: newId(), at: t.v });
  assert.equal(g.symbiosisView().bloom, Sym.MAX_BLOOM, '做到 4 件也是 3 級（花草的圖只有 3 級）');
  assert.deepEqual(seen.map(e => e.level), [1, 2, 3]);
  // 存檔讀回來還在；舊存檔沒有 checkins 也不會壞
  const back = migrate(structuredClone(g.state), dex, t.v);
  assert.equal(back.symbiosis.days['2026-09-26'].meal, true);
  assert.equal(Object.keys(back.symbiosis.checkins.days['2026-09-26']).length, 4);
  const old = migrate({ ...defaultSave(0), symbiosis: { days: { '2026-09-26': { rest: true } } } }, dex, 0);
  assert.deepEqual(old.symbiosis.checkins, CI.defaultCheckins());
  assert.equal(CI.normalizeCheckins({ days: { '2026-09-26': { nope: { kind: 'meal', at: 1 }, [newId()]: { kind: 'MEAL', at: 1 } } }, lastVisit: 'x' }).lastVisit, null);
});

test('F17：回應寫出哪一隻、做了什麼；痕跡的文字有時間、你做的事、牠做的事', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 12, 40));
  const r = g.checkin({ kind: 'meal', id: newId(), at: t.v });
  assert.equal(r.name, '小箭雀');
  assert.equal(r.line, '小箭雀也吃了一顆樹果');
  assert.equal(r.anim, 'munch');
  const [tr] = g.checkinTraces();
  assert.equal(tr.trace, 'bowl');
  assert.equal(tr.line, '12:40 你去吃飯的時候，小箭雀也吃了一顆樹果');
  assert.match(tr.line, /^\d{1,2}:\d{2} 你.+的時候，.+也/);
  // 跟你出門的那隻優先
  const froakie = g.state.mons[0];
  g.goOut(froakie.uid);
  assert.equal(g.checkin({ kind: 'water', id: newId(), at: t.v }).uid, froakie.uid);
});

test('痕跡：12 小時以內、由新到舊、最多 3 個', () => {
  const c = CI.defaultCheckins(), now = at(2026, 9, 26, 20);
  for (let i = 0; i < 6; i++) CI.apply(c, { kind: 'water', id: newId(), at: now - i * HOUR }, now);
  CI.apply(c, { kind: 'meal', id: newId(), at: now - 13 * HOUR }, now);
  const r = CI.recent(c, now);
  assert.equal(r.length, CI.TRACES_SHOWN);
  assert.deepEqual(r.map(x => x.at), [now, now - HOUR, now - 2 * HOUR]);
  assert.equal(CI.recent(c, now, { n: 99 }).length, 6, '13 小時以前的不算');
});

test('打開手機頁面＝想念：2 小時算一次、給最親近的那隻；下一次牠第一個發現你', () => {
  const { g, t } = makeGame(at(2026, 9, 26, 12));
  const fletch = g.state.mons[1], a0 = fletch.affection;
  const v1 = g.checkin({ kind: 'visit', id: newId(), at: t.v });
  assert.equal(v1.line, '小箭雀好像感覺到你在看牠');
  assert.equal(fletch.affection, a0 + CI.VISIT_AFFECTION);
  t.v += HOUR;
  g.checkin({ kind: 'visit', id: newId(), at: t.v });
  assert.equal(fletch.affection, a0 + CI.VISIT_AFFECTION, '2 小時內不再算');
  t.v += HOUR + MIN;
  g.checkin({ kind: 'visit', id: newId(), at: t.v });
  assert.equal(fletch.affection, a0 + 2 * CI.VISIT_AFFECTION);
  assert.equal(g.takeMissed(), fletch.uid);
  assert.equal(g.takeMissed(), null, '用一次就清掉');
  assert.equal(Object.keys(g.state.symbiosis.checkins.days).length, 0, '想念不是打卡，不留痕跡');
});

test('F16：7 天每天打卡 vs 7 天都沒打卡：打卡只加不減；沒打卡的那份跟沒有這個功能一樣；第 8 天打卡照樣拿到全部', () => {
  const A = makeGame(at(2026, 9, 20, 9)), B = makeGame(at(2026, 9, 20, 9));
  for (let day = 0; day < 7; day++) {
    for (const { g, t } of [A, B]) {
      for (let m = 0; m < 12 * 60; m += 30) { t.v += 30 * MIN; g.tick(); g.lifeTick({ idleSeconds: 0 }); }
      t.v += 12 * HOUR;
    }
    for (const kind of ['meal', 'water', 'walk', 'study']) A.g.checkin({ kind, id: newId(), at: A.t.v });
  }
  for (let i = 0; i < A.g.state.mons.length; i++) {
    const a = stats(A.g.state.mons[i]), b = stats(B.g.state.mons[i]);
    for (const k of Object.keys(a)) assert.ok(a[k] >= b[k], `${k}：打卡的 ${a[k]} < 沒打卡的 ${b[k]}`);
  }
  // 沒打卡的那份：打卡的紀錄是空的，沒有「連續天數」這種東西
  assert.deepEqual(B.g.state.symbiosis.checkins.days, {});
  assert.ok(!/streak|連續/.test(JSON.stringify(B.g.state.symbiosis.checkins)));
  // 第 8 天第一次打卡：拿到的跟第一天一樣多（沒有因為之前沒打而變少）
  const f = B.g.state.mons[1], before = stats(f);
  B.g.checkin({ kind: 'water', id: newId(), at: B.t.v });
  assert.equal(f.affection - before.affection, CI.GAIN.affection);
  assert.equal(f.xp - before.xp, CI.GAIN.xp);
});

test('F16：所有文字都不責怪、不催；手機頁面沒有通知', () => {
  const GUILT = /好久|怎麼都|又忘|連續.{0,3}天|還沒.{0,4}(打卡|吃|喝)|快點|不理我/;
  const lines = [CI.visitLine('咕咕鴿'), ...CI.CHECKINS.flatMap(c => [c.zh, CI.replyLine(c.id, '咕咕鴿'), CI.traceLine({ kind: c.id, at: at(2026, 9, 26, 12) }, '咕咕鴿')])];
  for (const l of lines) assert.doesNotMatch(l, GUILT, l);
  const page = readFileSync(new URL('../src/phone/phone.js', import.meta.url), 'utf8') + readFileSync(new URL('../src/phone/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(page, GUILT);
  assert.doesNotMatch(page, /Notification|PushManager|badge/);
});

test('架構：core/checkin.js 是純邏輯', () => {
  const src = readFileSync(new URL('../src/core/checkin.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Math\.random|Date\.now|document\.|window\.|localStorage|fetch\(/);
});
