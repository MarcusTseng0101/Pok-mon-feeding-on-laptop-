// 寶可夢圖片：第一次需要時從 PokeAPI 的 sprites repo 下載，存在 userData/sprites，之後離線也能用。
// 圖片不放進 repo（版權屬於任天堂／Game Freak），只在使用者自己的電腦上快取。
import { net } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { isSpriteKey } from '../core/forms.js';

const BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const MAX_PARALLEL = 4;

export function createSpriteCache(dir) {
  const inflight = new Map();
  const queue = [];
  let active = 0;

  const pump = () => {
    while (active < MAX_PARALLEL && queue.length) {
      const job = queue.shift();
      active++;
      job().finally(() => { active--; pump(); });
    }
  };
  const enqueue = fn => new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    pump();
  });

  async function fetchPng(key, shiny) {
    const file = path.join(dir, shiny ? 'shiny' : 'normal', `${key}.png`);
    try {
      return await readFile(file);
    } catch { /* 還沒快取 */ }
    const res = await net.fetch(`${BASE}${shiny ? '/shiny' : ''}/${key}.png`);
    if (!res.ok) throw new Error(`sprite ${key} ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, buf);
    return buf;
  }

  // key：'669'、'669-blue'、'10075'（見 core/forms.js 的 spriteKey）
  // 回傳 data URL；下載失敗回傳 null（畫面會用自己畫的替代圖）
  return function getSprite(spriteKey, shiny = false) {
    // key 會拿來組檔案路徑：不合格式的一律拒絕，不然 '../../' 可以寫到任何地方
    if (!isSpriteKey(spriteKey)) return Promise.resolve(null);
    const key = `${spriteKey}:${shiny}`;
    if (!inflight.has(key)) {
      const p = enqueue(() => fetchPng(spriteKey, shiny))
        .then(buf => `data:image/png;base64,${buf.toString('base64')}`)
        .catch(err => {
          console.warn('無法取得圖片', key, err.message);
          inflight.delete(key); // 下次再試
          return null;
        });
      inflight.set(key, p);
    }
    return inflight.get(key);
  };
}
