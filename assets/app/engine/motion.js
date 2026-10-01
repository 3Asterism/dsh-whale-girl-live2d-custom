/** engine/motion.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { MOTION_PRIORITY } from '../config.js'
import { R } from '../core/state.js'
import { log } from '../core/util.js'
import { paramDefault } from './blink.js'
import { resolveRig, rig } from './rig.js'
import { device } from './work.js'

/**
 * 任何路径都不许再播的动作。
 *   bubble   —— 主人点名踢掉（老会卡住）
 *   aidale   —— 「伸展」，内部驱动 15 个表情参数，一播就多个表情同时亮
 *   selfie*  —— 同上，自带 10 个表情参数
 */
const FACE_DRIVING_MOTIONS = new Set(['bubble', 'aidale', 'selfie', 'selfieQuick'])

const BANNED_MOTIONS = FACE_DRIVING_MOTIONS

/**
 * 动作是否正在播。
 * 不用框架的 `motionManager.isFinished()` —— 实测它空闲时也返回「没结束」，
 * 会让「动作期间不眨眼」永远成立（之前眨眼就是这么被憋住的）。
 * 改成我们自己记账：起动作时按清单里的时长记一个截止时间。
 */
let motionUntil = 0

export function motionActive() {
  return performance.now() < motionUntil
}

export function playMotion(group, priority) {
  if (!R.model || !R.manifest) return
  if (BANNED_MOTIONS.has(group)) return
  if (!R.manifest.motions || !R.manifest.motions[group]) {
    log('没有这个动作：', group)
    return
  }
  const dur = Number(R.manifest.motions[group].duration) || 1.5
  motionUntil = performance.now() + dur * 1000 + 120
  try {
    // 第三参是优先级（数字）：FORCE 才能盖过常驻待机循环
    R.model.motion(group, 0, priority == null ? MOTION_PRIORITY.FORCE : priority)
  } catch (e) {
    console.warn('[鲸鱼娘] 动作播放失败', group, e)
  }
}

export let motionTimer = null

/**
 * 停掉当前表演：取消一次性表情、爱心脉冲、一次性动作，
 * 回到「底层状态 + 常驻待机动作」——主人说的「先变回平常状态」。
 */
export function stopActing() {
  R.acting = null
  if (motionTimer) {
    clearTimeout(motionTimer)
    motionTimer = null
  }
  rig.override = null
  rig.burst = null
  resolveRig()
  // 把所有动作停掉，回到模型的**默认姿势**（配合物理/呼吸/眨眼就是「正常坐姿」）。
  //
  // 这里**不再播 motions/idle.motion3.json**：那套资产里的 "idle" 其实是
  // 猫爪摆动 + 爱心粒子的循环动画（89 条曲线里 maoshou*/j* 就是它们），
  // 一直循环会让人看到「手在这摆」和「一长串莫名的待机动作」。
  //
  // 例外：干活时如果小设备已经掏出来了（查资料），别把它收掉——
  // 互动只是插一下，互动完要回到「正在查资料」的样子。
  if (!device.out) stopMotion()
}

/**
 * 把所有「动作会写的参数」复位到模型默认值，并重存一次框架的参数快照。
 *
 * 为什么必须手动做（踩了很久才查明白）：pixi-live2d-display 每帧的顺序是
 *     动作写入 → saveParameters() 存快照 → 眨眼/视线/呼吸/物理 → beforeModelUpdate(我们的 rig)
 *     → coreModel.update() → loadParameters() 把快照装回来
 * 也就是说**快照是在动作写入之后存的**。动作一旦停下，快照里留的就是它最后一帧的姿势，
 * 而 loadParameters() 每帧都会把这份姿势装回来 —— 表现就是主人报的
 * 「蛋包饭点过以后永远挂在桌上、手机收不回去、表情也回不去，连一键重置都没用」。
 * 所以停动作时要做两件事：① 把这些参数设回默认值 ② 重新 save 一次，把快照换成默认姿势。
 */
export function clearMotionPose() {
  if (!R.coreModel || !R.manifest) return 0
  const ids = new Set()
  for (const meta of Object.values(R.manifest.motions || {})) {
    for (const id of meta.params || []) ids.add(id)
  }
  let n = 0
  let bad = 0
  for (const id of ids) {
    try {
      const def = paramDefault(id)
      // 取不到默认值的参数一律**不要碰**！之前就是在这里把「睁眼」参数当成了 0，
      // 结果把眼睛永久设成闭着的（主人报的「一直闭着眼，啥也干不了」）。
      if (def === null) { bad++; continue }
      if (typeof R.coreModel.setParameterValueById === 'function') R.coreModel.setParameterValueById(id, def)
      n++
    } catch (e) {}
  }
  if (bad && !clearMotionPose._warned) {
    clearMotionPose._warned = true
    log(`有 ${bad} 个动作参数取不到默认值，已跳过（绝不猜 0）`)
  }
  try {
    if (typeof R.coreModel.saveParameters === 'function') R.coreModel.saveParameters()
  } catch (e) {}
  return n
}

/** 停掉所有正在播的动作，让模型回到默认姿势。 */
export function stopMotion() {
  motionUntil = 0
  try {
    const mm = R.model && R.model.internalModel && R.model.internalModel.motionManager
    if (mm && typeof mm.stopAllMotions === 'function') mm.stopAllMotions()
  } catch (e) {}
  // 光停动作不够：还得把「动作留下的姿势」从参数快照里清掉，否则它会永远挂着
  clearMotionPose()
}

/** 一次性动作：到点自己回到常驻待机（动作也是一次只能一个）。 */
export function playOneShot(group) {
  if (!R.manifest || !R.manifest.motions || !R.manifest.motions[group]) return
  const durS = Number(R.manifest.motions[group].duration) || 2
  stopMotion() // 先清干净，再起新的——动作永远只有一个
  playMotion(group, MOTION_PRIORITY.FORCE)
  if (motionTimer) clearTimeout(motionTimer)
  // 到点一定收掉——不管模型里那个动作自己是不是 Loop=true。
  // （aidale / idle 这些资产内部写着循环，不主动停就会一直播下去。）
  motionTimer = setTimeout(() => {
    motionTimer = null
    if (!device.out) stopMotion()
  }, Math.round(durS * 1000) + 150)
}
