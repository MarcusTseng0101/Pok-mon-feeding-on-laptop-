// 手機頁面：每分鐘讀一次 data.json（電腦上的 app 畫好的摘要），畫出來。
// 內容一律用 textContent（夥伴的暱稱是你自己打的字，不能當成 HTML）。
// 打卡（我吃飯了、我喝水了…）：按下去送 POST act（src/main/phone.js），牠馬上跟著做一樣的事；算不算、加多少都由電腦決定（core/checkin.js）。
// 牠們從不向你要求打卡：沒有提醒、不記你幾天沒打、不打也不會怎樣。
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

// 打卡的 id：手機產生，重送也只算一次。用 getRandomValues（crypto.randomUUID 在 http 的頁面不能用）
const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
let last = null; // 最近一次的摘要（打卡的回應要用夥伴的圖）
// 打卡的區塊放在「跟你出門中」下面（index.html 不用改：這裡自己建）
{
  const s = el('section', 'checkin empty');
  s.append(el('h2', '', '我現在…'), el('div', 'buttons'), el('div', 'reply'));
  $('section.outing').after(s);
}
let visited = false;

async function send(kind) {
  const res = await fetch('act', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id: newId(), at: Date.now() }) });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

// 牠的回應：小圖做一樣的動作＋一句話（「咕咕鴿也喝了一口水」）
function reply(r) {
  const box = $('section.checkin .reply');
  if (!r?.ok || !r.line) { box.replaceChildren(el('span', 'line', '電腦那邊好像在忙，等一下再按一次')); return; }
  const kids = [];
  const img = last && r.pic ? pic(last, r.pic) : null;
  if (img) { img.classList.add(`do-${/^[a-z]+$/.test(r.anim ?? '') ? r.anim : 'munch'}`); kids.push(img); }
  kids.push(el('span', 'line', r.line));
  box.replaceChildren(...kids);
}

function checkinButtons(d) {
  const s = $('section.checkin'), row = s.querySelector('.buttons');
  const list = Array.isArray(d.checkins) ? d.checkins : [];
  s.classList.toggle('empty', list.length === 0);
  const key = list.map(c => `${c.id}:${c.zh}`).join('|');
  if (row.dataset.key === key) return;
  row.dataset.key = key;
  row.replaceChildren(...list.map(c => {
    const b = el('button', '', c.zh);
    b.type = 'button';
    b.dataset.kind = c.id;
    b.onclick = async () => {
      b.disabled = true;
      try { reply(await send(c.id)); load(); } catch { reply(null); }
      setTimeout(() => { b.disabled = false; }, 800);
    };
    return b;
  }));
}

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
  checkinButtons(d);
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
    const d = await res.json();
    render(d);
    // 打開手機頁面＝想念（一次；電腦那邊 2 小時才算一次）
    if (!visited && Array.isArray(d.checkins)) { visited = true; send('visit').then(r => { if (r?.ok && r.line) $('section.checkin .reply').replaceChildren(el('span', 'line', r.line)); }).catch(() => {}); }
  } catch {
    $('.status').textContent = '連不到電腦（電腦關機、app 沒開，或手機不在同一個網路）';
  }
}

load();
setInterval(load, 60_000);
