// 電腦狀態 → 遊戲裡的「氣息」。只讀取閒置時間、電源、CPU 負載，不讀鍵盤、視窗內容或任何輸入的內容。
//
// 「好像在打字」的判斷不讀鍵盤：系統閒置時間 < 1 秒（有人在操作電腦），
// 但游標 2 秒內都沒動（main.js 本來就在追蹤游標）→ 很可能是在打字。不準也沒關係。
import { powerMonitor } from 'electron';
import os from 'node:os';

const TYPING_CURSOR_STILL = 2000; // 游標幾毫秒沒動
const TYPING_GAP = 3000; // 中間停下來不超過 3 秒都算連續

export function createSignals(onChange, { lastCursorMove = () => 0 } = {}) {
  let lastCpu = os.cpus();
  const cpuSamples = [];
  let pluggedAt = 0;
  let wasIdle = false;
  let returnedAt = 0;
  let typingSince = 0; // 這一段連續打字從什麼時候開始（0＝沒在打字）
  let typingLast = 0;
  let activeSince = 0; // 連續在操作電腦

  powerMonitor.on('on-ac', () => { pluggedAt = Date.now(); emit(); });
  powerMonitor.on('on-battery', () => emit());

  function sampleCpu() {
    const now = os.cpus();
    let idle = 0, total = 0;
    now.forEach((c, i) => {
      const prev = lastCpu[i]?.times ?? c.times;
      const d = k => c.times[k] - prev[k];
      const t = d('user') + d('nice') + d('sys') + d('idle') + d('irq');
      idle += d('idle');
      total += t;
    });
    lastCpu = now;
    if (total > 0) cpuSamples.push(1 - idle / total);
    if (cpuSamples.length > 6) cpuSamples.shift(); // 約最近一分鐘
  }

  function snapshot() {
    const idleSeconds = powerMonitor.getSystemIdleTime();
    if (idleSeconds >= 10 * 60) wasIdle = true;
    else if (wasIdle && idleSeconds < 5) { wasIdle = false; returnedAt = Date.now(); }
    const cpu = cpuSamples.length ? cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length : 0;
    return {
      idleSeconds,
      cpu,
      cpuHot: cpu > 0.5,
      onBattery: powerMonitor.isOnBatteryPower?.() ?? false,
      justPluggedIn: Date.now() - pluggedAt < 20 * 60 * 1000,
      returnedFromIdle: Date.now() - returnedAt < 3 * 60 * 1000,
      returnedAt,
      // 只有布林值和秒數
      inputActive: idleSeconds < 1,
      typing: typingSince > 0 && Date.now() - typingLast < TYPING_GAP,
      typingSeconds: typingSince > 0 && Date.now() - typingLast < TYPING_GAP ? Math.round((typingLast - typingSince) / 1000) : 0,
      activeSeconds: activeSince ? Math.round((Date.now() - activeSince) / 1000) : 0,
    };
  }

  // 每秒更新一次「在操作電腦」「好像在打字」
  function sampleInput() {
    const now = Date.now();
    const active = powerMonitor.getSystemIdleTime() < 1;
    if (active) activeSince ||= now;
    else if (powerMonitor.getSystemIdleTime() > 30) activeSince = 0;
    const wasTyping = typingSince > 0 && now - typingLast < TYPING_GAP;
    if (active && now - lastCursorMove() > TYPING_CURSOR_STILL) {
      if (!wasTyping) typingSince = now;
      typingLast = now;
    }
    const isTyping = typingSince > 0 && now - typingLast < TYPING_GAP;
    if (isTyping !== wasTyping) emit();
    else if (isTyping && Math.round((typingLast - typingSince) / 1000) % 10 === 0) emit(); // 打字中每 10 秒更新一次秒數
  }

  function emit() { onChange(snapshot()); }

  const cpuTimer = setInterval(sampleCpu, 10_000);
  // 閒置狀態要快一點偵測，使用者回來時寶可夢才能馬上打招呼
  const idleTimer = setInterval(() => {
    const before = returnedAt;
    const s = snapshot();
    if (s.returnedAt !== before) onChange(s);
  }, 2000);
  const emitTimer = setInterval(emit, 20_000);
  const inputTimer = setInterval(sampleInput, 1000);

  return {
    snapshot,
    dispose() { clearInterval(cpuTimer); clearInterval(idleTimer); clearInterval(emitTimer); clearInterval(inputTimer); },
  };
}
