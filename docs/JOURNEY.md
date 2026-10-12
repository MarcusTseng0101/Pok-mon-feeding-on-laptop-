# 卡洛斯旅行（手機遊戲）：研究、設計、驗收

Kalos Amie 的手機版：一款可以裝在 Android 手機上的寶可夢冒險。桌面版是「夥伴住在你的電腦上」，手機版是「帶著夥伴去旅行」。
規則直接用桌面版的（遭遇、捕獲、對戰、招式、進化、色違），畫面另外做成掌機的樣子。

## 為什麼要這樣設計（研究）

給一個從小玩家機、手遊和 Pokémon GO 都玩不久的人。先查「為什麼玩不久」：

| 問題 | 證據 | 對家機玩家來說 |
|---|---|---|
| 被切成一小段一小段 | 手遊評論裡最常被抱怨的是「玩 5 分鐘、等 4 小時」的體力制；體力制存在就是為了讓你多打開幾次。從家機來的核心玩家對這種設計特別反感 | 家機的一段遊戲**有結尾**（道館、迷宮、存檔點），手遊永遠沒有 |
| 變成功課 | 每日登入、連續登入獎勵是為了「養成習慣」而設計的 | 一斷就覺得欠了東西，乾脆不回來 |
| 生活變了就斷 | Pokémon GO 2,612 人的調查（Alha 等，2019）：停玩最主要的原因是**遊戲外的生活狀況**，其次才是遊戲本身的問題 | GO 要你出門、走到特定地點；作息一變就玩不了 |
| 新鮮感用完 | 深度訪談（AUT）：新鮮感消失是流失的主因；GO 的核心只有「滑球」 | 沒有對戰、劇情、策略，沒有東西可以鑽研 |

做得好的反例：

- **寶可夢計步器（心金・魂銀的 Pokéwalker）**：隨身帶的只是附屬品，走路的成果帶回家機的本篇；不帶也不會怎樣
- **Pokémon Sleep**：輸入是你本來就會做的事（睡覺），早上起來看昨晚發生什麼
- **動物森友會**：真實時鐘，沒有體力條，是「去拜訪的地方」不是「要刷的關卡」。以自我決定論分析的研究發現，人會停玩是因為遊戲不再滿足自主、勝任、連結，而不是獎勵不夠

來源：
[TouchArcade：核心玩家與體力制](https://toucharcade.com/2015/05/28/core-gamers-and-f2p-energy-systems-dont-mix-says-developer-of-midnight-star) ·
[unstar 手遊評論分析](https://unstar.app/de/blog/gaming-app-reviews-what-mobile-gamers-hate-most-2026) ·
[Alha et al. 2019, Computers in Human Behavior](https://research.utu.fi/converis/portal/detail/Publication/39497161?lang=en_GB) ·
[AUT：Pokémon GO 研究](https://openrepository.aut.ac.nz/handle/10292/11518) ·
[Nintendo Life：Pokémon Sleep](https://www.nintendolife.com/reviews/mobile/pokemon-sleep) ·
[Iwata Asks：心金・魂銀](https://iwataasks.nintendo.com/interviews/ds/pokemon/0/4) ·
[Bulbapedia：Pokéwalker](https://bulbapedia.bulbagarden.net/wiki/Pokéwalker) ·
[Frontiers：動森與自我決定論](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2022.800683/epub) ·
[uxdesign：動森的時間](https://uxdesign.cc/the-value-of-time-in-animal-crossing-14f80dfcde8d)

## 四條設計原則（每一條都有自動檢查）

驗收不是「感覺好玩」，而是 `test/journey-sim.test.js`：一個模擬玩家用假時鐘玩 30 天、離開又回來，檢查下面四條。
數字是估的（每個動作幾秒、路上遇到什麼的機率），都標了 `// 猜的，可調整`；改了數值就重跑，跑不過就是難度或節奏跑掉了。

| 原則 | 怎麼做 | 怎麼檢查（目前的結果） |
|---|---|---|
| 1. **不懲罰離開** | 沒有體力、連續登入、每日任務、會枯萎的東西。離開越久，帶頭的夥伴在附近找到越多東西（每 8 小時 1 個，最多算 7 天） | 40 個玩家各離開 12 次（1 小時～60 天）：隊伍、道具、徽章、圖鑑、成長、好感、打贏的訓練家**沒有一項變少**；同樣的玩法壓在 1 天或攤在 30 天，進度完全一樣（沒有被時間鎖住的內容） |
| 2. **每一段都有結尾** | 一條路線 5–6 格，走完就到下一個地方；隨時可以關掉，下次從原地繼續 | 60 個玩家走完 90 條路線：中位數 133 秒、p95 186 秒（標準：中位數 ≤ 10 分鐘、p95 ≤ 15 分鐘） |
| 3. **真的對戰** | 屬性相剋、本系加成、換人、傷藥、等級、血量一路帶著走；路上的野生和訓練家比道館弱（原作也是） | 9 級直接挑戰紫羅蘭的勝率 0.23（標準 0.1–0.85：要練，但不是不可能）；一週玩 3 次、每次 10 分鐘，兩週內 50/60 拿到徽章（標準 ≥ 80%） |
| 4. **跟生活一起** | 現實的時段和星期決定遇到誰（跟桌面版同一套「氣息」）；手機計步器：你真的走的路讓帶頭的夥伴成長（400 步 = 成長 1）、更喜歡你（150 步 = 好感 1） | 3 號道路清晨遇到小箭雀的次數比深夜多 |

不做的事（使用者的長期規則）：不要位置、不推播、不通知、不連 AI、不要帳號。權限只有網路（下載寶可夢的圖）和計步器。

## 玩法（第一版）

- 開場選哈力栗／火狐狸／呱呱泡蛙，從亞連鎮出發：2 號道路 → 白檀森林 → 3 號道路 → 白檀市（道館：紫羅蘭）
- 路上每一格：野生寶可夢、訓練家（固定在那一格，打贏就不再擋路）、撿到東西、或什麼都沒發生
- 野生的：打、丟球（目標圈縮到最小時點，跟桌面一樣）、用傷藥、換人、逃跑（一定逃得掉）。**血越少越好抓**（滿血跟桌面一樣，快倒下時 3 倍）
- 輸了：回到上次經過的城鎮，隊伍恢復；夥伴、道具、徽章都不會少，只是那條路要從頭走
- 走到底的路可以「在這裡逛逛」：只會遇到野生的、撿東西（想抓寶可夢、練等級的時候）
- 成長：沒有另外的經驗值表，跟桌面一樣「原作的進化等級 × 8」；Lv = 成長 ÷ 8。打贏拿到的成長看對手等級／自己等級
- 進化：桌面版的規則（成長夠、好感夠、白天／夜晚、隊伍裡要有某個屬性）

## 技術

```
src/core/journey.js     規則（純函式；用 encounter／capture／battle／moves／evolution／shiny／amie）
src/core/moves.js       招式資料（從 renderer/scene/moves.js 搬過來，桌面和手機共用）
src/journey/            畫面：index.html、app.js、journey.css（CSP：只准自己的程式、圖片只准 PokeAPI）
android/                Android 外殼：一個 WebView（純 Java，沒有 AndroidX）
  MainActivity.java     用 https://appassets.androidplatform.net/ 讀 assets（ES module 不能用 file://）、計步器、存檔備份
scripts/journey-apk.mjs 打包 APK（dist/kalos-journey-debug.apk）、--install 用 adb 裝到手機
```

存檔：WebView 的 localStorage，每次存的時候外殼另外寫一份到 app 自己的資料夾（`journey.json`，先寫暫存檔再改名）；localStorage 不見了會從備份讀回來。

計步器：Android 的 `TYPE_STEP_COUNTER` 是「開機以來的總步數」，硬體自己在數，app 沒開也會數。
打開 app 時讀一次，跟上次的差就是這段時間走的；重開機會歸零，所以數字變小就當作從 0 算。一天最多算 30,000 步（數字亂跳時不會暴衝）。

## 接下來（每一項一個 PR）

1. **第一版（這個 PR）**：外殼、四個地方、對戰、捕獲、第一個道館、計步器、離開的禮物、模擬玩家驗收
2. **把卡洛斯走完**：後面七個道館、四天王、冠軍、閃焰隊；箱子換隊伍；商店
3. **生活**：天氣（你輸入的城市，跟桌面一樣用 Open-Meteo）、好啦魷要把手機倒過來、拍照一起做（照片只在手機上辨識）
4. **跟桌面的夥伴連起來**：手機上抓到的送到桌面（只送 `{ kind, id, at }`，1 KB 上限不變），像 Pokéwalker 跟心金・魂銀
5. **打磨**：音效、動畫、正式簽章的 APK、Releases 上可以下載

## 限制

- 只有 Android（iPhone 不能隨便裝自己打包的 app）
- 第一次看到某一種寶可夢要連網下載圖（之後 WebView 自己快取）
- 打包出來的是除錯簽章的 APK，要自己允許安裝；換手機要自己搬存檔（還沒做匯出）
