---
name: dsh-whale-girl-live2d
description: Driving guide for the dsh-whale-girl-live2d desktop pet (DS 鲸鱼娘) — the Live2D mascot living in the DSH Web UI. Use when the user mentions 桌宠 / 鲸鱼娘 / 小鲸鱼 / 桌面的模型 / desktop pet / mascot, asks to make it react, asks why it is not moving or not showing, wants its expressions, props, motions, framing or position changed, or wants it to say something. Tells the agent WHICH control endpoint or CLI command to use, what the valid expression / prop / motion names are, and what the pet already reacts to on its own so it is NOT double-driven.
---

# dsh-whale-girl-live2d 桌宠驱动指南

桌宠是 DSH Web 界面右下角那个 Live2D「DS 鲸鱼娘」。它**已经自动跟着 agent 的活动演**，
这个 skill 讲的是：哪些不用你管、哪些可以主动拨、坏了怎么查。

## 一、先搞清楚：大部分反应是自动的，别重复驱动

**人设**：称呼「主人」，自称「人家」/「本鲸」，傲娇嘴甜、聪明但懒、贪吃白米、不能被叫胖。

### 常态是「左手笔、右手本子、平常脸、没有动作」

**待机不放动作**（模型自带的 `motions/idle` 其实是猫爪+爱心循环动画，已停用；
`aidale`/`selfie` 内部驱动十几个表情参数，也一律不自动播）。

### 表演调度器

所有一次性反应都走 `perform()`（带优先级 / 冷却 / 习惯化，再落到 `act()`），持续状态走 conds，保证：**先归零再开始、一个表情 + 至多一个动作 + 至多一个粒子特效、
同一参数只有一个写入者**。所以不会出现「两个表情叠在一起」或「动作卡住」。

| 触发 | 桌宠自动反应 | 时长 |
|---|---|---|
| 用户发消息 | 星星眼 + 气泡显示原话 | ~2.6 秒 |
| 开始干活 | 底层状态 → 工作态（本子+笔） | — |
| 干活中 | 认真看资料 / 思考 之间慢切换（9–14 秒），不卖萌 | — |
| 读文件/查文献 | 随机戴圆眼镜 / 半框方眼镜 / 不戴 + 低头看本子 | — |
| 搜索/查资料 | 手里的**笔换成小设备**（模型自带开盖动作），看完换回 | — |
| 逐字输出 | 气泡逐字增长 + 说话口型 | — |
| 完成 | 开心脸 + **一个装饰**（猫耳/兔耳/花花/心跳随机）+ 蹦一下 + 统计气泡 | ~3 秒 |
| 工具报错 | 只是黑一下脸 | ~1.6 秒 |
| 整轮结束 | **底层状态强制复位成平常**（这条是硬要求，有兜底看门狗） | — |
| 闲置 | 看别处、换个**不改变眼型**的表情、自言自语 | — |

**永久移除**：吹泡泡糖、大锤砸、呆呆眼、圈圈眼（`BANNED_MOTIONS` + 播放入口双拦，菜单里也没有）。

**工作优先级高于互动**：干活时点她不打断。

### 好感（羁绊）系统：别替她加分

她有一套羁绊系统（10 级、羁绊故事、用 token 投喂），**规则与数值全在宿主**，冷却和每日上限也在宿主判，
所以**不要用脚本去刷互动**（刷不动，也没意义）。用户想看数值、规则、开关，让他点菜单的「**好感**」页——那里什么都摊开了。
调试可用 `DSHPet.bond.snap()`（完整快照）、`DSHPet.bond.state()`（前端镜像）。

## 二、可用的驱动入口

### 命令行（首选，最省事）

```bash
# 插件在哪儿都能这样定位：不管是从 GitHub / npm 装的，还是本地 link 装的，
# profile 的 node_modules 下都会有这个包名对应的目录
PET_DIR="$HOME/.dsh/profiles/web/node_modules/dsh-whale-girl-live2d-custom"
PET="node \"$PET_DIR/tools/pet-ctl.mjs\""

$PET status                     # 先确认在线
$PET mood happy                 # 换情绪
$PET expr 星星眼                 # 直接指定表情
$PET motion selfie              # 播动作
$PET say "搞定了！"              # 只弹气泡（不会发给模型）
$PET ask "要继续吗？"            # 弹气泡 + 打开桌宠面板提醒用户
$PET prop 猫猫贴纸 on            # 戴道具（on/off）
$PET clear                      # 摘掉全部道具
```

中文别名可以直接用（`mood 生气`、`prop 墨镜 on` 都行）。
端口不是 3080 时加 `--url http://127.0.0.1:<port>`。

### HTTP（脚本里用）

```bash
curl -X POST http://127.0.0.1:3080/dsh-pet/control \
  -H 'Content-Type: application/json' \
  -d '{"mood":"happy","motion":"selfie","say":"你好呀","bubbleMs":6000}'
```

`/dsh-pet/control` 接受的字段（都可选，可组合）：

| 字段 | 值 | 说明 |
|---|---|---|
| `mood` | 见下表 | 换情绪（互斥的脸） |
| `expression` | 表情名，或 `null` | 直接指定表情，绕过 mood 映射 |
| `motion` | 见下表 | 播一次性动作 |
| `say` / `bubble` | 字符串 | 弹气泡（不发给模型） |
| `bubbleMs` | 毫秒 | 气泡停留时间 |
| `props` | `{"猫猫贴纸": true}` | 戴/摘道具（键用英文 key 或中文都行） |
| `clearProps` | `true` | 摘掉全部道具 |
| `attention` | `true` | 打开桌宠面板 3 秒（引人注意） |

## 三、合法取值

**情绪 mood**：`neutral`（平常）`listening` `thinking` `happy` `excited` `love` `shy` `sad`
`cry` `angry` `playful` `dizzy` `gloomy` `sweat` `confused` `alert` `sleepy` `tongue` `dead`

**动作 motion**：`idle`（待机循环，别手动播）`aidale`（伸展）`selfie`（自拍）`selfieQuick`（快速自拍）
`ketchup`（挤番茄酱）`openLid`（开盖）`bubble`（吹泡泡糖）`splash`（鲸鱼喷水）

**表情 expression**（44 个里常用的）：`星星眼` `爱心眼` `脸红` `开心兴奋` `悲伤` `哭` `生气`
`调皮` `呆呆眼` `闭眼口水` `晕晕` `阴暗` `吐舌` `吐魂` `流汗` `问号` `感叹号` `喵喵手~喵~动画`
`圆眼镜` `方眼镜` `椭圆眼镜` `墨镜` `猫猫贴纸` `兔兔贴纸` `蝴蝶结贴纸` `情绪花花` `心跳`
`单边马尾` `头箍` `鲸鱼` `鲸鱼放桌上` `巴菲` `魔爪` `魔爪换色` `深色桌布` `蛋包饭` `手机换色` `点菜按下`

**道具 prop key**（这些都是**常驻开关**，开了就一直在，直到再点一下）：

- 装饰（`PROPS`）：`glassesRound` `glassesSquare` `glassesOval` `glassesSun` `stickerCat`
  `stickerRabbit` `stickerBow` `flower` `ponytail` `headband` `whaleHat`
- 场景（`SCENES`）：`darkCloth` `whaleOnDesk` `parfait` `claws` `clawsWhite` `phone` `phoneSkin`

同组互斥：四副眼镜只戴一副（`glasses`）、三张贴纸只贴一张（`sticker`）、
发箍与花花同属头部（`headwear`）、两种魔爪（`claw` + `clawColor`，且白魔爪的前置是粉魔爪）、
桌布（`cloth`）、设备（`device`）。
`phoneSkin` / 自拍类动作的前置都是 `phone`（掏出手机），点的时候会自动补。

**一次性动作 action key**（演一遍就消失，绝不常驻）：
`paw`（猫爪摆手）`catPaw`（喵喵手）`doubleV`（双手比耶）`love`（冒爱心）`heartbeat`（心跳）
`squeeze`（MoeMoeQ~）`eraser`（橡皮擦）`undo`（撤回）`omurice`（蛋包饭：挤完酱就消失）
`selfie`（自拍，前置 `phone`）`selfieQuick`（快速自拍，前置 `phone`）`splash`（鲸鱼喷水）

这些动作全部来自**原作者自己的按键表**（`DS鲸鱼娘/按键表.txt` 与模型里的
`c_0120.vtube.json`，52 条热键）。逐条对照见 `docs/作者按键表-对照.md`——
要给桌宠加/改动作时先看那张表，别自己编组合。

**菜单表情是临时的**：点一下只演 3~4 秒（`act` 的 override 层），
到点自己让位，平常状态永远是「平常脸」；期间任何新表情（她自己挑的、
agent 事件、或者用户再点一个）都会把它顶掉。**不要**用 `setUserFace`
把表情长期按住——那是给外部控制留的手动档，菜单不用它。

## 四、用户让你「修桌宠」时怎么下手

1. **先问/先看它到底怎么了。** 打开 `http://127.0.0.1:3080/dsh-pet/diag`，
   那一页会列出：运行时是否加载、模型原始尺寸、取景结果、可用表情/动作、被过滤的参数。
   让用户截图这一页，比猜快得多。
2. **完全没出现** → 插件没被加载。检查三件事：
   - `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 里有 `dsh-whale-girl-live2d-custom`
   - `~/.dsh/profiles/web/node_modules/dsh-whale-girl-live2d-custom` 存在（本地开发装法是软链到 clone 的目录）
   - **DSH Web 重启过**（新增 bundle 必须重启才加载）
3. **出现了但不动** → 打开 `/dsh-pet/state` 看 `clients` 是不是 0（SSE 没连上），
   以及 `sessionId` 是不是空（还没在这个会话里说过话——桌宠只跟「人正在用的会话」联动）。
4. **位置/大小/构图不对** → 点工具栏 `⋯` → 设置（大小滑块、视线灵敏度）。
   摆放规则：**只吸左右墙，竖直位置由用户自由放，不吸底部**；
   存档是 `{edge:'left'|'right', edgeY}` 或 `{x,y}`，老存档里的 `corner` 会自动迁移。
   注意：桌宠蹲在右下角时，面板会被自动夹回视口内，别改成固定居中。
   这个模型是整张书桌场景，默认「整张桌子」可能偏小。
5. **卡住 / 回不去 / 点了一直挂着** → 先看设置页的「一键重置所有状态」是否真的清干净
   （它现在会**连干活轮播一起停掉**、清空所有道具层、把脸交还成平常）。
   还卡的话用 `/dsh-pet/state` 看 `base` / `userProps` / `overrideProps` / `work.active`
   这四个字段，卡在哪一层一眼就能看出来。
6. **改代码** → `assets/pet.js`（前端）是**按 mtime 热读取**的，改完刷新页面就生效，不用重启。
   `lib/index.js`（宿主）改动需要重启。

## 五、改性格

`assets/pet.js` 顶部第一段「性格表」就是全部可调项，改这一段不用懂 Live2D：

- `MOOD_FACE` —— 情绪名 → 表情文件名的映射
- `PROPS`（装饰，常驻）/ `SCENES`（场景，常驻）/ `ACTIONS`（动作，一次性）
  —— `group` 相同即互斥，`needs` 是前置（会自动补），`key` 是原作者的热键标注
- `FACE_ACT` / `PROP_ACT` / `SCENE_ACT` —— 每一项「点了她会说什么 + 什么表情」
- `TOOL_FACE` —— **工具 → 表情**，这是「像个真助手」的关键，加新工具就往这里加一行
- `TOOL_PROP` —— 工具期间顺手戴上的道具
- `THINK_LINES` / `IDLE_LINES` / `DONE_LINES` —— 各阶段的台词

## 五点五、改动画/参数时必看：框架的参数快照

pixi-live2d-display 每帧的顺序是：

```
动作写入 → coreModel.saveParameters()（存快照）→ 眨眼/视线/呼吸/物理
        → beforeModelUpdate（我们的 applyRig 在这里做加法）
        → coreModel.update() → coreModel.loadParameters()（把快照装回来）
```

**快照是在动作写入之后存的**。所以动作一停，快照里留的就是它最后一帧的姿势，
而且每帧都会被装回来 —— 症状是「蛋包饭永远挂在桌上、手机收不回、表情回不去，
连一键重置都没用」。停动作时必须一起做：

```js
stopAllMotions()
clearMotionPose()   // 把动作写过的参数设回 getParameterDefaultValue()，再 saveParameters() 一次
```

`stopMotion()` 已经内置了这件事。**新增任何「临时改参数」的功能时，都要走它。**

## 六、不要做的事

- **输入框只从工具栏「说话」按钮开**（再点一次关）：双击模型不再弹输入框（主人明确要求）。
- **弹窗锚在头顶**（`headScreenX()` + `placePanel()`）：用 `contentBox.bands.head.center`
  换算成屏幕坐标当锚点，靠墙时再往屏内让。**不要**改回「以根节点中心居中」——
  根节点包含整张书桌，中心 ≠ 脑袋中心，框会明显偏。
- **眨眼是我们自己控制的**（`blinkTick`）：`internalModel.eyeBlink` 已禁用。
  判断「动作在播」**必须用 `motionActive()`**（我们自己按清单时长记账）——
  框架的 `motionManager.isFinished()` 空闲时也返回「没结束」，用它会让眨眼永远不触发。
- **弹窗定位是纯计算的**（`placePanel`）：锚点 + 靠墙让位 + 夹进视口。
  **不要**改回「先量位置再设位移」的写法 —— 位移带过渡动画，量到中间态就会一次左一次右。
- **右键不是设置**：右键弹出的是「钱包 HUD」（余额 / 本轮消耗 / 峰谷计价 / 距切换倒计时），
  **再按一次右键收起**，也可以点 HUD 右上角的 ×：
  设置菜单在工具栏的 `⋯` 里。HUD 的数据接口是 `GET /dsh-pet/hud`
  （自带余额+峰谷+记账；装了 dsh-whale-widget 时会优先用它的账本）。每轮结束宿主会推一条
  `hud-turn` 事件，前端据此自动弹出「本轮消耗」。
- **不要**为了「让它动」而每轮调 `/dsh-pet/control`——自动联动已经覆盖了常规情况。
- **不要**在桌宠气泡里塞长文（气泡最长显示 4000 字、可视高度 150px）。
  长内容留给正常回复，桌宠只做提示。
- **不要**用 `say` 代替真正的回复——`say` 只弹气泡，不进会话、不影响对话内容，
  用户看不到它出现在聊天记录里。
