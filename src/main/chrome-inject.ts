import { app, BrowserWindow } from 'electron'
import { lastAppCheck } from './updater.js'

export function injectChrome(win: BrowserWindow): void {
  const version = app.getVersion()
  const update = lastAppCheck()
  const script = `(${clientInject.toString()})(${JSON.stringify(version)}, ${JSON.stringify(update ?? null)})`
  void win.webContents.executeJavaScript(script).catch(() => {
    // Page may not be ready (error/loading file or CSP).
  })
}

function clientInject(
  version: string,
  initial: { updateAvailable: boolean; latest?: string; url?: string } | null,
): void {
  if (location.protocol === 'file:') return
  const w = window as unknown as {
    desktop?: {
      getDesktopState: () => Promise<{
        appVersion: string
        appUpdate?: { updateAvailable: boolean; latest?: string; url?: string } | null
      }>
      openAppRelease: (url?: string) => Promise<void>
      onAppUpdate: (
        handler: (payload: { updateAvailable: boolean; latest?: string; url?: string }) => void,
      ) => () => void
    }
    __ruiVersionHook?: boolean
  }

  const CHIP_ID = 'rui-dsh-ver'
  const STYLE_ID = 'rui-dsh-ver-style'
  let releaseUrl: string | undefined = initial?.url

  function ensureStyle(): void {
    if (document.getElementById(STYLE_ID) !== null) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
#${CHIP_ID}{display:flex;align-items:center;gap:6px;margin-left:8px;flex:none;-webkit-app-region:no-drag;app-region:no-drag;pointer-events:auto}
#${CHIP_ID} .rui-ver-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
#${CHIP_ID} .rui-ver-update{appearance:none;border:1px solid #5ee0b5;background:#5ee0b5;color:#102018;border-radius:8px;padding:2px 8px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;display:none}
#${CHIP_ID} .rui-ver-update.is-on{display:inline-flex}
[class*="_collapsed"] #${CHIP_ID} .rui-ver-update{display:none !important}
[class*="_collapsed"] #${CHIP_ID}{margin-left:0;margin-top:4px}
`
    document.head.appendChild(style)
  }

  function settingsButton(): HTMLElement | null {
    const session = document.querySelector('button[class*="_newSession"]')
    const sidebar = session instanceof HTMLElement ? session.closest('[class*="_root"]') : null
    if (sidebar instanceof HTMLElement) {
      const local = sidebar.querySelector('button[aria-haspopup="dialog"]')
      if (local instanceof HTMLElement) return local
    }
    const buttons = [...document.querySelectorAll('button[aria-haspopup="dialog"]')]
    const last = buttons[buttons.length - 1]
    return last instanceof HTMLElement ? last : null
  }

  function applyUpdate(payload: { updateAvailable: boolean; latest?: string; url?: string } | null): void {
    const chip = document.getElementById(CHIP_ID)
    if (chip === null) return
    const label = chip.querySelector('.rui-ver-label')
    const button = chip.querySelector('.rui-ver-update')
    if (payload?.updateAvailable === true) {
      releaseUrl = payload.url
      if (label !== null) {
        label.textContent = payload.latest !== undefined ? `v${version} → ${payload.latest}` : `v${version}`
      }
      button?.classList.add('is-on')
    } else {
      if (label !== null) label.textContent = `v${version}`
      button?.classList.remove('is-on')
    }
  }

  function ensureChip(): void {
    const gear = settingsButton()
    if (gear === null) return
    ensureStyle()
    let chip = document.getElementById(CHIP_ID)
    if (chip === null) {
      chip = document.createElement('div')
      chip.id = CHIP_ID
      chip.innerHTML = `<span class="rui-ver-label">v${version}</span><button type="button" class="rui-ver-update">更新</button>`
      const button = chip.querySelector('.rui-ver-update')
      button?.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        void w.desktop?.openAppRelease(releaseUrl)
      })
    }
    if (chip.previousElementSibling !== gear) {
      gear.insertAdjacentElement('afterend', chip)
    }
    applyUpdate(initial)
  }

  ensureChip()
  if (w.__ruiVersionHook === true) return
  w.__ruiVersionHook = true
  let scheduled = false
  new MutationObserver(() => {
    if (scheduled) return
    scheduled = true
    window.setTimeout(() => {
      scheduled = false
      ensureChip()
    }, 300)
  }).observe(document.body ?? document.documentElement, { childList: true, subtree: true })
  w.desktop?.onAppUpdate((payload) => {
    applyUpdate(payload)
  })
  void w.desktop?.getDesktopState().then((state) => {
    applyUpdate(state.appUpdate ?? null)
  })
}
