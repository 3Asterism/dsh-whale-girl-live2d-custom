/** behavior/pomodoro.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { bondMemory } from './bond.js'
import { playAction } from './menu-actions.js'
import { FLAG, syncConds } from '../director/conds.js'
import { PRI, perform } from '../director/perform.js'

// —— 番茄钟（唯一需要主人主动开的）：专注 25 → 挤番茄酱庆祝 → 休息 5 ——
// onTick：设置页按钮的刷新回调
export const POMO = { phase: 'off', endAt: 0, timer: null, onTick: null }
const POMO_FOCUS_MS = 25 * 60000
const POMO_BREAK_MS = 5 * 60000

export function pomoLeft() {
  return POMO.phase === 'off' ? 0 : Math.max(0, POMO.endAt - Date.now())
}

function pomoNotify() {
  try {
    if (POMO.onTick) POMO.onTick()
  } catch (err) {}
}

export function startPomo() {
  stopPomo(true)
  POMO.phase = 'focus'
  POMO.endAt = Date.now() + POMO_FOCUS_MS
  FLAG.pomo = true
  syncConds() // 发箍（应景装扮）
  perform({ id: 'pomo-start', pri: PRI.EXPLICIT, tier: 'core', mood: 'excited', say: 'pomoStart', ms: 3000, habit: false })
  POMO.timer = setInterval(pomoTick, 1000)
  pomoNotify()
}

export function stopPomo(silent) {
  if (POMO.timer) clearInterval(POMO.timer)
  POMO.timer = null
  POMO.phase = 'off'
  FLAG.pomo = false
  syncConds()
  if (!silent) pomoNotify()
}

function pomoTick() {
  if (POMO.phase === 'off') return
  if (Date.now() < POMO.endAt) {
    pomoNotify()
    return
  }
  if (POMO.phase === 'focus') {
    FLAG.pomo = false
    syncConds()
    playAction('omurice', { pri: PRI.FINISH, id: 'pomo-end', say: 'pomoEnd' }) // 番茄钟 ↔ 番茄酱
    bondMemory('pomodoro')
    POMO.phase = 'break'
    POMO.endAt = Date.now() + POMO_BREAK_MS
  } else {
    perform({ id: 'pomo-break-end', pri: PRI.CUE, tier: 'core', mood: 'alert', say: 'pomoBreakEnd', ms: 3000, habit: false })
    stopPomo(false)
    return
  }
  pomoNotify()
}
