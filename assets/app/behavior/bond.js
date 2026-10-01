/**
 * behavior/bond.js —— 羁绊系统的「演出」：互动上报、回忆解锁提示、投喂、羁绊故事（晋级事件）、离线小事件。
 *
 * 规则与数值在宿主（lib/bond，见 docs/好感系统设计.md），前端只做三件事：
 *   1. 把主人的互动上报给宿主（冷却 / 每日上限由宿主判，前端连点刷不动）；
 *   2. 宿主返回的事件（解锁回忆 / 连续天数 / 晋级）演出来；
 *   3. 「待晋级」时，在空闲的时候问一句「人家有话想说」，主人点了才讲故事——永远不打断工作。
 * 设计底线：没有惩罚、没有勒索、晚上 10 点后不主动开口、总开关可关。
 */

import { R, agent, bond } from '../core/state.js'
import { readLayout, saveLayout } from '../core/storage.js'
import { DIR, PRI, chatLevel, noteUser, perform, performingNow, yieldTo } from '../director/perform.js'
import { applySnapshot, fetchBond, postAct, postAway, postFeed, postMemory, postStory, postToggle } from '../net/bond.js'
import { GIFT_FAIL_SAY, GIFT_REACT } from '../persona/gifts.js'
import { lineFor } from '../persona/lines.js'
import { STORIES } from '../persona/stories.js'
import { playAction } from './menu-actions.js'

/** 这个钟点之后（含）/ 早上 6 点之前，不主动开口讲故事（社畜友好）。 */
const QUIET_AFTER_HOUR = 22
const QUIET_BEFORE_HOUR = 6

const STORY = { active: false, offerTimer: null }

/** 启动 / 周期性刷新：拉一份完整快照。刚进入「待晋级」会安排一次故事邀请。 */
export async function bondRefresh() {
  const s = await fetchBond()
  if (s && applySnapshot(s)) scheduleOffer(4000)
  return s
}

/** 上报一次互动（poke / stroke / hold / praise / daily）。返回宿主的结算结果。 */
export async function bondAct(kind) {
  if (!bond.enabled) return null
  const r = await postAct(kind)
  if (!r || r.ok === false) return r
  const newlyPending = applySnapshot(r.snapshot)
  handleEvents(r.events)
  if (newlyPending) scheduleOffer()
  return r
}

/** 上报一条只有前端知道的回忆（宿主按白名单校验、幂等）。已经解锁过的不再发请求。 */
export function bondMemory(id) {
  if (!bond.enabled) return
  const known = bond.snap && bond.snap.memories && bond.snap.memories.find((m) => m.id === id)
  if (known && known.unlockedAt) return
  postMemory(id).then((r) => {
    if (!r || !r.snapshot) return
    applySnapshot(r.snapshot)
    handleEvents(r.events)
  })
}

/** 宿主推来的 / 接口返回的事件：回忆解锁、连续陪伴天数。 */
export function handleEvents(events) {
  for (const e of events || []) {
    if (e.type === 'memory') showMemory(e.id)
    else if (e.type === 'streak') {
      perform({ id: 'bond-streak', pri: PRI.CUE, tier: 'extra', habit: false, mood: 'happy', say: 'streak', vars: { n: e.days }, ms: 4200, cool: 5000 })
    }
  }
}

function showMemory(id) {
  const m = bond.snap && bond.snap.memories && bond.snap.memories.find((x) => x.id === id)
  const text = m && m.text ? `新回忆：《${m.title}》\n${m.text}` : lineFor('memoryNew')
  perform({ id: 'bond-memory', pri: PRI.CUE, tier: 'core', habit: false, mood: 'shy', line: text, ms: 7000, cool: 3000 })
}

// ————————————————————————————————————————————————————————————
// 投喂
// ————————————————————————————————————————————————————————————

const signed = (n) => (n > 0 ? '+' + n : String(n))

/**
 * 投喂一件礼物。消耗 token，按喜好加 / 减羁绊值、饱腹、心情（规则表公开在「好感」页）。
 * silent：只结算不演（拖文件喂零食时，演出由 feed 模块自己负责）。
 */
export async function feedGift(item, { silent = false } = {}) {
  if (!bond.enabled) return null
  noteUser()
  const before = bond.snap
  const r = await postFeed(item)
  if (!r) return null
  if (r.snapshot) applySnapshot(r.snapshot)
  if (!r.ok) {
    const say = GIFT_FAIL_SAY[r.why]
    if (say && !silent) perform({ id: 'gift-fail', pri: PRI.EXPLICIT, tier: 'core', habit: false, mood: 'sweat', say, ms: 2800 })
    return r
  }
  if (!silent) {
    const g = GIFT_REACT[item]
    if (g) {
      if (g.action) playAction(g.action, { pri: PRI.EXPLICIT, id: 'gift-' + item, say: g.say })
      else perform({ id: 'gift-' + item, pri: PRI.EXPLICIT, tier: 'core', habit: false, mood: g.mood, props: g.props, heart: !!g.heart, say: g.say, ms: g.ms || 3200 })
      const dFull = before ? r.full - before.full.v : 0
      const dMood = before ? r.mood - before.mood.v : 0
      R.ui.bubble.note(`羁绊 ${signed(r.xp)} · 饱腹 ${signed(dFull)} · 心情 ${signed(dMood)}${r.repeat ? ' · 今天吃过了，效果减半' : ''}`)
    }
  }
  handleEvents(r.events)
  return r
}

// ————————————————————————————————————————————————————————————
// 羁绊故事（晋级事件）
// ————————————————————————————————————————————————————————————

const snoozeUntil = () => Number(readLayout().storySnooze) || 0
const snooze = (ms) => saveLayout({ storySnooze: Date.now() + ms })

function scheduleOffer(ms = 4000) {
  clearTimeout(STORY.offerTimer)
  STORY.offerTimer = setTimeout(maybeOfferStory, ms)
}

/**
 * 「待晋级」时，在合适的时候问一句「人家有话想说，现在方便吗」。
 * 合适 = 空闲、没开面板、没在表演重要的事、不是深夜、没被「晚点」过。永远不打断工作。
 */
export function maybeOfferStory() {
  if (!bond.enabled || !bond.pending || STORY.active) return false
  const hour = new Date().getHours()
  if (chatLevel() === 0 || hour >= QUIET_AFTER_HOUR || hour < QUIET_BEFORE_HOUR) return false
  if (agent.status !== 'idle' || Date.now() < snoozeUntil()) return false
  const ui = R.ui
  if (!ui || ui.root.classList.contains('dshp-open') || ui.root.classList.contains('dshp-hidden') || document.hidden) return false
  const cur = performingNow()
  if (cur && cur.pri >= PRI.ALERT) return false
  if (performance.now() - DIR.lastUser < 6000) return scheduleOfferAgain()
  perform({ id: 'story-offer', pri: PRI.CUE, tier: 'core', habit: false, mood: 'shy', line: null, ms: 9000 })
  ui.bubble.ask(
    lineFor('storyOffer'),
    [
      { label: '好呀', onClick: () => playStory(bond.pendingLevel) },
      {
        label: '晚点',
        onClick: () => {
          snooze(2 * 3600000)
          perform({ id: 'story-later', pri: PRI.CUE, tier: 'core', habit: false, mood: 'happy', say: 'storyLater', ms: 2400 })
        },
      },
    ],
    { ttl: 20000 },
  )
  // 没点任何按钮、气泡自己收了：当作「晚点」，半小时后再问
  setTimeout(() => {
    if (!STORY.active && Date.now() >= snoozeUntil()) snooze(30 * 60000)
  }, 20500)
  return true
}
function scheduleOfferAgain() {
  scheduleOffer(10000)
  return false
}

/**
 * 讲一段羁绊故事：一句一句，主人点「继续」才下一句，随时可以「跳过」。
 * replay = 重看已经晋级过的故事，不改任何状态。
 */
export async function playStory(level, { replay = false } = {}) {
  const story = STORIES[level]
  const ui = R.ui
  if (!story || !ui || STORY.active) return
  STORY.active = true
  noteUser()
  try {
    const total = story.steps.length
    for (let i = 0; i < total; i++) {
      const st = story.steps[i]
      perform({ id: 'story-step', pri: PRI.EXPLICIT, tier: 'core', habit: false, mood: st.mood, line: null, ms: 120000 })
      const last = i === total - 1
      const choice = await new Promise((resolve) => {
        const buttons = last
          ? [{ label: replay ? '好了' : '收到', onClick: () => resolve('done') }]
          : [
              { label: '继续', onClick: () => resolve('next') },
              { label: '跳过', onClick: () => resolve('skip') },
            ]
        ui.bubble.ask(st.say, buttons, { name: `《${story.title}》 ${i + 1}/${total}`, ttl: 180000 })
        setTimeout(() => resolve('timeout'), 181000) // 主人走开了：不强行等
      })
      if (choice === 'timeout') return
      if (choice === 'skip' || choice === 'done') break
    }
    if (!replay) await confirmStory(level)
  } finally {
    STORY.active = false
    yieldTo(PRI.EXPLICIT) // 收掉故事期间的脸
  }
}

async function confirmStory(level) {
  const r = await postStory(level)
  if (!r) return
  if (r.snapshot) applySnapshot(r.snapshot)
  if (!r.ok || r.replay) return
  const up = (r.events || []).find((e) => e.type === 'level-up')
  if (up) perform({ id: 'level-up', pri: PRI.EXPLICIT, tier: 'core', habit: false, mood: 'love', heart: true, say: 'levelUp', vars: { name: up.name }, ms: 5200 })
  handleEvents((r.events || []).filter((e) => e.type !== 'level-up'))
  // 连着多级待晋级：别一口气全讲完，隔半小时再问
  if (bond.pending) snooze(30 * 60000)
}

// ————————————————————————————————————————————————————————————
// 离线小事件 / 总开关
// ————————————————————————————————————————————————————————————

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/** 回来了：离开超过 2 小时再回来，她讲一件「你不在的时候做的事」，顺带捡到 token。返回是否演了。 */
export async function bondAwayCheck() {
  if (!bond.enabled) return false
  const r = await postAway()
  if (!r) return false
  if (r.snapshot) applySnapshot(r.snapshot)
  if (!r.away) return false
  let line = lineFor('away' + cap(r.kind))
  if (r.tickets > 0) line += `\n（桌缝里掉了 ${r.tickets} 个 token，人家替主人收好了）`
  perform({ id: 'bond-away', pri: PRI.CUE, tier: 'core', habit: false, mood: 'happy', line, ms: 6500, cool: 60000 })
  return true
}

/** 总开关：关掉就是没有养成系统的那只鲸鱼娘。 */
export async function setBondEnabled(on) {
  const r = await postToggle(on)
  if (!r) return null
  if (r.snapshot) applySnapshot(r.snapshot)
  perform({ id: 'bond-toggle', pri: PRI.EXPLICIT, tier: 'core', habit: false, mood: on ? 'happy' : 'neutral', say: on ? 'bondOn' : 'bondOff', ms: 2600 })
  return r
}
