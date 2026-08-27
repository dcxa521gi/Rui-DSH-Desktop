import { Menu, Tray, nativeImage, app } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './log.js'

export type TrayActions = {
  onShow: () => void
  onOpenSettings: () => void
  onRestartEngine: () => void
  onOpenLogs: () => void
  onQuit: () => void
}

let tray: Tray | undefined

function iconPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const packaged = join(process.resourcesPath, 'icon.png')
  const unpacked = join(here, '../../resources/icon.png')
  if (app.isPackaged && existsSync(packaged)) return packaged
  return unpacked
}

export function createTray(actions: TrayActions): void {
  if (tray !== undefined) return
  const file = iconPath()
  const image = existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty()
  tray = new Tray(image.isEmpty() ? nativeImage.createFromDataURL(fallbackIcon()) : image)
  tray.setToolTip('Rui DSH Desktop')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示窗口', click: actions.onShow },
      { label: '设置', click: actions.onOpenSettings },
      { label: '重启引擎', click: actions.onRestartEngine },
      { label: '打开日志', click: actions.onOpenLogs },
      { type: 'separator' },
      { label: '退出', click: actions.onQuit },
    ]),
  )
  tray.on('click', () => {
    actions.onShow()
  })
  log('info', 'tray ready')
}

export function destroyTray(): void {
  tray?.destroy()
  tray = undefined
}

function fallbackIcon(): string {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAGElEQVRYR+3BAQ0AAADCoPdPbQ43oAAAAAAAAOAXqgAAAcH1C2EAAAAASUVORK5CYII='
}
