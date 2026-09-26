// 全息投影通訊器：故事裡的人打來時，左下角出現藍色的投影（廣播則在桌面正中間，周圍變暗）。
// 一句一句打字出來；點一下：這句還沒打完就直接顯示完，打完了就下一句。最後可能有選項。
import { CAST } from '../../core/story.js';

const CPS = 36; // 每秒幾個字

export class HoloCaster {
  constructor({ root, portraits, audio }) {
    Object.assign(this, { portraits, audio });
    this.dim = document.createElement('div');
    this.dim.className = 'holo-dim';
    this.el = document.createElement('div');
    this.el.className = 'holo hit hidden';
    this.el.innerHTML = '<div class="portrait"><canvas></canvas></div><div class="talk"><div class="name"></div><p class="line"></p><div class="choices"></div><div class="hint">點一下繼續</div></div>';
    this.el.addEventListener('click', e => this.onClick(e));
    root.append(this.dim, this.el);
    this.playing = null;
  }

  get busy() { return Boolean(this.playing); }

  // 放一段對話；回傳 Promise<{ choice }>。onLine(who)：換人說話時（讓寶可夢轉頭看）
  play(ev, { onLine } = {}) {
    if (this.playing) return Promise.resolve({ choice: null, skipped: true });
    const script = [...(ev.lines ?? [])];
    return new Promise(resolve => {
      this.playing = { ev, script, i: -1, choice: null, resolve, onLine, typing: null };
      this.el.classList.toggle('broadcast', ev.kind === 'broadcast');
      this.dim.classList.toggle('on', ev.kind === 'broadcast');
      this.el.classList.remove('hidden');
      this.audio?.sfx('open');
      this.next();
    });
  }

  next() {
    const p = this.playing;
    p.i++;
    if (p.i >= p.script.length) {
      // 台詞說完：有問題就問，問過了就接回答和後面的台詞
      if (p.ev.choice && p.choice === null && !p.asked) { p.asked = true; this.ask(p.ev.choice); return; }
      this.finish();
      return;
    }
    const [who, text] = p.script[p.i];
    this.show(who, text);
  }

  show(who, text, { withChoices = false } = {}) {
    const p = this.playing;
    if (p.who !== who) { p.who = who; this.setSpeaker(who); p.onLine?.(who); }
    const line = this.el.querySelector('.line');
    this.el.querySelector('.choices').replaceChildren();
    this.el.querySelector('.hint').hidden = withChoices;
    line.textContent = '';
    p.full = text;
    p.shown = 0;
    clearInterval(p.typing);
    p.typing = setInterval(() => {
      p.shown = Math.min(text.length, p.shown + 1);
      line.textContent = text.slice(0, p.shown);
      if (p.shown >= text.length) { clearInterval(p.typing); p.typing = null; }
    }, 1000 / CPS);
  }

  ask(choice) {
    const p = this.playing;
    this.show(choice.ask[0], choice.ask[1], { withChoices: true });
    const box = this.el.querySelector('.choices');
    for (const o of choice.options) {
      const b = document.createElement('button');
      b.dataset.choice = o.value;
      b.textContent = o.text;
      box.append(b);
    }
    p.waitingChoice = true;
  }

  choose(value) {
    const p = this.playing;
    const o = p.ev.choice.options.find(x => x.value === value);
    if (!o) return;
    p.choice = value;
    p.waitingChoice = false;
    this.audio?.sfx('click');
    // 回答＋後面的台詞接在後面
    p.script.push([p.ev.choice.ask[0], o.reply], ...(p.ev.after ?? []));
    this.next();
  }

  // 點一下：還在打字就直接顯示完，打完了就下一句
  onClick(e) {
    const p = this.playing;
    if (!p) return;
    const b = e.target.closest('[data-choice]');
    if (b) { this.choose(b.dataset.choice); return; }
    if (p.waitingChoice) { this.completeLine(); return; }
    if (p.typing) { this.completeLine(); return; }
    this.audio?.sfx('click');
    this.next();
  }

  completeLine() {
    const p = this.playing;
    clearInterval(p.typing);
    p.typing = null;
    this.el.querySelector('.line').textContent = p.full;
  }

  finish() {
    const p = this.playing;
    clearInterval(p.typing);
    this.playing = null;
    this.el.classList.add('hidden');
    this.dim.classList.remove('on');
    this.audio?.sfx('close');
    p.resolve({ choice: p.choice });
  }

  setSpeaker(who) {
    const cast = CAST[who] ?? { zh: who, color: '#8ac8ff' };
    this.el.querySelector('.name').textContent = cast.zh;
    this.el.style.setProperty('--who', cast.color);
    const draw = img => {
      if (this.playing?.who !== who) return;
      const cv = this.el.querySelector('.portrait canvas');
      const k = Math.max(1, Math.min(3, Math.floor(120 / img.height)));
      cv.width = img.width; cv.height = img.height;
      cv.style.width = `${img.width * k}px`; cv.style.height = `${img.height * k}px`;
      const g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      g.drawImage(img, 0, 0);
    };
    draw(this.portraits.peek(who));
    this.portraits.get(who).then(e => draw(e.canvas));
  }
}
