/** ui/menu/bond/feed.js —— 「投喂」分区：礼物清单（喜好、效果、价格全部公开）与今日进度（每个来源用了几次 / 上限 / 冷却）。 */

import { feedGift } from '../../../behavior/bond.js'
import { $ } from '../../../core/util.js'
import { closePanels } from '../../panels.js'
import { fmtMs, kv, section, signed } from './widgets.js'

const TASTE_CLASS = { loved: 'dshp-love', liked: '', neutral: '', disliked: 'dshp-hate', hated: 'dshp-hate' }

export function renderFeed(snap) {
  const feeds = snap.today.feeds
  return section('feed', '投喂', `今日 ${feeds.used}/${feeds.cap}`, (body) => {
    for (const g of snap.gifts) {
      const row = $('div', 'dshp-gift')
      const info = $('div', 'dshp-gift-info')
      const name = $('b', null, g.name + ' ')
      const tag = $('span', 'dshp-tag ' + (TASTE_CLASS[g.taste] || ''), g.tasteLabel)
      const eff = $('div', null, `${g.blurb}\n羁绊 ${signed(g.xp)} · 饱腹 ${signed(g.full)} · 心情 ${signed(g.mood)} · 要 ${g.cost} token${g.todayCount ? ` · 今天已吃 ${g.todayCount}（再吃减半）` : ''}`)
      eff.style.whiteSpace = 'pre-wrap'
      info.append(name, tag, eff)
      const btn = $('button', 'dshp-btn', '给她')
      const why = feeds.used >= feeds.cap ? '今天喂得够多啦（每天最多 ' + feeds.cap + ' 次）' : snap.tickets < g.cost ? 'token 不够' : ''
      if (why) {
        btn.disabled = true
        btn.title = why
      }
      btn.addEventListener('click', () => {
        closePanels() // 她的反应在气泡里，面板开着会互相挡
        feedGift(g.id)
      })
      row.append(info, btn)
      body.append(row)
    }
    body.append($('div', 'dshp-hint', '喜好是公开的，没有暗坑：讨厌的、禁区的会掉羁绊值（但不会低于本级起点）。\n拖文件到她身上也算零食，不花 token。'))
  })
}

export function renderToday(snap) {
  return section('today', '今日进度', '羁绊值从哪来', (body) => {
    for (const s of snap.today.sources) {
      const done = s.used >= s.cap
      const tail = done ? '今日已满' : s.readyInMs > 0 ? `冷却 ${fmtMs(s.readyInMs)}` : '可以'
      body.append(kv(`${s.label} +${s.gain}`, `${s.used}/${s.cap} · ${tail}`))
      body.append($('div', 'dshp-hint', s.how + (s.cd ? `（冷却 ${fmtMs(s.cd)}）` : '')))
    }
    body.append($('div', 'dshp-hint', '「干活收工」「大功告成」「陪伴」由系统结算，不是点出来的——连点刷不动，也没必要刷。'))
  })
}
