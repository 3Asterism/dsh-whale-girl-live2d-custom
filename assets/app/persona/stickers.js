/**
 * persona/stickers.js —— 表情包「什么时候用哪张」：纯数据，没有逻辑。
 *
 * 素材：赤风RED（https://space.bilibili.com/356746604）《蓝色大肥鱼》，已压成 96×96 的小 GIF（assets/stickers）。原图 157 张**全部入选**，
 * test-stickers 会检查每一张都挂在了至少一个池子里（不浪费素材）。
 * 每张图的梗与真实含义写在 tools/stickers.curation.json 的 meme 字段——**按梗用，不按字面用**：
 *   · jail（坐牢）＝中文 meme「被困住、反复折磨」→ 用在「又失败了」，不是真坐牢
 *   · fine（一切都好）＝ This is fine，着火了还说没事 → 连续失败仍在硬撑
 *   · stopped（停止工作）＝ Windows 弹窗「已停止工作」＝崩了
 *   · clown（小丑）＝「小丑竟是我自己」→ 她的提议被拒了，自嘲
 *   · beg（要米）＝要饭卖惨 → 钱包余额不足
 *   · slack（带薪拉屎）＝上班借口如厕摸鱼 → 工具跑太久，她「摸鱼」；跑完了跳「散味舞」
 *   · dance_calm（低皮质醇）＝放松、没压力 → 顺利收工 / 下班 / 谷价
 *   · uno（反转）＝ UNO 反转卡，把锅甩回去
 *   · Bug 全家桶（bug / spray 喷剂 / swat 拍蝇 / gun 枪）＝出 bug 与「把虫子拍死」：失败时出 bug，修好了出拍蝇
 *   · raid（Raid）＝直播间「突袭」举牌，也是 Raid 杀虫剂 → 分身 / 工作流出击
 *   · popcat（Popcat）＝猫嘴一张一合「啵」的点击小游戏 → 连着戳她
 *   · six7（六七）＝ 67 梗（Doot Doot 6-7），模棱两可「差不多吧」→ 主人打出 67 / 六七
 *   · fatnote（呆·贴纸）＝额头贴着「肥鱼」便利贴 → **反差萌**：她嘴上死活不认，图却自己蹦出来
 *   · hypno（催眠）＝催眠「你该睡觉了」→ 深夜哄主人去睡（小只妈妈哄睡）
 *   · cola（摇可乐）＝肥宅快乐水；hit_bits（被 Bits 砸中）＝直播打赏 → token 里程碑
 *   · knife / crowbar（刀 / 撬棍）＝病娇吃醋 / Half-Life 撬棍：卡通无血腥，只在「吃醋」「权限全开」这种夸张场合用
 * 想加图：先在 curation 里挑进来、重跑 tools/build-stickers.py，再到这里挂到 mood / 事件 / 动作词 / 单发池上。
 * 选图规则（优先级、时长过滤、去重）在 ui/sticker-pick.js。
 */

/**
 * 好感等级放出：越亲近，她越敢用这些「黏人」的图（傲娇 → 黏人，等级只解锁内容、不锁任何功能）。
 * 没写的图不限等级。低等级时这些图会被跳过，改用同一个池子里别的图 / 下一个候选池。
 */
export const MIN_LEVEL = {
  love1: 3,
  love2: 3,
  love3: 3,
  hit_heart: 3,
  notice_heart: 3,
  loveletter: 5,
  rose: 5,
}

/** 情绪（脸）→ 候选。键沿用 persona/moods.js 的 mood。 */
export const MOOD_STICKER = {
  listening: ['nod', 'point'],
  thinking: ['think_confident', 'think_serious', 'fan_fold'],
  reading: ['think_serious', 'note1', 'note2', 'work'],
  happy: ['smile', 'thumbs_up', 'nod', 'cheer', 'smile_point', 'dance1', 'guitar'],
  excited: ['expect1', 'expect2', 'crave_fork', 'gift1', 'gift2', 'glowstick', 'magic', 'cheer', 'popcat1', 'dance_caramell', 'dance_helltaker', 'redpacket2'],
  love: ['love1', 'love2', 'love3', 'loveletter', 'rose', 'hit_heart'],
  shy: ['shy1', 'shy2', 'lick', 'headpat', 'cheeseface'],
  pout: ['angry', 'slipper', 'slipper2', 'type_annoyed', 'type_mad'],
  smug: ['shades_loop', 'shades_glint', 'shades_off', 'shades_pixel', 'smile_point', 'wink', 'fan_fold', 'six7', 'cola'],
  playful: ['wink', 'smile_point', 'magic', 'cola', 'popcat2', 'six7_blank', 'peek1'],
  sad: ['cry1', 'cry2', 'cry3', 'selfcomfort', 'sweat'],
  cry: ['cry1', 'cry2', 'cry3'],
  grumpy: ['angry', 'slipper', 'slipper2', 'hit_slipper', 'work_angry', 'type_mad'],
  angry: ['angry', 'slipper', 'slipper2', 'hit_slipper', 'work_angry', 'type_mad'],
  dizzy: ['dizzy', 'hypno'],
  gloomy: ['selfcomfort', 'work_tired', 'blank3'],
  sweat: ['sweat', 'nervous1', 'nervous2', 'afraid2'],
  confused: ['question', 'blank1', 'blank2', 'blank3', 'six7_blank'],
  alert: ['exclaim', 'scared', 'afraid1', 'megaphone'],
  sleepy: ['work_nap', 'sleep_prep1', 'sleep_prep2', 'hypno'],
  tongue: ['wink', 'lick', 'cola', 'cheeseface'],
  dead: ['dead', 'trash', 'cry3'],
}

/**
 * 事件 → 候选。键是 perform() 的 `say`（台词库 id）或 `id`（表演 id）；say 优先。
 * 覆盖 mood 池：事件本身的含义比「当时是什么脸」更准。
 */
export const EVENT_STICKER = {
  // —— 触碰 ——
  stroke1: ['headpat'],
  stroke2: ['love1', 'shy1', 'love3'],
  stroke3: ['work_nap', 'sleep_prep1'],
  lift: ['dizzy', 'scared', 'afraid1'],
  drop: ['sweat'],
  wakeGrumpy: ['angry', 'type_mad'],
  feedHover: ['crave_fork', 'crave_chop'],
  feedEat: ['eat_melon', 'eat_popcorn', 'eat_donut', 'cheeseface'],
  feedAsk: ['lick'],
  feedFail: ['sweat', 'cheeseface'],
  // 连着戳她：Popcat（猫嘴一张一合「啵」的点击小游戏）
  'poke-ticklish': ['popcat1', 'popcat2'],
  'poke-furious': ['angry', 'type_mad', 'slipper2', 'afraid2'],
  // —— 她自己的工具栏 / DSH 界面操作 ——
  show: ['arrive', 'hello1', 'peek1'],
  newSession: ['expect1', 'expect2', 'idea'],
  deleteSession: ['cry2', 'cry3'],
  settings: ['nervous1'],
  terminal: ['type'],
  files: ['work'],
  stopBtn: ['exclaim'],
  regen: ['uno'], // 重新生成：「刚才那个不算！」＝ UNO 反转
  themeDark: ['work_nap', 'sleep_prep1'],
  planOn: ['think_serious', 'fan_fold'],
  planOff: ['idea'],
  feedbackUp: ['score10', 'thumbs_up'],
  feedbackDown: ['score0', 'thumbs_down'],
  recall: ['uno', 'sweat', 'tape'], // 撤回：话收回去，胶带封口
  welcomeBack: ['arrive', 'peek2'],
  welcomeLong: ['love1', 'arrive', 'love3'],
  // —— agent 事件 ——
  todoAll: ['celebrate'],
  compactStart: ['note1', 'note2'],
  compactPrune: ['spray', 'trash'],
  compactSummary: ['note1', 'note2', 'draw'],
  compactLong: ['sweat', 'work_tired', 'dizzy'],
  compactEnd: ['smile', 'spray', 'headpat'],
  approval0: ['question'],
  approval1: ['bell', 'point'], // 摇铃催主人 / 伸手指着「就是你」
  approval2: ['nervous1', 'megaphone'],
  approval3: ['work_nap', 'sleep_prep2'],
  approvalYes: ['thumbs_up', 'nod'],
  approvalNo: ['clown1', 'clown2'], // 提议被拒：小丑竟是我自己（梗按真实含义用，别往池子里掺别的）
  retry1: ['sweat', 'stopped', 'bug'],
  retry3: ['fine1', 'fine2', 'fine3'], // 重试三次还嘴硬：This is fine
  retryOk: ['smile', 'swat'],
  danger: ['exclaim', 'scared', 'afraid1', 'afraid2'],
  longTool1: ['slack_easy'], // 工具跑太久：带薪拉屎（摸鱼）
  longTool2: ['slack_hard'],
  longToolDone: ['dance_smell'], // 跑完了：散味舞
  subagent1: ['magic', 'raid1'],
  subagentN: ['magic', 'raid2'],
  workflowStart: ['raid1', 'raid2'], // Raid 举牌：分身出击
  workflowEnd: ['toast', 'celebrate', 'dance_smell'],
  teamActivity: ['megaphone', 'raid1', 'raid2'],
  yoloOn: ['shades_loop', 'shades_glint', 'crowbar1'], // 权限全放开：撬棍（撬开所有门）
  yoloOff: ['shades_off'],
  goalSet: ['idea'],
  goalDone: ['celebrate', 'cake', 'gift1'],
  deliver: ['smile', 'celebrate', 'snap_phone', 'snap_cam'],
  finishHeavy: ['shades_pixel', 'shades_off'],
  finishBurn: ['burn1', 'burn2'], // 烧 token
  finishMarathon: ['fan1', 'fan2'], // 跑了很久：机器发烫，电风扇降温
  finishRecover: ['cheer', 'celebrate', 'swat', 'spray'], // 失败后终于过了：虫子被拍死
  streakFail: ['selfcomfort', 'jail2'],
  lowBalance: ['dead'],
  peakOn: ['swipe', 'burn1'],
  valleyOn: ['takemoney', 'dance_calm'],
  balanceBack: ['easter', 'redpacket2', 'money'], // 余额回来了：复活节（复活）
  titleSet: ['note1', 'draw'],
  // —— 关键词 ——
  kwFat: ['fatnote1', 'fatnote2', 'fatnote3', 'fatnote1', 'fatnote2', 'angry', 'slipper'], // 反差萌：嘴上不认，「肥鱼」便利贴自己蹦出来
  kwPraise: ['shy2', 'thumbs_up', 'love3'],
  kwHungry: ['crave_fork', 'crave_chop', 'arrive_spoon', 'arrive_chop'],
  kwScold: ['cry2', 'sweat', 'cry3', 'bonk'], // 被骂笨：自己敲自己脑袋
  kwNight: ['work_nap', 'sleep_prep1', 'hypno'],
  kwOff: ['dance_calm', 'toast', 'dance1'],
  kwMama: ['shy1', 'headpat', 'cheeseface'],
  kwMother: ['shy1', 'sweat', 'headpat'], // 「能成为我母亲的女性」（逆袭的夏亚）
  kwBaby: ['sweat', 'shy2', 'cheeseface'], // バブみ / 妈妈味
  kwHealer: ['magic', 'cheer', 'headpat'], // 奶妈（游戏里的治疗）
  kwBug: ['swat', 'spray', 'gun', 'bug'],
  kw67: ['six7', 'six7_blank'],
  kwSlack: ['game', 'guitar', 'cola', 'slack_easy'],
  kwPrice: ['burn1', 'burn2', 'takemoney'],
  kwLaugh: ['smile_point', 'popcat1', 'popcat2'],
  kwDrink: ['cola', 'drink'],
  kwSong: ['guitar', 'sing'],
  kwParty: ['gift1', 'redpacket2', 'redpacket1', 'cake', 'celebrate'],
  kwSnap: ['snap_phone', 'snap_cam'],
  kwQuiet: ['tape', 'mute1', 'mute2'],
  kwSleep: ['hypno', 'sleep_prep1', 'sleep_prep2'],
  kwHot: ['fan1', 'fan2'],
  // —— 时间与日常 ——
  greetMorning: ['hello1', 'hello2', 'peek1'],
  greetNoon: ['crave_fork', 'arrive_chop'],
  greetAfternoon: ['work_tired', 'cola'],
  greetEvening: ['drink', 'guitar'],
  greetLate: ['work_tired', 'hypno'],
  lunch: ['crave_fork', 'crave_chop', 'arrive_spoon', 'arrive_chop', 'eat_popcorn'],
  tea: ['cake', 'eat_donut', 'cheeseface'],
  dinner: ['crave_fork', 'arrive_chop', 'arrive_spoon'],
  water: ['drink', 'cola'],
  sit: ['dance_calm', 'fan_fold'],
  sleepy1: ['hypno', 'sleep_prep1', 'work_nap'], // 23 点：小只妈妈哄睡（催眠）
  sleepy2: ['hypno', 'sleep_prep2', 'work_tired'],
  wrapup: ['toast', 'dance1'],
  weekend: ['work_tired', 'guitar'],
  monday: ['work_tired', 'jail2'],
  friday: ['expect1', 'dance_caramell'],
  pomoStart: ['work', 'type'],
  pomoEnd: ['cheer', 'toast', 'popcat1'],
  pomoBreakEnd: ['wink'],
  milestoneTurns: ['celebrate', 'notice_star', 'notice_like'],
  milestoneTokens: ['celebrate', 'notice_star', 'hit_bits', 'notice_bits', 'notice_coin'], // token 里程碑：直播间打赏
  milestoneDays: ['notice_heart', 'notice_whale'],
  levelUp: ['notice_heart', 'notice_whale'],
  // —— 礼物 ——
  giftRice: ['love1', 'love3'],
  giftParfait: ['cake', 'cheeseface'],
  giftTea: ['drink', 'cola'],
  giftBlanket: ['shy2', 'sleep_prep1'],
  giftCoffee: ['drink', 'cola'],
  giftSalad: ['angry', 'fatnote1'], // 递沙拉＝暗示她胖：嘴上炸毛，便利贴蹦出来
  giftScale: ['dead', 'fatnote2'], // 递体重秤：吐魂 / 便利贴
  giftCap: ['sweat'],
  giftNoTickets: ['cry2', 'cry3'],
  // —— 补齐：此前漏掉的台词 id（覆盖优先：绝大部分台词都该有图）——
  strokeEnd: ['blank1'], // 「诶？结束了吗…」
  holdStart: ['scared', 'nervous1'],
  holdEnd: ['sweat'],
  wakeFix: ['wink', 'smile'],
  feedYes: ['cheer', 'nod'],
  feedNo: ['blank1', 'wink', 'headshake'],
  openTalk: ['nod', 'hello1', 'point'],
  openMenu: ['magic', 'wink'],
  hide: ['trash', 'peek2'], // 「缩起来躲一躲」
  switchSession: ['question'],
  sidebarOpen: ['note2'],
  sidebarClose: ['smile'],
  browser: ['think_confident', 'fan_fold'],
  copy: ['wink', 'smile_point'],
  modelSwitch: ['question', 'nervous1'],
  themeLight: ['exclaim'],
  kwTired: ['headpat', 'drink', 'selfcomfort', 'love2'], // 主人说累：递白饭、拍拍、小只妈妈
  kwWork: ['uno'], // 甲方又改需求：把锅甩回去
  giftOmurice: ['crave_fork', 'cake', 'arrive_spoon'],
  awayNight: ['work_nap', 'sleep_prep2'],
  awayDay: ['hello1', 'work', 'guitar'],
  awayEvening: ['drink', 'hello2'],
  storyOffer: ['expect2', 'shy1'],
  storyLater: ['wink'],
  memoryNew: ['notice_star', 'note1', 'note2'],
  streak: ['celebrate', 'notice_star', 'notice_like'],
  bondOff: ['blank1', 'cry2'],
  bondOn: ['love1', 'hello1', 'love3'],
  hungryAsk: ['crave_fork', 'crave_chop', 'lick'],
  stuffedNo: ['angry', 'slipper', 'fatnote3', 'headshake'], // 「才没有吃撑」：摇头
  commandRun: ['nod', 'cheer', 'button'],
  // —— 直接传台词（没走 say 池）的表演：按表演 id 配 ——
  wake: ['blank1', 'question', 'peek1'],
  'idle-mutter': ['blank1', 'sing', 'wink', 'think_confident', 'work_tired', 'guitar', 'cola'], // 待机碎碎念
  'idle-hungry': ['crave_fork', 'crave_chop', 'lick'],
  'idle-yawn': ['sleep_prep1', 'work_nap'],
  'menu-tidy': ['work', 'note2'],
  'finish-abort': ['cry2', 'sweat', 'cry3'],
  'tool-error': ['stopped', 'bug', 'type_mad'],
  // —— v0.5.1 新场景（behavior/soul.js）——
  modelAway: ['nervous1', 'blank2', 'knife1', 'knife2'], // 换成别家的模型：病娇式吃醋（卡通刀，无血腥）
  modelBack: ['arrive', 'peek2'], // 换回 DeepSeek
  effortUp: ['think_serious', 'fan1'],
  effortDown: ['dance_calm', 'fan_fold'],
  sandboxFull: ['nervous2', 'crowbar1', 'crowbar2', 'crowbar3'], // 权限全开：撬棍（把所有门撬开）
  sandboxReadonly: ['blank1', 'tape', 'headshake'], // 只读：捂手 / 胶带封口 / 摇头（不行）
  askUserWait: ['bell', 'point', 'megaphone'],
  personaSwitch: ['magic'],
  scheduleNew: ['note2', 'note1'],
  scheduleFire: ['bell', 'megaphone'],
  regenMany: ['nervous1', 'cry3', 'dizzy'],
  idleInput: ['think_confident', 'fan_fold'],
  idleLong: ['blank1', 'blank3', 'game'],
  idleLonger: ['dance_calm', 'guitar'],
  lowBalanceBeg: ['beg'],
  wishToday: ['expect1', 'expect2', 'hello2'],
  wishDone: ['celebrate', 'cheer', 'score10'],
  albumMilestone: ['notice_star', 'celebrate'],
  albumFull: ['celebrate', 'cake', 'gift1'],
  weekRecap: ['toast', 'note1', 'note2', 'dance_calm'],
  thinkLong: ['think_serious', 'fan_fold'],
  thinkLonger: ['sweat', 'cola'], // 想得太久：摇可乐憋大招
  failJail: ['jail', 'jail2'], // 又失败了：坐牢
  failFine: ['fine1', 'fine2', 'fine3'], // 连续失败还硬撑：This is fine
  rejectClown: ['clown1', 'clown2'],
  // —— v0.6.8：开发动作（shell 命令里认出来的）与每日一签 ——
  // —— v0.6.8：复合故事 / 观察者的轻话 / 安慰（careGentle、careHelp 刻意不配图）——
  storyShip: ['celebrate', 'cheer', 'dance_calm'],
  storyPush: ['drive', 'arrive', 'cheer'], // 驾驶＝发车上路
  storyCommit: ['button', 'note1', 'celebrate'],
  storyDebugWin: ['cheer', 'celebrate', 'swat'], // 把虫子拍死
  storyEnv: ['eat_donut', 'work', 'arrive'],
  storyTested: ['thumbs_up', 'nod', 'score10'],
  storyRedCommit: ['sweat', 'nervous1'],
  storyRedEnd: ['sweat', 'selfcomfort'],
  storyNoTest: ['question', 'nervous1'],
  storyPlanDone: ['celebrate', 'idea', 'note1'],
  storyRollback: ['headpat', 'selfcomfort', 'cheer'],
  storyRegression: ['sweat', 'bug', 'nervous1'],
  storyCmdLoop: ['dizzy', 'jail', 'sweat'],
  storyThrash: ['dizzy', 'question', 'sweat'],
  storyUnverified: ['question', 'nervous1'],
  storyCheckpoint: ['button', 'note1', 'point'],
  storyInstallFail: ['question', 'bug'],
  storyLongSession: ['peek1', 'work_tired', 'hypno'],
  secretAdd: ['exclaim', 'afraid1', 'scared'],
  finishRelief: ['celebrate', 'cheer', 'dance_calm'],
  restartAfterFail: ['idea', 'hello1'],
  empathyRage: ['headpat', 'selfcomfort', 'love2'],
  empathyLoop: ['headpat', 'think_serious', 'selfcomfort'],
  empathyFail: ['selfcomfort', 'headpat', 'jail2'],
  empathyReject: ['sweat', 'headpat'],
  empathyLate: ['hypno', 'sleep_prep1', 'work_nap'],
  empathyHard: ['headpat', 'love2', 'selfcomfort'],
  breakStart: ['drink', 'dance_calm'],
  breakEnd: ['wink', 'cheer'],
  breakNo: ['wink'],
  fortuneOffer: ['expect1', 'expect2', 'magic'],
  fortuneNo: ['wink'],
  fortuneAgain: ['point'],
  fortuneBig: ['celebrate', 'cheer', 'dance_caramell'],
  fortuneMid: ['thumbs_up', 'smile'],
  fortuneSmall: ['nod', 'smile'],
  fortuneEnd: ['wink', 'sweat'],
  fortuneBad: ['headpat', 'selfcomfort', 'love2'],
  // —— v0.5.7：界面操作（behavior/page.js；标签是中英双语的最佳猜测，对不上就不触发，无副作用）——
  pageAttach: ['gift1', 'gift2'],
  pageShare: ['megaphone', 'celebrate'],
  pageExport: ['gift1', 'snap_phone'],
  pageSearch: ['think_confident', 'point'],
  pageVoice: ['sing', 'megaphone'],
  pagePin: ['note1', 'button'],
  pageRename: ['draw', 'note2'],
  pageFork: ['raid1', 'raid2'],
  pageUndo: ['uno', 'tape'],
  pageEdit: ['draw', 'type'],
  pageHelp: ['question', 'headpat'],
}

/**
 * 单发图池：**不带台词**，只丢一张图（小气泡，停留时间由图自己决定）。perform({ solo: '池名' }) 用。
 * 台词是话，图是「她在做什么」——没人理她的时候，她自己找点事做。
 */
export const SOLO_STICKER = {
  // —— 待机：主人一阵子没动静，她自己找点事做（idle.js / soul.js）——
  idle: ['game', 'guitar', 'sing', 'draw', 'drive', 'eat_popcorn', 'drink', 'cola', 'dance1', 'dance_caramell', 'dance_helltaker', 'peek1', 'peek2', 'blank3', 'popcat1', 'fan_fold', 'six7_blank', 'eat_donut', 'cheeseface', 'easter', 'snap_phone', 'wink'],
  idleGame: ['game'], // 没操作一阵子：摸鱼打游戏
  idleNight: ['sleep_prep1', 'hypno', 'blank3', 'work_nap', 'cola'],
  idleMeal: ['crave_chop', 'crave_fork', 'arrive_spoon', 'arrive_chop', 'eat_donut', 'eat_popcorn'],
  idleHappy: ['dance1', 'dance_caramell', 'dance_helltaker', 'dance_calm', 'guitar', 'sing', 'dance_smell'],
  idleBlue: ['selfcomfort', 'cry3', 'mute1', 'work_tired', 'blank3'],
  idleSleep: ['sleep', 'sleep_uu', 'sleep_prep2'], // 睡着了
  // —— 深度思考（reasoning 增量）——
  thinking: ['thinking'],
  // —— 钱 ——
  coinRain: ['hit_coin', 'notice_coin', 'money'],
  luckyMoney: ['redpacket1', 'redpacket2'],
}

/**
 * 兜底池：台词既没有事件映射、也没有括号动作词、也没有情绪时才用——保证绝大部分台词都有图。
 * 只放「几乎配什么话都不违和」的：笑 / 点头 / 眨眼 / 发呆。
 */
export const FALLBACK_STICKER = ['smile', 'nod', 'wink', 'blank1', 'smile_point']

/**
 * 常驻气泡（工具调用 / 开工 / 思考）配什么图。它们一轮里会反复出现，所以：
 *   · 图只播 2 圈（≤4s）就淡出，见 ui/sticker-pick.js；
 *   · 用 pool + gapMs 节流（STICKY_GAP_MS），干活时图不会一直在换。
 * ask_user_question / read_image 是「有意义的事件」，不节流（见 behavior/events.js）。
 */
export const TOOL_STICKER = {
  ask_user_question: ['question'], // 举牌问号；「就是你」的 point 留给等太久（approval1 / askUserWait）
  read_image: ['think_confident', 'snap_phone', 'snap_cam'],
  todo_write: ['note1', 'note2'],
  bash: ['type', 'work'],
  pwsh: ['type', 'work'],
  write: ['type', 'work'],
  edit: ['type', 'work'],
  str_replace_editor: ['type', 'work'],
  read: ['think_serious', 'note2'],
  glob: ['think_serious'],
  grep: ['think_serious', 'swat'], // 搜代码＝抓虫
  web_search: ['think_confident', 'fan_fold'],
  web_fetch: ['think_confident', 'fan_fold'],
  kb_search: ['note1', 'think_serious'],
  kb_rag: ['note1', 'think_serious'],
  kb_ingest: ['eat_melon', 'note2'], // 文献入库：啃下去
  search_papers: ['note1', 'fan_fold'],
  auto_cite: ['note2'],
  present: ['celebrate', 'smile', 'snap_phone'],
  skill: ['note2', 'magic'],
  subagent: ['magic', 'raid1'],
  subagent_fork: ['magic', 'raid2'],
  workflow: ['raid1', 'raid2'],
  ralph: ['popcat1', 'popcat2'], // 循环再循环：Popcat
  create_goal: ['idea'],
  update_goal: ['idea'],
  sci_draw: ['draw'],
  pdf_create: ['draw', 'note2'],
  docx_create: ['draw', 'note2'],
  xlsx_write: ['note2', 'type'],
  pptx_create: ['draw', 'magic'],
}
/** 一轮开工 / 步骤里的「在想」常驻台词（SAY.start / SAY.thinking）。 */
export const START_STICKER = ['cheer', 'nod', 'smile']
export const THINKING_STICKER = ['think_confident', 'think_serious']
/** 常驻气泡配图的最短间隔（毫秒）：干活时图不要一直换。 */
export const STICKY_GAP_MS = 20000

/**
 * 台词里的全角括号动作词 → 候选。台词写「（戴墨镜）…」就配墨镜，话和图才对得上。
 * 只匹配括号里的内容；先匹配到的优先。
 */
export const ACTION_STICKER = [
  [/墨镜/, ['shades_loop', 'shades_glint']],
  [/吐魂/, ['dead']],
  [/举牌|扯袖子|戳戳/, ['question', 'bell']],
  [/催眠|怀表|哄睡/, ['hypno']],
  [/打哈欠|哈欠|瞌睡|趴桌|打盹|睡着|裹毯子|拉被子/, ['sleep_prep1', 'work_nap']],
  [/脸红|害羞|耳朵红/, ['shy1', 'shy2']],
  [/冒爱心|心跳/, ['love1', 'love2', 'love3']],
  [/冷汗|擦汗|流汗|冒汗|慌张|紧张/, ['sweat', 'nervous1']],
  [/哭|眼泪/, ['cry1', 'cry2', 'cry3']],
  [/鼓脸|叉腰|炸毛|起床气|扭头|别过脸/, ['angry']],
  [/歪头/, ['question']],
  [/嚼|啊呜|咽/, ['eat_popcorn', 'eat_donut']],
  [/递热水|端茶|喝|咕噜/, ['drink']],
  [/摇可乐|开可乐/, ['cola']],
  [/击掌|比耶|撒花|鼓掌/, ['celebrate', 'cheer']],
  [/敲键盘|噼里啪啦|奋笔疾书/, ['type']],
  [/钓鱼|摸鱼|打游戏|玩游戏/, ['slack_easy', 'game']],
  [/散味/, ['dance_smell']],
  [/吐舌|眨眼|闭一只眼|眯一只眼/, ['wink']],
  [/挽袖子/, ['cheer']],
  [/拍苍蝇|拍虫|拍子|喷剂|杀虫|举枪/, ['swat', 'spray', 'gun']],
  [/吉他|弹琴|哼歌|唱歌/, ['guitar', 'sing']],
  [/自拍|举手机|抓拍|合影|拍照/, ['snap_phone', 'snap_cam']],
  [/胶带|捂嘴|封口|静音/, ['tape', 'mute1', 'mute2']],
  [/电风扇|扇风|挥扇|散热/, ['fan1', 'fan2', 'fan_fold']],
  [/拆礼物|拆/, ['gift1', 'gift2']],
  [/举喇叭|喇叭|喊话/, ['megaphone']],
  [/张开手|摸摸|拍拍|摸头/, ['headpat', 'love2']],
  [/复活/, ['easter']],
  [/探头|冒泡/, ['peek1', 'peek2']],
  [/撬/, ['crowbar1', 'crowbar2', 'crowbar3']],
  [/亮刀|磨刀/, ['knife1', 'knife2']],
  [/左右晃|六七/, ['six7', 'six7_blank']],
  [/着火|灭火|脚下着火/, ['burn1', 'burn2']],
  [/伸手指|指着/, ['point']],
]
