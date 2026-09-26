// PR 5：天氣
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { defaultSave } from '../src/core/save.js';
import { speciesWeights, activeModifiers } from '../src/core/encounter.js';
import * as w from '../src/core/weather.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const ctx = (extra = {}) => ({ hour: 14, weekday: 3, cpuHot: false, justPluggedIn: false, returnedFromIdle: false, lure: null, ...extra });

test('天氣代碼 → 遊戲裡的天氣', () => {
  assert.equal(w.weatherFromCode(0, true), 'sun');
  assert.equal(w.weatherFromCode(1, false), 'clear');
  assert.equal(w.weatherFromCode(3), 'cloud');
  assert.equal(w.weatherFromCode(45), 'fog');
  for (const c of [51, 61, 65, 80, 82]) assert.equal(w.weatherFromCode(c), 'rain', c);
  for (const c of [71, 75, 77, 85, 86]) assert.equal(w.weatherFromCode(c), 'snow', c);
  for (const c of [95, 96, 99]) assert.equal(w.weatherFromCode(c), 'thunder', c);
  assert.equal(w.weatherFromCode('x'), null);
});

test('天氣：解析 Open-Meteo 的回應，壞掉的資料回傳 null／空陣列', () => {
  const geo = { results: [{ name: '中壢區', latitude: 24.965, longitude: 121.2168, country: '台灣', admin1: '桃園市' }, { name: 'bad', latitude: 999, longitude: 0 }] };
  assert.deepEqual(w.parseGeocoding(geo), [{ name: '中壢區', region: '桃園市・台灣', lat: 24.965, lon: 121.2168 }]);
  assert.deepEqual(w.parseGeocoding({}), []);
  assert.deepEqual(w.parseGeocoding(null), []);
  assert.deepEqual(w.parseForecast({ current: { time: '2026-09-26T10:00', interval: 900, weather_code: 63, is_day: 1 } }), { weather: 'rain', code: 63 });
  assert.equal(w.parseForecast({ current: { weather_code: null } }), null);
  assert.equal(w.parseForecast({ error: true, reason: 'x' }), null);
  assert.match(w.geocodingUrl('中壢'), /name=%E4%B8%AD%E5%A3%A2/);
  assert.match(w.forecastUrl(24.9651, 121.2168), /latitude=24\.965&longitude=121\.217&current=weather_code,is_day/);
});

test('天氣影響遭遇：雨天水屬性 ×2、黏美兒 ×4 以上；晴天火草 ×1.5；雪天冰 ×2；打雷電 ×2', () => {
  const state = defaultSave(0);
  const base = Object.fromEntries(speciesWeights(ctx(), state, dex).map(x => [x.id, x.w]));
  const ratio = (weather, id) => speciesWeights(ctx({ weather }), state, dex).find(x => x.id === id).w / base[id];
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(ratio('rain', 656), 2), '呱呱泡蛙（水）');
  assert.ok(near(ratio('rain', 704), 4), '黏美兒（龍，不是水）也要 ×4');
  assert.ok(near(ratio('rain', 653), 1), '火狐狸不受影響');
  assert.ok(near(ratio('sun', 653), 1.5));
  assert.ok(near(ratio('sun', 650), 1.5));
  assert.ok(near(ratio('snow', 712), 2));
  assert.ok(near(ratio('thunder', 702), 2));
  assert.ok(near(ratio('cloud', 656), 1), '多雲沒有加成');
  assert.ok(activeModifiers(ctx({ weather: 'rain' }), dex).some(m => m.id === 'weather-rain'), '氣息會列出天氣');
});
