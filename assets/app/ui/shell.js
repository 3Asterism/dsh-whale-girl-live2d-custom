/** ui/shell.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

// ——————————————————————————————————————————————————————————————
// 九、输入框 / 菜单
// ——————————————————————————————————————————————————————————————

/**
 * 隐藏 / 恢复。
 *
 * 之前「隐藏之后再也找不回来」是因为小把手的显示条件写成了
 * `.dshp-root.dshp-hidden .dshp-tab`——把手挂在 body 上，不在 root 里，
 * 后代选择器永远匹配不到。现在改成 body 级类，并且收进这一个函数，
 * 保证「隐藏态」和「把手可见」永远同步。
 */
/**
 * 桌面壳（macOS 原生 App）的桥。
 * 壳子启动时会在页面里设 window.__DSHPET_SHELL__ = true，并挂一个 dshpetshell 消息通道。
 * 有它的时候：① 收起/展开走消息，立刻响应，不用等轮询；
 *             ② 设置页多出「收起成悬浮小球」和「彻底关闭桌宠应用」。
 */
export const shell = {
  on: !!(
    window.__DSHPET_SHELL__ &&
    window.webkit &&
    window.webkit.messageHandlers &&
    window.webkit.messageHandlers.dshpetshell
  ),
  post(msg) {
    try {
      window.webkit.messageHandlers.dshpetshell.postMessage(msg)
    } catch (e) {}
  },
}
