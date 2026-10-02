/** director/conds.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { bondMemory } from '../behavior/bond.js'
import { empathySignal, observeApproval } from '../behavior/observe.js'
import { noteProcess } from '../behavior/events.js'
import { CFG } from '../config.js'
import { activeSubagents } from '../core/state.js'
import { PRI, perform } from './perform.js'
import { moodFace, propExpr, resolveRig, rig } from '../engine/rig.js'
import { WORK_PROPS } from '../persona/items.js'

// —— 持续型状态：FLAG 是事实，syncConds() 据此整体重算 rig.cond ——
export const FLAG = {
  plan: false, yolo: false, approval: -1, retry: 0, danger: null, night: false, pomo: false,
  fails: 0, // 连续失败的轮数（成功一轮清零）；≥2 时用「站在主人这边」的话安慰，而不是自嘲
  recovered: false, // 这一轮是不是「失败之后终于过了」
}

/** 每一轮开始时清掉「只属于上一轮」的状态（批准等待 / 重试 / 危险命令）。 */
export function resetTurnFlags() {
  clearApprovalTimers()
  for (const t of longToolTimers.values()) t.forEach(clearTimeout)
  longToolTimers.clear()
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  FLAG.approval = -1
  FLAG.retry = 0
  FLAG.danger = null
  FLAG.recovered = false
  syncConds()
}

/** callId -> [30s 定时器, 90s 定时器]：工具跑太久时她「摸鱼」。 */
export const longToolTimers = new Map()

export function syncConds() {
  const c = new Map()
  const add = (k, mood, props, pri) =>
    c.set(k, { mood, face: mood ? moodFace(mood) : null, props: (props || []).map(propExpr).filter(Boolean), pri })
  // 功能性（不受「应景装扮」开关管）：批准等待、重试、危险命令
  if (FLAG.approval >= 0) add('approval', ['confused', 'alert', 'sweat', 'sleepy'][Math.min(FLAG.approval, 3)], ['menuBoard'], 4)
  if (FLAG.retry > 0) add('retry', FLAG.retry >= 3 ? 'gloomy' : 'sweat', [], 3)
  if (FLAG.danger) add('danger', 'alert', ['claws'], 3)
  // 应景装扮：只改道具，不动脸；主人自己戴的同组装饰优先（resolveRig 里按组去重）
  if (CFG.flair !== false) {
    if (FLAG.pomo) add('pomo', null, ['headband'], 1)
    if (activeSubagents.size > 0) add('subagents', null, ['whaleHat'], 1)
    if (FLAG.plan) add('plan', null, ['glassesSquare'], 1)
    if (FLAG.yolo) add('yolo', null, ['glassesSun'], 1)
    // 夜晚桌布默认关（待机默认外观是「本子 + 笔」，不能自己变）：「好感」页里主人自己开
    if (FLAG.night && CFG.nightCloth === true) add('night', null, ['darkCloth'], 0)
  }
  rig.cond = c
  resolveRig()
}

// —— 批准等待：不是一句话，是一个会升级的状态（问号 → 感叹号 → 流汗 → 打瞌睡） ——
const approvalTimers = []

function clearApprovalTimers() {
  while (approvalTimers.length) clearTimeout(approvalTimers.pop())
}

export function approvalAsked() {
  observeApproval() // 批准疲劳：10 分钟里被问 ≥6 次
  clearApprovalTimers()
  FLAG.approval = 0
  syncConds()
  perform({ id: 'approval-0', pri: PRI.ALERT, tier: 'core', mood: 'confused', props: WORK_PROPS, say: 'approval0', ms: 3200, habit: false })
  for (const [wait, stage] of [[20000, 1], [60000, 2], [180000, 3]]) {
    approvalTimers.push(
      setTimeout(() => {
        if (FLAG.approval < 0) return
        FLAG.approval = stage
        syncConds()
        perform({ id: 'approval-' + stage, pri: PRI.ALERT, tier: 'core', say: 'approval' + stage, ms: 3200, habit: false })
      }, wait),
    )
  }
}

export function approvalDecided(outcome) {
  clearApprovalTimers()
  if (FLAG.approval < 0) return
  FLAG.approval = -1
  syncConds()
  if (outcome === 'allowed-once') perform({ id: 'approval-yes', pri: PRI.CUE, tier: 'core', mood: 'happy', say: 'approvalYes', ms: 2200 })
  // 提议被拒：「小丑竟是我自己」。六成演自嘲版（rejectClown，配小丑图），四成是平和的「好吧听主人的」
  else if (outcome === 'rejected') {
    empathySignal('reject')
    const ms = perform({ id: 'approval-no', pri: PRI.CUE, tier: 'core', mood: 'sad', say: Math.random() < 0.6 ? 'rejectClown' : 'approvalNo', ms: 2600 })
    if (ms) bondMemory('clown', 3500)
  }
}

// —— 重试：LLM 调用失败正在重试。恢复后（出了新的回复 / 一轮结束）自动撤 ——
let retryTimer = null

export function retryEvent(m) {
  empathySignal('retry')
  FLAG.retry = Math.max(1, Number(m.retry) || 1)
  syncConds()
  noteProcess('重试 ' + FLAG.retry + (m.max ? '/' + m.max : ''))
  perform({
    id: 'retry', pri: PRI.ALERT, tier: 'core', cool: 4000, habit: false, ms: 3200,
    mood: FLAG.retry >= 3 ? 'gloomy' : 'sweat', say: FLAG.retry >= 3 ? 'retry3' : 'retry1',
  })
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => retryCleared(false), 60000) // 兜底：60 秒没有新消息就当过去了
}

export function retryCleared(recovered) {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  if (FLAG.retry <= 0) return
  const was = FLAG.retry
  FLAG.retry = 0
  syncConds()
  if (recovered && was >= 2) perform({ id: 'retry-ok', pri: PRI.CUE, tier: 'extra', mood: 'happy', say: 'retryOk', ms: 2000 })
}
