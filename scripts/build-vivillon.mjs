// 產生 src/core/vivillon.js：時區 → 彩粉蝶花紋。
//
// 原作依 3DS 設定的「國家／地區」決定花紋：遊戲內有一張世界地圖，用該地區的經緯度去查。
// 這裡用兩份公開資料重現：
//   1. abcboy101/vivillon 的 data_points.json：每個 3DS 國家／地區的經緯度與對應花紋
//      （和 PKHeX 的 Vivillon3DS.cs 合法性檢查表逐筆比對過，1471 筆完全一致）
//   2. IANA tz 資料庫的 zone.tab：每個時區的國家代碼與代表城市的經緯度；iso3166.tab：國家代碼與英文名稱
// 每個時區 → 同一個國家裡、離代表城市最近的地區 → 花紋。
// 時區所在的國家不在 3DS 的國家清單裡就不收，執行時會回到預設（花園花紋）。
//
// 執行：node scripts/build-vivillon.mjs [資料夾]
//   資料夾裡有 data_points.json、zone.tab、iso3166.tab、backward 就直接用，否則從 GitHub 下載。
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '../src/core/vivillon.js');
const SOURCES = {
  'data_points.json': 'https://raw.githubusercontent.com/abcboy101/vivillon/main/data_points.json',
  'zone.tab': 'https://raw.githubusercontent.com/eggert/tz/main/zone.tab',
  'iso3166.tab': 'https://raw.githubusercontent.com/eggert/tz/main/iso3166.tab',
  backward: 'https://raw.githubusercontent.com/eggert/tz/main/backward',
};
// 3DS 的國家名稱和 ISO 的寫法不一樣的（key 是 3DS 的國家編號）
const COUNTRY_OVERRIDES = {
  9: ['AG'], 17: ['VG'], 38: ['CW', 'SX', 'BQ'], 43: ['KN'], 44: ['LC'], 45: ['VC'], 47: ['TT'], 48: ['TC'],
  51: ['VI'], 68: ['BA'], 74: ['DK', 'GL', 'FO'], 89: ['MK'], 101: ['RS'], 106: ['SZ'], 110: ['GB'], 136: ['KR'], 168: ['AE'],
};
// 原作的花紋編號 0–17（Fancy、Poké Ball 是配信限定，不會從地區決定）
const PATTERNS = [
  'icy-snow', 'polar', 'tundra', 'continental', 'garden', 'elegant', 'meadow', 'modern', 'marine',
  'archipelago', 'high-plains', 'sandstorm', 'river', 'monsoon', 'savanna', 'sun', 'ocean', 'jungle',
];

async function load(name, dir) {
  if (dir) {
    try { return await readFile(path.join(dir, name), 'utf8'); } catch { /* 下載 */ }
  }
  const res = await fetch(SOURCES[name]);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.text();
}

// zone.tab 的座標：±DDMM±DDDMM 或 ±DDMMSS±DDDMMSS
function parseCoord(s) {
  const m = s.match(/^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/);
  if (!m) throw new Error(`bad coord ${s}`);
  const deg = (sign, d, mm, ss = '0') => (sign === '-' ? -1 : 1) * (Number(d) + Number(mm) / 60 + Number(ss) / 3600);
  return { lat: deg(m[1], m[2], m[3], m[4]), lon: deg(m[5], m[6], m[7], m[8]) };
}

function distance(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(h));
}

const dir = process.argv[2];
const points = JSON.parse(await load('data_points.json', dir));
// data_points.json 的 region 欄位是主機的販售區域（JP／US／EU…），不是國家代碼，要用名稱對 ISO 代碼
const isoByName = new Map();
for (const line of (await load('iso3166.tab', dir)).split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [cc, name] = line.split('\t');
  isoByName.set(name.toLowerCase(), cc);
}
const byCountry = new Map();
for (const c of points) {
  const codes = COUNTRY_OVERRIDES[c.index] ?? [isoByName.get(c.name['en-US'].toLowerCase())];
  if (!codes[0]) throw new Error(`找不到 ${c.index} ${c.name['en-US']} 的 ISO 代碼，加進 COUNTRY_OVERRIDES`);
  for (const cc of codes) byCountry.set(cc, c.divisions.filter(d => Number.isInteger(d.form)));
}

const table = {};
const skipped = [];
for (const line of (await load('zone.tab', dir)).split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [cc, coord, tz] = line.split('\t');
  const divisions = byCountry.get(cc);
  if (!divisions?.length) { skipped.push(`${tz}(${cc})`); continue; }
  const at = parseCoord(coord);
  const best = divisions.reduce((a, d) => (distance(at, { lat: d.latitude, lon: d.longitude }) < distance(at, { lat: a.latitude, lon: a.longitude }) ? d : a));
  table[tz] = PATTERNS[best.form];
}
// 舊名稱（Asia/Calcutta → Asia/Kolkata…）
for (const line of (await load('backward', dir)).split('\n')) {
  const m = line.match(/^Link\s+(\S+)\s+(\S+)/);
  if (m && table[m[1]] && !table[m[2]]) table[m[2]] = table[m[1]];
}

const zones = Object.keys(table).sort();
const body = zones.map(z => `  '${z}': '${table[z]}',`).join('\n');
await writeFile(OUT, `// 自動產生，不要手動修改：node scripts/build-vivillon.mjs
// 時區 → 彩粉蝶花紋（依原作的 3DS 國家／地區設定）。來源與做法寫在 scripts/build-vivillon.mjs。
// 沒列出的時區（3DS 沒有的國家、UTC…）用預設的花園花紋。

export const VIVILLON_BY_TZ = {
${body}
};

export function vivillonForTimeZone(tz) {
  return VIVILLON_BY_TZ[tz] ?? 'meadow';
}
`);
console.log(`${zones.length} 個時區；3DS 沒有這個國家而略過 ${skipped.length} 個`);
console.log(`例：Asia/Taipei=${table['Asia/Taipei']}, Asia/Tokyo=${table['Asia/Tokyo']}, Europe/Paris=${table['Europe/Paris']}, America/New_York=${table['America/New_York']}, America/Los_Angeles=${table['America/Los_Angeles']}`);
