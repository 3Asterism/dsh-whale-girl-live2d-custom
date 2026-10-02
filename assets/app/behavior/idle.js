/** behavior/idle.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { TYPING } from './page.js'
import { routineTick } from './routine.js'
import { soulTick } from './soul.js'
import { CFG } from '../config.js'
import { EXPR, R, agent, bond } from '../core/state.js'
import { pick, pickFresh } from '../core/util.js'
import { PRI, perform } from '../director/perform.js'
import { gaze, gazeTick } from '../engine/gaze.js'
import { rig, setBase } from '../engine/rig.js'
import { PERF } from '../engine/runtime.js'
import { workTick } from '../engine/work.js'
import { IDLE_PROPS, PROPS } from '../persona/items.js'
import { lineFor } from '../persona/lines.js'
import { SAY } from '../persona/say.js'
import { bondRefresh } from './bond.js'

/**
 * 待机大脑。
 *
 * 这是「她自己会动」的来源——用户明确说过不想自己一个个去点表情，
 * 要她闲着自己动一动。所以按权重随机挑事情做：
 *
 *   · 大部分时间只是看看别处、换个姿势、偶尔换个表情（很快收回）
 *   · 吹泡泡糖是稀有事件（权重 2/100），不再是主旋律
 *   · 长时间没人理 → 打哈欠 → 打瞌睡（渐进式，鼠标一动就醒）
 *
 * 权重表就是性格；想让她更活泼就调大 motion 类，想更安静就调大 glance。
 */
/**
 * 待机行为权重表。
 *
 * 主人明确要求：**待机不放任何「动作」**（不吹泡泡糖、不伸懒腰、不自拍），
 * 待机就是「拿着板夹、平常脸、等命令」——动效只可能在「点击」或「工作事件」
 * 里出现，每个动作配它自己那套台词，且不会乱冒。
 *
 * 所以这里只剩三类：看别处、自己换个表情（几秒收回）、说句话。
 */
const IDLE_TABLE = [
  ['glance', 46], // 看别处 / 发呆
  ['express', 28], // 自己换个表情，几秒后收回
  ['mutter', 22], // 自言自语（人设台词）
  ['hungry', 4], // 喊饿
  ['nopang', 2], // 强调自己不胖（主人说「别老生气」，权重砍半）
]

export const idle = { sleep: 0, nextAt: 0, expressTimer: null, propTimer: null }

/**
 * 状态影响待机（只影响「表达」，从不惩罚）：饿了多喊饿、开心多换开心的脸、低落多「想靠一会儿」。
 * 饿了主动求投喂每天最多 2 次，免得烦人。
 */
const HUNGER = { day: '', asked: 0 }
function bondMood() {
  return bond.enabled && bond.snap ? bond.snap : null
}
function isHungry() {
  const s = bondMood()
  return !!s && s.full.v < s.full.hungry
}
function idleWeights() {
  const s = bondMood()
  if (!s) return IDLE_TABLE
  return IDLE_TABLE.map(([name, w]) => {
    if (name === 'hungry' && isHungry()) return [name, 18]
    if (name === 'express' && s.mood.v >= 80) return [name, 40]
    return [name, w]
  })
}

export function wakeUp() {
  if (idle.sleep === 0) return
  idle.sleep = 0
  agent.lastActivity = Date.now()
  perform({ id: 'wake', pri: PRI.TOUCH, tier: 'core', habit: false, mood: 'alert', line: pick(SAY.wake), ms: 1800 })
}

function pickIdleBehavior() {
  const table = idleWeights()
  let r = Math.random() * table.reduce((a, b) => a + b[1], 0)
  for (const [name, w] of table) {
    r -= w
    if (r <= 0) return name
  }
  return 'glance'
}

/** 待机时自己换个表情，过几秒悄悄收回（除非有真实事件插进来）。 */
function idleExpress() {
  // 注意：'dizzy'（圈圈眼）主人说老出不好看，已从所有自动行为里移除
  // 待机时换的表情，**必须是不会改变眼睛大小的**——
  // 主人要的「平常动作」就是「正常眼型 + 正常表情」，所以像
  // 开心兴奋（闭眼）、调皮（闭一只眼，就是那个"挤眼睛"）这类
  // 一律不进待机池，只留给点击互动那种明确的场合。
  // 'grumpy'（生气）也踢掉了：主人抱怨「别老生气」，待机时无缘无故
  // 摆一张生气的脸很莫名，换成「流汗」。
  const s = bondMood()
  const pool = s && s.mood.v >= 80 ? ['excited', 'love', 'tongue', 'shy'] : s && s.mood.v <= 30 ? ['sweat', 'confused', 'shy'] : ['shy', 'confused', 'excited', 'alert', 'tongue', 'sweat', 'love']
  const m = pick(pool)
  const ms = 2200 + Math.random() * 2600
  perform({ id: 'idle-express', pri: PRI.AMBIENT, tier: 'extra', habit: false, mood: m, props: IDLE_PROPS, ms })
  idle.expressUntil = performance.now() + ms
}

/** 待机时拨弄一个道具：临时戴上，随 override 一起过期，不用手动摘。 */
function idleFiddle() {
  const keys = Object.keys(PROPS).filter((k) => EXPR[PROPS[k].expr])
  const key = pickFresh(keys, 'fiddle')
  perform({ id: 'idle-fiddle', pri: PRI.AMBIENT, tier: 'extra', habit: false, props: [key], ms: 5000 + Math.random() * 4000 })
}

function runIdleBehavior() {
  // 正有一个一次性反应在放，就别插新的——否则会叠在一起，
  // 而且旧反应会被顶掉、看起来像「卡住」
  if (rig.override) return

  const b = pickIdleBehavior()
  switch (b) {
    case 'glance':
      gaze.nextDrift = 0 // 立刻换一个新的视线落点
      break
    case 'express':
      idleExpress()
      break
    case 'mutter':
      perform({ id: 'idle-mutter', pri: PRI.AMBIENT, tier: 'extra', habit: false, props: IDLE_PROPS, line: pickFresh(SAY.idle, 'idle'), ms: 4200 })
      break
    case 'fiddle':
      idleFiddle()
      break
    case 'hungry': {
      let line = pickFresh(SAY.hungry, 'hungry')
      if (isHungry()) {
        // 真的饿了（饱腹 < 25）：求投喂，每天最多 2 次
        const today = new Date().toDateString()
        if (HUNGER.day !== today) Object.assign(HUNGER, { day: today, asked: 0 })
        if (HUNGER.asked >= 2) break
        HUNGER.asked++
        line = lineFor('hungryAsk')
      } else if (bondMood() && bondMood().full.v >= bondMood().full.stuffed) {
        line = lineFor('stuffedNo') // 吃得很饱时被问到：守住「才没有吃撑」
      }
      perform({ id: 'idle-hungry', pri: PRI.AMBIENT, tier: 'extra', habit: false, mood: 'pout', props: IDLE_PROPS, line, ms: 4600 })
      break
    }
    case 'nopang':
      perform({ id: 'idle-nopang', pri: PRI.AMBIENT, tier: 'extra', habit: false, mood: 'grumpy', props: IDLE_PROPS, line: pickFresh(SAY.fat, 'fat'), ms: 4200 })
      break
  }
}

export function startLoops() {
  // 视线/自主动作：40ms 一跳（对应 clawd-on-desk 的 50ms 轮询）
  setInterval(gazeTick, 40)

  // 干活时的轮播（认真/摸鱼/思考），和下面的待机大脑互斥
  setInterval(() => {
    if (agent.status === 'idle') return
    workTick()
  }, 1500)

  // 日常节律（饭点 / 喝水 / 久坐 / 深夜 / 今日账单 / 峰谷）：20 秒看一次，开机 8 秒后先看一次
  setInterval(() => routineTick().catch(() => {}), 20000)
  setTimeout(() => routineTick().catch(() => {}), 8000)
  // 发呆搭话（输入框写了一半停着 / 一阵子没动静）：15 秒看一次，只在话痨档、她醒着、没别的在演时才出声
  setInterval(() => soulTick({ typing: TYPING, sleeping: idle.sleep !== 0 }), 15000)
  // 羁绊快照：每 10 分钟刷一次（心情 / 饱腹是随时间变的，待机行为要读它；顺带检查有没有「待晋级」）
  setInterval(() => bondRefresh(), 10 * 60000)

  // 兜底复位：只要空闲、又没有一次性表演在放，底层状态就必须是「平常」。
  // 有了它，就算哪条事件路径漏了复位，也不会出现「一直挂着某张脸」。
  setInterval(() => {
    if (agent.status !== 'idle') return
    if (rig.override) return
    if (rig.base.mood !== 'neutral') setBase('neutral', IDLE_PROPS)
    if (gaze.biasTarget !== 0) gaze.biasTarget = 0
  }, 2000)

  // 待机大脑：3.5–7.5 秒挑一件事
  setInterval(() => {
    if (agent.status !== 'idle') return
    if (PERF.low) return                      // 低性能档：不自言自语、不自己找戏
    if (R.ui.root.classList.contains('dshp-hidden')) return
    if (document.hidden) return
    const now = performance.now()
    if (now < idle.nextAt) return
    idle.nextAt = now + 3500 + Math.random() * 4000
    runIdleBehavior()
  }, 1200)

  // 睡眠序列：先打哈欠，再睡着；鼠标一动就醒
  setInterval(() => {
    if (!CFG.sleepAfterMs || agent.status !== 'idle') return
    if (PERF.low) return                      // 低性能档：连打哈欠/睡觉都省掉
    const quiet = Date.now() - agent.lastActivity
    if (idle.sleep === 0 && quiet > CFG.sleepAfterMs) {
      idle.sleep = 2
      setBase('sleepy', IDLE_PROPS)
      R.ui.bubble.show(pick(['呼……呼……', '（打瞌睡）', '（趴桌上睡着了）']), { name: '鲸鱼娘', ttl: 9000, sticker: 'work_nap' })
    } else if (idle.sleep === 0 && quiet > CFG.sleepAfterMs * 0.55 && Math.random() < 0.4) {
      // 打哈欠
      perform({ id: 'idle-yawn', pri: PRI.AMBIENT, tier: 'extra', habit: false, mood: 'sleepy', props: IDLE_PROPS, line: '（打了个哈欠）', ms: 2600 })
    }
  }, 15000)
}
