/**
 * net/bond.js —— 羁绊系统的 HTTP 客户端（只管请求与镜像更新，不管「演什么」）。
 * 规则在宿主的 lib/bond（见 docs/好感系统设计.md）；前端只缓存别的模块要快速读的几项（core/state.js 的 bond）。
 */

import { bond } from '../core/state.js'
import { getJson, postJson } from './api.js'

/** 用宿主给的完整快照刷新前端镜像。返回是否发生了「待晋级」状态变化。 */
export function applySnapshot(snap) {
  if (!snap || snap.ok === false) return false
  const wasPending = bond.pending
  bond.snap = snap
  bond.enabled = snap.enabled !== false
  bond.level = snap.level || 1
  bond.levelName = snap.levelName || bond.levelName
  bond.tier = snap.tier || 1
  bond.strokeMax = snap.strokeMax || 1
  bond.pending = !!snap.pending
  bond.pendingLevel = snap.pendingLevel || null
  return bond.pending && !wasPending
}

export const fetchBond = async () => {
  const j = await getJson('/bond')
  return j && j.ok ? j : null
}
export const postAct = (kind) => postJson('/bond/act', { kind })
export const postFeed = (item) => postJson('/bond/feed', { item })
export const postStory = (level) => postJson('/bond/story', { level })
export const postMemory = (id) => postJson('/bond/memory', { id })
export const postAway = () => postJson('/bond/away', {})
export const postToggle = (enabled) => postJson('/bond/toggle', { enabled })
