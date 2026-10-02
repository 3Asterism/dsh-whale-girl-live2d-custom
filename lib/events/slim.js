/**
 * 会话事件 → 前端要的紧凑消息（纯函数，可单测）。
 */

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v) => (typeof v === 'string' && v ? v.slice(0, 80) : null)
const SANDBOX_MODES = new Set(['read-only', 'workspace-write', 'danger-full-access'])
const SCHEDULE_OPS = new Set(['create', 'delete', 'dispatch'])

/** model/selection 与 request/header 共用的「用哪个模型」紧凑消息；缺 model 就当没这回事。 */
function modelMsg(src, cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {}
  const model = str(c.model)
  if (!model) return null
  return { k: 'model', src, provider: str(c.provider), model, effort: str(c.reasoningEffort === undefined ? null : String(c.reasoningEffort)) }
}

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
    // —— v0.6.1 新增（字段已对照 DSH 0.2.0-rc.2 源码核实；取不到的给 null，前端按 null 不触发）——
    // 用户在界面里切模型（下一次请求才生效）：{provider, model, reasoningEffort?}
    case 'model/selection':
      return modelMsg('selection', d)
    // 每次请求实际用的模型：header.config.{provider, model, reasoningEffort}。同模型的重复由 bridge 去重。
    case 'request/header':
      return modelMsg('request', d.header && d.header.config)
    case 'sandbox/mode':
      return { k: 'sandbox', mode: SANDBOX_MODES.has(d.mode) ? d.mode : null }
    case 'permission/preset':
      return { k: 'preset', preset: typeof d.preset === 'string' ? d.preset.slice(0, 40) : null }
    // 斜杠命令：只转发命令名，**不转 args**（args 可能是用户的原话）
    case 'command/run':
      return { k: 'command', name: typeof d.name === 'string' ? d.name.slice(0, 40) : null }
    case 'agent-preset/selected':
      return { k: 'persona', preset: typeof d.agentPreset === 'string' ? d.agentPreset.slice(0, 40) : null }
    // 定时任务：create（新建）/ delete / dispatch（到点触发）
    case 'schedule/change':
      return { k: 'schedule', op: SCHEDULE_OPS.has(d.operation) ? d.operation : null }
    default:
      return null
  }
}

/** 需要写探测日志的事件类型（slim 的白名单 + 几个拿不准载荷的）。 */
export const TRACE_TYPES = new Set([
  'todo/write', 'plan/mode', 'compaction/start', 'compaction/end', 'goal/change',
  'deliverables/presented', 'llm/retry', 'llm/retry-started', 'approval/policy',
  'approval/asked', 'approval/decided', 'feedback/record', 'feedback/message-put',
  'model/selection', 'request/header', 'sandbox/mode', 'permission/preset', 'command/run',
  'agent-preset/selected', 'schedule/change',
])
