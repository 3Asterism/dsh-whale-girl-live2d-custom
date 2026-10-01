/** behavior/gestures.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { bondAct, bondMemory } from './bond.js'
import { poke } from './poke.js'
import { R, agent, bond } from '../core/state.js'
import { readLayout } from '../core/storage.js'
import { clamp } from '../core/util.js'
import { PRI, chatLevel, noteUser, perform, performingNow, yieldTo } from '../director/perform.js'
import { dragInertia } from '../engine/effects.js'
import { gaze, getStageRect, markStageRectDirty } from '../engine/gaze.js'
import { hitTest, overDock } from '../engine/mask.js'
import { IDLE_PROPS } from '../persona/items.js'
import { closeHud, hud, openHud } from '../ui/hud.js'
import { applyPosition, clampPanels, fitModel, snapOnRelease, visualMargins } from '../ui/layout.js'
import { closePanels, setHidden } from '../ui/panels.js'

// ——————————————————————————————————————————————————————————————
// 八、鼠标交互：悬停 / 拖动 / 戳 / 右键 / 双击
// ——————————————————————————————————————————————————————————————

// ——————————————————————————————————————————————————————————————
// 手势（v0.5）：左键只有一条通道，所以「摸」放到不按键的悬停通道
// ——————————————————————————————————————————————————————————————
//
//   左键通道（按下之后，三选一）：
//     位移 > 6px            → 拖动（拎起）
//     静止 ≥ 400ms          → 按住（「挤」：作者本来就把挤 / 点菜按下 / 画笔绑在左键按住上，松键即收）
//     400ms 内抬起、没位移  → 戳（原有 poke）
//     按住之后再动 → 转成拖动（长按后拎起是常见动作），按住的脸立刻收
//   悬停通道（没按键）：
//     在头部来回划，折返 ≥3 次、每段 ≥12px、速度 80–1500 px/s → 摸头（渐进：脸红 → 爱心 → 眯眼）
//     一路划过的鼠标折返数是 0，不会误触；工作中 / 面板开着 / 安静档都不触发。

export const GESTURE = { holdTimer: null, holding: false, liftedAt: 0 }

function gestureArmHold() {
  clearTimeout(GESTURE.holdTimer)
  GESTURE.holdTimer = setTimeout(() => {
    GESTURE.holdTimer = null
    GESTURE.holding = true
    // 「挤」是按住时才有的状态：TTL 兜底 20 秒（一定会过期），正常松键就收
    perform({ id: 'hold', pri: PRI.TOUCH, tier: 'extra', mood: 'playful', props: IDLE_PROPS.concat(['挤']), say: 'holdStart', ms: 20000, lineMs: 2400 })
    bondAct('hold')
  }, 400)
}

/** 松开 / 取消。返回「刚才是不是在按住」——是的话这次抬起不算戳。 */
function gestureEndHold(silent) {
  clearTimeout(GESTURE.holdTimer)
  GESTURE.holdTimer = null
  if (!GESTURE.holding) return false
  GESTURE.holding = false
  yieldTo(PRI.TOUCH) // 收掉「挤」
  if (!silent) perform({ id: 'hold-end', pri: PRI.TOUCH, tier: 'extra', mood: 'happy', say: 'holdEnd', ms: 1800 })
  return true
}

function gestureLift() {
  clearTimeout(GESTURE.holdTimer)
  GESTURE.holdTimer = null
  if (GESTURE.holding) {
    GESTURE.holding = false
    yieldTo(PRI.TOUCH)
  }
  GESTURE.liftedAt = performance.now()
  perform({ id: 'lift', pri: PRI.TOUCH, tier: 'extra', mood: 'alert', props: IDLE_PROPS, say: 'lift', ms: 2600 })
  bondMemory('lifted')
}

function gestureDrop() {
  const held = performance.now() - GESTURE.liftedAt
  GESTURE.liftedAt = 0
  yieldTo(PRI.TOUCH) // 收起「被拎起」的脸
  if (held > 700) perform({ id: 'drop', pri: PRI.TOUCH, tier: 'extra', mood: 'shy', say: 'drop', ms: 2000 })
}

const STROKE_STAGES = [
  null,
  { id: 'stroke1', mood: 'shy', say: 'stroke1', ms: 2400 },
  { id: 'stroke2', mood: 'love', heart: true, say: 'stroke2', ms: 2600 },
  { id: 'stroke3', mood: 'sleepy', say: 'stroke3', ms: 3200 },
]

const STROKE = { x: null, dir: 0, segStart: 0, revs: [], path: 0, t0: 0, lastT: 0, active: false, since: 0, last: 0, level: 0, timer: null }

function strokeClear() {
  STROKE.x = null
  STROKE.dir = 0
  STROKE.revs.length = 0
  STROKE.path = 0
  STROKE.t0 = 0
  STROKE.lastT = 0
}

export function strokeEnd(quiet) {
  const reached = STROKE.level
  const wasActive = STROKE.active
  if (STROKE.timer) clearInterval(STROKE.timer)
  STROKE.timer = null
  STROKE.active = false
  STROKE.level = 0
  strokeClear()
  // 停手：摸出「爱心」以上才有一句「诶？结束了吗」，轻轻划两下就走的不必
  if (wasActive && !quiet && reached >= 2) perform({ id: 'stroke-end', pri: PRI.TOUCH, tier: 'extra', mood: 'shy', say: 'strokeEnd', ms: 2200 })
}

function strokeReset() {
  strokeEnd(true)
}

/** 头部区域：命中她的像素，且在舞台上方 45% 以内（和 poke 里「戳头」是同一条判定）。 */
function strokeZone(x, y) {
  // 先用缓存的舞台矩形做廉价排除（pointermove 很高频，别每次都强制读布局）
  const r = getStageRect()
  if (!r.height || x < r.left || x > r.right || y < r.top || (y - r.top) / r.height >= 0.45) return false
  return hitTest(x, y)
}

function strokeTick() {
  if (!STROKE.active) return
  const now = performance.now()
  if (now - STROKE.last > 1500) return strokeEnd(false)
  const age = now - STROKE.since
  // 亲密度决定能摸到哪一档：初识只会脸红，熟悉到爱心，亲近以上才会舒服得眯眼
  const cap = bond.strokeMax // 摸头最高档随羁绊等级放开：1–2 级脸红，3–4 级爱心，5 级起眯眼
  const want = Math.min(cap, age < 2000 ? 1 : age < 6000 ? 2 : 3)
  if (want > STROKE.level) {
    STROKE.level = want
    perform(Object.assign({ pri: PRI.TOUCH, tier: 'extra', habit: false }, STROKE_STAGES[want]))
    return
  }
  // 摸着的时候保持这张脸（不说话）：一次性反应会过期，手还在动就接着演
  if (STROKE.level > 0 && !performingNow()) {
    const st = STROKE_STAGES[STROKE.level]
    perform({ id: 'stroke-keep', pri: PRI.TOUCH, tier: 'extra', habit: false, mood: st.mood, heart: !!st.heart, line: null, ms: 1100 })
  }
}

function strokeMove(x, y, buttons) {
  if (buttons) return // 按着键的不是「摸」，是左键通道
  if (chatLevel() < 1 || agent.status !== 'idle' || hud.open || R.ui.root.classList.contains('dshp-open') || R.ui.root.classList.contains('dshp-hidden')) {
    if (STROKE.x !== null) strokeClear()
    return
  }
  if (!strokeZone(x, y)) {
    if (STROKE.x !== null) strokeClear() // 离开头部：折返记录作废（已经在摸的由 strokeTick 超时收尾）
    return
  }
  const now = performance.now()
  if (STROKE.lastT && now - STROKE.lastT > 1400) strokeClear()
  if (STROKE.x === null) {
    STROKE.x = x
    STROKE.lastT = now
    STROKE.t0 = now
    return
  }
  const dx = x - STROKE.x
  if (Math.abs(dx) < 2) return // 手抖
  const dir = dx > 0 ? 1 : -1
  STROKE.path += Math.abs(dx)
  if (STROKE.dir === 0) {
    STROKE.dir = dir
    STROKE.segStart = STROKE.x
  } else if (dir !== STROKE.dir) {
    if (Math.abs(STROKE.x - STROKE.segStart) >= 12) STROKE.revs.push(now) // 这一段够长才算一次折返
    STROKE.dir = dir
    STROKE.segStart = STROKE.x
  }
  STROKE.x = x
  STROKE.lastT = now
  while (STROKE.revs.length && now - STROKE.revs[0] > 1400) STROKE.revs.shift()
  if (STROKE.revs.length < 3) return
  const speed = STROKE.path / Math.max(0.3, (now - STROKE.t0) / 1000)
  if (speed < 80 || speed > 1500) return // 太慢像发呆，太快像甩过去
  STROKE.last = now
  if (!STROKE.active) {
    STROKE.active = true
    STROKE.since = now
    STROKE.level = 0
    noteUser()
    bondAct('stroke') // 冷却 / 每日上限在服务端判
    STROKE.timer = setInterval(strokeTick, 300)
  }
  strokeTick()
}

export function wireInteractions() {
  const root = R.ui.root
  let dragging = false
  let dragMoved = false
  let start = null
  let leaveTimer = null
  const drag = { vx: 0, vy: 0 }
  /**
   * 拖动这一路上用的留白缓存：按下的时候现测一次就够了（拖动中她的轮廓不会变），
   * 没必要跟 visualMargins() 一样每次都强制重测——那是给松手那一刻的精确判断用的，
   * 真拖起来（pointermove 高频触发）每帧都测一次画布就太贵了。
   */
  let dragMargins = { left: 0, right: 0, top: 0, bottom: 0 }

  document.addEventListener(
    'pointermove',
    (e) => {
      if (!dragging) {
        strokeMove(e.clientX, e.clientY, e.buttons) // 悬停通道（没按键）：摸头
        // 主人反馈：「我鼠标往下走要去点那三个键，一离开她身上它们就消失了，点不着」。
        // 原因：原来只认 hitTest（她模型身上），而工具栏在她**下方**、不在模型掩码里。
        // 现在把「鼠标在工具栏矩形内」也算作悬停，并且离开后多留 900ms。
        const on = hitTest(e.clientX, e.clientY) || overDock(e.clientX, e.clientY)
        if (on) {
          root.classList.add('dshp-hover')
          if (leaveTimer) {
            clearTimeout(leaveTimer)
            leaveTimer = null
          }
        } else if (!leaveTimer && !root.classList.contains('dshp-open')) {
          leaveTimer = setTimeout(() => {
            leaveTimer = null
            if (!root.classList.contains('dshp-open')) root.classList.remove('dshp-hover')
          }, 900)
        }
      } else if (start) {
        const dx = e.clientX - start.mx
        const dy = e.clientY - start.my
        // 点击容差 6px（以前 4px，手一抖就被判成拖动）：6px 以内算「还没动」
        if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 6) {
          dragMoved = true
          gestureLift() // 按住后动了 = 拎起来（同时终止「按住」）
        }
        if (dragMoved) {
          const nRect = root.getBoundingClientRect()
          const nh = nRect.height
          const nw = nRect.width
          // 原来是写死的 -40/-60 容差——现在贴角落要求看得见的边能拖到真正
          // 贴墙，写死的小容差不够用（透明留白一大，包围盒还没到边就被卡住了，
          // 松手时永远进不了 SNAP_DIST）。改成按这次抓起来时量到的留白放宽：
          // 包围盒可以拖到「留白刚好出屏幕、看得见的部分刚好贴墙」那个位置。
          const nx = clamp(start.left + dx, -dragMargins.left - 20, window.innerWidth - nw + dragMargins.right + 20)
          // 竖直方向同理放宽；不贴角落的话，松手交给 snapOnRelease/dragInertia
          // 各自的规矩去收（dragInertia 仍然会退回给工具条留白的安全范围）。
          const ny = clamp(start.top + dy, -dragMargins.top - 20, window.innerHeight - nh + dragMargins.bottom + 20)
          // 身体随拖动方向摇摆：横向速度直接喂给身体的倾斜
          drag.vx = nx - (parseFloat(root.style.left) || nx)
          drag.vy = ny - (parseFloat(root.style.top) || ny)
          root.style.left = nx + 'px'
          root.style.top = ny + 'px'
          root.style.right = 'auto'
          root.style.bottom = 'auto'
          markStageRectDirty()
        }
      }
      // 只记录坐标，真正的跟随在 gazeTick 里限速执行——
      // 直接在 pointermove 里写 focusController 就是「螺旋桨」的成因。
      gaze.pointer.x = e.clientX
      gaze.pointer.y = e.clientY
      gaze.pointer.seen = true
    },
    { passive: true },
  )

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return
      if (!hitTest(e.clientX, e.clientY)) return
      // 点在鲸鱼娘身上：吃掉这次点击，别让下面的 DSH 界面也响应
      e.stopPropagation()
      e.preventDefault()
      noteUser()
      strokeReset()
      dragging = true
      dragMoved = false
      gestureArmHold() // 400ms 不动 = 按住（作者绑在左键按住上的「挤」）
      delete root.dataset.edge // 一拖就离开墙，别再显示「贴着左边」
      delete root.dataset.corner // 同上：一拖就离开角落，工具条先挪回下面，吸没吸得上松手再说
      dragMargins = visualMargins()
      const r = root.getBoundingClientRect()
      start = { mx: e.clientX, my: e.clientY, left: r.left, top: r.top }
    },
    true,
  )

  document.addEventListener(
    'pointerup',
    (e) => {
      if (!dragging) return
      dragging = false
      const wasHold = gestureEndHold()
      if (dragMoved) {
        // 松手：先看要不要贴边吸附，没吸附上再走自由惯性
        if (!snapOnRelease()) dragInertia(drag.vx, drag.vy)
        drag.vx = 0
        drag.vy = 0
        gestureDrop()
      } else if (!wasHold) {
        poke(e.clientX, e.clientY) // 只有「没按住、没拖动」的快速点按才算戳
      }
      start = null
    },
    true,
  )

  document.addEventListener('pointercancel', () => {
    dragging = false
    start = null
    gestureEndHold(true)
  })

  document.addEventListener(
    'contextmenu',
    (e) => {
      if (!hitTest(e.clientX, e.clientY)) return
      e.preventDefault()
      e.stopPropagation()
      // 主人要求：右键弹「余额 / 本轮消耗 / 峰谷」这个框，不再直接弹设置菜单
      // （设置还在工具栏的 ⋯ 里，没有丢）
      if (hud.open) closeHud()
      else openHud({ flash: true, refresh: true })
    },
    true,
  )

  document.addEventListener(
    'dblclick',
    (e) => {
      // 主人要求：输入框只从工具栏的「说话」按钮开，双击鱼身不再弹它。
      // 双击仍然算一次戳她（第一下 click 已经触发过了），这里只吃掉默认行为。
      if (!hitTest(e.clientX, e.clientY)) return
      e.preventDefault()
    },
    true,
  )

  window.addEventListener('resize', () => {
    fitModel()
    const layout = readLayout()
    // 贴着角落 / 贴着左右墙的：重新贴住原来那个位置（角落两个方向都重新锁一遍，
    // 贴墙的只锁那一侧，竖直位置不变，只夹进可见范围）
    if (layout.corner || layout.edge === 'left' || layout.edge === 'right') {
      applyPosition(layout)
    } else if (root.style.left && root.style.left !== 'auto') {
      root.style.left = clamp(parseFloat(root.style.left) || 0, -40, window.innerWidth - 60) + 'px'
      root.style.top = clamp(parseFloat(root.style.top) || 0, -20, window.innerHeight - 60) + 'px'
    }
    markStageRectDirty() // 视口本身变了，缓存的矩形肯定不准了——兜底再标一次
    clampPanels()
  })

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (hud.open) {
      e.stopPropagation()
      closeHud()
      return
    }
    if (!R.ui.root.classList.contains('dshp-open')) return
    e.stopPropagation()
    closePanels()
  })

  R.ui.tab.addEventListener('click', () => setHidden(false))

  // 面板内点击不要穿透到下面的界面
  for (const el of [R.ui.composer.el, R.ui.menu.el, R.ui.hud.el, R.ui.dock]) {
    el.addEventListener('pointerdown', (e) => e.stopPropagation())
  }

  // 鼠标停在 HUD 上时不要自动收（主人在看）
  R.ui.hud.el.addEventListener('pointerenter', () => {
    hud.hover = true
    hud.hideAt = 0
  })
  R.ui.hud.el.addEventListener('pointerleave', () => {
    hud.hover = false
  })
  // 点 HUD 之外的任何地方就收起来（跟菜单一个规矩）
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!hud.open) return
      if (e.button !== 0) return // 右键不在这里处理，交给 contextmenu 做「再按一次收起」
      const t = e.target
      if (t && (t === R.ui.hud.el || R.ui.hud.el.contains(t))) return
      closeHud()
    },
    true,
  )

  // 点面板以外任何地方（含 DSH 界面、甚至桌宠自己身上）都收起面板
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!R.ui.root.classList.contains('dshp-open')) return
      const t = e.target
      if (t && (t === R.ui.root || R.ui.root.contains(t))) return
      if (t && R.ui.menu.el.contains(t)) return
      if (t && R.ui.composer.el.contains(t)) return
      closePanels()
    },
    true,
  )
}
