// 介面（DOM）：右下角的選單按鈕、夥伴／圖鑑／背包／氣息／設定視窗、寶可夢旁的小對話框、遭遇列、提示訊息。
// 所有可以點的元素都要有 .hit，舞台才知道游標在介面上時要接收滑鼠。
import * as art from '../gfx/art.js';
import { makeCanvas } from '../gfx/pixel.js';
import { hearts, puffName, FLAVORS, TIER_ORDER, TIERS, FLAVOR_ZH, TASTE_ZH, puffKey, MAX } from '../../core/amie.js';
import { BALLS, BALL_ORDER } from '../../core/capture.js';
import { activeModifiers, FLAVOR_TYPES, RATES } from '../../core/encounter.js';
import { requirement } from '../../core/evolution.js';
import { SPOTS } from '../../core/dex.js';
import { STARTERS, BOND_LEVELS, bondLevel } from '../../core/game.js';
import { shinyChance, chainRolls, BASE_ODDS, CHARM_AT } from '../../core/shiny.js';
import { MAX_OUT } from '../../core/save.js';

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
    stage.uiHit = (x, y) => this.hitTest(x, y);
    game.on('change', ({ event }) => {
      if (['tick', 'bag', 'party', 'caught', 'evolved', 'fed', 'heartsUp', 'dexSeen', 'cell', 'settings'].includes(event)) this.refreshSoon();
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
      <button data-open="bag">背包</button><button data-open="aura">氣息</button>
      <button data-open="settings">設定</button><button data-act="quiet">勿擾模式</button>
    </div>`);
    this.menu.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      this.audio.sfx('click');
      if (b.dataset.open) this.open(b.dataset.open);
      if (b.dataset.act === 'quiet') this.toggleQuiet();
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
    r.append(this.label, this.bubble, this.encBar, this.picker, this.menu, this.win, this.launcher, this.toasts, this.modal);
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
  }

  // ---------- 每一幀：跟著寶可夢移動的元素 ----------
  update() {
    const st = this.stage;
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
    const titles = { party: '夥伴', dex: '卡洛斯圖鑑', bag: '背包', aura: '氣息', settings: '設定' };
    this.win.querySelector('.title').textContent = titles[this.panel];
    const body = this.win.querySelector('.body');
    const scroll = body.querySelector('.scroll')?.scrollTop;
    body.replaceChildren(this[`render_${this.panel}`]());
    const sc = body.querySelector('.scroll');
    if (sc && scroll) sc.scrollTop = scroll;
  }

  // 寶可夢小圖（先放替代圖，載好再換）
  thumb(speciesId, { shiny = false, size = 40, variant = 'color' } = {}) {
    const wrap = document.createElement('span');
    wrap.className = 'thumb';
    wrap.style.width = wrap.style.height = `${size}px`;
    const paint = asset => {
      const img = variant === 'dark' ? asset.dark : asset.canvas;
      const scale = Math.min(2, size / Math.max(asset.w, asset.h));
      wrap.replaceChildren(pixelImg(img, scale));
    };
    paint(this.sprites.peek(speciesId, shiny));
    this.sprites.get(speciesId, shiny).then(paint);
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
      row.prepend(this.thumb(m.species, { shiny: m.shiny, size: 36 }));
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
        <div>性格：${esc(nature.zh)}</div><div>口味：${esc(taste)}</div>
        <div>${this.friendLine(m)}</div></div></div>
      <div class="stats">
        <div class="stat"><span>好感</span>${this.heartsHtml(m.affection)}</div>
        ${this.bar('飽足感', m.fullness, MAX, 'full')}
        ${this.bar('滿足感', m.enjoyment, MAX, 'joy')}
        ${evoHtml}
      </div>
      <div class="actions">
        ${m.out ? '<button data-act="recall">收回</button><button data-act="feed">餵泡芙</button>'
          : `<button data-act="sendout" ${out >= MAX_OUT ? 'disabled title="桌面上最多 6 隻"' : ''}>叫出來</button>`}
      </div>
      <p class="meta">${new Date(m.caughtAt).toLocaleDateString('zh-TW')} 用${BALLS[m.ball].zh}收服</p>`;
    d.querySelector('.big').append(this.thumb(m.species, { shiny: m.shiny, size: 96 }));
    return root;
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
      if (d?.seen) cell.prepend(this.thumb(s.id, { size: 40, variant: d.caught ? 'color' : 'dark' }));
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
        <p class="flavor">${esc(s.flavor)}${s.flavorOfficial ? '' : '<br><small>（非官方翻譯）</small>'}</p>` : '<p class="hint">抓到之後就能看到更多資料。</p>'}
      <div class="hint">出沒：${esc(SPOTS[this.habitatOf(id)].zh)}</div>
      <div class="hint">遇見 ${d.seen} 次・捕獲 ${d.caught} 次${d.shiny ? `・色違 ${d.shiny} 次` : ''}</div>
      ${d.shiny ? `<button data-act="shinyview" class="${shinyView ? 'sel' : ''}">✦ ${shinyView ? '看一般的樣子' : '看色違的樣子'}</button>` : known ? '<div class="hint">色違：還沒遇過</div>' : ''}`;
    entry.querySelector('.big').append(this.thumb(id, { size: 96, variant: known ? 'color' : 'dark', shiny: shinyView }));
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
      ${this.game.state.zygardeCells ? `<h4>其他</h4><div class="cells"></div>` : ''}</div>`);
    const balls = root.querySelector('.balls');
    for (const b of BALL_ORDER) {
      const el = h(`<div class="item"><span>${BALLS[b].zh}</span><b>×${bag.balls[b]}</b></div>`);
      el.prepend(pixelImg(art.balls[b], 2));
      balls.append(el);
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
    if (t.matches('.row[data-uid]')) { this.selectedUid = t.dataset.uid; this.audio.sfx('click'); this.renderPanel(); return; }
    if (t.dataset.dex) {
      const id = Number(t.dataset.dex);
      if (this.game.state.dex[id]?.seen) { this.selectedDex = id; this.audio.sfx('click'); this.renderPanel(); }
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
    this.onSettings?.();
  }

  onPanelInput(e) {
    const t = e.target;
    if (t.dataset.set && t.type === 'range') { this.game.state.settings[t.dataset.set] = Number(t.value); this.onSettings?.(); }
  }

  toggleQuiet(force) {
    const q = force ?? !this.game.state.settings.quiet;
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
    this.renderBubble();
    this.bubble.classList.remove('hidden');
    this.audio.sfx('click');
  }

  renderBubble() {
    const pet = this.bubblePet, m = pet.mon;
    const evo = this.game.evolutionStatus(m.uid);
    const n = hearts(m.affection);
    this.bubble.innerHTML = `<div class="name">${esc(this.game.displayName(m))} <span class="hearts">${'♥'.repeat(n)}<i>${'♥'.repeat(5 - n)}</i></span></div>
      <div class="btns"><button data-act="feed">餵泡芙</button><button data-act="info">看看牠</button><button data-act="recall">回球裡</button>
      ${evo?.ready ? '<button class="primary" data-act="evolve">✦ 進化</button>' : ''}</div>`;
  }

  onBubbleClick(e) {
    const act = e.target.closest('button')?.dataset.act;
    const pet = this.bubblePet;
    if (!act || !pet) return;
    this.audio.sfx('click');
    if (act === 'feed') { this.closeBubble(); this.openPuffPicker(key => this.director.feedMode(key, 'pet')); }
    if (act === 'info') { this.selectedUid = pet.uid; this.closeBubble(); this.open('party'); }
    if (act === 'recall') { this.closeBubble(); this.game.setOut(pet.uid, false); }
    if (act === 'evolve') this.director.startEvolution(pet);
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
