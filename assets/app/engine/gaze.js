/** engine/gaze.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { typingTarget } from '../behavior/page.js'
import { CFG } from '../config.js'
import { R } from '../core/state.js'
import { clamp } from '../core/util.js'
import { rig } from './rig.js'

// ——————————————————————————————————————————————————————————————
// 六点五、视线控制器
// ——————————————————————————————————————————————————————————————

/**
 * 为什么要有这一层：最初的做法是「鼠标一动就把头指过去」，结果头摆得像螺旋桨——
 * 又急、幅度又大、还一直死盯着你。现在拆成四件事：
 *
 *   1. 只有光标进到桌宠附近（GAZE_RADIUS）才跟随；离远了它自己发呆、看别处、想事情
 *   2. 幅度只取 58%（GAZE_GAIN），而且是「越近跟得越实、越远越松」，不做 100% 硬绑
 *   3. 目标怎么跳都不管，实际值一律限速逼近（GAZE_MAX_RATE）——头再急也只能慢慢转
 *   4. 互动/大动作期间 detach：人在做动作的时候眼睛不会死盯着你
 *
 * 关掉「视线跟随」之后它不会愣住——下面是同一套自主动作在跑。
 */
/**
 * 默认值（都能在设置里实时调，见 CFG.gaze*）：
 *   radius = 0   整屏跟随——鼠标在哪儿它看哪儿，不再只跟附近
 *   gain   = 0.78 跟随幅度；调小就「不太理你」，调大就更黏
 *   rate   = 1.6  每秒最多变化多少；调小更慵懒，调大更机灵
 */
export function gazeCfg() {
  return {
    radius: CFG.gazeRadius === undefined ? 0 : Number(CFG.gazeRadius),
    gain: CFG.gazeGain === undefined ? 0.78 : Number(CFG.gazeGain),
    rate: CFG.gazeRate === undefined ? 1.6 : Number(CFG.gazeRate),
  }
}

export const gaze = {
  x: 0,
  y: 0,
  tx: 0,
  ty: 0,
  mode: 'idle',
  detachUntil: 0,
  pointer: { x: 0, y: 0, seen: false },
  nextDrift: 0,
  driftX: 0,
  driftY: 0,
  lastTick: 0,
  /** 视线纵向偏置：读资料时压低，等于「低头看本子」，走的是同一条限速通道 */
  biasY: 0,
  biasTarget: 0,
}

/**
 * 爱心粒子。模型自带左右两组爱心（爱心左 j1–j32 / 爱心右 j33–j57），
 * 而 `love` 和 `ParamCheek73` 属于「通用动画(循环)」组——置 1 就会一直循环冒爱心，
 * 所以摸头时用它们做持续 2 秒的爱心爆发，再配脸红和爱心眼。
 */
export function heartBurst(ms) {
  rig.burst = { love: 1, heartbeat: 1, until: performance.now() + (ms || 2200) }
  rig.dirty = true
}

/** 做动作时暂时别盯人（对应 clawd-on-desk 那套「反应动画期间脱离眼球追踪」）。 */
export function gazeDetach(ms) {
  gaze.detachUntil = performance.now() + (ms || 1500)
}

/**
 * `ui.stage` 的屏幕矩形缓存。gazeTick 永远在跑（40ms 一次，待机也不停），
 * 之前每次都现读 `getBoundingClientRect()`——待机的时候她根本没动，
 * 这个矩形几十秒都不带变的，没必要每 40ms 强制触发一次布局读取。
 * 只在真的会动/会变的地方（拖动、贴边、resize、改大小）标脏，其余时候直接用缓存。
 */
let stageRect = null

let stageRectDirty = true

export function markStageRectDirty() {
  stageRectDirty = true
}

export function getStageRect() {
  if (stageRectDirty || !stageRect) {
    stageRect = R.ui.stage.getBoundingClientRect()
    stageRectDirty = false
  }
  return stageRect
}

/**
 * 主人正在打字的输入框的矩形，缓存 300ms。
 * 打字时 gazeTick 每 40ms 都要它：直接 getBoundingClientRect() 会在 DSH 刚改完 DOM（每敲一个键，输入框可能就在长高）
 * 之后立刻强制同步重排——DSH 的聊天页 DOM 一大，这就是每秒 25 次的额外重排，打字会发涩。
 * 输入框的位置在 300ms 里几乎不会动，视线也不需要更准。
 */
let typingRect = null

function typingRectOf(el, now) {
  if (!typingRect || typingRect.el !== el || now - typingRect.at > 300) {
    const r = el.getBoundingClientRect()
    typingRect = { el, at: now, left: r.left, top: r.top, width: r.width, height: r.height }
  }
  return typingRect
}

export function gazeTick() {
  if (!R.model || !R.ui) return
  const now = performance.now()
  const dt = Math.min(0.25, (now - (gaze.lastTick || now)) / 1000)
  gaze.lastTick = now
  const detached = now < gaze.detachUntil

  let wantX = 0
  let wantY = 0
  let following = false

  const g = gazeCfg()
  // 视线目标：做动作时脱离 > 主人在 DSH 输入框里打字（看着他打字的位置）> 鼠标 > 自己漂移
  let px = gaze.pointer.x
  let py = gaze.pointer.y
  let forced = false
  const typingEl = detached ? null : typingTarget()
  if (typingEl) {
    const tr = typingRectOf(typingEl, now)
    px = tr.left + Math.min(tr.width, 360) * 0.5
    py = tr.top + Math.min(tr.height, 80) * 0.5
    forced = true
  }
  if (!detached && (forced || (CFG.lookAtCursor && gaze.pointer.seen))) {
    const r = getStageRect()
    if (r.width) {
      const dx = px - (r.left + r.width / 2)
      const dy = py - (r.top + r.height / 2)
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (forced || g.radius <= 0 || dist < g.radius) {
        following = true
        // 参照距离按屏幕算，这样鼠标在屏幕任何角落都落在有效范围内
        const refX = Math.max(r.width, window.innerWidth * 0.5)
        const refY = Math.max(r.height, window.innerHeight * 0.5)
        wantX = clamp(dx / refX, -1, 1) * g.gain
        wantY = clamp(-dy / refY, -1, 1) * g.gain
      }
    }
  }

  if (following) {
    gaze.mode = 'follow'
  } else {
    // 没人管它：自己看东看西、想事情
    gaze.mode = detached ? 'detach' : 'idle'
    if (now > gaze.nextDrift) {
      gaze.nextDrift = now + 1800 + Math.random() * 4200
      gaze.driftX = (Math.random() * 2 - 1) * (detached ? 0.16 : 0.5)
      gaze.driftY = (Math.random() * 2 - 1) * (detached ? 0.1 : 0.32)
    }
    const t = now / 1000
    wantX = gaze.driftX + Math.sin(t * 0.37) * 0.07
    wantY = gaze.driftY + Math.cos(t * 0.29) * 0.05
  }

  // 低头看资料：只是给视线加一个纵向偏置，仍然受同一个限速器约束，
  // 所以不会突然「咔」一下低头。
  gaze.biasY += (gaze.biasTarget - gaze.biasY) * clamp(dt * 1.6, 0, 1)
  // 低头偏置是**改变方向**，不是放大幅度：
  // 合成方向后统一乘 gain，这样总幅度永远不超过 gain（否则低头会额外顶出去 0.3）。
  if (gaze.biasY !== 0 && following) {
    let dx2 = wantX / g.gain
    let dy2 = wantY / g.gain + gaze.biasY
    const mag = Math.sqrt(dx2 * dx2 + dy2 * dy2)
    if (mag > 1) {
      dx2 /= mag
      dy2 /= mag
    }
    wantX = dx2 * g.gain
    wantY = dy2 * g.gain
  } else if (!following) {
    wantY += gaze.biasY
  }
  wantX = clamp(wantX, -1, 1)
  wantY = clamp(wantY, -1, 1)

  gaze.tx += (wantX - gaze.tx) * clamp(dt * 3.0, 0, 1)
  gaze.ty += (wantY - gaze.ty) * clamp(dt * 3.0, 0, 1)
  const maxStep = g.rate * dt
  // 记录真实步长速率（单位/秒）。测试用它验证限速器，比在外部按采样间隔
  // 估算靠谱得多——页面卡顿会让 tick 变长，采样法会误判成「超速」。
  gaze.stepRate = Math.max(gaze.stepRate || 0, maxStep / Math.max(dt, 1e-6))
  gaze.x = clamp(gaze.x + clamp(gaze.tx - gaze.x, -maxStep, maxStep), -1, 1)
  gaze.y = clamp(gaze.y + clamp(gaze.ty - gaze.y, -maxStep, maxStep), -1, 1)

  try {
    // 注意：只调 focus() 是限不住的——框架自己还会把 x 朝 targetX 缓动一次，
    // 那一步比我们的限速更快。所以当前值和目标值一起写，限速器才是唯一权威。
    const fc = R.model.internalModel.focusController
    fc.targetX = gaze.x
    fc.targetY = gaze.y
    fc.x = gaze.x
    fc.y = gaze.y
    // 回读一下：写入被谁覆盖的话，这里能第一时间看出来
    gaze.fcX = fc.x
    gaze.fcErr = ''
  } catch (err) {
    gaze.fcErr = String((err && err.message) || err)
  }
}
