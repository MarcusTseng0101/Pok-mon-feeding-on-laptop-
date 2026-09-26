// 雲端資料夾同步（畫面這一側）：選資料夾、每 5 分鐘同步一次、結束時再寫一次。合併規則在 core/sync.js。
//
// 順序很重要：先把別台電腦的檔案讀進來（要等），讀完之後「同一瞬間」用現在的存檔算出合併結果並套用，
// 中間不能有 await——不然讀檔的那一小段時間裡玩家餵的泡芙、抓的寶可夢會被蓋掉。
import { migrate } from '../core/save.js';
import { startSync, joinSync, syncStep, DEVICE_RE } from '../core/sync.js';

export const SYNC_INTERVAL = 5 * 60 * 1000;

const newDeviceId = () => Array.from({ length: 12 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

export class SyncController {
  constructor({ game, api, dex, director, ui }) {
    Object.assign(this, { game, api, dex, director, ui });
    this.busy = false;
    this.lastAt = 0;
    this.status = null; // { ok, at, msg }
  }

  get enabled() { return Boolean(this.game.state.sync); }

  // 讀其他電腦的檔案，只留下檔名和內容對得起來的
  async remotes(folder, selfId) {
    const files = await this.api.listSyncFiles?.(folder, selfId);
    if (!Array.isArray(files)) throw new Error(files?.error ?? '讀不到同步資料夾');
    return files
      .filter(f => DEVICE_RE.test(f.deviceId) && f.data?.sync?.deviceId === f.deviceId)
      .map(f => migrate(f.data, this.dex, Date.now()));
  }

  // 第一次設定：選資料夾。資料夾裡已經有別台電腦的存檔時問要怎麼做
  async setup() {
    const folder = await this.api.pickSyncFolder?.();
    if (!folder) return false;
    const deviceId = newDeviceId();
    let others;
    try { others = await this.remotes(folder, deviceId); } catch (err) { this.ui.toast(`沒辦法使用這個資料夾：${err.message}`); return false; }
    if (!others.length) {
      startSync(this.game.state, { folder, deviceId });
      this.game.emit('settings', { key: 'sync' });
      await this.run(true);
      this.ui.toast('開始同步了！在另一台電腦選同一個資料夾，兩邊的進度就會合在一起');
      return true;
    }
    const newest = others.sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))[0];
    const mode = await this.ui.ask(`這個資料夾裡已經有其他電腦的存檔（${newest.mons.length} 隻夥伴、圖鑑 ${Object.values(newest.dex).filter(d => d.caught).length} 種）。要怎麼做？`, [
      { value: 'adopt', label: '用資料夾裡的存檔', hint: '這台電腦原本的進度不要了（適合新裝的電腦）' },
      { value: 'merge', label: '兩份合在一起', hint: '兩邊的夥伴、圖鑑都保留，背包的東西相加' },
      { value: null, label: '取消' },
    ]);
    if (!mode) return false;
    this.apply(joinSync(this.game.state, newest, { folder, deviceId, mode }));
    await this.run(true);
    this.ui.toast(mode === 'adopt' ? '已經換成資料夾裡的存檔了' : '兩份存檔合在一起了！');
    return true;
  }

  // 同步一次（force：不管多久前才同步過）
  async run(force = false) {
    if (!this.enabled || this.busy) return;
    if (!force && Date.now() - this.lastAt < SYNC_INTERVAL) return;
    this.busy = true;
    this.lastAt = Date.now();
    try {
      const { folder, deviceId } = this.game.state.sync;
      const others = await this.remotes(folder, deviceId);
      if (!this.enabled || this.game.state.sync.deviceId !== deviceId) return; // 讀檔的時候被停止了
      this.apply(syncStep(this.game.state, others)); // ← 這一行之前不能有 await 之後才讀的存檔
      const w = await this.api.writeSyncFile(folder, deviceId, this.game.state);
      if (w !== true) throw new Error(w?.error ?? '寫不進同步資料夾');
      this.status = { ok: true, at: Date.now(), msg: others.length ? `和 ${others.length} 台電腦同步了` : '還沒有其他電腦' };
    } catch (err) {
      this.status = { ok: false, at: Date.now(), msg: err.message };
    } finally {
      this.busy = false;
      this.ui.refreshSoon();
    }
  }

  // 換成合併後的存檔：桌面上的寶可夢改指到新的資料，多出來的叫出來
  apply(next) {
    this.game.state = next;
    this.director.rebindPets();
    this.game.emit('party', {});
    this.game.emit('bag');
  }

  stop() {
    this.game.state.sync = null;
    this.status = null;
    this.game.emit('settings', { key: 'sync' });
    this.ui.toast('停止同步了（資料夾裡的檔案還在，這台電腦之後不會再讀寫它）');
  }
}
