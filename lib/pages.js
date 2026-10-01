/** 两个独立页面：standalone（只放桌宠）与 diag（自检报告）。 */

import { MIME, VERSION } from './paths.js'

/** @param {{ route: Function }} deps */
export function registerPages({ route }) {
  // ————————————————————————————————————————————————————————————
  // 4. 独立桌面窗口：一个只放桌宠的极简页面，用 Chrome --app 打开就是一个
  //    无浏览器边框的常驻小窗（DSH 标签页关掉也还在）。
  // ————————————————————————————————————————————————————————————
  route('exact', '/dsh-pet/standalone', (req, res) => {
    const html = `<!doctype html>
  <html lang="zh-CN"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DS 鲸鱼娘 · 桌宠</title>
  <style>
    html,body{margin:0;height:100%;overflow:hidden;background:transparent}
    body{--dsh-pet-standalone:1}
  </style>
  </head><body>
  <script src="/dsh-pet/pet.js"></script>
  </body></html>`
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' })
    res.end(html)
  })

  // ————————————————————————————————————————————————————————————
  // 5. 自检页：一条 URL 看清桌宠到底走到哪一步了。
  //    开发时这台机器的无头浏览器起不了合成器，截图/自动化全废，
  //    所以把「模型加载到哪一步、哪些参数被过滤、掩码覆盖率多少」
  //    直接渲染成人类可读的报告，出问题时截个图就能定位。
  // ————————————————————————————————————————————————————————————
  route('exact', '/dsh-pet/diag', (req, res) => {
    const html = `<!doctype html>
  <html lang="zh-CN"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DS 鲸鱼娘 · 自检</title>
  <style>
   body{margin:0;padding:18px 20px 40px;font:13px/1.65 -apple-system,"PingFang SC",system-ui,sans-serif;
     background:#0f1117;color:#e6e9f2}
   h1{font-size:15px;margin:0 0 4px}
   .sub{opacity:.55;margin-bottom:14px;font-size:12px}
   pre{background:#171a23;border:1px solid #262a36;border-radius:10px;padding:12px 14px;
     white-space:pre-wrap;word-break:break-all;font-size:12px;line-height:1.6}
   .ok{color:#5ee6a8}.bad{color:#ff7b7b}.warn{color:#ffce6a}
  </style></head><body>
  <h1>DS 鲸鱼娘 · 自检</h1>
  <div class="sub">这条页面会把桌宠的启动过程和运行状态直接打出来。桌宠本体在右下角。</div>
  <pre id="out">正在启动…</pre>
  <script src="/dsh-pet/pet.js"></script>
  <script>
  (function(){
    var lines=[], out=document.getElementById('out');
    function add(s){lines.push(s); out.textContent=lines.join('\\n');}
    var t0=Date.now();
    add('插件版本: ${VERSION}');
    add('页面地址: '+location.href);
    add('时间: '+new Date().toLocaleString());
    add('');
    add('— 运行时 —');
    ['Live2DCubismCore','PIXI'].forEach(function(k){add('  '+k+': '+(window[k]?'已加载':'缺失'))});
    setTimeout(function(){
  add('  PIXI.live2d: '+((window.PIXI&&window.PIXI.live2d)?'已加载':'缺失'));
  if(window.PIXI&&PIXI.live2d&&PIXI.live2d.Live2DModel) add('  Live2DModel: 存在');
  var st=window.DSHPet&&window.DSHPet.state;
  add('');
  add('— 模型 —');
  if(!st){add('  <span class="bad">桌宠还没就绪（模型可能没加载出来）</span>')}
  else{
    add('  原始尺寸: '+(st.modelSize?Math.round(st.modelSize.w)+' × '+Math.round(st.modelSize.h):'未知'));
    add('  取景: '+(st.view?st.view.w+'×'+st.view.h+' ('+st.view.mode+', 缩放 '+st.view.scale+')':'未知'));
    if(st.contentBox){var b=st.contentBox;
      add('  角色实体范围: x '+b.x0+'–'+b.x1+' / y '+b.y0+'–'+b.y1+'（画布归一化，由启动自测得出）')}
    else add('  <span class="warn">角色实体范围未测出（按整张画布取景）</span>');
    add('  可用表情: '+st.expressions.length+' 个');
    add('  可用动作: '+st.motions.join(', '));
    add('');
    add('— 参数过滤 —');
    if(st.droppedParams.length) add('  <span class="warn">忽略 '+st.droppedParams.length+' 个：'+st.droppedParams.join('、')+'</span>');
    else add('  <span class="ok">全部表情参数都存在</span>');
  }
  add('');
  add('— 提示 —');
  add('  右键桌子上的鲸鱼娘 / 点 ⋯ 可以换表情、道具、动作、取景；双击开输入框。');
  add('  如果模型没出来，把这一页截图发出来即可定位。');
    }, 4000);
  })();
  </script>
  </body></html>`
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' })
    res.end(html)
  })
}
