/** behavior/sev.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { noteProcess } from './events.js'
import { pageIntent } from './page.js'
import { FLAG, retryEvent, syncConds } from '../director/conds.js'
import { digest } from '../director/digest.js'
import { PRI, perform } from '../director/perform.js'
import { qBounce } from '../engine/effects.js'
import { bondAct } from './bond.js'
import { handleSoulSev } from './soul.js'

// ——————————————————————————————————————————————————————————————
// 白名单事件（宿主裁剪后推来的 sev）与新建会话
// ——————————————————————————————————————————————————————————————

/** 宿主 slimSessionEvent 裁剪后推来的 { t:'sev', k, ... }：每一项都只是「记一笔」或「演一个提示」。 */
export function handleSev(m) {
  switch (m.k) {
    case 'todo': {
      const prev = digest.todoDone
      digest.todoTotal = m.total || 0
      digest.todoDone = m.done || 0
      // 清单每完成一项：只弹一下 + 脚注 3/7，不换脸不说话（最后一项交给收工表演）
      if (digest.todoDone > prev && digest.todoDone < digest.todoTotal) {
        qBounce(0.5)
        noteProcess(`清单 ${digest.todoDone}/${digest.todoTotal}`)
      }
      break
    }
    case 'plan':
      if (!!m.active === FLAG.plan) break
      FLAG.plan = !!m.active
      syncConds() // 方眼镜（应景装扮）
      perform({ id: m.active ? 'plan-on' : 'plan-off', pri: PRI.CUE, tier: 'extra', say: m.active ? 'planOn' : 'planOff', ms: 2400, cool: 3000 })
      break
    case 'compaction':
      onCompaction(m.phase)
      break
    case 'goal':
      if (m.phase === 'complete') digest.goalDone = true // 收工时一起演（蛋包饭）
      else if (m.phase === 'active') perform({ id: 'goal-set', pri: PRI.CUE, tier: 'extra', mood: 'alert', say: 'goalSet', ms: 2200, cool: 8000 })
      break
    case 'deliver':
      digest.deliver += m.count || 1 // 不当场演：收工时合并成一次「自拍留念」
      break
    case 'retry':
      retryEvent(m)
      break
    case 'policy': {
      const on = m.policy === 'never'
      if (on === FLAG.yolo) break
      FLAG.yolo = on
      syncConds() // 墨镜（应景装扮）
      perform({ id: on ? 'yolo-on' : 'yolo-off', pri: PRI.CUE, tier: 'extra', mood: on ? 'smug' : undefined, say: on ? 'yoloOn' : 'yoloOff', ms: 2600, cool: 3000 })
      break
    }
    case 'feedback': {
      const up = m.rating === 'positive'
      perform({ id: 'feedback', pri: PRI.CUE, tier: 'extra', mood: up ? 'shy' : 'sad', props: up ? ['flower'] : [], say: up ? 'feedbackUp' : 'feedbackDown', ms: 2800, cool: 2000, habit: false })
      if (up) bondAct('praise')
      break
    }
    // v0.6.1：模型切换 / 权限 / 斜杠命令 / 智能体预设 / 定时任务（见 behavior/soul.js）
    default:
      handleSoulSev(m)
  }
}

// ——————————————————————————————————————————————————————————————
// 压缩 / 整理记忆：开始 → （清掉旧工具结果 / 写摘要）→ 结束；拖得久了补一句
// ——————————————————————————————————————————————————————————————
const COMPACT = { at: 0, timer: null }

function onCompaction(phase) {
  const now = performance.now()
  if (phase === 'start') {
    COMPACT.at = now
    clearTimeout(COMPACT.timer)
    // 整理记忆：拿橡皮擦。开始 / 结束各一句，结束比开始轻
    perform({ id: 'compact-start', pri: PRI.CUE, tier: 'extra', props: ['橡皮'], say: 'compactStart', ms: 2600, cool: 20000 })
    COMPACT.timer = setTimeout(() => {
      if (COMPACT.at) perform({ id: 'compact-long', pri: PRI.CUE, tier: 'extra', mood: 'sweat', say: 'compactLong', ms: 3000, cool: 60000 })
    }, 20000)
  } else if (phase === 'prune' || phase === 'summary') {
    // 刚开始那句还在说的时候不插嘴；清理 / 摘要两步共用一个冷却，免得连着刷
    if (!COMPACT.at || now - COMPACT.at < 1800) return
    perform({ id: 'compact-step', pri: PRI.CUE, tier: 'extra', say: phase === 'prune' ? 'compactPrune' : 'compactSummary', ms: 2400, cool: 5000 })
  } else {
    clearTimeout(COMPACT.timer)
    COMPACT.at = 0
    perform({ id: 'compact-end', pri: PRI.CUE, tier: 'extra', mood: 'happy', say: 'compactEnd', ms: 2400, cool: 20000 })
  }
}

/** 新建会话的语义兜底（DOM 点击是即时反馈，这里去重）。子代理也会建会话，按 origin 过滤。 */
export function sessionCreated(m) {
  FLAG.plan = false
  FLAG.yolo = false
  syncConds()
  if (m.blank !== true) return
  if (/subagent|fork|workflow|team|agent/i.test(String(m.origin || ''))) return
  pageIntent('newSession')
}
