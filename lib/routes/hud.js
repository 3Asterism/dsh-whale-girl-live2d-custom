/** 右键 HUD 的数据源。 */

/** @param {{ route: Function, rejected: Function, walletSvc: any, buildHud: () => any }} deps */
export function registerHudRoute({ route, rejected, walletSvc, buildHud }) {
  /**
   * 右键 HUD 的数据源：余额 + 峰谷 + 本轮消耗 + 今日累计。
   * ?refresh=1 强制刷新余额（前端有 60 秒节流）。
   */
  route('exact', '/dsh-pet/hud', async (req, res) => {
    if (rejected(req, res)) return
    try {
      const force = /[?&]refresh=1/.test(req.url || '')
      await walletSvc.fetchBalance(force)
      const snap = buildHud()
      const body = JSON.stringify(snap)
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': String(Buffer.byteLength(body)),
      })
      res.end(body)
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err).slice(0, 200) }))
    }
  })
}
