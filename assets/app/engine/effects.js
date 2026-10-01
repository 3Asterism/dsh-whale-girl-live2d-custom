/** engine/effects.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { R } from '../core/state.js'
import { saveLayout } from '../core/storage.js'
import { clamp } from '../core/util.js'
import { markStageRectDirty } from './gaze.js'
import { clampY } from '../ui/layout.js'

// ——————————————————————————————————————————————————————————————
// 六点六、动作表现：Q 弹 / 惯性回弹 / 爱心 / 工作轮播
// ——————————————————————————————————————————————————————————————

/** Q 弹抖动：点击时整个身子软软地弹一下（Web Animations，不碰模型参数）。 */
export function qBounce(power) {
  const el = R.ui && R.ui.stage
  if (!el || !el.animate) return
  const k = power == null ? 1 : power
  el.style.transformOrigin = '50% 100%'
  el.animate(
    [
      { transform: 'scale(1,1)' },
      { transform: `scale(${1 + 0.1 * k},${1 - 0.12 * k})` },
      { transform: `scale(${1 - 0.045 * k},${1 + 0.055 * k})` },
      { transform: 'scale(1,1)' },
    ],
    { duration: 460, easing: 'cubic-bezier(.34,1.56,.64,1)' },
  )
}

/** 拖拽松手后的惯性回弹：速度衰减着滑一段，再落定。 */
export function dragInertia(vx, vy) {
  const el = R.ui && R.ui.root
  if (!el) return
  let px = parseFloat(el.style.left) || 0
  let py = parseFloat(el.style.top) || 0
  let sx = vx
  let sy = vy
  const h = el.getBoundingClientRect().height
  const step = () => {
    sx *= 0.85
    sy *= 0.85
    px = clamp(px + sx, -40, window.innerWidth - 60)
    py = clampY(py + sy, h, window.innerHeight)
    el.style.left = px + 'px'
    el.style.top = py + 'px'
    markStageRectDirty()
    if (Math.abs(sx) > 0.4 || Math.abs(sy) > 0.4) requestAnimationFrame(step)
    else saveLayout({ x: Math.round(px), y: Math.round(py), edge: null, edgeY: null, corner: null })
  }
  requestAnimationFrame(step)
}
