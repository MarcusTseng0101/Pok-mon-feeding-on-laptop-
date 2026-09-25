// 存檔讀寫：寫到暫存檔再 rename，當機或斷電時不會留下半份 JSON。
import { readFile, writeFile, rename, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export function createStore(dir) {
  const file = path.join(dir, 'save.json');
  const backup = path.join(dir, 'save.bak.json');
  let writing = Promise.resolve();

  async function readJson(p) {
    try {
      return JSON.parse(await readFile(p, 'utf8'));
    } catch {
      return null;
    }
  }

  return {
    file,
    async load() {
      await mkdir(dir, { recursive: true });
      return (await readJson(file)) ?? (await readJson(backup));
    },
    save(data) {
      // 串起來依序寫，避免兩次存檔同時 rename
      writing = writing.then(async () => {
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify(data));
        try { await copyFile(file, backup); } catch { /* 第一次存檔還沒有舊檔 */ }
        await rename(tmp, file);
      }).catch(err => console.error('存檔失敗', err));
      return writing;
    },
  };
}
