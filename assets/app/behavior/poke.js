/** behavior/poke.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { bondAct } from './bond.js'
import { idle } from './idle.js'
import { playAction } from './menu-actions.js'
import { R, agent } from '../core/state.js'
import { pick, pickFresh } from '../core/util.js'
import { PRI, noteUser, perform, performingNow } from '../director/perform.js'
import { qBounce } from '../engine/effects.js'
import { gaze, gazeDetach } from '../engine/gaze.js'
import { IDLE_PROPS } from '../persona/items.js'
import { POKE_BODY, POKE_BUSY, POKE_HEAD } from '../persona/pokes.js'
import { SAY } from '../persona/say.js'
import { closePanels } from '../ui/panels.js'

/**
 * 戳她。
 *
 * 之前的问题：身体被戳走的是「晕晕」这种不对味的脸（用户说「别闹应该是可爱地生气」），
 * 而且反应池太窄。现在按人设来——傲娇嘴甜、嘴上嫌弃、其实很开心；
 * 另外加了连击（短时间戳很多下会炸毛）和「摸头/戳腰」分区。
 */
export const pokeState = { times: [], softAt: 0, angerAt: 0 }

/**
 * 连点分档 —— 主人第二次抱怨「平常点几下就生气了，不好玩」。
 *
 * 旧代码的判定是「和上一次点击间隔 < 1.8 秒就累加」，于是每 1.5 秒点一下，
 * 点到第三下照样炸毛，正常逗她玩也会被凶。
 *
 * 现在改成真正的**速率**判定：看 2.6 秒里点了几下、平均间隔多少。
 *   · 慢悠悠地戳（平均间隔 > 420ms，也就是慢于 2.4 下/秒）→ 永远只是可爱反应；
 *   · 快到 2.4 下/秒以上，才「被戳痒了」撒娇抗议（ticklish），仍然不是生气；
 *   · 只有手速党（3.8 下/秒以上、窗口内至少 7 下）才真炸毛，而且炸毛后有
 *     6 秒冷静期，免得一直凶主人。
 */
const POKE_TIER = {
  window: 2600, // 统计窗口（毫秒）
  softCount: 4, // 窗口内至少 4 下
  softGap: 420, // 且平均间隔 ≤ 420ms → 痒得抗议（≈2.4 下/秒）
  hardCount: 7, // 窗口内至少 7 下
  hardGap: 260, // 且平均间隔 ≤ 260ms → 真炸毛（≈3.8 下/秒）
  softCool: 1500, // 撒娇抗议之间的最小间隔，免得刷屏
  angerCool: 6000, // 炸毛之后的冷静期
}

/**
 * 记一次点击，并把滑出窗口的旧记录丢掉。
 * 时间戳是滑动窗口，所以慢慢点的话旧记录会自己过期，永远攒不到炸毛。
 */
function pokeRecord(now) {
  const t = pokeState.times
  t.push(now)
  if (t.length > 60) t.splice(0, t.length - 60)
  pokePrune(now)
}

function pokePrune(now) {
  const t = pokeState.times
  while (t.length && now - t[0] > POKE_TIER.window) t.shift()
}

/** 纯函数：由「几下 / 平均间隔 / 距上次炸毛多久」判断档位。测试也用它。 */
function tierOf(count, gap, sinceAnger) {
  const T = POKE_TIER
  const rapid = count >= T.softCount && gap <= T.softGap
  const furious = rapid && count >= T.hardCount && gap <= T.hardGap && sinceAnger > T.angerCool
  return { count, gap: gap === Infinity ? null : Math.round(gap), rapid, furious }
}

/** 现在的手速处在哪一档。只读，不改记录（诊断接口也调它）。 */
export function pokeTier(now) {
  const at = now || performance.now()
  pokePrune(at)
  const t = pokeState.times
  const count = t.length
  const gap = count >= 2 ? (t[count - 1] - t[0]) / (count - 1) : Infinity
  return tierOf(count, gap, at - pokeState.angerAt)
}

/**
 * 纯计算版：给一串「相邻两次点击的间隔」（毫秒），算出落哪一档。
 * 测试专门用它证明「正常速度点一万下也不会生气」。
 */
export function pokeTierForGaps(gaps) {
  const T = POKE_TIER
  const times = []
  let t = 0
  times.push(t)
  for (const g of gaps) {
    t += g
    times.push(t)
  }
  let count = 0
  let sum = 0
  for (let i = times.length - 1; i >= 0; i--) {
    if (t - times[i] > T.window) break
    count++
  }
  const from = times.length - count
  sum = count >= 2 ? t - times[from] : 0
  const gap = count >= 2 ? sum / (count - 1) : Infinity
  return tierOf(count, gap, Infinity)
}

export function poke(clientX, clientY) {
  if (R.ui.root.classList.contains('dshp-hidden')) return

  // —— 干活时点她：也互动，但**不动底层状态** ——
  // 反应是一次性的（两秒左右），过期后自动回到「正在做的那件事」，
  // 所以既有了互动，又不会把工作状态搞乱。
  if (agent.status !== 'idle') {
    closePanels()
    qBounce(1)
    // 「点的时候她会看」：干活时被戳就抬头看鼠标（低头看本子的姿势也让开）
    gazeDetach(1800)
    gaze.biasTarget = 0
    const busyHit = pickFresh(POKE_BUSY, 'busy')
    // 戳是 TOUCH 级：不会顶掉批准等待 / 报错这类更高优先级的提示（等待状态本身是 cond，戳完自然回来）
    perform({
      id: 'poke-busy', pri: PRI.TOUCH, tier: 'core', habit: false,
      mood: busyHit.mood,
      line: pickFresh(busyHit.lines, 'busy-line-' + busyHit.mood),
      ms: 2200,
    })
    return
  }

  const now = performance.now()
  pokeRecord(now)
  const tier = pokeTier(now)
  noteUser()

  closePanels()
  qBounce(tier.furious ? 1.35 : tier.rapid ? 1.15 : 1)
  gazeDetach(2200)

  // —— 睡着被戳：起床气（先嘟嘴，再被哄好）。只此一次，不循环生气，守住「别老生气」 ——
  if (idle.sleep !== 0) {
    idle.sleep = 0
    agent.lastActivity = Date.now() // 不然下一轮睡眠检查会让她立刻又睡着
    perform({ id: 'wake-grumpy', pri: PRI.TOUCH, tier: 'core', habit: false, mood: 'pout', props: IDLE_PROPS, say: 'wakeGrumpy', ms: 2200 })
    setTimeout(() => {
      if (agent.status === 'idle' && !performingNow()) perform({ id: 'wake-fix', pri: PRI.TOUCH, tier: 'core', habit: false, mood: 'shy', props: IDLE_PROPS, say: 'wakeFix', ms: 2400 })
    }, 2400)
    return
  }
  bondAct('poke') // 冷却 / 每日上限在服务端判，连点刷不动

  // —— 真炸毛：只有手速党才见得到，而且一次只出一条 ——
  if (tier.furious) {
    pokeState.angerAt = now
    // 别每次都同一张脸：生气/警觉/嘟嘴里挑一个，台词也从扩过的池子里抽
    const face = pick(['grumpy', 'grumpy', 'alert', 'pout'])
    perform({ id: 'poke-furious', pri: PRI.TOUCH, tier: 'core', habit: false, mood: face, props: IDLE_PROPS, line: pickFresh(SAY.many, 'many'), ms: 2600 })
    return
  }

  // —— 快但没到炸毛：被戳痒了，可爱地抗议，绝不跳进生气 ——
  // 撒娇也有最小间隔，免得连点变成刷屏；间隔内的点击继续走下面的普通反应，
  // 所以「手快」的体验是「她一直在躲」，而不是「她一直生气」。
  if (tier.rapid && now - pokeState.softAt > POKE_TIER.softCool) {
    pokeState.softAt = now
    perform({
      id: 'poke-ticklish', pri: PRI.TOUCH, tier: 'core', habit: false,
      mood: pick(['pout', 'shy', 'tongue', 'alert']),
      props: IDLE_PROPS,
      line: pickFresh(SAY.ticklish, 'ticklish'),
      ms: 2400,
    })
    return
  }

  // 原作者把「鲸鱼喷水」这个动画绑在**左键点她**上（按键表：LeftMouseButton
  // → 喷水.motion3.json）。所以戳她的时候偶尔真的喷一下水——照人家的设计来。
  if (Math.random() < 0.12) {
    playAction('splash', { pri: PRI.TOUCH, id: 'poke-splash' })
    return
  }

  const r = R.ui.stage.getBoundingClientRect()
  const head = (clientY - r.top) / Math.max(1, r.height) < 0.45
  const hit = pickFresh(head ? POKE_HEAD : POKE_BODY, head ? 'head' : 'body')
  const ms = 2600

  // 一次点击 = 一个表情 + 一句台词 +（至多）一个粒子特效。
  // perform() 会先把上一次整个停掉，所以点一下永远是干净的单次反应。
  perform({
    id: 'poke', pri: PRI.TOUCH, tier: 'core', habit: false,
    mood: hit.mood,
    line: pickFresh(hit.lines, 'line-' + hit.mood),
    heart: hit.fx === 'heart',
    ms,
  })
}
