/**
 * persona/devhooks.js —— 「她看得懂你在干什么」：从 shell 工具的命令里认出开发动作（提交 / push / 测试 / 装依赖 / 构建…）。
 * **纯函数，不碰 DOM / 配置**，Node 里能直接单测（tools/test-dev.mjs）。
 *
 * 诚实原则：宿主推给前端的 tool-result 只有「有没有报错」，**没有命令输出**——所以她永远不知道测试是红是绿、push 有没有被拒。
 * 台词因此只说「命令跑完了」，红绿留给主人看（顺手接上那个最出圈的梗：「测完告诉人家，人家先去吃饭」）。
 * 隐私：命令只在本地用正则分类，不上传、不落盘、不进台词；只留一个类别名和一个计数。
 */

/** 哪些工具算「在敲命令」（和 persona/keywords.js 的危险命令识别用同一条）。 */
export const SHELL_TOOL_RE = /bash|pwsh|powershell|shell|terminal|command|exec/i

/** 先匹配到的优先：「git commit && git push」算 push（更大的动作）。 */
const RULES = [
  ['push', /\bgit\s+push\b/],
  ['commit', /\bgit\s+commit\b/],
  // 慌了就回滚：reset --hard / checkout -- . / restore / revert / stash（经典「回到上一个能跑的版本」）
  ['rollback', /\bgit\s+(reset\s+--hard|checkout\s+(--\s|\.)|restore\s|revert\s|stash\b)/],
  ['pull', /\bgit\s+(pull|fetch|merge|rebase)\b/],
  [
    'test',
    /\b(pytest|jest|vitest|mocha|rspec|ctest|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle\s+test|(npm|pnpm|yarn|bun)\s+(run\s+)?test)\b|\bnode\s+\S*test\S*\.m?js\b|\bpython3?\s+-m\s+(pytest|unittest)\b/i,
  ],
  [
    'install',
    /\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b|\bpip3?\s+install\b|\buv\s+(add|pip)\b|\bcargo\s+(add|install)\b|\bgo\s+get\b|\b(apt|apt-get|brew|choco|winget|scoop)\s+install\b/i,
  ],
  [
    'build',
    /\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|\bcargo\s+build\b|\bgo\s+build\b|\bdotnet\s+build\b|\bmvn\s+(package|install)\b|\bgradle\s+build\b|\bvite\s+build\b|\btsc\b|\bwebpack\b|\bmake(\s|$)/i,
  ],
  ['lint', /\b(eslint|prettier|ruff|flake8|pylint|golangci-lint|cargo\s+clippy|(npm|pnpm|yarn)\s+(run\s+)?lint)\b/i],
]

/**
 * 工具名 + 参数 → 开发动作类别（push / commit / pull / test / install / build / lint），认不出返回 null。
 * 非 shell 工具一律 null。
 */
export function classifyCommand(toolName, args) {
  if (!SHELL_TOOL_RE.test(String(toolName || ''))) return null
  const s = String(args || '')
  if (!s) return null
  for (const [kind, re] of RULES) if (re.test(s)) return kind
  return null
}

/**
 * 命令结果 → 'ok' | 'fail' | 'bg' | 'denied' | 'unknown'。
 * 宿主从 shell 结果末尾抽出退出码转成 m.exit（非零不算 error，见 lib/events/result.js）：
 *   0 = ok，非零 = fail；null / 没有（老宿主、被信号杀掉、超时）= unknown（不知道，别当成功也别当失败）；
 *   bg = 放到后台了（还没跑完）；denied = 被沙箱拦了；isError（基础设施失败）= unknown。
 */
export function outcomeOf(m) {
  if (!m) return 'unknown'
  if (m.bg) return 'bg'
  if (m.denied) return 'denied'
  if (m.error || m.timedOut) return 'unknown'
  if (typeof m.exit === 'number') return m.exit === 0 ? 'ok' : 'fail'
  return 'unknown'
}

/** 「今日小账」要数的类别（和 diary 里的字段一一对应）。 */
export const DEV_COUNTED = ['commit', 'push', 'pull', 'test', 'install', 'build', 'lint', 'rollback']

/** 改文件的工具（只数「写 / 改代码」，不含生成文档 / PDF 那类）。 */
export const EDIT_TOOL_RE = /^(write|edit|str_replace|str_replace_editor|apply_patch)$/

function parseArgs(args) {
  try {
    const j = JSON.parse(String(args || ''))
    return j && typeof j === 'object' ? j : null
  } catch (e) {
    return null
  }
}

/** FNV-1a 32 位（和 persona/fortune.js 同一个算法；这里自带一份，保持本文件零依赖）。 */
function fnv(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * 命令的指纹（用来认「同一条命令反复跑」）：从参数里取 command，压空白、小写、把数字换成 #（端口 / 行号 / 时间戳每次不同），再哈希。
 * 只留这个数，不留命令原文。取不到 command 返回 0（调用方当「没指纹」）。
 */
export function commandFingerprint(args) {
  const j = parseArgs(args)
  const c = j && typeof j.command === 'string' ? j.command : ''
  const norm = c.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
  return norm ? fnv(norm) : 0
}

/** 改文件工具的目标文件指纹（认「同一个文件反复改」）。参数里常见的路径字段名都认；取不到返回 0。只留哈希，不留路径。 */
export function editTargetFingerprint(toolName, args) {
  if (!EDIT_TOOL_RE.test(String(toolName || ''))) return 0
  const j = parseArgs(args)
  if (!j) return 0
  for (const k of ['file_path', 'filePath', 'path', 'file', 'filename', 'target']) {
    if (typeof j[k] === 'string' && j[k]) return fnv(j[k].replace(/\\/g, '/').toLowerCase())
  }
  return 0
}

/**
 * 「密钥要进提交」：git add 的是 .env / 私钥 / 证书 / credentials 这类文件（.env.example / .sample / .template 不算）。
 * 只提醒不拦截，和危险命令一样是少数可以在中途出声的安全提醒。
 */
export function isSecretAdd(toolName, args) {
  if (!SHELL_TOOL_RE.test(String(toolName || ''))) return false
  const s = String(args || '')
  return /\bgit\s+add\b[^\n]*(\.env(?!\.(example|sample|template))\b|id_rsa|id_ed25519|\.pem\b|\.p12\b|credentials|secrets?\.(json|ya?ml|toml))/i.test(s)
}
