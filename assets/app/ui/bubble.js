/** ui/bubble.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { CFG } from '../config.js'
import { chooseSticker, makeStickerImg, noteShown, stickerMs, stickerOk } from './sticker.js'
import { snapExtra, soloTtl, stickyMs } from './sticker-pick.js'

/**
 * @param msg 台词那一行的横排容器（[文字 | 表情包]）；表情包挂在文字后面
 * @param onResize 气泡高度变了（挂/摘表情包）后要重新定位（贴顶翻转逻辑在 layout.js，这里不直接依赖）
 */
export function makeBubble(el, body, foot, dot, headText, msg, onResize) {
  let timer = null
  let streaming = false
  let buffer = ''
  let askRow = null // 「带按钮的提问」那一行，任何新内容 / 收起都要把它清掉
  const clearAsk = () => {
    if (askRow) askRow.remove()
    askRow = null
  }

  // —— 表情包（赤风RED《蓝色大肥鱼》）——
  // 铁律：表情包**不决定气泡停留多久**。台词气泡的 ttl 由台词定；表情包只在到点时「最多多等 400ms 让当前圈播完」。
  let skEl = null
  let skTimers = []
  const relayout = () => {
    if (onResize) requestAnimationFrame(() => onResize())
  }
  const clearSk = () => {
    for (const t of skTimers) clearTimeout(t)
    skTimers = []
    if (skEl) skEl.remove()
    skEl = null
    el.classList.remove('dshp-has-sticker', 'dshp-solo')
  }
  const mountSk = (id) => {
    const img = makeStickerImg(id)
    if (!img) return null
    clearSk()
    msg.appendChild(img)
    skEl = img
    el.classList.add('dshp-has-sticker')
    relayout()
    return img
  }
  /** 常驻气泡 / 附着型的图：播 delay 毫秒后淡出并摘掉，之后只剩文字。 */
  const fadeSkAfter = (delay) => {
    const img = skEl
    skTimers.push(
      setTimeout(() => {
        if (skEl !== img || !img) return
        img.classList.add('dshp-out')
        skTimers.push(
          setTimeout(() => {
            if (skEl !== img) return
            img.remove()
            skEl = null
            el.classList.remove('dshp-has-sticker')
            relayout()
          }, 320),
        )
      }, delay),
    )
  }

  const api = {
    el,
    /** 带按钮的提问气泡：buttons = [{label, onClick}]；点任一个或到点（ttl）都会收起。 */
    ask(text, buttons, opts) {
      opts = opts || {}
      api.show(text, { name: opts.name, sticky: true })
      const row = document.createElement('div')
      row.className = 'dshp-ask'
      const done = () => {
        if (askRow === row) api.hide()
      }
      for (const b of buttons) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.textContent = b.label
        btn.addEventListener('pointerdown', (e) => e.stopPropagation())
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          done()
          try {
            if (b.onClick) b.onClick()
          } catch (err) {}
        })
        row.appendChild(btn)
      }
      el.appendChild(row)
      askRow = row
      if (timer) clearTimeout(timer)
      timer = setTimeout(done, opts.ttl || 12000)
    },
    /**
     * 显示一句话。opts.sticker / opts.stickerHint：挂一张表情包在台词后面（右侧）。
     * 带按钮的提问 / 流式回复 / 长文本（>100 字）不挂图——排版会挤，也没有「一句话 ↔ 一个表情」的对应。
     */
    show(text, opts) {
      opts = opts || {}
      if (!opts.keepAsk) clearAsk()
      // 每次显示都重来：新的 <img> 才会从第 0 帧播。唯一例外 keepSticker：工作轮播每隔几秒换一句忙碌台词，
      // 不该把正在播的「正在思考」一起清掉（图自己有 ≤10s 的寿命，到点会淡出）。
      if (opts.keepSticker && skEl) el.classList.remove('dshp-solo')
      else clearSk()
      if (opts.name) headText.textContent = opts.name
      if (opts.stream) {
        if (!streaming) {
          buffer = ''
          streaming = true
        }
        buffer += text
        body.textContent = buffer.length > 4000 ? '…' + buffer.slice(-4000) : buffer
      } else {
        streaming = false
        buffer = String(text == null ? '' : text)
        body.textContent = buffer
      }
      body.scrollTop = body.scrollHeight
      foot.textContent = opts.foot || ''
      dot.classList.toggle('dshp-pulse', !!opts.busy)
      el.classList.add('dshp-on')
      if (timer) clearTimeout(timer)
      let ttl = opts.sticky ? 0 : opts.ttl != null ? opts.ttl : CFG.bubbleTtlMs
      // 选图：opts.stickerHint = { sticker?, say?, id?, mood?, force? }（perform 传来，由这里按 ttl 过滤选图）；
      // opts.sticker = 直接指定一张。台词气泡按 ttl 过滤；常驻气泡（ttl=0）不过滤，只播 2 圈。
      const hint = opts.stickerHint || (opts.sticker ? { sticker: opts.sticker } : null)
      if (hint && !opts.keepSticker && !opts.stream && !askRow && buffer.length <= 100) {
        const sk = chooseSticker(Object.assign({}, hint, { line: buffer, ttl: ttl > 0 ? ttl : null }))
        if (sk && mountSk(sk)) {
          const L = stickerMs(sk)
          if (ttl > 0) ttl += snapExtra(ttl, L) // 当前圈只差一点点就播完：多等这一小会儿
          else fadeSkAfter(stickyMs(L)) // 常驻气泡：只播 2 圈（≤4s），别长期挂着扎眼
        }
      }
      if (ttl > 0) timer = setTimeout(() => api.hide(), ttl)
    },
    /**
     * 只丢表情包（不跟台词）。气泡里已经有字时，图附着在原气泡上、播 stickyMs 后淡出；
     * 气泡没开时，开一个只有图的小气泡（.dshp-solo），停留时间由图自己决定。
     * 正挂着带按钮的提问时一律不动。返回是否真的出图了。
     * opts: { maxMs, ttl }；maxMs = 这张图最长挂多久（「正在思考」用，10 秒封顶）。
     */
    sticker(id, opts) {
      opts = opts || {}
      const L = stickerMs(id)
      if (!stickerOk() || !(L > 0) || askRow) return false
      const hasText = api.visible && !el.classList.contains('dshp-solo') && !!body.textContent
      if (!mountSk(id)) return false
      noteShown(id)
      if (hasText) {
        fadeSkAfter(Math.min(opts.maxMs || Infinity, stickyMs(L)))
        return true
      }
      body.textContent = ''
      foot.textContent = ''
      buffer = ''
      streaming = false
      dot.classList.remove('dshp-pulse')
      el.classList.add('dshp-solo', 'dshp-on')
      if (timer) clearTimeout(timer)
      const ttl = opts.ttl != null ? opts.ttl : opts.maxMs ? opts.maxMs : soloTtl(L)
      timer = setTimeout(() => api.hide(), ttl + snapExtra(ttl, L))
      return true
    },
    /** 只在「现在挂着的是纯表情包小气泡」时才收起（比如深度思考结束了）；有字的气泡不动。 */
    dropSolo() {
      if (el.classList.contains('dshp-solo')) api.hide()
    },
    note(text) {
      foot.textContent = text
    },
    hide() {
      clearAsk()
      if (timer) clearTimeout(timer)
      timer = null
      streaming = false
      buffer = ''
      el.classList.remove('dshp-on')
      // 气泡有 0.18s 淡出；等它淡完再摘图（立刻摘会「啪」地少一块），摘掉也停掉 GIF 解码
      const left = skEl
      if (left) skTimers.push(setTimeout(() => skEl === left && clearSk(), 260))
    },
    get visible() {
      return el.classList.contains('dshp-on')
    },
    /** 现在气泡里是不是挂着「带按钮的提问」（别的台词不该把它顶掉）。 */
    get asking() {
      return !!askRow
    },
    /** 脚注现在写着什么（别的模块要往脚注里写小字时，先看有没有人占着）。 */
    get footText() {
      return foot.textContent
    },
    /** 现在是不是只有一张表情包（诊断 / 测试用）。 */
    get solo() {
      return el.classList.contains('dshp-solo')
    },
    /** 现在挂着哪张表情包的文件名（诊断 / 测试用）。 */
    get stickerSrc() {
      return skEl ? skEl.getAttribute('src') : null
    },
  }
  return api
}
