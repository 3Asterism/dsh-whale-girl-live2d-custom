/**
 * 路径与全局常量。DSH_HOME 在模块加载时读取（测试要在 import 之前设好环境变量）。
 */

import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ASSETS = path.join(PACKAGE_ROOT, 'assets')
export const MODEL_DIR = path.join(ASSETS, 'model')
export const VENDOR_DIR = path.join(ASSETS, 'vendor')
/** 表情包（赤风RED《蓝色大肥鱼》，已压成气泡尺寸）：*.gif + manifest.json。 */
export const STICKER_DIR = path.join(ASSETS, 'stickers')
/** 前端 ES 模块目录（assets/pet.js 只是个加载器，真正的代码在这里）。 */
export const APP_DIR = path.join(ASSETS, 'app')
export const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
export const CONFIG_FILE = path.join(DSH_HOME, 'dsh-live2d-pet.json')
/**
 * 统计 + 羁绊系统的持久记录（陪伴天数 / 累计轮次 / token / 每日一次的领取 / bond 字段）。
 * 放服务端而不是 localStorage：网页版和桌面壳是不同 origin，localStorage 互不相通；
 * 同时也让「谁先到谁领」在双端同时开着时不会重复触发。
 */
export const STATS_FILE = path.join(DSH_HOME, 'dsh-live2d-pet-stats.json')
/**
 * 桌面版通行证（macOS / Windows 原生壳用）。
 * 所有 /dsh-pet/* 路由都要过信任栅栏，栅栏认的是 DSH 的会话 cookie；桌面壳是全新的 WebView，
 * 一个 cookie 都没有 → 401。这里给「本机进程」发一张随机通行证：壳子把它写成 cookie 再加载页面，栅栏就放行。
 * 只认回环地址 + 令牌，所以别的网页（CSRF）依然进不来。
 */
export const DESKTOP_FILE = path.join(DSH_HOME, 'dsh-live2d-pet-desktop.json')
/** 载荷探测：DSH_PET_TRACE=1 时把白名单事件的原始载荷追加写到 TRACE_FILE（JSONL），默认关。 */
export const TRACE_ON = process.env.DSH_PET_TRACE === '1'
export const TRACE_FILE = path.join(DSH_HOME, 'dsh-pet-trace.jsonl')
/** 「拖文件喂她」落盘目录与上限。网页的 File 对象没有真实路径，只能先存下来再给 agent 路径。 */
export const FEED_DIR = path.join(DSH_HOME, 'dsh-pet-feed')
export const FEED_MAX_BYTES = 20 * 1024 * 1024

/** 版本串同时用于前端日志与缓存击穿，改前端时记得一起动。 */
export const VERSION = '0.6.1'

export const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.moc3': 'application/octet-stream',
  '.wasm': 'application/wasm',
}
