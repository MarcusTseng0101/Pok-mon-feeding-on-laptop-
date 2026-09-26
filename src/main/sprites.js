// 寶可夢圖片：第一次需要時從 PokeAPI 的 sprites repo 下載，存在 userData/sprites，之後離線也能用。
// 圖片不放進 repo（版權屬於任天堂／Game Freak），只在使用者自己的電腦上快取。
import { net } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { isSpriteKey } from '../core/forms.js';

const BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const MAX_PARALLEL = 4;
const MAX_GIF = 2 * 1024 * 1024; // 最大的也才兩三百 KB，超過就當作壞掉

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

  // 會動的圖（Pokémon Showdown 的 GIF，跟 X／Y 同一套 3D 模型）。
  // 沒有這張圖（404）就記一個空檔，之後不再下載；網路不通則下次再試
  async function fetchGif(key, shiny) {
    const file = path.join(dir, 'anim', shiny ? 'shiny' : 'normal', `${key}.gif`);
    try {
      const buf = await readFile(file);
      return buf.length ? buf : null;
    } catch { /* 還沒快取 */ }
    const res = await net.fetch(`${BASE}/other/showdown${shiny ? '/shiny' : ''}/${key}.gif`);
    if (res.status === 404) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, Buffer.alloc(0)); return null; }
    if (!res.ok) throw new Error(`anim ${key} ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_GIF || buf.subarray(0, 3).toString() !== 'GIF') throw new Error(`anim ${key} 不是 GIF`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, buf);
    return buf;
  }

  function cached(key, load, type) {
    if (!inflight.has(key)) {
      const p = enqueue(load)
        .then(buf => (buf ? `data:${type};base64,${buf.toString('base64')}` : null))
        .catch(err => {
          console.warn('無法取得圖片', key, err.message);
          inflight.delete(key); // 下次再試
          return null;
        });
      inflight.set(key, p);
    }
    return inflight.get(key);
  }

  // key：'669'、'669-blue'、'10075'（見 core/forms.js 的 spriteKey）
  // 回傳 data URL；下載失敗回傳 null（畫面會用自己畫的替代圖）
  function getSprite(spriteKey, shiny = false) {
    // key 會拿來組檔案路徑：不合格式的一律拒絕，不然 '../../' 可以寫到任何地方
    if (!isSpriteKey(spriteKey)) return Promise.resolve(null);
    return cached(`${spriteKey}:${shiny}`, () => fetchPng(spriteKey, shiny), 'image/png');
  }

  // 會動的圖：data URL（image/gif）；沒有這張或下載失敗回傳 null（就用不會動的圖）
  function getAnimSprite(spriteKey, shiny = false) {
    if (!isSpriteKey(spriteKey)) return Promise.resolve(null);
    return cached(`anim:${spriteKey}:${shiny}`, () => fetchGif(spriteKey, shiny), 'image/gif');
  }

  return { getSprite, getAnimSprite };
}
