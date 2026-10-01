/**
 * core/state.js —— 跨模块共享的可变状态。
 *
 * ES 模块里「导入的变量不能被别的模块赋值」，所以凡是要被多个模块写的顶层变量，都收进这里的 R；
 * 只被一个模块写的，留在那个模块里。下面几个 const 对象（bond / agent …）是按属性修改的，可以直接导出。
 */

/** 运行时共享引用与开关：模型 / 画布 / UI 根 / 取景结果 / 掩码盒 / 当前情绪 / 正在演的表演 / 正在拖大小滑块。 */
export const R = {
  app: null,
  model: null,
  manifest: null,
  coreModel: null,
  ui: null,
  lastView: null,
  contentBox: null,
  MODEL_PARAMS: new Set(),
  mood: 'neutral',
  acting: null,
  sizingSize: false,
}

/** 表情名 → 参数增量表（已过滤掉模型里不存在的参数）。 */
export const EXPR = {}

/** 被过滤掉的参数，启动时打一条日志，方便排查。 */
export const droppedParams = new Set()

/**
 * 羁绊系统的前端镜像：真值在宿主（/dsh-pet/bond），这里只缓存「别的模块要快速读」的几项，
 * 完整快照放在 snap（「好感」页渲染用）。tier 是台词档（1–5，每 2 级一档），strokeMax 是摸头最高档（1–3）。
 */
export const bond = {
  enabled: true,
  level: 1,
  levelName: '初识',
  tier: 1,
  strokeMax: 1,
  pending: false,
  pendingLevel: null,
  snap: null,
}

/** agent 的当前活动状态（由事件桥推来的事件维护）。 */
export const agent = {
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

/** 有几个「分身」（非主会话）正在同时干活——超过 1 个反应不一样，
 *  参考 clawd-on-desk「1 个/2 个以上」区分对待的做法。用 sessionId 去重，
 *  免得同一个分身连续几条 turn-start 之外的事件把计数推高。 */
export const activeSubagents = new Set()
