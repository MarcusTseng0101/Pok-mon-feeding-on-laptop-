// 小遊戲清單。每個遊戲：{ title, desc, desktop, needsPet, blocked(game, uid), start(host) → 控制器 }
// 控制器可以有：update(dt)、drawUnder(ctx)（畫在夥伴後面）、draw(ctx)、click(x, y)（桌面座標）、destroy()
import { ACTIONS } from '../../scene/behaviors.js';
import { berryGame } from './berry.js';
import { bakeGame } from './bake.js';
import { headItGame } from './headit.js';
import { puzzleGame } from './puzzle.js';
import { trainingGame } from './training.js';

// 小遊戲中夥伴的狀態：由遊戲控制，自己不會走開
ACTIONS.minigame = {
  update() {},
  lift: pet => (pet.stage.minigame?.active?.uid === pet.uid ? Math.floor(pet.t * 4) % 2 : 0),
};

export const GAMES = {
  berry: berryGame,
  bake: bakeGame,
  headit: headItGame,
  puzzle: puzzleGame,
  training: trainingGame,
};

export const GAME_ORDER = ['berry', 'bake', 'headit', 'puzzle', 'training'];
