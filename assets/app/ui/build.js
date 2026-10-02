/** ui/build.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { readLayout } from '../core/storage.js'
import { $ } from '../core/util.js'
import { makeBubble } from './bubble.js'
import { closeHud } from './hud.js'
import { icon } from './icons.js'
import { clampPanels } from './layout.js'
import { addCloseButton, bindComposer, bindMenu } from './panels.js'

// ——————————————————————————————————————————————————————————————
// 七、UI
// ——————————————————————————————————————————————————————————————

export function buildUI() {
  const root = $('div', 'dshp-root')
  root.id = 'dsh-live2d-pet'

  const stage = $('div', 'dshp-stage')

  const bubbleEl = $('div', 'dshp-bubble')
  const head = $('div', 'dshp-head')
  const dot = $('span', 'dshp-dot')
  const headText = $('span', null, '鲸鱼娘')
  head.append(dot, headText)
  const body = $('div', 'dshp-body')
  // 台词那一行横排：[文字 | 表情包]。表情包（赤风RED《蓝色大肥鱼》）由 bubble.js 挂在文字后面。
  const msg = $('div', 'dshp-msg')
  msg.append(body)
  const foot = $('div', 'dshp-foot')
  bubbleEl.append(head, msg, foot)

  const dock = $('div', 'dshp-dock')
  const talkBtn = $('button', 'dshp-btn dshp-primary')
  talkBtn.append(icon('chat'), $('span', null, '说话'))
  const menuBtn = $('button', 'dshp-btn dshp-icon')
  menuBtn.append(icon('more'))
  menuBtn.title = '菜单（表情 / 装饰 / 场景 / 动作 / 设置）'
  const hideBtn = $('button', 'dshp-btn dshp-icon')
  hideBtn.append(icon('collapse'))
  hideBtn.title = '收起（桌面版会缩成贴边小球）'
  const openBtn = $('button', 'dshp-btn dshp-icon')
  openBtn.append(icon('external'))
  openBtn.title = '打开 DeepSeek Harness 界面'
  dock.append(talkBtn, menuBtn, hideBtn, openBtn)

  const composer = $('div', 'dshp-panel dshp-composer')
  const ta = $('textarea')
  ta.placeholder = '跟 DSH 说点什么…（Enter 发送 / Shift+Enter 换行）'
  const crow = $('div', 'dshp-row')
  const sendBtn = $('button', 'dshp-btn dshp-primary', '发送')
  const cancelBtn = $('button', 'dshp-btn', '打断')
  crow.append($('span', 'dshp-grow'), cancelBtn, sendBtn)
  const chint = $('div', 'dshp-hint', '发出去的话进入当前会话，回复会显示在气泡里。')
  composer.append(ta, crow, chint)
  addCloseButton(composer)

  const menu = $('div', 'dshp-panel dshp-menu')
  const tabs = $('div', 'dshp-tabs')
  const panes = $('div', 'dshp-panes')
  menu.append(tabs, panes)
  addCloseButton(menu)

  const tab = $('div', 'dshp-tab', '🐋 鲸鱼娘')

  // 右键弹出的 HUD（余额 / 本轮消耗 / 峰谷计价）
  const hud = $('div', 'dshp-hud')
  const hudHead = $('div', 'dshp-hud-head')
  const hudTitle = $('span', null, '鲸鱼娘 · 钱包')
  const hudDot = $('span', 'dshp-hud-tag dshp-valley', '谷')
  // 配额环形指示器：只有厂商给得出「限额」的时候才显示（比如 OpenRouter
  // 的 limit），DeepSeek 官方那种按量计费、没有「额度上限」概念的厂商，
  // hudRender() 里会把它整个藏起来，不是每次都占地方。
  const hudQuota = $('div', 'dshp-hud-quota')
  const hudQuotaRing = $('div', 'dshp-hud-quota-ring')
  const hudQuotaText = $('span', 'dshp-hud-quota-text', '')
  hudQuota.append(hudQuotaRing, hudQuotaText)
  hudQuota.style.display = 'none'
  // badge（峰/谷）和配额环放一个子容器里，让它们靠在一起贴右边，
  // 标题单独占左边——不然 hudHead 的 space-between 会把三个都拉开
  const hudHeadRight = $('div', 'dshp-hud-head-right')
  hudHeadRight.append(hudDot, hudQuota)
  hudHead.append(hudTitle, hudHeadRight)
  const hudMoney = $('div', 'dshp-hud-money')
  const hudMoneyNum = $('b', null, '—')
  const hudMoneyCur = $('span', null, 'CNY')
  hudMoney.append(hudMoneyNum, hudMoneyCur)
  const hudRowToday = $('div', 'dshp-hud-row')
  const hudTodayV = $('span', 'dshp-hud-v', '—')
  hudRowToday.append($('span', 'dshp-hud-k', '今日已用'), hudTodayV)
  const hudRowTurn = $('div', 'dshp-hud-row')
  const hudTurnV = $('span', 'dshp-hud-v', '—')
  hudRowTurn.append($('span', 'dshp-hud-k', '本轮消耗'), hudTurnV)
  const hudRowCd = $('div', 'dshp-hud-row')
  const hudCdV = $('span', 'dshp-hud-v', '—')
  hudRowCd.append($('span', 'dshp-hud-k', '距切换'), hudCdV)
  const hudFoot = $('div', 'dshp-hud-foot', '')
  hud.append(
    hudHead, hudMoney,
    $('div', 'dshp-hud-sep'),
    hudRowTurn, hudRowToday, hudRowCd,
    hudFoot,
  )
  addCloseButton(hud, () => closeHud())

  root.append(stage, bubbleEl, dock, composer, menu, hud)
  document.body.append(root, tab)

  const u = {
    root,
    stage,
    tab,
    bubble: makeBubble(bubbleEl, body, foot, dot, headText, msg, () => clampPanels()),
    composer: { el: composer, ta, send: sendBtn, cancel: cancelBtn },
    menu: { el: menu, tabs, panes, focused: null },
    hud: {
      el: hud,
      badge: hudDot,
      money: hudMoneyNum,
      currency: hudMoneyCur,
      today: hudTodayV,
      turn: hudTurnV,
      countdown: hudCdV,
      foot: hudFoot,
      title: hudTitle,
      quotaWrap: hudQuota,
      quotaRing: hudQuotaRing,
      quotaText: hudQuotaText,
    },
    dock,
  }
  bindComposer(u)
  bindMenu(u)
  // 这里不能调 setHidden()——此刻 ui 还没赋值（ui = buildUI() 才刚返回），
  // setHidden 里读 ui.root 会直接抛异常，表现为「隐藏过一次之后，
  // 以后每次打开都起不来」。所以就地写类名。
  if (readLayout().hidden) {
    root.classList.add('dshp-hidden')
    document.body.classList.add('dshp-pet-hidden')
  }
  return u
}
