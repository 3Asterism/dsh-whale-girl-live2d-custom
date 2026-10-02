/**
 * 静态资源：pet.js（加载器，按 mtime 热读取并注入 boot 配置）、前端 ES 模块（/dsh-pet/app）、
 * Live2D 运行时（vendor）、模型文件、配置读写。
 */

import fs from 'node:fs'
import path from 'node:path'
import { ASSETS, APP_DIR, MODEL_DIR, SOUND_DIR, STICKER_DIR, VENDOR_DIR, CONFIG_FILE, VERSION, MIME } from '../paths.js'
import { DEFAULT_CONFIG, readConfig } from '../config.js'

/**
 * @param {{ route: Function, json: Function, onConfigChanged: () => void }} deps
 */
export function registerStatic({ route, json, onConfigChanged }) {
  /** 把一个相对路径安全地解析到某个根目录下，越界直接判失败。 */
  function safeJoin(root, rel) {
    const decoded = decodeURIComponent(String(rel || ''))
    const target = path.resolve(root, decoded)
    const prefix = root.endsWith(path.sep) ? root : root + path.sep
    if (target !== root && !target.startsWith(prefix)) return null
    return target
  }

  function serveFile(res, abs, { cache = 'no-store' } = {}) {
    let stat
    try {
      stat = fs.statSync(abs)
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    if (!stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('not a file')
      return
    }
    const ext = path.extname(abs).toLowerCase()
    const type = MIME[ext] || 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': String(stat.size),
      'Cache-Control': cache,
    })
    fs.createReadStream(abs).pipe(res)
  }

  // 前端脚本按 mtime 热读取：改完刷新页面就生效，不用重启 DSH。
  const hotCache = new Map()
  function readHot(abs) {
    const stat = fs.statSync(abs)
    const hit = hotCache.get(abs)
    if (hit && hit.mtime === stat.mtimeMs) return hit.text
    const text = fs.readFileSync(abs, 'utf8')
    hotCache.set(abs, { mtime: stat.mtimeMs, text })
    return text
  }

  route('exact', '/dsh-pet/pet.js', (req, res) => {
    let body
    try {
      body = readHot(path.join(ASSETS, 'pet.js'))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('pet.js missing')
      return
    }
    const config = readConfig()
    const boot = `\n;window.__DSH_PET_BOOT__=${JSON.stringify({ config, version: VERSION })};\n`
    const doc = `/* dsh-live2d-pet ${VERSION} */\n${body}${boot}`
    res.writeHead(200, {
      'Content-Type': MIME['.js'],
      'Content-Length': String(Buffer.byteLength(doc)),
      'Cache-Control': 'no-store',
    })
    res.end(doc)
  })

  route('prefix', '/dsh-pet/vendor', (req, res) => {
    const rel = req.url.split('?')[0].replace(/^\/dsh-pet\/vendor\/?/, '')
    const abs = safeJoin(VENDOR_DIR, rel)
    if (!abs) {
      res.writeHead(403).end()
      return
    }
    // vendor 体积大且不常改，允许浏览器缓存但必须每次校验
    serveFile(res, abs, { cache: 'no-cache' })
  })

  route('prefix', '/dsh-pet/model', (req, res) => {
    const rel = req.url.split('?')[0].replace(/^\/dsh-pet\/model\/?/, '')
    const abs = safeJoin(MODEL_DIR, rel)
    if (!abs) {
      res.writeHead(403).end()
      return
    }
    serveFile(res, abs, { cache: 'no-cache' })
  })

  // 按压音效：只放行 .mp3（小黄鸭按下 / 松开两个文件）。
  route('prefix', '/dsh-pet/sound', (req, res) => {
    const rel = req.url.split('?')[0].replace(/^\/dsh-pet\/sound\/?/, '')
    const abs = safeJoin(SOUND_DIR, rel)
    if (!abs || path.extname(abs).toLowerCase() !== '.mp3') {
      res.writeHead(403).end()
      return
    }
    serveFile(res, abs, { cache: 'no-cache' })
  })

  // 表情包：只放行 .gif 与 manifest.json。文件名带版本查询串（?v=）击穿缓存，内容不变时允许浏览器缓存。
  route('prefix', '/dsh-pet/stickers', (req, res) => {
    const rel = req.url.split('?')[0].replace(/^\/dsh-pet\/stickers\/?/, '')
    const abs = safeJoin(STICKER_DIR, rel)
    const ext = abs ? path.extname(abs).toLowerCase() : ''
    if (!abs || (ext !== '.gif' && ext !== '.json')) {
      res.writeHead(403).end()
      return
    }
    serveFile(res, abs, { cache: ext === '.json' ? 'no-cache' : 'public, max-age=86400' })
  })

  route('exact', '/dsh-pet/config', async (req, res) => {
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await json(req, res)
      if (!body) return
      // 只接受 DEFAULT_CONFIG 里已经有的字段，别的字段直接丢掉——
      // 这个口子不是「写任意 JSON 进配置文件」的后门，只收已知配置项。
      const patch = {}
      for (const k of Object.keys(body)) {
        if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, k)) patch[k] = body[k]
      }
      let existing = {}
      try {
        existing = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
        if (!existing || typeof existing !== 'object') existing = {}
      } catch (err) {}
      const merged = { ...existing, ...patch }
      try {
        fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8')
      } catch (err) {
        res.writeHead(500, { 'Content-Type': MIME['.json'] })
        res.end(JSON.stringify({ ok: false, error: '写配置文件失败：' + String((err && err.message) || err).slice(0, 160) }))
        return
      }
      // 配置变了，下一次拉余额强制重查——不然用户刚换了厂商，钱包还在显示上一个厂商的缓存
      onConfigChanged()
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ ok: true, config: readConfig() }))
      return
    }
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(readConfig()))
  })

  // ————————————————————————————————————————————————————————————
  // 2. 事件桥
  // ————————————————————————————————————————————————————————————

  // 前端 ES 模块：assets/app/**。同样按 mtime 热读取，改完刷新页面就生效。
  route('prefix', '/dsh-pet/app', (req, res) => {
    const rel = req.url.split('?')[0].replace(/^\/dsh-pet\/app\/?/, '')
    const abs = safeJoin(APP_DIR, rel)
    if (!abs || path.extname(abs).toLowerCase() !== '.js') {
      res.writeHead(403).end()
      return
    }
    let body
    try {
      body = readHot(abs)
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME['.js'],
      'Content-Length': String(Buffer.byteLength(body)),
      'Cache-Control': 'no-store',
    })
    res.end(body)
  })
}
