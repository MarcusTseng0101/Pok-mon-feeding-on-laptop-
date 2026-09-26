// 天氣：用 Open-Meteo（不需要 API key）查使用者自己輸入的城市的目前天氣。
// 不用 IP 猜位置；沒設定城市就沒有天氣。這裡只有純函式：解析回應、天氣代碼 → 遊戲裡的天氣、對遭遇的影響。
//
// 天氣代碼是 WMO 代碼（Open-Meteo 文件的 weather_code）：
//   0 晴、1 大致晴、2 局部多雲、3 陰、45/48 霧、51–57 毛毛雨、61–67 雨、71–77 雪、
//   80–82 陣雨、85–86 陣雪、95 雷雨、96–99 雷雨夾冰雹

export const WEATHER_ZH = { sun: '晴天', clear: '晴朗的夜晚', cloud: '多雲', fog: '起霧', rain: '下雨', snow: '下雪', thunder: '打雷' };
export const REFRESH_MS = 30 * 60 * 1000;

export function weatherFromCode(code, isDay = true) {
  const c = Number(code);
  if (!Number.isFinite(c)) return null;
  if (c >= 95) return 'thunder';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if (c === 45 || c === 48) return 'fog';
  if (c <= 1) return isDay ? 'sun' : 'clear';
  return 'cloud';
}

// 遭遇的加成（猜的倍數，可調整）：[屬性, 倍數]；黏美兒在雨天特別常出現
export const WEATHER_MODS = {
  rain: { types: { water: 2 }, species: { 704: 4 }, zh: '下雨：水屬性的寶可夢出來玩水，黏美兒特別多' },
  sun: { types: { fire: 1.5, grass: 1.5 }, zh: '晴天：火、草屬性的寶可夢曬太陽' },
  snow: { types: { ice: 2 }, zh: '下雪：冰屬性的寶可夢出現了' },
  thunder: { types: { electric: 2 }, zh: '打雷：電屬性的寶可夢被雷聲吸引過來' },
};

export function weatherMultiplier(weather, types, speciesId) {
  const m = WEATHER_MODS[weather];
  if (!m) return 1;
  let w = 1;
  for (const t of types) w = Math.max(w, m.types[t] ?? 1);
  return w * (m.species?.[speciesId] ?? 1);
}

// ---------- 解析 Open-Meteo 的回應（壞掉的資料一律回傳 null，不要讓遊戲卡住） ----------
// geocoding：https://geocoding-api.open-meteo.com/v1/search?name=…&count=5&language=zh
export function parseGeocoding(json) {
  const list = Array.isArray(json?.results) ? json.results : [];
  return list
    .filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && Math.abs(r.latitude) <= 90 && Math.abs(r.longitude) <= 180)
    .slice(0, 5)
    .map(r => ({
      name: String(r.name ?? '').slice(0, 40),
      region: [r.admin1, r.country].filter(Boolean).map(String).join('・').slice(0, 60),
      lat: r.latitude,
      lon: r.longitude,
    }));
}

// forecast：https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&current=weather_code,is_day
export function parseForecast(json) {
  const cur = json?.current;
  if (!cur || !Number.isFinite(cur.weather_code)) return null;
  const weather = weatherFromCode(cur.weather_code, cur.is_day !== 0);
  return weather ? { weather, code: cur.weather_code } : null;
}

export const geocodingUrl = city => `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=5&language=zh&format=json`;
export const forecastUrl = (lat, lon) => `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=weather_code,is_day`;
