/** 记账厂商表：去哪个凭据名读 key、查余额的 URL、怎么解析响应。 */

/** 属性路径取值，给 walletProvider = 'custom' 用。支持点号和数组下标混用，
 *  比如 "balance_infos[0].total_balance"：先把 `[n]` 转成 `.n` 再按点号拆，
 *  字符串下标 '0' 取数组元素在 JS 里跟数字下标是一回事，不用分开处理。 */
export function getPath(obj, path) {
  if (!path) return undefined
  const tokens = String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  return tokens.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)
}

/**
 * 记账厂商表。DSH 自己的「新增模型（自定义 API）」界面已经能配出
 * OpenRouter 这类厂商（截图：厂商模板 OpenRouter、凭据名
 * OPENROUTER_API_KEY）——这边跟着认，不用等哪天真的切过去了才临时改代码。
 *
 * 每个厂商：去哪个凭据名读 key、查余额的 URL、怎么从响应 JSON 里解析出
 * {totalBalance, currency, todayUsage}。todayUsage 给不出的（比如 DeepSeek
 * 官方接口就没有这个字段）返回 null，上层会自动退回余额差分算「今日已用」。
 */
/** 请求头模板 → 实际的 fetch headers。目前只接管 Authorization 头——
 *  绝大部分厂商都是 Bearer 认证，真遇到用别的头名的厂商再加。 */
export function buildAuthHeader(template, key) {
  return { Authorization: (template || 'Bearer {key}').replace('{key}', key) }
}

export const WALLET_PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    credentialKey: 'DEEPSEEK_API_KEY',
    balanceUrl: 'https://api.deepseek.com/user/balance',
    authHeaderTemplate: 'Bearer {key}',
    parse(json) {
      const info = (json && json.balance_infos && json.balance_infos[0]) || {}
      const totalBalance = Number(info.total_balance)
      return {
        totalBalance: Number.isFinite(totalBalance) ? totalBalance : null,
        currency: info.currency || 'CNY',
        todayUsage: null,
        limit: null, // 按量计费，没有「额度上限」这个概念，配额环不显示
      }
    },
  },
  // 官方 /api/v1/key：普通 API key 就能查（不需要 management key），
  // 直接给 limit_remaining（剩余额度）和 usage_daily（今日已用），
  // 比 DeepSeek 官方接口方便——不用自己拿余额差分算「今日已用」。
  // limit 是这个 key 的消费上限（null = 不限），配额环用它算百分比。
  openrouter: {
    label: 'OpenRouter',
    credentialKey: 'OPENROUTER_API_KEY',
    balanceUrl: 'https://openrouter.ai/api/v1/key',
    authHeaderTemplate: 'Bearer {key}',
    parse(json) {
      const d = (json && json.data) || json || {}
      const remaining = Number(d.limit_remaining)
      const dailyUsage = Number(d.usage_daily)
      const limit = Number(d.limit)
      return {
        totalBalance: Number.isFinite(remaining) ? remaining : null,
        currency: 'USD',
        todayUsage: Number.isFinite(dailyUsage) ? dailyUsage : null,
        limit: Number.isFinite(limit) ? limit : null,
      }
    },
  },
}

/**
 * 当前生效的记账厂商：配置里没写就是 DeepSeek（零配置，跟以前行为一致）。
 * 'custom' 分支字段设计照抄 DSH 自己「新增模型（自定义 API）」→「接口
 * 与字段（高级）」那个界面，见 DEFAULT_CONFIG.walletCustom 的注释。
 */
export function activeProvider(cfg) {
  if (cfg.walletProvider === 'custom') {
    const c = cfg.walletCustom || {}
    const mul = Number(c.valueMultiplier) || 1
    return {
      label: '自定义',
      credentialKey: cfg.walletCredentialKey || '',
      balanceUrl: c.balanceUrl || '',
      authHeaderTemplate: c.authHeaderTemplate || 'Bearer {key}',
      // 独立的第二段用量接口，fetchBalanceNow() 会另外单独打一次
      usageUrl: c.usageUrl || '',
      usagePath: c.usagePath || '',
      usageMultiplier: Number(c.usageMultiplier) || 1,
      parse(json) {
        // 模式 A：直接给「剩余」；模式 B：给「总量」和「已用」，算差值
        let totalBalance = null
        if (c.totalBalancePath) {
          const v = Number(getPath(json, c.totalBalancePath))
          if (Number.isFinite(v)) totalBalance = v * mul
        } else if (c.totalPath && c.usedPath) {
          const total = Number(getPath(json, c.totalPath))
          const used = Number(getPath(json, c.usedPath))
          if (Number.isFinite(total) && Number.isFinite(used)) totalBalance = (total - used) * mul
        }
        const limit = Number(getPath(json, c.limitPath))
        return {
          totalBalance,
          currency: c.currency || 'USD',
          todayUsage: null, // 走独立用量接口，不在这里解析
          limit: Number.isFinite(limit) ? limit * mul : null,
        }
      },
    }
  }
  const p = WALLET_PROVIDERS[cfg.walletProvider] || WALLET_PROVIDERS.deepseek
  return cfg.walletCredentialKey ? Object.assign({}, p, { credentialKey: cfg.walletCredentialKey }) : p
}
