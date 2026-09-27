// 日出、日落（NOAA Solar Calculator 的簡化公式）。純函式：輸入經緯度和一個時間，不讀時鐘、不查網路。
// 誤差大約 1 分鐘以內（test/sun.test.js 用獨立的天文星曆算出來的值對照，要 ≤ 3 分鐘）。
// 沒有設定城市就不要呼叫：不猜一個預設的地方。
const RAD = Math.PI / 180;
const DAY = 86_400_000;

// 太陽的赤緯（度）和均時差（分鐘），t＝UTC 毫秒
function solar(t) {
  const jc = (t / DAY + 2440587.5 - 2451545) / 36525; // 儒略世紀（從 J2000 起）
  const L0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360; // 平黃經
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc); // 平近點角
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc); // 地球軌道離心率
  const C = Math.sin(M * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * jc) + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * jc;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD); // 視黃經
  const eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD); // 黃赤交角（修正後）
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  return { decl, eqTime };
}

// t 所在的那一天（依經度換算的當地日期）的日出、日落：{ sunrise, sunset, noon }（UTC 毫秒）。
// 極晝、極夜（太陽整天不下山／不上來）回傳 null
export function sunTimes(lat, lon, t) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(t)) return null;
  const local = t + (lon / 15) * 3_600_000; // 大概的當地時間（只用來決定是哪一天）
  const day0 = Math.floor(local / DAY) * DAY; // 當地那一天的 00:00，當成 UTC
  // 太陽正午：先用大概的時間算一次均時差，再用算出來的正午重算一次
  let noon = day0 + (720 - 4 * lon) * 60_000;
  for (let i = 0; i < 2; i++) noon = day0 + (720 - 4 * lon - solar(noon).eqTime) * 60_000;
  const { decl } = solar(noon);
  // 太陽中心在地平線下 0.833°（大氣折射＋太陽半徑）
  const cosH = (Math.cos(90.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl * RAD)) / (Math.cos(lat * RAD) * Math.cos(decl * RAD));
  if (cosH < -1 || cosH > 1) return null;
  const half = (Math.acos(cosH) / RAD) * 4 * 60_000; // 半天的白天長度（毫秒）
  // 日出、日落各自用那個時刻的赤緯再修正一次
  const at = (guess, sign) => {
    const s = solar(guess);
    const c = (Math.cos(90.833 * RAD) - Math.sin(lat * RAD) * Math.sin(s.decl * RAD)) / (Math.cos(lat * RAD) * Math.cos(s.decl * RAD));
    if (c < -1 || c > 1) return guess;
    return day0 + (720 - 4 * lon - s.eqTime + sign * (Math.acos(c) / RAD) * 4) * 60_000;
  };
  return { sunrise: at(noon - half, -1), sunset: at(noon + half, 1), noon };
}

export const SUNSET_WINDOW = 10 * 60_000; // 日落前後幾分鐘算「日落」（規格：前後 10 分鐘）

// 現在是不是日落的時候（前後 SUNSET_WINDOW）；沒有座標就永遠不是
export function isSunset(place, now) {
  if (!place) return false;
  const s = sunTimes(place.lat, place.lon, now);
  return Boolean(s) && Math.abs(now - s.sunset) <= SUNSET_WINDOW;
}
