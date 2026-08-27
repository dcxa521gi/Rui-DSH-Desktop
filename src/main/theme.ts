import { BrowserWindow, nativeTheme } from 'electron'
import type { ThemePreference } from './desktop-settings.js'
import { getDesktopSettings, updateDesktopSettings } from './desktop-settings.js'

const CHROME_DARK = '#10141c'
const CHROME_LIGHT = '#f4f6f8'
const SYMBOL_DARK = '#e8ecf1'
const SYMBOL_LIGHT = '#1a212c'
const OVERLAY_HEIGHT = 36

export function applyTheme(preference: ThemePreference): ThemePreference {
  nativeTheme.themeSource = preference
  updateDesktopSettings({ theme: preference })
  return preference
}

export function restoreTheme(): ThemePreference {
  const theme = getDesktopSettings().theme
  nativeTheme.themeSource = theme
  return theme
}

export function resolvedDark(): boolean {
  return nativeTheme.shouldUseDarkColors
}

export function chromeBackground(): string {
  return resolvedDark() ? CHROME_DARK : CHROME_LIGHT
}

export function overlayOptions(): Electron.TitleBarOverlay {
  const dark = resolvedDark()
  return {
    color: dark ? CHROME_DARK : CHROME_LIGHT,
    symbolColor: dark ? SYMBOL_DARK : SYMBOL_LIGHT,
    height: OVERLAY_HEIGHT,
  }
}

export function syncTitleBarOverlay(win: BrowserWindow): void {
  const overlay = overlayOptions()
  const color = overlay.color ?? chromeBackground()
  win.setBackgroundColor(color)
  if (process.platform !== 'win32') return
  if (typeof win.setTitleBarOverlay !== 'function') return
  const payload = {
    color,
    symbolColor: overlay.symbolColor ?? (resolvedDark() ? SYMBOL_DARK : SYMBOL_LIGHT),
    height: OVERLAY_HEIGHT,
  }
  const paint = (height: number) => {
    try {
      win.setTitleBarOverlay({ ...payload, height })
    } catch {
      // Older Windows builds may lack overlay support.
    }
  }
  // Windows 11 often ignores a color-only overlay update; bump height then restore.
  paint(OVERLAY_HEIGHT + 1)
  paint(OVERLAY_HEIGHT)
  setTimeout(() => {
    paint(OVERLAY_HEIGHT)
  }, 40)
}

export function injectThemeControl(win: BrowserWindow): void {
  const preference = getDesktopSettings().theme
  const dark = resolvedDark()
  const script = `(${clientInject.toString()})(${JSON.stringify(preference)}, ${dark ? 'true' : 'false'})`
  void win.webContents.executeJavaScript(script).catch(() => {
    // Page may not be ready (error/loading file or CSP).
  })
}

function clientInject(preference: 'system' | 'light' | 'dark', dark: boolean): void {
  const id = 'rui-dsh-theme-toggle'
  const dragId = 'rui-dsh-drag'
  const existing = document.getElementById(id)
  if (existing !== null) existing.remove()
  const dragCss = (left: number) =>
    [
      'position:fixed',
      'top:0',
      `left:${String(left)}px`,
      'right:176px',
      'height:36px',
      'z-index:2147483645',
      '-webkit-app-region:drag',
      'app-region:drag',
      'pointer-events:auto',
      'background:rgba(0,0,0,0.001)',
    ].join(';')
  const sidebarLeft = (): number => {
    const session = document.querySelector('button[class*="_newSession"]')
    const sidebar = session instanceof HTMLElement ? session.closest('[class*="_root"]') : null
    if (!(sidebar instanceof HTMLElement)) return 0
    return Math.max(0, Math.round(sidebar.getBoundingClientRect().width))
  }
  const placeDrag = (): void => {
    let drag = document.getElementById(dragId)
    if (drag === null) {
      drag = document.createElement('div')
      drag.id = dragId
      document.documentElement.appendChild(drag)
    }
    drag.style.cssText = dragCss(sidebarLeft())
  }
  placeDrag()
  const w = window as unknown as { __ruiDragWatch?: boolean }
  if (w.__ruiDragWatch !== true) {
    w.__ruiDragWatch = true
    window.addEventListener('resize', placeDrag)
    new MutationObserver(() => {
      placeDrag()
    }).observe(document.documentElement, { childList: true, subtree: true })
  }
  const next =
    preference === 'system' ? 'light' : preference === 'light' ? 'dark' : 'system'
  const labels: Record<'system' | 'light' | 'dark', string> = {
    system: '系统',
    light: '浅色',
    dark: '深色',
  }
  const icons: Record<'system' | 'light' | 'dark', string> = {
    system:
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="3" width="12" height="8" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 13h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    light:
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="2.4" fill="currentColor"/><g stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M8 2.2v1.5M8 12.3v1.5M2.2 8h1.5M12.3 8h1.5M4 4l1.1 1.1M10.9 10.9L12 12M12 4l-1.1 1.1M5.1 10.9L4 12"/></g></svg>',
    dark:
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10.2 2.6A5.4 5.4 0 1 0 13.4 11 4.4 4.4 0 0 1 10.2 2.6z" fill="currentColor"/></svg>',
  }
  const root = document.createElement('div')
  root.id = id
  root.style.cssText = [
    'position:fixed',
    'top:0',
    'right:138px',
    'z-index:2147483646',
    'height:36px',
    'display:flex',
    'align-items:center',
    'padding:0 4px',
    '-webkit-app-region:no-drag',
    'app-region:no-drag',
    'pointer-events:auto',
  ].join(';')
  const button = document.createElement('button')
  button.type = 'button'
  button.innerHTML = icons[preference]
  button.title = `外观：${labels[preference]}（点击切换到${labels[next]}）`
  button.setAttribute('aria-label', button.title)
  const ink = dark ? '#e8ecf1' : '#1a212c'
  const bg = dark ? '#171d27' : '#ffffff'
  const line = dark ? '#2a3340' : '#d5dbe3'
  button.style.cssText = [
    'appearance:none',
    `border:1px solid ${line}`,
    `background:${bg}`,
    `color:${ink}`,
    'width:28px',
    'height:28px',
    'border-radius:8px',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:0',
    'cursor:pointer',
  ].join(';')
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const api = (window as unknown as { desktop?: { setTheme?: (value: string) => Promise<string> } })
      .desktop
    void api?.setTheme?.(next)
  })
  root.appendChild(button)
  document.documentElement.appendChild(root)
}
