/** ui/styles.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

// ——————————————————————————————————————————————————————————————
// 二、样式
// ——————————————————————————————————————————————————————————————
//
// 注意：这里刻意**不叫 `CSS`** —— 浏览器里 `window.CSS` 是 CSSOM 命名空间，
// 一旦这个名字没被正确声明，`s.textContent = CSS` 不会报错，只会把样式表内容
// 写成 "[object CSS]"（12 个字符），整个界面静默失去定位与外观。踩过一次。

const PET_CSS = `
.dshp-root{position:fixed;z-index:2147483000;pointer-events:none;
  --dshp-s:1;
  /* 面板单独一套缩放：气泡和工具栏可以跟着模型缩得很小，但菜单里有滑块、
     有按钮，缩成指甲盖大小就没法用了。所以面板的缩放被夹在 0.85~1.15。 */
  --dshp-ps:1;
  /* 工具栏（底下三个按钮）比模型再小一号，主人说原来那三框太大 */
  --dshp-ds:0.86;
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
  --dshp-fg:#132043;--dshp-bg:rgba(246,249,255,.96);--dshp-line:rgba(30,60,130,.14);
  /* 鲸鱼蓝（和官网、App 图标同一套色）；只改颜色，别的一律不动 */
  --dshp-accent:#3b62f6;--dshp-radius:14px;transition:opacity .25s ease}
.dshp-root.dshp-hidden{opacity:0;pointer-events:none!important}
/* 恢复用的把手挂在 body 上、不在 .dshp-root 里，所以这里必须是 body 级类：
   用后代选择器会永远匹配不到，隐藏之后就再也找不回来了。 */
body.dshp-pet-hidden .dshp-tab{display:flex}
.dshp-tab:hover{transform:translateY(-1px)}
@media (prefers-color-scheme:dark){.dshp-root{--dshp-fg:#eaf0ff;--dshp-bg:rgba(18,26,48,.95);--dshp-line:rgba(140,175,255,.20);--dshp-accent:#7b9bff}}
.dshp-stage{position:absolute;left:0;bottom:0;pointer-events:none;
  filter:drop-shadow(0 10px 20px rgba(0,0,0,.24))}
.dshp-stage canvas{display:block;pointer-events:none}
.dshp-bubble{position:absolute;left:50%;bottom:100%;
  transform:translate(calc(-50% + var(--dshp-shift,0px)),calc(6px + var(--dshp-shift-y,0px))) scale(.96);
  margin-bottom:calc(10px * var(--dshp-s));min-width:calc(110px * var(--dshp-s));
  max-width:min(calc(300px * var(--dshp-s)),70vw);pointer-events:auto;
  background:var(--dshp-bg);color:var(--dshp-fg);border:1px solid var(--dshp-line);
  border-radius:calc(var(--dshp-radius) * var(--dshp-s));
  padding:calc(9px * var(--dshp-s)) calc(12px * var(--dshp-s)) calc(8px * var(--dshp-s));
  box-shadow:0 8px 28px rgba(10,14,30,.18);backdrop-filter:blur(14px) saturate(1.3);
  font-size:calc(12.5px * var(--dshp-s));line-height:1.55;opacity:0;visibility:hidden;
  transition:opacity .18s ease,transform .18s ease;overflow-wrap:anywhere;word-break:break-word}
.dshp-bubble.dshp-on{opacity:1;visibility:visible;
  transform:translate(calc(-50% + var(--dshp-shift,0px)),var(--dshp-shift-y,0px)) scale(1)}
.dshp-bubble:after{content:"";position:absolute;left:50%;bottom:-6px;margin-left:-6px;
  width:12px;height:12px;background:var(--dshp-bg);border-right:1px solid var(--dshp-line);
  border-bottom:1px solid var(--dshp-line);transform:rotate(45deg);border-radius:0 0 3px 0}
/* 翻到下面：贴顶角落时头顶没地方放气泡，整个翻到脚下去，别硬挤出屏幕。
   见 placePanel() 里的翻转判断；尖角跟着一起翻，还是指向她。 */
.dshp-bubble.dshp-flip{bottom:auto;top:100%;margin-bottom:0;margin-top:calc(10px * var(--dshp-s));
  transform:translate(calc(-50% + var(--dshp-shift,0px)),calc(-6px + var(--dshp-shift-y,0px))) scale(.96)}
.dshp-bubble.dshp-flip.dshp-on{transform:translate(calc(-50% + var(--dshp-shift,0px)),var(--dshp-shift-y,0px)) scale(1)}
.dshp-bubble.dshp-flip:after{bottom:auto;top:-6px;border-right:none;border-bottom:none;
  border-left:1px solid var(--dshp-line);border-top:1px solid var(--dshp-line);border-radius:3px 0 0 0}
.dshp-head{display:flex;align-items:center;gap:calc(6px * var(--dshp-s));
  margin-bottom:calc(3px * var(--dshp-s));
  font-size:calc(10.5px * var(--dshp-s));letter-spacing:.04em;color:var(--dshp-accent);font-weight:600}
.dshp-dot{width:calc(6px * var(--dshp-s));height:calc(6px * var(--dshp-s));
  border-radius:50%;background:var(--dshp-accent);flex:none}
.dshp-dot.dshp-pulse{animation:dshp-pulse 1.1s ease-in-out infinite}
@keyframes dshp-pulse{0%,100%{opacity:.35;transform:scale(.8)}50%{opacity:1;transform:scale(1.25)}}
.dshp-msg{display:flex;align-items:center;gap:calc(8px * var(--dshp-s))}
.dshp-msg .dshp-body{flex:1 1 auto;min-width:0}
.dshp-body{max-height:150px;overflow:auto;white-space:pre-wrap}
/* 表情包（赤风RED《蓝色大肥鱼》，已压成 96×96）：显示 44px ≈ 字号 3.5 倍，跟在台词后面；
   不拦鼠标，不挡下面的页面。到点没播完就跟着气泡淡出（见 bubble.js：气泡停留时间永远由台词决定）。 */
.dshp-sticker{flex:none;display:block;width:max(28px,calc(44px * var(--dshp-s)));height:max(28px,calc(44px * var(--dshp-s)));
  object-fit:contain;pointer-events:none;user-select:none;-webkit-user-drag:none;transition:opacity .3s ease}
/* 气泡是 left:50% 的绝对定位，可容纳宽度只剩根节点的一半，文字会被挤成窄列（工具栏也踩过同一个坑）。
   带图时用 max-content 撑开，上限仍是 max-width。 */
.dshp-bubble.dshp-has-sticker{width:max-content}
.dshp-sticker.dshp-opaque{border-radius:calc(8px * var(--dshp-s))}
.dshp-sticker.dshp-out{opacity:0}
/* 只有一张图的小气泡：藏掉名字 / 文字 / 脚注，图放大一点（没有文字陪衬，要看得清脸） */
.dshp-bubble.dshp-solo{min-width:0;padding:calc(6px * var(--dshp-s))}
.dshp-solo .dshp-head,.dshp-solo .dshp-body,.dshp-solo .dshp-foot{display:none}
.dshp-solo .dshp-msg{gap:0}
.dshp-solo .dshp-sticker{width:max(36px,calc(56px * var(--dshp-s)));height:max(36px,calc(56px * var(--dshp-s)))}
@media (prefers-reduced-motion:reduce){.dshp-sticker{display:none}}
.dshp-body::-webkit-scrollbar{width:5px}
.dshp-body::-webkit-scrollbar-thumb{background:var(--dshp-line);border-radius:3px}
.dshp-foot{margin-top:calc(4px * var(--dshp-s));font-size:calc(10px * var(--dshp-s));opacity:.55;min-height:0}
.dshp-ask{display:flex;gap:calc(6px * var(--dshp-s));margin-top:calc(8px * var(--dshp-s))}
.dshp-ask button{flex:1;cursor:pointer;border:1px solid rgba(59,98,246,.45);background:rgba(59,98,246,.1);color:inherit;
  border-radius:999px;padding:calc(3px * var(--dshp-s)) calc(10px * var(--dshp-s));font-size:calc(12px * var(--dshp-s));font-family:inherit}
.dshp-ask button:hover{background:rgba(59,98,246,.22)}
/* 工具栏：主人抱怨底下那三个框「太大、不太适配」。
   真正的病根是 left:50% —— 绝对定位元素的可容纳宽度只剩下父容器的一半，
   三个按钮被挤成 104px，文字折行后每个都变成又窄又高的方块。
   width:max-content 让它超出那半幅也能保持居中，按钮就恢复成正常的一行小按钮。 */
.dshp-dock{position:absolute;left:50%;transform:translateX(-50%);
  bottom:calc(-40px * var(--dshp-ds));display:none;gap:calc(7px * var(--dshp-ds));
  width:max-content;white-space:nowrap;pointer-events:auto}
/* 只有「点她一下」（.dshp-dock-on，见 behavior/gestures.js）或面板开着时才出现；平时 display:none——
   不占位、不接事件，桌面壳也不会把那一块当成她的面板（以前是 opacity:0 隐形地挂着，鼠标一靠近就冒出来）。 */
.dshp-root.dshp-dock-on .dshp-dock,.dshp-root.dshp-open .dshp-dock{display:flex;animation:dshp-dock-in .18s ease}
@keyframes dshp-dock-in{from{opacity:0}to{opacity:1}}
/* 贴进真正的角落时，正下方没有余量留给工具条了（不然角落就白贴了），
   所以挪到侧边，竖排、贴着她身子。哪一侧空出来给按钮，看贴的是哪个角：
   贴左边的角（没有左边空间）就把按钮甩到右边，贴右边的角反过来。
   竖直方向**不**用「以整个包围盒居中」——包围盒比看得见的她大一圈，
   居中会让工具条的中心比她实际的中心更靠上，贴顶角落时很容易被顶到
   窗口标题栏那条线以上去。改成贴对应的那条边（跟角落同侧）：贴顶的角
   工具条也贴顶，贴底的角工具条也贴底，跟着她一起「贴死」，不会比她更冒。 */
.dshp-root[data-corner] .dshp-dock{left:auto;right:auto;
  flex-direction:column;width:auto;white-space:normal;transform:none}
.dshp-root[data-corner="tl"] .dshp-dock,.dshp-root[data-corner="tr"] .dshp-dock{
  top:calc(10px * var(--dshp-ds));bottom:auto}
.dshp-root[data-corner="bl"] .dshp-dock,.dshp-root[data-corner="br"] .dshp-dock{
  bottom:calc(10px * var(--dshp-ds));top:auto}
.dshp-root[data-corner="tl"] .dshp-dock,.dshp-root[data-corner="bl"] .dshp-dock{
  left:calc(100% + 6px * var(--dshp-ds))}
.dshp-root[data-corner="tr"] .dshp-dock,.dshp-root[data-corner="br"] .dshp-dock{
  right:calc(100% + 6px * var(--dshp-ds))}
.dshp-btn{border:1px solid var(--dshp-line);background:var(--dshp-bg);color:var(--dshp-fg);
  border-radius:calc(11px * var(--dshp-ds));flex:0 0 auto;white-space:nowrap;
  padding:calc(5px * var(--dshp-ds)) calc(11px * var(--dshp-ds));
  font-size:calc(13px * var(--dshp-ds));cursor:pointer;line-height:1.5;
  display:inline-flex;align-items:center;justify-content:center;gap:calc(5px * var(--dshp-ds));
  box-shadow:0 3px 10px rgba(10,14,30,.14);transition:transform .12s ease}
/* 纯符号按钮（打开 DSH / 收起 / 菜单）：正方形一点，只放一个图标 */
.dshp-btn.dshp-icon{padding:calc(6px * var(--dshp-ds)) calc(8px * var(--dshp-ds));
  font-size:calc(15px * var(--dshp-ds));line-height:1.2}
/* 工具栏图标：Lucide（ISC 协议，https://lucide.dev）的线性图标，内联 SVG，
   别再用 emoji / 纯字符拼的「图标」——不同字体、系统下粗细和对齐都不一致，
   看着比较糙。stroke 用 currentColor，跟着按钮文字颜色走，深浅色模式不用另配。 */
.dshp-icon-svg{display:inline-flex;flex:none;line-height:0}
.dshp-icon-svg svg{width:calc(14px * var(--dshp-ds));height:calc(14px * var(--dshp-ds));display:block}
.dshp-btn.dshp-icon .dshp-icon-svg svg{width:calc(16px * var(--dshp-ds));height:calc(16px * var(--dshp-ds))}
/* 大小加减键 */
.dshp-btn.dshp-step{min-width:calc(30px * var(--dshp-ds));text-align:center;
  font-size:calc(17px * var(--dshp-ds));font-weight:600;line-height:1.1}
.dshp-btn:hover{transform:translateY(-1px)}
.dshp-btn:active{transform:translateY(0) scale(.96)}
.dshp-btn:disabled{opacity:.5;cursor:default}
.dshp-btn.dshp-primary{background:var(--dshp-accent);color:#fff;border-color:transparent}
.dshp-close{position:absolute;top:5px;right:6px;width:22px;height:22px;line-height:1;
  border:none;border-radius:7px;background:transparent;color:inherit;opacity:.5;
  font-size:15px;cursor:pointer;padding:0}
.dshp-close:hover{opacity:1;background:rgba(124,92,255,.14)}
.dshp-panel{position:absolute;bottom:calc(100% + 10px * var(--dshp-ps));left:50%;
  transform:translateX(calc(-50% + var(--dshp-shift,0px))) translateY(calc(4px + var(--dshp-shift-y,0px)));
  width:min(calc(320px * var(--dshp-ps)),86vw);pointer-events:auto;
  background:var(--dshp-bg);color:var(--dshp-fg);
  border:1px solid var(--dshp-line);border-radius:calc(var(--dshp-radius) * var(--dshp-ps));
  padding:calc(10px * var(--dshp-ps));
  box-shadow:0 14px 40px rgba(10,14,30,.26);backdrop-filter:blur(16px) saturate(1.3);
  opacity:0;visibility:hidden;transition:opacity .16s ease,transform .16s ease;
  font-size:calc(12px * var(--dshp-ps))}
/* 面板在缩放被冻结时不能再跟着动，否则拖「大小」滑块的时候轨道会从鼠标底下跑掉 */
.dshp-root.dshp-sizing .dshp-panel{transition:opacity .16s ease}
.dshp-panel.dshp-on{opacity:1;visibility:visible;
  transform:translateX(calc(-50% + var(--dshp-shift,0px))) translateY(var(--dshp-shift-y,0px))}
/* 翻到下面：跟气泡同一个道理，贴顶角落时头顶没地方展开设置面板 */
.dshp-panel.dshp-flip{bottom:auto;top:calc(100% + 10px * var(--dshp-ps));
  transform:translateX(calc(-50% + var(--dshp-shift,0px))) translateY(calc(-4px + var(--dshp-shift-y,0px)))}
.dshp-panel.dshp-flip.dshp-on{transform:translateX(calc(-50% + var(--dshp-shift,0px))) translateY(var(--dshp-shift-y,0px))}
.dshp-panel textarea,.dshp-field input[type=text],.dshp-field select{width:100%;box-sizing:border-box;
  font:inherit;color:inherit;background:transparent;border:1px solid var(--dshp-line);
  border-radius:calc(9px * var(--dshp-ps));
  padding:calc(7px * var(--dshp-ps)) calc(9px * var(--dshp-ps));outline:none}
.dshp-panel textarea{resize:none;height:calc(64px * var(--dshp-ps))}
.dshp-panel textarea:focus,.dshp-field input[type=text]:focus,.dshp-field select:focus{border-color:var(--dshp-accent)}
/* select 关着的时候吃得到上面那条规则（透明背景透出面板自己的深色底），
   但下拉展开的选项列表是浏览器原生渲染的一层，大多数引擎不认
   background:transparent，默认给的是不透明白底——这时候 color:inherit
   带过去的还是给深色底配的浅色字，白底浅字基本看不清。选项这里直接给
   一套固定的、肯定读得出来的配色，不跟着深浅色主题变量走。 */
.dshp-field select option{color:#132043;background:#fff}
/* 标签 + 输入框竖排：面板就 ~270-320px 宽，标签和输入框并排会挤，
   竖排在小尺寸下也不会截断，宽度富余的时候看着也不空。 */
.dshp-field{display:block;margin-top:calc(8px * var(--dshp-ps))}
.dshp-field-label{display:block;font-size:calc(11px * var(--dshp-ps));opacity:.65;
  margin-bottom:calc(3px * var(--dshp-ps))}
.dshp-row{display:flex;gap:6px;align-items:center;margin-top:7px;flex-wrap:wrap}
.dshp-grow{flex:1}
/* 6 个标签页在最窄的面板宽度下可能放不下一整行，允许换到第二行，
   总比横向溢出被截断好 */
.dshp-tabs{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:7px;border-bottom:1px solid var(--dshp-line);padding-bottom:6px}
.dshp-tab-btn{border:none;background:transparent;color:inherit;opacity:.6;font:inherit;font-size:11.5px;
  padding:3px 9px;border-radius:7px;cursor:pointer}
.dshp-tab-btn.dshp-active{opacity:1;background:rgba(124,92,255,.14);color:var(--dshp-accent);font-weight:600}
.dshp-grid{display:flex;flex-wrap:wrap;gap:5px;max-height:210px;overflow:auto;overscroll-behavior:contain}
/* 面板本身不限高，内容一多（比如「自定义 API」那一长串字段）会把整个面板
   撑到屏幕外去。panes 这层限一下高度，超出的部分自己滚，不连累面板整体。 */
.dshp-panes{max-height:calc(360px * var(--dshp-ps));overflow-y:auto;overscroll-behavior:contain}
.dshp-chip{border:1px solid var(--dshp-line);background:transparent;color:inherit;font:inherit;
  font-size:calc(11.5px * var(--dshp-ps));border-radius:calc(8px * var(--dshp-ps));
  padding:calc(3px * var(--dshp-ps)) calc(9px * var(--dshp-ps));cursor:pointer;transition:background .12s}
.dshp-chip:hover{background:rgba(124,92,255,.12)}
.dshp-chip.dshp-on{background:var(--dshp-accent);color:#fff;border-color:transparent}
.dshp-chip.dshp-dead{opacity:.38;cursor:not-allowed}
.dshp-now{opacity:.75;margin:0 0 8px;padding:5px 8px;border-radius:8px;
  background:rgba(124,92,255,.09);white-space:normal}
.dshp-hint{opacity:.5;font-size:calc(10.5px * var(--dshp-ps));margin-top:calc(6px * var(--dshp-ps));line-height:1.5;white-space:pre-wrap}
/* ——— 「好感」页：折叠分区 / 进度条 / 键值行 / 表格行 ——— */
.dshp-sec{margin-top:calc(7px * var(--dshp-ps));border:1px solid var(--dshp-line);
  border-radius:calc(9px * var(--dshp-ps));padding:0 calc(9px * var(--dshp-ps))}
.dshp-sec>summary{cursor:pointer;font-weight:600;font-size:calc(11.5px * var(--dshp-ps));
  padding:calc(6px * var(--dshp-ps)) 0;list-style:none;display:flex;justify-content:space-between;gap:8px}
.dshp-sec>summary::-webkit-details-marker{display:none}
.dshp-sec>summary::after{content:'▾';opacity:.5}
.dshp-sec:not([open])>summary::after{content:'▸'}
.dshp-sec[open]{padding-bottom:calc(7px * var(--dshp-ps))}
.dshp-sec-sub{font-weight:400;opacity:.55;font-size:calc(10.5px * var(--dshp-ps));margin-left:auto}
.dshp-bar{height:calc(7px * var(--dshp-ps));border-radius:99px;background:rgba(124,92,255,.16);overflow:hidden;margin:calc(4px * var(--dshp-ps)) 0}
.dshp-bar>i{display:block;height:100%;border-radius:99px;background:var(--dshp-accent);transition:width .25s}
.dshp-bar.dshp-bar-warm>i{background:#ff9d4d}
.dshp-bar.dshp-bar-low>i{background:#e5605a}
.dshp-kv{display:flex;justify-content:space-between;gap:8px;font-size:calc(11px * var(--dshp-ps));line-height:1.7}
.dshp-kv>span:first-child{opacity:.65}
.dshp-kv>span:last-child{text-align:right;font-variant-numeric:tabular-nums}
.dshp-tr{display:flex;align-items:baseline;gap:6px;font-size:calc(10.8px * var(--dshp-ps));line-height:1.6;padding:1px 0}
.dshp-tr>b{font-weight:600;min-width:calc(54px * var(--dshp-ps))}
.dshp-tr>em{font-style:normal;opacity:.55;flex:1}
.dshp-tr.dshp-lock{opacity:.45}
.dshp-tr.dshp-cur{color:var(--dshp-accent)}
.dshp-tag{font-size:calc(9.5px * var(--dshp-ps));border-radius:5px;padding:0 4px;border:1px solid var(--dshp-line);opacity:.8}
.dshp-tag.dshp-love{color:#e5605a;border-color:#e5605a}
.dshp-tag.dshp-hate{color:#888}
.dshp-gift{display:flex;align-items:center;gap:6px;margin-top:calc(4px * var(--dshp-ps))}
.dshp-gift>.dshp-gift-info{flex:1;min-width:0;font-size:calc(10.5px * var(--dshp-ps));line-height:1.45}
.dshp-gift>.dshp-gift-info>b{font-size:calc(11.5px * var(--dshp-ps))}
.dshp-gift>.dshp-gift-info>div{opacity:.6}
/* 今日心愿：好感页里不折叠的那一块；暖色渐变，跟下面的折叠分区区分开 */
.dshp-wish{margin-top:calc(7px * var(--dshp-ps));border:1px solid var(--dshp-line);border-radius:calc(9px * var(--dshp-ps));
  padding:calc(7px * var(--dshp-ps)) calc(9px * var(--dshp-ps));background:linear-gradient(135deg,rgba(255,157,77,.12),rgba(124,92,255,.08))}
.dshp-wish.dshp-done{opacity:.7}
.dshp-wish-head{display:flex;align-items:center;gap:calc(7px * var(--dshp-ps));font-weight:600;font-size:calc(12px * var(--dshp-ps))}
.dshp-wish-mark{flex:none;width:calc(15px * var(--dshp-ps));height:calc(15px * var(--dshp-ps));border-radius:50%;
  border:1.5px solid var(--dshp-accent);display:inline-flex;align-items:center;justify-content:center;
  font-size:calc(10px * var(--dshp-ps));color:#fff;line-height:1}
.dshp-wish.dshp-done .dshp-wish-mark{background:var(--dshp-accent)}
/* 表情包图鉴 */
.dshp-album{display:grid;grid-template-columns:repeat(auto-fill,minmax(calc(34px * var(--dshp-ps)),1fr));gap:calc(4px * var(--dshp-ps));margin-top:calc(6px * var(--dshp-ps))}
.dshp-album-tile{aspect-ratio:1;border:1px solid var(--dshp-line);border-radius:calc(7px * var(--dshp-ps));background:transparent;
  padding:1px;cursor:pointer;display:flex;align-items:center;justify-content:center;font:inherit;color:inherit}
.dshp-album-tile img{width:100%;height:100%;object-fit:contain;pointer-events:none}
.dshp-album-tile:not(.dshp-locked):hover{background:rgba(124,92,255,.14)}
.dshp-album-tile.dshp-locked{opacity:.28;cursor:default;font-size:calc(11px * var(--dshp-ps))}
.dshp-album-cap{font-size:calc(10.5px * var(--dshp-ps));line-height:1.5;min-height:2.6em;margin-top:calc(5px * var(--dshp-ps));opacity:.75;white-space:pre-wrap}
.dshp-label{display:flex;align-items:center;gap:7px;margin:6px 0;font-size:11.5px}
.dshp-label input[type=range]{flex:1;accent-color:var(--dshp-accent)}
/* ——— HUD：右键弹出的「余额 / 本轮消耗 / 峰谷计价」面板 ———
   主人要求：右键不再是设置菜单，而是这个框；信息要醒目、要盖在最上层、
   又要能自己收起来（不然挡住对话）。所以它是独立一层，z-index 比菜单还高。 */
.dshp-hud{position:absolute;left:50%;bottom:calc(100% + 10px * var(--dshp-ps));
  transform:translateX(calc(-50% + var(--dshp-shift,0px))) translateY(calc(8px + var(--dshp-shift-y,0px)));
  width:min(calc(292px * var(--dshp-ps)),86vw);pointer-events:auto;z-index:9;
  background:var(--dshp-bg);color:var(--dshp-fg);
  border:1px solid var(--dshp-line);border-radius:calc(var(--dshp-radius) * var(--dshp-ps));
  padding:calc(13px * var(--dshp-ps)) calc(14px * var(--dshp-ps)) calc(10px * var(--dshp-ps));
  box-shadow:0 20px 54px rgba(10,14,30,.34);backdrop-filter:blur(18px) saturate(1.4);
  opacity:0;visibility:hidden;
  transition:opacity .18s ease,transform .18s cubic-bezier(.2,.9,.3,1);
  font-size:calc(12px * var(--dshp-ps))}
.dshp-hud.dshp-on{opacity:1;visibility:visible;
  transform:translateX(calc(-50% + var(--dshp-shift,0px))) translateY(var(--dshp-shift-y,0px))}
/* 翻到下面：跟设置面板/气泡同一个道理，钱包卡片贴顶角落时头顶也没地方展开 */
.dshp-hud.dshp-flip{bottom:auto;top:calc(100% + 10px * var(--dshp-ps));
  transform:translateX(calc(-50% + var(--dshp-shift,0px))) translateY(calc(-8px + var(--dshp-shift-y,0px)))}
.dshp-hud.dshp-flip.dshp-on{transform:translateX(calc(-50% + var(--dshp-shift,0px))) translateY(var(--dshp-shift-y,0px))}
/* 刚弹出来那一下给一圈呼吸光，提醒「看这里」——冒烟效果用 box-shadow，不动 transform */
.dshp-hud.dshp-flash{animation:dshp-hud-flash 1.15s ease-out 2}
@keyframes dshp-hud-flash{
  0%{box-shadow:0 20px 54px rgba(10,14,30,.34),0 0 0 0 rgba(124,92,255,.5)}
  70%{box-shadow:0 20px 54px rgba(10,14,30,.34),0 0 0 14px rgba(124,92,255,0)}
  100%{box-shadow:0 20px 54px rgba(10,14,30,.34),0 0 0 0 rgba(124,92,255,0)}}
.dshp-hud-head{display:flex;align-items:center;justify-content:space-between;gap:8px;
  font-size:calc(11px * var(--dshp-ps));opacity:.6;letter-spacing:.3px;
  padding-right:calc(20px * var(--dshp-ps))}
.dshp-hud-money{display:flex;align-items:baseline;gap:6px;margin:calc(4px * var(--dshp-ps)) 0 calc(2px * var(--dshp-ps))}
.dshp-hud-money b{font-size:calc(30px * var(--dshp-ps));font-weight:850;letter-spacing:-1px;
  line-height:1.1;font-variant-numeric:tabular-nums}
.dshp-hud-money span{font-size:calc(12px * var(--dshp-ps));opacity:.55}
.dshp-hud-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;
  padding:calc(3px * var(--dshp-ps)) 0}
.dshp-hud-k{opacity:.6;font-size:calc(11px * var(--dshp-ps));white-space:nowrap}
.dshp-hud-v{font-weight:700;font-variant-numeric:tabular-nums;text-align:right}
.dshp-hud-sep{height:1px;background:var(--dshp-line);margin:calc(6px * var(--dshp-ps)) 0}
/* 峰 = 红，谷 = 绿（主人明确要求的配色） */
.dshp-hud-tag{display:inline-flex;align-items:center;gap:5px;border-radius:999px;
  padding:calc(2px * var(--dshp-ps)) calc(9px * var(--dshp-ps));
  font-weight:850;font-size:calc(11px * var(--dshp-ps));white-space:nowrap}
.dshp-hud-tag.dshp-peak{background:rgba(232,45,74,.15);color:#d81e3f;border:1px solid rgba(216,30,63,.38)}
.dshp-hud-tag.dshp-valley{background:rgba(16,185,129,.16);color:#0a8f63;border:1px solid rgba(10,143,99,.38)}
.dshp-hud-head-right{display:flex;align-items:center;gap:calc(7px * var(--dshp-ps))}
/* 配额环形指示器：只有厂商给得出「限额」才显示（比如 OpenRouter 的
   limit），DeepSeek 那种按量计费、没有额度上限概念的厂商不显示。
   纯 CSS conic-gradient 画环，不用额外画 SVG；--pct 是百分比数字（0-100），
   JS 那边用 style.setProperty 写进来。 */
.dshp-hud-quota{position:relative;width:calc(26px * var(--dshp-ps));height:calc(26px * var(--dshp-ps));flex:none}
.dshp-hud-quota-ring{width:100%;height:100%;border-radius:50%;
  background:conic-gradient(var(--dshp-quota-color,var(--dshp-accent)) calc(var(--pct,0) * 1%),
    var(--dshp-line) 0);
  -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 4px));
  mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 4px))}
.dshp-hud-quota-text{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:calc(7.5px * var(--dshp-ps));font-weight:800;font-variant-numeric:tabular-nums}
.dshp-hud-foot{opacity:.45;font-size:calc(10px * var(--dshp-ps));line-height:1.55;
  margin-top:calc(7px * var(--dshp-ps));white-space:pre-wrap}
@media (prefers-color-scheme:dark){
  .dshp-hud-tag.dshp-peak{background:rgba(255,86,110,.2);color:#ff8a9c;border-color:rgba(255,138,156,.4)}
  .dshp-hud-tag.dshp-valley{background:rgba(52,211,153,.18);color:#6ee7b7;border-color:rgba(110,231,183,.4)}}
.dshp-tab{position:fixed;right:16px;bottom:16px;z-index:2147483002;pointer-events:auto;cursor:pointer;
  border:1px solid var(--dshp-line);background:var(--dshp-bg);color:var(--dshp-fg);
  border-radius:20px;padding:6px 13px;font-size:12px;font-weight:600;
  box-shadow:0 6px 18px rgba(10,14,30,.28);transition:transform .12s ease;
  display:none;align-items:center;gap:6px;
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
`

export function injectStyle() {
  if (document.getElementById('dsh-live2d-pet-style')) return
  const s = document.createElement('style')
  s.id = 'dsh-live2d-pet-style'
  s.textContent = PET_CSS
  document.head.appendChild(s)
}
