#!/usr/bin/env node
/**
 * smoke-perf.mjs —— 前端性能 review（v0.5.6）改掉的那几件事，在真浏览器里的自检。
 *
 * 连接方式照抄 tools/smoke-stickers.mjs（浏览器级端点 + Target session + --no-sandbox）。
 *   node tools/preview-server.mjs &                 # 先起预览服务器（建议用全新的：它的状态在内存里）
 *   CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node tools/smoke-perf.mjs
 *
 * 守住的是：
 *   · 忙碌气泡不再让合成器多出 2~3 倍的帧（脉冲点用阶梯动画；气泡 / 面板 / HUD 没有 backdrop-filter）
 *     —— 数的是合成帧数，不是 CPU 占用：软件渲染下 CPU% 噪声太大，帧数与硬件无关、很稳；
 *   · 低性能档真的有样式可认（去阴影 / 去动画 / 20 帧），设置页里有开关、会记住、重启后接着开；
 *   · 单击她不再量掩码（不读回 WebGL 画布）；真拖起来才量一次；
 *   · 窗口缩放事件合并成每帧一次；收起之后切回标签页不重开渲染循环；
 *   · 打字时的视线不再每 40ms 强制重排输入框；选模型弹层的识别行为不变；采样画布复用。
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name)
  return i === -1 ? dflt : process.argv[i + 1]
}
const URL_ = arg('url', 'http://127.0.0.1:5199/')
const PORT = Number(arg('port', 9700 + Math.floor(Math.random() * 250)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-perf-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--no-sandbox', '--disable-gpu-sandbox', '--no-zygote', '--disable-dev-shm-usage', '--disable-crash-reporter',
    '--disable-breakpad', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=560,900', 'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
)

async function main() {
  let ver = null
  for (let i = 0; i < 80 && !ver; i++) {
    try {
      ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
    } catch (e) {}
    if (!ver) await sleep(150)
  }
  if (!ver) throw new Error('Chrome 调试端口没起来')
  const ws = new WebSocket(ver.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  let id = 0
  const pend = new Map()
  let frames = 0 // 合成帧计数（screencast：每个有视觉变化的合成帧回一次）
  ws.addEventListener('message', (ev) => {
    let m
    try {
      m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'))
    } catch (e) {
      return
    }
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m)
      pend.delete(m.id)
    } else if (m.method === 'Page.screencastFrame') {
      frames++
      send('Page.screencastFrameAck', { sessionId: m.params.sessionId }, m.sessionId, 5000).catch(() => {})
    }
  })
  const send = (method, params, sessionId, to = 20000) =>
    new Promise((resolve, reject) => {
      const i = ++id
      const t = setTimeout(() => {
        pend.delete(i)
        reject(new Error('CDP 超时 ' + method))
      }, to)
      pend.set(i, (m) => {
        clearTimeout(t)
        m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)
      })
      const msg = { id: i, method, params: params || {} }
      if (sessionId) msg.sessionId = sessionId
      ws.send(JSON.stringify(msg))
    })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId, 5000).catch(() => {})
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId, 60000)
    if (r.exceptionDetails) throw new Error('页面异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text))
    return r.result && r.result.value
  }
  const mouse = (type, x, y, buttons = 0) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 }, sessionId, 5000)
  const imp = (p) => `import('/dsh-pet/app/${p}')`

  await send('Page.navigate', { url: URL_ }, sessionId, 8000).catch(() => {})
  console.log(`\n前端性能 自检 → ${URL_}\n`)
  const READY = `(async()=>{const {R}=await ${imp('core/state.js')};return !!(R.model&&R.coreModel&&R.ui&&window.DSHPet&&!window.__DSHPetError&&R.contentBox)})()`
  const waitReady = async () => {
    let ok = false
    for (let i = 0; i < 70 && !ok; i++) {
      await sleep(500)
      try {
        ok = await ev(READY)
      } catch (e) {}
    }
    return ok
  }
  const ready = await waitReady()
  check('桌宠启动', !!ready)
  if (!ready) {
    console.log('  启动错误：', await ev('window.__DSHPetError || null').catch(() => null))
    return
  }
  await sleep(1500)

  // ── A. 样式：没有 backdrop-filter、脉冲点是阶梯动画、合成帧数不被忙碌气泡拉高 ──
  console.log('A. 忙碌气泡 / 面板的样式与合成帧率')
  // 把状态钉成「干活中」：忙碌气泡本来就只在干活时出现；也让待机大脑别在测量窗口里插台词 / 挂 GIF 表情包
  const css = await ev(`(async () => {
    const {R, agent} = await ${imp('core/state.js')}
    agent.status = 'working'
    R.ui.bubble.show('正在整理资料，请稍候…', { name: '鲸鱼娘', busy: true, sticky: true })
    R.ui.root.classList.add('dshp-open'); R.ui.menu.el.classList.add('dshp-on'); R.ui.hud.el.classList.add('dshp-on')
    const bf = (el) => getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter || 'none'
    const dot = document.querySelector('.dshp-dot.dshp-pulse')
    const out = {
      bubble: bf(R.ui.bubble.el), panel: bf(R.ui.menu.el), hud: bf(R.ui.hud.el),
      dotAnim: dot ? getComputedStyle(dot).animationName : 'no-dot',
      dotTiming: dot ? getComputedStyle(dot).animationTimingFunction : '',
      dotIter: dot ? getComputedStyle(dot).animationIterationCount : '',
    }
    R.ui.root.classList.remove('dshp-open'); R.ui.menu.el.classList.remove('dshp-on'); R.ui.hud.el.classList.remove('dshp-on')
    return JSON.stringify(out)
  })()`).then(JSON.parse)
  check('气泡 / 面板 / HUD 都没有 backdrop-filter', css.bubble === 'none' && css.panel === 'none' && css.hud === 'none', JSON.stringify([css.bubble, css.panel, css.hud]))
  check('忙碌点仍在动（pulse 动画 infinite），但是阶梯缓动', css.dotAnim === 'dshp-pulse' && css.dotIter === 'infinite' && /^steps\(/.test(css.dotTiming), `${css.dotAnim} ${css.dotIter} ${css.dotTiming}`)

  await send('Page.startScreencast', { format: 'jpeg', quality: 5, everyNthFrame: 1, maxWidth: 140, maxHeight: 225 }, sessionId, 5000)
  const fpsOver = async (secs) => {
    const f0 = frames
    const t0 = Date.now()
    await sleep(secs * 1000)
    return (frames - f0) / ((Date.now() - t0) / 1000)
  }
  await ev(`(async()=>{const {R}=await ${imp('core/state.js')}; R.ui.bubble.hide(); return 1})()`)
  await sleep(1000)
  const idleFps = await fpsOver(4)
  await ev(`(async()=>{const {R}=await ${imp('core/state.js')}; R.ui.bubble.show('正在整理资料，请稍候…', { name: '鲸鱼娘', busy: true, sticky: true }); return 1})()`)
  await sleep(1500)
  const busyFps = await fpsOver(4)
  // 对照：把动画换回原来的连续缓动，合成帧应该明显更高——证明这个测量真的能抓到这个问题（不是恒成立的空断言）
  await ev(`(()=>{const s=document.createElement('style');s.id='perf-old-pulse';s.textContent='.dshp-dot.dshp-pulse{animation:dshp-pulse 1.1s ease-in-out infinite!important}';document.head.appendChild(s);return 1})()`)
  await sleep(1200)
  const oldFps = await fpsOver(4)
  await ev(`(()=>{document.getElementById('perf-old-pulse').remove();return 1})()`)
  check('纯待机的合成帧率 ≈ 画布帧率（20–40 帧/秒）', idleFps >= 15 && idleFps <= 45, `${idleFps.toFixed(1)} 帧/秒`)
  check('挂上忙碌气泡后合成帧率不被拉高（≤ 待机 ×1.4 且 ≤ 45）——以前是 ~100', busyFps <= idleFps * 1.4 && busyFps <= 45, `待机 ${idleFps.toFixed(1)} → 忙碌 ${busyFps.toFixed(1)} 帧/秒`)
  check('对照：换回原来的连续缓动会涨到 2 倍以上（测量有区分度）', oldFps >= idleFps * 2, `连续缓动 ${oldFps.toFixed(1)} 帧/秒`)
  await send('Page.stopScreencast', {}, sessionId, 5000).catch(() => {})
  await ev(`(async()=>{const {R}=await ${imp('core/state.js')}; R.ui.bubble.hide(); return 1})()`)

  // ── B. 点击 / 拖动：单击不量掩码，真拖起来才量一次 ──
  console.log('B. 单击不量掩码，拖动才量')
  const pt = await ev(`(async () => {
    const {R} = await ${imp('core/state.js')}
    const {hitTest} = await ${imp('engine/mask.js')}
    const r = R.ui.stage.getBoundingClientRect()
    for (let fy = 0.8; fy > 0.3; fy -= 0.05) for (let fx = 0.3; fx < 0.8; fx += 0.05) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy
      if (hitTest(x, y)) return { x, y }
    }
    return null
  })()`)
  check('找得到一个落在她身上的点', !!pt)
  const lastBuild = () => ev(`(async()=>{const {mask}=await ${imp('engine/mask.js')};return mask.lastBuild})()`)
  if (pt) {
    await ev(`(async()=>{const {mask}=await ${imp('engine/mask.js')};mask.dirty=false;return 1})()`)
    await sleep(500)
    const lb0 = await lastBuild()
    await mouse('mouseMoved', pt.x, pt.y)
    await mouse('mousePressed', pt.x, pt.y, 1)
    await sleep(60)
    const lbPressed = await lastBuild()
    await mouse('mouseReleased', pt.x, pt.y, 0)
    await sleep(300)
    const lbClick = await lastBuild()
    check('按下 / 单击（没拖动）：没有重建掩码（不读回画布）——以前每次按下都量一遍', lbPressed === lb0 && lbClick === lb0, `${lb0} → 按下 ${lbPressed} → 抬起 ${lbClick}`)
    await sleep(500)
    await mouse('mouseMoved', pt.x, pt.y)
    await mouse('mousePressed', pt.x, pt.y, 1)
    await sleep(60)
    const lbDown = await lastBuild()
    await mouse('mouseMoved', pt.x - 3, pt.y, 1)
    await sleep(40)
    const lbSmall = await lastBuild()
    await mouse('mouseMoved', pt.x - 40, pt.y - 10, 1)
    await sleep(80)
    const lbDrag = await lastBuild()
    check('按下后小抖动（≤ 6px）还不算拖动：不量', lbSmall === lbDown, `${lbDown} → ${lbSmall}`)
    check('真拖起来（位移 > 6px）那一刻量一次', lbDrag > lbDown, `${lbDown} → ${lbDrag}`)
    // 她默认贴在右墙，往右拖会被夹在墙上——往左拖才看得出跟手
    const moved = await ev(`(async()=>{const {R}=await ${imp('core/state.js')};const r=R.ui.root.getBoundingClientRect();return {l:r.left,w:r.width,h:r.height}})()`)
    await mouse('mouseMoved', pt.x - 90, pt.y - 20, 1)
    await sleep(80)
    const moved2 = await ev(`(async()=>{const {R}=await ${imp('core/state.js')};const r=R.ui.root.getBoundingClientRect();return {l:r.left,w:r.width,h:r.height}})()`)
    check('拖动照常跟手、尺寸不变（用按下时量好的尺寸夹边界）', moved2.l < moved.l - 20 && moved2.w === moved.w && moved2.h === moved.h, `left ${moved.l.toFixed(0)} → ${moved2.l.toFixed(0)}`)
    await mouse('mouseReleased', pt.x - 90, pt.y - 20, 0)
    await sleep(500)
    await ev(`(async()=>{const {R,agent}=await ${imp('core/state.js')};agent.status='idle';return 1})()`)
  }

  // ── C. 采样画布复用 ──
  console.log('C. 掩码采样画布复用')
  const canv = await ev(`(async () => {
    const {buildMask} = await ${imp('engine/mask.js')}
    buildMask(true) // 确保已经建过一张
    let n = 0
    const orig = document.createElement
    document.createElement = function (tag, ...a) { if (String(tag).toLowerCase() === 'canvas') n++; return orig.call(this, tag, ...a) }
    for (let i = 0; i < 8; i++) buildMask(true)
    document.createElement = orig
    return n
  })()`)
  check('连续 8 次强制重建掩码：不再新建 canvas', canv === 0, `${canv} 次`)

  // ── D. 窗口缩放合并 ──
  console.log('D. 窗口缩放事件合并')
  const rs = await ev(`(async () => {
    const {R} = await ${imp('core/state.js')}
    let n = 0
    const orig = R.app.renderer.resize.bind(R.app.renderer)
    R.app.renderer.resize = (...a) => { n++; return orig(...a) }
    for (let i = 0; i < 30; i++) window.dispatchEvent(new Event('resize'))
    const sync = n
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    await new Promise((r) => setTimeout(r, 100))
    R.app.renderer.resize = orig
    return JSON.stringify({ sync, after: n })
  })()`).then(JSON.parse)
  check('一口气来 30 个 resize：事件当场不处理（等下一帧）', rs.sync === 0, `当场 ${rs.sync} 次`)
  check('……下一帧只重设一次画布尺寸（以前 30 次）', rs.after === 1, `${rs.after} 次`)

  // ── E. 收起之后切回标签页不重开渲染循环 ──
  console.log('E. 收起后渲染循环')
  const tk = await ev(`(async () => {
    const {R} = await ${imp('core/state.js')}
    const {setHidden} = await ${imp('ui/panels.js')}
    const out = {}
    out.before = R.app.ticker.started
    setHidden(true)
    out.hidden = R.app.ticker.started
    document.dispatchEvent(new Event('visibilitychange')) // 无头里 document.hidden 恒为 false：等价于「切走又切回来」
    out.afterVis = R.app.ticker.started
    setHidden(false)
    out.shown = R.app.ticker.started
    document.dispatchEvent(new Event('visibilitychange'))
    out.shownAfterVis = R.app.ticker.started
    return JSON.stringify(out)
  })()`).then(JSON.parse)
  check('收起：渲染循环停了', tk.before === true && tk.hidden === false, JSON.stringify(tk))
  check('收起后「标签页重新可见」：渲染循环仍然是停的（以前会被重新开起来）', tk.afterVis === false)
  check('叫回来：渲染循环恢复，且重新可见事件不会误停它', tk.shown === true && tk.shownAfterVis === true)
  await sleep(1500) // 叫回来有一句台词，让它过去

  // ── F. 打字时视线不每 40ms 强制重排输入框 ──
  console.log('F. 打字视线的输入框矩形缓存')
  const ty = await ev(`(async () => {
    const {TYPING} = await ${imp('behavior/page.js')}
    const {gazeTick} = await ${imp('engine/gaze.js')}
    const ta = document.createElement('textarea')
    ta.style.cssText = 'position:fixed;left:20px;top:20px;width:200px;height:40px'
    document.body.appendChild(ta)
    let n = 0
    const orig = ta.getBoundingClientRect
    ta.getBoundingClientRect = function () { n++; return orig.call(this) }
    TYPING.el = ta
    TYPING.lastKey = performance.now()
    for (let i = 0; i < 30; i++) gazeTick()
    const burst = n
    await new Promise((r) => setTimeout(r, 350))
    TYPING.lastKey = performance.now()
    gazeTick()
    const later = n
    ta.remove()
    TYPING.el = null
    TYPING.lastKey = 0
    return JSON.stringify({ burst, later })
  })()`).then(JSON.parse)
  check('打字时连着 30 次 gazeTick：只读 1 次输入框矩形（以前 30 次）', ty.burst === 1, `${ty.burst} 次`)
  check('超过 300ms 之后才再读一次（位置变了她还跟得上）', ty.later === 2, `${ty.later} 次`)

  // ── G. 选模型弹层识别：行为不变 ──
  console.log('G. 选模型弹层识别')
  const pick = await ev(`(async () => {
    const {SOUL} = await ${imp('behavior/soul.js')}
    const mk = (labels) => {
      const pop = document.createElement('div')
      pop.innerHTML = '<input placeholder="搜索模型…"><ul>' + labels.map((l) => '<li>' + l + '</li>').join('') + '</ul>'
      document.body.appendChild(pop)
      return pop
    }
    const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    SOUL.model.domAway = false
    const out = {}
    // 没有弹层时：点普通按钮，什么都不该发生
    const plain = document.createElement('button'); plain.textContent = 'GPT-4o mini 5'; document.body.appendChild(plain)
    click(plain)
    out.plain = SOUL.model.domAway
    plain.remove()
    // 有弹层：点非 DeepSeek 的模型 → 吃醋标记；点回 DeepSeek → 清掉
    const pop = mk(['GPT-4o mini 5', 'DeepSeek V3.1', 'silicon-flow'])
    const items = pop.querySelectorAll('li')
    click(items[0]); out.away = SOUL.model.domAway
    click(items[1]); out.back = SOUL.model.domAway
    click(items[2]); out.group = SOUL.model.domAway // 分组标题没有版本号数字：不算选模型，状态保持
    // 弹层关掉之后，再点一个长得一样的元素：不算（弹层不在了）
    pop.remove()
    SOUL.model.domAway = false
    const stray = document.createElement('li'); stray.textContent = 'Claude 4 Sonnet'; document.body.appendChild(stray)
    click(stray); out.outside = SOUL.model.domAway
    stray.remove()
    return JSON.stringify(out)
  })()`).then(JSON.parse)
  check('没有选模型弹层时，点普通按钮不触发', pick.plain === false)
  check('弹层里点非 DeepSeek 的模型 → 识别为「换走了」', pick.away === true)
  check('弹层里点回 DeepSeek → 识别为「换回来了」', pick.back === false)
  check('点分组标题（没有版本号数字）不算选模型', pick.group === false)
  check('弹层关掉之后，再点长得一样的元素不算', pick.outside === false)

  // ── I. 待机降帧 ──
  console.log('I. 待机自动降帧')
  const thr = await ev(`(async () => {
    const {R, agent} = await ${imp('core/state.js')}
    const {PERF} = await ${imp('engine/runtime.js')}
    const {gaze} = await ${imp('engine/gaze.js')}
    const {CFG} = await ${imp('config.js')}
    const {DIR, perform, PRI} = await ${imp('director/perform.js')}
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const out = {}
    CFG.idleThrottle = true
    // 先干活一下把帧率拉回 30（前面的段落可能已经让她静止够久、降过了），再从「刚静下来」开始计
    agent.status = 'working'
    await sleep(400)
    agent.status = 'idle'
    gaze.pointer.at = 0
    DIR.cur = null
    out.start = R.app.ticker.maxFPS
    // 静止满 4 秒才降（别一静下来就降）
    await sleep(2500)
    out.at2_5 = R.app.ticker.maxFPS
    let waited = 0
    while (!PERF.throttled && waited < 9000) { await sleep(200); waited += 200 }
    out.throttled = PERF.throttled; out.fpsThrottled = R.app.ticker.maxFPS
    // 待机级表演（换表情 / 碎碎念）不算「有动静」：15 帧够用
    perform({ id: 'perf-amb', pri: PRI.AMBIENT, tier: 'extra', mood: 'shy', ms: 3000, habit: false })
    await sleep(400)
    out.ambient = R.app.ticker.maxFPS
    // 鼠标一动：下一个 tick 就回满帧
    gaze.pointer.at = performance.now()
    await sleep(300)
    out.afterPointer = R.app.ticker.maxFPS; out.throttledAfterPointer = PERF.throttled
    // 鼠标停了 3 秒 + 静止 4 秒后再降；这里不等，直接验证「更高优先级的互动」会唤醒：
    gaze.pointer.at = 0
    let w2 = 0
    while (!PERF.throttled && w2 < 9000) { await sleep(200); w2 += 200 }
    out.rethrottled = PERF.throttled
    perform({ id: 'perf-touch', pri: PRI.TOUCH, tier: 'core', mood: 'happy', line: '（戳）', ms: 1500, habit: false })
    await sleep(300)
    out.afterTouch = R.app.ticker.maxFPS
    // agent 开始干活：不降
    DIR.cur = null
    agent.status = 'working'
    await sleep(300)
    out.working = R.app.ticker.maxFPS
    agent.status = 'idle'
    // 开关关掉：不降
    CFG.idleThrottle = false
    gaze.pointer.at = 0
    await sleep(6500)
    out.switchedOff = R.app.ticker.maxFPS; out.switchedOffThrottled = PERF.throttled
    CFG.idleThrottle = true
    agent.status = 'working'
    return JSON.stringify(out)
  })()`).then(JSON.parse)
  check('静止刚 2.5 秒还没降（要满 4 秒）', thr.start === 30 && thr.at2_5 === 30, `${thr.start} / ${thr.at2_5}`)
  check('静止满 4 秒后降到 15 帧', thr.throttled === true && thr.fpsThrottled === 15, `${thr.fpsThrottled} 帧`)
  check('待机级表演（换表情）不会唤醒它——否则一半以上的时间都降不下来', thr.ambient === 15, `${thr.ambient} 帧`)
  check('鼠标一动：回到 30 帧', thr.afterPointer === 30 && thr.throttledAfterPointer === false, `${thr.afterPointer} 帧`)
  check('停下后又能降回去', thr.rethrottled === true)
  check('戳她（更高优先级的表演）：立刻回 30 帧', thr.afterTouch === 30, `${thr.afterTouch} 帧`)
  check('agent 干活时不降', thr.working === 30, `${thr.working} 帧`)
  check('设置里关掉「待机降帧」：一直满帧', thr.switchedOff === 30 && thr.switchedOffThrottled === false, `${thr.switchedOff} 帧`)
  // 设置页开关 + 记住
  const tb = await ev(`(async () => {
    const {R} = await ${imp('core/state.js')}
    const {renderPane} = await ${imp('ui/menu/render-pane.js')}
    const {CFG} = await ${imp('config.js')}
    CFG.idleThrottle = true
    renderPane('setting')
    const btn = Array.from(R.ui.menu.panes.querySelectorAll('button')).find((b) => /^待机降帧/.test(b.textContent))
    const out = { t0: btn && btn.textContent }
    if (btn) btn.click()
    out.t1 = btn && btn.textContent
    out.cfg = CFG.idleThrottle
    out.saved = JSON.parse(localStorage.getItem('dsh-live2d-pet:layout') || '{}').idleThrottle
    if (btn) btn.click()
    out.t2 = btn && btn.textContent
    out.saved2 = JSON.parse(localStorage.getItem('dsh-live2d-pet:layout') || '{}').idleThrottle
    return JSON.stringify(out)
  })()`).then(JSON.parse)
  check('设置页有「待机降帧」开关：开 → 关 → 开，并记进本地偏好', tb.t0 === '待机降帧：开' && tb.t1 === '待机降帧：关' && tb.cfg === false && tb.saved === false && tb.t2 === '待机降帧：开' && tb.saved2 === true, JSON.stringify(tb))

  // ── H. 低性能档：样式真的认、设置页有开关、会记住 ──
  console.log('H. 省电模式（低性能档）')
  const lp = await ev(`(async () => {
    const {R} = await ${imp('core/state.js')}
    const {PERF, setLowPower} = await ${imp('engine/runtime.js')}
    const {renderPane} = await ${imp('ui/menu/render-pane.js')}
    const {CFG} = await ${imp('config.js')}
    CFG.idleThrottle = false // 这一段量的是基础帧率档：别让待机降帧把 maxFPS 改掉（降帧单独在 I 段测）
    R.ui.bubble.show('正在整理资料，请稍候…', { name: '鲸鱼娘', busy: true, sticky: true })
    // 阴影现在是预烘的静态画布（.dshp-shadow）；标准档要在、低性能档要藏掉；舞台本身不再有 filter
    const shadow = () => { const c = document.querySelector('.dshp-shadow'); return c ? getComputedStyle(c).display + '|' + getComputedStyle(c).filter : 'none-element' }
    const stageFilter = () => getComputedStyle(R.ui.stage).filter
    const dotAnim = () => getComputedStyle(document.querySelector('.dshp-dot')).animationName
    const out = { stdShadow: shadow(), stdStageFilter: stageFilter(), stdDot: dotAnim(), stdFps: R.app.ticker.maxFPS }
    setLowPower(true)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) // 调度器在渲染 tick 里改 maxFPS
    out.lowShadow = shadow(); out.lowDot = dotAnim(); out.lowFps = R.app.ticker.maxFPS
    out.lowClass = document.body.classList.contains('dshp-lowpower')
    setLowPower(false)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    out.backShadow = shadow(); out.backFps = R.app.ticker.maxFPS
    // 设置页里的开关
    renderPane('setting')
    const btn = Array.from(R.ui.menu.panes.querySelectorAll('button')).find((b) => /^省电模式/.test(b.textContent))
    out.btnText0 = btn && btn.textContent
    if (btn) btn.click()
    out.btnText1 = btn && btn.textContent
    out.perfAfterClick = PERF.low
    out.saved = JSON.parse(localStorage.getItem('dsh-live2d-pet:layout') || '{}').lowPower
    return JSON.stringify(out)
  })()`).then(JSON.parse)
  check('标准档：有预烘的阴影画布（blur）、舞台本身没有 filter、忙碌点在动、30 帧', /^block\|blur/.test(lp.stdShadow) && lp.stdStageFilter === 'none' && lp.stdDot === 'dshp-pulse' && lp.stdFps === 30, JSON.stringify([lp.stdShadow, lp.stdStageFilter, lp.stdDot, lp.stdFps]))
  check('低性能档：body 挂类、阴影藏掉、忙碌点不动画、20 帧', lp.lowClass && /^none\|/.test(lp.lowShadow) && lp.lowDot === 'none' && lp.lowFps === 20, JSON.stringify([lp.lowClass, lp.lowShadow, lp.lowDot, lp.lowFps]))
  check('切回标准档：阴影和 30 帧都回来', /^block\|blur/.test(lp.backShadow) && lp.backFps === 30)
  check('设置页有「省电模式」开关，点一下就开', lp.btnText0 === '省电模式：关' && lp.btnText1 === '省电模式：开' && lp.perfAfterClick === true, `${lp.btnText0} → ${lp.btnText1}`)
  check('开关写进本地偏好', lp.saved === true)
  await send('Page.navigate', { url: URL_ }, sessionId, 8000).catch(() => {})
  await sleep(800)
  const ready2 = await waitReady()
  check('刷新后重新启动', !!ready2)
  if (ready2) {
    await sleep(500)
    const boot = await ev(`(async () => {
      const {PERF} = await ${imp('engine/runtime.js')}
      const {R} = await ${imp('core/state.js')}
      return JSON.stringify({ low: PERF.low, cls: document.body.classList.contains('dshp-lowpower'), fps: R.app.ticker.maxFPS })
    })()`).then(JSON.parse)
    check('刷新后接着是省电模式（上次开过）', boot.low === true && boot.cls === true && boot.fps === 20, JSON.stringify(boot))
    // 收尾：关掉并清掉，别影响后面的人
    await ev(`(async () => {
      const {setLowPower} = await ${imp('engine/runtime.js')}
      setLowPower(false)
      const k = 'dsh-live2d-pet:layout'
      const j = JSON.parse(localStorage.getItem(k) || '{}'); delete j.lowPower; localStorage.setItem(k, JSON.stringify(j))
      return 1
    })()`)
  }

  const errs = await ev('window.__DSHPetError || null').catch(() => null)
  check('全程没有启动 / 运行错误', !errs, errs || '')
}

main()
  .catch((e) => {
    fail++
    console.log('  ❌ 自检异常：', e && e.message)
  })
  .finally(() => {
    console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`)
    try {
      chrome.kill('SIGKILL')
    } catch (e) {}
    process.exit(fail ? 1 : 0)
  })
