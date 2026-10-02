/** persona/keywords.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

// —— 危险命令：只提醒，不拦截（拦不拦是 DSH 的批准机制的事） ——
const DANGER_RES = [
  /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf]/, // rm -rf / rm -fr / rm -r -f
  /\bgit\s+push\b[^\n]*(--force\b|\s-f\b)/,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f)/,
  /\b(drop|truncate)\s+(table|database)\b/i,
  /\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force|\bRemove-Item\b[^\n]*-Force[^\n]*-Recurse/i,
  /\b(del|rmdir|rd)\s+\/[sq]/i,
  /\b(mkfs|dd\s+if=|format\s+[a-z]:)/i,
  /curl[^\n|]*\|\s*(ba)?sh\b/,
]

const SHELL_TOOL_RE = /bash|pwsh|powershell|shell|terminal|command|exec/i

export function isDangerous(toolName, args) {
  if (!SHELL_TOOL_RE.test(String(toolName || ''))) return false
  const s = String(args || '')
  return DANGER_RES.some((re) => re.test(s))
}

// —— 关键词（用户原话）：本地匹配，不上传、不落盘 ——
// 只对「口语化的短消息」生效：粘贴的日志 / 代码 / 堆栈不算（否则一段报错里的「肥」「累」都会让她起反应）。
// 先到先得；每条自带冷却，「胖」的冷却最长，且不会比戳炸毛更频繁（守住「别老生气」）。
export const KEYWORDS = [
  { id: 'kw-fat', re: /胖|肥鱼|大肥|你.{0,3}肥/, mood: 'grumpy', say: 'kwFat', cool: 60000, ms: 2800, memory: 'denial' },
  // 「妈妈」梗（中日二次元圈）：夏亚那句「能成为我母亲的女性」/ バブみ·妈味 / 奶妈（游戏治疗）/ 直接叫妈妈。
  // 全是反射式否认，否认完照样照顾（脸红 + 爱心，不生气）。更具体的梗排在前面，免得被「妈妈」二字吞掉。
  { id: 'kw-mother', re: /(能|可以|可能)成为我.{0,2}(母亲|妈妈)|母亲的女性|ララァ|拉拉.?辛|夏亚/, mood: 'shy', say: 'kwMother', cool: 60000, ms: 3400 },
  { id: 'kw-baby', re: /バブみ|ばぶみ|ママ味|妈味|母性|母爱|妈系/, mood: 'shy', say: 'kwBaby', cool: 60000, ms: 3200 },
  { id: 'kw-healer', re: /奶妈|奶我|奶一口/, mood: 'happy', say: 'kwHealer', cool: 60000, ms: 3000 },
  { id: 'kw-mama', re: /妈妈|麻麻|ママ|mama|mommy|认你当妈|当我妈|叫你妈|萝莉妈|小只妈|妈宝/i, mood: 'shy', heart: true, say: 'kwMama', cool: 45000, ms: 3200, praise: true, memory: 'not-mama' },
  // 社畜词典：开会 / 甲方 / 改需求 / 周报 / 老板 / 绩效 / 通宵
  { id: 'kw-work', re: /开会|甲方|改需求|需求(又|变|改)|周报|老板|绩效|通宵|九九六|996/, mood: 'sad', say: 'kwWork', cool: 120000, ms: 3400 },
  { id: 'kw-tired', re: /(好|太|真|很|有点|心|身)累|累死|累了|累瘫|好烦|太烦|烦死|心烦|崩溃|头疼|头大|不想干|想辞职|想下班|加班|撑不住|焦虑|又报错|又炸了/, mood: 'sad', say: 'kwTired', cool: 90000, ms: 3400 },
  { id: 'kw-off', re: /下班|收工|不干了|今天就到这|明天再说|先到这/, mood: 'happy', heart: true, say: 'kwOff', cool: 120000, ms: 3200 },
  { id: 'kw-scold', re: /笨|蠢|垃圾|废物|智障|滚|没用|你行不行/, mood: 'sad', say: 'kwScold', cool: 45000, ms: 2600 },
  { id: 'kw-praise', re: /谢谢|感谢|多亏|厉害|真棒|太棒|好用|辛苦了|靠谱|爱你/, mood: 'shy', say: 'kwPraise', cool: 20000, ms: 2600, praise: true },
  { id: 'kw-hungry', re: /饿|吃饭|吃什么|午饭|晚饭|白饭|夜宵/, mood: 'excited', say: 'kwHungry', cool: 30000, ms: 2400 },
  { id: 'kw-night', re: /晚安/, mood: 'sleepy', say: 'kwNight', cool: 60000, ms: 2800 },
  // —— v0.6.7：更多日常词（每条自带冷却；表情包在 persona/stickers.js 的 EVENT_STICKER，同名 say）——
  { id: 'kw-bug', re: /\bbug|虫子|\bdebug|修个|修复|\bfix(ed)?\b/i, mood: 'alert', say: 'kwBug', cool: 180000, ms: 2800 },
  // 单独一个「67」才是梗（「67 个文件」不是）；六七 / six seven 随处都算
  { id: 'kw-67', re: /^[\s,，.。!！~～]*(67|6-7|6 7)[\s,，.。!！~～]*$|六七|six\s?seven/i, mood: 'playful', say: 'kw67', cool: 60000, ms: 2400 },
  { id: 'kw-slack', re: /摸鱼|划水|偷懒|摆烂|躺平/, mood: 'smug', say: 'kwSlack', cool: 90000, ms: 2800 },
  { id: 'kw-price', re: /涨价|太贵|好贵|烧钱|穷死|没钱/, mood: 'sweat', say: 'kwPrice', cool: 120000, ms: 2800 },
  { id: 'kw-laugh', re: /哈哈|笑死|233|www|lol/i, mood: 'happy', say: 'kwLaugh', cool: 90000, ms: 2400 },
  { id: 'kw-drink', re: /可乐|奶茶|咖啡|快乐水|喝一杯/, mood: 'happy', say: 'kwDrink', cool: 90000, ms: 2600 },
  { id: 'kw-song', re: /唱歌|歌词|音乐|吉他|点歌/, mood: 'happy', say: 'kwSong', cool: 90000, ms: 2600 },
  { id: 'kw-party', re: /生日|恭喜|红包|发财|中奖|庆祝/, mood: 'excited', say: 'kwParty', cool: 90000, ms: 2800 },
  { id: 'kw-snap', re: /截图|截屏|拍照|自拍|合影/, mood: 'playful', say: 'kwSnap', cool: 90000, ms: 2400 },
  { id: 'kw-quiet', re: /闭嘴|安静点|别吵|吵死了|小声点/, mood: 'pout', say: 'kwQuiet', cool: 90000, ms: 2400 },
  { id: 'kw-sleep', re: /睡觉|想睡|犯困|困了|熬夜|失眠/, mood: 'sleepy', say: 'kwSleep', cool: 90000, ms: 2800 },
  { id: 'kw-hot', re: /好热|太热|热死|空调|风扇|中暑/, mood: 'sweat', say: 'kwHot', cool: 90000, ms: 2600 },
]

export const SORRY_RE = /抱歉|对不起|不好意思|我搞错|我弄错|是我的失误|我的疏忽/
