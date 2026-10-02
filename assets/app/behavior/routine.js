/** behavior/routine.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { maybeOfferStory } from './bond.js'
import { diaryText } from './dev.js'
import { checkLowBalance } from './soul.js'
import { CFG } from '../config.js'
import { R, agent, bond } from '../core/state.js'
import { FLAG, syncConds } from '../director/conds.js'
import { DIR, PRI, chatLevel, perform, performingNow } from '../director/perform.js'
import { claim } from '../net/api.js'
import { hud, hudFetch } from '../ui/hud.js'

// —— 里程碑：一轮结束后再看（等宿主把账落完） ——
const MILESTONES = [
  ['turns', [100, 500, 1000, 5000], 'milestoneTurns', (n) => String(n)],
  ['tokens', [1e6, 1e7, 1e8], 'milestoneTokens', (n) => (n >= 1e8 ? n / 1e8 + ' 亿' : n / 1e4 + ' 万')],
  ['days', [7, 30, 100, 365], 'milestoneDays', (n) => String(n)],
]

export function onTurnFinished() {
  setTimeout(async () => {
    try {
      await hudFetch(false)
      checkLowBalance().catch(() => {}) // 余额 < 5 元：要米（每天最多一次）
      const s = hud.stats
      if (!s) return
      for (const [field, marks, say, fmt] of MILESTONES) {
        const have = Number(s[field]) || 0
        // 从高往低找第一个「已达成但没领过」的，一次只庆祝一个
        for (let i = marks.length - 1; i >= 0; i--) {
          if (have < marks[i]) continue
          if (await claim('ms:' + field + '-' + marks[i], 'forever')) {
            setTimeout(() => {
              if (agent.status === 'idle') perform({ id: 'milestone', pri: PRI.CUE, tier: 'core', mood: 'love', heart: true, say, vars: { n: fmt(marks[i]) }, ms: 4200, habit: false })
            }, 3600)
            return
          }
          break
        }
      }
    } catch (err) {}
  }, 1800)
}

// —— 日常节律：一张表，合并「饭点 / 喝水 / 久坐 / 深夜 / 傍晚账单 / 峰谷」 ——
// 全部：只在空闲时出现；走 claim 去重（双端不重复）；过期丢弃、不补播；走主动发话预算（AMBIENT）。
const ROUTINE = {
  active: { start: 0 }, // 连续「在干活」的起点（10 分钟没动静就断）
  lastPeak: null,
  lastLowBalance: false,
}

const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes()

const inWindow = (d, h, m, win) => {
  const x = minutesOfDay(d) - (h * 60 + m)
  return x >= 0 && x < win
}

export async function routineTick() {
  if (agent.status !== 'idle' || document.hidden) return
  const now = Date.now()
  const d = new Date(now)

  // 夜晚桌布：22:00–06:00（应景装扮，纯时间驱动）
  const night = d.getHours() >= 22 || d.getHours() < 6
  if (night !== FLAG.night) {
    FLAG.night = night
    syncConds()
  }

  // 连续在干活：agent 或主人 10 分钟内有动静就算「还在干」
  const live = now - agent.lastActivity < 10 * 60000
  if (live) ROUTINE.active.start = ROUTINE.active.start || now
  else ROUTINE.active.start = 0

  // 「待晋级」的羁绊故事：空闲时问一句（自带一堆「不打断」的判断，见 behavior/bond.js）
  if (bond.pending) maybeOfferStory()

  // 主动开口的门槛：「日常提醒」关了 / 安静档不开；刚互动过 / 刚说过话 / 面板开着都不插嘴
  if (CFG.routine === false || chatLevel() === 0) return
  const t = performance.now()
  if (t - DIR.lastUser < 20000 || t - DIR.lastProactive < 8 * 60000 || performingNow()) return
  if (R.ui.root.classList.contains('dshp-open') || hud.open) return

  const slot = async (key, spec) => {
    if (!(await claim('routine:' + key, 'day'))) return false
    perform(Object.assign({ id: 'routine-' + key, pri: PRI.AMBIENT, tier: 'extra', habit: false, budget: true, ms: 4200 }, spec))
    return true
  }
  const hourSlot = Math.floor(now / 3600000)
  // v0.6.2：今日心愿——每天第一次空闲时悄悄提一句（不强求）；每周回顾——每周一次，白天空闲时，上周至少 3 轮才讲
  const snap = bond.enabled ? bond.snap : null
  if (snap && snap.wish && !snap.wish.done && (await slot('wish', { say: 'wishToday', vars: { w: snap.wish.text }, mood: 'shy', ms: 5200 }))) return
  const rc = snap && snap.recap
  if (rc && d.getHours() >= 9 && d.getHours() < 21 && (await claim('routine:recap-' + rc.key, 'forever'))) {
    perform({ id: 'routine-recap', pri: PRI.AMBIENT, tier: 'extra', habit: false, budget: true, mood: 'happy', say: 'weekRecap', vars: { d: rc.days, t: rc.turns }, ms: 6500 })
    return
  }
  if (inWindow(d, 12, 0, 40) && (await slot('lunch', { say: 'lunch', mood: 'excited' }))) return
  if (inWindow(d, 15, 0, 40) && (await slot('tea', { say: 'tea', mood: 'happy', props: ['parfait'], ms: 8000 }))) return
  if (inWindow(d, 18, 30, 40) && (await slot('dinner', { say: 'dinner', mood: 'excited' }))) return
  // 傍晚「今日账单」：今天确实一起干过活，才说
  if (d.getHours() >= 18 && d.getHours() < 23 && ROUTINE.active.start === 0) {
    const s = hud.stats
    if (s && s.turnsToday > 0 && (await slot('wrap', { say: 'wrapup', vars: { n: s.turnsToday, r: s.riceToday || 0 }, mood: 'happy', ms: 5000 }))) {
      const dt = diaryText() // 今日小账：只有次数（提交 / push / 测试 / 改了几个文件），写在这句收工台词的脚注里
      if (dt) R.ui.bubble.note(dt)
      return
    }
  }
  if (d.getHours() === 23 && (await slot('sleepy1', { say: 'sleepy1', mood: 'sleepy' }))) return
  if (d.getHours() >= 1 && d.getHours() < 4 && (await slot('sleepy2', { say: 'sleepy2', mood: 'sleepy' }))) return
  // 连续在干：先「看见」（90 分钟），再喝水（45 分钟）。不催休息，只替主人看着电脑
  const run = ROUTINE.active.start ? now - ROUTINE.active.start : 0
  if (run >= 90 * 60000 && (await slot('sit-' + hourSlot, { say: 'sit', mood: 'sweat' }))) return
  if (run >= 45 * 60000 && (await slot('water-' + hourSlot, { say: 'water', motion: 'splash', mood: 'happy' }))) return

  // 峰谷切换 / 余额见底：数据来自钱包，这里只负责「看见变化就说一句」
  if (hud.data && typeof hud.data.isPeak === 'boolean') {
    if (ROUTINE.lastPeak !== null && ROUTINE.lastPeak !== hud.data.isPeak) {
      const peak = hud.data.isPeak
      ROUTINE.lastPeak = peak
      if (await slot('peak-' + hud.data.peakNextChangeAt, { say: peak ? 'peakOn' : 'valleyOn', mood: peak ? 'sweat' : 'happy' })) return
    }
    ROUTINE.lastPeak = hud.data.isPeak
    if (hud.data.peakNextChangeAt && Math.floor(now / 1000) > hud.data.peakNextChangeAt + 3 && !hud.reloading) hudFetch(true)
    const low = hud.data.currency === 'CNY' && typeof hud.data.totalBalance === 'number' && hud.data.totalBalance < 1
    if (low && !ROUTINE.lastLowBalance) {
      ROUTINE.lastLowBalance = true
      if (await slot('lowbal', { say: 'lowBalance', mood: 'dead' })) return
    } else if (!low) {
      // 余额从「见底」回来了（充值了）：复活节——抱着彩蛋复活，每天最多一次
      const wasLow = ROUTINE.lastLowBalance
      ROUTINE.lastLowBalance = false
      if (wasLow && (await slot('balback', { say: 'balanceBack', mood: 'excited', heart: true }))) return
    }
  }
}
