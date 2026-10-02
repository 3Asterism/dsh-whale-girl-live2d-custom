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
唯一新增的是表情包，版权归赤风RED）。这份 README 已经精简过，详细说明都在 [`docs/`](docs/) 里；这一节说明跟原仓库比改了什么。

**跟原仓库比，这个版本多了什么：**

| 改动 | 状态 |
| --- | --- |
| 修复桌面版（Electron 官方壳）不显示鲸鱼娘的问题 | 已提交原仓库 [PR #2](https://github.com/Andersen216/dsh-whale-girl-live2d/pull/2)（等待合并） |
| 性能优化：隐藏时停渲染、减少每帧内存分配、缓存布局读取 | 已提交原仓库 [PR #3](https://github.com/Andersen216/dsh-whale-girl-live2d/pull/3)（等待合并） |
| 真正的四角贴边吸附 + 工具条自动侧移 + 面板越界兜底 | 已提交原仓库 [PR #4](https://github.com/Andersen216/dsh-whale-girl-live2d/pull/4)（等待合并） |
| 「安静模式」：气泡默认不复述对话原文、不显示流水账/token 消耗 | **只在这个仓库**，原作者不一定认可这个交互取向，没有提交上游 |
| 扩充台词池：取材中文互联网上 DeepSeek/鲸鱼娘相关的梗 | **只在这个仓库**，同上 |
| 编排内核 + 好感（羁绊）系统 + 前后端模块化（v0.6.0） | **只在这个仓库** |
| **表情包**：台词后面跟一张小 GIF（赤风RED「蓝色大肥鱼」，v0.6.7 起 157 张全部用上），按梗的真实含义用，**不拖长气泡**（v0.6.1） | **只在这个仓库**；素材版权归赤风RED |
| **好感系统打磨**：今日心愿（做到有奖励，做不到什么都不发生）、表情包图鉴（点开看梗）、11 条「共同经历」回忆、每周回顾、好感放出；好感页重新编排（v0.6.2） | **只在这个仓库** |
| **四个按钮只在「点击」时出现**（拖动、鼠标靠近都不出现）；并修复贴角时点几下按钮就叫不出来的 bug（v0.6.3） | **只在这个仓库**，通用修复，可以提给原作者 |
| **更多 DSH 时刻的反应**：深度思考 / 换模型 / 权限变化 / 她向你提问 / 连续失败 / 余额不足 / 你发呆（v0.6.1） | **只在这个仓库** |

上面三条已经提给原作者的修复，如果哪天被合并进原仓库，这边会跟着同步、不会重复维护两份。
后两条是交互风格上的个人取向调整，不一定符合原作者的设计意图，所以没有提 PR，只保留在这个仓库里。

**v0.6.1 / v0.6.2 起她多了点「灵魂」：**

- 🎭 **会玩梗**：说话时台词后面跟一张小表情包（赤风RED「蓝色大肥鱼」），按梗的**真实含义**用——
  又失败了是「坐牢」、提议被你拒了是「小丑」、余额不足是「要米」、深度思考是「正在思考」。图不会拖长气泡，绝大部分台词都有图。
- 👀 **看得见更多**：深度思考、换模型（换成别家会吃醋）、权限变化、她向你提问、连续失败、你发呆……每个时刻都有一句话或一张图。
- 🧑‍💻 **陪你干活**：她看得懂 agent 在提交、push、跑测试、装依赖，并且**真的知道成没成**（宿主从结果里抽退出码，不转命令输出）。命令中途不打扰，一轮结束时合成一个故事——红了好几次终于绿了、改→测→提交一条龙——顶替收工那句；从你的口气、重复发同一句、反复重新生成、测试连红里看出你在烦，等你不在打字时轻轻安慰一句（有「歇五分钟」），高风险的话不玩梗；对照 vibe coding 的经典流程与翻车（改一个 bug 出三个、原地打转、过早宣布完成、上下文腐烂、没有存档点、慌了就回滚、幻觉依赖、密钥进仓库……）给出对症的一句；每天第一次见面问一句要不要**抽签**，幸运图优先挑你图鉴里还没收的。所有观察者发言都过编排器的闸（不在你打字时说、不挤占戳她 / 摸头 / 关键词，有配额）。设计依据见 [`docs/陪伴设计调研.md`](docs/陪伴设计调研.md)。
- 🐋 **记得你**：好感（羁绊）系统，10 级、规则全公开、没有惩罚。每天有个**今日心愿**（做到有奖励，做不到什么都不发生），
  她用出过的每张表情包（157 张，一张不落）都收进**图鉴**，每周还会讲一次**上周回顾**。

**装哪个仓库**：只想要原版体验 → 装 [Andersen216 的原仓库](https://github.com/Andersen216/dsh-whale-girl-live2d)
（装法把下面命令里的 `3Asterism/dsh-whale-girl-live2d-custom` 换回 `Andersen216/dsh-whale-girl-live2d` 即可）；
想要上面这些改动 → 直接照本 README 下面的安装命令装，已经是这个仓库的版本。

> **English**: this repository is a customized fork of
> [Andersen216/dsh-whale-girl-live2d](https://github.com/Andersen216/dsh-whale-girl-live2d), not an
> original work. Licensing and attribution requirements are identical to the upstream repo (see
> "License & credits" below; the only addition is the sticker pack by 赤风RED). Three fixes (desktop display, performance, corner-snap docking)
> have been submitted upstream as PRs and will stop being maintained here separately once merged; two
> interaction-style customizations (a "quiet mode" that suppresses chat-echo/process chatter by default,
> and an expanded line pool drawing on Chinese-internet DeepSeek/whale-girl memes) are kept only in this
> repo since they reflect a personal taste the original author may not share. This fork also adds a bond system,
> and (v0.6.1) meme stickers next to her lines (v0.6.7: all 157 of 赤风RED's GIFs, compressed; never lengthening a bubble) plus
> reactions to deep thinking, model switches, permission changes, repeated failures, a low balance and idling.

---

## 🚀 安装

**插件只有一个**，装一次网页版、桌面版共用。先确认已装 DSH（`dsh --version` 有输出）。

```bash
# ① 装插件
dsh plugin --profile web add github:3Asterism/dsh-whale-girl-live2d-custom

# ② 重启 DSH（宿主插件只在启动时加载），再强刷页面（Cmd+Shift+R / Ctrl+F5）——右下角出现她就成功了

# ③ 自检：401 = 已挂载（被信任栅栏挡着，正常）；404 = 没加载
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/dsh-pet/pet.js
```

- 不想用命令行 / 公司网络限制 git：下载 ZIP，用 `link:` 加绝对路径装。
- **macOS 想让她住进桌面**（透明、置顶、点击穿透）：另外装一个 1.4 MB 的外壳 App，见 [Releases](https://github.com/Andersen216/dsh-whale-girl-live2d/releases/latest)。Windows / Linux 用网页版，功能一样。
- 更新：`dsh plugin --profile web update dsh-whale-girl-live2d-custom`（同样要重启 DSH）。

> 完整安装步骤、ZIP / `link:` 装法、桌面版、「装完不出现」怎么查：[`docs/安装与排错.md`](docs/安装与排错.md)

---

## 🎮 一分钟上手

| 你想干嘛 | 怎么做 |
| --- | --- |
| 跟 agent 说话 | 点工具栏的 **「说话」**，`Enter` 发送；回复逐字冒进气泡 |
| 摸摸她 | 直接点她（连着猛点会炸毛，这是设计） |
| 唤出四个按钮（说话 / 菜单 / 收起 / 打开 DSH） | **只有点她一下才出现**（拖动、鼠标靠近都不出现）；点别处、按 Esc 或几秒不用就收起 |
| 换表情 / 装饰 / 场景 / 动作 / 看好感 | 点工具栏的 **`⋯`** 打开菜单 |
| 看余额 / 本轮花了多少 | **右键**点她 |
| 挪位置 / 藏起来 | 直接拖 / 点 **`–`** |
| 不想要表情包或发呆搭话 | 菜单 →「好感」→「互动开关」 |

> 详细用法、她会在哪些时刻有反应、菜单四页、好感系统：[`docs/使用说明.md`](docs/使用说明.md)

---

## 📚 文档

| 想知道 | 看这里 |
| --- | --- |
| 怎么装、装完不出现 | [`docs/安装与排错.md`](docs/安装与排错.md) |
| 怎么用、她会在什么时候有反应 | [`docs/使用说明.md`](docs/使用说明.md) |
| 表情包怎么压的、梗是什么意思、怎么加一张 | [`docs/表情包设计.md`](docs/表情包设计.md) |
| 钱包怎么算、换记账厂商、配置文件 | [`docs/配置与钱包.md`](docs/配置与钱包.md) |
| 好感系统的全部规则 | [`docs/好感系统设计.md`](docs/好感系统设计.md) |
| 她的人设与台词规范 | [`docs/人设与台词规范.md`](docs/人设与台词规范.md) |
| 让 agent 指挥她、内部实现、目录结构、跑测试 | [`docs/开发者说明.md`](docs/开发者说明.md) |
| 模型作者的按键表对照、插件市场收录与发布 | [`docs/作者按键表-对照.md`](docs/作者按键表-对照.md) · [`docs/发布到插件市场.md`](docs/发布到插件市场.md) · [收录进度 PR #5882](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5882) |
| 更新日志 | [`CHANGELOG.md`](CHANGELOG.md) · [Releases](https://github.com/3Asterism/dsh-whale-girl-live2d-custom/releases) · [原仓库 Releases](https://github.com/Andersen216/dsh-whale-girl-live2d/releases) |

开发预览（不用启动 DSH）：`node tools/preview-server.mjs`，打开 `http://127.0.0.1:5199`。

---

## 📜 许可与署名 / License & credits

**代码 MIT，美术素材非商业 —— 这两句都要看。**

| | 覆盖范围 | 许可 |
| --- | --- | --- |
| **代码** | `lib/`、`tools/`、`cordis.patch.yml`、`assets/app/`、`assets/pet.js` | **MIT**，Copyright © 2026 **Andersen216**（[`LICENSE`](LICENSE)） |
| **模型** | `assets/model/**`（moc3 / 贴图 / 表情 / 动作） | **CC BY-NC-SA 4.0**（署名 — **非商业性使用** — 相同方式共享），版权归下面前三位（[`NOTICE.md`](NOTICE.md)） |
| **表情包** | `assets/stickers/**`（压缩后的 GIF） | 版权归 **赤风RED**，**使用条款以原作者为准**，本项目仅非商业分发；**不适用 MIT，也未套用 CC**（[`NOTICE.md`](NOTICE.md)） |
| **运行时** | Live2D Cubism Core（Live2D Inc.）· PIXI.js（MIT）· pixi-live2d-display（MIT） | 各自的许可条款 |

| 版权所有人 | 贡献 | 主页 |
| --- | --- | --- |
| 上善无形（上善） | 鲸鱼娘角色形象原作，原创 OC「溟月」 | [B 站](https://space.bilibili.com/4456176) |
| ZipZipPipe | 加入 DeepSeek 元素的「女仆鲸鱼娘」二次设计 | [B 站](https://space.bilibili.com/4168597) |
| 氵六青 | 本仓库所用 Live2D 模型（绑定、动作、表情） | [B 站](https://space.bilibili.com/11272072) |
| **赤风RED** | **「蓝色大肥鱼」表情包**（台词后面跟的 GIF；仓库里是压缩、缩小后的版本，原图不分发） | [B 站](https://space.bilibili.com/356746604) |

**本项目是非商业的**：完全免费，不收费、不带货、不接广告变现、不卖周边、不作为任何付费产品或服务的卖点。
前三位模型作者的无偿分享与转载授权，不解除角色形象本身的 NC / SA 条件。完整署名见 [`AUTHORS.md`](AUTHORS.md)，
逐文件来源、模型包原《使用须知》与权利主张方式见 [`PROVENANCE.md`](PROVENANCE.md)。

> **English**: the **code** is MIT (© 2026 Andersen216). The **model** is used under **CC BY-NC-SA 4.0** and must be
> credited to 上善无形 / ZipZipPipe / 氵六青. The **sticker pack** (compressed GIFs in `assets/stickers`) is by
> **赤风RED** ([Bilibili](https://space.bilibili.com/356746604)) — copyright is hers, her terms apply, distributed here
> non-commercially only; it is neither MIT nor relicensed under CC. The project is **free and non-commercial**.
> See [`NOTICE.md`](NOTICE.md) and [`AUTHORS.md`](AUTHORS.md).

> 本仓库是 [Andersen216/dsh-whale-girl-live2d](https://github.com/Andersen216/dsh-whale-girl-live2d) 的二次开发版，许可与署名要求跟原仓库完全一样。

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
非商业项目，模型与表情包版权归原作者所有（见上方「许可与署名」）*

</div>
