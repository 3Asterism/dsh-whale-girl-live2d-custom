/** ui/menu/pane-settings.js —— 菜单「设置」页：大小 / 视线 / 口型 / 安静模式 / 一键重置 / 位置 / 桌面壳选项，末尾挂钱包配置。 */

import { resetEverything } from '../../behavior/reset.js'
import { CFG } from '../../config.js'
import { R } from '../../core/state.js'
import { readLayout, saveLayout } from '../../core/storage.js'
import { $, clamp } from '../../core/util.js'
import { gazeCfg } from '../../engine/gaze.js'
import { squeak } from '../../engine/squeak.js'
import { applyPosition, clampPanels, fitModel } from '../layout.js'
import { closePanels, setHidden } from '../panels.js'
import { shell } from '../shell.js'
import { buildWalletSection } from './pane-wallet.js'

export function renderSettingsPane(panes, rerender) {
  const box = $('div')
  const label = $('label', 'dshp-label')
  label.append($('span', null, '大小'))
  const range = document.createElement('input')
  range.type = 'range'
  range.min = '150'
  range.max = '720'
  range.value = String(clamp(Number(readLayout().height) || CFG.height, 150, 720))
  range.title = '也可以直接拖（点 − / + 更省事）'
  // 主人要求：大小主要用「加 / 减」点一下调，不要只能拖滑块
  const stepSize = (delta) => {
    const next = clamp(Number(range.value) + delta, 150, 720)
    range.value = String(next)
    sizeOut.textContent = next + 'px'
    fitModel(next)
    saveLayout({ height: next })
    clampPanels()
  }
  const mkStep = (txt, delta) => {
    const b = $('button', 'dshp-btn dshp-step', txt)
    b.title = (delta > 0 ? '放大' : '缩小') + '（每下 ' + Math.abs(delta) + 'px）'
    b.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      stepSize(delta)
    })
    return b
  }
  const sizeOut = $('span', null, range.value + 'px')
  sizeOut.style.minWidth = '46px'
  sizeOut.style.fontVariantNumeric = 'tabular-nums'
  const stepRow = $('div', 'dshp-row')
  stepRow.append(mkStep('−', -20), sizeOut, mkStep('+', 20))
  // 拖的时候冻住 UI 缩放（见 sizingSize），松手再让面板跟上新尺寸——
  // 这样滑块轨道全程钉在原地，可以一路拖到底。
  const beginSize = () => {
    R.sizingSize = true
    R.ui.root.classList.add('dshp-sizing')
  }
  const endSize = () => {
    if (!R.sizingSize) return
    R.sizingSize = false
    R.ui.root.classList.remove('dshp-sizing')
    fitModel(Number(range.value))
    saveLayout({ height: Number(range.value) })
    clampPanels()
  }
  range.addEventListener('pointerdown', beginSize)
  range.addEventListener('pointerup', endSize)
  range.addEventListener('pointercancel', endSize)
  range.addEventListener('change', endSize)
  range.addEventListener('keydown', beginSize)
  range.addEventListener('keyup', endSize)
  range.addEventListener('input', () => {
    sizeOut.textContent = Number(range.value) + 'px'
    fitModel(Number(range.value))
    saveLayout({ height: Number(range.value) })
    if (!R.sizingSize) clampPanels()
  })
  label.appendChild(range)
  box.appendChild(label)
  box.appendChild(stepRow)

  // 视线灵敏度：实时生效，直接写进 CFG
  const g0 = gazeCfg()
  const mkGaze = (label, key, min, max, step, value, fmt) => {
    const l = $('label', 'dshp-label')
    l.append($('span', null, label))
    const r = document.createElement('input')
    r.type = 'range'
    r.min = String(min); r.max = String(max); r.step = String(step)
    r.value = String(value)
    const out = $('span', null, fmt(Number(r.value)))
    out.style.minWidth = '38px'
    out.style.textAlign = 'right'
    out.style.opacity = '.7'
    r.addEventListener('input', () => {
      CFG[key] = Number(r.value)
      out.textContent = fmt(Number(r.value))
    })
    l.append(r, out)
    return l
  }
  box.append(
    $('div', 'dshp-hint', '视线灵敏度（拖动即时生效）'),
    mkGaze('跟随幅度', 'gazeGain', 0, 1, 0.02, g0.gain, (v) => v.toFixed(2)),
    mkGaze('跟随速度', 'gazeRate', 0.3, 4, 0.1, g0.rate, (v) => v.toFixed(1)),
    mkGaze('跟随范围', 'gazeRadius', 0, 2000, 50, g0.radius, (v) => (v <= 0 ? '整屏' : String(v))),
  )

  const row1 = $('div', 'dshp-row')
  const eyeBtn = $('button', 'dshp-btn', CFG.lookAtCursor ? '视线跟随：开' : '视线跟随：关')
  eyeBtn.addEventListener('click', () => {
    CFG.lookAtCursor = !CFG.lookAtCursor
    eyeBtn.textContent = CFG.lookAtCursor ? '视线跟随：开' : '视线跟随：关'
  })
  const mouthBtn = $('button', 'dshp-btn', CFG.talkMouth ? '说话口型：开' : '说话口型：关')
  mouthBtn.addEventListener('click', () => {
    CFG.talkMouth = !CFG.talkMouth
    mouthBtn.textContent = CFG.talkMouth ? '说话口型：开' : '说话口型：关'
  })
  const chatBtn = $('button', 'dshp-btn', CFG.repeatChat ? '安静模式：关' : '安静模式：开')
  chatBtn.title = '安静模式：开 = 气泡不照抄「你问了什么 / 她回了什么」，也不写过程流水账（工具路径、工具名、第 N 步、分身提示）；她自己的台词、动作、表情、报错、结算那行「耗时 · N tokens」、钱包面板都照常。（就是原来的「复述对话原文」开关，默认开）'
  chatBtn.addEventListener('click', () => {
    CFG.repeatChat = !CFG.repeatChat
    chatBtn.textContent = CFG.repeatChat ? '安静模式：关' : '安静模式：开'
    saveLayout({ repeatChat: CFG.repeatChat })
  })
  row1.append(eyeBtn, mouthBtn, chatBtn)

  // 按压音效：点她「吱」一声、松开「呼」一声。开关和音量都是这台机器上这个人的偏好，存本地
  const sndLabel = (on) => (on ? '按压音效：开' : '按压音效：关')
  const sndBtn = $('button', 'dshp-btn', sndLabel(CFG.sound))
  sndBtn.title = '点她（按下）挤一声，松开回一口气——小黄鸭那种。关掉就完全静音，连音频设备都不会去碰。'
  sndBtn.addEventListener('click', () => {
    CFG.sound = !CFG.sound
    squeak.setOn(CFG.sound)
    sndBtn.textContent = sndLabel(CFG.sound)
    saveLayout({ sound: CFG.sound })
  })
  const sndRow = $('div', 'dshp-row')
  sndRow.append(sndBtn)
  const volLabel = $('label', 'dshp-label')
  volLabel.append($('span', null, '音效音量'))
  const vol = document.createElement('input')
  vol.type = 'range'
  vol.min = '0'
  vol.max = '1'
  vol.step = '0.05'
  vol.value = String(CFG.soundVol)
  const volOut = $('span', null, Math.round(CFG.soundVol * 100) + '%')
  volOut.style.minWidth = '38px'
  volOut.style.textAlign = 'right'
  volOut.style.opacity = '.7'
  vol.addEventListener('input', () => {
    CFG.soundVol = Number(vol.value)
    squeak.setVolume(CFG.soundVol)
    volOut.textContent = Math.round(CFG.soundVol * 100) + '%'
  })
  vol.addEventListener('change', () => {
    saveLayout({ soundVol: CFG.soundVol })
    // 松手试响一声，调完马上知道多大声（音效关着就静音，down() 自己会挡掉）
    squeak.down()
    setTimeout(() => squeak.up(), 60)
  })
  volLabel.append(vol, volOut)

  const row0 = $('div', 'dshp-row')
  const resetAll = $('button', 'dshp-btn dshp-primary', '一键重置所有状态')
  resetAll.addEventListener('click', () => {
    resetEverything()
    rerender()
    R.ui.bubble.show('回到平常状态啦', { name: '鲸鱼娘', ttl: 2200 })
  })
  row0.appendChild(resetAll)
  box.append(row0, $('div', 'dshp-hint', '点它就把表情、道具、姿势、位置全部恢复成「拿本子拿笔」的正常状态。'))

  const row2 = $('div', 'dshp-row')
  const reset = $('button', 'dshp-btn', '回到角落')
  reset.addEventListener('click', () => {
    for (const k of ['left', 'top', 'right', 'bottom']) R.ui.root.style[k] = ''
    saveLayout({ x: null, y: null })
    applyPosition(readLayout())
  })
  const hide = $('button', 'dshp-btn', shell.on ? '隐藏桌宠（缩成贴边小球）' : '隐藏桌宠（右下角把手叫回来）')
  hide.addEventListener('click', () => {
    closePanels()
    setHidden(true)
  })
  row2.append(reset, hide)
  if (shell.on) {
    const row3 = $('div', 'dshp-row')
    const toBall = $('button', 'dshp-btn', '收起成悬浮小球')
    toBall.addEventListener('click', () => {
      closePanels()
      setHidden(true)
    })
    const quitApp = $('button', 'dshp-btn', '彻底关闭桌宠应用')
    quitApp.addEventListener('click', () => {
      R.ui.bubble.show('人家先退下了，想叫我就去「应用程序」里双击我～', { name: '鲸鱼娘', ttl: 2000 })
      setTimeout(() => shell.post('quit'), 220)
    })
    row3.append(toBall, quitApp)
    box.append(row3, $('div', 'dshp-hint', '「收起」= 缩成贴边的悬浮小球；「关闭」= 真正退出这个桌面 App。'))
  }

  buildWalletSection(box)

  box.append(
    row1,
    sndRow,
    volLabel,
    row2,
    $('div', 'dshp-hint', '拖动可以换位置；右键或 ⋯ 叫出菜单。\n表情平时由她自己挑——你在这里选只是 30 秒的临时心情，她遇到正事会自己换回来。\n\n话痨度、应景装扮、番茄钟、好感相关的一切开关，都在「好感」页。'),
  )
  panes.appendChild(box)
  // 换页后面板高度会变，可能顶到屏幕外面去（立刻夹一次 + 下一帧兜底）
  clampPanels()
  requestAnimationFrame(() => clampPanels())
}
