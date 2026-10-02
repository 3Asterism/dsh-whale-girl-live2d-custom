/**
 * 逐字流合并器（纯逻辑，定时器 / 时钟可注入，可单测）。
 *
 * 为什么要有：宿主以前对每一个 text-delta / reasoning-delta 都单独 JSON.stringify + 给每个客户端 write 一帧 SSE，
 * 深度思考动辄上万个增量，前端还要对每一帧 JSON.parse + 走一遍事件分发。默认的「安静模式」下前端根本不显示这些文字
 * （只用它判断「她在想 / 在回复」，以及回复开头 80 个字的语气），所以绝大多数帧是白传。
 *
 * 做法：同一个 (会话, 种类) 的增量，在一个窗口内攒成一帧；窗口的头一帧立刻发（首字不延迟——前端靠它切到「说话」状态）。
 * 前端是按顺序累加文字的，所以合并之后文字内容与顺序完全一致，只是帧数少了一个量级。
 *
 * 顺序保证：任何别的事件要发之前，必须先 flush()——不然「工具调用」可能跑到它前面那段文字的前头去。
 * 单槽设计：同一时刻最多攒一种 (会话, 种类)；换了种类（思考 → 回复）就先把旧的发掉，所以跨种类的先后也不会乱。
 */

/**
 * @param {{ emit: (payload: any) => void, intervalMs?: number, now?: () => number,
 *           setTimer?: (fn: () => void, ms: number) => any, clearTimer?: (h: any) => void }} deps
 */
export function createDeltaCoalescer({ emit, intervalMs = 100, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let pending = null // { sessionId, kind, text }
  let timer = null
  let lastEmitAt = -Infinity

  const out = () => {
    if (!pending) return
    const p = pending
    pending = null
    lastEmitAt = now()
    emit({ t: 'delta', sessionId: p.sessionId, kind: p.kind, text: p.text })
  }

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
  }

  return {
    /** 来了一个增量。 */
    push(sessionId, kind, text) {
      if (!text) return
      if (pending && (pending.sessionId !== sessionId || pending.kind !== kind)) {
        cancelTimer()
        out()
      }
      if (pending) {
        pending.text += text
        return
      }
      const wait = lastEmitAt + intervalMs - now()
      if (wait <= 0) {
        // 窗口已经过了：这一帧立刻发（首字不延迟）
        lastEmitAt = now()
        emit({ t: 'delta', sessionId, kind, text })
        return
      }
      pending = { sessionId, kind, text }
      timer = setTimer(() => {
        timer = null
        out()
      }, wait)
      // 不要因为这个定时器拖着宿主进程不退出
      if (timer && typeof timer.unref === 'function') timer.unref()
    },
    /** 别的事件要发了 / 要关了：把攒着的先发出去。 */
    flush() {
      cancelTimer()
      out()
    },
    /** 没有客户端了：攒的东西没人要，丢掉。 */
    drop() {
      cancelTimer()
      pending = null
    },
    /** 诊断 / 测试：现在攒着多少字。 */
    get pendingLength() {
      return pending ? pending.text.length : 0
    },
  }
}
