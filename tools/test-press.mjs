#!/usr/bin/env node
/**
 * test-press.mjs —— 「捏一下、弹一下」弹簧（engine/press-spring.js）的数值行为（纯 Node，不需要浏览器）。
 *   node tools/test-press.mjs
 *
 * 守住的是「手感」背后的数：
 *   · 按下快而干脆、不冲；松开欠阻尼、会晃（过冲 → 回弹 → 再过冲），并且在合理时间内落定；
 *   · 弹到一半被打断（又按下 / 又被戳）位移和速度连续，不跳帧；连戳能量叠加；
 *   · 压扁变宽、拉长变窄（体积大致守恒），纵向缩放永远 > 0；
 *   · 参数来自每个模型自己的 manifest.json「press」块，写坏 / 缺字段 / 越界都会被兜住，不会炸；
 *   · 极端参数、很大的 dt（切后台回来）下数值稳定。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { createPressSpring, resolveProfile, PRESS_DEFAULT } = await import(
  pathToFileURL(path.join(ROOT, 'assets', 'app', 'engine', 'press-spring.js')).href
)

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const P = resolveProfile({})
const mk = (profile = P) => createPressSpring(() => profile)
/** 以 4ms 一步推进 ms 毫秒，返回每步的 p 序列。 */
function run(s, ms) {
  const out = []
  for (let t = 0; t < ms; t += 4) {
    s.step(0.004)
    out.push(s.state().p)
  }
  return out
}
const firstIdx = (arr, f) => arr.findIndex(f)
const crossings = (arr, level = 0, eps = 0.01) => {
  let n = 0
  let sign = 0
  for (const x of arr) {
    if (Math.abs(x - level) < eps) continue
    const sg = x > level ? 1 : -1
    if (sign && sg !== sign) n++
    sign = sg
  }
  return n
}

console.log('\n弹簧 · 按下 / 松开\n')
{
  const s = mk()
  s.press()
  const seq = run(s, 600)
  const t95 = (firstIdx(seq, (p) => p >= 0.95) + 1) * 4
  check('按下：约 0.15s 内压到 95%（快而干脆）', t95 > 0 && t95 <= 150, `${t95}ms`)
  check('按下：不冲过头（最大 ≤ 1.02）', Math.max(...seq) <= 1.02, `max ${Math.max(...seq).toFixed(3)}`)
  check('按下：落定在满压并停住', s.settled() && Math.abs(s.state().p - 1) < 0.005)
}
{
  const s = mk()
  s.press()
  run(s, 800)
  s.release()
  const seq = run(s, 1200)
  const min = Math.min(...seq)
  const tMin = (seq.indexOf(min) + 1) * 4
  check('松开：冲过头变成拉长（p 最低 −0.5 ~ −0.2）', min <= -0.2 && min >= -0.5, `min ${min.toFixed(3)}`)
  check('松开：约 0.08–0.25s 冲到最远（不拖沓也不生硬）', tMin >= 80 && tMin <= 250, `${tMin}ms`)
  check('松开：至少穿过原样 2 次（回弹 + 再过冲，不是单次曲线）', crossings(seq) >= 2, `穿过 ${crossings(seq)} 次`)
  const iSettle = (() => {
    const sx = mk()
    sx.press()
    run(sx, 800)
    sx.release()
    for (let t = 0; t < 3000; t += 4) {
      sx.step(0.004)
      if (sx.settled()) return t + 4
    }
    return Infinity
  })()
  check('松开：1 秒内落定', iSettle <= 1000, `${iSettle}ms`)
  const sp = mk()
  sp.press()
  run(sp, 800)
  sp.release()
  run(sp, 3000)
  sp.snap()
  check('落定后吸附为精确 0（不残留抖动）', sp.state().p === 0 && sp.state().v === 0)
}
{
  // 对称性：同一参数下，按下和松开不是同一条曲线
  const down = mk()
  down.press()
  const dSeq = run(down, 600)
  const up = mk()
  up.press()
  run(up, 800)
  up.release()
  const uSeq = run(up, 600)
  check('不对称：按下单调不冲、松开会冲（和贝塞尔单曲线的本质区别）', Math.max(...dSeq) <= 1.02 && Math.min(...uSeq) < -0.2)
}

console.log('\n弹簧 · 打断与叠加\n')
{
  // 松到一半又按下：位移、速度连续
  const s = mk()
  s.press()
  run(s, 800)
  s.release()
  run(s, 60)
  const before = s.state()
  s.press()
  const after = s.state()
  check('弹到一半被按下：位移和速度原样保留（不跳帧）', after.p === before.p && after.v === before.v)
  const seq = run(s, 300)
  let maxJump = 0
  let prev = before.p
  for (const p of seq) {
    maxJump = Math.max(maxJump, Math.abs(p - prev))
    prev = p
  }
  check('打断之后逐步（4ms）位移变化都很小（< 0.04）', maxJump < 0.04, `最大步长 ${maxJump.toFixed(4)}`)
  check('打断之后回到满压', Math.abs(seq[seq.length - 1] - 1) < 0.05)
}
{
  const peak = (n) => {
    const s = mk()
    for (let i = 0; i < n; i++) s.kick(1)
    return Math.max(...run(s, 600))
  }
  const p1 = peak(1)
  const p2 = peak(2)
  check('kick(1) 从静止冲到的最大压缩 ≈ 满压（0.85–1.15）', p1 >= 0.85 && p1 <= 1.15, `peak ${p1.toFixed(3)}`)
  check('连着 kick 能量叠加（两下比一下压得更深）', p2 > p1 + 0.3, `${p1.toFixed(2)} → ${p2.toFixed(2)}`)
  const s = mk()
  s.kick(0)
  s.kick(-3)
  s.kick(NaN)
  s.kick('x')
  check('kick 给了 0 / 负数 / NaN / 非数字：忽略', s.state().v === 0)
  const a = mk()
  a.kick(0.5)
  const b = mk()
  b.kick(1.2)
  check('power 越大弹得越深（0.5 < 1 < 1.2）', Math.max(...run(a, 400)) < p1 && p1 < Math.max(...run(b, 400)))
}

console.log('\n弹簧 · 缩放（体积守恒）\n')
{
  const s = mk()
  s.press()
  run(s, 800)
  const full = s.scale()
  check('满压：纵向 = 1 − depth，横向变宽', Math.abs(full.sy - (1 - P.depth)) < 0.002 && full.sx > 1, `sx ${full.sx.toFixed(3)} sy ${full.sy.toFixed(3)}`)
  check('体积（面积）守恒程度：sx·sy 在 0.95–1.05 之间', full.sx * full.sy > 0.95 && full.sx * full.sy < 1.05, (full.sx * full.sy).toFixed(3))
  s.release()
  const seq = []
  for (let t = 0; t < 400; t += 4) {
    s.step(0.004)
    seq.push(s.scale())
  }
  const stretched = seq.find((x) => x.sy > 1.02)
  check('过冲拉长时：纵向变高、横向变窄（X / Y 反相）', !!stretched && stretched.sx < 1, stretched ? `sx ${stretched.sx.toFixed(3)} sy ${stretched.sy.toFixed(3)}` : '没出现拉长')
  const flat = mk({ ...P, volume: 0 })
  flat.press()
  run(flat, 800)
  check('volume=0：只纵向压，不变宽', flat.scale().sx === 1)
  const crazy = mk({ ...P, depth: 0.4 })
  crazy.kick(50)
  run(crazy, 100)
  check('极端冲量下纵向缩放仍 > 0（不翻转、不除零）', crazy.scale().sy > 0 && Number.isFinite(crazy.scale().sx))
}

console.log('\n弹簧 · 参数（每个模型自己一份）\n')
{
  const d = resolveProfile(undefined)
  check('没有 press 块：全部用缺省值', Object.keys(PRESS_DEFAULT).every((k) => JSON.stringify(d[k]) === JSON.stringify(PRESS_DEFAULT[k])))
  const junk = resolveProfile({ depth: 'abc', volume: null, pressOmega: NaN, releaseZeta: -5, anchor: 'nope', kick: Infinity })
  check('写坏的字段回落到缺省或夹到范围内', junk.depth === PRESS_DEFAULT.depth && junk.volume === PRESS_DEFAULT.volume && junk.pressOmega === PRESS_DEFAULT.pressOmega && junk.releaseZeta >= 0.05 && junk.anchor === 'content', JSON.stringify(junk))
  const big = resolveProfile({ depth: 9, volume: 9, pressOmega: 9999, releaseOmega: 0, pressZeta: 99, releaseZeta: 0, kick: 9999 })
  check('越界值被夹进安全范围', big.depth <= 0.4 && big.volume <= 1 && big.pressOmega <= 80 && big.releaseOmega >= 5 && big.pressZeta <= 2 && big.releaseZeta >= 0.05 && big.kick <= 120)
  const a = resolveProfile({ anchor: [0.4, 1.7] })
  check('自定义原点 [x, y] 被夹进 0–1', Array.isArray(a.anchor) && a.anchor[0] === 0.4 && a.anchor[1] === 1)
  check('原点写成长度不对的数组：回落到自动', resolveProfile({ anchor: [0.4] }).anchor === 'content')
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'model', 'manifest.json'), 'utf8'))
  const r = resolveProfile(m.press)
  check('模型 manifest 里有 press 块，且没有任何字段被夹动（写的就是生效的）', !!m.press && Object.keys(m.press).every((k) => JSON.stringify(r[k]) === JSON.stringify(m.press[k])), JSON.stringify(m.press))
  const build = fs.readFileSync(path.join(ROOT, 'tools', 'build-model.mjs'), 'utf8')
  check('build-model.mjs 生成 manifest 时带同一份 press（重建不会丢）', /press:\s*\{[^}]*depth:\s*0\.12/.test(build))
}

console.log('\n弹簧 · 稳定性\n')
{
  const hard = mk({ ...P, pressOmega: 80, pressZeta: 0.2, releaseOmega: 80, releaseZeta: 0.05 })
  hard.press()
  let bad = false
  for (let i = 0; i < 1250; i++) {
    hard.step(0.004)
    const { p, v } = hard.state()
    if (!Number.isFinite(p) || !Number.isFinite(v) || Math.abs(p) > 50) bad = true
    if (i === 600) hard.release()
  }
  check('最硬 / 最不阻尼的参数下 5 秒不发散（有限、有界）', !bad)
  const s = mk()
  s.press()
  s.step(60) // 切后台 60 秒回来
  check('一次给很大的 dt（切后台回来）被夹住，数值正常', Number.isFinite(s.state().p) && s.state().p <= 1.05)
  s.step(NaN)
  s.step(-1)
  check('dt 是 NaN / 负数：当作 0，不破坏状态', Number.isFinite(s.state().p))
  s.reset()
  check('reset 回到静止', s.state().p === 0 && s.state().v === 0 && s.state().target === 0)
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 通过 / ${fail} 失败\n`)
process.exit(fail === 0 ? 0 : 1)
