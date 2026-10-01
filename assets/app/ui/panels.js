/** ui/panels.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { BASE } from '../config.js'
import { R } from '../core/state.js'
import { saveLayout } from '../core/storage.js'
import { $ } from '../core/util.js'
import { PRI, perform } from '../director/perform.js'
import { IDLE_PROPS } from '../persona/items.js'
import { closeHud } from './hud.js'
import { clampPanels } from './layout.js'
import { renderPane } from './menu/render-pane.js'
import { shell } from './shell.js'

export function setHidden(hidden) {
  R.ui.root.classList.toggle('dshp-hidden', !!hidden)
  document.body.classList.toggle('dshp-pet-hidden', !!hidden)
  if (hidden) R.ui.bubble.hide()
  else if (setHidden.was) perform({ id: 'show', pri: PRI.TOUCH, tier: 'extra', mood: 'happy', say: 'show', ms: 2200 }) // 被叫回来
  setHidden.was = !!hidden
  saveLayout({ hidden: !!hidden })
  if (shell.on) shell.post(hidden ? 'hidden' : 'shown')
  // 隐藏是主人主动点的「现在不用显示她」——这种情况停渲染循环零风险
  // （反正看不见，不存在「切回来感觉卡住」的问题，那个顾虑只针对「被遮挡但
  // 没被隐藏」的场景，这里不碰）。桌面壳为了不让她显得卡顿，关掉了
  // Electron 的后台降频（backgroundThrottling:false），所以 document.hidden
  // 几乎不会在桌面壳里变 true——真正能捕捉「用户已经不需要她画面」的
  // 时机，只有这个显式的隐藏开关。
  if (R.app) {
    if (hidden) R.app.ticker.stop()
    else if (!document.hidden) R.app.ticker.start()
  }
}

/** 给面板右上角加一个「×」——主人说之前不好关。 */
export function addCloseButton(panel, onClose) {
  const b = $('button', 'dshp-close', '×')
  b.title = '关闭'
  b.setAttribute('aria-label', '关闭')
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    // 以前不管哪个面板都去 closePanels()，于是「钱包」的 × 点了没反应
    // （钱包不是 closePanels 管的），主人报的「关闭键是坏的」就是这个。
    if (typeof onClose === 'function') onClose()
    else closePanels()
  })
  panel.appendChild(b)
}

export function closePanels() {
  R.ui.composer.el.classList.remove('dshp-on')
  R.ui.menu.el.classList.remove('dshp-on')
  R.ui.root.classList.remove('dshp-open')
}

export function bindComposer(u) {
  const { ta, send, cancel } = u.composer
  const stop = (e) => e.stopPropagation()
  for (const ev of ['keydown', 'keyup', 'keypress']) ta.addEventListener(ev, stop)
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      doSend()
    }
  })
  send.addEventListener('click', doSend)
  cancel.addEventListener('click', async () => {
    try {
      const r = await fetch(BASE + '/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const j = await r.json()
      u.bubble.show(j.ok ? '打断啦' : '打断失败：' + (j.error || '未知'), { name: '鲸鱼娘', ttl: 2000 })
    } catch (err) {
      u.bubble.show('打断失败：' + err.message, { name: '鲸鱼娘', ttl: 2600 })
    }
  })

  async function doSend() {
    const text = ta.value.trim()
    if (!text) {
      ta.focus()
      return
    }
    send.disabled = true
    try {
      const r = await fetch(BASE + '/say', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || '发送失败')
      ta.value = ''
      closePanels()
      perform({ id: 'composer-sent', pri: PRI.EXPLICIT, tier: 'core', habit: false, mood: 'listening', props: IDLE_PROPS, line: text, ms: 2600 })
    } catch (err) {
      u.bubble.show('发不出去：' + err.message, { name: '鲸鱼娘', sticky: true })
    } finally {
      send.disabled = false
    }
  }
}

function openMenu(which) {
  closeHud() // 菜单和 HUD 不同时占屏幕
  R.ui.root.classList.add('dshp-open')
  // 立刻夹一次（getBoundingClientRect 会强制重排，拿到的是最终横向位置），
  // 再在下一帧补一次——只等 rAF 的话，测试/快照可能量到还没夹的面板
  clampPanels()
  // 面板是以模型为中心左右展开的，蹲在角落时右半边会跑到屏幕外——
  // 等布局落定后夹回视口内（关闭按钮和滑块必须点得到）
  requestAnimationFrame(() => clampPanels())
  // 气泡和面板都挂在桌宠上方，同时出现会互相挡住——开面板就把气泡收起来
  R.ui.bubble.hide()
  if (which === 'talk') {
    R.ui.menu.el.classList.remove('dshp-on')
    R.ui.composer.el.classList.add('dshp-on')
    setTimeout(() => R.ui.composer.ta.focus(), 60)
  } else {
    R.ui.composer.el.classList.remove('dshp-on')
    renderPane(R.ui.menu.focused || 'face')
    R.ui.menu.el.classList.add('dshp-on')
  }
  // 面板真正显示之后再夹一次（上面那次夹在 class 加之前，量不到它）
  clampPanels()
}

export function bindMenu(u) {
  const TABS = [
    ['face', '表情'],
    ['decor', '装饰'],
    ['scene', '场景'],
    ['action', '动作'],
    ['bond', '好感'],
    ['setting', '设置'],
  ]
  u.menu.focused = 'face'
  for (const [id, label] of TABS) {
    const b = $('button', 'dshp-tab-btn', label)
    b.dataset.tab = id
    if (id === u.menu.focused) b.classList.add('dshp-active')
    b.addEventListener('click', () => {
      u.menu.focused = id
      for (const el of u.menu.tabs.children) el.classList.toggle('dshp-active', el.dataset.tab === id)
      renderPane(id)
    })
    u.menu.tabs.appendChild(b)
  }
  // 主人要求：说话按钮点一次开、再点一次关（以前再点只会重新打开，像关不掉）
  u.dock.children[0].addEventListener('click', () => {
    if (u.composer.el.classList.contains('dshp-on')) closePanels()
    else openMenu('talk')
  })
  u.dock.children[1].addEventListener('click', () => {
    if (u.menu.el.classList.contains('dshp-on')) closePanels()
    else openMenu('menu')
  })
  u.dock.children[2].addEventListener('click', () => {
    closePanels()
    setHidden(true)
  })
  // 第 4 个：打开 DeepSeek Harness。桌面壳里交给原生用默认浏览器打开，
  // 浏览器版直接新开一个标签页。
  u.dock.children[3].addEventListener('click', () => {
    if (shell.on) shell.post('open-dsh')
    else window.open(BASE.replace(/\/dsh-pet$/, '') + '/', '_blank')
  })
}
