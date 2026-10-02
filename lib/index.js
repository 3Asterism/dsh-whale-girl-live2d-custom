/**
 * dsh-live2d-pet —— 宿主侧插件入口：只负责「装配」，业务都在各模块里。
 *
 *   paths / config / calendar       路径常量、用户配置、日期工具
 *   http/     guard · body · static  信任栅栏与路由注册、请求体、静态资源（含前端 ES 模块）
 *   bridge                           事件桥：会话事件 → SSE，顺带结算钱包与羁绊
 *   events/   slim · labels          事件裁剪（纯函数）、工具中文标签
 *   wallet/   pricing · ledger · providers · service   余额 / 峰谷 / 记账
 *   stats/    store                  统计存储（陪伴天数、领取记录…）
 *   bond/                            羁绊系统（纯逻辑，可单测；规则见 docs/好感系统设计.md）
 *   routes/   events · hud · session · growth
 *   pages · inject                   standalone / 自检页、index.html 注入
 *
 * 所有路由都过一遍 connection.requestRejection 的信任栅栏：DSH 的 Web 端口是回环地址，
 * 但浏览器里任何一个网页都能向回环发请求，不加栅栏等于把会话的读写权限开放给任意页面。
 */

import fs from 'node:fs'
import path from 'node:path'
import { MODEL_DIR, DESKTOP_FILE, STICKER_DIR } from './paths.js'
import { readConfig } from './config.js'
import { createGuard } from './http/guard.js'
import { json } from './http/body.js'
import { registerStatic } from './http/static.js'
import { createStatsStore } from './stats/store.js'
import { createWallet } from './wallet/service.js'
import { createBond } from './bond/index.js'
import { createBridge } from './bridge.js'
import { registerEventRoutes } from './routes/events.js'
import { registerHudRoute } from './routes/hud.js'
import { registerSessionRoutes } from './routes/session.js'
import { registerGrowthRoutes } from './routes/growth.js'
import { registerPages } from './pages.js'
import { injectScriptRow, injectIntoHtml } from './inject.js'

/** 表情包图鉴的全集：assets/stickers/manifest.json 里的 id。读不到（没装表情包）就是空，图鉴就不出现。 */
function readStickerIds() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(STICKER_DIR, 'manifest.json'), 'utf8'))
    return Object.keys((j && j.stickers) || {})
  } catch (err) {
    return []
  }
}

// 给测试 / 外部工具用的纯函数出口
export { slimSessionEvent } from './events/slim.js'

export default {
  name: 'dsh-live2d-pet',
  apply(root) {
    const rowDisposers = []
    root.effect(() => () => {
      for (const d of rowDisposers) {
        try {
          d()
        } catch (err) {}
      }
    })
    // 桌面端注入：tapIndex 到不了静态 dist 出的 index，必须用 index-inject 推结构化行。
    rowDisposers.push(root.on('webserver/index-inject', injectScriptRow))

    // 其余逻辑（等齐服务后再跑）
    root.inject(['webServer', 'connection'], (ctx) => {
      const guard = createGuard(ctx)
      const { route, rejected, disposers } = guard

      const stats = createStatsStore()
      const bond = createBond({ read: () => stats.bondRaw(), write: (b) => stats.setBond(b), stickers: readStickerIds() })
      const walletSvc = createWallet(ctx)
      const bridge = createBridge({ ctx, disposers, walletSvc, stats, bond })

      /** 右键 HUD 的完整数据：钱包快照 + 陪伴统计 + 羁绊概要。 */
      const buildHud = () => {
        const s = stats.get()
        const b = bond.brief()
        return {
          ...walletSvc.snapshot(),
          stats: {
            days: stats.companionDays(),
            turns: s.totalTurns,
            tokens: s.totalTokens,
            ...stats.dayStats(),
            level: b.level,
            levelName: b.levelName,
            affinity: b.xp,
            pending: b.pending,
          },
        }
      }

      registerStatic({ route, json, onConfigChanged: walletSvc.invalidate })
      registerEventRoutes({ route, ctx, bridge })
      registerHudRoute({ route, rejected, walletSvc, buildHud })
      registerSessionRoutes({ route, ctx, json, bridge })
      registerGrowthRoutes({ route, json, stats, bond })
      registerPages({ route })

      disposers.push(
        ctx.webServer.tapIndex((html) => {
          if (!readConfig().enabled) return html
          return injectIntoHtml(html)
        }),
      )

      ctx.effect(() => () => {
        for (const res of bridge.clients) {
          try {
            res.end()
          } catch (err) {}
        }
        bridge.clients.clear()
        for (const d of disposers) {
          try {
            d()
          } catch (err) {}
        }
      })

      try {
        // 启动就把「桌面版通行证」准备好：桌面壳启动时要先读它再加载页面，
        // 如果等到第一个请求才生成，壳子会一直拿不到（鸡生蛋）。
        guard.desktopKey()
        console.log(`[live2d-pet] 已挂载：/dsh-pet/pet.js · 模型目录 ${MODEL_DIR} · 桌面版通行证 ${DESKTOP_FILE}`)
      } catch (err) {}
    })
  },
}
