/**
 * 信任栅栏 + 路由注册：和官方插件一致，自定义路由必须先过 connection 的判定。
 * 唯一的例外是「桌面版通行证」：本机进程带着令牌来，就放行（原因见 paths.js 的 DESKTOP_FILE 注释）。
 */

import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { DESKTOP_FILE } from '../paths.js'

/** @param ctx cordis 上下文 */
export function createGuard(ctx) {
  // —— 信任栅栏：和官方插件一致，自定义路由必须先过 connection 的判定 ——
  //
  // 唯一的例外是「桌面版通行证」：本机进程（macOS 原生壳）带着令牌来，就放行。
  // 为什么必须留这个口子：壳子是全新 WebView，没有 DSH 的会话 cookie，
  // 而桌面桌宠的全部意义就是「不在浏览器里」，不能让用户先去浏览器登录一次。
  let deskToken = null
  function desktopKey() {
    if (deskToken) return deskToken
    try {
      const raw = JSON.parse(fs.readFileSync(DESKTOP_FILE, 'utf8'))
      if (raw && typeof raw.token === 'string' && raw.token.length >= 16) {
        deskToken = raw.token
        return deskToken
      }
    } catch (err) {}
    const token = randomBytes(24).toString('hex')
    try {
      fs.writeFileSync(
        DESKTOP_FILE,
        JSON.stringify(
          {
            token,
            note: '桌面版（macOS 原生壳）的本机通行证。删掉这个文件会自动重新生成，旧壳子需要重启。',
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ) + '\n',
        { mode: 0o600 },
      )
    } catch (err) {
      try {
        console.warn('[live2d-pet] 桌面版通行证写不进去：', err && err.message)
      } catch (e) {}
    }
    deskToken = token
    return deskToken
  }

  /** 这个请求是不是「本机桌面壳」发来的（回环地址 + 令牌，两个都要满足） */
  function isDesktopReq(req) {
    try {
      const addr = (req.socket && (req.socket.remoteAddress || '')) || ''
      if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') return false
      const token = desktopKey()
      if (!token) return false
      const cookie = String(req.headers.cookie || '')
      if (cookie.split(/;\s*/).some((c) => c === `dsh_pet_desk=${token}`)) return true
      if (req.headers['x-dsh-pet-desk'] === token) return true
      const m = /[?&]k=([0-9a-f]{16,})/.exec(String(req.url || ''))
      if (m && m[1] === token) return true
      return false
    } catch (err) {
      return false
    }
  }

  function rejected(req, res) {
    try {
      if (isDesktopReq(req)) return false
      const conn = ctx.get('connection') || ctx.connection
      if (!conn || typeof conn.requestRejection !== 'function') {
        if (!rejected.warned) {
          rejected.warned = true
          try {
            console.warn('[live2d-pet] 信任栅栏不可用：connection 服务缺失，自定义路由将放行')
          } catch (err) {}
        }
        return false
      }
      const code = conn.requestRejection(req)
      if (code === undefined || code === null || code === false) return false
      res.statusCode = typeof code === 'number' ? code : 403
      res.end()
      return true
    } catch (err) {
      return false
    }
  }

  const disposers = []
  function route(kind, pathname, handler) {
    disposers.push(
      ctx.webServer.register({
        kind,
        path: pathname,
        handler: async (req, res) => {
          if (rejected(req, res)) return
          try {
            await handler(req, res)
          } catch (err) {
            try {
              res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
              res.end(`live2d-pet: ${err && err.message ? err.message : String(err)}`)
            } catch (e) {}
          }
        },
      }),
    )
  }

  // ————————————————————————————————————————————————————————————
  // 1. 静态资源
  // ————————————————————————————————————————————————————————————

  return { route, rejected, desktopKey, disposers }
}
