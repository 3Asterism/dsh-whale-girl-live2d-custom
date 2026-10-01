/** behavior/feed.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { BASE } from '../config.js'
import { R } from '../core/state.js'
import { PRI, noteUser, perform } from '../director/perform.js'
import { hitTest } from '../engine/mask.js'
import { postJson } from '../net/api.js'
import { lineFor } from '../persona/lines.js'
import { bondMemory, feedGift } from './bond.js'

// —— 拖文件喂她：悬停张嘴 → 松手吃掉 → 问「要读一下吗」→ 点了才发给 agent ——
// 只在命中她的像素时接管拖放（DSH 自己的拖拽上传区不受影响）；网页的 File 没有真实路径，
// 所以先 POST 到宿主落盘（/dsh-pet/feed，20MB 封顶），拿到绝对路径再问主人。
const FEED_MAX_BYTES = 20 * 1024 * 1024

const FEED = { over: false }

export function wireFeed() {
  const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'))
  document.addEventListener(
    'dragover',
    (e) => {
      if (!hasFiles(e)) return
      if (!hitTest(e.clientX, e.clientY)) {
        FEED.over = false
        return
      }
      e.preventDefault() // 允许在她身上放下
      e.stopPropagation()
      if (!FEED.over) {
        FEED.over = true
        perform({ id: 'feed-hover', pri: PRI.TOUCH, tier: 'extra', habit: false, mood: 'excited', say: 'feedHover', ms: 2400, cool: 1500 })
      }
    },
    true,
  )
  document.addEventListener(
    'drop',
    async (e) => {
      const wasOver = FEED.over
      FEED.over = false
      if (!hasFiles(e) || !(wasOver || hitTest(e.clientX, e.clientY))) return
      if (!hitTest(e.clientX, e.clientY)) return
      e.preventDefault()
      e.stopPropagation()
      const file = e.dataTransfer.files && e.dataTransfer.files[0]
      if (!file) return
      noteUser()
      if (file.size > FEED_MAX_BYTES) {
        perform({ id: 'feed-fail', pri: PRI.CUE, tier: 'core', habit: false, mood: 'sweat', say: 'feedFail', ms: 2600 })
        return
      }
      perform({ id: 'feed-eat', pri: PRI.CUE, tier: 'core', habit: false, mood: 'happy', say: 'feedEat', ms: 1800 })
      try {
        const r = await fetch(BASE + '/feed', { method: 'POST', headers: { 'X-File-Name': encodeURIComponent(file.name) }, body: file })
        const j = await r.json()
        if (!j || !j.ok) throw new Error((j && j.error) || '落盘失败')
        feedGift('file', { silent: true }) // 文件是零食：算一次投喂（不花 token），演出这里自己负责
        bondMemory('file-eat')
        setTimeout(() => askRead(j.path, j.name), 1500)
      } catch (err) {
        perform({ id: 'feed-fail', pri: PRI.CUE, tier: 'core', habit: false, mood: 'sweat', say: 'feedFail', ms: 2600 })
      }
    },
    true,
  )
  // 拖着文件离开页面 / 在别处放开：别让「张着嘴」的状态赖着
  document.addEventListener('dragend', () => (FEED.over = false), true)
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) FEED.over = false
  }, true)
}

/** 吃掉之后问一句：点「读一下」才走 /say 发给 agent（不自作主张）。 */
function askRead(filePath, name) {
  R.ui.bubble.ask(lineFor('feedAsk') + '\n' + name, [
    {
      label: '读一下',
      onClick: async () => {
        perform({ id: 'feed-yes', pri: PRI.CUE, tier: 'core', habit: false, mood: 'excited', say: 'feedYes', ms: 2000 })
        const j = await postJson('/say', { text: `主人喂了我一个文件，路径是：${filePath}\n请读一下，简要说说里面有什么。` })
        if (!j || !j.ok) R.ui.bubble.show('发不出去：' + ((j && j.error) || '宿主没响应'), { name: '鲸鱼娘', ttl: 3000 })
      },
    },
    { label: '算了', onClick: () => perform({ id: 'feed-no', pri: PRI.CUE, tier: 'core', habit: false, mood: 'pout', say: 'feedNo', ms: 2000 }) },
  ], { ttl: 15000 })
}
