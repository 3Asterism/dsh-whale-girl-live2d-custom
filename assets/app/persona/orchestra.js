/**
 * persona/orchestra.js —— 「观察者」发言的编排：**她看懂了、想说，但什么时候说、说不说，由这里一道道闸决定**。纯函数，Node 里能直接单测。
 *
 * 「观察者」= 她自己看出来的话（复合故事的补充、安慰、重来提醒……），区别于「正常互动」（戳她 / 摸头 / 关键词 / 点界面 / 报错 / 批准 / 收工）。
 * 铁律：**观察者永远不挤占正常互动**——
 *   1. 中途不说：只在 agent 空闲（任务边界）时说；一轮里的命令结果只记账；
 *   2. 一次只留一条待说（槽位）：新来的价值更高才替换，会过期、不补播；
 *   3. 说之前过闸（blockedReason）：安静档不说、你在打字、刚点过她、有提问 / 批准在等、番茄钟专注、气泡被占着、她正在演别的、面板开着，都不说；
 *   4. 配额：两次发言至少隔 GAP_MS；每小时有上限（普通档 6 / 话痨档 12）；
 *   5. 优先级低于一切正常互动：真说出口时用 CUE 级，后来的任何正常互动（同级后来者赢，更高级更是）都能顶掉它，它顶不掉别人；
 *   6. 例外只有一个：高风险的关心（care，自伤倾向）不受配额和多数闸的限制，只避开「正在等你点按钮」的提问。
 */

export const GAP_MS = 90_000
export const HOURLY_CAP = { 1: 6, 2: 12 }
const HOUR_MS = 3_600_000

/**
 * @param ctx { chatLevel, idle, hidden, panelOpen, bubbleVisible, asking, performing, pomoFocus, approval, danger, streaming, typingMs, sinceUserMs }
 * @param c 候选 { kind: 'care' | 'comfort' | 'note', tier: 'extra' | 'chatty' }
 * @returns 被拦的原因（字符串），或 null = 可以说
 */
export function blockedReason(ctx, c) {
  if (c.kind === 'care') return ctx.asking ? 'ask' : null
  if (!(ctx.chatLevel >= 1)) return 'quiet'
  if (c.tier === 'chatty' && ctx.chatLevel < 2) return 'tier'
  if (!ctx.idle) return 'busy'
  if (ctx.hidden) return 'hidden'
  if (ctx.panelOpen) return 'panel'
  if (ctx.asking) return 'ask'
  if (ctx.bubbleVisible) return 'bubble'
  if (ctx.performing) return 'performing'
  if (ctx.pomoFocus) return 'focus'
  if (ctx.approval || ctx.danger) return 'approval'
  if (ctx.streaming) return 'stream'
  if (ctx.typingMs < 5000) return 'typing'
  if (ctx.sinceUserMs < 12_000) return 'recentUser'
  return null
}

export function createOrchestrator() {
  let slot = null
  let lastSpoke = -Infinity
  let hist = []
  const api = {
    /** 递一个候选：槽里已有更高（或一样高）价值且没过期的，就不替换。返回是否收下。 */
    offer(c, now) {
      if (slot && now < slot.expires && slot.value >= (c.value || 0)) return false
      slot = { value: 0, ttlMs: 90_000, ...c, at: now, expires: now + (c.ttlMs || 90_000) }
      return true
    },
    pending(now) {
      return !!slot && now < slot.expires
    },
    /**
     * 现在能说吗？返回 { go: 候选 } / { wait: 原因 } / null（槽是空的或已过期）。
     * 不改状态——真说出口了再调 spoke()。
     */
    take(now, ctx) {
      if (!slot) return null
      if (now >= slot.expires) {
        slot = null
        return null
      }
      const reason = blockedReason(ctx, slot)
      if (reason) return { wait: reason }
      if (slot.kind !== 'care') {
        if (now - lastSpoke < GAP_MS) return { wait: 'gap' }
        hist = hist.filter((t) => now - t < HOUR_MS)
        if (hist.length >= (HOURLY_CAP[ctx.chatLevel] || 0)) return { wait: 'cap' }
      }
      return { go: slot }
    },
    /** 她真的说了（观察者发言，或顶替默认收工的复合故事）：记配额、清槽。 */
    spoke(now, opts = {}) {
      lastSpoke = now
      if (!opts.care) hist.push(now)
      slot = null
    },
    clear() {
      slot = null
    },
    reset() {
      slot = null
      lastSpoke = -Infinity
      hist = []
    },
    stats(now) {
      return { pending: api.pending(now), lastSpoke, lastHour: hist.filter((t) => now - t < HOUR_MS).length }
    },
  }
  return api
}
