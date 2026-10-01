#!/usr/bin/env node
/**
 * preview-server.mjs —— 脱离 DSH 单独预览桌宠。
 *
 * 起一个和插件路由完全一致的迷你服务器（同样挂 /dsh-pet/*），加一个假的
 * agent 事件发生器，这样调模型、调表情、调动作时不用反复重启 DSH。
 *
 *   node tools/preview-server.mjs               # 只预览，右下角有「演练」按钮
 *   node tools/preview-server.mjs --demo        # 打开就自动跑一遍完整 agent 流程
 *   node tools/preview-server.mjs --port 5199
 *
 * 浏览器打开 http://127.0.0.1:5199
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// 预览服务器用**真正的**羁绊引擎（内存存储，不碰真实的 ~/.dsh），这样前端的「好感」页 / 晋级故事 / 投喂
// 在预览与浏览器自检里走的是和真机同一套规则，而不是一份会和真实规则漂移的假数据。
const { createBond } = await import(pathToFileURL(path.join(HERE, '..', 'lib', 'bond', 'index.js')).href)
const bondMem = { raw: undefined }
let bond = null
const makeBond = () => (bond = createBond({ read: () => bondMem.raw, write: (b) => (bondMem.raw = JSON.parse(JSON.stringify(b))) }))
makeBond()
const previewClaims = new Map()
const ROOT = path.resolve(HERE, '..')
const ASSETS = path.join(ROOT, 'assets')

const argv = process.argv.slice(2)
const PORT = Number(argv[argv.indexOf('--port') + 1]) || 5199
const AUTO_DEMO = argv.includes('--demo')

const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.html': 'text/html; charset=utf-8',
  '.moc3': 'application/octet-stream',
}

const clients = new Set()
/** 预览用的「上一轮消耗」：turn-end 事件里带的 tokens 直接折算成金额，模拟宿主记账 */
let previewLastTurn = { ok: true, seq: 0, turn: null, amount: null, tokens: null, ts: null }

function broadcast(payload) {
  // 模拟宿主记账：一轮结束时把本轮 tokens 折算成金额，供 HUD 的「本轮消耗」读
  if (payload && payload.t === 'turn-end') {
    const tokens = Number(payload.tokens) || 0
    // 粗略按 DeepSeek 谷价（1 元/百万输入 + 4 元/百万输出）估个数，仅预览用
    const amount = Math.round((tokens / 1e6) * 2.6 * 10000) / 10000
    previewLastTurn = {
      ok: true,
      seq: previewLastTurn.seq + 1,
      turn: payload.turn || null,
      amount,
      tokens,
      ts: Date.now(),
    }
  }
  const frame = `data: ${JSON.stringify(payload)}\n\n`
  for (const res of clients) {
    try {
      res.write(frame)
    } catch (e) {}
  }
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

function serveFile(res, abs) {
  try {
    const buf = fs.readFileSync(abs)
    send(res, 200, MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', buf)
  } catch (e) {
    send(res, 404, 'text/plain; charset=utf-8', 'not found')
  }
}

const PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>DS 鲸鱼娘 · 实时预览</title>
<style>
 html,body{margin:0;height:100%;overflow:hidden;background:
   linear-gradient(135deg,#eef1ff 0%,#f7f2ff 40%,#eefaf6 100%);
   font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",system-ui,sans-serif}
 @media (prefers-color-scheme:dark){html,body{background:linear-gradient(135deg,#141726,#1d1830 40%,#101d1c 100%)}}
 .mock{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
   color:#8a90a8;font-size:13px;pointer-events:none;text-align:center;line-height:2}
 /* 控制条永远在最上层、永远可点——即使桌宠被隐藏了也还能用它救回来 */
 .bar{position:fixed;left:14px;top:14px;z-index:2147483600;display:flex;gap:8px;flex-wrap:wrap;
   align-items:center;padding:8px 10px;border-radius:12px;
   background:rgba(255,255,255,.86);backdrop-filter:blur(12px);
   box-shadow:0 6px 22px rgba(10,14,30,.16);border:1px solid rgba(20,24,40,.10)}
 @media (prefers-color-scheme:dark){.bar{background:rgba(28,30,40,.86);border-color:rgba(255,255,255,.14);color:#eef1f8}}
 .bar button{font:inherit;font-size:12px;padding:6px 12px;border-radius:9px;cursor:pointer;
   border:1px solid rgba(0,0,0,.12);background:rgba(255,255,255,.9);color:inherit}
 .bar button:hover{background:#fff}
 @media (prefers-color-scheme:dark){.bar button{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.16)}
   .bar button:hover{background:rgba(255,255,255,.16)}}
 .bar .reset{background:#7c5cff;color:#fff;border-color:transparent;font-weight:600}
 .bar .reset:hover{background:#6b4ae8}
 .bar .lbl{font-size:11px;opacity:.55;margin-left:6px}
</style></head><body>
<div class="mock">桌宠实时预览<br>（改 pet.js 刷新即生效；点「重置桌宠」可恢复到初始状态）</div>
<div class="bar">
  <button class="reset" onclick="dshpReset()">↺ 重置桌宠</button>
  <button onclick="dshpShow()">显示桌宠</button>
  <button onclick="dshpCalm()">回到平常状态</button>
  <button onclick="dshpDemo('ok')">▶ 完整一轮</button>
  <button onclick="dshpDemo('fail')">⚠ 出错一轮</button>
  <button onclick="dshpDemo('ask')">❓ 向你提问</button>
  <span class="lbl" id="tip"></span>
</div>
<script src="/dsh-pet/pet.js"></script>
<script>
// 桌宠的持久化状态全在这里；清掉它就等于「出厂设置」
function dshpKeys(){
  var out = [];
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (k && k.indexOf('dsh-live2d-pet') === 0) out.push(k);
  }
  return out;
}
function dshpReset(){
  dshpKeys().forEach(function(k){ localStorage.removeItem(k) });
  document.body.classList.remove('dshp-pet-hidden');
  document.getElementById('tip').textContent = '已重置，正在刷新…';
  location.reload();
}
// 万一隐藏了又没看到把手，这个按钮直接把它叫回来（并清掉隐藏标记）
function dshpShow(){
  var r = document.getElementById('dsh-live2d-pet');
  if (r) r.classList.remove('dshp-hidden');
  document.body.classList.remove('dshp-pet-hidden');
  try {
    var k = 'dsh-live2d-pet:layout';
    var v = JSON.parse(localStorage.getItem(k) || '{}');
    v.hidden = false; v.x = null; v.y = null;
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {}
  document.getElementById('tip').textContent = r ? '已叫回来' : '桌宠还没加载出来…';
  if (!r) setTimeout(function(){ location.reload() }, 600);
}
// 调桌宠自己的一键重置（表情/道具/姿势/位置全回正常）
function dshpCalm(){
  if (window.DSHPet && window.DSHPet.resetEverything) {
    window.DSHPet.resetEverything();
    document.getElementById('tip').textContent = '已回到平常状态';
  } else {
    document.getElementById('tip').textContent = '桌宠还没加载出来…';
  }
}
function dshpDemo(mode){ fetch('/__demo',{method:'POST',body:mode}).then(function(){ document.getElementById('tip').textContent='演练中…' }) }
window.addEventListener('load', function(){
  setTimeout(function(){
    var r = document.getElementById('dsh-live2d-pet');
    document.getElementById('tip').textContent = r ? '桌宠已加载' : '桌宠没加载出来（看控制台）';
  }, 6000);
});
</script>
</body></html>`

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0]

  if (url === '/' || url === '/index.html') return send(res, 200, MIME['.html'], PAGE)

  if (url === '/dsh-pet/pet.js') {
    const body = fs.readFileSync(path.join(ASSETS, 'pet.js'), 'utf8')
    return send(
      res,
      200,
      MIME['.js'],
      `;window.__DSH_PET_BOOT__=${JSON.stringify({ config: { height: 180 } })};\n${body}`,
    )
  }

  if (url.startsWith('/dsh-pet/vendor/')) {
    return serveFile(res, path.join(ASSETS, 'vendor', url.slice('/dsh-pet/vendor/'.length)))
  }
  // 前端 ES 模块（assets/app/**），和真机宿主的 /dsh-pet/app 路由一致
  if (url.startsWith('/dsh-pet/app/')) {
    return serveFile(res, path.join(ASSETS, 'app', decodeURIComponent(url.slice('/dsh-pet/app/'.length))))
  }

  // ———— 羁绊系统（真引擎 + 内存存储）————
  if (url === '/dsh-pet/bond' && req.method === 'GET') return send(res, 200, MIME['.json'], JSON.stringify(bond.snapshot()))
  if (url === '/dsh-pet/claim' || url.startsWith('/dsh-pet/bond/') || url === '/__bond_seed') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let b = {}
      try {
        b = JSON.parse(body || '{}')
      } catch (e) {}
      const out = (o) => send(res, 200, MIME['.json'], JSON.stringify(o))
      if (url === '/__bond_seed') {
        // 测试用：直接塞一份羁绊原始数据（比如「羁绊值够了、待晋级」），并重建引擎
        bondMem.raw = b && Object.keys(b).length ? b : undefined
        makeBond()
        return out(bond.snapshot())
      }
      if (url === '/dsh-pet/claim') {
        const key = String(b.key || '')
        const day = new Date().toISOString().slice(0, 10)
        const cur = previewClaims.get(key)
        const ok = b.scope === 'forever' ? cur !== 'forever' : cur !== day
        if (ok) previewClaims.set(key, b.scope === 'forever' ? 'forever' : day)
        return out({ ok: true, claimed: ok })
      }
      const act = url.slice('/dsh-pet/bond/'.length)
      if (act === 'act') return out(bond.act(String(b.kind || '')))
      if (act === 'feed') return out(bond.feed(String(b.item || '')))
      if (act === 'story') return out(bond.story(Number(b.level)))
      if (act === 'memory') return out(bond.memory(String(b.id || '')))
      if (act === 'away') return out(bond.away())
      if (act === 'toggle') return out(bond.toggle(b.enabled !== false))
      return send(res, 404, MIME['.json'], '{"ok":false}')
    })
    return
  }
  if (url.startsWith('/dsh-pet/model/')) {
    // 动作文件名是中文的，浏览器会发百分号编码，这里必须解回来，
    // 否则 /dsh-pet/model/motions/%E8%87%AA%E6%8B%8D.motion3.json 会 404。
    let rel
    try {
      rel = decodeURIComponent(url.slice('/dsh-pet/model/'.length))
    } catch (e) {
      rel = url.slice('/dsh-pet/model/'.length)
    }
    return serveFile(res, path.join(ASSETS, 'model', rel))
  }

  /**
   * 宿主自带的钱包接口（预览版）：真机上是 lib/index.js 算的余额+峰谷+本轮消耗。
   * 这里给一份格式一致的假数据，预览与测试就走「自有接口」这条路。
   */
  if (url === '/dsh-pet/hud') {
    const nowSec = Math.floor(Date.now() / 1000)
    const bjHour = new Date((nowSec + 8 * 3600) * 1000).getUTCHours()
    const dow = new Date((nowSec + 8 * 3600) * 1000).getUTCDay()
    const peak = dow !== 0 && dow !== 6 && ((bjHour >= 9 && bjHour < 12) || (bjHour >= 14 && bjHour < 18))
    const nextChange = (Math.floor(nowSec / 3600) + (peak ? 1 : 2)) * 3600
    return send(res, 200, MIME['.json'], JSON.stringify({
      ok: true,
      version: '0.2.0(预览)',
      source: 'dsh-live2d-pet',
      isPeak: peak,
      peakNextChangeAt: nextChange,
      balance: { ok: true, totalBalance: 42.5, currency: 'CNY', updatedAt: new Date().toISOString() },
      today: { date: '2026-09-25', amount: 3.86, tokens: 1286000 },
      turn: previewLastTurn,
      stats: (() => {
        const b = bond.brief()
        return { days: 1, turns: previewLastTurn.seq, tokens: 0, turnsToday: previewLastTurn.seq, riceToday: 0, riceYesterday: 0, level: b.level, levelName: b.levelName, affinity: b.xp, pending: b.pending }
      })(),
      priceNote: 'Flash 空闲 0.02/1/4・高峰 ×2（元每百万 token）',
    }))
  }

  /**
   * 预览站没有 dsh-whale-widget，这里按它的真实返回格式造一份假数据，
   * 这样 HUD（余额 / 本轮消耗 / 峰谷倒计时）在预览里也能看出真实样子。
   * ?peak=0 可以强制成「谷」，方便两边配色都看一眼。
   */
  if (url === '/dsh-whale/balance.json') {
    const q = new URL(req.url || '/', 'http://localhost').searchParams
    const force = q.get('peak')
    const nowSec = Math.floor(Date.now() / 1000)
    // 峰谷切换点定在「下一个整点 + 2 小时」，看起来像真的
    const nextChange = (Math.floor(nowSec / 3600) + 3) * 3600
    const isPeak = force === null ? new Date().getHours() >= 8 && new Date().getHours() < 24 : force !== '0'
    return send(res, 200, MIME['.json'], JSON.stringify({
      ok: true,
      version: '0.3.9(预览假数据)',
      totalBalance: 42.5,
      currency: 'CNY',
      isPeak,
      peakNextChangeAt: nextChange,
      todayUsage: 3.86,
      todayUsageCurrency: 'CNY',
      updatedAt: new Date().toISOString(),
    }))
  }

  if (url === '/dsh-whale/last-turn.json') {
    return send(res, 200, MIME['.json'], JSON.stringify(previewLastTurn))
  }

  if (url === '/dsh-pet/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    })
    res.write(`data: ${JSON.stringify({ t: 'hello', sessionId: 'preview', status: 'idle' })}\n\n`)
    clients.add(res)
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch (e) {}
    }, 15000)
    const done = () => {
      clearInterval(ping)
      clients.delete(res)
    }
    req.on('close', done)
    res.on('error', done)
    return
  }

  if (url === '/dsh-pet/say' || url === '/dsh-pet/cancel' || url === '/dsh-pet/control') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      console.log(`[preview] ${url}`, body.slice(0, 200))
      if (url === '/dsh-pet/say') {
        // 假装 agent 回一句，好验证气泡
        setTimeout(() => {
          broadcast({ t: 'user', text: JSON.parse(body || '{}').text || '', sessionId: 'preview' })
        }, 60)
        setTimeout(() => {
          broadcast({ t: 'turn-start', turn: 99, sessionId: 'preview' })
        }, 260)
        setTimeout(() => {
          const reply = '收到啦～这是预览模式下的假回复，用来验证气泡的逐字显示和口型。'
          for (let i = 0; i < reply.length; i += 2) {
            setTimeout(
              () => broadcast({ t: 'delta', kind: 'text', text: reply.slice(i, i + 2), sessionId: 'preview' }),
              700 + i * 45,
            )
          }
          setTimeout(
            () => broadcast({ t: 'turn-end', turn: 99, reason: { kind: 'completed' }, ms: 3200, sessionId: 'preview' }),
            700 + reply.length * 45 + 200,
          )
        }, 900)
      }
      send(res, 200, MIME['.json'], JSON.stringify({ ok: true }))
    })
    return
  }

  if (url === '/__demo') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      runDemo(body.trim())
      send(res, 200, MIME['.json'], '{"ok":true}')
    })
    return
  }

  /**
   * 直接灌事件：测试要复现「干活中卡住」这种时序 bug，得能自己编排事件。
   * POST {"events":[{t:'turn-start',...}], "gap": 200}
   */
  if (url === '/__events') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let payload = {}
      try {
        payload = JSON.parse(body || '{}')
      } catch (e) {
        return send(res, 400, MIME['.json'], '{"ok":false,"error":"bad json"}')
      }
      const list = Array.isArray(payload.events) ? payload.events : []
      const gap = Number(payload.gap) >= 0 ? Number(payload.gap) : 150
      list.forEach((msg, i) => {
        setTimeout(() => broadcast(Object.assign({ sessionId: 'preview' }, msg)), i * gap)
      })
      send(res, 200, MIME['.json'], JSON.stringify({ ok: true, count: list.length, gap: gap }))
    })
    return
  }

  send(res, 404, 'text/plain; charset=utf-8', 'not found')
})

/** 一段脚本化的 agent 活动，覆盖所有状态分支。 */
function runDemo(mode) {
  const at = (ms, fn) => setTimeout(fn, ms)
  const S = (o) => broadcast(Object.assign({ sessionId: 'preview' }, o))
  const T = (ms) => new Promise((r) => setTimeout(r, ms))
  void T

  if (mode === 'fail') {
    // —— 出错演示：一次很真实的「改完跑测试，测试挂了，重试还是不行」——
    S({ t: 'user', text: '帮我把登录那个 bug 修一下' })
    at(400, () => S({ t: 'turn-start', turn: 1 }))
    at(900, () => S({ t: 'step-start', turn: 1, step: 1 }))
    at(2400, () => S({ t: 'tool-call', callId: 'f1', name: 'read', label: '读文件', args: '{"file_path":"src/auth/login.ts"}' }))
    at(3600, () => S({ t: 'tool-result', callId: 'f1', name: 'read', label: '读文件', ms: 1200, error: null }))
    at(4200, () => S({ t: 'step-start', turn: 1, step: 2 }))
    at(5200, () => S({ t: 'tool-call', callId: 'f2', name: 'edit', label: '改代码', args: '{"file_path":"src/auth/login.ts"}' }))
    at(6400, () => S({ t: 'tool-result', callId: 'f2', name: 'edit', label: '改代码', ms: 1200, error: null }))
    at(7000, () => S({ t: 'tool-call', callId: 'f3', name: 'bash', label: '跑命令', args: '{"command":"npm test"}' }))
    at(9000, () =>
      S({ t: 'tool-result', callId: 'f3', name: 'bash', label: '跑命令', ms: 2000, error: { name: 'CommandFailed', code: 'ENOENT' } }),
    )
    at(10400, () => S({ t: 'step-start', turn: 1, step: 3 }))
    at(11400, () => S({ t: 'tool-call', callId: 'f4', name: 'bash', label: '跑命令', args: '{"command":"npm test -- --runInBand"}' }))
    at(13200, () => S({ t: 'tool-result', callId: 'f4', name: 'bash', label: '跑命令', ms: 1800, error: null }))
    at(14000, () => S({ t: 'step-start', turn: 1, step: 4 }))
    const reply = '这个测试环境本身有问题，我改的代码没错——要不要我换个跑法再试一次？'
    for (let i = 0; i < reply.length; i += 3) {
      at(14800 + i * 45, () => S({ t: 'delta', kind: 'text', text: reply.slice(i, i + 3) }))
    }
    at(14800 + reply.length * 45 + 400, () =>
      S({ t: 'assistant', turn: 1, step: 4, text: reply, usage: { input: 31000, cache: 18000, output: 420 } }),
    )
    at(14800 + reply.length * 45 + 900, () =>
      S({ t: 'turn-end', turn: 1, reason: { kind: 'error', error: { message: 'npm test 退出码 1（环境缺少依赖）' } }, ms: 16200, tokens: 49420 }),
    )
    return
  }

  // —— 正常演示：读资料 → 查资料 → 写东西 → 完成 ——
  S({ t: 'user', text: '帮我把这份资料看完，整理成一份摘要' })
  at(500, () => S({ t: 'turn-start', turn: 1 }))
  at(1100, () => S({ t: 'step-start', turn: 1, step: 1 }))
  at(2600, () => S({ t: 'tool-call', callId: 'c1', name: 'read', label: '读文件', args: '{"file_path":"docs/report.pdf"}' }))
  at(4400, () => S({ t: 'tool-result', callId: 'c1', name: 'read', label: '读文件', ms: 1800, error: null }))
  at(5000, () => S({ t: 'step-start', turn: 1, step: 2 }))
  at(6200, () => S({ t: 'tool-call', callId: 'c2', name: 'web_search', label: '上网查', args: '{"queries":["相关背景资料"]}' }))
  at(9200, () => S({ t: 'tool-result', callId: 'c2', name: 'web_search', label: '上网查', ms: 3000, error: null }))
  at(9800, () => S({ t: 'tool-call', callId: 'c3', name: 'write', label: '写文件', args: '{"file_path":"docs/summary.md"}' }))
  at(11600, () => S({ t: 'tool-result', callId: 'c3', name: 'write', label: '写文件', ms: 1800, error: null }))
  at(12200, () => S({ t: 'step-start', turn: 1, step: 3 }))
  const reply = '看完了，摘要写在 docs/summary.md 里：三点结论，外加一段背景。要不要人家再给你排个版？'
  for (let i = 0; i < reply.length; i += 3) {
    at(12800 + i * 45, () => S({ t: 'delta', kind: 'text', text: reply.slice(i, i + 3) }))
  }
  at(12800 + reply.length * 45 + 400, () =>
    S({ t: 'assistant', turn: 1, step: 3, text: reply, usage: { input: 26000, cache: 15000, output: 380 } }),
  )
  at(12800 + reply.length * 45 + 900, () =>
    S({ t: 'turn-end', turn: 1, reason: { kind: 'completed' }, ms: 14200, tokens: 41380 }),
  )
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  鲸鱼娘预览： http://127.0.0.1:${PORT}\n`)
  console.log('  · 点鲸鱼娘 = 戳一下；双击 = 输入框；右键/⋯ = 菜单；拖动 = 挪位置')
  console.log('  · 左上角按钮可以假装 agent 在干活\n')
  if (AUTO_DEMO) setTimeout(() => runDemo('ok'), 1500)
})
