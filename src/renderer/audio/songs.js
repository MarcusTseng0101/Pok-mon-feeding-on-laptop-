// 原創曲目。記譜：音名+八度.長度（16 分音符格數），r 是休止；鼓軌 k=大鼓 s=小鼓 h=鈸。

const rep = (s, n) => Array(n).fill(s).join(' ');

// 「午後的泡芙店」— 白天。F 大調，I–vi–IV–V
const CAFE_CHORDS = ['F', 'Dm', 'Bb', 'C', 'F', 'Dm', 'Gm', 'C', 'Bb', 'C', 'Am', 'Dm', 'Gm', 'C', 'F', 'F'];
const BASS = { F: 'F2 C3 F3 C3', Dm: 'D2 A2 D3 A2', Bb: 'Bb1 F2 Bb2 F2', C: 'C2 G2 C3 G2', Gm: 'G1 D2 G2 D2', Am: 'A1 E2 A2 E2' };
const ARP = { F: 'F4 A4 C5 A4', Dm: 'D4 F4 A4 F4', Bb: 'Bb3 D4 F4 D4', C: 'C4 E4 G4 E4', Gm: 'G3 Bb3 D4 Bb3', Am: 'A3 C4 E4 C4' };
const each = (chords, map, len) => chords.map(c => map[c].split(' ').map(n => `${n}.${len}`).join(' ')).join(' ');
const twice = (chords, map, len) => chords.map(c => { const b = map[c].split(' ').map(n => `${n}.${len}`).join(' '); return `${b} ${b}`; }).join(' ');

const cafe = {
  bpm: 100,
  tracks: [
    {
      inst: 'lead',
      notes: `
        C5.4 A4.2 C5.2 F5.6 E5.2   D5.4 F5.4 A5.6 G5.2   F5.3 D5.1 Bb4.4 D5.4 F5.4   G5.6 F5.2 E5.4 D5.4
        C5.4 A4.2 C5.2 F5.6 A5.2   A5.4 G5.2 F5.2 D5.8   Bb4.4 D5.4 G5.4 F5.2 E5.2   E5.4 G5.4 E5.2 D5.2 C5.4
        D5.4 F5.4 Bb5.8            C5.4 E5.4 G5.8        A5.4 G5.2 E5.2 C5.8          D5.4 F5.4 A5.4 F5.4
        G5.4 F5.2 D5.2 Bb4.8       C5.4 E5.4 G5.4 Bb5.4  A5.6 G5.2 F5.8               F5.4 r.4 E5.4 G5.4`,
    },
    { inst: 'soft', notes: twice(CAFE_CHORDS, ARP, 2) },
    { inst: 'bass', notes: each(CAFE_CHORDS, BASS, 4) },
    { inst: 'drums', vol: 0.6, notes: 'k.2 h.2 r.2 h.2 r.2 h.2 r.2 h.2' },
  ],
};

// 「星空下的午睡」— 夜晚。3/4 拍搖籃曲
const NIGHT_CHORDS = ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'C'];
const NIGHT_ARP = {
  Am: 'A3 C4 E4 A4 E4 C4', F: 'F3 A3 C4 F4 C4 A3', C: 'C4 E4 G4 C5 G4 E4', G: 'G3 B3 D4 G4 D4 B3',
};
const nocturne = {
  bpm: 76,
  tracks: [
    {
      inst: 'bell',
      notes: `
        E5.6 D5.2 C5.4   A4.8 C5.4   G4.6 A4.2 C5.4   D5.12
        E5.6 G5.2 A5.4   F5.6 E5.2 C5.4   D5.6 B4.2 G4.4   C5.12
        A5.6 G5.2 E5.4   F5.8 A5.4   G5.6 E5.2 C5.4   B4.6 D5.2 G5.4
        C6.6 B5.2 A5.4   A5.6 G5.2 F5.4   B4.6 C5.2 D5.4   C5.12`,
    },
    { inst: 'soft', vol: 0.8, notes: NIGHT_CHORDS.map(c => NIGHT_ARP[c].split(' ').map(n => `${n}.2`).join(' ')).join(' ') },
    { inst: 'bass', vol: 0.7, notes: 'A2.12 F2.12 C3.12 G2.12 A2.12 F2.12 G2.12 C3.12' },
  ],
};

// 「草叢裡有什麼！」— 野生寶可夢出現
const wild = {
  bpm: 150,
  tracks: [
    {
      inst: 'lead',
      notes: `
        D5.2 r.2 D5.2 F5.2 A5.4 G5.2 F5.2   F5.2 r.2 F5.2 D5.2 Bb4.4 C5.2 D5.2
        E5.2 r.2 E5.2 G5.2 C6.4 Bb5.2 G5.2  A5.4 C#6.4 E6.4 r.4
        A5.2 r.2 A5.2 G5.2 F5.4 E5.2 D5.2   D5.2 r.2 F5.2 Bb5.2 A5.4 G5.2 F5.2
        G5.2 r.2 E5.2 C5.2 G5.4 A5.2 Bb5.2  A5.8 E5.4 C#5.4`,
    },
    { inst: 'soft', vol: 1.2, notes: `${rep('r.2 F4.2', 4)} ${rep('r.2 D4.2', 4)} ${rep('r.2 E4.2', 4)} ${rep('r.2 C#4.2', 4)}` },
    {
      inst: 'bass',
      notes: `${rep('D2.2 D3.2 A2.2 D3.2', 2)} ${rep('Bb1.2 Bb2.2 F2.2 Bb2.2', 2)} ${rep('C2.2 C3.2 G2.2 C3.2', 2)} ${rep('A1.2 A2.2 E2.2 A2.2', 2)}`,
    },
    { inst: 'drums', notes: 'k.2 h.2 s.2 h.2 k.2 k.2 s.2 h.2' },
  ],
};

// 進化中（循環）
const evolving = {
  bpm: 96,
  tracks: [
    { inst: 'bell', notes: 'C5.2 Eb5.2 G5.2 Bb5.2 C6.2 Bb5.2 G5.2 Eb5.2 D5.2 F5.2 Ab5.2 C6.2 D6.2 C6.2 Ab5.2 F5.2' },
    { inst: 'bass', vol: 0.8, notes: 'C3.16 Bb2.16' },
    { inst: 'drums', vol: 0.5, notes: 'r.4 h.4 r.4 h.4' },
  ],
};

// ---- 短旋律（jingle，不循環） ----
const caught = {
  bpm: 132, loop: false,
  tracks: [
    { inst: 'lead', notes: 'G4.2 C5.2 E5.2 G5.2 C6.6 A5.2 B5.2 C6.10' },
    { inst: 'soft', notes: 'E4.2 E4.2 G4.2 C5.2 E5.6 F5.2 G5.2 E5.10' },
    { inst: 'bass', notes: 'C3.8 F2.8 G2.4 C3.8' },
  ],
};
const newEntry = {
  bpm: 140, loop: false,
  tracks: [
    { inst: 'lead', notes: 'E5.2 G5.2 C6.4 B5.2 C6.2 E6.8' },
    { inst: 'bass', notes: 'C3.8 G2.4 C3.8' },
  ],
};
const evolved = {
  bpm: 120, loop: false,
  tracks: [
    { inst: 'lead', notes: 'G5.2 C6.2 E6.2 G6.8 r.2 E6.2 F6.2 G6.12' },
    { inst: 'soft', notes: 'E5.2 G5.2 C6.2 E6.8 r.2 C6.2 D6.2 E6.12' },
    { inst: 'bass', notes: 'C3.6 G2.8 F2.4 G2.4 C3.10' },
  ],
};
const gift = {
  bpm: 150, loop: false,
  tracks: [{ inst: 'lead', notes: 'C6.2 E6.2 G6.2 C7.6' }, { inst: 'bass', notes: 'C3.4 G3.8' }],
};
const hearts = {
  bpm: 150, loop: false,
  tracks: [{ inst: 'bell', notes: 'A5.2 C#6.2 E6.2 A6.8' }, { inst: 'bass', notes: 'A2.4 E3.10' }],
};

export const SONGS = { cafe, nocturne, wild, evolving, caught, newEntry, evolved, gift, hearts };
