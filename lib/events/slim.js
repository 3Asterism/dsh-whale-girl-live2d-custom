/**
 * 会话事件 → 前端要的紧凑消息（纯函数，可单测）。
 */

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * 会话事件 → 前端要的紧凑消息。纯函数：不认识的类型返回 null，缺字段一律容错。
 * 只转发「能让她演点什么」的那几种，别的原始事件不出宿主。
 * 字段已对照 DSH 0.2.0-rc.2 源码核实；拿不准的字段只取存在的，取不到给 null，前端按 null 降级。
 */
export function slimSessionEvent(type, d) {
  d = d || {}
  switch (type) {
    case 'todo/write': {
      const todos = Array.isArray(d.todos) ? d.todos : []
      let done = 0
      let doing = 0
      for (const t of todos) {
        if (!t) continue
        if (t.status === 'completed') done++
        else if (t.status === 'in_progress') doing++
      }
      return { k: 'todo', total: todos.length, done, doing }
    }
    case 'plan/mode':
      return { k: 'plan', active: d.active === true }
    case 'compaction/start':
      return { k: 'compaction', phase: 'start' }
    case 'compaction/end':
      return { k: 'compaction', phase: 'end' }
    case 'goal/change': {
      const g = d.goal && typeof d.goal === 'object' ? d.goal : {}
      return { k: 'goal', phase: typeof g.phase === 'string' ? g.phase : null }
    }
    case 'deliverables/presented':
      return { k: 'deliver', count: Array.isArray(d.files) ? d.files.length : 1 }
    case 'llm/retry':
      return {
        k: 'retry',
        retry: num(d.retry),
        max: num(d.maxRetries),
        delayMs: num(d.delayMs),
        code: d.failure && typeof d.failure.code === 'string' ? d.failure.code : null,
      }
    case 'llm/retry-started':
      return { k: 'retry-started' }
    case 'approval/policy':
      return { k: 'policy', policy: d.policy === 'never' ? 'never' : 'ask' }
    default:
      return null
  }
}

/** 需要写探测日志的事件类型（slim 的白名单 + 几个拿不准载荷的）。 */
export const TRACE_TYPES = new Set([
  'todo/write', 'plan/mode', 'compaction/start', 'compaction/end', 'goal/change',
  'deliverables/presented', 'llm/retry', 'llm/retry-started', 'approval/policy',
  'approval/asked', 'approval/decided', 'feedback/record', 'feedback/message-put',
])
