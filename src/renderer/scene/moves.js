// 招式動作：夥伴會自己練習招式、跟其他夥伴切磋，也可以從對話框叫牠使出招式。
// 只有演出，沒有傷害或對戰規則；屬性相剋只用來顯示「效果絕佳！」之類的字。
//
// 每個招式的 kind 決定演出方式：
//   projectile 發射物飛過去     beam 光束／水柱       contact 衝過去撞一下再回來
//   line 藤鞭、吐絲伸過去       area 以自己為中心擴散  rain 從天上落到目標
//   self 替自己加上保護或能量   portal 在目標那裡打開圓環
import * as art from '../gfx/art.js';
import { blit, paint } from '../gfx/pixel.js';
import { meet } from './behaviors.js';

const T = art.TYPE_COLORS;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.floor(Math.random() * list.length)];

export const MOVES = {
  tackle: { zh: '撞擊', type: 'normal', kind: 'contact' },
  hypervoice: { zh: '巨聲', type: 'normal', kind: 'area', c: ['#ffffff', '#e0e0e0'], rings: 3 },
  boomburst: { zh: '爆音波', type: 'normal', kind: 'area', c: ['#ffffff', '#c070ff'], rings: 4, big: true },
  sweetscent: { zh: '甜甜香氣', type: 'normal', kind: 'area', c: ['#ffb0d0', '#ffd6ea'], soft: true },
  ember: { zh: '火花', type: 'fire', kind: 'projectile', c: ['#ff6a2a', '#ffb13a', '#ffe066'] },
  flamethrower: { zh: '噴射火焰', type: 'fire', kind: 'beam', c: ['#ff6a2a', '#ffb13a', '#ffe066'] },
  mysticalfire: { zh: '魔法火焰', type: 'fire', kind: 'projectile', c: ['#ff6a2a', '#ff9d3a', T.psychic], big: true },
  watergun: { zh: '水槍', type: 'water', kind: 'beam', c: ['#5aa0f0', '#8ec5ff', '#ffffff'] },
  bubble: { zh: '泡沫', type: 'water', kind: 'projectile', c: ['#d8f0ff', '#8ec5ff'], many: true },
  waterpulse: { zh: '水之波動', type: 'water', kind: 'projectile', c: ['#5aa0f0', '#8ec5ff'], big: true },
  watershuriken: { zh: '飛水手裏劍', type: 'water', kind: 'projectile', c: ['#8ec5ff', '#ffffff'], img: () => art.star, many: true },
  steameruption: { zh: '蒸汽爆炸', type: 'water', kind: 'area', c: ['#ffffff', '#d8ecff', '#ff9d3a'], rings: 3, big: true },
  vinewhip: { zh: '藤鞭', type: 'grass', kind: 'line', c: ['#4a9a3a', '#78c850'] },
  razorleaf: { zh: '飛葉快刀', type: 'grass', kind: 'projectile', c: ['#78c850'], img: () => art.leaf, many: true },
  petalblizzard: { zh: '落英繽紛', type: 'grass', kind: 'area', c: ['#ff9ec7', '#ffd6ea', '#ffffff'], petals: true },
  hornleech: { zh: '木角', type: 'grass', kind: 'contact', c: ['#78c850', '#a8e070'] },
  cottonspore: { zh: '棉花孢子', type: 'grass', kind: 'area', c: ['#ffffff', '#f0f0f0'], soft: true },
  spikyshield: { zh: '尖刺防守', type: 'grass', kind: 'self', c: ['#78c850', '#c8f0a0'] },
  thundershock: { zh: '電擊', type: 'electric', kind: 'beam', c: ['#fff27a', '#ffd84a', '#ffffff'], zigzag: true },
  paraboliccharge: { zh: '拋物面充電', type: 'electric', kind: 'area', c: ['#fff27a', '#ffd84a'], rings: 3 },
  nuzzle: { zh: '蹭蹭臉頰', type: 'electric', kind: 'contact', c: ['#fff27a', '#ffffff'] },
  aurorabeam: { zh: '極光束', type: 'ice', kind: 'beam', c: ['#7affc8', '#7ab8ff', '#c070ff', '#ff9ec7'] },
  iceshard: { zh: '冰礫', type: 'ice', kind: 'projectile', c: ['#bfe8ff', '#ffffff'], many: true },
  avalanche: { zh: '雪崩', type: 'ice', kind: 'rain', c: ['#ffffff', '#d8f4ff', '#bfe8ff'] },
  freezedry: { zh: '冷凍乾燥', type: 'ice', kind: 'area', c: ['#bfe8ff', '#ffffff'], rings: 2 },
  armthrust: { zh: '猛推', type: 'fighting', kind: 'contact', c: ['#ffffff', '#ffe066'], hits: 3 },
  aurasphere: { zh: '波導彈', type: 'fighting', kind: 'projectile', c: ['#5aa0f0', '#8ae8ff', '#ffffff'], big: true },
  flyingpress: { zh: '飛身重壓', type: 'fighting', kind: 'contact', c: ['#ffffff', '#ffe066'], jump: true },
  acid: { zh: '溶解液', type: 'poison', kind: 'projectile', c: ['#a040a0', '#c070d0'], many: true },
  sludgebomb: { zh: '污泥炸彈', type: 'poison', kind: 'projectile', c: ['#a040a0', '#6a2a6a', '#c070d0'], big: true },
  mudshot: { zh: '泥巴射擊', type: 'ground', kind: 'projectile', c: ['#9a6a3a', '#c8955a'], many: true },
  bulldoze: { zh: '重踏', type: 'ground', kind: 'area', c: ['#9a6a3a', '#c8955a', '#6e4a28'], ground: true },
  thousandarrows: { zh: '千箭齊發', type: 'ground', kind: 'rain', c: ['#3ad06a', '#0e3a1a', '#a8ffc0'] },
  peck: { zh: '啄', type: 'flying', kind: 'contact' },
  airslash: { zh: '空氣斬', type: 'flying', kind: 'projectile', c: ['#ffffff', '#d8e8ff'], many: true },
  bravebird: { zh: '勇鳥猛攻', type: 'flying', kind: 'contact', c: ['#ff6a2a', '#5aa0f0', '#ffffff'], trail: true },
  hurricane: { zh: '暴風', type: 'flying', kind: 'area', c: ['#ffffff', '#d8e8ff', '#a890f0'], swirl: true },
  oblivionwing: { zh: '死亡之翼', type: 'flying', kind: 'beam', c: ['#8a1a30', '#3a1020', '#ff5d5d'] },
  confusion: { zh: '念力', type: 'psychic', kind: 'projectile', c: [T.psychic, '#ffb0d0'], big: true },
  psychic: { zh: '精神強念', type: 'psychic', kind: 'portal', c: [T.psychic, '#ffffff'], rings: true },
  reflect: { zh: '反射壁', type: 'psychic', kind: 'self', c: ['#7ab8ff', '#ffffff'] },
  hyperspacehole: { zh: '異次元洞', type: 'psychic', kind: 'portal', c: ['#c070ff', '#5a2a8a'], hoop: true },
  stringshot: { zh: '吐絲', type: 'bug', kind: 'line', c: ['#ffffff', '#f0e8f0'] },
  quiverdance: { zh: '蝶舞', type: 'bug', kind: 'self', c: ['#ff5d8f', '#ffd84a', '#7ab8ff', '#9be15d'] },
  powergem: { zh: '力量寶石', type: 'rock', kind: 'projectile', c: ['#bfe8ff', '#ffffff'], img: () => art.diamond },
  headsmash: { zh: '雙刃頭錘', type: 'rock', kind: 'contact', c: ['#b8a038', '#ffffff'], heavy: true },
  diamondstorm: { zh: '鑽石風暴', type: 'rock', kind: 'area', c: ['#bfe8ff', '#ffffff'], swirl: true, sparkle: true },
  shadowball: { zh: '暗影球', type: 'ghost', kind: 'projectile', c: ['#705898', '#3a2a5a', '#c8a0ff'], big: true },
  shadowsneak: { zh: '影子偷襲', type: 'ghost', kind: 'contact', c: ['#3a2a5a', '#705898'], sneak: true },
  trickortreat: { zh: '萬聖夜', type: 'ghost', kind: 'portal', c: ['#ffb13a', '#705898'], rings: true },
  kingsshield: { zh: '王者盾牌', type: 'steel', kind: 'self', c: ['#b8b8d0', '#ffffff', '#ffe066'] },
  flashcannon: { zh: '加農光炮', type: 'steel', kind: 'beam', c: ['#ffffff', '#d8e8ff', '#b8b8d0'] },
  fairylock: { zh: '妖精之鎖', type: 'fairy', kind: 'self', c: ['#ffd84a', '#ffb0d0'], img: () => art.key },
  dragonpulse: { zh: '龍之波動', type: 'dragon', kind: 'beam', c: ['#7038f8', '#a078ff', '#5aa0f0'] },
  bite: { zh: '咬住', type: 'dark', kind: 'contact' },
  nightslash: { zh: '暗襲要害', type: 'dark', kind: 'contact', c: ['#3a2a3a', '#ffffff'], slash: true },
  topsyturvy: { zh: '顛倒', type: 'dark', kind: 'portal', c: ['#705848', '#ffe066'], flip: true },
  moonblast: { zh: '月亮之力', type: 'fairy', kind: 'projectile', c: ['#ffb0d0', '#ffffff', '#ee99ac'], big: true },
  fairywind: { zh: '妖精之風', type: 'fairy', kind: 'area', c: ['#ffb0d0', '#ffd6ea', '#ffffff'], swirl: true },
  disarmingvoice: { zh: '魅惑之聲', type: 'fairy', kind: 'area', c: ['#ffb0d0', '#ffffff'], hearts: true },
  geomancy: { zh: '大地掌控', type: 'fairy', kind: 'self', c: ['#ff5d5d', '#ffb13a', '#ffe066', '#7ae07a', '#7ab8ff', '#c070ff'] },
};

// 各屬性的基本招式（沒有專屬招式時用這個補）
const TYPE_MOVE = {
  normal: 'tackle', fire: 'ember', water: 'watergun', grass: 'razorleaf', electric: 'thundershock', ice: 'iceshard',
  fighting: 'armthrust', poison: 'acid', ground: 'mudshot', flying: 'airslash', psychic: 'confusion', bug: 'stringshot',
  rock: 'powergem', ghost: 'shadowball', dragon: 'dragonpulse', dark: 'bite', steel: 'flashcannon', fairy: 'fairywind',
};

// 各種寶可夢的代表招式（參考原作 X・Y 會學的招式）
const SIGNATURE = {
  650: ['vinewhip'], 651: ['vinewhip', 'hornleech'], 652: ['spikyshield', 'hornleech'],
  653: ['ember'], 654: ['flamethrower', 'ember'], 655: ['mysticalfire', 'psychic'],
  656: ['bubble'], 657: ['waterpulse', 'bubble'], 658: ['watershuriken', 'nightslash'],
  659: ['mudshot'], 660: ['bulldoze', 'mudshot'],
  661: ['peck'], 662: ['ember', 'peck'], 663: ['bravebird', 'flamethrower'],
  664: ['stringshot'], 665: ['stringshot'], 666: ['quiverdance', 'hurricane'],
  667: ['ember'], 668: ['hypervoice', 'flamethrower'],
  669: ['fairywind'], 670: ['fairywind', 'petalblizzard'], 671: ['petalblizzard', 'moonblast'],
  672: ['razorleaf', 'vinewhip'], 673: ['hornleech', 'razorleaf'],
  674: ['armthrust'], 675: ['nightslash', 'armthrust'],
  676: ['tackle', 'bite'],
  677: ['confusion'], 678: ['psychic', 'reflect'],
  679: ['shadowsneak'], 680: ['shadowsneak', 'flashcannon'], 681: ['kingsshield', 'shadowball'],
  682: ['sweetscent', 'fairywind'], 683: ['disarmingvoice', 'moonblast'],
  684: ['cottonspore', 'fairywind'], 685: ['sweetscent', 'cottonspore'],
  686: ['topsyturvy'], 687: ['topsyturvy', 'psychic'],
  688: ['tackle', 'waterpulse'], 689: ['armthrust', 'waterpulse'],
  690: ['acid', 'bubble'], 691: ['sludgebomb', 'dragonpulse'],
  692: ['watergun', 'waterpulse'], 693: ['aurasphere', 'waterpulse'],
  694: ['thundershock'], 695: ['paraboliccharge', 'thundershock'],
  696: ['bite'], 697: ['headsmash', 'bite'],
  698: ['aurorabeam'], 699: ['freezedry', 'aurorabeam'],
  700: ['disarmingvoice', 'moonblast'],
  701: ['flyingpress', 'airslash'],
  702: ['nuzzle', 'thundershock'],
  703: ['reflect', 'powergem'],
  704: ['bubble', 'tackle'], 705: ['acid', 'dragonpulse'], 706: ['dragonpulse', 'sludgebomb'],
  707: ['fairylock', 'flashcannon'],
  708: ['shadowsneak', 'razorleaf'], 709: ['shadowball', 'hornleech'],
  710: ['trickortreat', 'shadowball'], 711: ['trickortreat', 'shadowball'],
  712: ['iceshard'], 713: ['avalanche', 'iceshard'],
  714: ['airslash', 'hypervoice'], 715: ['boomburst', 'dragonpulse'],
  716: ['geomancy', 'moonblast'], 717: ['oblivionwing', 'shadowball'], 718: ['thousandarrows', 'dragonpulse'],
  719: ['diamondstorm', 'moonblast'], 720: ['hyperspacehole', 'psychic'], 721: ['steameruption', 'flamethrower'],
};

// 最多 4 個：代表招式 → 各屬性的基本招式 → 撞擊
export function movesetFor(dex, speciesId) {
  const types = dex.get(speciesId).types;
  const list = [...(SIGNATURE[speciesId] ?? []), ...types.map(t => TYPE_MOVE[t]), 'tackle'];
  return [...new Set(list)].filter(id => MOVES[id]).slice(0, 4);
}

// 屬性相剋（第六世代）：[效果絕佳, 效果不好, 沒有效果]
const CHART = {
  normal: [[], ['rock', 'steel'], ['ghost']],
  fire: [['grass', 'ice', 'bug', 'steel'], ['fire', 'water', 'rock', 'dragon'], []],
  water: [['fire', 'ground', 'rock'], ['water', 'grass', 'dragon'], []],
  electric: [['water', 'flying'], ['electric', 'grass', 'dragon'], ['ground']],
  grass: [['water', 'ground', 'rock'], ['fire', 'grass', 'poison', 'flying', 'bug', 'dragon', 'steel'], []],
  ice: [['grass', 'ground', 'flying', 'dragon'], ['fire', 'water', 'ice', 'steel'], []],
  fighting: [['normal', 'ice', 'rock', 'dark', 'steel'], ['poison', 'flying', 'psychic', 'bug', 'fairy'], ['ghost']],
  poison: [['grass', 'fairy'], ['poison', 'ground', 'rock', 'ghost'], ['steel']],
  ground: [['fire', 'electric', 'poison', 'rock', 'steel'], ['grass', 'bug'], ['flying']],
  flying: [['grass', 'fighting', 'bug'], ['electric', 'rock', 'steel'], []],
  psychic: [['fighting', 'poison'], ['psychic', 'steel'], ['dark']],
  bug: [['grass', 'psychic', 'dark'], ['fire', 'fighting', 'poison', 'flying', 'ghost', 'steel', 'fairy'], []],
  rock: [['fire', 'ice', 'flying', 'bug'], ['fighting', 'ground', 'steel'], []],
  ghost: [['psychic', 'ghost'], ['dark'], ['normal']],
  dragon: [['dragon'], ['steel'], ['fairy']],
  dark: [['psychic', 'ghost'], ['fighting', 'dark', 'fairy'], []],
  steel: [['ice', 'rock', 'fairy'], ['fire', 'water', 'electric', 'steel'], []],
  fairy: [['fighting', 'dragon', 'dark'], ['fire', 'poison', 'steel'], []],
};
export function effectiveness(moveType, targetTypes) {
  const [sup, weak, none] = CHART[moveType];
  let m = 1;
  for (const t of targetTypes) m *= none.includes(t) ? 0 : sup.includes(t) ? 2 : weak.includes(t) ? 0.5 : 1;
  return m;
}

// ---------- 使出招式 ----------
const center = pet => { const r = pet.rect(); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
const isPet = t => t && typeof t.rect === 'function';
const targetPoint = t => (isPet(t) ? center(t) : t);

// 招式的時間軸（秒）：hit = 打中的時間點
function timeline(def, pet, target) {
  const S = pet.S, a = pet.mouth(), b = targetPoint(target);
  const travel = Math.max(0.35, Math.min(1.3, Math.hypot(b.x - a.x, b.y - a.y) / (200 * S)));
  switch (def.kind) {
    case 'projectile': return { dur: 0.35 + travel + 0.45, hit: 0.35 + travel, travel };
    case 'beam': return { dur: 1.3, hit: 0.65 };
    case 'contact': return { dur: def.jump ? 1.1 : 0.9, hit: def.jump ? 0.6 : 0.4 };
    case 'line': return { dur: 1.1, hit: 0.5 };
    case 'area': return { dur: 1.3, hit: 0.5 };
    case 'rain': return { dur: 1.4, hit: 0.85 };
    case 'self': return { dur: 1.4, hit: null };
    case 'portal': return { dur: 1.3, hit: 0.75 };
    default: return { dur: 1, hit: 0.5 };
  }
}

// target：另一隻夥伴、野生寶可夢，或是 {x, y}。onHit(effectiveness) 在打中時呼叫，onEnd 在結束時呼叫
export function useMove(pet, moveId, target, { onHit, onEnd, announce = true } = {}) {
  const def = MOVES[moveId];
  if (!def) return false;
  const tl = timeline(def, pet, target);
  pet.moveCtx = { id: moveId, def, target, tl, onHit, onEnd, hitDone: false, from: { x: pet.x, gy: pet.gy }, emitted: 0 };
  const p = targetPoint(target);
  if (Math.abs(p.x - pet.x) > pet.S) pet.facing = p.x > pet.x ? 1 : -1;
  pet.set('move', tl.dur);
  if (announce) {
    const h = pet.head();
    pet.stage.fx.text(h.x, h.y - 8 * pet.S, `${def.zh}！`, pet.S, lighten(T[def.type]));
  }
  pet.stage.markBusy(tl.dur + 0.5);
  return true;
}

// 往前方練習用的目標點
export function practicePoint(pet) {
  const b = pet.bounds(), S = pet.S;
  const x = Math.max(b.x0, Math.min(b.x1, pet.x + pet.facing * rnd(90, 150) * S));
  return { x, y: pet.gy - (pet.asset.h * S) / 2 };
}

// 發射物的像素球（外圈深、中間亮），依顏色快取
const ORBS = new Map();
function orb(outer, inner, r) {
  const key = `${outer}${inner}${r}`;
  if (!ORBS.has(key)) {
    const n = r * 2 + 1;
    ORBS.set(key, paint(n, n, set => {
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const d = Math.hypot(x - r, y - r);
        if (d <= r + 0.2) set(x, y, d < r * 0.45 ? '#ffffff' : d < r * 0.8 ? inner : outer);
      }
    }));
  }
  return ORBS.get(key);
}

// 招式名稱用淡一點的屬性色，深色的桌布上也看得清楚
function lighten(hex, k = 0.45) {
  const n = parseInt(hex.slice(1), 16);
  const ch = s => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function burst(pet, x, y, colors, opts) { pet.stage.fx.burst(x, y, pet.S, colors, opts); }

function impact(pet, def, at) {
  const S = pet.S, c = def.c ?? [T[def.type], '#ffffff'];
  burst(pet, at.x, at.y, c, { n: def.big ? 14 : 8, speed: def.big ? 80 : 55, spread: 6.3, g: 60, life: 0.5 });
  if (def.big || def.heavy) pet.stage.fx.ring(at.x, at.y, S, c[0], 30);
  else pet.stage.fx.stars(at.x, at.y, S, 3);
  pet.stage.audio.sfx(def.kind === 'contact' ? 'land' : 'hit');
}

function hit(pet) {
  const m = pet.moveCtx;
  if (m.hitDone) return;
  m.hitDone = true;
  const at = targetPoint(m.target);
  impact(pet, m.def, at);
  const eff = isPet(m.target) ? effectiveness(m.def.type, m.target.types) : 1;
  if (isPet(m.target)) m.target.flinchT = 0.4;
  m.onHit?.(eff);
}

export const MOVE_ACTIONS = {
  move: {
    update(pet, dt, done) {
      const m = pet.moveCtx;
      if (!m) { pet.set('idle', 1); return; }
      const t = pet.stateT, def = m.def, S = pet.S, c = def.c ?? [T[def.type], '#ffffff'];
      const from = pet.mouth(), to = targetPoint(m.target);
      if (isPet(m.target) && m.target.leaving) m.target = to;
      switch (def.kind) {
        case 'projectile': {
          const n = def.many ? 3 : 1;
          const want = t > 0.3 ? Math.min(n, 1 + Math.floor((t - 0.3) / 0.08)) : 0;
          while (m.emitted < want) {
            m.emitted++;
            const life = m.tl.travel, dx = to.x - from.x, dy = to.y - from.y;
            const extra = (n - m.emitted) * 0.08; // 同一串的後面幾發晚一點出發，一起到
            const L = Math.max(0.05, life - extra);
            const img = def.img ? def.img() : orb(c[0], c[1] ?? c[0], def.big ? 5 : 3);
            pet.stage.fx.add({ img, x: from.x, y: from.y, vx: dx / L, vy: dy / L, life: L, fade: false });
            // 大顆的旁邊加一圈小粒子
            if (def.big) for (let i = 0; i < 6; i++) pet.stage.fx.add({ rect: c[(i + 1) % c.length], size: S / 2, x: from.x + rnd(-6, 6) * S, y: from.y + rnd(-6, 6) * S, vx: dx / L, vy: dy / L, life: L });
          }
          // 飛行中留下一點尾巴
          if (t > 0.35 && t < m.tl.hit && Math.random() < dt * 30) {
            const u = (t - 0.35) / Math.max(0.05, m.tl.hit - 0.35);
            burst(pet, from.x + (to.x - from.x) * u, from.y + (to.y - from.y) * u, c, { n: 1, speed: 8, g: 0, life: 0.3 });
          }
          if (t > m.tl.hit) hit(pet);
          break;
        }
        case 'beam':
          if (t > 0.3 && t < 1.0) {
            for (let i = 0; i < 3; i++) {
              const u = Math.random(), wig = def.zigzag ? (Math.random() - 0.5) * 12 * S : (Math.random() - 0.5) * 3 * S;
              pet.stage.fx.add({ rect: c[i % c.length], size: S / 2 + (i === 0 ? S / 2 : 0), x: from.x + (to.x - from.x) * u + wig, y: from.y + (to.y - from.y) * u + wig, life: 0.12, fade: false });
            }
          }
          if (t > m.tl.hit) hit(pet);
          break;
        case 'contact': {
          // 衝過去再回來；飛身重壓會跳起來壓下去
          const back = m.from, T1 = m.tl.hit;
          const reach = isPet(m.target) ? ((m.target.asset.w + pet.asset.w) / 2) * S * 0.8 : 0;
          const dir = to.x > back.x ? 1 : -1;
          const tx = to.x - dir * reach, tgy = isPet(m.target) ? m.target.gy : back.gy;
          const k = t < T1 ? t / T1 : Math.max(0, 1 - (t - T1) / (pet.dur - T1));
          pet.x = back.x + (tx - back.x) * k;
          pet.gy = back.gy + (tgy - back.gy) * k;
          if (def.jump) pet.z = t < T1 ? Math.sin((t / T1) * Math.PI * 0.9) * 40 : 0;
          if (def.trail && t < T1 && Math.random() < dt * 40) burst(pet, center(pet).x, center(pet).y, c, { n: 1, speed: 10, g: -10, life: 0.4 });
          if (def.sneak && t < T1) pet.moveAlpha = 0.35; else pet.moveAlpha = 1;
          if (t > T1) hit(pet);
          if (def.hits && t > T1 && t < T1 + 0.3 && Math.random() < dt * 12) impact(pet, def, to);
          break;
        }
        case 'line':
          if (t > m.tl.hit) hit(pet);
          break;
        case 'area': {
          const rings = def.rings ?? 2;
          const n = Math.floor((t - 0.2) / 0.18);
          if (t > 0.2 && n < rings && n >= m.emitted) {
            m.emitted = n + 1;
            const cc = center(pet);
            pet.stage.fx.ring(cc.x, def.ground ? pet.gy : cc.y, S, c[n % c.length], def.big ? 110 : 75);
          }
          if (t > 0.2 && t < 1.0 && Math.random() < dt * (def.soft ? 20 : 30)) {
            const cc = center(pet), a = Math.random() * Math.PI * 2;
            if (def.hearts) pet.stage.fx.add({ img: art.heartSmall, x: cc.x, y: cc.y, vx: Math.cos(a) * 70 * S, vy: Math.sin(a) * 50 * S, life: 0.8 });
            else if (def.petals) pet.stage.fx.add({ rect: pick(c), size: S, x: cc.x, y: cc.y, vx: Math.cos(a) * 70 * S, vy: Math.sin(a) * 40 * S, g: 20 * S, life: 1, wobble: true });
            else if (def.swirl) pet.stage.fx.add({ rect: pick(c), size: S / 2, x: cc.x + Math.cos(a) * 30 * S, y: cc.y + Math.sin(a) * 18 * S, vx: -Math.sin(a) * 90 * S, vy: Math.cos(a) * 50 * S, life: 0.5 });
            else burst(pet, def.ground ? pet.x : cc.x, def.ground ? pet.gy : cc.y, c, { n: 1, speed: def.soft ? 25 : 70, spread: 6.3, g: def.ground ? 200 : def.soft ? -10 : 0, life: def.soft ? 1.4 : 0.5, wobble: def.soft });
            if (def.sparkle && Math.random() < 0.3) pet.stage.fx.sparkles(cc.x + rnd(-30, 30) * S, cc.y + rnd(-20, 20) * S, S, 1, 2);
          }
          if (t > m.tl.hit) hit(pet);
          break;
        }
        case 'rain':
          if (t > 0.3 && t < 1.1 && Math.random() < dt * 40) {
            const x = to.x + rnd(-24, 24) * S;
            pet.stage.fx.add({ rect: pick(c), size: S, x, y: to.y - 90 * S, vy: 260 * S, life: 90 / 260, fade: false });
          }
          if (t > m.tl.hit) hit(pet);
          break;
        case 'self': {
          const cc = center(pet);
          if (t > 0.2 && m.emitted < 3 && t > 0.2 + m.emitted * 0.35) { m.emitted++; pet.stage.fx.ring(cc.x, cc.y, S, pick(c), (pet.asset.w / 2) + 10); }
          if (Math.random() < dt * 20) {
            if (def.img) pet.stage.fx.add({ img: def.img(), x: cc.x + rnd(-20, 20) * S, y: cc.y + rnd(-16, 16) * S, vy: -15 * S, life: 0.8 });
            else burst(pet, cc.x + rnd(-16, 16) * S, cc.y + rnd(-16, 16) * S, c, { n: 1, speed: 10, g: -15, life: 0.8 });
          }
          break;
        }
        case 'portal': {
          if (t > 0.3 && t < 1.1 && Math.random() < dt * 20) burst(pet, to.x + rnd(-14, 14) * S, to.y + rnd(-14, 14) * S, c, { n: 1, speed: 20, spread: 6.3, g: 0, life: 0.4 });
          if (def.rings && t > 0.3 && m.emitted < 3 && t > 0.3 + m.emitted * 0.15) { m.emitted++; pet.stage.fx.ring(to.x, to.y, S, pick(c), 26 - m.emitted * 6); }
          if (t > m.tl.hit) {
            if (!m.hitDone && def.flip && isPet(m.target)) m.target.flipT = 0.9; // 顛倒：對方倒過來一下
            hit(pet);
          }
          break;
        }
      }
      if (done) {
        pet.z = 0;
        pet.moveAlpha = 1;
        if (def.kind === 'contact') { pet.x = m.from.x; pet.gy = m.from.gy; }
        const end = m.onEnd;
        pet.moveCtx = null;
        if (end) end(); else pet.set('idle', rnd(1, 2));
      }
    },
    pose(pet, p, k) {
      const m = pet.moveCtx;
      if (!m) return;
      const t = pet.stateT;
      if (t < 0.3) { p.sx = 1.06; p.sy = 0.94; } // 蓄力
      else if (m.def.kind === 'self') { p.sy = 1.06; }
      else if (m.def.kind !== 'contact') p.rot = pet.facing * 0.08;
      else if (m.def.slash) p.rot = pet.facing * 0.3;
    },
    lift: () => 0,
    alpha: pet => pet.moveAlpha ?? 1,
    drawOver(pet, ctx) {
      const m = pet.moveCtx;
      if (!m) return;
      const S = pet.S, t = pet.stateT, def = m.def;
      if (def.kind === 'line') {
        // 藤鞭／吐絲：伸出去再收回來
        const from = pet.mouth(), to = targetPoint(m.target);
        const k = t < 0.2 ? 0 : t < 0.5 ? (t - 0.2) / 0.3 : t < 0.8 ? 1 : Math.max(0, 1 - (t - 0.8) / 0.3);
        const steps = Math.max(4, Math.floor((Math.hypot(to.x - from.x, to.y - from.y) * k) / (2 * S)));
        for (let i = 0; i < steps; i++) {
          const u = (i / steps) * k;
          const sag = Math.sin(u * Math.PI) * 6 * S;
          ctx.fillStyle = def.c[i % def.c.length];
          ctx.fillRect(Math.round(from.x + (to.x - from.x) * u), Math.round(from.y + (to.y - from.y) * u + sag), S, S);
        }
      }
      if (def.hoop && t > 0.2 && t < 1.2) {
        // 異次元洞：目標那裡打開圓環
        const to = targetPoint(m.target), img = art.ring(t);
        blit(ctx, img, to.x - (img.width * S) / 2, to.y - (img.height * S) / 2, S, { alpha: Math.min(1, (t - 0.2) * 4, (1.2 - t) * 4) * 0.9 });
      }
    },
  },
  // 切磋中沒輪到的一方：看著對方
  duel: {
    update(pet, dt, done) {
      const d = pet.duel;
      if (!d || d.over || done) { endDuel(d, pet); return; }
      const o = d.a === pet ? d.b : d.a;
      if (!o || o.leaving || o.state === 'held' || (o.state !== 'duel' && o.state !== 'move')) { endDuel(d, pet); return; }
      pet.facing = o.x > pet.x ? 1 : -1;
      // 兩隻都在等的時候，倒數完換下一招
      if (pet === d.a && o.state === 'duel') {
        d.cool -= dt;
        if (d.cool <= 0) nextTurn(d);
      }
    },
    lift: pet => Math.floor(pet.t * 3) % 2,
  },
};

// ---------- 切磋 ----------
const EFF_TEXT = eff => (eff === 0 ? ['好像沒有效果…', '#b8b8c8'] : eff > 1 ? ['效果絕佳！', '#ffb13a'] : eff < 1 ? ['效果不太好…', '#8ec5ff'] : null);

function react(defender, eff) {
  const t = EFF_TEXT(eff), h = defender.head(), S = defender.S;
  if (t) defender.stage.fx.text(h.x, h.y - 18 * S, t[0], S, t[1]);
  defender.showEmote(eff === 0 ? '?' : eff > 1 ? '@' : '!', 0.9);
}

function startDuel(a, b) {
  const d = { a, b, turn: 0, turns: 4, over: false, cool: 0.5 };
  a.duel = b.duel = d;
  a.partner = b; b.partner = a;
  a.set('duel', 30); b.set('duel', 30);
  a.showEmote('!', 0.8); b.showEmote('!', 0.8);
}

function nextTurn(d) {
  if (d.over) return;
  if (d.turn >= d.turns) { finishDuel(d); return; }
  const atk = d.turn % 2 ? d.b : d.a, def = atk === d.a ? d.b : d.a;
  if (atk.state !== 'duel' || def.state !== 'duel') { endDuel(d); return; }
  d.turn++;
  const moves = movesetFor(atk.stage.dex, atk.mon.species);
  useMove(atk, pick(moves), def, {
    onHit: eff => react(def, eff),
    onEnd: () => { if (d.over) { atk.set('idle', 1); return; } atk.set('duel', 30); d.cool = 0.45; },
  });
}

function finishDuel(d) {
  d.over = true;
  for (const p of [d.a, d.b]) { p.duel = null; p.partner = null; if (p.state === 'duel') { p.set('happy', 0.6); p.showEmote('♪', 1.2); } }
  d.a.stage.fx.hearts((d.a.x + d.b.x) / 2, Math.min(d.a.head().y, d.b.head().y), d.a.S, 3);
  d.a.stage.fire('bond', d.a, d.b, 3);
}

function endDuel(d, pet) {
  if (d) {
    d.over = true;
    for (const p of [d.a, d.b]) { p.duel = null; if (p.partner === d.a || p.partner === d.b) p.partner = null; if (p.state === 'duel') p.set('idle', 1); }
  } else if (pet) { pet.duel = null; pet.set('idle', 1); }
}

// Pet.decide() 用
export function moveOptions(pet, others) {
  const h = pet.mon.affection;
  const list = [
    ['practice', 4, () => useMove(pet, pick(movesetFor(pet.stage.dex, pet.mon.species)), practicePoint(pet))],
  ];
  if (others.length && h >= 50) {
    list.push(['duel', 4, () => {
      const o = pick(others);
      meet(pet, o, { gap: 46, then: (a, b) => startDuel(a, b) });
    }]);
  }
  return list;
}

