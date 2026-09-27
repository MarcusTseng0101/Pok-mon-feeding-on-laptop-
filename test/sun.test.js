// 日出、日落（core/sun.js）：F11 算錯
// 對照值由 PyEphem 4.2.1（VSOP87 星曆，跟 NOAA 的簡化公式是不同的算法）算出，太陽中心在地平線下 0.833°、不算氣壓。
// 也跟公開的日出日落表對過：台北夏至 05:04／18:46、冬至 06:34／17:09，奧斯陸夏至 03:53／22:43（當地時間）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunTimes, isSunset, SUNSET_WINDOW } from '../src/core/sun.js';

const MIN = 60_000;
const FIXTURES = [
  { name: '台北 夏至', lat: 25.0330, lon: 121.5654, at: Date.UTC(2026, 5, 21, 4), sunrise: 1781989476455, sunset: 1782038781483 },
  { name: '台北 冬至', lat: 25.0330, lon: 121.5654, at: Date.UTC(2026, 11, 21, 4), sunrise: 1797806049986, sunset: 1797844145969 },
  { name: '奧斯陸 夏至（高緯度）', lat: 59.9139, lon: 10.7522, at: Date.UTC(2026, 5, 21, 12), sunrise: 1782006824627, sunset: 1782074631077 },
  { name: '雷克雅維克 春分（高緯度、西經）', lat: 64.1466, lon: -21.9426, at: Date.UTC(2026, 2, 20, 12), sunrise: 1773991717832, sunset: 1774035804637 },
];

for (const f of FIXTURES) {
  test(`F11：${f.name}的日出日落誤差 ≤ 3 分鐘`, () => {
    const s = sunTimes(f.lat, f.lon, f.at);
    assert.ok(s, '應該有日出日落');
    const dr = Math.abs(s.sunrise - f.sunrise) / MIN, ds = Math.abs(s.sunset - f.sunset) / MIN;
    assert.ok(dr <= 3, `日出差 ${dr.toFixed(1)} 分鐘`);
    assert.ok(ds <= 3, `日落差 ${ds.toFixed(1)} 分鐘`);
  });
}

test('同一天的任何時間都算同一天的日落', () => {
  const f = FIXTURES[0];
  const a = sunTimes(f.lat, f.lon, Date.UTC(2026, 5, 20, 17)); // 台北 6/21 01:00
  const b = sunTimes(f.lat, f.lon, Date.UTC(2026, 5, 21, 14)); // 台北 6/21 22:00
  assert.ok(Math.abs(a.sunset - f.sunset) < 3 * MIN && Math.abs(b.sunset - f.sunset) < 3 * MIN);
});

test('極晝、極夜：回傳 null（不會算出奇怪的時間）', () => {
  assert.equal(sunTimes(78.22, 15.65, Date.UTC(2026, 5, 21, 12)), null); // 斯瓦巴 夏至
  assert.equal(sunTimes(78.22, 15.65, Date.UTC(2026, 11, 21, 12)), null); // 斯瓦巴 冬至
});

test('isSunset：日落前後 10 分鐘；沒有設定城市就永遠不是（不猜預設城市）', () => {
  const f = FIXTURES[0], place = { lat: f.lat, lon: f.lon };
  assert.ok(isSunset(place, f.sunset));
  assert.ok(isSunset(place, f.sunset - SUNSET_WINDOW + MIN));
  assert.ok(isSunset(place, f.sunset + SUNSET_WINDOW - MIN));
  assert.ok(!isSunset(place, f.sunset - SUNSET_WINDOW - MIN));
  assert.ok(!isSunset(place, f.sunset + 30 * MIN));
  assert.ok(!isSunset(null, f.sunset));
});
