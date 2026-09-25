// 小遊戲的外殼：打開、每一幀更新、結束、關閉。
//
// 最重要的一件事：不管怎麼結束（按 Esc、按 ✕、遊戲時間到、按「關閉」、中途開勿擾模式、
// 夥伴被收回球裡），都只走 closeMinigame() 這一條路，由它負責把滑鼠還給桌面。
// 否則透明視窗會一直攔截點擊，使用者的電腦會變成點不動、又看不出原因。
//
// 兩種小遊戲：
// - desktop：在桌面上玩（摘樹果、頭球）。玩的時候 stage.mode = { type: 'minigame' }，整個畫面都接收滑鼠。
// - panel：在一個視窗裡玩（做泡芙、拼圖、特訓）。只有視窗範圍接收滑鼠（跟其他介面一樣）。
import { GAMES } from './games.js';

const h = html => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

export class MinigameHost {
  constructor(ui) {
    this.ui = ui;
    this.active = null;
    this.el = h(`<section class="minigame hit pix hidden"><header><span class="title"></span><span class="status"></span><button class="close" title="結束（Esc）">✕</button></header><div class="body"></div></section>`);
    this.el.querySelector('.close').onclick = () => this.closeMinigame('close');
    ui.root.append(this.el);
  }

  get stage() { return this.ui.stage; }
  get game() { return this.ui.game; }
  get director() { return this.ui.director; }
  get body() { return this.el.querySelector('.body'); }

  // 每次開新遊戲、關掉遊戲都換一個全新的 body：遊戲會在 body 上掛 onclick，
  // 不換掉的話，上一個遊戲的事件會在下一個遊戲裡被觸發（拼圖點一下變成做泡芙的畫面）
  freshBody() {
    const b = document.createElement('div');
    b.className = 'body';
    this.body.replaceWith(b);
    return b;
  }

  // 可以玩嗎？回傳 null 表示可以，否則回傳原因
  blocked(name, uid) {
    const def = GAMES[name];
    if (!def) return '沒有這個小遊戲';
    if (def.needsPet && !this.game.mon(uid)) return '先選一隻夥伴';
    if (def.desktop && !this.stage.pets.has(uid)) return '這個遊戲要在桌面上玩，先把牠叫出來吧';
    if (this.director.enc || this.director.evolution) return '現在正忙著呢';
    return def.blocked?.(this.game, uid) ?? null;
  }

  open(name, uid) {
    const why = this.blocked(name, uid);
    if (why) { this.ui.toast(why); return false; }
    this.closeMinigame('switch');
    this.ui.closeAll();
    const def = GAMES[name];
    const pet = this.stage.pets.get(uid) ?? null;
    this.active = { name, def, uid, pet, t: 0, done: false };
    this.el.className = `minigame hit pix ${def.desktop ? 'bar' : 'panel'} ${name}`;
    this.el.querySelector('.title').textContent = def.title;
    this.setStatus('');
    this.freshBody();
    if (def.desktop) this.director.setMode({ type: 'minigame', host: this });
    this.stage.minigame = this;
    this.active.ctl = def.start(this);
    this.ui.api.focus?.(); // 讓 Esc 收得到
    this.ui.audio.sfx('open');
    return true;
  }

  setStatus(text) { this.el.querySelector('.status').textContent = text; }

  // ---------- 舞台呼叫 ----------
  update(dt) {
    const a = this.active;
    if (!a || a.done) return;
    // 夥伴被收回去、被抓起來丟走、開了勿擾模式…遊戲就結束
    if (a.def.desktop && (!this.stage.pets.has(a.uid) || this.game.state.settings.quiet)) { this.closeMinigame('pet-gone'); return; }
    a.t += dt;
    a.ctl.update?.(dt);
  }
  draw(ctx) { if (this.active && !this.active.done) this.active.ctl.draw?.(ctx); }
  click(x, y) { if (this.active && !this.active.done) this.active.ctl.click?.(x, y); }

  // 遊戲結束：顯示結果。桌面上的遊戲在這時候就把滑鼠還回去（結果只在小視窗裡）
  finish({ lines = [], again = true } = {}) {
    const a = this.active;
    if (!a || a.done) return;
    a.done = true;
    a.ctl.destroy?.();
    if (this.stage.mode?.type === 'minigame') this.director.setMode(null);
    this.el.classList.remove('bar');
    this.el.classList.add('panel', 'result');
    this.setStatus('');
    this.freshBody().innerHTML = `<div class="result">${lines.map(l => `<p>${l}</p>`).join('')}
      <div class="btns">${again ? '<button data-again class="primary">再玩一次</button>' : ''}<button data-close>關閉</button></div></div>`;
    this.body.querySelector('[data-close]').onclick = () => this.closeMinigame('done');
    this.body.querySelector('[data-again]')?.addEventListener('click', () => this.open(a.name, a.uid));
    this.stage.refreshInteractive();
  }

  // 桌面遊戲的滑鼠模式被取消了（還在玩的話就結束遊戲）
  onModeLost() {
    if (this.active && !this.active.done) this.closeMinigame('mode');
  }

  // 唯一的結束路徑
  closeMinigame(reason = 'close') {
    const a = this.active;
    if (!a) return;
    this.active = null;
    if (!a.done) a.ctl?.destroy?.();
    this.stage.minigame = null;
    if (this.stage.mode?.type === 'minigame') this.director.setMode(null);
    if (a.pet && this.stage.pets.has(a.uid) && ['minigame', 'look'].includes(a.pet.state)) a.pet.set('idle', 1);
    this.el.className = 'minigame hit pix hidden';
    this.freshBody();
    this.stage.refreshInteractive(); // 馬上重新判斷要不要接收滑鼠（通常是不要）
    if (reason !== 'switch') this.ui.audio.sfx('close');
  }
}
