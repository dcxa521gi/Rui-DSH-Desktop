import { BrowserWindow } from 'electron'

export function injectSettingsSection(win: BrowserWindow): void {
  const script = `(${clientInject.toString()})()`
  void win.webContents.executeJavaScript(script).catch(() => {
    // Page may not be ready (error/loading file or CSP).
  })
}

function clientInject(): void {
  if (location.protocol === 'file:') return
  const w = window as unknown as {
    desktop?: {
      getDesktopState: () => Promise<{
        appVersion: string
        dshVersion: string
        autoCheckApp: boolean
        githubOwner: string
        githubRepo: string
        imWorkspaceId: string
        imWorkspaceTitle: string
        appUpdate?: { updateAvailable: boolean; latest?: string; url?: string } | null
        engine: {
          source: 'bundled' | 'installed'
          pending?: { version: string }
        }
      }>
      setAutoCheckApp: (enabled: boolean) => Promise<boolean>
      checkAppUpdate: () => Promise<{ updateAvailable: boolean; message: string; url?: string }>
      openAppRelease: (url?: string) => Promise<void>
      checkKernelUpdate: () => Promise<{
        current: string
        latest: string
        source: 'bundled' | 'installed'
        updateAvailable: boolean
        pending?: { version: string }
      }>
      downloadKernel: () => Promise<{
        updateAvailable: boolean
        pending?: { version: string }
        current: string
        latest: string
        source: 'bundled' | 'installed'
      }>
      applyKernel: () => Promise<unknown>
      revertKernel: () => Promise<unknown>
      onKernelProgress: (handler: (payload: { phase: string; message: string }) => void) => void
      listWorkspaces: () => Promise<Array<{ workspaceId: string; title: string; path: string }>>
      setImWorkspace: (
        workspaceId: string,
        title?: string,
      ) => Promise<{ imWorkspaceId: string; imWorkspaceTitle: string }>
      ensureImWorkspace: (title?: string) => Promise<{ workspaceId: string; title: string; path: string }>
      listImports: () => Promise<
        Array<{
          id: string
          source: 'claude' | 'codex'
          title: string
          preview: string
          messageCount: number
        }>
      >
      runImport: (ids: string[]) => Promise<{ imported: number; failed: number; message: string }>
    }
    __ruiSettingsHook?: boolean
  }
  if (w.__ruiSettingsHook === true) return
  w.__ruiSettingsHook = true

  const NAV_ID = 'rui-dsh-settings-nav'
  const PANEL_ID = 'rui-dsh-settings-panel'
  const STYLE_ID = 'rui-dsh-settings-style'
  let appReleaseUrl: string | undefined
  let kernelBound = false

  function desktop() {
    return w.desktop
  }

  function ensureStyle(): void {
    if (document.getElementById(STYLE_ID) !== null) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
#${PANEL_ID},#rui-general-update{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
#${PANEL_ID}{flex:1;min-height:0;padding:0 24px 24px;overflow-y:auto}
#${PANEL_ID} h3{margin:0 0 6px;font-size:14px;font-weight:600}
#${PANEL_ID} .rui-hint,#rui-general-update .rui-hint{margin:0 0 12px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
#${PANEL_ID} .rui-block{margin:0 0 22px}
#${PANEL_ID} .rui-row,#rui-general-update .rui-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
#${PANEL_ID} label.rui-inline{display:flex;align-items:center;gap:8px;font-size:13px}
#${PANEL_ID} button.rui-btn,#rui-general-update button.rui-btn{appearance:none;border:1px solid #4a5568;background:#1a2433;color:#e8ecf1;border-radius:10px;padding:6px 12px;cursor:pointer;font:inherit;font-size:13px;opacity:1;filter:none}
#${PANEL_ID} button.rui-btn.primary,#rui-general-update button.rui-btn.primary{background:#5ee0b5;color:#102018;border-color:#5ee0b5;font-weight:600}
#${PANEL_ID} button.rui-btn:disabled,#rui-general-update button.rui-btn:disabled{opacity:1 !important;filter:none !important;cursor:default;background:#243044 !important;color:#d5dbe3 !important;border-color:#4a5568 !important}
#${PANEL_ID} button.rui-btn.primary:disabled,#rui-general-update button.rui-btn.primary:disabled{background:#1f4a3c !important;color:#e3f8ee !important;border-color:#3d7a62 !important}
#${PANEL_ID} .rui-status,#rui-general-update .rui-status{white-space:pre-wrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin-top:8px}
#${PANEL_ID} .rui-status.ok,#rui-general-update .rui-status.ok{color:var(--dsw-alias-state-success-primary, #3dcc8a)}
#${PANEL_ID} .rui-status.err,#rui-general-update .rui-status.err{color:var(--dsw-alias-state-error-primary)}
#${PANEL_ID} select,#${PANEL_ID} input[type="text"]{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1, transparent);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:6px 10px;min-width:12rem}
#${PANEL_ID} .rui-import-list{display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto;margin-top:8px}
#${PANEL_ID} .rui-import-item{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:18px}
#${PANEL_ID} .rui-import-item input{margin-top:3px}
`
    document.head.appendChild(style)
  }

  function dialogRoot(): HTMLElement | null {
    return document.querySelector('[role="dialog"][aria-modal="true"]')
  }

  function navList(dialog: HTMLElement): HTMLElement | null {
    return dialog.querySelector('[class*="_navList"]')
  }

  function optionsPane(dialog: HTMLElement): HTMLElement | null {
    return dialog.querySelector('[class*="_options"]')
  }

  function contentPane(dialog: HTMLElement): HTMLElement | null {
    return dialog.querySelector('[class*="_content"]')
  }

  function activeClass(list: HTMLElement): string | undefined {
    const current = list.querySelector('[aria-current="true"]')
    if (!(current instanceof HTMLElement)) return undefined
    return [...current.classList].find((name) => name.includes('active'))
  }

  function setOfficialActive(list: HTMLElement, button: HTMLElement, on: boolean): void {
    const klass = activeClass(list)
    button.setAttribute('aria-current', on ? 'true' : 'false')
    if (klass !== undefined) button.classList.toggle(klass, on)
  }

  function showPanel(dialog: HTMLElement, on: boolean): void {
    const options = optionsPane(dialog)
    const panel = document.getElementById(PANEL_ID)
    if (options !== null) options.style.display = on ? 'none' : ''
    if (panel !== null) panel.style.display = on ? '' : 'none'
  }

  function panelHtml(): string {
    return `
      <div class="rui-block">
        <h3>检测客户端更新</h3>
        <p class="rui-hint">默认启动时自动检测 GitHub Release。发现新版本后「更新客户端」才会可点，打开下载页安装，不会静默覆盖。</p>
        <label class="rui-inline"><input type="checkbox" id="rui-auto-check" /> 启动时自动检测</label>
        <div class="rui-row">
          <button type="button" class="rui-btn" id="rui-check-app">检测客户端</button>
          <button type="button" class="rui-btn primary" id="rui-update-app" disabled>更新客户端</button>
        </div>
        <div class="rui-status" id="rui-app-status"></div>
      </div>
      <div class="rui-block">
        <h3>检测内核更新</h3>
        <p class="rui-hint">仅手动检测。下载完整且校验通过后，「更新内核」才会可点。失败或不完整不会启用更新。</p>
        <div class="rui-row">
          <button type="button" class="rui-btn" id="rui-check-kernel">检测内核</button>
          <button type="button" class="rui-btn" id="rui-download-kernel" disabled>下载内核</button>
          <button type="button" class="rui-btn primary" id="rui-apply-kernel" disabled>更新内核</button>
          <button type="button" class="rui-btn" id="rui-revert-kernel">恢复内置内核</button>
        </div>
        <div class="rui-status" id="rui-kernel-status"></div>
      </div>
      <div class="rui-block">
        <h3>统一 IM 会话工作区</h3>
        <p class="rui-hint">绑定微信 / Telegram 等渠道后，收到的消息会自动在该工作区创建会话，并出现在侧边栏。可选用已有工作区，或新建一个专门给 IM 用。</p>
        <div class="rui-row">
          <select id="rui-im-ws"></select>
          <input id="rui-im-ws-title" type="text" placeholder="新工作区名称，默认 IM" />
          <button type="button" class="rui-btn" id="rui-im-ws-create">创建并使用</button>
        </div>
        <div class="rui-status" id="rui-im-ws-status"></div>
      </div>
      <div class="rui-block">
        <h3>会话导入</h3>
        <p class="rui-hint">扫描本机 Claude Code（~/.claude）和 Codex（~/.codex）会话。导入后出现在侧边栏「导入」工作区；完整记录写入 Markdown，对话区带入摘要。pi / Cursor / Hermes 下一期再接。</p>
        <div class="rui-row">
          <button type="button" class="rui-btn" id="rui-import-scan">扫描本机会话</button>
          <button type="button" class="rui-btn primary" id="rui-import-run" disabled>导入选中</button>
        </div>
        <div id="rui-import-list" class="rui-import-list"></div>
        <div class="rui-status" id="rui-import-status"></div>
      </div>
    `
  }

  async function fillState(): Promise<void> {
    const api = desktop()
    const appStatus = document.getElementById('rui-app-status')
    const kernelStatus = document.getElementById('rui-kernel-status')
    const auto = document.getElementById('rui-auto-check')
    const updateApp = document.getElementById('rui-update-app')
    const apply = document.getElementById('rui-apply-kernel')
    const titleInput = document.getElementById('rui-im-ws-title')
    if (api === undefined || appStatus === null || kernelStatus === null) return
    const state = await api.getDesktopState()
    if (auto instanceof HTMLInputElement) auto.checked = state.autoCheckApp
    appStatus.textContent = `客户端 ${state.appVersion}`
    kernelStatus.textContent = `当前内核 ${state.dshVersion}（${state.engine.source === 'installed' ? '已切换' : '内置'}）`
    if (state.engine.pending !== undefined) {
      if (apply instanceof HTMLButtonElement) apply.disabled = false
      kernelStatus.textContent += `\n已验证待更新：${state.engine.pending.version}`
    }
    if (state.appUpdate?.updateAvailable === true) {
      appReleaseUrl = state.appUpdate.url
      appStatus.textContent =
        state.appUpdate.latest !== undefined
          ? `客户端 ${state.appVersion}，可更新到 ${state.appUpdate.latest}`
          : appStatus.textContent
      if (updateApp instanceof HTMLButtonElement) updateApp.disabled = false
    } else if (updateApp instanceof HTMLButtonElement && appReleaseUrl === undefined) {
      updateApp.disabled = true
    }
    if (titleInput instanceof HTMLInputElement && titleInput.value === '') {
      titleInput.value = state.imWorkspaceTitle
    }
    await fillWorkspaces(state.imWorkspaceId)
  }

  async function fillWorkspaces(selectedId?: string): Promise<void> {
    const api = desktop()
    const select = document.getElementById('rui-im-ws')
    const status = document.getElementById('rui-im-ws-status')
    if (api === undefined || !(select instanceof HTMLSelectElement)) return
    try {
      const items = await api.listWorkspaces()
      const current = selectedId ?? getDesktopSettingsId(select)
      select.innerHTML =
        `<option value="">（收到消息时自动创建「IM」工作区）</option>` +
        items
          .map(
            (item) =>
              `<option value="${escapeHtml(item.workspaceId)}"${item.workspaceId === current ? ' selected' : ''}>${escapeHtml(item.title)}</option>`,
          )
          .join('')
      if (status !== null && items.length === 0) {
        status.textContent = '还没有工作区。可点「创建并使用」，或等收到第一条 IM 时自动创建。'
      } else if (status !== null && status.textContent === '') {
        const picked = items.find((item) => item.workspaceId === select.value)
        status.textContent = picked !== undefined ? `当前：${picked.title}` : '将在收到 IM 消息时自动创建默认工作区。'
      }
    } catch (error) {
      if (status !== null) status.textContent = String(error)
    }
  }

  function getDesktopSettingsId(select: HTMLSelectElement): string {
    return select.value
  }

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function bindPanel(): void {
    const api = desktop()
    if (api === undefined) return
    const appStatus = document.getElementById('rui-app-status')
    const kernelStatus = document.getElementById('rui-kernel-status')
    const auto = document.getElementById('rui-auto-check')
    const checkApp = document.getElementById('rui-check-app')
    const updateApp = document.getElementById('rui-update-app')
    const checkKernel = document.getElementById('rui-check-kernel')
    const download = document.getElementById('rui-download-kernel')
    const apply = document.getElementById('rui-apply-kernel')
    const revert = document.getElementById('rui-revert-kernel')
    if (appStatus === null || kernelStatus === null) return

    const setApp = (text: string, kind = '') => {
      appStatus.className = `rui-status${kind !== '' ? ` ${kind}` : ''}`
      appStatus.textContent = text
    }
    const setKernel = (text: string, kind = '') => {
      kernelStatus.className = `rui-status${kind !== '' ? ` ${kind}` : ''}`
      kernelStatus.textContent = text
    }

    auto?.addEventListener('change', () => {
      if (auto instanceof HTMLInputElement) void api.setAutoCheckApp(auto.checked)
    })
    checkApp?.addEventListener('click', async () => {
      setApp('正在检测…')
      try {
        const result = await api.checkAppUpdate()
        appReleaseUrl = result.url
        if (updateApp instanceof HTMLButtonElement) updateApp.disabled = !result.updateAvailable
        setApp(result.message, result.updateAvailable ? 'ok' : '')
      } catch (error) {
        setApp(String(error), 'err')
      }
    })
    updateApp?.addEventListener('click', () => {
      void api.openAppRelease(appReleaseUrl)
    })
    checkKernel?.addEventListener('click', async () => {
      setKernel('正在检测…')
      try {
        const check = await api.checkKernelUpdate()
        const pending = check.pending ? `已验证待更新：${check.pending.version}` : '没有已验证的待更新内核'
        setKernel(
          `当前 ${check.current}（${check.source === 'installed' ? '已切换' : '内置'}）\nnpm latest ${check.latest}\n${pending}`,
        )
        if (download instanceof HTMLButtonElement) download.disabled = !check.updateAvailable
        if (apply instanceof HTMLButtonElement) apply.disabled = check.pending === undefined
      } catch (error) {
        setKernel(String(error), 'err')
      }
    })
    download?.addEventListener('click', async () => {
      if (download instanceof HTMLButtonElement) download.disabled = true
      try {
        const check = await api.downloadKernel()
        const pending = check.pending ? `已验证待更新：${check.pending.version}` : '没有已验证的待更新内核'
        setKernel(
          `当前 ${check.current}（${check.source === 'installed' ? '已切换' : '内置'}）\nnpm latest ${check.latest}\n${pending}`,
          'ok',
        )
        if (apply instanceof HTMLButtonElement) apply.disabled = check.pending === undefined
      } catch (error) {
        setKernel(String(error), 'err')
        if (apply instanceof HTMLButtonElement) apply.disabled = true
      } finally {
        if (download instanceof HTMLButtonElement) download.disabled = false
      }
    })
    apply?.addEventListener('click', async () => {
      setKernel('正在切换内核并重启引擎…')
      await api.applyKernel()
    })
    revert?.addEventListener('click', async () => {
      await api.revertKernel()
      await fillState()
    })
    if (!kernelBound) {
      kernelBound = true
      api.onKernelProgress((payload) => {
        setKernel(payload.message, payload.phase === 'error' ? 'err' : '')
      })
    }

    const imSelect = document.getElementById('rui-im-ws')
    const imTitle = document.getElementById('rui-im-ws-title')
    const imCreate = document.getElementById('rui-im-ws-create')
    const imStatus = document.getElementById('rui-im-ws-status')
    const setImStatus = (text: string, kind = '') => {
      if (imStatus === null) return
      imStatus.className = `rui-status${kind !== '' ? ` ${kind}` : ''}`
      imStatus.textContent = text
    }
    imSelect?.addEventListener('change', () => {
      if (!(imSelect instanceof HTMLSelectElement)) return
      const picked = imSelect.options[imSelect.selectedIndex]
      void api.setImWorkspace(imSelect.value, picked?.textContent ?? undefined).then(() => {
        setImStatus(imSelect.value === '' ? '将在收到 IM 消息时自动创建默认工作区。' : `已使用：${picked?.textContent ?? ''}`, 'ok')
      })
    })
    imCreate?.addEventListener('click', async () => {
      const title = imTitle instanceof HTMLInputElement ? imTitle.value.trim() : ''
      setImStatus('正在创建工作区…')
      try {
        const created = await api.ensureImWorkspace(title === '' ? undefined : title)
        await api.setImWorkspace(created.workspaceId, created.title)
        await fillWorkspaces(created.workspaceId)
        setImStatus(`已使用：${created.title}`, 'ok')
      } catch (error) {
        setImStatus(String(error), 'err')
      }
    })

    const importScan = document.getElementById('rui-import-scan')
    const importRun = document.getElementById('rui-import-run')
    const importList = document.getElementById('rui-import-list')
    const importStatus = document.getElementById('rui-import-status')
    const setImport = (text: string, kind = '') => {
      if (importStatus === null) return
      importStatus.className = `rui-status${kind !== '' ? ` ${kind}` : ''}`
      importStatus.textContent = text
    }
    const selectedIds = (): string[] => {
      if (importList === null) return []
      return [...importList.querySelectorAll('input[type="checkbox"]:checked')]
        .map((node) => (node instanceof HTMLInputElement ? node.value : ''))
        .filter((id) => id !== '')
    }
    importScan?.addEventListener('click', async () => {
      setImport('正在扫描 ~/.claude 和 ~/.codex…')
      if (importRun instanceof HTMLButtonElement) importRun.disabled = true
      try {
        const items = await api.listImports()
        if (importList !== null) {
          importList.innerHTML =
            items.length === 0
              ? '<div class="rui-hint">没有找到可导入的 jsonl 会话。</div>'
              : items
                  .map(
                    (item) =>
                      `<label class="rui-import-item"><input type="checkbox" value="${escapeHtml(item.id)}" />
                        <span><strong>${escapeHtml(item.source === 'claude' ? 'Claude' : 'Codex')}</strong> · ${escapeHtml(item.title)}
                        <div class="rui-hint">${escapeHtml(item.preview)} · ${String(item.messageCount)} 条</div></span></label>`,
                  )
                  .join('')
        }
        if (importRun instanceof HTMLButtonElement) importRun.disabled = items.length === 0
        setImport(items.length === 0 ? '没有找到会话。' : `找到 ${String(items.length)} 个会话，勾选后导入。`)
      } catch (error) {
        setImport(String(error), 'err')
      }
    })
    importRun?.addEventListener('click', async () => {
      const ids = selectedIds()
      if (ids.length === 0) {
        setImport('请先勾选要导入的会话。')
        return
      }
      setImport(`正在导入 ${String(ids.length)} 个会话…`)
      if (importRun instanceof HTMLButtonElement) importRun.disabled = true
      try {
        const result = await api.runImport(ids)
        setImport(result.message, result.failed > 0 ? 'err' : 'ok')
      } catch (error) {
        setImport(String(error), 'err')
      } finally {
        if (importRun instanceof HTMLButtonElement) importRun.disabled = false
      }
    })

    void fillState()
  }

  function activateOurs(dialog: HTMLElement, list: HTMLElement, ours: HTMLElement): void {
    for (const button of list.querySelectorAll('button')) {
      if (button instanceof HTMLElement) setOfficialActive(list, button, button === ours)
    }
    showPanel(dialog, true)
  }

  function mount(dialog: HTMLElement): void {
    ensureStyle()
    const list = navList(dialog)
    const content = contentPane(dialog)
    if (list === null || content === null) return
    const sample = [...list.querySelectorAll('button')].find((button) => button.id !== NAV_ID)
    if (!(sample instanceof HTMLElement)) return

    let ours = document.getElementById(NAV_ID)
    if (ours === null) {
      ours = sample.cloneNode(true) as HTMLElement
      ours.id = NAV_ID
      ours.removeAttribute('aria-current')
      const klass = activeClass(list)
      if (klass !== undefined) ours.classList.remove(klass)
      const label = ours.querySelector('[class*="_navLabel"]')
      if (label !== null) label.textContent = 'Rui Desktop'
      ours.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        activateOurs(dialog, list, ours as HTMLElement)
      })
      list.appendChild(ours)
    }

    let panel = document.getElementById(PANEL_ID)
    if (panel === null) {
      panel = document.createElement('div')
      panel.id = PANEL_ID
      panel.style.display = 'none'
      panel.innerHTML = panelHtml()
      content.appendChild(panel)
      bindPanel()
    }

    if (!list.dataset.ruiBound) {
      list.dataset.ruiBound = '1'
      list.addEventListener(
        'click',
        (event) => {
          const target = event.target
          if (!(target instanceof Element)) return
          const button = target.closest('button')
          if (button === null || button.id === NAV_ID) return
          showPanel(dialog, false)
          setOfficialActive(list, ours as HTMLElement, false)
        },
        true,
      )
    }

    mountGeneral(dialog)
    if (dialog.dataset.ruiAutoOpened !== '1') {
      dialog.dataset.ruiAutoOpened = '1'
      activateOurs(dialog, list, ours)
    }
  }

  function mountGeneral(dialog: HTMLElement): void {
    const general = dialog.querySelector('[data-slot="settings.general.item"]')
    if (!(general instanceof HTMLElement)) return
    if (document.getElementById('rui-general-update') !== null) return
    const card = document.createElement('div')
    card.id = 'rui-general-update'
    card.style.cssText =
      'border-bottom:1px solid var(--dsw-alias-border-l2);padding:16px 0;display:flex;flex-direction:column;gap:8px'
    card.innerHTML = `
      <div style="font-size:14px;line-height:22px">版本检测</div>
      <div class="rui-hint">客户端默认自动检测；内核需手动检测，下载完整并通过校验后「更新内核」才可点。</div>
      <div class="rui-row">
        <button type="button" class="rui-btn" id="rui-g-check-app">检测客户端</button>
        <button type="button" class="rui-btn primary" id="rui-g-update-app">更新客户端</button>
        <button type="button" class="rui-btn" id="rui-g-check-kernel">检测内核</button>
        <button type="button" class="rui-btn" id="rui-g-download-kernel">下载内核</button>
        <button type="button" class="rui-btn primary" id="rui-g-apply-kernel">更新内核</button>
      </div>
      <div class="rui-status" id="rui-g-status"></div>`
    general.prepend(card)
    const api = desktop()
    const status = document.getElementById('rui-g-status')
    const updateApp = document.getElementById('rui-g-update-app')
    const download = document.getElementById('rui-g-download-kernel')
    const apply = document.getElementById('rui-g-apply-kernel')
    if (updateApp instanceof HTMLButtonElement) updateApp.disabled = true
    if (download instanceof HTMLButtonElement) download.disabled = true
    if (apply instanceof HTMLButtonElement) apply.disabled = true
    const setStatus = (text: string, kind = '') => {
      if (status === null) return
      status.className = `rui-status${kind !== '' ? ` ${kind}` : ''}`
      status.textContent = text
    }
    document.getElementById('rui-g-check-app')?.addEventListener('click', async () => {
      setStatus('正在检测客户端…')
      try {
        const result = await api?.checkAppUpdate()
        appReleaseUrl = result?.url
        if (updateApp instanceof HTMLButtonElement) updateApp.disabled = !result?.updateAvailable
        setStatus(result?.message ?? '', result?.updateAvailable ? 'ok' : '')
      } catch (error) {
        setStatus(String(error), 'err')
      }
    })
    updateApp?.addEventListener('click', () => {
      void api?.openAppRelease(appReleaseUrl)
    })
    document.getElementById('rui-g-check-kernel')?.addEventListener('click', async () => {
      setStatus('正在检测内核…')
      try {
        const check = await api?.checkKernelUpdate()
        if (check === undefined) return
        if (download instanceof HTMLButtonElement) download.disabled = !check.updateAvailable
        if (apply instanceof HTMLButtonElement) apply.disabled = check.pending === undefined
        setStatus(
          `当前 ${check.current} · npm latest ${check.latest}${check.pending ? ` · 待更新 ${check.pending.version}` : ''}`,
        )
      } catch (error) {
        setStatus(String(error), 'err')
      }
    })
    download?.addEventListener('click', async () => {
      setStatus('正在下载内核…')
      try {
        const check = await api?.downloadKernel()
        if (apply instanceof HTMLButtonElement) apply.disabled = check?.pending === undefined
        setStatus(check?.pending ? `已验证待更新：${check.pending.version}` : '下载未完成', 'ok')
      } catch (error) {
        setStatus(String(error), 'err')
      }
    })
    apply?.addEventListener('click', async () => {
      setStatus('正在更新内核并重启引擎…')
      await api?.applyKernel()
    })
    void api?.getDesktopState().then((state) => {
      setStatus(`客户端 ${state.appVersion} · 内核 ${state.dshVersion}`)
      if (state.engine.pending !== undefined && apply instanceof HTMLButtonElement) apply.disabled = false
    })
  }

  let mountScheduled = false
  const observer = new MutationObserver(() => {
    if (mountScheduled) return
    mountScheduled = true
    window.setTimeout(() => {
      mountScheduled = false
      const dialog = dialogRoot()
      if (dialog !== null) mount(dialog)
    }, 200)
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  const existing = dialogRoot()
  if (existing !== null) mount(existing)
}
