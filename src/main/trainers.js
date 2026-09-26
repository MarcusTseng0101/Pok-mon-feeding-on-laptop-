// 故事裡的人的圖：Pokémon Showdown 的訓練家圖（play.pokemonshowdown.com/sprites/trainers/<名字>.png）。
// 第一次需要時下載，存在 userData/trainers，之後離線也能用；沒有這張（404）就記一個空檔，不再下載。
// 圖不放進 repo；有些是同好畫的，出處見 README。
import { net } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://play.pokemonshowdown.com/sprites/trainers';
const MAX_PNG = 512 * 1024;
export const isTrainerName = name => typeof name === 'string' && /^[a-z0-9-]{1,40}$/.test(name);

export function createTrainerCache(dir) {
  const inflight = new Map();

  async function load(name) {
    const file = path.join(dir, `${name}.png`);
    try {
      const buf = await readFile(file);
      return buf.length ? buf : null;
    } catch { /* 還沒快取 */ }
    const res = await net.fetch(`${BASE}/${name}.png`);
    if (res.status === 404) { await mkdir(dir, { recursive: true }); await writeFile(file, Buffer.alloc(0)); return null; }
    if (!res.ok) throw new Error(`trainer ${name} ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_PNG || buf.subarray(1, 4).toString() !== 'PNG') throw new Error(`trainer ${name} 不是 PNG`);
    await mkdir(dir, { recursive: true });
    await writeFile(file, buf);
    return buf;
  }

  // 回傳 data URL；沒有或下載失敗回傳 null（畫面會用剪影）
  return function getTrainerSprite(name) {
    if (!isTrainerName(name)) return Promise.resolve(null);
    if (!inflight.has(name)) {
      const p = load(name)
        .then(buf => (buf ? `data:image/png;base64,${buf.toString('base64')}` : null))
        .catch(err => { console.warn('無法取得訓練家圖', name, err.message); inflight.delete(name); return null; });
      inflight.set(name, p);
    }
    return inflight.get(name);
  };
}
