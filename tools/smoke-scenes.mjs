#!/usr/bin/env node
/**
 * smoke-scenes.mjs —— v0.5.7 新场景（157 张全量表情包 / 单发图 / 静置打游戏 / 压缩全流程 / 反差萌 / 妈妈梗 / 工作流…）在真浏览器里的自检。
 *
 * 连接方式照抄 tools/smoke.mjs（浏览器级端点 + Target session + --no-sandbox）。
 *   node tools/preview-server.mjs &                 # 先起预览服务器
 *   CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node tools/smoke-scenes.mjs --shots /tmp/dshp-shots
 *
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-scn-'))
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
  const fresh = () => ev('DSHPet.stickers.reset(); DSHPet.director.clear(); DSHPet.stickers.quietIdle(60000); 1')

  await send('Page.navigate', { url: URL_ }, sessionId, 8000).catch(() => {})
  console.log(`\n新场景 自检 → ${URL_}\n`)
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

  const sim = (m) => ev(`DSHPet.sim(${JSON.stringify(m)}); 1`)
  const perf = (spec) => ev(`DSHPet.director.perform(${JSON.stringify(spec)})`)
  const skFile = (s) => (s && s.sticker ? decodeURIComponent(s.sticker.split('/').pop().split('?')[0]).replace('.gif', '') : null)
  const pools = await ev(`import('/dsh-pet/app/persona/stickers.js').then(m => JSON.stringify({ EVENT: m.EVENT_STICKER, SOLO: m.SOLO_STICKER }))`).then(JSON.parse)

  // ── A. 157 张全部能取到 ──
  console.log('\nA. 素材\n')
  const all = await ev(`(async () => {
    const m = await fetch('/dsh-pet/stickers/manifest.json').then(r => r.json())
    const bad = []
    for (const [id, s] of Object.entries(m.stickers)) {
      const r = await fetch('/dsh-pet/stickers/' + s.file)
      if (r.status !== 200 || !/image\\/gif/.test(r.headers.get('content-type') || '')) bad.push(id)
    }
    return JSON.stringify({ n: Object.keys(m.stickers).length, bad })
  })()`).then(JSON.parse)
  check('清单 157 张，每张 GIF 都能取到', all.n === 157 && all.bad.length === 0, `${all.n} 张 ${all.bad.join(',')}`)

  // ── B. 单发图（没有台词，只有一张图的小气泡）──
  console.log('\nB. 单发图\n')
  await fresh()
  await ev('DSHPet.stickers.cfg({ idleChat: false }); 1') // 这一段要看单发图自己多久收起，别让待机大脑又丢一张进来
  await perf({ id: 't-solo', pri: 1, tier: 'core', habit: false, solo: 'idleGame', ms: 2600 })
  let s = await st()
  check('perform({ solo }) 出一个只有图的小气泡，图是「打游戏」', s.visible && s.solo && skFile(s) === 'game' && s.text === '', JSON.stringify(s))
  await shoot('solo-game')
  await sleep(3600)
  for (let i = 0; i < 6; i++) { // 启动后头几秒可能还有别的问候占着气泡，多等一会儿再判
    s = await st()
    if (!s.visible) break
    await sleep(500)
  }
  check('单发图停留时间由图自己决定（≈3 秒内收起）', !s.visible)
  await ev('DSHPet.stickers.cfg({ idleChat: true }); 1')
  await fresh()
  const seen = new Set()
  for (let i = 0; i < 10; i++) {
    await ev('DSHPet.director.clear(); 1')
    await perf({ id: 't-solo2', pri: 1, tier: 'core', habit: false, solo: 'idle', ms: 1500 })
    const x = await st()
    seen.add(skFile(x))
  }
  check('待机池里连抽 10 次，换着花样出（≥5 种、都在池里）', seen.size >= 5 && [...seen].every((i) => pools.SOLO.idle.includes(i)), [...seen].join(','))

  // ── C. 静置阶梯：主人安静满 60 秒 → 单发「打游戏」 ──
  console.log('\nC. 静置阶梯\n')
  await fresh()
  await ev('DSHPet.stickers.hide(); DSHPet.stickers.stillFor(75000); 1')
  await ev('DSHPet.stickers.idleTick({ typing: null, sleeping: false }); 1')
  s = await st()
  check('安静 75 秒：soulTick 单发「打游戏」，不带台词', (await traceHas('soul-idle-game')) && s.solo && skFile(s) === 'game', JSON.stringify(s))
  await ev('DSHPet.stickers.hide(); DSHPet.director.clear(); 1')
  await ev('DSHPet.stickers.idleTick({ typing: null, sleeping: false }); 1')
  check('同一段安静只出一次（不会每 15 秒又来一张）', !(await traceHas('soul-idle-game')))
  await ev('DSHPet.stickers.stillFor(20000); DSHPet.director.clear(); 1')
  await ev('DSHPet.stickers.idleTick({ typing: null, sleeping: false }); 1')
  check('刚有人动过（安静才 20 秒）不出', !(await traceHas('soul-idle-game')))

  // ── D. 压缩全流程 ──
  console.log('\nD. 压缩 / 整理记忆\n')
  await fresh()
  await sim({ t: 'sev', k: 'compaction', phase: 'start' })
  s = await st()
  check('compaction/start：她有话说、配了「记录」类的图', (await traceHas('compact-start')) && s.text.length > 0 && pools.EVENT.compactStart.includes(skFile(s)), `${s.text} / ${skFile(s)}`)
  await shoot('compact-start')
  await sleep(2100)
  await sim({ t: 'sev', k: 'compaction', phase: 'prune' })
  s = await st()
  check('清理旧工具结果：再说一句、配喷剂 / 垃圾桶', (await traceHas('compact-step')) && pools.EVENT.compactPrune.includes(skFile(s)), `${s.text} / ${skFile(s)}`)
  await sim({ t: 'sev', k: 'compaction', phase: 'end' })
  s = await st()
  check('compaction/end：结束一句 + 图', (await traceHas('compact-end')) && s.text.length > 0 && pools.EVENT.compactEnd.includes(skFile(s)), `${s.text} / ${skFile(s)}`)
  await fresh()
  await sim({ t: 'sev', k: 'compaction', phase: 'prune' })
  check('没有 start 的 prune 不插嘴', !(await traceHas('compact-step')))
  await sim({ t: 'sev', k: 'compaction', phase: 'end' })
  await ev('DSHPet.director.clear(); 1')
  // 点界面上的按钮：即时反馈
  await ev(`document.body.insertAdjacentHTML('beforeend', '<button id="t-compact" aria-label="压缩上下文">x</button><button id="t-attach" aria-label="Attach file">x</button><button id="t-fork" aria-label="分叉">x</button>'); 1`)
  await ev(`document.getElementById('t-compact').click(); 1`)
  check('点 DSH 的「压缩上下文」按钮：当场就有反应（和宿主事件共用一个冷却）', await traceHas('compact-start'))
  await ev('DSHPet.director.clear(); 1')
  await ev(`document.getElementById('t-attach').click(); 1`)
  s = await st()
  check('点「Attach file」：收到礼物（附件）', (await traceHas('page-attach')) && pools.EVENT.pageAttach.includes(skFile(s)), `${s.text} / ${skFile(s)}`)
  await ev('DSHPet.director.clear(); 1')
  await ev(`document.getElementById('t-fork').click(); 1`)
  s = await st()
  check('点「分叉」：举 Raid 牌兵分两路', (await traceHas('page-fork')) && pools.EVENT.pageFork.includes(skFile(s)), `${s.text} / ${skFile(s)}`)

  // ── E. 工作流 / 团队 ──
  console.log('\nE. 工作流 / 团队\n')
  await fresh()
  await sim({ t: 'sev', k: 'workflow', phase: 'start' })
  s = await st()
  check('工作流开始：举 Raid 牌', (await traceHas('soul-workflow-start')) && pools.EVENT.workflowStart.includes(skFile(s)), `${s.text} / ${skFile(s)}`)
  await shoot('workflow-raid')
  await sim({ t: 'sev', k: 'workflow', phase: 'end' })
  check('工作流结束：清点人数', await traceHas('soul-workflow-end'))
  await ev('DSHPet.stickers.cfg({ chatty: 2 }); 1')
  await sim({ t: 'sev', k: 'team' })
  check('团队有动静（话痨档）：举喇叭', await traceHas('soul-team'))
  await ev('DSHPet.stickers.cfg({ chatty: 1 }); 1')

  // ── F. 关键词：反差萌 + 妈妈梗 ──
  console.log('\nF. 关键词\n')
  const say = async (text) => {
    await ev('DSHPet.director.clear(); DSHPet.stickers.reset(); DSHPet.stickers.hide(); DSHPet.stickers.quietIdle(60000); 1')
    await sim({ t: 'user', text })
    return st()
  }
  // 第一次被叫胖 / 叫妈妈会解锁一条「回忆」，回忆那句会顶掉气泡——先各热身一次，后面测的才是关键词本身
  await say('你是不是又胖了')
  await say('叫你妈妈')
  const fatSeen = new Set()
  let fatLine = ''
  for (let i = 0; i < 14; i++) {
    const x = await say('你是不是又胖了')
    fatSeen.add(skFile(x))
    fatLine = x.text
  }
  check('被叫胖：嘴上否认，「肥鱼」便利贴自己蹦出来（反差萌）', [...fatSeen].some((i) => /^fatnote/.test(i)) && [...fatSeen].every((i) => pools.EVENT.kwFat.includes(i)), [...fatSeen].join(',') + ' / ' + fatLine)
  await say('你是不是又胖了')
  await sleep(500) // 等气泡按图的宽度重新排版（relayout 在下一帧）
  await shoot('fatnote')
  const cases = [
    ['67', 'kw-67', 'kw67'],
    ['xx是能成为我母亲的女性', 'kw-mother', 'kwMother'],
    ['你这是妈妈味吧', 'kw-baby', 'kwBaby'],
    ['奶妈来一口', 'kw-healer', 'kwHealer'],
    ['ママ！', 'kw-mama', 'kwMama'],
    ['这个 bug 怎么回事', 'kw-bug', 'kwBug'],
    ['又在摸鱼', 'kw-slack', 'kwSlack'],
    ['来杯可乐', 'kw-drink', 'kwDrink'],
    ['闭嘴一会', 'kw-quiet', 'kwQuiet'],
    ['好热啊', 'kw-hot', 'kwHot'],
    ['我想睡觉了', 'kw-sleep', 'kwSleep'],
  ]
  for (const [text, kw, sayId] of cases) {
    const x = await say(text)
    check(`「${text}」→ ${kw}：有台词、图出自 ${sayId} 池`, (await traceHas(kw)) && x.text.length > 0 && pools.EVENT[sayId].includes(skFile(x)), `${x.text} / ${skFile(x)}`)
  }
  await say('我有67个文件')
  check('「我有67个文件」不是梗，不触发 67', !(await traceHas('kw-67')))
  await shoot('kw-mama')

  // ── G. 收工特别版 / 慢工具回来 ──
  console.log('\nG. 收工与慢工具\n')
  const turn = async (end) => {
    await ev('DSHPet.observe.reset(); DSHPet.director.clear(); DSHPet.stickers.reset(); DSHPet.stickers.hide(); DSHPet.stickers.quietIdle(60000); 1') // 前面的关键词测试连发过同一句话（算「重复」），心情分要先清掉
    await sim({ t: 'turn-start', turn: 1 })
    await sim(Object.assign({ t: 'turn-end', turn: 1, reason: { kind: 'completed' } }, end))
    await sleep(200)
  }
  await turn({ ms: 5000, tokens: 1200000 })
  check('一轮烧了 120 万 token：着火收工', await traceHas('finish-burn'))
  await turn({ ms: 16 * 60000, tokens: 1000 })
  check('一轮跑了 16 分钟：电风扇收工', await traceHas('finish-marathon'))
  await turn({ ms: 5000, tokens: 3000 })
  check('普通一轮不触发特别版', !(await traceHas('finish-burn')) && !(await traceHas('finish-marathon')))
  await ev('DSHPet.director.clear(); 1')
  await sim({ t: 'turn-start', turn: 2 })
  await sim({ t: 'tool-call', callId: 'c1', name: 'bash', args: 'sleep 40' })
  await sim({ t: 'tool-result', callId: 'c1', name: 'bash', ms: 41000, error: null })
  s = await st()
  check('慢工具（41 秒）回来：跳散味舞', (await traceHas('long-tool-done')) && skFile(s) === 'dance_smell', `${s.text} / ${skFile(s)}`)
  await ev('DSHPet.director.clear(); 1')
  await sim({ t: 'tool-call', callId: 'c2', name: 'ask_user_question', args: '' })
  await sim({ t: 'tool-result', callId: 'c2', name: 'ask_user_question', ms: 90000, error: null })
  check('等人回话的工具再久也不算摸鱼', !(await traceHas('long-tool-done')))
  await sim({ t: 'turn-end', turn: 2, reason: { kind: 'completed' }, ms: 1000, tokens: 10 })

  // ── H. 连点她：Popcat ──
  console.log('\nH. 连点 Popcat\n')
  await ev('DSHPet.director.clear(); DSHPet.stickers.reset(); DSHPet.stickers.hide(); 1')
  const r = await ev(`(() => { const e = document.querySelector('.dshp-stage').getBoundingClientRect(); return JSON.stringify({ x: e.left + e.width / 2, y: e.top + e.height * 0.7 }) })()`).then(JSON.parse)
  let popcat = null
  for (let i = 0; i < 16 && !popcat; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 }, sessionId, 5000)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 }, sessionId, 5000)
    await sleep(40)
    // 撒娇抗议有 1.5 秒的最小间隔，所以得在它出现的那一刻看，不能等最后一下
    const x = await st()
    if (/^popcat/.test(skFile(x) || '')) popcat = x
  }
  check('快速连点：被戳痒了，配 Popcat', !!popcat && (await traceHas('poke-ticklish')), popcat ? `${popcat.text} / ${skFile(popcat)}` : '没出 popcat')
  await shoot('popcat')

  // ── J. 看懂主人在干什么：命令成败 / 复合故事 / 心情 / 编排（观察者不挤占正常互动）──
  console.log('\nJ. 复合操作与编排\n')
  let CID = 0
  const cmdRun = async (name, command, extra = {}) => {
    const callId = 'd' + ++CID
    await sim({ t: 'tool-call', callId, name, args: JSON.stringify({ command }) })
    await sim({ t: 'tool-result', callId, name, ms: 800, error: null, ...extra })
    return callId
  }
  const editFile = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      const callId = 'f' + ++CID
      await sim({ t: 'tool-call', callId, name: 'edit', args: '{}' })
      await sim({ t: 'tool-result', callId, name: 'edit', ms: 50, error: null })
    }
  }
  const startTurn = async (n) => {
    await sim({ t: 'turn-start', turn: n })
  }
  const endTurn = async (n, extra = {}) => sim(Object.assign({ t: 'turn-end', turn: n, reason: { kind: 'completed' }, ms: 4000, tokens: 100 }, extra))
  const clean = () => ev('DSHPet.observe.reset(); DSHPet.dev.resetDay(); DSHPet.director.clear(); DSHPet.stickers.reset(); DSHPet.stickers.hide(); DSHPet.stickers.quietIdle(60000); DSHPet.stickers.cfg({ chatty: 1, empathy: true, devHooks: true }); 1')
  const dev = () => ev('JSON.stringify(DSHPet.dev.diary())').then(JSON.parse)
  const obs = () => ev('JSON.stringify(DSHPet.observe.state())').then(JSON.parse)
  const traceIds = () => ev('JSON.stringify(DSHPet.director.trace().filter(e => e.ok).map(e => e.id))').then(JSON.parse)

  await clean()
  await startTurn(20)
  await cmdRun('bash', 'npm test', { exit: 1 })
  s = await st()
  const mid = await traceIds()
  check('中途不说话：命令（含红了的测试）跑完，只记账，气泡 / 导演里没有任何观察者发言', !mid.some((i) => /^(dev-|story-|empathy|finish-story)/.test(i)), JSON.stringify(mid))
  let o = await obs()
  check('账里记着：测试红了一次（退出码 1），最后一次测试是 fail', o.turn.kinds.test.fail === 1 && o.turn.lastTest === 'fail' && o.turn.reds === 1, JSON.stringify(o.turn))
  const d = await dev()
  check('今日小账：测试红 1', d.testFail === 1 && d.fails === 1, JSON.stringify(d))
  await cmdRun('bash', 'npm test', { exit: 1 })
  await cmdRun('bash', 'npm test', { exit: 1 })
  await cmdRun('bash', 'npm test', { exit: 0 })
  o = await obs()
  check('红了 3 次后绿了：记「红后转绿」', o.turn.greenAfterRed === true && o.turn.reds === 3 && o.turn.lastTest === 'ok', JSON.stringify(o.turn))
  await cmdRun('bash', 'git commit -m x', { exit: 0 })
  await cmdRun('bash', 'git push', { exit: 1 })
  o = await obs()
  check('commit 成功记 ok、push 被拒（退出码 1）记 fail；push 失败不庆祝', o.turn.kinds.commit.ok === 1 && o.turn.kinds.push.fail === 1 && !o.turn.kinds.push.ok, JSON.stringify(o.turn.kinds))
  await cmdRun('bash', 'npm run dev', { exit: null, bg: true })
  check('放到后台的命令（还没跑完）不记', !((await obs()).turn.kinds.dev))
  await cmdRun('bash', 'git commit -m y', { exit: null })
  check('没有退出码（unknown）的命令不当成功也不当失败：commit 仍只有 1 个 ok', (await obs()).turn.kinds.commit.ok === 1 && (await obs()).turn.kinds.commit.fail === 0)
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await endTurn(20)
  const ids1 = await traceIds()
  check('一轮结束：复合故事「调试战」顶替默认收工那句（红了好几次终于绿了）', ids1.includes('finish-story-debugWin') && !ids1.includes('finish'), JSON.stringify(ids1))
  s = await st()
  check('收工那句带故事台词和图', s.text.length > 0 && /红|绿|调试|收工|绕/.test(s.text), s.text)
  await shoot('story-debugwin')

  await clean()
  await startTurn(21)
  await editFile(3)
  await cmdRun('bash', 'pytest -q', { exit: 0 })
  await cmdRun('bash', 'git commit -m "x"', { exit: 0 })
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await endTurn(21)
  check('改 → 测（绿）→ 提交：一条龙，顶替收工', (await traceIds()).includes('finish-story-ship'))
  await clean()
  await startTurn(22)
  await cmdRun('bash', 'git commit -m "x"', { exit: 0 })
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await endTurn(22)
  check('只提交成功（没改文件 / 没测试）：「提交成功」收工', (await traceIds()).includes('finish-story-commit'))
  await clean()
  await startTurn(23)
  await cmdRun('bash', 'git commit -m "x"', { exit: null })
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await endTurn(23)
  check('老宿主没有退出码：不知道成没成就不说（走默认收工）', !(await traceIds()).some((i) => /finish-story/.test(i)))

  // —— 编排：note 排队、过闸、不挤占 ——
  // ── J2. vibe coding 的经典流程与经典翻车（只用 hook 得到的信号）──
  console.log('\nJ2. vibe coding 经典流程 / 经典翻车\n')
  const noteSpoken = async (id) => {
    await ev('DSHPet.stickers.cfg({ chatty: 2 }); DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
    await ev('DSHPet.observe.tick(); 1')
    return (await traceIds()).includes(id)
  }
  const editPath = async (p) => {
    const callId = 'p' + ++CID
    await sim({ t: 'tool-call', callId, name: 'edit', args: JSON.stringify({ file_path: p }) })
    await sim({ t: 'tool-result', callId, name: 'edit', ms: 50, error: null })
  }
  const finishQuiet = async (n) => {
    await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
    await endTurn(n) // 不在这里清导演日志：flavor 类的检查要看收工那一句
  }

  // 改一个 bug 出三个：上一轮绿，这一轮改完变红
  await clean()
  await startTurn(50)
  await cmdRun('bash', 'pytest -q', { exit: 0 })
  await finishQuiet(50)
  await startTurn(51)
  await editFile(2)
  await cmdRun('bash', 'pytest -q', { exit: 1 })
  await finishQuiet(51)
  check('翻车「改一个 bug 出三个」：上一轮绿、这一轮改完变红 → 轻轻提醒「上一处改动嫌疑最大」', await noteSpoken('story-regression'))

  // 原地打转：同一条命令连败 3 次（端口 / 行号不同也算同一条）+ 同一个文件改 5 遍
  await clean()
  await startTurn(52)
  for (let i = 0; i < 3; i++) await cmdRun('bash', `python app.py --port 80${i}0`, { exit: 1 })
  for (let i = 0; i < 5; i++) await editPath('C:\\proj\\src\\App.js')
  const t52 = await obs()
  check('同一条命令（只有端口数字不同）失败 3 次 = 原地打转；同一个文件改 5 遍 = thrash；只记哈希', t52.turn.cmdLoop === true && t52.turn.thrash === true && !JSON.stringify(t52).includes('App.js') && !JSON.stringify(t52).includes('app.py'), JSON.stringify(t52.turn).slice(0, 120))
  check('原地打转也让挫败度涨起来（loop）', t52.score > 0 && t52.cause === 'loop', JSON.stringify(t52))
  await finishQuiet(52)
  check('收工后排队一条「原地打转」的轻话（先试 cmdLoop，价值最高）', await noteSpoken('story-cmdLoop'))

  // 慌了就回滚：git reset --hard 成功 → 「回滚不丢人」顶替收工
  await clean()
  await startTurn(53)
  await cmdRun('bash', 'git reset --hard HEAD~1', { exit: 0 })
  await finishQuiet(53)
  check('翻车「慌了就回滚」：git reset --hard 成功，收工换成「回滚不丢人」', (await traceIds()).includes('finish-story-rollback'), JSON.stringify(await ev('JSON.stringify(DSHPet.director.trace().slice(-5))')) + JSON.stringify((await obs()).turn))

  // 先计划再动手：plan 模式 + 清单（≥3 项）全划掉
  await clean()
  await sim({ t: 'sev', k: 'plan', active: true })
  await startTurn(54)
  await sim({ t: 'sev', k: 'todo', total: 4, done: 4, doing: 0 })
  await finishQuiet(54)
  check('流程「先计划再动手」：用过 plan 模式 + 清单全划掉，收工夸一句', (await traceIds()).includes('finish-story-planDone'), JSON.stringify(await ev('JSON.stringify(DSHPet.director.trace().slice(-5))')))
  await clean()
  await startTurn(55)
  await sim({ t: 'sev', k: 'todo', total: 4, done: 4, doing: 0 })
  await finishQuiet(55)
  check('没用过 plan 模式的清单全划掉，还是原来的「清单完成」收工（不乱夸）', !(await traceIds()).includes('finish-story-planDone'))

  // 过早宣布完成：改了不少文件没测试，主人抱怨「还是不行」
  await clean()
  await startTurn(56)
  await editFile(4)
  await finishQuiet(56)
  await sim({ t: 'user', text: '还是不行啊' })
  await startTurn(561) // 主人这句话会触发新的一轮；等它收工回到空闲（任务边界），话才可能出口
  await finishQuiet(561)
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  check('翻车「过早宣布完成」：上一轮改完没验证、主人抱怨「还是不行」→ 最对症的一句：先让它跑一遍测试', await noteSpoken('story-blindComplaint'))

  // 提交当存档点：绿了、改了 ≥3 个文件、今天还没提交
  await clean()
  await startTurn(57)
  await editFile(3)
  await cmdRun('bash', 'pytest -q', { exit: 0 })
  await finishQuiet(57)
  check('流程「提交当存档点」：绿了、改了 3 个文件、今天还没提交过 → 建议提交存个档', await noteSpoken('story-checkpoint'))

  // 幻觉依赖：装不上
  await clean()
  await startTurn(58)
  await cmdRun('bash', 'npm install totally-fake-pkg-xyz', { exit: 1 })
  await finishQuiet(58)
  check('翻车「幻觉依赖」：装不上 → 提醒「包名会不会是编出来的」', await noteSpoken('story-installFail'))

  // 上下文腐烂：压缩过 2 次
  await clean()
  await sim({ t: 'sev', k: 'compaction', phase: 'start' })
  await sim({ t: 'sev', k: 'compaction', phase: 'end' })
  await sim({ t: 'sev', k: 'compaction', phase: 'start' })
  await sim({ t: 'sev', k: 'compaction', phase: 'end' })
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await startTurn(59)
  await finishQuiet(59)
  check('翻车「上下文腐烂」：会话压缩过 2 次 → 建议换新会话（先写三五句现状）', await noteSpoken('story-longSession'))
  await clean()
  await sim({ t: 'session', kind: 'created', sessionId: 's-new', blank: true, origin: 'user' })
  check('换了新会话：会话级的账清零', (await obs()).sess.compactions === 0 && (await obs()).sess.turns === 0)

  // 密钥进仓库：中途的安全提醒（和危险命令一样，是少数可以在中途出声的）
  await clean()
  await startTurn(60)
  await sim({ t: 'tool-call', callId: 'sec1', name: 'bash', args: JSON.stringify({ command: 'git add .env' }) })
  s = await st()
  check('安全：git add .env → 当场提醒「密钥别进仓库」（只提醒不拦截）', (await traceIds()).includes('secret-add') && /密钥/.test(s.text), s.text)
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await sim({ t: 'tool-call', callId: 'sec2', name: 'bash', args: JSON.stringify({ command: 'git add .env.example src/a.js' }) })
  check('.env.example 不算密钥，不提醒', !(await traceIds()).includes('secret-add'))
  await sim({ t: 'turn-end', turn: 60, reason: { kind: 'completed' }, ms: 100, tokens: 1 })

  // 批准疲劳：10 分钟被问 ≥6 次
  await clean()
  for (let i = 0; i < 6; i++) await sim({ t: 'approval', state: 'asked', tool: 'bash' })
  check('批准疲劳：10 分钟里被问了 6 次要不要批准 → 记一笔（挫败信号，不当场说）', (await obs()).sess.approvals === 6 && (await obs()).score > 0)
  await sim({ t: 'approval', state: 'decided', outcome: 'allowed-once' })

  console.log('\nK0. 编排：不挤占正常互动\n')
  await clean()
  await ev('DSHPet.stickers.cfg({ chatty: 2 }); 1')
  await startTurn(30)
  await editFile(9)
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await endTurn(30)
  let q = await obs()
  check('改了 9 个文件没跑测试：「没测试」note 排进了编排器的槽（不是当场说）', q.orch.pending === true && !(await traceIds()).includes('story-noTest'), JSON.stringify(q.orch))
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  // 主人正在打字：让路
  await ev(`(() => { let ta = document.getElementById('t-typing'); if (!ta) { ta = document.createElement('textarea'); ta.id = 't-typing'; document.body.append(ta) } ta.value = 'abc'; ta.dispatchEvent(new Event('input', { bubbles: true })); return 1 })()`)
  await ev('DSHPet.observe.tick(); 1')
  check('主人正在打字：不说，候选留着', !(await traceIds()).includes('story-noTest') && (await obs()).orch.pending === true)
  await sleep(5300)
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); DSHPet.observe.tick(); 1') // 待机大脑可能刚好占着气泡，先让场面清静
  check('打字停了 5 秒、清静了：才说', (await traceIds()).includes('story-noTest'))
  s = await st()
  await shoot('note-notest')
  // 正常互动顶得掉它
  await sim({ t: 'user', text: '谢谢' })
  s = await st()
  check('她正在说观察者的话时，主人一句「谢谢」（关键词反应）当场顶掉它——正常互动永远赢', /夸|脸红|高兴|再说|白饭/.test(s.text) || (await traceIds()).includes('kw-praise'), s.text)
  // 配额：刚说过，立刻又来一条 → 要等
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await ev("DSHPet.observe.offer({ id: 'x2', kind: 'note', tier: 'extra', value: 5, say: 'storyTested', mood: 'happy' }); 1")
  await ev('DSHPet.observe.tick(); 1')
  check('配额：刚说过一条，90 秒内第二条不说（等着，不丢）', !(await traceIds()).includes('x2') && (await obs()).orch.pending === true)
  // 安静档
  await ev('DSHPet.observe.reset(); DSHPet.director.clear(); DSHPet.stickers.hide(); DSHPet.stickers.cfg({ chatty: 0 }); 1')
  await ev("DSHPet.observe.offer({ id: 'x3', kind: 'note', tier: 'extra', value: 5, say: 'storyTested', mood: 'happy' }); DSHPet.observe.tick(); 1")
  check('安静档：一概不说', !(await traceIds()).includes('x3'))
  // 中途（agent 干活）不说
  await ev('DSHPet.stickers.cfg({ chatty: 1 }); 1')
  await startTurn(31)
  await ev('DSHPet.observe.tick(); 1')
  check('agent 还在干活：不说（只在任务边界说）', !(await traceIds()).includes('x3'))
  await endTurn(31)

  console.log('\nK1. 心情：信号叠加才安慰\n')
  await clean()
  await ev(`DSHPet.observe.signal('regen'); 1`)
  await ev(`DSHPet.observe.text('还是不行'); 1`)
  o = await obs()
  check('点一次重新生成 + 一句「还是不行」：分数在涨，但还远没到线，不安慰', o.score > 0 && o.level === 0 && !(await traceIds()).some((i) => /^empathy/.test(i)), JSON.stringify(o))
  await ev(`DSHPet.observe.signal('regen'); DSHPet.observe.signal('regen'); DSHPet.observe.signal('regen'); DSHPet.observe.signal('stop'); 1`)
  o = await obs()
  check('连着重新生成 + 停止 + 「还是不行」：到线了（loop：打转）', o.level >= 1 && o.cause === 'loop', JSON.stringify(o))
  check('但到线不是立刻开口：中途 / 刚说完话都只排队', !(await traceIds()).some((i) => /^empathy/.test(i)) && o.orch.pending === true)
  await startTurn(40)
  await ev('DSHPet.observe.tick(); 1')
  check('agent 还在干活：不安慰', !(await traceIds()).some((i) => /^empathy/.test(i)))
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await endTurn(40, { reason: { kind: 'error', error: { message: 'x' } } })
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await ev('DSHPet.observe.tick(); 1')
  s = await st()
  const emp = (await traceIds()).find((i) => /^empathy/.test(i))
  check('一轮结束、清静了：轻轻安慰一句，口吻按原因（打转 / 失败）', !!emp && s.text.length > 0 && !/应该|必须/.test(s.text), `${emp} / ${s.text}`)
  await shoot('empathy')
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  o = await obs()
  check('安慰过之后分数降下来、进冷却：同一场不会再来（导演日志已清，所以再来一次应是 0 条）', o.score < 60 && (await ev(`(() => { DSHPet.observe.signal('regen'); DSHPet.observe.signal('regen'); DSHPet.observe.signal('regen'); DSHPet.observe.signal('stop'); DSHPet.observe.tick(); return JSON.stringify(DSHPet.director.trace().filter(e => e.ok && /^empathy/.test(e.id)).length) })()`)) === '0')
  await clean()
  await ev(`DSHPet.observe.text('我不想活了'); 1`)
  s = await st()
  check('高风险的话：当场温柔回应，不玩梗、不配图，不进挫败度', (await traceIds()).includes('care') && s.visible && !s.sticker && /难受|陪/.test(s.text) && (await obs()).score === 0, s.text)
  await sleep(6000)
  s = await st()
  check('随后提醒找身边信得过的人', /身边|聊聊/.test(s.text), s.text)
  await clean()
  await ev(`DSHPet.stickers.cfg({ empathy: false }); DSHPet.observe.text('气死我了崩溃了'); 1`)
  check('关掉「情绪陪伴」：什么信号都不记', (await obs()).score === 0)
  await ev('DSHPet.stickers.cfg({ empathy: true }); 1')
  // 道谢 / 顺利收工让她放松，收工换成「终于顺了」
  await clean()
  await startTurn(40)
  await endTurn(40) // 先收一轮正常的：把前面失败留下的「失败后终于过了」状态消耗掉，免得它抢在「终于顺了」前面
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); DSHPet.observe.reset(); 1')
  await ev(`DSHPet.observe.text('怎么又报错！！！'); DSHPet.observe.signal('regen'); DSHPet.observe.signal('regen'); DSHPet.observe.signal('turnError'); 1`)
  check('绷着（有点烦）的状态', (await obs()).level >= 1)
  await startTurn(41)
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await endTurn(41)
  check('绷了一阵、这一轮终于顺了：收工换成「终于顺了」那一句', (await traceIds()).includes('finish-relief'), JSON.stringify(await traceIds()) + ' ' + JSON.stringify(await obs()))

  console.log('\nK. 每日一签\n')
  await ev('DSHPet.dev.resetDay(); DSHPet.director.clear(); DSHPet.stickers.reset(); DSHPet.stickers.hide(); 1')
  await ev('DSHPet.dev.fortune(); 1')
  s = await st()
  check('抽签：签文三行（今日运势 / 宜忌 / 幸运图）+ 签尾，带一张幸运图', s.visible && /今日运势：/.test(s.text) && /宜：.+忌：/.test(s.text) && /幸运图：/.test(s.text) && !!s.sticker, `${s.text.replace(/\n/g, ' | ')} / ${skFile(s)}`)
  check('幸运图和签文里写的名字对得上', await ev(`(() => { const t = document.querySelector('.dshp-body').textContent; const m = /幸运图：(.+)/.exec(t.split('\\n')[2] || ''); if (!m) return false; const man = window.__DSH_PET_STICKERS__; const id = decodeURIComponent(document.querySelector('.dshp-sticker').getAttribute('src').split('/').pop().split('?')[0]).replace('.gif',''); return String(man[id].name).replace(/\\s*\\d+$/, '') === m[1].split('\\n')[0].trim() })()`))
  await shoot('fortune')
  const first = s.text.split('\n').slice(0, 3).join('|')
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await ev('DSHPet.dev.fortune(); 1')
  s = await st()
  check('同一天再抽：还是同一支签，并提醒「签不能反悔」', s.text.split('\n').slice(0, 3).join('|') === first && /签/.test(s.text.split('\n')[3] || ''), s.text.replace(/\n/g, ' | '))
  await ev('DSHPet.dev.resetDay(); DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await sim({ t: 'user', text: '帮我抽个签' })
  s = await st()
  check('主人说「抽个签」：当场抽', (await traceHas('fortune')) && /今日运势：/.test(s.text), s.text.replace(/\n/g, ' | '))
  await ev('DSHPet.dev.resetDay(); DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await sim({ t: 'user', text: '这是一段很长的日志 ' + 'x'.repeat(60) + ' 运势' })
  check('长文本里碰巧有「运势」两个字不触发', !(await traceHas('fortune')))
  // 邀请：每天第一次见面后问一句，点按钮才抽
  await ev(`fetch('/__claims_reset', { method: 'POST', body: '{}' }).then(r => r.json())`)
  await ev('DSHPet.dev.resetDay(); DSHPet.director.clear(); DSHPet.stickers.hide(); 1')
  await sim({ t: 'turn-end', turn: 10, reason: { kind: 'completed' }, ms: 100, tokens: 1 }) // 让 agent 回到空闲
  await ev('DSHPet.director.clear(); DSHPet.stickers.hide(); 1') // 收工那句收掉，别让它占着气泡
  await ev('DSHPet.dev.offer(); 1')
  await sleep(700)
  let asking = await ev(`document.querySelectorAll('.dshp-ask button').length`)
  check('每天第一次见面后：问「要抽签吗」，两个按钮（抽一签 / 不用了）', asking === 2 && (await traceHas('fortune-offer')))
  await shoot('fortune-offer')
  await ev(`document.querySelector('.dshp-ask button').click(); 1`)
  s = await st()
  check('点「抽一签」才抽', /今日运势：/.test(s.text))
  await ev('DSHPet.dev.offer(); 1')
  await sleep(500)
  check('抽过了就不再问', (await ev(`document.querySelectorAll('.dshp-ask button').length`)) === 0)
  await ev(`fetch('/__claims_reset', { method: 'POST', body: '{}' }).then(r => r.json()); DSHPet.dev.resetDay(); DSHPet.director.clear(); DSHPet.stickers.hide(); 1`)
  await ev('DSHPet.dev.offer(); 1')
  await sleep(700)
  await ev(`document.querySelectorAll('.dshp-ask button')[1].click(); 1`)
  s = await st()
  check('点「不用了」：不追问，一句话带过', (await traceHas('fortune-no')) && !/今日运势/.test(s.text), s.text)
  await ev(`DSHPet.stickers.cfg({ fortune: false }); fetch('/__claims_reset', { method: 'POST', body: '{}' }); DSHPet.dev.resetDay(); DSHPet.director.clear(); DSHPet.stickers.hide(); 1`)
  await ev('DSHPet.dev.offer(); 1')
  await sleep(500)
  check('关掉「每日一签」：不问', (await ev(`document.querySelectorAll('.dshp-ask button').length`)) === 0)
  await ev('DSHPet.stickers.cfg({ fortune: true }); 1')

  // ── I. 图鉴同步：老存档（92 张集齐）扩容到 157 张 ──
  console.log('\nI. 表情包图鉴\n')
  // 图鉴测试期间关掉表情包：待机大脑 / 迟到的表情包上报会让「已收录」多出一张，测试就不稳了
  await ev('DSHPet.stickers.hide(); DSHPet.director.clear(); DSHPet.stickers.cfg({ stickers: false }); 1')
  await sleep(600)
  const man = await ev(`fetch('/dsh-pet/stickers/manifest.json').then(r => r.json()).then(j => JSON.stringify(Object.keys(j.stickers)))`).then(JSON.parse)
  const old92 = man.slice(0, 92)
  const seed = { stickers: Object.fromEntries(old92.map((i) => [i, Date.now() - 86400000])), albumGot: ['0.1', '0.3', '0.6', '1'], xp: 40 }
  await ev(`fetch('/__bond_seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(seed))} }).then(r => r.json()); DSHPet.bond.refresh()`)
  await sleep(600)
  const snap = await ev('JSON.stringify(DSHPet.bond.snap())').then(JSON.parse)
  const big = snap.album.milestones.find((m) => m.title === '梗大全')
  check('老存档（92 张集齐）扩到 157 张：总数 157、已收录 92、「梗大全」不再亮', snap.album.total === 157 && snap.album.got === 92 && big && big.need === 157 && !big.done, JSON.stringify(snap.album.milestones.map((m) => [m.title, m.need, m.done])))
  const ui = await ev(`(async () => {
    const { renderAlbum } = await import('/dsh-pet/app/ui/menu/bond/album.js')
    const snap = DSHPet.bond.snap()
    const el = renderAlbum(snap)
    el.id = 't-album'
    document.body.append(el)
    el.open = true
    await new Promise((r) => setTimeout(r, 400))
    const tiles = el.querySelectorAll('button.dshp-album-tile').length
    const locked = el.querySelectorAll('.dshp-album-tile.dshp-locked').length
    const cap0 = el.querySelector('.dshp-album-cap').textContent
    el.querySelector('button.dshp-album-tile').click()
    const cap1 = el.querySelector('.dshp-album-cap').textContent
    const head = el.querySelector('summary').textContent
    el.remove()
    return JSON.stringify({ tiles, locked, cap0, cap1, head })
  })()`).then(JSON.parse)
  check('图鉴页：92 张已收录的小图 + 8 个「？」预告 + 一块「+57」；标题 92/157', ui.tiles === 92 && ui.locked === 9 && ui.head.includes('92/157'), JSON.stringify(ui))
  check('图鉴页：说明里写着还有 65 张没见过，点一张能看到它的梗', /还有 65 张没见过/.test(ui.cap0) && ui.cap1.length > 4 && ui.cap1 !== ui.cap0, ui.cap1)
  const evs = await ev(`(async () => {
    const man = ${JSON.stringify(man)}
    const out = []
    for (const id of man.slice(92)) {
      const r = await fetch('/dsh-pet/bond/sticker', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }).then(r => r.json())
      out.push(...(r.events || []).filter(e => e.type === 'album'))
    }
    return JSON.stringify(out)
  })()`).then(JSON.parse)
  check('补齐新增的 65 张：重新集齐「梗大全」，只庆祝不重复发奖', evs.some((e) => e.title === '梗大全' && e.full && e.again && e.xp === 0), JSON.stringify(evs.map((e) => [e.title, e.xp, e.again])))
  await ev('DSHPet.bond.refresh()')
  await sleep(500)
  const snap2 = await ev('JSON.stringify(DSHPet.bond.snap())').then(JSON.parse)
  check('集齐后图鉴 157/157、四个里程碑全部亮', snap2.album.got === 157 && snap2.album.milestones.every((m) => m.done), `${snap2.album.got}/${snap2.album.total}`)
  await ev(`fetch('/__bond_seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.json()); DSHPet.bond.refresh(); 1`)
  await ev('DSHPet.stickers.cfg({ stickers: true }); 1')

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
