// 牠們感受得到你的世界（core/world.js）
//   F12：最大化不是全螢幕（看 bounds，不是 workArea）
//   F13：不是 Windows（沒有視窗清單）就不啟動
//   F14：你回來時每隻陸續發現，只有最親近的那一隻跑過來
//   F2（PR-D 的補充）：全螢幕看影片的時候，閒置不算休息
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as W from '../src/core/world.js';
import { sunTimes } from '../src/core/sun.js';
import { createRng } from '../src/core/rng.js';
import { createDex } from '../src/core/dex.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const MIN = 60_000;

// 1920×1080 的螢幕，工作列 48 px 在下面。座標相對於我們的視窗（＝工作區），所以螢幕是 (0, 0, 1920, 1080)，工作區是 (0, 0, 1920, 1032)
const BOUNDS = { x: 0, y: 0, width: 1920, height: 1080 };

test('F12：最大化（蓋住工作區，沒蓋住工作列）不算全螢幕；全螢幕（蓋住整個螢幕）才算', () => {
  const maximized = { x: 0, y: 0, w: 1920, h: 1032, fg: true };
  const fullscreen = { x: 0, y: 0, w: 1920, h: 1080, fg: true };
  assert.equal(W.coversScreen(maximized, BOUNDS), false);
  assert.equal(W.coversScreen(fullscreen, BOUNDS), true);
  assert.equal(W.fullscreenNow([maximized], BOUNDS), false);
  assert.equal(W.fullscreenNow([fullscreen], BOUNDS), true);
  // 工作列在上面／左邊的螢幕：我們的視窗從工作區開始，螢幕的 bounds 是負的
  const topBar = { x: 0, y: -40, width: 1920, height: 1080 };
  assert.equal(W.fullscreenNow([{ x: 0, y: 0, w: 1920, h: 1040, fg: true }], topBar), false, '最大化');
  assert.equal(W.fullscreenNow([{ x: 0, y: -40, w: 1920, h: 1080, fg: true }], topBar), true, '全螢幕');
  // 小視窗、別的螢幕上的全螢幕視窗
  assert.equal(W.fullscreenNow([{ x: 100, y: 100, w: 800, h: 600, fg: true }], BOUNDS), false);
  assert.equal(W.fullscreenNow([{ x: 1920, y: 0, w: 1920, h: 1080, fg: true }], BOUNDS), false, '另一個螢幕');
  // 背景的全螢幕視窗被前景的小視窗蓋住：最上層不是它、前景也不是它 → 不算
  assert.equal(W.fullscreenNow([{ x: 100, y: 100, w: 800, h: 600, fg: true }, { x: 0, y: 0, w: 1920, h: 1080, fg: false }], BOUNDS), false);
});

test('F13：沒有視窗清單（macOS／Linux）或不知道螢幕大小，就不會判斷成全螢幕', () => {
  assert.equal(W.fullscreenNow([], BOUNDS), false);
  assert.equal(W.fullscreenNow(null, BOUNDS), false);
  assert.equal(W.fullscreenNow([{ x: 0, y: 0, w: 1920, h: 1080, fg: true }], null), false);
});

test('下雨、打雷才躲雨；閒置 10 分鐘以上才算你不在', () => {
  assert.ok(W.isRainy('rain') && W.isRainy('thunder'));
  assert.ok(!W.isRainy('snow') && !W.isRainy('cloud') && !W.isRainy(null));
  assert.ok(!W.isAway(9 * 60 + 59) && W.isAway(10 * 60));
});

test('F14：你回來時每隻各自過 0.5–4 秒才發現，不會一起；只有最親近的那一隻跑過來', () => {
  const mons = [{ uid: 'a', affection: 80 }, { uid: 'b', affection: 200 }, { uid: 'c', affection: 120 }, { uid: 'd', affection: 50 }];
  const order = W.noticeOrder(mons, createRng(3));
  assert.equal(order.length, 4);
  assert.ok(order.every(o => o.delay >= 0.5 && o.delay <= 4), JSON.stringify(order));
  assert.ok(new Set(order.map(o => o.delay.toFixed(2))).size === 4, '每隻時間不一樣');
  assert.deepEqual(order.filter(o => o.run).map(o => o.uid), ['b']);
});

test('日落一天一次；沒設定城市就不做', () => {
  const place = { lat: 25.033, lon: 121.5654 };
  const s = sunTimes(place.lat, place.lon, Date.UTC(2026, 5, 21, 4)).sunset;
  assert.ok(W.sunsetDue(place, s, null));
  assert.ok(!W.sunsetDue(place, s, W.localDay(s)), '今天看過了');
  assert.ok(!W.sunsetDue(place, s - 60 * MIN, null), '還沒到');
  assert.ok(!W.sunsetDue(null, s, null), '沒設定城市');
});

test('F2：全螢幕看影片的時候閒置不算休息（果實不會被吃掉）；沒有全螢幕照舊', () => {
  const t = { v: new Date(2026, 8, 27, 10).getTime() };
  const g = new Game({ dex, state: migrate(defaultSave(t.v), dex, t.v), rng: createRng(5), now: () => t.v });
  g.chooseStarter(653);
  g.state.symbiosis.fruit = { berry: 'pecha', at: t.v };
  g.lifeTick({ idleSeconds: 0 });
  t.v += MIN;
  let evs = g.lifeTick({ idleSeconds: 30 * 60, longestIdle: 30 * 60, watching: true });
  assert.ok(!evs.some(e => e.type === 'fruitEaten') && g.state.symbiosis.fruit, '看影片不是休息');
  t.v += MIN;
  evs = g.lifeTick({ idleSeconds: 5 * 60, longestIdle: 5 * 60 });
  assert.ok(evs.some(e => e.type === 'fruitEaten'), '真的離開就吃');
});
