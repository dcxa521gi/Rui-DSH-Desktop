import { BrowserWindow } from 'electron'

export function injectSidebarTools(win: BrowserWindow): void {
  const script = `(${clientInject.toString()})()`
  void win.webContents.executeJavaScript(script).catch(() => {
    // Page may not be ready (error/loading file or CSP).
  })
}

function clientInject(): void {
  if (location.protocol === 'file:') return
  const w = window as unknown as {
    desktop?: {
      listJobs: () => Promise<
        Array<{
          id: string
          title: string
          prompt: string
          everyMinutes: number
          enabled: boolean
          nextRunAt: number
          lastRunAt?: number
        }>
      >
      saveJob: (job: {
        id?: string
        title: string
        prompt: string
        everyMinutes: number
        enabled: boolean
      }) => Promise<Array<{ id: string; title: string; prompt: string; everyMinutes: number; enabled: boolean; nextRunAt: number }>>
      toggleJob: (id: string, enabled: boolean) => Promise<unknown>
      deleteJob: (id: string) => Promise<unknown>
      listIm: () => Promise<ImChannel[]>
      startWeixin: () => Promise<ImChannel>
      submitWeixinVerify: (code: string) => Promise<ImChannel>
      disconnectIm: (id: string) => Promise<ImChannel[]>
      saveImCreds: (id: string, fields: Record<string, string>) => Promise<ImChannel>
      testImSend: (id: string) => Promise<string>
      replyIm: (channel: string, to: string, text: string, contextToken?: string) => Promise<void>
      checkImPlugin: (id: string) => Promise<ImChannel>
      downloadImPlugin: (id: string) => Promise<ImChannel>
      applyImPlugin: (id: string) => Promise<ImChannel>
      onImProgress: (handler: (payload: { phase: string; channel: string; message: string }) => void) => void
    }
    __ruiSidebarHook?: boolean
  }
  interface ImChannel {
    id: string
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
    inbox: Array<{ id: string; from: string; text: string; at: number; contextToken?: string }>
    fields: Array<{ key: string; label: string; secret?: boolean; hasValue: boolean }>
    botLabel?: string
  }
  if (w.__ruiSidebarHook === true) return
  w.__ruiSidebarHook = true

  const NAV_ID = 'rui-sidebar-tools'
  const VIEW_ID = 'rui-shell-view'
  const STYLE_ID = 'rui-sidebar-style'

  function ensureStyle(): void {
    if (document.getElementById(STYLE_ID) !== null) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
#${NAV_ID}{display:flex;flex-direction:column;gap:4px;margin:0 2px 8px;flex:none}
#${NAV_ID} .rui-side-btn{box-sizing:border-box;appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-primary);height:38px;border-radius:12px;padding:0 12px;display:flex;align-items:center;gap:8px;cursor:pointer;font:inherit;font-size:14px;line-height:22px;width:100%}
#${NAV_ID} .rui-side-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
#${NAV_ID} .rui-side-btn[aria-pressed="true"]{background:var(--dsw-specific-sidebar-nav-item-active, var(--dsw-alias-interactive-bg-hover))}
#${NAV_ID} .rui-side-btn svg{flex:none}
#${NAV_ID} .rui-side-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[class*="_collapsed"] #${NAV_ID}{margin:0 0 12px}
[class*="_collapsed"] #${NAV_ID} .rui-side-btn{width:36px;height:36px;padding:0;justify-content:center;border-radius:50%}
[class*="_collapsed"] #${NAV_ID} .rui-side-label{display:none}
#${VIEW_ID}{position:fixed;z-index:40;background:var(--dsw-alias-bg-layer-1, var(--dsw-specific-sidebar-fill));color:var(--dsw-alias-label-primary);overflow:auto}
#${VIEW_ID} .rui-view{padding:28px 32px 40px;max-width:760px}
#${VIEW_ID} h2{margin:0 0 6px;font-size:20px;font-weight:600}
#${VIEW_ID} .rui-lead{margin:0 0 20px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
#${VIEW_ID} .rui-card{border:1px solid var(--dsw-alias-border-l2);border-radius:16px;padding:14px 16px;margin:0 0 10px;background:var(--dsw-alias-bg-layer-2, transparent)}
#${VIEW_ID} .rui-card h3{margin:0 0 4px;font-size:14px;font-weight:600}
#${VIEW_ID} .rui-muted{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
#${VIEW_ID} .rui-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
#${VIEW_ID} input,#${VIEW_ID} textarea,#${VIEW_ID} select{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1, transparent);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px}
#${VIEW_ID} textarea{width:100%;min-height:72px;resize:vertical}
#${VIEW_ID} button.rui-btn{appearance:none;border:1px solid #4a5568;background:#1a2433;color:#e8ecf1;border-radius:10px;padding:6px 12px;cursor:pointer;font:inherit;font-size:13px;opacity:1;filter:none}
#${VIEW_ID} button.rui-btn.primary{background:#5ee0b5;color:#102018;border-color:#5ee0b5;font-weight:600}
#${VIEW_ID} button.rui-btn:disabled{opacity:1 !important;filter:none !important;cursor:default;background:#243044 !important;color:#d5dbe3 !important;border-color:#4a5568 !important}
#${VIEW_ID} button.rui-btn.primary:disabled{background:#1f4a3c !important;color:#e3f8ee !important;border-color:#3d7a62 !important}
#${VIEW_ID} .rui-status{font-size:12px;line-height:18px;margin-top:8px;color:var(--dsw-alias-label-secondary)}
#${VIEW_ID} .rui-qr{width:220px;height:220px;background:#fff;padding:8px;border-radius:12px;display:block;margin-top:10px}
#${VIEW_ID} .rui-inbox{max-height:160px;overflow:auto;margin-top:8px}
#${VIEW_ID} .rui-field{display:flex;flex-direction:column;gap:4px;min-width:12rem;flex:1}
`
    document.head.appendChild(style)
  }

  function sidebarRoot(): HTMLElement | null {
    const session = document.querySelector('button[class*="_newSession"]')
    return session instanceof HTMLElement ? session.parentElement : null
  }

  function layoutView(): { top: number; left: number; width: number; height: number } {
    const session = document.querySelector('button[class*="_newSession"]')
    const sidebar = session instanceof HTMLElement ? session.closest('[class*="_root"]') : null
    const side = sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect() : { right: 260 }
    const left = Math.max(56, Math.round(side.right))
    return {
      top: 36,
      left,
      width: Math.max(320, window.innerWidth - left),
      height: window.innerHeight - 36,
    }
  }

  function closeView(): void {
    document.getElementById(VIEW_ID)?.remove()
    for (const button of document.querySelectorAll(`#${NAV_ID} .rui-side-btn`)) {
      button.setAttribute('aria-pressed', 'false')
    }
  }

  function openView(kind: 'automation' | 'im', html: string): void {
    ensureStyle()
    closeView()
    const box = layoutView()
    const view = document.createElement('div')
    view.id = VIEW_ID
    view.style.top = `${String(box.top)}px`
    view.style.left = `${String(box.left)}px`
    view.style.width = `${String(box.width)}px`
    view.style.height = `${String(box.height)}px`
    view.innerHTML = html
    document.body.appendChild(view)
    const pressed = document.querySelector(`#${NAV_ID} [data-kind="${kind}"]`)
    if (pressed instanceof HTMLElement) pressed.setAttribute('aria-pressed', 'true')
  }

  function formatTime(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '—'
    return new Date(value).toLocaleString()
  }

  async function renderAutomation(): Promise<void> {
    const api = w.desktop
    const jobs = api !== undefined ? await api.listJobs() : []
    const rows = jobs
      .map((job) => {
        return `<div class="rui-card" data-job="${job.id}">
          <h3>${escapeHtml(job.title)}</h3>
          <div class="rui-muted">${escapeHtml(job.prompt) || '（无提示词）'}</div>
          <div class="rui-muted">每 ${String(job.everyMinutes)} 分钟 · 下次 ${formatTime(job.nextRunAt)}</div>
          <div class="rui-row">
            <button type="button" class="rui-btn" data-act="toggle">${job.enabled ? '暂停' : '启用'}</button>
            <button type="button" class="rui-btn" data-act="delete">删除</button>
          </div>
        </div>`
      })
      .join('')
    openView(
      'automation',
      `<div class="rui-view">
        <h2>自动化</h2>
        <p class="rui-lead">定时提醒，最短间隔 5 分钟。到点后会发系统通知；绑定会话的官方 schedule 工具仍可在对话里使用。</p>
        <div class="rui-card">
          <h3>新建任务</h3>
          <div class="rui-row"><input id="rui-job-title" type="text" placeholder="任务名称" style="min-width:12rem" />
            <label class="rui-muted">间隔 <input id="rui-job-every" type="number" min="5" value="30" style="width:4.5rem" /> 分钟</label></div>
          <div class="rui-row" style="margin-top:8px"><textarea id="rui-job-prompt" placeholder="到点后的提醒内容"></textarea></div>
          <div class="rui-row"><button type="button" class="rui-btn primary" id="rui-job-save">保存任务</button></div>
        </div>
        ${rows === '' ? '<p class="rui-muted">还没有任务。</p>' : rows}
      </div>`,
    )
    document.getElementById('rui-job-save')?.addEventListener('click', async () => {
      const title = (document.getElementById('rui-job-title') as HTMLInputElement | null)?.value ?? ''
      const prompt = (document.getElementById('rui-job-prompt') as HTMLTextAreaElement | null)?.value ?? ''
      const every = Number((document.getElementById('rui-job-every') as HTMLInputElement | null)?.value ?? 30)
      await api?.saveJob({ title, prompt, everyMinutes: every, enabled: true })
      await renderAutomation()
    })
    for (const card of document.querySelectorAll('#rui-shell-view [data-job]')) {
      const id = card.getAttribute('data-job')
      if (id === null) continue
      card.querySelector('[data-act="toggle"]')?.addEventListener('click', async () => {
        const job = jobs.find((item) => item.id === id)
        await api?.toggleJob(id, !(job?.enabled ?? true))
        await renderAutomation()
      })
      card.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
        await api?.deleteJob(id)
        await renderAutomation()
      })
    }
  }

  async function renderIm(): Promise<void> {
    const api = w.desktop
    const channels = api !== undefined ? await api.listIm() : []
    const cards = channels
      .map((channel) => {
        const inbox =
          channel.inbox.length === 0
            ? ''
            : `<div class="rui-inbox">${channel.inbox
                .map(
                  (item) =>
                    `<div class="rui-muted">${escapeHtml(new Date(item.at).toLocaleString())} · ${escapeHtml(item.text)}</div>`,
                )
                .join('')}</div>`
        const fields = channel.fields
          .map((field) => {
            const shown = field.hasValue ? '已保存，可留空沿用' : ''
            return `<label class="rui-field"><span class="rui-muted">${escapeHtml(field.label)}</span>
              <input data-field="${escapeHtml(field.key)}" type="${field.secret === true ? 'password' : 'text'}" placeholder="${escapeHtml(shown)}" /></label>`
          })
          .join('')
        const qr = channel.qrSvg !== undefined ? channel.qrSvg : ''
        const verify =
          channel.needVerify === true
            ? `<div class="rui-row"><input id="rui-wx-verify" type="text" placeholder="手机上的数字" style="width:8rem" />
                <button type="button" class="rui-btn primary" data-act="verify">提交</button></div>`
            : ''
        const replyTo = channel.inbox[0]?.from
        const reply =
          channel.connected && (channel.id === 'weixin' || channel.id === 'telegram')
            ? `<div class="rui-row"><input data-reply type="text" placeholder="回复最近一条" style="flex:1;min-width:12rem" />
                <button type="button" class="rui-btn" data-act="reply" data-to="${escapeHtml(replyTo ?? '')}" data-ctx="${escapeHtml(channel.inbox[0]?.contextToken ?? '')}">发送</button></div>`
            : ''
        const pluginBits =
          channel.plugin.packageName !== undefined
            ? `<div class="rui-muted">官方插件 ${escapeHtml(channel.plugin.latest ?? '未检测')} · 本机协议 ${escapeHtml(channel.plugin.protocolVersion ?? '')}${channel.plugin.installedVersion !== undefined ? ` · 已记录 ${escapeHtml(channel.plugin.installedVersion)}` : ''}</div>
                <div class="rui-row">
                  <button type="button" class="rui-btn" data-act="check">检测更新</button>
                  <button type="button" class="rui-btn" data-act="download">下载插件</button>
                  <button type="button" class="rui-btn primary" data-act="apply" ${channel.plugin.updateReady ? '' : 'disabled'}>更新</button>
                </div>`
            : ''
        const connectBtn =
          channel.id === 'weixin'
            ? `<button type="button" class="rui-btn primary" data-act="login">${channel.connected ? '重新扫码' : '扫码登录'}</button>
               <button type="button" class="rui-btn" data-act="disconnect" ${channel.connected ? '' : 'disabled'}>断开</button>`
            : channel.id === 'telegram'
              ? `<button type="button" class="rui-btn primary" data-act="save">保存并连接</button>
                 <button type="button" class="rui-btn" data-act="disconnect" ${channel.connected ? '' : 'disabled'}>断开</button>
                 <button type="button" class="rui-btn" data-act="test">测试发送</button>`
              : `<button type="button" class="rui-btn primary" data-act="save">保存凭证</button>
                 <button type="button" class="rui-btn" data-act="test">测试发送</button>`
        return `<div class="rui-card" data-channel="${escapeHtml(channel.id)}">
          <h3>${escapeHtml(channel.name)}</h3>
          <div class="rui-muted">${escapeHtml(channel.hint)}</div>
          <div class="rui-status" id="rui-im-status-${escapeHtml(channel.id)}">${escapeHtml(channel.status)}</div>
          ${qr}${verify}
          <div class="rui-row" style="margin-top:8px">${fields}</div>
          <div class="rui-row">${connectBtn}</div>
          ${pluginBits}${inbox}${reply}
        </div>`
      })
      .join('')
    openView(
      'im',
      `<div class="rui-view">
        <h2>IM</h2>
        <p class="rui-lead">渠道插件可独立更新，不必重装客户端。下载必须完整并校验通过，「更新」才会亮起。微信走腾讯官方 iLink 扫码，不做个人协议。凭证保存在本机用户目录。</p>
        ${cards}
      </div>`,
    )
    for (const card of document.querySelectorAll('#rui-shell-view [data-channel]')) {
      const id = card.getAttribute('data-channel')
      if (id === null) continue
      const status = (): HTMLElement | null => document.getElementById(`rui-im-status-${id}`)
      const readFields = (): Record<string, string> => {
        const out: Record<string, string> = {}
        for (const input of card.querySelectorAll('input[data-field]')) {
          if (!(input instanceof HTMLInputElement)) continue
          const key = input.getAttribute('data-field')
          if (key !== null) out[key] = input.value
        }
        return out
      }
      const fail = (error: unknown): void => {
        const el = status()
        if (el !== null) el.textContent = String(error instanceof Error ? error.message : error)
      }
      card.querySelector('[data-act="login"]')?.addEventListener('click', () => {
        void api?.startWeixin().then(() => renderIm(), fail)
      })
      card.querySelector('[data-act="verify"]')?.addEventListener('click', () => {
        const code = (document.getElementById('rui-wx-verify') as HTMLInputElement | null)?.value ?? ''
        void api?.submitWeixinVerify(code).then(() => renderIm(), fail)
      })
      card.querySelector('[data-act="disconnect"]')?.addEventListener('click', () => {
        void api?.disconnectIm(id).then(() => renderIm(), fail)
      })
      card.querySelector('[data-act="save"]')?.addEventListener('click', () => {
        void api?.saveImCreds(id, readFields()).then(() => renderIm(), fail)
      })
      card.querySelector('[data-act="test"]')?.addEventListener('click', () => {
        void api?.testImSend(id).then((message) => {
          const el = status()
          if (el !== null) el.textContent = message
        }, fail)
      })
      card.querySelector('[data-act="check"]')?.addEventListener('click', () => {
        void api?.checkImPlugin(id).then(() => renderIm(), fail)
      })
      card.querySelector('[data-act="download"]')?.addEventListener('click', () => {
        const el = status()
        if (el !== null) el.textContent = '正在下载…'
        void api?.downloadImPlugin(id).then(() => renderIm(), fail)
      })
      card.querySelector('[data-act="apply"]')?.addEventListener('click', () => {
        void api?.applyImPlugin(id).then(() => renderIm(), fail)
      })
      card.querySelector('[data-act="reply"]')?.addEventListener('click', () => {
        const input = card.querySelector('[data-reply]')
        const button = card.querySelector('[data-act="reply"]')
        const text = input instanceof HTMLInputElement ? input.value : ''
        const to = button instanceof HTMLElement ? (button.getAttribute('data-to') ?? '') : ''
        const ctx = button instanceof HTMLElement ? (button.getAttribute('data-ctx') ?? '') : ''
        void api?.replyIm(id, to, text, ctx === '' ? undefined : ctx).then(() => {
          if (input instanceof HTMLInputElement) input.value = ''
          const el = status()
          if (el !== null) el.textContent = '已发送。'
        }, fail)
      })
    }
  }

  function openPlugins(): void {
    closeView()
    const trigger = document.querySelector('[aria-haspopup="dialog"]')
    if (trigger instanceof HTMLElement) trigger.click()
    window.setTimeout(() => {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
      if (!(dialog instanceof HTMLElement)) return
      for (const button of dialog.querySelectorAll('button')) {
        const label = button.textContent ?? ''
        if (/插件|Plugins/i.test(label)) {
          button.click()
          return
        }
      }
    }, 80)
  }

  function escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
  }

  function mount(): void {
    const session = document.querySelector('button[class*="_newSession"]')
    const parent = sidebarRoot()
    if (!(session instanceof HTMLElement) || parent === null) return
    ensureStyle()
    let nav = document.getElementById(NAV_ID)
    if (nav === null) {
      nav = document.createElement('div')
      nav.id = NAV_ID
      nav.innerHTML = `
        <button type="button" class="rui-side-btn" data-kind="automation" title="自动化">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 5.2v3.1l2.1 1.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          <span class="rui-side-label">自动化</span>
        </button>
        <button type="button" class="rui-side-btn" data-kind="plugins" title="插件">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.2 3.2h3.6v2.2h2.2v3.6H9.8v2.2H6.2V9H4V5.4h2.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
          <span class="rui-side-label">插件</span>
        </button>
        <button type="button" class="rui-side-btn" data-kind="im" title="IM">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 4.2h9.6v6.2H6.4L3.2 12.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
          <span class="rui-side-label">IM</span>
        </button>`
      session.insertAdjacentElement('afterend', nav)
      nav.addEventListener('click', (event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        const button = target.closest('button')
        const kind = button?.getAttribute('data-kind')
        if (kind === 'automation') void renderAutomation()
        if (kind === 'plugins') openPlugins()
        if (kind === 'im') void renderIm()
      })
      session.addEventListener('click', closeView)
    } else if (nav.previousElementSibling !== session) {
      session.insertAdjacentElement('afterend', nav)
    }
  }

  w.desktop?.onImProgress((payload) => {
    const view = document.getElementById(VIEW_ID)
    if (view === null || view.querySelector('h2')?.textContent !== 'IM') return
    if (payload.phase === 'wait' || payload.phase === 'scan') {
      const el = document.getElementById(`rui-im-status-${payload.channel}`)
      if (el !== null) el.textContent = payload.message
      return
    }
    void renderIm()
  })

  const observer = new MutationObserver(() => {
    mount()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  mount()
  window.addEventListener('resize', () => {
    const view = document.getElementById(VIEW_ID)
    if (view === null) return
    const box = layoutView()
    view.style.left = `${String(box.left)}px`
    view.style.width = `${String(box.width)}px`
    view.style.height = `${String(box.height)}px`
  })
}
