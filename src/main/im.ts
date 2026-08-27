import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BrowserWindow } from 'electron'
import { qrSvgMarkup } from './im-qr.js'
import {
  notifyIm,
  pollWeixinQr,
  startWeixinQr,
  weixinGetUpdates,
  weixinProtocolVersion,
  weixinSendText,
  type WeixinAccount,
} from './im-weixin.js'
import { getDesktopSettings, updateDesktopSettings } from './desktop-settings.js'
import { harnessRpc, type WorkspaceRow } from './harness-rpc.js'
import { log } from './log.js'

export type ChannelId = 'weixin' | 'feishu' | 'wecom' | 'dingtalk' | 'telegram' | 'discord'

export type ImProgress = {
  phase: 'wait' | 'scan' | 'qr' | 'connected' | 'message' | 'plugin' | 'error' | 'status'
  channel: ChannelId
  message: string
}

export type InboxItem = {
  id: string
  channel: ChannelId
  from: string
  text: string
  at: number
  contextToken?: string
}

export type ChannelView = {
  id: ChannelId
  name: string
  hint: string
  connected: boolean
  status: string
  qrSvg?: string
  needVerify?: boolean
  plugin: {
    packageName?: string
    protocolVersion?: string
    installedVersion?: string
    latest?: string
    pendingVersion?: string
    updateReady: boolean
  }
  inbox: InboxItem[]
  fields: Array<{ key: string; label: string; secret?: boolean; hasValue: boolean; placeholder?: string }>
  botLabel?: string
}

type Store = {
  weixin?: WeixinAccount
  telegram?: { token: string; offset: number; username?: string; enabled?: boolean }
  feishu?: { appId: string; appSecret: string; webhook: string }
  wecom?: { corpId: string; secret: string; agentId: string }
  dingtalk?: { webhook: string; secret: string }
  discord?: { webhook: string }
  plugins: Partial<
    Record<
      ChannelId,
      { installedVersion?: string; pendingVersion?: string; pendingFile?: string; latest?: string }
    >
  >
  inbox: InboxItem[]
  routes: Record<string, string>
}

const WEIXIN_PACKAGE = '@tencent-weixin/openclaw-weixin'
const NAMES: Record<ChannelId, string> = {
  weixin: '微信',
  feishu: '飞书',
  wecom: '企业微信',
  dingtalk: '钉钉',
  telegram: 'Telegram',
  discord: 'Discord',
}
const HINTS: Record<ChannelId, string> = {
  weixin: '腾讯官方 iLink 扫码（对照 @tencent-weixin/openclaw-weixin）。扫码后手机通讯录会出现 AI 联系人。不做个人协议。',
  feishu: '官方开放接口。可填应用凭证，或自定义机器人 Webhook 做测试发送。入站回调需要公网地址，后续再接。',
  wecom: '官方开放接口。填写企业 ID、应用 Secret、AgentId 后可测试发送。',
  dingtalk: '官方自定义机器人 Webhook。如开启加签请同时填写密钥。',
  telegram: '官方 Bot API。在 @BotFather 创建机器人后粘贴 Token。',
  discord: '官方 Incoming Webhook。入站 Bot Gateway 后续再接。',
}
const INBOX_LIMIT = 40

let filePath = ''
let pluginRoot = ''
let workspaceDir = ''
let store: Store = { plugins: {}, inbox: [], routes: {} }
let getHarnessUrl: () => string | undefined = () => undefined
let weixinLogin:
  | { sessionKey: string; qrSvg: string; status: string; needVerify: boolean }
  | undefined
let weixinLoop: AbortController | undefined
let telegramLoop: AbortController | undefined
let weixinPolling = false
let weixinPollGen = 0

export function initIm(userDataDir: string, urlFn: () => string | undefined): void {
  pluginRoot = join(userDataDir, 'plugins', 'im')
  workspaceDir = join(userDataDir, 'im-workspace')
  filePath = join(pluginRoot, 'channels.json')
  getHarnessUrl = urlFn
  mkdirSync(pluginRoot, { recursive: true })
  mkdirSync(workspaceDir, { recursive: true })
  store = load()
  if (store.weixin !== undefined) startWeixinLoop()
  if (store.telegram?.token !== undefined && store.telegram.token !== '' && store.telegram.enabled !== false) {
    startTelegramLoop()
  }
}

export async function listHarnessWorkspaces(): Promise<WorkspaceRow[]> {
  const url = getHarnessUrl()
  if (url === undefined) return []
  const listed = await harnessRpc<{ items: WorkspaceRow[] }>(url, 'workspace.list', {})
  return listed.items
}

export async function setImWorkspacePref(workspaceId: unknown, title?: unknown): Promise<{
  imWorkspaceId: string
  imWorkspaceTitle: string
}> {
  const id = typeof workspaceId === 'string' ? workspaceId : ''
  const name =
    typeof title === 'string' && title.trim() !== '' ? title.trim() : getDesktopSettings().imWorkspaceTitle
  const next = updateDesktopSettings({
    imWorkspaceId: id,
    imWorkspaceTitle: name,
  })
  return { imWorkspaceId: next.imWorkspaceId, imWorkspaceTitle: next.imWorkspaceTitle }
}

export async function ensureImWorkspace(title?: unknown): Promise<{
  workspaceId: string
  title: string
  path: string
}> {
  const url = getHarnessUrl()
  if (url === undefined) throw new Error('引擎未就绪')
  const name =
    typeof title === 'string' && title.trim() !== '' ? title.trim() : getDesktopSettings().imWorkspaceTitle || 'IM'
  mkdirSync(workspaceDir, { recursive: true })
  const listed = await harnessRpc<{ items: WorkspaceRow[] }>(url, 'workspace.list', {})
  const existing = listed.items.find((row) => row.title === name)
  if (existing !== undefined) {
    updateDesktopSettings({ imWorkspaceId: existing.workspaceId, imWorkspaceTitle: name })
    return { workspaceId: existing.workspaceId, title: existing.title, path: existing.path }
  }
  const folder =
    name === 'IM' || name === getDesktopSettings().imWorkspaceTitle
      ? workspaceDir
      : join(workspaceDir, name.replace(/[<>:"/\\|?*]+/g, ' ').trim() || 'im')
  mkdirSync(folder, { recursive: true })
  const adopted = listed.items.find((row) => samePath(row.path, folder))
  if (adopted !== undefined) {
    if (adopted.title !== name) {
      await harnessRpc(url, 'workspace.rename', { workspaceId: adopted.workspaceId, title: name })
    }
    updateDesktopSettings({ imWorkspaceId: adopted.workspaceId, imWorkspaceTitle: name })
    return { workspaceId: adopted.workspaceId, title: name, path: adopted.path }
  }
  const created = await harnessRpc<{ workspace: WorkspaceRow }>(url, 'workspace.create', { path: folder })
  const workspaceId = created.workspace.workspaceId
  if (created.workspace.title !== name) {
    await harnessRpc(url, 'workspace.rename', { workspaceId, title: name })
  }
  updateDesktopSettings({ imWorkspaceId: workspaceId, imWorkspaceTitle: name })
  return { workspaceId, title: name, path: folder }
}

export function stopIm(): void {
  weixinLoop?.abort()
  telegramLoop?.abort()
  weixinLoop = undefined
  telegramLoop = undefined
  weixinPolling = false
}

export function listImChannels(): ChannelView[] {
  const ids: ChannelId[] = ['weixin', 'feishu', 'wecom', 'dingtalk', 'telegram', 'discord']
  return ids.map((id) => viewOf(id))
}

export async function startWeixinLogin(): Promise<ChannelView> {
  weixinPollGen += 1
  weixinPolling = false
  const tokens = store.weixin?.token !== undefined ? [store.weixin.token] : []
  const started = await startWeixinQr(tokens)
  weixinLogin = {
    sessionKey: started.sessionKey,
    qrSvg: qrSvgMarkup(started.qrcodeUrl),
    status: '请用微信扫描二维码。',
    needVerify: false,
  }
  emit({ phase: 'qr', channel: 'weixin', message: weixinLogin.status })
  void pollWeixinUntilDone(started.sessionKey)
  return viewOf('weixin')
}

export async function submitWeixinVerify(code: unknown): Promise<ChannelView> {
  const sessionKey = weixinLogin?.sessionKey
  if (sessionKey === undefined) throw new Error('没有进行中的扫码登录。')
  if (typeof code !== 'string' || code.trim() === '') throw new Error('请输入验证码。')
  const result = await pollWeixinQr(sessionKey, code.trim())
  await applyWeixinPoll(result)
  return viewOf('weixin')
}

export function disconnectChannel(id: unknown): ChannelView[] {
  if (id === 'weixin') {
    weixinLoop?.abort()
    weixinLoop = undefined
    store.weixin = undefined
    weixinLogin = undefined
  }
  if (id === 'telegram') {
    telegramLoop?.abort()
    telegramLoop = undefined
    if (store.telegram !== undefined) store.telegram = { ...store.telegram, enabled: false }
  }
  persist()
  emit({ phase: 'status', channel: id as ChannelId, message: '已断开。' })
  return listImChannels()
}

export async function saveImCreds(id: unknown, fields: unknown): Promise<ChannelView> {
  if (typeof id !== 'string' || fields === null || typeof fields !== 'object') {
    throw new Error('无效的渠道凭证。')
  }
  const raw = fields as Record<string, unknown>
  const text = (key: string): string => (typeof raw[key] === 'string' ? raw[key].trim() : '')
  if (id === 'telegram') {
    const token = text('token') || store.telegram?.token || ''
    if (token === '') throw new Error('请填写 Bot Token。')
    const me = await telegramGetMe(token)
    store.telegram = { token, offset: store.telegram?.offset ?? 0, username: me, enabled: true }
    persist()
    startTelegramLoop()
    emit({ phase: 'connected', channel: 'telegram', message: `已连接 @${me}` })
    return viewOf('telegram')
  }
  if (id === 'feishu') {
    store.feishu = {
      appId: text('appId') || store.feishu?.appId || '',
      appSecret: text('appSecret') || store.feishu?.appSecret || '',
      webhook: text('webhook') || store.feishu?.webhook || '',
    }
  }
  if (id === 'wecom') {
    store.wecom = {
      corpId: text('corpId') || store.wecom?.corpId || '',
      secret: text('secret') || store.wecom?.secret || '',
      agentId: text('agentId') || store.wecom?.agentId || '',
    }
  }
  if (id === 'dingtalk') {
    store.dingtalk = {
      webhook: text('webhook') || store.dingtalk?.webhook || '',
      secret: text('secret') || store.dingtalk?.secret || '',
    }
  }
  if (id === 'discord') {
    store.discord = { webhook: text('webhook') || store.discord?.webhook || '' }
  }
  persist()
  emit({ phase: 'status', channel: id as ChannelId, message: '凭证已保存。' })
  return viewOf(id as ChannelId)
}

export async function testImSend(id: unknown): Promise<string> {
  if (id === 'feishu') {
    const webhook = store.feishu?.webhook ?? ''
    if (webhook === '') {
      const appId = store.feishu?.appId ?? ''
      const appSecret = store.feishu?.appSecret ?? ''
      if (appId === '' || appSecret === '') throw new Error('请先填写 Webhook 或应用凭证。')
      const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
        signal: AbortSignal.timeout(15_000),
      })
      const body = (await response.json()) as { code?: number; msg?: string }
      if (body.code !== 0) throw new Error(body.msg ?? '飞书凭证校验失败')
      return '飞书应用凭证有效。入站事件订阅需要公网回调，本版先用于出站。'
    }
    await postJson(webhook, { msg_type: 'text', content: { text: 'Rui DSH Desktop 测试消息' } })
    return '已向飞书 Webhook 发送测试消息。'
  }
  if (id === 'wecom') {
    const cfg = store.wecom
    if (cfg === undefined || cfg.corpId === '' || cfg.secret === '' || cfg.agentId === '') {
      throw new Error('请先填写企业 ID、Secret 和 AgentId。')
    }
    const tokenRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(cfg.corpId)}&corpsecret=${encodeURIComponent(cfg.secret)}`,
      { signal: AbortSignal.timeout(15_000) },
    )
    const tokenBody = (await tokenRes.json()) as { access_token?: string; errmsg?: string }
    if (typeof tokenBody.access_token !== 'string') throw new Error(tokenBody.errmsg ?? '企业微信取 token 失败')
    await postJson(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(tokenBody.access_token)}`,
      {
        touser: '@all',
        msgtype: 'text',
        agentid: Number(cfg.agentId),
        text: { content: 'Rui DSH Desktop 测试消息' },
      },
    )
    return '已向企业微信发送测试消息。'
  }
  if (id === 'dingtalk') {
    const webhook = await signedDingWebhook()
    await postJson(webhook, { msgtype: 'text', text: { content: 'Rui DSH Desktop 测试消息' } })
    return '已向钉钉机器人发送测试消息。'
  }
  if (id === 'discord') {
    const webhook = store.discord?.webhook ?? ''
    if (webhook === '') throw new Error('请先填写 Discord Webhook。')
    await postJson(webhook, { content: 'Rui DSH Desktop 测试消息' })
    return '已向 Discord Webhook 发送测试消息。'
  }
  if (id === 'telegram') {
    const token = store.telegram?.token
    if (token === undefined) throw new Error('请先保存 Telegram Token。')
    const last = [...store.inbox].reverse().find((item) => item.channel === 'telegram')
    if (last === undefined) {
      throw new Error('Telegram 已连接，但还没有可回复的会话。请先给 Bot 发一条消息。')
    }
    await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: last.from,
      text: 'Rui DSH Desktop 测试消息',
    })
    return '已发送 Telegram 测试消息。'
  }
  throw new Error('该渠道不支持测试发送。')
}

export async function replyIm(channel: unknown, to: unknown, text: unknown, contextToken?: unknown): Promise<void> {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('请输入回复内容。')
  const body = text.trim()
  if (channel === 'weixin') {
    if (store.weixin === undefined) throw new Error('微信未连接。')
    if (typeof to !== 'string' || to === '') throw new Error('没有可回复的联系人。')
    await weixinSendText(
      store.weixin,
      to,
      body,
      typeof contextToken === 'string' ? contextToken : undefined,
    )
    return
  }
  if (channel === 'telegram') {
    const token = store.telegram?.token
    if (token === undefined) throw new Error('Telegram 未连接。')
    if (typeof to !== 'string' || to === '') throw new Error('没有可回复的会话。')
    await postJson(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: to, text: body })
    return
  }
  throw new Error('该渠道暂不支持直接回复。')
}

export async function checkImPlugin(id: unknown): Promise<ChannelView> {
  if (id !== 'weixin') throw new Error('该渠道没有独立插件包，凭证保存在本机即可。')
  const latest = await npmLatest(WEIXIN_PACKAGE)
  const plugin = store.plugins.weixin ?? {}
  store.plugins.weixin = { ...plugin, latest }
  persist()
  const current = plugin.installedVersion ?? weixinProtocolVersion()
  const message =
    latest === current
      ? `官方插件已是 ${latest}，本机 iLink 协议 ${weixinProtocolVersion()}。`
      : `官方插件 ${latest}（本机记录 ${current}）。请先完整下载，校验通过后才能更新。`
  emit({ phase: 'plugin', channel: 'weixin', message })
  return viewOf('weixin')
}

export async function downloadImPlugin(id: unknown): Promise<ChannelView> {
  if (id !== 'weixin') throw new Error('该渠道没有可下载的插件包。')
  emit({ phase: 'plugin', channel: 'weixin', message: '正在查询官方插件…' })
  const meta = await npmPackMeta(WEIXIN_PACKAGE)
  const dir = join(pluginRoot, 'weixin')
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, 'pending.tmp')
  const dest = join(dir, `pending-${meta.version}.tgz`)
  emit({ phase: 'plugin', channel: 'weixin', message: `正在下载 ${meta.version}…` })
  const response = await fetch(meta.tarball, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`下载失败 HTTP ${String(response.status)}`)
  const buf = Buffer.from(await response.arrayBuffer())
  if (buf.byteLength < 1024) {
    throw new Error('下载不完整，未启用更新。')
  }
  if (meta.integrity !== undefined && !verifyIntegrity(buf, meta.integrity)) {
    throw new Error('校验失败，未启用更新。')
  }
  writeFileSync(tmp, buf)
  try {
    renameSync(tmp, dest)
  } catch {
    writeFileSync(dest, buf)
    try {
      unlinkSync(tmp)
    } catch {
      // ignore
    }
  }
  if (!existsSync(dest) || buf.byteLength < 1024) {
    throw new Error('下载未完成，未启用更新。')
  }
  store.plugins.weixin = {
    ...(store.plugins.weixin ?? {}),
    latest: meta.version,
    pendingVersion: meta.version,
    pendingFile: dest,
  }
  persist()
  emit({ phase: 'plugin', channel: 'weixin', message: `已完整下载并校验 ${meta.version}，可以更新。` })
  return viewOf('weixin')
}

export function applyImPlugin(id: unknown): ChannelView {
  if (id !== 'weixin') throw new Error('该渠道没有待应用的插件。')
  const plugin = store.plugins.weixin
  if (plugin?.pendingVersion === undefined || plugin.pendingFile === undefined || !existsSync(plugin.pendingFile)) {
    throw new Error('没有完整下载的插件包，不能更新。')
  }
  const current = join(pluginRoot, 'weixin', `current-${plugin.pendingVersion}.tgz`)
  renameSync(plugin.pendingFile, current)
  store.plugins.weixin = {
    installedVersion: plugin.pendingVersion,
    latest: plugin.latest,
  }
  persist()
  emit({
    phase: 'plugin',
    channel: 'weixin',
    message: `已记录官方插件 ${plugin.pendingVersion}。当前内置 iLink 协议 ${weixinProtocolVersion()}；若官方协议有变，会随后续客户端更新。`,
  })
  return viewOf('weixin')
}

function viewOf(id: ChannelId): ChannelView {
  const plugin = store.plugins[id] ?? {}
  const inbox = store.inbox.filter((item) => item.channel === id).slice(-8).reverse()
  const base: ChannelView = {
    id,
    name: NAMES[id],
    hint: HINTS[id],
    connected: false,
    status: '未连接',
    plugin: {
      packageName: id === 'weixin' ? WEIXIN_PACKAGE : undefined,
      protocolVersion: id === 'weixin' ? weixinProtocolVersion() : undefined,
      installedVersion: plugin.installedVersion,
      latest: plugin.latest,
      pendingVersion: plugin.pendingVersion,
      updateReady:
        typeof plugin.pendingVersion === 'string' &&
        typeof plugin.pendingFile === 'string' &&
        existsSync(plugin.pendingFile),
    },
    inbox,
    fields: [],
  }
  if (id === 'weixin') {
    base.connected = store.weixin !== undefined
    if (weixinLogin !== undefined && !base.connected) {
      base.status = weixinLogin.status
      base.qrSvg = weixinLogin.qrSvg
      base.needVerify = weixinLogin.needVerify
    } else if (base.connected) {
      base.status = `已连接（${store.weixin?.accountId ?? 'iLink'}）`
      base.botLabel = store.weixin?.accountId
    }
    return base
  }
  if (id === 'telegram') {
    base.fields = [{ key: 'token', label: 'Bot Token', secret: true, hasValue: Boolean(store.telegram?.token) }]
    base.connected = Boolean(store.telegram?.token) && store.telegram?.enabled !== false
    base.botLabel = store.telegram?.username
    base.status = base.connected ? `已连接${store.telegram?.username !== undefined ? ` @${store.telegram.username}` : ''}` : '未连接'
    return base
  }
  if (id === 'feishu') {
    base.fields = [
      { key: 'appId', label: 'App ID', hasValue: Boolean(store.feishu?.appId) },
      { key: 'appSecret', label: 'App Secret', secret: true, hasValue: Boolean(store.feishu?.appSecret) },
      { key: 'webhook', label: 'Webhook', hasValue: Boolean(store.feishu?.webhook) },
    ]
    base.connected = Boolean(store.feishu?.webhook || (store.feishu?.appId && store.feishu.appSecret))
    base.status = base.connected ? '凭证已保存' : '未连接'
    return base
  }
  if (id === 'wecom') {
    base.fields = [
      { key: 'corpId', label: '企业 ID', hasValue: Boolean(store.wecom?.corpId) },
      { key: 'secret', label: '应用 Secret', secret: true, hasValue: Boolean(store.wecom?.secret) },
      { key: 'agentId', label: 'AgentId', hasValue: Boolean(store.wecom?.agentId) },
    ]
    base.connected = Boolean(store.wecom?.corpId && store.wecom.secret && store.wecom.agentId)
    base.status = base.connected ? '凭证已保存' : '未连接'
    return base
  }
  if (id === 'dingtalk') {
    base.fields = [
      { key: 'webhook', label: 'Webhook', hasValue: Boolean(store.dingtalk?.webhook) },
      { key: 'secret', label: '加签密钥', secret: true, hasValue: Boolean(store.dingtalk?.secret) },
    ]
    base.connected = Boolean(store.dingtalk?.webhook)
    base.status = base.connected ? '凭证已保存' : '未连接'
    return base
  }
  base.fields = [{ key: 'webhook', label: 'Webhook', hasValue: Boolean(store.discord?.webhook) }]
  base.connected = Boolean(store.discord?.webhook)
  base.status = base.connected ? '凭证已保存' : '未连接'
  return base
}

async function pollWeixinUntilDone(sessionKey: string): Promise<void> {
  const gen = weixinPollGen
  weixinPolling = true
  try {
    for (let i = 0; i < 120; i += 1) {
      if (gen !== weixinPollGen || weixinLogin?.sessionKey !== sessionKey) return
      try {
        const result = await pollWeixinQr(sessionKey)
        await applyWeixinPoll(result)
        if (result.connected || result.status === 'missing' || result.status === 'binded_redirect') return
        if (result.status === 'need_verifycode') return
      } catch (error) {
        log('warn', `weixin qr poll: ${String(error)}`)
        await sleep(1_000)
      }
    }
  } finally {
    if (gen === weixinPollGen) weixinPolling = false
  }
}

async function applyWeixinPoll(result: {
  connected: boolean
  status: string
  message: string
  qrcodeUrl?: string
  account?: WeixinAccount
}): Promise<void> {
  if (result.qrcodeUrl !== undefined && weixinLogin !== undefined) {
    weixinLogin.qrSvg = qrSvgMarkup(result.qrcodeUrl)
  }
  if (weixinLogin !== undefined) {
    weixinLogin.status = result.message
    weixinLogin.needVerify = result.status === 'need_verifycode'
  }
  if (result.connected && result.account !== undefined) {
    store.weixin = result.account
    weixinLogin = undefined
    persist()
    emit({ phase: 'connected', channel: 'weixin', message: result.message })
    startWeixinLoop()
    return
  }
  const phase = result.status === 'scaned' ? 'scan' : result.status === 'need_verifycode' || result.qrcodeUrl !== undefined ? 'qr' : 'wait'
  emit({ phase, channel: 'weixin', message: result.message })
}

function startWeixinLoop(): void {
  weixinLoop?.abort()
  const ac = new AbortController()
  weixinLoop = ac
  void (async () => {
    while (!ac.signal.aborted && store.weixin !== undefined) {
      try {
        const next = await weixinGetUpdates(store.weixin)
        store.weixin = next.account
        for (const msg of next.texts) {
          pushInbox('weixin', msg.from, msg.text, msg.contextToken)
          notifyIm('微信', msg.text)
          emit({ phase: 'message', channel: 'weixin', message: msg.text.slice(0, 80) })
        }
        if (next.texts.length > 0) persist()
        else persistQuiet()
      } catch (error) {
        log('warn', `weixin poll: ${String(error)}`)
        await sleep(3_000)
      }
    }
  })()
}

function startTelegramLoop(): void {
  telegramLoop?.abort()
  const ac = new AbortController()
  telegramLoop = ac
  void (async () => {
    while (!ac.signal.aborted && store.telegram !== undefined) {
      try {
        const token = store.telegram.token
        const url = `https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${String(store.telegram.offset)}`
        const response = await fetch(url, { signal: AbortSignal.timeout(35_000) })
        const body = (await response.json()) as {
          ok?: boolean
          result?: Array<{ update_id: number; message?: { chat?: { id?: number }; text?: string; from?: { username?: string } } }>
        }
        if (body.ok !== true) {
          await sleep(5_000)
          continue
        }
        for (const update of body.result ?? []) {
          store.telegram.offset = update.update_id + 1
          const text = update.message?.text
          const chatId = update.message?.chat?.id
          if (typeof text !== 'string' || chatId === undefined) continue
          const from = String(chatId)
          pushInbox('telegram', from, text)
          notifyIm('Telegram', text)
          emit({ phase: 'message', channel: 'telegram', message: text.slice(0, 80) })
        }
        persistQuiet()
      } catch {
        await sleep(3_000)
      }
    }
  })()
}

function pushInbox(channel: ChannelId, from: string, text: string, contextToken?: string): void {
  store.inbox.push({
    id: `${channel}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    channel,
    from,
    text,
    at: Date.now(),
    contextToken,
  })
  if (store.inbox.length > INBOX_LIMIT) store.inbox = store.inbox.slice(-INBOX_LIMIT)
  void routeInboxToSession(channel, from, text).catch((error: unknown) => {
    log('warn', `im session: ${String(error)}`)
  })
}

async function routeInboxToSession(channel: ChannelId, from: string, text: string): Promise<void> {
  const url = getHarnessUrl()
  if (url === undefined) return
  const workspaceId = await resolveImWorkspaceId()
  const key = `${channel}:${from}`
  const existing = store.routes[key]
  if (existing !== undefined) {
    try {
      await promptSession(url, existing, channel, from, text)
      return
    } catch {
      delete store.routes[key]
    }
  }
  const created = await harnessRpc<{ sessionId: string }>(url, 'session.create', { workspaceId })
  const sessionId = created.sessionId
  const title = `${NAMES[channel]} · ${from}`.slice(0, 60)
  try {
    await harnessRpc(url, 'session.rename', { sessionId, title })
  } catch {
    // Title is best-effort; the session still appears in the sidebar.
  }
  store.routes[key] = sessionId
  persistQuiet()
  await promptSession(url, sessionId, channel, from, text)
}

async function promptSession(
  url: string,
  sessionId: string,
  channel: ChannelId,
  from: string,
  text: string,
): Promise<void> {
  await harnessRpc(url, 'session.prompt', {
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: `[${NAMES[channel]} · ${from}]\n${text}` }],
  })
}

async function resolveImWorkspaceId(): Promise<string> {
  const url = getHarnessUrl()
  if (url === undefined) throw new Error('引擎未就绪')
  mkdirSync(workspaceDir, { recursive: true })
  const listed = await harnessRpc<{ items: WorkspaceRow[] }>(url, 'workspace.list', {})
  const settings = getDesktopSettings()
  const byId = listed.items.find((row) => row.workspaceId === settings.imWorkspaceId)
  if (byId !== undefined) return byId.workspaceId
  const byTitle = listed.items.find((row) => row.title === settings.imWorkspaceTitle)
  if (byTitle !== undefined) {
    updateDesktopSettings({ imWorkspaceId: byTitle.workspaceId })
    return byTitle.workspaceId
  }
  const byPath = listed.items.find((row) => samePath(row.path, workspaceDir))
  if (byPath !== undefined) {
    updateDesktopSettings({ imWorkspaceId: byPath.workspaceId })
    return byPath.workspaceId
  }
  const created = await harnessRpc<{ workspace: WorkspaceRow }>(url, 'workspace.create', {
    path: workspaceDir,
  })
  const workspaceId = created.workspace.workspaceId
  const title = settings.imWorkspaceTitle || 'IM'
  if (created.workspace.title !== title) {
    await harnessRpc(url, 'workspace.rename', { workspaceId, title })
  }
  updateDesktopSettings({ imWorkspaceId: workspaceId, imWorkspaceTitle: title })
  return workspaceId
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

async function telegramGetMe(token: string): Promise<string> {
  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
    signal: AbortSignal.timeout(15_000),
  })
  const body = (await response.json()) as { ok?: boolean; result?: { username?: string }; description?: string }
  if (body.ok !== true || typeof body.result?.username !== 'string') {
    throw new Error(body.description ?? 'Telegram Token 无效')
  }
  return body.result.username
}

async function signedDingWebhook(): Promise<string> {
  const webhook = store.dingtalk?.webhook ?? ''
  if (webhook === '') throw new Error('请先填写钉钉 Webhook。')
  const secret = store.dingtalk?.secret ?? ''
  if (secret === '') return webhook
  const timestamp = Date.now()
  const { createHmac } = await import('node:crypto')
  const sign = encodeURIComponent(
    createHmac('sha256', secret).update(`${String(timestamp)}\n${secret}`).digest('base64'),
  )
  const join = webhook.includes('?') ? '&' : '?'
  return `${webhook}${join}timestamp=${String(timestamp)}&sign=${sign}`
}

async function npmLatest(name: string): Promise<string> {
  const encoded = name.replace('/', '%2f')
  const response = await fetch(`https://registry.npmjs.org/${encoded}/latest`, {
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`npm registry HTTP ${String(response.status)}`)
  const body = (await response.json()) as { version?: string }
  if (typeof body.version !== 'string' || body.version === '') throw new Error('npm 未返回版本')
  return body.version
}

async function npmPackMeta(name: string): Promise<{ version: string; tarball: string; integrity?: string }> {
  const encoded = name.replace('/', '%2f')
  const response = await fetch(`https://registry.npmjs.org/${encoded}/latest`, {
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`npm registry HTTP ${String(response.status)}`)
  const body = (await response.json()) as {
    version?: string
    dist?: { tarball?: string; integrity?: string }
  }
  if (typeof body.version !== 'string' || typeof body.dist?.tarball !== 'string') {
    throw new Error('npm 未返回安装包地址')
  }
  return { version: body.version, tarball: body.dist.tarball, integrity: body.dist.integrity }
}

function verifyIntegrity(buf: Buffer, integrity: string): boolean {
  const match = /^sha512-(.+)$/.exec(integrity)
  if (match === null) return true
  const actual = createHash('sha512').update(buf).digest('base64')
  return actual === match[1]
}

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
}

function emit(payload: ImProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('desktop:im-progress', payload)
  }
}

function persist(): void {
  persistQuiet()
}

function persistQuiet(): void {
  if (filePath === '') return
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`)
}

function load(): Store {
  if (!existsSync(filePath)) return { plugins: {}, inbox: [], routes: {} }
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Store
    return {
      weixin: raw.weixin,
      telegram: raw.telegram,
      feishu: raw.feishu,
      wecom: raw.wecom,
      dingtalk: raw.dingtalk,
      discord: raw.discord,
      plugins: raw.plugins ?? {},
      inbox: Array.isArray(raw.inbox) ? raw.inbox : [],
      routes: raw.routes !== undefined && typeof raw.routes === 'object' ? raw.routes : {},
    }
  } catch {
    return { plugins: {}, inbox: [], routes: {} }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
