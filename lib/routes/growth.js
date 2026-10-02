/**
 * 养成相关路由：「谁先到谁领」、羁绊系统（/bond/*）、拖文件喂食（/feed）。
 * 业务规则都在 lib/bond（纯逻辑）里，这里只做 HTTP 适配与参数校验。
 */

import fs from 'node:fs'
import path from 'node:path'
import { FEED_DIR, FEED_MAX_BYTES, MIME } from '../paths.js'
import { localDay } from '../calendar.js'

/** @param {{ route: Function, json: Function, stats: any, bond: any }} deps */
export function registerGrowthRoutes({ route, json, stats, bond }) {
  const send = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(obj))
  }

  /** POST {key, scope:'day'|'forever'} → {ok, claimed}。claimed=true 才该演。 */
  route('exact', '/dsh-pet/claim', async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    const body = await json(req, res)
    if (!body) return
    send(res, 200, { ok: true, claimed: stats.claim(body.key, body.scope === 'forever' ? 'forever' : 'day') })
  })

  // —— 羁绊系统 ——
  // GET  /dsh-pet/bond          完整快照（含全部规则表，「好感」页直接渲染）
  // POST /dsh-pet/bond/act      {kind}   戳 / 摸头 / 捏脸 / 被夸 / 每日首见（冷却与每日上限在服务端判）
  // POST /dsh-pet/bond/feed     {item}   投喂
  // POST /dsh-pet/bond/story    {level}  听完羁绊故事 → 正式晋级
  // POST /dsh-pet/bond/memory   {id}     上报只有前端知道的回忆（白名单）
  // POST /dsh-pet/bond/sticker  {id}     她用出了一张表情包（宿主按清单校验，第一次见到才收进图鉴）
  // POST /dsh-pet/bond/away     {}       回来了：结算离线小事件
  // POST /dsh-pet/bond/toggle   {enabled} 总开关
  // 收工 / 大功告成 / 陪伴只由宿主在一轮结束时自己结算，前端没有入口（防刷）。
  route('exact', '/dsh-pet/bond', (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405).end()
      return
    }
    send(res, 200, bond.snapshot())
  })
  const post = (pathname, handler) =>
    route('exact', pathname, async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      const body = await json(req, res)
      if (!body) return
      send(res, 200, handler(body))
    })
  post('/dsh-pet/bond/act', (b) => bond.act(String(b.kind || '')))
  post('/dsh-pet/bond/feed', (b) => bond.feed(String(b.item || '')))
  post('/dsh-pet/bond/story', (b) => bond.story(Number(b.level)))
  post('/dsh-pet/bond/memory', (b) => bond.memory(String(b.id || '')))
  post('/dsh-pet/bond/sticker', (b) => bond.sticker(String(b.id || '')))
  post('/dsh-pet/bond/away', () => bond.away())
  post('/dsh-pet/bond/toggle', (b) => bond.toggle(b.enabled !== false))

  /**
   * 拖文件喂她：原始字节落盘，返回绝对路径。网页的 File 对象拿不到真实路径，所以必须先存下来。
   * 文件名走 X-File-Name（encodeURIComponent），只取 basename 并洗掉非法字符；20MB 封顶。
   * 这里只是存，不会自动发给 agent——要不要读由主人在气泡里点「读一下」决定。
   */
  route('exact', '/dsh-pet/feed', async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    let raw = ''
    try {
      raw = decodeURIComponent(String(req.headers['x-file-name'] || ''))
    } catch (err) {}
    let name = path.basename(raw.replace(/\\/g, '/')).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120)
    if (!name || name === '.' || name === '..') name = 'file'
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > FEED_MAX_BYTES) return send(res, 413, { ok: false, error: 'too large' })
    try {
      const chunks = []
      let size = 0
      await new Promise((resolve, reject) => {
        req.on('data', (c) => {
          size += c.length
          if (size > FEED_MAX_BYTES) {
            reject(new Error('too large'))
            req.destroy()
            return
          }
          chunks.push(c)
        })
        req.on('end', resolve)
        req.on('error', reject)
      })
      if (!size) return send(res, 400, { ok: false, error: 'empty' })
      const dir = path.join(FEED_DIR, localDay())
      fs.mkdirSync(dir, { recursive: true })
      let target = path.join(dir, name)
      if (fs.existsSync(target)) {
        const ext = path.extname(name)
        target = path.join(dir, `${path.basename(name, ext)}-${Date.now().toString(36)}${ext}`)
      }
      fs.writeFileSync(target, Buffer.concat(chunks))
      send(res, 200, { ok: true, path: target, name: path.basename(target), size })
    } catch (err) {
      send(res, err && err.message === 'too large' ? 413 : 500, { ok: false, error: err && err.message ? err.message : String(err) })
    }
  })
}
