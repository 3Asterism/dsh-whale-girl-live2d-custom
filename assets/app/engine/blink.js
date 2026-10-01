/** engine/blink.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { R } from '../core/state.js'

/**
 * 眨眼控制器。
 *
 * 主人要求：「不要眨太快、不要眨太慢，符合正常人眨眼速度，偶尔眨一眨」。
 * 人类大概是每 3~5 秒眨一次，单次 0.1~0.2 秒，偶尔会连眨两下。
 * 框架自带的实现是「下次眨眼 = random × 7 秒」，范围太野，所以这里自己来：
 *   · 间隔：2.6~5.4 秒随机；15% 概率紧接着再眨一下（连眨）
 *   · 单次时长：闭合 60ms + 闭合保持 30ms + 睁开 100ms ≈ 0.19 秒
 *   · 动作在播、或者有表情/道具正在写眼睛参数（比如「闭眼口水」）时**不眨**
 */
export const blink = { nextAt: 0, phase: 'idle', t0: 0, queue: 0, gate: '', count: 0 }

export function blinkTick(now, eyeClaimed, motionOn) {
  if (!R.coreModel) { blink.gate = 'no-model'; return }
  if (eyeClaimed || motionOn) {
    blink.gate = eyeClaimed ? 'eye-claimed' : 'motion-on'
    blink.phase = 'idle'
    blink.nextAt = now + 1200
    return
  }
  blink.gate = 'ok'
  const set = (v) => {
    try {
      R.coreModel.setParameterValueById('ParamEyeLOpen', v)
      R.coreModel.setParameterValueById('ParamEyeROpen', v)
    } catch (e) {}
  }
  const CLOSE = 60
  const HOLD = 30
  const OPEN = 100
  if (blink.phase === 'idle') {
    if (!blink.nextAt) blink.nextAt = now + 900 + Math.random() * 2600
    if (now >= blink.nextAt) {
      blink.phase = 'closing'
      blink.t0 = now
      blink.count++
      blink.queue = Math.random() < 0.15 ? 1 : 0 // 偶尔连眨两下
    } else {
      return
    }
  }
  const dt = now - blink.t0
  if (blink.phase === 'closing') {
    set(1 - Math.min(1, dt / CLOSE))
    if (dt >= CLOSE) {
      blink.phase = 'closed'
      blink.t0 = now
    }
  } else if (blink.phase === 'closed') {
    set(0)
    if (dt >= HOLD) {
      blink.phase = 'opening'
      blink.t0 = now
    }
  } else if (blink.phase === 'opening') {
    set(Math.min(1, dt / OPEN))
    if (dt >= OPEN) {
      blink.phase = 'idle'
      if (blink.queue > 0) {
        blink.queue = 0
        blink.nextAt = now + 180 // 连眨：紧接着再来一下
      } else {
        blink.nextAt = now + 2600 + Math.random() * 2800
      }
    }
  }
}

/**
 * 取某个参数的默认值。**框架的 getParameterDefaultValue 收的是「下标」不是 id**，
 * 传 id 会拿到 undefined —— 若拿不到就返回 null，调用方必须跳过这个参数，
 * 绝不能拿 0 当默认值（会把「睁眼」写成「闭眼」，就是那次事故）。
 */
export function paramDefault(id) {
  if (!R.coreModel) return null
  try {
    const idx = typeof R.coreModel.getParameterIndex === 'function' ? R.coreModel.getParameterIndex(id) : -1
    if (typeof idx !== 'number' || idx < 0) return null
    if (typeof R.coreModel.getParameterDefaultValue !== 'function') return null
    const d = R.coreModel.getParameterDefaultValue(idx)
    if (typeof d !== 'number' || !Number.isFinite(d)) return null
    return d
  } catch (e) {
    return null
  }
}

export function paramValue(id) {
  if (!R.coreModel) return null
  try {
    const v = R.coreModel.getParameterValueById(id)
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  } catch (e) {
    return null
  }
}

/** 眼睛当前睁着没：0 = 闭，1 = 睁（返回两只眼的平均值，方便诊断与自愈） */
export function eyesOpen() {
  const l = paramValue('ParamEyeLOpen')
  const r = paramValue('ParamEyeROpen')
  if (l === null && r === null) return null
  const vals = [l, r].filter((v) => v !== null)
  return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3)
}
