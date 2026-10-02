/**
 * persona/fortune.js —— 每日一签（おみくじ）：每天第一次见面，她替你抽一支今日运势。**纯函数**，Node 里能直接单测。
 *
 * 为什么有这个（调研结论）：成熟的养成 / 陪伴产品留得住人，靠的是「每天一个小仪式 + 偶尔的惊喜 + 不带罪恶感」，不是更多聊天。
 *   · 签只由日期决定（同一天永远同一支，抽不到好的也不能刷）——没有赌博感，也不需要存「抽过什么」；
 *   · 「凶」永远是安慰口吻（小虫子比较多，不是主人倒霉）；
 *   · **幸运图**：优先从图鉴里「还没收录」的表情包里挑——她把那张图丢给你，顺手就收进了图鉴，陪伴和收集串在一起。
 */

/** 权重合计 100；吉凶比例照神社签的体感：吉多，凶少。 */
export const FORTUNE_LEVELS = [
  { id: 'daikichi', rank: '大吉', w: 10, say: 'fortuneBig', mood: 'excited' },
  { id: 'chukichi', rank: '中吉', w: 25, say: 'fortuneMid', mood: 'happy' },
  { id: 'shokichi', rank: '小吉', w: 30, say: 'fortuneSmall', mood: 'happy' },
  { id: 'suekichi', rank: '末吉', w: 20, say: 'fortuneEnd', mood: 'shy' },
  { id: 'kyo', rank: '凶', w: 15, say: 'fortuneBad', mood: 'sweat' },
]

/** 宜 / 忌：写给打工人看的（别用「你会倒霉」这种吓人的话）。 */
export const FORTUNE_YI = ['重构', '提交代码', '写测试', '喝水', '摸鱼', '删掉没用的代码', '早点下班', '写文档', '吃白饭', '整理待办', '跑一遍测试', '拍虫子', '睡个好觉', '夸夸队友']
export const FORTUNE_JI = ['周五部署', '直接改生产', '熬夜', '跟需求吵架', '强推主分支', '一次改一百个文件', '空腹写代码', '复制粘贴不看', '没测就上线', '一个人扛着']

/** FNV-1a 32 位：够用、稳定、跨平台结果一致。 */
export function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** 本地日期 YYYY-MM-DD（按用户所在时区，跨过午夜才换新签）。 */
export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 某一天的签：只由日期决定。返回 { level, rank, say, mood, yi, ji, seed }。 */
export function fortuneOf(date) {
  const seed = fnv1a(String(date) + '|whale')
  const total = FORTUNE_LEVELS.reduce((a, l) => a + l.w, 0)
  let r = seed % total
  let level = FORTUNE_LEVELS[FORTUNE_LEVELS.length - 1]
  for (const l of FORTUNE_LEVELS) {
    if (r < l.w) {
      level = l
      break
    }
    r -= l.w
  }
  const yi = FORTUNE_YI[(seed >>> 8) % FORTUNE_YI.length]
  const ji = FORTUNE_JI[(seed >>> 16) % FORTUNE_JI.length]
  return { level: level.id, rank: level.rank, say: level.say, mood: level.mood, yi, ji, seed }
}

/**
 * 幸运图：从清单里挑一张。偏好图鉴里还没收录的；等级不够的（黏人系）先跳过；全收齐了就任挑一张。
 * @param ids 清单里的全部 id（保持清单顺序）
 * @param seen 图鉴里已收录的 id
 * @param level 当前好感等级；minLevel：图 id → 最低等级
 */
export function pickLucky(ids, seen, level, minLevel, seed) {
  const ok = (ids || []).filter((id) => (minLevel && minLevel[id] ? minLevel[id] : 1) <= (level || 1))
  if (!ok.length) return null
  const got = new Set(seen || [])
  const fresh = ok.filter((id) => !got.has(id))
  const pool = fresh.length ? fresh : ok
  return pool[seed % pool.length]
}

/** 气泡里的签文（两行）。luckyName 是幸运图的中文名（可空）。 */
export function fortuneText(f, luckyName) {
  return `今日运势：${f.rank}\n宜：${f.yi}　忌：${f.ji}${luckyName ? `\n幸运图：${luckyName}` : ''}`
}

/** 主人说这些，她就当场抽（已经抽过就提醒「签不能反悔」）。只认短句。 */
export const FORTUNE_RE = /运势|抽[个一支张]?签|求[个一支张]?签|占卜|今日签|おみくじ/
