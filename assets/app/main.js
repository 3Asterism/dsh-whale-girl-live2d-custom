/** main.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { bondAwayCheck, bondRefresh } from './behavior/bond.js'
import { connectSSE } from './behavior/events.js'
import { wireFeed } from './behavior/feed.js'
import { wireInteractions } from './behavior/gestures.js'
import { startLoops } from './behavior/idle.js'
import { wirePageAwareness, wireTyping } from './behavior/page.js'
import { BASE } from './config.js'
import { EXPR, R, droppedParams } from './core/state.js'
import { log } from './core/util.js'
import { syncConds } from './director/conds.js'
import { buildModel, loadRuntime } from './engine/runtime.js'
import { buildUI } from './ui/build.js'
import { hudFetch } from './ui/hud.js'
import { injectStyle } from './ui/styles.js'
import './api/debug.js' // 副作用导入：加载后挂出 window.DSHPet

// ——————————————————————————————————————————————————————————————
// 五、启动
// ——————————————————————————————————————————————————————————————

async function main() {
  // buildUI 以前在 try 外面——它一旦抛异常，整页会静默什么都不显示，
  // 排查很痛苦。现在整个启动过程都在保护里，并且把错误挂到 window 上。
  try {
    injectStyle()
    R.ui = buildUI()
    await loadRuntime()
    const [man, cdi] = await Promise.all([
      fetch(BASE + '/model/manifest.json', { cache: 'no-cache' }).then((r) => r.json()),
      fetch(BASE + '/model/c_0120.cdi3.json', { cache: 'no-cache' }).then((r) => r.json()),
    ])
    R.manifest = man
    R.MODEL_PARAMS = new Set((cdi.Parameters || []).map((p) => p.Id))
    for (const [name, e] of Object.entries(R.manifest.expressions || {})) {
      const kept = []
      for (const p of e.params || []) {
        if (R.MODEL_PARAMS.has(p.id)) kept.push(p)
        else droppedParams.add(name + ' → ' + p.id)
      }
      if (kept.length) EXPR[name] = kept
    }
    if (droppedParams.size) {
      log(`已忽略 ${droppedParams.size} 个模型里不存在的参数引用：`, Array.from(droppedParams).join('、'))
    }
    await buildModel()
    wireInteractions()
    wirePageAwareness() // DSH 界面本身的操作（新建会话 / 开设置 / 换主题…）
    wireTyping() // 输入框：打字时看着、清空 = 撤回
    wireFeed() // 拖文件喂她
    connectSSE()
    startLoops()
    // 羁绊：先拉一份快照（台词分档 / 待机状态要读），稍后结算一次「离线小事件」（离开超过 2 小时才有）
    bondRefresh().then(() => setTimeout(() => bondAwayCheck(), 2500))
    hudFetch(false).catch(() => {}) // 预热 stats：每日问候要用「昨天吃了几碗饭」
    syncConds()
    log(
      `就绪：${R.manifest.displayName} · 动作 ${Object.keys(R.manifest.motions || {}).length} 个 · 可用表情 ${Object.keys(EXPR).length} 个`,
    )
  } catch (err) {
    window.__DSHPetError = String((err && err.stack) || err)
    console.error('[鲸鱼娘] 启动失败：', err)
    try {
      R.ui = R.ui || {}
      if (R.ui.bubble) {
        R.ui.bubble.show('启动失败：' + (err && err.message ? err.message : err), {
          name: '出错了',
          sticky: true,
        })
      }
    } catch (e) {}
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main)
else main()
