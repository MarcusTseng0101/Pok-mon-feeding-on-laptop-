// 寶可夢使用秘密基地：累了回床上睡、想休息回基地坐坐、晚上回基地睡（有人在睡就擠過去，重用 cuddle）。
// 選項都交給 Pet.decide()（類別是 base）；這裡只提供「可以做什麼」和走過去以後做什麼。
import { socialOptions } from './behaviors.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.floor(Math.random() * list.length)];

// 床上已經有人（一張床睡一隻）
function freeBeds(pet) {
  const view = pet.stage.baseView;
  if (!view) return [];
  const taken = new Set([...pet.stage.pets.values()].filter(o => o !== pet && o.bedId).map(o => o.bedId));
  return view.base.items.filter(it => it.kind === 'bed' && !taken.has(it.id));
}

function walkThen(pet, to, then) {
  pet.target = { x: to.x, y: to.y };
  pet.walkLimit = 45; // 基地可能在螢幕另一頭：走久一點也沒關係
  pet.set('walk');
  pet.onArrive = then;
}

// 走到床上睡覺
export function goToBed(pet, { night = false } = {}) {
  const bed = pick(freeBeds(pet));
  if (!bed) return false;
  const spot = pet.stage.baseView.spotOf(bed);
  walkThen(pet, spot, () => {
    pet.x = spot.x; pet.gy = spot.y;
    pet.bedId = bed.id;
    pet.set('sleep', night ? rnd(30, 60) : rnd(15, 30));
    pet.showEmote('Z', 1.5);
  });
  return true;
}

// 走到基地的空地坐著（或看看有沒有人在睡，擠過去）
export function goHomeAndRest(pet, { night = false } = {}) {
  const view = pet.stage.baseView;
  const spots = view?.freeSpots() ?? [];
  if (!spots.length) return false;
  walkThen(pet, pick(spots), () => {
    if (night) {
      const cuddle = socialOptions(pet, []).find(([n]) => n === 'cuddle');
      if (cuddle) { cuddle[2](); return; }
      pet.set('sleep', rnd(20, 40));
      return;
    }
    pet.set('sit', rnd(5, 10));
    pet.showEmote('♪', 1);
  });
  return true;
}

export const atHome = pet => Boolean(pet.stage.baseView?.contains(pet.x, pet.gy, 10 * pet.S));

// Pet.decide() 用：[名稱, 權重, 動作]（類別都是 base）
export function homeOptions(pet) {
  if (!pet.stage.baseView || pet.perch) return [];
  const mind = pet.mon.mind;
  const energy = mind?.energy ?? 70, comfort = mind?.comfort ?? 70;
  const beds = freeBeds(pet).length;
  return [
    ['goBed', beds && energy < 50 ? 6 : 0, () => goToBed(pet) || pet.set('sleep', rnd(8, 14))],
    // 回基地坐坐：舒適度越低越想回去；就算不累，偶爾也會回家看看
    // （權重是猜的，可以調）
    ['goBase', atHome(pet) ? 0.5 : comfort < 70 ? 5 : 2.5, () => goHomeAndRest(pet) || pet.set('sit', rnd(3, 6))],
  ];
}

// 晚上想睡：回基地（床空著就上床，不然去基地擠在一起）
export function homeNight(pet) {
  if (!pet.stage.baseView || pet.perch) return null;
  if (atHome(pet)) return null; // 已經在家：照原本的方式睡（旁邊有人就擠過去）
  if (freeBeds(pet).length && Math.random() < 0.6) return ['goBed', 1, () => goToBed(pet, { night: true })];
  return ['homeNight', 1, () => goHomeAndRest(pet, { night: true })];
}

