/**
 * 钱包服务：余额缓存 + 取数（API key / DSH 账号登录态）+ 今日用量 + 快照。
 * 为什么自己做而不是读 dsh-whale-widget：那个插件是可选的，主人可能停用它；桌宠自己会算，才到哪都能用。
 */

import { readConfig } from '../config.js'
import { VERSION } from '../paths.js'
import { bjDay } from '../calendar.js'
import { activeProvider, buildAuthHeader, getPath } from './providers.js'
import { computeTodayUsage, scopeOf } from './ledger.js'
import { isPeakTime, nextPeakChangeAt } from './pricing.js'

/** @param ctx cordis 上下文（用来读凭据服务 / DSH 账号服务） */
export function createWallet(ctx) {
  const todayKey = () => bjDay()

  /** 余额缓存（60 秒）——不缓存的话，每轮结束都打一次官方接口 */
  const wallet = {
    balanceAt: 0,
    balance: null,
    balanceErr: '',
    lastTurn: null,
    turnSeq: 0,
    today: { date: '', amount: 0, tokens: 0 },
    keyWarned: false,
  }

  /** 读凭据：优先问 DSH 的凭据服务，其次看同名环境变量。 */
  async function resolveCredential(name) {
    if (!name) return ''
    try {
      const cred = ctx.get('credentials')
      if (cred && typeof cred.resolve === 'function') {
        const c = await cred.resolve(name)
        if (c && c.value) return String(c.value)
      }
    } catch (err) {
      if (!wallet.keyWarned) {
        wallet.keyWarned = true
        try {
          console.warn(`[live2d-pet] 读不到凭据服务里的 ${name}：` + String((err && err.message) || err).slice(0, 120))
        } catch (e) {}
      }
    }
    return process.env[name] || ''
  }

  /**
   * DSH 账号登录态的余额路径（参考 dsh-whale-widget 的实现——它装上就能用，
   * 这个插件之前没有，就是差在这）。只通过 DSH 账号登录、没有单独配
   * API key 的用户，余额在 DeepSeek 平台的账号接口上，不在 /user/balance
   * 这条 API key 专用的路上。
   * **不自己拼 HTTP**：token 注入、请求头、失效清理全部由 DSH 的
   * `deepseekAccount` 服务负责，这里只读它给的结果。
   * ⚠️ 必须用 `ctx.get('deepseekAccount')` 读**可选服务**，绝不能当成
   *   必需依赖——老版本 DSH 主机根本没有这个服务，写成硬依赖会导致插件
   *   在老主机上直接加载不了（比"没有余额"严重得多）。
   * ⚠️ 只给「DeepSeek 官方」这个厂商用；跟 API key 那条路互不干扰，
   *   API key 优先——用户显式配了凭据就用凭据，没配才退回账号登录态。
   */
  async function fetchAccountBalance() {
    let account = null
    try {
      account = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : null
    } catch (err) {
      account = null
    }
    if (!account || typeof account.getBalance !== 'function') return null
    // 账户标识：优先用账号服务给的稳定 id（不同账号登录 → 不同记账本，
    // 参考 dsh-whale-widget；取不到就退回固定标识，至少跟 API key 路径
    // 分得开）。
    let accountId = null
    try {
      const state = typeof account.getState === 'function' ? account.getState() : null
      accountId = (state && (state.userId || (state.profile && state.profile.userId))) || null
    } catch (err) {
      accountId = null
    }
    let result
    try {
      result = await account.getBalance({
        version: String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '') || 'unknown',
        locale: String(process.env.DSH_LOCALE || '') || 'zh_CN',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      })
    } catch (err) {
      return null
    }
    // 未登录 / 没有 grant / 平台失败 → 一律返回 null，让调用方退回原来的
    // 文案（不缓存错误，跟 API key 路径的处理方式保持一致）。
    if (!result || result.status !== 'ready' || !Array.isArray(result.value) || result.value.length === 0) return null
    const accNum = (v) => {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    const wallets = result.value.filter((w) => w && accNum(w.balance) !== null)
    if (wallets.length === 0) return null
    const currency = wallets.some((w) => String(w.currency || '').toUpperCase() === 'CNY')
      ? 'CNY'
      : String((wallets[0] && wallets[0].currency) || 'CNY').toUpperCase()
    const sumOf = (list) =>
      (Array.isArray(list) ? list : [])
        .filter((w) => w && String(w.currency || 'CNY').toUpperCase() === currency && accNum(w.balance) !== null)
        .reduce((s, w) => s + Number(w.balance), 0)
    const recharge = sumOf(result.value)
    const bonus = sumOf(result.bonusWallets)
    return {
      ok: true,
      // 充值 + 赠金：跟 API key 路径的 total_balance 同口径（那个字段
      // 本身也是两者相加），否则「按余额差」推算的今日已用会偏小。
      totalBalance: Number((recharge + bonus).toFixed(6)),
      currency,
      provider: 'DeepSeek（账号登录）',
      limit: null, // 账号登录态没有「额度上限」这个字段，配额环不显示
      updatedAt: new Date().toISOString(),
      scope: scopeOf('deepseek-account', accountId === null ? 'default' : String(accountId)),
    }
  }

  /**
   * 同一时间只放一个真实请求在飞，其余调用方等同一个 promise——不然
   * turn/start、turn/end、前端 HUD 轮询三路并发调用，会同时打好几个请求
   * 给 DeepSeek，谁先回来谁后回来完全不确定：慢的那个如果恰好失败了，
   * 会把快的那个刚写进去的成功结果覆盖掉，表现就是「余额一会儿有一会儿
   * 变横杠」。参考 dsh-whale-widget 的 balanceInFlight 写法。
   */
  let balanceInFlight = null
  /**
   * @param force 强制重查（绕过 60 秒缓存）
   * @param maxAgeMs 只对 force 有意义：上一次**成功**的结果不超过这么久，就当它够新、不再打接口。
   *   一轮结束时刚强制拉过一次，紧接着下一轮开始又强制拉一次当「起点余额」，两次之间往往只隔几秒、余额根本没变——
   *   白白多一次对 DeepSeek 的请求。起点余额只要「不早于上一轮结束」就行（旧缓存的坑是几十秒~几分钟前的数，这里只放宽到几秒）。
   */
  function fetchBalance(force, maxAgeMs) {
    const now = Date.now()
    if (!force && wallet.balance && now - wallet.balanceAt < 60000) return Promise.resolve(wallet.balance)
    if (force && maxAgeMs > 0 && wallet.balance && wallet.balance.ok && now - wallet.balanceAt < maxAgeMs) {
      return Promise.resolve(wallet.balance)
    }
    if (balanceInFlight) return balanceInFlight
    balanceInFlight = fetchBalanceNow().finally(() => {
      balanceInFlight = null
    })
    return balanceInFlight
  }
  async function fetchBalanceNow() {
    const now = Date.now()
    const cfg = readConfig()
    const provider = activeProvider(cfg)
    if (!provider.balanceUrl || !provider.credentialKey) {
      wallet.balance = {
        ok: false,
        code: 'NO_PROVIDER',
        error: provider.label === '自定义'
          ? '自定义记账厂商没配完整：walletCustom.balanceUrl 和 walletCredentialKey 都要填'
          : '记账厂商配置异常',
      }
      wallet.balanceAt = now
      return wallet.balance
    }
    const key = await resolveCredential(provider.credentialKey)
    if (!key) {
      // DeepSeek 官方厂商没配 API key 凭据时，退回 DSH 账号登录态的余额
      // （参考 dsh-whale-widget，它装上就能用，差的就是这条路）；
      // OpenRouter/自定义厂商没有账号登录这条路可退，直接报 NO_KEY。
      if (cfg.walletProvider === 'deepseek') {
        const accountPayload = await fetchAccountBalance()
        if (accountPayload) {
          wallet.balance = accountPayload
          wallet.balanceAt = now
          if (Number.isFinite(accountPayload.totalBalance)) {
            const k = todayKey()
            const amount = computeTodayUsage(accountPayload.scope, accountPayload.totalBalance, accountPayload.currency)
            wallet.today = { date: k, amount, tokens: wallet.today.date === k ? wallet.today.tokens : 0 }
          }
          return wallet.balance
        }
      }
      wallet.balance = {
        ok: false,
        code: 'NO_KEY',
        error: cfg.walletProvider === 'deepseek'
          ? `没配置 ${provider.credentialKey}，且账号余额不可用（未登录 DeepSeek 账号，或该账号没有余额钱包）`
          : `没配置 ${provider.credentialKey}`,
      }
      wallet.balanceAt = now
      return wallet.balance
    }
    try {
      const headers = buildAuthHeader(provider.authHeaderTemplate, key)
      const res = await fetch(provider.balanceUrl, { headers, signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const j = await res.json()
      const parsed = provider.parse(j) || {}
      const totalBalance = parsed.totalBalance
      const currency = parsed.currency || 'CNY'
      wallet.balance = {
        ok: true,
        totalBalance,
        currency,
        provider: provider.label,
        // 额度上限——没有就是 null，前端拿它算「配额环」的百分比，
        // null 就整个不显示这个环（按量计费的厂商没有这个概念）
        limit: typeof parsed.limit === 'number' && Number.isFinite(parsed.limit) ? parsed.limit : null,
        updatedAt: new Date().toISOString(),
      }
      // 独立的用量接口（跟余额接口分开查）：配了就单独打一次，拿到的数字
      // 直接当「今日已用」，不走余额差分；这一步失败不影响余额已经查到的结果。
      let usageFromEndpoint = null
      if (provider.usageUrl) {
        try {
          const ures = await fetch(provider.usageUrl, { headers, signal: AbortSignal.timeout(8000) })
          if (ures.ok) {
            const uj = await ures.json()
            const raw = Number(getPath(uj, provider.usagePath))
            if (Number.isFinite(raw)) usageFromEndpoint = raw * (provider.usageMultiplier || 1)
          }
        } catch (err) {
          /* 用量接口失败不影响余额已经查到的结果，静默丢弃 */
        }
      }
      if (Number.isFinite(totalBalance)) {
        const k = todayKey()
        // 优先级：独立用量接口 > 厂商直接给的 todayUsage（比如 OpenRouter
        // 的 usage_daily）> 都没有就退回余额差分算，跟以前行为一致。
        const amount =
          usageFromEndpoint != null
            ? usageFromEndpoint
            : typeof parsed.todayUsage === 'number' && Number.isFinite(parsed.todayUsage)
              ? parsed.todayUsage
              : computeTodayUsage(scopeOf(provider.label, key), totalBalance, currency)
        wallet.today = { date: k, amount, tokens: wallet.today.date === k ? wallet.today.tokens : 0 }
      }
    } catch (err) {
      // 拿不到就沿用上一次的数字（标 stale），别让 HUD 变空
      const msg = String((err && err.message) || err).slice(0, 160)
      wallet.balance = wallet.balance && wallet.balance.ok
        ? Object.assign({}, wallet.balance, { stale: true, error: msg })
        : { ok: false, code: 'ERROR', error: msg }
    }
    wallet.balanceAt = now
    return wallet.balance
  }

  /** 今日 token 数：这个还是只能靠事件累加（余额接口不返回 token 数），
   * 拿不到事件数据时就是 0，纯展示用，不影响「今日已用」的金额（那个走余额差分）。 */
  function addTodayTokens(tokens) {
    const k = todayKey()
    if (wallet.today.date !== k) wallet.today = { date: k, amount: wallet.today.amount, tokens: 0 }
    wallet.today.tokens += Number(tokens) || 0
  }

  /** 钱包部分的快照（余额 / 峰谷 / 本轮 / 今日）。陪伴统计由 hud 路由另行拼进 stats。 */
  function snapshot() {
    const nowSec = Math.floor(Date.now() / 1000)
    return {
      ok: true,
      version: VERSION,
      source: 'dsh-live2d-pet',
      isPeak: isPeakTime(nowSec),
      peakNextChangeAt: nextPeakChangeAt(nowSec),
      balance: wallet.balance,
      today: { date: wallet.today.date, amount: wallet.today.amount, tokens: wallet.today.tokens },
      turn: wallet.lastTurn,
      priceTier: 'flash',
      priceNote: 'Flash 空闲 0.02/1/4・高峰 ×2（元每百万 token）',
    }
  }

  return {
    wallet,
    fetchBalance,
    addTodayTokens,
    snapshot,
    /** 配置变了（比如换了记账厂商）：下一次拉余额强制重查，不然会一直显示上一个厂商的缓存。 */
    invalidate() {
      wallet.balanceAt = 0
    },
  }
}
