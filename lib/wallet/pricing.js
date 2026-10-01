/**
 * 计价与峰谷：纯函数。
 *   · 高峰 = 北京时间周一至周五（不含法定节假日）9:00–12:00、14:00–18:00；其余一律空闲价
 *   · Flash: 命中 0.02 / 未命中 1 / 输出 4（元每百万 token），高峰 = 空闲 × 2；Pro 为 Flash 的 3 倍价
 */

import { bjDate, HOLIDAYS } from '../calendar.js'

export const PEAK_HOURS = [
  [9, 12],
  [14, 18],
]
const WEEKEND_VALLEY_FROM = Math.floor(Date.UTC(2026, 7, 22, 16, 0, 0) / 1000)
const HOLIDAY_VALLEY_FROM = Math.floor(Date.UTC(2026, 8, 18, 16, 0, 0) / 1000)
/** 元 / 百万 token，数组是 [空闲价, 高峰价] */
export const PRICE = {
  flash: { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
  pro: { hit: [0.15, 0.3], miss: [4.5, 9], out: [13.5, 27] },
}
export function isPeakTime(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n)) return false
  const bj = bjDate(n)
  if (n >= WEEKEND_VALLEY_FROM) {
    const dow = bj.getUTCDay()
    if (dow === 0 || dow === 6) return false
  }
  if (n >= HOLIDAY_VALLEY_FROM && HOLIDAYS.has(bj.toISOString().slice(0, 10))) return false
  const hour = bj.getUTCHours()
  for (const [a, b] of PEAK_HOURS) if (hour >= a && hour < b) return true
  return false
}
/** 下一个峰谷切换时刻（epoch 秒）：扫北京时间的 0/9/12/14/18 点边界，最多往后看 12 天 */
export function nextPeakChangeAt(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n)) return null
  const nowPeak = isPeakTime(n)
  for (let i = 1; i <= 12 * 24; i++) {
    const t = n + i * 3600
    if (isPeakTime(t) !== nowPeak) return t
  }
  return null
}
export function priceTier(model) {
  return /pro/i.test(String(model || '')) ? 'pro' : 'flash'
}
/** 一轮的花费（元）：命中/未命中/输出 三个价目分别算 */
/** customTable 给自定义厂商的「事件匹配」用——传了就绕开内置 PRICE 表。 */
export function costOf(usage, peak, tier, customTable) {
  const p = customTable || PRICE[tier] || PRICE.flash
  const idx = peak ? 1 : 0
  const hit = (Number(usage.hit) || 0) / 1e6 * p.hit[idx]
  const miss = (Number(usage.miss) || 0) / 1e6 * p.miss[idx]
  const out = (Number(usage.out) || 0) / 1e6 * p.out[idx]
  return hit + miss + out
}

/**
 * 自定义单价表——三档（命中/未命中/输出）随便填，不分峰谷（跟峰谷计价
 * 是 DeepSeek 官方特有的概念，自定义厂商不一定有这个规则，峰谷两档给
 * 同一个数字，复用 costOf() 的 [空闲价,高峰价] 结构就不用改它的签名）。
 * 三个价位缺任何一个都当作没配，退回内置 DeepSeek Flash 价目表。
 */
export function customPriceTier(cfg) {
  const c = cfg.walletCustom || {}
  const hit = Number(c.priceHit)
  const miss = Number(c.priceMiss)
  const out = Number(c.priceOut)
  if (![hit, miss, out].every(Number.isFinite)) return null
  const rate = c.priceCurrency === 'USD' ? Number(c.exchangeRate) || 1 : 1
  return {
    hit: [hit * rate, hit * rate],
    miss: [miss * rate, miss * rate],
    out: [out * rate, out * rate],
  }
}
/**
 * 「事件匹配」：给完全没有余额/用量接口可查的厂商兜底（公司内部网关、
 * 或者「无余额接口」那几个厂商）。这一轮用的模型名命中任意一个逗号
 * 分隔的关键字，就退回「真实 token 用量 × 自定义单价」直接算钱。
 */
export function matchesEventKeywords(cfg, model) {
  const kw = (cfg.walletCustom && cfg.walletCustom.eventMatchKeywords) || ''
  if (!kw.trim()) return false
  const m = String(model || '').toLowerCase()
  return kw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((k) => m.includes(k))
}
