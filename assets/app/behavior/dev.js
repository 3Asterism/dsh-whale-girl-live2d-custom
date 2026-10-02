/**
 * behavior/dev.js —— v0.6.8「陪你一起干活」：她看得懂你在敲什么命令、替你记今天一起做了什么、每天陪你抽一签。
 *
 * 调研结论（成熟的养成 / 陪伴产品）：留得住人的不是更多聊天，而是 ①一起做的事会沉淀成共同的记忆（「做」比「聊」留存更高）、
 * ②每天一个小仪式 + 偶尔的惊喜、③她在你不在时也「活着」、④全程不带罪恶感、用户随时能关。这里落地前两条：
 *   · 开发动作：从 shell 工具的命令里认出 提交 / push / 拉代码 / 跑测试 / 装依赖 / 构建 / 检查，结果只记账、**不说话**
 *     （复合故事在 behavior/observe.js，一轮结束时才出、顶替收工那句）。成败看宿主从结果末尾抽出的退出码（非零不算 error）；命令本身不进台词、不落盘。
 *   · 今日小账：只记**次数**（提交几次、push 几次、测试几次、改了几个文件、修好几次），本地、按日期，晚上收工时写在脚注里。
 *   · 每日一签：每天第一次见面问一句「要抽签吗」（点按钮才抽、不点就算了）；同一天永远同一支；幸运图优先挑图鉴里还没收的。
 * 都走 perform()：优先级、冷却、话痨档、习惯化照旧。设置页「互动开关」里有「开发动作反应」「每日一签」两个开关。
 */

import { CFG } from '../config.js'
import { R, agent, bond } from '../core/state.js'
import { PRI, chatLevel, perform, performingNow } from '../director/perform.js'
import { claim } from '../net/api.js'
import { userEngaged } from './observe.js'
import { DEV_COUNTED, classifyCommand, commandFingerprint, outcomeOf } from '../persona/devhooks.js'
import { FORTUNE_RE, dateKey, fortuneOf, fortuneText, pickLucky } from '../persona/fortune.js'
import { lineFor } from '../persona/lines.js'
import { MIN_LEVEL } from '../persona/stickers.js'
import { STK } from '../ui/sticker.js'

const DIARY_KEY = 'dsh-live2d-pet:diary'

const emptyDay = (date) => ({ date, turns: 0, files: 0, recovers: 0, fails: 0, testFail: 0, rollback: 0, fortune: false, lucky: '', commit: 0, push: 0, pull: 0, test: 0, install: 0, build: 0, lint: 0 })

function loadDay() {
  const today = dateKey()
  try {
    const j = JSON.parse(localStorage.getItem(DIARY_KEY) || 'null')
    if (j && j.date === today) return Object.assign(emptyDay(today), j)
  } catch (e) {}
  return emptyDay(today)
}

export const DEV = {
  pending: new Map(), // callId → 开发动作类别（工具结果回来时才知道是哪一个）
  day: loadDay(),
  offerTimer: null,
}

/** 拿「今天的账」；跨过午夜自动换新的一页。 */
function today() {
  const k = dateKey()
  if (DEV.day.date !== k) DEV.day = emptyDay(k)
  return DEV.day
}

function saveDay() {
  try {
    localStorage.setItem(DIARY_KEY, JSON.stringify(DEV.day))
  } catch (e) {}
}

// ——————————————————————————————————————————————————————————————
// 开发动作钩子
// ——————————————————————————————————————————————————————————————

/** 工具调用时：认出这是个什么开发动作，记着；等结果回来再反应。 */
export function devToolCall(m) {
  if (!m || !m.callId) return
  const kind = classifyCommand(m.name, m.args)
  const fp = kind || /bash|pwsh|powershell|shell|terminal|command|exec/i.test(String(m.name || '')) ? commandFingerprint(m.args) : 0
  if (!kind && !fp) return
  DEV.pending.set(m.callId, { kind, fp })
  if (DEV.pending.size > 60) DEV.pending.delete(DEV.pending.keys().next().value) // 工具被中断没有结果时，别无限攒
}

/**
 * 工具结果回来：只记账、**不说话**。返回 { kind, outcome }（不是开发动作返回 null），交给 observe.js 记进这一轮的账。
 * 成败看宿主抽出的退出码（非零不算 error；没有退出码的老宿主 / 被信号杀掉 = unknown，既不算成功也不算失败）。
 */
export function devToolResult(m) {
  if (!m || !m.callId) return null
  const entry = DEV.pending.get(m.callId)
  if (!entry) return null
  DEV.pending.delete(m.callId)
  const { kind, fp } = entry
  const outcome = outcomeOf(m)
  if (outcome === 'bg' || !kind) return { kind, outcome, fp } // 放到后台了（还没跑完）/ 不是开发动作（只要指纹）：不记账
  const d = today()
  if (outcome === 'fail' || m.error) {
    d.fails++
    if (kind === 'test') d.testFail++
  } else if (outcome !== 'denied') {
    d[kind]++ // ok 和 unknown 都记「跑过一次」（老宿主没有退出码时账也不会空）
  }
  saveDay()
  return { kind, outcome, fp }
}

/** 一轮顺利收工：记进今日小账（改了几个文件、是不是「失败后终于过了」）。 */
export function devTurnDone({ files, recovered }) {
  const d = today()
  d.turns++
  d.files += Number(files) || 0
  if (recovered) d.recovers++
  saveDay()
}

/** 今日小账（只有次数）。一件值得说的事都没有就返回空串——别为了凑数写一行空话。 */
export function diaryText() {
  const d = today()
  const parts = []
  if (d.commit) parts.push(`提交 ${d.commit}`)
  if (d.push) parts.push(`push ${d.push}`)
  if (d.test || d.testFail) parts.push(`测试 ${d.test + d.testFail}` + (d.testFail ? `（红 ${d.testFail}）` : ''))
  if (d.files) parts.push(`改了 ${d.files} 个文件`)
  if (d.recovers) parts.push(`修好 ${d.recovers} 次`)
  if (!parts.length) return ''
  return '今日小账：' + (d.turns ? `${d.turns} 轮 · ` : '') + parts.join(' · ')
}

export const diaryState = () => Object.assign({}, today())

/** 清空今天的账 / 签 / 节流（测试用；也是「忘掉今天」的最小实现）。 */
export function resetDiary() {
  DEV.day = emptyDay(dateKey())
  DEV.pending.clear()
  try {
    localStorage.removeItem(DIARY_KEY)
  } catch (e) {}
}

// ——————————————————————————————————————————————————————————————
// 每日一签
// ——————————————————————————————————————————————————————————————

const fortuneOn = () => CFG.fortune !== false

/** 抽今天这支签（同一天永远同一支）；已经抽过就提醒「签不能反悔」，再把签文说一遍。 */
export function drawFortune() {
  const d = today()
  const again = d.fortune === true
  const f = fortuneOf(d.date)
  const man = STK.manifest || {}
  const seen = bond.snap && bond.snap.album ? bond.snap.album.ids : []
  // 幸运图当天固定：第一次抽时定下来（那时挑的是图鉴里没收的；之后她丢出来、图鉴变了，再抽也不换）
  if (!d.lucky || !man[d.lucky]) d.lucky = pickLucky(Object.keys(man), seen, bond.level || 1, MIN_LEVEL, f.seed) || ''
  const luckyId = d.lucky
  const luckyName = luckyId && man[luckyId] && man[luckyId].name ? String(man[luckyId].name).replace(/\s*\d+$/, '') : ''
  const text = fortuneText(f, luckyName)
  const tail = again ? lineFor('fortuneAgain') : lineFor(f.say)
  d.fortune = true
  saveDay()
  return perform({
    id: 'fortune', pri: PRI.CUE, tier: 'core', habit: false, mood: f.mood, say: again ? 'fortuneAgain' : f.say,
    line: text + (tail ? '\n' + tail : ''), sticker: luckyId || undefined, ms: 9000, cool: 3000,
  })
}

/** 主人的话里带「抽签 / 运势 / 占卜」：当场抽。只认短句（贴的日志里出现这些字不算）。返回是否接话。 */
export function fortuneByText(t) {
  if (!fortuneOn() || chatLevel() === 0 || t.length > 40 || !FORTUNE_RE.test(t)) return false
  drawFortune()
  return true
}

/**
 * 每天第一次见面后问一句「要抽签吗」。点「抽一签」才抽，点「不用了」或没点就算了，不追问、一天只问一次。
 * 只在她闲着、没开面板、没在演重要的事、不是深夜时问；条件不满足就隔一会儿再看，最多试 4 次，之后就不问了（不补播）。
 */
export function scheduleFortuneOffer(delayMs = 9000, tries = 4, opts = {}) {
  if (!fortuneOn()) return
  clearTimeout(DEV.offerTimer)
  DEV.offerTimer = setTimeout(() => offerFortune(tries, opts), delayMs)
}

async function offerFortune(tries, opts) {
  if (!fortuneOn() || chatLevel() === 0) return
  const hour = new Date().getHours()
  if ((hour >= 23 || hour < 6) && !opts.anyHour) return // 深夜不拉人抽签（anyHour 只给测试用）
  const ui = R.ui
  const cur = performingNow()
  const busy =
    !ui || agent.status !== 'idle' || document.hidden || ui.bubble.visible || ui.bubble.asking || userEngaged() ||
    ui.root.classList.contains('dshp-open') || ui.root.classList.contains('dshp-hidden') || (cur && cur.pri >= PRI.ALERT)
  if (busy) {
    if (tries > 1) scheduleFortuneOffer(45000, tries - 1, opts)
    return
  }
  if (today().fortune) return // 今天已经抽过了
  if (!(await claim('fortune-offer', 'day'))) return
  perform({ id: 'fortune-offer', pri: PRI.CUE, tier: 'extra', habit: false, mood: 'playful', say: 'fortuneOffer', line: null, ms: 9000 })
  ui.bubble.ask(
    lineFor('fortuneOffer'),
    [
      { label: '抽一签', onClick: () => drawFortune() },
      { label: '不用了', onClick: () => perform({ id: 'fortune-no', pri: PRI.CUE, tier: 'core', habit: false, mood: 'happy', say: 'fortuneNo', ms: 2400 }) },
    ],
    { ttl: 15000 },
  )
}

export { DEV_COUNTED }
