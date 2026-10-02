/**
 * persona/empathy.js —— 「看懂主人的心情」：把一串零散的信号合成一个会衰减的「挫败度」，到了任务边界再轻轻安慰。
 * **纯函数 + 一个小状态机，不碰 DOM / 配置**，Node 里能直接单测（tools/test-empathy.mjs）。
 *
 * 为什么不是「看见一个词就安慰」（调研结论，见 docs/陪伴设计调研.md 第 5 节）：
 *   · 挫败是一串信号叠出来的：重复发同一句话（提示词打转）、反复「重新生成」、停止、提议被拒、连着报错、「还是不行 / 怎么又」……
 *     单个词（「累」「烦」）只覆盖了很小一部分，而且会误伤玩笑；
 *   · 说话的时机比说什么更要紧：任务边界（一轮收工、提交之后）接受率高，写到一半被打断多半被直接关掉——所以这里只算分，
 *     **真正开口交给调用方挑边界、避开「主人正在打字」**；
 *   · 情绪强度要和事情严重程度匹配，别小题大做：软安慰（≥45）15 分钟最多一次，重一点的（≥75，带「歇五分钟」）40 分钟最多一次，
 *     安慰过一次分数就降下来；时间过去分数自己衰减（半衰期 4 分钟）；顺利收工 / 道谢会把分数拉下去；
 *   · 高风险的话（自伤倾向）**不走玩笑口径**：只用温柔的话，不配梗图，提醒找身边的人（见 CARE_RE）。
 *
 * 隐私：文本只在本地用正则 / 字符二元组相似度分析，只在内存里留最近 3 句的「指纹」（二元组集合，不留原文）10 分钟，不上传、不落盘。
 */

/** 半衰期：4 分钟前的火气只剩一半。 */
export const HALF_LIFE_MS = 4 * 60000
/** 软安慰 / 重安慰的分数线与各自的冷却。 */
export const SOFT = 45
export const HARD = 75
export const COOL = { soft: 15 * 60000, hard: 40 * 60000, hardAfterSoft: 5 * 60000 }
export const MAX_SCORE = 120

/** 信号权重（正 = 更烦，负 = 缓解）。 */
export const WEIGHT = {
  textStrong: 28, // 「崩溃 / 气死 / 无语 / 搞不定 / wtf」
  textMild: 12, // 「还是不行 / 怎么又 / 不对啊」
  repeat: 22, // 同一句话又发了一遍
  shout: 10, // 连着三个以上感叹号 / 问号、整句大写
  regen: 14, // 点「重新生成」
  stop: 8, // 点「停止」
  reject: 10, // 她的提议 / 命令被拒
  turnError: 16, // 一轮以报错收场
  turnAbort: 10, // 一轮被打断
  retry: 8, // 重试
  toolError: 4, // 工具报错
  testRed: 6, // 测试 / 构建没过（退出码非零，宿主从结果末尾抽出来的）
  redStreak: 18, // 连着几轮都以红色收场
  cmdFail: 3, // 别的命令退出码非零
  cmdLoop: 8, // 同一条命令失败第 3 次起每次 +8（原地打转）
  fileThrash: 4, // 同一个文件被改第 5 次起每次 +4
  regression: 10, // 绿了又红（改一个 bug 出三个）
  approvalBurst: 8, // 10 分钟里被问了 ≥6 次要不要批准（批准疲劳）
  win: -35, // 顺利收工
  commit: -12, // 提交了（一个小圆满）
  thanks: -40, // 主人道谢 / 夸她
}

/** 信号 → 「是什么在烦」（决定安慰的口吻）。 */
export const CAUSE = {
  textStrong: 'rage', textMild: 'loop', repeat: 'loop', shout: 'rage', regen: 'loop', stop: 'loop',
  reject: 'reject', turnError: 'fail', turnAbort: 'fail', retry: 'fail', toolError: 'fail', testRed: 'fail', redStreak: 'loop', cmdFail: 'fail', cmdLoop: 'loop', fileThrash: 'loop', regression: 'fail', approvalBurst: 'reject',
}

/** 原因 → 台词 id（台词在 persona/lines-scenes.js，配图在 persona/stickers.js）。 */
export const COMFORT_SAY = { rage: 'empathyRage', loop: 'empathyLoop', fail: 'empathyFail', reject: 'empathyReject', late: 'empathyLate', hard: 'empathyHard' }
export const COMFORT_MOOD = { rage: 'sad', loop: 'sweat', fail: 'sad', reject: 'sweat', late: 'sleepy', hard: 'sad' }

// ——————————————————————————————————————————————————————————————
// 文本信号（主人的原话，本地正则）
// ——————————————————————————————————————————————————————————————

const STRONG_RE =
  /崩溃|气死|烦死|烦透|无语|受不了|搞不定|搞不懂|弄不好|太难了|麻了|裂开|破防|心态.{0,2}崩|想哭|什么鬼|搞什么|放弃了|不想弄了|不想干了|算了不弄|wtf|tmd|卧槽|我靠|他妈|妈的|\bfuck|\bshit\b|i give up|giving up|so frustrat/i
const MILD_RE =
  /还是不行|又不行|又错了|怎么又|为什么又|不对啊|不行啊|还是报错|依然报错|没用啊|还是一样|没变化|还是没|same error|still (not working|broken|fails?|wrong)|doesn'?t work|not working/i

/**
 * 高风险：自伤倾向。**不走挫败度、不玩梗**——调用方只给一句温柔的话，不配图，并提醒找身边信得过的人。
 * 刻意收得很窄：「笑死 / 累死 / 气死 / 想死你了」这种口头禅一律不算，只认明确的表述。
 */
export const CARE_RE = /自杀|不想活了|活着没(有)?意思|想结束(这一切|生命)|轻生|不想再活/

const normalize = (s) => String(s || '').toLowerCase().replace(/[\s　,，.。!！?？~～、:：;；"'“”‘’()（）\[\]【】]/g, '').slice(0, 400)

/** 字符二元组集合（只留这个指纹，不留原文）。 */
export function bigrams(text) {
  const s = normalize(text)
  const out = new Set()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/** 最近几句话的指纹（内存里，10 分钟，最多 3 句）。 */
export const RECENT_MS = 10 * 60000
export const REPEAT_SIM = 0.75

/**
 * 分析一句主人的话。recent 是上面那份「最近几句的指纹」，会被就地更新。
 * @returns { signals: string[], care: boolean }
 *   · 词汇信号只对「口语化的短消息」算（≤120 字、不是代码 / 日志 / 堆栈），免得一段报错里的「shit」「fuck」让她误会；
 *   · 「重复」对任何长度都算（提示词打转往往是很长的一段）：和最近 3 句里某一句的二元组相似度 ≥0.75；
 *   · care 与上面互斥——高风险就只走温柔那条。
 */
export function analyzeText(text, recent, now) {
  const t = String(text || '')
  const res = { signals: [], care: false }
  if (CARE_RE.test(t)) {
    res.care = true
    return res
  }
  const chatty = t.length > 0 && t.length <= 120 && !/```|\n\s+at\s|Traceback|Exception|Error:/.test(t)
  if (chatty) {
    if (STRONG_RE.test(t)) res.signals.push('textStrong')
    else if (MILD_RE.test(t)) res.signals.push('textMild')
    if (/[!！]{3,}|[?？]{3,}/.test(t) || (/[A-Z]/.test(t) && t.replace(/[^A-Za-z]/g, '').length >= 8 && t.replace(/[^A-Z]/g, '').length / t.replace(/[^A-Za-z]/g, '').length > 0.7)) res.signals.push('shout')
  }
  const grams = bigrams(t)
  if (grams.size >= 5 && recent) {
    for (let i = recent.length - 1; i >= 0; i--) if (now - recent[i].t > RECENT_MS) recent.splice(i, 1)
    if (recent.some((r) => jaccard(grams, r.grams) >= REPEAT_SIM)) res.signals.push('repeat')
    recent.push({ t: now, grams })
    while (recent.length > 3) recent.shift()
  }
  return res
}

// ——————————————————————————————————————————————————————————————
// 挫败度：会衰减的分数 + 冷却
// ——————————————————————————————————————————————————————————————

export function createEmpathy() {
  let score = 0
  let at = 0
  let causes = {}
  const st = { lastSoft: -Infinity, lastHard: -Infinity }
  const decayTo = (now) => {
    const dt = Math.max(0, now - at)
    if (dt > 0) {
      const f = Math.pow(0.5, dt / HALF_LIFE_MS)
      score *= f
      for (const k of Object.keys(causes)) causes[k] *= f
    }
    at = now
  }
  const scale = (f) => {
    score *= f
    for (const k of Object.keys(causes)) causes[k] *= f
  }
  const api = {
    recent: [], // 最近几句的指纹（给 analyzeText）
    /** 记一个信号。负权重（缓解）按比例把分数和原因一起拉下去。 */
    add(kind, now) {
      const w = WEIGHT[kind]
      if (!w) return
      decayTo(now)
      if (w < 0) {
        const keep = Math.max(0, (score + w) / (score || 1))
        scale(score > 0 ? Math.min(1, keep) : 0)
        return
      }
      score = Math.min(MAX_SCORE, score + w)
      const c = CAUSE[kind] || 'fail'
      causes[c] = (causes[c] || 0) + w
    },
    score(now) {
      decayTo(now)
      return score
    },
    /** 现在是第几档：0 平静 / 1 有点烦 / 2 很烦。 */
    level(now) {
      decayTo(now)
      return score >= HARD ? 2 : score >= SOFT ? 1 : 0
    },
    /** 现在最主要是什么在烦：rage / loop / fail / reject（平静时返回 null）。 */
    dominant(now) {
      decayTo(now)
      let best = null
      for (const [k, v] of Object.entries(causes)) if (v > 1 && (!best || v > causes[best])) best = k
      return best
    },
    /**
     * 现在该不该安慰：返回 { level, cause, late } 或 null。**只算「该不该」，不管「能不能说」**——
     * 调用方要自己挑任务边界、避开主人正在打字的时候，真说了再调 fired()。
     */
    due(now, hour) {
      const lv = api.level(now)
      if (!lv) return null
      const cause = api.dominant(now) || 'fail'
      const late = hour >= 23 || hour < 5
      if (lv === 2 && now - st.lastHard >= COOL.hard && now - st.lastSoft >= COOL.hardAfterSoft) return { level: 2, cause, late }
      if (now - st.lastSoft >= COOL.soft && now - st.lastHard >= COOL.hardAfterSoft) return { level: 1, cause, late }
      return null
    },
    /** 她真的安慰过了：记冷却，把火气降下来（被接住了就没那么烦了）。 */
    fired(level, now) {
      decayTo(now)
      st.lastSoft = now
      if (level === 2) st.lastHard = now
      scale(0.4)
    },
    /** 别的地方（关键词反应）已经安慰过了：别紧接着再来一次。 */
    comforted(now) {
      decayTo(now)
      st.lastSoft = now
      scale(0.6)
    },
    reset() {
      score = 0
      at = 0
      causes = {}
      st.lastSoft = -Infinity
      st.lastHard = -Infinity
      api.recent.length = 0
    },
  }
  return api
}
