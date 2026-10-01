/** behavior/menu-actions.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { EXPR, R, agent, bond } from '../core/state.js'
import { pickFresh } from '../core/util.js'
import { PRI, noteUser, perform, performingNow } from '../director/perform.js'
import { gaze } from '../engine/gaze.js'
import { rig, setProp, takeDeviceOut } from '../engine/rig.js'
import { device } from '../engine/work.js'
import { ACTIONS, ALL_TOGGLES, IDLE_PROPS } from '../persona/items.js'
import { lineFor } from '../persona/lines.js'
import { MOOD_FACE } from '../persona/moods.js'
import { FACE_ACT, PROP_ACT, SCENE_ACT } from '../persona/reactions.js'
import { SAY } from '../persona/say.js'

// ——————————————————————————————————————————————————————————————
// 八点五、菜单项「点了会怎样」
// ——————————————————————————————————————————————————————————————

/** 表情参数名 → 菜单里那个中文按钮名（同一个表情可能对应好几个情绪）。 */
function faceLabel(expr) {
  if (!expr) return '平常脸'
  for (const [key, e] of Object.entries(MOOD_FACE)) {
    if (e === expr && FACE_ACT[key]) return expr
  }
  return expr
}

/** 菜单顶上的「现在是什么状态」——免得主人不知道当前挂着什么。 */
export function menuStatusLine() {
  const parts = []
  parts.push(rig.user.face ? `${rig.user.face}（手动）` : faceLabel(rig.face))
  const userProps = Array.from(rig.userProps)
    .map((e) => Object.values(ALL_TOGGLES).find((d) => d.expr === e))
    .filter(Boolean)
    .map((d) => d.label)
  const baseProps = rig.base.props
    .map((e) => Object.values(ALL_TOGGLES).find((d) => d.expr === e))
    .filter(Boolean)
    .map((d) => d.label)
  if (userProps.length) parts.push('自己戴的：' + userProps.join('、'))
  if (baseProps.length) parts.push('常态：' + baseProps.join(' + '))
  if (device.out) parts.push('手机已掏出')
  const st = agent.status === 'idle' ? '待机' : '干活中'
  const pending = bond.enabled && bond.pending ? '\n她有话想对你说（见「好感」页）' : ''
  return `${st} · 现在：` + parts.join(' · ') + pending
}

/**
 * 演一个菜单项。
 *
 * 主人抱怨「点了没用、就卡在那」——所以菜单里每一项都不是「只是亮起来」，
 * 而是**一句话 + 一个表情 +（最多）一个小道具**，而且：
 *   · act() 先把上一次整个收掉 → 永远只有一件在演，不叠
 *   · 给一个到点就过期的 TTL → 不会卡住
 *   · 台词只在真的说了话的时候才占用气泡，不会连点刷屏
 */
export function playItem(kind, key) {
  const table = kind === 'face' ? FACE_ACT : kind === 'decor' ? PROP_ACT : SCENE_ACT
  const info = (table && table[key]) || {}
  const lines = info.lines || (SAY[key] ? SAY[key] : null)
  const line = lines && lines.length ? pickFresh(lines, kind + '-' + key) : undefined
  const mood = info.mood || (kind === 'face' ? key : 'happy')
  // 菜单表情是临时的：3.6 秒（主人说的「三四秒、反正会被覆盖掉」）
  const ms = info.ms || (kind === 'face' ? 3600 : 3200)
  if (info.lean) {
    // 低头看本子（眼镜类的「仔细看看」）。空闲兜底会把它复位，不会留后遗症。
    gaze.biasTarget = -0.3
    setTimeout(() => {
      if (!rig.override) gaze.biasTarget = 0
    }, ms + 400)
  }
  // 装饰/场景的开关本身由 setProp 负责（那一层是「一直存在」），
  // 这里只负责「她说点什么 + 换个配得上的表情」。
  // 主人点的菜单项：显式、最高优先级、必须有反应（不走习惯化 / 话痨度）
  noteUser()
  return perform({ id: 'menu-' + kind + '-' + key, pri: PRI.EXPLICIT, tier: 'core', habit: false, mood, line, props: IDLE_PROPS, heart: !!info.heart, ms })
}

/**
 * 演一个一次性动作（猫爪、比耶、心跳、蛋包饭…）。
 *
 * 关键区别：**动作只走 override 层**（act 的 TTL 到期就没了），
 * 绝不写进 rig.userProps，所以不会像装饰品/场景那样一直挂着。
 * 「蛋包饭挤完酱就消失」就是靠这个——表达式蛋包饭 + 挤番茄酱动作，
 * 到点一起收走。
 */
export function playAction(key, opts) {
  opts = opts || {}
  const a = ACTIONS[key]
  if (!a) return 0
  // 会被更高优先级的在演反应拦掉的话，别白白先掏手机 / 摆前置
  const cur = performingNow()
  if (cur && cur.pri > (opts.pri == null ? PRI.EXPLICIT : opts.pri)) return 0
  // 前置模式（照原作者的设计：自拍类得先掏出手机）
  if (a.requires) {
    const need = ALL_TOGGLES[a.requires]
    if (need && need.device) takeDeviceOut()
    else setProp(a.requires, true)
  }
  const expr = a.expr && EXPR[a.expr] ? a.expr : null
  const motion = a.motion && R.manifest && R.manifest.motions && R.manifest.motions[a.motion] ? a.motion : undefined
  // mood === null 的动作（自带表情变化的动画）**不压自己的脸**：
  // 压上去就是「冲突/覆盖」，会把她动画里的表情盖掉。
  const noFace = a.mood === null
  // 默认是菜单里点的（显式、最高优先级、必须有反应）；收工 / 日常表演会传自己的 pri / id / say
  return perform({
    id: opts.id || 'action-' + key,
    pri: opts.pri == null ? PRI.EXPLICIT : opts.pri,
    tier: opts.tier || 'core',
    habit: false,
    mood: noFace ? 'neutral' : a.mood || 'happy',
    face: noFace && !expr ? null : undefined,
    props: expr ? IDLE_PROPS.concat([expr]) : IDLE_PROPS,
    line: opts.line !== undefined ? opts.line : opts.say ? lineFor(opts.say) : pickFresh(a.lines, 'action-' + key),
    heart: !!a.heart,
    motion,
    ms: a.ms || 3000,
  })
}
