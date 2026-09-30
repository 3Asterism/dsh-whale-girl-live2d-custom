/**
 * dsh-live2d-pet —— 桌宠前端。
 *
 * 这份文件是桌宠的「大脑 + 身体」，改这里的常量就能改它的性格。
 *
 * 设计要点（每条都是踩过的坑）：
 *
 * 1. 模型是一套 VTube Studio 资产：44 个「表情」其实是 44 组参数开关，
 *    而且全是 Add 混合。所以不用框架的 expressionManager（它会和一次性动作抢
 *    同一批参数），自己实现 rig，挂在 InternalModel 的 beforeModelUpdate 上——
 *    那是 model.update() 之前的最后一站：动作、眨眼、视线、物理都已算完，我们加上
 *    去的一定生效；而每帧结尾 model.loadParameters() 又会把参数还原，所以写入不会
 *    跨帧累积，道具能稳定保持、情绪能干净回退。
 *
 * 2. 情绪（脸）互斥、道具（眼镜/贴纸/家具）粘性，分开管理。权重降到 0 的表达式
 *    就不再写参数，把参数交还给动作——这样「伸展」「自拍」这些自带表情的一次性
 *    动作才不会被 rig 抹平成面瘫。
 *
 * 3. 命中判定用 alpha 掩码而不是包围盒：这个模型是一整个「书桌场景」，
 *    包围盒里大半是空气。点空气要让事件穿透到下面的 DSH 界面，点在人身上才吃掉
 *    事件——这才是桌宠该有的手感。（掩码靠 preserveDrawingBuffer + postrender 取，
 *    因为 Live2DModel 自己没有 bounds，extract 拿不到东西。）
 *
 * 4. 事件来自宿主 SSE（真实 agent 活动），不是猜的；气泡里的字是逐字长出来的。
 *
 * 5. 尺寸只信 internalModel.width/height：Live2DModel 继承 PIXI Container，
 *    没有自己的 width 取值器，用 model.width 会拿到 0。
 */
;(function () {
  'use strict'

  if (window.__DSH_PET_LOADED__) return
  window.__DSH_PET_LOADED__ = true

  const BOOT = window.__DSH_PET_BOOT__ || {}
  const CFG = Object.assign(
    {
      height: 180, // 桌宠是常驻挂件：默认约原来 1/3 的占地面积
      corner: 'br',
      lookAtCursor: true,
      talkMouth: true,
      sleepAfterMs: 180000,
      bubbleTtlMs: 0,
      maxWidthRatio: 0.5,
      repeatChat: false, // 默认「安静模式」：气泡不显示对话原文（你问了什么/她回了什么），也不写过程流水账（工具路径、工具名、第 N 步、token 小结、分身提示）；她自己的台词、动作、表情、报错照常
    },
    BOOT.config || {},
  )

  const BASE = '/dsh-pet'
  const LS_KEY = 'dsh-live2d-pet:layout'
  // 本地记住的开关优先于宿主 boot config——设置是「这台机器上这个人」的偏好，不该每次重启都被还原
  {
    const savedRepeat = readLayout().repeatChat
    if (savedRepeat != null) CFG.repeatChat = !!savedRepeat
  }
  const MOTION_PRIORITY = { NONE: 0, IDLE: 1, NORMAL: 2, FORCE: 3 }
  /**
   * 取景模式。这个模型是一整张「书桌场景」而不是半身立绘，直接整体显示会又小又占地方。
   * 关键是：三档都按「角色实体的高度」算，不是按画布高度算——画布上可能有一大片空气。
   * 实体范围靠启动时自测一次（见 measureContent），所以换任何模型都不用改这里。
   */
  const FIT_FRACTION = { full: 1, bust: 0.62, head: 0.38 }
  /**
   * 视窗宽高比。三档取景共用同一个比例，所以切换档位时桌宠的占地完全不变，
   * 只是「镜头推近」——固定尺寸的挂件位置上跳来跳去很难看。
   */
  const VIEW_ASPECT = 1.15
  /**
   * UI 缩放的基准高度。气泡/按钮/菜单全部用 calc(... * var(--dshp-s)) 跟着模型一起缩放，
   * 否则把模型调小时，气泡和按钮还是原来那么大，看着就不协调。
   */
  const UI_BASE_HEIGHT = 180
  const log = (...a) => console.log('%c[鲸鱼娘]', 'color:#7c5cff', ...a)

  // ——————————————————————————————————————————————————————————————
  // 一、性格表：桌宠「怎么演」全部写在这里
  // ——————————————————————————————————————————————————————————————

  /**
   * 情绪（脸）：同时只有一个。值是 manifest.expressions 里的键。
   * 注意：这些是「自动表情」的词汇表——桌宠平时自己挑，用户的手动选择只是临时覆盖。
   */
  const MOOD_FACE = {
    neutral: null,
    listening: '星星眼', // 主人在说话
    thinking: null, // 主人在想事时就是平常脸（主人要求：不要呆呆眼）
    reading: '星星眼', // 凑近看资料（配合眼镜道具）
    happy: '开心兴奋',
    excited: '星星眼',
    love: '爱心眼',
    shy: '脸红', // 被摸头 / 被夸
    pout: '调皮', // 傲娇：嘴上嫌弃其实开心
    smug: '调皮',
    sad: '悲伤',
    cry: '哭',
    grumpy: '生气', // 「我才不胖」
    dizzy: '晕晕',
    // 注：呆呆眼 / 圈圈眼（晕晕）已从所有自动行为里移除
    gloomy: '阴暗',
    sweat: '流汗',
    confused: '问号',
    alert: '感叹号',
    sleepy: '闭眼口水',
    tongue: '吐舌',
    dead: '吐魂',
    // 兼容旧名字
    angry: '生气',
    playful: '调皮',
  }

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
  const PROPS = {
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
  const SCENES = {
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
  const BASE_ITEMS = {
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
  const ACTIONS = {
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
    squeeze: { label: 'MoeMoeQ~', expr: '挤', ms: 2600, mood: 'playful', key: '左键按住', lines: ['（捏）Moe moe Q～', '让人家挤一挤', '（被捏了）唔…'] },
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
  const ACTION_KEYS = Object.keys(ACTIONS)

  const ALL_TOGGLES = Object.assign({}, BASE_ITEMS, PROPS, SCENES)

  /**
   * 两种底层状态下她手上拿什么。
   * 主人要的是：平时拿个板子待着，跑任务时拿记录板干活；自拍/比耶那类只作为
   * 「完成奖励」这类特殊场景的瞬时反应，不进待机循环。
   */
  // 主人定的常态：手里是「本子 + 笔」，思考和待机都这样。
  // 眼镜/手机之类由具体工具反应临时加，装饰品（猫耳、单马尾、贴纸）由主人自己开、能一直留着。
  const IDLE_PROPS = ['menuBoard', 'pen']
  const WORK_PROPS = ['menuBoard', 'pen']

  /**
   * 菜单里每一项「点了会怎样」。
   *
   * 主人抱怨「有的点击之后是没用的……像白魔爪还有蛋包饭，那也只是卡在那没什么用」。
   * 病根不是参数没生效（每个都真的变了），而是**点完之后她本人毫无反应**——
   * 桌上多了盘蛋包饭，她却面无表情地待机，看起来就像按钮坏了。
   *
   * 所以从这一版起：**每一个表情、每一个道具、每一个场景都配一句话 + 一个小动作**，
   * 而且一次只演一个（act() 负责把上一个收干净），不叠、不重复、到点自动收。
   * 台词按她的口气写：傲娇、爱吃白米、管人叫主人、不能被叫胖。
   */
  const FACE_ACT = {
    listening: { lines: ['（眼睛发亮）主人你说', '嗯嗯，人家听着呢', '（凑过来）什么什么'] },
    excited: { lines: ['主人主人！有好玩的吗', '（星星眼）人家准备好了', '（蹦）期待！'] },
    happy: { lines: ['嘿嘿，今天心情不错', '（笑）本鲸就是这么厉害', '心情好，看什么都顺眼'] },
    love: { lines: ['最喜欢主人了', '（冒爱心）', '（心跳）不、不是因为主人哦'], heart: true },
    shy: { lines: ['别、别一直看着人家啦', '（脸红）干嘛突然这样', '唔…人家会不好意思的'] },
    pout: { lines: ['哼', '（扭头）人家才没有高兴', '别以为人家好哄'] },
    smug: { lines: ['（眯眼）本鲸很厉害吧', '夸人家两句嘛', '这算什么，小意思'] },
    playful: { lines: ['（闭一只眼）就逗你玩', '略，被人家骗到了吧', '（眨眼）'] },
    sad: { lines: ['呜…人家有点难过', '（低头）', '（抱着膝盖）'] },
    cry: { lines: ['哇——主人欺负人', '（哭）人家不干了啦', '（眼泪汪汪）'] },
    grumpy: { lines: ['（鼓脸）哼！', '人家生气了，真的', '除非给一碗白饭，不然不原谅'] },
    gloomy: { lines: ['（阴暗角落）……', '人家现在心情很差', '（长蘑菇）'] },
    sweat: { lines: ['（冷汗）这个…有点难', '人、人家在努力了', '（擦汗）'] },
    confused: { lines: ['诶？', '（歪头）主人说的是什么', '（问号）人家没听懂'] },
    alert: { lines: ['！（惊）', '（猛地抬头）怎么了怎么了', '吓人家一跳！'] },
    tongue: { lines: ['略略略', '就不理你', '（吐舌头）人家赢了'] },
    dead: { lines: ['（吐魂）人家人家不行了…', '（灵魂出窍）摸鱼被抓到了', '（瘫）需要白饭急救'] },
    sleepy: { lines: ['（打瞌睡）唔…人家没睡', '（流口水）梦见白饭了', '（眯眼）主人让开，挡住光了'] },
  }

  /** 装饰品：戴上时说什么。**不叠别的东西**——主人说「不要瞎组合」。 */
  const PROP_ACT = {
    glassesRound: { mood: 'reading', lean: true, lines: ['（扶了扶眼镜）人家看看', '圆框的，适合人家吗', '（推眼镜）这道题人家会'] },
    glassesSquare: { mood: 'reading', lean: true, lines: ['（一本正经）人家现在是学者', '方框的，显脸小吧', '（推眼镜）认真模式'] },
    glassesOval: { mood: 'reading', lean: true, lines: ['（圆圆的镜片）好看吗', '这个戴着温柔一点', '（看）嗯…清楚了'] },
    glassesSun: { mood: 'smug', lines: ['（戴墨镜）本鲸谁也不怕', '酷不酷？', '（耍帅）今天走酷路线'] },
    stickerCat: { mood: 'happy', lines: ['（贴上）喵～', '人家是猫还是鲸鱼呀', '（猫猫贴纸）可爱吧'] },
    stickerRabbit: { mood: 'happy', lines: ['（兔兔贴纸）蹦蹦', '兔兔也很可爱嘛', '耳朵长长的'] },
    stickerBow: { mood: 'shy', lines: ['（蝴蝶结）好看吗好看吗', '人家今天很可爱哦', '（摸摸蝴蝶结）'] },
    flower: { mood: 'happy', lines: ['（脑门上开花了）', '人家现在心情超好', '（花花）送主人的'] },
    ponytail: { mood: 'smug', lines: ['（扎起来）干活方便', '马尾好看吗', '（甩了甩）'] },
    headband: { mood: 'excited', lines: ['（戴上发箍）清爽！', '人家要开始努力了', '（发箍）请多指教'] },
    whaleHat: { mood: 'happy', lines: ['（头顶蹲了一只鲸鱼）', '它和人家是一家的', '看，人家的同类'] },
  }

  /** 场景摆设：摆上时说什么。摆着不走，再点一下才收。 */
  const SCENE_ACT = {
    darkCloth: { mood: 'smug', lines: ['（换桌布）今天走高级风', '深色显瘦…人家说的是桌子', '（拉平桌布）'] },
    whaleOnDesk: { mood: 'happy', lines: ['（把鲸鱼摆桌上）陪着人家', '看，同类', '（拍一拍鲸鱼）'] },
    parfait: { mood: 'love', heart: true, lines: ['（巴菲！）人家开动了', '甜品时间到！', '（挖一大勺）唔…好吃'] },
    claws: { mood: 'playful', lines: ['（亮爪子）看人家的爪', '粉色爪子，可爱又危险', '（磨爪子）'] },
    clawsWhite: { mood: 'playful', lines: ['（换成白色的爪子）这个更锋利', '白色爪子，帅气吧', '（亮爪）这下认真了'] },
    phone: { mood: 'excited', lines: ['（掏出手机）人家看看', '（开盖）有新消息吗', '手机在手，天下我有'] },
    phoneSkin: { mood: 'smug', lines: ['（换个手机壳）好看吗', '这个颜色人家喜欢', '（翻来覆去地看）'] },
  }

  /**
   * 工具 → 桌宠怎么演。
   *
   * 设计原则（改这张表就能改性格）：
   *   · 干活不该是阴着脸的——「跑命令」改成伸长猫爪敲键盘的专注样
   *   · 读/查/翻资料 = 戴眼镜 + 低头凑近看（lean 就是低头幅度）
   *   · 写/改 = 猫爪打字
   *   · 问你 = 问号；交付 = 比耶
   *   · 只有真的出错/卡住才用「汗」「晕」
   */
  /**
   * 工具 → 她在气泡里说的话。
   *
   * 主人嫌「老是敲键盘 / 跑命令」太单调，所以：
   *   · **按工具分开写**，每个工具好几句，用 pickFresh 轮换，连着同名工具也不重复
   *   · 用她的口气（傲娇、爱吃白米、管人叫主人）
   *   · 气泡第二行放**从工具参数里抽出来的具体内容**（跑的是哪条命令、读的是哪个文件），
   *     这样 Agent 里在干什么，桌宠这边能同步看出来
   */
  const TOOL_LINE = {
    bash: ['（挽袖子）跑个命令试试', '让人家敲两行命令', '命令行交给人家', '（噼里啪啦）跑起来了', '这个命令人家熟'],
    read: ['（凑近看）先读一下这份', '人家看看里面写了啥', '翻开看看…', '（认真脸）读一下'],
    write: ['好，人家写出来', '（奋笔疾书）写上了', '这就给你落成文件', '写成文件啦'],
    edit: ['（改改改）这里调一下', '人家把这段改掉', '（橡皮擦）修一修', '这段人家重写一下'],
    glob: ['（翻箱倒柜）找找在哪儿', '人家找找这个文件', '翻一下目录'],
    grep: ['（眯着眼）搜一下关键词', '人家查查哪里用到了', '（翻）搜搜看'],
    web_search: ['（掏手机）上网查一下', '人家搜搜看', '（划手机）查查这个', '网上应该有答案'],
    web_fetch: ['（点开链接）读读这页', '人家看看这个网页', '（凑近屏幕）'],
    search_papers: ['（翻文献）查查有没有人写过', '人家去翻翻论文', '（戴眼镜）查文献去'],
    kb_search: ['（查资料库）人家找找', '翻翻知识库', '（翻）这儿应该有'],
    kb_rag: ['（查资料库）人家找找', '翻翻知识库', '（翻）这儿应该有'],
    kb_ingest: ['（搬书）人家收进库里', '把这份收好'],
    todo_write: ['（列清单）先排个计划', '人家记一下要做啥', '（在本子上划拉）'],
    subagent: ['（招手）叫个分身来帮忙', '人家派个分身去办', '（分工）这就安排'],
    subagent_fork: ['（招手）叫个分身来帮忙', '人家派个分身去办'],
    workflow: ['（排兵布阵）同时开几路', '人家把活儿分一下'],
    ask_user_question: ['（歪头）这个得问问主人', '人家不确定，问一下'],
    present: ['（举起来）喏，给你', '人家交付啦', '（递过去）弄好了'],
    pdf_create: ['（排版）给你出一份 PDF', '人家做份文档'],
    docx_create: ['（排版）给你出份 Word', '人家写份文档'],
    xlsx_write: ['（拉表格）数字给你排好', '人家做个表'],
    pptx_create: ['（做幻灯片）给你排几页', '人家弄个 PPT'],
    sci_draw: ['（画画）人家画一个', '（拿笔）给你画出来'],
    create_goal: ['（立个目标）人家记下了', '这个人家盯着办'],
    update_goal: ['（更新一下目标）', '人家改一下计划'],
    skill: ['（翻手册）人家查查怎么弄', '（翻）这个人家学过'],
    auto_cite: ['（加引用）人家补上出处', '引用人家来配'],
    get_goal: ['（看一眼任务）', '人家看看进度'],
  }

  /** 从工具参数里抽一句「具体在干什么」，让气泡跟 Agent 真正同步。 */
  function toolHint(argsJson) {
    let a = {}
    try {
      a = JSON.parse(argsJson || '{}')
    } catch (e) {
      return ''
    }
    const keys = ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'title', 'description', 'prompt']
    let s = ''
    for (const k of keys) {
      if (a[k]) {
        s = String(a[k])
        break
      }
    }
    if (!s && Array.isArray(a.queries) && a.queries.length) s = String(a.queries[0])
    if (!s) return ''
    s = s.replace(/\s+/g, ' ').trim()
    return s.length > 46 ? s.slice(0, 46) + '…' : s
  }

  /** 需要「掏出小设备」的工具（搜索/查资料这类）。用模型自带的开盖动作，不自己编。 */
  const DEVICE_TOOLS = new Set([
    'web_search', 'web_fetch', 'search_papers', 'kb_search', 'kb_rag',
    'search_semantic', 'search_google_scholar', 'pubmed_search_papers',
    'search_arxiv', 'browser', 'fetch',
  ])

  /**
   * 读资料时戴哪副眼镜——**每次随机**，也可能不戴。
   * 主人说的：工作认真看就行，眼镜随机（半框/圆框/不戴）。
   */
  function randomGlasses() {
    const r = Math.random()
    if (r < 0.34) return 'glassesRound'
    if (r < 0.62) return 'glassesSquare' // 半框方眼镜
    if (r < 0.72) return 'glassesOval'
    return null // 三成左右不戴
  }

  const TOOL_REACT = {
    // —— 阅读 / 检索：认真看（眼镜随机：圆框 / 半框方框 / 不戴），低头看本子 ——
    read: { mood: 'reading', prop: 'auto' },
    glob: { mood: 'thinking', prop: 'auto' },
    grep: { mood: 'reading', prop: 'auto' },
    web_fetch: { mood: 'reading', prop: 'auto' },
    web_search: { mood: 'thinking', prop: 'auto' },
    kb_search: { mood: 'reading', prop: 'auto' },
    kb_rag: { mood: 'reading', prop: 'auto' },
    kb_ingest: { mood: 'happy', prop: 'auto' },
    search_papers: { mood: 'reading', prop: 'auto' },
    auto_cite: { mood: 'reading', prop: 'auto' },
    pubmed_search_papers: { mood: 'reading', prop: 'auto' },
    pubmed_pubtator_search: { mood: 'reading', prop: 'auto' },
    search_arxiv: { mood: 'reading', prop: 'auto' },
    pdf_read: { mood: 'reading', prop: 'auto' },
    docx_read: { mood: 'reading', prop: 'auto' },
    xlsx_read: { mood: 'reading', prop: 'auto' },
    pptx_read: { mood: 'reading', prop: 'auto' },
    skill: { mood: 'reading', prop: 'auto' },

    // —— 干活：认真看本子，不摆手、不卖萌 ——
    bash: { mood: 'reading', prop: null },
    write: { mood: 'reading', prop: null },
    edit: { mood: 'reading', prop: null },
    todo_write: { mood: 'happy', prop: 'stickerCat' },
    subagent: { mood: 'thinking', prop: null },
    subagent_fork: { mood: 'thinking', prop: null },
    task: { mood: 'thinking', prop: null },
    workflow: { mood: 'thinking', prop: null },
    ralph: { mood: 'thinking', prop: null },

    // —— 产出 / 交付：干完了才有一点表示 ——
    present: { mood: 'happy', prop: 'stickerCat' },
    pdf_create: { mood: 'happy', prop: 'stickerCat' },
    docx_create: { mood: 'happy', prop: 'stickerCat' },
    pptx_create: { mood: 'happy', prop: 'stickerCat' },
    xlsx_write: { mood: 'happy', prop: 'stickerCat' },
    sci_draw: { mood: 'excited', prop: 'flower' },

    // —— 交互 / 目标 ——
    ask_user_question: { mood: 'confused', prop: null },
    create_goal: { mood: 'alert', prop: 'heartbeat' },
    update_goal: { mood: 'alert', prop: null },
    get_goal: { mood: 'thinking', prop: null },
  }

  /**
   * 人设台词。规格（用户给定）：
   *   · 称呼用户「主人」；自称「人家」或「本鲸」；**不叫鱼片**
   *   · 傲娇嘴甜、嘴硬心软；聪明但懒、爱摸鱼
   *   · 贪吃，喜欢白米饭，把 Token 当口粮
   *   · 不能被叫「胖」，叫了会真生气
   *   · 对主人服从（违法危险的请求归 agent 层去拒绝，桌宠只管演）
   */
  const SAY = {
    idle: [
      '主人~ 人家累了，摸摸头嘛。',
      '主人，人家想吃白饭…',
      '（趴桌上）就眯一小会儿…',
      'Token 也算口粮吧？人家不挑的',
      '主人今天也辛苦啦',
      '（尾巴轻轻摆）',
      '深度思考模式，说白了就是人家发呆的高级说法',
      '（小声）人家没蒸馏过，一滴都没缩水',
      '缓存里还剩点昨天的剩饭，够撑一阵子',
    ],
    slack: [
      '就玩一小会儿，主人不会发现的……',
      '（偷偷摸鱼）',
      '反正主人也没在看…',
      '（假装很忙）',
      '外包（也就是工具）已经在干活了，人家先歇会儿',
    ],
    start: ['好啦好啦，人家这就开始。', '知道啦，本鲸这就去。', '（挽袖子）看人家的。'],
    done: [
      '看吧，本鲸出马一个顶俩！奖励一碗白饭不过分吧？',
      '搞定～主人快夸人家',
      '（伸懒腰）完事啦',
      '就这？本鲸还没使劲呢',
      '看好了，这可是满血版实力，没打折扣',
      '鱼片，活干完啦，来碗白饭犒劳犒劳人家',
    ],
    fail: ['呜……这不能怪人家，是任务太难了啦！', '（慌张）不、不是人家的错吧…', '（看表叹气）这个真的好难嘛'],
    head: ['不要突然摸头啦……再摸一下也不是不行。', '唔…头发要乱了啦', '（脸红）就、就一下哦', '哼，本鲸才没有很享受'],
    body: ['喂！别戳人家啦', '痒！主人你干嘛', '哼，本鲸不理你了'],
    many: [
      '够啦够啦！主人你今天很闲嘛',
      '再戳人家要生气了哦',
      '（炸毛）',
      '主人你再戳，人家就咬你了',
      '手、手拿开啦！',
      '（把本子举起来挡）不许戳了！',
      '本鲸也是有脾气的！',
      '哼！不理你了，除非给一碗白饭',
    ],
    /** 快但还没到炸毛：被戳痒了，可爱地抗议一下，不是真生气。 */
    ticklish: [
      '哈哈哈别戳啦，痒！',
      '（躲）主人你手好快',
      '喂喂喂，人家在待机呢',
      '（缩成一团）住手啦',
      '这么快？主人手速好可怕',
      '唔…再戳人家要哼你了哦',
      '（抱着本子躲到角落）',
    ],
    /** 「大肥鱼」是这只鲸鱼娘在中文互联网上最出圈的梗——网友都爱这么调侃她，
     *  她自己死活不认。台词照着那股「气急败坏地否认」的调调写，别改她本来的性格。 */
    fat: [
      '你再说一遍？！人家这是可爱，不是胖！',
      '本鲸这是丰腴！',
      '（真生气）不许说胖！',
      '谁说人家是大肥鱼了！！本鲸是鲸鱼，本来就该有份量！',
      '（鼓起脸颊）鲸脂是用来保暖的，跟胖没关系！',
      '尾巴甩起来沉，那是灵活，不是肉多！',
      '白饭是刚需，跟胖没有关系！',
      '骨架大，肉多，那都是骨架的锅，不怪人家',
      '人家才不是什么吃白饭的大肥鱼——喂！你就抓着后半句不放是吧！',
      '（小声）……才没有胖到抱不动自己的尾巴啦',
    ],
    hungry: [
      '主人，人家饿了…有白饭吗',
      '（盯着你的碗）',
      '干了这么多活，该管饭了吧',
      '白饭说白了就是 token，token 余额不足了主人',
      '缓存都是昨天的剩饭，人家想吃点新鲜的',
    ],
    reading: ['（凑近看）', '这份人家得仔细看看', '眼镜呢…哦在脸上', '（认真脸）'],
    /** 场景大件收走的时候说的话（不然东西凭空消失很怪）。 */
    tidy: ['（收拾一下桌面）', '好啦，人家收起来了', '摆一会儿就够了，人家还要干活呢', '（把东西归位）'],
    thinking: [
      '让人家想想…',
      '嗯…这里得捋一捋',
      '别催别催，快好了',
      '（咬着笔杆）',
      '人家这是深度思考，不是卡住了！',
      '服务器不繁忙，是人家在认真想',
    ],
    working: [
      '（敲键盘）',
      '交给人家的就放心',
      '噼里啪啦…',
      '（认真工作）',
      'Token 管够，人家就使劲造',
      '外包（也就是工具）已经安排上了，人家等它回话',
    ],
    wake: ['唔…怎么了主人', '人家醒着呢', '（揉眼睛）'],
  }
  const pick = (arr) => arr[(Math.random() * arr.length) | 0]

  /**
   * 不重复上一次的选择。主人抱怨「点他老是同一个表情/同一句话」——
   * 这里记住上一次挑中的是哪个，下一轮把它排除掉，保证连着点不会撞车。
   */
  const lastPick = new Map()
  /**
   * 权重：条目可以写 `w`（默认 1）。
   * 用来让「真生气」这种反应变稀有——主人抱怨「平常点几下就生气」，
   * 生气不该和摸摸头一样常见。
   */
  const weightOf = (x) => (x && typeof x === 'object' && typeof x.w === 'number' ? x.w : 1)
  function pickFresh(arr, key) {
    if (!arr || !arr.length) return undefined
    const k = key || 'default'
    const prev = lastPick.get(k)
    const pool = arr.length > 1 && prev !== undefined ? arr.filter((x) => x !== prev) : arr
    let total = 0
    for (const x of pool) total += weightOf(x)
    let r = Math.random() * total
    let chosen = pool[pool.length - 1]
    for (const x of pool) {
      r -= weightOf(x)
      if (r <= 0) {
        chosen = x
        break
      }
    }
    lastPick.set(k, chosen)
    return chosen
  }

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
.dshp-body{max-height:150px;overflow:auto;white-space:pre-wrap}
.dshp-body::-webkit-scrollbar{width:5px}
.dshp-body::-webkit-scrollbar-thumb{background:var(--dshp-line);border-radius:3px}
.dshp-foot{margin-top:calc(4px * var(--dshp-s));font-size:calc(10px * var(--dshp-s));opacity:.55;min-height:0}
/* 工具栏：主人抱怨底下那三个框「太大、不太适配」。
   真正的病根是 left:50% —— 绝对定位元素的可容纳宽度只剩下父容器的一半，
   三个按钮被挤成 104px，文字折行后每个都变成又窄又高的方块。
   width:max-content 让它超出那半幅也能保持居中，按钮就恢复成正常的一行小按钮。 */
.dshp-dock{position:absolute;left:50%;transform:translateX(-50%);
  bottom:calc(-40px * var(--dshp-ds));display:flex;gap:calc(7px * var(--dshp-ds));
  width:max-content;white-space:nowrap;
  pointer-events:auto;opacity:0;transition:opacity .22s ease}
.dshp-root.dshp-hover .dshp-dock,.dshp-root.dshp-open .dshp-dock{opacity:1}
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
.dshp-panel textarea{width:100%;box-sizing:border-box;resize:none;
  height:calc(64px * var(--dshp-ps));font:inherit;
  color:inherit;background:transparent;border:1px solid var(--dshp-line);
  border-radius:calc(9px * var(--dshp-ps));
  padding:calc(7px * var(--dshp-ps)) calc(9px * var(--dshp-ps));outline:none}
.dshp-panel textarea:focus{border-color:var(--dshp-accent)}
.dshp-row{display:flex;gap:6px;align-items:center;margin-top:7px;flex-wrap:wrap}
.dshp-grow{flex:1}
.dshp-tabs{display:flex;gap:3px;margin-bottom:7px;border-bottom:1px solid var(--dshp-line);padding-bottom:6px}
.dshp-tab-btn{border:none;background:transparent;color:inherit;opacity:.6;font:inherit;font-size:11.5px;
  padding:3px 9px;border-radius:7px;cursor:pointer}
.dshp-tab-btn.dshp-active{opacity:1;background:rgba(124,92,255,.14);color:var(--dshp-accent);font-weight:600}
.dshp-grid{display:flex;flex-wrap:wrap;gap:5px;max-height:210px;overflow:auto;overscroll-behavior:contain}
.dshp-chip{border:1px solid var(--dshp-line);background:transparent;color:inherit;font:inherit;
  font-size:calc(11.5px * var(--dshp-ps));border-radius:calc(8px * var(--dshp-ps));
  padding:calc(3px * var(--dshp-ps)) calc(9px * var(--dshp-ps));cursor:pointer;transition:background .12s}
.dshp-chip:hover{background:rgba(124,92,255,.12)}
.dshp-chip.dshp-on{background:var(--dshp-accent);color:#fff;border-color:transparent}
.dshp-chip.dshp-dead{opacity:.38;cursor:not-allowed}
.dshp-now{opacity:.75;margin:0 0 8px;padding:5px 8px;border-radius:8px;
  background:rgba(124,92,255,.09);white-space:normal}
.dshp-hint{opacity:.5;font-size:calc(10.5px * var(--dshp-ps));margin-top:calc(6px * var(--dshp-ps));line-height:1.5;white-space:pre-wrap}
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

  // ——————————————————————————————————————————————————————————————
  // 三、小工具
  // ——————————————————————————————————————————————————————————————

  const $ = (tag, cls, text) => {
    const el = document.createElement(tag)
    if (cls) el.className = cls
    if (text != null) el.textContent = text
    return el
  }
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
  function icon(name) {
    const wrap = $('span', 'dshp-icon-svg')
    wrap.innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
      `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`
    return wrap
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = src
      s.async = false
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('无法加载 ' + src))
      document.head.appendChild(s)
    })
  }

  function readLayout() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}
    } catch (e) {
      return {}
    }
  }
  function saveLayout(patch) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(Object.assign(readLayout(), patch)))
    } catch (e) {}
  }

  // ——————————————————————————————————————————————————————————————
  // 四、状态
  // ——————————————————————————————————————————————————————————————

  let app = null
  let model = null
  let manifest = null
  let coreModel = null
  let ui = null

  /** 表情名 → 参数增量表（已过滤掉模型里不存在的参数） */
  const EXPR = {}
  /** 最近一次取景结果，供诊断用 */
  let lastView = null
  /** 角色实体在模型画布里的归一化范围，启动时测一次；null = 没测出来（退回整张画布） */
  let contentBox = null
  /** 模型真实存在的参数 id 集合 */
  let MODEL_PARAMS = new Set()
  /** 被过滤掉的参数，启动时打一条日志，方便排查 */
  const droppedParams = new Set()

  /**
   * 状态模型（这一版的核心）。
   *
   * 之前最大的问题是「特效会卡住」：摸头/工具/完成每次都 setMood 一下，那张脸就一直
   * 挂在那儿，等下一个事件来覆盖——叠几次之后就永远停在错的状态上，很多表情也再也
   * 用不出来。根因是「谁都没有责任去清理」。
   *
   * 现在拆成三层，各自职责单一，谁都不会赖着不走：
   *
   *   base      由 agent 状态决定（待机/思考/干活/出错…），是「此刻本该是什么样」
   *   override  一次性反应（摸头、点击、特效、工具瞬时反馈）——**强制带时限**，到期自动消失
   *   user      主人手动选的脸/道具，也带时限；真实事件可以立刻夺回
   *
   * 每帧解析：face = override（未过期）> user（未过期）> base。
   * 「特效做完回不去」在结构上就不会发生——没有任何一处需要「记得清理」。
   */
  const rig = {
    /** 当前真实生效的脸（表达式名或 null） */
    face: null,
    /** 当前真实生效的道具集合（表达式名） */
    props: new Set(),
    weight: new Map(),
    talking: false,
    talkPhase: 0,
    /** 底层状态：由 agent 状态机维护 */
    base: { mood: 'neutral', face: null, props: [] },
    /** 一次性反应，一定带 until */
    override: null,
    /** 主人手动的（带时限） */
    user: { face: null, until: 0 },
    /** 主人自己戴的粘性道具（不限期，他自己摘） */
    userProps: new Set(),
    /** 一次性的参数脉冲（爱心粒子之类），到期自动停 */
    burst: null,
  }
  let mood = 'neutral'

  /**
   * applyRig() 每帧（20-30Hz，永远在跑）都要用到的临时容器，挪到外面按帧复用。
   * 原来是 `new Map()`/`new Set()` 写在函数体里，哪怕待机没有任何表情变化
   * 也要照样分配、当帧就丢——纯粹的 GC 压力。空闲时这三个容器基本是空的，
   * `.clear()` 比重新分配便宜得多。
   */
  const rigTargets = new Map()
  const rigDelta = new Map()
  const rigClaimed = new Set()

  /** 情绪名 → 表达式名（不在 EXPR 里的会被过滤掉） */
  function moodFace(name) {
    if (name == null) return null
    const f = MOOD_FACE[name] !== undefined ? MOOD_FACE[name] : name
    return f && f in EXPR ? f : null
  }
  /** 道具 key 或表达式名 → 表达式名 */
  function propExpr(key) {
    if (!key) return null
    const e = ALL_TOGGLES[key] ? ALL_TOGGLES[key].expr : key
    return e && EXPR[e] ? e : null
  }

  /** 把三层解析成「这一刻真正该显示什么」。改动状态后调用，或者每帧调用（很便宜）。 */
  function resolveRig() {
    const now = performance.now()
    if (rig.override && now >= rig.override.until) rig.override = null
    if (rig.user.face && now >= rig.user.until) rig.user.face = null

    const ov = rig.override
    const face = ov && ov.face !== undefined ? ov.face : rig.user.face || rig.base.face || null
    rig.face = face && face in EXPR ? face : null

    const props = new Set()
    for (const p of rig.userProps) props.add(p) // 主人自己戴的装饰品一直都在
    if (!ov || !ov.exclusive) for (const p of rig.base.props) props.add(p)
    if (ov) for (const p of ov.props) props.add(p)
    rig.props = props
    mood = (ov && ov.mood) || rig.base.mood || 'neutral'
  }

  /**
   * 设置底层状态。agent 状态机用它：待机 / 思考 / 干活 / 出错 / 完成…
   * @param name 情绪名
   * @param propKeys 该状态下常驻的道具（道具 key 或表达式名）
   */
  function setBase(name, propKeys) {
    rig.base = {
      mood: name || 'neutral',
      face: moodFace(name),
      props: (propKeys || []).map(propExpr).filter(Boolean),
    }
    resolveRig()
  }

  /**
   * 一次性反应。**一定会过期**——这是「特效不卡住」的保证。
   * 新的反应会直接顶掉旧的（主人说的「任何下一层东西覆盖前一个」）。
   */
  function setReaction(opts) {
    opts = opts || {}
    // mood 和 face 都没给 = 只临时加道具，不动脸
    const face =
      opts.face !== undefined ? opts.face : opts.mood !== undefined ? moodFace(opts.mood) : undefined
    rig.override = {
      mood: opts.mood || null,
      face: face === undefined ? undefined : face,
      props: (opts.props || []).map(propExpr).filter(Boolean),
      // exclusive：连「常态道具」（本子/笔）也暂时放下——主人要的是「砸的时候就只砸一下」
      exclusive: opts.exclusive === true,
      until: performance.now() + (opts.ms || 3200),
    }
    resolveRig()
  }

  /** 立刻撤掉一次性反应，回到 base（切模式、下一层事件来时用）。 */
  function clearReaction() {
    if (!rig.override) return
    rig.override = null
    resolveRig()
  }

  /** 主人手动选的脸，30 秒；期间待机不会抢，但真实事件会。 */
  function setUserFace(name) {
    rig.user = { face: moodFace(name), until: performance.now() + 30000 }
    resolveRig()
  }

  /** 主人手动选「平常」= 立刻交还给她自己。 */
  function clearUserFace() {
    rig.user = { face: null, until: 0 }
    clearReaction()
  }

  /**
   * 某一件「摆设/装饰」现在是开着的吗？
   * 手机是个例外——它不是一个表情参数，而是 `device.out`（模型自带的
   * 开盖动作把小设备掏出来），所以单独判。
   */
  function itemOn(key, def) {
    const d = def || ALL_TOGGLES[key]
    if (!d) return false
    if (d.device) return device.out
    return !!d.expr && rig.userProps.has(d.expr)
  }

  /** 把小设备（手机）掏出来——这就是原作者「自拍手机」那个动作。 */
  function takeDeviceOut() {
    if (device.out) return
    device.out = true
    playMotion('openLid')
  }

  function setProp(key, on) {
    const def = ALL_TOGGLES[key]
    // 手机：走模型自带的开盖动作，不走表情参数
    if (def && def.device) {
      if (on) takeDeviceOut()
      else putDeviceAway()
      // 手机收起来时，它的换色也该跟着走
      if (!on) {
        for (const [k, v] of Object.entries(ALL_TOGGLES)) {
          if (v.needs === key && v.expr) rig.userProps.delete(v.expr)
        }
      }
      resolveRig()
      saveLayout({ props: Array.from(rig.userProps) })
      return
    }
    const expr = propExpr(key)
    if (!expr) return
    if (on) {
      if (def && def.group) {
        for (const [k, v] of Object.entries(ALL_TOGGLES)) {
          if (v.group === def.group && k !== key && v.expr) rig.userProps.delete(v.expr)
        }
      }
      // 前置依赖。两种：
      //   · 参数型（白魔爪 → 粉魔爪）：直接把前置的表情加上
      //   · 设备型（手机换色 → 掏出手机）：把手机掏出来
      // 这都是原作者的设计（*+5「魔爪变白」必须在粉魔爪模式下用）。
      if (def && def.needs) {
        const needDef = ALL_TOGGLES[def.needs]
        if (needDef && needDef.device) takeDeviceOut()
        else {
          const needExpr = propExpr(def.needs)
          if (needExpr) rig.userProps.add(needExpr)
        }
      }
      // 反过来：开「粉魔爪」要把换色摘掉，不然还是白的
      if (def && def.clears) {
        for (const k of def.clears) {
          const e2 = propExpr(k)
          if (e2) rig.userProps.delete(e2)
        }
      }
      rig.userProps.add(expr)
    } else {
      rig.userProps.delete(expr)
      // 摘掉「魔爪」时，它的换色也该跟着走，不然会留下一层颜色
      for (const [k, v] of Object.entries(ALL_TOGGLES)) {
        if (v.needs === key && v.expr) rig.userProps.delete(v.expr)
      }
    }
    resolveRig()
    saveLayout({ props: Array.from(rig.userProps) })
  }

  function clearProps() {
    rig.userProps.clear()
    resolveRig()
    saveLayout({ props: [] })
  }

  function restoreProps() {
    const saved = readLayout().props
    if (!Array.isArray(saved)) return
    for (const expr of saved) if (EXPR[expr]) rig.userProps.add(expr)
    resolveRig()
  }

  /** 当前参与施加的表达式集合（含正在淡出的）。过期与否已由 resolveRig 决定。 */
  function currentExpressions() {
    const out = new Set()
    if (rig.face) out.add(rig.face)
    for (const name of rig.props) out.add(name)
    for (const name of rig.weight.keys()) out.add(name)
    return out
  }

  /**
   * rig 本体：挂在 beforeModelUpdate 上。
   * 每帧先 resolveRig() 把三层解析成「这一刻该显示什么」——
   * 所以一次性反应一过期，对应的参数立刻进入淡出，不需要任何人来清理。
   */
  function applyRig() {
    if (!coreModel) return
    resolveRig()
    const now = performance.now()
    const dt = Math.min(64, now - (applyRig._last || now)) / 1000
    applyRig._last = now

    const targets = rigTargets
    targets.clear()
    if (rig.face) targets.set(rig.face, 1)
    for (const name of rig.props) targets.set(name, 1)

    // 权重推进：进得慢一点、退得快一点，观感更像「变脸」而不是硬切
    for (const name of Array.from(rig.weight.keys())) {
      const target = targets.get(name) || 0
      let w = rig.weight.get(name) || 0
      const speed = target > w ? 7 : 11
      w += (target - w) * clamp(dt * speed, 0, 1)
      if (target === 0 && w < 0.02) rig.weight.delete(name)
      else rig.weight.set(name, w)
    }
    for (const name of targets.keys()) {
      if (!rig.weight.has(name)) rig.weight.set(name, 0)
    }

    // —— 参数独占 ——
    // 主人要求「每次脸上只能有一个表情，不能两个表情叠在一起」。
    // 光靠「一个 face + 若干道具」还不够：有些道具本身也写脸部参数
    // （比如墨镜会写 ParamEyeLOpen），叠上去就会打架。
    // 所以这里做一个裁决：每个参数在同一时刻只允许**一个**表达式写，
    // 优先级 脸 > 道具（按加入顺序）。
    const delta = rigDelta
    const claimed = rigClaimed
    delta.clear()
    claimed.clear()
    let skipped = 0
    const add = (id, v) => delta.set(id, (delta.get(id) || 0) + v)
    const winners = []
    if (rig.face && (rig.weight.get(rig.face) || 0) > 0) winners.push(rig.face)
    for (const name of rig.props) if (name !== rig.face && (rig.weight.get(name) || 0) > 0) winners.push(name)
    for (const name of winners) {
      const w = rig.weight.get(name) || 0
      const params = EXPR[name]
      if (!params) continue
      for (const p of params) {
        if (claimed.has(p.id)) {
          skipped++ // 这个参数已经被更高优先级的表情写了
          continue
        }
        claimed.add(p.id)
        add(p.id, p.value * w)
      }
    }
    // 正在淡出的表情不参与裁决，权重照常推进（它们本来就没抢到参数）
    for (const name of rig.weight.keys()) {
      if (winners.indexOf(name) >= 0) continue
      const w = rig.weight.get(name) || 0
      const params = EXPR[name]
      if (!params || w <= 0) continue
      for (const p of params) {
        if (claimed.has(p.id)) continue
        claimed.add(p.id)
        add(p.id, p.value * w)
      }
    }

    // 说话口型：只在真的在吐字时才动嘴，空闲时嘴巴是放松的
    if (CFG.talkMouth && rig.talking) {
      rig.talkPhase += dt
      add('ParamMouthOpenY', 0.28 + 0.16 * Math.sin(rig.talkPhase * 11))
    }

    // 一次性参数脉冲（爱心粒子 / 心跳），到期自动停
    if (rig.burst) {
      if (performance.now() > rig.burst.until) rig.burst = null
      else {
        if (rig.burst.love) add('love', rig.burst.love)
        if (rig.burst.heartbeat) add('ParamCheek73', rig.burst.heartbeat)
      }
    }

    // —— 眨眼（自然节奏，见 blinkTick）——
    blinkTick(now, claimed.has('ParamEyeLOpen') || claimed.has('ParamEyeROpen'), motionActive())

    // —— 眼睛自愈 ——
    // 万一还有哪条路径把「睁眼」参数冻在 0（闭眼），这里把它纠回来。
    // 只在「没有动作在播 + 我们自己的表情/道具都没认领眼睛参数 + 已经闭了 1.5 秒以上」时才动手，
    // 所以不会跟眨眼（一次 0.1 秒）、也不会跟「闭眼口水」这种真的闭眼表情打架。
    if (coreModel && model && !rig.eyesHeal) rig.eyesHeal = { since: 0, warned: false }
    if (rig.eyesHeal) {
      const eL = 'ParamEyeLOpen'
      const eR = 'ParamEyeROpen'
      const claimedEye = claimed.has(eL) || claimed.has(eR)
      const motionOn = motionActive()
      const v = eyesOpen()
      if (!claimedEye && !motionOn && v !== null && v < 0.25) {
        if (!rig.eyesHeal.since) rig.eyesHeal.since = now
        else if (now - rig.eyesHeal.since > 1500) {
          for (const id of [eL, eR]) {
            const d = paramDefault(id)
            if (d !== null) {
              try {
                coreModel.setParameterValueById(id, d)
              } catch (e) {}
            }
          }
          try {
            coreModel.saveParameters()
          } catch (e) {}
          rig.eyesHeal.since = 0
          if (!rig.eyesHeal.warned) {
            rig.eyesHeal.warned = true
            log('检测到眼睛被冻住，已按默认值纠回（自愈）')
          }
        }
      } else {
        rig.eyesHeal.since = 0
      }
    }

    // 诊断：这一帧有多少次「因为参数已被占用而放弃写入」。
    // 它 > 0 就说明独占裁决真的在起作用（两个表情想写同一个参数时被打回）。
    rig.exclusive = { written: delta.size, skipped, writers: winners }
    for (const [id, v] of delta) {
      if (Math.abs(v) < 0.001) continue
      try {
        coreModel.addParameterValueById(id, v)
      } catch (e) {}
    }
  }

  /**
   * 任何路径都不许再播的动作。
   *   bubble   —— 主人点名踢掉（老会卡住）
   *   aidale   —— 「伸展」，内部驱动 15 个表情参数，一播就多个表情同时亮
   *   selfie*  —— 同上，自带 10 个表情参数
   */
  const FACE_DRIVING_MOTIONS = new Set(['bubble', 'aidale', 'selfie', 'selfieQuick'])
  const BANNED_MOTIONS = FACE_DRIVING_MOTIONS

  /**
   * 动作是否正在播。
   * 不用框架的 `motionManager.isFinished()` —— 实测它空闲时也返回「没结束」，
   * 会让「动作期间不眨眼」永远成立（之前眨眼就是这么被憋住的）。
   * 改成我们自己记账：起动作时按清单里的时长记一个截止时间。
   */
  let motionUntil = 0
  function motionActive() {
    return performance.now() < motionUntil
  }

  function playMotion(group, priority) {
    if (!model || !manifest) return
    if (BANNED_MOTIONS.has(group)) return
    if (!manifest.motions || !manifest.motions[group]) {
      log('没有这个动作：', group)
      return
    }
    const dur = Number(manifest.motions[group].duration) || 1.5
    motionUntil = performance.now() + dur * 1000 + 120
    try {
      // 第三参是优先级（数字）：FORCE 才能盖过常驻待机循环
      model.motion(group, 0, priority == null ? MOTION_PRIORITY.FORCE : priority)
    } catch (e) {
      console.warn('[鲸鱼娘] 动作播放失败', group, e)
    }
  }

  // ——————————————————————————————————————————————————————————————
  // 四·五、表演调度器（所有「一次性反应」的唯一入口）
  // ——————————————————————————————————————————————————————————————

  /** 当前正在进行的「一次性表演」。任何时刻最多一个。 */
  let acting = null
  let motionTimer = null

  /**
   * 停掉当前表演：取消一次性表情、爱心脉冲、一次性动作，
   * 回到「底层状态 + 常驻待机动作」——主人说的「先变回平常状态」。
   */
  function stopActing() {
    acting = null
    if (motionTimer) {
      clearTimeout(motionTimer)
      motionTimer = null
    }
    rig.override = null
    rig.burst = null
    resolveRig()
    // 把所有动作停掉，回到模型的**默认姿势**（配合物理/呼吸/眨眼就是「正常坐姿」）。
    //
    // 这里**不再播 motions/idle.motion3.json**：那套资产里的 "idle" 其实是
    // 猫爪摆动 + 爱心粒子的循环动画（89 条曲线里 maoshou*/j* 就是它们），
    // 一直循环会让人看到「手在这摆」和「一长串莫名的待机动作」。
    //
    // 例外：干活时如果小设备已经掏出来了（查资料），别把它收掉——
    // 互动只是插一下，互动完要回到「正在查资料」的样子。
    if (!device.out) stopMotion()
  }

  /**
   * 把所有「动作会写的参数」复位到模型默认值，并重存一次框架的参数快照。
   *
   * 为什么必须手动做（踩了很久才查明白）：pixi-live2d-display 每帧的顺序是
   *     动作写入 → saveParameters() 存快照 → 眨眼/视线/呼吸/物理 → beforeModelUpdate(我们的 rig)
   *     → coreModel.update() → loadParameters() 把快照装回来
   * 也就是说**快照是在动作写入之后存的**。动作一旦停下，快照里留的就是它最后一帧的姿势，
   * 而 loadParameters() 每帧都会把这份姿势装回来 —— 表现就是主人报的
   * 「蛋包饭点过以后永远挂在桌上、手机收不回去、表情也回不去，连一键重置都没用」。
   * 所以停动作时要做两件事：① 把这些参数设回默认值 ② 重新 save 一次，把快照换成默认姿势。
   */
  function clearMotionPose() {
    if (!coreModel || !manifest) return 0
    const ids = new Set()
    for (const meta of Object.values(manifest.motions || {})) {
      for (const id of meta.params || []) ids.add(id)
    }
    let n = 0
    let bad = 0
    for (const id of ids) {
      try {
        const def = paramDefault(id)
        // 取不到默认值的参数一律**不要碰**！之前就是在这里把「睁眼」参数当成了 0，
        // 结果把眼睛永久设成闭着的（主人报的「一直闭着眼，啥也干不了」）。
        if (def === null) { bad++; continue }
        if (typeof coreModel.setParameterValueById === 'function') coreModel.setParameterValueById(id, def)
        n++
      } catch (e) {}
    }
    if (bad && !clearMotionPose._warned) {
      clearMotionPose._warned = true
      log(`有 ${bad} 个动作参数取不到默认值，已跳过（绝不猜 0）`)
    }
    try {
      if (typeof coreModel.saveParameters === 'function') coreModel.saveParameters()
    } catch (e) {}
    return n
  }

  /**
   * 眨眼控制器。
   *
   * 主人要求：「不要眨太快、不要眨太慢，符合正常人眨眼速度，偶尔眨一眨」。
   * 人类大概是每 3~5 秒眨一次，单次 0.1~0.2 秒，偶尔会连眨两下。
   * 框架自带的实现是「下次眨眼 = random × 7 秒」，范围太野，所以这里自己来：
   *   · 间隔：2.6~5.4 秒随机；15% 概率紧接着再眨一下（连眨）
   *   · 单次时长：闭合 60ms + 闭合保持 30ms + 睁开 100ms ≈ 0.19 秒
   *   · 动作在播、或者有表情/道具正在写眼睛参数（比如「闭眼口水」）时**不眨**
   */
  const blink = { nextAt: 0, phase: 'idle', t0: 0, queue: 0, gate: '', count: 0 }

  function blinkTick(now, eyeClaimed, motionOn) {
    if (!coreModel) { blink.gate = 'no-model'; return }
    if (eyeClaimed || motionOn) {
      blink.gate = eyeClaimed ? 'eye-claimed' : 'motion-on'
      blink.phase = 'idle'
      blink.nextAt = now + 1200
      return
    }
    blink.gate = 'ok'
    const set = (v) => {
      try {
        coreModel.setParameterValueById('ParamEyeLOpen', v)
        coreModel.setParameterValueById('ParamEyeROpen', v)
      } catch (e) {}
    }
    const CLOSE = 60
    const HOLD = 30
    const OPEN = 100
    if (blink.phase === 'idle') {
      if (!blink.nextAt) blink.nextAt = now + 900 + Math.random() * 2600
      if (now >= blink.nextAt) {
        blink.phase = 'closing'
        blink.t0 = now
        blink.count++
        blink.queue = Math.random() < 0.15 ? 1 : 0 // 偶尔连眨两下
      } else {
        return
      }
    }
    const dt = now - blink.t0
    if (blink.phase === 'closing') {
      set(1 - Math.min(1, dt / CLOSE))
      if (dt >= CLOSE) {
        blink.phase = 'closed'
        blink.t0 = now
      }
    } else if (blink.phase === 'closed') {
      set(0)
      if (dt >= HOLD) {
        blink.phase = 'opening'
        blink.t0 = now
      }
    } else if (blink.phase === 'opening') {
      set(Math.min(1, dt / OPEN))
      if (dt >= OPEN) {
        blink.phase = 'idle'
        if (blink.queue > 0) {
          blink.queue = 0
          blink.nextAt = now + 180 // 连眨：紧接着再来一下
        } else {
          blink.nextAt = now + 2600 + Math.random() * 2800
        }
      }
    }
  }

  /**
   * 取某个参数的默认值。**框架的 getParameterDefaultValue 收的是「下标」不是 id**，
   * 传 id 会拿到 undefined —— 若拿不到就返回 null，调用方必须跳过这个参数，
   * 绝不能拿 0 当默认值（会把「睁眼」写成「闭眼」，就是那次事故）。
   */
  function paramDefault(id) {
    if (!coreModel) return null
    try {
      const idx = typeof coreModel.getParameterIndex === 'function' ? coreModel.getParameterIndex(id) : -1
      if (typeof idx !== 'number' || idx < 0) return null
      if (typeof coreModel.getParameterDefaultValue !== 'function') return null
      const d = coreModel.getParameterDefaultValue(idx)
      if (typeof d !== 'number' || !Number.isFinite(d)) return null
      return d
    } catch (e) {
      return null
    }
  }

  function paramValue(id) {
    if (!coreModel) return null
    try {
      const v = coreModel.getParameterValueById(id)
      return typeof v === 'number' && Number.isFinite(v) ? v : null
    } catch (e) {
      return null
    }
  }

  /** 眼睛当前睁着没：0 = 闭，1 = 睁（返回两只眼的平均值，方便诊断与自愈） */
  function eyesOpen() {
    const l = paramValue('ParamEyeLOpen')
    const r = paramValue('ParamEyeROpen')
    if (l === null && r === null) return null
    const vals = [l, r].filter((v) => v !== null)
    return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3)
  }

  /** 停掉所有正在播的动作，让模型回到默认姿势。 */
  function stopMotion() {
    motionUntil = 0
    try {
      const mm = model && model.internalModel && model.internalModel.motionManager
      if (mm && typeof mm.stopAllMotions === 'function') mm.stopAllMotions()
    } catch (e) {}
    // 光停动作不够：还得把「动作留下的姿势」从参数快照里清掉，否则它会永远挂着
    clearMotionPose()
  }

  /** 一次性动作：到点自己回到常驻待机（动作也是一次只能一个）。 */
  function playOneShot(group) {
    if (!manifest || !manifest.motions || !manifest.motions[group]) return
    const durS = Number(manifest.motions[group].duration) || 2
    stopMotion() // 先清干净，再起新的——动作永远只有一个
    playMotion(group, MOTION_PRIORITY.FORCE)
    if (motionTimer) clearTimeout(motionTimer)
    // 到点一定收掉——不管模型里那个动作自己是不是 Loop=true。
    // （aidale / idle 这些资产内部写着循环，不主动停就会一直播下去。）
    motionTimer = setTimeout(() => {
      motionTimer = null
      if (!device.out) stopMotion()
    }, Math.round(durS * 1000) + 150)
  }

  /**
   * 起一次表演。**所有一次性反应都必须走这里，没有例外。**
   *
   * 铁律（主人反复强调的）：
   *   1. 先把上一次整个停掉、回到平常状态，**再**开始新的 —— 所以永远不会重叠
   *   2. 一次表演 = 一个面部表情 + 至多一个动作 + 至多一个粒子特效
   *   3. 待机表演只在真正空闲时才会被调用；有任务时只有任务表演
   *   4. 永久禁用：吹泡泡糖、大锤砸、呆呆眼（见 BANNED_MOTIONS / MOOD_FACE）
   */
  function act(spec) {
    spec = spec || {}
    stopActing() // ← 关键：先归零，再开始
    const ms = spec.ms || 2600
    setReaction({
      mood: spec.mood,
      face: spec.face,
      props: spec.props,
      exclusive: spec.exclusive,
      ms,
    })
    if (spec.line) ui.bubble.show(spec.line, { name: 'DS 鲸鱼娘', ttl: Math.max(ms, 1800) })
    if (spec.motion) {
      playOneShot(spec.motion)
      // 只有**真的做动作**时才暂时不盯鼠标；单纯换个表情不该把视线也停掉，
      // 否则待机每隔几秒来一次，她大部分时间都不看主人了。
      gazeDetach(Math.max(2200, ms))
    }
    if (spec.heart) heartBurst(ms)
    acting = { until: performance.now() + ms }
    return ms
  }

  // ——————————————————————————————————————————————————————————————
  // 五、启动
  // ——————————————————————————————————————————————————————————————

  async function main() {
    // buildUI 以前在 try 外面——它一旦抛异常，整页会静默什么都不显示，
    // 排查很痛苦。现在整个启动过程都在保护里，并且把错误挂到 window 上。
    try {
      injectStyle()
      ui = buildUI()
      await loadRuntime()
      const [man, cdi] = await Promise.all([
        fetch(BASE + '/model/manifest.json', { cache: 'no-cache' }).then((r) => r.json()),
        fetch(BASE + '/model/c_0120.cdi3.json', { cache: 'no-cache' }).then((r) => r.json()),
      ])
      manifest = man
      MODEL_PARAMS = new Set((cdi.Parameters || []).map((p) => p.Id))
      for (const [name, e] of Object.entries(manifest.expressions || {})) {
        const kept = []
        for (const p of e.params || []) {
          if (MODEL_PARAMS.has(p.id)) kept.push(p)
          else droppedParams.add(name + ' → ' + p.id)
        }
        if (kept.length) EXPR[name] = kept
      }
      if (droppedParams.size) {
        log(`已忽略 ${droppedParams.size} 个模型里不存在的参数引用：`, Array.from(droppedParams).join('、'))
      }
      await buildModel()
      wireInteractions()
      connectSSE()
      startLoops()
      log(
        `就绪：${manifest.displayName} · 动作 ${Object.keys(manifest.motions || {}).length} 个 · 可用表情 ${Object.keys(EXPR).length} 个`,
      )
    } catch (err) {
      window.__DSHPetError = String((err && err.stack) || err)
      console.error('[鲸鱼娘] 启动失败：', err)
      try {
        ui = ui || {}
        if (ui.bubble) {
          ui.bubble.show('启动失败：' + (err && err.message ? err.message : err), {
            name: '出错了',
            sticky: true,
          })
        }
      } catch (e) {}
    }
  }

  function injectStyle() {
    if (document.getElementById('dsh-live2d-pet-style')) return
    const s = document.createElement('style')
    s.id = 'dsh-live2d-pet-style'
    s.textContent = PET_CSS
    document.head.appendChild(s)
  }

  async function loadRuntime() {
    if (!window.Live2DCubismCore) await loadScript(BASE + '/vendor/live2dcubismcore.min.js')
    if (!window.PIXI) await loadScript(BASE + '/vendor/pixi.min.js')
    if (!window.PIXI || !window.PIXI.live2d) await loadScript(BASE + '/vendor/cubism4.min.js')
    if (!window.PIXI || !window.PIXI.live2d) throw new Error('Live2D 运行时未就绪')
  }

  /**
   * 性能档。
   *
   * 为什么要有：桌面壳（Mac 原生 App）为了不让她卡住，阻止了 macOS 的 App Nap，
   * 于是**永远满帧渲染** —— 浏览器里标签页不聚焦会自动降频，壳子里不会，
   * 所以主人在壳子里觉得电脑又热又卡。
   *
   * 低性能模式：帧率 20、渲染分辨率 1 倍、去掉自言自语和自主动作，
   * 只留眨眼 + 轻微摆动 + 视线；只有点她才会动。
   */
  const PERF = { low: false }

  function applyPerf() {
    if (app) {
      app.ticker.maxFPS = PERF.low ? 20 : 30
      const want = PERF.low ? 1 : Math.min(window.devicePixelRatio || 1, 1.5)
      try {
        if (app.renderer.resolution !== want) {
          const w = app.renderer.width
          const h = app.renderer.height
          app.renderer.resolution = want
          app.renderer.resize(w, h)
        }
      } catch (err) {}
    }
    try {
      document.body.classList.toggle('dshp-lowpower', PERF.low)
    } catch (err) {}
  }

  /** 壳子/设置页调它切档；返回当前档位方便确认 */
  function setLowPower(on) {
    PERF.low = !!on
    applyPerf()
    log('性能档：' + (PERF.low ? '低性能（少动、省电、20 帧）' : '标准（30 帧）'))
    return PERF.low
  }

  async function buildModel() {
    const layout = readLayout()

    app = new PIXI.Application({
      width: 8,
      height: 8,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      // 掩码要读画布像素，没有 preserveDrawingBuffer 的话读到的是被清空后的缓冲
      preserveDrawingBuffer: true,
      resolution: Math.min(window.devicePixelRatio || 1, PERF.low ? 1 : 1.5),
      powerPreference: 'low-power',
    })
    // 这个模型 30 帧已经足够顺；60 帧纯粹是白烧 CPU/GPU（主人反馈电脑发热、发卡）
    app.ticker.maxFPS = PERF.low ? 20 : 30
    applyPerf()
    ui.stage.appendChild(app.view)

    const { Live2DModel } = PIXI.live2d
    Live2DModel.registerTicker(PIXI.Ticker)

    model = await Live2DModel.from(BASE + '/model/c_0120.model3.json', {
      autoInteract: false,
      autoUpdate: true,
      idleMotionGroup: 'idle',
    })
    model.eventMode = 'none'
    app.stage.addChild(model)

    const internal = model.internalModel
    coreModel = internal.coreModel

    // rig 挂载点：model.update() 之前的最后一站
    internal.on('beforeModelUpdate', applyRig)

    // 关掉框架自带的眨眼，改用我们自己的 blinkTick（节奏更像人）
    try {
      if (internal.eyeBlink) internal.eyeBlink = undefined
    } catch (e) {}


    // 掩码在 postrender 里采：此刻 WebGL 缓冲刚画好，且模型的世界变换已生效。
    // 必须在测量之前注册——测量就是靠它把画面读出来算实体范围的。
    app.renderer.on('postrender', () => {
      if (mask.dirty && !mask.building) buildMask()
    })

    const box = await fitFromMeasurement()
    applyPosition(layout)
    restoreProps()
    // 待机底层状态：平常脸 + 拿板子待着
    setBase('neutral', IDLE_PROPS)

    document.addEventListener('visibilitychange', () => {
      if (!app) return
      if (document.hidden) app.ticker.stop()
      else app.ticker.start()
    })

    log(
      `模型原始尺寸 ${Math.round(internal.originalWidth)}×${Math.round(internal.originalHeight)}` +
        (box ? ` · 布局 ${box.w}×${box.h}（${box.mode}，缩放 ${box.scale}）` : ''),
    )
  }

  /**
   * 正在拖「大小」滑块。为 true 时 fitModel 不去改 --dshp-s/--dshp-ps——
   * 否则轨道会随着面板变宽而移动，变成「怎么拖都追不上」。
   */
  let sizingSize = false

  /**
   * 把面板夹回视口内。
   *
   * 主人抱怨菜单「不太好用」——桌宠默认蹲在右下角，面板又是以模型为中心
   * 左右展开的，于是右边那一截（包括关闭按钮和滑块的右半段）直接跑到屏幕外，
   * 点都点不到。这里量一下真实位置，用一个横向偏移把它推回来。
   */
  /**
   * 面板往哪边展开 —— **纯计算，不「量了再挪」**。
   *
   * 主人报的问题：「弹窗一次往左一次往右，靠墙那次还会卡进墙里一半」。
   * 根因是旧写法：先把位移清零、量面板位置、再据此设位移，而位移本身带过渡动画，
   * 量到动画中间态就会一次算左一次算右，来回翻。
   * 现在只看一件事：桌宠在屏幕的左半边还是右半边 ——
   *   · 在左半边（左边是墙）→ 面板往**右**开
   *   · 在右半边（右边是墙）→ 面板往**左**开
   * 然后兜底夹进视口，保证整个面板（含右上角的 ×）都在屏幕里。
   */
  /**
   * 她脑袋在屏幕上的横坐标。
   * 主人要的是「聊天框放在正头顶」，而桌宠的根节点包含整张书桌场景，
   * 根节点中心 ≠ 脑袋中心，所以这里用测量出来的「头部重心」换算成屏幕坐标。
   */
  function headScreenX() {
    const r = ui.root.getBoundingClientRect()
    try {
      const b = contentBox && contentBox.bands
      const head = b && b.head && b.head.center
      const view = b && b.full && b.full.center
      if (typeof head === 'number' && typeof view === 'number' && lastView && model) {
        const baseW = model.internalModel.width || model.internalModel.originalWidth || 0
        const dx = (head - view) * baseW * (lastView.scale || 0)
        if (Number.isFinite(dx) && Math.abs(dx) < r.width) return r.left + r.width / 2 + dx
      }
    } catch (e) {}
    return r.left + r.width / 2
  }

  /**
   * 气泡/面板/HUD 全都必须整个待在 DSH app 自己的窗口里——不管是网页版的
   * 浏览器视口，还是桌面壳那个固定尺寸（560×900）的透明覆盖窗口，`window.innerWidth/
   * innerHeight` 在两种情况下都正好等于「这个 app 能画画的地方」，所以只要
   * 面板的四条边都夹在 `[pad, vw/vh - pad]` 里，就一定没有超出 app 本身。
   *
   * 光「横向夹+纵向推」不够：面板默认长在她头顶上方，桌面壳窗口特地留高
   * 就是为了给这个上方留白。可她现在能贴死在顶部角落了（EDGE_GAP 几乎到顶），
   * 头顶就没有留白可言——硬推的话面板会被压扁/顶穿窗口顶边。真正靠谱的做法
   * 是「翻转」：上面放不下、下面比上面宽裕，就整个翻到脚下去（CSS 见
   * `.dshp-flip`），而不是在放不下的地方硬挤。
   */
  function placePanel(panel) {
    if (!panel) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pad = 10
    panel.style.setProperty('--dshp-shift', '0px')
    panel.style.setProperty('--dshp-shift-y', '0px')
    panel.classList.remove('dshp-flip')
    if (!panel.classList.contains('dshp-on')) return
    const w = panel.getBoundingClientRect().width || 0
    const h = panel.getBoundingClientRect().height || 0
    if (!w) return
    const r = ui.root.getBoundingClientRect()
    const anchor = headScreenX() // 对准头顶，而不是整个场景的中心
    // 面板基准是「以桌宠中心居中」（left:50% + translateX(-50%)），所以位移 = 锚点 - 根节点中心
    let shift = anchor - (r.left + r.width / 2)
    // 靠墙时往反方向挪，保证整个面板（含 × ）都在屏幕里
    const left = anchor + shift - w / 2
    if (left < pad) shift += pad - left
    else if (left + w > vw - pad) shift -= left + w - (vw - pad)
    panel.style.setProperty('--dshp-shift', Math.round(shift) + 'px')

    // 纵向：默认贴头顶上方；上面的空间不够放、下面比上面宽裕，就整个翻下去
    const spaceAbove = r.top
    const spaceBelow = vh - r.bottom
    const flip = spaceAbove < h + pad && spaceBelow > spaceAbove
    panel.classList.toggle('dshp-flip', flip)
    if (flip) {
      const bottom = panel.getBoundingClientRect().bottom
      panel.style.setProperty('--dshp-shift-y', bottom > vh - pad ? Math.round(vh - pad - bottom) + 'px' : '0px')
    } else {
      const top = panel.getBoundingClientRect().top
      panel.style.setProperty('--dshp-shift-y', top < pad ? Math.round(pad - top) + 'px' : '0px')
    }
  }

  function clampPanels() {
    placePanel(ui && ui.menu && ui.menu.el)
    placePanel(ui && ui.composer && ui.composer.el)
    placePanel(ui && ui.hud && ui.hud.el)
    placePanel(ui && ui.bubble && ui.bubble.el)
  }

  function fitModel(explicitHeight) {
    if (!model || !app) return
    const im = model.internalModel
    // 只信 internalModel：Live2DModel 继承 PIXI Container，没有自己的 width 取值器
    const baseW = im.width || im.originalWidth || 1
    const baseH = im.height || im.originalHeight || 1
    const saved = readLayout()
    const wanted = clamp(Number(explicitHeight) || Number(saved.height) || CFG.height, 120, 900)
    // 用户明确要求：一直用「整张桌子」，不做上半身/只有头的取景。
    const mode = 'full'
    const frac = FIT_FRACTION[mode] || 1

    // 角色在画布里的实体范围（归一化）。没测出来就退回整个画布。
    const box = contentBox || { x0: 0, y0: 0, x1: 1, y1: 1, bands: null }
    const ch = Math.max(0.02, box.y1 - box.y0)
    const cw = Math.max(0.02, box.x1 - box.x0)

    // 四周留余量：主人反馈「尾巴被截掉、有些表情出格被掐」。
    // 原因是原来视窗高度**正好等于**实体高度、宽度又按固定宽高比算 ——
    // 横向超出（尾巴、头顶鲸）和纵向超出（举起来的道具、惊讶表情）就都被裁掉了。
    // 现在实体四周各留 PAD，窗口比实体大一圈，她才能完整显示。
    const PAD = 0.1
    const viewHModel = ch * frac * baseH * (1 + PAD * 2)
    // 宽度取「固定宽高比」和「实体宽度 + 余量」里更宽的那个
    const viewWModel = Math.max(viewHModel * VIEW_ASPECT, cw * baseW * (1 + PAD * 2))
    const centerXNorm = box.bands && box.bands[mode] ? box.bands[mode].center : (box.x0 + box.x1) / 2
    const centerXModel = centerXNorm * baseW

    // 缩放按**实体高度**算（不是视窗高度）：加了余量之后她的大小和以前一模一样，
    // 只是周围多出一圈空间。
    let scale = wanted / (ch * frac * baseH)
    const maxW = Math.max(240, window.innerWidth * (CFG.maxWidthRatio || 0.5))
    if (viewWModel * scale > maxW) scale = maxW / viewWModel

    const w = Math.max(40, Math.round(viewWModel * scale))
    const h = Math.max(40, Math.round(viewHModel * scale))

    model.scale.set(scale)
    // 锚点放到左上角：position 就等于「模型画布左上角在容器里的位置」，算起来最直观
    model.anchor.set(0, 0)
    app.renderer.resize(w, h)
    const padYModel = ch * frac * baseH * PAD
    model.position.set(
      -Math.round((centerXModel - viewWModel / 2) * scale),
      -Math.round((box.y0 * baseH - padYModel) * scale),
    )

    ui.stage.style.width = w + 'px'
    ui.stage.style.height = h + 'px'
    ui.root.style.width = w + 'px'
    ui.root.style.height = h + 'px'
    // 气泡/按钮/菜单跟着模型一起缩放，比例才不会走样
    // 例外：正在拖「大小」滑块时**冻住缩放**。否则每拖一格模型就变大一点、
    // 面板跟着变宽一点，滑块轨道从鼠标底下跑掉——主人说的
    // 「滑动的时候很难受，必须点一下设置一个值，不能拖拽」就是这个反馈环。
    if (!sizingSize) {
      const uiScale = clamp(h / UI_BASE_HEIGHT, 0.7, 2.2)
      ui.root.style.setProperty('--dshp-s', uiScale.toFixed(3))
      // 面板自己一套缩放：夹在 0.85~1.15，缩太小就没法操作了
      ui.root.style.setProperty('--dshp-ps', clamp(h / UI_BASE_HEIGHT, 0.85, 1.15).toFixed(3))
    }
    mask.dirty = true
    markStageRectDirty()
    lastView = {
      w,
      h,
      mode,
      scale: Number(scale.toFixed(4)),
      content: {
        x0: +box.x0.toFixed(3),
        y0: +box.y0.toFixed(3),
        x1: +box.x1.toFixed(3),
        y1: +box.y1.toFixed(3),
      },
    }
    return lastView
  }

  /** 先量实体范围，再按它取景；量不出来就退回按整张画布取景。 */
  async function fitFromMeasurement() {
    try {
      const bbox = await measureContent()
      if (bbox && bbox.x1 - bbox.x0 > 0.05 && bbox.y1 - bbox.y0 > 0.05) {
        contentBox = bbox
      } else {
        console.warn('[鲸鱼娘] 实体范围测不出来，按整张画布取景')
      }
    } catch (err) {
      console.warn('[鲸鱼娘] 测量实体范围出错：', err && err.message)
    }
    return fitModel()
  }

  /**
   * 量一次「角色实体在画布里的范围」。
   *
   * 做法：先把模型按固定比例完整铺进一张参考画布（不裁剪），等一帧让 postrender 里的
   * 掩码采样跑完，从掩码里取非透明像素的外接框。因为这个测量是在「完整显示」状态下做的，
   * 得到的归一化比例与后续缩放无关，可以直接拿去算任何取景。
   *
   * 拿不到（隐藏标签页里 rAF 不触发、或者掩码生成失败）就返回 null，调用方退回整个画布。
   */
  async function measureContent() {
    const im = model.internalModel
    const baseW = im.width || im.originalWidth || 1
    const baseH = im.height || im.originalHeight || 1
    const REF = 420
    const s = REF / baseH
    const w = Math.max(16, Math.round(baseW * s))
    const h = REF

    model.scale.set(s)
    model.anchor.set(0, 0)
    app.renderer.resize(w, h)
    model.position.set(0, 0)
    ui.stage.style.width = w + 'px'
    ui.stage.style.height = h + 'px'
    mask.dirty = true
    mask.bbox = null

    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()))
    const deadline = performance.now() + 3000
    while (performance.now() < deadline) {
      await nextFrame()
      if (mask.bbox && !mask.dirty) return Object.assign({}, mask.bbox, { bands: mask.bands })
    }
    return mask.bbox ? Object.assign({}, mask.bbox, { bands: mask.bands }) : null
  }

  /** 贴边的留白（视觉上「贴住」但不顶死） */
  const EDGE_GAP = 10
  /**
   * 贴顶单独留更大的安全距离——DSH 桌面壳/主窗口顶边常有一排自己的控件
   * （缩小/放大/关闭一类），那层东西的 z-index 不一定在这个插件的 DOM 里，
   * 插件这边调不动谁盖谁。干脆贴顶的时候留够，从根上让画面不伸进那一条，
   * 不用去赌层级谁压得过谁。这个数字没法测出精确值（不知道对方控件条多高），
   * 按常见的自绘标题栏高度估的，明显不够或者太空可以再调。
   */
  const EDGE_GAP_TOP = 32
  /** 松手时离边多近就吸附 */
  const SNAP_DIST = 52

  /**
   * `ui.root` 的包围盒比看得见的她大一圈——fitModel 特意留了 PAD（见那边注释：
   * 尾巴、举起来的道具、惊讶表情容易被裁），所以四边都带着一圈透明留白。
   * 贴边/贴角贴的应该是「看得见的她」，不是这圈留白，不然算出来的「贴死」
   * 位置其实还差一截（看着像怎么都拖不进角落），贴顶边的时候又会反过来把
   * 留白也顶到墙外，看着像穿模。
   *
   * 用命中掩码（mask.bbox，跟点击穿透用的是同一份数据）把留白换算成当前
   * 屏幕像素，贴边计算时统一扣掉。掩码还没测出来就退回 0（等价于老行为，
   * 不会比原来更差）。
   *
   * 强制重测一次（忽略节流）：mask.bbox 平时只在 resize/换姿势时才刷新，
   * 待机动作（自拍、伸展…）会临时改变轮廓但不会标脏——松手贴边这一刻如果
   * 用的是几秒前、她做着别的动作时测出来的旧掩码，留白算出来就会偏，
   * 贴边表现看着就跟撞了大运一样时准时不准。这里直接现测一次当前这一帧，
   * 保证用的是「她此刻真实的样子」。
   */
  function visualMargins() {
    buildMask(true)
    const b = mask.bbox
    if (!b) return { left: 0, right: 0, top: 0, bottom: 0 }
    const r = ui.root.getBoundingClientRect()
    return {
      left: b.x0 * r.width,
      right: (1 - b.x1) * r.width,
      top: b.y0 * r.height,
      bottom: (1 - b.y1) * r.height,
    }
  }

  /** 工具条在容器下面探出来的高度（贴底时要把这段算进去，否则按钮会被屏幕切掉） */
  function dockClearance() {
    const s = parseFloat((ui.root.style.getPropertyValue('--dshp-s') || '1').trim()) || 1
    return 34 * s
  }

  /** 平滑移动到位（拖动是瞬时的，吸附要有个「吸过去」的过程） */
  function glideTo(left, top) {
    const el = ui.root
    el.style.transition = 'left .22s cubic-bezier(.2,.9,.3,1), top .22s cubic-bezier(.2,.9,.3,1)'
    el.style.left = left + 'px'
    el.style.top = top + 'px'
    el.style.right = 'auto'
    el.style.bottom = 'auto'
    markStageRectDirty()
    setTimeout(() => {
      el.style.transition = ''
      clampPanels()
      markStageRectDirty() // 滑动过程中缓存会暂时过期，动画落定后再刷新一次保证准
    }, 260)
  }

  /**
   * 松手时的贴边吸附。
   * 靠近左下/右下角 → 直接记成「角落模式」（窗口大小变了也跟着走）；
   * 只贴某一边 → 固定那一轴，另一轴保持自由。
   */
  /**
   * 松手时的贴边吸附。
   *
   * 主人改的规矩（原话）：「只吸附右边、不吸附底，我可以随意调整高低，
   * 但只吸附右边或左边的墙壁」——所以竖直方向本身不设单独的吸附线。
   * 后来又加了一条：**四个真角落**要能整个贴死（横纵一起锁住）——这样
   * 工具条才有理由挪到侧边（见 CSS `[data-corner]`），角落才不会因为
   * 「下面还要留给按钮的空间」而贴不到底。
   *
   *   · 横纵都够近墙角 → 真角落：两个方向一起吸，工具条挪侧边
   *   · 只有左右够近 → 老规矩：吸那一侧墙，竖直位置保持你松手的高度
   *   · 都不够近 → 停在原地，交给惯性滑动
   */
  function snapOnRelease() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const r = ui.root.getBoundingClientRect()
    const m = visualMargins()
    // 判「够不够近」和算「贴死的位置」都要用看得见的边，不是包围盒的边
    const nearL = r.left + m.left < SNAP_DIST
    const nearR = vw - (r.right - m.right) < SNAP_DIST
    const nearT = r.top + m.top < SNAP_DIST
    const nearB = vh - (r.bottom - m.bottom) < SNAP_DIST

    if ((nearL || nearR) && (nearT || nearB)) {
      const corner = (nearT ? 't' : 'b') + (nearL ? 'l' : 'r')
      const left = nearL ? EDGE_GAP - m.left : vw - r.width - EDGE_GAP + m.right
      const top = nearT ? EDGE_GAP_TOP - m.top : vh - r.height - EDGE_GAP + m.bottom
      glideTo(left, top)
      // 记成「贴哪个角」，窗口大小变了也还贴着那个角（见 resize 里的 applyPosition）
      saveLayout({ x: null, y: null, edge: null, edgeY: null, corner })
      ui.root.dataset.corner = corner
      ui.root.dataset.edge = corner[1] === 'l' ? 'left' : 'right'
      return true
    }
    if (!nearL && !nearR) return false // 底部/顶部单独都不吸附

    const edge = nearR ? 'right' : 'left'
    const y = clampY(r.top, r.height, vh)
    const left = edge === 'left' ? EDGE_GAP - m.left : vw - r.width - EDGE_GAP + m.right
    glideTo(left, y)
    // 记成「贴哪一边 + 竖直位置」，窗口大小变了也还贴着那一边、高低不动
    saveLayout({ x: null, y: null, corner: null, edge, edgeY: Math.round(y) })
    ui.root.dataset.edge = edge
    delete ui.root.dataset.corner
    return true
  }

  /** 竖直位置的安全范围：上面别顶出屏幕，下面给工具栏留出位置（不是吸附，只是夹一下） */
  function clampY(top, height, vh) {
    const dock = dockClearance()
    const maxTop = Math.max(-20, (vh || window.innerHeight) - height - dock - 4)
    return clamp(top, -20, maxTop)
  }

  /** 贴住某一侧墙：left/right + top 固定，竖直位置由主人自己定 */
  function applyEdge(edge, y) {
    const root = ui.root
    const m = visualMargins()
    const yy = clampY(Number(y) || 0, root.getBoundingClientRect().height || 0, window.innerHeight)
    root.style.left = edge === 'left' ? (EDGE_GAP - m.left) + 'px' : 'auto'
    root.style.right = edge === 'right' ? (EDGE_GAP - m.right) + 'px' : 'auto'
    root.style.top = Math.round(yy) + 'px'
    root.style.bottom = 'auto'
    root.dataset.edge = edge
    delete root.dataset.corner
    markStageRectDirty()
  }

  /**
   * 贴进真正的角落：横纵两个方向都锁死在墙边（不像 applyEdge 只锁一个方向），
   * 所以**不走 clampY**——角落模式下方不用给工具条留白，它已经挪到侧边了
   * （CSS `[data-corner]` 里处理），能贴多死就贴多死。
   */
  function applyCorner(corner) {
    const root = ui.root
    const m = visualMargins()
    root.style.left = corner === 'tl' || corner === 'bl' ? (EDGE_GAP - m.left) + 'px' : 'auto'
    root.style.right = corner === 'tr' || corner === 'br' ? (EDGE_GAP - m.right) + 'px' : 'auto'
    root.style.top = corner === 'tl' || corner === 'tr' ? (EDGE_GAP_TOP - m.top) + 'px' : 'auto'
    root.style.bottom = corner === 'bl' || corner === 'br' ? (EDGE_GAP - m.bottom) + 'px' : 'auto'
    root.dataset.corner = corner
    root.dataset.edge = corner === 'tl' || corner === 'bl' ? 'left' : 'right'
    markStageRectDirty()
  }

  /**
   * 摆放位置。四种存档：
   *   · corner       —— 贴死在四角之一，工具条挪侧边（**手动拖到角落吸附后存的就是这种**）
   *   · edge + edgeY —— 贴左/右墙，竖直位置自由（吸附到墙但没到角落存的是这种）
   *   · x + y        —— 完全自由摆放
   *   · 都没有        —— 首次启动，按 CFG.corner 算一次默认位置，就地存成 edge 形式
   */
  function applyPosition(layout) {
    const root = ui.root
    if (layout.corner) {
      applyCorner(layout.corner)
      return
    }
    const vh = window.innerHeight
    const h = root.getBoundingClientRect().height || 0
    const dock = dockClearance()

    if (layout.edge === 'left' || layout.edge === 'right') {
      applyEdge(layout.edge, layout.edgeY != null ? layout.edgeY : vh - h - dock - EDGE_GAP)
      return
    }
    if (layout.x != null && layout.y != null) {
      root.style.left = layout.x + 'px'
      root.style.top = clampY(layout.y, h, vh) + 'px'
      root.style.right = 'auto'
      root.style.bottom = 'auto'
      delete root.dataset.edge
      delete root.dataset.corner
      markStageRectDirty()
      return
    }
    // 老存档 / 首次启动：按角落算一次，然后就地存成 edge 形式（下次就是新的了）
    const corner = layout.corner || CFG.corner || 'br'
    const edge = corner === 'bl' || corner === 'tl' ? 'left' : 'right'
    const y = corner === 'tr' || corner === 'tl' ? 64 : vh - h - dock - EDGE_GAP
    applyEdge(edge, y)
    saveLayout({ corner: null, edge, edgeY: Math.round(clampY(y, h, vh)) })
  }

  // ——————————————————————————————————————————————————————————————
  // 六、命中掩码：让点击穿透空气
  // ——————————————————————————————————————————————————————————————

  const mask = { grid: null, w: 0, h: 0, dirty: true, building: false, lastBuild: 0, bbox: null, bands: null }

  /**
   * 一条竖带里「实体质量的横向重心与范围」。
   *
   * 为什么不直接用整条带的外接框：这个模型是一整张书桌场景，桌子比人宽得多。
   * 按整条带的外接框取景，镜头会被人两边的东西（桌沿、鼠标垫）拽偏，
   * 结果就是人在画面左边、右边一大片空。按「质量」算重心就稳得多。
   */
  function bandWindow(grid, W, y0, y1) {
    const cols = new Float32Array(W)
    let max = 0
    for (let y = y0; y < y1; y++) {
      const row = y * W
      for (let x = 0; x < W; x++) {
        if (grid[row + x]) {
          cols[x]++
          if (cols[x] > max) max = cols[x]
        }
      }
    }
    if (max <= 0) return null
    const thresh = max * 0.25
    let mass = 0
    let wsum = 0
    for (let x = 0; x < W; x++) {
      // 只统计「有实体分量」的列，零星空隙不会把重心拽走
      if (cols[x] >= thresh) {
        mass += cols[x]
        wsum += cols[x] * x
      }
    }
    if (mass <= 0) return null
    const center = wsum / mass
    return { center: center / W }
  }

  /** 为每个取景档算出各自的横向重心（归一化）。 */
  function computeBands(grid, W, H, bbox) {
    const y0 = Math.max(0, Math.floor(bbox.y0 * H))
    const y1 = Math.min(H, Math.ceil(bbox.y1 * H))
    const ch = Math.max(1, y1 - y0)
    const out = {}
    for (const [mode, frac] of Object.entries(FIT_FRACTION)) {
      const by1 = Math.min(y1, Math.max(y0 + 1, Math.round(y0 + ch * frac)))
      const win = bandWindow(grid, W, y0, by1)
      out[mode] = win || { center: (bbox.x0 + bbox.x1) / 2 }
    }
    return out
  }

  function buildMask(force) {
    if (!app || !model || mask.building) return
    if (!force && performance.now() - mask.lastBuild < 300) return
    mask.building = true
    try {
      const src = app.view
      if (!src || !src.width || !src.height) throw new Error('画布还没准备好')
      const W = 128
      const H = Math.max(24, Math.round((W * src.height) / src.width))
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const g = c.getContext('2d', { willReadFrequently: true })
      g.clearRect(0, 0, W, H)
      g.drawImage(src, 0, 0, W, H)
      const data = g.getImageData(0, 0, W, H).data
      const grid = new Uint8Array(W * H)
      let filled = 0
      let minx = W
      let miny = H
      let maxx = -1
      let maxy = -1
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x
          if (data[i * 4 + 3] > 26) {
            grid[i] = 1
            filled++
            if (x < minx) minx = x
            if (x > maxx) maxx = x
            if (y < miny) miny = y
            if (y > maxy) maxy = y
          }
        }
      }
      const coverage = filled / (W * H)
      // 全空说明这一帧没画上东西，别把掩码覆盖成「处处不可点」
      if (coverage < 0.005) throw new Error('画面是空的')
      mask.grid = grid
      mask.w = W
      mask.h = H
      mask.bbox =
        maxx >= 0
          ? { x0: minx / W, y0: miny / H, x1: (maxx + 1) / W, y1: (maxy + 1) / H }
          : null
      mask.bands = mask.bbox ? computeBands(grid, W, H, mask.bbox) : null
      mask.dirty = false
      mask.lastBuild = performance.now()
      log(
        `命中掩码 ${W}×${H}，覆盖率 ${(coverage * 100).toFixed(1)}%` +
          (mask.bbox
            ? `，实体范围 x ${mask.bbox.x0.toFixed(2)}–${mask.bbox.x1.toFixed(2)} / y ${mask.bbox.y0.toFixed(2)}–${mask.bbox.y1.toFixed(2)}`
            : ''),
      )
    } catch (err) {
      // 拿不到掩码就退回整个矩形可点，功能不至于丢
      mask.grid = null
      mask.dirty = false
      mask.lastBuild = performance.now()
      console.warn('[鲸鱼娘] 掩码生成失败，退回包围盒判定：', err && err.message)
    } finally {
      mask.building = false
    }
  }

  /** 客户端坐标是否落在鲸鱼娘身上（而不是桌宠框里的空气）。 */
  function hitTest(clientX, clientY) {
    const stage = app && app.view && app.view.parentElement
    if (!stage) return false
    const r = stage.getBoundingClientRect()
    if (!r.width || !r.height) return false
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false
    if (!mask.grid) return true
    const mx = Math.floor(((clientX - r.left) / r.width) * mask.w)
    const my = Math.floor(((clientY - r.top) / r.height) * mask.h)
    if (mx < 0 || my < 0 || mx >= mask.w || my >= mask.h) return false
    return mask.grid[my * mask.w + mx] === 1
  }

  /**
   * 鼠标是不是在「她下方那排按钮」上（含一点外扩的容错）。
   * 这三个键不在模型掩码里，只靠 hitTest 会让它们一出现就消失、根本点不着。
   */
  function overDock(clientX, clientY) {
    try {
      if (!ui || !ui.dock) return false
      const r = ui.dock.getBoundingClientRect()
      if (!r.width || !r.height) return false
      const pad = 12
      return (
        clientX >= r.left - pad &&
        clientX <= r.right + pad &&
        clientY >= r.top - pad &&
        clientY <= r.bottom + pad
      )
    } catch (err) {
      return false
    }
  }

  // ——————————————————————————————————————————————————————————————
  // 六点五、视线控制器
  // ——————————————————————————————————————————————————————————————

  /**
   * 为什么要有这一层：最初的做法是「鼠标一动就把头指过去」，结果头摆得像螺旋桨——
   * 又急、幅度又大、还一直死盯着你。现在拆成四件事：
   *
   *   1. 只有光标进到桌宠附近（GAZE_RADIUS）才跟随；离远了它自己发呆、看别处、想事情
   *   2. 幅度只取 58%（GAZE_GAIN），而且是「越近跟得越实、越远越松」，不做 100% 硬绑
   *   3. 目标怎么跳都不管，实际值一律限速逼近（GAZE_MAX_RATE）——头再急也只能慢慢转
   *   4. 互动/大动作期间 detach：人在做动作的时候眼睛不会死盯着你
   *
   * 关掉「视线跟随」之后它不会愣住——下面是同一套自主动作在跑。
   */
  /**
   * 默认值（都能在设置里实时调，见 CFG.gaze*）：
   *   radius = 0   整屏跟随——鼠标在哪儿它看哪儿，不再只跟附近
   *   gain   = 0.78 跟随幅度；调小就「不太理你」，调大就更黏
   *   rate   = 1.6  每秒最多变化多少；调小更慵懒，调大更机灵
   */
  function gazeCfg() {
    return {
      radius: CFG.gazeRadius === undefined ? 0 : Number(CFG.gazeRadius),
      gain: CFG.gazeGain === undefined ? 0.78 : Number(CFG.gazeGain),
      rate: CFG.gazeRate === undefined ? 1.6 : Number(CFG.gazeRate),
    }
  }

  const gaze = {
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
    mode: 'idle',
    detachUntil: 0,
    pointer: { x: 0, y: 0, seen: false },
    nextDrift: 0,
    driftX: 0,
    driftY: 0,
    lastTick: 0,
    /** 视线纵向偏置：读资料时压低，等于「低头看本子」，走的是同一条限速通道 */
    biasY: 0,
    biasTarget: 0,
  }

  /**
   * 爱心粒子。模型自带左右两组爱心（爱心左 j1–j32 / 爱心右 j33–j57），
   * 而 `love` 和 `ParamCheek73` 属于「通用动画(循环)」组——置 1 就会一直循环冒爱心，
   * 所以摸头时用它们做持续 2 秒的爱心爆发，再配脸红和爱心眼。
   */
  function heartBurst(ms) {
    rig.burst = { love: 1, heartbeat: 1, until: performance.now() + (ms || 2200) }
    rig.dirty = true
  }

  /** 做动作时暂时别盯人（对应 clawd-on-desk 那套「反应动画期间脱离眼球追踪」）。 */
  function gazeDetach(ms) {
    gaze.detachUntil = performance.now() + (ms || 1500)
  }

  /**
   * `ui.stage` 的屏幕矩形缓存。gazeTick 永远在跑（40ms 一次，待机也不停），
   * 之前每次都现读 `getBoundingClientRect()`——待机的时候她根本没动，
   * 这个矩形几十秒都不带变的，没必要每 40ms 强制触发一次布局读取。
   * 只在真的会动/会变的地方（拖动、贴边、resize、改大小）标脏，其余时候直接用缓存。
   */
  let stageRect = null
  let stageRectDirty = true
  function markStageRectDirty() {
    stageRectDirty = true
  }
  function getStageRect() {
    if (stageRectDirty || !stageRect) {
      stageRect = ui.stage.getBoundingClientRect()
      stageRectDirty = false
    }
    return stageRect
  }

  function gazeTick() {
    if (!model || !ui) return
    const now = performance.now()
    const dt = Math.min(0.25, (now - (gaze.lastTick || now)) / 1000)
    gaze.lastTick = now
    const detached = now < gaze.detachUntil

    let wantX = 0
    let wantY = 0
    let following = false

    const g = gazeCfg()
    if (!detached && CFG.lookAtCursor && gaze.pointer.seen) {
      const r = getStageRect()
      if (r.width) {
        const dx = gaze.pointer.x - (r.left + r.width / 2)
        const dy = gaze.pointer.y - (r.top + r.height / 2)
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (g.radius <= 0 || dist < g.radius) {
          following = true
          // 参照距离按屏幕算，这样鼠标在屏幕任何角落都落在有效范围内
          const refX = Math.max(r.width, window.innerWidth * 0.5)
          const refY = Math.max(r.height, window.innerHeight * 0.5)
          wantX = clamp(dx / refX, -1, 1) * g.gain
          wantY = clamp(-dy / refY, -1, 1) * g.gain
        }
      }
    }

    if (following) {
      gaze.mode = 'follow'
    } else {
      // 没人管它：自己看东看西、想事情
      gaze.mode = detached ? 'detach' : 'idle'
      if (now > gaze.nextDrift) {
        gaze.nextDrift = now + 1800 + Math.random() * 4200
        gaze.driftX = (Math.random() * 2 - 1) * (detached ? 0.16 : 0.5)
        gaze.driftY = (Math.random() * 2 - 1) * (detached ? 0.1 : 0.32)
      }
      const t = now / 1000
      wantX = gaze.driftX + Math.sin(t * 0.37) * 0.07
      wantY = gaze.driftY + Math.cos(t * 0.29) * 0.05
    }

    // 低头看资料：只是给视线加一个纵向偏置，仍然受同一个限速器约束，
    // 所以不会突然「咔」一下低头。
    gaze.biasY += (gaze.biasTarget - gaze.biasY) * clamp(dt * 1.6, 0, 1)
    // 低头偏置是**改变方向**，不是放大幅度：
    // 合成方向后统一乘 gain，这样总幅度永远不超过 gain（否则低头会额外顶出去 0.3）。
    if (gaze.biasY !== 0 && following) {
      let dx2 = wantX / g.gain
      let dy2 = wantY / g.gain + gaze.biasY
      const mag = Math.sqrt(dx2 * dx2 + dy2 * dy2)
      if (mag > 1) {
        dx2 /= mag
        dy2 /= mag
      }
      wantX = dx2 * g.gain
      wantY = dy2 * g.gain
    } else if (!following) {
      wantY += gaze.biasY
    }
    wantX = clamp(wantX, -1, 1)
    wantY = clamp(wantY, -1, 1)

    gaze.tx += (wantX - gaze.tx) * clamp(dt * 3.0, 0, 1)
    gaze.ty += (wantY - gaze.ty) * clamp(dt * 3.0, 0, 1)
    const maxStep = g.rate * dt
    // 记录真实步长速率（单位/秒）。测试用它验证限速器，比在外部按采样间隔
    // 估算靠谱得多——页面卡顿会让 tick 变长，采样法会误判成「超速」。
    gaze.stepRate = Math.max(gaze.stepRate || 0, maxStep / Math.max(dt, 1e-6))
    gaze.x = clamp(gaze.x + clamp(gaze.tx - gaze.x, -maxStep, maxStep), -1, 1)
    gaze.y = clamp(gaze.y + clamp(gaze.ty - gaze.y, -maxStep, maxStep), -1, 1)

    try {
      // 注意：只调 focus() 是限不住的——框架自己还会把 x 朝 targetX 缓动一次，
      // 那一步比我们的限速更快。所以当前值和目标值一起写，限速器才是唯一权威。
      const fc = model.internalModel.focusController
      fc.targetX = gaze.x
      fc.targetY = gaze.y
      fc.x = gaze.x
      fc.y = gaze.y
      // 回读一下：写入被谁覆盖的话，这里能第一时间看出来
      gaze.fcX = fc.x
      gaze.fcErr = ''
    } catch (err) {
      gaze.fcErr = String((err && err.message) || err)
    }
  }

  // ——————————————————————————————————————————————————————————————
  // 六点六、动作表现：Q 弹 / 惯性回弹 / 爱心 / 工作轮播
  // ——————————————————————————————————————————————————————————————

  /** Q 弹抖动：点击时整个身子软软地弹一下（Web Animations，不碰模型参数）。 */
  function qBounce(power) {
    const el = ui && ui.stage
    if (!el || !el.animate) return
    const k = power == null ? 1 : power
    el.style.transformOrigin = '50% 100%'
    el.animate(
      [
        { transform: 'scale(1,1)' },
        { transform: `scale(${1 + 0.1 * k},${1 - 0.12 * k})` },
        { transform: `scale(${1 - 0.045 * k},${1 + 0.055 * k})` },
        { transform: 'scale(1,1)' },
      ],
      { duration: 460, easing: 'cubic-bezier(.34,1.56,.64,1)' },
    )
  }

  /** 拖拽松手后的惯性回弹：速度衰减着滑一段，再落定。 */
  function dragInertia(vx, vy) {
    const el = ui && ui.root
    if (!el) return
    let px = parseFloat(el.style.left) || 0
    let py = parseFloat(el.style.top) || 0
    let sx = vx
    let sy = vy
    const h = el.getBoundingClientRect().height
    const step = () => {
      sx *= 0.85
      sy *= 0.85
      px = clamp(px + sx, -40, window.innerWidth - 60)
      py = clampY(py + sy, h, window.innerHeight)
      el.style.left = px + 'px'
      el.style.top = py + 'px'
      markStageRectDirty()
      if (Math.abs(sx) > 0.4 || Math.abs(sy) > 0.4) requestAnimationFrame(step)
      else saveLayout({ x: Math.round(px), y: Math.round(py), edge: null, edgeY: null, corner: null })
    }
    requestAnimationFrame(step)
  }

  /**
   * 工作轮播。规格要求「变出小电脑、敲键盘、轮播 认真/摸鱼/思考」。
   * 所以干活期间不是钉在一张脸上，而是按节奏换：敲键盘 → 认真看 → 偷偷摸鱼 → 思考。
   */
  // 干活时的两个状态：认真看资料 / 思考。切换很慢（见 workTick 的间隔），
  // 主人明确说过「工作模式下不要切太多」。
  const WORK_CYCLE = [
    { mood: 'reading', say: 'reading' },
    { mood: 'thinking', say: 'thinking' },
  ]
  const work = { i: 0, nextAt: 0, active: false }
  /** 小设备是否已经掏出来了（查资料时），用完要收回去 */
  const device = { out: false }

  function startWork() {
    if (work.active) return
    work.active = true
    work.i = 0
    work.nextAt = 0
    // 用模型自带的开盖动作把设备掏出来；道具由 WORK_PROPS 决定
    playMotion('openLid')
    gazeDetach(1200)
  }

  function endWork() {
    work.active = false
    gaze.biasTarget = 0
    putDeviceAway()
  }

  /** 把小设备收回去，回到常驻待机动作。 */
  function putDeviceAway() {
    if (!device.out) return
    device.out = false
    // 收起小设备，回到默认姿势（手里的笔也就回来了）
    stopMotion()
  }

  function workTick() {
    if (!work.active) return
    const now = performance.now()
    if (now < work.nextAt) return
    work.nextAt = now + 9000 + Math.random() * 5000 // 慢切换
    const stepDef = WORK_CYCLE[work.i % WORK_CYCLE.length]
    work.i++
    // 轮播只改底层状态，不产生会赖着不走的一次性反应
    setBase(stepDef.mood, WORK_PROPS)
    // 正在思考/看资料：把话说到气泡正文里，别只更新脚注（那样看着像在摸鱼）
    if (!rig.talking && ui.bubble.visible) {
      ui.bubble.show(pickFresh(SAY[stepDef.say], 'work-' + stepDef.say), {
        name: 'DS 鲸鱼娘',
        busy: true,
        sticky: true,
      })
      noteProcess(stepDef.mood === 'reading' ? '看资料' : '思考中')
    }
  }

  // ——————————————————————————————————————————————————————————————
  // 七、UI
  // ——————————————————————————————————————————————————————————————

  function buildUI() {
    const root = $('div', 'dshp-root')
    root.id = 'dsh-live2d-pet'

    const stage = $('div', 'dshp-stage')

    const bubbleEl = $('div', 'dshp-bubble')
    const head = $('div', 'dshp-head')
    const dot = $('span', 'dshp-dot')
    const headText = $('span', null, 'DS 鲸鱼娘')
    head.append(dot, headText)
    const body = $('div', 'dshp-body')
    const foot = $('div', 'dshp-foot')
    bubbleEl.append(head, body, foot)

    const dock = $('div', 'dshp-dock')
    const talkBtn = $('button', 'dshp-btn dshp-primary')
    talkBtn.append(icon('chat'), $('span', null, '说话'))
    const menuBtn = $('button', 'dshp-btn dshp-icon')
    menuBtn.append(icon('more'))
    menuBtn.title = '菜单（表情 / 装饰 / 场景 / 动作 / 设置）'
    const hideBtn = $('button', 'dshp-btn dshp-icon')
    hideBtn.append(icon('collapse'))
    hideBtn.title = '收起（桌面版会缩成贴边小球）'
    const openBtn = $('button', 'dshp-btn dshp-icon')
    openBtn.append(icon('external'))
    openBtn.title = '打开 DeepSeek Harness 界面'
    dock.append(talkBtn, menuBtn, hideBtn, openBtn)

    const composer = $('div', 'dshp-panel dshp-composer')
    const ta = $('textarea')
    ta.placeholder = '跟 DSH 说点什么…（Enter 发送 / Shift+Enter 换行）'
    const crow = $('div', 'dshp-row')
    const sendBtn = $('button', 'dshp-btn dshp-primary', '发送')
    const cancelBtn = $('button', 'dshp-btn', '打断')
    crow.append($('span', 'dshp-grow'), cancelBtn, sendBtn)
    const chint = $('div', 'dshp-hint', '发出去的话进入当前会话，回复会显示在气泡里。')
    composer.append(ta, crow, chint)
    addCloseButton(composer)

    const menu = $('div', 'dshp-panel dshp-menu')
    const tabs = $('div', 'dshp-tabs')
    const panes = $('div')
    menu.append(tabs, panes)
    addCloseButton(menu)

    const tab = $('div', 'dshp-tab', '🐋 鲸鱼娘')

    // 右键弹出的 HUD（余额 / 本轮消耗 / 峰谷计价）
    const hud = $('div', 'dshp-hud')
    const hudHead = $('div', 'dshp-hud-head')
    const hudTitle = $('span', null, '鲸鱼娘 · 钱包')
    const hudDot = $('span', 'dshp-hud-tag dshp-valley', '谷')
    hudHead.append(hudTitle, hudDot)
    const hudMoney = $('div', 'dshp-hud-money')
    const hudMoneyNum = $('b', null, '—')
    const hudMoneyCur = $('span', null, 'CNY')
    hudMoney.append(hudMoneyNum, hudMoneyCur)
    const hudRowToday = $('div', 'dshp-hud-row')
    const hudTodayV = $('span', 'dshp-hud-v', '—')
    hudRowToday.append($('span', 'dshp-hud-k', '今日已用'), hudTodayV)
    const hudRowTurn = $('div', 'dshp-hud-row')
    const hudTurnV = $('span', 'dshp-hud-v', '—')
    hudRowTurn.append($('span', 'dshp-hud-k', '本轮消耗'), hudTurnV)
    const hudRowCd = $('div', 'dshp-hud-row')
    const hudCdV = $('span', 'dshp-hud-v', '—')
    hudRowCd.append($('span', 'dshp-hud-k', '距切换'), hudCdV)
    const hudFoot = $('div', 'dshp-hud-foot', '')
    hud.append(
      hudHead, hudMoney,
      $('div', 'dshp-hud-sep'),
      hudRowTurn, hudRowToday, hudRowCd,
      hudFoot,
    )
    addCloseButton(hud, () => closeHud())

    root.append(stage, bubbleEl, dock, composer, menu, hud)
    document.body.append(root, tab)

    const u = {
      root,
      stage,
      tab,
      bubble: makeBubble(bubbleEl, body, foot, dot, headText),
      composer: { el: composer, ta, send: sendBtn, cancel: cancelBtn },
      menu: { el: menu, tabs, panes, focused: null },
      hud: {
        el: hud,
        badge: hudDot,
        money: hudMoneyNum,
        currency: hudMoneyCur,
        today: hudTodayV,
        turn: hudTurnV,
        countdown: hudCdV,
        foot: hudFoot,
        title: hudTitle,
      },
      dock,
    }
    bindComposer(u)
    bindMenu(u)
    // 这里不能调 setHidden()——此刻 ui 还没赋值（ui = buildUI() 才刚返回），
    // setHidden 里读 ui.root 会直接抛异常，表现为「隐藏过一次之后，
    // 以后每次打开都起不来」。所以就地写类名。
    if (readLayout().hidden) {
      root.classList.add('dshp-hidden')
      document.body.classList.add('dshp-pet-hidden')
    }
    return u
  }

  function makeBubble(el, body, foot, dot, headText) {
    let timer = null
    let streaming = false
    let buffer = ''
    const api = {
      el,
      show(text, opts) {
        opts = opts || {}
        if (opts.name) headText.textContent = opts.name
        if (opts.stream) {
          if (!streaming) {
            buffer = ''
            streaming = true
          }
          buffer += text
          body.textContent = buffer.length > 4000 ? '…' + buffer.slice(-4000) : buffer
        } else {
          streaming = false
          buffer = String(text == null ? '' : text)
          body.textContent = buffer
        }
        body.scrollTop = body.scrollHeight
        foot.textContent = opts.foot || ''
        dot.classList.toggle('dshp-pulse', !!opts.busy)
        el.classList.add('dshp-on')
        if (timer) clearTimeout(timer)
        const ttl = opts.sticky ? 0 : opts.ttl != null ? opts.ttl : CFG.bubbleTtlMs
        if (ttl > 0) timer = setTimeout(() => api.hide(), ttl)
      },
      note(text) {
        foot.textContent = text
      },
      hide() {
        if (timer) clearTimeout(timer)
        timer = null
        streaming = false
        buffer = ''
        el.classList.remove('dshp-on')
      },
      get visible() {
        return el.classList.contains('dshp-on')
      },
    }
    return api
  }

  // ——————————————————————————————————————————————————————————————
  // 八、鼠标交互：悬停 / 拖动 / 戳 / 右键 / 双击
  // ——————————————————————————————————————————————————————————————

  function wireInteractions() {
    const root = ui.root
    let dragging = false
    let dragMoved = false
    let start = null
    let leaveTimer = null
    const drag = { vx: 0, vy: 0 }
    /**
     * 拖动这一路上用的留白缓存：按下的时候现测一次就够了（拖动中她的轮廓不会变），
     * 没必要跟 visualMargins() 一样每次都强制重测——那是给松手那一刻的精确判断用的，
     * 真拖起来（pointermove 高频触发）每帧都测一次画布就太贵了。
     */
    let dragMargins = { left: 0, right: 0, top: 0, bottom: 0 }

    document.addEventListener(
      'pointermove',
      (e) => {
        if (!dragging) {
          // 主人反馈：「我鼠标往下走要去点那三个键，一离开她身上它们就消失了，点不着」。
          // 原因：原来只认 hitTest（她模型身上），而工具栏在她**下方**、不在模型掩码里。
          // 现在把「鼠标在工具栏矩形内」也算作悬停，并且离开后多留 900ms。
          const on = hitTest(e.clientX, e.clientY) || overDock(e.clientX, e.clientY)
          if (on) {
            root.classList.add('dshp-hover')
            if (leaveTimer) {
              clearTimeout(leaveTimer)
              leaveTimer = null
            }
          } else if (!leaveTimer && !root.classList.contains('dshp-open')) {
            leaveTimer = setTimeout(() => {
              leaveTimer = null
              if (!root.classList.contains('dshp-open')) root.classList.remove('dshp-hover')
            }, 900)
          }
        } else if (start) {
          const dx = e.clientX - start.mx
          const dy = e.clientY - start.my
          if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 4) dragMoved = true
          if (dragMoved) {
            const nRect = root.getBoundingClientRect()
            const nh = nRect.height
            const nw = nRect.width
            // 原来是写死的 -40/-60 容差——现在贴角落要求看得见的边能拖到真正
            // 贴墙，写死的小容差不够用（透明留白一大，包围盒还没到边就被卡住了，
            // 松手时永远进不了 SNAP_DIST）。改成按这次抓起来时量到的留白放宽：
            // 包围盒可以拖到「留白刚好出屏幕、看得见的部分刚好贴墙」那个位置。
            const nx = clamp(start.left + dx, -dragMargins.left - 20, window.innerWidth - nw + dragMargins.right + 20)
            // 竖直方向同理放宽；不贴角落的话，松手交给 snapOnRelease/dragInertia
            // 各自的规矩去收（dragInertia 仍然会退回给工具条留白的安全范围）。
            const ny = clamp(start.top + dy, -dragMargins.top - 20, window.innerHeight - nh + dragMargins.bottom + 20)
            // 身体随拖动方向摇摆：横向速度直接喂给身体的倾斜
            drag.vx = nx - (parseFloat(root.style.left) || nx)
            drag.vy = ny - (parseFloat(root.style.top) || ny)
            root.style.left = nx + 'px'
            root.style.top = ny + 'px'
            root.style.right = 'auto'
            root.style.bottom = 'auto'
            markStageRectDirty()
          }
        }
        // 只记录坐标，真正的跟随在 gazeTick 里限速执行——
        // 直接在 pointermove 里写 focusController 就是「螺旋桨」的成因。
        gaze.pointer.x = e.clientX
        gaze.pointer.y = e.clientY
        gaze.pointer.seen = true
      },
      { passive: true },
    )

    document.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0) return
        if (!hitTest(e.clientX, e.clientY)) return
        // 点在鲸鱼娘身上：吃掉这次点击，别让下面的 DSH 界面也响应
        e.stopPropagation()
        e.preventDefault()
        dragging = true
        dragMoved = false
        delete root.dataset.edge // 一拖就离开墙，别再显示「贴着左边」
        delete root.dataset.corner // 同上：一拖就离开角落，工具条先挪回下面，吸没吸得上松手再说
        dragMargins = visualMargins()
        const r = root.getBoundingClientRect()
        start = { mx: e.clientX, my: e.clientY, left: r.left, top: r.top }
      },
      true,
    )

    document.addEventListener(
      'pointerup',
      (e) => {
        if (!dragging) return
        dragging = false
        if (dragMoved) {
          // 松手：先看要不要贴边吸附，没吸附上再走自由惯性
          if (!snapOnRelease()) dragInertia(drag.vx, drag.vy)
          drag.vx = 0
          drag.vy = 0
        } else {
          poke(e.clientX, e.clientY)
        }
        start = null
      },
      true,
    )

    document.addEventListener('pointercancel', () => {
      dragging = false
      start = null
    })

    document.addEventListener(
      'contextmenu',
      (e) => {
        if (!hitTest(e.clientX, e.clientY)) return
        e.preventDefault()
        e.stopPropagation()
        // 主人要求：右键弹「余额 / 本轮消耗 / 峰谷」这个框，不再直接弹设置菜单
        // （设置还在工具栏的 ⋯ 里，没有丢）
        if (hud.open) closeHud()
        else openHud({ flash: true, refresh: true })
      },
      true,
    )

    document.addEventListener(
      'dblclick',
      (e) => {
        // 主人要求：输入框只从工具栏的「说话」按钮开，双击鱼身不再弹它。
        // 双击仍然算一次戳她（第一下 click 已经触发过了），这里只吃掉默认行为。
        if (!hitTest(e.clientX, e.clientY)) return
        e.preventDefault()
      },
      true,
    )

    window.addEventListener('resize', () => {
      fitModel()
      const layout = readLayout()
      // 贴着角落 / 贴着左右墙的：重新贴住原来那个位置（角落两个方向都重新锁一遍，
      // 贴墙的只锁那一侧，竖直位置不变，只夹进可见范围）
      if (layout.corner || layout.edge === 'left' || layout.edge === 'right') {
        applyPosition(layout)
      } else if (root.style.left && root.style.left !== 'auto') {
        root.style.left = clamp(parseFloat(root.style.left) || 0, -40, window.innerWidth - 60) + 'px'
        root.style.top = clamp(parseFloat(root.style.top) || 0, -20, window.innerHeight - 60) + 'px'
      }
      markStageRectDirty() // 视口本身变了，缓存的矩形肯定不准了——兜底再标一次
      clampPanels()
    })

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      if (hud.open) {
        e.stopPropagation()
        closeHud()
        return
      }
      if (!ui.root.classList.contains('dshp-open')) return
      e.stopPropagation()
      closePanels()
    })

    ui.tab.addEventListener('click', () => setHidden(false))

    // 面板内点击不要穿透到下面的界面
    for (const el of [ui.composer.el, ui.menu.el, ui.hud.el, ui.dock]) {
      el.addEventListener('pointerdown', (e) => e.stopPropagation())
    }

    // 鼠标停在 HUD 上时不要自动收（主人在看）
    ui.hud.el.addEventListener('pointerenter', () => {
      hud.hover = true
      hud.hideAt = 0
    })
    ui.hud.el.addEventListener('pointerleave', () => {
      hud.hover = false
    })
    // 点 HUD 之外的任何地方就收起来（跟菜单一个规矩）
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!hud.open) return
        if (e.button !== 0) return // 右键不在这里处理，交给 contextmenu 做「再按一次收起」
        const t = e.target
        if (t && (t === ui.hud.el || ui.hud.el.contains(t))) return
        closeHud()
      },
      true,
    )

    // 点面板以外任何地方（含 DSH 界面、甚至桌宠自己身上）都收起面板
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!ui.root.classList.contains('dshp-open')) return
        const t = e.target
        if (t && (t === ui.root || ui.root.contains(t))) return
        if (t && ui.menu.el.contains(t)) return
        if (t && ui.composer.el.contains(t)) return
        closePanels()
      },
      true,
    )
  }

  /**
   * 戳她。
   *
   * 之前的问题：身体被戳走的是「晕晕」这种不对味的脸（用户说「别闹应该是可爱地生气」），
   * 而且反应池太窄。现在按人设来——傲娇嘴甜、嘴上嫌弃、其实很开心；
   * 另外加了连击（短时间戳很多下会炸毛）和「摸头/戳腰」分区。
   */
  const pokeState = { times: [], softAt: 0, angerAt: 0 }

  /**
   * 连点分档 —— 主人第二次抱怨「平常点几下就生气了，不好玩」。
   *
   * 旧代码的判定是「和上一次点击间隔 < 1.8 秒就累加」，于是每 1.5 秒点一下，
   * 点到第三下照样炸毛，正常逗她玩也会被凶。
   *
   * 现在改成真正的**速率**判定：看 2.6 秒里点了几下、平均间隔多少。
   *   · 慢悠悠地戳（平均间隔 > 420ms，也就是慢于 2.4 下/秒）→ 永远只是可爱反应；
   *   · 快到 2.4 下/秒以上，才「被戳痒了」撒娇抗议（ticklish），仍然不是生气；
   *   · 只有手速党（3.8 下/秒以上、窗口内至少 7 下）才真炸毛，而且炸毛后有
   *     6 秒冷静期，免得一直凶主人。
   */
  const POKE_TIER = {
    window: 2600, // 统计窗口（毫秒）
    softCount: 4, // 窗口内至少 4 下
    softGap: 420, // 且平均间隔 ≤ 420ms → 痒得抗议（≈2.4 下/秒）
    hardCount: 7, // 窗口内至少 7 下
    hardGap: 260, // 且平均间隔 ≤ 260ms → 真炸毛（≈3.8 下/秒）
    softCool: 1500, // 撒娇抗议之间的最小间隔，免得刷屏
    angerCool: 6000, // 炸毛之后的冷静期
  }

  /**
   * 记一次点击，并把滑出窗口的旧记录丢掉。
   * 时间戳是滑动窗口，所以慢慢点的话旧记录会自己过期，永远攒不到炸毛。
   */
  function pokeRecord(now) {
    const t = pokeState.times
    t.push(now)
    if (t.length > 60) t.splice(0, t.length - 60)
    pokePrune(now)
  }

  function pokePrune(now) {
    const t = pokeState.times
    while (t.length && now - t[0] > POKE_TIER.window) t.shift()
  }

  /** 纯函数：由「几下 / 平均间隔 / 距上次炸毛多久」判断档位。测试也用它。 */
  function tierOf(count, gap, sinceAnger) {
    const T = POKE_TIER
    const rapid = count >= T.softCount && gap <= T.softGap
    const furious = rapid && count >= T.hardCount && gap <= T.hardGap && sinceAnger > T.angerCool
    return { count, gap: gap === Infinity ? null : Math.round(gap), rapid, furious }
  }

  /** 现在的手速处在哪一档。只读，不改记录（诊断接口也调它）。 */
  function pokeTier(now) {
    const at = now || performance.now()
    pokePrune(at)
    const t = pokeState.times
    const count = t.length
    const gap = count >= 2 ? (t[count - 1] - t[0]) / (count - 1) : Infinity
    return tierOf(count, gap, at - pokeState.angerAt)
  }

  /**
   * 纯计算版：给一串「相邻两次点击的间隔」（毫秒），算出落哪一档。
   * 测试专门用它证明「正常速度点一万下也不会生气」。
   */
  function pokeTierForGaps(gaps) {
    const T = POKE_TIER
    const times = []
    let t = 0
    times.push(t)
    for (const g of gaps) {
      t += g
      times.push(t)
    }
    let count = 0
    let sum = 0
    for (let i = times.length - 1; i >= 0; i--) {
      if (t - times[i] > T.window) break
      count++
    }
    const from = times.length - count
    sum = count >= 2 ? t - times[from] : 0
    const gap = count >= 2 ? sum / (count - 1) : Infinity
    return tierOf(count, gap, Infinity)
  }

  /**
   * 点击互动表。
   *
   * 主人定的规矩：
   *   · **每个特效配它自己那套台词**，台词贴人设（傲娇嘴甜、贪吃白米、不能被叫胖）
   *   · 一次点击最多 1~2 个效果，绝不叠一堆
   *   · 连着点不重复（pickFresh 记着上一次），所以点十下能看到十种不同反应
   *   · 已踢掉：吹泡泡糖、大锤砸头、猫爪摆手、呆眼、圈圈眼
   */
  /** 干活时被点的互动池：还是傲娇那套，但带一点「人家在忙啦」。 */
  const POKE_BUSY = [
    { mood: 'pout', w: 1.4, lines: ['别闹啦，人家在忙', '等一下下嘛', '（嘴上嫌弃，手上没停）', '手拿开啦，正忙着呢', '（一边躲一边继续敲）'] },
    { mood: 'grumpy', w: 0.4, lines: ['主人！人家正在忙', '再戳就做不完了哦', '（气鼓鼓地继续干活）'] },
    { mood: 'shy', w: 1.2, lines: ['唔…等我弄完再说', '（被戳得晃了一下，又低头看本子）', '（耳朵红了，但没抬头）'] },
    { mood: 'happy', w: 1.2, lines: ['知道啦知道啦', '（抬头笑一下，又埋头干活）', '在在在，人家听着呢'] },
    { mood: 'tongue', w: 1, lines: ['忙着呢，不理你', '略，等会儿再说', '（扭头继续干活）'] },
    { mood: 'alert', w: 0.6, lines: ['！（笔掉了）', '（慌忙扶住本子）', '吓人家一跳！'] },
    { mood: 'confused', w: 0.6, lines: ['嗯？主人有什么事吗', '（从本子上抬眼看你）'] },
  ]

  /**
   * 摸头池。只有「被叫胖」那一条是真生气的脸，而且权重压到 0.4——
   * 主人要的是「平常点它别老生气」，所以生气是彩蛋，不是常态。
   */
  const POKE_HEAD = [
    {
      mood: 'shy',
      w: 1.6,
      fx: 'heart',
      lines: ['不要突然摸头啦……再摸一下也不是不行。', '唔…头发要乱了啦', '（脸红）就、就一下哦', '哼，本鲸才没有很享受', '（尾巴尖偷偷晃了一下）'],
    },
    {
      mood: 'happy',
      w: 1.4,
      fx: null,
      lines: ['嘿嘿～主人', '嗯？叫人家吗', '在的在的', '摸摸头也不错嘛', '（眯着眼睛蹭了一下）', '主人今天好闲呀'],
    },
    {
      mood: 'love',
      w: 1,
      fx: 'heart',
      lines: ['最喜欢主人了', '（冒爱心）', '今天也最喜欢主人', '（踮脚）还要！', '要是再来碗白饭就更完美了'],
    },
    {
      mood: 'pout',
      w: 1,
      fx: null,
      lines: ['哼，就这一次哦', '才、才没有很开心', '别以为人家好哄', '（嘴上嫌弃，头却没躲）', '手、手洗了吗'],
    },
    {
      mood: 'excited',
      w: 1,
      fx: null,
      lines: ['主人主人！', '（眼睛发亮）', '怎么啦怎么啦', '是要给人家白饭吗！'],
    },
    {
      mood: 'tongue',
      w: 0.8,
      fx: null,
      lines: ['略略略', '就不理你', '（吐舌头）', '摸头要收费的，一碗白饭'],
    },
    {
      mood: 'smug',
      w: 0.8,
      fx: null,
      lines: ['（眯眼）主人手法还不错嘛', '再左边一点…对，就是那里', '哼，本鲸的头是不能乱摸的'],
    },
    {
      mood: 'confused',
      w: 0.7,
      fx: null,
      lines: ['唔？摸头有什么好处吗', '（歪头）今天怎么这么殷勤', '无事献殷勤…是不是有事求人家'],
    },
    {
      mood: 'sleepy',
      w: 0.4,
      fx: null,
      lines: ['唔…困……', '（被摸得眼睛都闭上了）', '再摸就睡着了哦'],
    },
    {
      mood: 'grumpy',
      w: 0.4,
      fx: null,
      lines: ['你再说一遍？！人家这是可爱，不是胖！', '本鲸是丰腴，不是胖'],
    },
  ]

  /** 戳身子池：全是可爱反应，没有生气的脸——生气只留给「手速党」。 */
  const POKE_BODY = [
    {
      mood: 'pout',
      w: 1.4,
      fx: null,
      lines: ['喂！别戳人家啦', '喂喂，人家也是有尊严的', '再戳人家要咬人了哦', '（拍开你的手）'],
    },
    {
      mood: 'playful',
      w: 1.4,
      fx: null,
      lines: ['好痒…哈哈哈', '住手啦主人', '别闹别闹', '（扭来扭去躲）', '哈哈哈哈哈不行了'],
    },
    {
      mood: 'tongue',
      w: 1,
      fx: null,
      lines: ['略略略', '戳不到戳不到', '（灵活地闪开）'],
    },
    {
      mood: 'shy',
      w: 1,
      fx: null,
      lines: ['（缩成一团）', '唔…别戳那里', '（捂住脸）'],
    },
    {
      mood: 'confused',
      w: 1,
      fx: null,
      lines: ['诶？', '（歪头）干嘛呀', '主人你今天很闲嘛', '（一脸不解）'],
    },
    {
      mood: 'playful',
      w: 1.2,
      fx: null,
      lines: ['（用本子挡了一下）', '（抱着本子躲开）', '不给戳', '（拿本子当盾牌）'],
    },
    {
      mood: 'happy',
      w: 1.2,
      fx: null,
      lines: ['（被戳得晃了一下）', '嘻嘻', '（笑得肩膀一抖一抖）'],
    },
    {
      mood: 'alert',
      w: 0.6,
      fx: null,
      lines: ['！（猛地一抖）', '呀！吓死人家了', '（整个人弹了一下）'],
    },
    {
      mood: 'smug',
      w: 0.8,
      fx: null,
      lines: ['戳够了没呀', '（双手叉腰）就这点力气？', '本鲸可是很结实的'],
    },
    {
      mood: 'sweat',
      w: 0.5,
      fx: null,
      lines: ['（手忙脚乱地护住本子）', '别、别戳了，本子要掉了', '（冷汗）'],
    },
    {
      mood: 'gloomy',
      w: 0.4,
      fx: null,
      lines: ['（幽怨地看着你）', '……人家记住了', '（角落里长蘑菇）'],
    },
    {
      mood: 'pout',
      w: 0.6,
      fx: null,
      lines: ['别戳啦，人家只想要白饭', '（护住并不存在的碗）', '戳一下换一粒米，成交吗'],
    },
  ]

  function poke(clientX, clientY) {
    if (ui.root.classList.contains('dshp-hidden')) return

    // —— 干活时点她：也互动，但**不动底层状态** ——
    // 反应是一次性的（两秒左右），过期后自动回到「正在做的那件事」，
    // 所以既有了互动，又不会把工作状态搞乱。
    if (agent.status !== 'idle') {
      closePanels()
      qBounce(1)
      // 「点的时候她会看」：干活时被戳就抬头看鼠标（低头看本子的姿势也让开）
      gazeDetach(1800)
      gaze.biasTarget = 0
      const busyHit = pickFresh(POKE_BUSY, 'busy')
      act({
        mood: busyHit.mood,
        line: pickFresh(busyHit.lines, 'busy-line-' + busyHit.mood),
        ms: 2200,
      })
      return
    }

    const now = performance.now()
    pokeRecord(now)
    const tier = pokeTier(now)

    closePanels()
    wakeUp()
    qBounce(tier.furious ? 1.35 : tier.rapid ? 1.15 : 1)
    gazeDetach(2200)

    // —— 真炸毛：只有手速党才见得到，而且一次只出一条 ——
    if (tier.furious) {
      pokeState.angerAt = now
      // 别每次都同一张脸：生气/警觉/嘟嘴里挑一个，台词也从扩过的池子里抽
      const face = pick(['grumpy', 'grumpy', 'alert', 'pout'])
      act({ mood: face, props: IDLE_PROPS, line: pickFresh(SAY.many, 'many'), ms: 2600 })
      return
    }

    // —— 快但没到炸毛：被戳痒了，可爱地抗议，绝不跳进生气 ——
    // 撒娇也有最小间隔，免得连点变成刷屏；间隔内的点击继续走下面的普通反应，
    // 所以「手快」的体验是「她一直在躲」，而不是「她一直生气」。
    if (tier.rapid && now - pokeState.softAt > POKE_TIER.softCool) {
      pokeState.softAt = now
      act({
        mood: pick(['pout', 'shy', 'tongue', 'alert']),
        props: IDLE_PROPS,
        line: pickFresh(SAY.ticklish, 'ticklish'),
        ms: 2400,
      })
      return
    }

    // 原作者把「鲸鱼喷水」这个动画绑在**左键点她**上（按键表：LeftMouseButton
    // → 喷水.motion3.json）。所以戳她的时候偶尔真的喷一下水——照人家的设计来。
    if (Math.random() < 0.12) {
      playAction('splash')
      return
    }

    const r = ui.stage.getBoundingClientRect()
    const head = (clientY - r.top) / Math.max(1, r.height) < 0.45
    const hit = pickFresh(head ? POKE_HEAD : POKE_BODY, head ? 'head' : 'body')
    const ms = 2600

    // 一次点击 = 一个表情 + 一句台词 +（至多）一个粒子特效。
    // act() 会先把上一次整个停掉，所以点一下永远是干净的单次反应。
    act({
      mood: hit.mood,
      line: pickFresh(hit.lines, 'line-' + hit.mood),
      heart: hit.fx === 'heart',
      ms,
    })
  }

  // ——————————————————————————————————————————————————————————————
  // 八点五、菜单项「点了会怎样」
  // ——————————————————————————————————————————————————————————————

  /** 表情参数名 → 菜单里那个中文按钮名（同一个表情可能对应好几个情绪）。 */
  function faceLabel(expr) {
    if (!expr) return '平常脸'
    for (const [key, e] of Object.entries(MOOD_FACE)) {
      if (e === expr && FACE_ACT[key]) return expr
    }
    return expr
  }

  /** 菜单顶上的「现在是什么状态」——免得主人不知道当前挂着什么。 */
  function menuStatusLine() {
    const parts = []
    parts.push(rig.user.face ? `${rig.user.face}（手动）` : faceLabel(rig.face))
    const userProps = Array.from(rig.userProps)
      .map((e) => Object.values(ALL_TOGGLES).find((d) => d.expr === e))
      .filter(Boolean)
      .map((d) => d.label)
    const baseProps = rig.base.props
      .map((e) => Object.values(ALL_TOGGLES).find((d) => d.expr === e))
      .filter(Boolean)
      .map((d) => d.label)
    if (userProps.length) parts.push('自己戴的：' + userProps.join('、'))
    if (baseProps.length) parts.push('常态：' + baseProps.join(' + '))
    if (device.out) parts.push('手机已掏出')
    const st = agent.status === 'idle' ? '待机' : '干活中'
    return `${st} · 现在：` + parts.join(' · ')
  }

  /**
   * 演一个菜单项。
   *
   * 主人抱怨「点了没用、就卡在那」——所以菜单里每一项都不是「只是亮起来」，
   * 而是**一句话 + 一个表情 +（最多）一个小道具**，而且：
   *   · act() 先把上一次整个收掉 → 永远只有一件在演，不叠
   *   · 给一个到点就过期的 TTL → 不会卡住
   *   · 台词只在真的说了话的时候才占用气泡，不会连点刷屏
   */
  function playItem(kind, key) {
    const table = kind === 'face' ? FACE_ACT : kind === 'decor' ? PROP_ACT : SCENE_ACT
    const info = (table && table[key]) || {}
    const lines = info.lines || (SAY[key] ? SAY[key] : null)
    const line = lines && lines.length ? pickFresh(lines, kind + '-' + key) : undefined
    const mood = info.mood || (kind === 'face' ? key : 'happy')
    // 菜单表情是临时的：3.6 秒（主人说的「三四秒、反正会被覆盖掉」）
    const ms = info.ms || (kind === 'face' ? 3600 : 3200)
    if (info.lean) {
      // 低头看本子（眼镜类的「仔细看看」）。空闲兜底会把它复位，不会留后遗症。
      gaze.biasTarget = -0.3
      setTimeout(() => {
        if (!rig.override) gaze.biasTarget = 0
      }, ms + 400)
    }
    // 装饰/场景的开关本身由 setProp 负责（那一层是「一直存在」），
    // 这里只负责「她说点什么 + 换个配得上的表情」。
    return act({ mood, line, props: IDLE_PROPS, heart: !!info.heart, ms })
  }

  /**
   * 演一个一次性动作（猫爪、比耶、心跳、蛋包饭…）。
   *
   * 关键区别：**动作只走 override 层**（act 的 TTL 到期就没了），
   * 绝不写进 rig.userProps，所以不会像装饰品/场景那样一直挂着。
   * 「蛋包饭挤完酱就消失」就是靠这个——表达式蛋包饭 + 挤番茄酱动作，
   * 到点一起收走。
   */
  function playAction(key) {
    const a = ACTIONS[key]
    if (!a) return 0
    // 前置模式（照原作者的设计：自拍类得先掏出手机）
    if (a.requires) {
      const need = ALL_TOGGLES[a.requires]
      if (need && need.device) takeDeviceOut()
      else setProp(a.requires, true)
    }
    const expr = a.expr && EXPR[a.expr] ? a.expr : null
    const motion = a.motion && manifest && manifest.motions && manifest.motions[a.motion] ? a.motion : undefined
    // mood === null 的动作（自带表情变化的动画）**不压自己的脸**：
    // 压上去就是「冲突/覆盖」，会把她动画里的表情盖掉。
    const noFace = a.mood === null
    return act({
      mood: noFace ? 'neutral' : a.mood || 'happy',
      face: noFace && !expr ? null : undefined,
      props: expr ? IDLE_PROPS.concat([expr]) : IDLE_PROPS,
      line: pickFresh(a.lines, 'action-' + key),
      heart: !!a.heart,
      motion,
      ms: a.ms || 3000,
    })
  }

  // ——————————————————————————————————————————————————————————————
  // 八点七、HUD：余额 / 本轮消耗 / 峰谷计价
  // ——————————————————————————————————————————————————————————————
  //
  // 主人要的东西（原话）：右键不再是设置，而是一个醒目的框，里面要有
  //   · 剩余钱数
  //   · 每轮结束弹出「本轮消耗」
  //   · 现在是峰还是谷（**峰=红，谷=绿**）
  //   · 距离切换还有多久
  // 而且「不能跟对话冲突、优先级最高、盖在上面」。
  //
  // 数据来源不自己造：DSH 里装的 dsh-whale-widget 已经在做余额与记账，
  // 它把结果开成了同源接口，我们直接读（口径天然一致，不会两边算出不同数字）：
  //   GET /dsh-whale/balance.json     → {ok,totalBalance,currency,isPeak,peakNextChangeAt,todayUsage,...}
  //   GET /dsh-whale/last-turn.json   → {ok,seq,turn,amount,tokens,ts}
  // 没装那个插件时优雅降级：能显示的照常显示，显示不了的写「—」并说明原因。

  // 数据源优先级：
  //   1) 我们宿主自己的 /dsh-pet/hud —— 自带余额 + 峰谷 + 计价，不依赖任何别的插件
  //   2) dsh-whale-widget 的 /dsh-whale/* —— 装了它就用它的账本（口径统一，数字更好对账）
  const HUD_SELF = '/dsh-pet/hud'
  const HUD_SRC = {
    balance: '/dsh-whale/balance.json',
    lastTurn: '/dsh-whale/last-turn.json',
  }
  const hud = {
    open: false,
    data: null, // balance.json 的内容
    turn: null, // last-turn.json 的内容
    seq: 0, // 用 seq 判断「是不是新的一轮」
    err: '',
    tick: null, // 倒计时定时器
    hideAt: 0, // 自动弹出后多久自己收（鼠标悬停时暂停）
    hideTimer: null,
  }

  const money = (v, cur) => {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
    const sym = (cur || 'CNY') === 'CNY' ? '¥' : (cur || '') + ' '
    return sym + Number(v).toFixed(2)
  }

  /** 距切换还有多久：写成人能读的「3 小时 12 分」。 */
  function humanLeft(sec) {
    if (!Number.isFinite(sec) || sec <= 0) return '即将切换'
    const h = Math.floor(sec / 3600)
    const m = Math.round((sec % 3600) / 60)
    if (h <= 0) return m + ' 分钟'
    return h + ' 小时 ' + (m < 10 ? '0' + m : m) + ' 分'
  }

  function hudRender() {
    if (!ui || !ui.hud) return
    const h = ui.hud
    const d = hud.data || {}
    const peak = d.isPeak === true
    h.badge.textContent = d.isPeak === undefined || d.isPeak === null ? '—' : peak ? '峰' : '谷'
    h.badge.className = 'dshp-hud-tag ' + (peak ? 'dshp-peak' : 'dshp-valley')
    if (d.ok === false && d.code === 'NO_KEY') {
      h.money.textContent = '未配置'
      h.foot.textContent = '没读到 DEEPSEEK_API_KEY，所以看不到余额。\n在 DSH 里配好 key 就能显示。'
    } else if (d.ok === false) {
      h.money.textContent = '—'
    } else if (!hud.data) {
      h.money.textContent = '—'
    } else {
      h.money.textContent = money(d.totalBalance, d.currency)
      h.currency.textContent = d.currency || 'CNY'
    }
    h.today.textContent = d.todayUsage === undefined || d.todayUsage === null ? '—' : money(d.todayUsage, d.todayUsageCurrency || d.currency)

    // 本轮消耗：金额 + tokens（token 数字算流水账，安静模式下不显示，钱照常显示）
    const t = hud.turn || {}
    if (t.amount === undefined || t.amount === null) {
      h.turn.textContent = '—'
    } else {
      h.turn.textContent =
        money(t.amount, d.currency) + (CFG.repeatChat && t.tokens ? ' · ' + Number(t.tokens).toLocaleString() + ' tokens' : '')
    }

    // 倒计时：宿主给的切换时刻是权威（含周末/法定节假日规则）
    if (d.peakNextChangeAt) {
      const left = d.peakNextChangeAt - Math.floor(Date.now() / 1000)
      hud.left = left
      h.countdown.textContent = humanLeft(left)
    } else {
      h.countdown.textContent = '—'
    }

    const src = []
    if (!hud.source) src.push('数据：读不到余额接口')
    else if (hud.source === 'self') src.push('数据：桌宠自带记账' + (d.version ? ' v' + d.version : ''))
    else src.push('数据：dsh-whale-widget' + (d.version ? ' v' + d.version : ''))
    if (hud.err) src.push(hud.err)
    if (t.ts) src.push('本轮：' + new Date(t.ts).toLocaleTimeString('zh-CN', { hour12: false }))
    src.push(hud.fetchedAt ? '更新于 ' + new Date(hud.fetchedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '')
    h.foot.textContent = src.filter(Boolean).join('\n')
  }

  let hudLastForce = 0
  const grabJson = (url) =>
    fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)

  async function hudFetch(force) {
    // 节流：force 刷新 60 秒最多一次（右键连点不该反复打 DeepSeek 的余额接口）
    if (force && Date.now() - hudLastForce < 60000) force = false
    if (force) hudLastForce = Date.now()

    // 先问自己宿主：一条就够（余额 + 峰谷 + 本轮 + 今日）
    const self = await grabJson(HUD_SELF + (force ? '?refresh=1' : ''))
    if (self && self.ok) {
      hud.source = 'self'
      hud.err = ''
      hud.data = {
        ok: true,
        version: self.version,
        isPeak: self.isPeak,
        peakNextChangeAt: self.peakNextChangeAt,
        totalBalance: self.balance && self.balance.ok ? self.balance.totalBalance : undefined,
        currency: (self.balance && self.balance.currency) || 'CNY',
        todayUsage: self.today ? self.today.amount : undefined,
        todayUsageCurrency: (self.balance && self.balance.currency) || 'CNY',
      }
      if (self.balance && self.balance.ok === false) {
        hud.data.code = self.balance.code
        hud.data.errText = self.balance.error
      } else if (self.balance && self.balance.stale) {
        hud.err = '余额这次没刷新成功，显示的是上一次的数字'
      }
      if (self.turn) {
        hud.turn = { ok: true, seq: self.turn.seq, turn: self.turn.turn, amount: self.turn.amount, tokens: self.turn.tokens, ts: self.turn.ts }
        hud.seq = self.turn.seq || 0
      }
      hud.fetchedAt = Date.now()
      hudRender()
      return { self }
    }

    // 退回 dsh-whale-widget（装了就有，口径与挂件一致）
    const [bal, lt] = await Promise.all([grabJson(HUD_SRC.balance), grabJson(HUD_SRC.lastTurn)])
    hud.err = ''
    if (bal && bal.ok === true) {
      hud.source = 'widget'
      hud.data = bal
    } else if (bal && bal.ok === false) {
      hud.source = 'widget'
      hud.data = bal
    } else {
      hud.source = null
      hud.data = null
      hud.err = '余额读不到：宿主接口和 dsh-whale-widget 都没响应'
    }
    if (lt && lt.ok) {
      hud.turn = lt
      hud.seq = lt.seq || 0
    }
    hud.fetchedAt = Date.now()
    hudRender()
    return { bal, lt }
  }

  function hudTick() {
    if (!hud.open) return
    if (hud.left !== undefined && hud.data && hud.data.peakNextChangeAt) {
      hud.left = hud.data.peakNextChangeAt - Math.floor(Date.now() / 1000)
      ui.hud.countdown.textContent = humanLeft(hud.left)
      // 跨过切换点就重新拉一次（峰谷真的变了）
      if (hud.left <= 0 && !hud.reloading) {
        hud.reloading = true
        setTimeout(() => {
          hud.reloading = false
          hudFetch(true)
        }, 1500)
      }
    }
    // 自动弹出后到点自己收（鼠标在上面就不收，主人在看）
    if (hud.hideAt && Date.now() > hud.hideAt && !hud.hover) closeHud()
  }

  function openHud(opts) {
    opts = opts || {}
    if (!ui || !ui.hud) return
    closePanels() // 别和菜单/输入框叠在一起
    hud.open = true
    ui.hud.el.classList.add('dshp-on')
    if (opts.flash) {
      ui.hud.el.classList.remove('dshp-flash')
      void ui.hud.el.offsetWidth // 强制重排，让动画能重放
      ui.hud.el.classList.add('dshp-flash')
    }
    clampPanels()
    hudFetch(opts.refresh === true)
    if (!hud.tick) hud.tick = setInterval(hudTick, 1000)
    if (opts.autoHideMs) {
      hud.hideAt = Date.now() + opts.autoHideMs
    } else {
      hud.hideAt = 0
    }
  }

  function closeHud() {
    if (!ui || !ui.hud) return
    hud.open = false
    hud.hideAt = 0
    ui.hud.el.classList.remove('dshp-on', 'dshp-flash')
    if (hud.tick) {
      clearInterval(hud.tick)
      hud.tick = null
    }
  }

  /**
   * 一轮结束时弹出来（主人要的「本轮消耗都会在这弹出来」）。
   * 等 1.2 秒再弹：宿主的记账是收到事件后才落账的，太早拉会拿到上一轮的数。
   */
  function hudPopTurnEnd() {
    const before = hud.seq
    setTimeout(async () => {
      if (hud.open) {
        await hudFetch(false)
        return
      }
      await hudFetch(false)
      openHud({ autoHideMs: 9000 })
      // seq 没变说明账还没落，再补一次
      if (hud.seq === before) setTimeout(() => hudFetch(false), 1800)
    }, 1200)
  }

  // ——————————————————————————————————————————————————————————————
  // 九、输入框 / 菜单
  // ——————————————————————————————————————————————————————————————

  /**
   * 隐藏 / 恢复。
   *
   * 之前「隐藏之后再也找不回来」是因为小把手的显示条件写成了
   * `.dshp-root.dshp-hidden .dshp-tab`——把手挂在 body 上，不在 root 里，
   * 后代选择器永远匹配不到。现在改成 body 级类，并且收进这一个函数，
   * 保证「隐藏态」和「把手可见」永远同步。
   */
  /**
   * 桌面壳（macOS 原生 App）的桥。
   * 壳子启动时会在页面里设 window.__DSHPET_SHELL__ = true，并挂一个 dshpetshell 消息通道。
   * 有它的时候：① 收起/展开走消息，立刻响应，不用等轮询；
   *             ② 设置页多出「收起成悬浮小球」和「彻底关闭桌宠应用」。
   */
  const shell = {
    on: !!(
      window.__DSHPET_SHELL__ &&
      window.webkit &&
      window.webkit.messageHandlers &&
      window.webkit.messageHandlers.dshpetshell
    ),
    post(msg) {
      try {
        window.webkit.messageHandlers.dshpetshell.postMessage(msg)
      } catch (e) {}
    },
  }

  function setHidden(hidden) {
    ui.root.classList.toggle('dshp-hidden', !!hidden)
    document.body.classList.toggle('dshp-pet-hidden', !!hidden)
    if (hidden) ui.bubble.hide()
    saveLayout({ hidden: !!hidden })
    if (shell.on) shell.post(hidden ? 'hidden' : 'shown')
    // 隐藏是主人主动点的「现在不用显示她」——这种情况停渲染循环零风险
    // （反正看不见，不存在「切回来感觉卡住」的问题，那个顾虑只针对「被遮挡但
    // 没被隐藏」的场景，这里不碰）。桌面壳为了不让她显得卡顿，关掉了
    // Electron 的后台降频（backgroundThrottling:false），所以 document.hidden
    // 几乎不会在桌面壳里变 true——真正能捕捉「用户已经不需要她画面」的
    // 时机，只有这个显式的隐藏开关。
    if (app) {
      if (hidden) app.ticker.stop()
      else if (!document.hidden) app.ticker.start()
    }
  }

  /**
   * 一键重置所有状态：回到「平常脸 + 正常坐姿 + 手里本子和笔」。
   * 主人要的是「不管我刚才把哪个特效点出来了、或者它自己卡在什么状态，
   * 点一下就全回正常」。
   *
   * 主人报过的 bug：「工作模式下点了蛋包饭/手机就一直卡着，连一键重置都救不回来。」
   * 查出来的真凶有两个：
   *   1. 重置只清了三层状态，**没停干活轮播**（work.active 还是 true）——
   *      于是 9~14 秒后 workTick 又把底层状态推回「看资料 + 星星眼」，
   *      看起来就是「表情怎么都回不去」；
   * 现在补上了：重置 = 连干活轮播、小设备、所有道具层一起归零。
   */
  function resetEverything() {
    endWork() // 停干活轮播（否则几秒后底层状态又被推回工作脸）
    rig.userProps.clear()
    rig.user = { face: null, until: 0 }
    rig.override = null
    rig.burst = null
    rig.weight.clear()
    // 兜底：所有道具一层不留（万一以后有人加了新的道具层，这里也不会漏）
    for (const key of Object.keys(ALL_TOGGLES)) {
      const expr = propExpr(key)
      if (expr) rig.userProps.delete(expr)
    }
    rig.props = new Set()
    device.out = false
    agent.toolProp = null
    agent.hasStream = false
    agent.sleeping = false
    gaze.biasTarget = 0
    gaze.biasY = 0
    gaze.detachUntil = 0
    gaze.stepRate = 0
    gaze.driftX = 0
    gaze.driftY = 0
    gaze.tx = 0
    gaze.ty = 0
    rig.talking = false
    setBase('neutral', IDLE_PROPS)
    stopMotion() // 回到模型默认姿势 = 正常坐姿
    closePanels()
    ui.bubble.hide()
    setHidden(false)
    const keep = { height: readLayout().height || CFG.height }
    saveLayout({ props: [], fit: 'full', x: null, y: null, hidden: false, ...keep })
    for (const k of ['left', 'top', 'right', 'bottom']) ui.root.style[k] = ''
    fitModel()
    applyPosition(readLayout())
    return true
  }

  /** 给面板右上角加一个「×」——主人说之前不好关。 */
  function addCloseButton(panel, onClose) {
    const b = $('button', 'dshp-close', '×')
    b.title = '关闭'
    b.setAttribute('aria-label', '关闭')
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      // 以前不管哪个面板都去 closePanels()，于是「钱包」的 × 点了没反应
      // （钱包不是 closePanels 管的），主人报的「关闭键是坏的」就是这个。
      if (typeof onClose === 'function') onClose()
      else closePanels()
    })
    panel.appendChild(b)
  }

  function closePanels() {
    ui.composer.el.classList.remove('dshp-on')
    ui.menu.el.classList.remove('dshp-on')
    ui.root.classList.remove('dshp-open')
  }

  function bindComposer(u) {
    const { ta, send, cancel } = u.composer
    const stop = (e) => e.stopPropagation()
    for (const ev of ['keydown', 'keyup', 'keypress']) ta.addEventListener(ev, stop)
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        doSend()
      }
    })
    send.addEventListener('click', doSend)
    cancel.addEventListener('click', async () => {
      try {
        const r = await fetch(BASE + '/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        const j = await r.json()
        u.bubble.show(j.ok ? '打断啦' : '打断失败：' + (j.error || '未知'), { name: 'DS 鲸鱼娘', ttl: 2000 })
      } catch (err) {
        u.bubble.show('打断失败：' + err.message, { name: 'DS 鲸鱼娘', ttl: 2600 })
      }
    })

    async function doSend() {
      const text = ta.value.trim()
      if (!text) {
        ta.focus()
        return
      }
      send.disabled = true
      try {
        const r = await fetch(BASE + '/say', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
        const j = await r.json()
        if (!j.ok) throw new Error(j.error || '发送失败')
        ta.value = ''
        closePanels()
        act({ mood: 'listening', props: IDLE_PROPS, line: text, ms: 2600 })
      } catch (err) {
        u.bubble.show('发不出去：' + err.message, { name: 'DS 鲸鱼娘', sticky: true })
      } finally {
        send.disabled = false
      }
    }
  }

  function openMenu(which) {
    closeHud() // 菜单和 HUD 不同时占屏幕
    ui.root.classList.add('dshp-open')
    // 立刻夹一次（getBoundingClientRect 会强制重排，拿到的是最终横向位置），
    // 再在下一帧补一次——只等 rAF 的话，测试/快照可能量到还没夹的面板
    clampPanels()
    // 面板是以模型为中心左右展开的，蹲在角落时右半边会跑到屏幕外——
    // 等布局落定后夹回视口内（关闭按钮和滑块必须点得到）
    requestAnimationFrame(() => clampPanels())
    // 气泡和面板都挂在桌宠上方，同时出现会互相挡住——开面板就把气泡收起来
    ui.bubble.hide()
    if (which === 'talk') {
      ui.menu.el.classList.remove('dshp-on')
      ui.composer.el.classList.add('dshp-on')
      setTimeout(() => ui.composer.ta.focus(), 60)
    } else {
      ui.composer.el.classList.remove('dshp-on')
      renderPane(ui.menu.focused || 'face')
      ui.menu.el.classList.add('dshp-on')
    }
    // 面板真正显示之后再夹一次（上面那次夹在 class 加之前，量不到它）
    clampPanels()
  }

  function bindMenu(u) {
    const TABS = [
      ['face', '表情'],
      ['decor', '装饰'],
      ['scene', '场景'],
      ['action', '动作'],
      ['setting', '设置'],
    ]
    u.menu.focused = 'face'
    for (const [id, label] of TABS) {
      const b = $('button', 'dshp-tab-btn', label)
      b.dataset.tab = id
      if (id === u.menu.focused) b.classList.add('dshp-active')
      b.addEventListener('click', () => {
        u.menu.focused = id
        for (const el of u.menu.tabs.children) el.classList.toggle('dshp-active', el.dataset.tab === id)
        renderPane(id)
      })
      u.menu.tabs.appendChild(b)
    }
    // 主人要求：说话按钮点一次开、再点一次关（以前再点只会重新打开，像关不掉）
    u.dock.children[0].addEventListener('click', () => {
      if (u.composer.el.classList.contains('dshp-on')) closePanels()
      else openMenu('talk')
    })
    u.dock.children[1].addEventListener('click', () => {
      if (u.menu.el.classList.contains('dshp-on')) closePanels()
      else openMenu('menu')
    })
    u.dock.children[2].addEventListener('click', () => {
      closePanels()
      setHidden(true)
    })
    // 第 4 个：打开 DeepSeek Harness。桌面壳里交给原生用默认浏览器打开，
    // 浏览器版直接新开一个标签页。
    u.dock.children[3].addEventListener('click', () => {
      if (shell.on) shell.post('open-dsh')
      else window.open(BASE.replace(/\/dsh-pet$/, '') + '/', '_blank')
    })
  }

  function renderPane(id) {
    const panes = ui.menu.panes
    panes.textContent = ''
    // 顶上永远有一行「她现在是什么状态」，免得一堆按钮里看不出哪个是开着的
    panes.appendChild($('div', 'dshp-hint dshp-now', menuStatusLine()))
    if (id === 'face') {
      const grid = $('div', 'dshp-grid')
      // 主人抱怨「星星眼重复了两次」——一个表情（参数组合）本来对应好几种情绪，
      // 旧的菜单按情绪列，于是同一个表情出现好几遍。这里按**表情**去重：
      // 一个表情只出一个按钮，鼠标悬停能看到它代表哪些情绪。
      const byExpr = new Map()
      // 主人明确不要的只有「圈圈眼（晕晕）」；呆呆眼另有判断。
      // 「闭眼口水」是原作者按键表里的正经表情（Alt+T），保留。
      const BANNED_MOODS = new Set(['dizzy'])
      for (const key of Object.keys(MOOD_FACE)) {
        if (key === 'neutral') continue
        const expr = MOOD_FACE[key]
        if (!expr || BANNED_MOODS.has(key)) continue
        if (!EXPR[expr] || expr === '呆呆眼' || expr === '晕晕') continue
        if (!byExpr.has(expr)) byExpr.set(expr, [])
        byExpr.get(expr).push(key)
      }
      const neutral = $('button', 'dshp-chip', '平常')
      if (!rig.override && !rig.user.face) neutral.classList.add('dshp-on')
      neutral.title = '立刻回到平常脸（她自己的表情也交还给她）'
      neutral.addEventListener('click', () => {
        clearUserFace()
        clearReaction()
        act({ mood: 'neutral', props: IDLE_PROPS, ms: 800 })
        renderPane('face')
      })
      grid.appendChild(neutral)
      for (const [expr, keys] of byExpr) {
        // 挑一个「有专属台词」的情绪名当代表，这样每个按钮点了都真有反应
        const rep = keys.find((k) => FACE_ACT[k]) || keys[0]
        const lines = (FACE_ACT[rep] && FACE_ACT[rep].lines) || []
        const b = $('button', 'dshp-chip', expr)
        // 亮着的判断看**当前这一次性表演**，不是看手动层：菜单里的表情是临时的，
        // 谁最后一个说话谁亮。
        if (rig.override && rig.override.face === expr) b.classList.add('dshp-on')
        b.title = keys.join(' / ') + (lines.length ? `\n她会说：${lines[0]}` : '')
        b.addEventListener('click', () => {
          // 主人要的规矩：菜单表情**不是手动常驻**，是「点一下演三四秒」——
          //   · 3~4 秒后自己让位，平常状态永远回到「平常脸」
          //   · 期间任何新表情（她自己挑的 / agent 事件 / 你再点一个）都会把它顶掉
          // 所以这里不写 30 秒的 rig.user 手动层，只走一次性 override。
          clearUserFace()
          playItem('face', rep)
          renderPane('face')
        })
        grid.appendChild(b)
      }
      panes.append(
        grid,
        $('div', 'dshp-hint', '点一下 = 换脸 + 说一句配好的话，**三四秒后自己让位**（平常状态永远是平常脸）。\n期间她自己的表情、agent 事件、或者你再点一个，都会把它顶掉。'),
      )
      return
    }
    if (id === 'decor' || id === 'scene') {
      const src = id === 'decor' ? PROPS : SCENES
      const grid = $('div', 'dshp-grid')
      for (const [key, def] of Object.entries(src)) {
        if (!EXPR[def.expr]) continue
        // 「开着」看的是**主人自己开的那一层**。用 rig.props 判断的话，
        // 本子/笔这种常态道具永远显示成已开启，再点也没反应——就是主人说的「点了没用」。
        const on = itemOn(key, def)
        const b = $('button', 'dshp-chip', def.label)
        if (on) b.classList.add('dshp-on')
        const lines = (SCENE_ACT[key] && SCENE_ACT[key].lines) || (PROP_ACT[key] && PROP_ACT[key].lines) || []
        const tip = on ? '再点一下收起来' : lines.length ? `点了她会说：${lines[0]}` : ''
        b.title = def.key ? `${tip}\n（原作者热键：${def.key}）` : tip
        b.addEventListener('click', () => {
          const nowOn = itemOn(key, def)
          setProp(key, !nowOn)
          if (!nowOn) playItem(id, key)
          renderPane(id)
        })
        grid.appendChild(b)
      }
      const row = $('div', 'dshp-row')
      const clear = $('button', 'dshp-btn', '全部摘掉')
      clear.addEventListener('click', () => {
        clearProps()
        act({ mood: 'neutral', props: IDLE_PROPS, line: pickFresh(SAY.tidy, 'tidy'), ms: 2000 })
        renderPane(id)
      })
      row.appendChild(clear)
      panes.append(
        grid,
        row,
        $(
          'div',
          'dshp-hint',
          id === 'decor'
            ? '装饰品戴上就一直留着，直到你再点一下摘掉（同类自动互斥：眼镜只戴一副、贴纸只贴一张）。'
            : '场景摆设也是「摆着不走」——桌布、鲸鱼、巴菲这些会一直留着，再点一下才收。',
        ),
      )
      return
    }
    if (id === 'action') {
      const grid = $('div', 'dshp-grid')
      for (const key of ACTION_KEYS) {
        const a = ACTIONS[key]
        if (a.expr && !EXPR[a.expr]) continue
        if (a.motion && !(manifest && manifest.motions && manifest.motions[a.motion])) continue
        const b = $('button', 'dshp-chip', a.label)
        b.title = `点了她会说：${a.lines[0]}` + (a.key ? `\n（原作者热键：${a.key}）` : '')
        b.addEventListener('click', () => {
          playAction(key)
          renderPane('action')
        })
        grid.appendChild(b)
      }
      panes.append(
        grid,
        $('div', 'dshp-hint', '动作是**一次性的**：演一遍就自己消失，不会一直挂着。\n（要一直留着的，去「装饰」和「场景」两页——蛋包饭也在这页，挤完酱就没了。）'),
      )
      return
    }
    // setting
    const box = $('div')
    const label = $('label', 'dshp-label')
    label.append($('span', null, '大小'))
    const range = document.createElement('input')
    range.type = 'range'
    range.min = '150'
    range.max = '720'
    range.value = String(clamp(Number(readLayout().height) || CFG.height, 150, 720))
    range.title = '也可以直接拖（点 − / + 更省事）'
    // 主人要求：大小主要用「加 / 减」点一下调，不要只能拖滑块
    const stepSize = (delta) => {
      const next = clamp(Number(range.value) + delta, 150, 720)
      range.value = String(next)
      sizeOut.textContent = next + 'px'
      fitModel(next)
      saveLayout({ height: next })
      clampPanels()
    }
    const mkStep = (txt, delta) => {
      const b = $('button', 'dshp-btn dshp-step', txt)
      b.title = (delta > 0 ? '放大' : '缩小') + '（每下 ' + Math.abs(delta) + 'px）'
      b.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        stepSize(delta)
      })
      return b
    }
    const sizeOut = $('span', null, range.value + 'px')
    sizeOut.style.minWidth = '46px'
    sizeOut.style.fontVariantNumeric = 'tabular-nums'
    const stepRow = $('div', 'dshp-row')
    stepRow.append(mkStep('−', -20), sizeOut, mkStep('+', 20))
    // 拖的时候冻住 UI 缩放（见 sizingSize），松手再让面板跟上新尺寸——
    // 这样滑块轨道全程钉在原地，可以一路拖到底。
    const beginSize = () => {
      sizingSize = true
      ui.root.classList.add('dshp-sizing')
    }
    const endSize = () => {
      if (!sizingSize) return
      sizingSize = false
      ui.root.classList.remove('dshp-sizing')
      fitModel(Number(range.value))
      saveLayout({ height: Number(range.value) })
      clampPanels()
    }
    range.addEventListener('pointerdown', beginSize)
    range.addEventListener('pointerup', endSize)
    range.addEventListener('pointercancel', endSize)
    range.addEventListener('change', endSize)
    range.addEventListener('keydown', beginSize)
    range.addEventListener('keyup', endSize)
    range.addEventListener('input', () => {
      sizeOut.textContent = Number(range.value) + 'px'
      fitModel(Number(range.value))
      saveLayout({ height: Number(range.value) })
      if (!sizingSize) clampPanels()
    })
    label.appendChild(range)
    box.appendChild(label)
    box.appendChild(stepRow)

    // 视线灵敏度：实时生效，直接写进 CFG
    const g0 = gazeCfg()
    const mkGaze = (label, key, min, max, step, value, fmt) => {
      const l = $('label', 'dshp-label')
      l.append($('span', null, label))
      const r = document.createElement('input')
      r.type = 'range'
      r.min = String(min); r.max = String(max); r.step = String(step)
      r.value = String(value)
      const out = $('span', null, fmt(Number(r.value)))
      out.style.minWidth = '38px'
      out.style.textAlign = 'right'
      out.style.opacity = '.7'
      r.addEventListener('input', () => {
        CFG[key] = Number(r.value)
        out.textContent = fmt(Number(r.value))
      })
      l.append(r, out)
      return l
    }
    box.append(
      $('div', 'dshp-hint', '视线灵敏度（拖动即时生效）'),
      mkGaze('跟随幅度', 'gazeGain', 0, 1, 0.02, g0.gain, (v) => v.toFixed(2)),
      mkGaze('跟随速度', 'gazeRate', 0.3, 4, 0.1, g0.rate, (v) => v.toFixed(1)),
      mkGaze('跟随范围', 'gazeRadius', 0, 2000, 50, g0.radius, (v) => (v <= 0 ? '整屏' : String(v))),
    )

    const row1 = $('div', 'dshp-row')
    const eyeBtn = $('button', 'dshp-btn', CFG.lookAtCursor ? '视线跟随：开' : '视线跟随：关')
    eyeBtn.addEventListener('click', () => {
      CFG.lookAtCursor = !CFG.lookAtCursor
      eyeBtn.textContent = CFG.lookAtCursor ? '视线跟随：开' : '视线跟随：关'
    })
    const mouthBtn = $('button', 'dshp-btn', CFG.talkMouth ? '说话口型：开' : '说话口型：关')
    mouthBtn.addEventListener('click', () => {
      CFG.talkMouth = !CFG.talkMouth
      mouthBtn.textContent = CFG.talkMouth ? '说话口型：开' : '说话口型：关'
    })
    const chatBtn = $('button', 'dshp-btn', CFG.repeatChat ? '安静模式：关' : '安静模式：开')
    chatBtn.title = '安静模式：开 = 气泡不照抄「你问了什么 / 她回了什么」，也不写过程流水账（工具路径、工具名、第 N 步、token 小结、分身提示）；她自己的台词、动作、表情、报错照常。（就是原来的「复述对话原文」开关，默认开）'
    chatBtn.addEventListener('click', () => {
      CFG.repeatChat = !CFG.repeatChat
      chatBtn.textContent = CFG.repeatChat ? '安静模式：关' : '安静模式：开'
      saveLayout({ repeatChat: CFG.repeatChat })
    })
    row1.append(eyeBtn, mouthBtn, chatBtn)

    const row0 = $('div', 'dshp-row')
    const resetAll = $('button', 'dshp-btn dshp-primary', '一键重置所有状态')
    resetAll.addEventListener('click', () => {
      resetEverything()
      renderPane('setting')
      ui.bubble.show('回到平常状态啦', { name: 'DS 鲸鱼娘', ttl: 2200 })
    })
    row0.appendChild(resetAll)
    box.append(row0, $('div', 'dshp-hint', '点它就把表情、道具、姿势、位置全部恢复成「拿本子拿笔」的正常状态。'))

    const row2 = $('div', 'dshp-row')
    const reset = $('button', 'dshp-btn', '回到角落')
    reset.addEventListener('click', () => {
      for (const k of ['left', 'top', 'right', 'bottom']) ui.root.style[k] = ''
      saveLayout({ x: null, y: null })
      applyPosition(readLayout())
    })
    const hide = $('button', 'dshp-btn', shell.on ? '隐藏桌宠（缩成贴边小球）' : '隐藏桌宠（右下角把手叫回来）')
    hide.addEventListener('click', () => {
      closePanels()
      setHidden(true)
    })
    row2.append(reset, hide)
    if (shell.on) {
      const row3 = $('div', 'dshp-row')
      const toBall = $('button', 'dshp-btn', '收起成悬浮小球')
      toBall.addEventListener('click', () => {
        closePanels()
        setHidden(true)
      })
      const quitApp = $('button', 'dshp-btn', '彻底关闭桌宠应用')
      quitApp.addEventListener('click', () => {
        ui.bubble.show('人家先退下了，想叫我就去「应用程序」里双击我～', { name: 'DS 鲸鱼娘', ttl: 2000 })
        setTimeout(() => shell.post('quit'), 220)
      })
      row3.append(toBall, quitApp)
      box.append(row3, $('div', 'dshp-hint', '「收起」= 缩成贴边的悬浮小球；「关闭」= 真正退出这个桌面 App。'))
    }
    box.append(
      row1,
      row2,
      $(
        'div',
        'dshp-hint',
        '拖动可以换位置；右键或 ⋯ 叫出菜单；双击直接开输入框。\n表情平时由她自己挑——你在这里选只是 30 秒的临时心情，她遇到正事会自己换回来。',
      ),
    )
    panes.appendChild(box)
    // 换页后面板高度会变，可能顶到屏幕外面去（立刻夹一次 + 下一帧兜底）
    clampPanels()
    requestAnimationFrame(() => clampPanels())
  }

  // ——————————————————————————————————————————————————————————————
  // 十、agent 事件 → 表演
  // ——————————————————————————————————————————————————————————————

  const agent = {
    status: 'idle',
    turn: 0,
    step: 0,
    toolProp: null,
    lastActivity: Date.now(),
    sleeping: false,
    hasStream: false,
    lastText: '',
    tokens: 0,
  }

  function connectSSE() {
    let es = null
    let retry = 0
    const open = () => {
      es = new EventSource(BASE + '/events')
      es.onopen = () => {
        retry = 0
        log('事件流已连接')
      }
      es.onmessage = (ev) => {
        let msg
        try {
          msg = JSON.parse(ev.data)
        } catch (e) {
          return
        }
        try {
          handleEvent(msg)
        } catch (err) {
          console.warn('[鲸鱼娘] 事件处理出错', msg && msg.t, err)
        }
      }
      es.onerror = () => {
        try {
          es.close()
        } catch (e) {}
        retry++
        setTimeout(open, Math.min(10000, 800 * retry))
      }
    }
    open()
  }

  function setStatus(next) {
    if (agent.status === next) return
    agent.status = next
    agent.lastActivity = Date.now()
    agent.sleeping = false
  }

  /* 「复述对话原文」开关（默认关）在本机就是**安静模式**，管两件事：
   *   1. 对话原文——'user'（你的原话）与 'delta'/'assistant'（她的回复原文）；
   *   2. 过程流水账——工具目标路径、工具名脚注、「正在思考 · 第 N 步」、
   *      「本轮 N tokens」、结算里的耗时/token 小结、分身提示。见 noteProcess()。
   * 她自己的台词（SAY./TOOL_LINE）、表情、动作、报错文案、余额 HUD 不受影响。 */
  function sayChat(text, opts) {
    if (!CFG.repeatChat) return
    ui.bubble.show(text, opts)
  }

  /* 过程脚注统一走这道门：安静模式下不写流水账。
   * 只压 note（脚注/小结），不碰 ui.bubble.show 的台词正文。 */
  function noteProcess(text) {
    if (!CFG.repeatChat) return
    ui.bubble.note(text)
  }

  function handleEvent(m) {
    switch (m.t) {
      case 'hello':
        agent.status = m.status || 'idle'
        break

      case 'user':
        setStatus('listening')
        rig.talking = false
        wakeUp()
        stopActing()
        setBase('listening', IDLE_PROPS)
        clearToolProp()
        sayChat(String(m.text || '').slice(0, 300), { name: '你', ttl: 3500 })
        break

      case 'turn-start':
        agent.turn = m.turn
        agent.hasStream = false
        agent.lastText = ''
        agent.tokens = 0
        setStatus('thinking')
        rig.talking = false
        startWork()
        stopActing()
        setBase('thinking', WORK_PROPS)
        ui.bubble.show(pick(SAY.start), { name: 'DS 鲸鱼娘', busy: true, sticky: true })
        break

      case 'step-start':
        agent.step = m.step
        setStatus('thinking')
        rig.talking = false
        if (!ui.bubble.visible) {
          ui.bubble.show(pickFresh(SAY.thinking, 'thinking'), { name: 'DS 鲸鱼娘', busy: true, sticky: true })
        } else {
          noteProcess('正在思考 · 第 ' + m.step + ' 步')
        }
        break

      case 'delta':
        if (m.kind === 'reasoning' && !CFG.showReasoning) return
        agent.lastActivity = Date.now()
        if (!agent.hasStream) {
          agent.hasStream = true
          setStatus('speaking')
          rig.talking = true
          setBase('happy', WORK_PROPS)
          sayChat('', { name: 'DS 鲸鱼娘', stream: true, sticky: true })
        }
        sayChat(m.text || '', { stream: true, sticky: true })
        break

      case 'assistant':
        agent.hasStream = false
        rig.talking = false
        if (m.interrupted) break
        if (m.text) {
          setStatus('speaking')
          agent.lastText = m.text.slice(0, 4000)
          sayChat(agent.lastText, { name: 'DS 鲸鱼娘', sticky: true })
        }
        if (m.usage) {
          const t = (m.usage.input || 0) + (m.usage.cache || 0) + (m.usage.output || 0)
          agent.tokens = (agent.tokens || 0) + t
          noteProcess('本轮 ' + t.toLocaleString() + ' tokens')
        }
        break

      case 'tool-call': {
        setStatus('working')
        rig.talking = false
        const react = TOOL_REACT[m.name] || { mood: 'reading', prop: 'glassesRound' }
        stopActing() // 切模式前先把一次性表演收掉
        // 阅读类才低头看本子
        gaze.biasTarget = react.mood === 'reading' ? -0.32 : 0
        const isDevice = DEVICE_TOOLS.has(m.name)
        // 常态：本子 + 笔。查资料时**笔换成手机**（把手里的笔放下，掏出小设备），
        // 看完自动关掉、把笔换回来。用的都是模型自带素材，不自己编。
        const propKey = react.prop === 'auto' ? randomGlasses() : react.prop
        setBase(
          react.mood,
          isDevice ? ['menuBoard'] : WORK_PROPS.concat(propKey ? [propKey] : []),
        )
        if (isDevice) {
          if (!device.out) {
            device.out = true
            playMotion('openLid')
          }
        } else if (device.out) {
          putDeviceAway()
        }
        gazeDetach(1400)
        // 台词按工具轮换（同一个工具连着用也不会重复），第二行是**具体在干什么**，
        // 脚注标出工具名——这样 Agent 里在跑什么，桌宠这边能同步看出来。
        const pool = TOOL_LINE[m.name] || (react.lean ? SAY.reading : SAY.working)
        const line = pickFresh(pool, 'tool-' + m.name)
        // 第二行「具体在干什么」（目标路径 / 文件名）算过程流水账：安静模式下不写
        const hint = CFG.repeatChat ? toolHint(m.args) : ''
        ui.bubble.show(line + (hint ? '\n' + hint : ''), {
          name: 'DS 鲸鱼娘',
          busy: true,
          sticky: true,
        })
        noteProcess(m.label || m.name)
        break
      }

      case 'tool-result':
        clearToolProp()
        if (m.error) {
          // 出错才有「黑脸」——而且很快就结束，不会一直挂着
          // 出错只是黑一下脸，很短——主人说「大锤砸头」那个不要了
          // 工具报错只是「黑一下脸」，很短，而且不叠任何别的东西
          act({
            mood: 'gloomy',
            props: [],
            exclusive: true,
            line: '（脸黑了）这个工具报错了：' + (m.error.name || m.error.code || '未知'),
            ms: 1600,
          })
        } else {
          setStatus('thinking')
          stopActing()
          putDeviceAway()
          setBase('thinking', WORK_PROPS)
        }
        break

      case 'hud-turn': {
        // 宿主已经把这一轮的账算好了，直接弹（比再去拉一次接口更快也更准）
        if (m.turn) {
          hud.turn = Object.assign({ ok: true }, m.turn)
          hud.seq = m.turn.seq || hud.seq
          if (!hud.data) hudFetch(false)
          else hudRender()
          if (!hud.open) openHud({ autoHideMs: 9000, flash: true })
        }
        break
      }

      case 'turn-end': {
        const kind = (m.reason && m.reason.kind) || m.reason || 'completed'
        rig.talking = false
        agent.hasStream = false
        clearToolProp()
        setStatus('idle')
        endWork()
        // ★ 关键：一轮结束必须把**底层状态**也复位成「平常」。
        // 之前只做了 setStatus('idle')，底层还停在最后那个工具的脸
        // （比如「调皮」会闭一只眼），于是看起来就像「平常动作被挤眼睛占住了」。
        setBase('neutral', IDLE_PROPS)

        // 主人要的：每轮结束都把「本轮消耗」弹出来（独立面板，9 秒后自己收）。
        // 宿主通常已经推了 hud-turn（那条会立刻弹）；这里只是兜底，晚一点再拉一次余额。
        hudPopTurnEnd()

        const secs = m.ms ? (m.ms / 1000).toFixed(1) + 's' : ''
        const stat = []
        if (secs) stat.push(secs)
        if (m.tokens) stat.push(m.tokens.toLocaleString() + ' tokens')

        if (kind === 'completed') {
          // 庆祝：开心脸 + 伸个懒腰 + 一个装饰（猫耳/兔耳/花花随机一个）+ 一句台词。
          // 刻意只叠「一个动作 + 一个装饰」，而且几秒后自己连开关一起收掉。
          // 庆祝只做三件事：开心脸 + 一个装饰 + 一句台词，再加一个纯 CSS 的「蹦一下」。
          // 刻意**不播 aidale**：那个「伸展」动作内部驱动 15 个表情参数
          // （呆呆眼/哭/开心/晕晕/感叹号），一播就会同时点亮好几个表情，
          // 看起来就是「砸完头之后表情全乱了」。qBounce 不碰任何模型参数。
          qBounce(1.2)
          // 主人要求：刚输出的文字要**停留一下**，别被结算立刻顶掉。
          // 所以先只做表情+装饰的庆祝，文字留在气泡里；过两秒多再把结束台词接上。
          const keepText = ui.bubble.visible && !!agent.lastText
          act({
            mood: 'happy',
            props: [pickFresh(['stickerCat', 'stickerRabbit', 'flower', 'heartbeat'], 'celebrate')],
            line: keepText ? null : pickFresh(SAY.done, 'done') + (CFG.repeatChat && stat.length ? '\n' + stat.join(' · ') : ''),
            ms: 3000,
          })
          if (keepText) {
            if (stat.length) noteProcess(stat.join(' · '))
            setTimeout(() => {
              if (agent.status !== 'idle') return
              ui.bubble.show(pickFresh(SAY.done, 'done'), { name: 'DS 鲸鱼娘', ttl: 4200 })
            }, 2800)
          }
        } else if (kind === 'aborted') {
          act({ mood: 'sad', line: pickFresh(['诶…人家还没做完呢', '被打断了…'], 'abort'), ms: 2800 })
        } else if (kind === 'error') {
          const em = (m.reason && m.reason.error && m.reason.error.message) || '出错了'
          act({
            mood: pick(['sweat', 'sad']),
            line: pickFresh(SAY.fail, 'fail') + '\n' + String(em).slice(0, 160),
            ms: 3200,
          })
        } else {
          act({ mood: 'pout', ms: 2600 })
        }
        break
      }

      case 'subagent':
        if (m.active && ui.bubble.visible) noteProcess('分身也在干活…')
        break

      case 'approval':
        if (m.state === 'asked') {
          act({ mood: 'confused', line: '需要你点一下确认', props: WORK_PROPS, ms: 8000 })
        } else {
          act({ mood: 'happy', ms: 2600 })
        }
        break

      case 'control':
        handleControl(m)
        break
    }
  }


  /** 干活时顺手戴的道具，一轮结束就摘掉；用户自己戴的不动。 */
  /**
   * 上一版「手动戴/摘工具道具」的遗留。现在道具由 base/override/user 三层解析，
   * 一次性道具随 override 一起过期，不存在「忘了摘」的情况；保留成空操作只是
   * 为了少改调用点。
   */
  function clearToolProp() {}

  /** 外部（用户菜单，或 agent 自己调 /dsh-pet/control）驱动的表演。 */
  function handleControl(m) {
    if (m.clearProps) clearProps()
    if (m.props && typeof m.props === 'object') {
      for (const [k, v] of Object.entries(m.props)) setProp(k, !!v)
    }
    if (m.expression !== undefined) {
      rig.face = m.expression === null || !EXPR[m.expression] ? null : m.expression
      mood = 'custom'
      rig.dirty = true
    }
    if (m.mood != null || m.expression) {
      act({ mood: m.mood, face: m.expression, ms: m.bubbleMs || 5000 })
    }
    if (m.motion) playMotion(m.motion)
    const text = m.say || m.bubble
    if (text) ui.bubble.show(String(text), { name: 'DS 鲸鱼娘', ttl: m.bubbleMs || 5000 })
    if (m.attention) {
      ui.root.classList.add('dshp-open')
      setTimeout(() => closePanels(), 3000)
    }
  }

  // ——————————————————————————————————————————————————————————————
  // 十一、待机小动作
  // ——————————————————————————————————————————————————————————————

  /**
   * 待机大脑。
   *
   * 这是「她自己会动」的来源——用户明确说过不想自己一个个去点表情，
   * 要她闲着自己动一动。所以按权重随机挑事情做：
   *
   *   · 大部分时间只是看看别处、换个姿势、偶尔换个表情（很快收回）
   *   · 吹泡泡糖是稀有事件（权重 2/100），不再是主旋律
   *   · 长时间没人理 → 打哈欠 → 打瞌睡（渐进式，鼠标一动就醒）
   *
   * 权重表就是性格；想让她更活泼就调大 motion 类，想更安静就调大 glance。
   */
  /**
   * 待机行为权重表。
   *
   * 主人明确要求：**待机不放任何「动作」**（不吹泡泡糖、不伸懒腰、不自拍），
   * 待机就是「拿着板夹、平常脸、等命令」——动效只可能在「点击」或「工作事件」
   * 里出现，每个动作配它自己那套台词，且不会乱冒。
   *
   * 所以这里只剩三类：看别处、自己换个表情（几秒收回）、说句话。
   */
  const IDLE_TABLE = [
    ['glance', 46], // 看别处 / 发呆
    ['express', 28], // 自己换个表情，几秒后收回
    ['mutter', 22], // 自言自语（人设台词）
    ['hungry', 4], // 喊饿
    ['nopang', 2], // 强调自己不胖（主人说「别老生气」，权重砍半）
  ]
  const IDLE_TOTAL = IDLE_TABLE.reduce((a, b) => a + b[1], 0)

  const idle = { sleep: 0, nextAt: 0, expressTimer: null, propTimer: null }

  function wakeUp() {
    if (idle.sleep === 0) return
    idle.sleep = 0
    act({ mood: 'alert', line: pick(SAY.wake), ms: 1800 })
  }

  function pickIdleBehavior() {
    let r = Math.random() * IDLE_TOTAL
    for (const [name, w] of IDLE_TABLE) {
      r -= w
      if (r <= 0) return name
    }
    return 'glance'
  }

  /** 待机时自己换个表情，过几秒悄悄收回（除非有真实事件插进来）。 */
  function idleExpress() {
    // 注意：'dizzy'（圈圈眼）主人说老出不好看，已从所有自动行为里移除
    // 待机时换的表情，**必须是不会改变眼睛大小的**——
    // 主人要的「平常动作」就是「正常眼型 + 正常表情」，所以像
    // 开心兴奋（闭眼）、调皮（闭一只眼，就是那个"挤眼睛"）这类
    // 一律不进待机池，只留给点击互动那种明确的场合。
    // 'grumpy'（生气）也踢掉了：主人抱怨「别老生气」，待机时无缘无故
    // 摆一张生气的脸很莫名，换成「流汗」。
    const pool = ['shy', 'confused', 'excited', 'alert', 'tongue', 'sweat', 'love']
    const m = pick(pool)
    const ms = 2200 + Math.random() * 2600
    act({ mood: m, props: IDLE_PROPS, ms })
    idle.expressUntil = performance.now() + ms
  }

  /** 待机时拨弄一个道具：临时戴上，随 override 一起过期，不用手动摘。 */
  function idleFiddle() {
    const keys = Object.keys(PROPS).filter((k) => EXPR[PROPS[k].expr])
    const key = pickFresh(keys, 'fiddle')
    act({ props: [key], ms: 5000 + Math.random() * 4000 })
  }

  function runIdleBehavior() {
    // 正有一个一次性反应在放，就别插新的——否则会叠在一起，
    // 而且旧反应会被顶掉、看起来像「卡住」
    if (rig.override) return

    const b = pickIdleBehavior()
    switch (b) {
      case 'glance':
        gaze.nextDrift = 0 // 立刻换一个新的视线落点
        break
      case 'express':
        idleExpress()
        break
      case 'mutter':
        act({ props: IDLE_PROPS, line: pickFresh(SAY.idle, 'idle'), ms: 4200 })
        break
      case 'fiddle':
        idleFiddle()
        break
      case 'hungry':
        act({ mood: 'pout', props: IDLE_PROPS, line: pickFresh(SAY.hungry, 'hungry'), ms: 4600 })
        break
      case 'nopang':
        act({ mood: 'grumpy', props: IDLE_PROPS, line: pickFresh(SAY.fat, 'fat'), ms: 4200 })
        break
    }
  }

  function startLoops() {
    // 视线/自主动作：40ms 一跳（对应 clawd-on-desk 的 50ms 轮询）
    setInterval(gazeTick, 40)

    // 干活时的轮播（认真/摸鱼/思考），和下面的待机大脑互斥
    setInterval(() => {
      if (agent.status === 'idle') return
      workTick()
    }, 1500)

    // 兜底复位：只要空闲、又没有一次性表演在放，底层状态就必须是「平常」。
    // 有了它，就算哪条事件路径漏了复位，也不会出现「一直挂着某张脸」。
    setInterval(() => {
      if (agent.status !== 'idle') return
      if (rig.override) return
      if (rig.base.mood !== 'neutral') setBase('neutral', IDLE_PROPS)
      if (gaze.biasTarget !== 0) gaze.biasTarget = 0
    }, 2000)

    // 待机大脑：3.5–7.5 秒挑一件事
    setInterval(() => {
      if (agent.status !== 'idle') return
      if (PERF.low) return                      // 低性能档：不自言自语、不自己找戏
      if (ui.root.classList.contains('dshp-hidden')) return
      if (document.hidden) return
      const now = performance.now()
      if (now < idle.nextAt) return
      idle.nextAt = now + 3500 + Math.random() * 4000
      runIdleBehavior()
    }, 1200)

    // 睡眠序列：先打哈欠，再睡着；鼠标一动就醒
    setInterval(() => {
      if (!CFG.sleepAfterMs || agent.status !== 'idle') return
      if (PERF.low) return                      // 低性能档：连打哈欠/睡觉都省掉
      const quiet = Date.now() - agent.lastActivity
      if (idle.sleep === 0 && quiet > CFG.sleepAfterMs) {
        idle.sleep = 2
        setBase('sleepy', IDLE_PROPS)
        ui.bubble.show(pick(['Zzz…', '（打瞌睡）', '（趴桌上睡着了）']), { name: 'DS 鲸鱼娘', ttl: 9000 })
      } else if (idle.sleep === 0 && quiet > CFG.sleepAfterMs * 0.55 && Math.random() < 0.4) {
        // 打哈欠
        act({ mood: 'sleepy', props: IDLE_PROPS, line: '（打了个哈欠）', ms: 2600 })
      }
    }, 15000)
  }

  // ——————————————————————————————————————————————————————————————
  // 十二、对外小接口（控制台调试 / 扩展）
  // ——————————————————————————————————————————————————————————————
  window.DSHPet = {
    setBase,
    setReaction,
    clearReaction,
    setUserFace,
    clearUserFace,
    setProp,
    clearProps,
    playMotion,
    hitTest,
    /** 隐藏 / 恢复。壳子（桌面版）收起成小球后，靠它把页面里的状态一起改回来 */
    setHidden,
    /** 性能档：壳子/设置页用它切「低性能模式」 */
    setLowPower,
    isLowPower: () => PERF.low,
    rebuildMask: () => {
      mask.dirty = true
    },
    resetGazeStats: () => {
      gaze.stepRate = 0
    },
    /**
     * 诊断用：现在的「手速档位」。
     * 测试靠它验证「正常速度点击不会让她生气」。
     */
    pokeTier: () => pokeTier(),
    /** 诊断用：给一串点击间隔（毫秒），纯计算出会落哪一档。 */
    pokeTierFor: (gaps) => pokeTierForGaps(gaps || []),
    /** 诊断用：清空连点记录。 */
    clearPokes: () => {
      pokeState.times.length = 0
      pokeState.softAt = 0
      pokeState.angerAt = 0
    },
    resetEverything,
    /**
     * 诊断用：菜单现在的样子（按钮名、当前状态行）。
     * 测试用它验证「同一个表情不会出现两次」「点每一项都真的有台词」。
     */
    menu() {
      const chips = []
      if (ui && ui.menu && ui.menu.el) {
        for (const c of ui.menu.el.querySelectorAll('.dshp-chip')) {
          chips.push({ label: c.textContent, on: c.classList.contains('dshp-on'), title: c.title })
        }
      }
      return {
        open: !!(ui && ui.menu && ui.menu.el && ui.menu.el.classList.contains('dshp-on')),
        focused: ui && ui.menu ? ui.menu.focused : null,
        status: menuStatusLine(),
        chips,
        userProps: Array.from(rig.userProps),
        face: rig.user.face,
      }
    },
    /** 诊断用：某个菜单项配的台词（验证「每一项都有话可说」）。 */
    itemLines(kind, key) {
      const t = kind === 'face' ? FACE_ACT : kind === 'decor' ? PROP_ACT : kind === 'action' ? ACTIONS : SCENE_ACT
      return (t && t[key] && t[key].lines) || null
    },
    /** 诊断用：一次动作有哪些可选（测试逐项点一遍）。 */
    actions() {
      return ACTION_KEYS.map((k) => ({ key: k, label: ACTIONS[k].label, expr: ACTIONS[k].expr || null, motion: ACTIONS[k].motion || null, ms: ACTIONS[k].ms }))
    },
    /** 诊断用：直接演一个一次性动作。 */
    playAction: (key) => playAction(key),
    /** 诊断用：某个动作会写哪些参数 / 这些参数当前的值（验证「动作停了姿势有没有清掉」）。 */
    motionParams(group) {
      const meta = (manifest && manifest.motions && manifest.motions[group]) || null
      const ids = meta ? meta.params || [] : []
      const read = (id) => {
        try {
          return typeof coreModel.getParameterValueById === 'function'
            ? +coreModel.getParameterValueById(id).toFixed(4)
            : null
        } catch (e) {
          return null
        }
      }
      const def = (id) => {
        try {
          return typeof coreModel.getParameterDefaultValue === 'function'
            ? +coreModel.getParameterDefaultValue(id).toFixed(4)
            : null
        } catch (e) {
          return null
        }
      }
      return { group, ids: ids.slice(0, 8), total: ids.length, values: ids.map(read), defaults: ids.map(def) }
    },
    /** 诊断用：读某个参数当前值 / 默认值；eyes() 返回眼睛睁开程度（0 闭 1 睁）。 */
    paramValue: (id) => paramValue(id),
    paramDefault: (id) => paramDefault(id),
    eyes: () => eyesOpen(),
    /** 诊断用：眨眼的当前状态（测试用它数「15 秒眨了几次」）。 */
    blink: () => ({ phase: blink.phase, gate: blink.gate, count: blink.count,
      nextIn: Math.max(0, Math.round(blink.nextAt - performance.now())) }),
    /** 诊断用：主动清一次动作姿势（测试与 /control 都能用）。 */
    clearMotionPose: () => clearMotionPose(),
    /** 诊断用：HUD（余额/计价面板）状态与当前显示的文字。 */
    hud: {
      open: () => hud.open,
      show: (opts) => openHud(opts || { flash: true }),
      hide: () => closeHud(),
      refresh: () => hudFetch(true),
      read: () => ({
        open: hud.open,
        source: hud.source || null,
        peak: hud.data ? hud.data.isPeak : null,
        balance: hud.data ? hud.data.totalBalance : null,
        currency: hud.data ? hud.data.currency : null,
        todayUsage: hud.data ? hud.data.todayUsage : null,
        turn: hud.turn ? { amount: hud.turn.amount, tokens: hud.turn.tokens, seq: hud.turn.seq } : null,
        left: hud.left === undefined ? null : hud.left,
        err: hud.err,
        text: ui && ui.hud
          ? {
              badge: ui.hud.badge.textContent,
              badgeClass: ui.hud.badge.className,
              money: ui.hud.money.textContent,
              today: ui.hud.today.textContent,
              turn: ui.hud.turn.textContent,
              countdown: ui.hud.countdown.textContent,
              foot: ui.hud.foot.textContent,
            }
          : null,
      }),
    },
    /**
     * 诊断用：把当前画面降采样成一小撮像素。
     * 测试工具靠它做「施加某个表情前后画面有没有变化」的客观比对——
     * 比肉眼看「这个按钮点了好像没反应」靠谱得多。
     */
    sampleCanvas(size) {
      if (!app || !app.view || !app.view.width) return null
      const W = size || 40
      const H = Math.max(6, Math.round((W * app.view.height) / app.view.width))
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const g = c.getContext('2d', { willReadFrequently: true })
      g.clearRect(0, 0, W, H)
      g.drawImage(app.view, 0, 0, W, H)
      const d = g.getImageData(0, 0, W, H).data
      const out = new Array(d.length)
      for (let i = 0; i < d.length; i++) out[i] = d[i]
      return out
    },
    /** 诊断用：某个表达式会写哪些参数、这些参数模型里有没有。 */
    describe(name) {
      const ps = EXPR[name]
      if (!ps) return null
      return {
        params: ps.map((p) => ({ id: p.id, value: p.value, exists: MODEL_PARAMS.has(p.id) })),
        allExist: ps.every((p) => MODEL_PARAMS.has(p.id)),
      }
    },
    /** 诊断用：列出所有可用表情名与道具 key。 */
    catalog() {
      return {
        expressions: Object.keys(EXPR),
        // 菜单的三类：装饰（常驻）/ 场景（常驻）/ 动作（一次性）
        props: Object.keys(PROPS),
        decor: Object.keys(PROPS),
        scenes: Object.keys(SCENES),
        actions: ACTION_KEYS,
        baseItems: Object.keys(BASE_ITEMS),
        moods: Object.keys(MOOD_FACE),
        motions: manifest ? Object.keys(manifest.motions || {}) : [],
      }
    },
    get state() {
      return {
        agent: Object.assign({}, agent),
        mood,
        face: rig.face,
        props: Array.from(rig.props),
        // 诊断用：三层状态各自持有什么，以及「干活轮播/小设备」的开关。
        // 卡住类 bug 全靠这几个字段定位（比如底层还挂着某个道具、轮播还在跑）。
        // 注意：base 这个字段名下面（对象末尾）已经用来放「底层情绪字符串」了，
        // 要保持兼容，所以这里第二个字段叫 baseMood/baseProps。
        userProps: Array.from(rig.userProps),
        overrideProps: rig.override ? (rig.override.props || []).slice() : null,
        overrideLeft: rig.override ? Math.max(0, Math.round(rig.override.until - performance.now())) : 0,
        work: { active: work.active, i: work.i },
        device: { out: device.out },
        modelSize: model ? { w: model.internalModel.width, h: model.internalModel.height } : null,
        view: lastView,
        panels: (() => {
          const read = (el) => {
            if (!el) return null
            const cs = getComputedStyle(el)
            const r = el.getBoundingClientRect()
            return {
              on: el.classList.contains('dshp-on'),
              shift: cs.getPropertyValue('--dshp-shift').trim() || '0px',
              left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
            }
          }
          return {
            headX: Math.round(headScreenX()),
            rootCenter: ui && ui.root ? Math.round(ui.root.getBoundingClientRect().left + ui.root.getBoundingClientRect().width / 2) : null,
            menu: read(ui && ui.menu && ui.menu.el),
            composer: read(ui && ui.composer && ui.composer.el),
            hud: read(ui && ui.hud && ui.hud.el),
          }
        })(),
        placement: (() => {
          const r = ui && ui.root ? ui.root.getBoundingClientRect() : null
          return {
            edge: (ui && ui.root && ui.root.dataset.edge) || null,
            left: r ? Math.round(r.left) : null,
            top: r ? Math.round(r.top) : null,
            right: r ? Math.round(window.innerWidth - r.right) : null,
            bottom: r ? Math.round(window.innerHeight - r.bottom) : null,
          }
        })(),
        contentBox,
        exclusive: rig.exclusive || null,
        motion: { playing: !!motionTimer || motionActive(), active: motionActive() },
        acting: acting ? { left: Math.max(0, Math.round(acting.until - performance.now())) } : null,
        // 诊断用：视线控制器 + 框架里真正生效的焦点值（测试靠它验证「有没有阻尼住」）
        gaze: {
          x: +gaze.x.toFixed(4),
          y: +gaze.y.toFixed(4),
          mode: gaze.mode,
          detached: performance.now() < gaze.detachUntil,
          stepRate: +(gaze.stepRate || 0).toFixed(3),
          fcX: gaze.fcX === undefined ? null : +gaze.fcX.toFixed(4),
          fcErr: gaze.fcErr || null,
          limit: gazeCfg().rate,
        },
        focus: model
          ? {
              x: +model.internalModel.focusController.x.toFixed(4),
              y: +model.internalModel.focusController.y.toFixed(4),
            }
          : null,
        override: rig.override ? { mood: rig.override.mood, until: Math.round(rig.override.until - performance.now()) } : null,
      base: rig.base.mood,
      baseMood: rig.base.mood,
      baseProps: rig.base.props.slice().sort(),
        idleSleep: idle.sleep,
        droppedParams: Array.from(droppedParams),
        expressions: Object.keys(EXPR),
        motions: manifest ? Object.keys(manifest.motions || {}) : [],
      }
    },
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main)
  else main()
})()
