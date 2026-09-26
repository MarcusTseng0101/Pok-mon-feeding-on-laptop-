// PR 5：同步資料夾的檔案讀寫
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listSyncFiles, writeSyncFile } from '../src/main/syncfiles.js';

test('同步檔案：寫在 kalos-amie 子資料夾、讀的時候略過自己和壞掉的檔案', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kalos-sync-'));
  try {
    await writeSyncFile(root, 'devaaaa1', { a: 1 });
    await writeSyncFile(root, 'devbbbb2', { b: 2 });
    await writeFile(path.join(root, 'kalos-amie', 'save.devcccc3.json'), '{ 壞掉的');
    await writeFile(path.join(root, 'kalos-amie', 'notes.txt'), 'hi');
    assert.deepEqual((await readdir(path.join(root, 'kalos-amie'))).sort(), ['notes.txt', 'save.devaaaa1.json', 'save.devbbbb2.json', 'save.devcccc3.json']);
    assert.deepEqual(await listSyncFiles(root, 'devaaaa1'), [{ deviceId: 'devbbbb2', data: { b: 2 } }]);
    // 覆寫
    await writeSyncFile(root, 'devbbbb2', { b: 3 });
    assert.deepEqual(await listSyncFiles(root, 'devaaaa1'), [{ deviceId: 'devbbbb2', data: { b: 3 } }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('同步檔案：不合法的裝置 id、相對路徑、不存在的資料夾一律拒絕', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kalos-sync-'));
  try {
    await assert.rejects(writeSyncFile(root, '../../evil', {}));
    await assert.rejects(writeSyncFile(root, 'AB', {}));
    await assert.rejects(writeSyncFile('relative/dir', 'devaaaa1', {}));
    await assert.rejects(writeSyncFile(path.join(root, 'nope'), 'devaaaa1', {}));
    await assert.rejects(listSyncFiles('relative', 'devaaaa1'));
    assert.deepEqual(await listSyncFiles(root, 'devaaaa1'), [], '還沒有 kalos-amie 子資料夾：空的');
    await mkdir(path.join(root, 'kalos-amie'));
    assert.deepEqual(await listSyncFiles(root, 'devaaaa1'), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
