/** engine/mask.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { FIT_FRACTION } from '../config.js'
import { R } from '../core/state.js'
import { log } from '../core/util.js'

// ——————————————————————————————————————————————————————————————
// 六、命中掩码：让点击穿透空气
// ——————————————————————————————————————————————————————————————

export const mask = { grid: null, w: 0, h: 0, dirty: true, building: false, lastBuild: 0, bbox: null, bands: null }

/**
 * 一条竖带里「实体质量的横向重心与范围」。
 *
 * 为什么不直接用整条带的外接框：这个模型是一整张书桌场景，桌子比人宽得多。
 * 按整条带的外接框取景，镜头会被人两边的东西（桌沿、鼠标垫）拽偏，
 * 结果就是人在画面左边、右边一大片空。按「质量」算重心就稳得多。
 */
function bandWindow(grid, W, y0, y1) {
  const cols = new Float32Array(W)
  let max = 0
  for (let y = y0; y < y1; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) {
      if (grid[row + x]) {
        cols[x]++
        if (cols[x] > max) max = cols[x]
      }
    }
  }
  if (max <= 0) return null
  const thresh = max * 0.25
  let mass = 0
  let wsum = 0
  for (let x = 0; x < W; x++) {
    // 只统计「有实体分量」的列，零星空隙不会把重心拽走
    if (cols[x] >= thresh) {
      mass += cols[x]
      wsum += cols[x] * x
    }
  }
  if (mass <= 0) return null
  const center = wsum / mass
  return { center: center / W }
}

/** 为每个取景档算出各自的横向重心（归一化）。 */
function computeBands(grid, W, H, bbox) {
  const y0 = Math.max(0, Math.floor(bbox.y0 * H))
  const y1 = Math.min(H, Math.ceil(bbox.y1 * H))
  const ch = Math.max(1, y1 - y0)
  const out = {}
  for (const [mode, frac] of Object.entries(FIT_FRACTION)) {
    const by1 = Math.min(y1, Math.max(y0 + 1, Math.round(y0 + ch * frac)))
    const win = bandWindow(grid, W, y0, by1)
    out[mode] = win || { center: (bbox.x0 + bbox.x1) / 2 }
  }
  return out
}

/**
 * 采样用的小画布，复用同一张：拖完松手贴边、窗口缩放、每次点她（量留白）都会重建掩码，
 * 以前每次都 createElement('canvas') + getContext 新建一份，纯粹的分配 / GC。
 */
let scratch = null

function scratchCanvas(W, H) {
  if (!scratch) {
    const c = document.createElement('canvas')
    scratch = { c, g: c.getContext('2d', { willReadFrequently: true }) }
  }
  // 只有尺寸变了才重设（设 width / height 本身会清空并重新分配画布缓冲）
  if (scratch.c.width !== W) scratch.c.width = W
  if (scratch.c.height !== H) scratch.c.height = H
  return scratch
}

/**
 * 预烘的静态阴影。
 * 以前阴影是 `.dshp-stage{filter:drop-shadow(0 10px 20px)}`：画布每帧更新（30fps），这个模糊滤镜就每帧对整个舞台重跑一遍。
 * 现在把她的轮廓（采样出来的 alpha，已经有了）画成一张黑色小画布，放在舞台里画布的后面，
 * 模糊 / 下移 / 透明度用 CSS 加在这张**静态**画布上——内容不变，合成器缓存住模糊后的结果，每帧零成本。
 * 只在掩码重建时（布局变了 / 拖完松手 / 点她量留白）重画；轮廓临时变化（戴个道具）不会马上反映，几乎看不出来。
 * 阴影跟着舞台一起被弹簧压扁 / 弹开（它就在舞台里面）。低性能档下 CSS 直接把它藏掉。
 */
let shadow = null

function paintShadow(rgba, W, H) {
  const stage = R.ui && R.ui.stage
  if (!stage) return
  if (!shadow) {
    const c = document.createElement('canvas')
    c.className = 'dshp-shadow'
    c.setAttribute('aria-hidden', 'true')
    // 放在 DOM 里 WebGL 画布的后面（别人 querySelector('canvas') 取到的还得是 WebGL 那张——桌面壳就这么取），
    // 用 CSS 的负 z-index 压到它下面（舞台有 isolation:isolate，不会掉到 DSH 页面后面去）
    stage.appendChild(c)
    shadow = { c, g: c.getContext('2d') }
  }
  if (shadow.c.width !== W) shadow.c.width = W
  if (shadow.c.height !== H) shadow.c.height = H
  const img = shadow.g.createImageData(W, H)
  const d = img.data
  // RGB 保持 0（黑），只留 alpha：就是她的剪影
  for (let i = 3; i < d.length; i += 4) d[i] = rgba[i]
  shadow.g.putImageData(img, 0, 0)
}

export function buildMask(force) {
  if (!R.app || !R.model || mask.building) return
  if (!force && performance.now() - mask.lastBuild < 300) return
  mask.building = true
  try {
    const src = R.app.view
    if (!src || !src.width || !src.height) throw new Error('画布还没准备好')
    const W = 128
    const H = Math.max(24, Math.round((W * src.height) / src.width))
    const { g } = scratchCanvas(W, H)
    g.clearRect(0, 0, W, H)
    g.drawImage(src, 0, 0, W, H)
    const data = g.getImageData(0, 0, W, H).data
    const grid = new Uint8Array(W * H)
    let filled = 0
    let minx = W
    let miny = H
    let maxx = -1
    let maxy = -1
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        if (data[i * 4 + 3] > 26) {
          grid[i] = 1
          filled++
          if (x < minx) minx = x
          if (x > maxx) maxx = x
          if (y < miny) miny = y
          if (y > maxy) maxy = y
        }
      }
    }
    const coverage = filled / (W * H)
    // 全空说明这一帧没画上东西，别把掩码覆盖成「处处不可点」
    if (coverage < 0.005) throw new Error('画面是空的')
    mask.grid = grid
    mask.w = W
    mask.h = H
    mask.bbox =
      maxx >= 0
        ? { x0: minx / W, y0: miny / H, x1: (maxx + 1) / W, y1: (maxy + 1) / H }
        : null
    mask.bands = mask.bbox ? computeBands(grid, W, H, mask.bbox) : null
    mask.dirty = false
    mask.lastBuild = performance.now()
    paintShadow(data, W, H)
    log(
      `命中掩码 ${W}×${H}，覆盖率 ${(coverage * 100).toFixed(1)}%` +
        (mask.bbox
          ? `，实体范围 x ${mask.bbox.x0.toFixed(2)}–${mask.bbox.x1.toFixed(2)} / y ${mask.bbox.y0.toFixed(2)}–${mask.bbox.y1.toFixed(2)}`
          : ''),
    )
  } catch (err) {
    // 拿不到掩码就退回整个矩形可点，功能不至于丢
    mask.grid = null
    mask.dirty = false
    mask.lastBuild = performance.now()
    console.warn('[鲸鱼娘] 掩码生成失败，退回包围盒判定：', err && err.message)
  } finally {
    mask.building = false
  }
}

/** 客户端坐标是否落在鲸鱼娘身上（而不是桌宠框里的空气）。 */
export function hitTest(clientX, clientY) {
  const stage = R.app && R.app.view && R.app.view.parentElement
  if (!stage) return false
  const r = stage.getBoundingClientRect()
  if (!r.width || !r.height) return false
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false
  if (!mask.grid) return true
  const mx = Math.floor(((clientX - r.left) / r.width) * mask.w)
  const my = Math.floor(((clientY - r.top) / r.height) * mask.h)
  if (mx < 0 || my < 0 || mx >= mask.w || my >= mask.h) return false
  return mask.grid[my * mask.w + mx] === 1
}
