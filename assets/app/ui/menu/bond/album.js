/**
 * ui/menu/bond/album.js —— 「表情包图鉴」分区（猫咪后院式收集 + 蔚蓝档案「纪念大厅」）。
 * 她用出过哪张表情包，哪张就收进图鉴；每张图附一句它的梗。进度与里程碑都读宿主快照（snap.album），
 * 图本身与梗来自表情包清单（STK.manifest）。小 GIF 要等分区展开了才加载，免得一打开好感页就拉几十张动图。
 */

import { $ } from '../../../core/util.js'
import { STK, stickerUrl } from '../../sticker.js'
import { bar, section } from './widgets.js'

export function renderAlbum(snap) {
  const a = snap.album
  if (!snap.enabled || !a || !a.total) return document.createDocumentFragment()
  return section('album', '表情包图鉴', `${a.got}/${a.total}`, (body, el) => {
    body.append(bar(a.got / a.total, a.got >= a.total ? 'warm' : ''))
    const ms = $('div', 'dshp-row')
    for (const m of a.milestones) ms.append($('span', 'dshp-tag' + (m.done ? ' dshp-love' : ''), `${m.done ? '✓ ' : ''}${m.title} ${m.need} 张`))
    body.append(ms)

    const cap = $('div', 'dshp-album-cap', `点一张已收录的图，看它的梗。还有 ${a.total - a.got} 张没见过——她用到哪张，哪张就会亮起来。`)
    const grid = $('div', 'dshp-album')
    let built = false
    const build = () => {
      if (built) return
      built = true
      const man = STK.manifest
      if (!man) {
        grid.append($('div', 'dshp-hint', '表情包清单还没加载好，稍后再来看。'))
        return
      }
      const got = new Set(a.ids)
      const ids = Object.keys(man)
      // 已收录的排前面（按清单顺序）；没见过的只露几个「？」做预告，剩下的收成一块「+N」——
      // 九十多个「？」会把整页撑成一面墙，没必要
      const lockedIds = ids.filter((i) => !got.has(i))
      const TEASE = 8
      for (const id of ids.filter((i) => got.has(i)).concat(lockedIds.slice(0, TEASE))) {
        const m = man[id]
        if (got.has(id)) {
          const b = $('button', 'dshp-album-tile')
          b.title = m.name
          const img = new Image()
          img.src = stickerUrl(id)
          img.alt = m.name || id
          img.loading = 'lazy'
          img.decoding = 'async'
          b.append(img)
          b.addEventListener('click', () => {
            cap.textContent = `${String(m.name || id).replace(/\s*\d+$/, '')}：${m.meme || ''}`
          })
          grid.append(b)
        } else {
          const t = $('span', 'dshp-album-tile dshp-locked', '？')
          t.title = '还没见过这一张'
          grid.append(t)
        }
      }
      if (lockedIds.length > TEASE) {
        const more = $('span', 'dshp-album-tile dshp-locked', `+${lockedIds.length - TEASE}`)
        more.title = `还有 ${lockedIds.length - TEASE} 张没见过`
        grid.append(more)
      }
    }
    el.addEventListener('toggle', () => el.open && build())
    if (el.open) build()
    body.append(grid, cap)
    body.append(
      $(
        'div',
        'dshp-hint',
        `她每用出一张新图就收录一张（每天前 ${a.today.cap} 张各 +1 羁绊，今天已 ${a.today.used} 张），里程碑一次性奖励：` +
          a.milestones.map((m) => `${m.title} +${m.xp}`).join(' · ') +
          '。没有期限、不会错过，集不齐也没关系。',
      ),
    )
  })
}
