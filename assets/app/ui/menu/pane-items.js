/** ui/menu/pane-items.js —— 菜单「装饰」「场景」页：常驻开关，再点一下收起，同类互斥。 */

import { playItem } from '../../behavior/menu-actions.js'
import { EXPR } from '../../core/state.js'
import { $, pickFresh } from '../../core/util.js'
import { PRI, perform } from '../../director/perform.js'
import { clearProps, itemOn, setProp } from '../../engine/rig.js'
import { IDLE_PROPS, PROPS, SCENES } from '../../persona/items.js'
import { PROP_ACT, SCENE_ACT } from '../../persona/reactions.js'
import { SAY } from '../../persona/say.js'

/** @param id 'decor' | 'scene' */
export function renderItemsPane(panes, id, rerender) {
  const src = id === 'decor' ? PROPS : SCENES
  const grid = $('div', 'dshp-grid')
  for (const [key, def] of Object.entries(src)) {
    if (!EXPR[def.expr]) continue
    // 「开着」看的是**主人自己开的那一层**。用 rig.props 判断的话，
    // 本子/笔这种常态道具永远显示成已开启，再点也没反应——就是主人说的「点了没用」。
    const on = itemOn(key, def)
    const b = $('button', 'dshp-chip', def.label)
    if (on) b.classList.add('dshp-on')
    const lines = (SCENE_ACT[key] && SCENE_ACT[key].lines) || (PROP_ACT[key] && PROP_ACT[key].lines) || []
    const tip = on ? '再点一下收起来' : lines.length ? `点了她会说：${lines[0]}` : ''
    b.title = def.key ? `${tip}\n（原作者热键：${def.key}）` : tip
    b.addEventListener('click', () => {
      const nowOn = itemOn(key, def)
      setProp(key, !nowOn)
      if (!nowOn) playItem(id, key)
      rerender()
    })
    grid.appendChild(b)
  }
  const row = $('div', 'dshp-row')
  const clear = $('button', 'dshp-btn', '全部摘掉')
  clear.addEventListener('click', () => {
    clearProps()
    perform({ id: 'menu-tidy', pri: PRI.EXPLICIT, tier: 'core', habit: false, mood: 'neutral', props: IDLE_PROPS, line: pickFresh(SAY.tidy, 'tidy'), ms: 2000 })
    rerender()
  })
  row.appendChild(clear)
  panes.append(
    grid,
    row,
    $(
      'div',
      'dshp-hint',
      id === 'decor'
        ? '装饰品戴上就一直留着，直到你再点一下摘掉（同类自动互斥：眼镜只戴一副、贴纸只贴一张）。'
        : '场景摆设也是「摆着不走」——桌布、鲸鱼、巴菲这些会一直留着，再点一下才收。',
    ),
  )
}
