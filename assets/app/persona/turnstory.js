/**
 * persona/turnstory.js —— 「复合操作」：一轮里零散的命令合起来讲了一个什么故事。**纯函数**，Node 里能直接单测。
 *
 * 全部建立在**真的 hook 得到的信号**上（见 docs/陪伴设计调研.md 第 4、6 节「信号清单」）：
 *   · shell 命令的类别（从 tool/call 的命令里正则认）+ 结果（宿主从结果末尾抽出的退出码；非零不算 error）；
 *   · 改了几个文件、同一个文件被改了几次（改文件工具的路径指纹）、同一条命令失败了几次（命令指纹）；
 *   · plan 模式 / 清单进度、压缩次数、会话里聊了几轮、上一轮测试的结果。
 * 没有退出码（老宿主 / 后台命令 / 被信号杀掉）的命令只算「跑过」，**不当成功也不当失败**——宁可不说，不说错。
 *
 * 对照 vibe coding 的经典流程与经典翻车（调研见 docs/陪伴设计调研.md 第 6 节）：
 *   流程：探索 → 计划（plan 模式 + 清单）→ 小步实现 → 测试 → 看 diff → **提交当存档点** → 上下文长了换新会话；
 *   翻车：改一个 bug 出三个（绿了又红）· 原地打转（同一命令 / 同一文件反复）· 上下文腐烂 · 过早宣布完成（改完没跑）·
 *         幻觉依赖（装不上）· 慌了就回滚 · 密钥进仓库（另在 events.js 里做中途安全提醒）。
 *
 * 编排（不挤占普通互动，见 persona/orchestra.js）：
 *   · storyOf → 'flavor'：**顶替**这一轮默认的收工那一句（一轮只演一个收工表演），不增加任何发言；
 *   · notesOf → 一组 'note'：收工后另起的轻话——不直接说，全部递给编排器排队，槽里只留价值最高的一条（话痨档才有、会过期、不补播）。
 */

/**
 * @param t {
 *   kinds: { [类别]: { ok, fail } }，files: 这一轮改了几个文件，reds: 测试 / 构建失败次数，
 *   greenAfterRed: 红过之后又绿了，lastTest: 'ok' | 'fail' | null（这一轮最后一次测试的结果），
 *   prevTest: 上一轮最后一次测试的结果，okThenFail: 这一轮里先绿后红（改完变红），
 *   cmdLoop: 同一条命令失败 ≥3 次，thrash: 同一个文件被改 ≥5 次，
 *   planDone: 用过 plan 模式且清单（≥3 项）全划掉，commitsToday: 今天已经提交过几次，
 *   blindComplaint: 上一轮改完没跑测试、主人刚抱怨（跨轮）
 * }
 */
const num = (x) => Number(x) || 0
const okOf = (t, x) => (t && t.kinds && t.kinds[x] && num(t.kinds[x].ok)) || 0
const failOf = (t, x) => (t && t.kinds && t.kinds[x] && num(t.kinds[x].fail)) || 0

/**
 * 收工那一句：flavor 优先；没有 flavor 时返回 null（note 走 notesOf）。
 * @returns { id, say, kind: 'flavor', tier: 'core' } 或 null
 */
export function storyOf(t) {
  const files = num(t && t.files)
  const reds = num(t && t.reds)
  const last = (t && t.lastTest) || null
  const flavor = (id, say) => ({ id, say, kind: 'flavor', tier: 'core' })
  // 红了好几次、最后绿了：一场调试战（最值得说，排第一）
  if (t && t.greenAfterRed && reds >= 2) return flavor('debugWin', 'storyDebugWin')
  // 改 → 测（最后是绿的）→ 提交 / push：一条龙
  if (files >= 1 && last === 'ok' && okOf(t, 'commit') + okOf(t, 'push') > 0) return flavor('ship', 'storyShip')
  // 慌了就回滚（reset / checkout / restore / revert / stash 成功）：不丢人，回到上一个能跑的版本也是进步
  if (okOf(t, 'rollback') > 0) return flavor('rollback', 'storyRollback')
  // 先计划再动手、清单全划掉：vibe coding 的正路
  if (t && t.planDone) return flavor('planDone', 'storyPlanDone')
  if (okOf(t, 'push') > 0) return flavor('push', 'storyPush')
  // 测试还红着就提交了：不当庆祝（note 里说）
  if (okOf(t, 'commit') > 0 && last !== 'fail') return flavor('commit', 'storyCommit')
  if (okOf(t, 'install') > 0 && okOf(t, 'build') + okOf(t, 'test') > 0) return flavor('env', 'storyEnv')
  return null
}

/** note 的价值（排队时谁先说）：越具体、越对症越高。 */
export const NOTE_VALUE = {
  blindComplaint: 36, regression: 34, cmdLoop: 32, thrash: 30, redEnd: 30, redCommit: 28, installFail: 24, longSession: 22, noTest: 20, checkpoint: 18, tested: 15,
}

/**
 * 收工后可以轻轻说的话（都是话痨档、都只排队）。返回按价值从高到低的数组，可能为空。
 * 编排器一次只留价值最高的一条。
 */
export function notesOf(t) {
  const files = num(t && t.files)
  const last = (t && t.lastTest) || null
  const out = []
  const add = (id, say) => out.push({ id, say, kind: 'note', tier: 'chatty', value: NOTE_VALUE[id] })
  // 上一轮改完没验证、主人刚抱怨「还是不行」：最对症——先让它跑一遍再说（过早宣布完成的经典翻车）
  if (t && t.blindComplaint) add('blindComplaint', 'storyUnverified')
  // 改一个 bug 出三个：刚才还是绿的（上一轮 / 这一轮先绿），这次改完变红了
  if (last === 'fail' && ((t && t.prevTest === 'ok') || (t && t.okThenFail))) add('regression', 'storyRegression')
  else if (last === 'fail') add('redEnd', 'storyRedEnd')
  // 原地打转：同一条命令失败了好几次 / 同一个文件改了一遍又一遍
  if (t && t.cmdLoop) add('cmdLoop', 'storyCmdLoop')
  if (t && t.thrash) add('thrash', 'storyThrash')
  // 测试还红着就提交
  if (okOf(t, 'commit') > 0 && last === 'fail') add('redCommit', 'storyRedCommit')
  // 幻觉依赖：装不上（包名可能是 AI 编出来的）
  if (failOf(t, 'install') > 0 && okOf(t, 'install') === 0) add('installFail', 'storyInstallFail')
  // 会话聊得太长（压缩过好几次 / 聊了很多轮）：上下文腐烂，换个新会话
  if (t && t.longSession) add('longSession', 'storyLongSession')
  // 改了很多文件却没跑过测试
  if (files >= 8 && okOf(t, 'test') + failOf(t, 'test') === 0) add('noTest', 'storyNoTest')
  // 绿了：今天还没提交过——提交当存档点；已经提交过就只夸一句「改完就测」
  if (files >= 1 && last === 'ok' && okOf(t, 'commit') + okOf(t, 'push') === 0) {
    if (num(t && t.commitsToday) === 0 && files >= 3) add('checkpoint', 'storyCheckpoint')
    else add('tested', 'storyTested')
  }
  return out.sort((a, b) => b.value - a.value)
}

/** 故事 id → 收工表演的脸（flavor 用）。 */
export const STORY_MOOD = { ship: 'excited', push: 'excited', commit: 'happy', debugWin: 'sweat', env: 'happy', rollback: 'shy', planDone: 'happy' }
