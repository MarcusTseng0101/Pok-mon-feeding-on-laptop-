// 桌面上其他視窗的位置（給「站在視窗上」用）。
// 只讀視窗的矩形位置與前後順序，不讀標題、程式名稱或任何內容。
//
// Windows：開一個常駐的 PowerShell，用 Add-Type 編譯一小段 C# 呼叫 Win32／DWM。
// 每次查詢從 stdin 送一行、從 stdout 讀一行 JSON；不要每次查詢都重開 PowerShell，
// 光啟動加編譯就要好幾百毫秒。其他平台先回傳空陣列（還沒實作）。
//
// 這個檔案不 import electron：座標換算（實體像素 → DIP）由呼叫的人用 toDip 傳進來，
// 這樣才能用 node --test 測，也能用 scripts/probe-windows.mjs 單獨在 Windows 上量速度。
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const MIN_SIZE = 120; // DIP：比這小的視窗不算（幽靈視窗、小工具列）
const TIMEOUT_MS = 2000;

// C# 5（Windows PowerShell 5.1 的 Add-Type 用的編譯器）：不能用 $"..."、out var
const CSHARP = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class KalosWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
  const int GWL_EXSTYLE = -20, WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;

  // 由上到下（z-order）列出看得到的頂層視窗：[[hwnd, x, y, w, h, 前景?], ...]，實體像素
  public static string Snap(long exclude) {
    StringBuilder sb = new StringBuilder("[");
    IntPtr fg = GetForegroundWindow();
    bool first = true;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if ((long)h == exclude || !IsWindowVisible(h) || IsIconic(h)) return true;
      int ex = GetWindowLong(h, GWL_EXSTYLE);
      if ((ex & WS_EX_TOOLWINDOW) != 0 || (ex & WS_EX_TRANSPARENT) != 0) return true; // 工具視窗、會穿透滑鼠的覆蓋層
      int cloaked;
      if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true; // 隱形的 UWP 視窗
      // 系統的桌面與工作列（只拿來排除，不會回傳）
      StringBuilder cls = new StringBuilder(32);
      GetClassName(h, cls, 32);
      string c = cls.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return true;
      // EXTENDED_FRAME_BOUNDS 不含 Win10/11 那圈約 7px 的隱形邊框；GetWindowRect 會包含
      RECT r;
      if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, 16) != 0) return true;
      if (r.R - r.L < 40 || r.B - r.T < 40) return true;
      if (!first) sb.Append(',');
      first = false;
      sb.Append('[').Append((long)h).Append(',').Append(r.L).Append(',').Append(r.T).Append(',')
        .Append(r.R - r.L).Append(',').Append(r.B - r.T).Append(',').Append(h == fg ? 1 : 0).Append(']');
      return true;
    }, IntPtr.Zero);
    return sb.Append(']').ToString();
  }
}
`;

// 每一行指令：數字 = 查詢（排除這個 hwnd）；stat = 自己用了多少 CPU／記憶體；q = 結束
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${CSHARP}
'@
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($line -eq 'q') { break }
  if ($line -eq 'stat') {
    $p = [System.Diagnostics.Process]::GetCurrentProcess()
    [Console]::Out.WriteLine('{"cpuMs":' + [long]$p.TotalProcessorTime.TotalMilliseconds + ',"rss":' + $p.WorkingSet64 + '}')
  } else {
    [Console]::Out.WriteLine([KalosWin]::Snap([long]$line))
  }
  [Console]::Out.Flush()
}
`;

export function powershellArgs() {
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded];
}

// PowerShell 回傳的原始陣列 → [{ hwnd, x, y, w, h, fg }]（DIP），順序維持由上到下
export function parseRects(line, toDip = r => r) {
  const raw = JSON.parse(line);
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 6 || !item.slice(1, 5).every(Number.isFinite)) continue;
    const [hwnd, x, y, w, h, fg] = item;
    const r = toDip({ x, y, width: w, height: h });
    if (r.width < MIN_SIZE || r.height < MIN_SIZE) continue;
    out.push({ hwnd: String(hwnd), x: r.x, y: r.y, w: r.width, h: r.height, fg: fg === 1 });
  }
  return out;
}

export function createWindowProbe({
  exclude = 0,
  toDip = r => r,
  platform = process.platform,
  command = 'powershell.exe',
  args = powershellArgs(),
  spawnImpl = spawn,
  maxRestarts = 3,
  log = (...a) => console.warn('[windows]', ...a),
} = {}) {
  const supported = platform === 'win32';
  let child = null;
  let ready = null;
  let restarts = 0;
  let disabled = !supported;
  let pending = null; // { resolve, reject, timer }
  let inflight = null;
  let lastError = null;

  function start() {
    child = spawnImpl(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const proc = child;
    let stderr = '';
    proc.stderr.on('data', d => { stderr = (stderr + d).slice(-2000); });
    ready = new Promise((resolve, reject) => {
      const lines = createInterface({ input: proc.stdout });
      let isReady = false;
      lines.on('line', line => {
        if (!isReady) {
          if (line.trim() === 'ready') { isReady = true; resolve(); }
          return;
        }
        const p = pending;
        pending = null;
        if (p) { clearTimeout(p.timer); p.resolve(line); }
      });
      proc.on('error', err => reject(err));
      proc.on('exit', code => {
        if (child === proc) child = null;
        const err = new Error(`視窗偵測程序結束（code ${code}）${stderr ? `：${stderr.trim().split('\n').pop()}` : ''}`);
        reject(err);
        if (pending) { clearTimeout(pending.timer); pending.reject(err); pending = null; }
      });
    });
    ready.catch(() => {}); // 由 request() 處理
  }

  function request(line) {
    return new Promise((resolve, reject) => {
      pending = {
        resolve,
        reject,
        timer: setTimeout(() => { pending = null; reject(new Error('視窗偵測逾時')); }, TIMEOUT_MS),
      };
      child.stdin.write(`${line}\n`);
    });
  }

  async function ask(line) {
    if (disabled) return null;
    if (!child) {
      if (restarts > maxRestarts) return null;
      start();
    }
    try {
      await ready;
      return await request(line);
    } catch (err) {
      restarts++;
      lastError = err.message;
      log(err.message);
      try { child?.kill(); } catch { /* 已經結束 */ }
      child = null;
      if (restarts > maxRestarts) {
        disabled = true;
        log(`重啟 ${maxRestarts} 次都失敗，停用視窗偵測`);
      }
      return null;
    }
  }

  return {
    supported,
    get disabled() { return disabled; },
    get lastError() { return lastError; },
    // 看得到的視窗，由上到下；還在查詢中就共用同一個結果
    snapshot() {
      if (disabled) return Promise.resolve([]);
      inflight ??= ask(String(Number(exclude) || 0))
        .then(line => (line ? parseRects(line, toDip) : []))
        .catch(() => [])
        .finally(() => { inflight = null; });
      return inflight;
    },
    // 偵測程序自己用了多少 CPU（毫秒）與記憶體；給測速腳本用
    async stats() {
      await inflight;
      const line = await ask('stat');
      return line ? JSON.parse(line) : null;
    },
    dispose() {
      disabled = true;
      if (!child) return;
      try { child.stdin.write('q\n'); } catch { /* 已經關了 */ }
      const c = child;
      child = null;
      setTimeout(() => { try { c.kill(); } catch { /* 已經結束 */ } }, 500).unref?.();
    },
  };
}
