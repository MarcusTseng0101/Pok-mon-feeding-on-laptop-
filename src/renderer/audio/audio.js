// 小型 chiptune 合成器：方波（不同佔空比）、三角波、雜訊；加上一個 16 分音符格的音序器。
// 所有音樂都是原創的，寫在 songs.js。

import { SONGS } from './songs.js';

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteFreq(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return null;
  let n = NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + n;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// "C5.4 r.2 E5" → [{ note, steps }]；沒寫長度就是 1 格（16 分音符）
export function parseTrack(text) {
  return text.trim().split(/\s+/).filter(Boolean).map(tok => {
    const [note, len] = tok.split('.');
    return { note, steps: len ? Number(len) : 1 };
  });
}

function pulseWave(ctx, duty) {
  const N = 48;
  const real = new Float32Array(N), imag = new Float32Array(N);
  for (let n = 1; n < N; n++) {
    real[n] = Math.sin(2 * Math.PI * n * duty) / (n * Math.PI);
    imag[n] = (1 - Math.cos(2 * Math.PI * n * duty)) / (n * Math.PI);
  }
  return ctx.createPeriodicWave(real, imag);
}

const INSTRUMENTS = {
  lead: { wave: 'pulse25', gain: 0.16, a: 0.005, d: 0.1, s: 0.55, r: 0.08, vibrato: true },
  lead50: { wave: 'pulse50', gain: 0.12, a: 0.005, d: 0.08, s: 0.6, r: 0.06 },
  soft: { wave: 'pulse125', gain: 0.07, a: 0.004, d: 0.12, s: 0.25, r: 0.05 },
  bell: { wave: 'triangle', gain: 0.26, a: 0.004, d: 0.5, s: 0.35, r: 0.35, vibrato: true },
  bass: { wave: 'triangle', gain: 0.3, a: 0.004, d: 0.05, s: 0.85, r: 0.04 },
};

export class AudioEngine {
  // ctx 可以傳 OfflineAudioContext 進來（離線輸出音檔、測試用）
  constructor(ctx = new AudioContext()) {
    this.ctx = ctx;
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.waves = {
      pulse125: pulseWave(this.ctx, 0.125),
      pulse25: pulseWave(this.ctx, 0.25),
      pulse50: pulseWave(this.ctx, 0.5),
    };
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.current = null; // { name, song, tracks, stepDur }
    this.pendingSong = null;
    this.jingleEnd = 0;
    if (ctx instanceof AudioContext) this.timer = setInterval(() => this.schedule(), 25);
  }

  setVolumes({ music, sfx, muted }) {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(muted ? 0 : 1, t, 0.05);
    this.musicBus.gain.setTargetAtTime(music, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(sfx, t, 0.05);
  }

  resume() { if (this.ctx.state !== 'running') this.ctx.resume(); }

  // ---------- 音色 ----------
  tone(freq, start, dur, inst, bus, vol = 1) {
    const spec = INSTRUMENTS[inst];
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    if (spec.wave.startsWith('pulse')) osc.setPeriodicWave(this.waves[spec.wave]);
    else osc.type = spec.wave;
    osc.frequency.setValueAtTime(freq, start);
    if (spec.vibrato && dur > 0.35) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.setValueAtTime(0, start);
      depth.gain.linearRampToValueAtTime(freq * 0.006, start + dur * 0.6);
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(start);
      lfo.stop(start + dur + spec.r + 0.05);
    }
    const g = ctx.createGain();
    const peak = spec.gain * vol;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + spec.a);
    g.gain.setTargetAtTime(peak * spec.s, start + spec.a, spec.d / 3);
    g.gain.setValueAtTime(peak * spec.s, start + dur);
    g.gain.linearRampToValueAtTime(0, start + dur + spec.r);
    osc.connect(g).connect(bus);
    osc.start(start);
    osc.stop(start + dur + spec.r + 0.02);
  }

  noiseHit(start, { dur = 0.08, type = 'highpass', freq = 6000, gain = 0.1, q = 1, bus = this.sfxBus, sweepTo = null } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, start);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, start + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(start, Math.random() * 0.5);
    src.stop(start + dur + 0.02);
  }

  drum(kind, start, bus, vol = 1) {
    if (kind === 'k') {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.frequency.setValueAtTime(140, start);
      osc.frequency.exponentialRampToValueAtTime(45, start + 0.12);
      g.gain.setValueAtTime(0.45 * vol, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
      osc.connect(g).connect(bus);
      osc.start(start);
      osc.stop(start + 0.16);
    } else if (kind === 's') {
      this.noiseHit(start, { dur: 0.12, type: 'bandpass', freq: 1800, gain: 0.22 * vol, q: 0.7, bus });
    } else if (kind === 'h') {
      this.noiseHit(start, { dur: 0.035, type: 'highpass', freq: 7000, gain: 0.07 * vol, bus });
    }
  }

  // ---------- 音序器 ----------
  playSong(name, { restart = false } = {}) {
    if (!restart && this.current?.name === name) return;
    if (this.ctx.currentTime < this.jingleEnd) { this.pendingSong = name; return; }
    this.startSong(name, this.ctx.currentTime + 0.08);
  }

  startSong(name, at) {
    const song = SONGS[name];
    if (!song) return;
    const stepDur = 60 / song.bpm / 4;
    this.current = {
      name,
      song,
      stepDur,
      loop: song.loop !== false,
      tracks: song.tracks.map(t => ({ ...t, events: parseTrack(t.notes), i: 0, time: at })),
    };
  }

  stopSong() { this.current = null; }

  // 短旋律（捕獲成功、登錄圖鑑…）：暫停背景音樂，播完再接回來
  jingle(name, { resumeWith } = {}) {
    const song = SONGS[name];
    if (!song) return 0;
    const resumeName = resumeWith ?? this.pendingSong ?? this.current?.name;
    const at = this.ctx.currentTime + 0.05;
    const stepDur = 60 / song.bpm / 4;
    let longest = 0;
    for (const t of song.tracks) {
      let time = at;
      for (const ev of parseTrack(t.notes)) {
        this.playEvent(t, ev, time, stepDur, this.sfxBus, 1.2);
        time += ev.steps * stepDur;
      }
      longest = Math.max(longest, time - at);
    }
    this.current = null;
    this.jingleEnd = at + longest + 0.4;
    this.pendingSong = resumeName;
    return longest;
  }

  playEvent(track, ev, time, stepDur, bus, volMult = 1) {
    if (ev.note === 'r') return;
    const vol = (track.vol ?? 1) * volMult;
    if (track.inst === 'drums') { this.drum(ev.note, time, bus, vol); return; }
    const f = noteFreq(ev.note);
    if (f) this.tone(f, time, ev.steps * stepDur * (track.legato ?? 0.9), track.inst, bus, vol);
  }

  schedule() {
    const now = this.ctx.currentTime;
    if (!this.current && this.pendingSong && now >= this.jingleEnd) {
      const name = this.pendingSong;
      this.pendingSong = null;
      this.startSong(name, now + 0.05);
    }
    if (this.current) this.scheduleUntil(now + 0.15, now);
  }

  scheduleUntil(horizon, now = 0) {
    const cur = this.current;
    for (const tr of cur.tracks) {
      if (tr.time < now - 0.5) tr.time = now + 0.02; // 分頁被暫停過，重新對齊
      while (tr.time < horizon) {
        if (tr.i >= tr.events.length) {
          if (!cur.loop) break;
          tr.i = 0;
        }
        const ev = tr.events[tr.i++];
        this.playEvent(tr, ev, tr.time, cur.stepDur, this.musicBus);
        tr.time += ev.steps * cur.stepDur;
      }
    }
  }

  // ---------- 音效 ----------
  sfx(name) {
    const t = this.ctx.currentTime + 0.01;
    const b = this.sfxBus;
    const seq = (notes, inst = 'lead50', step = 0.06, vol = 1) =>
      notes.forEach((n, i) => n && this.tone(noteFreq(n), t + i * step, step * 0.9, inst, b, vol));
    const slide = (from, to, dur, type = 'square', gain = 0.1) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(b);
      o.start(t);
      o.stop(t + dur + 0.02);
    };
    switch (name) {
      case 'click': seq(['E6'], 'soft', 0.04, 2); break;
      case 'open': seq(['C6', 'G6'], 'soft', 0.05, 2); break;
      case 'close': seq(['G6', 'C6'], 'soft', 0.05, 2); break;
      case 'heart': seq(['E6', 'A6'], 'bell', 0.07, 0.6); break;
      case 'happy': seq(['C6', 'E6', 'G6', 'C7'], 'bell', 0.06, 0.6); break;
      case 'rustle':
        for (let i = 0; i < 4; i++) this.noiseHit(t + i * 0.07, { dur: 0.07, type: 'bandpass', freq: 3000 + i * 400, gain: 0.08, q: 2 });
        break;
      case 'pop': slide(300, 900, 0.09, 'square', 0.08); seq([null, null, 'A6'], 'lead50', 0.05); break;
      case 'appear': seq(['A5', null, 'A5', 'E6'], 'lead50', 0.07); break;
      case 'throw': this.noiseHit(t, { dur: 0.35, type: 'bandpass', freq: 800, sweepTo: 5000, gain: 0.15, q: 1.5 }); break;
      case 'hit': this.noiseHit(t, { dur: 0.12, type: 'lowpass', freq: 1200, gain: 0.3 }); slide(600, 150, 0.12, 'square', 0.08); break;
      case 'shake': this.noiseHit(t, { dur: 0.05, type: 'bandpass', freq: 2500, gain: 0.25, q: 3 }); slide(260, 200, 0.06, 'square', 0.06); break;
      case 'lock': this.noiseHit(t, { dur: 0.04, type: 'highpass', freq: 4000, gain: 0.3 }); seq(['C7'], 'lead50', 0.05); break;
      case 'breakout': slide(900, 180, 0.3, 'square', 0.1); this.noiseHit(t, { dur: 0.25, type: 'highpass', freq: 3000, gain: 0.15 }); break;
      case 'eat':
        for (let i = 0; i < 3; i++) this.noiseHit(t + i * 0.11, { dur: 0.06, type: 'lowpass', freq: 1800 - i * 300, gain: 0.35 });
        break;
      case 'refuse': seq(['C4', null, 'C4'], 'lead50', 0.07, 1.2); break;
      case 'sparkle': seq(['E7', 'B6', 'G#6', 'E7'], 'soft', 0.045, 2.5); break;
      case 'flee': slide(1200, 300, 0.4, 'triangle', 0.18); break;
      case 'collect': seq(['B6', 'E7'], 'lead50', 0.07); break;
      case 'grab': slide(400, 700, 0.06, 'triangle', 0.15); break;
      case 'land': this.noiseHit(t, { dur: 0.08, type: 'lowpass', freq: 500, gain: 0.3 }); break;
      case 'flash': this.noiseHit(t, { dur: 0.8, type: 'highpass', freq: 800, sweepTo: 8000, gain: 0.12 }); break;
      default: break;
    }
  }
}
