<div align="center">

# 🐋 鲸鱼娘桌宠 · Whale Girl Live2D

**DSH（DeepSeek Harness）Web 界面里的 Live2D 桌宠 —— 她真的在跟着 agent 干活。**
**A Live2D desktop pet for the DeepSeek Harness Web UI — she really does follow what the agent is doing.**

[![Release](https://img.shields.io/github/v/release/3Asterism/dsh-whale-girl-live2d-custom?label=release&color=2f81f7)](https://github.com/3Asterism/dsh-whale-girl-live2d-custom/releases)
[![Based on](https://img.shields.io/badge/based%20on-Andersen216%2Fdsh--whale--girl--live2d-lightgrey)](https://github.com/Andersen216/dsh-whale-girl-live2d)
[![Code: MIT](https://img.shields.io/badge/code-MIT-3fb950)](LICENSE)
[![Artwork: CC BY-NC-SA 4.0](https://img.shields.io/badge/artwork-CC%20BY--NC--SA%204.0-d29922)](NOTICE.md)
[![Non-commercial](https://img.shields.io/badge/use-non--commercial-e5534b)](NOTICE.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-8957e5)](#-安装--install)

<img src="docs/screenshots/01-待机.jpg" alt="鲸鱼娘待在 DSH 界面右下角，左手笔右手本子" width="820">

点一下就能跟 agent 说话 · 右键就是钱包 · 表情 / 装饰 / 场景 / 动作 四页菜单 · 拖动换位置

</div>

---

## 🔀 这是什么仓库 / About this repo

**这是 [Andersen216/dsh-whale-girl-live2d](https://github.com/Andersen216/dsh-whale-girl-live2d) 的二次开发版本**，
不是原创。代码 / 美术 / 运行时的许可证和署名要求跟原仓库完全一样（见下方「许可与署名」一节，
一个字都没改）——这份 README 大部分内容直接沿用原仓库，只是在这里额外说明改了什么。

**跟原仓库比，这个版本多了什么：**

| 改动 | 状态 |
| --- | --- |
| 修复桌面版（Electron 官方壳）不显示鲸鱼娘的问题 | 已提交原仓库 [PR #2](https://github.com/Andersen216/dsh-whale-girl-live2d/pull/2)（等待合并） |
| 性能优化：隐藏时停渲染、减少每帧内存分配、缓存布局读取 | 已提交原仓库 [PR #3](https://github.com/Andersen216/dsh-whale-girl-live2d/pull/3)（等待合并） |
| 真正的四角贴边吸附 + 工具条自动侧移 + 面板越界兜底 | 已提交原仓库 [PR #4](https://github.com/Andersen216/dsh-whale-girl-live2d/pull/4)（等待合并） |
| 「安静模式」：气泡默认不复述对话原文、不显示流水账/token 消耗 | **只在这个仓库**，原作者不一定认可这个交互取向，没有提交上游 |
| 扩充台词池：取材中文互联网上 DeepSeek/鲸鱼娘相关的梗 | **只在这个仓库**，同上 |

上面三条已经提给原作者的修复，如果哪天被合并进原仓库，这边会跟着同步、不会重复维护两份。
后两条是交互风格上的个人取向调整，不一定符合原作者的设计意图，所以没有提 PR，只保留在这个仓库里。

**装哪个仓库**：只想要原版体验 → 装 [Andersen216 的原仓库](https://github.com/Andersen216/dsh-whale-girl-live2d)
（装法把下面命令里的 `3Asterism/dsh-whale-girl-live2d-custom` 换回 `Andersen216/dsh-whale-girl-live2d` 即可）；
想要上面这些改动 → 直接照本 README 下面的安装命令装，已经是这个仓库的版本。

> **English**: this repository is a customized fork of
> [Andersen216/dsh-whale-girl-live2d](https://github.com/Andersen216/dsh-whale-girl-live2d), not an
> original work. Licensing and attribution requirements are identical to the upstream repo (see
> "License & credits" below, unchanged). Three fixes (desktop display, performance, corner-snap docking)
> have been submitted upstream as PRs and will stop being maintained here separately once merged; two
> interaction-style customizations (a "quiet mode" that suppresses chat-echo/process chatter by default,
> and an expanded line pool drawing on Chinese-internet DeepSeek/whale-girl memes) are kept only in this
> repo since they reflect a personal taste the original author may not share.

---

## 🐋 先读这三行：只有**一套插件**，两种用法

1. **插件只有一个**：`dsh-whale-girl-live2d`。装一次，网页版和桌面版**共用同一份** ——
   模型、动作、表情、跟 agent 的联动、菜单、钱包、设置，全部在插件里。
2. **网页版** = 插件自带的用法，装完就有（Windows / macOS / Linux 都能用）。
3. **桌面版** = 额外下载一个 **1.4 MB 的 macOS 外壳 App**，把同一个页面放进桌面上的独立窗口。
   **它不是第二个插件**，也不用再装任何东西。

> **「网页版和桌面版是两套不同的插件吗？」→ 不是。**
> 是一套插件 + 一个可选的 Mac 外壳。所以你不需要"两边都装插件"，
> 也不存在"装了桌面版会不会跟网页版冲突"。

### 两种用法对照

| | 🖥 **网页版** | 🐋 **桌面版**（macOS 外壳） |
| --- | --- | --- |
| 是什么 | 插件本体（**必装**） | 一个 1.4 MB 的 App，加载插件提供的那一页 |
| 她住在哪 | DSH Web 界面右下角（浏览器标签页里） | **你的桌面上**：透明、无边框、永远置顶 |
| 支持平台 | **Windows / macOS / Linux** | **只有 macOS 13+**（跨平台外壳在计划中） |
| 需要装什么 | 插件 | 插件 **＋** 这个 App |
| 浏览器要开着吗 | 要（她在那张标签页里） | **不用**，DSH 在跑就行 |
| 额外能力 | — | 点击穿透（不挡干活）· 拖她=拖窗口 · **贴边悬浮球** · 菜单栏 🐋 · 低性能模式 · 设置里「彻底关闭 App」 |

### 安装：两条路都行，按你现在的状态选

#### 🅰 先装网页版，再装桌面版（推荐）

```bash
# ① 装插件
dsh plugin --profile web add github:3Asterism/dsh-whale-girl-live2d-custom

# ② 重启 DSH（宿主插件只在启动时加载），然后刷新页面
#    右下角出现她 = 网页版成功

# ③ 自检（返回 401 = 已挂载，被信任栅栏挡着，正常；404 = 没加载）
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/dsh-pet/pet.js
```

然后装桌面版：去 [Releases](https://github.com/Andersen216/dsh-whale-girl-live2d/releases/latest)
下载 **`DS-WhaleGirl-Pet-macOS-*.zip`** → 解压 → 把 **`DS 鲸鱼娘桌宠.app`** 拖进「应用程序」→ 双击。

#### 🅱 先装桌面版，再装网页版（也可以）

1. 直接下载上面那个 zip，解压、拖进「应用程序」、双击。
   → 这时窗口里会显示一张提示卡「**🐋 正在找 DSH…**」——**这是正常的**，因为插件还没装。
2. 再按 🅰 的 ①②③ 装插件并重启 DSH。
3. **她会出现，不用重启 App** —— App 每 5 秒自动重试一次，插件一就位她就自己出来了。

> ⚠️ 顺序无所谓，但**少了插件一定不行**：桌面 App 本身不带模型、不带联动
> （所以它只有 1.4 MB）。它只是一个窗口，内容全在插件里。

### Windows / Linux 用户看这里

- **桌面外壳目前只有 macOS 版**（Swift 编译出来的 `.app`），Release 里只有 Mac 附件。
- Windows / Linux **用网页版就行**，功能完全一样（联动、菜单、钱包一个不少），只是她住在浏览器标签页里。
- 跨平台外壳（Electron）在计划中；在那之前，Windows 用户可以用
  `http://127.0.0.1:3080/dsh-pet/standalone` 配 Chrome 的「创建快捷方式 → 在窗口中打开」，
  得到一个小窗效果（但**不透明、不置顶、不能点击穿透**，不是真桌宠）。

### 装完不出现 / 连不上？按顺序查这五条

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| 桌面 App 里显示「正在找 DSH…」 | 插件没装 / DSH 没跑 / 插件被停用了 | 先确认 `curl …/dsh-pet/pet.js` 是 **401**；是 404 就往下看 |
| `/dsh-pet/pet.js` 返回 **404** | 插件没被注册，或**在插件设置里被停用** | ① 看 `~/.dsh/profiles/web/package.json` 的 `dependencies` 与 `dsh.profile.bundles` 里有没有 `dsh-whale-girl-live2d`；② 看 `~/.dsh/profiles/web/cordis.patch.yml` 里**有没有 `- id: dsh-live2d-pet` + `disabled: true`**（有就删掉这两行）——**踩过一次**：插件被误停用，表现为「App 突然连不上、她也消失」 |
| 网页版刷新后什么都没有 | **宿主插件要重启 DSH 才加载** | 重启 DSH，再强刷页面（`Cmd+Shift+R` / `Ctrl+F5`） |
| 双击 App 好像没反应 | 它是**无 Dock 图标**的后台型 App，可能已经在跑了 | 看**菜单栏右上角的 🐋**；再双击一次会把窗口叫到最前面；`~/Applications/` 里只该有**一份** App |
| 更新了但没变化 | pnpm 按 lockfile 记住了旧 commit | `dsh plugin --profile web update dsh-whale-girl-live2d`；不行就 remove 再 add |

### 桌面版的技术说明（想知道细节再看）

见 [`desktop/README.md`](desktop/README.md)：本机通行证（为什么壳子能过信任栅栏）、
透明窗口的私有键、点击穿透怎么判定、怎么自己编译。

## 🚀 安装（网页版）/ Install the web version

> **先确认一件事**：你机器上已经装好 DSH（DeepSeek Harness）。终端里敲 `dsh --version` 有输出就说明没问题；
> 没装的话先装 DSH，再回来装这个桌宠。

### 方式 A：命令行装（推荐，一条命令）

```bash
dsh plugin --profile web add github:3Asterism/dsh-whale-girl-live2d-custom
```

- `--profile web` 是 DSH Web 界面的 profile 名。如果你用的是别的 profile 名，把 `web` 换成你自己的。
- 这条命令会从 GitHub 拉取插件并注册进 profile（需要能访问 GitHub）。

### 方式 B：手动下载 ZIP（不想用命令行 / 公司网络限制 git）

1. 打开仓库页面 → 绿色 **Code** 按钮 → **Download ZIP**
2. 解压到一个**你能记住的目录**，例如：
   - macOS / Linux：`~/Documents/dsh-whale-girl-live2d-main`
   - Windows：`C:\Users\你的用户名\Documents\dsh-whale-girl-live2d-main`
3. 用 **绝对路径**装（`link:` 后面必须是绝对路径；**有空格一定要加引号**）：

```bash
# macOS / Linux
dsh plugin --profile web add "link:/Users/你的用户名/Documents/dsh-whale-girl-live2d-main"
```

```powershell
# Windows（PowerShell / CMD 都可以）
dsh plugin --profile web add "link:C:\Users\你的用户名\Documents\dsh-whale-girl-live2d-main"
```

### 方式 C：从 DSH 插件市场装

等本插件被 [DSH 插件市场](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 收录后，
在界面的插件中心搜 **`鲸鱼娘`**、**`whale-girl`** 或 **`live2d`** 就能一键安装（收录进度见下方「相关链接」）。
**现在还没收录**，先走方式 A 或 B。

### 装完必须做两步（少一步都不会出现）

1. **重启 DSH**（宿主插件只在启动时加载）：把正在跑的 `dsh web` 停掉，重新起一次
2. **刷新页面**（强刷 `Cmd+Shift+R` / `Ctrl+F5`）

装成功后，界面右下角会出现鲸鱼娘。

### 一行自检

浏览器打开：**`http://127.0.0.1:3080/dsh-pet/pet.js`**

| 看到 | 意思 |
| --- | --- |
| **401** | ✅ 插件已挂载（被 DSH 的信任栅栏挡着，这是正常的） |
| **404** | ❌ 插件没被加载 —— 看下面的「排错」 |
| 满屏 JS 代码 | ✅ 也已经挂载了（你的 DSH 没开信任栅栏） |

### 更新 / 卸载

```bash
# 更新到最新版（更新完同样要重启 DSH + 刷新页面）
dsh plugin --profile web update dsh-whale-girl-live2d

# 卸载
dsh plugin --profile web remove dsh-whale-girl-live2d
```

<details>
<summary><b>🇬🇧 English — Install</b>（点开）</summary>

**Requirements**: DSH (DeepSeek Harness) already installed — `dsh --version` should print something.

**Option A — one command (recommended)**

```bash
dsh plugin --profile web add github:3Asterism/dsh-whale-girl-live2d-custom
```

`web` is the profile name used by the DSH Web UI; replace it if your profile is named differently.
This pulls the plugin from GitHub and registers it in that profile (needs GitHub access).

**Option B — download the ZIP** (no command line / git blocked): click **Code → Download ZIP**, unzip it
anywhere, then install it by **absolute path** (quote it — especially on Windows or with spaces):

```bash
dsh plugin --profile web add "link:/absolute/path/to/dsh-whale-girl-live2d-main"
```

**Option C — from the DSH plugin market**: once the plugin is listed, search for `whale-girl` or `live2d`
in the plugin center and install with one click. *It is not listed yet* — use A or B for now.

**After installing, two steps are mandatory**: ① **restart DSH** (host plugins load at startup), ② **reload
the page** (hard reload: `Cmd+Shift+R` / `Ctrl+F5`). She appears in the bottom-right corner.

**One-line check**: open `http://127.0.0.1:3080/dsh-pet/pet.js` — **401** means loaded (the trust gate is
doing its job), **404** means not loaded (see Troubleshooting).

**Update / remove**

```bash
dsh plugin --profile web update dsh-whale-girl-live2d   # then restart DSH + reload
dsh plugin --profile web remove dsh-whale-girl-live2d
```

</details>

---

## 🎮 一分钟上手 / Quick start

| 你想干嘛 | 怎么做 |
| --- | --- |
| **跟她说话 / 给 agent 发消息** | 点工具栏的 **「说话」** 打开输入框（**再点一次就关**），`Enter` 发送、`Shift+Enter` 换行；回复会逐字冒进气泡里。旁边「打断」可以中止当前这一轮 |
| **摸摸她** | 直接点她（上半身和下半身反应不一样；连着猛点会炸毛，这是设计） |
| **换表情 / 换装 / 摆场景 / 演小动作** | 点工具栏的 **`⋯`**，菜单分四页（见下方「菜单」） |
| **看余额 / 本轮花了多少** | **右键点她**，弹出钱包（再按一次右键、点 ×、点别处或按 `Esc` 都能收） |
| **挪位置** | 直接拖。松手时：靠左/右墙就吸过去，**竖直位置保持你放的高度**；离两侧都远就停在原地 |
| **藏起来** | 点工具栏的 **`–`**，右下角留个小把手，点一下就叫回来 |
| **一键重置** | 菜单 →「设置」→「一键重置所有状态」：表情、道具、场景、动作全部回到最初的「本子 + 笔 + 平常脸」 |

<details>
<summary><b>🇬🇧 English — Quick start</b></summary>

- **Talk to the agent**: click **「说话」/ Speak** in the toolbar to open the input box (click it again to
  close it). `Enter` sends, `Shift+Enter` is a newline; the reply streams into a speech bubble. The
  **「打断」/ Interrupt** button cancels the current turn.
- **Pet her**: just click her (upper and lower body react differently; clicking fast repeatedly makes her
  snap — that is intentional).
- **Expressions / dress-up / desk scenes / one-shot animations**: click **`⋯`** in the toolbar.
- **Balance & turn cost**: **right-click her** — a wallet HUD appears (right-click again, click ×, click
  elsewhere, or press `Esc` to close).
- **Move her**: drag. On release she snaps to the left/right wall if close enough; the vertical position
  stays exactly where you put her.
- **Hide**: click **`–`**; a small handle stays in the bottom-right corner to bring her back.
- **Reset everything**: menu → Settings → "Reset all state".

</details>

---

## ✨ 这是什么 / What is this

**中文**

把 Live2D 模型「鲸鱼娘」挂进 DSH 的 Web 界面。她常驻在桌面角落，**不是一张静态贴图**——
她在跟着 **agent 的真实状态**动：思考时低头、查资料时戴上眼镜掏出手机、逐字输出时嘴巴跟着动、
报错时黑一下脸、一轮收工就伸懒腰庆祝。

和「一张 PNG 加气泡文案」的挂件不同：这是活的 Live2D —— **44 个表情、8 个动作**、物理摆动、视线跟随，
而且由**真实的事件流**驱动（不是轮播动画）。所有小动作都照**模型作者自己的按键表**来
（52 条热键逐条对照，见 [`docs/作者按键表-对照.md`](docs/作者按键表-对照.md)），所以互不冲突、
不会互相覆盖、到点自己收回。

**English**

Whale Girl Live2D puts a Live2D model — the DeepSeek whale girl — inside the DSH Web UI. She lives in a
corner of the screen and is **not a static sticker**: she follows **what the agent is actually doing**,
tilting her head while thinking, putting on glasses and pulling out a phone when the agent reads or
searches, moving her mouth as text streams in, darkening her face when a tool errors, and stretching in
celebration when a turn finishes. Unlike a PNG-with-a-bubble widget this is real Live2D: **44 expressions,
8 motions**, physics, gaze tracking — driven by the **real event stream**, not an animation loop. Every
one-shot action is mapped from the **original model author's own hotkey sheet** (52 hotkeys, item by item —
see [`docs/作者按键表-对照.md`](docs/作者按键表-对照.md)), so nothing overlaps and everything expires on its own.

### 🧠 她跟 agent 的联动 / What she reacts to

| agent 在干什么 | 她的反应 |
| --- | --- |
| 主人在说话 / 正在思考 | 星星眼听着 / 低头想事，手里是本子 + 笔 |
| 调用工具 | 按工具换脸换动作：读文件 = 戴眼镜凑近看，上网 = 掏出手机，写文件 = 奋笔疾书，跑命令 = 挽袖子 |
| 逐字输出回复 | 气泡逐字冒字 + 走路般的小幅度摆动 |
| 工具报错 / 整轮失败 | 黑一下脸（很短，不砸东西）；成功收工 = 伸懒腰 + 比耶 + 用时 / 花费统计 |
| 长时间没动静 | 她自己会动：换视线、换个表情几秒、自言自语、喊饿 |

> **English**: thinking → head down with notebook and pen; tool calls → face and motion follow the tool
> (reading = glasses, web search = phone, writing = scribbling, shell = rolled-up sleeves); streaming text
> → mouth moves, bubble fills letter by letter; tool error → she darkens for a moment; turn finished →
> stretch, peace sign and a stats bubble; idle for a long time → she glances around, changes expression for
> a few seconds, mutters to herself or complains she is hungry.

---

## 🎭 菜单：表情 / 装饰 / 场景 / 动作

点 `⋯` 打开的菜单有四页，**每页守一条不同的规矩**：

| 页 | 内容 | 生命周期 |
| --- | --- | --- |
| **表情** | 按表情去重的一张脸（16 个按钮） | **临时**：点了演 3~4 秒，自己让位；平常状态永远是**平常脸**；期间她自己的表情 / agent 事件 / 你再点一个都会把它顶掉 |
| **装饰** | 眼镜、贴纸、花花、发箍、单边马尾、头顶鲸 | **常驻**：戴上就留着，再点一下摘掉（同类互斥：眼镜只戴一副、贴纸只贴一张） |
| **场景** | 深色桌布、鲸鱼放桌上、巴菲、粉 / 白魔爪、掏出手机、手机换色 | **常驻**：摆着不走，再点一下收 |
| **动作** | 猫爪摆手、喵喵手、比耶、冒爱心、心跳、MoeMoeQ~、橡皮、撤回、蛋包饭、自拍、快速自拍、喷水 | **一次性**：演一遍就消失，绝不写进常驻层 |

> **English**: four tabs with four different lifetimes — **Expressions** are temporary (3–4 s, then she
> hands her face back to the motions); **Accessories** and **Scenes** are persistent (toggle on/off, one
> per category); **Actions** are one-shot (they play once and clean themselves up). The omurice action is
> the special case: it is an expression plus the ketchup-squeezing motion, and it disappears right after
> the sauce is squeezed.

**永久移除**（代码里也拦死了 `BANNED_MOTIONS`，菜单里找不到）：吹泡泡糖、大锤砸、呆呆眼、圈圈眼。

**工作优先级高于互动**：干活时点她**不打断**——不改脸、不放动作，最多弹一下表示「知道了」。

---

## 💰 右键 = 钱包（余额 / 本轮消耗 / 峰谷计价）

| 显示 | 说明 |
| --- | --- |
| **剩余余额** | DeepSeek 官方 `user/balance` 接口。key 从 DSH 的凭据服务读（`DEEPSEEK_API_KEY`），读不到就显示「未配置」 |
| **本轮消耗** | 每轮结束**自动弹出来**：金额 + tokens（按命中 / 未命中 / 输出三个口径分别计价） |
| **今日已用** | 当天累计（按北京时间分日） |
| **峰 / 谷** | **峰 = 红，谷 = 绿**。高峰 = 北京时间周一至周五（不含法定节假日）9:00–12:00、14:00–18:00；其余（含周末、法定节假日）都是谷价 |
| **距切换** | 距离下一次峰谷切换还有多久（每秒刷新，跨过切换点自动重拉余额） |

- 计价用 Flash 价目（命中 0.02 / 未命中 1 / 输出 4 元每百万 token，高峰 = 空闲 ×2）；换 Pro 模型自动按 3 倍算。
- **不跟对话抢屏幕**：开菜单时 HUD 自动收起；鼠标停在 HUD 上时不会被自动收起；自动弹出的那次 9 秒后自己收。
- **不依赖别的插件**：余额 / 峰谷 / 记账都是这个插件宿主自己算的；两个数据源都没有时显示「读不到余额接口」，不假装有数。

> **English**: right-click her for a wallet HUD: remaining balance (DeepSeek's official `user/balance`
> endpoint, key read from DSH's credential service), this turn's cost (auto-popped when a turn ends, with
> hit / miss / output token tiers), today's total, and peak / off-peak pricing (**peak = red, off-peak =
> green**; peak hours are Mon–Fri 09:00–12:00 and 14:00–18:00 Beijing time, holidays excluded). It never
> fights the chat for screen space, and it works without any other plugin installed.

---

## 🤖 让 agent 主动指挥她 / Agent control

装好之后，agent（或者你自己）可以用命令行指挥她：

```bash
cd <你放插件的目录>/dsh-whale-girl-live2d

node tools/pet-ctl.mjs status          # 她在不在、当前会话、连接数
node tools/pet-ctl.mjs mood happy      # 换情绪
node tools/pet-ctl.mjs expr 星星眼      # 直接指定表情
node tools/pet-ctl.mjs motion selfie   # 播动作
node tools/pet-ctl.mjs say "搞定了！"   # 弹一句话
node tools/pet-ctl.mjs prop 猫猫贴纸 on # 戴道具
node tools/pet-ctl.mjs ask "要继续吗？" # 弹话 + 打开面板提醒你
```

底层就是一个本地 HTTP 接口，也可以直接打：

```bash
curl -X POST http://127.0.0.1:3080/dsh-pet/control \
  -H 'Content-Type: application/json' \
  -d '{"mood":"happy","motion":"selfie","say":"你好呀"}'
```

浏览器控制台里还有 `DSHPet` 对象可以直接玩：

```js
DSHPet.state              // 当前状态
DSHPet.setMood('angry')   // 换脸
DSHPet.playMotion('selfie')
DSHPet.setProp('glassesSun', true)
DSHPet.hitTest(x, y)      // 这个坐标算不算点在它身上
```

<details>
<summary><b>🇬🇧 English — Agent control</b></summary>

The host exposes a small local HTTP API, so an agent (or you) can drive her directly:
`GET /dsh-pet/state`, `GET /dsh-pet/events` (SSE), `POST /dsh-pet/say` `{text}`,
`POST /dsh-pet/cancel`, `POST /dsh-pet/control` `{mood, expr, motion, prop, say}`,
`GET /dsh-pet/standalone` (pet-only page). `tools/pet-ctl.mjs` is a thin CLI over the same endpoints.
A `DSHPet` object is also exposed in the browser console (see the code block above).

</details>

---

## 🩺 排错 / Troubleshooting

**先做这一步**：打开 **`http://127.0.0.1:3080/dsh-pet/diag`** —— 一条 URL 把启动过程、模型尺寸、
取景结果、可用表情 / 动作、被过滤的参数全列出来。出问题截图这一页就够定位了。

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| `dsh: command not found` | DSH 没装或没进 PATH | 先装好 DSH；临时可用 `npx @deepseek-ai/dsh plugin --profile web add ...` |
| **照着旧教程 `link:` 装，报路径不存在** | 教程里写的是**别人的**（作者的）本机路径 | `link:` 后面必须是**你自己机器上的绝对路径**，指向你解压出来的目录；路径有空格要加引号 |
| 装完刷新页面什么都没有 | **宿主插件要重启 DSH 才加载** | 重启 DSH（`dsh web` 那个进程），再刷新页面 |
| 重启后还是没有 | 启动日志里有 `dsh-whale-girl-live2d` 的报错 | 多半是 `cordis.patch.yml` 的 `name:` 与包名不一致（本仓库已一致，改过就别动） |
| 连 `/dsh-pet/pet.js` 都 404 | 插件没被注册进 profile | 检查 profile 的 `package.json`：`dependencies` 和 `dsh.profile.bundles` 里都要有 `dsh-whale-girl-live2d` |
| **更新了但版本号没变** | pnpm 按 lockfile 记住了上次解析的 commit | `dsh plugin --profile web remove dsh-whale-girl-live2d` 再 `add` 一次；或 `dsh plugin --profile web install --force` |
| 桌宠挡住按钮 / 想换个大小 | — | 拖动挪开、点 `–` 藏起来；大小和取景在菜单 →「设置」里 |
| 她一直不动 | 没有会话在干活（她本来就是「平时不动」的设计） | 打开一个对话发一句话，或者 `node tools/pet-ctl.mjs motion selfie` 试一下 |

<details>
<summary><b>🇬🇧 English — Troubleshooting</b></summary>

| Symptom | Cause | Fix |
| --- | --- | --- |
| `dsh: command not found` | DSH not installed / not on PATH | Install DSH first; or use `npx @deepseek-ai/dsh plugin --profile web add ...` |
| `link:` install fails with "path does not exist" | the path in a tutorial was **someone else's machine** | `link:` needs **your own absolute path** to the folder you unzipped; quote it if it has spaces |
| Nothing appears after install | **host plugins only load when DSH restarts** | restart DSH, then reload the page |
| Still nothing after restart | an error in the DSH startup log | usually a `name:` mismatch in `cordis.patch.yml` |
| `/dsh-pet/pet.js` returns 404 | plugin not registered in the profile | the name must appear in both `dependencies` and `dsh.profile.bundles` of the profile's `package.json` |
| Updated but the version did not change | pnpm resolved the old commit from the lockfile | remove and re-add the plugin, or run `dsh plugin --profile web install --force` |
| She never moves | no session is working (that *is* the idle design) | send a message in a chat, or try `node tools/pet-ctl.mjs motion selfie` |

Diagnostics page: `http://127.0.0.1:3080/dsh-pet/diag`.

</details>

---

## ⚙️ 配置 / Config

默认值写在 `lib/index.js` 的 `DEFAULT_CONFIG`；用户覆盖写在 **`~/.dsh/dsh-live2d-pet.json`**
（文件名沿用旧名，改它会读不到，别改）：

```json
{
  "enabled": true,
  "height": 340,
  "corner": "br",
  "lookAtCursor": true,
  "talkMouth": true,
  "sleepAfterMs": 180000,
  "showReasoning": false,
  "walletProvider": "deepseek",
  "walletCredentialKey": "",
  "walletCustom": {
    "balanceUrl": "",
    "currency": "USD",
    "totalBalancePath": "",
    "todayUsagePath": ""
  }
}
```

`enabled: false` 会连注入脚本一起去掉（改完要重启 DSH）。

### 钱包记账换厂商

右键弹出来的钱包默认读 DeepSeek 官方余额接口，不想用这个可以换：

| `walletProvider` | 凭据名（默认） | 说明 |
| --- | --- | --- |
| `"deepseek"`（默认） | `DEEPSEEK_API_KEY` | 官方 `/user/balance`，「今日已用」靠余额差分算 |
| `"openrouter"` | `OPENROUTER_API_KEY` | 官方 `/api/v1/key`，普通 API key 就能查（不用 management key），直接给「今日已用」 |
| `"custom"` | 自己填 `walletCredentialKey` | 见下 |

凭据名要跟 DSH「新增模型（自定义 API）」那个界面里填的一致（比如 OpenRouter 模板默认就是
`OPENROUTER_API_KEY`），插件会去凭据服务里用这个名字取 key，取不到再退回同名环境变量。

`walletProvider: "custom"` 时填 `walletCustom`：`balanceUrl` 是查询地址（`Authorization: Bearer <key>`
头），`totalBalancePath`/`todayUsagePath` 是从返回的 JSON 里取值的点号路径（比如响应是
`{"data":{"limit_remaining":12.3}}`，就填 `"data.limit_remaining"`）；`todayUsagePath` 留空会退回
余额差分算「今日已用」。

> **English**: defaults live in `DEFAULT_CONFIG` in `lib/index.js`; override them in
> `~/.dsh/dsh-live2d-pet.json` (the filename intentionally keeps the old name). Changing `enabled` requires
> a DSH restart. The wallet HUD can read a different provider's balance instead of DeepSeek's official
> endpoint — set `walletProvider` to `"openrouter"` (reads `/api/v1/key`, works with a regular API key) or
> `"custom"` (point `walletCustom.balanceUrl` at any JSON endpoint and give dotted paths to the fields you
> want, e.g. `"data.limit_remaining"`).

---

## 🔧 它内部是怎么动的 / How it works

模型这套资产原本是给 VTube Studio 用的：44 个「表情」其实是 44 组参数开关（全是 Add 混合），
`model3.json` 里连 `Motions` 段都没有。所以做了三件事：

1. **补 `model3.json`**：把 8 个动作按独立 group 注册进去，标准 Live2D 运行时才播得动
   （`tools/build-model.mjs` 生成，可重跑）。
2. **自己写 rig，不用框架的 expressionManager**：挂在 `InternalModel` 的 `beforeModelUpdate` 上——
   那是 `model.update()` 之前的最后一站，动作 / 眨眼 / 视线 / 物理都已经算完，我们加的参数一定生效；
   而每帧结尾 `loadParameters()` 会把参数还原，所以写入不跨帧累积。情绪（互斥）和道具（粘性）分开管；
   权重降到 0 的表达式不再写参数，把脸交还给动作，这样「伸展」「自拍」这些自带表情的一次性动作
   才不会被抹平成面瘫。
3. **命中判定用 alpha 掩码**，不是包围盒：这个模型是一整张书桌场景，包围盒里大半是空气，
   点空气要让事件穿透到下面的 DSH 界面。

事件侧：宿主监听 `ctx.on('session/event')`（轮次 / 步骤 / 工具 / 最终消息）和
`ctx.on('agent/assistant-stream')`（**真正的逐字流**），过滤出「人正在用的那个会话」后用 SSE 推给前端；
反向用官方的 `sessionController.prompt()`，跟你在界面上打字是同一条路。

> **English**: the artwork was authored for VTube Studio, so the repo adds a `model3.json` with the eight
> motions registered as proper groups, drives parameters from a hand-written rig hooked onto
> `InternalModel`'s `beforeModelUpdate` (mood = exclusive, props = sticky; expressions at weight 0 stop
> writing so one-shot motions keep their own faces), and hit-tests against an alpha mask instead of a
> bounding box so clicks on empty air fall through to the UI. The host bridges real agent events
> (`session/event`, `agent/assistant-stream`) over SSE, and sends messages back through the official
> `sessionController.prompt()`.

---

## ⚠️ 已知限制 / Known limitations

- **模型里有两处参数引用是坏的**（原作者的遗留）：`喵喵手~喵~动画` 引用了模型里不存在的
  `ParamCheek51` / `ParamCheek61`；`番茄酱` 动作引用了 `keyboard` / `xbox`。
  前端启动时会自动过滤掉并在控制台说明。
- 桌宠显示在 DSH Web 页面里；**关掉页面它就没了**。想要常驻桌面可以用
  `/dsh-pet/standalone` + `open -na "Google Chrome" --args --app=http://127.0.0.1:3080/dsh-pet/standalone`。
- 模型没有音频资源，所以 `config.sound` 目前是占位，没有实现。

---

## 📁 目录结构 / Layout

```
dsh-whale-girl-live2d/
├── package.json             DSH bundle 插件元数据（dsh.bundle.patch）
├── cordis.patch.yml         挂载声明
├── screenshots.json         插件市场详情页用的截图清单
├── lib/index.js             宿主侧：静态资源 + SSE 事件桥 + prompt 反向通道 + 自检页
├── assets/
│   ├── pet.js               前端本体：Live2D 渲染 / 情绪 rig / 状态机 / 气泡 / 输入框
│   ├── vendor/              Live2D Cubism Core · PIXI 6.5.10 · pixi-live2d-display 0.4.0
│   └── model/               模型本体 + 由 tools/build-model.mjs 生成的清单
├── tools/
│   ├── build-model.mjs      把 VTube Studio 原始素材整理成可消费的形态
│   ├── preview-server.mjs   脱离 DSH 的预览 + 假 agent 事件发生器
│   ├── pet-ctl.mjs          agent / 命令行驱动桌宠
│   ├── smoke.mjs            浏览器内功能自检
│   └── shot.mjs             CDP 截图
├── docs/                    截图、作者按键表对照、发布说明
└── skill/SKILL.md           给 agent 看的用法说明，装到 ~/.dsh/skills/ 后自动生效
```

> 开发用：`node tools/preview-server.mjs` 打开 `http://127.0.0.1:5199` 可以不启动 DSH 就预览
> （左上角三个按钮可以假装 agent 在干活）。

---

## 📜 许可与署名 / License & credits

**代码 MIT，美术素材非商业 —— 这两句都要看。**

| | 覆盖范围 | 许可 |
| --- | --- | --- |
| **代码** | `lib/`、`tools/`、`cordis.patch.yml`、`assets/pet.js` | **MIT**，Copyright © 2026 **Andersen216**（[`LICENSE`](LICENSE)） |
| **美术素材** | `assets/model/**`（moc3 / 贴图 / 表情 / 动作）、字体等 | **CC BY-NC-SA 4.0**（署名 — **非商业性使用** — 相同方式共享），版权归下面三位（[`NOTICE.md`](NOTICE.md)） |
| **运行时** | Live2D Cubism Core（Live2D Inc.）· PIXI.js（MIT）· pixi-live2d-display（MIT） | 各自的许可条款 |

模型与角色形象是**三重版权链**，都要署名（详见 [`AUTHORS.md`](AUTHORS.md)）：

| 版权所有人 | 贡献 | 主页 |
| --- | --- | --- |
| 上善无形（上善） | 鲸鱼娘角色形象原作，原创 OC「溟月」 | [B 站](https://space.bilibili.com/4456176) |
| ZipZipPipe | 加入 DeepSeek 元素的「女仆鲸鱼娘」二次设计 | [B 站](https://space.bilibili.com/4168597) |
| 氵六青 | 本仓库所用 Live2D 模型（绑定、动作、表情） | [B 站](https://space.bilibili.com/11272072) |

**本项目是非商业的**：完全免费，不收费、不带货、不接广告变现、不卖周边、不作为任何付费产品或服务的卖点。
模型作者的无偿分享与转载授权，不解除角色形象本身的 NC / SA 条件。模型包原《使用须知》原文、
逐文件来源、以及权利主张方式见 [`PROVENANCE.md`](PROVENANCE.md)。

> **English**: the **code** is MIT (© 2026 Andersen216, see [`LICENSE`](LICENSE)); the bundled **artwork is
> not** — it is used under **CC BY-NC-SA 4.0** and must be credited to **上善无形 / ZipZipPipe / 氵六青**
> (see [`NOTICE.md`](NOTICE.md) and [`AUTHORS.md`](AUTHORS.md)). This project is **free and
> non-commercial**: no fees, no ads, no merchandise, not a selling point of any paid product.
> Live2D Cubism Core belongs to Live2D Inc.; PIXI.js and pixi-live2d-display are MIT.

---

## 🔗 相关链接 / Links

- **更新日志**：[`CHANGELOG.md`](CHANGELOG.md) · [Releases](https://github.com/3Asterism/dsh-whale-girl-live2d-custom/releases)
- **原仓库**：[Andersen216/dsh-whale-girl-live2d](https://github.com/Andersen216/dsh-whale-girl-live2d) · [原仓库 Releases](https://github.com/Andersen216/dsh-whale-girl-live2d/releases)
- **按键表对照**（52 条热键逐条对照）：[`docs/作者按键表-对照.md`](docs/作者按键表-对照.md)
- **插件市场收录进度**（原仓库）：[awesome-dsh-plugin PR #5882](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5882)
- **发布 / 装机问题排查**：[`docs/发布到插件市场.md`](docs/发布到插件市场.md)

<div align="center">

**这个仓库的改动有问题，提到 [本仓库 Issues](https://github.com/3Asterism/dsh-whale-girl-live2d-custom/issues)；
模型 / 原版功能相关的问题，提到 [原仓库 Issues](https://github.com/Andersen216/dsh-whale-girl-live2d/issues)。**

*基于 [Andersen216/dsh-whale-girl-live2d](https://github.com/Andersen216/dsh-whale-girl-live2d) 二次开发 ·
非商业项目，模型素材版权归原作者所有（见上方「许可与署名」）*

</div>
