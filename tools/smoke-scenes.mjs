#!/usr/bin/env node
/**
 * smoke-scenes.mjs —— v0.6.7 新场景（157 张全量表情包 / 单发图 / 静置打游戏 / 压缩全流程 / 反差萌 / 妈妈梗 / 工作流…）在真浏览器里的自检。
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
  const fresh = () => ev('DSHPet.stickers.reset(); DSHPet.director.clear(); 1')

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
  await perf({ id: 't-solo', pri: 1, tier: 'core', habit: false, solo: 'idleGame', ms: 2600 })
  let s = await st()
  check('perform({ solo }) 出一个只有图的小气泡，图是「打游戏」', s.visible && s.solo && skFile(s) === 'game' && s.text === '', JSON.stringify(s))
  await shoot('solo-game')
  await sleep(4200)
  s = await st()
  check('单发图停留时间由图自己决定（≈3 秒内收起）', !s.visible)
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
    await ev('DSHPet.director.clear(); DSHPet.stickers.reset(); DSHPet.stickers.hide(); 1')
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
    await ev('DSHPet.director.clear(); DSHPet.stickers.reset(); DSHPet.stickers.hide(); 1')
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
  for (let i = 0; i < 8 && !popcat; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 }, sessionId, 5000)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 }, sessionId, 5000)
    await sleep(120)
    // 撒娇抗议有 1.5 秒的最小间隔，所以得在它出现的那一刻看，不能等最后一下
    const x = await st()
    if (/^popcat/.test(skFile(x) || '')) popcat = x
  }
  check('快速连点：被戳痒了，配 Popcat', !!popcat && (await traceHas('poke-ticklish')), popcat ? `${popcat.text} / ${skFile(popcat)}` : '没出 popcat')
  await shoot('popcat')

  // ── I. 图鉴同步：老存档（92 张集齐）扩容到 157 张 ──
  console.log('\nI. 表情包图鉴\n')
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
