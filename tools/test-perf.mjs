#!/usr/bin/env node
/**
 * test-perf.mjs —— 宿主侧「性能 / 资源」行为的回归测试（纯 Node，不需要浏览器）。
 *   node tools/test-perf.mjs
 *
 * 守住的是 v0.5.6 性能 review 里改掉的那几件事：
 *   1. 静态资源带校验器（ETag / Last-Modified），没变就 304：以前写了 no-cache 却没有校验器，
 *      每次刷新页面都把 pixi / cubism / 贴图 / 全部前端模块（~5MB）原样重传、重新编译；热读取（改文件刷新就生效）语义不变；
 *   2. 逐字流合并：深度思考的上万个增量不再是上万帧 SSE；首字不延迟、文字与顺序一字不差、别的事件不会插到它前面；
 *   3. 羁绊的读操作（snapshot / brief）不再每次同步写盘。
 */

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pet-perf-'))
process.env.DSH_HOME = TMP_HOME // 必须在 import 宿主模块之前

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href)

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

// ————————————————————————————————————————————————————————————
console.log('\n逐字流合并器\n')
{
  const { createDeltaCoalescer } = await imp('lib/events/coalesce.js')
  /** 假时钟 + 假定时器：测试里手动拨时间。 */
  function rig(intervalMs = 100) {
    let t = 1000
    const timers = []
    const frames = []
    const co = createDeltaCoalescer({
      emit: (p) => frames.push(p),
      intervalMs,
      now: () => t,
      setTimer: (fn, ms) => {
        const h = { fn, at: t + ms, dead: false }
        timers.push(h)
        return h
      },
      clearTimer: (h) => {
        if (h) h.dead = true
      },
    })
    const advance = (ms) => {
      const end = t + ms
      for (;;) {
        const due = timers.filter((h) => !h.dead && h.at <= end).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        t = due.at
        due.dead = true
        due.fn()
      }
      t = end
    }
    return { co, frames, advance, timers, now: () => t }
  }

  {
    const { co, frames } = rig()
    co.push('s', 'text', '你')
    check('首字立刻发（不等窗口）', frames.length === 1 && frames[0].text === '你' && frames[0].t === 'delta' && frames[0].kind === 'text' && frames[0].sessionId === 's')
  }
  {
    const { co, frames, advance } = rig()
    co.push('s', 'text', 'a')
    co.push('s', 'text', 'b')
    co.push('s', 'text', 'c')
    check('窗口内后续增量先攒着', frames.length === 1 && co.pendingLength === 2)
    advance(100)
    check('窗口到点发出一帧合并的', frames.length === 2 && frames[1].text === 'bc' && co.pendingLength === 0)
  }
  {
    const { co, frames, advance } = rig()
    const want = []
    // 1000 个增量，每 1ms 一个（约 1 秒）
    for (let i = 0; i < 1000; i++) {
      const ch = String.fromCharCode(0x4e00 + (i % 200))
      want.push(ch)
      co.push('s', 'reasoning', ch)
      advance(1)
    }
    co.flush()
    const got = frames.map((f) => f.text).join('')
    check('文字内容与顺序一字不差', got === want.join(''))
    check('1000 个增量 → 十几帧（≤ 15）', frames.length <= 15 && frames.length >= 8, `${frames.length} 帧`)
  }
  {
    const { co, frames } = rig()
    co.push('s', 'text', 'x')
    co.push('s', 'text', 'y')
    co.flush()
    check('flush：攒着的立刻发出，保证排在后面的事件前面', frames.length === 2 && frames[1].text === 'y' && co.pendingLength === 0)
    co.flush()
    check('flush 没东西时是空操作', frames.length === 2)
  }
  {
    const { co, frames } = rig()
    co.push('s', 'reasoning', 'think')
    co.push('s', 'reasoning', 'ing')
    co.push('s', 'text', 'answer')
    const seq = () => frames.map((f) => f.kind + ':' + f.text).join('|')
    check('种类切换（思考 → 回复）：先把旧种类攒的发掉，跨种类顺序不乱', seq() === 'reasoning:think|reasoning:ing', seq())
    co.flush()
    check('切换之后新种类照常发出，顺序在后', seq() === 'reasoning:think|reasoning:ing|text:answer', seq())
  }
  {
    const { co, frames } = rig()
    co.push('a', 'text', '1')
    co.push('a', 'text', '2')
    co.push('b', 'text', '3')
    co.flush()
    check('不同会话的增量不会混进同一帧', frames.map((f) => f.sessionId + f.text).join(',') === 'a1,a2,b3')
  }
  {
    const { co, frames, advance, timers } = rig()
    co.push('s', 'text', 'a')
    co.push('s', 'text', 'b')
    co.drop()
    advance(500)
    check('没有客户端时 drop：攒的丢掉、定时器作废、不会补发', frames.length === 1 && co.pendingLength === 0 && timers.every((h) => h.dead))
  }
  {
    const { co, frames } = rig()
    co.push('s', 'text', '')
    co.push('s', 'text', undefined)
    check('空文本被忽略', frames.length === 0)
  }
  {
    const { co, frames, advance } = rig()
    co.push('s', 'text', 'a')
    advance(150)
    co.push('s', 'text', 'b')
    check('停了一阵再来：又是立刻发（每一段的首字都不延迟）', frames.length === 2 && frames[1].text === 'b')
  }
  {
    // 真定时器：unref，不拖着进程不退出
    const frames = []
    const co = createDeltaCoalescer({ emit: (p) => frames.push(p), intervalMs: 30 })
    co.push('s', 'text', 'a')
    co.push('s', 'text', 'b')
    await new Promise((r) => setTimeout(r, 80))
    check('真实定时器下合并帧按时发出', frames.length === 2 && frames[1].text === 'b')
  }
}

// ————————————————————————————————————————————————————————————
console.log('\n静态资源：校验器 / 304 / 热读取\n')
{
  const { registerStatic, isNotModified } = await imp('lib/http/static.js')
  const exact = new Map()
  const prefixes = []
  registerStatic({
    route: (kind, p, h) => (kind === 'exact' ? exact.set(p, h) : prefixes.push([p, h])),
    json: async () => ({}),
    onConfigChanged() {},
  })
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0]
    const h = exact.get(u) || (prefixes.find(([p]) => u.startsWith(p + '/')) || [])[1]
    if (!h) {
      res.writeHead(404).end()
      return
    }
    Promise.resolve(h(req, res)).catch(() => {
      try {
        res.writeHead(500).end()
      } catch (e) {}
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const get = async (p, headers = {}, method = 'GET') => {
    const r = await fetch(base + p, { headers, method })
    const buf = Buffer.from(await r.arrayBuffer())
    return { status: r.status, h: r.headers, buf }
  }

  const stkFile = Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'stickers', 'manifest.json'), 'utf8')).stickers)[0].file
  for (const [label, p] of [
    ['表情包 GIF', '/dsh-pet/stickers/' + stkFile],
    ['vendor', '/dsh-pet/vendor/pixi.min.js'],
    ['模型贴图', '/dsh-pet/model/c_0120.2048/texture_00.png'],
    ['模型清单', '/dsh-pet/model/manifest.json'],
    ['音效', '/dsh-pet/sound/duck-press.mp3'],
    ['前端模块', '/dsh-pet/app/main.js'],
  ]) {
    const a = await get(p)
    const etag = a.h.get('etag')
    const lm = a.h.get('last-modified')
    // 表情包 GIF 是 `public, max-age=86400`（一天新鲜期）：重点是过期之后能拿 304，不用整张重下
    const cacheOk = label === '表情包 GIF' ? /max-age=86400/.test(a.h.get('cache-control') || '') : /no-cache/.test(a.h.get('cache-control') || '')
    check(`${label}：200 带 ETag + Last-Modified，缓存策略正确（${label === '表情包 GIF' ? '一天新鲜期' : 'no-cache，不是 no-store'}）`, a.status === 200 && !!etag && !!lm && cacheOk, `${a.h.get('cache-control')} ${etag}`)
    check(`${label}：Content-Length 与实际字节一致`, Number(a.h.get('content-length')) === a.buf.length)
    const b = await get(p, { 'If-None-Match': etag })
    check(`${label}：If-None-Match 命中 → 304、没有 body`, b.status === 304 && b.buf.length === 0 && b.h.get('etag') === etag)
    const c = await get(p, { 'If-None-Match': 'W/"nope"' })
    check(`${label}：ETag 对不上 → 200 全量`, c.status === 200 && c.buf.length === a.buf.length)
    const d = await get(p, { 'If-Modified-Since': lm })
    check(`${label}：If-Modified-Since 命中 → 304`, d.status === 304)
    const e = await get(p, { 'If-None-Match': 'W/"nope"', 'If-Modified-Since': lm })
    check(`${label}：两个头都带时 If-None-Match 优先（ETag 不对就是 200）`, e.status === 200)
    const f = await get(p, {}, 'HEAD')
    check(`${label}：HEAD 只回头不回 body`, f.status === 200 && f.buf.length === 0 && Number(f.h.get('content-length')) === a.buf.length)
  }

  const star = await get('/dsh-pet/app/main.js', { 'If-None-Match': '*' })
  check('If-None-Match: * → 304', star.status === 304)
  const multi = await (async () => {
    const a = await get('/dsh-pet/app/main.js')
    return get('/dsh-pet/app/main.js', { 'If-None-Match': `"zzz", ${a.h.get('etag')}` })
  })()
  check('If-None-Match 是列表时，命中其中任意一个就 304', multi.status === 304)
  check('isNotModified：没有任何条件头 → false', isNotModified({ headers: {} }, { ETag: 'W/"1-2"', 'Last-Modified': new Date(0).toUTCString() }) === false)

  // 热读取：改了文件，ETag 变、内容新；改回来，内容也回来（刷新即生效的语义没丢）
  const mainJs = path.join(ROOT, 'assets', 'app', 'main.js')
  const st0 = fs.statSync(mainJs)
  const before = await get('/dsh-pet/app/main.js')
  try {
    const t = new Date(st0.mtimeMs + 5000)
    fs.utimesSync(mainJs, t, t)
    const after = await get('/dsh-pet/app/main.js', { 'If-None-Match': before.h.get('etag') })
    check('热读取：文件改过（mtime 变）→ 旧 ETag 不再命中，拿到 200', after.status === 200 && after.h.get('etag') !== before.h.get('etag'))
    check('热读取：内容与磁盘一致', after.buf.equals(fs.readFileSync(mainJs)))
  } finally {
    fs.utimesSync(mainJs, st0.atime, st0.mtime)
  }
  const back = await get('/dsh-pet/app/main.js')
  check('热读取：mtime 恢复后 ETag 也恢复', back.h.get('etag') === before.h.get('etag'))

  const pet = await get('/dsh-pet/pet.js')
  check('pet.js 仍是 no-store（它带每次现算的 boot 配置，不能被缓存）', pet.status === 200 && /no-store/.test(pet.h.get('cache-control') || '') && pet.buf.toString('utf8').includes('__DSH_PET_BOOT__'))
  check('不存在的文件仍然 404 / 越界仍然 403', (await get('/dsh-pet/app/nope.js')).status === 404 && (await get('/dsh-pet/app/..%2f..%2fpackage.json')).status === 403 && (await get('/dsh-pet/model/%2e%2e%2f%2e%2e%2fpackage.json')).status === 403)

  // 客户端传到一半断开：宿主不抛、不崩，之后请求照常
  let uncaught = null
  const onUncaught = (e) => (uncaught = e)
  process.on('uncaughtException', onUncaught)
  await new Promise((resolve) => {
    const req = http.get(base + '/dsh-pet/model/c_0120.2048/texture_00.png', (res) => {
      res.once('data', () => {
        req.destroy()
        resolve()
      })
    })
    req.on('error', () => resolve())
  })
  await new Promise((r) => setTimeout(r, 200))
  process.off('uncaughtException', onUncaught)
  check('传输中途客户端断开：不产生未捕获异常', uncaught === null, uncaught && String(uncaught.message))
  check('……之后请求照常', (await get('/dsh-pet/app/main.js')).status === 200)
  server.close()
}

// ————————————————————————————————————————————————————————————
console.log('\n统计 / 羁绊：读操作不再写盘\n')
{
  const { createStatsStore } = await imp('lib/stats/store.js')
  const { createBond } = await imp('lib/bond/index.js')
  const { STATS_FILE } = await imp('lib/paths.js')
  let writes = 0
  const realWrite = fs.writeFileSync
  fs.writeFileSync = function (...a) {
    if (String(a[0]) === STATS_FILE || String(a[0]) === STATS_FILE + '.tmp') writes++ // 原子写先写 .tmp 再 rename
    return realWrite.apply(this, a)
  }
  try {
    const stats = createStatsStore()
    const bond = createBond({ read: () => stats.bondRaw(), write: (b) => stats.setBond(b), stickers: [] })
    bond.snapshot()
    const first = writes
    check('第一次读会落一次盘（把规整后的初始数据存下来）', first === 1, `${first} 次`)
    writes = 0
    for (let i = 0; i < 50; i++) bond.snapshot()
    for (let i = 0; i < 50; i++) bond.brief()
    check('之后 100 次 snapshot / brief 一次盘都不写', writes === 0, `${writes} 次`)
    const r = bond.act('poke')
    check('真的改了状态（戳她 +1）照样落盘', r.delta === 1 && writes === 1, `delta ${r.delta}，写 ${writes} 次`)
    writes = 0
    stats.bump(1234)
    check('统计累加（一轮结束）照样落盘', writes === 1)
    writes = 0
    stats.claim('perf-test', 'day')
    stats.claim('perf-test', 'day')
    check('领取：第一次落盘，重复领取（没改任何东西）不再写', writes === 1, `${writes} 次`)
    const onDisk = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'))
    check('落盘内容与内存一致（跳过写入不会丢数据）', onDisk.totalTurns === 1 && onDisk.totalTokens === 1234 && onDisk.claims['perf-test'] && onDisk.bond)
    check('原子写：目录里没有残留的 .tmp', !fs.existsSync(STATS_FILE + '.tmp'))
  } finally {
    fs.writeFileSync = realWrite
  }
}

// ————————————————————————————————————————————————————————————
console.log('\n统计文件：原子写\n')
{
  const { writeAtomic } = await imp('lib/stats/store.js')
  const f = path.join(TMP_HOME, 'atomic-test.json')
  writeAtomic(f, JSON.stringify({ a: 1 }))
  check('正常：内容写对、没有 .tmp 残留', JSON.parse(fs.readFileSync(f, 'utf8')).a === 1 && !fs.existsSync(f + '.tmp'))
  // 写 .tmp 之后、rename 之前「进程被杀」：目标文件必须还是完整的旧内容（直接 writeFileSync 做不到这一点）
  const realRename = fs.renameSync
  let sawTmpWhileOldIntact = false
  fs.renameSync = function (from, to) {
    // 此刻 .tmp 已经是新内容，目标还是旧的完整 JSON
    sawTmpWhileOldIntact = JSON.parse(fs.readFileSync(from, 'utf8')).a === 2 && JSON.parse(fs.readFileSync(to, 'utf8')).a === 1
    return realRename.call(this, from, to)
  }
  try {
    writeAtomic(f, JSON.stringify({ a: 2 }))
  } finally {
    fs.renameSync = realRename
  }
  check('写入过程中目标文件始终是完整的旧内容（崩在中途也不会留下半截 JSON）', sawTmpWhileOldIntact && JSON.parse(fs.readFileSync(f, 'utf8')).a === 2)
  // rename 失败（Windows 杀软占着文件）：退回直接写，内容照样到位，.tmp 被清掉
  fs.renameSync = () => {
    throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
  }
  try {
    writeAtomic(f, JSON.stringify({ a: 3 }))
  } finally {
    fs.renameSync = realRename
  }
  check('rename 失败：退回直接写，内容到位、.tmp 清掉', JSON.parse(fs.readFileSync(f, 'utf8')).a === 3 && !fs.existsSync(f + '.tmp'))
}

// ————————————————————————————————————————————————————————————
console.log('\n余额：起点余额复用刚拉过的结果\n')
{
  const { createWallet } = await imp('lib/wallet/service.js')
  const realFetch = globalThis.fetch
  let calls = 0
  let balance = '10.00'
  globalThis.fetch = async () => {
    calls++
    return { ok: true, json: async () => ({ balance_infos: [{ currency: 'CNY', total_balance: balance }] }) }
  }
  try {
    const svc = createWallet({ get: (n) => (n === 'credentials' ? { resolve: async () => ({ value: 'k' }) } : null) })
    const a = await svc.fetchBalance(true)
    check('强制拉一次：打一次接口', calls === 1 && a.ok && a.totalBalance === 10)
    const b = await svc.fetchBalance(true, 5000)
    check('起点余额（force + 5s 内刚成功拉过）：复用，不再打接口', calls === 1 && b.totalBalance === 10, `${calls} 次`)
    const c = await svc.fetchBalance(true)
    check('普通强制刷新（没给 maxAge）：照样重查——结算那次要拿最新的', calls === 2, `${calls} 次`)
    svc.wallet.balanceAt = Date.now() - 6000
    balance = '9.50'
    const d = await svc.fetchBalance(true, 5000)
    check('超过 5 秒：重查，拿到新余额（旧缓存的坑不会回来）', calls === 3 && d.totalBalance === 9.5, `${calls} 次 / ${d.totalBalance}`)
    svc.wallet.balance = { ok: false, code: 'ERROR', error: 'x' }
    svc.wallet.balanceAt = Date.now()
    await svc.fetchBalance(true, 5000)
    check('上一次失败的结果不复用（只复用成功的）', calls === 4, `${calls} 次`)
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 通过 / ${fail} 失败\n`)
process.exit(fail === 0 ? 0 : 1)
