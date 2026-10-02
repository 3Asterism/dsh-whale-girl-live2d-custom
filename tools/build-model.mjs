#!/usr/bin/env node
/**
 * build-model.mjs — 把 VTube Studio 原始模型整理成桌面宠物可直接消费的形态。
 *
 * 输入：assets/model/ 下已经放好的原始素材（moc3 / physics3 / cdi3 / textures /
 *       motions/ / expressions/）。原始 zip 见工作区 `DS鲸鱼娘/`。
 *
 * 做三件事：
 *   1. 生成 c_0120.model3.json —— 原版没有 Motions 段（VTube Studio 用 hotkey 直接
 *      按文件名加载），这里把每个动作注册成一个独立 group，标准 Live2D 运行时
 *      （pixi-live2d-display）才能播。
 *   2. 生成 manifest.json —— 表情/动作的原始目录（含每个表情驱动的参数与值），
 *      前端 rig 直接按它施加，不用把艺术家的意图重新抄一遍。
 *   3. 打印一份人类可读的分类报告，方便校对语义映射。
 *
 * 用法：node tools/build-model.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const MODEL = path.join(ROOT, 'assets', 'model')

/**
 * 动作的 ASCII 逻辑名 → 源文件。group 名用 ASCII，避免中文 group 名在
 * 各种运行时里的编码坑；中文原名保留在 manifest 的 label 里做展示。
 */
const MOTIONS = [
  { group: 'idle', file: 'idle.motion3.json', label: '待机（猫爪）', loop: true, ambient: true },
  { group: 'aidale', file: '_aidale.motion3.json', label: '伸展（aidale）', loop: false },
  { group: 'selfie', file: '自拍.motion3.json', label: '自拍', loop: false },
  { group: 'selfieQuick', file: '自拍简单.motion3.json', label: '快速自拍', loop: false },
  { group: 'ketchup', file: '番茄酱.motion3.json', label: '挤番茄酱', loop: false },
  { group: 'openLid', file: '开盖.motion3.json', label: '开盖', loop: false },
  { group: 'bubble', file: 'chuipaopao.motion3.json', label: '吹泡泡糖', loop: false },
  { group: 'splash', file: '喷水.motion3.json', label: '鲸鱼喷水', loop: false },
]

/** 表情分类不是从文件里推导出来的，是设计判断，写在 semantics 里；这里只做原始抽取。 */
function readExpressions() {
  const dir = path.join(MODEL, 'expressions')
  const out = {}
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.exp3.json')) continue
    const name = f.slice(0, -'.exp3.json'.length)
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    out[name] = {
      file: `expressions/${f}`,
      // Blend 目前全是 Add：值叠加在动作/物理算完之后的基础参数上。
      params: (raw.Parameters || []).map((p) => ({
        id: p.Id,
        value: p.Value,
        blend: p.Blend || 'Add',
      })),
    }
  }
  return out
}

/** 抽出每个动作实际驱动的参数，用于判断它会不会跟表情 rig 打架。 */
function readMotionParams(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(MODEL, 'motions', file), 'utf8'))
  const ids = (raw.Curves || []).map((c) => c.Id)
  return { duration: raw.Meta?.Duration ?? null, loop: raw.Meta?.Loop ?? false, params: ids }
}

function build() {
  const expressions = readExpressions()
  const motionGroups = {}
  const motionMeta = {}
  for (const m of MOTIONS) {
    const p = path.join(MODEL, 'motions', m.file)
    if (!fs.existsSync(p)) {
      console.warn(`[build-model] 跳过缺失动作: ${m.file}`)
      continue
    }
    const info = readMotionParams(m.file)
    motionGroups[m.group] = [
      {
        File: `motions/${m.file}`,
        FadeInTime: m.loop ? 0.8 : 0.35,
        FadeOutTime: m.loop ? 0.8 : 0.5,
      },
    ]
    motionMeta[m.group] = { ...m, params: info.params, duration: info.duration }
  }

  const model3 = {
    Version: 3,
    FileReferences: {
      Moc: 'c_0120.moc3',
      Textures: ['c_0120.2048/texture_00.png', 'c_0120.2048/texture_01.png'],
      Physics: 'c_0120.physics3.json',
      DisplayInfo: 'c_0120.cdi3.json',
      Motions: motionGroups,
      // 故意不注册 Expressions：表情由前端 rig 在 beforeModelUpdate 阶段统一施加，
      // 走框架的 expressionManager 会和 rig 抢同一批参数。
    },
    Groups: [
      { Target: 'Parameter', Name: 'EyeBlink', Ids: ['ParamEyeLOpen', 'ParamEyeROpen'] },
      { Target: 'Parameter', Name: 'LipSync', Ids: [] },
    ],
    HitAreas: [
      { Id: 'Head', Name: '头' },
      { Id: 'Body', Name: '身体' },
    ],
  }
  fs.writeFileSync(
    path.join(MODEL, 'c_0120.model3.json'),
    JSON.stringify(model3, null, 4) + '\n',
    'utf8',
  )

  const manifest = {
    version: 1,
    model: 'c_0120',
    displayName: 'DS 鲸鱼娘',
    url: 'c_0120.model3.json',
    source: 'DS鲸鱼娘（B站@氵六青），VTube Studio 模型',
    // 点按 / 按住「捏一下、弹一下」的手感，每个模型自己一份（不同模型不能直接套参数）。
    // 字段含义与缺省值见 assets/app/engine/press-spring.js 的 PRESS_DEFAULT；anchor 'content' = 自动取实体范围底边中点。
    press: { depth: 0.12, volume: 0.6, anchor: 'content', pressOmega: 36, pressZeta: 0.95, releaseOmega: 22, releaseZeta: 0.3 },
    motions: motionMeta,
    expressions,
  }
  fs.writeFileSync(path.join(MODEL, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  // —— 人类可读报告 ——
  console.log(`\n模型: ${manifest.displayName}  动作 ${Object.keys(motionMeta).length} 个 / 表情 ${Object.keys(expressions).length} 个\n`)
  console.log('动作（group → 驱动参数数）:')
  for (const [g, m] of Object.entries(motionMeta)) {
    const faceParams = m.params.filter((p) => /^ParamCheek|^Paramhh|^ParamMouth|^ParamBrow/.test(p))
    const flag = faceParams.length ? `  ⚠ 含 ${faceParams.length} 个表情参数: ${faceParams.join(',')}` : ''
    console.log(`  ${g.padEnd(12)} ${String(m.duration).padStart(6)}s  参数 ${String(m.params.length).padStart(3)}${flag}`)
  }
  console.log('\n表情 → 参数:')
  for (const [name, e] of Object.entries(expressions)) {
    console.log(`  ${name.padEnd(14)} ${e.params.map((p) => `${p.id}=${p.value}`).join(' ')}`)
  }
  console.log('\n已写出 c_0120.model3.json 与 manifest.json')
}

build()
