// 牠們感受得到你的世界：全螢幕、下雨、你不在、日落。純邏輯：時間、亂數、視窗矩形都由呼叫的人給。
// 只看視窗的位置和大小（src/main/windows.js），不看標題或內容。
import { isSunset } from './sun.js';

export const AWAY_PLAY = 10 * 60; // 閒置幾秒以後，牠們開始自己玩（規格：≥ 10 分鐘）
export const NOTICE_MIN = 0.5, NOTICE_MAX = 4; // 你回來時，每隻過幾秒才發現（秒）
const EDGE_SLACK = 2; // 視窗邊緣容許差幾個 DIP（DWM 的邊框、縮放的取整）

// ---------- 全螢幕（F12） ----------
// 視窗蓋住整個螢幕（bounds，含工作列）才算全螢幕；最大化只蓋住工作區（workArea），不算。
// rect、bounds 都是同一個座標系（DIP）
export function coversScreen(rect, bounds) {
  if (!rect || !bounds) return false;
  return rect.x <= bounds.x + EDGE_SLACK && rect.y <= bounds.y + EDGE_SLACK
    && rect.x + rect.w >= bounds.x + bounds.width - EDGE_SLACK && rect.y + rect.h >= bounds.y + bounds.height - EDGE_SLACK;
}

// 現在是不是有視窗全螢幕（看影片、簡報）：最上層的那個、或是前景的那個蓋住整個螢幕
// list：[{ x, y, w, h, fg }]，由上到下；在 macOS／Linux 上是空陣列（F13：那裡不啟動）
export function fullscreenNow(list, bounds) {
  if (!Array.isArray(list) || !list.length || !bounds) return false;
  const fg = list.find(w => w.fg);
  return coversScreen(list[0], bounds) || coversScreen(fg, bounds);
}

// 全螢幕的時候你在看螢幕，不是在休息（PR-D 的 F2）：這段時間的閒置不算離開
export function breakSignals({ idleSeconds = 0, longestIdle = 0, watching = false } = {}) {
  return watching ? { idleSeconds: 0, longestIdle: 0 } : { idleSeconds, longestIdle };
}

// ---------- 下雨 ----------
export const isRainy = weather => weather === 'rain' || weather === 'thunder';

// ---------- 你不在 ----------
export const isAway = idleSeconds => (Number(idleSeconds) || 0) >= AWAY_PLAY;

// 你回來了：每隻過一陣子才發現（F14：不要同一個畫面一起轉頭），只有最親近的那一隻跑過來。
// mons：[{ uid, affection }]；回傳 [{ uid, delay（秒）, run }]
export function noticeOrder(mons, rng) {
  const best = [...mons].sort((a, b) => b.affection - a.affection || (a.uid < b.uid ? -1 : 1))[0];
  return mons.map(m => ({ uid: m.uid, delay: NOTICE_MIN + rng() * (NOTICE_MAX - NOTICE_MIN), run: m === best }));
}

// ---------- 日落 ----------
// 一天一次：設定了城市、現在是日落前後 10 分鐘、今天還沒看過。lastDay＝上一次看日落的日期（YYYY-MM-DD，當地）
export function sunsetDue(place, now, lastDay) {
  if (!place || !isSunset(place, now)) return false;
  return localDay(now) !== lastDay;
}
export const localDay = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
