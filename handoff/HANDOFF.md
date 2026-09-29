# 交接：「動得自然」規格剩下的部分（PR-N3、N4、N5、§13）

給接手的 Claude。先讀完 repo 的 `CLAUDE.md`（規則不能換），再讀同一個分支的 `spec-natural.md`（完整規格）。
使用者說繁體中文；回覆、註解、commit、PR 一律繁體中文。repo 裡不寫模型名稱。

## 進度

| PR | 內容 | 狀態 |
|---|---|---|
| #43 PR-N1 | `core/ethogram.js` 物種生活表＋`nextBout`；`test/ethogram.test.js`；`test/e2e/natural.cjs` 量尺 | 已合併 |
| #44 PR-N2 | `scene/locomotion.js` 移動；腳不打滑；轉身；走走停停；打斷測試；基地不擠（`basecrowd.cjs`）；刪 `isNocturnal` | 已合併 |
| PR-N3 | 參數姿勢（取代整張圖旋轉縮放） | **接下來做** |
| PR-N4 | 習性重寫（650–685） | 之後 |
| PR-N5 | 習性重寫（686–721） | 之後 |
| §13 | 表寫有腳、木偶切不出腳的 4 隻（652、658、684、713） | N1–N5 做完後再問使用者 |

一次只開一個 PR：前一個合併後才從最新的 `main` 開下一個分支。每個 PR 結尾都要：新舊並排影片（規格 §7.3）給使用者看，使用者說 OK 才算完成。

## 使用者已經決定的事（規格 §7 門檻的修改）

1. **M1（瞬間起步）門檻 0**：N2 剩下的大多是習性自己直接搬位置（例如烈箭鷹 663 的俯衝 `dive`）。
   使用者決定：**在 N4／N5 重寫習性時一起達成**；N4／N5 的關卡要包含 M1 = 0（照規格的排除：被拎、掉落、被打到／被擠、瞬移型習性、「頓一下」）。
   N3 不用管 M1，但不能讓它變差（N2 合併時：12 隻 × 10 分鐘，中位數每分鐘 0.1–0.2，最差那隻約 5–14，幾乎都是 habit）。
2. **M9（不同步）**：規格原本是「66 對取最大值 < 0.3」，但休息變長以後，連不同種子的兩隻（一定不相干）最大值也有 0.2–0.4。
   使用者同意改成：**實際量到的最大值 ≤ 對照組（不同種子的兩隻）的最大值**（`natural.cjs` 已經算了 `M9_null`／摘要的 `nullMax`，
   但還沒寫成 check）。請在 N3 把這個 check 加進 `natural.cjs`，PR 描述寫明是使用者同意的門檻修改。

## 現在的程式（N1、N2 做了什麼，要沿用的）

- `src/core/ethogram.js`：72 隻（`SPECIES`，含 `why:{look,type,dex}`、`src` 52poke 網址、`habits`、`favor` 招牌動作）、`TEMPLATES`、`TYPE_ENV`、`BODY`、`GAIT`、`ACTS`、
  `nextBout(id, ctx, rng)`、`budgetAt`、`focusBout`、`classOf`（`NAME_CLASS`：cursorSit、follow 算社交）、`GROOM_ACTS=false`（理毛還沒有真的動作，先算進休息——**N3／N4 有真的理毛姿勢後改成 true**）、`DEN`（回窩休息 ×3）。
- `src/renderer/scene/locomotion.js`：`step`（加減速、arrive、翻面遲滯、繞開別隻、邊緣煞車）、`coast`、`gait`、`topSpeed`（步頻上限走 4、跑 6、`RUN_STRIDE` 1.5）、`wanderPath`、`pauseTick`。
- `src/renderer/scene/pet.js`：
  - `facing` 是屬性：邏輯面向馬上換；畫出來的是 `viewFacing`（轉身 `turnT` 做完才翻；`INSTANT_FLIP` 狀態直接翻；`lastTurn`、`instantFlipAt` 測試用）。**N3 畫圖、點擊判定要用 `viewFacing`。**
  - `settle(dt)`：所有夥伴 update 完才做（stage.update 呼叫）：滑行、走路動畫照距離播（`stepDist`、`lastStepDist`）。
  - `set()` 換到非 walk/run/trip 會清 `onArrive`；`free` 排除正要去看日落、正在看日落的。
  - `pose()` 回傳 `{ sx, sy, rot, ox, pivot }`；`draw()` 還在用 `ctx.rotate/scale`（N3 要換成 `toPuppet` 集中轉換器，規格 §4.3）。
- `src/renderer/gfx/rig.js`：`stepOf`（每步 2–3 格）、`info.stride`；9 組固定關鍵格（N3 改成參數產生，舊的 `sets` 介面留著）。
- `src/renderer/scene/home.js`：`openSpots`、`overlapFrac`、`rectAt`、`CROWD`、`SPOT_ROOM`、`tickRoom`（休息中疊在一起讓後來的挪開）、`makeRoom`、白天 `DAY_INSIDE` 0.5 進帳篷。
- `src/renderer/scene/physics.js`：`bumpT`（被擠，量 M1 不算）、`footDist`、`collidesWith`。
- `test/e2e/natural.cjs`：M1–M9；M2、M3、M4 有 check；打斷測試（真的滑鼠：拎起來、開選單再按 Esc、放招）；列出腳不相符的；
  `NATURAL_MIN`、`NATURAL_TAG` 環境變數；結果在 `.cache/natural/natural-<TAG>.json`。M7、M8 是 N3 的關卡（先量舊值寫進 PR）。

## 踩過的坑（不要再踩）

- **e2e 不要同時開很多個跑**（6 個平行跑時有 4 個沒輸出）。要驗證偶發失敗就一個一個連續跑。
- **固定種子不夠**：遊戲裡有地方看真的時鐘、`game.rng`、建立寵物時抽的飄浮高度等。要可重現的話照 `soul.cjs`／`basecrowd.cjs`：init 就換 Math.random、停掉 rAF（`__holdRaf`）、固定 `Date.now`、重設每隻的欄位。
- **真的滑鼠點寶可夢**：用 `stage.petAt(x, y) === 目標` 找點的位置（不然會點到疊在前面的別隻）；**點空白處不會關選單，要按 Esc**；
  左上角會跳出故事的全息通訊，選單不要放在那一帶。
- **「頓一下」**：招式打中時 `stage.stopT > 0`，stage.update 把 dt 乘 0.12。量速度類的指標要排除那幾幀。
- **群體動作由帶頭的那隻推著大家走**（遊行、合照）：任何「這一幀有沒有被推」的判斷都要在所有夥伴 update 完之後（`settle`）。
- **測試用 1 分鐘跑會失敗**（休息很長，「每隻至少做 3 種事」過不了），正式跑 10 分鐘。
- 量尺改定義時，PR 描述要逐條寫「改了什麼、為什麼不是放寬」。
- 比較舊版：`git worktree add <暫存區>/main-wt origin/main`，把 `.cache` 用 symlink 接過去；`BASECROWD_ROOT` 可以量舊版；影片腳本見下。
- 真的 Electron：`node_modules/electron/dist/electron . --no-sandbox --user-data-dir=<暫存> --remote-debugging-port=9333` 用 `xvfb-run` 開，
  先把 `.cache/sprites/*.png` 複製到 `<userData>/sprites/normal/`；在 Electron 裡滑鼠停留（想法泡泡）是主程序讀系統游標，CDP 動不到。
- 影片：一個頁面放兩個 iframe（上舊下新，各自一個靜態伺服器，`/__sprites/` 導到 `.cache/sprites`），Playwright `recordVideo`，存 `.cache/natural/*.webm`，用 SendUserFile 給使用者。

## 規格裡 N3 的重點（詳見 spec-natural.md §4.3、§9、F7、F8、F13、F14）

- `rig.js` 加 `pose(params)`：lean、crouch、headPitch、legs（步態＋步相，步相要接 N2 的 `stepDist`）、parts 角度、breath；量化（整數、角度 16 級）＋快取（LRU 每隻 256）。
- 彈簧追目標（姿勢不跳格，M8 相鄰兩幀像素變化 ≤ 25%）；跟隨（部位慢半拍）。
- `toPuppet(p)` 集中轉換：140 處 `pose()` 呼叫不改；只有接近 90° 倍數才整張圖轉。
- **止損**：`moveprint.cjs` 超過 5 招掉到尺 × 2 以下就停下來問（退路：招式期間保留舊畫法）。**不准改尺。**
- `perf.cjs` 每幀時間比 main 多 20% 就停下來（先降角度分級、快取大小，不要拿掉跟隨和過渡）。
- 既有檔案 ≤ 12 個；超過先列清單問。
