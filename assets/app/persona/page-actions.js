/** persona/page-actions.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

// ——————————————————————————————————————————————————————————————
// DSH 界面本身的操作：点新会话、开设置、开终端…… 她都看得见
// ——————————————————————————————————————————————————————————————
//
// DSH 的按钮带本地化 aria-label（如 session.new.label =「新建会话」/ New session），
// 所以在 document 上挂一个**只读的捕获阶段** click 委托，按 aria-label | title | 文字
// 匹配一张中英双语表，命中就演；永远不阻止、不吞事件，不影响 DSH 本身。
// 想让她认新的界面动作：只加一行 PAGE_ACTIONS + 一条 PAGE_INTENTS。
export const PAGE_ACTIONS = [
  ['newSession', /^(新建会话|新会话|新对话|new (chat|session|conversation))$/i],
  ['sidebarOpen', /^(打开侧边栏|open sidebar)$/i],
  ['sidebarClose', /^(收起侧边栏|折叠侧边栏|collapse sidebar|close sidebar)$/i],
  ['settings', /^(设置|打开设置|settings|open settings)$/i],
  ['terminal', /^(终端|打开终端|terminal|open terminal)$/i],
  ['files', /^(文件|文件树|打开文件|files|file tree|open files)$/i],
  ['browser', /^(浏览器|打开浏览器|browser|open browser)$/i],
  ['stopBtn', /^(停止|中止|中断|停止生成|stop|stop generating|interrupt)$/i],
  ['copy', /^(复制|复制代码|已复制|copy|copy code)$/i],
  ['regen', /^(重新生成|重试|regenerate|retry)$/i],
  ['modelSwitch', /^(模型|切换模型|model|switch model)$/i],
  ['deleteSession', /^(删除会话|删除|归档会话|归档|delete session|delete|archive session|archive)$/i],
]

/** 每个界面动作怎么演。tier：extra = 普通档起；chatty = 只有话痨档（频繁且意义轻的）。 */
export const PAGE_INTENTS = {
  newSession: { tier: 'extra', mood: 'excited', ms: 2200, cool: 2500 },
  switchSession: { tier: 'extra', ms: 1800, cool: 2500 },
  deleteSession: { tier: 'extra', mood: 'sad', ms: 2000, cool: 3000 },
  settings: { tier: 'extra', mood: 'alert', ms: 2000, cool: 4000 },
  terminal: { tier: 'extra', ms: 1800, cool: 4000 },
  files: { tier: 'extra', ms: 1800, cool: 4000 },
  browser: { tier: 'extra', ms: 1800, cool: 4000 },
  stopBtn: { tier: 'extra', mood: 'alert', ms: 1800, cool: 3000 },
  regen: { tier: 'extra', mood: 'sweat', ms: 2200, cool: 4000 },
  modelSwitch: { tier: 'extra', mood: 'confused', ms: 2000, cool: 5000 },
  themeDark: { tier: 'extra', mood: 'sleepy', ms: 2200, cool: 5000 },
  themeLight: { tier: 'extra', mood: 'alert', ms: 2000, cool: 5000 },
  sidebarOpen: { tier: 'chatty', ms: 1600, cool: 3000 },
  sidebarClose: { tier: 'chatty', ms: 1600, cool: 3000 },
  copy: { tier: 'chatty', ms: 1600, cool: 4000 },
}
