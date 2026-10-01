/** 请求体读取。 */

import { MIME } from '../paths.js'

export function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export async function json(req, res) {
  let body
  try {
    body = JSON.parse((await readBody(req)) || '{}')
  } catch (err) {
    res.writeHead(400, { 'Content-Type': MIME['.json'] })
    res.end(JSON.stringify({ ok: false, error: 'bad json' }))
    return null
  }
  return body
}
