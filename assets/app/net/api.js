/**
 * net/api.js —— 和宿主说话的最底层 HTTP 工具。网络出错一律返回 null，调用方按「没响应」处理，永远不抛。
 */

import { BASE } from '../config.js'

export async function postJson(path, body) {
  try {
    const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return await r.json()
  } catch (err) {
    return null
  }
}

export async function getJson(path) {
  try {
    return await (await fetch(BASE + path)).json()
  } catch (err) {
    return null
  }
}

/** 谁先到谁领：返回 true 才该演。宿主不可用时返回 false（宁可不演，也不重复演）。 */
export async function claim(key, scope) {
  const j = await postJson('/claim', { key, scope: scope || 'day' })
  return !!(j && j.claimed)
}
