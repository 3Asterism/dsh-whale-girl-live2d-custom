/** engine/effects.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { R } from '../core/state.js'
import { saveLayout } from '../core/storage.js'
import { clamp } from '../core/util.js'
import { markStageRectDirty } from './gaze.js'
import { mask } from './mask.js'
import { createPressSpring, resolveProfile } from './press-spring.js'
import { clampY } from '../ui/layout.js'

// ——————————————————————————————————————————————————————————————
// 六点六、动作表现：Q 弹 / 惯性回弹 / 爱心 / 工作轮播
// ——————————————————————————————————————————————————————————————

// 按压缩进去、松手弹开：整个舞台（stage）的 transform 由一根弹簧驱动（物理见 press-spring.js）。
// 手势（gestures.js）调 pressIn / pressOut；程序化的「弹一下」（庆祝、被连戳……）调 qBounce，
// 它给同一根弹簧一个速度冲量 —— 所有弹跳共用一个状态，所以弹到一半被按下 / 被戳都是接着弹，不会跳帧，也不会打架。
// 参数来自模型自己的 manifest.json「press」块（不同模型不能直接套参数），缺省值见 PRESS_DEFAULT。

let profileSrc
let profileCache = null
function profile() {
  const raw = R.manifest && R.manifest.press
  if (!profileCache || profileSrc !== raw) {
    profileSrc = raw
    profileCache = resolveProfile(raw)
    // 系统设了「减少动态效果」：松开不再晃，回到原样就停（临界阻尼）
    try {
      if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) profileCache.releaseZeta = 1
    } catch (e) {}
  }
  return profileCache
}

const spring = createPressSpring(profile)
let springRaf = 0
let springLast = 0
let pressedAt = 0
let clickAbsorbUntil = 0

/** 缩放原点：'content' = 实体范围底边中点（自动量，换模型 / 留白不同都不用改），否则按 manifest 给的画布分数。 */
function pressOrigin(P) {
  if (Array.isArray(P.anchor)) return `${(P.anchor[0] * 100).toFixed(2)}% ${(P.anchor[1] * 100).toFixed(2)}%`
  const b = mask.bbox
  if (b && Number.isFinite(b.x0) && Number.isFinite(b.x1) && Number.isFinite(b.y1)) {
    return `${(((b.x0 + b.x1) / 2) * 100).toFixed(2)}% ${(b.y1 * 100).toFixed(2)}%`
  }
  return '50% 100%'
}

function springTransform() {
  const { sx, sy } = spring.scale()
  return `scale(${sx.toFixed(4)},${sy.toFixed(4)})`
}

function springFrame(now) {
  springRaf = 0
  const el = R.ui && R.ui.stage
  if (!el) {
    spring.reset()
    return
  }
  spring.step((now - springLast) / 1000)
  springLast = now
  markStageRectDirty() // 命中判定 / 视线都用 stage 的屏幕矩形，形变了就得重量
  if (spring.settled()) {
    spring.snap()
    // 按着的时候落定在满压：保持压扁；松开后落定在 0：清掉 transform，回到完全原样
    el.style.transform = spring.state().target === 1 ? springTransform() : ''
    return
  }
  el.style.transform = springTransform()
  springRaf = requestAnimationFrame(springFrame)
}

function springWake() {
  if (springRaf) return
  springLast = performance.now()
  springRaf = requestAnimationFrame(springFrame)
}

/** 静止时才重定原点：弹到一半换原点，画面会突然平移。 */
function springAtRest() {
  const { p, v } = spring.state()
  return p === 0 && v === 0
}

/** 按下：身体往里缩（快、不冲）。按住就一直缩着，松手才弹开。只动 stage 的 transform，不碰模型参数。 */
export function pressIn() {
  const el = R.ui && R.ui.stage
  if (!el) return
  if (springAtRest()) el.style.transformOrigin = pressOrigin(profile())
  pressedAt = performance.now()
  spring.press()
  springWake()
}

/** 松手（或被拎起 / 被打断）：弹开（欠阻尼，晃几下）。没按着就什么也不做。 */
export function pressOut() {
  if (spring.state().target !== 1) return
  spring.release()
  // 短按（不是按住）= 一次完整的「按下—弹开」，随后 poke 里的 qBounce(1) 不要再叠第二下，只补连戳多出来的部分
  if (performance.now() - pressedAt < 400) clickAbsorbUntil = performance.now() + 80
  springWake()
}

/**
 * Q 弹：程序化的「弹一下」（庆祝、被连戳、干活时被戳……），power=1 约等于一次满压的弹跳。
 * 不再用 Web Animations 的三帧关键帧：那种每次都从 scale(1,1) 硬起、互相覆盖；现在给同一根弹簧一个冲量，
 * 连着戳能量会叠加，按住的时候被打断也接得上。
 */
export function qBounce(power) {
  const el = R.ui && R.ui.stage
  if (!el) return
  let k = power == null ? 1 : Number(power)
  if (!(k > 0)) return
  if (performance.now() < clickAbsorbUntil) k -= 1 // 这一下按下—松开已经弹过了
  if (k <= 0.05) return
  if (springAtRest()) el.style.transformOrigin = pressOrigin(profile())
  spring.kick(k)
  springWake()
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
