/** 用户配置：默认值 + $DSH_HOME/dsh-live2d-pet.json 覆盖。 */

import fs from 'node:fs'
import { CONFIG_FILE } from './paths.js'

/** 默认配置；用户改 $DSH_HOME/dsh-live2d-pet.json 覆盖。 */
export const DEFAULT_CONFIG = {
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
  /** 表情包总开关：气泡里台词后面跟一张 GIF（赤风RED《蓝色大肥鱼》）。前端「好感」页里也能按人关。 */
  stickers: true,
  /** 钱包余额低于多少元（仅 CNY 账户）时，她「要米」。0 = 不要。 */
  lowBalanceYuan: 5,
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


export function readConfig() {
  let user = {}
  try {
    user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch (err) {
    /* 没配置或配置坏了都走默认值 */
  }
  return { ...DEFAULT_CONFIG, ...(user && typeof user === 'object' ? user : {}) }
}
