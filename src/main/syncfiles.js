// 同步資料夾的檔案讀寫（main process）。只會碰 <資料夾>/kalos-amie/save.<裝置>.json：
// 資料夾一定要是已經存在的絕對路徑、裝置 id 一定要符合格式，檔名是固定的，不能拿來讀寫別的檔案。
// 這個檔案不 import electron，可以直接用 node --test 測。
import { readdir, readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const SUB = 'kalos-amie';
const DEVICE_RE = /^[a-z0-9]{6,32}$/;
const FILE_RE = /^save\.([a-z0-9]{6,32})\.json$/;
const MAX_BYTES = 5 * 1024 * 1024;

async function checkFolder(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('同步資料夾要是絕對路徑');
  const st = await stat(folder);
  if (!st.isDirectory()) throw new Error('同步資料夾不是資料夾');
  return path.join(folder, SUB);
}

// 其他電腦的存檔：[{ deviceId, data }]；讀不到或壞掉的檔案略過
export async function listSyncFiles(folder, selfId) {
  const dir = await checkFolder(folder);
  let names = [];
  try { names = await readdir(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    const m = name.match(FILE_RE);
    if (!m || m[1] === selfId) continue;
    try {
      const file = path.join(dir, name);
      if ((await stat(file)).size > MAX_BYTES) continue;
      out.push({ deviceId: m[1], data: JSON.parse(await readFile(file, 'utf8')) });
    } catch { /* 雲端同步到一半的檔案、壞掉的 JSON：下次再讀 */ }
  }
  return out;
}

// 寫這台電腦的存檔：先寫暫存檔再改名（雲端同步程式不會讀到寫一半的檔案）
export async function writeSyncFile(folder, deviceId, data) {
  if (!DEVICE_RE.test(deviceId)) throw new Error('裝置 id 格式不對');
  const dir = await checkFolder(folder);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `save.${deviceId}.json`);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, file);
  return file;
}
