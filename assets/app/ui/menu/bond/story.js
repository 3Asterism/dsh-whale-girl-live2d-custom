/** ui/menu/bond/story.js —— 「等级一览」「故事 · 回忆」分区：每一级解锁什么、已听过的故事可以重看、回忆的解锁条件公开。 */

import { playStory } from '../../../behavior/bond.js'
import { $ } from '../../../core/util.js'
import { STORIES } from '../../../persona/stories.js'
import { closePanels } from '../../panels.js'
import { section } from './widgets.js'

export function renderLevels(snap) {
  return section('levels', '等级一览', `共 ${snap.maxLevel} 级`, (body) => {
    for (const L of snap.levels) {
      const cls = L.state === 'current' ? 'dshp-tr dshp-cur' : L.state === 'locked' ? 'dshp-tr dshp-lock' : 'dshp-tr'
      const mark = L.state === 'done' ? '✓' : L.state === 'current' ? '当前' : '🔒'
      const row = $('div', cls)
      row.append($('b', null, `Lv.${L.lv} ${L.name}`), $('em', null, `${L.unlock}（累计 ${L.xp}）`), $('span', null, mark))
      body.append(row)
    }
    body.append($('div', 'dshp-hint', '等级只解锁「更亲近的台词和互动」，不锁任何菜单功能——不会因为你没养她，就少了什么能用的东西。'))
  })
}

export function renderStories(snap) {
  const got = snap.memories.filter((m) => m.unlockedAt).length
  return section('stories', '故事 · 回忆', `回忆 ${got}/${snap.memories.length}`, (body) => {
    body.append($('div', 'dshp-hint', '羁绊故事（晋级时听到的，听过的可以重看）：'))
    for (const L of snap.levels) {
      const story = STORIES[L.lv]
      if (!story) continue
      const row = $('div', L.lv > snap.level ? 'dshp-tr dshp-lock' : 'dshp-tr')
      row.append($('b', null, `Lv.${L.lv}`), $('em', null, `《${story.title}》`))
      if (L.lv <= snap.level && L.storySeen) {
        const b = $('button', 'dshp-chip', '重看')
        b.addEventListener('click', () => {
          closePanels()
          playStory(L.lv, { replay: true })
        })
        row.append(b)
      } else row.append($('span', 'dshp-tag', L.lv <= snap.level ? '没听过' : '未解锁'))
      body.append(row)
    }

    body.append($('div', 'dshp-hint', '回忆（做到对应的事就会解锁，每条 +羁绊值，只有一次；最新的在最上面）：'))
    const unlocked = snap.memories.filter((m) => m.unlockedAt).sort((a, b) => b.unlockedAt - a.unlockedAt)
    for (const m of unlocked) {
      const d = $('details')
      const s = $('summary', null, m.title)
      s.style.cursor = 'pointer'
      s.style.fontSize = '11px'
      d.append(s, $('div', 'dshp-hint', m.text))
      body.append(d)
    }
    const locked = snap.memories.filter((m) => !m.unlockedAt)
    if (locked.length) {
      // 没解锁的收进一个折叠：条件公开（不是「？？？」黑箱），但不占满整页
      const d = $('details')
      const s = $('summary', null, `还没解锁的回忆（${locked.length} 条，解锁条件都在这里）`)
      s.style.cursor = 'pointer'
      s.style.fontSize = '11px'
      s.style.opacity = '.7'
      d.append(s)
      for (const m of locked) {
        const row = $('div', 'dshp-tr dshp-lock')
        row.append($('b', null, '？？？'), $('em', null, m.hint))
        d.append(row)
      }
      body.append(d)
    }
  })
}
