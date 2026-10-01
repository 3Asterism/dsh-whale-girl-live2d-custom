/** api/debug.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { handleEvent } from '../behavior/events.js'
import { idle } from '../behavior/idle.js'
import { menuStatusLine, playAction } from '../behavior/menu-actions.js'
import { PAGE, pageIntent } from '../behavior/page.js'
import { pokeState, pokeTier, pokeTierForGaps } from '../behavior/poke.js'
import { resetEverything } from '../behavior/reset.js'
import { EXPR, R, activeSubagents, agent, bond, droppedParams } from '../core/state.js'
import { bondAct, bondAwayCheck, bondRefresh, feedGift, maybeOfferStory, playStory, setBondEnabled } from '../behavior/bond.js'
import { FLAG } from '../director/conds.js'
import { DIR, chatLevel, perform, performingNow } from '../director/perform.js'
import { blink, eyesOpen, paramDefault, paramValue } from '../engine/blink.js'
import { gaze, gazeCfg } from '../engine/gaze.js'
import { hitTest, mask } from '../engine/mask.js'
import { clearMotionPose, motionActive, motionTimer, playMotion } from '../engine/motion.js'
import { clearProps, clearReaction, clearUserFace, rig, setBase, setProp, setReaction, setUserFace } from '../engine/rig.js'
import { PERF, setLowPower } from '../engine/runtime.js'
import { device, work } from '../engine/work.js'
import { ACTIONS, ACTION_KEYS, BASE_ITEMS, PROPS, SCENES } from '../persona/items.js'
import { MOOD_FACE } from '../persona/moods.js'
import { FACE_ACT, PROP_ACT, SCENE_ACT } from '../persona/reactions.js'
import { closeHud, hud, hudFetch, openHud } from '../ui/hud.js'
import { headScreenX } from '../ui/layout.js'
import { setHidden } from '../ui/panels.js'

// ——————————————————————————————————————————————————————————————
// 十二、对外小接口（控制台调试 / 扩展）
// ——————————————————————————————————————————————————————————————
window.DSHPet = {
  setBase,
  setReaction,
  clearReaction,
  setUserFace,
  clearUserFace,
  setProp,
  clearProps,
  playMotion,
  hitTest,
  /** 隐藏 / 恢复。壳子（桌面版）收起成小球后，靠它把页面里的状态一起改回来 */
  setHidden,
  /** 性能档：壳子/设置页用它切「低性能模式」 */
  setLowPower,
  isLowPower: () => PERF.low,
  rebuildMask: () => {
    mask.dirty = true
  },
  resetGazeStats: () => {
    gaze.stepRate = 0
  },
  /**
   * 诊断用：现在的「手速档位」。
   * 测试靠它验证「正常速度点击不会让她生气」。
   */
  pokeTier: () => pokeTier(),
  /** 诊断用：给一串点击间隔（毫秒），纯计算出会落哪一档。 */
  pokeTierFor: (gaps) => pokeTierForGaps(gaps || []),
  /** 诊断用：清空连点记录。 */
  clearPokes: () => {
    pokeState.times.length = 0
    pokeState.softAt = 0
    pokeState.angerAt = 0
  },
  resetEverything,
  /** 编排层诊断：最近的决策（接受 / 丢弃 / 原因）、正在演什么、持续型状态、亲密度。撞车问题先看这里。 */
  director: {
    trace: () => DIR.log.slice(),
    current: () => {
      const c = performingNow()
      return c ? { id: c.id, pri: c.pri, left: Math.round(c.until - performance.now()) } : null
    },
    flags: () => Object.assign({}, FLAG, { subagents: activeSubagents.size }),
    conds: () => Array.from(rig.cond.keys()),
    perform: (spec) => perform(spec),
    clear: () => {
      DIR.log.length = 0
      DIR.cool.clear()
      DIR.habit.clear()
      DIR.cur = null
    },
    chat: () => chatLevel(),
  },
  /** 羁绊系统：前端镜像与手动触发（测试 / 调试用）。规则在宿主 lib/bond。 */
  bond: {
    state: () => Object.assign({}, bond, { snap: undefined }),
    snap: () => bond.snap,
    refresh: () => bondRefresh(),
    act: (kind) => bondAct(kind),
    feed: (item) => feedGift(item),
    story: (level, opts) => playStory(level, opts),
    offer: () => maybeOfferStory(),
    away: () => bondAwayCheck(),
    toggle: (on) => setBondEnabled(on),
  },
  /** DSH 界面操作识别：最近点过的标签（校准 PAGE_ACTIONS 用）、手动触发一个界面动作。 */
  page: { recent: () => PAGE.recent.slice(), intent: (k) => pageIntent(k) },
  /** 诊断用：直接喂一条宿主事件（跟 SSE 推来的一样），撞车测试 / 预览服务器用。 */
  sim: (m) => handleEvent(m),
  /**
   * 诊断用：菜单现在的样子（按钮名、当前状态行）。
   * 测试用它验证「同一个表情不会出现两次」「点每一项都真的有台词」。
   */
  menu() {
    const chips = []
    if (R.ui && R.ui.menu && R.ui.menu.el) {
      for (const c of R.ui.menu.el.querySelectorAll('.dshp-chip')) {
        chips.push({ label: c.textContent, on: c.classList.contains('dshp-on'), title: c.title })
      }
    }
    return {
      open: !!(R.ui && R.ui.menu && R.ui.menu.el && R.ui.menu.el.classList.contains('dshp-on')),
      focused: R.ui && R.ui.menu ? R.ui.menu.focused : null,
      status: menuStatusLine(),
      chips,
      userProps: Array.from(rig.userProps),
      face: rig.user.face,
    }
  },
  /** 诊断用：某个菜单项配的台词（验证「每一项都有话可说」）。 */
  itemLines(kind, key) {
    const t = kind === 'face' ? FACE_ACT : kind === 'decor' ? PROP_ACT : kind === 'action' ? ACTIONS : SCENE_ACT
    return (t && t[key] && t[key].lines) || null
  },
  /** 诊断用：一次动作有哪些可选（测试逐项点一遍）。 */
  actions() {
    return ACTION_KEYS.map((k) => ({ key: k, label: ACTIONS[k].label, expr: ACTIONS[k].expr || null, motion: ACTIONS[k].motion || null, ms: ACTIONS[k].ms }))
  },
  /** 诊断用：直接演一个一次性动作。 */
  playAction: (key) => playAction(key),
  /** 诊断用：某个动作会写哪些参数 / 这些参数当前的值（验证「动作停了姿势有没有清掉」）。 */
  motionParams(group) {
    const meta = (R.manifest && R.manifest.motions && R.manifest.motions[group]) || null
    const ids = meta ? meta.params || [] : []
    const read = (id) => {
      try {
        return typeof R.coreModel.getParameterValueById === 'function'
          ? +R.coreModel.getParameterValueById(id).toFixed(4)
          : null
      } catch (e) {
        return null
      }
    }
    const def = (id) => {
      try {
        return typeof R.coreModel.getParameterDefaultValue === 'function'
          ? +R.coreModel.getParameterDefaultValue(id).toFixed(4)
          : null
      } catch (e) {
        return null
      }
    }
    return { group, ids: ids.slice(0, 8), total: ids.length, values: ids.map(read), defaults: ids.map(def) }
  },
  /** 诊断用：读某个参数当前值 / 默认值；eyes() 返回眼睛睁开程度（0 闭 1 睁）。 */
  paramValue: (id) => paramValue(id),
  paramDefault: (id) => paramDefault(id),
  eyes: () => eyesOpen(),
  /** 诊断用：眨眼的当前状态（测试用它数「15 秒眨了几次」）。 */
  blink: () => ({ phase: blink.phase, gate: blink.gate, count: blink.count,
    nextIn: Math.max(0, Math.round(blink.nextAt - performance.now())) }),
  /** 诊断用：主动清一次动作姿势（测试与 /control 都能用）。 */
  clearMotionPose: () => clearMotionPose(),
  /** 诊断用：HUD（余额/计价面板）状态与当前显示的文字。 */
  hud: {
    open: () => hud.open,
    show: (opts) => openHud(opts || { flash: true }),
    hide: () => closeHud(),
    refresh: () => hudFetch(true),
    read: () => ({
      open: hud.open,
      source: hud.source || null,
      peak: hud.data ? hud.data.isPeak : null,
      balance: hud.data ? hud.data.totalBalance : null,
      currency: hud.data ? hud.data.currency : null,
      todayUsage: hud.data ? hud.data.todayUsage : null,
      turn: hud.turn ? { amount: hud.turn.amount, tokens: hud.turn.tokens, seq: hud.turn.seq } : null,
      left: hud.left === undefined ? null : hud.left,
      err: hud.err,
      text: R.ui && R.ui.hud
        ? {
            badge: R.ui.hud.badge.textContent,
            badgeClass: R.ui.hud.badge.className,
            money: R.ui.hud.money.textContent,
            today: R.ui.hud.today.textContent,
            turn: R.ui.hud.turn.textContent,
            countdown: R.ui.hud.countdown.textContent,
            foot: R.ui.hud.foot.textContent,
          }
        : null,
    }),
  },
  /**
   * 诊断用：把当前画面降采样成一小撮像素。
   * 测试工具靠它做「施加某个表情前后画面有没有变化」的客观比对——
   * 比肉眼看「这个按钮点了好像没反应」靠谱得多。
   */
  sampleCanvas(size) {
    if (!R.app || !R.app.view || !R.app.view.width) return null
    const W = size || 40
    const H = Math.max(6, Math.round((W * R.app.view.height) / R.app.view.width))
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const g = c.getContext('2d', { willReadFrequently: true })
    g.clearRect(0, 0, W, H)
    g.drawImage(R.app.view, 0, 0, W, H)
    const d = g.getImageData(0, 0, W, H).data
    const out = new Array(d.length)
    for (let i = 0; i < d.length; i++) out[i] = d[i]
    return out
  },
  /** 诊断用：某个表达式会写哪些参数、这些参数模型里有没有。 */
  describe(name) {
    const ps = EXPR[name]
    if (!ps) return null
    return {
      params: ps.map((p) => ({ id: p.id, value: p.value, exists: R.MODEL_PARAMS.has(p.id) })),
      allExist: ps.every((p) => R.MODEL_PARAMS.has(p.id)),
    }
  },
  /** 诊断用：列出所有可用表情名与道具 key。 */
  catalog() {
    return {
      expressions: Object.keys(EXPR),
      // 菜单的三类：装饰（常驻）/ 场景（常驻）/ 动作（一次性）
      props: Object.keys(PROPS),
      decor: Object.keys(PROPS),
      scenes: Object.keys(SCENES),
      actions: ACTION_KEYS,
      baseItems: Object.keys(BASE_ITEMS),
      moods: Object.keys(MOOD_FACE),
      motions: R.manifest ? Object.keys(R.manifest.motions || {}) : [],
    }
  },
  get state() {
    return {
      agent: Object.assign({}, agent),
      mood: R.mood,
      face: rig.face,
      props: Array.from(rig.props),
      // 诊断用：三层状态各自持有什么，以及「干活轮播/小设备」的开关。
      // 卡住类 bug 全靠这几个字段定位（比如底层还挂着某个道具、轮播还在跑）。
      // 注意：base 这个字段名下面（对象末尾）已经用来放「底层情绪字符串」了，
      // 要保持兼容，所以这里第二个字段叫 baseMood/baseProps。
      userProps: Array.from(rig.userProps),
      overrideProps: rig.override ? (rig.override.props || []).slice() : null,
      overrideLeft: rig.override ? Math.max(0, Math.round(rig.override.until - performance.now())) : 0,
      work: { active: work.active, i: work.i },
      device: { out: device.out },
      modelSize: R.model ? { w: R.model.internalModel.width, h: R.model.internalModel.height } : null,
      view: R.lastView,
      panels: (() => {
        const read = (el) => {
          if (!el) return null
          const cs = getComputedStyle(el)
          const r = el.getBoundingClientRect()
          return {
            on: el.classList.contains('dshp-on'),
            shift: cs.getPropertyValue('--dshp-shift').trim() || '0px',
            left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
          }
        }
        return {
          headX: Math.round(headScreenX()),
          rootCenter: R.ui && R.ui.root ? Math.round(R.ui.root.getBoundingClientRect().left + R.ui.root.getBoundingClientRect().width / 2) : null,
          menu: read(R.ui && R.ui.menu && R.ui.menu.el),
          composer: read(R.ui && R.ui.composer && R.ui.composer.el),
          hud: read(R.ui && R.ui.hud && R.ui.hud.el),
        }
      })(),
      placement: (() => {
        const r = R.ui && R.ui.root ? R.ui.root.getBoundingClientRect() : null
        return {
          edge: (R.ui && R.ui.root && R.ui.root.dataset.edge) || null,
          left: r ? Math.round(r.left) : null,
          top: r ? Math.round(r.top) : null,
          right: r ? Math.round(window.innerWidth - r.right) : null,
          bottom: r ? Math.round(window.innerHeight - r.bottom) : null,
        }
      })(),
      contentBox: R.contentBox,
      exclusive: rig.exclusive || null,
      motion: { playing: !!motionTimer || motionActive(), active: motionActive() },
      acting: R.acting ? { left: Math.max(0, Math.round(R.acting.until - performance.now())) } : null,
      // 诊断用：视线控制器 + 框架里真正生效的焦点值（测试靠它验证「有没有阻尼住」）
      gaze: {
        x: +gaze.x.toFixed(4),
        y: +gaze.y.toFixed(4),
        mode: gaze.mode,
        detached: performance.now() < gaze.detachUntil,
        stepRate: +(gaze.stepRate || 0).toFixed(3),
        fcX: gaze.fcX === undefined ? null : +gaze.fcX.toFixed(4),
        fcErr: gaze.fcErr || null,
        limit: gazeCfg().rate,
      },
      focus: R.model
        ? {
            x: +R.model.internalModel.focusController.x.toFixed(4),
            y: +R.model.internalModel.focusController.y.toFixed(4),
          }
        : null,
      override: rig.override ? { mood: rig.override.mood, until: Math.round(rig.override.until - performance.now()) } : null,
    base: rig.base.mood,
    baseMood: rig.base.mood,
    baseProps: rig.base.props.slice().sort(),
      idleSleep: idle.sleep,
      droppedParams: Array.from(droppedParams),
      expressions: Object.keys(EXPR),
      motions: R.manifest ? Object.keys(R.manifest.motions || {}) : [],
    }
  },
}
