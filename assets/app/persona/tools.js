/** persona/tools.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

/**
 * 工具 → 桌宠怎么演。
 *
 * 设计原则（改这张表就能改性格）：
 *   · 干活不该是阴着脸的——「跑命令」改成伸长猫爪敲键盘的专注样
 *   · 读/查/翻资料 = 戴眼镜 + 低头凑近看（lean 就是低头幅度）
 *   · 写/改 = 猫爪打字
 *   · 问你 = 问号；交付 = 比耶
 *   · 只有真的出错/卡住才用「汗」「晕」
 */
/**
 * 工具 → 她在气泡里说的话。
 *
 * 主人嫌「老是敲键盘 / 跑命令」太单调，所以：
 *   · **按工具分开写**，每个工具好几句，用 pickFresh 轮换，连着同名工具也不重复
 *   · 用她的口气（傲娇、爱吃白米、管人叫主人）
 *   · 气泡第二行放**从工具参数里抽出来的具体内容**（跑的是哪条命令、读的是哪个文件），
 *     这样 Agent 里在干什么，桌宠这边能同步看出来
 */
export const TOOL_LINE = {
  bash: ['（挽袖子）跑个命令试试', '让人家敲两行命令', '命令行交给人家', '（噼里啪啦）跑起来了', '这个命令人家熟'],
  read: ['（凑近看）先读一下这份', '人家看看里面写了啥', '翻开看看…', '（认真脸）读一下'],
  write: ['好，人家写出来', '（奋笔疾书）写上了', '这就给你落成文件', '写成文件啦'],
  edit: ['（改改改）这里调一下', '人家把这段改掉', '（橡皮擦）修一修', '这段人家重写一下'],
  glob: ['（翻箱倒柜）找找在哪儿', '人家找找这个文件', '翻一下目录'],
  grep: ['（眯着眼）搜一下关键词', '人家查查哪里用到了', '（翻）搜搜看'],
  web_search: ['（掏手机）上网查一下', '人家搜搜看', '（划手机）查查这个', '网上应该有答案'],
  web_fetch: ['（点开链接）读读这页', '人家看看这个网页', '（凑近屏幕）'],
  search_papers: ['（翻文献）查查有没有人写过', '人家去翻翻论文', '（戴眼镜）查文献去'],
  kb_search: ['（查资料库）人家找找', '翻翻知识库', '（翻）这儿应该有'],
  kb_rag: ['（查资料库）人家找找', '翻翻知识库', '（翻）这儿应该有'],
  kb_ingest: ['（搬书）人家收进库里', '把这份收好'],
  todo_write: ['（列清单）先排个计划', '人家记一下要做啥', '（在本子上划拉）'],
  subagent: ['（招手）叫个分身来帮忙', '人家派个分身去办', '（分工）这就安排'],
  subagent_fork: ['（招手）叫个分身来帮忙', '人家派个分身去办'],
  workflow: ['（排兵布阵）同时开几路', '人家把活儿分一下'],
  ask_user_question: ['（举牌）主人，人家有个问题', '（歪头）这个得问问主人', '人家不敢擅自决定，主人看一眼嘛'],
  read_image: ['（凑近）让人家好好看看这张图', '（戴眼镜）图片…看到了看到了', '人家看看里面画了啥'],
  present: ['（举起来）喏，给你', '人家交付啦', '（递过去）弄好了'],
  pdf_create: ['（排版）给你出一份文档', '人家做份文档'],
  docx_create: ['（排版）给你出份文档', '人家写份文档'],
  xlsx_write: ['（拉表格）数字给你排好', '人家做个表'],
  pptx_create: ['（做幻灯片）给你排几页', '人家弄个汇报稿'],
  sci_draw: ['（画画）人家画一个', '（拿笔）给你画出来'],
  create_goal: ['（立个目标）人家记下了', '这个人家盯着办'],
  update_goal: ['（更新一下目标）', '人家改一下计划'],
  skill: ['（翻手册）人家查查怎么弄', '（翻）这个人家学过'],
  auto_cite: ['（加引用）人家补上出处', '引用人家来配'],
  get_goal: ['（看一眼任务）', '人家看看进度'],
}

/** 从工具参数里抽一句「具体在干什么」，让气泡跟 Agent 真正同步。 */
export function toolHint(argsJson) {
  let a = {}
  try {
    a = JSON.parse(argsJson || '{}')
  } catch (e) {
    return ''
  }
  const keys = ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'title', 'description', 'prompt']
  let s = ''
  for (const k of keys) {
    if (a[k]) {
      s = String(a[k])
      break
    }
  }
  if (!s && Array.isArray(a.queries) && a.queries.length) s = String(a.queries[0])
  if (!s) return ''
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > 46 ? s.slice(0, 46) + '…' : s
}

/** 需要「掏出小设备」的工具（搜索/查资料这类）。用模型自带的开盖动作，不自己编。 */
export const DEVICE_TOOLS = new Set([
  'web_search', 'web_fetch', 'search_papers', 'kb_search', 'kb_rag',
  'search_semantic', 'search_google_scholar', 'pubmed_search_papers',
  'search_arxiv', 'browser', 'fetch',
])

/**
 * 读资料时戴哪副眼镜——**每次随机**，也可能不戴。
 * 主人说的：工作认真看就行，眼镜随机（半框/圆框/不戴）。
 */
export function randomGlasses() {
  const r = Math.random()
  if (r < 0.34) return 'glassesRound'
  if (r < 0.62) return 'glassesSquare' // 半框方眼镜
  if (r < 0.72) return 'glassesOval'
  return null // 三成左右不戴
}

export const TOOL_REACT = {
  // —— 阅读 / 检索：认真看（眼镜随机：圆框 / 半框方框 / 不戴），低头看本子 ——
  read: { mood: 'reading', prop: 'auto' },
  read_image: { mood: 'reading', prop: 'auto' },
  glob: { mood: 'thinking', prop: 'auto' },
  grep: { mood: 'reading', prop: 'auto' },
  web_fetch: { mood: 'reading', prop: 'auto' },
  web_search: { mood: 'thinking', prop: 'auto' },
  kb_search: { mood: 'reading', prop: 'auto' },
  kb_rag: { mood: 'reading', prop: 'auto' },
  kb_ingest: { mood: 'happy', prop: 'auto' },
  search_papers: { mood: 'reading', prop: 'auto' },
  auto_cite: { mood: 'reading', prop: 'auto' },
  pubmed_search_papers: { mood: 'reading', prop: 'auto' },
  pubmed_pubtator_search: { mood: 'reading', prop: 'auto' },
  search_arxiv: { mood: 'reading', prop: 'auto' },
  pdf_read: { mood: 'reading', prop: 'auto' },
  docx_read: { mood: 'reading', prop: 'auto' },
  xlsx_read: { mood: 'reading', prop: 'auto' },
  pptx_read: { mood: 'reading', prop: 'auto' },
  skill: { mood: 'reading', prop: 'auto' },

  // —— 干活：认真看本子，不摆手、不卖萌 ——
  bash: { mood: 'reading', prop: null },
  write: { mood: 'reading', prop: null },
  edit: { mood: 'reading', prop: null },
  todo_write: { mood: 'happy', prop: 'stickerCat' },
  subagent: { mood: 'thinking', prop: null },
  subagent_fork: { mood: 'thinking', prop: null },
  task: { mood: 'thinking', prop: null },
  workflow: { mood: 'thinking', prop: null },
  ralph: { mood: 'thinking', prop: null },

  // —— 产出 / 交付：干完了才有一点表示 ——
  present: { mood: 'happy', prop: 'stickerCat' },
  pdf_create: { mood: 'happy', prop: 'stickerCat' },
  docx_create: { mood: 'happy', prop: 'stickerCat' },
  pptx_create: { mood: 'happy', prop: 'stickerCat' },
  xlsx_write: { mood: 'happy', prop: 'stickerCat' },
  sci_draw: { mood: 'excited', prop: 'flower' },

  // —— 交互 / 目标 ——
  ask_user_question: { mood: 'confused', prop: null },
  create_goal: { mood: 'alert', prop: 'heartbeat' },
  update_goal: { mood: 'alert', prop: null },
  get_goal: { mood: 'thinking', prop: null },
}
