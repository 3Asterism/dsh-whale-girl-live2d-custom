/**
 * ui/menu/bond/index.js —— 菜单「好感」页：把羁绊系统的数值、规则、开关全部摊开，不留隐性设定。
 * 各分区各一个文件：card（关系卡 + 状态）/ feed（投喂 + 今日进度）/ story（等级 + 故事回忆）/ switches / rules。
 * 数据来自宿主快照（bond.snap），打开页面时顺手刷新一次。
 */

import { R, bond } from '../../../core/state.js'
import { $ } from '../../../core/util.js'
import { applySnapshot, fetchBond } from '../../../net/bond.js'
import { renderCard, renderState } from './card.js'
import { renderFeed, renderToday } from './feed.js'
import { renderRules } from './rules.js'
import { renderLevels, renderStories } from './story.js'
import { renderSwitches } from './switches.js'

/** @param panes 面板容器；rerender 重画本页 */
export function renderBondPane(panes, rerender) {
  const snap = bond.snap
  if (!snap) {
    panes.append($('div', 'dshp-hint', '正在翻她的小本本……'))
    refresh(rerender)
    return
  }
  panes.append(renderCard(snap))
  if (snap.enabled) panes.append(renderState(snap), renderFeed(snap), renderToday(snap), renderLevels(snap), renderStories(snap))
  panes.append(renderSwitches(snap, rerender), renderRules(snap))
  // 冷却倒计时、心情饱腹是惰性结算的：每次打开页面都拉一份新的（拿到后只在还停在本页时重画）
  if (!renderBondPane.fresh) refresh(rerender)
  renderBondPane.fresh = false
}

async function refresh(rerender) {
  const s = await fetchBond()
  if (!s) return
  applySnapshot(s)
  if (R.ui.menu.focused === 'bond') {
    renderBondPane.fresh = true
    rerender()
  }
}
