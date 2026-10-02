/**
 * ui/sticker-pick.js —— 表情包选图与时长规则：**纯函数，不碰 DOM / 配置**，Node 里能直接单测（tools/test-stickers.mjs）。
 *
 * 两条铁律（写在这里，别再绕回去）：
 *   1) 气泡停留多久由「台词」决定，表情包**不许把气泡拖长**——短台词挂一张 1.6s 的图就多占页面，干活时很烦。
 *      所以不是「气泡迁就 GIF」，而是「GIF 迁就气泡」，用三招把「半圈被砍」压低：
 *        · 选图时按时长过滤：只挑 一圈时长 ≤ ttl + SNAP_MS 的图，没有够短的就不挂；
 *        · 极小吸附：到点时当前圈只差 ≤ SNAP_MS 就播完，才多等这一小会儿，否则直接收；
 *        · 兜底淡出：没播完的随气泡一起淡出（样式在 styles.js）。
 *   2) **覆盖优先**：绝大部分台词都该有图，只有实在没法适配才不配。所以「近期用过」只影响偏好，不会让它变成「不挂」——
 *      候选都近期用过时，改选最久没用的那张（LRU），而不是返回空。
 *      常驻气泡（工具调用 / 开工 / 思考，一轮里会反复出现）才用 gapMs 节流，免得干活时图一直在换。
 */

/** 吸附上限：最多为了让 GIF 播完当前圈而多挂这么久（毫秒）。 */
export const SNAP_MS = 400
/** 同一张图 90 秒内不重复（只是偏好：候选都近期用过时选最久没用的）。 */
export const REPEAT_MS = 90 * 1000
/** 常驻气泡里的图最多播几圈 / 最多挂多久。 */
export const STICKY_LOOPS = 2
export const STICKY_MAX_MS = 4000
/** 独立表情包（无台词）的停留时间夹在这个范围里。 */
export const SOLO_MIN_MS = 1800
export const SOLO_MAX_MS = 3200

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

/** 独立表情包停留多久：一圈 + 300ms，夹在 [1.8s, 3.2s]。 */
export const soloTtl = (loopMs) => clamp(loopMs + 300, SOLO_MIN_MS, SOLO_MAX_MS)

/** 常驻气泡里的图挂多久：最多 2 圈、不超过 4s。 */
export const stickyMs = (loopMs) => Math.min(STICKY_LOOPS * loopMs, STICKY_MAX_MS)

/**
 * 到点收气泡时，要不要多等一小会儿让当前圈播完：只差 ≤ SNAP_MS 才等，否则 0。
 * @param ttl 气泡本来要停留的毫秒数
 * @param loopMs GIF 一圈的毫秒数
 */
export function snapExtra(ttl, loopMs) {
  if (!(ttl > 0) || !(loopMs > 0)) return 0
  const rem = ttl % loopMs
  if (rem === 0) return 0
  const left = loopMs - rem
  return left <= SNAP_MS ? left : 0
}

/**
 * 按优先级收集候选池（高优先级在前）：
 *   显式 sticker → 显式 pool → 事件（say / id）→ 台词括号动作词 → mood → 兜底（有台词时）
 * 兜底池只给「没法按事件 / 动作 / 情绪归类的台词」用，保证绝大部分台词都有图；spec.fallback === false 可关掉。
 */
export function resolvePools(spec, data) {
  const pools = []
  if (spec.sticker) pools.push(Array.isArray(spec.sticker) ? spec.sticker : [spec.sticker])
  if (spec.pool) pools.push(spec.pool)
  for (const key of [spec.say, spec.id]) {
    if (key && data.EVENT_STICKER[key]) pools.push(data.EVENT_STICKER[key])
  }
  if (spec.line) {
    const parens = String(spec.line).match(/（[^）]{1,12}）/g) || []
    for (const p of parens) {
      for (const [re, pool] of data.ACTION_STICKER) {
        if (re.test(p)) {
          pools.push(pool)
          break
        }
      }
    }
  }
  if (spec.mood && data.MOOD_STICKER[spec.mood]) pools.push(data.MOOD_STICKER[spec.mood])
  if (spec.line && spec.fallback !== false && data.FALLBACK_STICKER) pools.push(data.FALLBACK_STICKER)
  return pools
}

/**
 * 从一个候选池里挑一张。
 * @param ctx.manifest id → { ms }
 * @param ctx.ttl 气泡打算停留的毫秒数；null = 不按时长过滤（独立表情包 / 常驻气泡）
 * @param ctx.recent Map<id, 上次出现的时间戳>
 * @param ctx.force 显式指定 / 高优先级：不管近期用过没有、也不受好感等级限制
 * @param ctx.level 当前好感等级；ctx.minLevel：图 id → 最低等级
 * 偏好「近 90 秒没用过」的；都用过就选最久没用的（LRU），所以只要有够短的候选就一定有图。
 */
export function chooseFrom(pool, ctx) {
  const { manifest, ttl = null, recent, now, force = false, rand = Math.random, level = 99, minLevel = {} } = ctx
  // 好感等级放出：等级不够的图先跳过（显式指定的不受限）
  const cand = pool.filter((id) => manifest[id] && (force || (minLevel[id] || 1) <= level) && (ttl == null || manifest[id].ms <= ttl + SNAP_MS))
  if (!cand.length) return null
  if (force || !recent) return cand[Math.min(cand.length - 1, Math.floor(rand() * cand.length))]
  const seen = (id) => recent.get(id) || -Infinity
  const fresh = cand.filter((id) => !(now - seen(id) < REPEAT_MS))
  if (fresh.length) return fresh[Math.min(fresh.length - 1, Math.floor(rand() * fresh.length))]
  return cand.reduce((best, id) => (seen(id) < seen(best) ? id : best), cand[0])
}

/**
 * 综合选图：按优先级逐个候选池尝试，第一个能挑出图的池胜出。
 * spec.gapMs：常驻气泡用的节流（距上一次出图不足这么久就不挂）；一次性台词不传，不节流。
 * @returns 表情包 id，或 null（不挂图）
 */
export function pickSticker(spec, data, ctx) {
  const force = !!spec.force || !!spec.sticker
  if (spec.gapMs && !force && ctx.now - (ctx.lastAt || -Infinity) < spec.gapMs) return null
  for (const pool of resolvePools(spec, data)) {
    const id = chooseFrom(pool, { ...ctx, ttl: spec.ttl == null ? null : spec.ttl, force })
    if (id) return id
  }
  return null
}
