/** engine/rig.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { CFG } from '../config.js'
import { EXPR, R } from '../core/state.js'
import { readLayout, saveLayout } from '../core/storage.js'
import { clamp, log } from '../core/util.js'
import { blinkTick, eyesOpen, paramDefault } from './blink.js'
import { motionActive, playMotion } from './motion.js'
import { device, putDeviceAway } from './work.js'
import { ALL_TOGGLES, GROUP_OF_EXPR } from '../persona/items.js'
import { MOOD_FACE } from '../persona/moods.js'

/**
 * 状态模型（这一版的核心）。
 *
 * 之前最大的问题是「特效会卡住」：摸头/工具/完成每次都 setMood 一下，那张脸就一直
 * 挂在那儿，等下一个事件来覆盖——叠几次之后就永远停在错的状态上，很多表情也再也
 * 用不出来。根因是「谁都没有责任去清理」。
 *
 * 现在拆成三层，各自职责单一，谁都不会赖着不走：
 *
 *   base      由 agent 状态决定（待机/思考/干活/出错…），是「此刻本该是什么样」
 *   override  一次性反应（摸头、点击、特效、工具瞬时反馈）——**强制带时限**，到期自动消失
 *   user      主人手动选的脸/道具，也带时限；真实事件可以立刻夺回
 *
 * 每帧解析：face = override（未过期）> user（未过期）> base。
 * 「特效做完回不去」在结构上就不会发生——没有任何一处需要「记得清理」。
 */
export const rig = {
  /** 当前真实生效的脸（表达式名或 null） */
  face: null,
  /** 当前真实生效的道具集合（表达式名） */
  props: new Set(),
  weight: new Map(),
  talking: false,
  talkPhase: 0,
  /** 底层状态：由 agent 状态机维护 */
  base: { mood: 'neutral', face: null, props: [] },
  /** 一次性反应，一定带 until */
  override: null,
  /** 主人手动的（带时限） */
  user: { face: null, until: 0 },
  /** 主人自己戴的粘性道具（不限期，他自己摘） */
  userProps: new Set(),
  /** 一次性的参数脉冲（爱心粒子之类），到期自动停 */
  burst: null,
  /**
   * 持续型状态（v0.5 第四层）：批准等待、重试、危险命令、计划模式、分身帽子……
   * 由 syncConds() 根据状态 S 整体重算，**不走 act()**——所以不会被别的一次性反应顶掉，
   * 状态没了自然消失，不存在「忘了摘」。Map<key, {face, props[], pri}>。
   */
  cond: new Map(),
}

/**
 * applyRig() 每帧（20-30Hz，永远在跑）都要用到的临时容器，挪到外面按帧复用。
 * 原来是 `new Map()`/`new Set()` 写在函数体里，哪怕待机没有任何表情变化
 * 也要照样分配、当帧就丢——纯粹的 GC 压力。空闲时这三个容器基本是空的，
 * `.clear()` 比重新分配便宜得多。
 */
const rigTargets = new Map()

const rigDelta = new Map()

const rigClaimed = new Set()

/** 情绪名 → 表达式名（不在 EXPR 里的会被过滤掉） */
export function moodFace(name) {
  if (name == null) return null
  const f = MOOD_FACE[name] !== undefined ? MOOD_FACE[name] : name
  return f && f in EXPR ? f : null
}

/** 道具 key 或表达式名 → 表达式名 */
export function propExpr(key) {
  if (!key) return null
  const e = ALL_TOGGLES[key] ? ALL_TOGGLES[key].expr : key
  return e && EXPR[e] ? e : null
}

/** 把三层解析成「这一刻真正该显示什么」。改动状态后调用，或者每帧调用（很便宜）。 */
export function resolveRig() {
  const now = performance.now()
  if (rig.override && now >= rig.override.until) rig.override = null
  if (rig.user.face && now >= rig.user.until) rig.user.face = null

  // 持续型状态里 pri 最高的那张脸；道具按 pri 从高到低依次占「同组名额」
  let condFace = null
  let condMood = null
  let condPri = -1
  const conds = Array.from(rig.cond.values()).sort((a, b) => b.pri - a.pri)
  for (const c of conds) {
    if (c.face && c.pri > condPri) {
      condFace = c.face
      condMood = c.mood
      condPri = c.pri
    }
  }

  const ov = rig.override
  // 脸：override（一次性）> user（菜单手动）> cond（持续型）> base（agent 状态）
  const face = ov && ov.face !== undefined ? ov.face : rig.user.face || condFace || rig.base.face || null
  rig.face = face && face in EXPR ? face : null

  // 道具：同 group（眼镜 / 贴纸 / 头饰 / 桌布…）只留一个，先到先得：
  // override > 主人自己戴的 > cond > base。以前主人戴着墨镜、读资料又自动加圆眼镜，会叠两副。
  const props = new Set()
  const groups = new Set()
  const put = (p) => {
    if (props.has(p)) return
    const g = GROUP_OF_EXPR[p]
    if (g) {
      if (groups.has(g)) return
      groups.add(g)
    }
    props.add(p)
  }
  if (ov) for (const p of ov.props) put(p)
  for (const p of rig.userProps) put(p) // 主人自己戴的装饰品一直都在
  for (const c of conds) for (const p of c.props) put(p)
  if (!ov || !ov.exclusive) for (const p of rig.base.props) put(p)
  rig.props = props
  R.mood = (ov && ov.mood) || condMood || rig.base.mood || 'neutral'
}

/**
 * 设置底层状态。agent 状态机用它：待机 / 思考 / 干活 / 出错 / 完成…
 * @param name 情绪名
 * @param propKeys 该状态下常驻的道具（道具 key 或表达式名）
 */
export function setBase(name, propKeys) {
  rig.base = {
    mood: name || 'neutral',
    face: moodFace(name),
    props: (propKeys || []).map(propExpr).filter(Boolean),
  }
  resolveRig()
}

/**
 * 一次性反应。**一定会过期**——这是「特效不卡住」的保证。
 * 新的反应会直接顶掉旧的（主人说的「任何下一层东西覆盖前一个」）。
 */
export function setReaction(opts) {
  opts = opts || {}
  // mood 和 face 都没给 = 只临时加道具，不动脸
  const face =
    opts.face !== undefined ? opts.face : opts.mood !== undefined ? moodFace(opts.mood) : undefined
  rig.override = {
    mood: opts.mood || null,
    face: face === undefined ? undefined : face,
    props: (opts.props || []).map(propExpr).filter(Boolean),
    // exclusive：连「常态道具」（本子/笔）也暂时放下——主人要的是「砸的时候就只砸一下」
    exclusive: opts.exclusive === true,
    until: performance.now() + (opts.ms || 3200),
  }
  resolveRig()
}

/** 立刻撤掉一次性反应，回到 base（切模式、下一层事件来时用）。 */
export function clearReaction() {
  if (!rig.override) return
  rig.override = null
  resolveRig()
}

/** 主人手动选的脸，30 秒；期间待机不会抢，但真实事件会。 */
export function setUserFace(name) {
  rig.user = { face: moodFace(name), until: performance.now() + 30000 }
  resolveRig()
}

/** 主人手动选「平常」= 立刻交还给她自己。 */
export function clearUserFace() {
  rig.user = { face: null, until: 0 }
  clearReaction()
}

/**
 * 某一件「摆设/装饰」现在是开着的吗？
 * 手机是个例外——它不是一个表情参数，而是 `device.out`（模型自带的
 * 开盖动作把小设备掏出来），所以单独判。
 */
export function itemOn(key, def) {
  const d = def || ALL_TOGGLES[key]
  if (!d) return false
  if (d.device) return device.out
  return !!d.expr && rig.userProps.has(d.expr)
}

/** 把小设备（手机）掏出来——这就是原作者「自拍手机」那个动作。 */
export function takeDeviceOut() {
  if (device.out) return
  device.out = true
  playMotion('openLid')
}

export function setProp(key, on) {
  const def = ALL_TOGGLES[key]
  // 手机：走模型自带的开盖动作，不走表情参数
  if (def && def.device) {
    if (on) takeDeviceOut()
    else putDeviceAway()
    // 手机收起来时，它的换色也该跟着走
    if (!on) {
      for (const [k, v] of Object.entries(ALL_TOGGLES)) {
        if (v.needs === key && v.expr) rig.userProps.delete(v.expr)
      }
    }
    resolveRig()
    saveLayout({ props: Array.from(rig.userProps) })
    return
  }
  const expr = propExpr(key)
  if (!expr) return
  if (on) {
    if (def && def.group) {
      for (const [k, v] of Object.entries(ALL_TOGGLES)) {
        if (v.group === def.group && k !== key && v.expr) rig.userProps.delete(v.expr)
      }
    }
    // 前置依赖。两种：
    //   · 参数型（白魔爪 → 粉魔爪）：直接把前置的表情加上
    //   · 设备型（手机换色 → 掏出手机）：把手机掏出来
    // 这都是原作者的设计（*+5「魔爪变白」必须在粉魔爪模式下用）。
    if (def && def.needs) {
      const needDef = ALL_TOGGLES[def.needs]
      if (needDef && needDef.device) takeDeviceOut()
      else {
        const needExpr = propExpr(def.needs)
        if (needExpr) rig.userProps.add(needExpr)
      }
    }
    // 反过来：开「粉魔爪」要把换色摘掉，不然还是白的
    if (def && def.clears) {
      for (const k of def.clears) {
        const e2 = propExpr(k)
        if (e2) rig.userProps.delete(e2)
      }
    }
    rig.userProps.add(expr)
  } else {
    rig.userProps.delete(expr)
    // 摘掉「魔爪」时，它的换色也该跟着走，不然会留下一层颜色
    for (const [k, v] of Object.entries(ALL_TOGGLES)) {
      if (v.needs === key && v.expr) rig.userProps.delete(v.expr)
    }
  }
  resolveRig()
  saveLayout({ props: Array.from(rig.userProps) })
}

export function clearProps() {
  rig.userProps.clear()
  resolveRig()
  saveLayout({ props: [] })
}

export function restoreProps() {
  const saved = readLayout().props
  if (!Array.isArray(saved)) return
  for (const expr of saved) if (EXPR[expr]) rig.userProps.add(expr)
  resolveRig()
}

/** 当前参与施加的表达式集合（含正在淡出的）。过期与否已由 resolveRig 决定。 */
function currentExpressions() {
  const out = new Set()
  if (rig.face) out.add(rig.face)
  for (const name of rig.props) out.add(name)
  for (const name of rig.weight.keys()) out.add(name)
  return out
}

/**
 * rig 本体：挂在 beforeModelUpdate 上。
 * 每帧先 resolveRig() 把三层解析成「这一刻该显示什么」——
 * 所以一次性反应一过期，对应的参数立刻进入淡出，不需要任何人来清理。
 */
export function applyRig() {
  if (!R.coreModel) return
  resolveRig()
  const now = performance.now()
  const dt = Math.min(64, now - (applyRig._last || now)) / 1000
  applyRig._last = now

  const targets = rigTargets
  targets.clear()
  if (rig.face) targets.set(rig.face, 1)
  for (const name of rig.props) targets.set(name, 1)

  // 权重推进：进得慢一点、退得快一点，观感更像「变脸」而不是硬切
  for (const name of Array.from(rig.weight.keys())) {
    const target = targets.get(name) || 0
    let w = rig.weight.get(name) || 0
    const speed = target > w ? 7 : 11
    w += (target - w) * clamp(dt * speed, 0, 1)
    if (target === 0 && w < 0.02) rig.weight.delete(name)
    else rig.weight.set(name, w)
  }
  for (const name of targets.keys()) {
    if (!rig.weight.has(name)) rig.weight.set(name, 0)
  }

  // —— 参数独占 ——
  // 主人要求「每次脸上只能有一个表情，不能两个表情叠在一起」。
  // 光靠「一个 face + 若干道具」还不够：有些道具本身也写脸部参数
  // （比如墨镜会写 ParamEyeLOpen），叠上去就会打架。
  // 所以这里做一个裁决：每个参数在同一时刻只允许**一个**表达式写，
  // 优先级 脸 > 道具（按加入顺序）。
  const delta = rigDelta
  const claimed = rigClaimed
  delta.clear()
  claimed.clear()
  let skipped = 0
  const add = (id, v) => delta.set(id, (delta.get(id) || 0) + v)
  const winners = []
  if (rig.face && (rig.weight.get(rig.face) || 0) > 0) winners.push(rig.face)
  for (const name of rig.props) if (name !== rig.face && (rig.weight.get(name) || 0) > 0) winners.push(name)
  for (const name of winners) {
    const w = rig.weight.get(name) || 0
    const params = EXPR[name]
    if (!params) continue
    for (const p of params) {
      if (claimed.has(p.id)) {
        skipped++ // 这个参数已经被更高优先级的表情写了
        continue
      }
      claimed.add(p.id)
      add(p.id, p.value * w)
    }
  }
  // 正在淡出的表情不参与裁决，权重照常推进（它们本来就没抢到参数）
  for (const name of rig.weight.keys()) {
    if (winners.indexOf(name) >= 0) continue
    const w = rig.weight.get(name) || 0
    const params = EXPR[name]
    if (!params || w <= 0) continue
    for (const p of params) {
      if (claimed.has(p.id)) continue
      claimed.add(p.id)
      add(p.id, p.value * w)
    }
  }

  // 说话口型：只在真的在吐字时才动嘴，空闲时嘴巴是放松的
  if (CFG.talkMouth && rig.talking) {
    rig.talkPhase += dt
    add('ParamMouthOpenY', 0.28 + 0.16 * Math.sin(rig.talkPhase * 11))
  }

  // 一次性参数脉冲（爱心粒子 / 心跳），到期自动停
  if (rig.burst) {
    if (performance.now() > rig.burst.until) rig.burst = null
    else {
      if (rig.burst.love) add('love', rig.burst.love)
      if (rig.burst.heartbeat) add('ParamCheek73', rig.burst.heartbeat)
    }
  }

  // —— 眨眼（自然节奏，见 blinkTick）——
  blinkTick(now, claimed.has('ParamEyeLOpen') || claimed.has('ParamEyeROpen'), motionActive())

  // —— 眼睛自愈 ——
  // 万一还有哪条路径把「睁眼」参数冻在 0（闭眼），这里把它纠回来。
  // 只在「没有动作在播 + 我们自己的表情/道具都没认领眼睛参数 + 已经闭了 1.5 秒以上」时才动手，
  // 所以不会跟眨眼（一次 0.1 秒）、也不会跟「闭眼口水」这种真的闭眼表情打架。
  if (R.coreModel && R.model && !rig.eyesHeal) rig.eyesHeal = { since: 0, warned: false }
  if (rig.eyesHeal) {
    const eL = 'ParamEyeLOpen'
    const eR = 'ParamEyeROpen'
    const claimedEye = claimed.has(eL) || claimed.has(eR)
    const motionOn = motionActive()
    const v = eyesOpen()
    if (!claimedEye && !motionOn && v !== null && v < 0.25) {
      if (!rig.eyesHeal.since) rig.eyesHeal.since = now
      else if (now - rig.eyesHeal.since > 1500) {
        for (const id of [eL, eR]) {
          const d = paramDefault(id)
          if (d !== null) {
            try {
              R.coreModel.setParameterValueById(id, d)
            } catch (e) {}
          }
        }
        try {
          R.coreModel.saveParameters()
        } catch (e) {}
        rig.eyesHeal.since = 0
        if (!rig.eyesHeal.warned) {
          rig.eyesHeal.warned = true
          log('检测到眼睛被冻住，已按默认值纠回（自愈）')
        }
      }
    } else {
      rig.eyesHeal.since = 0
    }
  }

  // 诊断：这一帧有多少次「因为参数已被占用而放弃写入」。
  // 它 > 0 就说明独占裁决真的在起作用（两个表情想写同一个参数时被打回）。
  rig.exclusive = { written: delta.size, skipped, writers: winners }
  for (const [id, v] of delta) {
    if (Math.abs(v) < 0.001) continue
    try {
      R.coreModel.addParameterValueById(id, v)
    } catch (e) {}
  }
}
