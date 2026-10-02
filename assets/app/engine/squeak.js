/**
 * engine/squeak.js —— 点她「按下 / 松开」的小黄鸭音效（纯音频，不依赖别的前端模块）。
 *
 * 机制参考 dsh-whale-widget 的按压音效（它的代码是 MIT；这里的代码是重写的）。音频素材是同一对小黄鸭 mp3，
 * 署名见 NOTICE.md「2.6 音效」：
 *   · Web Audio 的 AudioBufferSourceNode，不走 <audio> —— 系统「正在播放」控件不会冒出来，起播延迟也低；
 *   · 启动时预取 + 预解码（warm），按下和起播在同一个任务里，手感贴手；缓冲区没就绪就静音，不现拉现解；
 *   · 松开音的时机：松手时按压音还没放完（= 快速点按）→ 在音频线程上排期到「按压音结束前 RELEASE_LEAD_MS」，
 *     无缝接上；松手时已放完（= 按住了一会儿）→ 立刻响；按压音完全不会重复；
 *   · 静默 IDLE_SUSPEND_MS 之后把 AudioContext suspend 掉，免得 running 的上下文让系统一直不睡眠；
 *   · 开关关掉时 warm() 也不做事 —— 连 AudioContext 都不会创建。
 */

/** 点按时松开音提前多少毫秒进场：0 = 正好接上，30–50 = 轻微交叠（更「黏」）。 */
export const RELEASE_LEAD_MS = 40
/** 静默多久把 AudioContext 交还给系统。0 = 不挂起（测试用）。 */
export const IDLE_SUSPEND_MS = 60000
/** 宿主路由（lib/http/static.js）。这里不 import config.js：它一加载就读 window / localStorage，Node 里没法测。 */
export const SOUND_BASE = '/dsh-pet/sound/'

/**
 * 按压音效控制器。
 *   getCtx()          返回一个 AudioContext（已 resume 或正在 resume），拿不到返回 null
 *   load(kind, ctx)   返回 Promise<AudioBuffer>，kind = 'press' | 'release'
 * 单独拆出来是为了在 Node 里拿假的 AudioContext 测时序。
 */
export function createSqueaker({ getCtx, load, idleMs = IDLE_SUSPEND_MS, leadMs = RELEASE_LEAD_MS } = {}) {
  let on = true
  let vol = 0.7
  let pressing = false // 手指 / 鼠标还按着
  let pressEnded = false // 按压音已经放完
  let releasePlayed = false // 本轮的松开音已经安排过了（排期也算）
  let pressNode = null
  let releaseNode = null
  let pressAt = 0 // 按压音起播的音频时钟时刻
  let pressDur = 0
  let idleTimer = null
  const store = new WeakMap() // ctx → { buf: {press, release}, loading: {press, release} }
  const warned = {}

  function slot(ctx) {
    let m = store.get(ctx)
    if (!m) store.set(ctx, (m = { buf: {}, loading: {} }))
    return m
  }

  /** 预取 + 预解码两条音。返回的 Promise 永远 resolve（失败只记一次警告，之后每次 warm 会再试）。 */
  function warm() {
    if (!on) return Promise.resolve()
    const ctx = getCtx()
    if (!ctx) return Promise.resolve()
    const m = slot(ctx)
    const jobs = ['press', 'release'].map((kind) => {
      if (m.buf[kind]) return Promise.resolve()
      if (!m.loading[kind]) {
        m.loading[kind] = Promise.resolve()
          .then(() => load(kind, ctx))
          .then((b) => {
            m.buf[kind] = b
          })
          .catch((err) => {
            if (!warned[kind]) {
              warned[kind] = 1
              try {
                console.warn('[鲸鱼娘] 按压音效加载失败（' + kind + '）：', (err && err.message) || err)
              } catch (e) {}
            }
          })
          .then(() => {
            delete m.loading[kind]
          })
      }
      return m.loading[kind]
    })
    return Promise.all(jobs).then(() => {})
  }

  function armIdle(ctx) {
    if (!(idleMs > 0)) return
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimer = null
      try {
        if (ctx.state === 'running') ctx.suspend()
      } catch (e) {}
    }, idleMs)
  }

  /** 起播一条。缓冲区没就绪返回 null。delaySec > 0 时用音频时钟排期，不受主线程抖动影响。 */
  function play(ctx, kind, delaySec) {
    const buf = slot(ctx).buf[kind]
    if (!buf) return null
    const gain = ctx.createGain()
    gain.gain.value = vol
    gain.connect(ctx.destination)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(gain)
    const delay = Math.max(0, delaySec || 0)
    src.start(delay > 0 ? ctx.currentTime + delay : 0)
    armIdle(ctx)
    return { src, at: ctx.currentTime + delay, dur: buf.duration }
  }

  function stopNode(n) {
    if (!n) return
    try {
      n.onended = null
      n.stop()
    } catch (e) {}
  }

  function stopAll() {
    stopNode(pressNode)
    stopNode(releaseNode)
    pressNode = releaseNode = null
  }

  function playRelease(ctx, delaySec) {
    if (releasePlayed || !on) return
    releasePlayed = true
    try {
      const h = play(ctx, 'release', delaySec)
      releaseNode = h ? h.src : null
    } catch (e) {}
  }

  return {
    warm,
    /** 按下：挤一声。 */
    down() {
      if (!on) return
      const ctx = getCtx()
      if (!ctx) return
      try {
        stopAll() // 连点：掐掉上一轮还在响 / 还在排期的，别叠成一团
        pressing = true
        pressEnded = false
        releasePlayed = false
        const h = play(ctx, 'press', 0)
        if (!h) {
          warm() // 还没加载好 / 上次失败：这次静音，顺手再预热一次
          pressEnded = true // 没有按压音可等，松手时松开音（若已就绪）直接响
          return
        }
        pressNode = h.src
        pressAt = h.at
        pressDur = h.dur
        h.src.onended = () => {
          if (pressNode !== h.src) return
          pressNode = null
          pressEnded = true
          // 点按时松手早于按压音结束，但排期已经安排过了（releasePlayed）；这里只兜住「排期没成功」的情况
          if (!pressing && !releasePlayed) playRelease(ctx, 0)
        }
      } catch (e) {}
    },
    /** 松开（含 pointercancel）：回一口气。 */
    up() {
      if (!pressing) return
      pressing = false
      if (!on) return
      const ctx = getCtx()
      if (!ctx) return
      // 按住了一会儿、按压音早放完了 → 立刻响
      if (pressEnded || !pressNode) return playRelease(ctx, 0)
      // 快速点按、按压音还在响 → 排到「按压音结束前 leadMs」
      const remain = Math.max(0, pressAt + pressDur - ctx.currentTime)
      playRelease(ctx, Math.max(0, remain - leadMs / 1000))
    },
    setOn(v) {
      on = !!v
      if (!on) {
        stopAll()
        pressing = false
      } else warm() // 启动 / 从设置里重新打开：马上预取 + 预解码
    },
    setVolume(v) {
      const n = Number(v)
      vol = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : vol
    },
    /** 调试用：当前状态。 */
    state: () => ({ on, vol, pressing, pressEnded, releasePlayed }),
  }
}

// ——————————————————————————————————————————————————————————————
// 浏览器里的默认实例
// ——————————————————————————————————————————————————————————————

let sharedCtx = null

function browserCtx() {
  try {
    if (!sharedCtx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      sharedCtx = new AC({ latencyHint: 'interactive' }) // 该 API 里延迟最低的一档，起播贴手
    }
    if (sharedCtx.state === 'suspended') {
      const p = sharedCtx.resume() // 没有用户手势时它会一直 pending，第一次点鲸鱼的 pointerdown 才真正放行
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }
    return sharedCtx
  } catch (e) {
    return null
  }
}

async function browserLoad(kind, ctx) {
  const r = await fetch(SOUND_BASE + 'duck-' + kind + '.mp3', { cache: 'no-cache' })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const raw = await r.arrayBuffer()
  if (raw.byteLength < 100) throw new Error('音频响应只有 ' + raw.byteLength + ' 字节')
  return new Promise((res, rej) => ctx.decodeAudioData(raw, res, rej))
}

export const squeak = createSqueaker({ getCtx: browserCtx, load: browserLoad })

// 页面藏起来（切标签 / 最小化）就立刻挂起，覆盖「开着过夜」的场景
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    try {
      if (document.hidden && sharedCtx && sharedCtx.state === 'running') sharedCtx.suspend()
    } catch (e) {}
  })
}
