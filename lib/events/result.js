/**
 * 工具结果 → 前端要的紧凑信息（纯函数，可单测）。
 *
 * 字段已对照 DSH 0.2.0-rc.2 源码核实（dsh-agent-loop 的 appendToolResult、dsh-llm 的 createToolResultMessage、dsh-acp 读它的方式）：
 *   · tool/result 事件的 data = { turn, step, message, error?, meta? }；
 *   · message 是 tool 角色消息：**调用 id 在 message.toolCallId**（也在 message.source.callId），不是 content[0].toolCallId；
 *     content 是内容块数组，文本块是 { type: 'text', text }；isError 只代表「基础设施失败」（起不来进程 / 被中止）；
 *   · bash / pwsh 工具对**非零退出码不报错**：结果文本末尾追加标记行 —— `[exit code: N]` / `[timed out after Nms]` /
 *     `[stopped: …]` / `[killed by signal: X]` / `[sandbox: … denied …]`；放到后台的命令是 `[still running after Nms; moved to background job J]`。
 *
 * 隐私：**只抽标记里的数字 / 布尔，不转输出文本**（输出可能带密钥、路径、源码）。
 */

/** 取调用 id：新形态 message.toolCallId → message.source.callId → 旧夹具的 content[0].toolCallId。 */
export function callIdOf(message) {
  const m = message && typeof message === 'object' ? message : {}
  const id = m.toolCallId || (m.source && m.source.callId) || (Array.isArray(m.content) && m.content[0] && m.content[0].toolCallId)
  return id ? String(id) : ''
}

/** 把内容块里的文本拼起来，只留末尾 600 字符（标记行都在末尾；输出再长也只看这一小段）。 */
function tailText(message) {
  const c = message && message.content
  if (typeof c === 'string') return c.slice(-600)
  if (!Array.isArray(c)) return ''
  let s = ''
  for (const b of c) if (b && b.type === 'text' && typeof b.text === 'string') s += b.text + '\n'
  return s.slice(-600)
}

/**
 * 从 shell 工具的结果里抽出「命令有没有成」：
 *   { exit: number | null, timedOut?: true, denied?: true, bg?: true }
 *   · exit：退出码（有 `[exit code: N]` 就是 N；没有标记且是 shell 结果 = 0）；被信号杀掉 / 超时 / 没跑起来 = null（不知道，别当成功）；
 *   · bg：命令被放到后台了（还没跑完——别当「跑完了」）；denied：被沙箱拦了；timedOut：超时。
 * 不是 shell 工具的结果别调它（普通工具没有这套标记，调了会得到一个误导的 exit: 0）。
 */
export function shellOutcome(message) {
  const t = tailText(message)
  const out = { exit: 0 }
  if (/\[still running after \d+ms; moved to background job/.test(t)) {
    out.bg = true
    out.exit = null
    return out
  }
  if (/\[sandbox: [^\]]*denied/i.test(t) || /sandbox runner itself failed/i.test(t)) {
    out.denied = true
    out.exit = null
  }
  if (/\[timed out after \d+ms\]/.test(t)) {
    out.timedOut = true
    out.exit = null
  }
  if (/\[killed by signal: /.test(t) || /\[stopped: /.test(t)) out.exit = null
  const m = /\[exit code: (-?\d+)\]\s*$/m.exec(t) || /\[exit code: (-?\d+)\]/.exec(t)
  if (m && out.exit !== null) out.exit = Number(m[1])
  return out
}

/** shell 类工具名（和前端 persona/devhooks.js 的 SHELL_TOOL_RE 保持一致）。 */
export const SHELL_TOOL_RE = /bash|pwsh|powershell|shell|terminal|command|exec/i
