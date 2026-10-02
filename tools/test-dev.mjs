#!/usr/bin/env node
/**
 * test-dev.mjs —— v0.6.8「陪你一起干活」的纯逻辑单测（不需要浏览器、不需要宿主）：
 *   · 开发动作识别（命令 → 提交 / push / 拉代码 / 测试 / 装依赖 / 构建 / 检查）；
 *   · 每日一签：只由日期决定、吉凶分布合理、宜忌与幸运图的规则；
 *   · 台词与配图：每个新台词 id 都有台词、有图，且不超长。
 *   node tools/test-dev.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel) => import(pathToFileURL(path.join(ROOT, 'assets', 'app', rel)).href)

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const dev = await imp('persona/devhooks.js')
const ft = await imp('persona/fortune.js')
const { lineFor } = await imp('persona/lines.js')
const { SCENE_LINES } = await imp('persona/lines-scenes.js')
const stk = await imp('persona/stickers.js')
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'stickers', 'manifest.json'), 'utf8')).stickers
const ids = Object.keys(manifest)

console.log('\n开发动作识别\n')
const cmd = (c, tool = 'bash') => dev.classifyCommand(tool, JSON.stringify({ command: c }))
check('git commit / push / pull', cmd('git commit -m "fix: x"') === 'commit' && cmd('git push origin main') === 'push' && cmd('git pull --rebase') === 'pull' && cmd('git fetch origin') === 'pull')
check('「提交并推送」算 push（更大的动作）', cmd('git add -A && git commit -m x && git push') === 'push')
check('测试：pytest / jest / npm test / go test / node tools/test-xxx.mjs', ['pytest -q', 'npx jest', 'npm test', 'npm run test', 'pnpm test', 'go test ./...', 'cargo test', 'node tools/test-host.mjs', 'python -m pytest', 'dotnet test'].every((c) => cmd(c) === 'test'))
check('装依赖：npm i / pip install / cargo add / brew install', ['npm install', 'npm i lodash', 'pnpm add x', 'pip install requests', 'pip3 install x', 'cargo add serde', 'brew install jq', 'uv add httpx'].every((c) => cmd(c) === 'install'))
check('构建 / 检查：npm run build / cargo build / tsc / eslint / ruff', cmd('npm run build') === 'build' && cmd('cargo build --release') === 'build' && cmd('tsc -p .') === 'build' && cmd('eslint src') === 'lint' && cmd('ruff check .') === 'lint')
check('不乱认：普通命令 / 单词里碰巧带的字都不算', ['ls -la', 'cat README.md', 'echo hello', 'git status', 'git log --oneline', 'grep -rn latest .', 'mkdir contest', 'node server.js'].every((c) => cmd(c) === null), ['ls -la', 'echo hello', 'mkdir contest'].map(cmd).join(','))
check('非 shell 工具（读文件 / 搜索）里出现 git commit 字样也不算', dev.classifyCommand('read', '{"path":"git commit"}') === null && dev.classifyCommand('grep', '{"pattern":"git push"}') === null)
check('shell 工具名的各种叫法都认（bash / pwsh / PowerShell / run_command）', ['bash', 'pwsh', 'PowerShell', 'run_command', 'terminal'].every((t) => dev.classifyCommand(t, 'git commit -m x') === 'commit'))
check('空参数 / 缺参数返回 null、不抛', dev.classifyCommand('bash', '') === null && dev.classifyCommand('bash', undefined) === null && dev.classifyCommand(undefined, 'git push') === null)

check('回滚：git reset --hard / checkout -- . / restore / revert / stash 都认', ['git reset --hard HEAD~1', 'git checkout -- .', 'git restore src/a.js', 'git revert abc123', 'git stash'].every((c) => cmd(c) === 'rollback') && cmd('git checkout main') === null)
const J = (o) => JSON.stringify(o)
check('命令指纹：只差空白 / 数字（端口、行号）算同一条，不同命令不同指纹，取不到 command 返回 0', dev.commandFingerprint(J({ command: 'python app.py --port 8000' })) === dev.commandFingerprint(J({ command: 'python  app.py --port 9001' })) && dev.commandFingerprint(J({ command: 'npm test' })) !== dev.commandFingerprint(J({ command: 'npm run build' })) && dev.commandFingerprint('') === 0 && dev.commandFingerprint('not json') === 0)
check('改文件指纹：不同字段名 / 斜杠方向 / 大小写写同一个文件算同一个；非改文件工具 / 取不到路径返回 0；只留哈希（数字）', dev.editTargetFingerprint('edit', J({ file_path: String.raw`C:\proj\src\App.js` })) === dev.editTargetFingerprint('write', J({ path: 'c:/proj/src/app.js' })) && dev.editTargetFingerprint('read', J({ path: 'a' })) === 0 && dev.editTargetFingerprint('edit', J({ foo: 1 })) === 0 && typeof dev.editTargetFingerprint('edit', J({ path: 'a' })) === 'number')
check('密钥进提交：git add .env / id_rsa / *.pem / credentials 提醒；.env.example / 普通源码 / 非 shell 工具不提醒', ['git add .env', 'git add -f id_rsa', 'git add certs/server.pem', 'git add credentials.json'].every((c) => dev.isSecretAdd('bash', J({ command: c }))) && !dev.isSecretAdd('bash', J({ command: 'git add .env.example src/a.js' })) && !dev.isSecretAdd('bash', J({ command: 'git add src/a.js' })) && !dev.isSecretAdd('read', J({ command: 'git add .env' })))

console.log('\n每日一签\n')
check('只由日期决定：同一天永远同一支，换一天可以不一样', JSON.stringify(ft.fortuneOf('2026-10-03')) === JSON.stringify(ft.fortuneOf('2026-10-03')) && new Set(Array.from({ length: 30 }, (_, i) => ft.fortuneOf('2026-10-' + String(i + 1).padStart(2, '0')).rank)).size >= 3)
const dist = {}
let seed0 = 0
for (let i = 0; i < 3650; i++) {
  const d = new Date(2026, 0, 1 + i)
  const f = ft.fortuneOf(ft.dateKey(d))
  dist[f.level] = (dist[f.level] || 0) + 1
  seed0 += f.seed % 2
}
const pct = (k) => Math.round(((dist[k] || 0) / 3650) * 100)
check('十年的签：每一档都出现，比例接近权重（大吉 10 / 中吉 25 / 小吉 30 / 末吉 20 / 凶 15，误差 ±5）', ft.FORTUNE_LEVELS.every((l) => Math.abs(pct(l.id) - l.w) <= 5), JSON.stringify(ft.FORTUNE_LEVELS.map((l) => [l.rank, pct(l.id)])))
check('权重合计 100，凶是最少的两档之一（吉多凶少）', ft.FORTUNE_LEVELS.reduce((a, l) => a + l.w, 0) === 100 && ft.FORTUNE_LEVELS.find((l) => l.id === 'kyo').w <= 15)
check('宜 / 忌：取自词表、不为空、签文两行 + 幸运图', (() => {
  const f = ft.fortuneOf('2026-10-03')
  const t = ft.fortuneText(f, '加油')
  return ft.FORTUNE_YI.includes(f.yi) && ft.FORTUNE_JI.includes(f.ji) && t.split('\n').length === 3 && t.includes('幸运图：加油') && ft.fortuneText(f).split('\n').length === 2
})())
check('dateKey 是本地日期 YYYY-MM-DD', ft.dateKey(new Date(2026, 9, 3, 23, 59)) === '2026-10-03' && ft.dateKey(new Date(2026, 0, 5, 0, 1)) === '2026-01-05')
check('FNV 稳定：同输入同输出、跨调用一致', ft.fnv1a('abc') === ft.fnv1a('abc') && ft.fnv1a('abc') !== ft.fnv1a('abd') && ft.fnv1a('') === 0x811c9dc5)

const lv = stk.MIN_LEVEL
const pick = (seen, level, seed) => ft.pickLucky(ids, seen, level, lv, seed)
check('幸运图优先挑图鉴里还没收录的', (() => {
  const seen = ids.slice(0, ids.length - 3)
  const rest = new Set(ids.slice(-3))
  return Array.from({ length: 20 }, (_, i) => pick(seen, 99, i * 7919)).every((id) => rest.has(id))
})())
check('全收齐了就任挑一张（不返回空）', ids.includes(pick(ids, 99, 12345)))
check('好感等级不够的黏人图先跳过（等级 1 永远抽不到 love1 / rose）', Array.from({ length: 400 }, (_, i) => pick([], 1, i * 31337)).every((id) => !(id in lv)))
check('同一天同一状态，幸运图固定（不会刷新页面就变）', pick(['smile'], 3, 777) === pick(['smile'], 3, 777))
check('清单为空返回 null、不抛', ft.pickLucky([], [], 1, lv, 5) === null && ft.pickLucky(undefined, undefined, 1, lv, 5) === null)
check('抽签关键词：运势 / 抽签 / 求签 / 占卜 / おみくじ 都认，普通话不认', ['今日运势', '抽个签', '帮我求签', '占卜一下', 'おみくじ'].every((s) => ft.FORTUNE_RE.test(s)) && !ft.FORTUNE_RE.test('今天天气不错'))

console.log('\n台词与配图\n')
const sayIds = ['fortuneOffer', 'fortuneNo', 'fortuneAgain', ...ft.FORTUNE_LEVELS.map((l) => l.say)]
check('每个新台词 id 都有台词、都配了图，台词不超长（≤28 字、至多一个括号动作）', sayIds.every((s) => {
  const pool = SCENE_LINES[s]
  return Array.isArray(pool) && pool.length >= 2 && pool.every((x) => x.length <= 28 && (x.match(/（/g) || []).length <= 1) && lineFor(s) && stk.EVENT_STICKER[s] && stk.EVENT_STICKER[s].every((i) => manifest[i])
}), sayIds.filter((s) => !SCENE_LINES[s]).join(','))
check('「凶」永远是安慰口吻：台词里带「陪」「拍拍」「递白饭」「小虫子」之一，没有吓人的话', SCENE_LINES.fortuneBad.every((s) => /陪|拍拍|白饭|小虫子/.test(s)) && !SCENE_LINES.fortuneBad.some((s) => /倒霉|完蛋|惨|报应/.test(s)))
check('不提第三方模型品牌、不叫「鱼片」', ![...Object.values(SCENE_LINES).flat()].some((s) => /GLM|Kimi|Qwen|GPT|Claude|Gemini|智谱|鱼片/i.test(s)))
const worst = ft.fortuneText({ rank: '大吉', yi: ft.FORTUNE_YI.reduce((a, b) => (b.length > a.length ? b : a)), ji: ft.FORTUNE_JI.reduce((a, b) => (b.length > a.length ? b : a)) }, Object.values(manifest).reduce((a, b) => (String(b.name).length > a.length ? String(b.name) : a), ''))
const longestTail = Math.max(...ft.FORTUNE_LEVELS.map((l) => Math.max(...SCENE_LINES[l.say].map((s) => s.length))), ...SCENE_LINES.fortuneAgain.map((s) => s.length))
check('最长的一支签（宜忌幸运图都取最长）加签尾也不到 100 字（气泡只有 ≤100 字才挂幸运图）', worst.length + 1 + longestTail <= 100, `${worst.length + 1 + longestTail} 字`)

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`)
process.exit(fail > 0 ? 1 : 0)
