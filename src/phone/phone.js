// 手機頁面：每分鐘讀一次 data.json（電腦上的 app 畫好的摘要），畫出來。
// 在家的夥伴有自己的生活（core/life.js）：摘要裡帶著往後 24 小時每 10 分鐘在做什麼，這裡照現在的時間查表。
// 連不到電腦的時候也每分鐘重新查一次，牠們照樣過日子。
// 內容一律用 textContent（夥伴的暱稱是你自己打的字，不能當成 HTML）。
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const date = t => new Date(t).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
const time = t => new Date(t).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const safeImg = src => (typeof src === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(src) ? src : null);

function pic(d, key) {
  const src = safeImg(d.pics?.[key]);
  if (!src) return null;
  const img = el('img', 'pic');
  img.src = src;
  img.alt = '';
  return img;
}

function fill(section, items) {
  const s = $(`section.${section}`), list = s.querySelector('.list');
  list.replaceChildren(...items);
  s.classList.toggle('empty', items.length === 0);
}

// 現在在做什麼：{ code, zh }（查不到——例如超過 24 小時沒連上——就是 null）
const LIFE_ANIM = { s: 'sleep', n: 'sleep', d: 'munch', e: 'munch', r: 'nod', p: 'hop', w: 'sway' };
function lifeNow(life) {
  if (!life || typeof life.acts !== 'string' || !(life.slot > 0)) return null;
  const i = Math.floor((Date.now() - life.from) / life.slot);
  const code = i >= 0 && i < life.acts.length ? life.acts[i] : null;
  const zh = code && life.zh?.[code];
  return zh ? { code, zh } : null;
}

let last = null;
function render(d) {
  last = d;
  const today = [];
  if (Number.isFinite(d.daysTogether)) today.push(`我們認識第 ${d.daysTogether} 天`);
  if (d.mood) today.push(`今天 ${d.mood.emoji} ${d.mood.zh}`);
  for (const h of d.holidays ?? []) today.push(`今天是${h}`);
  $('.today').textContent = today.join('・');

  // 跟你出門的那隻（最上面）：出門多久、一句話（天氣是設定的城市，所以說「家裡那邊」）
  fill('outing', d.outing ? [d.outing].map(o => {
    const e = el('div', 'trip');
    const img = pic(d, o.pic);
    if (img) e.append(img);
    const t = el('div');
    const h = Math.floor(o.minutes / 60), m = o.minutes % 60;
    t.append(el('b', '', o.name), el('small', '', `出門 ${h ? `${h} 小時 ` : ''}${m} 分鐘`), el('span', 'line', o.line));
    e.append(t);
    return e;
  }) : []);
  fill('pets', (d.pets ?? []).map(p => {
    const e = el('div', 'pet');
    const now = lifeNow(p.life);
    const img = pic(d, p.pic);
    if (img) { if (now) img.classList.add(`do-${LIFE_ANIM[now.code] ?? 'sway'}`); e.append(img); }
    const t = el('div');
    t.append(el('b', '', p.name), el('span', 'hearts', ` ${'♥'.repeat(p.hearts ?? 0)}`), el('small', '', p.species));
    if (now) { e.dataset.act = now.code; t.append(el('span', 'act', now.zh)); }
    e.append(t);
    return e;
  }));
  fill('trips', (d.trips ?? []).map(p => {
    const e = el('div', 'trip');
    const img = pic(d, p.pic);
    if (img) e.append(img);
    const t = el('div');
    t.append(el('b', '', p.name), el('small', '', `去${p.place}，大約 ${time(p.returnAt)} 回來`));
    e.append(t);
    return e;
  }));
  fill('mail', (d.letters ?? []).map(l => {
    const e = el('details', `letter${l.opened ? '' : ' unread'}`);
    const s = el('summary');
    s.append(el('span', 'who', l.name), el('small', '', `${l.kind}・${date(l.at)}`));
    e.append(s, el('p', '', l.text));
    return e;
  }));
  fill('cards', (d.postcards ?? []).map(c => {
    const e = el('div', 'card');
    const src = safeImg(c.img);
    if (src) { const img = el('img'); img.src = src; img.alt = c.place; e.append(img); }
    const p = el('p');
    p.append(el('b', '', `${c.name}・${c.place}`), el('small', '', ` ${date(c.at)}`));
    e.append(p);
    if (c.diary) e.append(el('p', '', c.diary));
    return e;
  }));
  fill('miles', (d.milestones ?? []).map(m => {
    const e = el('span', 'mile', `✦ ${m.zh} `);
    e.append(el('small', '', date(m.at)));
    return e;
  }));
  $('.status').textContent = `更新於 ${time(d.at ?? Date.now())}・電腦上的 Kalos Amie 開著的時候才會更新`;
}

async function load() {
  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    render(await res.json());
  } catch {
    if (last) render(last); // 牠們照樣過日子：用上次的生活表查現在
    $('.status').textContent = '連不到電腦（電腦關機、app 沒開，或手機不在同一個網路）';
  }
}

load();
setInterval(load, 60_000);
