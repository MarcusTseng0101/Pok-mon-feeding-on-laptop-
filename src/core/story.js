// 主線故事：X・Y 的主線節點，改成發生在你的桌面上。
// 完全照真實時間：從序章那天算起，第 N 天發生第 N 天的事（不用達成條件）。
// 錯過的（電腦沒開）會在下次打開時一件一件補上，兩件之間至少隔 GAP_MS。
// 對話都是重新寫的，沒有照抄遊戲台詞。
//
// 事件的種類：
//   call       全息投影通訊器打來（左下角的藍色投影）
//   broadcast  全息投影廣播：桌面中間變暗，投影在正中間
//   letter     寄到信箱的信
//   visit      有人站在秘密基地旁邊，點他才開始對話
//   battle     館主（四天王、冠軍、閃焰隊…）站在秘密基地旁邊，點他說完話就開打；贏了才算做完，
//              輸了隔天（第二天）再來。battle：{ foes: [圖鑑號…], power: 對手強度, badge }
//   legend     有人打來說明，接著傳說的寶可夢出現在桌面上；抓到才算做完（沒抓到下次打開再出現）
//
// reward：做完拿到的東西 { items: [重要物品], balls: { ultra: 5 }, starter: 'mine'／'others' }
//   starter：你的御三家那一族的進化石（mine），或另外兩族的（others）
// 特別事件（special: true）不照日子排隊：主線做到 requires 那件、過了 day 天、而且 when({ hour, version }) 成立就會發生，
// 不會擋住主線，主線也不會擋住牠們。

export const DAY = 86_400_000;
export const GAP_MS = 10 * 60_000; // 補上錯過的事件時，兩件之間至少隔 10 分鐘
export const LOG_KEPT = 80;

// 登場人物：sprites＝Pokémon Showdown 訓練家圖的檔名（依序試，都失敗就用剪影；檔名對照 Showdown 的
// sprites/trainers/index.php，帥哥的沒有確認過）；color＝投影和剪影的顏色
export const CAST = {
  sycamore: { zh: '布拉塔諾博士', sprites: ['sycamore', 'sycamore-masters'], color: '#4a8ad8' },
  shauna: { zh: '莎娜', sprites: ['shauna', 'shauna-masters'], color: '#ff7eb0' },
  tierno: { zh: '蒂艾爾諾', sprites: ['tierno'], color: '#f0a030' },
  trevor: { zh: '特雷維', sprites: ['trevor'], color: '#5ab04a' },
  lysandre: { zh: '弗拉達利', sprites: ['lysandre', 'lysandre-masters'], color: '#e8402a' },
  az: { zh: 'AZ', sprites: ['az'], color: '#8a7aa8' },
  viola: { zh: '紫羅蘭', sprites: ['viola'], color: '#9ad04a' },
  grant: { zh: '查克洛', sprites: ['grant'], color: '#b08a5a' },
  korrina: { zh: '可爾妮', sprites: ['korrina'], color: '#ff9a3a' },
  ramos: { zh: '福爺', sprites: ['ramos'], color: '#6aa84a' },
  clemont: { zh: '希特隆', sprites: ['clemont'], color: '#f0d040' },
  valerie: { zh: '瑪繪', sprites: ['valerie'], color: '#ff9ad0' },
  olympia: { zh: '葛吉花', sprites: ['olympia'], color: '#b070e0' },
  wulfric: { zh: '得撫', sprites: ['wulfric'], color: '#8ad0f0' },
  grunt: { zh: '閃焰隊的手下', sprites: ['flaregrunt', 'flaregruntf'], color: '#ff5a2a' },
  malva: { zh: '帕琦拉', sprites: ['malva'], color: '#ff4a3a' },
  siebold: { zh: '志米', sprites: ['siebold'], color: '#4a8af0' },
  wikstrom: { zh: '雁鎧', sprites: ['wikstrom'], color: '#b8b8d0' },
  drasna: { zh: '朵拉塞娜', sprites: ['drasna'], color: '#7a6af0' },
  diantha: { zh: '卡露乃', sprites: ['diantha', 'diantha-masters'], color: '#f0f0f0' },
  looker: { zh: '帥哥', sprites: ['looker'], color: '#a09070' },
};

// 道館徽章（照道館的順序）
export const BADGES = {
  bug: { zh: '甲蟲徽章', color: '#9ad04a' },
  cliff: { zh: '岩壁徽章', color: '#b08a5a' },
  rumble: { zh: '格鬥徽章', color: '#ff9a3a' },
  plant: { zh: '綠植徽章', color: '#6aa84a' },
  voltage: { zh: '電壓徽章', color: '#f0d040' },
  fairy: { zh: '妖精徽章', color: '#ff9ad0' },
  psychic: { zh: '精神徽章', color: '#b070e0' },
  iceberg: { zh: '冰山徽章', color: '#8ad0f0' },
};

// 版本：序章的問題決定（哲爾尼亞斯／伊裴爾塔爾）
export const VERSIONS = { x: { zh: 'X', legend: 716 }, y: { zh: 'Y', legend: 717 } };
export const legendOf = (story, which = 'mine') => {
  const v = story.version ?? 'x';
  return VERSIONS[which === 'mine' ? v : v === 'x' ? 'y' : 'x'].legend;
};

// 事件（依 day 排序）。lines：[說話的人, 台詞]；choice：最後問一個問題
export const EVENTS = [
  {
    id: 'prologue', day: 0, kind: 'call', title: '序章：全息投影通訊器',
    lines: [
      ['sycamore', '喂？聽得到嗎？太好了，全息投影通訊器接通了！'],
      ['sycamore', '我是卡洛斯地區的寶可夢博士，布拉塔諾。聽說有一群寶可夢住在你的桌面上──這可是前所未見的研究題目！'],
      ['sycamore', '寶可夢和人一起生活久了，會發生一種很特別的變化。我一直在研究它……不過那個以後再說。'],
      ['sycamore', '先問你一個問題，就當作是研究紀錄吧。'],
    ],
    choice: {
      key: 'version',
      ask: ['sycamore', '如果你能得到一種永遠不會消失的力量，你會想要──'],
      options: [
        { value: 'x', text: '讓生命誕生、延續下去的力量', reply: '給予生命的力量啊……很像你會說的話。' },
        { value: 'y', text: '讓一切結束、重新開始的力量', reply: '結束也是開始的一部分。很有意思的回答！' },
      ],
    },
    after: [['sycamore', '對了，我有幾個學生也在旅行，改天介紹給你認識。桌面上的研究就拜託你了！']],
  },
  {
    id: 'friends', day: 1, kind: 'call', title: '新朋友',
    lines: [
      ['shauna', '哈囉～！博士說有人在桌面上養寶可夢，就是你對吧！我是莎娜！'],
      ['tierno', '我是蒂艾爾諾！你的寶可夢會跳舞嗎？放音樂的時候我的都會跟著扭喔！'],
      ['trevor', '我、我是特雷維……我在做圖鑑。你那邊如果看到沒見過的寶可夢，可以告訴我嗎？'],
      ['shauna', '我們接下來要去挑戰道館！等你的夥伴準備好了，也一起來嘛～'],
    ],
  },
  {
    id: 'lysandre-broadcast-1', day: 5, kind: 'broadcast', title: '奇怪的廣播',
    lines: [
      ['lysandre', '卡洛斯的各位，午安。我是弗拉達利。'],
      ['lysandre', '這個世界很美。美到讓人不忍心看它被弄髒。'],
      ['lysandre', '人越來越多，能分的東西卻越來越少。總有一天，得有人做出選擇。'],
      ['lysandre', '……不小心說太多了。祝你和你的寶可夢，今天也過得美好。'],
    ],
  },
  {
    id: 'az-visit', day: 9, kind: 'visit', title: '高大的旅人',
    lines: [
      ['az', '……這個地方，有花的味道。'],
      ['az', '很久以前，我也有一個像這樣的地方。還有一個……很小的朋友。'],
      ['az', '你的寶可夢在你身邊笑得很開心。要好好珍惜。'],
      ['az', '如果你看到一朵不會凋謝的花……不，沒什麼。打擾了。'],
    ],
  },
  {
    id: 'lysandre-letter', day: 11, kind: 'letter', title: '弗拉達利的信', from: 'lysandre',
    text: [
      '致 桌面上的訓練家：',
      '',
      '前幾天的廣播，聽說讓一些人感到不安，在此向你致歉。',
      '我想你應該懂：真正美好的東西，數量總是有限的。花園裡的雜草長得太多，最漂亮的花也會枯萎。',
      '所以，園丁總得有一天拿起剪刀。',
      '',
      '祝你的夥伴們一切安好。',
    ].join('\n'),
  },

  // ---------- 第二章：道館 ----------
  {
    id: 'gym-viola', day: 12, kind: 'battle', title: '第一個道館：紫羅蘭',
    lines: [
      ['viola', '嗨！我是紫羅蘭，平常是攝影師，順便當道館館主。'],
      ['viola', '莎娜說你的夥伴住在桌面上，我就想：這一定要拍下來！'],
      ['viola', '不過在那之前──讓我看看你們在對戰中的表情吧！'],
    ],
    battle: { foes: [666], power: 0.75, badge: 'bug' },
    win: [['viola', '喀嚓！就是這個表情！你們贏得很漂亮。'], ['viola', '這是甲蟲徽章。下一個館主是我妹妹的……啊不對，是查克洛。他很會爬牆喔。']],
    lose: [['viola', '今天的光線不太對吧？明天再來拍一次！']],
  },
  {
    id: 'gym-grant', day: 14, kind: 'battle', title: '第二個道館：查克洛',
    lines: [
      ['grant', '攀岩的時候，眼前只有一面牆，但總有一個能抓住的地方。'],
      ['grant', '對戰也一樣。讓我看看你們會抓住哪裡。'],
    ],
    battle: { foes: [698, 696], power: 0.85, badge: 'cliff' },
    win: [['grant', '你們找到的是一條我沒想過的路線。收下岩壁徽章吧。']],
    lose: [['grant', '掉下來也沒關係，攀岩的人都是這樣變強的。明天再爬一次。']],
  },
  {
    id: 'gym-korrina', day: 16, kind: 'battle', title: '第三個道館：可爾妮與超級手環',
    lines: [
      ['korrina', '喲！我是可爾妮！聽說你的夥伴跟你感情超好的？'],
      ['korrina', '我家世世代代守著一座很老的塔，研究一種叫「超級進化」的東西。'],
      ['korrina', '要讓寶可夢超級進化，光有石頭不夠，還要人和寶可夢的心連在一起。'],
      ['korrina', '所以──用對戰證明給我看吧！我跟摔角鷹人可是很強的喔！'],
    ],
    battle: { foes: [701], power: 0.95, badge: 'rumble' },
    win: [
      ['korrina', '厲害！我感覺到了，你們之間真的有連在一起的東西。'],
      ['korrina', '這是格鬥徽章，還有──超級手環！上面那顆是鑰石。'],
      ['korrina', '這顆摔角鷹人進化石也送你。如果哪天遇到摔角鷹人，就讓牠也變強吧！'],
    ],
    lose: [['korrina', '不錯喔！可是還差一點點。明天再來，我會一直在這裡等你！']],
    reward: { items: ['megaring', 'hawluchanite'] },
  },
  {
    id: 'sycamore-mega', day: 17, kind: 'call', title: '博士的研究',
    lines: [
      ['sycamore', '聽說你拿到超級手環了！恭喜！'],
      ['sycamore', '還記得第一次通話時我說的嗎？寶可夢和人一起生活久了，會發生一種很特別的變化。'],
      ['sycamore', '那就是超級進化。它不是單純變強，而是你們的羈絆變成了看得見的樣子。'],
      ['sycamore', '我把研究室裡的一顆進化石寄給你了。是給你第一個夥伴那一族的。'],
      ['sycamore', '等牠進化到最後，而且你們夠親近的時候……就讓我看看你們的樣子吧！'],
    ],
    reward: { starter: 'mine' },
  },
  {
    id: 'tierno-dance', day: 19, kind: 'call', title: '跳舞隊',
    lines: [
      ['tierno', '嘿！我在組一支寶可夢跳舞隊！'],
      ['tierno', '你放音樂的時候，桌面上的大家有跟著搖嗎？有的話就是天生的舞者！'],
      ['shauna', '蒂艾爾諾，你已經連續講跳舞講了三個小時了……'],
      ['trevor', '我、我這邊圖鑑多了好幾頁。你那邊呢？'],
    ],
  },
  {
    id: 'gym-ramos', day: 20, kind: 'battle', title: '第四個道館：福爺',
    lines: [
      ['ramos', '呵呵呵，年輕人，來得好。'],
      ['ramos', '植物長大靠的是時間，也靠照顧它的人。你的夥伴被照顧得很好啊。'],
      ['ramos', '來吧，讓老頭子我看看你們長得多高了。'],
    ],
    battle: { foes: [673], power: 1.0, badge: 'plant' },
    win: [['ramos', '好，好！長得又高又直。這個綠植徽章拿去吧。']],
    lose: [['ramos', '不急不急。澆點水，曬點太陽，明天再來。']],
  },
  {
    id: 'flare-grunt', day: 22, kind: 'battle', title: '紅色西裝的人',
    lines: [
      ['grunt', '喂，就是你吧？在桌面上養了一堆寶可夢的人。'],
      ['grunt', '我們閃焰隊要讓卡洛斯變得更美麗──只屬於我們的美麗。'],
      ['grunt', '你的寶可夢看起來很有能量嘛。借我們用用吧！'],
    ],
    battle: { foes: [667, 686], power: 0.95 },
    win: [['grunt', '可、可惡……一點都不時尚！'], ['grunt', '你給我記住！我們老大的計畫已經開始了！']],
    lose: [['grunt', '哼，今天先放過你。反正「那個」完成以後，一切都無所謂了。']],
    reward: { balls: { ultra: 3 } },
  },
  {
    id: 'gym-clemont', day: 24, kind: 'battle', title: '第五個道館：希特隆',
    lines: [
      ['clemont', '科學的力量真是太厲害了！啊，你好，我是希特隆。'],
      ['clemont', '我分析過你的對戰資料了。根據計算，我的勝率是……'],
      ['clemont', '……算了，計算不出來的東西，就用對戰來確認吧！'],
    ],
    battle: { foes: [695], power: 1.05, badge: 'voltage' },
    win: [['clemont', '我的計算輸給了你們的默契。這就是電壓徽章！'], ['clemont', '對了，最近密阿雷市常常停電……好像跟某間公司有關。']],
    lose: [['clemont', '數據收集完成！明天你們一定會更強。我是說，你們，不是我。']],
  },
  {
    id: 'lysandre-call', day: 26, kind: 'call', title: '弗拉達利的問題',
    lines: [
      ['lysandre', '你好。我們見過嗎？沒有吧。但我一直在看你。'],
      ['lysandre', '徽章收集得很順利。你的寶可夢，被你照顧得很好。'],
      ['lysandre', '我也曾經相信，只要每個人都願意分享，世界就會變好。'],
    ],
    choice: {
      key: 'gardener',
      ask: ['lysandre', '如果世界上的東西只夠分給一半的人，你會怎麼做？'],
      options: [
        { value: 'share', text: '大家各分一點，一起想辦法', reply: '……很溫柔的答案。溫柔的人，總是先被犧牲。' },
        { value: 'more', text: '努力讓東西變多', reply: '人類已經努力了幾千年。結果你也看到了。' },
      ],
    },
    after: [['lysandre', '很快，你就會明白我的答案了。']],
  },
  {
    id: 'gym-valerie', day: 28, kind: 'battle', title: '第六個道館：瑪繪',
    lines: [
      ['valerie', '……啊。你來了。我剛剛在想，蝴蝶結要綁在左邊還是右邊。'],
      ['valerie', '妖精很任性，但只會對真心的人露出笑容。'],
      ['valerie', '讓我看看，你的夥伴對你笑的樣子。'],
    ],
    battle: { foes: [700], power: 1.1, badge: 'fairy' },
    win: [['valerie', '牠在對戰的時候，一直回頭看你呢。……這個妖精徽章，給你。']],
    lose: [['valerie', '今天的風，比較喜歡我這邊。明天也許會換方向。']],
  },
  {
    id: 'gym-olympia', day: 30, kind: 'battle', title: '第七個道館：葛吉花',
    lines: [
      ['olympia', '星星告訴我，你今天會來。'],
      ['olympia', '星星也說，很快會有一場很大的風暴。能擋住它的，是彼此相連的心。'],
      ['olympia', '來吧。讓我看看你們的連結有多深。'],
    ],
    battle: { foes: [678], power: 1.15, badge: 'psychic' },
    win: [['olympia', '和星星說的一樣。這是精神徽章。'], ['olympia', '還有這顆超能妙喵進化石。星星要我交給你……風暴就要來了。']],
    lose: [['olympia', '星星說，明天。']],
    reward: { items: ['meowsticite'] },
  },

  // ---------- 第三章：閃焰隊 ----------
  {
    id: 'lysandre-broadcast-2', day: 31, kind: 'broadcast', title: '終極武器',
    lines: [
      ['lysandre', '卡洛斯的各位。我是閃焰隊的首領，弗拉達利。'],
      ['lysandre', '三千年前，這個地區有一個國王做了一件武器，結束了一場戰爭。'],
      ['lysandre', '我讓它重新醒過來了。它會帶走所有的人和寶可夢──只留下閃焰隊。'],
      ['lysandre', '這不是毀滅。這是修剪。美麗的世界，本來就只能留給少數人。'],
    ],
  },
  {
    id: 'flare-hq', day: 31, kind: 'battle', title: '閃焰隊的首領',
    lines: [
      ['lysandre', '你果然來了。你的夥伴們都醒著，很好。'],
      ['lysandre', '武器需要能量。傳說中的寶可夢，就在它的最深處沉睡。'],
      ['lysandre', '如果你想阻止我，就證明給我看：你的答案比我的更美。'],
    ],
    battle: { foes: [687, 668], power: 1.2 },
    win: [['lysandre', '……為什麼？你們明明那麼少，為什麼能贏？'], ['lysandre', '太遲了。武器裡的那隻寶可夢，已經醒了。']],
    lose: [['lysandre', '這就是現實。……不過我給你一天。明天，把你的答案帶來。']],
    reward: { balls: { ultra: 5 } },
  },
  {
    id: 'legend-awaken', day: 32, kind: 'legend', legend: 'mine', title: '傳說的寶可夢',
    lines: [
      ['sycamore', '聽得到嗎？！武器停下來了，是你們做到的！'],
      ['sycamore', '可是武器的最深處，有一隻傳說中的寶可夢醒過來了。'],
      ['sycamore', '牠……好像在找你。不是要攻擊，是在看你是怎樣的人。'],
      ['sycamore', '牠要來了！就在你的桌面上！'],
    ],
  },
  {
    id: 'az-past', day: 34, kind: 'visit', title: 'AZ 的故事',
    lines: [
      ['az', '……我是三千年前，做出那個武器的國王。'],
      ['az', '我有一隻花朵的寶可夢。戰爭把牠帶走了。我無法接受，就做了能讓牠回來的機器。'],
      ['az', '牠回來了。可是當牠知道，自己是用別的寶可夢的生命換回來的……牠就離開了我。'],
      ['az', '我太憤怒，把機器變成了武器。然後，我活了三千年。'],
      ['az', '你的寶可夢，不是用誰換來的。牠們是自己選擇待在你身邊的。……真好。'],
    ],
  },
  {
    id: 'gym-wulfric', day: 36, kind: 'battle', title: '第八個道館：得撫',
    lines: [
      ['wulfric', '哈哈哈！你就是那個打敗閃焰隊的人啊！'],
      ['wulfric', '冰山看起來很冷，但下面藏著比上面大好幾倍的東西。人跟寶可夢的感情也是！'],
      ['wulfric', '最後一個徽章，拿出全部的力量來拿吧！'],
    ],
    battle: { foes: [713], power: 1.2, badge: 'iceberg' },
    win: [['wulfric', '好熱血的對戰！這是冰山徽章。八個都到齊啦！'], ['wulfric', '接下來就是寶可夢聯盟了。四天王可不好對付喔！']],
    lose: [['wulfric', '哈哈，冷到了嗎？回去喝點熱的，明天再來！']],
  },

  // ---------- 第四章：寶可夢聯盟 ----------
  {
    id: 'league-malva', day: 38, kind: 'battle', title: '四天王：帕琦拉',
    lines: [
      ['malva', '我是帕琦拉。四天王，也是電視台的主播。'],
      ['malva', '……還有，曾經是閃焰隊的人。你大概聽說過了吧。'],
      ['malva', '我不打算道歉。我只打算用火，把你們燒得乾乾淨淨。'],
    ],
    battle: { foes: [668], power: 1.2 },
    win: [['malva', '……哼。首領輸給你，看來不是運氣。'], ['malva', '拿去吧，火炎獅進化石。我已經不需要了。']],
    lose: [['malva', '新聞快報：挑戰者今日敗退。明天請繼續收看。']],
    reward: { items: ['pyroarite'] },
  },
  {
    id: 'league-siebold', day: 39, kind: 'battle', title: '四天王：志米',
    lines: [
      ['siebold', '料理和對戰很像。材料要新鮮，火候要剛好，最重要的是──心意。'],
      ['siebold', '讓我品嚐看看，你們的對戰是什麼味道。'],
    ],
    battle: { foes: [689], power: 1.22 },
    win: [['siebold', '很溫暖的味道。這顆龜足巨鎧進化石，就當作這道菜的回禮。']],
    lose: [['siebold', '火候還差一點。明天再端上來吧。']],
    reward: { items: ['barbaracite'] },
  },
  {
    id: 'league-wikstrom', day: 40, kind: 'battle', title: '四天王：雁鎧',
    lines: [
      ['wikstrom', '吾乃雁鎧！以騎士之名，接受你的挑戰！'],
      ['wikstrom', '劍與盾，皆為守護而存在。你的寶可夢守護的是什麼？'],
    ],
    battle: { foes: [681], power: 1.25 },
    win: [['wikstrom', '好！守護彼此的心，比任何盾牌都堅固！']],
    lose: [['wikstrom', '騎士不會嘲笑倒下的人。明日，再戰！']],
  },
  {
    id: 'league-drasna', day: 41, kind: 'battle', title: '四天王：朵拉塞娜',
    lines: [
      ['drasna', '哎呀，好可愛的挑戰者。我是朵拉塞娜。'],
      ['drasna', '龍很難親近，可是一旦喜歡上你，就會喜歡一輩子喔。'],
      ['drasna', '所以我不會手下留情的！'],
    ],
    battle: { foes: [715, 691], power: 1.25 },
    win: [['drasna', '好厲害！你的夥伴們都好喜歡你喔。'], ['drasna', '這顆毒藻龍進化石送你！下一個就是冠軍了，加油喔！']],
    lose: [['drasna', '哎呀，太用力了。明天也要來喔，我準備點心等你！']],
    reward: { items: ['dragalgite'] },
  },
  {
    id: 'champion-diantha', day: 42, kind: 'battle', title: '冠軍：卡露乃',
    lines: [
      ['diantha', '你好，我是卡露乃。在電影裡演過很多角色，但現在的我，是卡洛斯的冠軍。'],
      ['diantha', '我一直在看你們的故事。從桌面上的第一天，到阻止閃焰隊。'],
      ['diantha', '最後一幕，就由我們一起演吧。'],
    ],
    battle: { foes: [699, 697, 706], power: 1.3 },
    win: [
      ['diantha', '……太精彩了。我好久沒有這麼認真地享受對戰了。'],
      ['diantha', '從今天起，你就是卡洛斯的冠軍。不過比起冠軍，你更像是──'],
      ['diantha', '最了解寶可夢的那種人。恭喜你。'],
    ],
    lose: [['diantha', '冠軍的位子會一直在這裡等你。明天，我們再演一次。']],
  },
  {
    id: 'finale', day: 43, kind: 'visit', title: '三千年的花',
    lines: [
      ['az', '……我聽說了，新的冠軍是你。'],
      ['az', '我一直在找一朵不會凋謝的花。三千年，走遍了整個卡洛斯。'],
      ['az', '可是剛剛，牠自己回來了。牠說，看到你和寶可夢在一起的樣子，覺得可以原諒我了。'],
      ['az', '謝謝你。我的旅行，終於可以結束了。'],
      ['sycamore', '聽說了！恭喜你，冠軍！……咦，AZ 先生在哭嗎？'],
      ['sycamore', '寶可夢和人一起生活，就是這麼一回事吧。之後也請多指教了！'],
    ],
  },
  {
    id: 'sycamore-letter', day: 44, kind: 'letter', title: '博士的信', from: 'sycamore',
    text: [
      '親愛的冠軍：',
      '',
      '這段時間，謝謝你讓我看到那麼多珍貴的研究紀錄。',
      '寶可夢住在桌面上，看起來很小。可是我覺得，牠們住的其實是你的日常。',
      '卡洛斯還有很多我們不知道的事。例如那隻有十種樣子的寶可夢……',
      '',
      '有新的發現，記得打給我喔！',
      '布拉塔諾',
    ].join('\n'),
  },

  // ---------- 特別事件：不照日子排隊 ----------
  {
    id: 'friends-gift', special: true, requires: 'finale', day: 45, kind: 'call', title: '朋友的禮物',
    lines: [
      ['shauna', '冠軍～！恭喜恭喜！我們三個一起準備了禮物！'],
      ['trevor', '是、是另外兩種御三家的進化石……我跟博士借的，他說沒關係。'],
      ['tierno', '如果你的桌面上有牠們，就可以一起超級進化了！然後一起跳舞！'],
      ['shauna', '以後也要常常打給我們喔！'],
    ],
    reward: { starter: 'others' },
  },
  {
    id: 'looker', special: true, requires: 'flare-hq', day: 35, when: ({ hour }) => hour >= 19 || hour < 4, kind: 'battle', title: '國際刑警',
    lines: [
      ['looker', '晚安。我是國際刑警，代號「帥哥」。'],
      ['looker', '最近有人在夜裡被催眠，醒來以後什麼都不記得。現場都有一隻烏賊王。'],
      ['looker', '牠剛剛出現在你的桌面附近了。……不，就在這裡！小心！'],
    ],
    battle: { foes: [687], power: 1.15 },
    win: [['looker', '烏賊王清醒了。原來是被閃焰隊剩下的人控制著。'], ['looker', '牠身上掉下來這顆烏賊王進化石。給你保管，這是證物……也是謝禮。']],
    lose: [['looker', '撤退！明天晚上，我們再來埋伏。']],
    reward: { items: ['malamarite'] },
  },
  {
    id: 'other-legend', special: true, requires: 'finale', day: 46, kind: 'legend', legend: 'other', title: '另一個傳說',
    when: ({ hour, version }) => (version === 'y' ? hour >= 5 && hour < 11 : hour >= 20 || hour < 4),
    lines: [
      ['sycamore', '打擾了！研究所剛剛觀測到一股很奇怪的能量。'],
      ['sycamore', '跟你遇到的那隻傳說寶可夢，剛好相反的能量。'],
      ['sycamore', '生命與毀滅，是一體的兩面。牠大概是來找牠的另一半吧。'],
    ],
  },
  {
    id: 'zygarde-hint', special: true, requires: 'finale', day: 48, kind: 'letter', title: '洞窟深處', from: 'looker',
    text: [
      '冠軍：',
      '',
      '調查閃焰隊的時候，我在一個很深的洞窟裡看到了奇怪的東西。',
      '一顆一顆綠色的小細胞，會自己爬動。聽說集滿了，會出現守護卡洛斯生態的寶可夢。',
      '你的桌面上如果出現綠色的小東西，記得撿起來。',
      '',
      '國際刑警 帥哥',
    ].join('\n'),
  },
];

export const EVENT_BY_ID = Object.fromEntries(EVENTS.map(e => [e.id, e]));
export const MAIN = EVENTS.filter(e => !e.special);
export const SPECIALS = EVENTS.filter(e => e.special);

// ---------- 存檔 ----------
// retry：輸掉的對戰 { id, day, losses }（第幾天輸的，隔天才能再挑戰；輸了幾次，對手會弱一點）
export function defaultStory() {
  return { startedAt: null, version: null, done: [], log: [], lastAt: 0, retry: null };
}

export function normalizeStory(raw) {
  const d = defaultStory();
  if (!raw || typeof raw !== 'object') return d;
  d.startedAt = Number.isFinite(raw.startedAt) ? raw.startedAt : null;
  d.version = raw.version === 'x' || raw.version === 'y' ? raw.version : null;
  d.done = [...new Set((Array.isArray(raw.done) ? raw.done : []).filter(id => typeof id === 'string' && EVENT_BY_ID[id]))];
  d.log = (Array.isArray(raw.log) ? raw.log : [])
    .filter(e => e && typeof e.id === 'string' && EVENT_BY_ID[e.id] && Number.isFinite(e.at))
    .map(e => ({ id: e.id, at: e.at }))
    .sort((a, b) => a.at - b.at)
    .slice(-LOG_KEPT);
  d.lastAt = Number.isFinite(raw.lastAt) ? raw.lastAt : 0;
  const r = raw.retry;
  d.retry = r && EVENT_BY_ID[r.id]?.battle && Number.isFinite(r.day) && !d.done.includes(r.id)
    ? { id: r.id, day: r.day, losses: Math.max(1, Math.min(20, Math.floor(Number(r.losses) || 1))) } : null;
  return d;
}

// 同步：開始的時間取早的；做過的取聯集；版本取先做序章的那一邊
export function mergeStory(a, b) {
  const A = normalizeStory(a), B = normalizeStory(b);
  const out = defaultStory();
  const starts = [A.startedAt, B.startedAt].filter(v => v !== null);
  out.startedAt = starts.length ? Math.min(...starts) : null;
  const pro = s => s.log.find(e => e.id === 'prologue')?.at ?? Infinity;
  out.version = (pro(A) <= pro(B) ? A.version ?? B.version : B.version ?? A.version) ?? null;
  out.done = EVENTS.map(e => e.id).filter(id => A.done.includes(id) || B.done.includes(id));
  const log = new Map();
  for (const e of [...A.log, ...B.log]) if (!log.has(e.id) || log.get(e.id).at > e.at) log.set(e.id, { ...e });
  out.log = [...log.values()].sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1)).slice(-LOG_KEPT);
  out.lastAt = Math.max(A.lastAt, B.lastAt);
  // 輸掉的對戰：兩邊都有就取比較晚輸的那次
  const retry = [A.retry, B.retry].filter(r => r && !out.done.includes(r.id)).sort((x, y) => y.day - x.day)[0];
  out.retry = retry ? { ...retry } : null;
  return out;
}

// ---------- 時間 ----------
// 從序章那天算起的第幾天（照當地的日曆日，不是 24 小時）
export function storyDay(story, now) {
  if (story.startedAt === null) return 0;
  const a = new Date(story.startedAt), b = new Date(now);
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()), db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.max(0, Math.round((db - da) / DAY));
}

// 這場對戰輸過幾次
export const lossesOf = (story, id) => (story.retry?.id === id ? story.retry.losses : 0);

// 輸掉的對戰：同一天不能再打
const waitingRetry = (story, ev, day) => story.retry?.id === ev.id && day <= story.retry.day;

// 特別事件現在可以發生嗎
function specialReady(story, ev, now, day) {
  if (story.done.includes(ev.id) || !story.done.includes(ev.requires) || day < ev.day) return false;
  if (waitingRetry(story, ev, day)) return false;
  return !ev.when || ev.when({ hour: new Date(now).getHours(), version: story.version ?? 'x' });
}

// 下一件該發生的事；還沒到、或跟上一件隔不到 GAP_MS 就回傳 null。force：開發用，不看日子（也不看特別事件的條件）
export function nextDue(story, now, { force = false } = {}) {
  const next = MAIN.find(e => !story.done.includes(e.id));
  if (force) return next ?? SPECIALS.find(e => !story.done.includes(e.id) && story.done.includes(e.requires)) ?? null;
  if (story.startedAt === null) return next?.id === 'prologue' ? next : null;
  if (now - story.lastAt < GAP_MS) return null;
  const day = storyDay(story, now);
  if (next && day >= next.day && !waitingRetry(story, next, day)) return next;
  return SPECIALS.find(e => specialReady(story, e, now, day)) ?? null;
}

// 主線的下一件事還要幾天（故事頁用；不劇透是什麼事）。輸掉的對戰：明天
export function daysUntilNext(story, now) {
  const next = MAIN.find(e => !story.done.includes(e.id));
  if (!next) return null;
  const day = storyDay(story, now);
  if (waitingRetry(story, next, day)) return story.retry.day + 1 - day;
  return Math.max(0, next.day - day);
}

// 拿到的道館徽章（照順序）
export function badgesOf(story) {
  return MAIN.filter(e => e.battle?.badge && story.done.includes(e.id)).map(e => e.battle.badge);
}
export const isChampion = story => story.done.includes('champion-diantha');

export function markDone(story, id, now, { choice } = {}) {
  if (!EVENT_BY_ID[id] || story.done.includes(id)) return false;
  if (story.startedAt === null) story.startedAt = now;
  story.done.push(id);
  story.log = [...story.log, { id, at: now }].slice(-LOG_KEPT);
  story.lastAt = now;
  if (story.retry?.id === id) story.retry = null;
  if (id === 'prologue' && (choice === 'x' || choice === 'y')) story.version = choice;
  return true;
}

// 對戰輸了：今天先這樣，明天再來（也要隔 GAP_MS 才會有下一件事）
export function markLost(story, id, now) {
  if (!EVENT_BY_ID[id]?.battle || story.done.includes(id)) return false;
  const losses = story.retry?.id === id ? story.retry.losses + 1 : 1;
  story.retry = { id, day: storyDay(story, now), losses };
  story.lastAt = now;
  return true;
}
