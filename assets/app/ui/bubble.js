/** ui/bubble.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { CFG } from '../config.js'

export function makeBubble(el, body, foot, dot, headText) {
  let timer = null
  let streaming = false
  let buffer = ''
  let askRow = null // 「带按钮的提问」那一行，任何新内容 / 收起都要把它清掉
  const clearAsk = () => {
    if (askRow) askRow.remove()
    askRow = null
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
    show(text, opts) {
      opts = opts || {}
      if (!opts.keepAsk) clearAsk()
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
      const ttl = opts.sticky ? 0 : opts.ttl != null ? opts.ttl : CFG.bubbleTtlMs
      if (ttl > 0) timer = setTimeout(() => api.hide(), ttl)
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
    },
    get visible() {
      return el.classList.contains('dshp-on')
    },
    /** 现在气泡里是不是挂着「带按钮的提问」（别的台词不该把它顶掉）。 */
    get asking() {
      return !!askRow
    },
  }
  return api
}
