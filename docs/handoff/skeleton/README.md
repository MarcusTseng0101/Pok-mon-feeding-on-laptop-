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

### 本機讀完原文後補的（2026-09-30）

7. **黑白版木偶動畫怎麼做（Oripoke〈How to Make Animated Pokémon Sprites〉2025，方法來自 Smogon Sprite Project 的 Antiant）**：
   - 官方是「靜止圖切成很多小塊，各自平移、旋轉」（Puppet Animation），在 DS 上即時算。一隻有兩段：common（簡單彈跳＋尾巴擺，循環 3 次）和 rare（比較誇張，例如小跑步），都從靜止姿勢開始、回到靜止姿勢。約 10 FPS（20 FPS 但多半一格放兩次）。
   - **被擋住的地方會補畫**：原文「Where there are parts of the sprite that are covered by other elements, I make sure to draw in the covered bits, particularly those which might be uncovered when the sprite is in motion」（例：頭髮底下的頭頂另外畫）。所以「移開會露洞」連官方風格也是靠補畫解決 → 我們用規則補（第 5 節第 2 點）方向是對的。
   - 樞紐點：肢體根部；**腳和碰地的地方，樞紐點放在腳底**。部位有父子關係（子跟著父轉）。
   - 長的尾巴、觸手、手臂才用網格＋骨頭（例：手臂 2 根骨頭、自動權重），其他都是整塊硬的轉。**腳的動作是用「縮放」軌道**（不是彎膝蓋）。
   - 官方靜止圖刻意選中性、站穩的姿勢、陰影簡單，就是為了好動。過渡用 sine 比 linear 自然。
   - 有些部位直接換圖（閉眼、嘴巴、火焰），轉和移做不到的動作用手畫格。
   - 結論：黑白版本身也「不是真的走路」，腳多半只有小彈跳。我們要的「腳跨步、膝蓋彎」比官方還多，所以一定會碰到大腿大塊（甲賀忍蛙）這種圖本來就沒畫出來的問題；要接受有些物種只能小步。
8. **PokéCommunity 教學（Magicsaur 2011）**：一樣是切塊（每塊裁到最小、透明）、在 Flash 排層順序、關鍵格轉動，匯出時關掉平滑。沒提到補畫。BR0DE0（DeviantArt）的教學本身是一張大圖，文字讀不到內容。
9. **Meta 2.5D 論文（2502.17866，HTML 版讀過）**：
   - 一張圖做左、右兩個視角：把標成「朝右」的部分鏡像；**部位移開留下的洞用影像修補（inpainting）補**；腳換方向是原地鏡像。網格＝marching squares＋Delaunay，變形一樣用 ARAP、關節當拉桿。
   - 部位前後順序：照 3D 骨架各關節的深度排。背對鏡頭時左右手腳對調。
   - 使用者研究：「朝左和朝右的線索混在一起要避免」；中間朝前＋側面混著可以接受。→ 正面的布里卡隆腳照側面走沒問題，但不要一隻腳像朝左、另一隻像朝右。
   - 2303.12741 的 PDF 太大（>50 MB）打不開；這篇的做法已經從原始碼讀過（第 2 點），不再補。
10. **SPRITETOMESH（2602.21153，摘要）**：把遊戲精靈圖自動做成 Spine 用的三角網格，遮罩用神經網路（我們不能用），頂點照輪廓（Douglas-Peucker）和內部的顏色邊界放。重點：**網格頂點要放在顏色邊界上**，變形時線條才不會斷；「讓神經網路直接猜頂點」實驗失敗。對我們：如果之後換 ARAP，網格的邊要沿著原圖的線條。
11. **cleanEdge（torcado.com/cleanEdge，MIT 授權）**：放大／旋轉時「優先保住線條和邊」，有「最高色」設定（重疊時哪個顏色蓋過哪個，有外框的圖設成外框色比較好）、線寬、2:1 斜坡。不會混出新顏色。之後要換掉 Scale2x 兩次再說（照第 5 節第 4 點）。
12. **Rain World 重做（Merxon22 Part 1、2）**：
   - Part 1 其實是在講「像素化」：先畫到低解析度再放大，**動畫降到 12 FPS** 才像手繪。→ 我們量化 gait 16 格的方向對。
   - Part 2 走路：腳的 IK 目標不跟身體走（黏在地上）；**身體重心跑出兩腳之間才跨步**，落點＝重心前面一點（overShoot 0.8），抬腳高度＝步幅 × 0.8，用起點—最高點—落點的弧線插值。身體略往前傾、上下彈是調參數出來的。
   - 我們是「照走的距離推步相」，跟「重心出界才跨」不同，但結果都是腳不滑；我們的比較穩定、好測，不換。可以借「抬腳高度跟步幅成比例」。
13. **沒讀的**：alanzucconi.com 程序動畫入門（兩段 IK 的基本公式，我們已經寫好）、smogon.com（Oripoke 那篇已經回答了「有沒有補畫」）。

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
