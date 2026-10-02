/** director/perform.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { CFG } from '../config.js'
import { R, agent } from '../core/state.js'
import { gazeDetach, heartBurst } from '../engine/gaze.js'
import { playOneShot, stopActing } from '../engine/motion.js'
import { setReaction } from '../engine/rig.js'
import { PERF } from '../engine/runtime.js'
import { lineFor } from '../persona/lines.js'
import { SOLO_STICKER } from '../persona/stickers.js'

/**
 * 起一次表演。**所有一次性反应都必须走这里，没有例外。**
 *
 * 铁律（主人反复强调的）：
 *   1. 先把上一次整个停掉、回到平常状态，**再**开始新的 —— 所以永远不会重叠
 *   2. 一次表演 = 一个面部表情 + 至多一个动作 + 至多一个粒子特效
 *   3. 待机表演只在真正空闲时才会被调用；有任务时只有任务表演
 *   4. 永久禁用：吹泡泡糖、大锤砸、呆呆眼（见 BANNED_MOTIONS / MOOD_FACE）
 */
function rawAct(spec) {
  spec = spec || {}
  stopActing() // ← 关键：先归零，再开始
  const ms = spec.ms || 2600
  setReaction({
    mood: spec.mood,
    face: spec.face,
    props: spec.props,
    exclusive: spec.exclusive,
    ms,
  })
  // lineMs：台词气泡的停留时间（按住这类「表演很长、话很短」的场合用）
  // 表情包：台词后面跟一张（spec.sticker=false 关掉；选图规则与时长过滤在 ui/sticker-pick.js，气泡里选）。
  // 没有台词但指定了 sticker：只丢一张图（「正在思考」「要米」「坐牢」这类，图比话更到位）。
  const hint = spec.sticker === false ? null : { sticker: spec.sticker, say: spec.say, id: spec.id, mood: spec.mood, force: (spec.pri || 0) >= PRI.ALERT }
  if (spec.line) R.ui.bubble.show(spec.line, { name: '鲸鱼娘', ttl: spec.lineMs || Math.max(ms, 1800), stickerHint: hint })
  else if (spec.sticker && typeof spec.sticker === 'string' && !(agent.hasStream && (spec.pri || 0) < PRI.ALERT)) {
    R.ui.bubble.sticker(spec.sticker, { maxMs: spec.stickerMs })
  } else if (spec.solo && !(agent.hasStream && (spec.pri || 0) < PRI.ALERT)) {
    // 单发图（没有台词）：solo = 池名（persona/stickers.js 的 SOLO_STICKER）或一个 id 数组，从池里按「近期没用过」挑一张
    const pool = Array.isArray(spec.solo) ? spec.solo : SOLO_STICKER[spec.solo]
    if (pool) R.ui.bubble.soloFrom(pool, { maxMs: spec.stickerMs })
  }
  if (spec.motion) {
    playOneShot(spec.motion)
    // 只有**真的做动作**时才暂时不盯鼠标；单纯换个表情不该把视线也停掉，
    // 否则待机每隔几秒来一次，她大部分时间都不看主人了。
    gazeDetach(Math.max(2200, ms))
  }
  if (spec.heart) heartBurst(ms)
  R.acting = { until: performance.now() + ms }
  return ms
}

// ——————————————————————————————————————————————————————————————
// 四·六、编排层（v0.5）：功能再多也不打架
// ——————————————————————————————————————————————————————————————
//
// 三条规矩（根因：rawAct 是「后来者无条件顶掉前者」）：
//   1. 一次性反应只走 perform()：带优先级，高的顶低的，低的直接丢，不排队不补播；
//   2. 持续型状态（批准等待、重试、危险命令、计划模式…）不是反应，走 FLAG + syncConds()
//      整体重算，所以不会被别的一次性反应顶掉，状态没了自然消失；
//   3. 一轮只有一次「收工表演」：中途事件只记进 digest，收工时按固定优先级选一个演。
// 旧代码里的 act(...) 保持原名，现在等价于 perform（默认 CUE 级）。

/** 一次性反应的优先级：高的才能顶掉低的（相等时新来的赢）。 */
// 编号越大越能顶掉别人。主人**直接点她 / 摸她 / 点菜单**（TOUCH、EXPLICIT）排最高档：
// 以前戳她排在收工庆祝之下，庆祝那 3 秒里戳她会被当成「优先级低」直接丢掉，
// 看起来就是「点了没反应」——这是主人最讨厌的一类问题。
export const PRI = { AMBIENT: 0, CUE: 1, FINISH: 2, ALERT: 3, TOUCH: 4, EXPLICIT: 5 }

/** 话痨度分级：core 一直放；extra 从「普通」档起放；chatty 只有「话痨」档放。 */
const TIER = { core: 0, extra: 1, chatty: 2 }

export const chatLevel = () => (CFG.chatty === 0 || CFG.chatty === 2 ? CFG.chatty : 1)

export const DIR = {
  cur: null, // 正在演的一次性反应 { pri, id, until }
  cool: new Map(), // id -> 冷却到何时（performance.now）
  habit: new Map(), // 习惯化键 -> 近 90 秒内的时间戳
  log: [], // 最近 60 条决策，DSHPet.director.trace() 读它
  lastProactive: 0, // 上一次「她主动开口」
  lastUser: 0, // 最近一次「主人在跟她互动」
}

export const noteUser = () => {
  DIR.lastUser = performance.now()
}

function dirLog(spec, ok, why) {
  DIR.log.push({ t: Math.round(performance.now()), id: spec.id || '-', pri: spec.pri, ok, why })
  if (DIR.log.length > 60) DIR.log.shift()
}

/** 习惯化：同类互动 90 秒内，第 1 次必说、第 2 次一半、第 3 次起只演不说；安静 90 秒恢复。 */
function habituate(key) {
  const now = performance.now()
  const arr = (DIR.habit.get(key) || []).filter((t) => now - t < 90000)
  arr.push(now)
  DIR.habit.set(key, arr)
  return arr.length === 1 ? 'full' : arr.length === 2 ? 'half' : 'mute'
}

export function performingNow() {
  const c = DIR.cur
  return c && performance.now() < c.until ? c : null
}

/**
 * 一次性反应的唯一入口（包在 rawAct 外）。
 * spec = rawAct 的参数 + { id, pri, tier, cool, say, vars, habit, habitKey }
 *   say：台词库 id（LINES）；line：直接给一句；habit:false 关掉习惯化（菜单点击、报错这类必须有反应的）
 * @returns 演了多少毫秒；被丢弃返回 0（原因记在 DSHPet.director.trace()）
 */
export function perform(spec) {
  spec = spec || {}
  const now = performance.now()
  const pri = spec.pri == null ? PRI.CUE : spec.pri
  spec.pri = pri
  const tier = TIER[spec.tier] == null ? TIER.extra : TIER[spec.tier]
  if (tier > chatLevel() && pri < PRI.EXPLICIT) return dirLog(spec, false, 'tier'), 0
  if (pri === PRI.AMBIENT && (PERF.low || document.hidden || (R.ui && R.ui.root.classList.contains('dshp-hidden')))) {
    return dirLog(spec, false, 'ambient-gated'), 0
  }
  if (spec.id && (DIR.cool.get(spec.id) || 0) > now) return dirLog(spec, false, 'cool'), 0
  const cur = performingNow()
  if (cur && cur.pri > pri) return dirLog(spec, false, 'lower-than:' + cur.id), 0

  let line = spec.line
  if (line === undefined && spec.say) line = lineFor(spec.say, spec.vars)
  if (line && spec.habit !== false && pri < PRI.ALERT) {
    const h = habituate(spec.habitKey || spec.id || spec.say || 'anon')
    if (h === 'mute' || (h === 'half' && Math.random() < 0.5)) line = undefined
  }
  // 流式回复正在占着气泡：一次性台词只演脸、不抢气泡（报错类除外）
  if (line && agent.hasStream && pri < PRI.ALERT) line = undefined

  const ms = rawAct(Object.assign({}, spec, { line }))
  DIR.cur = { pri, id: spec.id || '-', until: now + ms }
  if (spec.id && spec.cool) DIR.cool.set(spec.id, now + spec.cool)
  // 「主动发话预算」只记日常节律 / 问候这类真正的主动搭话；待机碎碎念是原有行为，不占这个预算
  if (spec.budget && line) DIR.lastProactive = now
  dirLog(spec, true, line ? 'line' : 'silent')
  return ms
}

/** 旧调用点沿用的名字：等价于 perform（没写 pri 的按 CUE 级）。 */
const act = perform

/**
 * 事件边界上「让位」：只清掉优先级不高于 pri 的在演反应，更高的让它演完。
 * 替换原来各事件分支里的硬 stopActing()——否则「关键词反应」会被紧随其后的 turn-start 清掉。
 */
export function yieldTo(pri) {
  const c = performingNow()
  if (c && c.pri > pri) return false
  DIR.cur = null
  stopActing()
  return true
}
