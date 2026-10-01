/** persona/moods.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

// ——————————————————————————————————————————————————————————————
// 一、性格表：桌宠「怎么演」全部写在这里
// ——————————————————————————————————————————————————————————————

/**
 * 情绪（脸）：同时只有一个。值是 manifest.expressions 里的键。
 * 注意：这些是「自动表情」的词汇表——桌宠平时自己挑，用户的手动选择只是临时覆盖。
 */
export const MOOD_FACE = {
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
