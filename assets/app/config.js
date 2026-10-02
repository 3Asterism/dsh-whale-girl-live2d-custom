/** config.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { readLayout } from './core/storage.js'

const BOOT = window.__DSH_PET_BOOT__ || {}

export const CFG = Object.assign(
  {
    height: 180, // 桌宠是常驻挂件：默认约原来 1/3 的占地面积
    corner: 'br',
    lookAtCursor: true,
    talkMouth: true,
    sleepAfterMs: 180000,
    bubbleTtlMs: 0,
    maxWidthRatio: 0.5,
    sound: true, // 点她 / 松开的小黄鸭按压音（宿主默认 true；这里兜底，预览页 / 老宿主没有这个键也行）
    soundVol: 0.7, // 0–1
    stickers: true, // 表情包总开关（宿主默认 true；这里兜底，预览页 / 老宿主没有这个键也行）
    lowBalanceYuan: 5, // 余额低于多少元（仅 CNY）她「要米」；0 = 不要
    repeatChat: false, // 默认「安静模式」：气泡不显示对话原文（你问了什么/她回了什么），也不写过程流水账（工具路径、工具名、第 N 步、token 小结、分身提示）；她自己的台词、动作、表情、报错照常
  },
  BOOT.config || {},
)

export const BASE = '/dsh-pet'

// 本地记住的开关优先于宿主 boot config——设置是「这台机器上这个人」的偏好，不该每次重启都被还原
{
  const saved = readLayout()
  if (saved.repeatChat != null) CFG.repeatChat = !!saved.repeatChat
  // 按压音效：开关与音量同理，是这台机器上这个人的偏好
  if (saved.sound != null) CFG.sound = !!saved.sound
  if (typeof saved.soundVol === 'number' && saved.soundVol >= 0 && saved.soundVol <= 1) CFG.soundVol = saved.soundVol
  // 话痨度（0 安静 / 1 普通 / 2 话痨）与「应景装扮」：同样是这台机器上这个人的偏好
  CFG.chatty = saved.chatty === 0 || saved.chatty === 1 || saved.chatty === 2 ? saved.chatty : 1
  CFG.flair = saved.flair == null ? true : !!saved.flair
  CFG.nightCloth = saved.nightCloth === true // 夜晚自动换深色桌布：默认关（待机默认外观不能自己变）
  // 自动互动的分项开关（「好感」页里能看到、能关）：默认全开
  // stickers = 气泡里台词后面的表情包；idleChat = 你发呆时她搭一句话
  for (const k of ['pageAware', 'keywords', 'routine', 'typing', 'stickers', 'idleChat']) CFG[k] = saved[k] == null ? CFG[k] !== false : !!saved[k]
}

export const MOTION_PRIORITY = { NONE: 0, IDLE: 1, NORMAL: 2, FORCE: 3 }

/**
 * 取景模式。这个模型是一整张「书桌场景」而不是半身立绘，直接整体显示会又小又占地方。
 * 关键是：三档都按「角色实体的高度」算，不是按画布高度算——画布上可能有一大片空气。
 * 实体范围靠启动时自测一次（见 measureContent），所以换任何模型都不用改这里。
 */
export const FIT_FRACTION = { full: 1, bust: 0.62, head: 0.38 }

/**
 * 视窗宽高比。三档取景共用同一个比例，所以切换档位时桌宠的占地完全不变，
 * 只是「镜头推近」——固定尺寸的挂件位置上跳来跳去很难看。
 */
export const VIEW_ASPECT = 1.15

/**
 * UI 缩放的基准高度。气泡/按钮/菜单全部用 calc(... * var(--dshp-s)) 跟着模型一起缩放，
 * 否则把模型调小时，气泡和按钮还是原来那么大，看着就不协调。
 */
export const UI_BASE_HEIGHT = 180
