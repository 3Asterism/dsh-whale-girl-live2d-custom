/** 会话消息里的文本抽取。 */

/** 从消息的 content 块数组里抽纯文本（消息块可能是 text / reasoning / image / tool-call）。 */
export function blocksToText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const b of content) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    else if (b.type === 'reasoning' && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join('')
}

export function textOf(message) {
  if (!message) return ''
  return blocksToText(message.content).trim()
}
