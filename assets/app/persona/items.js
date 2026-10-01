/** persona/items.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

/**
 * 装饰品（粘性开关）：戴上就一直挂着，直到你再点一下摘掉。group 相同的互斥。
 *
 * 主人把话说清楚了：**要分开「动作」和「场景」**——
 *   · 装饰品（眼镜、贴纸、头饰、头发这类）→ 一直存在
 *   · 场景摆设（桌布、鲸鱼、巴菲、魔爪这类）→ 一直存在
 *   · 动作（猫爪、比耶、卖萌、心跳、蛋包饭这类）→ 演一次就消失
 * 所以「喵喵手 / 双手比耶 / 心跳 / 拿笔」都从这里搬走了：
 * 前三个是一次性动作，拿笔是常态（她本来就一直握着笔）。
 */
export const PROPS = {
  glassesRound: { label: '圆眼镜', expr: '圆眼镜', group: 'glasses', key: 'Alt+J' },
  glassesSquare: { label: '方眼镜', expr: '方眼镜', group: 'glasses', key: 'Alt+K' },
  glassesOval: { label: '椭圆眼镜', expr: '椭圆眼镜', group: 'glasses', key: 'Alt+L' },
  glassesSun: { label: '墨镜', expr: '墨镜', group: 'glasses', key: 'Alt+Z' },
  stickerCat: { label: '猫猫贴纸', expr: '猫猫贴纸', group: 'sticker', key: 'Alt+V' },
  stickerRabbit: { label: '兔兔贴纸', expr: '兔兔贴纸', group: 'sticker', key: 'Alt+B' },
  stickerBow: { label: '蝴蝶结贴纸', expr: '蝴蝶结贴纸', group: 'sticker', key: 'Alt+N' },
  flower: { label: '情绪花花', expr: '情绪花花', group: 'headwear', key: 'Alt+X' },
  ponytail: { label: '单边马尾', expr: '单边马尾', group: 'hair', key: 'Alt+2' },
  headband: { label: '发箍', expr: '头箍', group: 'headwear', key: 'Alt+3' },
  whaleHat: { label: '头顶鲸鱼', expr: '鲸鱼', key: 'Alt+1' },
}

/**
 * 场景摆设：换掉桌面布置，同样是「摆着不走」，再点一下才收。
 *
 * 「掏出手机」是原作者的一个**模式**（按键表里叫「自拍手机＆放下」）：
 * 掏出之后手机就摆在手上／桌上，自拍和快速自拍都在这个模式下才演。
 * 这里照搬这个依赖关系（见 requires），不是自己瞎编的组合。
 */
export const SCENES = {
  darkCloth: { label: '深色桌布', expr: '深色桌布', group: 'cloth', key: 'Alt+4' },
  whaleOnDesk: { label: '鲸鱼放桌上', expr: '鲸鱼放桌上', key: 'Del+Numpad1' },
  parfait: { label: '桌面巴菲', expr: '巴菲', key: '*+3' },
  claws: { label: '粉魔爪', expr: '魔爪', group: 'claw', clears: ['clawsWhite'], key: '*+4' },
  clawsWhite: { label: '白魔爪', expr: '魔爪换色', group: 'clawColor', needs: 'claws', key: '*+5' },
  phone: { label: '掏出手机', device: true, group: 'device', key: 'Del+Numpad4' },
  phoneSkin: { label: '手机换色', expr: '手机换色', needs: 'phone', key: 'Numpad0+2' },
}

/**
 * 常态道具：**不进菜单**（她本来就这样待着），放在这里只是让
 * IDLE_PROPS / WORK_PROPS 能按 key 解析出表达式。
 *
 * 这三个正好就是原作者绑在**左键按住**上的东西：点菜按下 + 画笔 + 挤
 * （`松键取消 = true`）——也就是说，按住她的时候她手里就是板子和笔。
 * 我们的常态道具跟人家的设计是一致的。
 */
export const BASE_ITEMS = {
  menuBoard: { label: '点菜板', expr: '点菜按下' },
  pen: { label: '拿笔', expr: '画笔' },
}

/**
 * 一次性动作：演一次就消失，绝不常驻。
 *
 * 全部照原作者的 `TriggerAnimation` / 动画类热键来（猫爪、比耶、冒爱心、
 * 挤番茄酱、自拍、喷水…），再加上主人点名的蛋包饭：
 * **「蛋包饭不能一直存在，蛋包饭只是挤完酱以后就消失了」**——
 * 所以它是「蛋包饭模式 + 挤番茄酱动画」合成的一次性表演。
 *
 * 机制上它们全部走 override 层（带 TTL 自动过期），**不写 userProps**，
 * 所以绝不会像装饰品那样赖在桌上。
 *
 * `requires` = 原作者设计里的前置模式（自拍类要先掏出手机），
 * 点了会自动补上前置，不用主人自己先开一遍。
 * `mood: null` = **不要压住动画自己的表情**：动作本身就带表情变化，
 * 我们再盖一张脸上去就是「冲突/覆盖」，所以这类动作把脸交还给动画。
 */
export const ACTIONS = {
  paw: {
    label: '猫爪摆手',
    motion: 'idle',
    ms: 4400,
    mood: null,
    key: 'Del+Numpad7',
    lines: ['（挥舞猫爪）喵喵喵～', '看人家的猫爪！', '（猫爪左右摆）可爱吧'],
  },
  catPaw: { label: '喵喵手', expr: '喵喵手~喵~动画', ms: 3000, mood: 'playful', key: 'Del+Numpad7', lines: ['（伸出猫爪）喵！', '爪爪在这里', '（捏了捏爪子）软的哦'] },
  doubleV: { label: '双手比耶', expr: '双手比耶', ms: 2800, mood: 'happy', key: 'Del+Numpad9', lines: ['（比耶）耶！', '看人家！', '胜利的手势～'] },
  love: { label: '冒爱心', expr: 'love', heart: true, ms: 3200, mood: null, key: 'Del+Numpad8', lines: ['（冒爱心）人家心情超好', '爱心发射～', '（飘了一串爱心）'] },
  heartbeat: { label: '心跳', expr: '心跳', heart: true, ms: 3200, mood: null, key: 'Alt+C', lines: ['（心跳加速）扑通扑通', '不、不是因为主人哦', '（捂胸口）人家没事！'] },
  squeeze: { label: '捏捏脸', expr: '挤', ms: 2600, mood: 'playful', key: '左键按住', lines: ['（捏）软软的吧～', '让人家挤一挤', '（被捏了）唔…'] },
  eraser: { label: '橡皮擦', expr: '橡皮', ms: 2600, mood: null, key: 'E', lines: ['（拿橡皮）擦掉重来', '这段不算，人家重写', '（擦擦擦）'] },
  undo: { label: '撤回', expr: '撤回', ms: 2600, mood: 'sweat', key: 'Ctrl+Z', lines: ['（撤回）刚才那句不算！', '人、人家没说过', '（赶紧撤回）'] },
  omurice: {
    label: '蛋包饭',
    expr: '蛋包饭',
    motion: 'ketchup',
    ms: 6200,
    mood: null,
    heart: true,
    key: 'Del+Numpad2 → 3',
    lines: ['（蛋包饭！）挤点番茄酱', '番茄酱画个爱心…给主人的', '（挤酱中）马上就好'],
  },
  selfie: {
    label: '自拍',
    motion: 'selfie',
    ms: 3600,
    mood: null,
    requires: 'phone',
    key: 'Del+Numpad5',
    lines: ['（举手机）笑一个～', '咔嚓！这张留给主人', '（找角度）人家这个角度最好看'],
  },
  selfieQuick: {
    label: '快速自拍',
    motion: 'selfieQuick',
    ms: 2000,
    mood: null,
    requires: 'phone',
    key: 'Del+Numpad6',
    lines: ['（咔嚓）好了！', '快拍一张', '（一秒拍完）'],
  },
  splash: { label: '鲸鱼喷水', motion: 'splash', ms: 2200, mood: null, key: '左键点她', lines: ['（喷水）噗——', '鲸鱼是会喷水的！', '（喷你一脸）嘻嘻'] },
}

export const ACTION_KEYS = Object.keys(ACTIONS)

export const ALL_TOGGLES = Object.assign({}, BASE_ITEMS, PROPS, SCENES)

/** 表达式名 → 它所属的互斥组（眼镜 / 贴纸 / 头饰 / 桌布…）。resolveRig 用它保证同组只显示一个。 */
export const GROUP_OF_EXPR = {}

for (const d of Object.values(ALL_TOGGLES)) if (d.expr && d.group) GROUP_OF_EXPR[d.expr] = d.group

/**
 * 两种底层状态下她手上拿什么。
 * 主人要的是：平时拿个板子待着，跑任务时拿记录板干活；自拍/比耶那类只作为
 * 「完成奖励」这类特殊场景的瞬时反应，不进待机循环。
 */
// 主人定的常态：手里是「本子 + 笔」，思考和待机都这样。
// 眼镜/手机之类由具体工具反应临时加，装饰品（猫耳、单马尾、贴纸）由主人自己开、能一直留着。
export const IDLE_PROPS = ['menuBoard', 'pen']

export const WORK_PROPS = ['menuBoard', 'pen']
