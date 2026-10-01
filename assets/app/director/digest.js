/** director/digest.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { FLAG } from './conds.js'

// —— 一轮的 digest：中途事件只记账，收工时才决定演哪一个 ——
export const digest = { todoDone: 0, todoTotal: 0, deliver: 0, goalDone: false, files: 0, errors: 0, tools: 0, startedAt: 0 }

export function resetDigest() {
  Object.assign(digest, { todoDone: 0, todoTotal: 0, deliver: 0, goalDone: false, files: 0, errors: 0, tools: 0, startedAt: Date.now() })
}

export const FILE_TOOLS = /^(write|edit|str_replace|str_replace_editor|apply_patch|docx_create|pdf_create|pptx_create|xlsx_write)$/

/**
 * 收工只演一个，按固定优先级选：
 * 目标达成（蛋包饭）> 有交付物（自拍留念）> 清单全部完成 ≥3 项（比耶）> 重活（墨镜）> 默认（装饰 + 开心脸）
 * 返回 { action | mood/props, say, id }；action 是 ACTIONS 里的键，走 playAction 复用「前置模式 / 自带表情不压脸」。
 */
export function finishFlavor(ms) {
  if (digest.goalDone) return { id: 'finish-goal', action: 'omurice', say: 'goalDone' }
  if (digest.deliver > 0) return { id: 'finish-deliver', action: 'selfie', say: 'deliver' }
  // 失败之后终于过了：比普通收工更用力地一起高兴（社畜最懂这种「终于」）
  if (FLAG.recovered) return { id: 'finish-recover', mood: 'happy', props: ['flower'], heart: true, say: 'finishRecover' }
  if (digest.todoTotal >= 3 && digest.todoDone === digest.todoTotal) return { id: 'finish-todo', action: 'doubleV', say: 'todoAll' }
  if (digest.tools >= 8 || (ms && ms > 180000)) return { id: 'finish-heavy', mood: 'smug', props: ['glassesSun'], say: 'finishHeavy' }
  return null
}
