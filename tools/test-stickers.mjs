#!/usr/bin/env node
/**
 * test-stickers.mjs —— 表情包的纯逻辑 + 数据完整性（不需要浏览器、不需要宿主）。
 *   node tools/test-stickers.mjs
 *
 * 管的事：
 *   1. 清单与文件一一对应、体积不超预算、每张的一圈时长在合理范围；
 *   2. 所有「情绪 / 事件 / 括号动作词 / 工具 / 兜底」池里引用的图都真实存在；
 *   3. **每一个台词 id 都配了图**（覆盖优先：绝大部分台词都该有表情包，漏一个这里就红）；
 *   4. 选图 / 时长规则（sticker-pick.js）：不拖长气泡、吸附、LRU、优先级。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = path.join(ROOT, 'assets', 'app')
const STK = path.join(ROOT, 'assets', 'stickers')
const imp = (rel) => import(pathToFileURL(path.join(APP, rel)).href)

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const pickMod = await imp('ui/sticker-pick.js')
const data = await imp('persona/stickers.js')
const { SOUL_LINES } = await imp('persona/lines-soul.js')
const { BOND_LINES } = await imp('persona/lines-bond.js')
const { SAY } = await imp('persona/say.js')

const manifestFile = JSON.parse(fs.readFileSync(path.join(STK, 'manifest.json'), 'utf8'))
const manifest = manifestFile.stickers
const curation = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'stickers.curation.json'), 'utf8')).stickers

console.log('\n表情包 · 数据完整性\n')
const ids = Object.keys(manifest)
const gifs = fs.readdirSync(STK).filter((f) => f.endsWith('.gif'))
check('清单里每张都有对应的 .gif 文件，且没有多余的 .gif', ids.every((i) => fs.existsSync(path.join(STK, manifest[i].file))) && gifs.length === ids.length, `${ids.length} 张`)
check('入选清单（curation）里的 id 都在清单里（单圈过长被剔除的除外，最多 3 张）', curation.filter((c) => !manifest[c.id]).length <= 3, curation.filter((c) => !manifest[c.id]).map((c) => c.id).join(',') || '全部入选')
const sizes = ids.map((i) => fs.statSync(path.join(STK, manifest[i].file)).size)
const total = sizes.reduce((a, b) => a + b, 0)
check('单张 ≤ 210KB', Math.max(...sizes) <= 210 * 1024, `最大 ${Math.round(Math.max(...sizes) / 1024)}KB`)
check('总计 ≤ 12MB（压缩后；原图 460MB）', total <= 12 * 1048576, `${(total / 1048576).toFixed(2)}MB`)
check('每张是 GIF 文件头、96×96、一圈时长 100–2600ms', ids.every((i) => {
  const b = fs.readFileSync(path.join(STK, manifest[i].file))
  const m = manifest[i]
  return b.slice(0, 3).toString() === 'GIF' && b.readUInt16LE(6) === 96 && b.readUInt16LE(8) === 96 && m.ms >= 100 && m.ms <= 2600
}))
check('清单里每张都写了「梗」说明和中文名（图鉴里显示）', ids.every((i) => typeof manifest[i].meme === 'string' && manifest[i].meme.length > 1 && typeof manifest[i].name === 'string' && manifest[i].name))

const allRefs = new Map() // id → 引用位置
const ref = (where, pool) => {
  for (const id of pool) if (!allRefs.has(id + '@' + where)) allRefs.set(id + '@' + where, { id, where })
}
for (const [k, pool] of Object.entries(data.MOOD_STICKER)) ref('mood:' + k, pool)
for (const [k, pool] of Object.entries(data.EVENT_STICKER)) ref('event:' + k, pool)
for (const [, pool] of data.ACTION_STICKER) ref('action', pool)
for (const [k, pool] of Object.entries(data.TOOL_STICKER)) ref('tool:' + k, pool)
ref('fallback', data.FALLBACK_STICKER)
ref('minLevel', Object.keys(data.MIN_LEVEL))
ref('start', data.START_STICKER)
ref('thinking', data.THINKING_STICKER)
const dangling = [...allRefs.values()].filter((r) => !manifest[r.id])
check('所有池里引用的表情包都真实存在', dangling.length === 0, dangling.map((r) => `${r.where}→${r.id}`).join(', ') || `${allRefs.size} 处引用`)

// 台词 id 全覆盖：核心台词在 lines.js 里没有导出，直接从源码里抠 id
const coreSrc = fs.readFileSync(path.join(APP, 'persona', 'lines.js'), 'utf8')
const coreIds = [...coreSrc.matchAll(/^  ([A-Za-z0-9_]+): [\[{]/gm)].map((m) => m[1])
const lineIds = new Set([...coreIds, ...Object.keys(BOND_LINES), ...Object.keys(SOUL_LINES)])
const NO_STICKER = new Set([]) // 实在没法适配的才写进来，并在这里写明原因
const unmapped = [...lineIds].filter((k) => !data.EVENT_STICKER[k] && !NO_STICKER.has(k))
check(`每个台词 id 都配了表情包（共 ${lineIds.size} 个）`, unmapped.length === 0, unmapped.join(', ') || '全部覆盖')
check('主要的直接传台词的表演也配了（待机碎碎念 / 醒来 / 收拾桌面 / 被打断 / 工具报错）', ['idle-mutter', 'wake', 'menu-tidy', 'finish-abort', 'tool-error'].every((k) => data.EVENT_STICKER[k]))

// 铁律：台词里不出现第三方模型品牌 / 不叫「鱼片」
const allLines = [...Object.values(SOUL_LINES).flat(), ...Object.values(SAY).flat()].filter((x) => typeof x === 'string')
check('新台词不提第三方模型品牌、不叫「鱼片」', !allLines.some((s) => /GLM|Kimi|Qwen|GPT|Claude|Gemini|智谱|鱼片/i.test(s)))
check('新台词每条 ≤ 28 字、至多一个全角括号动作', Object.values(SOUL_LINES).flat().every((s) => s.length <= 28 && (s.match(/（/g) || []).length <= 1), Object.values(SOUL_LINES).flat().filter((s) => s.length > 28 || (s.match(/（/g) || []).length > 1).join(' | '))

console.log('\n表情包 · 选图与时长规则\n')
const { SNAP_MS, REPEAT_MS, snapExtra, soloTtl, stickyMs, chooseFrom, pickSticker, resolvePools } = pickMod
const M = { a: { ms: 800 }, b: { ms: 1300 }, c: { ms: 2000 }, d: { ms: 2320 } }

check('吸附：只差 ≤400ms 就播完才多等，否则 0', snapExtra(1800, 960) === 120 && snapExtra(1800, 800) === 0 && snapExtra(1920, 960) === 0 && snapExtra(1000, 1300) === 300 && snapExtra(500, 1300) === 0)
check('吸附上限就是 SNAP_MS，且对非法输入返回 0', SNAP_MS === 400 && snapExtra(0, 960) === 0 && snapExtra(1800, 0) === 0 && snapExtra(NaN, 960) === 0)
check('独立表情包停留：一圈+300ms，夹在 1.8–3.2s', soloTtl(800) === 1800 && soloTtl(1640) === 1940 && soloTtl(2900) === 3200)
check('常驻气泡里的图：最多 2 圈、不超过 4s', stickyMs(960) === 1920 && stickyMs(2320) === 4000)

const rng0 = () => 0
check('按时长过滤：永远不选 L > ttl+400 的图', chooseFrom(['a', 'b', 'c', 'd'], { manifest: M, ttl: 1000, recent: new Map(), now: 1e6, rand: rng0 }) === 'a' && chooseFrom(['c', 'd'], { manifest: M, ttl: 1000, recent: new Map(), now: 1e6 }) === null)
check('边界：L = ttl+400 可以，> ttl+400 不行', chooseFrom(['b'], { manifest: M, ttl: 900, recent: new Map(), now: 1e6 }) === 'b' && chooseFrom(['b'], { manifest: M, ttl: 899, recent: new Map(), now: 1e6 }) === null)
check('ttl=null（独立 / 常驻）不按时长过滤', chooseFrom(['d'], { manifest: M, ttl: null, recent: new Map(), now: 1e6 }) === 'd')
const rec = new Map([['a', 1e6 - 1000], ['b', 1e6 - 50000]])
check('偏好最近没用过的：a、b 都近期用过但 c 没用过 → 选 c', chooseFrom(['a', 'b', 'c'], { manifest: M, ttl: 5000, recent: rec, now: 1e6, rand: rng0 }) === 'c')
check('覆盖优先：候选都近期用过时选「最久没用」的（LRU），不返回空', chooseFrom(['a', 'b'], { manifest: M, ttl: 5000, recent: rec, now: 1e6, rand: rng0 }) === 'b')
check('过了 REPEAT_MS 就又算「新鲜」', chooseFrom(['a'], { manifest: M, ttl: 5000, recent: new Map([['a', 1e6 - REPEAT_MS - 1]]), now: 1e6 }) === 'a')
check('显式指定（force）不受近期限制', chooseFrom(['a'], { manifest: M, ttl: 5000, recent: new Map([['a', 1e6]]), now: 1e6, force: true }) === 'a')

const D = { EVENT_STICKER: { ev: ['b'] }, ACTION_STICKER: [[/墨镜/, ['c']]], MOOD_STICKER: { happy: ['a'] }, FALLBACK_STICKER: ['d'] }
const ctx = (extra) => ({ manifest: M, recent: new Map(), lastAt: 0, now: 1e6, ...extra })
check('优先级：显式 > 显式池 > 事件 > 括号动作词 > mood > 兜底', JSON.stringify(resolvePools({ sticker: 'a', pool: ['b'], say: 'ev', line: '（戴墨镜）嗯', mood: 'happy' }, D)) === JSON.stringify([['a'], ['b'], ['b'], ['c'], ['a'], ['d']]))
check('事件映射压过 mood', pickSticker({ say: 'ev', mood: 'happy', line: '嗯', ttl: 5000 }, D, ctx()) === 'b')
check('台词里的括号动作词压过 mood', pickSticker({ mood: 'happy', line: '（戴墨镜）嗯', ttl: 5000 }, D, ctx()) === 'c')
check('括号动作词只认括号里的字', pickSticker({ mood: 'happy', line: '墨镜好酷', ttl: 5000 }, D, ctx()) === 'a')
check('没有任何线索的台词走兜底池（覆盖优先）', pickSticker({ line: '随便说一句', ttl: 5000 }, D, ctx()) === 'd')
check('没有台词（常驻 / 独立）不走兜底，免得乱配', pickSticker({}, D, ctx()) === null && JSON.stringify(resolvePools({ mood: 'happy' }, D)) === JSON.stringify([['a']]))
check('ttl 太短、事件池里的图太长 → 退到下一个候选池，仍然不超时', pickSticker({ say: 'ev', mood: 'happy', line: '嗯', ttl: 450 }, D, ctx()) === 'a' && pickSticker({ say: 'ev', mood: 'happy', line: '嗯', ttl: 300 }, D, ctx()) === null && pickSticker({ pool: ['c'], line: '嗯', ttl: 300, fallback: false }, D, ctx()) === null)
check('常驻气泡节流：gapMs 内不再配图，显式指定不受限', pickSticker({ pool: ['a'], gapMs: 20000 }, D, ctx({ lastAt: 1e6 - 5000 })) === null && pickSticker({ pool: ['a'], gapMs: 20000 }, D, ctx({ lastAt: 1e6 - 30000 })) === 'a' && pickSticker({ sticker: 'a', gapMs: 20000 }, D, ctx({ lastAt: 1e6 - 5000 })) === 'a')
check('一次性台词不节流（gapMs 不传）：刚出过图也照样配', pickSticker({ say: 'ev', line: '嗯', ttl: 5000 }, D, ctx({ lastAt: 1e6 - 100 })) === 'b')

// 好感等级放出（傲娇 → 黏人）
const ML = { s_love: 3, s_rose: 5 }
const MM = { s_love: { ms: 900 }, s_rose: { ms: 900 }, s_ok: { ms: 900 } }
check('好感等级放出：等级不够的图被跳过，够了才出', chooseFrom(['s_love', 's_rose', 's_ok'], { manifest: MM, ttl: 3000, recent: new Map(), now: 1e6, level: 1, minLevel: ML, rand: () => 0 }) === 's_ok'
  && chooseFrom(['s_love', 's_ok'], { manifest: MM, ttl: 3000, recent: new Map(), now: 1e6, level: 3, minLevel: ML, rand: () => 0 }) === 's_love'
  && chooseFrom(['s_rose'], { manifest: MM, ttl: 3000, recent: new Map(), now: 1e6, level: 4, minLevel: ML }) === null
  && chooseFrom(['s_rose'], { manifest: MM, ttl: 3000, recent: new Map(), now: 1e6, level: 5, minLevel: ML }) === 's_rose')
check('好感等级放出：显式指定（force）不受等级限制', chooseFrom(['s_rose'], { manifest: MM, ttl: null, recent: new Map(), now: 1e6, level: 1, minLevel: ML, force: true }) === 's_rose')
check('好感等级放出：池子里全是黏人的图时，低等级退到下一个候选池', pickSticker({ say: 'ev', mood: 'happy', line: '嗯', ttl: 5000 }, { EVENT_STICKER: { ev: ['s_love'] }, ACTION_STICKER: [], MOOD_STICKER: { happy: ['s_ok'] }, FALLBACK_STICKER: [] }, { manifest: MM, recent: new Map(), lastAt: 0, now: 1e6, level: 1, minLevel: ML }) === 's_ok')
check('MIN_LEVEL 里的每张图都存在、等级在 2–10 之间', Object.entries(data.MIN_LEVEL).every(([id, lv]) => manifest[id] && lv >= 2 && lv <= 10))

// 蒙特卡洛：随机选图 2000 次，没有一次超过 ttl+400
let over = 0
for (let i = 0; i < 2000; i++) {
  const ttl = 800 + Math.floor(Math.random() * 3000)
  const id = pickSticker({ mood: ['happy', 'sad', 'sweat', 'love', 'smug'][i % 5], line: '嗯', ttl }, { EVENT_STICKER: {}, ACTION_STICKER: [], MOOD_STICKER: data.MOOD_STICKER, FALLBACK_STICKER: data.FALLBACK_STICKER }, { manifest, recent: new Map(), lastAt: 0, now: 1e6 + i * 1000 })
  if (id && manifest[id].ms > ttl + SNAP_MS) over++
}
check('随机 2000 次选图，从不选出一圈比 ttl+400ms 还长的图', over === 0, `${over} 次越界`)

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`)
process.exit(fail > 0 ? 1 : 0)
