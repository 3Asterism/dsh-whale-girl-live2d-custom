# assets/app —— 鲸鱼娘前端（ES 模块）

`assets/pet.js` 只是一个加载器：`import('/dsh-pet/app/main.js')`，加载失败会把错误挂到 `window.__DSHPetError`。
真正的代码都在这个目录，宿主按 mtime 热读，改完刷新页面就生效（不用重启 DSH）。

## 分层（依赖只能从下往上，不许反向）

```
config.js  core/        配置、共享状态 R、本地存储、小工具
net/                    和宿主的 HTTP 往来（只管请求，不管演什么）
persona/                「她是谁」：台词、表情映射、装饰动作表、礼物演出、羁绊故事（纯数据，几乎无逻辑）
engine/                 Live2D 渲染与操控：rig（脸/道具三层仲裁）、动作、眨眼、视线、命中掩码、干活动画
director/               编排：perform() 优先级仲裁、持续状态 conds、一轮收工 digest
behavior/               各种「触发源 → 反应」：事件桥、手势、戳、待机、日常节律、羁绊演出、拖文件……
ui/                     气泡、面板、菜单（ui/menu/**）、钱包 HUD、布局与样式
api/debug.js            window.DSHPet 调试/测试接口（副作用导入）
main.js                 启动顺序
```

## 核心约定

- **跨模块可变状态**一律放 `core/state.js` 的 `R`（模块里导入的变量不能被别的模块赋值）。`bond`、`agent` 这类按属性改的对象可直接导出。
- **一次性反应只走 `director/perform.js` 的 `perform()`**，不要直接调 `act()` / 弹气泡。
  优先级 `AMBIENT < CUE < FINISH < ALERT < TOUCH < EXPLICIT`；同级或更高才能顶掉当前表演；低的直接丢，不排队不补播。
  话痨度分档（core / extra / chatty）、冷却、习惯化（同一互动 90 秒内：全台词 → 半概率 → 只演表情）都在里面。
  `DSHPet.director.trace()` 能看最近 50 条决策（接受 / 丢弃 / 原因），撞车问题先看这个。
- **持续状态不走 perform**，走 `director/conds.js`（`FLAG` + `syncConds()`）：状态在就在，没了自动撤，不会被一次性反应顶掉。
- **脸与道具三层仲裁**在 `engine/rig.js`：脸 `override > user > cond > base`，道具同组去重 `user > cond > base`。一层一个写者。
- **左键只有一条通道**（`behavior/gestures.js`）：按下后 位移 >6px = 拖动 / 静止 ≥400ms = 按住 / 400ms 内抬起 = 戳。摸头走悬停通道（不按键，头部区域来回划）。
- **羁绊（好感）规则在宿主**（`lib/bond`，设计见 `docs/好感系统设计.md`），前端只上报互动、演出结果、渲染「好感」页。数值冷却与每日上限都在服务端，前端连点刷不动。
- **台词要符合 `docs/人设与台词规范.md`**：全中文、称呼「主人」、自称「人家 / 本鲸」。

## 菜单（ui/menu）

`render-pane.js` 只是分发器；每页一个文件：`pane-face / pane-items（装饰+场景）/ pane-action / pane-settings / pane-wallet`，
「好感」页是一个目录 `bond/`：`card`（关系卡+状态）、`feed`（投喂+今日进度）、`story`（等级一览+故事回忆）、`switches`（互动开关）、`rules`（规则说明）、`widgets`（共用小零件）。
好感页的数值全部来自宿主快照（`bond.snap`），规则说明里的数字也读 `snap.rules`，前端不写死。

## 加东西时去哪

| 想做的事 | 改哪里 |
|---|---|
| 新增一个 DSH 会话事件的反应 | `behavior/sev.js`（规则表）+ `persona/say.js`（台词） |
| 新增 DSH 界面按钮的反应（新建会话之类） | `persona/page-actions.js`（一行正则） |
| 新增一种持续状态（戴眼镜之类） | `director/conds.js` |
| 新增关键词反应 | `persona/keywords.js` |
| 新增一件礼物 | 宿主 `lib/bond/constants.js`（GIFTS）+ `persona/gifts.js`（演出）+ `persona/lines-bond.js`（台词） |
| 新增一段羁绊故事 | `persona/stories.js` |
| 新增一条回忆 | 宿主 `lib/bond/memories.js` |
| 调羁绊数值 | 只改宿主 `lib/bond/constants.js`，好感页自动跟着变 |

## 验证

- `node tools/test-host.mjs`、`node tools/test-bond.mjs`：宿主与羁绊引擎（纯 Node，不需要浏览器）。
- `node tools/preview-server.mjs` + `CHROME_PATH=… node tools/smoke.mjs`：真实 Chrome 里的功能自检（预览服务器用真羁绊引擎，`/__bond_seed` 可造数据）。
- 跑测试前把 `DSH_HOME` 指到临时目录，别写进真实的 `~/.dsh`。
