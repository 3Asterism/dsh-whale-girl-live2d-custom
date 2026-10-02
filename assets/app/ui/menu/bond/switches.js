/** ui/menu/bond/switches.js —— 「互动开关」分区：她会在哪些地方自己有反应，每一项都能关；番茄钟也在这里。 */

import { setBondEnabled } from '../../../behavior/bond.js'
import { POMO, pomoLeft, startPomo, stopPomo } from '../../../behavior/pomodoro.js'
import { CFG } from '../../../config.js'
import { saveLayout } from '../../../core/storage.js'
import { $ } from '../../../core/util.js'
import { syncConds } from '../../../director/conds.js'
import { chatLevel } from '../../../director/perform.js'
import { section } from './widgets.js'

const CHATTY_NAMES = ['安静', '普通', '话痨']

/** 一个「名字：开 / 关」的按钮，点一下翻转并记住。 */
function toggleRow(body, { key, label, hint, on = () => CFG[key] !== false, set, onChange }) {
  const row = $('div', 'dshp-row')
  const b = $('button', 'dshp-btn', `${label}：${on() ? '开' : '关'}`)
  b.addEventListener('click', () => {
    const next = !on()
    if (set) set(next)
    else {
      CFG[key] = next
      saveLayout({ [key]: next })
    }
    b.textContent = `${label}：${next ? '开' : '关'}`
    if (onChange) onChange(next)
  })
  row.append(b)
  body.append(row, $('div', 'dshp-hint', hint))
}

const mmss = (ms) => {
  const s = Math.ceil(ms / 1000)
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
}

export function renderSwitches(snap, rerender) {
  return section('switches', '互动开关', '她哪里会自己有反应', (body) => {
    // 总开关：关掉就是没有养成系统的鲸鱼娘（不影响下面这些「反应」）
    toggleRow(body, {
      label: '羁绊系统',
      on: () => snap.enabled,
      set: (v) => setBondEnabled(v).then(rerender),
      hint: '关掉：不再累计羁绊值和 token，也没有故事和回忆，不会有「她有话想说」。已有的进度原样保存，打开就接着来。',
    })

    // 话痨度：管她「主动开口、互动搭话」多不多；和「安静模式」（复述对话原文）是两件事
    const row = $('div', 'dshp-row')
    const chatty = $('button', 'dshp-btn', '话痨度：' + CHATTY_NAMES[chatLevel()])
    chatty.addEventListener('click', () => {
      CFG.chatty = (chatLevel() + 1) % 3
      chatty.textContent = '话痨度：' + CHATTY_NAMES[CFG.chatty]
      saveLayout({ chatty: CFG.chatty })
    })
    row.append(chatty)
    body.append(row, $('div', 'dshp-hint', '安静 = 只在报错、等你批准、收工时说话；普通 = 再加上摸头、点界面按钮、关键词、日常提醒；话痨 = 连开关侧栏、复制这种小动作也会搭话。'))

    toggleRow(body, {
      key: 'flair',
      label: '应景装扮',
      on: () => CFG.flair !== false,
      hint: '计划模式戴方眼镜、叫分身时头顶蹲一只鲸、放行模式戴墨镜、番茄钟戴发箍。你自己戴的同类装饰优先，不会被顶掉。',
      onChange: () => syncConds(),
    })
    toggleRow(body, {
      key: 'nightCloth',
      label: '夜晚桌布',
      on: () => CFG.nightCloth === true,
      hint: '22:00–06:00 自动换深色桌布。默认关：她待机的样子不该自己变。',
      onChange: () => syncConds(),
    })
    toggleRow(body, { key: 'pageAware', label: '界面操作反应', hint: '你点新建会话、开设置、换主题这类 DSH 界面按钮，或者换模型、改权限、她向你提问时，她会有反应。只读不拦截，不影响 DSH 本身。' })
    toggleRow(body, { key: 'keywords', label: '关键词反应', hint: '你说「谢谢」「晚安」「饿了」之类的口语短句时她会接话；只在本地匹配，不上传、不落盘。' })
    toggleRow(body, { key: 'routine', label: '日常提醒', hint: '饭点、下午茶、喝水、久坐、深夜。只在空闲时出气泡，不弹面板，错过就算了，不补播。' })
    toggleRow(body, { key: 'stickers', label: '表情包', hint: '她说话时，台词后面跟一张小表情包（赤风RED《蓝色大肥鱼》）；深度思考、余额不足、提议被拒这类时刻也会只丢一张图。图不会拖长气泡，只是点缀。关掉就只有文字。' })
    toggleRow(body, { key: 'idleChat', label: '发呆搭话', hint: '你在输入框里写了一半停着不动、或者开着 DSH 很久没动静时，她偶尔冒出来问一句。只在话痨档出现，一天不会很多次。' })
    toggleRow(body, { key: 'typing', label: '打字互动', hint: '你在输入框打字时她看着输入框；把写了一半的长句全删掉，她会假装什么都没看见。' })

    // 番茄钟：唯一需要主动开的功能
    const mkPomoLabel = () =>
      POMO.phase === 'off' ? '番茄钟：开始（25 分钟）' : POMO.phase === 'focus' ? `专注中 ${mmss(pomoLeft())}（点一下放弃）` : `休息中 ${mmss(pomoLeft())}（点一下结束）`
    const prow = $('div', 'dshp-row')
    const pomo = $('button', 'dshp-btn', mkPomoLabel())
    POMO.onTick = () => {
      pomo.textContent = mkPomoLabel()
    }
    pomo.addEventListener('click', () => {
      if (POMO.phase === 'off') startPomo()
      else stopPomo(false)
      pomo.textContent = mkPomoLabel()
    })
    prow.append(pomo)
    body.append(prow, $('div', 'dshp-hint', '专注 25 分钟 → 她挤番茄酱庆祝（番茄钟 = 番茄酱）→ 休息 5 分钟。专注期间她会戴上发箍。'))
  })
}
