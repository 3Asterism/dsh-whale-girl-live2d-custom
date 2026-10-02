#!/usr/bin/env node
/**
 * test-squeak.mjs —— 按压音效（engine/squeak.js）的素材完整性与时序（纯 Node，不需要浏览器 / 真 AudioContext）。
 *   node tools/test-squeak.mjs
 *
 * 管的事：
 *   1. 素材：assets/sound 里两个 mp3 在、是 MP3 头、体积合理；署名写进了 NOTICE.md；宿主只放行 .mp3；
 *   2. 时序（用假 AudioContext 记录每次 start(when)）：
 *      · 点按（按压音没放完就松手）→ 松开音排到「按压音结束前 40ms」，只排一次，按压音不重复；
 *      · 按住（按压音放完才松手）→ 松开音立刻响；
 *      · 连点 → 上一轮被掐掉，不叠；
 *      · 缓冲区没就绪 / 加载失败 → 静音、不抛，之后可以重试；
 *      · 开关关掉 → 一个声音都不出，也不去拿 AudioContext；按着的时候被关掉 → 当场掐掉，之后松手不响。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { createSqueaker, RELEASE_LEAD_MS } = await import(
  pathToFileURL(path.join(ROOT, 'assets', 'app', 'engine', 'squeak.js')).href
)

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

/** 假 AudioContext：只记录「哪条音、什么时候起播、有没有被 stop」。currentTime 由测试手动拨。 */
function fakeCtx() {
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: {},
    plays: [], // { src, when, stopped, buf }
    createGain() {
      return { gain: { value: 1 }, connect() {} }
    },
    createBufferSource() {
      const src = {
        buffer: null,
        onended: null,
        connect() {},
        start(when) {
          rec.when = when
        },
        stop() {
          rec.stopped = true
        },
      }
      const rec = { src, when: null, stopped: false }
      Object.defineProperty(rec, 'buf', { get: () => src.buffer })
      ctx.plays.push(rec)
      return src
    },
  }
  return ctx
}

const DUR = { press: 0.16, release: 0.11 }
/** 假加载器：不碰网络，直接给一个有时长的假 AudioBuffer。 */
const fakeLoad = async (kind) => ({ duration: DUR[kind] })
const kindOf = (rec) => (rec.buf.duration === DUR.press ? 'press' : 'release')
/** 造一个已经预热好的控制器（等两条音都「解码」完）。 */
async function ready(ctx, extra = {}) {
  const sq = createSqueaker({ getCtx: () => ctx, load: fakeLoad, idleMs: 0, ...extra })
  await sq.warm()
  return sq
}

console.log('\n按压音效 · 素材与署名\n')
{
  const dir = path.join(ROOT, 'assets', 'sound')
  for (const f of ['duck-press.mp3', 'duck-release.mp3']) {
    const b = fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f)) : null
    const isMp3 = !!b && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) // ID3 或帧同步
    check(`${f} 存在、是 MP3、体积 1KB–64KB`, !!b && isMp3 && b.length > 1024 && b.length < 65536, b ? `${b.length}B` : '缺失')
  }
  const notice = fs.readFileSync(path.join(ROOT, 'NOTICE.md'), 'utf8')
  check('NOTICE.md 写了音效范围（assets/sound）与来源（dsh-whale-widget）', /assets\/sound/.test(notice) && /dsh-whale-widget/.test(notice))
  const staticSrc = fs.readFileSync(path.join(ROOT, 'lib', 'http', 'static.js'), 'utf8')
  check('宿主 /dsh-pet/sound 路由只放行 .mp3', /\/dsh-pet\/sound/.test(staticSrc) && /extname\(abs\)\.toLowerCase\(\) !== '\.mp3'/.test(staticSrc))
}

console.log('\n按压音效 · 时序\n')
{
  // 点按：按下 → 20ms 后松手（按压音 160ms 还没放完）
  const ctx = fakeCtx()
  const sq = await ready(ctx)
  sq.down()
  check('按下立刻起播一条「按下」音（start(0) = 现在）', ctx.plays.length === 1 && kindOf(ctx.plays[0]) === 'press' && ctx.plays[0].when === 0)
  ctx.currentTime = 0.02
  sq.up()
  const rel = ctx.plays[1]
  const want = 0.16 - 0.02 - RELEASE_LEAD_MS / 1000 + 0.02 // 绝对时刻 = now + (remain - lead)
  check('点按：松开音被排期（不是立刻响）', ctx.plays.length === 2 && kindOf(rel) === 'release' && rel.when > ctx.currentTime)
  check(`点按：松开音排到「按压音结束前 ${RELEASE_LEAD_MS}ms」`, Math.abs(rel.when - want) < 0.002, `排在 ${rel.when.toFixed(4)}s，期望 ${want.toFixed(4)}s`)
  // 按压音自然放完：不许再补一条松开音
  ctx.plays[0].src.onended && ctx.plays[0].src.onended()
  check('按压音放完后不会重复补松开音', ctx.plays.length === 2)
  sq.up()
  check('重复 up() 是空操作', ctx.plays.length === 2)
}
{
  // 按住：按压音放完（onended）之后才松手 → 立刻响
  const ctx = fakeCtx()
  const sq = await ready(ctx)
  sq.down()
  ctx.currentTime = 0.5
  ctx.plays[0].src.onended()
  check('按住时按压音放完：松手之前不响松开音', ctx.plays.length === 1)
  sq.up()
  check('按住后松手：松开音立刻响（start(0)）', ctx.plays.length === 2 && kindOf(ctx.plays[1]) === 'release' && ctx.plays[1].when === 0)
}
{
  // 松手比 onended 事件早，但音频时钟已过按压音结尾（主线程事件迟到）→ 也按「立刻响」处理，不排负延迟
  const ctx = fakeCtx()
  const sq = await ready(ctx)
  sq.down()
  ctx.currentTime = 0.3
  sq.up()
  check('按压音早已放完但 onended 还没到：松开音立刻响，不排负延迟', ctx.plays.length === 2 && ctx.plays[1].when === 0)
}
{
  // 连点：第二次按下掐掉上一轮（按压 + 已排期的松开）
  const ctx = fakeCtx()
  const sq = await ready(ctx)
  sq.down()
  ctx.currentTime = 0.01
  sq.up() // plays[0]=按下, plays[1]=排期的松开
  ctx.currentTime = 0.05
  sq.down() // 连点
  check('连点：上一轮的按下音和排期中的松开音都被 stop', ctx.plays[0].stopped && ctx.plays[1].stopped)
  check('连点：新一轮的按下音正常起播', ctx.plays.length === 3 && !ctx.plays[2].stopped && kindOf(ctx.plays[2]) === 'press')
  ctx.currentTime = 0.06
  sq.up()
  check('连点：第二轮松手照样排出松开音（releasePlayed 已复位，不会只响一次）', ctx.plays.length === 4 && kindOf(ctx.plays[3]) === 'release')
}

console.log('\n按压音效 · 加载与开关\n')
{
  // 缓冲区还没解码好：这次静音，不抛；就绪后恢复
  const ctx = fakeCtx()
  let release
  const gate = new Promise((r) => (release = r))
  const sq = createSqueaker({ getCtx: () => ctx, load: async (k) => (await gate, { duration: DUR[k] }), idleMs: 0 })
  const warming = sq.warm()
  sq.down()
  sq.up()
  check('缓冲区没就绪：按下 / 松开静音，不抛', ctx.plays.length === 0)
  release()
  await warming
  sq.down()
  check('就绪之后恢复出声', ctx.plays.length === 1 && kindOf(ctx.plays[0]) === 'press')
}
{
  // 加载失败：静音、不抛，之后 warm 会重试
  const ctx = fakeCtx()
  let calls = 0
  const origWarn = console.warn
  console.warn = () => {}
  const sq = createSqueaker({
    getCtx: () => ctx,
    load: async (k) => {
      calls++
      if (calls <= 2) throw new Error('HTTP 404')
      return { duration: DUR[k] }
    },
    idleMs: 0,
  })
  await sq.warm()
  console.warn = origWarn
  sq.down()
  sq.up()
  check('加载失败（两条都 404）：静音、不抛', ctx.plays.length === 0)
  await sq.warm()
  sq.down()
  check('再次 warm 会重试，成功后恢复出声', ctx.plays.length === 1)
}
{
  // 开关
  let asked = 0
  const ctx = fakeCtx()
  const sq = createSqueaker({ getCtx: () => (asked++, ctx), load: fakeLoad, idleMs: 0 })
  sq.setOn(false)
  await sq.warm()
  sq.down()
  sq.up()
  check('开关关掉：warm / 按下 / 松开都不出声，也不去拿 AudioContext', ctx.plays.length === 0 && asked === 0)
  sq.setOn(true) // 打开时自带预热
  await sq.warm()
  sq.down()
  check('再打开：恢复出声', ctx.plays.length === 1)
  sq.setOn(false)
  check('按着的时候被关掉：当场掐掉按下音', ctx.plays[0].stopped)
  sq.up()
  check('……之后松手不响', ctx.plays.length === 1)
}
{
  // 音量
  const ctx = fakeCtx()
  const gains = []
  const origCreateGain = ctx.createGain
  ctx.createGain = () => {
    const g = origCreateGain()
    gains.push(g)
    return g
  }
  const sq = await ready(ctx)
  sq.setVolume(0.25)
  sq.down()
  check('音量写进增益节点', gains.length === 1 && gains[0].gain.value === 0.25)
  sq.setVolume(9)
  check('音量越界被夹到 1', sq.state().vol === 1)
  sq.setVolume(NaN)
  check('音量给了非法值：保持原值', sq.state().vol === 1)
}
{
  // 拿不到 AudioContext（比如不支持）：全部静默，不抛
  const sq = createSqueaker({ getCtx: () => null, load: fakeLoad, idleMs: 0 })
  let ok = true
  try {
    await sq.warm()
    sq.down()
    sq.up()
  } catch (e) {
    ok = false
  }
  check('拿不到 AudioContext：静默不抛', ok)
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 通过 / ${fail} 失败\n`)
process.exit(fail === 0 ? 0 : 1)
