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

// ---------- 搜尋城市：Open-Meteo 只比對「地名本身」，所以「台中東區」這種 城市+區 的寫法會找不到 ----------
// 做法：把輸入拆成幾個候選查詢，由精確到寬鬆一個一個試，第一個有結果的就用：
//   1. 原本的字（加上 台/臺 互換）
//   2. 拆成「城市」＋「地方」：先查地方（例如「東區」），只留在那個城市裡的結果
//   3. 只查城市（台中 → 臺中市 → Taichung）；天氣用城市的就夠準了
// 台灣的縣市有英文名備用，因為 GeoNames 的英文名一定查得到。
const TW_EN = {
  台北: 'Taipei', 新北: 'New Taipei', 桃園: 'Taoyuan', 台中: 'Taichung', 台南: 'Tainan', 高雄: 'Kaohsiung',
  基隆: 'Keelung', 新竹: 'Hsinchu', 嘉義: 'Chiayi', 苗栗: 'Miaoli', 彰化: 'Changhua', 南投: 'Nantou',
  雲林: 'Yunlin', 屏東: 'Pingtung', 宜蘭: 'Yilan', 花蓮: 'Hualien', 台東: 'Taitung', 澎湖: 'Penghu',
  金門: 'Kinmen', 連江: 'Lienchiang', 馬祖: 'Matsu', 中壢: 'Zhongli', 板橋: 'Banqiao', 新莊: 'Xinzhuang',
  三重: 'Sanchong', 永和: 'Yonghe', 中和: 'Zhonghe', 淡水: 'Tamsui', 竹北: 'Zhubei', 斗六: 'Douliu', 豐原: 'Fengyuan',
};
const MAX_QUERIES = 8;
const tai = s => s.replace(/臺/g, '台');
const variants = s => [...new Set([s, tai(s), tai(s).replace(/台/g, '臺')])];
const stripSuffix = s => (s.length > 2 ? s.replace(/[市縣區鄉鎮]$/, '') : s);

// 把輸入拆成 { city, place }：「台中東區」「台中市東區」「台中 東區」「Taichung, East District」
export function splitPlace(input) {
  const s = String(input ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const cjk = /[一-鿿]/.test(s);
  const parts = s.split(cjk ? /\s*[,，、・/ ]\s*/ : /\s*[,，/]\s*/).filter(Boolean);
  if (parts.length >= 2 && cjk) return { city: stripSuffix(parts[0]), place: parts.slice(1).join('') };
  if (parts.length >= 2) return { city: parts.at(-1), place: parts.slice(0, -1).join(' ') }; // 英文習慣：小地方, 城市
  const t = tai(s);
  const m = t.match(/^(.{2,3}?)[市縣](.{2,})$/);
  if (m) return { city: m[1], place: m[2] };
  const known = Object.keys(TW_EN).filter(k => t.startsWith(k) && t.length > k.length + 1).sort((a, b) => b.length - a.length)[0];
  if (known) return { city: known, place: t.slice(known.length) };
  return { city: null, place: null };
}

// 候選查詢：[{ q, near?: [城市的各種寫法], note? }]
export function searchPlan(input) {
  const s = String(input ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!s) return [];
  const plan = [];
  const seen = new Set();
  const add = (q, extra = {}) => {
    if (q && !seen.has(q)) { seen.add(q); plan.push({ q, ...extra }); }
  };
  for (const v of variants(s)) add(v);
  const { city, place } = splitPlace(s);
  const base = stripSuffix(tai(city ?? s));
  const en = TW_EN[base];
  if (city && place) {
    const near = [...new Set([tai(base), en].filter(Boolean).map(x => x.toLowerCase()))];
    add(place, { near });
    if (stripSuffix(place) !== place) add(stripSuffix(place), { near });
    const placeEn = TW_EN[stripSuffix(tai(place))];
    if (placeEn) add(placeEn, { near });
  }
  // 只查城市：中文 → 英文 → 其他寫法（查詢次數有上限，所以最可能中的放前面）
  const extra = city && place ? { note: `找不到「${place}」，改用「${city}」的天氣` } : {};
  add(base, extra);
  if (en) {
    add(`${base.replace(/台/g, '臺')}市`, extra);
    add(en, extra);
    add(`${base}市`, extra);
    add(`${base.replace(/台/g, '臺')}縣`, extra);
  } else if (base !== s) add(stripSuffix(base), extra);
  return plan;
}

const inNear = (p, near) => near.some(n => tai(`${p.name} ${p.region}`).toLowerCase().includes(n));

// fetchJson(url) → JSON 或 null（連不上）。回傳 { places, note?, offline }
export async function searchPlaces(input, fetchJson, { maxQueries = MAX_QUERIES } = {}) {
  let tried = 0;
  let reached = false;
  for (const step of searchPlan(input)) {
    if (tried >= maxQueries) break;
    tried++;
    const json = await fetchJson(geocodingUrl(step.q));
    if (json == null) continue;
    reached = true;
    let places = parseGeocoding(json);
    if (step.near) places = places.filter(p => inNear(p, step.near));
    if (places.length) return { places, ...(step.note ? { note: step.note } : {}), offline: false };
  }
  return { places: [], offline: !reached };
}
