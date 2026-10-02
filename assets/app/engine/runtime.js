/** engine/runtime.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { onVisibility, typingTarget } from '../behavior/page.js'
import { BASE, CFG } from '../config.js'
import { R, agent } from '../core/state.js'
import { readLayout } from '../core/storage.js'
import { loadScript, log } from '../core/util.js'
import { PRI, performingNow } from '../director/perform.js'
import { gaze } from './gaze.js'
import { buildMask, mask } from './mask.js'
import { motionActive } from './motion.js'
import { applyRig, restoreProps, rig, setBase } from './rig.js'
import { IDLE_PROPS } from '../persona/items.js'
import { applyPosition, fitFromMeasurement } from '../ui/layout.js'

export async function loadRuntime() {
  if (!window.Live2DCubismCore) await loadScript(BASE + '/vendor/live2dcubismcore.min.js')
  if (!window.PIXI) await loadScript(BASE + '/vendor/pixi.min.js')
  if (!window.PIXI || !window.PIXI.live2d) await loadScript(BASE + '/vendor/cubism4.min.js')
  if (!window.PIXI || !window.PIXI.live2d) throw new Error('Live2D 运行时未就绪')
}

/**
 * 性能档。
 *
 * 为什么要有：桌面壳（Mac 原生 App）为了不让她卡住，阻止了 macOS 的 App Nap，
 * 于是**永远满帧渲染** —— 浏览器里标签页不聚焦会自动降频，壳子里不会，
 * 所以主人在壳子里觉得电脑又热又卡。
 *
 * 低性能模式：帧率 20、渲染分辨率 1 倍、去掉自言自语和自主动作，
 * 只留眨眼 + 轻微摆动 + 视线；只有点她才会动。
 */
export const PERF = { low: false, /** 待机降帧生效中（诊断 / 测试用） */ throttled: false }

/**
 * 待机自动降帧。
 * 纯待机时她只是呼吸 / 眨眼 / 轻轻晃，30 帧和 15 帧肉眼差别很小，但渲染进程 + GPU 的占用几乎正好差一半
 * （无头 Chrome 软件渲染实测：30fps → 15fps，GPU 200% → 103%、渲染进程 8.8% → 5.9%）。
 * 「静」= agent 空闲、没有一次性表演 / 动作 / 说话 / 爱心脉冲、鼠标和打字都停了 3 秒以上，并且这样持续满 4 秒才降；
 * 只要有任何动静（鼠标一动、事件一来），下一个 tick 就回到满帧——所以交互不会感觉到「慢」。
 * 设置页「待机降帧」可以关（CFG.idleThrottle）。
 */
const IDLE_FPS = 15
const IDLE_AFTER_MS = 4000
const POINTER_QUIET_MS = 3000
let quietSince = 0

function isQuiet(now) {
  if (agent.status !== 'idle') return false
  // 待机大脑每 3.5~7.5 秒就会演一段 2~5 秒的「待机级」表演（换个表情 / 碎碎念），一半以上的时间都在演——
  // 它们只是换表情、不放动作，15 帧足够，所以只有更高优先级的互动（戳、摸、点菜单、事件反应）才算「有动静」。
  const cur = performingNow()
  if (cur && cur.pri > PRI.AMBIENT) return false
  if (rig.burst || rig.talking || motionActive()) return false
  if (now - (gaze.pointer.at || 0) < POINTER_QUIET_MS) return false
  if (typingTarget()) return false
  return true
}

/** 每个渲染 tick 跑一次：算出该用的帧率上限。maxFPS 只在变了才写。 */
function fpsGovernor() {
  if (!R.app) return
  const now = performance.now()
  const base = PERF.low ? 20 : 30
  let want = base
  if (CFG.idleThrottle !== false && isQuiet(now)) {
    if (!quietSince) quietSince = now
    if (now - quietSince >= IDLE_AFTER_MS) want = Math.min(IDLE_FPS, base)
  } else {
    quietSince = 0
  }
  PERF.throttled = want < base
  if (R.app.ticker.maxFPS !== want) R.app.ticker.maxFPS = want
}

function applyPerf() {
  if (R.app) {
    R.app.ticker.maxFPS = PERF.low ? 20 : 30
    const want = PERF.low ? 1 : Math.min(window.devicePixelRatio || 1, 1.5)
    try {
      if (R.app.renderer.resolution !== want) {
        const w = R.app.renderer.width
        const h = R.app.renderer.height
        R.app.renderer.resolution = want
        R.app.renderer.resize(w, h)
      }
    } catch (err) {}
  }
  try {
    document.body.classList.toggle('dshp-lowpower', PERF.low)
  } catch (err) {}
}

/** 壳子/设置页调它切档；返回当前档位方便确认 */
export function setLowPower(on) {
  PERF.low = !!on
  applyPerf()
  log('性能档：' + (PERF.low ? '低性能（少动、省电、20 帧）' : '标准（30 帧）'))
  return PERF.low
}

export async function buildModel() {
  const layout = readLayout()

  R.app = new PIXI.Application({
    width: 8,
    height: 8,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    // 掩码要读画布像素，没有 preserveDrawingBuffer 的话读到的是被清空后的缓冲
    preserveDrawingBuffer: true,
    resolution: Math.min(window.devicePixelRatio || 1, PERF.low ? 1 : 1.5),
    powerPreference: 'low-power',
  })
  // 这个模型 30 帧已经足够顺；60 帧纯粹是白烧 CPU/GPU（主人反馈电脑发热、发卡）
  R.app.ticker.maxFPS = PERF.low ? 20 : 30
  R.app.ticker.add(fpsGovernor)
  applyPerf()
  R.ui.stage.appendChild(R.app.view)

  const { Live2DModel } = PIXI.live2d
  Live2DModel.registerTicker(PIXI.Ticker)

  R.model = await Live2DModel.from(BASE + '/model/c_0120.model3.json', {
    autoInteract: false,
    autoUpdate: true,
    idleMotionGroup: 'idle',
  })
  R.model.eventMode = 'none'
  R.app.stage.addChild(R.model)

  const internal = R.model.internalModel
  R.coreModel = internal.coreModel

  // rig 挂载点：model.update() 之前的最后一站
  internal.on('beforeModelUpdate', applyRig)

  // 关掉框架自带的眨眼，改用我们自己的 blinkTick（节奏更像人）
  try {
    if (internal.eyeBlink) internal.eyeBlink = undefined
  } catch (e) {}

  // 掩码在 postrender 里采：此刻 WebGL 缓冲刚画好，且模型的世界变换已生效。
  // 必须在测量之前注册——测量就是靠它把画面读出来算实体范围的。
  R.app.renderer.on('postrender', () => {
    if (mask.dirty && !mask.building) buildMask()
  })

  const box = await fitFromMeasurement()
  applyPosition(layout)
  restoreProps()
  // 待机底层状态：平常脸 + 拿板子待着
  setBase('neutral', IDLE_PROPS)

  document.addEventListener('visibilitychange', () => {
    try {
      onVisibility() // 离开又回来：「欢迎回来」
    } catch (err) {}
    if (!R.app) return
    // 主人把她收起来了（setHidden 已经停了渲染循环）：标签页重新可见也不能把它再开起来——
    // 以前这里只看 document.hidden，收起之后切走再切回来，会在看不见的地方白白满帧渲染下去。
    if (document.hidden || (R.ui && R.ui.root.classList.contains('dshp-hidden'))) R.app.ticker.stop()
    else R.app.ticker.start()
  })

  log(
    `模型原始尺寸 ${Math.round(internal.originalWidth)}×${Math.round(internal.originalHeight)}` +
      (box ? ` · 布局 ${box.w}×${box.h}（${box.mode}，缩放 ${box.scale}）` : ''),
  )
}
