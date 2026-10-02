#!/usr/bin/env node
/**
 * test-bond.mjs —— 羁绊引擎（lib/bond）的单元测试。
 *
 * 引擎是纯函数 + 注入时钟，所以冷却 / 每日上限 / 衰减 / 周末豁免 / 连续天数这些
 * 「要过好几天才看得到」的规则，全部用假时钟当场跑完。
 *
 *   node tools/test-bond.mjs
 */

import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const { createBond, engine: E, LEVELS, SOURCES, GIFTS, MEMORIES, FEED_DAILY_CAP, WISHES, WISH, ALBUM_MILESTONES } = await load('lib/bond/index.js')
const cal = await load('lib/calendar.js')

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

// ———— 假时钟：以 2026-10-12（周一）为起点 ————
const at = (y, m, d, h = 10, mi = 0) => new Date(y, m - 1, d, h, mi, 0).getTime()
const MON = at(2026, 10, 12)
let now = MON
const mem = { bond: undefined }
function make(opts = {}) {
  mem.bond = opts.seed
  now = opts.start || MON
  return createBond({ read: () => mem.bond, write: (b) => (mem.bond = JSON.parse(JSON.stringify(b))), clock: () => now, rand: opts.rand, stickers: opts.stickers || [] })
}
const advance = (ms) => (now += ms)
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN

console.log('\n羁绊引擎单元测试 (lib/bond)\n')

// ———— 日历 ————
check('日历：周一到周五是工作日，周末不是', !cal.isOffDay('2026-10-12') && cal.isOffDay('2026-10-17') && cal.isOffDay('2026-10-18'))
check('日历：法定节假日算休息日', cal.isOffDay('2026-10-05'))
check('日历：workdaysBetween 跳过周末', cal.workdaysBetween('2026-10-16', '2026-10-19') === 1) // 周五 → 周一：只算周五
check('日历：addDays', cal.addDays('2026-10-31', 1) === '2026-11-01' && cal.addDays('2026-10-01', -1) === '2026-09-30')

// ———— 默认值与规整 ————
{
  const b = make()
  const s = b.snapshot()
  check('初始：1 级「初识」、羁绊值 0、有 token', s.level === 1 && s.levelName === '初识' && s.xp === 0 && s.tickets === 5)
  check('快照带全部规则表（来源 / 礼物 / 等级 / 回忆）',
    s.today.sources.length === Object.keys(SOURCES).length && s.gifts.length === GIFTS.filter((g) => !g.hidden).length
      && s.levels.length === 10 && s.memories.length === MEMORIES.length, `${s.today.sources.length}/${s.gifts.length}/${s.levels.length}/${s.memories.length}`)
  check('回忆未解锁时只给解锁提示、不泄露旁白', s.memories.every((m) => m.hint && m.text === ''))
  const bad = E.normalizeBond({ xp: 'abc', level: 99, tickets: -5, mood: { v: 9999 }, streak: 'x', counters: null })
  check('规整：坏数据被修成合法值', bad.xp === 0 && bad.level === 10 && bad.tickets === 0 && bad.mood.v === 100 && bad.streak.days === 0)
}

// ———— 来源：冷却与每日上限 ————
{
  const b = make()
  const r1 = b.act('poke')
  check('戳：第一次 +1', r1.delta === 1 && r1.why === 'ok')
  const r2 = b.act('poke')
  check('戳：10 秒冷却内不加分', r2.delta === 0 && r2.why === 'cd')
  advance(11 * SEC)
  check('戳：冷却过后再加', b.act('poke').delta === 1)
  let got = 2
  for (let i = 0; i < 20; i++) {
    advance(11 * SEC)
    got += b.act('poke').delta
  }
  check('戳：每日上限 10 次', got === SOURCES.poke.cap, `共得 ${got}`)
  check('戳：到上限后返回 cap', (advance(11 * SEC), b.act('poke').why === 'cap'))
  advance(24 * HOUR)
  check('戳：第二天重新计数', b.act('poke').delta === 1)
}
{
  const b = make()
  const s1 = b.act('stroke')
  check('摸头：+2，并解锁回忆「被摸头了」', s1.delta === 2 && s1.events.some((e) => e.type === 'memory' && e.id === 'stroke-first'))
  advance(60 * SEC)
  check('摸头：3 分钟冷却', b.act('stroke').why === 'cd')
  advance(3 * MIN)
  check('摸头：冷却过后再加', b.act('stroke').delta === 2)
  check('前端不能伸手要「收工 / 大功告成 / 陪伴」的分', ['turn', 'big', 'companion', 'feed'].every((k) => b.act(k).why === 'forbidden'))
  check('每日首见：+3 且一天只有一次', (() => {
    const c = make()
    const a = c.act('daily')
    const d = c.act('daily')
    return a.delta === 3 && d.delta === 0 && d.why === 'cap'
  })())
}

// ———— 晋级：羁绊值够了要听故事 ————
{
  const b = make()
  mem.bond = { ...mem.bond }
  const seed = E.defaultBond(MON)
  seed.xp = 40
  const c = make({ seed })
  const s = c.snapshot()
  check('羁绊值够 2 级，但等级还是 1（待晋级）', s.level === 1 && s.pending === true && s.pendingLevel === 2)
  check('故事不能跳级', c.story(3).why === 'not-next')
  const ok = c.story(2)
  check('听完故事正式晋级', ok.ok && ok.level === 2 && ok.snapshot.level === 2 && ok.snapshot.pending === false)
  check('晋级事件带等级名', ok.events.some((e) => e.type === 'level-up' && e.name === '点头之交'))
  check('重看已晋级的故事不改状态', c.story(2).replay === true && c.snapshot().level === 2)
  const seed2 = E.defaultBond(MON)
  seed2.xp = 10
  check('羁绊值不够不能晋级', make({ seed: seed2 }).story(2).why === 'not-ready')
  const seed3 = E.defaultBond(MON)
  seed3.xp = 99999
  const d = make({ seed: seed3 })
  check('羁绊值再多也一次只晋一级（超出的保留）', d.snapshot().level === 1 && d.story(2).level === 2 && d.snapshot().pendingLevel === 3 && d.snapshot().xp === 99999)
}

// ———— 投喂与地板 ————
{
  const b = make()
  const f1 = b.feed('rice')
  check('投喂白饭：最爱，+8 羁绊 / +饱腹 / 花 1 个 token', f1.ok && f1.taste === 'loved' && f1.xp === 8 && f1.tickets === 4)
  const f2 = b.feed('rice')
  check('同一天同一礼物第 2 次效果减半', f2.ok && f2.repeat === true && f2.xp === 4)
  check('沙拉（讨厌）不会把羁绊值扣到本级起点以下', (() => {
    const c = make()
    const r = c.feed('salad')
    return r.ok && r.xp === 0 && c.snapshot().xp === 0
  })())
  const c = make()
  check('token 不够不能投喂', (() => {
    c.feed('omurice') // 3
    c.feed('parfait') // 3 → 5 票只够一个
    return c.feed('omurice').why === 'no-tickets'
  })())
  const d = make()
  const seed = E.defaultBond(MON)
  seed.tickets = 30
  const e = make({ seed })
  let okCount = 0
  for (const id of ['rice', 'tea', 'blanket', 'coffee', 'salad', 'rice']) if (e.feed(id).ok) okCount++
  check(`每日最多投喂 ${FEED_DAILY_CAP} 次`, okCount === FEED_DAILY_CAP, `成功 ${okCount} 次`)
  check('拖进来的文件是零食：不花 token', make().feed('file').tickets === 5)
  check('未知礼物被拒', d.feed('bomb').why === 'unknown')
  const s = make({ seed })
  s.feed('scale')
  check('送体重秤会解锁回忆「禁区」', s.snapshot().memories.find((m) => m.id === 'rare-taste').unlockedAt > 0)
}

// ———— 一轮结束 ————
{
  const b = make()
  const r = b.onTurn({ tokens: 45000, outcome: 'completed', totalTurns: 1 })
  const s = b.snapshot()
  check('收工：+2 羁绊值、饱腹增加、拿到 token（1 + 每 2 万 token 1 张）', s.xp >= 2 && s.full.v > 70 && s.tickets === 5 + 3, JSON.stringify({ xp: s.xp, full: s.full.v, t: s.tickets }))
  check('收工：解锁回忆「初次见面」', s.memories.find((m) => m.id === 'first-meet').unlockedAt > 0)
  const e = make()
  e.onTurn({ tokens: 1000, outcome: 'error' })
  check('失败的一轮不加分、不给 token，只让心情低一点', e.snapshot().xp === 0 && e.snapshot().tickets === 5 && e.snapshot().mood.v < 60)
  const seed = E.defaultBond(MON)
  seed.tickets = 29
  const f = make({ seed })
  f.onTurn({ tokens: 99999, outcome: 'completed' })
  check('token 封顶 30', f.snapshot().tickets === 30)
  const g = make()
  g.onTurn({ tokens: 100, outcome: 'completed', deliverables: 1 })
  // 收工 +2、大功告成 +5、首次收工解锁回忆「初次见面」+3
  check('有交付物：额外「大功告成」+5', g.snapshot().xp === 2 + 5 + 3, String(g.snapshot().xp))
  const h = make()
  for (let i = 0; i < 30; i++) {
    h.onTurn({ tokens: 100, outcome: 'completed' })
    advance(2 * MIN)
  }
  check('收工每日最多 20 轮计分', h.snapshot().today.sources.find((x) => x.id === 'turn').used === 20)
}

// ———— 陪伴 ————
{
  const b = make()
  for (let i = 0; i < 14; i++) {
    b.onTurn({ tokens: 100, outcome: 'completed' })
    advance(5 * MIN) // 每 5 分钟一轮，连续 70 分钟
  }
  const used = b.snapshot().today.sources.find((x) => x.id === 'companion').used
  check('陪伴：连续 65 分钟 → 满 2 个 30 分钟', used === 2, `陪伴 ${used} 次`)
  const c = make()
  c.onTurn({ tokens: 100, outcome: 'completed' })
  advance(40 * MIN) // 间隔超过 10 分钟：重新计时
  c.onTurn({ tokens: 100, outcome: 'completed' })
  check('陪伴：间隔超过 10 分钟就重新计时', c.snapshot().today.sources.find((x) => x.id === 'companion').used === 0)
}

// ———— 衰减（低压版）————
{
  // 周一互动 → 周二、周三、周四没互动（3 个工作日）→ 周五还没衰减 → 周六起算 1 个工作日（周五）
  const seed = E.defaultBond(MON)
  seed.xp = 60
  seed.level = 2
  seed.lastActiveDay = '2026-10-12'
  const b = make({ seed, start: at(2026, 10, 15, 22) }) // 周四晚
  check('3 个工作日没互动之内：不衰减', b.snapshot().xp === 60)
  advance(24 * HOUR) // 周五
  check('周五（第 4 个工作日还没过完）：不衰减', b.snapshot().xp === 60)
  advance(24 * HOUR) // 周六
  check('周六：周五这个工作日算过完了 → 衰减 2', b.snapshot().xp === 58, String(b.snapshot().xp))
  advance(24 * HOUR) // 周日
  check('周日：休息日不计，不再衰减', b.snapshot().xp === 58)
  check('重复读取是幂等的（不会反复扣）', (b.snapshot(), b.snapshot(), b.snapshot().xp === 58))
  advance(24 * HOUR) // 周一
  advance(24 * HOUR) // 周二：周一这个工作日算过完了 → 周二～周五 + 周一 共 5 个工作日没互动 → (5-3)×2 = 4
  check('下周继续：只算工作日，每个 -2', b.snapshot().xp === 56, String(b.snapshot().xp))
  advance(24 * HOUR) // 周三：周二也算过完了 → 6 个工作日 → 6
  check('再过一个工作日又 -2', b.snapshot().xp === 54, String(b.snapshot().xp))
}
{
  const seed = E.defaultBond(MON)
  seed.xp = 41
  seed.level = 2
  seed.lastActiveDay = '2026-09-01'
  const b = make({ seed })
  check('衰减有地板：只削本级内进度，不掉级、不低于本级起点', b.snapshot().xp === 40 && b.snapshot().level === 2)
}
{
  const seed = E.defaultBond(MON)
  seed.xp = 700
  seed.level = 7
  seed.lastActiveDay = '2026-08-01'
  check('7 级及以上不衰减', make({ seed }).snapshot().xp === 700)
  const s2 = E.defaultBond(MON)
  s2.xp = 60
  s2.level = 2
  s2.lastActiveDay = '2026-09-20'
  const c = make({ seed: s2 })
  c.snapshot()
  c.act('poke')
  check('一互动，衰减记账清零', mem.bond.decayApplied === 0 && mem.bond.lastActiveDay === '2026-10-12')
}
{
  // 国庆长假（10/1–10/7）整段不计
  const seed = E.defaultBond(MON)
  seed.xp = 60
  seed.level = 2
  seed.lastActiveDay = '2026-09-30'
  const b = make({ seed, start: at(2026, 10, 8, 10) }) // 假期结束后的第一天
  check('法定节假日不计入「没互动的工作日」', b.snapshot().xp === 60)
}

// ———— 连续陪伴（周末不断档）————
{
  const b = make()
  b.act('daily') // 周一
  advance(24 * HOUR)
  b.act('daily') // 周二
  advance(24 * HOUR)
  const r = b.act('daily') // 周三：第 3 天
  check('连续 3 天：天数奖励 +5（每档只给一次）', r.events.some((e) => e.type === 'streak' && e.days === 3 && e.xp === 5))
  advance(24 * HOUR) // 周四不来
  advance(24 * HOUR) // 周五来：中间漏了周四（工作日）→ 断档
  b.act('daily')
  check('漏了一个工作日：连续天数重新算', b.snapshot().streak.days === 1 && b.snapshot().streak.best === 3)
  advance(3 * 24 * HOUR) // 周五 → 下周一，中间是周末
  b.act('daily')
  check('周五 → 下周一：周末不断档', b.snapshot().streak.days === 2)
}

// ———— 双倍日 ————
{
  const b = make({ start: at(2026, 10, 1, 10) }) // 国庆
  check('节日（国庆）加分翻倍', b.act('poke').delta === 2 && b.snapshot().multiplier.why === '国庆')
  const seed = E.defaultBond(at(2025, 3, 3))
  const c = make({ seed, start: at(2026, 3, 3, 10) })
  check('相识纪念日加分翻倍', c.act('poke').delta === 2 && c.snapshot().multiplier.why === '相识纪念日')
  const d = make({ start: MON })
  check('平常日没有倍率', d.snapshot().multiplier.x === 1)
}

// ———— 离线小事件 ————
{
  let r = 0
  const b = make({ rand: () => r })
  b.act('poke')
  advance(30 * MIN)
  check('离开不到 2 小时：没有离线事件', b.away().away === false)
  advance(3 * HOUR)
  r = 0.99
  const a = b.away()
  check('离开超过 2 小时：结算一次，带 token（0–3 张）', a.away === true && a.tickets >= 0 && a.tickets <= 3 && a.tickets === 3, JSON.stringify({ k: a.kind, t: a.tickets }))
  check('按回来的时段分档（白天）', a.kind === 'day')
  check('同一次离开只结算一次', b.away().away === false)
  advance(5 * HOUR)
  advance(HOUR) // 晚上
  const n = b.away()
  check('再离开一次又能结算（傍晚 / 夜里分档）', n.away === true && ['evening', 'night'].includes(n.kind), n.kind)
  check('第一次进来（从没互动过）不触发', make().away().away === false)
}

// ———— 回忆 ————
{
  const b = make()
  check('客户端回忆白名单：合法 id 解锁、幂等', (() => {
    const a = b.memory('denial')
    const c = b.memory('denial')
    return a.ok && a.events.length === 1 && c.events.length === 0
  })())
  check('客户端不能伪造服务端才知道的回忆', b.memory('streak-7').why === 'forbidden' && b.memory('nope').why === 'forbidden')
  check('解锁回忆 +3 羁绊值', b.snapshot().xp === 3)
  check('解锁后快照才带旁白', b.snapshot().memories.find((m) => m.id === 'denial').text.length > 10)
}

// ———— 心情 / 饱腹 / 倾向 ————
{
  const b = make()
  b.act('praise')
  check('被夸：心情上升', b.snapshot().mood.v > 60)
  advance(2 * HOUR)
  check('心情会向基线回归（不会一直高 / 一直低）', b.snapshot().mood.v === 60)
  const f = make()
  const base = f.snapshot().full.v
  advance(60 * MIN)
  check('饱腹每 6 分钟 -1', f.snapshot().full.v === base - 10, String(f.snapshot().full.v))
  advance(30 * 24 * HOUR)
  check('饱腹有地板：最低 10，且单次最多结算 6 小时', f.snapshot().full.v === 10 || f.snapshot().full.v === base - 10 - 60)
  const t = make()
  for (let i = 0; i < 12; i++) {
    t.act('stroke')
    advance(i === 7 ? 24 * HOUR : 4 * MIN) // 摸头每天最多 8 次，所以分两天凑够 10 次
  }
  const tr = t.snapshot().trait
  check('倾向称号：摸头最多 → 撒娇鲸（至少 10 次才有）', tr && tr.id === 'stroke' && tr.name === '撒娇鲸', JSON.stringify(tr))
  check('没到 10 次没有称号', make().snapshot().trait === null)
}


// ———— v0.6.2：今日心愿（低压：做到有奖励，做不到什么都不发生）————
const DAY0 = cal.localDay(MON)
const seedWish = (id, extra = {}) => ({ firstSeenAt: MON - 5 * 24 * HOUR, wish: { date: DAY0, id, done: false, prev: '' }, ...extra })
{
  const s = make().snapshot()
  check('每天有一个心愿（带文字和做法）', s.wish && s.wish.text && s.wish.hint && s.wish.done === false && s.wish.reward.xp === WISH.xp, s.wish && s.wish.text)
  check('同一天固定一个（按日期确定，不是随机）', make().snapshot().wish.id === make().snapshot().wish.id)

  const ids = []
  const w = make()
  for (let i = 0; i < 14; i++) {
    ids.push(w.snapshot().wish.id)
    advance(24 * HOUR)
  }
  check('连续 14 天，相邻两天的心愿不重样', ids.every((x, i) => i === 0 || x !== ids[i - 1]), ids.join(','))
  check('一个月里会出现好几种不同的心愿', new Set(ids).size >= 4, `${new Set(ids).size} 种`)

  const poor = make({ seed: { tickets: 0 } })
  const poorIds = []
  for (let i = 0; i < 25; i++) {
    advance(24 * HOUR)
    poorIds.push(poor.snapshot().wish.id)
  }
  check('token 是 0 的时候不会出投喂类心愿（不变相催你干活）', !poorIds.some((x) => x.startsWith('feed-')), poorIds.slice(0, 6).join(','))
  check('没有表情包清单就不会出「新表情包」心愿', !ids.concat(poorIds).includes('sticker'))

  // 各类心愿的完成条件
  const stroke = make({ seed: seedWish('stroke') })
  const r1 = stroke.act('stroke')
  const ev1 = r1.events.find((e) => e.type === 'wish')
  check('摸头心愿：摸一次就达成，奖励 +6 羁绊、+1 token', ev1 && ev1.id === 'stroke' && ev1.xp === 6 && ev1.tickets === 1 && r1.snapshot.tickets === 6, JSON.stringify(ev1))
  check('心愿达成后快照标记 done，并解锁「小心愿」回忆', r1.snapshot.wish.done === true && r1.snapshot.memories.find((m) => m.id === 'first-wish').unlockedAt > 0)
  advance(4 * MIN)
  check('同一天只发一次奖励', !stroke.act('stroke').events.some((e) => e.type === 'wish'))

  const feedW = make({ seed: seedWish('feed-rice') })
  check('投喂心愿：喂别的不算', !feedW.feed('tea').events.some((e) => e.type === 'wish'))
  const rf = feedW.feed('rice')
  check('投喂心愿：喂对了才算（白饭）', rf.events.some((e) => e.type === 'wish' && e.id === 'feed-rice'))

  const turns = make({ seed: seedWish('turns3') })
  const t1 = turns.onTurn({ tokens: 100, outcome: 'completed' }).events
  const t2 = turns.onTurn({ tokens: 100, outcome: 'completed' }).events
  const t3 = turns.onTurn({ tokens: 100, outcome: 'completed' }).events
  check('三轮心愿：前两轮不算，第三轮达成', !t1.concat(t2).some((e) => e.type === 'wish') && t3.some((e) => e.type === 'wish' && e.id === 'turns3'))

  const praise = make({ seed: seedWish('praise') })
  check('被夸心愿：夸一次就达成', praise.act('praise').events.some((e) => e.type === 'wish' && e.id === 'praise'))

  // 失败的轮次不算「干完 3 轮」
  const failed = make({ seed: seedWish('turns3') })
  for (let i = 0; i < 4; i++) failed.onTurn({ tokens: 1, outcome: 'error' })
  check('失败的轮次不算进「干完 3 轮」', failed.snapshot().wish.done === false)

  // 没做到：什么都不发生
  const lazy = make({ seed: seedWish('stroke') })
  lazy.act('poke')
  const xpBefore = lazy.snapshot().xp
  advance(24 * HOUR)
  const next = lazy.snapshot()
  check('心愿没做到：第二天换新心愿，羁绊值一分不少', next.xp === xpBefore && next.wish.done === false && next.wish.date !== DAY0, `${xpBefore} → ${next.xp}`)
  check('「过期」的心愿不能在第二天被补做', (() => {
    const b = make({ seed: seedWish('stroke') })
    advance(24 * HOUR)
    b.snapshot()
    return !b.act('stroke').events.some((e) => e.id === 'stroke' && e.type === 'wish')
  })())
  check('坏数据：心愿 id 不认识就当没有，重新选一个', E.normalizeBond({ wish: { date: DAY0, id: 'nope', done: true } }).wish.id === '')
}

// ———— v0.6.2：表情包图鉴（猫咪后院式收集）————
{
  const CAT = Array.from({ length: 10 }, (_, i) => 's' + (i + 1))
  const b = make({ stickers: CAT })
  const s0 = b.snapshot()
  check('图鉴：总数来自清单、一开始是 0', s0.album.total === 10 && s0.album.got === 0 && s0.album.ids.length === 0 && s0.album.milestones.length === ALBUM_MILESTONES.length)
  check('图鉴：乱报的 id 一律拒绝', b.sticker('nope').why === 'unknown' && b.sticker('').why === 'unknown' && b.snapshot().album.got === 0)
  const xp0 = b.snapshot().xp
  const r = b.sticker('s1')
  check('图鉴：第一次见到才收录，+1 羁绊', r.ok && r.isNew && r.snapshot.album.got === 1 && r.snapshot.xp >= xp0 + 1, `xp ${xp0} → ${r.snapshot.xp}`)
  const again = b.sticker('s1')
  check('图鉴：重复上报幂等（不再加分、不再有事件）', again.ok && again.isNew === false && again.events.length === 0 && again.snapshot.album.got === 1)
  check('图鉴：第一个里程碑（总数的 10%）发奖一次', r.events.some((e) => e.type === 'album' && e.title === '图鉴学徒' && e.xp === 3))
  check('图鉴：不算「有互动」（不重置衰减 / 离线计时）', (() => {
    const c = make({ stickers: CAT })
    c.sticker('s1')
    return mem.bond.lastActiveDay === '' && mem.bond.lastSeenAt === 0
  })())

  const d = make({ stickers: CAT })
  let milestones = []
  let albumXp = 0
  for (let i = 1; i <= 10; i++) {
    const rr = d.sticker('s' + i)
    milestones.push(...rr.events.filter((e) => e.type === 'album').map((e) => e.title))
  }
  const sd = d.snapshot()
  check('图鉴：收满 10 张，四个里程碑各发一次', milestones.join(',') === '图鉴学徒,梗学家,梗百科,梗大全', milestones.join(','))
  check('图鉴：集齐解锁「图鉴集齐」回忆，里程碑全部 done', sd.memories.find((m) => m.id === 'album-full').unlockedAt > 0 && sd.album.milestones.every((m) => m.done) && sd.album.got === 10)
  check('图鉴：「新表情包」每日加分有上限（5），里程碑另算', (() => {
    const e = make({ stickers: CAT })
    e.sticker('s1')
    const base = e.snapshot().today.sources.find((x) => x.id === 'album')
    for (let i = 2; i <= 8; i++) e.sticker('s' + i)
    const after = e.snapshot().today.sources.find((x) => x.id === 'album')
    return base.used === 1 && after.used === 5 && after.cap === 5
  })())
  check('图鉴：总开关关掉就不收录', (() => {
    const f = make({ stickers: CAT })
    f.toggle(false)
    return f.sticker('s1').why === 'off' && f.snapshot().album.got === 0
  })())
  check('图鉴：没有清单（没装表情包）= 总数 0，不出里程碑', (() => {
    const g = make()
    return g.snapshot().album.total === 0 && g.sticker('s1').why === 'unknown'
  })())
  check('图鉴：存盘再读回来，收录的还在；清单里没有的旧 id 不计数', (() => {
    const h = make({ stickers: CAT })
    h.sticker('s1')
    h.sticker('s2')
    const raw = JSON.parse(JSON.stringify(mem.bond))
    raw.stickers.ghost = 123
    const h2 = createBond({ read: () => raw, write: () => {}, clock: () => now, stickers: CAT })
    return h2.snapshot().album.got === 2 && h2.snapshot().album.ids.includes('s1') && !h2.snapshot().album.ids.includes('ghost')
  })())

  // v0.6.7：清单从 10 张扩到 25 张（92 → 157 同理）：集齐过的老存档不能再显示「梗大全 ✓」，重新集齐只庆祝、不重复发奖
  {
    const old = make({ stickers: CAT })
    for (let i = 1; i <= 10; i++) old.sticker('s' + i)
    const raw = JSON.parse(JSON.stringify(mem.bond))
    const BIG = CAT.concat(Array.from({ length: 15 }, (_, i) => 'n' + (i + 1)))
    const grown = createBond({ read: () => raw, write: () => {}, clock: () => now, stickers: BIG })
    const sg = grown.snapshot().album
    check('图鉴扩容：老存档集齐过 10/10，扩到 25 张后「梗大全」不再亮，别的按新总数重算', sg.total === 25 && sg.got === 10 && !sg.milestones.find((m) => m.title === '梗大全').done && !sg.milestones.find((m) => m.title === '梗百科').done && sg.milestones.find((m) => m.title === '梗学家').done && sg.milestones.find((m) => m.title === '图鉴学徒').done, JSON.stringify(sg.milestones.map((m) => [m.title, m.need, m.done])))
    check('图鉴扩容：奖励记账（paid）保留，已有回忆不丢', sg.milestones.every((m) => m.paid) && grown.snapshot().memories.find((m) => m.id === 'album-full').unlockedAt > 0)
    const evs = []
    for (let i = 1; i <= 15; i++) evs.push(...grown.sticker('n' + i).events.filter((e) => e.type === 'album'))
    check('图鉴扩容：重新达成 梗百科 / 梗大全 只庆祝、奖励不重复发（xp 0、again）', evs.map((e) => e.title).join(',') === '梗百科,梗大全' && evs.every((e) => e.xp === 0 && e.again === true) && evs[1].full === true, JSON.stringify(evs))
    check('图鉴扩容：重新集齐后全部 done，再报一遍不再有事件', grown.snapshot().album.milestones.every((m) => m.done) && grown.sticker('n1').events.length === 0)
    check('图鉴扩容：没领过奖的新里程碑照常发奖（旧存档 5/25 → 学徒）', (() => {
      const fresh = make({ stickers: BIG })
      const evs2 = []
      for (let i = 1; i <= 3; i++) evs2.push(...fresh.sticker('n' + i).events.filter((e) => e.type === 'album'))
      return evs2.length === 1 && evs2[0].title === '图鉴学徒' && evs2[0].xp === 3 && evs2[0].again === false
    })())
    check('图鉴扩容：旧存档没有 albumPaid 字段时，按「之前达成的都领过」迁移', E.normalizeBond({ albumGot: ['0.1', '0.3'] }).albumPaid.join(',') === '0.1,0.3')
  }

  // 「新表情包」心愿
  const wish = make({ stickers: CAT, seed: seedWish('sticker') })
  check('「新表情包」心愿：看到新图就达成', wish.sticker('s3').events.some((e) => e.type === 'wish' && e.id === 'sticker'))
  const full = make({ stickers: ['x'] })
  full.sticker('x')
  const fullIds = []
  for (let i = 0; i < 20; i++) {
    advance(24 * HOUR)
    fullIds.push(full.snapshot().wish.id)
  }
  check('图鉴集齐后不会再出「新表情包」心愿', !fullIds.includes('sticker'))
}

// ———— v0.6.2：每周回顾 ————
{
  const b = make()
  for (let i = 0; i < 4; i++) b.onTurn({ tokens: 1000, outcome: 'completed' })
  b.act('stroke')
  check('本周统计：轮数 / 摸头 / 有互动的天数', (() => {
    const w = b.snapshot().week
    return w.key === '2026-10-12' && w.turns === 4 && w.strokes === 1 && w.days === 1
  })())
  check('这一周还没过完不给回顾', b.snapshot().recap === null)
  advance(7 * 24 * HOUR)
  const s = b.snapshot()
  check('下周一：上周的统计存成回顾，本周清零', s.recap && s.recap.key === '2026-10-12' && s.recap.turns === 4 && s.week.turns === 0 && s.week.key === '2026-10-19', JSON.stringify(s.recap))
  advance(14 * 24 * HOUR)
  check('隔了几周没来：回顾还是最近一次有互动的那周（空周不会覆盖它）', b.snapshot().recap && b.snapshot().recap.turns === 4)

  const few = make()
  few.onTurn({ tokens: 1, outcome: 'completed' })
  advance(7 * 24 * HOUR)
  check('上周才跑了 1 轮：不特意回顾（至少 3 轮）', few.snapshot().recap === null)
}

// ———— v0.6.2：回忆册扩充 ————
{
  const s = make().snapshot()
  check('回忆册：33 条（新增 2 条服务端 + 9 条共同经历）', s.memories.length === 33 && MEMORIES.length === 33, String(MEMORIES.length))
  const b = make()
  const ids = ['jail', 'this-is-fine', 'clown', 'beg-rice', 'jealous', 'long-think', 'ask-user', 'idle-seen', 'full-trust']
  check('共同经历回忆：前端可以上报（白名单内、幂等）', ids.every((id) => b.memory(id).ok) && ids.every((id) => b.memory(id).events.length === 0))
  check('只有宿主能判定的回忆，前端上报会被拒（first-wish / album-full）', b.memory('first-wish').why === 'forbidden' && b.memory('album-full').why === 'forbidden')
  check('每条新回忆都写了解锁提示和旁白', MEMORIES.every((m) => m.hint && m.text && m.title))
  check('回忆解锁各 +3 羁绊', (() => {
    const c = make()
    const x0 = c.snapshot().xp
    c.memory('jail')
    return c.snapshot().xp === x0 + 3
  })())
}

// ———— 总开关 / 持久化 / brief ————
{
  const b = make()
  b.toggle(false)
  check('总开关关闭：所有加分失效', b.act('poke').why === 'off' && b.feed('rice').why === 'off' && b.onTurn({ tokens: 1, outcome: 'completed' }).events.length === 0)
  b.toggle(true)
  check('重新打开恢复', b.act('poke').delta === 1)
  const c = make()
  c.act('poke')
  const raw = mem.bond
  const d = createBond({ read: () => raw, write: () => {}, clock: () => now })
  check('持久化：写出去再读回来状态一致', d.snapshot().xp === 1 && d.brief().level === 1 && typeof d.brief().mood.label === 'string')
  check('快照可被 JSON 序列化（接口直接返回）', JSON.stringify(d.snapshot()).length > 500)
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`)
process.exit(fail > 0 ? 1 : 0)
