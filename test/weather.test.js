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

// ---------- 搜尋城市：「台中東區」要找得到 ----------
// 假的 Open-Meteo：只認得 GeoNames 裡真的有的名字
function fakeGeo(db, calls = []) {
  return async url => {
    const q = decodeURIComponent(new URL(url).searchParams.get('name'));
    calls.push(q);
    return { results: db[q] ?? [] };
  };
}
const TAICHUNG = { name: '臺中市', admin1: '臺中市', country: '臺灣', latitude: 24.1469, longitude: 120.6839 };
const EAST_TC = { name: '東區', admin1: '臺中市', country: '臺灣', latitude: 24.1367, longitude: 120.6947 };
const EAST_TN = { name: '東區', admin1: '臺南市', country: '臺灣', latitude: 22.98, longitude: 120.22 };

test('splitPlace 把城市和區拆開', () => {
  assert.deepEqual(w.splitPlace('台中東區'), { city: '台中', place: '東區' });
  assert.deepEqual(w.splitPlace('臺中市東區'), { city: '台中', place: '東區' });
  assert.deepEqual(w.splitPlace('台中 東區'), { city: '台中', place: '東區' });
  assert.deepEqual(w.splitPlace('桃園市中壢區'), { city: '桃園', place: '中壢區' });
  assert.deepEqual(w.splitPlace('Zhongli, Taoyuan'), { city: 'Taoyuan', place: 'Zhongli' });
  assert.deepEqual(w.splitPlace('中壢'), { city: null, place: null });
  assert.deepEqual(w.splitPlace('New York'), { city: null, place: null });
});

test('台中東區：先找台中的東區，不能拿到台南的東區', async () => {
  const calls = [];
  const r = await w.searchPlaces('台中東區', fakeGeo({ 東區: [EAST_TN, EAST_TC] }, calls));
  assert.equal(r.places.length, 1);
  assert.equal(r.places[0].lat, EAST_TC.latitude);
  assert.deepEqual(calls, ['台中東區', '臺中東區', '東區']);
});

test('東區查不到時退回城市，並說明', async () => {
  const r = await w.searchPlaces('台中東區', fakeGeo({ 臺中市: [TAICHUNG] }));
  assert.equal(r.places[0].name, '臺中市');
  assert.match(r.note, /找不到「東區」，改用「台中」/);
  // 中文都查不到時用英文名
  const r2 = await w.searchPlaces('台中東區', fakeGeo({ Taichung: [{ ...TAICHUNG, name: 'Taichung' }] }));
  assert.equal(r2.places[0].name, 'Taichung');
});

test('原本就查得到的不多打 API；連不上網路要分得出來', async () => {
  const calls = [];
  const r = await w.searchPlaces('中壢', fakeGeo({ 中壢: [{ name: '中壢', admin1: '桃園市', country: '臺灣', latitude: 24.96, longitude: 121.22 }] }, calls));
  assert.equal(r.places.length, 1);
  assert.deepEqual(calls, ['中壢']);
  assert.equal(r.offline, false);
  const off = await w.searchPlaces('台中東區', async () => null);
  assert.deepEqual(off, { places: [], offline: true });
  const none = await w.searchPlaces('xyzzy', fakeGeo({}));
  assert.deepEqual(none, { places: [], offline: false });
});

test('查詢次數有上限', async () => {
  const calls = [];
  await w.searchPlaces('台中東區', fakeGeo({}, calls));
  assert.ok(calls.length <= 8, calls.join());
  assert.ok(calls.includes('Taichung'), '英文名要在上限之內');
});
