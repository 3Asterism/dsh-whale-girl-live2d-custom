/**
 * persona/stickers.js —— 表情包「什么时候用哪张」：纯数据，没有逻辑。
 *
 * 素材：赤风RED（https://space.bilibili.com/356746604）《蓝色大肥鱼》，已压成 96×96 的小 GIF（assets/stickers）。
 * 每张图的梗与真实含义写在 tools/stickers.curation.json 的 meme 字段——**按梗用，不按字面用**：
 *   · jail（坐牢）＝中文 meme「被困住、反复折磨」→ 用在「又失败了」，不是真坐牢
 *   · fine（一切都好）＝ This is fine，着火了还说没事 → 连续失败仍在硬撑
 *   · stopped（停止工作）＝ Windows 弹窗「已停止工作」＝崩了
 *   · clown（小丑）＝「小丑竟是我自己」→ 她的提议被拒了，自嘲
 *   · beg（要米）＝要饭卖惨 → 钱包余额不足
 *   · slack（带薪拉屎）＝上班借口如厕摸鱼 → 工具跑太久，她「摸鱼」
 *   · dance_calm（低皮质醇）＝放松、没压力 → 顺利收工 / 下班 / 谷价
 *   · uno（反转）＝ UNO 反转卡，把锅甩回去
 * 想加图：先在 curation 里挑进来、重跑 tools/build-stickers.py，再到这里挂到 mood / 事件 / 动作词上。
 * 选图规则（优先级、时长过滤、去重）在 ui/sticker-pick.js。
 */

/**
 * 好感等级放出：越亲近，她越敢用这些「黏人」的图（傲娇 → 黏人，等级只解锁内容、不锁任何功能）。
 * 没写的图不限等级。低等级时这些图会被跳过，改用同一个池子里别的图 / 下一个候选池。
 */
export const MIN_LEVEL = {
  love1: 3,
  love2: 3,
  hit_heart: 3,
  notice_heart: 3,
  loveletter: 5,
  rose: 5,
}

/** 情绪（脸）→ 候选。键沿用 persona/moods.js 的 mood。 */
export const MOOD_STICKER = {
  listening: ['nod'],
  thinking: ['think_confident', 'think_serious'],
  reading: ['think_serious', 'note2', 'work'],
  happy: ['smile', 'thumbs_up', 'nod', 'cheer', 'smile_point'],
  excited: ['expect2', 'crave_fork', 'gift2', 'glowstick', 'magic', 'cheer'],
  love: ['love1', 'love2', 'loveletter', 'rose', 'hit_heart'],
  shy: ['shy1', 'shy2', 'lick', 'headpat'],
  pout: ['angry', 'slipper', 'type_annoyed'],
  smug: ['shades_loop', 'shades_glint', 'shades_off', 'shades_pixel', 'smile_point', 'wink'],
  playful: ['wink', 'smile_point', 'magic'],
  sad: ['cry1', 'cry2', 'selfcomfort', 'sweat'],
  cry: ['cry1', 'cry2'],
  grumpy: ['angry', 'slipper', 'hit_slipper', 'work_angry'],
  angry: ['angry', 'slipper', 'hit_slipper', 'work_angry'],
  dizzy: ['dizzy'],
  gloomy: ['selfcomfort', 'work_tired'],
  sweat: ['sweat', 'nervous1', 'nervous2'],
  confused: ['question', 'blank1', 'blank2'],
  alert: ['exclaim', 'scared'],
  sleepy: ['work_nap'],
  tongue: ['wink', 'lick'],
  dead: ['dead', 'trash'],
}

/**
 * 事件 → 候选。键是 perform() 的 `say`（台词库 id）或 `id`（表演 id）；say 优先。
 * 覆盖 mood 池：事件本身的含义比「当时是什么脸」更准。
 */
export const EVENT_STICKER = {
  // —— 触碰 ——
  stroke1: ['headpat'],
  stroke2: ['love1', 'shy1'],
  stroke3: ['work_nap'],
  lift: ['dizzy', 'scared'],
  drop: ['sweat'],
  wakeGrumpy: ['angry'],
  feedHover: ['crave_fork'],
  feedEat: ['eat_melon', 'eat_popcorn'],
  feedAsk: ['lick'],
  feedFail: ['sweat'],
  // —— 她自己的工具栏 / DSH 界面操作 ——
  show: ['arrive', 'hello1'],
  newSession: ['expect2', 'idea'],
  deleteSession: ['cry2'],
  settings: ['nervous1'],
  terminal: ['type'],
  files: ['work'],
  stopBtn: ['exclaim'],
  regen: ['uno'], // 重新生成：「刚才那个不算！」＝ UNO 反转
  themeDark: ['work_nap'],
  planOn: ['think_serious'],
  planOff: ['idea'],
  feedbackUp: ['score10', 'thumbs_up'],
  feedbackDown: ['score0', 'thumbs_down'],
  recall: ['uno', 'sweat'],
  welcomeBack: ['arrive'],
  welcomeLong: ['love1', 'arrive'],
  // —— agent 事件 ——
  todoAll: ['celebrate'],
  compactStart: ['note2'],
  compactEnd: ['smile'],
  approval0: ['question'],
  approval1: ['bell'], // 摇铃催主人
  approval2: ['nervous1'],
  approval3: ['work_nap'],
  approvalYes: ['thumbs_up', 'nod'],
  approvalNo: ['clown1', 'clown2'], // 提议被拒：小丑竟是我自己
  retry1: ['sweat', 'stopped'],
  retry3: ['fine1', 'fine2'], // 重试三次还嘴硬：This is fine
  retryOk: ['smile'],
  danger: ['exclaim', 'scared'],
  longTool1: ['slack_easy'], // 工具跑太久：带薪拉屎（摸鱼）
  longTool2: ['slack_hard'],
  subagent1: ['magic'],
  subagentN: ['magic'],
  yoloOn: ['shades_loop', 'shades_glint'],
  yoloOff: ['shades_off'],
  goalSet: ['idea'],
  goalDone: ['celebrate', 'cake'],
  deliver: ['smile', 'celebrate'],
  finishHeavy: ['shades_pixel', 'shades_off'],
  finishRecover: ['cheer', 'celebrate'],
  streakFail: ['selfcomfort'],
  lowBalance: ['dead'],
  peakOn: ['swipe'],
  valleyOn: ['takemoney', 'dance_calm'],
  // —— 关键词 ——
  kwFat: ['angry', 'slipper'],
  kwPraise: ['shy2', 'thumbs_up'],
  kwHungry: ['crave_fork'],
  kwScold: ['cry2', 'sweat'],
  kwNight: ['work_nap'],
  kwOff: ['dance_calm', 'toast'], // 下班：低皮质醇
  kwMama: ['shy1'],
  // —— 时间与日常 ——
  greetMorning: ['hello1', 'hello2'],
  greetNoon: ['crave_fork'],
  greetAfternoon: ['work_tired'],
  greetEvening: ['drink'],
  greetLate: ['work_tired'],
  lunch: ['crave_fork', 'eat_popcorn'],
  tea: ['cake'],
  dinner: ['crave_fork'],
  water: ['drink'],
  sit: ['dance_calm'],
  sleepy1: ['work_nap'],
  sleepy2: ['work_nap', 'work_tired'],
  wrapup: ['toast'],
  weekend: ['work_tired'],
  monday: ['work_tired'],
  friday: ['expect2'],
  pomoStart: ['work'],
  pomoEnd: ['cheer', 'toast'],
  pomoBreakEnd: ['wink'],
  milestoneTurns: ['celebrate', 'notice_star'],
  milestoneTokens: ['celebrate', 'notice_star'],
  milestoneDays: ['notice_heart'],
  levelUp: ['notice_heart'],
  // —— 礼物 ——
  giftRice: ['love1'],
  giftParfait: ['cake'],
  giftTea: ['drink'],
  giftBlanket: ['shy2'],
  giftCoffee: ['drink'],
  giftSalad: ['angry'],
  giftScale: ['dead'],
  giftCap: ['sweat'],
  giftNoTickets: ['cry2'],
  // —— 补齐：此前漏掉的台词 id（覆盖优先：绝大部分台词都该有图）——
  strokeEnd: ['blank1'], // 「诶？结束了吗…」
  holdStart: ['scared', 'nervous1'],
  holdEnd: ['sweat'],
  wakeFix: ['wink', 'smile'],
  feedYes: ['cheer', 'nod'],
  feedNo: ['blank1', 'wink'],
  openTalk: ['nod', 'hello1'],
  openMenu: ['magic', 'wink'],
  hide: ['trash'], // 「缩起来躲一躲」
  switchSession: ['question'],
  sidebarOpen: ['note2'],
  sidebarClose: ['smile'],
  browser: ['think_confident'],
  copy: ['wink', 'smile_point'],
  modelSwitch: ['question', 'nervous1'],
  themeLight: ['exclaim'],
  kwTired: ['headpat', 'drink', 'selfcomfort'], // 主人说累：递白饭、拍拍
  kwWork: ['uno'], // 甲方又改需求：把锅甩回去
  giftOmurice: ['crave_fork', 'cake'],
  awayNight: ['work_nap'],
  awayDay: ['hello1', 'work'],
  awayEvening: ['drink', 'hello2'],
  storyOffer: ['expect2', 'shy1'],
  storyLater: ['wink'],
  memoryNew: ['notice_star', 'note2'],
  streak: ['celebrate', 'notice_star'],
  bondOff: ['blank1', 'cry2'],
  bondOn: ['love1', 'hello1'],
  hungryAsk: ['crave_fork', 'lick'],
  stuffedNo: ['angry', 'slipper'], // 「才没有吃撑」
  commandRun: ['nod', 'cheer'],
  // —— 直接传台词（没走 say 池）的表演：按表演 id 配 ——
  wake: ['blank1', 'question'],
  'idle-mutter': ['blank1', 'sing', 'wink', 'think_confident', 'work_tired'], // 待机碎碎念
  'idle-hungry': ['crave_fork', 'lick'],
  'menu-tidy': ['work', 'note2'],
  'finish-abort': ['cry2', 'sweat'],
  'tool-error': ['stopped'],
  // —— v0.5.1 新场景（behavior/soul.js）——
  modelAway: ['nervous1', 'blank2'], // 换成别家的模型
  modelBack: ['arrive'], // 换回 DeepSeek
  effortUp: ['think_serious'],
  effortDown: ['dance_calm'],
  sandboxFull: ['nervous2'],
  sandboxReadonly: ['blank1'],
  askUserWait: ['bell'],
  personaSwitch: ['magic'],
  scheduleNew: ['note2'],
  scheduleFire: ['bell'],
  regenMany: ['nervous1'],
  idleInput: ['think_confident'],
  idleLong: ['blank1'],
  idleLonger: ['dance_calm'],
  lowBalanceBeg: ['beg'],
  wishToday: ['expect2', 'hello2'],
  wishDone: ['celebrate', 'cheer', 'score10'],
  albumMilestone: ['notice_star', 'celebrate'],
  albumFull: ['celebrate', 'cake'],
  weekRecap: ['toast', 'note2', 'dance_calm'],
  thinkLong: ['think_serious'],
  thinkLonger: ['sweat'],
  failJail: ['jail'], // 又失败了：坐牢
  failFine: ['fine1', 'fine2'], // 连续失败还硬撑：This is fine
  rejectClown: ['clown1', 'clown2'],
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
  ask_user_question: ['question'],
  read_image: ['think_confident'],
  todo_write: ['note2'],
  bash: ['type', 'work'],
  pwsh: ['type', 'work'],
  write: ['type', 'work'],
  edit: ['type', 'work'],
  str_replace_editor: ['type', 'work'],
  read: ['think_serious', 'note2'],
  glob: ['think_serious'],
  grep: ['think_serious'],
  web_search: ['think_confident'],
  web_fetch: ['think_confident'],
  present: ['celebrate', 'smile'],
  skill: ['note2'],
  subagent: ['magic'],
  workflow: ['magic'],
  create_goal: ['idea'],
  update_goal: ['idea'],
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
  [/哈欠|瞌睡|趴桌|打盹|睡着|裹毯子/, ['work_nap']],
  [/脸红|害羞|耳朵红/, ['shy1', 'shy2']],
  [/冒爱心|心跳/, ['love1', 'love2']],
  [/冷汗|擦汗|流汗|冒汗|慌张|紧张/, ['sweat', 'nervous1']],
  [/哭|眼泪/, ['cry1', 'cry2']],
  [/鼓脸|叉腰|炸毛|起床气|扭头|别过脸/, ['angry']],
  [/歪头/, ['question']],
  [/嚼|啊呜|咽/, ['eat_popcorn']],
  [/递热水|端茶|喝|咕噜/, ['drink']],
  [/击掌|比耶|撒花|鼓掌/, ['celebrate', 'cheer']],
  [/敲键盘|噼里啪啦|奋笔疾书/, ['type']],
  [/钓鱼|摸鱼/, ['slack_easy']],
  [/吐舌|眨眼|闭一只眼|眯一只眼/, ['wink']],
  [/挽袖子/, ['cheer']],
]
