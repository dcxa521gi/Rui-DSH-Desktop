import { BrowserWindow, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromeBackground, overlayOptions } from './theme.js'

const here = dirname(fileURLToPath(import.meta.url))

export const PRELOAD_PATH = join(here, '../preload/preload.cjs')
export const LOADING_PAGE = join(here, '../renderer/loading.html')
export const ERROR_PAGE = join(here, '../renderer/error.html')
export const SETTINGS_PAGE = join(here, '../renderer/settings.html')

const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:\d+/

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    backgroundColor: chromeBackground(),
    title: 'Rui DSH Desktop',
    titleBarStyle: 'hidden',
    movable: true,
    ...(process.platform === 'win32' ? { titleBarOverlay: overlayOptions() } : {}),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:') || LOOPBACK_ORIGIN.test(url)) return
    event.preventDefault()
    if (/^https?:/.test(url)) void shell.openExternal(url)
  })

  win.once('ready-to-show', () => {
    win.show()
  })
  void win.loadFile(LOADING_PAGE)
  return win
}

export function createSettingsWindow(parent?: BrowserWindow): BrowserWindow {
  const win = new BrowserWindow({
    width: 680,
    height: 760,
    minWidth: 520,
    minHeight: 560,
    parent,
    autoHideMenuBar: true,
    backgroundColor: '#10141c',
    title: '设置 · Rui DSH Desktop',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  void win.loadFile(SETTINGS_PAGE)
  return win
}
