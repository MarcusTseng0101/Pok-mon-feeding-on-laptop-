// 拍照，一起做：你拍下你正在做的事 → 這支手機自己猜（COCO-SSD，模型在 vendor 資料夾，同一個小網站讀）→ 你按確認 → 牠當下就跟你一起做。
//
// 照片只在這支手機上（F30）：
// - 照片只畫進這頁的 canvas、存進這支手機的 IndexedDB；送到電腦的只有 JSON.stringify({ kind, id, at })（send 是這頁唯一會送 body 的地方）
// - 電腦那邊 1 KB 的上限本身就讓照片送不過去
// 猜的只是預選（F31）：一定要按「一起做」才送；選項永遠都在、跟預選一樣大；沒有信心 ≥ GUESS_MIN 的物件就不預選。
// 模型在你第一次按「📷」的時候才載入，不是一打開頁面就載。只用 WebGL，不行才用 CPU（不用 WebAssembly，CSP 不用放寬，F33）。
// 用到 phone.js 的 render、last（同一頁的全域）；phone.js 用 snapNow(name) 問「這隻現在是不是在跟你一起做事」。

// 偵測到的物件 → 你在做什麼（猜的，可調整）
const SNAP_OBJECTS = {
  drink: ['cup', 'bottle', 'wine glass'],
  read: ['book', 'laptop'],
  eat: ['bowl', 'sandwich', 'pizza', 'cake', 'donut', 'banana', 'apple', 'orange', 'broccoli', 'carrot', 'hot dog', 'spoon', 'fork'],
  rest: ['bed', 'couch'],
};
// 選項（跟 core/checkin.js 的 SNAPS 一樣的 id；這頁不載入 core，所以文字寫在這裡）
const SNAP_KINDS = [
// code：生活表（core/life.js 的 CODE）裡對應的字
  { id: 'drink', zh: '喝水', q: '在喝水？', code: 'd', minutes: 10 },
  { id: 'read', zh: '讀書', q: '在讀書？', code: 'r', minutes: 50 },
  { id: 'eat', zh: '吃飯', q: '在吃飯？', code: 'e', minutes: 10 },
  { id: 'rest', zh: '休息', q: '在休息？', code: 'n', minutes: 10 },
];
const GUESS_MIN = 0.5; // 信心幾分以上才預選（猜的，可調整）
const PHOTO_MAX = 640; // 照片縮到最長邊幾 px 再猜（也是存下來的大小）

// 偵測結果 [{ class, score }] → 預選哪一個（沒有信心就是 null）
function guessKind(found) {
  let best = null;
  for (const o of found ?? []) {
    if (!(o && o.score >= GUESS_MIN)) continue;
    const kind = Object.keys(SNAP_OBJECTS).find(k => SNAP_OBJECTS[k].includes(o.class));
    if (kind && (!best || o.score > best.score)) best = { kind, score: o.score };
  }
  return best;
}

// ---------- 以下只在手機頁面上跑 ----------
if (typeof document !== 'undefined') {
  const $s = s => document.querySelector(s);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const kindOf = id => SNAP_KINDS.find(k => k.id === id) ?? null;
  // 32 個十六進位字元（F25：不用 crypto.randomUUID，http 頁面沒有它）
  const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

  // 正在跟你一起做的事：{ name, kind, until }（只在記憶體；電腦收到以後，生活表裡也會有）
  let together = null; // 重新整理也記得（存在這支手機上），斷網時也一樣
  try { const t = JSON.parse(localStorage.getItem('kalos-snap-now')); if (t && typeof t.name === 'string' && Number.isFinite(t.until) && Date.now() < t.until) together = t; } catch { /* 沒有 */ }
  window.snapNow = name => {
    if (!together || together.name !== name || Date.now() >= together.until) return null;
    return { code: kindOf(together.kind).code, with: true };
  };

  // ---- 模型：第一次按「📷」才載入 ----
  let model = null, loading = null;
  const script = src => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.append(s); });
  function loadModel() {
    loading ??= (async () => {
      for (const f of ['tf-core.min.js', 'tf-converter.min.js', 'tf-backend-cpu.min.js', 'tf-backend-webgl.min.js', 'coco-ssd.min.js']) await script(f);
      try { await tf.setBackend('webgl'); } catch { /* 下面改用 CPU */ }
      if (tf.getBackend() !== 'webgl') await tf.setBackend('cpu');
      await tf.ready();
      // 完整網址：模型用它找同一個資料夾裡的 shard（只給 'model.json' 會去網站根目錄找）
      model = await cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: new URL('model.json', location.href).href });
      return model;
    })();
    loading.catch(() => { loading = null; });
    return loading;
  }

  // ---- 畫面 ----
  const box = $s('section.snap');
  const input = box.querySelector('input[type=file]');
  const panel = box.querySelector('.guess');
  const photo = box.querySelector('canvas.photo');
  const q = box.querySelector('.q');
  const opts = box.querySelector('.opts');
  const go = box.querySelector('button.go');
  const reply = box.querySelector('.reply');
  const done = box.querySelector('button.done');
  let pick = null;

  box.querySelector('label.shoot').addEventListener('click', () => { loadModel().catch(() => {}); });
  for (const k of SNAP_KINDS) {
    const b = mk('button', 'opt', k.zh);
    b.type = 'button';
    b.dataset.kind = k.id;
    b.addEventListener('click', () => choose(k.id));
    opts.append(b);
  }
  function choose(id) {
    pick = id;
    for (const b of opts.children) b.classList.toggle('pick', b.dataset.kind === id);
    go.disabled = !id;
  }

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    panel.hidden = false;
    reply.textContent = '';
    choose(null);
    q.textContent = '在看是什麼…';
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, PHOTO_MAX / Math.max(bmp.width, bmp.height));
    photo.width = Math.round(bmp.width * k);
    photo.height = Math.round(bmp.height * k);
    photo.getContext('2d').drawImage(bmp, 0, 0, photo.width, photo.height);
    bmp.close?.();
    let guess = null;
    try {
      await loadModel();
      guess = guessKind(await model.detect(photo, 10, 0.2));
    } catch { guess = null; }
    box.dataset.guess = guess?.kind ?? '';
    if (guess) { choose(guess.kind); q.textContent = kindOf(guess.kind).q; } else q.textContent = '你現在在做什麼？';
  });

  // 送到電腦：這頁唯一會送 body 的地方，body 只有 { kind, id, at }（F30）
  // 回傳電腦的回話；null＝現在送不到（斷網、電腦沒開、太多了）→ 之後再送
  async function post(a) {
    try {
      const res = await fetch('act', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: a.kind, id: a.id, at: a.at }) });
      if (res.status === 429 || res.status >= 500) return null;
      return res.ok ? await res.json() : { ok: false }; // 電腦說格式不對：不再送
    } catch { return null; }
  }

  // 斷網也能用：送不到的事排進佇列（只在這支手機上，最多 QUEUE_MAX 件），連上電腦就照順序送。
  // 每件都有自己的 id（電腦那邊去重，F18），重送不會多算；時間是你按下去的那一刻（電腦最多相信到 24 小時前，F19）
  const QUEUE = 'kalos-snap-queue', NOW = 'kalos-snap-now', QUEUE_MAX = 50; // 猜的，可調整
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* 存不了就算了 */ } },
  };
  const queued = () => store.get(QUEUE, []).filter(a => a && typeof a.kind === 'string' && /^[0-9a-f]{32}$/.test(a.id) && Number.isFinite(a.at));
  async function send(kind) {
    const a = { kind, id: newId(), at: Date.now() };
    if (queued().length) { store.set(QUEUE, [...queued(), a].slice(-QUEUE_MAX)); flush(); return null; } // 前面還有沒送的：照順序
    const r = await post(a);
    if (r === null) store.set(QUEUE, [...queued(), a].slice(-QUEUE_MAX));
    return r;
  }
  let flushing = false;
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      for (let q = queued(); q.length; q = queued()) {
        if ((await post(q[0])) === null) break;
        store.set(QUEUE, queued().filter(x => x.id !== q[0].id));
      }
    } finally { flushing = false; }
    box.dataset.queued = String(queued().length); // 測試用
  }
  window.snapFlush = flush; // phone.js 連上電腦的時候叫
  addEventListener('online', flush);
  const keepNow = () => store.set(NOW, together);

  // 跟你一起做的是哪一隻：跟你出門的那隻；沒出門就是在家、最親近的那隻（跟電腦一樣；電腦回話以後照電腦的）
  function buddy() {
    if (last?.outing) return last.outing;
    return [...(last?.pets ?? [])].sort((a, b) => (b.hearts ?? 0) - (a.hearts ?? 0))[0] ?? null;
  }

  go.addEventListener('click', async () => {
    if (!pick) return;
    const kind = pick, k = kindOf(kind), who = buddy();
    if (!who) { reply.textContent = '先在電腦上選好夥伴'; return; }
    together = { name: who.name, kind, until: Date.now() + k.minutes * 60_000 };
    keepNow();
    if (last) render(last);
    reply.textContent = `${who.name}跟你一起${k.zh}`;
    done.hidden = kind !== 'read';
    panel.hidden = true;
    keep(kind, who).catch(() => {});
    const r = await send(kind);
    if (r === null) reply.textContent = `${who.name}跟你一起${k.zh}（還沒送到家裡的電腦，連上就會送）`;
    if (r?.ok && r.name && together?.kind === kind) {
      together = { name: r.name, kind, until: Number.isFinite(r.until) ? r.until : together.until };
      keepNow();
      reply.textContent = r.line ?? reply.textContent;
      if (last) render(last);
    }
  });

  // 讀完了：牠伸個懶腰，回到自己的生活（不顯示倒數、不打分數）
  done.addEventListener('click', async () => {
    const name = together?.name;
    together = null;
    keepNow();
    done.hidden = true;
    if (last) render(last);
    reply.textContent = name ? `${name}伸了個懶腰` : '';
    await send('done');
  });

  // ---- 照片變成回憶（只在這支手機上） ----
  const DB = 'kalos-snap', STORE = 'photos';
  const db = () => new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const tx = async (mode, fn) => { const d = await db(); return new Promise((resolve, reject) => { const t = d.transaction(STORE, mode); const out = fn(t.objectStore(STORE)); t.oncomplete = () => resolve(out.result); t.onerror = () => reject(t.error); }); };
  const loadImg = src => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });

  // 把夥伴的小圖畫在照片右下角，加一行「一起喝水」
  async function keep(kind, who) {
    const c = document.createElement('canvas');
    c.width = photo.width; c.height = photo.height;
    const g = c.getContext('2d');
    g.drawImage(photo, 0, 0);
    const size = Math.round(Math.min(c.width, c.height) * 0.32);
    const src = last?.pics?.[who.pic];
    if (typeof src === 'string' && src.startsWith('data:image/png;base64,')) {
      g.imageSmoothingEnabled = false;
      g.drawImage(await loadImg(src), c.width - size - 8, c.height - size - 8, size, size);
    }
    const text = `${who.name} 一起${kindOf(kind).zh}`;
    g.font = `${Math.max(14, Math.round(c.height / 18))}px sans-serif`;
    g.fillStyle = 'rgba(255,255,255,.85)';
    const w = g.measureText(text).width;
    g.fillRect(8, c.height - Math.round(c.height / 18) - 20, w + 16, Math.round(c.height / 18) + 12);
    g.fillStyle = '#3a2e2a';
    g.fillText(text, 16, c.height - 16);
    const rec = { id: newId(), at: Date.now(), kind, name: who.name, url: c.toDataURL('image/jpeg', 0.85) };
    await tx('readwrite', s => s.put(rec));
    await album();
  }

  // 今天的小相簿：每張有「存到手機相簿」
  async function album() {
    const list = box.querySelector('.album');
    let all = [];
    try { all = await tx('readonly', s => s.getAll()); } catch { all = []; }
    const today = new Date().toDateString();
    const mine = all.filter(p => new Date(p.at).toDateString() === today && /^data:image\/jpeg;base64,/.test(p.url)).sort((a, b) => b.at - a.at);
    list.replaceChildren(...mine.map(p => {
      const e = mk('figure', 'memory');
      const img = mk('img'); img.src = p.url; img.alt = `${p.name} 一起${kindOf(p.kind)?.zh ?? ''}`;
      const a = mk('a', 'save', '存到手機相簿');
      a.href = p.url;
      a.download = `kalos-${new Date(p.at).toISOString().slice(0, 16).replace(/[-:T]/g, '')}.jpg`;
      e.append(img, a);
      return e;
    }));
    box.classList.toggle('has-album', mine.length > 0);
  }
  album();
  if (together?.kind === 'read') done.hidden = false;
  if (last) render(last);
  flush();
}
