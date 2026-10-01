/** SSE 事件流与状态查询。 */

import { MIME, VERSION } from '../paths.js'

/** @param {{ route: Function, ctx: any, bridge: any }} deps */
export function registerEventRoutes({ route, ctx, bridge }) {
  route('exact', '/dsh-pet/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    // 连上先给一份当前状态，桌宠不用等下一个事件才知道自己在什么状态
    const state = bridge.getPrimary() ? bridge.stateOf(bridge.getPrimary()) : null
    res.write(
      `data: ${JSON.stringify({
        t: 'hello',
        sessionId: bridge.getPrimary() || bridge.getLast() || null,
        status: state ? state.status : 'idle',
        ts: Date.now(),
      })}\n\n`,
    )
    bridge.clients.add(res)
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch (err) {
        clearInterval(ping)
        bridge.clients.delete(res)
      }
    }, 15000)
    const cleanup = () => {
      clearInterval(ping)
      bridge.clients.delete(res)
    }
    req.on('close', cleanup)
    req.on('error', cleanup)
    res.on('error', cleanup)
  })

  route('exact', '/dsh-pet/state', (req, res) => {
    const sid = bridge.getPrimary() || bridge.getLast()
    const st = sid ? bridge.stateOf(sid) : { status: 'idle', turn: 0, step: 0 }
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' })
    res.end(
      JSON.stringify({
        ok: true,
        version: VERSION,
        sessionId: sid,
        status: st.status,
        turn: st.turn,
        step: st.step,
        clients: bridge.clients.size,
        hasSessionController: !!ctx.get('sessionController'),
      }),
    )
  })
}
