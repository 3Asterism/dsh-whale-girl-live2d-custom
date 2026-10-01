/** ui/menu/pane-action.js —— 菜单「动作」页：一次性动作，演一遍就消失，绝不常驻。 */

import { playAction } from '../../behavior/menu-actions.js'
import { EXPR, R } from '../../core/state.js'
import { $ } from '../../core/util.js'
import { ACTIONS, ACTION_KEYS } from '../../persona/items.js'

export function renderActionPane(panes, rerender) {
  const grid = $('div', 'dshp-grid')
  for (const key of ACTION_KEYS) {
    const a = ACTIONS[key]
    if (a.expr && !EXPR[a.expr]) continue
    if (a.motion && !(R.manifest && R.manifest.motions && R.manifest.motions[a.motion])) continue
    const b = $('button', 'dshp-chip', a.label)
    b.title = `点了她会说：${a.lines[0]}` + (a.key ? `\n（原作者热键：${a.key}）` : '')
    b.addEventListener('click', () => {
      playAction(key)
      rerender()
    })
    grid.appendChild(b)
  }
  panes.append(
    grid,
    $('div', 'dshp-hint', '动作是**一次性的**：演一遍就自己消失，不会一直挂着。\n（要一直留着的，去「装饰」和「场景」两页——蛋包饭也在这页，挤完酱就没了。）'),
  )
}
