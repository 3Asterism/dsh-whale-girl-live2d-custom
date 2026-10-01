/** ui/icons.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

import { $ } from '../core/util.js'

/**
 * 工具栏图标，取自 Lucide（ISC 协议，https://lucide.dev，Feather Icons 的后继）——
 * 只挑了用到的四个，把 path/circle 内联成字符串，不引入整个图标库。
 * viewBox 统一 0 0 24 24，跟原版一致，方便以后要加新图标就直接照抄。
 */
const ICONS = {
  chat: '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  collapse: '<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
}

export function icon(name) {
  const wrap = $('span', 'dshp-icon-svg')
  wrap.innerHTML =
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`
  return wrap
}
