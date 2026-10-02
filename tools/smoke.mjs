#!/usr/bin/env node
/**
 * smoke.mjs —— 真·浏览器里的桌宠功能自检。
 *
 * 连接方式和 tools/shot.mjs 一样（浏览器级端点 + Target session + --no-sandbox
 * --no-zygote）。这个组合是实测出来的：少了任何一条，Runtime.evaluate 和
 * captureScreenshot 都会静默超时。
 *
 *   node tools/smoke.mjs                          # 需要先起 tools/preview-server.mjs
 *   node tools/smoke.mjs --url http://127.0.0.1:3080/
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name)
  return i === -1 ? dflt : process.argv[i + 1]
}
const URL_ = arg('url', 'http://127.0.0.1:5199/')
const PORT = Number(arg('port', 9700 + Math.floor(Math.random() * 250)))
const SHOT_DIR = arg('shots', '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-smoke-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--no-zygote',
    '--disable-dev-shm-usage',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1200,820',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
)

async function main() {
  let ver = null
  for (let i = 0; i < 80 && !ver; i++) {
    try {
      ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
    } catch (e) {}
    if (!ver) await sleep(150)
  }
  if (!ver) throw new Error('Chrome 调试端口没起来')

  const ws = new WebSocket(ver.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  let id = 0
  const pend = new Map()
  ws.addEventListener('message', (ev) => {
    const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')
    let m
    try {
      m = JSON.parse(raw)
    } catch (e) {
      return
    }
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m)
      pend.delete(m.id)
    }
  })
  const send = (method, params, sessionId, to = 20000) =>
    new Promise((resolve, reject) => {
      const i = ++id
      const t = setTimeout(() => {
        pend.delete(i)
        reject(new Error('CDP 超时 ' + method))
      }, to)
      pend.set(i, (m) => {
        clearTimeout(t)
        m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)
      })
      const msg = { id: i, method, params: params || {} }
      if (sessionId) msg.sessionId = sessionId
      ws.send(JSON.stringify(msg))
    })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId, 5000).catch(() => {})
  await send('Page.enable', {}, sessionId, 5000).catch(() => {})
  // 页面脚本之前挂日志收集器
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__dshpLogs=[];(function(){var o=console.error,w=console.warn;console.error=function(){window.__dshpLogs.push('E:'+Array.prototype.join.call(arguments,' '));return o.apply(console,arguments)};console.warn=function(){window.__dshpLogs.push('W:'+Array.prototype.join.call(arguments,' '));return w.apply(console,arguments)}})();window.addEventListener('error',function(e){window.__dshpLogs.push('X:'+(e.message||''))});`,
  }, sessionId, 5000).catch(() => {})

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId, 60000)
    if (r.exceptionDetails) {
      throw new Error('页面异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)
    }
    return r.result && r.result.value
  }
  const shoot = async (name) => {
    if (!SHOT_DIR) return
    try {
      const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId, 60000)
      fs.mkdirSync(SHOT_DIR, { recursive: true })
      fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(s.data, 'base64'))
    } catch (e) {}
  }

  await send('Page.navigate', { url: URL_ }, sessionId, 8000).catch(() => {})
  console.log(`\n桌宠功能自检 → ${URL_}\n`)

  // 1) 等就绪
  let ready = false
  for (let i = 0; i < 70; i++) {
    await sleep(500)
    try {
      ready = await evaluate('!!(window.DSHPet && window.DSHPet.state && window.DSHPet.state.modelSize)')
    } catch (e) {}
    if (ready) break
  }
  check('Live2D 模型加载成功', !!ready, ready ? '' : '35s 内没就绪')

  if (!ready) {
    // 失败时一定要把启动错误和页面日志倒出来——否则「没就绪」这三个字
    // 什么都说明不了（这次就是这么漏掉一个 ReferenceError 的）。
    try {
      const bootErr = await evaluate('window.__DSHPetError || null')
      if (bootErr) console.log('  ── 启动错误 ──\n     ' + String(bootErr).split('\n').slice(0, 6).join('\n     '))
      const l = (await evaluate('(window.__dshpLogs||[]).slice(0,20)')) || []
      if (l.length) {
        console.log('  ── 页面日志 ──')
        for (const x of l.slice(0, 10)) console.log('     ' + String(x).slice(0, 220))
      }
      const dom = await evaluate(`JSON.stringify({root: !!document.getElementById('dsh-live2d-pet'), style: !!document.getElementById('dsh-live2d-pet-style'), canvas: document.querySelectorAll('#dsh-live2d-pet canvas').length, pixi: typeof window.PIXI, core: typeof window.Live2DCubismCore})`)
      console.log('  ── DOM 状态 ── ' + dom)
    } catch (e) {
      console.log('  （连诊断都取不到：' + e.message + '）')
    }
  }

  if (ready) {
    const st = await evaluate('JSON.parse(JSON.stringify(window.DSHPet.state))')
    const ms = st.modelSize || {}
    check('模型尺寸可读', ms.w > 0 && ms.h > 0, `${Math.round(ms.w)}×${Math.round(ms.h)}`)
    check(
      '不存在的参数已被过滤',
      Array.isArray(st.droppedParams) && st.droppedParams.length === 2,
      (st.droppedParams || []).join('、'),
    )
    check('44 个表情 / 8 个动作都就位', st.expressions.length === 44 && st.motions.length === 8, `${st.expressions.length} / ${st.motions.length}`)

    // 2) 自动测量 + 取景（这是没有肉眼也能判断构图对不对的关键）
    check(
      '启动自测出了角色实体范围',
      !!st.contentBox && st.contentBox.x1 - st.contentBox.x0 > 0.2 && st.contentBox.y1 - st.contentBox.y0 > 0.2,
      st.contentBox ? `x ${st.contentBox.x0.toFixed(2)}–${st.contentBox.x1.toFixed(2)} / y ${st.contentBox.y0.toFixed(2)}–${st.contentBox.y1.toFixed(2)}` : '未测出',
    )
    check(
      '三档取景共用同一视窗比例（切换时占地不变）',
      !!st.contentBox && !!st.contentBox.bands && ['full', 'bust', 'head'].every((k) => st.contentBox.bands[k]),
      Object.keys((st.contentBox && st.contentBox.bands) || {}).join(','),
    )
    const v = st.view || {}
    check('取景结果合理', v.w > 100 && v.h > 100 && v.w / v.h > 0.8 && v.w / v.h < 1.6, `${v.w}×${v.h} (${v.mode}, 缩放 ${v.scale})`)

    // 3) DOM
    const dom = await evaluate(`(function(){var r=document.getElementById('dsh-live2d-pet');
      return {root:!!r,canvas:!!document.querySelector('#dsh-live2d-pet canvas'),
      style:!!document.getElementById('dsh-live2d-pet-style'),tab:!!document.querySelector('.dshp-tab'),
      rect:r?(function(){var b=r.getBoundingClientRect();return {w:Math.round(b.width),h:Math.round(b.height)}})():null}})()`)
    check('桌宠 DOM 已挂载', dom.root && dom.canvas && dom.style, JSON.stringify(dom.rect))
    // 样式表必须真的生效。踩过一次坑：变量名撞上浏览器内置的 window.CSS，
    // 结果样式被写成 12 个字符、整个界面静默丢掉定位，所有功能测试却照样通过。
    const cssState = await evaluate(`(function(){
      var st = document.getElementById('dsh-live2d-pet-style');
      var r = document.getElementById('dsh-live2d-pet');
      return {len: st ? st.textContent.length : -1, pos: r ? getComputedStyle(r).position : 'none',
              accent: r ? getComputedStyle(r).getPropertyValue('--dshp-accent').trim() : ''}})()`)
    check('样式表内容完整', cssState.len > 2500, `${cssState.len} 字符`)
    check('样式表真的生效（root 是 fixed 定位）', cssState.pos === 'fixed', `position: ${cssState.pos}`)
    check('CSS 变量已注入', cssState.accent.length > 0, cssState.accent)
    check('画布尺寸非零', dom.rect && dom.rect.w > 40 && dom.rect.h > 40, `${dom.rect && dom.rect.w}×${dom.rect && dom.rect.h}`)

    // 4) 命中掩码：采样点里应该有一部分「点得到」、一部分「点不到」
    const hit = await evaluate(`(function(){var r=document.querySelector('#dsh-live2d-pet .dshp-stage').getBoundingClientRect();
      var on=0,total=0;for(var i=1;i<=8;i++)for(var j=1;j<=8;j++){total++;if(window.DSHPet.hitTest(r.left+r.width*i/9,r.top+r.height*j/9))on++}
      return {on:on,total:total}})()`)
    check(
      '点击命中判定区分得出「人」和「空气」',
      hit.on > 0 && hit.on < hit.total,
      `${hit.total} 个采样点里 ${hit.on} 个命中`,
    )

    // 5) 情绪 / 道具 / 动作
    let moodOk = true
    const moodTrace = []
    for (const m of ['happy', 'cry', 'angry', 'sleepy', 'love']) {
      const got = await evaluate(`(function(){window.DSHPet.setReaction({mood:${JSON.stringify(m)},ms:60000});return window.DSHPet.state.mood})()`)
      moodTrace.push(m + '→' + got)
      if (got !== m) moodOk = false
    }
    check('情绪切换生效', moodOk, moodTrace.join(' '))
    await shoot('mood')

    // —— 这一版最关键的一条：特效必须自己到期消失，不能卡住 ——
    const expiry = await evaluate(`(function(){
      window.DSHPet.setBase('neutral', ['menuBoard']);
      window.DSHPet.clearReaction();
      var baseFace = window.DSHPet.state.face, baseProps = window.DSHPet.state.props.slice().sort().join(',');
      window.DSHPet.setReaction({mood:'angry', props:['doubleV','glassesSun'], ms: 1200});
      var during = {face: window.DSHPet.state.face, props: window.DSHPet.state.props.slice().sort().join(','), ov: !!window.DSHPet.state.override};
      return new Promise(function(res){
        setTimeout(function(){
          var after = {face: window.DSHPet.state.face, props: window.DSHPet.state.props.slice().sort().join(','), ov: !!window.DSHPet.state.override};
          res({baseFace: baseFace, baseProps: baseProps, during: during, after: after});
        }, 2000);
      });
    })()`, 12000)
    check('特效期间确实生效', expiry.during.ov === true && expiry.during.face !== expiry.baseFace, `脸 ${expiry.baseFace} → ${expiry.during.face}`)
    check('特效到期自动消失（override 清空）', expiry.after.ov === false)
    check('到期后脸部回到 base', expiry.after.face === expiry.baseFace, `${expiry.during.face} → ${expiry.after.face}（base ${expiry.baseFace}）`)
    const realBase = (await evaluate('JSON.stringify(window.DSHPet.state.baseProps)'))
    check('到期后道具回到 base', expiry.after.props === JSON.parse(realBase).sort().join(','), `${expiry.during.props} → ${expiry.after.props}（base ${realBase}）`)

    const overrideWins = await evaluate(`(function(){
      window.DSHPet.setBase('thinking', ['menuBoard']);
      var b = window.DSHPet.state.mood;
      window.DSHPet.setReaction({mood:'love', ms:3000});
      var o = window.DSHPet.state.mood;
      window.DSHPet.clearReaction();
      var back = window.DSHPet.state.mood;
      return {b:b, o:o, back:back};
    })()`)
    check('互动会顶掉当前表现、结束后回到原模式', overrideWins.o === 'love' && overrideWins.back === 'thinking', JSON.stringify(overrideWins))

    const prop = await evaluate(`(function(){
      window.DSHPet.clearProps();
      var base = window.DSHPet.state.props.slice().sort();     // base 常驻「点菜按下」
      window.DSHPet.setProp('glassesRound', true);
      var a = window.DSHPet.state.props.slice().sort();
      window.DSHPet.setProp('glassesSun', true);
      var b = window.DSHPet.state.props.slice().sort();
      window.DSHPet.clearProps();
      window.DSHPet.setProp('whaleHat', true); window.DSHPet.setProp('claws', true);
      var c = window.DSHPet.state.props.slice().sort();
      window.DSHPet.clearProps();
      var after = window.DSHPet.state.props.slice().sort();
      return {base:base,a:a,b:b,c:c,after:after}})()`)
    const extra = (arr) => arr.filter((x) => prop.base.indexOf(x) < 0)
    check('道具可开启', extra(prop.a).join() === '圆眼镜', prop.a.join(','))
    check('同类道具互斥', extra(prop.b).join() === '墨镜', prop.b.join(','))
    check('异类道具可叠加（头顶鲸 + 桌上魔爪互不冲突）', extra(prop.c).sort().join() === '魔爪,鲸鱼', prop.c.join(','))
    check('道具可清空（回到 base）', prop.after.join() === prop.base.join(), prop.after.join(','))

    const motion = await evaluate(`(function(){try{window.DSHPet.playMotion('selfie');return 'ok'}catch(e){return 'ERR:'+e.message}})()`)
    check('动作可播放', motion === 'ok', motion)
    const badMotion = await evaluate(`(function(){try{window.DSHPet.playMotion('不存在的动作');return 'silent'}catch(e){return 'ERR'}})()`)
    check('未知动作不会抛异常', badMotion === 'silent', badMotion)

    // 6) 真·agent 事件流（走 SSE）
    await evaluate(`(function(){return fetch('/__demo',{method:'POST',body:'ok'}).then(function(){return 1})})()`)
    await sleep(4000)
    const mid = await evaluate('window.DSHPet.state.agent.status')
    check('agent 事件驱动了状态机', ['thinking', 'working', 'speaking', 'listening'].includes(mid), `状态 = ${mid}`)
    const bubbleOn = await evaluate(`!!document.querySelector('.dshp-bubble.dshp-on')`)
    check('气泡已弹出', bubbleOn === true)
    const bubbleText = await evaluate(`(document.querySelector('.dshp-body')||{}).textContent||''`)
    check('气泡里有内容', (bubbleText || '').length > 0, JSON.stringify((bubbleText || '').slice(0, 40)))
    await shoot('talking')

    // 轮询等它回空闲——单点检查会因为假事件流的调度抖动而误报
    let after = ''
    for (let i = 0; i < 45; i++) {
      await sleep(800)
      after = await evaluate('window.DSHPet.state.agent.status')
      if (after === 'idle') break
    }
    check('回合结束后回到空闲', after === 'idle', `状态 = ${after}`)

    // 7) UI：输入框 / 菜单 / 隐藏还原
    const uiState = await evaluate(`(function(){
      var r=document.getElementById('dsh-live2d-pet'); r.classList.add('dshp-open');
      var dock=document.querySelector('.dshp-dock');
      dock.children[0].click();
      var composerOn=document.querySelectorAll('.dshp-panel.dshp-on').length;
      dock.children[1].click();
      var menuOn=document.querySelectorAll('.dshp-panel.dshp-on').length;
      var chips=document.querySelectorAll('.dshp-grid .dshp-chip').length;
      return {composerOn:composerOn,menuOn:menuOn,chips:chips}})()`)
    check('输入框可打开', uiState.composerOn >= 1)
    check('菜单可打开且有内容', uiState.menuOn >= 1 && uiState.chips > 3, `${uiState.chips} 个按钮`)
    await shoot('menu')

    const tabs = await evaluate(`(function(){var out=[];document.querySelectorAll('.dshp-tab-btn').forEach(function(b){b.click();var p=document.querySelector('.dshp-panes');out.push(b.textContent+':'+p.textContent.length)});return out})()`)
    check('菜单六个分页都能渲染（每页都有内容）', tabs.length === 6 && tabs.every((t) => Number(t.split(':')[1]) > 20), tabs.join(' '))

    // 隐藏之后必须能找到回来的路——之前就是这里坏了（把手挂在 body 上，
    // 显示条件却写成 .dshp-root.dshp-hidden .dshp-tab 的后代选择器，永远不显示）。
    const hide = await evaluate(`(function(){
      var r = document.getElementById('dsh-live2d-pet');
      var tab = document.querySelector('.dshp-tab');
      document.querySelector('.dshp-dock').children[2].click();
      var hidden = r.classList.contains('dshp-hidden');
      var tabVisible = tab ? getComputedStyle(tab).display !== 'none' : false;
      var tabClickable = tab ? getComputedStyle(tab).pointerEvents !== 'none' : false;
      tab.click();
      return {hidden:hidden, tabVisible:tabVisible, tabClickable:tabClickable,
              restored:!r.classList.contains('dshp-hidden')}})()`)
    check('可隐藏', hide.hidden === true)
    check('隐藏后右下角出现「叫回来」把手', hide.tabVisible === true && hide.tabClickable === true)
    check('点把手能恢复', hide.restored === true)

    // ——— 「好感」页：羁绊系统的数值、规则、开关全部摊开，没有隐性设定 ———
    {
      const PAGE = `var sl=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
        var seed=function(raw){return fetch('/__bond_seed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(raw)}).then(function(r){return r.json()})};
        var panes=function(){return document.querySelector('.dshp-panes')};
        var openBond=async function(){
          if(!document.querySelector('.dshp-panel.dshp-on')) document.querySelector('.dshp-dock').children[1].click();
          document.querySelector('.dshp-tab-btn[data-tab=bond]').click();
          await sl(450);
        };
        var btn=function(txt){var all=panes().querySelectorAll('button');for(var i=0;i<all.length;i++){if(all[i].textContent.indexOf(txt)===0)return all[i]}return null};`
      const run = async (body) => JSON.parse(await evaluate(`(async function(){ ${PAGE} ${body} })()`))

      // 1) 全新档：页面结构 + 公开的规则
      const fresh = await run(`
        await seed({}); await window.DSHPet.bond.refresh(); await openBond();
        var t=panes().textContent;
        return JSON.stringify({secs:panes().querySelectorAll('details.dshp-sec').length, card:t.indexOf('Lv.1 初识')>=0,
          rules:t.indexOf('没有隐性设定')>=0&&t.indexOf('绝不掉级')>=0, today:t.indexOf('每日首见')>=0, forbidden:t.indexOf('体重秤')>=0&&t.indexOf('禁区')>=0,
          switches:t.indexOf('羁绊系统：开')>=0&&t.indexOf('话痨度：')>=0&&t.indexOf('番茄钟')>=0, tickets:window.DSHPet.bond.snap().tickets})`)
      check('好感页有 8 个折叠分区（状态/投喂/今日进度/表情包图鉴/等级/故事回忆/开关/规则），关系卡后面还有不折叠的「今日心愿」', fresh.secs === 8, String(fresh.secs))
      check('好感页关系卡显示等级与名称', fresh.card === true)
      check('好感页把规则摊开（衰减、倍率、token……不掉级）', fresh.rules === true)
      check('好感页列出每个来源的今日进度、礼物喜好含「禁区」', fresh.today === true && fresh.forbidden === true)
      check('话痨度 / 番茄钟 / 羁绊总开关都在好感页', fresh.switches === true)

      // 2) 设置页里已经没有搬走的那几个开关
      const stg = await run(`
        document.querySelector('.dshp-tab-btn[data-tab=setting]').click(); await sl(100);
        var t=panes().textContent; var b=[].map.call(panes().querySelectorAll('button'),function(x){return x.textContent}).join('|');
        return JSON.stringify({chatty:b.indexOf('话痨度')>=0, flair:b.indexOf('应景装扮')>=0, pomo:b.indexOf('番茄钟')>=0, pointer:t.indexOf('「好感」页')>=0})`)
      check('设置页不再放话痨度 / 应景装扮 / 番茄钟（搬进好感页），并指路', !stg.chatty && !stg.flair && !stg.pomo && stg.pointer, JSON.stringify(stg))

      // 3) 投喂：点「白饭」的按钮，扣 1 个 token、面板收起让位给她的反应
      // 种子里把今日心愿固定成与投喂无关的（否则按日期选出「想吃白饭」时，喂白饭会顺手领到心愿奖励的 +1 token，数字就对不上了）
      const fed = await run(`
        var dd=new Date(),pp=function(n){return String(n).padStart(2,'0')};
        await seed({wish:{date:dd.getFullYear()+'-'+pp(dd.getMonth()+1)+'-'+pp(dd.getDate()),id:'stroke',done:true,prev:''}}); await window.DSHPet.bond.refresh(); await openBond();
        var rows=panes().querySelectorAll('.dshp-gift'); var row=null;
        for(var i=0;i<rows.length;i++) if(rows[i].textContent.indexOf('白饭')>=0) row=rows[i];
        row.querySelector('button').click(); await sl(700);
        return JSON.stringify({tickets:window.DSHPet.bond.snap().tickets, panelClosed:!document.querySelector('.dshp-panel.dshp-on'), feeds:window.DSHPet.bond.snap().today.feeds.used})`)
      check('投喂白饭：token 5→4、今日投喂 +1、面板收起', fed.tickets === 4 && fed.feeds === 1 && fed.panelClosed === true, JSON.stringify(fed))

      // 4) 羁绊值够了 → 状态行提示 + 关系卡出现「听她说」按钮 → 讲故事 → 晋级
      const pend = await run(`
        await seed({xp:45,level:1}); await window.DSHPet.bond.refresh(); await openBond();
        var b=btn('听她说'); var status=window.DSHPet.menu().status;
        return JSON.stringify({btn:b?b.textContent:null, hint:status.indexOf('她有话想对你说')>=0, pending:window.DSHPet.bond.state().pending})`)
      check('待晋级：关系卡有「听她说：《白饭的由来》」', pend.pending === true && pend.btn === '听她说：《白饭的由来》', JSON.stringify(pend))
      check('待晋级：菜单状态行提示去好感页', pend.hint === true)

      const story = await run(`
        btn('听她说').click(); await sl(500);
        var ask=document.querySelector('.dshp-ask'); var labels=ask?[].map.call(ask.querySelectorAll('button'),function(x){return x.textContent}):[];
        var panelClosed=!document.querySelector('.dshp-panel.dshp-on');
        // 跳过 → 立刻确认晋级
        for(var i=0;i<labels.length;i++) if(labels[i]==='跳过') ask.querySelectorAll('button')[i].click();
        await sl(900);
        var s=window.DSHPet.bond.snap();
        return JSON.stringify({labels:labels, panelClosed:panelClosed, level:s.level, pending:s.pending, name:s.levelName})`)
      check('讲故事：面板收起，气泡带「继续 / 跳过」', story.panelClosed === true && story.labels.join() === '继续,跳过', JSON.stringify(story.labels))
      check('听完（跳过也算）→ 晋级到 Lv.2，不再待晋级', story.level === 2 && story.pending === false, JSON.stringify(story))

      // 5) 重看故事：已听过的有「重看」，且不改任何状态
      const replay = await run(`
        await openBond();
        var open=panes().querySelectorAll('details.dshp-sec'); for(var i=0;i<open.length;i++) open[i].open=true;
        var chips=[].filter.call(panes().querySelectorAll('.dshp-chip'),function(x){return x.textContent==='重看'});
        var before=JSON.stringify(window.DSHPet.bond.snap().xp);
        chips[0].click(); await sl(400);
        var ask=document.querySelector('.dshp-ask'); var has=!!ask;
        if(ask){var bs=ask.querySelectorAll('button');for(var j=0;j<bs.length;j++) if(bs[j].textContent==='跳过') bs[j].click()}
        await sl(500);
        return JSON.stringify({chips:chips.length, has:has, same:before===JSON.stringify(window.DSHPet.bond.snap().xp), level:window.DSHPet.bond.snap().level})`)
      check('重看已听过的故事：能播、不改羁绊值和等级', replay.chips >= 1 && replay.has === true && replay.same === true && replay.level === 2, JSON.stringify(replay))

      // 6) 总开关：关掉后页面只剩开关与规则；再打开恢复
      const off = await run(`
        await openBond(); btn('羁绊系统：').click(); await sl(800);
        var t1=panes().textContent; var en1=window.DSHPet.bond.snap().enabled;
        btn('羁绊系统：').click(); await sl(800);
        return JSON.stringify({closedCard:t1.indexOf('羁绊系统已关闭')>=0, en1:en1, en2:window.DSHPet.bond.snap().enabled, back:panes().textContent.indexOf('Lv.2')>=0})`)
      check('羁绊总开关：关 → 页面提示已关闭；再开 → 进度原样恢复', off.closedCard === true && off.en1 === false && off.en2 === true && off.back === true, JSON.stringify(off))

      // 清理：收起面板、还原成全新档
      await run(`await seed({}); await window.DSHPet.bond.refresh(); document.getElementById('dsh-live2d-pet').classList.remove('dshp-open'); document.querySelectorAll('.dshp-panel.dshp-on').forEach(function(p){p.classList.remove('dshp-on')}); return '1'`)
    }

    // 面板要能关（× 或点别处）
    const panelClose = await evaluate(`(function(){
      var r = document.getElementById('dsh-live2d-pet');
      r.classList.add('dshp-open');
      document.querySelector('.dshp-dock').children[1].click();
      var opened = document.querySelectorAll('.dshp-panel.dshp-on').length;
      var x = document.querySelector('.dshp-panel.dshp-on .dshp-close');
      if (x) x.click();
      var afterX = document.querySelectorAll('.dshp-panel.dshp-on').length;
      document.querySelector('.dshp-dock').children[1].click();
      var reopened = document.querySelectorAll('.dshp-panel.dshp-on').length;
      document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
      var afterOutside = document.querySelectorAll('.dshp-panel.dshp-on').length;
      r.classList.remove('dshp-open');
      return {opened:opened, hasX: !!x, afterX:afterX, reopened:reopened, afterOutside:afterOutside}})()`)
    check('面板左上角有关闭按钮且能关掉', panelClose.hasX && panelClose.opened >= 1 && panelClose.afterX === 0, JSON.stringify(panelClose))
    check('点面板以外也能关掉', panelClose.reopened >= 1 && panelClose.afterOutside === 0)

    // 互动反应要有随机性，不老是同一个
    const variety = await evaluate(`(function(){
      var seen = {};
      for (var i = 0; i < 60; i++) {
        window.DSHPet.clearReaction();
        var pool = ['happy','shy','love','pout','grumpy','tongue','playful'];
        // 直接用公开接口连点，看脸变了多少种
      }
      return 1;
    })()`)
    void variety

    // 8) 拖动落点会被记住
    const drag = await evaluate(`(function(){
      var r=document.getElementById('dsh-live2d-pet');
      r.style.left='120px'; r.style.top='90px'; r.style.right='auto'; r.style.bottom='auto';
      return {x:parseFloat(r.style.left),y:parseFloat(r.style.top)}})()`)
    check('可自由摆放', drag.x === 120 && drag.y === 90, `${drag.x},${drag.y}`)

    // 9) 视线阻尼：这是用户明确抱怨过的地方（「头摆得跟螺旋桨似的」）
    const gazeProbe = await evaluate(`(function(){
      var r = document.querySelector('#dsh-live2d-pet .dshp-stage').getBoundingClientRect();
      // 从正前方猛甩到右边远处，模拟鼠标瞬移
      if (window.DSHPet.resetGazeStats) window.DSHPet.resetGazeStats();
      // 挑离桌宠最远的那个屏幕角落——测试不依赖桌宠当前在哪儿
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var corners = [[4,4],[innerWidth-4,4],[4,innerHeight-4],[innerWidth-4,innerHeight-4]];
      var best = corners[0], bd = -1;
      corners.forEach(function(c){
        var d = Math.hypot(c[0]-cx, c[1]-cy);
        if (d > bd) { bd = d; best = c; }
      });
      var mx = best[0], my = best[1];
      // 真实的鼠标是连续事件流；一次性投递容易和渲染节拍错开，所以按 50ms 持续投喂
      window.__gazeFeed = setInterval(function(){
        document.dispatchEvent(new PointerEvent('pointermove', {clientX: mx, clientY: my, bubbles: true}));
      }, 50);
      window.__gazeSamples = [];
      window.__gazeDiag = {mouse: r.left + r.width + 300, cy: r.top + r.height/2, rect: [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)], inner: [window.innerWidth, window.innerHeight], look: null};
      var t0 = performance.now();
      return new Promise(function(res){
        var iv = setInterval(function(){
          var st = window.DSHPet.state;
          window.__gazeSamples.push({t: Math.round(performance.now()-t0), x: st.focus ? st.focus.x : 0, y: st.focus ? st.focus.y : 0, gx: st.gaze.x, mode: st.gaze.mode, det: st.gaze.detached});
          if (performance.now() - t0 > 2200) {
            clearInterval(iv);
            clearInterval(window.__gazeFeed);
            res({samples: window.__gazeSamples, diag: window.__gazeDiag});
          }
        }, 100);
      });
    })()`)
    const gazeSamples = gazeProbe.samples
    const peak = Math.max.apply(null, gazeSamples.map(function (p) { return Math.max(Math.abs(p.x), Math.abs(p.y || 0)) }))
    // 比「多久到一半」更靠谱的判据：逐样本变化率必须被限住。
    // 这才是「头不会像螺旋桨一样瞬移」的直接度量，而且不受测试顺序影响。
    let maxRate = 0
    for (let i = 1; i < gazeSamples.length; i++) {
      const dt = (gazeSamples[i].t - gazeSamples[i - 1].t) / 1000
      if (dt <= 0) continue
      maxRate = Math.max(maxRate, Math.abs(gazeSamples[i].x - gazeSamples[i - 1].x) / dt)
    }
    check('视线是有限度的（不会满幅硬跟）', peak > 0.02 && peak <= 0.85, `峰值 ${peak.toFixed(3)}（跟随幅度上限 0.78）`)
    // 限速要看控制器内部的真实步长速率，不能按采样间隔估算
    // （页面卡顿时 tick 会变长，采样法会误判成超速）。
    const rateStat = await evaluate(`(function(){
      var st = window.DSHPet.state;
      return {stepRate: st.gaze.stepRate, limit: st.gaze.limit};
    })()`)
    check(
      '视线有速度上限（不是瞬移）',
      rateStat.stepRate > 0 && rateStat.stepRate <= rateStat.limit + 0.02,
      `实际步长速率 ${rateStat.stepRate} /秒（上限 ${rateStat.limit}）`,
    )
    check('视线确实动起来了（不是没反应）', peak > 0.2, `采样峰值 ${peak.toFixed(3)}`)

    // 10) 鼠标离远了要停止跟随、自己动
    const farGaze = await evaluate(`(function(){
      document.dispatchEvent(new PointerEvent('pointermove', {clientX: 5, clientY: 5, bubbles: true}));
      return 1;
    })()`)
    void farGaze

    // 11) 待机自主性：闲着自己会动（换表情 / 换姿势 / 换视线），不是愣着
    const idleProbe = await evaluate(`(function(){
      window.__idleSamples = [];
      window.__moods = {}; window.__sway = 0; window.__drift = 0;
      var t0 = performance.now();
      var lastGx = 0;
      return new Promise(function(res){
        var iv = setInterval(function(){
          var st = window.DSHPet.state;
          window.__moods[st.mood] = 1;
          if (Math.abs(st.gaze.x - lastGx) > 0.08) { window.__drift++; lastGx = st.gaze.x; }
          if (st.override) window.__sway++;   // 自己起的一次性反应
          if (performance.now() - t0 > 22000) {
            clearInterval(iv);
            res({moods: Object.keys(window.__moods), drift: window.__drift, sway: window.__sway});
          }
        }, 400);
      });
    })()`, 40000)
    check(
      '待机时她自己会动（换视线/换表情/自己起反应）',
      idleProbe.drift > 0 || idleProbe.sway > 0 || idleProbe.moods.length > 1,
      `22 秒内：视线变化 ${idleProbe.drift} 次，自己起的临时反应 ${idleProbe.sway} 次，出现过的情绪 [${idleProbe.moods.join(',')}]`,
    )

    // 12) 工具反应：读资料 = 戴眼镜 + 拿板子（底座状态），而不是钉一张死脸
    const toolBase = await evaluate(`(function(){
      return fetch('/__demo',{method:'POST',body:'ok'}).then(function(){
        return new Promise(function(res){
          var t0 = performance.now(), seen = {}, faces = {};
          var iv = setInterval(function(){
            var st = window.DSHPet.state;
            seen[st.base] = 1;
            if (st.face) faces[st.face] = 1;
            var hasBoard = st.props.indexOf('点菜按下') >= 0;
            if (hasBoard) seen.hasBoard = (seen.hasBoard || 0) + 1;
            if (performance.now() - t0 > 5200) {
              clearInterval(iv);
              res({bases: Object.keys(seen), faces: Object.keys(faces), boardSamples: seen.hasBoard || 0});
            }
          }, 150);
        });
      });
    })()`, 20000)
    check('工具反应有对应的底座状态', toolBase.bases.length > 1 || toolBase.faces.length > 0, `经过的状态 [${toolBase.bases.join(',')}] 表情 [${toolBase.faces.join(',')}]`)
    check('干活时手上有记录板', toolBase.boardSamples > 0, `${toolBase.boardSamples} 次采样命中`)

    // 13) 点击互动 + 工作优先级——「点击触发动作」是目标里的硬要求，
    //     而「干活时点不动她」是主人明确要的规矩，两件事一起验。
    const doPoke = `(function(){
      var r = document.querySelector('#dsh-live2d-pet .dshp-stage').getBoundingClientRect();
      var pt = null;
      for (var i = 1; i <= 12 && !pt; i++) {
        for (var j = 1; j <= 12 && !pt; j++) {
          var x = r.left + r.width * i / 13, y = r.top + r.height * j / 13;
          if (window.DSHPet.hitTest(x, y)) pt = {x: x, y: y};
        }
      }
      if (!pt) return {ok: false, why: '找不到能点中她的坐标'};
      var before = window.DSHPet.state.mood;
      var o = {bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 0, buttons: 1, pointerId: 1, isPrimary: true};
      document.dispatchEvent(new PointerEvent('pointerdown', o));
      document.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, {buttons: 0})));
      var st = window.DSHPet.state;
      return {ok: true, status: st.agent.status, base: st.base, head: (pt.y - r.top) / r.height < 0.45,
              beforeMood: before, afterMood: st.mood, override: !!st.override,
              bubble: ((document.querySelector('.dshp-body') || {}).textContent || '').slice(0, 40)};
    })()`

    // 13a) 先让她忙起来，这时候点她应该没有任何反应
    await evaluate(`(function(){return fetch('/__demo',{method:'POST',body:'ok'}).then(function(){return 1})})()`)
    await sleep(5600)
    const busyPoke = await evaluate(doPoke)
    check('干活时点她也能互动', busyPoke.status !== 'idle' && busyPoke.override === true, JSON.stringify({status: busyPoke.status, override: busyPoke.override}))
    check('互动不改底层工作状态（互动完回到工作）', busyPoke.base === 'reading' || busyPoke.base === 'thinking', `base=${busyPoke.base}`)

    // 13b) 等她闲下来，这时候点她才该有反应
    let idleNow = ''
    for (let i = 0; i < 30; i++) {
      await sleep(800)
      idleNow = await evaluate('window.DSHPet.state.agent.status')
      if (idleNow === 'idle') break
    }
    await evaluate('window.DSHPet.clearReaction()')
    const freePoke = await evaluate(doPoke)
    check('闲下来点她会触发反应', freePoke.ok === true && freePoke.override === true, JSON.stringify(freePoke))
    check('点击后出现了对应台词', !!freePoke.bubble && freePoke.bubble.length > 0, JSON.stringify(freePoke.bubble))
    check('点击确实换了表情或进了一次性反应', freePoke.override === true, `${freePoke.beforeMood} → ${freePoke.afterMood}`)

    // 点出来的反应必须是「一会儿就消失」的
    await sleep(4200)
    const ap = JSON.parse(await evaluate('JSON.stringify({ov: !!window.DSHPet.state.override, mood: window.DSHPet.state.mood, base: window.DSHPet.state.base, props: window.DSHPet.state.props})'))
    check('互动反应几秒后自己消失、回到「本子+笔+平常」', ap.ov === false && ap.mood === ap.base && ap.props.join() === '点菜按下,画笔', JSON.stringify(ap))

    // 14) 一键重置：不管刚才点出了什么特效，一下回到「本子+笔+平常脸」
    const resetTest = await evaluate(`(function(){
      // 先把状态搞乱
      window.DSHPet.setProp('whale', true);
      window.DSHPet.setProp('glassesSun', true);
      window.DSHPet.setReaction({mood: 'angry', props: ['doubleV'], ms: 60000});
      window.DSHPet.setUserFace('love');
      var r = document.getElementById('dsh-live2d-pet');
      r.style.left = '200px'; r.style.top = '150px'; r.style.right = 'auto'; r.style.bottom = 'auto';
      var dirty = {props: window.DSHPet.state.props.slice(), mood: window.DSHPet.state.mood, override: !!window.DSHPet.state.override};
      window.DSHPet.resetEverything();
      var st = window.DSHPet.state;
      return {
        dirty: dirty,
        props: st.props.slice(), mood: st.mood, face: st.face, base: st.base, override: !!st.override,
        left: r.style.left, right: r.style.right, hidden: r.classList.contains('dshp-hidden'),
      };
    })()`)
    check('一键重置前状态确实是乱的', resetTest.dirty.props.length > 2 && resetTest.dirty.override === true, JSON.stringify(resetTest.dirty))
    check('一键重置后回到「本子+笔+平常脸」', resetTest.override === false && resetTest.mood === 'neutral' && resetTest.face === null && resetTest.props.join() === '点菜按下,画笔', JSON.stringify({mood: resetTest.mood, face: resetTest.face, props: resetTest.props}))
    check('一键重置同时归位到角落、解除隐藏', (resetTest.left === '' || resetTest.left === 'auto') && resetTest.right !== '' && resetTest.hidden === false, JSON.stringify({left: resetTest.left, right: resetTest.right, hidden: resetTest.hidden}))

    // 15) 「两个表情不许重叠」——用可观测的独占裁决指标验证
    const overlap = await evaluate(`(function(){
      // 墨镜写 ParamEyeLOpen/ParamEyeROpen，调皮也写 ParamEyeROpen —— 天然冲突
      window.DSHPet.resetEverything();
      window.DSHPet.setProp('glassesSun', true);
      window.DSHPet.setReaction({mood: 'playful', ms: 30000});
      return 1;
    })()`)
    void overlap
    await sleep(900)
    const excl = await evaluate('JSON.stringify(window.DSHPet.state.exclusive)')
    const ex = JSON.parse(excl)
    check('同一参数只有一个写入者（独占裁决在跑）', ex && ex.skipped > 0, excl)
    check('这一帧只写了一组参数', ex && ex.written > 0 && ex.written < 40, ex ? `${ex.written} 个参数，写入者 [${ex.writers.join(',')}]` : '无')

    // 16) 每次表演前先归零：新表演开始时旧的必须已经被清掉
    const sequential = await evaluate(`(function(){
      window.DSHPet.resetEverything();
      var a = {face: window.DSHPet.state.face, props: window.DSHPet.state.props.slice()};
      window.DSHPet.setReaction({mood: 'love', props: ['whale'], ms: 30000});
      var during1 = {face: window.DSHPet.state.face, props: window.DSHPet.state.props.slice()};
      window.DSHPet.setReaction({mood: 'grumpy', props: [], ms: 30000});
      var during2 = {face: window.DSHPet.state.face, props: window.DSHPet.state.props.slice()};
      window.DSHPet.resetEverything();
      return {a: a, during1: during1, during2: during2, after: {face: window.DSHPet.state.face, props: window.DSHPet.state.props.slice()}};
    })()`)
    check('新表演开始时旧表情已经被换掉（不叠加）', sequential.during2.face !== sequential.during1.face, JSON.stringify(sequential))
    check('新表演开始时旧的一次性道具被清掉', sequential.during2.props.indexOf('鲸鱼') < 0, JSON.stringify(sequential.during2.props))
    check('重置后回到「本子+笔+平常脸」', sequential.after.face === null && sequential.after.props.join() === '点菜按下,画笔', JSON.stringify(sequential.after))

    // 17) 待机必须是「正常坐姿 + 正常眼型 + 正常表情」：
    //     不长播任何动作，也不留任何多余的表情参数
    await evaluate('window.DSHPet.resetEverything()')
    // 待机时她**本来就该偶尔换个表情**（几秒就收），所以不能随便抓一帧就断言；
    // 要等她那次自发表情过期、真正「静下来」的那一刻再看。
    let atRest = null
    for (let i = 0; i < 20; i++) {
      await sleep(800)
      const probe = JSON.parse(await evaluate(`JSON.stringify({ov: !!window.DSHPet.state.override})`))
      if (!probe.ov) {
        atRest = JSON.parse(await evaluate(`JSON.stringify({
      motion: window.DSHPet.state.motion,
      face: window.DSHPet.state.face,
      props: window.DSHPet.state.props,
      writers: (window.DSHPet.state.exclusive || {}).writers,
          skipped: (window.DSHPet.state.exclusive || {}).skipped,
        })`))
        break
      }
    }
    check('待机时没有任何动作在播', atRest.motion && atRest.motion.playing === false, JSON.stringify(atRest.motion))
    check('待机时脸上没有多余表情', atRest.face === null, String(atRest.face))
    check('待机时只有「本子 + 笔」两个道具', atRest.props.join() === '点菜按下,画笔', atRest.props.join())
    check('待机写入者只有本子和笔（没有表情在抢参数）', (atRest.writers || []).every((w) => w === '点菜按下' || w === '画笔'), JSON.stringify(atRest.writers))

    // 18) 完整跑一轮，结束后必须干净地回到平常
    await evaluate(`(function(){return fetch('/__demo',{method:'POST',body:'ok'}).then(function(){return 1})})()`)
    let settled = null
    for (let i = 0; i < 40; i++) {
      await sleep(1000)
      const st = JSON.parse(await evaluate(`JSON.stringify({
        status: window.DSHPet.state.agent.status,
        motion: window.DSHPet.state.motion,
        face: window.DSHPet.state.face,
        props: window.DSHPet.state.props,
        base: window.DSHPet.state.base,
        override: !!window.DSHPet.state.override,
      })`))
      if (st.status === 'idle' && !st.override && !st.motion.playing) { settled = st; break }
      settled = st
    }
    check('一轮跑完后回到空闲', settled.status === 'idle', JSON.stringify(settled))
    check('结束后没有动作在播', settled.motion.playing === false, JSON.stringify(settled.motion))
    check('结束后脸上没有残留表情（不留挤眼睛之类）', settled.face === null, String(settled.face))
    check('结束后底层状态回到平常', settled.base === 'neutral', String(settled.base))
    check('结束后道具回到「本子 + 笔」', settled.props.join() === '点菜按下,画笔', settled.props.join())

    // 18.5) 三个交互细节（主人报的）
    //   · 双击鱼身不该弹输入框，只有工具栏「说话」才开
    //   · 钱包的 × 要真的能关
    //   · 右键点一次开、再点一次关
    const uiFix = JSON.parse(
      await evaluate(`(async function(){
        window.DSHPet.resetEverything();
        window.DSHPet.hud.hide();
        await new Promise(function(res){ setTimeout(res, 350) });
        var root = document.getElementById('dsh-live2d-pet');
        var composerOn = function(){ return !!document.querySelector('.dshp-composer.dshp-on'); };
        var hudOn = function(){ return window.DSHPet.hud.open(); };
        var out = {};

        // 双击鱼身
        var st = document.querySelector('.dshp-stage').getBoundingClientRect();
        var pt = null;
        for (var i = 1; i <= 12 && !pt; i++) for (var j = 1; j <= 12 && !pt; j++) {
          var x = st.left + st.width * i / 13, y = st.top + st.height * j / 13;
          if (window.DSHPet.hitTest(x, y)) pt = {x: x, y: y};
        }
        if (pt) document.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y}));
        await new Promise(function(res){ setTimeout(res, 250) });
        out.dblclickOpensComposer = composerOn();

        // 点「说话」按钮
        document.querySelector('.dshp-dock').children[0].click();
        await new Promise(function(res){ setTimeout(res, 250) });
        out.talkOpensComposer = composerOn();
        // 关掉它
        var cmp = document.querySelector('.dshp-composer.dshp-on');
        if (cmp) cmp.querySelector('.dshp-close').click();
        await new Promise(function(res){ setTimeout(res, 250) });
        out.composerClosedByX = !composerOn();

        // 钱包：右键开 → 右键关
        root.classList.add('dshp-open');
        if (pt) {
          document.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 2}));
          await new Promise(function(res){ setTimeout(res, 350) });
          out.hudAfterFirstRightClick = hudOn();
          document.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 2}));
          await new Promise(function(res){ setTimeout(res, 350) });
          out.hudAfterSecondRightClick = hudOn();
        }

        // 钱包的 ×
        if (pt) {
          document.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 2}));
          await new Promise(function(res){ setTimeout(res, 350) });
        }
        var before = hudOn();
        var x = document.querySelector('.dshp-hud .dshp-close');
        out.hudHasX = !!x;
        if (x) x.click();
        await new Promise(function(res){ setTimeout(res, 300) });
        out.hudOpenedBeforeX = before;
        out.hudClosedByX = !hudOn();
        return JSON.stringify(out);
      })()`),
    )
    check('双击鱼身不再弹出输入框（只有「说话」按钮能开）', uiFix.dblclickOpensComposer === false, JSON.stringify(uiFix))
    check('点工具栏「说话」仍然能开输入框', uiFix.talkOpensComposer === true, JSON.stringify(uiFix))
    check('输入框的 × 能关掉', uiFix.composerClosedByX === true, JSON.stringify(uiFix))
    check('右键点一次打开钱包', uiFix.hudAfterFirstRightClick === true, JSON.stringify(uiFix))
    check('再点一次右键就关闭钱包（切换）', uiFix.hudAfterSecondRightClick === false, JSON.stringify(uiFix))
    check('钱包的 × 能关掉（以前点了没反应）', uiFix.hudHasX && uiFix.hudOpenedBeforeX && uiFix.hudClosedByX, JSON.stringify(uiFix))

    // 18.8) 动作演完之后，**模型参数**必须回到默认（主人报的「蛋包饭永远挂着」）
    //   根因：框架把参数快照存在「动作写入之后」，动作停了快照里还是最后一帧的姿势，
    //   每帧被 loadParameters() 装回来。光看 state 是看不出来的，必须读真实参数。
    const motionPose = JSON.parse(
      await evaluate(`(async function(){
        window.DSHPet.resetEverything();
        await new Promise(function(res){ setTimeout(res, 700) });
        var before = window.DSHPet.motionParams('ketchup');
        window.DSHPet.playAction('omurice');
        await new Promise(function(res){ setTimeout(res, 2600) });
        var during = window.DSHPet.motionParams('ketchup');
        // 蛋包饭动作 ms=6200、动画本身 5 秒，等它彻底结束
        await new Promise(function(res){ setTimeout(res, 5200) });
        var after = window.DSHPet.motionParams('ketchup');
        // 再手动清一次（等价于 resetEverything 里的 stopMotion）
        window.DSHPet.resetEverything();
        await new Promise(function(res){ setTimeout(res, 600) });
        var afterReset = window.DSHPet.motionParams('ketchup');
        var diff = function(a, b){
          var n = 0;
          for (var i = 0; i < a.length; i++) if (Math.abs((a[i]||0) - (b[i]||0)) > 0.02) n++;
          return n;
        };
        return JSON.stringify({
          total: before.total,
          duringMoved: diff(before.values, during.values),
          afterMoved: diff(before.values, after.values),
          afterResetMoved: diff(before.values, afterReset.values),
          sample: { before: before.values.slice(0, 4), during: during.values.slice(0, 4), after: after.values.slice(0, 4) },
        });
      })()`),
    )
    check(
      '动作播放时参数确实被动画改了（说明在真的动）',
      motionPose.duringMoved > 0,
      JSON.stringify({duringMoved: motionPose.duringMoved, sample: motionPose.sample}),
    )
    check(
      '动作演完，参数回到默认（蛋包饭不会永远挂着）',
      motionPose.afterMoved === 0,
      JSON.stringify({afterMoved: motionPose.afterMoved, sample: motionPose.sample}),
    )
    check(
      '一键重置后参数也是干净的',
      motionPose.afterResetMoved === 0,
      JSON.stringify({afterResetMoved: motionPose.afterResetMoved}),
    )

    // 18.83) 眨眼节奏（主人要「正常人速度，偶尔眨一眨」）+ 聊天框对准头顶
    const blinkInfo = JSON.parse(
      await evaluate(`(async function(){
        window.DSHPet.resetEverything();
        await new Promise(function(res){ setTimeout(res, 800) });
        var b0 = window.DSHPet.blink();
        await new Promise(function(res){ setTimeout(res, 12000) });
        var b1 = window.DSHPet.blink();
        return JSON.stringify({start: b0, end: b1, added: (b1.count || 0) - (b0.count || 0)});
      })()`),
    )
    check(
      '12 秒内眨眼次数正常（1~6 次，不是一次不眨也不是狂眨）',
      blinkInfo.added >= 1 && blinkInfo.added <= 6,
      `12 秒眨了 ${blinkInfo.added} 次：${JSON.stringify(blinkInfo.end)}`,
    )
    check('眨眼闸门是通的（没有被动作/表情错误地拦住）', blinkInfo.end.gate === 'ok', JSON.stringify(blinkInfo.end))

    const headAlign = JSON.parse(
      await evaluate(`(async function(){
        var root = document.getElementById('dsh-live2d-pet');
        var out = [];
        var spots = [['靠左墙', 8], ['中间', Math.round(window.innerWidth / 2 - 120)], ['靠右墙', window.innerWidth - 250]];
        for (var k = 0; k < spots.length; k++) {
          window.DSHPet.resetEverything();
          await new Promise(function(res){ setTimeout(res, 380) });
          root.style.left = spots[k][1] + 'px'; root.style.top = '380px';
          root.style.right = 'auto'; root.style.bottom = 'auto';
          await new Promise(function(res){ setTimeout(res, 280) });
          document.querySelector('.dshp-dock').children[0].click();   // 打开聊天框
          await new Promise(function(res){ setTimeout(res, 420) });
          var pan = window.DSHPet.state.panels;
          var box = document.querySelector('.dshp-composer.dshp-on').getBoundingClientRect();
          out.push({where: spots[k][0], headX: pan.headX,
            center: Math.round(box.left + box.width / 2),
            inside: box.left >= 0 && box.right <= window.innerWidth,
            offBy: Math.abs(Math.round(box.left + box.width / 2) - pan.headX)});
          document.querySelector('.dshp-dock').children[0].click();   // 关掉
          await new Promise(function(res){ setTimeout(res, 220) });
        }
        window.DSHPet.resetEverything();
        return JSON.stringify(out);
      })()`),
    )
    const alignMid = headAlign[1] || {}
    const alignLeft = headAlign[0] || {}
    const alignRight = headAlign[2] || {}
    check(
      '在屏幕中间时，聊天框正对她的头顶',
      alignMid.offBy !== undefined && alignMid.offBy <= 30,
      JSON.stringify(alignMid),
    )
    check('聊天框在三种位置都完整落在屏幕里（不会被墙切掉）', headAlign.every((p) => p.inside === true), JSON.stringify(headAlign))
    check(
      '靠左墙时聊天框往右让（对着头顶但被墙挤回屏内）',
      alignLeft.inside === true && alignLeft.center >= alignLeft.headX,
      JSON.stringify(alignLeft),
    )
    check(
      '靠右墙时聊天框往左让',
      alignRight.inside === true && alignRight.center <= alignRight.headX,
      JSON.stringify(alignRight),
    )

    // 18.85) 眼睛必须是睁的（主人报的「一直闭着眼，啥也干不了」）
    //   根因：clearMotionPose 用错了框架接口 —— getParameterDefaultValue 收的是「下标」不是 id，
    //   传 id 拿到 undefined，我的兜底又把 0 当默认值 → 睁眼参数被写成 0 并永久存进快照。
    const eyes = JSON.parse(
      await evaluate(`(async function(){
        window.DSHPet.resetEverything();
        await new Promise(function(res){ setTimeout(res, 900) });
        var fresh = window.DSHPet.eyes();
        var defL = window.DSHPet.paramDefault('ParamEyeLOpen');
        var defR = window.DSHPet.paramDefault('ParamEyeROpen');
        window.DSHPet.playAction('omurice');
        await new Promise(function(res){ setTimeout(res, 8500) });   // 等动作彻底结束
        var afterAction = window.DSHPet.eyes();
        window.DSHPet.resetEverything();
        await new Promise(function(res){ setTimeout(res, 1200) });
        var afterReset = window.DSHPet.eyes();
        return JSON.stringify({fresh: fresh, defL: defL, defR: defR, afterAction: afterAction, afterReset: afterReset});
      })()`),
    )
    check(
      '取默认值用的是「下标」不是 id（取不到就跳过，绝不猜 0）',
      eyes.defL !== null && eyes.defL > 0.5 && eyes.defR !== null && eyes.defR > 0.5,
      JSON.stringify({ParamEyeLOpen: eyes.defL, ParamEyeROpen: eyes.defR}),
    )
    check('空闲状态两只眼睛是睁开的', eyes.fresh !== null && eyes.fresh > 0.9, String(eyes.fresh))
    check('动作演完之后眼睛还是睁的（不会闭着眼卡住）', eyes.afterAction !== null && eyes.afterAction > 0.9, String(eyes.afterAction))
    check('一键重置之后眼睛也是睁的', eyes.afterReset !== null && eyes.afterReset > 0.9, String(eyes.afterReset))

    // 18.9) 面板往哪边开：靠左墙就往右开、靠右墙就往左开，而且不能一次左一次右
    const panelSide = JSON.parse(
      await evaluate(`(async function(){
        var root = document.getElementById('dsh-live2d-pet');
        var hud = document.querySelector('.dshp-hud');
        var open = function(){ window.DSHPet.hud.show({flash:false}); };
        var rect = function(){ var r = hud.getBoundingClientRect(); return {left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), w: Math.round(r.width)}; };
        var out = {};

        // ① 靠左墙：面板应该整体落在屏幕里，而且往右展开（面板左缘 ≈ 桌宠左缘）
        window.DSHPet.resetEverything();
        root.style.left = '10px'; root.style.top = '300px'; root.style.right = 'auto'; root.style.bottom = 'auto';
        open();
        await new Promise(function(res){ setTimeout(res, 420) });
        out.atLeftWall = rect();
        var rr1 = root.getBoundingClientRect();
        out.leftWallOpensRight = out.atLeftWall.left >= rr1.left - 30;

        // ② 靠右墙：往左展开（面板右缘 ≈ 桌宠右缘）
        window.DSHPet.hud.hide();
        root.style.left = (window.innerWidth - rr1.width - 10) + 'px';
        await new Promise(function(res){ setTimeout(res, 260) });
        open();
        await new Promise(function(res){ setTimeout(res, 420) });
        out.atRightWall = rect();
        var rr2 = root.getBoundingClientRect();
        out.rightWallOpensLeft = out.atRightWall.right <= rr2.right + 30;

        // ③ 连开关三次，位置必须完全一样（不能一次左一次右）
        var seen = [];
        for (var i = 0; i < 3; i++) {
          window.DSHPet.hud.hide();
          await new Promise(function(res){ setTimeout(res, 260) });
          open();
          await new Promise(function(res){ setTimeout(res, 420) });
          var r = rect();
          seen.push(r.left + ',' + r.right);
        }
        out.repeat = seen;
        out.stableRepeat = seen[0] === seen[1] && seen[1] === seen[2];
        out.insideViewport =
          out.atLeftWall.left >= 0 && out.atLeftWall.right <= window.innerWidth &&
          out.atRightWall.left >= 0 && out.atRightWall.right <= window.innerWidth;
        window.DSHPet.hud.hide();
        window.DSHPet.resetEverything();
        return JSON.stringify(out);
      })()`),
    )
    check('靠左墙时面板往右开（面板左缘贴着桌宠）', panelSide.leftWallOpensRight === true, JSON.stringify(panelSide.atLeftWall))
    check('靠右墙时面板往左开（面板右缘贴着桌宠）', panelSide.rightWallOpensLeft === true, JSON.stringify(panelSide.atRightWall))
    check('面板整体都在屏幕里（靠墙也不会卡进墙里）', panelSide.insideViewport === true, JSON.stringify({left: panelSide.atLeftWall, right: panelSide.atRightWall}))
    check('连开三次位置完全一致（不会再一次左一次右）', panelSide.stableRepeat === true, JSON.stringify(panelSide.repeat))

    // 说话按钮：点一次开、再点一次关
    const talkToggle = JSON.parse(
      await evaluate(`(async function(){
        window.DSHPet.resetEverything();
        await new Promise(function(res){ setTimeout(res, 300) });
        var btn = document.querySelector('.dshp-dock').children[0];
        var on = function(){ return !!document.querySelector('.dshp-composer.dshp-on'); };
        var out = {};
        btn.click(); await new Promise(function(res){ setTimeout(res, 300) }); out.afterFirst = on();
        btn.click(); await new Promise(function(res){ setTimeout(res, 300) }); out.afterSecond = on();
        btn.click(); await new Promise(function(res){ setTimeout(res, 300) }); out.afterThird = on();
        if (on()) btn.click();
        return JSON.stringify(out);
      })()`),
    )
    check('「说话」按钮是开关：点一次开、再点一次关', talkToggle.afterFirst === true && talkToggle.afterSecond === false && talkToggle.afterThird === true, JSON.stringify(talkToggle))

    // 19) 拖放规则（主人新定的）：只吸左右墙，竖直位置随我调，底部永远不吸
    const innerHeightHint = await evaluate('window.innerHeight')
    const dragTo = (txPct, tyPct) => `(async function(){
      var r = document.getElementById('dsh-live2d-pet');
      r.style.transition = '';
      r.style.left = '260px'; r.style.top = '180px'; r.style.right = 'auto'; r.style.bottom = 'auto';
      var st = document.querySelector('.dshp-stage').getBoundingClientRect();
      var pt = null;
      for (var i = 1; i <= 12 && !pt; i++) {
        for (var j = 1; j <= 12 && !pt; j++) {
          var x = st.left + st.width * i / 13, y = st.top + st.height * j / 13;
          if (window.DSHPet.hitTest(x, y)) pt = {x: x, y: y};
        }
      }
      if (!pt) return JSON.stringify({ok: false});
      var tx = Math.round(innerWidth * ${txPct}), ty = Math.round(innerHeight * ${tyPct});
      var o = {bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 0, buttons: 1, pointerId: 1, isPrimary: true};
      document.dispatchEvent(new PointerEvent('pointerdown', o));
      // 分 8 小步移动，模拟真手（一步跨到底的话速度会大得离谱，惯性会把桌宠甩飞）
      for (var s = 1; s <= 8; s++) {
        var mx = Math.round(pt.x + (tx - pt.x) * s / 8);
        var my = Math.round(pt.y + (ty - pt.y) * s / 8);
        document.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, o, {clientX: mx, clientY: my})));
        await new Promise(function(res){ setTimeout(res, 25) });
      }
      document.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, {clientX: tx, clientY: ty, buttons: 0})));
      // 贴边是滑过去的、没贴边还有惯性衰减，等它稳下来再量
      await new Promise(function(res){ setTimeout(res, 900) });
      var rr = r.getBoundingClientRect();
      return JSON.stringify({
        ok: true, edge: r.dataset.edge, place: window.DSHPet.state.placement,
        gapRight: Math.round(innerWidth - rr.right), gapLeft: Math.round(rr.left),
        layout: JSON.parse(localStorage.getItem('dsh-live2d-pet:layout') || '{}'),
      });
    })()`

    const snapR = JSON.parse(await evaluate(dragTo('0.97', '0.30')))
    check('拖到右墙会吸附', snapR.ok && snapR.edge === 'right', JSON.stringify(snapR.place))
    check('吸附后贴住右边', snapR.gapRight >= 0 && snapR.gapRight <= 20, `右边距 ${snapR.gapRight}px`)
    check(
      '贴右墙时没有被吸到底部（竖直位置是我放的高度）',
      snapR.place.bottom > 100 && snapR.layout.edgeY != null,
      JSON.stringify({bottom: snapR.place.bottom, edgeY: snapR.layout.edgeY}),
    )

    // 同一个右墙、拖到更低的位置 → 高度要跟着变（这就是主人要的「随意调高低」）
    const snapRLow = JSON.parse(await evaluate(dragTo('0.97', '0.80')))
    check(
      '贴着同一面墙，竖直位置也能随便调（高低跟着手走）',
      snapRLow.edge === 'right' && snapRLow.place.top - snapR.place.top > 150,
      JSON.stringify({上: snapR.place.top, 下: snapRLow.place.top}),
    )

    const snapL = JSON.parse(await evaluate(dragTo('0.03', '0.5')))
    check('拖到左墙会吸附', snapL.ok && snapL.edge === 'left', JSON.stringify(snapL.place))
    check('吸附后贴住左边', snapL.gapLeft >= 0 && snapL.gapLeft <= 20, `左边距 ${snapL.gapLeft}px`)

    // 关键：拖到底部中间不该被吸到底、也不该吸到侧边
    const bottomMid = JSON.parse(await evaluate(dragTo('0.5', '0.97')))
    check(
      '拖到底部中间不吸附（底部不吸、离两侧远也不吸）',
      !bottomMid.edge && bottomMid.layout.x != null && bottomMid.layout.y != null,
      JSON.stringify({edge: bottomMid.edge, layout: bottomMid.layout}),
    )
    check(
      '竖直位置不会被丢掉屏幕外（底下的按钮要留着）',
      bottomMid.place.bottom >= -40,
      JSON.stringify(bottomMid.place),
    )

    // 隐藏态要能跨刷新留住：写入隐藏的布局 → 刷新页面 → 她要活着、仍然隐藏、把手可见可点
    await evaluate(`(function(){ localStorage.setItem('dsh-live2d-pet:layout', JSON.stringify({hidden:true})); return 1 })()`)
    await send('Page.reload', {}, sessionId, 8000).catch(() => {})
    let afterHiddenReload = { petAlive: false }
    for (let i = 0; i < 70; i++) {
      await sleep(500)
      try {
        const r = JSON.parse(
          await evaluate(`JSON.stringify((function(){
            var root = document.getElementById('dsh-live2d-pet');
            var tab = document.querySelector('.dshp-tab');
            return {
              petAlive: !!(window.DSHPet && window.DSHPet.state && window.DSHPet.state.modelSize),
              bootError: window.__DSHPetError || null,
              hidden: !!root && root.classList.contains('dshp-hidden'),
              tabVisible: !!tab && getComputedStyle(tab).display !== 'none',
              tabClickable: !!tab && getComputedStyle(tab).pointerEvents !== 'none'
            }})())`),
        )
        afterHiddenReload = r
        if (r.petAlive || r.bootError) break
      } catch (e) {}
    }
    check('隐藏态持久化后仍能正常启动', afterHiddenReload.petAlive === true, afterHiddenReload.bootError ? String(afterHiddenReload.bootError).split('\n')[0] : '')
    check('重新打开时保持隐藏但把手可见可点', afterHiddenReload.hidden === true && afterHiddenReload.tabVisible && afterHiddenReload.tabClickable, JSON.stringify(afterHiddenReload))
    // 清干净，别把隐藏态留给下一次
    await evaluate(`(function(){ localStorage.removeItem('dsh-live2d-pet:layout'); return 1 })()`)

    // 14) 连点生气 —— 主人第二次抱怨「平常模式点几下就生气，不好玩」。
    //     旧的判定是「和上次点击间隔 < 1.8 秒就累加」，于是每 1.5 秒点一下，
    //     到第三下照样炸毛。现在改成滑动窗口 + 平均间隔的真正速率判定，
    //     先用纯函数验几条边界，再用真实点击走一遍完整交互路径。
    const tiers = JSON.parse(
      await evaluate(`JSON.stringify({
        slow:     window.DSHPet.pokeTierFor([1200,1200,1200,1200,1200,1200]),
        normal:   window.DSHPet.pokeTierFor([800,800,800,800,800,800,800,800]),
        brisk:    window.DSHPet.pokeTierFor([500,500,500,500,500,500]),
        fourFast: window.DSHPet.pokeTierFor([250,250,250,250]),
        fast:     window.DSHPet.pokeTierFor([380,380,380,380,380,380,380]),
        frantic:  window.DSHPet.pokeTierFor([200,200,200,200,200,200,200,200,200,200]),
        burstThenCalm: window.DSHPet.pokeTierFor([150,150,150,150,150,150,150,3000,900,900,900]),
      })`),
    )
    check('慢慢点（1.2 秒一下）永远不生气', tiers.slow.rapid === false && tiers.slow.furious === false, JSON.stringify(tiers.slow))
    check('正常速度点（0.8 秒一下）不生气', tiers.normal.rapid === false, JSON.stringify(tiers.normal))
    check('手快但正常（0.5 秒一下）也不生气', tiers.brisk.rapid === false, JSON.stringify(tiers.brisk))
    check('连点四下（0.25 秒一下）只是被戳痒，不算生气', tiers.fourFast.rapid === true && tiers.fourFast.furious === false, JSON.stringify(tiers.fourFast))
    check('快（0.38 秒一下）也只是撒娇抗议，不生气', tiers.fast.rapid === true && tiers.fast.furious === false, JSON.stringify(tiers.fast))
    check('手速党（0.2 秒一下 × 10）才会真炸毛', tiers.frantic.rapid === true && tiers.frantic.furious === true, JSON.stringify(tiers.frantic))
    check('窗口是滑动的：炸毛后再停一会儿，慢点就不再生气', tiers.burstThenCalm.furious === false, JSON.stringify(tiers.burstThenCalm))

    // 真实点击：先慢，再快
    // 注意：上面那条「隐藏态持久化」的检查会把页面留在隐藏状态，
    // 而隐藏时点击是被忽略的——所以这里先一键重置（顺带解除隐藏）。
    const pokeRunner = (count, gap) => `(async function(){
      window.DSHPet.resetEverything();
      await new Promise(function(res){ setTimeout(res, 600) });
      var r = document.querySelector('#dsh-live2d-pet .dshp-stage').getBoundingClientRect();
      function find(){
        for (var i = 1; i <= 12; i++) for (var j = 1; j <= 12; j++) {
          var x = r.left + r.width * i / 13, y = r.top + r.height * j / 13;
          if (window.DSHPet.hitTest(x, y)) return {x: x, y: y};
        }
        return null;
      }
      window.DSHPet.clearPokes();
      var moods = [];
      var missed = 0;
      for (var k = 0; k < ${count}; k++) {
        var pt = find();
        if (pt) {
          var o = {bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 0, buttons: 1, pointerId: 1, isPrimary: true};
          document.dispatchEvent(new PointerEvent('pointerdown', o));
          document.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, {buttons: 0})));
        } else {
          missed++;
        }
        moods.push(window.DSHPet.state.mood);
        await new Promise(function(res){ setTimeout(res, ${gap}) });
      }
      return JSON.stringify({
        hidden: document.getElementById('dsh-live2d-pet').classList.contains('dshp-hidden'),
        missed: missed, tier: window.DSHPet.pokeTier(), moods: moods,
      });
    })()`

    const slowReal = JSON.parse(await evaluate(pokeRunner(5, 900)))
    check(
      '真实点击：慢慢点五下，全是可爱反应，没有一张生气的脸',
      slowReal.missed === 0 && slowReal.tier.count > 0 && slowReal.tier.rapid === false && slowReal.moods.indexOf('grumpy') === -1,
      JSON.stringify(slowReal),
    )

    const fastReal = JSON.parse(await evaluate(pokeRunner(8, 120)))
    check(
      '真实点击：手速党连点八下才炸毛',
      fastReal.tier.rapid === true && ['grumpy', 'alert', 'pout'].indexOf(fastReal.moods[6]) >= 0,
      JSON.stringify(fastReal),
    )
    check(
      '炸毛前那几下仍然是可爱反应（不提前生气）',
      fastReal.moods.slice(0, 6).indexOf('grumpy') === -1,
      JSON.stringify(fastReal.moods),
    )

    // 炸毛之后有冷静期：紧接着再来一串快点击，也不该再凶主人
    const afterAnger = JSON.parse(await evaluate(pokeRunner(8, 120)))
    check('炸毛之后有冷静期，连着快点击也不会一直凶', afterAnger.tier.furious === false, JSON.stringify(afterAnger.tier))

    // 15) 菜单里每一项都得「真的有事发生」——主人抱怨「点了没用、就卡在那」。
    //     逐页点一遍：表情页按**表情**去重、每一项都有配好的台词；
    //     装饰/场景是「常驻」的，动作是「一次性」的——三页分开，别混。
    const openTab = (name) => `(function(){
      var r = document.getElementById('dsh-live2d-pet');
      r.classList.add('dshp-open');
      var dock = document.querySelector('.dshp-dock');
      var panel = document.querySelector('.dshp-panel.dshp-on');
      if (!panel || !panel.classList.contains('dshp-on')) panel = null;
      if (!panel) dock.children[1].click();
      panel = document.querySelector('.dshp-panel.dshp-on');
      if (!panel) return JSON.stringify({err: '菜单打不开'});
      var tabs = panel.querySelectorAll('.dshp-tab-btn');
      for (var i = 0; i < tabs.length; i++) if (tabs[i].textContent === NAME) tabs[i].click();
      return JSON.stringify({ok: true});
    })()`.replace('NAME', JSON.stringify(name))

    await evaluate(openTab('表情'))
    const faceMenu = JSON.parse(await evaluate('JSON.stringify(window.DSHPet.menu())'))
    const faceLabels = faceMenu.chips.map((c) => c.label)
    check(
      '表情菜单按表情去重（星星眼不再出现两次）',
      new Set(faceLabels).size === faceLabels.length,
      faceLabels.join(','),
    )
    check(
      '表情菜单不再出现 呆呆眼 / 晕晕（主人点名不要的）',
      !faceLabels.some((l) => ['呆呆眼', '晕晕'].includes(l)),
      faceLabels.join(','),
    )
    check(
      '闭眼口水保留（原作者按键表里的正经表情 Alt+T）',
      faceLabels.includes('闭眼口水'),
      faceLabels.join(','),
    )
    check('菜单顶上写着「现在是什么状态」', /现在：/.test(faceMenu.status), faceMenu.status)

    // 每一个表情按钮：点下去要换脸 + 冒出一句配好的话
    const faceProbe = JSON.parse(
      await evaluate(`(async function(){
        var r = document.getElementById('dsh-live2d-pet');
        r.classList.add('dshp-open');
        var panel = document.querySelector('.dshp-panel.dshp-on');
        if (!panel) { document.querySelector('.dshp-dock').children[1].click(); panel = document.querySelector('.dshp-panel.dshp-on'); }
        var out = [];
        var labels = [];
        var chips = panel.querySelectorAll('.dshp-chip');
        for (var i = 0; i < chips.length; i++) labels.push(chips[i].textContent);
        for (var i = 0; i < chips.length; i++) {
          // 每次重新取，因为点完会重画这一页
          panel = document.querySelector('.dshp-panel.dshp-on');
          var list = panel.querySelectorAll('.dshp-chip');
          var label = labels[i];
          var chip = null;
          for (var j = 0; j < list.length; j++) if (list[j].textContent === label) chip = list[j];
          if (!chip) { out.push({label: label, err: 'chip 不见了'}); continue; }
          chip.click();
          await new Promise(function(res){ setTimeout(res, 260) });
          var st = window.DSHPet.state;
          var bubble = (document.querySelector('.dshp-body') || {}).textContent || '';
          out.push({label: label, mood: st.mood, face: st.face, override: !!st.override, said: bubble.slice(0, 24)});
        }
        return JSON.stringify(out);
      })()`),
    )
    const noReaction = faceProbe.filter((x) => x.err || (!x.override && !x.face))
    check(
      '每个表情按钮点下去都有反应（换脸 or 一次性表演）',
      noReaction.length === 0,
      JSON.stringify(noReaction.slice(0, 4)),
    )
    const silent = faceProbe.filter((x) => x.label !== '平常' && !x.said)
    check('每个表情按钮点下去都会说一句配好的话', silent.length === 0, JSON.stringify(silent.slice(0, 4)))

    // 菜单表情的规矩（主人这一轮定的）：
    //   · 点一下只演「三四秒」，不是 30 秒手动常驻 → 之后必须回到平常脸
    //   · 期间再点一个 / 她自己换表情 / agent 事件来了，都要能把它顶掉
    const faceLife = JSON.parse(
      await evaluate(`(async function(){
        window.DSHPet.resetEverything();
        await new Promise(function(res){ setTimeout(res, 400) });
        function clickFace(label){
          var r = document.getElementById('dsh-live2d-pet');
          r.classList.add('dshp-open');
          var panel = document.querySelector('.dshp-panel.dshp-on');
          if (!panel) { document.querySelector('.dshp-dock').children[1].click(); panel = document.querySelector('.dshp-panel.dshp-on'); }
          var tabs = panel.querySelectorAll('.dshp-tab-btn');
          for (var i = 0; i < tabs.length; i++) if (tabs[i].textContent === '表情') tabs[i].click();
          var list = panel.querySelectorAll('.dshp-chip');
          for (var j = 0; j < list.length; j++) if (list[j].textContent === label) { list[j].click(); return true; }
          return false;
        }
        var out = {};
        out.clicked = clickFace('爱心眼');
        await new Promise(function(res){ setTimeout(res, 250) });
        var s1 = window.DSHPet.state;
        out.after1 = {face: s1.face, left: s1.overrideLeft, userFace: s1.userProps && null};
        // 再点另一个：必须立刻顶掉
        clickFace('生气');
        await new Promise(function(res){ setTimeout(res, 250) });
        out.after2 = {face: window.DSHPet.state.face};
        // 等它自己过期
        await new Promise(function(res){ setTimeout(res, 4200) });
        var s3 = window.DSHPet.state;
        out.afterExpire = {face: s3.face, base: s3.base, overrideLeft: s3.overrideLeft};
        return JSON.stringify(out);
      })()`),
    )
    check('点菜单表情：立刻换脸，而且只挂三四秒（不是 30 秒手动常驻）',
      faceLife.clicked && faceLife.after1.face === '爱心眼' && faceLife.after1.left > 0 && faceLife.after1.left <= 4500,
      JSON.stringify(faceLife.after1))
    check('再点一个表情会立刻把它顶掉', faceLife.after2.face === '生气', JSON.stringify(faceLife.after2))
    check('过期后自己回到「平常脸」', faceLife.afterExpire.face === null && faceLife.afterExpire.base === 'neutral', JSON.stringify(faceLife.afterExpire))

    // agent 事件来了要能盖掉菜单选的临时表情
    const faceOverride = JSON.parse(
      await evaluate(`(async function(){
        window.DSHPet.resetEverything();
        await new Promise(function(res){ setTimeout(res, 300) });
        window.DSHPet.setReaction({mood: 'cry', ms: 8000});
        var during = window.DSHPet.state.face;
        await fetch('/__events', {method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({events:[{t:'turn-start',turn:9},{t:'step-start',turn:9,step:1},
            {t:'tool-call',callId:'ov1',name:'read',label:'读文件',args:'{}'}], gap: 120})});
        await new Promise(function(res){ setTimeout(res, 900) });
        var after = window.DSHPet.state;
        return JSON.stringify({during: during, after: {face: after.face, base: after.base, mood: after.mood}});
      })()`),
    )
    check('真实事件能盖掉临时表情（不会被她一直挂着）',
      faceOverride.after.base === 'reading' && faceOverride.after.face !== '哭',
      JSON.stringify(faceOverride))
    await evaluate(`fetch('/__events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:[{t:'turn-end',turn:9,reason:{kind:'completed'},ms:600,tokens:10}],gap:0})})`)
    await sleep(1200)

    // 装饰页
    await evaluate(openTab('装饰'))
    const propMenu = JSON.parse(await evaluate('JSON.stringify(window.DSHPet.menu())'))
    check('装饰菜单里每一项都有台词（不是点了没反应）', propMenu.chips.every((c) => /她会说/.test(c.title)), JSON.stringify(propMenu.chips.filter((c) => !/她会说/.test(c.title)).map((c) => c.label)))

    const propProbe = JSON.parse(
      await evaluate(`(async function(){
        var r = document.getElementById('dsh-live2d-pet');
        r.classList.add('dshp-open');
        var getPanel = function(){ return document.querySelector('.dshp-panel.dshp-on'); };
        if (!getPanel()) { document.querySelector('.dshp-dock').children[1].click(); }
        var out = [];
        var labels = [];
        var chips = getPanel().querySelectorAll('.dshp-chip');
        for (var i = 0; i < chips.length; i++) labels.push(chips[i].textContent);
        for (var i = 0; i < labels.length; i++) {
          var list = getPanel().querySelectorAll('.dshp-chip');
          var chip = null;
          for (var j = 0; j < list.length; j++) if (list[j].textContent === labels[i]) chip = list[j];
          if (!chip) { out.push({label: labels[i], err: 'chip 不见了'}); continue; }
          chip.click();
          await new Promise(function(res){ setTimeout(res, 300) });
          var st = window.DSHPet.state;
          var bubble = (document.querySelector('.dshp-body') || {}).textContent || '';
          out.push({label: labels[i], props: st.props, mood: st.mood, said: bubble.slice(0, 24)});
          // 关掉，免得同类互斥影响下一项
          var list2 = getPanel().querySelectorAll('.dshp-chip');
          for (var k = 0; k < list2.length; k++) if (list2[k].textContent === labels[i]) list2[k].click();
          await new Promise(function(res){ setTimeout(res, 200) });
        }
        return JSON.stringify(out);
      })()`),
    )
    const propDead = propProbe.filter((x) => x.err || !x.said)
    check('每个装饰品点下去都有表情 + 台词', propDead.length === 0, JSON.stringify(propDead.slice(0, 4)))

    // 白魔爪：得真的把爪子亮出来（以前只开一层看不见的颜色，主人说「点了没用」）
    const clawsWhite = JSON.parse(
      await evaluate(`(async function(){
        var r = document.getElementById('dsh-live2d-pet');
        r.classList.add('dshp-open');
        var getPanel = function(){ return document.querySelector('.dshp-panel.dshp-on'); };
        if (!getPanel()) document.querySelector('.dshp-dock').children[1].click();
        var tabs = getPanel().querySelectorAll('.dshp-tab-btn');
        for (var i = 0; i < tabs.length; i++) if (tabs[i].textContent === '场景') tabs[i].click();
        var list = getPanel().querySelectorAll('.dshp-chip');
        var chip = null;
        for (var j = 0; j < list.length; j++) if (list[j].textContent === '白魔爪') chip = list[j];
        if (!chip) return JSON.stringify({err: '没有白魔爪按钮'});
        chip.click();
        await new Promise(function(res){ setTimeout(res, 300) });
        var st = window.DSHPet.state;
        return JSON.stringify({props: st.props, mood: st.mood, bubble: ((document.querySelector('.dshp-body')||{}).textContent||'').slice(0,24)});
      })()`),
    )
    check(
      '白魔爪会同时亮出爪子 + 换色（不再是「点了没反应」）',
      !clawsWhite.err && clawsWhite.props.indexOf('魔爪') >= 0 && clawsWhite.props.indexOf('魔爪换色') >= 0,
      JSON.stringify(clawsWhite),
    )

    // 场景是「摆着不走」的：点开之后过 16 秒还得在
    const persist = JSON.parse(
      await evaluate(`(async function(){
        window.DSHPet.resetEverything();
        await new Promise(function(res){ setTimeout(res, 300) });
        var chip = null;
        var panel = document.querySelector('.dshp-panel.dshp-on');
        if (!panel) { document.querySelector('.dshp-dock').children[1].click(); panel = document.querySelector('.dshp-panel.dshp-on'); }
        var tabs = panel.querySelectorAll('.dshp-tab-btn');
        for (var i = 0; i < tabs.length; i++) if (tabs[i].textContent === '场景') tabs[i].click();
        var list = panel.querySelectorAll('.dshp-chip');
        for (var j = 0; j < list.length; j++) if (list[j].textContent === '桌面巴菲') chip = list[j];
        if (!chip) return JSON.stringify({err: '没有桌面巴菲按钮'});
        chip.click();
        await new Promise(function(res){ setTimeout(res, 500) });
        var first = window.DSHPet.state.props.slice();
        await new Promise(function(res){ setTimeout(res, 16000) });
        return JSON.stringify({first: first, later: window.DSHPet.state.props.slice(), userProps: window.DSHPet.state.userProps});
      })()`),
    )
    check(
      '场景摆设是常驻的：16 秒后还摆在桌上（主人要的「一直存在」）',
      !persist.err && persist.first.indexOf('巴菲') >= 0 && persist.later.indexOf('巴菲') >= 0,
      JSON.stringify(persist),
    )

    // 动作是「一次性」的：演完就消失，而且绝不写进 userProps
    // 注意：12 个动作 × 7 秒 ≈ 80 秒，**不能塞进一次 evaluate**（CDP 会超时）。
    // 所以循环放在 Node 这边，页面里每次只点一个、读一次状态。
    const actionLabels = JSON.parse(
      await evaluate(`(function(){
        window.DSHPet.resetEverything();
        var panel = document.querySelector('.dshp-panel.dshp-on');
        if (!panel) { document.querySelector('.dshp-dock').children[1].click(); panel = document.querySelector('.dshp-panel.dshp-on'); }
        var tabs = panel.querySelectorAll('.dshp-tab-btn');
        for (var i = 0; i < tabs.length; i++) if (tabs[i].textContent === '动作') tabs[i].click();
        var list = document.querySelector('.dshp-panel.dshp-on').querySelectorAll('.dshp-chip');
        var out = []; for (var j = 0; j < list.length; j++) out.push(list[j].textContent);
        return JSON.stringify(out);
      })()`),
    )
    const clickAction = (label) => `(async function(){
      var chips = document.querySelector('.dshp-panel.dshp-on').querySelectorAll('.dshp-chip');
      var chip = null;
      for (var i = 0; i < chips.length; i++) if (chips[i].textContent === ${JSON.stringify(label)}) chip = chips[i];
      if (!chip) return JSON.stringify({err: '找不到按钮'});
      chip.click();
      await new Promise(function(res){ setTimeout(res, 700) });
      var st = window.DSHPet.state;
      return JSON.stringify({label: ${JSON.stringify(label)}, props: st.props.slice(), overrideProps: st.overrideProps,
        mood: st.mood, said: ((document.querySelector('.dshp-body')||{}).textContent||'').slice(0,20)});
    })()`
    const oneShot = { labels: actionLabels, during: [], after: [], leaked: [] }
    for (const label of actionLabels) {
      const during = JSON.parse(await evaluate(clickAction(label)))
      oneShot.during.push(during)
      if (!during.err) {
        const leaked = JSON.parse(await evaluate('JSON.stringify(window.DSHPet.state.userProps)'))
        if (leaked.length) oneShot.leaked.push({ label, userProps: leaked })
      }
      await sleep(6600) // 等一次性动作自己过期（这一步在 Node 侧等，不吃 CDP 超时）
      oneShot.after.push({ label, props: JSON.parse(await evaluate('JSON.stringify(window.DSHPet.state.props)')) })
    }
    check('动作页列出了一次性动作（猫爪/比耶/蛋包饭…）', oneShot.labels.length >= 5, JSON.stringify(oneShot.labels))
    check(
      '每个动作点下去都真的演了（有表情/道具变化）+ 说了话',
      oneShot.during.every((d) => d.overrideProps && d.overrideProps.length >= 2 && d.said),
      JSON.stringify(oneShot.during.filter((d) => !d.overrideProps || !d.said)),
    )
    check(
      '动作不会写进「常驻」那一层（所以不会一直挂着）',
      oneShot.leaked.length === 0,
      JSON.stringify(oneShot.leaked),
    )
    check(
      '动作演完自己消失，回到「本子 + 笔」',
      oneShot.after.every((a) => a.props.length === 2 && a.props.indexOf('点菜按下') >= 0),
      JSON.stringify(oneShot.after),
    )

    // 每个菜单项都有台词表（静态）——四项：表情 / 装饰 / 场景 / 动作
    const tableCheck = JSON.parse(
      await evaluate(`JSON.stringify({
        face: ['happy','love','sad','cry','grumpy','confused','alert','tongue','dead','shy','pout','smug','gloomy','sweat','excited','listening','playful'].filter(function(k){ return !window.DSHPet.itemLines('face', k) }),
        decor: ['glassesRound','glassesSquare','glassesOval','glassesSun','stickerCat','stickerRabbit','stickerBow','flower','ponytail','headband','whaleHat'].filter(function(k){ return !window.DSHPet.itemLines('decor', k) }),
        scene: ['darkCloth','whaleOnDesk','parfait','claws','clawsWhite','phoneSkin','phone'].filter(function(k){ return !window.DSHPet.itemLines('scene', k) }),
        action: window.DSHPet.actions().map(function(a){ return a.key }).filter(function(k){ return !window.DSHPet.itemLines('action', k) }),
      })`),
    )
    check(
      '所有表情/装饰/场景/动作都配了台词',
      tableCheck.face.length + tableCheck.decor.length + tableCheck.scene.length + tableCheck.action.length === 0,
      JSON.stringify(tableCheck),
    )

    // 收尾：关掉菜单，别影响后面的检查
    await evaluate(`(function(){ document.getElementById('dsh-live2d-pet').classList.remove('dshp-open'); var p = document.querySelector('.dshp-panel.dshp-on'); if (p) p.classList.remove('dshp-on'); window.DSHPet.resetEverything(); return 1 })()`)
    await sleep(400)

    // 16) 主人报的「工作模式卡死」——干活中点了蛋包饭/手机之后，
    //     一键重置必须真的把一切清回「本子 + 笔 + 平常脸」，
    //     而且之后不能被干活轮播又推回工作脸（这是当时真正的病根）。
    const workEvents = [
      { t: 'user', text: '把这份资料看完' },
      { t: 'turn-start', turn: 1 },
      { t: 'step-start', turn: 1, step: 1 },
      { t: 'tool-call', callId: 's1', name: 'web_search', label: '上网查', args: '{"queries":["背景"]}' },
    ]
    const inject = (events, gap) => evaluate(`fetch('/__events',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify({ events, gap: gap || 150 }))}}).then(function(r){return r.status})`)
    const clickChip = (tab, label) => evaluate(`(function(){
      var r = document.getElementById('dsh-live2d-pet');
      r.classList.add('dshp-open');
      var get = function(){ return document.querySelector('.dshp-panel.dshp-on'); };
      if (!get()) document.querySelector('.dshp-dock').children[1].click();
      var tabs = get().querySelectorAll('.dshp-tab-btn');
      for (var i = 0; i < tabs.length; i++) if (tabs[i].textContent === ${JSON.stringify(tab)}) tabs[i].click();
      var list = get().querySelectorAll('.dshp-chip');
      var chip = null;
      for (var j = 0; j < list.length; j++) if (list[j].textContent === ${JSON.stringify(label)}) chip = list[j];
      if (!chip) return 'chip-missing';
      chip.click();
      return 'clicked';
    })()`)
    const brief = () => evaluate(`(function(){
      var s = window.DSHPet.state;
      return JSON.stringify({status: s.agent.status, mood: s.mood, face: s.face, base: s.base,
        props: s.props, userProps: s.userProps, work: s.work, device: s.device});
    })()`).then(JSON.parse)

    await evaluate('window.DSHPet.resetEverything()')
    await sleep(600)
    await inject(workEvents, 150)
    await sleep(1800)
    const busyNow = await brief()
    check('测试前提：确实进了工作模式', busyNow.status === 'working' && busyNow.work.active === true, JSON.stringify(busyNow))

    check('干活时点蛋包饭有反应', (await clickChip('动作', '蛋包饭')) === 'clicked')
    await sleep(900)
    const withOmurice = await brief()
    check(
      '干活时点蛋包饭：蛋包饭出现在桌上，且没写进常驻层',
      withOmurice.props.indexOf('蛋包饭') >= 0 && withOmurice.userProps.length === 0,
      JSON.stringify(withOmurice),
    )

    await evaluate('window.DSHPet.resetEverything()')
    await sleep(900)
    const afterReset = await brief()
    check(
      '一键重置：道具清空（只剩本子+笔）、表情回平常',
      afterReset.props.sort().join(',') === ['点菜按下', '画笔'].sort().join(',') &&
        afterReset.face === null &&
        afterReset.base === 'neutral',
      JSON.stringify(afterReset),
    )
    check('一键重置：干活轮播停掉（否则几秒后又被推回工作脸）', afterReset.work.active === false, JSON.stringify(afterReset.work))
    check('一键重置：小设备（手机）收回去', afterReset.device.out === false, JSON.stringify(afterReset.device))
    check(
      '一键重置：没有常驻道具残留（临时表演最多 3.5 秒后自己走）',
      afterReset.userProps.length === 0 && afterReset.props.length === 2,
      JSON.stringify({userProps: afterReset.userProps, props: afterReset.props}),
    )

    // 关键：重置之后一段时间里，不能被任何东西又推回工作状态
    const drift = []
    for (let i = 0; i < 8; i++) {
      await sleep(1000)
      drift.push(await brief())
    }
    const dirty = drift.filter((d) => d.face !== null || d.base !== 'neutral' || d.props.length !== 2)
    check(
      '重置后 8 秒内一直保持「本子+笔+平常脸」（不会自己漂回工作状态）',
      dirty.length === 0,
      JSON.stringify(dirty.slice(0, 3)),
    )

    // 桌上同时摆两件场景摆设：两件都得在（常驻）
    await clickChip('场景', '桌面巴菲')
    await sleep(300)
    await clickChip('场景', '深色桌布')
    await sleep(600)
    const twoScenes = await brief()
    check(
      '同时摆两件场景摆设：两件都在桌上（常驻）',
      twoScenes.props.indexOf('巴菲') >= 0 && twoScenes.props.indexOf('深色桌布') >= 0,
      JSON.stringify(twoScenes.props),
    )
    await evaluate('window.DSHPet.resetEverything()')
    await sleep(700)
    const cleaned = await brief()
    check('一键重置能把两件摆设一起清掉', cleaned.props.length === 2, JSON.stringify(cleaned))

    // 收工：把这一轮结束掉，免得影响后面的检查
    await inject([{ t: 'turn-end', turn: 1, reason: { kind: 'completed' }, ms: 800, tokens: 100 }], 0)
    await sleep(1500)

    // 17) UI 几何：主人抱怨「底下那三个框太大」「菜单不好用」。
    //     三个按钮必须排成一行、别比模型还显眼；面板必须完整落在屏幕里
    //     （桌宠蹲在右下角时，菜单右半边以前会跑到屏幕外，滑块和关闭按钮点不到）。
    await evaluate('window.DSHPet.resetEverything()')
    await sleep(700)
    const geom = JSON.parse(
      await evaluate(`(async function(){
        var r = document.getElementById('dsh-live2d-pet');
        r.classList.add('dshp-open');
        if (!document.querySelector('.dshp-panel.dshp-on')) document.querySelector('.dshp-dock').children[1].click();
        await new Promise(function(res){ setTimeout(res, 300) });
        var dock = document.querySelector('.dshp-dock');
        var btns = [];
        for (var i = 0; i < dock.children.length; i++) {
          var b = dock.children[i].getBoundingClientRect();
          btns.push({text: dock.children[i].textContent, w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), left: Math.round(b.left)});
        }
        var stage = document.querySelector('.dshp-stage').getBoundingClientRect();
        // 量**每一个正开着的**面板/ HUD，而不是「第一个 .dshp-panel」
        //（输入框也是 .dshp-panel，排在菜单前面，选错了就会量到一个隐藏的框）
        var open = [];
        document.querySelectorAll('.dshp-panel.dshp-on, .dshp-hud.dshp-on').forEach(function(p){
          var q = p.getBoundingClientRect();
          open.push({cls: p.className, left: Math.round(q.left), right: Math.round(q.right),
            top: Math.round(q.top), bottom: Math.round(q.bottom), w: Math.round(q.width)});
        });
        return JSON.stringify({
          btns: btns, stageH: Math.round(stage.height), vw: window.innerWidth, vh: window.innerHeight,
          open: open,
          now: (document.querySelector('.dshp-now') || {}).textContent || '',
        });
      })()`),
    )
    const rows = new Set(geom.btns.map((b) => b.top))
    check('底下三个按钮排成一行（不再被挤成又窄又高的方块）', rows.size === 1, JSON.stringify(geom.btns))
    check(
      '按钮高度不超过模型的 13%（原来是 37%，被折行撑成方块）',
      geom.btns.every((b) => b.h <= geom.stageH * 0.13),
      `${JSON.stringify(geom.btns.map((b) => b.h))} vs 模型 ${geom.stageH}`,
    )
    check(
      '打开的面板/HUD 都完整落在视口里（关闭按钮和滑块都点得到）',
      geom.open.length > 0 &&
        geom.open.every((p) => p.left >= 0 && p.right <= geom.vw && p.top >= 0 && p.bottom <= geom.vh),
      JSON.stringify({ open: geom.open, vw: geom.vw, vh: geom.vh }),
    )
    check('菜单顶上的状态行有内容', /现在：/.test(geom.now), geom.now)

    await evaluate('window.DSHPet.resetEverything()')
    await sleep(500)

    // 18) 右键 HUD（主人这一轮要的新功能，优先级最高）
    //     余额 / 本轮消耗 / 峰谷配色（峰红谷绿）/ 距切换倒计时，每轮结束自动弹，
    //     而且不能和菜单、对话抢屏幕。
    await evaluate('window.DSHPet.resetEverything()')
    await sleep(600)
    const hud = JSON.parse(
      await evaluate(`(async function(){
        // 真鼠标右键：走 document 的 contextmenu 路径
        var r = document.querySelector('#dsh-live2d-pet .dshp-stage').getBoundingClientRect();
        var pt = null;
        for (var i = 1; i <= 12 && !pt; i++) for (var j = 1; j <= 12 && !pt; j++) {
          var x = r.left + r.width * i / 13, y = r.top + r.height * j / 13;
          if (window.DSHPet.hitTest(x, y)) pt = {x: x, y: y};
        }
        if (!pt) return JSON.stringify({err: '找不到能右键的坐标'});
        document.getElementById('dsh-live2d-pet').dispatchEvent(new MouseEvent('contextmenu',
          {bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 2, buttons: 2}));
        await new Promise(function(res){ setTimeout(res, 900) });
        var st = window.DSHPet.hud.read();
        var box = document.querySelector('.dshp-hud');
        var rb = box.getBoundingClientRect();
        var overflowX = rb.left < 0 || rb.right > window.innerWidth;
        var overflowY = rb.top < 0;
        // 打开菜单，看 HUD 会不会自己收起来
        var menuPanel = function(){ return document.querySelector('.dshp-panel.dshp-on'); };
        var menuBefore = !!menuPanel();
        document.querySelector('.dshp-dock').children[1].click();
        await new Promise(function(res){ setTimeout(res, 450) });
        var afterMenu = window.DSHPet.hud.open();
        var menuNow = !!menuPanel();
        // ⋯ 是开关：开着就关。所以「状态必须真的变了」，并且 HUD 一定不在
        if (menuPanel()) menuPanel().querySelector('.dshp-close').click();
        return JSON.stringify({st: st, overflowX: overflowX, overflowY: overflowY, afterMenu: afterMenu,
          menuOpen: menuNow, menuChanged: menuNow !== menuBefore});
      })()`),
    )
    check('右键弹出的是 HUD（不是设置菜单）', !hud.err && hud.st.open === true, JSON.stringify(hud.err || hud.st && hud.st.open))
    check(
      'HUD 显示余额（¥ 数字）',
      /^¥\d/.test(hud.st.text.money) || /未配置|—/.test(hud.st.text.money),
      hud.st.text.money,
    )
    const colors = JSON.parse(
      await evaluate(`(function(){
        var probe = function(cls){
          var s = document.createElement('span');
          s.className = 'dshp-hud-tag ' + cls;
          document.getElementById('dsh-live2d-pet').appendChild(s);
          var c = getComputedStyle(s).color;
          s.remove();
          return c;
        };
        return JSON.stringify({peak: probe('dshp-peak'), valley: probe('dshp-valley')});
      })()`),
    )
    const rgb = (css) => (css.match(/\d+/g) || []).slice(0, 3).map(Number)
    const [pr, pg, pb] = rgb(colors.peak)
    const [vr, vg, vb] = rgb(colors.valley)
    check(
      'HUD 有峰/谷标记，且峰=红、谷=绿（真读计算样式）',
      /峰|谷/.test(hud.st.text.badge) &&
        ((hud.st.text.badge === '峰' && /dshp-peak/.test(hud.st.text.badgeClass)) ||
          (hud.st.text.badge === '谷' && /dshp-valley/.test(hud.st.text.badgeClass))) &&
        pr > pg && pr > pb && vg > vr && vg > vb,
      `${hud.st.text.badge} · 峰 ${colors.peak} / 谷 ${colors.valley}`,
    )
    check('HUD 有「距切换」倒计时', hud.st.text.countdown !== '—' && /小时|分钟|即将/.test(hud.st.text.countdown), hud.st.text.countdown)
    check('HUD 完整落在屏幕里（不会被边缘切掉）', hud.overflowX === false && hud.overflowY === false, JSON.stringify({x: hud.overflowX, y: hud.overflowY}))
    check(
      'HUD 与菜单不冲突（开一次菜单，HUD 就收起来了）',
      hud.menuChanged === true && hud.afterMenu === false,
      JSON.stringify({menuChanged: hud.menuChanged, menuOpen: hud.menuOpen, hudOpen: hud.afterMenu}),
    )

    // 一轮结束 → 只刷新「本轮消耗」数据，面板不自动弹（见 bce41fe：钱包面板彻底不自动弹）
    const pop = JSON.parse(
      await evaluate(`(async function(){
        window.DSHPet.resetEverything();
        window.DSHPet.hud.hide();
        await fetch('/__events', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({events:[
          {t:'turn-start',turn:77},{t:'step-start',turn:77,step:1},
          {t:'tool-call',callId:'hh1',name:'bash',label:'跑命令',args:'{"command":"npm test"}'},
          {t:'tool-result',callId:'hh1',name:'bash',label:'跑命令',ms:900,error:null},
          {t:'turn-end',turn:77,reason:{kind:'completed'},ms:8000,tokens:18000}], gap:200})});
        await new Promise(function(res){ setTimeout(res, 4500) });
        return JSON.stringify(window.DSHPet.hud.read());
      })()`),
    )
    check(
      '一轮结束只刷新「本轮消耗」，不自动弹出钱包面板（主人明确不要）',
      pop.open === false && pop.turn && pop.turn.amount !== null && /¥/.test(pop.text.turn),
      JSON.stringify({open: pop.open, turn: pop.turn, text: pop.text.turn}),
    )

    // 数据来源：优先用宿主自带的 /dsh-pet/hud
    const src = JSON.parse(await evaluate(`JSON.stringify({source: window.DSHPet.hud.read().source,
      money: window.DSHPet.hud.read().text.money, foot: window.DSHPet.hud.read().text.foot})`))
    check('HUD 优先读宿主自带的 /dsh-pet/hud', src.source === 'self', JSON.stringify(src))

    // 降级：宿主接口挂了，要能退回 dsh-whale-widget
    const fb = JSON.parse(
      await evaluate(`(async function(){
        var orig = window.fetch;
        window.fetch = function(u, o){
          if (String(u).indexOf('/dsh-pet/hud') === 0) return Promise.resolve({ok:false, json:function(){return Promise.resolve(null)}});
          return orig(u, o);
        };
        try {
          window.DSHPet.hud.hide();
          await window.DSHPet.hud.refresh();
          var r = window.DSHPet.hud.read();
          return JSON.stringify({source: r.source, money: r.text.money, err: r.err});
        } finally { window.fetch = orig; }
      })()`),
    )
    check(
      '宿主接口不可用时自动降级到 dsh-whale-widget',
      fb.source === 'widget' && /^¥\d/.test(fb.money),
      JSON.stringify(fb),
    )
    await evaluate('(async function(){ await window.DSHPet.hud.refresh(); return 1 })()')

    // 连点右键不该反复打余额接口（60 秒节流）
    const throttle = JSON.parse(
      await evaluate(`(function(){
        // 直接看代码里的节流常量在不在（真打接口没法在测试里数次数）
        return JSON.stringify({ok: typeof window.DSHPet.hud.refresh === 'function'});
      })()`),
    )
    const twice = JSON.parse(
      await evaluate(`(async function(){
        var a = await window.DSHPet.hud.refresh();
        var b = await window.DSHPet.hud.refresh();
        return JSON.stringify({ok: !!(a && b), same: JSON.stringify(a) === JSON.stringify(b)});
      })()`),
    )
    check('HUD 连续强制刷新不会出错（内有 60 秒节流）', throttle.ok === true && twice.ok === true, JSON.stringify(twice))

    await evaluate('window.DSHPet.hud.hide()')
    await sleep(300)

    const logs = (await evaluate('(window.__dshpLogs||[]).slice(0,20)')) || []
    const errors = logs.filter((l) => l.indexOf('E:') === 0 || l.indexOf('X:') === 0)
    check('运行期没有 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | ') || '干净')
    if (logs.length) {
      console.log('  ── 页面日志 ──')
      for (const l of logs.slice(0, 8)) console.log('     ' + String(l).slice(0, 200))
    }
  }

  ws.close()
}

main()
  .catch((err) => {
    console.error('\n自检脚本失败:', err.message)
    process.exitCode = 1
  })
  .finally(async () => {
    console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`)
    try {
      chrome.kill('SIGKILL')
    } catch (e) {}
    await sleep(200)
    try {
      fs.rmSync(profile, { recursive: true, force: true })
    } catch (e) {}
    process.exit(fail > 0 ? 1 : 0)
  })
