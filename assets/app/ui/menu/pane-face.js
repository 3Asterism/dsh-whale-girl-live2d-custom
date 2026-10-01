/** ui/menu/pane-face.js —— 菜单「表情」页：按表情去重的一张脸，点一下演 3~4 秒后自己让位。 */

import { playItem } from '../../behavior/menu-actions.js'
import { EXPR } from '../../core/state.js'
import { $ } from '../../core/util.js'
import { PRI, perform } from '../../director/perform.js'
import { clearReaction, clearUserFace, rig } from '../../engine/rig.js'
import { IDLE_PROPS } from '../../persona/items.js'
import { MOOD_FACE } from '../../persona/moods.js'
import { FACE_ACT } from '../../persona/reactions.js'

/** @param panes 面板容器；rerender 点完之后重画本页 */
export function renderFacePane(panes, rerender) {
  const grid = $('div', 'dshp-grid')
  // 主人抱怨「星星眼重复了两次」——一个表情（参数组合）本来对应好几种情绪，
  // 旧的菜单按情绪列，于是同一个表情出现好几遍。这里按**表情**去重：
  // 一个表情只出一个按钮，鼠标悬停能看到它代表哪些情绪。
  const byExpr = new Map()
  // 主人明确不要的只有「圈圈眼（晕晕）」；呆呆眼另有判断。
  // 「闭眼口水」是原作者按键表里的正经表情（Alt+T），保留。
  const BANNED_MOODS = new Set(['dizzy'])
  for (const key of Object.keys(MOOD_FACE)) {
    if (key === 'neutral') continue
    const expr = MOOD_FACE[key]
    if (!expr || BANNED_MOODS.has(key)) continue
    if (!EXPR[expr] || expr === '呆呆眼' || expr === '晕晕') continue
    if (!byExpr.has(expr)) byExpr.set(expr, [])
    byExpr.get(expr).push(key)
  }
  const neutral = $('button', 'dshp-chip', '平常')
  if (!rig.override && !rig.user.face) neutral.classList.add('dshp-on')
  neutral.title = '立刻回到平常脸（她自己的表情也交还给她）'
  neutral.addEventListener('click', () => {
    clearUserFace()
    clearReaction()
    perform({ id: 'menu-neutral', pri: PRI.EXPLICIT, tier: 'core', habit: false, mood: 'neutral', props: IDLE_PROPS, ms: 800 })
    rerender()
  })
  grid.appendChild(neutral)
  for (const [expr, keys] of byExpr) {
    // 挑一个「有专属台词」的情绪名当代表，这样每个按钮点了都真有反应
    const rep = keys.find((k) => FACE_ACT[k]) || keys[0]
    const lines = (FACE_ACT[rep] && FACE_ACT[rep].lines) || []
    const b = $('button', 'dshp-chip', expr)
    // 亮着的判断看**当前这一次性表演**，不是看手动层：菜单里的表情是临时的，
    // 谁最后一个说话谁亮。
    if (rig.override && rig.override.face === expr) b.classList.add('dshp-on')
    b.title = keys.join(' / ') + (lines.length ? `\n她会说：${lines[0]}` : '')
    b.addEventListener('click', () => {
      // 主人要的规矩：菜单表情**不是手动常驻**，是「点一下演三四秒」——
      //   · 3~4 秒后自己让位，平常状态永远回到「平常脸」
      //   · 期间任何新表情（她自己挑的 / agent 事件 / 你再点一个）都会把它顶掉
      // 所以这里不写 30 秒的 rig.user 手动层，只走一次性 override。
      clearUserFace()
      playItem('face', rep)
      rerender()
    })
    grid.appendChild(b)
  }
  panes.append(
    grid,
    $('div', 'dshp-hint', '点一下 = 换脸 + 说一句配好的话，**三四秒后自己让位**（平常状态永远是平常脸）。\n期间她自己的表情、agent 事件、或者你再点一个，都会把它顶掉。'),
  )
}
