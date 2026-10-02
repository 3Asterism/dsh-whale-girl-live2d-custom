/** engine/work.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { noteProcess } from '../behavior/events.js'
import { R } from '../core/state.js'
import { pickFresh } from '../core/util.js'
import { gaze, gazeDetach } from './gaze.js'
import { playMotion, stopMotion } from './motion.js'
import { rig, setBase } from './rig.js'
import { WORK_PROPS } from '../persona/items.js'
import { SAY } from '../persona/say.js'

/**
 * 工作轮播。规格要求「变出小电脑、敲键盘、轮播 认真/摸鱼/思考」。
 * 所以干活期间不是钉在一张脸上，而是按节奏换：敲键盘 → 认真看 → 偷偷摸鱼 → 思考。
 */
// 干活时的两个状态：认真看资料 / 思考。切换很慢（见 workTick 的间隔），
// 主人明确说过「工作模式下不要切太多」。
const WORK_CYCLE = [
  { mood: 'reading', say: 'reading' },
  { mood: 'thinking', say: 'thinking' },
]

export const work = { i: 0, nextAt: 0, active: false }

/** 小设备是否已经掏出来了（查资料时），用完要收回去 */
export const device = { out: false }

export function startWork() {
  if (work.active) return
  work.active = true
  work.i = 0
  work.nextAt = 0
  // 用模型自带的开盖动作把设备掏出来；道具由 WORK_PROPS 决定
  playMotion('openLid')
  gazeDetach(1200)
}

export function endWork() {
  work.active = false
  gaze.biasTarget = 0
  putDeviceAway()
}

/** 把小设备收回去，回到常驻待机动作。 */
export function putDeviceAway() {
  if (!device.out) return
  device.out = false
  // 收起小设备，回到默认姿势（手里的笔也就回来了）
  stopMotion()
}

export function workTick() {
  if (!work.active) return
  const now = performance.now()
  if (now < work.nextAt) return
  work.nextAt = now + 9000 + Math.random() * 5000 // 慢切换
  const stepDef = WORK_CYCLE[work.i % WORK_CYCLE.length]
  work.i++
  // 轮播只改底层状态，不产生会赖着不走的一次性反应
  setBase(stepDef.mood, WORK_PROPS)
  // 正在思考/看资料：把话说到气泡正文里，别只更新脚注（那样看着像在摸鱼）
  if (!rig.talking && R.ui.bubble.visible) {
    R.ui.bubble.show(pickFresh(SAY[stepDef.say], 'work-' + stepDef.say), {
      name: '鲸鱼娘',
      busy: true,
      sticky: true,
      keepSticker: true, // 别把正在播的「正在思考」顶掉
    })
    noteProcess(stepDef.mood === 'reading' ? '看资料' : '思考中')
  }
}
