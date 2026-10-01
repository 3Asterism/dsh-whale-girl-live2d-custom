/** core/util.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

export const log = (...a) => console.log('%c[鲸鱼娘]', 'color:#7c5cff', ...a)

export const pick = (arr) => arr[(Math.random() * arr.length) | 0]

/**
 * 不重复上一次的选择。主人抱怨「点他老是同一个表情/同一句话」——
 * 这里记住上一次挑中的是哪个，下一轮把它排除掉，保证连着点不会撞车。
 */
const lastPick = new Map()

/**
 * 权重：条目可以写 `w`（默认 1）。
 * 用来让「真生气」这种反应变稀有——主人抱怨「平常点几下就生气」，
 * 生气不该和摸摸头一样常见。
 */
const weightOf = (x) => (x && typeof x === 'object' && typeof x.w === 'number' ? x.w : 1)

export function pickFresh(arr, key) {
  if (!arr || !arr.length) return undefined
  const k = key || 'default'
  const prev = lastPick.get(k)
  const pool = arr.length > 1 && prev !== undefined ? arr.filter((x) => x !== prev) : arr
  let total = 0
  for (const x of pool) total += weightOf(x)
  let r = Math.random() * total
  let chosen = pool[pool.length - 1]
  for (const x of pool) {
    r -= weightOf(x)
    if (r <= 0) {
      chosen = x
      break
    }
  }
  lastPick.set(k, chosen)
  return chosen
}

// ——————————————————————————————————————————————————————————————
// 三、小工具
// ——————————————————————————————————————————————————————————————

export const $ = (tag, cls, text) => {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (text != null) el.textContent = text
  return el
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.async = false
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('无法加载 ' + src))
    document.head.appendChild(s)
  })
}
