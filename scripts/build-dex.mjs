// 從 PokeAPI 的靜態資料鏡像（GitHub api-data）產生 data/kalos.json。
// 只在開發時跑一次，結果 commit 進 repo，遊戲執行時不需要連網拿資料。
//   NODE_USE_ENV_PROXY=1 node scripts/build-dex.mjs   （在有 proxy 的環境）
import { writeFile, mkdir, readFile } from 'node:fs/promises';

const BASE = 'https://raw.githubusercontent.com/PokeAPI/api-data/master/data';
const FIRST = 650, LAST = 721; // 卡洛斯（第六世代）新登場的 72 種

async function get(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${BASE}${path.endsWith('/') ? path : path + '/'}index.json`);
      if (!res.ok) throw new Error(`${res.status} ${path}`);
      return await res.json();
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

const idFromUrl = url => Number(url.match(/\/(\d+)\/?$/)[1]);
const pickLang = (list, langs, key = 'name') => {
  for (const l of langs) {
    const hit = list.find(e => e.language.name === l);
    if (hit) return hit[key];
  }
  return null;
};

// JSON 鏡像沒有繁中圖鑑敘述，但 CSV 有（第七世代以後登場過的才有）。
// 取每種寶可夢版本號最大的那筆繁中（language_id 4）；缺的用 data/flavor-zh-translated.json。
const CSV_URL = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_flavor_text.csv';
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
async function loadZhFlavors() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`${res.status} flavor csv`);
  const best = new Map(); // speciesId -> { version, text }
  for (const [sid, vid, lid, text] of parseCsv(await res.text()).slice(1)) {
    if (lid !== '4') continue;
    const id = Number(sid), version = Number(vid);
    if (id < FIRST || id > LAST) continue;
    if (!best.has(id) || best.get(id).version < version) best.set(id, { version, text });
  }
  return new Map([...best].map(([id, v]) => [id, v.text.replace(/[\n\f­]+/g, '')]));
}

async function main() {
  const zhFlavors = await loadZhFlavors();
  const translated = JSON.parse(await readFile(new URL('../data/flavor-zh-translated.json', import.meta.url), 'utf8'));
  const ids = [];
  for (let id = FIRST; id <= LAST; id++) ids.push(id);

  const species = [];
  const chainUrls = new Set();
  for (const id of ids) {
    const [s, p] = await Promise.all([get(`/api/v2/pokemon-species/${id}`), get(`/api/v2/pokemon/${id}`)]);
    chainUrls.add(s.evolution_chain.url);
    species.push({
      id,
      slug: s.name,
      name: {
        zh: pickLang(s.names, ['zh-hant', 'zh-Hant']),
        ja: pickLang(s.names, ['ja-hrkt', 'ja-Hrkt', 'ja']),
        en: pickLang(s.names, ['en']),
      },
      genus: pickLang(s.genera, ['zh-hant', 'zh-Hant', 'en'], 'genus'),
      flavor: zhFlavors.get(id) ?? translated[id] ?? null,
      flavorOfficial: zhFlavors.has(id),
      types: p.types.sort((a, b) => a.slot - b.slot).map(t => t.type.name),
      height: p.height / 10, // m
      weight: p.weight / 10, // kg
      captureRate: s.capture_rate,
      baseHappiness: s.base_happiness,
      legendary: s.is_legendary,
      mythical: s.is_mythical,
      evolvesFrom: s.evolves_from_species ? idFromUrl(s.evolves_from_species.url) : null,
      evolutions: [], // 下面由進化鏈填入
    });
    process.stdout.write(`\r${id}`);
  }
  process.stdout.write('\n');

  const byId = new Map(species.map(s => [s.id, s]));
  for (const url of chainUrls) {
    const chain = await get(url.replace(/^.*?\/api\//, '/api/'));
    const walk = node => {
      const fromId = idFromUrl(node.species.url);
      for (const next of node.evolves_to) {
        const toId = idFromUrl(next.species.url);
        const from = byId.get(fromId);
        if (from && byId.has(toId)) {
          const d = next.evolution_details[0] ?? {};
          from.evolutions.push({
            to: toId,
            trigger: d.trigger?.name ?? 'level-up',
            minLevel: d.min_level ?? null,
            item: d.item?.name ?? d.held_item?.name ?? null,
            timeOfDay: d.time_of_day || null,
            partyType: d.party_type?.name ?? null,
            upsideDown: Boolean(d.turn_upside_down),
          });
        }
        walk(next);
      }
    };
    walk(chain.chain);
  }

  const natures = [];
  for (let n = 1; n <= 25; n++) {
    const nat = await get(`/api/v2/nature/${n}`);
    natures.push({
      slug: nat.name,
      zh: pickLang(nat.names, ['zh-hant', 'zh-Hant', 'en']),
      likes: nat.likes_flavor?.name ?? null,
      hates: nat.hates_flavor?.name ?? null,
    });
  }

  const typeNames = {};
  for (let t = 1; t <= 18; t++) { // 靜態鏡像只有數字 id
    const td = await get(`/api/v2/type/${t}`);
    typeNames[td.name] = pickLang(td.names, ['zh-hant', 'zh-Hant', 'en']);
  }

  const missing = species.filter(s => !s.name.zh || !s.flavor).map(s => s.id);
  if (missing.length) console.warn('缺少繁中名稱或敘述：', missing.join(','));

  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(new URL('../data/kalos.json', import.meta.url),
    JSON.stringify({ source: 'PokeAPI api-data', generatedAt: new Date().toISOString(), typeNames, natures, species }, null, 1));
  console.log(`寫入 ${species.length} 種寶可夢、${natures.length} 種性格`);
}

main().catch(err => { console.error(err); process.exit(1); });
