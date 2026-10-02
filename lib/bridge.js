/**
 * 事件桥：把 DSH 会话里的真实活动（轮次 / 思考 / 工具 / 逐字流 / 批准 / 清单…）
 * 通过 SSE 推给前端，让桌宠和 agent 的状态真正同步；顺带结算钱包与羁绊。
 *
 * 会话归属：桌宠只关心「人正在用的那个会话」，子代理的会话不能抢气泡。
 * primarySessionId 由真实人类 prompt（source.kind === 'user'）确定。
 */

import fs from 'node:fs'
import path from 'node:path'
import { TRACE_ON, TRACE_FILE } from './paths.js'
import { readConfig } from './config.js'
import { textOf } from './text.js'
import { TOOL_LABELS } from './events/labels.js'
import { slimSessionEvent, TRACE_TYPES } from './events/slim.js'
import { isPeakTime, priceTier, costOf, customPriceTier, matchesEventKeywords } from './wallet/pricing.js'

/**
 * @param {{ ctx: any, disposers: Function[], walletSvc: any, stats: any, bond: any }} deps
 */
export function createBridge({ ctx, disposers, walletSvc, stats, bond }) {
  const { wallet, fetchBalance, addTodayTokens } = walletSvc

  /** 每一轮里的「大事」：交付物 / 目标达成。轮次结束时交给羁绊引擎（大功告成加分）。 */
  const turnFacts = new Map() // sessionId -> { deliverables, goalDone }
  function noteFacts(sessionId, slim) {
    const f = turnFacts.get(sessionId) || { deliverables: 0, goalDone: false }
    if (slim.k === 'deliver') f.deliverables += Number(slim.count) || 1
    if (slim.k === 'goal' && slim.phase === 'complete') f.goalDone = true
    turnFacts.set(sessionId, f)
  }
  /** 一轮结束：羁绊结算，并把「待晋级 / 解锁回忆 / 连续天数」这类事件推给前端。 */
  function settleBond(sessionId, reason, tokens) {
    const kind = (reason && reason.kind) || reason || 'completed'
    const outcome = kind === 'completed' ? 'completed' : kind === 'error' ? 'error' : 'aborted'
    const f = turnFacts.get(sessionId) || { deliverables: 0, goalDone: false }
    turnFacts.delete(sessionId)
    try {
      const r = bond.onTurn({ tokens, outcome, deliverables: f.deliverables, goalDone: f.goalDone, totalTurns: stats.get().totalTurns })
      broadcast({ t: 'bond', events: r.events, brief: bond.brief() })
    } catch (err) {
      /* 羁绊结算出错不能影响主流程 */
    }
  }

  /** SSE 客户端集合。每个连接一个 res。 */
  const clients = new Set()
  let seq = 0

  function broadcast(payload) {
    if (!clients.size) return
    const frame = `id: ${++seq}\ndata: ${JSON.stringify(payload)}\n\n`
    for (const res of clients) {
      try {
        res.write(frame)
      } catch (err) {
        clients.delete(res)
      }
    }
  }

  /**
   * 会话归属。桌宠只关心“人正在用的那个会话”，子代理的会话不能抢气泡。
   * primarySessionId 由真实人类 prompt（source.kind === 'user'）确定。
   */
  let primarySessionId = null
  let lastSessionId = null
  const sessionState = new Map() // sessionId -> { status, turn, step }

  function stateOf(sessionId) {
    let s = sessionState.get(sessionId)
    if (!s) {
      s = { status: 'idle', turn: 0, step: 0, busySince: 0 }
      sessionState.set(sessionId, s)
    }
    return s
  }

  /** 探测日志：只在 DSH_PET_TRACE=1 时用，把原始载荷追加到 TRACE_FILE，过长的只留标记。 */
  function traceEvent(sessionId, type, data) {
    try {
      let line = JSON.stringify({ ts: Date.now(), sessionId, type, data })
      if (line.length > 6000) line = JSON.stringify({ ts: Date.now(), sessionId, type, truncated: line.length })
      fs.mkdirSync(path.dirname(TRACE_FILE), { recursive: true })
      fs.appendFileSync(TRACE_FILE, line + '\n', 'utf8')
    } catch (err) {}
  }

  /** 桌宠只对主会话做完整反应；其它会话（子代理）只发一个轻量的“分身”信号。 */
  /**
   * 子代理 / 定时任务 / 工作流之类「不是人在用」的会话。由 session/created 的 origin 与 delegationDepth 判定。
   * 「选择类」事件（换模型、改权限、换智能体预设…）要在人**发第一条消息之前**就能反应——
   * 用户新建会话、先选好模型再发话，这时 primarySessionId 还停在上一个会话上，不放行就整个丢了。
   */
  const nonHumanSessions = new Set()
  const NON_HUMAN_ORIGIN = /subagent|fork|workflow|team|agent|schedule|job|webhook|cron/i
  const SELECTION_KINDS = new Set(['model', 'sandbox', 'preset', 'persona', 'command', 'schedule'])
  function isPrimary(sessionId) {
    if (primarySessionId) return sessionId === primarySessionId
    return sessionId === lastSessionId
  }

  function sendLocal(payload) {
    // 来自 /dsh-pet/control 的本地指令（用户点桌宠菜单、或 agent 主动调用）
    broadcast(payload)
  }

  // —— 逐字流：agent/assistant-stream 是 process-local 的实时 chunk 通道 ——
  disposers.push(
    ctx.on('agent/assistant-stream', (payload) => {
      try {
        const p = payload || {}
        const agent = p.agent
        const frame = p.frame
        if (!agent || !frame || !agent.session) return
        const sessionId = agent.session.id
        lastSessionId = sessionId
        if (!isPrimary(sessionId)) return
        if (frame.type === 'start') {
          broadcast({ t: 'attempt-start', sessionId, turn: frame.turn, step: frame.step })
          return
        }
        if (frame.type === 'end') {
          broadcast({ t: 'attempt-end', sessionId, turn: frame.turn ?? null })
          return
        }
        if (frame.type !== 'chunk' || !frame.chunk) return
        const c = frame.chunk
        if (c.type === 'text-delta' && c.text) {
          broadcast({ t: 'delta', sessionId, kind: 'text', text: c.text })
        } else if (c.type === 'reasoning-delta' && c.text) {
          broadcast({ t: 'delta', sessionId, kind: 'reasoning', text: c.text })
        } else if (c.type === 'tool-call-delta' && c.name) {
          broadcast({ t: 'tool-draft', sessionId, name: c.name })
        }
      } catch (err) {
        /* 事件桥永远不能把主流程带崩 */
      }
    }),
  )

  // —— 会话事件：轮次/步骤/工具/最终消息 ——
  const pendingTools = new Map() // callId -> { name, startedAt }
  /** 每个会话上一次告诉前端的「实际在用的模型」，用来给 request/header 去重。 */
  const lastModelKey = new Map() // sessionId -> 'provider|model|effort'
  /** 每轮累计 token 数，桌宠完成时用它弹「这一轮花了多少」的小结（纯展示，不算钱）。 */
  const turnTokens = new Map() // sessionId -> tokens
  /** 钱包用：这一轮的 命中/未命中/输出 口径——只在 assistant/message 带 usage 时才有数，
   * 带不带看后端/模型，带不了就是空的，本轮花费不靠它兜底（见 turnBalanceStart）。 */
  const turnUsage = new Map()
  /** 本轮消耗现在靠余额差分算：turn/start 记一次「这一轮开始时的余额」快照，
   * turn/end 时再拉一次新余额，两个一减就是这一轮真实花了多少——不依赖
   * assistant/message 带不带 usage 字段，参考 dsh-whale-widget 的做法。 */
  const turnBalanceStart = new Map() // sessionId -> number | null

  disposers.push(
    ctx.on('session/event', (session, event) => {
      try {
        const sessionId = (session && session.id) || 'default'
        lastSessionId = sessionId
        const type = event && event.type
        const d = (event && event.data) || {}
        const st = stateOf(sessionId)

        if (TRACE_ON && TRACE_TYPES.has(type)) traceEvent(sessionId, type, d)

        // 白名单事件（清单 / 计划模式 / 整理记忆 / 目标 / 交付物 / 重试 / 放行策略）：
        // 裁剪成紧凑消息转给前端，只对主会话；子代理的这类事件不该让主会话的桌宠有反应。
        const slim = slimSessionEvent(type, d)
        if (slim) {
          noteFacts(sessionId, slim)
          // request/header 每一步都有：同一个模型只在「第一次出现 / 换了」时才告诉前端
          if (slim.k === 'model' && slim.src === 'request') {
            const key = `${slim.provider || ''}|${slim.model}|${slim.effort || ''}`
            if (lastModelKey.get(sessionId) === key) return
            lastModelKey.set(sessionId, key)
          }
          if (isPrimary(sessionId) || (SELECTION_KINDS.has(slim.k) && !nonHumanSessions.has(sessionId))) {
            broadcast(Object.assign({ t: 'sev', sessionId }, slim))
          }
          return
        }

        // 人类直接发的 prompt —— 以此认定“当前会话”
        if (type === 'user/message' && d.source && d.source.kind === 'user') {
          primarySessionId = sessionId
          broadcast({ t: 'user', sessionId, text: textOf(d).slice(0, 4000), ts: Date.now() })
          return
        }
        if (type === 'turn/start') {
          turnTokens.set(sessionId, 0)
          turnFacts.delete(sessionId)
          // 存 Promise，不是存当前缓存的余额——缓存可能是几十秒甚至更久之前
          // （上次开 HUD 时）的数字，拿一个过期的值当「这一轮开始时的余额」，
          // 会把上一轮或者更早的消耗也算进这一轮里。这里强制现拉一次，
          // 保证基线真的对得上「此刻」。只对主会话做，子代理并发跑的话
          // 不会一起把余额接口打爆。
          turnBalanceStart.set(
            sessionId,
            isPrimary(sessionId)
              ? fetchBalance(true).then((b) => (b && b.ok ? b.totalBalance : null)).catch(() => null)
              : Promise.resolve(null),
          )
          st.status = 'running'
          st.turn = d.turn
          st.busySince = Date.now()
          if (isPrimary(sessionId)) broadcast({ t: 'turn-start', sessionId, turn: d.turn })
          else broadcast({ t: 'subagent', sessionId, active: true, kind: 'turn-start' })
          return
        }
        if (type === 'step/start') {
          st.step = d.step
          if (isPrimary(sessionId)) broadcast({ t: 'step-start', sessionId, turn: d.turn, step: d.step })
          return
        }
        if (type === 'assistant/message') {
          if (d.usage) {
            const hit = Number(d.usage.cacheReadTokens) || 0
            const miss = Number(d.usage.inputTokens) || 0
            const out = Number(d.usage.outputTokens) || 0
            const t = hit + miss + out
            turnTokens.set(sessionId, (turnTokens.get(sessionId) || 0) + t)
            // 钱包：把这一轮的三个口径也累计起来（用于算钱）
            const u = turnUsage.get(sessionId) || { hit: 0, miss: 0, out: 0, model: '' }
            u.hit += hit
            u.miss += miss
            u.out += out
            const model = (d.message && d.message.model) || d.model
            if (model) u.model = String(model)
            turnUsage.set(sessionId, u)
          }
          if (!isPrimary(sessionId)) return
          const usage = d.usage || null
          broadcast({
            t: 'assistant',
            sessionId,
            turn: d.turn,
            step: d.step,
            text: textOf(d.message).slice(0, 8000),
            interrupted: d.interrupted === true,
            usage: usage
              ? {
                  input: usage.inputTokens || 0,
                  cache: usage.cacheReadTokens || 0,
                  output: usage.outputTokens || 0,
                }
              : null,
          })
          return
        }
        if (type === 'assistant/attempt') {
          if (isPrimary(sessionId)) broadcast({ t: 'attempt-failed', sessionId, turn: d.turn })
          return
        }
        if (type === 'tool/call') {
          const startedAt = Date.now()
          pendingTools.set(String(d.callId), { name: d.name, startedAt })
          if (!isPrimary(sessionId)) return
          let args = ''
          try {
            args = String(d.arguments || '')
          } catch (err) {}
          broadcast({
            t: 'tool-call',
            sessionId,
            callId: String(d.callId),
            name: d.name,
            label: TOOL_LABELS[d.name] || d.name,
            args: args.slice(0, 600),
          })
          return
        }
        if (type === 'tool/result') {
          const callId = d.message && d.message.content && d.message.content[0] && d.message.content[0].toolCallId
          const key = String(callId || '')
          const pending = pendingTools.get(key)
          if (pending) pendingTools.delete(key)
          if (!isPrimary(sessionId)) return
          broadcast({
            t: 'tool-result',
            sessionId,
            callId: key,
            name: (pending && pending.name) || '',
            label: (pending && TOOL_LABELS[pending.name]) || (pending && pending.name) || '',
            ms: pending ? Date.now() - pending.startedAt : null,
            error: d.error ? { name: d.error.name, code: d.error.code } : null,
          })
          return
        }
        if (type === 'turn/end') {
          st.status = 'idle'
          const ms = st.busySince ? Date.now() - st.busySince : null
          st.busySince = 0
          const tokens = turnTokens.get(sessionId) || 0
          turnTokens.delete(sessionId)
          // 钱包结算：按「下单时刻」的峰谷 + 模型档位，从 assistant/message 上报的
          // usage 估一个数——但这个字段有些后端/模型不带，带不到就是 0。
          // 先用这个估算立刻广播（不等网络），下面再拿余额差分补一条更准的。
          const u = turnUsage.get(sessionId) || { hit: 0, miss: 0, out: 0, model: '' }
          turnUsage.delete(sessionId)
          const startBalancePromise = turnBalanceStart.get(sessionId) || Promise.resolve(null)
          turnBalanceStart.delete(sessionId)
          const nowSec = Math.floor(Date.now() / 1000)
          const peak = isPeakTime(nowSec)
          // 「事件匹配」：自定义厂商配了关键字、这一轮用的模型名命中，就用
          // 自定义单价直接算钱——这条路径本来就是给没有余额可查的模型/
          // 公司内部网关兜底的，下面不会再拿余额差分去「纠正」它。
          const cfg = readConfig()
          const eventTable =
            cfg.walletProvider === 'custom' && matchesEventKeywords(cfg, u.model) ? customPriceTier(cfg) : null
          const estAmount = tokens > 0 ? costOf(u, peak, priceTier(u.model), eventTable) : 0
          wallet.turnSeq += 1
          const seq = wallet.turnSeq
          wallet.lastTurn = {
            seq,
            turn: d.turn || null,
            amount: Math.round(estAmount * 1e6) / 1e6,
            tokens,
            ts: Date.now(),
            isPeak: peak,
            tier: priceTier(u.model),
            detail: { hit: u.hit, miss: u.miss, out: u.out },
            source: eventTable ? 'event-match' : 'estimate',
          }
          if (tokens > 0) addTodayTokens(tokens)
          stats.bump(tokens)
          if (isPrimary(sessionId)) {
            settleBond(sessionId, d.reason, tokens)
            broadcast({ t: 'turn-end', sessionId, turn: d.turn, reason: d.reason, ms, tokens,
              amount: wallet.lastTurn.amount, isPeak: peak })
            // HUD 靠这条立刻弹出来，不用等前端再拉一次（这一下用的还是估算值，
            // 除非走的是事件匹配——那条路径本身就是权威结果，不是估算）
            broadcast({ t: 'hud-turn', sessionId, turn: wallet.lastTurn })
            // 余额差分：等 turn/start 那次现拉的余额到手，再拉一次最新的，两个
            // 一减就是这一轮真实花了多少（顺带把「今日已用」也刷新了，见
            // fetchBalance）。异步跑，跑完了补一条更准的 hud-turn；跑的时候
            // 如果已经是下一轮了（seq 对不上）就不广播，免得把新一轮的数覆盖掉。
            // 事件匹配已经是权威结果了，跳过——它本来就是给查不到余额的
            // 模型兜底的，没有余额可以拿来「纠正」。
            if (!eventTable) {
              startBalancePromise
                .then((startBalance) => {
                  if (startBalance == null) return null
                  return fetchBalance(true).then((bal) => {
                    if (!bal || !bal.ok || wallet.turnSeq !== seq) return
                    const diff = startBalance - bal.totalBalance
                    if (diff <= 0) return // 没花钱，或者中途充值了，估算值/0 已经够用
                    wallet.lastTurn = Object.assign({}, wallet.lastTurn, {
                      amount: Math.round(diff * 1e6) / 1e6,
                      source: 'balance-diff',
                    })
                    broadcast({ t: 'hud-turn', sessionId, turn: wallet.lastTurn })
                  })
                })
                .catch(() => {})
            }
          } else {
            broadcast({ t: 'subagent', sessionId, active: false, kind: 'turn-end' })
          }
          return
        }
        if (type === 'approval/asked') {
          if (isPrimary(sessionId)) {
            broadcast({ t: 'approval', sessionId, state: 'asked', tool: typeof d.toolName === 'string' ? d.toolName : null })
          }
          return
        }
        if (type === 'approval/decided') {
          // outcome: allowed-once | rejected | cancelled | unavailable（字段名在 trace 里再核一次，缺了就是 null）
          const outcome = typeof d.outcome === 'string' ? d.outcome : typeof d.decision === 'string' ? d.decision : null
          if (isPrimary(sessionId)) broadcast({ t: 'approval', sessionId, state: 'decided', outcome })
          return
        }
        if (type === 'session/title') {
          if (isPrimary(sessionId) && d.title) broadcast({ t: 'title', sessionId, title: String(d.title) })
          return
        }
      } catch (err) {
        /* 同上：事件桥不许抛 */
      }
    }),
  )

  disposers.push(
    ctx.on('session/disposed', (session) => {
      const id = session && session.id
      if (!id) return
      // 分身会话如果没走完整的 turn/end 就被销毁了（崩溃/被杀），前端的
      // 「有几个分身在干活」计数会漏减一——补一条 subagent:false，让前端清账。
      if (id !== primarySessionId) broadcast({ t: 'subagent', sessionId: id, active: false, kind: 'disposed' })
      turnTokens.delete(id)
      turnBalanceStart.delete(id)
      lastModelKey.delete(id)
      nonHumanSessions.delete(id)
      sessionState.delete(id)
      if (primarySessionId === id) primarySessionId = null
      if (lastSessionId === id) lastSessionId = null
    }),
  )

  // 新建会话：给「点了新建会话她会有反应」当语义兜底（DOM 点击是即时反馈，这里是兜底）。
  // 子代理也会建会话，origin 一并带给前端，由前端按 origin / blank 过滤。
  disposers.push(
    ctx.on('session/created', (session) => {
      try {
        const id = session && session.id
        if (!id) return
        const h = (session && session.header) || {}
        const origin = typeof h.origin === 'string' ? h.origin : (h.origin && h.origin.kind) || null
        const human = !((Number(h.delegationDepth) || 0) > 0 || (origin && NON_HUMAN_ORIGIN.test(origin)))
        if (!human) nonHumanSessions.add(id)
        // 人新建的空白会话：马上成为「当前会话」（不用等第一条消息），之后它的事件才进得来
        else if (!(session.seq > 0)) primarySessionId = id
        if (TRACE_ON) traceEvent(id, 'session/created', { seq: session.seq, origin: h.origin === undefined ? null : h.origin })
        broadcast({ t: 'session', kind: 'created', sessionId: id, blank: !(session.seq > 0), origin })
      } catch (err) {}
    }),
  )

  // 消息点赞 / 点踩：feedback/committed 是 ctx.parallel 事件，载荷里最后一条就是刚写入的反馈。
  disposers.push(
    ctx.on('feedback/committed', (payload) => {
      try {
        const evs = payload && Array.isArray(payload.events) ? payload.events : []
        const last = evs[evs.length - 1]
        if (TRACE_ON) traceEvent('-', 'feedback/committed', last)
        const item = last && last.data && (last.data.item || last.data)
        const rating = item && (item.rating === 'positive' || item.rating === 'negative') ? item.rating : null
        if (rating) broadcast({ t: 'sev', k: 'feedback', rating })
      } catch (err) {}
    }),
  )

  return {
    clients,
    broadcast,
    sendLocal,
    stateOf,
    isPrimary,
    getPrimary: () => primarySessionId,
    getLast: () => lastSessionId,
  }
}
