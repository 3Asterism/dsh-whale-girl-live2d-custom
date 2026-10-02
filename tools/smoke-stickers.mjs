#!/usr/bin/env node
/**
 * smoke-stickers.mjs —— 表情包 + 「有灵魂」新场景，在真浏览器里的自检（v0.5.1）。
 *
 * 连接方式照抄 tools/smoke.mjs（浏览器级端点 + Target session + --no-sandbox）。
 *   node tools/preview-server.mjs &                 # 先起预览服务器
 *   CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node tools/smoke-stickers.mjs --shots /tmp/dshp-shots
 *
 * 最要紧的一条：**表情包绝不能把气泡拖长**——台词气泡出现到消失的时间，必须等于不挂图时的 ttl（最多 +400ms 吸附）。
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
const SHOT_DIR = arg('shots', '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-stk-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--no-sandbox', '--disable-gpu-sandbox', '--no-zygote', '--disable-dev-shm-usage', '--disable-crash-reporter',
    '--disable-breakpad', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1200,820', 'about:blank',
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId, 5000).catch(() => {})
  await send('Page.enable', {}, sessionId, 5000).catch(() => {})
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__dshpLogs=[];(function(){var o=console.error;console.error=function(){window.__dshpLogs.push('E:'+Array.prototype.join.call(arguments,' '));return o.apply(console,arguments)}})();window.addEventListener('error',function(e){window.__dshpLogs.push('X:'+(e.message||''))});`,
  }, sessionId, 5000).catch(() => {})
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId, 60000)
    if (r.exceptionDetails) throw new Error('页面异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text))
    return r.result && r.result.value
  }
  const shoot = async (name) => {
    if (!SHOT_DIR) return
    try {
      const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId, 60000)
      fs.mkdirSync(SHOT_DIR, { recursive: true })
      fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(s.data, 'base64'))
    } catch (e) {}
  }
  const st = () => ev('JSON.stringify(DSHPet.stickers.state())').then(JSON.parse)
  const traceHas = (id) => ev(`DSHPet.director.trace().some(e => e.id === ${JSON.stringify(id)} && e.ok)`)
  const fresh = () => ev('DSHPet.stickers.reset(); DSHPet.director.clear(); 1')

  await send('Page.navigate', { url: URL_ }, sessionId, 8000).catch(() => {})
  console.log(`\n表情包 / 灵魂 自检 → ${URL_}\n`)
  let ready = false
  for (let i = 0; i < 70 && !ready; i++) {
    await sleep(500)
    try {
      ready = await ev('!!(window.DSHPet && window.DSHPet.stickers && DSHPet.stickers.state().count > 0)')
    } catch (e) {}
  }
  check('桌宠启动 + 表情包清单加载', !!ready)
  if (!ready) {
    console.log('  启动错误：', await ev('window.__DSHPetError || null').catch(() => null))
    return
  }

  // ── A. 宿主路由 ──
  const route = await ev(`(async () => {
    const m = await fetch('/dsh-pet/stickers/manifest.json').then(r => r.json())
    const any = Object.values(m.stickers)[0].file
    const g = await fetch('/dsh-pet/stickers/' + any)
    const png = await fetch('/dsh-pet/stickers/x.png')
    const trav = await fetch('/dsh-pet/stickers/..%2f..%2fpackage.json')
    return JSON.stringify({ n: Object.keys(m.stickers).length, gif: g.status, ct: g.headers.get('content-type'), png: png.status, trav: trav.status })
  })()`).then(JSON.parse)
  check('清单与 GIF 能取到、类型正确', route.n >= 60 && route.gif === 200 && /image\/gif/.test(route.ct), `${route.n} 张`)
  check('非 .gif/.json 与越界路径被拒', route.png === 403 && route.trav === 403, `png ${route.png} / 越界 ${route.trav}`)

  // ── B/C. 台词气泡：尺寸 + 不拖长 ──
  const LINE = `{ id: 't-c', pri: 1, tier: 'core', mood: 'happy', line: '（笑）测试台词', ms: 1800, habit: false }`
  const timed = `(async () => {
    const t = performance.now()
    DSHPet.director.perform(${LINE})
    const s0 = DSHPet.stickers.state()
    while (DSHPet.stickers.state().visible) { await new Promise(r => setTimeout(r, 20)); if (performance.now() - t > 8000) break }
    return JSON.stringify({ ms: Math.round(performance.now() - t), s0 })
  })()`
  await fresh()
  const withSk = JSON.parse(await ev(timed))
  await sleep(500)
  check('台词气泡里台词后面挂了表情包', !!withSk.s0.sticker && withSk.s0.text.includes('测试台词'), withSk.s0.sticker)
  check('表情包显示尺寸 ≈44px（略大于字符）', withSk.s0.size >= 28 && withSk.s0.size <= 56, `${withSk.s0.size}px`)
  await ev('DSHPet.stickers.cfg({ stickers: false }); 1')
  await fresh()
  const plain = JSON.parse(await ev(timed))
  await ev('DSHPet.stickers.cfg({ stickers: true }); 1')
  await sleep(500)
  check('关掉表情包开关后不出图', !plain.s0.sticker)
  // 截图要在气泡还开着的时候拍（上面那几次都是等它收起之后才回来的）
  await fresh()
  await ev(`DSHPet.director.perform({ id: 't-shot', pri: 1, tier: 'core', mood: 'love', line: '（脸红）主人今天也辛苦啦', ms: 4000, habit: false }); 1`)
  await sleep(400)
  const shotState = await st()
  check('长一点的台词 + 表情包不会把文字挤成窄列', shotState.visible && shotState.text.length > 8 && (await ev(`(() => { const b = document.querySelector('.dshp-bubble .dshp-body'); return b.getBoundingClientRect().width })()`)) >= 100, shotState.text)
  await shoot('01-line-sticker')
  await sleep(4200)
  check('表情包不拖长气泡（与不挂图相差 ≤ 450ms）', withSk.ms - plain.ms <= 450 && withSk.ms >= 1700, `挂图 ${withSk.ms}ms / 不挂图 ${plain.ms}ms`)

  // ── D. ttl 太短：指定的图太长就不能用它（可以换一张够短的，但绝不能拖长气泡）──
  await fresh()
  const shortRun = JSON.parse(await ev(`(async () => {
    DSHPet.director.perform({ id: 't-d', pri: 1, tier: 'core', sticker: 'clown2', line: '短', lineMs: 1000, ms: 1000, habit: false })
    return JSON.stringify(DSHPet.stickers.state())
  })()`))
  check('短 ttl 时不用太长的图（clown2 一圈 2s > 1s+0.4s；可换够短的，不拖长气泡）', shortRun.visible && !/clown2/.test(shortRun.sticker || ''), shortRun.sticker || '不挂')
  await sleep(1500)

  // ── E. 独立表情包（无台词） ──
  await fresh()
  const solo = JSON.parse(await ev(`(async () => {
    const t = performance.now()
    DSHPet.director.perform({ id: 't-e', pri: 1, tier: 'core', sticker: 'beg', ms: 2000, habit: false })
    const s0 = DSHPet.stickers.state()
    while (DSHPet.stickers.state().visible) { await new Promise(r => setTimeout(r, 20)); if (performance.now() - t > 8000) break }
    return JSON.stringify({ s0, ms: Math.round(performance.now() - t) })
  })()`))
  check('独立表情包：小气泡里只有图（没有文字）', solo.s0.solo && /beg\.gif/.test(solo.s0.sticker || '') && solo.s0.text === '')
  check('独立表情包停留 1.8–3.6 秒', solo.ms >= 1700 && solo.ms <= 3600, `${solo.ms}ms`)
  await fresh()
  await ev(`DSHPet.director.perform({ id: 't-e2', pri: 1, tier: 'core', sticker: 'beg', ms: 2000, habit: false }); 1`)
  await sleep(300)
  await shoot('02-solo-sticker')
  await sleep(2600)

  // ── F. 深度思考：reasoning 增量 → 「正在思考」 ──
  await fresh()
  await ev(`DSHPet.sim({ t: 'turn-start', turn: 11 }); DSHPet.sim({ t: 'step-start', turn: 11, step: 1 }); 1`)
  await sleep(150)
  await ev(`DSHPet.sim({ t: 'delta', kind: 'reasoning', text: '嗯…' }); 1`)
  await sleep(250)
  const think = await st()
  check('深度思考时出「正在思考」表情包（不用说话）', /thinking\.gif/.test(think.sticker || ''), think.sticker || JSON.stringify(think))
  await shoot('03-thinking')
  await ev(`DSHPet.sim({ t: 'delta', kind: 'reasoning', text: '再想想' }); 1`)
  await sleep(100)
  const think2 = await st()
  check('同一步里不重复出图', think2.sticker === think.sticker)
  await ev(`DSHPet.sim({ t: 'delta', kind: 'text', text: '好了' }); DSHPet.sim({ t: 'turn-end', turn: 11, reason: 'completed', ms: 3000, tokens: 10 }); 1`)
  await sleep(500)

  // ── G. 失败升级：停止工作 → 坐牢 → 一切都好 ──
  await ev(`DSHPet.sim({ t: 'turn-end', turn: 20, reason: 'completed', ms: 1, tokens: 0 }); 1`) // 清零 FLAG.fails
  await sleep(200)
  const ladder = []
  for (let i = 1; i <= 3; i++) {
    await fresh()
    await ev(`DSHPet.sim({ t: 'turn-start', turn: ${20 + i} }); DSHPet.sim({ t: 'turn-end', turn: ${20 + i}, reason: { kind: 'error', error: { message: 'boom' } }, ms: 500, tokens: 0 }); 1`)
    await sleep(350)
    const s = await st()
    ladder.push((s.sticker || '').replace(/.*\/stickers\//, '').replace(/\?.*/, ''))
    if (i === 2) await shoot('04-jail')
    await sleep(3400)
  }
  check('第 1 次失败：停止工作（崩了弹窗）', /^stopped\.gif/.test(ladder[0]), ladder[0])
  check('连着第 2 次失败：坐牢', /^jail\.gif/.test(ladder[1]), ladder[1])
  check('连着第 3 次失败：一切都好（This is fine）', /^fine[12]\.gif/.test(ladder[2]), ladder[2])
  await ev(`DSHPet.sim({ t: 'turn-start', turn: 30 }); DSHPet.sim({ t: 'turn-end', turn: 30, reason: 'completed', ms: 1, tokens: 0 }); 1`)
  await sleep(300)

  // ── H. 提议被拒 → 小丑 ──
  await fresh()
  await ev(`DSHPet.sim({ t: 'approval', state: 'asked', tool: 'bash' }); 1`)
  await sleep(200)
  await fresh()
  await ev(`DSHPet.sim({ t: 'approval', state: 'decided', outcome: 'rejected' }); 1`)
  await sleep(300)
  const clown = await st()
  check('用户拒绝她的提议：小丑', /clown[12]\.gif/.test(clown.sticker || ''), clown.sticker)
  await shoot('05-clown')
  await sleep(2800)

  // ── I. 余额 < 5 元 → 要米 ──
  await fresh()
  await ev(`fetch('/__balance?v=4.2').then(r => r.json())`)
  await ev(`DSHPet.sim({ t: 'turn-start', turn: 40 }); DSHPet.sim({ t: 'turn-end', turn: 40, reason: 'completed', ms: 500, tokens: 10 }); 1`)
  let beg = null
  for (let i = 0; i < 30 && !beg; i++) {
    await sleep(500)
    const s = await st()
    if (/beg\.gif/.test(s.sticker || '')) beg = s
  }
  check('余额 4.2 元（< 5）：要米', !!beg, beg ? beg.text.slice(0, 20) : '9s 内没出')
  await shoot('06-beg')
  await ev(`fetch('/__balance?v=42.5').then(r => r.json())`)

  // ── J0. 刚开机 / 刚新建会话：还没观察到任何请求，直接选了别家的模型也要有反应（之前的 bug：什么都没发生）──
  await fresh()
  await ev(`DSHPet.sim({ t: 'sev', k: 'model', src: 'selection', provider: 'silicon-flow', model: 'zai-org/GLM-5.3', effort: null }); 1`)
  await sleep(150)
  check('还没发过话就切成别家的模型：也有反应', await traceHas('soul-model-away'))

  // ── J1. DOM 兜底：DSH 的模型下拉（带「搜索模型…」输入框）里点了某一项，哪怕宿主事件没到也要有反应 ──
  await fresh()
  await ev(`DSHPet.sim({ t: 'tool-result', callId: 'nope' }); 1`)
  const domPick = await ev(`(async () => {
    const pop = document.createElement('div'); pop.id = 'fake-model-pop'
    pop.innerHTML = '<input placeholder="搜索模型..."><div>silicon-flow</div><div role="option" id="opt-ds">DeepSeek-V4-Pro</div><div role="option" id="opt-glm">zai-org/GLM-5.3</div>'
    document.body.appendChild(pop)
    document.getElementById('opt-glm').click()
    await new Promise(r => setTimeout(r, 150))
    const away = DSHPet.director.trace().some(e => e.id === 'soul-model-away' && e.ok)
    DSHPet.director.clear()
    document.querySelector('#fake-model-pop div').click() // 点分组标题：不该当成选模型
    await new Promise(r => setTimeout(r, 100))
    const titleIgnored = !DSHPet.director.trace().some(e => e.id === 'soul-model-away' || e.id === 'soul-model-back')
    DSHPet.director.clear()
    document.getElementById('opt-ds').click() // 点回 DeepSeek：欢迎回来
    await new Promise(r => setTimeout(r, 150))
    const back = DSHPet.director.trace().some(e => e.id === 'soul-model-back' && e.ok)
    pop.remove()
    return JSON.stringify({ away, titleIgnored, back })
  })()`).then(JSON.parse)
  check('模型下拉里点了别家的模型：吃醋（DOM 兜底）', domPick.away)
  check('点下拉里的分组标题不算选模型', domPick.titleIgnored)
  check('在下拉里点回 DeepSeek：欢迎回来（DOM 兜底）', domPick.back)

  // ── J. 换模型 / 权限 / 提问 / 重复重生成 ──
  await fresh()
  await ev(`DSHPet.sim({ t: 'sev', k: 'model', src: 'request', provider: 'deepseek', model: 'deepseek-chat', effort: null }); 1`)
  await ev(`DSHPet.sim({ t: 'sev', k: 'model', src: 'selection', provider: 'other', model: 'x-model', effort: null }); 1`)
  await sleep(150)
  check('换成别家的模型：吃醋', await traceHas('soul-model-away'))
  const noBrand = await st()
  check('台词里不出现模型名（不提第三方品牌）', !/x-model|deepseek/i.test(noBrand.text), noBrand.text)
  await ev(`DSHPet.sim({ t: 'sev', k: 'model', src: 'request', provider: 'other', model: 'x-model', effort: null }); 1`) // 记账：已在用别家
  await ev(`DSHPet.sim({ t: 'sev', k: 'model', src: 'selection', provider: 'deepseek', model: 'deepseek-chat', effort: null }); 1`)
  await sleep(150)
  check('从别家换回 DeepSeek：欢迎回来', await traceHas('soul-model-back'))

  await fresh()
  await ev(`DSHPet.sim({ t: 'sev', k: 'sandbox', mode: 'workspace-write' }); DSHPet.sim({ t: 'sev', k: 'sandbox', mode: 'danger-full-access' }); 1`)
  await sleep(150)
  check('权限放到最大：紧张', await traceHas('soul-sandbox'))

  await fresh()
  await ev(`DSHPet.sim({ t: 'tool-call', name: 'ask_user_question', callId: 'q1', args: '{}', label: '提问' }); 1`)
  await sleep(300)
  const ask = await st()
  check('她向主人提问：举牌 + 问号表情包', /question\.gif/.test(ask.sticker || '') && ask.text.includes('主人'), ask.sticker)
  const askPending = await ev('!!DSHPet.stickers.soul().ask')
  await ev(`DSHPet.sim({ t: 'tool-result', callId: 'q1', name: 'ask_user_question' }); 1`)
  const askDone = await ev('!DSHPet.stickers.soul().ask')
  check('提问有等待计时，回答后清掉', askPending && askDone)

  await ev(`DSHPet.director.clear(); 1`)
  await ev(`for (let i = 0; i < 3; i++) DSHPet.page.intent('regen'); 1`)
  await sleep(150)
  check('2 分钟内点 3 次「重新生成」：抱头', await traceHas('soul-regen-many'))

  // ── K. 发呆：输入框写了一半停着（话痨档） ──
  // 前面模拟的提问把 agent 状态留在「思考中」；先收一轮，回到空闲，发呆搭话才有前置条件
  await ev(`DSHPet.sim({ t: 'turn-end', turn: 90, reason: 'completed', ms: 1, tokens: 0 }); 1`)
  await sleep(3500)
  await fresh()
  await ev('DSHPet.stickers.hide(); 1')
  const idle = await ev(`(async () => {
    const ta = document.createElement('textarea'); ta.id = 'soul-test-ta'; document.body.appendChild(ta); ta.focus()
    DSHPet.stickers.cfg({ chatty: 2, idleChat: true })
    DSHPet.stickers.idleTick({ typing: { el: ta, len: 8, lastKey: performance.now() - 60000 }, sleeping: false })
    return JSON.stringify(DSHPet.stickers.state())
  })()`).then(JSON.parse)
  check('输入框写了一半停 45 秒+：探头问一句', await traceHas('soul-idle-input'), idle.text)
  await sleep(500)
  await fresh()
  const idleOff = await ev(`(async () => {
    DSHPet.stickers.cfg({ idleChat: false })
    DSHPet.stickers.idleTick({ typing: { el: document.getElementById('soul-test-ta'), len: 9, lastKey: performance.now() - 90000 }, sleeping: false })
    return DSHPet.director.trace().some(e => e.id === 'soul-idle-input' && e.ok && e.t > performance.now() - 300)
  })()`)
  check('关掉「发呆搭话」后不再出声', idleOff === false)
  await ev(`DSHPet.stickers.cfg({ chatty: 1, idleChat: true }); 1`)

  // ── L. 覆盖优先：连点新建会话，每次都该有图（「近期用过」只影响偏好，不会让它变成不挂）──
  await ev('DSHPet.stickers.reset(); DSHPet.stickers.hide(); 1')
  const cover = []
  for (let i = 0; i < 4; i++) {
    await ev(`DSHPet.director.clear(); DSHPet.page.intent('newSession'); 1`)
    await sleep(150)
    const s = await st()
    cover.push(!!s.sticker && !!s.text)
    if (i === 0) await shoot('07-new-session')
  }
  check('连点「新建会话」4 次，每次台词后面都有表情包', cover.every(Boolean), cover.join(','))

  // ── M. 常驻气泡（工具调用）：配图，但节流——干活时图不会一直在换 ──
  await ev(`DSHPet.sim({ t: 'turn-end', turn: 91, reason: 'completed', ms: 1, tokens: 0 }); 1`)
  await sleep(300)
  await ev('DSHPet.stickers.reset(); DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await ev(`DSHPet.sim({ t: 'tool-call', name: 'bash', callId: 'b1', args: '{"command":"ls"}', label: 'bash' }); 1`)
  await sleep(150)
  const tool1 = await st()
  await ev(`DSHPet.sim({ t: 'tool-result', callId: 'b1', name: 'bash' }); DSHPet.sim({ t: 'tool-call', name: 'grep', callId: 'b2', args: '{"pattern":"x"}', label: 'grep' }); 1`)
  await sleep(150)
  const tool2 = await st()
  check('工具调用的常驻气泡配图', !!tool1.sticker && /(type|work)\.gif/.test(tool1.sticker), tool1.sticker)
  check('常驻气泡配图有节流（20 秒内下一个工具不再换图）', !tool2.sticker)
  await ev(`DSHPet.sim({ t: 'turn-end', turn: 92, reason: 'completed', ms: 1, tokens: 0 }); 1`)

  // ── O. 好感页：重新编排（关系卡 → 今日心愿 → 状态 / 投喂 / 今日进度 → 图鉴 → 等级 / 回忆 → 开关 / 规则）──
  const today = await ev(`(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) })()`)
  await ev(`fetch('/__bond_seed', { method: 'POST', body: JSON.stringify({ firstSeenAt: Date.now() - 12 * 86400000, level: 3, xp: 120, wish: { date: ${JSON.stringify(today)}, id: 'praise', done: false, prev: '' } }) }).then((r) => r.json())`)
  await ev('DSHPet.stickers.reset(); DSHPet.director.clear(); DSHPet.stickers.hide(); DSHPet.bond.refresh()')
  await sleep(600)
  // 她用出一张表情包 → 上报进图鉴
  await ev(`DSHPet.stickers.show('jail'); 1`)
  await sleep(900)
  const album1 = JSON.parse(await ev('JSON.stringify(DSHPet.bond.snap().album)'))
  check('她用出一张表情包就收进图鉴（上报宿主）', album1.got === 1 && album1.ids.includes('jail') && album1.total >= 60, `${album1.got}/${album1.total}`)
  await ev(`DSHPet.stickers.show('jail'); 1`)
  await sleep(500)
  check('同一张再用不重复收录', JSON.parse(await ev('JSON.stringify(DSHPet.bond.snap().album)')).got === 1)

  // 打开菜单 →「好感」页
  await ev(`DSHPet.stickers.hide(); document.querySelectorAll('.dshp-dock .dshp-btn')[1].click(); 1`)
  await sleep(300)
  await ev(`[...document.querySelectorAll('.dshp-tab-btn')].find((b) => b.textContent.includes('好感')).click(); 1`)
  await sleep(1200)
  const page = JSON.parse(await ev(`(() => {
    const panes = document.querySelector('.dshp-panes')
    const titles = [...panes.querySelectorAll('details.dshp-sec > summary > span:first-child')].map((x) => x.textContent)
    const wish = panes.querySelector('.dshp-wish')
    const kids = [...panes.children].map((c) => (c.classList.contains('dshp-wish') ? 'WISH' : c.tagName === 'DETAILS' ? 'SEC:' + c.querySelector('summary span').textContent : c.className.split(' ')[0] || c.tagName))
    return JSON.stringify({ titles, wishText: wish ? wish.textContent : '', kids, hasCard: !!panes.querySelector('.dshp-kv') })
  })()`))
  const want = ['她的状态', '投喂', '今日进度', '表情包图鉴', '等级一览', '故事 · 回忆', '互动开关', '规则说明']
  check('好感页：分区顺序 = 她的状态 / 投喂 / 今日进度 / 表情包图鉴 / 等级 / 回忆 / 开关 / 规则', JSON.stringify(page.titles) === JSON.stringify(want), page.titles.join(' › '))
  check('好感页：「今日心愿」是不折叠的卡片，紧跟在关系卡后面、折叠分区前面', page.wishText.includes('今天想听主人夸一句') && page.kids.indexOf('WISH') >= 0 && page.kids.indexOf('WISH') < page.kids.findIndex((k) => k.startsWith('SEC:')), page.kids.slice(0, 4).join(' | '))
  await shoot('08-bond-top')
  await ev(`[...document.querySelectorAll('.dshp-panes details.dshp-sec')].find((d) => d.querySelector('summary span').textContent === '表情包图鉴').open = true; 1`)
  await sleep(500)
  const tiles = JSON.parse(await ev(`(() => { const g = document.querySelector('.dshp-album'); return JSON.stringify({ all: g.children.length, got: g.querySelectorAll('button.dshp-album-tile').length, locked: g.querySelectorAll('.dshp-locked').length, firstIsGif: !!g.querySelector('button img[src*=".gif"]') }) })()`))
  check('图鉴：展开后才加载图块；已收录的是动图按钮，没见过的只露几个「？」+ 一块「+N」（不会撑成一面墙）', tiles.got === 1 && tiles.locked === 9 && tiles.all === 10 && tiles.firstIsGif, JSON.stringify(tiles))
  await ev(`document.querySelector('.dshp-album').scrollIntoView({ block: 'center' }); 1`)
  await sleep(300)
  await shoot('09-bond-album')
  await ev(`document.querySelector('.dshp-album button.dshp-album-tile').click(); 1`)
  const cap = await ev(`document.querySelector('.dshp-album-cap').textContent`)
  check('图鉴：点一张已收录的图，下面显示它的梗', cap.includes('坐牢') && cap.includes('又失败'), cap)
  await ev(`document.dispatchEvent(new PointerEvent('pointerdown', { clientX: 2, clientY: 2, bubbles: true })); 1`) // 点别处收起面板
  await sleep(300)

  // 今日心愿：夸她一句 → 达成（演出 + 奖励写在脚注里）
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await ev(`DSHPet.bond.act('praise'); 1`)
  await sleep(900)
  const wishDone = JSON.parse(await ev(`JSON.stringify({ ok: DSHPet.director.trace().some((e) => e.id === 'wish-done' && e.ok), snap: DSHPet.bond.snap().wish, foot: document.querySelector('.dshp-foot').textContent })`))
  check('今日心愿达成：她庆祝一下，奖励公开写在脚注里', wishDone.ok && wishDone.snap.done === true && wishDone.foot.includes('心愿达成') && /羁绊 \+\d+/.test(wishDone.foot), wishDone.foot)

  // ── O2. 主动开口：每天第一次空闲时提一句心愿；每周回顾（白天空闲时一次）──
  await ev(`DSHPet.sim({ t: 'turn-end', turn: 96, reason: 'completed', ms: 1, tokens: 0 }); 1`)
  await sleep(12500) // 上一步心愿达成后排队的「小心愿」回忆要 4.6s 后弹、演 7s，等它演完，日常节律才不会让路
  await ev(`fetch('/__bond_seed', { method: 'POST', body: JSON.stringify({ firstSeenAt: Date.now() - 12 * 86400000, wish: { date: ${JSON.stringify(today)}, id: 'stroke', done: false, prev: '' } }) }).then((r) => r.json())`)
  await ev(`fetch('/__claims_reset').then((r) => r.json())`) // 页面自己的 20 秒定时器可能已经把今天的名额领走了
  await ev('DSHPet.bond.refresh(); DSHPet.stickers.reset(); DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await sleep(500)
  const wishSay = await ev(`(async () => { await DSHPet.stickers.routine(); await new Promise((r) => setTimeout(r, 200)); return JSON.stringify({ ok: DSHPet.director.trace().some((e) => e.id === 'routine-wish' && e.ok), text: DSHPet.stickers.state().text }) })()`).then(JSON.parse)
  check('每天第一次空闲时，她悄悄提一句今日心愿（不强求）', wishSay.ok && wishSay.text.includes('今天想被摸摸头'), wishSay.text)
  const wishAgain = await ev(`(async () => { DSHPet.director.clear(); DSHPet.stickers.hide(); await DSHPet.stickers.routine(); await new Promise((r) => setTimeout(r, 200)); return DSHPet.director.trace().some((e) => e.id === 'routine-wish' && e.ok) })()`)
  check('心愿一天只提一次', wishAgain === false)

  const hourNow = await ev('new Date().getHours()')
  await ev(`fetch('/__bond_seed', { method: 'POST', body: JSON.stringify({ firstSeenAt: Date.now() - 40 * 86400000, wish: { date: ${JSON.stringify(today)}, id: 'stroke', done: true, prev: '' }, lastWeek: { key: '2026-09-21', turns: 7, days: 4, feeds: 2, strokes: 3, praise: 1, wishes: 2, stickers: 5 } }) }).then((r) => r.json())`)
  await ev(`fetch('/__claims_reset').then((r) => r.json())`)
  await ev('DSHPet.bond.refresh(); DSHPet.stickers.reset(); DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await sleep(500)
  const recap = await ev(`(async () => { await DSHPet.stickers.routine(); await new Promise((r) => setTimeout(r, 200)); return JSON.stringify({ ok: DSHPet.director.trace().some((e) => e.id === 'routine-recap' && e.ok), text: DSHPet.stickers.state().text }) })()`).then(JSON.parse)
  if (hourNow >= 9 && hourNow < 21) check('每周回顾：白天空闲时讲一次，带上上周的轮数', recap.ok && /7/.test(recap.text), recap.text)
  else check('每周回顾：夜里 / 早上不开口（现在是 ' + hourNow + ' 点）', recap.ok === false)
  const recapAgain = await ev(`(async () => { DSHPet.director.clear(); DSHPet.stickers.hide(); await DSHPet.stickers.routine(); await new Promise((r) => setTimeout(r, 200)); return DSHPet.director.trace().some((e) => e.id === 'routine-recap' && e.ok) })()`)
  check('每周回顾一周只讲一次', recapAgain === false)

  // ── N. 工具栏（说话 / 菜单 / 收起 / 打开 DSH 四个按钮）：**只有点击她才出现**；悬停、拖动、按住都不出现 ──
  await ev(`DSHPet.sim({ t: 'turn-end', turn: 95, reason: 'completed', ms: 1, tokens: 0 }); 1`)
  await sleep(300)
  const dock = JSON.parse(await ev(`(async () => {
    const root = document.getElementById('dsh-live2d-pet')
    const dockEl = root.querySelector('.dshp-dock')
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const sr = () => document.querySelector('#dsh-live2d-pet .dshp-stage').getBoundingClientRect()
    const cx = () => { const r = sr(); return [r.left + r.width / 2, r.top + r.height / 2] }
    const fire = (t, px, py, buttons) => document.dispatchEvent(new PointerEvent(t, { clientX: px, clientY: py, button: 0, buttons: buttons == null ? (t === 'pointerdown' ? 1 : 0) : buttons, bubbles: true, cancelable: true }))
    const shown = () => root.classList.contains('dshp-dock-on') && getComputedStyle(dockEl).display !== 'none'
    root.classList.remove('dshp-dock-on', 'dshp-open')
    const out = {}
    out.initial = shown()
    // 1) 鼠标悬停在她身上 / 靠近工具栏原来的位置：不出现
    let [x, y] = cx()
    for (let i = 0; i < 8; i++) fire('pointermove', x + i * 3, y + i * 2)
    const dr = dockEl.getBoundingClientRect()
    fire('pointermove', (dr.left + dr.right) / 2 || x, (dr.top + dr.bottom) / 2 || y + 120)
    await sleep(400)
    out.hover = shown()
    // 2) 拖动她：不出现
    ;[x, y] = cx()
    fire('pointerdown', x, y); fire('pointermove', x - 15, y - 5, 1); fire('pointermove', x - 60, y - 20, 1); await sleep(50); fire('pointerup', x - 60, y - 20)
    await sleep(700)
    out.drag = shown()
    // 3) 按住不动（捏脸）：不出现
    ;[x, y] = cx()
    fire('pointerdown', x, y); await sleep(600); fire('pointerup', x, y)
    await sleep(300)
    out.hold = shown()
    // 4) 点一下：出现，四个按钮
    ;[x, y] = cx()
    fire('pointerdown', x, y)
    out.onDown = shown() // 按下的瞬间还不算点击
    fire('pointerup', x, y)
    await sleep(350)
    out.click = shown()
    out.buttons = dockEl.querySelectorAll('.dshp-btn').length
    out.opacity = getComputedStyle(dockEl).opacity
    // 5) 再点一下她：还在（只是续时间）
    ;[x, y] = cx()
    fire('pointerdown', x, y); fire('pointerup', x, y); await sleep(300)
    out.clickAgain = shown()
    // 6) 点别处：收起
    fire('pointerdown', 2, 2); fire('pointerup', 2, 2)
    await sleep(300)
    out.outside = shown()
    // 7) 点一下之后什么都不做：超时自己收（鼠标已经移开）
    ;[x, y] = cx()
    fire('pointerdown', x, y); fire('pointerup', x, y)
    fire('pointermove', 2, 2)
    await sleep(300)
    out.beforeTimeout = shown()
    await sleep(8800)
    out.afterTimeout = shown()
    // 8) 点一下再 Esc：收起
    ;[x, y] = cx()
    fire('pointerdown', x, y); fire('pointerup', x, y); await sleep(200)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await sleep(200)
    out.esc = shown()
    return JSON.stringify(out)
  })()`))
  check('平时四个按钮不存在（display:none）', dock.initial === false)
  check('鼠标悬停 / 靠近：不出现', dock.hover === false)
  check('拖动她：不出现', dock.drag === false)
  check('按住不动（捏脸）：不出现', dock.hold === false)
  check('点她一下：出现，四个按钮，完全可见', dock.onDown === false && dock.click === true && dock.buttons === 4 && Number(dock.opacity) > 0.9, JSON.stringify(dock))
  check('再点她一下：还在', dock.clickAgain === true)
  check('点别处：收起', dock.outside === false)
  check('点完什么都不做：超时自己收', dock.beforeTimeout === true && dock.afterTimeout === false, `${dock.beforeTimeout} → ${dock.afterTimeout}`)
  check('按 Esc：收起', dock.esc === false)

  // ── P. 贴着角落时：只点一下 / 按住不动，不能丢掉「贴角」状态（否则四个按钮会被挪到屏幕外面去）──
  // 用户报的 bug：点几下之后悬停、点击都叫不出按钮，只有拖一下才恢复。原因是 pointerdown 一按下就摘掉了 data-corner，
  // 工具栏从「侧边」跳回「下面」——贴角时下面没有空间，画到屏幕外了；单纯点击又不会触发松手后的重新吸附。
  await ev(`DSHPet.sim({ t: 'turn-end', turn: 97, reason: 'completed', ms: 1, tokens: 0 }); 1`)
  await sleep(300)
  const corner = JSON.parse(await ev(`(async () => {
    const root = document.getElementById('dsh-live2d-pet')
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const stage = () => document.querySelector('#dsh-live2d-pet .dshp-stage').getBoundingClientRect()
    const center = () => { const r = stage(); return [r.left + r.width / 2, r.top + r.height / 2] }
    const fire = (t, x, y, buttons) => document.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 0, buttons: buttons == null ? (t === 'pointerdown' ? 1 : 0) : buttons, bubbles: true, cancelable: true }))
    // 1) 真的拖到右下角，让她贴角
    let [x, y] = center()
    fire('pointerdown', x, y)
    fire('pointermove', x + 12, y + 12, 1)
    fire('pointermove', innerWidth - 8, innerHeight - 8, 1)
    await sleep(50)
    fire('pointerup', innerWidth - 8, innerHeight - 8)
    await sleep(900)
    const out = { snapped: root.dataset.corner || null, afterDrag: root.classList.contains('dshp-dock-on'), rounds: [] }
    // 2) 然后只点（不拖）5 次，再按住不动 1 次
    for (let i = 0; i < 6; i++) {
      ;[x, y] = center()
      root.classList.remove('dshp-dock-on')
      fire('pointerdown', x, y)
      if (i === 5) await sleep(600)
      fire('pointerup', x, y)
      await sleep(350)
      const dockEl = root.querySelector('.dshp-dock')
      const d = dockEl.getBoundingClientRect()
      out.rounds.push({
        hold: i === 5,
        corner: root.dataset.corner || null,
        shown: root.classList.contains('dshp-dock-on') && getComputedStyle(dockEl).display !== 'none',
        inView: d.width > 0 && d.left >= 0 && d.top >= 0 && d.right <= innerWidth && d.bottom <= innerHeight,
      })
    }
    return JSON.stringify(out)
  })()`))
  check('拖到角落后她贴角（工具栏挪到侧边）', !!corner.snapped && corner.afterDrag === false, `${corner.snapped}，拖完没有出现工具栏：${!corner.afterDrag}`)
  check('贴角后点 5 下 + 按住 1 次：贴角状态一直在，没被摘掉', corner.rounds.every((r) => r.corner === corner.snapped), corner.rounds.map((r) => r.corner).join(','))
  check('贴角时每次点击：四个按钮出现，而且整个在屏幕里（没被挤到屏幕外）', corner.rounds.filter((r) => !r.hold).every((r) => r.shown && r.inView), JSON.stringify(corner.rounds[0]))
  check('贴角时按住不动：不出现', corner.rounds.filter((r) => r.hold).every((r) => !r.shown))

  const logs = (await ev('(window.__dshpLogs||[]).slice(0,20)')) || []
  const errors = logs.filter((l) => l.indexOf('E:') === 0 || l.indexOf('X:') === 0)
  check('运行期没有 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | ') || '干净')
  ws.close()
}

main()
  .catch((err) => {
    console.error('\n自检脚本失败:', err.message)
    process.exitCode = 1
  })
  .finally(async () => {
    console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`)
    try {
      chrome.kill('SIGKILL')
    } catch (e) {}
    await sleep(200)
    try {
      fs.rmSync(profile, { recursive: true, force: true })
    } catch (e) {}
    process.exit(fail > 0 || process.exitCode ? 1 : 0)
  })
