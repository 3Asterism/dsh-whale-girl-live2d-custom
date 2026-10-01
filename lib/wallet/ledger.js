/**
 * 记账账本（整数金额单位 + 按 scope 分本 + 不认乱序观测）。
 * 参考 dsh-whale-widget 的 lib/accounting.mjs，详见各函数注释。
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DSH_HOME } from '../paths.js'
import { bjDay } from '../calendar.js'

const MONEY_SCALE = 100000000
export function moneyUnits(value) {
  const n = Number(value)
  const units = Math.round(n * MONEY_SCALE)
  return Number.isFinite(n) && Number.isSafeInteger(units) ? units : null
}
export function preciseMoney(units) {
  return units / MONEY_SCALE
}
const USAGE_FILE_CANDIDATES = [
  path.join(DSH_HOME, '.dsh-live2d-pet-usage.json'),
  path.join(DSH_HOME, 'profiles', 'web', '.dsh-live2d-pet-usage.json'),
]
// 账本格式版本号：跟旧版（v1，扁平 startBalance/consumedTotal，没有
// version 字段）区分开。旧文件读到时 version 对不上，当空账本处理，
// 不做迁移——那条记录只是「今天已经花了多少」的展示缓存，丢了不影响
// 余额本身，硬迁移反而容易把上面说的那个坑原样搬进新格式里。
const LEDGER_VERSION = 2
export function readLedger() {
  for (const p of USAGE_FILE_CANDIDATES) {
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (parsed && parsed.version === LEDGER_VERSION && parsed.books) return parsed
    } catch (err) {}
  }
  return { version: LEDGER_VERSION, books: {} }
}
export function writeLedger(ledger) {
  const body = JSON.stringify(ledger)
  for (const p of USAGE_FILE_CANDIDATES) {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, body, 'utf8')
      return true
    } catch (err) {}
  }
  return false
}
/**
 * 记一次余额观测，原地改 ledger。同一个 scope 里只认比上次观测更晚的
 * 样本（`at`），跟当前或更早的直接丢弃（乱序/并发重复请求）。余额变少
 * 记 debit（今天的消耗），变多记 credit 但不倒扣 debit——充值不会把
 * 今天已经花掉的历史清零，跟旧版「基线滑到新余额」是一个意思。
 * 返回「今天已经花了多少」（这个 scope 这一天的 debit 总和）。
 */
export function observeBalance(ledger, { scope, day, currency, balance, at }) {
  const units = moneyUnits(balance)
  if (units === null) return null
  ledger.books ||= {}
  let book = ledger.books[scope]
  if (!book) book = ledger.books[scope] = { currency, days: {} }
  book.currency = currency
  if (book.lastAt != null && at <= book.lastAt) {
    const row = book.days[day]
    return row ? preciseMoney(row.debitUnits) : 0
  }
  book.lastAt = at
  let row = book.days[day]
  if (!row) {
    // 这个 scope 今天第一次被观测到——不知道「今天开始时」的余额是多少，
    // 只能把这次当起点，今日已用先记 0（跟旧版行为一致：没法回溯出
    // 观测窗口之前的消费，这是余额差分法本身的天然局限，不是这次改动
    // 引入的新问题）。
    book.days[day] = { firstAt: at, lastAt: at, lastUnits: units, debitUnits: 0, creditUnits: 0 }
    return 0
  }
  const delta = row.lastUnits - units
  if (delta > 0) row.debitUnits += delta
  else row.creditUnits += -delta
  row.lastUnits = units
  row.lastAt = at
  return preciseMoney(row.debitUnits)
}
/** 算「今天已经花了多少」；scope 由 fetchBalanceNow() 按厂商 + 凭据/账号
 *  身份算，见 scopeOf()——换取数路径不会把旧账本的数字带歪。 */
export function computeTodayUsage(scope, balance, currency) {
  const day = bjDay()
  const ledger = readLedger()
  const amount = observeBalance(ledger, { scope, day, currency, balance, at: Date.now() })
  writeLedger(ledger)
  return amount || 0
}
/** 账本 scope：按「厂商 + 这把凭据/这个账号的身份」分本。凭据只存哈希的
 *  前 16 位（不是为了防破解，是不想把真实 key 明文抄进记账文件里）。 */
export function scopeOf(providerLabel, identity) {
  const tag = createHash('sha256').update(String(identity || 'unknown')).digest('hex').slice(0, 16)
  return String(providerLabel || 'unknown') + ':' + tag
}
