/**
 * persona/gifts.js —— 每种礼物的「演出」：吃到 / 喝到 / 收到时她的脸、道具、动作和台词 id。
 * 数值（羁绊 / 饱腹 / 心情 / token）和喜好在宿主的 lib/bond/constants.js，这里只管「演出」。
 * 台词在 persona/lines-bond.js（gift*）。
 */

/**
 * action：走 playAction（复用「前置模式 / 自带表情不压脸」）；mood / props / heart：走一次性反应。
 * ms：演多久。没写按 3200。
 */
export const GIFT_REACT = {
  rice: { mood: 'excited', heart: true, say: 'giftRice' },
  omurice: { action: 'omurice', say: 'giftOmurice' },
  parfait: { mood: 'love', props: ['parfait'], say: 'giftParfait', ms: 6000 },
  tea: { mood: 'shy', say: 'giftTea' },
  blanket: { mood: 'shy', heart: true, say: 'giftBlanket' },
  coffee: { mood: 'confused', say: 'giftCoffee' },
  salad: { mood: 'grumpy', say: 'giftSalad' },
  scale: { mood: 'gloomy', say: 'giftScale', ms: 4200 },
}

/** 投喂失败的原因 → 台词 id。 */
export const GIFT_FAIL_SAY = {
  'daily-cap': 'giftCap',
  'no-tickets': 'giftNoTickets',
}
