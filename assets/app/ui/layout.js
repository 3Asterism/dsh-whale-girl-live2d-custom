/** ui/layout.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { CFG, FIT_FRACTION, UI_BASE_HEIGHT, VIEW_ASPECT } from '../config.js'
import { R } from '../core/state.js'
import { readLayout, saveLayout } from '../core/storage.js'
import { clamp } from '../core/util.js'
import { markStageRectDirty } from '../engine/gaze.js'
import { buildMask, mask } from '../engine/mask.js'

/**
 * 把面板夹回视口内。
 *
 * 主人抱怨菜单「不太好用」——桌宠默认蹲在右下角，面板又是以模型为中心
 * 左右展开的，于是右边那一截（包括关闭按钮和滑块的右半段）直接跑到屏幕外，
 * 点都点不到。这里量一下真实位置，用一个横向偏移把它推回来。
 */
/**
 * 面板往哪边展开 —— **纯计算，不「量了再挪」**。
 *
 * 主人报的问题：「弹窗一次往左一次往右，靠墙那次还会卡进墙里一半」。
 * 根因是旧写法：先把位移清零、量面板位置、再据此设位移，而位移本身带过渡动画，
 * 量到动画中间态就会一次算左一次算右，来回翻。
 * 现在只看一件事：桌宠在屏幕的左半边还是右半边 ——
 *   · 在左半边（左边是墙）→ 面板往**右**开
 *   · 在右半边（右边是墙）→ 面板往**左**开
 * 然后兜底夹进视口，保证整个面板（含右上角的 ×）都在屏幕里。
 */
/**
 * 她脑袋在屏幕上的横坐标。
 * 主人要的是「聊天框放在正头顶」，而桌宠的根节点包含整张书桌场景，
 * 根节点中心 ≠ 脑袋中心，所以这里用测量出来的「头部重心」换算成屏幕坐标。
 */
export function headScreenX() {
  const r = R.ui.root.getBoundingClientRect()
  try {
    const b = R.contentBox && R.contentBox.bands
    const head = b && b.head && b.head.center
    const view = b && b.full && b.full.center
    if (typeof head === 'number' && typeof view === 'number' && R.lastView && R.model) {
      const baseW = R.model.internalModel.width || R.model.internalModel.originalWidth || 0
      const dx = (head - view) * baseW * (R.lastView.scale || 0)
      if (Number.isFinite(dx) && Math.abs(dx) < r.width) return r.left + r.width / 2 + dx
    }
  } catch (e) {}
  return r.left + r.width / 2
}

/**
 * 气泡/面板/HUD 全都必须整个待在 DSH app 自己的窗口里——不管是网页版的
 * 浏览器视口，还是桌面壳那个固定尺寸（560×900）的透明覆盖窗口，`window.innerWidth/
 * innerHeight` 在两种情况下都正好等于「这个 app 能画画的地方」，所以只要
 * 面板的四条边都夹在 `[pad, vw/vh - pad]` 里，就一定没有超出 app 本身。
 *
 * 光「横向夹+纵向推」不够：面板默认长在她头顶上方，桌面壳窗口特地留高
 * 就是为了给这个上方留白。可她现在能贴死在顶部角落了（EDGE_GAP 几乎到顶），
 * 头顶就没有留白可言——硬推的话面板会被压扁/顶穿窗口顶边。真正靠谱的做法
 * 是「翻转」：上面放不下、下面比上面宽裕，就整个翻到脚下去（CSS 见
 * `.dshp-flip`），而不是在放不下的地方硬挤。
 */
function placePanel(panel) {
  if (!panel) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const pad = 10
  panel.style.setProperty('--dshp-shift', '0px')
  panel.style.setProperty('--dshp-shift-y', '0px')
  panel.classList.remove('dshp-flip')
  if (!panel.classList.contains('dshp-on')) return
  const w = panel.getBoundingClientRect().width || 0
  const h = panel.getBoundingClientRect().height || 0
  if (!w) return
  const r = R.ui.root.getBoundingClientRect()
  const anchor = headScreenX() // 对准头顶，而不是整个场景的中心
  // 面板基准是「以桌宠中心居中」（left:50% + translateX(-50%)），所以位移 = 锚点 - 根节点中心
  let shift = anchor - (r.left + r.width / 2)
  // 靠墙时往反方向挪，保证整个面板（含 × ）都在屏幕里
  const left = anchor + shift - w / 2
  if (left < pad) shift += pad - left
  else if (left + w > vw - pad) shift -= left + w - (vw - pad)
  panel.style.setProperty('--dshp-shift', Math.round(shift) + 'px')

  // 纵向：默认贴头顶上方；上面的空间不够放、下面比上面宽裕，就整个翻下去
  const spaceAbove = r.top
  const spaceBelow = vh - r.bottom
  const flip = spaceAbove < h + pad && spaceBelow > spaceAbove
  panel.classList.toggle('dshp-flip', flip)
  if (flip) {
    const bottom = panel.getBoundingClientRect().bottom
    panel.style.setProperty('--dshp-shift-y', bottom > vh - pad ? Math.round(vh - pad - bottom) + 'px' : '0px')
  } else {
    const top = panel.getBoundingClientRect().top
    panel.style.setProperty('--dshp-shift-y', top < pad ? Math.round(pad - top) + 'px' : '0px')
  }
}

export function clampPanels() {
  placePanel(R.ui && R.ui.menu && R.ui.menu.el)
  placePanel(R.ui && R.ui.composer && R.ui.composer.el)
  placePanel(R.ui && R.ui.hud && R.ui.hud.el)
  placePanel(R.ui && R.ui.bubble && R.ui.bubble.el)
}

export function fitModel(explicitHeight) {
  if (!R.model || !R.app) return
  const im = R.model.internalModel
  // 只信 internalModel：Live2DModel 继承 PIXI Container，没有自己的 width 取值器
  const baseW = im.width || im.originalWidth || 1
  const baseH = im.height || im.originalHeight || 1
  const saved = readLayout()
  const wanted = clamp(Number(explicitHeight) || Number(saved.height) || CFG.height, 120, 900)
  // 用户明确要求：一直用「整张桌子」，不做上半身/只有头的取景。
  const mode = 'full'
  const frac = FIT_FRACTION[mode] || 1

  // 角色在画布里的实体范围（归一化）。没测出来就退回整个画布。
  const box = R.contentBox || { x0: 0, y0: 0, x1: 1, y1: 1, bands: null }
  const ch = Math.max(0.02, box.y1 - box.y0)
  const cw = Math.max(0.02, box.x1 - box.x0)

  // 四周留余量：主人反馈「尾巴被截掉、有些表情出格被掐」。
  // 原因是原来视窗高度**正好等于**实体高度、宽度又按固定宽高比算 ——
  // 横向超出（尾巴、头顶鲸）和纵向超出（举起来的道具、惊讶表情）就都被裁掉了。
  // 现在实体四周各留 PAD，窗口比实体大一圈，她才能完整显示。
  const PAD = 0.1
  const viewHModel = ch * frac * baseH * (1 + PAD * 2)
  // 宽度取「固定宽高比」和「实体宽度 + 余量」里更宽的那个
  const viewWModel = Math.max(viewHModel * VIEW_ASPECT, cw * baseW * (1 + PAD * 2))
  const centerXNorm = box.bands && box.bands[mode] ? box.bands[mode].center : (box.x0 + box.x1) / 2
  const centerXModel = centerXNorm * baseW

  // 缩放按**实体高度**算（不是视窗高度）：加了余量之后她的大小和以前一模一样，
  // 只是周围多出一圈空间。
  let scale = wanted / (ch * frac * baseH)
  const maxW = Math.max(240, window.innerWidth * (CFG.maxWidthRatio || 0.5))
  if (viewWModel * scale > maxW) scale = maxW / viewWModel

  const w = Math.max(40, Math.round(viewWModel * scale))
  const h = Math.max(40, Math.round(viewHModel * scale))

  R.model.scale.set(scale)
  // 锚点放到左上角：position 就等于「模型画布左上角在容器里的位置」，算起来最直观
  R.model.anchor.set(0, 0)
  R.app.renderer.resize(w, h)
  const padYModel = ch * frac * baseH * PAD
  R.model.position.set(
    -Math.round((centerXModel - viewWModel / 2) * scale),
    -Math.round((box.y0 * baseH - padYModel) * scale),
  )

  R.ui.stage.style.width = w + 'px'
  R.ui.stage.style.height = h + 'px'
  R.ui.root.style.width = w + 'px'
  R.ui.root.style.height = h + 'px'
  // 气泡/按钮/菜单跟着模型一起缩放，比例才不会走样
  // 例外：正在拖「大小」滑块时**冻住缩放**。否则每拖一格模型就变大一点、
  // 面板跟着变宽一点，滑块轨道从鼠标底下跑掉——主人说的
  // 「滑动的时候很难受，必须点一下设置一个值，不能拖拽」就是这个反馈环。
  if (!R.sizingSize) {
    const uiScale = clamp(h / UI_BASE_HEIGHT, 0.7, 2.2)
    R.ui.root.style.setProperty('--dshp-s', uiScale.toFixed(3))
    // 面板自己一套缩放：夹在 0.85~1.15，缩太小就没法操作了
    R.ui.root.style.setProperty('--dshp-ps', clamp(h / UI_BASE_HEIGHT, 0.85, 1.15).toFixed(3))
  }
  mask.dirty = true
  markStageRectDirty()
  R.lastView = {
    w,
    h,
    mode,
    scale: Number(scale.toFixed(4)),
    content: {
      x0: +box.x0.toFixed(3),
      y0: +box.y0.toFixed(3),
      x1: +box.x1.toFixed(3),
      y1: +box.y1.toFixed(3),
    },
  }
  return R.lastView
}

/** 先量实体范围，再按它取景；量不出来就退回按整张画布取景。 */
export async function fitFromMeasurement() {
  try {
    const bbox = await measureContent()
    if (bbox && bbox.x1 - bbox.x0 > 0.05 && bbox.y1 - bbox.y0 > 0.05) {
      R.contentBox = bbox
    } else {
      console.warn('[鲸鱼娘] 实体范围测不出来，按整张画布取景')
    }
  } catch (err) {
    console.warn('[鲸鱼娘] 测量实体范围出错：', err && err.message)
  }
  return fitModel()
}

/**
 * 量一次「角色实体在画布里的范围」。
 *
 * 做法：先把模型按固定比例完整铺进一张参考画布（不裁剪），等一帧让 postrender 里的
 * 掩码采样跑完，从掩码里取非透明像素的外接框。因为这个测量是在「完整显示」状态下做的，
 * 得到的归一化比例与后续缩放无关，可以直接拿去算任何取景。
 *
 * 拿不到（隐藏标签页里 rAF 不触发、或者掩码生成失败）就返回 null，调用方退回整个画布。
 */
async function measureContent() {
  const im = R.model.internalModel
  const baseW = im.width || im.originalWidth || 1
  const baseH = im.height || im.originalHeight || 1
  const REF = 420
  const s = REF / baseH
  const w = Math.max(16, Math.round(baseW * s))
  const h = REF

  R.model.scale.set(s)
  R.model.anchor.set(0, 0)
  R.app.renderer.resize(w, h)
  R.model.position.set(0, 0)
  R.ui.stage.style.width = w + 'px'
  R.ui.stage.style.height = h + 'px'
  mask.dirty = true
  mask.bbox = null

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()))
  const deadline = performance.now() + 3000
  while (performance.now() < deadline) {
    await nextFrame()
    if (mask.bbox && !mask.dirty) return Object.assign({}, mask.bbox, { bands: mask.bands })
  }
  return mask.bbox ? Object.assign({}, mask.bbox, { bands: mask.bands }) : null
}

/** 贴边的留白（视觉上「贴住」但不顶死） */
const EDGE_GAP = 10

/**
 * 贴顶单独留更大的安全距离——DSH 桌面壳/主窗口顶边常有一排自己的控件
 * （缩小/放大/关闭一类），那层东西的 z-index 不一定在这个插件的 DOM 里，
 * 插件这边调不动谁盖谁。干脆贴顶的时候留够，从根上让画面不伸进那一条，
 * 不用去赌层级谁压得过谁。这个数字没法测出精确值（不知道对方控件条多高），
 * 按常见的自绘标题栏高度估的，明显不够或者太空可以再调。
 */
const EDGE_GAP_TOP = 32

/** 松手时离边多近就吸附 */
const SNAP_DIST = 52

/**
 * `ui.root` 的包围盒比看得见的她大一圈——fitModel 特意留了 PAD（见那边注释：
 * 尾巴、举起来的道具、惊讶表情容易被裁），所以四边都带着一圈透明留白。
 * 贴边/贴角贴的应该是「看得见的她」，不是这圈留白，不然算出来的「贴死」
 * 位置其实还差一截（看着像怎么都拖不进角落），贴顶边的时候又会反过来把
 * 留白也顶到墙外，看着像穿模。
 *
 * 用命中掩码（mask.bbox，跟点击穿透用的是同一份数据）把留白换算成当前
 * 屏幕像素，贴边计算时统一扣掉。掩码还没测出来就退回 0（等价于老行为，
 * 不会比原来更差）。
 *
 * 强制重测一次（忽略节流）：mask.bbox 平时只在 resize/换姿势时才刷新，
 * 待机动作（自拍、伸展…）会临时改变轮廓但不会标脏——松手贴边这一刻如果
 * 用的是几秒前、她做着别的动作时测出来的旧掩码，留白算出来就会偏，
 * 贴边表现看着就跟撞了大运一样时准时不准。这里直接现测一次当前这一帧，
 * 保证用的是「她此刻真实的样子」。
 */
export function visualMargins() {
  buildMask(true)
  const b = mask.bbox
  if (!b) return { left: 0, right: 0, top: 0, bottom: 0 }
  const r = R.ui.root.getBoundingClientRect()
  return {
    left: b.x0 * r.width,
    right: (1 - b.x1) * r.width,
    top: b.y0 * r.height,
    bottom: (1 - b.y1) * r.height,
  }
}

/** 工具条在容器下面探出来的高度（贴底时要把这段算进去，否则按钮会被屏幕切掉） */
function dockClearance() {
  const s = parseFloat((R.ui.root.style.getPropertyValue('--dshp-s') || '1').trim()) || 1
  return 34 * s
}

/** 平滑移动到位（拖动是瞬时的，吸附要有个「吸过去」的过程） */
function glideTo(left, top) {
  const el = R.ui.root
  el.style.transition = 'left .22s cubic-bezier(.2,.9,.3,1), top .22s cubic-bezier(.2,.9,.3,1)'
  el.style.left = left + 'px'
  el.style.top = top + 'px'
  el.style.right = 'auto'
  el.style.bottom = 'auto'
  markStageRectDirty()
  setTimeout(() => {
    el.style.transition = ''
    clampPanels()
    markStageRectDirty() // 滑动过程中缓存会暂时过期，动画落定后再刷新一次保证准
  }, 260)
}

/**
 * 松手时的贴边吸附。
 * 靠近左下/右下角 → 直接记成「角落模式」（窗口大小变了也跟着走）；
 * 只贴某一边 → 固定那一轴，另一轴保持自由。
 */
/**
 * 松手时的贴边吸附。
 *
 * 主人改的规矩（原话）：「只吸附右边、不吸附底，我可以随意调整高低，
 * 但只吸附右边或左边的墙壁」——所以竖直方向本身不设单独的吸附线。
 * 后来又加了一条：**四个真角落**要能整个贴死（横纵一起锁住）——这样
 * 工具条才有理由挪到侧边（见 CSS `[data-corner]`），角落才不会因为
 * 「下面还要留给按钮的空间」而贴不到底。
 *
 *   · 横纵都够近墙角 → 真角落：两个方向一起吸，工具条挪侧边
 *   · 只有左右够近 → 老规矩：吸那一侧墙，竖直位置保持你松手的高度
 *   · 都不够近 → 停在原地，交给惯性滑动
 */
export function snapOnRelease() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const r = R.ui.root.getBoundingClientRect()
  const m = visualMargins()
  // 判「够不够近」和算「贴死的位置」都要用看得见的边，不是包围盒的边
  const nearL = r.left + m.left < SNAP_DIST
  const nearR = vw - (r.right - m.right) < SNAP_DIST
  const nearT = r.top + m.top < SNAP_DIST
  const nearB = vh - (r.bottom - m.bottom) < SNAP_DIST

  if ((nearL || nearR) && (nearT || nearB)) {
    const corner = (nearT ? 't' : 'b') + (nearL ? 'l' : 'r')
    const left = nearL ? EDGE_GAP - m.left : vw - r.width - EDGE_GAP + m.right
    const top = nearT ? EDGE_GAP_TOP - m.top : vh - r.height - EDGE_GAP + m.bottom
    glideTo(left, top)
    // 记成「贴哪个角」，窗口大小变了也还贴着那个角（见 resize 里的 applyPosition）
    saveLayout({ x: null, y: null, edge: null, edgeY: null, corner })
    R.ui.root.dataset.corner = corner
    R.ui.root.dataset.edge = corner[1] === 'l' ? 'left' : 'right'
    return true
  }
  if (!nearL && !nearR) return false // 底部/顶部单独都不吸附

  const edge = nearR ? 'right' : 'left'
  const y = clampY(r.top, r.height, vh)
  const left = edge === 'left' ? EDGE_GAP - m.left : vw - r.width - EDGE_GAP + m.right
  glideTo(left, y)
  // 记成「贴哪一边 + 竖直位置」，窗口大小变了也还贴着那一边、高低不动
  saveLayout({ x: null, y: null, corner: null, edge, edgeY: Math.round(y) })
  R.ui.root.dataset.edge = edge
  delete R.ui.root.dataset.corner
  return true
}

/** 竖直位置的安全范围：上面别顶出屏幕，下面给工具栏留出位置（不是吸附，只是夹一下） */
export function clampY(top, height, vh) {
  const dock = dockClearance()
  const maxTop = Math.max(-20, (vh || window.innerHeight) - height - dock - 4)
  return clamp(top, -20, maxTop)
}

/** 贴住某一侧墙：left/right + top 固定，竖直位置由主人自己定 */
function applyEdge(edge, y) {
  const root = R.ui.root
  const m = visualMargins()
  const yy = clampY(Number(y) || 0, root.getBoundingClientRect().height || 0, window.innerHeight)
  root.style.left = edge === 'left' ? (EDGE_GAP - m.left) + 'px' : 'auto'
  root.style.right = edge === 'right' ? (EDGE_GAP - m.right) + 'px' : 'auto'
  root.style.top = Math.round(yy) + 'px'
  root.style.bottom = 'auto'
  root.dataset.edge = edge
  delete root.dataset.corner
  markStageRectDirty()
}

/**
 * 贴进真正的角落：横纵两个方向都锁死在墙边（不像 applyEdge 只锁一个方向），
 * 所以**不走 clampY**——角落模式下方不用给工具条留白，它已经挪到侧边了
 * （CSS `[data-corner]` 里处理），能贴多死就贴多死。
 */
function applyCorner(corner) {
  const root = R.ui.root
  const m = visualMargins()
  root.style.left = corner === 'tl' || corner === 'bl' ? (EDGE_GAP - m.left) + 'px' : 'auto'
  root.style.right = corner === 'tr' || corner === 'br' ? (EDGE_GAP - m.right) + 'px' : 'auto'
  root.style.top = corner === 'tl' || corner === 'tr' ? (EDGE_GAP_TOP - m.top) + 'px' : 'auto'
  root.style.bottom = corner === 'bl' || corner === 'br' ? (EDGE_GAP - m.bottom) + 'px' : 'auto'
  root.dataset.corner = corner
  root.dataset.edge = corner === 'tl' || corner === 'bl' ? 'left' : 'right'
  markStageRectDirty()
}

/**
 * 摆放位置。四种存档：
 *   · corner       —— 贴死在四角之一，工具条挪侧边（**手动拖到角落吸附后存的就是这种**）
 *   · edge + edgeY —— 贴左/右墙，竖直位置自由（吸附到墙但没到角落存的是这种）
 *   · x + y        —— 完全自由摆放
 *   · 都没有        —— 首次启动，按 CFG.corner 算一次默认位置，就地存成 edge 形式
 */
export function applyPosition(layout) {
  const root = R.ui.root
  if (layout.corner) {
    applyCorner(layout.corner)
    return
  }
  const vh = window.innerHeight
  const h = root.getBoundingClientRect().height || 0
  const dock = dockClearance()

  if (layout.edge === 'left' || layout.edge === 'right') {
    applyEdge(layout.edge, layout.edgeY != null ? layout.edgeY : vh - h - dock - EDGE_GAP)
    return
  }
  if (layout.x != null && layout.y != null) {
    root.style.left = layout.x + 'px'
    root.style.top = clampY(layout.y, h, vh) + 'px'
    root.style.right = 'auto'
    root.style.bottom = 'auto'
    delete root.dataset.edge
    delete root.dataset.corner
    markStageRectDirty()
    return
  }
  // 老存档 / 首次启动：按角落算一次，然后就地存成 edge 形式（下次就是新的了）
  const corner = layout.corner || CFG.corner || 'br'
  const edge = corner === 'bl' || corner === 'tl' ? 'left' : 'right'
  const y = corner === 'tr' || corner === 'tl' ? 64 : vh - h - dock - EDGE_GAP
  applyEdge(edge, y)
  saveLayout({ corner: null, edge, edgeY: Math.round(clampY(y, h, vh)) })
}
