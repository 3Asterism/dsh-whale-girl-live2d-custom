/** 反向通道：桌宠 → 会话（说话 / 打断）与外部驱动（control）。 */

import { randomUUID } from 'node:crypto'
import { MIME, VERSION } from '../paths.js'

/** @param {{ route: Function, ctx: any, json: Function, bridge: any }} deps */
export function registerSessionRoutes({ route, ctx, json, bridge }) {
  const sendLocal = bridge.sendLocal
  const clients = bridge.clients

  function resolveSession(requested) {
    const candidate = requested || bridge.getPrimary() || bridge.getLast()
    if (!candidate) return null
    return candidate
  }

  route('exact', '/dsh-pet/say', async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    const body = await json(req, res)
    if (!body) return
    const text = String(body.text || '').trim()
    if (!text) {
      res.writeHead(400, { 'Content-Type': MIME['.json'] })
      res.end(JSON.stringify({ ok: false, error: 'empty text' }))
      return
    }
    const controller = ctx.get('sessionController')
    if (!controller || typeof controller.prompt !== 'function') {
      res.writeHead(503, { 'Content-Type': MIME['.json'] })
      res.end(JSON.stringify({ ok: false, error: 'session controller unavailable' }))
      return
    }
    let sessionId = resolveSession(body.sessionId)
    let created = false
    if (!sessionId && typeof controller.create === 'function') {
      // 还没有会话就自己开一个——否则主人刚打开 DSH 时点桌宠说话会直接失败。
      try {
        const made = await controller.create({})
        sessionId = made && made.sessionId
        created = true
      } catch (err) {
        try {
          console.error('[live2d-pet] 自动建会话失败：', (err && err.stack) || err)
        } catch (e) {}
      }
    }
    if (!sessionId) {
      res.writeHead(503, { 'Content-Type': MIME['.json'] })
      res.end(JSON.stringify({ ok: false, error: 'no active session' }))
      return
    }
    try {
      // 第二个参数 signal 是**必需**的：SessionController.prompt(request, signal) 里
      // 第一行就是 signal.throwIfAborted()。走 RPC 时由载体提供，直接调用必须自己给。
      await controller.prompt(
        {
          requestId: randomUUID(),
          sessionId,
          mode: body.mode === 'steer' ? 'steer' : 'queue',
          content: [{ type: 'text', text }],
        },
        new AbortController().signal,
      )
      res.writeHead(200, { 'Content-Type': MIME['.json'] })
      res.end(JSON.stringify({ ok: true, sessionId, created }))
    } catch (err) {
      // 把栈打到宿主日志——这条路径出错时，前端只拿到一句 message，根本没法定位
      try {
        console.error('[live2d-pet] /say 送话失败：', (err && err.stack) || err)
      } catch (e) {}
      res.writeHead(500, { 'Content-Type': MIME['.json'] })
      res.end(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }))
    }
  })

  // 中断当前轮次（桌宠菜单里的“打断”按钮）
  route('exact', '/dsh-pet/cancel', async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    const body = await json(req, res)
    if (!body) return
    const sessionId = resolveSession(body.sessionId)
    const controller = ctx.get('sessionController')
    try {
      if (!sessionId || !controller || typeof controller.cancel !== 'function') {
        throw new Error('cancel unavailable')
      }
      await controller.cancel({ sessionId })
      res.writeHead(200, { 'Content-Type': MIME['.json'] })
      res.end(JSON.stringify({ ok: true }))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': MIME['.json'] })
      res.end(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }))
    }
  })

  /**
   * 外部驱动通道。桌宠自己的菜单用它，agent 也可以直接 POST 过来让模型做指定反应
   * （见 tools/pet-ctl.mjs）。这是“agent 主动表演”的唯一入口。
   */
  route('exact', '/dsh-pet/control', async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': MIME['.json'] })
      res.end(JSON.stringify({ ok: true, version: VERSION, sessions: clients.size }))
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    const body = await json(req, res)
    if (!body) return
    const out = { t: 'control', ts: Date.now() }
    if (body.expression !== undefined) out.expression = body.expression === null ? null : String(body.expression)
    if (body.mood !== undefined) out.mood = body.mood === null ? null : String(body.mood)
    if (body.motion !== undefined) out.motion = body.motion === null ? null : String(body.motion)
    if (body.bubble !== undefined) out.bubble = body.bubble === null ? null : String(body.bubble)
    if (body.bubbleMs !== undefined) out.bubbleMs = Number(body.bubbleMs) || 0
    if (body.props !== undefined) out.props = body.props
    if (body.clearProps === true) out.clearProps = true
    if (body.say !== undefined) out.say = String(body.say)
    if (body.attention === true) out.attention = true
    sendLocal(out)
    res.writeHead(200, { 'Content-Type': MIME['.json'] })
    res.end(JSON.stringify({ ok: true, clients: clients.size, sent: out }))
  })
}
