/**
 * behavior/page.js —— DSH 界面本身的操作也要让她「活着」：点新会话、开设置、开终端、换主题……
 * 以及输入框相关（打字时看着、清空 = 撤回）和「离开又回来」。
 *
 * DSH 的按钮带本地化的 aria-label（如 session.new.label =「新建会话」/ New session），所以在 document 上挂一个
 * **只读的捕获阶段** click 委托，按 aria-label | title | 文字匹配一张中英双语表（persona/page-actions.js），
 * 命中就演；永远不阻止、不吞事件，不影响 DSH 本身。想让她认新的界面动作：只加一行 PAGE_ACTIONS 和一条 PAGE_INTENTS。
 * 这一整块都可以在「好感」页里关掉（界面操作反应 / 打字互动）。
 */

import { CFG } from '../config.js'
import { R } from '../core/state.js'
import { PRI, noteUser, perform } from '../director/perform.js'
import { PAGE_ACTIONS, PAGE_INTENTS } from '../persona/page-actions.js'
import { bondAwayCheck, bondMemory } from './bond.js'
import { noteModelPick, noteRegen } from './soul.js'

/** 最近点过的标签（只存标签，本地内存，不上传；DSHPet.page.recent() 供校准识别表）。 */
export const PAGE = { recent: [] }

export function pageIntent(key) {
  const d = PAGE_INTENTS[key]
  if (!d) return
  noteUser()
  // 同一个 intent id 的冷却同时给「DOM 点击」和「宿主 session/created」去重：谁先到谁演
  perform(Object.assign({ id: 'page-' + key, pri: PRI.CUE, say: key }, d))
  if (key === 'newSession') bondMemory('new-page')
  if (key === 'regen') noteRegen() // 2 分钟内点了 3 次「重新生成」：她会抱头
}

/**
 * 模型下拉里的点选：弹层里带「搜索模型…」输入框，点中的那一项文字像个模型名（带版本号数字，
 * 这样点分组标题「silicon-flow」「DeepSeek 账号」不会被当成选模型）。返回点中那一项的文字，不是就 null。
 */
const MODEL_SEARCH = 'input[placeholder*="搜索模型"],input[placeholder*="earch model" i]'
function modelPickLabel(target) {
  if (!target || !target.closest) return null
  if (target.closest('input,textarea')) return null
  let p = target
  let popup = null
  for (let i = 0; i < 12 && p; i++, p = p.parentElement) {
    if (p.querySelector && p.querySelector(MODEL_SEARCH)) {
      popup = p
      break
    }
  }
  if (!popup) return null
  const item = target.closest('[role="option"],[role="menuitem"],li,button,[data-value]') || target
  const text = (item.textContent || '').replace(/\s+/g, ' ').trim()
  return text.length >= 3 && text.length <= 80 && /[A-Za-z]/.test(text) && /\d/.test(text) ? text : null
}

export function wirePageAwareness() {
  document.addEventListener(
    'click',
    (e) => {
      try {
        if (CFG.pageAware === false) return
        if (R.ui && R.ui.root && R.ui.root.contains(e.target)) return // 她自己的界面不算
        const picked = modelPickLabel(e.target)
        if (picked) {
          noteUser()
          noteModelPick(picked)
          return
        }
        const el = e.target && e.target.closest ? e.target.closest('button,[role="button"],[role="menuitem"],[role="tab"],a[href],[aria-label]') : null
        if (!el) return
        const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)
        if (label) {
          PAGE.recent.push(label)
          if (PAGE.recent.length > 30) PAGE.recent.shift()
          for (const [key, re] of PAGE_ACTIONS) {
            if (re.test(label)) {
              pageIntent(key)
              return
            }
          }
        }
        // 点会话列表里的某一项 = 切换会话（识别点见 Phase 0 对真 DSH 的校准）
        if (el.closest('[data-session-id],[data-sessionid],[role="treeitem"],[role="option"]') && el.closest('aside,nav,[role="tree"],[role="listbox"]')) {
          pageIntent('switchSession')
        }
      } catch (err) {}
    },
    true,
  )
  // 主题切换：不靠按钮文案，看页面真实底色变没变（亮 ↔ 暗）
  let lastDark = null
  let themeTimer = null
  const readDark = () => {
    try {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(getComputedStyle(document.body).backgroundColor)
      if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null // 透明底拿不到
      return (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) / 255 < 0.45
    } catch (err) {
      return null
    }
  }
  lastDark = readDark()
  const onTheme = () => {
    clearTimeout(themeTimer)
    themeTimer = setTimeout(() => {
      if (CFG.pageAware === false) return
      const d = readDark()
      if (d === null || lastDark === null || d === lastDark) {
        if (d !== null) lastDark = d
        return
      }
      lastDark = d
      pageIntent(d ? 'themeDark' : 'themeLight')
    }, 450)
  }
  try {
    const mo = new MutationObserver(onTheme)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
    mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
  } catch (err) {}
}

// ————————————————————————————————————————————————————————————
// 输入框：打字时看着输入的位置；打了一大段又全删掉 = 撤回
// ————————————————————————————————————————————————————————————

export const TYPING = { el: null, len: 0, lastKey: 0, sentAt: 0, clearedAt: 0, timer: null }

const isTextInput = (el) =>
  !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search)$/i.test(el.type || 'text')) || el.isContentEditable === true)

/** 视线用：主人正在 DSH 的输入框里打字（2.5 秒内有按键）时返回那个输入框，否则 null。 */
export function typingTarget() {
  if (CFG.typing === false || !TYPING.el || !TYPING.el.isConnected) return null
  return performance.now() - TYPING.lastKey < 2500 ? TYPING.el : null
}

export function wireTyping() {
  document.addEventListener(
    'input',
    (e) => {
      try {
        if (CFG.typing === false) return
        const el = e.target
        if (!isTextInput(el) || (R.ui && R.ui.root && R.ui.root.contains(el))) return // 她自己的输入框不算
        const len = (el.value !== undefined ? el.value : el.textContent || '').length
        TYPING.el = el
        TYPING.lastKey = performance.now()
        // 一次性清空 ≥15 个字：等 1.5 秒看是不是「发送」造成的（发送时宿主会推 user 事件）
        if (TYPING.len >= 15 && len === 0) {
          TYPING.clearedAt = performance.now()
          clearTimeout(TYPING.timer)
          TYPING.timer = setTimeout(() => {
            if (TYPING.sentAt >= TYPING.clearedAt) return // 是发出去了，不是撤回
            const ms = perform({ id: 'recall', pri: PRI.CUE, tier: 'extra', props: ['撤回'], mood: 'sweat', say: 'recall', ms: 2600, cool: 30000 })
            if (ms) bondMemory('recall')
          }, 1500)
        }
        TYPING.len = len
      } catch (err) {}
    },
    true,
  )
}

// ————————————————————————————————————————————————————————————
// 离开又回来
// ————————————————————————————————————————————————————————————

const AWAY = { at: 0 }

/**
 * 页面重新可见：离开超过 10 分钟算「回来」。优先让宿主结算「离线小事件」（离开超过 2 小时才有，
 * 她讲一件你不在时做的事、顺带捡 token）；没有离线事件，就是普通的「欢迎回来」。
 */
export function onVisibility() {
  if (document.hidden) {
    AWAY.at = Date.now()
    return
  }
  const gap = AWAY.at ? Date.now() - AWAY.at : 0
  AWAY.at = 0
  if (gap < 10 * 60000) return // 短暂切个窗口不算「回来」
  bondAwayCheck().then((did) => {
    if (did) return
    perform({ id: 'welcome-back', pri: PRI.CUE, tier: 'extra', mood: gap > 6 * 3600000 ? 'love' : 'happy', say: gap > 6 * 3600000 ? 'welcomeLong' : 'welcomeBack', ms: 3200, cool: 60000, habit: false })
  })
}
