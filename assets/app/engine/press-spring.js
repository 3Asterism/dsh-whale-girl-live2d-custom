/**
 * engine/press-spring.js —— 「捏一下、弹一下」的弹簧（纯数学，不碰 DOM，Node 里能直接测）。
 *
 * 为什么是弹簧而不是 CSS 过渡 / 贝塞尔曲线（对照 dsh-whale-widget 的 `.22s cubic-bezier(.34,1.56,.64,1)` 之后改的）：
 *   · 贝塞尔曲线只能「冲过头一次就停」，而且按下和松开用的是同一条曲线 —— 按下时也会往下多冲一下，手感发软发飘；
 *     弹簧是「冲过头、回弹、再冲、越来越小」的衰减振荡，这才是东西被捏扁又弹开的样子；
 *   · 按下 / 松开该是**不对称**的：按下快而干脆（接近临界阻尼，不冲），松开才弹（欠阻尼，多晃几下）；
 *   · 状态（位移 p + 速度 v）是连续的：弹到一半又被按下 / 又被戳，速度接着用，不会跳帧；连戳还能把能量叠起来；
 *   · 压扁时横向要变宽、拉长时要变窄（体积大致守恒）。位移一旦冲到负数（= 过冲），纵向变高、横向变窄，
 *     X / Y 自然是反相晃的，不用另外写关键帧。
 *
 * 位移 p：0 = 原样，1 = 压到「该模型的满压」，p < 0 = 过冲（拉长）。纵向 sy = 1 − depth·p，
 * 横向 sx = (1 / sy)^volume（volume=1 是严格体积守恒，扁平立绘一般取 0.5–0.7 更自然，太守恒会显胖）。
 *
 * 不同模型不能直接套参数：画布留白多少、立绘是半身还是整张桌面场景、软不软，都不一样。
 * 所以参数不写死在代码里，而是放在模型自己的 manifest.json 的 `press` 块里（缺省值见 PRESS_DEFAULT），
 * 缩放原点默认自动取「实体范围的底边中点」（见 effects.js），换模型不用手填。
 */

/**
 * 缺省参数。ω（rad/s）是弹簧自然频率，ζ 是阻尼比：ζ < 1 会晃，ζ = 1 刚好不晃，越小晃得越久。
 * 松开：ω=22、ζ=0.3 —— 实测从满压松手，约 0.14s 冲到最远（p≈−0.37，纵向拉长 4%），随后 +0.13、−0.05，
 *       约 2.5 次晃动；0.6s 左右视觉上就稳了（残余 < 5%），1s 内完全停住。
 * 按下：ω=36、ζ=0.95 —— 实测约 0.1s 压到 95%，不冲。
 */
export const PRESS_DEFAULT = {
  depth: 0.12, // 满压时纵向缩多少（0.12 = 缩到 88%）
  volume: 0.6, // 体积守恒程度 0–1（横向变宽的幅度）
  anchor: 'content', // 缩放原点：'content' = 实体范围底边中点（自动测）| [x, y]（0–1 的画布分数）
  pressOmega: 36,
  pressZeta: 0.95,
  releaseOmega: 22,
  releaseZeta: 0.3,
  kick: 34, // qBounce(1) 给弹簧的速度冲量：实测从静止冲到的最大压缩 ≈ 满压（p≈1，数值由测试守住）
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const num = (x, d) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : d)

/** 把 manifest 里的 press 块（可能缺字段、可能写坏）整理成安全的参数。 */
export function resolveProfile(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const d = PRESS_DEFAULT
  let anchor = d.anchor
  if (Array.isArray(r.anchor) && r.anchor.length === 2 && r.anchor.every((x) => Number.isFinite(Number(x)))) {
    anchor = [clamp(Number(r.anchor[0]), 0, 1), clamp(Number(r.anchor[1]), 0, 1)]
  }
  return {
    depth: clamp(num(r.depth, d.depth), 0, 0.4),
    volume: clamp(num(r.volume, d.volume), 0, 1),
    anchor,
    pressOmega: clamp(num(r.pressOmega, d.pressOmega), 5, 80),
    pressZeta: clamp(num(r.pressZeta, d.pressZeta), 0.2, 2),
    releaseOmega: clamp(num(r.releaseOmega, d.releaseOmega), 5, 80),
    releaseZeta: clamp(num(r.releaseZeta, d.releaseZeta), 0.05, 2),
    kick: clamp(num(r.kick, d.kick), 0, 120),
  }
}

const SUBSTEP = 1 / 240 // 半隐式欧拉在 ω·h ≤ 0.35 时稳定；ω 最大 80 → 0.33，够用

/**
 * @param {() => ReturnType<typeof resolveProfile>} getProfile 每步现取，换模型 / 改参数立刻生效
 */
export function createPressSpring(getProfile) {
  const s = { p: 0, v: 0, target: 0 }

  return {
    state: () => ({ p: s.p, v: s.v, target: s.target }),

    /** 按下：目标压到 1（快、不冲）。 */
    press() {
      s.target = 1
    },
    /** 松开：目标回 0（欠阻尼，会弹）。位移和速度原样保留 —— 弹到一半被打断也不跳帧。 */
    release() {
      s.target = 0
    },
    /**
     * 给一下冲量（程序化的「弹一下」，比如庆祝 / 被连戳）。power=1 约等于一次满压的弹跳。
     * 加的是速度不是位移：从静止出发会平滑地压下去再弹开；连着戳，能量会叠加。
     */
    kick(power) {
      const k = Number(power)
      if (!Number.isFinite(k) || k <= 0) return
      s.v += getProfile().kick * k
    },

    /** 推进 dt 秒（内部切成 1/240s 小步）。 */
    step(dt) {
      const P = getProfile()
      const pressing = s.target === 1
      const w = pressing ? P.pressOmega : P.releaseOmega
      const z = pressing ? P.pressZeta : P.releaseZeta
      let t = clamp(Number(dt) || 0, 0, 0.05) // 切后台回来 dt 很大，别一口气积分爆掉
      while (t > 1e-9) {
        const h = Math.min(SUBSTEP, t)
        s.v += (-w * w * (s.p - s.target) - 2 * z * w * s.v) * h
        s.p += s.v * h
        t -= h
      }
    },

    /** 落定了吗（位移贴着目标、速度几乎为 0）。落定后调用方就可以停掉 rAF。 */
    settled() {
      return Math.abs(s.p - s.target) < 0.002 && Math.abs(s.v) < 0.02
    },
    /** 落定后把数值吸附到目标，避免残留 0.001 的抖动。 */
    snap() {
      s.p = s.target
      s.v = 0
    },
    /** 回到静止（换模型 / 重置用）。 */
    reset() {
      s.p = 0
      s.v = 0
      s.target = 0
    },

    /** 当前的缩放。sy 永远 > 0。 */
    scale() {
      const P = getProfile()
      const sy = Math.max(0.2, 1 - P.depth * s.p)
      const sx = Math.pow(1 / sy, P.volume)
      return { sx, sy }
    },
  }
}
