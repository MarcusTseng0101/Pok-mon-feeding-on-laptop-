import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SONGS } from '../src/renderer/audio/songs.js';
import { parseTrack, noteFreq } from '../src/renderer/audio/audio.js';

const length = track => parseTrack(track.notes).reduce((s, e) => s + e.steps, 0);

test('音名換算頻率', () => {
  assert.equal(noteFreq('A4'), 440);
  assert.ok(Math.abs(noteFreq('C4') - 261.63) < 0.01);
  assert.ok(Math.abs(noteFreq('Bb3') - noteFreq('A#3')) < 1e-9);
  assert.equal(noteFreq('r'), null);
});

test('每一首歌的每個音都能解析', () => {
  for (const [name, song] of Object.entries(SONGS)) {
    for (const tr of song.tracks) {
      for (const ev of parseTrack(tr.notes)) {
        assert.ok(Number.isInteger(ev.steps) && ev.steps > 0, `${name}: ${ev.note}.${ev.steps}`);
        if (tr.inst === 'drums') assert.ok(['k', 's', 'h', 'r'].includes(ev.note), `${name} 鼓：${ev.note}`);
        else assert.ok(ev.note === 'r' || noteFreq(ev.note), `${name}: 無法解析 ${ev.note}`);
      }
    }
  }
});

test('循環曲目：各軌長度整除最長的一軌（不會越播越錯拍）', () => {
  for (const [name, song] of Object.entries(SONGS)) {
    if (song.loop === false) continue;
    const lens = song.tracks.map(length);
    const max = Math.max(...lens);
    for (const l of lens) assert.equal(max % l, 0, `${name}: 軌長 ${lens.join('/')}`);
  }
});

test('小節對齊：4/4 拍的歌每軌長度是 16 的倍數，夜晚的 3/4 拍是 12 的倍數', () => {
  for (const name of ['cafe', 'wild', 'evolving']) for (const tr of SONGS[name].tracks) assert.equal(length(tr) % 16, 0, `${name}`);
  for (const tr of SONGS.nocturne.tracks) assert.equal(length(tr) % 12, 0);
});
