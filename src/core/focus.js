// 專注番茄鐘：專注 N 分鐘，寶可夢在旁邊安靜陪你，完成了有獎勵。中途放棄沒有懲罰，但也沒有獎勵。
//
// 計時一律用「現在時間 − 開始時間」，不用 setInterval 累加：
// 電腦睡眠、畫面被節流時，累加的方式會算錯（這個專案之前因為 setTimeout 出過兩次 bug）。

export const FOCUS_MIN = 15;
export const FOCUS_MAX = 60;
export const FOCUS_DEFAULT = 25;
export const FOCUS_AFFECTION = 5;

export const clampMinutes = m => Math.round(Math.max(FOCUS_MIN, Math.min(FOCUS_MAX, Number(m) || FOCUS_DEFAULT)));

export function remainingMs(active, now) {
  if (!active) return 0;
  return Math.max(0, active.startedAt + active.minutes * 60_000 - now);
}

// 連續專注的天數：今天已經算過就不變；昨天有專注就 +1；不然從 1 開始
export function nextStreak(focus, today, yesterday) {
  if (focus.lastDay === today) return focus.streakDays;
  if (focus.lastDay === yesterday) return focus.streakDays + 1;
  return 1;
}

// 獎勵的泡芙等級：連續天數越多越好（猜的，可調整）。豪華的每天只有第一次
export function rewardTier(streak, firstToday) {
  if (streak >= 7) return firstToday ? 'deluxe' : 'fancy';
  if (streak >= 3) return 'fancy';
  return 'frosted';
}
