/** behavior/sentiment.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { maybeGreet } from './greeting.js'
import { agent } from '../core/state.js'
import { PRI, perform } from '../director/perform.js'
import { setBase } from '../engine/rig.js'
import { CFG } from '../config.js'
import { WORK_PROPS } from '../persona/items.js'
import { KEYWORDS, SORRY_RE } from '../persona/keywords.js'
import { bondAct, bondMemory } from './bond.js'
import { fortuneByText } from './dev.js'
import { empathyComforted, empathyText } from './observe.js'

export function reactToUserText(text) {
  const t = String(text || '')
  if (fortuneByText(t.trim())) return // 「抽签 / 运势」：当场抽今天这支签
  empathyText(t) // 心情信号：只记账（高风险的话例外，当场温柔回应）；安慰留到任务边界
  const chatty = t.length > 0 && t.length <= 120 && !/```|\n\s+at\s|Traceback|Exception|Error:/.test(t)
  if (chatty && CFG.keywords !== false) {
    for (const k of KEYWORDS) {
      if (!k.re.test(t)) continue
      const ms = perform({ id: k.id, pri: PRI.CUE, tier: 'extra', mood: k.mood, heart: !!k.heart, say: k.say, ms: k.ms, cool: k.cool, habit: false })
      if (ms && k.praise) bondAct('praise')
      if (ms && (k.id === 'kw-tired' || k.id === 'kw-scold' || k.id === 'kw-work')) empathyComforted() // 已经接住了
      if (ms && k.memory) bondMemory(k.memory) // 第一次被叫胖 / 叫妈妈：记进回忆册
      return // 命中了（哪怕在冷却里没演）就不再叠问候
    }
  }
  if (CFG.routine !== false) maybeGreet()
}

// —— 回复文本的情绪：只改「开始出字时她是什么脸」，不额外起一次 act ——
let replyBuf = ''

let replyApplied = false

export function replyMood() {
  replyBuf = ''
  replyApplied = false
  return 'happy'
}

export function noteReplyText(text) {
  if (replyApplied || replyBuf.length >= 80) return
  replyBuf += text
  if (SORRY_RE.test(replyBuf) && agent.status === 'speaking') {
    replyApplied = true
    setBase('sweat', WORK_PROPS)
  }
}
