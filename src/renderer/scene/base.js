// 秘密基地在舞台上的樣子：畫在最底層（寶可夢會走在上面），位置在螢幕左下或右下角。
//
// 滑鼠：只有「家具本身」點得到（點了可以移動它）；院子的空地、帳篷都點不到，
// 所以平常基地那一塊不會擋住你點底下的視窗。擺放模式（stage.mode.type === 'base'）才會攔截整個畫面。
import { blit } from '../gfx/pixel.js';
import * as gfx from '../gfx/basegfx.js';
import { GRID_W, GRID_H, FURNITURE, canPlace } from '../../core/base.js';

const CELL = gfx.CELL;

export class BaseView {
  constructor(stage, getBase) {
    this.stage = stage;
    this.getBase = getBase;
    this.yardCache = null;
  }

  get base() { return this.getBase(); }

  // 院子左上角（裝置像素）與大小
  layout() {
    const st = this.stage, S = st.S, b = this.base;
    const w = GRID_W * CELL * S, h = GRID_H * CELL * S;
    const x = b.side === 'right' ? st.W - w - 70 * S : 14 * S; // 右下角有選單按鈕：讓開一點
    const y = st.H - h - 8 * S;
    return { x, y, w, h, S };
  }

  cellRect(cx, cy, cw = 1, ch = 1) {
    const L = this.layout(), c = CELL * L.S;
    return { x: L.x + cx * c, y: L.y + cy * c, w: cw * c, h: ch * c };
  }

  cellAt(px, py) {
    const L = this.layout(), c = CELL * L.S;
    const cx = Math.floor((px - L.x) / c), cy = Math.floor((py - L.y) / c);
    return cx >= 0 && cy >= 0 && cx < GRID_W && cy < GRID_H ? { x: cx, y: cy } : null;
  }

  // 家具的圖畫在哪裡（底部對齊那一格的前緣）
  itemRect(it) {
    const S = this.stage.S, img = gfx.FURNITURE_ART[it.kind], f = FURNITURE[it.kind];
    const r = this.cellRect(it.x, it.y, f.w, f.h);
    return { x: r.x + (r.w - img.width * S) / 2, y: r.y + r.h - img.height * S, w: img.width * S, h: img.height * S };
  }

  itemAt(px, py) {
    const items = [...this.base.items].sort((a, b) => b.y - a.y);
    return items.find(it => { const r = this.itemRect(it); return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; }) ?? null;
  }

  // 寶可夢要站的地方（腳下）：床的中間、或某一格的中間
  spotOf(it) {
    const f = FURNITURE[it.kind], r = this.cellRect(it.x, it.y, f.w, f.h);
    return { x: r.x + r.w / 2, y: r.y + r.h - 2 * this.stage.S };
  }
  // 基地前面的空地（沒有家具的格子），坐著休息用
  freeSpots() {
    const out = [];
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) if (canPlace(this.base, 'lamp', x, y)) { const r = this.cellRect(x, y); out.push({ x: r.x + r.w / 2, y: r.y + r.h - 2 * this.stage.S }); }
    return out;
  }
  // 基地的範圍（寶可夢判斷自己在不在家）
  contains(px, py, pad = 0) {
    const L = this.layout();
    return px >= L.x - pad && px <= L.x + L.w + pad && py >= L.y - 40 * L.S - pad && py <= L.y + L.h + pad;
  }

  draw(ctx) {
    const st = this.stage, S = st.S, b = this.base, L = this.layout();
    const key = `${b.stage}`;
    if (this.yardKey !== key) { this.yardCache = gfx.yard(GRID_W, GRID_H, b.stage); this.yardKey = key; }
    blit(ctx, this.yardCache, L.x - 4 * S, L.y - 3 * S, S);
    // 住的地方：在院子後面（左邊的基地放左後方，右邊的放右後方）
    const home = gfx.STRUCTURES[b.stage];
    const hx = b.side === 'right' ? L.x + L.w - home.width * S - 2 * S : L.x + 2 * S;
    blit(ctx, home, hx, L.y - home.height * S + 6 * S, S);
    for (const it of [...b.items].sort((a, c) => a.y - c.y)) {
      if (st.mode?.type === 'base' && st.mode.moveId === it.id) continue; // 正在搬的那個畫在游標上
      const r = this.itemRect(it);
      blit(ctx, gfx.FURNITURE_ART[it.kind], r.x, r.y, S, { alpha: st.hoverTarget?.item === it ? 0.8 : 1 });
    }
    if (st.mode?.type === 'base') this.drawEditing(ctx);
  }

  // 擺放模式：格線＋跟著游標的家具（放得下是綠色，放不下是紅色）
  drawEditing(ctx) {
    const st = this.stage, S = st.S, m = st.mode, L = this.layout(), c = CELL * S;
    ctx.fillStyle = 'rgba(42,32,48,0.25)';
    for (let i = 0; i <= GRID_W; i++) ctx.fillRect(L.x + i * c, L.y, S, L.h);
    for (let j = 0; j <= GRID_H; j++) ctx.fillRect(L.x, L.y + j * c, L.w, S);
    const cell = st.pointer.known ? this.cellAt(st.pointer.x, st.pointer.y) : null;
    const kind = m.kind ?? this.base.items.find(i => i.id === m.moveId)?.kind;
    if (!cell || !kind) return;
    const f = FURNITURE[kind];
    const ok = canPlace(this.base, kind, cell.x, cell.y, m.moveId ?? null);
    const r = this.cellRect(cell.x, cell.y, f.w, f.h);
    ctx.fillStyle = ok ? 'rgba(110,220,110,0.35)' : 'rgba(255,90,90,0.35)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const img = gfx.FURNITURE_ART[kind];
    blit(ctx, img, r.x + (r.w - img.width * S) / 2, r.y + r.h - img.height * S, S, { alpha: 0.75 });
  }
}

// 家具當成舞台上點得到的東西（點了進入擺放模式、搬動它）
export class FurnitureTarget {
  constructor(view, item, onClick) { Object.assign(this, { view, item, onClick }); }
}
