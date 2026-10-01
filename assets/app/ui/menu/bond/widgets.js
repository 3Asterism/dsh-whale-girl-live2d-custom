/** ui/menu/bond/widgets.js —— 「好感」页共用的小零件：折叠分区 / 进度条 / 键值行 / 时间格式化。 */

import { $ } from '../../../core/util.js'

/** 哪些分区是展开的。换页重画时保持主人上次的展开状态（只活在这次页面里，不落盘）。 */
const OPEN = new Set(['feed'])

/**
 * 一个可折叠的分区。build(body) 往 body 里塞内容；展开状态自己记。
 * sub 是标题右侧的小字（比如「今日 2/5」）。
 */
export function section(id, title, sub, build) {
  const el = $('details', 'dshp-sec')
  if (OPEN.has(id)) el.open = true
  el.addEventListener('toggle', () => (el.open ? OPEN.add(id) : OPEN.delete(id)))
  const head = $('summary')
  head.append($('span', null, title))
  if (sub) head.append($('span', 'dshp-sec-sub', sub))
  const body = $('div')
  build(body)
  el.append(head, body)
  return el
}

/** 进度条。ratio 0–1；tone：'' | 'warm' | 'low'。 */
export function bar(ratio, tone = '') {
  const b = $('div', 'dshp-bar' + (tone ? ' dshp-bar-' + tone : ''))
  const i = document.createElement('i')
  i.style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + '%'
  b.appendChild(i)
  return b
}

/** 左右两栏的一行：「名字 …… 数值」。 */
export function kv(k, v) {
  const row = $('div', 'dshp-kv')
  row.append($('span', null, k), $('span', null, v))
  return row
}

/** 毫秒 → 「N 秒 / N 分钟 / N 小时」。 */
export function fmtMs(ms) {
  const s = Math.ceil(ms / 1000)
  if (s < 90) return s + ' 秒'
  const m = Math.round(s / 60)
  return m < 90 ? m + ' 分钟' : Math.round(m / 6) / 10 + ' 小时'
}

export const signed = (n) => (n > 0 ? '+' + n : String(n))
