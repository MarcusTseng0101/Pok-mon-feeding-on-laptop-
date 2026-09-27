# CLAUDE.md — 給在這個 repo 工作的 Claude（每次開工先讀完）

Kalos Amie：卡洛斯寶可夢的桌面夥伴（Electron）＋手機小網站。使用者說繁體中文。

---

## 0. 最重要：不要亂刪東西

使用者最在意的一條。**刪除、覆蓋、改寫之前一定要先確認**，不確定就停下來問。

- **不刪檔案、功能、設定、測試**，除非使用者明確說要刪。「看起來沒用到」不是理由——先 `grep` 找出誰在用，列給使用者看再問。
- **不改寫別人（或以前的自己）的程式來「順便整理」**。只改這次任務需要的地方。
- **不弱化測試**：不刪斷言、不放寬數字、不 `skip`、不把失敗的檢查改成印出來就算了。
  測試失敗要找原因；真的是測試寫錯，在 commit／PR 裡寫清楚為什麼改、改之前和之後的對照。
- **不跑有破壞性的 git 指令**：`git reset --hard`、`git clean`、`git push --force`、`git checkout -- .`、`git stash drop`、`rm -rf` 專案裡的資料夾。
  - 唯一例外：e2e 會蓋掉 `docs/screens/` 的舊截圖，用 `git checkout -- docs/screens` 還原（只還原**已經追蹤**的截圖；這個 PR 新增的截圖另外 `git add`）。還原前先 `git status` 看一眼，確定只有截圖。
- **不動使用者的資料**：存檔、`userData/phone.json`、同步資料夾。
- **`src/phone/vendor/` 不改**（第三方檔案）。真的要改，照 `vendor/LICENSES.md` 的方式註明改了什麼、原檔和改後的 SHA-256。
- 改之前先 `Read` 整個要改的段落；用 `Edit` 精準替換，不要整個檔案重寫。
- 找不到東西、搞不清楚為什麼存在：**問**，不要猜著刪。

## 1. 使用者的長期規則（不能換掉）

- **不用 API key**，不連任何 AI／LLM 或雲端辨識服務（「我沒有要 API key」）。手機的照片辨識是在手機上跑的 TF.js＋COCO-SSD（`src/phone/vendor/`，使用者同意的唯一例外）。
- **不加 npm 依賴**，`package.json` 不改。
- **照片只留在手機上**，送到電腦的只有 `{ kind, id, at }`（伺服器 1 KB 上限，不能放寬）。
- 手機頁的 CSP 不放寬（`script-src 'self'`，不加 `unsafe-eval`、`wasm-unsafe-eval`、外部網址）。
- 不推播、不通知、不取得位置。
- 回覆、UI 文字、註解一律**繁體中文**。猜的數字在註解標 `// 猜的，可調整`，PR 描述列出全部。
- repo 裡（commit、PR、註解、文件）**不寫模型名稱或 ID**。

## 2. PR 流程

- **一個 PR 一個分支**，base 一律 `main`。**不推 `main`**（使用者自己合併）。
- 前一個 PR **合併之後**才從最新的 `main` 開下一個分支；**合併過的分支不重複用**，不要疊 PR。
- 每個 PR **修改的既有檔案 ≤ 12 個**（新檔案、`vendor/` 不算）。超過就停下來列清單問使用者。
- 每個檢查點 commit 一次，訊息用繁體中文寫清楚做了什麼、為什麼。commit 和 PR 結尾加系統提供的 attribution。
- 需要設計的東西（新功能、行為改變）先問清楚再做；使用者要研究型的設計時用 `/spec-prompt`。
- 做不到的、沒真的驗證的（真的手機、真的 Tailscale），PR 描述明說沒測過，不要寫成完成。

## 3. 架構規則（每一層只做自己的事）

```
src/core/      純邏輯＝所有規則和數值。不准 Math.random、Date.now、DOM（時間和亂數從參數來），node --test 直接測
src/main/      Electron 主程序：視窗、存檔、精靈圖、手機小網站（phone.js）。不碰遊戲數值
src/main/preload.cjs  renderer 唯一能用的窄介面（contextIsolation＋sandbox）
src/renderer/  畫面：director（導演，收事件演出）、scene（舞台、寵物狀態機）、ui（面板）、gfx（程式畫的像素美術）
               只演出，不改數值；要改數值就呼叫 Game 的方法（core 決定）
src/phone/     手機頁（純 HTML/JS）：phone.js 查電腦算好的生活表、snap.js 拍照一起做、sw.js 斷網
```

- 文字一律 `textContent`，不要用 `innerHTML` 放使用者打的字（暱稱）。
- 會出聲、會走向游標的主動演出一律經過 `director.interrupt()`（打擾額度，`core/attention.js`）。
- 存檔加欄位：`core/save.js` 正規化＋遷移、`core/sync.js` 要有合併規則；用舊存檔讀進來確認不會壞。
- 手機摘要（`core/phonedata.js`）只放要顯示的欄位，不送整份存檔。

## 4. 測試（每個 PR 都要做）

```bash
node --test test/*.test.js                       # 單元測試（core、伺服器、靜態檢查）
node test/e2e/<名字>.cjs                          # 一支畫面測試
for f in test/e2e/*.cjs; do n=$(basename $f .cjs); [ $n = lib ] && continue; node $f 2>&1 | grep -a 'PASS\|FAIL' | tail -1; done   # 全部
git checkout -- docs/screens                      # 跑完還原被蓋掉的舊截圖（見 §0）
```

- e2e **一定要真的點畫面**（`page.click`、真的 file chooser），手機頁也一樣，不能用 `evaluate` 直接呼叫函式代替。
- `menu.cjs` 每次都要跑；全部單元測試和 e2e 都要過。e2e 總時間多超過 3 分鐘就停下來說明。
- **偶爾失敗的測試要找出原因，不能重跑到過就算了**。常見原因（以前真的遇過）：
  - 夥伴自己去旅行（測試裡 `game.canDepart = () => false`）
  - 真的時鐘（牠們的生活 `core/life.js` 看時間；用假時鐘 `window.__clock`）
  - 遊戲自己的亂數 `game.rng`（不是 `Math.random`）
  - 設定面板每 10 秒重畫、打擾額度被別的主動事件用掉
- 每個 PR 最後在**真的 Electron** 跑一次（xvfb＋CDP），點過這個 PR 動到的入口，確認沒有 `pageerror`，結果寫進 PR 描述。
  容器沒有區網位址時用 `NODE_OPTIONS=--require` 假裝一張網卡（PR 描述說明）。
- 截圖放 `docs/screens/`，只 commit 這個 PR 新增的。

## 5. 文件

- `README.md`：每個功能一段（怎麼玩、猜的數字、限制）、e2e 清單、架構清單。加功能就補。
- 第三方檔案的來源和授權：`src/phone/vendor/LICENSES.md`；測試照片：`test/fixtures/snap/SOURCES.md`；測試用憑證：`test/fixtures/tls/README.md`。
