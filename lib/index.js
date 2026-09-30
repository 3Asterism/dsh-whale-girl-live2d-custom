/**
 * dsh-live2d-pet —— 宿主侧插件。
 *
 * 职责只有四件事，其余全在前端：
 *   1. 静态资源：把 Live2D 运行时（Cubism Core / PIXI / pixi-live2d-display）、
 *      模型本体和前端脚本挂到 DSH Web 的 /dsh-pet/* 上。
 *   2. 事件桥：把 agent 的真实活动（轮次、思考、工具调用、逐字输出、结束）
 *      通过 SSE 推给桌宠，让模型的动作和 agent 的状态真正同步。
 *   3. 反向通道：桌宠输入框里的文字经官方 sessionController.prompt 送回会话。
 *   4. 注入：往 index.html 塞一个 <script>，让桌宠随 DSH Web 界面自启。
 *
 * 所有路由都过一遍 connection.requestRejection 的信任栅栏：DSH 的 Web 端口
 * 是回环地址，但浏览器里任何一个网页都能向回环发请求，不加栅栏等于把会话
 * 的读写权限开放给任意页面。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = path.join(PACKAGE_ROOT, 'assets')
const MODEL_DIR = path.join(ASSETS, 'model')
const VENDOR_DIR = path.join(ASSETS, 'vendor')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CONFIG_FILE = path.join(DSH_HOME, 'dsh-live2d-pet.json')
/** 陪伴天数 / 累计轮次 / 累计 token 的持久记录——纯展示用的轻量统计，
 *  不做等级/成就那套（参考过 AgentPet 那类项目，但那个复杂度跟这个插件
 *  「轻量本地插件」的定位不匹配，只留「陪了多少天、干了多少活」这一句话）。 */
const STATS_FILE = path.join(DSH_HOME, 'dsh-live2d-pet-stats.json')

/**
 * 桌面版通行证（macOS 原生壳用）。
 *
 * 为什么需要：所有 /dsh-pet/* 路由都要过信任栅栏，栅栏认的是 DSH 的会话 cookie。
 * 浏览器里有 cookie 所以正常；桌面壳是全新的 WebView，一个 cookie 都没有 → 401。
 * 这里给「本机进程」发一张随机通行证：壳子把它写成 cookie 再加载页面，栅栏就放行。
 * 只认回环地址 + 令牌，所以别的网页（CSRF）依然进不来。文件权限 600，删掉会自动重建。
 */
const DESKTOP_FILE = path.join(DSH_HOME, 'dsh-live2d-pet-desktop.json')

/** 版本串同时用于前端日志与缓存击穿，改前端时记得一起动。 */
const VERSION = '0.4.4'

const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.moc3': 'application/octet-stream',
  '.wasm': 'application/wasm',
}

/** 默认配置；用户改 $DSH_HOME/dsh-live2d-pet.json 覆盖。 */
const DEFAULT_CONFIG = {
  enabled: true,
  /** 桌宠渲染尺寸（CSS 像素，高度）；宽度按模型比例自动算。 */
  height: 180, // 桌宠是常驻挂件：默认约原来 1/3 的占地面积
  /** 初始位置：'br' 右下 / 'bl' 左下 / 'tr' 右上 / 'tl' 左上。 */
  corner: 'br',
  /** 鼠标悬停时视线跟随光标。 */
  lookAtCursor: true,
  /** 讲话/思考时是否自动开口（模型没有口型参数，这里用嘴部参数近似）。 */
  talkMouth: true,
  /** 空闲多久后打瞌睡（毫秒）；0 = 不睡。 */
  sleepAfterMs: 180000,
  /** 气泡最长显示时间（毫秒）；0 = 一直显示到下一次事件。 */
  bubbleTtlMs: 0,
  /** 是否显示桌宠自带的输入框按钮。 */
  showComposer: true,
  /** 是否把 agent 的思考（reasoning）也显示在气泡里。 */
  showReasoning: false,
  /** 音效开关（模型未附音频，预留给用户自备）。 */
  sound: false,
  /**
   * 记账走哪个厂商：'deepseek'（默认，官方 /user/balance 接口）/
   * 'openrouter'（官方 /api/v1/key 接口，普通 API key 就能查，不用 management key）/
   * 'custom'（自己填接口地址和取值路径——对应 DSH「新增模型（自定义 API）」
   * 那个界面能配出来的任何厂商，不用等插件更新支持新名字）。
   */
  walletProvider: 'deepseek',
  /** 凭据名覆盖；不填就用每个厂商的默认凭据名（DeepSeek 是 DEEPSEEK_API_KEY，
   *  OpenRouter 是 OPENROUTER_API_KEY，截图里 DSH 新增自定义 API 时填的就是这个名字）。 */
  walletCredentialKey: '',
  /**
   * walletProvider = 'custom' 时才用得到。字段设计照抄 DSH 自己「新增模型
   * （自定义 API）」→「接口与字段（高级）」那个界面——那套已经踩过各家
   * 厂商接口形状不一样的坑，直接照抄比自己瞎设计靠谱。
   */
  walletCustom: {
    balanceUrl: '',
    /** 请求头模板，{key} 会被替换成凭据的实际值；默认 Bearer 认证。
     *  目前只接管 Authorization 头——绝大部分厂商都是这个头，真遇到用别的
     *  头名认证的厂商再加。 */
    authHeaderTemplate: 'Bearer {key}',
    currency: 'USD',
    /** 数值乘数：接口吐出来的原始数字先乘这个再当「钱」用（有些接口单位
     *  不是「元/美元」，比如以分为单位就填 0.01）。 */
    valueMultiplier: 1,
    /** 余额取值，两种模式二选一：
     *  A. totalBalancePath 直接给「剩余多少」（比如 OpenRouter /api/v1/key
     *     的 limit_remaining），填了这个就不用管 totalPath/usedPath。
     *  B. 接口只给「总量」和「已用」、没有「剩余」字段的（比如 OpenRouter
     *     /api/v1/credits 的 total_credits/total_usage），totalBalancePath
     *     留空，填 totalPath + usedPath，余额 = (总量 − 已用) × 乘数。 */
    totalBalancePath: '',
    totalPath: '',
    usedPath: '',
    /** 额度上限取值路径，配额环用；留空就不显示那个环（没有「额度上限」
     *  这个概念的厂商，比如按量计费的，用不上）。 */
    limitPath: '',
    /** 用量接口：跟余额接口完全独立的第二个接口，专门查「今日用量」
     *  （比如 OpenAI 兼容中转站的 /v1/dashboard/billing/usage）。留空就
     *  退回余额差分算「今日已用」，跟没配这个接口之前行为一致。 */
    usageUrl: '',
    usagePath: '',
    usageMultiplier: 1,
    /**
     * 事件匹配：给完全没有余额/用量接口可查的厂商兜底（比如公司内部网关，
     * 或者「无余额接口」那几个厂商）。填一串逗号分隔的关键字，这一轮用的
     * 模型名（会话事件里报的 model 字段）命中任意一个关键字，就退回「按
     * 这一轮真实的 token 用量（命中/未命中/输出三个口径）× 下面这份自定义
     * 单价」直接算钱，不走余额差分那条路（因为压根没有余额可查）。
     * 关键字留空 = 不启用这条路径。
     */
    eventMatchKeywords: '',
    /** 元或美元 / 百万 token；三个都留空就退回内置的 DeepSeek Flash 价目表。 */
    priceHit: null,
    priceMiss: null,
    priceOut: null,
    priceCurrency: 'CNY', // 'CNY' | 'USD'
    /** USD → CNY 汇率，priceCurrency = 'USD' 时才要填，记账统一按 CNY 算。 */
    exchangeRate: null,
  },
}

function readConfig() {
  let user = {}
  try {
    user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch (err) {
    /* 没配置或配置坏了都走默认值 */
  }
  return { ...DEFAULT_CONFIG, ...(user && typeof user === 'object' ? user : {}) }
}

/** 从消息的 content 块数组里抽纯文本（消息块可能是 text / reasoning / image / tool-call）。 */
function blocksToText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const b of content) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    else if (b.type === 'reasoning' && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join('')
}

function textOf(message) {
  if (!message) return ''
  return blocksToText(message.content).trim()
}

/** 工具名 → 中文短标签，气泡里显示“正在做什么”。 */
const TOOL_LABELS = {
  bash: '跑命令',
  read: '读文件',
  write: '写文件',
  edit: '改代码',
  glob: '找文件',
  grep: '搜代码',
  todo_write: '排计划',
  subagent: '派分身',
  subagent_fork: '派分身',
  web_search: '上网查',
  web_fetch: '读网页',
  kb_search: '翻知识库',
  kb_rag: '查知识库',
  kb_ingest: '入库文献',
  ask_user_question: '等你回话',
  create_goal: '立目标',
  update_goal: '更新目标',
  present: '交付文件',
  workflow: '编排分身',
  ralph: 'Ralph 循环',
  pdf_create: '生成 PDF',
  docx_create: '生成文档',
  xlsx_write: '生成表格',
  pptx_create: '生成幻灯片',
  auto_cite: '加引用',
  search_papers: '查文献',
  sci_draw: '画图',
}

export default {
  name: 'dsh-live2d-pet',
  apply(root) {
    const rowDisposers = []
    root.effect(() => () => { for (const d of rowDisposers) { try { d() } catch (err) {} } })
    // 桌面端注入：tapIndex 到不了静态 dist 出的 index，必须用 index-inject 推结构化行。
    // dsh-whale-widget 同路径，见其 lib/index.js L585-L625 的详细注释。
    rowDisposers.push(root.on('webserver/index-inject', (table) => {
      try {
        if (!Array.isArray(table)) return
        for (const row of table) {
          if (!row) continue
          if (row.kind === 'script-src' && row.src === '/dsh-pet/pet.js') return
          if (row.kind === 'script' && typeof row.text === 'string'
            && row.text.indexOf('/dsh-pet/pet.js') >= 0) return
        }
        table.push({ kind: 'script', placement: 'body', text:
          '(function(){try{var d=document.body||document.head||document.documentElement;if(!d)return;'
          + 'var s=document.createElement("script");s.src="/dsh-pet/pet.js";'
          + 's.onerror=function(){};d.appendChild(s)}catch(e){}})()' })
      } catch (err) {}
    }))

    // 其余逻辑（等齐服务后再跑）
    root.inject(['webServer', 'connection'], (ctx) => {
    // ————————————————————————————————————————————————————————————
    // 钱包：余额 / 峰谷时段 / 本轮消耗 —— 右键 HUD 的数据源
    //
    // 为什么自己做而不是读 dsh-whale-widget：那个插件是可选的，主人可能停用它
    // （实测停用后 /dsh-whale/balance.json 直接 404）。桌宠自己会算，才到哪都能用。
    // 价格与峰谷规则照官方文档口径（与 dsh-whale-widget 的实现同源，便于对账）：
    //   · 高峰 = 北京时间周一至周五（不含法定节假日）9:00–12:00、14:00–18:00
    //   · 其余时段（含周末、调休上班的周末、法定节假日全天）一律空闲价
    //   · Flash: 命中 0.02/未命中 1/输出 4（元每百万 token），高峰 = 空闲 × 2
    //   · Pro 为 Flash 的 3 倍价
    //   ⚠️ 每年国务院公布次年放假安排后，记得往 HOLIDAY_VALLEY 里补下一年的日期。
    // ————————————————————————————————————————————————————————————
    const PEAK_HOURS = [
      [9, 12],
      [14, 18],
    ]
    const WEEKEND_VALLEY_FROM = Math.floor(Date.UTC(2026, 7, 22, 16, 0, 0) / 1000)
    const HOLIDAY_VALLEY_FROM = Math.floor(Date.UTC(2026, 8, 18, 16, 0, 0) / 1000)
    const HOLIDAY_VALLEY = new Set([
      '2026-01-01', '2026-01-02', '2026-01-03',
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
      '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
      '2026-04-04', '2026-04-05', '2026-04-06',
      '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
      '2026-06-19', '2026-06-20', '2026-06-21',
      '2026-09-25', '2026-09-26', '2026-09-27',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
      '2026-10-05', '2026-10-06', '2026-10-07',
    ])
    /** 元 / 百万 token，数组是 [空闲价, 高峰价] */
    const PRICE = {
      flash: { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
      pro: { hit: [0.15, 0.3], miss: [4.5, 9], out: [13.5, 27] },
    }
    /** 按北京时间（UTC+8）读日历 */
    function bjDate(sec) {
      return new Date(Number(sec) * 1000 + 8 * 3600 * 1000)
    }
    function isPeakTime(sec) {
      const n = Number(sec)
      if (!Number.isFinite(n)) return false
      const bj = bjDate(n)
      if (n >= WEEKEND_VALLEY_FROM) {
        const dow = bj.getUTCDay()
        if (dow === 0 || dow === 6) return false
      }
      if (n >= HOLIDAY_VALLEY_FROM && HOLIDAY_VALLEY.has(bj.toISOString().slice(0, 10))) return false
      const hour = bj.getUTCHours()
      for (const [a, b] of PEAK_HOURS) if (hour >= a && hour < b) return true
      return false
    }
    /** 下一个峰谷切换时刻（epoch 秒）：扫北京时间的 0/9/12/14/18 点边界，最多往后看 12 天 */
    function nextPeakChangeAt(sec) {
      const n = Number(sec)
      if (!Number.isFinite(n)) return null
      const nowPeak = isPeakTime(n)
      for (let i = 1; i <= 12 * 24; i++) {
        const t = n + i * 3600
        if (isPeakTime(t) !== nowPeak) return t
      }
      return null
    }
    function priceTier(model) {
      return /pro/i.test(String(model || '')) ? 'pro' : 'flash'
    }
    /** 一轮的花费（元）：命中/未命中/输出 三个价目分别算 */
    /** customTable 给自定义厂商的「事件匹配」用——传了就绕开内置 PRICE 表。 */
    function costOf(usage, peak, tier, customTable) {
      const p = customTable || PRICE[tier] || PRICE.flash
      const idx = peak ? 1 : 0
      const hit = (Number(usage.hit) || 0) / 1e6 * p.hit[idx]
      const miss = (Number(usage.miss) || 0) / 1e6 * p.miss[idx]
      const out = (Number(usage.out) || 0) / 1e6 * p.out[idx]
      return hit + miss + out
    }

    /**
     * 自定义单价表——三档（命中/未命中/输出）随便填，不分峰谷（跟峰谷计价
     * 是 DeepSeek 官方特有的概念，自定义厂商不一定有这个规则，峰谷两档给
     * 同一个数字，复用 costOf() 的 [空闲价,高峰价] 结构就不用改它的签名）。
     * 三个价位缺任何一个都当作没配，退回内置 DeepSeek Flash 价目表。
     */
    function customPriceTier(cfg) {
      const c = cfg.walletCustom || {}
      const hit = Number(c.priceHit)
      const miss = Number(c.priceMiss)
      const out = Number(c.priceOut)
      if (![hit, miss, out].every(Number.isFinite)) return null
      const rate = c.priceCurrency === 'USD' ? Number(c.exchangeRate) || 1 : 1
      return {
        hit: [hit * rate, hit * rate],
        miss: [miss * rate, miss * rate],
        out: [out * rate, out * rate],
      }
    }
    /**
     * 「事件匹配」：给完全没有余额/用量接口可查的厂商兜底（公司内部网关、
     * 或者「无余额接口」那几个厂商）。这一轮用的模型名命中任意一个逗号
     * 分隔的关键字，就退回「真实 token 用量 × 自定义单价」直接算钱。
     */
    function matchesEventKeywords(cfg, model) {
      const kw = (cfg.walletCustom && cfg.walletCustom.eventMatchKeywords) || ''
      if (!kw.trim()) return false
      const m = String(model || '').toLowerCase()
      return kw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .some((k) => m.includes(k))
    }

    /**
     * 「今日已用」的持久基线文件——参考 dsh-whale-widget 的做法（那边这块是对的，
     * 这边原来靠累加每轮上报的 token 用量算，依赖 assistant/message 事件带
     * usage 字段；有些后端/模型压根不带这个字段，于是「今日已用」「本轮消耗」
     * 一直卡在 ¥0.00，看着像挂了，其实是没数据可加，不是逻辑炸了）。
     *
     * 改成跟 dsh-whale-widget 一样：今日已用 = 今天开始时的余额基线 - 当前余额，
     * 完全不依赖任何事件数据，不管跑的是什么模型/后端都一样准，因为余额是
     * DeepSeek 服务端自己维护的权威数字。
     */
    const USAGE_FILE_CANDIDATES = [
      path.join(DSH_HOME, '.dsh-live2d-pet-usage.json'),
      path.join(DSH_HOME, 'profiles', 'web', '.dsh-live2d-pet-usage.json'),
    ]
    function readUsageRecord() {
      for (const p of USAGE_FILE_CANDIDATES) {
        try {
          const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
          if (parsed && typeof parsed.startBalance === 'number' && typeof parsed.date === 'string') return parsed
        } catch (err) {}
      }
      return null
    }
    function writeUsageRecord(date, startBalance, currency, consumedTotal) {
      const body = JSON.stringify({
        date,
        startBalance,
        currency,
        consumedTotal: consumedTotal || 0,
        updatedAt: new Date().toISOString(),
      })
      for (const p of USAGE_FILE_CANDIDATES) {
        try {
          fs.writeFileSync(p, body, 'utf8')
          return true
        } catch (err) {}
      }
      return false
    }
    /**
     * 算「今天已经花了多少」。余额变多（充值/官方发放）时不能直接拿差值算，
     * 会算出负数——这种情况保留已经累计的消耗，把基线滑到新的（更高的）余额上，
     * 这样充值不会把今天的消耗历史清零。
     */
    function computeTodayUsage(balance, currency) {
      const today = todayKey()
      const rec = readUsageRecord()
      if (!rec || rec.date !== today) {
        writeUsageRecord(today, balance, currency, 0)
        return 0
      }
      const consumed = typeof rec.consumedTotal === 'number' ? rec.consumedTotal : 0
      const start = Number(rec.startBalance)
      if (!Number.isFinite(start) || balance >= start) {
        writeUsageRecord(today, balance, currency, consumed)
        return consumed
      }
      const amount = consumed + (start - balance)
      writeUsageRecord(today, balance, currency, amount)
      return amount
    }

    /** 读累计统计；坏了/没有就当作「今天刚认识」，不是什么严重错误。 */
    function readStats() {
      try {
        const parsed = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'))
        if (parsed && typeof parsed === 'object') {
          return {
            firstSeenAt: Number(parsed.firstSeenAt) || 0,
            totalTurns: Number(parsed.totalTurns) || 0,
            totalTokens: Number(parsed.totalTokens) || 0,
          }
        }
      } catch (err) {}
      return { firstSeenAt: 0, totalTurns: 0, totalTokens: 0 }
    }
    let statsCache = null
    /** 每轮结束调一次：没有起始时间就记今天，轮次/token 累计各 +1 份。 */
    function bumpStats(tokens) {
      const s = statsCache || readStats()
      if (!s.firstSeenAt) s.firstSeenAt = Date.now()
      s.totalTurns += 1
      s.totalTokens += Number(tokens) || 0
      statsCache = s
      try {
        fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true })
        fs.writeFileSync(STATS_FILE, JSON.stringify(s), 'utf8')
      } catch (err) {}
      return s
    }
    /** 「陪你写代码第 N 天」——从第一次见面那天算起，当天也算第 1 天。 */
    function companionDays(firstSeenAt) {
      if (!firstSeenAt) return 0
      return Math.max(1, Math.floor((Date.now() - firstSeenAt) / 86400000) + 1)
    }

    /** 余额缓存（60 秒）——不缓存的话，每轮结束都打一次官方接口 */
    const wallet = {
      balanceAt: 0,
      balance: null,
      balanceErr: '',
      lastTurn: null,
      turnSeq: 0,
      today: { date: '', amount: 0, tokens: 0 },
      keyWarned: false,
    }

    /** 属性路径取值，给 walletProvider = 'custom' 用。支持点号和数组下标混用，
     *  比如 "balance_infos[0].total_balance"：先把 `[n]` 转成 `.n` 再按点号拆，
     *  字符串下标 '0' 取数组元素在 JS 里跟数字下标是一回事，不用分开处理。 */
    function getPath(obj, path) {
      if (!path) return undefined
      const tokens = String(path)
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter(Boolean)
      return tokens.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)
    }

    /**
     * 记账厂商表。DSH 自己的「新增模型（自定义 API）」界面已经能配出
     * OpenRouter 这类厂商（截图：厂商模板 OpenRouter、凭据名
     * OPENROUTER_API_KEY）——这边跟着认，不用等哪天真的切过去了才临时改代码。
     *
     * 每个厂商：去哪个凭据名读 key、查余额的 URL、怎么从响应 JSON 里解析出
     * {totalBalance, currency, todayUsage}。todayUsage 给不出的（比如 DeepSeek
     * 官方接口就没有这个字段）返回 null，上层会自动退回余额差分算「今日已用」。
     */
    /** 请求头模板 → 实际的 fetch headers。目前只接管 Authorization 头——
     *  绝大部分厂商都是 Bearer 认证，真遇到用别的头名的厂商再加。 */
    function buildAuthHeader(template, key) {
      return { Authorization: (template || 'Bearer {key}').replace('{key}', key) }
    }

    const WALLET_PROVIDERS = {
      deepseek: {
        label: 'DeepSeek',
        credentialKey: 'DEEPSEEK_API_KEY',
        balanceUrl: 'https://api.deepseek.com/user/balance',
        authHeaderTemplate: 'Bearer {key}',
        parse(json) {
          const info = (json && json.balance_infos && json.balance_infos[0]) || {}
          const totalBalance = Number(info.total_balance)
          return {
            totalBalance: Number.isFinite(totalBalance) ? totalBalance : null,
            currency: info.currency || 'CNY',
            todayUsage: null,
            limit: null, // 按量计费，没有「额度上限」这个概念，配额环不显示
          }
        },
      },
      // 官方 /api/v1/key：普通 API key 就能查（不需要 management key），
      // 直接给 limit_remaining（剩余额度）和 usage_daily（今日已用），
      // 比 DeepSeek 官方接口方便——不用自己拿余额差分算「今日已用」。
      // limit 是这个 key 的消费上限（null = 不限），配额环用它算百分比。
      openrouter: {
        label: 'OpenRouter',
        credentialKey: 'OPENROUTER_API_KEY',
        balanceUrl: 'https://openrouter.ai/api/v1/key',
        authHeaderTemplate: 'Bearer {key}',
        parse(json) {
          const d = (json && json.data) || json || {}
          const remaining = Number(d.limit_remaining)
          const dailyUsage = Number(d.usage_daily)
          const limit = Number(d.limit)
          return {
            totalBalance: Number.isFinite(remaining) ? remaining : null,
            currency: 'USD',
            todayUsage: Number.isFinite(dailyUsage) ? dailyUsage : null,
            limit: Number.isFinite(limit) ? limit : null,
          }
        },
      },
    }

    /**
     * 当前生效的记账厂商：配置里没写就是 DeepSeek（零配置，跟以前行为一致）。
     * 'custom' 分支字段设计照抄 DSH 自己「新增模型（自定义 API）」→「接口
     * 与字段（高级）」那个界面，见 DEFAULT_CONFIG.walletCustom 的注释。
     */
    function activeProvider(cfg) {
      if (cfg.walletProvider === 'custom') {
        const c = cfg.walletCustom || {}
        const mul = Number(c.valueMultiplier) || 1
        return {
          label: '自定义',
          credentialKey: cfg.walletCredentialKey || '',
          balanceUrl: c.balanceUrl || '',
          authHeaderTemplate: c.authHeaderTemplate || 'Bearer {key}',
          // 独立的第二段用量接口，fetchBalanceNow() 会另外单独打一次
          usageUrl: c.usageUrl || '',
          usagePath: c.usagePath || '',
          usageMultiplier: Number(c.usageMultiplier) || 1,
          parse(json) {
            // 模式 A：直接给「剩余」；模式 B：给「总量」和「已用」，算差值
            let totalBalance = null
            if (c.totalBalancePath) {
              const v = Number(getPath(json, c.totalBalancePath))
              if (Number.isFinite(v)) totalBalance = v * mul
            } else if (c.totalPath && c.usedPath) {
              const total = Number(getPath(json, c.totalPath))
              const used = Number(getPath(json, c.usedPath))
              if (Number.isFinite(total) && Number.isFinite(used)) totalBalance = (total - used) * mul
            }
            const limit = Number(getPath(json, c.limitPath))
            return {
              totalBalance,
              currency: c.currency || 'USD',
              todayUsage: null, // 走独立用量接口，不在这里解析
              limit: Number.isFinite(limit) ? limit * mul : null,
            }
          },
        }
      }
      const p = WALLET_PROVIDERS[cfg.walletProvider] || WALLET_PROVIDERS.deepseek
      return cfg.walletCredentialKey ? Object.assign({}, p, { credentialKey: cfg.walletCredentialKey }) : p
    }

    /** 读凭据：优先问 DSH 的凭据服务，其次看同名环境变量。 */
    async function resolveCredential(name) {
      if (!name) return ''
      try {
        const cred = ctx.get('credentials')
        if (cred && typeof cred.resolve === 'function') {
          const c = await cred.resolve(name)
          if (c && c.value) return String(c.value)
        }
      } catch (err) {
        if (!wallet.keyWarned) {
          wallet.keyWarned = true
          try {
            console.warn(`[live2d-pet] 读不到凭据服务里的 ${name}：` + String((err && err.message) || err).slice(0, 120))
          } catch (e) {}
        }
      }
      return process.env[name] || ''
    }

    /**
     * 同一时间只放一个真实请求在飞，其余调用方等同一个 promise——不然
     * turn/start、turn/end、前端 HUD 轮询三路并发调用，会同时打好几个请求
     * 给 DeepSeek，谁先回来谁后回来完全不确定：慢的那个如果恰好失败了，
     * 会把快的那个刚写进去的成功结果覆盖掉，表现就是「余额一会儿有一会儿
     * 变横杠」。参考 dsh-whale-widget 的 balanceInFlight 写法。
     */
    let balanceInFlight = null
    function fetchBalance(force) {
      const now = Date.now()
      if (!force && wallet.balance && now - wallet.balanceAt < 60000) return Promise.resolve(wallet.balance)
      if (balanceInFlight) return balanceInFlight
      balanceInFlight = fetchBalanceNow().finally(() => {
        balanceInFlight = null
      })
      return balanceInFlight
    }
    async function fetchBalanceNow() {
      const now = Date.now()
      const cfg = readConfig()
      const provider = activeProvider(cfg)
      if (!provider.balanceUrl || !provider.credentialKey) {
        wallet.balance = {
          ok: false,
          code: 'NO_PROVIDER',
          error: provider.label === '自定义'
            ? '自定义记账厂商没配完整：walletCustom.balanceUrl 和 walletCredentialKey 都要填'
            : '记账厂商配置异常',
        }
        wallet.balanceAt = now
        return wallet.balance
      }
      const key = await resolveCredential(provider.credentialKey)
      if (!key) {
        wallet.balance = { ok: false, code: 'NO_KEY', error: `没配置 ${provider.credentialKey}` }
        wallet.balanceAt = now
        return wallet.balance
      }
      try {
        const headers = buildAuthHeader(provider.authHeaderTemplate, key)
        const res = await fetch(provider.balanceUrl, { headers, signal: AbortSignal.timeout(8000) })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const j = await res.json()
        const parsed = provider.parse(j) || {}
        const totalBalance = parsed.totalBalance
        const currency = parsed.currency || 'CNY'
        wallet.balance = {
          ok: true,
          totalBalance,
          currency,
          provider: provider.label,
          // 额度上限——没有就是 null，前端拿它算「配额环」的百分比，
          // null 就整个不显示这个环（按量计费的厂商没有这个概念）
          limit: typeof parsed.limit === 'number' && Number.isFinite(parsed.limit) ? parsed.limit : null,
          updatedAt: new Date().toISOString(),
        }
        // 独立的用量接口（跟余额接口分开查）：配了就单独打一次，拿到的数字
        // 直接当「今日已用」，不走余额差分；这一步失败不影响余额已经查到的结果。
        let usageFromEndpoint = null
        if (provider.usageUrl) {
          try {
            const ures = await fetch(provider.usageUrl, { headers, signal: AbortSignal.timeout(8000) })
            if (ures.ok) {
              const uj = await ures.json()
              const raw = Number(getPath(uj, provider.usagePath))
              if (Number.isFinite(raw)) usageFromEndpoint = raw * (provider.usageMultiplier || 1)
            }
          } catch (err) {
            /* 用量接口失败不影响余额已经查到的结果，静默丢弃 */
          }
        }
        if (Number.isFinite(totalBalance)) {
          const k = todayKey()
          // 优先级：独立用量接口 > 厂商直接给的 todayUsage（比如 OpenRouter
          // 的 usage_daily）> 都没有就退回余额差分算，跟以前行为一致。
          const amount =
            usageFromEndpoint != null
              ? usageFromEndpoint
              : typeof parsed.todayUsage === 'number' && Number.isFinite(parsed.todayUsage)
                ? parsed.todayUsage
                : computeTodayUsage(totalBalance, currency)
          wallet.today = { date: k, amount, tokens: wallet.today.date === k ? wallet.today.tokens : 0 }
        }
      } catch (err) {
        // 拿不到就沿用上一次的数字（标 stale），别让 HUD 变空
        const msg = String((err && err.message) || err).slice(0, 160)
        wallet.balance = wallet.balance && wallet.balance.ok
          ? Object.assign({}, wallet.balance, { stale: true, error: msg })
          : { ok: false, code: 'ERROR', error: msg }
      }
      wallet.balanceAt = now
      return wallet.balance
    }

    function todayKey() {
      return bjDate(Math.floor(Date.now() / 1000)).toISOString().slice(0, 10)
    }
    /** 今日 token 数：这个还是只能靠事件累加（余额接口不返回 token 数），
     * 拿不到事件数据时就是 0，纯展示用，不影响「今日已用」的金额（那个走余额差分）。 */
    function addTodayTokens(tokens) {
      const k = todayKey()
      if (wallet.today.date !== k) wallet.today = { date: k, amount: wallet.today.amount, tokens: 0 }
      wallet.today.tokens += Number(tokens) || 0
    }

    function walletSnapshot() {
      const nowSec = Math.floor(Date.now() / 1000)
      const s = statsCache || readStats()
      return {
        ok: true,
        version: VERSION,
        source: 'dsh-live2d-pet',
        isPeak: isPeakTime(nowSec),
        peakNextChangeAt: nextPeakChangeAt(nowSec),
        balance: wallet.balance,
        today: { date: wallet.today.date, amount: wallet.today.amount, tokens: wallet.today.tokens },
        turn: wallet.lastTurn,
        stats: { days: companionDays(s.firstSeenAt), turns: s.totalTurns, tokens: s.totalTokens },
        priceTier: 'flash',
        priceNote: 'Flash 空闲 0.02/1/4・高峰 ×2（元每百万 token）',
      }
    }

    // —— 信任栅栏：和官方插件一致，自定义路由必须先过 connection 的判定 ——
    //
    // 唯一的例外是「桌面版通行证」：本机进程（macOS 原生壳）带着令牌来，就放行。
    // 为什么必须留这个口子：壳子是全新 WebView，没有 DSH 的会话 cookie，
    // 而桌面桌宠的全部意义就是「不在浏览器里」，不能让用户先去浏览器登录一次。
    let deskToken = null
    function desktopKey() {
      if (deskToken) return deskToken
      try {
        const raw = JSON.parse(fs.readFileSync(DESKTOP_FILE, 'utf8'))
        if (raw && typeof raw.token === 'string' && raw.token.length >= 16) {
          deskToken = raw.token
          return deskToken
        }
      } catch (err) {}
      const token = randomBytes(24).toString('hex')
      try {
        fs.writeFileSync(
          DESKTOP_FILE,
          JSON.stringify(
            {
              token,
              note: '桌面版（macOS 原生壳）的本机通行证。删掉这个文件会自动重新生成，旧壳子需要重启。',
              createdAt: new Date().toISOString(),
            },
            null,
            2,
          ) + '\n',
          { mode: 0o600 },
        )
      } catch (err) {
        try {
          console.warn('[live2d-pet] 桌面版通行证写不进去：', err && err.message)
        } catch (e) {}
      }
      deskToken = token
      return deskToken
    }

    /** 这个请求是不是「本机桌面壳」发来的（回环地址 + 令牌，两个都要满足） */
    function isDesktopReq(req) {
      try {
        const addr = (req.socket && (req.socket.remoteAddress || '')) || ''
        if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') return false
        const token = desktopKey()
        if (!token) return false
        const cookie = String(req.headers.cookie || '')
        if (cookie.split(/;\s*/).some((c) => c === `dsh_pet_desk=${token}`)) return true
        if (req.headers['x-dsh-pet-desk'] === token) return true
        const m = /[?&]k=([0-9a-f]{16,})/.exec(String(req.url || ''))
        if (m && m[1] === token) return true
        return false
      } catch (err) {
        return false
      }
    }

    function rejected(req, res) {
      try {
        if (isDesktopReq(req)) return false
        const conn = ctx.get('connection') || ctx.connection
        if (!conn || typeof conn.requestRejection !== 'function') {
          if (!rejected.warned) {
            rejected.warned = true
            try {
              console.warn('[live2d-pet] 信任栅栏不可用：connection 服务缺失，自定义路由将放行')
            } catch (err) {}
          }
          return false
        }
        const code = conn.requestRejection(req)
        if (code === undefined || code === null || code === false) return false
        res.statusCode = typeof code === 'number' ? code : 403
        res.end()
        return true
      } catch (err) {
        return false
      }
    }

    const disposers = []
    function route(kind, pathname, handler) {
      disposers.push(
        ctx.webServer.register({
          kind,
          path: pathname,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            try {
              await handler(req, res)
            } catch (err) {
              try {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end(`live2d-pet: ${err && err.message ? err.message : String(err)}`)
              } catch (e) {}
            }
          },
        }),
      )
    }

    // ————————————————————————————————————————————————————————————
    // 1. 静态资源
    // ————————————————————————————————————————————————————————————

    /** 把一个相对路径安全地解析到某个根目录下，越界直接判失败。 */
    function safeJoin(root, rel) {
      const decoded = decodeURIComponent(String(rel || ''))
      const target = path.resolve(root, decoded)
      const prefix = root.endsWith(path.sep) ? root : root + path.sep
      if (target !== root && !target.startsWith(prefix)) return null
      return target
    }

    function serveFile(res, abs, { cache = 'no-store' } = {}) {
      let stat
      try {
        stat = fs.statSync(abs)
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
      }
      if (!stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('not a file')
        return
      }
      const ext = path.extname(abs).toLowerCase()
      const type = MIME[ext] || 'application/octet-stream'
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': String(stat.size),
        'Cache-Control': cache,
      })
      fs.createReadStream(abs).pipe(res)
    }

    // 前端脚本按 mtime 热读取：改完刷新页面就生效，不用重启 DSH。
    const hotCache = new Map()
    function readHot(abs) {
      const stat = fs.statSync(abs)
      const hit = hotCache.get(abs)
      if (hit && hit.mtime === stat.mtimeMs) return hit.text
      const text = fs.readFileSync(abs, 'utf8')
      hotCache.set(abs, { mtime: stat.mtimeMs, text })
      return text
    }

    route('exact', '/dsh-pet/pet.js', (req, res) => {
      let body
      try {
        body = readHot(path.join(ASSETS, 'pet.js'))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('pet.js missing')
        return
      }
      const config = readConfig()
      const boot = `\n;window.__DSH_PET_BOOT__=${JSON.stringify({ config, version: VERSION })};\n`
      const doc = `/* dsh-live2d-pet ${VERSION} */\n${body}${boot}`
      res.writeHead(200, {
        'Content-Type': MIME['.js'],
        'Content-Length': String(Buffer.byteLength(doc)),
        'Cache-Control': 'no-store',
      })
      res.end(doc)
    })

    route('prefix', '/dsh-pet/vendor', (req, res) => {
      const rel = req.url.split('?')[0].replace(/^\/dsh-pet\/vendor\/?/, '')
      const abs = safeJoin(VENDOR_DIR, rel)
      if (!abs) {
        res.writeHead(403).end()
        return
      }
      // vendor 体积大且不常改，允许浏览器缓存但必须每次校验
      serveFile(res, abs, { cache: 'no-cache' })
    })

    route('prefix', '/dsh-pet/model', (req, res) => {
      const rel = req.url.split('?')[0].replace(/^\/dsh-pet\/model\/?/, '')
      const abs = safeJoin(MODEL_DIR, rel)
      if (!abs) {
        res.writeHead(403).end()
        return
      }
      serveFile(res, abs, { cache: 'no-cache' })
    })

    route('exact', '/dsh-pet/config', async (req, res) => {
      if (req.method === 'PUT' || req.method === 'POST') {
        const body = await json(req, res)
        if (!body) return
        // 只接受 DEFAULT_CONFIG 里已经有的字段，别的字段直接丢掉——
        // 这个口子不是「写任意 JSON 进配置文件」的后门，只收已知配置项。
        const patch = {}
        for (const k of Object.keys(body)) {
          if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, k)) patch[k] = body[k]
        }
        let existing = {}
        try {
          existing = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
          if (!existing || typeof existing !== 'object') existing = {}
        } catch (err) {}
        const merged = { ...existing, ...patch }
        try {
          fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8')
        } catch (err) {
          res.writeHead(500, { 'Content-Type': MIME['.json'] })
          res.end(JSON.stringify({ ok: false, error: '写配置文件失败：' + String((err && err.message) || err).slice(0, 160) }))
          return
        }
        // 配置变了，下一次拉余额强制重查——不然用户刚换了厂商，钱包还在显示上一个厂商的缓存
        wallet.balanceAt = 0
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ ok: true, config: readConfig() }))
        return
      }
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(readConfig()))
    })

    // ————————————————————————————————————————————————————————————
    // 2. 事件桥
    // ————————————————————————————————————————————————————————————

    /** SSE 客户端集合。每个连接一个 res。 */
    const clients = new Set()
    let seq = 0

    function broadcast(payload) {
      if (!clients.size) return
      const frame = `id: ${++seq}\ndata: ${JSON.stringify(payload)}\n\n`
      for (const res of clients) {
        try {
          res.write(frame)
        } catch (err) {
          clients.delete(res)
        }
      }
    }

    /**
     * 会话归属。桌宠只关心“人正在用的那个会话”，子代理的会话不能抢气泡。
     * primarySessionId 由真实人类 prompt（source.kind === 'user'）确定。
     */
    let primarySessionId = null
    let lastSessionId = null
    const sessionState = new Map() // sessionId -> { status, turn, step }

    function stateOf(sessionId) {
      let s = sessionState.get(sessionId)
      if (!s) {
        s = { status: 'idle', turn: 0, step: 0, busySince: 0 }
        sessionState.set(sessionId, s)
      }
      return s
    }

    /** 桌宠只对主会话做完整反应；其它会话（子代理）只发一个轻量的“分身”信号。 */
    function isPrimary(sessionId) {
      if (primarySessionId) return sessionId === primarySessionId
      return sessionId === lastSessionId
    }

    function sendLocal(payload) {
      // 来自 /dsh-pet/control 的本地指令（用户点桌宠菜单、或 agent 主动调用）
      broadcast(payload)
    }

    // —— 逐字流：agent/assistant-stream 是 process-local 的实时 chunk 通道 ——
    disposers.push(
      ctx.on('agent/assistant-stream', (payload) => {
        try {
          const p = payload || {}
          const agent = p.agent
          const frame = p.frame
          if (!agent || !frame || !agent.session) return
          const sessionId = agent.session.id
          lastSessionId = sessionId
          if (!isPrimary(sessionId)) return
          if (frame.type === 'start') {
            broadcast({ t: 'attempt-start', sessionId, turn: frame.turn, step: frame.step })
            return
          }
          if (frame.type === 'end') {
            broadcast({ t: 'attempt-end', sessionId, turn: frame.turn ?? null })
            return
          }
          if (frame.type !== 'chunk' || !frame.chunk) return
          const c = frame.chunk
          if (c.type === 'text-delta' && c.text) {
            broadcast({ t: 'delta', sessionId, kind: 'text', text: c.text })
          } else if (c.type === 'reasoning-delta' && c.text) {
            broadcast({ t: 'delta', sessionId, kind: 'reasoning', text: c.text })
          } else if (c.type === 'tool-call-delta' && c.name) {
            broadcast({ t: 'tool-draft', sessionId, name: c.name })
          }
        } catch (err) {
          /* 事件桥永远不能把主流程带崩 */
        }
      }),
    )

    // —— 会话事件：轮次/步骤/工具/最终消息 ——
    const pendingTools = new Map() // callId -> { name, startedAt }
    /** 每轮累计 token 数，桌宠完成时用它弹「这一轮花了多少」的小结（纯展示，不算钱）。 */
    const turnTokens = new Map() // sessionId -> tokens
    /** 钱包用：这一轮的 命中/未命中/输出 口径——只在 assistant/message 带 usage 时才有数，
     * 带不带看后端/模型，带不了就是空的，本轮花费不靠它兜底（见 turnBalanceStart）。 */
    const turnUsage = new Map()
    /** 本轮消耗现在靠余额差分算：turn/start 记一次「这一轮开始时的余额」快照，
     * turn/end 时再拉一次新余额，两个一减就是这一轮真实花了多少——不依赖
     * assistant/message 带不带 usage 字段，参考 dsh-whale-widget 的做法。 */
    const turnBalanceStart = new Map() // sessionId -> number | null

    disposers.push(
      ctx.on('session/event', (session, event) => {
        try {
          const sessionId = (session && session.id) || 'default'
          lastSessionId = sessionId
          const type = event && event.type
          const d = (event && event.data) || {}
          const st = stateOf(sessionId)

          // 人类直接发的 prompt —— 以此认定“当前会话”
          if (type === 'user/message' && d.source && d.source.kind === 'user') {
            primarySessionId = sessionId
            broadcast({ t: 'user', sessionId, text: textOf(d).slice(0, 4000), ts: Date.now() })
            return
          }
          if (type === 'turn/start') {
            turnTokens.set(sessionId, 0)
            // 存 Promise，不是存当前缓存的余额——缓存可能是几十秒甚至更久之前
            // （上次开 HUD 时）的数字，拿一个过期的值当「这一轮开始时的余额」，
            // 会把上一轮或者更早的消耗也算进这一轮里。这里强制现拉一次，
            // 保证基线真的对得上「此刻」。只对主会话做，子代理并发跑的话
            // 不会一起把余额接口打爆。
            turnBalanceStart.set(
              sessionId,
              isPrimary(sessionId)
                ? fetchBalance(true).then((b) => (b && b.ok ? b.totalBalance : null)).catch(() => null)
                : Promise.resolve(null),
            )
            st.status = 'running'
            st.turn = d.turn
            st.busySince = Date.now()
            if (isPrimary(sessionId)) broadcast({ t: 'turn-start', sessionId, turn: d.turn })
            else broadcast({ t: 'subagent', sessionId, active: true, kind: 'turn-start' })
            return
          }
          if (type === 'step/start') {
            st.step = d.step
            if (isPrimary(sessionId)) broadcast({ t: 'step-start', sessionId, turn: d.turn, step: d.step })
            return
          }
          if (type === 'assistant/message') {
            if (d.usage) {
              const hit = Number(d.usage.cacheReadTokens) || 0
              const miss = Number(d.usage.inputTokens) || 0
              const out = Number(d.usage.outputTokens) || 0
              const t = hit + miss + out
              turnTokens.set(sessionId, (turnTokens.get(sessionId) || 0) + t)
              // 钱包：把这一轮的三个口径也累计起来（用于算钱）
              const u = turnUsage.get(sessionId) || { hit: 0, miss: 0, out: 0, model: '' }
              u.hit += hit
              u.miss += miss
              u.out += out
              const model = (d.message && d.message.model) || d.model
              if (model) u.model = String(model)
              turnUsage.set(sessionId, u)
            }
            if (!isPrimary(sessionId)) return
            const usage = d.usage || null
            broadcast({
              t: 'assistant',
              sessionId,
              turn: d.turn,
              step: d.step,
              text: textOf(d.message).slice(0, 8000),
              interrupted: d.interrupted === true,
              usage: usage
                ? {
                    input: usage.inputTokens || 0,
                    cache: usage.cacheReadTokens || 0,
                    output: usage.outputTokens || 0,
                  }
                : null,
            })
            return
          }
          if (type === 'assistant/attempt') {
            if (isPrimary(sessionId)) broadcast({ t: 'attempt-failed', sessionId, turn: d.turn })
            return
          }
          if (type === 'tool/call') {
            const startedAt = Date.now()
            pendingTools.set(String(d.callId), { name: d.name, startedAt })
            if (!isPrimary(sessionId)) return
            let args = ''
            try {
              args = String(d.arguments || '')
            } catch (err) {}
            broadcast({
              t: 'tool-call',
              sessionId,
              callId: String(d.callId),
              name: d.name,
              label: TOOL_LABELS[d.name] || d.name,
              args: args.slice(0, 600),
            })
            return
          }
          if (type === 'tool/result') {
            const callId = d.message && d.message.content && d.message.content[0] && d.message.content[0].toolCallId
            const key = String(callId || '')
            const pending = pendingTools.get(key)
            if (pending) pendingTools.delete(key)
            if (!isPrimary(sessionId)) return
            broadcast({
              t: 'tool-result',
              sessionId,
              callId: key,
              name: (pending && pending.name) || '',
              label: (pending && TOOL_LABELS[pending.name]) || (pending && pending.name) || '',
              ms: pending ? Date.now() - pending.startedAt : null,
              error: d.error ? { name: d.error.name, code: d.error.code } : null,
            })
            return
          }
          if (type === 'turn/end') {
            st.status = 'idle'
            const ms = st.busySince ? Date.now() - st.busySince : null
            st.busySince = 0
            const tokens = turnTokens.get(sessionId) || 0
            turnTokens.delete(sessionId)
            // 钱包结算：按「下单时刻」的峰谷 + 模型档位，从 assistant/message 上报的
            // usage 估一个数——但这个字段有些后端/模型不带，带不到就是 0。
            // 先用这个估算立刻广播（不等网络），下面再拿余额差分补一条更准的。
            const u = turnUsage.get(sessionId) || { hit: 0, miss: 0, out: 0, model: '' }
            turnUsage.delete(sessionId)
            const startBalancePromise = turnBalanceStart.get(sessionId) || Promise.resolve(null)
            turnBalanceStart.delete(sessionId)
            const nowSec = Math.floor(Date.now() / 1000)
            const peak = isPeakTime(nowSec)
            // 「事件匹配」：自定义厂商配了关键字、这一轮用的模型名命中，就用
            // 自定义单价直接算钱——这条路径本来就是给没有余额可查的模型/
            // 公司内部网关兜底的，下面不会再拿余额差分去「纠正」它。
            const cfg = readConfig()
            const eventTable =
              cfg.walletProvider === 'custom' && matchesEventKeywords(cfg, u.model) ? customPriceTier(cfg) : null
            const estAmount = tokens > 0 ? costOf(u, peak, priceTier(u.model), eventTable) : 0
            wallet.turnSeq += 1
            const seq = wallet.turnSeq
            wallet.lastTurn = {
              seq,
              turn: d.turn || null,
              amount: Math.round(estAmount * 1e6) / 1e6,
              tokens,
              ts: Date.now(),
              isPeak: peak,
              tier: priceTier(u.model),
              detail: { hit: u.hit, miss: u.miss, out: u.out },
              source: eventTable ? 'event-match' : 'estimate',
            }
            if (tokens > 0) addTodayTokens(tokens)
            bumpStats(tokens)
            if (isPrimary(sessionId)) {
              broadcast({ t: 'turn-end', sessionId, turn: d.turn, reason: d.reason, ms, tokens,
                amount: wallet.lastTurn.amount, isPeak: peak })
              // HUD 靠这条立刻弹出来，不用等前端再拉一次（这一下用的还是估算值，
              // 除非走的是事件匹配——那条路径本身就是权威结果，不是估算）
              broadcast({ t: 'hud-turn', sessionId, turn: wallet.lastTurn })
              // 余额差分：等 turn/start 那次现拉的余额到手，再拉一次最新的，两个
              // 一减就是这一轮真实花了多少（顺带把「今日已用」也刷新了，见
              // fetchBalance）。异步跑，跑完了补一条更准的 hud-turn；跑的时候
              // 如果已经是下一轮了（seq 对不上）就不广播，免得把新一轮的数覆盖掉。
              // 事件匹配已经是权威结果了，跳过——它本来就是给查不到余额的
              // 模型兜底的，没有余额可以拿来「纠正」。
              if (!eventTable) {
                startBalancePromise
                  .then((startBalance) => {
                    if (startBalance == null) return null
                    return fetchBalance(true).then((bal) => {
                      if (!bal || !bal.ok || wallet.turnSeq !== seq) return
                      const diff = startBalance - bal.totalBalance
                      if (diff <= 0) return // 没花钱，或者中途充值了，估算值/0 已经够用
                      wallet.lastTurn = Object.assign({}, wallet.lastTurn, {
                        amount: Math.round(diff * 1e6) / 1e6,
                        source: 'balance-diff',
                      })
                      broadcast({ t: 'hud-turn', sessionId, turn: wallet.lastTurn })
                    })
                  })
                  .catch(() => {})
              }
            } else {
              broadcast({ t: 'subagent', sessionId, active: false, kind: 'turn-end' })
            }
            return
          }
          if (type === 'approval/asked') {
            if (isPrimary(sessionId)) broadcast({ t: 'approval', sessionId, state: 'asked' })
            return
          }
          if (type === 'approval/decided') {
            if (isPrimary(sessionId)) broadcast({ t: 'approval', sessionId, state: 'decided' })
            return
          }
          if (type === 'session/title') {
            if (isPrimary(sessionId) && d.title) broadcast({ t: 'title', sessionId, title: String(d.title) })
            return
          }
        } catch (err) {
          /* 同上：事件桥不许抛 */
        }
      }),
    )

    disposers.push(
      ctx.on('session/disposed', (session) => {
        const id = session && session.id
        if (!id) return
        // 分身会话如果没走完整的 turn/end 就被销毁了（崩溃/被杀），前端的
        // 「有几个分身在干活」计数会漏减一——补一条 subagent:false，让前端清账。
        if (id !== primarySessionId) broadcast({ t: 'subagent', sessionId: id, active: false, kind: 'disposed' })
        turnTokens.delete(id)
        turnBalanceStart.delete(id)
        sessionState.delete(id)
        if (primarySessionId === id) primarySessionId = null
        if (lastSessionId === id) lastSessionId = null
      }),
    )

    route('exact', '/dsh-pet/events', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      // 连上先给一份当前状态，桌宠不用等下一个事件才知道自己在什么状态
      const state = primarySessionId ? stateOf(primarySessionId) : null
      res.write(
        `data: ${JSON.stringify({
          t: 'hello',
          sessionId: primarySessionId || lastSessionId || null,
          status: state ? state.status : 'idle',
          ts: Date.now(),
        })}\n\n`,
      )
      clients.add(res)
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n')
        } catch (err) {
          clearInterval(ping)
          clients.delete(res)
        }
      }, 15000)
      const cleanup = () => {
        clearInterval(ping)
        clients.delete(res)
      }
      req.on('close', cleanup)
      req.on('error', cleanup)
      res.on('error', cleanup)
    })

    /**
     * 右键 HUD 的数据源：余额 + 峰谷 + 本轮消耗 + 今日累计。
     * ?refresh=1 强制刷新余额（前端有 60 秒节流）。
     */
    route('exact', '/dsh-pet/hud', async (req, res) => {
      if (rejected(req, res)) return
      try {
        const force = /[?&]refresh=1/.test(req.url || '')
        await fetchBalance(force)
        const snap = walletSnapshot()
        const body = JSON.stringify(snap)
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Length': String(Buffer.byteLength(body)),
        })
        res.end(body)
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err).slice(0, 200) }))
      }
    })

    route('exact', '/dsh-pet/state', (req, res) => {
      const sid = primarySessionId || lastSessionId
      const st = sid ? stateOf(sid) : { status: 'idle', turn: 0, step: 0 }
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' })
      res.end(
        JSON.stringify({
          ok: true,
          version: VERSION,
          sessionId: sid,
          status: st.status,
          turn: st.turn,
          step: st.step,
          clients: clients.size,
          hasSessionController: !!ctx.get('sessionController'),
        }),
      )
    })

    // ————————————————————————————————————————————————————————————
    // 3. 反向通道：桌宠 → 会话
    // ————————————————————————————————————————————————————————————

    function readBody(req, limit = 256 * 1024) {
      return new Promise((resolve, reject) => {
        const chunks = []
        let size = 0
        req.on('data', (c) => {
          size += c.length
          if (size > limit) {
            reject(new Error('body too large'))
            req.destroy()
            return
          }
          chunks.push(c)
        })
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        req.on('error', reject)
      })
    }

    async function json(req, res) {
      let body
      try {
        body = JSON.parse((await readBody(req)) || '{}')
      } catch (err) {
        res.writeHead(400, { 'Content-Type': MIME['.json'] })
        res.end(JSON.stringify({ ok: false, error: 'bad json' }))
        return null
      }
      return body
    }

    function resolveSession(requested) {
      const candidate = requested || primarySessionId || lastSessionId
      if (!candidate) return null
      return candidate
    }

    route('exact', '/dsh-pet/say', async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      const body = await json(req, res)
      if (!body) return
      const text = String(body.text || '').trim()
      if (!text) {
        res.writeHead(400, { 'Content-Type': MIME['.json'] })
        res.end(JSON.stringify({ ok: false, error: 'empty text' }))
        return
      }
      const controller = ctx.get('sessionController')
      if (!controller || typeof controller.prompt !== 'function') {
        res.writeHead(503, { 'Content-Type': MIME['.json'] })
        res.end(JSON.stringify({ ok: false, error: 'session controller unavailable' }))
        return
      }
      let sessionId = resolveSession(body.sessionId)
      let created = false
      if (!sessionId && typeof controller.create === 'function') {
        // 还没有会话就自己开一个——否则主人刚打开 DSH 时点桌宠说话会直接失败。
        try {
          const made = await controller.create({})
          sessionId = made && made.sessionId
          created = true
        } catch (err) {
          try {
            console.error('[live2d-pet] 自动建会话失败：', (err && err.stack) || err)
          } catch (e) {}
        }
      }
      if (!sessionId) {
        res.writeHead(503, { 'Content-Type': MIME['.json'] })
        res.end(JSON.stringify({ ok: false, error: 'no active session' }))
        return
      }
      try {
        // 第二个参数 signal 是**必需**的：SessionController.prompt(request, signal) 里
        // 第一行就是 signal.throwIfAborted()。走 RPC 时由载体提供，直接调用必须自己给。
        await controller.prompt(
          {
            requestId: randomUUID(),
            sessionId,
            mode: body.mode === 'steer' ? 'steer' : 'queue',
            content: [{ type: 'text', text }],
          },
          new AbortController().signal,
        )
        res.writeHead(200, { 'Content-Type': MIME['.json'] })
        res.end(JSON.stringify({ ok: true, sessionId, created }))
      } catch (err) {
        // 把栈打到宿主日志——这条路径出错时，前端只拿到一句 message，根本没法定位
        try {
          console.error('[live2d-pet] /say 送话失败：', (err && err.stack) || err)
        } catch (e) {}
        res.writeHead(500, { 'Content-Type': MIME['.json'] })
        res.end(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }))
      }
    })

    // 中断当前轮次（桌宠菜单里的“打断”按钮）
    route('exact', '/dsh-pet/cancel', async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      const body = await json(req, res)
      if (!body) return
      const sessionId = resolveSession(body.sessionId)
      const controller = ctx.get('sessionController')
      try {
        if (!sessionId || !controller || typeof controller.cancel !== 'function') {
          throw new Error('cancel unavailable')
        }
        await controller.cancel({ sessionId })
        res.writeHead(200, { 'Content-Type': MIME['.json'] })
        res.end(JSON.stringify({ ok: true }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': MIME['.json'] })
        res.end(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }))
      }
    })

    /**
     * 外部驱动通道。桌宠自己的菜单用它，agent 也可以直接 POST 过来让模型做指定反应
     * （见 tools/pet-ctl.mjs）。这是“agent 主动表演”的唯一入口。
     */
    route('exact', '/dsh-pet/control', async (req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': MIME['.json'] })
        res.end(JSON.stringify({ ok: true, version: VERSION, sessions: clients.size }))
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      const body = await json(req, res)
      if (!body) return
      const out = { t: 'control', ts: Date.now() }
      if (body.expression !== undefined) out.expression = body.expression === null ? null : String(body.expression)
      if (body.mood !== undefined) out.mood = body.mood === null ? null : String(body.mood)
      if (body.motion !== undefined) out.motion = body.motion === null ? null : String(body.motion)
      if (body.bubble !== undefined) out.bubble = body.bubble === null ? null : String(body.bubble)
      if (body.bubbleMs !== undefined) out.bubbleMs = Number(body.bubbleMs) || 0
      if (body.props !== undefined) out.props = body.props
      if (body.clearProps === true) out.clearProps = true
      if (body.say !== undefined) out.say = String(body.say)
      if (body.attention === true) out.attention = true
      sendLocal(out)
      res.writeHead(200, { 'Content-Type': MIME['.json'] })
      res.end(JSON.stringify({ ok: true, clients: clients.size, sent: out }))
    })

    // ————————————————————————————————————————————————————————————
    // 4. 独立桌面窗口：一个只放桌宠的极简页面，用 Chrome --app 打开就是一个
    //    无浏览器边框的常驻小窗（DSH 标签页关掉也还在）。
    // ————————————————————————————————————————————————————————————
    route('exact', '/dsh-pet/standalone', (req, res) => {
      const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DS 鲸鱼娘 · 桌宠</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:transparent}
  body{--dsh-pet-standalone:1}
</style>
</head><body>
<script src="/dsh-pet/pet.js"></script>
</body></html>`
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' })
      res.end(html)
    })

    // ————————————————————————————————————————————————————————————
    // 5. 自检页：一条 URL 看清桌宠到底走到哪一步了。
    //    开发时这台机器的无头浏览器起不了合成器，截图/自动化全废，
    //    所以把「模型加载到哪一步、哪些参数被过滤、掩码覆盖率多少」
    //    直接渲染成人类可读的报告，出问题时截个图就能定位。
    // ————————————————————————————————————————————————————————————
    route('exact', '/dsh-pet/diag', (req, res) => {
      const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DS 鲸鱼娘 · 自检</title>
<style>
 body{margin:0;padding:18px 20px 40px;font:13px/1.65 -apple-system,"PingFang SC",system-ui,sans-serif;
   background:#0f1117;color:#e6e9f2}
 h1{font-size:15px;margin:0 0 4px}
 .sub{opacity:.55;margin-bottom:14px;font-size:12px}
 pre{background:#171a23;border:1px solid #262a36;border-radius:10px;padding:12px 14px;
   white-space:pre-wrap;word-break:break-all;font-size:12px;line-height:1.6}
 .ok{color:#5ee6a8}.bad{color:#ff7b7b}.warn{color:#ffce6a}
</style></head><body>
<h1>DS 鲸鱼娘 · 自检</h1>
<div class="sub">这条页面会把桌宠的启动过程和运行状态直接打出来。桌宠本体在右下角。</div>
<pre id="out">正在启动…</pre>
<script src="/dsh-pet/pet.js"></script>
<script>
(function(){
  var lines=[], out=document.getElementById('out');
  function add(s){lines.push(s); out.textContent=lines.join('\\n');}
  var t0=Date.now();
  add('插件版本: ${VERSION}');
  add('页面地址: '+location.href);
  add('时间: '+new Date().toLocaleString());
  add('');
  add('— 运行时 —');
  ['Live2DCubismCore','PIXI'].forEach(function(k){add('  '+k+': '+(window[k]?'已加载':'缺失'))});
  setTimeout(function(){
    add('  PIXI.live2d: '+((window.PIXI&&window.PIXI.live2d)?'已加载':'缺失'));
    if(window.PIXI&&PIXI.live2d&&PIXI.live2d.Live2DModel) add('  Live2DModel: 存在');
    var st=window.DSHPet&&window.DSHPet.state;
    add('');
    add('— 模型 —');
    if(!st){add('  <span class="bad">桌宠还没就绪（模型可能没加载出来）</span>')}
    else{
      add('  原始尺寸: '+(st.modelSize?Math.round(st.modelSize.w)+' × '+Math.round(st.modelSize.h):'未知'));
      add('  取景: '+(st.view?st.view.w+'×'+st.view.h+' ('+st.view.mode+', 缩放 '+st.view.scale+')':'未知'));
      if(st.contentBox){var b=st.contentBox;
        add('  角色实体范围: x '+b.x0+'–'+b.x1+' / y '+b.y0+'–'+b.y1+'（画布归一化，由启动自测得出）')}
      else add('  <span class="warn">角色实体范围未测出（按整张画布取景）</span>');
      add('  可用表情: '+st.expressions.length+' 个');
      add('  可用动作: '+st.motions.join(', '));
      add('');
      add('— 参数过滤 —');
      if(st.droppedParams.length) add('  <span class="warn">忽略 '+st.droppedParams.length+' 个：'+st.droppedParams.join('、')+'</span>');
      else add('  <span class="ok">全部表情参数都存在</span>');
    }
    add('');
    add('— 提示 —');
    add('  右键桌子上的鲸鱼娘 / 点 ⋯ 可以换表情、道具、动作、取景；双击开输入框。');
    add('  如果模型没出来，把这一页截图发出来即可定位。');
  }, 4000);
})();
</script>
</body></html>`
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' })
      res.end(html)
    })

    // ————————————————————————————————————————————————————————————
    // 6. 注入 index.html
    // ————————————————————————————————————————————————————————————
    disposers.push(
      ctx.webServer.tapIndex((html) => {
        if (!readConfig().enabled) return html
        if (html.indexOf('/dsh-pet/pet.js') !== -1) return html
        const tag = '<script defer src="/dsh-pet/pet.js"></script>'
        if (html.indexOf('</body>') !== -1) return html.replace('</body>', tag + '</body>')
        return html + tag
      }),
    )

    ctx.effect(() => () => {
      for (const res of clients) {
        try {
          res.end()
        } catch (err) {}
      }
      clients.clear()
      for (const d of disposers) {
        try {
          d()
        } catch (err) {}
      }
    })

    try {
      // 启动就把「桌面版通行证」准备好：macOS 原生壳启动时要先读它再加载页面，
      // 如果等到第一个请求才生成，壳子会一直拿不到（鸡生蛋）。
      desktopKey()
      console.log(
        `[live2d-pet] 已挂载：/dsh-pet/pet.js · 模型目录 ${MODEL_DIR} · 桌面版通行证 ${DESKTOP_FILE}`,
      )
    } catch (err) {}
    })
  },
}
