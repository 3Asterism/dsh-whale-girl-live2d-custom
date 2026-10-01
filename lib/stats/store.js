/**
 * 统计存储：陪伴天数 / 累计轮次 / token / 每日 token 与轮数 / 「谁先到谁领」的记录 / 羁绊（bond）原始数据。
 * 全部放在同一个 JSON 文件里（STATS_FILE），双端（网页 / 桌面壳）共用。
 */

import fs from 'node:fs'
import path from 'node:path'
import { STATS_FILE } from '../paths.js'
import { localDay } from '../calendar.js'
import { RICE } from '../bond/constants.js'

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

export function createStatsStore() {
  let cache = null

  /** 读累计统计；坏了 / 没有就当作「今天刚认识」，不是什么严重错误。旧文件缺的新字段补默认值。 */
  function read() {
    let p = null
    try {
      p = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'))
    } catch (err) {}
    if (!p || typeof p !== 'object') p = {}
    return {
      firstSeenAt: Number(p.firstSeenAt) || 0,
      totalTurns: Number(p.totalTurns) || 0,
      totalTokens: Number(p.totalTokens) || 0,
      dayTokens: obj(p.dayTokens), // { 'YYYY-MM-DD': tokens }，只留最近 8 天
      dayTurns: obj(p.dayTurns), // { 'YYYY-MM-DD': 轮数 }，同上
      claims: obj(p.claims), // { key: 'YYYY-MM-DD' | 'forever' }
      bond: p.bond && typeof p.bond === 'object' ? p.bond : undefined, // 羁绊原始数据，由 lib/bond 规整
    }
  }

  function get() {
    return cache || (cache = read())
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true })
      fs.writeFileSync(STATS_FILE, JSON.stringify(get()), 'utf8')
    } catch (err) {}
  }

  /** 每轮结束调一次：没有起始时间就记今天，轮次 / token 累计各加一份，并记入当天。 */
  function bump(tokens) {
    const s = get()
    if (!s.firstSeenAt) s.firstSeenAt = Date.now()
    const t = Number(tokens) || 0
    s.totalTurns += 1
    s.totalTokens += t
    const today = localDay()
    s.dayTokens[today] = (Number(s.dayTokens[today]) || 0) + t
    s.dayTurns[today] = (Number(s.dayTurns[today]) || 0) + 1
    for (const bag of [s.dayTokens, s.dayTurns]) {
      const keys = Object.keys(bag).sort()
      while (keys.length > 8) delete bag[keys.shift()]
    }
    save()
    return s
  }

  /** 「谁先到谁领」：day = 今天只能领一次，forever = 一辈子一次（里程碑）。 */
  function claim(key, scope) {
    if (!/^[a-zA-Z0-9:_-]{1,48}$/.test(String(key))) return false
    const s = get()
    const today = localDay()
    const cur = s.claims[key]
    if (scope === 'forever') {
      if (cur === 'forever') return false
      s.claims[key] = 'forever'
    } else {
      if (cur === today) return false
      s.claims[key] = today
    }
    // 每日型的记录只在当天有意义，攒多了就把过期的清掉
    const names = Object.keys(s.claims)
    if (names.length > 150) for (const n of names) if (s.claims[n] !== 'forever' && s.claims[n] !== today) delete s.claims[n]
    save()
    return true
  }

  /** 「陪你干活第 N 天」——从第一次见面那天算起，当天也算第 1 天。 */
  function companionDays() {
    const first = get().firstSeenAt
    if (!first) return 0
    return Math.max(1, Math.floor((Date.now() - first) / 86400000) + 1)
  }

  /** 今天 / 昨天的轮数与「饭量」（1 碗 = RICE.tokensPerBowl token）。 */
  function dayStats() {
    const s = get()
    const today = localDay()
    const yest = localDay(Date.now() - 86400000)
    return {
      turnsToday: Number(s.dayTurns[today]) || 0,
      riceToday: Math.floor((Number(s.dayTokens[today]) || 0) / RICE.tokensPerBowl),
      riceYesterday: Math.floor((Number(s.dayTokens[yest]) || 0) / RICE.tokensPerBowl),
    }
  }

  return {
    get,
    save,
    bump,
    claim,
    companionDays,
    dayStats,
    /** 羁绊原始数据：读（可能是 undefined）/ 写。 */
    bondRaw: () => {
      const s = get()
      return s.bond ? s.bond : { firstSeenAt: s.firstSeenAt || undefined }
    },
    setBond: (b) => {
      get().bond = b
      save()
    },
  }
}
