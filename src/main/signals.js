// 電腦狀態 → 遊戲裡的「氣息」。只讀取閒置時間、電源、CPU 負載，不讀鍵盤、視窗或任何內容。
import { powerMonitor } from 'electron';
import os from 'node:os';

export function createSignals(onChange) {
  let lastCpu = os.cpus();
  const cpuSamples = [];
  let pluggedAt = 0;
  let wasIdle = false;
  let returnedAt = 0;

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
    };
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

  return {
    snapshot,
    dispose() { clearInterval(cpuTimer); clearInterval(idleTimer); clearInterval(emitTimer); },
  };
}
