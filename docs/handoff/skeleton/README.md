# 交接：骨架木偶（讓手腳像真的動物在動）

給接手的 Claude（在使用者的電腦上跑）。**開工前先讀完 repo 根目錄的 `CLAUDE.md`**，裡面的規則全部照舊（繁體中文、不亂刪、每個 PR 修改既有檔案 ≤ 12 個、不加 npm 依賴、不用 API key、不寫模型名稱…）。

這個資料夾（`docs/handoff/skeleton/`）只是交接用：開 PR 之前問使用者要不要留，不要就在 PR 裡刪掉（先問）。

---

## 1. 使用者要什麼

使用者原話：「你讓他手腳動起來的剛體解點太少了，讓他們動起來很像斷手斷腳，我想的是例如甲賀忍蛙在走路時雙腳怎麼跨，你要想像他們在真實世界是怎麼表現行動的」

- 手腳要有關節（髖 → 膝 → 腳踝 → 腳掌、肩 → 肘 → 手），會彎，不是一整塊硬的在轉。
- 走路要像真的動物：腳踩在地上不滑、膝蓋照身體彎、步態照那種動物真的怎麼走。
- 使用者的決定：
  - **關節由 Claude 標**，做成「骨架疊在原圖上」的總表給使用者看，標錯的使用者指出來再改。
  - 先做 4 隻試做（658 甲賀忍蛙、656 呱呱泡蛙、652 布里卡隆、667 小獅獅），使用者看過影片說方向對了，再接進遊戲、再做完 72 隻（分好幾個 PR，每一批附總表）。
  - 使用者要求先做研究（別人怎麼解決這種問題），研究的重點見第 4 節。雲端環境擋了很多網站，所以才交接到本機繼續。

## 2. 為什麼現在會斷手斷腳（原因已確認）

現在的木偶是 `src/renderer/gfx/rig.js`，全部自動切：

- 「腳」＝圖最下面一條，左右切兩半，整塊平移 1–3 格。甲賀忍蛙、布里卡隆連腳都偵測不到（`hasLegs: false`），走路只有整隻上下彈。
- 手、尾巴、耳朵＝一整塊硬的，只繞根部一點轉（RotSprite）。
- 沒有膝蓋、手肘；腳不會踩在地上。

## 3. 目前做到哪（分支 `claude/skeleton-pilot`，程式在 commit `515dc42`）

**還沒接進遊戲**，只有預覽。

- `src/renderer/gfx/skeletons.js`（新）：4 隻的手標骨架。格式寫在檔案開頭（facing、root、head、limbs 的 kind／pts／poly／layer／side／phase／swing、gait／strideK／liftK／duty）。座標是「裁掉透明邊以後的原圖」像素（遊戲裡 `sprites.js` 的 `crop()` 也是這樣裁）。
- `src/renderer/gfx/skeleton.js`（新）：`buildSkeleton(canvas, spec)`，回傳跟 `rig.js` 的 `buildRig` 同一個介面（`sets, pose, target, stats, cache, w, h, info`），多了 `quantize`。
  - 像素分給哪一段：limbs 的外框（poly）裡，照「離哪一段骨頭的直線距離最近」。**這是散落像素的原因，要改（見第 5 節第 1 點）。**
  - 變形：線性蒙皮（關節附近的像素照距離分給上下兩段，最多 0.5）。
  - 畫法：原圖 Scale2x 兩次（放大 4 倍，只複製原本的格子），每一小格照骨頭算新位置、落到最近的格子（同一格留「層最上面、離格子中心最近」的那一小格）。像素是方的、不會有新顏色、不會有洞。
  - 腳：兩段 IK（膝蓋往原圖彎的那一側），腳踝目標＝原圖位置＋步伐；步伐 `footAt()` 用 duty（踩地比例）和每隻腳的 phase（步相差）。兩腳交替 0／0.5；四腳側對步 後近 0、前近 0.25、後遠 0.5、前遠 0.75；青蛙 `gait: 'hop'` 兩腳一起。
  - 手：走路時跟腳反向擺，擺多少看手是垂著還是橫著伸（橫著伸的手在畫面上轉只會上下，所以幾乎不擺）。
  - 參數跟 `rig.js` 一樣（lean、crouch、headPitch、breath、legL/legR、arm/tail/ear＋Sw），多兩個：`gait`（0–1 步相，量化成 16 格）、`gaitAmt`（0–1 走路程度，4 級）。
- `src/renderer/gfx/rig.js` **沒有改**。

### 目前的樣子（使用者還沒回覆看過的感想）

| 物種 | 狀況 |
|---|---|
| 652 布里卡隆 | 最好：腿一步一步踩，手臂張開小幅擺 |
| 656 呱呱泡蛙 | 兩腳一起跳，大致乾淨 |
| 667 小獅獅 | 大致乾淨，腳邊有一兩格散落的點（直線距離分錯像素） |
| 658 甲賀忍蛙 | 最難：蹲著、腿折成 Z 字，大腿很大一塊。步子縮小到 `strideK: 0.14` 才比較不亂，近的那隻腳掌還有點亂；垂到地上的那隻手幾乎不擺（`swing: 0.06`），不確定對不對 |

## 4. 研究到目前為止的結論

雲端擋掉的網站（**本機請打開原文讀完再補這一節**）：

- arxiv.org：Meta「A Method for Animating Children's Drawings of the Human Figure」（2303.12741）、「Animating Childlike Drawings with 2.5D Character Rigs」（2502.17866）、SPRITETOMESH（2602.21153）
- smogon.com、pokecommunity.com、oripoke.wordpress.com、DeviantArt（BR0DE0、Snivy101 的黑白版動畫教學）：黑白版官方的「木偶動畫」怎麼切、被擋住的地方有沒有補畫
- medium.com：Rain World 程序動畫重做（Merxon22 Part 1、2）
- torcado.com：cleanEdge（旋轉像素圖的新方法，GitHub gist 打得開）
- www.alanzucconi.com：程序動畫入門

已經查到的：

1. **寶可夢黑白版官方**：把靜止圖切成很多小塊各自平移、旋轉（木偶動畫），省卡帶容量。摘要說他們是用「事先畫好的身體各段」來轉；被擋住的地方有沒有另外補畫，還沒找到直接證據（待讀原文）。
2. **Meta 的 AnimatedDrawings**（github.com/facebookresearch/AnimatedDrawings，原始碼讀過）：
   - 輪廓 → 三角網格 → 關節當拉桿，用 ARAP（盡量剛硬的變形，Igarashi 2009）拉整張網格，彎的地方不會斷。
   - 三角形分給哪根骨頭：`_initialize_joint_to_triangles_dict` 從骨頭在**輪廓裡面**做 BFS（沿著身體走的距離），不是直線距離。
   - 每一幀照深度排各部位畫的順序（`_set_draw_indices`）。
   - 「扭轉透視」：身體面向前方，手腳的動作投影到最能看出動作的平面（`method: pca`）。正面圖（布里卡隆）的腳也照側面的方式走。
   - 四腳的設定是 `examples/config/retarget/four_legs.yaml`：前後腳共用人的左右腳動作，不是真正的四腳步態，參考價值低。
3. **像素圖旋轉**：業界通常避免直接做骨架變形；常見解法是 RotSprite（我們在用），更新的是 cleanEdge（偵測線條再用新角度重畫、不會斷線、不混色；gist：torcado194/e2794f5a4b22049ac0a41f972d14c329）。
4. **被擋住的地方**：做 Live2D 的人會把被手、頭髮擋住的地方補畫出來，因為那一塊移開就會露出來。我們不能用 AI，只能用規則補（例如把身體邊緣的顏色往手腳底下延伸）。
5. **步態**：遊戲、機器人用「踩地比例 duty＋每隻腳步相差 phase」，慢走 duty > 0.5（四腳時隨時三隻在地上），兩段 IK 讓腳踩住不滑（Rain World、ADAPTIK、四足步態論文）。動畫師（The Animator's Survival Kit）把一步分成四個姿勢：著地 → 下沉（身體最低）→ 交錯 → 抬起（最高），重心往撐地那隻腳偏。
6. **真的青蛙**：大部分用跳的；蟾蜍連續跳其實是像哺乳類的彈跳（落地前腿先伸直，只用腳著地）；少數蛙（Kassina）會兩邊交替走。甲賀忍蛙可以平常蹲低小步走、趕路時跳。

## 5. 下一步（已經跟使用者提過，使用者還沒說要不要做；先把第 4 節讀完、補完，再問使用者）

1. **像素分給骨頭改用「沿著身體走的距離」**（照 Meta 的 BFS）：修小獅獅的散落點，最有把握。
2. **手腳底下先補身體的顏色**：手腳移開時不會露洞（規則補，不用 AI）。
3. **走路照四個姿勢的時機**，加上左右換重心（正面圖的物種特別需要）；現在身體最高點在交錯的時候，要對照原文再確認。
4. 改完如果彎的地方還是會裂，再把線性蒙皮換成 ARAP（要自己寫解線性方程，不能加 npm 套件）。cleanEdge 之後再考慮。

做完給使用者看新的並排影片（第 6 節的 `walkvid.cjs`）和總表（`skelshot.cjs`）。使用者說方向對了才做：

- **接進遊戲**：`src/renderer/gfx/sprites.js` 的 `peekAnim()`：有 `SKELETONS[物種]` 的用 `buildSkeleton`，沒有的照舊 `buildRig`。
  - `PuppetView.drive()` 的彈簧不能套在 `gait` 上（0–1 會繞回去，彈簧會往回掃一整圈）：`gait` 直接給、`gaitAmt` 可以用彈簧。量化要用 `anim.quantize`（骨架的 key 多了 gait、gaitAmt）。
  - `info.stride`：骨架是「一輪身體走的距離 ÷ 2」＝ `A / duty`，`scene/locomotion.js` 用它算速度、讓腳不滑。要確認走路動畫的步相是照走的距離推的（`pet.js` 的 walkPhase／stepDist）。
  - `info.hasLegs` 骨架有腳就是 true。
- **測試**：`test/e2e/puppet.cjs` 會檢查每一隻、每一組動作（顏色都是原圖有的、大小＝原圖＋pad、每組有在動、像素數差不超過 25%、待機時腳在地上）。骨架的 pad 是 10（`rig.js` 是 4），`w/h` 不一樣，測試要跟著確認，**不能放寬門檻**；改測試要在 PR 寫清楚原因和改前改後。
- 每個 PR：全部單元測試、全部 e2e（`menu.cjs` 一定要跑）、真的 Electron 跑一次（xvfb＋CDP）、新舊並排影片、猜的數字列表。

## 6. 預覽腳本（這個資料夾）

都要先有 `.cache/sprites/<圖鑑號>.png`（跑過一次 e2e 就會下載）。輸出預設在系統暫存資料夾，可以用 `OUTDIR`、`OUT` 指定。

```bash
node docs/handoff/skeleton/grid.cjs 658 656            # 原圖放大 14 倍＋格線（每 5 格紅線），標關節用 → OUTDIR/grid-658.png
IDS=658,656,652,667 N=6 Z=5 OUT=/tmp/sheet.png node docs/handoff/skeleton/skelshot.cjs   # 總表：骨架疊在原圖上＋走一輪 N 格
ID=658 Z=6 P='[{},{"gait":0.25,"gaitAmt":1}]' OUT=/tmp/one.png node docs/handoff/skeleton/one.cjs   # 指定參數的單張，放大檢查
OUT=/tmp/walk.webm node docs/handoff/skeleton/walkvid.cjs   # 新舊並排走路影片（左 rig.js、右 skeleton.js），SECS 秒數、SET 換動作
```

## 7. 還沒解決、要問使用者的其他事

- **PR #48 已經合併進 main**（使用者在被問之前就合了）。裡面有兩個使用者不喜歡的行為，現在在 main 上：
  - 「自己練招式」變成一段裡連續放好幾招（`core/ethogram.js` 的 `practice`，rep 1.5），看起來像在打空氣。
  - 沒有對象的習性，一段裡重複做好幾次（`scene/pet.js` 的 `boutRep`，habitMean）。
  - 這兩個是為了壓低 M8（每分鐘換狀態的次數）加的。之前的建議：改成做一次，剩下的時間安靜待著，M8 超過的話給使用者看數字再決定，不偷偷放寬門檻。要跟骨架一起修還是另開小 PR，**要問使用者**。
- 使用者填的問卷（理想中夥伴怎麼動）：https://claude.ai/artifact/VWzt1wNwuNexbkceboCzjv ，答案存在那個頁面的資料庫 `answers/owner`（用 Artifact 的資料庫工具讀）。使用者後來說重點其實是手腳斷掉，問卷可能沒填。
- ★ 行為還沒做、要先問：鑰圈兒把找到的東西帶回去、朽木妖讓小的夥伴站在頭上、胡帕用圓環把東西藏起來。
- 規格 §13：652、658、684、713 在表上有腳，但舊木偶切不出腳。**骨架做完以後這一項可能就解決了**，跟使用者確認。
