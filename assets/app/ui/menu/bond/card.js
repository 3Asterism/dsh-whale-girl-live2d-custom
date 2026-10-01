/** ui/menu/bond/card.js —— 「好感」页顶部：关系卡（等级 / 进度 / 倾向 / 连续陪伴 / 待讲的故事）和「状态」分区（心情 / 饱腹 / token）。 */

import { playStory } from '../../../behavior/bond.js'
import { $ } from '../../../core/util.js'
import { STORIES } from '../../../persona/stories.js'
import { closePanels } from '../../panels.js'
import { bar, kv, section } from './widgets.js'

export function renderCard(snap) {
  const card = $('div', 'dshp-sec')
  card.style.padding = '7px 9px'

  if (!snap.enabled) {
    card.append($('div', 'dshp-hint', '羁绊系统已关闭：没有好感、没有投喂、没有故事，她就是一只普通的鲸鱼娘。\n想开回来，去下面「互动开关」。'))
    return card
  }

  const next = snap.nextXp
  card.append(kv(`Lv.${snap.level} ${snap.levelName}`, snap.trait ? snap.trait.name : '倾向未定'))
  card.append(bar(next == null ? 1 : (snap.xp - snap.levelXp) / Math.max(1, next - snap.levelXp)))
  card.append(kv('羁绊值', next == null ? `${snap.xp}（已满级）` : `${snap.xp} / ${next}（还差 ${next - snap.xp}）`))
  if (snap.trait) card.append($('div', 'dshp-hint', `称号「${snap.trait.name}」：${snap.trait.hint}`))

  const st = snap.streak
  const nextReward = Object.keys(st.rewards)
    .map(Number)
    .sort((a, b) => a - b)
    .find((d) => d > st.days)
  card.append(kv('连续陪伴', `${st.days} 天（最长 ${st.best} 天）`))
  if (nextReward) card.append($('div', 'dshp-hint', `再连续 ${nextReward - st.days} 天，额外 +${st.rewards[nextReward]} 羁绊值（周末休息不断档）`))
  if (snap.multiplier && snap.multiplier.x > 1) card.append(kv('今日倍率', `×${snap.multiplier.x}（${snap.multiplier.why}）`))

  if (snap.pending) {
    const story = STORIES[snap.pendingLevel]
    const row = $('div', 'dshp-row')
    const b = $('button', 'dshp-btn dshp-primary', `听她说：《${story ? story.title : '……'}》`)
    b.title = '一句一句讲，随时可以跳过。听完才晋级。'
    b.addEventListener('click', () => {
      closePanels()
      playStory(snap.pendingLevel)
    })
    row.appendChild(b)
    card.append(row, $('div', 'dshp-hint', '羁绊值够了，她有话想对你说——不急，什么时候方便什么时候听。'))
  }
  return card
}

export function renderState(snap) {
  if (!snap.enabled) return document.createDocumentFragment()
  const tone = (v, low) => (v <= low ? 'low' : v >= 85 ? 'warm' : '')
  return section('state', '她的状态', `token 存量 ${snap.tickets}/${snap.ticketCap}`, (body) => {
    body.append(kv('心情', snap.mood.label), bar(snap.mood.v / 100, tone(snap.mood.v, 40)))
    body.append(kv('饱腹', snap.full.label), bar(snap.full.v / 100, tone(snap.full.v, snap.full.hungry)))
    body.append(kv('token 存量', `${snap.tickets} / ${snap.ticketCap}`))
    body.append($('div', 'dshp-hint', '心情和饱腹是「短期状态」，会随时间自己变；只影响她的台词和神态，不影响羁绊值。token 是她的口粮（白饭 = token）：干活收工时自动攒，投喂时花掉。'))
  })
}
