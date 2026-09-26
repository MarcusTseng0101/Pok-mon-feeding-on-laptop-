// 介面（DOM）：右下角的選單按鈕、夥伴／圖鑑／背包／氣息／設定視窗、寶可夢旁的小對話框、遭遇列、提示訊息。
// 所有可以點的元素都要有 .hit，舞台才知道游標在介面上時要接收滑鼠。
import * as art from '../gfx/art.js';
import { makeCanvas } from '../gfx/pixel.js';
import { hearts, puffName, FLAVORS, TIER_ORDER, TIERS, FLAVOR_ZH, TASTE_ZH, puffKey, MAX, BERRY_ZH } from '../../core/amie.js';
import { BALLS, BALL_ORDER } from '../../core/capture.js';
import { activeModifiers, FLAVOR_TYPES, RATES } from '../../core/encounter.js';
import { requirement } from '../../core/evolution.js';
import { SPOTS } from '../../core/dex.js';
import { STARTERS, BOND_LEVELS, bondLevel, TRIM_DAYS } from '../../core/game.js';
import { shinyChance, chainRolls, BASE_ODDS, CHARM_AT } from '../../core/shiny.js';
import { MAX_OUT } from '../../core/save.js';
import { WEATHER_ZH } from '../../core/weather.js';
import { ACHIEVEMENTS, REWARD_FANCY_AT } from '../../core/achievements.js';
import { FORMS, spriteKey, formName, formsOf, defaultForm } from '../../core/forms.js';
import { habitNames } from '../scene/habits.js';
import { describe as describeMind } from '../scene/mindlink.js';
import { NEEDS, NEED_ZH, MOOD_ZH } from '../../core/mind.js';
import { PLACES, PLACE_IDS } from '../../core/trips.js';
import * as cards from '../gfx/postcards.js';
import { MOVES, movesetFor, useMove, practicePoint } from '../scene/moves.js';
import { transform as transformForm, revert as revertForm } from '../scene/battleforms.js';
import { MinigameHost } from './minigames/host.js';
import { GAMES, GAME_ORDER } from './minigames/games.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

// 把美術 canvas 放大成 DOM 用的小圖
function pixelImg(src, scale = 2, cls = '') {
  const c = makeCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  c.className = `px ${cls}`;
  c.style.width = `${src.width * scale}px`;
  c.style.height = `${src.height * scale}px`;
  return c;
}

export class UI {
  constructor({ root, game, dex, sprites, audio, stage, director, api, dev }) {
    Object.assign(this, { root, game, dex, sprites, audio, stage, director, api, dev });
    this.panel = null;
    this.selectedUid = null;
    this.selectedDex = null;
    this.bubblePet = null;
    this.build();
    this.minigames = new MinigameHost(this);
    stage.uiHit = (x, y) => this.hitTest(x, y);
    game.on('change', ({ event }) => {
      if (['tick', 'bag', 'party', 'caught', 'evolved', 'fed', 'heartsUp', 'dexSeen', 'cell', 'settings', 'focus', 'achievement'].includes(event)) this.refreshSoon();
    });
  }

  // ---------- 骨架 ----------
  build() {
    const r = this.root;
    this.launcher = h('<button class="launcher hit" title="Kalos Amie（選單）"></button>');
    this.launcher.append(pixelImg(art.balls.poke, 2));
    this.launcher.onclick = () => this.toggleMenu();
    this.menu = h(`<div class="menu hit pix hidden">
      <button data-open="party">夥伴</button><button data-open="dex">圖鑑</button>
      <button data-open="play">一起玩</button><button data-open="medals">獎章</button>
      <button data-open="bag">背包</button><button data-open="album">相簿</button><button data-open="aura">氣息</button>
      <button data-open="settings">設定</button><button data-act="quiet">勿擾模式</button>
      <button data-act="focus">開始專注</button>
    </div>`);
    this.menu.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      this.audio.sfx('click');
      if (b.dataset.open) this.open(b.dataset.open);
      if (b.dataset.act === 'quiet') this.toggleQuiet();
      if (b.dataset.act === 'focus') { if (this.game.state.focus.active) this.stopFocus(); else this.startFocus(); }
    };
    this.win = h(`<section class="window hit pix hidden"><header><span class="title"></span><button class="close" title="關閉">✕</button></header><div class="body"></div></section>`);
    this.win.querySelector('.close').onclick = () => this.closePanel();
    this.win.addEventListener('click', e => this.onPanelClick(e));
    this.win.addEventListener('change', e => this.onPanelChange(e));
    this.win.addEventListener('input', e => this.onPanelInput(e));
    this.bubble = h('<div class="bubble hit pix hidden"></div>');
    this.bubble.onclick = e => this.onBubbleClick(e);
    this.encBar = h('<div class="encounter hit pix hidden"></div>');
    this.encBar.onclick = e => this.onEncounterClick(e);
    this.picker = h('<div class="picker hit pix hidden"></div>');
    this.picker.onclick = e => this.onPickerClick(e);
    this.toasts = h('<div class="toasts"></div>');
    this.label = h('<div class="label hidden"></div>');
    this.modal = h('<div class="modal hidden"></div>');
    this.focusHud = h('<div class="focus-hud pix hidden"></div>');
    r.append(this.focusHud, this.label, this.bubble, this.encBar, this.picker, this.menu, this.win, this.launcher, this.toasts, this.modal);
    this.applySettings();
  }

  hitTest(x, y) {
    const el = document.elementFromPoint(x, y);
    return Boolean(el && el.closest('.hit') && !el.closest('.hidden'));
  }

  applySettings() {
    const s = this.game.state.settings;
    this.launcher.classList.toggle('hidden', !s.showLauncher);
    this.menu.querySelector('[data-act="quiet"]').textContent = s.quiet ? '叫出寶可夢' : '勿擾模式';
    this.menu.querySelector('[data-act="focus"]').textContent = this.game.state.focus.active ? '結束專注' : `開始專注（${s.focusMinutes} 分）`;
  }

  // ---------- 每一幀：跟著寶可夢移動的元素 ----------
  update() {
    const st = this.stage;
    this.updateFocusHud();
    const place = (el, devX, devY, { above = true } = {}) => {
      const p = st.toCss(devX, devY);
      const w = el.offsetWidth, hh = el.offsetHeight;
      const x = Math.max(8, Math.min(window.innerWidth - w - 8, p.x - w / 2));
      let y = above ? p.y - hh - 10 : p.y + 10;
      if (y < 8) y = p.y + 16;
      y = Math.min(window.innerHeight - hh - 8, y);
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    if (this.bubblePet) {
      if (!st.pets.has(this.bubblePet.uid) || this.bubblePet.state === 'held') this.closeBubble();
      else { const hd = this.bubblePet.head(); place(this.bubble, hd.x, hd.y); }
    }
    const pet = st.hoverPet;
    if (pet && pet !== this.bubblePet && !st.mode && !st.drag?.held) {
      const n = hearts(pet.mon.affection);
      this.label.innerHTML = `${esc(this.game.displayName(pet.mon))} <span class="hearts">${'♥'.repeat(n)}<i>${'♥'.repeat(5 - n)}</i></span>`;
      this.label.classList.remove('hidden');
      const hd = pet.head();
      place(this.label, hd.x, hd.y);
    } else {
      this.label.classList.add('hidden');
    }
    const w = this.director.enc?.entity;
    if (w && !this.encBar.classList.contains('hidden')) {
      const r = w.rect();
      place(this.encBar, r.x + r.w / 2, r.y - 12 * st.S);
    }
  }

  // ---------- 提示 ----------
  toast(text, { icon = null, kind = '' } = {}) {
    const el = h(`<div class="toast pix ${kind}"><span></span></div>`);
    el.querySelector('span').textContent = text;
    if (icon) el.prepend(pixelImg(icon, 2));
    this.toasts.append(el);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild.remove();
    setTimeout(() => el.classList.add('out'), 3800);
    setTimeout(() => el.remove(), 4300);
  }

  // ---------- 選單與視窗 ----------
  toggleMenu(force) {
    const show = force ?? this.menu.classList.contains('hidden');
    this.menu.classList.toggle('hidden', !show);
    if (show) this.audio.sfx('open');
  }

  open(name) {
    this.minigames?.closeMinigame('panel'); // 小遊戲玩到一半打開別的視窗：先結束遊戲
    this.toggleMenu(false);
    this.closePicker();
    this.panel = name;
    this.win.classList.remove('hidden');
    this.win.dataset.panel = name;
    this.renderPanel();
    this.audio.sfx('open');
  }

  closePanel() {
    if (!this.panel) return;
    this.panel = null;
    this.win.classList.add('hidden');
    this.audio.sfx('close');
  }

  closeAll() {
    this.closePicker();
    this.closeBubble();
    this.toggleMenu(false);
    this.closePanel();
  }

  refreshSoon() {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => { this.refreshTimer = null; this.refresh(); }, 120);
  }

  refresh() {
    if (this.panel) this.renderPanel();
    if (this.director.enc && !this.director.enc.throwing && !this.encBar.classList.contains('hidden')) this.showEncounter(this.director.enc);
    if (this.bubblePet) this.renderBubble();
    this.applySettings();
  }

  renderPanel() {
    const titles = { party: '夥伴', dex: '卡洛斯圖鑑', play: '一起玩', medals: '獎章', bag: '背包', album: '相簿', aura: '氣息', settings: '設定' };
    this.win.querySelector('.title').textContent = titles[this.panel];
    const body = this.win.querySelector('.body');
    const scroll = body.querySelector('.scroll')?.scrollTop;
    body.replaceChildren(this[`render_${this.panel}`]());
    const sc = body.querySelector('.scroll');
    if (sc && scroll) sc.scrollTop = scroll;
  }

  // 寶可夢小圖（先放替代圖，載好再換）
  thumb(speciesId, { shiny = false, size = 40, variant = 'color', form = null } = {}) {
    const wrap = document.createElement('span');
    wrap.className = 'thumb';
    wrap.style.width = wrap.style.height = `${size}px`;
    const paint = asset => {
      const img = variant === 'dark' ? asset.dark : asset.canvas;
      const scale = Math.min(2, size / Math.max(asset.w, asset.h));
      wrap.replaceChildren(pixelImg(img, scale));
    };
    const key = spriteKey(speciesId, form);
    paint(this.sprites.peek(key, shiny));
    this.sprites.get(key, shiny).then(paint);
    return wrap;
  }

  typeChips(types) {
    return types.map(t => `<span class="type" style="background:${art.TYPE_COLORS[t]}">${esc(this.dex.typeName(t))}</span>`).join('');
  }

  bar(label, value, max, cls = '') {
    const pct = Math.round((value / max) * 100);
    return `<div class="stat"><span>${label}</span><div class="bar ${cls}"><i style="width:${pct}%"></i></div></div>`;
  }

  heartsHtml(aff) {
    const n = hearts(aff);
    return `<span class="hearts lg">${'♥'.repeat(n)}<i>${'♥'.repeat(5 - n)}</i></span>`;
  }

  // ---------- 夥伴 ----------
  render_party() {
    const mons = this.game.state.mons;
    if (!mons.length) return h('<p class="empty">還沒有夥伴。</p>');
    if (!this.game.mon(this.selectedUid)) this.selectedUid = mons[0].uid;
    const root = h(`<div class="party"><div class="list scroll"></div><div class="detail"></div></div>`);
    const list = root.querySelector('.list');
    const out = this.game.outMons().length;
    const sorted = [...mons].sort((a, b) => (b.out - a.out) || (b.affection - a.affection));
    for (const m of sorted) {
      const row = h(`<button class="row ${m.uid === this.selectedUid ? 'sel' : ''}" data-uid="${m.uid}">
        <span class="name">${esc(this.game.displayName(m))}${m.shiny ? ' ✦' : ''}</span>
        <span class="hearts">${'♥'.repeat(hearts(m.affection))}</span>
        ${m.out ? '<span class="badge">桌面</span>' : ''}</button>`);
      row.prepend(this.thumb(m.species, { shiny: m.shiny, size: 36, form: m.form }));
      list.append(row);
    }
    const m = this.game.mon(this.selectedUid);
    const sp = this.dex.get(m.species);
    const nature = this.dex.nature(m.nature);
    const taste = !nature.likes ? '什麼都吃'
      : m.tasteKnown ? `喜歡${TASTE_ZH[nature.likes]}的（${this.flavorOf(nature.likes)}）・不喜歡${TASTE_ZH[nature.hates]}的（${this.flavorOf(nature.hates)}）`
      : '？？？（餵餵看就知道）';
    const evo = this.game.evolutionStatus(m.uid);
    let evoHtml = '<p class="hint">已經是最終型態了。</p>';
    if (evo) {
      const need = requirement(evo.evo).xp;
      evoHtml = this.bar('成長', Math.min(m.xp, need), need, 'xp')
        + (evo.ready ? `<button class="primary" data-act="evolve">✦ 進化！</button>` : `<p class="hint">${evo.blockers.map(b => esc(b.zh)).join('<br>')}</p>`);
    }
    const d = root.querySelector('.detail');
    d.innerHTML = `
      <div class="head"><div class="big"></div>
        <div><label class="nick">暱稱 <input maxlength="12" data-uid="${m.uid}" value="${esc(m.nickname ?? '')}" placeholder="${esc(sp.name.zh)}"></label>
        <div>No.${sp.id} ${esc(sp.name.zh)} ${this.typeChips(sp.types)}</div>
        ${this.formLine(m)}
        <div>性格：${esc(nature.zh)}</div><div>口味：${esc(taste)}</div>
        <div>${this.friendLine(m)}</div>
        <div class="habits">習性：${habitNames(m.species).map(esc).join('、') || '—'}</div>
        <div class="habits">招式：${movesetFor(this.dex, m.species).map(id => `<span class="move" style="border-color:${art.TYPE_COLORS[MOVES[id].type]}">${esc(MOVES[id].zh)}</span>`).join('')}</div></div></div>
      <div class="stats">
        <div class="stat"><span>好感</span>${this.heartsHtml(m.affection)}</div>
        ${this.bar('飽足感', m.fullness, MAX, 'full')}
        ${this.bar('滿足感', m.enjoyment, MAX, 'joy')}
        ${evoHtml}
      </div>
      ${this.tripLine(m)}
      ${this.mindHtml(m)}
      <div class="actions">
        ${m.out && this.game.tripStatus(m.uid) === 'away' ? ''
          : m.out ? `<button data-act="recall">收回</button><button data-act="feed">餵泡芙</button>${this.game.canDepart(m.uid) ? '<button data-act="trip">讓牠去旅行</button>' : ''}`
          : `<button data-act="sendout" ${out >= MAX_OUT ? 'disabled title="桌面上最多 6 隻"' : ''}>叫出來</button>`}
        ${m.species === 676 ? `<button data-act="trim" class="${this.trimOpen ? 'sel' : ''}">✂ 修剪</button>` : ''}
      </div>
      ${m.species === 676 && this.trimOpen ? this.trimHtml(m) : ''}
      <p class="meta">${new Date(m.caughtAt).toLocaleDateString('zh-TW')} 用${BALLS[m.ball].zh}收服</p>`;
    d.querySelector('.big').append(this.thumb(m.species, { shiny: m.shiny, size: 96, form: m.form }));
    d.querySelectorAll('[data-style]').forEach(b => b.prepend(this.thumb(676, { shiny: m.shiny, size: 40, form: b.dataset.style })));
    return root;
  }

  // 形態、超級進化、牽絆變身的說明
  formLine(m) {
    const lines = [];
    const f = FORMS[m.species];
    if (f?.family === 'vivillon' && !f.visible) lines.push(`花紋：${esc(formName(m.species, m.form))}（進化成彩粉蝶才看得到）`);
    else if (f?.family === 'furfrou') {
      const left = m.trimAt ? Math.max(0, Math.ceil((m.trimAt + TRIM_DAYS * 86400000 - Date.now()) / 86400000)) : 0;
      lines.push(`造型：${esc(formName(m.species, m.form))}${m.form ? `（大約 ${left} 天後長回來）` : ''}`);
    } else if (f) lines.push(`${f.family === 'flabebe' ? '花色' : '花紋'}：${esc(formName(m.species, m.form))}`);
    if (this.game.canMega(m.uid)) lines.push('✦ 帶著蒂安希進化石：對戰時會超級進化，也可以點牠叫牠超級進化');
    else if (m.species === 719) lines.push('<span class="hint">好感滿了會發生什麼事呢…</span>');
    if (this.game.canBondForm(m.uid)) lines.push('✦ 牠和夥伴的羈絆很深：對戰中有機會「牽絆變身」');
    return lines.map(l => `<div>${l}</div>`).join('');
  }

  // 多麗米亞美容：9 種造型，花一個泡芙（自動用最普通的那個）
  trimHtml(m) {
    const puff = this.cheapestPuff();
    const styles = formsOf(676).filter(s => s !== defaultForm(676));
    return `<div class="trim"><p class="hint">${puff ? `修剪要花一個泡芙（會用${esc(puffName(puff))}），牠會很開心。5 天後毛會長回來。` : '修剪要花一個泡芙，但背包裡沒有泡芙了。'}</p>
      <div class="styles">${styles.map(s => `<button data-style="${s}" ${!puff || s === m.form ? 'disabled' : ''}><small>${esc(formName(676, s))}</small></button>`).join('')}</div></div>`;
  }

  cheapestPuff() {
    const bag = this.game.state.bag.puffs;
    for (const t of TIER_ORDER) for (const f of FLAVORS) if (bag[puffKey(f, t)] > 0) return puffKey(f, t);
    return null;
  }

  // 旅行中／回來了
  tripLine(m) {
    const s = this.game.tripStatus(m.uid);
    if (s === 'home') return '';
    if (s === 'back') return '<p class="trip">✉ 旅行回來了！點桌面上的牠收下明信片</p>';
    const t = new Date(m.trip.returnAt);
    return `<p class="trip">🧳 去${esc(PLACES[m.trip.place].zh)}旅行中，大約 ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')} 回來</p>`;
  }

  // 心情、需求、最近在想什麼、記得的事
  mindHtml(m) {
    const d = describeMind(m);
    const needs = NEEDS.map(k => `<span class="need" title="${esc(NEED_ZH[k])}"><i style="width:${Math.round(d.levels[k])}%"></i><small>${esc(NEED_ZH[k])}</small></span>`).join('');
    const ago = t => { const min = Math.round((Date.now() - t) / 60000); return min < 1 ? '剛剛' : min < 60 ? `${min} 分鐘前` : `${Math.round(min / 60)} 小時前`; };
    const thoughts = d.thoughts.length ? d.thoughts.map(t => `<li>「${esc(t.text)}」<small>${ago(t.at)}</small></li>`).join('') : '<li class="hint">還沒想什麼（叫出來陪牠一下）</li>';
    const mems = d.memories.length ? `<div class="mems">記得：${d.memories.map(e => esc(e.text)).join('、')}</div>` : '';
    return `<div class="mind"><div class="mood">心情：${esc(MOOD_ZH[d.mood])}</div><div class="needs">${needs}</div>
      <div class="thoughts">最近在想什麼<ul>${thoughts}</ul></div>${mems}</div>`;
  }

  // 跟哪一隻夥伴感情最好
  friendLine(m) {
    const best = this.game.bestFriend(m.uid);
    if (!best || bondLevel(best.points) < 1) return '夥伴：還沒有特別要好的';
    const lv = bondLevel(best.points);
    return `${esc(BOND_LEVELS[lv].zh)}：${esc(this.game.displayName(this.game.mon(best.uid)))} ${'♥'.repeat(lv)}`;
  }

  flavorOf(taste) {
    const f = FLAVORS.find(fl => ({ sweet: 'sweet', mint: 'dry', citrus: 'sour', mocha: 'bitter', spice: 'spicy' })[fl] === taste);
    return `${FLAVOR_ZH[f]}泡芙`;
  }

  // ---------- 圖鑑 ----------
  render_dex() {
    const g = this.game;
    const root = h(`<div class="dex"><div class="summary">已見 ${g.seenCount()}・已捕獲 ${g.caughtCount()}／${this.dex.all.length}・色違 ${g.shinySpeciesCount()} 種${g.state.shinyCharm ? '・<span class="charm">✦ 閃耀護符</span>' : ''}</div>
      <div class="grid scroll"></div><div class="entry"></div></div>`);
    const grid = root.querySelector('.grid');
    for (const s of this.dex.all) {
      const d = g.state.dex[s.id];
      const cell = h(`<button class="cell ${this.selectedDex === s.id ? 'sel' : ''} ${d?.caught ? 'caught' : d?.seen ? 'seen' : 'unseen'}" data-dex="${s.id}"><small>${s.id}</small>${d?.shiny ? '<i class="shiny" title="抓過色違">✦</i>' : ''}</button>`);
      if (d?.seen) cell.prepend(this.thumb(s.id, { size: 40, variant: d.caught ? 'color' : 'dark', form: this.dexCoverForm(s.id, d) }));
      else cell.prepend(h('<span class="q">?</span>'));
      grid.append(cell);
    }
    const entry = root.querySelector('.entry');
    const id = this.selectedDex;
    const d = id && g.state.dex[id];
    if (!id || !d?.seen) {
      entry.innerHTML = `<p class="hint">點選已經見過的寶可夢查看資料。<br>還沒見過的寶可夢會顯示「?」。</p>`;
      return root;
    }
    const s = this.dex.get(id);
    const known = d.caught > 0;
    const shinyView = this.dexShiny && d.shiny > 0;
    entry.innerHTML = `
      <div class="big"></div>
      <h3>No.${s.id} ${esc(s.name.zh)}</h3>
      <div class="sub">${esc(s.name.ja)}・${esc(s.name.en)}</div>
      <div>${esc(s.genus ?? '')} ${this.typeChips(s.types)}</div>
      ${known ? `<div>身高 ${s.height} m・體重 ${s.weight} kg</div>
        <p class="flavor">${esc(s.flavor)}${s.flavorOfficial ? '' : '<br><small>（非官方翻譯）</small>'}</p>
        <div class="hint">習性：${habitNames(id).map(esc).join('、')}</div>` : '<p class="hint">抓到之後就能看到更多資料。</p>'}
      <div class="hint">出沒：${esc(SPOTS[this.habitatOf(id)].zh)}</div>
      <div class="hint">遇見 ${d.seen} 次・捕獲 ${d.caught} 次${d.shiny ? `・色違 ${d.shiny} 次` : ''}</div>
      ${d.shiny ? `<button data-act="shinyview" class="${shinyView ? 'sel' : ''}">✦ ${shinyView ? '看一般的樣子' : '看色違的樣子'}</button>` : known ? '<div class="hint">色違：還沒遇過</div>' : ''}
      ${this.dexFormsHtml(id, d)}`;
    entry.querySelector('.big').append(this.thumb(id, { size: 96, variant: known ? 'color' : 'dark', shiny: shinyView, form: this.dexViewForm(id, d) }));
    return root;
  }

  // 圖鑑裡要看哪一種形態（點過的；沒點過就看封面那一種）
  dexViewForm(id, d) {
    if (!FORMS[id] || !FORMS[id].visible) return null;
    return d.forms?.[this.dexForm]?.seen ? this.dexForm : this.dexCoverForm(id, d);
  }

  // 圖鑑格子上顯示的形態：抓過的優先，其次見過的（不要顯示一個根本沒見過的顏色）
  dexCoverForm(id, d) {
    if (!FORMS[id]?.visible) return null;
    const all = formsOf(id);
    return all.find(f => d.forms?.[f]?.caught) ?? all.find(f => d.forms?.[f]?.seen) ?? null;
  }

  // 花色、花紋、造型收集：見過的可以點來看，沒見過的是「？」
  dexFormsHtml(id, d) {
    const f = FORMS[id];
    if (!f) return '';
    const label = { flabebe: '花色', vivillon: '花紋', furfrou: '造型' }[f.family];
    const all = formsOf(id);
    const seen = all.filter(k => d.forms?.[k]?.seen);
    const caught = all.filter(k => d.forms?.[k]?.caught);
    const view = this.dexViewForm(id, d);
    const chips = all.map(k => (d.forms?.[k]?.seen
      ? `<button class="formchip ${k === view ? 'sel' : ''} ${d.forms[k].caught ? 'caught' : ''}" ${f.visible ? `data-dexform="${k}"` : 'disabled'}>${esc(formName(id, k))}</button>`
      : '<span class="formchip unseen">？</span>')).join('');
    return `<div class="forms"><div class="hint">${label}：見過 ${seen.length}・抓到 ${caught.length}／${all.length}${f.visible ? '' : '（進化成彩粉蝶才看得到花紋）'}</div><div class="chips">${chips}</div></div>`;
  }

  // ---------- 獎章 ----------
  render_medals() {
    const got = this.game.state.achievements;
    const n = ACHIEVEMENTS.filter(a => got[a.id]).length;
    const rewards = this.game.state.achievementRewards;
    const root = h(`<div class="medals"><div class="summary">收集了 ${n}／${ACHIEVEMENTS.length} 個
      ・${rewards.fancy ? '✦ 幻彩花紋' : `收集 ${REWARD_FANCY_AT} 個會遇到特別的彩粉蝶`}${rewards.pokeBall ? '・✦ 球球花紋' : ''}</div><div class="grid scroll"></div></div>`);
    const grid = root.querySelector('.grid');
    for (const a of ACHIEVEMENTS) {
      const at = got[a.id];
      const el = h(`<div class="medal ${at ? 'got' : ''}"><div><b>${esc(a.name)}</b><small>${esc(a.desc)}</small>${at ? `<small class="date">${new Date(at).toLocaleDateString('zh-TW')}</small>` : ''}</div></div>`);
      el.prepend(pixelImg(art.medal(Boolean(at)), 3));
      grid.append(el);
    }
    return root;
  }

  // ---------- 相簿（旅行帶回來的明信片） ----------
  render_album() {
    const g = this.game.state;
    const visited = Object.keys(g.placesVisited ?? {}).length;
    const root = h(`<div class="album"><div class="summary">去過 ${visited}／${PLACE_IDS.length} 個地方・${g.postcards.length} 張明信片</div><div class="grid scroll"></div></div>`);
    const grid = root.querySelector('.grid');
    if (!g.postcards.length) grid.append(h('<p class="empty">還沒有明信片。夥伴有時候會自己出門旅行，也可以在夥伴頁讓牠去。</p>'));
    for (const p of [...g.postcards].reverse()) {
      const el = h(`<button class="card" data-postcard="${esc(p.id)}"><b>${esc(PLACES[p.place].zh)}</b><small>${esc(p.name)}・${new Date(p.at).toLocaleDateString('zh-TW')}</small></button>`);
      el.prepend(pixelImg(cards.postcard(p.place, p.seed), 2));
      grid.append(el);
    }
    // 還沒去過的地方
    const miss = PLACE_IDS.filter(id => !g.placesVisited?.[id]);
    if (miss.length && g.postcards.length) grid.append(h(`<p class="hint">還沒去過：${miss.map(id => esc(PLACES[id].zh)).join('、')}</p>`));
    return root;
  }

  // 明信片（收下的時候、或在相簿裡點開）
  showPostcard({ postcard: p, gifts = null }) {
    const giftText = gifts ? [
      ...Object.entries(gifts.berries).map(([b, n]) => `${BERRY_ZH[b]}×${n}`),
      ...Object.entries(gifts.balls).map(([b, n]) => `${BALLS[b].zh}×${n}`),
      ...gifts.puffs.map(k => puffName(k)),
    ].join('、') : '';
    this.modal.innerHTML = `<div class="dialog postcard hit pix"><h2></h2><div class="pic"></div><p class="diary"></p>${giftText ? '<p class="gifts"></p>' : ''}<p class="from"></p><div class="btns"><button data-yes class="primary">好</button></div></div>`;
    this.modal.querySelector('h2').textContent = `來自${PLACES[p.place].zh}的明信片`;
    this.modal.querySelector('.pic').append(pixelImg(cards.postcard(p.place, p.seed), 5));
    this.modal.querySelector('.diary').textContent = `「${p.diary}」`;
    if (giftText) this.modal.querySelector('.gifts').textContent = `帶回來的東西：${giftText}`;
    this.modal.querySelector('.from').textContent = `—— ${p.name}，${new Date(p.at).toLocaleDateString('zh-TW')}`;
    this.modal.classList.remove('hidden');
    this.modal.onclick = e => { if (e.target.closest('[data-yes]')) this.modal.classList.add('hidden'); };
  }

  // ---------- 一起玩（小遊戲） ----------
  playPartner() {
    return this.game.mon(this.playUid) ?? this.game.outMons()[0] ?? this.game.state.mons[0] ?? null;
  }

  render_play() {
    const mons = this.game.state.mons;
    if (!mons.length) return h('<p class="empty">還沒有夥伴。</p>');
    const partner = this.playPartner();
    const berries = this.game.state.bag.berries;
    const root = h(`<div class="play">
      <label class="partner">和誰一起玩：<select data-partner>${mons.map(m => `<option value="${m.uid}" ${m.uid === partner?.uid ? 'selected' : ''}>${esc(this.game.displayName(m))}${m.out ? '' : '（在球裡）'}</option>`).join('')}</select></label>
      <div class="games scroll"></div>
      <p class="hint">樹果：${Object.entries(berries).map(([b, n]) => `${BERRY_ZH[b]} ${n}`).join('・')}</p></div>`);
    const list = root.querySelector('.games');
    for (const name of GAME_ORDER) {
      const g = GAMES[name];
      const why = this.minigames.blocked(name, partner?.uid);
      list.append(h(`<div class="game"><div><b>${g.title}</b><p class="hint">${esc(g.desc)}</p>${why ? `<p class="why">${esc(why)}</p>` : ''}</div>
        <button class="primary" data-play="${name}" ${why ? 'disabled' : ''}>玩</button></div>`));
    }
    return root;
  }

  habitatOf(id) {
    return { 716: 'rock', 717: 'sky', 718: 'rock', 719: 'rock', 720: 'ring', 721: 'puddle' }[id] ?? this.dex.habitat(id);
  }

  // ---------- 背包 ----------
  render_bag() {
    const bag = this.game.state.bag;
    const root = h(`<div class="bag"><h4>精靈球</h4><div class="balls"></div>
      <p class="hint">精靈球每 10 分鐘補充 1 顆（最多補到 30）。抓到新的寶可夢也會拿到獎勵。</p>
      <h4>寶可夢泡芙</h4><div class="puffs"></div><p class="hint puffhint">點選泡芙可以放在桌面上當誘餌（持續 10 分鐘）。</p>
      <h4>樹果</h4><div class="balls berries"></div><p class="hint">在「一起玩」摘樹果，拿來做泡芙。</p>
      ${this.game.state.eggs.length ? `<h4>蛋（${this.game.state.eggs.length}／3）</h4><div class="eggs"></div><p class="hint">移動游標、在電腦前待著，蛋就會慢慢孵化。好了之後會出現在桌面上。</p>` : ''}
      ${bag.items.diancite ? '<h4>重要物品</h4><div class="item">✦ 蒂安希進化石</div>' : ''}
      ${this.game.state.zygardeCells ? `<h4>其他</h4><div class="cells"></div>` : ''}</div>`);
    const balls = root.querySelector('.balls');
    for (const b of BALL_ORDER) {
      const el = h(`<div class="item"><span>${BALLS[b].zh}</span><b>×${bag.balls[b]}</b></div>`);
      el.prepend(pixelImg(art.balls[b], 2));
      balls.append(el);
    }
    const eggBox = root.querySelector('.eggs');
    for (const e of this.game.state.eggs) {
      const pct = Math.floor((e.steps / e.need) * 100);
      const el = h(`<div class="item egg"><span>${pct >= 100 ? '快要孵化了！' : pct > 66 ? '裡面有動靜…' : pct > 33 ? '偶爾會動一下' : '還要很久'}</span><div class="bar"><i style="width:${pct}%"></i></div></div>`);
      el.prepend(pixelImg(art.egg(art.TYPE_COLORS[this.dex.get(e.species).types[0]]), 2));
      eggBox?.append(el);
    }
    const berryBox = root.querySelector('.berries');
    for (const [b, n] of Object.entries(bag.berries)) {
      const el = h(`<div class="item"><span>${BERRY_ZH[b]}</span><b>×${n}</b></div>`);
      el.prepend(pixelImg(art.berries[b], 2));
      berryBox.append(el);
    }
    const puffs = root.querySelector('.puffs');
    puffs.append(h('<span></span>'));
    for (const t of TIER_ORDER) puffs.append(h(`<span class="col">${TIERS[t].zh || '普通'}</span>`));
    for (const f of FLAVORS) {
      puffs.append(h(`<span class="rowlabel">${FLAVOR_ZH[f]}</span>`));
      for (const t of TIER_ORDER) {
        const key = puffKey(f, t), n = bag.puffs[key] ?? 0;
        const el = h(`<button class="item puff ${n ? '' : 'none'}" data-puff="${key}" title="${esc(puffName(key))}"><b>×${n}</b></button>`);
        el.prepend(pixelImg(art.puff(key), 3));
        puffs.append(el);
      }
    }
    const cells = root.querySelector('.cells');
    if (cells) {
      const el = h(`<div class="item"><span>基格爾德核心</span><b>${this.game.state.zygardeCells}／10</b></div>`);
      el.prepend(pixelImg(art.zygardeCell(0), 2));
      cells.append(el);
    }
    return root;
  }

  // ---------- 氣息 ----------
  render_aura() {
    const d = this.director;
    const mods = activeModifiers(d.ctx(), this.dex);
    const mins = Number.isFinite(d.nextSpawnAt) ? Math.max(0, Math.round((d.nextSpawnAt - Date.now()) / 60000)) : null;
    const next = d.enc ? '野生寶可夢正在桌面上！' : this.stage.spot ? '桌面上有氣息點，點點看！'
      : this.game.state.settings.quiet ? '勿擾模式中，不會有寶可夢出現。'
      : mins === null ? '…' : mins <= 1 ? '好像快要有什麼出現了…' : `大約 ${mins} 分鐘後會有動靜`;
    const flavorLines = FLAVORS.map(f => `<li><b>${FLAVOR_ZH[f]}</b>：${FLAVOR_TYPES[f].map(t => esc(this.dex.typeName(t))).join('、')}</li>`).join('');
    return h(`<div class="aura scroll">
      <p class="next">${esc(next)}</p>
      <h4>現在的氣息</h4>
      <ul>${mods.map(m => `<li>${esc(m.zh)}</li>`).join('') || '<li>沒有特別的氣息。</li>'}</ul>
      <h4>寶可夢從哪裡來？</h4>
      <p class="hint">野生寶可夢會從桌面上的「氣息點」冒出來：${Object.entries(SPOTS).filter(([k]) => k !== 'ring').map(([, v]) => esc(v.zh)).join('、')}。點一下氣息點就會遇到牠。</p>
      <p class="hint">出現的寶可夢會受到現實時間、星期、你的電腦（很燙？剛插上電源？剛從離開回來？）影響。這些只讀取系統狀態，不會讀取你的鍵盤或視窗內容。</p>
      <h4>泡芙誘餌吸引的屬性</h4><ul>${flavorLines}</ul>
      ${this.shinyHtml()}
      <p class="hint">據說好感滿點的夥伴、集齊的核心、特別的時刻，會引來卡洛斯的傳說…</p>
    </div>`);
  }

  shinyHtml() {
    const st = this.game.state, c = st.chain, ctx = this.director.ctx();
    const odds = id => `1/${Math.round(1 / shinyChance(st, id, ctx))}`;
    const chainLine = c.count > 0
      ? `<li>連鎖中：<b>${esc(this.dex.name(c.species))} ×${c.count}</b>（牠比較常出現；牠的色違機率 ${odds(c.species)}${chainRolls(c.count) ? '' : '，連鎖 5 以上開始提高'}）</li>`
      : '<li>連鎖：連續抓同一種寶可夢會形成連鎖，越長越容易遇到牠的色違</li>';
    return `<h4>色違</h4><ul>
      <li>現在的色違機率：約 ${odds(-1)}（基本 1/${BASE_ODDS}）</li>
      ${chainLine}
      <li>閃耀護符：${st.shinyCharm ? '✦ 已獲得（色違機率 ×3）' : `圖鑑捕獲 ${CHARM_AT} 種可以拿到（目前 ${this.game.caughtCount()} 種）`}</li>
      <li>華麗、豪華泡芙當誘餌時，色違也會比較容易出現${ctx.lureTier === 'fancy' || ctx.lureTier === 'deluxe' ? '（生效中）' : ''}</li>
    </ul><p class="hint">連鎖中的寶可夢逃走或放牠離開，連鎖就會中斷。色違的氣息點偶爾會閃一下。</p>`;
  }

  // ---------- 設定 ----------
  render_settings() {
    const s = this.game.state.settings;
    const rates = Object.entries(RATES).map(([k, v]) => `<label><input type="radio" name="rate" value="${k}" ${s.encounterRate === k ? 'checked' : ''}> ${v.zh}</label>`).join('');
    return h(`<div class="settings">
      <label>音樂音量 <input type="range" min="0" max="1" step="0.05" data-set="musicVolume" value="${s.musicVolume}"></label>
      <label>音效音量 <input type="range" min="0" max="1" step="0.05" data-set="sfxVolume" value="${s.sfxVolume}"></label>
      <label>專注時間 <input type="range" min="15" max="60" step="5" data-set="focusMinutes" value="${s.focusMinutes}"> <span class="focusmin">${s.focusMinutes} 分鐘</span></label>
      ${this.weatherSettingsHtml()}
      ${this.syncSettingsHtml()}
      <label><input type="checkbox" data-set="muted" ${s.muted ? 'checked' : ''}> 靜音</label>
      <div>野生寶可夢出現頻率：${rates}</div>
      <label><input type="checkbox" data-set="showLauncher" ${s.showLauncher ? 'checked' : ''}> 顯示右下角的精靈球按鈕（隱藏後可從系統匣開啟選單）</label>
      <label><input type="checkbox" data-set="quiet" ${s.quiet ? 'checked' : ''}> 勿擾模式（收起所有寶可夢、暫停遭遇）</label>
      <label><input type="checkbox" data-login> 開機時自動啟動</label>
      ${this.dev ? '<button data-act="spawn">〔開發〕立刻生成氣息點</button> <button data-act="devfill">〔開發〕補滿道具</button>' : ''}
      <hr><button class="danger" data-act="reset">重置存檔…</button>
      <p class="hint">存檔位置：使用者資料夾／save.json。寶可夢圖片第一次出現時會從 PokeAPI 下載並快取。</p>
    </div>`);
  }

  // ---------- 視窗內的點擊 ----------
  onPanelClick(e) {
    const t = e.target.closest('button, [data-uid], [data-dex], [data-puff]');
    if (!t) return;
    if (t.matches('.row[data-uid]')) { this.selectedUid = t.dataset.uid; this.trimOpen = false; this.audio.sfx('click'); this.renderPanel(); return; }
    if (t.dataset.dex) {
      const id = Number(t.dataset.dex);
      if (this.game.state.dex[id]?.seen) { this.selectedDex = id; this.dexForm = null; this.audio.sfx('click'); this.renderPanel(); }
      return;
    }
    if (t.dataset.citypick !== undefined) { this.pickCity(Number(t.dataset.citypick)); return; }
    if (t.dataset.postcard) { const pc = this.game.state.postcards.find(x => x.id === t.dataset.postcard); if (pc) { this.audio.sfx('click'); this.showPostcard({ postcard: pc }); } return; }
    if (t.dataset.play) { this.minigames.open(t.dataset.play, this.playPartner()?.uid); return; }
    if (t.dataset.dexform) { this.dexForm = t.dataset.dexform; this.audio.sfx('click'); this.renderPanel(); return; }
    if (t.dataset.style) {
      const puff = this.cheapestPuff();
      const m = this.game.mon(this.selectedUid);
      if (!puff || !m || !this.game.trim(m.uid, t.dataset.style, puff).ok) return;
      this.trimOpen = false;
      this.audio.sfx('sparkle');
      this.toast(`${this.game.displayName(m)}換成了${formName(676, m.form)}！`, { icon: art.sparkle });
      this.renderPanel();
      return;
    }
    if (t.dataset.puff) {
      const key = t.dataset.puff;
      if (!(this.game.state.bag.puffs[key] > 0)) return;
      this.audio.sfx('click');
      const f = key.split('-')[0];
      this.confirm(`把${puffName(key)}放在桌面上當誘餌？\n會吸引${FLAVOR_TYPES[f].map(x => this.dex.typeName(x)).join('、')}屬性的寶可夢，持續 10 分鐘。`, () => {
        if (this.director.placeLure(key)) this.closePanel();
      });
      return;
    }
    const act = t.dataset.act;
    const m = this.game.mon(this.selectedUid);
    switch (act) {
      case 'recall': this.game.setOut(m.uid, false); this.audio.sfx('close'); break;
      case 'trip':
        if (this.director.sendOnTrip(m.uid)) { this.toast(`${this.game.displayName(m)}出發去旅行了！`); this.closePanel(); }
        break;
      case 'sendout': if (!this.game.setOut(m.uid, true)) this.toast('桌面上最多 6 隻'); break;
      case 'feed': this.closePanel(); this.openPuffPicker(key => this.director.feedMode(key, 'pet')); break;
      case 'evolve': {
        const pet = this.stage.pets.get(m.uid);
        if (!pet) { this.game.setOut(m.uid, true); this.toast('先把牠叫到桌面上吧'); break; }
        this.closePanel();
        this.director.startEvolution(pet);
        break;
      }
      case 'spawn': this.director.spawnNow(); break;
      case 'shinyview': this.dexShiny = !this.dexShiny; this.audio.sfx('click'); this.renderPanel(); return;
      case 'citysearch': this.searchCity(); return;
      case 'syncsetup': this.sync?.setup().then(() => this.renderPanel()); return;
      case 'syncnow': this.sync?.run(true); return;
      case 'syncstop': this.confirm('停止同步？這台電腦的存檔會留著，只是之後不會再和其他電腦合併。', () => { this.sync?.stop(); this.renderPanel(); }); return;
      case 'trim': this.trimOpen = !this.trimOpen; this.audio.sfx('click'); this.renderPanel(); return;
      case 'devfill':
        for (const k of Object.keys(this.game.state.bag.puffs)) this.game.state.bag.puffs[k] += 5;
        for (const k of BALL_ORDER) this.game.state.bag.balls[k] += 20;
        this.game.emit('bag');
        break;
      case 'reset':
        this.confirm('真的要重置存檔嗎？所有夥伴和圖鑑紀錄都會消失。', () => this.confirm('再確認一次：真的要全部重來？', () => this.onReset?.()));
        break;
      default: break;
    }
    this.refreshSoon();
  }

  onPanelChange(e) {
    const t = e.target;
    if (t.name === 'rate') { this.game.setSetting('encounterRate', t.value); this.director.scheduleNext(); }
    if (t.dataset.set && t.type === 'checkbox') {
      if (t.dataset.set === 'quiet') this.toggleQuiet(t.checked);
      else this.game.setSetting(t.dataset.set, t.checked);
    }
    if (t.dataset.login !== undefined) this.api.setLoginItem(t.checked);
    if (t.matches('.nick input')) this.game.rename(t.dataset.uid, t.value);
    if (t.dataset.partner !== undefined) { this.playUid = t.value; this.renderPanel(); }
    if (t.dataset.weatheron !== undefined && this.game.state.weather) {
      this.game.state.weather.enabled = t.checked;
      this.game.emit('settings', { key: 'weather' });
      this.director.refreshWeather(true);
    }
    this.onSettings?.();
  }

  onPanelInput(e) {
    const t = e.target;
    if (t.dataset.set && t.type === 'range') {
      this.game.state.settings[t.dataset.set] = Number(t.value);
      if (t.dataset.set === 'focusMinutes') t.parentElement.querySelector('.focusmin').textContent = `${t.value} 分鐘`;
      this.onSettings?.();
    }
  }

  // ---------- 同步設定 ----------
  syncSettingsHtml() {
    const y = this.game.state.sync, st = this.sync?.status;
    if (!y) {
      return `<fieldset class="sync"><legend>在兩台電腦之間同步</legend>
        <p class="hint">選一個你自己的雲端同步資料夾（Google Drive、OneDrive、Dropbox…），兩台電腦都選同一個，夥伴、圖鑑、背包就會合在一起。不需要帳號，也不會把資料傳到別的地方。</p>
        <button data-act="syncsetup">選同步資料夾…</button></fieldset>`;
    }
    const when = st ? new Date(st.at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '';
    return `<fieldset class="sync"><legend>在兩台電腦之間同步</legend>
      <div class="hint">資料夾：${esc(y.folder)}</div>
      <div class="${st && !st.ok ? 'why' : 'hint'}">${st ? `${when} ${esc(st.msg)}` : '還沒同步過'}（每 5 分鐘自動同步）</div>
      <div class="btns"><button data-act="syncnow">現在同步</button><button data-act="syncstop">停止同步</button></div></fieldset>`;
  }

  // ---------- 天氣設定 ----------
  weatherSettingsHtml() {
    const w = this.game.state.weather;
    const now = this.director.weather ? WEATHER_ZH[this.director.weather] ?? '—' : '還沒查到';
    const results = (this.cityResults ?? []).map((c, i) => `<button data-citypick="${i}">${esc(c.name)} <small>${esc(c.region)}</small></button>`).join('');
    return `<fieldset class="weather"><legend>天氣</legend>
      ${w ? `<label><input type="checkbox" data-weatheron ${w.enabled ? 'checked' : ''}> 依照「${esc(w.city)}」的天氣（現在：${esc(now)}）</label>`
        : '<p class="hint">輸入你的城市，出現的寶可夢會跟著真實天氣變化（下雨時水屬性變多…）。用 Open-Meteo 查詢，不會用 IP 猜你的位置。</p>'}
      <div class="cityrow"><input data-city maxlength="40" placeholder="城市，例如：中壢" value="${esc(this.cityQuery ?? '')}"><button data-act="citysearch">搜尋</button></div>
      ${this.cityResults ? (results || '<p class="hint">找不到這個城市（或連不上網路）</p>') : ''}
    </fieldset>`;
  }

  async searchCity() {
    const q = this.win.querySelector('[data-city]')?.value.trim() ?? '';
    this.cityQuery = q;
    if (!q) return;
    this.cityResults = await Promise.resolve(this.api.searchCity?.(q)).catch(() => []) ?? [];
    this.renderPanel();
  }

  pickCity(i) {
    const c = this.cityResults?.[i];
    if (!c) return;
    this.game.state.weather = { city: c.name, lat: c.lat, lon: c.lon, enabled: true };
    this.cityResults = null;
    this.game.emit('settings', { key: 'weather' });
    this.director.refreshWeather(true).then(() => this.renderPanel());
    this.toast(`之後會依照${c.name}的天氣`);
  }

  // ---------- 專注番茄鐘 ----------
  startFocus() {
    this.minigames.closeMinigame('focus');
    this.toggleMenu(false);
    if (!this.game.startFocus()) return;
    const m = this.game.state.focus.active.minutes;
    this.toast(`開始專注 ${m} 分鐘。寶可夢們會安靜地陪你，野生寶可夢也不會來打擾`);
    this.director.nextSpawnAt = Math.max(this.director.nextSpawnAt, Date.now() + m * 60_000);
    // 正在跑來跑去的先停下來
    for (const p of this.stage.pets.values()) if (p.free && !p.perch) p.set('sit', 6);
    this.applySettings();
  }

  stopFocus() {
    this.toggleMenu(false);
    if (this.game.cancelFocus()) this.toast('專注結束了（沒有完成，下次再試試）');
    this.applySettings();
  }

  // 專注中：畫面角落的剩餘時間（不攔截滑鼠）
  updateFocusHud() {
    const ms = this.game.state.focus.active ? this.game.focusRemaining() : 0;
    this.focusHud.classList.toggle('hidden', !ms);
    if (!ms) return;
    const sec = Math.ceil(ms / 1000);
    const text = `專注中 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    if (this.focusHud.textContent !== text) this.focusHud.textContent = text;
  }

  toggleQuiet(force) {
    const q = force ?? !this.game.state.settings.quiet;
    if (q) this.minigames.closeMinigame('quiet');
    this.game.setSetting('quiet', q);
    if (q && this.director.enc) this.director.runAway();
    this.director.syncPets();
    if (!q) this.director.scheduleNext();
    this.toggleMenu(false);
    this.toast(q ? '勿擾模式：寶可夢們先回球裡休息了' : '寶可夢們回來了！');
    this.onSettings?.();
  }

  // ---------- 寶可夢旁的小對話框 ----------
  openPetBubble(pet) {
    this.closePicker();
    this.bubblePet = pet;
    this.bubbleMoves = false;
    this.renderBubble();
    this.bubble.classList.remove('hidden');
    this.audio.sfx('click');
  }

  renderBubble() {
    const pet = this.bubblePet, m = pet.mon;
    const evo = this.game.evolutionStatus(m.uid);
    const n = hearts(m.affection);
    const moves = this.bubbleMoves
      ? `<div class="btns moves">${movesetFor(this.dex, m.species).map(id => `<button data-move="${id}" style="border-color:${art.TYPE_COLORS[MOVES[id].type]}">${esc(MOVES[id].zh)}</button>`).join('')}</div>`
      : '';
    this.bubble.innerHTML = `<div class="name">${esc(this.game.displayName(m))} <span class="hearts">${'♥'.repeat(n)}<i>${'♥'.repeat(5 - n)}</i></span></div>
      <div class="btns"><button data-act="feed">餵泡芙</button><button data-act="moves" class="${this.bubbleMoves ? 'sel' : ''}">招式</button><button data-act="info">看看牠</button><button data-act="recall">回球裡</button>
      ${evo?.ready ? '<button class="primary" data-act="evolve">✦ 進化</button>' : ''}
      ${this.game.canMega(m.uid) ? `<button data-act="mega" ${pet.formFx ? 'disabled' : ''}>${pet.battleForm === 'mega' ? '解除超級進化' : '✦ 超級進化'}</button>` : ''}</div>${moves}`;
  }

  onBubbleClick(e) {
    const btn = e.target.closest('button');
    const act = btn?.dataset.act;
    const pet = this.bubblePet;
    if (!btn || !pet) return;
    this.audio.sfx('click');
    if (btn.dataset.move) {
      // 叫牠對前方使出招式（只是演出）
      if (['held', 'evolving', 'move', 'eat', 'fall', 'appear'].includes(pet.state) || pet.duel || pet.group) return;
      pet.partner = null;
      useMove(pet, btn.dataset.move, practicePoint(pet));
      this.closeBubble();
      return;
    }
    if (act === 'moves') { this.bubbleMoves = !this.bubbleMoves; this.renderBubble(); return; }
    if (act === 'feed') { this.closeBubble(); this.openPuffPicker(key => this.director.feedMode(key, 'pet')); }
    if (act === 'info') { this.selectedUid = pet.uid; this.closeBubble(); this.open('party'); }
    if (act === 'recall') { this.closeBubble(); this.game.setOut(pet.uid, false); }
    if (act === 'evolve') this.director.startEvolution(pet);
    if (act === 'mega') {
      this.closeBubble();
      if (pet.battleForm === 'mega') revertForm(pet);
      else transformForm(pet, 'mega'); // 最多維持 5 分鐘
    }
  }

  closeBubble() {
    this.bubblePet = null;
    this.bubble.classList.add('hidden');
  }

  // ---------- 泡芙選擇 ----------
  openPuffPicker(onPick, title = '要給哪一個泡芙？') {
    const bag = this.game.state.bag.puffs;
    const keys = Object.keys(bag).filter(k => bag[k] > 0);
    if (!keys.length) { this.toast('沒有泡芙了…（每日禮物、夥伴撿到、抓寶可夢都可能拿到）'); return; }
    this.pickerCb = onPick;
    this.picker.innerHTML = `<div class="title">${esc(title)}</div><div class="puffs"></div><button data-cancel>取消</button>`;
    const box = this.picker.querySelector('.puffs');
    for (const k of keys) {
      const b = h(`<button class="item puff" data-puff="${k}" title="${esc(puffName(k))}"><b>×${bag[k]}</b></button>`);
      b.prepend(pixelImg(art.puff(k), 2));
      box.append(b);
    }
    this.picker.classList.remove('hidden');
  }

  onPickerClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.puff) { this.audio.sfx('click'); const cb = this.pickerCb; this.closePicker(); cb?.(b.dataset.puff); }
    if (b.dataset.cancel !== undefined) this.closePicker();
  }

  closePicker() { this.picker.classList.add('hidden'); this.pickerCb = null; }

  // ---------- 遭遇列 ----------
  showEncounter(enc) {
    if (!enc) return;
    // 球還在搖的時候不要重畫（不然「已捕獲」標籤會先洩漏結果）
    if (enc.throwing) { this.hideEncounter(); return; }
    const s = this.dex.get(enc.wild.speciesId);
    const bag = this.game.state.bag.balls;
    const caughtBefore = (this.game.state.dex[s.id]?.caught ?? 0) > 0;
    const busy = enc.throwing;
    const aiming = this.stage.mode?.type === 'aim' ? this.stage.mode.ball : null;
    const chain = this.game.state.chain;
    const chainTag = chain.species === s.id && chain.count ? ` <span class="badge chain">連鎖 ×${chain.count}</span>` : '';
    this.encBar.innerHTML = `<div class="name">${enc.wild.shiny ? '<span class="shinytag">✦ 色違</span> ' : ''}野生的${esc(s.name.zh)}${caughtBefore ? ' <span class="badge">已捕獲</span>' : ''}${chainTag}</div>
      <div class="btns">${BALL_ORDER.map(b => `<button data-ball="${b}" class="${aiming === b ? 'sel' : ''}" ${busy || !bag[b] ? 'disabled' : ''} title="${BALLS[b].zh}">×${bag[b]}</button>`).join('')}
      <button data-act="puff" ${busy || enc.wild.puff !== 'none' ? 'disabled' : ''}>給泡芙</button><button data-act="run" ${busy ? 'disabled' : ''}>離開</button></div>
      <div class="hint">${aiming ? '在圈圈最小的時候點牠！' : enc.wild.puff !== 'none' ? '牠吃了泡芙，變得比較安心了' : '選一顆球，或先給牠泡芙'}</div>`;
    for (const b of BALL_ORDER) this.encBar.querySelector(`[data-ball="${b}"]`).prepend(pixelImg(art.balls[b], 2));
    this.encBar.classList.remove('hidden');
  }

  onEncounterClick(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    this.audio.sfx('click');
    if (b.dataset.ball) {
      if (this.stage.mode?.type === 'aim' && this.stage.mode.ball === b.dataset.ball) this.director.setMode(null);
      else this.director.aim(b.dataset.ball);
    }
    if (b.dataset.act === 'puff') this.openPuffPicker(key => this.director.feedMode(key, 'wild'), '給野生寶可夢哪一個泡芙？');
    if (b.dataset.act === 'run') this.director.runAway();
  }

  hideEncounter() { this.encBar.classList.add('hidden'); }

  onModeChange() { if (this.director.enc) this.showEncounter(this.director.enc); }

  // ---------- 對話框 ----------
  confirm(text, onYes) {
    this.modal.innerHTML = `<div class="dialog hit pix"><p></p><div class="btns"><button data-yes class="primary">好</button><button data-no>取消</button></div></div>`;
    this.modal.querySelector('p').textContent = text;
    this.modal.classList.remove('hidden');
    this.modal.onclick = e => {
      if (e.target.closest('[data-yes]')) { this.modal.classList.add('hidden'); onYes(); }
      if (e.target.closest('[data-no]')) this.modal.classList.add('hidden');
    };
  }

  // 多個選項的對話框：回傳選到的 value（取消是 null）
  ask(text, options) {
    return new Promise(resolve => {
      this.modal.innerHTML = `<div class="dialog ask hit pix"><p></p><div class="choices">${options.map((o, i) => `<button data-choice="${i}" class="${i === 0 ? 'primary' : ''}">${esc(o.label)}${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</button>`).join('')}</div></div>`;
      this.modal.querySelector('p').textContent = text;
      this.modal.classList.remove('hidden');
      this.modal.onclick = e => {
        const b = e.target.closest('[data-choice]');
        if (!b) return;
        this.modal.classList.add('hidden');
        resolve(options[Number(b.dataset.choice)].value);
      };
    });
  }

  showStarter(onPick) {
    this.modal.innerHTML = `<div class="dialog starter hit pix">
      <h2>歡迎來到卡洛斯！</h2>
      <p>選一隻寶可夢，陪你一起待在桌面上吧。<br>摸摸牠、餵牠泡芙，好感度會慢慢提升。</p>
      <div class="cards"></div>
      <p class="hint">之後野生寶可夢會從桌面下緣冒出來，點一下就能遇到牠們。</p></div>`;
    const cards = this.modal.querySelector('.cards');
    for (const id of STARTERS) {
      const s = this.dex.get(id);
      const c = h(`<button class="card" data-id="${id}"><b>${esc(s.name.zh)}</b><span>${this.typeChips(s.types)}</span></button>`);
      c.prepend(this.thumb(id, { size: 96 }));
      cards.append(c);
    }
    this.modal.classList.remove('hidden');
    this.modal.onclick = e => {
      const c = e.target.closest('.card');
      if (!c) return;
      this.modal.classList.add('hidden');
      onPick(Number(c.dataset.id));
    };
  }
}
