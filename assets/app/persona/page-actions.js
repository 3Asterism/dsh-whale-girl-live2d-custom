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
  // v0.6.7：压缩上下文 + 更多界面动作。标签是中英双语的最佳猜测（拿不准真 DSH 的叫法），对不上就不触发，无副作用；
  // 校准办法：右键菜单 / 控制台 DSHPet.page.recent() 看最近点过的标签，缺的往这里补一行。
  ['compactBtn', /^(压缩|压缩上下文|压缩对话|整理记忆|精简上下文|compact|compact context|compress|compress context)$/i],
  ['attach', /^(添加附件|附件|上传文件|上传|attach|attach files?|upload|add attachment)$/i],
  ['share', /^(分享|分享会话|share|share session)$/i],
  ['export', /^(导出|导出会话|下载|export|export session|download)$/i],
  ['search', /^(搜索|搜索会话|search|search sessions|search chats)$/i],
  ['voice', /^(语音|语音输入|voice|voice input|microphone|dictate)$/i],
  ['pin', /^(置顶|固定|取消置顶|pin|unpin)$/i],
  ['rename', /^(重命名|rename)$/i],
  ['fork', /^(分叉|分支|创建分支|fork|branch|fork session)$/i],
  ['undo', /^(撤销|撤回|undo)$/i],
  ['edit', /^(编辑|编辑消息|edit|edit message)$/i],
  ['help', /^(帮助|help)$/i],
]

/** 每个界面动作怎么演。台词 id 默认等于 key；不等的（page 开头的新动作）要显式写 say。tier：extra = 普通档起；chatty = 只有话痨档（频繁且意义轻的）。 */
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
  // 点「压缩」：和宿主的 compaction/start 共用同一个表演 id（冷却 20 秒），点击是即时反馈、事件是兜底，谁先到谁演
  compactBtn: { id: 'compact-start', say: 'compactStart', props: ['橡皮'], tier: 'extra', ms: 2600, cool: 20000 },
  attach: { say: 'pageAttach', tier: 'extra', mood: 'excited', ms: 2000, cool: 6000 },
  share: { say: 'pageShare', tier: 'extra', mood: 'happy', ms: 2000, cool: 6000 },
  export: { say: 'pageExport', tier: 'extra', mood: 'happy', ms: 2000, cool: 6000 },
  fork: { say: 'pageFork', tier: 'extra', mood: 'alert', ms: 2200, cool: 6000 },
  undo: { say: 'pageUndo', tier: 'extra', mood: 'sweat', ms: 2000, cool: 6000 },
  search: { say: 'pageSearch', tier: 'chatty', ms: 1800, cool: 8000 },
  voice: { say: 'pageVoice', tier: 'chatty', ms: 1800, cool: 8000 },
  pin: { say: 'pagePin', tier: 'chatty', ms: 1800, cool: 8000 },
  rename: { say: 'pageRename', tier: 'chatty', ms: 1800, cool: 8000 },
  edit: { say: 'pageEdit', tier: 'chatty', ms: 1800, cool: 8000 },
  help: { say: 'pageHelp', tier: 'chatty', mood: 'confused', ms: 2000, cool: 8000 },
}
