// DS 鲸鱼娘桌宠 · Windows 桌面外壳
// ————————————————————————————————————————————————————————————
// 和 macOS 版同一个思路：**她本身还是那份插件**（模型、联动、菜单、钱包都在插件里），
// 这个程序只是一个透明、无边框、永远置顶的窗口，加载插件提供的那一页。
//
// Windows 上比 macOS 容易的地方：Electron 自带跨平台，不用担心 App Nap、私有 API 那类坑。
// 需要注意的只有三件：
//   ① 点击穿透：setIgnoreMouseEvents(true, { forward: true }) + 我们自己定时问页面「鼠标下面是不是她」
//   ② 本机通行证：插件的 /dsh-pet/* 要过信任栅栏，所以把 ~/.dsh 里那张通行证写成 cookie
//   ③ 打字：Electron 窗口默认可聚焦，不用像 macOS 那样覆写 canBecomeKey
//
// 另外按主人要求做了「联动」：第一次打开时如果检测不到插件，会直接给一个
// 「一键安装插件」按钮，替你跑 dsh plugin --profile web add github:...，
// 所以 Windows 用户不需要自己开命令行。
const { app, BrowserWindow, Tray, Menu, screen, shell, session, ipcMain, nativeImage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { exec } = require('node:child_process')

const PET_URL = 'http://127.0.0.1:3080/dsh-pet/standalone'
const ORIGIN = 'http://127.0.0.1:3080'
const PLUGIN = 'github:3Asterism/dsh-whale-girl-live2d-custom'
// 同 macOS：窗口要装得下她 + 四周的面板（透明区域点击穿透，不挡别的窗口）
const WIN_W = 560
const WIN_H = 900   // 只加高：给她头顶留出聊天框的位置
const BALL = 62
const TOKEN_FILE = path.join(os.homedir(), '.dsh', 'dsh-live2d-pet-desktop.json')

let win = null
let ballWin = null
let tray = null
let pollTimer = null
let dragTimer = null
let dragFrom = null
let collapsed = false
let lowPower = false
let overPanel = false
let failCount = 0
let lastHit = 'none'

// ——————————————————————————————————————————————————————————————
// 通行证：插件启动时会写 ~/.dsh/dsh-live2d-pet-desktop.json
// ——————————————————————————————————————————————————————————————
function readToken() {
  try {
    const j = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
    return typeof j.token === 'string' && j.token.length >= 16 ? j.token : null
  } catch (e) {
    return null
  }
}

async function setTokenCookie() {
  const token = readToken()
  if (!token) return false
  try {
    await session.defaultSession.cookies.set({
      url: ORIGIN,
      name: 'dsh_pet_desk',
      value: token,
      domain: '127.0.0.1',
      path: '/',
      secure: false,
      httpOnly: false,
    })
    return true
  } catch (e) {
    return false
  }
}

// ——————————————————————————————————————————————————————————————
// 判断「鼠标下面是什么」：她本体 / 她的面板 / 空白
// ——————————————————————————————————————————————————————————————
const hitJS = (x, y) => `(function(){try{
  var el=document.elementFromPoint(${x},${y});
  var ui=!!(el&&el.closest&&el.closest('.dshp-panel,.dshp-menu,.dshp-hud,.dshp-bubble,.dshp-composer,.dshp-dock,.dshp-tab'));
  if(ui) return 'panel';
  if(window.DSHPet&&DSHPet.hitTest&&DSHPet.hitTest(${x},${y})) return 'model';
  return 'none';
}catch(e){return 'none'}})()`

function setIgnore(on) {
  if (!win || win.isDestroyed()) return
  win.setIgnoreMouseEvents(on, { forward: true })
}

async function poll() {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  const p = screen.getCursorScreenPoint()
  const b = win.getBounds()
  if (p.x < b.x || p.x > b.x + b.width || p.y < b.y || p.y > b.y + b.height) {
    lastHit = 'none'
    setIgnore(true)
    return
  }
  if (dragTimer) return // 拖动中不抢事件（否则鼠标一离开她就变穿透，拖动会断）
  try {
    const kind = await win.webContents.executeJavaScript(hitJS(Math.round(p.x - b.x), Math.round(p.y - b.y)))
    lastHit = kind
    overPanel = kind === 'panel'
    setIgnore(kind === 'none')
  } catch (e) {
    setIgnore(true)
  }
}

// ——————————————————————————————————————————————————————————————
// 主窗口
// ——————————————————————————————————————————————————————————————
function createMain() {
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    title: 'DS 鲸鱼娘桌宠',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false, // 她不能被后台降频（不然会像卡住）
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  win.setMenuBarVisibility(false)

  const wa = screen.getPrimaryDisplay().workArea
  const saved = readPos()
  win.setPosition(saved ? saved[0] : wa.x + wa.width - WIN_W - 8, saved ? saved[1] : wa.y + wa.height - WIN_H - 8)

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('did-finish-load', () => {
    failCount = 0
    win.webContents.executeJavaScript('window.DSHPet && DSHPet.setLowPower && DSHPet.setLowPower(' + lowPower + ')').catch(() => {})
    setTimeout(() => win.webContents.executeJavaScript('window.DSHPet && DSHPet.setHidden && DSHPet.setHidden(false)').catch(() => {}), 1200)
    setTimeout(() => win.webContents.executeJavaScript('window.DSHPet && DSHPet.setHidden && DSHPet.setHidden(false)').catch(() => {}), 3000)
  })
  win.webContents.on('did-fail-load', () => {
    failCount++
    if (failCount >= 3) showHint()
    setTimeout(load, 5000)
  })
  win.on('moved', savePos)
  win.on('closed', () => { win = null })

  // 拖动：页面里按下她 → 交给主进程搬窗口（拖动期间用 16ms 快速轮询，跟手）
  ipcMain.on('drag-start', (_e, at) => {
    if (!win || overPanel) return
    dragFrom = { mouse: at, win: win.getPosition() }
    clearInterval(dragTimer)
    dragTimer = setInterval(() => {
      if (!dragFrom || !win) return
      const p = screen.getCursorScreenPoint()
      win.setPosition(dragFrom.win[0] + (p.x - dragFrom.mouse.x), dragFrom.win[1] + (p.y - dragFrom.mouse.y))
    }, 16)
    win.webContents.executeJavaScript("document.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}))").catch(() => {})
  })
  ipcMain.on('drag-end', () => {
    clearInterval(dragTimer)
    dragTimer = null
    dragFrom = null
    savePos()
  })
  // 前端那个 ↗ 符号：用默认浏览器打开 DSH 界面
  ipcMain.on('install-plugin', () => installPlugin())
  // 前端（pet.js）发来的指令，和 macOS 版一一对应。
  // ⚠️ 每条都带状态守卫：macOS 版在这里踩过无限递归的坑（expand 后又收到 shown 再 expand，
  //    日志炸到 5472 万行、CPU 打满），Windows 版一开始就不留这个隐患。
  ipcMain.on('shell-msg', (_e, msg) => {
    switch (msg) {
      case 'hidden':
      case 'collapse':
        if (!collapsed) collapse()
        break
      case 'shown':
      case 'expand':
        if (collapsed) expand()
        break
      case 'open-dsh':
        shell.openExternal(ORIGIN + '/')
        break
      case 'quit':
        app.quit()
        break
    }
  })

  load()
  pollTimer = setInterval(poll, 90)
  win.once('ready-to-show', () => {
    win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver')
  })
}

function load() {
  if (!win || win.isDestroyed()) return
  setTokenCookie().then((ok) => {
    if (!ok) return showHint()
    win.loadURL(PET_URL)
  })
}

function readPos() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'pos.json'), 'utf8'))
    if (Array.isArray(j) && j.length === 2 && Number.isFinite(j[0])) return j
  } catch (e) {}
  return null
}

function savePos() {
  if (!win || win.isDestroyed()) return
  const [x, y] = win.getPosition()
  const dir = app.getPath('userData')
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'pos.json'), JSON.stringify([x, y]))
  } catch (e) {}
}

/** DSH 没起来 / 插件没装时给一张能看懂、能求助的页面 */
function showHint(installed) {
  if (!win || win.isDestroyed()) return
  const token = readToken()
  const html = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent}
  body{display:flex;align-items:center;justify-content:center;font:13px/1.7 "Microsoft YaHei",-apple-system,sans-serif;color:#fff;text-align:center}
  .box{background:rgba(18,22,34,.9);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:18px 22px;max-width:80%}
  .t{font-weight:600;margin-bottom:8px;font-size:15px}
  .s{opacity:.75;font-size:12px;margin-bottom:12px}
  button{font:inherit;padding:8px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.25);
    background:rgba(59,98,246,.9);color:#fff;cursor:pointer;margin:0 4px}
  code{background:rgba(127,150,255,.18);padding:2px 6px;border-radius:6px}
  </style><body><div class="box">
  <div class="t">🐋 正在找 DSH…</div>
  <div class="s">${token ? '通行证已就位，但连不上 <code>127.0.0.1:3080</code>。<br>请确认 ① 装了插件 ② DSH 正在运行。' : '还没读到通行证 <code>~/.dsh/dsh-live2d-pet-desktop.json</code>。<br>请先在 DSH 里装插件，然后重启 DSH。'}</div>
  <button onclick="window.dshpet.install()">一键安装插件</button>
  <button onclick="window.dshpet.reload()">重新连接</button>
  </div>
  <script>
    window.dshpet = {
      install: () => window.dshpetBridge && window.dshpetBridge.install(),
      reload: () => window.dshpetBridge && window.dshpetBridge.reload(),
    }
  </script></body>`
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
}

/** 联动：替用户跑一遍插件安装命令（这就是「下载软件同时把插件装好」） */
function installPlugin() {
  const cmd = `dsh plugin --profile web add ${PLUGIN}`
  if (!win || win.isDestroyed()) return
  win.webContents
    .executeJavaScript(
      `document.querySelector('.s').innerHTML = '正在安装插件…<br><code>${cmd}</code>'`,
    )
    .catch(() => {})
  exec(cmd, { timeout: 300000, windowsHide: true }, (err, stdout, stderr) => {
    const tail = (err ? String(stderr || err.message) : String(stdout || '')).slice(-400)
    const ok = !err
    const msg = ok
      ? '✅ 插件装好了。<br>现在**重启一次 DSH**，然后点「重新连接」。<br><code>' + cmd + '</code>'
      : '❌ 没装成，可能要手动来一次：<br><code>' + cmd + '</code><br>错误：' + tail
    win.webContents
      .executeJavaScript(`document.querySelector('.s').innerHTML = ${JSON.stringify(msg)}`)
      .catch(() => {})
    if (ok) setTimeout(load, 4000)
  })
}

// ——————————————————————————————————————————————————————————————
// 贴边小球（收起态）
// ——————————————————————————————————————————————————————————————
function ballHTML() {
  const icon = readWhaleSVG()
  return `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;user-select:none;-webkit-app-region:no-drag}
  .ball{width:100%;height:100%;border-radius:50%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(120% 120% at 50% 0%, rgba(60,70,96,.98), rgba(16,20,32,.98));
    border:1.5px solid rgba(255,255,255,.34);box-shadow:0 6px 18px rgba(0,0,0,.38);cursor:pointer}
  .ball:hover{border-color:rgba(255,255,255,.6);transform:scale(1.06)}
  svg{width:58%;height:58%}
  svg path{fill:#fff}
  </style><body><div class="ball">${icon}</div></body>`
}

function readWhaleSVG() {
  const cands = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'favicon.svg'),
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/favicon.svg',
  ]
  for (const p of cands) {
    try {
      const s = fs.readFileSync(p, 'utf8')
      if (s.includes('<svg')) return s.replace(/<style>[\s\S]*?<\/style>/, '')
    } catch (e) {}
  }
  return '<svg viewBox="0 0 24 24"><path d="M3 15c3 0 4-2 6-2s3 2 6 2 4-3 6-3v3c-2 0-3 3-6 3s-3-2-6-2-3 2-6 2z"/></svg>'
}

function createBall() {
  ballWin = new BrowserWindow({
    width: BALL,
    height: BALL,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    // ⚠️ 小球也必须挂 preload：它是靠 window.dshpetBridge 把点击/拖动报回来的，
    // 不挂就等于「小球点不动、拖不了」（写完先自查发现的）
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  })
  ballWin.setAlwaysOnTop(true, 'screen-saver')
  ballWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(ballHTML()))
  ballWin.webContents.on('did-finish-load', () => {
    // 点一下展开；拖一下挪位置（松手贴最近的一边）
    ballWin.webContents.executeJavaScript(`
      (function(){
        var d=false, moved=0, sx=0, sy=0;
        document.addEventListener('mousedown', function(e){ d=true; moved=0; sx=e.screenX; sy=e.screenY; e.preventDefault() });
        document.addEventListener('mousemove', function(e){ if(!d) return; moved=Math.max(moved, Math.abs(e.screenX-sx)+Math.abs(e.screenY-sy));
          if(moved>3) window.dshpetBridge && window.dshpetBridge.ballMove(e.screenX-sx, e.screenY-sy) });
        document.addEventListener('mouseup', function(){ if(!d) return; d=false;
          window.dshpetBridge && window.dshpetBridge.ballDrop(moved>3) });
      })()
    `).catch(() => {})
  })
  ipcMain.on('ball-move', (_e, dx, dy) => {
    if (!ballWin || !dragFrom) return
    ballWin.setPosition(dragFrom[0] + dx, dragFrom[1] + dy)
  })
  ipcMain.on('ball-drop', (_e, moved) => {
    if (!ballWin) return
    if (!moved) return expand()
    snapBall()
  })
}

function snapBall() {
  if (!ballWin) return
  const wa = screen.getPrimaryDisplay().workArea
  const [x, y] = ballWin.getPosition()
  const nearest = x + BALL / 2 < wa.x + wa.width / 2 ? wa.x + 4 : wa.x + wa.width - BALL - 4
  const ny = Math.min(Math.max(y, wa.y + 4), wa.y + wa.height - BALL - 4)
  ballWin.setPosition(nearest, ny)
}

function collapse() {
  if (!win || collapsed) return
  collapsed = true
  savePos()
  const [wx, wy] = win.getPosition()
  const wa = screen.getPrimaryDisplay().workArea
  const onLeft = wx + WIN_W / 2 < wa.x + wa.width / 2
  if (!ballWin) createBall()
  ballWin.setPosition(onLeft ? wa.x + 4 : wa.x + wa.width - BALL - 4, Math.round(wy + WIN_H / 2 - BALL / 2))
  ballWin.showInactive()
  ballWin.setAlwaysOnTop(true, 'screen-saver')
  win.hide()
  dragFrom = [ballWin.getPosition()[0], ballWin.getPosition()[1]]
  setTimeout(snapBall, 30)
}

function expand() {
  if (!collapsed) return
  collapsed = false
  if (ballWin) {
    dragFrom = null
    ballWin.hide()
  }
  if (win) {
    win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver')
    win.webContents.executeJavaScript('window.DSHPet && DSHPet.setHidden && DSHPet.setHidden(false)').catch(() => {})
  }
}

// ——————————————————————————————————————————————————————————————
// 托盘菜单（Windows 上没有菜单栏图标，改放系统托盘）
// ——————————————————————————————————————————————————————————————
function createTray() {
  const iconPath = path.join(__dirname, 'build', 'icon.png')
  let img = nativeImage.createFromPath(iconPath)
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 })
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img)
  tray.setToolTip('DS 鲸鱼娘桌宠')
  const rebuild = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '重新加载', click: load },
        { label: collapsed ? '展开桌宠' : '收起成小球（贴边）', click: () => (collapsed ? expand() : collapse()) },
        { label: '回到右下角', click: resetPos },
        { type: 'separator' },
        {
          label: '低性能模式（少动、省电）',
          type: 'checkbox',
          checked: lowPower,
          click: (mi) => {
            lowPower = mi.checked
            if (win) win.webContents.executeJavaScript('window.DSHPet && DSHPet.setLowPower && DSHPet.setLowPower(' + lowPower + ')').catch(() => {})
          },
        },
        { label: '一键安装插件（如果还没装）', click: installPlugin },
        { label: '打开 DSH 界面', click: () => shell.openExternal(ORIGIN + '/') },
        { type: 'separator' },
        { label: '彻底退出', click: () => app.quit() },
      ]),
    )
  tray.on('click', () => (collapsed ? expand() : win && win.showInactive()))
  setInterval(rebuild, 1500)
  rebuild()
}

function resetPos() {
  if (!win) return
  const wa = screen.getPrimaryDisplay().workArea
  win.setPosition(wa.x + wa.width - WIN_W - 8, wa.y + wa.height - WIN_H - 8)
  savePos()
}

// ——————————————————————————————————————————————————————————————
app.whenReady().then(() => {
  app.setAppUserModelId('com.andersen216.dsh.whalegirlpet')
  createMain()
  createTray()
  ipcMain.on('reload', load)
})
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  clearInterval(pollTimer)
  clearInterval(dragTimer)
})
