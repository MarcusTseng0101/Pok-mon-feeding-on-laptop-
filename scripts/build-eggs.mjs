// 產生 src/core/eggdata.js：卡洛斯 72 種的孵化週期（egg cycles）與蛋群。
// 來源：PokeAPI 的靜態資料（GitHub 上的 api-data），pokemon-species/<id> 的 hatch_counter 與 egg_groups。
// 只在建置時跑一次，遊戲執行時不連網。
//
// 執行：node scripts/build-eggs.mjs [資料夾]
//   資料夾裡有 <id>.json 就直接用，否則從 GitHub 下載。
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '../src/core/eggdata.js');
const BASE = 'https://raw.githubusercontent.com/PokeAPI/api-data/master/data/api/v2/pokemon-species';
const dir = process.argv[2];

async function species(id) {
  if (dir) {
    try { return JSON.parse(await readFile(path.join(dir, `${id}.json`), 'utf8')); } catch { /* 下載 */ }
  }
  const res = await fetch(`${BASE}/${id}/index.json`);
  if (!res.ok) throw new Error(`${id}: ${res.status}`);
  return res.json();
}

const rows = [];
for (let id = 650; id <= 721; id++) {
  const s = await species(id);
  rows.push(`  ${id}: { cycles: ${s.hatch_counter}, groups: [${s.egg_groups.map(g => `'${g.name}'`).join(', ')}] },`);
}
await writeFile(OUT, `// 自動產生，不要手動修改：node scripts/build-eggs.mjs
// 卡洛斯 72 種的孵化週期與蛋群（PokeAPI pokemon-species 的 hatch_counter、egg_groups）。
// 蛋群是 'no-eggs' 的（傳說、幻之寶可夢…）不會生蛋。

export const EGG_DATA = {
${rows.join('\n')}
};
`);
console.log(`寫入 ${rows.length} 種`);
