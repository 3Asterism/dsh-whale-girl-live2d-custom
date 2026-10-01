/** ui/hud.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { CFG } from '../config.js'
import { R } from '../core/state.js'
import { clamp } from '../core/util.js'
import { clampPanels } from './layout.js'
import { closePanels } from './panels.js'

// ——————————————————————————————————————————————————————————————
// 八点七、HUD：余额 / 本轮消耗 / 峰谷计价
// ——————————————————————————————————————————————————————————————
//
// 主人要的东西（原话）：右键不再是设置，而是一个醒目的框，里面要有
//   · 剩余钱数
//   · 每轮结束弹出「本轮消耗」
//   · 现在是峰还是谷（**峰=红，谷=绿**）
//   · 距离切换还有多久
// 而且「不能跟对话冲突、优先级最高、盖在上面」。
//
// 数据来源不自己造：DSH 里装的 dsh-whale-widget 已经在做余额与记账，
// 它把结果开成了同源接口，我们直接读（口径天然一致，不会两边算出不同数字）：
//   GET /dsh-whale/balance.json     → {ok,totalBalance,currency,isPeak,peakNextChangeAt,todayUsage,...}
//   GET /dsh-whale/last-turn.json   → {ok,seq,turn,amount,tokens,ts}
// 没装那个插件时优雅降级：能显示的照常显示，显示不了的写「—」并说明原因。

// 数据源优先级：
//   1) 我们宿主自己的 /dsh-pet/hud —— 自带余额 + 峰谷 + 计价，不依赖任何别的插件
//   2) dsh-whale-widget 的 /dsh-whale/* —— 装了它就用它的账本（口径统一，数字更好对账）
const HUD_SELF = '/dsh-pet/hud'

const HUD_SRC = {
  balance: '/dsh-whale/balance.json',
  lastTurn: '/dsh-whale/last-turn.json',
}

export const hud = {
  open: false,
  data: null, // balance.json 的内容
  turn: null, // last-turn.json 的内容
  seq: 0, // 用 seq 判断「是不是新的一轮」
  err: '',
  tick: null, // 倒计时定时器
  hideAt: 0, // 自动弹出后多久自己收（鼠标悬停时暂停）
  hideTimer: null,
  stats: null, // { days, turns, tokens } —— 陪伴天数/累计轮次/累计 token，纯展示
}

const money = (v, cur) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  const sym = (cur || 'CNY') === 'CNY' ? '¥' : (cur || '') + ' '
  return sym + Number(v).toFixed(2)
}

/** 距切换还有多久：写成人能读的「3 小时 12 分」。 */
function humanLeft(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '即将切换'
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  if (h <= 0) return m + ' 分钟'
  return h + ' 小时 ' + (m < 10 ? '0' + m : m) + ' 分'
}

export function hudRender() {
  if (!R.ui || !R.ui.hud) return
  const h = R.ui.hud
  const d = hud.data || {}
  const peak = d.isPeak === true
  h.badge.textContent = d.isPeak === undefined || d.isPeak === null ? '—' : peak ? '峰' : '谷'
  h.badge.className = 'dshp-hud-tag ' + (peak ? 'dshp-peak' : 'dshp-valley')

  // 配额环：只有厂商给得出「额度上限」才显示（比如 OpenRouter 的 limit），
  // 没有这个概念的厂商（DeepSeek 按量计费）直接藏起来，不占地方。
  if (h.quotaWrap) {
    const limit = d.limit
    if (typeof limit === 'number' && limit > 0 && typeof d.totalBalance === 'number') {
      const usedPct = clamp(((limit - d.totalBalance) / limit) * 100, 0, 100)
      h.quotaWrap.style.display = ''
      h.quotaRing.style.setProperty('--pct', usedPct.toFixed(1))
      // 绿→橙→红：快用完了要显眼，不是一直用accent色糊弄过去
      h.quotaRing.style.setProperty(
        '--dshp-quota-color',
        usedPct >= 90 ? '#e8354a' : usedPct >= 70 ? '#e2a53a' : 'var(--dshp-accent)',
      )
      h.quotaText.textContent = Math.round(usedPct) + '%'
      h.quotaWrap.title = `这个 key 的额度用了 ${usedPct.toFixed(1)}%（剩 ${money(d.totalBalance, d.currency)} / 上限 ${money(limit, d.currency)}）`
    } else {
      h.quotaWrap.style.display = 'none'
    }
  }

  if (d.code === 'NO_KEY') {
    // 注意：这里判的是 d.code，不是 d.ok——hudFetch() 把自家宿主的响应
    // 摊平进 hud.data 时，ok 恒为 true（错误信息单独塞进 code/errText），
    // 判 d.ok === false 会永远走不到这条分支，之前一直是死代码。
    h.money.textContent = '未配置'
    h.foot.textContent = (d.errText || '没配置凭据，所以看不到余额。') + '\n在 DSH 里配好对应的 API key 就能显示。'
  } else if (d.code) {
    h.money.textContent = '—'
  } else if (!hud.data) {
    h.money.textContent = '—'
  } else {
    h.money.textContent = money(d.totalBalance, d.currency)
    h.currency.textContent = d.currency || 'CNY'
  }
  h.today.textContent = d.todayUsage === undefined || d.todayUsage === null ? '—' : money(d.todayUsage, d.todayUsageCurrency || d.currency)

  // 本轮消耗：金额 + tokens（token 数字算流水账，安静模式下不显示，钱照常显示）
  const t = hud.turn || {}
  if (t.amount === undefined || t.amount === null) {
    h.turn.textContent = '—'
  } else {
    h.turn.textContent =
      money(t.amount, d.currency) + (CFG.repeatChat && t.tokens ? ' · ' + Number(t.tokens).toLocaleString() + ' tokens' : '')
  }

  // 倒计时：宿主给的切换时刻是权威（含周末/法定节假日规则）
  if (d.peakNextChangeAt) {
    const left = d.peakNextChangeAt - Math.floor(Date.now() / 1000)
    hud.left = left
    h.countdown.textContent = humanLeft(left)
  } else {
    h.countdown.textContent = '—'
  }

  const src = []
  if (!hud.source) src.push('数据：读不到余额接口')
  else if (hud.source === 'self') src.push('数据：桌宠自带记账' + (d.version ? ' v' + d.version : '') + (d.provider ? ' · ' + d.provider : ''))
  else src.push('数据：dsh-whale-widget' + (d.version ? ' v' + d.version : ''))
  if (hud.err) src.push(hud.err)
  if (t.ts) src.push('本轮：' + new Date(t.ts).toLocaleTimeString('zh-CN', { hour12: false }))
  src.push(hud.fetchedAt ? '更新于 ' + new Date(hud.fetchedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '')
  h.foot.textContent = src.filter(Boolean).join('\n')
}

let hudLastForce = 0

const grabJson = (url) =>
  fetch(url, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)

export async function hudFetch(force) {
  // 节流：force 刷新 60 秒最多一次（右键连点不该反复打 DeepSeek 的余额接口）
  if (force && Date.now() - hudLastForce < 60000) force = false
  if (force) hudLastForce = Date.now()

  // 先问自己宿主：一条就够（余额 + 峰谷 + 本轮 + 今日）
  const self = await grabJson(HUD_SELF + (force ? '?refresh=1' : ''))
  if (self && self.ok) {
    hud.source = 'self'
    hud.err = ''
    hud.data = {
      ok: true,
      version: self.version,
      isPeak: self.isPeak,
      peakNextChangeAt: self.peakNextChangeAt,
      totalBalance: self.balance && self.balance.ok ? self.balance.totalBalance : undefined,
      currency: (self.balance && self.balance.currency) || 'CNY',
      todayUsage: self.today ? self.today.amount : undefined,
      todayUsageCurrency: (self.balance && self.balance.currency) || 'CNY',
      provider: self.balance && self.balance.provider,
      limit: self.balance && self.balance.ok ? self.balance.limit : undefined,
    }
    if (self.balance && self.balance.ok === false) {
      hud.data.code = self.balance.code
      hud.data.errText = self.balance.error
    } else if (self.balance && self.balance.stale) {
      hud.err = '余额这次没刷新成功，显示的是上一次的数字'
    }
    if (self.turn) {
      hud.turn = { ok: true, seq: self.turn.seq, turn: self.turn.turn, amount: self.turn.amount, tokens: self.turn.tokens, ts: self.turn.ts }
      hud.seq = self.turn.seq || 0
    }
    if (self.stats) hud.stats = self.stats
    hud.fetchedAt = Date.now()
    hudRender()
    return { self }
  }

  // 退回 dsh-whale-widget（装了就有，口径与挂件一致）
  const [bal, lt] = await Promise.all([grabJson(HUD_SRC.balance), grabJson(HUD_SRC.lastTurn)])
  hud.err = ''
  if (bal && bal.ok === true) {
    hud.source = 'widget'
    hud.data = bal
  } else if (bal && bal.ok === false) {
    hud.source = 'widget'
    hud.data = bal
  } else {
    hud.source = null
    hud.data = null
    hud.err = '余额读不到：宿主接口和 dsh-whale-widget 都没响应'
  }
  if (lt && lt.ok) {
    hud.turn = lt
    hud.seq = lt.seq || 0
  }
  hud.fetchedAt = Date.now()
  hudRender()
  return { bal, lt }
}

function hudTick() {
  if (!hud.open) return
  if (hud.left !== undefined && hud.data && hud.data.peakNextChangeAt) {
    hud.left = hud.data.peakNextChangeAt - Math.floor(Date.now() / 1000)
    R.ui.hud.countdown.textContent = humanLeft(hud.left)
    // 跨过切换点就重新拉一次（峰谷真的变了）
    if (hud.left <= 0 && !hud.reloading) {
      hud.reloading = true
      setTimeout(() => {
        hud.reloading = false
        hudFetch(true)
      }, 1500)
    }
  }
  // 自动弹出后到点自己收（鼠标在上面就不收，主人在看）
  if (hud.hideAt && Date.now() > hud.hideAt && !hud.hover) closeHud()
}

export function openHud(opts) {
  opts = opts || {}
  if (!R.ui || !R.ui.hud) return
  closePanels() // 别和菜单/输入框叠在一起
  hud.open = true
  R.ui.hud.el.classList.add('dshp-on')
  if (opts.flash) {
    R.ui.hud.el.classList.remove('dshp-flash')
    void R.ui.hud.el.offsetWidth // 强制重排，让动画能重放
    R.ui.hud.el.classList.add('dshp-flash')
  }
  clampPanels()
  hudFetch(opts.refresh === true)
  if (!hud.tick) hud.tick = setInterval(hudTick, 1000)
  if (opts.autoHideMs) {
    hud.hideAt = Date.now() + opts.autoHideMs
  } else {
    hud.hideAt = 0
  }
}

export function closeHud() {
  if (!R.ui || !R.ui.hud) return
  hud.open = false
  hud.hideAt = 0
  R.ui.hud.el.classList.remove('dshp-on', 'dshp-flash')
  if (hud.tick) {
    clearInterval(hud.tick)
    hud.tick = null
  }
}

/**
 * 一轮结束在后台把账刷新——不再自动弹出来了。之前「每轮结束都弹一下」
 * 是主人自己要的，后来反馈这个面板「太大了占我半个屏幕」，改成只刷数据、
 * 不自动开；要看余额还是右键叫「钱包」出来，看到的就是这里刷好的最新数。
 * 等 1.2 秒再拉：宿主的记账是收到事件后才落账的，太早拉会拿到上一轮的数。
 */
export function hudPopTurnEnd() {
  const before = hud.seq
  setTimeout(async () => {
    await hudFetch(false)
    // seq 没变说明账还没落，再补一次
    if (hud.seq === before) setTimeout(() => hudFetch(false), 1800)
  }, 1200)
}
