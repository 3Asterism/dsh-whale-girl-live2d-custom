/** behavior/reset.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { GESTURE, strokeEnd } from './gestures.js'
import { CFG } from '../config.js'
import { R, agent } from '../core/state.js'
import { readLayout, saveLayout } from '../core/storage.js'
import { FLAG, resetTurnFlags, syncConds } from '../director/conds.js'
import { DIR } from '../director/perform.js'
import { gaze } from '../engine/gaze.js'
import { stopMotion } from '../engine/motion.js'
import { propExpr, rig, setBase } from '../engine/rig.js'
import { device, endWork } from '../engine/work.js'
import { ALL_TOGGLES, IDLE_PROPS } from '../persona/items.js'
import { applyPosition, fitModel } from '../ui/layout.js'
import { closePanels, setHidden } from '../ui/panels.js'

/**
 * 一键重置所有状态：回到「平常脸 + 正常坐姿 + 手里本子和笔」。
 * 主人要的是「不管我刚才把哪个特效点出来了、或者它自己卡在什么状态，
 * 点一下就全回正常」。
 *
 * 主人报过的 bug：「工作模式下点了蛋包饭/手机就一直卡着，连一键重置都救不回来。」
 * 查出来的真凶有两个：
 *   1. 重置只清了三层状态，**没停干活轮播**（work.active 还是 true）——
 *      于是 9~14 秒后 workTick 又把底层状态推回「看资料 + 星星眼」，
 *      看起来就是「表情怎么都回不去」；
 * 现在补上了：重置 = 连干活轮播、小设备、所有道具层一起归零。
 */
export function resetEverything() {
  endWork() // 停干活轮播（否则几秒后底层状态又被推回工作脸）
  // v0.5：持续型状态（批准等待 / 重试 / 危险命令 / 计划模式 / 放行…）和编排层记账一起归零，
  // 否则重置完她还举着牌子、戴着墨镜
  resetTurnFlags()
  FLAG.plan = false
  FLAG.yolo = false
  FLAG.fails = 0
  DIR.cur = null
  DIR.cool.clear()
  DIR.habit.clear()
  strokeEnd(true)
  GESTURE.holding = false
  rig.cond = new Map()
  rig.userProps.clear()
  rig.user = { face: null, until: 0 }
  rig.override = null
  rig.burst = null
  rig.weight.clear()
  // 兜底：所有道具一层不留（万一以后有人加了新的道具层，这里也不会漏）
  for (const key of Object.keys(ALL_TOGGLES)) {
    const expr = propExpr(key)
    if (expr) rig.userProps.delete(expr)
  }
  rig.props = new Set()
  device.out = false
  agent.toolProp = null
  agent.hasStream = false
  agent.sleeping = false
  gaze.biasTarget = 0
  gaze.biasY = 0
  gaze.detachUntil = 0
  gaze.stepRate = 0
  gaze.driftX = 0
  gaze.driftY = 0
  gaze.tx = 0
  gaze.ty = 0
  rig.talking = false
  setBase('neutral', IDLE_PROPS)
  stopMotion() // 回到模型默认姿势 = 正常坐姿
  closePanels()
  R.ui.bubble.hide()
  setHidden(false)
  const keep = { height: readLayout().height || CFG.height }
  saveLayout({ props: [], fit: 'full', x: null, y: null, hidden: false, ...keep })
  for (const k of ['left', 'top', 'right', 'bottom']) R.ui.root.style[k] = ''
  fitModel()
  applyPosition(readLayout())
  syncConds() // 夜晚桌布 / 番茄钟发箍这类「现在仍然成立」的状态重新算一遍
  return true
}
