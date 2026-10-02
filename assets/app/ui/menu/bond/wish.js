/**
 * ui/menu/bond/wish.js —— 「今日心愿」卡片：好感页里**不折叠**的那一块（每天回来最想看的就是它）。
 * 设计：做到有小奖励，做不到什么都不发生——不是打卡，没有「昨天没完成」，明天自动换一个新的。
 * 心愿本身、奖励数值都读宿主快照（snap.wish），前端不写死。
 */

import { $ } from '../../../core/util.js'

export function renderWish(snap) {
  const w = snap.wish
  if (!snap.enabled || !w) return document.createDocumentFragment()
  const card = $('div', 'dshp-wish' + (w.done ? ' dshp-done' : ''))
  const head = $('div', 'dshp-wish-head')
  head.append($('span', 'dshp-wish-mark', w.done ? '✓' : ''), $('span', null, w.text), $('span', 'dshp-sec-sub', w.done ? '已达成' : '今日心愿'))
  card.append(head)
  const r = w.reward || {}
  card.append(
    $(
      'div',
      'dshp-hint',
      w.done
        ? '今天的小心愿达成啦，明天她会换一个新的。'
        : `${w.hint}\n达成奖励：羁绊 +${r.xp} · 心情 +${r.mood} · token +${r.tickets}\n没做到也没关系——什么都不会少，明天换一个新的。`,
    ),
  )
  return card
}
