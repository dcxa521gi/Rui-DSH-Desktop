import { randomBytes } from 'node:crypto'
import { Notification } from 'electron'
import { log } from './log.js'

const BASE = 'https://ilinkai.weixin.qq.com'
const BOT_TYPE = '3'
const ILINK_APP_ID = 'bot'
const PROTOCOL_VERSION = '2.4.6'
const CLIENT_VERSION = ((2 & 0xff) << 16) | ((4 & 0xff) << 8) | (6 & 0xff)
const QR_POLL_MS = 45_000

export type WeixinAccount = {
  token: string
  accountId: string
  userId?: string
  baseUrl: string
  cursor: string
}

export type WeixinQrStart = {
  sessionKey: string
  qrcode: string
  qrcodeUrl: string
}

export type WeixinQrWait = {
  connected: boolean
  status: string
  message: string
  qrcodeUrl?: string
  account?: WeixinAccount
}

type ActiveLogin = {
  sessionKey: string
  qrcode: string
  qrcodeUrl: string
  startedAt: number
  pendingVerifyCode?: string
  currentBase: string
}

const logins = new Map<string, ActiveLogin>()

export function weixinProtocolVersion(): string {
  return PROTOCOL_VERSION
}

function commonHeaders(): Record<string, string> {
  return {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(CLIENT_VERSION),
  }
}

function postHeaders(token?: string): Record<string, string> {
  const uin = Buffer.from(String(randomBytes(4).readUInt32BE(0)), 'utf8').toString('base64')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': uin,
    ...commonHeaders(),
  }
  if (token !== undefined && token !== '') headers.Authorization = `Bearer ${token}`
  return headers
}

function baseInfo(): { channel_version: string; bot_agent: string } {
  return { channel_version: PROTOCOL_VERSION, bot_agent: 'RuiDSHDesktop/0.2.4' }
}

async function fetchWeixinQr(existingTokens: string[]): Promise<{ qrcode: string; qrcodeUrl: string }> {
  const response = await fetch(`${BASE}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`, {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify({ local_token_list: existingTokens.slice(-10) }),
    signal: AbortSignal.timeout(20_000),
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`获取二维码失败 HTTP ${String(response.status)}`)
  const body = JSON.parse(raw) as { qrcode?: string; qrcode_img_content?: string; ret?: number }
  if (typeof body.qrcode !== 'string' || typeof body.qrcode_img_content !== 'string') {
    throw new Error(`获取二维码失败：${raw.slice(0, 200)}`)
  }
  return { qrcode: body.qrcode, qrcodeUrl: body.qrcode_img_content }
}

export async function startWeixinQr(existingTokens: string[]): Promise<WeixinQrStart> {
  const body = await fetchWeixinQr(existingTokens)
  const sessionKey = `wx-${Date.now().toString(36)}`
  logins.set(sessionKey, {
    sessionKey,
    qrcode: body.qrcode,
    qrcodeUrl: body.qrcodeUrl,
    startedAt: Date.now(),
    currentBase: BASE,
  })
  return { sessionKey, qrcode: body.qrcode, qrcodeUrl: body.qrcodeUrl }
}

export async function pollWeixinQr(sessionKey: string, verifyCode?: string): Promise<WeixinQrWait> {
  const login = logins.get(sessionKey)
  if (login === undefined) {
    return { connected: false, status: 'missing', message: '没有进行中的登录，请重新生成二维码。' }
  }
  if (verifyCode !== undefined && verifyCode !== '') login.pendingVerifyCode = verifyCode
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(login.qrcode)}`
  if (login.pendingVerifyCode !== undefined) {
    endpoint += `&verify_code=${encodeURIComponent(login.pendingVerifyCode)}`
  }
  const response = await fetch(`${login.currentBase}/${endpoint}`, {
    headers: commonHeaders(),
    signal: AbortSignal.timeout(QR_POLL_MS),
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`查询扫码状态失败 HTTP ${String(response.status)}`)
  const body = JSON.parse(raw) as {
    status?: string
    bot_token?: string
    ilink_bot_id?: string
    ilink_user_id?: string
    baseurl?: string
    redirect_host?: string
  }
  const status = body.status ?? 'wait'
  if (status === 'scaned_but_redirect' && typeof body.redirect_host === 'string' && body.redirect_host !== '') {
    login.currentBase = `https://${body.redirect_host}`
    return { connected: false, status, message: '正在切换登录节点…', qrcodeUrl: login.qrcodeUrl }
  }
  if (status === 'expired') {
    const next = await fetchWeixinQr([])
    login.qrcode = next.qrcode
    login.qrcodeUrl = next.qrcodeUrl
    login.startedAt = Date.now()
    login.currentBase = BASE
    login.pendingVerifyCode = undefined
    return {
      connected: false,
      status,
      message: '二维码已过期，已刷新，请重新扫描。',
      qrcodeUrl: next.qrcodeUrl,
    }
  }
  if (status === 'need_verifycode') {
    return {
      connected: false,
      status,
      message: '请输入手机微信显示的数字。',
      qrcodeUrl: login.qrcodeUrl,
    }
  }
  if (status === 'confirmed') {
    if (typeof body.bot_token !== 'string' || typeof body.ilink_bot_id !== 'string') {
      return { connected: false, status, message: '登录成功但未返回凭证，请重试。' }
    }
    logins.delete(sessionKey)
    return {
      connected: true,
      status,
      message: '微信已连接。',
      account: {
        token: body.bot_token,
        accountId: body.ilink_bot_id,
        userId: typeof body.ilink_user_id === 'string' ? body.ilink_user_id : undefined,
        baseUrl: typeof body.baseurl === 'string' && body.baseurl !== '' ? body.baseurl : BASE,
        cursor: '',
      },
    }
  }
  if (status === 'binded_redirect') {
    logins.delete(sessionKey)
    return { connected: false, status, message: '该微信已绑定过，无需重复连接。' }
  }
  if (status === 'scaned') {
    return { connected: false, status, message: '已扫码，请在手机上确认。', qrcodeUrl: login.qrcodeUrl }
  }
  return { connected: false, status, message: '请用微信扫描二维码。', qrcodeUrl: login.qrcodeUrl }
}

export async function weixinGetUpdates(account: WeixinAccount): Promise<{
  account: WeixinAccount
  texts: Array<{ from: string; text: string; contextToken?: string }>
}> {
  const response = await fetch(`${ensureSlash(account.baseUrl)}ilink/bot/getupdates`, {
    method: 'POST',
    headers: postHeaders(account.token),
    body: JSON.stringify({ get_updates_buf: account.cursor, base_info: baseInfo() }),
    signal: AbortSignal.timeout(QR_POLL_MS),
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`微信收消息失败 HTTP ${String(response.status)} ${raw.slice(0, 120)}`)
  const body = JSON.parse(raw) as {
    ret?: number
    get_updates_buf?: string
    msgs?: Array<{
      from_user_id?: string
      message_type?: number
      context_token?: string
      item_list?: Array<{ type?: number; text_item?: { text?: string } }>
    }>
  }
  const texts: Array<{ from: string; text: string; contextToken?: string }> = []
  for (const msg of body.msgs ?? []) {
    if (msg.message_type !== 1) continue
    const text = (msg.item_list ?? [])
      .map((item) => item.text_item?.text ?? '')
      .filter((part) => part !== '')
      .join('\n')
    if (text === '') continue
    texts.push({
      from: msg.from_user_id ?? 'unknown',
      text,
      contextToken: msg.context_token,
    })
  }
  return {
    account: {
      ...account,
      cursor: typeof body.get_updates_buf === 'string' ? body.get_updates_buf : account.cursor,
    },
    texts,
  }
}

export async function weixinSendText(
  account: WeixinAccount,
  toUserId: string,
  text: string,
  contextToken?: string,
): Promise<void> {
  const response = await fetch(`${ensureSlash(account.baseUrl)}ilink/bot/sendmessage`, {
    method: 'POST',
    headers: postHeaders(account.token),
    body: JSON.stringify({
      base_info: baseInfo(),
      msg: {
        to_user_id: toUserId,
        context_token: contextToken ?? '',
        item_list: [{ type: 1, text_item: { text } }],
      },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`微信发消息失败 HTTP ${String(response.status)}`)
  const body = JSON.parse(raw) as { ret?: number; errmsg?: string }
  if (body.ret !== undefined && body.ret !== 0) {
    throw new Error(body.errmsg ?? `sendmessage ret=${String(body.ret)}`)
  }
}

export function notifyIm(title: string, body: string): void {
  try {
    new Notification({ title, body: body.slice(0, 180) }).show()
  } catch (error) {
    log('warn', `im notify failed: ${String(error)}`)
  }
}

function ensureSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}
