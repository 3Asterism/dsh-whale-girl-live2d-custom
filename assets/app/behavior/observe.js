/**
 * behavior/observe.js —— 「她看懂了」：把 DSH 里 hook 得到的信号合成复合故事和心情，并**在不挤占正常互动的前提下**说出口。
 *
 * 信号清单（全部是真的 hook 得到的，不靠猜；来源已对照 DSH 0.2.0-rc.2 核实）：
 *   · tool/call 的 shell 命令（正则分类，不上传不落盘）+ tool/result 里宿主抽出的退出码（非零不算 error）→ 命令成败
 *   · 写文件类工具的调用 → 改了几个文件；tool/result 的 isError → 基础设施失败
 *   · turn/end 的 reason（completed / error / aborted）、llm/retry、approval 被拒
 *   · 主人的原话（本地正则 + 二元组指纹，内存里 10 分钟）、DOM 点击（重新生成 / 停止 / 新建会话）、打字状态
 *
 * 编排铁律（persona/orchestra.js 有完整说明和单测）：
 *   1. **中途不说话**：命令结果只记进这一轮的账（TURN）；
 *   2. 复合故事里的 'flavor' **顶替**默认收工那一句（不增加发言）；'note' 和安慰只能递给编排器排队，过了闸才说；
 *   3. 优先级只用 CUE：任何正常互动（戳 / 摸 / 关键词 / 点界面 / 报错 / 批准）都能顶掉它，它顶不掉别人；
 *   4. 说出口后 DIR.lastProactive 记一笔，让日常提醒 / 待机碎碎念往后退，不叠在一起。
 */

import { CFG } from '../config.js'
import { R, agent } from '../core/state.js'
import { FLAG } from '../director/conds.js'
import { DIR, PRI, chatLevel, perform, performingNow } from '../director/perform.js'
import { COMFORT_MOOD, COMFORT_SAY, analyzeText, createEmpathy } from '../persona/empathy.js'
import { lineFor } from '../persona/lines.js'
import { createOrchestrator } from '../persona/orchestra.js'
import { notesOf, storyOf } from '../persona/turnstory.js'
import { editTargetFingerprint } from '../persona/devhooks.js'
import { TYPING } from './page.js'
import { POMO } from './pomodoro.js'

export const EMO = createEmpathy()
export const ORCH = createOrchestrator()
/** 这一轮的账（turn-start 清零）。 */
export const TURN = { kinds: {}, reds: 0, redOpen: false, greenAfterRed: false, lastTest: null, testOkSeen: false, okThenFail: false, fails: {}, edits: {}, cmdLoop: false, thrash: false }
/** 会话级的账（vibe coding 的「上下文腐烂」「批准疲劳」「先计划」靠它）。新建会话时清零。 */
export const SESS = { turns: 0, compactions: [], approvals: [], planAt: -1e9, blindAt: -1e9, lastLongAt: -1e9, prevTest: null }
const RED = { turns: 0 } // 连着几轮以红色收场
const OBS = { lastFailAt: -1e9, lastCare: -1e9, breakTimer: null }

const t0 = () => performance.now()
const empathyOn = () => CFG.empathy !== false
const devOn = () => CFG.devHooks !== false && CFG.pageAware !== false

// ——————————————————————————————————————————————————————————————
// 记账：命令结果
// ——————————————————————————————————————————————————————————————

export function observeTurnStart() {
  Object.assign(TURN, { kinds: {}, reds: 0, redOpen: false, greenAfterRed: false, lastTest: null, testOkSeen: false, okThenFail: false, fails: {}, edits: {}, cmdLoop: false, thrash: false })
}

/** 一次改文件工具调用：同一个文件被改 ≥5 次 = 原地打转（只记路径的哈希，不记路径）。 */
export function observeToolCall(m) {
  const fp = editTargetFingerprint(m && m.name, m && m.args)
  if (!fp) return
  const n = (TURN.edits[fp] = (TURN.edits[fp] || 0) + 1)
  if (n >= 5) {
    TURN.thrash = true
    if (empathyOn()) EMO.add('fileThrash', t0())
  }
}

/** 主人发来一条消息（会话里聊了几轮：上下文腐烂的粗略度量）。 */
export function observeUserMsg() {
  SESS.turns++
}

/** plan 模式开了（先计划再动手）。 */
export function observePlan(active) {
  if (active) SESS.planAt = t0()
}

/** 开始压缩上下文（压缩过好几次 = 上下文腐烂的信号）。 */
export function observeCompaction() {
  const t = t0()
  SESS.compactions = SESS.compactions.filter((x) => t - x < 60 * 60000).concat(t)
}

/** 被问了要不要批准：10 分钟里 ≥6 次 = 批准疲劳。 */
export function observeApproval() {
  const t = t0()
  SESS.approvals = SESS.approvals.filter((x) => t - x < 10 * 60000).concat(t)
  if (SESS.approvals.length >= 6 && SESS.approvals.length % 3 === 0 && empathyOn()) empathySignal('approvalBurst')
}

/** 新建了一个空白会话：会话级的账清零（换新会话本身就是对「上下文腐烂」的正确处理）。 */
export function observeNewSession() {
  Object.assign(SESS, { turns: 0, compactions: [], approvals: [], blindAt: -1e9, prevTest: null })
}

/** 一个开发命令有了结果（outcome：ok / fail / unknown / bg / denied）。只记账，不说话。 */
export function observeCommand(kind, outcome, fp) {
  if (outcome === 'bg' || outcome === 'denied') return
  const t = t0()
  // 同一条命令（指纹相同）反复失败 ≥3 次 = 原地打转；成功了就清掉
  if (fp) {
    if (outcome === 'fail') {
      const n = (TURN.fails[fp] = (TURN.fails[fp] || 0) + 1)
      if (n >= 3) {
        TURN.cmdLoop = true
        if (empathyOn()) EMO.add('cmdLoop', t)
      }
    } else if (outcome === 'ok') delete TURN.fails[fp]
  }
  if (!kind) return
  const k = TURN.kinds[kind] || (TURN.kinds[kind] = { ok: 0, fail: 0 })
  if (outcome === 'ok') k.ok++
  else if (outcome === 'fail') k.fail++
  const gate = kind === 'test' || kind === 'build'
  if (outcome === 'fail') {
    if (gate) {
      TURN.reds++
      TURN.redOpen = true
      if (kind === 'test') {
        TURN.lastTest = 'fail'
        if (TURN.testOkSeen) TURN.okThenFail = true // 先绿后红：改完变红了
      }
      if (empathyOn()) EMO.add('testRed', t)
    } else if (empathyOn()) EMO.add('cmdFail', t)
  } else if (outcome === 'ok') {
    if (gate) {
      if (TURN.redOpen) TURN.greenAfterRed = true
      TURN.redOpen = false
      if (kind === 'test') {
        TURN.lastTest = 'ok'
        TURN.testOkSeen = true
      }
    }
    if (kind === 'commit' && empathyOn()) EMO.add('commit', t)
  }
}

// ——————————————————————————————————————————————————————————————
// 一轮结束：复合故事 + 心情
// ——————————————————————————————————————————————————————————————

/**
 * 一轮结束（任务边界）。返回 { story, tense }：
 *   · story：'flavor' 类故事（顶替默认收工那句）或 null；'note' 类已经递给编排器排队了；
 *   · tense：她之前一直绷着、这一轮顺了——收工时换成「终于顺了」那一句。
 */
export function observeTurnEnd({ kind, files, errors, todoAll, commitsToday }) {
  const t = t0()
  const out = { story: null, tense: false }
  try {
    if (empathyOn()) out.tense = EMO.level(t) >= 1 && kind === 'completed' && TURN.lastTest !== 'fail'
    if (kind === 'completed') {
      if (devOn()) {
        const longSession = (SESS.compactions.length >= 2 || SESS.turns >= 25) && t - SESS.lastLongAt > 45 * 60000
        const facts = {
          kinds: TURN.kinds, files, reds: TURN.reds, greenAfterRed: TURN.greenAfterRed, lastTest: TURN.lastTest, prevTest: SESS.prevTest,
          okThenFail: TURN.okThenFail, cmdLoop: TURN.cmdLoop, thrash: TURN.thrash, longSession, commitsToday,
          planDone: !!todoAll && t - SESS.planAt < 90 * 60000,
        }
        const st = storyOf(facts)
        if (st) out.story = st
        for (const n of notesOf(facts)) {
          ORCH.offer({ id: 'story-' + n.id, kind: 'note', value: n.value, tier: n.tier, say: n.say, mood: n.id === 'checkpoint' || n.id === 'tested' ? 'happy' : 'sweat', ttlMs: 60_000 }, t)
          if (n.id === 'longSession') SESS.lastLongAt = t
        }
        if (empathyOn() && TURN.lastTest === 'fail' && (SESS.prevTest === 'ok' || TURN.okThenFail)) EMO.add('regression', t) // 改一个 bug 出三个
        // 改了不少文件却一次测试都没跑：记一笔（主人接着抱怨「还是不行」时，说出最对症的那句）
        if (files >= 3 && !TURN.kinds.test) SESS.blindAt = t
        if (TURN.lastTest) SESS.prevTest = TURN.lastTest
      }
      if (empathyOn()) {
        if (TURN.lastTest === 'fail') RED.turns++
        else if (TURN.lastTest === 'ok') RED.turns = 0
        if (RED.turns >= 3) EMO.add('redStreak', t)
        if (TURN.lastTest !== 'fail') EMO.add('win', t)
      }
    } else if (empathyOn()) {
      EMO.add(kind === 'aborted' ? 'turnAbort' : 'turnError', t)
      OBS.lastFailAt = t
    }
    if (out.story) ORCH.spoke(t) // 复合故事顶替了收工那句，也算一次发言（配额里记一笔）
    offerComfort()
    scheduleTick(4500)
  } catch (e) {}
  return out
}

// ——————————————————————————————————————————————————————————————
// 心情信号
// ——————————————————————————————————————————————————————————————

export function empathySignal(kind) {
  if (!empathyOn()) return
  EMO.add(kind, t0())
  offerComfort() // 到线了就递给编排器排队（真说要等任务边界、过闸）
}

/** 别处（关键词反应 / 收工的「站在主人这边」）已经安慰过了：别紧接着再来一次。 */
export function empathyComforted() {
  EMO.comforted(t0())
}

/** 主人的一句话：高风险走温柔分支，其余的词汇 / 重复 / 大喊记成信号。只记账，不当场说话（说话在任务边界）。 */
export function empathyText(text) {
  if (!empathyOn()) return
  const t = t0()
  const a = analyzeText(text, EMO.recent, t)
  if (a.care) return careNow()
  for (const s of a.signals) EMO.add(s, t)
  // 上一轮改完没验证、主人这就抱怨「还是不行」：最对症的一句——先让它跑一遍测试（过早宣布完成的经典翻车）
  if (devOn() && a.signals.some((s) => s === 'textMild' || s === 'textStrong' || s === 'repeat') && t - SESS.blindAt < 10 * 60000) {
    ORCH.offer({ id: 'story-blindComplaint', kind: 'note', value: 36, tier: 'chatty', say: 'storyUnverified', mood: 'sweat', ttlMs: 90_000 }, t)
    SESS.blindAt = -1e9
  }
  if (a.signals.length) offerComfort()
}

/** 新建会话：刚失败不久就「换个会话重来」——轻轻说一句（编排器排队）。 */
export function empathyNewSession() {
  const t = t0()
  if (!empathyOn() || t - OBS.lastFailAt > 3 * 60000) return
  ORCH.offer({ id: 'restart', kind: 'note', value: 25, tier: 'chatty', say: 'restartAfterFail', mood: 'happy', ttlMs: 30_000 }, t)
  scheduleTick(2500)
}

function offerComfort() {
  if (!empathyOn()) return
  const t = t0()
  const due = EMO.due(t, new Date().getHours())
  if (!due) return
  const cause = due.late ? 'late' : due.level === 2 ? 'hard' : due.cause
  ORCH.offer({ id: 'empathy-' + cause, kind: 'comfort', level: due.level, value: due.level === 2 ? 80 : 60, tier: 'extra', say: COMFORT_SAY[cause], mood: COMFORT_MOOD[cause], ttlMs: 120_000 }, t)
}

/** 高风险（自伤倾向）：不玩梗、不配图，一句温柔的话 + 一句提醒找身边的人。30 分钟最多一次。 */
function careNow() {
  const t = t0()
  if (t - OBS.lastCare < 30 * 60000) return
  OBS.lastCare = t
  const spec = { pri: PRI.ALERT, tier: 'core', mood: 'sad', sticker: false, habit: false, ms: 5200 }
  perform({ ...spec, id: 'care', line: lineFor('careGentle') })
  ORCH.spoke(t, { care: true })
  setTimeout(() => {
    if (!(R.ui && R.ui.bubble.asking)) perform({ ...spec, id: 'care-help', line: lineFor('careHelp') })
  }, 5600)
}

// ——————————————————————————————————————————————————————————————
// 出口：编排器的闸
// ——————————————————————————————————————————————————————————————

/** 现在的场面（给 orchestra.blockedReason 的）。 */
function buildCtx() {
  const t = t0()
  const ui = R.ui
  const root = ui && ui.root ? ui.root.classList : null
  return {
    chatLevel: chatLevel(),
    idle: agent.status === 'idle',
    hidden: document.hidden || !ui || (root && root.contains('dshp-hidden')),
    panelOpen: !!(root && root.contains('dshp-open')),
    bubbleVisible: !!(ui && ui.bubble.visible),
    asking: !!(ui && ui.bubble.asking),
    performing: !!performingNow(),
    pomoFocus: POMO.phase === 'focus',
    approval: FLAG.approval >= 0,
    danger: !!FLAG.danger,
    streaming: !!agent.hasStream,
    typingMs: TYPING.el && TYPING.lastKey ? t - TYPING.lastKey : Infinity,
    sinceUserMs: t - DIR.lastUser,
  }
}

/** 主人正「在场」：在打字 / 番茄钟专注 / 有提问等着点——别的主动小动作（待机单发图、抽签邀请）也该让路。 */
export function userEngaged() {
  const c = buildCtx()
  return c.typingMs < 5000 || c.pomoFocus || c.asking
}

let tickTimer = null
function scheduleTick(ms) {
  clearTimeout(tickTimer)
  tickTimer = setTimeout(observeTick, ms)
}

/** 每 5 秒（idle.js 里的定时器）+ 任务边界各看一眼：槽里有候选、闸都开了才说。槽是空的就几乎零开销。 */
export function observeTick() {
  try {
    const t = t0()
    if (!ORCH.pending(t)) return
    const r = ORCH.take(t, buildCtx())
    if (!r || !r.go) return
    const c = r.go
    const ms = c.kind === 'comfort' ? speakComfort(c) : perform({ id: c.id, pri: PRI.CUE, tier: c.tier, mood: c.mood, say: c.say, ms: 3600, cool: 120000, habit: false })
    if (ms) {
      ORCH.spoke(t)
      DIR.lastProactive = t // 日常提醒 / 待机碎碎念往后退，不叠在一起
    } else ORCH.clear() // 被导演丢了（冷却 / 更高优先级）：不死缠
  } catch (e) {}
}

function speakComfort(c) {
  const t = t0()
  if (c.level !== 2) {
    const ms = perform({ id: c.id, pri: PRI.CUE, tier: 'extra', mood: c.mood, say: c.say, ms: 4200, cool: 600000, habit: false })
    if (ms) EMO.fired(1, t)
    return ms
  }
  // 很烦的那一档：话后面带「歇五分钟」的选择（点按钮才歇，不点就算了）
  const ms = perform({ id: c.id, pri: PRI.CUE, tier: 'extra', mood: c.mood, line: null, ms: 9000, cool: 600000, habit: false })
  if (!ms) return 0
  R.ui.bubble.ask(
    lineFor(c.say),
    [
      { label: '歇五分钟', onClick: () => startBreak() },
      { label: '继续干', onClick: () => perform({ id: 'break-no', pri: PRI.CUE, tier: 'core', habit: false, mood: 'happy', say: 'breakNo', ms: 2400 }) },
    ],
    { ttl: 15000 },
  )
  EMO.fired(2, t)
  return ms
}

function startBreak() {
  perform({ id: 'break-start', pri: PRI.CUE, tier: 'core', habit: false, mood: 'happy', say: 'breakStart', ms: 3000 })
  clearTimeout(OBS.breakTimer)
  OBS.breakTimer = setTimeout(() => {
    if (agent.status === 'idle' && !(R.ui && R.ui.bubble.visible)) perform({ id: 'break-end', pri: PRI.CUE, tier: 'core', habit: false, mood: 'happy', say: 'breakEnd', ms: 3000 })
  }, 5 * 60000)
}

/** 调试 / 测试用。 */
export function observeState() {
  const t = t0()
  return { score: Math.round(EMO.score(t)), level: EMO.level(t), cause: EMO.dominant(t), turn: JSON.parse(JSON.stringify(TURN)), redTurns: RED.turns, orch: ORCH.stats(t), sess: { turns: SESS.turns, compactions: SESS.compactions.length, approvals: SESS.approvals.length, prevTest: SESS.prevTest } }
}

export function observeReset() {
  EMO.reset()
  ORCH.reset()
  observeTurnStart()
  RED.turns = 0
  OBS.lastFailAt = -1e9
  OBS.lastCare = -1e9
  Object.assign(SESS, { turns: 0, compactions: [], approvals: [], planAt: -1e9, blindAt: -1e9, lastLongAt: -1e9, prevTest: null })
  clearTimeout(OBS.breakTimer)
  clearTimeout(tickTimer)
}
