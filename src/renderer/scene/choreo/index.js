// 每一招自己的演出（不跟別的招共用動作）。一個屬性一個檔案，這裡把它們合在一起給 moves.js 用。
// 每一招是：
//   time(pet, from, to)             → { dur, hit }：多久、第幾秒打中（hit 是 null＝不打人，例如替自己加保護）
//   update(pet, m, t, dt, K)        每幀：放特效；打中那一刻呼叫 K.hit(pet)（多段攻擊只有最後一下）
//   draw(ctx, pet, m, t, K)         （可以沒有）畫在夥伴上面的東西：水柱、藤蔓、盾…
//   pose(pet, p, m, t)              （可以沒有）自己的姿勢：p.sx/sy 伸縮、p.rot 旋轉
//   impact(pet, m, at, eff, K)      （可以沒有）打中的樣子；沒有就用大家共用的
//   knock                           （可以沒有）擊退的倍數（0＝不推開）
//   dimAt: 'between'                （可以沒有）擴散類的招，放招時變暗的位置改在兩隻中間
// K（moves.js 傳進來）：hit、center、targetPoint、isPet、dash（衝過去）、rnd、pick
// 只有畫面：要動對手只用現有的欄位（z、squashT、flipT、flinchT），不直接改位置
import { WATER } from './water.js';
import { FIRE } from './fire.js';
import { GRASS } from './grass.js';
import { ELECTRIC } from './electric.js';
import { ICE_MOVES } from './ice.js';
import { FIGHTING } from './fighting.js';
import { POISON } from './poison.js';
import { GROUND } from './ground.js';
import { FLYING } from './flying.js';
import { PSYCHIC } from './psychic.js';
import { BUG } from './bug.js';
import { ROCK_MOVES } from './rock.js';

export const CHOREO = { ...WATER, ...FIRE, ...GRASS, ...ELECTRIC, ...ICE_MOVES, ...FIGHTING, ...POISON, ...GROUND, ...FLYING, ...PSYCHIC, ...BUG, ...ROCK_MOVES };
