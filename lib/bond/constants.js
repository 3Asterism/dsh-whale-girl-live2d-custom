/**
 * 羁绊系统的全部「规则表」。数值都在这一个文件里，改规则只改这里。
 * 这些表会原样发给前端的「好感」页展示——所以每一项都要写清楚，不留隐性设定。
 * 设计依据与参考的游戏见 docs/好感系统设计.md。
 */

/** 等级：累计羁绊值阈值、名称。台词档每 2 级一档（tier），摸头最高档随等级放开。 */
export const LEVELS = [
  { lv: 1, name: '初识', xp: 0, strokeMax: 1, unlock: '她还有点警惕，台词偏傲娇' },
  { lv: 2, name: '点头之交', xp: 40, strokeMax: 1, unlock: '羁绊故事《白饭的由来》' },
  { lv: 3, name: '同事', xp: 100, strokeMax: 2, unlock: '羁绊故事《加班的夜》；摸头能摸出爱心；她开始用爱心系的表情包' },
  { lv: 4, name: '饭搭子', xp: 180, strokeMax: 2, unlock: '羁绊故事《蛋包饭上的番茄酱》' },
  { lv: 5, name: '摸鱼搭档', xp: 290, strokeMax: 3, unlock: '羁绊故事《摸鱼许可证》；摸头能摸到眯眼；情书、玫瑰这类表情包放出' },
  { lv: 6, name: '知己', xp: 430, strokeMax: 3, unlock: '羁绊故事《其实人家怕黑》；全部台词放出' },
  { lv: 7, name: '挚友', xp: 600, strokeMax: 3, unlock: '羁绊故事《不是妈妈》；好感不再衰减' },
  { lv: 8, name: '家人', xp: 800, strokeMax: 3, unlock: '羁绊故事《关于大肥鱼》' },
  { lv: 9, name: '老伙计', xp: 1050, strokeMax: 3, unlock: '羁绊故事《如果有一天》' },
  { lv: 10, name: '命定', xp: 1350, strokeMax: 3, unlock: '羁绊故事《人家的愿望》；专属称号「命定」' },
]
export const MAX_LEVEL = LEVELS.length
/** 台词档（1–5）：每 2 级一档。 */
export const tierOf = (level) => Math.min(5, Math.ceil(Math.max(1, level) / 2))

/**
 * 羁绊值来源：gain 每次加多少，cd 冷却毫秒，cap 每日上限（次数）。
 * `turn` / `big` / `companion` 由宿主在一轮结束时自己结算，前端不能伸手（防刷）。
 */
export const SOURCES = {
  poke: { label: '戳她', gain: 1, cd: 10_000, cap: 10, how: '点一下她' },
  stroke: { label: '摸头', gain: 2, cd: 180_000, cap: 8, how: '鼠标在她头上来回划' },
  hold: { label: '捏脸', gain: 1, cd: 60_000, cap: 5, how: '按住她不动' },
  praise: { label: '被夸', gain: 2, cd: 30_000, cap: 8, how: '说谢谢 / 夸她 / 叫妈妈 / 给回答点赞' },
  daily: { label: '每日首见', gain: 3, cd: 0, cap: 1, how: '每天第一次对话' },
  turn: { label: '干活收工', gain: 2, cd: 0, cap: 20, how: '每完成一轮对话' },
  big: { label: '大功告成', gain: 5, cd: 0, cap: 3, how: '目标达成 / 交付成品' },
  companion: { label: '陪伴', gain: 1, cd: 0, cap: 8, how: '连续在干活，每满 30 分钟' },
  // 图鉴新页：她第一次用出一张你还没见过的表情包。只由宿主结算（前端上报「她用了哪张」，宿主按清单校验）
  album: { label: '图鉴新页', gain: 1, cd: 0, cap: 5, how: '她用出一张图鉴里还没有的表情包' },
}
/** 前端允许直接上报的来源（其余只由宿主结算）。 */
export const CLIENT_SOURCES = ['poke', 'stroke', 'hold', 'praise', 'daily']
/** 连续陪伴天数奖励（周末不断档）。 */
export const STREAK_REWARDS = { 3: 5, 7: 10, 14: 15, 30: 30 }
/** 解锁一条回忆的奖励。 */
export const MEMORY_XP = 3
/** 单日投喂次数上限；同一天同一礼物第 2 次起效果减半。 */
export const FEED_DAILY_CAP = 5
/** 陪伴：连续在干活的间隔不超过多久算「还在一起干」。 */
export const COMPANION_GAP_MS = 10 * 60_000
export const COMPANION_EVERY_MS = 30 * 60_000

/**
 * 今日心愿（原神每日委托 / 星露谷公告栏的低压版）：每天一个小心愿，做到了有一份小奖励，做不到**什么都不发生**——
 * 没有连续打卡、没有「昨天的心愿没完成」、不扣任何东西。心愿让她显得有自己的小想法，也顺手告诉你她喜欢什么。
 * 选择是按日期确定的（同一天固定一个）；投喂类心愿只在你有足够 token 时才会出，免得变成变相催你干活。
 */
export const WISH = { xp: 6, mood: 8, tickets: 1 }
export const WISHES = [
  { id: 'feed-rice', kind: 'feed', gift: 'rice', text: '今天想吃白饭', hint: '投喂一份白饭' },
  { id: 'feed-omurice', kind: 'feed', gift: 'omurice', text: '今天想吃蛋包饭', hint: '投喂一份蛋包饭（3 token）' },
  { id: 'feed-parfait', kind: 'feed', gift: 'parfait', text: '今天想吃巴菲', hint: '投喂一份巴菲（3 token）' },
  { id: 'feed-tea', kind: 'feed', gift: 'tea', text: '今天想喝热茶', hint: '投喂一杯热茶' },
  { id: 'stroke', kind: 'source', source: 'stroke', text: '今天想被摸摸头', hint: '鼠标在她头上来回划' },
  { id: 'praise', kind: 'source', source: 'praise', text: '今天想听主人夸一句', hint: '说「谢谢」「辛苦了」之类的话，或给回答点个赞' },
  { id: 'turns3', kind: 'turns', n: 3, text: '今天想陪主人干完 3 轮活', hint: '一起完成 3 轮对话' },
  { id: 'sticker', kind: 'sticker', text: '今天想让主人看一张新表情包', hint: '她今天用出一张图鉴里还没有的表情包' },
]
export const WISH_BY_ID = Object.fromEntries(WISHES.map((w) => [w.id, w]))

/**
 * 表情包图鉴（猫咪后院的收集 + 蔚蓝档案「纪念大厅」）：她用出过的每一张表情包都会收进图鉴。
 * 里程碑按总数的比例算（清单张数变了也不用改这里）；每个里程碑只发一次奖。
 */
export const ALBUM_MILESTONES = [
  { ratio: 0.1, xp: 3, title: '图鉴学徒' },
  { ratio: 0.3, xp: 6, title: '梗学家' },
  { ratio: 0.6, xp: 10, title: '梗百科' },
  { ratio: 1, xp: 20, title: '梗大全' },
]

/** 每周回顾：上周至少这么多轮才讲（太少没必要特意讲）。 */
export const RECAP_MIN_TURNS = 3

/** 心情（短期）：0–100，基线 60，向基线回归。 */
export const MOOD = { base: 60, regenEveryMs: 5 * 60_000, min: 0, max: 100 }
/** 饱腹（短期）：每 6 分钟 -1，单次最多结算 6 小时，最低 10。 */
export const FULL = { decayEveryMs: 6 * 60_000, floor: 10, maxCatchupMs: 6 * 3_600_000, max: 100, hungry: 25, stuffed: 90 }
/** 一碗饭 = 多少 token；一碗给多少饱腹；每轮至少给多少。 */
export const RICE = { tokensPerBowl: 20_000, fullPerBowl: 25, minFullPerTurn: 4 }
/** token 存量：每轮 +1，每花掉 2 万 token 再 +1，单轮最多 +3；库存上限 30。 */
export const TICKETS = { cap: 30, perTurn: 1, tokensPer: 20_000, maxPerTurn: 3, start: 5 }

/** 衰减（低压版）：连续 N 个工作日没互动之后，每个工作日 -perDay；只削本级内进度，满 stopAtLevel 级后不衰减。 */
export const DECAY = { idleWorkdays: 3, perDay: 2, stopAtLevel: 7 }

/** 礼物喜好（公开）。xp 可为负，但羁绊值有地板（不低于本级起点）。 */
export const TASTES = {
  loved: { label: '最爱' },
  liked: { label: '喜欢' },
  neutral: { label: '普通' },
  disliked: { label: '讨厌' },
  hated: { label: '禁区' },
}
export const GIFTS = [
  { id: 'rice', name: '白饭', cost: 1, taste: 'loved', xp: 8, full: 25, mood: 10, blurb: '捧碗，眼睛发光' },
  { id: 'omurice', name: '蛋包饭', cost: 3, taste: 'loved', xp: 8, full: 30, mood: 12, blurb: '挤番茄酱，画一个爱心' },
  { id: 'parfait', name: '巴菲', cost: 3, taste: 'liked', xp: 5, full: 15, mood: 10, blurb: '桌上摆出巴菲' },
  { id: 'tea', name: '热茶', cost: 1, taste: 'liked', xp: 5, full: 5, mood: 8, blurb: '捧着，暖到手心' },
  { id: 'blanket', name: '毯子', cost: 2, taste: 'liked', xp: 5, full: 0, mood: 6, blurb: '夜里更开心' },
  { id: 'coffee', name: '咖啡', cost: 1, taste: 'neutral', xp: 2, full: 0, mood: 1, blurb: '「苦……人家给主人留着」' },
  { id: 'salad', name: '沙拉', cost: 1, taste: 'disliked', xp: -2, full: 5, mood: -8, blurb: '「这是在暗示人家什么吗！」' },
  { id: 'scale', name: '体重秤', cost: 1, taste: 'hated', xp: -4, full: 0, mood: -12, blurb: '沉默三秒，「……你认真的？」' },
  // 拖进来的文件：不花 token，算零食
  { id: 'file', name: '拖进来的文件', cost: 0, taste: 'neutral', xp: 2, full: 8, mood: 2, blurb: '嚼嚼嚼，再问要不要读', hidden: true },
]
export const GIFT_BY_ID = Object.fromEntries(GIFTS.map((g) => [g.id, g]))

/** 倾向称号（Tamagotchi 式养成方向）：统计哪类互动最多，最少 MIN 次才有称号。 */
export const TRAIT_MIN = 10
export const TRAITS = {
  stroke: { name: '撒娇鲸', hint: '被摸头最多' },
  feed: { name: '干饭鲸', hint: '被投喂最多' },
  work: { name: '社畜鲸', hint: '陪你干活最多，同病相怜' },
  praise: { name: '彩虹屁鲸', hint: '被夸最多' },
  night: { name: '夜猫鲸', hint: '陪你熬夜最多' },
  hold: { name: '软糯鲸', hint: '被捏脸最多' },
}

/** 离线小事件：离开超过 minMs 再回来，她讲一件「你不在时做的事」，并随机捡到 0–3 个 token。 */
export const AWAY = { minMs: 2 * 3_600_000, maxTickets: 3 }
/** 离线事件分档（按回来时的时段）。文本在前端台词库 away.*。 */
export const AWAY_KINDS = ['night', 'day', 'evening']

/** 每个界面「待办提示」类互动在晚上 22 点后不主动推（社畜友好，见设计底线第 3 条）。 */
export const QUIET_AFTER_HOUR = 22
