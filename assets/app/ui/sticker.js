/**
 * ui/sticker.js —— 表情包的运行时：加载清单、预取、选图、造 <img>。规则本体在 sticker-pick.js（纯函数）。
 *
 * 清单 assets/stickers/manifest.json 由 tools/build-stickers.py 生成，**一圈时长在构建期测定**，这里不解析 GIF。
 * 素材：赤风RED（https://space.bilibili.com/356746604）《蓝色大肥鱼》。
 */

import { BASE, CFG } from '../config.js'
import { log } from '../core/util.js'
import { bond } from '../core/state.js'
import { ACTION_STICKER, EVENT_STICKER, FALLBACK_STICKER, MIN_LEVEL, MOOD_STICKER } from '../persona/stickers.js'
import { pickSticker } from './sticker-pick.js'

const DATA = { EVENT_STICKER, ACTION_STICKER, MOOD_STICKER, FALLBACK_STICKER }

export const STK = {
  manifest: null, // id → { file, ms, w, h, opaque? }
  recent: new Map(), // id → 上次出现的时间戳
  lastAt: 0, // 全局上次出图的时间
  version: '',
  onShown: null, // 她用出一张图时的回调（main.js 接到图鉴上报）
}

const reduceMotion = () => {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  } catch (e) {
    return false
  }
}

/** 总开关：用户没关、清单加载好了、系统没要求减少动效。 */
export const stickerOk = () => CFG.stickers !== false && !!STK.manifest && !reduceMotion()

export const stickerMs = (id) => (STK.manifest && STK.manifest[id] ? STK.manifest[id].ms : 0)

/** 一张图的地址（好感页图鉴也用）。 */
export const stickerUrl = (id) => (STK.manifest && STK.manifest[id] ? urlOf(id) : '')

const urlOf = (id) => `${BASE}/stickers/${STK.manifest[id].file}${STK.version ? '?v=' + STK.version : ''}`

/** 启动时拉清单；失败就静默（没有表情包她照样能说话）。拉完过一会儿在空闲时把图预取进浏览器缓存。 */
export async function loadStickers() {
  try {
    const boot = window.__DSH_PET_BOOT__ || {}
    STK.version = boot.version || ''
    const r = await fetch(`${BASE}/stickers/manifest.json`, { cache: 'no-cache' })
    if (!r.ok) return
    const j = await r.json()
    if (!j || typeof j.stickers !== 'object') return
    STK.manifest = j.stickers
    window.__DSH_PET_STICKERS__ = j.stickers // 好感页 / 图鉴要用（名字、梗），不必各处再 fetch
    log(`表情包就绪：${Object.keys(STK.manifest).length} 张`)
    setTimeout(prefetchAll, 15000)
  } catch (e) {
    /* 没清单就没表情包 */
  }
}

/** 一张一张预取（fetch 进 HTTP 缓存，不解码，不占内存）；低性能档不预取。 */
async function prefetchAll() {
  if (!STK.manifest || CFG.stickers === false) return
  for (const id of Object.keys(STK.manifest)) {
    if (document.hidden) return
    try {
      await fetch(urlOf(id), { cache: 'force-cache' })
    } catch (e) {
      return
    }
    await new Promise((r) => setTimeout(r, 120))
  }
}

/**
 * 给一次表演选图。spec = perform 的参数子集：{ sticker, say, id, mood, line, ttl, force }。
 * ttl 给了就按时长过滤（台词气泡）；不给就不过滤（独立表情包 / 常驻气泡）。
 * 选中后记账（90 秒内偏好换一张 + 常驻气泡的节流），返回 id 或 null。
 */
export function chooseSticker(spec) {
  if (!stickerOk()) return null
  const now = performance.now()
  const id = pickSticker(spec, DATA, { manifest: STK.manifest, recent: STK.recent, lastAt: STK.lastAt, now, level: bond.level || 1, minLevel: MIN_LEVEL })
  if (id) noteShown(id, now)
  return id
}

export function noteShown(id, now = performance.now()) {
  STK.recent.set(id, now)
  STK.lastAt = now
  if (STK.onShown) {
    try {
      STK.onShown(id)
    } catch (e) {}
  }
}

/** 造一个 <img>。每次都新建：新元素从第 0 帧开始播，「话出现 = 动画从头播」。 */
export function makeStickerImg(id) {
  if (!stickerOk() || !STK.manifest[id]) return null
  const img = new Image()
  img.className = 'dshp-sticker' + (STK.manifest[id].opaque ? ' dshp-opaque' : '')
  img.alt = ''
  img.decoding = 'async'
  img.draggable = false
  img.src = urlOf(id)
  return img
}
