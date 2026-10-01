/**
 * 日历工具：本机日历日 / 北京时间日历 / 休息日 / 节日。
 *
 * 两套时间别混用：
 *   · 钱包的峰谷计价按**北京时间**（官方口径，bjDate / bjDay）；
 *   · 好感、问候、饭点这类「每天一次」按**用户本机的一天**（localDay）。
 *
 * ⚠️ 每年国务院公布次年放假安排后，记得往 HOLIDAYS / FESTIVALS 里补下一年的日期。
 */

/** 法定节假日（含与之相连的休息日），格式 YYYY-MM-DD。钱包峰谷与好感衰减共用。 */
export const HOLIDAYS = new Set([
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  '2026-10-05', '2026-10-06', '2026-10-07',
])

/** 好感「双倍日」的节日（当天所有加分 ×2）。相识纪念日另算，见 bond 引擎。 */
export const FESTIVALS = {
  '2026-02-17': '春节',
  '2026-09-25': '中秋',
  '2026-10-01': '国庆',
  '2027-02-06': '春节',
  '2027-09-15': '中秋',
  '2027-10-01': '国庆',
}

const pad2 = (n) => String(n).padStart(2, '0')

/** 按北京时间（UTC+8）读日历。参数是 epoch 秒。 */
export function bjDate(sec) {
  return new Date(Number(sec) * 1000 + 8 * 3600 * 1000)
}

/** 北京时间的「今天」YYYY-MM-DD。 */
export function bjDay(sec = Math.floor(Date.now() / 1000)) {
  return bjDate(sec).toISOString().slice(0, 10)
}

/** 本机日历日 YYYY-MM-DD（参数是 epoch 毫秒，缺省 = 现在）。 */
export function localDay(ts) {
  const d = new Date(ts == null ? Date.now() : ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 把 YYYY-MM-DD 解析成本机当天中午（避开夏令时边界），解析失败返回 null。 */
function dayToDate(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''))
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
}

/** 某天往后（负数往前）挪 n 天。 */
export function addDays(day, n) {
  const d = dayToDate(day)
  if (!d) return day
  d.setDate(d.getDate() + n)
  return localDay(d.getTime())
}

/** 周末？ */
export function isWeekendDay(day) {
  const d = dayToDate(day)
  if (!d) return false
  const w = d.getDay()
  return w === 0 || w === 6
}

/** 休息日 = 周末或法定节假日（不处理调休补班）。 */
export function isOffDay(day) {
  return isWeekendDay(day) || HOLIDAYS.has(day)
}

/** 严格夹在 [from, to) 之间的工作日个数（含 from，不含 to）。from >= to 返回 0。 */
export function workdaysBetween(from, to) {
  if (!from || !to || from >= to) return 0
  let n = 0
  let guard = 0
  for (let d = from; d < to && guard < 4000; d = addDays(d, 1), guard++) {
    if (!isOffDay(d)) n++
  }
  return n
}

/** 两个日历日之间隔了几天（to - from，整天数）。 */
export function daysBetween(from, to) {
  const a = dayToDate(from)
  const b = dayToDate(to)
  if (!a || !b) return 0
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}
