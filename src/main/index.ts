import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
} from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { deleteJob, initAutomation, listJobs, saveJob, toggleJob } from './automation.js'
import { getDesktopSettings, initDesktopSettings, updateDesktopSettings } from './desktop-settings.js'
import {
  HARNESS_LOG_FILENAME,
  HarnessServer,
  pickEphemeralPort,
  resolveBundledDshVersion,
  resolveDshVersion,
  setEngineOverride,
} from './harness.js'
import {
  applyImPlugin,
  checkImPlugin,
  disconnectChannel,
  downloadImPlugin,
  ensureImWorkspace,
  initIm,
  listHarnessWorkspaces,
  listImChannels,
  replyIm,
  saveImCreds,
  setImWorkspacePref,
  startWeixinLogin,
  stopIm,
  submitWeixinVerify,
  testImSend,
} from './im.js'
import {
  activeEngineEntry,
  applyPendingKernel,
  bundledDshVersion,
  checkKernelUpdate,
  downloadKernelUpdate,
  revertToBundledKernel,
} from './kernel-updater.js'
import { MAIN_LOG_FILENAME, initLogs, log, readTail } from './log.js'
import { installAppMenu } from './menu.js'
import { injectSettingsSection } from './settings-inject.js'
import { injectSidebarTools } from './sidebar-inject.js'
import { injectChrome } from './chrome-inject.js'
import { applyTheme, injectThemeControl, restoreTheme, syncTitleBarOverlay } from './theme.js'
import { createTray, destroyTray } from './tray.js'
import { checkAppUpdate, initUpdater, lastAppCheck, openAppRelease } from './updater.js'
import { importSessions, initSessionImport, listImportableSessions } from './session-import.js'
import { ERROR_PAGE, LOADING_PAGE, createMainWindow, createSettingsWindow } from './window.js'

const APP_NAME = 'Rui DSH Desktop'

let mainWindow: BrowserWindow | undefined
let settingsWindow: BrowserWindow | undefined
let harness: HarnessServer | undefined
let quitting = false
let hideToTray = true

const state = {
  error: '',
  port: undefined as number | undefined,
}

function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function logsDir(): string {
  return join(app.getPath('userData'), 'logs')
}

function applyEngineOverride(): void {
  setEngineOverride(activeEngineEntry(app.getPath('userData')))
}

function showMainWindow(): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) {
    openWindow()
    if (harness?.url !== undefined) {
      void mainWindow?.loadURL(harness.url)
    }
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function openOfficialSettings(): void {
  showMainWindow()
  const win = mainWindow
  if (win === undefined || win.isDestroyed()) return
  void win.webContents.executeJavaScript(
    `document.querySelector('[aria-haspopup="dialog"]')?.click()`,
  )
}

function openSettings(): void {
  if (settingsWindow !== undefined && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }
  const parent =
    mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined
  settingsWindow = createSettingsWindow(parent)
  settingsWindow.on('closed', () => {
    settingsWindow = undefined
  })
}

function attachThemeHooks(win: BrowserWindow): void {
  const inject = () => {
    syncTitleBarOverlay(win)
    injectThemeControl(win)
    injectChrome(win)
    injectSettingsSection(win)
    injectSidebarTools(win)
  }
  win.webContents.on('dom-ready', inject)
  win.webContents.on('did-finish-load', inject)
  win.webContents.on('did-navigate', inject)
}

function openWindow(): BrowserWindow {
  const win = createMainWindow()
  attachThemeHooks(win)
  win.on('close', (event) => {
    if (quitting || !hideToTray) return
    event.preventDefault()
    win.hide()
    log('info', 'window hidden to tray; engine still running')
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined
  })
  mainWindow = win
  return win
}

const ERROR_QUERY_MAX = 3500

function showError(error: unknown): void {
  state.error = String(error instanceof Error ? error.message : error)
  log('error', state.error.slice(0, 2000))
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  const message =
    state.error.length > ERROR_QUERY_MAX
      ? `${state.error.slice(0, ERROR_QUERY_MAX)}\n…(truncated, see logs)`
      : state.error
  const win = mainWindow
  win.webContents.stop()
  void win
    .loadFile(ERROR_PAGE, { query: { message } })
    .then(async () => {
      const assigned = JSON.stringify(message)
      await win.webContents.executeJavaScript(
        `var el = document.getElementById('error'); if (el) el.textContent = ${assigned};`,
      )
    })
    .catch((loadError: unknown) => {
      log('error', `failed to open error page: ${String(loadError)}`)
    })
  win.show()
}

let pickOpen = false

function handleChildMessage(
  message: unknown,
  send: (reply: { type: string; id?: number; path: string | null }) => void,
): void {
  if (message === null || typeof message !== 'object') return
  const payload = message as { type?: string; id?: number }
  if (payload.type !== 'dsh-desktop:pick-directory') return
  if (pickOpen) {
    send({ type: 'dsh-desktop:pick-result', id: payload.id, path: null })
    return
  }
  pickOpen = true
  const options: OpenDialogOptions = {
    title: '选择文件夹',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: homedir(),
  }
  const parent =
    mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined
  const picker =
    parent === undefined ? dialog.showOpenDialog(options) : dialog.showOpenDialog(parent, options)
  void picker
    .then(
      (result: OpenDialogReturnValue) => {
        const path =
          result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
        send({ type: 'dsh-desktop:pick-result', id: payload.id, path })
      },
      () => {
        send({ type: 'dsh-desktop:pick-result', id: payload.id, path: null })
      },
    )
    .finally(() => {
      pickOpen = false
    })
}

async function bootAndNavigate(): Promise<void> {
  applyEngineOverride()
  const port = await pickEphemeralPort()
  harness = new HarnessServer({
    port,
    logDir: logsDir(),
    userDataDir: app.getPath('userData'),
    onUnexpectedExit: (code, signal) => {
      if (quitting) return
      const tail = readTail(join(logsDir(), HARNESS_LOG_FILENAME), 40)
      showError(
        new Error(
          `harness engine exited unexpectedly (code ${String(code)}, signal ${String(signal)})\n${tail}`.trim(),
        ),
      )
    },
    onChildMessage: handleChildMessage,
  })
  state.port = port
  harness.start()
  await harness.waitReady()
  log('info', `harness ready at ${harness.url}`)
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(harness.url)
  }
}

async function restartHarness(): Promise<void> {
  try {
    state.error = ''
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      await mainWindow.loadFile(LOADING_PAGE)
      mainWindow.show()
    }
    await harness?.stop()
    await bootAndNavigate()
  } catch (error) {
    showError(error)
  }
}

function emitKernelProgress(payload: { phase: string; message: string }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('desktop:kernel-progress', payload)
  }
}

function registerIpc(): void {
  ipcMain.handle('desktop:get-info', () => ({
    appName: APP_NAME,
    appVersion: app.getVersion(),
    dshVersion: resolveDshVersion(),
    port: state.port,
    url: harness?.url ?? null,
    error: state.error,
    logPath: join(logsDir(), MAIN_LOG_FILENAME),
    harnessLogPath: join(logsDir(), HARNESS_LOG_FILENAME),
    harnessLogTail: readTail(join(logsDir(), HARNESS_LOG_FILENAME), 40),
    dshHome: dshHome(),
  }))
  ipcMain.handle('desktop:get-state', () => ({
    appVersion: app.getVersion(),
    dshVersion: resolveDshVersion(),
    bundledDshVersion: bundledDshVersion(),
    ...getDesktopSettings(),
    appUpdate: lastAppCheck() ?? null,
  }))
  ipcMain.handle('desktop:set-theme', (_event, theme: unknown) => {
    if (theme !== 'system' && theme !== 'light' && theme !== 'dark') {
      return getDesktopSettings().theme
    }
    const next = applyTheme(theme)
    for (const win of BrowserWindow.getAllWindows()) {
      syncTitleBarOverlay(win)
      injectThemeControl(win)
      injectChrome(win)
    }
    return next
  })
  ipcMain.handle('desktop:set-auto-check-app', (_event, enabled: unknown) => {
    return updateDesktopSettings({ autoCheckApp: enabled !== false }).autoCheckApp
  })
  ipcMain.handle('desktop:set-github-repo', (_event, owner: unknown, repo: unknown) => {
    return updateDesktopSettings({
      githubOwner: typeof owner === 'string' ? owner.trim() : '',
      githubRepo: typeof repo === 'string' ? repo.trim() : '',
    })
  })
  ipcMain.handle('desktop:check-app-update', async () => {
    return checkAppUpdate(app.getVersion())
  })
  ipcMain.handle('desktop:open-app-release', async (_event, url: unknown) => {
    await openAppRelease(typeof url === 'string' && url !== '' ? url : undefined)
    return { ok: true }
  })
  ipcMain.handle('desktop:check-kernel-update', () => checkKernelUpdate())
  ipcMain.handle('desktop:download-kernel', async () => {
    try {
      return await downloadKernelUpdate(app.getPath('userData'), emitKernelProgress)
    } catch (error) {
      emitKernelProgress({ phase: 'error', message: String(error instanceof Error ? error.message : error) })
      throw error
    }
  })
  ipcMain.handle('desktop:apply-kernel', async () => {
    const applied = applyPendingKernel()
    applyEngineOverride()
    await restartHarness()
    return applied
  })
  ipcMain.handle('desktop:revert-kernel', async () => {
    const reverted = revertToBundledKernel()
    applyEngineOverride()
    await restartHarness()
    return reverted
  })
  ipcMain.handle('desktop:list-jobs', () => listJobs())
  ipcMain.handle('desktop:save-job', (_event, job: unknown) => {
    if (job === null || typeof job !== 'object') return listJobs()
    const raw = job as { id?: unknown; title?: unknown; prompt?: unknown; everyMinutes?: unknown; enabled?: unknown }
    if (typeof raw.title !== 'string' || typeof raw.prompt !== 'string') return listJobs()
    return saveJob({
      id: typeof raw.id === 'string' ? raw.id : undefined,
      title: raw.title,
      prompt: raw.prompt,
      everyMinutes: typeof raw.everyMinutes === 'number' ? raw.everyMinutes : 30,
      enabled: raw.enabled !== false,
    })
  })
  ipcMain.handle('desktop:toggle-job', (_event, id: unknown, enabled: unknown) => {
    if (typeof id !== 'string') return listJobs()
    return toggleJob(id, enabled !== false)
  })
  ipcMain.handle('desktop:delete-job', (_event, id: unknown) => {
    if (typeof id !== 'string') return listJobs()
    return deleteJob(id)
  })
  ipcMain.handle('desktop:list-im', () => listImChannels())
  ipcMain.handle('desktop:im-weixin-start', () => startWeixinLogin())
  ipcMain.handle('desktop:im-weixin-verify', (_event, code: unknown) => submitWeixinVerify(code))
  ipcMain.handle('desktop:im-disconnect', (_event, id: unknown) => disconnectChannel(id))
  ipcMain.handle('desktop:im-save', (_event, id: unknown, fields: unknown) => saveImCreds(id, fields))
  ipcMain.handle('desktop:im-test', (_event, id: unknown) => testImSend(id))
  ipcMain.handle('desktop:im-reply', (_event, channel: unknown, to: unknown, text: unknown, contextToken: unknown) => {
    return replyIm(channel, to, text, contextToken)
  })
  ipcMain.handle('desktop:im-plugin-check', (_event, id: unknown) => checkImPlugin(id))
  ipcMain.handle('desktop:im-plugin-download', (_event, id: unknown) => downloadImPlugin(id))
  ipcMain.handle('desktop:im-plugin-apply', (_event, id: unknown) => applyImPlugin(id))
  ipcMain.handle('desktop:list-workspaces', () => listHarnessWorkspaces())
  ipcMain.handle('desktop:set-im-workspace', (_event, workspaceId: unknown, title: unknown) => {
    return setImWorkspacePref(workspaceId, title)
  })
  ipcMain.handle('desktop:ensure-im-workspace', (_event, title: unknown) => ensureImWorkspace(title))
  ipcMain.handle('desktop:list-imports', () => listImportableSessions())
  ipcMain.handle('desktop:run-import', (_event, ids: unknown) => importSessions(ids))
  ipcMain.handle('desktop:restart-harness', async () => {
    await restartHarness()
    return { ok: true }
  })
  ipcMain.handle('desktop:quit', () => {
    quitApp()
    return { ok: true }
  })
  ipcMain.handle('desktop:open-logs', async () => {
    await shell.openPath(logsDir())
    return { ok: true }
  })
  ipcMain.handle('desktop:open-data-dir', async () => {
    await shell.openPath(dshHome())
    return { ok: true }
  })
  ipcMain.handle('desktop:copy-error', async () => {
    const { clipboard } = await import('electron')
    clipboard.writeText(state.error || readTail(join(logsDir(), HARNESS_LOG_FILENAME), 80))
    return { ok: true }
  })
}

function quitApp(): void {
  quitting = true
  hideToTray = false
  destroyTray()
  app.quit()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.on('before-quit', () => {
    quitting = true
    hideToTray = false
  })

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return
    if (quitting) app.quit()
  })

  app.on('activate', () => {
    showMainWindow()
  })

  let stoppingEngine = false
  app.on('will-quit', (event) => {
    stopIm()
    if (harness !== undefined && harness.running) {
      event.preventDefault()
      if (stoppingEngine) return
      stoppingEngine = true
      void harness.stop().finally(() => {
        app.exit(0)
      })
    }
  })

  void app.whenReady().then(async () => {
    app.setAppUserModelId('dev.rui.dsh-desktop')
    initLogs(logsDir())
    initDesktopSettings(app.getPath('userData'), resolveBundledDshVersion())
    restoreTheme()
    initAutomation(app.getPath('userData'), (job) => {
      log('info', `automation fired: ${job.title}`)
    })
    initIm(app.getPath('userData'), () => harness?.url)
    initSessionImport(app.getPath('userData'), () => harness?.url)
    nativeTheme.on('updated', () => {
      for (const win of BrowserWindow.getAllWindows()) {
        syncTitleBarOverlay(win)
        injectThemeControl(win)
        injectChrome(win)
      }
    })
    applyEngineOverride()
    installAppMenu({
      onReload: () => {
        if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
          mainWindow.reload()
        }
      },
      onRestartEngine: () => {
        void restartHarness()
      },
      onOpenSettings: openOfficialSettings,
      onOpenLogs: () => {
        void shell.openPath(logsDir())
      },
      onOpenDataDir: () => {
        void shell.openPath(dshHome())
      },
      onShowAbout: () => {
        void dialog.showMessageBox({
          type: 'info',
          title: APP_NAME,
          message: APP_NAME,
          detail: [
            `App ${app.getVersion()}`,
            `Embedded @deepseek-ai/dsh ${resolveDshVersion()}`,
            'Unofficial desktop shell. Not affiliated with DeepSeek.',
            `Data directory: ${dshHome()}`,
          ].join('\n'),
        })
      },
      onQuit: quitApp,
    })
    registerIpc()
    log(
      'info',
      `${APP_NAME} ${app.getVersion()} starting (embedded @deepseek-ai/dsh ${resolveDshVersion()})`,
    )
    openWindow()
    createTray({
      onShow: showMainWindow,
      onOpenSettings: openOfficialSettings,
      onRestartEngine: () => {
        void restartHarness()
      },
      onOpenLogs: () => {
        void shell.openPath(logsDir())
      },
      onQuit: quitApp,
    })
    try {
      await bootAndNavigate()
      initUpdater()
      if (process.env.DSH_DESKTOP_SMOKE === '1') {
        log('info', 'desktop smoke: ready, quitting')
        quitApp()
      }
    } catch (error) {
      showError(error)
    }
  })
}
