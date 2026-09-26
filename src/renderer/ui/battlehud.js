// 故事對戰的面板（畫面下方中間）：兩邊的名字和血量、現在發生什麼事、選招式／選夥伴。
// 對戰本身在 scene/battle.js；這裡只有 DOM。
import * as art from '../gfx/art.js';

const TYPE_ZH = {
  normal: '一般', fire: '火', water: '水', grass: '草', electric: '電', ice: '冰', fighting: '格鬥', poison: '毒', ground: '地面',
  flying: '飛行', psychic: '超能力', bug: '蟲', rock: '岩石', ghost: '幽靈', dragon: '龍', dark: '惡', steel: '鋼', fairy: '妖精',
};

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class BattleHud {
  // thumb(speciesId, opts)：寶可夢小圖（ui.thumb）
  constructor({ root, audio, thumb }) {
    Object.assign(this, { audio, thumb });
    this.el = document.createElement('div');
    this.el.className = 'battle-hud hit pix hidden';
    this.el.innerHTML = `<div class="title"></div>
      <div class="sides"><div class="side you"></div><div class="side foe"></div></div>
      <p class="msg"></p><div class="choices"></div>`;
    this.el.addEventListener('click', e => this.onClick(e));
    root.append(this.el);
  }

  open(battle) {
    this.battle = battle;
    this.el.querySelector('.title').textContent = battle.ev.title;
    this.el.querySelector('.side.you').replaceChildren();
    this.el.querySelector('.side.foe').replaceChildren();
    this.el.classList.remove('hidden');
  }

  close() {
    this.el.classList.add('hidden');
    this.battle = null;
  }

  // 面板上緣（CSS 像素）：對戰的寶可夢站在這上面
  top() {
    const r = this.el.getBoundingClientRect();
    return r.height ? r.top : innerHeight - 234;
  }

  say(text) { this.el.querySelector('.msg').textContent = text; }

  // side：'you'／'foe'；count：還有幾隻（顯示成小球）
  setSide(side, { name, hp, max, species, count }) {
    const box = this.el.querySelector(`.side.${side}`);
    box.innerHTML = `<div class="who"><span class="pic"></span><b></b><span class="left"></span></div><div class="bar"><i></i></div><small class="num"></small>`;
    box.querySelector('b').textContent = name;
    box.querySelector('.pic').append(this.thumb(species, { size: 28 }));
    box.querySelector('.left').textContent = count > 1 ? '●'.repeat(Math.min(6, count)) : '';
    box.dataset.max = max;
    this.setHp(side, hp, { instant: true });
  }

  setHp(side, hp, { instant = false } = {}) {
    const box = this.el.querySelector(`.side.${side}`);
    const max = Number(box.dataset.max) || 100, k = Math.max(0, hp) / max;
    const bar = box.querySelector('.bar i');
    if (!bar) return;
    bar.style.transition = instant ? 'none' : '';
    bar.style.width = `${Math.round(k * 100)}%`;
    bar.className = k > 0.5 ? 'ok' : k > 0.2 ? 'mid' : 'low';
    box.querySelector('.num').textContent = side === 'you' ? `${Math.max(0, Math.round(hp))} / ${max}` : '';
  }

  // 選招式；list 是 null 就收起來
  moves(list, { canSwitch = false } = {}) {
    const box = this.el.querySelector('.choices');
    if (!list) { box.replaceChildren(); return; }
    box.innerHTML = `<div class="moves">${list.map(m => `<button data-move="${esc(m.id)}" style="--t:${art.TYPE_COLORS[m.type] ?? '#a8a878'}"><b>${esc(m.zh)}</b><small>${esc(TYPE_ZH[m.type] ?? '')}${m.hint.zh ? `・<span class="${m.hint.cls}">${esc(m.hint.zh)}</span>` : ''}</small></button>`).join('')}</div>
      <div class="extra">${canSwitch ? '<button data-switch>換夥伴</button>' : ''}<button data-giveup>認輸</button></div>`;
  }

  // 選要上場的夥伴
  pick(pets, msg, { canCancel = false } = {}) {
    this.say(msg);
    const box = this.el.querySelector('.choices');
    box.innerHTML = `<div class="pets"></div><div class="extra">${canCancel ? '<button data-cancel>不換了</button>' : ''}<button data-giveup>認輸</button></div>`;
    const list = box.querySelector('.pets');
    for (const p of pets) {
      const f = this.battle?.mine.get(p.uid);
      const b = document.createElement('button');
      b.dataset.pet = p.uid;
      b.append(this.thumb(p.mon.species, { size: 32, shiny: p.mon.shiny, form: p.mon.form }));
      const t = document.createElement('span');
      t.textContent = `${this.battle.game.displayName(p.mon)}${f ? `（${f.hp}）` : ''}`;
      b.append(t);
      list.append(b);
    }
  }

  onClick(e) {
    const b = e.target.closest('button');
    const bt = this.battle;
    if (!b || b.disabled || !bt) return;
    this.audio?.sfx('click');
    if (b.dataset.move) bt.choose(b.dataset.move);
    else if (b.dataset.pet) { const p = bt.st.pets.get(b.dataset.pet); if (p) bt.sendOut(p, { swap: bt.phase === 'pick' && Boolean(bt.cur) }); }
    else if ('switch' in b.dataset) bt.askPartner('要換誰上場？');
    else if ('cancel' in b.dataset) bt.yourTurn();
    else if ('giveup' in b.dataset) bt.giveUp();
  }
}
