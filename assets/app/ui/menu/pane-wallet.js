/**
 * ui/menu/pane-wallet.js —— 设置页里的「记账 / 钱包配置」：右键钱包读哪家的余额。
 * API key 本身不经过这里——走 DSH 自己的「新增模型（自定义 API）」凭据管理，这里只填「用哪个凭据名去读」。
 */

import { BASE } from '../../config.js'
import { $ } from '../../core/util.js'
import { hud, hudFetch } from '../hud.js'

/** 把钱包配置表单挂到 box 上；回填当前配置、保存并（可选）测试连接。 */
export function buildWalletSection(box) {
  // ———— 记账厂商配置——原来单独占一个「配置」标签页，内容不算多，
  // 没必要多占一页，合并到设置末尾。
  // 右键钱包读哪个厂商的余额，在这配；API key 本身不经过这里——
  // 还是走 DSH 自己的「新增模型（自定义 API）」凭据管理，这里只填
  // 「用哪个凭据名去读」，跟 DSH 那边填的凭据名对上就行。
  // 「自定义 API」这组字段的设计直接照抄 DSH 自己「新增模型（自定义
  // API）」→「接口与字段（高级）」那个界面——那套已经踩过各家厂商接口
  // 形状不一样的坑（有的只给「剩余」，有的只给「总量/已用」；有的连
  // 余额接口都没有，只能靠真实 token 用量按自定义单价估）。
  box.append($('div', 'dshp-hint', '—— 💰 记账 / 钱包配置 ——'))
  box.append(
    $(
      'div',
      'dshp-hint',
      '配右键钱包读哪家的余额。API key 本身不填在这——去 DSH「新增模型（自定义 API）」那边配好凭据，这里只填用哪个凭据名去读。',
    ),
  )

  /** label+input 竖排的小 helper，减少重复代码。 */
  function mkTextField(labelText, placeholder) {
    const field = $('label', 'dshp-field')
    field.append($('span', 'dshp-field-label', labelText))
    const input = document.createElement('input')
    input.type = 'text'
    if (placeholder) input.placeholder = placeholder
    field.appendChild(input)
    return { field, input }
  }

  const providerField = $('label', 'dshp-field')
  providerField.append($('span', 'dshp-field-label', '记账厂商'))
  const providerSel = document.createElement('select')
  for (const [val, text] of [
    ['deepseek', 'DeepSeek 官方'],
    ['openrouter', 'OpenRouter'],
    ['custom', '自定义 API'],
  ]) {
    const opt = document.createElement('option')
    opt.value = val
    opt.textContent = text
    providerSel.appendChild(opt)
  }
  providerField.appendChild(providerSel)

  const { field: credField, input: credInput } = mkTextField('凭据名（留空用厂商默认）')
  const credHint = $(
    'div',
    'dshp-hint',
    '这里填的是凭据的「名字」，不是 API Key 本身——真正的密钥值要去 DSH「新增模型（自定义 API）」那边注册好，这里只填注册时用的那个名字（或者对应的环境变量名）。',
  )

  // ———— 只有「自定义 API」才需要下面这些字段，整体一起显隐 ————
  const customBox = $('div')

  const { field: urlField, input: urlInput } = mkTextField('余额接口', 'https://example.com/api/balance')
  const { field: headerField, input: headerInput } = mkTextField('请求头（{key} 会替换成凭据值）', 'Bearer {key}')
  const { field: curField, input: curInput } = mkTextField('币种', 'USD')
  const { field: mulField, input: mulInput } = mkTextField('数值乘数（留空 = 1）', '例如 0.0001')

  customBox.append(
    urlField,
    headerField,
    curField,
    mulField,
    $(
      'div',
      'dshp-hint',
      '余额取值二选一：接口直接给「剩余」就填下面第一个；只给「总量」和「已用」（没有剩余字段）就填后两个。',
    ),
  )
  const { field: totalBalField, input: totalBalInput } = mkTextField('余额字段', '例如 data.limit_remaining')
  const { field: totalField, input: totalInput } = mkTextField('总量字段', '例如 data.total_credits')
  const { field: usedField, input: usedInput } = mkTextField('已用字段', '例如 data.total_usage')
  const { field: limitField, input: limitInput } = mkTextField('额度上限字段（可选，配额环用）', '例如 data.limit')
  customBox.append(totalBalField, totalField, usedField, limitField)

  customBox.append($('div', 'dshp-hint', '用量接口可选：跟余额接口完全独立的第二个接口，专门查「今日已用」（比如 OpenAI 兼容中转站的 /v1/dashboard/billing/usage）。留空就退回余额差分估算。'))
  const { field: usageUrlField, input: usageUrlInput } = mkTextField('用量接口（可选）', 'https://example.com/api/usage')
  const { field: usagePathField, input: usagePathInput } = mkTextField('用量字段', '例如 total_usage')
  const { field: usageMulField, input: usageMulInput } = mkTextField('用量乘数（留空 = 1）', '例如 0.01')
  customBox.append(usageUrlField, usagePathField, usageMulField)

  customBox.append(
    $(
      'div',
      'dshp-hint',
      '事件匹配：给完全没有余额/用量接口可查的厂商兜底（比如公司内部网关）。这一轮用的模型名命中下面任意一个关键字（逗号分隔），就改用真实 token 用量 × 下面这份自定义单价直接算钱。留空 = 不启用。',
    ),
  )
  const { field: eventField, input: eventInput } = mkTextField('事件匹配关键字', '会话事件里的模型名关键字，逗号分隔')
  const { field: hitField, input: hitInput } = mkTextField('缓存命中单价', '例：0.02')
  const { field: missField, input: missInput } = mkTextField('未命中输入单价', '例：1.0')
  const { field: outField, input: outInput } = mkTextField('输出单价', '例：4.0')
  const priceCurField = $('label', 'dshp-field')
  priceCurField.append($('span', 'dshp-field-label', '单价币种'))
  const priceCurSel = document.createElement('select')
  for (const [val, text] of [
    ['CNY', '人民币（元 / CNY）'],
    ['USD', '美元（$ / USD）'],
  ]) {
    const opt = document.createElement('option')
    opt.value = val
    opt.textContent = text
    priceCurSel.appendChild(opt)
  }
  priceCurField.appendChild(priceCurSel)
  const { field: rateField, input: rateInput } = mkTextField('汇率（仅单价币种选美元时需要）', '例如 7.1')
  customBox.append(
    eventField,
    hitField,
    missField,
    outField,
    priceCurField,
    rateField,
    $('div', 'dshp-hint', '单位是「币种 / 百万 token」，三个单价留空则沿用内置 DeepSeek 价目表。'),
  )

  const CRED_DEFAULT = { deepseek: 'DEEPSEEK_API_KEY', openrouter: 'OPENROUTER_API_KEY', custom: '' }
  function syncConfigVisibility() {
    const isCustom = providerSel.value === 'custom'
    customBox.style.display = isCustom ? '' : 'none'
    credInput.placeholder = CRED_DEFAULT[providerSel.value] || '凭据名'
    rateField.style.display = priceCurSel.value === 'USD' ? '' : 'none'
  }
  providerSel.addEventListener('change', syncConfigVisibility)
  priceCurSel.addEventListener('change', syncConfigVisibility)
  syncConfigVisibility()

  const walletRow = $('div', 'dshp-row')
  const saveBtn = $('button', 'dshp-btn dshp-primary', '保存')
  const testBtn = $('button', 'dshp-btn', '保存并测试连接')
  walletRow.append(saveBtn, testBtn)
  const statusText = $('div', 'dshp-hint')

  box.append(providerField, credField, credHint, customBox, walletRow, statusText)

  // 回填当前配置——先把空表单挂上去，拉到数据再填，不用等接口回来才出现整页
  fetch(BASE + '/config', { cache: 'no-store' })
    .then((r) => r.json())
    .then((cfg) => {
      providerSel.value = cfg.walletProvider || 'deepseek'
      credInput.value = cfg.walletCredentialKey || ''
      const c = cfg.walletCustom || {}
      urlInput.value = c.balanceUrl || ''
      headerInput.value = c.authHeaderTemplate || ''
      curInput.value = c.currency || ''
      mulInput.value = c.valueMultiplier != null ? String(c.valueMultiplier) : ''
      totalBalInput.value = c.totalBalancePath || ''
      totalInput.value = c.totalPath || ''
      usedInput.value = c.usedPath || ''
      limitInput.value = c.limitPath || ''
      usageUrlInput.value = c.usageUrl || ''
      usagePathInput.value = c.usagePath || ''
      usageMulInput.value = c.usageMultiplier != null ? String(c.usageMultiplier) : ''
      eventInput.value = c.eventMatchKeywords || ''
      hitInput.value = c.priceHit != null ? String(c.priceHit) : ''
      missInput.value = c.priceMiss != null ? String(c.priceMiss) : ''
      outInput.value = c.priceOut != null ? String(c.priceOut) : ''
      priceCurSel.value = c.priceCurrency || 'CNY'
      rateInput.value = c.exchangeRate != null ? String(c.exchangeRate) : ''
      syncConfigVisibility()
    })
    .catch(() => {})

  const numOrNull = (s) => (s.trim() === '' ? null : Number(s.trim()))
  function collectConfig() {
    return {
      walletProvider: providerSel.value,
      walletCredentialKey: credInput.value.trim(),
      walletCustom: {
        balanceUrl: urlInput.value.trim(),
        authHeaderTemplate: headerInput.value.trim(),
        currency: curInput.value.trim() || 'USD',
        valueMultiplier: numOrNull(mulInput.value) || 1,
        totalBalancePath: totalBalInput.value.trim(),
        totalPath: totalInput.value.trim(),
        usedPath: usedInput.value.trim(),
        limitPath: limitInput.value.trim(),
        usageUrl: usageUrlInput.value.trim(),
        usagePath: usagePathInput.value.trim(),
        usageMultiplier: numOrNull(usageMulInput.value) || 1,
        eventMatchKeywords: eventInput.value.trim(),
        priceHit: numOrNull(hitInput.value),
        priceMiss: numOrNull(missInput.value),
        priceOut: numOrNull(outInput.value),
        priceCurrency: priceCurSel.value,
        exchangeRate: numOrNull(rateInput.value),
      },
    }
  }

  // 「凭据名」填的应该是名字（比如 DEEPSEEK_API_KEY），不是密钥本身——
  // 真见过有人直接把 sk-xxx 粘进来，报错「没配置 sk-xxx」看着莫名其妙。
  // 这种形状（sk-/sess-/key- 开头 + 一长串字母数字）大概率是密钥不是名字，
  // 保存前拦一下，别让人绕着这个坑反复试。
  const looksLikeRawKey = (s) => /^(sk|sess|key|api)[-_][a-z0-9]{16,}$/i.test(s.trim())
  async function saveConfig(thenTest) {
    const credVal = credInput.value.trim()
    if (looksLikeRawKey(credVal)) {
      statusText.textContent =
        '「凭据名」这里应该填名字（比如 DEEPSEEK_API_KEY），不是密钥本身——你填的这串看着像真实密钥。去 DSH「新增模型（自定义 API）」把密钥注册成具名凭据，这里只填那个名字，或者设个同名环境变量。'
      return
    }
    saveBtn.disabled = true
    testBtn.disabled = true
    statusText.textContent = '保存中…'
    try {
      const res = await fetch(BASE + '/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectConfig()),
      })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error || '保存失败')
      statusText.textContent = '已保存'
      if (thenTest) {
        statusText.textContent = '保存成功，正在测试连接…'
        await hudFetch(true)
        const bad = hud.data && hud.data.code
        statusText.textContent = bad
          ? '没连上：' + (hud.data.errText || hud.data.code)
          : '连上了，右键看一下钱包，数字对不对'
      }
    } catch (err) {
      statusText.textContent = '保存失败：' + String((err && err.message) || err).slice(0, 120)
    } finally {
      saveBtn.disabled = false
      testBtn.disabled = false
    }
  }
  saveBtn.addEventListener('click', () => saveConfig(false))
  testBtn.addEventListener('click', () => saveConfig(true))
}
