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

/**
 * 原子写：先写同目录的临时文件，再 rename 覆盖。
 * 直接 writeFileSync 是「先截断、再写」——写到一半进程被杀 / 断电，文件就是半截 JSON，read() 解析失败会当成
 * 「今天刚认识」，陪伴天数 / 累计 token / 羁绊等级全部归零。rename 在同一个卷上是原子的：要么是旧的、要么是新的完整文件。
 * Windows 上目标文件被杀软 / 索引器短暂占着时 rename 会失败（EPERM / EBUSY），那就退回直接写——不比以前更差。
 */
export function writeAtomic(file, text) {
  const tmp = file + '.tmp'
  try {
    fs.writeFileSync(tmp, text, 'utf8')
    fs.renameSync(tmp, file)
  } catch (err) {
    fs.writeFileSync(file, text, 'utf8')
    try {
      fs.unlinkSync(tmp)
    } catch (e) {}
  }
}

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

  /** 上一次真正写进文件的内容。内容没变就不落盘（见 save）。 */
  let lastWritten = null

  function save() {
    try {
      // 羁绊的「读」操作（snapshot / brief——每次打开 HUD、每轮结束、每 10 分钟刷新都会调）也会经过这里，
      // 它们绝大多数时候没改任何东西。以前照样同步 writeFileSync 一遍，卡在 DSH 宿主的事件循环上
      // （实测每次约 0.5ms，Windows 上有杀软扫描时会更久）。内容相同就跳过。
      const text = JSON.stringify(get())
      if (text === lastWritten) return
      fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true })
      writeAtomic(STATS_FILE, text)
      lastWritten = text
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
