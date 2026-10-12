// 卡洛斯旅行的畫面：只演出、不算數值（規則都在 core/journey.js）。
// 存檔在 WebView 的 localStorage；Android 外殼有 KalosNative 時另外備份一份到 app 自己的資料夾、提供計步器的步數。
import { createDex } from '../core/dex.js';
import { createRng } from '../core/rng.js';
import * as J from '../core/journey.js';
import { moveHint, HP } from '../core/battle.js';
import { hearts } from '../core/amie.js';
import { timeOfDay } from '../core/encounter.js';
import { RING_MIN } from '../core/capture.js';
import { AudioEngine } from '../renderer/audio/audio.js';

const SAVE_KEY = 'kalos-journey';
const SPRITE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const now = () => (typeof window.__clock === 'function' ? window.__clock() : Date.now()); // 測試用假時鐘
const native = window.KalosNative ?? null;

let dex, S, rng, audio = null;
let busy = false; // 對話、動畫進行中：按鈕不反應
const $ = sel => document.querySelector(sel);
const screen = () => $('#screen');

// ---------- 小工具 ----------
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}
const button = (text, onclick, attrs = {}) => el('button', { type: 'button', text, onclick: () => { if (!busy) onclick(); }, ...attrs });

function sprite(species, { back = false, shiny = false, cls = '' } = {}) {
  const path = `${back ? 'back/' : ''}${shiny ? 'shiny/' : ''}${species}.png`;
  const img = el('img', { class: `sprite ${cls}`, src: `${SPRITE}/${path}`, alt: dex.name(species), draggable: 'false' });
  img.addEventListener('error', () => { img.classList.add('missing'); }, { once: true });
  return img;
}
const monName = m => m.nick ?? dex.name(m.species);
const typeTags = species => dex.get(species).types.map(t => el('span', { class: `type t-${t}`, text: dex.typeName(t) }));
function hpBar(hp, { id } = {}) {
  const bar = el('span', { class: 'hp', ...(id ? { id } : {}) }, el('i'));
  setHp(bar, hp); // CSP 不准 style 屬性，寬度用 element.style 設
  return bar;
}
function setHp(bar, hp) {
  const i = bar.querySelector('i');
  const pct = Math.max(0, Math.min(100, hp / HP * 100));
  i.style.width = `${pct}%`;
  i.className = pct > 50 ? 'ok' : pct > 20 ? 'mid' : 'low';
}
const heartStr = aff => '♥'.repeat(hearts(aff)) + '♡'.repeat(5 - hearts(aff));
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------- 對話框：點一下換下一句 ----------
function say(...lines) {
  return lines.flat().filter(Boolean).reduce((p, line) => p.then(() => new Promise(resolve => {
    const box = $('#msg');
    box.hidden = false;
    $('#msgText').textContent = line;
    busy = true;
    const next = () => { box.removeEventListener('click', next); box.hidden = true; busy = false; resolve(); };
    setTimeout(() => box.addEventListener('click', next), 120); // 避免同一下點擊直接跳過
  })), Promise.resolve());
}

// ---------- 存檔 ----------
function save() {
  J.touch(S, now());
  const json = JSON.stringify(S);
  try { localStorage.setItem(SAVE_KEY, json); } catch { /* 存不進去就算了，下面還有備份 */ }
  try { native?.save?.(json); } catch { /* 沒有外殼（瀏覽器）就沒有備份 */ }
}
function load() {
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { /* 讀不到 */ }
  if (!raw) { try { raw = native?.load?.() || null; } catch { /* 沒有備份 */ } }
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  return parsed ? J.normalizeJourney(parsed, now()) : null;
}

// ---------- 聲音（原創 chiptune，桌面版的同一套） ----------
let muted = false;
try { muted = localStorage.getItem('kalos-journey-muted') === '1'; } catch { /* 預設開 */ }
function sound() {
  if (muted) return null;
  try {
    audio ??= new AudioEngine();
    audio.setVolumes({ music: 0.5, sfx: 0.7, muted: false });
    audio.resume();
  } catch { audio = null; }
  return audio;
}
function music(name) { const a = sound(); if (a) { if (name) a.playSong(name); else a.stopSong(); } }
function jingle(name) { sound()?.jingle(name); }
function renderMute() { $('#mute').textContent = muted ? '♪̸' : '♪'; $('#mute').classList.toggle('off', muted); }

// ---------- 上面那一條：在哪裡、現在幾點 ----------
const TOD = { morning: '清晨', day: '白天', dusk: '黃昏', night: '夜晚' };
function renderTop() {
  $('#where').textContent = S?.party.length ? J.here(S).zh : '卡洛斯旅行';
  const d = new Date(now());
  $('#when').textContent = `${TOD[timeOfDay(d.getHours())]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------- 開場、選夥伴 ----------
async function intro() {
  screen().replaceChildren(el('div', { class: 'title' }, el('h1', { text: '卡洛斯旅行' }), el('p', { text: '布拉塔諾博士的研究所' })));
  await say('喂？聽得到嗎？我是卡洛斯地區的寶可夢博士，布拉塔諾。',
    '聽說你要出發去旅行了。旅行不用趕──你過你的日子，寶可夢會陪著你。',
    '你真的走路的時候，帶頭的夥伴也會跟著走、跟你更要好。',
    '那麼，先選一隻夥伴吧！');
  const pick = species => async () => {
    J.chooseStarter(S, species, dex, now(), rng);
    save();
    jingle('newEntry');
    await say(`${dex.name(species)}成為了你的夥伴！`, '往前走就是 2 號道路。路上的事慢慢來，隨時都可以關掉，下次從這裡繼續。');
    renderArea();
  };
  screen().replaceChildren(el('div', { class: 'starters' },
    el('h2', { text: '選一隻最初的夥伴' }),
    ...J.STARTERS.map(id => el('button', { type: 'button', class: 'starter', 'data-species': id, onclick: () => { if (!busy) pick(id)(); } },
      sprite(id), el('b', { text: dex.name(id) }), el('span', { class: 'types' }, typeTags(id)), el('small', { text: dex.get(id).genus })))));
}

// ---------- 地圖上 ----------
const todNow = () => timeOfDay(new Date(now()).getHours());

function leadCard() {
  const m = S.party[0];
  const a = J.here(S);
  return el('div', { class: 'lead' },
    el('div', { class: `scene tod-${todNow()} k-${a.kind}` }, sprite(m.species, { shiny: m.shiny, cls: 'bob' })),
    el('div', { class: 'stats' },
      el('b', { text: `${monName(m)}  Lv.${J.levelOf(m)}` }),
      hpBar(m.hp),
      el('span', { class: 'hearts', text: heartStr(m.affection) }),
      el('small', { text: S.steps.today ? `今天一起走了 ${S.steps.today} 步` : '帶頭的夥伴會跟你一起走路' })));
}

function renderArea() {
  music(null);
  renderTop();
  const a = J.here(S);
  const ctx = J.lifeCtx(now());
  const next = J.nextArea(S), prev = J.prevArea(S);
  const blocked = J.blockedBy(S);
  const kids = [leadCard()];
  if (a.kind === 'route') {
    const dots = el('div', { class: 'dots', 'aria-label': `走了 ${Math.min(S.node, a.nodes)}／${a.nodes}` },
      [...Array(a.nodes)].map((_, i) => el('i', { class: i < S.node ? 'done' : '' })));
    kids.push(dots, el('p', { class: 'moods', text: J.moods(ctx, dex).slice(0, 2).join('｜') }));
    kids.push(S.node < a.nodes
      ? button('往前走', walk, { id: 'walk', class: 'primary' })
      : button('在這裡逛逛', walk, { id: 'walk', class: 'primary' }));
    if (!blocked && next) kids.push(button(`前往 ${next.zh}`, () => travel('forward'), { id: 'forward', class: 'primary' }));
  } else {
    kids.push(el('p', { class: 'line', text: a.line }));
    if (a.gym) {
      const won = S.badges.includes(a.gym.badge);
      kids.push(button(won ? `${a.gym.zh}（已拿到${J.BADGE_ZH[a.gym.badge]}）` : `挑戰道館：${a.gym.zh}`, gym, { id: 'gym', class: 'primary', disabled: won }));
    }
    if (next) kids.push(button(blocked === 'gym' ? `前往 ${next.zh}（要先拿到徽章）` : `前往 ${next.zh}`, () => travel('forward'), { id: 'forward', class: 'primary', disabled: Boolean(blocked) }));
    else kids.push(el('p', { class: 'line soon', text: '再往前的路還在整理中，下一版就能走了。可以回頭抓寶可夢、練等級。' }));
  }
  if (prev) kids.push(button(`回到 ${prev.zh}`, () => travel('back'), { id: 'back' }));
  kids.push(el('nav', { class: 'menu' },
    button('隊伍', renderParty, { id: 'nav-party' }),
    button('背包', () => renderBag(), { id: 'nav-bag' }),
    button(`圖鑑 ${Object.values(S.dex).filter(d => d.caught).length}/72`, renderDex, { id: 'nav-dex' })));
  if (S.badges.length) kids.push(el('p', { class: 'badges', text: S.badges.map(b => J.BADGE_ZH[b]).join('・') }));
  screen().replaceChildren(el('div', { class: `area ${a.kind}` }, kids));
}

async function travel(dir) {
  const a = dir === 'forward' ? J.goForward(S) : J.goBack(S);
  if (!a) return;
  save();
  renderArea();
  if (a.kind === 'town') await say(`到了${a.zh}。`, '寶可夢中心幫你的隊伍恢復了精神。');
}

const QUIET = {
  morning: ['早上的空氣涼涼的。', '露水在草葉上閃閃發亮。'],
  day: ['陽光很好，夥伴伸了個懶腰。', '遠處有人在野餐。'],
  dusk: ['天空變成橘色的了。', '夥伴停下來看了一會兒夕陽。'],
  night: ['四周很安靜，只聽得到蟲叫聲。', '夥伴緊緊跟在你旁邊。'],
};

async function walk() {
  if (!J.canFight(S)) return;
  screen().querySelector('.scene')?.classList.add('walking');
  await wait(350);
  const e = J.step(S, dex, rng, J.lifeCtx(now()));
  save();
  renderArea();
  if (!e) return;
  if (e.kind === 'quiet') await say(rng.pick(QUIET[todNow()]));
  else if (e.kind === 'item') { jingle('gift'); await say(`撿到了${J.ITEMS[e.item].zh}！`); }
  else if (e.kind === 'wild') {
    await say(`${e.wild.spot}裡跳出了野生的${dex.name(e.wild.species)}！${e.wild.shiny ? '（閃閃發光！）' : ''}`);
    await battle(J.wildBattle(S, e.wild));
  } else if (e.kind === 'trainer') {
    await say(`${e.trainer.zh}想要跟你對戰！`);
    await battle(J.trainerBattle(S, e.trainer));
  }
  renderArea();
  if (J.here(S).kind === 'route' && S.node === J.here(S).nodes && !e.wander) await say('這條路走到底了。休息一下、或繼續往前，都可以。');
}

async function gym() {
  const g = J.here(S).gym;
  const lines = J.GYM_LINES[g.leader];
  await say(lines.intro.map(l => `${g.zh}：${l}`));
  const b = J.gymBattle(S);
  const result = await battle(b);
  if (result === 'win') { jingle('caught'); await say(lines.win.map(l => `${g.zh}：${l}`), `你得到了${J.BADGE_ZH[g.badge]}！`); }
  renderArea();
}

// ---------- 對戰 ----------
let B = null; // 進行中的對戰（畫面用）
function battle(b) {
  if (!b) return Promise.resolve(null);
  B = b;
  music('wild');
  return new Promise(resolve => { b.resolve = resolve; renderBattle(); });
}

function renderBattle(mode = 'moves') {
  const b = B;
  const me = J.activeMon(S, b), foe = J.foeOf(b);
  const v = J.battleView(S, b, dex);
  const foeSide = el('div', { class: 'side foe' },
    el('div', { class: 'panel' }, el('b', { text: `${dex.name(foe.species)}  Lv.${J.levelOf(foe)}` }), hpBar(foe.hp, { id: 'foe-hp' }),
      b.kind !== 'wild' ? el('small', { text: `${b.zh}　剩 ${b.foes.length - b.foeIdx} 隻` }) : (S.dex[foe.species]?.caught ? el('small', { text: '◓ 抓過了' }) : null)),
    sprite(foe.species, { shiny: foe.shiny, cls: 'front' }));
  const meSide = el('div', { class: 'side me' },
    sprite(me.species, { back: true, shiny: me.shiny, cls: 'back' }),
    el('div', { class: 'panel' }, el('b', { text: `${monName(me)}  Lv.${J.levelOf(me)}` }), hpBar(me.hp, { id: 'me-hp' }), el('small', { text: `${Math.ceil(me.hp)}/${HP}` })));
  let actions;
  if (b.needSwitch || mode === 'switch') actions = switchMenu(b);
  else if (mode === 'bag') actions = bagMenu(b);
  else actions = el('div', { class: 'actions' },
    el('div', { class: 'moves' }, v.me.moves.map(m => {
      const h = moveHint(m, v.foe);
      return button(m.zh, () => act(() => J.useMove(S, b, m.id, dex, rng)), { class: `move t-${m.type}`, 'data-move': m.id, 'data-hint': h.zh || null });
    })),
    el('div', { class: 'row' },
      button('背包', () => renderBattle('bag'), { id: 'b-bag' }),
      button('換人', () => renderBattle('switch'), { id: 'b-switch', disabled: S.party.filter(m => m.hp > 0).length < 2 }),
      button('逃跑', () => act(() => J.run(S, b)), { id: 'b-run', disabled: b.kind !== 'wild' })));
  screen().replaceChildren(el('div', { class: `battle k-${b.kind}` }, el('div', { class: `arena tod-${todNow()}` }, foeSide, meSide), actions));
}

function switchMenu(b) {
  return el('div', { class: 'actions list' },
    el('p', { text: b.needSwitch ? '要換誰上場？' : '換誰上場？' }),
    S.party.map(m => button(`${monName(m)} Lv.${J.levelOf(m)}  ${Math.ceil(m.hp)}/${HP}`, () => act(() => J.switchTo(S, b, m.uid, dex, rng)),
      { class: 'mon', 'data-uid': m.uid, disabled: m.hp <= 0 || m.uid === b.active })),
    b.needSwitch ? null : button('取消', () => renderBattle(), { id: 'b-cancel' }));
}

function bagMenu(b) {
  const me = J.activeMon(S, b);
  const items = Object.entries(S.bag).filter(([id]) => (b.kind === 'wild' || !J.ITEMS[id].ball));
  return el('div', { class: 'actions list' },
    items.length ? items.map(([id, n]) => {
      const it = J.ITEMS[id];
      const use = it.ball ? () => throwRing(b, id) : () => act(() => J.useItem(S, b, id, me.uid, dex, rng));
      return button(`${it.zh} ×${n}`, use, { class: 'item', 'data-item': id, disabled: Boolean(it.heal && me.hp >= HP) });
    }) : el('p', { text: '背包裡沒有可以用的東西。' }),
    button('取消', () => renderBattle(), { id: 'b-cancel' }));
}

// 丟球：目標圈一直縮放，圈越小的時候點下去越好抓（跟桌面一樣）
function throwRing(b, item) {
  const foeImg = screen().querySelector('.side.foe .sprite');
  const ring = el('div', { class: 'ring', id: 'ring' });
  const wrap = el('div', { class: 'ringwrap', id: 'ringwrap' }, ring, el('p', { text: '圈變小的時候點一下！' }));
  screen().querySelector('.battle').append(wrap);
  foeImg?.classList.add('target');
  const t0 = performance.now();
  let size = 1, raf = 0;
  const tick = t => {
    size = RING_MIN + (1 - RING_MIN) * (0.5 + 0.5 * Math.cos((t - t0) / 1400 * Math.PI * 2)); // 1.4 秒一個來回
    ring.style.transform = `scale(${size})`;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  wrap.addEventListener('click', () => {
    cancelAnimationFrame(raf);
    const r = window.__ring ?? size; // 測試可以固定圈的大小
    act(() => J.throwBall(S, b, item, r, dex, rng, now()));
  }, { once: true });
}

// 執行一個動作，照回傳的事件一個一個演
async function act(fn) {
  if (busy) return;
  const b = B;
  const shown = { me: J.activeMon(S, b)?.hp ?? 0, foe: J.foeOf(b).hp };
  const events = fn();
  if (!events.length) return renderBattle();
  busy = true;
  renderBattleFrozen(b);
  busy = false;
  for (const e of events) await play(e, b, shown);
  save();
  if (b.over) return finish(b);
  renderBattle();
}

// 演出時畫面先停在出手前的樣子（血條再一格一格掉）
function renderBattleFrozen(b) {
  const acts = screen().querySelector('.actions');
  if (acts) acts.replaceChildren();
  screen().querySelector('#ringwrap')?.remove();
}

const EFF = e => (e === 0 ? '好像沒有效果……' : e > 1 ? '效果絕佳！' : e < 1 ? '效果不太好……' : null);
async function play(e, b, shown) {
  const meName = () => monName(J.activeMon(S, b));
  const foeName = () => `${b.kind === 'wild' ? '野生的' : '對手的'}${dex.name(J.foeOf(b).species)}`;
  if (e.move) {
    const who = e.who === 'me' ? meName() : foeName();
    if (e.kind === 'status') return say(`${who}使出了${e.move.zh}！`, e.effect === 'guard' ? '擺出了防守姿態。' : e.effect === 'boost' ? '力量提升了！' : '對手的力量下降了！');
    if (e.kind === 'dodge') return say(`${who}使出了${e.move.zh}！`, `${meName()}靈巧地躲開了！`);
    const target = e.who === 'me' ? 'foe' : 'me';
    shown[target] = Math.max(0, shown[target] - e.dmg);
    const bar = $(`#${target}-hp`);
    screen().querySelector(`.side.${target} .sprite`)?.classList.add('hit');
    if (bar) setHp(bar, shown[target]);
    return say(`${who}使出了${e.move.zh}！`, e.crit ? '擊中了要害！' : null, EFF(e.eff), e.endure ? `${meName()}為了你撐住了！` : null);
  }
  switch (e.kind) {
    case 'faint': return say(e.who === 'foe' ? `${foeName()}倒下了！` : `${meName()}倒下了……`);
    case 'xp': return say(`${monName(S.party.find(m => m.uid === e.uid))}得到了 ${e.gain} 點經驗。`, e.up ? `升到了 Lv.${e.lv}！` : null);
    case 'next': shown.foe = HP; renderBattle(); renderBattleFrozen(b); return say(`對手派出了${dex.name(e.species)}！`);
    case 'switch': shown.me = J.activeMon(S, b).hp; renderBattle(); renderBattleFrozen(b); return say(`去吧，${meName()}！`);
    case 'heal': { shown.me = Math.min(HP, shown.me + e.gain); const bar = $('#me-hp'); if (bar) setHp(bar, shown.me); return say(`用了${J.ITEMS[e.item].zh}，恢復了 ${e.gain} 點。`); }
    case 'throw': {
      const shakes = ['', '搖了一下……', '搖了兩下……', '搖了三下……'];
      await say(`丟出了${J.ITEMS[e.item].zh}！${e.bonus ?? ''}`);
      for (let i = 1; i <= e.shakes; i++) await say(shakes[i]);
      return e.caught ? null : say(e.shakes ? '啊！差一點就抓到了！' : '寶可夢從球裡跑出來了！');
    }
    case 'caught': { jingle('caught'); const m = [...S.party, ...S.box].find(x => x.uid === e.uid); return say(`抓到了${dex.name(m.species)}！`, e.toBox ? '隊伍滿了，送到電腦的箱子裡。' : `${dex.name(m.species)}加入了隊伍。`); }
    case 'fled': return say(`${foeName()}逃走了……`);
    case 'ran': return say('順利逃走了。');
    case 'badge': return null; // 道館那邊說
    case 'win': return b.kind === 'trainer' ? say(`打贏了${b.zh}！`) : null;
    case 'lose': return say('眼前一片漆黑……', `回到了${J.AREA_BY_ID[e.town].zh}的寶可夢中心，隊伍恢復了精神。`);
    default: return null;
  }
}

async function finish(b) {
  music(null);
  const result = b.over;
  B = null;
  for (const ev of J.evolutions(S, dex, J.lifeCtx(now()))) {
    const m = S.party.find(x => x.uid === ev.uid);
    await say(`咦？${monName(m)}的樣子……`);
    jingle('evolved');
    J.evolve(S, ev.uid, ev.to, dex);
    await say(`恭喜！${dex.name(ev.from)}進化成了${dex.name(ev.to)}！`);
  }
  save();
  if (result !== 'win' || b.kind !== 'gym') renderArea();
  b.resolve(result);
}

// ---------- 隊伍、背包、圖鑑 ----------
function back() { return button('返回', renderArea, { id: 'close', class: 'close' }); }

function renderParty() {
  screen().replaceChildren(el('div', { class: 'party' },
    el('h2', { text: '隊伍' }), el('p', { class: 'hint', text: '點一隻讓牠帶頭：帶頭的夥伴跟你一起走路、最先上場。' }),
    S.party.map((m, i) => el('button', { type: 'button', class: `mon${i === 0 ? ' first' : ''}`, 'data-uid': m.uid, onclick: () => { if (busy) return; S.party.splice(i, 1); S.party.unshift(m); save(); renderParty(); } },
      sprite(m.species, { shiny: m.shiny }),
      el('span', {}, el('b', { text: `${monName(m)} Lv.${J.levelOf(m)}` }), el('span', { class: 'types' }, typeTags(m.species)), hpBar(m.hp), el('small', { text: `${heartStr(m.affection)}　下一級還要 ${J.xpForLevel(J.levelOf(m) + 1) - m.xp}` })))),
    S.box.length ? el('p', { class: 'hint', text: `箱子裡還有 ${S.box.length} 隻（下一版可以換）` }) : null,
    back()));
}

function renderBag(msg) {
  const lead = S.party[0];
  const rows = Object.entries(S.bag).map(([id, n]) => {
    const it = J.ITEMS[id];
    return el('li', {}, el('span', { text: `${it.zh} ×${n}` }),
      it.heal ? button(`給${monName(lead)}`, async () => {
        const ev = J.useItem(S, null, id, lead.uid, dex, rng);
        if (!ev.length) return;
        save(); renderBag(); await say(`${monName(lead)}恢復了 ${ev[0].gain} 點。`);
      }, { class: 'use', 'data-item': id, disabled: lead.hp >= HP || lead.hp <= 0 }) : null);
  });
  screen().replaceChildren(el('div', { class: 'bag' }, el('h2', { text: '背包' }), rows.length ? el('ul', {}, rows) : el('p', { text: '空空的。' }), msg ? el('p', { text: msg }) : null, back()));
}

function renderDex() {
  const cells = dex.ids.map(id => {
    const d = S.dex[id];
    return el('div', { class: `cell${d?.caught ? ' caught' : d?.seen ? ' seen' : ''}`, title: d ? dex.name(id) : '？？？' },
      d ? sprite(id) : el('span', { text: '?' }), el('small', { text: String(id) }));
  });
  const caught = Object.values(S.dex).filter(d => d.caught).length, seen = Object.values(S.dex).filter(d => d.seen).length;
  screen().replaceChildren(el('div', { class: 'dex' }, el('h2', { text: `圖鑑　看過 ${seen}・抓到 ${caught}` }), el('div', { class: 'grid' }, cells), back()));
}

// ---------- 打開 app：走了多少路、不在的時候夥伴找到了什麼 ----------
function readSteps() {
  try { const n = native?.steps?.(); return Number.isFinite(n) && n >= 0 ? n : null; } catch { return null; }
}
async function greet() {
  const steps = readSteps();
  const walked = steps === null ? null : J.addSteps(S, steps, now());
  const back = J.welcomeBack(S, now(), rng);
  save();
  renderArea();
  const lead = S.party[0];
  const lines = [];
  if (walked?.walked) lines.push(`你走了 ${walked.walked} 步，${monName(lead)}一路跟著你。`, walked.up ? `${monName(lead)}升到了 Lv.${J.levelOf(lead)}！` : null);
  if (back.gifts.length) {
    const count = {};
    for (const g of back.gifts) count[g] = (count[g] ?? 0) + 1;
    lines.push(`你不在的時候，${monName(S.party.find(m => m.uid === back.finder) ?? lead)}在附近找到了：`, Object.entries(count).map(([id, n]) => `${J.ITEMS[id].zh} ×${n}`).join('、'));
  }
  if (lines.length) await say(lines);
}

// 計步器打開後第一次有數字（Android 外殼呼叫）：打開 app 那一刻可能還讀不到
window.__kalosSteps = async () => {
  if (!S?.party.length || busy || B) return;
  const n = readSteps();
  const r = n === null ? null : J.addSteps(S, n, now());
  if (!r?.walked) { save(); return; }
  save();
  if (screen().querySelector('.area')) renderArea();
  const lead = S.party[0];
  await say(`你走了 ${r.walked} 步，${monName(lead)}一路跟著你。`, r.up ? `${monName(lead)}升到了 Lv.${J.levelOf(lead)}！` : null);
};

// 開著的時候也會走路：每 30 秒看一次計步器
function watchSteps() {
  setInterval(() => {
    if (document.hidden || busy || B) return;
    const n = readSteps();
    if (n === null) return;
    const r = J.addSteps(S, n, now());
    if (r?.walked) { save(); if (screen().querySelector('.area')) renderArea(); }
  }, 30_000);
}

async function main() {
  const data = await (await fetch('../../data/kalos.json')).json();
  dex = createDex(data);
  rng = createRng(window.__seed ?? (now() ^ 0x5bd1e995));
  S = load() ?? J.newJourney(now(), rng.int(1, 1e9));
  $('#mute').addEventListener('click', () => {
    muted = !muted;
    try { localStorage.setItem('kalos-journey-muted', muted ? '1' : '0'); } catch { /* 只是這次 */ }
    if (muted) audio?.stopSong();
    renderMute();
  });
  renderMute();
  renderTop();
  setInterval(renderTop, 20_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.party.length && !B && !busy) greet(); else if (document.hidden) save(); });
  if (!S.party.length) await intro();
  else await greet();
  watchSteps();
  document.body.dataset.ready = '1';
}

main().catch(err => {
  screen().replaceChildren(el('p', { class: 'error', text: `出了點問題：${err?.message ?? err}` }));
  throw err;
});
