/**
 * 羁绊引擎：纯函数，操作一个 state 对象，不碰文件、不读时钟（时间一律由参数 now 传入）。
 * 好处：可以用假时钟把「冷却 / 每日上限 / 衰减 / 周末豁免」全部单测掉，不用等真的过几天。
 *
 * 所有「随时间变化」的值（心情、饱腹、衰减）都是**读取时惰性结算**（settle），没有后台定时器。
 * 规则的来龙去脉见 docs/好感系统设计.md；规则表本身在 ./constants.js。
 */

import {
  LEVELS, MAX_LEVEL, SOURCES, STREAK_REWARDS, MEMORY_XP, FEED_DAILY_CAP, COMPANION_GAP_MS, COMPANION_EVERY_MS,
  MOOD, FULL, RICE, TICKETS, DECAY, GIFTS, GIFT_BY_ID, TASTES, TRAITS, TRAIT_MIN, AWAY, CLIENT_SOURCES, tierOf,
} from './constants.js'
import { MEMORIES, MEMORY_BY_ID, CLIENT_MEMORY_IDS } from './memories.js'
import { localDay, addDays, workdaysBetween, isOffDay, FESTIVALS } from '../calendar.js'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d)
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

// ————————————————————————————————————————————————————————————
// 状态
// ————————————————————————————————————————————————————————————

export function defaultBond(now = Date.now()) {
  return {
    v: 1,
    enabled: true,
    firstSeenAt: now,
    xp: 0,
    level: 1, // 已确认的级别（听完羁绊故事才晋级）
    pending: false, // 羁绊值够了、等着讲故事
    mood: { v: MOOD.base, t: 0 },
    full: { v: 70, t: 0 },
    tickets: TICKETS.start,
    day: { date: '', n: {}, feeds: 0, gifts: {} },
    last: {}, // 每个来源上一次生效的时间
    streak: { days: 0, best: 0, got: [] },
    lastActiveDay: '',
    decayApplied: 0,
    comp: { startAt: 0, lastAt: 0, given: 0 }, // 陪伴
    counters: { poke: 0, stroke: 0, hold: 0, praise: 0, work: 0, feed: 0, night: 0 },
    tastes: {}, // 礼物 id -> 送过几次（用来标「已发现」）
    memories: {}, // 回忆 id -> 解锁时间
    stories: {}, // 级别 -> 看过的时间
    lastSeenAt: 0,
    awayAt: 0,
  }
}

/** 把磁盘上读来的东西整理成合法 state：缺的补默认，坏的丢掉。 */
export function normalizeBond(raw, now = Date.now()) {
  const d = defaultBond(now)
  const r = obj(raw)
  const s = { ...d }
  s.enabled = r.enabled !== false
  s.firstSeenAt = int(r.firstSeenAt, d.firstSeenAt) || d.firstSeenAt
  s.xp = Math.max(0, int(r.xp, 0))
  s.level = clamp(int(r.level, 1), 1, MAX_LEVEL)
  s.mood = { v: clamp(int(obj(r.mood).v, MOOD.base), MOOD.min, MOOD.max), t: int(obj(r.mood).t, 0) }
  s.full = { v: clamp(int(obj(r.full).v, 70), 0, FULL.max), t: int(obj(r.full).t, 0) }
  s.tickets = clamp(int(r.tickets, TICKETS.start), 0, TICKETS.cap)
  const day = obj(r.day)
  s.day = { date: String(day.date || ''), n: obj(day.n), feeds: int(day.feeds, 0), gifts: obj(day.gifts) }
  s.last = obj(r.last)
  const st = obj(r.streak)
  s.streak = { days: int(st.days, 0), best: int(st.best, 0), got: Array.isArray(st.got) ? st.got.map(Number) : [] }
  s.lastActiveDay = String(r.lastActiveDay || '')
  s.decayApplied = Math.max(0, int(r.decayApplied, 0))
  const c = obj(r.comp)
  s.comp = { startAt: int(c.startAt, 0), lastAt: int(c.lastAt, 0), given: int(c.given, 0) }
  s.counters = { ...d.counters, ...obj(r.counters) }
  s.tastes = obj(r.tastes)
  s.memories = obj(r.memories)
  s.stories = obj(r.stories)
  s.lastSeenAt = int(r.lastSeenAt, 0)
  s.awayAt = int(r.awayAt, 0)
  refreshPending(s)
  return s
}

// ————————————————————————————————————————————————————————————
// 等级 / 标签
// ————————————————————————————————————————————————————————————

export const levelFloorXp = (level) => LEVELS[clamp(level, 1, MAX_LEVEL) - 1].xp
export const nextLevelXp = (level) => (level >= MAX_LEVEL ? null : LEVELS[level].xp)
export function potentialLevel(xp) {
  let lv = 1
  for (const L of LEVELS) if (xp >= L.xp) lv = L.lv
  return lv
}
export function refreshPending(s) {
  s.pending = s.level < MAX_LEVEL && potentialLevel(s.xp) > s.level
}
export function moodLabel(v) {
  return v <= 20 ? '低落' : v <= 40 ? '有点蔫' : v <= 65 ? '平淡' : v <= 85 ? '不错' : '超开心'
}
export function fullLabel(v) {
  return v < FULL.hungry ? '饿了' : v < 60 ? '有点饿' : v < FULL.stuffed ? '吃饱了' : '撑着了'
}
export function traitOf(counters) {
  let best = null
  let bestN = TRAIT_MIN - 1
  for (const k of Object.keys(TRAITS)) {
    const n = Number(counters[k]) || 0
    if (n > bestN) {
      best = k
      bestN = n
    }
  }
  return best
}

// ————————————————————————————————————————————————————————————
// 时间结算（惰性）
// ————————————————————————————————————————————————————————————

function moveToward(v, target, steps) {
  if (v === target) return v
  return v < target ? Math.min(target, v + steps) : Math.max(target, v - steps)
}

/** 读取任何值之前先调一次：日切换、心情回归、饱腹下降、羁绊衰减。幂等。 */
export function settle(s, now) {
  const today = localDay(now)
  if (s.day.date !== today) s.day = { date: today, n: {}, feeds: 0, gifts: {} }

  if (!s.mood.t) s.mood.t = now
  else {
    const steps = Math.floor((now - s.mood.t) / MOOD.regenEveryMs)
    if (steps > 0) {
      s.mood.v = moveToward(s.mood.v, MOOD.base, steps)
      s.mood.t += steps * MOOD.regenEveryMs
    }
  }

  if (!s.full.t) s.full.t = now
  else {
    const elapsed = now - s.full.t
    const steps = Math.floor(Math.min(elapsed, FULL.maxCatchupMs) / FULL.decayEveryMs)
    if (steps > 0) {
      s.full.v = Math.max(Math.min(s.full.v, FULL.floor), s.full.v - steps) // 最低不会被「饿」到 floor 以下
      s.full.t = elapsed > FULL.maxCatchupMs ? now : s.full.t + steps * FULL.decayEveryMs
    }
  }

  applyDecay(s, now)
}

/**
 * 衰减（低压版）：连续 3 个工作日没互动之后，每个工作日 -2；
 * 只削本级内进度（地板 = 本级起点），不掉级；7 级及以上不衰减；周末与法定节假日不计。
 * 用 decayApplied 记账，所以重复调用是幂等的。
 */
function applyDecay(s, now) {
  if (s.level >= DECAY.stopAtLevel || !s.lastActiveDay) {
    s.decayApplied = 0
    return
  }
  const today = localDay(now)
  const idle = workdaysBetween(addDays(s.lastActiveDay, 1), today)
  const should = Math.max(0, idle - DECAY.idleWorkdays) * DECAY.perDay
  const delta = should - s.decayApplied
  if (delta <= 0) return
  s.xp = Math.max(levelFloorXp(s.level), s.xp - delta)
  s.decayApplied = should // 即使被地板截住也记账，免得之后反复尝试
  refreshPending(s)
}

// ————————————————————————————————————————————————————————————
// 加分 / 活跃 / 回忆
// ————————————————————————————————————————————————————————————

/** 双倍日：节日、相识纪念日。 */
export function multiplierOf(s, now) {
  const day = localDay(now)
  if (FESTIVALS[day]) return { x: 2, why: FESTIVALS[day] }
  const f = new Date(s.firstSeenAt)
  const n = new Date(now)
  if (f.getMonth() === n.getMonth() && f.getDate() === n.getDate() && localDay(s.firstSeenAt) !== day) return { x: 2, why: '相识纪念日' }
  return { x: 1, why: '' }
}

/** 加 / 减羁绊值：正数吃双倍日倍率，负数不吃；永远不低于本级起点。返回实际变化量。 */
function addXp(s, amount, now, { multiply = true } = {}) {
  const delta = amount > 0 && multiply ? amount * multiplierOf(s, now).x : amount
  const before = s.xp
  s.xp = Math.max(levelFloorXp(s.level), s.xp + delta)
  refreshPending(s)
  return s.xp - before
}

function moodAdd(s, d) {
  s.mood.v = clamp(s.mood.v + d, MOOD.min, MOOD.max)
}

/** 记一次「今天有互动」：刷新衰减基准、连续陪伴天数（周末 / 节假日不断档）、天数奖励。返回事件。 */
function markActive(s, now) {
  const events = []
  const today = localDay(now)
  s.decayApplied = 0
  s.lastSeenAt = now
  if (s.lastActiveDay !== today) {
    const prev = s.lastActiveDay
    // 中间漏掉的工作日数为 0 才算连续（休息日不要求有互动）
    const missed = prev ? workdaysBetween(addDays(prev, 1), today) : 0
    s.streak.days = !prev || missed > 0 ? 1 : s.streak.days + 1
    s.streak.best = Math.max(s.streak.best, s.streak.days)
    s.lastActiveDay = today
    const reward = STREAK_REWARDS[s.streak.days]
    if (reward && !s.streak.got.includes(s.streak.days)) {
      s.streak.got.push(s.streak.days)
      addXp(s, reward, now, { multiply: false })
      events.push({ type: 'streak', days: s.streak.days, xp: reward })
    }
  }
  return events
}

/** 解锁一条回忆（幂等）。返回事件或 null。 */
export function unlockMemory(s, id, now) {
  const m = MEMORY_BY_ID[id]
  if (!m || s.memories[id]) return null
  s.memories[id] = now
  addXp(s, MEMORY_XP, now, { multiply: false })
  moodAdd(s, 5)
  return { type: 'memory', id, title: m.title }
}

const COUNTER_OF = { poke: 'poke', stroke: 'stroke', hold: 'hold', praise: 'praise', turn: 'work' }
const MOOD_OF = { poke: 1, stroke: 4, hold: 2, praise: 5, daily: 3, turn: 3, big: 4, companion: 0 }

function sourceReady(s, kind, now) {
  const rule = SOURCES[kind]
  if (!rule) return { ok: false, why: 'unknown' }
  if ((Number(s.day.n[kind]) || 0) >= rule.cap) return { ok: false, why: 'cap' }
  if (rule.cd && now - (Number(s.last[kind]) || 0) < rule.cd) return { ok: false, why: 'cd' }
  return { ok: true, rule }
}

/** 一次「来源」加分（冷却 / 每日上限在这里判）。返回 { delta, why, events }。 */
export function grantSource(s, kind, now) {
  settle(s, now)
  if (!s.enabled) return { delta: 0, why: 'off', events: [] }
  const g = sourceReady(s, kind, now)
  if (!g.ok) return { delta: 0, why: g.why, events: [] }
  s.day.n[kind] = (Number(s.day.n[kind]) || 0) + 1
  s.last[kind] = now
  const events = markActive(s, now)
  const delta = addXp(s, g.rule.gain, now)
  if (COUNTER_OF[kind]) s.counters[COUNTER_OF[kind]] = (Number(s.counters[COUNTER_OF[kind]]) || 0) + 1
  moodAdd(s, MOOD_OF[kind] || 0)
  return { delta, why: 'ok', events }
}

/** 前端上报的来源（白名单）：戳 / 摸头 / 捏脸 / 被夸 / 每日首见。 */
export function act(s, kind, now) {
  if (!CLIENT_SOURCES.includes(kind)) return { delta: 0, why: 'forbidden', events: [] }
  const r = grantSource(s, kind, now)
  if (kind === 'stroke' && r.why === 'ok') {
    const e = unlockMemory(s, 'stroke-first', now)
    if (e) r.events.push(e)
  }
  return r
}

/** 前端上报只有它自己知道的回忆（白名单校验，幂等）。 */
export function memory(s, id, now) {
  settle(s, now)
  if (!s.enabled) return { ok: false, why: 'off', events: [] }
  if (!CLIENT_MEMORY_IDS.has(id)) return { ok: false, why: 'forbidden', events: [] }
  const e = unlockMemory(s, id, now)
  return { ok: true, events: e ? [e] : [] }
}

// ————————————————————————————————————————————————————————————
// 一轮结束（宿主自己结算）
// ————————————————————————————————————————————————————————————

/**
 * info = { tokens, outcome: 'completed'|'error'|'aborted', deliverables, goalDone, totalTurns }
 * 完成：加分 / 饱腹 / token / 陪伴 / 回忆；失败：只扣一点心情（她在替主人难过）。
 */
export function onTurn(s, info, now) {
  settle(s, now)
  if (!s.enabled) return { events: [] }
  const events = []
  const tokens = Math.max(0, Number(info.tokens) || 0)
  const hour = new Date(now).getHours()
  if (info.outcome === 'completed') {
    s.full.v = clamp(s.full.v + Math.max(RICE.minFullPerTurn, Math.round((tokens / RICE.tokensPerBowl) * RICE.fullPerBowl)), 0, FULL.max)
    s.tickets = Math.min(TICKETS.cap, s.tickets + Math.min(TICKETS.maxPerTurn, TICKETS.perTurn + Math.floor(tokens / TICKETS.tokensPer)))
    events.push(...grantSource(s, 'turn', now).events)
    if (info.goalDone || Number(info.deliverables) > 0) events.push(...grantSource(s, 'big', now).events)
  } else if (info.outcome === 'error') {
    moodAdd(s, -3)
  }
  events.push(...markActive(s, now))
  events.push(...companion(s, now))
  if (hour < 5) {
    s.counters.night = (Number(s.counters.night) || 0) + 1
    pushIf(events, unlockMemory(s, 'all-night', now))
  }
  if (isOffDay(localDay(now))) pushIf(events, unlockMemory(s, 'weekend-work', now))
  if (info.outcome === 'completed') pushIf(events, unlockMemory(s, 'first-meet', now))
  if ((Number(info.totalTurns) || 0) >= 100) pushIf(events, unlockMemory(s, 'turns-100', now))
  if (s.streak.days >= 7) pushIf(events, unlockMemory(s, 'streak-7', now))
  if (s.full.v >= FULL.stuffed) pushIf(events, unlockMemory(s, 'stuffed', now))
  return { events }
}

function pushIf(list, e) {
  if (e) list.push(e)
}

/** 陪伴：连续在干活（相邻两轮间隔 ≤10 分钟），每满 30 分钟 +1。 */
function companion(s, now) {
  const events = []
  if (!s.comp.startAt || now - s.comp.lastAt > COMPANION_GAP_MS) {
    s.comp.startAt = now
    s.comp.given = 0
  }
  s.comp.lastAt = now
  const due = Math.floor((now - s.comp.startAt) / COMPANION_EVERY_MS)
  while (s.comp.given < due) {
    s.comp.given++
    events.push(...grantSource(s, 'companion', now).events)
  }
  return events
}

// ————————————————————————————————————————————————————————————
// 投喂 / 羁绊故事 / 离线事件 / 开关
// ————————————————————————————————————————————————————————————

export function feed(s, itemId, now) {
  settle(s, now)
  if (!s.enabled) return { ok: false, why: 'off' }
  const g = GIFT_BY_ID[itemId]
  if (!g) return { ok: false, why: 'unknown' }
  if (s.day.feeds >= FEED_DAILY_CAP) return { ok: false, why: 'daily-cap' }
  if (g.cost > s.tickets) return { ok: false, why: 'no-tickets' }
  const repeat = (Number(s.day.gifts[g.id]) || 0) >= 1
  const k = repeat ? 0.5 : 1 // 同一天同一礼物第 2 次起效果减半
  const events = markActive(s, now)
  s.tickets -= g.cost
  s.day.feeds++
  s.day.gifts[g.id] = (Number(s.day.gifts[g.id]) || 0) + 1
  s.tastes[g.id] = (Number(s.tastes[g.id]) || 0) + 1
  const xp = addXp(s, Math.round(g.xp * k), now)
  s.full.v = clamp(s.full.v + Math.round(g.full * k), 0, FULL.max)
  moodAdd(s, Math.round(g.mood * k))
  s.counters.feed = (Number(s.counters.feed) || 0) + 1
  if (g.id === 'rice') pushIf(events, unlockMemory(s, 'first-rice', now))
  if (g.id === 'scale') pushIf(events, unlockMemory(s, 'rare-taste', now))
  if (s.full.v >= FULL.stuffed) pushIf(events, unlockMemory(s, 'stuffed', now))
  return { ok: true, gift: g.id, taste: g.taste, xp, full: s.full.v, mood: s.mood.v, tickets: s.tickets, repeat, events }
}

/** 听完羁绊故事 → 正式晋级（重看已晋级的故事不改状态）。 */
export function confirmStory(s, level, now) {
  settle(s, now)
  if (!s.enabled) return { ok: false, why: 'off' }
  const lv = int(level, 0)
  if (lv < 2 || lv > MAX_LEVEL) return { ok: false, why: 'bad-level' }
  if (lv <= s.level) return { ok: true, replay: true, level: s.level, events: [] }
  if (lv !== s.level + 1) return { ok: false, why: 'not-next' }
  if (s.xp < levelFloorXp(lv)) return { ok: false, why: 'not-ready' }
  s.level = lv
  s.stories[lv] = now
  refreshPending(s)
  moodAdd(s, 8)
  const events = [{ type: 'level-up', level: lv, name: LEVELS[lv - 1].name }]
  if (lv === 6) pushIf(events, unlockMemory(s, 'level-6', now))
  if (lv === 10) pushIf(events, unlockMemory(s, 'level-10', now))
  return { ok: true, level: lv, events }
}

/**
 * 回来了：离开超过 2 小时再回来，结算一次「离线小事件」（猫咪后院式）。
 * 以最近一次互动 / 上次结算中较晚的那个为起点，所以同一次离开只结算一次。
 */
export function away(s, now, rand = Math.random) {
  settle(s, now)
  if (!s.enabled) return { ok: true, away: false }
  const since = Math.max(s.lastSeenAt || 0, s.awayAt || 0)
  const gap = since ? now - since : 0
  s.lastSeenAt = now
  if (!since || gap < AWAY.minMs) return { ok: true, away: false }
  const hour = new Date(now).getHours()
  const kind = hour < 6 || hour >= 22 ? 'night' : hour < 17 ? 'day' : 'evening'
  const tickets = Math.floor(rand() * (AWAY.maxTickets + 1))
  s.tickets = Math.min(TICKETS.cap, s.tickets + tickets)
  s.awayAt = now
  moodAdd(s, 3)
  return { ok: true, away: true, gapMs: gap, kind, variant: Math.floor(rand() * 3), tickets }
}

export function setEnabled(s, enabled) {
  s.enabled = !!enabled
  return s.enabled
}

// ————————————————————————————————————————————————————————————
// 快照：「好感」页要的一切（含全部规则表，前端直接渲染）
// ————————————————————————————————————————————————————————————

export function snapshot(s, now) {
  settle(s, now)
  const lvl = LEVELS[s.level - 1]
  const mult = multiplierOf(s, now)
  const trait = traitOf(s.counters)
  const decayOn = s.level < DECAY.stopAtLevel
  const idle = s.lastActiveDay ? workdaysBetween(addDays(s.lastActiveDay, 1), localDay(now)) : 0
  return {
    ok: true,
    enabled: s.enabled,
    level: s.level,
    levelName: lvl.name,
    tier: tierOf(s.level),
    strokeMax: lvl.strokeMax,
    xp: s.xp,
    levelXp: lvl.xp,
    nextXp: nextLevelXp(s.level),
    maxLevel: MAX_LEVEL,
    pending: s.pending,
    pendingLevel: s.pending ? s.level + 1 : null,
    mood: { v: s.mood.v, label: moodLabel(s.mood.v) },
    full: { v: s.full.v, label: fullLabel(s.full.v), hungry: FULL.hungry, stuffed: FULL.stuffed },
    tickets: s.tickets,
    ticketCap: TICKETS.cap,
    streak: { days: s.streak.days, best: s.streak.best, rewards: STREAK_REWARDS, got: s.streak.got },
    trait: trait ? { id: trait, name: TRAITS[trait].name, hint: TRAITS[trait].hint } : null,
    traits: TRAITS,
    multiplier: mult,
    decay: { active: decayOn, idleWorkdays: idle, applied: s.decayApplied, rule: DECAY },
    today: {
      date: s.day.date,
      sources: Object.entries(SOURCES).map(([id, r]) => ({
        id,
        label: r.label,
        gain: r.gain,
        cd: r.cd,
        cap: r.cap,
        how: r.how,
        used: Number(s.day.n[id]) || 0,
        readyInMs: r.cd ? Math.max(0, r.cd - (now - (Number(s.last[id]) || 0))) : 0,
      })),
      feeds: { used: s.day.feeds, cap: FEED_DAILY_CAP },
    },
    gifts: GIFTS.filter((g) => !g.hidden).map((g) => ({
      id: g.id,
      name: g.name,
      cost: g.cost,
      taste: g.taste,
      tasteLabel: TASTES[g.taste].label,
      xp: g.xp,
      full: g.full,
      mood: g.mood,
      blurb: g.blurb,
      tried: Number(s.tastes[g.id]) || 0,
      todayCount: Number(s.day.gifts[g.id]) || 0,
    })),
    levels: LEVELS.map((L) => ({
      lv: L.lv,
      name: L.name,
      xp: L.xp,
      unlock: L.unlock,
      state: L.lv < s.level ? 'done' : L.lv === s.level ? 'current' : 'locked',
      storySeen: !!s.stories[L.lv],
    })),
    memories: MEMORIES.map((m) => ({
      id: m.id,
      title: m.title,
      hint: m.hint,
      unlockedAt: s.memories[m.id] || 0,
      text: s.memories[m.id] ? m.text : '',
    })),
    counters: s.counters,
    firstSeenAt: s.firstSeenAt,
    // 「好感」页的规则说明直接读这里，前端不写死任何数值
    rules: {
      mood: MOOD,
      full: FULL,
      rice: RICE,
      tickets: TICKETS,
      memoryXp: MEMORY_XP,
      feedDailyCap: FEED_DAILY_CAP,
      companionEveryMs: COMPANION_EVERY_MS,
      awayMinMs: AWAY.minMs,
      awayMaxTickets: AWAY.maxTickets,
    },
  }
}
