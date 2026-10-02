/**
 * behavior/soul.js —— v0.5.1「有灵魂」：她能看见的 DSH 世界又多了一圈。
 *
 * 之前她只对「回复一句话 / 点按钮 / 工具调用」有反应；这一版把下面这些时刻也接上了：
 *   · 深度思考（reasoning 增量）→ 「正在思考」表情包（单独出现，不用说话）
 *   · 换模型 / 调推理强度（model/selection、request/header）→ 吃醋 / 欢迎回来
 *   · 权限放开 / 收紧（sandbox/mode）→ 紧张 / 捂手
 *   · 她向你提问（ask_user_question）等太久 → 摇铃催
 *   · 斜杠命令 / 换智能体预设 / 定时任务 → 一句话
 *   · 你重复点「重新生成」≥3 次 → 「怎么还不满意」
 *   · 钱包余额 < 5 元 → 「要米」
 *   · 你发呆：输入框写了一半停着 / 一阵子没动静 → 探头问一句（只在话痨档）
 *   · v0.5.7：工作流启停（Raid 举牌）/ 团队有动静 / 静置阶梯（没操作就打游戏摸鱼）
 * 触发源是宿主的 sev 事件（lib/events/slim.js）与 DOM；话在 persona/lines-soul.js，图在 persona/stickers.js。
 *
 * 隐私：台词里不出现模型名（人设规范：不提第三方模型品牌）；斜杠命令只用名字，宿主不转参数。
 * 所有反应走 perform()：优先级、冷却、习惯化、话痨度分档都照旧，这里不绕过任何一条。
 */

import { CFG } from '../config.js'
import { R, agent } from '../core/state.js'
import { DIR, PRI, perform, performingNow } from '../director/perform.js'
import { claim } from '../net/api.js'
import { bondMemory } from './bond.js'
import { userEngaged } from './observe.js'
import { hud } from '../ui/hud.js'

export const SOUL = {
  model: { used: null, pending: null }, // used = 实际在用的；pending = 用户刚在界面里选了、下一次请求才生效
  sandbox: null,
  persona: undefined,
  think: { key: '', active: false, timers: [] },
  ask: null, // { callId, timer }
  regen: [],
  lastInput: Date.now(), // 页面上最近一次鼠标/键盘（发呆判断用）
  idle: { inputKey: -1, quietKey: -1, gameKey: -1 },
}

const isDeepSeek = (m) => !!m && /deepseek/i.test(`${m.provider || ''} ${m.model || ''}`)
const sameModel = (a, b) => !!a && !!b && a.provider === b.provider && a.model === b.model
const EFFORT_RANK = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const rank = (e) => EFFORT_RANK.indexOf(String(e || '').toLowerCase())

/** 已经有专门演出的命令，不再额外「接令」。 */
const COMMANDS_WITH_OWN_SHOW = new Set(['compact', 'goal', 'plan', 'feedback'])

const enabled = () => CFG.pageAware !== false

/** sev 里属于「新场景」的那几种，由 behavior/sev.js 转进来。 */
export function handleSoulSev(m) {
  if (!enabled()) return
  switch (m.k) {
    case 'model':
      return onModel(m)
    case 'sandbox':
      return onSandbox(m)
    case 'command':
      if (m.name && !COMMANDS_WITH_OWN_SHOW.has(m.name)) {
        perform({ id: 'soul-command', pri: PRI.CUE, tier: 'chatty', mood: 'alert', say: 'commandRun', ms: 1800, cool: 4000 })
      }
      return
    case 'persona':
      // 第一次看见只记账（会话创建时会带一条），之后真的变了才演
      if (SOUL.persona !== undefined && SOUL.persona !== m.preset) {
        perform({ id: 'soul-persona', pri: PRI.CUE, tier: 'extra', mood: 'excited', say: 'personaSwitch', ms: 2600, cool: 8000 })
      }
      SOUL.persona = m.preset
      return
    case 'workflow':
      // 工作流编排一批分身：开始举 Raid 牌「出击」，结束清点人数
      if (m.phase === 'start') perform({ id: 'soul-workflow-start', pri: PRI.CUE, tier: 'extra', mood: 'excited', say: 'workflowStart', ms: 2600, cool: 8000 })
      else perform({ id: 'soul-workflow-end', pri: PRI.CUE, tier: 'extra', mood: 'happy', say: 'workflowEnd', ms: 2600, cool: 8000 })
      return
    case 'team':
      perform({ id: 'soul-team', pri: PRI.CUE, tier: 'chatty', mood: 'alert', say: 'teamActivity', ms: 2400, cool: 45000 })
      return
    case 'schedule':
      if (m.op === 'create') perform({ id: 'soul-schedule-new', pri: PRI.CUE, tier: 'extra', mood: 'happy', say: 'scheduleNew', ms: 2800, cool: 6000 })
      else if (m.op === 'dispatch') perform({ id: 'soul-schedule-fire', pri: PRI.CUE, tier: 'extra', mood: 'alert', say: 'scheduleFire', ms: 2800, cool: 6000 })
      return
    // 'preset'（权限预设名）暂不演：它必然伴随 sandbox/approval 事件，由那两个负责
  }
}

// ——————————————————————————————————————————————————————————————
// 换模型 / 推理强度
// ——————————————————————————————————————————————————————————————

function onModel(m) {
  const next = { provider: m.provider, model: m.model, effort: m.effort }
  const st = SOUL.model
  if (m.src === 'selection') {
    // 用户在界面里选了模型（下一次请求才生效）：当场就演，别等到下一轮。
    // 还没观察到任何请求（刚开机 / 刚新建会话）时 prev 未知：选了别家的照样吃醋，选 DeepSeek 就不演（没法说「换回来」）
    if (st.used) reactModel(st.used, next)
    else if (!isDeepSeek(next)) reactModel(null, next)
    st.pending = next
    return
  }
  // request/header：这一次请求实际用的
  if (st.pending && sameModel(st.pending, next)) {
    st.used = next // selection 时已经演过了
    st.pending = null
    return
  }
  if (!st.used) {
    st.used = next // 第一次观察到：只记账，不演（开机就在用什么，不算「换」）
    return
  }
  reactModel(st.used, next)
  st.used = next
  st.pending = null
}

function reactModel(prev, next) {
  if (prev && sameModel(prev, next)) {
    // 同一个模型，推理强度变了
    const a = rank(prev.effort)
    const b = rank(next.effort)
    if (a < 0 || b < 0 || a === b) return
    perform({
      id: 'soul-effort', pri: PRI.CUE, tier: 'extra', mood: b > a ? 'reading' : 'happy',
      say: b > a ? 'effortUp' : 'effortDown', ms: 2600, cool: 6000,
    })
    return
  }
  if (!isDeepSeek(next)) {
    // 换成别家的：吃醋，嘴硬（不说品牌）
    if (perform({ id: 'soul-model-away', pri: PRI.CUE, tier: 'extra', mood: 'confused', say: 'modelAway', ms: 3000, cool: 6000 })) bondMemory('jealous', 3500)
  } else if (prev && !isDeepSeek(prev)) {
    // 从别家换回 DeepSeek：欢迎回来
    perform({ id: 'soul-model-back', pri: PRI.CUE, tier: 'extra', mood: 'happy', say: 'modelBack', ms: 3000, cool: 6000 })
  }
}

/**
 * DOM 兜底：用户在 DSH 的模型下拉里点了某一项（page.js 识别到「搜索模型」弹层里的点选）。
 * 宿主事件没到、或没带上这次选择时，她照样有反应。label 是点中那一项的文字，只用来判断是不是 DeepSeek，不出现在台词里。
 * 和事件路径共用同一批 perform id（冷却 6 秒），所以两路同时到也只演一次。
 */
export function noteModelPick(label) {
  if (!enabled()) return
  const ds = isDeepSeek({ model: label })
  const away = SOUL.model.domAway === true
  SOUL.model.domAway = !ds
  if (!ds) {
    if (perform({ id: 'soul-model-away', pri: PRI.CUE, tier: 'extra', mood: 'confused', say: 'modelAway', ms: 3000, cool: 6000 })) bondMemory('jealous', 3500)
  } else if (away) {
    perform({ id: 'soul-model-back', pri: PRI.CUE, tier: 'extra', mood: 'happy', say: 'modelBack', ms: 3000, cool: 6000 })
  }
}

// ——————————————————————————————————————————————————————————————
// 权限
// ——————————————————————————————————————————————————————————————

function onSandbox(m) {
  const prev = SOUL.sandbox
  SOUL.sandbox = m.mode
  if (!m.mode || prev === null || prev === m.mode) return // 第一次观察只记账
  if (m.mode === 'danger-full-access') {
    if (perform({ id: 'soul-sandbox', pri: PRI.CUE, tier: 'extra', mood: 'sweat', say: 'sandboxFull', ms: 3000, cool: 20000 })) bondMemory('full-trust', 3500)
  } else if (m.mode === 'read-only') {
    perform({ id: 'soul-sandbox', pri: PRI.CUE, tier: 'extra', mood: 'confused', say: 'sandboxReadonly', ms: 3000, cool: 20000 })
  }
}

// ——————————————————————————————————————————————————————————————
// 深度思考：只丢一张「正在思考」，不用说话
// ——————————————————————————————————————————————————————————————

function clearThinkTimers() {
  for (const t of SOUL.think.timers) clearTimeout(t)
  SOUL.think.timers = []
}

/**
 * 收到 reasoning 增量时调用（宿主一直在推，之前被默认丢掉了）。同一步只响应第一次。
 * 图最长挂 10 秒；想得特别久（30s / 90s）才补一句话。
 */
export function noteThinking() {
  const key = agent.turn + ':' + agent.step
  if (SOUL.think.key === key) return
  clearThinkTimers()
  SOUL.think = { key, active: true, timers: [] }
  const bub = R.ui && R.ui.bubble
  if (!bub || bub.asking || agent.hasStream) return
  const cur = performingNow()
  // 只在「气泡没开」或「开着的是常驻的忙碌气泡」时出图；别的台词正在说，不插嘴
  const busyLine = bub.visible && !!bub.el.querySelector('.dshp-pulse')
  if (!(cur && cur.pri > PRI.CUE) && (!bub.visible || busyLine)) bub.sticker('thinking', { maxMs: 10000 })
  const say = (id) => () => {
    if (!SOUL.think.active || SOUL.think.key !== key || agent.status !== 'thinking') return
    if (perform({ id: 'soul-' + id, pri: PRI.CUE, tier: 'extra', say: id, ms: 3000, habit: false }) && id === 'thinkLong') bondMemory('long-think', 3500)
  }
  SOUL.think.timers.push(setTimeout(say('thinkLong'), 30000), setTimeout(say('thinkLonger'), 90000))
}

/** 思考结束（出字了 / 调工具了 / 一轮结束）：清定时器，纯表情包小气泡收起（有字的气泡不动）。 */
export function stopThinking() {
  if (!SOUL.think.active) return
  SOUL.think.active = false
  clearThinkTimers()
  if (R.ui && R.ui.bubble) R.ui.bubble.dropSolo()
}

// ——————————————————————————————————————————————————————————————
// 她向主人提问（ask_user_question）：等太久就摇铃
// ——————————————————————————————————————————————————————————————

export function noteAskUser(callId) {
  bondMemory('ask-user', 3500) // 她第一次举牌问你
  noteAskDone()
  SOUL.ask = {
    callId,
    timer: setTimeout(() => {
      if (!SOUL.ask || SOUL.ask.callId !== callId) return
      perform({ id: 'soul-ask-wait', pri: PRI.ALERT, tier: 'core', mood: 'confused', say: 'askUserWait', ms: 3200, habit: false, cool: 120000 })
    }, 60000),
  }
}

export function noteAskDone(callId) {
  if (!SOUL.ask || (callId && SOUL.ask.callId !== callId)) return
  clearTimeout(SOUL.ask.timer)
  SOUL.ask = null
}

// ——————————————————————————————————————————————————————————————
// 你反复点「重新生成」
// ——————————————————————————————————————————————————————————————

export function noteRegen() {
  const now = Date.now()
  SOUL.regen = SOUL.regen.filter((t) => now - t < 120000)
  SOUL.regen.push(now)
  if (SOUL.regen.length < 3) return
  SOUL.regen.length = 0
  perform({ id: 'soul-regen-many', pri: PRI.CUE, tier: 'extra', mood: 'sweat', say: 'regenMany', ms: 3200, cool: 120000 })
}

// ——————————————————————————————————————————————————————————————
// 余额 < 5 元：要米（每天最多一次；< 1 元走 routine.js 原来的「吐魂」）
// ——————————————————————————————————————————————————————————————

export async function checkLowBalance() {
  const th = Number(CFG.lowBalanceYuan)
  if (!(th > 0)) return
  const d = hud.data
  if (!d || d.currency !== 'CNY' || typeof d.totalBalance !== 'number') return
  if (d.totalBalance >= th || d.totalBalance < 1) return
  if (!(await claim('routine:lowbal-beg', 'day'))) return
  // 刚收工，等收工那阵表演过去再要
  setTimeout(() => {
    if (agent.status !== 'idle') return
    if (perform({ id: 'low-balance-beg', pri: PRI.CUE, tier: 'core', mood: 'sad', say: 'lowBalanceBeg', vars: { n: th }, sticker: 'beg', ms: 4600, habit: false })) bondMemory('beg-rice', 5000)
  }, 3600)
}

// ——————————————————————————————————————————————————————————————
// 你发呆
// ——————————————————————————————————————————————————————————————

/** 记「页面上最近一次有人动」：鼠标 / 键盘 / 点击 / 滚轮（节流到每秒一次，只读，不拦截）。 */
export function wireSoul() {
  let last = 0
  const bump = () => {
    const t = performance.now()
    if (t - last < 1000) return
    last = t
    SOUL.lastInput = Date.now()
  }
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) {
    document.addEventListener(ev, bump, { capture: true, passive: true })
  }
}

const INPUT_IDLE_MS = 45000
const QUIET_MS = 120000

/**
 * 每 15 秒看一次。先看「静置阶梯」：主人安静满 60 秒、她还没睡，就单发一张「打游戏」表情包（摸鱼；不带台词、不占主动发话预算、一段安静只出一次）。
 * 再看两种发呆，全是 chatty 档（话痨才出现）、AMBIENT 优先级、走主动发话预算：
 *   1) 输入框里写了字、聚焦着、45 秒没按键：探头问「想好怎么说了吗」（同一段停顿只问一次）；
 *   2) 页面 2 分钟没人动（她还没睡着）：托腮一句（一段安静只说一次）。
 * 她睡着了（idle.sleep）、有面板开着、刚互动过、刚说过话，都不插嘴。
 * @param ctx { typing: page.js 的 TYPING, sleeping: boolean }
 */
export function soulTick(ctx) {
  if (CFG.idleChat === false) return
  if (agent.status !== 'idle' || document.hidden || ctx.sleeping) return
  const bub = R.ui && R.ui.bubble
  if (!bub || performingNow() || bub.visible || bub.asking) return
  const root = R.ui.root.classList
  if (root.contains('dshp-open') || root.contains('dshp-hidden')) return
  const t = performance.now()
  // 静置阶梯：安静满 60 秒（睡着之前）→ 单发「打游戏」。她睡着、有面板开着、刚互动过都不会出现
  const still = Date.now() - Math.max(SOUL.lastInput, agent.lastActivity)
  if (still > 60000 && still < 170000 && SOUL.idle.gameKey !== SOUL.lastInput && t - DIR.lastUser > 20000 && !userEngaged()) {
    SOUL.idle.gameKey = SOUL.lastInput
    if (perform({ id: 'soul-idle-game', pri: PRI.AMBIENT, tier: 'extra', habit: false, solo: 'idleGame', ms: 2600, cool: 4 * 60000 })) return
  }
  if (t - DIR.lastProactive < 3 * 60000 || t - DIR.lastUser < 20000) return

  const typing = ctx.typing
  const el = typing && typing.el
  if (el && el.isConnected && typing.len > 0 && document.activeElement === el) {
    const quiet = t - typing.lastKey
    if (quiet > INPUT_IDLE_MS && quiet < 10 * 60000 && SOUL.idle.inputKey !== typing.lastKey) {
      SOUL.idle.inputKey = typing.lastKey
      if (perform({ id: 'soul-idle-input', pri: PRI.AMBIENT, tier: 'chatty', mood: 'thinking', say: 'idleInput', ms: 3800, habit: false, budget: true, cool: 5 * 60000 })) bondMemory('idle-seen', 4500)
      return
    }
  }
  const quiet = Date.now() - Math.max(SOUL.lastInput, agent.lastActivity)
  if (quiet > QUIET_MS && quiet < 10 * 60000 && SOUL.idle.quietKey !== SOUL.lastInput) {
    SOUL.idle.quietKey = SOUL.lastInput
    perform({ id: 'soul-idle-long', pri: PRI.AMBIENT, tier: 'chatty', mood: 'confused', say: 'idleLong', ms: 3800, habit: false, budget: true, cool: 8 * 60000 })
  }
}
