/** ui/menu/render-pane.js —— 菜单各页的分发器：每一页一个文件，这里只负责清空容器、挂状态行、选页。 */

import { menuStatusLine } from '../../behavior/menu-actions.js'
import { R } from '../../core/state.js'
import { $ } from '../../core/util.js'
import { renderActionPane } from './pane-action.js'
import { renderBondPane } from './bond/index.js'
import { renderFacePane } from './pane-face.js'
import { renderItemsPane } from './pane-items.js'
import { renderSettingsPane } from './pane-settings.js'

export function renderPane(id) {
  const panes = R.ui.menu.panes
  // 同一页重画（点完按钮、数据刷新）时保持滚动位置，不然长页面每点一下就跳回顶部
  const keep = panes.dataset.pane === id ? panes.scrollTop : 0
  panes.dataset.pane = id
  panes.textContent = ''
  // 顶上永远有一行「她现在是什么状态」，免得一堆按钮里看不出哪个是开着的
  panes.appendChild($('div', 'dshp-hint dshp-now', menuStatusLine()))
  const again = () => renderPane(id)
  if (id === 'face') renderFacePane(panes, again)
  else if (id === 'decor' || id === 'scene') renderItemsPane(panes, id, again)
  else if (id === 'action') renderActionPane(panes, again)
  else if (id === 'bond') renderBondPane(panes, again)
  else renderSettingsPane(panes, again)
  panes.scrollTop = keep
}
