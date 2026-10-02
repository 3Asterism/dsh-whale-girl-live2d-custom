/**
 * 羁绊系统的有状态外壳：把纯引擎（./engine.js）接上持久化。
 *
 * 持久化由外部注入（read / write），所以这里不碰文件系统——宿主把它接到统计文件的 `bond` 字段上，
 * 测试则接到一个内存对象上。时钟和随机数同理可注入。
 */

import * as E from './engine.js'

/**
 * @param {{ read: () => any, write: (bond: any) => void, clock?: () => number, rand?: () => number }} deps
 */
export function createBond({ read, write, clock = () => Date.now(), rand = Math.random, stickers }) {
  if (stickers) E.setStickerCatalog(stickers) // 图鉴的全集（宿主从表情包清单读出来）
  let state = null
  const st = () => state || (state = E.normalizeBond(read(), clock()))

  /** 跑一个会改状态的操作，之后统一落盘。 */
  function mutate(fn) {
    const s = st()
    const out = fn(s, clock())
    try {
      write(s)
    } catch (err) {
      /* 落盘失败不能影响主流程 */
    }
    return out
  }

  return {
    /** 当前完整快照（含全部规则表）。读取也会惰性结算（日切换 / 心情 / 饱腹 / 衰减），所以也要落盘。 */
    snapshot: () => mutate((s, now) => E.snapshot(s, now)),
    /** 前端上报的互动（戳 / 摸头 / 捏脸 / 被夸 / 每日首见）。返回 { delta, why, events, snapshot }。 */
    act: (kind) =>
      mutate((s, now) => {
        const r = E.act(s, kind, now)
        return { ok: r.why !== 'forbidden', ...r, snapshot: E.snapshot(s, now) }
      }),
    /** 一轮结束（只由宿主调用）。 */
    onTurn: (info) => mutate((s, now) => E.onTurn(s, info, now)),
    feed: (item) =>
      mutate((s, now) => {
        const r = E.feed(s, item, now)
        return { ...r, snapshot: E.snapshot(s, now) }
      }),
    story: (level) =>
      mutate((s, now) => {
        const r = E.confirmStory(s, level, now)
        return { ...r, snapshot: E.snapshot(s, now) }
      }),
    memory: (id) =>
      mutate((s, now) => {
        const r = E.memory(s, id, now)
        return { ...r, snapshot: E.snapshot(s, now) }
      }),
    /** 她用出了一张表情包（前端上报，宿主按清单校验；第一次见到才收进图鉴）。 */
    sticker: (id) =>
      mutate((s, now) => {
        const r = E.stickerSeen(s, id, now)
        return { ...r, snapshot: E.snapshot(s, now) }
      }),
    away: () =>
      mutate((s, now) => {
        const r = E.away(s, now, rand)
        return { ...r, snapshot: E.snapshot(s, now) }
      }),
    toggle: (enabled) =>
      mutate((s, now) => {
        E.setEnabled(s, enabled)
        return { ok: true, snapshot: E.snapshot(s, now) }
      }),
    /** 给 HUD / 台词分档用的精简视图。 */
    brief: () =>
      mutate((s, now) => {
        const snap = E.snapshot(s, now)
        return {
          enabled: snap.enabled,
          level: snap.level,
          levelName: snap.levelName,
          tier: snap.tier,
          xp: snap.xp,
          pending: snap.pending,
          pendingLevel: snap.pendingLevel,
          strokeMax: snap.strokeMax,
          mood: snap.mood,
          full: snap.full,
          tickets: snap.tickets,
        }
      }),
  }
}

export { E as engine }
export * from './constants.js'
export { MEMORIES } from './memories.js'
