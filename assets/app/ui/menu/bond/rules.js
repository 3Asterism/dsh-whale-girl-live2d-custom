/** ui/menu/bond/rules.js —— 「规则说明」分区：衰减、倍率、token、饱腹这些数值全部摊开，数值都读宿主快照，不在前端写死。 */

import { $ } from '../../../core/util.js'
import { fmtMs, kv, section } from './widgets.js'

export function renderRules(snap) {
  const r = snap.rules || {}
  const d = snap.decay.rule
  return section('rules', '规则说明', '没有隐性设定', (body) => {
    const lines = [
      `【衰减】连续 ${d.idleWorkdays} 个工作日没互动，之后每个工作日 −${d.perDay}。只会削掉「本级内」的进度，绝不掉级；Lv.${d.stopAtLevel} 以后完全不衰减。周末和法定假日不算。`,
      '【没有惩罚】不会饿死、不会生病、不会离家出走。她只是会想你。',
      '【倍率】过年、情人节这类节日和「相识纪念日」，当天获得的羁绊值 ×2（扣分不翻倍）。',
    ]
    if (r.tickets) {
      lines.push(`【她的 token 存量】开局 ${r.tickets.start} 个；每完成一轮对话 +${r.tickets.perTurn}，你每花掉 ${r.tickets.tokensPer / 10000} 万 token 她再多攒 1 个，单轮最多 +${r.tickets.maxPerTurn}；库存上限 ${r.tickets.cap}。投喂时花掉。`)
    }
    if (r.rice) lines.push(`【一碗饭】= ${r.rice.tokensPerBowl / 10000} 万 token；每碗给 ${r.rice.fullPerBowl} 饱腹，每轮至少给 ${r.rice.minFullPerTurn}。`)
    if (r.full) lines.push(`【饱腹】每 ${fmtMs(r.full.decayEveryMs)} −1，最低 ${r.full.floor}；低于 ${r.full.hungry} 她会饿，高于 ${r.full.stuffed} 就撑着了。`)
    if (r.mood) lines.push(`【心情】会慢慢回到 ${r.mood.base}（每 ${fmtMs(r.mood.regenEveryMs)} 回 1 点）。`)
    if (r.awayMinMs) lines.push(`【离线小事件】你离开超过 ${fmtMs(r.awayMinMs)} 再回来，她会讲一件「你不在时做的事」，顺手捡到 0–${r.awayMaxTickets} 个 token。`)
    if (r.companionEveryMs) lines.push(`【陪伴】连续在干活，每满 ${fmtMs(r.companionEveryMs)} 算一次陪伴。`)
    if (r.memoryXp) lines.push(`【回忆】每解锁一条回忆 +${r.memoryXp}。`)
    for (const t of lines) body.append($('div', 'dshp-hint', t))

    body.append(kv('当前衰减', snap.decay.active ? `已 ${snap.decay.idleWorkdays} 个工作日没互动` : '不会衰减（Lv.' + d.stopAtLevel + '+）'))
    body.append($('div', 'dshp-hint', '羁绊值、token、故事都存在宿主那边（~/.dsh），网页版和桌面壳是同一份。'))
  })
}
