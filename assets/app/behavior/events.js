/** behavior/events.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { bondMemory, bondRefresh, handleEvents as handleBondEvents } from './bond.js'
import { wakeUp } from './idle.js'
import { playAction } from './menu-actions.js'
import { TYPING } from './page.js'
import { onTurnFinished } from './routine.js'
import { noteReplyText, reactToUserText, replyMood } from './sentiment.js'
import { handleSev, sessionCreated } from './sev.js'
import { devToolCall, devToolResult, devTurnDone, diaryState } from './dev.js'
import { empathyComforted, empathySignal, observeCommand, observeToolCall, observeTurnEnd, observeTurnStart, observeUserMsg } from './observe.js'
import { noteAskDone, noteAskUser, noteThinking, stopThinking } from './soul.js'
import { BASE, CFG } from '../config.js'
import { EXPR, R, activeSubagents, agent } from '../core/state.js'
import { log, pick, pickFresh } from '../core/util.js'
import { FLAG, approvalAsked, approvalDecided, longToolTimers, resetTurnFlags, retryCleared, syncConds } from '../director/conds.js'
import { FILE_TOOLS, digest, finishFlavor, resetDigest } from '../director/digest.js'
import { PRI, noteUser, perform, performingNow, yieldTo } from '../director/perform.js'
import { qBounce } from '../engine/effects.js'
import { gaze, gazeDetach } from '../engine/gaze.js'
import { playMotion } from '../engine/motion.js'
import { clearProps, rig, setBase, setProp } from '../engine/rig.js'
import { device, endWork, putDeviceAway, startWork } from '../engine/work.js'
import { IDLE_PROPS, WORK_PROPS } from '../persona/items.js'
import { isSecretAdd } from '../persona/devhooks.js'
import { isDangerous } from '../persona/keywords.js'
import { lineFor } from '../persona/lines.js'
import { SAY } from '../persona/say.js'
import { START_STICKER, STICKY_GAP_MS, THINKING_STICKER, TOOL_STICKER } from '../persona/stickers.js'
import { DEVICE_TOOLS, TOOL_LINE, TOOL_REACT, randomGlasses, toolHint } from '../persona/tools.js'
import { hud, hudFetch, hudPopTurnEnd, hudRender } from '../ui/hud.js'
import { closePanels } from '../ui/panels.js'

/** 收工表演 → 对应的回忆（第一次触发时记进回忆册）。 */
/** 本来就会跑很久的工具：它们回来得慢不算「摸鱼」。 */
const SLOW_OK_TOOLS = new Set(['ask_user_question', 'subagent', 'subagent_fork', 'workflow', 'ralph'])

const FINISH_MEMORY = { 'finish-goal': 'goal', 'finish-deliver': 'selfie', 'finish-todo': 'todo-clear', 'finish-recover': 'recover' }

export function connectSSE() {
  let es = null
  let retry = 0
  const open = () => {
    es = new EventSource(BASE + '/events')
    es.onopen = () => {
      retry = 0
      log('事件流已连接')
    }
    es.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch (e) {
        return
      }
      try {
        handleEvent(msg)
      } catch (err) {
        console.warn('[鲸鱼娘] 事件处理出错', msg && msg.t, err)
      }
    }
    es.onerror = () => {
      try {
        es.close()
      } catch (e) {}
      retry++
      setTimeout(open, Math.min(10000, 800 * retry))
    }
  }
  open()
}

function setStatus(next) {
  if (agent.status === next) return
  agent.status = next
  agent.lastActivity = Date.now()
  agent.sleeping = false
}

/* 「复述对话原文」开关（默认关）在本机就是**安静模式**，管两件事：
 *   1. 对话原文——'user'（你的原话）与 'delta'/'assistant'（她的回复原文）；
 *   2. 过程流水账——工具目标路径、工具名脚注、「正在思考 · 第 N 步」、
 *      分身提示。见 noteProcess()。
 * 她自己的台词（SAY./TOOL_LINE）、表情、动作、报错文案、余额 HUD 不受影响；
 * 结算那行「耗时 · N tokens」也不受影响——主人反馈这行占地方小、爱看，
 * 跟「复述对话原文」那种大段文字不是一回事，单独在 turn-end 里直接拼，
 * 不走 sayChat()/noteProcess() 这道安静模式的门。 */
function sayChat(text, opts) {
  if (!CFG.repeatChat) return
  R.ui.bubble.show(text, opts)
}

/* 过程脚注统一走这道门：安静模式下不写流水账。
 * 只压 note（脚注/小结），不碰 ui.bubble.show 的台词正文。 */
export function noteProcess(text) {
  if (!CFG.repeatChat) return
  R.ui.bubble.note(text)
}

export function handleEvent(m) {
  switch (m.t) {
    case 'hello':
      agent.status = m.status || 'idle'
      break

    case 'user':
      TYPING.sentAt = performance.now()
      observeUserMsg()
      noteUser()
      setStatus('listening')
      rig.talking = false
      wakeUp()
      yieldTo(PRI.AMBIENT) // 只清待机级；已经在演的提示 / 报错 / 戳不被这一句顶掉
      setBase('listening', IDLE_PROPS)
      clearToolProp()
      sayChat(String(m.text || '').slice(0, 300), { name: '你', ttl: 3500 })
      reactToUserText(String(m.text || ''))
      break

    case 'turn-start': {
      agent.turn = m.turn
      agent.hasStream = false
      agent.lastText = ''
      agent.tokens = 0
      resetDigest()
      observeTurnStart() // 这一轮的账清零（命令成败 / 红绿，只记账不说话）
      resetTurnFlags()
      setStatus('thinking')
      rig.talking = false
      startWork()
      yieldTo(PRI.AMBIENT)
      setBase('thinking', WORK_PROPS)
      // 刚有一句更重要的话（关键词反应 / 问候）在气泡里，就别马上拿「好啦好啦」顶掉它
      const busyNow = performingNow()
      if (!busyNow || busyNow.pri === PRI.AMBIENT || busyNow.pri === PRI.TOUCH) {
        R.ui.bubble.show(pick(SAY.start), { name: '鲸鱼娘', busy: true, sticky: true, stickerHint: { pool: START_STICKER, gapMs: STICKY_GAP_MS } })
      }
      break
    }

    case 'step-start':
      agent.step = m.step
      setStatus('thinking')
      rig.talking = false
      if (!R.ui.bubble.visible) {
        R.ui.bubble.show(pickFresh(SAY.thinking, 'thinking'), { name: '鲸鱼娘', busy: true, sticky: true, stickerHint: { pool: THINKING_STICKER, gapMs: STICKY_GAP_MS } })
      } else {
        noteProcess('正在思考 · 第 ' + m.step + ' 步')
      }
      break

    case 'delta':
      // 深度思考：reasoning 增量宿主一直在推。默认不显示内容，但「她在想」这个事实可以演一张表情包
      if (m.kind === 'reasoning') noteThinking()
      else stopThinking()
      if (m.kind === 'reasoning' && !CFG.showReasoning) return
      agent.lastActivity = Date.now()
      if (!agent.hasStream) {
        agent.hasStream = true
        retryCleared(true) // 重试之后又出字了 = 恢复了
        setStatus('speaking')
        rig.talking = true
        setBase(replyMood(), WORK_PROPS)
        sayChat('', { name: '鲸鱼娘', stream: true, sticky: true })
      }
      if (m.kind !== 'reasoning') noteReplyText(m.text || '')
      sayChat(m.text || '', { stream: true, sticky: true })
      break

    case 'assistant':
      stopThinking()
      agent.hasStream = false
      rig.talking = false
      if (m.interrupted) break
      if (m.text) {
        retryCleared(true)
        setStatus('speaking')
        agent.lastText = m.text.slice(0, 4000)
        sayChat(agent.lastText, { name: '鲸鱼娘', sticky: true })
      }
      if (m.usage) {
        const t = (m.usage.input || 0) + (m.usage.cache || 0) + (m.usage.output || 0)
        agent.tokens = (agent.tokens || 0) + t
        noteProcess('本轮 ' + t.toLocaleString() + ' token')
      }
      break

    case 'tool-call': {
      stopThinking()
      devToolCall(m) // 认出「提交 / push / 测试…」这类开发动作（结果回来再反应）
      observeToolCall(m) // 改文件工具：同一个文件被改了几次（只记哈希）
      setStatus('working')
      rig.talking = false
      const react = TOOL_REACT[m.name] || { mood: 'reading', prop: 'glassesRound' }
      yieldTo(PRI.AMBIENT) // 切模式前先收掉待机级的一次性表演；提示 / 报错 / 戳的让它演完
      digest.tools++
      if (FILE_TOOLS.test(String(m.name || ''))) digest.files++
      // 阅读类才低头看本子
      gaze.biasTarget = react.mood === 'reading' ? -0.32 : 0
      const isDevice = DEVICE_TOOLS.has(m.name)
      // 常态：本子 + 笔。查资料时**笔换成手机**（把手里的笔放下，掏出小设备），
      // 看完自动关掉、把笔换回来。用的都是模型自带素材，不自己编。
      const propKey = react.prop === 'auto' ? randomGlasses() : react.prop
      setBase(
        react.mood,
        isDevice ? ['menuBoard'] : WORK_PROPS.concat(propKey ? [propKey] : []),
      )
      if (isDevice) {
        if (!device.out) {
          device.out = true
          playMotion('openLid')
        }
      } else if (device.out) {
        putDeviceAway()
      }
      gazeDetach(1400)
      // 台词按工具轮换（同一个工具连着用也不会重复），第二行是**具体在干什么**，
      // 脚注标出工具名——这样 Agent 里在跑什么，桌宠这边能同步看出来。
      const pool = TOOL_LINE[m.name] || (react.lean ? SAY.reading : SAY.working)
      const line = pickFresh(pool, 'tool-' + m.name)
      // 第二行「具体在干什么」（目标路径 / 文件名）算过程流水账：安静模式下不写
      const hint = CFG.repeatChat ? toolHint(m.args) : ''
      R.ui.bubble.show(line + (hint ? '\n' + hint : ''), {
        name: '鲸鱼娘',
        busy: true,
        sticky: true,
        // 提问 / 看图是「有意义的事件」，每次都配；其余工具的常驻气泡节流（gapMs），干活时图不会一直在换
        stickerHint: TOOL_STICKER[m.name] && (m.name === 'ask_user_question' || m.name === 'read_image'
          ? { sticker: TOOL_STICKER[m.name] }
          : { pool: TOOL_STICKER[m.name], gapMs: STICKY_GAP_MS }),
      })
      if (m.name === 'ask_user_question' && m.callId) noteAskUser(m.callId) // 问了主人，等太久就摇铃
      noteProcess(m.label || m.name)

      // 工具跑太久：30 秒「偷偷摸鱼」，90 秒「我去睡了，明早应该就好了」（梗：思考链里的下班名场面）
      if (m.callId) {
        // 注意：工具卡在「等批准」时也算「还没返回」，那时该举牌催人，不该摸鱼——所以要跳过
        const slow = [
          setTimeout(() => {
            if (FLAG.approval < 0) perform({ id: 'long-tool-1', pri: PRI.CUE, tier: 'extra', mood: 'smug', say: 'longTool1', ms: 3600, cool: 60000 })
          }, 30000),
          setTimeout(() => {
            if (FLAG.approval < 0) perform({ id: 'long-tool-2', pri: PRI.CUE, tier: 'chatty', mood: 'sleepy', say: 'longTool2', ms: 3600, cool: 120000 })
          }, 90000),
        ]
        longToolTimers.set(m.callId, slow)
      }
      // 密钥要进提交（git add .env / 私钥）：和危险命令一样是少数可以在中途出声的安全提醒，只提醒不拦截
      if (CFG.devHooks !== false && isSecretAdd(m.name, m.args)) perform({ id: 'secret-add', pri: PRI.ALERT, tier: 'core', mood: 'alert', say: 'secretAdd', ms: 3800, cool: 20000, habit: false })
      // 危险命令：只提醒不拦截。放在最后，免得上面那句工具台词把这句顶掉
      if (isDangerous(m.name, m.args)) {
        FLAG.danger = m.callId || 'x'
        syncConds()
        perform({ id: 'danger', pri: PRI.ALERT, tier: 'core', mood: 'alert', say: 'danger', ms: 3600, cool: 8000, habit: false })
      }
      break
    }

    case 'tool-result': {
      noteAskDone(m.callId)
      clearToolProp()
      const slow = longToolTimers.get(m.callId)
      if (slow) {
        slow.forEach(clearTimeout)
        longToolTimers.delete(m.callId)
      }
      if (FLAG.danger && (FLAG.danger === m.callId || FLAG.danger === 'x')) {
        FLAG.danger = null
        syncConds()
      }
      if (m.error) {
        digest.errors++
        // 工具报错只是「黑一下脸」，很短，而且不叠任何别的东西（主人说「大锤砸头」那个不要了）
        perform({
          id: 'tool-error', pri: PRI.ALERT, tier: 'core', habit: false,
          mood: 'gloomy',
          props: [],
          exclusive: true,
          line: '（脸黑了）这个工具报错了：' + (m.error.name || m.error.code || '未知'),
          ms: 1600,
        })
      } else {
        setStatus('thinking')
        yieldTo(PRI.AMBIENT)
        putDeviceAway()
        setBase('thinking', WORK_PROPS)
        // 一个工具跑了 30 秒以上才回来（慢工具；等人回话 / 分身 / 工作流本来就久，不算）：之前「带薪拉屎」摸鱼去了，这下回来散味
        if (m.ms >= 30000 && !SLOW_OK_TOOLS.has(m.name)) {
          perform({ id: 'long-tool-done', pri: PRI.CUE, tier: 'extra', mood: 'happy', say: 'longToolDone', ms: 3000, cool: 60000 })
        }
      }
      // 开发命令的结果：**只记账、不说话**（一轮中途插话最容易被关掉）。成败进这一轮的账，复合故事在一轮结束时才出（observe.js）
      const cmd = devToolResult(m)
      if (cmd) observeCommand(cmd.kind, cmd.outcome, cmd.fp)
      if (m.error) empathySignal('toolError')
      break
    }

    case 'hud-turn': {
      // 宿主已经把这一轮的账算好了，先把数据刷新——主人反馈这个面板
      // 「太大了占半个屏幕」，不想每轮自动弹，所以只刷数据不自动开。
      // 要看就右键叫出来，看到的是这里已经刷好的最新数字。
      if (m.turn) {
        hud.turn = Object.assign({ ok: true }, m.turn)
        hud.seq = m.turn.seq || hud.seq
        if (!hud.data) hudFetch(false)
        else hudRender()
      }
      break
    }

    case 'turn-end': {
      stopThinking()
      noteAskDone()
      const kind = (m.reason && m.reason.kind) || m.reason || 'completed'
      rig.talking = false
      agent.hasStream = false
      clearToolProp()
      setStatus('idle')
      endWork()
      // ★ 关键：一轮结束必须把**底层状态**也复位成「平常」。
      // 之前只做了 setStatus('idle')，底层还停在最后那个工具的脸
      // （比如「调皮」会闭一只眼），于是看起来就像「平常动作被挤眼睛占住了」。
      setBase('neutral', IDLE_PROPS)

      // 主人要的：每轮结束都把「本轮消耗」弹出来（独立面板，9 秒后自己收）。
      // 宿主通常已经推了 hud-turn（那条会立刻弹）；这里只是兜底，晚一点再拉一次余额。
      hudPopTurnEnd()

      // 这一轮属于「批准 / 重试 / 危险命令 / 工具慢」的状态到此为止
      resetTurnFlags()

      // 结算那行：清单进度 · 动笔次数 · 已深度思考（用时 N 秒）· tokens
      // （「已深度思考（用时 N 秒）」是 DeepSeek 用户都认得的那句，短于 8 秒的轮次不装）
      const secs = m.ms ? (m.ms / 1000).toFixed(1) + 's' : ''
      const stat = []
      if (digest.todoTotal > 0) stat.push(`清单 ${digest.todoDone}/${digest.todoTotal}`)
      if (digest.files > 0) stat.push(`动笔 ${digest.files} 次`)
      if (m.ms >= 8000) stat.push(`已深度思考（用时 ${Math.round(m.ms / 1000)} 秒）`)
      else if (secs) stat.push(secs)
      if (m.tokens) stat.push(m.tokens.toLocaleString() + ' token')

      // 连续失败 / 失败后终于过了——这两件事要「站在主人这边」，不是自嘲
      if (kind === 'completed') {
        FLAG.recovered = FLAG.fails > 0
        FLAG.fails = 0
      } else if (kind === 'error') {
        FLAG.fails++
      }
      // 复合故事 + 心情（任务边界）：flavor 顶替收工那句，note / 安慰递给编排器排队，过了闸才说
      const obs = observeTurnEnd({ kind, files: digest.files, errors: digest.errors, todoAll: digest.todoTotal >= 3 && digest.todoDone === digest.todoTotal, commitsToday: diaryState().commit })

      if (kind === 'completed') {
        // 庆祝：开心脸 + 伸个懒腰 + 一个装饰（猫耳/兔耳/花花随机一个）+ 一句台词。
        // 刻意只叠「一个动作 + 一个装饰」，而且几秒后自己连开关一起收掉。
        // 庆祝只做三件事：开心脸 + 一个装饰 + 一句台词，再加一个纯 CSS 的「蹦一下」。
        // 刻意**不播 aidale**：那个「伸展」动作内部驱动 15 个表情参数
        // （呆呆眼/哭/开心/晕晕/感叹号），一播就会同时点亮好几个表情，
        // 看起来就是「砸完头之后表情全乱了」。qBounce 不碰任何模型参数。
        qBounce(1.2)
        // 主人要求：刚输出的文字要**停留一下**，别被结算立刻顶掉。
        // 所以先只做表情+装饰的庆祝，文字留在气泡里；过两秒多再把结束台词接上。
        const keepText = R.ui.bubble.visible && !!agent.lastText
        // 一轮只演一个收工表演：目标达成 > 交付物 > 失败后终于过了 > 清单全完 > 重活 > 默认
        const flavor = finishFlavor(m.ms, m.tokens, obs)
        devTurnDone({ files: digest.files, recovered: FLAG.recovered }) // 今日小账：只记次数
        if (flavor && FINISH_MEMORY[flavor.id]) bondMemory(FINISH_MEMORY[flavor.id])
        const statText = stat.join(' · ')
        if (flavor && flavor.action) {
          playAction(flavor.action, { pri: PRI.FINISH, id: flavor.id, say: flavor.say, line: keepText ? null : undefined })
          if (statText) R.ui.bubble.note(statText)
        } else if (flavor) {
          perform({
            id: flavor.id, pri: PRI.FINISH, tier: 'core', habit: false, mood: flavor.mood, props: flavor.props,
            heart: !!flavor.heart, ms: 3200,
            line: keepText ? null : lineFor(flavor.say) + (statText ? '\n' + statText : ''),
          })
          if (keepText && statText) R.ui.bubble.note(statText)
        } else {
          perform({
            id: 'finish', pri: PRI.FINISH, tier: 'core', habit: false, mood: 'happy',
            props: [pickFresh(['stickerCat', 'stickerRabbit', 'flower', 'heartbeat'], 'celebrate')],
            // 结算那行主人要求不跟安静模式走——占地方小，就爱看这个，
            // 安静模式压的是「你问了什么/她回了什么」那种大段复述，不是这个。
            line: keepText ? null : pickFresh(SAY.done, 'done') + (statText ? '\n' + statText : ''),
            ms: 3000,
          })
          if (keepText && statText) R.ui.bubble.note(statText)
        }
        if (keepText) {
          // 刚输出的文字停留一下，再把收工台词接上（飘在同一个气泡里，不另起一次表演）
          const tail = flavor ? lineFor(flavor.say) : pickFresh(SAY.done, 'done')
          setTimeout(() => {
            if (agent.status !== 'idle') return
            // 这 2.8 秒里如果主人已经点了别的（讲故事、投喂、戳她……），别把人家的气泡顶掉
            const cur = performingNow()
            if (R.ui.bubble.asking || (cur && cur.pri > PRI.FINISH)) return
            // 收工台词接在后面时也要配图（以前这一句没带选图线索，收工表情包就出不来）
            R.ui.bubble.show(tail, { name: '鲸鱼娘', ttl: 4200, stickerHint: { say: flavor && flavor.say, id: flavor && flavor.id, mood: 'happy' } })
          }, 2800)
        }
        onTurnFinished(m)
      } else if (kind === 'aborted') {
        perform({ id: 'finish-abort', pri: PRI.ALERT, tier: 'core', habit: false, mood: 'sad', line: pickFresh(['诶…人家还没做完呢', '被打断了…', '这次只写了一部分！剩下的……下次一定'], 'abort'), ms: 2800 })
      } else if (kind === 'error') {
        const em = (m.reason && m.reason.error && m.reason.error.message) || '出错了'
        // 连着失败 2 次以上（或一轮里报了 3 次以上错）：不再自嘲，站在主人这边把锅给 bug
        const streak = FLAG.fails >= 2 || digest.errors >= 3
        if (streak) empathyComforted() // 下面那句「站在主人这边」就是安慰，别紧接着再安慰一次
        // 失败升级序列（梗按真实含义用）：第 1 次「停止工作」弹窗 → 连着 2 次/同轮报错≥3 次「坐牢」→ 连着 3 次以上「一切都好」
        const ladder = FLAG.fails >= 3 ? 'fine' : streak ? 'jail' : 'stopped'
        const sticker = ladder === 'fine' ? pickFresh(['fine1', 'fine2'], 'fail-fine') : ladder === 'jail' ? 'jail' : 'stopped'
        const failLine = ladder === 'fine' ? lineFor('failFine') : ladder === 'jail' ? lineFor('failJail') : streak ? lineFor('streakFail') : pickFresh(SAY.fail, 'fail')
        const shown = perform({
          id: 'finish-fail', pri: PRI.ALERT, tier: 'core', habit: false,
          mood: streak ? 'sad' : pick(['sweat', 'sad']),
          sticker,
          line: failLine + '\n' + String(em).slice(0, 160),
          ms: 3200,
        })
        if (shown && ladder === 'jail') bondMemory('jail', 3500) // 一起坐过牢
        if (shown && ladder === 'fine') bondMemory('this-is-fine', 3500)
        // 错误详情让这条气泡超过了「短台词」的长度，所以图单独附着上去（播完 ≤4s 淡出）
        if (shown && !R.ui.bubble.stickerSrc) R.ui.bubble.sticker(sticker, {})
      } else {
        perform({ id: 'finish-other', pri: PRI.ALERT, tier: 'core', mood: 'pout', ms: 2600 })
      }
      break
    }

    case 'subagent': {
      const before = activeSubagents.size
      if (m.active && m.sessionId) activeSubagents.add(m.sessionId)
      else if (m.sessionId) activeSubagents.delete(m.sessionId)
      const now = activeSubagents.size
      if (now === before) {
        // 数量没变，只是同一批分身又发了句别的——文案跟着当前数量走就行
        if (m.active && R.ui.bubble.visible) noteProcess(now > 1 ? `${now} 个分身一起在干活…` : '分身也在干活…')
        break
      }
      syncConds() // 头顶蹲一只鲸（叫同类来帮忙）；分身全结束就摘
      if (now > before) {
        if (now > 1) qBounce(0.6) // 一下子两个以上：比刚才更热闹
        perform({ id: 'subagent', pri: PRI.CUE, tier: 'extra', mood: 'excited', say: now === 1 ? 'subagent1' : 'subagentN', ms: 2400, cool: 8000 })
        if (R.ui.bubble.visible) noteProcess(now === 1 ? '分身也在干活…' : `${now} 个分身一起在干活，忙死啦`)
      }
      break
    }

    case 'approval':
      // 批准等待是个会升级的「状态」（问号 → 感叹号 → 流汗 → 打瞌睡），不是一句话
      if (m.state === 'asked') approvalAsked()
      else approvalDecided(m.outcome)
      break

    case 'sev':
      handleSev(m)
      break

    case 'title':
      // 会话起好名字了（标题内容不进台词）：等收工的动静过去、她闲下来再轻轻提一句，只有话痨档
      setTimeout(() => {
        if (agent.status !== 'idle' || performingNow() || R.ui.bubble.visible) return
        perform({ id: 'title-set', pri: PRI.CUE, tier: 'chatty', mood: 'happy', say: 'titleSet', ms: 2400, cool: 120000 })
      }, 4500)
      break

    case 'session':
      sessionCreated(m)
      break

    case 'bond':
      // 宿主在一轮结束时结算了羁绊：把「解锁回忆 / 连续天数」演出来，并拉一份新快照（可能进入了「待晋级」）
      handleBondEvents(m.events)
      bondRefresh()
      break

    case 'control':
      handleControl(m)
      break
  }
}

/** 干活时顺手戴的道具，一轮结束就摘掉；用户自己戴的不动。 */
/**
 * 上一版「手动戴/摘工具道具」的遗留。现在道具由 base/override/user 三层解析，
 * 一次性道具随 override 一起过期，不存在「忘了摘」的情况；保留成空操作只是
 * 为了少改调用点。
 */
function clearToolProp() {}

/** 外部（用户菜单，或 agent 自己调 /dsh-pet/control）驱动的表演。 */
function handleControl(m) {
  if (m.clearProps) clearProps()
  if (m.props && typeof m.props === 'object') {
    for (const [k, v] of Object.entries(m.props)) setProp(k, !!v)
  }
  if (m.expression !== undefined) {
    rig.face = m.expression === null || !EXPR[m.expression] ? null : m.expression
    R.mood = 'custom'
    rig.dirty = true
  }
  if (m.mood != null || m.expression) {
    perform({ id: 'control', pri: PRI.EXPLICIT, tier: 'core', habit: false, mood: m.mood, face: m.expression, ms: m.bubbleMs || 5000 })
  }
  if (m.motion) playMotion(m.motion)
  const text = m.say || m.bubble
  if (text) R.ui.bubble.show(String(text), { name: '鲸鱼娘', ttl: m.bubbleMs || 5000 })
  if (m.attention) {
    R.ui.root.classList.add('dshp-open')
    setTimeout(() => closePanels(), 3000)
  }
}
