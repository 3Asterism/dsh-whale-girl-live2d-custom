#!/usr/bin/env node
/**
 * test-empathy.mjs —— 「看懂主人」的纯逻辑单测（不需要浏览器、不需要宿主）：
 *   · 挫败度：文本信号、重复检测、衰减、阈值与冷却、「不小题大做」、高风险走温柔分支；
 *   · 编排器：中途不说、过闸、配额、槽位替换与过期——**观察者永远不挤占正常互动**；
 *   · 复合故事：只用真的 hook 得到的信号（退出码），没有退出码就不说；
 *   node tools/test-empathy.mjs
 */

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel) => import(pathToFileURL(path.join(ROOT, 'assets', 'app', rel)).href)

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const E = await imp('persona/empathy.js')
const O = await imp('persona/orchestra.js')
const S = await imp('persona/turnstory.js')
const { SCENE_LINES } = await imp('persona/lines-scenes.js')
const MIN = 60000

console.log('\n文本信号\n')
const sig = (text, recent = [], now = 0) => E.analyzeText(text, recent, now)
check('强烈情绪词：崩溃 / 气死 / 无语 / wtf / i give up', ['我真的崩溃了', '气死我了', '无语', 'wtf is this', 'i give up'].every((s) => sig(s).signals.includes('textStrong')))
check('轻微：还是不行 / 怎么又 / 不对啊 / still not working', ['还是不行', '怎么又报错', '不对啊', 'still not working'].every((s) => sig(s).signals.includes('textMild')))
check('大喊：三个以上感叹号 / 整句大写', sig('为什么！！！').signals.includes('shout') && sig('WHY IS THIS BROKEN').signals.includes('shout') && !sig('Hello World').signals.includes('shout'))
check('平静的话、道谢、普通指令不产生任何信号', ['帮我看看这个函数', '谢谢，辛苦了', '把按钮改成蓝色', 'please refactor the loop'].every((s) => sig(s).signals.length === 0))
check('粘贴的日志 / 堆栈 / 代码里的 shit、fuck 不算（只对口语化短消息算词汇信号）', sig('Traceback (most recent call last):\n  File "a.py"\nValueError: shit happened').signals.length === 0 && sig('```js\nconsole.log("fuck")\n```').signals.length === 0 && sig('x'.repeat(130) + ' 崩溃').signals.length === 0)
check('口头禅不误判高风险：笑死 / 累死 / 气死 / 想死你了 / 困死', ['笑死我了', '累死了', '气死', '想死你了', '困死了'].every((s) => !sig(s).care))
check('高风险（自伤倾向）：只认明确的表述，且与挫败信号互斥', sig('我不想活了').care && sig('活着没有意思').care && sig('想自杀').care && sig('我不想活了').signals.length === 0)

console.log('\n重复发同一句话（提示词打转）\n')
{
  const recent = []
  const a = sig('帮我把这个接口改成异步的并且加上重试逻辑', recent, 0)
  const b = sig('帮我把这个接口改成异步的并且加上重试逻辑。', recent, 2 * MIN)
  const c = sig('今天天气不错我们来写一个全新的登录页面吧', recent, 3 * MIN)
  check('第一次不算重复；几乎一样的第二次算重复（标点不同也算）', !a.signals.includes('repeat') && b.signals.includes('repeat'))
  check('完全不同的话不算重复', !c.signals.includes('repeat'))
  const r2 = []
  sig('帮我把这个接口改成异步的并且加上重试逻辑', r2, 0)
  check('隔了 10 分钟以上不算重复（早就不是同一场）', !sig('帮我把这个接口改成异步的并且加上重试逻辑', r2, 11 * MIN).signals.includes('repeat'))
  const r3 = []
  for (let i = 0; i < 6; i++) sig('第' + i + '个完全不同的需求描述内容在这里', r3, i * 1000)
  check('只留最近 3 句的指纹（内存里，不留原文）', r3.length <= 3 && r3.every((x) => x.grams instanceof Set && !('text' in x)))
  check('太短的话（<5 个二元组）不做重复判断：「好的」「继续」', !sig('继续', [{ t: 0, grams: E.bigrams('继续') }], 1).signals.includes('repeat'))
}

console.log('\n挫败度：会衰减、有阈值、有冷却、不小题大做\n')
{
  const e = E.createEmpathy()
  e.add('regen', 0)
  check('单个小信号（点一次重新生成）远远不到线', e.level(0) === 0 && e.due(0, 12) === null)
  e.add('toolError', 0)
  check('再加一次工具报错也不到线（不小题大做）', e.level(0) === 0)
  const e2 = E.createEmpathy()
  for (let i = 0; i < 4; i++) e2.add('regen', i * 1000)
  check('连点 4 次重新生成 + 一句「还是不行」→ 到软安慰线', (e2.add('textMild', 5000), e2.level(5000) === 1) && e2.due(5000, 12).level === 1)
  const e3 = E.createEmpathy()
  e3.add('textStrong', 0)
  e3.add('turnError', 0)
  const s0 = e3.score(0)
  check('半衰期 4 分钟：4 分钟后分数减半、15 分钟后基本归零', Math.abs(e3.score(4 * MIN) - s0 * 0.5) < 0.01 && e3.score(15 * MIN) < 4)
  const e4 = E.createEmpathy()
  e4.add('textStrong', 0)
  e4.add('turnError', 0)
  e4.add('repeat', 0)
  e4.add('shout', 0)
  check('火气很大（强烈词 + 报错 + 重复 + 大喊）→ 重安慰（第 2 档），原因取占比最大的', e4.level(0) === 2 && e4.due(0, 12).level === 2)
  const dueA = e4.due(0, 12)
  e4.fired(2, 0)
  check('安慰过一次：分数降下来、进冷却（15 分钟内不再软安慰、40 分钟内不再重安慰）', e4.level(0) <= 1 && e4.due(1 * MIN, 12) === null && e4.due(10 * MIN, 12) === null)
  check('冷却过后如果又烦了还会再来（软：15 分钟后；重：40 分钟后）', (() => {
    const x = E.createEmpathy()
    const burst = (t) => { for (const k of ['textStrong', 'turnError', 'repeat', 'shout']) x.add(k, t) }
    burst(0)
    x.fired(2, 0)
    burst(20 * MIN)
    return x.due(20 * MIN, 12) !== null && x.due(20 * MIN, 12).level === 2 ? false : x.due(20 * MIN, 12) !== null && (burst(41 * MIN), x.due(41 * MIN, 12).level === 2)
  })())
  const w = E.createEmpathy()
  w.add('textStrong', 0)
  w.add('turnError', 0)
  const before = w.score(0)
  w.add('win', 0)
  check('顺利收工 / 道谢把分数拉下去（缓解）', w.score(0) < before * 0.6)
  const cm = E.createEmpathy()
  for (const k of ['textStrong', 'turnError']) cm.add(k, 0)
  cm.comforted(0)
  check('别处已经安慰过（关键词反应）：紧接着不再重复安慰', cm.due(1 * MIN, 12) === null)
  check('深夜（23 点后 / 5 点前）标 late，白天不标', (() => {
    const x = E.createEmpathy()
    for (const k of ['textStrong', 'turnError', 'textMild']) x.add(k, 0)
    return x.due(0, 23).late === true && x.due(0, 3).late === true && x.due(0, 14).late === false
  })())
  check('原因归类：文本 → rage、重复 / 重新生成 → loop、报错 → fail、被拒 → reject', (() => {
    const mk = (kinds) => { const x = E.createEmpathy(); for (const k of kinds) x.add(k, 0); return x.dominant(0) }
    return mk(['textStrong', 'shout']) === 'rage' && mk(['repeat', 'regen']) === 'loop' && mk(['turnError', 'retry']) === 'fail' && mk(['reject', 'reject', 'reject']) === 'reject'
  })())
  check('测试连红 / 连着几轮红色收场：能攒出软安慰（命令成败来自真实退出码）', (() => {
    const x = E.createEmpathy()
    for (let i = 0; i < 4; i++) x.add('testRed', i * 1000)
    x.add('redStreak', 5000)
    x.add('redStreak', 6000)
    return x.level(6000) >= 1
  })())
  check('分数有上限（刷再多信号也不会无限涨）', (() => {
    const x = E.createEmpathy()
    for (let i = 0; i < 50; i++) x.add('textStrong', 0)
    return x.score(0) <= E.MAX_SCORE
  })())
}

console.log('\n编排器：观察者永远不挤占正常互动\n')
const calm = { chatLevel: 1, idle: true, hidden: false, panelOpen: false, bubbleVisible: false, asking: false, performing: false, pomoFocus: false, approval: false, danger: false, streaming: false, typingMs: Infinity, sinceUserMs: Infinity }
const note = { kind: 'note', tier: 'extra' }
{
  const why = (patch, c = note) => O.blockedReason({ ...calm, ...patch }, c)
  check('场面安静 → 放行', why({}) === null)
  check('安静档（chatLevel 0）一律不说', why({ chatLevel: 0 }) === 'quiet' && why({ chatLevel: 0 }, { kind: 'comfort', tier: 'extra' }) === 'quiet')
  check('话痨档才有的轻话（chatty）在普通档不说', why({}, { kind: 'note', tier: 'chatty' }) === 'tier' && why({ chatLevel: 2 }, { kind: 'note', tier: 'chatty' }) === null)
  check('agent 还在干活（中途）不说', why({ idle: false }) === 'busy' && why({ streaming: true, idle: true }) === 'stream')
  check('气泡被占着 / 她正在演别的 / 面板开着 / 她被收起来了：不说', why({ bubbleVisible: true }) === 'bubble' && why({ performing: true }) === 'performing' && why({ panelOpen: true }) === 'panel' && why({ hidden: true }) === 'hidden')
  check('正等着主人点按钮（提问）/ 批准 / 危险命令：不说', why({ asking: true }) === 'ask' && why({ approval: true }) === 'approval' && why({ danger: true }) === 'approval')
  check('主人正在打字（5 秒内有按键）/ 刚点过她（12 秒内）/ 番茄钟专注：不说', why({ typingMs: 2000 }) === 'typing' && why({ sinceUserMs: 5000 }) === 'recentUser' && why({ pomoFocus: true }) === 'focus')
  check('打字停了 5 秒、互动过了 12 秒后放行', why({ typingMs: 6000, sinceUserMs: 13000 }) === null)
  const care = { kind: 'care', tier: 'extra' }
  check('高风险关心：不受安静档 / 打字 / 配额限制，只避开「正等着点按钮」', why({ chatLevel: 0, typingMs: 100, sinceUserMs: 100, idle: false, bubbleVisible: true }, care) === null && why({ asking: true }, care) === 'ask')
}
{
  const o = O.createOrchestrator()
  check('槽是空的：什么都不做', o.take(0, calm) === null && !o.pending(0))
  check('递一个候选：收下；价值更低（或一样）的不能替换它，更高的可以', o.offer({ id: 'a', kind: 'note', tier: 'extra', value: 20 }, 0) && !o.offer({ id: 'b', kind: 'note', tier: 'extra', value: 20 }, 1) && !o.offer({ id: 'c', kind: 'note', tier: 'extra', value: 10 }, 1) && o.offer({ id: 'd', kind: 'comfort', tier: 'extra', value: 60 }, 2))
  check('被拦时返回原因、候选还留着等下一次', o.take(3, { ...calm, typingMs: 100 }).wait === 'typing' && o.pending(3))
  check('过期的候选自动丢掉（不补播）', (() => {
    const x = O.createOrchestrator()
    x.offer({ id: 'a', kind: 'note', tier: 'extra', ttlMs: 30000 }, 0)
    return x.take(29000, calm).go.id === 'a' && x.take(31000, calm) === null && !x.pending(31000)
  })())
  check('过期的旧候选不挡新候选（哪怕新的价值更低）', (() => {
    const x = O.createOrchestrator()
    x.offer({ id: 'old', kind: 'comfort', tier: 'extra', value: 80, ttlMs: 1000 }, 0)
    return x.offer({ id: 'new', kind: 'note', tier: 'extra', value: 5 }, 5000)
  })())
}
{
  const o = O.createOrchestrator()
  o.offer({ id: 'a', kind: 'note', tier: 'extra', value: 1 }, 0)
  const go = o.take(0, calm)
  check('放行 → 说完记 spoke：槽清空', go.go.id === 'a' && (o.spoke(0), !o.pending(0)))
  o.offer({ id: 'b', kind: 'note', tier: 'extra', value: 1 }, 10_000)
  check('配额：两次发言至少隔 90 秒（间隔内等着，不丢）', o.take(10_000, calm).wait === 'gap' && o.take(O.GAP_MS - 1, calm).wait === 'gap' && o.take(O.GAP_MS + 1, calm).go.id === 'b')
}
{
  const o = O.createOrchestrator()
  let t = 0
  let spoken = 0
  for (let i = 0; i < 20; i++) {
    o.offer({ id: 'n' + i, kind: 'note', tier: 'extra', value: 1, ttlMs: 200_000 }, t)
    const r = o.take(t, calm)
    if (r && r.go) {
      o.spoke(t)
      spoken++
    }
    t += O.GAP_MS + 1000
  }
  check('每小时上限：普通档 6 次，之后即使间隔够了也不说（话痨档 12 次）', spoken === 6 && (() => {
    const x = O.createOrchestrator()
    let tt = 0
    let n = 0
    for (let i = 0; i < 30; i++) {
      x.offer({ id: 'n' + i, kind: 'note', tier: 'extra', value: 1, ttlMs: 200_000 }, tt)
      const r = x.take(tt, { ...calm, chatLevel: 2 })
      if (r && r.go) { x.spoke(tt); n++ }
      tt += O.GAP_MS + 1000
    }
    return n === 12
  })(), `${spoken} 次`)
  check('一小时过去配额恢复', (() => {
    const x = O.createOrchestrator()
    for (let i = 0; i < 6; i++) x.spoke(i * 100_000)
    x.offer({ id: 'z', kind: 'note', tier: 'extra', value: 1, ttlMs: 10_000_000 }, 700_000)
    const blocked = x.take(700_000, calm)
    return blocked.wait === 'cap' && x.take(4_000_000, calm).go.id === 'z'
  })())
  check('高风险关心不占配额、不被配额拦，但会让随后的普通发言隔开一段', (() => {
    const x = O.createOrchestrator()
    for (let i = 0; i < 6; i++) x.spoke(i * 1000)
    x.offer({ id: 'care', kind: 'care', tier: 'extra', value: 100 }, 10_000)
    const a = x.take(10_000, calm)
    x.spoke(10_000, { care: true })
    x.offer({ id: 'n', kind: 'note', tier: 'extra', value: 1 }, 20_000)
    return a.go.id === 'care' && x.take(20_000, calm).wait !== undefined
  })())
}
{
  // 场景：一轮收工后她想夸一句，但主人立刻开始打字 / 点了她 → 要等到真的清静了才说；中途主人把她戳了一下（TOUCH）也不会被抢
  const o = O.createOrchestrator()
  o.offer({ id: 'tested', kind: 'note', tier: 'chatty', value: 15, ttlMs: 60_000 }, 0)
  const frames = [
    { t: 4_500, ctx: { ...calm, chatLevel: 2, bubbleVisible: true } }, // 收工那句还在
    { t: 9_500, ctx: { ...calm, chatLevel: 2, typingMs: 800 } }, // 主人开始打字
    { t: 14_500, ctx: { ...calm, chatLevel: 2, sinceUserMs: 3000 } }, // 刚戳过她
    { t: 19_500, ctx: { ...calm, chatLevel: 2, typingMs: 8000, sinceUserMs: 20_000 } }, // 清静了
  ]
  const res = frames.map((f) => o.take(f.t, f.ctx))
  check('收工后想夸一句：气泡占着 / 打字 / 刚互动都让路，清静了才说', res[0].wait === 'bubble' && res[1].wait === 'typing' && res[2].wait === 'recentUser' && res[3].go.id === 'tested')
}

console.log('\n复合故事：只用真的 hook 得到的信号\n')
const K = (o) => Object.fromEntries(Object.entries(o).map(([k, [ok, bad]]) => [k, { ok, fail: bad || 0 }]))
const base = { files: 0, reds: 0, greenAfterRed: false, lastTest: null, prevTest: null, okThenFail: false, cmdLoop: false, thrash: false, planDone: false, commitsToday: 1, longSession: false, blindComplaint: false, kinds: {} }
const story = (t) => S.storyOf({ ...base, ...t })
const notes = (t) => S.notesOf({ ...base, ...t })
const noteIds = (t) => notes(t).map((n) => n.id)
check('什么都没发生 / 命令都没有退出码（老宿主）→ 不说（宁可不说，不说错）', story({}) === null && notes({}).length === 0 && story({ kinds: K({ commit: [0], test: [0], push: [0] }), files: 3 }) === null)
check('改 → 测（绿）→ 提交：一条龙（flavor，顶替收工那句）', (() => { const s = story({ files: 3, lastTest: 'ok', kinds: K({ test: [1], commit: [1] }) }); return s.id === 'ship' && s.kind === 'flavor' })())
check('红了 ≥2 次后又绿了：调试战（最值得说，排第一）', (() => { const s = story({ files: 2, reds: 3, greenAfterRed: true, lastTest: 'ok', kinds: K({ test: [1, 3], commit: [1] }) }); return s.id === 'debugWin' })())
check('只红了一次就绿：不算调试战', (story({ reds: 1, greenAfterRed: true, lastTest: 'ok', kinds: K({ test: [1, 1] }) }) || {}).id !== 'debugWin')
check('push 成功 → push；提交成功（测试没红）→ commit；失败不庆祝', story({ kinds: K({ push: [1] }) }).id === 'push' && story({ kinds: K({ commit: [1] }) }).id === 'commit' && story({ kinds: K({ commit: [0, 1] }) }) === null && story({ kinds: K({ push: [0, 1] }) }) === null)
check('装依赖 + 构建成功：搭环境（flavor）；只装依赖不说', story({ kinds: K({ install: [1], build: [1] }) }).id === 'env' && story({ kinds: K({ install: [1] }) }) === null)
check('全部 flavor 都是 core（顶替收工那句，不增加发言）', ['debugWin', 'ship', 'rollback', 'planDone', 'push', 'commit', 'env'].every((id) => S.STORY_MOOD[id]))

console.log('\nvibe coding 的经典流程与经典翻车\n')
check('流程：先计划（plan 模式）+ 清单（≥3 项）全划掉 → 「先计划再动手」（flavor）', story({ planDone: true }).id === 'planDone' && story({ planDone: false }) === null)
check('翻车「慌了就回滚」：git reset / checkout / restore / revert / stash 成功 → 「回滚不丢人」（flavor）；回滚失败不说', story({ kinds: K({ rollback: [1] }) }).id === 'rollback' && story({ kinds: K({ rollback: [0, 1] }) }) === null)
check('翻车「改一个 bug 出三个」：上一轮是绿的、这一轮改完变红 → regression（比普通红着收工更对症）', noteIds({ lastTest: 'fail', prevTest: 'ok' })[0] === 'regression' && !noteIds({ lastTest: 'fail', prevTest: 'ok' }).includes('redEnd'))
check('……这一轮里先绿后红同理；一直红着（没绿过）才是普通的 redEnd', noteIds({ lastTest: 'fail', okThenFail: true })[0] === 'regression' && noteIds({ lastTest: 'fail' })[0] === 'redEnd')
check('翻车「原地打转」：同一条命令失败 ≥3 次 → cmdLoop；同一个文件改 ≥5 次 → thrash', noteIds({ cmdLoop: true }).includes('cmdLoop') && noteIds({ thrash: true }).includes('thrash') && !noteIds({}).includes('cmdLoop'))
check('翻车「过早宣布完成」：上一轮改完没验证、主人刚抱怨 → 最对症（价值最高）', noteIds({ blindComplaint: true, lastTest: 'fail', prevTest: 'ok', cmdLoop: true })[0] === 'blindComplaint')
check('翻车「幻觉依赖」：装不上（失败且没装成过）→ installFail；装成过就不说', noteIds({ kinds: K({ install: [0, 1] }) }).includes('installFail') && !noteIds({ kinds: K({ install: [1, 1] }) }).includes('installFail'))
check('翻车「上下文腐烂」：会话压缩过好几次 / 聊了很多轮 → longSession（建议换新会话）', noteIds({ longSession: true }).includes('longSession') && !noteIds({}).includes('longSession'))
check('流程「提交当存档点」：绿了、改了 ≥3 个文件、今天还没提交过 → checkpoint；已经提交过就只夸「改完就测」', noteIds({ files: 3, lastTest: 'ok', commitsToday: 0 }).includes('checkpoint') && noteIds({ files: 3, lastTest: 'ok', commitsToday: 2 }).includes('tested') && !noteIds({ files: 3, lastTest: 'ok', commitsToday: 2 }).includes('checkpoint'))
check('这一轮已经提交了就不再催「提交存档」', !noteIds({ files: 3, lastTest: 'ok', commitsToday: 0, kinds: K({ commit: [1] }) }).some((i) => i === 'checkpoint' || i === 'tested'))
check('测试还红着就提交：不庆祝、只轻轻记一笔；改了很多文件没跑测试：noTest', noteIds({ lastTest: 'fail', kinds: K({ test: [0, 1], commit: [1] }) }).includes('redCommit') && noteIds({ files: 9 }).includes('noTest') && !noteIds({ files: 3 }).includes('noTest'))
check('所有 note 都是话痨档、按价值从高到低排序（编排器槽里只留最高的一条）', (() => { const n = notes({ blindComplaint: true, lastTest: 'fail', prevTest: 'ok', cmdLoop: true, thrash: true, files: 9, longSession: true }); return n.length >= 5 && n.every((x) => x.kind === 'note' && x.tier === 'chatty') && n.every((x, i) => i === 0 || n[i - 1].value >= x.value) })())
check('每个故事 / 安慰 / 收工 / 休息 / 安全提醒的台词都存在、不超长', (() => {
  const ids = ['storyShip', 'storyPush', 'storyCommit', 'storyDebugWin', 'storyEnv', 'storyTested', 'storyRedCommit', 'storyRedEnd', 'storyNoTest', 'storyPlanDone', 'storyRollback', 'storyRegression', 'storyCmdLoop', 'storyThrash', 'storyUnverified', 'storyCheckpoint', 'storyInstallFail', 'storyLongSession', 'secretAdd', 'finishRelief', 'restartAfterFail', 'breakStart', 'breakEnd', 'breakNo', 'careGentle', 'careHelp', ...Object.values(E.COMFORT_SAY)]
  return ids.every((id) => Array.isArray(SCENE_LINES[id]) && SCENE_LINES[id].length >= 1 && SCENE_LINES[id].every((s) => s.length <= 28 && (s.match(/（/g) || []).length <= 1))
})())
check('安慰先承接情绪、不说教：安慰台词里没有「应该」「必须」「你要」之类的指令口吻', Object.values(E.COMFORT_SAY).every((id) => SCENE_LINES[id].every((s) => !/应该|必须|你要|你得|不要再/.test(s))))
check('建议类台词用商量口吻（问句 / 「要不要」/「先…」），不下命令', ['storyRegression', 'storyCmdLoop', 'storyThrash', 'storyUnverified', 'storyCheckpoint', 'storyInstallFail', 'storyLongSession'].every((id) => SCENE_LINES[id].every((s) => !/必须|应该|不许|立刻/.test(s))))
check('高风险回应：不玩梗（没有「才怪」「哈」「嘿嘿」），并提醒找身边的人', SCENE_LINES.careGentle.every((s) => !/才怪|哈|嘿|梗/.test(s)) && /身边|聊聊/.test(SCENE_LINES.careHelp.join('')))

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`)
process.exit(fail > 0 ? 1 : 0)
