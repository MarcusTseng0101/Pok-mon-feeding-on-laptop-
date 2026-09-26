// 手機頁面：每分鐘讀一次 data.json（電腦上的 app 畫好的摘要），畫出來。
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

function render(d) {
  const today = [];
  if (Number.isFinite(d.daysTogether)) today.push(`我們認識第 ${d.daysTogether} 天`);
  if (d.mood) today.push(`今天 ${d.mood.emoji} ${d.mood.zh}`);
  for (const h of d.holidays ?? []) today.push(`今天是${h}`);
  $('.today').textContent = today.join('・');

  fill('pets', (d.pets ?? []).map(p => {
    const e = el('div', 'pet');
    const img = pic(d, p.pic);
    if (img) e.append(img);
    const t = el('div');
    t.append(el('b', '', p.name), el('span', 'hearts', ` ${'♥'.repeat(p.hearts ?? 0)}`), el('small', '', p.species));
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
    $('.status').textContent = '連不到電腦（電腦關機、app 沒開，或手機不在同一個網路）';
  }
}

load();
setInterval(load, 60_000);
