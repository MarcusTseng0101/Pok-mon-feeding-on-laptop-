// 對戰形態：超級進化（蒂安希）、牽絆變身（甲賀忍蛙）。
// 只改 pet.battleForm（畫面用的圖），不改 mon.form，所以不會進存檔。
// 變身演出是疊在任何狀態上的效果（不是一個 state），切磋到一半變身也不會打斷對戰。
import { blit } from '../gfx/pixel.js';
import { pixelCircle } from './fx.js';
import { resolveCollisions } from './physics.js';
import { spriteKey } from '../../core/forms.js';

const FX_TIME = 1.6; // 整段演出
const SWAP_AT = 0.9; // 這時候換圖（白光最亮的時候）
export const MAX_SECONDS = 5 * 60; // 沒在對戰時最多維持 5 分鐘

const RAINBOW = ['#ff5a6e', '#ffb13a', '#ffe45c', '#6fdc6f', '#5ab8ff', '#9a7bff'];

// form：'mega'、'ash'，或 null（變回來）。duel：對戰結束時要變回來
export async function transform(pet, form, { duel = false, seconds = MAX_SECONDS } = {}) {
  if (pet.formFx || (pet.battleForm ?? null) === form) return false;
  if (form) await pet.stage.sprites.get(spriteKey(pet.mon.species, form), pet.mon.shiny); // 先載好，換圖時不會閃替代圖
  if (pet.leaving || !pet.stage.pets.has(pet.uid)) return false;
  pet.formFx = { t: 0, to: form, duel, seconds, swapped: false };
  pet.stage.audio.sfx(form ? 'sparkle' : 'close');
  if (form) pet.showEmote('!', 1);
  return true;
}

export const revert = pet => transform(pet, null);

// 每一幀（Pet.update 呼叫）
export function updateForm(pet, dt) {
  const fx = pet.formFx;
  if (fx) {
    fx.t += dt;
    if (!fx.swapped && fx.t >= SWAP_AT) swap(pet, fx);
    if (fx.t >= FX_TIME) pet.formFx = null;
  } else if (pet.battleForm && !pet.formDuel) {
    pet.formLeft -= dt;
    if (pet.formLeft <= 0) revert(pet);
  }
}

function swap(pet, fx) {
  fx.swapped = true;
  const st = pet.stage, S = pet.S;
  pet.battleForm = fx.to;
  pet.formDuel = Boolean(fx.to && fx.duel);
  pet.formLeft = fx.seconds;
  // 圖的大小變了：碰撞範圍、頭的位置都跟著變，當下就重新夾進螢幕、推開重疊的夥伴
  pet.clamp();
  resolveCollisions(st, 0);
  const r = pet.rect();
  for (const c of fx.to ? RAINBOW : ['#ffffff']) st.fx.burst(pet.x, r.y + r.h / 2, S, c, { n: 4, speed: 90, spread: Math.PI * 2, g: 40, life: 0.8 });
  st.fx.sparkles(pet.x, r.y + r.h / 2, S, fx.to ? 10 : 4, Math.max(pet.asset.w / 2, 20));
  pet.squashT = 0.2;
  st.fire('formChange', pet, fx.to);
}

// 對戰結束：對戰中變身的變回來
export function endDuelForms(...pets) {
  for (const p of pets) if (p?.battleForm && p.formDuel) revert(p);
}

// 畫在寶可夢上面：彩虹光圈往內收，換圖前後一陣白光
export function drawForm(pet, ctx) {
  const fx = pet.formFx;
  if (!fx) return;
  const S = pet.S, a = pet.asset, r = pet.rect();
  const cx = pet.x, cy = r.y + r.h / 2;
  const k = fx.t / FX_TIME;
  if (fx.to) {
    const n = RAINBOW.length;
    for (let i = 0; i < n; i++) {
      const rr = Math.max(2, (Math.max(a.w, a.h) * 0.9 * (1 - k) + i * 3) * S);
      pixelCircle(ctx, cx, cy, rr, S, RAINBOW[(i + Math.floor(fx.t * 12)) % n]);
    }
  }
  const white = Math.max(0, 1 - Math.abs(fx.t - SWAP_AT) / 0.45);
  if (white > 0) blit(ctx, a.white, r.x, r.y, S, { flipX: pet.facing > 0, alpha: white * pet.alpha });
}
