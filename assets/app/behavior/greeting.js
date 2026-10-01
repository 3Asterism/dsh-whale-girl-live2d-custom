/** behavior/greeting.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { PRI, perform } from '../director/perform.js'
import { claim } from '../net/api.js'
import { lineFor } from '../persona/lines.js'
import { hud } from '../ui/hud.js'
import { bondAct } from './bond.js'

/** 每日第一次对话：按时段问候；周末 / 周一 / 周五还在干活的，换成更贴的那句；带上「昨天吃了几碗饭」。 */
let greetBusy = false

export async function maybeGreet() {
  if (greetBusy) return
  greetBusy = true
  try {
    if (!(await claim('greet', 'day'))) return
    const d = new Date()
    const h = d.getHours()
    const dow = d.getDay()
    const id = h < 5 ? 'greetLate' : h < 11 ? 'greetMorning' : h < 14 ? 'greetNoon' : h < 18 ? 'greetAfternoon' : h < 23 ? 'greetEvening' : 'greetLate'
    const special = h >= 5 ? (dow === 0 || dow === 6 ? 'weekend' : dow === 1 ? 'monday' : dow === 5 ? 'friday' : null) : null
    let line = lineFor(special || id)
    const yest = hud.stats && hud.stats.riceYesterday
    if (line && !special && yest > 0) line += '\n昨天吃了 ' + yest + ' 碗饭～'
    bondAct('daily')
    perform({ id: 'greet', pri: PRI.CUE, tier: 'extra', mood: 'happy', line, ms: 4200, habit: false })
  } finally {
    greetBusy = false
  }
}
