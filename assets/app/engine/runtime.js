/** engine/runtime.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { onVisibility } from '../behavior/page.js'
import { BASE } from '../config.js'
import { R } from '../core/state.js'
import { readLayout } from '../core/storage.js'
import { loadScript, log } from '../core/util.js'
import { buildMask, mask } from './mask.js'
import { applyRig, restoreProps, setBase } from './rig.js'
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
export const PERF = { low: false }

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
    if (document.hidden) R.app.ticker.stop()
    else R.app.ticker.start()
  })

  log(
    `模型原始尺寸 ${Math.round(internal.originalWidth)}×${Math.round(internal.originalHeight)}` +
      (box ? ` · 布局 ${box.w}×${box.h}（${box.mode}，缩放 ${box.scale}）` : ''),
  )
}
