/**
 * 把前端脚本注入 DSH 的 index.html。两条路径都要：
 *   · 桌面端：tapIndex 到不了静态 dist 出的 index，必须用 index-inject 推结构化行（dsh-whale-widget 同路径）；
 *   · 网页端：tapIndex 直接改 html。
 * 两处都是幂等的（已经注入过就不重复）。
 */

const SRC = '/dsh-pet/pet.js'

/** index-inject 表里推一行脚本（幂等）。 */
export function injectScriptRow(table) {
  try {
    if (!Array.isArray(table)) return
    for (const row of table) {
      if (!row) continue
      if (row.kind === 'script-src' && row.src === SRC) return
      if (row.kind === 'script' && typeof row.text === 'string' && row.text.indexOf(SRC) >= 0) return
    }
    table.push({
      kind: 'script',
      placement: 'body',
      text:
        '(function(){try{var d=document.body||document.head||document.documentElement;if(!d)return;' +
        'var s=document.createElement("script");s.src="' + SRC + '";' +
        's.onerror=function(){};d.appendChild(s)}catch(e){}})()',
    })
  } catch (err) {}
}

/** tapIndex：往 html 里塞一个 <script>（幂等）。 */
export function injectIntoHtml(html) {
  if (html.indexOf(SRC) !== -1) return html
  const tag = '<script defer src="' + SRC + '"></script>'
  if (html.indexOf('</body>') !== -1) return html.replace('</body>', tag + '</body>')
  return html + tag
}
